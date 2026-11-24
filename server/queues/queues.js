const { Queue, Worker } = require("bullmq");
const path = require("node:path");

const env = require("../env");

const connection = {
  port: env.REDIS_PORT,
  host: env.REDIS_HOST,
  db: env.REDIS_DB,
  ...(env.REDIS_PASSWORD && { password: env.REDIS_PASSWORD }),
};

const visitProcessor = require(path.resolve(__dirname, "visit.js"));

let visit;

if (env.REDIS_ENABLED) {
  const visitQueue = new Queue("visit", {
    connection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 1000,
    },
  });

  visitQueue.on("error", (error) => {
    console.error("Visit queue error:", error?.message || error);
  });

  const visitWorker = new Worker(
    "visit",
    async (job) => visitProcessor(job),
    {
      connection,
      concurrency: 6,
    }
  );

  visitWorker.on("error", (error) => {
    console.error("Visit worker error:", error?.message || error);
  });
  visitWorker.on("failed", (job, error) => {
    console.error(`Visit job ${job?.id} failed:`, error?.message || error);
  });

  visit = {
    add(data) {
      return visitQueue.add("visit", data).catch((error) => {
        console.error("Add visit queue error:", error?.message || error);
      });
    },
    async close() {
      await Promise.allSettled([
        visitWorker.close(),
        visitQueue.close(),
      ]);
    },
  };
} else {
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
};