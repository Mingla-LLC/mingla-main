import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body
    const { place_pool_id } = await req.json();
    if (!place_pool_id || typeof place_pool_id !== "string") {
      return new Response(
        JSON.stringify({ error: "place_pool_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Use service role for cross-table operations
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify onboarding complete
    const { data: account } = await admin
      .from("creator_accounts")
      .select("onboarding_completed")
      .eq("id", user.id)
      .single();

    if (!account?.onboarding_completed) {
      return new Response(
        JSON.stringify({ error: "Complete onboarding first" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check place not already claimed
    const { data: place } = await admin
      .from("place_pool")
      .select("id, is_claimed, name")
      .eq("id", place_pool_id)
      .single();

    if (!place) {
      return new Response(
        JSON.stringify({ error: "Place not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (place.is_claimed) {
      return new Response(
        JSON.stringify({ error: "This place is already claimed" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create business profile
    const { data: profile, error: insertError } = await admin
      .from("business_profiles")
      .insert({
        creator_account_id: user.id,
        place_pool_id,
        status: "active",
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[claim-place] insert failed:", insertError.message);
      return new Response(
        JSON.stringify({ error: "Failed to claim place" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update place_pool
    await admin
      .from("place_pool")
      .update({ is_claimed: true, claimed_by: user.id })
      .eq("id", place_pool_id);

    return new Response(
      JSON.stringify({
        business_profile_id: profile.id,
        place_pool_id,
        status: "active",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[claim-place] unexpected:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
