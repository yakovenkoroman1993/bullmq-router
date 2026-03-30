# @yakocloud/bullmq-router

Type-safe file-system-style router for [BullMQ](https://docs.bullmq.io/). Define jobs as leaf nodes in a nested object, get fully typed `push`, `replace`, `cancel`, `exec` and more — automatically wired to the right queue and worker.

## Installation

```bash
npm install @yakocloud/bullmq-router bullmq
```

> `bullmq` is a peer dependency and must be installed separately.

## Quick Start

**1. Define jobs**

```ts
// jobs/email/send.ts
import { defineJob } from '@yakocloud/bullmq-router'

export default defineJob<{ to: string; subject: string }>(async (job) => {
  await sendEmail(job.data)
})()
```

**2. Build the router**

Top-level keys define queue names — each key becomes a separate BullMQ queue. Nested keys are just grouping and don't affect the queue name.

```ts
// router.ts
import { createRouter } from '@yakocloud/bullmq-router'
import send from './jobs/email/send.js'
import invoice from './jobs/email/invoice.js'

export const router = createRouter({
  email: {       // <-- queue name: "email"
    send,        // job name: "email.send"
    invoice,     // job name: "email.invoice"
  },
})
```

> **Best practice:** mirror the router structure in the file system. Each folder exports a `queueRouter` object that composes its children — the file tree becomes the job tree.

```ts
// myJobs/email/path/to/send.ts
export default defineJob<{ text: string }>((job) => {
  console.log(job.data.text)
})()

// myJobs/email/path/to/index.ts
import send from './send.js'
export const queueRouter = { send }

// myJobs/email/path/index.ts
import { queueRouter as to } from './to/index.js'
export const queueRouter = { to }

// myJobs/email/index.ts
import { queueRouter as path } from './path/index.js'
export const queueRouter = { path }

// router.ts
import { queueRouter as email } from './myJobs/email/index.js'
export const router = createRouter({
  email, // queue name: "email", job name: "email.path.to.send"
})
```

**3. Set up workers and queues**

```ts
// setup.ts
import { setupBullmqRouter } from '@yakocloud/bullmq-router'
import { router } from './router.js'

setupBullmqRouter(router, {
  connection: { host: 'localhost', port: 6379 },
})
```

**4. Push jobs**

```ts
import { router } from './router.js'

await router.email.send.push({ to: 'user@example.com', subject: 'Hello' })
```

## API

### `defineJob<T>(pop)(options?)`

Defines a job leaf node.

| Parameter | Type | Description |
|---|---|---|
| `pop` | `(job, jobName, queue) => Promise<void>` | Handler executed when the job is dequeued |
| `options.jobIdComponents` | `(keyof T)[]` | Fields used to build a deterministic job ID |
| `options.logsEnabled` | `true` | Enable verbose console logging |

Returns a job definition object with the following methods:

#### `.push(data, options?)`

Adds a single job to the queue.

```ts
await router.email.send.push({ to: 'user@example.com', subject: 'Hello' })
```

#### `.pushBulk(items)`

Adds multiple jobs in a single batched operation.

```ts
await router.email.send.pushBulk([
  { data: { to: 'a@example.com', subject: 'Hi' } },
  { data: { to: 'b@example.com', subject: 'Hey' } },
])
```

#### `.replace(data, options?)`

Replaces an existing job with the same ID, preserving its logs. If no existing job is found, a new one is created.

```ts
await router.email.send.replace({ to: 'user@example.com', subject: 'Updated' })
```

#### `.cancelDelayedJob(data | jobId)`

Cancels a delayed job by stamping it with a cancellation time and immediately promoting it. The job handler will skip it automatically.

```ts
await router.email.send.cancelDelayedJob({ to: 'user@example.com' })
// or by raw job ID:
await router.email.send.cancelDelayedJob('email.send.user@example.com')
```

Returns `true` if the job was found and cancelled, `false` otherwise.

#### `.getJob(data | jobId)`

Fetches a BullMQ `Job` instance by data or raw job ID. Returns `undefined` if not found.

```ts
const job = await router.email.send.getJob({ to: 'user@example.com' })
```

#### `.getFullJob(data | jobId)`

Fetches a job along with its logs and current state in a single parallel request.

```ts
const job = await router.email.send.getFullJob({ to: 'user@example.com' })
// job.state  — 'waiting' | 'active' | 'completed' | ...
// job.logs   — string[]
```

#### `.exec(data)`

Executes the job handler synchronously, bypassing the queue entirely. Useful for testing or one-off manual runs.

```ts
await router.email.send.exec({ to: 'user@example.com', subject: 'Test' })
```

#### `.toString()`

Returns the fully qualified dot-separated job name (e.g. `email.send`). Job definitions are coercible to strings, so they can be used directly in template literals.

```ts
console.log(`${router.email.send}`) // "email.send"
```

---

### `createRouter<T>(nativeRouter)`

Wraps a nested object of job definitions with a `Proxy` that automatically injects the correct `JOB_PATH` into every leaf node at access time. No manual path configuration needed.

```ts
const router = createRouter({
  email: { send, invoice },
  notifications: { push },
})
```

---

### `setupBullmqRouter(options)`

Registers queues and workers for every top-level key in the router.

| Option | Type | Description |
|---|---|---|
| `router` | `object` | The router created by `createRouter` |
| `connection` | `ConnectionOptions` | Default Redis connection for all queues and workers |
| `prefix` | `string \| undefined` | Default queue prefix for all queues and workers |
| `queueOptions` | `Partial<Record<keyof R, QueueOptions>>` | Per-queue overrides |
| `workerOptions` | `Partial<Record<keyof R, WorkerOptions>>` | Per-worker overrides |

Each top-level key in the router is treated as a separate BullMQ queue name.

---

## Deterministic Job IDs

When `jobIdComponents` is set, the router builds a stable job ID from the job path and the specified data fields:
```
export default defineJob<{ to: string; subject: string }>(async (job) => {
  await sendEmail(job.data)
})({
  jobIdComponents: ["to"]
})

```

```
result ID: "email.send" + "." + "user@example-com"   // sanitized to safe characters
```

This allows deduplication, replacement, and cancellation by data rather than raw ID.

When `jobIdComponents` is omitted, BullMQ generates the ID automatically.

---

## Job Cancellation Pattern

Jobs that are delayed can be cancelled without removing them from the queue. The router stamps the job data with `__cancelledTime__` and promotes the job to the waiting state. When the worker picks it up, the handler detects the stamp and skips processing — the job completes immediately without side effects.

```ts
// Schedule a job with a 10-minute delay
await router.email.send.push(data, { delay: 10 * 60 * 1000 })

// Cancel it before it runs
await router.email.send.cancelDelayedJob(data)
```

---

## License

MIT