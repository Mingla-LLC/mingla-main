import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Extract sender_id from JWT
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

    const senderId = jwtUser.id;
    const { receiver_id: receiverId } = await req.json();

    // Validate
    if (!receiverId || typeof receiverId !== "string") {
      return new Response(
        JSON.stringify({ error: "receiver_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (senderId === receiverId) {
      return new Response(
        JSON.stringify({ error: "Cannot send tag-along to yourself" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify receiver is discoverable with seats
    const { data: receiverPresence, error: presenceError } = await supabase
      .from("leaderboard_presence")
      .select("is_discoverable, available_seats, visibility_level, activity_status")
      .eq("user_id", receiverId)
      .maybeSingle();

    if (presenceError || !receiverPresence) {
      return new Response(
        JSON.stringify({ error: "user_not_discoverable" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!receiverPresence.is_discoverable || receiverPresence.available_seats <= 0) {
      return new Response(
        JSON.stringify({ error: "user_not_discoverable" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Expire stale pending requests first
    await supabase
      .from("tag_along_requests")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString());

    // Check for existing pending request
    const { data: pendingReq } = await supabase
      .from("tag_along_requests")
      .select("id")
      .eq("sender_id", senderId)
      .eq("receiver_id", receiverId)
      .eq("status", "pending")
      .maybeSingle();

    if (pendingReq) {
      return new Response(
        JSON.stringify({ error: "pending_request_exists" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check cooldown: no declined request in last 24h
    const cooldownCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: declinedReq } = await supabase
      .from("tag_along_requests")
      .select("responded_at")
      .eq("sender_id", senderId)
      .eq("receiver_id", receiverId)
      .eq("status", "declined")
      .gte("responded_at", cooldownCutoff)
      .order("responded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (declinedReq) {
      return new Response(
        JSON.stringify({
          error: "cooldown_active",
          cooldown_ends_at: new Date(
            new Date(declinedReq.responded_at).getTime() + 24 * 60 * 60 * 1000
          ).toISOString(),
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert the tag-along request
    const { data: newRequest, error: insertError } = await supabase
      .from("tag_along_requests")
      .insert({
        sender_id: senderId,
        receiver_id: receiverId,
        status: "pending",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[send-tag-along] Insert failed:", insertError);
      // Could be unique constraint violation (race condition)
      if (insertError.code === "23505") {
        return new Response(
          JSON.stringify({ error: "pending_request_exists" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Failed to create request", details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already friends
    const { data: friendRow } = await supabase
      .from("friends")
      .select("id")
      .eq("status", "accepted")
      .is("deleted_at", null)
      .or(`and(user_id.eq.${senderId},friend_user_id.eq.${receiverId}),and(user_id.eq.${receiverId},friend_user_id.eq.${senderId})`)
      .maybeSingle();

    const alreadyFriends = !!friendRow;

    // Get sender's profile for the push notification
    const { data: senderProfile } = await supabase
      .from("profiles")
      .select("display_name, first_name, avatar_url")
      .eq("id", senderId)
      .single();

    const senderName = senderProfile?.display_name || senderProfile?.first_name || "Someone";

    // Get sender's level
    const { data: senderLevel } = await supabase
      .from("user_levels")
      .select("level")
      .eq("user_id", senderId)
      .maybeSingle();

    // Send push notification via notify-dispatch
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
          type: "tag_along_received",
          title: `${senderName} wants to tag along`,
          body: receiverPresence.activity_status
            ? `They see you're ${receiverPresence.activity_status.toLowerCase()}`
            : "Someone nearby wants to explore with you",
          data: {
            deepLink: "mingla://discover?tab=near-you",
            type: "tag_along_received",
            requestId: newRequest.id,
            senderId: senderId,
            senderName: senderName,
            senderLevel: senderLevel?.level ?? 1,
            senderAvatarUrl: senderProfile?.avatar_url || null,
          },
          actorId: senderId,
          relatedId: newRequest.id,
          relatedType: "tag_along_request",
          idempotencyKey: `tag_along_received:${senderId}:${newRequest.id}`,
        }),
      });
      if (!notifyResponse.ok) {
        const errText = await notifyResponse.text().catch(() => "unknown");
        console.warn("[send-tag-along] notify-dispatch returned", notifyResponse.status, errText);
      }
    } catch (pushError: unknown) {
      console.warn("[send-tag-along] notify-dispatch call failed:", pushError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        request_id: newRequest.id,
        already_friends: alreadyFriends,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[send-tag-along] Unhandled error:", message);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
