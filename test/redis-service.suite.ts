import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { Job, Worker } from "bullmq";
import { Cluster, Redis } from "iovalkey";
import { cleanup, uniquePrefix, waitFor, waitForFinished } from "./helpers.js";

// Must be set before src/sandbox-worker.ts is imported: it picks sandbox.ts vs sandbox.js at load time.
process.env.BULLMQ_ROUTER_NODE_ENV = "development";
// Inherited by the sandboxed child, which uses its own RedisService.sharedClient.
process.env.SANDBOX_CONNECTION = "redis-service";

const { createRouter, defineJob, QueueManager, setupBullmqRouter } = await import("../src/index.js");
const { default: RedisService } = await import("./fixtures/redis-service.js");

/**
 * Runs the router against RedisService (test/fixtures/redis-service.ts): the shared
 * lazily-connected iovalkey client for queues, and a dedicated client for workers
 * (bullmq requires `maxRetriesPerRequest: null` on blocking worker connections,
 * which sharedClient doesn't set).
 * Env (REDIS_URL / REDIS_HOST / REDIS_PORT / REDIS_DEFAULT_DB) must be set before calling.
 */
export function redisServiceSuite(options: {
  mode: "standalone" | "cluster";
  skip?: string | false;
  /** Called after all tests, e.g. to stop a spawned cluster node. */
  teardown?: () => Promise<void>;
}) {
  const { mode, skip = false, teardown } = options;

  describe(`RedisService (${mode})`, { skip }, () => {
    const prefix = uniquePrefix(`svc-${mode}`);
    const processed: number[] = [];

    const router = createRouter({
      svc: {
        ok: defineJob<{ n: number }>(async (job) => {
          processed.push(job.data.n);
        })({ jobIdComponents: ["n"] }),
      },
    });

    let workers: Record<"svc", Worker>;
    let statusBeforeSetup: string;
    // createClient() doesn't apply REDIS_DEFAULT_DB (only sharedClient does), so pass it explicitly,
    // otherwise workers listen on db 0 while queues write to REDIS_DEFAULT_DB.
    const workerClient = () =>
      RedisService.createClient({
        maxRetriesPerRequest: null,
        db: process.env.REDIS_DEFAULT_DB ? Number(process.env.REDIS_DEFAULT_DB) : undefined,
      });
    let workerConnection: ReturnType<typeof workerClient>;

    before(() => {
      statusBeforeSetup = RedisService.sharedClient.status;
      workerConnection = workerClient();
      workers = setupBullmqRouter(router, {
        queueConnection: RedisService.sharedClient,
        workerConnection,
        prefix,
      });
    });

    after(async () => {
      try {
        await cleanup([QueueManager.getQueue("svc")], Object.values(workers));
        // bullmq must not close the app's shared client.
        assert.equal(RedisService.sharedClient.status, "ready");
      } finally {
        RedisService.sharedClient.disconnect();
        workerConnection.disconnect();
        await teardown?.();
      }
    });

    it("hands queues the lazy shared client of the expected kind", () => {
      const client = RedisService.sharedClient;
      assert.equal(client, RedisService.sharedClient, "sharedClient is a singleton");
      assert.ok(mode === "cluster" ? client instanceof Cluster : client instanceof Redis);
      assert.equal(statusBeforeSetup, "wait", "lazyConnect: not connected before bullmq uses it");
      assert.equal(QueueManager.getOptions("svc")!.connection, client);
      assert.equal(workers.svc.opts.connection, workerConnection);
    });

    if (mode === "standalone") {
      // A Cluster keeps per-node options under `redisOptions`, so bullmq can't check it there.
      it("rejects sharedClient as a worker connection (maxRetriesPerRequest is not null)", () => {
        const r = createRouter({ svcReject: { j: defineJob<object>(async () => {})() } });
        assert.throws(
          () => setupBullmqRouter(r, { connection: RedisService.sharedClient, prefix: uniquePrefix("svc-reject") }),
          /maxRetriesPerRequest must be null/
        );
      });
    }

    it("processes jobs over the shared client", async () => {
      const job = await router.svc.ok.push({ n: 1 });
      assert.equal(job.id, "svc.ok.1");
      assert.equal(await waitForFinished(job), "completed");
      await waitFor(() => processed.includes(1));
      assert.equal(RedisService.sharedClient.status, "ready");
    });

    it("supports getFullJob, replace and cancelDelayedJob (Lua scripts)", async () => {
      await router.svc.ok.push({ n: 2 }, { delay: 60_000 });
      assert.equal((await router.svc.ok.getFullJob({ n: 2 }))?.state, "delayed");

      const replaced = await router.svc.ok.replace({ n: 2 }, { delay: 60_000 });
      assert.equal(await replaced.getState(), "delayed");

      assert.equal(await router.svc.ok.cancelDelayedJob({ n: 2 }), true);
      const cancelled = await QueueManager.getQueue("svc").getJob("svc.ok.2");
      assert.equal(await waitForFinished(cancelled as Job), "completed");
    });

    if (mode === "standalone") {
      it("stores jobs in REDIS_DEFAULT_DB", async () => {
        const db = Number(process.env.REDIS_DEFAULT_DB);
        const key = `${prefix}:svc:svc.ok.1`;
        const inDb = RedisService.createClient({ db });
        const inDb0 = RedisService.createClient({ db: 0 });
        try {
          assert.equal(await inDb.exists(key), 1);
          assert.equal(await inDb0.exists(key), 0);
        } finally {
          inDb.disconnect();
          inDb0.disconnect();
        }
      });
    }

    it("runs sandboxed workers with the shared client", async () => {
      const { default: sandboxRouter } = await import("./fixtures/sandbox-router.js");
      const routerPath = fileURLToPath(new URL("./fixtures/sandbox-router-with-connection.ts", import.meta.url));
      const sandboxWorkerConnection = workerClient();
      const w = setupBullmqRouter(sandboxRouter, {
        queueConnection: RedisService.sharedClient,
        workerConnection: sandboxWorkerConnection,
        prefix: uniquePrefix(`svc-sandbox-${mode}`),
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
        sandboxWorkerConnection.disconnect();
      }
    });
  });
}
