import {
  queryOptions,
  useQueries,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import {
  fetchPublicBrandVenueStates,
  getPublicBrandBySlug,
  getPublicEventById,
  getPublicEventBySlug,
  getPublicVenueBySlug,
  getPublicVenueDiscoveryPrice,
  getPublicVenueReservable,
  isPublicVenueReservableContractError,
  PUBLIC_VENUE_RESERVABLE_INVALID_RESPONSE,
  validatePublicVenueReservable,
  type PublicBrandDetail,
  type PublicEventDetail,
  type PublicVenue,
  type PublicVenueDiscoveryPrice,
  type PublicVenueReservable,
  type PublicVenueSummary,
} from "../services/publicEventsService";
import { reportNonFatal } from "../diagnostics/reportNonFatal";

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
  // issue #2160 / #2161 — the `occurrences` key is REMOVED. Occurrences now
  // ride the existing detail query (they arrive on the bundle that already
  // served the event), so there is ONE cache key for the page instead of two
  // that can be stale independently of each other, and one fewer round trip.
  // Do not re-add it (I-PROPOSED-2160-D).
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
  // Issue #1365 — the brand page Reservations venue list.
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

/**
 * #2730 — the ONE options owner for the place-keyed reservability entity.
 * Brand cards project labels after this full object leaves the cache; no
 * observer may write a status string under the shared key again.
 */
const publicVenueReservableQueryOptions = (placePoolId: string | null) => {
  const enabled = placePoolId !== null && placePoolId.length > 0;
  return queryOptions({
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
    // Selectors also run for fresh cache hits, so historical string values are
    // rejected before a route can mistake them for operator-disabled truth.
    select: validatePublicVenueReservable,
  });
};

const reportInvalidReservability = (
  placePoolId: string,
  observer: "brand" | "venue",
  error: unknown,
): void => {
  reportNonFatal(
    "publicVenue.reservability.invalidShape",
    error,
    {
      place_pool_id: placePoolId,
      observer,
      error_code: PUBLIC_VENUE_RESERVABLE_INVALID_RESPONSE,
    },
    ["publicVenue.reservability.invalidShape"],
  );
};

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

/**
 * issue #2160 / #2161 — `usePublicEventOccurrences` is DELETED.
 *
 * It stood on `fetchPublicEventOccurrences`, a direct RLS-gated `event_dates`
 * read, which returned nothing for an UNLISTED event even though the event
 * itself rendered fine through its SECURITY DEFINER reader. Occurrences now
 * arrive on `PublicEventDetail.occurrences` from `usePublicEventBySlug` /
 * `usePublicEventById`. Read them from the event, not from a second query.
 */

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
 * Issue #1365 — the brand page Reservations venue list. A SIBLING
 * fetch rather than a getPublicBrandBySlug re-shape so venue availability can
 * load and retry independently from the established Brand content.
 */
/**
 * META-ORCH-1255(C) — reserve display gate for the anon venue page (§6.7).
 * Disabled without a place id; error → treated as not-reservable by the
 * caller (fail closed, no dead CTA).
 */
export const usePublicVenueReservable = (
  placePoolId: string | null,
): UseQueryResult<PublicVenueReservable> => {
  const query = useQuery(publicVenueReservableQueryOptions(placePoolId));
  const wasInvalidRef = useRef<boolean>(false);
  const invalid = isPublicVenueReservableContractError(query.error);
  useEffect(() => {
    if (invalid && !wasInvalidRef.current && placePoolId !== null) {
      reportInvalidReservability(placePoolId, "venue", query.error);
    }
    wasInvalidRef.current = invalid;
  }, [invalid, placePoolId, query.error]);
  return query;
};

export const usePublicVenueDiscoveryPrice = (
  placePoolId: string | null,
): UseQueryResult<PublicVenueDiscoveryPrice | null> => {
  const enabled = placePoolId !== null && placePoolId.length > 0;
  return useQuery({
    queryKey: enabled
      ? [...publicEventKeys.all, "venue-discovery-price", placePoolId]
      : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_STALE_TIME_MS,
    queryFn: () => enabled && placePoolId !== null
      ? getPublicVenueDiscoveryPrice(placePoolId)
      : Promise.resolve(null),
  });
};

interface PublicBrandVenuesQuery {
  data: PublicVenueSummary[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => void;
}

export const usePublicBrandVenues = (
  brandSlug: string | null,
): PublicBrandVenuesQuery => {
  const enabled = brandSlug !== null;
  const venuesQuery = useQuery<PublicVenueSummary[]>({
    queryKey: enabled ? publicEventKeys.brandVenues(brandSlug) : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_STALE_TIME_MS,
    queryFn: async (): Promise<PublicVenueSummary[]> => {
      if (!enabled || brandSlug === null) return [];
      return fetchPublicBrandVenueStates(brandSlug);
    },
  });
  const venues = useMemo(() => venuesQuery.data ?? [], [venuesQuery.data]);
  const reservabilityQueries = useQueries({
    queries: venues.map((venue) =>
      publicVenueReservableQueryOptions(
        typeof venue.placePoolId === "string" ? venue.placePoolId : null,
      ),
    ),
  });
  const invalidObservations = useMemo(
    () =>
      reservabilityQueries.flatMap((query, index) => {
        const placePoolId = venues[index]?.placePoolId;
        return typeof placePoolId === "string" &&
          isPublicVenueReservableContractError(query.error)
          ? [{ placePoolId, error: query.error }]
          : [];
      }),
    [reservabilityQueries, venues],
  );
  const previousInvalidPlacesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const nextInvalidPlaces = new Set(
      invalidObservations.map(({ placePoolId }) => placePoolId),
    );
    for (const { placePoolId, error } of invalidObservations) {
      if (!previousInvalidPlacesRef.current.has(placePoolId)) {
        reportInvalidReservability(placePoolId, "brand", error);
      }
    }
    previousInvalidPlacesRef.current = nextInvalidPlaces;
  }, [invalidObservations]);
  const data: PublicVenueSummary[] = venues.map((venue, index) => {
    const query = reservabilityQueries[index];
    const resolvedState: PublicVenueSummary["reservationState"] =
      query?.data === undefined
        ? undefined
        : query.data.reservable
          ? "available"
          : "unavailable";
    return {
      ...venue,
      reservationState:
        typeof venue.placePoolId !== "string"
          ? "unavailable"
          : query?.isError
            ? "error"
            : (resolvedState ?? "loading"),
    };
  });

  return {
    data,
    isLoading: venuesQuery.isLoading,
    isFetching:
      venuesQuery.isFetching ||
      reservabilityQueries.some((query) => query.isFetching),
    isError: venuesQuery.isError,
    refetch: () => {
      void venuesQuery.refetch();
      for (const query of reservabilityQueries) void query.refetch();
    },
  };
};
