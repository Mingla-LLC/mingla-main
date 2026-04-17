import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VALID_VISIBILITY = ["off", "paired", "friends", "friends_of_friends", "everyone"];

interface UpsertPresencePayload {
  lat: number;
  lng: number;
  swiped_category?: string;
  preference_categories?: string[];
  activity_status?: string;
  available_seats?: number;
  is_discoverable?: boolean;
  visibility_level?: string;
}

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

    // Extract user_id from JWT (never from request body)
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

    const userId = jwtUser.id;
    const body: UpsertPresencePayload = await req.json();

    // Validate required fields
    if (typeof body.lat !== "number" || typeof body.lng !== "number") {
      return new Response(
        JSON.stringify({ error: "lat and lng are required numbers" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (body.lat < -90 || body.lat > 90 || body.lng < -180 || body.lng > 180) {
      return new Response(
        JSON.stringify({ error: "lat must be -90..90, lng must be -180..180" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (body.available_seats !== undefined && (body.available_seats < 0 || body.available_seats > 5)) {
      return new Response(
        JSON.stringify({ error: "available_seats must be 0-5" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (body.visibility_level !== undefined && !VALID_VISIBILITY.includes(body.visibility_level)) {
      return new Response(
        JSON.stringify({ error: `visibility_level must be one of: ${VALID_VISIBILITY.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user has an existing presence row (for session_started_at logic)
    const { data: existing } = await supabase
      .from("leaderboard_presence")
      .select("session_started_at, swipe_count, user_level")
      .eq("user_id", userId)
      .maybeSingle();

    // Determine if session needs reset (no existing row or > 24h old)
    const now = new Date();
    let sessionStartedAt = existing?.session_started_at
      ? new Date(existing.session_started_at)
      : null;
    let swipeCount = existing?.swipe_count ?? 0;

    const isNewSession = !sessionStartedAt ||
      (now.getTime() - sessionStartedAt.getTime() > 24 * 60 * 60 * 1000);

    if (isNewSession) {
      sessionStartedAt = now;
      swipeCount = body.swiped_category ? 1 : 0;
    } else if (body.swiped_category) {
      swipeCount += 1;
    }

    // Build the upsert payload
    const upsertData: Record<string, unknown> = {
      user_id: userId,
      lat: body.lat,
      lng: body.lng,
      last_swipe_at: now.toISOString(),
      swipe_count: swipeCount,
      session_started_at: (isNewSession ? now : sessionStartedAt)!.toISOString(),
      updated_at: now.toISOString(),
    };

    if (body.swiped_category !== undefined) {
      // Append swipe count to category for dedup: "drink:17"
      upsertData.last_swiped_category = `${body.swiped_category}:${swipeCount}`;
    }
    if (body.preference_categories !== undefined) {
      upsertData.preference_categories = body.preference_categories;
    }
    if (body.activity_status !== undefined) {
      upsertData.activity_status = body.activity_status;
    }
    if (body.available_seats !== undefined) {
      upsertData.available_seats = body.available_seats;
    }
    if (body.is_discoverable !== undefined) {
      upsertData.is_discoverable = body.is_discoverable;
    }
    if (body.visibility_level !== undefined) {
      upsertData.visibility_level = body.visibility_level;
    }

    // UPSERT into leaderboard_presence
    const { error: upsertError } = await supabase
      .from("leaderboard_presence")
      .upsert(upsertData, { onConflict: "user_id" });

    if (upsertError) {
      console.error("[upsert-leaderboard-presence] Upsert failed:", upsertError);
      return new Response(
        JSON.stringify({ error: "Failed to update presence", details: upsertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if level needs recalculation (stale > 1 hour)
    let userLevel = existing?.user_level ?? 1;
    const { data: levelData } = await supabase
      .from("user_levels")
      .select("level, last_calculated_at")
      .eq("user_id", userId)
      .maybeSingle();

    const isLevelStale = !levelData?.last_calculated_at ||
      (now.getTime() - new Date(levelData.last_calculated_at).getTime() > 60 * 60 * 1000);

    if (isLevelStale) {
      // Call the recalculate RPC
      const { data: newLevel, error: rpcError } = await supabase
        .rpc("recalculate_user_level", { target_user_id: userId });

      if (rpcError) {
        console.warn("[upsert-leaderboard-presence] Level recalc failed:", rpcError.message);
      } else if (newLevel !== null) {
        userLevel = newLevel;
      }
    } else if (levelData) {
      userLevel = levelData.level;
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_level: userLevel,
        swipe_count: swipeCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[upsert-leaderboard-presence] Unhandled error:", message);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
