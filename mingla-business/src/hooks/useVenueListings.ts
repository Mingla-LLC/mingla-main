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

import { venueFeatureKeys } from "./venueFeatureKeys";
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
    // #4490 I1: Admin verifying a venue changes its status elsewhere; the "In review"
    // pill must clear when the host comes back to this tab, without a reload.
    refetchOnWindowFocus: "always",
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
    // #4490 I1: Admin verifying a venue changes its status elsewhere; the "In review"
    // pill must clear when the host comes back to this tab, without a reload.
    refetchOnWindowFocus: "always",
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
    onSuccess: (venueId, input) => {
      void queryClient.invalidateQueries({
        queryKey: venueListingKeys.byBrand(input.brandId),
      });
      void queryClient.invalidateQueries({
        queryKey: brandPlacePipelineKeys.byBrand(input.brandId),
      });
      // #4490 — a new venue starts with its features: the add-venue Features
      // step's own choice when it sent one (D9), else the type's preset
      // (built features only; never switches anything off). Best effort: a
      // refusal (e.g. a team member below admin) leaves every switch to
      // Settings › Venue type and features, so it never blocks the create.
      // Returned so `mutateAsync` resolves once the switches are written and
      // the venue page opens with the right sections.
      // Loaded on demand: the features service stays out of the eager bundle.
      return import("../services/venueFeaturesService")
        .then((mod) =>
          input.startingFeatures !== undefined
            ? mod.applyStartingFeaturesReport(venueId, input.startingFeatures)
            : mod.applyFeaturePreset(venueId, input.venueCategory).then((r) => ({
                state: r.state,
                refused: r.skipped
                  .filter((x) => x.reason.startsWith("requires:"))
                  .map((x) => ({ key: x.key, code: "feature_requires", detail: x.reason.slice("requires:".length) })),
              })),
        )
        .then(({ state, refused }) => {
          queryClient.setQueryData(venueFeatureKeys.features(input.brandId, venueId), state);
          // #4490 N20: the success screen and Overview read what was not
          // switched on, so the host is told instead of finding out later.
          queryClient.setQueryData(venueFeatureKeys.startRefused(venueId), refused);
        })
        .catch(() => undefined);
    },
  });
}
