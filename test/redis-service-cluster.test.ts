// RedisService in cluster mode: no REDIS_URL, so it creates `new Cluster([{ REDIS_HOST, REDIS_PORT }])`.
// Uses REDIS_CLUSTER_HOST/REDIS_CLUSTER_PORT if set, else spawns a local single-node cluster, else skips.
import { getClusterNode } from "./cluster.js";

const node = await getClusterNode();

delete process.env.REDIS_URL;
delete process.env.REDIS_DEFAULT_DB; // cluster mode only has db 0
if (node) {
  process.env.REDIS_HOST = node.host;
  process.env.REDIS_PORT = String(node.port);
}

const { redisServiceSuite } = await import("./redis-service.suite.js");

redisServiceSuite({
  mode: "cluster",
  skip: node ? false : "no cluster: set REDIS_CLUSTER_HOST/REDIS_CLUSTER_PORT or install valkey-server/redis-server",
  teardown: node?.stop,
});
