import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Keep-warm ping ──
    const rawBody = await req.json();
    if (rawBody.warmPing) {
      return new Response(JSON.stringify({ status: "warm" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
      );
    }

    const userId = user.id;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ── Parse request body ──
    const { pairedUserId, limit = 20, offset = 0, category } = rawBody as {
      pairedUserId: string;
      limit?: number;
      offset?: number;
      category?: string;
    };

    if (!pairedUserId) {
      return new Response(
        JSON.stringify({ error: "pairedUserId is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // ── Verify pairing ──
    const { data: pairing } = await adminClient
      .from("pairings")
      .select("id")
      .or(
        `and(user_a_id.eq.${userId},user_b_id.eq.${pairedUserId}),and(user_a_id.eq.${pairedUserId},user_b_id.eq.${userId})`,
      )
      .maybeSingle();

    if (!pairing) {
      return new Response(
        JSON.stringify({ error: "Not paired with this user" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 },
      );
    }

    // ── Query saved cards ──
    let query = adminClient
      .from("saved_card")
      .select("id, experience_id, title, category, image_url, card_data, created_at", { count: "exact" })
      .eq("profile_id", pairedUserId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) {
      query = query.eq("category", category);
    }

    const { data: saves, count, error: queryError } = await query;

    if (queryError) {
      console.error("[get-paired-saves] Query error:", queryError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch saves" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    const total = count ?? 0;
    const rows = saves ?? [];

    const mappedSaves = rows.map((row) => {
      const cardData = (row.card_data as Record<string, unknown>) ?? {};
      return {
        id: row.id,
        experienceId: row.experience_id,
        title: row.title ?? (cardData.title as string) ?? "Unknown",
        category: row.category ?? (cardData.category as string) ?? "",
        imageUrl: row.image_url ?? (cardData.image_url as string) ?? null,
        priceTier: (cardData.price_tiers as string[])?.[0] ?? (cardData.price_tier as string) ?? (cardData.priceTier as string) ?? null,
        priceTiers: (cardData.price_tiers as string[])?.length ? (cardData.price_tiers as string[]) : [(cardData.price_tier as string) || 'chill'],
        rating: (cardData.rating as number) ?? null,
        savedAt: row.created_at,
      };
    });

    return new Response(
      JSON.stringify({
        saves: mappedSaves,
        total,
        hasMore: offset + limit < total,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    console.error("[get-paired-saves] Unhandled error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
