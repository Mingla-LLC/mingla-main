/**
 * #4490 W7 — "this event is at a hosted venue", remembered for the event page.
 *
 * The one fact the app has for "hosted" is W3's: a venue whose page payload
 * lists "What's on" rows (a verified venue with its features on). A What's on
 * row is therefore the only door the event page needs to recognise: when a
 * person taps one (on the venue page or on the card sheet), the row's event
 * start, the venue's coordinates and zone and today's drive label are
 * remembered here under the event's route, and the event page reads them back
 * to draw "When you'd go". Any other way in (a link, an organic event, a
 * non-hosted venue) finds nothing here and the page is exactly as before
 * (those pages are #4525's). No second definition of "hosted" is made.
 */

export interface HostedEventContext {
  /** The What's on row's start (ISO instant). */
  readonly startsAt: string;
  readonly lat: number | null;
  readonly lng: number | null;
  /** The venue's IANA zone. */
  readonly timeZone: string | null;
  /** Today's drive label from the card ("25 min"), when the card had one. */
  readonly driveTime: string | null;
}

/** The slice of a What's on row this reads (`VenueFeatureEventView`). */
export interface HostedEventRow {
  readonly startsAt: string;
  readonly href: string;
}

const EVENT_ROUTE = /^\/e\/([^\s/?#]+)\/([^\s/?#]+)$/;
const MAX_REMEMBERED = 50;
const remembered = new Map<string, HostedEventContext>();

/** The route key of an `/e/{brand}/{event}` path; null for any other path (experiences and trips are #4525's). */
export function hostedEventKeyFromPath(path: string): string | null {
  const m = EVENT_ROUTE.exec(path);
  return m === null ? null : `${m[1]}/${m[2]}`;
}

export const hostedEventKey = (brandSlug: string, eventSlug: string): string => `${brandSlug}/${eventSlug}`;

/**
 * A What's on row was tapped: remember it for its event page. Only `/e/` rows
 * with a readable start are kept.
 */
export function rememberHostedEventRow(
  path: string,
  events: readonly HostedEventRow[] | null | undefined,
  venue: {
    readonly lat?: number | null;
    readonly lng?: number | null;
    readonly timeZone?: string | null;
    readonly driveTime?: string | null;
  },
): void {
  const key = hostedEventKeyFromPath(path);
  if (key === null) return;
  const row = (events ?? []).find((e) => e.href === path);
  if (!row || Number.isNaN(Date.parse(row.startsAt))) return;
  remembered.delete(key);
  remembered.set(key, {
    startsAt: row.startsAt,
    lat: typeof venue.lat === 'number' && Number.isFinite(venue.lat) ? venue.lat : null,
    lng: typeof venue.lng === 'number' && Number.isFinite(venue.lng) ? venue.lng : null,
    timeZone: typeof venue.timeZone === 'string' && venue.timeZone.trim().length > 0 ? venue.timeZone.trim() : null,
    driveTime: typeof venue.driveTime === 'string' && venue.driveTime.trim().length > 0 ? venue.driveTime.trim() : null,
  });
  while (remembered.size > MAX_REMEMBERED) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) break;
    remembered.delete(oldest);
  }
}

/** What the event page remembers of a What's on row, or null (not opened from one). */
export function hostedEventContextFor(brandSlug: string, eventSlug: string): HostedEventContext | null {
  return remembered.get(hostedEventKey(brandSlug, eventSlug)) ?? null;
}

/** Tests only. */
export function clearHostedEventContexts(): void {
  remembered.clear();
}
