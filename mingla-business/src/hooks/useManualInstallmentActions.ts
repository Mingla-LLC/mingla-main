import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  manualChargeInstallment,
  type ManualChargeInstallmentResult,
} from "../services/manualInstallmentChargeService";
import {
  fetchRecentReminderForOrder,
  sendInstallmentReminder,
  type InstallmentReminderResult,
  type RecentInstallmentReminder,
} from "../services/installmentReminderService";
import { orderInstallmentKeys } from "./useOrderInstallments";

export const manualReminderKeys = {
  all: ["manualBuyerReminders"] as const,
  recentByOrder: (orderId: string) =>
    ["manualBuyerReminders", "recentByOrder", orderId] as const,
};

const DISABLED_RECENT_REMINDER_KEY = [
  "manualBuyerReminders",
  "__disabled__",
] as const;

interface ToastMessage {
  kind: "success" | "warning" | "error";
  message: string;
}

interface MutationToastOptions {
  onMessage: (input: ToastMessage) => void;
}

function humanizeChargeNowReason(error: string): string {
  switch (error) {
    case "at_risk_override_required":
      return "Confirm the at-risk override before charging this buyer.";
    case "installment_not_chargeable":
      return "This installment cannot be charged right now.";
    case "forbidden":
      return "Not authorised to charge installments for this brand.";
    case "saved_payment_method_missing":
      return "Buyer has no saved payment method for this installment.";
    default:
      return "Could not start the charge attempt. Try again.";
  }
}

function humanizeReminderReason(error: string): string {
  if (error.toLowerCase().includes("rate limited")) {
    return "Already sent a reminder in the past 24h. Try again later.";
  }
  if (error.toLowerCase().includes("not authorised") || error === "forbidden") {
    return "Not authorised.";
  }
  return "Could not send reminder. Try again.";
}

export function useChargeInstallmentNow(
  options: MutationToastOptions,
): UseMutationResult<
  ManualChargeInstallmentResult,
  Error,
  { installmentId: string; atRiskOverride?: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: manualChargeInstallment,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: orderInstallmentKeys.all });
      if (result.ok) {
        options.onMessage({
          kind: "success",
          message: "Charge attempt sent. Status will refresh shortly.",
        });
      } else {
        options.onMessage({
          kind: "warning",
          message: humanizeChargeNowReason(result.error),
        });
      }
    },
    onError: (err) => {
      options.onMessage({
        kind: "error",
        message: err.message.length > 0
          ? humanizeChargeNowReason(err.message)
          : "Could not start the charge attempt. Try again.",
      });
    },
  });
}

export function useSendInstallmentReminder(
  options: MutationToastOptions,
): UseMutationResult<InstallmentReminderResult, Error, { orderId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sendInstallmentReminder,
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: manualReminderKeys.all });
      void queryClient.invalidateQueries({ queryKey: orderInstallmentKeys.all });
      void queryClient.invalidateQueries({
        queryKey: manualReminderKeys.recentByOrder(variables.orderId),
      });
      if (result.ok) {
        const channels = result.deliveredVia?.length
          ? result.deliveredVia.join(" + ")
          : "ledger";
        options.onMessage({
          kind: "success",
          message: `Reminder sent via ${channels}.`,
        });
      } else {
        options.onMessage({
          kind: "warning",
          message: humanizeReminderReason(result.error ?? "unknown"),
        });
      }
    },
    onError: (err) => {
      options.onMessage({
        kind: "error",
        message: humanizeReminderReason(err.message),
      });
    },
  });
}

export function useRecentReminderForOrder(
  orderId: string | null,
): UseQueryResult<RecentInstallmentReminder | null, Error> {
  const enabled = orderId !== null && orderId.length > 0;
  return useQuery({
    queryKey: enabled
      ? manualReminderKeys.recentByOrder(orderId)
      : DISABLED_RECENT_REMINDER_KEY,
    queryFn: async () => {
      if (orderId === null) return null;
      return fetchRecentReminderForOrder(orderId);
    },
    enabled,
    staleTime: 30 * 1000,
  });
}
