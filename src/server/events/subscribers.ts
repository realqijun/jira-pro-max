/**
 * Registers every in-process domain-event subscriber exactly once per server process.
 * Called from `Recorder.publish` (the only publisher) so the same module graph that writes
 * is the one that listens; `instrumentation.ts` would bundle a second copy of the db client
 * and services. The dynamic import breaks the cycle mutation -> impact service -> mutation.
 * A failed load is logged and retried on the next publish; it never fails the caller,
 * whose transaction has already committed.
 */
const globalForSubscribers = globalThis as unknown as { __subscribersReady?: Promise<void> };

export function ensureSubscribers(): Promise<void> {
  globalForSubscribers.__subscribersReady ??= Promise.all([
    import("@/server/modules/impact/subscriber").then((m) => m.registerImpactDetector()),
    import("@/server/modules/search/subscriber").then((m) => m.registerEvidenceIndexer()),
  ])
    .then(() => undefined)
    .catch((e) => {
      console.error("[events] subscriber registration failed", e);
      globalForSubscribers.__subscribersReady = undefined;
    });
  return globalForSubscribers.__subscribersReady;
}
