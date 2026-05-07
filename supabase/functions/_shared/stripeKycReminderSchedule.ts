import { getKycRemediationForRequirements } from "./stripeKycRemediation.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEADLINE_TIERS = [7, 3, 1] as const;

export function calculateCronJitterMs(): number {
  if (Deno.env.get("DISABLE_CRON_JITTER") === "true") return 0;
  return Math.floor(Math.random() * 60 * 60 * 1000);
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
