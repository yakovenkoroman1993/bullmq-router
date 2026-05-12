import { Worker, type WorkerOptions } from "bullmq";
import { join, dirname } from "node:path"
import { fileURLToPath } from 'node:url'

const filename = fileURLToPath(import.meta.url)

const PROCESSOR_FILE_PATH = join(
  dirname(filename),
  process.env.BULLMQ_ROUTER_NODE_ENV === "development" ? "sandbox.ts" : "sandbox.js"
)

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
      execArgv?: string[]
    }
  ) {
    const { queueName, routerPath, execArgv, serializedQueueOptions } = options
    
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
            execArgv,
            ...workerOptions.workerForkOptions,
            env: Object.assign({}, workerOptions.workerForkOptions?.env, {
              QUEUE_ROUTER_PATH: routerPath,
              QUEUE_NAME: queueName,
              QUEUE_OPTIONS: serializedQueueOptions,
            }),
          },
          workerThreadsOptions: {
            execArgv,
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
  (globalThis as Record<symbol, SandboxWorkerManagerInternal>)[GLOBAL_KEY] ??= new SandboxWorkerManagerInternal()
)
