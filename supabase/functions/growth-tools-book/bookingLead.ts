// #4339 round A (Seth approved, 8 Nov 2026) — every confirmed booking becomes
// an Inbound lead in Mingla Admin (#/inbound, admin_inbound_leads, source
// `book_a_call`).
//
// After the calendar event exists, the handler writes one row to
// public.book_call_leads with the service role, through PostgREST:
//
//   POST <SUPABASE_URL>/rest/v1/book_call_leads?on_conflict=booking_key
//   Prefer: resolution=ignore-duplicates,return=minimal
//
// `booking_key` is "gcal:<event id>" (else "slot:<start>:<email hash>"), unique in
// the table, so a retried write of the same booking adds nothing.
//
// A failed lead write NEVER fails the booking: the guest already has their
// invite. It is logged loudly ("[growth-tools-book] LEAD WRITE FAILED") with
// the booking key, so it can be found and replayed by hand. No email address
// or token is logged.
//
// #4339 Creators and Locals calls: the row carries its `audience` (host,
// creator or local) and that audience's facts (the ICP, venue and website for
// a Host call; the city, what they make and their best work for a Creator; the
// city and first place for a Local), plus the booker's time zone and the Meet
// and calendar links, so the admin Calendar can show every call.
//
// No module imports beyond the sibling type file, so the Deno suites can run
// it with a stubbed fetch and no network.

import type { BookingContext } from "./bookingContext.ts";

export interface BookingLeadInput {
  eventId: string | null;
  startMs: number;
  name: string;
  email: string;
  venue: string;
  source: string;
  context: BookingContext;
  /** The booker's IANA time zone (validated), when the page sent one. */
  timeZone?: string | null;
  meetUrl?: string | null;
  eventUrl?: string | null;
}

export interface BookingLeadRow {
  booking_key: string;
  calendar_event_id: string | null;
  audience: "host" | "creator" | "local";
  name: string;
  email: string;
  venue: string | null;
  icp: string | null;
  city: string | null;
  creator_makes: string | null;
  work_url: string | null;
  first_place: string | null;
  social_platform: string;
  social_handle: string;
  social_url: string;
  website: string | null;
  call_at: string;
  booker_time_zone: string | null;
  meet_url: string | null;
  event_url: string | null;
  source: string | null;
}

/** Only an https link is stored for the Meet and the calendar event. */
function httpsOrNull(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const value = url.trim();
  return /^https:\/\/\S+$/i.test(value) && value.length <= 500 ? value : null;
}

/** FNV-1a (32-bit) hex, so a key never carries the email itself. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The idempotency key for one booking (it is logged, so it holds no email). */
export function bookingKey(
  eventId: string | null,
  startMs: number,
  email: string,
): string {
  const id = typeof eventId === "string" ? eventId.trim() : "";
  if (id !== "") return `gcal:${id.slice(0, 280)}`;
  return `slot:${new Date(startMs).toISOString()}:${
    fnv1a(email.toLowerCase())
  }`;
}

/** The row for public.book_call_leads. The social link is always https. */
export function buildBookingLead(input: BookingLeadInput): BookingLeadRow {
  const venue = input.venue.trim();
  const source = input.source.trim();
  const context = input.context;
  const host = context.audience === "host";
  return {
    booking_key: bookingKey(input.eventId, input.startMs, input.email),
    calendar_event_id: input.eventId && input.eventId.trim() !== ""
      ? input.eventId.trim()
      : null,
    audience: context.audience,
    name: input.name,
    email: input.email,
    venue: host && venue !== "" ? venue : null,
    icp: context.audience === "host" ? context.icp : null,
    city: context.audience === "host" ? null : context.city,
    creator_makes: context.audience === "creator" ? context.makes : null,
    work_url: context.audience === "creator" ? context.workUrl : null,
    first_place: context.audience === "local" ? context.firstPlace : null,
    social_platform: context.social.platform,
    social_handle: context.social.display,
    social_url: context.social.url.replace(/^http:\/\//i, "https://"),
    website: context.audience === "host" ? context.website : null,
    call_at: new Date(input.startMs).toISOString(),
    booker_time_zone: input.timeZone ?? null,
    meet_url: httpsOrNull(input.meetUrl),
    event_url: httpsOrNull(input.eventUrl),
    source: source === "" ? null : source,
  };
}

export interface LeadWriteConfig {
  supabaseUrl: string | undefined;
  serviceKey: string | undefined;
}

export type LeadWriteResult = "written" | "unconfigured" | "failed";

/**
 * Writes the lead. Never throws and never rejects: every failure is logged
 * loudly and answered "failed" (or "unconfigured" when the function has no
 * service credentials), and the booking carries on.
 */
export async function recordBookingLead(
  row: BookingLeadRow,
  config: LeadWriteConfig,
): Promise<LeadWriteResult> {
  const base = (config.supabaseUrl ?? "").replace(/\/+$/, "");
  const key = config.serviceKey ?? "";
  if (base === "" || key === "") {
    console.error(
      "[growth-tools-book] LEAD WRITE FAILED: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set; booking",
      row.booking_key,
      "is not in Inbound leads",
    );
    return "unconfigured";
  }
  try {
    const res = await fetch(
      `${base}/rest/v1/book_call_leads?on_conflict=booking_key`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=minimal",
        },
        body: JSON.stringify(row),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        "[growth-tools-book] LEAD WRITE FAILED: status",
        res.status,
        "booking",
        row.booking_key,
        detail.slice(0, 200),
      );
      return "failed";
    }
    return "written";
  } catch (err) {
    console.error(
      "[growth-tools-book] LEAD WRITE FAILED: threw for booking",
      row.booking_key,
      err instanceof Error ? err.message : String(err),
    );
    return "failed";
  }
}
