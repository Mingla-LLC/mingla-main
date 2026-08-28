import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  fetchConsumerPublicVenue,
  type ConsumerPublicVenue,
} from "../services/publicVenueService";

export const publicVenueKeys = {
  all: ["publicVenue"] as const,
  bySlug: (brandSlug: string, venueSlug: string) =>
    [...publicVenueKeys.all, brandSlug, venueSlug] as const,
};

export function usePublicVenue(
  brandSlug: string | null,
  venueSlug: string | null,
): UseQueryResult<ConsumerPublicVenue | null> {
  const enabled = brandSlug !== null && venueSlug !== null;
  return useQuery<ConsumerPublicVenue | null>({
    queryKey: enabled
      ? publicVenueKeys.bySlug(brandSlug, venueSlug)
      : publicVenueKeys.all,
    enabled,
    staleTime: 45_000,
    // #2755: a failed refresh may update core venue truth, but it must not
    // erase the last successful menu subtree from this query's single cache.
    structuralSharing: (oldData: unknown, newData: unknown) => {
      const previous = oldData as ConsumerPublicVenue | null | undefined;
      const next = newData as ConsumerPublicVenue | null;
      return next?.menuState === "error" && previous != null
        ? {
            ...next,
            menu: previous.menu,
            menuWindows: previous.menuWindows,
          }
        : next;
    },
    queryFn: () =>
      enabled
        ? fetchConsumerPublicVenue(brandSlug, venueSlug)
        : Promise.resolve(null),
  });
}
