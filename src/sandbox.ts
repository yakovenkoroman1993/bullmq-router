import { Job } from "bullmq";
import { QueueJobDefinition } from "./job.js";
import { get } from "./utils.js";
import { JOB_POP } from "./constants.js";
import assert from "assert";
import { QueueManager } from "./queue.js";

assert(process.env.QUEUE_NAME, "Make sure that QUEUE_NAME is provided")
const queueName = process.env.QUEUE_NAME;

assert(process.env.QUEUE_ROUTER_PATH, "Make sure that QUEUE_ROUTER_PATH is provided")
const router = await import(process.env.QUEUE_ROUTER_PATH)
  .then((mod) => mod.default)
  .catch((err) => {
    throw new Error(`Failed to load router from "${process.env.QUEUE_ROUTER_PATH}": ${err.message}`)
  })

assert(process.env.QUEUE_OPTIONS, "Make sure that QUEUE_OPTIONS is provided")
const queueOptions = JSON.parse(process.env.QUEUE_OPTIONS)

if (!QueueManager.hasOptions(queueName)) {
  QueueManager.addOptions(queueName, queueOptions)
}

export default async function (job: Job) {
  try {
    const definition = get(router, job.name) as
      | QueueJobDefinition
      | undefined;

    if (!definition) {
      throw new Error(`No definition for job: ${job.name}`);
    }

    await definition[JOB_POP](job);
  } catch (error) {
    console.error(
      `[QueueWorker] [${queueName}] job="${job.name}" error:`,
      error
    );
    throw error; // Important! bullmq marks job as failed
  }
}