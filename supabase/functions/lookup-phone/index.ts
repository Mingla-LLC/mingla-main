import "https://deno.land/x/xhr@0.3.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { phone_e164 } = await req.json();

    // Validate phone format
    if (!phone_e164 || !/^\+[1-9]\d{1,14}$/.test(phone_e164)) {
      return new Response(
        JSON.stringify({ error: "Invalid phone number format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service role client for cross-user queries
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get caller's phone to prevent self-lookup
    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("phone")
      .eq("id", user.id)
      .single();

    if (callerProfile?.phone === phone_e164) {
      return new Response(
        JSON.stringify({ error: "Cannot look up your own number" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Lookup user by phone
    const { data: foundProfile } = await adminClient
      .from("profiles")
      .select("id, display_name, first_name, last_name, username, avatar_url")
      .eq("phone", phone_e164)
      .limit(1)
      .maybeSingle();

    if (!foundProfile) {
      return new Response(
        JSON.stringify({ found: false, user: null, friendship_status: "none" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if either user blocked the other
    const { data: blockCheck } = await adminClient
      .from("blocked_users")
      .select("id")
      .or(
        `and(blocker_id.eq.${user.id},blocked_id.eq.${foundProfile.id}),and(blocker_id.eq.${foundProfile.id},blocked_id.eq.${user.id})`
      )
      .limit(1);

    if (blockCheck && blockCheck.length > 0) {
      return new Response(
        JSON.stringify({ found: false, user: null, friendship_status: "none" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check friendship status
    let friendshipStatus: string = "none";

    // Check if already friends
    const { data: friendCheck } = await adminClient
      .from("friends")
      .select("id")
      .or(
        `and(user_id.eq.${user.id},friend_user_id.eq.${foundProfile.id}),and(user_id.eq.${foundProfile.id},friend_user_id.eq.${user.id})`
      )
      .eq("status", "accepted")
      .limit(1);

    if (friendCheck && friendCheck.length > 0) {
      friendshipStatus = "friends";
    } else {
      // Check pending friend requests
      const { data: sentRequest } = await adminClient
        .from("friend_requests")
        .select("id")
        .eq("sender_id", user.id)
        .eq("receiver_id", foundProfile.id)
        .eq("status", "pending")
        .limit(1);

      if (sentRequest && sentRequest.length > 0) {
        friendshipStatus = "pending_sent";
      } else {
        const { data: receivedRequest } = await adminClient
          .from("friend_requests")
          .select("id")
          .eq("sender_id", foundProfile.id)
          .eq("receiver_id", user.id)
          .eq("status", "pending")
          .limit(1);

        if (receivedRequest && receivedRequest.length > 0) {
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
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
