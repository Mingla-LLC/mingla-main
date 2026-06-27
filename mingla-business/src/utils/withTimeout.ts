/**
 * withTimeout — generic per-call settle-guarantee for business web (META-ORCH-1235).
 *
 * Races any thenable against a bounded deadline. If the promise never settles
 * (hung Supabase read, GoTrue web-lock contention, dropped HTTP/2 stream), it
 * REJECTS with a typed TimeoutError after `ms`, so the consumer surfaces an
 * error/retry instead of an infinite spinner. Mirrors app-mobile/src/utils/withTimeout.ts.
 *
 * NOTE — settle-guarantee only. withTimeout stops the *consumer* from waiting
 * forever; it does NOT cancel the underlying socket. That is correct for this
 * class (the bug is the wedged consumer, not the socket). The React Query
 * retry cap bounds the orphaned-socket cost.
 */
export class TimeoutError extends Error {
  readonly isTimeout = true as const;
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export const isTimeoutError = (e: unknown): e is TimeoutError =>
  e instanceof TimeoutError ||
  (typeof e === "object" && e !== null && (e as { isTimeout?: unknown }).isTimeout === true);

// Default deadlines. Data reads get a generous ceiling (a slow-but-real read
// must still succeed); auth probes are tighter (they must finish well under the
// AuthContext 7s hard ceiling).
export const DATA_FETCH_TIMEOUT_MS = 15000; // full-screen-gating data reads
export const AUTH_PROBE_TIMEOUT_MS = 5000; // getSession()/getUser() probes (< 7s ceiling)

export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}
