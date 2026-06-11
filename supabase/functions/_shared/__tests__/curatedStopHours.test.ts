// ORCH-1061 PART 2 — happy-path Deno tests for the shared curated open-hours
// cascade (_shared/curatedStopHours.ts).
//
// Covers (implementor-owned rows from SPEC §8):
//   T-2-01 (THE GAP / fails-on-revert) — a curated card with a CLOSED periods-shape
//           stop is DROPPED by filterCuratedByStopHours. Reverting the D-1 fix
//           inside isStopOpenAtHour (the production change that makes the canonical
//           Google v1 `periods` shape actually evaluated) makes this card slip
//           through → test FAILS on revert. (See implementation report for the
//           captured revert evidence.)
//   T-2-02 — an all-open card is RETAINED.
//   (T-2-07 empty-after-filter → summary verdict is exercised at the handler in
//    orch_1061_blend_and_rotation.test.ts; here we prove the filter empties the
//    list when every card has a closed stop.)
//
// Run: cd supabase && deno test --allow-read functions/_shared/__tests__/curatedStopHours.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  filterCuratedByStopHours,
  isStopOpenAtHour,
  isStopOpenAtHourAnyTime,
  resolveCuratedHoursPolicy,
} from '../curatedStopHours.ts';

// A canonical Google v1 `periods` entry: open on `day` from openHour to closeHour.
function periods(day: number, openHour: number, closeHour: number) {
  return {
    periods: [
      {
        open: { day, hour: openHour, minute: 0 },
        close: { day, hour: closeHour, minute: 0 },
      },
    ],
  };
}

// Fixed reference instant: 2026-06-03 (Wednesday) 18:00 UTC. With utcOffsetMinutes=0
// the place-local arrival of the FIRST stop is Wednesday (day=3) 18:00.
const WED_1800_UTC = new Date(Date.UTC(2026, 5, 3, 18, 0, 0));

function curatedCard(stops: Record<string, unknown>[]): Record<string, unknown> {
  return {
    cardType: 'curated',
    utcOffsetMinutes: 0,
    lng: 0,
    stops,
  };
}

Deno.test('T-2-01 (THE GAP): curated card with a CLOSED periods-shape stop is DROPPED', () => {
  // First stop is a restaurant whose periods say it is open Wed 09:00–17:00, i.e.
  // CLOSED at the 18:00 arrival. With the D-1 fix this periods shape is evaluated
  // and the card is dropped. (Pre-fix: the text-only reader skips `periods`, falls
  // to its honest-unknown branch → returns OPEN → card RETAINED → bug.)
  const closedCard = curatedCard([
    {
      placeType: 'restaurant',
      openingHours: periods(3, 9, 17), // Wed 9am–5pm → closed at 6pm
      travelTimeFromPreviousStopMin: 0,
    },
  ]);

  const result = filterCuratedByStopHours([closedCard], WED_1800_UTC);
  assertEquals(result.length, 0, 'closed-on-arrival curated card must be dropped');
});

Deno.test('T-2-02: all-open curated card is RETAINED', () => {
  // Restaurant open Wed 11:00–23:00 → open at 18:00 arrival; second stop (bar)
  // open until late too. Card survives.
  const openCard = curatedCard([
    {
      placeType: 'restaurant',
      openingHours: periods(3, 11, 23),
      travelTimeFromPreviousStopMin: 0,
    },
    {
      placeType: 'bar',
      openingHours: periods(3, 16, 2), // 4pm–2am (overnight wrap)
      travelTimeFromPreviousStopMin: 15,
    },
  ]);

  const result = filterCuratedByStopHours([openCard], WED_1800_UTC);
  assertEquals(result.length, 1, 'all-open curated card must be retained');
});

Deno.test('T-2-02b: stop with NO hours data (non-always-open) is treated OPEN (honest-unknown)', () => {
  const noHoursCard = curatedCard([
    { placeType: 'restaurant', openingHours: {}, travelTimeFromPreviousStopMin: 0 },
  ]);
  const result = filterCuratedByStopHours([noHoursCard], WED_1800_UTC);
  assertEquals(result.length, 1, 'no-hours stop must be assumed open (never fabricate closed)');
});

Deno.test('T-2 D-1: isStopOpenAtHour evaluates canonical Google v1 periods shape', () => {
  const closedStop = { placeType: 'restaurant', openingHours: periods(3, 9, 17) };
  const openStop = { placeType: 'restaurant', openingHours: periods(3, 11, 23) };
  // Wed (day=3) at 18:00.
  assert(!isStopOpenAtHour(closedStop, 18, 3), 'periods-shape closed stop must read as closed');
  assert(isStopOpenAtHour(openStop, 18, 3), 'periods-shape open stop must read as open');
});

Deno.test('T-2: filtering all-closed cards empties the list (drives empty-summary verdict)', () => {
  const c1 = curatedCard([
    { placeType: 'restaurant', openingHours: periods(3, 9, 17), travelTimeFromPreviousStopMin: 0 },
  ]);
  const c2 = curatedCard([
    { placeType: 'cafe', openingHours: periods(3, 6, 14), travelTimeFromPreviousStopMin: 0 },
  ]);
  const result = filterCuratedByStopHours([c1, c2], WED_1800_UTC);
  assertEquals(result.length, 0, 'all-closed deck empties → handler emits summary verdict');
});

// ─────────────────────────────────────────────────────────────────────────────
// ORCH-1113 [curated-experience-empty-deck-regression] — the curated cascade
// honors date_option: 'today'/'now' → LIVE clock (NOT the stale stored
// datetime_pref); 'this_weekend'/'pick_dates' → open-at-any-hour on target day(s).
// ROOT CAUSE v4: index.ts:1737 evaluated each stop against a weeks-stale stored
// datetime_pref, which is afternoon (open) in Raleigh but late-night (closed) in
// Brussels, emptying the Brussels curated deck. See INVESTIGATE_ORCH-1113.
// ─────────────────────────────────────────────────────────────────────────────

// Brussels = UTC+120 min. A weeks-stale stored instant (2026-04-15 21:20 UTC,
// a Wednesday) maps to 23:20 Brussels-local (CLOSED). The live clock used below
// (2026-06-03 10:00 UTC) maps to 12:00 Brussels-local (OPEN). Build a Brussels
// curated card (utcOffsetMinutes=120) whose single restaurant stop is open
// 11:00–23:00 on BOTH the stale-pref weekday (Wed=3) and the live-clock weekday
// (Wed=3) so the ONLY variable that flips the verdict is which clock is used.
const STALE_PREF = '2026-04-15T21:20:44.492Z'; // Wed 21:20 UTC → 23:20 Brussels (closed)
const LIVE_NOW_BRUSSELS_NOON = new Date(Date.UTC(2026, 5, 3, 10, 0, 0)); // Wed 10:00 UTC → 12:00 Brussels (open)

function brusselsCard(stops: Record<string, unknown>[]): Record<string, unknown> {
  return { cardType: 'curated', utcOffsetMinutes: 120, lng: 4.35, stops };
}

Deno.test("T-01 (fails-on-revert): 'today' uses the LIVE clock, NOT the stale datetime_pref", () => {
  // Restaurant open Wed 11:00–23:00 local. At the stale 23:20 Brussels instant it
  // reads CLOSED (the bug); at the live 12:00 Brussels instant it reads OPEN.
  const card = brusselsCard([
    {
      placeType: 'restaurant',
      openingHours: periods(3, 11, 23), // Wed 11am–11pm
      travelTimeFromPreviousStopMin: 0,
    },
  ]);

  const policy = resolveCuratedHoursPolicy({
    dateOption: 'today',
    datetimePref: STALE_PREF,
    selectedDates: null,
    now: LIVE_NOW_BRUSSELS_NOON,
  });
  const result = filterCuratedByStopHours([card], policy);

  // With the fix, the policy is { mode:'instant', utcNow:<live now> } → evaluated
  // at Brussels noon → OPEN → RETAINED. REVERTING the policy change (back to
  // curatedUtcNow = datetimePref ? new Date(datetimePref) : new Date()) evaluates
  // the stop at the stale 23:20 Brussels instant → CLOSED → card DROPPED → this
  // assertion FAILS. That is the fails-on-revert contract.
  assertEquals(result.length, 1, 'today must use the live clock; a Brussels-noon-open card is RETAINED despite a stale night-time datetime_pref');
});

Deno.test("T-02 (ORCH-1113): 'today' STILL drops a closed-now stop (preserve ORCH-1061)", () => {
  // Live clock 03:00 Brussels-local (Wed 01:00 UTC), restaurant open 11:00–23:00.
  const liveNow0300 = new Date(Date.UTC(2026, 5, 3, 1, 0, 0)); // 01:00 UTC → 03:00 Brussels
  const card = brusselsCard([
    { placeType: 'restaurant', openingHours: periods(3, 11, 23), travelTimeFromPreviousStopMin: 0 },
  ]);
  const policy = resolveCuratedHoursPolicy({ dateOption: 'today', datetimePref: STALE_PREF, now: liveNow0300 });
  const result = filterCuratedByStopHours([card], policy);
  assertEquals(result.length, 0, 'a closed-now stop is still dropped under today (ORCH-1061 preserved)');
});

Deno.test("T-03 (ORCH-1113): 'this_weekend' = open-at-any-hour on Sat OR Sun", () => {
  // Stop open ONLY Saturday (day=6) 14:00–18:00. The stored instant is a Wed
  // night; under this_weekend the stop must survive on its Saturday hours.
  const card = brusselsCard([
    { placeType: 'restaurant', openingHours: periods(6, 14, 18), travelTimeFromPreviousStopMin: 0 },
  ]);
  const policy = resolveCuratedHoursPolicy({ dateOption: 'this_weekend', datetimePref: STALE_PREF });
  assertEquals(policy.mode, 'anyHourOnDays');
  const result = filterCuratedByStopHours([card], policy);
  assertEquals(result.length, 1, 'a Sat-only-open stop is RETAINED under this_weekend');
});

Deno.test("T-04 (ORCH-1113): 'this_weekend' drops a stop with no Sat/Sun periods", () => {
  // Open only Wednesday (day=3); no weekend periods → dropped under this_weekend.
  const card = brusselsCard([
    { placeType: 'restaurant', openingHours: periods(3, 11, 23), travelTimeFromPreviousStopMin: 0 },
  ]);
  const policy = resolveCuratedHoursPolicy({ dateOption: 'this_weekend' });
  const result = filterCuratedByStopHours([card], policy);
  assertEquals(result.length, 0, 'a weekday-only stop is DROPPED under this_weekend');
});

Deno.test("T-05 (ORCH-1113): 'pick_dates' evaluates the selected date's weekday", () => {
  // 2026-06-20 is a Saturday (day=6). Stop open Sat only → RETAINED. The stored
  // instant (Wed) is NOT used.
  const card = brusselsCard([
    { placeType: 'restaurant', openingHours: periods(6, 14, 18), travelTimeFromPreviousStopMin: 0 },
  ]);
  const policy = resolveCuratedHoursPolicy({
    dateOption: 'pick_dates',
    selectedDates: ['2026-06-20'],
    datetimePref: STALE_PREF,
  });
  assertEquals(policy.mode, 'anyHourOnDays');
  assertEquals((policy as { mode: 'anyHourOnDays'; days: number[] }).days, [6]);
  const result = filterCuratedByStopHours([card], policy);
  assertEquals(result.length, 1, 'a Sat-only stop is RETAINED for a Saturday pick_date');
});

Deno.test("T-06 (ORCH-1113): unknown/empty dateOption defaults to live-clock instant (never the stale pref)", () => {
  const undefinedPolicy = resolveCuratedHoursPolicy({ dateOption: undefined, datetimePref: STALE_PREF, now: LIVE_NOW_BRUSSELS_NOON });
  assertEquals(undefinedPolicy.mode, 'instant');
  assertEquals((undefinedPolicy as { mode: 'instant'; utcNow: Date }).utcNow.getTime(), LIVE_NOW_BRUSSELS_NOON.getTime());

  const garbagePolicy = resolveCuratedHoursPolicy({ dateOption: 'totally-unknown', datetimePref: STALE_PREF, now: LIVE_NOW_BRUSSELS_NOON });
  assertEquals(garbagePolicy.mode, 'instant', 'unknown dateOption falls back to instant, never the stale pref');
  assertEquals((garbagePolicy as { mode: 'instant'; utcNow: Date }).utcNow.getTime(), LIVE_NOW_BRUSSELS_NOON.getTime());
});

Deno.test('T-11 (ORCH-1113): filterCuratedByStopHours is idempotent in both modes (collab double-filter no-op)', () => {
  const openCards = [
    brusselsCard([{ placeType: 'restaurant', openingHours: periods(3, 11, 23), travelTimeFromPreviousStopMin: 0 }]),
    brusselsCard([{ placeType: 'bar', openingHours: periods(3, 16, 26), travelTimeFromPreviousStopMin: 0 }]),
  ];

  // instant mode
  const instantPolicy = resolveCuratedHoursPolicy({ dateOption: 'today', now: LIVE_NOW_BRUSSELS_NOON });
  const onceInstant = filterCuratedByStopHours(openCards, instantPolicy);
  const twiceInstant = filterCuratedByStopHours(onceInstant, instantPolicy);
  assertEquals(onceInstant.length, twiceInstant.length, 'instant mode: re-filtering an already-passing list is a no-op');

  // anyHourOnDays mode
  const weekendCards = [
    brusselsCard([{ placeType: 'restaurant', openingHours: periods(6, 11, 23), travelTimeFromPreviousStopMin: 0 }]),
  ];
  const weekendPolicy = resolveCuratedHoursPolicy({ dateOption: 'this_weekend' });
  const onceWeekend = filterCuratedByStopHours(weekendCards, weekendPolicy);
  const twiceWeekend = filterCuratedByStopHours(onceWeekend, weekendPolicy);
  assertEquals(onceWeekend.length, twiceWeekend.length, 'anyHourOnDays mode: re-filtering is a no-op');
  assertEquals(onceWeekend.length, 1, 'the open weekend card survives both passes');
});

Deno.test('T-12 (ORCH-1113): a bare Date arg is still treated as { mode:instant } (back-compat)', () => {
  // Existing callers / tests pass a bare Date; it must behave exactly as the
  // pre-ORCH-1113 instant cascade. (T-2-01 above already exercises this with a
  // bare Date and must still pass.)
  const closedCard = curatedCard([
    { placeType: 'restaurant', openingHours: periods(3, 9, 17), travelTimeFromPreviousStopMin: 0 },
  ]);
  const openCard = curatedCard([
    { placeType: 'restaurant', openingHours: periods(3, 11, 23), travelTimeFromPreviousStopMin: 0 },
  ]);
  assertEquals(filterCuratedByStopHours([closedCard], WED_1800_UTC).length, 0, 'bare Date: closed-at-18:00 card dropped');
  assertEquals(filterCuratedByStopHours([openCard], WED_1800_UTC).length, 1, 'bare Date: open-at-18:00 card retained');
});

Deno.test('T-11b (ORCH-1113): isStopOpenAtHourAnyTime honors honest-unknown + always-open', () => {
  // ALWAYS_OPEN → true on any day.
  assert(isStopOpenAtHourAnyTime({ placeType: 'park' }, 1), 'always-open type open any day');
  // No data → honest-unknown → true.
  assert(isStopOpenAtHourAnyTime({ placeType: 'restaurant', openingHours: {} }, 1), 'no-data stop assumed open');
  // Periods-shape: open Sat only.
  const satOnly = { placeType: 'restaurant', openingHours: periods(6, 14, 18) };
  assert(isStopOpenAtHourAnyTime(satOnly, 6), 'open on Saturday');
  assert(!isStopOpenAtHourAnyTime(satOnly, 3), 'closed on Wednesday');
});
