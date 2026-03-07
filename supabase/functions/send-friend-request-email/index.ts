import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface FriendRequestPayload {
  senderId: string;
  receiverId?: string;
  receiverEmail: string;
  receiverUsername?: string;
  senderUsername: string;
  senderDisplayName?: string;
  requestId?: string;
  userExists: boolean;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: FriendRequestPayload = await req.json();
    const {
      senderId,
      receiverId,
      receiverUsername,
      senderUsername,
      requestId,
      userExists,
    } = payload;

    // Validate required fields
    if (!senderId || !senderUsername) {
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

    // Get sender's profile for display name
    const { data: senderProfile } = await supabase
      .from("profiles")
      .select("display_name, first_name, last_name")
      .eq("id", senderId)
      .single();

    const senderName =
      senderProfile?.display_name ||
      (senderProfile?.first_name && senderProfile?.last_name
        ? `${senderProfile.first_name} ${senderProfile.last_name}`
        : senderUsername);

    // If user doesn't exist on platform, skip notification entirely
    if (!userExists || !receiverId) {
      console.log("User not on platform or no receiverId, skipping push notification");
      return new Response(
        JSON.stringify({ success: true, method: "none", reason: "user_not_on_platform" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Look up recipient's push token
    const { data: pushTokenData } = await supabase
      .from("user_push_tokens")
      .select("push_token")
      .eq("user_id", receiverId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const pushToken = pushTokenData?.push_token;

    if (!pushToken) {
      console.log("No push token found for user:", receiverId);
      return new Response(
        JSON.stringify({ success: true, method: "none", reason: "no_push_token" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Send push notification via Expo
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: pushToken,
        title: `${senderName} wants to connect`,
        body: "Tap to accept or pass.",
        sound: "default",
        data: {
          type: "friend_request",
          requestId: requestId,
          senderId: senderId,
          senderUsername: senderUsername,
        },
        channelId: "friend-requests",
      }),
    });

    console.log("Push notification sent for friend request");

    return new Response(
      JSON.stringify({ success: true, method: "push" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error sending friend request notification:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Failed to send notification",
        details: error.toString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
