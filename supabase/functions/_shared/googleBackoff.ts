// Issue #4276 C8: Google 429 and 503 wait and try again, honouring Retry-After, with a
// limit on how many calls run at once. Anything else is returned to the caller as is.

export const GOOGLE_BACKOFF_MAX_ATTEMPTS = 4;
export const GOOGLE_BACKOFF_BASE_MS = 1_000;
export const GOOGLE_BACKOFF_MAX_WAIT_MS = 30_000;

export interface GoogleBackoffOptions {
  maxAttempts?: number;
  baseMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 0 to 1, for the jitter. */
  random?: () => number;
  /** Seconds or an HTTP date to read Retry-After against. */
  now?: () => number;
}

/** Null when absent or unreadable. A past date means no wait. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export function backoffWaitMs(
  attempt: number,
  retryAfter: number | null,
  opts: { baseMs: number; maxWaitMs: number; random: number },
): number {
  if (retryAfter !== null) return Math.min(retryAfter, opts.maxWaitMs);
  const exponential = opts.baseMs * 2 ** (attempt - 1);
  return Math.min(Math.round(exponential + exponential * 0.25 * opts.random), opts.maxWaitMs);
}

/** The last response is returned, so the caller still sees and records the 429. */
export async function fetchWithGoogleBackoff(
  call: () => Promise<Response>,
  options: GoogleBackoffOptions = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? GOOGLE_BACKOFF_MAX_ATTEMPTS;
  const baseMs = options.baseMs ?? GOOGLE_BACKOFF_BASE_MS;
  const maxWaitMs = options.maxWaitMs ?? GOOGLE_BACKOFF_MAX_WAIT_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  for (let attempt = 1; ; attempt++) {
    const response = await call();
    if ((response.status !== 429 && response.status !== 503) || attempt >= maxAttempts) return response;
    // Free the connection before waiting.
    await response.body?.cancel().catch(() => undefined);
    await sleep(backoffWaitMs(attempt, retryAfterMs(response.headers.get("retry-after"), now()), {
      baseMs,
      maxWaitMs,
      random: random(),
    }));
  }
}

/** At most `limit` of these run at once; the rest wait their turn. */
export function createConcurrencyLimit(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
