/**
 * issue #3281 decision 7 — Explorer's optional per-date ticket quantities.
 *
 * Uniform carts send no map and the server multiplies by the chosen dates. An
 * uneven cart sends one count per date, and its quantity is their sum.
 */
export type ByDateMap = Readonly<Record<string, number>>;

/** Only chosen dates with at least one ticket reach the server. */
export const byDateForDates = (
  map: ByDateMap | undefined,
  dateIds: readonly string[],
): Record<string, number> => {
  const cleaned: Record<string, number> = {};
  for (const id of dateIds) {
    const count = Math.floor(Number(map?.[id] ?? 0));
    if (count > 0) cleaned[id] = count;
  }
  return cleaned;
};

export const byDateTotal = (map: ByDateMap): number =>
  Object.values(map).reduce((total, count) => total + count, 0);

export const withDateQuantity = (
  map: ByDateMap | undefined,
  dateId: string,
  quantity: number,
): Record<string, number> => {
  const next = { ...map };
  if (quantity > 0) next[dateId] = quantity;
  else delete next[dateId];
  return next;
};

/** Turning the switch off starts each date on the quantity already chosen. */
export const evenByDate = (
  dateIds: readonly string[],
  quantity: number,
): Record<string, number> =>
  byDateForDates(
    Object.fromEntries(dateIds.map((id) => [id, quantity])),
    dateIds,
  );

/**
 * Turning the switch back on keeps the busiest date's count. Using the sum
 * would turn 2 + 1 into 3 tickets on every date.
 */
export const uniformQuantity = (map: ByDateMap): number =>
  Math.max(0, ...Object.values(map));

export const cartLineQuantities = (
  line: { quantity: number },
  map: ByDateMap | undefined,
  dateIds: readonly string[] | null,
): { quantity: number; byDate?: Record<string, number> } => {
  if (dateIds === null) return { quantity: line.quantity };
  const byDate = byDateForDates(map, dateIds);
  return { quantity: byDateTotal(byDate), byDate };
};
