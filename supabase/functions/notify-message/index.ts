import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Loose type alias for the Supabase admin client passed into helper functions. The strict
// generic-defaulted SupabaseClient<unknown, never, ...> from ReturnType<typeof createClient>
// narrows query results to `never`, which breaks property access on Postgrest responses
// when no Database type is generated. Edge functions in this codebase do not maintain
// generated Database types (vs the mobile app which uses the strict client); a loose alias
// is consistent with existing Mingla edge-function patterns.
// deno-lint-ignore no-explicit-any
type AdminSupabaseClient = any;

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

function truncate(str: string | undefined, maxLen: number): string {
  if (!str) return "";
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}

/**
 * ORCH-0898 [Consumer collab session → Friends-tab group chat] type discriminator.
 *
 * Post-ORCH-0898 canonical types:
 *   - "message"         — unified DM + group chat message notification. Fans out to all
 *                          conversation_participants (minus sender + muted) via the new
 *                          conversation_participants.notifications_muted column.
 *   - "message_mention" — unified mention notification (was "board_mention").
 *   - "board_card_message" — RETAINED as-is for the per-card Discover-deck chat feature.
 *                            board_card_messages table is NOT migrated by ORCH-0898 per
 *                            SPEC §2.2 non-goals.
 *
 * Backward-compat: the legacy types (direct_message, board_message, board_mention,
 * direct_card_message) are RETAINED for one release as deprecated aliases that route to
 * the equivalent new handler. After ORCH-0902 [board* services consolidation] CLOSE, the
 * legacy aliases are dropped. Each legacy-type path logs a console.warn deprecation note
 * so we can track call sites during the transition window.
 */
interface NotifyMessageRequest {
  type:
    // ORCH-0898 canonical types:
    | "message"
    | "message_mention"
    | "board_card_message"
    // Legacy deprecated aliases (1-release backward-compat window):
    | "direct_message"
    | "board_message"
    | "board_mention"
    | "direct_card_message";
  senderId: string;
  conversationId?: string;
  recipientId?: string;
  messagePreview?: string;
  sessionId?: string;
  sessionName?: string;
  messageId?: string;
  mentionedUserIds?: string[];
  savedCardId?: string;
  cardName?: string;
  cardSaverId?: string;
  otherCommenterIds?: string[];
  // ORCH-0667: direct_card_message specific fields (still relevant for shared-card pushes).
  cardId?: string;       // place_pool.id — analytics dedup
  cardTitle?: string;    // for push body
  cardImageUrl?: string; // optional, reserved for rich-push v2
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
    console.warn("[notify-message] notify-dispatch error:", response.status, errText);
  }
}

/**
 * ORCH-0898: unified "message" handler — fans out to conversation_participants for both
 * direct DMs and group chats. Replaces the legacy direct_message + board_message paths.
 *
 * Behavior:
 *   - Looks up the conversation row to determine type (direct | group), name, and
 *     linked_entity_type (direct | session | trip) for OneSignal template + deep-link.
 *   - Queries conversation_participants for recipients (minus sender + muted).
 *   - Renders title: direct → `<sender>`; group → `<sender> in <conversation.name>`.
 *   - Deep-link: direct → mingla://chat/<conv>?type=direct
 *                group/session → mingla://chat/<conv>?type=group&sessionId=<s>
 *                group/trip   → mingla://chat/<conv>?type=group&eventId=<e>
 */
async function handleUnifiedMessage(
  adminClient: AdminSupabaseClient,
  supabaseUrl: string,
  serviceRoleKey: string,
  senderId: string,
  senderName: string,
  conversationId: string,
  messagePreview: string | undefined,
): Promise<{ notified: number }> {
  // Fetch conversation metadata (single query — includes type, name, linked_entity_type, session_id, event_id).
  const { data: conv, error: convErr } = await adminClient
    .from("conversations")
    .select("id, type, name, linked_entity_type, session_id, event_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (convErr || !conv) {
    console.warn("[notify-message] conversation not found or error:", conversationId, convErr);
    return { notified: 0 };
  }

  // Fetch recipients (active, non-muted, non-sender).
  const { data: recipients, error: recipErr } = await adminClient
    .from("conversation_participants")
    .select("user_id, notifications_muted")
    .eq("conversation_id", conversationId)
    .neq("user_id", senderId)
    .eq("notifications_muted", false);

  if (recipErr || !recipients || recipients.length === 0) {
    return { notified: 0 };
  }

  // Render title + deep-link based on conversation type.
  const isGroup = conv.type === "group";
  const title = isGroup && conv.name ? `${senderName} in ${conv.name}` : senderName;

  let deepLink = `mingla://chat/${conversationId}?type=${conv.type}`;
  if (isGroup && conv.linked_entity_type === "session" && conv.session_id) {
    deepLink = `mingla://chat/${conversationId}?type=group&sessionId=${conv.session_id}`;
  } else if (isGroup && conv.linked_entity_type === "trip" && conv.event_id) {
    deepLink = `mingla://chat/${conversationId}?type=group&eventId=${conv.event_id}`;
  }

  // Idempotency key: collapse messages within the same 5-minute bucket for groups (mirrors
  // legacy board_message behavior). Direct DMs get unique per-message keys (mirrors legacy
  // direct_message behavior).
  const messageTimestamp = Date.now();
  const fiveBucket = Math.floor(messageTimestamp / (5 * 60 * 1000));

  const dispatches = recipients.map((r: { user_id: string; notifications_muted: boolean }) => {
    const idempotencyKey = isGroup
      ? `group_msg:${conversationId}:${fiveBucket}:${r.user_id}`
      : `dm:${senderId}:${conversationId}:${messageTimestamp}`;

    const pushOverrides: Record<string, unknown> = {
      androidChannelId: "messages",
    };
    if (isGroup) {
      pushOverrides.collapseId = `group:${conversationId}`;
    } else {
      pushOverrides.threadId = `dm:${conversationId}`;
    }

    return callNotifyDispatch(supabaseUrl, serviceRoleKey, {
      userId: r.user_id,
      type: isGroup ? "board_message_received" : "direct_message_received",
      title,
      body: truncate(messagePreview, 100),
      data: { deepLink },
      actorId: senderId,
      relatedId: conversationId,
      relatedType: "conversation",
      idempotencyKey,
      pushOverrides,
    });
  });

  await Promise.allSettled(dispatches);
  return { notified: recipients.length };
}

/**
 * ORCH-0898: unified "message_mention" handler — replaces the legacy board_mention path.
 * Mentions are explicit recipient lists (the mentioned users), not roster fan-out.
 */
async function handleUnifiedMention(
  supabaseUrl: string,
  serviceRoleKey: string,
  adminClient: AdminSupabaseClient,
  senderId: string,
  senderName: string,
  conversationId: string,
  messageId: string,
  messagePreview: string | undefined,
  mentionedUserIds: string[],
): Promise<{ notified: number }> {
  // Fetch conversation metadata for title + deep-link.
  const { data: conv } = await adminClient
    .from("conversations")
    .select("id, type, name, linked_entity_type, session_id, event_id")
    .eq("id", conversationId)
    .maybeSingle();

  const convName = conv?.name ?? "a chat";
  const isGroup = conv?.type === "group";

  let deepLink = `mingla://chat/${conversationId}?type=${conv?.type ?? "direct"}&messageId=${messageId}`;
  if (isGroup && conv?.linked_entity_type === "session" && conv.session_id) {
    deepLink = `mingla://chat/${conversationId}?type=group&sessionId=${conv.session_id}&messageId=${messageId}`;
  } else if (isGroup && conv?.linked_entity_type === "trip" && conv.event_id) {
    deepLink = `mingla://chat/${conversationId}?type=group&eventId=${conv.event_id}&messageId=${messageId}`;
  }

  const dispatches = mentionedUserIds.map((mentionedUserId) =>
    callNotifyDispatch(supabaseUrl, serviceRoleKey, {
      userId: mentionedUserId,
      type: "board_message_mention",
      title: `${senderName} mentioned you`,
      body: truncate(`in "${convName}": ${messagePreview || ""}`, 100),
      data: { deepLink },
      actorId: senderId,
      relatedId: messageId,
      relatedType: "message",
      idempotencyKey: `mention:${messageId}:${mentionedUserId}`,
      pushOverrides: {
        androidChannelId: "messages",
      },
    })
  );

  await Promise.allSettled(dispatches);
  return { notified: mentionedUserIds.length };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // ── Parse body ───────────────────────────────────────────────────────
    const body: NotifyMessageRequest = await req.json();
    const { type, senderId } = body;

    if (senderId !== user.id) {
      return jsonResponse({ error: "senderId must match authenticated user" }, 403);
    }

    // ── Get sender profile ───────────────────────────────────────────────
    const { data: senderProfile } = await adminClient
      .from("profiles")
      .select("display_name, first_name, last_name, avatar_url")
      .eq("id", senderId)
      .single();

    const senderName =
      senderProfile?.display_name ||
      [senderProfile?.first_name, senderProfile?.last_name].filter(Boolean).join(" ") ||
      "Someone";

    // ── Route by type ────────────────────────────────────────────────────

    // ORCH-0898 canonical: unified message type.
    if (type === "message") {
      const { conversationId, messagePreview } = body;
      if (!conversationId) {
        return jsonResponse({ error: "conversationId required for message" }, 400);
      }
      const { notified } = await handleUnifiedMessage(
        adminClient,
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        senderId,
        senderName,
        conversationId,
        messagePreview,
      );
      return jsonResponse({ success: true, notified });
    }

    // ORCH-0898 canonical: unified mention type.
    if (type === "message_mention") {
      const { conversationId, messageId, messagePreview, mentionedUserIds } = body;
      if (!conversationId || !messageId || !mentionedUserIds?.length) {
        return jsonResponse(
          { error: "conversationId, messageId, and mentionedUserIds required for message_mention" },
          400,
        );
      }
      const { notified } = await handleUnifiedMention(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        adminClient,
        senderId,
        senderName,
        conversationId,
        messageId,
        messagePreview,
        mentionedUserIds,
      );
      return jsonResponse({ success: true, notified });
    }

    // ──── LEGACY DEPRECATED ALIASES (1-release backward-compat window) ────
    //
    // After ORCH-0902 [board* services consolidation] CLOSES, the legacy type names below
    // are dropped. Until then they route through the new unified handlers so the consumer
    // app + business app can migrate at their own pace.

    if (type === "direct_message") {
      console.warn("[notify-message] DEPRECATED type=direct_message — migrate to type=message (ORCH-0898). Routing through unified handler.");
      const { conversationId, messagePreview } = body;
      if (!conversationId) {
        return jsonResponse({ error: "conversationId required for direct_message (deprecated)" }, 400);
      }
      const { notified } = await handleUnifiedMessage(
        adminClient,
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        senderId,
        senderName,
        conversationId,
        messagePreview,
      );
      return jsonResponse({ success: true, notified });
    }

    if (type === "board_message") {
      console.warn("[notify-message] DEPRECATED type=board_message — migrate to type=message (ORCH-0898). Looking up conversation by session_id + routing through unified handler.");
      const { sessionId, messagePreview } = body;
      if (!sessionId) {
        return jsonResponse({ error: "sessionId required for board_message (deprecated)" }, 400);
      }
      // Look up the conversation row linked to this session.
      const { data: conv } = await adminClient
        .from("conversations")
        .select("id")
        .eq("session_id", sessionId)
        .eq("linked_entity_type", "session")
        .maybeSingle();
      if (!conv) {
        // Fallback for sessions whose conversation row hasn't been backfilled yet (shouldn't
        // happen post-ORCH-0898 migration, but defensive).
        return jsonResponse({ error: "No unified conversation found for session — ensure ORCH-0898 migration applied" }, 404);
      }
      const { notified } = await handleUnifiedMessage(
        adminClient,
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        senderId,
        senderName,
        conv.id as string,
        messagePreview,
      );
      return jsonResponse({ success: true, notified });
    }

    if (type === "board_mention") {
      console.warn("[notify-message] DEPRECATED type=board_mention — migrate to type=message_mention (ORCH-0898). Looking up conversation by session_id + routing through unified handler.");
      const { sessionId, messageId, messagePreview, mentionedUserIds } = body;
      if (!sessionId || !messageId || !mentionedUserIds?.length) {
        return jsonResponse(
          { error: "sessionId, messageId, and mentionedUserIds required for board_mention (deprecated)" },
          400,
        );
      }
      const { data: conv } = await adminClient
        .from("conversations")
        .select("id")
        .eq("session_id", sessionId)
        .eq("linked_entity_type", "session")
        .maybeSingle();
      if (!conv) {
        return jsonResponse({ error: "No unified conversation found for session — ensure ORCH-0898 migration applied" }, 404);
      }
      const { notified } = await handleUnifiedMention(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        adminClient,
        senderId,
        senderName,
        conv.id as string,
        messageId,
        messagePreview,
        mentionedUserIds,
      );
      return jsonResponse({ success: true, notified });
    }

    // ORCH-0667: direct card share (sender shares a saved card via DM). NOT migrated by
    // ORCH-0898 — kept as-is for the legacy DM card-share UX. Future ORCH may unify into
    // type=message once card_payload propagation through the unified handler is verified.
    if (type === "direct_card_message") {
      const { conversationId, recipientId, messageId, cardTitle, cardId } = body;
      if (!conversationId || !recipientId || !messageId || !cardTitle) {
        return jsonResponse(
          { error: "conversationId, recipientId, messageId, and cardTitle required for direct_card_message" },
          400,
        );
      }

      const titleTrunc = truncate(cardTitle, 60);
      const messageTimestamp = Date.now();

      await callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        userId: recipientId,
        type: "direct_card_message",
        title: `${senderName} shared an experience`,
        body: `🔖 ${titleTrunc}`,
        data: {
          deepLink: `mingla://messages/${conversationId}`,
          cardId: cardId ?? undefined,
        },
        actorId: senderId,
        relatedId: messageId,
        relatedType: "message",
        idempotencyKey: `card_share:${messageId}:${recipientId}`,
        pushOverrides: {
          androidChannelId: "messages",
          threadId: `dm:${conversationId}`,
          collapseId: `card_share:${messageId}`,
        },
      });

      return jsonResponse({ success: true, notified: 1 });
    }

    // ORCH-0898 NON-GOAL: per-card chat on Discover deck cards. board_card_messages table
    // NOT migrated. Retained for the legacy feature path.
    if (type === "board_card_message") {
      const { sessionId, savedCardId, cardName, messagePreview, cardSaverId, otherCommenterIds } = body;
      if (!sessionId || !savedCardId || !cardName) {
        return jsonResponse({ error: "sessionId, savedCardId, and cardName required for board_card_message" }, 400);
      }

      // Collect unique recipients: cardSaver + other commenters, excluding sender
      const recipientSet = new Set<string>();
      if (cardSaverId && cardSaverId !== senderId) recipientSet.add(cardSaverId);
      if (otherCommenterIds) {
        for (const id of otherCommenterIds) {
          if (id !== senderId) recipientSet.add(id);
        }
      }

      if (recipientSet.size === 0) {
        return jsonResponse({ success: true, notified: 0 });
      }

      const fiveBucket = Math.floor(Date.now() / (5 * 60 * 1000));

      const dispatches = Array.from(recipientSet).map((recipientId) =>
        callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          userId: recipientId,
          type: "board_card_message",
          title: `${senderName} commented on ${cardName}`,
          body: truncate(messagePreview, 100),
          data: { deepLink: `mingla://session/${sessionId}?card=${savedCardId}` },
          actorId: senderId,
          relatedId: savedCardId,
          relatedType: "board_saved_card",
          idempotencyKey: `card_msg:${savedCardId}:${fiveBucket}:${recipientId}`,
          pushOverrides: {
            androidChannelId: "messages",
          },
        })
      );

      await Promise.allSettled(dispatches);
      return jsonResponse({ success: true, notified: recipientSet.size });
    }

    return jsonResponse({ error: `Unknown message type: ${type}` }, 400);
  } catch (err: unknown) {
    console.error("[notify-message] Unhandled error:", err);
    return jsonResponse({ error: (err as Error).message || "Internal server error" }, 500);
  }
});
