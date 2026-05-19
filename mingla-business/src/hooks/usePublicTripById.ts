/**
 * usePublicTripById — anon-tolerant fetch of a published trip by event-row-id.
 * Mirror of `usePublicEventById` (`./usePublicEvents.ts`) for trips.
 *
 * Used by the new `/checkout-trip/[tripEventId]/*` chain (ORCH-0876) to
 * load a trip for the buyer-facing checkout surface. Pairs with the
 * existing `usePublicTripBySlug` (slug-keyed) — both feed the same
 * PublicTripDetail shape; one by id, one by slug.
 *
 * Anon-tolerant per `feedback_anon_buyer_routes.md`: no useAuth call,
 * no sign-in redirect. Anon Supabase client RLS-restricted via the
 * trip-sidecar-table policies (only scheduled/live trips visible).
 *
 * Query key isolation: `publicTripByIdKeys.detailById(id)` namespace is
 * distinct from `publicEventKeys.detailById(id)`. No cache collision.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  getPublicTripById,
  type PublicTripDetail,
} from "../services/publicEventsService";

const PUBLIC_TRIP_STALE_MS = 60 * 1000; // 1 minute

export const publicTripByIdKeys = {
  all: ["public-trips"] as const,
  detailById: (
    eventId: string,
  ): readonly ["public-trips", "detail-by-id", string] =>
    ["public-trips", "detail-by-id", eventId] as const,
};

const DISABLED_KEY = ["public-trips", "__disabled__"] as const;

export const usePublicTripById = (
  tripEventId: string | null,
): UseQueryResult<PublicTripDetail | null, Error> => {
  const enabled = tripEventId !== null && tripEventId.length > 0;
  return useQuery<PublicTripDetail | null, Error>({
    queryKey: enabled
      ? publicTripByIdKeys.detailById(tripEventId)
      : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_TRIP_STALE_MS,
    queryFn: async () => {
      if (!enabled || tripEventId === null) return null;
      return getPublicTripById(tripEventId);
    },
  });
};
