import { Queue, type QueueOptions } from "bullmq";

class QueueManagerInternal {
  #instances: Record<string, Queue> = {}
  #queueOptions: Record<string, QueueOptions | undefined> = {}

  addOptions(queueName: string, options: QueueOptions) {
    this.#queueOptions[queueName] = options
  }
  
  getOptions(queueName: string) {
    return this.#queueOptions[queueName]
  }
  
  hasOptions(queueName: string) {
    return typeof this.#queueOptions[queueName] !== "undefined"
  }

  getQueue(queueName: string) {
    const queueOptions = this.#queueOptions[queueName]

    if (!queueOptions) {
      throw new Error(`Queue options not found for queue: ${queueName}`)
    }
    
    if (!queueOptions.connection) {
      throw new Error(`Redis connection is not defined for queue: ${queueName}`)
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

