import * as path from 'path'
import { setupBullmqRouter } from "./index.js";
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { createClient } from "redis";
import router from "./test-router.js";
import { generateContext, runWithContext } from "./test/context.js";

const filename = fileURLToPath(import.meta.url)

// bullmq 6 needs a client instance unless the optional `ioredis` peer is installed.
const connection = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" })
await connection.connect()

const workerVocab = setupBullmqRouter(router, {
  workerWrapper: (processor) => (job) => runWithContext(
    generateContext(),
    () => processor(job)
  ),
  connection,
  prefix: "{bull-test}",
  queueOptions: {
    abcd: {
      defaultJobOptions: {
        removeOnFail: {
          count: 100
        }
      }
    },
    abcd2: {
      defaultJobOptions: {
        attempts: 3
      }
    }
  },
  workerOptions: {
    abcd: {
      concurrency: 1
    },
    abcd2: {
      concurrency: 20
    }
  },
  sandboxOptions: {
    // routerPath: process.env.BULLMQ_ROUTER_NODE_ENV === "development"
    //   ? new URL('./test-router.ts', import.meta.url).pathname
    //   : new URL('./test-router.js', import.meta.url).pathname,
    routerPath: 
      path.join(
        dirname(filename),
        process.env.BULLMQ_ROUTER_NODE_ENV === "development"
          ? "test-router.ts"
          : "test-router.js"
      ),
      
    // Sandboxed workers can't receive the client above; test-router must then
    // provide its own via QueueManager.addOptions(queueName, { connection }).
    // workers: ["abcd"],
    workers: [],
  },
})

workerVocab.abcd.on("active", (job) => {
  console.log("Active job: ", job.name)
})

router.abcd.efgh.push({ a: 1 })
router.abcd2.efgh.push({ a: 111 })
router.abcd.efgh.push({ a: 222 })