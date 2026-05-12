import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import { IncomingMessage } from "http";

type RequestContextState = {
  resolvedUrl: string;
  traceId: string;
};

const storageKey = Symbol.for("request-context-storage");

type GlobalWithStorage = {
  [storageKey]?: AsyncLocalStorage<RequestContextState>;
};

const Global = globalThis as GlobalWithStorage

Global[storageKey] ??= new AsyncLocalStorage<RequestContextState>();
const storage = Global[storageKey]

const EMPTY_TRACE_ID = "00000000-0000-0000-0000-000000000000";

export function generateContext(req?: IncomingMessage | undefined): RequestContextState {
  return {
    resolvedUrl: req?.url ?? "",
    traceId: randomUUID(),
  }
}

export function runWithContext<T>(context: RequestContextState, fn: () => T) {
  return storage.run(context, fn)
}

export default {
  get resolvedUrl() {
    return storage.getStore()?.resolvedUrl ?? "";
  },
  get traceId() {
    return storage.getStore()?.traceId ?? EMPTY_TRACE_ID;
  },
};
