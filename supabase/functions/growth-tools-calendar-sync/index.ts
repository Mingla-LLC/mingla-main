// #4339 calendar sync (Seth approved, 9 Nov 2026) — reads the booking
// calendar's changes back so a booked call (Host, Creator or Local) that is
// moved or cancelled updates on the admin Calendar. The design, privacy and
// auth are in ./sync.ts.
//
// CRON ONLY: pg_cron job `issue_4339_book_call_calendar_sync` (every 5
// minutes, migration 20280520004339) posts {} with the vault service_role_key
// as the bearer. verify_jwt = true at the gateway, and the bearer is compared
// to SUPABASE_SERVICE_ROLE_KEY in code; any other caller is 401.
//
// Env: GOOGLE_CALENDAR_KEYS (the same governed bundle as growth-tools-book),
// RESEND_API_KEY, and the non-secret BOOKING_CALENDAR_ID (default "primary"),
// BOOKING_NOTIFY_TO (default seth@usemingla.com) and BOOKING_TZ (default
// America/New_York), all as growth-tools-book reads them.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  handleCalendarRegistrySync,
  loadCalendarSyncProfiles,
  restSyncDb,
} from "./sync.ts";

export async function handler(req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const defaultCalendarId = Deno.env.get("BOOKING_CALENDAR_ID") ?? "primary";
  const defaultNotifyTo = Deno.env.get("BOOKING_NOTIFY_TO") ??
    "seth@usemingla.com";
  const defaultTimeZone = Deno.env.get("BOOKING_TZ") ?? "America/New_York";
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  if (
    !serviceKey || req.headers.get("authorization") !== `Bearer ${serviceKey}`
  ) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const profiles = await loadCalendarSyncProfiles({
    supabaseUrl,
    serviceKey,
    defaultCalendarId,
    defaultNotifyTo,
    defaultTimeZone,
  });
  return await handleCalendarRegistrySync(req, {
    serviceRoleKey: serviceKey,
    calendarKeysPacked: Deno.env.get("GOOGLE_CALENDAR_KEYS") ?? "",
    profiles,
    db: restSyncDb(supabaseUrl, serviceKey),
    resendKey,
  });
}

if (import.meta.main) {
  serve(handler);
}
