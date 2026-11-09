/**
 * #4347 wave 1 — the redesigned deck card, as pure data.
 *
 * Everything the collapsed card decides (which photos it pages through, which
 * side of the photo a tap landed on, which facts it prints and in what order,
 * which one smart chip it shows) is decided HERE, in plain functions with no
 * React Native import, so a render test and a node test read the same answers.
 * Geometry comes from `@mingla/card-identity`; nothing below types a number the
 * package owns.
 *
 * Constitution 9 throughout: a fact we do not have is left out. No placeholder
 * photo is invented, no "0 reviews", no "Closed" when the hours are unknown.
 */
import { FACT_LINE, PHOTO_PAGER } from '../../../../packages/card-identity/index.js';
import { isVideoUrl } from '../../utils/videoUrl';
import { curatedArrivalTimes } from '../../utils/curatedStopsAvailability';
import { extractWeekdayText, getOpenStatusAt, type OpenStatus } from '../../utils/openingHoursUtils';
import type { MetaSpanInput } from '../deckCardPlate';

// ─────────────────────────────────────────────────────────────────────────────
// Photos
// ─────────────────────────────────────────────────────────────────────────────

export interface DeckPhoto {
  /** The URL to render. A video URL renders as the muted looping cover. */
  readonly uri: string;
  readonly isVideo: boolean;
  /** Curated / experience stop this photo belongs to (1-based), when it is a stop's. */
  readonly stopNumber?: number;
  readonly stopName?: string;
}

function cleanUrl(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function pushUnique(list: DeckPhoto[], seen: Set<string>, photo: DeckPhoto): void {
  if (list.length >= PHOTO_PAGER.maxPhotos || seen.has(photo.uri)) return;
  seen.add(photo.uri);
  list.push(photo);
}

/**
 * A single place: its own media, in order, at most six. A video in the list is
 * the cover and is photo 1 (the edge function's `image` is the first still, so
 * a video-cover venue shows the video first, then its stills).
 */
export function placeDeckPhotos(card: { image?: string | null; images?: readonly unknown[] | null }): DeckPhoto[] {
  const out: DeckPhoto[] = [];
  const seen = new Set<string>();
  const media = Array.isArray(card.images) ? card.images.map(cleanUrl).filter((u): u is string => u !== null) : [];
  const video = media.find((u) => isVideoUrl(u)) ?? null;
  if (video !== null) pushUnique(out, seen, { uri: video, isVideo: true });
  const hero = cleanUrl(card.image);
  if (hero !== null && !isVideoUrl(hero)) pushUnique(out, seen, { uri: hero, isVideo: false });
  for (const uri of media) {
    if (!isVideoUrl(uri)) pushUnique(out, seen, { uri, isVideo: false });
  }
  return out;
}

export interface DeckStopLike {
  readonly placeName?: string | null;
  readonly imageUrl?: string | null;
  readonly imageUrls?: readonly unknown[] | null;
  readonly optional?: boolean;
}

/**
 * A curated plan: ONE photo per stop, in stop order, so the bars page through
 * the stops and the label can say which stop is showing. A stop with no photo
 * is skipped (its number is kept, so the label never renumbers the plan).
 */
export function curatedDeckPhotos(stops: readonly DeckStopLike[] | null | undefined): DeckPhoto[] {
  const out: DeckPhoto[] = [];
  const seen = new Set<string>();
  (Array.isArray(stops) ? stops : []).forEach((stop, index) => {
    const uri =
      cleanUrl(stop.imageUrl) ??
      (Array.isArray(stop.imageUrls) ? stop.imageUrls.map(cleanUrl).find((u: string | null) => u !== null) ?? null : null);
    if (uri === null) return;
    const name = typeof stop.placeName === 'string' && stop.placeName.trim().length > 0 ? stop.placeName.trim() : undefined;
    pushUnique(out, seen, { uri, isVideo: isVideoUrl(uri), stopNumber: index + 1, stopName: name });
  });
  return out;
}

/** A host experience: its own cover first (image or video), then its stops. */
export function experienceDeckPhotos(
  coverUrl: string | null | undefined,
  stops: readonly DeckStopLike[] | null | undefined,
): DeckPhoto[] {
  const out: DeckPhoto[] = [];
  const seen = new Set<string>();
  const cover = cleanUrl(coverUrl);
  if (cover !== null) pushUnique(out, seen, { uri: cover, isVideo: isVideoUrl(cover) });
  for (const photo of curatedDeckPhotos(stops)) pushUnique(out, seen, photo);
  return out;
}

export type DeckTapZone = 'prev' | 'open' | 'next';

/**
 * Where a tap on the top card landed.
 *
 * `x`/`y` are card-local points. The left and right `PHOTO_PAGER.zoneSide` of
 * the card flip photos; the middle opens. Anything at or below `zoneBottomY`
 * (the kicker's top edge — the title, the facts and the plate) always opens,
 * and a card with fewer than two photos has no zones at all: tap anywhere opens.
 */
export function classifyDeckTap(input: {
  x: number;
  y: number;
  width: number;
  zoneBottomY: number;
  photoCount: number;
}): DeckTapZone {
  const { x, y, width, zoneBottomY, photoCount } = input;
  if (photoCount < 2) return 'open';
  if (!(width > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return 'open';
  if (y >= zoneBottomY) return 'open';
  if (x < width * PHOTO_PAGER.zoneSide) return 'prev';
  if (x > width * (1 - PHOTO_PAGER.zoneSide)) return 'next';
  return 'open';
}

/** The next index after a flip. Clamped at both ends, as the approved prototype is. */
export function stepPhotoIndex(index: number, count: number, direction: 'prev' | 'next'): number {
  if (count <= 0) return 0;
  const current = Math.max(0, Math.min(count - 1, Math.round(index)));
  return direction === 'next' ? Math.min(count - 1, current + 1) : Math.max(0, current - 1);
}

/**
 * The photos to warm while `index` is showing on the TOP card: the next
 * `PHOTO_PAGER.preloadAhead` stills. Videos are never prefetched as images.
 * Behind cards get nothing from here — they render photo 1 only.
 */
export function photosToPreload(photos: readonly DeckPhoto[], index: number): string[] {
  return photos
    .slice(index + 1, index + 1 + PHOTO_PAGER.preloadAhead)
    .filter((photo) => !photo.isVideo)
    .map((photo) => photo.uri);
}

/**
 * The index to show after `failedUri` failed to load: the next photo that has
 * not failed, else the previous one, else null (last resort: neutral fill).
 */
export function nextLoadablePhotoIndex(
  photos: readonly DeckPhoto[],
  index: number,
  failed: ReadonlySet<string>,
): number | null {
  for (let i = index + 1; i < photos.length; i += 1) if (!failed.has(photos[i].uri)) return i;
  for (let i = index - 1; i >= 0; i -= 1) if (!failed.has(photos[i].uri)) return i;
  return null;
}

/**
 * What the top card shows for page `index`: the poster still, whether there is
 * any photo at all, and whether the video cover plays. A failed photo is never
 * the poster; when every photo has failed the card is "no photo" (neutral
 * fill, dark type), never a stock picture.
 */
export function pagerPresentation(
  photos: readonly DeckPhoto[],
  index: number,
  failed: ReadonlySet<string>,
): { photoIndex: number; hasPhoto: boolean; posterUri: string; playVideoUri: string | null } {
  const photoIndex = Math.min(Math.max(0, Math.round(index)), Math.max(0, photos.length - 1));
  const usable = photos.filter((photo) => !failed.has(photo.uri));
  if (usable.length === 0) return { photoIndex, hasPhoto: false, posterUri: '', playVideoUri: null };
  const page = photos[photoIndex];
  const showing = page && !failed.has(page.uri) ? page : usable[0];
  const firstStill = usable.find((photo) => !photo.isVideo)?.uri ?? '';
  return {
    photoIndex,
    hasPhoto: true,
    posterUri: showing.isVideo ? firstStill : showing.uri,
    playVideoUri: showing.isVideo ? showing.uri : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The fact line
// ─────────────────────────────────────────────────────────────────────────────

export interface DeckFactLabels {
  /** "Open until {{time}}". */
  readonly openUntil: (time: string) => string;
  /** "Closes in {{minutes}} min". */
  readonly closesIn: (minutes: number) => string;
  /** "Opens {{time}}" (later today). */
  readonly opensAt: (time: string) => string;
  /** "Opens tomorrow {{time}}". */
  readonly opensTomorrow: (time: string) => string;
  /** "Opens {{day}} {{time}}" for two or more days out. */
  readonly opensOn: (dayOffset: number, time: string) => string;
  /** "Open 24 hours". */
  readonly open24h: string;
  /** Venue-local minute of day -> "11pm". */
  readonly clock: (minuteOfDay: number) => string;
}

/** The status span for an open status, or null when there is nothing honest to say. */
export function statusSpan(status: OpenStatus | null, labels: DeckFactLabels): MetaSpanInput | null {
  if (status === null) return null;
  switch (status.kind) {
    case 'open24h':
      return { kind: 'statusOpen', text: labels.open24h };
    case 'open':
      return { kind: 'statusOpen', text: labels.openUntil(labels.clock(status.closesAtMinute)) };
    case 'closing':
      return { kind: 'statusClosing', text: labels.closesIn(Math.max(1, status.minutesLeft)) };
    case 'closed': {
      if (status.opensAtMinute === null || status.opensDayOffset === null) return null;
      const time = labels.clock(status.opensAtMinute);
      const text =
        status.opensDayOffset === 0
          ? labels.opensAt(time)
          : status.opensDayOffset === 1
            ? labels.opensTomorrow(time)
            : labels.opensOn(status.opensDayOffset, time);
      return { kind: 'statusClosed', text };
    }
    default: {
      const never: never = status;
      return never;
    }
  }
}

/** "★ 4.6 (212)" / "★ 4.6" / null. The count is shown only when it is real. */
export function ratingText(rating: unknown, reviewCount: unknown): string | null {
  if (typeof rating !== 'number' || !Number.isFinite(rating) || rating <= 0) return null;
  const base = `★ ${rating.toFixed(1)}`;
  if (typeof reviewCount !== 'number' || !Number.isFinite(reviewCount) || reviewCount <= 0) return base;
  return `${base} (${compactCount(reviewCount)})`;
}

export function compactCount(count: number): string {
  const n = Math.round(count);
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(Math.floor(n / 100) / 10).toString()}K`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  return `${(Math.floor(n / 100_000) / 10).toString()}M`;
}

export interface PlaceFactInput {
  readonly openingHours?: unknown;
  readonly utcOffsetMinutes?: number | null;
  readonly rating?: number | null;
  readonly reviewCount?: number | null;
  readonly travelTime?: string | null;
  /** Shown only when there is no travel time (the GPS-less fallback). */
  readonly distanceLabel?: string | null;
  readonly priceRange?: string | null;
}

/**
 * The single place's fact line, in the approved order: open status, rating
 * with review count, travel time, price. Each span is omitted when absent.
 */
export function placeFactSpans(card: PlaceFactInput, now: Date, labels: DeckFactLabels): MetaSpanInput[] {
  const spans: MetaSpanInput[] = [];
  const status = statusSpan(
    getOpenStatusAt(
      extractWeekdayText(card.openingHours as Parameters<typeof extractWeekdayText>[0]),
      now,
      card.utcOffsetMinutes ?? null,
      FACT_LINE.closingSoonMinutes,
    ),
    labels,
  );
  if (status !== null) spans.push(status);
  const rating = ratingText(card.rating, card.reviewCount);
  if (rating !== null) spans.push({ kind: 'rating', text: rating });
  const travel = trimmed(card.travelTime) ?? trimmed(card.distanceLabel);
  if (travel !== null) spans.push({ kind: 'fact', text: travel });
  const price = trimmed(card.priceRange);
  if (price !== null) spans.push({ kind: 'fact', text: price });
  return spans;
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** "RESTAURANT" kicker parts, joined by " · ". Absent parts are left out. */
export function joinKicker(parts: readonly (string | null | undefined)[]): string | null {
  const present = parts.map(trimmed).filter((p): p is string => p !== null);
  return present.length > 0 ? present.join(' · ') : null;
}

/** "Café Neo → Nike Art Gallery → Terra Kulture". The renderer ellipsizes it. */
export function routeLine(stops: readonly DeckStopLike[] | null | undefined): string | null {
  const names = (Array.isArray(stops) ? stops : [])
    .map((stop) => trimmed(stop.placeName))
    .filter((name): name is string => name !== null);
  return names.length >= 2 ? names.join(' → ') : null;
}

/** The stop thumbnails for the stack: the first STOP_STACK.max stops that have a photo. */
export function stopStackPhotos(stops: readonly DeckStopLike[] | null | undefined, max: number): string[] {
  return curatedDeckPhotos(stops)
    .filter((photo) => !photo.isVideo)
    .slice(0, max)
    .map((photo) => photo.uri);
}

// ─────────────────────────────────────────────────────────────────────────────
// The smart chip — at most ONE per card, only when it changes the decision
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wave 1 produces only the two signals the client already has. The other kinds
 * are declared so the slot, its priority and its renderer exist when rain,
 * traffic and sunset arrive (later waves), without reshaping anything.
 * Priority, highest first: closed at arrival, rain on an outdoor stop, heavy
 * traffic, sunset spot, quieter later.
 */
export type SmartChipKind =
  | 'closedAtArrival'
  | 'stopClosedAtArrival'
  | 'rainOutdoor'
  | 'heavyTraffic'
  | 'sunsetSpot'
  | 'quieterLater';

export interface SmartChip {
  readonly kind: SmartChipKind;
  /** 1-based stop number for the stop-scoped kinds. */
  readonly stopNumber?: number;
  readonly tone: 'warn' | 'info';
}

export const SMART_CHIP_PRIORITY: readonly SmartChipKind[] = [
  'closedAtArrival',
  'stopClosedAtArrival',
  'rainOutdoor',
  'heavyTraffic',
  'sunsetSpot',
  'quieterLater',
];

export function pickSmartChip(candidates: readonly (SmartChip | null)[]): SmartChip | null {
  let best: SmartChip | null = null;
  for (const chip of candidates) {
    if (chip === null) continue;
    if (best === null || SMART_CHIP_PRIORITY.indexOf(chip.kind) < SMART_CHIP_PRIORITY.indexOf(best.kind)) best = chip;
  }
  return best;
}

/** Open now by the status line's own reading (open, closing soon, or 24 hours). */
function isOpenStatus(status: OpenStatus | null): boolean {
  return status !== null && status.kind !== 'closed';
}

/** Minutes out of "12 min" / "1 hr 5 min" / "1h 5m"; null when unreadable. */
export function parseTravelMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const hours = /(\d+)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(value);
  const mins = /(\d+)\s*(?:m|min|mins|minute|minutes)\b/i.exec(value);
  if (!hours && !mins) return null;
  return (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
}

/**
 * A single place that is open now but will have closed by the time you get
 * there (now + travel time). Only fires when the hours AND the travel time are
 * known — a guess here would steer someone away from an open place.
 */
export function placeSmartChip(card: PlaceFactInput, now: Date): SmartChip | null {
  const weekday = extractWeekdayText(card.openingHours as Parameters<typeof extractWeekdayText>[0]);
  const travel = parseTravelMinutes(card.travelTime);
  if (weekday === null || travel === null || travel <= 0) return null;
  const offset = card.utcOffsetMinutes ?? null;
  // #4347 rework (tester P1-1) — decided by getOpenStatusAt, THE SAME parser
  // the status line uses, so an overnight range ("Saturday: 6:00 PM – 2:00 AM")
  // that runs past midnight counts at a 00:15 arrival. isPlaceOpenAt reads only
  // the arrival day's own line and said "closed" while the line said "Open
  // until 2am".
  if (!isOpenStatus(getOpenStatusAt(weekday, now, offset))) return null;
  const arrival = new Date(now.getTime() + travel * 60_000);
  return getOpenStatusAt(weekday, arrival, offset)?.kind === 'closed'
    ? { kind: 'closedAtArrival', tone: 'warn' }
    : null;
}

export interface ArrivalStop {
  readonly openingHours?: unknown;
  readonly utcOffsetMinutes?: number | null;
  readonly estimatedDurationMinutes?: number | null;
  readonly travelTimeFromPreviousStopMin?: number | null;
  readonly travelTimeFromUserMin?: number | null;
}

/**
 * A curated plan started NOW: the first stop whose hours say it will be closed
 * when you reach it, using the same cumulative arrival model the schedule check
 * uses (`checkAllCuratedStopsOpen`): travel to stop 1, then each stop's dwell
 * plus the leg to the next. Unknown hours never fire the chip.
 */
export function curatedSmartChip(stops: readonly ArrivalStop[] | null | undefined, now: Date): SmartChip | null {
  const list = Array.isArray(stops) ? stops : [];
  if (list.length === 0) return null;
  const first = list[0]?.travelTimeFromUserMin;
  const lead = typeof first === 'number' && Number.isFinite(first) && first > 0 ? first : 0;
  const positive = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  // #4347 wave 3 — the ONE arrival model (curatedArrivalTimes), the same one
  // the expanded plan's clock times and the schedule check read.
  const timings = curatedArrivalTimes(
    list.map((stop) => ({
      estimatedDurationMinutes: positive(stop.estimatedDurationMinutes) ?? undefined,
      travelTimeFromPreviousStopMin: positive(stop.travelTimeFromPreviousStopMin),
    })),
    new Date(now.getTime() + lead * 60_000),
  );
  for (let i = 0; i < list.length; i += 1) {
    const stop = list[i];
    const weekday = extractWeekdayText(stop.openingHours as Parameters<typeof extractWeekdayText>[0]);
    if (weekday !== null && getOpenStatusAt(weekday, timings[i].arrival, stop.utcOffsetMinutes ?? null)?.kind === 'closed') {
      return { kind: 'stopClosedAtArrival', stopNumber: i + 1, tone: 'warn' };
    }
  }
  return null;
}
