/**
 * useConsumerTripDetail — composes a consumer trip-detail view from anon-granted
 * sources only (ORCH-1016). NEVER `.from('brands')` / `.from('tickets')`
 * (COMMS-0009 / I-ANON-BRANDS-VIA-DEFINER-VIEW). Does NOT copy
 * mingla-business/usePublicTripBySlug.ts (which reads brands directly — NG-4).
 *
 * Sources:
 *  - Card seed (DiscoverTripRow) for instant paint, OR a pg_published_trips_public
 *    re-fetch by destination/departure for cold deep-link open.
 *  - Anon-direct reads of events (refund_policy, departure_text, description),
 *    event_dates (master), trip_days, trip_inclusions, trip_pricing_tiers +
 *    ticket_types (tiers/price/intake mapping).
 *  - Brand name/verified come from the seed (RPC-sourced) or business_public_brands_view.
 */

import { useQuery } from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import {
  fetchPublishedTrips,
  type DiscoverTripRow,
} from "../services/tripsDiscoveryService";

export interface TripDetailDay {
  id: string;
  ordinal: number;
  title: string;
  narrative: string | null;
}
export interface TripDetailInclusion {
  id: string;
  kind: "included" | "excluded";
  item: string;
  ordinal: number;
}
export interface TripDetailTier {
  ticketTypeId: string;
  tierName: string;
  priceCents: number;
  currency: string;
  isFree: boolean;
  isUnlimited: boolean;
  quantityTotal: number | null;
}
export interface RefundPolicyTier {
  days_before_start: number;
  refund_pct: number;
}
export interface RefundPolicyShape {
  kind: "flexible" | "standard" | "strict" | "custom";
  tiers: RefundPolicyTier[];
}

export interface ConsumerTripDetail {
  tripId: string;
  tripSlug: string;
  brandSlug: string;
  brandName: string;
  brandVerified: boolean;
  title: string;
  description: string | null;
  destinationText: string | null;
  departureText: string | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  bookingsClosed: boolean;
  bookingDeadline: string | null;
  totalCapacity: number | null;
  spotsLeft: number | null;
  minPriceCents: number | null;
  currency: string | null;
  hasFreeTier: boolean;
  /**
   * ORCH-1117 / ORCH-1076 — when false this is a PAID trip whose brand can't
   * charge yet; the floating Reserve bar renders a NON-tappable "Booking
   * unavailable" info strip. Free trips (and resolver errors) are true
   * (fail-open; the checkout 409 / cart-toast remains the backstop).
   */
  bookable: boolean;
  refundPolicy: RefundPolicyShape | null;
  days: TripDetailDay[];
  inclusions: TripDetailInclusion[];
  tiers: TripDetailTier[];
}

// ORCH-1117 (OQ-C) — the native trip-detail hook gains the SAME pg_brand_can_charge
// gate the web trip/event/experience resolvers have. PAID ⇒ gated; FREE ⇒ true;
// RPC error ⇒ true (fail-open). Uses ev.brand_id from the anon-direct events read
// (NOT the discover-cards supply — that stays out of scope per OQ-B).
async function resolveTripBookable(
  brandId: string | null,
  isPaid: boolean,
): Promise<boolean> {
  if (!isPaid || brandId === null) return true;
  const { data, error } = await supabase.rpc("pg_brand_can_charge", {
    p_brand_id: brandId,
  });
  if (error !== null) return true;
  return data === true;
}

export const consumerTripDetailKeys = {
  all: ["consumerTripDetail"] as const,
  detail: (brandSlug: string, tripSlug: string) =>
    [...consumerTripDetailKeys.all, brandSlug, tripSlug] as const,
};

interface EventDetailRow {
  id: string;
  slug: string;
  brand_id: string;
  title: string;
  description: string | null;
  destination_text: string | null;
  departure_text: string | null;
  cover_media_url: string | null;
  cover_media_type: string | null;
  timezone: string | null;
  bookings_closed: boolean | null;
  booking_deadline: string | null;
  refund_policy: unknown;
}

function coerceCoverType(raw: string | null): "image" | "video" | "gif" | null {
  return raw === "image" || raw === "video" || raw === "gif" ? raw : null;
}

function coerceRefundPolicy(raw: unknown): RefundPolicyShape | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as { kind?: unknown; tiers?: unknown };
  if (!Array.isArray(obj.tiers)) return null;
  const tiers: RefundPolicyTier[] = obj.tiers
    .filter(
      (t): t is { days_before_start: number; refund_pct: number } =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as { days_before_start?: unknown }).days_before_start === "number" &&
        typeof (t as { refund_pct?: unknown }).refund_pct === "number",
    )
    .map((t) => ({ days_before_start: t.days_before_start, refund_pct: t.refund_pct }));
  const kind =
    obj.kind === "flexible" || obj.kind === "standard" || obj.kind === "strict" || obj.kind === "custom"
      ? obj.kind
      : "custom";
  return { kind, tiers };
}

async function fetchTripDetail(
  brandSlug: string,
  tripSlug: string,
  seed: DiscoverTripRow | null,
): Promise<ConsumerTripDetail> {
  // Resolve the feed-shaped row (seed when present, else re-fetch by slug match).
  let feedRow: DiscoverTripRow | null = seed;
  if (feedRow === null || feedRow.tripSlug !== tripSlug) {
    // Cold deep-link open: pull a page and match the slug. The RPC has no
    // by-slug param, but the feed is small; filter on destination is not needed.
    const { rows } = await fetchPublishedTrips(
      {
        destinationQuery: null,
        departureQuery: null,
        dateFrom: null,
        dateTo: null,
        minPriceCents: null,
        maxPriceCents: null,
        groupSizeMin: null,
        groupSizeMax: null,
        sort: "relevance",
      },
      { limit: 50, offset: 0 },
    );
    feedRow =
      rows.find((r) => r.tripSlug === tripSlug && r.brandSlug === brandSlug) ?? null;
  }
  if (feedRow === null) {
    throw new Error("Trip not found or no longer available.");
  }
  const tripId = feedRow.tripId;

  // Anon-direct reads (events is anon-SELECT; NO brands/tickets table reads).
  const [eventResp, daysResp, inclResp, tiersResp] = await Promise.all([
    supabase
      .from("events")
      .select(
        "id, slug, brand_id, title, description, destination_text, departure_text, cover_media_url, cover_media_type, timezone, bookings_closed, booking_deadline, refund_policy",
      )
      .eq("id", tripId)
      .maybeSingle(),
    supabase.from("trip_days").select("id, ordinal, title, narrative").eq("event_id", tripId).order("ordinal"),
    supabase
      .from("trip_inclusions")
      .select("id, kind, item, ordinal")
      .eq("event_id", tripId)
      .order("ordinal"),
    supabase
      .from("trip_pricing_tiers")
      .select("ticket_type_id, ticket_types(id, name, price_cents, currency, is_free, is_unlimited, quantity_total, is_hidden, deleted_at)")
      .eq("event_id", tripId),
  ]);

  if (eventResp.error) throw eventResp.error;
  if (daysResp.error) throw daysResp.error;
  if (inclResp.error) throw inclResp.error;
  if (tiersResp.error) throw tiersResp.error;

  const ev = (eventResp.data ?? null) as EventDetailRow | null;

  const days: TripDetailDay[] = (daysResp.data ?? []).map((d) => ({
    id: String((d as { id: string }).id),
    ordinal: (d as { ordinal: number }).ordinal,
    title: (d as { title: string }).title,
    narrative: (d as { narrative: string | null }).narrative ?? null,
  }));

  const inclusions: TripDetailInclusion[] = (inclResp.data ?? []).map((i) => ({
    id: String((i as { id: string }).id),
    kind: (i as { kind: "included" | "excluded" }).kind,
    item: (i as { item: string }).item,
    ordinal: (i as { ordinal: number }).ordinal,
  }));

  const tiers: TripDetailTier[] = (tiersResp.data ?? [])
    .map((row) => {
      const tt = (row as { ticket_types: unknown }).ticket_types as
        | {
            id: string;
            name: string;
            price_cents: number;
            currency: string;
            is_free: boolean;
            is_unlimited: boolean;
            quantity_total: number | null;
            is_hidden: boolean | null;
            deleted_at: string | null;
          }
        | null;
      if (tt === null || tt.deleted_at !== null || tt.is_hidden === true) return null;
      return {
        ticketTypeId: tt.id,
        tierName: tt.name,
        priceCents: tt.price_cents,
        currency: tt.currency,
        isFree: tt.is_free === true,
        isUnlimited: tt.is_unlimited === true,
        quantityTotal: tt.quantity_total,
      };
    })
    .filter((t): t is TripDetailTier => t !== null);

  // ORCH-1117 — a trip is PAID when its cheapest tier costs > 0. Resolve the
  // brand's charge-readiness for the floating Reserve bar's unavailable state.
  const isPaid = (feedRow.minPriceCents ?? 0) > 0;
  const bookable = await resolveTripBookable(ev?.brand_id ?? null, isPaid);

  return {
    tripId,
    tripSlug: feedRow.tripSlug,
    brandSlug: feedRow.brandSlug,
    brandName: feedRow.brandName,
    brandVerified: feedRow.brandVerified,
    title: ev?.title ?? feedRow.title,
    description: ev?.description ?? feedRow.description,
    destinationText: ev?.destination_text ?? feedRow.destinationText,
    departureText: ev?.departure_text ?? feedRow.departureText,
    coverMediaUrl: ev?.cover_media_url ?? feedRow.coverMediaUrl,
    coverMediaType: coerceCoverType(ev?.cover_media_type ?? feedRow.coverMediaType),
    startAt: feedRow.startAt,
    endAt: feedRow.endAt,
    timezone: ev?.timezone ?? feedRow.timezone,
    bookingsClosed: ev?.bookings_closed === true || feedRow.bookingsClosed,
    bookingDeadline: ev?.booking_deadline ?? feedRow.bookingDeadline,
    totalCapacity: feedRow.totalCapacity,
    spotsLeft: feedRow.spotsLeft,
    minPriceCents: feedRow.minPriceCents,
    currency: feedRow.currency,
    hasFreeTier: feedRow.hasFreeTier,
    bookable,
    refundPolicy: coerceRefundPolicy(ev?.refund_policy ?? null),
    days,
    inclusions,
    tiers,
  };
}

export interface UseConsumerTripDetailResult {
  detail: ConsumerTripDetail | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useConsumerTripDetail(
  brandSlug: string | null,
  tripSlug: string | null,
  seed: DiscoverTripRow | null,
): UseConsumerTripDetailResult {
  const enabled = brandSlug !== null && tripSlug !== null;
  const query = useQuery<ConsumerTripDetail, Error>({
    queryKey: enabled
      ? consumerTripDetailKeys.detail(brandSlug as string, tripSlug as string)
      : consumerTripDetailKeys.all,
    queryFn: () => fetchTripDetail(brandSlug as string, tripSlug as string, seed),
    enabled,
    staleTime: 30_000,
  });
  return {
    detail: query.data ?? null,
    isLoading: query.isLoading && enabled,
    isError: query.isError,
    error: query.error ?? null,
    refetch: () => {
      void query.refetch();
    },
  };
}
