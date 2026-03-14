import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Fallback categories (birthday defaults) ─────────────────────────────────

const FALLBACK_CATEGORIES = [
  { cardType: "curated", experienceType: "romantic", displayLabel: "Romantic" },
  { cardType: "curated", experienceType: "adventurous", displayLabel: "Adventurous" },
  { cardType: "curated", experienceType: "friendly", displayLabel: "Friendly" },
  { cardType: "single", categorySlug: "fine_dining", displayLabel: "Fine Dining" },
  { cardType: "single", categorySlug: "watch", displayLabel: "Watch" },
  { cardType: "single", categorySlug: "play", displayLabel: "Play" },
];

// ── Known valid values ──────────────────────────────────────────────────────

const VALID_CURATED_TYPES = new Set(["romantic", "adventurous", "friendly"]);
const VALID_CATEGORY_SLUGS = new Set([
  "fine_dining", "watch", "play", "nature", "drink", "casual_eats",
  "picnic", "creative_arts", "wellness", "groceries_flowers",
  "work_business", "first_meet",
]);

// ── Main handler ────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    // --- Parse body ---
    const body = await req.json();
    const { holidayName, holidayDescription } = body;

    if (!holidayName || typeof holidayName !== "string") {
      return new Response(
        JSON.stringify({ error: "holidayName is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // --- Call GPT-4o-mini ---
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      console.warn("[generate-holiday-categories] No OPENAI_API_KEY — returning fallback");
      return new Response(
        JSON.stringify({ categories: FALLBACK_CATEGORIES }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const systemPrompt = `You are a holiday experience planner. Given a holiday name, return exactly 6 category suggestions for places and experiences. Mix curated multi-stop experiences with single-place categories.

Available curated experience types: romantic, adventurous, friendly
Available single-place category slugs: fine_dining, watch, play, nature, drink, casual_eats, picnic, creative_arts, wellness, groceries_flowers, work_business, first_meet

Return JSON: { "categories": [6 objects] }
Each object must have:
- "cardType": "curated" or "single"
- "experienceType": string (only for curated, must be one of the available types)
- "categorySlug": string (only for single, must be one of the available slugs)
- "displayLabel": human-readable label (1-2 words)

Return exactly 6 items. Mix at least 2 curated and 2 single-place categories.`;

    const userPrompt = holidayDescription
      ? `Holiday: ${holidayName}\nDescription: ${holidayDescription}`
      : `Holiday: ${holidayName}`;

    let categories = FALLBACK_CATEGORIES;

    try {
      const openaiRes = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
            max_tokens: 500,
            temperature: 0.8,
          }),
        }
      );

      if (openaiRes.ok) {
        const data = await openaiRes.json();
        const content = data.choices?.[0]?.message?.content;

        if (content) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed.categories) && parsed.categories.length === 6) {
            // Validate each category
            const valid = parsed.categories.every(
              (c: Record<string, unknown>) => {
                if (c.cardType === "curated") {
                  return (
                    typeof c.experienceType === "string" &&
                    VALID_CURATED_TYPES.has(c.experienceType) &&
                    typeof c.displayLabel === "string"
                  );
                }
                if (c.cardType === "single") {
                  return (
                    typeof c.categorySlug === "string" &&
                    VALID_CATEGORY_SLUGS.has(c.categorySlug) &&
                    typeof c.displayLabel === "string"
                  );
                }
                return false;
              }
            );

            if (valid) {
              categories = parsed.categories;
              console.log(
                `[generate-holiday-categories] Generated ${categories.length} categories for "${holidayName}"`
              );
            } else {
              console.warn(
                "[generate-holiday-categories] AI returned invalid categories — using fallback"
              );
            }
          } else {
            console.warn(
              "[generate-holiday-categories] AI returned wrong count — using fallback"
            );
          }
        }
      } else {
        console.warn(
          `[generate-holiday-categories] OpenAI HTTP ${openaiRes.status} — using fallback`
        );
      }
    } catch (aiError) {
      console.warn("[generate-holiday-categories] AI call failed:", aiError);
    }

    return new Response(
      JSON.stringify({ categories }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("[generate-holiday-categories] Unhandled error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
