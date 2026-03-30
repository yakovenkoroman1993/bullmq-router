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
      skipMetasUpdate: true
    },
    abcd2: {
      defaultJobOptions: {
        
      }
    }
  },
  workerOptions: {
    abcd: {},
    abcd2: {}
  }
})