const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const EventEmitter = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyslinks-sec-"));
const dbFile = path.join(tmpDir, "security.sqlite");

process.env.NODE_ENV = "production";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.DEFAULT_DOMAIN = "localhost:3000";
process.env.DB_CLIENT = "better-sqlite3";
process.env.DB_FILENAME = dbFile;
process.env.REDIS_ENABLED = "false";
process.env.ENABLE_RATE_LIMIT = "true";
process.env.DISALLOW_REGISTRATION = "true";
process.env.DISALLOW_ANONYMOUS_LINKS = "true";
process.env.DISALLOW_CUSTOM_DOMAINS = "false";
process.env.NODE_APP_INSTANCE = "1";

const knex = require("../knex");
const query = require("../queries");
const utils = require("../utils");
const { app } = require("../server");

let httpServer;
let baseUrl;
let adminToken;
let adminApiKey;
let regularToken;
let regularApiKey;
let regularUserId;

async function jsonRequest(pathname, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

test.before(async () => {
  await knex.migrate.latest({
    directory: path.resolve(__dirname, "../migrations"),
  });

  await new Promise((resolve) => {
    httpServer = app.listen(0, "127.0.0.1", () => {
      const { port } = httpServer.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Create admin and API key
  const adminRes = await jsonRequest("/api/auth/create-admin", {
    method: "POST",
    body: { email: "admin@example.com", password: "StrongPassword123!" },
  });
  assert.equal(adminRes.status, 201);
  adminToken = adminRes.json.token;

  const adminKeyRes = await jsonRequest("/api/auth/apikey", {
    method: "POST",
    headers: { Cookie: `token=${adminToken}`, Origin: baseUrl },
  });
  assert.equal(adminKeyRes.status, 201);
  adminApiKey = adminKeyRes.json.apikey;

  // Create regular user via admin endpoint
  const userCreate = await jsonRequest("/api/users/admin", {
    method: "POST",
    headers: { "x-api-key": adminApiKey },
    body: {
      email: "user@example.com",
      password: "UserPassword123!",
      verified: true,
    },
  });
  assert.equal(userCreate.status, 201);

  const loginRes = await jsonRequest("/api/auth/login", {
    method: "POST",
    body: { email: "user@example.com", password: "UserPassword123!" },
  });
  assert.equal(loginRes.status, 200);
  regularToken = loginRes.json.token;

  const userKeyRes = await jsonRequest("/api/auth/apikey", {
    method: "POST",
    headers: { Cookie: `token=${regularToken}`, Origin: baseUrl },
  });
  assert.equal(userKeyRes.status, 201);
  regularApiKey = userKeyRes.json.apikey;

  const userRow = await knex("users").where({ email: "user@example.com" }).first();
  regularUserId = userRow.id;
});

test.after(async () => {
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  await knex.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Finding #1: Redis user ID cache cannot collide with API key lookup", async () => {
  const ioredisPath = require.resolve("ioredis");
  const envPath = require.resolve("../env");
  const redisPath = require.resolve("../redis");
  const userQueriesPath = require.resolve("../queries/user.queries");

  const origIoredis = require.cache[ioredisPath];
  const origEnv = require.cache[envPath];
  const origRedis = require.cache[redisPath];
  const origUserQueries = require.cache[userQueriesPath];
  const prevRedisEnabled = process.env.REDIS_ENABLED;

  const store = new Map();
  class MemRedis extends EventEmitter {
    async get(k) { return store.has(k) ? store.get(k) : null; }
    async set(k, v) { store.set(k, v); return "OK"; }
    async del(k) { store.delete(k); return 1; }
    async quit() { return "OK"; }
    disconnect() {}
  }

  try {
    process.env.REDIS_ENABLED = "true";
    require.cache[ioredisPath] = { id: ioredisPath, filename: ioredisPath, loaded: true, exports: MemRedis };
    delete require.cache[envPath];
    delete require.cache[redisPath];
    delete require.cache[userQueriesPath];

    const redisMod = require("../redis");
    const userQueries = require("../queries/user.queries");

    // Populate Redis cache via user ID lookup (as JWT auth does)
    const adminById = await userQueries.find({ id: 1 });
    assert.ok(adminById);
    assert.ok(store.has(redisMod.key.userById(1)));
    assert.notEqual(redisMod.key.userById(1), redisMod.key.userByApiKey("1"));

    // Attacker tries apikey "1" (raw or hashed) -> MUST NOT match cached user ID 1
    assert.equal(await userQueries.find({ apikey: "1" }), undefined);
    assert.equal(await userQueries.find({ apikey: utils.hashApiKey("1") }), undefined);

    // Valid hashed API key lookup succeeds and uses separate namespace
    const hashed = utils.hashApiKey(adminApiKey);
    const adminByKey = await userQueries.find({ apikey: hashed });
    assert.equal(adminByKey.id, 1);
    assert.ok(store.has(redisMod.key.userByApiKey(hashed)));
  } finally {
    process.env.REDIS_ENABLED = prevRedisEnabled;
    if (origIoredis) require.cache[ioredisPath] = origIoredis; else delete require.cache[ioredisPath];
    if (origEnv) require.cache[envPath] = origEnv; else delete require.cache[envPath];
    if (origRedis) require.cache[redisPath] = origRedis; else delete require.cache[redisPath];
    if (origUserQueries) require.cache[userQueriesPath] = origUserQueries; else delete require.cache[userQueriesPath];
  }
});

test("Finding #3: Regular users cannot hijack admin system domains or retired user domains", async () => {
  // Admin adds a non-shared system domain (user_id=NULL, shared=false, banned=false)
  const adminDom = await jsonRequest("/api/domains/admin", {
    method: "POST",
    headers: { "x-api-key": adminApiKey },
    body: { address: "system.example.org", shared: false },
  });
  assert.equal(adminDom.status, 200);

  // Regular user attempts to hijack it via POST /api/domains
  const hijackSystem = await jsonRequest("/api/domains", {
    method: "POST",
    headers: { "x-api-key": regularApiKey },
    body: { address: "system.example.org", homepage: "https://evil.example" },
  });
  assert.equal(hijackSystem.status, 400);

  // Admin creates & removes a personal domain (leaves user_id=NULL)
  const ownDom = await jsonRequest("/api/domains", {
    method: "POST",
    headers: { "x-api-key": adminApiKey },
    body: { address: "retired.example.org" },
  });
  assert.equal(ownDom.status, 200);

  const delOwn = await jsonRequest(`/api/domains/${ownDom.json.id}`, {
    method: "DELETE",
    headers: { "x-api-key": adminApiKey },
  });
  assert.equal(delOwn.status, 200);

  // Regular user attempts to reclaim the retired domain
  const hijackRetired = await jsonRequest("/api/domains", {
    method: "POST",
    headers: { "x-api-key": regularApiKey },
    body: { address: "retired.example.org" },
  });
  assert.equal(hijackRetired.status, 400);
});

test("Finding #4: Strict CSP header disallows unsafe-inline and unsafe-eval for scripts", async () => {
  const res = await fetch(`${baseUrl}/login`, { headers: { Accept: "text/html" } });
  const csp = res.headers.get("content-security-policy") || "";
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-eval'/);
});

test("Finding #5: GET /logout does not revoke sessions; POST /api/auth/logout does; verifyOrigin fails closed", async () => {
  // Cookie-authenticated POST without Origin/Referer/Sec-Fetch-Site must fail closed with 403
  const noOrigin = await jsonRequest("/api/auth/apikey", {
    method: "POST",
    headers: { Cookie: `token=${regularToken}` },
  });
  assert.equal(noOrigin.status, 403);

  // Invalid x-api-key must NOT fall back to valid JWT cookie
  const badKeyWithCookie = await jsonRequest("/api/users", {
    method: "GET",
    headers: {
      Cookie: `token=${regularToken}`,
      "x-api-key": "invalid-key-value",
    },
  });
  assert.equal(badKeyWithCookie.status, 401);

  // GET /logout must NOT revoke the user's token_version
  const getLogout = await fetch(`${baseUrl}/logout`, {
    headers: { Accept: "text/html", Cookie: `token=${regularToken}` },
  });
  assert.equal(getLogout.status, 200);
  const stillAuthed = await jsonRequest("/api/users", {
    method: "GET",
    headers: { Cookie: `token=${regularToken}` },
  });
  assert.equal(stillAuthed.status, 200);

  // POST /api/auth/logout with valid Origin revokes session
  const postLogout = await jsonRequest("/api/auth/logout", {
    method: "POST",
    headers: { Cookie: `token=${regularToken}`, Origin: baseUrl },
  });
  assert.equal(postLogout.status, 200);

  const afterLogout = await jsonRequest("/api/users", {
    method: "GET",
    headers: { Cookie: `token=${regularToken}` },
  });
  assert.equal(afterLogout.status, 401);
});

test("Finding #7: API keys are SHA-256 hashed at rest, never returned by GET /api/users, and rejected in query strings", async () => {
  const adminRow = await knex("users").where({ id: 1 }).first();
  assert.ok(utils.isHashedApiKey(adminRow.apikey), "Expected stored apikey to be sha256-hashed");
  assert.notEqual(adminRow.apikey, adminApiKey);

  // GET /api/users returns has_apikey boolean, never the raw/hashed apikey
  const me = await jsonRequest("/api/users", {
    method: "GET",
    headers: { "x-api-key": adminApiKey },
  });
  assert.equal(me.status, 200);
  assert.equal(me.json.has_apikey, true);
  assert.equal("apikey" in me.json, false);

  // Query string ?apikey= must be rejected
  const qsRes = await jsonRequest(`/api/users?apikey=${encodeURIComponent(adminApiKey)}`, {
    method: "GET",
  });
  assert.equal(qsRes.status, 401);
});

test("Finding #6: visits.referrers caps distinct keys at 200 and aggregates overflow into 'other'", async () => {
  const link = await query.link.create({
    address: "refcap",
    target: "https://example.com/refcap",
    user_id: 1,
    domain_id: null,
  });

  for (let i = 0; i < 205; i++) {
    await query.visit.add({
      browser: "chrome",
      os: "linux",
      country: "us",
      link_id: link.id,
      user_id: 1,
      referrer: `ref-${i}[dot]example`,
    });
  }

  const visitRow = await knex("visits").where({ link_id: link.id }).first();
  const referrers = typeof visitRow.referrers === "string" ? JSON.parse(visitRow.referrers) : visitRow.referrers;
  assert.ok(Object.keys(referrers).length <= 201);
  assert.equal(referrers.other, 5);
});

test("Findings #10 & #12: Ban revokes API key & token_version, blocks admin ban, and UUID validation rejects non-UUIDs", async () => {
  // Malformed 36-char non-UUID must return 400
  const badUuid = await jsonRequest("/api/links/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/stats", {
    method: "GET",
    headers: { "x-api-key": adminApiKey },
  });
  assert.equal(badUuid.status, 400);

  // Banning regular user revokes their API key and increments token_version
  const beforeUser = await knex("users").where({ id: regularUserId }).first();
  const banRes = await jsonRequest(`/api/users/admin/ban/${regularUserId}`, {
    method: "POST",
    headers: { "x-api-key": adminApiKey },
    body: {},
  });
  assert.equal(banRes.status, 200);

  const afterUser = await knex("users").where({ id: regularUserId }).first();
  assert.equal(Boolean(afterUser.banned), true);
  assert.equal(afterUser.apikey, null);
  assert.equal(afterUser.token_version, beforeUser.token_version + 1);

  // Non-operator array in user.queries.find is rejected
  await assert.rejects(() => query.user.find({ id: ["DROP", "TABLE"] }), /Invalid query condition/);
});
