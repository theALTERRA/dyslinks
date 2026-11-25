const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyslinks-test-"));
const dbFile = path.join(tmpDir, "data.sqlite");

process.env.NODE_ENV = "production";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.DEFAULT_DOMAIN = "localhost:3000";
process.env.DB_CLIENT = "better-sqlite3";
process.env.DB_FILENAME = dbFile;
process.env.REDIS_ENABLED = "false";
process.env.ENABLE_RATE_LIMIT = "true";
process.env.DISALLOW_REGISTRATION = "true";
process.env.DISALLOW_ANONYMOUS_LINKS = "true";
process.env.NODE_APP_INSTANCE = "1";

const knex = require("../knex");
const { app } = require("../server");

let httpServer;
let serverPort;
let baseUrl;
let adminToken;
let apiKey;

function rawGet(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: serverPort,
        path: pathname,
        method: "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

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
      serverPort = port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  await knex.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("SQLite connection configures WAL mode, busy_timeout, and foreign_keys", async () => {
  const [fkRow] = await knex.raw("PRAGMA foreign_keys");
  const [jmRow] = await knex.raw("PRAGMA journal_mode");
  const [btRow] = await knex.raw("PRAGMA busy_timeout");

  assert.equal(Object.values(fkRow)[0], 1);
  assert.equal(String(Object.values(jmRow)[0]).toLowerCase(), "wal");
  assert.equal(Object.values(btRow)[0], 5000);
});

test("GET /api/health verifies database connectivity", async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "OK");
});

test("admin setup creates first admin and rejects duplicate admin creation", async () => {
  const first = await jsonRequest("/api/auth/create-admin", {
    method: "POST",
    body: { email: "admin@example.com", password: "StrongPassword123!" },
  });
  assert.equal(first.status, 201);
  assert.ok(first.json?.token);
  adminToken = first.json.token;

  const second = await jsonRequest("/api/auth/create-admin", {
    method: "POST",
    body: { email: "other@example.com", password: "StrongPassword123!" },
  });
  assert.equal(second.status, 400);

  const keyRes = await jsonRequest("/api/auth/apikey", {
    method: "POST",
    headers: {
      Cookie: `token=${adminToken}`,
      Origin: baseUrl,
    },
  });
  assert.equal(keyRes.status, 201);
  assert.ok(keyRes.json?.apikey);
  apiKey = keyRes.json.apikey;
});

test("link creation, redirect, edit, stats, and deletion work end-to-end", async () => {
  const created = await jsonRequest("/api/links", {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: {
      target: "https://example.com/landing",
      customurl: "launch",
      description: "Launch page",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.address, "launch");
  assert.equal(created.json.target, "https://example.com/landing");

  const redirectRes = await rawGet("/launch", { Host: "localhost:3000" });
  assert.equal(redirectRes.status, 302);
  assert.equal(redirectRes.headers.location, "https://example.com/landing");

  const edited = await jsonRequest(`/api/links/${created.json.id}`, {
    method: "PATCH",
    headers: { "x-api-key": apiKey },
    body: {
      target: "https://example.com/updated",
      address: "launch2",
    },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.address, "launch2");
  assert.equal(edited.json.target, "https://example.com/updated");

  const statsRes = await jsonRequest(`/api/links/${created.json.id}/stats`, {
    method: "GET",
    headers: { "x-api-key": apiKey },
  });
  assert.equal(statsRes.status, 200);
  assert.ok(statsRes.json.lastDay);

  const delRes = await jsonRequest(`/api/links/${created.json.id}`, {
    method: "DELETE",
    headers: { "x-api-key": apiKey },
  });
  assert.equal(delRes.status, 200);
});

test("unique index prevents concurrent duplicate slugs on default domain and scopes custom domains", async () => {
  const attempts = await Promise.all([
    jsonRequest("/api/links", {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: { target: "https://example.com/one", customurl: "race-slug" },
    }),
    jsonRequest("/api/links", {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: { target: "https://example.com/two", customurl: "race-slug" },
    }),
  ]);

  const statuses = attempts.map((r) => r.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 400]);

  const rows = await knex("links").where({ address: "race-slug", domain_id: null });
  assert.equal(rows.length, 1);

  // Direct DB insert of a duplicate default-domain slug must fail at DB level
  await assert.rejects(
    () =>
      knex("links").insert({
        address: "race-slug",
        domain_id: null,
        target: "https://example.com/dup",
      }),
    /UNIQUE constraint failed/i
  );

  // Adding a custom domain allows the same slug under that domain_id, but not twice
  const domainRes = await jsonRequest("/api/domains", {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: { address: "go.example.org" },
  });
  assert.equal(domainRes.status, 200);

  const customDomainLink = await jsonRequest("/api/links", {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: {
      target: "https://example.com/custom",
      customurl: "race-slug",
      domain: "go.example.org",
    },
  });
  assert.equal(customDomainLink.status, 201);

  const dupCustomDomainLink = await jsonRequest("/api/links", {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: {
      target: "https://example.com/custom2",
      customurl: "race-slug",
      domain: "go.example.org",
    },
  });
  assert.equal(dupCustomDomainLink.status, 400);
});

test("password-protected links reject wrong passwords and unlock with the right password", async () => {
  const created = await jsonRequest("/api/links", {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: {
      target: "https://example.com/secret-doc",
      customurl: "secret",
      password: "open-sesame",
    },
  });
  assert.equal(created.status, 201);

  const wrong = await jsonRequest(`/api/links/${created.json.id}/protected`, {
    method: "POST",
    body: { password: "wrong-password" },
  });
  assert.equal(wrong.status, 401);

  const right = await jsonRequest(`/api/links/${created.json.id}/protected`, {
    method: "POST",
    body: { password: "open-sesame" },
  });
  assert.equal(right.status, 200);
  assert.equal(right.json.target, "https://example.com/secret-doc");
});

test("Express 5 HTML views, 404 wildcard, express-validator v7 field errors, and date-fns v4 expire_in work", async () => {
  // HTML page render & Express 5 /{*splat} 404 handler
  const loginPage = await rawGet("/login", { Host: "localhost:3000", Accept: "text/html" });
  assert.equal(loginPage.status, 200);
  assert.match(loginPage.body, /<form/i);

  const notFound = await rawGet("/nonexistent/nested/route", { Host: "localhost:3000", Accept: "text/html" });
  assert.equal(notFound.status, 404);
  assert.match(notFound.body, /404/i);

  // express-validator v7 maps e.path into res.locals.errors for HTMX/HTML responses
  const badHtmlRes = await fetch(`${baseUrl}/api/links`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/html",
      "hx-request": "true",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ target: "javascript:alert(1)" }),
  });
  const badHtml = await badHtmlRes.text();
  assert.match(badHtml, /URL is not valid\./);

  // date-fns v4 expire_in handling
  const expiring = await jsonRequest("/api/links", {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: {
      target: "https://example.com/expiring",
      customurl: "exp-test",
      expire_in: "2 hours",
    },
  });
  assert.equal(expiring.status, 201);
  assert.ok(expiring.json.expire_in);
});

test("localhost short links use http://, /stats without id renders error immediately, and fonts send immutable cache", async () => {
  // 1. Short link on localhost:3000 uses http:// even when NODE_ENV=production
  const created = await jsonRequest("/api/links", {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: {
      target: "https://example.com/local-proto",
      customurl: "local-proto",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.link, "http://localhost:3000/local-proto");

  // 2. /stats without id (or empty/invalid id) renders error immediately without hanging HTMX spinner
  for (const statsPath of ["/stats", "/stats?id=", "/stats?id=not-a-uuid"]) {
    const statsPage = await rawGet(statsPath, {
      Host: "localhost:3000",
      Accept: "text/html",
      Cookie: `token=${adminToken}`,
    });
    assert.equal(statsPage.status, 200);
    assert.match(statsPage.body, /ID is invalid\./);
    assert.doesNotMatch(statsPage.body, /hx-get="\/api\/links\/\{id\}\/stats"/);
  }

  // 3. Fonts are served with immutable long-term Cache-Control so link preload is reused without warnings
  const fontRes = await rawGet("/fonts/inter-latin-variable.woff2", { Host: "localhost:3000" });
  assert.equal(fontRes.status, 200);
  assert.match(String(fontRes.headers["cache-control"] || ""), /immutable/i);
  assert.match(String(fontRes.headers["cache-control"] || ""), /max-age=31536000/i);
});

test("logged-in header is preserved on /<slug>+, protected link pages, and 404 pages", async () => {
  const pubRes = await rawGet("/local-proto+", {
    Host: "localhost:3000",
    Accept: "text/html",
    Cookie: `token=${adminToken}`,
  });
  assert.equal(pubRes.status, 200);
  assert.match(pubRes.body, /aria-label="Admin"/);
  assert.match(pubRes.body, /aria-label="Settings"/);
  assert.match(pubRes.body, /\/api\/auth\/logout/);

  const protRes = await rawGet("/secret", {
    Host: "localhost:3000",
    Accept: "text/html",
    Cookie: `token=${adminToken}`,
  });
  assert.equal(protRes.status, 200);
  assert.match(protRes.body, /aria-label="Admin"/);
  assert.match(protRes.body, /aria-label="Settings"/);
  assert.match(protRes.body, /\/api\/auth\/logout/);

  const notFoundRes = await rawGet("/nonexistent/nested/logged-in", {
    Host: "localhost:3000",
    Accept: "text/html",
    Cookie: `token=${adminToken}`,
  });
  assert.equal(notFoundRes.status, 404);
  assert.match(notFoundRes.body, /aria-label="Settings"/);
});

test("inline edit keeps aria-expanded=true, skips unchanged rounded expire_in, and admin/user tables render clean markup", async () => {
  const created = await jsonRequest("/api/links", {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: {
      target: "https://example.com/exp-edit",
      customurl: "exp-edit",
      description: "Initial desc",
      expire_in: "2 days",
    },
  });
  assert.equal(created.status, 201);
  const linkId = created.json.id;

  // Backdate stored expire_in by 10 minutes so ms() still rounds to "2 days" (> 60s drift)
  const backdated = new Date(Date.now() + 48 * 60 * 60 * 1000 - 10 * 60 * 1000);
  const backdatedStr = backdated.toISOString().substring(0, 10) + " " + backdated.toISOString().substring(11, 19);
  await knex("links").where({ uuid: linkId }).update({ expire_in: backdatedStr });

  // Submitting unchanged form with initial_expire_in="2 days" and expire_in="2 days" must NOT update
  const unchangedRes = await fetch(`${baseUrl}/api/links/${linkId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/html",
      "hx-request": "true",
      Cookie: `token=${adminToken}`,
      Origin: baseUrl,
    },
    body: JSON.stringify({
      target: "https://example.com/exp-edit",
      address: "exp-edit",
      description: "Initial desc",
      initial_expire_in: "2 days",
      expire_in: "2 days",
    }),
  });
  const unchangedHtml = await unchangedRes.text();
  assert.match(unchangedHtml, /Should at least update one field\./);
  assert.match(unchangedHtml, /name="initial_expire_in"\s+value="2 days"/);
  const afterUnchanged = await knex("links").where({ uuid: linkId }).first();
  assert.equal(afterUnchanged.expire_in, backdatedStr);

  // Updating description while keeping rounded expire_in unchanged preserves original expire_in and sets aria-expanded="true"
  const editDescRes = await fetch(`${baseUrl}/api/links/${linkId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/html",
      "hx-request": "true",
      Cookie: `token=${adminToken}`,
      Origin: baseUrl,
    },
    body: JSON.stringify({
      target: "https://example.com/exp-edit",
      address: "exp-edit",
      description: "Updated desc",
      initial_expire_in: "2 days",
      expire_in: "2 days",
    }),
  });
  const editDescHtml = await editDescRes.text();
  assert.match(editDescHtml, /Link has been updated\./);
  assert.match(editDescHtml, /aria-expanded="true"/);
  assert.match(editDescHtml, /title="localhost:3000\/exp-edit"/);
  const afterDesc = await knex("links").where({ uuid: linkId }).first();
  assert.equal(afterDesc.expire_in, backdatedStr);
  assert.equal(afterDesc.description, "Updated desc");

  // Admin links table wraps "(view links)" in .description-group without orphaned closing paren
  const adminTableRes = await rawGet("/api/links/admin", {
    Host: "localhost:3000",
    Accept: "text/html",
    "hx-request": "true",
    Cookie: `token=${adminToken}`,
  });
  assert.equal(adminTableRes.status, 200);
  assert.match(adminTableRes.body, /<span class="description-group">\(<button[\s\S]*?>view links<\/button>\)<\/span>/);
  assert.match(adminTableRes.body, /title="localhost:3000\/exp-edit"/);
});
