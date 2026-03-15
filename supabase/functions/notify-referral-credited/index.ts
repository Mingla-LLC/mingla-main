import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Auth: service role only (called by trigger via pg_net) ───────────
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
      return jsonResponse({ error: "Unauthorized — service role required" }, 401);
    }

    const body = await req.json();
    const { referrerId, referredId, referredName } = body as {
      referrerId: string;
      referredId: string;
      referredName: string;
    };

    if (!referrerId || !referredId || !referredName) {
      return jsonResponse({ error: "referrerId, referredId, and referredName are required" }, 400);
    }

    // ── Call notify-dispatch ─────────────────────────────────────────────
    const notifyUrl = `${SUPABASE_URL}/functions/v1/notify-dispatch`;
    const response = await fetch(notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        userId: referrerId,
        type: "referral_credited",
        title: "You earned a free month!",
        body: `${referredName} joined Mingla from your invite.`,
        data: { deepLink: "mingla://profile?tab=subscription" },
        actorId: referredId,
        relatedId: referredId,
        relatedType: "referral",
        idempotencyKey: `referral_credited:${referrerId}:${referredId}`,
        pushOverrides: {
          androidChannelId: "general",
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "unknown");
      console.error("[notify-referral-credited] notify-dispatch error:", response.status, errText);
      return jsonResponse({ error: "Failed to dispatch notification" }, 500);
    }

    return jsonResponse({ success: true });
  } catch (err: unknown) {
    console.error("[notify-referral-credited] Unhandled error:", err);
    return jsonResponse({ error: (err as Error).message || "Internal server error" }, 500);
  }
});
