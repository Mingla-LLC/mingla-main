/**
 * admin-ad-preflight — ISSUE-862 WP1 [Full Rooms Ad Engine].
 *
 * The channel-health service (PIPELINE_BLUEPRINT §1.0 / §4.1, as corrected by
 * SPEC A4.e): one call per (platform, lane) answering "if I launch right now,
 * will an ad actually run?" — P1 token · P2 billing/funding · P3 identity ·
 * P4 pixel · P5 review/access tier · P6 market reachability.
 *
 * Meta is implemented fully (per A4.e corrections):
 *   P1 token      — GET /me/adaccounts contains the configured account
 *   P2 billing    — account_status ACTIVE + funding source present
 *   P3 identity   — GET /me/accounts contains the Page with an ADVERTISE task
 *                   (A4.e.1 — NOT promote_pages) + B6 app-Live validate-only
 *                   adcreatives probe (A4.e.2, error 1885183 → meta_app_not_live)
 *   P4 pixel      — last_fired_time epoch-0/null ⇒ WARN (LINK_CLICKS-only until
 *                   the pixel fires — A4.e.5; not a create blocker)
 *   P5 tier       — n/a for Meta (own-account system-user token)
 *   P6 market     — Targeting Search GET /search?type=adgeolocation callable
 *                   (A4.e.6 / PROOF M-P9)
 *
 * Google (ISSUE-867 WP2 — A1.3/G-P1):
 *   P1 token      — OAuth mint from the refresh token + the GAQL
 *                   SELECT customer succeeding (proves the developer token
 *                   works on the real account — BASIC tier)
 *   P2 billing    — customer.status ENABLED + test_account=false
 *   P4 pixel      — n/a (Google conversion tracking is #865)
 *   P5 tier       — pass via the P1 read (BASIC proven live G-P1)
 *   P6 market     — geoTargetConstants:suggest London/GB resolves (G-P2)
 *
 * Reddit (ISSUE-916 WP6 — SPEC §1.3):
 *   P1 token      — refresh-token mint + /me + business + ad account
 *                   (^(t2|a2)_ — both prefixes legal, R-1)
 *   P2 billing    — funding instrument is_servable:true (reasons_not_servable
 *                   verbatim — GR-13) + currency ∈ the 8-value enum (no NGN)
 *   P3 identity   — ≥1 t2_ profile (a Reddit ad IS a post; no author = no ad)
 *   P4 pixel      — pixel present: a HARD gate (conversion_pixel_id required
 *                   on every ad group since 2026-07-13 — GR-12)
 *   P5 tier       — n/a (own-account refresh token)
 *   P6 market     — community search callable with `query=` (R-P6)
 *
 * TikTok (ISSUE-863 WP7 — SPEC A1, PROOF T-P1…T-P5):
 *   P1 token      — advertiser/info read succeeds + STATUS_ENABLE
 *   P2 funding    — API balance vs the $20/day ad-group floor → WARN, never
 *                   a hard fail (the API is BLIND to the Advanced Payment
 *                   Portfolio — T-P3; the Ads Manager UI is source of truth)
 *   P3 identity   — a TT_USER identity with available_status=AVAILABLE
 *                   (REQUIRED by ad_create; the only viable non-Spark path
 *                   for this post-2026-01-15 account — T-6)
 *   P4 pixel      — pixel has events? zero events ⇒ WARN (conversion
 *                   objectives stay gated until #865 — T-P4; not a blocker)
 *   P5 tier       — own-app long-lived token; app APPROVED 2026-07-15 (T-P1)
 *   P6 market     — LIVE tool/region read (the resolveGeo path): US must
 *                   resolve; a live Mingla market absent (GB today — T-P2)
 *                   ⇒ WARN naming the market (TikTok-side gate, escalated)
 *
 * Other channels are fail-closed stubs: single-platform request → 424
 * <platform>_not_connected; all-platform sweep → per-row not_connected entries.
 *
 * Body: { platform?, lane?='consumer' } — omit platform for all five.
 * verify_jwt = true + in-code admin_users active gate. READ-ONLY (writes nothing).
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
  isPlatform,
  PLATFORMS,
  type Platform,
} from "../_shared/adChannel.ts";
import {
  metaCheckPageAdvertiseTask,
  metaFetchAccount,
  metaFetchPixelLastFired,
  metaGraph,
  metaValidateOnlyCreativeProbe,
  resolveMetaClient,
} from "../_shared/meta.ts";
import {
  googleFetchCustomer,
  resolveGoogleClient,
  suggestGeoTargetConstants,
} from "../_shared/google.ts";
import {
  redditConnectPreflight,
  RedditPreflightError,
  redditSearchCommunities,
  resolveRedditClient,
} from "../_shared/reddit.ts";
import {
  pickTikTokLocationIdsForCountries,
  resolveTikTokClient,
  TIKTOK_MIN_ADGROUP_DAILY_BUDGET_DOLLARS,
  tiktokFetchAdvertiser,
  tiktokFetchIdentity,
  tiktokFetchPixels,
  tiktokFetchRegions,
} from "../_shared/tiktok.ts";

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

type CheckStatus = "pass" | "fail" | "warn" | "n/a";

interface PreflightCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string | null;
}

interface PreflightRow {
  platform: Platform;
  lane: string;
  overall: "green" | "amber" | "red" | "not_connected";
  checks: PreflightCheck[];
  checked_at: string;
}

function stubRow(platform: Platform, lane: string): PreflightRow {
  return {
    platform,
    lane,
    overall: "not_connected",
    checks: [{
      id: "P1",
      label: "Token valid",
      status: "fail",
      detail:
        `${platform}_not_connected — adapter ships in a later WP (WP5 snapchat); fail-close until then.`,
    }],
    checked_at: new Date().toISOString(),
  };
}

/** Live Mingla markets the P6 geo check asserts against (GB proven absent — T-P2). */
const TIKTOK_P6_MARKETS = ["US", "GB", "NG"] as const;

/**
 * TikTok preflight (ISSUE-863 WP7 — SPEC A1, PROOF T-P1…T-P5): P1 advertiser
 * STATUS_ENABLE · P2 API balance vs the $20/day floor as a WARN (the API is
 * blind to the Advanced Payment Portfolio — UI is source of truth, T-P3) ·
 * P3 TT_USER identity AVAILABLE · P4 pixel events as a WARN (#865 owns the
 * pixel) · P6 the LIVE tool/region resolveGeo path (GB absent ⇒ WARN — T-P2).
 */
async function tiktokPreflight(
  conn: AdConnectionRow | null,
  lane: string,
): Promise<PreflightRow> {
  const checks: PreflightCheck[] = [];
  const push = (id: string, label: string, status: CheckStatus, detail: string | null = null) =>
    checks.push({ id, label, status, detail });

  let client;
  try {
    // Lane-correct resolution (QA P2-3): with no persisted row, the credential
    // probed is the LANE's env name, never a consumer fallback.
    client = resolveTikTokClient(conn ?? null, lane as "consumer" | "business");
  } catch (err) {
    const detail = err instanceof AdNotConnectedError
      ? "tiktok_not_connected — set the TIKTOK_ACCESS_TOKEN / TIKTOK_ADVERTISER_ID Supabase Edge Function secrets (SPEC §7), then connect."
      : err instanceof Error
      ? err.message
      : String(err);
    push("P1", "Token valid + advertiser active", "fail", detail);
    return {
      platform: "tiktok",
      lane,
      overall: "not_connected",
      checks,
      checked_at: new Date().toISOString(),
    };
  }

  // P1 — the token reads the configured advertiser AND it is STATUS_ENABLE.
  let apiBalance: number | null = null;
  try {
    const advertiser = await tiktokFetchAdvertiser(client);
    apiBalance = advertiser.balance;
    const enabled = advertiser.status === "STATUS_ENABLE";
    push(
      "P1",
      "Token valid + advertiser active",
      enabled ? "pass" : "fail",
      enabled
        ? null
        : `advertiser status=${advertiser.status ?? "unknown"} — a STATUS_ENABLE advertiser is required.`,
    );
    if (!enabled) {
      return {
        platform: "tiktok",
        lane,
        overall: "red",
        checks,
        checked_at: new Date().toISOString(),
      };
    }
  } catch (err) {
    push(
      "P1",
      "Token valid + advertiser active",
      "fail",
      err instanceof AdApiError ? err.message : err instanceof Error ? err.message : String(err),
    );
    return {
      platform: "tiktok",
      lane,
      overall: "red",
      checks,
      checked_at: new Date().toISOString(),
    };
  }

  // P2 — funding vs the $20/day ad-group floor: a WARN, never a hard fail —
  // the Marketing API balance is BLIND to the Advanced Payment Portfolio
  // (T-P3: API 0.0 while $10 prepaid sits in the portfolio; $10 < $20 anyway).
  const balanceKnownSufficient = typeof apiBalance === "number" &&
    apiBalance >= TIKTOK_MIN_ADGROUP_DAILY_BUDGET_DOLLARS;
  push(
    "P2",
    "Funding vs $20/day floor",
    balanceKnownSufficient ? "pass" : "warn",
    balanceKnownSufficient
      ? null
      : `API balance ${apiBalance ?? "unknown"} is below the $${TIKTOK_MIN_ADGROUP_DAILY_BUDGET_DOLLARS}/day ad-group floor — BUT the API cannot see the Advanced Payment Portfolio (UI is source of truth). Launched campaigns park at BALANCE_EXCEED until the portfolio covers one day's minimum.`,
  );

  // P3 — identity: ad_create REQUIRES identity_type+identity_id; TT_USER is
  // the ONLY viable non-Spark identity for this post-2026-01-15 account (T-6).
  try {
    const identity = await tiktokFetchIdentity(client);
    const ok = Boolean(identity && identity.availableStatus === "AVAILABLE");
    push(
      "P3",
      "TT_USER identity AVAILABLE",
      ok ? "pass" : "fail",
      ok
        ? null
        : "No AVAILABLE TT_USER identity — ad create is blocked (no identity, no ad). Re-authorize @usemingla for ads.",
    );
  } catch (err) {
    push("P3", "TT_USER identity AVAILABLE", "fail", err instanceof Error ? err.message : String(err));
  }

  // P4 — pixel signal: zero events ⇒ WARN (conversion objectives stay gated
  // until #865 wires the pixel — T-P4; TRAFFIC never uses it).
  try {
    const pixels = await tiktokFetchPixels(client);
    const withEvents = pixels.find((p) => p.eventsCount > 0);
    push(
      "P4",
      "Pixel firing",
      withEvents ? "pass" : "warn",
      withEvents
        ? null
        : "Pixel has zero events (NO_RECENT_ACTIVITY) — WEB_CONVERSIONS/PRODUCT_SALES and Smart+ stay gated until #865 installs the pixel; TRAFFIC and APP_PROMOTION+INSTALL are the honest objectives today.",
    );
  } catch (err) {
    push("P4", "Pixel firing", "warn", err instanceof Error ? err.message : String(err));
  }

  // P5 — access tier: own-app long-lived token; the developer app was
  // APPROVED and the engine token proven live on 2026-07-15 (T-P1).
  push(
    "P5",
    "Review / access tier",
    "pass",
    "Own-app long-lived Marketing-API token — app approved 2026-07-15 (T-P1); the reads above ran against the real advertiser.",
  );

  // P6 — market reachability: the LIVE tool/region resolveGeo path (OD-7
  // reversed — never a build-time map). US must resolve; a live Mingla market
  // absent (GB today — T-P2, escalated to TikTok) ⇒ WARN naming it.
  try {
    const regions = await tiktokFetchRegions(client, { objective: "TRAFFIC" });
    const picked = pickTikTokLocationIdsForCountries(regions, TIKTOK_P6_MARKETS, {
      objective: "TRAFFIC",
    });
    if (picked.ok) {
      push("P6", "Markets reachable (live tool/region)", "pass", null);
    } else if (picked.missing.includes("US")) {
      push(
        "P6",
        "Markets reachable (live tool/region)",
        "fail",
        `tool/region did not resolve ${picked.missing.join(", ")} — the primary market (US) is unreachable; the geo resolver path is broken.`,
      );
    } else {
      push(
        "P6",
        "Markets reachable (live tool/region)",
        "warn",
        `tool/region does not offer ${picked.missing.join(", ")} for this advertiser (GB was proven absent for BOTH TRAFFIC and APP_PROMOTION on 2026-07-15 — T-P2; escalated to TikTok as an entity-registration gate). Campaigns targeting these markets fail loudly at create.`,
      );
    }
  } catch (err) {
    push(
      "P6",
      "Markets reachable (live tool/region)",
      "fail",
      err instanceof AdApiError ? err.message : err instanceof Error ? err.message : String(err),
    );
  }

  const anyHardFail = checks.some((c) => c.status === "fail");
  const anyWarn = checks.some((c) => c.status === "warn");
  return {
    platform: "tiktok",
    lane,
    overall: anyHardFail ? "red" : anyWarn ? "amber" : "green",
    checks,
    checked_at: new Date().toISOString(),
  };
}

/**
 * Reddit preflight (ISSUE-916 WP6 — SPEC §1.3): the same 7-step fail-close
 * probe as connect answers P1 (mint + /me + business + account) · P2 (funding
 * is_servable + 8-currency enum — reasons_not_servable VERBATIM) · P3
 * (identity = a t2_ profile exists: a Reddit ad IS a post and needs an
 * author) · P4 (pixel present — a HARD gate, not a warn: conversion_pixel_id
 * is required on every ad group since 2026-07-13, GR-12) · P5 n/a (own-account
 * refresh token) · P6 (community search via `query=` — R-P6 — the reason to do
 * Reddit at all, under the tightest 100 req/60 s pool).
 */
async function redditPreflight(
  conn: AdConnectionRow | null,
  lane: string,
): Promise<PreflightRow> {
  const checks: PreflightCheck[] = [];
  const push = (id: string, label: string, status: CheckStatus, detail: string | null = null) =>
    checks.push({ id, label, status, detail });
  const now = (): string => new Date().toISOString();

  try {
    const snapshot = await redditConnectPreflight(
      conn,
      lane as "consumer" | "business",
    );
    push("P1", "Token mints + account reachable", "pass", null);
    push(
      "P2",
      "Funding instrument servable",
      "pass",
      `funding_instrument ${snapshot.fundingInstrumentId} is_servable; currency ${
        snapshot.account.currency ?? "unknown"
      }.`,
    );
    push("P3", "Post-author profile exists", "pass", `profile ${snapshot.profileId}.`);
    push("P4", "Conversion pixel present", "pass", `pixel ${snapshot.pixelId} (GR-12).`);
    push("P5", "Review / access tier", "n/a", "Own-account refresh token — no tier gate.");

    // P6 — market reachable: the community picker path (query=, NEVER q= — R-P6).
    try {
      const client = await resolveRedditClient(conn, lane as "consumer" | "business");
      await redditSearchCommunities(client, "london");
      push("P6", "Market reachable (community search)", "pass", null);
    } catch (err) {
      push(
        "P6",
        "Market reachable (community search)",
        "fail",
        err instanceof AdApiError ? err.message : err instanceof Error ? err.message : String(err),
      );
    }
  } catch (err) {
    if (err instanceof AdNotConnectedError) {
      push(
        "P1",
        "Token mints + account reachable",
        "fail",
        "reddit_not_connected — set REDDIT_ADS_CLIENT_ID / REDDIT_ADS_CLIENT_SECRET / REDDIT_ADS_REFRESH_TOKEN (duration=permanent), then connect (SPEC §1.1–§1.2).",
      );
      return { platform: "reddit", lane, overall: "not_connected", checks, checked_at: now() };
    }
    if (err instanceof RedditPreflightError) {
      if (err.errorCode === "reddit_profile_missing") {
        push("P1", "Token mints + account reachable", "pass", null);
        push("P3", "Post-author profile exists", "fail", err.message);
      } else if (err.errorCode === "reddit_funding_not_servable") {
        push("P1", "Token mints + account reachable", "pass", null);
        push("P2", "Funding instrument servable", "fail", err.message);
      } else {
        push("P1", "Token mints + account reachable", "fail", err.message);
      }
      return { platform: "reddit", lane, overall: "red", checks, checked_at: now() };
    }
    push(
      "P1",
      "Token mints + account reachable",
      "fail",
      err instanceof AdApiError ? err.message : err instanceof Error ? err.message : String(err),
    );
    return { platform: "reddit", lane, overall: "red", checks, checked_at: now() };
  }

  const anyHardFail = checks.some((c) => c.status === "fail");
  const anyWarn = checks.some((c) => c.status === "warn");
  return {
    platform: "reddit",
    lane,
    overall: anyHardFail ? "red" : anyWarn ? "amber" : "green",
    checks,
    checked_at: now(),
  };
}

/**
 * Google preflight (ISSUE-867 WP2 — A1.3/G-P1): one cheap GAQL SELECT on the
 * customer resource answers P1 (the refresh token mints AND the developer
 * token works on this account — BASIC tier) + P2 (customer ENABLED, real
 * account, billed); P6 proves the GR-37 geo resolver path (the G-P2
 * countryCode-scoped suggest). P4 is n/a — Google conversion tracking is #865.
 */
async function googlePreflight(
  conn: AdConnectionRow | null,
  lane: string,
): Promise<PreflightRow> {
  const checks: PreflightCheck[] = [];
  const push = (id: string, label: string, status: CheckStatus, detail: string | null = null) =>
    checks.push({ id, label, status, detail });

  let client;
  try {
    client = await resolveGoogleClient(conn ?? null, lane as "consumer" | "business");
  } catch (err) {
    const detail = err instanceof AdNotConnectedError
      ? err.detail === "google_not_provisioned"
        ? "google_not_provisioned — set the GOOGLE_ADS_* Supabase Edge Function secrets (SPEC §7 Google 5–6), then connect."
        : "google_not_connected — the refresh token could not mint an access token; re-provision GOOGLE_ADS_REFRESH_TOKEN."
      : err instanceof Error
      ? err.message
      : String(err);
    push("P1", "Token mints + developer token", "fail", detail);
    return {
      platform: "google",
      lane,
      overall: "not_connected",
      checks,
      checked_at: new Date().toISOString(),
    };
  }

  // P1 + P2 — one GAQL SELECT customer proves mint + dev token + account state.
  try {
    const customer = await googleFetchCustomer(client);
    push("P1", "Token mints + developer token", "pass", null);
    const enabled = customer.status === "ENABLED" && !customer.testAccount;
    push(
      "P2",
      "Customer ENABLED (real, billed account)",
      enabled ? "pass" : "fail",
      enabled
        ? null
        : `customer.status=${customer.status ?? "unknown"}, test_account=${customer.testAccount} — an ENABLED, non-test, billed account is required (G-P1).`,
    );
  } catch (err) {
    push(
      "P1",
      "Token mints + developer token",
      "fail",
      err instanceof AdApiError ? err.message : err instanceof Error ? err.message : String(err),
    );
    return {
      platform: "google",
      lane,
      overall: "red",
      checks,
      checked_at: new Date().toISOString(),
    };
  }

  // P4 — conversion signal: n/a here (Google conversion tracking is #865).
  push("P4", "Conversion signal", "n/a", "Google conversion tracking lands with #865 — targetSpend (maximize clicks) is the honest strategy until then (GR-55).");

  // P5 — access tier: reaching the customer at all proves BASIC (G-P1).
  push("P5", "Review / access tier", "pass", "BASIC tier approved 2026-07-15 — the GAQL read above ran against the real account.");

  // P6 — market reachable: the GR-37 geo resolver (G-P2 disambiguation path).
  try {
    const london = await suggestGeoTargetConstants(client, {
      name: "London",
      countryCode: "GB",
    });
    push(
      "P6",
      "Market reachable (geo suggest)",
      london ? "pass" : "fail",
      london
        ? null
        : "geoTargetConstants:suggest returned no ENABLED GB match for London — the geo resolver path is broken (GR-37).",
    );
  } catch (err) {
    push(
      "P6",
      "Market reachable (geo suggest)",
      "fail",
      err instanceof AdApiError ? err.message : err instanceof Error ? err.message : String(err),
    );
  }

  const anyHardFail = checks.some((c) => c.status === "fail");
  const anyWarn = checks.some((c) => c.status === "warn");
  return {
    platform: "google",
    lane,
    overall: anyHardFail ? "red" : anyWarn ? "amber" : "green",
    checks,
    checked_at: new Date().toISOString(),
  };
}

async function metaPreflight(
  conn: AdConnectionRow | null,
  lane: string,
): Promise<PreflightRow> {
  const checks: PreflightCheck[] = [];
  const push = (id: string, label: string, status: CheckStatus, detail: string | null = null) =>
    checks.push({ id, label, status, detail });

  let client;
  try {
    // Lane-correct resolution (QA P2-3): with no persisted row, the credential
    // probed is the LANE's env name, never a consumer fallback.
    client = resolveMetaClient(conn ?? null, lane as "consumer" | "business");
  } catch (err) {
    const detail = err instanceof AdNotConnectedError
      ? "Token secret unset — set the Supabase Edge Function secret and connect."
      : err instanceof Error
      ? err.message
      : String(err);
    push("P1", "Token valid", "fail", detail);
    return {
      platform: "meta",
      lane,
      overall: "not_connected",
      checks,
      checked_at: new Date().toISOString(),
    };
  }

  // P1 — token authenticates AND can see the configured ad account.
  try {
    const payload = await metaGraph(client, "GET", "me/adaccounts", {
      fields: "id",
      limit: "100",
    });
    const rows = Array.isArray(payload.data) ? payload.data as Record<string, unknown>[] : [];
    const found = rows.some((r) => String(r.id) === `act_${client.config.adAccountId}`);
    push(
      "P1",
      "Token valid",
      found ? "pass" : "fail",
      found ? null : "Token authenticates but cannot see the configured ad account.",
    );
  } catch (err) {
    push("P1", "Token valid", "fail", err instanceof Error ? err.message : String(err));
    return {
      platform: "meta",
      lane,
      overall: "red",
      checks,
      checked_at: new Date().toISOString(),
    };
  }

  // P2 — billing/funding.
  try {
    const account = await metaFetchAccount(client);
    const ok = account.accountStatus === "ACTIVE" && account.hasPaymentMethod;
    push(
      "P2",
      "Billing / funding present",
      ok ? "pass" : "fail",
      ok ? null : `account_status=${account.accountStatus ?? "unknown"}, payment method ${
        account.hasPaymentMethod ? "present" : "MISSING"
      } — launched campaigns park at PENDING_BILLING_INFO until billing is added.`,
    );
  } catch (err) {
    push("P2", "Billing / funding present", "fail", err instanceof Error ? err.message : String(err));
  }

  // P3 — identity: Page + ADVERTISE task (A4.e.1) and app-Live (A4.e.2).
  try {
    const page = await metaCheckPageAdvertiseTask(client);
    push(
      "P3",
      "Page granted with ADVERTISE task",
      page.ok ? "pass" : "fail",
      page.ok ? null : "meta_page_not_assigned — assign the Page to the system user in Business Settings.",
    );
  } catch (err) {
    push("P3", "Page granted with ADVERTISE task", "fail", err instanceof Error ? err.message : String(err));
  }
  try {
    const probe = await metaValidateOnlyCreativeProbe(client);
    push(
      "B6",
      "Developer app is Live",
      probe.appLive ? "pass" : "fail",
      probe.appLive ? null : "meta_app_not_live (error 1885183) — switch the app to Live in the App Dashboard.",
    );
  } catch (err) {
    push("B6", "Developer app is Live", "fail", err instanceof Error ? err.message : String(err));
  }

  // P4 — pixel signal (WARN, not a blocker: LINK_CLICKS still works — A4.e.5).
  try {
    const pixel = await metaFetchPixelLastFired(client);
    push(
      "P4",
      "Pixel firing",
      pixel.hasSignal ? "pass" : "warn",
      pixel.hasSignal
        ? null
        : "Pixel has never fired — LANDING_PAGE_VIEWS / OFFSITE_CONVERSIONS / VALUE are gated (422 pixel_no_signal); LINK_CLICKS is the honest goal until #865 wires the pixel.",
    );
  } catch (err) {
    push("P4", "Pixel firing", "warn", err instanceof Error ? err.message : String(err));
  }

  // P5 — access tier: n/a on Meta (own-account system-user token, no App Review).
  push("P5", "Review / access tier", "n/a", "Own-account system-user token — no tier gate.");

  // P6 — market reachability: Targeting Search callable (PROOF M-P9).
  try {
    await metaGraph(client, "GET", "search", {
      type: "adgeolocation",
      q: "london",
      location_types: ["city"],
      limit: "1",
    });
    push("P6", "Market reachable (Targeting Search)", "pass", null);
  } catch (err) {
    push(
      "P6",
      "Market reachable (Targeting Search)",
      "fail",
      err instanceof AdApiError ? err.message : err instanceof Error ? err.message : String(err),
    );
  }

  const anyHardFail = checks.some((c) => c.status === "fail");
  const anyWarn = checks.some((c) => c.status === "warn");
  return {
    platform: "meta",
    lane,
    overall: anyHardFail ? "red" : anyWarn ? "amber" : "green",
    checks,
    checked_at: new Date().toISOString(),
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    body = {};
  }

  const lane = body.lane ?? "consumer";
  if (!isLane(lane)) return json({ error: "validation_error", detail: "lane_invalid" }, 400);
  const platform = body.platform;
  if (platform !== undefined && !isPlatform(platform)) {
    return json({ error: "validation_error", detail: "platform_invalid" }, 400);
  }

  // ── ADMIN GATE (SPEC §4.4). ──────────────────────────────────────────────────
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

  // Single unbuilt platform → fail-close 424 (stub until its WP lands).
  if (
    platform !== undefined && platform !== "meta" && platform !== "google" &&
    platform !== "reddit" && platform !== "tiktok"
  ) {
    return json({
      error: `${platform}_not_connected`,
      detail: stubRow(platform, lane).checks[0].detail,
    }, 424);
  }

  const loadConnection = async (p: Platform): Promise<AdConnectionRow | null> => {
    const { data } = await supabase
      .from("ad_connections")
      .select("*")
      .eq("platform", p)
      .eq("lane", lane)
      .maybeSingle();
    return (data ?? null) as AdConnectionRow | null;
  };

  if (platform === "meta") {
    const row = await metaPreflight(await loadConnection("meta"), lane);
    return json({ rows: [row] });
  }
  if (platform === "google") {
    const row = await googlePreflight(await loadConnection("google"), lane);
    return json({ rows: [row] });
  }
  if (platform === "reddit") {
    const row = await redditPreflight(await loadConnection("reddit"), lane);
    return json({ rows: [row] });
  }
  if (platform === "tiktok") {
    const row = await tiktokPreflight(await loadConnection("tiktok"), lane);
    return json({ rows: [row] });
  }

  // All five channels.
  const rows: PreflightRow[] = [];
  for (const p of PLATFORMS) {
    if (p === "meta") rows.push(await metaPreflight(await loadConnection("meta"), lane));
    else if (p === "google") {
      rows.push(await googlePreflight(await loadConnection("google"), lane));
    } else if (p === "reddit") {
      rows.push(await redditPreflight(await loadConnection("reddit"), lane));
    } else if (p === "tiktok") {
      rows.push(await tiktokPreflight(await loadConnection("tiktok"), lane));
    } else rows.push(stubRow(p, lane));
  }
  return json({ rows });
});
