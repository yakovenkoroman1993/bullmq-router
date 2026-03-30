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
    workerOptions?: Partial<Record<keyof R, Partial<WorkerOptions>>>
    queueOptions?: Partial<Record<keyof R, Partial<QueueOptions>>>
  }
) {
  const {
    connection,
    queueOptions,
    workerOptions,
  } = options
  
  for (const [queueName] of Object.entries(router)) {
    QueueManager.addOptions(queueName, {
      ...queueOptions,
      connection: queueOptions?.[queueName as keyof R]?.connection ?? connection
    })

    WorkerManager.addOptions(queueName, {
      ...workerOptions,
      connection: workerOptions?.[queueName as keyof R]?.connection ?? connection
    })

    const worker = WorkerManager.getWorker({ queueName, router });

    worker.on("failed", (job, err) => {
      console.log(
        `[Bullmq Router][Worker for ${queueName}] ${job?.id} failed: ${err.message}`
      );
    });
  }
}