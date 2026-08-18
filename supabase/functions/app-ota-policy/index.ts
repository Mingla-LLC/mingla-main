import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { isTrustedMinglaBrowserOrigin } from "../_shared/appVersionPolicy.ts";
import {
  isSupportedRuntimeVersion,
  OTA_POLICY_REQUEST_HEADERS,
  readAppOtaPolicy,
} from "../_shared/appOtaPolicy.ts";

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowOrigin = origin === null
    ? "*"
    : isTrustedMinglaBrowserOrigin(origin)
    ? origin
    : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": OTA_POLICY_REQUEST_HEADERS,
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };
}

serve(async (req) => {
  const headers = corsHeaders(req);
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
  const runtimeVersion = url.searchParams.get("runtime_version");
  if (
    (appId !== "explorer" && appId !== "business") ||
    (platform !== "ios" && platform !== "android") ||
    !isSupportedRuntimeVersion(runtimeVersion)
  ) {
    return new Response(JSON.stringify({ error: "invalid_request" }), {
      status: 400,
      headers,
    });
  }

  const policy = await readAppOtaPolicy(appId, platform, runtimeVersion);

  // A read failure is a 503, NOT a fabricated 'silent' response. The client
  // already treats every non-answer as silent; inventing a successful-looking
  // body here would make a database outage indistinguishable from a healthy
  // unenforced lane in the logs, which is the observability we are adding.
  return policy === null
    ? new Response(JSON.stringify({ error: "policy_unavailable" }), {
      status: 503,
      headers,
    })
    : new Response(JSON.stringify(policy), { status: 200, headers });
});
