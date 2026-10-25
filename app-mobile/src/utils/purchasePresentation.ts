import type {
  PurchaseKind,
  PurchaseTimelineItem,
} from "./purchaseTimeline";

const STATUS_LABELS: Record<string, string> = {
  approved: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
  paid: "Paid",
  partial_refund: "Partially refunded",
  pending: "Pending",
  refunded: "Refunded",
  valid: "Ready",
};

export function purchaseKindLabel(kind: PurchaseKind): string {
  switch (kind) {
    case "order":
      return "Ticket";
    case "rsvp":
      return "RSVP";
    case "reservation":
      return "Booking";
    case "venue_order":
      return "Receipt";
  }
}

export function purchaseStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ").replace(
    /\b\w/g,
    (letter) => letter.toUpperCase(),
  );
}

export function purchaseCountLabel(item: PurchaseTimelineItem): string {
  const noun = item.kind === "order"
    ? "ticket"
    : item.kind === "rsvp"
    ? "guest"
    : item.kind === "reservation"
    ? "person"
    : "order";
  return `${item.count} ${noun}${item.count === 1 ? "" : "s"}`;
}

export function formatPurchaseMoney(
  amountCents: number | null,
  currency: string | null,
  locale = "en-GB",
): string | null {
  if (amountCents === null || currency === null) return null;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(amountCents / 100).toFixed(2)}`;
  }
}

export function purchaseRefundLabel(
  item: Pick<PurchaseTimelineItem, "refundedAmountCents" | "currency">,
  locale = "en-GB",
): string | null {
  if (item.refundedAmountCents <= 0) return null;
  const formatted = formatPurchaseMoney(
    item.refundedAmountCents,
    item.currency,
    locale,
  );
  return formatted ? `${formatted} refunded` : "Refunded";
}
