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
    console.warn("[notify-calendar-reminder] notify-dispatch error:", response.status, errText);
  }
}

/**
 * Extracts a human-readable time string from a TIMESTAMPTZ scheduled_at value,
 * formatted in the user's local timezone.
 * Returns e.g. " at 2:30 PM" or "" if no meaningful time is present.
 */
function formatTimeClause(scheduledAt: string, timezone: string | null): string {
  try {
    const tz = timezone || "America/New_York";
    const date = new Date(scheduledAt);
    // Check if time is midnight UTC — may mean "no specific time"
    if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0) return "";
    const formatted = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });
    return ` at ${formatted}`;
  } catch {
    return "";
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

    const body = await req.json();
    const { reminderType } = body as { reminderType: "tomorrow" | "today" | "feedback" };

    if (!["tomorrow", "today", "feedback"].includes(reminderType)) {
      return jsonResponse({ error: "reminderType must be 'tomorrow', 'today', or 'feedback'" }, 400);
    }

    // ── Compute target date (UTC) ────────────────────────────────────────
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0]; // YYYY-MM-DD

    const tomorrowDate = new Date(now);
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
    const tomorrowStr = tomorrowDate.toISOString().split("T")[0];

    let notified = 0;

    if (reminderType === "tomorrow") {
      // Query calendar entries scheduled for tomorrow, join with profiles for timezone
      const { data: entries, error } = await supabaseAdmin
        .from("calendar_entries")
        .select("id, user_id, card_data, scheduled_at, profiles:user_id(timezone)")
        .gte("scheduled_at", `${tomorrowStr}T00:00:00Z`)
        .lt("scheduled_at", `${tomorrowStr}T23:59:59Z`)
        .in("status", ["pending", "confirmed"]);

      if (error) {
        console.error("[notify-calendar-reminder] Query error:", error);
        return jsonResponse({ error: "Failed to query calendar entries" }, 500);
      }

      if (!entries || entries.length === 0) {
        return jsonResponse({ success: true, notified: 0 });
      }

      const dispatches = entries.map((entry: any) => {
        const experienceName =
          entry.card_data?.title || entry.card_data?.name || "your experience";
        const userTz = entry.profiles?.timezone || null;
        const timeClause = formatTimeClause(entry.scheduled_at, userTz);

        return callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          userId: entry.user_id,
          type: "calendar_reminder_tomorrow",
          title: `Tomorrow: ${experienceName}`,
          body: `Don't forget — ${experienceName} is tomorrow${timeClause}.`,
          data: { deepLink: `mingla://calendar/${entry.id}` },
          idempotencyKey: `cal_tomorrow:${entry.id}`,
          pushOverrides: {
            androidChannelId: "reminders",
          },
        });
      });

      await Promise.allSettled(dispatches);
      notified = entries.length;
    }

    if (reminderType === "today") {
      const { data: entries, error } = await supabaseAdmin
        .from("calendar_entries")
        .select("id, user_id, card_data, scheduled_at, profiles:user_id(timezone)")
        .gte("scheduled_at", `${todayStr}T00:00:00Z`)
        .lt("scheduled_at", `${todayStr}T23:59:59Z`)
        .in("status", ["pending", "confirmed"]);

      if (error) {
        console.error("[notify-calendar-reminder] Query error:", error);
        return jsonResponse({ error: "Failed to query calendar entries" }, 500);
      }

      if (!entries || entries.length === 0) {
        return jsonResponse({ success: true, notified: 0 });
      }

      const dispatches = entries.map((entry: any) => {
        const experienceName =
          entry.card_data?.title || entry.card_data?.name || "your experience";
        const userTz = entry.profiles?.timezone || null;
        const timeClause = formatTimeClause(entry.scheduled_at, userTz);

        return callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          userId: entry.user_id,
          type: "calendar_reminder_today",
          title: `Today: ${experienceName}`,
          body: `Enjoy your experience${timeClause}!`,
          data: { deepLink: `mingla://calendar/${entry.id}` },
          idempotencyKey: `cal_today:${entry.id}`,
          pushOverrides: {
            androidChannelId: "reminders",
          },
        });
      });

      await Promise.allSettled(dispatches);
      notified = entries.length;
    }

    if (reminderType === "feedback") {
      // Entries scheduled today that don't have feedback yet
      const { data: entries, error } = await supabaseAdmin
        .from("calendar_entries")
        .select("id, user_id, card_data, card_id")
        .gte("scheduled_at", `${todayStr}T00:00:00Z`)
        .lt("scheduled_at", `${todayStr}T23:59:59Z`)
        .in("status", ["pending", "confirmed", "completed"]);

      if (error) {
        console.error("[notify-calendar-reminder] Query error:", error);
        return jsonResponse({ error: "Failed to query calendar entries" }, 500);
      }

      if (!entries || entries.length === 0) {
        return jsonResponse({ success: true, notified: 0 });
      }

      // Check which entries already have feedback in experience_feedback
      const cardIds = entries
        .map((e) => e.card_id)
        .filter(Boolean) as string[];

      const userIds = entries.map((e) => e.user_id);

      // Build a set of user_id:card_id combos that already have feedback
      const feedbackSet = new Set<string>();
      if (cardIds.length > 0) {
        const { data: feedbacks } = await supabaseAdmin
          .from("experience_feedback")
          .select("user_id, card_id")
          .in("card_id", cardIds)
          .in("user_id", userIds);

        if (feedbacks) {
          for (const fb of feedbacks) {
            feedbackSet.add(`${fb.user_id}:${fb.card_id}`);
          }
        }
      }

      const entriesToNotify = entries.filter(
        (entry) => !entry.card_id || !feedbackSet.has(`${entry.user_id}:${entry.card_id}`)
      );

      if (entriesToNotify.length === 0) {
        return jsonResponse({ success: true, notified: 0 });
      }

      const dispatches = entriesToNotify.map((entry) => {
        const experienceName =
          entry.card_data?.title || entry.card_data?.name || "your experience";
        // Use card_id as experience_id for the deep link
        const experienceId = entry.card_id || entry.id;

        return callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          userId: entry.user_id,
          type: "visit_feedback_prompt",
          title: `How was ${experienceName}?`,
          body: "Leave a quick review — it helps your future recommendations.",
          data: { deepLink: `mingla://review/${experienceId}` },
          idempotencyKey: `feedback_prompt:${entry.id}`,
          pushOverrides: {
            androidChannelId: "reminders",
          },
        });
      });

      await Promise.allSettled(dispatches);
      notified = entriesToNotify.length;
    }

    return jsonResponse({ success: true, notified });
  } catch (err: unknown) {
    console.error("[notify-calendar-reminder] Unhandled error:", err);
    return jsonResponse({ error: (err as Error).message || "Internal server error" }, 500);
  }
});
