import * as path from 'path'
import { setupBullmqRouter } from "./index.js";
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import router from "./test-router.js";

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const workerVocab = setupBullmqRouter(router, {
  connection: {
    host: "localhost",
    port: 6381
  },
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
    // routerPath: process.env.NODE_ENV === "development"
    //   ? new URL('./test-router.ts', import.meta.url).pathname
    //   : new URL('./test-router.js', import.meta.url).pathname,
    routerPath: process.env.NODE_ENV === "development"
      ? path.join(__dirname, 'test-router.ts')
      : path.join(__dirname, 'test-router.js'),
    workers: ["abcd"],
  },
})

workerVocab.abcd.on("active", (job) => {
  console.log("Active job: ", job.name)
})

router.abcd.efgh.push({ a: 1 })
router.abcd2.efgh.push({ a: 111 })
router.abcd.efgh.push({ a: 222 })