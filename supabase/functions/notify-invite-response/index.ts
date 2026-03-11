import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push-utils.ts";

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
    const payload: InviteResponsePayload = await req.json();
    const {
      inviteId,
      response,
      inviterId,
      invitedUserId,
      sessionId,
      sessionName,
    } = payload;

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

    // Look up inviter's push token
    const { data: pushTokenData } = await supabase
      .from("user_push_tokens")
      .select("push_token")
      .eq("user_id", inviterId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const pushToken = pushTokenData?.push_token;

    if (!pushToken) {
      console.log("No push token found for inviter:", inviterId);
      return new Response(
        JSON.stringify({ success: true, method: "none", reason: "no_push_token" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Build push notification copy
    const title = isAccepted
      ? `${invitedName} is in!`
      : `${invitedName} can't make it`;
    const body = isAccepted
      ? `They joined "${sessionName}." Time to plan.`
      : `They passed on "${sessionName}." You can invite someone else.`;

    // Generate deep link for the app
    const deepLink = `mingla://collaboration/session/${sessionId}`;

    // Send push notification to inviter
    try {
      await sendPush(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        {
          to: pushToken,
          title: title,
          body: body,
          sound: "default",
          data: {
            type: "collaboration_invite_response",
            inviteId: inviteId,
            sessionId: sessionId,
            response: response,
            deepLink: deepLink,
          },
          channelId: "collaboration-invites",
        }
      );
      console.log("Push notification sent to inviter for invite response");
    } catch (pushError) {
      console.error("Error sending push notification:", pushError);
      // Don't fail the whole request if push fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        method: "push",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
