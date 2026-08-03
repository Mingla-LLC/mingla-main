import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchListingInsights,
  fetchListingInsightsIdentity,
  type ListingInsightsIdentity,
  type ListingInsightsRollup,
} from "../services/listingInsightsService";

const STALE_TIME_MS = 60_000;

export const listingInsightsKeys = {
  all: ["listing-insights"] as const,
  identity: (id: string) => ["listing-insights", id, "identity"] as const,
  rollup: (id: string) => ["listing-insights", id, "rollup"] as const,
  disabledIdentity: ["listing-insights", "disabled", "identity"] as const,
  disabledRollup: ["listing-insights", "disabled", "rollup"] as const,
};

export interface UseListingInsightsResult {
  identity: UseQueryResult<ListingInsightsIdentity, Error>;
  rollup: UseQueryResult<ListingInsightsRollup, Error>;
}

export const useListingInsights = (
  id: string | null,
  isAuthReady: boolean,
  allowed: boolean,
): UseListingInsightsResult => {
  const enabledIdentity = isAuthReady && allowed && id !== null;
  const identity = useQuery<ListingInsightsIdentity, Error>({
    queryKey:
      enabledIdentity && id !== null
        ? listingInsightsKeys.identity(id)
        : listingInsightsKeys.disabledIdentity,
    enabled: enabledIdentity,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<ListingInsightsIdentity> => {
      if (id === null) throw new Error("listing identity is unavailable");
      return fetchListingInsightsIdentity(id);
    },
  });
  const enabledRollup =
    enabledIdentity && identity.data !== undefined && identity.data.id === id;
  const rollup = useQuery<ListingInsightsRollup, Error>({
    queryKey:
      enabledRollup && id !== null
        ? listingInsightsKeys.rollup(id)
        : listingInsightsKeys.disabledRollup,
    enabled: enabledRollup,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<ListingInsightsRollup> => {
      if (id === null) throw new Error("listing rollup is unavailable");
      return fetchListingInsights(id);
    },
  });
  return { identity, rollup };
};
