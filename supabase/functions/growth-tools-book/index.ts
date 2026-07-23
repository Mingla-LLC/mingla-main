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
// (default "primary"). Bookable Mon–Fri 10:00–17:00 in BOOKING_TZ, 20-min
// slots, 12h min notice, 10 days ahead.
//
// → 400 {error:"validation"} | 409 {error:"slot_taken"} | 502 {error:"calendar_unavailable"}
//   500 {error:"server"} · OPTIONS → 200 "ok" + CORS

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Booking config ───────────────────────────────────────────────────────────
const TZ = Deno.env.get("BOOKING_TZ") ?? "America/New_York";
const CALENDAR_ID = Deno.env.get("BOOKING_CALENDAR_ID") ?? "primary";
const WORK_START_MIN = 10 * 60; // 10:00 local
const WORK_END_MIN = 17 * 60; // 17:00 local (last slot starts 16:40)
const SLOT_MIN = 20;
const MIN_NOTICE_MS = 12 * 60 * 60 * 1000; // 12h
const LOOKAHEAD_DAYS = 10;
const MAX_SLOTS = 30;
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
  for (let dayOffset = 0; dayOffset <= LOOKAHEAD_DAYS; dayOffset++) {
    const dayInstant = new Date(now + dayOffset * 24 * 60 * 60 * 1000);
    const { y, mo, d, wd } = tzYmd(dayInstant, TZ);
    if (wd === 0 || wd === 6) continue; // weekends off
    for (let m = WORK_START_MIN; m + SLOT_MIN <= WORK_END_MIN; m += SLOT_MIN) {
      const startMs = wallToUtc(y, mo, d, Math.floor(m / 60), m % 60, TZ);
      const endMs = startMs + SLOT_MIN * 60 * 1000;
      if (startMs < earliest) continue;
      const overlaps = busy.some((b) => startMs < b.end && endMs > b.start);
      if (overlaps) continue;
      slots.push({
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
      });
      if (slots.length >= MAX_SLOTS) return slots;
    }
  }
  return slots;
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
