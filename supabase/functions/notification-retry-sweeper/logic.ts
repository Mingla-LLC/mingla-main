// #2218 — the notification retry sweeper's ELIGIBILITY RULES, extracted so they
// can be executed by a test.
//
// They lived in index.ts, which calls `serve()` unguarded at module scope, so
// importing the module started an HTTP listener and nothing in it could be
// asserted. That is the same structural untestability api-health-probe/logic.ts
// was carved out to fix, and it matters more now: #2218 adds a `deferred` arm
// whose whole purpose is to NOT apply the exponential ladder, and a rule nobody
// can execute is a rule nobody can prove.
//
// PURE — no Deno, no fetch, no client. Behaviour is byte-for-byte what index.ts
// ran, plus the deferred arm.

export interface RetryableRow {
  id: string;
  order_id: string | null;
  status: string;
  attempt_count: number | null;
  updated_at: string;
  created_at: string;
  next_attempt_at: string | null;
  payload: Record<string, unknown> | null;
}

export const BATCH_LIMIT = 50;
export const BACKOFF_BASE_SECONDS = 60;
export const MAX_ATTEMPTS = 3;
export const ORPHAN_PENDING_SECONDS = 300; // 5 min — see file header for rationale.

export function isEligible(row: RetryableRow, nowMs: number): boolean {
  // =========================================================================
  // #2218 — A HELD MESSAGE WAKES ON ITS OWN CLOCK, NOT THIS ONE.
  // =========================================================================
  // `deferred` means the destination network refused this class of traffic
  // until a KNOWN instant — today, the Nigerian 20:00–08:00 WAT embargo on the
  // `generic` route. The ladder below tops out at 2^2 × 60s, so applying it to
  // a twelve-hour embargo would re-offer the message every four minutes, burn
  // the three-attempt cap before dawn, and terminate a text the network was
  // always going to carry at 08:00. `next_attempt_at` is the deadline the
  // adapter computed; this is the only place that reads it, and it is checked
  // BEFORE the backoff so the two can never both apply.
  //
  // A `deferred` row with no deadline is NOT swept. That combination means the
  // writer failed to record when the hold ends, and re-attempting on an unknown
  // schedule is guessing; the reconciler's staleness sweep is what surfaces it
  // to a human instead.
  if (row.status === "deferred") {
    if (row.next_attempt_at === null) return false;
    const readyMs = new Date(row.next_attempt_at).getTime();
    if (Number.isNaN(readyMs)) return false;
    return nowMs >= readyMs;
  }
  if (row.status === "pending") {
    // Orphan-pending path: inline-dispatch should have fired sub-second
    // after enqueue. Anything pending for >5 min means inline-dispatch
    // silently failed before flipping the row.
    const createdMs = new Date(row.created_at).getTime();
    if (Number.isNaN(createdMs)) return false;
    return nowMs - createdMs >= ORPHAN_PENDING_SECONDS * 1000;
  }
  if (row.status !== "failed_retryable") return false;
  const attempts = Number(row.attempt_count ?? 0);
  if (attempts >= MAX_ATTEMPTS) return false;
  const backoffMs = Math.pow(2, attempts) * BACKOFF_BASE_SECONDS * 1000;
  const updatedMs = new Date(row.updated_at).getTime();
  if (Number.isNaN(updatedMs)) return false;
  return nowMs - updatedMs >= backoffMs;
}

