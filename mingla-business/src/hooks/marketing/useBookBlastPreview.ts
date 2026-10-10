import { useMutation } from "@tanstack/react-query";
import {
  confirmMarketingBook,
  previewMarketingBook,
} from "../../services/marketing/marketingCampaignService";
import type { MarketingBookQuote } from "../../types/marketing";

interface FeatureResolution {
  data: boolean | undefined;
  isFetched: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
}

export function isBookBlastFeatureReady(
  importFlag: FeatureResolution,
  bookFlag: FeatureResolution,
): boolean {
  return (
    importFlag.isFetched &&
    bookFlag.isFetched &&
    !importFlag.isPending &&
    !bookFlag.isPending &&
    !importFlag.isFetching &&
    !bookFlag.isFetching &&
    !importFlag.isError &&
    !bookFlag.isError &&
    importFlag.data === true &&
    bookFlag.data === true
  );
}

export function getBookBlastDisabledReason(input: {
  featureReady: boolean;
  online: boolean;
  previewPending: boolean;
  previewError: string | null;
  quote: MarketingBookQuote | null;
  nowMs: number;
  channel?: "email" | "sms" | "push";
}): string | null {
  if (!input.featureReady) {
    return "Book blasts aren't available while access is being checked.";
  }
  if (!input.online)
    return "You're offline. Reconnect to refresh this preview.";
  if (input.previewPending) return "Refreshing the server preview…";
  if (input.previewError !== null) return input.previewError;
  if (input.quote === null) {
    return "A fresh server preview is required before confirmation.";
  }
  if (input.nowMs >= Date.parse(input.quote.expiresAt)) {
    return "This preview expired. Refresh it before confirming.";
  }
  if (input.quote.reachableCount === 0) {
    return "No reachable people are available for this channel.";
  }
  const allowance = input.quote.allowance;
  if (allowance && input.channel === "sms") {
    if (input.quote.reachableCount > allowance.smsRemaining) {
      return `This blast needs ${input.quote.reachableCount} texts, but only ${allowance.smsRemaining} of ${allowance.smsCap} remain this month.`;
    }
  }
  if (allowance && input.channel === "email") {
    if (input.quote.reachableCount > allowance.emailRemaining) {
      return `This blast needs ${input.quote.reachableCount} emails, but only ${allowance.emailRemaining} of ${allowance.emailCap} remain this month.`;
    }
  }
  return null;
}

export function useBookBlastPreview() {
  return useMutation({ mutationFn: previewMarketingBook });
}

export function useConfirmBookBlast() {
  return useMutation({ mutationFn: confirmMarketingBook });
}
