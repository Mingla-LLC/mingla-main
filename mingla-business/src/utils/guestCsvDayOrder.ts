/**
 * issue #3281 PR8 — Day-cell ordering for guest CSV export.
 * Kept out of guestCsvExport.ts so the shared __common chunk does not grow
 * (guests / door / reconciliation / finance all share that module).
 */

export type GuestCsvDayCellOrder = {
  ticketDays?: { eventDateIds: string[] }[];
};

export const orderDayCellByOccurrence = (
  order: GuestCsvDayCellOrder,
  dayLabels: ReadonlyMap<string, string>,
): string => {
  const ids = new Set<string>();
  for (const t of order.ticketDays ?? []) {
    for (const id of t.eventDateIds) ids.add(id);
  }
  if (ids.size === 0) return "";
  // A pass that covers every labelled day → "All N dates".
  const allIds = [...dayLabels.keys()];
  if (
    allIds.length >= 2 &&
    ids.size === allIds.length &&
    allIds.every((id) => ids.has(id))
  ) {
    return `All ${allIds.length} dates`;
  }
  // Sort by the event's date order (Map insertion = occurrence start order),
  // never lexicographic label order. Ids on the order but missing from
  // dayLabels stay omitted (#9).
  const labels: string[] = [];
  for (const id of allIds) {
    if (!ids.has(id)) continue;
    const label = dayLabels.get(id);
    if (label !== undefined && label.length > 0) labels.push(label);
  }
  return labels.join("; ");
};
