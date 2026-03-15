import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push-utils.ts";

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

// ── Type-to-preference mapping ──────────────────────────────────────────────
const typeToPreference: Record<string, string> = {
  "friend_request_received": "friend_requests",
  "friend_request_accepted": "friend_requests",
  "pair_request_received": "friend_requests",
  "pair_request_accepted": "friend_requests",
  "link_request_received": "link_requests",
  "link_request_accepted": "link_requests",
  "friend_joined_mingla": "friend_requests",
  "collaboration_invite_received": "collaboration_invites",
  "collaboration_invite_accepted": "collaboration_invites",
  "collaboration_invite_declined": "collaboration_invites",
  "session_member_joined": "collaboration_invites",
  "session_member_left": "collaboration_invites",
  "board_card_saved": "collaboration_invites",
  "board_card_voted": "collaboration_invites",
  "board_card_rsvp": "collaboration_invites",
  "direct_message_received": "messages",
  "board_message_received": "messages",
  "board_message_mention": "messages",
  "board_card_message": "messages",
  "re_engagement": "marketing",
  "re_engagement_3d": "marketing",
  "re_engagement_7d": "marketing",
  "weekly_digest": "marketing",
};

// ── Quiet hours check ───────────────────────────────────────────────────────
function isQuietHours(timezone: string | null): boolean {
  const tz = timezone || "America/New_York"; // conservative default
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: tz,
  });
  const hour = parseInt(formatter.format(now), 10);
  return hour >= 22 || hour < 8; // 10 PM - 8 AM
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Validate auth (service role calls only) ─────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Admin client (service role) for all DB operations
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // ── Parse & validate input ──────────────────────────────────────────────
    const payload = await req.json();
    const {
      userId,
      type,
      title,
      body,
      data = {},
      actorId,
      relatedId,
      relatedType,
      idempotencyKey,
      expiresAt,
      pushOverrides = {},
      skipPush = false,
    } = payload;

    if (!userId || !type || !title || !body) {
      return jsonResponse(
        { success: false, reason: "Missing required fields: userId, type, title, body" },
        400
      );
    }

    // ── Idempotency check ───────────────────────────────────────────────────
    if (idempotencyKey) {
      const { data: existing } = await adminClient
        .from("notifications")
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existing) {
        return jsonResponse({
          success: true,
          notificationId: existing.id,
          pushSent: false,
          reason: "duplicate",
        });
      }
    }

    // ── Rate limiting BEFORE insert (prevents in-app spam too) ──────────────
    // Uses the notification `type` field (not idempotency key prefix) for accurate matching
    if (idempotencyKey) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const { count } = await adminClient
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("type", type)
        .gte("created_at", fiveMinutesAgo);

      // Allow up to 10 notifications of the same type per 5-minute window
      if ((count || 0) > 10) {
        return jsonResponse({
          success: true,
          notificationId: null,
          pushSent: false,
          reason: "rate_limited",
        });
      }
    }

    // ── Insert notification record ──────────────────────────────────────────
    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      type,
      title,
      body,
      data,
      actor_id: actorId || null,
      related_id: relatedId || null,
      related_type: relatedType || null,
      idempotency_key: idempotencyKey || null,
      expires_at: expiresAt || null,
    };

    const { data: notification, error: insertError } = await adminClient
      .from("notifications")
      .insert(insertPayload)
      .select("id")
      .single();

    if (insertError) {
      // Handle unique constraint violation (TOCTOU race on idempotency key) gracefully
      if (insertError.code === "23505") {
        return jsonResponse({
          success: true,
          notificationId: null,
          pushSent: false,
          reason: "duplicate",
        });
      }
      console.error("[notify-dispatch] Insert error:", insertError);
      return jsonResponse(
        { success: false, reason: "Failed to insert notification" },
        500
      );
    }

    const notificationId = notification.id;

    // ── Skip push early return ──────────────────────────────────────────────
    if (skipPush) {
      return jsonResponse({
        success: true,
        notificationId,
        pushSent: false,
        reason: "skip_push",
      });
    }

    // ── Check notification preferences ──────────────────────────────────────
    const { data: prefs } = await adminClient
      .from("notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    // Global push toggle
    if (prefs && prefs.push_enabled === false) {
      return jsonResponse({
        success: true,
        notificationId,
        pushSent: false,
        reason: "user_disabled",
      });
    }

    // Type-specific preference check
    const prefKey = typeToPreference[type];
    if (prefKey && prefs && prefs[prefKey] === false) {
      return jsonResponse({
        success: true,
        notificationId,
        pushSent: false,
        reason: "user_disabled",
      });
    }

    // ── Quiet hours check ───────────────────────────────────────────────────
    const { data: userProfile } = await adminClient
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle();

    const userTimezone = userProfile?.timezone || null;

    if (isQuietHours(userTimezone)) {
      // Exception: DMs can bypass quiet hours if user opted in
      const bypassAllowed =
        type === "direct_message_received" &&
        prefs?.dm_bypass_quiet_hours === true;

      if (!bypassAllowed) {
        return jsonResponse({
          success: true,
          notificationId,
          pushSent: false,
          reason: "quiet_hours",
        });
      }
    }

    // ── Send push ───────────────────────────────────────────────────────────
    // Merge notificationId and type into push data so client can mark-as-read and route
    const pushData = { ...data, notificationId, type };

    const pushPayload: Record<string, unknown> = {
      targetUserId: userId,
      title,
      body,
      data: pushData,
    };

    if (pushOverrides?.androidChannelId) {
      pushPayload.androidChannelId = pushOverrides.androidChannelId;
    }
    if (pushOverrides?.buttons && pushOverrides.buttons.length > 0) {
      pushPayload.buttons = pushOverrides.buttons;
    }
    if (pushOverrides?.collapseId) {
      pushPayload.collapseId = pushOverrides.collapseId;
    }
    if (pushOverrides?.threadId) {
      pushPayload.threadId = pushOverrides.threadId;
    }

    let pushSent = false;
    try {
      pushSent = await sendPush(pushPayload as Parameters<typeof sendPush>[0]);
    } catch (pushErr) {
      console.warn("[notify-dispatch] Push send failed:", pushErr);
    }

    // ── Update notification with push delivery status ───────────────────────
    if (pushSent) {
      await adminClient
        .from("notifications")
        .update({ push_sent: true, push_sent_at: new Date().toISOString() })
        .eq("id", notificationId);
    }

    return jsonResponse({
      success: true,
      notificationId,
      pushSent,
    });
  } catch (err: unknown) {
    console.error("[notify-dispatch] Unhandled error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      { success: false, reason: message || "Internal server error" },
      500
    );
  }
});
