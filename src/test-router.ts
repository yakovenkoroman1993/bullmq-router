import { defineJob } from "./job.js"
import { JOB_DEFINITION, JOB_PATH, JOB_POP } from "./constants.js"
import { createRouter } from "./router.js"
import testContext from "./test/context.js";

const routerVocab = createRouter({
  abcd: {
    efgh: defineJob<{ a: number }>(async (job) => {
      console.log(`[abcd]: traceId=${testContext.traceId}`)

      console.log("job.data.a", job.data.a)
    })()
  },
  abcd2: {
    efgh: defineJob<{ a: number }>(async (job) => {
      console.log(`[abcd2]: traceId=${testContext.traceId}`)

      console.log("job.data.a", job.data.a)
    })()
  },
})

export default routerVocab