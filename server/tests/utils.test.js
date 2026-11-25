const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.DB_CLIENT = "better-sqlite3";
process.env.DB_FILENAME = path.join(os.tmpdir(), `dyslinks-utils-${process.pid}.sqlite`);
process.env.REDIS_ENABLED = "false";

const utils = require("../utils");
const knex = require("../knex");

test.after(async () => {
  await knex.destroy();
});

test("isSafeUrl blocks dangerous schemes and private/loopback targets", () => {
  const unsafe = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ms-msdt:/id",
    "//evil.com/path",
    "http://127.0.0.1/admin",
    "http://localhost:3000/test",
    "http://sub.localhost/test",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://100.64.0.1/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[ff02::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://example.com/\r\nSet-Cookie: a=b",
    "ftp://example.com/file",
    "ms-word:ofe|u|https://evil.example/doc.docx",
    "smb://evil.example/share",
    "intent://scan/#Intent;end",
  ];

  for (const url of unsafe) {
    assert.equal(utils.isSafeUrl(url, { allowCustomProtocols: true }), false, `Expected unsafe: ${url}`);
  }
});

test("isSafeUrl allows valid public URLs and safe non-web schemes when enabled", () => {
  const safeWeb = [
    "https://example.com",
    "https://example.com/path?a=1#hash",
    "http://fcbarcelona.com",
    "https://fdroid.org/packages/",
  ];

  for (const url of safeWeb) {
    assert.equal(utils.isSafeUrl(url, { allowCustomProtocols: false }), true, `Expected safe: ${url}`);
    assert.equal(utils.isSafeUrl(url, { allowCustomProtocols: true }), true, `Expected safe: ${url}`);
  }

  assert.equal(utils.isSafeUrl("mailto:user@example.com", { allowCustomProtocols: false }), false);
  assert.equal(utils.isSafeUrl("mailto:user@example.com", { allowCustomProtocols: true }), true);
});

test("isUniqueConstraintError recognizes SQLite, PostgreSQL, and MySQL errors", () => {
  assert.equal(utils.isUniqueConstraintError({ code: "23505" }), true);
  assert.equal(utils.isUniqueConstraintError({ code: "ER_DUP_ENTRY" }), true);
  assert.equal(utils.isUniqueConstraintError({ errno: 1062 }), true);
  assert.equal(utils.isUniqueConstraintError({ code: "SQLITE_CONSTRAINT_UNIQUE" }), true);
  assert.equal(
    utils.isUniqueConstraintError({
      code: "SQLITE_CONSTRAINT",
      message: "UNIQUE constraint failed: links.address",
    }),
    true
  );

  assert.equal(utils.isUniqueConstraintError(null), false);
  assert.equal(utils.isUniqueConstraintError(new Error("generic error")), false);
  assert.equal(
    utils.isUniqueConstraintError({
      code: "SQLITE_CONSTRAINT",
      message: "FOREIGN KEY constraint failed",
    }),
    false
  );
});

test("knexfile loads cleanly in production without JWT_SECRET set", () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;
  const prevSecretFile = process.env.JWT_SECRET_FILE;
  const envPath = require.resolve("../env");
  const knexfilePath = require.resolve("../../knexfile");

  try {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    delete process.env.JWT_SECRET_FILE;
    delete require.cache[envPath];
    delete require.cache[knexfilePath];

    const config = require("../../knexfile");
    assert.equal(config.client, "better-sqlite3");
    assert.ok(process.env.JWT_SECRET.length >= 32);
  } finally {
    process.env.NODE_ENV = prevEnv;
    process.env.JWT_SECRET = prevSecret;
    if (prevSecretFile !== undefined) {
      process.env.JWT_SECRET_FILE = prevSecretFile;
    }
    delete require.cache[envPath];
    delete require.cache[knexfilePath];
  }
});

test("isLocalDomain, getSiteURL, and getShortURL use http:// for loopback domains regardless of NODE_ENV", () => {
  assert.equal(utils.isLocalDomain("localhost:3000"), true);
  assert.equal(utils.isLocalDomain("localhost"), true);
  assert.equal(utils.isLocalDomain("127.0.0.1:8080"), true);
  assert.equal(utils.isLocalDomain("[::1]:3000"), true);
  assert.equal(utils.isLocalDomain("links.example.com"), false);

  const prevEnv = process.env.NODE_ENV;
  const prevDomain = process.env.DEFAULT_DOMAIN;
  const prevSecret = process.env.JWT_SECRET;
  const envPath = require.resolve("../env");
  const utilsPath = require.resolve("../utils/utils");

  try {
    // Unset NODE_ENV (like `npm run dev`) with localhost:3000 -> http://
    delete process.env.NODE_ENV;
    process.env.DEFAULT_DOMAIN = "localhost:3000";
    process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
    delete require.cache[envPath];
    delete require.cache[utilsPath];
    let freshUtils = require("../utils/utils");
    assert.equal(freshUtils.getSiteURL(), "http://localhost:3000");
    assert.equal(freshUtils.getShortURL("abc").url, "http://localhost:3000/abc");

    // Production with non-local domain -> https://
    process.env.NODE_ENV = "production";
    process.env.DEFAULT_DOMAIN = "links.example.com";
    delete require.cache[envPath];
    delete require.cache[utilsPath];
    freshUtils = require("../utils/utils");
    assert.equal(freshUtils.getSiteURL(), "https://links.example.com");
    assert.equal(freshUtils.getShortURL("abc").url, "https://links.example.com/abc");
  } finally {
    if (prevEnv !== undefined) process.env.NODE_ENV = prevEnv;
    else delete process.env.NODE_ENV;
    if (prevDomain !== undefined) process.env.DEFAULT_DOMAIN = prevDomain;
    else delete process.env.DEFAULT_DOMAIN;
    if (prevSecret !== undefined) process.env.JWT_SECRET = prevSecret;
    else delete process.env.JWT_SECRET;
    delete require.cache[envPath];
    delete require.cache[utilsPath];
  }
});
