// chosenOccurrence — WHICH DAY DOES THIS ORDER ACTUALLY NAME?
//
// ── WHY THIS FILE EXISTS AS ITS OWN MODULE (issue #2347) ───────────────────
// This resolver shipped as a private function inside
// `ticket-confirmation-dispatch/index.ts` for issue #2162, and it is correct.
// `ticket-pdf-fetch` — the wallet's "Download ticket" endpoint — received none
// of it and still read `is_master`, so the guest who bought day 2 downloaded a
// PDF dated day 1, and that PDF was then written back to
// `orders.ticket_pdf_path` and became the permanent artifact.
//
// The fix for that is NOT a second copy of this logic. #2162's own header says
// the resolution order is the contract; two copies of a contract is one copy
// too many. So the ONE implementation moved here, where both functions import
// it, and this file deliberately has:
//
//   * NO `serve()` — an edge function's `index.ts` starts a server at module
//     scope, so it can never be imported by a sibling function or a test.
//   * NO supabase-js import — the client is accepted STRUCTURALLY below, so a
//     test can call this with a fake and an esm.sh outage cannot red the lane.
//
// ── THE RESOLUTION ORDER (issue #2162 SPEC §4.6, verbatim) ─────────────────
//
//   1. The days this order's TICKETS admit (`ticket_event_dates`, issue #2160).
//      This is the authority for what the guest may actually attend, so it
//      beats everything. A multi-day reservation collapses to a real RANGE:
//      the EARLIEST chosen `start_at` and the LATEST chosen `end_at`, so a
//      Saturday+Sunday guest is told "Sat – Sun", not "Sat" and not "day 1".
//   2. `orders.event_date_id` — a #2135 single-select reservation, or a #2160
//      order's anchor. Named directly.
//   3. `null`, meaning "use the master", which the caller does. That is the
//      legitimate legacy / single-date case, NOT an error.
//
// Returns `null` rather than throwing on a read failure: a confirmation that
// names the master day is wrong, but a confirmation that never sends is worse,
// and the notification-retry sweeper cannot fix a decision this function made.
// The failure is logged so it is not silent (Constitution #3).

/** One `event_dates` row, in the shape both callers already consume. */
export interface ChosenOccurrence {
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
}

interface PostgrestLikeResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/**
 * The PostgREST surface this resolver touches, and nothing else.
 *
 * `from()` is deliberately loose. A precisely-shaped structural interface was
 * tried first and made `deno check` on the callers fail with TS2589 ("type
 * instantiation is excessively deep") the moment supabase-js's real
 * `PostgrestFilterBuilder` was checked against it — the builder is recursively
 * generic. The narrowing that matters happens on the RESULTS below, which are
 * annotated explicitly, not on the builder.
 */
export interface ChosenOccurrenceClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

/**
 * The days a single order's passes admit, oldest `start_at` first.
 *
 * Exported on its own because `ticket-pdf-fetch` needs the SET (to decide
 * whether a cached PDF predates day-awareness), while the confirmation needs
 * only the collapsed range. One read, two shapes, still one rule.
 */
export async function ticketDaysForOrder(
  supabase: ChosenOccurrenceClient,
  orderId: string,
  logPrefix: string,
): Promise<ChosenOccurrence[] | null> {
  const { data: ticketRows, error: ticketErr } = (await supabase
    .from("tickets")
    .select("ticket_event_dates ( event_dates ( start_at, end_at, timezone ) )")
    .eq("order_id", orderId)) as PostgrestLikeResult<
      Array<
        {
          ticket_event_dates?:
            | Array<{ event_dates?: ChosenOccurrence | null }>
            | null;
        }
      >
    >;
  if (ticketErr !== null) {
    console.error(
      `${logPrefix} ticket day lookup failed`,
      orderId,
      ticketErr.message,
    );
    return null;
  }
  if (!Array.isArray(ticketRows)) return null;
  const days: ChosenOccurrence[] = [];
  for (
    const row of ticketRows as unknown as Array<{
      ticket_event_dates?:
        | Array<{ event_dates?: ChosenOccurrence | null }>
        | null;
    }>
  ) {
    for (const link of row.ticket_event_dates ?? []) {
      const day = link.event_dates ?? null;
      if (day !== null && typeof day.start_at === "string") days.push(day);
    }
  }
  return days;
}

/**
 * Collapse a pass's day set into the ONE occurrence-shaped object every date
 * line renderer consumes: earliest start, latest end.
 *
 * Exported so a test can assert the collapse without a client.
 */
export function collapseDaysToRange(
  days: readonly ChosenOccurrence[],
): ChosenOccurrence | null {
  if (days.length === 0) return null;
  const byStart = [...days].sort((a, b) =>
    String(a.start_at).localeCompare(String(b.start_at))
  );
  const first = byStart[0];
  const lastEnd = days
    .map((d) => d.end_at)
    .filter((e): e is string => typeof e === "string")
    .sort()
    .at(-1) ?? first.end_at;
  return {
    start_at: first.start_at,
    end_at: lastEnd,
    timezone: first.timezone,
  };
}

export async function resolveChosenOccurrence(
  supabase: ChosenOccurrenceClient,
  orderId: string,
  eventId: string,
  orderEventDateId: string | null,
  logPrefix = "[chosenOccurrence]",
): Promise<ChosenOccurrence | null> {
  try {
    const days = await ticketDaysForOrder(supabase, orderId, logPrefix);
    if (days !== null && days.length > 0) {
      return collapseDaysToRange(days);
    }

    if (orderEventDateId !== null && orderEventDateId.length > 0) {
      const { data: occ, error: occErr } = (await supabase
        .from("event_dates")
        .select("start_at, end_at, timezone")
        .eq("id", orderEventDateId)
        .eq("event_id", eventId)
        .maybeSingle()) as PostgrestLikeResult<ChosenOccurrence>;
      if (occErr !== null) {
        console.error(
          `${logPrefix} chosen occurrence lookup failed`,
          orderId,
          occErr.message,
        );
        return null;
      }
      return (occ as ChosenOccurrence | null) ?? null;
    }
  } catch (error) {
    console.error(
      `${logPrefix} chosen-day resolution threw`,
      orderId,
      error instanceof Error ? error.message : String(error),
    );
  }
  // Legitimate: single-date event, or an order predating day selection.
  return null;
}
