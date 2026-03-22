// HOLIDAY REMINDER (Block 3 Pass 2 — hardened 2026-03-21)
// Cron-triggered daily at 9 AM UTC. Scans custom_holidays for tomorrow's dates
// (per-user timezone). Dispatches via notify-dispatch (preferences + quiet hours).
// Cloned from notify-calendar-reminder pattern.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callNotifyDispatch(
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const notifyUrl = `${supabaseUrl}/functions/v1/notify-dispatch`;
  const response = await fetch(notifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown");
    console.warn("[notify-holiday-reminder] notify-dispatch error:", response.status, errText);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Auth: service role only (cron-triggered) ─────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
      return jsonResponse({ error: "Unauthorized — service role required" }, 401);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // ── Fetch all custom holidays with user timezone + person name ───────
    // PostgREST can't do per-row timezone math, so we fetch all holidays
    // and filter in JS. The table is small (user-created holidays only).
    const { data: allHolidays, error: queryError } = await supabaseAdmin
      .from("custom_holidays")
      .select(`
        id,
        user_id,
        name,
        month,
        day,
        year,
        person_id,
        saved_people(display_name),
        profiles!custom_holidays_user_id_fkey(timezone)
      `);

    if (queryError) {
      console.error("[notify-holiday-reminder] Query error:", queryError);
      return jsonResponse({ error: "Failed to query custom holidays" }, 500);
    }

    if (!allHolidays || allHolidays.length === 0) {
      return jsonResponse({ success: true, processed: 0, sent: 0, errors: 0 });
    }

    // ── Filter for tomorrow in each user's timezone ─────────────────────
    const now = new Date();
    let sent = 0;
    let errors = 0;

    for (const holiday of allHolidays) {
      const userTz = (holiday.profiles as any)?.timezone || "America/New_York";

      // Compute "tomorrow" in the user's timezone
      let tomorrowMonth: number;
      let tomorrowDay: number;
      let tomorrowYear: number;
      try {
        const formatter = new Intl.DateTimeFormat("en-CA", {
          timeZone: userTz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const todayParts = formatter.formatToParts(now);
        const y = parseInt(todayParts.find(p => p.type === "year")!.value, 10);
        const m = parseInt(todayParts.find(p => p.type === "month")!.value, 10);
        const d = parseInt(todayParts.find(p => p.type === "day")!.value, 10);

        // Add 1 day using Date arithmetic (handles month/year rollover)
        const tomorrow = new Date(y, m - 1, d + 1);
        tomorrowMonth = tomorrow.getMonth() + 1;
        tomorrowDay = tomorrow.getDate();
        tomorrowYear = tomorrow.getFullYear();
      } catch {
        // Fallback to UTC+1 day if timezone is invalid
        const utcTomorrow = new Date(now);
        utcTomorrow.setUTCDate(utcTomorrow.getUTCDate() + 1);
        tomorrowMonth = utcTomorrow.getUTCMonth() + 1;
        tomorrowDay = utcTomorrow.getUTCDate();
        tomorrowYear = utcTomorrow.getUTCFullYear();
      }

      // Match month + day
      if (holiday.month !== tomorrowMonth || holiday.day !== tomorrowDay) {
        continue;
      }

      // Year check: if year is set, only match that specific year
      if (holiday.year !== null && holiday.year !== tomorrowYear) {
        continue;
      }

      // Build idempotency date string
      const tomorrowDateString = `${tomorrowYear}-${String(tomorrowMonth).padStart(2, "0")}-${String(tomorrowDay).padStart(2, "0")}`;

      // Person name (LEFT JOIN — may be null if person was deleted)
      const personName = (holiday.saved_people as any)?.display_name || null;

      // Dispatch sequentially to avoid overwhelming notify-dispatch
      try {
        await callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          userId: holiday.user_id,
          type: "holiday_reminder",
          title: personName
            ? `Tomorrow is ${personName}'s ${holiday.name}!`
            : `Tomorrow: ${holiday.name}`,
          body: "Don't forget to plan something special.",
          data: {
            deepLink: "mingla://discover",
            personId: holiday.person_id,
            holidayId: holiday.id,
          },
          actorId: null,
          relatedId: holiday.id,
          relatedType: "custom_holiday",
          idempotencyKey: `holiday_reminder:${holiday.id}:${tomorrowDateString}`,
          pushOverrides: {
            androidChannelId: "reminders",
          },
        });
        sent++;
      } catch (err) {
        console.warn("[notify-holiday-reminder] Dispatch failed for holiday:", holiday.id, err);
        errors++;
      }
    }

    return jsonResponse({
      success: true,
      processed: allHolidays.length,
      sent,
      errors,
    });
  } catch (err: unknown) {
    console.error("[notify-holiday-reminder] Unhandled error:", err);
    return jsonResponse({ error: (err as Error).message || "Internal server error" }, 500);
  }
});
