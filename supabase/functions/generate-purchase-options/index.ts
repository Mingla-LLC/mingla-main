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

    const { business_profile_id, menu_items, business_type } = await req.json();

    if (!business_profile_id || !menu_items || !Array.isArray(menu_items)) {
      return new Response(
        JSON.stringify({
          error: "business_profile_id and menu_items required",
        }),
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

    const itemType = business_type === "service" ? "services" : "menu items";
    const packageLabel =
      business_type === "service" ? "service packages" : "dining packages";

    // Format items for the prompt
    const itemList = menu_items
      .map(
        (item: { name: string; price: number; category: string }) =>
          `- ${item.name} ($${item.price}) [${item.category}]`
      )
      .join("\n");

    const openaiResp = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 2000,
          messages: [
            {
              role: "system",
              content: `You create appealing ${packageLabel} from ${itemType}. Generate 2-4 packages that a customer would want to buy. Each package bundles items together at an attractive price.

Return a JSON array where each package has:
- "name": string (appealing package name with an emoji prefix)
- "description": string (what's included, 1-2 sentences)
- "price": number (total price, can be slightly discounted vs buying items separately)
- "price_unit": "person" | "pair" | "group" | "flat"
- "included_items": string[] (names of items included)

Return ONLY the JSON array, no other text.`,
            },
            {
              role: "user",
              content: `Here are the ${itemType}:\n${itemList}\n\nCreate ${packageLabel} from these.`,
            },
          ],
        }),
      }
    );

    if (!openaiResp.ok) {
      console.error(
        "[generate-purchase-options] OpenAI error:",
        await openaiResp.text()
      );
      return new Response(
        JSON.stringify({ error: "Couldn't generate suggestions" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const openaiData = await openaiResp.json();
    const rawContent =
      openaiData.choices?.[0]?.message?.content?.trim() ?? "[]";

    let cleanJson = rawContent;
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson
        .replace(/^```(?:json)?\n?/, "")
        .replace(/\n?```$/, "");
    }

    let suggestions;
    try {
      suggestions = JSON.parse(cleanJson);
      if (!Array.isArray(suggestions)) suggestions = [];
    } catch {
      suggestions = [];
    }

    return new Response(JSON.stringify({ suggestions }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[generate-purchase-options] unexpected:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
