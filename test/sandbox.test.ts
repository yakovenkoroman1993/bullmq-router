import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { Worker } from "bullmq";
import { cleanup, connection, uniquePrefix, waitForFinished } from "./helpers.js";

// Must be set before src/sandbox-worker.ts is imported: it picks sandbox.ts vs sandbox.js at load time.
process.env.BULLMQ_ROUTER_NODE_ENV = "development";
// Inherited by the sandboxed child, which builds its own node-redis client.
process.env.SANDBOX_CONNECTION = "node-redis";

const { setupBullmqRouter, QueueManager } = await import("../src/index.js");
const { default: router } = await import("./fixtures/sandbox-router.js");

const routerPath = fileURLToPath(new URL("./fixtures/sandbox-router-with-connection.ts", import.meta.url));

let workers: Record<"sandboxed", Worker>;

before(() => {
  workers = setupBullmqRouter(router, {
    connection,
    prefix: uniquePrefix("sandbox"),
    sandboxOptions: {
      routerPath,
      workers: ["sandboxed"],
      execArgv: ["--import", "tsx"],
    },
  });
});

after(() => cleanup([QueueManager.getQueue("sandboxed")], Object.values(workers)));

describe("sandboxed workers", () => {
  it("processes the job in a separate process", async () => {
    const job = await router.sandboxed.work.push({});
    assert.equal(await waitForFinished(job, 20_000), "completed");

    const { logs } = await QueueManager.getQueue("sandboxed").getJobLogs(job.id!);
    assert.match(logs[0]!, /Started\.$/);
    const pidLog = logs.find((l) => l.startsWith("pid="));
    assert.ok(pidLog, `expected pid log in ${JSON.stringify(logs)}`);
    assert.notEqual(pidLog, `pid=${process.pid}`);
    assert.ok(logs.some((l) => /^jobs=\d+$/.test(l)), `child queue connection unused: ${JSON.stringify(logs)}`);
    assert.match(logs.at(-1)!, /Finished\.$/);
  });

  it("marks the job as failed when the sandboxed handler throws", async () => {
    const job = await router.sandboxed.work.push({ shouldFail: true });
    assert.equal(await waitForFinished(job, 20_000), "failed");
    const failed = await QueueManager.getQueue("sandboxed").getJob(job.id!);
    assert.equal(failed?.failedReason, "sandbox failure");
  });
});
