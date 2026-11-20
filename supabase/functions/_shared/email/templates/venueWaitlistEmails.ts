import { venueAppLinkDisplay } from "./venueBookingEmails.ts";
// ===========================================================================
// #4490 P5 — the guest waitlist messages:
//   venue_waitlist_joined · venue_table_opened · venue_waitlist_ready
// ---------------------------------------------------------------------------
// The outbox row carries the words it needs (venue name, day, party, the
// time range or the time found). No private link: the guest's waitlist page
// opens only with the token kept on their device; the button (if any) is the
// public venue page. Plain words, the numbers; no raw codes.
// ===========================================================================

export const VENUE_WAITLIST_CATEGORIES = new Set([
  "venue_waitlist_joined",
  "venue_table_opened",
  "venue_waitlist_ready",
]);

export const isVenueWaitlistCategory = (key: string): boolean =>
  VENUE_WAITLIST_CATEGORIES.has(key);

type Json = Record<string, unknown>;
const text = (v: unknown): string =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : "";
const count = (v: unknown): number =>
  typeof v === "number" && Number.isSafeInteger(v) ? v : 0;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Sat 21 Nov" from `2026-11-21` (a calendar date, no time zone maths). */
export function waitlistDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${
    MONTHS[d.getUTCMonth()]
  }`;
}

export interface VenueWaitlistMessage {
  push: { title: string; body: string };
  email: { subject: string; body: string };
  sms: string;
}

export function renderVenueWaitlistMessage(
  categoryKey: string,
  payload: Json,
): VenueWaitlistMessage {
  const venue = text(payload.venue_name) || "the venue";
  const day = waitlistDate(text(payload.desired_date));
  const on = day ? ` on ${day}` : "";
  const party = count(payload.party_size);
  const forParty = party > 0
    ? ` for ${party} ${party === 1 ? "guest" : "guests"}`
    : "";
  const from = text(payload.desired_from);
  const to = text(payload.desired_to);
  const range = from && to ? ` between ${from} and ${to}` : "";
  const time = text(payload.slot_label);

  if (categoryKey === "venue_table_opened") {
    const at = time ? ` at ${time}` : range;
    const body =
      `A table opened at ${venue}${on}${at}${forParty}. Book it on the venue's page before someone else does. You can leave the waitlist from your waitlist page.`;
    return {
      push: {
        title: `A table opened at ${venue}`,
        body: `${day}${at}. Book it now.`,
      },
      email: { subject: `A table opened at ${venue}${on}`, body },
      sms: `${venue}: a table opened${on}${at}. Book it on the venue's page.`,
    };
  }
  if (categoryKey === "venue_waitlist_ready") {
    const body =
      `Your table at ${venue} is ready${forParty}. Please come to the host stand. If you can't make it, leave the waitlist from your waitlist page so the next guest can sit.`;
    return {
      push: {
        title: `Your table at ${venue} is ready`,
        body: "Please come to the host stand.",
      },
      email: { subject: `Your table at ${venue} is ready`, body },
      sms: `${venue}: your table is ready. Please come to the host stand.`,
    };
  }
  // venue_waitlist_joined
  const position = count(payload.position);
  const line = position > 0 ? ` You're number ${position} in line.` : "";
  const what = range
    ? `We'll tell you if a table opens${range}.`
    : "We'll tell you when your table is ready.";
  const body =
    `You're on the waitlist at ${venue}${on}${forParty}.${line} ${what} Your waitlist page shows your place; you can leave from there.`;
  return {
    push: {
      title: `On the waitlist at ${venue}`,
      body: `${day}${forParty}.${line}`,
    },
    email: { subject: `You're on the waitlist at ${venue}${on}`, body },
    sms: venueAppLinkDisplay(payload)
      ? `Mingla: you're on the waitlist at ${venue}${on}.${line} Your place is in the Mingla app: ${
        venueAppLinkDisplay(payload)
      }`
      : `${venue}: you're on the waitlist${on}.${line}`,
  };
}
