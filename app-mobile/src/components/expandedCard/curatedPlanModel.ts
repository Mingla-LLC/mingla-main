/**
 * #4347 wave 3 — the expanded curated plan, as pure data.
 *
 * Every decision the plan sheet makes that does not need React lives here: the
 * gallery tagged by stop, the start time and its options, each stop's clock
 * arrival (from `curatedArrivalTimes`, the ONE arrival model the schedule check
 * also uses), the open status AT ARRIVAL (`getOpenStatusAt`), the forecast at
 * the arrival hour, the typical crowd then, sunset near an outdoor stop, the
 * ONE warning card and its fixes, and the "Getting there" legs.
 *
 * Constitution 9 throughout: a fact we do not have is omitted, never faked.
 * Crowd is a TYPICAL curve ("Usually …"), travel is an ESTIMATE (haversine x
 * detour / speed, labelled), and the weather is the hourly FORECAST.
 */
import { curatedArrivalTimes } from '../../utils/curatedStopsAvailability';
import { extractWeekdayText, getOpenStatusAt, type OpenStatus } from '../../utils/openingHoursUtils';
import { isVideoUrl } from '../../utils/videoUrl';
import { estimateTravelMinutes, haversineKm } from '../../utils/mutateCuratedCard';
import type { HourlyForecast } from '../../services/weatherService';
import { crowdLevel, forecastAt, sunsetAt, type CrowdLevel, type SheetMedia } from './placeSheetModel';
import { VENUE_POPULARITY, getVenueCategory } from '../../constants/venuePopularityPatterns';
import type { CuratedStop } from '../../types/curatedExperience';

/** The fields of a stop this model reads. `CuratedStop` satisfies it. */
export type PlanStop = Pick<
  CuratedStop,
  | 'placeId'
  | 'placeName'
  | 'placeType'
  | 'address'
  | 'imageUrl'
  | 'lat'
  | 'lng'
  | 'openingHours'
  | 'estimatedDurationMinutes'
  | 'travelTimeFromPreviousStopMin'
  | 'travelModeFromPreviousStop'
> &
  Partial<Pick<CuratedStop, 'imageUrls' | 'utcOffsetMinutes' | 'optional' | 'comboCategory'>>;

// ─────────────────────────────────────────────────────────────────────────────
// Clock helpers (venue-local)
// ─────────────────────────────────────────────────────────────────────────────

/** Venue-local minute of the day for an instant (offset unknown = device clock). */
export function minuteOfDay(at: Date, utcOffsetMinutes: number | null | undefined): number {
  if (utcOffsetMinutes == null) return at.getHours() * 60 + at.getMinutes();
  const shifted = new Date(at.getTime() + utcOffsetMinutes * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** Venue-local calendar day number (days since epoch), to tell "today" from "tomorrow". */
export function venueDay(at: Date, utcOffsetMinutes: number | null | undefined): number {
  if (utcOffsetMinutes == null) {
    return Math.floor((at.getTime() - at.getTimezoneOffset() * 60_000) / 86_400_000);
  }
  return Math.floor((at.getTime() + utcOffsetMinutes * 60_000) / 86_400_000);
}

/** The plan's clock offset: the first stop that states one. Null = the device clock. */
export function planUtcOffset(stops: readonly PlanStop[]): number | null {
  for (const stop of stops) {
    if (typeof stop.utcOffsetMinutes === 'number' && Number.isFinite(stop.utcOffsetMinutes)) {
      return stop.utcOffsetMinutes;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stop numbering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The number each stop shows. Optional stops are not counted (the stop count,
 * the title and the price are all over the non-optional stops), so they carry
 * `null` and are tagged "Optional" instead. An all-optional plan numbers every
 * stop, 1..N (#1605: no main/optional distinction is left to draw).
 */
export function stopOrdinals(stops: readonly Pick<PlanStop, 'optional'>[]): (number | null)[] {
  const hasMain = stops.some((s) => s.optional !== true);
  let n = 0;
  return stops.map((s) => {
    if (hasMain && s.optional === true) return null;
    n += 1;
    return n;
  });
}

/** Number of stops the plan counts (optional ones excluded unless all are optional). */
export function countedStops(stops: readonly Pick<PlanStop, 'optional'>[]): number {
  return stopOrdinals(stops).filter((n) => n !== null).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gallery, tagged by stop
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanMedia extends SheetMedia {
  /** Index of the stop this photo belongs to (0-based). */
  readonly stopIndex: number;
}

function clean(u: unknown): string | null {
  return typeof u === 'string' && u.trim().length > 0 ? u.trim() : null;
}

/** One stop's stills: cover first, then the rest, de-duplicated, no video. */
export function stopPhotos(stop: Pick<PlanStop, 'imageUrl' | 'imageUrls'>): string[] {
  const all = [clean(stop.imageUrl), ...(Array.isArray(stop.imageUrls) ? stop.imageUrls.map(clean) : [])];
  const out: string[] = [];
  for (const uri of all) {
    if (uri === null || isVideoUrl(uri) || out.includes(uri)) continue;
    out.push(uri);
  }
  return out;
}

/** Every stop's photos, in stop order, each knowing its stop. */
export function planGalleryMedia(stops: readonly PlanStop[]): PlanMedia[] {
  const seen = new Set<string>();
  const out: PlanMedia[] = [];
  stops.forEach((stop, stopIndex) => {
    for (const uri of stopPhotos(stop)) {
      if (seen.has(uri)) continue;
      seen.add(uri);
      out.push({ uri, isVideo: false, stopIndex });
    }
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The start time
// ─────────────────────────────────────────────────────────────────────────────

const SLOT_MINUTES = 30;
const LEAD_MINUTES = 15;

/** The next half-hour at least 15 minutes from now. */
export function nextSensibleSlot(now: Date): Date {
  const t = now.getTime() + LEAD_MINUTES * 60_000;
  const slot = SLOT_MINUTES * 60_000;
  return new Date(Math.ceil(t / slot) * slot);
}

/** The schedule time when the plan is scheduled, otherwise the next sensible slot. */
export function defaultPlanStart(now: Date, scheduledAt?: Date | null): Date {
  if (scheduledAt instanceof Date && !Number.isNaN(scheduledAt.getTime())) return scheduledAt;
  return nextSensibleSlot(now);
}

/**
 * The start times offered by "Starts · tap to change": the next sensible slot
 * and every hour after it for 12 hours, plus the scheduled / current start when
 * it is not one of them. Sorted.
 */
export function startTimeOptions(now: Date, current: Date, count = 13): Date[] {
  const first = nextSensibleSlot(now);
  const out: Date[] = [];
  for (let i = 0; i < count; i += 1) out.push(new Date(first.getTime() + i * 60 * 60_000));
  if (!out.some((d) => d.getTime() === current.getTime())) out.push(current);
  return out.sort((a, b) => a.getTime() - b.getTime());
}

// ─────────────────────────────────────────────────────────────────────────────
// The timeline: arrival, open status, conditions
// ─────────────────────────────────────────────────────────────────────────────

export type TravelMode = 'driving' | 'walking' | 'transit' | 'bicycling';

export function normaliseMode(mode: unknown): TravelMode {
  if (mode === 'walking' || mode === 'transit' || mode === 'driving') return mode;
  if (mode === 'bicycling' || mode === 'biking' || mode === 'cycling') return 'bicycling';
  return 'driving';
}

export interface PlanTimelineStop {
  readonly index: number;
  readonly ordinal: number | null;
  readonly arrival: Date;
  readonly departure: Date;
  readonly dwellMinutes: number;
  /** Travel INTO this stop (estimated); null for stop 1 or when the plan has no figure. */
  readonly leg: { readonly minutes: number; readonly mode: TravelMode } | null;
  readonly open: OpenStatus | null;
}

/** What the open chip says at arrival. Hours unknown = no chip. */
export type ArrivalOpen =
  | { readonly kind: 'closed' }
  | { readonly kind: 'closes'; readonly closesAtMinute: number; readonly minutesLeft: number }
  | { readonly kind: 'open'; readonly closesAtMinute: number }
  | { readonly kind: 'open24h' };

/** Below this, a stop that is technically open when you arrive is not worth arriving at. */
export const MIN_USEFUL_MINUTES = 15;
const CLOSING_SOON_MINUTES = 60;

export function arrivalOpen(status: OpenStatus | null): ArrivalOpen | null {
  if (status === null) return null;
  switch (status.kind) {
    case 'open24h':
      return { kind: 'open24h' };
    case 'open':
      return { kind: 'open', closesAtMinute: status.closesAtMinute };
    case 'closing':
      return status.minutesLeft < MIN_USEFUL_MINUTES
        ? { kind: 'closed' }
        : { kind: 'closes', closesAtMinute: status.closesAtMinute, minutesLeft: status.minutesLeft };
    case 'closed':
      return { kind: 'closed' };
    default: {
      const never: never = status;
      return never;
    }
  }
}

export function planTimeline(
  stops: readonly PlanStop[],
  start: Date,
  fallbackMode?: string | null,
): PlanTimelineStop[] {
  const timings = curatedArrivalTimes(stops, start);
  const ordinals = stopOrdinals(stops);
  return stops.map((stop, i) => {
    const t = timings[i];
    const weekday = extractWeekdayText(stop.openingHours as Parameters<typeof extractWeekdayText>[0]);
    return {
      index: i,
      ordinal: ordinals[i],
      arrival: t.arrival,
      departure: t.departure,
      dwellMinutes: t.dwellMinutes,
      leg:
        t.legMinutes !== null && t.legMinutes > 0
          ? { minutes: Math.round(t.legMinutes), mode: normaliseMode(stop.travelModeFromPreviousStop ?? fallbackMode) }
          : null,
      open:
        weekday === null
          ? null
          : getOpenStatusAt(weekday, t.arrival, stop.utcOffsetMinutes ?? null, CLOSING_SOON_MINUTES),
    };
  });
}

/** The plan's end: the last stop's departure. */
export function planEnd(timeline: readonly PlanTimelineStop[]): Date | null {
  return timeline.length > 0 ? timeline[timeline.length - 1].departure : null;
}

// ── Outdoor: an EXPLICIT map, never a guess ─────────────────────────────────

/**
 * A stop counts as OUTDOOR only when its category says so beyond doubt. Read
 * from the slot's Mingla `comboCategory` (the generator also writes it into
 * `placeType`) and, for older and host plans, Google's own place type. A
 * rooftop bar is NOT here: no category we hold says "rooftop", and guessing
 * from the name is exactly what Constitution 9 forbids — so a rooftop bar gets
 * no rain warning until the pool carries an outdoor-seating fact.
 */
export const OUTDOOR_CATEGORIES: ReadonlySet<string> = new Set([
  // Mingla slots
  'nature',
  'picnic_park',
  'park',
  'take_a_stroll',
  // Google place types
  'national_park',
  'state_park',
  'city_park',
  'hiking_area',
  'campground',
  'garden',
  'botanical_garden',
  'beach',
  'picnic_ground',
  'dog_park',
  'playground',
  'marina',
  'zoo',
  'amusement_park',
  'water_park',
  'golf_course',
  'ski_resort',
]);

function slug(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
}

export function isOutdoorStop(stop: Pick<PlanStop, 'placeType'> & Partial<Pick<PlanStop, 'comboCategory'>>): boolean {
  return OUTDOOR_CATEGORIES.has(slug(stop.comboCategory)) || OUTDOOR_CATEGORIES.has(slug(stop.placeType));
}

// ── Weather at arrival ──────────────────────────────────────────────────────

export interface StopForecast {
  readonly hourly: readonly HourlyForecast[];
  readonly utcOffsetSeconds: number | null;
}

/** Rain is "likely" at 50%+, or (with no probability) at a measurable 0.02in. */
export function rainLikely(f: HourlyForecast | null): boolean {
  if (f === null) return false;
  if (typeof f.precipitationProbability === 'number') return f.precipitationProbability >= 50;
  return typeof f.precipitation === 'number' && f.precipitation >= 0.02;
}

/** Open-Meteo icon code → a weather glyph for the chip. */
export function weatherGlyph(icon: string | null | undefined): string {
  const code = typeof icon === 'string' ? icon.slice(0, 2) : '';
  const night = typeof icon === 'string' && icon.endsWith('n');
  switch (code) {
    case '01':
      return night ? '🌙' : '☀';
    case '02':
      return '⛅';
    case '04':
      return '☁';
    case '50':
      return '🌫';
    case '09':
    case '10':
      return '🌧';
    case '13':
      return '🌨';
    case '11':
      return '⛈';
    default:
      return '';
  }
}

export function stopForecastAt(forecast: StopForecast | null | undefined, at: Date): HourlyForecast | null {
  if (!forecast) return null;
  return forecastAt(forecast.hourly, at, forecast.utcOffsetSeconds);
}

// ── Crowd at arrival (typical, never live) ──────────────────────────────────

export function stopCrowdAt(
  stop: Pick<PlanStop, 'placeType'> & Partial<Pick<PlanStop, 'comboCategory' | 'utcOffsetMinutes'>>,
  at: Date,
): CrowdLevel {
  const offset = stop.utcOffsetMinutes ?? null;
  const local = offset == null ? at : new Date(at.getTime() + offset * 60_000);
  const dow = offset == null ? local.getDay() : local.getUTCDay();
  const hour = Math.floor(minuteOfDay(at, offset) / 60);
  const curve = VENUE_POPULARITY[getVenueCategory(stop.comboCategory ?? undefined, stop.placeType ?? undefined)];
  const hourly = dow === 0 || dow === 6 ? curve.weekend : curve.weekday;
  return crowdLevel(hourly[hour] ?? 0);
}

// ── Sunset near an outdoor stop ─────────────────────────────────────────────

export const SUNSET_WINDOW_MINUTES = 120;

/** Sunset, when the stop is outdoor and you are there within ~2h of it. */
export function stopSunset(
  stop: Pick<PlanStop, 'placeType' | 'lat' | 'lng'> & Partial<Pick<PlanStop, 'comboCategory' | 'utcOffsetMinutes'>>,
  arrival: Date,
): Date | null {
  if (!isOutdoorStop(stop)) return null;
  if (typeof stop.lat !== 'number' || typeof stop.lng !== 'number') return null;
  const offset = stop.utcOffsetMinutes ?? 0;
  const sunset = sunsetAt(stop.lat, stop.lng, new Date(arrival.getTime() + offset * 60_000));
  if (sunset === null) return null;
  return Math.abs(sunset.getTime() - arrival.getTime()) <= SUNSET_WINDOW_MINUTES * 60_000 ? sunset : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The ONE warning card, and its fixes
// ─────────────────────────────────────────────────────────────────────────────

export type PlanWarning =
  | {
      readonly kind: 'closed';
      readonly index: number;
      readonly arrival: Date;
      /** Present when the stop is open at arrival but closes within MIN_USEFUL_MINUTES. */
      readonly closesAtMinute: number | null;
      readonly minutesLeft: number | null;
      readonly fixStart: Date | null;
      readonly canSwap: boolean;
    }
  | {
      readonly kind: 'rain';
      readonly index: number;
      readonly arrival: Date;
      readonly fixStart: Date | null;
      readonly canSwap: boolean;
    };

export interface WarningInput {
  readonly stops: readonly PlanStop[];
  readonly start: Date;
  readonly now: Date;
  /** Per stop (same index); null = no forecast for that stop. */
  readonly forecasts: readonly (StopForecast | null)[];
  readonly fallbackMode?: string | null;
  /** False for a host experience (the host sets the stops). */
  readonly canSwap?: boolean;
}

const FIX_STEP_MINUTES = 30;
const FIX_SEARCH_STEPS = 8; // up to 4 hours either way

/**
 * The nearest start (in 30-minute steps, never in the past) that clears the
 * warning at THIS stop. Later first for rain and for a stop that has not opened
 * yet; earlier first for a stop that closes before you get there.
 */
function fixStartFor(
  input: WarningInput,
  clears: (start: Date) => boolean,
  preferEarlier: boolean,
): Date | null {
  const minStart = nextSensibleSlot(input.now).getTime();
  const tryAt = (deltaSteps: number): Date | null => {
    const t = input.start.getTime() + deltaSteps * FIX_STEP_MINUTES * 60_000;
    if (t < minStart) return null;
    const d = new Date(t);
    return clears(d) ? d : null;
  };
  for (let k = 1; k <= FIX_SEARCH_STEPS; k += 1) {
    const first = tryAt(preferEarlier ? -k : k);
    if (first) return first;
    const second = tryAt(preferEarlier ? k : -k);
    if (second) return second;
  }
  return null;
}

/**
 * AT MOST ONE warning per plan, and only when action is needed. Priority: a
 * stop closed when you arrive, then rain on an outdoor stop. Every warning
 * carries at least one fix (swap the stop, or start at another time); a
 * warning with neither is not shown.
 */
export function planWarning(input: WarningInput): PlanWarning | null {
  const { stops, start, forecasts, fallbackMode } = input;
  const canSwapAt = (i: number): boolean => input.canSwap !== false && stops[i]?.optional !== true;
  const tl = planTimeline(stops, start, fallbackMode);

  const ci = tl.findIndex((s) => arrivalOpen(s.open)?.kind === 'closed');
  if (ci >= 0) {
    const status = tl[ci].open;
    const notYetOpen = status?.kind === 'closed' && status.opensDayOffset === 0;
    const fixStart = fixStartFor(
      input,
      (d) => arrivalOpen(planTimeline(stops, d, fallbackMode)[ci].open)?.kind !== 'closed',
      !notYetOpen,
    );
    const closing = status?.kind === 'closing' ? status : null;
    const warning: PlanWarning = {
      kind: 'closed',
      index: ci,
      arrival: tl[ci].arrival,
      closesAtMinute: closing ? closing.closesAtMinute : null,
      minutesLeft: closing ? closing.minutesLeft : null,
      fixStart,
      canSwap: canSwapAt(ci),
    };
    return warning.canSwap || warning.fixStart !== null ? warning : null;
  }

  const ri = tl.findIndex((s, i) => isOutdoorStop(stops[i]) && rainLikely(stopForecastAt(forecasts[i] ?? null, s.arrival)));
  if (ri >= 0) {
    const fixStart = fixStartFor(
      input,
      (d) => {
        // Only a start the forecast actually reaches can clear the rain.
        const at = planTimeline(stops, d, fallbackMode)[ri].arrival;
        const f = stopForecastAt(forecasts[ri] ?? null, at);
        return f !== null && !rainLikely(f);
      },
      false,
    );
    const warning: PlanWarning = { kind: 'rain', index: ri, arrival: tl[ri].arrival, fixStart, canSwap: canSwapAt(ri) };
    return warning.canSwap || warning.fixStart !== null ? warning : null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Getting there
// ─────────────────────────────────────────────────────────────────────────────

/** "You → stop 1": the estimate from the viewer, or null without a location. */
export function legFromViewer(
  viewer: { lat?: number | null; lng?: number | null } | null | undefined,
  first: Pick<PlanStop, 'lat' | 'lng'> | null | undefined,
  mode: TravelMode,
): number | null {
  if (!viewer || typeof viewer.lat !== 'number' || typeof viewer.lng !== 'number') return null;
  if (!first || typeof first.lat !== 'number' || typeof first.lng !== 'number') return null;
  if (!Number.isFinite(first.lat) || !Number.isFinite(first.lng) || (first.lat === 0 && first.lng === 0)) return null;
  return estimateTravelMinutes(haversineKm(viewer.lat, viewer.lng, first.lat, first.lng), mode);
}

/** Total minutes of travel: every leg between stops, plus "You → stop 1" when known. */
export function totalTravelMinutes(timeline: readonly PlanTimelineStop[], fromViewer: number | null): number {
  const legs = timeline.reduce((sum, s) => sum + (s.leg?.minutes ?? 0), 0);
  return legs + (fromViewer ?? 0);
}

/** The plan's travel mode: the first leg's, else the fallback, else driving. */
export function planMode(timeline: readonly PlanTimelineStop[], fallback?: string | null): TravelMode {
  return timeline.find((s) => s.leg !== null)?.leg?.mode ?? normaliseMode(fallback);
}

/**
 * The stop "Next stop" opens on a platform that cannot route every stop: the
 * first stop you have not left yet, else stop 1.
 */
export function nextStopIndex(timeline: readonly PlanTimelineStop[], now: Date): number {
  const i = timeline.findIndex((s) => s.departure.getTime() > now.getTime());
  return i >= 0 ? i : 0;
}
