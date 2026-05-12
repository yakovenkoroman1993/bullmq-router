import { Job, Processor } from "bullmq";

export const JOB_POP = Symbol.for("job-pop");
export const JOB_DEFINITION = Symbol("job-definition");
export const JOB_PATH = Symbol("job-path");
export const JOB_CANCELLED_TIME = "__cancelledTime__";
export const JOB_SEPARATOR = ".";

export const DEFAULT_WORKER_WRAPPER = (processor: Processor) => (job: Job) => processor(job)