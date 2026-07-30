import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  getBrandDiscoveryCurrencyState,
  previewBrandCurrencyReconciliation,
  resolveBrandCurrencyReconciliation,
  setBrandProvisionalCurrency,
  type BrandCurrencyReconciliationPreview,
  type BrandDiscoveryCurrencyState,
  type ResolveBrandCurrencyRange,
} from "../services/businessPlaceAuthoringService";
import { brandKeys } from "./brandKeys";
import { brandPlacePipelineKeys } from "./useBrandPlacePipelineState";
import { placeDiscoveryPriceRangeKeys } from "./usePlaceDiscoveryPriceRange";
import { publicVenueAvailabilityKeys } from "./usePublicVenueAvailability";
import { venueListingKeys } from "./useVenueListings";

export const brandDiscoveryCurrencyKeys = {
  all: ["brand-discovery-currency"] as const,
  detail: (brandId: string) =>
    [...brandDiscoveryCurrencyKeys.all, "detail", brandId] as const,
  reconciliation: (brandId: string, reconciliationId: string) =>
    [
      ...brandDiscoveryCurrencyKeys.all,
      "reconciliation",
      brandId,
      reconciliationId,
    ] as const,
};

export function useBrandDiscoveryCurrency(
  brandId: string | null,
): UseQueryResult<BrandDiscoveryCurrencyState, Error> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null;
  return useQuery({
    queryKey: brandDiscoveryCurrencyKeys.detail(brandId ?? ""),
    queryFn: () => getBrandDiscoveryCurrencyState(brandId ?? ""),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useSetBrandProvisionalCurrency(
  brandId: string | null,
): UseMutationResult<
  BrandDiscoveryCurrencyState,
  Error,
  { currencyCode: string; expectedStateVersion: number }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => {
      if (brandId === null) throw new Error("Choose a brand first.");
      return setBrandProvisionalCurrency({
        brandId,
        currencyCode: input.currencyCode,
        expectedStateVersion: input.expectedStateVersion,
      });
    },
    onSuccess: (state) => {
      if (brandId !== null) {
        queryClient.setQueryData(
          brandDiscoveryCurrencyKeys.detail(brandId),
          state,
        );
        void queryClient.invalidateQueries({
          queryKey: brandDiscoveryCurrencyKeys.detail(brandId),
        });
      }
    },
  });
}

export function usePreviewBrandCurrencyReconciliation(
  brandId: string | null,
  reconciliationId: string | null,
): UseMutationResult<BrandCurrencyReconciliationPreview, Error, void> {
  return useMutation({
    mutationFn: () => {
      if (brandId === null || reconciliationId === null) {
        throw new Error("No pending currency review.");
      }
      return previewBrandCurrencyReconciliation({
        brandId,
        reconciliationId,
      });
    },
  });
}

export function useResolveBrandCurrencyReconciliation(
  brandId: string | null,
  reconciliationId: string | null,
): UseMutationResult<
  BrandDiscoveryCurrencyState,
  Error,
  {
    decision: "convert" | "reenter" | "accept_no_ranges";
    fxSnapshotId: string | null;
    ranges: ResolveBrandCurrencyRange[];
  }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => {
      if (brandId === null || reconciliationId === null) {
        throw new Error("No pending currency review.");
      }
      return resolveBrandCurrencyReconciliation({
        brandId,
        reconciliationId,
        ...input,
      });
    },
    onSuccess: async (state) => {
      if (brandId === null || reconciliationId === null) return;
      queryClient.setQueryData(
        brandDiscoveryCurrencyKeys.detail(brandId),
        state,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: brandDiscoveryCurrencyKeys.detail(brandId),
        }),
        queryClient.invalidateQueries({
          queryKey: brandDiscoveryCurrencyKeys.reconciliation(
            brandId,
            reconciliationId,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: placeDiscoveryPriceRangeKeys.all,
        }),
        queryClient.invalidateQueries({
          queryKey: brandPlacePipelineKeys.all,
        }),
        queryClient.invalidateQueries({
          queryKey: venueListingKeys.all,
        }),
        queryClient.invalidateQueries({
          queryKey: brandKeys.detail(brandId),
        }),
        queryClient.invalidateQueries({
          queryKey: publicVenueAvailabilityKeys.all,
        }),
      ]);
    },
  });
}
