/**
 * META-ORCH-1174 Leg B2 — pure (RN-free) publish-gate validation for the
 * authored trip package set. Extracted from TripCreatorWizard so it can be
 * unit-tested without pulling React Native into the jest environment, and so
 * the wizard + edit-published path share ONE validator.
 *
 * DEC-E (soft cap 6 / min 1), DEC-G (per-package name/price/capacity/plan),
 * DEC-I (free + paid mix allowed). The price floor is 0 (free packages OK);
 * capacity must be a finite integer ≥ 1 (per-package, DEC-D); an enabled
 * payment plan must sum to 100% with each installment ≥ 1% and a due date —
 * mirroring PaymentPlanEditor's own validation.
 *
 * Spec: Mingla_Artifacts/specs/SPEC_META-ORCH-1174_LEGB_MULTITIER.md §C/§D.
 */

/**
 * META-ORCH-1174 Leg B2 — soft cap on packages per trip (DEC-E). The data
 * layer + checkout engine support N; this is a UX/density guard only.
 */
export const MAX_TRIP_PACKAGES = 6;

/** Minimal per-installment shape the validator inspects. */
export interface ValidatedInstallment {
  pct: number;
  days_after_booking?: number;
  fixed_date?: string;
}

/** Minimal per-package shape the validator inspects (a subset of Step4Package). */
export interface ValidatedPackage {
  name: string;
  priceMajor: string;
  capacity: number | null;
  paymentPlan: {
    deposit_pct: number;
    installments: ValidatedInstallment[];
  } | null;
}

export interface TripPackagesValidationResult {
  ok: boolean;
  reason: string | null;
}

/**
 * Validate the authored package set for publish (see module doc). Returns the
 * first failing reason (or null when valid) so callers can surface it + jump
 * to the pricing step.
 */
export function validateTripPackages(
  packages: ValidatedPackage[],
): TripPackagesValidationResult {
  if (packages.length < 1) {
    return { ok: false, reason: "Add at least one package." };
  }
  if (packages.length > MAX_TRIP_PACKAGES) {
    return {
      ok: false,
      reason: `Trips can have at most ${MAX_TRIP_PACKAGES} packages.`,
    };
  }
  for (let i = 0; i < packages.length; i += 1) {
    const p = packages[i];
    const label =
      p.name.trim().length > 0 ? `"${p.name.trim()}"` : `Package ${i + 1}`;
    if (p.name.trim().length === 0) {
      return { ok: false, reason: `Give ${label} a name.` };
    }
    const price = parseFloat(p.priceMajor);
    // Empty string → treated as free (0), valid. Any parsed value must be ≥ 0.
    if (
      p.priceMajor.trim().length > 0 &&
      (!Number.isFinite(price) || price < 0)
    ) {
      return { ok: false, reason: `${label} needs a valid price (0 or more).` };
    }
    if (
      p.capacity === null ||
      !Number.isFinite(p.capacity) ||
      p.capacity < 1 ||
      !Number.isInteger(p.capacity)
    ) {
      return { ok: false, reason: `${label} needs at least 1 spot.` };
    }
    if (p.paymentPlan !== null) {
      const plan = p.paymentPlan;
      const sum =
        plan.deposit_pct +
        plan.installments.reduce((acc, inst) => acc + inst.pct, 0);
      if (Math.abs(sum - 100) > 0.01) {
        return {
          ok: false,
          reason: `${label}'s payment plan must add up to 100%.`,
        };
      }
      if (plan.installments.length === 0) {
        return {
          ok: false,
          reason: `${label}'s payment plan needs at least one installment.`,
        };
      }
      for (const inst of plan.installments) {
        if (inst.pct < 1) {
          return {
            ok: false,
            reason: `${label}'s installments must each be at least 1%.`,
          };
        }
        const hasDays =
          inst.days_after_booking !== undefined &&
          inst.days_after_booking !== null;
        const hasDate =
          inst.fixed_date !== undefined && inst.fixed_date !== null;
        if (!hasDays && !hasDate) {
          return {
            ok: false,
            reason: `${label}'s installments each need a due date.`,
          };
        }
      }
    }
  }
  return { ok: true, reason: null };
}
