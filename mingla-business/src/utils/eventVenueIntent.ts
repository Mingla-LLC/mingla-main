/**
 * #4490 fix 2 (N76) — "Add an event here" from inside a venue.
 *
 * The venue's button opens the normal event (or experience) creator with
 * `?venueId=`. The creator route records the venue here; the Where step reads
 * it, preselects that venue and saves the link as soon as the draft has a
 * server id (a new draft only gets one after its first edit). Kept per brand
 * and dropped once used, or when a creator opens without a venue, so it can
 * never leak into an unrelated event. Survives a web reload (sessionStorage).
 */

export interface EventVenueIntent {
  brandId: string;
  venueId: string;
  noun: "event" | "experience";
}

const STORAGE_KEY = "mingla.eventVenueIntent";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let current: EventVenueIntent | null = null;

function storage(): Storage | null {
  try {
    const s = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export function isVenueIdParam(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function setEventVenueIntent(intent: EventVenueIntent | null): void {
  current = intent;
  const s = storage();
  if (s === null) return;
  try {
    if (intent === null) s.removeItem(STORAGE_KEY);
    else s.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Storage blocked: the in-memory copy still carries the intent.
  }
}

export function readEventVenueIntent(
  brandId: string | null,
  noun: "event" | "experience",
): EventVenueIntent | null {
  if (brandId === null) return null;
  let intent = current;
  if (intent === null) {
    const s = storage();
    try {
      const raw = s?.getItem(STORAGE_KEY) ?? null;
      if (raw !== null) {
        const parsed = JSON.parse(raw) as Partial<EventVenueIntent>;
        if (
          typeof parsed.brandId === "string" &&
          isVenueIdParam(parsed.venueId) &&
          (parsed.noun === "event" || parsed.noun === "experience")
        ) {
          intent = { brandId: parsed.brandId, venueId: parsed.venueId, noun: parsed.noun };
          current = intent;
        }
      }
    } catch {
      intent = null;
    }
  }
  if (intent === null || intent.brandId !== brandId || intent.noun !== noun) return null;
  return intent;
}

export function clearEventVenueIntent(): void {
  setEventVenueIntent(null);
}

/**
 * #4490 07-A — Party Type is optional for an event at a venue: the event's
 * saved venue link has a venue, or the creator was opened from a venue.
 * `linkVenueId` is undefined while the link is unknown.
 */
export function resolveEventAtVenue(
  linkVenueId: string | null | undefined,
  hasIntent: boolean,
): boolean {
  return (linkVenueId !== undefined && linkVenueId !== null) || hasIntent;
}
