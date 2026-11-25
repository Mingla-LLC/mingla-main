/**
 * #4490 spec 08 O5 part C (T16) — the guest's view of a line that sold out
 * after they paid (venue-order-status `soldOut`). Pure, with no imports, so
 * the buyer order page can read it without loading the ordering transport.
 */
/** #4490 O5 part C (T16): a line that sold out after the guest paid. */
export interface GuestSoldOutLine {
  itemName: string;
  quantity: number;
  resolution: "swap" | "refund" | null;
  swappedToName: string | null;
  refundedMinor: number | null;
}

export function parseGuestSoldOut(raw: unknown): GuestSoldOutLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (row === null || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    if (typeof r.itemName !== "string") return [];
    return [{
      itemName: r.itemName,
      quantity: typeof r.quantity === "number" ? r.quantity : 1,
      resolution: r.resolution === "swap" || r.resolution === "refund" ? r.resolution : null,
      swappedToName: typeof r.swappedToName === "string" ? r.swappedToName : null,
      refundedMinor: typeof r.refundedMinor === "number" ? r.refundedMinor : null,
    }];
  });
}

/** The sold-out lines a fetched status carries (empty when none). */
export function guestSoldOutOf(status: unknown): GuestSoldOutLine[] {
  const lines = (status as { soldOut?: unknown } | null)?.soldOut;
  return Array.isArray(lines) ? (lines as GuestSoldOutLine[]) : [];
}

/** The guest order page's words for a line that sold out after paying (also in STOCK_COPY). */
export const GUEST_SOLD_OUT_COPY = {
  guestSwappedTitle: (item: string, swap: string): string => `${item} sold out, so the kitchen swapped it for ${swap}`,
  guestSwappedSame: "Same price, so nothing changes on your bill. We've texted and emailed you too.",
  guestSwappedBack: (amount: string): string =>
    `${amount} is on its way back to your card. Banks can take 5 to 10 working days.`,
  guestRefundTitle: (item: string): string => `${item} sold out after you paid`,
  guestRefundBody: (amount: string): string =>
    `${amount} is on its way back to your card. Banks can take 5 to 10 working days.`,
  guestWaitingBody: "The venue is choosing a swap or a refund. You won't pay for anything you don't get.",
} as const;
