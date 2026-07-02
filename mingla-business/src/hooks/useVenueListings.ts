/**
 * META-ORCH-1255 Leg B — venue-listings hooks (first-class venue rows).
 *
 * Query keys come from the `venueListingKeys` factory ONLY (Constitution #4).
 * `useVenueListings(brandId)` powers the Hub venue-tab gate + the venue card
 * list; `useVenueListing(venueId)` powers the per-venue management page +
 * VenueListingContent claim fields; `useCreateVenueListing()` is the wizard's
 * submit mutation (invalidates the brand's listing list + pipeline keys so the
 * card list and the hub gate refresh immediately).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  createVenueListing,
  fetchVenueListing,
  fetchVenueListings,
  type CreateVenueListingInput,
  type VenueListing,
} from "../services/venueListingsService";
import { brandPlacePipelineKeys } from "./useBrandPlacePipelineState";

export const venueListingKeys = {
  all: ["venueListings"] as const,
  byBrand: (brandId: string): readonly ["venueListings", "brand", string] =>
    [...venueListingKeys.all, "brand", brandId] as const,
  detail: (venueId: string): readonly ["venueListings", "detail", string] =>
    [...venueListingKeys.all, "detail", venueId] as const,
};

const DISABLED_LIST_KEY = ["venueListings", "disabled"] as const;

export function useVenueListings(
  brandId: string | null,
): UseQueryResult<VenueListing[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<VenueListing[]>({
    queryKey: enabled ? venueListingKeys.byBrand(brandId) : DISABLED_LIST_KEY,
    enabled,
    staleTime: 15_000,
    queryFn: () =>
      enabled ? fetchVenueListings(brandId) : Promise.resolve([]),
  });
}

export function useVenueListing(
  venueId: string | null,
): UseQueryResult<VenueListing | null> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && venueId !== null && venueId.length > 0;
  return useQuery<VenueListing | null>({
    queryKey: enabled
      ? venueListingKeys.detail(venueId)
      : (["venueListings", "detail", "disabled"] as const),
    enabled,
    staleTime: 15_000,
    queryFn: () =>
      enabled ? fetchVenueListing(venueId) : Promise.resolve(null),
  });
}

/**
 * Create a venue listing under the current brand. Returns the new venue id.
 * Invalidates the brand's listing list AND the brand's pipeline keys (the RPC
 * inserts a per-venue pipeline row server-side).
 */
export function useCreateVenueListing(): UseMutationResult<
  string,
  Error,
  CreateVenueListingInput
> {
  const queryClient = useQueryClient();
  return useMutation<string, Error, CreateVenueListingInput>({
    mutationFn: (input) => createVenueListing(input),
    onError: () => {
      // The wizard surfaces the error inline (SlugCollisionError → name step,
      // duplicate-place / sanitized copy → submit error). Nothing swallowed.
    },
    onSuccess: (_venueId, input) => {
      void queryClient.invalidateQueries({
        queryKey: venueListingKeys.byBrand(input.brandId),
      });
      void queryClient.invalidateQueries({
        queryKey: brandPlacePipelineKeys.byBrand(input.brandId),
      });
    },
  });
}
