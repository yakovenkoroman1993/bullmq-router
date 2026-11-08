import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { Job } from "bullmq";
import { createRouter, defineJob, QueueManager } from "../src/index.js";
import { JOB_CANCELLED_TIME, JOB_POP } from "../src/constants.js";
import { cleanup, connection, uniquePrefix } from "./helpers.js";

// No workers here: jobs stay in waiting/delayed so we can inspect them.
const QUEUE = "jobs";
const prefix = uniquePrefix("job");

type Data = { userId: number; kind: string; extra?: string };

const handler = mock.fn(async (_job: Job<Data>, _name: string, _queue: unknown) => {});

const router = createRouter({
  [QUEUE]: {
    withId: defineJob<Data>((...args) => handler(...args))({ jobIdComponents: ["userId", "kind"] }),
    noId: defineJob<Data>((...args) => handler(...args))(),
  },
});

const queue = () => QueueManager.getQueue(QUEUE);

before(() => {
  QueueManager.addOptions(QUEUE, { connection, prefix });
});

beforeEach(async () => {
  handler.mock.resetCalls();
  await queue().obliterate({ force: true });
});

after(() => cleanup([queue()]));

describe("push", () => {
  it("adds a job named after its router path", async () => {
    const job = await router.jobs.noId.push({ userId: 1, kind: "a" });
    assert.equal(job.name, "jobs.noId");
    assert.deepEqual(job.data, { userId: 1, kind: "a" });
    assert.equal(await job.getState(), "waiting");
  });

  it("lets BullMQ generate the id when jobIdComponents is not set", async () => {
    const job = await router.jobs.noId.push({ userId: 1, kind: "a" });
    assert.match(job.id!, /^\d+$/);
  });

  it("builds a deterministic id from jobIdComponents", async () => {
    const job = await router.jobs.withId.push({ userId: 42, kind: "welcome", extra: "ignored" });
    assert.equal(job.id, "jobs.withId.42.welcome");
  });

  it("sanitizes unsafe characters and substitutes NA for missing components", async () => {
    const job = await router.jobs.withId.push({ userId: 7, kind: "a b/c@d:e" });
    assert.equal(job.id, "jobs.withId.7.a-b-c-d-e");

    const missing = await router.jobs.withId.push({ userId: 8 } as Data);
    assert.equal(missing.id, "jobs.withId.8.NA");
  });

  it("deduplicates jobs with the same deterministic id", async () => {
    const first = await router.jobs.withId.push({ userId: 1, kind: "a", extra: "first" });
    const second = await router.jobs.withId.push({ userId: 1, kind: "a", extra: "second" });
    assert.equal(first.id, second.id);
    assert.equal(await queue().count(), 1);
    assert.equal((await queue().getJob(first.id!))?.data.extra, "first");
  });

  it("allows options to override the generated id and pass BullMQ options", async () => {
    const job = await router.jobs.withId.push({ userId: 1, kind: "a" }, { jobId: "custom", delay: 60_000 });
    assert.equal(job.id, "custom");
    assert.equal(await job.getState(), "delayed");
  });
});

describe("pushBulk", () => {
  it("adds all jobs with generated ids and per-item options", async () => {
    const jobs = await router.jobs.withId.pushBulk([
      { data: { userId: 1, kind: "a" } },
      { data: { userId: 2, kind: "b" }, options: { delay: 60_000 } },
    ]);
    assert.deepEqual(jobs.map((j) => j.id), ["jobs.withId.1.a", "jobs.withId.2.b"]);
    assert.ok(jobs.every((j) => j.name === "jobs.withId"));
    assert.equal(await jobs[0]!.getState(), "waiting");
    assert.equal(await jobs[1]!.getState(), "delayed");
  });

  it("generated id takes precedence over options.jobId (unlike push)", async () => {
    const [job] = await router.jobs.withId.pushBulk([{ data: { userId: 3, kind: "c" }, options: { jobId: "custom" } }]);
    assert.equal(job!.id, "jobs.withId.3.c");
  });

  it("handles an empty list", async () => {
    assert.deepEqual(await router.jobs.withId.pushBulk([]), []);
  });
});

describe("replace", () => {
  it("creates the job when none exists", async () => {
    const job = await router.jobs.withId.replace({ userId: 1, kind: "a" });
    assert.equal(job.id, "jobs.withId.1.a");
    assert.equal(await queue().count(), 1);
  });

  it("replaces an existing job, keeping prior logs and adding a replacement entry", async () => {
    const original = await router.jobs.withId.push({ userId: 1, kind: "a", extra: "old" }, { delay: 60_000 });
    await original.log("original log");

    const replaced = await router.jobs.withId.replace({ userId: 1, kind: "a", extra: "new" });

    assert.equal(replaced.id, original.id);
    assert.equal(await queue().count(), 1);
    const stored = await queue().getJob(replaced.id!);
    assert.equal(stored?.data.extra, "new");
    assert.equal(await stored!.getState(), "waiting"); // delay not carried over

    const { logs } = await queue().getJobLogs(replaced.id!);
    assert.equal(logs.length, 2);
    assert.ok(logs.includes("original log"));
    assert.ok(logs.some((l) => l.includes("Replaced.")));
  });

  it("just adds a new job when jobIdComponents is not configured", async () => {
    await router.jobs.noId.push({ userId: 1, kind: "a" });
    await router.jobs.noId.replace({ userId: 1, kind: "a" });
    assert.equal(await queue().count(), 2);
  });
});

describe("getJob", () => {
  it("finds a job by its data", async () => {
    const pushed = await router.jobs.withId.push({ userId: 5, kind: "x" });
    const found = await router.jobs.withId.getJob({ userId: 5, kind: "x" });
    assert.equal(found?.id, pushed.id);
  });

  it("finds a job by raw id", async () => {
    const pushed = await router.jobs.noId.push({ userId: 5, kind: "x" });
    const found = await router.jobs.noId.getJob(pushed.id!);
    assert.equal(found?.id, pushed.id);
  });

  it("returns undefined for unknown jobs", async () => {
    assert.equal(await router.jobs.withId.getJob({ userId: 404, kind: "x" }), undefined);
    assert.equal(await router.jobs.withId.getJob("nope"), undefined);
  });

  it("without jobIdComponents, falls back to the first delayed job with the same name", async () => {
    await router.jobs.withId.push({ userId: 1, kind: "other" }, { delay: 60_000 });
    await router.jobs.noId.push({ userId: 1, kind: "waiting" });
    const delayed = await router.jobs.noId.push({ userId: 2, kind: "delayed" }, { delay: 60_000 });

    const found = await router.jobs.noId.getJob({ userId: 2, kind: "delayed" } as never);
    assert.equal(found?.id, delayed.id);
  });

  it("without jobIdComponents, returns undefined when nothing is delayed", async () => {
    await router.jobs.noId.push({ userId: 1, kind: "waiting" });
    assert.equal(await router.jobs.noId.getJob({} as never), undefined);
  });
});

describe("getFullJob", () => {
  it("returns the job with its state and logs", async () => {
    const pushed = await router.jobs.withId.push({ userId: 9, kind: "full" }, { delay: 60_000 });
    await pushed.log("hello");

    const full = await router.jobs.withId.getFullJob({ userId: 9, kind: "full" });
    assert.ok(full instanceof Job);
    assert.equal(full.id, pushed.id);
    assert.equal(full.state, "delayed");
    assert.deepEqual(full.logs, ["hello"]);
  });

  it("returns undefined for unknown jobs or when no id can be built", async () => {
    assert.equal(await router.jobs.withId.getFullJob("missing"), undefined);
    assert.equal(await router.jobs.noId.getFullJob({} as never), undefined);
  });
});

describe("cancelDelayedJob", () => {
  it("marks a delayed job as cancelled and promotes it", async () => {
    await router.jobs.withId.push({ userId: 1, kind: "a" }, { delay: 60_000 });

    assert.equal(await router.jobs.withId.cancelDelayedJob({ userId: 1, kind: "a" }), true);

    const job = await queue().getJob("jobs.withId.1.a");
    assert.equal(await job!.getState(), "waiting");
    const cancelledAt = (job!.data as Record<string, unknown>)[JOB_CANCELLED_TIME];
    assert.equal(typeof cancelledAt, "string");
    assert.ok(!Number.isNaN(Date.parse(cancelledAt as string)));
    assert.equal(job!.data.userId, 1); // original data preserved
  });

  it("accepts a raw job id", async () => {
    const job = await router.jobs.noId.push({ userId: 1, kind: "a" }, { delay: 60_000 });
    assert.equal(await router.jobs.noId.cancelDelayedJob(job.id!), true);
  });

  it("returns false for non-delayed, missing or id-less jobs", async () => {
    await router.jobs.withId.push({ userId: 2, kind: "b" });
    assert.equal(await router.jobs.withId.cancelDelayedJob({ userId: 2, kind: "b" }), false);
    assert.equal(await router.jobs.withId.cancelDelayedJob("missing"), false);
    assert.equal(await router.jobs.noId.cancelDelayedJob({} as never), false);
  });
});

describe("exec", () => {
  it("runs the handler directly without enqueueing", async () => {
    await router.jobs.withId.exec({ userId: 1, kind: "direct" });

    assert.equal(handler.mock.callCount(), 1);
    const [job, name, q] = handler.mock.calls[0]!.arguments;
    assert.ok(job instanceof Job);
    assert.equal(job.name, "jobs.withId");
    assert.deepEqual(job.data, { userId: 1, kind: "direct" });
    assert.equal(name, "jobs.withId");
    assert.equal(q, queue());
    assert.equal(await queue().count(), 0);
  });

  it("propagates handler errors", async () => {
    const failing = createRouter({ [QUEUE]: { boom: defineJob<object>(async () => { throw new Error("boom"); })() } });
    await assert.rejects(failing.jobs.boom.exec({}), /boom/);
  });
});

describe("JOB_POP", () => {
  it("logs start/finish around the handler", async () => {
    const pushed = await router.jobs.withId.push({ userId: 1, kind: "pop" });
    await router.jobs.withId[JOB_POP](pushed as never);

    assert.equal(handler.mock.callCount(), 1);
    assert.equal(handler.mock.calls[0]!.arguments[1], "jobs.withId");
    const { logs } = await queue().getJobLogs(pushed.id!);
    assert.equal(logs.length, 2);
    assert.match(logs[0]!, /Started\.$/);
    assert.match(logs[1]!, /Finished\.$/);
  });

  it("skips the handler for cancelled jobs", async () => {
    const pushed = await router.jobs.withId.push({ userId: 1, kind: "cancelled", [JOB_CANCELLED_TIME]: "2020-01-01" } as Data);
    await router.jobs.withId[JOB_POP](pushed as never);

    assert.equal(handler.mock.callCount(), 0);
    const { logs } = await queue().getJobLogs(pushed.id!);
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /Ignored\. Reason: cancelled at 2020-01-01/);
  });
});
