
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [3.0.1] - 2026-11-08

### Changed

- **Breaking:** peer dependency `bullmq` raised from `^5.71.1` to `^6.7.1`. In bullmq 6, `ioredis` is an optional peer and is no longer installed. Without it, plain connection options (`{ host, port }`) don't work; pass an already-created client instead, such as [node-redis](https://github.com/redis/node-redis) (`redis` ≥ 5), [iovalkey](https://github.com/valkey-io/iovalkey) (`Redis` or `Cluster`), or ioredis if you install it yourself
  ```ts
  import { createClient } from "redis"

  const connection = createClient({ url: "redis://localhost:6379" })
  await connection.connect()

  setupBullmqRouter(router, { connection })
  ```
- Worker connections that are client instances must set `maxRetriesPerRequest: null`, or bullmq throws `Your redis options maxRetriesPerRequest must be null`. A common setup is a shared client for queues and a dedicated client for workers, passed as `queueConnection` + `workerConnection`
- Sandboxed workers: `connection` is no longer sent to the child process when it is a client instance, because a client can't be serialized (an iovalkey `Cluster` previously made `setupBullmqRouter` throw `Converting circular structure to JSON`). The router module loaded in the child must provide the connection itself; the parent's other queue options (such as `prefix`) still apply
  ```ts
  // router module passed as sandboxOptions.routerPath
  QueueManager.addOptions("my-queue", { connection: createRedisClient() })

  export default router
  ```
- Sandboxed workers: queue options the router module sets in the child now take priority, and the parent's serialized options fill in the rest. Previously, options set in the child replaced the parent's entirely, so `prefix` was lost

### Fixed

- Sandboxed workers now inherit the parent's environment variables. Previously the child got only `QUEUE_ROUTER_PATH`, `QUEUE_NAME` and `QUEUE_OPTIONS`, with no `PATH`, `REDIS_URL`, `NODE_ENV`, etc.
- `tsconfig.json` sets `"types": ["node"]`, since TypeScript 7 no longer includes `@types/*` automatically and the build failed

---

## [2.2.7] - 2026-10-19

### Fixed

- `getJob()` without `jobIdComponents` now returns the first delayed job with the same name, instead of always returning `undefined`

### Changed

- Upgraded TypeScript to 7.0.2

---

## [2.2.5] - 2026-06-09

### Added

- `queueConnection` and `workerConnection` options in `setupBullmqRouter` — allows separate Redis connections for queues and workers; either pass a single `connection` (shared) or both `queueConnection` + `workerConnection` (exclusive, enforced at the type level)
  ```ts
  setupBullmqRouter(router, {
    queueConnection: redisForQueues,
    workerConnection: redisForWorkers,
  })
  ```

---

## [2.2.4] - 2026-05-12

### Removed

- Automatic `SIGINT`/`SIGTERM` handlers and `gracefulShutdown` helper that were added in 2.2.3 — registering process signals inside a library is an anti-pattern; consumers should call `worker.close()` themselves

## [2.2.3] - 2026-05-12

### Added

- `gracefulShutdown` helper: `setupBullmqRouter` now registers `SIGINT`/`SIGTERM` handlers that close all workers in sequence and call `process.exit(0)` (reverted in 2.2.4)

## [2.2.1] - 2026-05-12

### Added

- `workerWrapper` option in `setupBullmqRouter` — a function that wraps the BullMQ job processor, enabling `AsyncLocalStorage` context propagation and similar middleware patterns
  ```ts
  const workers = setupBullmqRouter(router, {
    connection,
    workerWrapper: (processor) => (job) =>
      asyncLocalStorage.run(store, () => processor(job)),
  })
  ```

---

## [2.1.1] - 2026-04-23

### Fixed

- `__filename` / `__dirname` replaced with `fileURLToPath(import.meta.url)` / `dirname(...)` in `main.ts` and `sandbox-worker.ts` — resolves `SyntaxError: Identifier '__dirname' has already been declared` when running under Jest with `--experimental-vm-modules`

## [2.1.0] - 2026-04-23

### Changed

- Removed debug `console.warn` statements from `sandbox.ts` that were accidentally left in during 2.0.5 development

---

## [2.0.6] - 2026-04-22

### Fixed

- `JOB_POP` constant changed from `Symbol("job-pop")` to `Symbol.for("job-pop")` — fixes job dispatch failures when multiple copies of the package are loaded in the same process (e.g. when sandbox workers share a module registry with the host process)

## [2.0.5] - 2026-04-22

_Internal debug build — `console.warn` statements temporarily left in `sandbox.ts` (cleaned up in 2.1.0)._

## [2.0.4] - 2026-04-22

### Added

- `execArgv` option inside `sandboxOptions` — passed through to `workerForkOptions` and `workerThreadsOptions` of sandbox workers, enabling custom Node.js flags (e.g. `--loader`, `--experimental-specifier-resolution`)
  ```ts
  sandboxOptions: {
    routerPath: '...',
    workers: ['email'],
    execArgv: ['--loader', 'ts-node/esm'],
  }
  ```

## [2.0.3] - 2026-04-22

### Changed

- Environment variable for detecting dev mode renamed from `NODE_ENV` to `BULLMQ_ROUTER_NODE_ENV` — avoids collisions with the application's own `NODE_ENV`

## [2.0.1] - 2026-04-22

### ⚠ Breaking Changes

- `setupBullmqRouter` now takes `router` as its first positional argument, followed by `options`
  ```ts
  // Before (≤ 1.x)
  setupBullmqRouter({ router, connection, ... })

  // After (2.x)
  setupBullmqRouter(router, { connection, ... })
  ```

- `setupBullmqRouter` now returns `Record<keyof R, Worker>` — one BullMQ `Worker` per top-level queue key
  ```ts
  const workers = setupBullmqRouter(router, { connection })

  workers.email.on('completed', (job) => console.log(job.id, 'done'))

  await Promise.all(Object.values(workers).map(w => w.close()))
  ```

- `defineJob` option `logsEnabled` removed — verbose job logging is no longer built into the runner; attach event listeners on the returned `Worker` instance instead

### Added

- **Sandbox workers** via new `sandboxOptions` in `setupBullmqRouter` — selected queues run each job in an isolated child process using BullMQ's [sandboxed processor](https://docs.bullmq.io/guide/workers/sandboxed-processors)
  | Field | Type | Description |
  |---|---|---|
  | `routerPath` | `string` | Absolute path to the file that exports the router as default |
  | `workers` | `(keyof R)[]` | Queue names to run sandboxed; others remain in-process |

- `SandboxWorkerManager` exported from the package

### Changed

- `QueueManager.getQueue` and `WorkerManager.getWorker` now throw distinct descriptive errors (missing options vs. missing connection)
- `QueueManager` gains two new methods used internally by sandbox workers: `getOptions(queueName)` and `hasOptions(queueName)`
- `dev` script now runs TypeScript sources directly via `tsx` without a prior build step

---

## [1.0.12] - 2026-04-01

### Fixed

- `setupBullmqRouter` now correctly spreads per-queue `queueOptions` and `workerOptions` when registering each queue and worker (previously passed the entire options map instead of the per-queue slice)

## [1.0.10] - 2026-04-01

### Changed

- License changed from `UNLICENSED` to `MIT`

---

## [1.0.7] - 2026-03-30

### Fixed

- `FullJob` type corrected to `NonNullable<Awaited<ReturnType<...>>>` — was missing both `Awaited` (type was inferred as a `Promise`) and `NonNullable` (could include `null`)

## [1.0.6] - 2026-03-30

### Added

- `FullJob` type exported from the package — the fully resolved BullMQ `Job` type returned by `getFullJob()`

## [1.0.5] - 2026-03-30

### Changed

- `QueueManager` and `WorkerManager` are now stored as singletons on `globalThis` via `Symbol.for` — prevents duplicate instances and stale state when multiple copies of the package are loaded in the same process

## [1.0.4] - 2026-03-30

### Added

- `prefix` option in `setupBullmqRouter` — sets a default BullMQ key prefix for all queues and workers; can be overridden per-queue via `queueOptions` / `workerOptions`

### Fixed

- Per-queue options are now resolved before merging, so only the relevant queue's overrides are applied (not the full options map)

## [1.0.2] - 2026-03-30

### ⚠ Breaking Changes

- `setupBullmqRouter` signature changed: `router` is now the first positional argument instead of a property inside the options object
- `workerOptions` and `queueOptions` are now optional

### Added

- `type-check` npm script (`tsc --project tsconfig.json`)

### Changed

- `QueueManager` and `WorkerManager` changed from default to named exports and added to the public API (`index.ts`)

### Fixed

- Safe optional chaining on `queueOptions` and `workerOptions` when resolving per-queue connection overrides

## [1.0.1] - 2026-03-30

### Added

- `defineJob<T>(pop)(options?)` — defines a typed job leaf node with an async handler; supports `jobIdComponents` for deterministic job IDs
- `createRouter(nativeRouter)` — wraps a nested job object with a `Proxy` that injects dot-separated queue paths into every leaf node at access time
- `setupBullmqRouter(options)` — registers BullMQ queues and workers for every top-level router key; accepts per-queue and per-worker connection overrides
- Job methods on every leaf node: `push`, `pushBulk`, `replace`, `cancelDelayedJob`, `getJob`, `getFullJob`, `exec`, `toString`
- Cancellation pattern via `__cancelledTime__` stamp — cancelled delayed jobs are silently skipped by the worker without side effects
- `QueueManager` — singleton that lazily instantiates and caches `Queue` instances per queue name
- `WorkerManager` — singleton that lazily instantiates and caches `Worker` instances per queue name; routes incoming jobs to the correct leaf handler via dot-path lookup
- `get(obj, path, defaultValue?)` utility for safe dot-path traversal of the router tree
