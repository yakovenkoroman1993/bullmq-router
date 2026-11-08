// RedisService in standalone mode: REDIS_URL is set, so it creates `new Redis(REDIS_URL)`.
process.env.REDIS_URL = `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? 6379}`;
process.env.REDIS_DEFAULT_DB = "2";

const { redisServiceSuite } = await import("./redis-service.suite.js");

redisServiceSuite({ mode: "standalone" });
