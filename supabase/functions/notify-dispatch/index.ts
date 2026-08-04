import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOneSignalApp, sendPush } from "../_shared/push-utils.ts";
import { getTranslatedNotification } from "../_shared/push-translations.ts";
// META-ORCH-1161 transitional: v2 dispatch core ({category_key,...} contract).
// The legacy type-based path below is left BYTE-IDENTICAL — the v2 branch is an
// early, additive return. Exit condition: when all senders migrate onto v2 and
// the legacy contract is retired (CLOSE-time cleanup, §5.7).
import {
  dispatchSourceRefundChannel,
  dispatchV2,
  type DispatchV2Input,
} from "../_shared/notifyV2.ts";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  renderTransactionalEmail,
  type SenderIdentity,
} from "../_shared/email/index.ts";
import {
  dispatchIdempotentLegacyEmail,
  type EmailDeliveryClaim,
  type EmailDeliveryCompletionOutcome,
  isExactServiceBearer,
  type ResendAttempt,
  type ResendEmailPayload,
} from "../_shared/legacyEmailIdempotency.ts";
import {
  resolveNotificationRecipientHmacSecret,
} from "../_shared/notificationRecipientHmac.ts";

// Phase-A compatibility reader for NOTIFICATION_RECIPIENT_HMAC_SECRET is
// owned by resolveNotificationRecipientHmacSecret; the direct name remains
// present in the manifest until #1436 completes the private bundle rollout.

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

function sourceDispatchResponse(
  result: Awaited<ReturnType<typeof dispatchSourceRefundChannel>>,
): Response {
  if (result.outcome === "accepted") {
    return jsonResponse({
      success: true,
      outcome: "accepted",
      providerMessageId: result.providerMessageId,
    }, 200);
  }
  if (result.outcome === "definitive_unsent_retryable") {
    return jsonResponse({
      success: false,
      outcome: "retryable",
      reason: result.safeCode ?? "unknown_failure",
    }, 503);
  }
  if (result.outcome === "acceptance_unknown") {
    return jsonResponse({
      success: false,
      outcome: "ambiguous_parked",
      reason: "delivery_ambiguous",
    }, 202);
  }
  // #1529 — A DELIBERATE POLICY SKIP IS NOT A DELIVERY FAILURE.
  //
  // WHAT WAS BROKEN: this function carried branches for `accepted`,
  // `definitive_unsent_retryable` and `acceptance_unknown` only, so `skipped`
  // — which `adapterOutcome` correctly returns with success:true when a market
  // kill-switch is off — fell through to the 422 `terminal_unsent` default
  // below. `notify-outbox-drain` maps 422 to `terminal_unsent`,
  // `complete_source_refund_notification_delivery` turns that into
  // `failed_terminal`, and that in turn runs `UPDATE public.source_refunds SET
  // ops_status='needs_review', last_error_code='attention_delivery_unavailable'`.
  //
  // WHY IT MATTERS NOW: this was latent while every outbox row presented as
  // "US" and the US switch was live, so the adapter never returned `skipped`
  // on this path. The moment #1529 makes Nigerian rows genuinely say NG
  // against a dark `sms_live_enabled.ng`, EVERY Nigerian refund text would
  // raise a false ops alarm on a live money path. `suppressed` is included
  // because it reaches the identical fallthrough for the identical wrong
  // reason (#1529 investigation discovery 4).
  //
  // WHAT BREAKS IF THIS IS UNDONE: turning Nigeria on — or shipping any future
  // market dark — silently floods refund operations with `needs_review`
  // refunds that have nothing whatsoever wrong with them.
  if (result.outcome === "skipped" || result.outcome === "suppressed") {
    return jsonResponse({
      success: true,
      outcome: "skipped",
      reason: result.safeCode ?? "provider_kill_switch_off",
    }, 200);
  }
  return jsonResponse({
    success: false,
    outcome: "terminal_unsent",
    reason: result.safeCode ?? "dispatch_rejected",
  }, 422);
}

// ORCH-0785 — Resend sender constant resolved via EMAIL_SENDERS.system.
// Hard guard: assertNotResendSandbox runs before every POST. There is NO
// resend.dev fallback. If RESEND_SYSTEM_FROM/RESEND_FROM_EMAIL is unset, the
// usemingla.com default is used; @resend.dev senders throw.
function buildResendPlainEmail(
  to: string,
  subject: string,
  text: string,
): ResendEmailPayload {
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
  assertNotResendSandbox(sender);
  return {
    from: formatSenderHeader(sender),
    to: [to],
    subject,
    text,
  };
}

function buildResendBrandedEmail(
  to: string,
  payload: {
    title: string;
    body: string;
    cta?: { label: string; url: string };
  },
): ResendEmailPayload {
  const rendered = renderTransactionalEmail({
    variant: "generic_notification",
    recipient: { name: null, email: to },
    body: {
      variant: "generic_notification",
      title: payload.title,
      paragraphs: payload.body.split("\n\n"),
      cta: payload.cta ?? null,
    },
  });
  return {
    from: formatSenderHeader(rendered.from),
    to: [to],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  };
}

async function sendResendEmail(
  payload: ResendEmailPayload,
  providerIdempotencyKey: string,
): Promise<ResendAttempt> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { outcome: "manual_review", reason: "resend_key_missing" };
  try {
    // no-attachment: legacy notification emails contain rendered HTML/text only.
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": providerIdempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    const responseBody = await res.json().catch(() => ({})) as {
      id?: unknown;
      name?: unknown;
    };
    if (res.ok) {
      return typeof responseBody.id === "string" &&
          responseBody.id.trim().length > 0
        ? {
          outcome: "accepted",
          providerMessageId: responseBody.id,
        }
        : { outcome: "retryable", reason: "resend_acceptance_id_missing" };
    }
    const providerError = typeof responseBody.name === "string"
      ? responseBody.name
      : "";
    if (
      res.status === 429 || res.status >= 500 ||
      providerError === "concurrent_idempotent_requests"
    ) {
      return {
        outcome: "retryable",
        reason: providerError === "concurrent_idempotent_requests"
          ? providerError
          : `resend_retryable_${res.status}`,
      };
    }
    return {
      outcome: "manual_review",
      reason: providerError === "invalid_idempotent_request"
        ? providerError
        : `resend_rejected_${res.status}`,
    };
  } catch {
    return { outcome: "retryable", reason: "resend_network_ambiguity" };
  }
}

async function dispatchDurableLegacyEmail(
  adminClient: {
    rpc: (
      functionName: never,
      args: never,
    ) => PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>;
  },
  input: {
    recipient: string;
    idempotencyKey: string;
    payload: ResendEmailPayload;
  },
) {
  return await dispatchIdempotentLegacyEmail(
    {
      recipient: input.recipient,
      logicalIdempotencyKey: input.idempotencyKey,
      recipientHmacSecret: resolveNotificationRecipientHmacSecret() ?? "",
      payload: input.payload,
    },
    {
      claimDelivery: async (claimInput): Promise<EmailDeliveryClaim> => {
        const { data: claim, error: claimError } = await adminClient.rpc(
          "claim_notification_email_delivery" as never,
          {
            p_idempotency_key: claimInput.idempotencyKey,
            p_recipient_fingerprint: claimInput.recipientFingerprint,
            p_payload_fingerprint: claimInput.payloadFingerprint,
            p_now: new Date().toISOString(),
          } as never,
        );
        if (claimError) {
          throw new Error(
            `email_delivery_claim_failed:${claimError.message}`,
          );
        }
        const row = claim as Record<string, unknown> | null;
        return {
          action: String(
            row?.action ?? "in_progress",
          ) as EmailDeliveryClaim["action"],
          deliveryId: typeof row?.delivery_id === "string"
            ? row.delivery_id
            : null,
          claimId: typeof row?.claim_id === "string" ? row.claim_id : null,
          providerMessageId: typeof row?.provider_message_id === "string"
            ? row.provider_message_id
            : null,
        };
      },
      completeDelivery: async (completionInput): Promise<void> => {
        const { error: completionError } = await adminClient.rpc(
          "complete_notification_email_delivery" as never,
          {
            p_delivery_id: completionInput.deliveryId,
            p_claim_id: completionInput.claimId,
            p_outcome: completionInput
              .outcome as EmailDeliveryCompletionOutcome,
            p_provider_message_id: completionInput.providerMessageId,
            p_error_reason: completionInput.errorReason,
            p_now: new Date().toISOString(),
          } as never,
        );
        if (completionError) {
          throw new Error(
            `email_delivery_completion_failed:${completionError.message}`,
          );
        }
      },
      sendResend: sendResendEmail,
    },
  );
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
  // META-ORCH-1104 D6 (Option α): support reply / new-ticket pushes ride the
  // existing `messages` boolean — a support reply IS a message. No dedicated
  // support_replies column in v1 (D6 Option β deferred).
  "business.support_message": "messages",
  "business.support_new_ticket": "messages",
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
      return jsonResponse(
        { error: "Missing or invalid Authorization header" },
        401,
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    )!;

    // Admin client (service role) for all DB operations
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    // ── Parse & validate input ──────────────────────────────────────────────
    const payload = await req.json();

    // ── META-ORCH-1161 transitional: v2 ({category_key,...}) branch ──────────
    // ADDITIVE — a caller that sends `category_key` opts into the unified
    // simultaneous-send path (DEC-185). A caller that sends `type` (legacy) falls
    // through to the byte-identical legacy path below. Exit condition: legacy
    // contract retired at CLOSE (§5.7).
    if (
      payload && typeof payload.category_key === "string" &&
      payload.category_key.length > 0
    ) {
      if (payload.category_key.startsWith("source_refund_")) {
        try {
          if (
            payload.contract_version !== 9 ||
            !isExactServiceBearer(authHeader, SUPABASE_SERVICE_ROLE_KEY) ||
            !["inapp", "push", "email", "sms"].includes(
              payload.requested_channel,
            ) ||
            typeof payload.delivery_id !== "string" ||
            typeof payload.delivery_claim_id !== "string"
          ) {
            return jsonResponse({
              success: false,
              outcome: "terminal_unsent",
              reason: "dispatch_rejected",
            }, 422);
          }
          const result = await dispatchSourceRefundChannel(
            adminClient as unknown as Parameters<
              typeof dispatchSourceRefundChannel
            >[0],
            {
              category_key: payload.category_key,
              user_id: payload.user_id ?? null,
              contact: payload.contact ?? null,
              payload: (payload.payload ?? {}) as Record<string, unknown>,
              idempotency_key: String(payload.idempotency_key ?? ""),
              country_code: payload.country_code ?? null,
              requested_channel: payload.requested_channel,
              delivery_id: payload.delivery_id,
              delivery_claim_id: payload.delivery_claim_id,
              attention_url: typeof payload.attention_url === "string"
                ? payload.attention_url
                : null,
            },
          );
          return sourceDispatchResponse(result);
        } catch {
          return jsonResponse({
            success: false,
            outcome: "source_dispatch_failed",
            reason: "source_dispatch_failed",
          }, 500);
        }
      }
      const v2Input: DispatchV2Input = {
        user_id: payload.user_id ?? payload.userId ?? null,
        contact: payload.contact ?? null,
        category_key: payload.category_key,
        payload: (payload.payload ?? {}) as Record<string, unknown>,
        idempotency_key: String(
          payload.idempotency_key ?? payload.idempotencyKey ?? "",
        ),
        country_code: payload.country_code ?? null,
        requested_channel: payload.requested_channel ?? null,
      };
      if (!v2Input.idempotency_key) {
        return jsonResponse({
          success: false,
          reason: "idempotency_key required for v2",
        }, 400);
      }

      // Record the transactional consent for this moment if not already present
      // (SPEC §7.2: source='reservation'). Append-only; failure is non-fatal.
      const consentContact =
        typeof v2Input.contact === "string" && v2Input.contact.length > 0
          ? v2Input.contact
          : null;
      if (consentContact) {
        const channel = consentContact.includes("@") ? "email" : "sms";
        try {
          const { data: existingConsent } = await adminClient
            .from("consent_records")
            .select("id")
            .eq("contact", consentContact)
            .eq("channel", channel)
            .eq("scope", "transactional")
            .eq("action", "granted")
            .maybeSingle();
          if (!existingConsent) {
            await adminClient.from("consent_records").insert({
              user_id: v2Input.user_id,
              contact: consentContact,
              channel,
              scope: "transactional",
              action: "granted",
              source: "reservation",
              country_code: v2Input.country_code,
            });
          }
        } catch (consentErr) {
          console.warn(
            "[notify-dispatch v2] consent record write failed (non-fatal):",
            consentErr,
          );
        }
      }

      const v2Result = await dispatchV2(
        adminClient as unknown as Parameters<typeof dispatchV2>[0],
        v2Input,
      );
      return jsonResponse(v2Result, v2Result.success ? 200 : 400);
    }
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
        {
          success: false,
          reason: "Missing required fields: userId/emailTo, type, title, body",
        },
        400,
      );
    }
    if (
      emailTo &&
      !isExactServiceBearer(authHeader, SUPABASE_SERVICE_ROLE_KEY)
    ) {
      return jsonResponse({
        success: false,
        reason: "unauthorized_email_dispatch",
      }, 401);
    }
    if (
      emailTo &&
      (typeof idempotencyKey !== "string" ||
        idempotencyKey.trim().length === 0)
    ) {
      return jsonResponse(
        { success: false, reason: "email_idempotency_key_required" },
        400,
      );
    }

    const emailPayload = emailTo
      ? emailVariant === "generic_notification"
        ? buildResendBrandedEmail(emailTo, {
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
        : buildResendPlainEmail(emailTo, title, body)
      : null;

    // #1172: email-only legacy notifications use the existing delivery ledger
    // as their durable provider-acceptance owner. Raw recipients never enter
    // the row, key, response, or logs.
    if (emailTo && !userId && emailPayload) {
      const result = await dispatchDurableLegacyEmail(adminClient, {
        recipient: emailTo,
        idempotencyKey,
        payload: emailPayload,
      });
      if (result.outcome === "provider_accepted") {
        return jsonResponse({
          success: true,
          providerAccepted: true,
          retryPending: false,
          manualReview: false,
          emailSent: true,
          providerMessageId: result.providerMessageId,
          reason: result.duplicate ? "already_accepted" : "provider_accepted",
        });
      }
      if (result.outcome === "manual_review") {
        return jsonResponse({
          success: false,
          providerAccepted: false,
          retryPending: false,
          manualReview: true,
          emailSent: false,
          reason: result.reason,
        }, result.reason === "idempotency_conflict" ? 409 : 422);
      }
      return jsonResponse({
        success: false,
        providerAccepted: false,
        retryPending: true,
        manualReview: false,
        emailSent: false,
        reason: result.reason,
      }, 503);
    }

    let notificationId: string | null = null;

    // ── Idempotency check ───────────────────────────────────────────────────
    if (idempotencyKey && userId) {
      const { data: existing } = await adminClient
        .from("notifications")
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existing) {
        notificationId = existing.id;
        if (!emailTo) {
          return jsonResponse({
            success: true,
            notificationId: existing.id,
            pushSent: false,
            reason: "duplicate",
          });
        }
      }
    }

    // ── Rate limiting BEFORE insert (prevents in-app spam too) ──────────────
    // Uses the notification `type` field (not idempotency key prefix) for accurate matching
    if (idempotencyKey && userId && !notificationId) {
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
    if (userId && !notificationId) {
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
          if (!emailTo) {
            return jsonResponse({
              success: true,
              notificationId: null,
              pushSent: false,
              emailSent: false,
              reason: "duplicate",
            });
          }
          const { data: concurrent } = await adminClient
            .from("notifications")
            .select("id")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
          if (!concurrent?.id) {
            return jsonResponse(
              {
                success: false,
                reason: "notification_idempotency_lookup_failed",
              },
              500,
            );
          }
          notificationId = concurrent.id;
        } else {
          console.error("[notify-dispatch] Insert error:", insertError);
          return jsonResponse(
            { success: false, reason: "Failed to insert notification" },
            500,
          );
        }
      } else {
        notificationId = notification.id;
      }
    }

    let emailSent = false;
    if (emailTo && emailPayload) {
      // ORCH-0785: callers opt into the Mingla brand shell with
      // `emailVariant: "generic_notification"`. The legacy plain-text path is
      // retained for backwards compatibility but now routes through
      // EMAIL_SENDERS.system — no more onboarding@resend.dev fallback.
      const emailResult = await dispatchDurableLegacyEmail(adminClient, {
        recipient: emailTo,
        idempotencyKey,
        payload: emailPayload,
      });
      if (emailResult.outcome !== "provider_accepted") {
        return jsonResponse({
          success: false,
          providerAccepted: false,
          retryPending: emailResult.outcome === "retry_pending",
          manualReview: emailResult.outcome === "manual_review",
          emailSent: false,
          reason: emailResult.reason,
        }, emailResult.outcome === "retry_pending" ? 503 : 422);
      }
      emailSent = true;
    }

    // ── Skip push early return ──────────────────────────────────────────────
    if (skipPush || !userId || !notificationId) {
      return jsonResponse({
        success: true,
        notificationId,
        pushSent: false,
        emailSent,
        providerAccepted: emailSent,
        reason: "skip_push",
      });
    }

    // ── Check notification preferences ──────────────────────────────────────
    // META-ORCH-1104 D6 (Lane A F5.5b): the notification_preferences table is
    // boolean-column-per-category (push_enabled, messages, marketing,
    // friend_requests, reminders, collaboration_invites, …) — NOT a
    // channel/type/opt_in row schema. The previous gate read those non-existent
    // columns, so the entire type-preference gate was a SILENT NO-OP. This now
    // reads the real columns: push_enabled (global push toggle) + the mapped
    // category boolean (false = opted out → suppress).
    const { data: prefsRows } = await adminClient
      .from("notification_preferences")
      .select("*")
      .eq("user_id", userId);
    const prefs = Array.isArray(prefsRows) ? prefsRows : [];
    // One row per user; absent row = all defaults on (deny nothing).
    const pref = prefs.length > 0
      ? (prefs[0] as Record<string, unknown>)
      : null;

    // Global push toggle: push_enabled === false → suppress all push.
    if (pref && pref.push_enabled === false) {
      return jsonResponse({
        success: true,
        notificationId,
        pushSent: false,
        emailSent,
        providerAccepted: emailSent,
        reason: "user_disabled",
      });
    }

    // Type-specific preference check: map the type to its category boolean
    // column; if that column is explicitly false, the user opted out of this
    // category → suppress. Types with no mapping are always sent (no opt-out).
    const prefKey = typeToPreference[type];
    if (pref && prefKey && pref[prefKey] === false) {
      return jsonResponse({
        success: true,
        notificationId,
        pushSent: false,
        emailSent,
        providerAccepted: emailSent,
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
      const sessionId = (data as Record<string, unknown>)?.sessionId as
        | string
        | undefined;
      if (sessionId) {
        const { data: muteRow } = await adminClient
          .from("session_participants")
          .select("notifications_muted")
          .eq("session_id", sessionId)
          .eq("user_id", userId)
          .maybeSingle();

        if (muteRow?.notifications_muted === true) {
          console.info(
            `[notify-dispatch] session muted, skipping push for user ${userId} session ${sessionId} type ${type}`,
          );
          return jsonResponse({
            success: true,
            notificationId,
            pushSent: false,
            emailSent,
            providerAccepted: emailSent,
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
        providerAccepted: emailSent,
        reason: "quiet_hours",
      });
    }

    // ── Send push ───────────────────────────────────────────────────────────
    // Merge notificationId and type into push data so client can mark-as-read and route
    const pushData = { ...data, notificationId, type };

    // META-ORCH-1074 Sub-A: route the push to the correct OneSignal application
    // by notification `type` prefix (business.*/stripe.* → business app; else
    // consumer). The in-app `notifications` row written above is identical
    // regardless of app — the inbox is a shared table and the client
    // prefix-filters at read time per I-PROPOSED-W. Only the push DELIVERY
    // target is parameterized here. — https://documentation.onesignal.com/docs/keys-and-ids
    const pushPayload: Record<string, unknown> = {
      targetUserId: userId,
      title,
      body,
      data: pushData,
      app: resolveOneSignalApp(type),
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
      pushSent = await sendPush(
        pushPayload as unknown as Parameters<typeof sendPush>[0],
      );
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
      providerAccepted: emailSent,
    });
  } catch (err: unknown) {
    console.error("[notify-dispatch] Unhandled error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      { success: false, reason: message || "Internal server error" },
      500,
    );
  }
});
