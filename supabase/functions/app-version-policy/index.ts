import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  appVersionCorsHeaders,
  readAppVersionPolicy,
} from "../_shared/appVersionPolicy.ts";

serve(async (req) => {
  const headers = appVersionCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers,
    });
  }

  const url = new URL(req.url);
  const appId = url.searchParams.get("app_id");
  const platform = url.searchParams.get("platform");
  if (
    (appId !== "explorer" && appId !== "business") ||
    (platform !== "ios" && platform !== "android")
  ) {
    return new Response(JSON.stringify({ error: "invalid_request" }), {
      status: 400,
      headers,
    });
  }

  const policy = await readAppVersionPolicy(appId, platform);
  return policy === null
    ? new Response(JSON.stringify({ error: "policy_unavailable" }), {
      status: 503,
      headers,
    })
    : new Response(JSON.stringify(policy), { status: 200, headers });
});
