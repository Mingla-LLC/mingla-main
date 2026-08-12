/**
 * snapchat.ts — the Snapchat Marketing API ChannelAdapter (ISSUE-867 WP5 —
 * SNAPCHAT lane; the Google half shipped as WP2 in google.ts).
 *
 * SPEC: SPEC_ISSUE-867_SNAPCHAT_GOOGLE_CHANNELS.md §4.0/§4.3 as corrected by
 * Amendment A1 (A1.1 canonical decisions + the A1.2 SNAP SECTION — BINDING),
 * built against the ISSUE-862 A4.a ChannelAdapter, grounded in PROOF_LOG.md
 * S-P1…S-P5 (live probes with the engine's own credentials, 2026-07-15):
 *   - Base https://adsapi.snapchat.com/v1 (unversioned-in-path v1). There is
 *     NO static access token (S-P1): every call mints a 3600 s token from
 *     SNAPCHAT_REFRESH_TOKEN / SNAPCHAT_CLIENT_ID / SNAPCHAT_CLIENT_SECRET
 *     (module-scope cache, 60 s expiry margin — mirrors google.ts).
 *   - ENVELOPE (S-9, probe-proven): every response wraps
 *     { request_status, request_id, <collection>:[{ sub_request_status,
 *     <entity>:{…} }] } — an HTTP 200 with request_status SUCCESS can still
 *     carry a per-entity sub_request_status FAILURE. BOTH are asserted,
 *     recursively (RT-3).
 *   - S-1: the campaign objective key is objective_v2_properties.
 *     `objective_v2_type` — NEVER `objective_v2`; S-6: the legacy `objective`
 *     key is NEVER sent (deprecated 21 Mar 2025 — the translator's default
 *     would replace our intent).
 *   - S-2: the ad `type` is DERIVED from the creative-type→ad-type map
 *     (WEB_VIEW → REMOTE_WEBPAGE), never hardcoded — SNAP_AD is the
 *     attachment-less trap: it can create fine and pay for impressions that
 *     can never reach the destination page.
 *   - S-3: per-creative-type CTA allowlist validated BEFORE the provider call
 *     (VIEW_MORE does not exist on any type) → 422 invalid_cta. Defaults for
 *     reservation traffic: BUY_TICKETS (ticketed) / BOOK_NOW (bookable).
 *   - S-4: `delivery_constraint` is REQUIRED on the ad squad and DERIVED from
 *     the budget field used (daily → DAILY_BUDGET, lifetime →
 *     LIFETIME_BUDGET) — adapter-owned, never admin input.
 *   - S-7: bid_strategy allowlist is exactly AUTO_BID |
 *     LOWEST_COST_WITH_MAX_BID | TARGET_COST — MIN_ROAS was deprecated
 *     10 Feb 2025 and is rejected; bid_micro (min 10,000) is required for the
 *     cap strategies and omitted for AUTO_BID.
 *   - MONEY (A1.1(1) / GR-01): cents at rest; THE one cents→micro conversion
 *     (×10,000) happens here via centsToPlatformBudget("snapchat"); floors run
 *     in MICRO, AFTER conversion (squad ≥5,000,000 · campaign ≥20,000,000 ·
 *     spend cap ≥20,000,000; RT-5: $5.00/500¢ → 5,000,000 exactly).
 *   - GR-64: lifetime_spend_cap_micro is the early safety rail on the
 *     $15k/day-limit account (S-P3); reducible only if the new cap > 1.1× the
 *     already-spent amount. Every list read follows paging.next_link — reads
 *     silently truncate at page 1 without it.
 *   - GR-39: Snapchat skews 13–34 — demographics default `[{min_age:"18"}]`
 *     when the admin sets none; min_age/max_age are STRINGS ("18", never 18);
 *     genders ∈ MALE|FEMALE.
 *   - GR-54: server-side length validators BEFORE any call — headline ≤34 ·
 *     brand_name ≤32 · name ≤375 · web-view URL https + ≤2048.
 *   - A1.2-8 (S-P4): the Public Profile lookup 403s on our token class — the
 *     profile id is UI-captured TRUSTED CONFIG (SNAPCHAT_PROFILE_ID), checked
 *     for PRESENCE only; the first creative create is the verification.
 *     Absent → fail-close snapchat_profile_missing (424) before any write.
 *   - A1.1(6) (GR-21): default optimization_goal SWIPES; LANDING_PAGE_VIEW and
 *     every PIXEL_* goal are gated on the #865 pixel signal, and a permitted
 *     pixel goal MUST carry pixel_id on the squad.
 *   - GR-38: TWO review vocabularies — the CREATIVE enum (PENDING_REVIEW |
 *     APPROVED) is different from the AD enum (PENDING | APPROVED | REJECTED);
 *     both are persisted, plus review_status_reasons (the only
 *     machine-readable rejection signal) and delivery_status at every level.
 *   - GR-48: campaign delete does NOT cascade ad-account-scoped creatives —
 *     rollbackCreative attempts an explicit delete; any failure leaves the id
 *     as residue for the audit row.
 *   - Snap has NO validate-only (S-P4 note): createX with validateOnly:true
 *     REFUSES loudly rather than creating real objects during a validate pass
 *     (the WP2-§10 discovery: WP1's validate block calls createCreative
 *     unconditionally — the edge branch gates it; this throw is the
 *     belt-and-braces).
 *   - Everything is created PAUSED, explicitly, at every level (GR-11) —
 *     activation is only ever the explicit top-down launch.
 *   - QA WP7 F-1 sentinel class (cross-adapter, encoded from the start): any
 *     persisted external_account_id that fails the Snap ad-account id shape
 *     (UUID v4, lowercase) is ABSENCE, never a pin — a failed pre-secrets
 *     connect must never brick the reconnect path.
 *
 * SECURITY (SPEC §6 SC-SEC-1): the refresh token + client secret live ONLY in
 * Supabase Edge Function Secrets (Deno.env). The minted access token exists
 * only in edge memory (module-scope cache) and is never persisted, logged, or
 * echoed in any normalized error or response.
 *
 * MEDIA: this adapter UPLOADS NOTHING — media bytes go through the #866
 * creative library (_shared/adCreative.ts uploadToSnap: mint + multipart
 * ≤32 MB + chunked v2 + media READY poll). createCreative CONSUMES an already
 * READY top_snap_media_id and owns only the creative create + its
 * packaging poll.
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
  SNAPCHAT_CTA_MAP,
} from "./adChannelCore.ts";

// ── Env config (NAMES per SPEC §7 — values live in Function Secrets) ──────────

export const SNAPCHAT_API_BASE = "https://adsapi.snapchat.com/v1";
export const SNAPCHAT_TOKEN_URL = "https://accounts.snapchat.com/login/oauth2/access_token";

export type SnapchatLane = "consumer" | "business";

/**
 * Lane-correct env-var NAMES (QA P2-3 house rule, mirrors meta/google/reddit/
 * tiktok): the business lane must never silently fall back to the consumer
 * credential. Only the consumer lane is provisioned today (S-P1…S-P5) — the
 * SNAPCHAT_MINGLABIZ_* names simply fail-close until seeded.
 */
function laneEnvName(base: string, lane: SnapchatLane): string {
  return lane === "business" ? base.replace(/^SNAPCHAT_/, "SNAPCHAT_MINGLABIZ_") : base;
}

export function snapchatDefaultTokenEnvVar(lane: SnapchatLane): string {
  return laneEnvName("SNAPCHAT_REFRESH_TOKEN", lane);
}

/**
 * QA WP7 F-1 / cross-adapter sentinel class: Snap AD-ACCOUNT ids are UUID v4,
 * lowercase (probe: 6421cc96-dcaf-4a09-a7fa-b24199dcb391). Any persisted
 * value failing this shape (the 'unconfigured' sentinel, junk, uppercase) is
 * treated as ABSENCE, never a pin — deleting this guard re-opens the
 * failed-connect-bricks-reconnect bug class.
 */
export const SNAPCHAT_AD_ACCOUNT_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Snap entity ids (campaign/squad/ad/creative/media) are lowercase UUIDs. */
export const SNAPCHAT_ENTITY_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Resolved secret VALUES — in edge memory only, never persisted/echoed. */
export interface SnapchatEnvValues {
  refreshToken: string;
  /** Cache key NAME (lanes must not share a mint). */
  refreshTokenEnvVar: string;
  clientId: string;
  clientSecret: string;
  apiBase: string;
  tokenUrl: string;
  /** Non-secret configured ids (env NAMES: SNAPCHAT_AD_ACCOUNT_ID etc.). */
  envAdAccountId: string;
  envOrgId: string | null;
  /** A1.2-8: TRUSTED CONFIG — unverifiable pre-create (S-P4 403). */
  envProfileId: string | null;
  envPixelId: string | null;
}

/**
 * FAIL-CLOSE (RT-1 / AC-S-7): ANY missing secret throws AdNotConnectedError
 * `snapchat_not_connected` BEFORE any network call — connect/create/launch
 * must return 424 and never proceed to spend on a broken connection. Do NOT
 * soften this throw.
 */
export function resolveSnapchatEnvConfig(
  conn?: Pick<AdConnectionRow, "token_env_var"> | null,
  lane: SnapchatLane = "consumer",
): SnapchatEnvValues {
  const refreshTokenEnvVar = (conn?.token_env_var ?? snapchatDefaultTokenEnvVar(lane)).trim() ||
    snapchatDefaultTokenEnvVar(lane);
  const read = (name: string): string => (Deno.env.get(name) ?? "").trim();
  const refreshToken = read(refreshTokenEnvVar);
  const clientId = read(laneEnvName("SNAPCHAT_CLIENT_ID", lane));
  const clientSecret = read(laneEnvName("SNAPCHAT_CLIENT_SECRET", lane));
  if (!refreshToken || !clientId || !clientSecret) {
    throw new AdNotConnectedError("snapchat", "snapchat_not_connected");
  }
  const readOptional = (name: string): string | null => read(laneEnvName(name, lane)) || null;
  return {
    refreshToken,
    refreshTokenEnvVar,
    clientId,
    clientSecret,
    apiBase: read("SNAPCHAT_API_BASE") || SNAPCHAT_API_BASE,
    tokenUrl: read("SNAPCHAT_TOKEN_URL") || SNAPCHAT_TOKEN_URL,
    envAdAccountId: read(laneEnvName("SNAPCHAT_AD_ACCOUNT_ID", lane)).toLowerCase(),
    envOrgId: readOptional("SNAPCHAT_ORG_ID"),
    envProfileId: readOptional("SNAPCHAT_PROFILE_ID"),
    envPixelId: readOptional("SNAPCHAT_PIXEL_ID"),
  };
}

// ── Token mint + module-scope cache (SPEC §4.3 snapAuth, folded per WP2) ──────

interface MintedToken {
  token: string;
  expiresAtMs: number;
}

/** Keyed by refresh-token env-var NAME so lanes never share a minted token. */
const snapchatTokenCache = new Map<string, MintedToken>();

/** Test hook — clears the in-memory mint cache (never exposes a token). */
export function resetSnapchatTokenCacheForTests(): void {
  snapchatTokenCache.clear();
}

/** Safety margin before expiry (SPEC §4.3: expiry = now + expires_in − 60 s). */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

/**
 * Mints (or reuses) the 60-minute access token from the refresh grant
 * (grant_type=refresh_token — expires_in 3600 proven live, S-P1). FAIL-CLOSE:
 * a mint failure (network, 4xx revoked/expired refresh token) throws
 * AdNotConnectedError — never proceed toward spend with a stale/absent token
 * (AC-S-8). The refresh token and minted access token are never logged,
 * returned to callers, or persisted.
 */
export async function mintSnapchatAccessToken(env: SnapchatEnvValues): Promise<string> {
  const cached = snapchatTokenCache.get(env.refreshTokenEnvVar);
  if (cached && cached.expiresAtMs > Date.now()) return cached.token;

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("client_id", env.clientId);
  form.set("client_secret", env.clientSecret);
  form.set("refresh_token", env.refreshToken);

  let response: Response;
  try {
    response = await fetch(env.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch {
    // Network failure at mint — fail-close, no detail that could carry a secret.
    throw new AdNotConnectedError("snapchat", "snapchat_not_connected");
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
    throw new AdNotConnectedError("snapchat", "snapchat_not_connected");
  }
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  snapchatTokenCache.set(env.refreshTokenEnvVar, {
    token: accessToken,
    expiresAtMs: Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS,
  });
  return accessToken;
}

export interface SnapchatClient extends AuthedClient {
  platform: "snapchat";
  accessToken: string;
  adAccountId: string;
  organizationId: string | null;
  /** A1.2-8 trusted config — presence-checked, verified at first creative create. */
  profileId: string | null;
  pixelId: string | null;
  apiBase: string;
}

/**
 * Resolves secrets + the ad-account id, lane-correct, and mints the access
 * token (fail-close). The account id comes from the persisted connection
 * (external_account_id, SHAPE-GUARDED — F-1 sentinel class) or the lane's
 * SNAPCHAT_AD_ACCOUNT_ID secret; when BOTH exist they must MATCH.
 */
export async function resolveSnapchatClient(
  conn?: AdConnectionRow | null,
  lane?: SnapchatLane,
): Promise<SnapchatClient> {
  const effectiveLane: SnapchatLane = conn?.lane ?? lane ?? "consumer";
  const env = resolveSnapchatEnvConfig(conn ?? null, effectiveLane);

  if (env.envAdAccountId && !SNAPCHAT_AD_ACCOUNT_ID_REGEX.test(env.envAdAccountId)) {
    // Env misconfig is loud — an operator typo must not read as "absent".
    throw new AdApiError({
      platform: "snapchat",
      code: "snapchat_account_id_invalid",
      message:
        `SNAPCHAT_AD_ACCOUNT_ID does not look like a Snap ad-account id (UUID v4, lowercase) — fix the Function Secret.`,
    });
  }
  let connAccountId = (conn?.external_account_id ?? "").trim();
  // QA WP7 F-1 (cross-adapter sentinel class): a persisted value that is not a
  // real Snap ad-account UUID (the 'unconfigured' sentinel from a failed
  // pre-secrets connect, junk, uppercase) is ABSENCE, never a pin — otherwise
  // the mismatch guard below bricks the lane forever after the secrets land.
  if (!SNAPCHAT_AD_ACCOUNT_ID_REGEX.test(connAccountId)) connAccountId = "";
  if (env.envAdAccountId && connAccountId && env.envAdAccountId !== connAccountId) {
    throw new AdApiError({
      platform: "snapchat",
      code: "account_mismatch",
      message:
        `SNAPCHAT_AD_ACCOUNT_ID (${env.envAdAccountId}) does not match the persisted connection's ad account (${connAccountId}) — refusing to operate on an ambiguous account.`,
    });
  }
  const adAccountId = connAccountId || env.envAdAccountId;
  if (!adAccountId) {
    // No account id anywhere — the channel is not provisioned; fail-close.
    throw new AdNotConnectedError("snapchat", "snapchat_not_connected");
  }

  const connExtra = (conn?.extra ?? {}) as Record<string, unknown>;
  const profileId = (typeof connExtra.profile_id === "string" && connExtra.profile_id.trim()) ||
    env.envProfileId;
  const pixelId = (typeof connExtra.pixel_id === "string" && connExtra.pixel_id.trim()) ||
    env.envPixelId;

  const accessToken = await mintSnapchatAccessToken(env);
  return {
    platform: "snapchat",
    accessToken,
    adAccountId,
    organizationId: conn?.external_org_id ?? env.envOrgId,
    profileId: profileId || null,
    pixelId: pixelId || null,
    apiBase: env.apiBase,
  };
}

// ── Envelope + API wrapper (S-9 double-assert — RT-3) ─────────────────────────

/** Scrubs Bearer-token shapes out of provider text (SC-SEC-1 defense-in-depth). */
export function scrubSnapchatSecrets(text: string, accessToken?: string): string {
  let out = text;
  if (accessToken) out = out.split(accessToken).join("[redacted]");
  // Snap OAuth tokens are opaque; also strip anything that looks like a bearer.
  return out.replace(/Bearer [A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
}

/**
 * THE envelope contract (S-9, probe-proven S-P5): the outer request_status
 * AND every per-entity sub_request_status must be SUCCESS — an HTTP 200 with
 * request_status SUCCESS can still carry a per-entity FAILURE. Walked
 * recursively so a new envelope nesting can never smuggle a failure past this
 * check (RT-3 — reverting this assert fails the envelope tests).
 */
export function assertSnapchatEnvelope(
  payload: Record<string, unknown>,
  context: string,
): void {
  const requestId = typeof payload.request_id === "string" ? payload.request_id : null;
  const requestStatus = payload.request_status;
  if (typeof requestStatus !== "string" || requestStatus.toUpperCase() !== "SUCCESS") {
    throw new AdApiError({
      platform: "snapchat",
      code: "snapchat_request_failed",
      message: `Snap ${context}: request_status=${String(requestStatus)} (${
        scrubSnapchatSecrets(
          JSON.stringify(payload.debug_message ?? payload.display_message ?? ""),
        )
      })`,
      traceId: requestId,
    });
  }
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      for (const child of item) stack.push(child);
      continue;
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const sub = record.sub_request_status;
      if (typeof sub === "string" && sub.toUpperCase() !== "SUCCESS") {
        throw new AdApiError({
          platform: "snapchat",
          code: "snapchat_sub_request_failed",
          message: `Snap ${context}: sub_request_status=${sub} — the 200/SUCCESS envelope carried a per-entity failure (${
            scrubSnapchatSecrets(
              JSON.stringify(record.debug_message ?? record.display_message ?? ""),
            )
          })`,
          traceId: requestId,
        });
      }
      for (const child of Object.values(record)) stack.push(child);
    }
  }
}

/**
 * v1 wrapper: Bearer auth (minted token), JSON bodies, AbortController
 * timeout; on non-2xx throws a normalized AdApiError (token scrubbed); on 2xx
 * asserts the FULL envelope (S-9) before returning. `path` may be an absolute
 * URL — paging.next_link is absolute (GR-64(b)).
 */
export async function snapchatApi(
  client: SnapchatClient,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Record<string, unknown>> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = /^https?:\/\//i.test(path)
    ? path
    : `${client.apiBase}/${path.replace(/^\//, "")}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      signal: controller.signal,
      headers: {
        // Bearer header — never a URL param, so the token can't leak via URLs/logs.
        Authorization: `Bearer ${client.accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    clearTimeout(timer);
    const detail = err instanceof Error ? err.message : String(err);
    throw new AdApiError({
      platform: "snapchat",
      code: "network_error",
      message: scrubSnapchatSecrets(`Snap API request failed: ${detail}`, client.accessToken),
    });
  }
  clearTimeout(timer);

  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const requestId = typeof payload.request_id === "string" ? payload.request_id : null;
    const detail = payload.debug_message ?? payload.display_message ?? payload.error ?? "";
    throw new AdApiError({
      platform: "snapchat",
      code: `http_${response.status}`,
      message: scrubSnapchatSecrets(
        `Snap API ${method} ${path.replace(/^https?:\/\/[^/]+/i, "")}: HTTP ${response.status} ${
          JSON.stringify(detail)
        }`,
        client.accessToken,
      ),
      traceId: requestId,
    });
  }
  assertSnapchatEnvelope(payload, `${method} ${path.replace(/^https?:\/\/[^/]+/i, "")}`);
  return payload;
}

/** First entity of a wrapped collection: payload.campaigns[0].campaign etc. */
export function snapchatEntityFromPayload(
  payload: Record<string, unknown>,
  collection: string,
  entity: string,
): Record<string, unknown> {
  const rows = payload[collection];
  if (Array.isArray(rows) && rows.length > 0) {
    const wrapper = (rows[0] ?? {}) as Record<string, unknown>;
    const inner = wrapper[entity];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return inner as Record<string, unknown>;
    }
  }
  return {};
}

/**
 * GR-64(b): every Snap LIST read follows paging.next_link — without it, reads
 * SILENTLY TRUNCATE at page 1 the moment >1 page exists (a sync would quietly
 * miss campaigns). Bounded to maxPages as a runaway guard.
 */
export async function snapchatCollectPages(
  client: SnapchatClient,
  path: string,
  collection: string,
  opts: { maxPages?: number } = {},
): Promise<Record<string, unknown>[]> {
  const maxPages = opts.maxPages ?? 20;
  const items: Record<string, unknown>[] = [];
  let nextPath: string | null = path;
  for (let page = 0; page < maxPages && nextPath; page++) {
    const payload = await snapchatApi(client, "GET", nextPath);
    const rows = payload[collection];
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row && typeof row === "object") items.push(row as Record<string, unknown>);
      }
    }
    const paging = (payload.paging ?? {}) as Record<string, unknown>;
    nextPath = typeof paging.next_link === "string" && paging.next_link ? paging.next_link : null;
  }
  return items;
}

// ── Validation result shape (mirrors google.ts / tiktok.ts) ───────────────────

export type SnapchatValidation =
  | { ok: true }
  | { ok: false; detail: string; message: string };

function throwValidation(check: SnapchatValidation): void {
  if (!check.ok) {
    throw new AdApiError({ platform: "snapchat", code: check.detail, message: check.message });
  }
}

// ── GR-54 server-side length validators (pre-call 422s) ───────────────────────

export const SNAPCHAT_HEADLINE_MAX_CHARS = 34;
export const SNAPCHAT_BRAND_NAME_MAX_CHARS = 32;
export const SNAPCHAT_NAME_MAX_CHARS = 375;
export const SNAPCHAT_WEB_VIEW_URL_MAX_CHARS = 2048;

/** headline: required on a creative, ≤34 chars (GR-54). */
export function validateSnapchatHeadline(headline: unknown): SnapchatValidation {
  if (typeof headline !== "string" || !headline.trim()) {
    return {
      ok: false,
      detail: "headline_required",
      message: "creative.headline is required for a Snapchat creative.",
    };
  }
  if (headline.trim().length > SNAPCHAT_HEADLINE_MAX_CHARS) {
    return {
      ok: false,
      detail: "headline_too_long",
      message:
        `headline is ${headline.trim().length}/${SNAPCHAT_HEADLINE_MAX_CHARS} characters (Snap hard cap — GR-54).`,
    };
  }
  return { ok: true };
}

/**
 * brand_name: OPTIONAL — omitted, Snap uses the Public Profile's brand name
 * (often the safer, guaranteed-policy-match choice — GR-54 note); present,
 * ≤32 chars.
 */
export function validateSnapchatBrandName(brandName: unknown): SnapchatValidation {
  if (brandName === undefined || brandName === null || brandName === "") return { ok: true };
  if (typeof brandName !== "string") {
    return {
      ok: false,
      detail: "brand_name_invalid",
      message: "creative.brand_name must be a string when present.",
    };
  }
  if (brandName.trim().length > SNAPCHAT_BRAND_NAME_MAX_CHARS) {
    return {
      ok: false,
      detail: "brand_name_too_long",
      message:
        `brand_name is ${brandName.trim().length}/${SNAPCHAT_BRAND_NAME_MAX_CHARS} characters (Snap hard cap — GR-54).`,
    };
  }
  return { ok: true };
}

/** name (campaign/squad/ad/creative): required, ≤375 chars (GR-54). */
export function validateSnapchatName(name: unknown, field: string): SnapchatValidation {
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, detail: "name_required", message: `${field} is required.` };
  }
  if (name.trim().length > SNAPCHAT_NAME_MAX_CHARS) {
    return {
      ok: false,
      detail: "name_too_long",
      message: `${field} is ${name.trim().length}/${SNAPCHAT_NAME_MAX_CHARS} characters (GR-54).`,
    };
  }
  return { ok: true };
}

/**
 * web_view_properties.url: https (SSL required) + ≤2048 chars (GR-54).
 * Destination policy v1 (A1.1(5) / D-P1): this is ALWAYS the canonical
 * dest_url — never the OneLink (AppsFlyer serves ad-review crawlers an
 * app-install interstitial = cloaking-pattern risk).
 */
export function validateSnapchatWebViewUrl(url: unknown): SnapchatValidation {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) {
    return {
      ok: false,
      detail: "invalid_destination_url",
      message: "web_view_properties.url must be an https URL (SSL required — GR-54).",
    };
  }
  if (url.length > SNAPCHAT_WEB_VIEW_URL_MAX_CHARS) {
    return {
      ok: false,
      detail: "invalid_destination_url",
      message: `web_view_properties.url exceeds ${SNAPCHAT_WEB_VIEW_URL_MAX_CHARS} characters (GR-54).`,
    };
  }
  return { ok: true };
}

// ── Top Snap video duration (A1.2-14 — 3–180 s; confirm live) ─────────────────

export const SNAPCHAT_VIDEO_MIN_DURATION_SECONDS = 3;
export const SNAPCHAT_VIDEO_MAX_DURATION_SECONDS = 180;

/**
 * Top Snap video duration 3–180 s → invalid_duration. Snap's media table
 * renders 1800 s — that figure most likely covers LONGFORM_VIDEO, not the Top
 * Snap; confirm live during live-fire (A1.2-14, flagged contradiction #5).
 */
export function validateSnapchatVideoDuration(seconds: number): SnapchatValidation {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return {
      ok: false,
      detail: "invalid_duration",
      message: "Video duration must be a positive number of seconds.",
    };
  }
  if (
    seconds < SNAPCHAT_VIDEO_MIN_DURATION_SECONDS ||
    seconds > SNAPCHAT_VIDEO_MAX_DURATION_SECONDS
  ) {
    return {
      ok: false,
      detail: "invalid_duration",
      message:
        `Top Snap video duration ${seconds}s is outside ${SNAPCHAT_VIDEO_MIN_DURATION_SECONDS}–${SNAPCHAT_VIDEO_MAX_DURATION_SECONDS} s (A1.2-14 — the 1800 s figure in Snap's docs covers LONGFORM_VIDEO, not the Top Snap).`,
    };
  }
  return { ok: true };
}

// ── S-3: per-creative-type CTA allowlist (VIEW_MORE does not exist) ───────────

/**
 * The WEB_VIEW allowlist — the exact 23 values (A1.2 S-3, verbatim). CTA maps
 * are per-platform AND per-creative-type — never a shared normalizer (GR-29).
 */
export const SNAPCHAT_WEB_VIEW_CTA_ALLOWLIST: readonly string[] = [
  "APPLY_NOW",
  "MORE",
  "ORDER_NOW",
  "PLAY",
  "READ",
  "SHOP_NOW",
  "SHOW",
  "SIGN_UP",
  "VIEW",
  "WATCH",
  "DONATE",
  "DOWNLOAD",
  "RESPOND",
  "BUY_TICKETS",
  "SHOWTIMES",
  "BOOK_NOW",
  "GET_NOW",
  "LISTEN",
  "TRY",
  "VOTE",
  "VIEW_MENU",
  "PRE_REGISTER",
  "PLAY_GAME",
] as const;

export const SNAPCHAT_CTA_ALLOWLIST_BY_CREATIVE_TYPE: Record<string, readonly string[]> = {
  WEB_VIEW: SNAPCHAT_WEB_VIEW_CTA_ALLOWLIST,
};

/**
 * S-3: validated BEFORE the provider call → 422 invalid_cta. VIEW_MORE does
 * not exist on ANY creative type. Reservation-traffic defaults: BUY_TICKETS
 * (ticketed) / BOOK_NOW (bookable) — far higher intent than MORE/VIEW.
 */
export function validateSnapchatCta(creativeType: string, cta: unknown): SnapchatValidation {
  // QA-867-WP5 F-2: own-key lookup — a prototype-chain key ("toString",
  // "constructor", …) must fail CLOSED as invalid_cta, never surface the
  // inherited function and TypeError on .includes.
  const allowlist = Object.hasOwn(SNAPCHAT_CTA_ALLOWLIST_BY_CREATIVE_TYPE, creativeType)
    ? SNAPCHAT_CTA_ALLOWLIST_BY_CREATIVE_TYPE[creativeType]
    : undefined;
  if (!allowlist) {
    return {
      ok: false,
      detail: "invalid_cta",
      message:
        `No CTA allowlist is pinned for creative type ${creativeType} — WP5 ships WEB_VIEW only; extend the per-type allowlist before using another type (S-3).`,
    };
  }
  if (typeof cta !== "string" || !allowlist.includes(cta)) {
    return {
      ok: false,
      detail: "invalid_cta",
      message:
        `call_to_action "${String(cta)}" is not valid for a ${creativeType} creative (VIEW_MORE does not exist on any type — S-3). Valid: ${
          allowlist.join(", ")
        }.`,
    };
  }
  return { ok: true };
}

// ── S-2: creative-type → ad-type map (NEVER hardcoded) ────────────────────────

/**
 * S-2 (the worst trap in the body spec): the ad `type` for a WEB_VIEW creative
 * is REMOTE_WEBPAGE — `SNAP_AD` is the attachment-less top snap; best case the
 * create 400s, worst case it SUCCEEDS and pays for impressions that can never
 * reach the destination page. The ad type is ALWAYS derived from this map.
 * Deleting the WEB_VIEW entry is the fails-on-revert target of the S-2 test.
 */
export const SNAPCHAT_CREATIVE_TO_AD_TYPE: Record<string, string> = {
  WEB_VIEW: "REMOTE_WEBPAGE",
  APP_INSTALL: "APP_INSTALL",
  DEEP_LINK: "DEEP_LINK",
  COLLECTION: "COLLECTION",
  LEAD_GENERATION: "LEAD_GENERATION",
  SNAP_AD: "SNAP_AD",
};

export function snapchatAdTypeForCreativeType(creativeType: string): string {
  // QA-867-WP5 F-1: own-key lookup — a prototype-chain key ("toString", …)
  // returned the inherited function (truthy), JSON.stringify then DROPPED the
  // `type` key and the ad went onto the wire TYPELESS. Must fail CLOSED.
  const adType = Object.hasOwn(SNAPCHAT_CREATIVE_TO_AD_TYPE, creativeType)
    ? SNAPCHAT_CREATIVE_TO_AD_TYPE[creativeType]
    : undefined;
  if (!adType) {
    throw new AdApiError({
      platform: "snapchat",
      code: "creative_type_unmapped",
      message:
        `No ad type is mapped for creative type "${creativeType}" — the ad type is derived from the creative-type→ad-type map, never hardcoded (S-2).`,
    });
  }
  return adType;
}

// ── Objectives / goals / bidding enums (S-1 / S-7 / A1.1(6)) ──────────────────

export const SNAPCHAT_OBJECTIVE_V2_TYPES = [
  "AWARENESS_AND_ENGAGEMENT",
  "TRAFFIC",
  "SALES",
  "APP_PROMOTION",
  "LEADS",
] as const;

export const SNAPCHAT_PROMOTION_TYPES = [
  "PROMOTE_PLACES",
  "PROMOTE_SHOWS",
  "APP_INSTALL",
  "APP_REENGAGEMENT",
] as const;

export const SNAPCHAT_OPTIMIZATION_GOALS = [
  "IMPRESSIONS",
  "SWIPES",
  "APP_INSTALLS",
  "VIDEO_VIEWS",
  "VIDEO_VIEWS_15_SEC",
  "USES",
  "STORY_OPENS",
  "PIXEL_PAGE_VIEW",
  "PIXEL_ADD_TO_CART",
  "LANDING_PAGE_VIEW",
  "LEAD_FORM_SUBMISSIONS",
  "PIXEL_PURCHASE",
  "PIXEL_SIGNUP",
  "APP_ADD_TO_CART",
  "APP_PURCHASE",
  "APP_SIGNUP",
  "APP_REENGAGE_OPEN",
  "APP_REENGAGE_PURCHASE",
] as const;

/** A1.1(6)/GR-21: SWIPES until #865's pixel is live and firing. */
export const SNAPCHAT_DEFAULT_OPTIMIZATION_GOAL = "SWIPES";

/**
 * Pixel-measured goals gated on the #865 pixel signal (422
 * pixel_goal_unavailable while the pixel sends nothing — optimizing to an
 * event we don't send = no/erratic delivery, GR-21). A permitted pixel goal
 * MUST carry pixel_id on the squad.
 */
export const SNAPCHAT_PIXEL_GATED_GOALS: readonly string[] = [
  "LANDING_PAGE_VIEW",
  "PIXEL_PAGE_VIEW",
  "PIXEL_ADD_TO_CART",
  "PIXEL_PURCHASE",
  "PIXEL_SIGNUP",
];

/**
 * S-7: the bid-strategy allowlist is EXACTLY these three — MIN_ROAS was
 * deprecated 10 Feb 2025 and is rejected if ever submitted.
 */
export const SNAPCHAT_BID_STRATEGIES = [
  "AUTO_BID",
  "LOWEST_COST_WITH_MAX_BID",
  "TARGET_COST",
] as const;
export const SNAPCHAT_DEFAULT_BID_STRATEGY = "AUTO_BID";
export const SNAPCHAT_MIN_BID_MICRO = 10_000;

export function validateSnapchatObjective(objective: unknown): SnapchatValidation {
  if (
    typeof objective !== "string" ||
    !(SNAPCHAT_OBJECTIVE_V2_TYPES as readonly string[]).includes(objective)
  ) {
    return {
      ok: false,
      detail: "invalid_objective",
      message: `objective_v2_type "${String(objective)}" is invalid — valid: ${
        SNAPCHAT_OBJECTIVE_V2_TYPES.join(" | ")
      } (S-1).`,
    };
  }
  return { ok: true };
}

export function validateSnapchatOptimizationGoal(goal: unknown): SnapchatValidation {
  if (
    typeof goal !== "string" ||
    !(SNAPCHAT_OPTIMIZATION_GOALS as readonly string[]).includes(goal)
  ) {
    return {
      ok: false,
      detail: "invalid_optimization_goal",
      message: `optimization_goal "${String(goal)}" is invalid — valid: ${
        SNAPCHAT_OPTIMIZATION_GOALS.join(" | ")
      }.`,
    };
  }
  return { ok: true };
}

// ── GR-39: demographics — min_age "18" default; STRINGS, not numbers ──────────

export const SNAPCHAT_GENDERS = ["MALE", "FEMALE"] as const;
export const SNAPCHAT_DEFAULT_DEMOGRAPHICS: readonly Record<string, unknown>[] = [
  { min_age: "18" },
];

/**
 * GR-39: min_age/max_age are STRINGS ("18", never 18); genders ∈ MALE|FEMALE
 * (no non-binary value exists). Every entry must carry a string min_age —
 * Snapchat skews 13–34 and an age-unbounded squad serves heavily to minors
 * (a real problem for a venue/reservation product).
 */
export function validateSnapchatDemographics(demographics: unknown): SnapchatValidation {
  if (!Array.isArray(demographics) || demographics.length === 0) {
    return {
      ok: false,
      detail: "demographics_invalid",
      message: "targeting.demographics must be a non-empty array (default [{ min_age: \"18\" }]).",
    };
  }
  for (const entry of demographics) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return {
        ok: false,
        detail: "demographics_invalid",
        message: "Each demographics entry must be an object.",
      };
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.min_age !== "string" || !/^\d+$/.test(record.min_age)) {
      return {
        ok: false,
        detail: "demographics_invalid",
        message:
          `demographics.min_age must be a STRING of digits ("18", never the number 18 — GR-39); got ${
            JSON.stringify(record.min_age)
          }.`,
      };
    }
    if (
      record.max_age !== undefined &&
      (typeof record.max_age !== "string" || !/^\d+$/.test(record.max_age))
    ) {
      return {
        ok: false,
        detail: "demographics_invalid",
        message: "demographics.max_age must be a STRING of digits when present (GR-39).",
      };
    }
    if (record.genders !== undefined) {
      const genders = Array.isArray(record.genders) ? record.genders : [record.genders];
      for (const gender of genders) {
        if (!(SNAPCHAT_GENDERS as readonly string[]).includes(String(gender))) {
          return {
            ok: false,
            detail: "demographics_invalid",
            message: `demographics.genders values must be ${
              SNAPCHAT_GENDERS.join(" | ")
            } (no non-binary value exists — GR-39).`,
          };
        }
      }
    }
  }
  return { ok: true };
}

/** GR-39: defaults demographics to [{ min_age: "18" }] when the admin sets none. */
export function snapchatDemographicsWithDefault(
  demographics?: readonly Record<string, unknown>[] | null,
): Record<string, unknown>[] {
  if (!demographics || demographics.length === 0) {
    return SNAPCHAT_DEFAULT_DEMOGRAPHICS.map((entry) => ({ ...entry }));
  }
  return demographics.map((entry) => ({ ...entry }));
}

// ── Budget floors — MICRO, AFTER conversion (A1.1(1) / AC-S-3) ────────────────

export const SNAPCHAT_MIN_ADSQUAD_BUDGET_MICRO = 5_000_000; // $5.00
export const SNAPCHAT_MIN_CAMPAIGN_BUDGET_MICRO = 20_000_000; // $20.00
export const SNAPCHAT_MIN_SPEND_CAP_MICRO = 20_000_000; // $20.00 (GR-64)

/**
 * Floor checks run in MICRO, after the ×10,000 conversion — never in cents
 * before it (A1.1(1)). RT-5: $5.00 (500¢) → 5,000,000 and $20.00 (2,000¢) →
 * 20,000,000 exactly.
 */
export function validateSnapchatBudgetFloorMicro(input: {
  level: "campaign" | "ad_squad";
  micro: number;
}): SnapchatValidation {
  if (!Number.isFinite(input.micro) || input.micro <= 0) {
    return { ok: false, detail: "budget_invalid", message: "Budget must be a positive amount." };
  }
  const floor = input.level === "campaign"
    ? SNAPCHAT_MIN_CAMPAIGN_BUDGET_MICRO
    : SNAPCHAT_MIN_ADSQUAD_BUDGET_MICRO;
  if (input.micro < floor) {
    return {
      ok: false,
      detail: "budget_below_minimum",
      message: input.level === "campaign"
        ? `Campaign budget ${input.micro} micro is below Snap's ${floor} micro ($20.00) campaign floor (checked in micro AFTER conversion — AC-S-3).`
        : `Ad-squad budget ${input.micro} micro is below Snap's ${floor} micro ($5.00) squad floor (checked in micro AFTER conversion — AC-S-3).`,
    };
  }
  return { ok: true };
}

/**
 * GR-64(a): the lifetime spend cap is reducible only if the new cap is
 * GREATER than 1.1× the amount already spent. spentMicro comes from the
 * platform stats read when available; unknown spend (null) blocks a
 * REDUCTION fail-close (never guess against a live spend counter).
 */
export function validateSnapchatSpendCapReduction(input: {
  currentCapMicro: number;
  newCapMicro: number;
  spentMicro: number | null;
}): SnapchatValidation {
  if (input.newCapMicro >= input.currentCapMicro) return { ok: true }; // not a reduction
  if (input.newCapMicro < SNAPCHAT_MIN_SPEND_CAP_MICRO) {
    return {
      ok: false,
      detail: "spend_cap_below_minimum",
      message:
        `lifetime_spend_cap_micro ${input.newCapMicro} is below Snap's ${SNAPCHAT_MIN_SPEND_CAP_MICRO} micro ($20.00) minimum (GR-64).`,
    };
  }
  if (input.spentMicro === null) {
    return {
      ok: false,
      detail: "spend_cap_reduction_blocked",
      message:
        "Cannot verify the already-spent amount — a spend-cap REDUCTION requires new cap > 1.1× spent (GR-64); refusing to reduce blind.",
    };
  }
  if (input.newCapMicro <= input.spentMicro * 1.1) {
    return {
      ok: false,
      detail: "spend_cap_reduction_blocked",
      message:
        `lifetime_spend_cap_micro ${input.newCapMicro} must be greater than 1.1× the already-spent ${input.spentMicro} micro (GR-64).`,
    };
  }
  return { ok: true };
}

// ── Pure body builders (the exact wire shapes; ALL PAUSED — unit-tested) ──────

export interface SnapchatCampaignSpec {
  name: string;
  /** objective_v2_type value (S-1) — 'TRAFFIC' for the engine's traffic lane. */
  objective: string;
  /** Minor units (cents). Present ⇒ CBO (budget on the campaign, ≥$20/day). */
  dailyBudgetCents?: number;
  /** GR-64 safety rail (cents → micro ×10,000; provider min $20.00). */
  spendCapCents?: number;
  /** GR-65: PROMOTE_PLACES is evaluated during live-fire — never a default. */
  promotionType?: string;
  startTime?: string;
  endTime?: string;
  buyModel?: string;
  /** Injectable clock for tests. */
  nowMs?: number;
}

export function buildSnapchatCampaignBody(
  adAccountId: string,
  spec: SnapchatCampaignSpec,
): Record<string, unknown> {
  throwValidation(validateSnapchatName(spec.name, "campaign name"));
  throwValidation(validateSnapchatObjective(spec.objective));
  if (
    spec.promotionType !== undefined &&
    !(SNAPCHAT_PROMOTION_TYPES as readonly string[]).includes(spec.promotionType)
  ) {
    throw new AdApiError({
      platform: "snapchat",
      code: "invalid_promotion_type",
      message: `promotion_type "${spec.promotionType}" is invalid — valid: ${
        SNAPCHAT_PROMOTION_TYPES.join(" | ")
      }.`,
    });
  }

  const body: Record<string, unknown> = {
    name: spec.name,
    ad_account_id: adAccountId,
    // GR-11: PAUSED explicitly at every level on every channel — activation is
    // only ever the explicit top-down launch. Deleting this line is the
    // fails-on-revert target of the PAUSED fuzz.
    status: "PAUSED",
    start_time: spec.startTime ?? new Date(spec.nowMs ?? Date.now()).toISOString(),
    buy_model: spec.buyModel ?? "AUCTION",
    // S-1: the key is objective_v2_type — objective_v2 400s. S-6: the legacy
    // top-level `objective` key is NEVER present in this body (deprecated
    // 21 Mar 2025; sending it invites the translator's default).
    objective_v2_properties: {
      objective_v2_type: spec.objective,
      ...(spec.promotionType ? { promotion_type: spec.promotionType } : {}),
    },
  };
  if (spec.endTime) body.end_time = spec.endTime;

  if (typeof spec.dailyBudgetCents === "number" && spec.dailyBudgetCents > 0) {
    // CBO — THE one cents→micro conversion (A1.1(1)); floor AFTER conversion.
    const micro = centsToPlatformBudget("snapchat", spec.dailyBudgetCents);
    throwValidation(validateSnapchatBudgetFloorMicro({ level: "campaign", micro }));
    body.daily_budget_micro = micro;
  }
  if (typeof spec.spendCapCents === "number" && spec.spendCapCents > 0) {
    // GR-64(a): the early safety rail on the $15k/day-limit account (S-P3).
    const capMicro = centsToPlatformBudget("snapchat", spec.spendCapCents);
    if (capMicro < SNAPCHAT_MIN_SPEND_CAP_MICRO) {
      throw new AdApiError({
        platform: "snapchat",
        code: "spend_cap_below_minimum",
        message:
          `lifetime_spend_cap_micro ${capMicro} is below Snap's ${SNAPCHAT_MIN_SPEND_CAP_MICRO} micro ($20.00) minimum (GR-64).`,
      });
    }
    body.lifetime_spend_cap_micro = capMicro;
  }
  return body;
}

// ── ISSUE-992 (3a): city circles + interest segments ─────────────────────────
//
// Snap geo circles nest UNDER a country_code inside targeting.geos; each circle
// is a geocoded point + radius (create-time server geocode — coords never touch
// the browser). SCLS interest segments ride as targeting.interests. Both are
// SUSPECTED (documented Snap Marketing API contract) — Snap has NO validate-only
// (refuseSnapchatValidateOnly), so the exact geos/interests nesting must be
// proven with a PAUSED create + teardown at BUILD.
//
// [SUSPECTED — Snap Marketing API] circle radius unit token.
export const SNAPCHAT_CIRCLE_UNITS = ["mile", "kilometer"] as const;
export type SnapchatCircleUnit = (typeof SNAPCHAT_CIRCLE_UNITS)[number];

/** A geocoded city circle — lat/lng resolved server-side (never fabricated). */
export interface SnapchatCircleGeo {
  /** ISO country the city sits in (lowercased on the wire). */
  country_code: string;
  latitude: number;
  longitude: number;
  radius: number;
  /** "mile" | "kilometer" — SUSPECTED enum, probe-confirmed at BUILD. */
  unit: string;
}

/**
 * Build the circle-geo array grouped by country_code (each country_code gets
 * ONE geo entry carrying all its circles). When circles are present the picked
 * countries are NOT added as separate country-only geos (that union would make
 * the circle inert — the Meta city-drops-country precedent). Empty circles ⇒
 * null so the caller keeps the existing country-only geos. Never fabricates a
 * coordinate — index.ts drops circles whose geocode returned null before here.
 */
export function buildSnapchatCircleGeos(
  circles: readonly SnapchatCircleGeo[] | null | undefined,
): Record<string, unknown>[] | null {
  if (!Array.isArray(circles) || circles.length === 0) return null;
  const byCountry = new Map<string, Record<string, unknown>[]>();
  for (const c of circles) {
    if (
      !Number.isFinite(c?.latitude) || !Number.isFinite(c?.longitude) ||
      !Number.isFinite(c?.radius) || c.radius <= 0
    ) continue;
    const cc = String(c.country_code ?? "").trim().toLowerCase();
    if (!cc) continue;
    const unit = (SNAPCHAT_CIRCLE_UNITS as readonly string[]).includes(String(c.unit))
      ? String(c.unit)
      : "mile";
    const list = byCountry.get(cc) ?? [];
    list.push({ latitude: c.latitude, longitude: c.longitude, radius: c.radius, unit });
    byCountry.set(cc, list);
  }
  if (byCountry.size === 0) return null;
  return [...byCountry.entries()].map(([country_code, circleList]) => ({
    country_code,
    circles: circleList,
  }));
}

export interface SnapchatAdSquadSpec {
  name: string;
  optimizationGoal: string;
  /** ISO country codes — Snap accepts them directly ({geos:[{country_code}]}). */
  countries: string[];
  /** GR-39: defaults to [{ min_age: "18" }] when absent. */
  demographics?: Record<string, unknown>[];
  /** ISSUE-992 (3a): geocoded city circles → circle geos under targeting.geos. */
  circles?: SnapchatCircleGeo[];
  /** ISSUE-992 (3a): SCLS interest-segment category ids → targeting.interests. */
  interestCategoryIds?: string[];
  /** Minor units (cents). ABO squad budget; OMITTED under CBO. */
  budgetCents?: number;
  budgetMode?: "daily" | "lifetime";
  /** S-7 allowlist; default AUTO_BID. */
  bidStrategy?: string;
  /** Minor units (cents); required for LOWEST_COST_WITH_MAX_BID / TARGET_COST. */
  bidCents?: number;
  /** REQUIRED when a pixel-gated goal is permitted (A1.1(6)). */
  pixelId?: string | null;
  startTime?: string;
  /** REQUIRED for a lifetime budget. */
  endTime?: string;
  nowMs?: number;
}

export function buildSnapchatAdSquadBody(
  campaignExternalId: string,
  spec: SnapchatAdSquadSpec,
): Record<string, unknown> {
  throwValidation(validateSnapchatName(spec.name, "ad squad name"));
  throwValidation(validateSnapchatOptimizationGoal(spec.optimizationGoal));
  if (!Array.isArray(spec.countries) || spec.countries.length === 0) {
    throw new AdApiError({
      platform: "snapchat",
      code: "targeting_countries_required",
      message: "targeting.countries is required (ISO codes — Snap geos take country_code).",
    });
  }
  const demographics = snapchatDemographicsWithDefault(spec.demographics ?? null);
  throwValidation(validateSnapchatDemographics(demographics));

  // S-7: MIN_ROAS deprecated 10 Feb 2025 — allowlist is exactly the three.
  const bidStrategy = spec.bidStrategy ?? SNAPCHAT_DEFAULT_BID_STRATEGY;
  if (!(SNAPCHAT_BID_STRATEGIES as readonly string[]).includes(bidStrategy)) {
    throw new AdApiError({
      platform: "snapchat",
      code: "bid_strategy_invalid",
      message: `bid_strategy "${bidStrategy}" is invalid — valid: ${
        SNAPCHAT_BID_STRATEGIES.join(" | ")
      } (MIN_ROAS was deprecated 10 Feb 2025 — S-7).`,
    });
  }

  // A1.1(6): a pixel-gated goal REQUIRES pixel_id on the squad — the caller
  // (edge fn) owns the pixel_installed gate; this is the wire-shape guard.
  const pixelGated = SNAPCHAT_PIXEL_GATED_GOALS.includes(spec.optimizationGoal);
  if (pixelGated && (!spec.pixelId || !spec.pixelId.trim())) {
    throw new AdApiError({
      platform: "snapchat",
      code: "pixel_goal_unavailable",
      message:
        `optimization_goal ${spec.optimizationGoal} is pixel-measured and requires pixel_id on the ad squad (A1.1(6)); default SWIPES until #865's pixel fires.`,
    });
  }

  const budgetMode = spec.budgetMode ?? "daily";
  if (budgetMode === "lifetime" && !spec.endTime) {
    throw new AdApiError({
      platform: "snapchat",
      code: "end_time_required",
      message: "A lifetime ad-squad budget requires end_time.",
    });
  }

  // ISSUE-992 (3a): circle geos REPLACE the country-only geos when present
  // (keeps the radius laser — a country ∪ circle union makes the circle inert);
  // fall back to country-only when no circles geocoded. [SUSPECTED nesting.]
  const circleGeos = buildSnapchatCircleGeos(spec.circles);
  const geos = circleGeos ??
    // Probe shape (§4.0): lowercase ISO country codes.
    spec.countries.map((code) => ({ country_code: code.trim().toLowerCase() }));

  const targeting: Record<string, unknown> = {
    geos,
    demographics,
  };
  // ISSUE-992 (3a): SCLS interest segments — targeting.interests:[{category_id}].
  // DLXS (Oracle) is legacy; SCLS only for MVP. [SUSPECTED shape — probe.]
  const interestCategoryIds = (spec.interestCategoryIds ?? [])
    .map((id) => String(id).trim())
    .filter(Boolean);
  if (interestCategoryIds.length > 0) {
    targeting.interests = [{ category_id: interestCategoryIds }];
  }

  const body: Record<string, unknown> = {
    name: spec.name,
    campaign_id: campaignExternalId,
    type: "SNAP_ADS",
    targeting,
    billing_event: "IMPRESSION",
    bid_strategy: bidStrategy,
    optimization_goal: spec.optimizationGoal,
    placement_v2: { config: "AUTOMATIC" },
    // GR-11 / fails-on-revert target: PAUSED explicitly.
    status: "PAUSED",
    start_time: spec.startTime ?? new Date(spec.nowMs ?? Date.now()).toISOString(),
  };
  if (spec.endTime) body.end_time = spec.endTime;
  if (pixelGated && spec.pixelId) body.pixel_id = spec.pixelId;

  // ── Budget (ABO) + S-4 delivery_constraint (REQUIRED; adapter-derived). ─────
  if (typeof spec.budgetCents === "number" && spec.budgetCents > 0) {
    // THE one cents→micro conversion (A1.1(1)); floor in micro AFTER it.
    const micro = centsToPlatformBudget("snapchat", spec.budgetCents);
    throwValidation(validateSnapchatBudgetFloorMicro({ level: "ad_squad", micro }));
    if (budgetMode === "lifetime") {
      body.lifetime_budget_micro = micro;
      // S-4: derived from the budget field used — never admin input.
      body.delivery_constraint = "LIFETIME_BUDGET";
    } else {
      body.daily_budget_micro = micro;
      body.delivery_constraint = "DAILY_BUDGET";
    }
  } else {
    // CBO — the campaign owns the (daily) budget; the squad still REQUIRES a
    // delivery_constraint (S-4) and it must match the budget cadence in use.
    body.delivery_constraint = "DAILY_BUDGET";
  }

  // ── Bidding (S-7): bid_micro required for the cap strategies, min 10,000;
  //    OMITTED for AUTO_BID. ──────────────────────────────────────────────────
  if (bidStrategy === "LOWEST_COST_WITH_MAX_BID" || bidStrategy === "TARGET_COST") {
    if (typeof spec.bidCents !== "number" || spec.bidCents <= 0) {
      throw new AdApiError({
        platform: "snapchat",
        code: "bid_micro_required",
        message: `bid_strategy ${bidStrategy} requires bid_cents (converted ×10,000 to bid_micro).`,
      });
    }
    const bidMicro = centsToPlatformBudget("snapchat", spec.bidCents);
    if (bidMicro < SNAPCHAT_MIN_BID_MICRO) {
      throw new AdApiError({
        platform: "snapchat",
        code: "bid_micro_below_minimum",
        message: `bid_micro ${bidMicro} is below Snap's ${SNAPCHAT_MIN_BID_MICRO} micro minimum (S-7).`,
      });
    }
    body.bid_micro = bidMicro;
  }
  return body;
}

export interface SnapchatCreativeSpec {
  name: string;
  /** WP5 pins WEB_VIEW; the type still drives the CTA allowlist + ad-type map. */
  creativeType?: string;
  /** An already-READY media id (#866 uploadToSnap output). */
  topSnapMediaId: string;
  headline: string;
  brandName?: string;
  /** A1.2-8 trusted config — the first creative create is its verification. */
  profileId: string;
  /** Destination policy v1: the canonical dest_url — NEVER the OneLink. */
  webViewUrl: string;
  callToAction?: string;
  shareable?: boolean;
}

export function buildSnapchatCreativeBody(
  adAccountId: string,
  spec: SnapchatCreativeSpec,
): Record<string, unknown> {
  const creativeType = spec.creativeType ?? "WEB_VIEW";
  throwValidation(validateSnapchatName(spec.name, "creative name"));
  throwValidation(validateSnapchatHeadline(spec.headline));
  throwValidation(validateSnapchatBrandName(spec.brandName));
  throwValidation(validateSnapchatWebViewUrl(spec.webViewUrl));
  const cta = spec.callToAction ?? SNAPCHAT_CTA_MAP.default;
  throwValidation(validateSnapchatCta(creativeType, cta));
  if (!SNAPCHAT_ENTITY_ID_REGEX.test(spec.topSnapMediaId)) {
    throw new AdApiError({
      platform: "snapchat",
      code: "snapchat_media_invalid",
      message:
        `top_snap_media_id "${spec.topSnapMediaId}" is not a Snap media id (lowercase UUID) — upload through the #866 creative library first.`,
    });
  }
  if (!spec.profileId || !spec.profileId.trim()) {
    throw new AdApiError({
      platform: "snapchat",
      code: "snapchat_profile_missing",
      message:
        "profile_properties.profile_id is required on every Snap creative — SNAPCHAT_PROFILE_ID is trusted config (the API lookup 403s on our token class, S-P4).",
    });
  }

  return {
    name: spec.name,
    ad_account_id: adAccountId,
    type: creativeType,
    top_snap_media_id: spec.topSnapMediaId,
    headline: spec.headline.trim(),
    ...(spec.brandName && spec.brandName.trim() ? { brand_name: spec.brandName.trim() } : {}),
    // A1.2-8: unverifiable pre-create — this create IS the verification.
    profile_properties: { profile_id: spec.profileId.trim() },
    // Destination policy v1 (A1.1(5) / D-P1): canonical page, never the OneLink.
    web_view_properties: { url: spec.webViewUrl },
    call_to_action: cta,
    shareable: spec.shareable ?? true,
  };
}

export interface SnapchatAdSpec {
  name: string;
  creativeExternalId: string;
  /** Drives the S-2 map — defaults WEB_VIEW (the only WP5 creative type). */
  creativeType?: string;
}

export function buildSnapchatAdBody(
  adSquadExternalId: string,
  spec: SnapchatAdSpec,
): Record<string, unknown> {
  throwValidation(validateSnapchatName(spec.name, "ad name"));
  if (!SNAPCHAT_ENTITY_ID_REGEX.test(spec.creativeExternalId)) {
    throw new AdApiError({
      platform: "snapchat",
      code: "invalid_external_id",
      message: `Snap creative ids are lowercase UUIDs; got "${spec.creativeExternalId}".`,
    });
  }
  return {
    name: spec.name,
    ad_squad_id: adSquadExternalId,
    creative_id: spec.creativeExternalId,
    // S-2: DERIVED from the creative-type→ad-type map — WEB_VIEW ⇒
    // REMOTE_WEBPAGE. Hardcoding SNAP_AD here is the trap that pays for
    // impressions that can never reach the destination page.
    type: snapchatAdTypeForCreativeType(spec.creativeType ?? "WEB_VIEW"),
    // GR-11 / fails-on-revert target: PAUSED explicitly.
    status: "PAUSED",
  };
}

// ── Status semantics + review vocabularies (GR-38) ────────────────────────────

/**
 * THE status writer: AdvertiserStatus can only be PAUSED|ACTIVE and this map
 * can only produce ACTIVE|PAUSED — DELETE exists on Snap but is reachable
 * ONLY through the rollback hooks (mirrors Google's REMOVED-never and
 * TikTok's DELETE-is-rollback-only interface rule).
 */
export function snapchatStatusForAdvertiserStatus(
  status: AdvertiserStatus,
): "ACTIVE" | "PAUSED" {
  switch (status) {
    case "ACTIVE":
      return "ACTIVE";
    case "PAUSED":
      return "PAUSED";
    default: {
      const never: never = status;
      throw new AdApiError({
        platform: "snapchat",
        code: "invalid_status",
        message:
          `Refusing to write status "${String(never)}" — the Snap status writer emits ONLY ACTIVE|PAUSED (DELETE is rollback-only).`,
      });
    }
  }
}

/** Snap advertiser status → engine status (CHECK: PAUSED|ACTIVE|ARCHIVED|DELETED). */
export function engineStatusFromSnapchat(status: unknown): string | null {
  switch (status) {
    case "ACTIVE":
      return "ACTIVE";
    case "PAUSED":
      return "PAUSED";
    default:
      return null;
  }
}

/** Snap returns delivery_status as an ARRAY at every level — text-column form. */
export function snapchatDeliveryStatusText(deliveryStatus: unknown): string | null {
  if (Array.isArray(deliveryStatus) && deliveryStatus.length > 0) {
    return deliveryStatus.map((entry) => String(entry)).join(",");
  }
  if (typeof deliveryStatus === "string" && deliveryStatus) return deliveryStatus;
  return null;
}

/** The AD review enum (GR-38) — distinct from the creative enum. */
export const SNAPCHAT_AD_REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
/** The CREATIVE review enum (GR-38) — do NOT map one onto the other. */
export const SNAPCHAT_CREATIVE_REVIEW_STATUSES = ["PENDING_REVIEW", "APPROVED"] as const;

/**
 * GR-38: BOTH review vocabularies + review_status_reasons (the only
 * machine-readable rejection signal) + delivery_status land in
 * ads.review_detail — the ad enum (PENDING|APPROVED|REJECTED) and the creative
 * enum (PENDING_REVIEW|APPROVED) are different vocabularies; mapping one onto
 * the other loses the distinction.
 */
export function buildSnapchatReviewDetail(input: {
  issuesInfo?: unknown[] | null;
  adReviewFeedback?: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const detail: Record<string, unknown> = {};
  const feedback = input.adReviewFeedback ?? null;
  if (feedback) {
    if (feedback.review_status !== undefined && feedback.review_status !== null) {
      detail.review_status = feedback.review_status;
    }
    if (
      feedback.creative_review_status !== undefined && feedback.creative_review_status !== null
    ) {
      detail.creative_review_status = feedback.creative_review_status;
    }
    if (feedback.delivery_status !== undefined && feedback.delivery_status !== null) {
      detail.delivery_status = feedback.delivery_status;
    }
  }
  if (Array.isArray(input.issuesInfo) && input.issuesInfo.length > 0) {
    // Surfaced VERBATIM — the only machine-readable Snap rejection signal.
    detail.review_status_reasons = input.issuesInfo;
  }
  return Object.keys(detail).length > 0 ? detail : null;
}

/**
 * Launch stays HTTP 200 — review is Snap's delivery state, not our error —
 * with a `warning` keyed off BOTH vocabularies (AC-S-5): the ad enum
 * (PENDING|APPROVED|REJECTED) AND the creative enum (PENDING_REVIEW|APPROVED).
 * Review runs 3–5 business days standard (5–10 restricted), no published SLA;
 * Snap also RE-REVIEWS post-launch and can pause a live campaign (GR-38).
 */
export function snapchatLaunchWarning(
  adReviewStatus: string | null,
  creativeReviewStatus: string | null,
): string | null {
  if (adReviewStatus === "REJECTED") {
    return "Launched, but the ad is REJECTED — delivery is blocked. Check review_status_reasons " +
      "(persisted in the ad's review detail) and edit the creative; editing re-triggers review.";
  }
  if (adReviewStatus === "PENDING" || creativeReviewStatus === "PENDING_REVIEW") {
    return "Launched, but Snap review is pending " +
      `(ad: ${adReviewStatus ?? "unknown"}, creative: ${creativeReviewStatus ?? "unknown"}) — ` +
      "delivery starts after approval (3–5 business days standard, no published SLA). " +
      "Snap also re-reviews post-launch and can pause a live campaign.";
  }
  return null;
}

// ── Entity paths + read/modify/write status updates ───────────────────────────

function assertSnapchatExternalId(level: EntityLevel, externalId: string): void {
  if (!SNAPCHAT_ENTITY_ID_REGEX.test(externalId)) {
    throw new AdApiError({
      platform: "snapchat",
      code: "invalid_external_id",
      message: `Snap ${level} ids are lowercase UUIDs; got "${externalId}".`,
    });
  }
}

const ENTITY_PATHS: Record<EntityLevel, { getPath: string; collection: string; entity: string }> =
  {
    campaign: { getPath: "campaigns", collection: "campaigns", entity: "campaign" },
    ad_set: { getPath: "adsquads", collection: "adsquads", entity: "adsquad" },
    ad: { getPath: "ads", collection: "ads", entity: "ad" },
  };

/**
 * Read-only fields stripped before a PUT — Snap updates are FULL-object PUTs
 * to the parent collection (§4.0), so the entity is read, merged, and written
 * back with the server-owned fields removed.
 */
export const SNAPCHAT_READ_ONLY_ENTITY_FIELDS: readonly string[] = [
  "created_at",
  "updated_at",
  "creation_state",
  "review_status",
  "review_status_reasons",
  "delivery_status",
  "packaging_status",
  // QA-867-WP5 F-4: Snap's read-back echoes the DEPRECATED legacy `objective`
  // key (server-added — we never send it, S-6). Echoing it back on the RMW
  // PUT invites the exact translator behavior S-6 exists to avoid — strip it.
  "objective",
];

export function snapchatStripReadOnlyFields(
  entity: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) {
    if (SNAPCHAT_READ_ONLY_ENTITY_FIELDS.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

async function snapchatReadEntity(
  client: SnapchatClient,
  level: EntityLevel,
  externalId: string,
): Promise<Record<string, unknown>> {
  assertSnapchatExternalId(level, externalId);
  const { getPath, collection, entity } = ENTITY_PATHS[level];
  const payload = await snapchatApi(client, "GET", `${getPath}/${externalId}`);
  const row = snapchatEntityFromPayload(payload, collection, entity);
  if (!row.id) {
    throw new AdApiError({
      platform: "snapchat",
      code: "entity_not_found",
      message: `Snap ${level} ${externalId} was not found.`,
    });
  }
  return row;
}

/** PUT-to-parent-collection path + body for a full-entity update (§4.0). */
export function snapchatUpdateRequestForEntity(
  client: SnapchatClient,
  level: EntityLevel,
  entity: Record<string, unknown>,
): { path: string; body: Record<string, unknown> } {
  if (level === "campaign") {
    const accountId = typeof entity.ad_account_id === "string" && entity.ad_account_id
      ? entity.ad_account_id
      : client.adAccountId;
    return {
      path: `adaccounts/${accountId}/campaigns`,
      body: { campaigns: [entity] },
    };
  }
  if (level === "ad_set") {
    const campaignId = typeof entity.campaign_id === "string" ? entity.campaign_id : "";
    if (!campaignId) {
      throw new AdApiError({
        platform: "snapchat",
        code: "entity_incomplete",
        message: "The ad squad read did not carry campaign_id — cannot build the PUT path.",
      });
    }
    return { path: `campaigns/${campaignId}/adsquads`, body: { adsquads: [entity] } };
  }
  const adSquadId = typeof entity.ad_squad_id === "string" ? entity.ad_squad_id : "";
  if (!adSquadId) {
    throw new AdApiError({
      platform: "snapchat",
      code: "entity_incomplete",
      message: "The ad read did not carry ad_squad_id — cannot build the PUT path.",
    });
  }
  return { path: `adsquads/${adSquadId}/ads`, body: { ads: [entity] } };
}

// ── Creative packaging poll (A1.1(2) — creative → packaging_status SUCCESS) ───

export const SNAPCHAT_PACKAGING_POLL_INTERVAL_MS = 2_000;
export const SNAPCHAT_PACKAGING_POLL_MAX_ATTEMPTS = 30;

/**
 * A1.1(2): after the creative create, poll packaging_status → SUCCESS before
 * an ad references it (an unpackaged creative fails the ad create). Bounded;
 * a terminal FAILED (or timeout) fails close. `sleep` is injectable for tests.
 */
export async function pollSnapchatCreativePackaging(
  client: SnapchatClient,
  creativeExternalId: string,
  opts: {
    intervalMs?: number;
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? SNAPCHAT_PACKAGING_POLL_INTERVAL_MS;
  const maxAttempts = opts.maxAttempts ?? SNAPCHAT_PACKAGING_POLL_MAX_ATTEMPTS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const payload = await snapchatApi(client, "GET", `creatives/${creativeExternalId}`, undefined, {
      fetchImpl: opts.fetchImpl,
    });
    const creative = snapchatEntityFromPayload(payload, "creatives", "creative");
    const packaging = typeof creative.packaging_status === "string"
      ? creative.packaging_status.toUpperCase()
      : "";
    if (packaging === "SUCCESS") return;
    if (packaging === "FAILED") {
      throw new AdApiError({
        platform: "snapchat",
        code: "creative_packaging_failed",
        message:
          `Snap creative ${creativeExternalId} packaging FAILED — the creative cannot serve; check the media (9:16, 1080×1920, audio required for video).`,
      });
    }
    await sleep(intervalMs);
  }
  throw new AdApiError({
    platform: "snapchat",
    code: "creative_packaging_timeout",
    message:
      `Snap creative ${creativeExternalId} never reached packaging_status=SUCCESS — failing close rather than creating an ad on an unpackaged creative (A1.1(2)).`,
  });
}

// ── Connect / preflight probes (SPEC §4.3 connect; S-P2/S-P3/S-P5 shapes) ─────

export interface SnapchatAccountSnapshot {
  id: string;
  name: string | null;
  status: string | null;
  currency: string | null;
  timezone: string | null;
  organizationId: string | null;
  fundingSourceIds: string[];
}

export async function snapchatFetchAdAccount(
  client: SnapchatClient,
): Promise<SnapchatAccountSnapshot> {
  const payload = await snapchatApi(client, "GET", `adaccounts/${client.adAccountId}`);
  const account = snapchatEntityFromPayload(payload, "adaccounts", "adaccount");
  if (!account.id) {
    throw new AdApiError({
      platform: "snapchat",
      code: "account_not_found",
      message:
        `The token cannot read ad account ${client.adAccountId} — check SNAPCHAT_AD_ACCOUNT_ID and the OAuth app's org membership.`,
    });
  }
  return {
    id: String(account.id),
    name: typeof account.name === "string" ? account.name : null,
    status: typeof account.status === "string" ? account.status : null,
    currency: typeof account.currency === "string" ? account.currency : null,
    timezone: typeof account.timezone === "string" ? account.timezone : null,
    organizationId: typeof account.organization_id === "string" ? account.organization_id : null,
    fundingSourceIds: Array.isArray(account.funding_source_ids)
      ? account.funding_source_ids.map((id) => String(id))
      : [],
  };
}

export interface SnapchatFundingSnapshot {
  id: string;
  type: string | null;
  status: string | null;
  dailySpendLimitMicro: number | null;
}

/** Org funding sources — the S-P3 read (ACTIVE VISA, $15k/day). Paged (GR-64(b)). */
export async function snapchatFetchFundingSources(
  client: SnapchatClient,
  organizationId: string,
): Promise<SnapchatFundingSnapshot[]> {
  const rows = await snapchatCollectPages(
    client,
    `organizations/${organizationId}/fundingsources`,
    "fundingsources",
  );
  const sources: SnapchatFundingSnapshot[] = [];
  for (const row of rows) {
    const source = (row.fundingsource ?? {}) as Record<string, unknown>;
    if (!source.id) continue;
    sources.push({
      id: String(source.id),
      type: typeof source.type === "string" ? source.type : null,
      status: typeof source.status === "string" ? source.status : null,
      dailySpendLimitMicro: typeof source.daily_spend_limit_micro === "number"
        ? source.daily_spend_limit_micro
        : null,
    });
  }
  return sources;
}

export interface SnapchatPixelSnapshot {
  id: string;
  name: string | null;
  status: string | null;
}

/** Ad-account pixels — the S-P5 read (af5f8fc4-… ACTIVE). Paged (GR-64(b)). */
export async function snapchatFetchPixels(
  client: SnapchatClient,
): Promise<SnapchatPixelSnapshot[]> {
  const rows = await snapchatCollectPages(
    client,
    `adaccounts/${client.adAccountId}/pixels`,
    "pixels",
  );
  const pixels: SnapchatPixelSnapshot[] = [];
  for (const row of rows) {
    const pixel = (row.pixel ?? {}) as Record<string, unknown>;
    if (!pixel.id) continue;
    pixels.push({
      id: String(pixel.id),
      name: typeof pixel.name === "string" ? pixel.name : null,
      status: typeof pixel.status === "string" ? pixel.status : null,
    });
  }
  return pixels;
}

// ── ISSUE-992 (3a): SCLS interest-segment search (targeting dimensions) ───────

export interface SnapchatInterestSegment {
  /** SCLS category id — the value that rides in targeting.interests[].category_id. */
  id: string;
  name: string;
}

/**
 * Tolerant parser over a /targeting/interests/scls page. Snap wraps each
 * dimension as targeting_dimensions[].scls = { id, name, … }; older/edge
 * shapes surface the object directly. [SUSPECTED shape — probe.]
 */
export function parseSnapchatInterests(
  rows: readonly Record<string, unknown>[],
): SnapchatInterestSegment[] {
  const out: SnapchatInterestSegment[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const scls = (row.scls ?? row.interests ?? row) as Record<string, unknown>;
    const idRaw = scls.id ?? scls.category_id;
    const id = typeof idRaw === "string" ? idRaw : typeof idRaw === "number" ? String(idRaw) : "";
    const name = typeof scls.name === "string" ? scls.name : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

/** Case-insensitive substring filter, prefix-first, capped (mirrors TikTok). Pure. */
export function filterSnapchatInterests(
  interests: readonly SnapchatInterestSegment[],
  opts: { q?: string; limit?: number } = {},
): SnapchatInterestSegment[] {
  const q = (opts.q ?? "").trim().toLowerCase();
  const limit = opts.limit ?? 15;
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
 * ISSUE-992 (3a): fetch Snap Lifestyle Categories (SCLS) and name-filter them
 * (mirrors tiktokFetchInterestCategories — fetch + in-memory filter). DLXS
 * (Oracle) is legacy; SCLS only for MVP. READ-ONLY. Paged (GR-64(b) next_link).
 * [SUSPECTED endpoint/shape — probe with a live read at BUILD.]
 */
export async function snapchatFetchInterests(
  client: SnapchatClient,
  q: string,
  opts: { limit?: number } = {},
): Promise<SnapchatInterestSegment[]> {
  const rows = await snapchatCollectPages(client, "targeting/interests/scls", "targeting_dimensions");
  return filterSnapchatInterests(parseSnapchatInterests(rows), { q, limit: opts.limit });
}

// ── Interface-input adapters (extensions ride the base A4.a shapes) ───────────

/**
 * The generic-interface ad-set input carries the Snap-shaped remainder in
 * `targeting` (exactly how the TikTok/Meta adapters pass platform targeting
 * through). Documented shape — the create-campaign branch constructs it.
 */
export interface SnapchatAdSquadTargetingInput {
  countries?: string[];
  demographics?: Record<string, unknown>[];
  /** ISSUE-992 (3a): geocoded city circles (index.ts geocodes at create time). */
  circles?: SnapchatCircleGeo[];
  /** ISSUE-992 (3a): SCLS interest-segment category ids. */
  interests?: string[];
  budget_mode?: "daily" | "lifetime";
  bid_strategy?: string;
  bid_cents?: number;
  pixel_id?: string;
  start_time?: string;
  end_time?: string;
}

/** The Snap-shaped extensions the interface createCampaign input may carry. */
export interface SnapchatCreateCampaignExtensions {
  spendCapCents?: number;
  promotionType?: string;
  startTime?: string;
  endTime?: string;
}

/** The Snap-shaped extensions the interface createCreative input must carry. */
export interface SnapchatCreateCreativeExtensions {
  topSnapMediaId?: string;
  brandName?: string;
  creativeType?: string;
  shareable?: boolean;
}

/** The Snap-shaped extensions the interface createAd input may carry. */
export interface SnapchatCreateAdExtensions {
  creativeType?: string;
}

/**
 * Snap has NO validate-only (A1.2-8 note / WP2 report §10): WP1's generic
 * validate block calls createCreative unconditionally, which on Snap would
 * create a REAL creative. The edge branch gates that path; this throw is the
 * adapter-level belt-and-braces so no caller can ever "validate" by creating.
 */
function refuseSnapchatValidateOnly(step: string): never {
  throw new AdApiError({
    platform: "snapchat",
    code: "snapchat_no_validate_only",
    message:
      `Snapchat has no validate-only mode — a ${step} call with validateOnly would create a REAL object. The create-campaign validate path must skip the snapchat lane (WP2 §10 discovery).`,
  });
}

// ── The adapter ───────────────────────────────────────────────────────────────

export const snapchatAdapter: ChannelAdapter = {
  platform: "snapchat",

  connect: async (conn: AdConnectionRow): Promise<AuthedClient> => {
    // Fail-close FIRST: unset secrets / a failed mint throw AdNotConnectedError
    // here (RT-1 / AC-S-7) — 424 snapchat_not_connected, zero Marketing-API calls.
    return await resolveSnapchatClient(conn);
  },

  createCampaign: async (conn, input: CreateCampaignInput) => {
    if (input.validateOnly === true) refuseSnapchatValidateOnly("campaign create");
    // Fail-close FIRST (RT-1): the mint resolves BEFORE input validation, so a
    // broken connection always surfaces 424 snapchat_not_connected.
    const client = await resolveSnapchatClient(conn);
    const extensions = input as CreateCampaignInput & SnapchatCreateCampaignExtensions;
    const body = buildSnapchatCampaignBody(client.adAccountId, {
      name: input.name,
      objective: input.objective,
      dailyBudgetCents: input.dailyBudgetCents,
      spendCapCents: extensions.spendCapCents,
      promotionType: extensions.promotionType,
      startTime: extensions.startTime,
      endTime: extensions.endTime,
    });
    const payload = await snapchatApi(
      client,
      "POST",
      `adaccounts/${client.adAccountId}/campaigns`,
      { campaigns: [body] },
    );
    const campaign = snapchatEntityFromPayload(payload, "campaigns", "campaign");
    const externalId = typeof campaign.id === "string" ? campaign.id : "";
    if (!externalId) {
      throw new AdApiError({
        platform: "snapchat",
        code: "create_no_id",
        message: "Snap campaign create returned SUCCESS but no campaign id — refusing to persist.",
      });
    }
    return { externalId, status: "PAUSED" };
  },

  createAdSet: async (conn, campaignExternalId, input: CreateAdSetInput) => {
    if (input.validateOnly === true) refuseSnapchatValidateOnly("ad-squad create");
    const client = await resolveSnapchatClient(conn); // fail-close first
    assertSnapchatExternalId("campaign", campaignExternalId);
    const t = (input.targeting ?? {}) as SnapchatAdSquadTargetingInput;
    const body = buildSnapchatAdSquadBody(campaignExternalId, {
      name: input.name,
      optimizationGoal: input.optimizationGoal,
      countries: t.countries ?? [],
      demographics: t.demographics,
      // ISSUE-992 (3a): circles are geocoded server-side in the create fn; SCLS
      // interest ids ride through to targeting.interests.
      circles: t.circles,
      interestCategoryIds: t.interests,
      budgetCents: input.budgetCents,
      budgetMode: t.budget_mode,
      bidStrategy: t.bid_strategy,
      bidCents: t.bid_cents,
      pixelId: t.pixel_id ?? client.pixelId,
      startTime: t.start_time,
      endTime: t.end_time,
    });
    const payload = await snapchatApi(
      client,
      "POST",
      `campaigns/${campaignExternalId}/adsquads`,
      { adsquads: [body] },
    );
    const adsquad = snapchatEntityFromPayload(payload, "adsquads", "adsquad");
    const externalId = typeof adsquad.id === "string" ? adsquad.id : "";
    if (!externalId) {
      throw new AdApiError({
        platform: "snapchat",
        code: "create_no_id",
        message: "Snap ad-squad create returned SUCCESS but no id — refusing to persist.",
      });
    }
    return { externalId };
  },

  /**
   * Consumes an already-READY top_snap_media_id (#866 uploadToSnap owns the
   * media bytes/READY poll); creates the creative, then polls
   * packaging_status → SUCCESS (A1.1(2)) so the ad create never references an
   * unpackaged creative.
   */
  createCreative: async (conn, input: CreateCreativeInput) => {
    if (input.validateOnly === true) refuseSnapchatValidateOnly("creative create");
    const client = await resolveSnapchatClient(conn); // fail-close first
    const extensions = input as CreateCreativeInput & SnapchatCreateCreativeExtensions;
    const topSnapMediaId = extensions.topSnapMediaId ?? "";
    if (!topSnapMediaId) {
      throw new AdApiError({
        platform: "snapchat",
        code: "snapchat_media_required",
        message:
          "A Snap creative requires an uploaded top_snap_media_id — upload through the #866 creative library (uploadToSnap) first; this adapter never uploads bytes.",
      });
    }
    if (!client.profileId) {
      // A1.2-8 / AC-S-11 defense-in-depth (the edge branch pre-flights this).
      throw new AdNotConnectedError("snapchat", "snapchat_profile_missing");
    }
    const body = buildSnapchatCreativeBody(client.adAccountId, {
      name: input.campaignName ? `${input.campaignName} — creative` : input.adName ?? "creative",
      creativeType: extensions.creativeType,
      topSnapMediaId,
      headline: input.headline ?? "",
      brandName: extensions.brandName,
      profileId: client.profileId,
      webViewUrl: input.destUrl,
      callToAction: input.callToActionType,
    });
    const payload = await snapchatApi(
      client,
      "POST",
      `adaccounts/${client.adAccountId}/creatives`,
      { creatives: [body] },
    );
    const creative = snapchatEntityFromPayload(payload, "creatives", "creative");
    const externalCreativeId = typeof creative.id === "string" ? creative.id : "";
    if (!externalCreativeId) {
      throw new AdApiError({
        platform: "snapchat",
        code: "create_no_id",
        message: "Snap creative create returned SUCCESS but no id — refusing to persist.",
      });
    }
    // A1.1(2): the packaging poll — an unpackaged creative fails the ad create.
    await pollSnapchatCreativePackaging(client, externalCreativeId);
    return { externalCreativeId };
  },

  createAd: async (conn, adSetExternalId, input: CreateAdInput) => {
    if (input.validateOnly === true) refuseSnapchatValidateOnly("ad create");
    const client = await resolveSnapchatClient(conn); // fail-close first
    assertSnapchatExternalId("ad_set", adSetExternalId);
    const extensions = input as CreateAdInput & SnapchatCreateAdExtensions;
    const body = buildSnapchatAdBody(adSetExternalId, {
      name: input.name,
      creativeExternalId: input.externalCreativeId,
      creativeType: extensions.creativeType,
    });
    const payload = await snapchatApi(client, "POST", `adsquads/${adSetExternalId}/ads`, {
      ads: [body],
    });
    const ad = snapchatEntityFromPayload(payload, "ads", "ad");
    const externalId = typeof ad.id === "string" ? ad.id : "";
    if (!externalId) {
      throw new AdApiError({
        platform: "snapchat",
        code: "create_no_id",
        message: "Snap ad create returned SUCCESS but no id — refusing to persist.",
      });
    }
    return {
      externalId,
      reviewStatus: typeof ad.review_status === "string" ? ad.review_status : null,
    };
  },

  /**
   * §4.0 update contract: PUT to the PARENT-collection endpoint with the
   * entity carrying its id. Snap PUTs are full-object updates, so the entity
   * is READ first, the status merged, and the server-owned fields stripped —
   * a bare {id,status} PUT risks wiping sibling fields.
   */
  setStatus: async (conn, level, externalId, status: AdvertiserStatus) => {
    const client = await resolveSnapchatClient(conn); // fail-close first
    const entity = await snapchatReadEntity(client, level, externalId);
    const updated = snapchatStripReadOnlyFields(entity);
    updated.status = snapchatStatusForAdvertiserStatus(status);
    const { path, body } = snapchatUpdateRequestForEntity(client, level, updated);
    await snapchatApi(client, "PUT", path, body);
  },

  /**
   * GR-38: the ad level reads BOTH review vocabularies — the ad's
   * review_status (PENDING|APPROVED|REJECTED) + review_status_reasons, and the
   * referenced creative's review_status (PENDING_REVIEW|APPROVED) — plus
   * delivery_status (an array at every level).
   */
  getStatus: async (conn, level, externalId) => {
    const client = await resolveSnapchatClient(conn); // fail-close first
    const entity = await snapchatReadEntity(client, level, externalId);
    const deliveryText = snapchatDeliveryStatusText(entity.delivery_status);
    if (level !== "ad") {
      return {
        status: engineStatusFromSnapchat(entity.status),
        effectiveStatus: deliveryText,
        issuesInfo: null,
        adReviewFeedback: null,
      };
    }
    const adReviewStatus = typeof entity.review_status === "string"
      ? entity.review_status
      : null;
    const reasons = Array.isArray(entity.review_status_reasons)
      ? entity.review_status_reasons
      : null;
    // The creative's review vocabulary rides on the referenced creative —
    // best-effort (a creative read hiccup must not kill a sync sweep).
    let creativeReviewStatus: string | null = null;
    const creativeId = typeof entity.creative_id === "string" ? entity.creative_id : "";
    if (creativeId && SNAPCHAT_ENTITY_ID_REGEX.test(creativeId)) {
      try {
        const payload = await snapchatApi(client, "GET", `creatives/${creativeId}`);
        const creative = snapchatEntityFromPayload(payload, "creatives", "creative");
        creativeReviewStatus = typeof creative.review_status === "string"
          ? creative.review_status
          : null;
      } catch {
        creativeReviewStatus = null;
      }
    }
    return {
      status: engineStatusFromSnapchat(entity.status),
      // The ad review_status is the delivery gate (§4.0 status model).
      effectiveStatus: adReviewStatus,
      issuesInfo: reasons,
      adReviewFeedback: {
        review_status: adReviewStatus,
        creative_review_status: creativeReviewStatus,
        ...(deliveryText !== null && Array.isArray(entity.delivery_status)
          ? { delivery_status: entity.delivery_status }
          : deliveryText !== null
          ? { delivery_status: deliveryText }
          : {}),
      },
    };
  },

  /**
   * Budget mutator (A4.a §4.12): cents in, THE one ×10,000 conversion here,
   * floors in micro AFTER conversion; updates whichever budget field the
   * entity carries (read-modify-write PUT). GR-64's spend-cap reduction rule
   * (new cap > 1.1× spent) is enforced via validateSnapchatSpendCapReduction
   * where the entity exposes lifetime_spend_cap_micro.
   */
  setBudget: async (conn, level, externalId, cents) => {
    if (level === "ad") {
      throw new AdApiError({
        platform: "snapchat",
        code: "unsupported_level",
        message: "Snap budgets live on the campaign (CBO) or ad squad — never the ad.",
      });
    }
    const client = await resolveSnapchatClient(conn); // fail-close first
    const micro = centsToPlatformBudget("snapchat", cents);
    throwValidation(validateSnapchatBudgetFloorMicro({
      level: level === "campaign" ? "campaign" : "ad_squad",
      micro,
    }));
    const entity = await snapchatReadEntity(client, level, externalId);
    const updated = snapchatStripReadOnlyFields(entity);
    if (typeof entity.lifetime_budget_micro === "number") {
      updated.lifetime_budget_micro = micro;
    } else if (typeof entity.daily_budget_micro === "number") {
      updated.daily_budget_micro = micro;
    } else {
      const detail: string = level === "campaign"
        ? "This campaign carries no budget field (ABO — the budget lives on the ad squad; update that instead)."
        : "The ad squad has no editable budget (it is governed by the campaign's CBO budget).";
      throw new AdApiError({
        platform: "snapchat",
        code: "budget_not_editable",
        message: detail,
      });
    }
    const { path, body } = snapchatUpdateRequestForEntity(client, level, updated);
    await snapchatApi(client, "PUT", path, body);
  },

  /**
   * §4.4b compensating cleanup: DELETE /campaigns/{id} cascades the squad and
   * ad — but NOT the ad-account-scoped creative (GR-48); rollbackCreative
   * below owns that residue. Used exclusively by the atomic-create failure path.
   */
  rollbackCampaign: async (conn, campaignExternalId) => {
    const client = await resolveSnapchatClient(conn);
    assertSnapchatExternalId("campaign", campaignExternalId);
    await snapchatApi(client, "DELETE", `campaigns/${campaignExternalId}`);
  },

  /**
   * GR-48: creatives are AD-ACCOUNT-scoped — campaign deletion does NOT
   * cascade them. An explicit delete is attempted; if Snap refuses (the
   * creative-delete surface is unverified pre-live-fire), the throw makes the
   * atomic runner record the id as residue in the audit row for manual
   * reconciliation — never a silent leak.
   */
  rollbackCreative: async (conn, creativeExternalId) => {
    const client = await resolveSnapchatClient(conn);
    assertSnapchatExternalId("ad", creativeExternalId); // same UUID shape check
    await snapchatApi(client, "DELETE", `creatives/${creativeExternalId}`);
  },
};
