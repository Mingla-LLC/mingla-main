/**
 * issue #3281 PR10 — optional per-date ticket quantities.
 *
 * Uniform (same tickets for every date): omit byDate; server multiplies.
 * Uneven: send byDate map; quantity is the sum (server trusts the map).
 */

export type ByDateMap = Readonly<Record<string, number>>;

export const sumByDate = (byDate: ByDateMap | null | undefined): number => {
  if (byDate == null) return 0;
  let sum = 0;
  for (const value of Object.values(byDate)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) sum += Math.floor(n);
  }
  return sum;
};

export const uniformByDate = (
  eventDateIds: readonly string[],
  quantity: number,
): Record<string, number> => {
  const q = Math.max(0, Math.floor(quantity));
  const out: Record<string, number> = {};
  for (const id of eventDateIds) {
    if (typeof id === "string" && id.length > 0) out[id] = q;
  }
  return out;
};

export const checkoutLinePayload = (input: {
  ticketTypeId: string;
  quantity: number;
  byDate?: ByDateMap | null;
  sameTicketsForEveryDate: boolean;
  eventDateIds: readonly string[];
}): { ticketTypeId: string; quantity: number; byDate?: Record<string, number> } => {
  const { ticketTypeId, quantity, byDate, sameTicketsForEveryDate, eventDateIds } =
    input;
  if (
    sameTicketsForEveryDate ||
    byDate == null ||
    eventDateIds.length < 2
  ) {
    return { ticketTypeId, quantity };
  }
  const cleaned: Record<string, number> = {};
  for (const id of eventDateIds) {
    const n = Math.floor(Number(byDate[id] ?? 0));
    if (n > 0) cleaned[id] = n;
  }
  const sum = sumByDate(cleaned);
  return {
    ticketTypeId,
    quantity: sum > 0 ? sum : quantity,
    byDate: cleaned,
  };
};

export const capacityExceededCopy = (input: {
  dateLabel: string | null;
}): { message: string; actionLabel: string } => ({
  message:
    input.dateLabel != null && input.dateLabel.length > 0
      ? `${input.dateLabel} just filled up`
      : "That date just filled up",
  actionLabel: "Remove this date and continue",
});
