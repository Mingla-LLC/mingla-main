/**
 * useBrandPaystack — React Query hooks for META-ORCH-1076 Phase 2 Paystack
 * payout onboarding (Nigeria). Mirrors the brand-stripe hooks.
 *
 *  - useBrandBanks()              → NG NUBAN bank list for the picker (cached).
 *  - useBrandPaystackStatus()     → subaccount readiness (connected/verified).
 *  - useResolvePaystackAccount()  → verify account number → holder name.
 *  - useCreatePaystackSubaccount()→ create subaccount + flip brand onto Paystack.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  createPaystackSubaccount,
  listPaystackBanks,
  refreshPaystackStatus,
  resolvePaystackAccount,
  type PaystackBankOption,
  type PaystackOnboardStatus,
  type PaystackResolvedAccount,
  type PaystackSubaccountResult,
} from "../services/brandPaystackService";
import { brandKeys } from "./useBrands";

export const brandPaystackKeys = {
  all: ["brand-paystack"] as const,
  banks: () => [...brandPaystackKeys.all, "banks"] as const,
  status: (brandId: string) =>
    [...brandPaystackKeys.all, "status", brandId] as const,
};

/** NG NUBAN settlement banks. Static-ish → long stale time. */
export function useBrandBanks(enabled = true): UseQueryResult<PaystackBankOption[], Error> {
  return useQuery<PaystackBankOption[], Error>({
    queryKey: brandPaystackKeys.banks(),
    queryFn: listPaystackBanks,
    enabled,
    staleTime: 1000 * 60 * 60, // 1h — bank list rarely changes
    gcTime: 1000 * 60 * 60 * 2,
  });
}

/** Subaccount readiness for the payments-tab readiness card. */
export function useBrandPaystackStatus(
  brandId: string | null,
): UseQueryResult<PaystackOnboardStatus, Error> {
  return useQuery<PaystackOnboardStatus, Error>({
    queryKey: brandPaystackKeys.status(brandId ?? "none"),
    queryFn: () => refreshPaystackStatus(brandId as string),
    enabled: typeof brandId === "string" && brandId.length > 0,
    staleTime: 1000 * 30,
  });
}

export interface ResolveInput {
  brandId: string;
  accountNumber: string;
  bankCode: string;
}

/** Verify the account number → holder name (shown for confirmation). */
export function useResolvePaystackAccount(): UseMutationResult<
  PaystackResolvedAccount,
  Error,
  ResolveInput
> {
  return useMutation<PaystackResolvedAccount, Error, ResolveInput>({
    mutationFn: ({ brandId, accountNumber, bankCode }) =>
      resolvePaystackAccount(brandId, accountNumber, bankCode),
  });
}

/** Create the subaccount and flip the brand onto the Paystack rail. */
export function useCreatePaystackSubaccount(): UseMutationResult<
  PaystackSubaccountResult,
  Error,
  ResolveInput
> {
  const queryClient = useQueryClient();
  return useMutation<PaystackSubaccountResult, Error, ResolveInput>({
    mutationFn: ({ brandId, accountNumber, bankCode }) =>
      createPaystackSubaccount(brandId, accountNumber, bankCode),
    onSuccess: (_data, { brandId }) => {
      queryClient.invalidateQueries({ queryKey: brandPaystackKeys.status(brandId) });
      queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
      queryClient.invalidateQueries({ queryKey: brandKeys.lists() });
    },
    onError: (error, { brandId }) => {
      console.error("[useCreatePaystackSubaccount] failed", {
        message: error.message,
        brandId,
      });
    },
  });
}
