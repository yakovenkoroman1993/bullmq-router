import { randomUUID } from "node:crypto";
import type { Job, Queue, Worker } from "bullmq";
import { createClient } from "redis";
import { Redis as Valkey } from "iovalkey";

const REDIS_HOST = process.env.REDIS_HOST ?? "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;

/**
 * Creates an iovalkey client (ioredis-compatible API, which BullMQ wraps with its
 * ioredis adapter). `maxRetriesPerRequest: null` is required for blocking workers.
 */
export function createValkeyConnection(connectionName?: string) {
  return new Valkey({ host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: null, connectionName });
}

/**
 * Creates a connected node-redis client. BullMQ 6 needs a client instance when
 * the optional `ioredis` peer is not installed. Closing a Queue/Worker leaves
 * the client open; the test runner's --test-force-exit takes care of it.
 */
export async function createConnection() {
  const client = createClient({ url: REDIS_URL });
  await client.connect();
  return client;
}

export const connection = await createConnection();

/** Unique, cluster-safe prefix so test runs never collide with each other or real data. */
export const uniquePrefix = (label: string) =>
  `{bullmq-router-test-${label}-${randomUUID().slice(0, 8)}}`;

export async function waitFor<T>(
  fn: () => Promise<T | undefined | false> | T | undefined | false,
  { timeout = 10_000, interval = 25 } = {}
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() - started > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Polls a job until it reaches a terminal state and returns that state. */
export async function waitForFinished(job: Job, timeout = 10_000) {
  return waitFor(
    async () => {
      const state = await job.getState();
      return state === "completed" || state === "failed" ? state : undefined;
    },
    { timeout }
  );
}

export async function cleanup(queues: Queue[], workers: Worker[] = []) {
  await Promise.all(workers.map((w) => w.close(true)));
  for (const queue of queues) {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  }
}
