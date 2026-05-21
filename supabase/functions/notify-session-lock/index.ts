// ORCH-0908: Notify session participants when a card is locked-and-scheduled.
// Called by the mobile client after rpc_admin_lock_and_schedule_card succeeds.
//
// Single event variant (post-rework 2026-05-21):
//   event='plan_scheduled' — title: "{{sessionName}}", body: "{{lockerName}} locked in {{cardTitle}} for {{date}}"
//
// The earlier 'card_locked' variant was dropped when lock and schedule were
// merged into one atomic RPC. There is no longer a "locked but not yet
// scheduled" intermediate state.
//
// Recipient list: all accepted session_participants EXCEPT the actor (the locker / scheduler).
// notify-dispatch handles the in-app notifications DB row INSERT (which fires realtime
// for the in-app feed) + the OneSignal push delivery + per-user preference/mute gating.
//
// Inspired by notify-session-match (ORCH-0395 + ORCH-0558).

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

type EventKind = "card_locked" | "plan_scheduled";

interface RequestBody {
  sessionId: string;
  savedCardId: string;
  event: EventKind;
  // For event='plan_scheduled' only:
  scheduledAtIso?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json()) as RequestBody;
    const { sessionId, savedCardId, event, scheduledAtIso } = body;

    if (!sessionId || !savedCardId || !event) {
      return jsonResponse(
        { error: "Missing required fields: sessionId, savedCardId, event" },
        400,
      );
    }

    if (event !== "card_locked" && event !== "plan_scheduled") {
      return jsonResponse(
        { error: "Invalid event — must be card_locked or plan_scheduled" },
        400,
      );
    }

    if (event === "plan_scheduled" && !scheduledAtIso) {
      return jsonResponse(
        { error: "scheduledAtIso required for event=plan_scheduled" },
        400,
      );
    }

    // Fetch session + card metadata
    const [sessionRes, cardRes, actorRes] = await Promise.all([
      adminClient
        .from("collaboration_sessions")
        .select("name, created_by")
        .eq("id", sessionId)
        .maybeSingle(),
      adminClient
        .from("board_saved_cards")
        .select("card_data")
        .eq("id", savedCardId)
        .eq("session_id", sessionId)
        .maybeSingle(),
      adminClient
        .from("profiles")
        .select("id, display_name, username")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

    if (!sessionRes.data) {
      return jsonResponse({ error: "Session not found" }, 404);
    }
    if (!cardRes.data) {
      return jsonResponse({ error: "Card not found in session" }, 404);
    }

    const sessionName = sessionRes.data.name || "your session";
    const cardData = cardRes.data.card_data as { title?: string } | null;
    const cardTitle = cardData?.title || "a card";
    const actorName =
      actorRes.data?.display_name || actorRes.data?.username || "Someone";

    // Build notification title + body per event variant
    let title: string;
    let bodyText: string;
    if (event === "card_locked") {
      title = sessionName;
      bodyText = `${actorName} locked in ${cardTitle}`;
    } else {
      title = sessionName;
      // Format the scheduled date in a human-readable way (UTC; client may reformat in user TZ)
      const dt = new Date(scheduledAtIso!);
      const formatted = dt.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      });
      bodyText = `Scheduled for ${formatted}`;
    }

    // Fetch accepted participants except the actor
    const { data: participants, error: partError } = await adminClient
      .from("session_participants")
      .select("user_id")
      .eq("session_id", sessionId)
      .eq("has_accepted", true)
      .neq("user_id", user.id);

    if (partError) {
      console.warn("[notify-session-lock] participants query failed:", partError.message);
      return jsonResponse({ error: partError.message }, 500);
    }

    if (!participants || participants.length === 0) {
      return jsonResponse({
        success: true,
        delivered: 0,
        message: "No other participants to notify",
      });
    }

    const notificationType =
      event === "card_locked" ? "session_card_locked" : "session_plan_scheduled";

    const dispatchResults = await Promise.all(
      participants.map(async (p: { user_id: string }) => {
        try {
          const { data: dispatchData, error: dispatchErr } =
            await adminClient.functions.invoke("notify-dispatch", {
              body: {
                userId: p.user_id,
                type: notificationType,
                title,
                body: bodyText,
                data: {
                  deepLink: `mingla://session/${sessionId}`,
                  sessionId,
                  savedCardId,
                  event,
                  scheduledAt: scheduledAtIso ?? null,
                },
                actorId: user.id,
                relatedId: savedCardId,
                relatedType: "board_saved_card",
                idempotencyKey: `${event}:${sessionId}:${savedCardId}:${p.user_id}`,
                pushOverrides: {
                  androidChannelId: "collaboration",
                  collapseId: `${event}:${sessionId}:${savedCardId}`,
                },
              },
            });
          return {
            userId: p.user_id,
            ok: !dispatchErr,
            data: dispatchData,
            error: dispatchErr,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[notify-session-lock] dispatch exception for ${p.user_id}:`,
            message,
          );
          return {
            userId: p.user_id,
            ok: false,
            data: null,
            error: { message },
          };
        }
      }),
    );

    const deliveredCount = dispatchResults.filter((r) => {
      const d = r.data as { notificationId?: string | null } | null;
      return r.ok && !!d?.notificationId;
    }).length;

    return jsonResponse({
      success: true,
      participants: participants.length,
      delivered: deliveredCount,
      event,
      message: bodyText,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[notify-session-lock] Error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
