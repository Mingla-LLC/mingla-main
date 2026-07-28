/**
 * admin-ad-google-provision-conversion — ISSUE-1267 [Google Ads, the 5th
 * server-side conversion lane].
 *
 * The admin one-shot that lights up the Google upload lane. It has NOTHING to do
 * with the create-path bidding flip (targetSpend → maximizeConversions) — that is
 * a gated follow-on and is deliberately untouched here.
 *
 * Body: { lane?='consumer', action?, name?, attribution_window_days?, sample_gclid? }
 *   action = 'provision'      (default) — create a PURCHASE / UPLOAD_CLICKS /
 *                             ONE_PER_CLICK conversion action via
 *                             customers/{id}/conversionActions:mutate and STORE the
 *                             returned resource name in
 *                             ad_connections.extra.conversion_action_resource
 *                             (CONFIG, not a secret).
 *   action = 'validate'       — the SAME mutate with validateOnly:true (Google
 *                             validates the create with ZERO objects created); the
 *                             resource is NOT stored.
 *   action = 'validate_upload'— fire a synthetic uploadClickConversions with
 *                             validateOnly:true (ZERO real conversion objects) to
 *                             live-validate the end-to-end upload lane at deploy.
 *
 * Fail-close on provisioning gaps (mirrors admin-ad-connect's Google branch):
 *   secrets unset → 409 google_not_provisioned; mint/permission failure → 424.
 * The orchestrator runs this ONCE at deploy. NO token/secret value ever appears in
 * any response, row, or log (SC-SEC-1); the conversion-action id is config.
 *
 * verify_jwt = true (config.toml) + in-code admin_users active gate.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AdApiError,
  type AdConnectionRow,
  AdNotConnectedError,
  isLane,
  type Lane,
} from "../_shared/adChannel.ts";
import { GOOGLE_ADS_DEFAULT_API_VERSION } from "../_shared/google.ts";
import {
  provisionGoogleConversionAction,
  sendGoogleConversion,
} from "../_shared/googleConversionUpload.ts";
import type { ConversionSendInput } from "../_shared/adConversionFire.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const PROVISIONED_ERROR_DETAIL =
  `Set the Google Ads Function Secrets (GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_OAUTH_CLIENT_ID, GOOGLE_ADS_OAUTH_CLIENT_SECRET, GOOGLE_ADS_LOGIN_CUSTOMER_ID, GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_API_VERSION=${GOOGLE_ADS_DEFAULT_API_VERSION}) and connect the Google lane (admin-ad-connect), then retry.`;

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // ── ADMIN GATE FIRST (auth precedes input validation — mirrors admin-ad-*). ──
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    token,
  );
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  if (!adminRow) return json({ error: "forbidden" }, 403);

  const lane = body.lane ?? "consumer";
  const action = (body.action ?? "provision") as string;
  if (!isLane(lane)) {
    return json({ error: "validation_error", detail: "lane_invalid" }, 400);
  }
  if (
    action !== "provision" && action !== "validate" &&
    action !== "validate_upload"
  ) {
    return json({ error: "validation_error", detail: "action_invalid" }, 400);
  }

  // The Google lane must already be connected (admin-ad-connect) so there is a row
  // to hang the conversion-action config on and a token_env_var to mint from.
  const { data: existing } = await supabase
    .from("ad_connections")
    .select("*")
    .eq("platform", "google")
    .eq("lane", lane)
    .maybeSingle();
  const connection = (existing ?? null) as AdConnectionRow | null;
  if (!connection) {
    return json({
      error: "google_not_provisioned",
      detail:
        `No Google connection row for the ${lane} lane. Connect Google first (admin-ad-connect), then provision the conversion action.`,
    }, 409);
  }

  try {
    if (action === "validate_upload") {
      const priorExtra = (connection.extra ?? {}) as Record<string, unknown>;
      const conversionActionResource =
        (typeof priorExtra.conversion_action_resource === "string" &&
            priorExtra.conversion_action_resource)
          ? priorExtra.conversion_action_resource
          : null;
      if (!conversionActionResource) {
        return json({
          error: "conversion_action_missing",
          detail:
            "No conversion_action_resource on the Google connection yet — run action:'provision' first, then validate_upload.",
        }, 409);
      }
      const sampleGclid =
        (typeof body.sample_gclid === "string" && body.sample_gclid.trim())
          ? body.sample_gclid.trim()
          : "VALIDATE_ONLY_SAMPLE_GCLID";
      const sampleInput: ConversionSendInput = {
        eventId: `validate-only-${Date.now()}`,
        eventName: "Purchase",
        valueCents: 0,
        currency: null,
        eventSourceUrl: null,
        hashedEmail: null,
        hashedPhone: null,
        fbc: null,
        fbp: null,
        externalClickId: sampleGclid,
        clientIpAddress: null,
        clientUserAgent: null,
        eventTimeMs: Date.now(),
      };
      // validateOnly:true → ZERO real conversion objects are recorded on Google.
      const result = await sendGoogleConversion(
        sampleInput,
        { pixelId: null, tokenEnvVar: null, lane, conversionActionResource },
        { validateOnly: true },
      );
      return json({
        lane,
        action,
        conversion_action_resource: conversionActionResource,
        upload: result,
      });
    }

    // provision | validate — both hit conversionActions:mutate; validate is dry.
    const validateOnly = action === "validate";
    const attributionWindowDays =
      typeof body.attribution_window_days === "number"
        ? body.attribution_window_days
        : undefined;
    const name = typeof body.name === "string" ? body.name : undefined;
    const result = await provisionGoogleConversionAction(connection, {
      lane,
      validateOnly,
      name,
      attributionWindowDays,
    });

    if (!validateOnly) {
      if (!result.resourceName) {
        return json({
          error: "conversion_action_not_returned",
          detail:
            "conversionActions:mutate returned OK but no resourceName — refusing to persist an unverifiable provisioning.",
          trace_id: result.requestId,
        }, 502);
      }
      const priorExtra = (connection.extra ?? {}) as Record<string, unknown>;
      const { data: updated, error: updateError } = await supabase
        .from("ad_connections")
        .update({
          extra: {
            ...priorExtra,
            // CONFIG, not a secret — the conversion-action resource name.
            conversion_action_resource: result.resourceName,
          },
        })
        .eq("id", connection.id)
        .select("id, extra")
        .maybeSingle();
      if (updateError) {
        console.error(
          "[admin-ad-google-provision-conversion] extra update failed:",
          updateError.message,
        );
        return json({ error: "internal_error" }, 500);
      }
      return json({
        lane,
        action,
        conversion_action_resource: result.resourceName,
        request_id: result.requestId,
        connection: updated,
      });
    }

    return json({
      lane,
      action,
      validated: true,
      request_id: result.requestId,
    });
  } catch (err) {
    if (err instanceof AdNotConnectedError) {
      if (err.detail === "google_not_provisioned") {
        return json({
          error: "google_not_provisioned",
          detail: PROVISIONED_ERROR_DETAIL,
        }, 409);
      }
      return json({
        error: "google_not_connected",
        detail:
          "The Google OAuth refresh token could not mint an access token — re-provision GOOGLE_ADS_REFRESH_TOKEN, then retry.",
      }, 424);
    }
    if (err instanceof AdApiError) {
      // Normalized error only — no token ever appears here (SC-SEC-1).
      return json({
        error: "google_conversion_action_failed",
        detail: err.toJSON(),
      }, 424);
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[admin-ad-google-provision-conversion] unexpected:", detail);
    return json({ error: "internal_error" }, 500);
  }
});
