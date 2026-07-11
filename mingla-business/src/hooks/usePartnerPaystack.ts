/**
 * usePartnerPaystack — ORCH-1331 React Query hooks for the partner Paystack
 * payout surface. Mirrors usePartnerStripe.
 *
 *  - usePartnerPaystackStatus()          → the caller's recipient status row
 *  - usePartnerPaystackBanks()           → NG NUBAN bank list (long stale)
 *  - useResolvePartnerPaystackAccount()  → verify account → holder name
 *  - useCreatePartnerPaystackRecipient() → connect bank (invalidates BOTH rails)
 *  - useDisconnectPartnerPaystack()      → soft-detach (invalidates BOTH rails)
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  createPartnerPaystackRecipient,
  disconnectPartnerPaystack,
  getPartnerPaystackStatus,
  listPartnerPaystackBanks,
  partnerPaystackKeys,
  resolvePartnerPaystackAccount,
  type PartnerPaystackRecipientResult,
  type PartnerPaystackResolvedAccount,
  type PartnerPaystackStatusRow,
} from "../services/partnerPaystackService";
import type { PaystackBankOption } from "../services/brandPaystackService";
import { partnerStripeKeys } from "../services/partnerStripeService";
import { useAuth } from "../context/AuthContext";

const DISABLED_KEY = ["partner-paystack-status-disabled"] as const;

export function usePartnerPaystackStatus(): UseQueryResult<
  PartnerPaystackStatusRow,
  Error
> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady;
  return useQuery<PartnerPaystackStatusRow, Error>({
    queryKey: enabled ? partnerPaystackKeys.status() : DISABLED_KEY,
    queryFn: getPartnerPaystackStatus,
    enabled,
    // Mirrors usePartnerStripeStatus — staleTime 0 + refetchOnWindowFocus so a
    // connect/disconnect (or an admin-side change) becomes visible within
    // seconds of the next mingla-business foreground.
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });
}

/** NG NUBAN settlement banks. Static-ish → long stale time. Fetch only when
 * the NG form is actually mounted (`enabled`). */
export function usePartnerPaystackBanks(
  enabled = true,
): UseQueryResult<PaystackBankOption[], Error> {
  return useQuery<PaystackBankOption[], Error>({
    queryKey: enabled ? partnerPaystackKeys.banks() : DISABLED_KEY,
    queryFn: listPartnerPaystackBanks,
    enabled,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export function useResolvePartnerPaystackAccount(): UseMutationResult<
  PartnerPaystackResolvedAccount,
  Error,
  { accountNumber: string; bankCode: string }
> {
  return useMutation<
    PartnerPaystackResolvedAccount,
    Error,
    { accountNumber: string; bankCode: string }
  >({
    mutationFn: ({ accountNumber, bankCode }) =>
      resolvePartnerPaystackAccount(accountNumber, bankCode),
    onError: (error) => {
      console.error("[useResolvePartnerPaystackAccount] failed", {
        message: error.message,
      });
    },
  });
}

export function useCreatePartnerPaystackRecipient(): UseMutationResult<
  PartnerPaystackRecipientResult,
  Error,
  { accountNumber: string; bankCode: string; bankName: string }
> {
  const queryClient = useQueryClient();
  return useMutation<
    PartnerPaystackRecipientResult,
    Error,
    { accountNumber: string; bankCode: string; bankName: string }
  >({
    mutationFn: ({ accountNumber, bankCode, bankName }) =>
      createPartnerPaystackRecipient(accountNumber, bankCode, bankName),
    onSuccess: () => {
      // BOTH rails: the earnings StatusBlock forks on the pair, and the
      // exclusivity lock derives from either status flipping.
      void queryClient.invalidateQueries({
        queryKey: partnerPaystackKeys.status(),
      });
      void queryClient.invalidateQueries({
        queryKey: partnerStripeKeys.status(),
      });
    },
    onError: (error) => {
      console.error("[useCreatePartnerPaystackRecipient] failed", {
        message: error.message,
      });
    },
  });
}

export function useDisconnectPartnerPaystack(): UseMutationResult<
  void,
  Error,
  void
> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => disconnectPartnerPaystack(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: partnerPaystackKeys.status(),
      });
      void queryClient.invalidateQueries({
        queryKey: partnerStripeKeys.status(),
      });
    },
    onError: (error) => {
      console.error("[useDisconnectPartnerPaystack] failed", {
        message: error.message,
      });
    },
  });
}
