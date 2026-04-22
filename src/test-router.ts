import { defineJob } from "./job.js"
import { JOB_DEFINITION, JOB_PATH, JOB_POP } from "./constants.js"
import { createRouter } from "./router.js"

const routerVocab = createRouter({
  abcd: {
    efgh: defineJob<{ a: number }>(async (job) => {
      console.log("job.data.a", job.data.a)
    })()
  },
  abcd2: {
    efgh: defineJob<{ a: number }>(async (job) => {
      console.log("job.data.a", job.data.a)
    })()
  },
})

export default routerVocab