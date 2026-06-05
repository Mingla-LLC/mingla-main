import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push-utils.ts";
import { getTranslatedNotification } from "../_shared/push-translations.ts";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  renderTransactionalEmail,
  type SenderIdentity,
} from "../_shared/email/index.ts";

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

// ORCH-0785 — Resend sender constant resolved via EMAIL_SENDERS.system.
// Hard guard: assertNotResendSandbox runs before every POST. There is NO
// resend.dev fallback. If RESEND_SYSTEM_FROM/RESEND_FROM_EMAIL is unset, the
// usemingla.com default is used; @resend.dev senders throw.
async function sendResendPlainEmail(
  to: string,
  subject: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, error: "RESEND_API_KEY missing" };
  let sender: SenderIdentity = EMAIL_SENDERS.system;
  // Backwards-compatible env: callers still using RESEND_FROM_EMAIL.
  const legacyOverride = Deno.env.get("RESEND_FROM_EMAIL");
  if (legacyOverride && legacyOverride.trim().length > 0) {
    const match = legacyOverride.trim().match(
      /^(?:(.+?)\s*<)?([^<>\s]+@[^<>\s]+)>?$/,
    );
    if (match) {
      sender = { name: (match[1] ?? "Mingla").trim(), address: match[2] };
    }
  }
  try {
    assertNotResendSandbox(sender);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    // no-attachment: notify-dispatch legacy plain-text path; generic_notification
    // branded path is HTML+text only with no PDF/file payload.
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: formatSenderHeader(sender),
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function sendResendBrandedEmail(
  to: string,
  payload: {
    title: string;
    body: string;
    cta?: { label: string; url: string };
  },
): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, error: "RESEND_API_KEY missing" };
  let rendered;
  try {
    rendered = renderTransactionalEmail({
      variant: "generic_notification",
      recipient: { name: null, email: to },
      body: {
        variant: "generic_notification",
        title: payload.title,
        paragraphs: payload.body.split("\n\n"),
        cta: payload.cta ?? null,
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    // no-attachment: generic notification path carries no PDF/file payload.
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: formatSenderHeader(rendered.from),
        to: [to],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Session-scoped types (ORCH-0520) ────────────────────────────────────────
// Push types that fire INSIDE an active session to an existing participant.
// These pass through the session mute check below. Adding a new push type that
// fires during session activity? Add it here. Firing to a non-participant
// (e.g., invite-stage)? Do NOT add — no mute row exists for them.
const SESSION_SCOPED_TYPES = new Set<string>([
  "session_member_joined",
  "session_member_left",
  "board_card_saved",
  "board_card_voted",
  "board_card_rsvp",
  "board_card_matched",
  "board_message_received",
  "board_message_mention",
  "board_card_message",
]);

// ── Type-to-preference mapping ──────────────────────────────────────────────
const typeToPreference: Record<string, string> = {
  "friend_request_received": "friend_requests",
  "friend_request_accepted": "friend_requests",
  "pair_request_received": "friend_requests",
  "pair_request_accepted": "friend_requests",
  // PAIR ACTIVITY PREFERENCE FIX (Block 3 — hardened 2026-03-21)
  // These types were missing from the preference map, causing them to bypass
  // user preference checks. Now gated under "friend_requests" for consistency.
  "paired_user_saved_card": "friend_requests",
  "paired_user_visited": "friend_requests",
  "collaboration_invite_received": "collaboration_invites",
  "collaboration_invite_accepted": "collaboration_invites",
  "collaboration_invite_declined": "collaboration_invites",
  "session_member_joined": "collaboration_invites",
  "session_member_left": "collaboration_invites",
  "session_deleted": "collaboration_invites",
  "board_card_saved": "collaboration_invites",
  "board_card_voted": "collaboration_invites",
  "board_card_rsvp": "collaboration_invites",
  "board_card_matched": "collaboration_invites",
  "direct_message_received": "messages",
  "board_message_received": "messages",
  "board_message_mention": "messages",
  "board_card_message": "messages",
  "re_engagement": "marketing",
  "re_engagement_3d": "marketing",
  "re_engagement_7d": "marketing",
  "weekly_digest": "marketing",
  // ORCH-1080 S-2: referral_credited was missing from the map, so it bypassed
  // the opt-out gate (typeToPreference[type] === undefined → always sent).
  // "marketing" is the closest existing bucket (no dedicated referral pref
  // column). The mingla://profile?tab=subscription deep link is unchanged.
  "referral_credited": "marketing",
  // REMINDERS PREFERENCE (Block 3 Pass 2 — hardened 2026-03-21)
  // Calendar + holiday reminders gated under "reminders" preference.
  // Previously calendar reminders had no preference key (always sent push).
  "holiday_reminder": "reminders",
  "birthday_reminder": "reminders",
  "calendar_reminder_tomorrow": "reminders",
  "calendar_reminder_today": "reminders",
  "visit_feedback_prompt": "reminders",
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
      brandId,
      deepLink,
      emailTo,
      actorId,
      relatedId,
      relatedType,
      idempotencyKey,
      expiresAt,
      pushOverrides = {},
      skipPush = false,
      emailVariant,
      emailCta,
    } = payload;

    if ((!userId && !emailTo) || !type || !title || !body) {
      return jsonResponse(
        { success: false, reason: "Missing required fields: userId/emailTo, type, title, body" },
        400
      );
    }

    // ── Idempotency check ───────────────────────────────────────────────────
    if (idempotencyKey && userId) {
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
    if (idempotencyKey && userId) {
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

    // ── Insert notification record (in-app) ────────────────────────────────
    let notificationId: string | null = null;
    if (userId) {
      const insertPayload: Record<string, unknown> = {
        user_id: userId,
        type,
        title,
        body,
        // ORCH-1030 CONTRACT: callers MUST pass the deep link as the TOP-LEVEL
        // `deepLink` field, NOT only nested inside `data`. This line OVERRIDES
        // `data.deepLink` with the top-level value (or null) — so a caller that
        // sets only `data: { deepLink }` and omits the top-level field gets its
        // deep link SILENTLY NULLED in both `data.deepLink` (what the consumer
        // app routes on) and the `deep_link` column. Pass both: `deepLink, data:
        // { deepLink }`. (Bug fixed for birthday/holiday/board-message producers.)
        data: { ...data, deepLink: deepLink || null },
        brand_id: brandId || null,
        deep_link: deepLink || null,
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
        if (insertError.code === "23505") {
          return jsonResponse({
            success: true,
            notificationId: null,
            pushSent: false,
            emailSent: false,
            reason: "duplicate",
          });
        }
        console.error("[notify-dispatch] Insert error:", insertError);
        return jsonResponse(
          { success: false, reason: "Failed to insert notification" },
          500
        );
      }

      notificationId = notification.id;
    }

    let emailSent = false;
    if (emailTo) {
      // ORCH-0785: callers opt into the Mingla brand shell with
      // `emailVariant: "generic_notification"`. The legacy plain-text path is
      // retained for backwards compatibility but now routes through
      // EMAIL_SENDERS.system — no more onboarding@resend.dev fallback.
      const emailResult = emailVariant === "generic_notification"
        ? await sendResendBrandedEmail(emailTo, {
          title,
          body,
          cta: emailCta && typeof emailCta === "object" &&
              typeof (emailCta as { label?: unknown }).label === "string" &&
              typeof (emailCta as { url?: unknown }).url === "string"
            ? {
              label: (emailCta as { label: string }).label,
              url: (emailCta as { url: string }).url,
            }
            : undefined,
        })
        : await sendResendPlainEmail(emailTo, title, body);
      emailSent = emailResult.ok;
      if (!emailResult.ok) {
        console.warn("[notify-dispatch] Email send failed:", emailResult.error);
      }
    }

    // ── Skip push early return ──────────────────────────────────────────────
    if (skipPush || !userId || !notificationId) {
      return jsonResponse({
        success: true,
        notificationId,
        pushSent: false,
        emailSent,
        reason: "skip_push",
      });
    }

    // ── Check notification preferences ──────────────────────────────────────
    const { data: prefsRows } = await adminClient
      .from("notification_preferences")
      .select("*")
      .eq("user_id", userId);
    const prefs = Array.isArray(prefsRows) ? prefsRows : [];

    // Global push toggle
    if (prefs.some((row) => row.channel === "push" && row.type === "*" && row.opt_in === false)) {
      return jsonResponse({
        success: true,
        notificationId,
        pushSent: false,
        emailSent,
        reason: "user_disabled",
      });
    }

    // Type-specific preference check
    const prefKey = typeToPreference[type];
    if (
      prefs.some((row) =>
        row.channel === "push" &&
        (row.type === type || (prefKey && row.type === prefKey)) &&
        row.opt_in === false
      )
    ) {
      return jsonResponse({
        success: true,
        notificationId,
        pushSent: false,
        emailSent,
        reason: "user_disabled",
      });
    }

    // ── Session-scoped mute check (ORCH-0520) ───────────────────────────────
    // Session-scoped types are suppressed for the recipient if they have muted
    // the session via BoardSettingsDropdown's bell icon. The in-app notifications
    // row was already inserted above — this only gates the push delivery.
    //
    // session_deleted is INTENTIONALLY excluded — users must learn when their
    // session is gone regardless of mute.
    // collaboration_invite_* are NOT included — they fire before the recipient
    // is a participant (no mute row exists) or to the inviter (different context).
    if (SESSION_SCOPED_TYPES.has(type)) {
      const sessionId = (data as Record<string, unknown>)?.sessionId as string | undefined;
      if (sessionId) {
        const { data: muteRow } = await adminClient
          .from("session_participants")
          .select("notifications_muted")
          .eq("session_id", sessionId)
          .eq("user_id", userId)
          .maybeSingle();

        if (muteRow?.notifications_muted === true) {
          console.info(
            `[notify-dispatch] session muted, skipping push for user ${userId} session ${sessionId} type ${type}`
          );
          return jsonResponse({
            success: true,
            notificationId,
            pushSent: false,
            emailSent,
            reason: "session_muted",
          });
        }
      }
    }

    // ── Quiet hours check ───────────────────────────────────────────────────
    const { data: userProfile } = await adminClient
      .from("profiles")
      .select("timezone, preferred_language")
      .eq("id", userId)
      .maybeSingle();

    const userTimezone = userProfile?.timezone || null;

    if (isQuietHours(userTimezone)) {
      // ORCH-0407: Removed dead dm_bypass_quiet_hours check — column never existed
      // in notification_preferences. Was always false. If this feature is wanted,
      // add the column first, then re-add the bypass logic.
      // Revert: re-add `prefs?.dm_bypass_quiet_hours === true` check for DMs.
      return jsonResponse({
        success: true,
        notificationId,
        pushSent: false,
        emailSent,
        reason: "quiet_hours",
      });
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

    // DISABLED: android_channel_id causes OneSignal 400 error when channels
    // are not configured in the OneSignal dashboard. Using default channel
    // until channels are set up. Re-enable after configuring channels.
    // if (pushOverrides?.androidChannelId) {
    //   pushPayload.androidChannelId = pushOverrides.androidChannelId;
    // }
    if (pushOverrides?.buttons && pushOverrides.buttons.length > 0) {
      pushPayload.buttons = pushOverrides.buttons;
    }
    if (pushOverrides?.collapseId) {
      pushPayload.collapseId = pushOverrides.collapseId;
    }
    if (pushOverrides?.threadId) {
      pushPayload.threadId = pushOverrides.threadId;
    }

    // ── Translate push for non-English users ──────────────────────────────
    const userLanguage = userProfile?.preferred_language || "en";
    if (userLanguage !== "en") {
      const translated = getTranslatedNotification(
        type,
        userLanguage,
        (data ?? {}) as Record<string, string>,
      );
      if (translated) {
        pushPayload.title = translated.title;
        pushPayload.body = translated.body;
      }
    }

    // iOS badge increment — every push adds 1 to the app icon badge (Block 3 Pass 2 — hardened 2026-03-21)
    // Android ignores these fields. Badge resets to 0 when user opens NotificationsModal.
    pushPayload.iosBadgeType = "Increase";
    pushPayload.iosBadgeCount = 1;

    let pushSent = false;
    try {
      pushSent = await sendPush(pushPayload as unknown as Parameters<typeof sendPush>[0]);
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
      emailSent,
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
