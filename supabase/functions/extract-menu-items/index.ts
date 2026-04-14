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
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

interface ExtractedItem {
  name: string;
  description: string | null;
  price: number;
  category: string;
  dietary_tags: string[];
  confidence: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth
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

    const { business_profile_id, photo_urls } = await req.json();

    if (
      !business_profile_id ||
      !photo_urls ||
      !Array.isArray(photo_urls) ||
      photo_urls.length === 0
    ) {
      return new Response(
        JSON.stringify({ error: "business_profile_id and photo_urls required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify ownership
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile } = await admin
      .from("business_profiles")
      .select("id")
      .eq("id", business_profile_id)
      .eq("creator_account_id", user.id)
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ error: "Not authorized for this business" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Download photos and convert to base64
    const imageContents: { type: string; image_url: { url: string } }[] = [];
    for (const url of photo_urls.slice(0, 10)) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const buffer = await resp.arrayBuffer();
        const base64 = btoa(
          String.fromCharCode(...new Uint8Array(buffer))
        );
        const contentType = resp.headers.get("content-type") || "image/jpeg";
        imageContents.push({
          type: "image_url",
          image_url: {
            url: `data:${contentType};base64,${base64}`,
          },
        });
      } catch {
        console.warn("[extract-menu-items] Failed to fetch image:", url);
      }
    }

    if (imageContents.length === 0) {
      return new Response(
        JSON.stringify({ error: "Could not read any of the provided photos" }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Call GPT-4o vision
    const openaiResp = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 4000,
          messages: [
            {
              role: "system",
              content: `You are a menu extraction assistant. Extract ALL menu items from the provided menu images. Return a JSON array where each item has:
- "name": string (item name)
- "description": string or null (brief description if visible)
- "price": number (price as a number, no currency symbol)
- "category": string (e.g., "Appetizers", "Mains", "Desserts", "Drinks", "Cocktails", "Wine", "Beer", "Sides", "Specials")
- "dietary_tags": string[] (any of: "vegetarian", "vegan", "gluten-free", "contains-nuts", "contains-fish", "contains-shellfish", "dairy-free", "halal", "kosher", "spicy")
- "confidence": number between 0 and 1 (how confident you are in the extraction accuracy, lower if text was hard to read)

Return ONLY the JSON array, no other text. If you cannot read any items, return an empty array [].`,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract all menu items from these menu images:",
                },
                ...imageContents,
              ],
            },
          ],
        }),
      }
    );

    if (!openaiResp.ok) {
      const errBody = await openaiResp.text();
      console.error("[extract-menu-items] OpenAI error:", errBody);
      return new Response(
        JSON.stringify({ error: "AI couldn't process the menu images" }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const openaiData = await openaiResp.json();
    const rawContent =
      openaiData.choices?.[0]?.message?.content?.trim() ?? "[]";

    // Parse JSON — handle markdown code fences
    let cleanJson = rawContent;
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson
        .replace(/^```(?:json)?\n?/, "")
        .replace(/\n?```$/, "");
    }

    let items: ExtractedItem[];
    try {
      items = JSON.parse(cleanJson);
      if (!Array.isArray(items)) items = [];
    } catch {
      console.error("[extract-menu-items] JSON parse failed:", cleanJson);
      return new Response(
        JSON.stringify({
          error: "Couldn't read the menu clearly. Try again with better lighting.",
        }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate and clean items
    const validItems = items
      .filter(
        (item) =>
          item.name &&
          typeof item.name === "string" &&
          typeof item.price === "number" &&
          item.price >= 0
      )
      .map((item) => ({
        name: item.name.trim(),
        description: item.description?.trim() || null,
        price: Math.round(item.price * 100) / 100,
        category: item.category?.trim() || "Other",
        dietary_tags: Array.isArray(item.dietary_tags)
          ? item.dietary_tags
          : [],
        confidence: typeof item.confidence === "number"
          ? Math.min(1, Math.max(0, item.confidence))
          : 0.8,
      }));

    // Extract unique categories
    const categories = [
      ...new Set(validItems.map((item) => item.category)),
    ];

    return new Response(
      JSON.stringify({
        items: validItems,
        categories,
        total_items: validItems.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[extract-menu-items] unexpected:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
