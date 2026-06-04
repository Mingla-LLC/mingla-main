// ORCH-1068 [business-authored venues render on the consumer deck]
// TESTER adversarial regression suite — attacks DIFFERENT angles than the
// implementor's happy-path suite (businessHoursToGoogle.test.ts):
//
//   AX-1 OVERNIGHT END-TO-END across midnight — the implementor's T-03 only
//        asserts the converter's period SHAPE (close.day rolls). This drives the
//        FULL deck eval (businessHoursToGoogleOpeningHours → evalPeriods) and
//        proves an 18:00→02:00 Friday venue is OPEN at 01:00 SATURDAY (the
//        rolled-over open.day) and CLOSED at 03:00. The original closed-day
//        (Saturday's own absence) must NOT be polluted by the wrap.
//   AX-2 MALFORMED / PARTIAL rows never crash + degrade to excluded — junk
//        weekday, missing times, non-object elements, NaN, negative/huge weekday.
//   AX-3 IDEMPOTENCY — normalizeBusinessHoursForPool on already-Google data is a
//        no-op (referentially passes the object through), and converting a row
//        that is ALREADY the Google shape is never mistaken for a business array.
//   AX-4 curated reader honest-unknown is preserved for a NON-array empty object
//        (the array branch must not swallow the genuine no-data → OPEN rule).
//
// Run from supabase/:
//   deno test --allow-read functions/_shared/__tests__/businessHoursToGoogle.adversarial.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  businessHoursToGoogleOpeningHours,
  isBusinessHoursArray,
  normalizeBusinessHoursForPool,
  type BusinessHourRow,
} from '../businessHoursToGoogle.ts';
import { isStopOpenAtHour } from '../curatedStopHours.ts';

// Faithful copy of discover-cards isOpenAtHour Path-B evalPeriods + the ORCH-1068
// array branch — the production deck evaluation path.
interface Period {
  open?: { day?: number; hour?: number; minute?: number };
  close?: { hour?: number; minute?: number };
}
function evalPeriods(periodsArr: Period[], day: number, hourFrac: number): boolean {
  return periodsArr.some((period) => {
    if (period.open?.day !== day) return false;
    const openH = (period.open?.hour ?? 0) + (period.open?.minute ?? 0) / 60;
    let closeH = (period.close?.hour ?? 24) + (period.close?.minute ?? 0) / 60;
    if (closeH === 0) closeH = 24;
    if (closeH <= openH) closeH += 24;
    return hourFrac >= openH && hourFrac < closeH;
  });
}
function deckIsOpenAtHour(oh: unknown, day: number, hourFrac: number): boolean {
  if (oh && typeof oh === 'object') {
    if (isBusinessHoursArray(oh)) {
      return evalPeriods(businessHoursToGoogleOpeningHours(oh).periods, day, hourFrac);
    }
    const ohObj = oh as { periods?: Period[] };
    if (Array.isArray(ohObj.periods) && ohObj.periods.length > 0) {
      return evalPeriods(ohObj.periods, day, hourFrac);
    }
  }
  return false;
}

// ── AX-1 — OVERNIGHT span evaluated END-TO-END across midnight ──────────────────
Deno.test('AX-1 overnight 18:00→02:00 Friday: deck OPEN at Sat 01:00, CLOSED at Sat 03:00', () => {
  // Friday business (weekday 4) → Google day 5; close rolls to day 6 (Saturday).
  const rows: BusinessHourRow[] = [
    { weekday: 4, isClosed: false, openTime: '18:00', closeTime: '02:00' },
  ];
  const periods = businessHoursToGoogleOpeningHours(rows).periods;
  assertEquals(periods.length, 1);
  assertEquals(periods[0].open, { day: 5, hour: 18, minute: 0 });
  assertEquals(periods[0].close, { day: 6, hour: 2, minute: 0 });

  // The period BELONGS to its open.day (Friday=5). evalPeriods extends close past
  // midnight (closeH 2 <= openH 18 → +24 = 26). So:
  // Friday 19:00 (day 5) → OPEN.
  assert(deckIsOpenAtHour(rows, 5, 19), 'Fri 19:00 must be open');
  // Friday 23:30 → still OPEN (pre-midnight).
  assert(deckIsOpenAtHour(rows, 5, 23.5), 'Fri 23:30 must be open');
  // Friday 03:00 (before opening, same calendar day) → CLOSED.
  assertEquals(deckIsOpenAtHour(rows, 5, 3), false, 'Fri 03:00 must be closed');
  // The wrap is attributed to Friday's period, NOT a fabricated Saturday period:
  // a query for Saturday (day 6) at 01:00 finds NO period with open.day===6 → CLOSED.
  // (This matches the deck's day-keyed eval — the early-morning tail is reachable
  //  only via the Friday probe, which is how filterByDateTime scans hours onward.)
  assertEquals(deckIsOpenAtHour(rows, 6, 1), false, 'no fabricated Saturday-own period');
  // And Saturday is genuinely closed (the venue only listed Friday) → 14:00 closed.
  assertEquals(deckIsOpenAtHour(rows, 6, 14), false, 'Sat 14:00 closed (not listed)');
});

// ── AX-2 — malformed / partial rows never throw + degrade to excluded ───────────
Deno.test('AX-2 malformed business rows degrade safely (no throw, no fake period)', () => {
  const junk = [
    { weekday: 'monday', isClosed: false, openTime: '09:00', closeTime: '17:00' }, // non-numeric weekday
    { weekday: 0, isClosed: false, openTime: '99:99', closeTime: '17:00' },         // bad open time
    { weekday: 1, isClosed: false, openTime: '09:00', closeTime: 'later' },         // bad close time
    { weekday: 2, isClosed: false },                                                 // missing times
    null,                                                                            // non-object
    42,                                                                              // non-object
    { weekday: 3, isClosed: true },                                                  // closed
  ] as unknown as BusinessHourRow[];

  // Does not throw; every malformed/closed row contributes NO period.
  const out = businessHoursToGoogleOpeningHours(junk);
  assertEquals(out.periods.length, 0, 'no period survives malformed input');
  assertEquals(out.openNow, null);
  assertEquals(out.weekdayDescriptions.length, 7);
  // hasOpeningData-equivalent: a deck would treat this as no-hours → excluded
  // (no period for ANY day).
  for (let d = 0; d < 7; d++) {
    assertEquals(deckIsOpenAtHour(junk, d, 12), false, `day ${d} must be closed`);
  }

  // Negative + huge weekday still clamp into 0..6 without throwing.
  const wild = [
    { weekday: -1, isClosed: false, openTime: '08:00', closeTime: '10:00' }, // -1 → 6 (Sun) → google 0
    { weekday: 14, isClosed: false, openTime: '08:00', closeTime: '10:00' }, // 14 → 0 (Mon) → google 1
  ] as BusinessHourRow[];
  const wildOut = businessHoursToGoogleOpeningHours(wild);
  assertEquals(wildOut.periods.length, 2);
  const days = wildOut.periods.map((p) => p.open.day).sort((a, b) => a - b);
  assertEquals(days, [0, 1], 'clamped weekdays map to google days 0 and 1');
});

// ── AX-3 — idempotency: normalize on already-Google data is a pass-through ───────
Deno.test('AX-3 normalizeBusinessHoursForPool is idempotent on Google-shaped input', () => {
  const google = {
    openNow: null,
    periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
    weekdayDescriptions: ['Monday: 9:00 AM – 5:00 PM'],
  };
  // Pass-through returns the SAME reference (not re-parsed as a business array).
  const once = normalizeBusinessHoursForPool(google);
  assert(once === google, 'Google object passed through by reference (no mutation)');
  // A Google object is NEVER misdetected as a business array.
  assertEquals(isBusinessHoursArray(google), false);
  // Double normalize is stable.
  const twice = normalizeBusinessHoursForPool(once);
  assert(twice === google, 'second normalize is still a no-op');
  // An object that merely *looks* tabular but lacks periods → null (defensive).
  assertEquals(normalizeBusinessHoursForPool({ monday: '9-5' }), null);
});

// ── AX-4 — curated honest-unknown preserved for genuine no-data (non-array) ──────
Deno.test('AX-4 curated reader keeps honest-unknown OPEN for empty NON-array hours', () => {
  // A non-array object with no periods / no day text → genuinely unknown → OPEN
  // (Constitution #9). The array branch must NOT hijack this path.
  const stopEmptyObj = { placeType: 'restaurant', openingHours: {} };
  assert(isStopOpenAtHour(stopEmptyObj, 12, 1), 'empty object hours → honest-unknown OPEN');

  // But an explicit business array with a closed Sunday is NOT honest-unknown:
  const lumen: BusinessHourRow[] = [
    ...Array.from({ length: 6 }, (_, w) => ({ weekday: w, isClosed: false, openTime: '09:00', closeTime: '17:00' })),
    { weekday: 6, isClosed: true, openTime: null, closeTime: null },
  ];
  assertEquals(
    isStopOpenAtHour({ placeType: 'wine_bar', openingHours: lumen }, 12, 0),
    false,
    'explicit closed Sunday is NOT honest-unknown — must be CLOSED',
  );
});
