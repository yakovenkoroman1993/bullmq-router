import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { get } from "../src/utils.js";

describe("get", () => {
  const obj = { a: { b: { c: 1, zero: 0, nil: null, undef: undefined } } };

  it("returns the object itself for an empty path", () => {
    assert.equal(get(obj, ""), obj);
  });

  it("resolves nested dot-separated paths", () => {
    assert.equal(get(obj, "a.b.c"), 1);
    assert.deepEqual(get(obj, "a.b"), obj.a.b);
  });

  it("keeps falsy-but-defined values", () => {
    assert.equal(get(obj, "a.b.zero"), 0);
    assert.equal(get(obj, "a.b.nil"), null);
  });

  it("returns the default for missing paths", () => {
    assert.equal(get(obj, "a.x.c"), undefined);
    assert.equal(get(obj, "a.x.c", "fallback"), "fallback");
  });

  it("returns the default when the resolved value is undefined", () => {
    assert.equal(get(obj, "a.b.undef", "fallback"), "fallback");
  });

  it("does not descend into primitives or null", () => {
    assert.equal(get(obj, "a.b.c.d", "fallback"), "fallback");
    assert.equal(get(obj, "a.b.nil.d", "fallback"), "fallback");
    assert.equal(get(null, "a", "fallback"), "fallback");
  });

  it("works through Proxy-wrapped routers", () => {
    const proxied = new Proxy(obj, {});
    assert.equal(get(proxied, "a.b.c"), 1);
  });
});
