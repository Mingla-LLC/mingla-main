import { getKycRemediationForRequirements } from "./stripeKycRemediation.ts";

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

export function requirementsHasDue(requirements: unknown): boolean {
  const remediation = getKycRemediationForRequirements(
    requirements as Record<string, unknown> | null,
  );
  return remediation.dueFields.length > 0 || remediation.disabledReason !== null;
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
