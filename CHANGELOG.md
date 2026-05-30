
# Changelog

All notable changes to this project will be documented in this file.



## [2.1.1] - 2026-05-30
 
### Changed
 
- `__filename` / `__dirname` replaced with `filename` / `dirname(filename)` in `main.ts` and `sandbox-worker.ts` (cosmetic cleanup, no behaviour change)
- `routerPath` construction in `main.ts` refactored to a single `path.join` call with a ternary for the filename
## [2.1.0]
 
_No diff provided._
 
## [2.0.4] - 2026-05-30
 
### Added
 
- `execArgv` option in `sandboxOptions` of `setupBullmqRouter` — passed through to both `workerForkOptions` and `workerThreadsOptions` of sandbox workers, allowing custom Node.js arguments (e.g. `--loader`, `--experimental-specifier-resolution`)
## [2.0.3] - 2026-05-30
 
### Changed
 
- Environment variable used to detect development mode renamed from `NODE_ENV` to `BULLMQ_ROUTER_NODE_ENV` to avoid conflicts with application-level environment variables
- Updated `dev` npm script to set `BULLMQ_ROUTER_NODE_ENV=development` instead of `NODE_ENV=development`

## [2.0.1] - 2025-05-30
 
### ⚠ Breaking Changes
 
- `setupBullmqRouter` now takes `router` as its first argument, followed by `options`
  ```ts
  // Before
  setupBullmqRouter({ connection, ... })
 
  // After
  const workers = setupBullmqRouter(router, { connection, ... })
  ```
 
- `setupBullmqRouter` now returns `Record<keyof R, Worker>` — one BullMQ `Worker` instance per top-level queue key
  ```ts
  const workers = setupBullmqRouter(router, { connection })
 
  workers.email.on('completed', (job) => console.log(job.id, 'done'))
 
  await Promise.all(Object.values(workers).map(w => w.close()))
  ```
 
- `defineJob` option `logsEnabled` has been removed — verbose console logging is no longer built into the job runner; attach listeners on the returned worker instead
### Added
 
- **Sandbox workers** via new `sandboxOptions` in `setupBullmqRouter` — selected queues run each job in an isolated child process using BullMQ's [sandboxed processor](https://docs.bullmq.io/guide/workers/sandboxed-processors)
  | Field | Type | Description |
  |---|---|---|
  | `routerPath` | `string` | Absolute path to the file that exports the router as default |
  | `workers` | `(keyof R)[]` | Queue names to run sandboxed; all others remain in-process |
  ```ts
  const workers = setupBullmqRouter(router, {
    connection: { host: 'localhost', port: 6379 },
    sandboxOptions: {
      routerPath: path.join(__dirname, 'router.js'),
      workers: ['email', 'pdf'],
    },
  })
  ```
 
- `SandboxWorkerManager` is now exported from the package
- `dev` script now runs TypeScript sources directly via `tsx` without a prior build step (`NODE_ENV=development tsx ./src/main.ts`)
### Changed
 
- `QueueManager.getQueue` now throws distinct, descriptive errors: one when options are missing for a queue, another when the Redis `connection` is not set
- `WorkerManager.getWorker` has the same error message improvements
- `QueueManager` exposes two new methods used internally by sandbox workers:
  - `getOptions(queueName)` — returns stored queue options
  - `hasOptions(queueName)` — checks whether options have been registered
### Internal
 
- Added dev dependencies: `tsx ^4.21.0`, `@types/node ^25.6.0`
- `src/test.ts` removed; replaced by `src/main.ts` (entry point) and `src/test-router.ts`
- Added `src/sandbox.ts` — child-process entry point that loads the router and dispatches jobs
- Added `src/sandbox-worker.ts` — `SandboxWorkerManager` singleton, mirrors `WorkerManager` for sandboxed queues 
---

## [1.0.12] - 2026-05-30
 
### Fixed
 
- `setupBullmqRouter` now correctly spreads per-queue `queueOptions` and `workerOptions` (instead of the entire options map) when registering each queue/worker
## [1.0.5] - 2026-05-30
 
### Changed
 
- `QueueManager` and `WorkerManager` are now singleton instances stored on `globalThis` via `Symbol.for`, preventing duplicate instances when multiple copies of the package are loaded in the same process
- Both classes refactored from static-only to instance-based (internal classes `QueueManagerInternal` / `WorkerManagerInternal`)
## [1.0.4] - 2026-05-30
 
### Added
 
- `prefix` option in `setupBullmqRouter` — sets a default BullMQ key prefix for all queues and workers; can be overridden per-queue via `queueOptions` / `workerOptions`
### Fixed
 
- Per-queue options are now correctly resolved before being merged, so only the relevant queue's overrides are applied

## [1.0.2] - 2026-05-30

### Changed

- `setupBullmqRouter` signature updated: `router` is now the first positional argument instead of a property inside the options object
- `workerOptions` and `queueOptions` in `setupBullmqRouter` are now optional (`?`)
- `QueueManager` and `WorkerManager` are now named exports instead of default exports
- Both `QueueManager` and `WorkerManager` are now part of the public API (re-exported from `index.ts`)

### Added

- `type-check` npm script (`tsc --project tsconfig.json`)

### Fixed

- Safe optional chaining on `queueOptions` and `workerOptions` when resolving per-queue connection options

---

## [1.0.1] - 2026-05-30

### Added

- `defineJob<T>(pop)(options?)` — defines a typed job leaf node with an async handler (`pop`); supports `jobIdComponents` for deterministic job IDs and `logsEnabled` for verbose logging
- `createRouter(nativeRouter)` — wraps a nested job object with a `Proxy` that injects dot-separated paths into every leaf node at access time
- `setupBullmqRouter(options)` — registers BullMQ queues and workers for every top-level router key; accepts per-queue and per-worker connection overrides
- Job methods on every leaf node: `push`, `pushBulk`, `replace`, `cancelDelayedJob`, `getJob`, `getFullJob`, `exec`, `toString`
- Cancellation pattern via `__cancelledTime__` stamp — cancelled delayed jobs are promoted and silently skipped by the worker without side effects
- `QueueManager` — singleton that lazily instantiates and caches `Queue` instances per queue name
- `WorkerManager` — singleton that lazily instantiates and caches `Worker` instances per queue name; routes incoming jobs to the correct leaf handler via dot-path lookup
- `get(obj, path, defaultValue?)` utility for safe dot-path access into the router tree