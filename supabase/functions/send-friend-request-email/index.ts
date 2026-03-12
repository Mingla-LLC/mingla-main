import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push-utils.ts";

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

    // Send push notification via OneSignal
    await sendPush({
      targetUserId: receiverId,
      title: `${senderName} wants to connect`,
      body: "Tap to accept or pass.",
      data: {
        type: "friend_request",
        requestId: requestId,
        senderId: senderId,
        senderUsername: senderUsername,
      },
      androidChannelId: "friend-requests",
    }).catch((err) => console.warn('[send-friend-request-email] Push failed:', err));

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
