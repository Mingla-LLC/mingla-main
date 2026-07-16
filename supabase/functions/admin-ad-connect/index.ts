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
 * Reddit connect (ISSUE-916 WP6, SPEC §1.3 — fail-close, in order):
 *   1. refresh-token mint (Basic auth, expires_in READ    → 424 reddit_not_connected
 *      from the response, UA on the mint — GR-71)
 *   2. GET /me (200 + t2_ user)                           → 424 reddit_not_connected
 *   3. GET /me/businesses contains the business           → 424 reddit_not_connected
 *   4. ad account ^(t2|a2)_ + currency ∈ 8-enum (no NGN)  → 424 (currency ⇒ invalid row)
 *   5. ≥1 t2_ profile (no profile ⇒ no post ⇒ no ad)      → 424 reddit_profile_missing
 *   6. funding instrument is_servable: true               → 424 reddit_funding_not_servable
 *      (reasons_not_servable[] surfaced VERBATIM — GR-13)
 *   7. pixel present (mandatory on every ad group          → 424 reddit_not_connected
 *      since 2026-07-13 — GR-12)
 *   On success the row caches profile/funding/pixel ids into extra (SPEC §1.4).
 * TikTok connect (ISSUE-863 WP7, SPEC §4.4a + A1 — fail-CLOSE, all 424s):
 *   1. token + advertiser id resolve (TIKTOK_ACCESS_TOKEN
 *      / TIKTOK_ADVERTISER_ID, lane-correct)             → 424 tiktok_not_connected
 *   2. advertiser/info read; status must be STATUS_ENABLE → 424 tiktok_not_connected
 *   3. identity/get — a TT_USER identity must exist
 *      (REQUIRED by ad_create; CUSTOMIZED_USER is illegal
 *      for this post-2026-01-15 account — T-6)           → 424 tiktok_identity_unavailable
 *   4. pixel/list — informational for #865 (zero events
 *      today, T-P4); NEVER a connect blocker
 *   5. upsert the connection row (auth_kind system_user_token; BC → external_org_id;
 *      identity/pixel refs in extra; min_daily_budget_cents stays NULL — TikTok
 *      exposes no minimum via any read API; floors are validated at create)
 *
 * Snapchat connect (ISSUE-867 WP5, SPEC §4.3 + A1.2 — fail-CLOSE, in order):
 *   1. secrets + refresh-token MINT (NO static token
 *      exists — S-P1; 3600 s, cached with a 60 s margin) → 424 snapchat_not_connected
 *   2. ad account read; status must be ACTIVE (S-P2)     → 424 snapchat_not_connected
 *   3. org funding source ACTIVE (S-P3 — $15k/day VISA)  → 424 snapchat_funding_not_servable
 *   4. Public Profile TRUSTED CONFIG present (A1.2-8 —
 *      the API lookup 403s on our token class, S-P4;
 *      verified only at the first creative create)       → 424 snapchat_profile_missing
 *   5. pixel read (S-P5) — informational (#865 owns pixel
 *      EVENTS; pixel goals stay gated); NEVER a blocker
 *
 * All five channels are live adapters — each fail-closes while its own
 * secrets are unset.
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
import {
  REDDIT_AD_ACCOUNT_ID_REGEX,
  redditConnectPreflight,
  redditDefaultTokenEnvVar,
  RedditPreflightError,
} from "../_shared/reddit.ts";
import {
  resolveTikTokClient,
  tiktokDefaultTokenEnvVar,
  tiktokFetchAdvertiser,
  tiktokFetchIdentity,
  tiktokFetchPixels,
  type TikTokPixelSnapshot,
} from "../_shared/tiktok.ts";
import {
  resolveSnapchatClient,
  SNAPCHAT_AD_ACCOUNT_ID_REGEX,
  SNAPCHAT_MIN_ADSQUAD_BUDGET_MICRO,
  snapchatDefaultTokenEnvVar,
  snapchatFetchAdAccount,
  snapchatFetchFundingSources,
  snapchatFetchPixels,
  type SnapchatFundingSnapshot,
  type SnapchatPixelSnapshot,
} from "../_shared/snapchat.ts";

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
  if (platform === "reddit") {
    return redditDefaultTokenEnvVar(lane);
  }
  if (platform === "tiktok") {
    // Lane-correct (QA P2-3) — TIKTOK_MINGLABIZ_* for the business lane.
    return tiktokDefaultTokenEnvVar(lane);
  }
  if (platform === "snapchat") {
    // Lane-correct (QA P2-3) — SNAPCHAT_MINGLABIZ_* for the business lane.
    return snapchatDefaultTokenEnvVar(lane);
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

  const { data: existing } = await supabase
    .from("ad_connections")
    .select("*")
    .eq("platform", platform)
    .eq("lane", lane)
    .maybeSingle();

  // ── SNAPCHAT (ISSUE-867 WP5 — SPEC §4.3/§4.4a + A1.2, PROOF S-P1…S-P5) ───────
  // Fail-CLOSE, in order (7-step style, mirrors reddit):
  //   1. secrets + refresh-token MINT (there is NO static token — S-P1;
  //      mint per call, cached 60 min)                → 424 snapchat_not_connected
  //   2. ad account read; status must be ACTIVE (S-P2) → 424 snapchat_not_connected
  //   3. funding source ACTIVE (S-P3: VISA $15k/day)  → 424 snapchat_funding_not_servable
  //   4. Public Profile TRUSTED CONFIG present (A1.2-8:
  //      the API lookup 403s on our token class — S-P4;
  //      presence-only; first creative create verifies) → 424 snapchat_profile_missing
  //   5. pixel read (S-P5) — informational for #865; pixel EVENTS don't flow
  //      yet, so pixel goals stay gated (A1.1(6)); NEVER a connect blocker
  if (platform === "snapchat") {
    const markSnapchatInvalid = async (reason: string): Promise<void> => {
      // QA WP7 F-1 sentinel class: only a real UUID-v4 ad-account id survives
      // the invalid-row upsert — junk collapses to the explicit 'unconfigured'
      // sentinel, and resolveSnapchatClient independently refuses to pin on a
      // non-matching persisted id, so a failed connect can never brick the
      // reconnect path.
      const priorAccountId = (existing?.external_account_id ?? "").trim();
      const envAccountId =
        (Deno.env.get(
          lane === "business" ? "SNAPCHAT_MINGLABIZ_AD_ACCOUNT_ID" : "SNAPCHAT_AD_ACCOUNT_ID",
        ) ?? "").trim().toLowerCase();
      await supabase
        .from("ad_connections")
        .upsert({
          platform,
          lane,
          display_name: existing?.display_name ??
            `Snapchat · ${lane === "business" ? "Business" : "Consumer"}`,
          external_account_id: SNAPCHAT_AD_ACCOUNT_ID_REGEX.test(priorAccountId)
            ? priorAccountId
            : SNAPCHAT_AD_ACCOUNT_ID_REGEX.test(envAccountId)
            ? envAccountId
            : "unconfigured", // explicit sentinel — never fabricated data
          external_org_id: existing?.external_org_id ?? null,
          auth_kind: "refresh_token",
          token_env_var: existing?.token_env_var ?? defaultTokenEnvVar(platform, lane),
          // The failure cause is PERSISTED, not response-only (QA-916-3 parity).
          extra: {
            ...((existing?.extra ?? {}) as Record<string, unknown>),
            last_error: reason,
          },
          status: "invalid",
          connected: false,
        }, { onConflict: "platform,lane" });
    };

    try {
      // 1. Secrets + mint (fail-close — RT-1/AC-S-1) + account-id resolution.
      const client = await resolveSnapchatClient(existing ?? null, lane);

      // 2. Ad account must be ACTIVE (S-P2 shape).
      const account = await snapchatFetchAdAccount(client);
      if (account.status !== "ACTIVE") {
        await markSnapchatInvalid(
          `ad account ${client.adAccountId} is ${account.status ?? "in an unknown state"}`,
        );
        return json({
          error: "snapchat_not_connected",
          detail:
            `Snap ad account ${client.adAccountId} is ${account.status ?? "in an unknown state"} — an ACTIVE account is required (S-P2).`,
        }, 424);
      }

      // 3. Funding servable: ≥1 ACTIVE funding source on the org (S-P3).
      const organizationId = account.organizationId ?? client.organizationId;
      let fundingSources: SnapchatFundingSnapshot[] = [];
      if (organizationId) {
        fundingSources = await snapchatFetchFundingSources(client, organizationId);
      }
      const activeFunding = fundingSources.find((s) => s.status === "ACTIVE") ?? null;
      if (!activeFunding) {
        await markSnapchatInvalid("no ACTIVE funding source on the organization");
        return json({
          error: "snapchat_funding_not_servable",
          detail: organizationId
            ? "No ACTIVE funding source on the Snap organization — a launched campaign would never spend. Add/repair the payment method in Snap Ads Manager, then reconnect (S-P3)."
            : "The organization id could not be resolved (SNAPCHAT_ORG_ID unset and the account read carried none) — funding cannot be verified; fail-close.",
        }, 424);
      }

      // 4. Public Profile — TRUSTED CONFIG presence (A1.2-8; S-P4: the lookup
      //    403s on our token class, so presence is ALL that can be checked;
      //    the first creative create is the verification).
      if (!client.profileId) {
        await markSnapchatInvalid("SNAPCHAT_PROFILE_ID missing (trusted config — A1.2-8)");
        return json({
          error: "snapchat_profile_missing",
          detail:
            "Snap creatives require profile_properties.profile_id, and the Public Profile API is unreachable on our token class (403 — S-P4). Set the SNAPCHAT_PROFILE_ID Function Secret (UI-captured trusted config), then reconnect. Without it, creative create is impossible (fail-close).",
        }, 424);
      }

      // 5. Pixel — informational (S-P5); events are #865's; never a blocker.
      let pixels: SnapchatPixelSnapshot[] = [];
      try {
        pixels = await snapchatFetchPixels(client);
      } catch {
        pixels = [];
      }
      const pixel = pixels.find((p) => p.status === "ACTIVE") ?? pixels[0] ?? null;

      if (action === "status" && !existing) {
        return json({
          connection: null,
          snapchat: { account, funding: activeFunding, pixel },
        });
      }

      const priorExtra = (existing?.extra ?? {}) as Record<string, unknown>;
      const row = {
        platform,
        lane,
        display_name: `Snapchat · ${lane === "business" ? "Business" : "Consumer"}${
          account.name ? ` (${account.name})` : ""
        }`,
        external_account_id: client.adAccountId,
        external_org_id: organizationId,
        auth_kind: "refresh_token",
        token_env_var: existing?.token_env_var ?? defaultTokenEnvVar(platform, lane),
        // Env-var NAMES + captured platform ids only — never a secret value.
        extra: {
          ...priorExtra,
          client_id_env_var: lane === "business"
            ? "SNAPCHAT_MINGLABIZ_CLIENT_ID"
            : "SNAPCHAT_CLIENT_ID",
          client_secret_env_var: lane === "business"
            ? "SNAPCHAT_MINGLABIZ_CLIENT_SECRET"
            : "SNAPCHAT_CLIENT_SECRET",
          profile_id_env_var: lane === "business"
            ? "SNAPCHAT_MINGLABIZ_PROFILE_ID"
            : "SNAPCHAT_PROFILE_ID",
          // A1.2-8: UI-captured TRUSTED CONFIG — verified at first creative create.
          profile_id: client.profileId,
          pixel_id: pixel?.id ?? null,
          pixel_status: pixel?.status ?? null,
          // A1.1(6): the #865 signal gating LANDING_PAGE_VIEW / PIXEL_* goals.
          // Preserved if #865 already flipped it; defaults false (SWIPES-only).
          pixel_installed: priorExtra.pixel_installed === true,
          funding_source_id: activeFunding.id,
          funding_daily_spend_limit_micro: activeFunding.dailySpendLimitMicro,
          last_error: null,
        },
        status: "connected",
        currency: account.currency,
        timezone: account.timezone,
        // The ad-squad daily floor in cents ($5.00) — informational; the
        // binding floor checks run in MICRO after conversion (A1.1(1)).
        min_daily_budget_cents: SNAPCHAT_MIN_ADSQUAD_BUDGET_MICRO / 10_000,
        account_status: account.status,
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
        console.error("[admin-ad-connect] snapchat upsert failed:", upsertError.message);
        return json({ error: "internal_error" }, 500);
      }
      return json({
        connection: upserted,
        snapchat: {
          account: {
            id: account.id,
            name: account.name,
            status: account.status,
            currency: account.currency,
            timezone: account.timezone,
          },
          funding: {
            id: activeFunding.id,
            type: activeFunding.type,
            status: activeFunding.status,
            daily_spend_limit_micro: activeFunding.dailySpendLimitMicro,
          },
          profile_id: client.profileId,
          pixel: pixel ? { id: pixel.id, name: pixel.name, status: pixel.status } : null,
        },
      });
    } catch (err) {
      if (err instanceof AdNotConnectedError) {
        if (err.detail === "snapchat_profile_missing") {
          await markSnapchatInvalid("SNAPCHAT_PROFILE_ID missing (trusted config — A1.2-8)");
          return json({
            error: "snapchat_profile_missing",
            detail:
              "Set the SNAPCHAT_PROFILE_ID Function Secret (UI-captured trusted config — the Public Profile API 403s on our token class, S-P4), then reconnect.",
          }, 424);
        }
        const secretsDetail =
          "SNAPCHAT_REFRESH_TOKEN / SNAPCHAT_CLIENT_ID / SNAPCHAT_CLIENT_SECRET (or the lane's SNAPCHAT_MINGLABIZ_* secrets) are not set, or the refresh token could not mint an access token (there is NO static token — S-P1). Set the Supabase Edge Function secrets, then reconnect.";
        await markSnapchatInvalid(secretsDetail);
        return json({ error: "snapchat_not_connected", detail: secretsDetail }, 424);
      }
      if (err instanceof AdApiError) {
        await markSnapchatInvalid(err.message);
        // Normalized error only — no token ever appears here (SC-SEC-1).
        return json({ error: "snapchat_not_connected", detail: err.toJSON() }, 424);
      }
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[admin-ad-connect] snapchat unexpected:", detail);
      return json({ error: "internal_error" }, 500);
    }
  }

  // ── REDDIT (ISSUE-916 WP6 — SPEC §1.3/§1.4) ──────────────────────────────────
  // The 7-step fail-close pre-flight: mint → /me → business → ad account
  // (^(t2|a2)_, 8-currency enum) → ≥1 t2_ profile → servable funding
  // instrument (reasons_not_servable verbatim) → pixel. NEVER connected=true
  // past a failed step — "created fine, never spends" is the silent failure
  // this pre-flight exists to kill (GR-13).
  if (platform === "reddit") {
    const markRedditInvalid = async (reason: string): Promise<void> => {
      // QA-916-1 (P1) belt-and-braces: only a real ^(t2|a2)_ id survives the
      // invalid-row upsert — junk collapses to the explicit 'unconfigured'
      // sentinel, and redditConnectPreflight independently refuses to pin on
      // any non-matching persisted id, so a failed connect can never brick
      // the reconnect path.
      const priorAccountId = existing?.external_account_id ?? "";
      await supabase
        .from("ad_connections")
        .upsert({
          platform,
          lane,
          display_name: existing?.display_name ??
            `Reddit · ${lane === "business" ? "Business" : "Consumer"}`,
          external_account_id: REDDIT_AD_ACCOUNT_ID_REGEX.test(priorAccountId)
            ? priorAccountId
            : "unconfigured",
          external_org_id: existing?.external_org_id ?? null,
          auth_kind: "refresh_token",
          token_env_var: existing?.token_env_var ?? defaultTokenEnvVar(platform, lane),
          // QA-916-3 (P3): the failure cause is PERSISTED, not response-only —
          // an admin reloading later sees why the row is invalid.
          extra: {
            ...((existing?.extra ?? {}) as Record<string, unknown>),
            last_error: reason,
          },
          status: "invalid",
          connected: false,
        }, { onConflict: "platform,lane" });
    };

    try {
      const snapshot = await redditConnectPreflight(existing ?? null, lane);

      if (action === "status" && !existing) {
        return json({ connection: null, reddit: snapshot });
      }

      const priorExtra = (existing?.extra ?? {}) as Record<string, unknown>;
      const row = {
        platform,
        lane,
        display_name: `Reddit · ${lane === "business" ? "Business" : "Consumer"}${
          snapshot.account.name ? ` (${snapshot.account.name})` : ""
        }`,
        external_account_id: snapshot.account.id,
        external_org_id: snapshot.businessId,
        auth_kind: "refresh_token",
        token_env_var: existing?.token_env_var ?? defaultTokenEnvVar(platform, lane),
        // §1.4: env-var NAMES + captured platform ids only — never a secret value.
        extra: {
          ...priorExtra,
          client_id_env_var: lane === "business"
            ? "REDDIT_ADS_MINGLABIZ_CLIENT_ID"
            : "REDDIT_ADS_CLIENT_ID",
          client_secret_env_var: lane === "business"
            ? "REDDIT_ADS_MINGLABIZ_CLIENT_SECRET"
            : "REDDIT_ADS_CLIENT_SECRET",
          reddit_profile_id: snapshot.profileId,
          reddit_funding_instrument_id: snapshot.fundingInstrumentId,
          reddit_pixel_id: snapshot.pixelId,
          ...(snapshot.scope ? { scopes: snapshot.scope } : {}),
        },
        status: "connected",
        currency: snapshot.account.currency,
        account_status: null,
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
        console.error("[admin-ad-connect] reddit upsert failed:", upsertError.message);
        return json({ error: "internal_error" }, 500);
      }
      return json({ connection: upserted, reddit: snapshot });
    } catch (err) {
      if (err instanceof RedditPreflightError) {
        await markRedditInvalid(err.message);
        // Per-step 424 codes (AC-R-4/AC-R-6); reasons_not_servable[] verbatim.
        return json({
          error: err.errorCode === "reddit_currency_unsupported"
            ? "reddit_not_connected"
            : err.errorCode,
          detail: err.message,
          ...(err.reasons ? { reasons_not_servable: err.reasons } : {}),
        }, 424);
      }
      if (err instanceof AdNotConnectedError) {
        const secretsDetail =
          "REDDIT_ADS_CLIENT_ID / REDDIT_ADS_CLIENT_SECRET / REDDIT_ADS_REFRESH_TOKEN (or the lane's secrets) are not set, or the refresh token could not mint — set the Supabase Edge Function secrets (duration=permanent at consent), then reconnect (SPEC §1.1–§1.2).";
        await markRedditInvalid(secretsDetail);
        return json({ error: "reddit_not_connected", detail: secretsDetail }, 424);
      }
      if (err instanceof AdApiError) {
        // Normalized error only — no token ever appears here (SC-SEC-1).
        await markRedditInvalid(err.message);
        return json({ error: "reddit_not_connected", detail: err.toJSON() }, 424);
      }
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[admin-ad-connect] reddit unexpected:", detail);
      return json({ error: "internal_error" }, 500);
    }
  }

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

  // ── TIKTOK (ISSUE-863 WP7, SPEC §4.4a + A1) ─────────────────────────────────
  // Fail-CLOSE: an unset TIKTOK_ACCESS_TOKEN / TIKTOK_ADVERTISER_ID → 424
  // tiktok_not_connected + an `invalid` row (QA P2-4 parity with Meta — SC-2's
  // "invalid" state must be renderable before the first success).
  if (platform === "tiktok") {
    const markTikTokInvalid = async (): Promise<void> => {
      const accountId = existing?.external_account_id ||
        (Deno.env.get(lane === "business" ? "TIKTOK_MINGLABIZ_ADVERTISER_ID" : "TIKTOK_ADVERTISER_ID") ?? "")
          .trim() ||
        "unconfigured"; // explicit sentinel — never fabricated data
      await supabase
        .from("ad_connections")
        .upsert({
          platform,
          lane,
          display_name: existing?.display_name ??
            `TikTok · ${lane === "business" ? "Business" : "Consumer"}`,
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
      // 1–2: token + advertiser id resolve (fail-close), then the live
      //      advertiser read — the account must be STATUS_ENABLE (T-P1 shape).
      const client = resolveTikTokClient(existing ?? null, lane);
      const advertiser = await tiktokFetchAdvertiser(client);

      if (advertiser.status !== "STATUS_ENABLE") {
        await markTikTokInvalid();
        return json({
          error: "tiktok_not_connected",
          detail:
            `TikTok advertiser ${client.advertiserId} is ${advertiser.status ?? "in an unknown state"} — a STATUS_ENABLE (active) advertiser is required.`,
        }, 424);
      }

      if (action === "status" && !existing) {
        return json({ connection: null, tiktok: advertiser });
      }

      // 3: identity — REQUIRED by ad_create (no identity, no ad); TT_USER is
      //    the ONLY viable non-Spark path for this post-2026-01-15 account
      //    (A1.1(f)/T-6). Persisted on the connection for the ad builder.
      const identity = await tiktokFetchIdentity(client);
      if (!identity || identity.availableStatus !== "AVAILABLE") {
        await markTikTokInvalid();
        return json({
          error: "tiktok_identity_unavailable",
          detail:
            "No AVAILABLE TT_USER identity on the advertiser — ad_create requires identity_type+identity_id, and TT_USER (@usemingla) is the only viable non-Spark identity for this account (created after TikTok's 2026-01-15 CUSTOMIZED_USER cutoff). Re-authorize the @usemingla TikTok account for ads, then reconnect.",
        }, 424);
      }

      // 4: pixel — informational for #865 (zero events today, T-P4); traffic
      //    campaigns never use it, so a pixel failure is NEVER a connect blocker.
      let pixels: TikTokPixelSnapshot[] = [];
      try {
        pixels = await tiktokFetchPixels(client);
      } catch {
        pixels = [];
      }
      const pixel = pixels[0] ?? null;

      const priorExtra = (existing?.extra ?? {}) as Record<string, unknown>;
      const row = {
        platform,
        lane,
        display_name: `TikTok · ${lane === "business" ? "Business" : "Consumer"}${
          advertiser.name ? ` (${advertiser.name})` : ""
        }`,
        external_account_id: client.advertiserId,
        // The Business Center is the org-level id (A3 registry row).
        external_org_id: advertiser.ownerBcId,
        auth_kind: "system_user_token",
        token_env_var: existing?.token_env_var ?? defaultTokenEnvVar(platform, lane),
        extra: {
          ...priorExtra,
          api_version: client.apiVersion,
          identity_id: identity.identityId,
          identity_type: identity.identityType,
          identity_username: identity.username,
          identity_available_status: identity.availableStatus,
          pixel_id: pixel?.pixelId ?? null,
          pixel_activity_status: pixel?.activityStatus ?? null,
          pixel_events_count: pixel?.eventsCount ?? 0,
          // The API balance is BLIND to the Advanced Payment Portfolio (T-P3)
          // — recorded verbatim; the Ads Manager UI is the funding source of truth.
          api_balance: advertiser.balance,
          // #865's SEPARATE Events-API credential name — never used by this story.
          events_env_var: (priorExtra.events_env_var as string | undefined) ??
            "TIKTOK_EVENTS_ACCESS_TOKEN",
        },
        status: "connected",
        currency: advertiser.currency,
        timezone: advertiser.displayTimezone ?? advertiser.timezone,
        // TikTok exposes NO minimum via any read API — the $20/$50 floors are
        // validated at create, AFTER cents→dollars conversion (A1.0-1).
        min_daily_budget_cents: null,
        account_status: advertiser.status,
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
        console.error("[admin-ad-connect] tiktok upsert failed:", upsertError.message);
        return json({ error: "internal_error" }, 500);
      }
      return json({
        connection: upserted,
        tiktok: {
          advertiser: {
            id: advertiser.advertiserId,
            name: advertiser.name,
            currency: advertiser.currency,
            status: advertiser.status,
            api_balance: advertiser.balance,
          },
          identity: {
            id: identity.identityId,
            type: identity.identityType,
            username: identity.username,
            available_status: identity.availableStatus,
          },
          pixel: pixel
            ? {
              id: pixel.pixelId,
              activity_status: pixel.activityStatus,
              events_count: pixel.eventsCount,
            }
            : null,
        },
      });
    } catch (err) {
      if (err instanceof AdNotConnectedError) {
        await markTikTokInvalid();
        return json({
          error: "tiktok_not_connected",
          detail:
            "TIKTOK_ACCESS_TOKEN / TIKTOK_ADVERTISER_ID (or the lane's TIKTOK_MINGLABIZ_* secrets) are not set — set the Supabase Edge Function secrets (SPEC §7: TIKTOK_ACCESS_TOKEN, TIKTOK_APP_ID, TIKTOK_APP_SECRET, TIKTOK_ADVERTISER_ID, TIKTOK_API_VERSION=v1.3, TIKTOK_GRAPH_BASE), then reconnect.",
        }, 424);
      }
      if (err instanceof AdApiError) {
        await markTikTokInvalid();
        // Normalized error only — the token never appears here (SC-SEC-1).
        return json({ error: "tiktok_not_connected", detail: err.toJSON() }, 424);
      }
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[admin-ad-connect] tiktok unexpected:", detail);
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
