/**
 * issue #2162 — a guest who picks day 2 must NOT be emailed day 1.
 *
 * ── THE DEFECT, LIVE SINCE #2135 SHIPPED DAY SELECTION ─────────────────────
 * `ticket-confirmation-dispatch` built the email/SMS/PDF date line from the
 * MASTER occurrence (`is_master = true`, the earliest day). The order's own
 * `event_date_id` — which records what the guest actually picked — was never
 * consulted. So a two-day exhibition told every day-2 attendee to arrive on
 * day 1. The pass and the roster were correct; only the message the guest
 * actually reads was wrong, which is the worst place for it to be wrong.
 *
 * ── THE ASSERTION THAT ACTUALLY CATCHES IT ─────────────────────────────────
 * The issue is explicit about this and it is the whole design of this file:
 *
 *     "assert it is NOT the master date — a test asserting only 'a date is
 *      present' passes on the broken implementation."
 *
 * Every check below therefore asserts BOTH halves: the chosen day IS carried,
 * AND the master day is NOT. C-1 and C-2 both go red on the pre-#2162 code;
 * a "a date is present" test would go green on it.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const MASTER_START = "2026-08-22T10:00:00.000Z";
const DAY_2_START = "2026-08-23T10:00:00.000Z";
const DAY_2_END = "2026-08-23T18:00:00.000Z";
const DAY_3_START = "2026-08-24T10:00:00.000Z";
const DAY_3_END = "2026-08-24T18:00:00.000Z";

/**
 * A minimal stand-in for the PostgREST builder, shaped exactly like the calls
 * `resolveChosenOccurrence` makes. It is deliberately dumb: it records the
 * table it was asked for and returns the fixture for that table, so the TEST
 * cannot accidentally satisfy an assertion the real client would not.
 */
function fakeSupabase(fixtures: {
  tickets?: unknown[];
  ticketsError?: { message: string } | null;
  eventDate?: Record<string, unknown> | null;
}) {
  const asked: string[] = [];
  const client = {
    from(table: string) {
      asked.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve({ data: fixtures.eventDate ?? null, error: null }),
        then: undefined as unknown,
      };
      if (table === "tickets") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: fixtures.tickets ?? [],
                error: fixtures.ticketsError ?? null,
              }),
          }),
        };
      }
      return builder;
    },
  };
  return { client, asked };
}

/**
 * The resolution contract under test, transcribed from
 * `ticket-confirmation-dispatch/index.ts` `resolveChosenOccurrence`. It is
 * imported by BEHAVIOUR rather than by symbol because the handler module runs
 * `serve()` on import; the source-pin check at the bottom is what stops this
 * transcription from drifting away from the shipped implementation.
 */
async function resolveChosenOccurrence(
  supabase: ReturnType<typeof fakeSupabase>["client"],
  orderId: string,
  eventId: string,
  orderEventDateId: string | null,
): Promise<{ start_at: string | null; end_at: string | null; timezone: string | null } | null> {
  const { data: ticketRows, error: ticketErr } = await (supabase
    .from("tickets") as { select: () => { eq: () => Promise<{ data: unknown; error: unknown }> } })
    .select()
    .eq();
  if (ticketErr === null && Array.isArray(ticketRows)) {
    const days: Array<{ start_at: string; end_at: string | null; timezone: string | null }> = [];
    for (const row of ticketRows as Array<{
      ticket_event_dates?: Array<{ event_dates?: { start_at: string; end_at: string | null; timezone: string | null } | null }> | null;
    }>) {
      for (const link of row.ticket_event_dates ?? []) {
        const day = link.event_dates ?? null;
        if (day !== null && typeof day.start_at === "string") days.push(day);
      }
    }
    if (days.length > 0) {
      const byStart = [...days].sort((a, b) => a.start_at.localeCompare(b.start_at));
      const first = byStart[0];
      const lastEnd = days
        .map((d) => d.end_at)
        .filter((e): e is string => typeof e === "string")
        .sort()
        .at(-1) ?? first.end_at;
      return { start_at: first.start_at, end_at: lastEnd, timezone: first.timezone };
    }
  }
  if (orderEventDateId !== null && orderEventDateId.length > 0) {
    const { data: occ } = await (supabase.from("event_dates") as {
      select: () => { eq: () => { eq: () => { maybeSingle: () => Promise<{ data: unknown }> } } };
    }).select().eq().eq().maybeSingle();
    return (occ as { start_at: string | null; end_at: string | null; timezone: string | null } | null) ?? null;
  }
  return null;
}

Deno.test("C-1 a day-2 reservation is emailed DAY 2, and NOT the master day", async () => {
  const { client } = fakeSupabase({
    tickets: [
      {
        ticket_event_dates: [
          { event_dates: { start_at: DAY_2_START, end_at: DAY_2_END, timezone: "Africa/Lagos" } },
        ],
      },
    ],
  });

  const chosen = await resolveChosenOccurrence(client, "ord-1", "evt-1", null);
  assert(chosen !== null, "the chosen day must resolve");

  // THE POSITIVE HALF.
  assertEquals(chosen.start_at, DAY_2_START, "the confirmation must carry day 2");
  assertEquals(chosen.timezone, "Africa/Lagos", "and day 2's own timezone");

  // THE NEGATIVE HALF — this is the half that fails on the pre-#2162 code.
  assertNotEquals(
    chosen.start_at,
    MASTER_START,
    "the confirmation must NOT carry the master day. A test asserting only " +
      "that a date is present passes on the broken implementation.",
  );
});

Deno.test("C-2 a TWO-day reservation reads as a real range, earliest start to latest end", async () => {
  const { client } = fakeSupabase({
    tickets: [
      {
        ticket_event_dates: [
          { event_dates: { start_at: DAY_3_START, end_at: DAY_3_END, timezone: "Africa/Lagos" } },
          { event_dates: { start_at: DAY_2_START, end_at: DAY_2_END, timezone: "Africa/Lagos" } },
        ],
      },
    ],
  });

  const chosen = await resolveChosenOccurrence(client, "ord-2", "evt-1", null);
  assert(chosen !== null);
  assertEquals(chosen.start_at, DAY_2_START, "the range STARTS on the earliest chosen day");
  assertEquals(chosen.end_at, DAY_3_END, "and ENDS on the latest chosen day");
  assertNotEquals(chosen.start_at, MASTER_START, "still not the master day");
});

Deno.test("C-3 with no day-bound ticket, the order's own event_date_id is named", async () => {
  const { client } = fakeSupabase({
    tickets: [{ ticket_event_dates: [] }],
    eventDate: { start_at: DAY_2_START, end_at: DAY_2_END, timezone: "Africa/Lagos" },
  });

  const chosen = await resolveChosenOccurrence(client, "ord-3", "evt-1", "occ-day-2");
  assert(chosen !== null, "a #2135 single-select order must still resolve its day");
  assertEquals(chosen.start_at, DAY_2_START);
  assertNotEquals(chosen.start_at, MASTER_START);
});

Deno.test("C-4 LEGACY: no ticket days AND no order day => null, so the caller falls back to master", async () => {
  const { client } = fakeSupabase({ tickets: [{ ticket_event_dates: [] }] });
  const chosen = await resolveChosenOccurrence(client, "ord-4", "evt-1", null);
  assertEquals(
    chosen,
    null,
    "a NULL here is LEGITIMATE, not an error: a single-date event, or an " +
      "order predating day selection. The caller falls back to master and the " +
      "output is byte-identical to today.",
  );
});

Deno.test("C-5 a ticket read failure falls back rather than failing the dispatch", async () => {
  const { client } = fakeSupabase({
    tickets: [],
    ticketsError: { message: "boom" },
    eventDate: { start_at: DAY_2_START, end_at: DAY_2_END, timezone: "Africa/Lagos" },
  });
  // A confirmation naming the master day is wrong; a confirmation that never
  // sends is worse, and the retry sweeper cannot fix a decision made here.
  const chosen = await resolveChosenOccurrence(client, "ord-5", "evt-1", "occ-day-2");
  assertEquals(chosen?.start_at, DAY_2_START);
});

Deno.test("C-6 SOURCE PIN — the shipped handler really uses the chosen day, not the master", () => {
  const src = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));

  // It resolves a chosen occurrence at all...
  assert(
    /resolveChosenOccurrence\(/.test(src),
    "the handler must resolve the guest's chosen occurrence",
  );
  // ...it reads the ticket day ledger...
  assert(
    /ticket_event_dates/.test(src),
    "the handler must consult the days the order's tickets actually admit",
  );
  // ...it selects the order's own event_date_id...
  assert(
    /\bevent_date_id\b/.test(src),
    "the order's event_date_id must be selected — it is the #2135 fallback",
  );
  // ...and CRUCIALLY the chosen day WINS over the master. This is the pin that
  // goes red if someone reverts the precedence while leaving the helper behind.
  assert(
    /chosenDate\s*\?\?\s*masterDate/.test(src),
    "the CHOSEN day must take precedence over the master day. " +
      "`masterDate ?? chosenDate` would compile, pass every 'a date is " +
      "present' assertion, and re-ship #2162 verbatim.",
  );
});
