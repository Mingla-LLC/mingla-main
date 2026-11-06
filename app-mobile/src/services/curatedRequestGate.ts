/**
 * Issue #4275 — the curated function, gently, from one device.
 *
 * A Home open sends six curated calls at once and each one fans out on the
 * server, so a few phones could fill the database's connections. This gate lets
 * at most CURATED_MAX_CONCURRENT run at a time, first in first out, and identical
 * requests already in flight share one call. A slot is released when a call
 * settles, whichever way, and the caller's own rejection still reaches them.
 *
 * A call that never settles is given up on after CURATED_WATCHDOG_MS, or three of
 * them would stop curated cards until restart. reset() drops everything, for
 * sign-out: nobody receives an answer that belonged to the previous account.
 *
 * Pure: no React Native imports (Deno unit lane), timers injectable.
 */
export const CURATED_MAX_CONCURRENT = 3;
/** Past the global 20 s fetch limit, which normally settles a call first. */
export const CURATED_WATCHDOG_MS = 30_000;

export interface CuratedGateTimers {
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const DEFAULT_TIMERS: CuratedGateTimers = {
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createCuratedRequestGate<T>(
  maxConcurrent: number = CURATED_MAX_CONCURRENT,
  timers: CuratedGateTimers = DEFAULT_TIMERS,
): {
  run(key: string, task: () => Promise<T>): Promise<T>;
  reset(): void;
} {
  const inFlight = new Map<string, Promise<T>>();
  const waiting: Array<() => void> = [];
  const live = new Set<(error: Error) => void>();
  let running = 0;

  const startNext = (): void => {
    if (running < maxConcurrent) waiting.shift()?.();
  };

  return {
    run(key, task) {
      const existing = inFlight.get(key);
      if (existing) return existing;
      const promise: Promise<T> = new Promise<T>((resolve, reject) => {
        let finished = false;
        let started = false;
        let watchdog: unknown = null;
        const finish = (settle: () => void): void => {
          if (finished) return;
          finished = true;
          if (watchdog !== null) timers.clearTimer(watchdog);
          live.delete(abort);
          if (inFlight.get(key) === promise) inFlight.delete(key);
          if (started) running -= 1;
          settle();
          startNext();
        };
        const abort = (error: Error): void => finish(() => reject(error));
        live.add(abort);
        waiting.push(() => {
          started = true;
          running += 1;
          watchdog = timers.setTimer(() => abort(new Error("curated_gate_watchdog")), CURATED_WATCHDOG_MS);
          // `then` first, so a task that throws synchronously also releases its slot.
          Promise.resolve()
            .then(task)
            .then(
              (value) => finish(() => resolve(value)),
              (error) => finish(() => reject(error)),
            );
        });
      });
      inFlight.set(key, promise);
      startNext();
      return promise;
    },
    reset() {
      waiting.length = 0;
      inFlight.clear();
      for (const abort of Array.from(live)) abort(new Error("curated_gate_reset"));
    },
  };
}
