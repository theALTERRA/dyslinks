const { Router } = require("express");

const knex = require("../knex");
const redis = require("../redis");
const env = require("../env");

const router = Router();

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} health check timed out`)), ms);
      if (typeof timer.unref === "function") timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

router.get("/", async (req, res) => {
  try {
    await withTimeout(knex.raw("SELECT 1"), 3000, "Database");
  } catch (err) {
    console.error("Database health check failed:", err?.message || err);
    return res.status(503).send("Database unavailable");
  }

  if (env.REDIS_ENABLED) {
    try {
      const ok = await redis.ping(2000);
      if (!ok) throw new Error("Unexpected Redis PING response");
    } catch (err) {
      console.error("Redis health check failed:", err?.message || err);
      res.setHeader("X-Health-Redis", "degraded");
      if (req.query.strict === "true") {
        return res.status(503).send("Redis unavailable");
      }
    }
  }

  return res.status(200).send("OK");
});

module.exports = router;
