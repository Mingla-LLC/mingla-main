/**
 * Issue #3801 / #4134 — one save at a time per trip.
 *
 * The trip wizard used to start a second save while the first was still on
 * the wire (Step 6 saved every package's questions in a `Promise.all`; Close
 * started a save without looking for one in flight). Both saves carried the
 * same revision, the second was refused with `trip_revision_conflict`, and the
 * host saw "Saving…" until they reloaded.
 *
 * This module is the client's whole answer, and it holds no React and no
 * network code so it can be tested on its own:
 *   - `createTripSaveQueue` runs saves strictly one after another. A save that
 *     is queued while another runs waits for it; it never overlaps it.
 *   - every save has a deadline. The CALLER stops waiting at the deadline and
 *     gets `TripSaveTimeoutError`, so "Saving…" always ends. The queue itself
 *     keeps waiting for the request that timed out before it starts the next
 *     one, so a late answer can never overlap a newer save.
 *   - a revision conflict latches. Once a save is refused because the trip
 *     changed somewhere else, every later save is refused at once, without a
 *     request, until the wizard reloads the trip. Nothing is retried.
 */

/** How long a host waits for one step save before being told it failed. */
export const TRIP_SAVE_TIMEOUT_MS = 30_000;

/** What the host is told when the trip changed somewhere else. */
export const TRIP_REVISION_CONFLICT_MESSAGE =
  "This trip was changed somewhere else. Reload to see the latest version.";

/** What the host is told when a save did not answer in time. */
export const TRIP_SAVE_TIMEOUT_MESSAGE =
  "Saving is taking too long. Check your connection and try again.";

export class TripSaveTimeoutError extends Error {
  readonly code = "trip_save_timeout" as const;
  constructor(ms: number) {
    super(`trip_save_timeout after ${ms}ms`);
    this.name = "TripSaveTimeoutError";
  }
}

export class TripRevisionConflictError extends Error {
  readonly code = "trip_revision_conflict" as const;
  constructor() {
    super("trip_revision_conflict");
    this.name = "TripRevisionConflictError";
  }
}

const mentionsConflict = (value: unknown): boolean =>
  typeof value === "string" && value.includes("trip_revision_conflict");

/**
 * True for a refusal that means "the trip changed since you loaded it": HTTP
 * 409 with no other code, PostgREST `PT409`, or any error whose message or
 * detail names `trip_revision_conflict` (the server's message, also when the
 * intake service or the publish path has wrapped it).
 */
export function isTripRevisionConflict(error: unknown): boolean {
  if (error instanceof TripRevisionConflictError) return true;
  if (mentionsConflict(error)) return true;
  if (typeof error !== "object" || error === null) return false;
  const e = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    detail?: unknown;
    details?: unknown;
  };
  if (e.code === "PT409" || e.code === "trip_revision_conflict") return true;
  if (e.status === 409 && (e.code === undefined || e.code === null)) return true;
  return mentionsConflict(e.message) || mentionsConflict(e.detail) ||
    mentionsConflict(e.details);
}

export function isTripSaveTimeout(error: unknown): boolean {
  return error instanceof TripSaveTimeoutError ||
    (typeof error === "object" && error !== null &&
      (error as { code?: unknown }).code === "trip_save_timeout");
}

/**
 * True when revision `candidate` is the same as, or later than, `reference`.
 * Revisions are `events.updated_at` timestamps; PostgREST and the graph
 * command may format the same instant differently ("Z" vs "+00:00"), so they
 * are compared as instants. Unparseable values only match exactly.
 */
export function isRevisionAtLeast(
  candidate: string | null | undefined,
  reference: string | null | undefined,
): boolean {
  if (candidate === null || candidate === undefined) return false;
  if (reference === null || reference === undefined) return true;
  if (candidate === reference) return true;
  const a = Date.parse(candidate);
  const b = Date.parse(reference);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a >= b;
}

export interface TripSaveQueue {
  /**
   * Run `task` after every save queued before it has settled. Rejects with
   * `TripRevisionConflictError` without running `task` once a conflict has
   * latched, and with `TripSaveTimeoutError` when `task` has not settled
   * `timeoutMs` after it was queued.
   */
  run<T>(task: () => Promise<T>, timeoutMs?: number): Promise<T>;
  /** True while any queued save has not settled, including one that timed out. */
  isBusy(): boolean;
  /** True once a save was refused because the trip changed somewhere else. */
  isConflicted(): boolean;
  /** Resolves when every queued save has settled; rejects at the deadline. */
  waitForIdle(timeoutMs?: number): Promise<void>;
}

const noop = (): void => undefined;

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TripSaveTimeoutError(ms)), ms);
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export function createTripSaveQueue(
  defaultTimeoutMs: number = TRIP_SAVE_TIMEOUT_MS,
): TripSaveQueue {
  let tail: Promise<void> = Promise.resolve();
  let unsettled = 0;
  let conflicted = false;

  return {
    run<T>(task: () => Promise<T>, timeoutMs: number = defaultTimeoutMs): Promise<T> {
      unsettled += 1;
      const work = tail
        .then(() => {
          if (conflicted) throw new TripRevisionConflictError();
          return task();
        })
        .catch((error: unknown) => {
          if (isTripRevisionConflict(error)) conflicted = true;
          throw error;
        });
      tail = work.then(noop, noop).then(() => {
        unsettled -= 1;
      });
      return withDeadline(work, timeoutMs);
    },
    isBusy: () => unsettled > 0,
    isConflicted: () => conflicted,
    waitForIdle(timeoutMs: number = defaultTimeoutMs): Promise<void> {
      return withDeadline(tail, timeoutMs);
    },
  };
}
