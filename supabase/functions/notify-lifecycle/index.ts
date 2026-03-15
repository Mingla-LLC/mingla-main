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
    console.warn("[notify-lifecycle] notify-dispatch error:", response.status, errText);
  }
}

/** ISO week number (1-53) */
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
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
    const { lifecycleType } = body as {
      lifecycleType: "onboarding_incomplete" | "trial_ending" | "re_engagement" | "weekly_digest";
    };

    if (!["onboarding_incomplete", "trial_ending", "re_engagement", "weekly_digest"].includes(lifecycleType)) {
      return jsonResponse({ error: "Invalid lifecycleType" }, 400);
    }

    let notified = 0;

    // ═════════════════════════════════════════════════════════════════════
    // ONBOARDING INCOMPLETE
    // ═════════════════════════════════════════════════════════════════════
    if (lifecycleType === "onboarding_incomplete") {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: profiles, error } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("has_completed_onboarding", false)
        .lt("created_at", cutoff)
        .limit(500);

      if (error) {
        console.error("[notify-lifecycle] onboarding query error:", error);
        return jsonResponse({ error: "Query failed" }, 500);
      }

      if (profiles && profiles.length > 0) {
        const dispatches = profiles.map((p) =>
          callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            userId: p.id,
            type: "onboarding_incomplete",
            title: "You're almost there",
            body: "Finish setting up and start discovering experiences.",
            data: { deepLink: "mingla://onboarding" },
            idempotencyKey: `onboarding_incomplete:${p.id}`,
            pushOverrides: {
              androidChannelId: "general",
            },
          })
        );
        await Promise.allSettled(dispatches);
        notified = profiles.length;
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    // TRIAL ENDING
    // ═════════════════════════════════════════════════════════════════════
    if (lifecycleType === "trial_ending") {
      const now = new Date().toISOString();
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const { data: subs, error } = await supabaseAdmin
        .from("subscriptions")
        .select("user_id, trial_ends_at")
        .gte("trial_ends_at", now)
        .lte("trial_ends_at", tomorrow)
        .eq("tier", "free")
        .eq("is_active", true)
        .limit(500);

      if (error) {
        console.error("[notify-lifecycle] trial_ending query error:", error);
        return jsonResponse({ error: "Query failed" }, 500);
      }

      if (subs && subs.length > 0) {
        const dispatches = subs.map((s) => {
          const trialEndDate = s.trial_ends_at?.split("T")[0] || "soon";
          return callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            userId: s.user_id,
            type: "trial_ending",
            title: "Your trial ends tomorrow",
            body: "Upgrade to keep pairing and collaboration features.",
            data: { deepLink: "mingla://subscription" },
            idempotencyKey: `trial_ending:${s.user_id}:${trialEndDate}`,
            pushOverrides: {
              androidChannelId: "general",
              buttons: [{ id: "upgrade", text: "Upgrade" }],
            },
          });
        });
        await Promise.allSettled(dispatches);
        notified = subs.length;
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    // RE-ENGAGEMENT
    // ═════════════════════════════════════════════════════════════════════
    if (lifecycleType === "re_engagement") {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const weekBucket = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
      const biweeklyBucket = Math.floor(Date.now() / (14 * 24 * 60 * 60 * 1000));

      // 3-day inactive: updated_at between 7 days ago and 3 days ago
      // (users who were active 3-7 days ago but not since)
      const { data: threeDay, error: err3 } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("has_completed_onboarding", true)
        .lt("updated_at", threeDaysAgo)
        .gte("updated_at", sevenDaysAgo)
        .limit(200);

      if (err3) {
        console.error("[notify-lifecycle] re_engagement 3d query error:", err3);
      }

      if (threeDay && threeDay.length > 0) {
        const dispatches = threeDay.map((p) =>
          callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            userId: p.id,
            type: "re_engagement",
            title: "New experiences near you",
            body: "Come back and see what's new.",
            data: { deepLink: "mingla://home" },
            idempotencyKey: `reengagement:${p.id}:${weekBucket}`,
            pushOverrides: {
              androidChannelId: "general",
            },
          })
        );
        await Promise.allSettled(dispatches);
        notified += threeDay.length;
      }

      // 7-day inactive: updated_at older than 7 days ago
      const { data: sevenDay, error: err7 } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("has_completed_onboarding", true)
        .lt("updated_at", sevenDaysAgo)
        .limit(200);

      if (err7) {
        console.error("[notify-lifecycle] re_engagement 7d query error:", err7);
      }

      if (sevenDay && sevenDay.length > 0) {
        const dispatches = sevenDay.map(async (p) => {
          // Try to find a friend name for personalization
          let title = "Miss you on Mingla";
          let notifBody = "New experiences are waiting for you.";
          let deepLink = "mingla://home";

          try {
            const { data: friend } = await supabaseAdmin
              .from("friends")
              .select("friend_user_id")
              .eq("user_id", p.id)
              .eq("status", "accepted")
              .limit(1)
              .maybeSingle();

            if (friend?.friend_user_id) {
              const { data: friendProfile } = await supabaseAdmin
                .from("profiles")
                .select("display_name, first_name")
                .eq("id", friend.friend_user_id)
                .single();

              const friendName = friendProfile?.display_name || friendProfile?.first_name;
              if (friendName) {
                title = `${friendName} is on Mingla`;
                notifBody = "Pair up and discover experiences together.";
                deepLink = "mingla://connections";
              }
            }
          } catch (e) {
            console.warn("[notify-lifecycle] Failed to fetch friend for re-engagement:", e);
          }

          return callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            userId: p.id,
            type: "re_engagement",
            title,
            body: notifBody,
            data: { deepLink },
            idempotencyKey: `reengagement_7d:${p.id}:${biweeklyBucket}`,
            pushOverrides: {
              androidChannelId: "general",
            },
          });
        });
        await Promise.allSettled(dispatches);
        notified += sevenDay.length;
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    // WEEKLY DIGEST
    // ═════════════════════════════════════════════════════════════════════
    if (lifecycleType === "weekly_digest") {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const weekNumber = getISOWeekNumber(new Date());

      // Active users: updated_at within last 30 days
      const { data: activeUsers, error } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("has_completed_onboarding", true)
        .gte("updated_at", thirtyDaysAgo)
        .limit(500);

      if (error) {
        console.error("[notify-lifecycle] weekly_digest query error:", error);
        return jsonResponse({ error: "Query failed" }, 500);
      }

      if (activeUsers && activeUsers.length > 0) {
        const dispatches = activeUsers.map(async (u) => {
          // Aggregate weekly stats
          let savesCount = 0;
          let visitsCount = 0;
          let connectionsCount = 0;

          try {
            // Saves: user_interactions with interaction_type = 'save'
            const { count: saves } = await supabaseAdmin
              .from("user_interactions")
              .select("*", { count: "exact", head: true })
              .eq("user_id", u.id)
              .eq("interaction_type", "save")
              .gte("created_at", sevenDaysAgo);
            savesCount = saves || 0;

            // Visits: user_visits this week
            const { count: visits } = await supabaseAdmin
              .from("user_visits")
              .select("*", { count: "exact", head: true })
              .eq("user_id", u.id)
              .gte("created_at", sevenDaysAgo);
            visitsCount = visits || 0;

            // Connections: friend_requests accepted this week
            const { count: connections } = await supabaseAdmin
              .from("friend_requests")
              .select("*", { count: "exact", head: true })
              .or(`sender_id.eq.${u.id},receiver_id.eq.${u.id}`)
              .eq("status", "accepted")
              .gte("updated_at", sevenDaysAgo);
            connectionsCount = connections || 0;
          } catch (e) {
            console.warn("[notify-lifecycle] Stats aggregation error for user:", u.id, e);
          }

          const hasActivity = savesCount > 0 || visitsCount > 0 || connectionsCount > 0;
          const digestBody = hasActivity
            ? `${savesCount} save${savesCount !== 1 ? "s" : ""}, ${visitsCount} visit${visitsCount !== 1 ? "s" : ""}, ${connectionsCount} new connection${connectionsCount !== 1 ? "s" : ""} — nice week!`
            : "New experiences are waiting for you. Start your week fresh.";

          return callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            userId: u.id,
            type: "weekly_digest",
            title: "Your week on Mingla",
            body: digestBody,
            data: { deepLink: "mingla://home" },
            idempotencyKey: `weekly_digest:${u.id}:${weekNumber}`,
            pushOverrides: {
              androidChannelId: "general",
            },
          });
        });
        await Promise.allSettled(dispatches);
        notified = activeUsers.length;
      }
    }

    return jsonResponse({ success: true, notified });
  } catch (err: unknown) {
    console.error("[notify-lifecycle] Unhandled error:", err);
    return jsonResponse({ error: (err as Error).message || "Internal server error" }, 500);
  }
});
