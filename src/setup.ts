import {
  type QueueOptions,
  type ConnectionOptions,
  type WorkerOptions,
} from "bullmq";
import { QueueManager } from "./queue.js";
import { WorkerManager } from "./worker.js";
import { SandboxWorkerManager } from "./sandbox-worker.js";
import { DEFAULT_WORKER_WRAPPER } from "./constants.js";

export function setupBullmqRouter<R extends object>(
  router: R,
  options: {
    connection: ConnectionOptions,
    prefix?: string,
    workerWrapper?: typeof DEFAULT_WORKER_WRAPPER
    workerOptions?: Partial<Record<keyof R, Partial<WorkerOptions>>>
    queueOptions?: Partial<Record<keyof R, Partial<QueueOptions>>>
    sandboxOptions?: {
      routerPath: string
      workers: (keyof R)[]
      execArgv?: string[]
    }
  }
) {
  const {
    prefix,
    connection,
    workerWrapper,
    queueOptions: queueOptionsVocab,
    workerOptions: workerOptionsVocab,
    sandboxOptions,
  } = options

  const workerVocab = {} as Record<keyof R, ReturnType<typeof WorkerManager.getWorker>>
  
  for (let [queueName] of Object.entries(router)) {
    const queueKey = queueName as keyof R

    const queueOptions = queueOptionsVocab?.[queueKey]
    QueueManager.addOptions(queueName, {
      ...queueOptions,
      prefix: queueOptions?.prefix ?? prefix,
      connection: queueOptions?.connection ?? connection,
    })

    const workerOptions = workerOptionsVocab?.[queueKey]

    let worker: ReturnType<typeof WorkerManager.getWorker>
    
    if (sandboxOptions?.workers.includes(queueKey)) {
      SandboxWorkerManager.addOptions(queueName, {
        ...workerOptions,
        prefix: workerOptions?.prefix ?? prefix,
        connection: workerOptions?.connection ?? connection,
      })

      worker = SandboxWorkerManager.getWorker({
        queueName,
        routerPath: sandboxOptions.routerPath,
        execArgv: sandboxOptions.execArgv,
        serializedQueueOptions: JSON.stringify(QueueManager.getOptions(queueName)),
      });
    } else {
      WorkerManager.addOptions(queueName, {
        ...workerOptions,
        prefix: workerOptions?.prefix ?? prefix,
        connection: workerOptions?.connection ?? connection,
      })
      
      worker = WorkerManager.getWorker({ queueName, router, workerWrapper });
    }

    workerVocab[queueKey] = worker

    worker.on("failed", (job, err) => {
      console.log(
        `[Bullmq Router][Worker for ${queueName}] ${job?.id} failed: ${err.message}`
      );
    });
  }

  return workerVocab
}