/**
 * tripsDiscoveryService — consumer-app read layer for the Discover > Trips feed.
 *
 * ORCH-1016 [Consumer Discover Trips tab]. Calls the global SECURITY DEFINER RPC
 * `pg_published_trips_public` (anon-granted). This RPC is the ONLY anon path to
 * planner name + verified badge + spots_left (COMMS-0009 — NEVER `.from('brands')`
 * or `.from('tickets')` from the consumer/anon client).
 *
 * Error contract (Constitution rule 3 — no silent failures): on RPC error this
 * THROWS a typed TripsDiscoveryError. No swallow, no `return []` on failure.
 *
 * No mobile cache (I-PROPOSED-DISCOVER-NO-MOBILE-CACHE): React Query is the only
 * cache. Do NOT add AsyncStorage/in-memory caching here.
 */

import type { EventCoverMediaType } from "@mingla/offering-rendering";

import { supabase } from "./supabase";

/** Sort modes accepted by the RPC `p_sort` param. */
export type DiscoverTripSort = "relevance" | "oldest" | "price_asc" | "price_desc";

/** One row from pg_published_trips_public, camelCased 1:1 from the RPC columns. */
export interface DiscoverTripRow {
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
  coverMediaType: EventCoverMediaType | null;
  status: string;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  bookingsClosed: boolean;
  bookingDeadline: string | null;
  totalCapacity: number | null;
  ticketsSold: number;
  spotsLeft: number | null;
  minPriceCents: number | null;
  currency: string | null;
  hasFreeTier: boolean;
  publishedAt: string | null;
  totalCount: number;
}

/** Consumer-facing filter state. Departure is SEPARATE from destination. */
export interface DiscoverTripFilters {
  destinationQuery: string | null;
  departureQuery: string | null;
  dateFrom: string | null; // ISO
  dateTo: string | null; // ISO
  minPriceCents: number | null;
  maxPriceCents: number | null;
  groupSizeMin: number | null;
  groupSizeMax: number | null;
  sort: DiscoverTripSort;
}

/** Default filter state (all open, newest sort). */
export const EMPTY_DISCOVER_TRIP_FILTERS: DiscoverTripFilters = {
  destinationQuery: null,
  departureQuery: null,
  dateFrom: null,
  dateTo: null,
  minPriceCents: null,
  maxPriceCents: null,
  groupSizeMin: null,
  groupSizeMax: null,
  sort: "relevance",
};

/** Typed error surfaced to the hook so the UI can show a retry affordance. */
export class TripsDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TripsDiscoveryError";
  }
}

/** Raw RPC row (snake_case) as returned by Supabase. */
interface RpcTripRow {
  trip_id: string;
  trip_slug: string;
  brand_slug: string;
  brand_name: string;
  brand_verified: boolean;
  title: string;
  description: string | null;
  destination_text: string | null;
  departure_text: string | null;
  cover_media_url: string | null;
  cover_media_type: string | null;
  status: string;
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  bookings_closed: boolean;
  booking_deadline: string | null;
  total_capacity: number | null;
  tickets_sold: number;
  spots_left: number | null;
  min_price_cents: number | null;
  currency: string | null;
  has_free_tier: boolean;
  published_at: string | null;
  total_count: number;
}

const VALID_COVER_TYPES: ReadonlyArray<EventCoverMediaType> = ["image", "video", "gif"];

function coerceCoverType(raw: string | null): EventCoverMediaType | null {
  return raw !== null && (VALID_COVER_TYPES as ReadonlyArray<string>).includes(raw)
    ? (raw as EventCoverMediaType)
    : null;
}

function mapRow(r: RpcTripRow): DiscoverTripRow {
  return {
    tripId: r.trip_id,
    tripSlug: r.trip_slug,
    brandSlug: r.brand_slug,
    brandName: r.brand_name,
    brandVerified: r.brand_verified === true,
    title: r.title,
    description: r.description,
    destinationText: r.destination_text,
    departureText: r.departure_text,
    coverMediaUrl: r.cover_media_url,
    coverMediaType: coerceCoverType(r.cover_media_type),
    status: r.status,
    startAt: r.start_at,
    endAt: r.end_at,
    timezone: r.timezone,
    bookingsClosed: r.bookings_closed === true,
    bookingDeadline: r.booking_deadline,
    totalCapacity: r.total_capacity,
    ticketsSold: typeof r.tickets_sold === "number" ? r.tickets_sold : 0,
    spotsLeft: r.spots_left,
    minPriceCents: r.min_price_cents,
    currency: r.currency,
    hasFreeTier: r.has_free_tier === true,
    publishedAt: r.published_at,
    totalCount: typeof r.total_count === "number" ? r.total_count : 0,
  };
}

export interface FetchPublishedTripsPage {
  rows: DiscoverTripRow[];
  totalCount: number;
}

/**
 * Fetch one page of published trips via the global anon RPC. Maps camelCase
 * filters → p_* args. Throws TripsDiscoveryError on RPC error (never swallows).
 */
export async function fetchPublishedTrips(
  filters: DiscoverTripFilters,
  page: { limit: number; offset: number },
): Promise<FetchPublishedTripsPage> {
  const { data, error } = await supabase.rpc("pg_published_trips_public", {
    p_destination_query: filters.destinationQuery,
    p_departure_query: filters.departureQuery,
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_min_price_cents: filters.minPriceCents,
    p_max_price_cents: filters.maxPriceCents,
    p_group_size_min: filters.groupSizeMin,
    p_group_size_max: filters.groupSizeMax,
    p_sort: filters.sort,
    p_limit: page.limit,
    p_offset: page.offset,
  });

  if (error) {
    throw new TripsDiscoveryError(
      error.message || "Couldn't load trips. Tap to try again.",
    );
  }

  const raw = (data ?? []) as RpcTripRow[];
  const rows = raw.map(mapRow);
  // total_count is a window COUNT(*) OVER () repeated on every row; empty page → 0.
  const totalCount = rows.length > 0 ? rows[0].totalCount : 0;
  return { rows, totalCount };
}
