/**
 * #4389 — the brand setup checklist (`brand_readiness(brand_setup)`) and the
 * K1 "free events only" write (setup flow and Ari). The writes only one screen
 * makes live with it: F1/F2 in useBrandSetupFlowWrites.ts, T1 in
 * useSetTapLocationAddress.ts (what more than one web chunk imports is hoisted
 * into the eager __common chunk).
 *
 * The checklist is cached under the readiness key for (brand, "brand_setup"),
 * nested in the brand detail key, so every brand write already refreshes it.
 * `staleTime: 0` + refetch on focus: the step is derived from the server on
 * mount and on focus, never stored (R-9, R-13, R-14).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import type { BrandSetupChecklist } from "../services/brandSetupService";
import { brandKeys } from "./brandKeys";
import { brandReadinessKeys } from "./brandReadinessKeys";

const DISABLED_KEY = ["brand-setup-disabled"] as const;

export const brandSetupKey = (brandId: string): readonly unknown[] =>
  brandReadinessKeys.detail(brandId, "brand_setup");

export function useBrandSetupChecklist(
  brandId: string | null,
): UseQueryResult<BrandSetupChecklist, Error> {
  const { isAuthReady, user } = useAuth();
  const enabled = isAuthReady && user !== null && brandId !== null;
  return useQuery<BrandSetupChecklist, Error>({
    queryKey: enabled && brandId !== null ? brandSetupKey(brandId) : DISABLED_KEY,
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<BrandSetupChecklist> => {
      if (brandId === null) throw new Error("useBrandSetupChecklist: brandId is null");
      const { fetchBrandSetupChecklist } = await import("../services/brandSetupService");
      return fetchBrandSetupChecklist(brandId);
    },
  });
}

/** Refresh everything a setup write can change for one brand. */
export function invalidateBrand(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
): void {
  queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
  queryClient.invalidateQueries({ queryKey: brandKeys.lists() });
}

export function useMarkBrandSetupFreeOnly(
  brandId: string | null,
): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (brandId === null) throw new Error("useMarkBrandSetupFreeOnly: no brand");
      const { markBrandSetupFreeOnly } = await import("../services/brandSetupService");
      await markBrandSetupFreeOnly(brandId);
    },
    onSettled: () => {
      if (brandId !== null) invalidateBrand(queryClient, brandId);
    },
  });
}

