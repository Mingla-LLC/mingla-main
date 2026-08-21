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
  clearPaystackProvider,
  createPaystackRecipient,
  createPaystackSubaccount,
  disconnectPaystack,
  listPaystackBanks,
  refreshPaystackStatus,
  resolvePaystackAccount,
  selectPaystackProvider,
  updatePaystackRecipient,
  updatePaystackSubaccount,
  PaystackBankListError,
  type PaystackBankOption,
  type PaystackOnboardStatus,
  type PaystackRecipientResult,
  type PaystackResolvedAccount,
  type PaystackSubaccountResult,
} from "../services/brandPaystackService";
import { brandKeys } from "./useBrands";
import { useAuth } from "../context/AuthContext";

export const brandPaystackKeys = {
  all: ["brand-paystack"] as const,
  banks: () =>
    [...brandPaystackKeys.all, "banks", "NG", "NGN", "nuban"] as const,
  status: (brandId: string) =>
    [...brandPaystackKeys.all, "status", brandId] as const,
};

const DISABLED_KEY = ["brand-paystack-status-disabled"] as const;

/** NG NUBAN settlement banks. Static-ish → long stale time. */
export function shouldRetryPaystackBankList(
  failureCount: number,
  error: Error,
): boolean {
  if (error instanceof PaystackBankListError) {
    if (error.code === "invalid_response") return false;
    if (error.status === 401 || error.status === 403 || error.status === 426) {
      return false;
    }
  }
  return failureCount < 2;
}

export function useBrandBanks(
  requestedEnabled = true,
): UseQueryResult<PaystackBankOption[], Error> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && requestedEnabled;
  return useQuery<PaystackBankOption[], Error>({
    queryKey: brandPaystackKeys.banks(),
    queryFn: listPaystackBanks,
    enabled,
    staleTime: 1000 * 60 * 60, // 1h — bank list rarely changes
    gcTime: 1000 * 60 * 60 * 2,
    retry: shouldRetryPaystackBankList,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 2000),
  });
}

/** Subaccount readiness for the payments-tab readiness card. */
export function useBrandPaystackStatus(
  brandId: string | null,
): UseQueryResult<PaystackOnboardStatus, Error> {
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady && typeof brandId === "string" && brandId.length > 0;
  return useQuery<PaystackOnboardStatus, Error>({
    queryKey: enabled
      ? brandPaystackKeys.status(brandId as string)
      : DISABLED_KEY,
    queryFn: () => refreshPaystackStatus(brandId as string),
    enabled,
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
      queryClient.invalidateQueries({
        queryKey: brandPaystackKeys.status(brandId),
      });
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

/** Change the settlement bank on the existing subaccount. */
export function useUpdatePaystackSubaccount(): UseMutationResult<
  PaystackSubaccountResult,
  Error,
  ResolveInput
> {
  const queryClient = useQueryClient();
  return useMutation<PaystackSubaccountResult, Error, ResolveInput>({
    mutationFn: ({ brandId, accountNumber, bankCode }) =>
      updatePaystackSubaccount(brandId, accountNumber, bankCode),
    onSuccess: (_data, { brandId }) => {
      queryClient.invalidateQueries({
        queryKey: brandPaystackKeys.status(brandId),
      });
      queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
    },
  });
}

export function useCreatePaystackRecipient(): UseMutationResult<
  PaystackRecipientResult,
  Error,
  ResolveInput
> {
  const queryClient = useQueryClient();
  return useMutation<PaystackRecipientResult, Error, ResolveInput>({
    mutationFn: ({ brandId, accountNumber, bankCode }) =>
      createPaystackRecipient(brandId, accountNumber, bankCode),
    onSuccess: (_data, { brandId }) => {
      queryClient.invalidateQueries({
        queryKey: brandPaystackKeys.status(brandId),
      });
    },
  });
}

export function useUpdatePaystackRecipient(): UseMutationResult<
  PaystackRecipientResult,
  Error,
  ResolveInput
> {
  const queryClient = useQueryClient();
  return useMutation<PaystackRecipientResult, Error, ResolveInput>({
    mutationFn: ({ brandId, accountNumber, bankCode }) =>
      updatePaystackRecipient(brandId, accountNumber, bankCode),
    onSuccess: (_data, { brandId }) => {
      queryClient.invalidateQueries({
        queryKey: brandPaystackKeys.status(brandId),
      });
    },
  });
}

/** Flip the brand onto the Paystack rail (Nigeria) from the country picker. */
export function useSelectPaystackProvider(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (brandId) => selectPaystackProvider(brandId),
    onSuccess: (_data, brandId) => {
      queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
      queryClient.invalidateQueries({ queryKey: brandKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: brandPaystackKeys.status(brandId),
      });
    },
  });
}

/** Revert a not-yet-connected Paystack brand back to Stripe (re-pick country). */
export function useClearPaystackProvider(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (brandId) => clearPaystackProvider(brandId),
    onSuccess: (_data, brandId) => {
      queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
      queryClient.invalidateQueries({ queryKey: brandKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: brandPaystackKeys.status(brandId),
      });
    },
  });
}

/** Disconnect the brand's payout bank. */
export function useDisconnectPaystack(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (brandId) => disconnectPaystack(brandId),
    onSuccess: (_data, brandId) => {
      queryClient.invalidateQueries({
        queryKey: brandPaystackKeys.status(brandId),
      });
      queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
      queryClient.invalidateQueries({ queryKey: brandKeys.lists() });
    },
  });
}
