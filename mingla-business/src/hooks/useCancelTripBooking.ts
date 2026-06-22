/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — React Query hooks for
 * the cancel-trip-booking edge function (preview reads + commit mutations).
 *
 * Mirrors ORCH-0873 [Tr3 Installment Payments Stage 2 UI] useOrderInstallments
 * pattern: query keys via factory, staleTime calibrated to the SC-22 freshness
 * contract (preview cache invalidates fast so the "Quoted at X" caption stays
 * truthful), mutations invalidate the broader order + installments key trees
 * on success.
 *
 * Per SPEC_ORCH-0875 §3.4.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  commitBuyerCancel,
  commitOperatorCancel,
  previewBuyerCancel,
  previewOperatorCancel,
  type BuyerCommitInput,
  type CancelTripBookingError,
  type CancelTripBookingResult,
  type OperatorCommitInput,
  type RefundPreview,
} from "../services/cancelTripBookingService";
import { orderInstallmentKeys } from "./useOrderInstallments";
import { useAuth } from "../context/AuthContext";

// SC-22 freshness window: preview re-fetches every 60s. Edge fn re-computes
// at commit time and rejects with 409 if amount diverges, but the caption
// "Quoted at {timestamp}" stays roughly truthful within the window.
const REFUND_PREVIEW_STALE_MS = 60 * 1000;

export const cancelTripBookingKeys = {
  all: ["cancelTripBooking"] as const,
  preview: (orderId: string, mode: "buyer" | "operator", token?: string) =>
    ["cancelTripBooking", "preview", orderId, mode, token ?? ""] as const,
};

const DISABLED_KEY = ["cancelTripBooking", "__disabled__"] as const;

/**
 * Buyer-mode preview hook. Uses HMAC token from confirmation email URL.
 * Returns the deterministic refund computation (no side effects).
 */
export function useBuyerRefundPreview(
  orderId: string | null,
  token: string | null,
): UseQueryResult<RefundPreview, CancelTripBookingError> {
  const enabled =
    orderId !== null && orderId.length > 0 && token !== null && token.length > 0;
  return useQuery<RefundPreview, CancelTripBookingError>({
    queryKey: enabled
      ? cancelTripBookingKeys.preview(orderId, "buyer", token)
      : DISABLED_KEY,
    queryFn: async () => {
      if (orderId === null || token === null) {
        throw new Error("orderId + token required");
      }
      return previewBuyerCancel(orderId, token);
    },
    enabled,
    staleTime: REFUND_PREVIEW_STALE_MS,
    // Don't auto-retry on auth errors (invalid token) — buyer needs a fresh link.
    retry: (failureCount, error) => {
      const code = (error as CancelTripBookingError).code;
      if (code === "invalid_token" || code === "token_required" || code === "already_cancelled") {
        return false;
      }
      return failureCount < 2;
    },
  });
}

/**
 * Operator-mode preview hook. Uses authenticated JWT (auto-attached).
 */
export function useOperatorRefundPreview(
  orderId: string | null,
): UseQueryResult<RefundPreview, CancelTripBookingError> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && orderId !== null && orderId.length > 0;
  return useQuery<RefundPreview, CancelTripBookingError>({
    queryKey: enabled
      ? cancelTripBookingKeys.preview(orderId, "operator")
      : DISABLED_KEY,
    queryFn: async () => {
      if (orderId === null) throw new Error("orderId required");
      return previewOperatorCancel(orderId);
    },
    enabled,
    staleTime: REFUND_PREVIEW_STALE_MS,
    retry: (failureCount, error) => {
      const code = (error as CancelTripBookingError).code;
      if (code === "unauthenticated" || code === "already_cancelled") return false;
      return failureCount < 2;
    },
  });
}

/**
 * Buyer-mode commit mutation. On success, invalidates the preview key so
 * subsequent renders show the success state instead of re-fetching preview.
 */
export function useCancelTripBookingBuyer(): UseMutationResult<
  CancelTripBookingResult,
  CancelTripBookingError,
  BuyerCommitInput
> {
  const qc = useQueryClient();
  return useMutation<
    CancelTripBookingResult,
    CancelTripBookingError,
    BuyerCommitInput
  >({
    mutationFn: (input) => commitBuyerCancel(input),
    onSuccess: () => {
      // Invalidate all cancel-trip-booking preview queries (the order's
      // preview will return already_cancelled on next fetch) + order +
      // installment trees so the buyer's success state shows fresh data.
      qc.invalidateQueries({ queryKey: cancelTripBookingKeys.all });
      qc.invalidateQueries({ queryKey: orderInstallmentKeys.all });
    },
    // No global onError — caller (the cancel route) surfaces error via
    // typed CancelTripBookingError + UI banner per design §3.2 State 5.
  });
}

/**
 * Operator-mode commit mutation. Same invalidation strategy.
 */
export function useCancelTripBookingOperator(): UseMutationResult<
  CancelTripBookingResult,
  CancelTripBookingError,
  OperatorCommitInput
> {
  const qc = useQueryClient();
  return useMutation<
    CancelTripBookingResult,
    CancelTripBookingError,
    OperatorCommitInput
  >({
    mutationFn: (input) => commitOperatorCancel(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cancelTripBookingKeys.all });
      qc.invalidateQueries({ queryKey: orderInstallmentKeys.all });
    },
  });
}
