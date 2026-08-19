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

/**
 * The window one calendar entry covers.
 *
 * Named with the ROW's own field names rather than `start_at`/`end_at`
 * deliberately: there is then no rename between this rule and the emitted
 * `BusinessEventCalendarRow`, so a start/end swap — the exact defect
 * I-CALENDAR-BUSINESS-TICKET-END-NOT-START exists to prevent — has nowhere to
 * hide, and the ORCH-0853 gate's required `masterDateEndUtc: masterDate?.end_at
 * ?? null` token stays literally true at the call site for a real reason.
 */
export interface CalendarDayWindow {
  masterDateUtc: string | null;
  masterDateEndUtc: string | null;
  /**
   * issue #2347 — WHICH OCCURRENCE THIS WINDOW *IS*.
   *
   * The occurrence id when this window came from a day the passes actually
   * admit; `undefined`/`null` when it came from the caller's fallback, which
   * means "this window is not day-scoped".
   *
   * It exists so the caller can attach only the passes bound to THIS day.
   * Without it the day rows were emitted correctly and then every one of them
   * was handed the WHOLE order's ticket list — the day-2 QR rendered on the
   * day-1 card, stamped "Valid", and failed at the door.
   *
   * OPTIONAL, and the fallback branch deliberately returns the caller's object
   * UNTOUCHED, so a not-day-scoped order's window is byte-identical to the
   * pre-#2347 one and `ticketsAdmittedOnDay` shows every pass — which is what
   * "not day-scoped" means at the door (`biz_ticket_scan`'s `v_day_count = 0`
   * rung: today's any-occurrence window, verbatim).
   */
  eventDateId?: string | null;
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
      return booked.map((o) => ({
        // issue #2347 — the day this window IS, so the caller can bind passes
        // to it. Emitted ONLY on this branch: this is the only branch that
        // knows which occurrence it is looking at.
        eventDateId: o.id,
        masterDateUtc: o.start_at,
        // THE END, never the start (I-CALENDAR-BUSINESS-TICKET-END-NOT-START).
        // #2160 changes WHICH occurrence's end this is, never that it is one.
        masterDateEndUtc: o.end_at,
      }));
    }
    // The ids reference occurrences this query did not return. Fall through
    // rather than emit nothing: an order that disappears from the calendar is
    // worse than one dated from its anchor.
  }

  // Not day-scoped — legacy, single-date, or no selection. The caller's
  // ORCH-1188 chain already answered this; emit it unchanged.
  return [input.fallback];
};

/**
 * issue #2347 — THE PASSES THAT ADMIT ON ONE DAY.
 *
 * ── THE DEFECT THIS EXISTS TO KILL ─────────────────────────────────────────
 * `calendarService` built the ticket list ONCE from the whole order and
 * attached that same array to EVERY day row `calendarDayWindowsForOrder`
 * emitted. Under `per_day` (D days -> D passes, one `ticket_event_dates` row
 * each) the day-2 QR therefore rendered on the day-1 card, stamped "Valid",
 * and `biz_ticket_scan` refused it at the door — the guest is turned away
 * holding a pass the app told them was good. `ticketCount` read "2 tickets" on
 * both days for the same reason.
 *
 * ── THE RULE, WHICH IS THE DOOR'S RULE ─────────────────────────────────────
 * `ticket_event_dates` is the SOLE authority for which day a pass is valid on
 * (I-PROPOSED-2160-A). This mirrors `biz_ticket_scan`'s ladder exactly:
 *
 *   * ZERO days on the pass  -> "not day-scoped": the pre-#2160 any-occurrence
 *     admission window, so it shows on every window. Every pass issued before
 *     #2160 is on this path and nothing is backfilled.
 *   * The window is not day-scoped (the fallback) -> every pass, unchanged.
 *     This is also the #2160 E-6 case (entitlement ids the query did not
 *     return): an order that shows ZERO passes is worse than one showing all.
 *   * Otherwise -> only the passes carrying THIS day. `all_days` mints one pass
 *     with N rows, so it correctly appears on all N cards; `per_day` mints N
 *     passes with one row each, so each appears on exactly one.
 *
 * ── PARITY WITH THE ORGANISER'S ROSTER ────────────────────────────────────
 * The predicate below is term-for-term the one #2160 already shipped on the
 * organiser side — `dayHeadCount` in
 * `mingla-business/src/utils/guestDayFilter.ts`:
 *   `t.eventDateIds.length === 0 || t.eventDateIds.includes(dayId)`
 * That asymmetry WAS the bug: the host's day chip counted the right heads
 * while the guest's own calendar card showed the wrong passes. Keep the two
 * expressions identical — if one is ever loosened, the door and the roster
 * start disagreeing about who is coming.
 *
 * FAILS-ON-REVERT: return `[...tickets]` unconditionally and the scan-level
 * proof in `issue_2347_day_bound_passes.test.ts` goes red on VALUES.
 */
export const ticketsAdmittedOnDay = <
  T extends { readonly eventDateIds: readonly string[] },
>(
  tickets: readonly T[],
  dayEventDateId: string | null | undefined,
): T[] => {
  const all = [...tickets];
  if (dayEventDateId === null || dayEventDateId === undefined) return all;
  return all.filter(
    (t) =>
      t.eventDateIds.length === 0 || t.eventDateIds.includes(dayEventDateId),
  );
};
