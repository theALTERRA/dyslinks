const Redis = require("ioredis");

const env = require("./env");

let client;

if (env.REDIS_ENABLED) {
  client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    ...(env.REDIS_PASSWORD && { password: env.REDIS_PASSWORD })
  });

  client.on("error", (err) => {
    console.error("Redis error:", err?.message || err);
  });
}

const key = {
  link: (address, domain_id) => `l:${address}:${domain_id || ""}`,
  domain: (address) => `d:${address}`,
  stats: (link_id) => `s:${link_id}`,
  host: (address) => `h:${address}`,
  userById: (id) => `u:id:${id}`,
  userByApiKey: (apikeyHash) => `u:apikey:${apikeyHash}`
};

async function safeGetJSON(cacheKey) {
  if (!client) return null;
  try {
    const value = await client.get(cacheKey);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    console.error("Redis get error:", err?.message || err);
    return null;
  }
}

function safeSet(cacheKey, value, ttlSeconds) {
  if (!client) return Promise.resolve();
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    const op = ttlSeconds
      ? client.set(cacheKey, serialized, "EX", ttlSeconds)
      : client.set(cacheKey, serialized);
    return Promise.resolve(op).catch((err) => {
      console.error("Redis set error:", err?.message || err);
    });
  } catch (err) {
    console.error("Redis set error:", err?.message || err);
    return Promise.resolve();
  }
}

function safeDel(cacheKey) {
  if (!client) return Promise.resolve();
  try {
    return Promise.resolve(client.del(cacheKey)).catch((err) => {
      console.error("Redis del error:", err?.message || err);
    });
  } catch (err) {
    console.error("Redis del error:", err?.message || err);
    return Promise.resolve();
  }
}

async function ping(timeoutMs = 2000) {
  if (!client) return true;
  let timer;
  try {
    const res = await Promise.race([
      client.ping(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Redis ping timed out")), timeoutMs);
        if (typeof timer.unref === "function") timer.unref();
      }),
    ]);
    return res === "PONG";
  } finally {
    clearTimeout(timer);
  }
}

async function close() {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

const remove = {
  domain: (domain) => {
    if (!domain) return Promise.resolve();
    return safeDel(key.domain(domain.address));
  },
  host: (host) => {
    if (!host) return Promise.resolve();
    return safeDel(key.host(host.address));
  },
  link: (link) => {
    if (!link) return Promise.resolve();
    return safeDel(key.link(link.address, link.domain_id));
  },
  user: (user) => {
    if (!user) return Promise.resolve();
    const tasks = [];
    if (user.id !== undefined && user.id !== null) {
      tasks.push(safeDel(key.userById(user.id)));
    }
    if (user.apikey) {
      tasks.push(safeDel(key.userByApiKey(user.apikey)));
    }
    return Promise.all(tasks);
  }
};


module.exports = {
  client,
  close,
  key,
  ping,
  remove,
  safeDel,
  safeGetJSON,
  safeSet,
};