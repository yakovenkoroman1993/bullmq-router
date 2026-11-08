import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { Job } from "bullmq";
import { cleanup, createValkeyConnection, uniquePrefix, waitFor, waitForFinished } from "./helpers.js";

// Must be set before src/sandbox-worker.ts is imported: it picks sandbox.ts vs sandbox.js at load time.
process.env.BULLMQ_ROUTER_NODE_ENV = "development";
// Inherited by the sandboxed child, which builds its own iovalkey client.
process.env.SANDBOX_CONNECTION = "iovalkey";

const { createRouter, defineJob, QueueManager, setupBullmqRouter } = await import("../src/index.js");

const processed: Array<{ name: string; data: unknown }> = [];

const router = createRouter({
  valkey: {
    ok: defineJob<{ n: number }>(async (job, name) => {
      processed.push({ name, data: job.data });
      await job.log(`n=${job.data.n}`);
    })({ jobIdComponents: ["n"] }),
    fail: defineJob<object>(async () => {
      throw new Error("valkey failure");
    })(),
  },
});

const connection = createValkeyConnection("valkey-shared");
const workers = setupBullmqRouter(router, {
  connection,
  prefix: uniquePrefix("valkey"),
  queueOptions: { valkey: { defaultJobOptions: { removeOnFail: false } } },
});
const queue = () => QueueManager.getQueue("valkey");

after(async () => {
  await cleanup([queue()], Object.values(workers));
  // BullMQ must not close a client it was handed.
  assert.equal(connection.status, "ready");
});

describe("iovalkey connection", () => {
  it("passes the iovalkey client through to queues and workers", () => {
    assert.equal(QueueManager.getOptions("valkey")!.connection, connection);
    assert.equal(workers.valkey.opts.connection, connection);
  });

  it("processes pushed jobs through the routed handler", async () => {
    const job = await router.valkey.ok.push({ n: 1 });
    assert.equal(job.id, "valkey.ok.1");
    assert.equal(await waitForFinished(job), "completed");
    await waitFor(() => processed.some((p) => p.name === "valkey.ok" && (p.data as { n: number }).n === 1));

    const { logs } = await queue().getJobLogs(job.id!);
    assert.ok(logs.includes("n=1"), `expected n=1 in ${JSON.stringify(logs)}`);
  });

  it("marks the job as failed when the handler throws", async () => {
    const job = await router.valkey.fail.push({});
    assert.equal(await waitForFinished(job), "failed");
    assert.equal((await queue().getJob(job.id!))?.failedReason, "valkey failure");
  });

  it("supports getFullJob, replace and cancelDelayedJob", async () => {
    const delayed = await router.valkey.ok.push({ n: 2 }, { delay: 60_000 });
    assert.equal(await delayed.getState(), "delayed");

    const full = await router.valkey.ok.getFullJob({ n: 2 });
    assert.equal(full?.id, "valkey.ok.2");
    assert.equal(full?.state, "delayed");

    const replaced = await router.valkey.ok.replace({ n: 2 }, { delay: 60_000 });
    assert.equal(replaced.id, "valkey.ok.2");
    assert.equal(await replaced.getState(), "delayed");

    assert.equal(await router.valkey.ok.cancelDelayedJob({ n: 2 }), true);
    const cancelled = await queue().getJob("valkey.ok.2");
    assert.ok(cancelled);
    assert.equal(await waitForFinished(cancelled as Job), "completed");
  });
});

describe("iovalkey with separate queue/worker connections", () => {
  it("uses queueConnection for queues and workerConnection for workers", async () => {
    const queueConnection = createValkeyConnection("valkey-queue");
    const workerConnection = createValkeyConnection("valkey-worker");
    const r = createRouter({ valkeySeparate: { j: defineJob<object>(async () => {})() } });
    const w = setupBullmqRouter(r, { queueConnection, workerConnection, prefix: uniquePrefix("valkey-sep") });

    try {
      assert.equal(QueueManager.getOptions("valkeySeparate")!.connection, queueConnection);
      assert.equal(w.valkeySeparate.opts.connection, workerConnection);

      const job = await r.valkeySeparate.j.push({});
      assert.equal(await waitForFinished(job), "completed");
    } finally {
      await cleanup([QueueManager.getQueue("valkeySeparate")], [w.valkeySeparate]);
    }
  });
});

describe("iovalkey with sandboxed workers", () => {
  it("processes the job in a separate process", async () => {
    const { default: sandboxRouter } = await import("./fixtures/sandbox-router.js");
    const routerPath = fileURLToPath(new URL("./fixtures/sandbox-router-with-connection.ts", import.meta.url));
    const w = setupBullmqRouter(sandboxRouter, {
      connection: createValkeyConnection("valkey-sandbox"),
      prefix: uniquePrefix("valkey-sandbox"),
      sandboxOptions: { routerPath, workers: ["sandboxed"], execArgv: ["--import", "tsx"] },
    });

    try {
      const job = await sandboxRouter.sandboxed.work.push({});
      assert.equal(await waitForFinished(job, 20_000), "completed");
      const { logs } = await QueueManager.getQueue("sandboxed").getJobLogs(job.id!);
      assert.ok(logs.some((l) => l.startsWith("pid=") && l !== `pid=${process.pid}`));
      assert.ok(logs.some((l) => /^jobs=\d+$/.test(l)), `child queue connection unused: ${JSON.stringify(logs)}`);
    } finally {
      await cleanup([QueueManager.getQueue("sandboxed")], [w.sandboxed]);
    }
  });
});
