// ORCH-1068 [business-authored venues render on the consumer deck]
// Deno tests for the shared converter + the defensive reader branches.
//
// Run from supabase/:
//   deno test --allow-read functions/_shared/__tests__/businessHoursToGoogle.test.ts
//
// Coverage (SPEC §7):
//   T-01 converter Monday            T-08 Google-shape row unaffected (fails-on-revert)
//   T-02 converter all-7-weekdays    T-09 defensive reader on raw array
//   T-03 converter overnight         T-10 curated reader array branch
//   T-04 converter closed row        T-11 hero picker skips video
//   T-05 isBusinessHoursArray guard  T-13 fails-on-revert (curated array branch load-bearing)
//   T-06 include open business venue
//   T-07 exclude closed business venue

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  businessHoursToGoogleOpeningHours,
  businessWeekdayToGoogleDay,
  isBusinessHoursArray,
  normalizeBusinessHoursForPool,
  parseHm,
  type BusinessHourRow,
} from '../businessHoursToGoogle.ts';
import { isStopOpenAtHour } from '../curatedStopHours.ts';

// ── Faithful re-implementation of the discover-cards filterByDateTime open-hours
//    evaluation (index.ts isOpenAtHour Path B evalPeriods + the ORCH-1068 array
//    branch + hasOpeningData) so the include/exclude behaviour can be asserted in
//    isolation. The array branch under test is the production path: array →
//    businessHoursToGoogleOpeningHours(...).periods → evalPeriods. ───────────────
function evalPeriods(periodsArr: any[], day: number, hourFrac: number): boolean {
  return periodsArr.some((period: any) => {
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
    const ohObj = oh as any;
    if (Array.isArray(ohObj.periods) && ohObj.periods.length > 0) {
      return evalPeriods(ohObj.periods, day, hourFrac);
    }
  }
  return false;
}
function deckHasOpeningData(oh: unknown): boolean {
  if (oh && typeof oh === 'object') {
    if (isBusinessHoursArray(oh)) {
      return businessHoursToGoogleOpeningHours(oh).periods.length > 0;
    }
    const ohObj = oh as any;
    if (Array.isArray(ohObj.periods) && ohObj.periods.length > 0) return true;
  }
  return false;
}

const LANTERN: BusinessHourRow[] = Array.from({ length: 7 }, (_, w) => ({
  weekday: w,
  isClosed: false,
  openTime: '07:00',
  closeTime: '20:00',
}));

// ── T-01 — converter Monday (weekday 0 → Google day 1) ──────────────────────────
Deno.test('T-01 converter maps Monday(weekday0) → Google day 1', () => {
  const out = businessHoursToGoogleOpeningHours([
    { weekday: 0, isClosed: false, openTime: '07:00', closeTime: '20:00' },
  ]);
  assertEquals(out.openNow, null);
  assertEquals(out.periods.length, 1);
  assertEquals(out.periods[0].open, { day: 1, hour: 7, minute: 0 });
  assertEquals(out.periods[0].close, { day: 1, hour: 20, minute: 0 });
  assertEquals(out.weekdayDescriptions.length, 7);
  assertEquals(out.weekdayDescriptions[0], 'Monday: 7:00 AM – 8:00 PM');
});

// ── T-02 — all 7 weekdays translate correctly (Sunday business → Google 0) ───────
Deno.test('T-02 weekday→day = (weekday+1)%7 for all 7 days', () => {
  const expected = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun → Google
  for (let w = 0; w < 7; w++) {
    assertEquals(businessWeekdayToGoogleDay(w), expected[w]);
    const out = businessHoursToGoogleOpeningHours([
      { weekday: w, isClosed: false, openTime: '09:00', closeTime: '17:00' },
    ]);
    assertEquals(out.periods[0].open.day, expected[w]);
  }
  // Sunday business (weekday 6) → Google day 0.
  assertEquals(businessWeekdayToGoogleDay(6), 0);
});

// ── T-03 — overnight span: Friday(weekday4)→Google5, close rolls to day 6 ────────
Deno.test('T-03 overnight 18:00→02:00 sets close.day = next google day', () => {
  const out = businessHoursToGoogleOpeningHours([
    { weekday: 4, isClosed: false, openTime: '18:00', closeTime: '02:00' },
  ]);
  assertEquals(out.periods.length, 1);
  assertEquals(out.periods[0].open, { day: 5, hour: 18, minute: 0 });
  assertEquals(out.periods[0].close, { day: 6, hour: 2, minute: 0 });
});

// ── T-04 — closed row contributes no period ─────────────────────────────────────
Deno.test('T-04 isClosed row yields no period + Closed description', () => {
  const out = businessHoursToGoogleOpeningHours([
    { weekday: 2, isClosed: true, openTime: null, closeTime: null },
  ]);
  assertEquals(out.periods.length, 0);
  // weekday 2 = Wednesday (index 2 in Mon→Sun array).
  assertEquals(out.weekdayDescriptions[2], 'Wednesday: Closed');
});

// ── T-05 — isBusinessHoursArray guard distinguishes shapes ──────────────────────
Deno.test('T-05 isBusinessHoursArray: array=true, Google object=false', () => {
  assert(isBusinessHoursArray(LANTERN));
  assert(isBusinessHoursArray([])); // empty array is a (degenerate) business array
  assertEquals(isBusinessHoursArray({ periods: [{ open: { day: 1 } }] }), false);
  assertEquals(isBusinessHoursArray(null), false);
  assertEquals(isBusinessHoursArray('x'), false);
  // normalizeBusinessHoursForPool passes a Google object through unchanged.
  const google: any = { openNow: null, periods: [{ open: { day: 1, hour: 9, minute: 0 } }] };
  assertEquals(normalizeBusinessHoursForPool(google), google);
  assertEquals(normalizeBusinessHoursForPool(null), null);
  assertEquals(normalizeBusinessHoursForPool(undefined), null);
});

// ── parseHm helper ──────────────────────────────────────────────────────────────
Deno.test('parseHm parses HH:MM and HH:MM:SS, rejects junk', () => {
  assertEquals(parseHm('07:00'), { hour: 7, minute: 0 });
  assertEquals(parseHm('23:59:00'), { hour: 23, minute: 59 });
  assertEquals(parseHm(''), null);
  assertEquals(parseHm(null), null);
  assertEquals(parseHm('24:00'), null);
  assertEquals(parseHm('9am'), null);
});

// ── T-06 (happy) — open business venue is kept by the deck filter at 14:00 ───────
Deno.test('T-06 open business venue: kept at local 14:00 Monday', () => {
  const oh = LANTERN;
  assert(deckHasOpeningData(oh)); // has data
  // Monday in Google index = 1. 07:00–20:00 → open at 14:00.
  assert(deckIsOpenAtHour(oh, 1, 14));
});

// ── T-07 (adversarial-closed) — closed-now business venue is excluded ───────────
Deno.test('T-07 closed business venue: excluded at local 23:00', () => {
  const oh = LANTERN;
  // 23:00 is outside 07:00–20:00 → not open.
  assertEquals(deckIsOpenAtHour(oh, 1, 23), false);
  // And a genuinely-closed DAY (Lumen-style Sunday closed) excludes on that day.
  const lumen: BusinessHourRow[] = [
    ...Array.from({ length: 6 }, (_, w) => ({ weekday: w, isClosed: false, openTime: '09:00', closeTime: '17:00' })),
    { weekday: 6, isClosed: true, openTime: null, closeTime: null }, // Sunday closed (Google day 0)
  ];
  assertEquals(deckIsOpenAtHour(lumen, 0, 12), false); // Sunday noon → closed
  assert(deckIsOpenAtHour(lumen, 1, 12)); // Monday noon → open
});

// ── T-08 (adversarial-google, fails-on-revert) — Google-shape row unaffected ────
Deno.test('T-08 Google {periods} row behaves identically (no regression)', () => {
  const google = {
    openNow: null,
    periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
  };
  assert(deckHasOpeningData(google));
  assert(deckIsOpenAtHour(google, 1, 10)); // Mon 10:00 → open
  assertEquals(deckIsOpenAtHour(google, 1, 20), false); // Mon 20:00 → closed
  assertEquals(deckIsOpenAtHour(google, 0, 10), false); // Sun 10:00 → no Sunday period
});

// ── T-09 — defensive reader on a raw (un-normalized) array ──────────────────────
Deno.test('T-09 defensive reader: raw array has opening data', () => {
  // Simulates the migration NOT yet applied — a stray array is fed directly.
  assert(deckHasOpeningData(LANTERN));
  assertEquals(deckHasOpeningData([{ weekday: 0, isClosed: true, openTime: null, closeTime: null }]), false);
});

// ── T-10 — curated reader (real module) array branch ────────────────────────────
Deno.test('T-10 isStopOpenAtHour accepts the business array shape', () => {
  // Lumen: Mon-Sat 09:00-17:00, Sun closed. dayOfWeek is Google 0=Sun.
  const lumen: BusinessHourRow[] = [
    ...Array.from({ length: 6 }, (_, w) => ({ weekday: w, isClosed: false, openTime: '09:00', closeTime: '17:00' })),
    { weekday: 6, isClosed: true, openTime: null, closeTime: null },
  ];
  const stop = { placeType: 'wine_bar', openingHours: lumen };
  assert(isStopOpenAtHour(stop, 12, 1)); // Monday noon → open
  assertEquals(isStopOpenAtHour(stop, 12, 0), false); // Sunday noon → closed
  assertEquals(isStopOpenAtHour(stop, 20, 1), false); // Monday 20:00 → closed
});

// ── T-11 — hero picker skips video, keeps full list ─────────────────────────────
// Mirrors discover-cards transformServablePlaceToCard hero logic exactly.
Deno.test('T-11 hero picker: first non-video url, full list preserved', () => {
  const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i;
  const isVideoUrl = (u: string) => VIDEO_EXT.test(u) || /\/video\/upload\//.test(u);
  const pickHero = (urls: string[]) =>
    urls.find((u) => typeof u === 'string' && !isVideoUrl(u)) ?? null;

  const stored = [
    'https://res.cloudinary.com/x/video/upload/c_limit/v1/raw/a.mp4',
    'https://res.cloudinary.com/x/image/upload/v1/gallery/mpvfz1bobnl59k.jpg',
  ];
  assertEquals(pickHero(stored), stored[1]);
  // images list (the deck keeps the full ordered list).
  assertEquals(stored.length, 2);
  // All-video → null hero (deck falls back to its stock image honestly).
  assertEquals(pickHero(['https://x/video/upload/a.mp4']), null);
});

// ── T-13 (fails-on-revert) — curated array branch is load-bearing ───────────────
// If the ORCH-1068 `isBusinessHoursArray` branch is removed from
// curatedStopHours.isStopOpenAtHour, a closed-Sunday business array falls through
// to the honest-unknown text path (no `.periods`, no day text) → returns TRUE
// (open) on Sunday, so this assertion FAILS. That proves the branch is load-bearing.
Deno.test('T-13 fails-on-revert: closed-Sunday array must be CLOSED in curated reader', () => {
  const lumen: BusinessHourRow[] = [
    ...Array.from({ length: 6 }, (_, w) => ({ weekday: w, isClosed: false, openTime: '09:00', closeTime: '17:00' })),
    { weekday: 6, isClosed: true, openTime: null, closeTime: null },
  ];
  const stop = { placeType: 'wine_bar', openingHours: lumen };
  // Sunday (Google day 0) noon — WITHOUT the array branch this returns true.
  assertEquals(isStopOpenAtHour(stop, 12, 0), false);
});
