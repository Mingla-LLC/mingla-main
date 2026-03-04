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
    } = payload;

    // Validate required fields
    if (!inviterId || !invitedUserEmail || !sessionId || !sessionName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
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
      .select("display_name, first_name, last_name, username")
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
      // Get invitee's push token
      const { data: tokenData } = await supabase
        .from("user_push_tokens")
        .select("push_token")
        .eq("user_id", invitedUserId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let pushToken = tokenData?.push_token;
      if (!pushToken) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("expo_push_token")
          .eq("id", invitedUserId)
          .single();
        pushToken = profileData?.expo_push_token;
      }

      if (pushToken) {
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: pushToken,
            sound: "default",
            title: "New Collaboration Invite",
            body: `${inviterName} invited you to join "${sessionName}"`,
            data: {
              type: "collaboration_invite_received",
              sessionId: sessionId,
              sessionName: sessionName,
              inviteId: inviteId,
              inviterId: inviterId,
              inviterUsername: inviterUsername,
            },
            channelId: "collaboration-invites",
          }),
        });
        console.log("Push notification sent to invitee successfully");
      } else {
        console.log("No push token found for invitee:", invitedUserId);
      }
    } catch (pushError) {
      console.error("Error sending push notification to invitee:", pushError);
      // Don't fail the whole request if push notification fails
    }

    // Send notification to the INVITER (sender)
    try {
      const { data: inviterTokenData } = await supabase
        .from("user_push_tokens")
        .select("push_token")
        .eq("user_id", inviterId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let inviterPushToken = inviterTokenData?.push_token;
      if (!inviterPushToken) {
        const { data: inviterProfileData } = await supabase
          .from("profiles")
          .select("expo_push_token")
          .eq("id", inviterId)
          .single();
        inviterPushToken = inviterProfileData?.expo_push_token;
      }

      if (inviterPushToken && invitedDisplayName) {
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: inviterPushToken,
            sound: "default",
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
            channelId: "collaboration-invites",
          }),
        });
        console.log("Push notification sent to inviter successfully");
      } else {
        console.log("No push token or display name found for inviter:", inviterId);
      }
    } catch (inviterPushError) {
      console.error("Error sending push notification to inviter:", inviterPushError);
      // Don't fail the whole request if push notification fails
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
