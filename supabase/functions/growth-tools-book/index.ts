// ISSUE-1078 [Venue Website Grader] — real Google Calendar booking.
//
// PUBLIC edge function (verify_jwt=false). Lets a venue owner book a call on
// seth@usemingla.com's calendar straight from the report — no back-and-forth.
// Uses an OAuth REFRESH TOKEN (calendar scope) minted for seth@ via the OAuth
// Playground on the existing mingla-ads-engine client — NOT a service account,
// NOT Workspace domain-wide delegation. Two actions:
//
//   POST {action:"slots"}                → {slots:[{start,end}]} (UTC ISO)
//   POST {action:"book", start, name, email, venue?, report_url?}
//                                        → {ok:true, event_url, meet_url, start}
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
import { escapeHtml } from "../_shared/email/escape.ts";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
} from "../_shared/email/senders.ts";
import { minglaLogoUrl } from "../_shared/brandAssets.ts";
import { resolveRuntimeString } from "../_shared/runtimeConfig.ts";

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
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
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
function tzYmd(date: Date, tz: string): { y: number; mo: number; d: number; wd: number } {
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
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    y: Number(p.year),
    mo: Number(p.month),
    d: Number(p.day),
    wd: wdMap[p.weekday] ?? 0,
  };
}

// ── Google OAuth (refresh token → access token) ──────────────────────────────
function calendarKeys(): { clientId: string; clientSecret: string; refresh: string } | null {
  const packed = Deno.env.get("GOOGLE_CALENDAR_KEYS") ?? "";
  const parts = packed.split("|");
  if (parts.length !== 3 || parts.some((s) => s.length === 0)) return null;
  return { clientId: parts[0], clientSecret: parts[1], refresh: parts[2] };
}

async function getAccessToken(): Promise<string | null> {
  const keys = calendarKeys();
  if (!keys) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: keys.clientId,
      client_secret: keys.clientSecret,
      refresh_token: keys.refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.error("[growth-tools-book] token refresh failed", res.status);
    return null;
  }
  const body = await res.json() as { access_token?: string };
  return body.access_token ?? null;
}

interface Busy {
  start: number;
  end: number;
}

async function fetchBusy(
  token: string,
  timeMinIso: string,
  timeMaxIso: string,
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
      items: [{ id: CALENDAR_ID }],
    }),
  });
  if (!res.ok) {
    console.error("[growth-tools-book] freeBusy failed", res.status);
    return null;
  }
  const body = await res.json() as {
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  };
  const busyRaw = body.calendars?.[CALENDAR_ID]?.busy ?? [];
  return busyRaw.map((b) => ({
    start: Date.parse(b.start),
    end: Date.parse(b.end),
  }));
}

function computeFreeSlots(busy: Busy[], now: number): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];
  const earliest = now + MIN_NOTICE_MS;
  // Cap by DISTINCT open days, not a flat slot count: a flat cap fills up on the
  // first free day (15h × 20-min ≈ 44 slots) and hides the rest of the month.
  let openDays = 0;
  for (let dayOffset = 0; dayOffset <= LOOKAHEAD_DAYS; dayOffset++) {
    const dayInstant = new Date(now + dayOffset * 24 * 60 * 60 * 1000);
    const { y, mo, d, wd } = tzYmd(dayInstant, TZ);
    if (wd === 0 || wd === 6) continue; // weekends off
    let dayHasSlot = false;
    for (let m = WORK_START_MIN; m + SLOT_MIN <= WORK_END_MIN; m += SLOT_MIN) {
      const startMs = wallToUtc(y, mo, d, Math.floor(m / 60), m % 60, TZ);
      const endMs = startMs + SLOT_MIN * 60 * 1000;
      if (startMs < earliest) continue;
      const overlaps = busy.some((b) => startMs < b.end && endMs > b.start);
      if (overlaps) continue;
      if (!dayHasSlot) {
        if (openDays >= MAX_DAYS) return slots; // month is full — stop
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
function formatLocal(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ms));
}

const { BRAND_ORANGE_BUTTON, BRAND_INK, BRAND_MUTED, BRAND_BORDER } = SHELL_TOKENS;

function emailButton(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${BRAND_ORANGE_BUTTON};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:9999px;font-size:15px;">${escapeHtml(label)}</a>`;
}

async function sendResend(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo: string;
}): Promise<boolean> {
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!resendKey) {
    console.error("[growth-tools-book] RESEND_API_KEY missing — skipping email");
    return false;
  }
  // #1154 — the growth-tools funnel gets its own no-reply identity instead of the
  // shared `system` sender (a payments@ identity in prod). reply_to below still
  // routes replies (to the lead / support@).
  const sender = EMAIL_SENDERS.noreply;
  try {
    assertNotResendSandbox(sender);
  } catch (e) {
    console.error("[growth-tools-book] sandbox sender rejected", String(e));
    return false;
  }
  // no-attachment: booking confirmation/notification is plain transactional HTML.
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: formatSenderHeader(sender),
      to: [input.to],
      reply_to: input.replyTo,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[growth-tools-book] resend failed", res.status, detail.slice(0, 160));
    return false;
  }
  return true;
}

// Fire both emails. Never throws — a mail failure must not fail the booking
// (the Google Calendar invite has already gone out via sendUpdates=all).
async function sendBookingEmails(input: {
  startMs: number;
  name: string;
  email: string;
  venue: string;
  reportUrl: string;
  meetUrl: string | null;
  eventUrl: string | null;
}): Promise<void> {
  const when = formatLocal(input.startMs);
  const logo = minglaLogoUrl();
  const shell = (bodyHtml: string, preheader: string) =>
    renderShell({
      preheader,
      bodyHtml,
      supportEmail: Deno.env.get("SUPPORT_EMAIL") ?? REPLY_TO,
      logoUrl: logo,
      footerAddress: resolveRuntimeString("mingla_footer_address", "MINGLA_FOOTER_ADDRESS") ??
        "Mingla, hello@usemingla.com",
    });
  const meetBtn = input.meetUrl
    ? `<p style="margin:20px 0 0;">${emailButton(input.meetUrl, "Join the Google Meet")}</p>`
    : "";

  // 1) Confirmation to the booker.
  const bookerBody = `
    <h1 style="margin:0 0 8px;color:${BRAND_INK};font-size:22px;">You’re booked in ✅</h1>
    <p style="margin:0 0 4px;color:${BRAND_INK};font-size:16px;">Your call with Mingla is confirmed for:</p>
    <p style="margin:0 0 8px;color:${BRAND_INK};font-size:18px;font-weight:700;">${escapeHtml(when)}</p>
    <p style="margin:0;color:${BRAND_MUTED};font-size:14px;">A Google Calendar invite with the Meet link is also on its way. Reply to this email if you need to move it.</p>
    ${meetBtn}`;
  const bookerText =
    `You're booked in.\n\nYour call with Mingla is confirmed for ${when}.\n` +
    `A Google Calendar invite with the Meet link is on its way.` +
    (input.meetUrl ? `\n\nMeet: ${input.meetUrl}` : "");

  // 2) Notification to Seth — reply-to is the lead so a reply reaches them.
  const rows = [
    `<tr><td style="padding:4px 12px 4px 0;color:${BRAND_MUTED};">When</td><td style="color:${BRAND_INK};font-weight:600;">${escapeHtml(when)}</td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:${BRAND_MUTED};">Who</td><td style="color:${BRAND_INK};font-weight:600;">${escapeHtml(input.name)} &lt;${escapeHtml(input.email)}&gt;</td></tr>`,
    input.venue
      ? `<tr><td style="padding:4px 12px 4px 0;color:${BRAND_MUTED};">Venue</td><td style="color:${BRAND_INK};font-weight:600;">${escapeHtml(input.venue)}</td></tr>`
      : "",
  ].filter(Boolean).join("");
  const links = [
    input.meetUrl ? `${emailButton(input.meetUrl, "Join the Meet")} ` : "",
    input.reportUrl
      ? `<a href="${escapeHtml(input.reportUrl)}" style="color:${BRAND_ORANGE_BUTTON};font-weight:600;">Their report</a>`
      : "",
  ].join(" ");
  const ownerBody = `
    <h1 style="margin:0 0 12px;color:${BRAND_INK};font-size:22px;">New call booked 📅</h1>
    <table style="border-collapse:collapse;font-size:15px;border-top:1px solid ${BRAND_BORDER};border-bottom:1px solid ${BRAND_BORDER};padding:8px 0;">${rows}</table>
    <p style="margin:18px 0 0;">${links}</p>`;
  const ownerText =
    `New Mingla call booked.\n\nWhen: ${when}\nWho: ${input.name} <${input.email}>` +
    (input.venue ? `\nVenue: ${input.venue}` : "") +
    (input.meetUrl ? `\nMeet: ${input.meetUrl}` : "") +
    (input.reportUrl ? `\nReport: ${input.reportUrl}` : "");

  const results = await Promise.allSettled([
    sendResend({
      to: input.email,
      subject: "You’re booked — your Mingla call",
      html: shell(bookerBody, `Confirmed: ${when}`),
      text: bookerText,
      replyTo: REPLY_TO,
    }),
    sendResend({
      to: NOTIFY_TO,
      subject: `New Mingla call — ${input.venue || input.name} (${when})`,
      html: shell(ownerBody, `${input.name} booked a call`),
      text: ownerText,
      replyTo: input.email, // reply lands on the lead
    }),
  ]);
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("[growth-tools-book] booking email threw", String(r.reason));
    }
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────
async function handleSlots(token: string): Promise<Response> {
  const now = Date.now();
  const timeMax = new Date(now + (LOOKAHEAD_DAYS + 1) * 24 * 60 * 60 * 1000)
    .toISOString();
  const busy = await fetchBusy(token, new Date(now).toISOString(), timeMax);
  if (busy === null) return json({ error: "calendar_unavailable" }, 502);
  return json({ slots: computeFreeSlots(busy, now), tz: TZ });
}

async function handleBook(
  token: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const start = typeof body.start === "string" ? body.start : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const email = typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";
  const venue = typeof body.venue === "string" ? body.venue.trim().slice(0, 120) : "";
  const reportUrl = typeof body.report_url === "string"
    ? body.report_url.trim().slice(0, 500)
    : "";
  const startMs = Date.parse(start);
  if (
    !Number.isFinite(startMs) || name.length < 2 || !EMAIL_RE.test(email) ||
    email.length > 254
  ) {
    return json({ error: "validation" }, 400);
  }
  // Slot must be in the future (min notice) and land on a valid grid boundary.
  if (startMs < Date.now() + MIN_NOTICE_MS) {
    return json({ error: "validation" }, 400);
  }
  const endMs = startMs + SLOT_MIN * 60 * 1000;

  // Re-verify the slot is still free (avoid a double-book race).
  const busy = await fetchBusy(
    token,
    new Date(startMs).toISOString(),
    new Date(endMs).toISOString(),
  );
  if (busy === null) return json({ error: "calendar_unavailable" }, 502);
  if (busy.some((b) => startMs < b.end && endMs > b.start)) {
    return json({ error: "slot_taken" }, 409);
  }

  const descLines = [
    `Intro call booked from the Mingla Venue Website Grader.`,
    venue ? `Venue: ${venue}` : "",
    `Booked by: ${name} (${email})`,
    reportUrl ? `Their report: ${reportUrl}` : "",
  ].filter(Boolean);

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${
      encodeURIComponent(CALENDAR_ID)
    }/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: `Mingla call${venue ? ` — ${venue}` : ""}`,
        description: descLines.join("\n"),
        start: { dateTime: new Date(startMs).toISOString() },
        end: { dateTime: new Date(endMs).toISOString() },
        attendees: [{ email, displayName: name }],
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
    console.error("[growth-tools-book] events.insert failed", res.status, detail.slice(0, 200));
    if (res.status === 409) return json({ error: "slot_taken" }, 409);
    return json({ error: "calendar_unavailable" }, 502);
  }
  const ev = await res.json() as {
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: { uri?: string }[] };
  };
  const meet = ev.hangoutLink ??
    ev.conferenceData?.entryPoints?.find((e) => e.uri)?.uri ?? null;

  // Confirmation to the booker + notification to Seth. Best-effort and awaited
  // so the sends complete before the isolate is frozen; never fails the booking.
  await sendBookingEmails({
    startMs,
    name,
    email,
    venue,
    reportUrl,
    meetUrl: meet,
    eventUrl: ev.htmlLink ?? null,
  });

  return json({
    ok: true,
    event_url: ev.htmlLink ?? null,
    meet_url: meet,
    start: new Date(startMs).toISOString(),
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

  const token = await getAccessToken();
  if (!token) {
    // Keys not configured yet (Seth hasn't minted the refresh token) or refresh
    // failed. The UI hides the picker on this signal.
    return json({ error: "booking_unconfigured" }, 503);
  }

  try {
    if (body.action === "slots") return await handleSlots(token);
    if (body.action === "book") return await handleBook(token, body);
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
