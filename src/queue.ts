import { Queue, type QueueOptions } from "bullmq";

export class QueueManager{
  static #instances: Record<string, Queue> = {}

  static #queueOptions: Record<string, QueueOptions | undefined> = {}

  static addOptions(queueName: string, options: QueueOptions) {
    this.#queueOptions[queueName] = options
  }
  
  static getQueue(queueName: string) {
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
