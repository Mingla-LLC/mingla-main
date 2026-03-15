import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InviteResponsePayload {
  inviteId: string;
  response: "accepted" | "declined";
  inviterId: string;
  invitedUserId: string;
  sessionId: string;
  sessionName: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── HIGH-001 FIX: Validate JWT — the invitee (responder) must be authenticated ──
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Supabase configuration missing" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: jwtUser }, error: authError } = await supabaseAuth.auth.getUser();

    if (authError || !jwtUser) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const payload: InviteResponsePayload = await req.json();
    const {
      inviteId,
      response,
      inviterId,
      invitedUserId,
      sessionId,
      sessionName,
    } = payload;

    // Enforce: JWT user must be the invited user (the one responding to the invite)
    if (jwtUser.id !== invitedUserId) {
      return new Response(
        JSON.stringify({ error: "Authenticated user does not match invitedUserId" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate required fields
    if (
      !inviteId ||
      !response ||
      !inviterId ||
      !invitedUserId ||
      !sessionId ||
      !sessionName
    ) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Initialize Supabase client with service role key
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch invited user's profile for display name
    const { data: invitedUserProfile, error: invitedUserError } = await supabase
      .from("profiles")
      .select("id, display_name, first_name, last_name, username")
      .eq("id", invitedUserId)
      .single();

    if (invitedUserError || !invitedUserProfile) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch invited user profile" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const invitedName =
      invitedUserProfile.display_name ||
      `${invitedUserProfile.first_name || ""} ${
        invitedUserProfile.last_name || ""
      }`.trim() ||
      invitedUserProfile.username ||
      "Someone";

    const isAccepted = response === "accepted";

    // Build notification copy
    const title = isAccepted
      ? `${invitedName} is in!`
      : `${invitedName} can't make it`;
    const body = isAccepted
      ? `They joined "${sessionName}." Time to plan.`
      : `They passed on "${sessionName}." Invite someone else?`;

    // Send notification via notify-dispatch
    // (handles preference checks, quiet hours, rate limiting)
    const notifyUrl = `${SUPABASE_URL}/functions/v1/notify-dispatch`;
    try {
      const notifyResponse = await fetch(notifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          userId: inviterId,
          type: isAccepted ? "collaboration_invite_accepted" : "collaboration_invite_declined",
          title,
          body,
          data: {
            deepLink: `mingla://session/${sessionId}`,
            type: "collaboration_invite_response",
            inviteId: inviteId,
            sessionId: sessionId,
            response: response,
          },
          actorId: invitedUserId,
          relatedId: inviteId,
          relatedType: "collaboration_invite",
          idempotencyKey: isAccepted
            ? `collaboration_invite_accepted:${invitedUserId}:${inviteId}`
            : `collaboration_invite_declined:${invitedUserId}:${inviteId}`,
          pushOverrides: {
            androidChannelId: "collaboration",
          },
          // Declined invites are in-app only (no push)
          skipPush: !isAccepted,
        }),
      });
      if (!notifyResponse.ok) {
        const errText = await notifyResponse.text().catch(() => "unknown");
        console.warn("[notify-invite-response] notify-dispatch returned", notifyResponse.status, errText);
      } else {
        console.log("Invite response notification sent via notify-dispatch");
      }
    } catch (pushError) {
      console.warn("[notify-invite-response] notify-dispatch call failed:", pushError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        method: isAccepted ? "push" : "in_app_only",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[notify-invite-response] Unhandled error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
