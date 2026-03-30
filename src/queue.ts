import { Queue, type QueueOptions } from "bullmq";

class QueueManagerInternal {
  #instances: Record<string, Queue> = {}
  #queueOptions: Record<string, QueueOptions | undefined> = {}

  addOptions(queueName: string, options: QueueOptions) {
    this.#queueOptions[queueName] = options
  }

  getQueue(queueName: string) {
    const queueOptions = this.#queueOptions[queueName]

    if (!queueOptions?.connection) {
      throw new Error("Queue connection is not defined")
    }

    if (!this.#instances[queueName]) {
      this.#instances[queueName] = new Queue(queueName, queueOptions);
    }

    return this.#instances[queueName];
  }
}

const GLOBAL_KEY = Symbol.for("bullmq-router.QueueManager")

export const QueueManager = (
  (globalThis as unknown as Record<symbol, QueueManagerInternal>)[GLOBAL_KEY] ??= new QueueManagerInternal()
)

