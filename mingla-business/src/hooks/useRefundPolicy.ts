/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — React Query mutation
 * hooks for refund_policy + booking_deadline writes.
 *
 * Both invalidate the broader business-events tree so trip detail page +
 * wizard re-fetch the updated event.
 *
 * Per SPEC_ORCH-0875 §3.4.
 */

import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import {
  updateBookingDeadline,
  updateRefundPolicy,
  type RefundPolicy,
  type RefundPolicyServiceError,
} from "../services/refundPolicyService";

interface UpdateRefundPolicyInput {
  eventId: string;
  policy: RefundPolicy | null;
}

interface UpdateBookingDeadlineInput {
  eventId: string;
  deadlineIso: string | null;
}

export function useUpdateRefundPolicy(): UseMutationResult<
  void,
  RefundPolicyServiceError,
  UpdateRefundPolicyInput
> {
  const qc = useQueryClient();
  return useMutation<void, RefundPolicyServiceError, UpdateRefundPolicyInput>({
    mutationFn: ({ eventId, policy }) => updateRefundPolicy(eventId, policy),
    onSuccess: () => {
      // Invalidate every business-events query so trip detail + wizard
      // re-fetch the updated refund_policy. Match by prefix so we don't
      // need to know the exact brandId/eventId keys here.
      qc.invalidateQueries({ queryKey: ["businessEvents"] });
      qc.invalidateQueries({ queryKey: ["trip"] });
    },
  });
}

export function useUpdateBookingDeadline(): UseMutationResult<
  void,
  RefundPolicyServiceError,
  UpdateBookingDeadlineInput
> {
  const qc = useQueryClient();
  return useMutation<void, RefundPolicyServiceError, UpdateBookingDeadlineInput>({
    mutationFn: ({ eventId, deadlineIso }) =>
      updateBookingDeadline(eventId, deadlineIso),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["businessEvents"] });
      qc.invalidateQueries({ queryKey: ["trip"] });
    },
  });
}
