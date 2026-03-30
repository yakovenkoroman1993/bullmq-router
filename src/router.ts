import { JOB_DEFINITION, JOB_PATH } from "./constants.js";

/**
 * Recursively traverses a router object and injects the current path (JOB_PATH)
 * into every leaf node of the tree.
 *
 * @param router - Nested object representing a route/job hierarchy
 * @param path   - Accumulated dot-separated path from the root to the current node (e.g. "queue.email.send")
 * @returns A Proxy over the router with paths automatically injected into leaf nodes
 */
function injectPaths<T extends object>(router: T, path = ""): T {
  return new Proxy(router, {
    get(target: T, prop: string | symbol) {
      const value = target[prop as keyof T];

      // Build the path to the current property: "parent.child", or just "child" at the root
      const jobPath = path ? `${path}.${String(prop)}` : String(prop);

      // A leaf node is an object marked with the JOB_DEFINITION symbol
      if (value && typeof value === "object" && JOB_DEFINITION in value) {
        const leaf = value as Record<string, (...args: unknown[]) => unknown>;

        // Collect only the methods (functions) defined on the leaf; skip other properties
        const methods = Reflect.ownKeys(leaf).filter(
          (k) => typeof leaf[k as keyof typeof leaf] === "function"
        );

        // Wrap each method so that `this` contains JOB_PATH with the resolved path at call time
        const extended = Object.fromEntries(
          methods.map((method) => [
            method,
            (...args: unknown[]) =>
              leaf[method as keyof typeof leaf].call(
                { ...leaf, [JOB_PATH]: jobPath },
                ...args
              ),
          ])
        );

        // Merge the original leaf with the wrapped methods and return
        return { ...leaf, ...extended };
      }

      // Intermediate node — recurse deeper, accumulating the path
      if (value && typeof value === "object") {
        return injectPaths(value, jobPath);
      }

      // Primitive value — return as-is
      return value;
    },
  });
}

export function createRouter<T extends object>(nativeRouter: T): T {
  return injectPaths(nativeRouter);
}
