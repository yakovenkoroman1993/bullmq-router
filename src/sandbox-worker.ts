import { Worker, type WorkerOptions } from "bullmq";
import { join, dirname } from "node:path"
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let PROCESSOR_FILE_PATH: string
if (process.env.NODE_ENV === "development") {
  PROCESSOR_FILE_PATH = join(__dirname, "sandbox.ts")
} else {
  PROCESSOR_FILE_PATH = join(__dirname, "sandbox.js")
}

export class SandboxWorkerManagerInternal {
  #instances: Record<string, Worker> = {}

  #workerOptions: Record<string, WorkerOptions | undefined> = {}

  addOptions(queueName: string, options: WorkerOptions) {
    this.#workerOptions[queueName] = options
  }

  getWorker(
    options: {
      queueName: string
      routerPath: string
      serializedQueueOptions: string
    }
  ) {
    const { queueName, routerPath, serializedQueueOptions } = options
    
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
        PROCESSOR_FILE_PATH,
        {
          ...workerOptions,
          workerForkOptions: {
            ...workerOptions.workerForkOptions,
            env: Object.assign({}, workerOptions.workerForkOptions?.env, {
              QUEUE_ROUTER_PATH: routerPath,
              QUEUE_NAME: queueName,
              QUEUE_OPTIONS: serializedQueueOptions,
            }),
          },
          workerThreadsOptions: {
            ...workerOptions.workerThreadsOptions,
            env: Object.assign({}, workerOptions.workerThreadsOptions?.env, {
              QUEUE_ROUTER_PATH: routerPath,
              QUEUE_NAME: queueName,
              QUEUE_OPTIONS: serializedQueueOptions,
            }),
          },
        },
      );
    }

    return this.#instances[queueName];
  }
}

const GLOBAL_KEY = Symbol.for("bullmq-router.SandboxWorkerManager")

export const SandboxWorkerManager = (
  (globalThis as unknown as Record<symbol, SandboxWorkerManagerInternal>)[GLOBAL_KEY] ??= new SandboxWorkerManagerInternal()
)
