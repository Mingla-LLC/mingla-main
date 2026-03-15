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

async function callNotifyDispatch(
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const notifyUrl = `${supabaseUrl}/functions/v1/notify-dispatch`;
  const response = await fetch(notifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown");
    console.warn("[notify-pair-activity] notify-dispatch error:", response.status, errText);
  }
}

interface NotifyPairActivityRequest {
  type: "paired_user_saved_card" | "paired_user_visited";
  pairId: string;
  actorId: string;
  recipientId: string;
  cardId?: string;
  cardName?: string;
  visitId?: string;
  placeName?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // ── Parse body ───────────────────────────────────────────────────────
    const body: NotifyPairActivityRequest = await req.json();
    const { type, pairId, actorId, recipientId } = body;

    if (actorId !== user.id) {
      return jsonResponse({ error: "actorId must match authenticated user" }, 403);
    }

    if (!pairId || !recipientId) {
      return jsonResponse({ error: "pairId and recipientId are required" }, 400);
    }

    // ── Get actor profile ────────────────────────────────────────────────
    const { data: actorProfile } = await adminClient
      .from("profiles")
      .select("display_name, first_name, last_name")
      .eq("id", actorId)
      .single();

    const pairName =
      actorProfile?.display_name ||
      [actorProfile?.first_name, actorProfile?.last_name].filter(Boolean).join(" ") ||
      "Your pair";

    // ── Rate limiting via notifications table ────────────────────────────
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    if (type === "paired_user_saved_card") {
      const { cardId, cardName } = body;
      if (!cardId || !cardName) {
        return jsonResponse({ error: "cardId and cardName required for paired_user_saved_card" }, 400);
      }

      // Rate limit: max 3 per day per actor for this type
      const { count } = await adminClient
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("actor_id", actorId)
        .eq("type", "paired_user_saved_card")
        .eq("user_id", recipientId)
        .gte("created_at", oneDayAgo);

      if ((count || 0) >= 3) {
        return jsonResponse({ success: true, skipped: true, reason: "daily_rate_limit" });
      }

      await callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        userId: recipientId,
        type: "paired_user_saved_card",
        title: `${pairName} found something for you`,
        body: `They saved "${cardName}" — take a look.`,
        data: { deepLink: "mingla://discover?paired=true" },
        actorId,
        relatedId: cardId,
        relatedType: "card",
        idempotencyKey: `pair_saved:${pairId}:${cardId}`,
        pushOverrides: {
          androidChannelId: "social",
        },
      });

      return jsonResponse({ success: true, notified: 1 });
    }

    if (type === "paired_user_visited") {
      const { visitId, placeName } = body;
      if (!visitId || !placeName) {
        return jsonResponse({ error: "visitId and placeName required for paired_user_visited" }, 400);
      }

      // Rate limit: max 2 per day per actor for this type
      const { count } = await adminClient
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("actor_id", actorId)
        .eq("type", "paired_user_visited")
        .eq("user_id", recipientId)
        .gte("created_at", oneDayAgo);

      if ((count || 0) >= 2) {
        return jsonResponse({ success: true, skipped: true, reason: "daily_rate_limit" });
      }

      await callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        userId: recipientId,
        type: "paired_user_visited",
        title: `${pairName} visited a place`,
        body: `${pairName} visited ${placeName}`,
        data: { deepLink: "mingla://discover?paired=true" },
        actorId,
        relatedId: visitId,
        relatedType: "visit",
        idempotencyKey: `pair_visited:${pairId}:${visitId}`,
        skipPush: true, // in-app only
        pushOverrides: {
          androidChannelId: "social",
        },
      });

      return jsonResponse({ success: true, notified: 1 });
    }

    return jsonResponse({ error: `Unknown pair activity type: ${type}` }, 400);
  } catch (err: unknown) {
    console.error("[notify-pair-activity] Unhandled error:", err);
    return jsonResponse({ error: (err as Error).message || "Internal server error" }, 500);
  }
});
