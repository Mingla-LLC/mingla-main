/**
 * google.ts — the Google Ads ChannelAdapter (ISSUE-867 WP2 — GOOGLE lane only).
 *
 * SPEC: SPEC_ISSUE-867_SNAPCHAT_GOOGLE_CHANNELS.md §4.0b/§4.3 as corrected by
 * Amendment A1 (A1.3 G-1…G-14 + the PROVEN G-P3 reference mutate body), built
 * against the ISSUE-862 A4.a ChannelAdapter (incl. the WP1 errata optional
 * rollback hooks), grounded in PROOF_LOG.md G-P1…G-P3 (live probes with the
 * engine's own credentials, 2026-07-15):
 *   - v24 ONLY (G-1 — v25 DOES NOT EXIST; UNSUPPORTED_VERSION is a hard fail).
 *   - Account 3623860476 (ENABLED, testAccount:false, USD, billed); MCC
 *     8284700017 as login-customer-id, digits only (G-P1). The dead customer
 *     5083048929 must never appear anywhere.
 *   - Create = ONE atomic `googleAds:mutate`, `partialFailure:false` — native
 *     no-orphan atomicity; NO compensating-delete path exists or is needed
 *     (A1.1(4)). Temp IDs are negative, unique, defined-before-referenced.
 *   - G-14: EVERY campaign create carries `containsEuPoliticalAdvertising:
 *     DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING` — proven REQUIRED on v24
 *     (the G-P3 validate-only run failed without it, validated clean with it).
 *   - SEARCH+RSA ONLY. PMax is DEFERRED (A1.1(2)) — it is not expressible as
 *     sequential createX calls; do NOT add it through this adapter.
 *   - Destination policy v1 (A4.f / D-P1): `final_urls = [dest_url canonical
 *     page]`; the OneLink rides ONLY in the campaign `tracking_url_template`.
 *   - REMOVED is PERMANENT (GR-55/AC-G-4): the status writer can only ever
 *     emit ENABLED|PAUSED — no path here can express REMOVED.
 *   - Geo (GR-37/G-P2): numeric criterion IDs via countryCode-scoped
 *     `geoTargetConstants:suggest`; disambiguate on canonicalName+countryCode,
 *     NEVER bare name (London,Ontario,Canada sorts first on a naive lookup).
 *   - Money (A4.a / GR-01): budgets are CENTS at rest; the ONE cents→micros
 *     conversion (×10,000) happens here via centsToPlatformBudget("google").
 *
 * SECURITY (SPEC §6 SC-SEC-1): the developer token, OAuth client secret and
 * refresh token live ONLY in Supabase Edge Function Secrets (Deno.env). The
 * minted access token exists only in edge memory (module-scope cache) and is
 * never persisted, logged, or echoed in any normalized error or response.
 */

import {
  AdApiError,
  AdNotConnectedError,
  type AdConnectionRow,
  type AdvertiserStatus,
  type AuthedClient,
  centsToPlatformBudget,
  type ChannelAdapter,
  type EntityLevel,
} from "./adChannel.ts";
import { resolveRuntimeString } from "./runtimeConfig.ts";

// ── Env config (NAMES per §7 Google item 5 — values live in Function Secrets) ─

export const GOOGLE_ADS_DEFAULT_API_VERSION = "v24"; // G-1 — v25 DOES NOT EXIST
export const GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleLane = "consumer" | "business";

/**
 * Lane-correct env-var NAMES (QA P2-3 house rule, mirrors meta.ts): the
 * business lane must never silently fall back to the consumer credential.
 * Only the consumer lane is provisioned today (A1.3-0) — the business names
 * simply fail-close until seeded.
 */
function laneEnvName(base: string, lane: GoogleLane): string {
  return lane === "business" ? base.replace(/^GOOGLE_ADS_/, "GOOGLE_ADS_MINGLABIZ_") : base;
}

export function googleDefaultTokenEnvVar(lane: GoogleLane): string {
  return laneEnvName("GOOGLE_ADS_REFRESH_TOKEN", lane);
}

/** Resolved secret VALUES — in edge memory only, never persisted/echoed. */
export interface GoogleEnvValues {
  developerToken: string;
  refreshToken: string;
  refreshTokenEnvVar: string; // cache key NAME (lanes must not share a mint)
  clientId: string;
  clientSecret: string;
  /** MCC id, digits only, no dashes (G-P3 header note). */
  loginCustomerId: string;
  /** Advertiser customer id, digits only. */
  customerId: string;
  apiVersion: string;
  apiBase: string;
}

/**
 * FAIL-CLOSE (AC-G-1): ANY missing secret throws AdNotConnectedError with
 * detail `google_not_provisioned` BEFORE any network call — the edge fns map
 * it to 409 (a provisioning gap, distinct from a 424 broken token). Do NOT
 * soften this throw.
 */
export function resolveGoogleEnvConfig(
  conn?: Pick<AdConnectionRow, "token_env_var"> | null,
  lane: GoogleLane = "consumer",
): GoogleEnvValues {
  const refreshTokenEnvVar = (conn?.token_env_var ?? googleDefaultTokenEnvVar(lane)).trim() ||
    googleDefaultTokenEnvVar(lane);
  const read = (name: string): string => (Deno.env.get(name) ?? "").trim();
  const developerToken = read(laneEnvName("GOOGLE_ADS_DEVELOPER_TOKEN", lane));
  const refreshToken = read(refreshTokenEnvVar);
  const clientId = read(laneEnvName("GOOGLE_ADS_OAUTH_CLIENT_ID", lane));
  const clientSecret = read(laneEnvName("GOOGLE_ADS_OAUTH_CLIENT_SECRET", lane));
  const loginCustomerId = read(laneEnvName("GOOGLE_ADS_LOGIN_CUSTOMER_ID", lane))
    .replace(/-/g, "");
  const customerId = read(laneEnvName("GOOGLE_ADS_CUSTOMER_ID", lane)).replace(/-/g, "");
  if (
    !developerToken || !refreshToken || !clientId || !clientSecret || !loginCustomerId ||
    !customerId
  ) {
    throw new AdNotConnectedError("google", "google_not_provisioned");
  }
  return {
    developerToken,
    refreshToken,
    refreshTokenEnvVar,
    clientId,
    clientSecret,
    loginCustomerId,
    customerId,
    apiVersion: resolveRuntimeString("google_ads_api_version", "GOOGLE_ADS_API_VERSION") ||
      GOOGLE_ADS_DEFAULT_API_VERSION,
    apiBase: read("GOOGLE_ADS_API_BASE") || GOOGLE_ADS_API_BASE,
  };
}

// ── OAuth access-token mint + module-scope cache (mirrors snapAuth's design) ──

interface MintedToken {
  token: string;
  expiresAtMs: number;
}

/** Keyed by refresh-token env-var NAME so lanes never share a minted token. */
const googleTokenCache = new Map<string, MintedToken>();

/** Test hook — clears the in-memory mint cache (never exposes a token). */
export function resetGoogleTokenCacheForTests(): void {
  googleTokenCache.clear();
}

/** Safety margin before expiry (mirrors the snapAuth 60s margin). */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

/**
 * Mints (or reuses) a short-lived OAuth access token from the refresh token.
 * FAIL-CLOSE: a mint 4xx (revoked/expired refresh token) throws
 * AdNotConnectedError with detail `google_not_connected` (→ 424) — never
 * proceed toward spend with a stale/absent token. The refresh token and the
 * minted access token are never logged, returned to callers, or persisted.
 */
export async function mintGoogleAccessToken(env: GoogleEnvValues): Promise<string> {
  const cached = googleTokenCache.get(env.refreshTokenEnvVar);
  if (cached && cached.expiresAtMs > Date.now()) return cached.token;

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("client_id", env.clientId);
  form.set("client_secret", env.clientSecret);
  form.set("refresh_token", env.refreshToken);

  let response: Response;
  try {
    response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch {
    // Network failure at mint — fail-close, no detail that could carry a secret.
    throw new AdNotConnectedError("google", "google_not_connected");
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!response.ok || !accessToken) {
    // Revoked/expired refresh token or OAuth client mismatch — fail-close.
    throw new AdNotConnectedError("google", "google_not_connected");
  }
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  googleTokenCache.set(env.refreshTokenEnvVar, {
    token: accessToken,
    expiresAtMs: Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS,
  });
  return accessToken;
}

export interface GoogleClient extends AuthedClient {
  platform: "google";
  accessToken: string;
  developerToken: string;
  customerId: string;
  loginCustomerId: string;
  apiVersion: string;
  apiBase: string;
}

export async function resolveGoogleClient(
  conn?: AdConnectionRow | null,
  lane?: GoogleLane,
): Promise<GoogleClient> {
  const effectiveLane: GoogleLane = conn?.lane ?? lane ?? "consumer";
  const env = resolveGoogleEnvConfig(conn ?? null, effectiveLane);
  const accessToken = await mintGoogleAccessToken(env);
  return {
    platform: "google",
    accessToken,
    developerToken: env.developerToken,
    customerId: env.customerId,
    loginCustomerId: env.loginCustomerId,
    apiVersion: env.apiVersion,
    apiBase: env.apiBase,
  };
}

// ── Error normalization + secret scrubbing (SC-SEC-1 defense-in-depth) ────────

/**
 * Scrubs anything shaped like a Google OAuth access token (ya29.…) or refresh
 * token (1//…) out of provider text before it can reach the admin client
 * (mirrors meta.ts scrubMetaTokens — QA P3-8).
 */
export function scrubGoogleSecrets(text: string): string {
  return text
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/1\/\/[A-Za-z0-9._-]+/g, "[redacted]");
}

export interface NormalizedGoogleError {
  code: string | number | null;
  subcode: string | null;
  message: string;
  request_id: string | null;
}

/**
 * Client-safe error shape from a GoogleAdsFailure payload:
 * { error: { code, message, status, details: [{ errors: [{ errorCode: {k: v},
 *   message }], requestId }] } }. The requestId is what Google support asks
 * for (A1.1(4)) — surfaced as trace_id and captured into audit rows.
 */
export function normalizeGoogleError(payload: unknown): NormalizedGoogleError {
  const err = (payload as { error?: Record<string, unknown> } | null)?.error ?? {};
  const details = Array.isArray(err.details)
    ? err.details as Record<string, unknown>[]
    : [];
  let subcode: string | null = null;
  let detailMessage: string | null = null;
  let requestId: string | null = null;
  for (const detail of details) {
    if (typeof detail.requestId === "string" && !requestId) requestId = detail.requestId;
    const errors = Array.isArray(detail.errors)
      ? detail.errors as Record<string, unknown>[]
      : [];
    const first = errors[0];
    if (first && !subcode) {
      const errorCode = (first.errorCode ?? {}) as Record<string, unknown>;
      const [key] = Object.keys(errorCode);
      if (key) subcode = `${key}.${String(errorCode[key])}`;
      if (typeof first.message === "string") detailMessage = first.message;
    }
  }
  const message = detailMessage ??
    (typeof err.message === "string" && err.message ? err.message : "Google Ads API error");
  return {
    code: (err.status as string | undefined) ?? (err.code as number | undefined) ?? null,
    subcode,
    message: scrubGoogleSecrets(message),
    request_id: requestId,
  };
}

// ── REST wrapper (Bearer + developer-token + login-customer-id headers) ───────

export async function googleAdsRequest(
  client: GoogleClient,
  path: string,
  body: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<{ payload: Record<string, unknown>; requestId: string | null }> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const url = `${client.apiBase}/${client.apiVersion}/${path.replace(/^\//, "")}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        // Bearer header — never a URL param, so the token can't leak via URLs/logs.
        Authorization: `Bearer ${client.accessToken}`,
        "developer-token": client.developerToken,
        // MCC as login-customer-id, digits only (G-P1/G-P3 header contract).
        "login-customer-id": client.loginCustomerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    clearTimeout(timer);
    const detail = err instanceof Error ? err.message : String(err);
    throw new AdApiError({
      platform: "google",
      code: "network_error",
      message: scrubGoogleSecrets(`Google Ads request failed: ${detail}`),
    });
  }
  clearTimeout(timer);

  const requestId = response.headers.get("request-id");
  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const normalized = normalizeGoogleError(payload);
    throw new AdApiError({
      platform: "google",
      code: normalized.code,
      subcode: normalized.subcode,
      message: normalized.message,
      traceId: normalized.request_id ?? requestId,
    });
  }
  return { payload, requestId };
}

// ── Server-side validators (pre-call 422s — A1.3 G-4 / GR-73 / GAP-7) ─────────

export const GOOGLE_RSA_HEADLINES_MIN = 3;
export const GOOGLE_RSA_HEADLINES_MAX = 15;
export const GOOGLE_RSA_HEADLINE_MAX_CHARS = 30;
export const GOOGLE_RSA_DESCRIPTIONS_MIN = 2;
export const GOOGLE_RSA_DESCRIPTIONS_MAX = 4; // RSA = 4 max; PMax's 5 is NOT this lane (G-4)
export const GOOGLE_RSA_DESCRIPTION_MAX_CHARS = 90;
export const GOOGLE_KEYWORD_MAX_CHARS = 80;
export const GOOGLE_KEYWORD_MAX_WORDS = 10;
export const GOOGLE_FINAL_URL_MAX_BYTES = 2084;
export const GOOGLE_KEYWORD_MATCH_TYPES = ["EXACT", "PHRASE", "BROAD"] as const;
export type GoogleKeywordMatchType = (typeof GOOGLE_KEYWORD_MATCH_TYPES)[number];

export type GoogleValidation =
  | { ok: true }
  | { ok: false; detail: string; message: string };

/** RSA: 3–15 headlines × ≤30 chars and 2–4 descriptions × ≤90 chars (G-4). */
export function validateGoogleRsa(
  headlines: unknown,
  descriptions: unknown,
): GoogleValidation {
  if (
    !Array.isArray(headlines) || headlines.some((h) => typeof h !== "string" || !h.trim())
  ) {
    return {
      ok: false,
      detail: "rsa_headlines_invalid",
      message: "creative.headlines must be an array of non-empty strings.",
    };
  }
  if (
    headlines.length < GOOGLE_RSA_HEADLINES_MIN || headlines.length > GOOGLE_RSA_HEADLINES_MAX
  ) {
    return {
      ok: false,
      detail: "rsa_headline_count",
      message:
        `A responsive search ad needs ${GOOGLE_RSA_HEADLINES_MIN}–${GOOGLE_RSA_HEADLINES_MAX} headlines; got ${headlines.length}.`,
    };
  }
  const longHeadline = (headlines as string[]).find(
    (h) => h.trim().length > GOOGLE_RSA_HEADLINE_MAX_CHARS,
  );
  if (longHeadline !== undefined) {
    return {
      ok: false,
      detail: "rsa_headline_too_long",
      message:
        `Headline "${longHeadline.trim().slice(0, 40)}" exceeds ${GOOGLE_RSA_HEADLINE_MAX_CHARS} characters.`,
    };
  }
  if (
    !Array.isArray(descriptions) ||
    descriptions.some((d) => typeof d !== "string" || !d.trim())
  ) {
    return {
      ok: false,
      detail: "rsa_descriptions_invalid",
      message: "creative.descriptions must be an array of non-empty strings.",
    };
  }
  if (
    descriptions.length < GOOGLE_RSA_DESCRIPTIONS_MIN ||
    descriptions.length > GOOGLE_RSA_DESCRIPTIONS_MAX
  ) {
    return {
      ok: false,
      detail: "rsa_description_count",
      message:
        `A responsive search ad needs ${GOOGLE_RSA_DESCRIPTIONS_MIN}–${GOOGLE_RSA_DESCRIPTIONS_MAX} descriptions (RSA max is 4 — the 5-description figure is PMax, a different ad type); got ${descriptions.length}.`,
    };
  }
  const longDescription = (descriptions as string[]).find(
    (d) => d.trim().length > GOOGLE_RSA_DESCRIPTION_MAX_CHARS,
  );
  if (longDescription !== undefined) {
    return {
      ok: false,
      detail: "rsa_description_too_long",
      message:
        `Description "${longDescription.trim().slice(0, 40)}…" exceeds ${GOOGLE_RSA_DESCRIPTION_MAX_CHARS} characters.`,
    };
  }
  return { ok: true };
}

export interface GoogleKeywordInput {
  text: string;
  matchType: GoogleKeywordMatchType;
}

/**
 * Keywords are REQUIRED for SEARCH (a keyword-less search campaign cannot
 * meaningfully serve — GR-15). PHRASE is the default match type (G-P3).
 * Caps: ≤80 chars / ≤10 words per keyword (GR-73).
 */
export function normalizeGoogleKeywords(
  input: unknown,
  opts: { required?: boolean; field?: string } = {},
): { ok: true; keywords: GoogleKeywordInput[] } | { ok: false; detail: string; message: string } {
  const required = opts.required ?? true;
  const field = opts.field ?? "keywords";
  if (input === undefined || input === null || (Array.isArray(input) && input.length === 0)) {
    if (required) {
      return {
        ok: false,
        detail: "keywords_required",
        message:
          "A SEARCH campaign requires at least one keyword — without keywords the campaign cannot meaningfully serve (GR-15).",
      };
    }
    return { ok: true, keywords: [] };
  }
  if (!Array.isArray(input)) {
    return {
      ok: false,
      detail: `${field}_invalid`,
      message: `${field} must be an array of strings or { text, match_type } objects.`,
    };
  }
  const keywords: GoogleKeywordInput[] = [];
  for (const raw of input) {
    let text = "";
    let matchType: string = "PHRASE"; // G-P3 proven default
    if (typeof raw === "string") {
      text = raw.trim();
    } else if (raw && typeof raw === "object") {
      const record = raw as Record<string, unknown>;
      text = typeof record.text === "string" ? record.text.trim() : "";
      const rawMatch = record.match_type ?? record.matchType;
      if (typeof rawMatch === "string" && rawMatch.trim()) {
        matchType = rawMatch.trim().toUpperCase();
      }
    }
    if (!text) {
      return {
        ok: false,
        detail: `${field}_invalid`,
        message: `${field} entries must carry non-empty text.`,
      };
    }
    if (text.length > GOOGLE_KEYWORD_MAX_CHARS) {
      return {
        ok: false,
        detail: "keyword_too_long",
        message: `Keyword "${text.slice(0, 40)}…" exceeds ${GOOGLE_KEYWORD_MAX_CHARS} characters (GR-73).`,
      };
    }
    if (text.split(/\s+/).length > GOOGLE_KEYWORD_MAX_WORDS) {
      return {
        ok: false,
        detail: "keyword_too_many_words",
        message: `Keyword "${text}" exceeds ${GOOGLE_KEYWORD_MAX_WORDS} words (GR-73).`,
      };
    }
    if (!(GOOGLE_KEYWORD_MATCH_TYPES as readonly string[]).includes(matchType)) {
      return {
        ok: false,
        detail: "keyword_match_type_invalid",
        message:
          `Keyword match type "${matchType}" is invalid — valid: ${GOOGLE_KEYWORD_MATCH_TYPES.join(" | ")} (default PHRASE).`,
      };
    }
    keywords.push({ text, matchType: matchType as GoogleKeywordMatchType });
  }
  return { ok: true, keywords };
}

/** Final URL: https only, ≤2,084 bytes (GR-73). */
export function validateGoogleFinalUrl(url: string): GoogleValidation {
  if (!/^https:\/\//i.test(url)) {
    return {
      ok: false,
      detail: "invalid_destination_url",
      message: "Google final URLs must be https.",
    };
  }
  if (new TextEncoder().encode(url).length > GOOGLE_FINAL_URL_MAX_BYTES) {
    return {
      ok: false,
      detail: "invalid_destination_url",
      message: `Final URL exceeds ${GOOGLE_FINAL_URL_MAX_BYTES} bytes (GR-73).`,
    };
  }
  return { ok: true };
}

// ── Geo resolver (GR-37 / PROOF G-P2 — mandatory, not nice-to-have) ───────────

/**
 * Verified seed constants (live CSV geotargets-2026-07-06 + G-P2). Countries
 * only — cities go through the suggest resolver. Extend ONLY with values
 * verified against the CSV/suggest (never guess a criterion id).
 */
export const GOOGLE_GEO_COUNTRY_CONSTANTS: Record<
  string,
  { criterionId: string; canonicalName: string }
> = {
  US: { criterionId: "2840", canonicalName: "United States" },
  GB: { criterionId: "2826", canonicalName: "United Kingdom" },
  NG: { criterionId: "2566", canonicalName: "Nigeria" },
};

export interface ResolvedGeoTarget {
  criterionId: string;
  resourceName: string;
  name: string;
  canonicalName: string;
  countryCode: string;
  targetType: string | null;
}

/**
 * Pure suggestion picker — THE London/Ontario hazard guard (GR-37): filters to
 * ENABLED constants in the REQUESTED countryCode and disambiguates on
 * canonicalName + countryCode, never bare name. London,Ontario,Canada sorting
 * first must never win a GB-scoped lookup.
 */
export function pickGeoSuggestion(
  payload: unknown,
  target: { name: string; countryCode: string },
): ResolvedGeoTarget | null {
  const suggestions = Array.isArray(
      (payload as Record<string, unknown> | null)?.geoTargetConstantSuggestions,
    )
    ? (payload as Record<string, unknown>).geoTargetConstantSuggestions as Record<
      string,
      unknown
    >[]
    : [];
  for (const suggestion of suggestions) {
    const constant = (suggestion.geoTargetConstant ?? {}) as Record<string, unknown>;
    const status = typeof constant.status === "string" ? constant.status : "";
    const countryCode = typeof constant.countryCode === "string" ? constant.countryCode : "";
    const canonicalName = typeof constant.canonicalName === "string"
      ? constant.canonicalName
      : "";
    const name = typeof constant.name === "string" ? constant.name : "";
    if (status !== "ENABLED") continue; // Removal-Planned IDs rot — never persist one
    if (countryCode.toUpperCase() !== target.countryCode.toUpperCase()) continue;
    if (name.toLowerCase() !== target.name.trim().toLowerCase()) continue;
    if (!canonicalName) continue; // canonicalName is the disambiguator — required
    const id = typeof constant.id === "string"
      ? constant.id
      : typeof constant.id === "number"
      ? String(constant.id)
      : "";
    if (!id) continue;
    return {
      criterionId: id,
      resourceName: typeof constant.resourceName === "string"
        ? constant.resourceName
        : `geoTargetConstants/${id}`,
      name,
      canonicalName,
      countryCode: countryCode.toUpperCase(),
      targetType: typeof constant.targetType === "string" ? constant.targetType : null,
    };
  }
  return null;
}

/**
 * Resolves one named location to a geo criterion via the countryCode-scoped
 * `geoTargetConstants:suggest` (the disambiguation path PROVEN by G-P2:
 * locale en + countryCode GB + "London" → 1006886 London,England,United
 * Kingdom ENABLED). Returns null when nothing resolves in that country.
 * The resolved criterionId + canonicalName are persisted by the caller.
 */
export async function suggestGeoTargetConstants(
  client: GoogleClient,
  input: { name: string; countryCode: string; locale?: string },
): Promise<ResolvedGeoTarget | null> {
  const { payload } = await googleAdsRequest(client, "geoTargetConstants:suggest", {
    locale: input.locale ?? "en",
    countryCode: input.countryCode.toUpperCase(),
    locationNames: { names: [input.name.trim()] },
  });
  return pickGeoSuggestion(payload, {
    name: input.name,
    countryCode: input.countryCode,
  });
}

// ── The PROVEN G-P3 mutate body (the adapter's create contract) ───────────────

/** G-14 (PROOF G-P3): REQUIRED on EVERY v24 campaign create, unconditionally. */
export const GOOGLE_EU_POLITICAL_ADVERTISING_VALUE =
  "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING";

/** Search-only network settings — the exact proven shape (G-P3). */
export const GOOGLE_SEARCH_NETWORK_SETTINGS = {
  targetGoogleSearch: true,
  targetSearchNetwork: false,
  targetContentNetwork: false,
  targetPartnerSearchNetwork: false,
} as const;

// ── ISSUE-992 (3a) demographics + (3b) audiences — ad-group criteria ──────────
//
// Google demographics are ALL-INCLUDED by default; you restrict by adding
// NEGATIVE `adGroupCriterion` criteria for the buckets OUTSIDE the target
// (Google Ads v24 AdGroupCriterion.age_range / .gender). Age bands are FIXED
// 10-year bands — a requested [min,max] INCLUDES every band it overlaps
// (Seth decision G-1: bucket-widening ACCEPTED — never hard-clamp). Age/gender
// UNDETERMINED buckets stay INCLUDED unless the caller opts to exclude them
// (Seth decision G-2 — flags default false). SUSPECTED wire shape (documented
// Google Ads v24 contract) — the create fn threads `validateOnly` so a
// zero-object validate_only mutate proves the exact criterion body at BUILD.
//
// [SUSPECTED — Google Ads v24] adGroupCriterion age_range / gender enum values.
export const GOOGLE_AGE_RANGE_TYPES = [
  "AGE_RANGE_18_24",
  "AGE_RANGE_25_34",
  "AGE_RANGE_35_44",
  "AGE_RANGE_45_54",
  "AGE_RANGE_55_64",
  "AGE_RANGE_65_UP",
] as const;
export type GoogleAgeRangeType = (typeof GOOGLE_AGE_RANGE_TYPES)[number];

/** Fixed 10-year bands (65_UP is open-topped) — the G-1 overlap source. */
export const GOOGLE_AGE_BANDS: readonly { type: GoogleAgeRangeType; min: number; max: number }[] = [
  { type: "AGE_RANGE_18_24", min: 18, max: 24 },
  { type: "AGE_RANGE_25_34", min: 25, max: 34 },
  { type: "AGE_RANGE_35_44", min: 35, max: 44 },
  { type: "AGE_RANGE_45_54", min: 45, max: 54 },
  { type: "AGE_RANGE_55_64", min: 55, max: 64 },
  { type: "AGE_RANGE_65_UP", min: 65, max: 200 },
];

export const GOOGLE_AGE_RANGE_UNDETERMINED = "AGE_RANGE_UNDETERMINED";
export const GOOGLE_GENDER_TYPES = ["MALE", "FEMALE"] as const;
export type GoogleGenderType = (typeof GOOGLE_GENDER_TYPES)[number];
export const GOOGLE_GENDER_UNDETERMINED = "UNDETERMINED";

/**
 * G-1 (bucket-widening ACCEPTED): map a requested [ageMin, ageMax] to the
 * TARGET (included) fixed age bands — every band whose 10-year span OVERLAPS
 * the request is kept (mirrors tiktokAgeGroupsForRange). A request of 21-30
 * therefore INCLUDES 18-24 + 25-34 (wider than asked — standard Google
 * behavior; hard-clamp would silently drop 21-24). Absent bounds default to
 * the widest span so an unset field never narrows.
 */
export function googleAgeRangesForRange(ageMin?: number, ageMax?: number): GoogleAgeRangeType[] {
  const min = typeof ageMin === "number" && Number.isFinite(ageMin) ? ageMin : 0;
  const max = typeof ageMax === "number" && Number.isFinite(ageMax) ? ageMax : 200;
  return GOOGLE_AGE_BANDS
    .filter((band) => band.max >= min && band.min <= max)
    .map((band) => band.type);
}

export interface GoogleCreateFullCampaignInput {
  name: string;
  /** Minor units (cents) — converted ONCE here via centsToPlatformBudget. */
  dailyBudgetCents: number;
  /** Optional max-CPC ceiling on the ad group (cents); targetSpend needs none. */
  cpcBidCents?: number;
  /** A4.f destination policy v1: the canonical public page — NEVER the OneLink. */
  finalUrl: string;
  /** The ONLY slot the OneLink may ride in (A1.1(5)) — campaign level. */
  trackingUrlTemplate?: string;
  headlines: string[];
  descriptions: string[];
  keywords: GoogleKeywordInput[];
  negativeKeywords?: GoogleKeywordInput[];
  /** Resolved numeric criterion ids (GR-37 — resolver output, never raw names). */
  geoTargetCriterionIds: string[];
  /**
   * ISSUE-992 (3a) — the TARGET (included) age bands (GOOGLE_AGE_RANGE_TYPES);
   * buildGoogleMutateOperations excludes the COMPLEMENT as negative criteria.
   * Absent / all-6 → no age criteria (broad, byte-identical).
   */
  ageRanges?: string[];
  /**
   * ISSUE-992 (3a) — the TARGET gender(s) ("MALE"|"FEMALE"); a single-gender
   * target excludes the opposite. Absent / both → no gender criteria.
   */
  genders?: string[];
  /** G-2 (default false): also exclude the AGE_RANGE_UNDETERMINED bucket. */
  excludeUndeterminedAge?: boolean;
  /** G-2 (default false): also exclude the gender UNDETERMINED bucket. */
  excludeUndeterminedGender?: boolean;
  /**
   * ISSUE-992 (3b) — affinity / in-market audience ids (user_interest_id);
   * emitted as POSITIVE ad-group userInterest criteria. 3b is account/policy-
   * gated (G-4) — clean seam: empty ⇒ zero audience ops (3a ships regardless).
   */
  userInterestIds?: string[];
  /** googleAds:mutate validateOnly passthrough — zero objects created (G-P3). */
  validateOnly?: boolean;
}

/** Temp ids (negative, unique, defined-before-referenced — G-P3 hard rules). */
const TEMP_BUDGET_ID = -1;
const TEMP_CAMPAIGN_ID = -2;
const TEMP_AD_GROUP_ID = -3;

/**
 * Builds the EXACT G-P3 reference operation list, values parameterized:
 * budget(-1) → campaign(-2, PAUSED, SEARCH, targetSpend, G-14, PRESENCE,
 * search-only networkSettings) → campaignCriterion (geo) → adGroup(-3,
 * SEARCH_STANDARD, ENABLED) → adGroupAd (PAUSED RSA, finalUrls=[dest_url]) →
 * adGroupCriterion keywords (PHRASE default). Declaration order matters —
 * every temp resource is DEFINED BEFORE it is REFERENCED.
 */
export function buildGoogleMutateOperations(
  customerId: string,
  input: GoogleCreateFullCampaignInput,
): Record<string, unknown>[] {
  const budgetResource = `customers/${customerId}/campaignBudgets/${TEMP_BUDGET_ID}`;
  const campaignResource = `customers/${customerId}/campaigns/${TEMP_CAMPAIGN_ID}`;
  const adGroupResource = `customers/${customerId}/adGroups/${TEMP_AD_GROUP_ID}`;

  const operations: Record<string, unknown>[] = [];

  // 1. Campaign budget — micros via THE one google conversion point (A1.1(1)).
  operations.push({
    campaignBudgetOperation: {
      create: {
        resourceName: budgetResource,
        name: `${input.name} — budget`,
        amountMicros: String(centsToPlatformBudget("google", input.dailyBudgetCents)),
        deliveryMethod: "STANDARD", // ACCELERATED is sunset for Search (G-13)
        explicitlyShared: false,
      },
    },
  });

  // 2. Campaign — PAUSED, SEARCH-only, targetSpend (GR-55), G-14, PRESENCE.
  const campaign: Record<string, unknown> = {
    resourceName: campaignResource,
    name: input.name,
    // GR-11: PAUSED explicitly at every level on every channel — never a default.
    status: "PAUSED",
    advertisingChannelType: "SEARCH", // MVP = SEARCH+RSA ONLY; PMax DEFERRED (A1.1(2))
    campaignBudget: budgetResource,
    // GR-55: targetSpend (maximize clicks) — the only honest strategy with zero
    // conversion history; tCPA/tROAS are volume-gated and NOT offered here.
    targetSpend: {},
    // G-14 (PROOF G-P3): v24 REQUIRES this on every campaign create — the
    // validate-only chain FAILED without it and validated clean with it.
    // Deleting this line is the fails-on-revert target of the G-14 test.
    containsEuPoliticalAdvertising: GOOGLE_EU_POLITICAL_ADVERTISING_VALUE,
    // GR-37: PRESENCE always — the default PRESENCE_OR_INTEREST shows a London
    // campaign to people merely *interested in* London, from anywhere.
    geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE" },
    networkSettings: { ...GOOGLE_SEARCH_NETWORK_SETTINGS },
  };
  if (input.trackingUrlTemplate) {
    // A1.1(5): the OneLink rides ONLY here — never in finalUrls.
    campaign.trackingUrlTemplate = input.trackingUrlTemplate;
  }
  operations.push({ campaignOperation: { create: campaign } });

  // 3. Geo criteria — resolved numeric ids only (GR-37).
  for (const criterionId of input.geoTargetCriterionIds) {
    operations.push({
      campaignCriterionOperation: {
        create: {
          campaign: campaignResource,
          location: { geoTargetConstant: `geoTargetConstants/${criterionId}` },
        },
      },
    });
  }

  // 4. Ad group — ENABLED under the PAUSED parent matches the proven shape.
  const adGroup: Record<string, unknown> = {
    resourceName: adGroupResource,
    name: `${input.name} — ad group`,
    campaign: campaignResource,
    status: "ENABLED",
    type: "SEARCH_STANDARD",
  };
  if (typeof input.cpcBidCents === "number" && input.cpcBidCents > 0) {
    adGroup.cpcBidMicros = String(centsToPlatformBudget("google", input.cpcBidCents));
  }
  operations.push({ adGroupOperation: { create: adGroup } });

  // 4b. ISSUE-992 (3a) demographics by EXCLUSION + (3b) audiences (POSITIVE) —
  //     ad-group-level criteria referencing the ad group above. Demographics
  //     are all-included by default, so a narrowed target is expressed as
  //     NEGATIVE criteria for the buckets OUTSIDE it; a full-range/all target
  //     emits NOTHING (byte-identical broad build). [SUSPECTED wire — probe.]
  const targetAges = Array.isArray(input.ageRanges) ? input.ageRanges : [];
  if (targetAges.length > 0) {
    // Exclude every fixed band NOT in the target set (the G-1 complement).
    for (const band of GOOGLE_AGE_RANGE_TYPES) {
      if (targetAges.includes(band)) continue;
      operations.push({
        adGroupCriterionOperation: {
          create: { adGroup: adGroupResource, negative: true, ageRange: { type: band } },
        },
      });
    }
    // G-2: UNDETERMINED stays INCLUDED unless the flag opts to exclude it.
    if (input.excludeUndeterminedAge === true) {
      operations.push({
        adGroupCriterionOperation: {
          create: {
            adGroup: adGroupResource,
            negative: true,
            ageRange: { type: GOOGLE_AGE_RANGE_UNDETERMINED },
          },
        },
      });
    }
  }
  const targetGenders = Array.isArray(input.genders) ? input.genders : [];
  if (targetGenders.length === 1) {
    // Single-gender target → exclude the opposite (target women ⇒ exclude MALE).
    const opposite = targetGenders[0] === "MALE" ? "FEMALE" : "MALE";
    operations.push({
      adGroupCriterionOperation: {
        create: { adGroup: adGroupResource, negative: true, gender: { type: opposite } },
      },
    });
  }
  if (input.excludeUndeterminedGender === true) {
    operations.push({
      adGroupCriterionOperation: {
        create: {
          adGroup: adGroupResource,
          negative: true,
          gender: { type: GOOGLE_GENDER_UNDETERMINED },
        },
      },
    });
  }
  // 3b audiences — POSITIVE affinity/in-market userInterest criteria (G-4 seam:
  // empty ⇒ nothing emitted, so 3a is unaffected if audiences are account-gated).
  for (const rawId of input.userInterestIds ?? []) {
    const id = String(rawId).trim();
    if (!id) continue;
    operations.push({
      adGroupCriterionOperation: {
        create: {
          adGroup: adGroupResource,
          userInterest: { userInterestCategory: `userInterests/${id}` },
        },
      },
    });
  }

  // 5. The RSA ad — PAUSED; finalUrls = [canonical dest_url] (A4.f / D-P1).
  operations.push({
    adGroupAdOperation: {
      create: {
        adGroup: adGroupResource,
        status: "PAUSED",
        ad: {
          finalUrls: [input.finalUrl],
          responsiveSearchAd: {
            headlines: input.headlines.map((text) => ({ text: text.trim() })),
            descriptions: input.descriptions.map((text) => ({ text: text.trim() })),
          },
        },
      },
    },
  });

  // 6. Keywords (PHRASE default — G-P3) + optional negatives.
  for (const keyword of input.keywords) {
    operations.push({
      adGroupCriterionOperation: {
        create: {
          adGroup: adGroupResource,
          status: "ENABLED",
          keyword: { text: keyword.text, matchType: keyword.matchType },
        },
      },
    });
  }
  for (const negative of input.negativeKeywords ?? []) {
    // GR-73: `negative` is IMMUTABLE — a toggle is remove+create, never update.
    operations.push({
      adGroupCriterionOperation: {
        create: {
          adGroup: adGroupResource,
          negative: true,
          keyword: { text: negative.text, matchType: negative.matchType },
        },
      },
    });
  }

  return operations;
}

/**
 * The full request envelope: `partialFailure:false` = all-or-nothing — the
 * native no-orphan guarantee (A1.1(4)); NO compensating-delete path exists.
 */
export function buildGoogleMutateRequest(
  customerId: string,
  input: GoogleCreateFullCampaignInput,
): Record<string, unknown> {
  return {
    mutateOperations: buildGoogleMutateOperations(customerId, input),
    partialFailure: false,
    validateOnly: input.validateOnly === true,
  };
}

/** Last path segment of a resource name — adGroupAds yields the `{ag}~{ad}` composite. */
export function idFromResourceName(resourceName: string): string {
  const segments = resourceName.split("/");
  return segments[segments.length - 1] ?? "";
}

export interface GoogleMutateResourceNames {
  budgetResourceName: string | null;
  campaignResourceName: string | null;
  adGroupResourceName: string | null;
  adGroupAdResourceName: string | null;
}

export function parseGoogleMutateResults(payload: unknown): GoogleMutateResourceNames {
  const responses = Array.isArray(
      (payload as Record<string, unknown> | null)?.mutateOperationResponses,
    )
    ? (payload as Record<string, unknown>).mutateOperationResponses as Record<
      string,
      unknown
    >[]
    : [];
  const pick = (key: string): string | null => {
    for (const response of responses) {
      const result = response[key] as Record<string, unknown> | undefined;
      if (result && typeof result.resourceName === "string") return result.resourceName;
    }
    return null;
  };
  return {
    budgetResourceName: pick("campaignBudgetResult"),
    campaignResourceName: pick("campaignResult"),
    adGroupResourceName: pick("adGroupResult"),
    adGroupAdResourceName: pick("adGroupAdResult"),
  };
}

export interface GoogleCreateFullCampaignResult {
  validated: boolean;
  /** Numeric campaign id (external_campaign_id). */
  externalCampaignId: string;
  /** Numeric ad-group id (external_adset_id). */
  externalAdSetId: string;
  /** The `{ad_group_id}~{ad_id}` composite (external_ad_id). */
  externalAdId: string;
  budgetResourceName: string | null;
  /** Google request id — what Google support requires (A1.1(4)); audit-row bound. */
  requestId: string | null;
}

/**
 * The Google create: ONE atomic `googleAds:mutate` (`partialFailure:false`) —
 * either the whole budget→campaign→criteria→adGroup→RSA→keywords chain exists
 * or none of it does. `validateOnly:true` passthrough validates the exact
 * same body with zero objects created (PROVEN clean — G-P3).
 */
export async function googleCreateFullCampaign(
  conn: AdConnectionRow,
  input: GoogleCreateFullCampaignInput,
): Promise<GoogleCreateFullCampaignResult> {
  const client = await resolveGoogleClient(conn);
  const request = buildGoogleMutateRequest(client.customerId, input);
  const { payload, requestId } = await googleAdsRequest(
    client,
    `customers/${client.customerId}/googleAds:mutate`,
    request,
  );
  if (input.validateOnly === true) {
    return {
      validated: true,
      externalCampaignId: "",
      externalAdSetId: "",
      externalAdId: "",
      budgetResourceName: null,
      requestId,
    };
  }
  const names = parseGoogleMutateResults(payload);
  if (
    !names.campaignResourceName || !names.adGroupResourceName || !names.adGroupAdResourceName
  ) {
    throw new AdApiError({
      platform: "google",
      code: "unexpected_mutate_response",
      message:
        "googleAds:mutate returned OK but the campaign/adGroup/adGroupAd resource names are missing — refusing to persist an unverifiable create.",
      traceId: requestId,
    });
  }
  return {
    validated: false,
    externalCampaignId: idFromResourceName(names.campaignResourceName),
    externalAdSetId: idFromResourceName(names.adGroupResourceName),
    externalAdId: idFromResourceName(names.adGroupAdResourceName),
    budgetResourceName: names.budgetResourceName,
    requestId,
  };
}

// ── ISSUE-997 D2: Google Demand Gen VIDEO campaign (a DISTINCT campaign type) ──
//
// A YouTube video ad is a DIFFERENT CAMPAIGN TYPE — not a new asset on the Search
// path. googleCreateFullCampaign above is SEARCH+RSA and a video ad CANNOT ride a
// Search campaign. This is the sibling builder: advertisingChannelType
// "DEMAND_GEN" (Google's supported go-forward home for YouTube/Discovery video —
// standalone Video-campaign creation is being sunset into Demand Gen), reusing the
// SAME honest zero-conversion targetSpend (Maximize Clicks) strategy the SEARCH
// path ships, so there is NO conversion-tracking dependency. The prepared UNLISTED
// YouTube video (external_ref_extra.youtube_video_id from the D1 prepare adapter)
// rides as its OWN assetOperation (youtubeVideoAsset), referenced by the
// demandGenVideoResponsiveAd. NO cover / thumbnail (YouTube auto-generates one),
// but a demandGenVideoResponsiveAd REQUIRES >=1 square (1:1) logo image asset —
// so a logo assetOperation (imageAsset, the embedded square Mingla PNG) rides
// too and is referenced by logoImages. PAUSED at every level; validateOnly
// threads natively (Google honors validateOnly:true → zero objects), the key D
// de-risking lever TikTok/Snap lack.
//
// [LIVE-VALIDATED — Google Ads v24 AND v25 — issue #1303] the corrected wire
// shape below was proven to HTTP 200 by native validateOnly:true mutates on the
// live account (zero objects, zero spend). #1303 pinned THREE root causes in the
// original #997-D2 doc-sourced-but-never-live-validated shape and fixed all three:
//   RC-1 geo criteria belong at the AD-GROUP level (Demand Gen defaults to
//        upgraded_targeting=true) — campaign-level geo is REJECTED
//        (requestError.UNKNOWN, the masked #1303 symptom). Do NOT set
//        upgradedTargeting (not a settable v24/v25 field — rely on the default).
//   RC-2 the ad REQUIRES a non-empty ad.name (unlike Search RSA).
//   RC-3 logoImages is REQUIRED (>=1), not optional.
// Deleting containsEuPoliticalAdvertising, moving geo back to campaign level,
// dropping ad.name, or dropping logoImages are each fails-on-revert targets of
// the D2 suite (each reproduces a live Google rejection).

export const GOOGLE_DEMAND_GEN_BUSINESS_NAME_MAX = 25;
export const GOOGLE_DEMAND_GEN_HEADLINE_MAX_CHARS = 40;
export const GOOGLE_DEMAND_GEN_LONG_HEADLINE_MAX_CHARS = 90;
export const GOOGLE_DEMAND_GEN_DESCRIPTION_MAX_CHARS = 90;

export interface GoogleDemandGenVideoInput {
  name: string;
  /** Minor units (cents) — converted ONCE here via centsToPlatformBudget. */
  dailyBudgetCents: number;
  /** A4.f destination policy v1: the canonical public page — NEVER the OneLink. */
  finalUrl: string;
  /** The ONLY slot the OneLink may ride in — campaign level. */
  trackingUrlTemplate?: string;
  /** Advertiser/brand display name (≤25) — REQUIRED by the video responsive ad. */
  businessName: string;
  /** ≥1, each ≤40 chars. */
  headlines: string[];
  /** ≥1, each ≤90 chars (a NEW field the SEARCH/RSA path does not collect). */
  longHeadlines: string[];
  /** ≥1, each ≤90 chars. */
  descriptions: string[];
  /** The prepared YouTube video id (external_ref_extra.youtube_video_id — D1). */
  youtubeVideoId: string;
  /**
   * REQUIRED square (1:1) logo image, base64-encoded PNG bytes — a
   * demandGenVideoResponsiveAd rejects (collectionSizeError: TOO_FEW) without >=1
   * logo asset (#1303 RC-3). Supply MINGLA_SQUARE_LOGO_PNG_BASE64 from
   * _shared/adDemandGenLogo.ts; the builder fails closed on an empty value.
   */
  logoImageData: string;
  /** Resolved numeric criterion ids (GR-37 — resolver output, never raw names). */
  geoTargetCriterionIds: string[];
  /** googleAds:mutate validateOnly passthrough — zero objects created. */
  validateOnly?: boolean;
}

/**
 * Demand Gen video responsive-ad copy validator (pre-call 422s): businessName
 * ≤25, ≥1 headline ≤40, ≥1 longHeadline ≤90, ≥1 description ≤90. NO keyword
 * validation — Demand Gen is audience-based, not keyword-based.
 */
export function validateGoogleDemandGenAd(input: {
  businessName: unknown;
  headlines: unknown;
  longHeadlines: unknown;
  descriptions: unknown;
}): GoogleValidation {
  const checkTextArray = (
    value: unknown,
    field: string,
    maxChars: number,
  ): GoogleValidation => {
    if (!Array.isArray(value) || value.length === 0) {
      return {
        ok: false,
        detail: `demand_gen_${field}_required`,
        message: `A Demand Gen video ad needs at least one ${field.replace(/_/g, " ")}.`,
      };
    }
    if (value.some((t) => typeof t !== "string" || !t.trim())) {
      return {
        ok: false,
        detail: `demand_gen_${field}_invalid`,
        message: `creative.${field} must be an array of non-empty strings.`,
      };
    }
    const tooLong = (value as string[]).find((t) => t.trim().length > maxChars);
    if (tooLong !== undefined) {
      return {
        ok: false,
        detail: `demand_gen_${field}_too_long`,
        message: `"${tooLong.trim().slice(0, 40)}" exceeds ${maxChars} characters.`,
      };
    }
    return { ok: true };
  };

  if (typeof input.businessName !== "string" || !input.businessName.trim()) {
    return {
      ok: false,
      detail: "demand_gen_business_name_required",
      message: "A Demand Gen video ad needs a business name.",
    };
  }
  if (input.businessName.trim().length > GOOGLE_DEMAND_GEN_BUSINESS_NAME_MAX) {
    return {
      ok: false,
      detail: "demand_gen_business_name_too_long",
      message:
        `The business name exceeds ${GOOGLE_DEMAND_GEN_BUSINESS_NAME_MAX} characters.`,
    };
  }
  const headlineCheck = checkTextArray(
    input.headlines,
    "headlines",
    GOOGLE_DEMAND_GEN_HEADLINE_MAX_CHARS,
  );
  if (!headlineCheck.ok) return headlineCheck;
  const longHeadlineCheck = checkTextArray(
    input.longHeadlines,
    "long_headlines",
    GOOGLE_DEMAND_GEN_LONG_HEADLINE_MAX_CHARS,
  );
  if (!longHeadlineCheck.ok) return longHeadlineCheck;
  const descriptionCheck = checkTextArray(
    input.descriptions,
    "descriptions",
    GOOGLE_DEMAND_GEN_DESCRIPTION_MAX_CHARS,
  );
  if (!descriptionCheck.ok) return descriptionCheck;
  return { ok: true };
}

/**
 * Demand Gen temp ids (negative, unique, defined-before-referenced). The YouTube
 * video AND the square logo each get their own asset temp id so the adGroupAd can
 * reference them. Accepted op order (live-validated, #1303): budget(-1) →
 * campaign(-2) → video asset(-3) → logo asset(-5) → adGroup(-4) →
 * adGroupCriterion(location)×N → adGroupAd.
 */
const DG_TEMP_BUDGET_ID = -1;
const DG_TEMP_CAMPAIGN_ID = -2;
const DG_TEMP_VIDEO_ASSET_ID = -3;
const DG_TEMP_AD_GROUP_ID = -4;
const DG_TEMP_LOGO_ASSET_ID = -5;

/**
 * Builds the Demand Gen video op list, define-before-reference. Diffs from the
 * SEARCH builder (buildGoogleMutateOperations): advertisingChannelType
 * "DEMAND_GEN" (no subtype); NO networkSettings (does not apply to Demand Gen — a
 * Search-style networkSettings is REJECTED); a separate assetOperation carrying
 * the prepared youtubeVideoId AND a second assetOperation carrying the square
 * logo image; the adGroup takes NO `type`; geo criteria are emitted at the
 * AD-GROUP level (Demand Gen's default upgraded_targeting rejects campaign-level
 * geo — #1303 RC-1); the ad is a demandGenVideoResponsiveAd with a non-empty
 * `name` (#1303 RC-2), businessName/headlines/longHeadlines/descriptions/videos,
 * and a REQUIRED logoImages (#1303 RC-3). All PAUSED (ad group ENABLED under the
 * PAUSED parent). Live-validated to HTTP 200 on v24 AND v25.
 */
export function buildGoogleDemandGenMutateOperations(
  customerId: string,
  input: GoogleDemandGenVideoInput,
): Record<string, unknown>[] {
  const budgetResource = `customers/${customerId}/campaignBudgets/${DG_TEMP_BUDGET_ID}`;
  const campaignResource = `customers/${customerId}/campaigns/${DG_TEMP_CAMPAIGN_ID}`;
  const videoAssetResource = `customers/${customerId}/assets/${DG_TEMP_VIDEO_ASSET_ID}`;
  const logoAssetResource = `customers/${customerId}/assets/${DG_TEMP_LOGO_ASSET_ID}`;
  const adGroupResource = `customers/${customerId}/adGroups/${DG_TEMP_AD_GROUP_ID}`;

  // #1303 RC-3: logoImages is REQUIRED — fail closed on a missing/empty logo so a
  // create can never emit a body Google rejects (collectionSizeError: TOO_FEW).
  const logoImageData = input.logoImageData?.trim();
  if (!logoImageData) {
    throw new AdApiError({
      platform: "google",
      code: "demand_gen_logo_missing",
      message:
        "A Demand Gen video responsive ad requires a square logo image — logoImageData was empty. Supply MINGLA_SQUARE_LOGO_PNG_BASE64.",
    });
  }

  const operations: Record<string, unknown>[] = [];

  // 1. Campaign budget — micros via THE one google conversion point.
  operations.push({
    campaignBudgetOperation: {
      create: {
        resourceName: budgetResource,
        name: `${input.name} — budget`,
        amountMicros: String(centsToPlatformBudget("google", input.dailyBudgetCents)),
        deliveryMethod: "STANDARD",
        explicitlyShared: false,
      },
    },
  });

  // 2. Campaign — PAUSED, DEMAND_GEN, targetSpend (reuse the honest zero-
  //    conversion strategy), G-14, PRESENCE. NO networkSettings.
  const campaign: Record<string, unknown> = {
    resourceName: campaignResource,
    name: input.name,
    // GR-11: PAUSED explicitly at every level — never a default.
    status: "PAUSED",
    // DOC: Demand Gen takes NO advertisingChannelSubType.
    advertisingChannelType: "DEMAND_GEN",
    campaignBudget: budgetResource,
    // Maximize Clicks IS a supported Demand Gen strategy → the same honest
    // zero-conversion-history strategy the SEARCH path ships (NO conversion goal).
    targetSpend: {},
    // G-14: v24 REQUIRES this on every campaign create — deleting it is the
    // fails-on-revert target of the Demand Gen G-14 test.
    containsEuPoliticalAdvertising: GOOGLE_EU_POLITICAL_ADVERTISING_VALUE,
    // GR-37: PRESENCE always (never PRESENCE_OR_INTEREST).
    geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE" },
    // NO networkSettings — it does not apply to Demand Gen.
  };
  if (input.trackingUrlTemplate) {
    // The OneLink rides ONLY here — never in finalUrls.
    campaign.trackingUrlTemplate = input.trackingUrlTemplate;
  }
  operations.push({ campaignOperation: { create: campaign } });

  // 3. YouTube video ASSET — the prepared UNLISTED video, referenced by the ad.
  operations.push({
    assetOperation: {
      create: {
        resourceName: videoAssetResource,
        name: `${input.name} — video`,
        youtubeVideoAsset: { youtubeVideoId: input.youtubeVideoId },
      },
    },
  });

  // 4. Logo image ASSET (#1303 RC-3) — a square (1:1) imageAsset the
  //    demandGenVideoResponsiveAd REQUIRES via logoImages. Base64 PNG bytes on
  //    the Google Ads Asset.image_asset `data` bytes field.
  operations.push({
    assetOperation: {
      create: {
        resourceName: logoAssetResource,
        name: `${input.name} — logo`,
        imageAsset: { data: logoImageData },
      },
    },
  });

  // 5. Ad group — ENABLED under the PAUSED parent. DOC: Demand Gen ad groups take
  //    NO `type` (SEARCH_STANDARD would be REJECTED) — omit it.
  operations.push({
    adGroupOperation: {
      create: {
        resourceName: adGroupResource,
        name: `${input.name} — ad group`,
        campaign: campaignResource,
        status: "ENABLED",
      },
    },
  });

  // 6. Geo criteria at the AD-GROUP level (#1303 RC-1) — Demand Gen defaults to
  //    upgraded_targeting=true, which moves location targeting to the ad group;
  //    campaign-level geo is REJECTED (requestError.UNKNOWN). Resolved numeric ids
  //    only (GR-37). upgradedTargeting is NOT set (not a settable field — default).
  for (const criterionId of input.geoTargetCriterionIds) {
    operations.push({
      adGroupCriterionOperation: {
        create: {
          adGroup: adGroupResource,
          location: { geoTargetConstant: `geoTargetConstants/${criterionId}` },
        },
      },
    });
  }

  // 7. The Demand Gen video responsive ad — PAUSED; finalUrls = [canonical
  //    dest_url]. #1303 RC-2: ad.name is REQUIRED (unlike Search RSA). #1303 RC-3:
  //    logoImages references the square logo asset (>=1 required).
  operations.push({
    adGroupAdOperation: {
      create: {
        adGroup: adGroupResource,
        status: "PAUSED",
        ad: {
          name: `${input.name} — ad`,
          finalUrls: [input.finalUrl],
          demandGenVideoResponsiveAd: {
            businessName: { text: input.businessName.trim() },
            headlines: input.headlines.map((text) => ({ text: text.trim() })),
            longHeadlines: input.longHeadlines.map((text) => ({ text: text.trim() })),
            descriptions: input.descriptions.map((text) => ({ text: text.trim() })),
            videos: [{ asset: videoAssetResource }],
            logoImages: [{ asset: logoAssetResource }],
          },
        },
      },
    },
  });

  return operations;
}

/** Demand Gen request envelope — `partialFailure:false` all-or-nothing. */
export function buildGoogleDemandGenMutateRequest(
  customerId: string,
  input: GoogleDemandGenVideoInput,
): Record<string, unknown> {
  return {
    mutateOperations: buildGoogleDemandGenMutateOperations(customerId, input),
    partialFailure: false,
    validateOnly: input.validateOnly === true,
  };
}

export interface GoogleDemandGenVideoResult {
  validated: boolean;
  externalCampaignId: string;
  externalAdSetId: string;
  externalAdId: string;
  budgetResourceName: string | null;
  requestId: string | null;
}

/**
 * The Google Demand Gen video create: ONE atomic `googleAds:mutate`
 * (`partialFailure:false`). `validateOnly:true` passthrough validates the exact
 * same body with ZERO objects created (native Google validate — the D de-risking
 * lever). Mirrors googleCreateFullCampaign's result contract.
 */
export async function googleCreateDemandGenVideoCampaign(
  conn: AdConnectionRow,
  input: GoogleDemandGenVideoInput,
): Promise<GoogleDemandGenVideoResult> {
  const client = await resolveGoogleClient(conn);
  const request = buildGoogleDemandGenMutateRequest(client.customerId, input);
  const { payload, requestId } = await googleAdsRequest(
    client,
    `customers/${client.customerId}/googleAds:mutate`,
    request,
  );
  if (input.validateOnly === true) {
    return {
      validated: true,
      externalCampaignId: "",
      externalAdSetId: "",
      externalAdId: "",
      budgetResourceName: null,
      requestId,
    };
  }
  const names = parseGoogleMutateResults(payload);
  if (
    !names.campaignResourceName || !names.adGroupResourceName || !names.adGroupAdResourceName
  ) {
    throw new AdApiError({
      platform: "google",
      code: "unexpected_mutate_response",
      message:
        "googleAds:mutate (Demand Gen) returned OK but the campaign/adGroup/adGroupAd resource names are missing — refusing to persist an unverifiable create.",
      traceId: requestId,
    });
  }
  return {
    validated: false,
    externalCampaignId: idFromResourceName(names.campaignResourceName),
    externalAdSetId: idFromResourceName(names.adGroupResourceName),
    externalAdId: idFromResourceName(names.adGroupAdResourceName),
    budgetResourceName: names.budgetResourceName,
    requestId,
  };
}

// ── Status semantics (A1.1(4) / GR-55 / AC-G-4 — REMOVED is NEVER emitted) ────

/**
 * THE status writer (AC-G-4): AdvertiserStatus can only be PAUSED|ACTIVE, and
 * this map can only produce ENABLED|PAUSED. `REMOVED` is PERMANENT on Google —
 * there is no un-remove — so no launch/pause/sync path may ever emit it. The
 * exhaustive-switch throw catches hostile casts at runtime.
 */
export function googleStatusForAdvertiserStatus(
  status: AdvertiserStatus,
): "ENABLED" | "PAUSED" {
  switch (status) {
    case "ACTIVE":
      return "ENABLED";
    case "PAUSED":
      return "PAUSED";
    default: {
      const never: never = status;
      throw new AdApiError({
        platform: "google",
        code: "invalid_status",
        message:
          `Refusing to write status "${String(never)}" — the Google status writer emits ONLY ENABLED|PAUSED (REMOVED is permanent; AC-G-4).`,
      });
    }
  }
}

/** Google → engine status (engine CHECK: PAUSED|ACTIVE|ARCHIVED|DELETED). */
export function engineStatusFromGoogle(status: unknown): string | null {
  switch (status) {
    case "ENABLED":
      return "ACTIVE";
    case "PAUSED":
      return "PAUSED";
    case "REMOVED":
      return "DELETED"; // permanent on Google — read-side mapping only
    default:
      return null;
  }
}

const NUMERIC_ID_REGEX = /^\d+$/;
const COMPOSITE_AD_ID_REGEX = /^\d+~\d+$/;

function assertGoogleExternalId(level: EntityLevel, externalId: string): void {
  const valid = level === "ad"
    ? COMPOSITE_AD_ID_REGEX.test(externalId)
    : NUMERIC_ID_REGEX.test(externalId);
  if (!valid) {
    throw new AdApiError({
      platform: "google",
      code: "invalid_external_id",
      message: level === "ad"
        ? `Google ad ids are the "{ad_group_id}~{ad_id}" composite; got "${externalId}".`
        : `Google ${level} ids are numeric; got "${externalId}".`,
    });
  }
}

/** Resource name per level; the ad level consumes the `{ag}~{ad}` composite. */
export function googleResourceNameForLevel(
  customerId: string,
  level: EntityLevel,
  externalId: string,
): string {
  assertGoogleExternalId(level, externalId);
  switch (level) {
    case "campaign":
      return `customers/${customerId}/campaigns/${externalId}`;
    case "ad_set":
      return `customers/${customerId}/adGroups/${externalId}`;
    case "ad":
      return `customers/${customerId}/adGroupAds/${externalId}`;
    default: {
      const never: never = level;
      throw new AdApiError({
        platform: "google",
        code: "invalid_level",
        message: `Unknown entity level ${String(never)}.`,
      });
    }
  }
}

/** The per-level status-update operation (unit-tested REMOVED-never surface). */
export function buildGoogleStatusUpdateOperation(
  customerId: string,
  level: EntityLevel,
  externalId: string,
  status: AdvertiserStatus,
): { path: string; body: Record<string, unknown> } {
  const resourceName = googleResourceNameForLevel(customerId, level, externalId);
  const mutatePath = level === "campaign"
    ? "campaigns:mutate"
    : level === "ad_set"
    ? "adGroups:mutate"
    : "adGroupAds:mutate";
  return {
    path: `customers/${customerId}/${mutatePath}`,
    body: {
      operations: [
        {
          update: {
            resourceName,
            status: googleStatusForAdvertiserStatus(status),
          },
          updateMask: "status",
        },
      ],
    },
  };
}

// ── Status read (GAQL) + review detail (G-3: BOTH vocabularies persisted) ─────

export function gaqlForStatus(level: EntityLevel, externalId: string): string {
  assertGoogleExternalId(level, externalId);
  if (level === "campaign") {
    return `SELECT campaign.id, campaign.status FROM campaign WHERE campaign.id = ${externalId}`;
  }
  if (level === "ad_set") {
    return `SELECT ad_group.id, ad_group.status FROM ad_group WHERE ad_group.id = ${externalId}`;
  }
  const [adGroupId, adId] = externalId.split("~");
  return "SELECT ad_group_ad.status, " +
    "ad_group_ad.policy_summary.approval_status, " +
    "ad_group_ad.policy_summary.review_status, " +
    "ad_group_ad.policy_summary.policy_topic_entries " +
    `FROM ad_group_ad WHERE ad_group.id = ${adGroupId} AND ad_group_ad.ad.id = ${adId}`;
}

/**
 * G-3 (supersedes OD-8): Google splits what Snap merges — persist BOTH
 * `policy_summary.approval_status` (DISAPPROVED / APPROVED_LIMITED / APPROVED /
 * AREA_OF_INTEREST_ONLY) AND `policy_summary.review_status`
 * (REVIEW_IN_PROGRESS / REVIEWED / UNDER_APPEAL / ELIGIBLE_MAY_SERVE), plus
 * `policy_topic_entries[]` (topic enum: LIMITED / FULLY_LIMITED — not the
 * legacy LIMITS_SERVING names) into ads.review_detail.
 */
export function buildGoogleReviewDetail(input: {
  issuesInfo?: unknown[] | null;
  adReviewFeedback?: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const detail: Record<string, unknown> = {};
  const feedback = input.adReviewFeedback ?? null;
  if (feedback) {
    if (feedback.approval_status !== undefined && feedback.approval_status !== null) {
      detail.approval_status = feedback.approval_status;
    }
    if (feedback.review_status !== undefined && feedback.review_status !== null) {
      detail.review_status = feedback.review_status;
    }
  }
  if (Array.isArray(input.issuesInfo) && input.issuesInfo.length > 0) {
    detail.policy_topic_entries = input.issuesInfo;
  }
  return Object.keys(detail).length > 0 ? detail : null;
}

// ── Connect probe (AC-G-2 / preflight: the cheap GAQL SELECT customer) ────────

export interface GoogleCustomerSnapshot {
  id: string;
  descriptiveName: string | null;
  status: string | null;
  currency: string | null;
  timezone: string | null;
  testAccount: boolean;
}

/**
 * The connect/preflight validation call: a GAQL SELECT on the customer
 * resource. Succeeding at all proves the developer token works on this
 * account (BASIC tier — G-P1); the row proves ENABLED + not a test account.
 */
export async function googleFetchCustomer(client: GoogleClient): Promise<GoogleCustomerSnapshot> {
  const query = "SELECT customer.id, customer.descriptive_name, customer.status, " +
    "customer.currency_code, customer.time_zone, customer.test_account FROM customer";
  const { payload } = await googleAdsRequest(
    client,
    `customers/${client.customerId}/googleAds:search`,
    { query },
  );
  const results = Array.isArray(payload.results)
    ? payload.results as Record<string, unknown>[]
    : [];
  const customer = (results[0]?.customer ?? {}) as Record<string, unknown>;
  return {
    id: typeof customer.id === "string"
      ? customer.id
      : typeof customer.id === "number"
      ? String(customer.id)
      : client.customerId,
    descriptiveName: typeof customer.descriptiveName === "string"
      ? customer.descriptiveName
      : null,
    status: typeof customer.status === "string" ? customer.status : null,
    currency: typeof customer.currencyCode === "string" ? customer.currencyCode : null,
    timezone: typeof customer.timeZone === "string" ? customer.timeZone : null,
    testAccount: customer.testAccount === true,
  };
}

// ── ISSUE-992 (3b): affinity / in-market audience search (user_interest) ──────

export interface GoogleUserInterest {
  id: string;
  name: string;
  /** AFFINITY | IN_MARKET | … (Google user-interest taxonomy). */
  taxonomyType: string | null;
}

/** Tolerant parser over a googleAds:search `user_interest` result page. */
export function parseGoogleUserInterests(payload: unknown): GoogleUserInterest[] {
  const results = Array.isArray((payload as Record<string, unknown> | null)?.results)
    ? (payload as Record<string, unknown>).results as Record<string, unknown>[]
    : [];
  const out: GoogleUserInterest[] = [];
  const seen = new Set<string>();
  for (const row of results) {
    const ui = (row.userInterest ?? row.user_interest ?? {}) as Record<string, unknown>;
    const idRaw = ui.userInterestId ?? ui.user_interest_id;
    const id = typeof idRaw === "string" ? idRaw : typeof idRaw === "number" ? String(idRaw) : "";
    const name = typeof ui.name === "string" ? ui.name : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const taxonomy = ui.taxonomyType ?? ui.taxonomy_type;
    out.push({ id, name, taxonomyType: typeof taxonomy === "string" ? taxonomy : null });
  }
  return out;
}

/**
 * Case-insensitive substring filter, prefix matches first, capped — the
 * fetch+filter fallback shape (mirrors filterTikTokInterestCategories) if a
 * live probe shows `LIKE` is unsupported on user_interest.name. Pure.
 */
export function filterGoogleUserInterests(
  interests: readonly GoogleUserInterest[],
  opts: { q?: string; limit?: number } = {},
): GoogleUserInterest[] {
  const q = (opts.q ?? "").trim().toLowerCase();
  const limit = opts.limit ?? 20;
  const matched = interests.filter((i) => q.length === 0 || i.name.toLowerCase().includes(q));
  matched.sort((a, b) => {
    const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });
  return matched.slice(0, limit);
}

/**
 * ISSUE-992 (3b): resolve affinity / in-market audiences by NAME via a
 * googleAds:search over the `user_interest` resource (non-streaming — cleaner
 * for a typeahead than searchStream; same POST client as googleFetchCustomer).
 * [SUSPECTED GAQL — the `LIKE` operator on user_interest.name must be confirmed
 * with a live read at BUILD; fallback = an unfiltered page + filterGoogle-
 * UserInterests substring match.] Returns [] on an empty query.
 */
export async function searchGoogleUserInterests(
  client: GoogleClient,
  q: string,
  opts: { limit?: number } = {},
): Promise<GoogleUserInterest[]> {
  const limit = opts.limit ?? 20;
  const term = q.trim();
  if (!term) return [];
  // GAQL single-quoted string literal — escape backslash + quote (never inject).
  const safe = term.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const query =
    "SELECT user_interest.user_interest_id, user_interest.name, user_interest.taxonomy_type " +
    `FROM user_interest WHERE user_interest.name LIKE '%${safe}%' LIMIT ${limit}`;
  const { payload } = await googleAdsRequest(
    client,
    `customers/${client.customerId}/googleAds:search`,
    { query },
  );
  // Post-filter to keep the substring contract stable across the LIKE / fallback paths.
  return filterGoogleUserInterests(parseGoogleUserInterests(payload), { q: term, limit });
}

// ── The adapter ───────────────────────────────────────────────────────────────

/**
 * The sequential createX path is DISABLED BY DESIGN for Google: the create is
 * ONE atomic googleAds:mutate (googleCreateFullCampaign) with native
 * all-or-nothing semantics (A1.1(4)) — a sequential decomposition would
 * reintroduce the partial-create window the atomic request exists to close.
 */
function googleAtomicOnly(): never {
  throw new AdApiError({
    platform: "google",
    code: "google_atomic_create_only",
    message:
      "Google creates are ONE atomic googleAds:mutate (partialFailure:false) — use googleCreateFullCampaign; the sequential create path is disabled by design (A1.1(4)).",
  });
}

export const googleAdapter: ChannelAdapter = {
  platform: "google",

  connect: async (conn: AdConnectionRow): Promise<AuthedClient> => {
    return await resolveGoogleClient(conn);
  },

  // Fail-close FIRST (AC-G-1): an unprovisioned channel surfaces
  // google_not_provisioned before any atomic-only guidance.
  // deno-lint-ignore require-await
  createCampaign: async (conn) => {
    resolveGoogleEnvConfig(conn);
    return googleAtomicOnly();
  },
  // deno-lint-ignore require-await
  createAdSet: async (conn) => {
    resolveGoogleEnvConfig(conn);
    return googleAtomicOnly();
  },
  // NOTE: createCreative is deliberately ABSENT — SEARCH+RSA text is inline on
  // the ad; image/video assets (assets:mutate, bytes-only — G-12) are the
  // deferred #866 lane, not WP2.
  // deno-lint-ignore require-await
  createAd: async (conn) => {
    resolveGoogleEnvConfig(conn);
    return googleAtomicOnly();
  },

  setStatus: async (conn, level, externalId, status: AdvertiserStatus) => {
    const client = await resolveGoogleClient(conn);
    const { path, body } = buildGoogleStatusUpdateOperation(
      client.customerId,
      level,
      externalId,
      status,
    );
    await googleAdsRequest(client, path, body);
  },

  getStatus: async (conn, level, externalId) => {
    const client = await resolveGoogleClient(conn);
    const query = gaqlForStatus(level, externalId);
    const { payload } = await googleAdsRequest(
      client,
      `customers/${client.customerId}/googleAds:search`,
      { query },
    );
    const results = Array.isArray(payload.results)
      ? payload.results as Record<string, unknown>[]
      : [];
    const row = results[0] ?? {};
    if (level === "ad") {
      const adGroupAd = (row.adGroupAd ?? {}) as Record<string, unknown>;
      const policy = (adGroupAd.policySummary ?? {}) as Record<string, unknown>;
      const approvalStatus = typeof policy.approvalStatus === "string"
        ? policy.approvalStatus
        : null;
      const reviewStatus = typeof policy.reviewStatus === "string"
        ? policy.reviewStatus
        : null;
      const topicEntries = Array.isArray(policy.policyTopicEntries)
        ? policy.policyTopicEntries
        : null;
      return {
        status: engineStatusFromGoogle(adGroupAd.status),
        // OD-8 as widened by G-3: approval_status is the delivery gate.
        effectiveStatus: approvalStatus,
        issuesInfo: topicEntries,
        adReviewFeedback: approvalStatus || reviewStatus
          ? { approval_status: approvalStatus, review_status: reviewStatus }
          : null,
      };
    }
    const entity = (level === "campaign" ? row.campaign : row.adGroup) as
      | Record<string, unknown>
      | undefined;
    const rawStatus = entity?.status ?? null;
    return {
      status: engineStatusFromGoogle(rawStatus),
      effectiveStatus: typeof rawStatus === "string" ? rawStatus : null,
      issuesInfo: null,
      adReviewFeedback: null,
    };
  },

  setBudget: async (conn, level, externalId, cents) => {
    if (level !== "campaign") {
      throw new AdApiError({
        platform: "google",
        code: "unsupported_level",
        message:
          "Google budgets live on the campaign budget resource — ad groups carry bids, not budgets.",
      });
    }
    const client = await resolveGoogleClient(conn);
    assertGoogleExternalId("campaign", externalId);
    // Resolve the campaign's budget resource, then mutate its amountMicros.
    const { payload } = await googleAdsRequest(
      client,
      `customers/${client.customerId}/googleAds:search`,
      {
        query:
          `SELECT campaign.id, campaign.campaign_budget FROM campaign WHERE campaign.id = ${externalId}`,
      },
    );
    const results = Array.isArray(payload.results)
      ? payload.results as Record<string, unknown>[]
      : [];
    const campaign = (results[0]?.campaign ?? {}) as Record<string, unknown>;
    const budgetResourceName = typeof campaign.campaignBudget === "string"
      ? campaign.campaignBudget
      : "";
    if (!budgetResourceName) {
      throw new AdApiError({
        platform: "google",
        code: "budget_not_found",
        message: `No campaign budget resolved for campaign ${externalId}.`,
      });
    }
    await googleAdsRequest(client, `customers/${client.customerId}/campaignBudgets:mutate`, {
      operations: [
        {
          update: {
            resourceName: budgetResourceName,
            // THE one cents→micros conversion point for Google (A1.1(1)).
            amountMicros: String(centsToPlatformBudget("google", cents)),
          },
          updateMask: "amountMicros",
        },
      ],
    });
  },

  // rollbackCampaign / rollbackCreative are deliberately ABSENT (A1.1(4)):
  // `partialFailure:false` makes the create natively atomic — there is never a
  // provider-side partial chain to compensate, and REMOVED is permanent, so no
  // delete path is exposed at all.
};
