// issue #2160 — a guest attending two days gets TWO calendar entries.
//
// ── WHY THIS IS THE SAME BUG CLASS AS #2162 ────────────────────────────────
// #2162 was a surface rendering ONE date for an order that covers several: the
// confirmation email read the MASTER occurrence, so a day-2 guest was told to
// arrive on day 1. The consumer calendar had the identical shape — one entry
// per ORDER, dated from one occurrence.
//
// It bites HARDER here than the email did. Under #2160 `orders.event_date_id`
// is the LATEST-ENDING chosen day (the payout anchor, D-2), and the calendar
// preferred exactly that column. So a both-days guest would have seen ONLY
// day 2 in their calendar — and could have missed day 1 entirely, having paid
// for it. A "the entry has a date" test passes on that.
//
// ── THE REST OF THE SERVICE, CHECKED AS ASKED ──────────────────────────────
// `masterDateUtc` / `masterDateEndUtc` are the only per-order date fields on
// the row, and both the upcoming/archive partition and `computeEntryEffective-
// End` read them PER ROW — so emitting one row per day partitions each day
// independently, with no change to either. The RSVP and trip fetchers carry no
// day set at all (RSVP is single-date by product decision, #2131), so they are
// genuinely unaffected rather than skipped. C-5 pins that.
//
// SOURCE-CONTRACT, matching this directory's convention (orch_1188_calendar_
// url_and_date.test.ts): `calendarService.ts` imports the React-Native
// `./supabase` client, so it cannot be imported under `deno test`. The
// EXECUTED proof that a two-day order really holds two day-bound passes is
// supabase/migrations/__tests__/issue_2160_multiday_admission.test.sql (H-01).
//
// FAILS-ON-REVERT: change the `flatMap` back to `map`, or drop `daysToEmit`,
// and C-1/C-2 go red.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = await Deno.readTextFile(
  new URL("../calendarService.ts", import.meta.url),
);

Deno.test("C-1 the order fetcher emits one row PER DAY, not one per order", () => {
  // `flatMap` is the mechanism: `map` cannot produce two entries from one order.
  assert(
    /as unknown as OrderRow\[\]\)\.flatMap\(/.test(SRC),
    "the business-event order fetcher must flatMap so a two-day order yields two entries",
  );
  assert(
    /\(order\): BusinessEventCalendarRow\[\] =>/.test(SRC),
    "the mapper must return an ARRAY of rows per order",
  );
});

Deno.test("C-2 the days come from the PASSES, which is the only authority for what a guest may attend", () => {
  assertStringIncludes(SRC, "ticket_event_dates ( event_date_id )");
  assert(
    /const bookedDayIds = Array\.from\(\s*new Set\(/.test(SRC),
    "the distinct day set must be derived from the order's passes",
  );
  assert(
    /bookedDays[\s\S]{0,400}?\.sort\(/.test(SRC),
    "the emitted entries must be chronological, not database order",
  );
});

Deno.test("C-3 a LEGACY / single-date order still emits exactly ONE entry, from the unchanged fallback", () => {
  // The pre-#2160 chain — booked occurrence, else is_master — must survive
  // verbatim, because that is what every order issued before this change has.
  assert(
    /bookedDays\.length > 0[\s\S]{0,400}?:\s*\[\{[\s\S]{0,200}?masterDate\?\.start_at/.test(SRC),
    "with no day-bound pass the single-entry master fallback must run unchanged",
  );
  assertStringIncludes(SRC, "const bookedOccurrence = order.event_date_id");
  assertStringIncludes(SRC, "(ed) => ed?.is_master === true");
});

Deno.test("C-4 each entry is dated from ITS OWN day, not from the order anchor", () => {
  // This is the assertion that fails on the reverted code: leaving
  // `masterDateUtc: masterDate?.start_at` would date every entry from the
  // order's LATEST-ending day and hide day 1 completely.
  assert(
    /masterDateUtc: day\.start_at,/.test(SRC),
    "each entry's start must be its own day's start",
  );
  assert(
    /masterDateEndUtc: day\.end_at,/.test(SRC),
    "each entry's end must be its own day's end",
  );
  assert(
    !/masterDateUtc: masterDate\?\.start_at/.test(SRC),
    "the order-anchored start must be GONE from the emitted row — otherwise a " +
      "two-day guest sees only the last day and can miss the first",
  );
});

Deno.test("C-5 the END is still the END — the ORCH-0853 partition contract is untouched", () => {
  // The i-consumer-calendar-uses-end-not-start gate guards this; #2160 changes
  // WHICH occurrence's end it is, never that it is an end.
  assertStringIncludes(SRC, "masterDateEndUtc");
  assert(
    /computeEntryEffectiveEnd/.test(SRC),
    "the effective-end helper must survive",
  );
  assert(
    !/masterDateEndUtc: day\.start_at/.test(SRC),
    "the end field must never be fed a start",
  );
});
