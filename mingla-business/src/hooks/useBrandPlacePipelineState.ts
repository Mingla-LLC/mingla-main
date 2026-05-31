/**
 * META-ORCH-1009 Sub-E — business venue deck-readiness state.
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  fetchBrandPlaceAuthoringContext,
  fetchBrandPlacePipelineState,
  type BrandPlaceAuthoringContext,
  type BrandPlacePipelineState,
} from "../services/businessPlaceAuthoringService";

export const brandPlacePipelineKeys = {
  all: ["brandPlacePipelineState"] as const,
  byBrand: (brandId: string) =>
    [...brandPlacePipelineKeys.all, brandId] as const,
  context: (brandId: string, placePoolId: string) =>
    [...brandPlacePipelineKeys.all, brandId, "context", placePoolId] as const,
};

export function useBrandPlacePipelineState(brandId: string | null) {
  const { isAuthReady } = useAuth();
  return useQuery<BrandPlacePipelineState | null>({
    queryKey: brandPlacePipelineKeys.byBrand(brandId ?? ""),
    enabled: isAuthReady && brandId !== null && brandId.length > 0,
    staleTime: 15_000,
    queryFn: () => fetchBrandPlacePipelineState(brandId!),
  });
}

export function useBrandPlaceAuthoringContext(
  brandId: string | null,
  placePoolId: string | null,
) {
  const { isAuthReady } = useAuth();
  return useQuery<BrandPlaceAuthoringContext>({
    queryKey: brandPlacePipelineKeys.context(brandId ?? "", placePoolId ?? ""),
    enabled:
      isAuthReady &&
      brandId !== null &&
      brandId.length > 0 &&
      placePoolId !== null &&
      placePoolId.length > 0,
    staleTime: 15_000,
    queryFn: () =>
      fetchBrandPlaceAuthoringContext({
        brandId: brandId!,
        placePoolId: placePoolId!,
      }),
  });
}
