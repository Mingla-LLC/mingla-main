/**
 * reddit.ts — the Reddit Ads ChannelAdapter (ISSUE-916 WP6 — Reddit lane).
 *
 * SPEC: Mingla_Artifacts/specs/SPEC_ISSUE-REDDIT_CHANNEL.md (§1–§8), built
 * against the ISSUE-862 A4.a ChannelAdapter (adChannel.ts is the merged,
 * canonical interface), grounded in PROOF_LOG.md R-P1…R-P6 + D-P1 (live probes
 * with the engine's own credentials, 2026-07-15):
 *   - A Reddit ad IS a post: ad.post_id → a real t3_ post authored by a t2_
 *     profile; the post is created by an ASYNC JOB polled to completion before
 *     createAd is callable (GR-10; §3.4).
 *   - configured_status DEFAULTS TO ACTIVE on Reddit — a forgotten field
 *     publishes a LIVE, SPENDING campaign. Every create body here sets
 *     configured_status: "PAUSED" explicitly at all three levels; the
 *     issue-862-reddit-configured-status-explicit strict-grep gate (G-1)
 *     fails CI if any builder drops it (GR-11).
 *   - conversion_pixel_id is REQUIRED on EVERY ad group and every CBO
 *     campaign since 2026-07-13 (GR-12); on Reddit the pixel id IS the
 *     ad-account id (R-P3). Injected UNCONDITIONALLY.
 *   - There is NO DELETE verb on campaign/ad_group/ad — rollback is
 *     PATCH configured_status: "DELETED", in reverse creation order (R-5).
 *   - Token mint reads `expires_in` from the response (ours is proven 86400,
 *     R-P1 — but 1h accounts exist; NEVER hardcode a TTL literal, R-2).
 *   - Descriptive User-Agent on EVERY request INCLUDING the token mint —
 *     Reddit aggressively 429s/403s default UA strings (GR-71).
 *   - Success = plain HTTP status codes (201 create / 200 read+patch). There
 *     is NO batch envelope — do not invent one (§1.5).
 *   - Community search param is `query=` — `q=` silently no-ops and returns
 *     the popular list (R-P6; gate G-4).
 *   - Reddit has NO age targeting; targeting is additionalProperties:false —
 *     an emitted age_min key is an outright 400 (R-8). The serializer emits
 *     ONLY allowlisted keys (gate G-4).
 *   - CTAs are Title-Case DISPLAY STRINGS ("Buy Tickets") — any uppercase/
 *     snake normalizer 400s (GR-29; gate G-2).
 *   - Money (A4.a / GR-01): cents at rest; the ONE cents→micro conversion is
 *     toMicro() below (×10,000 via centsToPlatformBudget). The ONLY hard money
 *     bound is the CPC bid band $3.50–$100 — there is NO daily-budget floor of
 *     ours (goal_value minimum is 0 in Reddit's schema; GR-59; gate G-3).
 *   - Destination policy (D-P1 / GR-32): destination.url and click_url are the
 *     canonical usemingla.com page — NEVER go.usemingla.com or *.onelink.me
 *     (AppsFlyer serves crawlers an app-install interstitial = BRIDGE_PAGE).
 *
 * SECURITY (A3 §E / SC-SEC-1): REDDIT_ADS_CLIENT_ID / REDDIT_ADS_CLIENT_SECRET
 * / REDDIT_ADS_REFRESH_TOKEN live ONLY in Supabase Edge Function Secrets
 * (Deno.env). The minted access token exists only in edge memory (module-scope
 * cache) and is never persisted, logged, or echoed in any error or response.
 */

import {
  AdApiError,
  AdNotConnectedError,
  type AdConnectionRow,
  type AdvertiserStatus,
  type AuthedClient,
  centsToPlatformBudget,
  type ChannelAdapter,
  type CreateAdInput,
  type CreateAdSetInput,
  type CreateCampaignInput,
  type CreateCreativeInput,
  type EntityLevel,
  REDDIT_CTA_MAP,
} from "./adChannelCore.ts";

// ── Env config (NAMES per SPEC §1.1 — values live in Function Secrets) ────────

export const REDDIT_ADS_DEFAULT_API_BASE = "https://ads-api.reddit.com/api/v3";
export const REDDIT_DEFAULT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

/**
 * GR-71: descriptive UA on EVERY call including the token mint. Set in ONE
 * place (the transport + mint below) so no call can miss it.
 */
export const REDDIT_USER_AGENT =
  "mingla-ad-engine/1.0 (by /u/usemingla; support@usemingla.com)";

export type RedditLane = "consumer" | "business";

/**
 * Lane-correct env-var NAMES (QA P2-3 house rule, mirrors meta.ts/google.ts):
 * the business lane must never silently fall back to the consumer credential.
 * Only the consumer lane is provisioned today (SPEC §0.2) — the business
 * names simply fail-close until seeded.
 */
function laneEnvName(base: string, lane: RedditLane): string {
  return lane === "business" ? base.replace(/^REDDIT_ADS_/, "REDDIT_ADS_MINGLABIZ_") : base;
}

export function redditDefaultTokenEnvVar(lane: RedditLane): string {
  return laneEnvName("REDDIT_ADS_REFRESH_TOKEN", lane);
}

/** Resolved secret VALUES — in edge memory only, never persisted/echoed. */
export interface RedditEnvValues {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Cache key NAME (lanes must not share a mint). */
  refreshTokenEnvVar: string;
  apiBase: string;
  tokenUrl: string;
  /** Optional expected-ID pins (non-secret; connect asserts when set). */
  expectedBusinessId: string | null;
  expectedAccountId: string | null;
  expectedProfileId: string | null;
  expectedPixelId: string | null;
  expectedFundingInstrumentId: string | null;
}

/**
 * FAIL-CLOSE (AC-R-4): ANY missing secret throws AdNotConnectedError
 * `reddit_not_connected` BEFORE any network call. Do NOT soften this throw.
 */
export function resolveRedditEnvConfig(
  conn?: Pick<AdConnectionRow, "token_env_var"> | null,
  lane: RedditLane = "consumer",
): RedditEnvValues {
  const refreshTokenEnvVar = (conn?.token_env_var ?? redditDefaultTokenEnvVar(lane)).trim() ||
    redditDefaultTokenEnvVar(lane);
  const read = (name: string): string => (Deno.env.get(name) ?? "").trim();
  const clientId = read(laneEnvName("REDDIT_ADS_CLIENT_ID", lane));
  const clientSecret = read(laneEnvName("REDDIT_ADS_CLIENT_SECRET", lane));
  const refreshToken = read(refreshTokenEnvVar);
  if (!clientId || !clientSecret || !refreshToken) {
    throw new AdNotConnectedError("reddit", "reddit_not_connected");
  }
  const readOptional = (name: string): string | null => read(laneEnvName(name, lane)) || null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    refreshTokenEnvVar,
    apiBase: read("REDDIT_ADS_API_BASE") || REDDIT_ADS_DEFAULT_API_BASE,
    tokenUrl: read("REDDIT_ADS_TOKEN_URL") || REDDIT_DEFAULT_TOKEN_URL,
    expectedBusinessId: readOptional("REDDIT_ADS_BUSINESS_ID"),
    expectedAccountId: readOptional("REDDIT_ADS_ACCOUNT_ID"),
    expectedProfileId: readOptional("REDDIT_ADS_PROFILE_ID"),
    expectedPixelId: readOptional("REDDIT_ADS_PIXEL_ID"),
    expectedFundingInstrumentId: readOptional("REDDIT_ADS_FUNDING_INSTRUMENT_ID"),
  };
}

// ── Money — THE one cents→micro conversion for Reddit (A4.a / GR-01 / G-3) ────

/**
 * Gate G-3: $5.00 → 500¢ → 5,000,000 micro. All minimum/band checks run in
 * micro AFTER conversion. Delegates to the house-wide converter so the ×10,000
 * factor lives in exactly one registry (adChannel.ts PLATFORM_BUDGET_UNIT).
 */
export function toMicro(cents: number): number {
  return centsToPlatformBudget("reddit", cents);
}

/** The ONLY hard money bound anywhere [SPEC]: bid_value $3.50–$100 when CPC. */
export const REDDIT_CPC_BID_MIN_MICRO = 3_500_000;
export const REDDIT_CPC_BID_MAX_MICRO = 100_000_000;

export type RedditValidation =
  | { ok: true }
  | { ok: false; detail: string; message: string };

/**
 * GR-59: this is a BID band check, not a budget floor. Deliberately NO
 * daily-budget floor exists anywhere in this adapter — Reddit's schema has
 * goal_value minimum 0; if Reddit 400s a low budget, that 400 is surfaced
 * verbatim (gate G-3 asserts a $2.00/day goal_value passes our validation).
 */
export function validateRedditCpcBidMicro(bidValueMicro: number): RedditValidation {
  if (!Number.isInteger(bidValueMicro)) {
    return {
      ok: false,
      detail: "bid_value_invalid",
      message: "bid_value must be an integer micro amount.",
    };
  }
  if (bidValueMicro < REDDIT_CPC_BID_MIN_MICRO || bidValueMicro > REDDIT_CPC_BID_MAX_MICRO) {
    return {
      ok: false,
      detail: "bid_value_out_of_band",
      message:
        `CPC bid_value must be between ${REDDIT_CPC_BID_MIN_MICRO} and ${REDDIT_CPC_BID_MAX_MICRO} micro ($3.50–$100 USD) — got ${bidValueMicro}.`,
    };
  }
  return { ok: true };
}

// ── Objective map — a constant, not a literal (GR-70 / §3.3) ──────────────────

/**
 * GR-70: the 2026-09-30 migration renames IMPRESSIONS→BRAND_AWARENESS and
 * CONVERSIONS→SALES; CLICKS→CLICKS is stable. Call sites use
 * REDDIT_OBJECTIVE.* — never a hardcoded literal.
 */
export const REDDIT_OBJECTIVE = { TRAFFIC: "CLICKS" } as const;

/** The REAL 7-value enum [SPEC] — no TRAFFIC, no REACH, no BRAND_AWARENESS (R-6). */
export const REDDIT_OBJECTIVE_ENUM = [
  "APP_INSTALLS",
  "CATALOG_SALES",
  "CLICKS",
  "CONVERSIONS",
  "IMPRESSIONS",
  "LEAD_GENERATION",
  "VIDEO_VIEWABLE_IMPRESSIONS",
] as const;

/** CBO is NOT eligible for these objectives [S4 / §3.1]. */
export const REDDIT_CBO_INELIGIBLE_OBJECTIVES: readonly string[] = [
  "APP_INSTALLS",
  "CONVERSIONS",
  "CATALOG_SALES",
];

/**
 * Normalizes an engine objective to Reddit's enum: the engine's traffic
 * vocabulary maps through REDDIT_OBJECTIVE; anything else must already be a
 * member of the 7-value enum. LEAD_GENERATION (form API sunsets 2026-09-30)
 * and CATALOG_SALES (no product catalog exists) are rejected at the adapter.
 */
export function normalizeRedditObjective(
  objective: string,
): { ok: true; objective: string } | { ok: false; detail: string; message: string } {
  const mapped = objective === "TRAFFIC" || objective === "OUTCOME_TRAFFIC"
    ? REDDIT_OBJECTIVE.TRAFFIC
    : objective;
  if (!(REDDIT_OBJECTIVE_ENUM as readonly string[]).includes(mapped)) {
    return {
      ok: false,
      detail: "invalid_objective",
      message:
        `Objective "${objective}" is not in Reddit's enum (${REDDIT_OBJECTIVE_ENUM.join(", ")}) — there is no TRAFFIC/REACH/BRAND_AWARENESS today (R-6).`,
    };
  }
  if (mapped === "LEAD_GENERATION") {
    return {
      ok: false,
      detail: "objective_sunset",
      message:
        "LEAD_GENERATION is rejected: on-Reddit lead forms are no longer supported and the form API sunsets 2026-09-30 — never build on it (§3.3).",
    };
  }
  if (mapped === "CATALOG_SALES") {
    return {
      ok: false,
      detail: "objective_unsupported",
      message: "CATALOG_SALES is rejected: Mingla has no product catalog (§10.1).",
    };
  }
  return { ok: true, objective: mapped };
}

/** Ad-group optimization_goal — the 28-value enum [SPEC §3.3] (null allowed). */
export const REDDIT_OPTIMIZATION_GOAL_ENUM = [
  "ADD_TO_CART",
  "ADD_TO_WISHLIST",
  "CLICKS",
  "LEAD",
  "PAGE_VISIT",
  "PURCHASE",
  "SEARCH",
  "SIGN_UP",
  "UNKNOWN",
  "VIEW_CONTENT",
  "LANDING_PAGE_VISIT",
  "VIDEO_VIEW_6S",
  "VIDEO_VIEW_15S",
  "MOBILE_CONVERSION_INSTALL",
  "MOBILE_CONVERSION_SIGN_UP",
  "MOBILE_CONVERSION_ADD_PAYMENT_INFO",
  "MOBILE_CONVERSION_ADD_TO_CART",
  "MOBILE_CONVERSION_PURCHASE",
  "MOBILE_CONVERSION_COMPLETED_TUTORIAL",
  "MOBILE_CONVERSION_LEVEL_ACHIEVED",
  "MOBILE_CONVERSION_SPEND_CREDITS",
  "MOBILE_CONVERSION_REINSTALL",
  "MOBILE_CONVERSION_UNLOCK_ACHIEVEMENT",
  "MOBILE_CONVERSION_START_TRIAL",
  "MOBILE_CONVERSION_SUBSCRIBE",
  "MOBILE_CONVERSION_ONBOARD_STARTED",
  "MOBILE_CONVERSION_FIRST_TIME_PURCHASE",
] as const;

// ── CTA — the 24 Title-Case verbatim display strings (GR-29 / G-2) ────────────

/**
 * These are DISPLAY STRINGS, not constants — "Buy Tickets", never BUY_TICKETS.
 * Membership is byte-exact; gate G-2 asserts no uppercase/snake normalizer
 * ever touches the emitted value.
 */
export const REDDIT_CTA_ENUM: readonly string[] = [
  "Apply Now",
  "Contact Us",
  "Download",
  "Get a Quote",
  "Get Showtimes",
  "Install",
  "Learn More",
  "Order Now",
  "Play Now",
  "Pre-order Now",
  "See Menu",
  "Shop Now",
  "Sign Up",
  "View More",
  "Watch Now",
  "Book Now",
  "Buy Tickets",
  "Get Directions",
  "Listen Now",
  "Read More",
  "Subscribe",
  "Visit Store",
  "Donate Now",
  "Remind Me",
];

/** Offering → CTA (PIPELINE_BLUEPRINT §1.6) — re-exported from the A4.a map. */
export { REDDIT_CTA_MAP };

export function validateRedditCta(cta: string): RedditValidation {
  if (!REDDIT_CTA_ENUM.includes(cta)) {
    return {
      ok: false,
      detail: "invalid_cta",
      message:
        `call_to_action "${cta}" is not one of Reddit's 24 Title-Case display strings (GR-29) — e.g. "Buy Tickets", never "BUY_TICKETS".`,
    };
  }
  return { ok: true };
}

// ── Token mint + module-scope cache (SPEC §1.2 / AC-R-2) ──────────────────────

interface MintedToken {
  token: string;
  scope: string | null;
  expiresAtMs: number;
}

/** Keyed by refresh-token env-var NAME so lanes never share a minted token. */
const redditTokenCache = new Map<string, MintedToken>();

/** Test hook — clears the in-memory mint cache (never exposes a token). */
export function resetRedditTokenCacheForTests(): void {
  redditTokenCache.clear();
}

/** Test hook — expiry timestamp only (AC-R-2); the token itself is never exposed. */
export function peekRedditTokenExpiryForTests(refreshTokenEnvVar: string): number | null {
  return redditTokenCache.get(refreshTokenEnvVar)?.expiresAtMs ?? null;
}

/**
 * SPEC §1.2: cache for `expires_in − 300` seconds. The TTL is READ FROM THE
 * RESPONSE — ours is proven 86400 (R-P1) but 1-hour accounts exist and the
 * adapter must accept either (R-2). There is deliberately NO hardcoded TTL
 * constant in this file.
 */
export const REDDIT_TOKEN_EXPIRY_MARGIN_SECONDS = 300;

/**
 * Mints (or reuses) a short-lived access token from the permanent-duration
 * refresh token: HTTP Basic (client_id:client_secret) + form-encoded
 * grant_type=refresh_token, with the descriptive User-Agent ON THE MINT
 * ITSELF (GR-71 / AC-R-3). FAIL-CLOSE: any mint failure throws
 * AdNotConnectedError (→ 424 reddit_not_connected).
 */
export async function mintRedditAccessToken(
  env: RedditEnvValues,
): Promise<{ token: string; scope: string | null }> {
  const cached = redditTokenCache.get(env.refreshTokenEnvVar);
  if (cached && cached.expiresAtMs > Date.now()) {
    return { token: cached.token, scope: cached.scope };
  }

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", env.refreshToken);

  let response: Response;
  try {
    response = await fetch(env.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${env.clientId}:${env.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // AC-R-3: the descriptive UA rides on the token mint too.
        "User-Agent": REDDIT_USER_AGENT,
      },
      body: form.toString(),
    });
  } catch {
    // Network failure at mint — fail-close, no detail that could carry a secret.
    throw new AdNotConnectedError("reddit", "reddit_not_connected");
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!response.ok || !accessToken) {
    throw new AdNotConnectedError("reddit", "reddit_not_connected");
  }
  const scope = typeof payload.scope === "string" ? payload.scope : null;
  // R-2: the TTL comes from the response — never a hardcoded literal.
  const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0
    ? payload.expires_in
    : null;
  if (expiresIn !== null) {
    const ttlSeconds = Math.max(0, expiresIn - REDDIT_TOKEN_EXPIRY_MARGIN_SECONDS);
    redditTokenCache.set(env.refreshTokenEnvVar, {
      token: accessToken,
      scope,
      expiresAtMs: Date.now() + ttlSeconds * 1000,
    });
  }
  return { token: accessToken, scope };
}

export interface RedditClient extends AuthedClient {
  platform: "reddit";
  accessToken: string;
  scope: string | null;
  apiBase: string;
  /** Re-mints on 401 (cache entry cleared first) — never exposes the refresh token. */
  remint: () => Promise<string>;
}

export async function resolveRedditClient(
  conn?: AdConnectionRow | null,
  lane?: RedditLane,
): Promise<RedditClient> {
  const effectiveLane: RedditLane = conn?.lane ?? lane ?? "consumer";
  const env = resolveRedditEnvConfig(conn ?? null, effectiveLane);
  const minted = await mintRedditAccessToken(env);
  const client: RedditClient = {
    platform: "reddit",
    accessToken: minted.token,
    scope: minted.scope,
    apiBase: env.apiBase,
    remint: async (): Promise<string> => {
      redditTokenCache.delete(env.refreshTokenEnvVar);
      const fresh = await mintRedditAccessToken(env);
      client.accessToken = fresh.token;
      return fresh.token;
    },
  };
  return client;
}

// ── Rate limits (IETF RateLimit headers — GR-71 / AC-R-20) ────────────────────

export interface RedditRateLimitInfo {
  remaining: number | null;
  resetSeconds: number | null;
}

/**
 * Parses the IETF draft header shape Reddit emits:
 *   RateLimit: "<policy>";r=<remaining>;t=<seconds-to-reset>, "<policy2>";r=…
 * Returns the MINIMUM remaining across policies (the binding budget) and its
 * reset window.
 */
export function parseRedditRateLimitHeader(value: string | null): RedditRateLimitInfo {
  if (!value) return { remaining: null, resetSeconds: null };
  let remaining: number | null = null;
  let resetSeconds: number | null = null;
  for (const segment of value.split(",")) {
    const rMatch = segment.match(/;\s*r=(\d+)/);
    const tMatch = segment.match(/;\s*t=(\d+)/);
    if (!rMatch) continue;
    const r = Number(rMatch[1]);
    if (remaining === null || r < remaining) {
      remaining = r;
      resetSeconds = tMatch ? Number(tMatch[1]) : null;
    }
  }
  return { remaining, resetSeconds };
}

/** Backoff ceiling — never sleep longer than this on a rate-limit signal. */
export const REDDIT_BACKOFF_CAP_MS = 60_000;

type SleepFn = (ms: number) => Promise<void>;
const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let redditSleep: SleepFn = defaultSleep;

/** Test hook — inject a recording sleep; pass null to restore the default. */
export function setRedditSleepForTests(fn: SleepFn | null): void {
  redditSleep = fn ?? defaultSleep;
}

let redditBackoffUntilMs = 0;

/** Test hook — clears the module-scope rate-limit backoff window. */
export function resetRedditBackoffForTests(): void {
  redditBackoffUntilMs = 0;
}

function noteRateLimitHeaders(response: Response): void {
  const info = parseRedditRateLimitHeader(response.headers.get("RateLimit"));
  if (info.remaining === 0) {
    const waitMs = Math.min(
      (info.resetSeconds ?? 5) * 1000,
      REDDIT_BACKOFF_CAP_MS,
    );
    redditBackoffUntilMs = Date.now() + waitMs;
  }
}

// ── Transport (SPEC §1.5 / §7.3) ──────────────────────────────────────────────

/** Verbatim provider message — never regex-parsed, never token-bearing. */
function redditErrorMessage(payload: Record<string, unknown>): string {
  const error = payload.error;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message) return message;
  }
  if (typeof payload.message === "string" && payload.message) return payload.message;
  try {
    const text = JSON.stringify(payload);
    return text === "{}" ? "Reddit Ads API error" : text;
  } catch {
    return "Reddit Ads API error";
  }
}

export type RedditHttpMethod = "GET" | "POST" | "PATCH";

/**
 * The single transport wrapper. Plain HTTP semantics (201 create / 200
 * read+patch — NO batch envelope, §1.5). Create/update bodies are wrapped
 * { data: body } here, in one place.
 *
 * Error envelope (§7.3): 401 → re-mint once then fail-close 424; 429 → honour
 * RateLimit headers, back off to the reset window, retry once, then surface;
 * 5XX → one bounded retry then surface; 400/403/404 → surface verbatim.
 * The descriptive User-Agent rides on EVERY request (GR-71 / AC-R-3).
 */
export async function redditRequest(
  client: RedditClient,
  method: RedditHttpMethod,
  path: string,
  body?: Record<string, unknown>,
  opts: { timeoutMs?: number; query?: Record<string, string> } = {},
): Promise<Record<string, unknown>> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let url = `${client.apiBase}/${path.replace(/^\//, "")}`;
  if (opts.query && Object.keys(opts.query).length > 0) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(opts.query)) qs.set(key, value);
    url += `?${qs.toString()}`;
  }

  let remintedOn401 = false;
  let retriedOn429 = false;
  let retriedOn5xx = false;

  for (;;) {
    // GR-71: respect an open backoff window before sending anything.
    const waitMs = redditBackoffUntilMs - Date.now();
    if (waitMs > 0) await redditSleep(Math.min(waitMs, REDDIT_BACKOFF_CAP_MS));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const init: RequestInit = {
      method,
      signal: controller.signal,
      headers: {
        // Bearer header — never a URL param, so the token can't leak via URLs/logs.
        Authorization: `Bearer ${client.accessToken}`,
        // AC-R-3: the descriptive UA on EVERY outbound request.
        "User-Agent": REDDIT_USER_AGENT,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
    };
    if (body !== undefined) init.body = JSON.stringify({ data: body });

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      clearTimeout(timer);
      const detail = err instanceof Error ? err.message : String(err);
      throw new AdApiError({
        platform: "reddit",
        code: "network_error",
        message: `Reddit Ads request failed: ${detail}`,
      });
    }
    clearTimeout(timer);
    noteRateLimitHeaders(response);

    let payload: Record<string, unknown> = {};
    try {
      payload = await response.json() as Record<string, unknown>;
    } catch {
      payload = {};
    }
    if (response.ok) return payload;

    if (response.status === 401 && !remintedOn401) {
      // §7.3: re-mint once, then fail-close.
      remintedOn401 = true;
      try {
        await client.remint();
        continue;
      } catch {
        throw new AdNotConnectedError("reddit", "reddit_not_connected");
      }
    }
    if (response.status === 401) {
      throw new AdNotConnectedError("reddit", "reddit_not_connected");
    }
    if (response.status === 429 && !retriedOn429) {
      retriedOn429 = true;
      const info = parseRedditRateLimitHeader(response.headers.get("RateLimit"));
      const backoffMs = Math.min((info.resetSeconds ?? 5) * 1000, REDDIT_BACKOFF_CAP_MS);
      redditBackoffUntilMs = Date.now() + backoffMs;
      continue;
    }
    if (response.status >= 500 && !retriedOn5xx) {
      retriedOn5xx = true;
      await redditSleep(2_000);
      continue;
    }

    throw new AdApiError({
      platform: "reddit",
      code: response.status,
      message: redditErrorMessage(payload),
      traceId: response.headers.get("x-request-id"),
    });
  }
}

// ── ID guards ─────────────────────────────────────────────────────────────────

const NUMERIC_ID_REGEX = /^\d+$/;
/** R-1: BOTH prefixes are legal ad-account ids — never assume a2_. */
export const REDDIT_AD_ACCOUNT_ID_REGEX = /^(t2|a2)_.+$/;
export const REDDIT_PROFILE_ID_REGEX = /^t2_.+$/;
export const REDDIT_POST_ID_REGEX = /^t3_.+$/;

function assertRedditNumericId(level: EntityLevel, externalId: string): void {
  if (!NUMERIC_ID_REGEX.test(externalId)) {
    throw new AdApiError({
      platform: "reddit",
      code: "invalid_external_id",
      message: `Reddit ${level} ids are numeric strings; got "${externalId}".`,
    });
  }
}

function assertRedditAccountId(accountId: string): void {
  if (!REDDIT_AD_ACCOUNT_ID_REGEX.test(accountId)) {
    throw new AdApiError({
      platform: "reddit",
      code: "invalid_account_id",
      message:
        `Reddit ad-account ids match ^(t2|a2)_ — both prefixes are legal (R-1); got "${accountId}".`,
    });
  }
}

/** The connection.extra keys the create chain requires (seeded at connect, §1.4). */
export interface RedditConnExtras {
  profileId: string;
  fundingInstrumentId: string;
  pixelId: string;
}

export function redditConnExtras(conn: AdConnectionRow): RedditConnExtras {
  const extra = (conn.extra ?? {}) as Record<string, unknown>;
  const profileId = typeof extra.reddit_profile_id === "string" ? extra.reddit_profile_id : "";
  const fundingInstrumentId = typeof extra.reddit_funding_instrument_id === "string"
    ? extra.reddit_funding_instrument_id
    : "";
  const pixelId = typeof extra.reddit_pixel_id === "string" ? extra.reddit_pixel_id : "";
  if (!REDDIT_PROFILE_ID_REGEX.test(profileId) || !fundingInstrumentId || !pixelId) {
    throw new AdApiError({
      platform: "reddit",
      code: "reddit_connection_incomplete",
      message:
        "The connection is missing reddit_profile_id / reddit_funding_instrument_id / reddit_pixel_id in extra — re-run admin-ad-connect (SPEC §1.3–§1.4) before creating.",
    });
  }
  return { profileId, fundingInstrumentId, pixelId };
}

// ── Targeting (SPEC §4 — allowlist serializer, gate G-4) ──────────────────────

export const REDDIT_TARGETING_ALLOWLIST: readonly string[] = [
  "communities",
  "excluded_communities",
  "geolocations",
  "interests",
  "keywords",
  "excluded_keywords",
  "gender",
  "devices",
  "platforms",
  "locations",
  "view_modes",
  "languages",
];

export const REDDIT_GENDERS = ["FEMALE", "MALE"] as const;
export const REDDIT_LOCATIONS = ["FEED", "COMMENTS_PAGE"] as const;
export const REDDIT_VIEW_MODES = ["ALL", "CARD", "CLASSIC", "COMPACT", "IMMERSIVE"] as const;
export const REDDIT_PLATFORMS = [
  "ALL",
  "DESKTOP",
  "DESKTOP_LEGACY",
  "MOBILE_NATIVE",
  "MOBILE_WEB",
  "MOBILE_WEB_3X",
  "SHREDTOP",
] as const;
/** ISO 639-1, the 21-value enum [SPEC §3.2] — no Nigerian language exists (GR-72). */
export const REDDIT_LANGUAGES = [
  "AR",
  "CS",
  "DA",
  "DE",
  "EL",
  "EN",
  "ES",
  "FI",
  "FR",
  "HU",
  "IT",
  "JA",
  "KO",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SV",
  "VI",
  "ZH",
] as const;

export const REDDIT_TARGETING_CAPS = {
  geolocations: 20_000,
  interests: 200,
  keywords: 1_000,
  excluded_keywords: 2_000,
  devices: 100,
  platforms: 7,
  view_modes: 5,
} as const;

/** §4.2 brand-adjacency default when the admin sets no exclusions. */
export const REDDIT_DEFAULT_EXCLUDED_COMMUNITIES: readonly string[] = ["politics"];
/** §4.2 default: BOTH page surfaces — the conversation placement is deep-intent. */
export const REDDIT_DEFAULT_LOCATIONS: readonly string[] = ["FEED", "COMMENTS_PAGE"];
/** §4.2 default: COMPACT/CLASSIC shrink the 4:5 hero to a thumbnail. */
export const REDDIT_DEFAULT_VIEW_MODES: readonly string[] = ["CARD", "IMMERSIVE"];
export const REDDIT_DEFAULT_LANGUAGES: readonly string[] = ["EN"];

/** Builder copy for age-set multi-channel plans (§4.1 / PIPELINE_BLUEPRINT §1.3b). */
export const REDDIT_NO_AGE_TARGETING_COPY =
  "Reddit can't target by age at all — this campaign will reach adults of any age there. If age matters for this creative, exclude Reddit.";

export interface RedditNormalizedTargeting {
  countries?: unknown;
  age_min?: unknown;
  age_max?: unknown;
  genders?: unknown;
}

export type RedditTargetingResult =
  | { ok: true; targeting: Record<string, unknown>; warnings: string[] }
  | { ok: false; detail: string; message: string };

function stringArray(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) return null;
    out.push(item.trim());
  }
  return out;
}

/**
 * THE Reddit targeting serializer (gate G-4). Output keys are constructed
 * explicitly, one allowlisted key at a time — the passthrough object is NEVER
 * spread, so age_min/age_max/unknown keys are unrepresentable in the output
 * (Reddit's targeting is additionalProperties:false — an unknown key is an
 * outright 400, R-8).
 *
 * Consumes the A3 normalized shape (countries → geolocations; genders →
 * scalar gender) + targeting.passthrough.reddit (communities/keywords/
 * locations/view_modes/… — GR-31: the normalized shape cannot express Reddit).
 */
export function serializeRedditTargeting(input: {
  normalized?: RedditNormalizedTargeting | null;
  passthrough?: Record<string, unknown> | null;
}): RedditTargetingResult {
  const normalized = input.normalized ?? {};
  const passthrough = input.passthrough ?? {};
  const warnings: string[] = [];
  const targeting: Record<string, unknown> = {};

  // Age: NEVER emitted, from anywhere (R-8 / GR-31).
  if (normalized.age_min !== undefined || normalized.age_max !== undefined ||
    (passthrough as Record<string, unknown>).age_min !== undefined ||
    (passthrough as Record<string, unknown>).age_max !== undefined
  ) {
    warnings.push(REDDIT_NO_AGE_TARGETING_COPY);
  }

  // countries → geolocations (≤20,000).
  const countries = stringArray(normalized.countries);
  if (countries === null) {
    return {
      ok: false,
      detail: "targeting_countries_invalid",
      message: "targeting.countries must be an array of non-empty strings.",
    };
  }
  if (countries.length > REDDIT_TARGETING_CAPS.geolocations) {
    return {
      ok: false,
      detail: "targeting_geolocations_over_cap",
      message: `geolocations exceeds the ${REDDIT_TARGETING_CAPS.geolocations} cap [SPEC §3.2].`,
    };
  }
  if (countries.length > 0) targeting.geolocations = countries;

  // genders → scalar gender ∈ {FEMALE, MALE, null} (AC-R-16).
  const genders = normalized.genders;
  if (genders !== undefined && genders !== null) {
    const list = Array.isArray(genders) ? genders : [genders];
    if (list.length === 1 && typeof list[0] === "string") {
      const candidate = list[0].trim().toUpperCase();
      if ((REDDIT_GENDERS as readonly string[]).includes(candidate)) {
        targeting.gender = candidate;
      } else {
        warnings.push(
          `Gender "${String(list[0])}" is not expressible on Reddit (enum FEMALE|MALE|null) — targeting all genders.`,
        );
      }
    } else if (list.length > 1) {
      warnings.push(
        "Reddit's gender field is a single scalar — multiple genders collapse to all genders (null).",
      );
    }
  }

  // Communities: plain subreddit names, leading r/ stripped (AC-R-17).
  const rawCommunities = stringArray(passthrough.communities);
  if (rawCommunities === null) {
    return {
      ok: false,
      detail: "targeting_communities_invalid",
      message: "passthrough.reddit.communities must be an array of non-empty strings.",
    };
  }
  const stripCommunity = (name: string): string => name.replace(/^\/?r\//i, "").trim();
  const communities = rawCommunities.map(stripCommunity).filter((c) => c.length > 0);
  if (communities.length !== rawCommunities.length) {
    return {
      ok: false,
      detail: "targeting_communities_invalid",
      message: "Community names must be non-empty after stripping any r/ prefix.",
    };
  }
  if (communities.length > 0) targeting.communities = communities;

  const rawExcludedCommunities = stringArray(passthrough.excluded_communities);
  if (rawExcludedCommunities === null) {
    return {
      ok: false,
      detail: "targeting_excluded_communities_invalid",
      message: "passthrough.reddit.excluded_communities must be an array of non-empty strings.",
    };
  }
  const excludedCommunities = rawExcludedCommunities.map(stripCommunity).filter((c) =>
    c.length > 0
  );
  // §4.2 default: brand adjacency — admin-editable, applied only when unset.
  targeting.excluded_communities = excludedCommunities.length > 0
    ? excludedCommunities
    : [...REDDIT_DEFAULT_EXCLUDED_COMMUNITIES];

  // Keywords (≤1,000) / excluded keywords (≤2,000).
  const keywords = stringArray(passthrough.keywords);
  if (keywords === null) {
    return {
      ok: false,
      detail: "targeting_keywords_invalid",
      message: "passthrough.reddit.keywords must be an array of non-empty strings.",
    };
  }
  if (keywords.length > REDDIT_TARGETING_CAPS.keywords) {
    return {
      ok: false,
      detail: "targeting_keywords_over_cap",
      message: `keywords exceeds the ${REDDIT_TARGETING_CAPS.keywords} cap [SPEC §3.2].`,
    };
  }
  if (keywords.length > 0) targeting.keywords = keywords;

  const excludedKeywords = stringArray(passthrough.excluded_keywords);
  if (excludedKeywords === null) {
    return {
      ok: false,
      detail: "targeting_excluded_keywords_invalid",
      message: "passthrough.reddit.excluded_keywords must be an array of non-empty strings.",
    };
  }
  if (excludedKeywords.length > REDDIT_TARGETING_CAPS.excluded_keywords) {
    return {
      ok: false,
      detail: "targeting_excluded_keywords_over_cap",
      message:
        `excluded_keywords exceeds the ${REDDIT_TARGETING_CAPS.excluded_keywords} cap [SPEC §3.2].`,
    };
  }
  if (excludedKeywords.length > 0) targeting.excluded_keywords = excludedKeywords;

  // Interests (≤200); excluded_interests is DEPRECATED — warn, never send.
  const interests = stringArray(passthrough.interests);
  if (interests === null) {
    return {
      ok: false,
      detail: "targeting_interests_invalid",
      message: "passthrough.reddit.interests must be an array of non-empty strings.",
    };
  }
  if (interests.length > REDDIT_TARGETING_CAPS.interests) {
    return {
      ok: false,
      detail: "targeting_interests_over_cap",
      message: `interests exceeds the ${REDDIT_TARGETING_CAPS.interests} cap [SPEC §3.2].`,
    };
  }
  if (interests.length > 0) targeting.interests = interests;
  if (passthrough.excluded_interests !== undefined && passthrough.excluded_interests !== null) {
    warnings.push(
      "excluded_interests is deprecated on Reddit — not sent (SPEC §4.2).",
    );
  }

  // Devices (≤100; iOS min_version ≥ 14).
  if (passthrough.devices !== undefined && passthrough.devices !== null) {
    if (!Array.isArray(passthrough.devices)) {
      return {
        ok: false,
        detail: "targeting_devices_invalid",
        message: "passthrough.reddit.devices must be an array.",
      };
    }
    const devices = passthrough.devices as Record<string, unknown>[];
    if (devices.length > REDDIT_TARGETING_CAPS.devices) {
      return {
        ok: false,
        detail: "targeting_devices_over_cap",
        message: `devices exceeds the ${REDDIT_TARGETING_CAPS.devices} cap [SPEC §3.2].`,
      };
    }
    for (const device of devices) {
      const os = typeof device.os === "string" ? device.os.toUpperCase() : null;
      const minVersion = device.min_version;
      if (os === "IOS" && minVersion !== undefined && minVersion !== null) {
        const numeric = Number(minVersion);
        if (!Number.isNaN(numeric) && numeric < 14) {
          return {
            ok: false,
            detail: "targeting_device_ios_min_version",
            message: "iOS device targeting requires min_version ≥ 14 [SPEC §3.2].",
          };
        }
      }
    }
    if (devices.length > 0) targeting.devices = devices;
  }

  // Platforms (≤7; DESKTOP_LEGACY deprecated — strip + warn).
  const rawPlatforms = stringArray(passthrough.platforms);
  if (rawPlatforms === null) {
    return {
      ok: false,
      detail: "targeting_platforms_invalid",
      message: "passthrough.reddit.platforms must be an array of non-empty strings.",
    };
  }
  if (rawPlatforms.length > REDDIT_TARGETING_CAPS.platforms) {
    return {
      ok: false,
      detail: "targeting_platforms_over_cap",
      message: `platforms exceeds the ${REDDIT_TARGETING_CAPS.platforms} cap [SPEC §3.2].`,
    };
  }
  const platforms = rawPlatforms.map((p) => p.toUpperCase());
  const unknownPlatform = platforms.find(
    (p) => !(REDDIT_PLATFORMS as readonly string[]).includes(p),
  );
  if (unknownPlatform) {
    return {
      ok: false,
      detail: "targeting_platform_invalid",
      message: `platform "${unknownPlatform}" is not in Reddit's enum [SPEC §3.2].`,
    };
  }
  const keptPlatforms = platforms.filter((p) => p !== "DESKTOP_LEGACY");
  if (keptPlatforms.length !== platforms.length) {
    warnings.push("DESKTOP_LEGACY is deprecated/unsupported — stripped (SPEC §4.2).");
  }
  if (keptPlatforms.length > 0) targeting.platforms = keptPlatforms;

  // Locations (page placement) — default BOTH surfaces; enum-checked.
  const rawLocations = stringArray(passthrough.locations);
  if (rawLocations === null) {
    return {
      ok: false,
      detail: "targeting_locations_invalid",
      message: "passthrough.reddit.locations must be an array of non-empty strings.",
    };
  }
  const locations = rawLocations.map((l) => l.toUpperCase());
  const unknownLocation = locations.find(
    (l) => !(REDDIT_LOCATIONS as readonly string[]).includes(l),
  );
  if (unknownLocation) {
    return {
      ok: false,
      detail: "targeting_location_invalid",
      message:
        `location "${unknownLocation}" is invalid — enum FEED|COMMENTS_PAGE (there is NO COMMUNITY placement: communities are WHO, locations are WHERE on the page — they compose; SPEC §4.2).`,
    };
  }
  targeting.locations = locations.length > 0 ? locations : [...REDDIT_DEFAULT_LOCATIONS];

  // View modes (≤5) — default CARD+IMMERSIVE; COMPACT/CLASSIC warn.
  const rawViewModes = stringArray(passthrough.view_modes);
  if (rawViewModes === null) {
    return {
      ok: false,
      detail: "targeting_view_modes_invalid",
      message: "passthrough.reddit.view_modes must be an array of non-empty strings.",
    };
  }
  if (rawViewModes.length > REDDIT_TARGETING_CAPS.view_modes) {
    return {
      ok: false,
      detail: "targeting_view_modes_over_cap",
      message: `view_modes exceeds the ${REDDIT_TARGETING_CAPS.view_modes} cap [SPEC §3.2].`,
    };
  }
  const viewModes = rawViewModes.map((v) => v.toUpperCase());
  const unknownViewMode = viewModes.find(
    (v) => !(REDDIT_VIEW_MODES as readonly string[]).includes(v),
  );
  if (unknownViewMode) {
    return {
      ok: false,
      detail: "targeting_view_mode_invalid",
      message: `view_mode "${unknownViewMode}" is not in Reddit's enum [SPEC §3.2].`,
    };
  }
  if (viewModes.some((v) => v === "COMPACT" || v === "CLASSIC")) {
    warnings.push(
      "COMPACT/CLASSIC view modes shrink a 4:5 hero image to a thumbnail — consider CARD + IMMERSIVE (SPEC §4.2).",
    );
  }
  targeting.view_modes = viewModes.length > 0 ? viewModes : [...REDDIT_DEFAULT_VIEW_MODES];

  // Languages — 21-value ISO 639-1 enum; default EN.
  const rawLanguages = stringArray(passthrough.languages);
  if (rawLanguages === null) {
    return {
      ok: false,
      detail: "targeting_languages_invalid",
      message: "passthrough.reddit.languages must be an array of non-empty strings.",
    };
  }
  const languages = rawLanguages.map((l) => l.toUpperCase());
  const unknownLanguage = languages.find(
    (l) => !(REDDIT_LANGUAGES as readonly string[]).includes(l),
  );
  if (unknownLanguage) {
    return {
      ok: false,
      detail: "targeting_language_invalid",
      message:
        `language "${unknownLanguage}" is not in Reddit's 21-value ISO 639-1 enum — note there is no Nigerian language (GR-72).`,
    };
  }
  targeting.languages = languages.length > 0 ? languages : [...REDDIT_DEFAULT_LANGUAGES];

  // Defense-in-depth: the output must be a subset of the allowlist (G-4).
  for (const key of Object.keys(targeting)) {
    if (!REDDIT_TARGETING_ALLOWLIST.includes(key)) delete targeting[key];
  }

  return { ok: true, targeting, warnings };
}

// ── Community picker backend (SPEC §4.4 / AC-R-20 / R-P6) ─────────────────────

/** ads-targeting-taxonomy is the tightest pool (100 req/60 s) — cache HARD. */
export const REDDIT_COMMUNITY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CommunityCacheEntry {
  at: number;
  payload: Record<string, unknown>;
}

const communitySearchCache = new Map<string, CommunityCacheEntry>();

export function resetRedditCommunityCacheForTests(): void {
  communitySearchCache.clear();
}

/**
 * Community search — **the param is `query=`, NOT `q=`**: `q=` silently
 * no-ops and returns the popular list (proven live, R-P6; gate G-4).
 * Served from a ≥24 h module-scope cache on repeat queries (GR-71).
 */
export async function redditSearchCommunities(
  client: RedditClient,
  query: string,
): Promise<{ payload: Record<string, unknown>; fromCache: boolean }> {
  const key = query.trim().toLowerCase();
  const cached = communitySearchCache.get(key);
  if (cached && Date.now() - cached.at < REDDIT_COMMUNITY_CACHE_TTL_MS) {
    return { payload: cached.payload, fromCache: true };
  }
  const payload = await redditRequest(client, "GET", "/targeting/communities/search", undefined, {
    query: { query: query.trim() },
  });
  communitySearchCache.set(key, { at: Date.now(), payload });
  return { payload, fromCache: false };
}

// ── Pre-create validation calls (SPEC §4.3 / AC-R-19) ─────────────────────────

function collectInvalidEntries(payload: Record<string, unknown>): unknown[] {
  const data = payload.data;
  const rows: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === "object"
    ? Object.values(data as Record<string, unknown>).filter(Array.isArray).flat()
    : [];
  return rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const record = row as Record<string, unknown>;
    return record.is_valid === false || record.valid === false;
  });
}

/** Batched keyword validation — one call per create (100 req/60 s pool). */
export async function redditValidateKeywords(
  client: RedditClient,
  keywords: string[],
): Promise<void> {
  if (keywords.length === 0) return;
  const payload = await redditRequest(client, "POST", "/targeting/keyword_validations", {
    keywords,
  });
  const invalid = collectInvalidEntries(payload);
  if (invalid.length > 0) {
    throw new AdApiError({
      platform: "reddit",
      code: "keywords_invalid",
      // Provider verdict passed through verbatim — never regex-parsed.
      message: `Reddit rejected keyword(s): ${JSON.stringify(invalid)}`,
    });
  }
}

/** Batched geolocation validation — one call per create (100 req/60 s pool). */
export async function redditValidateGeolocations(
  client: RedditClient,
  geolocations: string[],
): Promise<void> {
  if (geolocations.length === 0) return;
  const payload = await redditRequest(client, "POST", "/targeting/geolocations_validations", {
    geolocations,
  });
  const invalid = collectInvalidEntries(payload);
  if (invalid.length > 0) {
    throw new AdApiError({
      platform: "reddit",
      code: "geolocations_invalid",
      message: `Reddit rejected geolocation(s): ${JSON.stringify(invalid)}`,
    });
  }
}

// ── Copy validation (SPEC §5.2 — ours; Reddit will not do it for us) ──────────

export const REDDIT_HEADLINE_HARD_MAX = 300;
export const REDDIT_HEADLINE_WARN_AD_READ = 100;
export const REDDIT_HEADLINE_WARN_MOBILE = 80;
export const REDDIT_CAPTION_MAX = 180;
export const REDDIT_BODY_MAX = 40_000;
export const REDDIT_NAME_MIN = 3;
export const REDDIT_NAME_MAX = 500;
export const REDDIT_CLICK_URL_MAX = 5_000;
export const REDDIT_CLICK_URL_QUERY_PARAMS_MAX = 14;
export const REDDIT_SUPPLEMENTARY_TEXT_WARN = 100;

/**
 * CAPITALIZATION is a literal rejection reason [SPEC §6.2]. Operationalized
 * as: the whole text is ALL-CAPS, or it contains a run of ≥3 consecutive
 * shouted words — a single acronym/venue name ("NYC", "LOFT") warns but does
 * not block.
 */
export function redditCapsVerdict(text: string): "block" | "warn" | "ok" {
  const words = text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length === 0) return "ok";
  const isCapsWord = (w: string): boolean => {
    const letters = w.replace(/[^A-Za-z]/g, "");
    return letters.length >= 2 && letters === letters.toUpperCase();
  };
  if (words.every(isCapsWord)) return "block";
  let run = 0;
  for (const word of words) {
    run = isCapsWord(word) ? run + 1 : 0;
    if (run >= 3) return "block";
  }
  const shouted = words.some((w) => {
    const letters = w.replace(/[^A-Za-z]/g, "");
    return letters.length >= 4 && letters === letters.toUpperCase();
  });
  return shouted ? "warn" : "ok";
}

export interface RedditCopyIssue {
  rule: string;
  message: string;
}

export interface RedditCopyValidationResult {
  ok: boolean;
  blocks: RedditCopyIssue[];
  warnings: RedditCopyIssue[];
}

export function validateRedditCopy(input: {
  headline?: string | null;
  body?: string | null;
  caption?: string | null;
  name?: string | null;
  clickUrl?: string | null;
  queryParamCount?: number | null;
  supplementaryText?: string | null;
}): RedditCopyValidationResult {
  const blocks: RedditCopyIssue[] = [];
  const warnings: RedditCopyIssue[] = [];

  const headline = input.headline ?? null;
  if (headline !== null) {
    if (headline.length > REDDIT_HEADLINE_HARD_MAX) {
      blocks.push({
        rule: "headline_over_300",
        message:
          `Headline is ${headline.length} chars — over the ~${REDDIT_HEADLINE_HARD_MAX} policy limit; Reddit accepts the create (201) then rejects it hours later with EXCEEDING_CHARACTERS (GR-28).`,
      });
    } else if (headline.length > REDDIT_HEADLINE_WARN_AD_READ) {
      warnings.push({
        rule: "headline_over_100",
        message:
          `Headline is ${headline.length} chars — starts reading like an ad, and Reddit punishes that.`,
      });
    } else if (headline.length > REDDIT_HEADLINE_WARN_MOBILE) {
      warnings.push({
        rule: "headline_over_80",
        message: `Headline is ${headline.length} chars — it will truncate on mobile.`,
      });
    }
    const capsVerdict = redditCapsVerdict(headline);
    if (capsVerdict === "block") {
      blocks.push({
        rule: "headline_all_caps",
        message:
          "ALL-CAPS copy is a literal Reddit rejection reason (CAPITALIZATION) — rewrite in sentence case.",
      });
    } else if (capsVerdict === "warn") {
      warnings.push({
        rule: "headline_partial_caps",
        message:
          "A shouted ALL-CAPS word in the headline risks Reddit's CAPITALIZATION rejection — prefer sentence case.",
      });
    }
  }

  const body = input.body ?? null;
  if (body !== null) {
    if (body.length > REDDIT_BODY_MAX) {
      blocks.push({
        rule: "body_over_40000",
        message: `body is ${body.length} chars — over the ${REDDIT_BODY_MAX} schema limit [SPEC].`,
      });
    }
    if (redditCapsVerdict(body) === "block") {
      blocks.push({
        rule: "body_all_caps",
        message:
          "ALL-CAPS copy is a literal Reddit rejection reason (CAPITALIZATION) — rewrite in sentence case.",
      });
    }
  }

  const caption = input.caption ?? null;
  if (caption !== null && caption.length > REDDIT_CAPTION_MAX) {
    blocks.push({
      rule: "caption_over_180",
      message:
        `Carousel caption is ${caption.length} chars — over the ${REDDIT_CAPTION_MAX} schema limit [SPEC].`,
    });
  }

  const name = input.name ?? null;
  if (name !== null && (name.length < REDDIT_NAME_MIN || name.length > REDDIT_NAME_MAX)) {
    blocks.push({
      rule: "name_out_of_range",
      message:
        `Entity name must be ${REDDIT_NAME_MIN}–${REDDIT_NAME_MAX} chars [SPEC]; got ${name.length}.`,
    });
  }

  const clickUrl = input.clickUrl ?? null;
  if (clickUrl !== null && clickUrl.length > REDDIT_CLICK_URL_MAX) {
    blocks.push({
      rule: "click_url_over_5000",
      message: `click_url is ${clickUrl.length} chars — over the ${REDDIT_CLICK_URL_MAX} limit [SPEC].`,
    });
  }

  const paramCount = input.queryParamCount ?? null;
  if (paramCount !== null && paramCount > REDDIT_CLICK_URL_QUERY_PARAMS_MAX) {
    blocks.push({
      rule: "query_params_over_14",
      message:
        `click_url_query_parameters has ${paramCount} entries — over the ${REDDIT_CLICK_URL_QUERY_PARAMS_MAX} cap [SPEC].`,
    });
  }

  const supplementary = input.supplementaryText ?? null;
  if (supplementary !== null && supplementary.length > REDDIT_SUPPLEMENTARY_TEXT_WARN) {
    warnings.push({
      rule: "supplementary_over_100",
      message:
        `supplementary_text is ${supplementary.length} chars — keep it ≤${REDDIT_SUPPLEMENTARY_TEXT_WARN} for display [GUIDE].`,
    });
  }

  return { ok: blocks.length === 0, blocks, warnings };
}

// ── Destination policy (SPEC §5.4 — D-P1 / GR-32 / AC-R-24) ───────────────────

/**
 * The ad-visible destination is the canonical usemingla.com page — NEVER a
 * OneLink. AppsFlyer serves crawlers an app-install interstitial (proven,
 * D-P1) which is exactly Reddit's BRIDGE_PAGE rejection.
 */
export function isRedditBlockedDestinationHost(host: string): boolean {
  const lower = host.toLowerCase();
  return lower === "go.usemingla.com" || lower === "onelink.me" || lower.endsWith(".onelink.me");
}

export function validateRedditDestinationPolicy(
  destinationUrl: string,
  displayUrl?: string | null,
): RedditValidation {
  let parsed: URL;
  try {
    parsed = new URL(destinationUrl);
  } catch {
    return {
      ok: false,
      detail: "destination_url_invalid",
      message: `destination url "${destinationUrl}" is not a valid URL.`,
    };
  }
  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      detail: "destination_url_not_https",
      message: "Reddit ad destinations must be https canonical pages.",
    };
  }
  if (isRedditBlockedDestinationHost(parsed.hostname)) {
    return {
      ok: false,
      detail: "destination_bridge_page",
      message:
        "A OneLink (go.usemingla.com / *.onelink.me) can never be a Reddit destination — AppsFlyer serves crawlers an app-install interstitial, which is exactly Reddit's BRIDGE_PAGE rejection (D-P1). Point Reddit at the canonical usemingla.com page.",
    };
  }
  if (displayUrl !== undefined && displayUrl !== null && displayUrl.trim() !== "") {
    const displayDomain = displayUrl
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    const host = parsed.hostname.toLowerCase();
    const matches = displayDomain === host || host.endsWith(`.${displayDomain}`);
    if (!matches) {
      return {
        ok: false,
        detail: "display_url_domain_mismatch",
        message:
          `display_url "${displayUrl}" must match the destination domain "${parsed.hostname}" — DISPLAY_URL is a literal Reddit rejection reason [SPEC §5.4].`,
      };
    }
  }
  return { ok: true };
}

// ── Campaign builder (SPEC §3.1 — gate G-1) ───────────────────────────────────

export interface RedditCampaignBuildInput {
  name: string;
  /** Engine objective — normalized via normalizeRedditObjective. */
  objective: string;
  fundingInstrumentId: string;
  isCbo: boolean;
  /** CBO only — minor units (cents); converted via toMicro at this boundary. */
  goalType?: "DAILY_SPEND" | "LIFETIME_SPEND" | null;
  goalValueCents?: number | null;
  bidStrategy?: string | null;
  bidType?: string | null;
  /** Minor units (cents); band-checked in micro AFTER conversion. */
  bidValueCents?: number | null;
  spendCapCents?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  /** UNCONDITIONAL on CBO campaigns (GR-12); value = extra.reddit_pixel_id. */
  conversionPixelId: string;
}

/**
 * CBO cross-field rules — enforced pre-flight as 422s BEFORE any provider
 * call [SPEC §3.1 / reddit.md §7.2 / GR-59 / AC-R-9].
 */
export function validateRedditCampaignRules(input: RedditCampaignBuildInput): RedditValidation {
  if (input.name.length < REDDIT_NAME_MIN || input.name.length > REDDIT_NAME_MAX) {
    return {
      ok: false,
      detail: "name_out_of_range",
      message: `Campaign name must be ${REDDIT_NAME_MIN}–${REDDIT_NAME_MAX} chars [SPEC].`,
    };
  }
  const objective = normalizeRedditObjective(input.objective);
  if (!objective.ok) return objective;
  if (!input.fundingInstrumentId) {
    return {
      ok: false,
      detail: "funding_instrument_required",
      message:
        "funding_instrument_id is attached explicitly on every campaign create (SPEC §3.1) — re-run admin-ad-connect to capture it.",
    };
  }
  if (input.isCbo) {
    if (REDDIT_CBO_INELIGIBLE_OBJECTIVES.includes(objective.objective)) {
      return {
        ok: false,
        detail: "cbo_objective_ineligible",
        message:
          `${objective.objective} cannot use campaign budget optimization — CBO is only eligible for IMPRESSIONS/CLICKS/VIDEO_VIEWABLE_IMPRESSIONS [SPEC §3.1].`,
      };
    }
    if (!input.bidStrategy || !input.bidType || !input.startTime) {
      return {
        ok: false,
        detail: "cbo_requires_bid_and_start",
        message:
          "CBO=true requires bid_strategy, bid_type AND start_time on the campaign [SPEC §3.1].",
      };
    }
    if (!input.conversionPixelId) {
      return {
        ok: false,
        detail: "cbo_requires_pixel",
        message:
          "CBO=true requires conversion_pixel_id on the campaign (mandatory since 2026-07-13 — GR-12).",
      };
    }
  }
  if (input.goalType === "LIFETIME_SPEND" && !input.endTime) {
    return {
      ok: false,
      detail: "lifetime_spend_requires_end_time",
      message: "goal_type=LIFETIME_SPEND requires a non-null end_time [SPEC §3.1].",
    };
  }
  if (
    input.spendCapCents !== undefined && input.spendCapCents !== null &&
    input.isCbo && input.goalType !== "DAILY_SPEND"
  ) {
    return {
      ok: false,
      detail: "spend_cap_not_allowed",
      message:
        "spend_cap is only available for non-CBO campaigns, or CBO with goal_type=DAILY_SPEND [SPEC §3.1].",
    };
  }
  if (input.bidValueCents !== undefined && input.bidValueCents !== null) {
    const band = validateRedditCpcBidMicro(toMicro(input.bidValueCents));
    if (!band.ok) return band;
  }
  return { ok: true };
}

/**
 * buildRedditCampaignBody — one of the ONLY three places a create POST body
 * may be constructed (gate G-1). configured_status is EXPLICIT, ALWAYS:
 * Reddit's schema default is ACTIVE = live spend on a forgotten field (GR-11).
 */
export function buildRedditCampaignBody(
  input: RedditCampaignBuildInput,
): Record<string, unknown> {
  const objective = normalizeRedditObjective(input.objective);
  if (!objective.ok) {
    throw new AdApiError({
      platform: "reddit",
      code: objective.detail,
      message: objective.message,
    });
  }
  const rules = validateRedditCampaignRules(input);
  if (!rules.ok) {
    throw new AdApiError({ platform: "reddit", code: rules.detail, message: rules.message });
  }
  const body: Record<string, unknown> = {
    name: input.name,
    objective: objective.objective,
    // EXPLICIT. ALWAYS. Schema default is ACTIVE = live spend (GR-11 / G-1).
    configured_status: "PAUSED",
    funding_instrument_id: input.fundingInstrumentId,
    is_campaign_budget_optimization: input.isCbo,
  };
  if (input.isCbo) {
    body.goal_type = input.goalType ?? "DAILY_SPEND";
    if (input.goalValueCents !== undefined && input.goalValueCents !== null) {
      body.goal_value = toMicro(input.goalValueCents);
    }
    body.bid_strategy = input.bidStrategy;
    body.bid_type = input.bidType;
    if (input.bidValueCents !== undefined && input.bidValueCents !== null) {
      body.bid_value = toMicro(input.bidValueCents);
    }
    body.start_time = input.startTime;
    if (input.endTime) body.end_time = input.endTime;
    // GR-12: UNCONDITIONAL on every CBO-campaign create (required 2026-07-13+).
    body.conversion_pixel_id = input.conversionPixelId;
  }
  if (input.spendCapCents !== undefined && input.spendCapCents !== null) {
    body.spend_cap = toMicro(input.spendCapCents);
  }
  return body;
}

// ── Ad-group builder (SPEC §3.2 — gates G-1/G-3/G-4) ──────────────────────────

export interface RedditScheduleWindow {
  start_day: number;
  end_day: number;
  start_hour: number;
  end_hour: number;
}

export function validateRedditSchedule(schedule: RedditScheduleWindow[]): RedditValidation {
  for (const window of schedule) {
    const days = [window.start_day, window.end_day];
    const hours = [window.start_hour, window.end_hour];
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return {
        ok: false,
        detail: "schedule_day_invalid",
        message: "schedule days are 0=Sunday … 6=Saturday [SPEC §3.2].",
      };
    }
    if (hours.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) {
      return {
        ok: false,
        detail: "schedule_hour_invalid",
        message: "schedule hours must be integers 0–23 [SPEC §3.2].",
      };
    }
  }
  return { ok: true };
}

export interface RedditAdGroupBuildInput {
  campaignExternalId: string;
  name: string;
  /** Minor units (cents) → goal_value micro via toMicro. NO floor check (GR-59). */
  budgetCents: number;
  /** UNCONDITIONAL (GR-12): required on EVERY ad group since 2026-07-13. */
  conversionPixelId: string;
  bidStrategy?: string | null;
  bidType?: string | null;
  /** Minor units (cents); manual path ⇒ MANUAL_BIDDING + micro band check. */
  bidValueCents?: number | null;
  optimizationGoal?: string | null;
  startTime: string;
  endTime?: string | null;
  /** Serialized output of serializeRedditTargeting — allowlisted keys only. */
  targeting: Record<string, unknown>;
  schedule?: RedditScheduleWindow[] | null;
  /** Cross-level rule: campaign bid_value set ⇒ ad-group bid_value must be null. */
  campaignHasBidValue?: boolean;
}

/**
 * buildRedditAdGroupBody — one of the ONLY three places a create POST body may
 * be constructed (gate G-1). configured_status PAUSED explicit;
 * conversion_pixel_id injected UNCONDITIONALLY — there is no code path that
 * builds an ad-group body without it (AC-R-8).
 */
export function buildRedditAdGroupBody(
  input: RedditAdGroupBuildInput,
): Record<string, unknown> {
  if (input.name.length < REDDIT_NAME_MIN || input.name.length > REDDIT_NAME_MAX) {
    throw new AdApiError({
      platform: "reddit",
      code: "name_out_of_range",
      message: `Ad-group name must be ${REDDIT_NAME_MIN}–${REDDIT_NAME_MAX} chars [SPEC].`,
    });
  }
  if (!input.conversionPixelId) {
    throw new AdApiError({
      platform: "reddit",
      code: "pixel_required",
      message:
        "conversion_pixel_id is required on EVERY ad group since 2026-07-13 (GR-12) — re-run admin-ad-connect to capture extra.reddit_pixel_id.",
    });
  }
  const optimizationGoal = input.optimizationGoal ?? "CLICKS";
  if (!(REDDIT_OPTIMIZATION_GOAL_ENUM as readonly string[]).includes(optimizationGoal)) {
    throw new AdApiError({
      platform: "reddit",
      code: "invalid_optimization_goal",
      message:
        `optimization_goal "${optimizationGoal}" is not in Reddit's 28-value enum [SPEC §3.3]; CLICKS is the pixel-independent safe default.`,
    });
  }
  let bidStrategy = input.bidStrategy ?? "MAXIMIZE_VOLUME";
  let bidValueMicro: number | null = null;
  if (input.bidValueCents !== undefined && input.bidValueCents !== null) {
    if (input.campaignHasBidValue) {
      throw new AdApiError({
        platform: "reddit",
        code: "bid_value_conflict",
        message:
          "A campaign-level bid_value forbids an ad-group bid_value [SPEC §3.1] — set exactly one.",
      });
    }
    // The manual path: MANUAL_BIDDING + a micro value inside the ONLY hard band.
    bidStrategy = "MANUAL_BIDDING";
    bidValueMicro = toMicro(input.bidValueCents);
    const band = validateRedditCpcBidMicro(bidValueMicro);
    if (!band.ok) {
      throw new AdApiError({ platform: "reddit", code: band.detail, message: band.message });
    }
  }
  if (input.schedule && input.schedule.length > 0) {
    const scheduleCheck = validateRedditSchedule(input.schedule);
    if (!scheduleCheck.ok) {
      throw new AdApiError({
        platform: "reddit",
        code: scheduleCheck.detail,
        message: scheduleCheck.message,
      });
    }
  }
  const body: Record<string, unknown> = {
    campaign_id: input.campaignExternalId,
    name: input.name,
    // EXPLICIT. ALWAYS (GR-11 / G-1).
    configured_status: "PAUSED",
    // GR-12: UNCONDITIONAL — required on EVERY ad group since 2026-07-13.
    // On Reddit the pixel id IS the ad-account id (R-P3).
    conversion_pixel_id: input.conversionPixelId,
    bid_strategy: bidStrategy,
    bid_type: input.bidType ?? "CPC",
    bid_value: bidValueMicro,
    goal_type: "DAILY_SPEND",
    // toMicro(budget_cents) — deliberately NO floor check of ours (GR-59/G-3):
    // Reddit's schema says minimum 0; a low-budget 400 is surfaced verbatim.
    goal_value: toMicro(input.budgetCents),
    optimization_goal: optimizationGoal,
    start_time: input.startTime,
    end_time: input.endTime ?? null,
    targeting: input.targeting,
  };
  if (input.schedule && input.schedule.length > 0) body.schedule = input.schedule;
  return body;
}

// ── Creative — the structured-post sub-pipeline (SPEC §3.4 / AC-R-11) ─────────

export type RedditCreativeType = "IMAGE" | "VIDEO" | "CAROUSEL";

export interface RedditCarouselCard {
  imageUrl: string;
  caption?: string | null;
}

export interface RedditCreativeBuildInput {
  type: RedditCreativeType;
  headline: string;
  destinationUrl: string;
  /** Defaults to the destination hostname; MUST match it [SPEC §5.4]. */
  displayUrl?: string | null;
  /** One of the 24 Title-Case display strings — verbatim (G-2). */
  callToAction?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  /** REQUIRED for VIDEO [SPEC §4.2 / AC-R-25]. */
  thumbnailUrl?: string | null;
  /** 1–6 cards [SPEC — the guide's 2–7 conflicts; trust the schema, R-10]. */
  carousel?: RedditCarouselCard[] | null;
  /** Default ON — comments are the format's advantage [reddit.md §8.6]. */
  allowComments?: boolean;
  /** Redditor Highlights — default OPT_IN [reddit.md §8.7]. */
  ugcEnrollStatus?: "OPT_IN" | "OPT_OUT";
  supplementaryText?: string | null;
  /**
   * [3P] media hints (bytes) — WARN-only, never a block (GR-22): every
   * pixel/byte/duration number is third-party and self-contradictory.
   */
  imageBytes?: number | null;
}

/** [3P] — warn threshold only. Hard-blocks come exclusively from [SPEC] rows. */
export const REDDIT_IMAGE_BYTES_WARN = 3 * 1024 * 1024;
export const REDDIT_CAROUSEL_MIN_CARDS = 1;
export const REDDIT_CAROUSEL_MAX_CARDS = 6;

export type RedditCreativeValidation =
  | { ok: true; warnings: string[] }
  | { ok: false; detail: string; message: string };

export function validateRedditCreative(
  input: RedditCreativeBuildInput,
): RedditCreativeValidation {
  const warnings: string[] = [];
  const copy = validateRedditCopy({
    headline: input.headline,
    supplementaryText: input.supplementaryText ?? null,
  });
  if (!copy.ok) {
    const first = copy.blocks[0];
    return { ok: false, detail: first.rule, message: first.message };
  }
  warnings.push(...copy.warnings.map((w) => w.message));

  const destination = validateRedditDestinationPolicy(
    input.destinationUrl,
    input.displayUrl ?? null,
  );
  if (!destination.ok) return destination;

  const cta = input.callToAction ?? null;
  if (cta !== null) {
    const ctaCheck = validateRedditCta(cta);
    if (!ctaCheck.ok) return ctaCheck;
  }

  if (input.type === "IMAGE" && !input.imageUrl) {
    return {
      ok: false,
      detail: "image_url_required",
      message: "IMAGE creatives require image.media.url [SPEC §4.2].",
    };
  }
  if (input.type === "VIDEO") {
    if (!input.videoUrl) {
      return {
        ok: false,
        detail: "video_url_required",
        message: "VIDEO creatives require video.media.url [SPEC §4.2].",
      };
    }
    if (!input.thumbnailUrl) {
      return {
        ok: false,
        detail: "video_thumbnail_required",
        message: "VIDEO creatives REQUIRE a thumbnail [SPEC §4.2 / AC-R-25].",
      };
    }
  }
  if (input.type === "CAROUSEL") {
    const cards = input.carousel ?? [];
    if (
      cards.length < REDDIT_CAROUSEL_MIN_CARDS || cards.length > REDDIT_CAROUSEL_MAX_CARDS
    ) {
      return {
        ok: false,
        detail: "carousel_card_count",
        message:
          `Carousel needs ${REDDIT_CAROUSEL_MIN_CARDS}–${REDDIT_CAROUSEL_MAX_CARDS} cards [SPEC — the guide's "2–7" conflicts with the schema; the schema wins (R-10)]; got ${cards.length}.`,
      };
    }
    for (const card of cards) {
      if (!card.imageUrl) {
        return {
          ok: false,
          detail: "carousel_card_image_required",
          message: "Every carousel card needs an image URL [SPEC §4.2].",
        };
      }
      if (card.caption !== undefined && card.caption !== null) {
        const captionCheck = validateRedditCopy({ caption: card.caption });
        if (!captionCheck.ok) {
          const first = captionCheck.blocks[0];
          return { ok: false, detail: first.rule, message: first.message };
        }
      }
    }
  }

  // [3P] numbers are WARN-only (GR-22) — validating on wrong constants is
  // worse than not validating.
  if (
    typeof input.imageBytes === "number" && input.imageBytes > REDDIT_IMAGE_BYTES_WARN
  ) {
    warnings.push(
      "Image exceeds ~3 MB — a third-party (unverified) limit; Reddit's own verdict arrives asynchronously as INVALID_MEDIA prose (GR-22).",
    );
  }

  return { ok: true, warnings };
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The inner `data` for POST /profiles/{id}/structured_posts/jobs [SPEC §3.4]. */
export function buildRedditStructuredPostJobBody(
  input: RedditCreativeBuildInput,
): Record<string, unknown> {
  const validation = validateRedditCreative(input);
  if (!validation.ok) {
    throw new AdApiError({
      platform: "reddit",
      code: validation.detail,
      message: validation.message,
    });
  }
  const destination: Record<string, unknown> = {
    url: input.destinationUrl,
    display_url: input.displayUrl ?? hostnameOf(input.destinationUrl),
    type: "URL",
  };
  if (input.callToAction !== undefined && input.callToAction !== null) {
    // Title-Case VERBATIM — never uppercased or snake-cased (GR-29 / G-2).
    destination.call_to_action = input.callToAction;
  }
  const creative: Record<string, unknown> = {
    type: input.type,
    headline: input.headline,
    destination,
    enhancements: {
      user_generated_content: { enroll_status: input.ugcEnrollStatus ?? "OPT_IN" },
    },
  };
  if (input.supplementaryText) creative.supplementary_text = input.supplementaryText;
  if (input.type === "IMAGE") {
    creative.image = { media: { url: input.imageUrl, type: "URL" } };
  } else if (input.type === "VIDEO") {
    creative.video = { media: { url: input.videoUrl, type: "URL" } };
    creative.thumbnail = { media: { url: input.thumbnailUrl, type: "URL" } };
  } else {
    creative.carousel = (input.carousel ?? []).map((card) => {
      const item: Record<string, unknown> = {
        image: { media: { url: card.imageUrl, type: "URL" } },
      };
      if (card.caption !== undefined && card.caption !== null) item.caption = card.caption;
      return item;
    });
  }
  return {
    // Default ON — the comment section is the format's advantage (§3.4).
    allow_comments: input.allowComments ?? true,
    creative,
  };
}

/** Extracts the t3_ post id from a SUCCESS job payload — fail-close, never guessed. */
export function extractRedditPostId(payload: Record<string, unknown>): string | null {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const candidates: unknown[] = [
    data.post_id,
    (data.post as Record<string, unknown> | undefined)?.id,
    (data.structured_post as Record<string, unknown> | undefined)?.id,
    data.structured_post_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && REDDIT_POST_ID_REGEX.test(candidate)) return candidate;
  }
  return null;
}

/** Admin copy for the terminal, user-facing INVALID_MEDIA verdict (GR-22). */
export function formatRedditInvalidMediaMessage(providerMessage: string): string {
  return `Reddit checks images after upload and only tells us in plain English. Here's exactly what Reddit said: '${providerMessage}'.`;
}

export const REDDIT_JOB_POLL_INITIAL_MS = 2_000;
export const REDDIT_JOB_POLL_CAP_MS = 30_000;
export const REDDIT_JOB_DEADLINE_MS = 300_000;
/** 1 initial submission + 2 SERVER_ERROR resubmissions (NEW jobs, same config). */
export const REDDIT_JOB_MAX_SUBMISSIONS = 3;

/**
 * The structured-post job runner (SPEC §3.4 / AC-R-11):
 *   submit job → bounded-backoff poll (2s→4s→8s→… cap 30s; overall 5-min
 *   deadline) → SUCCESS returns the t3_ id.
 *   CLIENT_ERROR: the creative CONFIG is wrong — fail with the provider
 *   message verbatim; the same job is NEVER re-submitted (a retry means a NEW
 *   job with a FIXED config, which is the caller's decision).
 *   SERVER_ERROR: Reddit-side fault — bounded retries submitting a NEW job
 *   with the SAME config, then fail.
 */
export async function redditRunStructuredPostJob(
  client: RedditClient,
  profileId: string,
  jobData: Record<string, unknown>,
): Promise<{ postId: string; profileId: string }> {
  if (!REDDIT_PROFILE_ID_REGEX.test(profileId)) {
    throw new AdApiError({
      platform: "reddit",
      code: "invalid_profile_id",
      message: `Reddit profile ids match ^t2_; got "${profileId}".`,
    });
  }
  const deadline = Date.now() + REDDIT_JOB_DEADLINE_MS;

  for (let submission = 1; submission <= REDDIT_JOB_MAX_SUBMISSIONS; submission++) {
    const submitted = await redditRequest(
      client,
      "POST",
      `/profiles/${profileId}/structured_posts/jobs`,
      jobData,
    );
    const submittedData = (submitted.data ?? {}) as Record<string, unknown>;
    const jobId = typeof submittedData.job_id === "string"
      ? submittedData.job_id
      : typeof submittedData.id === "string"
      ? submittedData.id
      : "";
    if (!jobId) {
      throw new AdApiError({
        platform: "reddit",
        code: "job_id_missing",
        message:
          "structured_posts job submission returned no job id — refusing to poll blind (no fabricated ids).",
      });
    }

    let delayMs = REDDIT_JOB_POLL_INITIAL_MS;
    let serverError = false;
    while (Date.now() < deadline) {
      await redditSleep(delayMs);
      delayMs = Math.min(delayMs * 2, REDDIT_JOB_POLL_CAP_MS);

      const polled = await redditRequest(
        client,
        "GET",
        `/structured_posts/jobs/${jobId}`,
      );
      const polledData = (polled.data ?? {}) as Record<string, unknown>;
      const status = typeof polledData.status === "string" ? polledData.status : "";

      if (status === "SUCCESS") {
        const postId = extractRedditPostId(polled);
        if (!postId) {
          throw new AdApiError({
            platform: "reddit",
            code: "post_id_missing",
            message:
              "structured_posts job reported SUCCESS but no t3_ post id was present — refusing to fabricate one.",
          });
        }
        return { postId, profileId };
      }
      if (status === "CLIENT_ERROR") {
        // Config is wrong — NEVER retry the same job as-is; surface verbatim.
        const errors = polledData.errors;
        const verbatim = Array.isArray(errors) && errors.length > 0
          ? JSON.stringify(errors)
          : redditErrorMessage(polled);
        throw new AdApiError({
          platform: "reddit",
          code: "post_job_client_error",
          message: formatRedditInvalidMediaMessage(verbatim),
        });
      }
      if (status === "SERVER_ERROR") {
        serverError = true;
        break; // resubmit a NEW job with the same config (bounded)
      }
      // QUEUED / PROCESSING (or unknown-but-2xx): keep polling with backoff.
    }

    if (!serverError) break; // deadline exhausted while pending
  }

  throw new AdApiError({
    platform: "reddit",
    code: "post_job_timeout",
    message:
      `structured_posts job did not reach SUCCESS within ${REDDIT_JOB_DEADLINE_MS / 1000}s (or exhausted ${REDDIT_JOB_MAX_SUBMISSIONS} submissions) — the create fails and rolls back (SPEC §3.4).`,
  });
}

// ── Ad builder (SPEC §3.5 — gate G-1) ─────────────────────────────────────────

export interface RedditAdBuildInput {
  adGroupExternalId: string;
  name: string;
  postId: string;
  profileId: string;
  /** The canonical usemingla.com page — never the OneLink (§5.4). */
  clickUrl: string;
  /** utm_campaign value (ad_campaigns.id once persisted; request id pre-persist). */
  utmCampaign?: string | null;
  extraQueryParameters?: { name: string; value: string }[] | null;
}

/**
 * buildRedditAdBody — one of the ONLY three places a create POST body may be
 * constructed (gate G-1). post_id/profile_id pattern-checked; click_url is the
 * canonical page with ≤14 query params including the {{AD_ID}} macro.
 */
export function buildRedditAdBody(input: RedditAdBuildInput): Record<string, unknown> {
  if (input.name.length < REDDIT_NAME_MIN || input.name.length > REDDIT_NAME_MAX) {
    throw new AdApiError({
      platform: "reddit",
      code: "name_out_of_range",
      message: `Ad name must be ${REDDIT_NAME_MIN}–${REDDIT_NAME_MAX} chars [SPEC].`,
    });
  }
  if (!REDDIT_POST_ID_REGEX.test(input.postId)) {
    throw new AdApiError({
      platform: "reddit",
      code: "invalid_post_id",
      message:
        `An ad create without a resolved t3_ post id is unrepresentable (GR-10); got "${input.postId}".`,
    });
  }
  if (!REDDIT_PROFILE_ID_REGEX.test(input.profileId)) {
    throw new AdApiError({
      platform: "reddit",
      code: "invalid_profile_id",
      message: `Reddit profile ids match ^t2_; got "${input.profileId}".`,
    });
  }
  const destination = validateRedditDestinationPolicy(input.clickUrl);
  if (!destination.ok) {
    throw new AdApiError({
      platform: "reddit",
      code: destination.detail,
      message: destination.message,
    });
  }
  const queryParameters: { name: string; value: string }[] = [
    { name: "utm_source", value: "reddit" },
    { name: "utm_medium", value: "paid" },
    ...(input.utmCampaign ? [{ name: "utm_campaign", value: input.utmCampaign }] : []),
    // {{AD_ID}} is a documented Reddit macro [SPEC §3.5].
    { name: "utm_content", value: "{{AD_ID}}" },
    ...(input.extraQueryParameters ?? []),
  ];
  const copy = validateRedditCopy({
    clickUrl: input.clickUrl,
    queryParamCount: queryParameters.length,
  });
  if (!copy.ok) {
    const first = copy.blocks[0];
    throw new AdApiError({ platform: "reddit", code: first.rule, message: first.message });
  }
  return {
    ad_group_id: input.adGroupExternalId,
    name: input.name,
    // EXPLICIT. ALWAYS (GR-11 / G-1).
    configured_status: "PAUSED",
    post_id: input.postId,
    profile_id: input.profileId,
    click_url: input.clickUrl,
    click_url_query_parameters: queryParameters,
  };
}

// ── Review / status sync (SPEC §6 / R-3 / AC-R-26) ────────────────────────────

/**
 * R-3: Reddit has NO review_status field — review state is DERIVED from the
 * ad's effective_status. Unmapped states (billing/identity/permission/paused)
 * return null = leave ads.review_status UNCHANGED (§6.1).
 */
export function redditReviewStatusFromEffectiveStatus(
  effectiveStatus: string | null | undefined,
): string | null {
  switch (effectiveStatus) {
    case "PENDING_APPROVAL":
    case "PROCESSING":
      return "PENDING";
    case "REJECTED":
      return "REJECTED";
    case "ACTIVE":
      return "APPROVED";
    default:
      return null;
  }
}

/** §6.1: approved-but-won't-deliver states → delivery warnings, review untouched. */
export const REDDIT_DELIVERY_WARNING_COPY: Record<string, string> = {
  PENDING_BILLING_INFO:
    "approved-but-won't-spend — billing: the funding instrument is not servable; fix billing in Reddit Ads Manager.",
  PENDING_ID_VERIFICATION: "advertiser identity verification is outstanding.",
  MISSING_PERMISSIONS: "auth/permission gap on the ad account.",
  INVALID_DATA_SOURCE: "pixel/data-source problem on the ad group.",
};

/** #867 precedent: launch returns 200 + warning while review gates delivery. */
export function redditLaunchWarning(effectiveStatus: string | null): string | null {
  if (!effectiveStatus) return null;
  if (effectiveStatus === "PENDING_APPROVAL" || effectiveStatus === "PROCESSING") {
    return `Launched, but Reddit review gates delivery: effective_status=${effectiveStatus}. Nobody publishes how long Reddit takes — we'll poll and tell you.`;
  }
  if (effectiveStatus === "REJECTED") {
    return "Launched, but the ad is REJECTED — read the rejection reason in the review detail and fix the creative.";
  }
  const deliveryWarning = REDDIT_DELIVERY_WARNING_COPY[effectiveStatus];
  if (deliveryWarning) {
    return `Launched, but delivery is blocked: effective_status=${effectiveStatus} — ${deliveryWarning}`;
  }
  return null;
}

/**
 * ads.review_detail payload (§2/§6.2): rejection_reason VERBATIM (including
 * Reddit's own FACILIATE_… typo — never "fixed"), the raw effective_status,
 * and delivery_status[].
 */
export function buildRedditReviewDetail(input: {
  issuesInfo?: unknown[] | null;
  adReviewFeedback?: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const detail: Record<string, unknown> = {};
  const feedback = input.adReviewFeedback ?? null;
  if (feedback) {
    if (typeof feedback.rejection_reason === "string" && feedback.rejection_reason) {
      // Verbatim persistence — the raw enum string, character for character.
      detail.rejection_reason = feedback.rejection_reason;
    }
    if (typeof feedback.effective_status === "string" && feedback.effective_status) {
      detail.effective_status = feedback.effective_status;
    }
    if (typeof feedback.preview_url === "string" && feedback.preview_url) {
      detail.preview_url = feedback.preview_url;
    }
  }
  if (Array.isArray(input.issuesInfo) && input.issuesInfo.length > 0) {
    detail.delivery_status = input.issuesInfo;
  }
  return Object.keys(detail).length > 0 ? detail : null;
}

/** §6.2 cause→fix admin copy; unmapped reasons render the raw enum string. */
export function redditRejectionAdminCopy(reason: string, offendingLine?: string): string | null {
  if (reason === "DATING" || reason.startsWith("DATING_")) {
    const line = offendingLine ? `'${offendingLine}'` : "this copy";
    return `Mingla isn't a dating app, but ${line} reads like one to Reddit's reviewers — try "plan the night" instead of "meet someone".`;
  }
  if (reason === "CAPITALIZATION") return "drop the ALL CAPS";
  if (reason === "EXCEEDING_CHARACTERS") return "headline over ~300";
  if (reason === "BRIDGE_PAGE") {
    return "point Reddit at the canonical page (this should be impossible — §5.4 blocks OneLinks pre-create; escalate).";
  }
  return null;
}

/** Engine status from Reddit configured_status (engine CHECK vocabulary matches). */
export function engineStatusFromReddit(configuredStatus: unknown): string | null {
  switch (configuredStatus) {
    case "ACTIVE":
    case "PAUSED":
    case "ARCHIVED":
    case "DELETED":
      return configuredStatus;
    default:
      return null;
  }
}

function redditLevelPath(level: EntityLevel, externalId: string): string {
  assertRedditNumericId(level, externalId);
  switch (level) {
    case "campaign":
      return `/campaigns/${externalId}`;
    case "ad_set":
      return `/ad_groups/${externalId}`;
    case "ad":
      return `/ads/${externalId}`;
    default: {
      const never: never = level;
      throw new AdApiError({
        platform: "reddit",
        code: "invalid_level",
        message: `Unknown entity level ${String(never)}.`,
      });
    }
  }
}

// ── Connect pre-flight (SPEC §1.3 — fail-close, in order) ─────────────────────

/** Reddit funding currencies [SPEC §3.5] — 8 values, NO NGN (GR-72). */
export const REDDIT_FUNDING_CURRENCIES: readonly string[] = [
  "USD",
  "GBP",
  "CAD",
  "EUR",
  "AUD",
  "NZD",
  "SGD",
  "BRL",
];

/**
 * Typed pre-flight failure so admin-ad-connect can map each step to its
 * SPEC-pinned 424 error code and surface reasons_not_servable[] verbatim.
 */
export class RedditPreflightError extends Error {
  readonly errorCode:
    | "reddit_not_connected"
    | "reddit_profile_missing"
    | "reddit_funding_not_servable"
    | "reddit_currency_unsupported";
  readonly reasons: string[] | null;
  constructor(
    errorCode: RedditPreflightError["errorCode"],
    message: string,
    reasons: string[] | null = null,
  ) {
    super(message);
    this.name = "RedditPreflightError";
    this.errorCode = errorCode;
    this.reasons = reasons;
  }
}

function dataArray(payload: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(payload.data) ? payload.data as Record<string, unknown>[] : [];
}

export interface RedditConnectSnapshot {
  userId: string | null;
  businessId: string;
  account: { id: string; name: string | null; currency: string | null };
  profileId: string;
  fundingInstrumentId: string;
  pixelId: string;
  scope: string | null;
}

/**
 * The §1.3 fail-close pre-flight, in order — steps 1–7. "Created fine, never
 * spends" (PENDING_BILLING_INFO) is the silent failure mode this exists to
 * kill (GR-13). Never report connected past a failed step.
 */
export async function redditConnectPreflight(
  conn: AdConnectionRow | null,
  lane: RedditLane,
): Promise<RedditConnectSnapshot> {
  const env = resolveRedditEnvConfig(conn, lane);
  // Step 1 — mint (fail-close AdNotConnectedError → 424 reddit_not_connected).
  const client = await resolveRedditClient(conn, lane);

  // Step 2 — GET /me (200 + capture the t2_ user).
  const me = await redditRequest(client, "GET", "/me");
  const meData = (me.data ?? me) as Record<string, unknown>;
  const userId = typeof meData.id === "string" && REDDIT_PROFILE_ID_REGEX.test(meData.id)
    ? meData.id
    : null;

  // Step 3 — the business must be reachable.
  const businesses = dataArray(await redditRequest(client, "GET", "/me/businesses"));
  let businessId = "";
  if (env.expectedBusinessId) {
    const match = businesses.find((b) => String(b.id) === env.expectedBusinessId);
    if (!match) {
      throw new RedditPreflightError(
        "reddit_not_connected",
        `The token's businesses do not include the configured business id — check REDDIT_ADS_BUSINESS_ID (SPEC §1.3 step 3).`,
      );
    }
    businessId = String(match.id);
  } else if (businesses.length === 1 && typeof businesses[0].id === "string") {
    businessId = businesses[0].id;
  } else {
    throw new RedditPreflightError(
      "reddit_not_connected",
      `Expected exactly one business on the token (got ${businesses.length}) — set REDDIT_ADS_BUSINESS_ID to disambiguate.`,
    );
  }

  // Step 4 — ad account: ^(t2|a2)_ (BOTH prefixes legal — R-1) + 8-currency enum.
  const accounts = dataArray(
    await redditRequest(client, "GET", `/businesses/${businessId}/ad_accounts`),
  );
  // QA-916-1 (P1): a failed connect persists the explicit 'unconfigured'
  // sentinel as external_account_id (admin-ad-connect markRedditInvalid). A
  // persisted id may pin discovery ONLY when it is a real ^(t2|a2)_ account
  // id — otherwise one transient failure would wedge every reconnect at this
  // step forever (fail-close must never become fail-forever). The guard line
  // below is the ADV-A12 fails-on-revert target: deleting it reproduces the
  // bricked-reconnect bug exactly.
  let persistedAccountId: string | null = conn?.external_account_id ?? null;
  if (persistedAccountId && !REDDIT_AD_ACCOUNT_ID_REGEX.test(persistedAccountId)) persistedAccountId = null;
  const wantedAccountId = env.expectedAccountId ?? persistedAccountId;
  const accountRow = wantedAccountId
    ? accounts.find((a) => String(a.id) === wantedAccountId)
    : accounts.find((a) =>
      typeof a.id === "string" && REDDIT_AD_ACCOUNT_ID_REGEX.test(a.id)
    );
  if (!accountRow || typeof accountRow.id !== "string") {
    throw new RedditPreflightError(
      "reddit_not_connected",
      "No ad account matching ^(t2|a2)_ found on the business (SPEC §1.3 step 4).",
    );
  }
  if (!REDDIT_AD_ACCOUNT_ID_REGEX.test(accountRow.id)) {
    throw new RedditPreflightError(
      "reddit_not_connected",
      `Ad-account id "${accountRow.id}" does not match ^(t2|a2)_ (R-1).`,
    );
  }
  const accountId = accountRow.id;
  const currency = typeof accountRow.currency === "string" ? accountRow.currency : null;
  if (currency && !REDDIT_FUNDING_CURRENCIES.includes(currency)) {
    throw new RedditPreflightError(
      "reddit_currency_unsupported",
      `Ad-account currency ${currency} is outside Reddit's 8-value enum (${
        REDDIT_FUNDING_CURRENCIES.join(", ")
      }) — note NGN does not exist; Reddit is not a Nigeria channel (GR-72).`,
    );
  }

  // Step 5 — ≥1 t2_ profile (no profile ⇒ no post ⇒ no ad).
  const profiles = dataArray(
    await redditRequest(client, "GET", `/ad_accounts/${accountId}/profiles`),
  );
  const profileRow = env.expectedProfileId
    ? profiles.find((p) => String(p.id) === env.expectedProfileId)
    : profiles.find((p) => typeof p.id === "string" && REDDIT_PROFILE_ID_REGEX.test(p.id));
  if (!profileRow || typeof profileRow.id !== "string") {
    throw new RedditPreflightError(
      "reddit_profile_missing",
      "No t2_ profile exists on the ad account — a Reddit ad IS a post and a post needs an author (SPEC §1.3 step 5).",
    );
  }

  // Step 6 — ≥1 funding instrument with is_servable: true.
  const fundingInstruments = dataArray(
    await redditRequest(client, "GET", `/ad_accounts/${accountId}/funding_instruments`),
  );
  const servable = fundingInstruments.find((f) => f.is_servable === true);
  if (!servable) {
    const reasons: string[] = [];
    for (const instrument of fundingInstruments) {
      if (Array.isArray(instrument.reasons_not_servable)) {
        for (const reason of instrument.reasons_not_servable) {
          if (typeof reason === "string") reasons.push(reason);
        }
      }
    }
    throw new RedditPreflightError(
      "reddit_funding_not_servable",
      `No servable funding instrument — reasons_not_servable: ${
        JSON.stringify(reasons)
      } (verbatim; GR-13).`,
      reasons,
    );
  }
  const fundingInstrumentId = env.expectedFundingInstrumentId ?? String(servable.id ?? "");
  if (!fundingInstrumentId) {
    throw new RedditPreflightError(
      "reddit_not_connected",
      "The servable funding instrument has no id (SPEC §1.3 step 6).",
    );
  }

  // Step 7 — pixel present (mandatory on every ad group since 2026-07-13, GR-12).
  const pixels = dataArray(
    await redditRequest(client, "GET", `/ad_accounts/${accountId}/pixels`),
  );
  let pixelId = env.expectedPixelId ?? "";
  if (pixelId) {
    if (!pixels.some((p) => String(p.id) === pixelId)) {
      throw new RedditPreflightError(
        "reddit_not_connected",
        "The configured REDDIT_ADS_PIXEL_ID is not present on the ad account (SPEC §1.3 step 7).",
      );
    }
  } else {
    // R-P3: on Reddit the pixel id IS the ad-account id — prefer that match.
    const accountPixel = pixels.find((p) => String(p.id) === accountId);
    const firstPixel = accountPixel ?? pixels[0];
    pixelId = firstPixel && typeof firstPixel.id === "string" ? firstPixel.id : "";
  }
  if (!pixelId) {
    throw new RedditPreflightError(
      "reddit_not_connected",
      "No pixel exists on the ad account — conversion_pixel_id is mandatory on every ad group since 2026-07-13 (GR-12; SPEC §1.3 step 7).",
    );
  }

  return {
    userId,
    businessId,
    account: {
      id: accountId,
      name: typeof accountRow.name === "string" ? accountRow.name : null,
      currency,
    },
    profileId: profileRow.id,
    fundingInstrumentId,
    pixelId,
    scope: client.scope,
  };
}

// ── The atomic-ish create chain + reverse-order rollback (SPEC §7 / AC-R-14) ──

export interface RedditRollbackOutcome {
  /** Levels PATCHed to DELETED, in the order attempted (ad → ad_group → campaign). */
  attempted: string[];
  /** Levels whose rollback PATCH itself failed (manual reconciliation). */
  failed: string[];
}

/**
 * §7.1: there is NO DELETE verb — "delete" IS PATCH configured_status:
 * "DELETED", applied in REVERSE creation order (ad → ad group → campaign).
 * A failed rollback is recorded, never masks the original error.
 */
export async function redditRollbackCreatedEntities(
  client: RedditClient,
  partial: { adId?: string | null; adGroupId?: string | null; campaignId?: string | null },
): Promise<RedditRollbackOutcome> {
  const outcome: RedditRollbackOutcome = { attempted: [], failed: [] };
  const steps: { level: EntityLevel; id: string | null | undefined }[] = [
    { level: "ad", id: partial.adId },
    { level: "ad_set", id: partial.adGroupId },
    { level: "campaign", id: partial.campaignId },
  ];
  for (const step of steps) {
    if (!step.id) continue;
    outcome.attempted.push(step.level);
    try {
      await redditRequest(client, "PATCH", redditLevelPath(step.level, step.id), {
        configured_status: "DELETED",
      });
    } catch {
      outcome.failed.push(step.level);
    }
  }
  return outcome;
}

export interface RedditChainFailure {
  step: "campaign" | "ad_group" | "creative" | "ad";
  /** Includes orphaned_post_id + profile_id when the job succeeded first (§7.2). */
  partialExternalIds: Record<string, string>;
  rollback: RedditRollbackOutcome;
  cause: unknown;
}

export class RedditChainError extends Error {
  readonly failure: RedditChainFailure;
  constructor(failure: RedditChainFailure) {
    const causeMessage = failure.cause instanceof Error
      ? failure.cause.message
      : String(failure.cause);
    super(`reddit create chain failed at step "${failure.step}": ${causeMessage}`);
    this.name = "RedditChainError";
    this.failure = failure;
  }
}

export interface RedditFullChainInput {
  campaign: Omit<RedditCampaignBuildInput, "fundingInstrumentId" | "conversionPixelId">;
  adGroup: Omit<
    RedditAdGroupBuildInput,
    "campaignExternalId" | "conversionPixelId" | "targeting"
  > & {
    normalizedTargeting?: RedditNormalizedTargeting | null;
    redditPassthrough?: Record<string, unknown> | null;
  };
  creative: RedditCreativeBuildInput;
  ad: Omit<RedditAdBuildInput, "adGroupExternalId" | "postId" | "profileId">;
}

export interface RedditFullChainResult {
  externalCampaignId: string;
  externalAdSetId: string;
  postId: string;
  profileId: string;
  externalAdId: string;
  reviewStatus: string | null;
  effectiveStatus: string | null;
  previewUrl: string | null;
  targetingWarnings: string[];
}

/**
 * The full §3 create sequence: campaign → ad group → createCreative (job →
 * poll → t3_) → ad, ALL PAUSED, with the §7 compensating envelope — any
 * mid-chain failure PATCHes configured_status:"DELETED" over every created
 * entity in reverse order and records an orphaned t3_ post (§7.2: a post with
 * no ad attached is safe residue, not a money bug — but it must be recorded).
 */
export async function redditCreateFullChain(
  conn: AdConnectionRow,
  input: RedditFullChainInput,
): Promise<RedditFullChainResult> {
  const extras = redditConnExtras(conn);
  assertRedditAccountId(conn.external_account_id);
  const accountId = conn.external_account_id;
  const client = await resolveRedditClient(conn);
  const partial: Record<string, string> = {};

  const fail = async (
    step: RedditChainFailure["step"],
    cause: unknown,
  ): Promise<never> => {
    const rollback = await redditRollbackCreatedEntities(client, {
      adId: partial.external_ad_id ?? null,
      adGroupId: partial.external_adset_id ?? null,
      campaignId: partial.external_campaign_id ?? null,
    });
    const externalIds: Record<string, string> = { ...partial };
    if (partial.post_id) {
      // §7.2: the ads-tree rollback cannot delete a profile-scoped post —
      // record it for the operator (or later reuse via the #866 ref cache).
      externalIds.orphaned_post_id = partial.post_id;
      externalIds.profile_id = extras.profileId;
      delete externalIds.post_id;
    }
    throw new RedditChainError({ step, partialExternalIds: externalIds, rollback, cause });
  };

  // 1. Campaign (validation 422s fire inside the builder, before the POST).
  try {
    const body = buildRedditCampaignBody({
      ...input.campaign,
      fundingInstrumentId: extras.fundingInstrumentId,
      conversionPixelId: extras.pixelId,
    });
    const payload = await redditRequest(
      client,
      "POST",
      `/ad_accounts/${accountId}/campaigns`,
      body,
    );
    const id = String(((payload.data ?? {}) as Record<string, unknown>).id ?? "");
    if (!id) throw new AdApiError({ platform: "reddit", code: "campaign_id_missing", message: "Campaign create returned no id." });
    partial.external_campaign_id = id;
  } catch (cause) {
    return await fail("campaign", cause);
  }

  // 2. Ad group (targeting serialized through the allowlist; pre-create
  //    keyword/geo validations run first — AC-R-19).
  try {
    const serialized = serializeRedditTargeting({
      normalized: input.adGroup.normalizedTargeting ?? null,
      passthrough: input.adGroup.redditPassthrough ?? null,
    });
    if (!serialized.ok) {
      throw new AdApiError({
        platform: "reddit",
        code: serialized.detail,
        message: serialized.message,
      });
    }
    const keywords = Array.isArray(serialized.targeting.keywords)
      ? serialized.targeting.keywords as string[]
      : [];
    const geolocations = Array.isArray(serialized.targeting.geolocations)
      ? serialized.targeting.geolocations as string[]
      : [];
    await redditValidateKeywords(client, keywords);
    await redditValidateGeolocations(client, geolocations);

    const body = buildRedditAdGroupBody({
      campaignExternalId: partial.external_campaign_id,
      name: input.adGroup.name,
      budgetCents: input.adGroup.budgetCents,
      conversionPixelId: extras.pixelId,
      bidStrategy: input.adGroup.bidStrategy,
      bidType: input.adGroup.bidType,
      bidValueCents: input.adGroup.bidValueCents,
      optimizationGoal: input.adGroup.optimizationGoal,
      startTime: input.adGroup.startTime,
      endTime: input.adGroup.endTime,
      targeting: serialized.targeting,
      schedule: input.adGroup.schedule,
      campaignHasBidValue: input.campaign.bidValueCents !== undefined &&
        input.campaign.bidValueCents !== null,
    });
    const payload = await redditRequest(
      client,
      "POST",
      `/ad_accounts/${accountId}/ad_groups`,
      body,
    );
    const id = String(((payload.data ?? {}) as Record<string, unknown>).id ?? "");
    if (!id) throw new AdApiError({ platform: "reddit", code: "ad_group_id_missing", message: "Ad-group create returned no id." });
    partial.external_adset_id = id;
    partial.targeting_warnings = serialized.warnings.join(" | ");
  } catch (cause) {
    return await fail("ad_group", cause);
  }

  // 3. Creative — the structured-post job (long-running, non-atomic; §3.4).
  try {
    const jobBody = buildRedditStructuredPostJobBody(input.creative);
    const created = await redditRunStructuredPostJob(client, extras.profileId, jobBody);
    partial.post_id = created.postId;
  } catch (cause) {
    return await fail("creative", cause);
  }

  // 4. Ad.
  try {
    const body = buildRedditAdBody({
      adGroupExternalId: partial.external_adset_id,
      name: input.ad.name,
      postId: partial.post_id,
      profileId: extras.profileId,
      clickUrl: input.ad.clickUrl,
      utmCampaign: input.ad.utmCampaign,
      extraQueryParameters: input.ad.extraQueryParameters,
    });
    const payload = await redditRequest(client, "POST", `/ad_accounts/${accountId}/ads`, body);
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const id = String(data.id ?? "");
    if (!id) throw new AdApiError({ platform: "reddit", code: "ad_id_missing", message: "Ad create returned no id." });
    const effectiveStatus = typeof data.effective_status === "string"
      ? data.effective_status
      : null;
    const targetingWarnings = partial.targeting_warnings
      ? partial.targeting_warnings.split(" | ").filter((w) => w.length > 0)
      : [];
    return {
      externalCampaignId: partial.external_campaign_id,
      externalAdSetId: partial.external_adset_id,
      postId: partial.post_id,
      profileId: extras.profileId,
      externalAdId: id,
      reviewStatus: redditReviewStatusFromEffectiveStatus(effectiveStatus),
      effectiveStatus,
      // §3.5: the cheapest pre-launch QA lever on the channel (GR-33).
      previewUrl: typeof data.preview_url === "string" ? data.preview_url : null,
      targetingWarnings,
    };
  } catch (cause) {
    return await fail("ad", cause);
  }
}

// ── The adapter (A4.a ChannelAdapter) ─────────────────────────────────────────

export const redditAdapter: ChannelAdapter = {
  platform: "reddit",

  connect: async (conn: AdConnectionRow): Promise<AuthedClient> => {
    return await resolveRedditClient(conn);
  },

  createCampaign: async (conn, input: CreateCampaignInput) => {
    const client = await resolveRedditClient(conn);
    const extras = redditConnExtras(conn);
    assertRedditAccountId(conn.external_account_id);
    // A4.a semantics: dailyBudgetCents present ⇒ CBO (budget on the campaign).
    const isCbo = typeof input.dailyBudgetCents === "number" && input.dailyBudgetCents > 0;
    const body = buildRedditCampaignBody({
      name: input.name,
      objective: input.objective,
      fundingInstrumentId: extras.fundingInstrumentId,
      isCbo,
      goalType: isCbo ? "DAILY_SPEND" : null,
      goalValueCents: isCbo ? input.dailyBudgetCents : null,
      bidStrategy: isCbo ? (input.bidStrategy ?? "MAXIMIZE_VOLUME") : null,
      bidType: isCbo ? "CPC" : null,
      startTime: isCbo ? new Date().toISOString() : null,
      conversionPixelId: extras.pixelId,
    });
    const payload = await redditRequest(
      client,
      "POST",
      `/ad_accounts/${conn.external_account_id}/campaigns`,
      body,
    );
    const id = String(((payload.data ?? {}) as Record<string, unknown>).id ?? "");
    return { externalId: id, status: "PAUSED" };
  },

  createAdSet: async (conn, campaignExternalId, input: CreateAdSetInput) => {
    const client = await resolveRedditClient(conn);
    const extras = redditConnExtras(conn);
    assertRedditAccountId(conn.external_account_id);
    if (typeof input.budgetCents !== "number" || input.budgetCents <= 0) {
      throw new AdApiError({
        platform: "reddit",
        code: "budget_required",
        message:
          "Reddit v1 is non-CBO: the daily budget lives on the ad group — budgetCents is required (SPEC §3.2).",
      });
    }
    const rawTargeting = (input.targeting ?? {}) as Record<string, unknown>;
    const passthroughRoot = (rawTargeting.passthrough ?? {}) as Record<string, unknown>;
    const serialized = serializeRedditTargeting({
      normalized: rawTargeting as RedditNormalizedTargeting,
      passthrough: (passthroughRoot.reddit ?? null) as Record<string, unknown> | null,
    });
    if (!serialized.ok) {
      throw new AdApiError({
        platform: "reddit",
        code: serialized.detail,
        message: serialized.message,
      });
    }
    // AC-R-19: free validation calls run BEFORE the ad-group create.
    const keywords = Array.isArray(serialized.targeting.keywords)
      ? serialized.targeting.keywords as string[]
      : [];
    const geolocations = Array.isArray(serialized.targeting.geolocations)
      ? serialized.targeting.geolocations as string[]
      : [];
    await redditValidateKeywords(client, keywords);
    await redditValidateGeolocations(client, geolocations);

    const body = buildRedditAdGroupBody({
      campaignExternalId,
      name: input.name,
      budgetCents: input.budgetCents,
      conversionPixelId: extras.pixelId,
      optimizationGoal: input.optimizationGoal || "CLICKS",
      startTime: new Date().toISOString(),
      targeting: serialized.targeting,
    });
    const payload = await redditRequest(
      client,
      "POST",
      `/ad_accounts/${conn.external_account_id}/ad_groups`,
      body,
    );
    const id = String(((payload.data ?? {}) as Record<string, unknown>).id ?? "");
    return { externalId: id };
  },

  /**
   * A4.a createCreative — the structured-post sub-pipeline (GR-10). The
   * canonical CreateCreativeInput maps onto the IMAGE variant (imageUrl +
   * headline + destUrl + Title-Case CTA); VIDEO/CAROUSEL creatives go through
   * redditCreateFullChain with a reddit-shaped RedditCreativeBuildInput
   * (the canonical input has no video/thumbnail URL or carousel fields).
   * Returns { postId, profileId } — and mirrors postId into
   * externalCreativeId so the generic atomic envelope tracks the partial.
   */
  createCreative: async (conn, input: CreateCreativeInput) => {
    const client = await resolveRedditClient(conn);
    const extras = redditConnExtras(conn);
    if (!input.imageUrl) {
      throw new AdApiError({
        platform: "reddit",
        code: "creative_unsupported_via_canonical_input",
        message:
          "The canonical CreateCreativeInput expresses only the IMAGE variant for Reddit (imageUrl required) — VIDEO/CAROUSEL go through redditCreateFullChain with a reddit-shaped creative (SPEC §3.4).",
      });
    }
    if (!input.headline) {
      throw new AdApiError({
        platform: "reddit",
        code: "headline_required",
        message: "ImageCreative requires a headline [SPEC §4.2].",
      });
    }
    const cta = input.callToActionType ?? REDDIT_CTA_MAP.default;
    const jobBody = buildRedditStructuredPostJobBody({
      type: "IMAGE",
      headline: input.headline,
      destinationUrl: input.destUrl,
      callToAction: cta,
      imageUrl: input.imageUrl,
    });
    const created = await redditRunStructuredPostJob(client, extras.profileId, jobBody);
    return {
      postId: created.postId,
      profileId: created.profileId,
      externalCreativeId: created.postId,
    };
  },

  createAd: async (conn, adSetExternalId, input: CreateAdInput) => {
    const client = await resolveRedditClient(conn);
    const extras = redditConnExtras(conn);
    assertRedditAccountId(conn.external_account_id);
    if (!input.clickUrl) {
      throw new AdApiError({
        platform: "reddit",
        code: "click_url_required",
        message:
          "Reddit ads carry click_url = the canonical usemingla.com page (SPEC §3.5) — clickUrl is required.",
      });
    }
    const body = buildRedditAdBody({
      adGroupExternalId: adSetExternalId,
      name: input.name,
      // The externalCreativeId slot carries the t3_ post id (GR-10); the
      // author profile is the connection's own (the only profile we post as).
      postId: input.externalCreativeId,
      profileId: extras.profileId,
      clickUrl: input.clickUrl,
      utmCampaign: input.utmCampaign ?? null,
    });
    const payload = await redditRequest(
      client,
      "POST",
      `/ad_accounts/${conn.external_account_id}/ads`,
      body,
    );
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const effectiveStatus = typeof data.effective_status === "string"
      ? data.effective_status
      : null;
    return {
      externalId: String(data.id ?? ""),
      reviewStatus: redditReviewStatusFromEffectiveStatus(effectiveStatus),
    };
  },

  /** §3.6: PATCH configured_status — launch is top-down (caller-ordered). */
  setStatus: async (conn, level, externalId, status: AdvertiserStatus) => {
    const client = await resolveRedditClient(conn);
    await redditRequest(client, "PATCH", redditLevelPath(level, externalId), {
      configured_status: status,
    });
  },

  getStatus: async (conn, level, externalId) => {
    const client = await resolveRedditClient(conn);
    const payload = await redditRequest(client, "GET", redditLevelPath(level, externalId));
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const effectiveStatus = typeof data.effective_status === "string"
      ? data.effective_status
      : null;
    const deliveryStatus = Array.isArray(data.delivery_status) ? data.delivery_status : null;
    if (level === "ad") {
      const rejectionReason = typeof data.rejection_reason === "string"
        ? data.rejection_reason
        : null;
      const previewUrl = typeof data.preview_url === "string" ? data.preview_url : null;
      return {
        status: engineStatusFromReddit(data.configured_status),
        effectiveStatus,
        issuesInfo: deliveryStatus,
        adReviewFeedback: rejectionReason || effectiveStatus || previewUrl
          ? {
            rejection_reason: rejectionReason,
            effective_status: effectiveStatus,
            preview_url: previewUrl,
          }
          : null,
      };
    }
    return {
      status: engineStatusFromReddit(data.configured_status),
      effectiveStatus,
      issuesInfo: deliveryStatus,
      adReviewFeedback: null,
    };
  },

  setBudget: async (conn, level, externalId, cents) => {
    if (level === "ad") {
      throw new AdApiError({
        platform: "reddit",
        code: "unsupported_level",
        message:
          "Reddit budgets live on the ad group (non-CBO goal_value) or the CBO campaign — never the ad.",
      });
    }
    const client = await resolveRedditClient(conn);
    await redditRequest(client, "PATCH", redditLevelPath(level, externalId), {
      // THE one cents→micro conversion point for Reddit (A4.a / G-3).
      goal_value: toMicro(cents),
    });
  },

  /**
   * §4.4b generic-envelope hook: PATCH configured_status:"DELETED" on the
   * campaign (no DELETE verb exists — R-5). The reddit-owned chain runner
   * (redditCreateFullChain) is the authoritative rollback path — it deletes
   * ad → ad group → campaign in reverse order (§7.1).
   */
  rollbackCampaign: async (conn, campaignExternalId) => {
    const client = await resolveRedditClient(conn);
    await redditRequest(client, "PATCH", redditLevelPath("campaign", campaignExternalId), {
      configured_status: "DELETED",
    });
  },

  // rollbackCreative is deliberately ABSENT (§7.2): a t3_ post is
  // profile-scoped, NOT a child of the ads tree — it cannot be deleted through
  // campaign rollback. An orphaned post is safe residue (not spend-bearing);
  // the generic envelope reports creativeRollbackSucceeded=false and the id
  // lands in the audit row for manual cleanup or #866 reuse.
};
