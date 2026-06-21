/**
 * useTripOfferingState — META-ORCH-1174 Leg A [trip-page-standardize] +
 * Leg B3 [multi-package selector].
 *
 * THE ONE lifted buy-state machine for the public trip page (mirrors how the event
 * page uses resolveOfferingCta / the eventBoxTotals owner). The §10 inline reserve
 * box AND the docked/floating <TripReserveBar> AND the desktop reserve control ALL
 * read this state → they can never diverge on price / availability / selection.
 *
 * Leg B3 (DEC-B/C/D/F/J): the single `selectedTier` slot becomes a MULTI-SELECT
 * model. The surface owns the `{ ticketTypeId → quantity }` map + the per-tier
 * `{ ticketTypeId → "full"|"installments" }` plan-choice map as useState and passes
 * them in (the hook stays pure — no fetch, no store, no internal state; I-MOR-0827).
 * The hook derives: the clamped per-tier qty setter inputs, the selected lines, the
 * SUMMED server all-in (Σ priceAllInCents × qty), the per-line due-today, and the
 * bar label (DEC-J "From {min all-in}" until a package is selected → summed all-in).
 *
 * Pure: no fetch, no auth, no store reads (I-MOR-0827). The all-in lives on each
 * tier's `priceAllInCents` (resolved server-side by each surface adapter via
 * fetchTierAllInCents / pg_public_event_tier_allin — NEVER fee math here). The pay-
 * over-time schedule projection stays a pure copy (`projectTripSchedule`).
 *
 * Single-package trips (N=1) behave EXACTLY as Leg A: one row, the same toggle, the
 * same CTA — no regression (proven by the N=1 tests).
 */

import { useMemo } from "react";

import type { CtaState } from "./offeringCta";
import {
  clampTripTierQuantity,
  tripAnyLineOnPlan,
  tripMinTierAllInCents,
  tripSelectedLines,
  tripSummedAllInCents,
  tripSummedDueTodayCents,
  tripTotalSelectedQuantity,
  tripTierUnitAllInCents,
  type TripTierLike,
} from "./tripBoxTotals";
import type {
  ProjectedTripSchedule,
  ReserveSplitCtas,
  TripInstallmentTemplate,
  TripOfferingData,
  TripOfferingTier,
  TripReserveLine,
} from "./tripOfferingTypes";

export type TripPaymentPlanChoice = "full" | "installments";

export interface UseTripOfferingStateInput {
  data: TripOfferingData;
  /**
   * Leg A back-compat: the single pay-full/pay-over-time toggle. Leg B3 surfaces
   * pass a per-tier map instead via `planChoiceByTier`; when that is present it
   * takes precedence per-tier. A single-package surface can keep passing only this.
   */
  paymentPlanChoice: TripPaymentPlanChoice;
  /**
   * Leg B3 — the user's per-package selection `{ ticketTypeId → quantity }`. Absent
   * → Leg-A behavior (the hook seeds the sole sellable tier at qty 1 for display).
   */
  quantities?: Record<string, number>;
  /** Leg B3 — per-package payment-plan choice `{ ticketTypeId → "full"|"installments" }`. */
  planChoiceByTier?: Record<string, TripPaymentPlanChoice>;
  /** Split-CTA onPress builders (the surface owns navigation/checkout). */
  onReserve: (choice?: TripPaymentPlanChoice, lines?: TripReserveLine[]) => void;
  /** Injectable for tests; default new Date(). */
  now?: Date;
}

export interface TripOfferingState {
  /** The SAME CtaState shape both bars + the box read. */
  cta: CtaState;
  /** Present ONLY when the (single, Leg-A) tier has a plan AND the CTA is tappable. */
  splitCtas?: ReserveSplitCtas;
  /** "All-in, taxes included" / "Due today · deposit" / null (free/no price). */
  barKicker: string | null;
  /** The bar's price string (DEC-J: "From {min}" until selected → summed all-in). */
  barPriceLabel: string;
  isClosed: boolean;
  isSoldOut: boolean;
  /** Leg A: the sole/first sellable tier (used for the single-package fast path). */
  selectedTier: TripOfferingTier | null;
  /** The pure pay-over-time projection for the SOLE tier (null when no plan / multi). */
  projectedSchedule: ProjectedTripSchedule | null;

  // ----- Leg B3 multi-select -----
  /** Total selected quantity across all packages (0 → nothing selected). */
  totalSelectedQuantity: number;
  /** The selected lines (qty>0) — DEC-B, what Reserve passes to the cart. */
  selectedLines: TripReserveLine[];
  /** Σ(server all-in × qty) across selected lines, in cents (WYSIWYP). */
  summedAllInCents: number;
  /** Σ per-line due-today (plan lines → deposit; full/no-plan → full), in cents. */
  summedDueTodayCents: number;
  /** The summed-all-in label ("Free"/formatted) — null when nothing selected. */
  summedAllInLabel: string | null;
  /** The summed due-today label — null when nothing selected. */
  summedDueTodayLabel: string | null;
  /** True when ANY selected line is on a plan tier paying over time. */
  anyLineOnPlan: boolean;
  /** Clamp a requested qty for a tier (the surface routes its stepper through this). */
  clampQuantity: (ticketTypeId: string, requested: number) => number;
}

// ===========================================================================
// Pure pay-over-time projection (RN-free copy of installmentScheduleProjection,
// emitting the package ProjectedTripSchedule with dueAtIso). No app-src import.
// ===========================================================================

function addDaysIso(anchor: Date, days: number): string {
  const r = new Date(anchor.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r.toISOString();
}

/**
 * Project a tier's installment template into an absolute-date schedule, or null
 * when the tier has no plan. Pure (no Date.now outside the supplied anchor).
 * `quantityMultiplier` (default 1) scales price BEFORE the deposit/installment math
 * (Leg B passes the cart quantity; Leg A passes 1).
 */
export function projectTripSchedule(
  tier: Pick<TripOfferingTier, "priceCents" | "currency" | "installmentSchedule">,
  anchorDate: Date,
  quantityMultiplier = 1,
): ProjectedTripSchedule | null {
  const schedule: TripInstallmentTemplate | null = tier.installmentSchedule;
  if (
    schedule === null ||
    typeof schedule !== "object" ||
    typeof schedule.deposit_pct !== "number" ||
    !Array.isArray(schedule.installments)
  ) {
    return null;
  }
  const qty =
    Number.isFinite(quantityMultiplier) && quantityMultiplier >= 1
      ? Math.floor(quantityMultiplier)
      : 1;
  const fullPriceCents = tier.priceCents * qty;
  const depositCents = Math.round((fullPriceCents * schedule.deposit_pct) / 100);
  const installments = schedule.installments.map((inst) => {
    const amountCents = Math.round((fullPriceCents * inst.pct) / 100);
    let dueAtIso: string;
    if (typeof inst.fixed_date === "string" && inst.fixed_date.length > 0) {
      dueAtIso = `${inst.fixed_date}T00:00:00.000Z`;
    } else {
      const days =
        typeof inst.days_after_booking === "number" ? inst.days_after_booking : 0;
      dueAtIso = addDaysIso(anchorDate, days);
    }
    return { ordinal: inst.ordinal, amountCents, dueAtIso };
  });
  return { fullPriceCents, depositCents, currency: tier.currency, installments };
}

// ===========================================================================
// Money formatting (minor units; never recompute fees — priceAllInCents IS the
// all-in per the single-owner contract, ORCH-1147 / I-PROPOSED-1174-ALLIN).
// ===========================================================================

function formatTripPrice(priceCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(priceCents / 100);
  } catch {
    return `${(priceCents / 100).toFixed(0)} ${currency}`;
  }
}

/** Pick the sole/first sellable tier (capacity>0 or unlimited; else the first). */
export function selectSellableTier(
  tiers: ReadonlyArray<TripOfferingTier>,
): TripOfferingTier | null {
  if (tiers.length === 0) return null;
  return (
    tiers.find(
      (t) =>
        t.isUnlimited || t.ticketsRemaining === null || t.ticketsRemaining > 0,
    ) ?? tiers[0]
  );
}

/** The per-tier UNIT all-in price label (server all-in; "Free" when free). */
export function tripTierPriceLabel(tier: TripOfferingTier): string {
  if (tier.isFree || tier.priceCents === 0) return "Free";
  return formatTripPrice(tripTierUnitAllInCents(tier as TripTierLike), tier.currency);
}

/** Map a TripOfferingTier into the RN-free math shape (carrying the server all-in). */
function toTierLike(tier: TripOfferingTier): TripTierLike {
  return {
    ticketTypeId: tier.ticketTypeId,
    priceCents: tier.priceCents,
    priceAllInCents: tier.priceAllInCents ?? null,
    isFree: tier.isFree,
    isUnlimited: tier.isUnlimited,
    ticketsRemaining: tier.ticketsRemaining,
    installmentSchedule: tier.installmentSchedule,
  };
}

export function useTripOfferingState(
  input: UseTripOfferingStateInput,
): TripOfferingState {
  const {
    data,
    paymentPlanChoice,
    quantities,
    planChoiceByTier,
    onReserve,
    now,
  } = input;

  return useMemo<TripOfferingState>(() => {
    const anchor = now ?? new Date();
    const tierLikes = data.tiers.map(toTierLike);
    const selectedTier = selectSellableTier(data.tiers);

    // Effective per-tier plan choices: the explicit per-tier map wins; else the
    // single Leg-A toggle is applied to whichever tier(s) carry a plan (so a
    // single-package surface that only passes `paymentPlanChoice` is unchanged).
    const effectivePlanByTier: Record<string, TripPaymentPlanChoice> = {};
    for (const t of data.tiers) {
      const hasPlan =
        t.installmentSchedule !== null && t.installmentSchedule !== undefined;
      if (!hasPlan) continue;
      effectivePlanByTier[t.ticketTypeId] =
        planChoiceByTier?.[t.ticketTypeId] ?? paymentPlanChoice;
    }

    const qtyMap = quantities ?? {};
    const totalSelected = tripTotalSelectedQuantity(qtyMap);
    const selectedLines = tripSelectedLines(
      tierLikes,
      qtyMap,
      effectivePlanByTier,
    );
    const summedAllInCents = tripSummedAllInCents(tierLikes, qtyMap);
    const summedDueTodayCents = tripSummedDueTodayCents(
      tierLikes,
      qtyMap,
      effectivePlanByTier,
    );
    const anyLineOnPlan = tripAnyLineOnPlan(tierLikes, qtyMap, effectivePlanByTier);

    const tripCurrency = data.currency || selectedTier?.currency || "USD";
    const summedAllInLabel =
      totalSelected === 0
        ? null
        : summedAllInCents === 0
          ? "Free"
          : formatTripPrice(summedAllInCents, tripCurrency);
    const summedDueTodayLabel =
      totalSelected === 0
        ? null
        : summedDueTodayCents === 0
          ? "Free"
          : formatTripPrice(summedDueTodayCents, tripCurrency);

    const isClosed = data.bookingsClosed === true;
    // Whole-trip sold-out: NO sellable tier exists (every tier capped at 0).
    const isSoldOut =
      data.tiers.length > 0 &&
      data.tiers.every(
        (t) =>
          t.isUnlimited === false &&
          t.ticketsRemaining !== null &&
          t.ticketsRemaining <= 0,
      );

    // Leg-A single-tier projection (the merged box's pay-full/over-time toggle reads
    // it for a single-package trip; multi-package rows project per-row in the body).
    const projectedSchedule =
      selectedTier !== null ? projectTripSchedule(selectedTier, anchor) : null;
    const hasSingleTierPlan = projectedSchedule !== null;

    // DEC-J — the bar/box price string.
    //   nothing selected → "From {min all-in}" (multi) or the bare all-in (single).
    //   ≥1 selected      → the summed all-in (or summed due-today when paying over time).
    const minAllIn = tripMinTierAllInCents(tierLikes);
    const multiTier = data.tiers.length > 1;
    const fromLabel =
      minAllIn === null
        ? ""
        : minAllIn === 0
          ? "Free"
          : multiTier
            ? `From ${formatTripPrice(minAllIn, tripCurrency)}`
            : formatTripPrice(minAllIn, tripCurrency);

    let barPriceLabel: string;
    if (totalSelected > 0) {
      barPriceLabel = anyLineOnPlan
        ? `${summedDueTodayLabel ?? ""} today`
        : (summedAllInLabel ?? "");
    } else if (hasSingleTierPlan && !multiTier) {
      // Single-package plan trip, nothing selected: keep the Leg-A toggle preview.
      const depositLabel = formatTripPrice(
        projectedSchedule.depositCents,
        selectedTier?.currency ?? tripCurrency,
      );
      barPriceLabel =
        paymentPlanChoice === "installments"
          ? `${depositLabel} today`
          : fromLabel;
    } else {
      barPriceLabel = fromLabel;
    }

    const barKicker =
      fromLabel === "Free" || fromLabel === ""
        ? null
        : (totalSelected > 0 && anyLineOnPlan) ||
            (totalSelected === 0 &&
              hasSingleTierPlan &&
              !multiTier &&
              paymentPlanChoice === "installments")
          ? "Due today · deposit"
          : "All-in, taxes included";

    // The CTA is tappable when the offering is bookable + open + not whole-trip
    // sold-out + has at least one sellable tier. Selection is NOT required to tap
    // (the box/cart let the buyer pick) — mirrors the event box (ORCH-1167-R3).
    const anySellable = data.tiers.some(
      (t) =>
        t.isUnlimited || t.ticketsRemaining === null || t.ticketsRemaining > 0,
    );
    const allFree =
      data.tiers.length > 0 && data.tiers.every((t) => t.isFree || t.priceCents === 0);

    const cta: CtaState =
      data.bookable === false
        ? {
            kind: "unavailable",
            title: "Booking unavailable",
            subline: "The organizer is finishing payment setup.",
            tappable: false,
          }
        : isClosed
          ? { kind: "unavailable", title: "Bookings closed", subline: null, tappable: false }
          : isSoldOut || !anySellable
            ? { kind: "unavailable", title: "Sold out", subline: null, tappable: false }
            : selectedTier === null
              ? {
                  kind: "unavailable",
                  title: "Not bookable yet",
                  subline: null,
                  tappable: false,
                }
              : allFree
                ? { kind: "free", label: "Reserve my spot", tappable: true }
                : {
                    kind: "buy",
                    label: "Reserve my spot",
                    price: barPriceLabel,
                    tappable: true,
                  };

    // Split CTAs — Leg A single-package plan fast path ONLY (multi-package rows own
    // their own per-row pay-full/over-time toggle in the body). No split for multi.
    const priceLabel =
      selectedTier !== null && selectedTier.priceCents > 0
        ? formatTripPrice(
            tripTierUnitAllInCents(selectedTier as TripTierLike),
            selectedTier.currency,
          )
        : "";
    const depositLabel =
      projectedSchedule !== null
        ? formatTripPrice(
            projectedSchedule.depositCents,
            selectedTier?.currency ?? tripCurrency,
          )
        : "";
    const splitCtas: ReserveSplitCtas | undefined =
      hasSingleTierPlan && !multiTier && cta.tappable
        ? {
            full: {
              cta: {
                kind: "buy" as const,
                label: "Pay in full",
                price: priceLabel,
                tappable: true,
              },
              onPress: () => onReserve("full"),
            },
            overTime: {
              cta: {
                kind: "buy" as const,
                label: "Pay over time",
                price: depositLabel.length > 0 ? `From ${depositLabel} today` : "",
                tappable: true,
              },
              onPress: () => onReserve("installments"),
            },
          }
        : undefined;

    const clampQuantity = (ticketTypeId: string, requested: number): number => {
      const tier = tierLikes.find((t) => t.ticketTypeId === ticketTypeId);
      if (tier === undefined) return 0;
      return clampTripTierQuantity(tier, requested);
    };

    return {
      cta,
      splitCtas,
      barKicker,
      barPriceLabel,
      isClosed,
      isSoldOut,
      selectedTier,
      projectedSchedule,
      totalSelectedQuantity: totalSelected,
      selectedLines,
      summedAllInCents,
      summedDueTodayCents,
      summedAllInLabel,
      summedDueTodayLabel,
      anyLineOnPlan,
      clampQuantity,
    };
  }, [data, paymentPlanChoice, quantities, planChoiceByTier, onReserve, now]);
}
