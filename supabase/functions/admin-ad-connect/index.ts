/**
 * admin-ad-connect — ISSUE-862 WP1 [Full Rooms Ad Engine].
 *
 * Binds/verifies one (platform, lane) ad connection (SPEC A3 §C as corrected by
 * A4.e). Body: { platform, lane?='consumer', action?='connect'|'status' }.
 *
 * Meta connect (fail-CLOSE, all 424s, per A4.e + PROOF_LOG):
 *   1. token resolve from Deno.env[token_env_var]        → 424 meta_not_connected
 *   2. account read (currency/account_status/funding)     → 424 meta_not_connected
 *   3. Page check = GET /me/accounts + ADVERTISE task     → 424 meta_page_not_assigned
 *      (A4.e.1 — NOT promote_pages; PROOF M-P4/M-P6)
 *   4. app-Live precondition: VALIDATE-ONLY adcreatives
 *      probe, error 1885183                               → 424 meta_app_not_live
 *      (A4.e.2 — PROOF M-P6; zero objects created)
 *   5. per-category minimum_budgets fetch → stored in
 *      ad_connections.extra.minimum_budgets (A4.g — never hardcoded; PROOF M-P8)
 *   6. pixel last_fired + IG business account → extra (A4.e.5 / A4.e.7)
 *
 * Google connect (ISSUE-867 WP2, A1.3 / AC-G-1 / AC-G-2):
 *   1. secrets resolve (all six GOOGLE_ADS_* names)      → 409 google_not_provisioned
 *   2. OAuth mint from the refresh token (in-memory)     → 424 google_not_connected
 *   3. GAQL SELECT customer (proves the dev token works
 *      on the real account — BASIC tier, PROOF G-P1)     → 424 on failure
 *   4. customer.status must be ENABLED                   → 424 google_not_connected
 *   5. upsert the connection row (auth_kind dev_token_oauth; MCC → external_org_id)
 *
 * Other platforms are fail-close stubs until their WPs land:
 *   → 424 <platform>_not_connected.
 *
 * verify_jwt = true (config.toml) + in-code admin_users active gate (§4.4).
 * Writes via service-role only (RLS has no write policy for authenticated).
 * The token value NEVER appears in any response, row, or log (SC-SEC-1).
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AdApiError,
  AdNotConnectedError,
  isLane,
  isPlatform,
  type Lane,
  type Platform,
} from "../_shared/adChannel.ts";
import {
  metaCheckPageAdvertiseTask,
  metaFetchAccount,
  metaFetchIgBusinessAccount,
  metaFetchMinimumBudgets,
  metaFetchPixelLastFired,
  metaValidateOnlyCreativeProbe,
  resolveMetaClient,
  resolveMetaEnvConfig,
} from "../_shared/meta.ts";
import {
  GOOGLE_ADS_DEFAULT_API_VERSION,
  googleDefaultTokenEnvVar,
  googleFetchCustomer,
  resolveGoogleClient,
  resolveGoogleEnvConfig,
} from "../_shared/google.ts";

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

/** A2 per-lane default env-var NAMES (names only — never values). */
function defaultTokenEnvVar(platform: Platform, lane: Lane): string {
  if (platform === "meta") {
    return lane === "business" ? "META_MINGLABIZ_SYSTEM_USER_TOKEN" : "META_SYSTEM_USER_TOKEN";
  }
  if (platform === "google") {
    // Lane-correct (QA P2-3) — the business lane never claims the consumer secret.
    return googleDefaultTokenEnvVar(lane);
  }
  const byPlatform: Record<Platform, string> = {
    meta: "META_SYSTEM_USER_TOKEN",
    tiktok: "TIKTOK_ACCESS_TOKEN",
    snapchat: "SNAPCHAT_REFRESH_TOKEN",
    google: "GOOGLE_ADS_REFRESH_TOKEN",
    reddit: "REDDIT_ADS_REFRESH_TOKEN",
  };
  return byPlatform[platform];
}

function defaultCapiEnvVar(lane: Lane): string {
  return lane === "business" ? "META_MINGLABIZ_CAPI_ACCESS_TOKEN" : "META_CAPI_ACCESS_TOKEN";
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // ── ADMIN GATE FIRST (QA P3-7: auth precedes input validation — no pre-auth
  //    probe surface; mirrors admin-ad-preflight/create/sync ordering). ────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  if (!adminRow) return json({ error: "forbidden" }, 403);

  const platform = body.platform;
  const lane = body.lane ?? "consumer";
  const action = body.action ?? "connect";
  if (!isPlatform(platform)) return json({ error: "validation_error", detail: "platform_invalid" }, 400);
  if (!isLane(lane)) return json({ error: "validation_error", detail: "lane_invalid" }, 400);
  if (action !== "connect" && action !== "status") {
    return json({ error: "validation_error", detail: "action_invalid" }, 400);
  }

  // ── Fail-close stubs for the three unbuilt channels. ────────────────────────
  if (platform !== "meta" && platform !== "google") {
    return json({
      error: `${platform}_not_connected`,
      detail: `${platform} adapter ships in a later WP (WP5 snapchat / WP6 reddit / WP7 tiktok); fail-close until then.`,
    }, 424);
  }

  const { data: existing } = await supabase
    .from("ad_connections")
    .select("*")
    .eq("platform", platform)
    .eq("lane", lane)
    .maybeSingle();

  // ── GOOGLE (ISSUE-867 WP2, AC-G-1/AC-G-2) ────────────────────────────────────
  // Secrets unset → 409 google_not_provisioned (a provisioning gap — the SC-7
  // checklist state, NO row write). Mint/permission failure with secrets set →
  // 424 google_not_connected + an `invalid` row (QA P2-4 parity with Meta).
  if (platform === "google") {
    const markGoogleInvalid = async (): Promise<void> => {
      let accountId = existing?.external_account_id ?? "";
      if (!accountId) {
        try {
          accountId = resolveGoogleEnvConfig(existing ?? null, lane).customerId;
        } catch {
          accountId = "unconfigured"; // explicit sentinel — never fabricated data
        }
      }
      await supabase
        .from("ad_connections")
        .upsert({
          platform,
          lane,
          display_name: existing?.display_name ??
            `Google Ads · ${lane === "business" ? "Business" : "Consumer"}`,
          external_account_id: accountId,
          external_org_id: existing?.external_org_id ?? null,
          auth_kind: "dev_token_oauth",
          token_env_var: existing?.token_env_var ?? defaultTokenEnvVar(platform, lane),
          extra: existing?.extra ?? {},
          status: "invalid",
          connected: false,
        }, { onConflict: "platform,lane" });
    };

    try {
      // Mint + config resolve (fail-close: unset → google_not_provisioned;
      // mint failure → google_not_connected). Then the AC-G-2 GAQL validation.
      const client = await resolveGoogleClient(existing ?? null, lane);
      const customer = await googleFetchCustomer(client);

      if (customer.status !== "ENABLED") {
        await markGoogleInvalid();
        return json({
          error: "google_not_connected",
          detail:
            `Google Ads customer ${client.customerId} is ${customer.status ?? "in an unknown state"} — an ENABLED, billed account is required (G-P1).`,
        }, 424);
      }

      if (action === "status" && !existing) {
        return json({ connection: null, google: customer });
      }

      const priorExtra = (existing?.extra ?? {}) as Record<string, unknown>;
      const row = {
        platform,
        lane,
        display_name: `Google Ads · ${lane === "business" ? "Business" : "Consumer"}${
          customer.descriptiveName ? ` (${customer.descriptiveName})` : ""
        }`,
        external_account_id: client.customerId,
        // The MCC (login-customer-id) is the org-level id (A1.3 G-11).
        external_org_id: client.loginCustomerId,
        auth_kind: "dev_token_oauth",
        token_env_var: existing?.token_env_var ?? defaultTokenEnvVar(platform, lane),
        extra: {
          ...priorExtra,
          api_version: client.apiVersion,
          login_customer_id: client.loginCustomerId,
          test_account: customer.testAccount,
        },
        status: "connected",
        currency: customer.currency,
        timezone: customer.timezone,
        account_status: customer.status,
        token_last_verified_at: new Date().toISOString(),
        connected: true,
        connected_by: user.id,
      };
      const { data: upserted, error: upsertError } = await supabase
        .from("ad_connections")
        .upsert(row, { onConflict: "platform,lane" })
        .select("*")
        .maybeSingle();
      if (upsertError) {
        console.error("[admin-ad-connect] google upsert failed:", upsertError.message);
        return json({ error: "internal_error" }, 500);
      }
      return json({ connection: upserted, google: customer });
    } catch (err) {
      if (err instanceof AdNotConnectedError) {
        if (err.detail === "google_not_provisioned") {
          // AC-G-1: provisioning gap → 409, zero Google calls beyond env reads.
          return json({
            error: "google_not_provisioned",
            detail:
              `Set the Google Ads Function Secrets (GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_OAUTH_CLIENT_ID, GOOGLE_ADS_OAUTH_CLIENT_SECRET, GOOGLE_ADS_LOGIN_CUSTOMER_ID, GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_API_VERSION=${GOOGLE_ADS_DEFAULT_API_VERSION}), then reconnect (SPEC §7 Google 5–6).`,
          }, 409);
        }
        await markGoogleInvalid();
        return json({
          error: "google_not_connected",
          detail:
            "The Google OAuth refresh token could not mint an access token — re-provision GOOGLE_ADS_REFRESH_TOKEN, then reconnect.",
        }, 424);
      }
      if (err instanceof AdApiError) {
        await markGoogleInvalid();
        // Normalized error only — no token ever appears here (SC-SEC-1).
        return json({ error: "google_not_connected", detail: err.toJSON() }, 424);
      }
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[admin-ad-connect] google unexpected:", detail);
      return json({ error: "internal_error" }, 500);
    }
  }

  // QA P2-4 (AC-1): a connect failure must PERSIST an `invalid` row even on a
  // FIRST connect (no existing row) — SC-2's "invalid" state must be renderable
  // before the first success. UPSERT, not update-if-exists.
  const markInvalid = async (): Promise<void> => {
    let accountId = existing?.external_account_id ?? "";
    if (!accountId) {
      try {
        accountId = resolveMetaEnvConfig(lane).adAccountId;
      } catch {
        // Env IDs unset — no fabricated id; 'unconfigured' is an explicit
        // sentinel (documented in the WP1 rework report), not fake data.
        accountId = "unconfigured";
      }
    }
    await supabase
      .from("ad_connections")
      .upsert({
        platform,
        lane,
        display_name: existing?.display_name ??
          `Meta · ${lane === "business" ? "Business" : "Consumer"}`,
        external_account_id: accountId,
        external_org_id: existing?.external_org_id ?? null,
        auth_kind: "system_user_token",
        token_env_var: existing?.token_env_var ?? defaultTokenEnvVar(platform, lane),
        extra: existing?.extra ?? {},
        status: "invalid",
        connected: false,
      }, { onConflict: "platform,lane" });
  };

  try {
    // 1–2: token + account, LANE-CORRECT (QA P2-3): with no persisted row the
    // credential and IDs verified are the LANE's own env names — a business
    // first-connect never validates the consumer credential.
    const client = resolveMetaClient(existing ?? null, lane);
    const account = await metaFetchAccount(client);

    if (action === "status") {
      if (existing) {
        const { data: updated } = await supabase
          .from("ad_connections")
          .update({
            status: "connected",
            connected: true,
            account_status: account.accountStatus,
            currency: account.currency,
            token_last_verified_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select("*")
          .maybeSingle();
        return json({ connection: updated ?? existing, graph: account });
      }
      return json({ connection: null, graph: account });
    }

    // 3: Page granted to the system user with an ADVERTISE task (A4.e.1).
    const pageCheck = await metaCheckPageAdvertiseTask(client);
    if (!pageCheck.ok) {
      await markInvalid();
      return json({
        error: "meta_page_not_assigned",
        detail:
          "The configured Page is not granted to the system user with an ADVERTISE task (GET /me/accounts). Assign the Page to the system user in Meta Business Settings, then reconnect.",
      }, 424);
    }

    // 4: app-Live precondition via validate-only adcreatives probe (A4.e.2 / B6).
    const probe = await metaValidateOnlyCreativeProbe(client);
    if (!probe.appLive) {
      await markInvalid();
      return json({
        error: "meta_app_not_live",
        detail:
          "The Meta developer app is in development mode (error 1885183) — creative create hard-fails. Switch the app to Live in the App Dashboard, then reconnect.",
      }, 424);
    }

    // 5: per-category budget floors — stored, never hardcoded (A4.g).
    const minimumBudgets = await metaFetchMinimumBudgets(client, account.currency);

    // 6: pixel signal + IG link state (A4.e.5 / A4.e.7).
    const pixel = await metaFetchPixelLastFired(client);
    let igUserId: string | null = null;
    try {
      igUserId = await metaFetchIgBusinessAccount(client);
    } catch {
      igUserId = null; // IG resolution is optional — Facebook-only fallback (A4.e.7)
    }

    const priorExtra = (existing?.extra ?? {}) as Record<string, unknown>;
    const extra: Record<string, unknown> = {
      ...priorExtra,
      page_id: client.config.pageId,
      dataset_id: client.config.datasetId,
      capi_env_var: (priorExtra.capi_env_var as string | undefined) ?? defaultCapiEnvVar(lane),
      has_payment_method: account.hasPaymentMethod,
      minimum_budgets: minimumBudgets,
      pixel_last_fired_time: pixel.lastFiredTime,
      pixel_has_signal: pixel.hasSignal,
      instagram_user_id: igUserId,
    };

    const row = {
      platform,
      lane,
      display_name: `Meta · ${lane === "business" ? "Business" : "Consumer"}${
        account.name ? ` (${account.name})` : ""
      }`,
      external_account_id: client.config.adAccountId,
      external_org_id: client.config.businessId,
      auth_kind: "system_user_token",
      token_env_var: existing?.token_env_var ?? defaultTokenEnvVar(platform, lane),
      extra,
      status: "connected",
      currency: account.currency,
      timezone: account.timezone,
      min_daily_budget_cents: account.minDailyBudgetCents,
      account_status: account.accountStatus,
      token_last_verified_at: new Date().toISOString(),
      connected: true,
      connected_by: user.id,
    };

    const { data: upserted, error: upsertError } = await supabase
      .from("ad_connections")
      .upsert(row, { onConflict: "platform,lane" })
      .select("*")
      .maybeSingle();
    if (upsertError) {
      console.error("[admin-ad-connect] upsert failed:", upsertError.message);
      return json({ error: "internal_error" }, 500);
    }

    return json({
      connection: upserted,
      graph: {
        account: { id: account.id, name: account.name, currency: account.currency, account_status: account.accountStatus, has_payment_method: account.hasPaymentMethod },
        page: { id: client.config.pageId, name: pageCheck.pageName, tasks: pageCheck.tasks },
        minimum_budgets: minimumBudgets,
        pixel: pixel,
        instagram_user_id: igUserId,
      },
    });
  } catch (err) {
    if (err instanceof AdNotConnectedError) {
      await markInvalid();
      return json({ error: "meta_not_connected", detail: "META_SYSTEM_USER_TOKEN (or the lane's token secret) is not set — set the Supabase Edge Function secret, then reconnect." }, 424);
    }
    if (err instanceof AdApiError) {
      await markInvalid();
      // Normalized error only — the token never appears here (SC-SEC-1).
      return json({ error: "meta_not_connected", detail: err.toJSON() }, 424);
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[admin-ad-connect] unexpected:", detail);
    return json({ error: "internal_error" }, 500);
  }
});
