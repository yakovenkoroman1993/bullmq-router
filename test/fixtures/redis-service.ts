// Mirrors the application's RedisService so the router is tested against the
// same client setup: one lazily-connected iovalkey client (standalone when
// REDIS_URL is set, Cluster otherwise) shared by every queue and worker.
import Redis, { Cluster, type RedisOptions } from "iovalkey";

/** Minimal stand-in for the app's `server/utils/console` filter. */
function filterConsole(patterns: string[]) {
  for (const method of ["log", "info", "warn", "error"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (!patterns.some((p) => text.includes(p))) original(...args);
    };
  }
}

// bullmq's connection check reads `maxmemory-policy` off the server and warns
// when it is not `noeviction` (classes/redis-connection.js).
filterConsole(["IMPORTANT! Eviction policy"]);

export default class RedisService {
  private static client: Redis | Cluster | null = null;

  static get sharedClient(): Redis | Cluster {
    if (!this.client) {
      this.client = this.createClient({
        lazyConnect: true,
        db: process.env.REDIS_DEFAULT_DB
          ? Number(process.env.REDIS_DEFAULT_DB)
          : undefined,
      });
    }

    return this.client;
  }

  static createClient(options: RedisOptions = {}) {
    return process.env.REDIS_URL
      ? new Redis(process.env.REDIS_URL, options)
      : new Cluster(
          [
            {
              host: process.env.REDIS_HOST,
              port: Number(process.env.REDIS_PORT),
            },
          ],
          options
        );
  }
}
