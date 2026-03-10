import "https://deno.land/x/xhr@0.3.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const NOT_FOUND_RESPONSE = JSON.stringify({
  found: false,
  user: null,
  friendship_status: "none",
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate JWT
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: jsonHeaders }
      );
    }

    // Create user-scoped client to get caller identity
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: jsonHeaders }
      );
    }

    // Parse request body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const phone_e164 = body.phone_e164 as string | undefined;

    // Validate phone format — require full E.164 (minimum 8 digits: +X plus 7+ digits)
    if (!phone_e164 || !/^\+[1-9]\d{6,14}$/.test(phone_e164)) {
      return new Response(
        JSON.stringify({ error: "Invalid phone number format" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // Service role client for cross-user queries
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get caller's phone to prevent self-lookup (use maybeSingle — profile may not exist during onboarding)
    const { data: callerProfile, error: callerError } = await adminClient
      .from("profiles")
      .select("phone")
      .eq("id", user.id)
      .maybeSingle();

    if (callerError) {
      console.error("[lookup-phone] Error fetching caller profile:", callerError.message);
      // Non-fatal: continue without self-lookup check
    }

    if (callerProfile?.phone === phone_e164) {
      return new Response(
        JSON.stringify({ error: "Cannot look up your own number" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // Lookup user by phone
    const { data: foundProfile, error: lookupError } = await adminClient
      .from("profiles")
      .select("id, display_name, first_name, last_name, username, avatar_url")
      .eq("phone", phone_e164)
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      console.error("[lookup-phone] Error looking up profile:", lookupError.message);
      return new Response(NOT_FOUND_RESPONSE, { headers: jsonHeaders });
    }

    if (!foundProfile) {
      return new Response(NOT_FOUND_RESPONSE, { headers: jsonHeaders });
    }

    // Check if either user blocked the other
    const { data: blockCheck, error: blockError } = await adminClient
      .from("blocked_users")
      .select("id")
      .or(
        `and(blocker_id.eq.${user.id},blocked_id.eq.${foundProfile.id}),and(blocker_id.eq.${foundProfile.id},blocked_id.eq.${user.id})`
      )
      .limit(1);

    if (blockError) {
      console.error("[lookup-phone] Error checking blocks:", blockError.message);
      // Non-fatal: treat as not blocked and continue
    }

    if (blockCheck && blockCheck.length > 0) {
      return new Response(NOT_FOUND_RESPONSE, { headers: jsonHeaders });
    }

    // Check friendship status
    let friendshipStatus: string = "none";

    // Check if already friends (legacy friends table)
    const { data: friendCheck, error: friendError } = await adminClient
      .from("friends")
      .select("id")
      .or(
        `and(user_id.eq.${user.id},friend_user_id.eq.${foundProfile.id}),and(user_id.eq.${foundProfile.id},friend_user_id.eq.${user.id})`
      )
      .eq("status", "accepted")
      .limit(1);

    if (friendError) {
      console.error("[lookup-phone] Error checking friends:", friendError.message);
    }

    if (friendCheck && friendCheck.length > 0) {
      friendshipStatus = "friends";
    } else {
      // Check accepted friend_links (new system)
      const { data: acceptedLink } = await adminClient
        .from("friend_links")
        .select("id")
        .or(
          `and(requester_id.eq.${user.id},target_id.eq.${foundProfile.id}),and(requester_id.eq.${foundProfile.id},target_id.eq.${user.id})`
        )
        .eq("status", "accepted")
        .limit(1);

      if (acceptedLink && acceptedLink.length > 0) {
        friendshipStatus = "friends";
      }
    }

    if (friendshipStatus === "none") {
      // Check pending friend_requests (legacy)
      const { data: sentRequest, error: sentError } = await adminClient
        .from("friend_requests")
        .select("id")
        .eq("sender_id", user.id)
        .eq("receiver_id", foundProfile.id)
        .eq("status", "pending")
        .limit(1);

      if (sentError) {
        console.error("[lookup-phone] Error checking sent requests:", sentError.message);
      }

      if (sentRequest && sentRequest.length > 0) {
        friendshipStatus = "pending_sent";
      } else {
        const { data: receivedRequest, error: recvError } = await adminClient
          .from("friend_requests")
          .select("id")
          .eq("sender_id", foundProfile.id)
          .eq("receiver_id", user.id)
          .eq("status", "pending")
          .limit(1);

        if (recvError) {
          console.error("[lookup-phone] Error checking received requests:", recvError.message);
        }

        if (receivedRequest && receivedRequest.length > 0) {
          friendshipStatus = "pending_received";
        }
      }
    }

    if (friendshipStatus === "none") {
      // Check pending friend_links (new system)
      const { data: sentLink } = await adminClient
        .from("friend_links")
        .select("id")
        .eq("requester_id", user.id)
        .eq("target_id", foundProfile.id)
        .eq("status", "pending")
        .limit(1);

      if (sentLink && sentLink.length > 0) {
        friendshipStatus = "pending_sent";
      } else {
        const { data: receivedLink } = await adminClient
          .from("friend_links")
          .select("id")
          .eq("requester_id", foundProfile.id)
          .eq("target_id", user.id)
          .eq("status", "pending")
          .limit(1);

        if (receivedLink && receivedLink.length > 0) {
          friendshipStatus = "pending_received";
        }
      }
    }

    return new Response(
      JSON.stringify({
        found: true,
        user: {
          id: foundProfile.id,
          display_name: foundProfile.display_name,
          first_name: foundProfile.first_name,
          last_name: foundProfile.last_name,
          username: foundProfile.username,
          avatar_url: foundProfile.avatar_url,
        },
        friendship_status: friendshipStatus,
      }),
      { headers: jsonHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[lookup-phone] Unhandled error:", error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: jsonHeaders }
    );
  }
});
