import {
  type QueueOptions,
  type ConnectionOptions,
  type WorkerOptions
} from "bullmq";
import { QueueManager } from "./queue.js";
import { WorkerManager } from "./worker.js";

export function setupBullmqRouter<R extends object>(
  router: R,
  options: {
    connection: ConnectionOptions,
    prefix?: string,
    workerOptions?: Partial<Record<keyof R, Partial<WorkerOptions>>>
    queueOptions?: Partial<Record<keyof R, Partial<QueueOptions>>>
  }
) {
  const {
    prefix,
    connection,
    queueOptions: queueOptionsMap,
    workerOptions: workerOptionsMap,
  } = options
  
  for (const [queueName] of Object.entries(router)) {
    const queueOptions = queueOptionsMap?.[queueName as keyof R]

    QueueManager.addOptions(queueName, {
      ...queueOptionsMap,
      prefix: queueOptions?.prefix ?? prefix,
      connection: queueOptions?.connection ?? connection,
    })

    const workerOptions = workerOptionsMap?.[queueName as keyof R]
    WorkerManager.addOptions(queueName, {
      ...workerOptionsMap,
      prefix: workerOptions?.prefix ?? prefix,
      connection: workerOptions?.connection ?? connection,
    })

    const worker = WorkerManager.getWorker({ queueName, router });

    worker.on("failed", (job, err) => {
      console.log(
        `[Bullmq Router][Worker for ${queueName}] ${job?.id} failed: ${err.message}`
      );
    });
  }
}