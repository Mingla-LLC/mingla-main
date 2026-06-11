// ORCH-1061 PART 2 — TESTER adversarial Deno tests for the shared curated
// open-hours cascade (_shared/curatedStopHours.ts).
//
// These attack DIFFERENT angles than the implementor's happy-path file
// (curatedStopHours.test.ts):
//   T-2-03 — the honest-unknown direction: a stop with NO usable hours data
//            (and not an always-open type) must be assumed OPEN. We attack the
//            failure where a buggy reader fabricates "closed" for missing data —
//            across every no-data shape (no object, empty object, missing-day
//            text, empty periods array). Constitution #9.
//   T-2-04 (D-1 fails-on-revert) — a CLOSED periods-shape stop MUST be detected
//            as closed. If the D-1 fix (Path A periods evaluation) is reverted,
//            the reader falls through to "assume open" and this test FAILS. This
//            is the tester-owned fails-on-revert proof of the D-1 correctness fix.
//
// Run: cd supabase && deno test --allow-read --allow-env --no-check \
//   functions/_shared/__tests__/curatedStopHours.adversarial.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  filterCuratedByStopHours,
  isStopOpenAtHour,
} from '../curatedStopHours.ts';

// Wednesday (day=3) 18:00 UTC; with utcOffsetMinutes=0 the local arrival is Wed 18:00.
const WED_1800_UTC = new Date(Date.UTC(2026, 5, 3, 18, 0, 0));

function curatedCard(stops: Record<string, unknown>[]): Record<string, unknown> {
  return { cardType: 'curated', utcOffsetMinutes: 0, lng: 0, stops };
}

// ─── T-2-03 (adversarial): honest-unknown → OPEN; never fabricate closed ──────
Deno.test('T-2-03 (adversarial): no-hours stop is assumed OPEN across every no-data shape', () => {
  // (a) openingHours entirely absent.
  assert(isStopOpenAtHour({ placeType: 'restaurant' }, 18, 3),
    'absent openingHours → open (honest-unknown)');

  // (b) openingHours present but empty object (no periods, no _periods, no day text).
  assert(isStopOpenAtHour({ placeType: 'restaurant', openingHours: {} }, 18, 3),
    'empty openingHours object → open');

  // (c) openingHours is a non-object (defensive: null / string / number).
  assert(isStopOpenAtHour({ placeType: 'restaurant', openingHours: null }, 18, 3),
    'null openingHours → open');
  assert(isStopOpenAtHour({ placeType: 'restaurant', openingHours: 'unknown' as unknown as object }, 18, 3),
    'string openingHours → open (treated as no usable object)');

  // (d) periods array exists but is EMPTY → not usable → falls through to open.
  assert(isStopOpenAtHour({ placeType: 'restaurant', openingHours: { periods: [] } }, 18, 3),
    'empty periods array → open (no usable data)');

  // (e) text shape present but the CURRENT day has no entry → honest-unknown → open.
  //     (Other days populated; Wednesday/day=3 missing.)
  assert(isStopOpenAtHour(
    { placeType: 'restaurant', openingHours: { monday: '9:00 AM – 5:00 PM' } }, 18, 3),
    'missing current-day text → open (honest-unknown)');

  // (f) ALWAYS_OPEN type with no hours data → open (parks etc. never dropped).
  assert(isStopOpenAtHour({ placeType: 'park' }, 3, 3),
    'always-open type → open even at 3am with no data');

  // End-to-end through the filter: a card whose ONLY stop has no data is RETAINED.
  const retained = filterCuratedByStopHours(
    [curatedCard([{ placeType: 'restaurant', openingHours: {}, travelTimeFromPreviousStopMin: 0 }])],
    WED_1800_UTC,
  );
  assertEquals(retained.length, 1, 'no-data card must be retained, never fabricated-closed');
});

// ─── T-2-04 (adversarial, D-1 fails-on-revert): periods-shape CLOSED detected ──
Deno.test('T-2-04 (adversarial / D-1 fails-on-revert): periods-shape CLOSED stop is detected as closed', () => {
  // Canonical Google v1 periods: open Wed 09:00–17:00 → CLOSED at the 18:00 arrival.
  // With the D-1 fix (Path A periods evaluation) this reads as CLOSED.
  // REVERT THE D-1 FIX (drop Path A `periods` + Path B `_periods` from
  // isStopOpenAtHour) and the reader falls through to honest-unknown → OPEN, so
  // BOTH assertions below flip and this test FAILS — the tester-owned D-1 proof.
  const closedPeriods = {
    placeType: 'restaurant',
    openingHours: { periods: [{ open: { day: 3, hour: 9, minute: 0 }, close: { day: 3, hour: 17, minute: 0 } }] },
  };
  assert(!isStopOpenAtHour(closedPeriods, 18, 3),
    'D-1: periods-shape stop closed at 18:00 must read CLOSED (pre-fix: false-OK open)');

  // And the open-window boundary is honored (open exactly at 09:00, closed at 17:00).
  assert(isStopOpenAtHour(closedPeriods, 9, 3), 'open at the 09:00 boundary');
  assert(isStopOpenAtHour(closedPeriods, 16.99, 3), 'open just before 17:00');
  assert(!isStopOpenAtHour(closedPeriods, 17, 3), 'closed exactly at the 17:00 close (half-open interval)');

  // Wrong DAY: periods only cover Wednesday; querying Thursday (day=4) → no matching
  // period → CLOSED (proves the day filter inside evalPeriods, not just the hour).
  assert(!isStopOpenAtHour(closedPeriods, 12, 4),
    'D-1: a Wed-only period must read CLOSED on Thursday');

  // Legacy `_periods` shape (Path B) must behave identically.
  const closedUnderscorePeriods = {
    placeType: 'restaurant',
    openingHours: { _periods: [{ open: { day: 3, hour: 9, minute: 0 }, close: { day: 3, hour: 17, minute: 0 } }] },
  };
  assert(!isStopOpenAtHour(closedUnderscorePeriods, 18, 3),
    'D-1: legacy _periods closed stop must read CLOSED at 18:00');

  // Text-shape explicit "Closed" → CLOSED (proves Path C still fabricates nothing
  // but DOES honor an explicit closed declaration).
  const explicitlyClosed = { placeType: 'restaurant', openingHours: { wednesday: 'Closed' } };
  assert(!isStopOpenAtHour(explicitlyClosed, 18, 3),
    'explicit "Closed" text for the day must read CLOSED');

  // End-to-end: a curated card whose first stop is periods-closed is DROPPED.
  const dropped = filterCuratedByStopHours(
    [curatedCard([{ ...closedPeriods, travelTimeFromPreviousStopMin: 0 }])],
    WED_1800_UTC,
  );
  assertEquals(dropped.length, 0, 'periods-closed card must be dropped end-to-end');
});

// ─── T-2-04b (adversarial): a LATER stop closed-on-arrival drops the card ──────
// Attacks the cumulative-duration accumulation: the FIRST stop is open at 18:00,
// but by the time the user reaches the SECOND stop (after duration + travel) it
// is past that stop's close → the whole card must be dropped, proving the filter
// evaluates downstream stops at their projected arrival hour, not just stop 0.
Deno.test('T-2-04b (adversarial): a downstream stop closed at projected arrival drops the card', () => {
  // Stop 0: restaurant open Wed 11:00–23:00 (open at 18:00 arrival; 60min dwell).
  // Stop 1: museum open Wed 09:00–18:30, reached ~18:00 + 60min dwell + 15min
  //   travel ≈ 19:15 → CLOSED → card dropped.
  const card = curatedCard([
    {
      placeType: 'restaurant',
      openingHours: { periods: [{ open: { day: 3, hour: 11, minute: 0 }, close: { day: 3, hour: 23, minute: 0 } }] },
      travelTimeFromPreviousStopMin: 0,
    },
    {
      placeType: 'museum',
      openingHours: { periods: [{ open: { day: 3, hour: 9, minute: 0 }, close: { day: 3, hour: 18, minute: 30 } }] },
      travelTimeFromPreviousStopMin: 15,
    },
  ]);
  const result = filterCuratedByStopHours([card], WED_1800_UTC);
  assertEquals(result.length, 0, 'card dropped because the museum is closed by projected arrival');

  // Control: widen the museum close to 23:00 → now open on arrival → card retained.
  const cardOk = curatedCard([
    {
      placeType: 'restaurant',
      openingHours: { periods: [{ open: { day: 3, hour: 11, minute: 0 }, close: { day: 3, hour: 23, minute: 0 } }] },
      travelTimeFromPreviousStopMin: 0,
    },
    {
      placeType: 'museum',
      openingHours: { periods: [{ open: { day: 3, hour: 9, minute: 0 }, close: { day: 3, hour: 23, minute: 0 } }] },
      travelTimeFromPreviousStopMin: 15,
    },
  ]);
  assertEquals(filterCuratedByStopHours([cardOk], WED_1800_UTC).length, 1,
    'control: open-late museum → card retained (filter is not over-pruning)');
});

// ─── T-2-05 (adversarial source-grep): single source of truth ─────────────────
// The hours cascade must be defined in EXACTLY ONE file. Re-duplication in
// discover-cards or generate-curated would re-introduce drift (the exact bug
// class this ORCH eliminates). Grep both consumers' source.
Deno.test('T-2-05 (adversarial source-grep): hours cascade defined only in _shared/curatedStopHours.ts', async () => {
  const here = new URL('.', import.meta.url);
  const discover = await Deno.readTextFile(new URL('../../discover-cards/index.ts', here));
  const curated = await Deno.readTextFile(new URL('../../generate-curated-experiences/index.ts', here));

  for (const [name, src] of [['discover-cards', discover], ['generate-curated', curated]] as const) {
    assert(!/function\s+isStopOpenAtHour\s*\(/.test(src),
      `${name} must NOT define isStopOpenAtHour (single source of truth)`);
    assert(!/function\s+filterCuratedByStopHours\s*\(/.test(src),
      `${name} must NOT define filterCuratedByStopHours`);
    assert(!/function\s+parseHoursText\s*\(/.test(src),
      `${name} must NOT define parseHoursText`);
    assert(!/function\s+parseSingleRange\s*\(/.test(src),
      `${name} must NOT define parseSingleRange`);
  }

  // discover-cards must IMPORT from the shared module.
  assert(/from '\.\.\/_shared\/curatedStopHours\.ts'/.test(discover),
    'discover-cards must import the shared curated-hours module');
  assert(/from '\.\.\/_shared\/curatedStopHours\.ts'/.test(curated),
    'generate-curated must import the shared curated-hours module');
});

// ─── T-2-01 (adversarial / solo-wiring fails-on-revert): the SOLO handler must ─
// actually CALL filterCuratedByStopHours on the assembled cards before responding.
// This is the wiring that closes the solo gap (deckService.ts → generate-curated
// bypassed discover-cards entirely, so it never got the hours filter). Removing
// the handler call line reverts the solo gap → this source-grep FAILS, proving
// the wiring is load-bearing (the dispatch-named T-2-01 fails-on-revert).
Deno.test('T-2-01 (adversarial / solo-wiring fails-on-revert): solo handler applies the hours filter', async () => {
  const src = await Deno.readTextFile(
    new URL('../../generate-curated-experiences/index.ts', import.meta.url),
  );
  // Strip comments so we assert against EXECUTABLE wiring, not the explanatory header.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  // (a) the import exists. [ORCH-1113] relaxed from a sole-import shape: the
  // handler now ALSO imports resolveCuratedHoursPolicy from the same module, so
  // assert the named import appears (not that it is the only one).
  assert(/import\s*\{[^}]*\bfilterCuratedByStopHours\b[^}]*\}\s*from\s*'\.\.\/_shared\/curatedStopHours\.ts'/.test(code),
    'solo handler must import filterCuratedByStopHours');

  // (b) the handler reassigns cards through the filter (the load-bearing wiring).
  assert(/cards\s*=\s*filterCuratedByStopHours\s*\(\s*cards\s*,/.test(code),
    'solo handler must call cards = filterCuratedByStopHours(cards, ...) — removing this reverts the solo gap');

  // (c) [ORCH-1113] the start-time source is now the date-option policy resolver
  // (live clock for 'today', NOT the stale stored datetime_pref). The old
  // assertion (datetimePref ? new Date(datetimePref) : new Date()) asserted the
  // exact line this ORCH removes; replaced with the new policy wiring.
  assert(/resolveCuratedHoursPolicy\s*\(\s*\{\s*dateOption\s*,\s*datetimePref\s*,\s*selectedDates\s*\}\s*\)/.test(code),
    'solo filter start time must come from resolveCuratedHoursPolicy({ dateOption, datetimePref, selectedDates }) (ORCH-1113 date-option parity)');

  // (d) the empty-after-filter summary fallback is present (mobile routes to EMPTY UI).
  assert(/cards\.length\s*===\s*0\s*&&\s*!summary/.test(code),
    'empty-after-filter must set a summary verdict so mobile does not stick on loading');
});
