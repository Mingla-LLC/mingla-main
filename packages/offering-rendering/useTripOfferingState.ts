/**
 * useTripOfferingState — META-ORCH-1174 Leg A [trip-page-standardize].
 *
 * THE ONE lifted buy-state machine for the public trip page (mirrors how the event
 * page uses resolveOfferingCta / computeOfferingVariant as one owner). The §10
 * inline reserve box AND the docked/floating <TripReserveBar> AND the desktop
 * reserve control ALL read this state → they can never diverge on price /
 * availability / split-plan affordance.
 *
 * Pure: no fetch, no auth, no store reads (I-MOR-0827). The pay-over-time schedule
 * projection lives here as a pure copy (`projectTripSchedule`) so the package has
 * NO app-src import. Each surface passes its own `paymentPlanChoice` useState in;
 * the hook derives the labels/CTA.
 *
 * Leg A: `selectedTier` is the sole/first sellable tier (capacity>0 or unlimited).
 * The shape anticipates Leg B (multi-tier: selectedTierId + quantities map are
 * additive — the bar/box contract is unchanged; see SPEC §D.2).
 */

import { useMemo } from "react";

import type { CtaState } from "./offeringCta";
import type {
  ProjectedTripSchedule,
  ReserveSplitCtas,
  TripInstallmentTemplate,
  TripOfferingData,
  TripOfferingTier,
} from "./tripOfferingTypes";

export type TripPaymentPlanChoice = "full" | "installments";

export interface UseTripOfferingStateInput {
  data: TripOfferingData;
  paymentPlanChoice: TripPaymentPlanChoice;
  /** Split-CTA onPress builders (the surface owns navigation/checkout). */
  onReserve: (choice?: TripPaymentPlanChoice) => void;
  /** Injectable for tests; default new Date(). */
  now?: Date;
}

export interface TripOfferingState {
  /** The SAME CtaState shape both bars + the box read. */
  cta: CtaState;
  /** Present ONLY when the (single) tier has a plan AND the CTA is tappable. */
  splitCtas?: ReserveSplitCtas;
  /** "All-in, taxes included" / "Due today · deposit" / null (free/no price). */
  barKicker: string | null;
  /** The bar's price string (follows the live toggle for a plan tier). */
  barPriceLabel: string;
  isClosed: boolean;
  isSoldOut: boolean;
  /** Leg A: the sole/first sellable tier (Leg B: the user-chosen tier). */
  selectedTier: TripOfferingTier | null;
  /** The pure pay-over-time projection (null when no plan). */
  projectedSchedule: ProjectedTripSchedule | null;
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
// Money formatting (minor units; never recompute fees — priceCents IS the all-in
// per the single-owner contract, ORCH-1147).
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

export function useTripOfferingState(
  input: UseTripOfferingStateInput,
): TripOfferingState {
  const { data, paymentPlanChoice, onReserve, now } = input;

  return useMemo<TripOfferingState>(() => {
    const anchor = now ?? new Date();
    const selectedTier = selectSellableTier(data.tiers);

    const isClosed = data.bookingsClosed === true;
    const isSoldOut =
      selectedTier !== undefined &&
      selectedTier !== null &&
      selectedTier.isUnlimited === false &&
      selectedTier.ticketsRemaining !== null &&
      selectedTier.ticketsRemaining <= 0;

    const projectedSchedule =
      selectedTier !== null ? projectTripSchedule(selectedTier, anchor) : null;
    const hasPlan = projectedSchedule !== null;

    const priceLabel =
      selectedTier !== null && selectedTier.priceCents > 0
        ? formatTripPrice(selectedTier.priceCents, selectedTier.currency)
        : selectedTier !== null && selectedTier.priceCents === 0
          ? "Free"
          : "";
    const depositLabel =
      projectedSchedule !== null
        ? formatTripPrice(
            projectedSchedule.depositCents,
            selectedTier?.currency ?? "USD",
          )
        : "";

    const multiTier = data.tiers.length > 1;
    const barPriceLabel = hasPlan
      ? paymentPlanChoice === "installments"
        ? `${depositLabel} today`
        : `${priceLabel} total`
      : multiTier
        ? `From ${priceLabel}`
        : priceLabel;

    const barKicker =
      priceLabel === "Free" || priceLabel === ""
        ? null
        : hasPlan && paymentPlanChoice === "installments"
          ? "Due today · deposit"
          : "All-in, taxes included";

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
          : isSoldOut
            ? { kind: "unavailable", title: "Sold out", subline: null, tappable: false }
            : selectedTier === null
              ? {
                  kind: "unavailable",
                  title: "Not bookable yet",
                  subline: null,
                  tappable: false,
                }
              : priceLabel === "Free"
                ? { kind: "free", label: "Reserve my spot", tappable: true }
                : {
                    kind: "buy",
                    label: "Reserve my spot",
                    price: barPriceLabel,
                    tappable: true,
                  };

    // Split CTAs ONLY for a bookable PLAN tier (rule 9: no-plan / disabled → single).
    const splitCtas: ReserveSplitCtas | undefined =
      hasPlan && cta.tappable
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

    return {
      cta,
      splitCtas,
      barKicker,
      barPriceLabel,
      isClosed,
      isSoldOut,
      selectedTier,
      projectedSchedule,
    };
  }, [data, paymentPlanChoice, onReserve, now]);
}
