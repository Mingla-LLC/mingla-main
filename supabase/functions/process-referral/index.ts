import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // ── AppsFlyer S2S: referral_completed ──────────────────────────────────
    // Fire to every registered device for the referrer. Non-blocking — a
    // failed attribution call must never break the referral notification flow.
    const afDevKey = Deno.env.get("APPSFLYER_DEV_KEY") ?? "";
    if (afDevKey) {
      try {
        const { data: devices } = await adminClient
          .from("appsflyer_devices")
          .select("appsflyer_uid, platform, app_id")
          .eq("user_id", referrer_id);

        if (devices && devices.length > 0) {
          const eventTime = new Date().toISOString().replace("T", " ").slice(0, 19);
          await Promise.allSettled(
            devices.map((device) =>
              fetch(`https://api2.appsflyer.com/inappevent/${device.app_id}`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  authentication: afDevKey,
                },
                body: JSON.stringify({
                  appsflyer_id: device.appsflyer_uid,
                  customer_user_id: referrer_id,
                  eventName: "referral_completed",
                  eventValue: JSON.stringify({
                    referred_user_id: referred_id,
                  }),
                  eventTime,
                  bundleIdentifier: device.app_id,
                }),
                signal: AbortSignal.timeout(5000),
              }).then(async (res) => {
                if (!res.ok) {
                  const body = await res.text().catch(() => "unknown");
                  console.warn(
                    `[process-referral] AppsFlyer S2S failed (${device.platform}):`,
                    res.status,
                    body,
                  );
                }
              })
            ),
          );
        }
      } catch (afError) {
        console.warn("[process-referral] AppsFlyer S2S error:", afError);
      }
    }

    // Already credited by the trigger — send notification via the full pipeline.
    // notify-dispatch handles: DB row insert (in-app), preference checks, quiet
    // hours, rate limiting, AND push delivery. Previously this called sendPush
    // directly, which skipped all of those and left nothing in the notification center.
    const { data: referredProfile } = await adminClient
      .from("profiles")
      .select("display_name, first_name")
      .eq("id", referred_id)
      .single();

    const referredName = referredProfile?.display_name || referredProfile?.first_name || "Your friend";

    try {
      const notifyUrl = `${supabaseUrl}/functions/v1/notify-dispatch`;
      const notifyResponse = await fetch(notifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          userId: referrer_id,
          type: "referral_credited",
          title: "You earned Mingla+ time!",
          body: `${referredName} joined Mingla! You earned 1 month of Mingla+.`,
          data: {
            deepLink: "mingla://subscription",
            type: "referral_credited",
            referredId: referred_id,
            referredName,
          },
          actorId: referred_id,
          relatedId: referred_id,
          relatedType: "referral",
          idempotencyKey: `referral_credited:${referrer_id}:${referred_id}`,
          pushOverrides: {
            androidChannelId: "referral-rewards",
          },
        }),
      });
      if (!notifyResponse.ok) {
        const errText = await notifyResponse.text().catch(() => "unknown");
        console.warn("[process-referral] notify-dispatch returned", notifyResponse.status, errText);
      }
    } catch (pushError) {
      console.warn("[process-referral] notify-dispatch call failed:", pushError);
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
