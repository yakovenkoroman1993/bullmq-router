import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis } from "iovalkey";

export type ClusterNode = { host: string; port: number; stop: () => Promise<void> };

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });

async function waitUntil(fn: () => Promise<boolean>, timeout = 10_000) {
  const started = Date.now();
  while (!(await fn().catch(() => false))) {
    if (Date.now() - started > timeout) throw new Error("cluster node did not become ready");
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Returns a Valkey/Redis cluster to test against:
 * - REDIS_CLUSTER_HOST/REDIS_CLUSTER_PORT if set (an existing cluster), otherwise
 * - a throwaway single-node cluster spawned from a local valkey-server/redis-server binary, otherwise
 * - undefined, so callers can skip.
 */
export async function getClusterNode(): Promise<ClusterNode | undefined> {
  if (process.env.REDIS_CLUSTER_PORT) {
    return {
      host: process.env.REDIS_CLUSTER_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_CLUSTER_PORT),
      stop: async () => {},
    };
  }

  const bin = ["valkey-server", "redis-server"].find(
    (b) => spawnSync(b, ["--version"], { stdio: "ignore" }).status === 0
  );
  if (!bin) return undefined;

  const port = await freePort();
  // Ephemeral ports are often > 55535, so the default bus port (port + 10000) would overflow.
  const busPort = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "bullmq-router-cluster-"));
  const proc = spawn(
    bin,
    [
      "--port", String(port),
      "--bind", "127.0.0.1",
      "--cluster-enabled", "yes",
      "--cluster-port", String(busPort),
      "--cluster-config-file", join(dir, "nodes.conf"),
      // Without this the node advertises an empty IP and cluster clients can't reach it.
      "--cluster-announce-ip", "127.0.0.1",
      "--save", "",
      "--appendonly", "no",
      "--dir", dir,
    ],
    { stdio: process.env.CLUSTER_DEBUG ? "inherit" : "ignore" }
  );

  const admin = new Redis({ host: "127.0.0.1", port, lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => 100 });
  admin.on("error", () => {}); // connection refused until the server is up
  try {
    await waitUntil(async () => (await admin.ping()) === "PONG");
    await admin.call("CLUSTER", "ADDSLOTSRANGE", "0", "16383");
    await waitUntil(async () => String(await admin.call("CLUSTER", "INFO")).includes("cluster_state:ok"));
  } finally {
    admin.disconnect();
  }

  return {
    host: "127.0.0.1",
    port,
    stop: async () => {
      proc.kill();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
