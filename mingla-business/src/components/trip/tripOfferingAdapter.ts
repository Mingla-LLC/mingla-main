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
  formatTripDateRange,
  normalizeCityCountry,
  type TripOfferingBrand,
  type TripOfferingData,
  type TripRefundPolicyShape,
} from "@mingla/offering-rendering";

import type { Trip } from "../../services/tripsService";
import type { TripPreviewBrand } from "./TripPreview";

// Derived "N days · M nights" from the trip date range (rule 9 — null when not
// derivable, never fabricated).
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

export function buildTripOfferingData(
  trip: Trip,
  bookable: boolean,
): TripOfferingData {
  const bt = trip.businessTrip;
  const tier = trip.pricingTiers[0];
  const duration = deriveDuration(bt.startAt, bt.endAt);
  const capacity = bt.capacity;
  const isSoldOut =
    tier !== undefined &&
    tier.isUnlimited === false &&
    tier.ticketsRemaining !== null &&
    tier.ticketsRemaining <= 0;
  const spotsLabel =
    capacity !== null
      ? isSoldOut
        ? `Sold out · ${capacity} of ${capacity} booked`
        : tier?.ticketsRemaining != null
          ? `${tier.ticketsRemaining} seats left · ${capacity} max`
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
    tiers: trip.pricingTiers.map((t) => ({
      id: t.id,
      ticketTypeId: t.ticketTypeId,
      tierName: t.tierName,
      priceCents: t.priceCents,
      currency: t.currency,
      isFree: t.priceCents === 0,
      isUnlimited: t.isUnlimited,
      ticketsRemaining: t.ticketsRemaining,
      installmentSchedule: t.installmentSchedule ?? null,
    })),
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
