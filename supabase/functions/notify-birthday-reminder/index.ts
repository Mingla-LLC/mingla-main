// BIRTHDAY REMINDER (ORCH-0402)
// Cron-triggered daily at 9 AM UTC. Scans pairings + profiles for upcoming
// birthdays. Dispatches push notifications at 5 milestones: 3 months,
// 1 month, 1 week, 1 day before, and day-of.
// Both users in a pairing get reminded about the other's birthday.

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

/** Milestone days-before-birthday that trigger a push notification. */
const MILESTONES = [91, 30, 7, 1, 0] as const;

/** Human-readable label for each milestone (used in notification copy). */
function milestoneLabel(days: number): string {
  switch (days) {
    case 91: return "3 months";
    case 30: return "1 month";
    case 7: return "1 week";
    case 1: return "tomorrow";
    case 0: return "today";
    default: return `${days} days`;
  }
}

/** Build notification title + body for a birthday milestone. */
function buildNotification(
  partnerName: string,
  days: number,
): { title: string; body: string } {
  if (days === 0) {
    return {
      title: `Happy Birthday to ${partnerName}! 🎂`,
      body: "Today's the day — make it special!",
    };
  }
  if (days === 1) {
    return {
      title: `${partnerName}'s birthday is tomorrow! 🎁`,
      body: "Last chance to plan something special.",
    };
  }
  return {
    title: `${partnerName}'s birthday is in ${milestoneLabel(days)}!`,
    body: "Start planning something special.",
  };
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
    console.warn("[notify-birthday-reminder] notify-dispatch error:", response.status, errText);
  }
}

/**
 * Compute days until the next occurrence of month/day in a given timezone.
 * Returns 0 if today IS the birthday.
 */
function daysUntilInTimezone(
  month: number,
  day: number,
  timezone: string,
): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const y = parseInt(parts.find((p) => p.type === "year")!.value, 10);
  const m = parseInt(parts.find((p) => p.type === "month")!.value, 10);
  const d = parseInt(parts.find((p) => p.type === "day")!.value, 10);

  // Today in the user's local calendar (midnight-aligned)
  const today = new Date(y, m - 1, d);

  // Birthday this year
  let birthdayThisYear = new Date(y, month - 1, day);

  // If already passed this year, use next year
  if (birthdayThisYear < today) {
    birthdayThisYear = new Date(y + 1, month - 1, day);
  }

  return Math.round(
    (birthdayThisYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
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

    // ── Fetch all active pairings with both users' profiles ─────────────
    const { data: pairings, error: queryError } = await supabaseAdmin
      .from("pairings")
      .select(`
        id,
        user_a_id,
        user_b_id,
        profile_a:profiles!pairings_user_a_id_fkey(id, display_name, first_name, birthday, timezone),
        profile_b:profiles!pairings_user_b_id_fkey(id, display_name, first_name, birthday, timezone)
      `);

    if (queryError) {
      console.error("[notify-birthday-reminder] Query error:", queryError);
      return jsonResponse({ error: "Failed to query pairings" }, 500);
    }

    if (!pairings || pairings.length === 0) {
      return jsonResponse({ success: true, processed: 0, sent: 0, errors: 0 });
    }

    let sent = 0;
    let errors = 0;
    let processed = 0;

    for (const pairing of pairings) {
      const profileA = pairing.profile_a as any;
      const profileB = pairing.profile_b as any;

      // Process both directions: A gets reminded about B's birthday, B about A's
      const directions = [
        { recipient: profileA, birthdayOwner: profileB },
        { recipient: profileB, birthdayOwner: profileA },
      ];

      for (const { recipient, birthdayOwner } of directions) {
        if (!birthdayOwner?.birthday || !recipient?.id) continue;
        processed++;

        // Parse birthday DATE (YYYY-MM-DD)
        const [, monthStr, dayStr] = birthdayOwner.birthday.split("-");
        const bMonth = parseInt(monthStr, 10);
        const bDay = parseInt(dayStr, 10);
        if (isNaN(bMonth) || isNaN(bDay)) continue;

        const recipientTz = recipient.timezone || "America/New_York";
        let daysUntil: number;
        try {
          daysUntil = daysUntilInTimezone(bMonth, bDay, recipientTz);
        } catch {
          // Fallback to UTC if timezone is invalid
          const now = new Date();
          const today = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
          let bd = new Date(now.getUTCFullYear(), bMonth - 1, bDay);
          if (bd < today) bd = new Date(now.getUTCFullYear() + 1, bMonth - 1, bDay);
          daysUntil = Math.round((bd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        }

        // Check if today matches any milestone
        if (!MILESTONES.includes(daysUntil as typeof MILESTONES[number])) continue;

        const partnerName = birthdayOwner.first_name || birthdayOwner.display_name || "your partner";
        const { title, body } = buildNotification(partnerName, daysUntil);

        // Year for idempotency (so same milestone fires again next year)
        const now = new Date();
        const year = now.getUTCFullYear();

        try {
          await callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            userId: recipient.id,
            type: "birthday_reminder",
            title,
            body,
            data: {
              deepLink: "mingla://discover",
              partnerId: birthdayOwner.id,
              pairingId: pairing.id,
              milestone: daysUntil,
            },
            actorId: null,
            relatedId: pairing.id,
            relatedType: "pairing",
            idempotencyKey: `birthday_reminder:${recipient.id}:${birthdayOwner.id}:${daysUntil}d:${year}`,
            pushOverrides: {
              androidChannelId: "reminders",
              threadId: `birthday_${birthdayOwner.id}`,
            },
          });
          sent++;
        } catch (err) {
          console.warn(
            "[notify-birthday-reminder] Dispatch failed:",
            { recipientId: recipient.id, partnerId: birthdayOwner.id, milestone: daysUntil },
            err,
          );
          errors++;
        }
      }
    }

    return jsonResponse({
      success: true,
      processed,
      sent,
      errors,
    });
  } catch (err: unknown) {
    console.error("[notify-birthday-reminder] Unhandled error:", err);
    return jsonResponse({ error: (err as Error).message || "Internal server error" }, 500);
  }
});
