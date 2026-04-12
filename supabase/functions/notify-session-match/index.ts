// ORCH-0395: Notify all session participants when a mutual-like match occurs.
// Called by the mobile client after detecting the DB trigger created a match.

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
    // Auth: require authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller is authenticated
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

    // Build the names string
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

    // Fetch session name for deep link context
    const { data: sessionData } = await adminClient
      .from("collaboration_sessions")
      .select("name")
      .eq("id", sessionId)
      .single();

    const sessionName = sessionData?.name || "your session";

    // Send notification to ALL participants via notify-dispatch
    const notifyPromises = participants.map((p: { user_id: string }) =>
      adminClient.functions.invoke("notify-dispatch", {
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
          idempotencyKey: `match:${sessionId}:${experienceId}`,
          pushOverrides: {
            androidChannelId: "collaboration",
            collapseId: `match:${sessionId}`,
          },
        },
      }).catch((err: Error) => {
        console.warn(
          `[notify-session-match] Failed to notify ${p.user_id}:`,
          err.message
        );
      })
    );

    await Promise.allSettled(notifyPromises);

    return jsonResponse({
      success: true,
      notified: participants.length,
      message: body,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[notify-session-match] Error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
