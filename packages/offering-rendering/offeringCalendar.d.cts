// Types for offeringCalendar.cjs (the one owner of calendar facts; see there).

export interface OfferingCalendarInput {
  title: string;
  startIso: string | null | undefined;
  endIso: string | null | undefined;
  /** Shown only when the page itself shows it (address-hidden events pass null). */
  location?: string | null;
  /** The public page link, added to the description. */
  url?: string | null;
  details?: string | null;
}

export interface OfferingCalendarEntry {
  title: string;
  startMs: number;
  endMs: number;
  location: string | null;
  url: string | null;
  details: string | null;
}

/** The entry, or null when the data cannot honestly make one. */
export function offeringCalendarEntry(input: OfferingCalendarInput): OfferingCalendarEntry | null;
/** 20261219T210000Z (UTC basic format, the one both ICS and Google read). */
export function calendarUtcStamp(ms: number): string;
/** A one-event iCalendar file (RFC 5545), CRLF line endings. DTSTAMP = `stampMs` (default: now). */
export function offeringCalendarIcs(entry: OfferingCalendarEntry, uid: string, stampMs?: number): string;
/** The Google Calendar "add event" link. */
export function offeringGoogleCalendarUrl(entry: OfferingCalendarEntry): string;
/** The Outlook.com / Microsoft 365 compose link. */
export function offeringOutlookCalendarUrl(entry: OfferingCalendarEntry): string;
/** The calendar LOCATION: venue only when hidden; "Venue, address" when shown; null when both are missing. */
export function offeringCalendarLocation(input: {
  venueName?: string | null;
  address?: string | null;
  addressHidden?: boolean;
}): string | null;
