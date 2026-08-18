// issue #2160 — a guest attending two days gets TWO calendar entries.
//
// ── WHY THIS FILE WAS REWRITTEN ────────────────────────────────────────────
// Its first version was 100% regex over `calendarService.ts`. The tester was
// right to reject that: `/\.flatMap\(/` goes RED on a reformat and GREEN on a
// real regression, and it left the consumer-calendar change — the one that
// would have had a guest miss a day they paid for — with no behavioural
// coverage at all. Its header also cited H-01 as the executed proof, which was
// wrong: H-01 proves the DATABASE holds two day-bound passes, not that the
// calendar EMITS two entries.
//
// The rule now lives in `calendarOrderDays.ts`, an RN-free module, so every
// check below CALLS it with real order shapes and asserts on the emitted
// array. `calendarService.ts` keeps the query and the row assembly; two source
// pins at the end assert it is really wired to this rule, which is all a source
// pin is honestly good for.
//
// ── THE BUG BEING GUARDED ──────────────────────────────────────────────────
// Same class as #2162 — a surface rendering ONE date for an order covering
// several — and worse here: under #2160 `orders.event_date_id` is the
// LATEST-ENDING chosen day (the payout anchor), and the calendar preferred
// exactly that column. A both-days guest would have seen ONLY day 2.
//
// FAILS-ON-REVERT: return `[input.fallback]` unconditionally (the pre-#2160
// behaviour) and E-1/E-2/E-3 go red on VALUES, not on text.

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  calendarDayWindowsForOrder,
  type CalendarOccurrenceRow,
} from "../calendarOrderDays.ts";

const DAY_1: CalendarOccurrenceRow = {
  id: "occ-1",
  start_at: "2026-08-22T10:00:00.000Z",
  end_at: "2026-08-22T18:00:00.000Z",
  is_master: true,
};
const DAY_2: CalendarOccurrenceRow = {
  id: "occ-2",
  start_at: "2026-08-23T10:00:00.000Z",
  end_at: "2026-08-23T18:00:00.000Z",
  is_master: false,
};
const DAY_3: CalendarOccurrenceRow = {
  id: "occ-3",
  start_at: "2026-08-24T10:00:00.000Z",
  end_at: "2026-08-24T18:00:00.000Z",
  is_master: false,
};
const ALL = [DAY_1, DAY_2, DAY_3];
// What the pre-#2160 code would have emitted: ONE window, from the anchor —
// which under #2160 is the LATEST-ending day. Every multi-day check below
// asserts the result is not this.
const ANCHOR_ONLY = {
  masterDateUtc: DAY_2.start_at,
  masterDateEndUtc: DAY_2.end_at,
};

Deno.test("E-1 per_day, two days -> TWO entries, one per day, chronological", () => {
  const windows = calendarDayWindowsForOrder({
    occurrences: ALL,
    // per_day mints one pass per day, each with one entitlement row.
    tickets: [
      { ticket_event_dates: [{ event_date_id: "occ-2" }] },
      { ticket_event_dates: [{ event_date_id: "occ-1" }] },
    ],
    fallback: ANCHOR_ONLY,
  });

  assertEquals(windows.length, 2, "a two-day guest must get TWO calendar entries");
  // Chronological, regardless of the order the passes came back in.
  assertEquals(windows[0].masterDateUtc, DAY_1.start_at);
  assertEquals(windows[0].masterDateEndUtc, DAY_1.end_at);
  assertEquals(windows[1].masterDateUtc, DAY_2.start_at);
  assertEquals(windows[1].masterDateEndUtc, DAY_2.end_at);
  // THE NEGATIVE THAT CATCHES THE REGRESSION: the pre-#2160 result was exactly
  // the anchor alone, and day 1 — the one the guest could have missed — was
  // absent. A test asserting only "an entry has a date" passes on that.
  assertNotEquals(windows.length, 1);
  assert(
    windows.some((w) => w.masterDateUtc === DAY_1.start_at),
    "day 1 must be present — its absence is the whole defect",
  );
});

Deno.test("E-2 all_days, ONE pass admitting two days -> still TWO entries", () => {
  // The mode does not reach this rule and must not: a pass admits the days it
  // has rows for, however it was minted.
  const windows = calendarDayWindowsForOrder({
    occurrences: ALL,
    tickets: [{
      ticket_event_dates: [{ event_date_id: "occ-1" }, { event_date_id: "occ-2" }],
    }],
    fallback: ANCHOR_ONLY,
  });
  assertEquals(windows.length, 2);
  assertEquals(windows.map((w) => w.masterDateUtc), [DAY_1.start_at, DAY_2.start_at]);
});

Deno.test("E-3 a day the guest did NOT pick never produces an entry", () => {
  const windows = calendarDayWindowsForOrder({
    occurrences: ALL,
    tickets: [{ ticket_event_dates: [{ event_date_id: "occ-1" }] }],
    fallback: ANCHOR_ONLY,
  });
  assertEquals(windows.length, 1);
  assertEquals(windows[0].masterDateUtc, DAY_1.start_at);
  assert(
    !windows.some((w) => w.masterDateUtc === DAY_3.start_at),
    "day 3 was never booked and must not appear in the calendar",
  );
});

Deno.test("E-4 LEGACY: a pass with no days emits the caller's fallback, unchanged", () => {
  // This is the pre-#2160 answer and it must survive byte-for-byte: every order
  // issued before this change is on this path, and nothing is backfilled.
  const windows = calendarDayWindowsForOrder({
    occurrences: ALL,
    tickets: [{ ticket_event_dates: [] }, { ticket_event_dates: null }],
    fallback: ANCHOR_ONLY,
  });
  assertEquals(windows.length, 1);
  assertEquals(windows[0], ANCHOR_ONLY);
});

Deno.test("E-5 an order with no tickets at all still emits exactly one entry", () => {
  // An order that vanishes from the calendar is worse than one dated from its
  // anchor, so the rule always returns at least one window.
  assertEquals(
    calendarDayWindowsForOrder({ occurrences: ALL, tickets: null, fallback: ANCHOR_ONLY }),
    [ANCHOR_ONLY],
  );
  assertEquals(
    calendarDayWindowsForOrder({ occurrences: null, tickets: [], fallback: ANCHOR_ONLY }),
    [ANCHOR_ONLY],
  );
});

Deno.test("E-6 entitlement ids the query did not return fall back rather than emit nothing", () => {
  const windows = calendarDayWindowsForOrder({
    occurrences: [DAY_1],
    tickets: [{ ticket_event_dates: [{ event_date_id: "occ-not-loaded" }] }],
    fallback: ANCHOR_ONLY,
  });
  assertEquals(windows.length, 1, "never zero entries");
  assertEquals(windows[0], ANCHOR_ONLY);
});

Deno.test("E-7 duplicate entitlement rows across passes do not duplicate entries", () => {
  // per_day qty 2 x 2 days mints FOUR passes — two per day. The guest attends
  // two days, so they get two entries, not four.
  const windows = calendarDayWindowsForOrder({
    occurrences: ALL,
    tickets: [
      { ticket_event_dates: [{ event_date_id: "occ-1" }] },
      { ticket_event_dates: [{ event_date_id: "occ-2" }] },
      { ticket_event_dates: [{ event_date_id: "occ-1" }] },
      { ticket_event_dates: [{ event_date_id: "occ-2" }] },
    ],
    fallback: ANCHOR_ONLY,
  });
  assertEquals(windows.length, 2, "two days attended -> two entries, not four");
});

Deno.test("E-8 each entry carries its OWN end, never another day's", () => {
  // The ORCH-0853 partition reads `masterDateEndUtc` per row, so a window
  // carrying the wrong end mis-partitions that day into upcoming or archive.
  const windows = calendarDayWindowsForOrder({
    occurrences: ALL,
    tickets: [{
      ticket_event_dates: [{ event_date_id: "occ-1" }, { event_date_id: "occ-3" }],
    }],
    fallback: ANCHOR_ONLY,
  });
  assertEquals(windows[0].masterDateEndUtc, DAY_1.end_at);
  assertEquals(windows[1].masterDateEndUtc, DAY_3.end_at);
  assertNotEquals(windows[0].masterDateEndUtc, windows[1].masterDateEndUtc);
});

// ── the only two source pins, and they pin WIRING, not behaviour ───────────
Deno.test("E-9 calendarService is really wired to this rule", () => {
  const src = Deno.readTextFileSync(new URL("../calendarService.ts", import.meta.url));
  assert(
    /calendarDayWindowsForOrder\(\{/.test(src),
    "the order fetcher must call the rule rather than re-deriving it inline",
  );
  assert(
    /as unknown as OrderRow\[\]\)\.flatMap\(/.test(src),
    "and flatMap it, because `map` cannot turn one order into two entries",
  );
  assert(
    /masterDateUtc: day\.masterDateUtc,/.test(src) &&
      /masterDateEndUtc: day\.masterDateEndUtc,/.test(src),
    "each emitted row must be dated from ITS OWN window",
  );
  assert(
    /ticket_event_dates \( event_date_id \)/.test(src),
    "the query must actually select the days each pass admits",
  );
});
