import {
  type QueueOptions,
  type ConnectionOptions,
  type WorkerOptions
} from "bullmq";
import { QueueManager } from "./queue.js";
import { WorkerManager } from "./worker.js";
import { SandboxWorkerManager } from "./sandbox-worker.js";

export function setupBullmqRouter<R extends object>(
  router: R,
  options: {
    connection: ConnectionOptions,
    prefix?: string,
    workerOptions?: Partial<Record<keyof R, Partial<WorkerOptions>>>
    queueOptions?: Partial<Record<keyof R, Partial<QueueOptions>>>
    sandboxOptions?: {
      routerPath: string
      workers: (keyof R)[]
    }
  }
) {
  const {
    prefix,
    connection,
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
        serializedQueueOptions: JSON.stringify(QueueManager.getOptions(queueName)),
      });
    } else {
      WorkerManager.addOptions(queueName, {
        ...workerOptions,
        prefix: workerOptions?.prefix ?? prefix,
        connection: workerOptions?.connection ?? connection,
      })
      
      worker = WorkerManager.getWorker({ queueName, router });
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