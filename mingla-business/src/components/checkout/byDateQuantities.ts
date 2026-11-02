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

/**
 * issue #3281 — a day-limited ticket covers only some chosen dates, so a per-day
 * line must name them: a uniform line would charge the dates it can't admit.
 * Dates are all covered, or the pass is one price: the line stays uniform.
 */
export const dayLimitedLine = (
  validIds: readonly string[] | null | undefined,
  quantity: number,
  eventDateIds: readonly string[],
  perDay: boolean,
): { quantity: number; byDate?: Record<string, number> } => {
  const inScope = eventDateIds.filter((id) => validIds?.includes(id));
  if (
    validIds === null ||
    validIds === undefined ||
    !perDay ||
    inScope.length === 0 ||
    inScope.length === eventDateIds.length
  ) {
    return { quantity };
  }
  return { quantity: quantity * inScope.length, byDate: uniformByDate(inScope, quantity) };
};

/** Switching to per-date steppers starts each covered date on the same count. */
export const perDateLine = (
  validIds: readonly string[] | null | undefined,
  quantity: number,
  eventDateIds: readonly string[],
): { quantity: number; byDate: Record<string, number> } => {
  const dates = eventDateIds.filter(
    (id) => validIds === null || validIds === undefined || validIds.includes(id),
  );
  return { quantity: quantity * dates.length, byDate: uniformByDate(dates, quantity) };
};

/** The per-date count a day-limited line was built from. */
export const quantityPerDate = (line: {
  quantity: number;
  byDate?: ByDateMap;
}): number =>
  line.byDate === undefined
    ? line.quantity
    : Math.max(0, ...Object.values(line.byDate));

export const ticketCoversAnyDate = (
  validIds: readonly string[] | null | undefined,
  eventDateIds: readonly string[],
): boolean =>
  validIds === null ||
  validIds === undefined ||
  eventDateIds.length === 0 ||
  eventDateIds.some((id) => validIds.includes(id));

export const capacityExceededCopy = (input: {
  dateLabel: string | null;
}): { message: string; actionLabel: string } => ({
  message:
    input.dateLabel != null && input.dateLabel.length > 0
      ? `${input.dateLabel} just filled up`
      : "That date just filled up",
  actionLabel: "Remove this date and continue",
});
