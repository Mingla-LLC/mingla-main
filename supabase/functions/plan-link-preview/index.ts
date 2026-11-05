// Issue #4261 — plan-link-preview: POST {planId} with the user's JWT.
// Fetches the page previews of a plan's links (the plan's own link and its
// place options' links) and stores them for chat_plans_for_conversation.
// verify_jwt stays at the platform default (true).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchLinkPreview, handlePlanLinkPreview } from "./linkPreview.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  try {
    return await handlePlanLinkPreview(req, {
      linkTargets: async (authorization, planId) => {
        const user = createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: authorization } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await user.rpc("chat_plan_link_targets", { p_plan_id: planId });
        return { data, error };
      },
      storePreview: async (input) => {
        const { error } = await service.rpc("chat_plan_link_preview_store", {
          p_url: input.url,
          p_outcome: input.outcome,
          p_title: input.title,
          p_site_name: input.siteName,
          p_image_url: input.imageUrl,
          p_final_url: input.finalUrl,
        });
        return { error };
      },
      fetchPreview: (url) => fetchLinkPreview(url),
    });
  } catch (error) {
    console.error("[plan-link-preview] unhandled", error);
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
