/**
 * tripBoxTotals — META-ORCH-1174 Leg B3 [trip-page multi-tier selector].
 *
 * The PURE (React-Native-free) selection + money math for the public trip page's
 * §10 MULTI-PACKAGE box. Extracted from useTripOfferingState so it is unit-testable
 * under deno/node (the hook imports react and cannot be imported RN-free). Mirrors
 * eventBoxTotals (ORCH-1167) — the trip box is the same multi-line selector the
 * event box is, plus per-package payment-plan due-today.
 *
 * DEC-B (multiple packages in one cart) + DEC-C (per-package qty>1) + DEC-F (per-
 * package installments) + DEC-J ("From {min all-in}" → summed all-in). One owner:
 * the §10 box AND the floating/docked bar read the SAME derived totals so they can
 * never diverge.
 *
 * I-PROPOSED-1174-ALLIN-SERVER-SOURCED (extends ORCH-1147): the per-package price
 * is the SERVER all-in (priceAllInCents), falling back to priceCents ONLY when the
 * tier carries no all-in (free / RPC miss) — NEVER fabricating fee math here, NEVER
 * showing the bare base under the box.
 */

/** The minimal per-tier shape this math reads (a structural subset of TripOfferingTier). */
export interface TripTierLike {
  ticketTypeId: string;
  priceCents: number;
  /** Server all-in (pg_public_event_tier_allin). null/undefined → fall back to priceCents. */
  priceAllInCents?: number | null;
  isFree: boolean;
  isUnlimited: boolean;
  /** Remaining capacity; null when unlimited/unknown. */
  ticketsRemaining: number | null;
  installmentSchedule: unknown | null;
}

/** A selected cart line. `paymentPlanChoice` is present only for a tier with a plan. */
export interface TripSelectedLine {
  ticketTypeId: string;
  quantity: number;
  paymentPlanChoice?: "full" | "installments";
}

/** Per-tier installment template (deposit_pct + relative-offset installments). */
export interface TripInstallmentTemplateLike {
  deposit_pct: number;
  installments: Array<unknown>;
}

/**
 * The per-package effective max purchasable in ONE reservation. Unlimited → 99
 * (a sane stepper ceiling); else the remaining capacity (never below 0). A tier
 * with null remaining + not unlimited is treated as 0 (no fabricated availability).
 */
export const tripTierEffectiveMax = (tier: TripTierLike): number => {
  if (tier.isUnlimited) return 99;
  if (tier.ticketsRemaining === null) return 0;
  return Math.max(0, Math.floor(tier.ticketsRemaining));
};

/**
 * Clamp a requested quantity for one tier into [0, effectiveMax]. Non-finite/negative
 * → 0. This is the SINGLE clamp the stepper setters route through (DEC-C: qty>1 is
 * allowed, capped by the package's own remaining — DEC-D per-package capacity).
 */
export const clampTripTierQuantity = (
  tier: TripTierLike,
  requested: number,
): number => {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return Math.min(Math.floor(requested), tripTierEffectiveMax(tier));
};

/** The per-unit all-in price (WYSIWYP). Free / missing → 0. Never the bare base when an all-in exists. */
export const tripTierUnitAllInCents = (tier: TripTierLike): number => {
  if (tier.isFree) return 0;
  const price =
    typeof tier.priceAllInCents === "number" && Number.isFinite(tier.priceAllInCents)
      ? tier.priceAllInCents
      : tier.priceCents;
  return typeof price === "number" && Number.isFinite(price) ? price : 0;
};

/** The minimum per-unit all-in across SELLABLE tiers — DEC-J "From {X}" empty-state. */
export const tripMinTierAllInCents = (tiers: ReadonlyArray<TripTierLike>): number | null => {
  let min: number | null = null;
  for (const t of tiers) {
    // Skip genuinely-unbuyable tiers (sold out) so "From" reflects what's bookable.
    if (!t.isUnlimited && t.ticketsRemaining !== null && t.ticketsRemaining <= 0) continue;
    const unit = tripTierUnitAllInCents(t);
    if (min === null || unit < min) min = unit;
  }
  return min;
};

/** The selected lines (qty>0), in the tiers' own order. DEC-B: the full multi-line array. */
export const tripSelectedLines = (
  tiers: ReadonlyArray<TripTierLike>,
  quantities: Record<string, number>,
  planChoiceByTier?: Record<string, "full" | "installments">,
): TripSelectedLine[] => {
  const lines: TripSelectedLine[] = [];
  for (const t of tiers) {
    const qty = quantities[t.ticketTypeId] ?? 0;
    if (qty <= 0) continue;
    const hasPlan = t.installmentSchedule !== null && t.installmentSchedule !== undefined;
    const choice = hasPlan ? (planChoiceByTier?.[t.ticketTypeId] ?? "full") : undefined;
    lines.push({
      ticketTypeId: t.ticketTypeId,
      quantity: qty,
      ...(choice !== undefined ? { paymentPlanChoice: choice } : {}),
    });
  }
  return lines;
};

/** Total selected quantity across all packages. */
export const tripTotalSelectedQuantity = (
  quantities: Record<string, number>,
): number => {
  let n = 0;
  for (const key of Object.keys(quantities)) {
    const q = quantities[key] ?? 0;
    if (q > 0) n += q;
  }
  return n;
};

/** Σ(per-package all-in × qty) across the selected lines — the box/bar total (WYSIWYP). */
export const tripSummedAllInCents = (
  tiers: ReadonlyArray<TripTierLike>,
  quantities: Record<string, number>,
): number => {
  let total = 0;
  for (const t of tiers) {
    const qty = quantities[t.ticketTypeId] ?? 0;
    if (qty > 0) total += tripTierUnitAllInCents(t) * qty;
  }
  return total;
};

/**
 * The summed DUE-TODAY across selected lines (DEC-F per-line installments):
 *   • a line on a plan tier whose choice is "installments" contributes its DEPOSIT
 *     (deposit_pct of the line's all-in subtotal).
 *   • every other line (full, or no-plan) contributes its FULL all-in subtotal.
 * The deposit math reuses the same deposit_pct the projected schedule renders;
 * NEVER recomputes fees (the per-unit all-in is the server value). `deposit_pct` is
 * read off each tier's installmentSchedule when it is a valid template.
 */
export const tripSummedDueTodayCents = (
  tiers: ReadonlyArray<TripTierLike>,
  quantities: Record<string, number>,
  planChoiceByTier?: Record<string, "full" | "installments">,
): number => {
  let due = 0;
  for (const t of tiers) {
    const qty = quantities[t.ticketTypeId] ?? 0;
    if (qty <= 0) continue;
    const lineAllIn = tripTierUnitAllInCents(t) * qty;
    const template = asInstallmentTemplate(t.installmentSchedule);
    const choice = template !== null ? (planChoiceByTier?.[t.ticketTypeId] ?? "full") : "full";
    if (template !== null && choice === "installments") {
      due += Math.round((lineAllIn * template.deposit_pct) / 100);
    } else {
      due += lineAllIn;
    }
  }
  return due;
};

/** True when ANY selected line is on a plan tier with the "installments" choice. */
export const tripAnyLineOnPlan = (
  tiers: ReadonlyArray<TripTierLike>,
  quantities: Record<string, number>,
  planChoiceByTier?: Record<string, "full" | "installments">,
): boolean => {
  for (const t of tiers) {
    const qty = quantities[t.ticketTypeId] ?? 0;
    if (qty <= 0) continue;
    const template = asInstallmentTemplate(t.installmentSchedule);
    if (template === null) continue;
    if ((planChoiceByTier?.[t.ticketTypeId] ?? "full") === "installments") return true;
  }
  return false;
};

/** Narrow an unknown installmentSchedule into a usable template, or null. */
function asInstallmentTemplate(raw: unknown): TripInstallmentTemplateLike | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as { deposit_pct?: unknown; installments?: unknown };
  if (typeof obj.deposit_pct !== "number" || !Array.isArray(obj.installments)) return null;
  return { deposit_pct: obj.deposit_pct, installments: obj.installments };
}
