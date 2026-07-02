import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  fetchPublicBrandVenues,
  getPublicBrandBySlug,
  getPublicEventById,
  getPublicEventBySlug,
  getPublicVenueBySlug,
  getPublicVenueReservable,
  type PublicBrandDetail,
  type PublicEventDetail,
  type PublicVenue,
  type PublicVenueReservable,
  type PublicVenueSummary,
} from "../services/publicEventsService";

const PUBLIC_STALE_TIME_MS = 45 * 1000;

export const publicEventKeys = {
  all: ["public-events"] as const,
  detailBySlug: (
    brandSlug: string,
    eventSlug: string,
  ): readonly ["public-events", "detail-by-slug", string, string] =>
    [...publicEventKeys.all, "detail-by-slug", brandSlug, eventSlug] as const,
  detailById: (
    eventId: string,
  ): readonly ["public-events", "detail-by-id", string] =>
    [...publicEventKeys.all, "detail-by-id", eventId] as const,
  brandBySlug: (
    brandSlug: string,
  ): readonly ["public-events", "brand-by-slug", string] =>
    [...publicEventKeys.all, "brand-by-slug", brandSlug] as const,
  brandUpcoming: (
    brandSlug: string,
  ): readonly ["public-events", "brand", string, "upcoming"] =>
    [...publicEventKeys.all, "brand", brandSlug, "upcoming"] as const,
  // META-ORCH-1255(C) — per-venue public page (/b/{brand}/v/{venue}).
  venueBySlug: (
    brandSlug: string,
    venueSlug: string,
  ): readonly ["public-events", "venue-by-slug", string, string] =>
    [...publicEventKeys.all, "venue-by-slug", brandSlug, venueSlug] as const,
  // META-ORCH-1255(C) — the brand page "Locations" list (SC-12).
  brandVenues: (
    brandSlug: string,
  ): readonly ["public-events", "brand", string, "venues"] =>
    [...publicEventKeys.all, "brand", brandSlug, "venues"] as const,
  // META-ORCH-1255(C) — the venue page reserve display gate (§6.7).
  venueReservable: (
    placePoolId: string,
  ): readonly ["public-events", "venue-reservable", string] =>
    [...publicEventKeys.all, "venue-reservable", placePoolId] as const,
};

const DISABLED_KEY = ["public-events-disabled"] as const;

export const usePublicEventBySlug = (
  brandSlug: string | null,
  eventSlug: string | null,
): UseQueryResult<PublicEventDetail | null> => {
  const enabled = brandSlug !== null && eventSlug !== null;
  return useQuery<PublicEventDetail | null>({
    queryKey: enabled
      ? publicEventKeys.detailBySlug(brandSlug, eventSlug)
      : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_STALE_TIME_MS,
    queryFn: async (): Promise<PublicEventDetail | null> => {
      if (!enabled || brandSlug === null || eventSlug === null) return null;
      return getPublicEventBySlug(brandSlug, eventSlug);
    },
  });
};

export const usePublicEventById = (
  eventId: string | null,
): UseQueryResult<PublicEventDetail | null> => {
  const enabled = eventId !== null;
  return useQuery<PublicEventDetail | null>({
    queryKey: enabled ? publicEventKeys.detailById(eventId) : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_STALE_TIME_MS,
    queryFn: async (): Promise<PublicEventDetail | null> => {
      if (!enabled || eventId === null) return null;
      return getPublicEventById(eventId);
    },
  });
};

export const usePublicBrandBySlug = (
  brandSlug: string | null,
): UseQueryResult<PublicBrandDetail | null> => {
  const enabled = brandSlug !== null;
  return useQuery<PublicBrandDetail | null>({
    queryKey: enabled ? publicEventKeys.brandBySlug(brandSlug) : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_STALE_TIME_MS,
    queryFn: async (): Promise<PublicBrandDetail | null> => {
      if (!enabled || brandSlug === null) return null;
      return getPublicBrandBySlug(brandSlug);
    },
  });
};

/**
 * META-ORCH-1255(C) — anon per-venue page read (/b/{brand}/v/{venue}).
 * Reads ONLY venue_public_view (definer, verified-only); null covers missing
 * AND not-live venues identically (single not-found state, no state leak).
 */
export const usePublicVenueBySlug = (
  brandSlug: string | null,
  venueSlug: string | null,
): UseQueryResult<PublicVenue | null> => {
  const enabled = brandSlug !== null && venueSlug !== null;
  return useQuery<PublicVenue | null>({
    queryKey: enabled
      ? publicEventKeys.venueBySlug(brandSlug, venueSlug)
      : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_STALE_TIME_MS,
    queryFn: async (): Promise<PublicVenue | null> => {
      if (!enabled || brandSlug === null || venueSlug === null) return null;
      return getPublicVenueBySlug(brandSlug, venueSlug);
    },
  });
};

/**
 * META-ORCH-1255(C) — the brand page "Locations" list (SC-12). A SIBLING
 * fetch rather than a getPublicBrandBySlug re-shape: the append-only ve4
 * suite pins that function's exact from() call set + `venue` overlay shape
 * (see the Leg C report deviation ledger).
 */
/**
 * META-ORCH-1255(C) — reserve display gate for the anon venue page (§6.7).
 * Disabled without a place id; error → treated as not-reservable by the
 * caller (fail closed, no dead CTA).
 */
export const usePublicVenueReservable = (
  placePoolId: string | null,
): UseQueryResult<PublicVenueReservable> => {
  const enabled = placePoolId !== null && placePoolId.length > 0;
  return useQuery<PublicVenueReservable>({
    queryKey: enabled
      ? publicEventKeys.venueReservable(placePoolId)
      : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_STALE_TIME_MS,
    queryFn: async (): Promise<PublicVenueReservable> => {
      if (!enabled || placePoolId === null) {
        return { reservable: false, venueId: null, currency: null };
      }
      return getPublicVenueReservable(placePoolId);
    },
  });
};

export const usePublicBrandVenues = (
  brandSlug: string | null,
): UseQueryResult<PublicVenueSummary[]> => {
  const enabled = brandSlug !== null;
  return useQuery<PublicVenueSummary[]>({
    queryKey: enabled ? publicEventKeys.brandVenues(brandSlug) : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_STALE_TIME_MS,
    queryFn: async (): Promise<PublicVenueSummary[]> => {
      if (!enabled || brandSlug === null) return [];
      return fetchPublicBrandVenues(brandSlug);
    },
  });
};
