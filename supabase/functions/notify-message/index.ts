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

function truncate(str: string | undefined, maxLen: number): string {
  if (!str) return "";
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "\u2026" : str;
}

interface NotifyMessageRequest {
  type: "direct_message" | "board_message" | "board_mention" | "board_card_message";
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
    if (type === "direct_message") {
      const { conversationId, recipientId, messagePreview } = body;
      if (!conversationId || !recipientId) {
        return jsonResponse({ error: "conversationId and recipientId required for direct_message" }, 400);
      }

      const twoBucket = Math.floor(Date.now() / (2 * 60 * 1000));

      await callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        userId: recipientId,
        type: "direct_message_received",
        title: senderName,
        body: truncate(messagePreview, 100),
        data: { deepLink: `mingla://messages/${conversationId}` },
        actorId: senderId,
        relatedId: conversationId,
        relatedType: "conversation",
        idempotencyKey: `dm:${senderId}:${conversationId}:${twoBucket}`,
        pushOverrides: {
          androidChannelId: "messages",
          collapseId: `msg:${conversationId}`,
        },
      });

      return jsonResponse({ success: true, notified: 1 });
    }

    if (type === "board_message") {
      const { sessionId, sessionName, messagePreview } = body;
      if (!sessionId || !sessionName) {
        return jsonResponse({ error: "sessionId and sessionName required for board_message" }, 400);
      }

      // Get all participants except sender
      const { data: participants } = await adminClient
        .from("session_participants")
        .select("user_id")
        .eq("session_id", sessionId)
        .neq("user_id", senderId);

      if (!participants || participants.length === 0) {
        return jsonResponse({ success: true, notified: 0 });
      }

      const fiveBucket = Math.floor(Date.now() / (5 * 60 * 1000));

      const dispatches = participants.map((p) =>
        callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          userId: p.user_id,
          type: "board_message_received",
          title: `${senderName} in ${sessionName}`,
          body: truncate(messagePreview, 100),
          data: { deepLink: `mingla://session/${sessionId}?tab=chat` },
          actorId: senderId,
          relatedId: sessionId,
          relatedType: "session",
          idempotencyKey: `board_msg:${sessionId}:${fiveBucket}:${p.user_id}`,
          pushOverrides: {
            androidChannelId: "messages",
            collapseId: `board:${sessionId}`,
          },
        })
      );

      await Promise.allSettled(dispatches);
      return jsonResponse({ success: true, notified: participants.length });
    }

    if (type === "board_mention") {
      const { sessionId, sessionName, messagePreview, messageId, mentionedUserIds } = body;
      if (!sessionId || !sessionName || !messageId || !mentionedUserIds?.length) {
        return jsonResponse({ error: "sessionId, sessionName, messageId, and mentionedUserIds required for board_mention" }, 400);
      }

      const dispatches = mentionedUserIds.map((mentionedUserId) =>
        callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          userId: mentionedUserId,
          type: "board_message_mention",
          title: `${senderName} mentioned you`,
          body: truncate(`in "${sessionName}": ${messagePreview || ""}`, 100),
          data: { deepLink: `mingla://session/${sessionId}?tab=chat&messageId=${messageId}` },
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
      return jsonResponse({ success: true, notified: mentionedUserIds.length });
    }

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
