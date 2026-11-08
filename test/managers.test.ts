import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Queue, Worker } from "bullmq";
import { QueueManager, WorkerManager, SandboxWorkerManager } from "../src/index.js";
import { cleanup, connection, uniquePrefix } from "./helpers.js";

const prefix = uniquePrefix("managers");
const queues: Queue[] = [];
const workers: Worker[] = [];

after(() => cleanup(queues, workers));

describe("QueueManager", () => {
  it("is a process-wide singleton stored on globalThis", () => {
    assert.equal(
      (globalThis as Record<symbol, unknown>)[Symbol.for("bullmq-router.QueueManager")],
      QueueManager
    );
  });

  it("stores and reports options", () => {
    assert.equal(QueueManager.hasOptions("qm-opts"), false);
    assert.equal(QueueManager.getOptions("qm-opts"), undefined);
    QueueManager.addOptions("qm-opts", { connection, prefix });
    assert.equal(QueueManager.hasOptions("qm-opts"), true);
    assert.deepEqual(QueueManager.getOptions("qm-opts"), { connection, prefix });
  });

  it("throws for unknown queues", () => {
    assert.throws(() => QueueManager.getQueue("qm-unknown"), /Queue options not found for queue: qm-unknown/);
  });

  it("throws when connection is missing", () => {
    QueueManager.addOptions("qm-noconn", {} as never);
    assert.throws(() => QueueManager.getQueue("qm-noconn"), /Redis connection is not defined for queue: qm-noconn/);
  });

  it("creates the queue lazily and caches it", () => {
    QueueManager.addOptions("qm-cache", { connection, prefix });
    const q1 = QueueManager.getQueue("qm-cache");
    const q2 = QueueManager.getQueue("qm-cache");
    queues.push(q1);
    assert.ok(q1 instanceof Queue);
    assert.equal(q1, q2);
    assert.equal(q1.name, "qm-cache");
    assert.equal(q1.opts.prefix, prefix);
  });
});

describe("WorkerManager", () => {
  it("throws for unknown queues", () => {
    assert.throws(
      () => WorkerManager.getWorker({ queueName: "wm-unknown", router: {} }),
      /Worker options not found for queue: wm-unknown/
    );
  });

  it("throws when connection is missing", () => {
    WorkerManager.addOptions("wm-noconn", {} as never);
    assert.throws(
      () => WorkerManager.getWorker({ queueName: "wm-noconn", router: {} }),
      /Redis connection is not defined for queue: wm-noconn/
    );
  });

  it("creates the worker once and caches it", () => {
    WorkerManager.addOptions("wm-cache", { connection, prefix, autorun: false });
    const w1 = WorkerManager.getWorker({ queueName: "wm-cache", router: {} });
    const w2 = WorkerManager.getWorker({ queueName: "wm-cache", router: {} });
    workers.push(w1);
    assert.ok(w1 instanceof Worker);
    assert.equal(w1, w2);
    assert.equal(w1.name, "wm-cache");
  });
});

describe("SandboxWorkerManager", () => {
  it("throws for unknown queues", () => {
    assert.throws(
      () => SandboxWorkerManager.getWorker({ queueName: "swm-unknown", routerPath: "x", serializedQueueOptions: "{}" }),
      /Worker options not found for queue: swm-unknown/
    );
  });

  it("throws when connection is missing", () => {
    SandboxWorkerManager.addOptions("swm-noconn", {} as never);
    assert.throws(
      () => SandboxWorkerManager.getWorker({ queueName: "swm-noconn", routerPath: "x", serializedQueueOptions: "{}" }),
      /Redis connection is not defined for queue: swm-noconn/
    );
  });

  it("passes router path, queue name and options to the child via env, keeping user env", () => {
    SandboxWorkerManager.addOptions("swm-env", {
      connection,
      prefix,
      autorun: false,
      workerForkOptions: { env: { CUSTOM: "1" } },
    });
    const worker = SandboxWorkerManager.getWorker({
      queueName: "swm-env",
      routerPath: "/path/to/router.js",
      serializedQueueOptions: '{"a":1}',
      execArgv: ["--import", "tsx"],
    });
    workers.push(worker);

    assert.equal(worker, SandboxWorkerManager.getWorker({ queueName: "swm-env", routerPath: "other", serializedQueueOptions: "" }));

    const { workerForkOptions, workerThreadsOptions } = worker.opts;
    for (const opts of [workerForkOptions, workerThreadsOptions] as Array<{ env?: Record<string, string>; execArgv?: string[] }>) {
      assert.deepEqual(opts.execArgv, ["--import", "tsx"]);
      assert.equal(opts.env?.QUEUE_ROUTER_PATH, "/path/to/router.js");
      assert.equal(opts.env?.QUEUE_NAME, "swm-env");
      assert.equal(opts.env?.QUEUE_OPTIONS, '{"a":1}');
    }
    assert.equal((workerForkOptions as { env: Record<string, string> }).env.CUSTOM, "1");
  });
});
