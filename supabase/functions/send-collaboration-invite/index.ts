import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CollaborationInvitePayload {
  inviterId: string;
  invitedUserId: string;
  invitedUserEmail: string;
  sessionId: string;
  sessionName: string;
  inviteId?: string;
  phone_e164?: string;  // NEW: for non-app-user invites
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── H2 FIX: Validate JWT and enforce inviterId matches the authenticated user ──
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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY"
    )!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Create a user-scoped client to extract the authenticated user from the JWT
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

    const payload: CollaborationInvitePayload = await req.json();
    const {
      inviterId,
      invitedUserId,
      invitedUserEmail,
      sessionId,
      sessionName,
      inviteId,
      phone_e164,
    } = payload;

    // Enforce: JWT user must be either the inviter OR the invited user.
    // The inviter calls this when sending an invite. The invitee calls this for:
    //   - Revealed invite push (useFriends.ts): after friend accept, invitee's device
    //     triggers push for newly-revealed invites
    //   - Phone catch-up push (index.tsx): after phone verification, invitee's device
    //     triggers push for pending invites
    // Allowing invitedUserId prevents silent 403 failures in both paths.
    if (inviterId !== jwtUser.id && invitedUserId !== jwtUser.id) {
      return new Response(
        JSON.stringify({ error: "Authenticated user is neither the inviter nor the invited user" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // --- TIER GATING NOTE ---
    // Session creation limits (check_session_creation_allowed) and member limits
    // (get_session_member_limit) are enforced client-side and via the DB functions
    // in migration 20260315000008_session_creation_limits.sql.
    // This edge function only handles push notifications for invites —
    // it does NOT create sessions or add participants.

    // Validate required fields — email is only required when userId is absent
    if (!inviterId || !sessionId || !sessionName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: inviterId, sessionId, sessionName" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!invitedUserId && !invitedUserEmail) {
      return new Response(
        JSON.stringify({ error: "Missing required field: invitedUserId or invitedUserEmail" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get inviter's profile
    const { data: inviterProfile } = await supabase
      .from("profiles")
      .select("display_name, first_name, last_name, username, avatar_url")
      .eq("id", inviterId)
      .single();

    const inviterName =
      inviterProfile?.display_name ||
      (inviterProfile?.first_name && inviterProfile?.last_name
        ? `${inviterProfile.first_name} ${inviterProfile.last_name}`
        : inviterProfile?.username || "Someone");

    // Get invited user's profile to check if they exist
    const { data: invitedUserProfile } = await supabase
      .from("profiles")
      .select("id, username, display_name")
      .eq("id", invitedUserId)
      .maybeSingle();

    const userExists = !!invitedUserProfile;

    // NEW: Handle phone-only invites for non-platform users
    if (phone_e164 && !userExists) {
      return new Response(
        JSON.stringify({
          success: true,
          method: "none",
          reason: "user_not_on_platform_phone_stored",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // If user doesn't exist on platform, skip notification entirely
    if (!userExists) {
      console.log("Invited user not on platform, skipping notification");
      return new Response(
        JSON.stringify({ success: true, method: "none", reason: "user_not_on_platform" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Send push notification to the INVITED USER (receiver) via notify-dispatch
    // (notify-dispatch handles preference checks, quiet hours, rate limiting)
    const notifyUrl = `${SUPABASE_URL}/functions/v1/notify-dispatch`;
    try {
      const notifyResponse = await fetch(notifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          userId: invitedUserId,
          type: "collaboration_invite_received",
          title: `${inviterName} invited you to plan`,
          body: `Join "${sessionName}" and start swiping together.`,
          data: {
            deepLink: `mingla://session/${sessionId}`,
            type: "collaboration_invite_received",
            sessionId: sessionId,
            sessionName: sessionName,
            inviteId: inviteId,
            inviterId: inviterId,
            inviterName: inviterName,
            inviterAvatarUrl: inviterProfile?.avatar_url || null,
          },
          actorId: inviterId,
          relatedId: inviteId || sessionId,
          relatedType: "collaboration_invite",
          idempotencyKey: `collaboration_invite_received:${inviterId}:${inviteId || sessionId}`,
          pushOverrides: {
            androidChannelId: "collaboration",
            buttons: [
              { id: "accept", text: "Join" },
              { id: "decline", text: "Decline" },
            ],
          },
        }),
      });
      if (!notifyResponse.ok) {
        const errText = await notifyResponse.text().catch(() => "unknown");
        console.warn("[send-collaboration-invite] notify-dispatch returned", notifyResponse.status, errText);
      } else {
        console.log("Push notification sent to invitee via notify-dispatch");
      }
    } catch (pushError: unknown) {
      console.warn("[send-collaboration-invite] notify-dispatch call failed:", pushError);
    }

    // NOTE: Inviter confirmation push REMOVED per V2 spec — inviter gets a toast instead

    return new Response(
      JSON.stringify({
        success: true,
        method: "push",
        userExists,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    // CRIT-001 FIX: Log full error server-side, return static message to client.
    // Never leak error.message or error.toString() — they can expose internal paths,
    // library versions, and stack traces (OWASP Information Disclosure).
    console.error("Error sending collaboration invite:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to send invite",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
