import type { DiscountReasonCopyInput } from "./discountQuote";

/** Binding copy from #3872 spec v4 §10.6. */
export const discountReasonCopy = ({
  reason,
  code,
  date = null,
  required = null,
  withName = null,
}: DiscountReasonCopyInput): string => {
  switch (reason) {
    case "not_found":
      return "That code doesn't exist.";
    case "paused":
      return `${code} isn't available right now.`;
    case "not_started":
      return `${code} starts ${date ?? "later"}.`;
    case "ended":
      return `${code} has ended.`;
    case "used_up":
      return `${code} has been fully used.`;
    case "buyer_limit":
      return `You've already used ${code}.`;
    case "queue":
      return "Codes can't be used while you're in the queue.";
    case "not_applicable":
      return `${code} isn't valid for these items.`;
    case "min_subtotal":
      return `Add ${required ?? "more"} more to use ${code}.`;
    case "incompatible_better_automatic":
      return `${code} can't be combined with ${withName ?? "this offer"} — you already have the better price.`;
  }
};
