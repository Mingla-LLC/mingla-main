import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestBody {
  personId: string;
  personName: string;
  gender: string | null;
  description: string | null;
  linkedUserId?: string;
}

function getPronouns(gender: string | null): {
  subject: string;
  possessive: string;
} {
  if (!gender) return { subject: "They", possessive: "their" };
  const g = gender.toLowerCase();
  if (g === "female" || g === "woman" || g === "she")
    return { subject: "She", possessive: "her" };
  if (g === "male" || g === "man" || g === "he")
    return { subject: "He", possessive: "his" };
  return { subject: "They", possessive: "their" };
}

function getFallbackSummary(gender: string | null): string {
  const { subject } = getPronouns(gender);
  if (subject === "She")
    return "She'd love a night out with great food and fun";
  if (subject === "He")
    return "He'd love a night out with great food and fun";
  return "They'd love a night out with great food and fun";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Parse & validate body ---
    const body: RequestBody = await req.json();
    const { personId, personName, gender, description, linkedUserId } = body;

    if (!personId || !UUID_RE.test(personId)) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing personId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (!personName || typeof personName !== "string") {
      return new Response(
        JSON.stringify({ error: "Invalid or missing personName" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (linkedUserId && !UUID_RE.test(linkedUserId)) {
      return new Response(
        JSON.stringify({ error: "Invalid linkedUserId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // --- Collect context ---
    const contextParts: string[] = [];

    if (description && description.trim().length > 0) {
      contextParts.push(`Description: ${description.trim()}`);
    }

    // Fetch linked user's top saved categories
    if (linkedUserId) {
      const adminClient = createClient(supabaseUrl, supabaseServiceKey);
      const { data: savedCards } = await adminClient
        .from("saved_cards")
        .select("category")
        .eq("user_id", linkedUserId)
        .eq("status", "saved");

      if (savedCards && savedCards.length > 0) {
        // Count categories and get top 5
        const catCounts: Record<string, number> = {};
        for (const sc of savedCards) {
          if (sc.category) {
            catCounts[sc.category] = (catCounts[sc.category] || 0) + 1;
          }
        }
        const topCategories = Object.entries(catCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([cat]) => cat);

        if (topCategories.length > 0) {
          contextParts.push(
            `Their saved interest categories: ${topCategories.join(", ")}`
          );
        }
      }
    }

    // --- Build prompt ---
    const { subject, possessive } = getPronouns(gender);
    const pronounInfo = `Use "${subject.toLowerCase()}" / "${possessive}" pronouns.`;

    const userPromptParts = [
      `Person's name: ${personName}`,
      pronounInfo,
    ];
    if (contextParts.length > 0) {
      userPromptParts.push(`Context:\n${contextParts.join("\n")}`);
    }

    const userPrompt = userPromptParts.join("\n");

    // --- Call OpenAI ---
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      // No API key — return fallback
      return new Response(
        JSON.stringify({ summary: getFallbackSummary(gender) }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let summary: string;

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
              {
                role: "system",
                content:
                  'Generate a 1-sentence gift/experience suggestion for a person. Be specific and personal. Max 80 characters. Return JSON: { "summary": "..." }',
              },
              {
                role: "user",
                content: userPrompt,
              },
            ],
            response_format: { type: "json_object" },
            max_tokens: 100,
            temperature: 0.7,
          }),
        }
      );

      if (!openaiRes.ok) {
        summary = getFallbackSummary(gender);
      } else {
        const openaiData = await openaiRes.json();
        const content = openaiData.choices?.[0]?.message?.content;

        if (!content) {
          summary = getFallbackSummary(gender);
        } else {
          try {
            const parsed = JSON.parse(content);
            summary =
              typeof parsed.summary === "string" && parsed.summary.length > 0
                ? parsed.summary
                : getFallbackSummary(gender);
          } catch {
            summary = getFallbackSummary(gender);
          }
        }
      }
    } catch {
      summary = getFallbackSummary(gender);
    }

    return new Response(JSON.stringify({ summary }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Invalid request body" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
