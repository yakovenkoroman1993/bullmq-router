import { after, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Job, Worker } from "bullmq";
import { createRouter, defineJob, QueueManager, setupBullmqRouter } from "../src/index.js";
import { cleanup, connection, createConnection, uniquePrefix, waitFor, waitForFinished } from "./helpers.js";

const prefix = uniquePrefix("setup");
const otherPrefix = uniquePrefix("setup-other");

const calls: Array<{ name: string; data: unknown; ctx: string | undefined }> = [];
const als = new AsyncLocalStorage<string>();

const router = createRouter({
  main: {
    ok: defineJob<{ n: number }>(async (job, name) => {
      calls.push({ name, data: job.data, ctx: als.getStore() });
    })({ jobIdComponents: ["n"] }),
    nested: {
      fail: defineJob<{ n: number }>(async () => {
        throw new Error("handler failed");
      })(),
    },
  },
  secondary: {
    ok: defineJob<{ n: number }>(async (job, name) => {
      calls.push({ name, data: job.data, ctx: als.getStore() });
    })(),
  },
});

const wrapper = mock.fn((processor: (job: Job) => Promise<unknown>) => (job: Job) =>
  als.run(`ctx:${job.name}`, () => processor(job))
);

const workers = setupBullmqRouter(router, {
  connection,
  prefix,
  workerWrapper: wrapper as never,
  queueOptions: {
    main: { defaultJobOptions: { attempts: 1, removeOnFail: false } },
    secondary: { prefix: otherPrefix },
  },
  workerOptions: {
    main: { concurrency: 3 },
    secondary: { prefix: otherPrefix },
  },
});

const allWorkers = Object.values(workers) as Worker[];
after(() => cleanup([QueueManager.getQueue("main"), QueueManager.getQueue("secondary")], allWorkers));

describe("setupBullmqRouter", () => {
  it("returns one worker per top-level router key", () => {
    assert.deepEqual(Object.keys(workers).sort(), ["main", "secondary"]);
    assert.equal(workers.main.name, "main");
    assert.equal(workers.secondary.name, "secondary");
  });

  it("merges global and per-queue options", () => {
    const main = QueueManager.getOptions("main")!;
    assert.equal(main.prefix, prefix);
    assert.equal(main.connection, connection);
    assert.deepEqual(main.defaultJobOptions, { attempts: 1, removeOnFail: false });

    assert.equal(QueueManager.getOptions("secondary")!.prefix, otherPrefix);

    assert.equal(workers.main.opts.concurrency, 3);
    assert.equal(workers.main.opts.prefix, prefix);
    assert.equal(workers.secondary.opts.prefix, otherPrefix);
  });

  it("wraps each worker processor with workerWrapper", () => {
    assert.equal(wrapper.mock.callCount(), 2);
  });

  it("processes pushed jobs through the routed handler inside the wrapper", async () => {
    const job = await router.main.ok.push({ n: 1 });
    assert.equal(await waitForFinished(job), "completed");

    const call = calls.find((c) => c.name === "main.ok");
    assert.deepEqual(call, { name: "main.ok", data: { n: 1 }, ctx: "ctx:main.ok" });

    const { logs } = await QueueManager.getQueue("main").getJobLogs(job.id!);
    assert.equal(logs.length, 2);
  });

  it("routes jobs of a queue with a custom prefix", async () => {
    const job = await router.secondary.ok.push({ n: 2 });
    assert.equal(await waitForFinished(job), "completed");
    assert.ok(calls.some((c) => c.name === "secondary.ok"));
  });

  it("marks the job as failed when the handler throws", async () => {
    const errorSpy = mock.method(console, "error", () => {});
    try {
      const job = await router.main.nested.fail.push({ n: 3 });
      assert.equal(await waitForFinished(job), "failed");
      const failed = await QueueManager.getQueue("main").getJob(job.id!);
      assert.equal(failed?.failedReason, "handler failed");
      assert.ok(errorSpy.mock.calls.some((c) => String(c.arguments[0]).includes('job="main.nested.fail"')));
    } finally {
      errorSpy.mock.restore();
    }
  });

  it("fails jobs whose name has no definition in the router", async () => {
    const errorSpy = mock.method(console, "error", () => {});
    try {
      const job = await QueueManager.getQueue("main").add("main.unknown", {});
      assert.equal(await waitForFinished(job), "failed");
      const failed = await QueueManager.getQueue("main").getJob(job.id!);
      assert.equal(failed?.failedReason, "No definition for job: main.unknown");
    } finally {
      errorSpy.mock.restore();
    }
  });

  it("completes a cancelled delayed job without running the handler", async () => {
    const before = calls.length;
    const job = await router.main.ok.push({ n: 4 }, { delay: 60_000 });
    assert.equal(await router.main.ok.cancelDelayedJob({ n: 4 }), true);

    assert.equal(await waitForFinished(job), "completed");
    assert.equal(calls.length, before);

    const full = await router.main.ok.getFullJob({ n: 4 });
    assert.equal(full?.state, "completed");
    assert.ok(full?.logs.some((l) => l.includes("Cancelled at")));
    assert.ok(full?.logs.some((l) => l.includes("Ignored.")));
  });

  it("processes jobs added with pushBulk", async () => {
    const jobs = await router.main.ok.pushBulk([{ data: { n: 10 } }, { data: { n: 11 } }]);
    const states = await Promise.all(jobs.map((j) => waitForFinished(j)));
    assert.deepEqual(states, ["completed", "completed"]);
    await waitFor(() => [10, 11].every((n) => calls.some((c) => (c.data as { n: number }).n === n)));
  });
});

describe("setupBullmqRouter with separate queue/worker connections", () => {
  it("uses queueConnection for queues and workerConnection for workers", async () => {
    const sepPrefix = uniquePrefix("setup-sep");
    const r = createRouter({ separate: { j: defineJob<object>(async () => {})() } });
    const queueConnection = await createConnection();
    const workerConnection = await createConnection();

    const w = setupBullmqRouter(r, { queueConnection, workerConnection, prefix: sepPrefix });

    try {
      assert.equal(QueueManager.getOptions("separate")!.connection, queueConnection);
      assert.equal(w.separate.opts.connection, workerConnection);

      const job = await r.separate.j.push({});
      assert.equal(await waitForFinished(job), "completed");
    } finally {
      await cleanup([QueueManager.getQueue("separate")], [w.separate]);
    }
  });

  it("per-queue connection overrides the global ones", async () => {
    const r = createRouter({ override: { j: defineJob<object>(async () => {})() } });
    const custom = await createConnection();
    const w = setupBullmqRouter(r, {
      connection,
      prefix: uniquePrefix("setup-override"),
      queueOptions: { override: { connection: custom } },
      workerOptions: { override: { connection: custom, autorun: false } },
    });
    after(() => cleanup([QueueManager.getQueue("override")], [w.override]));

    assert.equal(QueueManager.getOptions("override")!.connection, custom);
    assert.equal(w.override.opts.connection, custom);
  });
});
