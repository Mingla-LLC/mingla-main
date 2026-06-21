/**
 * useConsumerTripOfferingData — META-ORCH-1174 Leg A [trip-page-standardize].
 *
 * Maps the consumer `ConsumerTripDetail` (from useConsumerTripDetail) into the
 * shared `@mingla/offering-rendering` `TripOfferingData` / `TripOfferingBrand`
 * prop contract the shared `TripOfferingBody` reads — the single per-surface
 * adapter so the consumer screen renders the SAME body as web/business.
 *
 * META-ORCH-1174 Leg A.2 — the consumer read (useConsumerTripDetail) now sources
 * the canonical `pg_public_trip_by_slug` RPC, so `ConsumerTripDetail` carries the
 * destination lat/lng (the §11 "Where you'll be" map now renders on consumer,
 * closing the prior gap) AND real per-tier `ticketsRemaining`. This mapper passes
 * both through to the shared `TripOfferingData`. I-MOR-0827: pure mapper, no
 * app-src import into the package — the package only sees the normalized shape.
 */

import {
  deriveTripDuration,
  formatTripDateRange,
  normalizeCityCountry,
  type TripOfferingBrand,
  type TripOfferingData,
  type TripRefundPolicyShape,
} from "@mingla/offering-rendering";

import type { ConsumerTripDetail } from "./useConsumerTripDetail";

// META-ORCH-1174 Leg A.3 — "N days · M nights" derives via the SHARED Hermes-safe
// deriveTripDuration (the RPC's space-separated timestamps broke bare Date.parse
// on native → the days&nights pill was empty). One owner across both surfaces.

function toRefundPolicyShape(
  policy: ConsumerTripDetail["refundPolicy"],
): TripRefundPolicyShape | null {
  if (policy === null) return null;
  return { kind: policy.kind, tiers: policy.tiers };
}

/**
 * META-ORCH-1174 Leg B3 — optional per-tier enrichment from usePublicEventTickets
 * (the SAME source the cart uses): the SERVER all-in (cents) the §10 box DISPLAYS +
 * SUMS (WYSIWYP), plus the per-package description the consumer RPC doesn't carry.
 * Keyed by ticket_type_id. Absent → the body falls back to base price + no desc.
 */
export interface ConsumerTripTierEnrichment {
  allInCents: number | null;
  description: string | null;
}

export function buildConsumerTripOfferingData(
  detail: ConsumerTripDetail,
  enrichmentByTier?: Map<string, ConsumerTripTierEnrichment> | null,
): TripOfferingData {
  const duration = deriveTripDuration(detail.startAt, detail.endAt);
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
    tiers: detail.tiers.map((t) => {
      const enrich = enrichmentByTier?.get(t.ticketTypeId);
      return {
        id: t.ticketTypeId,
        ticketTypeId: t.ticketTypeId,
        tierName: t.tierName,
        priceCents: t.priceCents,
        // META-ORCH-1174 Leg B3 — server all-in (WYSIWYP) from the same tickets
        // source the cart uses. Free → null ("Free"); miss → null → base fallback.
        priceAllInCents:
          t.isFree || t.priceCents === 0 ? null : (enrich?.allInCents ?? null),
        description: enrich?.description ?? null,
        currency: t.currency,
        isFree: t.isFree,
        isUnlimited: t.isUnlimited,
        // META-ORCH-1174 Leg A.2 — real per-tier remaining from the canonical RPC
        // (null when unlimited; no fabricated sold-out — rule 9). Previously always
        // null on consumer; now parity with web/business.
        ticketsRemaining: t.isUnlimited ? null : t.ticketsRemaining,
        installmentSchedule: t.installmentSchedule,
      };
    }),
    currency: detail.currency ?? "USD",
    // META-ORCH-1174 Leg A.2 — destination coords now arrive via the RPC, so the
    // §11 "Where you'll be" map renders on consumer (rule 9 — both must be finite).
    destinationLat: detail.destinationLat,
    destinationLng: detail.destinationLng,
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
