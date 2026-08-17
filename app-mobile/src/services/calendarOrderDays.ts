/**
 * calendarOrderDays — issue #2160.
 *
 * WHY THIS FILE EXISTS AS ITS OWN MODULE. The rule below — "how many calendar
 * entries does this order produce, and what are their windows" — is the whole
 * of the #2160 consumer-calendar change, and it was previously inline in
 * `calendarService.ts`. That file imports the React-Native `./supabase` client
 * at module scope, so it cannot be imported by a test at all; the only coverage
 * possible was regex over its source, which goes red on a reformat and GREEN on
 * a real regression. A rule that decides whether a guest sees the day they paid
 * for deserves better than that, so it lives here, where it can be called.
 *
 * NO React-Native imports. NO Supabase import. Deliberately: the moment this
 * file gains one, it becomes untestable again.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 * A guest attending two days gets TWO calendar entries.
 *
 * This is the same bug class as #2162 — a surface rendering ONE date for an
 * order that covers several — and it bit harder here. Under #2160
 * `orders.event_date_id` is the LATEST-ENDING chosen day (the payout anchor,
 * D-2), and the calendar preferred exactly that column. So a both-days guest
 * would have seen ONLY day 2 and could have missed day 1 having paid for it.
 */

/** One `event_dates` row, in the shape the order query returns. */
export interface CalendarOccurrenceRow {
  id: string;
  start_at: string | null;
  end_at: string | null;
  is_master?: boolean | null;
}

/** The window one calendar entry covers. */
export interface CalendarDayWindow {
  start_at: string | null;
  end_at: string | null;
}

export interface CalendarOrderDayInput {
  /** Every occurrence of the event, as joined onto the order. */
  occurrences: readonly (CalendarOccurrenceRow | null)[] | null;
  /** This order's passes and the days each admits (issue #2160). */
  tickets:
    | readonly ({
      ticket_event_dates?: readonly { event_date_id: string }[] | null;
    } | null)[]
    | null;
  /**
   * The window to emit when the passes carry NO days — i.e. the pre-#2160
   * answer, already resolved by the caller's ORCH-1188 chain (the order's own
   * booked occurrence, else the master).
   *
   * Passed IN rather than re-derived here, deliberately: that chain is live,
   * pinned by ORCH-1188's own tests, and #2160 has no business owning a second
   * copy of it. This module decides ONLY whether the answer is one window or
   * several.
   */
  fallback: CalendarDayWindow;
}

/**
 * The windows this order should produce calendar entries for, chronological.
 *
 *   * The days this order's PASSES admit (`ticket_event_dates`) — the
 *     authority for what the guest may actually attend. This is the ONLY
 *     branch that can return more than one window.
 *   * Otherwise the caller's already-resolved `fallback` window, unchanged.
 *
 * ALWAYS returns at least one window, so an order never silently vanishes from
 * the calendar.
 */
export const calendarDayWindowsForOrder = (
  input: CalendarOrderDayInput,
): CalendarDayWindow[] => {
  const occurrences = (input.occurrences ?? []).filter(
    (o): o is CalendarOccurrenceRow => o !== null && o !== undefined,
  );

  // The days the PASSES admit.
  const bookedIds = new Set<string>();
  for (const ticket of input.tickets ?? []) {
    for (const link of ticket?.ticket_event_dates ?? []) {
      if (typeof link?.event_date_id === "string") bookedIds.add(link.event_date_id);
    }
  }
  if (bookedIds.size > 0) {
    const booked = occurrences
      .filter((o) => bookedIds.has(o.id))
      .sort((a, b) => String(a.start_at ?? "").localeCompare(String(b.start_at ?? "")));
    if (booked.length > 0) {
      return booked.map((o) => ({ start_at: o.start_at, end_at: o.end_at }));
    }
    // The ids reference occurrences this query did not return. Fall through
    // rather than emit nothing: an order that disappears from the calendar is
    // worse than one dated from its anchor.
  }

  // Not day-scoped — legacy, single-date, or no selection. The caller's
  // ORCH-1188 chain already answered this; emit it unchanged.
  return [input.fallback];
};
