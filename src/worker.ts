import { get } from "./utils.js";
import { DEFAULT_WORKER_WRAPPER, JOB_POP } from "./constants.js";
import { Worker, type WorkerOptions } from "bullmq";
import { type QueueJobDefinition } from "./job.js";

export class WorkerManagerInternal {
  #instances: Record<string, Worker> = {}

  #workerOptions: Record<string, WorkerOptions | undefined> = {}

  addOptions(queueName: string, options: WorkerOptions) {
    this.#workerOptions[queueName] = options
  }

  getWorker<R extends object>(
    options: {
      workerWrapper?: typeof DEFAULT_WORKER_WRAPPER
      queueName: string
      router: R
    }
  ) {
    const {
      queueName,
      router,
      workerWrapper = DEFAULT_WORKER_WRAPPER
    } = options
    
    const workerOptions = this.#workerOptions[queueName]

    if (!workerOptions) {
      throw new Error(`Worker options not found for queue: ${queueName}`)
    }
    
    if (!workerOptions.connection) {
      throw new Error(`Redis connection is not defined for queue: ${queueName}`)
    }

    if (!this.#instances[queueName]) {
      this.#instances[queueName] = new Worker(
        queueName,
        workerWrapper(async (job) => {
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
        }),
        workerOptions
      );
    }

    return this.#instances[queueName];
  }
}

const GLOBAL_KEY = Symbol.for("bullmq-router.WorkerManager")

export const WorkerManager = (
  (globalThis as Record<symbol, WorkerManagerInternal>)[GLOBAL_KEY] ??= new WorkerManagerInternal()
)
