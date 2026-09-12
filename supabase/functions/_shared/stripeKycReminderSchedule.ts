/**
 * #3272 — `requirementsHasDue` now LIVES in `stripeKycRemediation.ts` and is
 * re-exported from here so `stripe-kyc-stall-reminder/index.ts` (and the
 * existing Deno suite `__tests__/stripeKycReminderSchedule.test.ts`) keep their
 * imports unchanged.
 *
 * The move is not cosmetic. jest can import `stripeKycRemediation.ts` — zero
 * imports, no `Deno` global — but it cannot import THIS module: the extensioned
 * `./stripeKycRemediation.ts` specifier trips ts-jest TS5097 and
 * `calculateCronJitterMs` below reads `Deno.env` (TS2304). Putting the gate in
 * the jest-reachable module is what makes the #3272 regression test in
 * `mingla-business jest (full suite)` behavioural instead of a source grep.
 */
export { requirementsHasDue } from "./stripeKycRemediation.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEADLINE_TIERS = [7, 3, 1] as const;

/**
 * #3200 — the ceiling on the pre-work sleep.
 *
 * This used to be up to ONE HOUR (`Math.random() * 60 * 60 * 1000`). An edge
 * function is killed at its wall-clock limit (~400s), and `DISABLE_CRON_JITTER`
 * has never been set in production, so roughly 89% of runs would have died
 * mid-sleep having sent nothing — invisible, because the function also had no
 * caller until #3200 gave it one. Jitter exists to spread a thundering herd;
 * this job runs once a day, so thirty seconds is ample and keeps every run
 * comfortably inside the limit.
 */
export const MAX_CRON_JITTER_MS = 30_000;

export function calculateCronJitterMs(): number {
  if (Deno.env.get("DISABLE_CRON_JITTER") === "true") return 0;
  return Math.floor(Math.random() * MAX_CRON_JITTER_MS);
}

/**
 * #3200 — an operator decision to stop ALL KYC reminders for one account:
 * the stall reminder AND the 7/3/1-day deadline warnings.
 *
 * Deliberately its own column rather than stamping `kyc_stall_reminder_sent_at`.
 * That column means "we sent the stall reminder"; faking it would make the audit
 * trail lie, would not stop deadline warnings (which ignore it), and is cleared
 * by `stripeWebhookRouter` whenever charges become enabled. A suppression is
 * none of those things, so it gets a name that says what it is.
 */
export function kycRemindersSuppressed(
  account: { kyc_reminders_suppressed_at?: string | null },
): boolean {
  return typeof account.kyc_reminders_suppressed_at === "string" &&
    account.kyc_reminders_suppressed_at.length > 0;
}

export function deadlineWarningTiers(
  currentDeadline: number | null,
  nowMs = Date.now(),
): number[] {
  if (!currentDeadline) return [];
  const remainingMs = currentDeadline * 1000 - nowMs;
  if (remainingMs <= 0) return [];
  const remainingDays = Math.ceil(remainingMs / DAY_MS);
  return DEADLINE_TIERS.filter((tier) => remainingDays <= tier);
}
