const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyslinks-bulk-"));
const dbFile = path.join(tmpDir, "bulk.sqlite");

process.env.NODE_ENV = "production";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.DEFAULT_DOMAIN = "localhost:3000";
process.env.DB_CLIENT = "better-sqlite3";
process.env.DB_FILENAME = dbFile;
process.env.REDIS_ENABLED = "false";
process.env.ENABLE_RATE_LIMIT = "false";
process.env.DISALLOW_REGISTRATION = "true";
process.env.DISALLOW_ANONYMOUS_LINKS = "true";
process.env.DISALLOW_CUSTOM_DOMAINS = "false";
process.env.NODE_APP_INSTANCE = "1";

const knex = require("../knex");
const { app } = require("../server");

let httpServer;
let baseUrl;
let adminToken;
let adminApiKey;
let userToken;
let userApiKey;

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

  const createUser = await jsonRequest("/api/users/admin", {
    method: "POST",
    headers: { "x-api-key": adminApiKey },
    body: { email: "member@example.com", password: "MemberPassword123!", verified: true },
  });
  assert.equal(createUser.status, 201);

  const loginUser = await jsonRequest("/api/auth/login", {
    method: "POST",
    body: { email: "member@example.com", password: "MemberPassword123!" },
  });
  assert.equal(loginUser.status, 200);
  userToken = loginUser.json.token;

  const userKeyRes = await jsonRequest("/api/auth/apikey", {
    method: "POST",
    headers: { Cookie: `token=${userToken}`, Origin: baseUrl },
  });
  assert.equal(userKeyRes.status, 201);
  userApiKey = userKeyRes.json.apikey;

  // Add custom domains: dysto.cc, sub.dysto.cc (owned by admin), and shared.example.org (shared)
  for (const body of [
    { address: "dysto.cc", shared: true },
    { address: "sub.dysto.cc", shared: true },
    { address: "shared.example.org", shared: true },
  ]) {
    const domRes = await jsonRequest("/api/domains/admin", {
      method: "POST",
      headers: { "x-api-key": adminApiKey },
      body,
    });
    assert.equal(domRes.status, 200);
  }
});

test.after(async () => {
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  await knex.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function createLink(apiKey, payload) {
  const res = await jsonRequest("/api/links", {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: payload,
  });
  assert.equal(res.status, 201);
  return res.json;
}

test("GET /api/links filters accurately by default domain, custom domain (exact match), and search", async () => {
  const defaultLink = await createLink(adminApiKey, {
    target: "https://example.com/default-alpha",
    customurl: "def1",
  });
  const dystoLink1 = await createLink(adminApiKey, {
    target: "https://example.com/dysto-alpha",
    customurl: "dys1",
    domain: "dysto.cc",
  });
  const dystoLink2 = await createLink(adminApiKey, {
    target: "https://example.com/dysto-beta",
    customurl: "dys2",
    domain: "dysto.cc",
  });
  const subDystoLink = await createLink(adminApiKey, {
    target: "https://example.com/sub-dysto",
    customurl: "sub1",
    domain: "sub.dysto.cc",
  });

  // Unfiltered returns all 4
  const allRes = await jsonRequest("/api/links", { headers: { "x-api-key": adminApiKey } });
  assert.equal(allRes.status, 200);
  assert.equal(allRes.json.total, 4);

  // Filter by default domain returns only defaultLink
  const defRes = await jsonRequest("/api/links?domain=localhost:3000", {
    headers: { "x-api-key": adminApiKey },
  });
  assert.equal(defRes.status, 200);
  assert.equal(defRes.json.total, 1);
  assert.equal(defRes.json.data[0].id, defaultLink.id);

  // Filter by dysto.cc (case-insensitive) returns ONLY dystoLink1 & dystoLink2, NOT sub.dysto.cc
  const dysRes = await jsonRequest("/api/links?domain=DYSTO.CC", {
    headers: { "x-api-key": adminApiKey },
  });
  assert.equal(dysRes.status, 200);
  assert.equal(dysRes.json.total, 2);
  const dysIds = dysRes.json.data.map((l) => l.id).sort();
  assert.deepEqual(dysIds, [dystoLink1.id, dystoLink2.id].sort());

  // Combine domain + search
  const dysAlpha = await jsonRequest("/api/links?domain=dysto.cc&search=alpha", {
    headers: { "x-api-key": adminApiKey },
  });
  assert.equal(dysAlpha.status, 200);
  assert.equal(dysAlpha.json.total, 1);
  assert.equal(dysAlpha.json.data[0].id, dystoLink1.id);

  // Non-string domain query returns 400
  const badDomain = await jsonRequest("/api/links?domain=a&domain=b", {
    headers: { "x-api-key": adminApiKey },
  });
  assert.equal(badDomain.status, 400);

  // Clean up subDystoLink reference check
  assert.ok(subDystoLink.id);
});

test("homepage renders domain filter dropdown, select all button, bulk delete button, and CSP-clean markup", async () => {
  const res = await fetch(`${baseUrl}/`, {
    headers: {
      Accept: "text/html",
      Cookie: `token=${adminToken}`,
    },
  });
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.match(html, /id="filter-domain"/);
  assert.match(html, /<option value="">All domains<\/option>/);
  assert.match(html, /<option value="localhost:3000">localhost:3000<\/option>/);
  assert.match(html, /<option value="dysto\.cc">dysto\.cc<\/option>/);
  assert.match(html, /id="select-all-links-btn"/);
  assert.match(html, /id="select-all-links-checkbox"/);
  assert.match(html, /id="bulk-delete-links-btn"/);
  assert.doesNotMatch(html, /\son(click|change|input)=/i);

  // Table partial renders row checkboxes
  const tableRes = await fetch(`${baseUrl}/api/links?domain=dysto.cc`, {
    headers: {
      Accept: "text/html",
      "hx-request": "true",
      Cookie: `token=${adminToken}`,
    },
  });
  assert.equal(tableRes.status, 200);
  const tableHtml = await tableRes.text();
  assert.match(tableHtml, /class="link-select-checkbox"/);
  assert.match(tableHtml, /dysto\.cc\/dys1/);
  assert.doesNotMatch(tableHtml, /sub\.dysto\.cc\/sub1/);
});

test("POST /api/links/bulk-delete deletes explicit IDs, respects ownership even for admins, and validates input", async () => {
  const memberLink = await createLink(userApiKey, {
    target: "https://example.com/member-keep",
    customurl: "mem1",
    domain: "dysto.cc",
  });
  const adminLinkA = await createLink(adminApiKey, {
    target: "https://example.com/bulk-a",
    customurl: "bulka",
  });
  const adminLinkB = await createLink(adminApiKey, {
    target: "https://example.com/bulk-b",
    customurl: "bulkb",
  });

  // Invalid inputs return 400
  const emptyRes = await jsonRequest("/api/links/bulk-delete", {
    method: "POST",
    headers: { "x-api-key": adminApiKey },
    body: { ids: [] },
  });
  assert.equal(emptyRes.status, 400);

  const badUuidRes = await jsonRequest("/api/links/bulk-delete", {
    method: "POST",
    headers: { "x-api-key": adminApiKey },
    body: { ids: ["not-a-uuid"] },
  });
  assert.equal(badUuidRes.status, 400);

  // Regular user cannot delete admin's link
  const crossUserRes = await jsonRequest("/api/links/bulk-delete", {
    method: "POST",
    headers: { "x-api-key": userApiKey },
    body: { ids: [adminLinkA.id] },
  });
  assert.equal(crossUserRes.status, 404);

  // Admin bulk-deleting [adminLinkA, adminLinkB, memberLink] ONLY deletes their own 2 links
  const bulkRes = await jsonRequest("/api/links/bulk-delete", {
    method: "POST",
    headers: { "x-api-key": adminApiKey },
    body: { ids: [adminLinkA.id, adminLinkB.id, memberLink.id] },
  });
  assert.equal(bulkRes.status, 200);
  assert.equal(bulkRes.json.count, 2);

  // Member's link MUST still exist
  const memberStillThere = await knex("links").where({ uuid: memberLink.uuid || memberLink.id }).first();
  assert.ok(memberStillThere);
});

test("POST /api/links/bulk-delete with all:true deletes ONLY links matching active domain/search filter for caller", async () => {
  // Member has a link in dysto.cc from previous test; add another in shared.example.org
  await createLink(userApiKey, {
    target: "https://example.com/member-shared",
    customurl: "memshared",
    domain: "shared.example.org",
  });

  // Admin has links in localhost:3000 (def1), dysto.cc (dys1, dys2), sub.dysto.cc (sub1)
  // Delete ALL admin links in dysto.cc via HTMX form-encoded POST
  const confirmRes = await fetch(`${baseUrl}/confirm-links-delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html",
      "hx-request": "true",
      Cookie: `token=${adminToken}`,
      Origin: baseUrl,
    },
    body: new URLSearchParams({ all: "true", domain: "dysto.cc", search: "" }),
  });
  assert.equal(confirmRes.status, 200);
  const confirmHtml = await confirmRes.text();
  assert.match(confirmHtml, /<b>2<\/b>/);
  assert.match(confirmHtml, /dysto\.cc/);

  const delRes = await fetch(`${baseUrl}/api/links/bulk-delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html",
      "hx-request": "true",
      Cookie: `token=${adminToken}`,
      Origin: baseUrl,
    },
    body: new URLSearchParams({ all: "true", domain: "dysto.cc", search: "" }),
  });
  assert.equal(delRes.status, 200);
  assert.equal(delRes.headers.get("hx-reswap"), "outerHTML");
  assert.match(delRes.headers.get("hx-trigger") || "", /reloadMainTable/);
  assert.match(delRes.headers.get("hx-trigger") || "", /clearLinkSelection/);
  const delHtml = await delRes.text();
  assert.match(delHtml, /<b>2<\/b> links have been deleted\./);

  // Admin's dysto.cc links are gone, but default domain (def1) and sub.dysto.cc (sub1) remain!
  const remainingAdmin = await jsonRequest("/api/links", { headers: { "x-api-key": adminApiKey } });
  assert.equal(remainingAdmin.status, 200);
  assert.equal(remainingAdmin.json.total, 2);
  const remainingAddresses = remainingAdmin.json.data.map((l) => l.address).sort();
  assert.deepEqual(remainingAddresses, ["def1", "sub1"]);

  // Member's dysto.cc link was NOT touched by admin's homepage bulk delete!
  const memberDysto = await jsonRequest("/api/links?domain=dysto.cc", {
    headers: { "x-api-key": userApiKey },
  });
  assert.equal(memberDysto.status, 200);
  assert.equal(memberDysto.json.total, 1);
  assert.equal(memberDysto.json.data[0].address, "mem1");

  // Bulk delete by default domain deletes ONLY def1, leaving sub1 intact
  const delDefaultRes = await jsonRequest("/api/links/bulk-delete", {
    method: "POST",
    headers: { "x-api-key": adminApiKey },
    body: { all: true, domain: "localhost:3000" },
  });
  assert.equal(delDefaultRes.status, 200);
  assert.equal(delDefaultRes.json.count, 1);

  const afterDefault = await jsonRequest("/api/links", { headers: { "x-api-key": adminApiKey } });
  assert.equal(afterDefault.json.total, 1);
  assert.equal(afterDefault.json.data[0].address, "sub1");
});
