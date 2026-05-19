/**
 * ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer + Planner Surfaces]
 * — projects a stored `TripPricingTier.installmentSchedule` (relative-offset
 * template) into the absolute-date shape `<InstallmentScheduleDisplay />`
 * consumes (`InstallmentScheduleDisplaySchedule`).
 *
 * The schedule template stored under `trip_pricing_tiers.tier_metadata.installments`
 * has only `deposit_pct` + `days_after_booking` / `fixed_date` per installment.
 * Pre-purchase contexts (public trip page, qty picker, intake, buyer details,
 * payment screen, pre-Stripe banner, planner edit-preview, Money-tab planner
 * header) have NO booking anchor yet — dates must be projected from `now()`.
 * That makes every pre-purchase render a projection; callers MUST pass
 * `isProjection={true}` to the component when the dates came out of this
 * mapper. Constitution #9: rendered values are 1-to-1 with stored template.
 */

import type {
  TripInstallmentScheduleData,
  TripPricingTier,
} from "../services/tripsService";
import type { InstallmentScheduleDisplaySchedule } from "../components/trip/InstallmentScheduleDisplay";

function addDays(anchor: Date, days: number): Date {
  const result = new Date(anchor.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Build a display-ready schedule from a tier + anchor date, or null when the
 * tier has no payment plan configured. Pure function — no side effects, no
 * `Date.now()` reads outside the caller-supplied anchor.
 *
 * Constitution #3 — defense-in-depth: returns null on every malformed-input
 * variant (undefined schedule, missing `deposit_pct`, missing/non-array
 * `installments`). Some upstream readers (e.g., `usePublicTripBySlug` prior
 * to the ORCH-0882 hotfix) left `installmentSchedule` implicitly undefined
 * rather than null; rather than crash, this mapper fails safe to "no plan."
 * The strict-grep CI gate `i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint`
 * + the regression test suite catch wiring regressions independently.
 */
export function projectInstallmentSchedule(
  tier: Pick<
    TripPricingTier,
    "priceCents" | "currency" | "installmentSchedule"
  >,
  anchorDate: Date,
): InstallmentScheduleDisplaySchedule | null {
  const schedule: TripInstallmentScheduleData | null | undefined =
    tier.installmentSchedule;
  // Shape guard — null, undefined, missing `deposit_pct`, or
  // missing/non-array `installments` all fail safe to "no plan."
  if (
    schedule === null ||
    schedule === undefined ||
    typeof schedule !== "object" ||
    typeof (schedule as { deposit_pct?: unknown }).deposit_pct !== "number" ||
    !Array.isArray((schedule as { installments?: unknown }).installments)
  ) {
    return null;
  }

  const fullPriceCents = tier.priceCents;
  const depositCents = Math.round(
    (fullPriceCents * schedule.deposit_pct) / 100,
  );

  const installments = schedule.installments.map((inst) => {
    const amountCents = Math.round((fullPriceCents * inst.pct) / 100);
    let dueAt: string;
    if (typeof inst.fixed_date === "string" && inst.fixed_date.length > 0) {
      // fixed_date is a YYYY-MM-DD string; pin to UTC midnight for stable
      // Intl.DateTimeFormat output across viewer time zones.
      dueAt = `${inst.fixed_date}T00:00:00.000Z`;
    } else {
      const days =
        typeof inst.days_after_booking === "number"
          ? inst.days_after_booking
          : 0;
      dueAt = addDays(anchorDate, days).toISOString();
    }
    return {
      ordinal: inst.ordinal,
      pct: inst.pct,
      amountCents,
      dueAt,
    };
  });

  return {
    fullPriceCents,
    depositCents,
    currency: tier.currency,
    installments,
  };
}
