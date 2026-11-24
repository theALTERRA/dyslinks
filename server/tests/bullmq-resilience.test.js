const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const EventEmitter = require("node:events");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.REDIS_ENABLED = "false";

test("BullMQ queue and worker wire up, handle errors safely, and close cleanly when Redis is enabled", async () => {
  const bullmqPath = require.resolve("bullmq");
  const envPath = require.resolve("../env");
  const queuesPath = require.resolve("../queues/queues");
  const visitProcPath = require.resolve("../queues/visit");

  const origBullmq = require.cache[bullmqPath];
  const origEnv = require.cache[envPath];
  const origQueues = require.cache[queuesPath];
  const origVisitProc = require.cache[visitProcPath];
  const prevRedisEnabled = process.env.REDIS_ENABLED;

  const state = {
    queueName: null,
    queueOpts: null,
    workerName: null,
    workerOpts: null,
    workerFn: null,
    addedJobs: [],
    processedPayloads: [],
    queueClosed: false,
    workerClosed: false,
    failNextAdd: false,
    queueInstance: null,
    workerInstance: null,
  };

  class MockQueue extends EventEmitter {
    constructor(name, opts) {
      super();
      state.queueName = name;
      state.queueOpts = opts;
      state.queueInstance = this;
    }
    async add(jobName, data) {
      if (state.failNextAdd) {
        throw new Error("Redis unavailable");
      }
      state.addedJobs.push({ jobName, data });
      return { id: "1", name: jobName, data };
    }
    async close() {
      state.queueClosed = true;
    }
  }

  class MockWorker extends EventEmitter {
    constructor(name, processor, opts) {
      super();
      state.workerName = name;
      state.workerFn = processor;
      state.workerOpts = opts;
      state.workerInstance = this;
    }
    async close() {
      state.workerClosed = true;
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
    require.cache[bullmqPath] = {
      id: bullmqPath,
      filename: bullmqPath,
      loaded: true,
      exports: { Queue: MockQueue, Worker: MockWorker },
    };
    require.cache[visitProcPath] = {
      id: visitProcPath,
      filename: visitProcPath,
      loaded: true,
      exports: async ({ data }) => {
        state.processedPayloads.push(data);
      },
    };
    delete require.cache[envPath];
    delete require.cache[queuesPath];

    const { visit } = require("../queues/queues");

    assert.equal(state.queueName, "visit");
    assert.equal(state.queueOpts.defaultJobOptions.removeOnComplete, true);
    assert.equal(state.queueOpts.defaultJobOptions.removeOnFail, 1000);
    assert.equal(state.workerName, "visit");
    assert.equal(state.workerOpts.concurrency, 6);

    // Error & failed events must be handled without throwing
    assert.doesNotThrow(() => state.queueInstance.emit("error", new Error("queue err")));
    assert.doesNotThrow(() => state.workerInstance.emit("error", new Error("worker err")));
    assert.doesNotThrow(() => state.workerInstance.emit("failed", { id: "1" }, new Error("job err")));

    // Normal enqueue & worker processing
    await visit.add({ link: { id: 42 } });
    assert.equal(state.addedJobs.length, 1);
    assert.equal(state.addedJobs[0].jobName, "visit");
    assert.deepEqual(state.addedJobs[0].data, { link: { id: 42 } });

    await state.workerFn({ data: state.addedJobs[0].data });
    assert.deepEqual(state.processedPayloads, [{ link: { id: 42 } }]);

    // Failing enqueue must not produce an unhandled rejection
    state.failNextAdd = true;
    await assert.doesNotReject(() => visit.add({ link: { id: 99 } }));

    // Graceful close must close both worker and queue
    await visit.close();
    assert.equal(state.workerClosed, true);
    assert.equal(state.queueClosed, true);

    await new Promise((r) => setImmediate(r));
    assert.equal(unhandled, null);
  } finally {
    console.error = origConsoleError;
    process.off("unhandledRejection", onUnhandled);
    process.env.REDIS_ENABLED = prevRedisEnabled;

    if (origBullmq) require.cache[bullmqPath] = origBullmq;
    else delete require.cache[bullmqPath];
    if (origEnv) require.cache[envPath] = origEnv;
    else delete require.cache[envPath];
    if (origQueues) require.cache[queuesPath] = origQueues;
    else delete require.cache[queuesPath];
    if (origVisitProc) require.cache[visitProcPath] = origVisitProc;
    else delete require.cache[visitProcPath];
  }
});
