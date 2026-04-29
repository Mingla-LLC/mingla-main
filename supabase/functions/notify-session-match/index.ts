// ORCH-0395 + ORCH-0558: Notify all session participants when a mutual-like match occurs.
// Called by the mobile client after the rpc_record_swipe_and_check_match RPC returns matched=true.
//
// ORCH-0558 changes:
//   - Emits match_telemetry_events per-participant around dispatch (delivered / failed).
//   - NOTE: The in-app notifications DB row is ALREADY inserted by notify-dispatch
//     BEFORE it attempts push delivery (see notify-dispatch/index.ts lines 187-208).
//     So the I-MATCH-NOTIFICATION-FAILS-OPEN invariant is already structurally
//     satisfied: push failure cannot hide the match from the in-app feed because
//     the `notifications` row exists before the push is ever attempted.
//     The `useNotifications` hook subscribes via Supabase Realtime to the
//     `notifications` table and renders in-app instantly on INSERT.
//
// Therefore this edge fn does NOT need to add a separate in-app INSERT.
// It only needs to emit telemetry so engineering sees every delivery + failure.

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

    const { sessionId, savedCardId, experienceId, cardTitle, matchedUserIds } =
      await req.json();

    if (!sessionId || !savedCardId || !matchedUserIds?.length) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    // Fetch all active session participants
    const { data: participants, error: partError } = await adminClient
      .from("session_participants")
      .select("user_id")
      .eq("session_id", sessionId)
      .eq("has_accepted", true);

    if (partError || !participants?.length) {
      return jsonResponse({ error: "No participants found" }, 404);
    }

    // Fetch display names for matched users
    const { data: profiles } = await adminClient
      .from("profiles")
      .select("id, display_name, username")
      .in("id", matchedUserIds);

    const nameMap = new Map<string, string>();
    for (const p of profiles || []) {
      nameMap.set(p.id, p.display_name || p.username || "Someone");
    }

    const names = matchedUserIds
      .map((id: string) => nameMap.get(id) || "Someone")
      .filter(Boolean);

    let namesStr: string;
    if (names.length === 2) {
      namesStr = `${names[0]} and ${names[1]}`;
    } else if (names.length > 2) {
      const last = names.pop();
      namesStr = `${names.join(", ")}, and ${last}`;
    } else {
      namesStr = names[0] || "Someone";
    }

    const title = "It's a match! 🎉";
    const body = `There's been a match: ${namesStr} liked ${cardTitle || "a spot"}`;

    const { data: sessionData } = await adminClient
      .from("collaboration_sessions")
      .select("name")
      .eq("id", sessionId)
      .single();

    const sessionName = sessionData?.name || "your session";

    // ---------- ORCH-0558: dispatch + per-participant telemetry ----------
    // notify-dispatch handles:
    //   (1) notifications DB row insert (fires realtime INSERT → in-app feed)
    //   (2) preference/quiet-hours/mute gates
    //   (3) OneSignal push
    // Push failure is surfaced via {pushSent: false} in the JSON response —
    // the DB row remains, so in-app fails open.

    const dispatchResults = await Promise.all(
      participants.map(async (p: { user_id: string }) => {
        try {
          const { data: dispatchData, error: dispatchErr } = await adminClient.functions.invoke(
            "notify-dispatch",
            {
              body: {
                userId: p.user_id,
                type: "board_card_matched",
                title,
                body,
                data: {
                  deepLink: `mingla://session/${sessionId}`,
                  sessionId,
                  savedCardId,
                  experienceId,
                  sessionName,
                },
                actorId: user.id,
                relatedId: savedCardId,
                relatedType: "board_saved_card",
                idempotencyKey: `match:${sessionId}:${experienceId}:${p.user_id}`,
                pushOverrides: {
                  androidChannelId: "collaboration",
                  collapseId: `match:${sessionId}`,
                },
              },
            },
          );

          return { userId: p.user_id, ok: !dispatchErr, data: dispatchData, error: dispatchErr };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[notify-session-match] dispatch exception for ${p.user_id}:`,
            message,
          );
          return { userId: p.user_id, ok: false, data: null, error: { message } };
        }
      }),
    );

    // Telemetry: delivered vs failed (in-app surfaced regardless; push status
    // reported separately in reason field).
    const telemetryRows = dispatchResults.map((r) => {
      if (!r.ok) {
        return {
          event_type: "collab_match_notification_failed",
          session_id: sessionId,
          experience_id: experienceId,
          user_id: r.userId,
          saved_card_id: savedCardId,
          reason: `dispatch_error: ${(r.error as { message?: string })?.message ?? "unknown"}`,
        };
      }
      const dispatchData = r.data as
        | { success?: boolean; pushSent?: boolean; notificationId?: string | null; reason?: string }
        | null;
      const inAppSucceeded = !!dispatchData?.notificationId;
      const pushSucceeded = !!dispatchData?.pushSent;
      const reason = inAppSucceeded
        ? pushSucceeded
          ? "in_app_and_push"
          : `in_app_only:${dispatchData?.reason ?? "no_push"}`
        : `dispatch_reported:${dispatchData?.reason ?? "unknown"}`;
      return {
        event_type: inAppSucceeded
          ? "collab_match_notification_delivered"
          : "collab_match_notification_failed",
        session_id: sessionId,
        experience_id: experienceId,
        user_id: r.userId,
        saved_card_id: savedCardId,
        reason,
      };
    });

    if (telemetryRows.length > 0) {
      const { error: telemetryErr } = await adminClient
        .from("match_telemetry_events")
        .insert(telemetryRows);
      if (telemetryErr) {
        console.warn(
          "[notify-session-match] telemetry insert failed:",
          telemetryErr.message,
        );
      }
    }

    const deliveredCount = dispatchResults.filter((r) => {
      const d = r.data as { notificationId?: string | null } | null;
      return r.ok && !!d?.notificationId;
    }).length;

    return jsonResponse({
      success: true,
      participants: participants.length,
      delivered: deliveredCount,
      message: body,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[notify-session-match] Error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
