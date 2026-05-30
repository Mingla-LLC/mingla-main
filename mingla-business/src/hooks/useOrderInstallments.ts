/**
 * ORCH-0873 [Tr3 Installment Payments Stage 2 UI] — React Query hooks for
 * order_installments ledger reads + manual retry mutation.
 *
 * Per SPEC_ORCH-0873 §3.4.1. Polling at staleTime 30s per SPEC_ORCH-0869
 * §3.6 (no realtime in v1; webhook + cron drive backend state, hooks invalidate
 * on retry mutation).
 *
 * Toast usage: existing self-positioning Toast primitive (the toastWrap is a
 * no-op per ORCH-0789, the Toast escapes its parent via Modal/portal). We
 * surface Toast via the AriToast context so the screen-level provider can
 * dedupe + autodismiss.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  fetchInstallmentsForBrandTrips,
  fetchInstallmentsForOrder,
  retryInstallment,
  type OrderInstallment,
  type OrderInstallmentForBrand,
  type RetryInstallmentResult,
} from "../services/orderInstallmentsService";
import { useAuth } from "../context/AuthContext";

const INSTALLMENTS_STALE_MS = 30 * 1000;

interface ByBrandOpts {
  atRiskOnly?: boolean;
  tripEventId?: string;
}

export const orderInstallmentKeys = {
  all: ["orderInstallments"] as const,
  byOrder: (orderId: string) =>
    ["orderInstallments", "byOrder", orderId] as const,
  byBrand: (brandId: string, opts: ByBrandOpts) =>
    ["orderInstallments", "byBrand", brandId, opts] as const,
};

const DISABLED_KEY = ["orderInstallments", "__disabled__"] as const;

export function useInstallmentsForOrder(
  orderId: string | null,
): UseQueryResult<OrderInstallment[], Error> {
  // ORCH-1004 — order_installments is RLS auth.uid()-scoped; gate on auth.
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && orderId !== null && orderId.length > 0;
  return useQuery<OrderInstallment[], Error>({
    queryKey: enabled
      ? orderInstallmentKeys.byOrder(orderId)
      : DISABLED_KEY,
    queryFn: async () => {
      if (orderId === null) return [];
      return fetchInstallmentsForOrder(orderId);
    },
    enabled,
    staleTime: INSTALLMENTS_STALE_MS,
  });
}

export function useInstallmentsForBrandTrips(
  brandId: string | null,
  opts: ByBrandOpts = {},
): UseQueryResult<OrderInstallmentForBrand[], Error> {
  // ORCH-1004 — RLS auth.uid()-scoped; gate on auth readiness.
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<OrderInstallmentForBrand[], Error>({
    queryKey: enabled
      ? orderInstallmentKeys.byBrand(brandId, opts)
      : DISABLED_KEY,
    queryFn: async () => {
      if (brandId === null) return [];
      return fetchInstallmentsForBrandTrips(brandId, opts);
    },
    enabled,
    staleTime: INSTALLMENTS_STALE_MS,
  });
}

/** Friendly translation of biz_retry_installment business-logic rejections. */
function humanizeRetryReason(reason: string): string {
  switch (reason) {
    case "installment_not_found":
      return "Installment not found. Refresh and try again.";
    case "installment_not_failed":
      return "This installment doesn't need a retry right now.";
    case "unauthorized":
      return "You don't have access to retry this installment.";
    case "order_not_found":
    case "event_not_found":
      return "Couldn't load the booking. Refresh and try again.";
    default:
      return "Couldn't queue retry. Try again.";
  }
}

export interface UseRetryInstallmentOptions {
  /**
   * Called with a user-facing message when the mutation completes (success OR
   * known business rejection) OR when the mutation throws. Caller wires this
   * to its preferred Toast surface (the Money tab uses the existing AriToast
   * provider).
   */
  onMessage: (input: {
    kind: "success" | "warning" | "error";
    message: string;
  }) => void;
}

export function useRetryInstallment(
  options: UseRetryInstallmentOptions,
): UseMutationResult<RetryInstallmentResult, Error, string> {
  const queryClient = useQueryClient();
  const { onMessage } = options;
  return useMutation<RetryInstallmentResult, Error, string>({
    mutationFn: (installmentId: string) => retryInstallment(installmentId),
    onSuccess: (result) => {
      // Invalidate ALL installment keys — Money tab + per-order lists both
      // reflect the new scheduled state at next render.
      void queryClient.invalidateQueries({
        queryKey: orderInstallmentKeys.all,
      });
      if (result.ok) {
        onMessage({
          kind: "success",
          message:
            "Retry queued — next cron run will attempt it.",
        });
      } else {
        onMessage({
          kind: "warning",
          message: humanizeRetryReason(result.reason),
        });
      }
    },
    onError: (err) => {
      onMessage({
        kind: "error",
        message: `Couldn't trigger retry. Try again.${
          err.message.length > 0 ? "" : ""
        }`,
      });
    },
  });
}
