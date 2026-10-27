/**
 * Issue #3645 — one retry rule for instalments on both rails.
 *
 * MINGLA-INVARIANT: I-3645-BOTH-2 | issue #3645 | retry dates are anchored to the due date: retry 1 at due + 3 days, retry 2 at due + 7 days, the third failure flags the booking at risk
 *
 * Mirrored in SQL by public.issue_3645_next_retry_at (the Paystack resolver);
 * the pg suite issue_3645_paystack_attempts and the Deno test
 * issue_3645_retry_schedule.test.ts pin both to the same table of cases.
 * Replaces the old "+72h from the first failure, then +168h from the second"
 * cadence, which put the second retry on day 10.
 */

export const MAX_RETRY_ATTEMPTS = 3 as const;

/** How long before each payment the buyer is told about it (Q-1 default). */
export const NOTICE_LEAD_MS = 3 * 24 * 3600 * 1000;

const DAY_MS = 24 * 3600 * 1000;
const LATE_RETRY_MS = 6 * 3600 * 1000;
const OFFSET_DAYS_BY_RETRY_COUNT: Readonly<Record<number, number>> = { 1: 3, 2: 7 };

/**
 * The next retry time after a failure, or null when this failure puts the
 * booking at risk (retryCountAfterFailure >= 3) or the count is not a failure.
 * A computed time already at or before `now` (a late first attempt) becomes
 * now + 6 hours, so the next 6-hourly cron run retries.
 */
export function nextRetryAtAfterFailure(
  dueAtIso: string,
  retryCountAfterFailure: number,
  now: Date = new Date(),
): string | null {
  const days = OFFSET_DAYS_BY_RETRY_COUNT[retryCountAfterFailure];
  if (days === undefined) return null;
  const dueMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueMs)) throw new Error("installment_due_at_invalid");
  const anchored = dueMs + days * DAY_MS;
  const at = anchored <= now.getTime() ? now.getTime() + LATE_RETRY_MS : anchored;
  return new Date(at).toISOString();
}

export function isAtRiskAfterFailure(retryCountAfterFailure: number): boolean {
  return retryCountAfterFailure >= MAX_RETRY_ATTEMPTS;
}
