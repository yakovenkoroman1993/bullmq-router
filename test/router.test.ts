import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRouter, defineJob } from "../src/index.js";
import { JOB_DEFINITION, JOB_PATH, JOB_POP } from "../src/constants.js";

const noop = async () => {};

describe("createRouter", () => {
  const router = createRouter({
    email: {
      send: defineJob<{ to: string }>(noop)(),
      nested: {
        deep: {
          invoice: defineJob<{ id: number }>(noop)(),
        },
      },
      meta: "not-a-job",
      count: 0,
    },
    reports: {
      daily: defineJob<Record<string, never>>(noop)(),
    },
  });

  it("injects dot-separated paths into leaf nodes", () => {
    assert.equal(router.email.send.toString(), "email.send");
    assert.equal(router.email.nested.deep.invoice.toString(), "email.nested.deep.invoice");
    assert.equal(router.reports.daily.toString(), "reports.daily");
    assert.equal(`${router.email.send}`, "email.send");
  });

  it("keeps the leaf marker and wraps every method, including symbol keys", () => {
    const leaf = router.email.send;
    assert.equal(leaf[JOB_DEFINITION], true);
    for (const method of ["push", "pushBulk", "replace", "exec", "getJob", "getFullJob", "cancelDelayedJob", "toString"] as const) {
      assert.equal(typeof leaf[method], "function", method);
    }
    assert.equal(typeof leaf[JOB_POP], "function");
  });

  it("binds the resolved path as `this` even when methods are detached", () => {
    // Public types still declare a `this` param, so cast to call it detached.
    const toString = router.email.nested.deep.invoice.toString as () => string;
    assert.equal(toString(), "email.nested.deep.invoice");
  });

  it("does not mutate the original definition (placeholder path stays empty)", () => {
    const def = defineJob<{ a: number }>(noop)();
    const r = createRouter({ q: { def } });
    assert.equal(r.q.def.toString(), "q.def");
    assert.equal(def[JOB_PATH], "");
  });

  it("supports the same definition mounted at several paths", () => {
    const shared = defineJob<{ a: number }>(noop)();
    const r = createRouter({ q1: { shared }, q2: { x: { shared } } });
    assert.equal(r.q1.shared.toString(), "q1.shared");
    assert.equal(r.q2.x.shared.toString(), "q2.x.shared");
  });

  it("returns primitives and missing keys as-is", () => {
    assert.equal(router.email.meta, "not-a-job");
    assert.equal(router.email.count, 0);
    assert.equal((router as Record<string, unknown>).missing, undefined);
  });

  it("enumerates top-level keys as queue names", () => {
    assert.deepEqual(Object.keys(router), ["email", "reports"]);
  });

  it("throws when pushing to a queue that was never set up", () => {
    const r = createRouter({ "never-configured-queue": { job: defineJob<{ a: number }>(noop)() } });
    assert.throws(
      () => r["never-configured-queue"].job.push({ a: 1 }),
      /Queue options not found for queue: never-configured-queue/
    );
  });
});
