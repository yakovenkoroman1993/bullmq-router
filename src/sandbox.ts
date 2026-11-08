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

// Options set by the router module in this process win; the parent's serialized
// options fill the gaps. Client instances can't be serialized, so when the parent
// uses one, the router module must provide `connection` (e.g. its own client).
QueueManager.addOptions(queueName, { ...queueOptions, ...QueueManager.getOptions(queueName) })

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