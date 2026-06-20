/**
 * useConsumerTripOfferingData — META-ORCH-1174 Leg A [trip-page-standardize].
 *
 * Maps the consumer `ConsumerTripDetail` (from useConsumerTripDetail) into the
 * shared `@mingla/offering-rendering` `TripOfferingData` / `TripOfferingBrand`
 * prop contract the shared `TripOfferingBody` reads — the single per-surface
 * adapter so the consumer screen renders the SAME body as web/business.
 *
 * NOTE (data-path parity gap, Leg-A pragmatic path): the consumer read
 * (useConsumerTripDetail) carries NO destination lat/lng today, so the §11
 * "Where you'll be" map stays omitted on consumer (rule-9 — no fabricated tile),
 * exactly as before this leg. The new `pg_public_trip_by_slug` RPC (this leg's
 * migration) RETURNS the lat/lng; a follow-up can repoint the consumer hook onto
 * it to close the map gap on every surface. I-MOR-0827: pure mapper, no app-src
 * import into the package — the package only sees the normalized shape.
 */

import {
  formatTripDateRange,
  normalizeCityCountry,
  type TripOfferingBrand,
  type TripOfferingData,
  type TripRefundPolicyShape,
} from "@mingla/offering-rendering";

import type { ConsumerTripDetail } from "./useConsumerTripDetail";

function deriveDuration(startAt: string | null, endAt: string | null): string | null {
  if (startAt === null || endAt === null) return null;
  const s = Date.parse(startAt);
  const e = Date.parse(endAt);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const nights = Math.max(0, Math.round((e - s) / dayMs));
  const days = nights + 1;
  if (nights === 0) return `${days} day`;
  return `${days} days · ${nights} night${nights === 1 ? "" : "s"}`;
}

function toRefundPolicyShape(
  policy: ConsumerTripDetail["refundPolicy"],
): TripRefundPolicyShape | null {
  if (policy === null) return null;
  return { kind: policy.kind, tiers: policy.tiers };
}

export function buildConsumerTripOfferingData(
  detail: ConsumerTripDetail,
): TripOfferingData {
  const duration = deriveDuration(detail.startAt, detail.endAt);
  const isSoldOut = detail.spotsLeft !== null && detail.spotsLeft <= 0;
  const cap = detail.totalCapacity;
  const spotsLabel =
    cap !== null
      ? isSoldOut
        ? `Sold out · ${cap} of ${cap} booked`
        : detail.spotsLeft != null
          ? `${detail.spotsLeft} seats left · ${cap} max`
          : `${cap} max`
      : detail.spotsLeft != null
        ? `${detail.spotsLeft} seats left`
        : null;

  return {
    id: detail.tripId,
    title: detail.title,
    description: detail.description,
    startAt: detail.startAt,
    endAt: detail.endAt,
    durationLabel: duration,
    dateRangeLabel:
      detail.startAt !== null && detail.endAt !== null
        ? formatTripDateRange(detail.startAt, detail.endAt)
        : "",
    departureCityCountry: normalizeCityCountry(detail.departureText),
    destinationCityCountry: normalizeCityCountry(detail.destinationText),
    destinationText: detail.destinationText,
    spotsLabel,
    bookingDeadlineIso: detail.bookingDeadline,
    days: detail.days.map((d) => ({
      id: d.id,
      ordinal: d.ordinal,
      title: d.title,
      narrative: d.narrative,
      date: null,
      media: d.media.map((m) => ({
        url: m.url,
        type: m.type === "video" ? ("video" as const) : ("image" as const),
      })),
    })),
    inclusions: detail.inclusions.map((i) => ({
      id: i.id,
      kind: i.kind,
      item: i.item,
    })),
    refundPolicy: toRefundPolicyShape(detail.refundPolicy),
    tiers: detail.tiers.map((t) => ({
      id: t.ticketTypeId,
      ticketTypeId: t.ticketTypeId,
      tierName: t.tierName,
      priceCents: t.priceCents,
      currency: t.currency,
      isFree: t.isFree,
      isUnlimited: t.isUnlimited,
      // consumer read has only aggregate spotsLeft → no per-tier remaining today.
      ticketsRemaining: null,
      installmentSchedule: t.installmentSchedule,
    })),
    currency: detail.currency ?? "USD",
    // map gap: consumer read lacks lat/lng (rule 9 — §11 omitted, as before).
    destinationLat: null,
    destinationLng: null,
    bookable: detail.bookable !== false,
    bookingsClosed: detail.bookingsClosed === true,
  };
}

export function buildConsumerTripOfferingBrand(
  detail: ConsumerTripDetail,
): TripOfferingBrand {
  return {
    id: detail.tripId,
    slug: detail.brandSlug,
    name: detail.brandName,
    bio: null,
    coverMediaUrl: detail.brandCoverMediaUrl,
    coverMediaType: detail.brandCoverMediaType,
    coverHue: null,
    verified: detail.brandVerified,
  };
}
