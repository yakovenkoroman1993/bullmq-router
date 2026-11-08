import { createRouter, defineJob } from "../../src/index.js";

export default createRouter({
  sandboxed: {
    work: defineJob<{ shouldFail?: boolean }>(async (job, _name, queue) => {
      if (job.data.shouldFail) {
        throw new Error("sandbox failure");
      }
      await job.log(`pid=${process.pid}`);
      // Exercises the child's own queue connection (job.log goes over IPC).
      await job.log(`jobs=${await queue.count()}`);
    })(),
  },
});
