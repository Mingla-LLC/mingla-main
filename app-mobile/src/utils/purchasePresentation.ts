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
  // #4490 Explorer W2 — venue bookings, plans and waitlist places.
  partially_cancelled: "Partly cancelled",
  request_pending: "Requested",
  requested: "Requested",
  approved_payment_required: "Pay to hold your date",
  declined: "Declined",
  request_expired: "Request closed",
  instant_payment_pending: "Payment pending",
  finalizing: "Payment pending",
  reconciliation_required: "Checking payment",
  active: "Active",
  payment_due: "Payment due",
  grace: "Payment due",
  lapsed: "Paused",
  paused: "Paused",
  waiting: "Waiting",
  notified: "Table ready",
  converted: "Booked",
  expired: "Ended",
  lost: "Left",
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
    case "stay":
      return "Stay";
    case "venue_booking":
      return "Pass";
    case "venue_membership":
      return "Plan";
    case "venue_waitlist":
      return "Waitlist";
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
    : item.kind === "rsvp" || item.kind === "venue_booking" ||
        item.kind === "venue_waitlist"
    ? "guest"
    : item.kind === "venue_membership"
    ? "plan"
    : item.kind === "reservation"
    ? "person"
    : item.kind === "stay"
    ? "stay"
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

/** #4473 — a label with no repeated parts ("Harbour House · Harbour House" → once). */
export function joinDistinct(parts: readonly (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const value = part?.trim() ?? "";
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out.join(" · ");
}
