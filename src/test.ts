import { createRouter, defineJob, setupBullmqRouter } from "./index.js";

const router = createRouter({
  abcd: {
    efgh: defineJob<{ a: 1 }>(async (job) => {
      job.data.a
    })()
  },
  abcd2: {
    efgh: defineJob<{ a: 1 }>(async (job) => {
      job.data.a
    })()
  },
})

setupBullmqRouter(router, {
  connection: {},
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
  }
})