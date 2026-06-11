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

// ═════════════════════════════════════════════════════════════════════════════
// ORCH-1113 [curated-experience-empty-deck-regression] — TESTER adversarial set.
//
// These attack DIFFERENT angles than the implementor's T-01..T-12 (which use a
// single Brussels +120 card and mostly call the policy resolver directly):
//   T-3-01 — stale-pref-leak at the END-TO-END FILTER level on a FAR-EAST
//            positive offset (Tokyo +540). Proves the stale stored instant can
//            NOT reach filterCuratedByStopHours under 'today' even when its sign
//            and magnitude differ from the implementor's case.
//   T-3-02 — 'today' STILL drops a closed-now stop via a MULTI-STOP card
//            (different angle from the implementor's single-stop T-02): the
//            ORCH-1061 same-day arrival cascade must survive the policy rewrite.
//   T-3-03 — 'this_weekend' retains a Sat-only stop while datetimePref AND a
//            weekday selectedDates BOTH point at non-weekend days — proving the
//            weekend policy ignores both stored signals.
//   T-3-04 — 'all_closed_at_time' FALSE-SIGNAL guard: the handler's empty-reason
//            branch must be gated so a genuinely-empty pool (no cards built)
//            keeps 'pool_empty' and never reports 'all_closed_at_time'. Proven
//            via the structural precondition (filter returning [] on a non-empty
//            input means cards were dropped) + a handler source-grep that the
//            pool_empty/no_viable_anchor summary is set BEFORE the new branch.
//   T-3-05 — idempotence on a MIXED list (some kept, some dropped): re-running
//            the filter on the survivors drops nothing further, in BOTH modes
//            (stronger than the implementor's all-passing T-11).
//   T-3-06 — pick_dates with MULTIPLE selected dates spanning different weekdays:
//            a stop open on ANY one of the selected days is retained (union),
//            and a stop open on none is dropped.
// ═════════════════════════════════════════════════════════════════════════════

import {
  resolveCuratedHoursPolicy,
  isStopOpenAtHourAnyTime,
} from '../curatedStopHours.ts';

// Canonical Google v1 periods entry helper (local to this block).
function p(day: number, openHour: number, closeHour: number) {
  return { periods: [{ open: { day, hour: openHour, minute: 0 }, close: { day, hour: closeHour, minute: 0 } }] };
}

// A weeks-stale stored instant: 2026-04-15 (Wed) 21:20 UTC.
const STALE_PREF_WED_NIGHT = '2026-04-15T21:20:44.492Z';

// ─── T-3-01: stale-pref does NOT leak end-to-end on a FAR-EAST offset ─────────
Deno.test("T-3-01 (adversarial): 'today' ignores the stale datetime_pref on a Tokyo +540 card (end-to-end filter)", () => {
  // Tokyo = UTC+540 min (+9h). The stale stored instant 2026-04-15 21:20 UTC maps
  // to 06:20 Tokyo-local the NEXT day (Thu) — BEFORE an 11:00 open. The live clock
  // we feed is 2026-06-03 04:00 UTC → 13:00 Tokyo-local (Wed, day=3) → OPEN.
  // The stop is open Wed 11:00–23:00 ONLY (no Thu period), so if the stale instant
  // leaked (Thu 06:20) the day would be wrong (Thu, no period) → dropped. The fix
  // uses the live clock (Wed 13:00) → retained. The verdict flips on which clock.
  const tokyoCard = {
    cardType: 'curated', utcOffsetMinutes: 540, lng: 139.69,
    stops: [{ placeType: 'restaurant', openingHours: p(3, 11, 23), travelTimeFromPreviousStopMin: 0 }],
  };
  const liveNow = new Date(Date.UTC(2026, 5, 3, 4, 0, 0)); // Wed 04:00 UTC → 13:00 Tokyo
  const policy = resolveCuratedHoursPolicy({ dateOption: 'today', datetimePref: STALE_PREF_WED_NIGHT, now: liveNow });
  // Sanity: the resolved policy must be instant-at-live-clock, never the stale pref.
  assertEquals(policy.mode, 'instant');
  assertEquals((policy as { mode: 'instant'; utcNow: Date }).utcNow.getTime(), liveNow.getTime(),
    'policy must carry the LIVE clock, never the parsed stale datetime_pref');
  const result = filterCuratedByStopHours([tokyoCard], policy);
  assertEquals(result.length, 1, "today must evaluate the Tokyo card at the live 13:00 local clock → RETAINED (stale Thu-06:20 pref would have dropped it)");
});

// ─── T-3-02: 'today' STILL drops a closed-now stop (multi-stop, ORCH-1061) ────
Deno.test("T-3-02 (adversarial): 'today' STILL drops a closed-now stop on a MULTI-STOP card (ORCH-1061 same-day cascade survives)", () => {
  // Live clock: Wed 22:30 local (utcOffsetMinutes=0, 22:30 UTC). Stop 0 (restaurant)
  // open 11:00–23:00 → open at 22:30. Stop 1 (museum) open 09:00–18:00 → after
  // stop0 60min dwell + 15min travel ≈ 23:45 → CLOSED → whole card DROPPED.
  // If the policy rewrite had weakened the same-day arrival cascade to any-hour,
  // the museum would falsely pass (open SOMETIME Wed) and the card would survive.
  const liveNow2230 = new Date(Date.UTC(2026, 5, 3, 22, 30, 0));
  const card = {
    cardType: 'curated', utcOffsetMinutes: 0, lng: 0,
    stops: [
      { placeType: 'restaurant', openingHours: p(3, 11, 23), travelTimeFromPreviousStopMin: 0 },
      { placeType: 'museum', openingHours: p(3, 9, 18), travelTimeFromPreviousStopMin: 15 },
    ],
  };
  const policy = resolveCuratedHoursPolicy({ dateOption: 'today', datetimePref: STALE_PREF_WED_NIGHT, now: liveNow2230 });
  const result = filterCuratedByStopHours([card], policy);
  assertEquals(result.length, 0, "today must keep the ORCH-1061 same-day arrival cascade: a downstream stop closed by projected arrival drops the card");

  // Control: same card, early enough that the museum is still open on arrival.
  const liveNowNoon = new Date(Date.UTC(2026, 5, 3, 12, 0, 0)); // Wed 12:00; museum reached ~13:15, still < 18:00
  const policyNoon = resolveCuratedHoursPolicy({ dateOption: 'today', now: liveNowNoon });
  assertEquals(filterCuratedByStopHours([card], policyNoon).length, 1,
    'control: at noon the multi-stop card is retained (filter is not over-pruning today)');
});

// ─── T-3-03: 'this_weekend' ignores BOTH datetimePref and weekday selectedDates ─
Deno.test("T-3-03 (adversarial): 'this_weekend' retains a Sat-only stop while datetime_pref AND a weekday selectedDates both point off-weekend", () => {
  // Stop open ONLY Saturday (day=6) 14:00–18:00. We pass a Wed-night datetimePref
  // AND a selectedDates of a WEEKDAY (2026-06-17 = Wednesday). Under this_weekend
  // the policy must be anyHourOnDays:[6,0] — IGNORING both off-weekend signals —
  // so the Sat-only stop is RETAINED.
  const card = {
    cardType: 'curated', utcOffsetMinutes: 120, lng: 4.35,
    stops: [{ placeType: 'restaurant', openingHours: p(6, 14, 18), travelTimeFromPreviousStopMin: 0 }],
  };
  const policy = resolveCuratedHoursPolicy({
    dateOption: 'this_weekend',
    datetimePref: STALE_PREF_WED_NIGHT,
    selectedDates: ['2026-06-17'], // a Wednesday — must be ignored under this_weekend
  });
  assertEquals(policy.mode, 'anyHourOnDays');
  assertEquals((policy as { mode: 'anyHourOnDays'; days: number[] }).days, [6, 0],
    'this_weekend must resolve to Sat+Sun, ignoring datetimePref AND a weekday selectedDates');
  assertEquals(filterCuratedByStopHours([card], policy).length, 1,
    'a Sat-only stop survives this_weekend regardless of the stored weekday signals');

  // And a Tuesday-only stop is DROPPED under this_weekend (no weekend period).
  const tueOnly = {
    cardType: 'curated', utcOffsetMinutes: 120, lng: 4.35,
    stops: [{ placeType: 'restaurant', openingHours: p(2, 14, 18), travelTimeFromPreviousStopMin: 0 }],
  };
  assertEquals(filterCuratedByStopHours([tueOnly], policy).length, 0,
    'a Tuesday-only stop is dropped under this_weekend (no Sat/Sun period)');
});

// ─── T-3-04: 'all_closed_at_time' false-signal guard ──────────────────────────
Deno.test("T-3-04 (adversarial): all_closed_at_time can ONLY follow a non-empty built pool (no false signal on a genuinely empty pool)", async () => {
  // Structural precondition: filterCuratedByStopHours can only return [] on a
  // NON-EMPTY input by DROPPING cards. So 'all_closed_at_time' (which the handler
  // gates on builtCount > 0) is impossible to reach from a 0-card built pool.
  // (1) Empty input → empty output, with NO card ever dropped (builtCount === 0).
  const emptyOut = filterCuratedByStopHours([], resolveCuratedHoursPolicy({ dateOption: 'today' }));
  assertEquals(emptyOut.length, 0, 'empty input → empty output (no cards to drop)');

  // (2) A non-empty pool of all-closed cards → empty output (builtCount > 0 → the
  //     branch that yields all_closed_at_time). This is the ONLY path to it.
  const closedCard = {
    cardType: 'curated', utcOffsetMinutes: 0, lng: 0,
    stops: [{ placeType: 'restaurant', openingHours: p(3, 9, 17), travelTimeFromPreviousStopMin: 0 }],
  };
  const droppedOut = filterCuratedByStopHours([closedCard], WED_1800_UTC); // 18:00 > 17:00 close
  assertEquals(droppedOut.length, 0, 'a non-empty all-closed pool empties → builtCount>0 path');

  // (3) Handler source-grep: the genuinely-empty verdicts (pool_empty /
  //     no_viable_anchor) are produced by generateCardsForType BEFORE the
  //     all_closed_at_time branch, and that branch is gated `builtCount > 0`.
  const src = await Deno.readTextFile(
    new URL('../../generate-curated-experiences/index.ts', import.meta.url),
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // builtCount is captured from cards.length BEFORE the hours filter reassigns cards.
  assert(/const\s+builtCount\s*=\s*cards\.length\s*;[\s\S]*?cards\s*=\s*filterCuratedByStopHours\s*\(\s*cards\s*,/.test(code),
    'builtCount must be captured from cards.length BEFORE the hours filter');
  // The all_closed_at_time branch is gated on builtCount > 0 (never on an empty pool).
  assert(/builtCount\s*>\s*0[\s\S]*?emptyReason:\s*'all_closed_at_time'/.test(code),
    "all_closed_at_time must be gated builtCount > 0 (false-signal guard) — else fall to pool_empty");
  // And the empty branch only runs when no prior summary exists (genuine pool_empty/
  // no_viable_anchor from generateCardsForType short-circuit it via && !summary).
  assert(/cards\.length\s*===\s*0\s*&&\s*!summary/.test(code),
    'the empty-after-filter branch only runs when generateCardsForType produced no prior summary');
});

// ─── T-3-05: idempotence on a MIXED list (survivors re-filter to themselves) ──
Deno.test('T-3-05 (adversarial): re-filtering a MIXED list (some kept, some dropped) drops nothing further — both modes', () => {
  // instant mode: card A open at 18:00 (retained), card B closed at 18:00 (dropped).
  const open18 = { cardType: 'curated', utcOffsetMinutes: 0, lng: 0,
    stops: [{ placeType: 'restaurant', openingHours: p(3, 11, 23), travelTimeFromPreviousStopMin: 0 }] };
  const closed18 = { cardType: 'curated', utcOffsetMinutes: 0, lng: 0,
    stops: [{ placeType: 'restaurant', openingHours: p(3, 9, 17), travelTimeFromPreviousStopMin: 0 }] };
  const onceI = filterCuratedByStopHours([open18, closed18], WED_1800_UTC);
  assertEquals(onceI.length, 1, 'instant: mixed list → exactly the open card survives the first pass');
  const twiceI = filterCuratedByStopHours(onceI, WED_1800_UTC);
  assertEquals(twiceI.length, onceI.length, 'instant: re-filtering the survivors drops nothing further (idempotent)');

  // anyHourOnDays mode: card C open Sat (retained under this_weekend), card D open Tue only (dropped).
  const satOpen = { cardType: 'curated', utcOffsetMinutes: 0, lng: 0,
    stops: [{ placeType: 'restaurant', openingHours: p(6, 14, 18), travelTimeFromPreviousStopMin: 0 }] };
  const tueOpen = { cardType: 'curated', utcOffsetMinutes: 0, lng: 0,
    stops: [{ placeType: 'restaurant', openingHours: p(2, 14, 18), travelTimeFromPreviousStopMin: 0 }] };
  const weekend = resolveCuratedHoursPolicy({ dateOption: 'this_weekend' });
  const onceW = filterCuratedByStopHours([satOpen, tueOpen], weekend);
  assertEquals(onceW.length, 1, 'anyHourOnDays: mixed list → only the Sat-open card survives');
  const twiceW = filterCuratedByStopHours(onceW, weekend);
  assertEquals(twiceW.length, onceW.length, 'anyHourOnDays: re-filtering the survivors is a no-op (idempotent)');
});

// ─── T-3-06: pick_dates union across MULTIPLE selected weekdays ───────────────
Deno.test("T-3-06 (adversarial): 'pick_dates' takes the UNION of selected weekdays (open on ANY one → retained)", () => {
  // 2026-06-17 = Wednesday (day=3); 2026-06-20 = Saturday (day=6). A stop open
  // ONLY Saturday must be retained (Sat is in the union); a stop open ONLY
  // Friday (day=5) must be dropped (neither selected day is Friday).
  const policy = resolveCuratedHoursPolicy({
    dateOption: 'pick_dates',
    selectedDates: ['2026-06-17', '2026-06-20'],
    datetimePref: STALE_PREF_WED_NIGHT,
  });
  assertEquals(policy.mode, 'anyHourOnDays');
  const days = (policy as { mode: 'anyHourOnDays'; days: number[] }).days.slice().sort();
  assertEquals(days, [3, 6], 'pick_dates resolves to the weekdays of the selected dates (Wed + Sat)');

  const satOnly = { cardType: 'curated', utcOffsetMinutes: 0, lng: 0,
    stops: [{ placeType: 'restaurant', openingHours: p(6, 14, 18), travelTimeFromPreviousStopMin: 0 }] };
  assertEquals(filterCuratedByStopHours([satOnly], policy).length, 1,
    'a Sat-only stop is retained (Sat ∈ {Wed,Sat})');

  const friOnly = { cardType: 'curated', utcOffsetMinutes: 0, lng: 0,
    stops: [{ placeType: 'restaurant', openingHours: p(5, 14, 18), travelTimeFromPreviousStopMin: 0 }] };
  assertEquals(filterCuratedByStopHours([friOnly], policy).length, 0,
    'a Fri-only stop is dropped (Fri ∉ {Wed,Sat})');

  // Direct unit check of the any-time predicate underpinning the union.
  assert(isStopOpenAtHourAnyTime({ placeType: 'restaurant', openingHours: p(6, 14, 18) }, 6), 'Sat-open any-time true on Sat');
  assert(!isStopOpenAtHourAnyTime({ placeType: 'restaurant', openingHours: p(6, 14, 18) }, 5), 'Sat-open any-time false on Fri');
});
