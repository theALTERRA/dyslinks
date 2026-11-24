const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const EventEmitter = require("node:events");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.REDIS_ENABLED = "false";

test("redis safe helpers return fallback values when Redis is disabled", async () => {
  const redis = require("../redis");

  assert.equal(await redis.safeGetJSON("l:missing:"), null);
  await assert.doesNotReject(() => redis.safeSet("l:test:", { ok: true }, 60));
  await assert.doesNotReject(() => redis.safeDel("l:test:"));
  await assert.doesNotReject(() => redis.remove.link({ address: "abc", domain_id: null }));
  await assert.doesNotReject(() => redis.remove.domain({ address: "example.com" }));
  await assert.doesNotReject(() => redis.remove.host({ address: "1.1.1.1" }));
  await assert.doesNotReject(() => redis.remove.user({ id: 1, apikey: "key" }));
  assert.equal(await redis.ping(500), true);
  await assert.doesNotReject(() => redis.close());
});

test("redis safe helpers swallow failing Redis operations without unhandled rejections", async () => {
  const ioredisPath = require.resolve("ioredis");
  const envPath = require.resolve("../env");
  const redisPath = require.resolve("../redis");

  const origIoredis = require.cache[ioredisPath];
  const origEnv = require.cache[envPath];
  const origRedis = require.cache[redisPath];
  const prevRedisEnabled = process.env.REDIS_ENABLED;

  class FailingRedis extends EventEmitter {
    async get() {
      throw new Error("ECONNREFUSED");
    }
    async set() {
      throw new Error("ECONNREFUSED");
    }
    async del() {
      throw new Error("ECONNREFUSED");
    }
    async ping() {
      throw new Error("ECONNREFUSED");
    }
    async quit() {
      throw new Error("ECONNREFUSED");
    }
    disconnect() {
      this.disconnected = true;
    }
  }

  let unhandled = null;
  const onUnhandled = (err) => {
    unhandled = err;
  };
  process.on("unhandledRejection", onUnhandled);

  const origConsoleError = console.error;
  console.error = () => {};

  try {
    process.env.REDIS_ENABLED = "true";
    require.cache[ioredisPath] = {
      id: ioredisPath,
      filename: ioredisPath,
      loaded: true,
      exports: FailingRedis,
    };
    delete require.cache[envPath];
    delete require.cache[redisPath];

    const redis = require("../redis");

    // Emitting an error event on the client must not throw (error listener is attached)
    assert.doesNotThrow(() => redis.client.emit("error", new Error("connection lost")));

    assert.equal(await redis.safeGetJSON("l:abc:"), null);
    await assert.doesNotReject(() => redis.safeSet("l:abc:", { id: 1 }, 60));
    await assert.doesNotReject(() => redis.safeDel("l:abc:"));
    await assert.doesNotReject(() => redis.remove.user({ id: 1, apikey: "k" }));
    await assert.rejects(() => redis.ping(500), /ECONNREFUSED/);

    await redis.close();
    assert.equal(redis.client.disconnected, true);

    await new Promise((r) => setImmediate(r));
    assert.equal(unhandled, null);
  } finally {
    console.error = origConsoleError;
    process.off("unhandledRejection", onUnhandled);
    process.env.REDIS_ENABLED = prevRedisEnabled;

    if (origIoredis) require.cache[ioredisPath] = origIoredis;
    else delete require.cache[ioredisPath];
    if (origEnv) require.cache[envPath] = origEnv;
    else delete require.cache[envPath];
    if (origRedis) require.cache[redisPath] = origRedis;
    else delete require.cache[redisPath];
  }
});
