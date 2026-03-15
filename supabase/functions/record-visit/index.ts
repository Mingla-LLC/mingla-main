import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

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
    const { experienceId, cardData, timeOfDay: clientTimeOfDay } = rawBody as {
      experienceId: string;
      cardData: {
        category: string;
        priceTier?: string;
        lat?: number;
        lng?: number;
        title: string;
        imageUrl?: string;
        distanceKm?: number;
      };
      timeOfDay?: string;
    };

    if (!experienceId) {
      return new Response(
        JSON.stringify({ error: "experienceId is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    if (!cardData || !cardData.category || !cardData.title) {
      return new Response(
        JSON.stringify({ error: "cardData with category and title is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // ── Upsert visit ──
    const { data: visitRow, error: visitError } = await adminClient
      .from("user_visits")
      .upsert(
        {
          user_id: userId,
          experience_id: experienceId,
          card_data: cardData,
          visited_at: new Date().toISOString(),
          source: "manual",
        },
        { onConflict: "user_id,experience_id" },
      )
      .select("id")
      .single();

    if (visitError) {
      console.error("[record-visit] Visit upsert error:", visitError);
      return new Response(
        JSON.stringify({ error: "Failed to record visit" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    // ── Check for existing visit interaction to avoid duplicate triggers ──
    const { data: existingInteraction } = await adminClient
      .from("user_interactions")
      .select("id")
      .eq("user_id", userId)
      .eq("experience_id", experienceId)
      .eq("interaction_type", "visit")
      .maybeSingle();

    let isNew = true;

    if (!existingInteraction) {
      // ── Insert interaction (triggers preference learning) ──
      // Prefer client-provided timeOfDay (device timezone), fall back to server time
      const timeOfDay = clientTimeOfDay || getTimeOfDay();

      const { error: interactionError } = await adminClient
        .from("user_interactions")
        .insert({
          user_id: userId,
          experience_id: experienceId,
          interaction_type: "visit",
          interaction_data: {
            category: cardData.category,
            priceTier: cardData.priceTier ?? null,
            timeOfDay,
            distanceKm: cardData.distanceKm ?? null,
            title: cardData.title,
          },
        });

      if (interactionError) {
        // Non-fatal: visit was recorded, interaction tracking failed
        console.warn("[record-visit] Interaction insert error:", interactionError);
      }
    } else {
      isNew = false;
    }

    return new Response(
      JSON.stringify({ visitId: visitRow.id, isNew }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    console.error("[record-visit] Unhandled error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
