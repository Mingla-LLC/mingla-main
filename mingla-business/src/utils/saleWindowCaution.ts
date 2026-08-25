/**
 * issue #2590 — does this sale window leave part of the event unbuyable?
 *
 * Extracted from `TicketTierEditSheet` so it can be executed in a test rather
 * than read as source. It exists because the first version of this rule, living
 * inline in the component, was WRONG in a way no reviewer would have caught:
 * it compared the sale end against the event's FIRST occurrence only.
 *
 * We Go Again Exhibition runs 29–30 August and closes sales at 07:00 on the
 * 30th. That is comfortably AFTER Day 1 opened, so a first-occurrence
 * comparison reports nothing at all — while Day 2, the day people would
 * actually be turning up for, cannot be bought on the day. The rule missed the
 * exact event that motivated it.
 *
 * Both bounds are needed to tell the two shapes apart, and they need different
 * sentences because the organiser's mistake is different in each.
 */

/** Which caution applies, or `null` when the window is fine. */
export type SaleWindowCaution =
  /** Sales end before the event opens — nobody can buy on the day. */
  | "closes-before-doors"
  /** Sales end while the event is still running — later days are unbuyable. */
  | "closes-mid-event"
  | null;

const msOf = (iso: string | null | undefined): number =>
  typeof iso === "string" && iso.length > 0 ? new Date(iso).getTime() : Number.NaN;

/**
 * @param saleEndIso      when sales stop, ISO-8601, or null for "never"
 * @param eventStartsIso  the event's FIRST occurrence start, UTC
 * @param eventEndsIso    the event's LAST occurrence end, UTC
 *
 * Returns `null` whenever any input is missing or unparseable. Absence of data
 * is not evidence of a problem, and a caution fired on a half-loaded screen
 * would train organisers to dismiss it.
 */
export const saleWindowCaution = (
  saleEndIso: string | null | undefined,
  eventStartsIso: string | null | undefined,
  eventEndsIso: string | null | undefined,
): SaleWindowCaution => {
  const saleEnd = msOf(saleEndIso);
  const starts = msOf(eventStartsIso);
  const ends = msOf(eventEndsIso);
  if (!Number.isFinite(saleEnd) || !Number.isFinite(starts)) return null;
  if (saleEnd < starts) return "closes-before-doors";
  if (Number.isFinite(ends) && saleEnd < ends) return "closes-mid-event";
  return null;
};
