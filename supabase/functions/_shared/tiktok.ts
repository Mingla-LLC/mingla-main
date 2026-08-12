/**
 * tiktok.ts — the TikTok Marketing API ChannelAdapter (ISSUE-863 WP7).
 *
 * SPEC: SPEC_ISSUE-863_TIKTOK_ADS_CAMPAIGN_ENGINE.md body as corrected by
 * Amendment A1 (BINDING — A1 wins over the body), built against the ISSUE-862
 * A4.a ChannelAdapter, grounded in PROOF_LOG.md T-P1…T-P7 + tiktok.md (the
 * 949-line channel research, 2026-07-15):
 *   - v1.3 ONLY; base https://business-api.tiktok.com/open_api/v1.3/…; auth
 *     header `Access-Token: <token>` (NOT Bearer); every response is
 *     { code, message, request_id, data } where code === 0 = success.
 *   - MONEY (A1.0-1 / GR-01): cents at rest; THE one cents→dollars conversion
 *     (÷100) happens here via centsToPlatformBudget("tiktok"). Floors run
 *     AFTER conversion, in dollars: $20/day ad group · $50/day CBO campaign ·
 *     lifetime $20 × scheduled days. BALANCE_EXCEED is an actionable 200 +
 *     warning (tiktokLaunchWarning) — never a silent clamp, never a hard error.
 *   - Everything is created PAUSED: operation_status='DISABLE' at ALL THREE
 *     levels — campaign, ad group, AND ad (A1.0-4 / T-8; the body's step-5
 *     ENABLE was an internal contradiction).
 *   - bid_type is REQUIRED when budget_optimize_on=true (CBO) — the MCP schema
 *     declares a bare string; the adapter owns the enum: BID_TYPE_NO_BID
 *     (default) | BID_TYPE_CUSTOM (needs bid_price under CPC/CPM/CPV, and
 *     bid_price must be LOWER than both budgets). Campaign-level bid_type is
 *     deprecated in v1.3 — bidding is set at the ad group only (A1.1(b)/T-2).
 *   - schedule_start_time / schedule_end_time are UTC+0 "YYYY-MM-DD HH:MM:SS"
 *     (NOT the advertiser timezone — a 5-hour trap); start ≤12h past and
 *     ≤2028-01-01; end ≤2038-01-01; dayparting = exactly 336 chars of 0/1
 *     (A1.1(a)/T-1).
 *   - Geo resolves LIVE against tool/region per objective — the build-time-map
 *     recommendation is REVERSED (A1.1(e)/T-5, PROOF T-P2: GB is ABSENT for
 *     BOTH TRAFFIC and APP_PROMOTION — London is impossible today). An
 *     unavailable country FAILS LOUDLY naming the country — never a silent
 *     drop. location_ids are numeric only, ≤3,000, no overlap.
 *   - identity: TT_USER ONLY (@usemingla, b3f0f8f4-…). CUSTOMIZED_USER is
 *     ILLEGAL for this account (created 2026-04-12, after TikTok's 2026-01-15
 *     cutoff — A1.1(f)/T-6, PROOF T-P5/T-P6) and HARD-FAILS with the
 *     explanatory error before any TikTok call. AUTH_CODE (Spark) is a
 *     documented fast-follow (GR-50), not v1.
 *   - Destination policy v1 (A1.0-5, PROOF D-P1): landing_page_url is the
 *     canonical dest_url — NEVER the OneLink (AppsFlyer serves crawlers an
 *     app-install interstitial = cloaking-pattern risk). Attribution rides in
 *     utm_params (≤14, case-sensitive keys, TikTok macros).
 *   - Text validators run BEFORE any TikTok call (A1.1(c)/T-3): ad_text ≤100
 *     chars NO emoji (CJK/JP count ×2); campaign/adgroup/ad names ≤512 no
 *     emoji. Per-channel caps — never shared with Meta's ~125 soft hint.
 *   - createCreative is a documented NO-OP (A1.0-2): TikTok has NO standalone
 *     creative entity — the creative is inline in ad/create.
 *   - Placement gates (A1.1(l)/GR-68): PLACEMENT_GLOBAL_APP_BUNDLE is
 *     geo-locked (BR/ID/VN/PH/TH/MY/MX/SA/JP) and does NOT support
 *     TRAFFIC_LANDING_PAGE_VIEW; TOPBUZZ/HELO are deprecated; placements are
 *     IMMUTABLE after create (no update path exists here).
 *   - Asset upload (A1.1(k)/GR-58): UPLOAD_BY_URL only (10s fetcher timeout);
 *     file names must be unique per advertiser → timestamp suffix; capture
 *     BOTH image_id AND material_id (#866 keys external_ref = material_id).
 *   - Status reads return BOTH operation_status (advertiser-set ENABLE/
 *     DISABLE) and secondary_status (AUDIT / NOT_START / DELIVERY_OK /
 *     NO_BUDGET / BALANCE_EXCEED …) — persist both; the UI badge reads the
 *     secondary (two-status rule, tiktok.md L662/L668).
 *   - setBudget honors TikTok's published adjustment rules as validation:
 *     increases ≤40% during learning, ≤30% after, not more often than every
 *     2 days (tiktok.md §3.1/§8.1 budget doc).
 *
 * SECURITY (SPEC §6 SC-SEC-1): the long-lived Marketing-API access token lives
 * ONLY in Supabase Edge Function Secrets, resolved via connection.token_env_var
 * (default TIKTOK_ACCESS_TOKEN). It is sent as the Access-Token header (never
 * a URL param), never logged, never persisted, and scrubbed out of any
 * provider text before an error can reach the admin client.
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
  type EntityLevel,
  TIKTOK_CTA_MAP,
} from "./adChannel.ts";

// ── Env config (NAMES per SPEC §7 — values live in Function Secrets) ──────────

export const TIKTOK_DEFAULT_API_VERSION = "v1.3";
export const TIKTOK_DEFAULT_API_BASE = "https://business-api.tiktok.com";

export type TikTokLane = "consumer" | "business";

/**
 * Lane-correct env-var NAMES (QA P2-3 house rule, mirrors meta.ts/google.ts):
 * the business lane must never silently fall back to the consumer credential.
 * Only the consumer lane is provisioned today (SPEC §7 item 5) — the business
 * names simply fail-close until seeded.
 */
function laneEnvName(base: string, lane: TikTokLane): string {
  return lane === "business" ? base.replace(/^TIKTOK_/, "TIKTOK_MINGLABIZ_") : base;
}

export function tiktokDefaultTokenEnvVar(lane: TikTokLane): string {
  return laneEnvName("TIKTOK_ACCESS_TOKEN", lane);
}

/**
 * FAIL-CLOSE (RT-1 / AC-7): a missing token throws AdNotConnectedError BEFORE
 * any TikTok call — connect/create/launch must return 424 tiktok_not_connected
 * and never proceed to spend on a broken connection. Do NOT soften this throw.
 */
export function resolveTikTokToken(
  conn?: Pick<AdConnectionRow, "token_env_var"> | null,
  lane: TikTokLane = "consumer",
): string {
  const envVarName = (conn?.token_env_var ?? tiktokDefaultTokenEnvVar(lane)).trim() ||
    tiktokDefaultTokenEnvVar(lane);
  const value = Deno.env.get(envVarName);
  if (!value || value.trim().length === 0) {
    throw new AdNotConnectedError("tiktok", "tiktok_not_connected");
  }
  return value.trim();
}

export interface TikTokClient extends AuthedClient {
  platform: "tiktok";
  token: string;
  advertiserId: string;
  apiVersion: string;
  apiBase: string;
}

/**
 * Resolves token + advertiser id, lane-correct. The advertiser id comes from
 * the persisted connection (external_account_id) or the lane's
 * TIKTOK_ADVERTISER_ID secret; when BOTH exist they must MATCH (SPEC §4.3 —
 * the env id is validated against the persisted connection; a mismatch means
 * the secrets point at a different ad account than the one we persisted).
 */
export function resolveTikTokClient(
  conn?: AdConnectionRow | null,
  lane?: TikTokLane,
): TikTokClient {
  const effectiveLane: TikTokLane = conn?.lane ?? lane ?? "consumer";
  const token = resolveTikTokToken(conn ?? null, effectiveLane);
  const envAdvertiserId = (Deno.env.get(laneEnvName("TIKTOK_ADVERTISER_ID", effectiveLane)) ?? "")
    .trim();
  let connAdvertiserId = (conn?.external_account_id ?? "").trim();
  // QA WP7 F-1 (P1, runtime-proven): a failed pre-secrets connect persists the
  // 'unconfigured' SENTINEL into external_account_id (the column is NOT NULL),
  // and treating it as a real advertiser id turned the mismatch guard into a
  // permanent brick — the lane could never reconnect after the secrets landed
  // (DB-surgery-only recovery). A sentinel — or ANY persisted value that is
  // not a real numeric advertiser id — is ABSENCE, never a pin. Cross-adapter
  // bug CLASS: the WP6 reddit lane carries the identical fix idiom. Deleting
  // the guard line below is the fails-on-revert target of the rework F-1 test.
  if (!NUMERIC_ID_REGEX.test(connAdvertiserId)) connAdvertiserId = "";
  if (envAdvertiserId && connAdvertiserId && envAdvertiserId !== connAdvertiserId) {
    throw new AdApiError({
      platform: "tiktok",
      code: "advertiser_mismatch",
      message:
        `TIKTOK_ADVERTISER_ID (${envAdvertiserId}) does not match the persisted connection's advertiser (${connAdvertiserId}) — refusing to operate on an ambiguous account (SPEC §4.3).`,
    });
  }
  const advertiserId = connAdvertiserId || envAdvertiserId;
  if (!advertiserId) {
    // No advertiser id anywhere — the channel is not provisioned; fail-close.
    throw new AdNotConnectedError("tiktok", "tiktok_not_connected");
  }
  return {
    platform: "tiktok",
    token,
    advertiserId,
    apiVersion: (Deno.env.get("TIKTOK_API_VERSION") ?? TIKTOK_DEFAULT_API_VERSION).trim() ||
      TIKTOK_DEFAULT_API_VERSION,
    apiBase: (Deno.env.get("TIKTOK_GRAPH_BASE") ?? TIKTOK_DEFAULT_API_BASE).trim() ||
      TIKTOK_DEFAULT_API_BASE,
  };
}

// ── API wrapper (Access-Token header; code===0 contract; token scrubbing) ─────

export interface NormalizedTikTokError {
  code: string | number | null;
  message: string;
  request_id: string | null;
}

/** Client-safe error shape from a { code, message, request_id } envelope. */
export function normalizeTikTokError(payload: unknown): NormalizedTikTokError {
  const record = (payload ?? {}) as Record<string, unknown>;
  return {
    code: typeof record.code === "number" || typeof record.code === "string"
      ? record.code
      : null,
    message: typeof record.message === "string" && record.message
      ? record.message
      : "TikTok API error",
    request_id: typeof record.request_id === "string" ? record.request_id : null,
  };
}

/**
 * v1.3 wrapper. GET params follow the TikTok convention: array/object values
 * are JSON-encoded query params (e.g. filtering={"campaign_ids":[…]}). On
 * code !== 0 (or a non-2xx) it throws a normalized AdApiError; the raw token
 * is scrubbed out of any provider text (SC-SEC-1 defense-in-depth).
 */
export async function tiktokApi(
  client: TikTokClient,
  method: "GET" | "POST",
  path: string,
  params?: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const scrub = (text: string): string => text.split(client.token).join("[redacted]");
  let url = `${client.apiBase}/open_api/${client.apiVersion}/${path.replace(/^\//, "")}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init: RequestInit = {
    method,
    signal: controller.signal,
    headers: {
      // Access-Token header — NOT Bearer (§4.0), never a URL param.
      "Access-Token": client.token,
      "Content-Type": "application/json",
    },
  };
  if (params && Object.keys(params).length > 0) {
    if (method === "GET") {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        qs.set(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      url += `?${qs.toString()}`;
    } else {
      init.body = JSON.stringify(params);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    clearTimeout(timer);
    const detail = err instanceof Error ? err.message : String(err);
    throw new AdApiError({
      platform: "tiktok",
      code: "network_error",
      message: scrub(`TikTok API request failed: ${detail}`),
    });
  }
  clearTimeout(timer);

  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const normalized = normalizeTikTokError(payload);
  if (!response.ok || normalized.code !== 0) {
    // code === 0 is THE success contract (§4.0); surface TikTok's own
    // validation message VERBATIM (AC-3 — e.g. min-budget errors), scrubbed.
    throw new AdApiError({
      platform: "tiktok",
      code: normalized.code ?? `http_${response.status}`,
      message: scrub(normalized.message),
      traceId: normalized.request_id,
    });
  }
  return (payload.data ?? {}) as Record<string, unknown>;
}

// ── Validation result shape (mirrors google.ts GoogleValidation) ──────────────

export type TikTokValidation =
  | { ok: true }
  | { ok: false; detail: string; message: string };

function throwValidation(check: TikTokValidation): void {
  if (!check.ok) {
    throw new AdApiError({ platform: "tiktok", code: check.detail, message: check.message });
  }
}

// ── Text validators (A1.1(c)/T-3 — hard caps, enforced BEFORE any call) ───────

export const TIKTOK_AD_TEXT_MAX_WEIGHT = 100;
export const TIKTOK_NAME_MAX_WEIGHT = 512;

/** Text-default symbols that are Extended_Pictographic but are NOT emoji copy. */
const TEXT_SYMBOL_ALLOWLIST = new Set(["©", "®", "™"]);
const EXTENDED_PICTOGRAPHIC_REGEX = /\p{Extended_Pictographic}/u;
const REGIONAL_INDICATOR_REGEX = /[\u{1F1E6}-\u{1F1FF}]/u;
/** Emoji plumbing: variation selector-16, ZWJ, combining keycap. */
const EMOJI_PLUMBING = new Set(["\uFE0F", "\u200D", "\u20E3"]);
/**
 * QA WP7 F-2/F-4: skin-tone modifiers (U+1F3FB–FF) and TAG characters
 * (U+E0020–E007F) are emoji plumbing that V8's Extended_Pictographic data
 * does NOT cover — a lone skin-tone swatch passed the validator, and
 * stripEmoji stranded skin tones / invisible tag junk (England tag-flag)
 * into "clean" output. Checked by BOTH containsEmoji and stripEmoji so the
 * strip→validate round trip is airtight: strip output must never still
 * "contain".
 */
const EMOJI_MODIFIER_OR_TAG_REGEX = /[\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u;

/** True when the character is emoji or emoji plumbing (shared by contains/strip — F-2/F-4). */
function isEmojiChar(ch: string): boolean {
  if (TEXT_SYMBOL_ALLOWLIST.has(ch)) return false;
  return EMOJI_PLUMBING.has(ch) ||
    EMOJI_MODIFIER_OR_TAG_REGEX.test(ch) ||
    REGIONAL_INDICATOR_REGEX.test(ch) ||
    EXTENDED_PICTOGRAPHIC_REGEX.test(ch);
}

/** TikTok non-Spark ad copy forbids emoji (emoji-in-ads is Spark-only — A1.1(c)/(j)). */
export function containsEmoji(text: string): boolean {
  for (const ch of text) {
    if (isEmojiChar(ch)) return true;
  }
  return false;
}

/**
 * Strips emoji (incl. ZWJ sequences, flags, keycaps, skin-tone modifiers and
 * tag characters — F-2/F-4) for the emoji-native mingla-content-engine copy
 * pipeline: strip for non-Spark, or route the emoji version via Spark
 * (A1.1(c)). Shares isEmojiChar with containsEmoji so stripped output can
 * never still "contain". Collapses the whitespace the strip leaves behind.
 */
export function stripEmoji(text: string): string {
  let out = "";
  for (const ch of text) {
    if (isEmojiChar(ch)) continue;
    out += ch;
  }
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x11FF) || // Hangul Jamo
    (cp >= 0x3000 && cp <= 0x303F) || // CJK punctuation
    (cp >= 0x3040 && cp <= 0x30FF) || // Hiragana + Katakana
    (cp >= 0x31F0 && cp <= 0x31FF) || // Katakana phonetic extensions
    (cp >= 0x3400 && cp <= 0x4DBF) || // CJK Ext A
    (cp >= 0x4E00 && cp <= 0x9FFF) || // CJK Unified
    (cp >= 0xAC00 && cp <= 0xD7AF) || // Hangul syllables
    (cp >= 0xF900 && cp <= 0xFAFF) || // CJK compatibility ideographs
    (cp >= 0xFF00 && cp <= 0xFFEF) || // Full-width forms
    (cp >= 0x20000 && cp <= 0x2FA1F) // CJK Ext B+
  );
}

/**
 * TikTok's character-counting rule, verbatim: "Each Chinese or Japanese word
 * counts as two characters; each English letter counts as one." (tiktok.md
 * §4.4). Applied to ad_text AND names.
 */
export function tiktokWeightedLength(text: string): number {
  let weight = 0;
  for (const ch of text) {
    weight += isCjkCodePoint(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return weight;
}

/** ad_text: required, ≤100 weighted chars, NO emoji (A1.1(c) — hard validator). */
export function validateTikTokAdText(text: unknown): TikTokValidation {
  if (typeof text !== "string" || !text.trim()) {
    return {
      ok: false,
      detail: "ad_text_required",
      message: "ad_text is required for a non-Spark TikTok ad.",
    };
  }
  if (containsEmoji(text)) {
    return {
      ok: false,
      detail: "ad_text_emoji",
      message:
        "ad_text must not contain emoji — TikTok forbids emoji in non-Spark ad copy (emoji is only reachable via a Spark ad's organic caption). Strip it (stripEmoji) or route via Spark.",
    };
  }
  const weight = tiktokWeightedLength(text);
  if (weight > TIKTOK_AD_TEXT_MAX_WEIGHT) {
    return {
      ok: false,
      detail: "ad_text_too_long",
      message:
        `ad_text is ${weight}/${TIKTOK_AD_TEXT_MAX_WEIGHT} weighted characters (CJK/JP count ×2) — TikTok's hard cap is 100, NOT Meta's ~125 soft hint (per-channel caps, never shared).`,
    };
  }
  return { ok: true };
}

/** campaign_name / adgroup_name / ad_name: required, ≤512 weighted, no emoji. */
export function validateTikTokName(name: unknown, field: string): TikTokValidation {
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, detail: "name_required", message: `${field} is required.` };
  }
  if (containsEmoji(name)) {
    return {
      ok: false,
      detail: "name_emoji",
      message: `${field} must not contain emoji (TikTok hard rule).`,
    };
  }
  const weight = tiktokWeightedLength(name);
  if (weight > TIKTOK_NAME_MAX_WEIGHT) {
    return {
      ok: false,
      detail: "name_too_long",
      message:
        `${field} is ${weight}/${TIKTOK_NAME_MAX_WEIGHT} weighted characters (CJK/JP count ×2).`,
    };
  }
  return { ok: true };
}

// ── Video duration policy (A1.1(d)/T-4 — for the #866 SINGLE_VIDEO fast-follow) ─
// The TECHNICAL bound is 10 minutes; the ADVERTISING POLICY bound is 5–60 s —
// a 3-minute video uploads fine, creates fine, then dies in review while a
// $20/day minimum burns. Spark is the documented exception (10 min — the
// organic post IS the ad). This validator ships NOW so the video path cannot
// be built without it.

export const TIKTOK_VIDEO_MIN_DURATION_SECONDS = 5;
export const TIKTOK_VIDEO_MAX_DURATION_SECONDS = 60;
export const TIKTOK_SPARK_VIDEO_MAX_DURATION_SECONDS = 600;

export function validateTikTokVideoDuration(
  seconds: number,
  opts: { spark?: boolean } = {},
): TikTokValidation {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return {
      ok: false,
      detail: "video_duration_invalid",
      message: "Video duration must be a positive number of seconds.",
    };
  }
  const max = opts.spark
    ? TIKTOK_SPARK_VIDEO_MAX_DURATION_SECONDS
    : TIKTOK_VIDEO_MAX_DURATION_SECONDS;
  if (seconds < TIKTOK_VIDEO_MIN_DURATION_SECONDS || seconds > max) {
    return {
      ok: false,
      detail: "video_duration_policy",
      message: opts.spark
        ? `Spark video duration ${seconds}s is outside 5–600 s.`
        : `Video duration ${seconds}s violates TikTok's ADVERTISING POLICY bound of 5–60 s — the 10-minute figure is the technical upload bound; a longer video uploads fine and is then rejected in review (T-4).`,
    };
  }
  return { ok: true };
}

// ── Schedule (A1.1(a)/T-1 — UTC+0 strings, bounded; dayparting 336×0/1) ───────

export const TIKTOK_SCHEDULE_MAX_START = "2028-01-01 00:00:00";
export const TIKTOK_SCHEDULE_MAX_END = "2038-01-01 00:00:00";
export const TIKTOK_SCHEDULE_PAST_TOLERANCE_MS = 12 * 60 * 60 * 1000; // ≤12h in the past
const SCHEDULE_TIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DAYPARTING_REGEX = /^[01]{336}$/;

/** Parses a TikTok schedule string AS UTC+0 (never the advertiser timezone). */
export function parseTikTokScheduleTime(value: string): number | null {
  if (!SCHEDULE_TIME_REGEX.test(value)) return null;
  const ms = Date.parse(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(ms)) return null;
  // Round-trip guard: V8 leniently ROLLS impossible calendar dates
  // (2027-02-30 → 2027-03-02) instead of rejecting them — a silently shifted
  // schedule is exactly the class of bug T-1 exists to kill.
  if (formatTikTokScheduleTime(new Date(ms)) !== value) return null;
  return ms;
}

/** Formats a Date as the UTC+0 "YYYY-MM-DD HH:MM:SS" TikTok schedule string. */
export function formatTikTokScheduleTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export interface TikTokScheduleInput {
  scheduleType: string;
  scheduleStartTime: string;
  scheduleEndTime?: string | null;
  dayparting?: string | null;
  /** Injectable clock for tests. */
  nowMs?: number;
}

export const TIKTOK_SCHEDULE_TYPES = ["SCHEDULE_FROM_NOW", "SCHEDULE_START_END"] as const;

/**
 * The UTC+0 + bounds contract (AC-16): start is a valid UTC+0 string, ≤12h in
 * the past, ≤2028-01-01; end (required for SCHEDULE_START_END) is after start
 * and ≤2038-01-01; dayparting, if present, is exactly 336 chars of 0/1
 * (48 half-hours × 7 days; char 1 = Mon 00:01–00:30).
 */
export function validateTikTokSchedule(input: TikTokScheduleInput): TikTokValidation {
  if (!(TIKTOK_SCHEDULE_TYPES as readonly string[]).includes(input.scheduleType)) {
    return {
      ok: false,
      detail: "schedule_type_invalid",
      message:
        `schedule_type "${input.scheduleType}" is invalid — valid: ${TIKTOK_SCHEDULE_TYPES.join(" | ")}.`,
    };
  }
  const nowMs = input.nowMs ?? Date.now();
  const startMs = parseTikTokScheduleTime(input.scheduleStartTime);
  if (startMs === null) {
    return {
      ok: false,
      detail: "schedule_start_invalid",
      message:
        `schedule_start_time "${input.scheduleStartTime}" is not a valid UTC+0 "YYYY-MM-DD HH:MM:SS" string — TikTok schedules are UTC+0, NOT the advertiser timezone (Etc/GMT+5 — the 5-hour trap, T-1).`,
    };
  }
  if (startMs < nowMs - TIKTOK_SCHEDULE_PAST_TOLERANCE_MS) {
    return {
      ok: false,
      detail: "schedule_start_too_old",
      message: "schedule_start_time is more than 12 hours in the past (TikTok bound).",
    };
  }
  const maxStartMs = parseTikTokScheduleTime(TIKTOK_SCHEDULE_MAX_START) as number;
  if (startMs > maxStartMs) {
    return {
      ok: false,
      detail: "schedule_start_out_of_bounds",
      message: `schedule_start_time must be no later than ${TIKTOK_SCHEDULE_MAX_START} UTC (TikTok bound).`,
    };
  }
  const end = input.scheduleEndTime ?? null;
  if (input.scheduleType === "SCHEDULE_START_END" && !end) {
    return {
      ok: false,
      detail: "schedule_end_required",
      message: "schedule_end_time is required for SCHEDULE_START_END (and for any lifetime budget).",
    };
  }
  if (end) {
    const endMs = parseTikTokScheduleTime(end);
    if (endMs === null) {
      return {
        ok: false,
        detail: "schedule_end_invalid",
        message: `schedule_end_time "${end}" is not a valid UTC+0 "YYYY-MM-DD HH:MM:SS" string.`,
      };
    }
    if (endMs <= startMs) {
      return {
        ok: false,
        detail: "schedule_end_before_start",
        message: "schedule_end_time must be after schedule_start_time.",
      };
    }
    const maxEndMs = parseTikTokScheduleTime(TIKTOK_SCHEDULE_MAX_END) as number;
    if (endMs > maxEndMs) {
      return {
        ok: false,
        detail: "schedule_end_out_of_bounds",
        message: `schedule_end_time must be no later than ${TIKTOK_SCHEDULE_MAX_END} UTC (TikTok bound).`,
      };
    }
  }
  if (input.dayparting !== undefined && input.dayparting !== null && input.dayparting !== "") {
    if (!DAYPARTING_REGEX.test(input.dayparting)) {
      return {
        ok: false,
        detail: "dayparting_invalid",
        message:
          "dayparting must be exactly 336 characters of 0/1 (48 half-hours × 7 days; char 1 = Mon 00:01–00:30). All-0 / all-1 / omitted = full-time.",
      };
    }
  }
  return { ok: true };
}

/** Scheduled days for the lifetime floor ($20 × days) — calendar-day count, min 1. */
export function tiktokScheduledDays(startMs: number, endMs: number): number {
  return Math.max(1, Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000)));
}

// ── Budget floors (A1.0-1 — checked AFTER cents→dollars conversion) ───────────

export const TIKTOK_MIN_ADGROUP_DAILY_BUDGET_DOLLARS = 20;
export const TIKTOK_MIN_CAMPAIGN_DAILY_BUDGET_DOLLARS = 50; // CBO
export const TIKTOK_LIFETIME_FLOOR_PER_DAY_DOLLARS = 20;

export function tiktokLifetimeFloorDollars(scheduledDays: number): number {
  return TIKTOK_LIFETIME_FLOOR_PER_DAY_DOLLARS * Math.max(1, scheduledDays);
}

/**
 * Floor checks run in DOLLARS, after conversion — never in cents before it
 * (A1.0-1). These are OUR pre-flight floors from TikTok's published budget doc;
 * TikTok's own validation error (the authoritative backstop) is still surfaced
 * VERBATIM by tiktokApi — never a silent clamp (AC-3).
 */
export function validateTikTokBudgetFloor(input: {
  level: "campaign" | "ad_group";
  mode: "daily" | "lifetime";
  dollars: number;
  scheduledDays?: number;
}): TikTokValidation {
  if (!Number.isFinite(input.dollars) || input.dollars <= 0) {
    return {
      ok: false,
      detail: "budget_invalid",
      message: "Budget must be a positive amount.",
    };
  }
  if (input.mode === "lifetime") {
    const days = input.scheduledDays ?? 1;
    const floor = tiktokLifetimeFloorDollars(days);
    if (input.dollars < floor) {
      return {
        ok: false,
        detail: "budget_below_minimum",
        message:
          `Lifetime budget $${input.dollars} is below TikTok's floor of $${floor} ($20 × ${days} scheduled day(s)).`,
      };
    }
    return { ok: true };
  }
  const floor = input.level === "campaign"
    ? TIKTOK_MIN_CAMPAIGN_DAILY_BUDGET_DOLLARS
    : TIKTOK_MIN_ADGROUP_DAILY_BUDGET_DOLLARS;
  if (input.dollars < floor) {
    return {
      ok: false,
      detail: "budget_below_minimum",
      message: input.level === "campaign"
        ? `Daily CBO campaign budget $${input.dollars} is below TikTok's $${floor}/day campaign floor.`
        : `Daily ad-group budget $${input.dollars} is below TikTok's $${floor}/day ad-group floor.`,
    };
  }
  return { ok: true };
}

// ── Budget adjustment rules (setBudget validation — tiktok.md §3.1/§8.1) ──────

export const TIKTOK_BUDGET_INCREASE_MAX_PCT_LEARNING = 0.40;
export const TIKTOK_BUDGET_INCREASE_MAX_PCT_AFTER_LEARNING = 0.30;
export const TIKTOK_BUDGET_ADJUSTMENT_MIN_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000;

export interface TikTokBudgetUpdateInput {
  currentBudgetDollars: number;
  newBudgetDollars: number;
  /** In the learning phase the increase cap is 40%; after it, 30%. Unknown ⇒ pass false (conservative 30%). */
  learning?: boolean;
  /** ISO timestamp of the last budget change (engine-owned state); null/undefined skips the cadence rule. */
  lastBudgetChangeAt?: string | null;
  nowMs?: number;
}

/**
 * TikTok's published adjustment rules, enforced as validation (never silently
 * clamped): increases ≤40% per adjustment during learning, ≤30% after, and
 * adjustments not more often than every 2 days. Decreases are cadence-bound
 * but not percentage-bound (the published caps are on increases).
 */
export function validateTikTokBudgetUpdate(input: TikTokBudgetUpdateInput): TikTokValidation {
  if (!Number.isFinite(input.newBudgetDollars) || input.newBudgetDollars <= 0) {
    return { ok: false, detail: "budget_invalid", message: "New budget must be positive." };
  }
  if (input.lastBudgetChangeAt) {
    const lastMs = Date.parse(input.lastBudgetChangeAt);
    const nowMs = input.nowMs ?? Date.now();
    if (
      !Number.isNaN(lastMs) && nowMs - lastMs < TIKTOK_BUDGET_ADJUSTMENT_MIN_INTERVAL_MS
    ) {
      return {
        ok: false,
        detail: "budget_adjustment_too_frequent",
        message:
          "TikTok recommends adjusting a budget not more often than every 2 days — the last adjustment was more recent (resets learning).",
      };
    }
  }
  if (
    Number.isFinite(input.currentBudgetDollars) && input.currentBudgetDollars > 0 &&
    input.newBudgetDollars > input.currentBudgetDollars
  ) {
    const pct = (input.newBudgetDollars - input.currentBudgetDollars) /
      input.currentBudgetDollars;
    const cap = input.learning === true
      ? TIKTOK_BUDGET_INCREASE_MAX_PCT_LEARNING
      : TIKTOK_BUDGET_INCREASE_MAX_PCT_AFTER_LEARNING;
    if (pct > cap) {
      return {
        ok: false,
        detail: "budget_increase_too_large",
        message: `Budget increase of ${Math.round(pct * 100)}% exceeds TikTok's ${
          Math.round(cap * 100)
        }% per-adjustment cap (${input.learning === true ? "learning phase" : "post-learning"}).`,
      };
    }
  }
  return { ok: true };
}

// ── Objectives + goals + billing + bidding enums (A1.0-6 / A1.1(b,g)) ─────────
// The MCP schema declares objective_type/bid_type/billing_event as bare
// strings — WE own the enums client-side or we ship runtime 400s (T-7).

export const TIKTOK_OBJECTIVES = [
  "REACH",
  "TRAFFIC",
  "VIDEO_VIEWS",
  "ENGAGEMENT",
  "APP_PROMOTION",
  "LEAD_GENERATION",
  "WEB_CONVERSIONS",
  "PRODUCT_SALES",
] as const;

/** Conversion-optimized objectives are gated until #865's pixel fires (T-P4: zero events). */
export const TIKTOK_PIXEL_GATED_OBJECTIVES: readonly string[] = [
  "WEB_CONVERSIONS",
  "PRODUCT_SALES",
];

export const TIKTOK_OPTIMIZATION_GOALS = [
  "CLICK",
  "INSTALL",
  "IN_APP_EVENT",
  "SHOW",
  "REACH",
  "LEAD_GENERATION",
  "CONVERSATION",
  "FOLLOWERS",
  "PAGE_VISIT",
  "VALUE",
  "AUTOMATIC_VALUE_OPTIMIZATION",
  "ENGAGED_VIEW",
  "ENGAGED_VIEW_FIFTEEN",
  "TRAFFIC_LANDING_PAGE_VIEW",
  "DESTINATION_VISIT",
  "PREFERRED_LEAD",
] as const;

export const TIKTOK_BILLING_EVENTS = ["CPC", "CPM", "OCPM", "CPV"] as const;

export const TIKTOK_BID_TYPES = ["BID_TYPE_NO_BID", "BID_TYPE_CUSTOM"] as const;
export const TIKTOK_DEFAULT_BID_TYPE = "BID_TYPE_NO_BID";
/** billing events under which BID_TYPE_CUSTOM requires bid_price. */
export const TIKTOK_BID_PRICE_BILLING_EVENTS: readonly string[] = ["CPC", "CPM", "CPV"];

export function validateTikTokObjective(objective: unknown): TikTokValidation {
  if (
    typeof objective !== "string" ||
    !(TIKTOK_OBJECTIVES as readonly string[]).includes(objective)
  ) {
    return {
      ok: false,
      detail: "objective_invalid",
      message: `objective_type "${String(objective)}" is invalid — the adapter owns the enum (the MCP declares a bare string): ${
        TIKTOK_OBJECTIVES.join(" | ")
      }.`,
    };
  }
  return { ok: true };
}

/**
 * CBO first-ad-group consistency (A1.1(b)): under one CBO campaign, bid_type +
 * optimization_event must match the first ad group. One create = one ad group
 * today; this validator guards the multi-ad-group future.
 */
export function validateTikTokCboAdGroupConsistency(
  first: { bidType: string; optimizationEvent?: string | null },
  next: { bidType: string; optimizationEvent?: string | null },
): TikTokValidation {
  if (first.bidType !== next.bidType) {
    return {
      ok: false,
      detail: "cbo_bid_type_mismatch",
      message:
        `Under one CBO campaign every ad group must use the first ad group's bid_type (${first.bidType}); got ${next.bidType}.`,
    };
  }
  if ((first.optimizationEvent ?? null) !== (next.optimizationEvent ?? null)) {
    return {
      ok: false,
      detail: "cbo_optimization_event_mismatch",
      message:
        "Under one CBO campaign every ad group must use the first ad group's optimization_event.",
    };
  }
  return { ok: true };
}

// ── Placement gates (A1.1(l)/GR-68) ───────────────────────────────────────────

export const TIKTOK_PLACEMENTS = [
  "PLACEMENT_TIKTOK",
  "PLACEMENT_PANGLE",
  "PLACEMENT_GLOBAL_APP_BUNDLE",
] as const;
export const TIKTOK_DEPRECATED_PLACEMENTS: readonly string[] = [
  "PLACEMENT_TOPBUZZ",
  "PLACEMENT_HELO",
];
/** GAB is geo-locked to exactly these markets (verbatim — GR-68). */
export const TIKTOK_GAB_COUNTRIES: readonly string[] = [
  "BR",
  "ID",
  "VN",
  "PH",
  "TH",
  "MY",
  "MX",
  "SA",
  "JP",
];
export const TIKTOK_DEFAULT_PLACEMENT_TYPE = "PLACEMENT_TYPE_NORMAL";
export const TIKTOK_DEFAULT_PLACEMENTS: readonly string[] = ["PLACEMENT_TIKTOK"];

/**
 * GR-68: TOPBUZZ/HELO are deprecated (400s); PLACEMENT_GLOBAL_APP_BUNDLE does
 * NOT support optimization_goal=TRAFFIC_LANDING_PAGE_VIEW (our default — the
 * combination silently fails) and is geo-locked to BR/ID/VN/PH/TH/MY/MX/SA/JP.
 * Placements are IMMUTABLE after create — there is deliberately no update path.
 */
export function validateTikTokPlacements(
  placements: readonly string[],
  opts: { optimizationGoal?: string; countryCodes?: readonly string[] } = {},
): TikTokValidation {
  if (!Array.isArray(placements) || placements.length === 0) {
    return {
      ok: false,
      detail: "placements_required",
      message: "placements is required when placement_type is PLACEMENT_TYPE_NORMAL.",
    };
  }
  for (const placement of placements) {
    if (TIKTOK_DEPRECATED_PLACEMENTS.includes(placement)) {
      return {
        ok: false,
        detail: "placement_deprecated",
        message: `${placement} is deprecated — do not use (GR-68).`,
      };
    }
    if (!(TIKTOK_PLACEMENTS as readonly string[]).includes(placement)) {
      return {
        ok: false,
        detail: "placement_invalid",
        message: `Unknown placement "${placement}" — valid: ${TIKTOK_PLACEMENTS.join(" | ")}.`,
      };
    }
  }
  if (placements.includes("PLACEMENT_GLOBAL_APP_BUNDLE")) {
    if (opts.optimizationGoal === "TRAFFIC_LANDING_PAGE_VIEW") {
      return {
        ok: false,
        detail: "placement_gab_unsupported_goal",
        message:
          "PLACEMENT_GLOBAL_APP_BUNDLE does not support optimization_goal=TRAFFIC_LANDING_PAGE_VIEW — the combination silently fails (GR-68).",
      };
    }
    const outside = (opts.countryCodes ?? []).filter(
      (code) => !TIKTOK_GAB_COUNTRIES.includes(code.toUpperCase()),
    );
    if (outside.length > 0) {
      return {
        ok: false,
        detail: "placement_gab_geo_locked",
        message: `PLACEMENT_GLOBAL_APP_BUNDLE is geo-locked to ${
          TIKTOK_GAB_COUNTRIES.join("/")
        } — requested market(s) ${outside.join(", ")} are outside it (GR-68).`,
      };
    }
  }
  return { ok: true };
}

// ── location_ids invariants (A1.1(e) — numeric only, ≤3,000, no overlap) ──────

export const TIKTOK_MAX_LOCATION_IDS = 3_000;
const NUMERIC_ID_REGEX = /^\d+$/;

export function validateTikTokLocationIds(locationIds: unknown): TikTokValidation {
  if (!Array.isArray(locationIds) || locationIds.length === 0) {
    return {
      ok: false,
      detail: "location_ids_required",
      message: "location_ids is required (numeric TikTok location ids — never ISO codes).",
    };
  }
  const seen = new Set<string>();
  for (const id of locationIds) {
    if (typeof id !== "string" || !NUMERIC_ID_REGEX.test(id)) {
      return {
        ok: false,
        detail: "location_ids_not_numeric",
        message:
          `location_ids must be numeric TikTok ids (e.g. US 6252001); got "${String(id)}" — ISO country codes are NOT accepted (T-5).`,
      };
    }
    if (seen.has(id)) {
      return {
        ok: false,
        detail: "location_ids_overlap",
        message: `location_id ${id} appears more than once — overlapping locations are not allowed.`,
      };
    }
    seen.add(id);
  }
  if (locationIds.length > TIKTOK_MAX_LOCATION_IDS) {
    return {
      ok: false,
      detail: "location_ids_too_many",
      message: `location_ids exceeds TikTok's ${TIKTOK_MAX_LOCATION_IDS} cap (combined with zipcode_ids).`,
    };
  }
  return { ok: true };
}

// ── LIVE geo resolution (A1.1(e)/T-5 — tool/region, fail-LOUD; OD-7 REVERSED) ─

export interface TikTokRegion {
  locationId: string;
  regionCode: string;
  name: string | null;
  level: string | null;
}

/** Tolerant parser over the tool/region data payload (region_info/regions/list). */
export function parseTikTokRegions(payload: unknown): TikTokRegion[] {
  const record = (payload ?? {}) as Record<string, unknown>;
  const raw = (Array.isArray(record.region_info)
    ? record.region_info
    : Array.isArray(record.regions)
    ? record.regions
    : Array.isArray(record.list)
    ? record.list
    : []) as Record<string, unknown>[];
  const regions: TikTokRegion[] = [];
  for (const entry of raw) {
    // QA WP7 F-3: honor the tolerant-parser contract — a null / non-object
    // element in a malformed live payload is SKIPPED, never a raw TypeError
    // (which would surface as a wrong-shaped 500 instead of a normalized error).
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const idRaw = entry.location_id ?? entry.region_id ?? entry.id;
    const locationId = typeof idRaw === "string"
      ? idRaw
      : typeof idRaw === "number"
      ? String(idRaw)
      : "";
    const regionCode = typeof entry.region_code === "string"
      ? entry.region_code
      : typeof entry.country_code === "string"
      ? entry.country_code
      : "";
    if (!locationId || !NUMERIC_ID_REGEX.test(locationId) || !regionCode) continue;
    regions.push({
      locationId,
      regionCode: regionCode.toUpperCase(),
      name: typeof entry.name === "string" ? entry.name : null,
      level: typeof entry.level === "string" ? entry.level : null,
    });
  }
  return regions;
}

export type TikTokGeoResolution =
  | { ok: true; locationIds: string[]; resolved: Record<string, string> }
  | { ok: false; detail: "geo_unavailable"; missing: string[]; message: string };

/**
 * Pure country → location_id picker over live tool/region data. When a
 * requested country is unavailable it fails LOUDLY, NAMING the country
 * (AC-13) — never a silent drop. PROVEN 2026-07-15 (T-P2): GB is ABSENT for
 * both TRAFFIC and APP_PROMOTION — advertising to London on TikTok is
 * impossible today (escalated to TikTok; reads as an entity-registration
 * gate, not a product limit).
 */
export function pickTikTokLocationIdsForCountries(
  regions: readonly TikTokRegion[],
  countryCodes: readonly string[],
  opts: { objective?: string } = {},
): TikTokGeoResolution {
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  for (const code of countryCodes) {
    const wanted = code.trim().toUpperCase();
    const match = regions.find(
      (region) =>
        region.regionCode === wanted &&
        (region.level === null || region.level.toUpperCase().includes("COUNTRY")),
    ) ?? regions.find((region) => region.regionCode === wanted);
    if (match) resolved[wanted] = match.locationId;
    else missing.push(wanted);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      detail: "geo_unavailable",
      missing,
      message: `TikTok cannot target ${missing.join(", ")} today — tool/region${
        opts.objective ? ` (objective ${opts.objective})` : ""
      } does not offer ${
        missing.join(", ")
      } for this advertiser (GB was proven absent 2026-07-15 — T-P2; escalated to TikTok). Remove the country or wait for TikTok to unlock it; it is NEVER silently dropped.`,
    };
  }
  return { ok: true, locationIds: Object.values(resolved), resolved };
}

/** Live tool/region read (per objective) — the ONLY sanctioned geo source (OD-7 reversed). */
export async function tiktokFetchRegions(
  client: TikTokClient,
  opts: { objective?: string; placements?: readonly string[] } = {},
): Promise<TikTokRegion[]> {
  const data = await tiktokApi(client, "GET", "tool/region/", {
    advertiser_id: client.advertiserId,
    placements: opts.placements ?? TIKTOK_DEFAULT_PLACEMENTS,
    objective_type: opts.objective ?? "TRAFFIC",
  });
  return parseTikTokRegions(data);
}

/**
 * resolveGeo — LIVE against tool/region at create time; throws a normalized
 * AdApiError (code geo_unavailable) naming the unavailable countries; the
 * edge layer maps it to a 422 (AC-13).
 */
export async function resolveTikTokGeo(
  conn: AdConnectionRow,
  countryCodes: readonly string[],
  objective = "TRAFFIC",
): Promise<string[]> {
  const client = resolveTikTokClient(conn);
  const regions = await tiktokFetchRegions(client, { objective });
  const picked = pickTikTokLocationIdsForCountries(regions, countryCodes, { objective });
  if (!picked.ok) {
    throw new AdApiError({ platform: "tiktok", code: picked.detail, message: picked.message });
  }
  const check = validateTikTokLocationIds(picked.locationIds);
  throwValidation(check);
  return picked.locationIds;
}

// ── Targeting Search (ISSUE-989) — READ-ONLY city + interest resolvers ────────
// PROVEN live 2026-07-20 (MCP tool_region_get / tool_interest_category_get,
// advertiser 7627974536397766673): TO_CITY returns 2014 CITY-level regions with
// numeric location_ids (e.g. 5392967 Santa Barbara/US); interest_category_get
// returns 716 categories {interest_category_id, interest_category_name}. Both
// are reads — nothing is created. GB has NO city (T-P2) so a GB city search is
// legitimately empty; the caller fails-open to country targeting.

/**
 * Pure city filter over live tool/region data: CITY-level regions in the given
 * country whose name matches the query (case-insensitive substring). Numeric
 * location_ids only. Sorted name-prefix matches first, capped to `limit`.
 */
export function filterTikTokCityRegions(
  regions: readonly TikTokRegion[],
  opts: { country?: string; q?: string; limit?: number } = {},
): TikTokRegion[] {
  const country = (opts.country ?? "").trim().toUpperCase();
  const q = (opts.q ?? "").trim().toLowerCase();
  const limit = opts.limit ?? 15;
  const cities = regions.filter((r) => {
    if (!r.level || r.level.toUpperCase() !== "CITY") return false;
    if (country && r.regionCode !== country) return false;
    if (!r.name) return false;
    return q.length === 0 || r.name.toLowerCase().includes(q);
  });
  cities.sort((a, b) => {
    const an = (a.name ?? "").toLowerCase();
    const bn = (b.name ?? "").toLowerCase();
    const ap = an.startsWith(q) ? 0 : 1;
    const bp = bn.startsWith(q) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return an.localeCompare(bn);
  });
  return cities.slice(0, limit);
}

// ── City geo resolution via tool/targeting/search (ISSUE-1289) ────────────────
// PROVEN live 2026-07-29 (MCP tool_targeting_search, advertiser
// 7627974536397766673): the CITY-filter over tool/region (filterTikTokCityRegions
// above) could NOT resolve major US cities. In TikTok's US taxonomy the levels are
// COUNTRY → PROVINCE (state) → CITY (**county**) → DISTRICT (**the actual
// municipality**), and DMAs come back at PROVINCE level in tool/region
// ("New York,DMA®"). So "New York" the city is a DISTRICT (geo_id 5128581) and
// NEVER appears in a level==="CITY" filter — the search returned zero matches and
// the create path silently fell back to country (#1289). tool/targeting/search
// FUZZY_SEARCH is TikTok's purpose-built keyword→location_id endpoint: it returns
// city (DISTRICT), county (CITY) AND DMA tags with numeric geo_ids usable directly
// as adgroup location_ids (docs: "returned location IDs can be passed to
// location_ids"), country-scoped and relevance-ordered. GB legitimately returns
// EMPTY (T-P2 — no sub-country geo) → the caller emits an HONEST country-fallback
// warning, never a silent widen.

/** City-like geo levels surfaced for a "city" search (never COUNTRY/PROVINCE/ZIP_CODE). */
export const TIKTOK_CITY_GEO_TYPES: readonly string[] = ["CITY", "DISTRICT", "DMA"];

export interface TikTokLocationTag {
  geoId: string;
  geoType: string;
  regionCode: string;
  description: string | null;
  name: string;
  status: string | null;
}

/**
 * Tolerant parser over a tool/targeting/search FUZZY_SEARCH payload
 * (targeting_tag_list). Only GEO tags with a numeric geo_id + a name survive;
 * null / non-object / ISP entries are SKIPPED (never a raw TypeError — mirrors
 * parseTikTokRegions' tolerant-parser contract).
 */
export function parseTikTokTargetingSearch(payload: unknown): TikTokLocationTag[] {
  const record = (payload ?? {}) as Record<string, unknown>;
  const raw = (Array.isArray(record.targeting_tag_list)
    ? record.targeting_tag_list
    : Array.isArray(record.list)
    ? record.list
    : []) as Record<string, unknown>[];
  const tags: TikTokLocationTag[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const geo = entry.geo;
    if (geo === null || typeof geo !== "object" || Array.isArray(geo)) continue;
    const geoRec = geo as Record<string, unknown>;
    const idRaw = geoRec.geo_id;
    const geoId = typeof idRaw === "string"
      ? idRaw
      : typeof idRaw === "number"
      ? String(idRaw)
      : "";
    if (!geoId || !NUMERIC_ID_REGEX.test(geoId)) continue;
    const name = typeof entry.name === "string" ? entry.name : "";
    if (!name) continue;
    const statusInfo = (entry.status_info ?? {}) as Record<string, unknown>;
    tags.push({
      geoId,
      geoType: typeof geoRec.geo_type === "string" ? geoRec.geo_type.toUpperCase() : "",
      regionCode: typeof geoRec.region_code === "string" ? geoRec.region_code.toUpperCase() : "",
      description: typeof geoRec.description === "string" ? geoRec.description : null,
      name,
      status: typeof statusInfo.status === "string" ? statusInfo.status.toUpperCase() : null,
    });
  }
  return tags;
}

/** Strip TikTok's ",DMA®" suffix so a DMA tag name-matches the typed city text. */
function normalizeTikTokTagName(name: string): string {
  return name.replace(/,\s*DMA®?\s*$/i, "").trim().toLowerCase();
}

/** description-based rank: the actual municipality first, then DMA, then county. */
function tikTokCityDescriptionRank(tag: TikTokLocationTag): number {
  const d = (tag.description ?? "").toLowerCase();
  if (d === "city") return 0;
  if (tag.geoType === "DMA" || d.startsWith("dma")) return 1;
  if (d === "county") return 2;
  return 3;
}

/**
 * Pure filter + ranker over parsed targeting-search tags. Keeps ENABLED,
 * city-like (CITY/DISTRICT/DMA), country-scoped tags; ranks exact name matches
 * (DMA suffix stripped) first, then the actual municipality (description "City")
 * ahead of DMA and county, then alphabetical. Numeric geo_ids only — so the
 * chosen id drops straight into adgroup location_ids (never widened to country).
 */
export function pickTikTokCityMatches(
  tags: readonly TikTokLocationTag[],
  opts: { country?: string; q?: string; limit?: number } = {},
): TikTokLocationTag[] {
  const country = (opts.country ?? "").trim().toUpperCase();
  const q = (opts.q ?? "").trim().toLowerCase();
  const limit = opts.limit ?? 15;
  const matches = tags.filter((t) => {
    // A DISABLED / unavailable tag must never be offered as targetable.
    if (t.status !== null && t.status !== "ENABLED") return false;
    if (!TIKTOK_CITY_GEO_TYPES.includes(t.geoType)) return false;
    if (country && t.regionCode !== country) return false;
    return true;
  });
  const rankName = (t: TikTokLocationTag): number => {
    if (q.length === 0) return 2;
    const n = normalizeTikTokTagName(t.name);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    return 2;
  };
  matches.sort((a, b) => {
    const an = rankName(a);
    const bn = rankName(b);
    if (an !== bn) return an - bn;
    const ad = tikTokCityDescriptionRank(a);
    const bd = tikTokCityDescriptionRank(b);
    if (ad !== bd) return ad - bd;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return matches.slice(0, limit);
}

/**
 * Live tool/targeting/search read (FUZZY_SEARCH, POST) → the city location_ids
 * source for the Campaign Builder Audience step. Returns the ranked city-like
 * matches (pickTikTokCityMatches). READ-ONLY — creates nothing. promotion_type
 * is REQUIRED for TRAFFIC/LEAD_GENERATION/APP_PROMOTION/WEB_CONVERSIONS/
 * PRODUCT_SALES and MUST be omitted for REACH/VIDEO_VIEWS/ENGAGEMENT.
 */
export async function tiktokSearchCityLocations(
  client: TikTokClient,
  opts: {
    q: string;
    country?: string;
    objective?: string;
    promotionType?: string;
    placements?: readonly string[];
    limit?: number;
  },
): Promise<TikTokLocationTag[]> {
  const objective = opts.objective ?? "TRAFFIC";
  const params: Record<string, unknown> = {
    advertiser_id: client.advertiserId,
    objective_type: objective,
    placements: opts.placements ?? TIKTOK_DEFAULT_PLACEMENTS,
    search_type: "FUZZY_SEARCH",
    keywords: [opts.q],
    geo_types: TIKTOK_CITY_GEO_TYPES,
    ...(opts.country ? { region_codes: [opts.country.trim().toUpperCase()] } : {}),
  };
  if (!["REACH", "VIDEO_VIEWS", "ENGAGEMENT"].includes(objective)) {
    params.promotion_type = opts.promotionType ?? "WEBSITE";
  }
  const data = await tiktokApi(client, "POST", "tool/targeting/search/", params);
  const tags = parseTikTokTargetingSearch(data);
  return pickTikTokCityMatches(tags, { country: opts.country, q: opts.q, limit: opts.limit });
}

export interface TikTokInterestCategory {
  id: string;
  name: string;
  level: number | null;
}

/** Tolerant parser over a tool/interest_category payload (flat, one level). */
export function parseTikTokInterestCategories(payload: unknown): TikTokInterestCategory[] {
  const record = ((payload as { data?: unknown })?.data ?? payload ?? {}) as Record<string, unknown>;
  const raw = (Array.isArray(record.interest_categories)
    ? record.interest_categories
    : Array.isArray(record.list)
    ? record.list
    : Array.isArray(record.categories)
    ? record.categories
    : []) as Record<string, unknown>[];
  const out: TikTokInterestCategory[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const idRaw = entry.interest_category_id ?? entry.id;
    const id = typeof idRaw === "string" ? idRaw : typeof idRaw === "number" ? String(idRaw) : "";
    const name = typeof entry.interest_category_name === "string"
      ? entry.interest_category_name
      : typeof entry.name === "string"
      ? entry.name
      : "";
    if (!id || !name) continue;
    out.push({ id, name, level: typeof entry.level === "number" ? entry.level : null });
  }
  return out;
}

/** Live tool/interest_category read — the interest_category_ids source (READ-ONLY). */
export async function tiktokFetchInterestCategories(
  client: TikTokClient,
  opts: { placements?: readonly string[]; language?: string } = {},
): Promise<TikTokInterestCategory[]> {
  const data = await tiktokApi(client, "GET", "tool/interest_category/", {
    advertiser_id: client.advertiserId,
    placement: opts.placements ?? TIKTOK_DEFAULT_PLACEMENTS,
    language: opts.language ?? "en",
  });
  return parseTikTokInterestCategories(data);
}

/**
 * Filter interest categories by query (case-insensitive substring), prefix
 * matches first, capped. Pure — used by the search fn over live data.
 */
export function filterTikTokInterestCategories(
  categories: readonly TikTokInterestCategory[],
  opts: { q?: string; limit?: number } = {},
): TikTokInterestCategory[] {
  const q = (opts.q ?? "").trim().toLowerCase();
  const limit = opts.limit ?? 15;
  const matched = categories.filter((c) => q.length === 0 || c.name.toLowerCase().includes(q));
  matched.sort((a, b) => {
    const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });
  return matched.slice(0, limit);
}

/**
 * ISSUE-989 — validate builder-supplied interest_category_ids (numeric strings,
 * deduped, ≤ cap). Returns the clean array; invalid entries are dropped, never
 * fabricated. Empty/absent → [].
 */
export const TIKTOK_MAX_INTEREST_CATEGORY_IDS = 100;
export function normalizeTikTokInterestCategoryIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
    if (!id || !NUMERIC_ID_REGEX.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= TIKTOK_MAX_INTEREST_CATEGORY_IDS) break;
  }
  return out;
}

/** age_min/age_max → TikTok age_groups buckets (SPEC §4.3 helper). */
export const TIKTOK_AGE_GROUPS = [
  { key: "AGE_13_17", min: 13, max: 17 },
  { key: "AGE_18_24", min: 18, max: 24 },
  { key: "AGE_25_34", min: 25, max: 34 },
  { key: "AGE_35_44", min: 35, max: 44 },
  { key: "AGE_45_54", min: 45, max: 54 },
  { key: "AGE_55_100", min: 55, max: 100 },
] as const;

export function tiktokAgeGroupsForRange(ageMin?: number, ageMax?: number): string[] {
  const min = typeof ageMin === "number" ? ageMin : 18; // AGE_13_17 is restricted in US/UK/EEA/CA — never defaulted in
  const max = typeof ageMax === "number" ? ageMax : 100;
  return TIKTOK_AGE_GROUPS
    .filter((bucket) => bucket.max >= min && bucket.min <= max)
    .map((bucket) => bucket.key);
}

// ── Destination policy v1 (A1.0-5, PROOF D-P1) + utm_params (≤14) ─────────────

/**
 * Hosts that are smart links, not destinations. AppsFlyer serves crawlers an
 * app-install interstitial (D-P1: curl -A facebookexternalhit → 302 af-preview
 * with af_robot_sig) — a cloaking-pattern risk. The ad-visible URL is ALWAYS
 * the canonical public page; minglabiz.onelink.me is additionally DEAD on
 * Android (COMMS-0100/0101) and never used anywhere.
 */
export const TIKTOK_BLOCKED_LANDING_HOSTS: readonly string[] = [
  "go.usemingla.com",
  ".onelink.me",
];

export function validateTikTokLandingPageUrl(url: unknown): TikTokValidation {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) {
    return {
      ok: false,
      detail: "landing_page_url_invalid",
      message: "landing_page_url must be an https URL (the canonical public page).",
    };
  }
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return {
      ok: false,
      detail: "landing_page_url_invalid",
      message: "landing_page_url is not a valid URL.",
    };
  }
  const blocked = TIKTOK_BLOCKED_LANDING_HOSTS.some(
    (candidate) =>
      candidate.startsWith(".") ? host.endsWith(candidate) || host === candidate.slice(1) : host === candidate,
  );
  if (blocked) {
    return {
      ok: false,
      detail: "landing_page_smart_link_blocked",
      message:
        `landing_page_url must be the canonical dest_url, NEVER the OneLink (${host}) — AppsFlyer serves crawlers an app-install interstitial (cloaking-pattern risk, PROOF D-P1). Attribution rides in utm_params instead (A1.0-5).`,
    };
  }
  return { ok: true };
}

export const TIKTOK_MAX_UTM_PARAMS = 14;
export const TIKTOK_UTM_STANDARD_KEYS: readonly string[] = [
  "utm_source",
  "utm_medium",
  "utm_content",
  "utm_campaign",
];
export const TIKTOK_UTM_MACROS: readonly string[] = [
  "__CAMPAIGN_NAME__",
  "__CAMPAIGN_ID__",
  "__AID_NAME__",
  "__AID__",
  "__CID_NAME__",
  "__CID__",
  "__PLACEMENT__",
];
export const TIKTOK_UTM_KEY_MAX_CHARS = 100;
export const TIKTOK_UTM_VALUE_MAX_CHARS = 600;

export interface TikTokUtmParam {
  key: string;
  value: string;
}

/**
 * utm_params: ≤14 entries; keys are CASE-SENSITIVE (utm_source/utm_medium/
 * utm_content/utm_campaign or custom ≤100 chars); values ≤600 chars and may
 * use the TikTok serve-time macros (A1.0-5 / tiktok.md L470).
 */
export function validateTikTokUtmParams(params: unknown): TikTokValidation {
  if (params === undefined || params === null) return { ok: true };
  if (!Array.isArray(params)) {
    return {
      ok: false,
      detail: "utm_params_invalid",
      message: "utm_params must be an array of { key, value } entries.",
    };
  }
  if (params.length > TIKTOK_MAX_UTM_PARAMS) {
    return {
      ok: false,
      detail: "utm_params_too_many",
      message: `utm_params carries ${params.length} entries — TikTok's cap is ${TIKTOK_MAX_UTM_PARAMS}.`,
    };
  }
  for (const entry of params) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const key = record.key;
    const value = record.value;
    if (typeof key !== "string" || !key.trim() || typeof value !== "string") {
      return {
        ok: false,
        detail: "utm_params_invalid",
        message: "Each utm_params entry needs a non-empty string key and a string value.",
      };
    }
    // Case-sensitivity trap: "UTM_Source" is a CUSTOM key, not the standard one.
    if (
      !TIKTOK_UTM_STANDARD_KEYS.includes(key) && key.length > TIKTOK_UTM_KEY_MAX_CHARS
    ) {
      return {
        ok: false,
        detail: "utm_params_key_too_long",
        message: `utm_params key "${key.slice(0, 40)}…" exceeds ${TIKTOK_UTM_KEY_MAX_CHARS} chars.`,
      };
    }
    if (value.length > TIKTOK_UTM_VALUE_MAX_CHARS) {
      return {
        ok: false,
        detail: "utm_params_value_too_long",
        message: `utm_params value for "${key}" exceeds ${TIKTOK_UTM_VALUE_MAX_CHARS} chars.`,
      };
    }
  }
  return { ok: true };
}

// ── Identity gate (A1.1(f)/T-6, PROOF T-P5/T-P6 — TT_USER ONLY in v1) ─────────

export const TIKTOK_IDENTITY_TYPES = [
  "CUSTOMIZED_USER",
  "AUTH_CODE",
  "TT_USER",
  "BC_AUTH_TT",
] as const;

/**
 * HARD-FAIL before any TikTok call. Our advertiser was created 2026-04-12
 * (create_time 1776026274) — AFTER TikTok's 2026-01-15 cutoff: new accounts
 * cannot create non-Spark ads with Custom Identities on TikTok placements.
 * Legal options are exactly two — TT_USER (@usemingla, AVAILABLE) or
 * AUTH_CODE (Spark). TT_USER is the only viable non-Spark path — a
 * CONSTRAINT, not a preference. Spark (AUTH_CODE/BC_AUTH_TT) is a documented
 * fast-follow (GR-50), not v1.
 */
export function assertTikTokIdentityAllowed(identityType: string): void {
  if (identityType === "TT_USER") return;
  if (identityType === "CUSTOMIZED_USER") {
    throw new AdApiError({
      platform: "tiktok",
      code: "identity_customized_user_blocked",
      message:
        "identity_type=CUSTOMIZED_USER is ILLEGAL for this account: ad accounts created on/after 2026-01-15 cannot create non-Spark ads with Custom Identities on TikTok placements, and ours was created 2026-04-12 (PROOF T-P6). Use TT_USER (@usemingla — the only viable non-Spark path) or a Spark ad via creator AUTH_CODE. Note: aigc_disclosure_type is CUSTOMIZED_USER-only, so API-side AI-content self-disclosure is impossible on TikTok (escalated separately).",
    });
  }
  if (identityType === "AUTH_CODE" || identityType === "BC_AUTH_TT") {
    throw new AdApiError({
      platform: "tiktok",
      code: "identity_spark_not_supported",
      message:
        `identity_type=${identityType} (Spark) is a documented fast-follow (GR-50), not built in v1 — Spark Push needs dark_post_status/promotional_music_disabled/duet/stitch handling. Use TT_USER for now.`,
    });
  }
  throw new AdApiError({
    platform: "tiktok",
    code: "identity_invalid",
    message: `identity_type "${identityType}" is invalid — valid: ${
      TIKTOK_IDENTITY_TYPES.join(" | ")
    } (v1 accepts TT_USER only).`,
  });
}

// ── Pure body builders (unit-testable; the exact wire shapes; ALL DISABLE) ────

export interface TikTokCampaignSpec {
  name: string;
  objective: string;
  /** Minor units (cents). Present ⇒ CBO (budget on the campaign, ≥$50/day). */
  dailyBudgetCents?: number;
  /** Native idempotency (same request_id within 10s → only one create succeeds). */
  requestId?: string;
}

export function buildTikTokCampaignBody(
  advertiserId: string,
  spec: TikTokCampaignSpec,
): Record<string, unknown> {
  throwValidation(validateTikTokName(spec.name, "campaign_name"));
  throwValidation(validateTikTokObjective(spec.objective));
  const isCbo = typeof spec.dailyBudgetCents === "number" && spec.dailyBudgetCents > 0;
  const body: Record<string, unknown> = {
    advertiser_id: advertiserId,
    campaign_name: spec.name,
    objective_type: spec.objective,
    campaign_type: "REGULAR_CAMPAIGN",
    // A1.0-4 / GR-11: EVERYTHING is created paused — DISABLE at every level;
    // activation is only ever the explicit top-down launch. Deleting this
    // line is the fails-on-revert target of the DISABLE-invariant test.
    operation_status: "DISABLE",
  };
  if (isCbo) {
    // CBO — budget on the campaign; THE one cents→dollars conversion (A1.0-1);
    // the $50/day floor runs AFTER conversion, in dollars.
    const dollars = centsToPlatformBudget("tiktok", spec.dailyBudgetCents as number);
    throwValidation(validateTikTokBudgetFloor({ level: "campaign", mode: "daily", dollars }));
    body.budget_optimize_on = true;
    body.budget_mode = "BUDGET_MODE_DAY";
    body.budget = dollars;
  } else {
    // ABO — the budget lives on the ad group (§4.4b step 3).
    body.budget_mode = "BUDGET_MODE_INFINITE";
  }
  if (spec.requestId) body.request_id = spec.requestId;
  return body;
}

export interface TikTokAdGroupSpec {
  name: string;
  optimizationGoal: string;
  billingEvent: string;
  /** Minor units (cents). ABO daily/lifetime budget; OMITTED under CBO. */
  budgetCents?: number;
  budgetMode?: "daily" | "lifetime";
  /** True when the parent campaign was created with budget_optimize_on (CBO). */
  cboOnCampaign?: boolean;
  /** Campaign budget in cents — bid_price must be lower than BOTH budgets. */
  campaignBudgetCents?: number;
  /** REQUIRED under CBO; defaults to BID_TYPE_NO_BID (A1.1(b)). */
  bidType?: string;
  /** Minor units (cents); required when BID_TYPE_CUSTOM + CPC/CPM/CPV. */
  bidPriceCents?: number;
  /** Resolved numeric location ids (resolveTikTokGeo output — never ISO codes). */
  locationIds: string[];
  ageGroups?: string[];
  /** ISSUE-989 — resolved numeric interest_category_ids (tool/interest_category). */
  interestCategoryIds?: string[];
  gender?: string;
  scheduleType?: string;
  /** UTC+0 "YYYY-MM-DD HH:MM:SS" (T-1). Defaults to now for SCHEDULE_FROM_NOW. */
  scheduleStartTime?: string;
  scheduleEndTime?: string;
  dayparting?: string;
  placementType?: string;
  placements?: string[];
  pacing?: string;
  /** ISO country codes for the GAB geo-lock gate (informational; ids stay numeric). */
  countryCodes?: string[];
  requestId?: string;
  /** Injectable clock for tests. */
  nowMs?: number;
}

export const TIKTOK_GENDERS = ["GENDER_FEMALE", "GENDER_MALE", "GENDER_UNLIMITED"] as const;

export function buildTikTokAdGroupBody(
  advertiserId: string,
  campaignExternalId: string,
  spec: TikTokAdGroupSpec,
): Record<string, unknown> {
  throwValidation(validateTikTokName(spec.name, "adgroup_name"));
  if (!(TIKTOK_OPTIMIZATION_GOALS as readonly string[]).includes(spec.optimizationGoal)) {
    throw new AdApiError({
      platform: "tiktok",
      code: "optimization_goal_invalid",
      message: `optimization_goal "${spec.optimizationGoal}" is invalid — valid: ${
        TIKTOK_OPTIMIZATION_GOALS.join(" | ")
      }.`,
    });
  }
  if (!(TIKTOK_BILLING_EVENTS as readonly string[]).includes(spec.billingEvent)) {
    throw new AdApiError({
      platform: "tiktok",
      code: "billing_event_invalid",
      message: `billing_event "${spec.billingEvent}" is invalid — valid: ${
        TIKTOK_BILLING_EVENTS.join(" | ")
      }.`,
    });
  }
  throwValidation(validateTikTokLocationIds(spec.locationIds));

  const placementType = spec.placementType ?? TIKTOK_DEFAULT_PLACEMENT_TYPE;
  const placements = spec.placements ?? [...TIKTOK_DEFAULT_PLACEMENTS];
  if (placementType === "PLACEMENT_TYPE_NORMAL") {
    throwValidation(validateTikTokPlacements(placements, {
      optimizationGoal: spec.optimizationGoal,
      countryCodes: spec.countryCodes,
    }));
  }

  const budgetMode = spec.budgetMode ?? "daily";
  const scheduleType = spec.scheduleType ??
    (budgetMode === "lifetime" ? "SCHEDULE_START_END" : "SCHEDULE_FROM_NOW");
  if (budgetMode === "lifetime" && scheduleType !== "SCHEDULE_START_END") {
    // BUDGET_MODE_TOTAL forces SCHEDULE_START_END (tiktok.md §3.2).
    throw new AdApiError({
      platform: "tiktok",
      code: "schedule_type_invalid",
      message: "A lifetime budget (BUDGET_MODE_TOTAL) forces schedule_type=SCHEDULE_START_END.",
    });
  }
  const scheduleStartTime = spec.scheduleStartTime ??
    formatTikTokScheduleTime(new Date(spec.nowMs ?? Date.now()));
  throwValidation(validateTikTokSchedule({
    scheduleType,
    scheduleStartTime,
    scheduleEndTime: spec.scheduleEndTime ?? null,
    dayparting: spec.dayparting ?? null,
    nowMs: spec.nowMs,
  }));

  const body: Record<string, unknown> = {
    advertiser_id: advertiserId,
    campaign_id: campaignExternalId,
    adgroup_name: spec.name,
    optimization_goal: spec.optimizationGoal,
    billing_event: spec.billingEvent,
    // Ignored under CBO → forced SMOOTH anyway; required otherwise (§3.3).
    pacing: spec.pacing ?? "PACING_MODE_SMOOTH",
    placement_type: placementType,
    ...(placementType === "PLACEMENT_TYPE_NORMAL" ? { placements } : {}),
    location_ids: spec.locationIds,
    schedule_type: scheduleType,
    schedule_start_time: scheduleStartTime,
    ...(spec.scheduleEndTime ? { schedule_end_time: spec.scheduleEndTime } : {}),
    ...(spec.dayparting ? { dayparting: spec.dayparting } : {}),
    // A1.0-4: DISABLE at every level (fails-on-revert protected).
    operation_status: "DISABLE",
  };
  if (spec.ageGroups && spec.ageGroups.length > 0) body.age_groups = spec.ageGroups;
  // ISSUE-989: interest_category_ids (numeric ids from tool/interest_category);
  // omitted entirely when none are picked so broad targeting is unchanged.
  if (spec.interestCategoryIds && spec.interestCategoryIds.length > 0) {
    body.interest_category_ids = spec.interestCategoryIds;
  }
  if (spec.gender) {
    if (!(TIKTOK_GENDERS as readonly string[]).includes(spec.gender)) {
      throw new AdApiError({
        platform: "tiktok",
        code: "gender_invalid",
        message: `gender "${spec.gender}" is invalid — valid: ${TIKTOK_GENDERS.join(" | ")}.`,
      });
    }
    body.gender = spec.gender;
  }

  // ── Budget: ABO carries it here; under CBO it is OMITTED (§4.4b step 4 —
  //    the campaign owns the budget; ad-group budget is ignored under CBO). ──
  let adGroupBudgetDollars: number | null = null;
  if (spec.cboOnCampaign !== true) {
    if (typeof spec.budgetCents !== "number" || spec.budgetCents <= 0) {
      throw new AdApiError({
        platform: "tiktok",
        code: "budget_required",
        message: "An ABO ad group requires budget_cents (the campaign is BUDGET_MODE_INFINITE).",
      });
    }
    // THE one cents→dollars conversion (A1.0-1); floors AFTER conversion.
    adGroupBudgetDollars = centsToPlatformBudget("tiktok", spec.budgetCents);
    let scheduledDays: number | undefined;
    if (budgetMode === "lifetime") {
      const startMs = parseTikTokScheduleTime(scheduleStartTime) as number;
      const endMs = parseTikTokScheduleTime(spec.scheduleEndTime ?? "") ?? startMs;
      scheduledDays = tiktokScheduledDays(startMs, endMs);
    }
    throwValidation(validateTikTokBudgetFloor({
      level: "ad_group",
      mode: budgetMode,
      dollars: adGroupBudgetDollars,
      scheduledDays,
    }));
    body.budget_mode = budgetMode === "lifetime" ? "BUDGET_MODE_TOTAL" : "BUDGET_MODE_DAY";
    body.budget = adGroupBudgetDollars;
  }

  // ── Bidding (A1.1(b)/T-2): bid_type is REQUIRED under CBO — a CBO campaign
  //    built without it FAILS TikTok validation. Default BID_TYPE_NO_BID
  //    (lowest cost / max delivery — the correct start). Campaign-level
  //    bid_type is deprecated in v1.3 — bidding lives here ONLY.
  //    Deleting this default is the fails-on-revert target of the bid_type
  //    requirement test.
  if (spec.cboOnCampaign === true) {
    body.bid_type = spec.bidType ?? TIKTOK_DEFAULT_BID_TYPE;
  } else if (spec.bidType) {
    body.bid_type = spec.bidType;
  }
  const effectiveBidType = body.bid_type as string | undefined;
  if (effectiveBidType !== undefined) {
    if (!(TIKTOK_BID_TYPES as readonly string[]).includes(effectiveBidType)) {
      throw new AdApiError({
        platform: "tiktok",
        code: "bid_type_invalid",
        message: `bid_type "${effectiveBidType}" is invalid — the adapter owns the enum: ${
          TIKTOK_BID_TYPES.join(" | ")
        }.`,
      });
    }
    if (effectiveBidType === "BID_TYPE_CUSTOM") {
      const needsBidPrice = TIKTOK_BID_PRICE_BILLING_EVENTS.includes(spec.billingEvent);
      if (needsBidPrice && (typeof spec.bidPriceCents !== "number" || spec.bidPriceCents <= 0)) {
        throw new AdApiError({
          platform: "tiktok",
          code: "bid_price_required",
          message:
            `bid_type=BID_TYPE_CUSTOM with billing_event=${spec.billingEvent} requires bid_price_cents.`,
        });
      }
      if (typeof spec.bidPriceCents === "number" && spec.bidPriceCents > 0) {
        const bidDollars = centsToPlatformBudget("tiktok", spec.bidPriceCents);
        const campaignBudgetDollars = typeof spec.campaignBudgetCents === "number" &&
            spec.campaignBudgetCents > 0
          ? centsToPlatformBudget("tiktok", spec.campaignBudgetCents)
          : null;
        // bid_price must be LOWER than BOTH the campaign and ad-group budgets.
        if (adGroupBudgetDollars !== null && bidDollars >= adGroupBudgetDollars) {
          throw new AdApiError({
            platform: "tiktok",
            code: "bid_price_exceeds_budget",
            message:
              `bid_price $${bidDollars} must be LOWER than the ad-group budget $${adGroupBudgetDollars} (T-2).`,
          });
        }
        if (campaignBudgetDollars !== null && bidDollars >= campaignBudgetDollars) {
          throw new AdApiError({
            platform: "tiktok",
            code: "bid_price_exceeds_budget",
            message:
              `bid_price $${bidDollars} must be LOWER than the campaign budget $${campaignBudgetDollars} (T-2).`,
          });
        }
        body.bid_price = bidDollars;
      }
    }
  }
  if (spec.requestId) body.request_id = spec.requestId;
  return body;
}

export interface TikTokAdSpec {
  adName: string;
  /** v1: TT_USER ONLY (assertTikTokIdentityAllowed hard-fails everything else). */
  identityType: string;
  identityId: string;
  /** SINGLE_IMAGE (#866) or SINGLE_VIDEO (#997 C — a prepared ad video + cover). */
  adFormat?: string;
  /**
   * SINGLE_IMAGE: exactly 1 Asset-Library image_id.
   * SINGLE_VIDEO: exactly 1 image_id — the video COVER (external_ref_extra.cover_image_id).
   */
  imageIds: string[];
  /** SINGLE_VIDEO only (#997 C): the prepared ad video_id (external_ref_extra.video_id). */
  videoId?: string;
  adText: string;
  /** TikTok CTAs are bare display strings (TIKTOK_CTA_MAP) — default "Learn more". */
  callToAction?: string;
  /** A1.0-5: the canonical dest_url — NEVER the OneLink. */
  landingPageUrl: string;
  utmParams?: TikTokUtmParam[];
}

export function buildTikTokAdBody(
  advertiserId: string,
  adgroupExternalId: string,
  spec: TikTokAdSpec,
): Record<string, unknown> {
  // Identity FIRST — the hard account-class gate (T-6) precedes everything.
  assertTikTokIdentityAllowed(spec.identityType);
  if (!spec.identityId || !spec.identityId.trim()) {
    throw new AdApiError({
      platform: "tiktok",
      code: "identity_required",
      message: "identity_id is required for ad_create — no identity, no ad (tiktok.md §7.6).",
    });
  }
  throwValidation(validateTikTokName(spec.adName, "ad_name"));
  throwValidation(validateTikTokAdText(spec.adText));
  throwValidation(validateTikTokLandingPageUrl(spec.landingPageUrl));
  throwValidation(validateTikTokUtmParams(spec.utmParams));

  // ISSUE-997 C: SINGLE_VIDEO joins SINGLE_IMAGE. Everything else (SINGLE_CAROUSEL,
  // etc.) still hard-fails ad_format_unsupported_v1 (fails-on-revert protected).
  const adFormat = spec.adFormat ?? "SINGLE_IMAGE";
  if (adFormat !== "SINGLE_IMAGE" && adFormat !== "SINGLE_VIDEO") {
    throw new AdApiError({
      platform: "tiktok",
      code: "ad_format_unsupported_v1",
      message:
        `ad_format=${adFormat} is not built — only SINGLE_IMAGE (#866) and SINGLE_VIDEO (#997) are supported.`,
    });
  }
  // Both formats carry exactly ONE image_id: SINGLE_IMAGE the ad image, SINGLE_VIDEO
  // the video COVER (external_ref_extra.cover_image_id captured at prepare — #997 C).
  if (!Array.isArray(spec.imageIds) || spec.imageIds.length !== 1 || !spec.imageIds[0]) {
    throw new AdApiError({
      platform: "tiktok",
      code: "image_ids_invalid",
      message: adFormat === "SINGLE_VIDEO"
        ? "SINGLE_VIDEO requires exactly one image_id — the video cover (external_ref_extra.cover_image_id)."
        : "SINGLE_IMAGE requires exactly one Asset-Library image_id (tiktokUploadImage output).",
    });
  }
  const videoId = typeof spec.videoId === "string" ? spec.videoId.trim() : "";
  if (adFormat === "SINGLE_VIDEO" && !videoId) {
    throw new AdApiError({
      platform: "tiktok",
      code: "video_id_required",
      message:
        "SINGLE_VIDEO requires a prepared video_id (external_ref_extra.video_id from admin-ad-creative-prepare).",
    });
  }

  const creative: Record<string, unknown> = {
    ad_name: spec.adName,
    identity_type: spec.identityType,
    identity_id: spec.identityId,
    ad_format: adFormat,
    image_ids: spec.imageIds,
    // SINGLE_VIDEO carries the prepared ad video_id alongside the cover image_ids
    // (SUSPECTED/DOC wire shape — pinned by the PAUSED acceptance probe downstream).
    ...(adFormat === "SINGLE_VIDEO" ? { video_id: videoId } : {}),
    ad_text: spec.adText,
    call_to_action: spec.callToAction ?? TIKTOK_CTA_MAP.default,
    // A1.0-5 (PROOF D-P1): the ad-visible destination is the canonical public
    // page — NEVER the OneLink; attribution rides in utm_params.
    landing_page_url: spec.landingPageUrl,
    // A1.0-4 / T-8: the body's step-5 ENABLE was an internal contradiction —
    // the ad is created DISABLE like everything else (fails-on-revert protected).
    operation_status: "DISABLE",
  };
  if (spec.utmParams && spec.utmParams.length > 0) {
    creative.utm_params = spec.utmParams.map((p) => ({ key: p.key, value: p.value }));
  }
  return {
    advertiser_id: advertiserId,
    adgroup_id: adgroupExternalId,
    creatives: [creative],
  };
}

// ── Asset upload (A1.1(k)/GR-58 — UPLOAD_BY_URL; unique names; both ids) ──────

/**
 * File names must be UNIQUE per advertiser (else a duplicate-name error) —
 * derive from the URL basename + a timestamp suffix (GR-58; file_name_check
 * is the API-side pre-check, skipped here in favor of the always-unique name).
 */
export function tiktokUniqueFileName(imageUrl: string, nowMs = Date.now()): string {
  let base = "mingla-ad-image";
  try {
    const segments = new URL(imageUrl).pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    if (last) base = last.replace(/\.[a-z0-9]+$/i, "").slice(0, 80) || base;
  } catch {
    // keep the default base — the URL itself is validated by the caller
  }
  return `${base}-${nowMs}`;
}

export interface TikTokUploadedImage {
  imageId: string;
  /** #866 keys external_ref = material_id — persist BOTH (GR-58). */
  materialId: string | null;
}

/**
 * uploadImage → file/image/ad/upload (UPLOAD_BY_URL — the only URL path the
 * schema exposes; TikTok's fetcher has a 10-second timeout, so the bucket URL
 * must be public and fast). Returns BOTH image_id and material_id.
 */
export async function tiktokUploadImage(
  conn: AdConnectionRow,
  imageUrl: string,
): Promise<TikTokUploadedImage> {
  if (typeof imageUrl !== "string" || !/^https?:\/\//i.test(imageUrl)) {
    throw new AdApiError({
      platform: "tiktok",
      code: "image_url_invalid",
      message: "uploadImage needs a public http(s) image URL (UPLOAD_BY_URL).",
    });
  }
  const client = resolveTikTokClient(conn);
  const data = await tiktokApi(client, "POST", "file/image/ad/upload/", {
    advertiser_id: client.advertiserId,
    upload_type: "UPLOAD_BY_URL",
    image_url: imageUrl,
    file_name: tiktokUniqueFileName(imageUrl),
  });
  const imageId = typeof data.image_id === "string" ? data.image_id : "";
  if (!imageId) {
    throw new AdApiError({
      platform: "tiktok",
      code: "upload_no_image_id",
      message: "file/image/ad/upload returned OK but no image_id — refusing to build an ad on it.",
    });
  }
  return {
    imageId,
    materialId: typeof data.material_id === "string" ? data.material_id : null,
  };
}

// ── Status semantics (two-status rule; DELETE never expressible via setStatus) ─

/**
 * THE status writer: AdvertiserStatus can only be PAUSED|ACTIVE, and this map
 * can only produce ENABLE|DISABLE. DELETE exists on TikTok but is reachable
 * ONLY through the rollbackCampaign compensating-cleanup hook — no
 * launch/pause path can ever delete (interface-level rule, mirrors Google's
 * REMOVED-never).
 */
export function tiktokStatusForAdvertiserStatus(status: AdvertiserStatus): "ENABLE" | "DISABLE" {
  switch (status) {
    case "ACTIVE":
      return "ENABLE";
    case "PAUSED":
      return "DISABLE";
    default: {
      const never: never = status;
      throw new AdApiError({
        platform: "tiktok",
        code: "invalid_status",
        message:
          `Refusing to write status "${String(never)}" — the TikTok status writer emits ONLY ENABLE|DISABLE (DELETE is rollback-only).`,
      });
    }
  }
}

/** TikTok operation_status → engine status (CHECK: PAUSED|ACTIVE|ARCHIVED|DELETED). */
export function engineStatusFromTikTok(operationStatus: unknown): string | null {
  switch (operationStatus) {
    case "ENABLE":
      return "ACTIVE";
    case "DISABLE":
      return "PAUSED";
    case "DELETE":
      return "DELETED"; // read-side only — no write path emits it
    default:
      return null;
  }
}

// ── Launch warnings (A1.0-1 — BALANCE_EXCEED = 200 + warning, NEVER silent) ───

/**
 * Delivery-blocking secondary statuses. TikTok prefixes them per level
 * (CAMPAIGN_STATUS_/ADGROUP_STATUS_/AD_STATUS_) — normalize before matching.
 * BALANCE_EXCEED is TikTok's analog of Meta's PENDING_BILLING_INFO; AUDIT is
 * PENDING_REVIEW (two-status rule, tiktok.md L668).
 */
export const TIKTOK_WARNING_SECONDARY_STATUSES: readonly string[] = [
  "BALANCE_EXCEED",
  "NO_BUDGET",
  "BUDGET_EXCEED",
  "AUDIT",
  "REAUDIT",
  "AUDIT_DENY",
  "ADVERTISER_AUDIT",
  "ADVERTISER_AUDIT_DENY",
  "NOT_APPROVED",
];

export function normalizeTikTokSecondaryStatus(secondaryStatus: string): string {
  return secondaryStatus.replace(/^(CAMPAIGN_STATUS_|ADGROUP_STATUS_|AD_STATUS_)/, "");
}

/**
 * Maps a read-back secondary status to an actionable admin warning, or null
 * when delivery is healthy. Launch stays HTTP 200 — the delivery block is
 * TikTok's state, not our error, and it is NEVER silently clamped (A1.0-1).
 */
export function tiktokLaunchWarning(secondaryStatus: string | null): string | null {
  if (!secondaryStatus) return null;
  const normalized = normalizeTikTokSecondaryStatus(secondaryStatus);
  if (!TIKTOK_WARNING_SECONDARY_STATUSES.includes(normalized)) return null;
  if (normalized === "BALANCE_EXCEED" || normalized === "NO_BUDGET" || normalized === "BUDGET_EXCEED") {
    return `Launched, but delivery is blocked upstream: ${secondaryStatus}. ` +
      "Add funds in TikTok Ads Manager (Advanced Payment Portfolio) — the Marketing API balance field cannot see prepaid funds, so the UI is the source of truth (T-P3).";
  }
  if (normalized === "AUDIT_DENY" || normalized === "ADVERTISER_AUDIT_DENY" || normalized === "NOT_APPROVED") {
    return `Launched, but delivery is blocked upstream: ${secondaryStatus}. ` +
      "The ad (or advertiser) failed TikTok review — check the rejection detail in TikTok Ads Manager and appeal or edit the creative.";
  }
  return `Launched, but delivery is blocked upstream: ${secondaryStatus}. ` +
    "TikTok is reviewing the ad (most reviews complete within 24 hours).";
}

// ── Connect / preflight probes (SPEC §4.4a; PROOF T-P1…T-P5) ──────────────────

export interface TikTokAdvertiserSnapshot {
  advertiserId: string;
  name: string | null;
  company: string | null;
  currency: string | null;
  timezone: string | null;
  displayTimezone: string | null;
  status: string | null;
  /** API balance in account currency — BLIND to the Advanced Payment Portfolio (T-P3). */
  balance: number | null;
  ownerBcId: string | null;
}

export async function tiktokFetchAdvertiser(
  client: TikTokClient,
): Promise<TikTokAdvertiserSnapshot> {
  const data = await tiktokApi(client, "GET", "advertiser/info/", {
    advertiser_ids: [client.advertiserId],
  });
  const list = Array.isArray(data.list) ? data.list as Record<string, unknown>[] : [];
  const row = list.find((r) => String(r.advertiser_id ?? "") === client.advertiserId) ?? list[0];
  if (!row) {
    throw new AdApiError({
      platform: "tiktok",
      code: "advertiser_not_found",
      message:
        `advertiser/info returned no row for advertiser ${client.advertiserId} — the token cannot see the configured advertiser.`,
    });
  }
  const num = (v: unknown): number | null =>
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : null;
  return {
    advertiserId: String(row.advertiser_id ?? client.advertiserId),
    name: typeof row.name === "string" ? row.name : null,
    company: typeof row.company === "string" ? row.company : null,
    currency: typeof row.currency === "string" ? row.currency : null,
    timezone: typeof row.timezone === "string" ? row.timezone : null,
    displayTimezone: typeof row.display_timezone === "string" ? row.display_timezone : null,
    status: typeof row.status === "string" ? row.status : null,
    balance: num(row.balance),
    ownerBcId: typeof row.owner_bc_id === "string"
      ? row.owner_bc_id
      : typeof row.owner_bc_id === "number"
      ? String(row.owner_bc_id)
      : null,
  };
}

export interface TikTokIdentitySnapshot {
  identityId: string;
  identityType: string;
  username: string | null;
  displayName: string | null;
  availableStatus: string | null;
}

/** Read-only identity/get discovery. Preserves every normalized row and provider order. */
export async function tiktokFetchIdentities(
  client: TikTokClient,
): Promise<TikTokIdentitySnapshot[]> {
  const data = await tiktokApi(client, "GET", "identity/get/", {
    advertiser_id: client.advertiserId,
  });
  if (!Array.isArray(data.identity_list) && !Array.isArray(data.list)) {
    throw new AdApiError({
      platform: "tiktok",
      code: "provider_response_invalid",
      message: "TikTok returned an invalid identity discovery response.",
    });
  }
  const list = Array.isArray(data.identity_list)
    ? data.identity_list as Record<string, unknown>[]
    : Array.isArray(data.list)
    ? data.list as Record<string, unknown>[]
    : [];
  return list
    .filter((row) => typeof row.identity_id === "string" && typeof row.identity_type === "string")
    .map((row) => ({
      identityId: row.identity_id as string,
      identityType: row.identity_type as string,
      username: typeof row.username === "string" ? row.username : null,
      displayName: typeof row.display_name === "string" ? row.display_name : null,
      availableStatus: typeof row.available_status === "string" ? row.available_status : null,
    }));
}

/** identity/get — find the TT_USER identity (@usemingla) required by ad_create. */
export async function tiktokFetchIdentity(
  client: TikTokClient,
): Promise<TikTokIdentitySnapshot | null> {
  const identities = await tiktokFetchIdentities(client);
  const ttUsers = identities.filter((row) => row.identityType === "TT_USER");
  return ttUsers.find((row) => row.availableStatus === "AVAILABLE") ?? ttUsers[0] ?? null;
}

export interface TikTokPixelSnapshot {
  pixelId: string;
  pixelName: string | null;
  activityStatus: string | null;
  /** Zero events ⇒ conversion objectives stay gated until #865 (T-P4). */
  eventsCount: number;
}

/** pixel/list — informational for #865; traffic campaigns never use it. */
export async function tiktokFetchPixels(client: TikTokClient): Promise<TikTokPixelSnapshot[]> {
  const data = await tiktokApi(client, "GET", "pixel/list/", {
    advertiser_id: client.advertiserId,
  });
  const list = Array.isArray(data.pixels)
    ? data.pixels as Record<string, unknown>[]
    : Array.isArray(data.list)
    ? data.list as Record<string, unknown>[]
    : [];
  return list
    .filter((row) => typeof row.pixel_id === "string" || typeof row.pixel_id === "number")
    .map((row) => ({
      pixelId: String(row.pixel_id),
      pixelName: typeof row.pixel_name === "string" ? row.pixel_name : null,
      activityStatus: typeof row.activity_status === "string" ? row.activity_status : null,
      eventsCount: Array.isArray(row.events) ? row.events.length : 0,
    }));
}

// ── The adapter ───────────────────────────────────────────────────────────────

function assertNumericExternalId(level: EntityLevel, externalId: string): void {
  if (!NUMERIC_ID_REGEX.test(externalId)) {
    throw new AdApiError({
      platform: "tiktok",
      code: "invalid_external_id",
      message: `TikTok ${level} ids are numeric snowflakes; got "${externalId}".`,
    });
  }
}

const STATUS_UPDATE_PATHS: Record<EntityLevel, { path: string; idsKey: string }> = {
  campaign: { path: "campaign/status/update/", idsKey: "campaign_ids" },
  ad_set: { path: "adgroup/status/update/", idsKey: "adgroup_ids" },
  ad: { path: "ad/status/update/", idsKey: "ad_ids" },
};

const GET_PATHS: Record<EntityLevel, { path: string; idsKey: string }> = {
  campaign: { path: "campaign/get/", idsKey: "campaign_ids" },
  ad_set: { path: "adgroup/get/", idsKey: "adgroup_ids" },
  ad: { path: "ad/get/", idsKey: "ad_ids" },
};

async function tiktokReadEntity(
  client: TikTokClient,
  level: EntityLevel,
  externalId: string,
): Promise<Record<string, unknown>> {
  assertNumericExternalId(level, externalId);
  const { path, idsKey } = GET_PATHS[level];
  const data = await tiktokApi(client, "GET", path, {
    advertiser_id: client.advertiserId,
    filtering: { [idsKey]: [externalId] },
  });
  const list = Array.isArray(data.list) ? data.list as Record<string, unknown>[] : [];
  const row = list[0];
  if (!row) {
    throw new AdApiError({
      platform: "tiktok",
      code: "entity_not_found",
      message: `TikTok ${level} ${externalId} was not found on advertiser ${client.advertiserId}.`,
    });
  }
  return row;
}

/**
 * The generic-interface ad-set input carries the TikTok-shaped remainder in
 * `targeting` (exactly how the Meta adapter passes Meta-shaped targeting
 * through). Documented shape — the #864 builder constructs it.
 */
export interface TikTokAdGroupTargetingInput {
  location_ids?: string[];
  /** ISSUE-989 — numeric interest_category_ids from tool/interest_category. */
  interest_category_ids?: string[];
  age_groups?: string[];
  age_min?: number;
  age_max?: number;
  gender?: string;
  schedule_type?: string;
  schedule_start_time?: string;
  schedule_end_time?: string;
  dayparting?: string;
  placement_type?: string;
  placements?: string[];
  bid_type?: string;
  bid_price_cents?: number;
  campaign_budget_optimize_on?: boolean;
  campaign_budget_cents?: number;
  budget_mode?: "daily" | "lifetime";
  pacing?: string;
  country_codes?: string[];
  request_id?: string;
}

function adGroupSpecFromInterfaceInput(input: CreateAdSetInput): TikTokAdGroupSpec {
  const t = (input.targeting ?? {}) as TikTokAdGroupTargetingInput;
  const ageGroups = t.age_groups ??
    (t.age_min !== undefined || t.age_max !== undefined
      ? tiktokAgeGroupsForRange(t.age_min, t.age_max)
      : undefined);
  return {
    name: input.name,
    optimizationGoal: input.optimizationGoal,
    billingEvent: input.billingEvent,
    budgetCents: input.budgetCents,
    budgetMode: t.budget_mode,
    cboOnCampaign: t.campaign_budget_optimize_on === true,
    campaignBudgetCents: t.campaign_budget_cents,
    bidType: t.bid_type,
    bidPriceCents: t.bid_price_cents,
    locationIds: t.location_ids ?? [],
    interestCategoryIds: t.interest_category_ids,
    ageGroups,
    gender: t.gender,
    scheduleType: t.schedule_type,
    scheduleStartTime: t.schedule_start_time,
    scheduleEndTime: t.schedule_end_time,
    dayparting: t.dayparting,
    placementType: t.placement_type,
    placements: t.placements,
    pacing: t.pacing,
    countryCodes: t.country_codes,
    requestId: t.request_id,
  };
}

/** The TikTok-shaped extensions the interface createAd input must carry. */
export interface TikTokCreateAdExtensions {
  adText?: string;
  imageIds?: string[];
  landingPageUrl?: string;
  identityType?: string;
  identityId?: string;
  callToAction?: string;
  utmParams?: TikTokUtmParam[];
  adFormat?: string;
  /** SINGLE_VIDEO only (#997 C): the prepared ad video_id. */
  videoId?: string;
}

export const tiktokAdapter: ChannelAdapter = {
  platform: "tiktok",

  // deno-lint-ignore require-await
  connect: async (conn: AdConnectionRow): Promise<AuthedClient> => {
    // Fail-close FIRST: an unset token throws AdNotConnectedError here.
    return resolveTikTokClient(conn);
  },

  createCampaign: async (conn, input: CreateCampaignInput) => {
    // Fail-close FIRST (RT-1): the token resolves BEFORE any input validation,
    // so a broken connection always surfaces 424 tiktok_not_connected.
    const client = resolveTikTokClient(conn);
    const body = buildTikTokCampaignBody(client.advertiserId, {
      name: input.name,
      objective: input.objective,
      dailyBudgetCents: input.dailyBudgetCents,
    });
    const data = await tiktokApi(client, "POST", "campaign/create/", body);
    const externalId = typeof data.campaign_id === "string"
      ? data.campaign_id
      : typeof data.campaign_id === "number"
      ? String(data.campaign_id)
      : "";
    if (!externalId) {
      throw new AdApiError({
        platform: "tiktok",
        code: "create_no_id",
        message: "campaign/create returned code 0 but no campaign_id — refusing to persist.",
      });
    }
    return { externalId, status: "PAUSED" };
  },

  createAdSet: async (conn, campaignExternalId, input: CreateAdSetInput) => {
    const client = resolveTikTokClient(conn); // fail-close first
    assertNumericExternalId("campaign", campaignExternalId);
    const body = buildTikTokAdGroupBody(
      client.advertiserId,
      campaignExternalId,
      adGroupSpecFromInterfaceInput(input),
    );
    const data = await tiktokApi(client, "POST", "adgroup/create/", body);
    const externalId = typeof data.adgroup_id === "string"
      ? data.adgroup_id
      : typeof data.adgroup_id === "number"
      ? String(data.adgroup_id)
      : "";
    if (!externalId) {
      throw new AdApiError({
        platform: "tiktok",
        code: "create_no_id",
        message: "adgroup/create returned code 0 but no adgroup_id — refusing to persist.",
      });
    }
    return { externalId };
  },

  /**
   * Documented NO-OP (A1.0-2): TikTok has NO standalone creative entity — the
   * creative is inline in ad/create (buildTikTokAdBody). Present (not absent)
   * so the atomic runner records the platform's explicit "nothing to create
   * here" rather than skipping silently; it never returns an id.
   */
  // deno-lint-ignore require-await
  createCreative: async () => {
    return {};
  },

  createAd: async (conn, adSetExternalId, input: CreateAdInput) => {
    const client = resolveTikTokClient(conn); // fail-close first
    assertNumericExternalId("ad_set", adSetExternalId);
    const extensions = input as CreateAdInput & TikTokCreateAdExtensions;
    const connExtra = (conn.extra ?? {}) as Record<string, unknown>;
    const identityType = extensions.identityType ??
      (typeof connExtra.identity_type === "string" ? connExtra.identity_type : "TT_USER");
    const identityId = extensions.identityId ??
      (typeof connExtra.identity_id === "string" ? connExtra.identity_id : "");
    if (
      typeof extensions.adText !== "string" || !Array.isArray(extensions.imageIds) ||
      typeof extensions.landingPageUrl !== "string"
    ) {
      throw new AdApiError({
        platform: "tiktok",
        code: "tiktok_ad_input_incomplete",
        message:
          "TikTok ad create needs the inline creative fields (adText, imageIds, landingPageUrl — TikTokCreateAdExtensions); the creative has no standalone object on TikTok.",
      });
    }
    const body = buildTikTokAdBody(client.advertiserId, adSetExternalId, {
      adName: input.name,
      identityType,
      identityId,
      adFormat: extensions.adFormat,
      imageIds: extensions.imageIds,
      videoId: extensions.videoId,
      adText: extensions.adText,
      callToAction: extensions.callToAction,
      landingPageUrl: extensions.landingPageUrl,
      utmParams: extensions.utmParams,
    });
    const data = await tiktokApi(client, "POST", "ad/create/", body);
    const adIds = Array.isArray(data.ad_ids) ? data.ad_ids : [];
    const first = adIds[0];
    const externalId = typeof first === "string"
      ? first
      : typeof first === "number"
      ? String(first)
      : "";
    if (!externalId) {
      throw new AdApiError({
        platform: "tiktok",
        code: "create_no_id",
        message: "ad/create returned code 0 but no ad_ids — refusing to persist.",
      });
    }
    return { externalId, reviewStatus: null };
  },

  setStatus: async (conn, level, externalId, status: AdvertiserStatus) => {
    const client = resolveTikTokClient(conn); // fail-close first
    assertNumericExternalId(level, externalId);
    const { path, idsKey } = STATUS_UPDATE_PATHS[level];
    await tiktokApi(client, "POST", path, {
      advertiser_id: client.advertiserId,
      [idsKey]: [externalId],
      operation_status: tiktokStatusForAdvertiserStatus(status),
    });
  },

  getStatus: async (conn, level, externalId) => {
    const client = resolveTikTokClient(conn); // fail-close first
    const row = await tiktokReadEntity(client, level, externalId);
    const secondary = typeof row.secondary_status === "string" ? row.secondary_status : null;
    return {
      // Two-status rule: operation_status (advertiser-set) normalizes into the
      // engine vocabulary; the raw secondary/delivery status rides alongside —
      // the UI badge reads the SECONDARY (tiktok.md L668).
      status: engineStatusFromTikTok(row.operation_status),
      effectiveStatus: secondary,
      issuesInfo: null, // ad_review_info reject-reason ingestion is a documented fast-follow
      adReviewFeedback: null,
    };
  },

  setBudget: async (
    conn,
    level,
    externalId,
    cents,
    opts?: { learning?: boolean; lastBudgetChangeAt?: string | null },
  ) => {
    if (level === "ad") {
      throw new AdApiError({
        platform: "tiktok",
        code: "unsupported_level",
        message: "TikTok budgets live on the campaign (CBO) or ad group — never the ad.",
      });
    }
    const client = resolveTikTokClient(conn); // fail-close first
    assertNumericExternalId(level, externalId);
    // THE one cents→dollars conversion point (A1.0-1); floors AFTER conversion.
    const dollars = centsToPlatformBudget("tiktok", cents);
    throwValidation(validateTikTokBudgetFloor({
      level: level === "campaign" ? "campaign" : "ad_group",
      mode: "daily",
      dollars,
    }));
    // Read the live current budget so the ≤40%-learning / ≤30%-after caps are
    // enforced against platform truth (never a silent clamp — a violation is
    // a loud, normalized error). Learning state + last-change time are
    // engine-owned; when unknown the conservative 30% cap applies.
    const row = await tiktokReadEntity(client, level, externalId);
    const currentBudget = typeof row.budget === "number" ? row.budget : null;
    const budgetMode = typeof row.budget_mode === "string" ? row.budget_mode : null;
    if (budgetMode === "BUDGET_MODE_INFINITE" || currentBudget === null || currentBudget <= 0) {
      throw new AdApiError({
        platform: "tiktok",
        code: "budget_not_editable",
        message: level === "campaign"
          ? "This campaign is ABO (BUDGET_MODE_INFINITE) — its budget lives on the ad group; update that instead."
          : "The ad group has no editable budget (it is governed by the campaign's CBO budget).",
      });
    }
    throwValidation(validateTikTokBudgetUpdate({
      currentBudgetDollars: currentBudget,
      newBudgetDollars: dollars,
      learning: opts?.learning ?? false,
      lastBudgetChangeAt: opts?.lastBudgetChangeAt ?? null,
    }));
    const updatePath = level === "campaign" ? "campaign/update/" : "adgroup/update/";
    const idKey = level === "campaign" ? "campaign_id" : "adgroup_id";
    await tiktokApi(client, "POST", updatePath, {
      advertiser_id: client.advertiserId,
      [idKey]: externalId,
      budget: dollars,
    });
  },

  /**
   * §4.4b compensating cleanup — the ONLY path that can express DELETE:
   * campaign/status/update operation_status=DELETE cascades the ad group and
   * ad (SPEC §4.0). Used exclusively by the atomic-create failure path.
   */
  rollbackCampaign: async (conn, campaignExternalId) => {
    const client = resolveTikTokClient(conn);
    assertNumericExternalId("campaign", campaignExternalId);
    await tiktokApi(client, "POST", "campaign/status/update/", {
      advertiser_id: client.advertiserId,
      campaign_ids: [campaignExternalId],
      operation_status: "DELETE",
    });
  },

  // rollbackCreative is deliberately ABSENT: the creative is inline in
  // ad/create (no account-level residue can exist — QA P2-5 does not apply).
};
