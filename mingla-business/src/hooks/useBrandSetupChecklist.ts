/**
 * #4389 — the brand setup checklist (`brand_readiness(brand_setup)`) and the
 * writes behind F1–F4, K1, T1 and N1.
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
import type {
  BrandSetupChecklist,
  CreateSetupBrandResult,
  PayoutCountrySaved,
  TapLocationAddressInput,
} from "../services/brandSetupService";
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
function invalidateBrand(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
): void {
  queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
  queryClient.invalidateQueries({ queryKey: brandKeys.lists() });
}

export function useCreateSetupBrand(): UseMutationResult<
  CreateSetupBrandResult,
  Error,
  { brandId: string; name: string; partnerSetup?: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const { createSetupBrand } = await import("../services/brandSetupService");
      return createSetupBrand(input);
    },
    onSuccess: (result) => {
      invalidateBrand(queryClient, result.brandId);
    },
  });
}

export function useSetBrandPayoutCountry(
  brandId: string | null,
): UseMutationResult<PayoutCountrySaved, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (country) => {
      if (brandId === null) throw new Error("useSetBrandPayoutCountry: no brand");
      const { setBrandPayoutCountry } = await import("../services/brandSetupService");
      return setBrandPayoutCountry(brandId, country);
    },
    onSettled: () => {
      if (brandId !== null) invalidateBrand(queryClient, brandId);
    },
  });
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

export function useSetTapLocationAddress(
  brandId: string | null,
): UseMutationResult<void, Error, TapLocationAddressInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (address) => {
      if (brandId === null) throw new Error("useSetTapLocationAddress: no brand");
      const { setTapLocationAddress } = await import("../services/brandSetupService");
      await setTapLocationAddress(brandId, address);
    },
    onSettled: () => {
      if (brandId !== null) invalidateBrand(queryClient, brandId);
    },
  });
}
