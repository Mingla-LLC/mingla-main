/**
 * guestDayFilter — issue #2160, the per-day roster rule.
 *
 * WHY THIS IS ITS OWN MODULE. "Which guests appear under which day chip, and
 * what does each chip count" was inline in the guests screen, where the only
 * coverage available was regex over the screen's source. A regex passes if the
 * string appears in a comment, on a control that never renders, or with the
 * predicate inverted to `every` — and `every` is the bug this feature exists to
 * remove, hiding a both-days guest from BOTH days. The rule lives here so it
 * can be called with real rows and asserted on real answers.
 *
 * No React import, no store import: this is a pure decision.
 */

/** One pass of an order and the days it admits. Empty = not day-scoped. */
export interface GuestTicketDays {
  eventDateIds: string[];
}

/**
 * Does this order belong under `dayId`?
 *
 * THE RULE, and each clause is load-bearing:
 *
 *   * A guest holding passes for BOTH days appears under BOTH chips. That is
 *     the point of the issue, not a double-count — they really are coming both
 *     days — and they still appear ONCE under "All", which is unfiltered.
 *     `some`, never `every`: `every` would hide a both-days guest from each
 *     individual day, which is the defect inverted.
 *   * A pass with NO days is NOT day-scoped: it admits on any occurrence, so it
 *     belongs under every chip rather than disappearing from all of them.
 *     Hiding it would under-report the door.
 *   * An order with no passes at all (a comp, a door sale) is equally
 *     admissible on any day and is likewise shown everywhere.
 */
export const orderMatchesDay = (
  ticketDays: readonly GuestTicketDays[] | null | undefined,
  dayId: string,
): boolean => {
  const days = ticketDays ?? [];
  if (days.length === 0) return true;
  const bound = days.filter((t) => t.eventDateIds.length > 0);
  if (bound.length === 0) return true;
  return bound.some((t) => t.eventDateIds.includes(dayId));
};

/**
 * How many PASSES a day chip should report.
 *
 * Counted from real ticket rows, never fabricated: a pass bound to this day, or
 * a not-day-scoped pass (which is genuinely admissible on it). Counts PASSES
 * rather than orders because that is what walks through the door — a guest who
 * bought two passes for Saturday is two bodies on Saturday.
 */
export const dayHeadCount = (
  orders: readonly { ticketDays?: readonly GuestTicketDays[] | null }[],
  dayId: string,
): number => {
  let n = 0;
  for (const order of orders) {
    for (const t of order.ticketDays ?? []) {
      if (t.eventDateIds.length === 0 || t.eventDateIds.includes(dayId)) n += 1;
    }
  }
  return n;
};
