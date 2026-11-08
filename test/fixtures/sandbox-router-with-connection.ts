// Router module loaded inside the sandboxed child process. A parent's client
// instance can't cross the process boundary, so the child creates its own
// connection of the kind named by SANDBOX_CONNECTION (inherited from the parent's
// env); prefix and other queue options still come from the parent.
import { QueueManager } from "../../src/index.js";
import { createConnection, createValkeyConnection } from "../helpers.js";
import RedisService from "./redis-service.js";
import router from "./sandbox-router.js";

const factories = {
  "node-redis": () => createConnection(),
  iovalkey: () => createValkeyConnection("sandbox-child"),
  "redis-service": () => RedisService.sharedClient,
};

const kind = process.env.SANDBOX_CONNECTION as keyof typeof factories | undefined;
if (!kind || !(kind in factories)) {
  throw new Error(`SANDBOX_CONNECTION must be one of: ${Object.keys(factories).join(", ")}`);
}

QueueManager.addOptions("sandboxed", { connection: await factories[kind]() });

export default router;
