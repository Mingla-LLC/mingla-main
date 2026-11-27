// ISSUE-1078 [Venue Website Grader] — real Google Calendar booking.
//
// PUBLIC edge function (verify_jwt=false). Lets a venue owner book a call on
// seth@usemingla.com's calendar straight from the report — no back-and-forth.
// Uses an OAuth REFRESH TOKEN (calendar scope) minted for seth@ via the OAuth
// Playground on the existing mingla-ads-engine client — NOT a service account,
// NOT Workspace domain-wide delegation. Two actions:
//
//   POST {action:"slots"}                → {slots:[{start,end}]} (UTC ISO)
//   POST {action:"book", start, name, email, icp, social_platform,
//         social_handle, venue?, website?, report_url?, source?}
//                                        → {ok:true, event_url, meet_url, start}
//
// #4339 §6 — `icp`, `social_platform` and `social_handle` are REQUIRED on every
// booking (the /schedule page is the only caller; every funnel reaches it), and
// `website` is optional. They are validated in bookingContext.ts, put at the TOP
// of the calendar description (the social as a working profile link, then the
// website), stored on the event as private extended properties, and shown at the
// top of the "New Mingla call" notification. A booking without them is a 400
// {error:"validation", field}.
//
// #4339 round A — every confirmed booking is also written to
// public.book_call_leads (bookingLead.ts, service role, idempotent on the
// calendar event id), so it shows in Mingla Admin's Inbound leads as
// "Book a call". A failed lead write never fails the booking.
//
// #4339 Creators and Locals calls (Seth approved, 9 Nov): `audience` is host
// (absent, the default, everything above unchanged), creator or local, from
// usemingla.com/schedule/creators and /schedule/locals. Each audience has its
// own required fields (bookingContext.ts parseBookingContext). The invite is
// titled "Mingla Creators call: <name>" or "Mingla Locals call: <name>" and
// lists the city, what they make or their first place, and the social as a
// working link. RECIPIENTS ARE THE SAME FOR EVERY AUDIENCE (Seth, 9 Nov): the
// same calendar and Meet organiser, guests = the booker + info@
// (buildAttendees), the "New Mingla call" email to BOOKING_NOTIFY_TO + info@
// (buildNotifyRecipients), which names the audience, and the booker's own
// confirmation. The lead row carries the audience, the booker's time zone
// (`time_zone`, optional) and the Meet and calendar links.
//
// Config secret GOOGLE_CALENDAR_KEYS = "client_id|client_secret|refresh_token".
// Optional env: BOOKING_TZ (default America/New_York), BOOKING_CALENDAR_ID
// (default "primary"), BOOKING_NOTIFY_TO (default seth@usemingla.com). Bookable
// Mon–Fri 05:00–20:00 in BOOKING_TZ, 20-min slots, 12h min notice, up to a month
// ahead. On a successful book we (best-effort) email BOTH parties via Resend:
// a confirmation to the booker and a notification to BOOKING_NOTIFY_TO.
//
// → 400 {error:"validation"} | 409 {error:"slot_taken"} | 502 {error:"calendar_unavailable"}
//   500 {error:"server"} · OPTIONS → 200 "ok" + CORS

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
// Branded email shell + senders + escape — reused by import (same infra the
// grader gate uses to email the report). DO-NOT edit those modules here.
import { renderShell, SHELL_TOKENS } from "../_shared/email/shell.ts";
import {
  emailButton,
  renderBookingConfirmation,
} from "./bookingConfirmation.ts";
import { escapeHtml } from "../_shared/email/escape.ts";
import {
  type GrowthToolsEmail,
  sendGrowthToolsEmail,
} from "../_shared/growthToolsResend.ts";
import { minglaLogoUrl } from "../_shared/brandAssets.ts";
import { resolveRuntimeString } from "../_shared/runtimeConfig.ts";
// #3601 — pure, zero-import builders for the calendar description, the guest
// list, and the notification recipient list. Extracted so both regression
// suites can assert on the rendered strings without touching Google or Resend.
import {
  buildAttendees,
  buildEventDescription,
  buildNotifyRecipients,
  originLabel,
  sanitizeLine,
} from "./bookingDetails.ts";
import {
  AUDIENCE_CALL_LABELS,
  type BookingContext,
  buildBookingDescription,
  buildEventSummary,
  buildPrivateProperties,
  CREATOR_MAKES_LABELS,
  ICP_LABELS,
  parseBookingContext,
  parseBookingExtras,
  parseTimeZone,
  SOCIAL_LABELS,
} from "./bookingContext.ts";
import {
  buildBookingLead,
  linkDemoFromToken,
  parseScheduleToken,
  recordBookingLead,
} from "./bookingLead.ts";
// #4238 W3-3: a Host booking with the page's ad context is a host lead.
import { recordBookingConversions, resolveFormLink } from "./bookingAdLead.ts";
import { parseHostAdContext } from "../_shared/hostFunnelConversion.ts";
import {
  type CalendarKeys,
  parseCalendarKeys,
  refreshCalendarAccessToken,
} from "../_shared/googleCalendarAuth.ts";
import {
  legacySchedulerProfile,
  loadSchedulerProfile,
  markBookingHandoffUsed,
  mergeBookingHandoff,
  resolveBookingHandoff,
  schedulerKey,
  type SchedulerProfile,
  startBookingLifecycle,
} from "./schedulerProfile.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Booking config ───────────────────────────────────────────────────────────
const TZ = Deno.env.get("BOOKING_TZ") ?? "America/New_York";
const CALENDAR_ID = Deno.env.get("BOOKING_CALENDAR_ID") ?? "primary";
const WORK_START_MIN = 5 * 60; // 05:00 local
const WORK_END_MIN = 20 * 60; // 20:00 local (last slot starts 19:40)
const SLOT_MIN = 20;
const MIN_NOTICE_MS = 12 * 60 * 60 * 1000; // 12h
const LOOKAHEAD_DAYS = 45; // ~1.5 months of calendar days scanned
const MAX_DAYS = 31; // distinct open weekdays returned (a full month+)
const MAX_SLOTS = 1200; // hard payload ceiling across all days
const NOTIFY_TO = Deno.env.get("BOOKING_NOTIFY_TO") ?? "seth@usemingla.com";
const REPLY_TO = "support@usemingla.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Timezone math (DST-correct via Intl) ─────────────────────────────────────
// Offset (ms) of `tz` at the instant `date`.
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const asUTC = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUTC - date.getTime();
}

// Wall-clock time in `tz` → UTC epoch ms.
function wallToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = tzOffsetMs(new Date(guess), tz);
  return guess - off;
}

// {year,month,day,weekday} of `date` in `tz`.
function tzYmd(
  date: Date,
  tz: string,
): { y: number; mo: number; d: number; wd: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const wdMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    y: Number(p.year),
    mo: Number(p.month),
    d: Number(p.day),
    wd: wdMap[p.weekday] ?? 0,
  };
}

// ── Google OAuth (refresh token → access token) ──────────────────────────────
// #4339 calendar sync — the parser and the refresh are shared with
// growth-tools-calendar-sync (../_shared/googleCalendarAuth.ts); this function
// still reads its own GOOGLE_CALENDAR_KEYS. Governed manifest fields:
// calendar_client_id, calendar_client_secret, calendar_refresh_token.
export { parseCalendarKeys };

function calendarKeys(): CalendarKeys | null {
  return parseCalendarKeys(Deno.env.get("GOOGLE_CALENDAR_KEYS") ?? "");
}

async function getAccessToken(): Promise<string | null> {
  const keys = calendarKeys();
  if (!keys) return null;
  return await refreshCalendarAccessToken(keys, {
    logTag: "growth-tools-book",
  });
}

interface Busy {
  start: number;
  end: number;
}

async function fetchBusy(
  token: string,
  timeMinIso: string,
  timeMaxIso: string,
  calendarId: string = CALENDAR_ID,
): Promise<Busy[] | null> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      items: [{ id: calendarId }],
    }),
  });
  if (!res.ok) {
    console.error("[growth-tools-book] freeBusy failed", res.status);
    return null;
  }
  const body = await res.json() as {
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  };
  const busyRaw = body.calendars?.[calendarId]?.busy ?? [];
  return busyRaw.map((b) => ({
    start: Date.parse(b.start),
    end: Date.parse(b.end),
  }));
}

function computeFreeSlots(
  busy: Busy[],
  now: number,
  profile?: SchedulerProfile,
): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];
  const tz = profile?.timeZone ?? TZ;
  const slotMinutes = profile?.durationMinutes ?? SLOT_MIN;
  const startMinute = profile?.startMinute ?? WORK_START_MIN;
  const endMinute = profile?.endMinute ?? WORK_END_MIN;
  const lookahead = profile?.lookaheadDays ?? LOOKAHEAD_DAYS;
  const maxDays = profile?.maxOpenDays ?? MAX_DAYS;
  const weekdays = new Set(profile?.weekdays ?? [1, 2, 3, 4, 5]);
  const earliest = now +
    (profile?.minNoticeMinutes ?? MIN_NOTICE_MS / 60_000) * 60_000;
  // Cap by DISTINCT open days, not a flat slot count: a flat cap fills up on the
  // first free day (15h × 20-min ≈ 44 slots) and hides the rest of the month.
  let openDays = 0;
  for (let dayOffset = 0; dayOffset <= lookahead; dayOffset++) {
    const dayInstant = new Date(now + dayOffset * 24 * 60 * 60 * 1000);
    const { y, mo, d, wd } = tzYmd(dayInstant, tz);
    if (!weekdays.has(wd)) continue;
    let dayHasSlot = false;
    for (let m = startMinute; m + slotMinutes <= endMinute; m += slotMinutes) {
      const startMs = wallToUtc(y, mo, d, Math.floor(m / 60), m % 60, tz);
      const endMs = startMs + slotMinutes * 60 * 1000;
      if (startMs < earliest) continue;
      const overlaps = busy.some((b) => startMs < b.end && endMs > b.start);
      if (overlaps) continue;
      if (!dayHasSlot) {
        if (openDays >= maxDays) return slots;
        openDays++;
        dayHasSlot = true;
      }
      slots.push({
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
      });
      if (slots.length >= MAX_SLOTS) return slots;
    }
  }
  return slots;
}

// ── Confirmation + notification emails (Resend, best-effort) ──────────────────
// Full local-time label, e.g. "Friday, July 24 at 9:00 AM EDT".
function formatLocal(ms: number, timeZone: string = TZ): string {
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

const { BRAND_ORANGE_BUTTON, BRAND_INK, BRAND_MUTED, BRAND_BORDER } =
  SHELL_TOKENS;

// #4339 calendar sync — the send itself is shared with growth-tools-calendar-sync.
async function sendResend(input: GrowthToolsEmail): Promise<boolean> {
  return await sendGrowthToolsEmail(input, {
    apiKey: Deno.env.get("RESEND_API_KEY") ?? "",
    logTag: "growth-tools-book",
  });
}

// Fire both emails. Never throws — a mail failure must not fail the booking
// (the Google Calendar invite has already gone out via sendUpdates=all).
export async function sendBookingEmails(input: {
  startMs: number;
  name: string;
  email: string;
  venue: string;
  reportUrl: string;
  source: string;
  context: BookingContext;
  timeZone: string | null;
  meetUrl: string | null;
  eventUrl: string | null;
  scheduler?: Pick<SchedulerProfile, "timeZone" | "notifyTo">;
}): Promise<void> {
  const schedulerTimeZone = input.scheduler?.timeZone ?? TZ;
  const when = formatLocal(input.startMs, schedulerTimeZone);
  const host = input.context.audience === "host";
  const callLabel = AUDIENCE_CALL_LABELS[input.context.audience];
  const logo = minglaLogoUrl();
  const shell = (bodyHtml: string, preheader: string) =>
    renderShell({
      preheader,
      bodyHtml,
      supportEmail: Deno.env.get("SUPPORT_EMAIL") ?? REPLY_TO,
      logoUrl: logo,
      footerAddress: resolveRuntimeString(
        "mingla_footer_address",
        "MINGLA_FOOTER_ADDRESS",
      ) ??
        "Mingla, hello@usemingla.com",
    });
  // 1) Confirmation to the booker: the audience's bar with the app button only (#4452 SC-86).
  const booker = renderBookingConfirmation({
    when,
    meetUrl: input.meetUrl,
    audience: input.context.audience,
    supportEmail: Deno.env.get("SUPPORT_EMAIL") ?? REPLY_TO,
    logoUrl: logo,
    footerAddress:
      resolveRuntimeString("mingla_footer_address", "MINGLA_FOOTER_ADDRESS") ??
        "Mingla, hello@usemingla.com",
  });

  // 2) Notification to Seth — reply-to is the lead so a reply reaches them.
  // #4339 §6 — their social (a working profile link) and website come FIRST, so
  // the team can open them before the call.
  const socialLabel = SOCIAL_LABELS[input.context.social.platform];
  // #4339 calls: the second link is the website (Host) or their best work
  // (Creator); a Local has only the social.
  const second = input.context.audience === "host"
    ? { url: input.context.website, label: "Website", none: "No website given" }
    : input.context.audience === "creator"
    ? {
      url: input.context.workUrl,
      label: "Best work",
      none: "No work link given",
    }
    : null;
  const contextLinks = [
    `<a href="${
      escapeHtml(input.context.social.url)
    }" style="color:${BRAND_ORANGE_BUTTON};font-weight:600;">${
      escapeHtml(socialLabel)
    }: ${escapeHtml(input.context.social.display)}</a>`,
    second === null
      ? ""
      : second.url
      ? `<a href="${
        escapeHtml(second.url)
      }" style="color:${BRAND_ORANGE_BUTTON};font-weight:600;">${second.label}: ${
        escapeHtml(second.url)
      }</a>`
      : `<span style="color:${BRAND_MUTED};">${second.none}</span>`,
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:${BRAND_MUTED};">${label}</td><td style="color:${BRAND_INK};font-weight:600;">${
      escapeHtml(value)
    }</td></tr>`;
  const theirTime = input.timeZone && input.timeZone !== schedulerTimeZone
    ? formatLocal(input.startMs, input.timeZone)
    : "";
  // The audience's own facts, as rows (Host: what they run).
  const facts: Array<[string, string]> = input.context.audience === "creator"
    ? [["City", input.context.city], [
      "Makes",
      CREATOR_MAKES_LABELS[input.context.makes],
    ]]
    : input.context.audience === "local"
    ? [["City", input.context.city], [
      "First place",
      input.context.firstPlace ?? "none given",
    ]]
    : [["Runs", ICP_LABELS[input.context.icp]]];
  const rows = [
    host ? "" : row("Call", callLabel),
    `<tr><td style="padding:4px 12px 4px 0;color:${BRAND_MUTED};">When</td><td style="color:${BRAND_INK};font-weight:600;">${
      escapeHtml(when)
    }</td></tr>`,
    theirTime ? row("Their time", theirTime) : "",
    `<tr><td style="padding:4px 12px 4px 0;color:${BRAND_MUTED};">Who</td><td style="color:${BRAND_INK};font-weight:600;">${
      escapeHtml(input.name)
    } &lt;${escapeHtml(input.email)}&gt;</td></tr>`,
    input.venue
      ? `<tr><td style="padding:4px 12px 4px 0;color:${BRAND_MUTED};">Venue</td><td style="color:${BRAND_INK};font-weight:600;">${
        escapeHtml(input.venue)
      }</td></tr>`
      : "",
    ...facts.map(([label, value]) => row(label, value)),
    // #3601 — unconditional, matching the calendar: the origin is never blank, so
    // a blank can never be ambiguous between "came in cold" and "we lost the tag".
    `<tr><td style="padding:4px 12px 4px 0;color:${BRAND_MUTED};">Came from</td><td style="color:${BRAND_INK};font-weight:600;">${
      escapeHtml(originLabel(input.source))
    }</td></tr>`,
  ].filter(Boolean).join("");
  const links = [
    input.meetUrl ? `${emailButton(input.meetUrl, "Join the Meet")} ` : "",
    input.reportUrl
      ? `<a href="${
        escapeHtml(input.reportUrl)
      }" style="color:${BRAND_ORANGE_BUTTON};font-weight:600;">Their report</a>`
      : "",
  ].join(" ");
  const ownerBody = `
    <h1 style="margin:0 0 12px;color:${BRAND_INK};font-size:22px;">${
    host ? "New call booked" : `New ${callLabel} booked`
  } 📅</h1>
    <p style="margin:0 0 14px;font-size:15px;">${contextLinks}</p>
    <table role="presentation" style="border-collapse:collapse;font-size:15px;border-top:1px solid ${BRAND_BORDER};border-bottom:1px solid ${BRAND_BORDER};padding:8px 0;">${rows}</table>
    <p style="margin:18px 0 0;">${links}</p>`;
  const ownerText =
    (host
      ? `New Mingla call booked.\n\n`
      : `New Mingla ${callLabel} booked.\n\n`) +
    `Social: ${input.context.social.url} (${socialLabel})\n` +
    (second === null
      ? ""
      : `${second.label}: ${second.url ?? "none given"}\n`) +
    `\n` +
    `When: ${when}` + (theirTime ? `\nTheir time: ${theirTime}` : "") +
    `\nWho: ${input.name} <${input.email}>` +
    (input.venue ? `\nVenue: ${input.venue}` : "") +
    facts.map(([label, value]) => `\n${label}: ${value}`).join("") +
    `\nCame from: ${originLabel(input.source)}` +
    (input.meetUrl ? `\nMeet: ${input.meetUrl}` : "") +
    (input.reportUrl ? `\nReport: ${input.reportUrl}` : "");

  const results = await Promise.allSettled([
    sendResend({
      to: [input.email],
      subject: "You’re booked — your Mingla call",
      html: booker.html,
      text: booker.text,
      replyTo: REPLY_TO,
    }),
    sendResend({
      to: buildNotifyRecipients(input.scheduler?.notifyTo ?? NOTIFY_TO),
      // #4339 calls: the subject names a Creator or Local call; Host is unchanged.
      subject: host
        ? `New Mingla call — ${input.venue || input.name} (${when})`
        : `New Mingla call — ${callLabel}: ${input.name} (${when})`,
      html: shell(ownerBody, `${input.name} booked a call`),
      text: ownerText,
      replyTo: input.email, // reply lands on the lead
    }),
  ]);
  for (const r of results) {
    if (r.status === "rejected") {
      console.error(
        "[growth-tools-book] booking email threw",
        String(r.reason),
      );
    }
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────
async function handleSlots(
  token: string,
  profile: SchedulerProfile,
): Promise<Response> {
  const now = Date.now();
  const timeMax = new Date(
    now + (profile.lookaheadDays + 1) * 24 * 60 * 60 * 1000,
  )
    .toISOString();
  const busy = await fetchBusy(
    token,
    new Date(now).toISOString(),
    timeMax,
    profile.calendarId,
  );
  if (busy === null) return json({ error: "calendar_unavailable" }, 502);
  return json({
    slots: computeFreeSlots(busy, now, profile),
    tz: profile.timeZone,
    duration_minutes: profile.durationMinutes,
  });
}

async function handleBook(
  token: string,
  body: Record<string, unknown>,
  req: Request,
  profile: SchedulerProfile,
): Promise<Response> {
  const start = typeof body.start === "string" ? body.start : "";
  // #3601 — sanitizeLine at PARSE TIME, so the event `summary` (which interpolates
  // `venue`) is protected by the same pass as the description, without its format
  // changing. Control characters become a space; non-strings become "".
  const name = sanitizeLine(body.name, 120);
  const email = typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";
  // #4339 calls: venue and report_url belong to Host calls only.
  const hostOnly = body.audience === undefined || body.audience === null ||
    body.audience === "" || body.audience === "host";
  const venue = hostOnly ? sanitizeLine(body.venue, 120) : "";
  const reportUrl = hostOnly ? sanitizeLine(body.report_url, 500) : "";
  // #4571 W4: the host card's scheduler token (`for`), when the page sent a UUID.
  const scheduleToken = hostOnly ? parseScheduleToken(body.for) : null;
  // Optional, and never trusted from the client: the page's own 40-char cap is
  // re-applied server-side. An absent `source` renders the shared-link origin.
  const source = sanitizeLine(body.source, 40);
  const startMs = Date.parse(start);
  if (
    !Number.isFinite(startMs) || name.length < 2 || !EMAIL_RE.test(email) ||
    email.length > 254
  ) {
    return json({ error: "validation" }, 400);
  }
  // #4339 §6 — what they run and their main social are required; website is
  // optional but must be a real address when given.
  const parsedContext = parseBookingContext(body);
  if (!parsedContext.ok) {
    return json({ error: "validation", field: parsedContext.field }, 400);
  }
  const context = parsedContext.context;
  if (context.audience !== profile.audience) {
    return json({ error: "validation", field: "audience" }, 400);
  }
  // #4452 §4.6: phone (required for Creators and Locals), UTM, click source, form link, consent.
  const parsedExtras = parseBookingExtras(body, context.audience);
  if (!parsedExtras.ok) {
    return json({ error: "validation", field: parsedExtras.field }, 400);
  }
  const extras = parsedExtras.extras;
  const timeZone = parseTimeZone(body.time_zone);
  // Slot must be in the future (min notice) and land on a valid grid boundary.
  if (startMs < Date.now() + profile.minNoticeMinutes * 60_000) {
    return json({ error: "validation" }, 400);
  }
  const endMs = startMs + profile.durationMinutes * 60 * 1000;

  // Re-verify the slot is still free (avoid a double-book race).
  const busy = await fetchBusy(
    token,
    new Date(startMs).toISOString(),
    new Date(endMs).toISOString(),
    profile.calendarId,
  );
  if (busy === null) return json({ error: "calendar_unavailable" }, 502);
  if (busy.some((b) => startMs < b.end && endMs > b.start)) {
    return json({ error: "slot_taken" }, 409);
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${
      encodeURIComponent(profile.calendarId)
    }/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: buildEventSummary(context, name, venue),
        description: buildBookingDescription(
          context,
          buildEventDescription({ name, email, venue, reportUrl, source }),
        ),
        extendedProperties: {
          private: {
            ...buildPrivateProperties(context, source),
            mingla_scheduler_key: profile.key,
          },
        },
        start: { dateTime: new Date(startMs).toISOString() },
        end: { dateTime: new Date(endMs).toISOString() },
        attendees: buildAttendees(email, name),
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        reminders: { useDefault: true },
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(
      "[growth-tools-book] events.insert failed",
      res.status,
      detail.slice(0, 200),
    );
    if (res.status === 409) return json({ error: "slot_taken" }, 409);
    return json({ error: "calendar_unavailable" }, 502);
  }
  const ev = await res.json() as {
    id?: string;
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: { uri?: string }[] };
  };
  const meet = ev.hangoutLink ??
    ev.conferenceData?.entryPoints?.find((e) => e.uri)?.uri ?? null;

  // #4339 round A — the booking becomes an Inbound lead in Mingla Admin. Awaited
  // so the write completes before the isolate is frozen; it never fails the
  // booking (recordBookingLead never throws and logs every failure loudly).
  const leadConfig = {
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  };
  // #4452 §4.6 A: a booking from a form links to it only with the same email within 7 days.
  const formLink = await resolveFormLink(
    extras.formSubmissionId,
    email,
    leadConfig,
  );
  const leadRow = buildBookingLead({
    eventId: ev.id ?? null,
    startMs,
    name,
    email,
    venue,
    source,
    context,
    timeZone,
    meetUrl: meet,
    eventUrl: ev.htmlLink ?? null,
    extras,
    formSubmissionId: formLink?.id ?? null,
    schedulerKey: profile.key,
  });
  const leadWrite = await recordBookingLead(leadRow, leadConfig);
  // #4571 W4: a booking from a host card's own link links itself to that card.
  // Awaited, never fails the booking; the booker is never told either way.
  if (scheduleToken && leadWrite === "written") {
    await linkDemoFromToken(leadRow.booking_key, scheduleToken, leadConfig);
  }
  if (
    leadWrite === "written" &&
    !(await startBookingLifecycle(leadRow.booking_key, leadConfig))
  ) {
    console.error(
      "[growth-tools-book] BOOKING LIFECYCLE FAILED for booking",
      leadRow.booking_key,
    );
  }

  // #4452 §4.6 (was #4238 W3-3 host-only): every audience's booking is a
  // labelled Lead (unless the form already fired it) and a call_booked goal.
  // The ad context is read for every audience now. Never fails the booking.
  const ad = parseHostAdContext(body.ad, req);
  const conversions = leadWrite === "written"
    ? await recordBookingConversions(
      leadRow.booking_key,
      context.audience,
      ad,
      formLink,
      leadConfig,
    )
    : { leadEventId: null, goalEventId: null };
  const leadEventId = conversions.leadEventId;

  // Confirmation to the booker + notification to Seth. Best-effort and awaited
  // so the sends complete before the isolate is frozen; never fails the booking.
  await sendBookingEmails({
    startMs,
    name,
    email,
    venue,
    reportUrl,
    source,
    context,
    timeZone,
    meetUrl: meet,
    eventUrl: ev.htmlLink ?? null,
    scheduler: profile,
  });
  if (body.handoff_token) {
    await markBookingHandoffUsed(body.handoff_token, leadConfig);
  }

  return json({
    ok: true,
    event_url: ev.htmlLink ?? null,
    meet_url: meet,
    start: new Date(startMs).toISOString(),
    lead_event_id: leadEventId,
    goal_event_id: conversions.goalEventId,
  });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  } catch {
    return json({ error: "validation" }, 400);
  }

  const profileConfig = {
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    defaultCalendarId: CALENDAR_ID,
  };
  const requestedKey = schedulerKey(body.scheduler_key, body.audience);
  if (body.action === "handoff") {
    const handoff = await resolveBookingHandoff(
      body.handoff_token,
      requestedKey,
      profileConfig,
    );
    if (!handoff) return json({ error: "handoff_expired" }, 410);
    return json({
      ok: true,
      scheduler: {
        key: handoff.scheduler.key,
        name: handoff.scheduler.name,
        audience: handoff.scheduler.audience,
        duration_minutes: handoff.scheduler.durationMinutes,
      },
      payload: handoff.payload,
    });
  }

  let bookingBody = body;
  let profile: SchedulerProfile | null = null;
  if (body.action === "book" && body.handoff_token) {
    const handoff = await resolveBookingHandoff(
      body.handoff_token,
      requestedKey,
      profileConfig,
    );
    if (!handoff) return json({ error: "handoff_expired" }, 410);
    bookingBody = mergeBookingHandoff(body, handoff);
    profile = handoff.scheduler;
  } else {
    profile = await loadSchedulerProfile(requestedKey, profileConfig) ??
      legacySchedulerProfile(requestedKey, profileConfig);
  }
  if (!profile) return json({ error: "booking_unconfigured" }, 503);

  const token = await getAccessToken();
  if (!token) {
    // Keys not configured yet (Seth hasn't minted the refresh token) or refresh
    // failed. The UI hides the picker on this signal.
    return json({ error: "booking_unconfigured" }, 503);
  }

  try {
    if (body.action === "slots") return await handleSlots(token, profile);
    if (body.action === "book") {
      return await handleBook(token, bookingBody, req, profile);
    }
    return json({ error: "validation" }, 400);
  } catch (err) {
    console.error(
      "[growth-tools-book] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "server" }, 500);
  }
}

if (import.meta.main) {
  serve(handler);
}
