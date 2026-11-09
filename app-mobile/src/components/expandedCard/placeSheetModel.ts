/**
 * #4347 wave 2 — the expanded single place, as pure data.
 *
 * Every decision the redesigned sheet makes that does not need React lives
 * here: which photos the gallery pages, the four basics tiles (each omitted
 * when its fact is missing), the "When you'd go" time chips, the typical crowd
 * curve and its honest label, the hourly weather for a chosen time, sunset
 * computed on the phone, and the "quieter at" hint.
 *
 * Constitution 9 throughout: a fact we do not have is omitted, never faked. The
 * crowd is a TYPICAL curve for this kind of place and is only ever labelled
 * "Usually …"; nothing here says "live".
 */
import { isVideoUrl } from '../../utils/videoUrl';
import { extractWeekdayText, getOpenStatusAt, type OpenStatus } from '../../utils/openingHoursUtils';
import { VENUE_POPULARITY, getVenueCategory } from '../../constants/venuePopularityPatterns';
import { FACT_LINE } from '../../../../packages/card-identity/index.js';
import type { HourlyForecast } from '../../services/weatherService';

// ─────────────────────────────────────────────────────────────────────────────
// Gallery
// ─────────────────────────────────────────────────────────────────────────────

export interface SheetMedia {
  readonly uri: string;
  readonly isVideo: boolean;
}

/**
 * The gallery's slots: a video cover first (it plays in slot 1 only), then
 * every still, de-duplicated, in the card's own order. No cap: the sheet is
 * where you see every photo.
 */
export function sheetGalleryMedia(images: readonly unknown[] | null | undefined, image?: string | null): SheetMedia[] {
  const list = (Array.isArray(images) ? images : [])
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .map((u) => u.trim());
  if (typeof image === 'string' && image.trim().length > 0 && !list.includes(image.trim())) list.unshift(image.trim());
  const seen = new Set<string>();
  const out: SheetMedia[] = [];
  const video = list.find((u) => isVideoUrl(u));
  if (video) {
    out.push({ uri: video, isVideo: true });
    seen.add(video);
  }
  for (const uri of list) {
    if (seen.has(uri) || isVideoUrl(uri)) continue;
    seen.add(uri);
    out.push({ uri, isVideo: false });
  }
  return out;
}

/** The stills the lightbox can show (it is images-only), and where slot `index` lands in them. */
export function lightboxFor(media: readonly SheetMedia[], index: number): { images: string[]; initialIndex: number } {
  const images = media.filter((m) => !m.isVideo).map((m) => m.uri);
  const target = media[index];
  const at = target && !target.isVideo ? images.indexOf(target.uri) : 0;
  return { images, initialIndex: Math.max(0, at) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Basics tiles
// ─────────────────────────────────────────────────────────────────────────────

export type BasicsTileKey = 'hours' | 'price' | 'distance' | 'rating';
export type BasicsTone = 'open' | 'closing' | 'closed' | 'neutral';

export interface BasicsTile {
  readonly key: BasicsTileKey;
  readonly value: string;
  readonly tone: BasicsTone;
}

export interface BasicsLabels {
  readonly openUntil: (time: string) => string;
  readonly closesIn: (minutes: number) => string;
  readonly opensAt: (time: string) => string;
  readonly opensTomorrow: (time: string) => string;
  readonly opensOn: (dayOffset: number, time: string) => string;
  readonly open24h: string;
  readonly clock: (minuteOfDay: number) => string;
  /** "★ 4.6 · 212 reviews". */
  readonly rating: (rating: string, count: number | null) => string;
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function hoursTile(status: OpenStatus | null, labels: BasicsLabels): BasicsTile | null {
  if (status === null) return null;
  switch (status.kind) {
    case 'open24h':
      return { key: 'hours', value: labels.open24h, tone: 'open' };
    case 'open':
      return { key: 'hours', value: labels.openUntil(labels.clock(status.closesAtMinute)), tone: 'open' };
    case 'closing':
      return { key: 'hours', value: labels.closesIn(Math.max(1, status.minutesLeft)), tone: 'closing' };
    case 'closed': {
      if (status.opensAtMinute === null || status.opensDayOffset === null) return null;
      const time = labels.clock(status.opensAtMinute);
      const value =
        status.opensDayOffset === 0
          ? labels.opensAt(time)
          : status.opensDayOffset === 1
            ? labels.opensTomorrow(time)
            : labels.opensOn(status.opensDayOffset, time);
      return { key: 'hours', value, tone: 'closed' };
    }
    default: {
      const never: never = status;
      return never;
    }
  }
}

export interface BasicsInput {
  readonly openingHours?: unknown;
  readonly utcOffsetMinutes?: number | null;
  /** Already formatted by formatDisplayPrice / the canonical discovery label. */
  readonly priceText?: string | null;
  readonly travelTime?: string | null;
  readonly distanceText?: string | null;
  readonly rating?: number | null;
  readonly reviewCount?: number | null;
}

/** The four basics, in order, each omitted when its fact is missing. */
export function basicsTiles(input: BasicsInput, now: Date, labels: BasicsLabels): BasicsTile[] {
  const tiles: BasicsTile[] = [];
  const hours = hoursTile(
    getOpenStatusAt(
      extractWeekdayText(input.openingHours as Parameters<typeof extractWeekdayText>[0]),
      now,
      input.utcOffsetMinutes ?? null,
      FACT_LINE.closingSoonMinutes,
    ),
    labels,
  );
  if (hours) tiles.push(hours);
  const price = trimmed(input.priceText);
  if (price) tiles.push({ key: 'price', value: price, tone: 'neutral' });
  const distance = [trimmed(input.travelTime), trimmed(input.distanceText)].filter((v): v is string => v !== null);
  if (distance.length > 0) tiles.push({ key: 'distance', value: distance.join(' · '), tone: 'neutral' });
  const r = input.rating;
  if (typeof r === 'number' && Number.isFinite(r) && r > 0) {
    const count = typeof input.reviewCount === 'number' && input.reviewCount > 0 ? Math.round(input.reviewCount) : null;
    tiles.push({ key: 'rating', value: labels.rating(r.toFixed(1), count), tone: 'neutral' });
  }
  return tiles;
}

// ─────────────────────────────────────────────────────────────────────────────
// "When you'd go" — the chosen time
// ─────────────────────────────────────────────────────────────────────────────

export type WhenKey = 'now' | 'tonight' | 'tomorrow' | 'scheduled';

export interface WhenChip {
  readonly key: WhenKey;
  readonly at: Date;
}

/** Venue-local wall clock of a UTC instant (offset unknown = device clock). */
function venueParts(at: Date, utcOffsetMinutes: number | null): { y: number; m: number; d: number; hour: number; minute: number } {
  if (utcOffsetMinutes == null) {
    return { y: at.getFullYear(), m: at.getMonth(), d: at.getDate(), hour: at.getHours(), minute: at.getMinutes() };
  }
  const shifted = new Date(at.getTime() + utcOffsetMinutes * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** The UTC instant of a venue-local wall-clock time. */
function venueInstant(y: number, m: number, d: number, hour: number, utcOffsetMinutes: number | null): Date {
  if (utcOffsetMinutes == null) return new Date(y, m, d, hour, 0, 0, 0);
  return new Date(Date.UTC(y, m, d, hour, 0, 0, 0) - utcOffsetMinutes * 60_000);
}

export const TONIGHT_HOUR = 19;

/**
 * Now · Tonight 7pm (only while 7pm is still ahead) · Tomorrow 7pm · and the
 * card's scheduled time when it has one in the future.
 */
export function whenChips(now: Date, utcOffsetMinutes: number | null, scheduledAt?: Date | null): WhenChip[] {
  const p = venueParts(now, utcOffsetMinutes);
  const chips: WhenChip[] = [{ key: 'now', at: now }];
  if (p.hour < TONIGHT_HOUR) chips.push({ key: 'tonight', at: venueInstant(p.y, p.m, p.d, TONIGHT_HOUR, utcOffsetMinutes) });
  chips.push({ key: 'tomorrow', at: venueInstant(p.y, p.m, p.d + 1, TONIGHT_HOUR, utcOffsetMinutes) });
  if (scheduledAt instanceof Date && !Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() > now.getTime()) {
    chips.push({ key: 'scheduled', at: scheduledAt });
  }
  return chips;
}

// ─────────────────────────────────────────────────────────────────────────────
// Crowd — TYPICAL, never live
// ─────────────────────────────────────────────────────────────────────────────

export type CrowdLevel = 'quiet' | 'steady' | 'busy' | 'packed';

export interface TypicalCrowd {
  /** 24 values, 0-100, venue-local hour 0 = midnight. */
  readonly hourly: readonly number[];
  readonly hour: number;
  readonly level: CrowdLevel;
}

export function crowdLevel(popularity: number): CrowdLevel {
  if (popularity < 25) return 'quiet';
  if (popularity < 50) return 'steady';
  if (popularity < 75) return 'busy';
  return 'packed';
}

/** The built-in typical curve for this kind of place, at the chosen venue-local hour. */
export function typicalCrowdAt(category: string | null | undefined, at: Date, utcOffsetMinutes: number | null): TypicalCrowd {
  const p = venueParts(at, utcOffsetMinutes);
  const day = (utcOffsetMinutes == null ? at : new Date(at.getTime() + utcOffsetMinutes * 60_000));
  const dow = utcOffsetMinutes == null ? day.getDay() : day.getUTCDay();
  const curve = VENUE_POPULARITY[getVenueCategory(category ?? undefined)];
  const hourly = dow === 0 || dow === 6 ? curve.weekend : curve.weekday;
  return { hourly, hour: p.hour, level: crowdLevel(hourly[p.hour] ?? 0) };
}

/**
 * "Quieter at 9:30pm"-style hint: the first later hour today that is a full
 * level quieter than the chosen hour, while the place is open then. Null when
 * there is none — the hint only appears when it changes the decision.
 */
export function quieterHour(
  crowd: TypicalCrowd,
  isOpenAtHour: (hour: number) => boolean | null,
  lastHour = 23,
): number | null {
  const now = crowd.hourly[crowd.hour] ?? 0;
  if (crowdLevel(now) === 'quiet') return null;
  for (let h = crowd.hour + 1; h <= lastHour; h += 1) {
    const value = crowd.hourly[h] ?? 0;
    // #4347 rework (W-7) — only an hour we can SAY is open is offered; with no
    // readable hours the hint is hidden, never guessed.
    if (now - value >= 25 && isOpenAtHour(h) === true) return h;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weather at the chosen time (Open-Meteo hourly)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The hourly forecast entry for a chosen instant. Open-Meteo's hourly `time`
 * is venue-local wall clock ("2026-11-09T19:00"), so it is compared against the
 * venue-local hour key. Null when the forecast does not reach that hour.
 */
export function forecastAt(
  hourly: readonly HourlyForecast[] | null | undefined,
  at: Date,
  utcOffsetSeconds: number | null | undefined,
): HourlyForecast | null {
  if (!Array.isArray(hourly) || hourly.length === 0) return null;
  const p = venueParts(at, utcOffsetSeconds == null ? null : Math.round(utcOffsetSeconds / 60));
  const key = `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}`;
  return hourly.find((h) => typeof h.time === 'string' && h.time.startsWith(key)) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sunset, computed on the phone (NOAA solar-position approximation)
// ─────────────────────────────────────────────────────────────────────────────

const RAD = Math.PI / 180;

/**
 * Sunset (UTC instant) for a coordinate on the calendar date of `at` (UTC
 * date). Accurate to about a minute at inhabited latitudes; null in polar day
 * or polar night, and for invalid input. No dependency.
 */
export function sunsetAt(lat: number, lng: number, at: Date): Date | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90) return null;
  const y = at.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(y, at.getUTCMonth(), at.getUTCDate()) - start) / 86_400_000) + 1;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const cosH =
    Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
  if (cosH < -1 || cosH > 1) return null;
  const ha = Math.acos(cosH) / RAD;
  const minutesUtc = 720 - 4 * (lng - ha) - eqTime;
  return new Date(Date.UTC(y, at.getUTCMonth(), at.getUTCDate()) + Math.round(minutesUtc * 60_000));
}
