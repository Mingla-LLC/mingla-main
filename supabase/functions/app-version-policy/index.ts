import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { readAppVersionPolicy } from "../_shared/appVersionPolicy.ts";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Cache-Control": "no-store", "Content-Type": "application/json" };
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });
  const url = new URL(req.url); const appId = url.searchParams.get("app_id"); const platform = url.searchParams.get("platform");
  if ((appId !== "explorer" && appId !== "business") || (platform !== "ios" && platform !== "android")) return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400, headers });
  const policy = await readAppVersionPolicy(appId, platform);
  return policy ? new Response(JSON.stringify(policy), { headers }) : new Response(JSON.stringify({ error: "policy_unavailable" }), { status: 503, headers });
});
