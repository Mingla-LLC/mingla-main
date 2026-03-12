import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * process-referral — Notification-only referral reconciliation.
 *
 * The actual crediting (referral_credits.status → 'credited', subscription
 * bonus_months increment) is handled atomically by the DB trigger
 * `credit_referral_on_friend_accepted`. This edge function exists solely to:
 *   1. Look up the referral credit status for a given pair.
 *   2. Send a push notification to the referrer if the credit was awarded.
 *
 * CRIT-002 fix: Validates that the JWT caller is the referrer_id.
 * CRIT-003 fix: No longer performs a read-then-write increment — the DB
 *               trigger handles this atomically.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth: extract caller from JWT ──
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // User-scoped client to extract JWT identity
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callerId = user.id;

    // Service-role client for cross-user reads
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { referrer_id, referred_id } = await req.json();

    // Validate required params
    if (!referrer_id || !referred_id) {
      return new Response(
        JSON.stringify({ error: "Both referrer_id and referred_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // CRIT-002: Caller must be the referrer
    if (callerId !== referrer_id) {
      return new Response(
        JSON.stringify({ error: "Forbidden: you can only process your own referrals" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Look up the referral credit (read-only — no mutations here)
    const { data: credit } = await adminClient
      .from("referral_credits")
      .select("*")
      .eq("referrer_id", referrer_id)
      .eq("referred_id", referred_id)
      .single();

    if (!credit) {
      return new Response(
        JSON.stringify({ credited: false, total_bonus_months: 0, message: "No referral credit found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Read current bonus months (read-only — trigger already incremented)
    const { data: sub } = await adminClient
      .from("subscriptions")
      .select("referral_bonus_months")
      .eq("user_id", referrer_id)
      .single();

    const totalBonusMonths = sub?.referral_bonus_months ?? 0;

    if (credit.status !== "credited") {
      return new Response(
        JSON.stringify({
          credited: false,
          total_bonus_months: totalBonusMonths,
          message: "Referral not yet credited (friend request may still be pending)",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Already credited by the trigger — send push notification if we haven't yet
    const { data: referredProfile } = await adminClient
      .from("profiles")
      .select("display_name, first_name")
      .eq("id", referred_id)
      .single();

    const referredName = referredProfile?.display_name || referredProfile?.first_name || "Your friend";

    try {
      await sendPush({
        targetUserId: referrer_id,
        title: "You earned Elite time!",
        body: `${referredName} joined Mingla! You earned 1 month of Elite.`,
        data: { type: "referral_credited", referred_id },
        androidChannelId: "referral-rewards",
      }).catch(() => {});
    } catch (pushError) {
      console.error("Push notification failed:", pushError);
    }

    return new Response(
      JSON.stringify({
        credited: true,
        total_bonus_months: totalBonusMonths,
        message: "Referral credited successfully",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
