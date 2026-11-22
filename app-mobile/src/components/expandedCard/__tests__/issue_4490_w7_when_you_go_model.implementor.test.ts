/**
 * #4490 Explorer W7 — "When you'd go" on every venue surface: the pure model.
 *
 *   C-*  venue wall clock without Intl parts (offset arithmetic; zone via the
 *        shared one-string reader; fail closed) and the Hermes guard;
 *   K-*  chips: Now + Event, the event preselected, today vs another day, the
 *        midnight edge in the venue zone;
 *   D-*  drive minutes and Leave by (start - drive - 5, floored to 5, "now");
 *   F-*  the hide matrix, drive never varying by chip, the block's own rule;
 *   R-*  the 7-day forecast reach (inside and beyond), "On the day" on a pass;
 *   L-*  the checkout line;
 *   H-*  Hermes (parts mistyped) and source guards;
 *   W-*  weatherService asks for 7 days and keys its cache by the day count.
 *
 * FAILS-ON-REVERT: forecast_days back to 3 (W-1, R-1); the day count out of the
 * cache key (W-2); the Event chip not preselected (K-2); a parts-based
 * formatter in any W7 file (H-2); Leave by without the 5 minute buffer (D-2).
 */
import fs from 'node:fs';
import path from 'node:path';

import { FORECAST_DAYS, weatherService, type HourlyForecast } from '../../../services/weatherService';
import { VENUE_POPULARITY } from '../../../constants/venuePopularityPatterns';
import { crowdLevel, forecastAt, whenChips } from '../placeSheetModel';
import {
  checkoutLineFor,
  chipLabelSpec,
  eventWhenChips,
  FORECAST_REACH_DAYS,
  initialWhenKey,
  leaveByFor,
  offsetClock,
  offsetMinutesAt,
  onTheDayFor,
  parseDriveMinutes,
  shiftDate,
  wallDayDiff,
  whenBlockVisible,
  whenFactsFor,
  zoneClock,
  type WhenFactsInput,
} from '../whenYoudGoModel';

// app-mobile's tsc has no jest or react-test-renderer types: declare what this
// suite uses so it adds no type errors (the W5 and W6 suites do the same).
declare const jest: any;
declare const describe: any;
declare const test: any;
declare const expect: any;
declare const afterEach: any;
const LAGOS = 'Africa/Lagos';
// Tuesday 24 Nov 2026, 11:00 in Lagos (UTC+1).
const NOW = new Date('2026-11-24T10:00:00Z');
const SAT_19 = new Date('2026-11-28T18:00:00Z'); // Sat 28 Nov 19:00 Lagos

/** 7 days of hourly forecast from 24 Nov 00:00 venue-local, as Open-Meteo returns it. */
function hourly7(): HourlyForecast[] {
  const out: HourlyForecast[] = [];
  for (let d = 0; d < 7; d += 1) {
    for (let h = 0; h < 24; h += 1) {
      const day = new Date(Date.UTC(2026, 10, 24 + d));
      out.push({
        time: `${day.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:00`,
        temperature: 80,
        condition: 'Clear',
        icon: '01d',
        precipitation: 0,
        precipitationProbability: 40,
      });
    }
  }
  return out;
}

const HOURS_OPEN = [
  'Monday: 10:00 AM – 11:00 PM',
  'Tuesday: 10:00 AM – 11:00 PM',
  'Wednesday: 10:00 AM – 11:00 PM',
  'Thursday: 10:00 AM – 11:00 PM',
  'Friday: 10:00 AM – 11:00 PM',
  'Saturday: 10:00 AM – 11:00 PM',
  'Sunday: 10:00 AM – 11:00 PM',
];

const baseInput = (over: Partial<WhenFactsInput> = {}): WhenFactsInput => ({
  now: NOW,
  hourly: hourly7(),
  weatherUtcOffsetSeconds: 3600,
  category: 'drink',
  showCrowd: true,
  utcOffsetMinutes: 60,
  openingHours: HOURS_OPEN,
  driveTime: '25 min',
  lat: 6.45,
  lng: 3.43,
  ...over,
});

describe('#4490 W7 — venue wall clock (C)', () => {
  test('C-1 offsetClock is arithmetic: Lagos +60, a half-hour zone, null = this device', () => {
    expect(offsetClock(60)(SAT_19)).toEqual({ year: 2026, month: 11, day: 28, hour: 19, minute: 0 });
    expect(offsetClock(330)(new Date('2026-11-28T18:00:00Z'))).toEqual({ year: 2026, month: 11, day: 28, hour: 23, minute: 30 });
    const device = offsetClock(null)(SAT_19);
    expect(device?.hour).toBe(SAT_19.getHours());
    expect(offsetClock(60)(new Date('nope'))).toBeNull();
  });

  test('C-2 zoneClock reads the zone through the shared one-string reader and fails closed', () => {
    expect(zoneClock(LAGOS)(SAT_19)).toEqual({ year: 2026, month: 11, day: 28, hour: 19, minute: 0 });
    expect(zoneClock('Europe/London')(new Date('2026-07-01T18:30:00Z'))).toEqual({ year: 2026, month: 7, day: 1, hour: 19, minute: 30 });
    // Unreadable zone: null (a pass never shows the phone's clock for a venue's day) ...
    expect(zoneClock(null)(SAT_19)).toBeNull();
    expect(zoneClock('not a zone')(SAT_19)).toBeNull();
    expect(zoneClock('+01:00')(SAT_19)).toBeNull();
    // ... unless a fallback offset is given.
    expect(zoneClock(null, 60)(SAT_19)?.hour).toBe(19);
  });

  test('C-3 offsetMinutesAt recovers the zone offset from its wall clock', () => {
    expect(offsetMinutesAt(zoneClock(LAGOS), SAT_19)).toBe(60);
    expect(offsetMinutesAt(zoneClock('Europe/London'), new Date('2026-07-01T12:00:00Z'))).toBe(60);
    expect(offsetMinutesAt(zoneClock('Europe/London'), new Date('2026-12-01T12:00:00Z'))).toBe(0);
    expect(offsetMinutesAt(zoneClock(null), SAT_19)).toBeNull();
  });

  test('C-4 calendar helpers: day diff, shiftDate across a month end', () => {
    const a = { year: 2026, month: 11, day: 28, hour: 0, minute: 0 };
    const b = { year: 2026, month: 12, day: 2, hour: 23, minute: 59 };
    expect(wallDayDiff(a, b)).toBe(4);
    expect(shiftDate('2026-12-02', -6)).toBe('2026-11-26');
    expect(shiftDate('nonsense', 1)).toBeNull();
  });
});

describe('#4490 W7 — chips (K)', () => {
  test('K-1 an event ahead gives Now + Event; a started, past or unreadable event gives Now only', () => {
    expect(eventWhenChips(NOW, SAT_19).map((c) => c.key)).toEqual(['now', 'event']);
    expect(eventWhenChips(NOW, new Date('2026-11-24T09:00:00Z')).map((c) => c.key)).toEqual(['now']);
    expect(eventWhenChips(NOW, NOW).map((c) => c.key)).toEqual(['now']);
    expect(eventWhenChips(NOW, null).map((c) => c.key)).toEqual(['now']);
    expect(eventWhenChips(NOW, new Date('nope')).map((c) => c.key)).toEqual(['now']);
  });

  test('K-2 the Event chip is preselected (decided); with none, the first chip', () => {
    expect(initialWhenKey(eventWhenChips(NOW, SAT_19))).toBe('event');
    expect(initialWhenKey(eventWhenChips(NOW, null))).toBe('now');
    expect(initialWhenKey([])).toBe('now');
    // the place sheet's chips never carry an event chip
    expect(whenChips(NOW, 60, null).some((c) => c.key === 'event')).toBe(false);
  });

  test('K-3 the Event chip: "Event · 19:00" today, "Event · Sat 19:00" another day', () => {
    const resolve = zoneClock(LAGOS);
    const today = eventWhenChips(NOW, new Date('2026-11-24T18:00:00Z'))[1];
    expect(chipLabelSpec(today, NOW, resolve)).toEqual({ kind: 'event', time: '19:00' });
    const sat = eventWhenChips(NOW, SAT_19)[1];
    expect(chipLabelSpec(sat, NOW, resolve)).toEqual({ kind: 'event_day', day: 'Sat', time: '19:00' });
  });

  test('K-4 "Your plan": the time alone today, "Sat 17:00" another day (24-hour)', () => {
    const resolve = offsetClock(60);
    const todayPlan = whenChips(NOW, 60, new Date('2026-11-24T16:00:00Z')).find((c) => c.key === 'scheduled')!;
    expect(chipLabelSpec(todayPlan, NOW, resolve)).toEqual({ kind: 'scheduled', minuteOfDay: 17 * 60 });
    const satPlan = whenChips(NOW, 60, new Date('2026-11-28T16:00:00Z')).find((c) => c.key === 'scheduled')!;
    expect(chipLabelSpec(satPlan, NOW, resolve)).toEqual({ kind: 'scheduled_day', day: 'Sat', time: '17:00' });
  });

  test('K-5 midnight edge: 23:00 Lagos now, an event at 00:30 Lagos is NEXT day ("Sun 00:30"), not today', () => {
    const lateNow = new Date('2026-11-28T22:00:00Z'); // Sat 23:00 Lagos
    const ev = eventWhenChips(lateNow, new Date('2026-11-28T23:30:00Z'))[1]; // Sun 00:30 Lagos
    expect(chipLabelSpec(ev, lateNow, zoneClock(LAGOS))).toEqual({ kind: 'event_day', day: 'Sun', time: '00:30' });
    // The same instants read on a UTC device clock would say the same day: the venue zone is what counts.
    expect(chipLabelSpec(ev, lateNow, offsetClock(0))).toEqual({ kind: 'event', time: '23:30' });
  });

  test('K-6 an unreadable clock never prints a made-up time for the event', () => {
    const ev = eventWhenChips(NOW, SAT_19)[1];
    expect(chipLabelSpec(ev, NOW, zoneClock(null))).toEqual({ kind: 'event', time: '' });
  });
});

describe('#4490 W7 — drive and Leave by (D)', () => {
  test('D-1 drive minutes from the card label; no unit-bearing number, no minutes', () => {
    expect(parseDriveMinutes('25 min')).toBe(25);
    expect(parseDriveMinutes('1 hr 5 min')).toBe(65);
    expect(parseDriveMinutes('1h 5m')).toBe(65);
    expect(parseDriveMinutes('2 hours')).toBe(120);
    expect(parseDriveMinutes('Nearby')).toBeNull();
    expect(parseDriveMinutes('25')).toBeNull();
    expect(parseDriveMinutes('0 min')).toBeNull();
    expect(parseDriveMinutes(null)).toBeNull();
  });

  test('D-2 Leave by = start - drive - 5 minutes, floored to 5', () => {
    const at = (l: ReturnType<typeof leaveByFor>) => (l && l.kind === 'at' ? l.at.toISOString() : l?.kind);
    // 19:00 Lagos (18:00Z) - 25 - 5 = 18:30 Lagos (17:30Z)
    expect(at(leaveByFor(SAT_19, 25, NOW))).toBe('2026-11-28T17:30:00.000Z');
    // 27 min drive: 18:00Z - 32 = 17:28Z -> floors to 17:25Z
    expect(at(leaveByFor(SAT_19, 27, NOW))).toBe('2026-11-28T17:25:00.000Z');
  });

  test('D-3 a Leave by that has passed reads "Leave now"; no drive or no start hides it', () => {
    const soon = new Date('2026-11-24T10:20:00Z');
    expect(leaveByFor(soon, 25, NOW)).toEqual({ kind: 'now' });
    expect(leaveByFor(SAT_19, null, NOW)).toBeNull();
    expect(leaveByFor(new Date('nope'), 25, NOW)).toBeNull();
    // exactly now is "now", not a time in the past
    expect(leaveByFor(new Date(NOW.getTime() + 30 * 60_000), 25, NOW)).toEqual({ kind: 'now' });
  });
});

describe('#4490 W7 — the block: hide rules (F)', () => {
  const event = eventWhenChips(NOW, SAT_19)[1];
  const now = eventWhenChips(NOW, SAT_19)[0];

  test('F-1 full sources: weather, crowd, drive, sunset; the Event chip adds Leave by, Now does not', () => {
    const f = whenFactsFor(now, baseInput());
    expect(f.weather).not.toBeNull();
    expect(f.crowd?.level).toBeDefined();
    expect(f.drive).toBe('25 min');
    expect(f.sunset).not.toBeNull();
    expect(f.leaveBy).toBeNull();
    expect(whenFactsFor(event, baseInput({ showCrowd: false })).leaveBy).toEqual({ kind: 'at', at: new Date('2026-11-28T17:30:00.000Z') });
  });

  test('F-2 no hourly forecast for that hour: Weather hides (and nothing else does)', () => {
    const f = whenFactsFor(now, baseInput({ hourly: null }));
    expect(f.weather).toBeNull();
    expect(f.drive).toBe('25 min');
    expect(whenFactsFor(now, baseInput({ hourly: [] })).weather).toBeNull();
  });

  test('F-3 no drive: Drive and Leave by hide', () => {
    for (const driveTime of [null, '', '   ', 'Nearby']) {
      const f = whenFactsFor(event, baseInput({ driveTime, showCrowd: false }));
      if (driveTime === 'Nearby') {
        // the tile still says what it was handed; Leave by never guesses
        expect(f.drive).toBe('Nearby');
      } else {
        expect(f.drive).toBeNull();
      }
      expect(f.leaveBy).toBeNull();
    }
  });

  test('F-4 no coordinates: Sunset hides; bad coordinates too', () => {
    expect(whenFactsFor(now, baseInput({ lat: null, lng: null })).sunset).toBeNull();
    expect(whenFactsFor(now, baseInput({ lat: 120, lng: 3 })).sunset).toBeNull();
  });

  test('F-5 crowd off (event page): no crowd, no Quieter at, whatever the category', () => {
    const f = whenFactsFor(event, baseInput({ showCrowd: false }));
    expect(f.crowd).toBeNull();
    expect(f.quieter).toBeNull();
  });

  test('F-6 Quieter at only with readable opening hours, and only for an hour the place is open', () => {
    const closes22 = HOURS_OPEN.map((l) => l.replace('11:00 PM', '10:00 PM'));
    const hours = [12, 13, 19, 20].map((h) => new Date(Date.UTC(2026, 10, 27, h - 1))); // Fri, Lagos hour h
    const quietAt = (openingHours: unknown) =>
      hours.map((at) => whenFactsFor({ key: 'tonight', at }, baseInput({ category: 'casual_eats', openingHours })).quieter);
    const withHours = quietAt(closes22);
    expect(withHours[0]).toBe(14); // lunch peak at 12:00: 14:00 is a full level quieter and the place is open
    for (const q of withHours) if (q !== null) expect(q).toBeLessThan(22); // never at/after closing
    expect(quietAt(null).every((q) => q === null)).toBe(true);
    expect(quietAt('not hours').every((q) => q === null)).toBe(true);
  });

  test('F-7 drive is ONE estimate for today: identical on every chip', () => {
    const chips = whenChips(NOW, 60, new Date('2026-11-28T16:00:00Z'));
    const drives = chips.map((c) => whenFactsFor(c, baseInput()).drive);
    expect(new Set(drives)).toEqual(new Set(['25 min']));
  });

  test('F-8 the block hides when no chip has a row; one Good to know row keeps it', () => {
    const chips = eventWhenChips(NOW, SAT_19);
    const nothing = baseInput({ hourly: null, driveTime: null, lat: null, lng: null, showCrowd: false });
    expect(whenBlockVisible(chips, nothing)).toBe(false);
    expect(whenBlockVisible(chips, { ...nothing, lat: 6.45, lng: 3.43 })).toBe(true); // Sunset only
    expect(whenBlockVisible(chips, { ...nothing, driveTime: '25 min' })).toBe(true); // Drive tile + Leave by
  });
});

describe('#4490 W7 — 7-day reach and "On the day" (R)', () => {
  test('R-1 the forecast answers inside the 7 days and not a minute beyond', () => {
    expect(FORECAST_REACH_DAYS).toBe(7);
    const h = hourly7();
    expect(forecastAt(h, SAT_19, 3600)).not.toBeNull(); // Sat 28, 4 days out
    expect(forecastAt(h, new Date('2026-11-30T22:00:00Z'), 3600)).not.toBeNull(); // Mon 30 23:00 Lagos = last hour
    expect(forecastAt(h, new Date('2026-11-30T23:00:00Z'), 3600)).toBeNull(); // Tue 1 Dec 00:00 Lagos: beyond
  });

  test('R-2 a Saturday booking 4 days out shows weather, drive and Leave by; no "from" note', () => {
    const r = onTheDayFor({ startsAt: SAT_19, now: NOW, resolve: zoneClock(LAGOS), hourly: hourly7(), weatherUtcOffsetSeconds: 3600, driveMinutes: 25 });
    expect(r).not.toBeNull();
    expect(r!.weather?.time).toBe('2026-11-28T19:00');
    expect(r!.driveMinutes).toBe(25);
    expect(r!.leaveBy).toEqual({ kind: 'at', at: new Date('2026-11-28T17:30:00.000Z') });
    expect(r!.forecastFrom).toBeNull();
    // never a crowd: the result has no crowd field at all
    expect(Object.keys(r!)).not.toContain('crowd');
  });

  test('R-3 a booking more than 7 days out says when the forecast shows: "from" = booked day - 6', () => {
    const wed = new Date('2026-12-02T18:00:00Z'); // Wed 2 Dec 19:00 Lagos, 8 days out
    const r = onTheDayFor({ startsAt: wed, now: NOW, resolve: zoneClock(LAGOS), hourly: hourly7(), weatherUtcOffsetSeconds: 3600, driveMinutes: 25 });
    expect(r!.weather).toBeNull();
    expect(r!.forecastFrom).toBe('Thu 26 Nov');
    expect(r!.driveMinutes).toBe(25);
    // exactly day 7 (Tue 1 Dec) is the first day beyond the reach
    const tue = new Date('2026-12-01T18:00:00Z');
    expect(onTheDayFor({ startsAt: tue, now: NOW, resolve: zoneClock(LAGOS), hourly: hourly7(), weatherUtcOffsetSeconds: 3600, driveMinutes: null })!.forecastFrom).toBe('Wed 25 Nov');
    // day 6 (Mon 30 Nov) is still inside
    const mon = new Date('2026-11-30T18:00:00Z');
    const inside = onTheDayFor({ startsAt: mon, now: NOW, resolve: zoneClock(LAGOS), hourly: hourly7(), weatherUtcOffsetSeconds: 3600, driveMinutes: null });
    expect(inside!.weather).not.toBeNull();
    expect(inside!.forecastFrom).toBeNull();
  });

  test('R-4 nothing to say, nothing shown: started, no start, unreadable zone, no sources', () => {
    const common = { now: NOW, resolve: zoneClock(LAGOS), hourly: hourly7(), weatherUtcOffsetSeconds: 3600, driveMinutes: 25 as number | null };
    expect(onTheDayFor({ ...common, startsAt: new Date('2026-11-24T09:00:00Z') })).toBeNull();
    expect(onTheDayFor({ ...common, startsAt: null })).toBeNull();
    expect(onTheDayFor({ ...common, startsAt: SAT_19, resolve: zoneClock(null) })).toBeNull();
    expect(onTheDayFor({ ...common, startsAt: SAT_19, hourly: null, driveMinutes: null })).toBeNull();
    // a failed weather read still keeps drive and Leave by
    const drive = onTheDayFor({ ...common, startsAt: SAT_19, hourly: null });
    expect(drive!.weather).toBeNull();
    expect(drive!.driveMinutes).toBe(25);
    expect(drive!.forecastFrom).toBeNull();
  });

  test('R-5 a drive of 0 or NaN is no drive', () => {
    const common = { startsAt: SAT_19, now: NOW, resolve: zoneClock(LAGOS), hourly: hourly7(), weatherUtcOffsetSeconds: 3600 };
    expect(onTheDayFor({ ...common, driveMinutes: 0 })!.driveMinutes).toBeNull();
    expect(onTheDayFor({ ...common, driveMinutes: Number.NaN })!.leaveBy).toBeNull();
  });
});

describe('#4490 W7 — the checkout line (L)', () => {
  const input = { day: '2026-11-28', time: '19:00', hourly: hourly7(), category: 'drink' };

  test('L-1 both chosen: "{day}, {time}" with the forecast and the usual crowd', () => {
    const line = checkoutLineFor(input);
    expect(line).not.toBeNull();
    expect(line!.day).toBe('Sat 28 Nov');
    expect(line!.time).toBe('19:00');
    expect(line!.weather?.time).toBe('2026-11-28T19:00');
    expect(['quiet', 'steady', 'busy', 'packed']).toContain(line!.crowd);
  });

  test('L-2 only when BOTH day and time are chosen, and well formed', () => {
    for (const bad of [
      { ...input, day: null },
      { ...input, time: null },
      { ...input, day: undefined },
      { ...input, time: '' },
      { ...input, time: '7pm' },
      { ...input, time: '25:00' },
      { ...input, day: '28/11/2026' },
      { ...input, day: '2026-02-31' },
    ]) {
      expect(checkoutLineFor(bad)).toBeNull();
    }
  });

  test('L-3 past the forecast the weather part hides and the crowd stays', () => {
    const line = checkoutLineFor({ ...input, day: '2026-12-05' });
    expect(line!.weather).toBeNull();
    expect(line!.crowd).not.toBeNull();
  });

  test('L-4 no category: no crowd part; nothing left to say: no line', () => {
    expect(checkoutLineFor({ ...input, category: null })!.crowd).toBeNull();
    expect(checkoutLineFor({ ...input, category: '  ' })!.crowd).toBeNull();
    expect(checkoutLineFor({ ...input, category: null, hourly: null })).toBeNull();
    expect(checkoutLineFor({ ...input, day: '2026-12-05', category: null })).toBeNull();
  });

  test('L-5 the day picks the curve: Saturday uses the weekend curve, Tuesday the weekday one', () => {
    const drink = VENUE_POPULARITY.drink;
    const sat = checkoutLineFor({ ...input, time: '21:00' });
    const tue = checkoutLineFor({ ...input, day: '2026-11-24', time: '21:00' });
    expect(sat!.crowd).toBe(crowdLevel(drink.weekend[21]));
    expect(tue!.crowd).toBe(crowdLevel(drink.weekday[21]));
  });
});

describe('#4490 W7 — Hermes: no Intl parts (H)', () => {
  const RealDTF = Intl.DateTimeFormat;
  function partsBroken(locale?: string | string[], options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const real = new RealDTF(locale, options);
    return {
      format: (d?: Date | number) => real.format(d),
      resolvedOptions: () => real.resolvedOptions(),
      // What Hermes on Apple does with a date + time pattern: hour and minute typed `literal`.
      formatToParts: (d?: Date | number) => real.formatToParts(d).map((p) => (p.type === 'hour' || p.type === 'minute' ? { type: 'literal' as const, value: p.value } : p)),
    } as unknown as Intl.DateTimeFormat;
  }

  test('H-1 with formatToParts mistyped, the venue clock, the event chip and On the day still read right', () => {
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = partsBroken;
    try {
      expect(zoneClock(LAGOS)(SAT_19)).toEqual({ year: 2026, month: 11, day: 28, hour: 19, minute: 0 });
      expect(chipLabelSpec(eventWhenChips(NOW, SAT_19)[1], NOW, zoneClock(LAGOS))).toEqual({ kind: 'event_day', day: 'Sat', time: '19:00' });
      const r = onTheDayFor({ startsAt: SAT_19, now: NOW, resolve: zoneClock(LAGOS), hourly: hourly7(), weatherUtcOffsetSeconds: 3600, driveMinutes: 25 });
      expect(r!.weather?.time).toBe('2026-11-28T19:00');
    } finally {
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = RealDTF;
    }
  });

  test('H-2 no W7 file builds times from Intl parts or formats a time itself (comments stripped)', () => {
    const root = path.join(__dirname, '../../../..');
    const files = [
      'src/components/expandedCard/whenYoudGoModel.ts',
      'src/components/expandedCard/WhenYoudGo.tsx',
      'src/components/expandedCard/EventWhenYoudGo.tsx',
      'src/components/expandedCard/hostedEventContext.ts',
      'src/components/purchases/VenueOnTheDay.tsx',
      'src/components/venueOffers/VenueCheckoutWhenLine.tsx',
      'src/hooks/useVenueForecast.ts',
    ];
    for (const rel of files) {
      const code = fs
        .readFileSync(path.join(root, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(`${rel}: ${/formatToParts|Intl\.DateTimeFormat|toLocale(Time|Date)String/.test(code)}`).toBe(`${rel}: false`);
    }
  });
});

describe('#4490 W7 — weatherService reach (W)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const body = {
    current: { temperature_2m: 80, relative_humidity_2m: 50, apparent_temperature: 82, weather_code: 0, wind_speed_10m: 3, uv_index: 5, precipitation: 0, is_day: 1 },
    hourly: { time: ['2026-11-24T00:00'], temperature_2m: [79], weather_code: [0], precipitation: [0], precipitation_probability: [10], is_day: [1] },
    timezone: 'Africa/Lagos',
    utc_offset_seconds: 3600,
  };

  test('W-1 the request asks for 7 forecast days (was 3) and nothing else about it changed', async () => {
    const urls: string[] = [];
    global.fetch = jest.fn(async (u: unknown) => {
      urls.push(String(u));
      return { ok: true, json: async () => body } as Response;
    }) as unknown as typeof fetch;
    const out = await weatherService.getWeatherForecast(51.5074, -0.1278);
    expect(out?.hourlyForecast?.[0].time).toBe('2026-11-24T00:00');
    expect(FORECAST_DAYS).toBe(7);
    const url = urls[0];
    expect(url).toContain('forecast_days=7');
    expect(url).not.toContain('forecast_days=3');
    expect(url).toContain('current=temperature_2m');
    expect(url).toContain('hourly=temperature_2m,weather_code,precipitation,precipitation_probability,is_day');
    expect(url).toContain('timezone=auto');
  });

  test('W-2 the cache key carries the day count, and a second ask inside 15 minutes does not refetch', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => body }) as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    await weatherService.getWeatherForecast(40.7128, -74.006);
    await weatherService.getWeatherForecast(40.7128, -74.006);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const cache = (weatherService as unknown as { weatherCache: Map<string, unknown> }).weatherCache;
    expect(cache.has('40.713_-74.006_7d')).toBe(true);
    // an entry cached under the old 3-day key can never answer a 7-day ask
    expect(cache.has('40.713_-74.006')).toBe(false);
  });

  test('W-3 callers that read today and tomorrow still get them (forecastAt on a 7-day series)', () => {
    const h = hourly7();
    expect(forecastAt(h, NOW, 3600)?.time).toBe('2026-11-24T11:00');
    expect(forecastAt(h, new Date('2026-11-25T18:00:00Z'), 3600)?.time).toBe('2026-11-25T19:00');
  });
});
