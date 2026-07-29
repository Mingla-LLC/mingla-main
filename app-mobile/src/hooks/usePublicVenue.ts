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
  return useQuery({
    queryKey: enabled
      ? publicVenueKeys.bySlug(brandSlug, venueSlug)
      : publicVenueKeys.all,
    enabled,
    staleTime: 45_000,
    queryFn: () =>
      enabled
        ? fetchConsumerPublicVenue(brandSlug, venueSlug)
        : Promise.resolve(null),
  });
}
