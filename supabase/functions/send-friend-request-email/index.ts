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
    // ── JWT Authentication: validate caller identity ──
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: jwtUser }, error: authError } = await supabaseAuth.auth.getUser();

    if (authError || !jwtUser) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload: FriendRequestPayload = await req.json();
    const {
      senderId,
      receiverId,
      receiverUsername,
      senderUsername,
      requestId,
      userExists,
    } = payload;

    // Enforce: JWT user must be the sender
    if (senderId !== jwtUser.id) {
      return new Response(
        JSON.stringify({ error: "Authenticated user does not match senderId" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

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

    // Send notification via notify-dispatch (handles preference checks, quiet hours, etc.)
    const notifyUrl = `${SUPABASE_URL}/functions/v1/notify-dispatch`;
    try {
      const notifyResponse = await fetch(notifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          userId: receiverId,
          type: "friend_request_received",
          title: `${senderName} wants to connect`,
          body: "Tap to accept or pass.",
          data: {
            deepLink: "mingla://connections?tab=requests",
            type: "friend_request",
            requestId: requestId,
            senderId: senderId,
            senderUsername: senderUsername,
          },
          actorId: senderId,
          relatedId: requestId || null,
          relatedType: "friend_request",
          idempotencyKey: `friend_request_received:${senderId}:${requestId || receiverId}`,
          pushOverrides: {
            androidChannelId: "social",
            buttons: [
              { id: "accept", text: "Accept" },
              { id: "decline", text: "Decline" },
            ],
          },
        }),
      });
      if (!notifyResponse.ok) {
        const errText = await notifyResponse.text().catch(() => "unknown");
        console.warn("[send-friend-request-email] notify-dispatch returned", notifyResponse.status, errText);
      }
    } catch (err) {
      console.warn("[send-friend-request-email] notify-dispatch call failed:", err);
    }

    console.log("Push notification sent for friend request via notify-dispatch");

    return new Response(
      JSON.stringify({ success: true, method: "push" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error sending friend request notification:", error);
    return new Response(
      JSON.stringify({
        error: (error as Error).message || "Failed to send notification",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
