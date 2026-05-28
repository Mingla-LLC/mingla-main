import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// ORCH-0977 — Content moderation gate for user-generated content.
//
// Apple App Review Guideline 1.2 + Google Play UGC policy require apps with
// user-generated content to filter objectionable material before it is posted.
// Mingla's UGC surfaces (board messages, direct messages, place reviews,
// profile bio) call this function with the candidate text BEFORE inserting it.
//
// Uses OpenAI's Moderation endpoint (free, no per-token charge). On any
// infrastructure failure (missing key, network error, OpenAI outage) the
// function FAILS OPEN — it returns `flagged: false` so a moderation outage
// never blocks all messaging. The report + block features backstop the
// residual. Flagged results are logged for operator review.

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let text = "";
  let context = "";
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text : "";
    context = typeof body?.context === "string" ? body.context : "";
  } catch {
    return jsonResponse({ flagged: false, categories: [] });
  }

  // Empty / whitespace-only text is never objectionable.
  if (!text.trim()) {
    return jsonResponse({ flagged: false, categories: [] });
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    // Fail open: no key configured, do not block users.
    console.warn("[moderate-content] OPENAI_API_KEY missing — failing open");
    return jsonResponse({ flagged: false, categories: [] });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: text.slice(0, 4000),
      }),
    });

    if (!res.ok) {
      console.warn(`[moderate-content] OpenAI returned ${res.status} — failing open`);
      return jsonResponse({ flagged: false, categories: [] });
    }

    const data = await res.json();
    const result = data?.results?.[0];
    const flagged = result?.flagged === true;
    const categories: string[] = flagged && result?.categories
      ? Object.entries(result.categories)
          .filter(([, v]) => v === true)
          .map(([k]) => k)
      : [];

    if (flagged) {
      console.warn(
        `[moderate-content] FLAGGED context=${context} categories=${categories.join(",")}`,
      );
    }

    return jsonResponse({ flagged, categories });
  } catch (err) {
    // Fail open on any network/parse error.
    console.warn(`[moderate-content] error — failing open: ${err}`);
    return jsonResponse({ flagged: false, categories: [] });
  }
});
