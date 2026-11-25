/**
 * #4490 Explorer W7 — "When you'd go" on every venue surface, as pure data.
 *
 * One model for five places: the place sheet and the host venue page Overview
 * (unchanged behaviour), the event page for an event at a hosted venue (chips
 * Now and Event, crowd off, Leave by), the venue pass ("On the day": weather,
 * drive and Leave by, never a crowd) and the checkout line (one calm line when
 * both the day and the time are chosen).
 *
 * Rules held here, each tested:
 *   - Every row hides when its source is empty (Constitution 9): no hourly
 *     forecast for that hour, no weather; no drive, no Drive and no Leave by;
 *     no coordinates, no Sunset; no readable hours, no Quieter at.
 *   - Drive is ONE estimate for today and never varies by chip.
 *   - The crowd is the built-in typical curve only, always worded "Usually".
 *   - HERMES: no `Intl` parts anywhere in this file. Venue wall-clock reads go
 *     through `offsetClock` (arithmetic) or `zoneClock` (the shared
 *     `venueWallClock`, one formatted string), the rule W3 fix 3 proved on the
 *     react-native Hermes VM (Hermes on iOS mistypes `formatToParts`).
 */
import { venueWallClock } from '@mingla/brand-rendering/venueOpenState';
import { venueDateLabel } from '@mingla/brand-rendering/venueFeaturePage';

import type { HourlyForecast } from '../../services/weatherService';
import { FORECAST_DAYS } from '../../services/weatherService';
import { extractWeekdayText, isPlaceOpenAt } from '../../utils/openingHoursUtils';
import {
  forecastAt,
  quieterHour,
  sunsetAt,
  typicalCrowdAt,
  type CrowdLevel,
  type TypicalCrowd,
  type WhenChip,
  type WhenKey,
} from './placeSheetModel';

/** The days the weather reaches (today and the six after). Owned by `weatherService`. */
export const FORECAST_REACH_DAYS = FORECAST_DAYS;
/** Minutes of walking-out-the-door slack in "Leave by" (as `onTheNight.ts`). */
export const LEAVE_BUFFER_MINUTES = 5;
const FIVE_MINUTES_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Venue wall clock (no Intl parts)
// ─────────────────────────────────────────────────────────────────────────────

/** A venue-local date and time. `month` is 1-12. */
export interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/** Reads an instant as a venue wall clock; null = cannot be read (the row hides). */
export type ClockResolver = (at: Date) => WallClock | null;

function validDate(at: Date): boolean {
  return at instanceof Date && !Number.isNaN(at.getTime());
}

/** The venue clock from a UTC offset in minutes (null = this device's clock). Arithmetic only. */
export function offsetClock(utcOffsetMinutes: number | null | undefined): ClockResolver {
  return (at) => {
    if (!validDate(at)) return null;
    if (utcOffsetMinutes == null) {
      return {
        year: at.getFullYear(),
        month: at.getMonth() + 1,
        day: at.getDate(),
        hour: at.getHours(),
        minute: at.getMinutes(),
      };
    }
    const s = new Date(at.getTime() + utcOffsetMinutes * 60_000);
    return {
      year: s.getUTCFullYear(),
      month: s.getUTCMonth() + 1,
      day: s.getUTCDate(),
      hour: s.getUTCHours(),
      minute: s.getUTCMinutes(),
    };
  };
}

/**
 * The venue clock from an IANA zone name, through the shared `venueWallClock`.
 * `fallbackOffsetMinutes` undefined: an unreadable zone gives null (fail
 * closed: a pass never shows the phone's clock for a venue's day); a number or
 * null: that offset (null = this device) is used instead.
 */
export function zoneClock(zone: string | null | undefined, fallbackOffsetMinutes?: number | null): ClockResolver {
  return (at) => {
    const w = venueWallClock(at, zone);
    if (w !== null) return { year: w.year, month: w.month, day: w.day, hour: w.hour, minute: w.minute };
    return fallbackOffsetMinutes === undefined ? null : offsetClock(fallbackOffsetMinutes)(at);
  };
}

/** The venue's UTC offset in minutes at `at`, from its wall clock (null when unreadable). */
export function offsetMinutesAt(resolve: ClockResolver, at: Date): number | null {
  const w = resolve(at);
  if (w === null || !validDate(at)) return null;
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const atMinute = Math.floor(at.getTime() / 60_000) * 60_000;
  return Math.round((wallAsUtc - atMinute) / 60_000);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "YYYY-MM-DD". */
export const wallDate = (w: WallClock): string => `${w.year}-${pad2(w.month)}-${pad2(w.day)}`;
/** "HH:MM", 24-hour. */
export const wallTime = (w: WallClock): string => `${pad2(w.hour)}:${pad2(w.minute)}`;
/** Whole calendar days from `a` to `b` (venue-local dates). */
export const wallDayDiff = (a: WallClock, b: WallClock): number =>
  Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS);

/** "Sat" (English short weekday, the day-first style every #4490 venue date uses). */
export function wallWeekday(w: WallClock): string {
  return venueDateLabel(wallDate(w)).split(' ')[0] ?? '';
}

/** "Sat 28 Nov". */
export const wallDayLabel = (w: WallClock): string => venueDateLabel(wallDate(w));

/** The calendar date `days` before/after a wall date, as "YYYY-MM-DD". */
export function shiftDate(date: string, days: number): string | null {
  if (!DATE_ONLY.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  if (Number.isNaN(t.getTime())) return null;
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Drive and Leave by
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minutes in a drive label ("25 min", "1 hr 5 min", "1h 5m", "2 hours"). Null
 * when there is no unit-bearing number (the Drive tile still shows the text;
 * Leave by hides: it never guesses).
 */
export function parseDriveMinutes(text: string | null | undefined): number | null {
  if (typeof text !== 'string') return null;
  const hours = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(text);
  const mins = /(\d+)\s*(?:m|min|mins|minute|minutes)\b/i.exec(text);
  if (hours === null && mins === null) return null;
  const total = (hours === null ? 0 : Math.round(Number(hours[1]) * 60)) + (mins === null ? 0 : Number(mins[1]));
  return Number.isFinite(total) && total > 0 ? total : null;
}

export type LeaveBy = { readonly kind: 'now' } | { readonly kind: 'at'; readonly at: Date };

/**
 * Start minus drive minus 5 minutes, floored to 5 minutes; "Leave now" when
 * that moment has passed (as `onTheNight.ts`). Null without a drive estimate
 * or a start.
 */
export function leaveByFor(start: Date, driveMinutes: number | null, now: Date): LeaveBy | null {
  if (!validDate(start) || !validDate(now)) return null;
  if (driveMinutes === null || !Number.isFinite(driveMinutes) || driveMinutes <= 0) return null;
  const leave = start.getTime() - (driveMinutes + LEAVE_BUFFER_MINUTES) * 60_000;
  const floored = Math.floor(leave / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
  return floored <= now.getTime() ? { kind: 'now' } : { kind: 'at', at: new Date(floored) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chips
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Now and, when the event is still ahead, Event. An event already started (or
 * with no readable start) gets Now only.
 */
export function eventWhenChips(now: Date, eventStart: Date | null | undefined): WhenChip[] {
  const chips: WhenChip[] = [{ key: 'now', at: now }];
  if (eventStart instanceof Date && validDate(eventStart) && eventStart.getTime() > now.getTime()) {
    chips.push({ key: 'event', at: eventStart });
  }
  return chips;
}

/** The chip opened on: the Event chip when there is one (decided), else the first. */
export function initialWhenKey(chips: readonly WhenChip[]): WhenKey {
  return chips.find((c) => c.key === 'event')?.key ?? chips[0]?.key ?? 'now';
}

export type ChipLabelSpec =
  | { readonly kind: 'now' }
  | { readonly kind: 'tonight'; readonly minuteOfDay: number }
  | { readonly kind: 'tomorrow'; readonly minuteOfDay: number }
  /** Your plan, today: the time in the viewer's clock, as before. */
  | { readonly kind: 'scheduled'; readonly minuteOfDay: number }
  /** Your plan, another day: "Your plan · Sat 17:00". */
  | { readonly kind: 'scheduled_day'; readonly day: string; readonly time: string }
  /** The event, today: "Event · 19:00". */
  | { readonly kind: 'event'; readonly time: string }
  /** The event, another day: "Event · Sat 17:00". */
  | { readonly kind: 'event_day'; readonly day: string; readonly time: string };

/** What a chip says, as data (the component turns it into words). */
export function chipLabelSpec(chip: WhenChip, now: Date, resolve: ClockResolver): ChipLabelSpec {
  const w = resolve(chip.at);
  const minuteOfDay = w === null ? 0 : w.hour * 60 + w.minute;
  switch (chip.key) {
    case 'now':
      return { kind: 'now' };
    case 'tonight':
      return { kind: 'tonight', minuteOfDay };
    case 'tomorrow':
      return { kind: 'tomorrow', minuteOfDay };
    case 'scheduled':
    case 'event': {
      const today = resolve(now);
      const sameDay = w === null || today === null || wallDayDiff(today, w) === 0;
      if (chip.key === 'scheduled') {
        return sameDay || w === null
          ? { kind: 'scheduled', minuteOfDay }
          : { kind: 'scheduled_day', day: wallWeekday(w), time: wallTime(w) };
      }
      return sameDay || w === null
        ? { kind: 'event', time: w === null ? '' : wallTime(w) }
        : { kind: 'event_day', day: wallWeekday(w), time: wallTime(w) };
    }
    default: {
      const never: never = chip.key;
      return never;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The block's rows for one chip
// ─────────────────────────────────────────────────────────────────────────────

export interface WhenFactsInput {
  readonly now: Date;
  readonly hourly: readonly HourlyForecast[] | null | undefined;
  readonly weatherUtcOffsetSeconds?: number | null;
  /** The typical-crowd curve key; ignored when `showCrowd` is false. */
  readonly category: string | null | undefined;
  /** Event pages and passes: no crowd, whatever the category. */
  readonly showCrowd: boolean;
  readonly utcOffsetMinutes: number | null;
  readonly openingHours?: unknown;
  /** Today's drive label (one estimate; never varies by chip). */
  readonly driveTime?: string | null;
  readonly lat?: number | null;
  readonly lng?: number | null;
}

export interface WhenFacts {
  readonly weather: HourlyForecast | null;
  readonly crowd: TypicalCrowd | null;
  readonly drive: string | null;
  readonly sunset: Date | null;
  readonly quieter: number | null;
  /** Only on the Event chip, and only with a drive estimate. */
  readonly leaveBy: LeaveBy | null;
}

/** Everything the block can say for one chip; each field null when its source is empty. */
export function whenFactsFor(chip: WhenChip, input: WhenFactsInput): WhenFacts {
  const weather = forecastAt(input.hourly, chip.at, input.weatherUtcOffsetSeconds ?? null);
  const crowd = input.showCrowd ? typicalCrowdAt(input.category, chip.at, input.utcOffsetMinutes) : null;
  const weekday = extractWeekdayText(input.openingHours as Parameters<typeof extractWeekdayText>[0]);
  const quieter =
    crowd === null
      ? null
      : quieterHour(crowd, (hour) => {
          if (weekday === null) return null;
          const delta = (hour - crowd.hour) * 3_600_000;
          return isPlaceOpenAt(weekday, new Date(chip.at.getTime() + delta), input.utcOffsetMinutes);
        });
  const sunset =
    typeof input.lat === 'number' && typeof input.lng === 'number'
      ? sunsetAt(input.lat, input.lng, new Date(chip.at.getTime() + (input.utcOffsetMinutes ?? 0) * 60_000))
      : null;
  const drive = typeof input.driveTime === 'string' && input.driveTime.trim().length > 0 ? input.driveTime.trim() : null;
  const leaveBy = chip.key === 'event' ? leaveByFor(chip.at, parseDriveMinutes(drive), input.now) : null;
  return { weather, crowd, drive, sunset, quieter, leaveBy };
}

/** Tiles (weather, crowd, drive) and "Good to know" rows (sunset, quieter at, leave by). */
export function whenFactRowCount(f: WhenFacts): { tiles: number; goodToKnow: number } {
  return {
    tiles: (f.weather ? 1 : 0) + (f.crowd ? 1 : 0) + (f.drive ? 1 : 0),
    goodToKnow: (f.sunset ? 1 : 0) + (f.quieter !== null ? 1 : 0) + (f.leaveBy ? 1 : 0),
  };
}

/**
 * The block's own hide rule: with no tile left it shows only while a
 * "Good to know" row remains; with nothing at all it hides. Judged across every
 * chip, so switching chips never makes the whole block vanish under the thumb.
 */
export function whenBlockVisible(chips: readonly WhenChip[], input: WhenFactsInput): boolean {
  return chips.some((c) => {
    const n = whenFactRowCount(whenFactsFor(c, input));
    return n.tiles > 0 || n.goodToKnow > 0;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Passes: "On the day"
// ─────────────────────────────────────────────────────────────────────────────

export interface OnTheDayInput {
  readonly startsAt: Date | null | undefined;
  readonly now: Date;
  readonly resolve: ClockResolver;
  readonly hourly: readonly HourlyForecast[] | null | undefined;
  readonly weatherUtcOffsetSeconds?: number | null;
  /** Today's drive estimate in minutes (null = unknown). */
  readonly driveMinutes: number | null;
}

export interface OnTheDay {
  readonly weather: HourlyForecast | null;
  readonly driveMinutes: number | null;
  readonly leaveBy: LeaveBy | null;
  /** "Thu 26 Nov": the day the weather appears, when the booked day is past the forecast. */
  readonly forecastFrom: string | null;
}

/**
 * Weather, drive and Leave by for the booked time; never a crowd. Null when
 * there is nothing to show (no start, already started, or no row has a
 * source). A day more than the forecast's reach away says from which day the
 * forecast shows.
 */
export function onTheDayFor(input: OnTheDayInput): OnTheDay | null {
  const { startsAt, now, resolve } = input;
  if (!(startsAt instanceof Date) || !validDate(startsAt) || startsAt.getTime() <= now.getTime()) return null;
  const start = resolve(startsAt);
  const today = resolve(now);
  if (start === null || today === null) return null;
  const weather = forecastAt(input.hourly, startsAt, input.weatherUtcOffsetSeconds ?? null);
  const daysOut = wallDayDiff(today, start);
  let forecastFrom: string | null = null;
  if (weather === null && daysOut >= FORECAST_REACH_DAYS) {
    const from = shiftDate(wallDate(start), -(FORECAST_REACH_DAYS - 1));
    forecastFrom = from === null ? null : venueDateLabel(from);
  }
  const driveMinutes =
    input.driveMinutes !== null && Number.isFinite(input.driveMinutes) && input.driveMinutes > 0
      ? Math.round(input.driveMinutes)
      : null;
  const leaveBy = leaveByFor(startsAt, driveMinutes, now);
  if (weather === null && driveMinutes === null && forecastFrom === null) return null;
  return { weather, driveMinutes, leaveBy, forecastFrom };
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout: one line under the picks
// ─────────────────────────────────────────────────────────────────────────────

export interface CheckoutLineInput {
  /** The chosen day, venue-local "YYYY-MM-DD"; null while not chosen. */
  readonly day: string | null | undefined;
  /** The chosen time, venue-local "HH:MM"; null while not chosen. */
  readonly time: string | null | undefined;
  /** The hourly forecast; its hours are venue-local wall strings, as the chosen day and time are. */
  readonly hourly: readonly HourlyForecast[] | null | undefined;
  /** Typical-crowd curve key (`crowdCategoryFor`); null = no crowd part. */
  readonly category: string | null | undefined;
}

export interface CheckoutLine {
  /** "Sat 28 Nov". */
  readonly day: string;
  /** "19:00". */
  readonly time: string;
  readonly weather: HourlyForecast | null;
  readonly crowd: CrowdLevel | null;
}

const TIME_ONLY = /^(\d{2}):(\d{2})$/;

/**
 * The checkout line's parts, or null: shown only when BOTH the day and the
 * time are chosen, and only while it has the forecast or the usual crowd to
 * say (a bare "Sat 28 Nov, 19:00" adds nothing to the picks above it).
 */
export function checkoutLineFor(input: CheckoutLineInput): CheckoutLine | null {
  const { day, time } = input;
  if (typeof day !== 'string' || !DATE_ONLY.test(day)) return null;
  if (typeof time !== 'string') return null;
  const t = TIME_ONLY.exec(time);
  if (t === null) return null;
  const hour = Number(t[1]);
  const minute = Number(t[2]);
  if (hour > 23 || minute > 59) return null;
  const [y, m, d] = day.split('-').map(Number);
  // The chosen moment is already venue-local, so it is read as UTC-with-offset-0
  // (the forecast hours are venue-local wall strings too): no zone needed.
  const at = new Date(Date.UTC(y, m - 1, d, hour, minute));
  if (Number.isNaN(at.getTime()) || at.getUTCDate() !== d) return null;
  const weather = forecastAt(input.hourly, at, 0);
  const hasCategory = typeof input.category === 'string' && input.category.trim().length > 0;
  const crowd = hasCategory ? typicalCrowdAt(input.category, at, 0).level : null;
  if (weather === null && crowd === null) return null;
  return { day: venueDateLabel(day), time, weather, crowd };
}
