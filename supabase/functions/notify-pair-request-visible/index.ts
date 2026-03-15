import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    // ── Auth ───────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is authenticated (either service role or user)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Admin client for cross-user lookups
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // ── Parse request body ────────────────────────────────────────────────
    const { pairRequestId } = (await req.json()) as { pairRequestId: string };

    if (!pairRequestId) {
      return jsonResponse({ error: "pairRequestId is required" }, 400);
    }

    // ── Look up the pair request ──────────────────────────────────────────
    const { data: pairRequest, error: prError } = await adminClient
      .from("pair_requests")
      .select("id, sender_id, receiver_id, status, visibility")
      .eq("id", pairRequestId)
      .single();

    if (prError || !pairRequest) {
      return jsonResponse({ error: "Pair request not found" }, 404);
    }

    if (pairRequest.status !== "pending" || pairRequest.visibility !== "visible") {
      return jsonResponse({ error: "Pair request is not pending/visible" }, 400);
    }

    // ── Fetch sender's profile ────────────────────────────────────────────
    const { data: senderProfile } = await adminClient
      .from("profiles")
      .select("first_name, last_name, display_name, avatar_url")
      .eq("id", pairRequest.sender_id)
      .single();

    const senderName =
      senderProfile?.display_name ||
      [senderProfile?.first_name, senderProfile?.last_name].filter(Boolean).join(" ") ||
      "Someone";

    // ── Send push to receiver via notify-dispatch ───────────────────────
    const notifyUrl = `${SUPABASE_URL}/functions/v1/notify-dispatch`;
    let pushSent = false;
    try {
      const notifyResponse = await fetch(notifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          userId: pairRequest.receiver_id,
          type: "pair_request_received",
          title: `${senderName} wants to pair with you`,
          body: "Accept to discover experiences for each other.",
          data: {
            deepLink: `mingla://discover?pairRequest=${pairRequest.id}`,
            type: "pair_request",
            requestId: pairRequest.id,
            senderId: pairRequest.sender_id,
          },
          actorId: pairRequest.sender_id,
          relatedId: pairRequest.id,
          relatedType: "pair_request",
          idempotencyKey: `pair_request_received:${pairRequest.sender_id}:${pairRequest.id}`,
          pushOverrides: {
            androidChannelId: "social",
            buttons: [
              { id: "accept", text: "Accept" },
              { id: "decline", text: "Decline" },
            ],
          },
        }),
      });
      if (notifyResponse.ok) {
        const result = await notifyResponse.json();
        pushSent = result.pushSent === true;
      } else {
        const errText = await notifyResponse.text().catch(() => "unknown");
        console.warn("[notify-pair-request-visible] notify-dispatch returned", notifyResponse.status, errText);
      }
    } catch (err) {
      console.warn("[notify-pair-request-visible] notify-dispatch call failed:", err);
    }

    return jsonResponse({
      success: true,
      pushSent,
      pairRequestId: pairRequest.id,
    });
  } catch (err: unknown) {
    console.error("[notify-pair-request-visible] Error:", err);
    return jsonResponse(
      { error: (err as Error).message || "Internal server error" },
      500
    );
  }
});
