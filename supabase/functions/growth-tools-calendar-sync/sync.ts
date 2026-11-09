// #4339 calendar sync (Seth approved, 9 Nov 2026) — booked calls that are moved
// or cancelled in Google Calendar update on the admin Calendar.
//
// growth-tools-book creates every Book a call event on the booking calendar
// (BOOKING_CALENDAR_ID of the GOOGLE_CALENDAR_KEYS account) and writes
// public.book_call_leads with calendar_event_id = the Google event id. This
// module reads that calendar's CHANGES back, by incremental sync:
//
//   events.list?syncToken=<stored>&showDeleted=true   (every 5 minutes)
//
// The first run (and any run after Google answers 410 Gone, or after the
// calendar id changes) is a full sync with no token; its last page carries the
// nextSyncToken that later runs resume from. A run reads at most MAX_PAGES
// pages; a longer listing stores its page token and the next run carries on.
//
// Privacy: the listing asks Google for ONLY id, status, start and the
// attendees' email and response (the `fields` mask), so no title or
// description ever reaches this function. The event ids of a page go to
// book_call_calendar_bookings, which answers only the ids that ARE bookings
// (with the booker's email); nothing about any other event is sent anywhere,
// stored or logged. Logs carry counts and HTTP statuses only.
//
// For each booking event: a new start → moved; status "cancelled" → cancelled;
// the booker's own attendee responseStatus "declined" → declined. The database
// derives the status, so the same change applied twice changes nothing
// (book_call_apply_calendar_changes).
//
// Then each new change (moved, cancelled, declined) is emailed once to the
// "New Mingla call" recipients (buildNotifyRecipients): claimed in the
// database before sending, given back if the send fails.
//
// Auth: cron only. pg_cron posts with the vault's service_role_key as the
// bearer (the same mechanism as every cron-invoked edge function); the gateway
// verifies the JWT (verify_jwt = true) and this module compares the bearer to
// SUPABASE_SERVICE_ROLE_KEY. Anything else is 401.

import {
  type CalendarKeys,
  parseCalendarKeys,
  refreshCalendarAccessToken,
} from "../_shared/googleCalendarAuth.ts";
import {
  type GrowthToolsEmail,
  sendGrowthToolsEmail,
} from "../_shared/growthToolsResend.ts";
import { escapeHtml } from "../_shared/email/escape.ts";
import { buildNotifyRecipients } from "../growth-tools-book/bookingDetails.ts";
import { AUDIENCE_CALL_LABELS } from "../growth-tools-book/bookingContext.ts";

export const LOG_TAG = "growth-tools-calendar-sync";
export const MAX_PAGES = 20;
export const PAGE_SIZE = 250;
/** Only what the sync needs: never the title, description or location. */
export const EVENT_FIELDS =
  "items(id,status,start,attendees(email,responseStatus)),nextPageToken,nextSyncToken";

// ── Shapes ───────────────────────────────────────────────────────────────────
export interface GoogleEvent {
  id?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { email?: string; responseStatus?: string }[];
}

export interface CalendarChange {
  event_id: string;
  cancelled: boolean;
  start_at: string | null;
  booker_declined: boolean;
}

export interface BookingMatch {
  calendar_event_id: string;
  email: string;
}

export interface SyncState {
  busy: boolean;
  sync_token?: string | null;
  page_token?: string | null;
}

export interface FinishInput {
  calendarId: string;
  syncToken: string | null;
  pageToken: string | null;
  fullSync: boolean;
  error: string | null;
  result: Record<string, unknown> | null;
}

export interface ChangeNotice {
  id: string;
  notice_key: string;
  previous_key: string | null;
  status: "moved" | "cancelled" | "declined";
  audience: "host" | "creator" | "local";
  name: string;
  venue: string | null;
  call_at: string;
  original_call_at: string | null;
  booker_time_zone: string | null;
  event_url: string | null;
}

/** The database calls the sync makes (PostgREST RPCs with the service role). */
export interface SyncDb {
  begin(calendarId: string): Promise<SyncState>;
  finish(input: FinishInput): Promise<void>;
  bookings(eventIds: string[]): Promise<BookingMatch[]>;
  apply(changes: CalendarChange[]): Promise<{ matched: number; updated: number }>;
  claimNotices(limit: number): Promise<ChangeNotice[]>;
  releaseNotice(notice: ChangeNotice): Promise<void>;
}

export interface NotifyConfig {
  resendKey: string;
  notifyTo: string;
  timeZone: string;
}

export interface SyncDeps {
  serviceRoleKey: string | undefined;
  calendarKeysPacked: string;
  calendarId: string;
  db: SyncDb;
  notify: NotifyConfig | null;
  fetchImpl?: typeof fetch;
  maxPages?: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Pure pieces ──────────────────────────────────────────────────────────────
/** The events.list URL for the next page: full, incremental or resumed. */
export function buildListUrl(
  calendarId: string,
  syncToken: string | null,
  pageToken: string | null,
): string {
  const params = new URLSearchParams({
    maxResults: String(PAGE_SIZE),
    showDeleted: "true",
    fields: EVENT_FIELDS,
  });
  if (syncToken) params.set("syncToken", syncToken);
  if (pageToken) params.set("pageToken", pageToken);
  return `https://www.googleapis.com/calendar/v3/calendars/${
    encodeURIComponent(calendarId)
  }/events?${params.toString()}`;
}

/** An RFC 3339 instant as UTC ISO, or null for an all-day date / garbage. */
function instantOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** What Google says about one booking's event, for the database to apply. */
export function eventChange(event: GoogleEvent, bookerEmail: string): CalendarChange | null {
  const id = typeof event.id === "string" ? event.id.trim() : "";
  if (id === "") return null;
  const cancelled = event.status === "cancelled";
  const booker = bookerEmail.trim().toLowerCase();
  const declined = !cancelled && booker !== "" &&
    (Array.isArray(event.attendees) ? event.attendees : []).some((a) =>
      typeof a?.email === "string" && a.email.trim().toLowerCase() === booker &&
      a.responseStatus === "declined"
    );
  return {
    event_id: id,
    cancelled,
    start_at: cancelled ? null : instantOrNull(event.start?.dateTime),
    booker_declined: declined,
  };
}

/** The changes for the events on one page that are bookings. */
export function changesForPage(events: GoogleEvent[], matches: BookingMatch[]): CalendarChange[] {
  const bookerByEvent = new Map(matches.map((m) => [m.calendar_event_id, m.email ?? ""]));
  const out: CalendarChange[] = [];
  for (const event of events) {
    const id = typeof event?.id === "string" ? event.id.trim() : "";
    if (!bookerByEvent.has(id)) continue;
    const change = eventChange(event, bookerByEvent.get(id) ?? "");
    if (change) out.push(change);
  }
  return out;
}

function formatWhen(iso: string | null, timeZone: string): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "an unknown time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ms));
}

/** The plain "Call cancelled" / "Call moved" email for one change. */
export function buildNoticeEmail(
  notice: ChangeNotice,
  config: { notifyTo: string; timeZone: string },
): GrowthToolsEmail {
  const label = AUDIENCE_CALL_LABELS[notice.audience] ?? "Call";
  const who = notice.audience === "host" && notice.venue
    ? `${notice.name} (${notice.venue})`
    : notice.name;
  const when = formatWhen(notice.call_at, config.timeZone);
  let subject: string;
  let line: string;
  if (notice.status === "moved") {
    const was = formatWhen(notice.original_call_at, config.timeZone);
    subject = `Call moved — ${label}: ${notice.name} (${when})`;
    line = `The ${label} with ${who} moved from ${was} to ${when}.`;
  } else if (notice.status === "declined") {
    subject = `Call cancelled — ${label}: ${notice.name} declined (${when})`;
    line = `${who} declined the invite for the ${label} on ${when}.`;
  } else {
    subject = `Call cancelled — ${label}: ${notice.name} (${when})`;
    line = `The ${label} with ${who} on ${when} was cancelled in Google Calendar.`;
  }
  const link = typeof notice.event_url === "string" && /^https:\/\/\S+$/.test(notice.event_url)
    ? notice.event_url
    : null;
  const text = `${line}\n\nThe admin Calendar shows the change.` +
    (link ? `\nGoogle Calendar: ${link}` : "");
  const html = `<p style="font-size:15px;">${escapeHtml(line)}</p>` +
    `<p style="font-size:14px;color:#555;">The admin Calendar shows the change.` +
    (link ? ` <a href="${escapeHtml(link)}">Open in Google Calendar</a>` : "") +
    `</p>`;
  return {
    to: buildNotifyRecipients(config.notifyTo),
    subject,
    html,
    text,
    replyTo: "support@usemingla.com",
  };
}

// ── The run ──────────────────────────────────────────────────────────────────
export async function handleCalendarSync(req: Request, deps: SyncDeps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const expected = deps.serviceRoleKey ?? "";
  if (expected === "" || (req.headers.get("authorization") ?? "") !== `Bearer ${expected}`) {
    return json({ error: "unauthorized" }, 401);
  }
  const keys: CalendarKeys | null = parseCalendarKeys(deps.calendarKeysPacked);
  if (!keys) {
    console.error(`[${LOG_TAG}] GOOGLE_CALENDAR_KEYS is not set or malformed; nothing synced`);
    return json({ error: "calendar_unconfigured" }, 503);
  }
  const doFetch = deps.fetchImpl ?? fetch;
  const maxPages = deps.maxPages ?? MAX_PAGES;

  const state = await deps.db.begin(deps.calendarId);
  if (state.busy) return json({ ok: true, skipped: "busy" });

  let syncToken = state.sync_token ?? null;
  let pageToken = state.page_token ?? null;
  let fullSync = syncToken === null;
  let resynced = false;
  let complete = false;
  const counts = { pages: 0, events_seen: 0, bookings_matched: 0, bookings_updated: 0 };

  const finish = async (error: string | null) => {
    await deps.db.finish({
      calendarId: deps.calendarId,
      syncToken,
      pageToken,
      fullSync: fullSync && complete,
      error,
      result: { ...counts, full_sync: fullSync, resynced, complete },
    });
  };

  try {
    const token = await refreshCalendarAccessToken(keys, { logTag: LOG_TAG, fetchImpl: doFetch });
    if (!token) {
      await finish("token_refresh_failed");
      return json({ error: "calendar_unavailable" }, 502);
    }
    while (counts.pages < maxPages) {
      const res = await doFetch(buildListUrl(deps.calendarId, syncToken, pageToken), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 410) {
        // The syncToken (or page token) is no longer valid: full resync, once.
        await res.body?.cancel();
        if (resynced) {
          syncToken = null;
          pageToken = null;
          await finish("sync_token_gone_twice");
          return json({ error: "calendar_unavailable" }, 502);
        }
        console.warn(`[${LOG_TAG}] 410 Gone: full resync`);
        syncToken = null;
        pageToken = null;
        fullSync = true;
        resynced = true;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        console.error(`[${LOG_TAG}] events.list failed`, res.status);
        await finish(`list_failed:${res.status}`);
        return json({ error: "calendar_unavailable" }, 502);
      }
      const page = await res.json() as {
        items?: GoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      };
      counts.pages += 1;
      const events = Array.isArray(page.items) ? page.items : [];
      counts.events_seen += events.length;
      const ids = [...new Set(events.map((e) => typeof e?.id === "string" ? e.id.trim() : "").filter(Boolean))];
      if (ids.length > 0) {
        const matches = await deps.db.bookings(ids);
        const changes = changesForPage(events, matches);
        if (changes.length > 0) {
          const applied = await deps.db.apply(changes);
          counts.bookings_matched += applied.matched;
          counts.bookings_updated += applied.updated;
        }
      }
      if (page.nextPageToken) {
        pageToken = page.nextPageToken;
        continue;
      }
      if (!page.nextSyncToken) {
        await finish("no_sync_token");
        return json({ error: "calendar_unavailable" }, 502);
      }
      syncToken = page.nextSyncToken;
      pageToken = null;
      complete = true;
      break;
    }
    await finish(null);
  } catch (err) {
    console.error(`[${LOG_TAG}] sync threw`, err instanceof Error ? err.message : "error");
    await finish("sync_threw").catch(() => {});
    return json({ error: "server" }, 500);
  }

  // Each new change is emailed once. A failure here never fails the sync.
  const notices = { sent: 0, failed: 0 };
  if (deps.notify && deps.notify.resendKey) {
    try {
      const claimed = await deps.db.claimNotices(20);
      for (const notice of claimed) {
        const ok = await sendGrowthToolsEmail(buildNoticeEmail(notice, deps.notify), {
          apiKey: deps.notify.resendKey,
          logTag: LOG_TAG,
          fetchImpl: doFetch,
        });
        if (ok) {
          notices.sent += 1;
        } else {
          notices.failed += 1;
          console.error(`[${LOG_TAG}] change notice not sent; claim given back`, notice.id, notice.status);
          await deps.db.releaseNotice(notice).catch(() => {});
        }
      }
    } catch (err) {
      console.error(`[${LOG_TAG}] change notices threw`, err instanceof Error ? err.message : "error");
    }
  }

  console.log(`[${LOG_TAG}] done`, JSON.stringify({ ...counts, full_sync: fullSync, resynced, complete, notices }));
  return json({ ok: true, ...counts, full_sync: fullSync, resynced, complete, notices_sent: notices.sent, notices_failed: notices.failed });
}

// ── The database, through PostgREST with the service role ────────────────────
export function restSyncDb(supabaseUrl: string, serviceKey: string, fetchImpl: typeof fetch = fetch): SyncDb {
  const base = supabaseUrl.replace(/\/+$/, "");
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const res = await fetchImpl(`${base}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`rpc ${fn} failed: ${res.status} ${detail.slice(0, 120)}`);
    }
    const text = await res.text();
    return (text === "" ? null : JSON.parse(text)) as T;
  };
  return {
    begin: (calendarId) => rpc<SyncState>("book_call_calendar_sync_begin", { p_calendar_id: calendarId, p_lease_seconds: 240 }),
    finish: async (input) => {
      await rpc("book_call_calendar_sync_finish", {
        p_calendar_id: input.calendarId,
        p_sync_token: input.syncToken,
        p_page_token: input.pageToken,
        p_full_sync: input.fullSync,
        p_error: input.error,
        p_result: input.result,
      });
    },
    bookings: async (eventIds) => (await rpc<BookingMatch[] | null>("book_call_calendar_bookings", { p_event_ids: eventIds })) ?? [],
    apply: async (changes) => {
      const out = await rpc<{ matched?: number; updated?: number } | null>("book_call_apply_calendar_changes", { p_changes: changes });
      return { matched: Number(out?.matched ?? 0), updated: Number(out?.updated ?? 0) };
    },
    claimNotices: async (limit) => (await rpc<ChangeNotice[] | null>("book_call_claim_change_notices", { p_limit: limit })) ?? [],
    releaseNotice: async (notice) => {
      await rpc("book_call_release_change_notice", {
        p_id: notice.id,
        p_notice_key: notice.notice_key,
        p_previous_key: notice.previous_key,
      });
    },
  };
}
