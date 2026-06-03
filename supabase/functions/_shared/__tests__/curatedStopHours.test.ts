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
