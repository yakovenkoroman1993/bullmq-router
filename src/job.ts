import { JOB_CANCELLED_TIME, JOB_DEFINITION, JOB_PATH, JOB_SEPARATOR } from "./constants.js";
import { Job } from "bullmq";
import { QueueManager } from "./queue.js";
import { JOB_POP } from "./constants.js";

type Add = ReturnType<typeof QueueManager.getQueue>["add"];
type AddBulk = ReturnType<typeof QueueManager.getQueue>["addBulk"];
export type QueueJobDefinition = ReturnType<ReturnType<typeof defineJob>>;

/**
 * Factory that registers a job processor and returns a configurator function.
 *
 * @param pop - Async handler executed when a job is picked up from the queue.
 *              Receives the job instance, its dot-separated name, and the queue it belongs to.
 */
export function defineJob<T>(
  pop: (
    job: Job<T>,
    jobName: string, // path to job file separated by dot (queueuName.path.to.this_file)
    queue: ReturnType<typeof QueueManager.getQueue>
  ) => Promise<void>
) {
  /**
   * Configures and returns a job definition object (leaf node in the router tree).
   *
   * @param definitionOptions.logsEnabled      - Enable verbose console logging for this job
   * @param definitionOptions.jobIdComponents  - Data fields used to build a deterministic job ID.
   *                                             When omitted, BullMQ generates the ID automatically.
   */
  return function <K extends keyof T>(
    definitionOptions: {
      logsEnabled?: true;
      jobIdComponents?: K[];
    } = {}
  ) {
    /** Extracts the queue name — the first segment of the dot-separated job path. */
    const genQueueName = (jobName: string) => {
      return jobName.split(JOB_SEPARATOR)[0] ?? "";
    };

    /**
     * Builds a deterministic job ID from the job name and selected data fields.
     * Returns undefined when jobIdComponents is not configured (BullMQ assigns the ID).
     */
    const genJobId = (jobName: string, data: { [key in K]: T[key] }) => {
      if (!definitionOptions.jobIdComponents?.length) {
        return undefined;
      }

      return [
        jobName,
        definitionOptions.jobIdComponents
          .map((key) => data[key] ?? "NA")
          .join(JOB_SEPARATOR),
      ]
        .join(JOB_SEPARATOR)
        .replace(/[^a-zA-Z0-9-._]/g, "-"); // sanitize to safe characters
    };

    /**
     * Resolves a job ID from either a raw string or a data object.
     * Allows callers to look up jobs by ID directly or by the data they were created with.
     */
    const parseJobId = (
      jobName: string,
      data: { [key in K]: T[key] } | string
    ) => {
      if (typeof data === "string") {
        return data;
      }

      return genJobId(jobName, data);
    };

    return {
      [JOB_DEFINITION]: true, // marks this object as a leaf in the router tree
      [JOB_PATH]: "", // placeholder; injected at runtime by injectPaths()

      /** Adds a single job to the queue. */
      push(
        this: {
          [JOB_PATH]: string;
        },
        data: T,
        options?: Parameters<Add>[2]
      ) {
        const jobName = this[JOB_PATH];
        const queueName = genQueueName(jobName);
        const queue = QueueManager.getQueue(queueName);
        const jobId = genJobId(jobName, data);

        return queue.add(jobName, data, {
          jobId,
          ...options,
        });
      },

      /**
       * Replaces an existing job with the same ID.
       * Preserves the original job's logs, appends a replacement entry, then re-adds the job.
       */
      async replace(
        this: {
          [JOB_PATH]: string;
        },
        data: T,
        options?: Parameters<Add>[2]
      ) {
        const jobName = this[JOB_PATH];
        const queueName = genQueueName(jobName);
        const queue = QueueManager.getQueue(queueName);
        const jobId = genJobId(jobName, data);

        const jobLogs: string[] = [];

        if (jobId) {
          const job = await queue.getJob(jobId);

          if (job) {
            const { logs } = await queue.getJobLogs(jobId);

            // Carry over previous logs and record why the job was replaced
            jobLogs.push(
              ...logs,
              `[${new Date().toISOString()}]: Replaced. Previous job: \n${JSON.stringify(
                data,
                null,
                2
              )}`
            );

            try {
              await job.remove();
            } catch (error) {
              console.warn(
                `[Queue] [Job "${jobName}"] already removed.`,
                error
              );
            }
          }
        }

        const job = await queue.add(jobName, data, {
          jobId,
          ...options,
        });

        // Restore accumulated logs on the newly created job
        await Promise.all(jobLogs.map((log) => job.log(log)));

        return job;
      },

      /** Adds multiple jobs to the queue in a single batched operation. */
      pushBulk(
        this: {
          [JOB_PATH]: string;
        },
        data: {
          data: T;
          options?: Parameters<AddBulk>[0][number]["opts"];
        }[]
      ) {
        const jobName = this[JOB_PATH];
        const queueName = genQueueName(jobName);
        const queue = QueueManager.getQueue(queueName);

        return queue.addBulk(
          data.map((item) => ({
            name: jobName,
            data: item.data,
            opts: {
              ...item?.options,
              jobId: genJobId(jobName, item.data),
            },
          }))
        );
      },

      /**
       * Internal BullMQ worker handler — called automatically when a job is dequeued.
       * Skips cancelled jobs (marked with JOB_CANCELLED_TIME) and delegates to `pop`.
       */
      async [JOB_POP](
        this: {
          [JOB_PATH]: string;
        },
        job: Job<T & { [JOB_CANCELLED_TIME]?: string }>
      ) {
        const jobName = this[JOB_PATH];
        const queueName = genQueueName(jobName);
        const queue = QueueManager.getQueue(queueName);

        // Job was cancelled while delayed — acknowledge without processing
        if (job.data[JOB_CANCELLED_TIME]) {
          job.log(
            `[${new Date().toISOString()}]: Ignored. Reason: cancelled at ${
              job.data[JOB_CANCELLED_TIME]
            }`
          );
          if (definitionOptions.logsEnabled) {
            console.log(
              `[Queue] [Job "${jobName}"] ignored. Reason: cancelled at ${job.data[JOB_CANCELLED_TIME]}`,
              job.data
            );
          }

          return; // BullMQ transitions: WAITING -> COMPLETED
        }

        job.log(`[${new Date().toISOString()}]: Started.`);
        if (definitionOptions.logsEnabled) {
          console.log(`[Queue] [Job "${jobName}"] started`, job.data);
        }

        await pop(job, jobName, queue);

        job.log(`[${new Date().toISOString()}]: Finished.`);
        if (definitionOptions.logsEnabled) {
          console.log(`[Queue] [Job "${jobName}"] finished`, job.data);
        }
      },

      /**
       * Executes the job handler synchronously (bypasses the queue entirely).
       * Useful for testing or one-off manual runs.
       */
      async exec(
        this: {
          [JOB_PATH]: string;
        },
        data: T
      ) {
        const jobName = this[JOB_PATH];
        const queueName = genQueueName(jobName);
        const queue = QueueManager.getQueue(queueName);

        await pop(
          new Job(
            queue as unknown as ConstructorParameters<typeof Job>[0],
            jobName,
            data
          ),
          jobName,
          queue
        );
      },

      /** Fetches a job instance by its data or a raw job ID. Returns undefined if not found. */
      getJob(
        this: {
          [JOB_PATH]: string;
        },
        data: { [key in K]: T[key] } | string
      ): Promise<Job<T> | undefined> {
        const jobName = this[JOB_PATH];
        const queueName = genQueueName(jobName);
        const queue = QueueManager.getQueue(queueName);

        const jobId = parseJobId(jobName, data);

        if (!jobId) {
          return Promise.resolve(undefined);
        }

        return queue.getJob(jobId);
      },

      /**
       * Fetches a job along with its logs and current state in a single parallel request.
       * Returns undefined if the job does not exist.
       */
      async getFullJob(
        this: {
          [JOB_PATH]: string;
        },
        data: { [key in K]: T[key] } | string
      ) {
        const jobName = this[JOB_PATH];
        const queueName = genQueueName(jobName);
        const queue = QueueManager.getQueue(queueName);
        const jobId = parseJobId(jobName, data);

        if (!jobId) {
          return undefined;
        }

        const [job, logs, state] = await Promise.all([
          queue.getJob(jobId),
          queue.getJobLogs(jobId).then(({ logs }) => logs),
          queue.getJobState(jobId),
        ] as const);

        if (!job) {
          return undefined;
        }

        return Object.assign(job, {
          state,
          logs,
        });
      },

      /**
       * Cancels a delayed job by stamping it with a cancellation timestamp
       * and promoting it so BullMQ processes (and immediately skips) it.
       *
       * @returns true if the job was found and successfully cancelled, false otherwise.
       */
      async cancelDelayedJob(
        this: {
          [JOB_PATH]: string;
        },
        data: { [key in K]: T[key] } | string
      ): Promise<boolean> {
        const jobName = this[JOB_PATH];
        const queueName = genQueueName(jobName);
        const queue = QueueManager.getQueue(queueName);

        const jobId = parseJobId(jobName, data);

        if (!jobId) {
          return false;
        }

        const job = await queue.getJob(jobId);

        if (!job) {
          return false;
        }

        const isDelayed = await job.isDelayed();

        // Only delayed jobs can be cancelled this way
        if (!isDelayed) {
          return false;
        }

        const cancelledTime = new Date().toISOString();

        // Mark the job as cancelled so JOB_POP skips it when promoted
        await job.updateData({
          ...job.data,
          [JOB_CANCELLED_TIME]: cancelledTime,
        });

        job.log(`[${new Date().toISOString()}]: Cancelled at ${cancelledTime}`);

        try {
          await job.promote(); // force transition: DELAYED -> WAITING -> COMPLETED
        } catch (error) {
          console.warn(
            `[Queue] [Job "${jobName}"] job promoting failed. `,
            error
          );
        }

        return true;
      },

      /** Returns the fully qualified job name (dot-separated path). */
      toString(this: { [JOB_PATH]: string }) {
        return this[JOB_PATH];
      },
    };
  };
}