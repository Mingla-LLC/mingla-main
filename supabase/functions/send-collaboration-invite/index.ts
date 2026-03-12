import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push-utils.ts";

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

    // Validate required fields — email is only required when userId is absent
    // (push notifications use userId to look up tokens, not email)
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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY"
    )!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

    const inviterUsername = inviterProfile?.username || "user";

    // Get invited user's profile to check if they exist
    const { data: invitedUserProfile } = await supabase
      .from("profiles")
      .select("id, username, display_name")
      .eq("id", invitedUserId)
      .maybeSingle();

    const userExists = !!invitedUserProfile;
    const invitedUsername = invitedUserProfile?.username;
    const invitedDisplayName = invitedUserProfile?.display_name || invitedUsername;

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

    // Send push notification to the INVITED USER (receiver)
    try {
      await sendPush({
        targetUserId: invitedUserId,
        title: "New Collaboration Invite",
        body: `${inviterName} invited you to join "${sessionName}"`,
        data: {
          type: "collaboration_invite_received",
          sessionId: sessionId,
          sessionName: sessionName,
          inviteId: inviteId,
          inviterId: inviterId,
          inviterName: inviterName,
          inviterUsername: inviterUsername,
          inviterAvatarUrl: inviterProfile?.avatar_url || null,
        },
        androidChannelId: "collaboration-invites",
      }).catch(() => {});
      console.log("Push notification sent to invitee successfully");
    } catch (pushError) {
      console.error("Error sending push notification to invitee:", pushError);
    }

    // Send notification to the INVITER (sender)
    try {
      if (invitedDisplayName) {
        await sendPush({
          targetUserId: inviterId,
          title: "Collaboration Invite Sent",
          body: `You invited ${invitedDisplayName} to join "${sessionName}"`,
          data: {
            type: "collaboration_invite_sent",
            sessionId: sessionId,
            sessionName: sessionName,
            inviteId: inviteId,
            invitedUserId: invitedUserId,
            invitedUsername: invitedUsername,
          },
          androidChannelId: "collaboration-invites",
        }).catch(() => {});
        console.log("Push notification sent to inviter successfully");
      }
    } catch (inviterPushError) {
      console.error("Error sending push notification to inviter:", inviterPushError);
    }

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
  } catch (error) {
    console.error("Error sending collaboration invite:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Failed to send invite",
        details: error.toString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
