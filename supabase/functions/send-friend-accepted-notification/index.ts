import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface FriendAcceptedPayload {
  accepterId: string;
  senderId: string;
  requestId?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── JWT Authentication: validate caller identity ──
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

    const payload: FriendAcceptedPayload = await req.json();
    const { accepterId, senderId, requestId } = payload;

    // Enforce: JWT user must be the accepter (the person who accepted the friend request)
    if (accepterId !== jwtUser.id) {
      return new Response(
        JSON.stringify({ error: "Authenticated user does not match accepterId" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate required fields
    if (!accepterId || !senderId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: accepterId and senderId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get accepter's profile for display name
    const { data: accepterProfile } = await supabase
      .from("profiles")
      .select("display_name, first_name, last_name, username")
      .eq("id", accepterId)
      .single();

    const accepterName =
      accepterProfile?.display_name ||
      (accepterProfile?.first_name && accepterProfile?.last_name
        ? `${accepterProfile.first_name} ${accepterProfile.last_name}`
        : accepterProfile?.username || "Someone");

    // Check notification preferences for the SENDER (person receiving the push)
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("friend_requests, push_enabled")
      .eq("user_id", senderId)
      .maybeSingle();

    if (prefs && (prefs.push_enabled === false || prefs.friend_requests === false)) {
      console.log("Sender has disabled friend request notifications, skipping push");
      return new Response(
        JSON.stringify({ success: true, method: "none", reason: "user_disabled_notifications" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Send push notification via OneSignal to the original sender
    let pushSent = false;
    try {
      pushSent = await sendPush({
        targetUserId: senderId,
        title: `${accepterName} accepted your request`,
        body: "You're now connected \u2014 start planning together!",
        data: {
          type: "friend_accepted",
          accepterId: accepterId,
          accepterName: accepterName,
          requestId: requestId,
        },
        androidChannelId: "friend-requests",
      });
    } catch (err: unknown) {
      console.warn('[send-friend-accepted-notification] Push failed:', err);
    }

    console.log("Friend accepted notification processed, push sent:", pushSent);

    return new Response(
      JSON.stringify({ success: true, method: pushSent ? "push" : "push_failed" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error sending friend accepted notification:", error);
    return new Response(
      JSON.stringify({ error: "Failed to send notification" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
