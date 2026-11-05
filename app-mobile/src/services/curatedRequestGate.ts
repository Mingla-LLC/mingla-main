/**
 * Issue #4275 — the curated function, gently, from one device.
 *
 * A Home open sends six curated calls at once and each one fans out on the
 * server, so a few phones could fill the database's connections. This gate lets
 * at most CURATED_MAX_CONCURRENT run at a time, first in first out, and identical
 * requests already in flight share one call. A slot is released when a call
 * settles, whichever way, and the caller's own rejection still reaches them.
 *
 * Pure: no React Native imports (Deno unit lane).
 */
export const CURATED_MAX_CONCURRENT = 3;

export function createCuratedRequestGate<T>(maxConcurrent: number = CURATED_MAX_CONCURRENT): {
  run(key: string, task: () => Promise<T>): Promise<T>;
} {
  const inFlight = new Map<string, Promise<T>>();
  const waiting: Array<() => void> = [];
  let running = 0;

  const startNext = (): void => {
    if (running < maxConcurrent) waiting.shift()?.();
  };

  return {
    run(key, task) {
      const existing = inFlight.get(key);
      if (existing) return existing;
      const promise = new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          running += 1;
          // `then` first, so a task that throws synchronously also releases its slot.
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              running -= 1;
              inFlight.delete(key);
              startNext();
            });
        });
      });
      inFlight.set(key, promise);
      startNext();
      return promise;
    },
  };
}
