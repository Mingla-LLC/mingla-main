/**
 * #4389 — the setup flow's own writes: F1 create the brand (and adopt it into
 * the caches), F2 save the bank country, N1 discard a draft. Only the setup
 * flow's chunk loads this module.
 */
import { useCallback } from "react";
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import type {
  BrandDeleteOutcome,
  CreateSetupBrandResult,
  PayoutCountrySaved,
} from "../services/brandSetupService";
import type { Brand } from "../store/currentBrandStore";
import { brandKeys } from "./brandKeys";
import { invalidateBrand } from "./useBrandSetupChecklist";
import { evictDeletedBrandFromCaches, type BrandQueryClient } from "./useBrands";
import { creatorAccountKeys, type CreatorAccountRow } from "./useCreatorAccount";

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

/**
 * #4389 — a brand created outside useCreateBrand (the setup RPC) is written
 * into the list, detail and default-brand caches BEFORE it is made current, so
 * `useCurrentBrandRecovery` sees it at once and never resolves the pointer
 * back to a stale default or "none" while the list refetch is in flight.
 */
export const adoptBrandIntoCaches = (
  queryClient: BrandQueryClient,
  brand: Brand,
  accountId: string,
): void => {
  queryClient.setQueryData<Brand[]>(brandKeys.list(accountId), (prev) =>
    prev === undefined
      ? [brand]
      : prev.some((b) => b.id === brand.id)
        ? prev.map((b) => (b.id === brand.id ? brand : b))
        : [brand, ...prev],
  );
  queryClient.setQueryData<Brand>(brandKeys.detail(brand.id), brand);
  queryClient.setQueryData<CreatorAccountRow | null>(
    creatorAccountKeys.byId(accountId),
    (prev) => (prev != null ? { ...prev, default_brand_id: brand.id } : prev),
  );
};

/**
 * #4389 N1 — "Discard and start new". Same cache contract as delete.
 */
export const useDiscardDraftBrand = (
  accountId: string | null,
): ((brandId: string) => Promise<BrandDeleteOutcome>) => {
  const queryClient = useQueryClient();
  return useCallback(
    async (brandId: string): Promise<BrandDeleteOutcome> => {
      const { discardDraftBrand } = await import("../services/brandSetupService");
      const outcome = await discardDraftBrand(brandId);
      if (outcome.ok && accountId !== null) {
        evictDeletedBrandFromCaches(queryClient, brandId, accountId);
      }
      return outcome;
    },
    [accountId, queryClient],
  );
};
