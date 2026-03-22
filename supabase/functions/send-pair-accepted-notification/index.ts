// PAIR REQUEST ACCEPTED NOTIFICATION (Block 3 — hardened 2026-03-21)
// Cloned from send-friend-accepted-notification. Dispatches via notify-dispatch
// so preferences, quiet hours, and push delivery are all handled.
// Called from: usePairings.useAcceptPairRequest.onSuccess
//              useNotifications.acceptPairRequestAction

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PairAcceptedPayload {
  accepterId: string;
  senderId: string;
  requestId?: string;
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
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY"
    )!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // Create a user-scoped client to extract the authenticated user from the JWT
    const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: jwtUser }, error: authError } = await supabaseAuth.auth.getUser();

    if (authError || !jwtUser) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const payload: PairAcceptedPayload = await req.json();
    const { accepterId, senderId, requestId } = payload;

    // Validate required fields first (400 before 403)
    if (!accepterId || !senderId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: accepterId and senderId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Enforce: JWT user must be the accepter (the person who accepted the pair request)
    if (accepterId !== jwtUser.id) {
      return new Response(
        JSON.stringify({ error: "Authenticated user does not match accepterId" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get accepter's profile for display name
    const { data: accepterProfile } = await supabase
      .from("profiles")
      .select("display_name, first_name, last_name, username")
      .eq("id", accepterId)
      .single();

    const accepterName =
      accepterProfile?.display_name ||
      (accepterProfile?.first_name && accepterProfile?.last_name
        ? `${accepterProfile.first_name} ${accepterProfile.last_name}`
        : accepterProfile?.username || "Someone");

    // Send notification via notify-dispatch (handles preference checks, quiet hours, etc.)
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
          userId: senderId,
          type: "pair_request_accepted",
          title: `${accepterName} accepted your pair request`,
          body: "You're now paired — explore together!",
          data: {
            deepLink: "mingla://discover",
            type: "pair_accepted",
            accepterId,
            accepterName,
            requestId,
          },
          actorId: accepterId,
          relatedId: requestId || null,
          relatedType: "pair_request",
          idempotencyKey: `pair_request_accepted:${accepterId}:${requestId || senderId}`,
          pushOverrides: {
            androidChannelId: "social",
          },
        }),
      });
      if (notifyResponse.ok) {
        const result = await notifyResponse.json();
        pushSent = result.pushSent === true;
      } else {
        const errText = await notifyResponse.text().catch(() => "unknown");
        console.warn("[send-pair-accepted-notification] notify-dispatch returned", notifyResponse.status, errText);
      }
    } catch (err: unknown) {
      console.warn('[send-pair-accepted-notification] notify-dispatch call failed:', err);
    }

    console.log("Pair accepted notification processed, push sent:", pushSent);

    return new Response(
      JSON.stringify({ success: true, method: pushSent ? "push" : "push_skipped" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error sending pair accepted notification:", error);
    return new Response(
      JSON.stringify({ error: "Failed to send notification" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
