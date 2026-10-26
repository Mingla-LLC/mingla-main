import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { moderateText } from "../_shared/contentModeration.ts";

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
//
// #4111 — the provider call lives in _shared/contentModeration.ts so the
// public enquiry form uses the same logic. Response shape is unchanged.

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

  const result = await moderateText(text);
  if (result.failure === "key_missing") {
    // Fail open: no key configured, do not block users.
    console.warn("[moderate-content] OPENAI_API_KEY missing — failing open");
  } else if (result.failure === "provider_status") {
    console.warn(
      `[moderate-content] OpenAI returned ${result.providerStatus} — failing open`,
    );
  } else if (result.failure === "network_or_parse") {
    console.warn("[moderate-content] error — failing open");
  }

  if (result.flagged) {
    console.warn(
      `[moderate-content] FLAGGED context=${context} categories=${result.categories.join(",")}`,
    );
  }

  return jsonResponse({ flagged: result.flagged, categories: result.categories });
});
