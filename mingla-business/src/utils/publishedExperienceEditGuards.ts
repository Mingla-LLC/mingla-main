/**
 * publishedExperienceEditGuards — META-ORCH-1059 Sub-E.
 *
 * Client-side UX fast-path mirroring the `biz_update_live_experience` RPC's
 * buyer-protection refund-gate. The SERVER (RPC) is the canonical guard; this
 * client-side guard previews the rejection without the RPC round-trip when the
 * operator's intent is provably destructive against existing buyers.
 *
 * Mirror of `mingla-business/src/utils/publishedTripEditGuards.ts`, adapted to
 * the EXPERIENCE model:
 *   - experiences have STOPS (not a day-itinerary) and exactly ONE ticket
 *     (the I-1 one-ticket invariant), so the trip-only `days_dropped` and
 *     `inclusions_removed` reasons are dropped.
 *   - the single ticket's price is whole-mode (events.whole_price_cents) or
 *     the per-stop sum; either way it's locked once a buyer exists.
 *
 * Audit-test invariant: this module references the RPC behavior; any change to
 * the RPC's rejection reasons MUST be mirrored here, or the operator sees a
 * delayed dialog instead of an immediate one.
 *
 * Caller responsibility: pass an accurate `totalConfirmedOrders` snapshot
 * (summed paid order quantity for this experience) + reason text. Server still
 * validates; client guard prevents UX dead-ends only.
 */

import type { ExperienceDetail } from "../services/experienceDetailService";

/**
 * Rejection reasons returned by `biz_update_live_experience`. MUST stay in
 * sync with the RPC's `jsonb_build_object('reason', ...)` branches.
 */
export type UpdateLiveExperienceRejectReason =
  | "missing_edit_reason"
  | "invalid_edit_reason"
  | "experience_not_editable_status"
  | "capacity_below_sold"
  | "dates_shifted_with_sales"
  | "price_change_with_sales"
  | "stop_removed_with_sales";

/**
 * The proposed live-experience patch. Mirrors the payload shape the wizard
 * already builds in `buildPayload`, narrowed to the fields the live guard
 * actually checks. All fields optional — only present keys are validated.
 */
export interface LiveExperiencePatch {
  /** New ticket capacity (events single-ticket quantity_total). null = unlimited. */
  capacity?: number | null;
  /** Whether the experience is now free (forces resolved price to 0). */
  is_free?: boolean;
  /** Pricing mode at save time — drives which price source is compared. */
  pricing_mode?: "whole" | "per_stop";
  /** New whole-mode price in cents (used when pricing_mode='whole'). */
  whole_price_cents?: number;
  /**
   * New occurrence list. Each entry is an ISO start/end pair (UTC). When
   * present, the guard compares against the current materialised dates and
   * rejects any shift/add/remove if a confirmed order exists.
   */
  dates?: Array<{ startAt: string; endAt: string }>;
  /**
   * New stop list (order matters). Each entry carries the stable identity used
   * to detect destructive stop removal. When present, the guard rejects
   * removing an existing stop if a confirmed order exists. `priceCents` is the
   * per-stop price (used to recompute the per-stop-summed price).
   */
  stops?: Array<{ placeName: string; priceCents: number }>;
}

export type LiveExperienceFieldValidationResult =
  | { ok: true; trimmedReason: string }
  | {
      ok: false;
      reason: UpdateLiveExperienceRejectReason;
      affectedOrderCount?: number;
      droppedDates?: string[];
      droppedStops?: string[];
    };

const REASON_MIN = 10;
const REASON_MAX = 200;

/** Stable comparison key for a stop (name-based; mirrors the RPC). */
const stopKey = (placeName: string): string => placeName.trim().toLowerCase();

/** ISO timestamps compare equal regardless of millisecond / zone formatting. */
const sameInstant = (a: string, b: string): boolean => {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b;
  return ta === tb;
};

/**
 * Resolve the price the buyer paid for, in cents, from the CURRENT experience.
 * Whole-mode: the ticket price (== events.whole_price_cents). Per-stop: the sum
 * of stop prices. Mirrors the RPC's I-1 one-ticket resolution.
 */
const currentResolvedPriceCents = (exp: ExperienceDetail): number => {
  if (exp.ticket?.isFree === true) return 0;
  if (exp.pricingMode === "per_stop") {
    return exp.stops.reduce((sum, s) => sum + (s.priceCents || 0), 0);
  }
  return exp.ticket?.priceCents ?? exp.wholePriceCents ?? 0;
};

/**
 * Resolve the price the patch WOULD set, in cents. Mirrors the wizard's
 * `resolvedTotalMajor` math + the RPC's price resolution.
 */
const patchResolvedPriceCents = (
  exp: ExperienceDetail,
  patch: LiveExperiencePatch,
): number => {
  const isFree = patch.is_free ?? exp.ticket?.isFree ?? false;
  if (isFree) return 0;
  const mode = patch.pricing_mode ?? exp.pricingMode ?? "whole";
  if (mode === "per_stop") {
    const stops = patch.stops ?? exp.stops.map((s) => ({ placeName: s.placeName, priceCents: s.priceCents }));
    return stops.reduce((sum, s) => sum + (s.priceCents || 0), 0);
  }
  return patch.whole_price_cents ?? exp.wholePriceCents ?? exp.ticket?.priceCents ?? 0;
};

/**
 * Pre-flight validate a live-experience patch. Mirror of the RPC's refund-gate.
 *
 * @param exp — current ExperienceDetail (server snapshot before patch).
 * @param patch — proposed LiveExperiencePatch.
 * @param totalConfirmedOrders — total confirmed (paid/non-cancelled) order
 *   quantity for this experience. Drives capacity_below_sold,
 *   dates_shifted_with_sales, price_change_with_sales, stop_removed_with_sales.
 * @param reason — required edit reason; validated for 10–200 char length.
 */
export const validateLiveExperienceFieldUpdate = (
  exp: ExperienceDetail,
  patch: LiveExperiencePatch,
  totalConfirmedOrders: number,
  reason: string,
): LiveExperienceFieldValidationResult => {
  const trimmedReason = reason.trim();

  if (trimmedReason.length === 0) {
    return { ok: false, reason: "missing_edit_reason" };
  }
  if (trimmedReason.length < REASON_MIN || trimmedReason.length > REASON_MAX) {
    return { ok: false, reason: "invalid_edit_reason" };
  }
  if (exp.status !== "scheduled" && exp.status !== "live") {
    return { ok: false, reason: "experience_not_editable_status" };
  }

  // ---------- Capacity check ----------
  // The single ticket's capacity can't drop below the confirmed sold count.
  if (patch.capacity !== undefined && patch.capacity !== null) {
    if (patch.capacity < totalConfirmedOrders) {
      return {
        ok: false,
        reason: "capacity_below_sold",
        affectedOrderCount: totalConfirmedOrders,
      };
    }
  }

  // ---------- Price check ----------
  // The ONE ticket's price (whole or per-stop sum) is locked once sold.
  if (totalConfirmedOrders > 0) {
    const oldPrice = currentResolvedPriceCents(exp);
    const newPrice = patchResolvedPriceCents(exp, patch);
    const priceTouched =
      patch.is_free !== undefined ||
      patch.pricing_mode !== undefined ||
      patch.whole_price_cents !== undefined ||
      patch.stops !== undefined;
    if (priceTouched && newPrice !== oldPrice) {
      return {
        ok: false,
        reason: "price_change_with_sales",
        affectedOrderCount: totalConfirmedOrders,
      };
    }
  }

  // ---------- Date shift check ----------
  // Any occurrence add/remove/shift on a sold experience is rejected.
  if (patch.dates !== undefined && totalConfirmedOrders > 0) {
    const oldDates = exp.dates.map((d) => ({ startAt: d.startAt, endAt: d.endAt }));
    const newDates = patch.dates;
    let shifted = oldDates.length !== newDates.length;
    if (!shifted) {
      // Compare sorted-by-start instants pairwise.
      const sortByStart = (
        arr: Array<{ startAt: string; endAt: string }>,
      ): Array<{ startAt: string; endAt: string }> =>
        [...arr].sort(
          (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
        );
      const o = sortByStart(oldDates);
      const n = sortByStart(newDates);
      for (let i = 0; i < o.length; i += 1) {
        if (!sameInstant(o[i].startAt, n[i].startAt) || !sameInstant(o[i].endAt, n[i].endAt)) {
          shifted = true;
          break;
        }
      }
    }
    if (shifted) {
      return {
        ok: false,
        reason: "dates_shifted_with_sales",
        affectedOrderCount: totalConfirmedOrders,
        droppedDates: oldDates.map((d) => d.startAt),
      };
    }
  }

  // ---------- Stop removal check ----------
  // Removing an existing stop on a sold experience is destructive (buyers paid
  // for the full itinerary). Re-ordering / editing / ADDING stops is allowed.
  if (patch.stops !== undefined && totalConfirmedOrders > 0) {
    const newKeys = new Set(patch.stops.map((s) => stopKey(s.placeName)));
    const dropped: string[] = [];
    for (const s of exp.stops) {
      if (!newKeys.has(stopKey(s.placeName))) dropped.push(s.placeName);
    }
    if (dropped.length > 0) {
      return {
        ok: false,
        reason: "stop_removed_with_sales",
        affectedOrderCount: totalConfirmedOrders,
        droppedStops: dropped,
      };
    }
  }

  return { ok: true, trimmedReason };
};

/**
 * Human copy for each rejection reason, shown inline on the live-experience
 * edit screen. Mirrors the events/trips inline-error pattern.
 */
export const liveExperienceRejectCopy = (
  reason: UpdateLiveExperienceRejectReason,
  affectedOrderCount?: number,
): string => {
  const n = affectedOrderCount ?? 0;
  const buyers = `${n} ${n === 1 ? "buyer" : "buyers"}`;
  switch (reason) {
    case "missing_edit_reason":
      return "Add a short reason for this change before saving.";
    case "invalid_edit_reason":
      return "Your reason needs to be 10–200 characters.";
    case "experience_not_editable_status":
      return "This experience can't be edited in its current state.";
    case "capacity_below_sold":
      return `You can't drop capacity below the ${buyers} who already booked.`;
    case "dates_shifted_with_sales":
      return `You can't change the dates — ${buyers} already booked. Cancel & refund them first to reschedule.`;
    case "price_change_with_sales":
      return `You can't change the price — ${buyers} already paid the current price. The ticket is locked after the first sale.`;
    case "stop_removed_with_sales":
      return `You can't remove a stop — ${buyers} booked the full itinerary. You can edit or add stops instead.`;
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
};
