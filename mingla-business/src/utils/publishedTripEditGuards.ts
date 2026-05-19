/**
 * publishedTripEditGuards — client-side UX fast-path mirroring the
 * `biz_update_live_trip` RPC's 8-path refund-gate (ORCH-0876).
 *
 * The SERVER (RPC) is the canonical guard. This client-side guard is a
 * UX fast-path: when the operator's intent is provably destructive, we
 * preview the rejection without waiting on the 800ms RPC roundtrip.
 *
 * Mirror of `mingla-business/src/utils/publishedEventEditGuards.ts`.
 *
 * Audit-test invariant: this module references the RPC behavior; any
 * change to the RPC's rejection reasons MUST be mirrored here.
 *
 * Caller responsibility: pass an accurate `soldCountByTier` snapshot
 * (typically from `useTripHasWebPurchases`/equivalent) and reason text.
 * Server still validates; client guard prevents UX dead-ends only.
 */

import type {
  Trip,
  LiveTripPatch,
  UpdateLiveTripRejectReason,
} from "../services/tripsService";

export type LiveTripFieldValidationResult =
  | { ok: true; trimmedReason: string }
  | {
      ok: false;
      reason: UpdateLiveTripRejectReason;
      affectedOrderCount?: number;
      droppedDates?: string[];
      droppedInclusions?: string[];
    };

const REASON_MIN = 10;
const REASON_MAX = 200;

/**
 * Pre-flight validate. Mirror of the RPC's §4 refund-gate logic.
 *
 * @param trip — current Trip (server snapshot before patch)
 * @param patch — proposed LiveTripPatch
 * @param soldCountByTier — { [ticketTypeId]: confirmedSoldQuantity } from
 *   biz_trip_sold_count_by_tier helper (loaded via React Query). Used to
 *   gate capacity_below_sold, tier_delete_with_sales, tier_price_change_with_sales.
 * @param totalConfirmedOrders — total confirmed orders across all tiers
 *   (sum of soldCountByTier values; pre-computed by caller for clarity).
 * @param reason — required edit reason; validated for 10-200 char length.
 */
export const validateLiveTripFieldUpdate = (
  trip: Trip,
  patch: LiveTripPatch,
  soldCountByTier: Record<string, number>,
  totalConfirmedOrders: number,
  reason: string,
): LiveTripFieldValidationResult => {
  const trimmedReason = reason.trim();

  if (trimmedReason.length === 0) {
    return { ok: false, reason: "missing_edit_reason" };
  }
  if (
    trimmedReason.length < REASON_MIN ||
    trimmedReason.length > REASON_MAX
  ) {
    return { ok: false, reason: "invalid_edit_reason" };
  }
  if (
    trip.status !== "scheduled" &&
    trip.status !== "live"
  ) {
    return { ok: false, reason: "trip_not_editable_status" };
  }

  // ---------- Capacity check ----------
  const newCapacity = patch.theme?.business_trip?.capacity;
  if (newCapacity !== undefined && newCapacity !== null) {
    if (newCapacity < totalConfirmedOrders) {
      return {
        ok: false,
        reason: "capacity_below_sold",
        affectedOrderCount: totalConfirmedOrders,
      };
    }
  }

  // ---------- Date shift check ----------
  const newStart = patch.theme?.business_trip?.startAt;
  const newEnd = patch.theme?.business_trip?.endAt;
  if (
    (newStart !== undefined || newEnd !== undefined) &&
    totalConfirmedOrders > 0
  ) {
    const oldStart = trip.businessTrip.startAt;
    const oldEnd = trip.businessTrip.endAt;
    const effStart = newStart ?? oldStart;
    const effEnd = newEnd ?? oldEnd;
    if (effStart !== oldStart || effEnd !== oldEnd) {
      return {
        ok: false,
        reason: "dates_shifted_with_sales",
        affectedOrderCount: totalConfirmedOrders,
        droppedDates: [oldStart ?? "", oldEnd ?? ""],
      };
    }
  }

  // ---------- Days check ----------
  if (patch.days !== undefined) {
    const existingOrdinals = new Set(trip.days.map((d) => d.ordinal));
    const newOrdinals = new Set(patch.days.map((d) => d.ordinal));
    const dropped: number[] = [];
    for (const o of existingOrdinals) {
      if (!newOrdinals.has(o)) dropped.push(o);
    }
    if (dropped.length > 0 && totalConfirmedOrders > 0) {
      return {
        ok: false,
        reason: "days_dropped_with_sales",
        affectedOrderCount: totalConfirmedOrders,
        droppedDates: dropped.map(String),
      };
    }
  }

  // ---------- Inclusions check ----------
  if (patch.inclusions !== undefined) {
    const key = (kind: string, item: string): string => `${kind}:${item}`;
    const existingKeys = new Set(
      trip.inclusions.map((i) => key(i.kind, i.item)),
    );
    const newKeys = new Set(patch.inclusions.map((i) => key(i.kind, i.item)));
    const dropped: string[] = [];
    for (const k of existingKeys) {
      if (!newKeys.has(k)) dropped.push(k);
    }
    if (dropped.length > 0 && totalConfirmedOrders > 0) {
      return {
        ok: false,
        reason: "inclusions_removed_with_sales",
        affectedOrderCount: totalConfirmedOrders,
        droppedInclusions: dropped,
      };
    }
  }

  // ---------- Pricing tier checks ----------
  if (patch.pricing_tiers !== undefined) {
    const newByTtId = new Map(
      patch.pricing_tiers.map((t) => [t.ticket_type_id, t]),
    );
    for (const oldTier of trip.pricingTiers) {
      const newTier = newByTtId.get(oldTier.ticketTypeId);
      const sold = soldCountByTier[oldTier.ticketTypeId] ?? 0;
      if (newTier === undefined && sold > 0) {
        return {
          ok: false,
          reason: "tier_delete_with_sales",
          affectedOrderCount: sold,
        };
      }
      if (
        newTier !== undefined &&
        newTier.price_cents !== undefined &&
        newTier.price_cents !== oldTier.priceCents &&
        sold > 0
      ) {
        return {
          ok: false,
          reason: "tier_price_change_with_sales",
          affectedOrderCount: sold,
        };
      }
    }
  }

  return { ok: true, trimmedReason };
};
