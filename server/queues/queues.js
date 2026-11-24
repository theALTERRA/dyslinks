const Queue = require("bull");
const path = require("node:path");

const env = require("../env");

const redis = {
  port: env.REDIS_PORT,
  host: env.REDIS_HOST,
  db: env.REDIS_DB,
  ...(env.REDIS_PASSWORD && { password: env.REDIS_PASSWORD })
};

let visit;

if (env.REDIS_ENABLED) {
  const visitQueue = new Queue("visit", { redis });
  visitQueue.clean(5000, "completed").catch((error) => {
    console.error("Clean visit queue error:", error?.message || error);
  });
  visitQueue.process(6, path.resolve(__dirname, "visit.js"));
  visitQueue.on("completed", (job) => {
    job.remove().catch(() => {});
  });
  visitQueue.on("error", (error) => {
    console.error("Visit queue error:", error?.message || error);
  });
  visitQueue.on("failed", (job, error) => {
    console.error(`Visit job ${job?.id} failed:`, error?.message || error);
  });

  visit = {
    add(data) {
      return visitQueue.add(data).catch((error) => {
        console.error("Add visit queue error:", error?.message || error);
      });
    },
    close() {
      return visitQueue.close();
    },
  };
} else {
  const visitProcessor = require(path.resolve(__dirname, "visit.js"));
  visit = {
    add(data) {
      return Promise.resolve(visitProcessor({ data })).catch(function(error) {
        console.error("Add visit error:", error?.message || error);
      });
    },
    close() {
      return Promise.resolve();
    },
  };
}



module.exports = { 
  visit,
}