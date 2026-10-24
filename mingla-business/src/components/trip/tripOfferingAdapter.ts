/**
 * tripOfferingAdapter — META-ORCH-1174 Leg A [trip-page-standardize].
 *
 * Maps the business `Trip` (+ TripPreviewBrand) into the shared
 * `@mingla/offering-rendering` `TripOfferingData` / `TripOfferingBrand` prop
 * contract the shared `TripOfferingBody` reads. The body is read-path-agnostic —
 * this tiny adapter is the single place the business read shape (usePublicTripBySlug
 * / the pg_public_trip_by_slug RPC) becomes the normalized body contract.
 */

import {
  deriveTripDuration,
  formatTripDateRange,
  normalizeCityCountry,
  type TripOfferingBrand,
  type TripOfferingData,
  type TripRefundPolicyShape,
} from "@mingla/offering-rendering";

import type { Trip, TripPricingTier } from "../../services/tripsService";
import type { TripPreviewBrand } from "./TripPreview";

// META-ORCH-1174 Leg A.3 — "N days · M nights" now derives via the SHARED
// Hermes-safe deriveTripDuration (the canonical RPC returns space-separated
// Postgres timestamps that bare Date.parse rejected on native → no days&nights
// pill). One owner across both surfaces; rule 9 (null when not derivable).

function coerceRefundPolicy(raw: unknown): TripRefundPolicyShape | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as { kind?: unknown; tiers?: unknown };
  if (!Array.isArray(obj.tiers)) return null;
  const tiers = obj.tiers
    .filter(
      (t): t is { days_before_start: number; refund_pct: number } =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as { days_before_start?: unknown }).days_before_start === "number" &&
        typeof (t as { refund_pct?: unknown }).refund_pct === "number",
    )
    .map((t) => ({ days_before_start: t.days_before_start, refund_pct: t.refund_pct }));
  const kind =
    obj.kind === "flexible" ||
    obj.kind === "standard" ||
    obj.kind === "strict" ||
    obj.kind === "custom"
      ? obj.kind
      : "custom";
  return { kind, tiers };
}

/**
 * Issue #3801 — seats still bookable across the whole trip: the sum of every
 * package's remaining seats. Null when there are no packages, when any package
 * has no limit, or when any package's remaining count is unknown (rule 9 — a
 * partial sum is not the trip's number).
 */
export function sumTripSeatsLeft(
  packages: readonly Pick<TripPricingTier, "isUnlimited" | "ticketsRemaining">[],
): number | null {
  if (packages.length === 0) return null;
  let total = 0;
  for (const pkg of packages) {
    if (pkg.isUnlimited) return null;
    if (typeof pkg.ticketsRemaining !== "number" || !Number.isFinite(pkg.ticketsRemaining)) {
      return null;
    }
    total += Math.max(0, pkg.ticketsRemaining);
  }
  return total;
}

export function buildTripOfferingData(
  trip: Trip,
  bookable: boolean,
  // META-ORCH-1174 Leg B3 — the SERVER all-in per ticket_type (cents), resolved by
  // the route via fetchTierAllInCents (pg_public_event_tier_allin). The §10 box +
  // bar DISPLAY + SUM this (WYSIWYP) instead of the bare base. Absent → the body
  // falls back to priceCents (free tiers / RPC miss). NEVER recompute fees here.
  allInByTicketType?: Map<string, number> | null,
): TripOfferingData {
  const bt = trip.businessTrip;
  const tier = trip.pricingTiers[0];
  const duration = deriveTripDuration(bt.startAt, bt.endAt);
  // Issue #3801 — the seats pill describes the whole trip, not its first
  // package. `capacity` is the summed spots of every package (the read fills it
  // through `sumTripPackageSpots`; null when any package has no limit).
  const capacity = bt.capacity;
  const seatsLeft = sumTripSeatsLeft(trip.pricingTiers);
  // Sold out only when every package is: each has a limit and none has a seat.
  const isSoldOut = capacity !== null && seatsLeft !== null && seatsLeft <= 0;
  // No capacity means no honest "max" (or "left") figure: the pill is hidden
  // rather than showing one package's number as the trip's (rule 9).
  const spotsLabel =
    capacity !== null
      ? isSoldOut
        ? `Sold out · ${capacity} of ${capacity} booked`
        : seatsLeft !== null
          ? `${seatsLeft} seats left · ${capacity} max`
          : `${capacity} max`
      : null;

  return {
    id: trip.id,
    title: trip.title,
    description: trip.description,
    startAt: bt.startAt,
    endAt: bt.endAt,
    durationLabel: duration,
    dateRangeLabel: formatTripDateRange(bt.startAt, bt.endAt),
    departureCityCountry: normalizeCityCountry(bt.departureLocationText),
    destinationCityCountry: normalizeCityCountry(bt.destinationLocationText),
    destinationText: bt.destinationLocationText,
    spotsLabel,
    bookingDeadlineIso: trip.bookingDeadline,
    days: trip.days.map((d) => ({
      id: d.id,
      ordinal: d.ordinal,
      title: d.title,
      narrative: d.narrative,
      date: d.date,
      media: d.media.map((m) => ({
        url: m.url,
        type: m.type === "video" ? ("video" as const) : ("image" as const),
      })),
    })),
    inclusions: trip.inclusions.map((i) => ({
      id: i.id,
      kind: i.kind,
      item: i.item,
    })),
    refundPolicy: coerceRefundPolicy(trip.refundPolicy),
    tiers: trip.pricingTiers.map((t) => {
      const allInCents = allInByTicketType?.get(t.ticketTypeId);
      return {
        id: t.id,
        ticketTypeId: t.ticketTypeId,
        tierName: t.tierName,
        priceCents: t.priceCents,
        // META-ORCH-1174 Leg B3 — server all-in (WYSIWYP). Free tier → null (the
        // body shows "Free"); RPC miss → null → fall back to priceCents.
        priceAllInCents:
          t.priceCents === 0
            ? null
            : typeof allInCents === "number"
              ? allInCents
              : null,
        salePriceCents:
          typeof t.salePriceGbp === "number"
            ? Math.round(t.salePriceGbp * 100)
            : null,
        saleAllInCents:
          typeof t.saleAllInGbp === "number"
            ? Math.round(t.saleAllInGbp * 100)
            : null,
        saleEndsAt: t.saleEndsAt ?? null,
        saleName: t.saleName ?? null,
        saleRemaining: t.saleRemaining ?? null,
        description: t.description ?? null,
        currency: t.currency,
        isFree: t.priceCents === 0,
        isUnlimited: t.isUnlimited,
        ticketsRemaining: t.ticketsRemaining,
        installmentSchedule: t.installmentSchedule ?? null,
      };
    }),
    currency: tier?.currency ?? "USD",
    destinationLat: bt.destinationLat,
    destinationLng: bt.destinationLng,
    bookable,
    bookingsClosed: trip.bookingsClosed === true,
  };
}

export function buildTripOfferingBrand(brand: TripPreviewBrand): TripOfferingBrand {
  return {
    id: brand.id,
    slug: brand.slug,
    name: brand.name,
    bio: brand.bio ?? null,
    coverMediaUrl: brand.coverMediaUrl ?? null,
    coverMediaType: brand.coverMediaType ?? null,
    coverHue: brand.coverHue ?? null,
    verified: false,
  };
}
