/**
 * adCreative.ts — ISSUE-866 WP3 [Full Rooms Ad Engine — Creative Library].
 *
 * SPEC: Mingla_Artifacts/specs/SPEC_ISSUE-866_CREATIVE_LIBRARY.md §4.3 as
 * superseded by Amendment A1 (BINDING: A1-1…A1-10), consuming the merged WP1
 * seams (_shared/adChannel.ts + _shared/meta.ts — imported, NEVER modified).
 *
 * One shared module, three responsibilities:
 *   1. resolveCreativeRef — the single entry point every channel engine calls
 *      at ad-create: cache-first per (creative_id, platform, lane,
 *      external_account_id), CONTENT-HASH keyed (A1-1: a cached `ready` ref is
 *      returned ONLY when its content_hash snapshot matches the creative's),
 *      fail-close on connection/creative/validation/upload failure — no ad is
 *      ever written against an unresolved creative.
 *   2. Per-platform upload adapters:
 *        uploadToMeta    — /adimages (bytes → image_hash) · /advideos + poll
 *                          video_status='ready' + poster → thumbnail hash
 *        uploadToTikTok  — UPLOAD_BY_URL + file_name_check/timestamp-suffix;
 *                          captures BOTH raw id AND material_id (A1-9)
 *        uploadToSnap    — mint token per call (NO static token exists — A1-2);
 *                          media create → multipart/form-data bytes ≤32 MB or
 *                          chunked multipart-upload-v2 >32 MB; poll READY;
 *                          request_status AND every sub_request_status asserted
 *                          (A1-3)
 *        uploadToGoogle  — image: bytes-only PRE-CROPPED per ratio slot,
 *                          ≤5,120 KB JPG/PNG, unique auto-suffixed names
 *                          (A1-5); video: YouTubeVideoUploadService resumable
 *                          REST start/upload/finalize + poll
 *                          PENDING→UPLOADED→PROCESSED (A1-4)
 *        uploadToReddit  — FAIL-CLOSE STUB (A1-1: there is NO media id on a
 *                          Reddit ad — the creative is an async structured-post
 *                          job owned by the Reddit spec, not built here)
 *   3. The COMMS-0102 crawler-permissiveness check: Meta ad review DOWNLOADS
 *      the creative image_url — robots-blocked hosts hard-fail creative
 *      validation (proven live, subcode 3858258). Creative-serving URLs are
 *      probed with a crawler UA + a robots.txt evaluation before recording.
 *
 * SECURITY (SC-SEC-1): tokens are resolved from Deno.env by NAME per call;
 * minted access tokens (Snap/Google) live in memory only — never persisted,
 * logged, or echoed. Error text is scrubbed before it reaches any row/client.
 *
 * All network I/O accepts an injectable fetch (deps.fetchImpl) — the WP3 test
 * suites run with ZERO live platform calls (the tester owns live legs).
 */

import {
  AdApiError,
  type AdConnectionRow,
  type Lane,
  type Platform,
} from "./adChannel.ts";
import { metaGraph, resolveMetaClient, scrubMetaTokens } from "./meta.ts";
import { resolveRuntimeString } from "./runtimeConfig.ts";
import {
  type ChannelValidationResult,
  classifyRatio,
  type CreativeMediaFacts,
  GOOGLE_IMAGE_MAX_BYTES,
  GOOGLE_IMAGE_SLOTS,
  validateCreativeForChannel,
} from "./adCreativeMatrix.ts";

// ── Row shapes ────────────────────────────────────────────────────────────────

/** A per-ratio pre-cropped variant slot (A1-6c; ad_creatives.variants). */
export interface CreativeVariantSlot {
  source_url: string;
  storage_path?: string;
  width: number;
  height: number;
  content_hash: string;
  byte_size?: number;
}

/** The ad_creatives row the adapters consume (probe-populated — A1-6a). */
export interface AdCreativeRow {
  id: string;
  kind: "image" | "video";
  name: string;
  source_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  bunny_video_id: string | null;
  poster_url: string | null;
  mp4_master_url: string | null;
  place_id: string | null;
  brand_id: string | null;
  width: number | null;
  height: number | null;
  aspect_ratio: number | null;
  duration_seconds: number | null;
  mime_type: string | null;
  byte_size: number | null;
  has_audio: boolean | null;
  content_hash: string;
  poster_content_hash?: string | null;
  ai_generated: boolean;
  variants: Record<string, CreativeVariantSlot>;
  status: "active" | "archived";
}

export interface CreativeRefRow {
  id: string;
  creative_id: string;
  platform: Platform;
  lane: Lane;
  external_account_id: string;
  external_kind: "image" | "video";
  external_ref: string | null;
  external_ref_extra: Record<string, unknown>;
  content_hash: string;
  status: "pending" | "uploading" | "processing" | "ready" | "failed" | "timed_out";
  error: string | null;
  uploaded_at: string | null;
  /**
   * QA F-2: the lock-staleness signal — a row parked at status='uploading'
   * whose updated_at is older than STALE_LOCK_TAKEOVER_MS is acquirable
   * (crashed holder). Optional so pre-rework in-memory fakes stay valid;
   * absent/undefined reads as FRESH (never silently take over an unknown-age
   * lock).
   */
  updated_at?: string | null;
}

/** §4.3 UploadedRef — what resolveCreativeRef hands the channel engine. */
export interface CreativeUploadedRef {
  external_kind: "image" | "video";
  external_ref: string;
  external_ref_extra: Record<string, unknown>;
  external_account_id: string;
}

/** §4.3 LaneContext — env-var NAMES only, never values. */
export interface LaneContext {
  lane: Lane;
  external_account_id: string;
  tokenEnvVar: string;
  pageId?: string;
  connection?: AdConnectionRow;
}

/** Injectable I/O seams — the WP3 suites run with ZERO live platform calls. */
export interface CreativeUploadDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface CreativeUploadAdapter {
  readonly platform: Platform;
  upload(
    asset: AdCreativeRow,
    ctx: LaneContext,
    deps?: CreativeUploadDeps,
  ): Promise<CreativeUploadedRef>;
}

// ── Errors (all fail-close; none ever carries a token) ────────────────────────

export class CreativeConnectionError extends Error {
  readonly platform: Platform;
  readonly detail: string;
  constructor(platform: Platform, detail: string, message: string) {
    super(message);
    this.name = "CreativeConnectionError";
    this.platform = platform;
    this.detail = detail;
  }
}

export class CreativeNotFoundError extends Error {
  readonly detail: string;
  constructor(detail: string, message: string) {
    super(message);
    this.name = "CreativeNotFoundError";
    this.detail = detail;
  }
}

/** Matrix rejects (or a needs_transcode block) — fail-close BEFORE any upload. */
export class CreativeValidationError extends Error {
  readonly platform: Platform;
  readonly needsTranscode: boolean;
  readonly result: ChannelValidationResult;
  constructor(platform: Platform, result: ChannelValidationResult, message: string) {
    super(message);
    this.name = "CreativeValidationError";
    this.platform = platform;
    this.needsTranscode = result.needsTranscode;
    this.result = result;
  }
}

export class CreativeUploadError extends Error {
  readonly platform: Platform;
  readonly detail: string;
  constructor(platform: Platform, detail: string, message: string) {
    super(message);
    this.name = "CreativeUploadError";
    this.platform = platform;
    this.detail = detail;
  }
}

/** A concurrent resolve holds the (creative, platform, lane, account) lock — retryable. */
export class CreativeRefLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreativeRefLockedError";
  }
}

/** A1-1: the Reddit lane stub (and any unprovisioned lane) — typed fail-close. */
export class CreativeLaneNotProvisionedError extends Error {
  readonly platform: Platform;
  constructor(platform: Platform, message: string) {
    super(message);
    this.name = "CreativeLaneNotProvisionedError";
    this.platform = platform;
  }
}

/** A1-3 step 3: no MP4 byte source resolvable for a Snap/Google-bound video. */
export class CreativeByteSourceError extends Error {
  readonly detail: string;
  constructor(detail: string, message: string) {
    super(message);
    this.name = "CreativeByteSourceError";
    this.detail = detail;
  }
}

/** Client-safe normalized error — a token is NEVER logged or echoed (§4.3). */
export function normalizeCreativeError(
  platform: Platform,
  err: unknown,
): { platform: Platform; code: string | number | null; message: string } {
  if (err instanceof AdApiError) {
    return { platform, code: err.code, message: scrubCreativeSecrets(err.message) };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { platform, code: null, message: scrubCreativeSecrets(message) };
}

/** Defense-in-depth: scrub Meta EAA… tokens and any Bearer credential shape. */
export function scrubCreativeSecrets(text: string): string {
  return scrubMetaTokens(text).replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/g, "Bearer [redacted]");
}

// ── Byte sourcing (A1-3) ──────────────────────────────────────────────────────

/**
 * Edge-memory guard for whole-buffer fetches (probe + upload). Deno edge
 * functions have bounded memory; beyond this the resolve fails CLOSE with a
 * typed error instead of OOMing mid-upload. Recorded as a WP3 runtime limit.
 */
export const CREATIVE_FETCH_MAX_BYTES = 64 * 1024 * 1024;

export async function fetchCreativeBytes(
  url: string,
  deps: CreativeUploadDeps = {},
  maxBytes = CREATIVE_FETCH_MAX_BYTES,
): Promise<Uint8Array> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CreativeByteSourceError(
      "byte_source_unreachable",
      `Could not fetch creative bytes from ${url}: ${detail}`,
    );
  }
  if (!response.ok) {
    throw new CreativeByteSourceError(
      "byte_source_http_error",
      `Creative byte source ${url} returned HTTP ${response.status}.`,
    );
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new CreativeByteSourceError(
      "byte_source_too_large",
      `Creative source is ${declared} bytes — over the ${maxBytes}-byte edge buffer guard. ` +
        "Supply a smaller MP4 master or route this asset through a non-edge upload path.",
    );
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new CreativeByteSourceError(
      "byte_source_too_large",
      `Creative source is ${buffer.byteLength} bytes — over the ${maxBytes}-byte edge buffer guard.`,
    );
  }
  return buffer;
}

/**
 * A1-3 step 3: Bunny Stream serves HLS, not a downloadable MP4 — Snap ingests
 * raw bytes and Google's YouTube upload needs bytes. Resolution order: the
 * explicit mp4_master_url, else a source_url that IS a direct MP4. Anything
 * else fails CLOSE (resolver-enforced, not a DB CHECK — Meta/TikTok-only
 * videos never hit this).
 */
export function resolveVideoByteSourceUrl(asset: AdCreativeRow): string {
  if (asset.mp4_master_url) return asset.mp4_master_url;
  if (asset.source_url && /\.mp4(\?|#|$)/i.test(asset.source_url)) return asset.source_url;
  throw new CreativeByteSourceError(
    "video_mp4_source_unresolvable",
    "No MP4 byte source: Bunny serves HLS, and Snapchat/Google ingest raw bytes. " +
      "Set ad_creatives.mp4_master_url (or a direct-MP4 rendition URL) for this video (A1-3).",
  );
}

// ── COMMS-0102: crawler-permissive creative URLs ──────────────────────────────

export const META_CRAWLER_UA =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

export interface CrawlerCheckResult {
  url: string;
  /** fail = Meta creative validation WILL hard-fail (subcode 3858258). */
  tier: "pass" | "warn" | "fail";
  robotsBlocked: boolean;
  httpStatus: number | null;
  contentType: string | null;
  detail: string;
}

interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

/** Minimal robots.txt evaluation: longest-path match; tie → allow. */
export function robotsDisallows(robotsTxt: string, userAgentToken: string, path: string): boolean {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (field === "user-agent") {
      if (!lastWasAgent || current === null) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "disallow" || field === "allow") {
      if (current) current.rules.push({ allow: field === "allow", path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }

  const token = userAgentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const applicable = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; length: number } | null = null;
  for (const group of applicable) {
    for (const rule of group.rules) {
      if (rule.path === "") continue; // empty Disallow = allow all
      if (!path.startsWith(rule.path)) continue;
      const length = rule.path.length;
      if (
        best === null || length > best.length ||
        (length === best.length && rule.allow && !best.allow)
      ) {
        best = { allow: rule.allow, length };
      }
    }
  }
  return best !== null && !best.allow;
}

/**
 * COMMS-0102 (proven live, subcode 3858258): Meta ad review DOWNLOADS the
 * creative image_url at validate/create time and robots-blocked hosts
 * hard-fail. Two probes: (1) robots.txt must not disallow the crawler UA for
 * the path; (2) a crawler-UA fetch must return 200 with a media content-type.
 * `strict=true` (the Meta lane) maps failures to tier "fail"; other channels
 * get "warn" (their fetch behavior is not live-proven the way Meta's is).
 */
export async function checkCreativeUrlCrawlerAccessible(
  url: string,
  opts: { deps?: CreativeUploadDeps; userAgent?: string; strict?: boolean } = {},
): Promise<CrawlerCheckResult> {
  const fetchImpl = opts.deps?.fetchImpl ?? fetch;
  const userAgent = opts.userAgent ?? META_CRAWLER_UA;
  const strict = opts.strict ?? true;
  const failTier = strict ? "fail" : "warn";

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      url,
      tier: "fail",
      robotsBlocked: false,
      httpStatus: null,
      contentType: null,
      detail: "Not a valid absolute URL.",
    };
  }

  // 1. robots.txt — a missing/unreadable robots.txt is allow-all.
  let robotsBlocked = false;
  try {
    const robotsResponse = await fetchImpl(`${parsed.origin}/robots.txt`, {
      headers: { "User-Agent": userAgent },
    });
    if (robotsResponse.ok) {
      const robotsTxt = await robotsResponse.text();
      robotsBlocked = robotsDisallows(robotsTxt, "facebookexternalhit", parsed.pathname);
    }
  } catch {
    robotsBlocked = false;
  }
  if (robotsBlocked) {
    return {
      url,
      tier: failTier,
      robotsBlocked: true,
      httpStatus: null,
      contentType: null,
      detail:
        "robots.txt disallows the Meta crawler for this path — Meta ad review downloads creative URLs and " +
        "robots-blocked hosts hard-fail creative validation (COMMS-0102, subcode 3858258). Serve ad media from a crawler-permissive host (Cloudinary passes today).",
    };
  }

  // 2. Crawler-UA fetch of the asset itself.
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { "User-Agent": userAgent } });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      url,
      tier: failTier,
      robotsBlocked: false,
      httpStatus: null,
      contentType: null,
      detail: `Crawler-UA fetch failed: ${detail}`,
    };
  }
  const contentType = response.headers.get("content-type");
  if (!response.ok) {
    return {
      url,
      tier: failTier,
      robotsBlocked: false,
      httpStatus: response.status,
      contentType,
      detail:
        `Crawler-UA fetch returned HTTP ${response.status} — Meta's review crawler will see the same and hard-fail the creative (COMMS-0102).`,
    };
  }
  const isMedia = typeof contentType === "string" &&
    (contentType.startsWith("image/") || contentType.startsWith("video/") ||
      contentType.startsWith("application/octet-stream"));
  if (!isMedia) {
    return {
      url,
      tier: "warn",
      robotsBlocked: false,
      httpStatus: response.status,
      contentType,
      detail:
        `Crawler-UA fetch returned content-type "${contentType ?? "none"}" — expected image/* or video/*. Interstitials/HTML here break platform ingestion.`,
    };
  }
  return {
    url,
    tier: "pass",
    robotsBlocked: false,
    httpStatus: response.status,
    contentType,
    detail: "Crawler-permissive: robots allows facebookexternalhit and the asset serves media directly.",
  };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function requireEnv(name: string, platform: Platform): string {
  const value = (Deno.env.get(name) ?? "").trim();
  if (!value) {
    throw new CreativeConnectionError(
      platform,
      `${platform}_not_connected`,
      `Missing edge secret ${name} — set it in Supabase Edge Function Secrets, then reconnect.`,
    );
  }
  return value;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === "object" && !Array.isArray(value))
    ? value as Record<string, unknown>
    : {};
}

function factsFromRow(asset: AdCreativeRow): CreativeMediaFacts {
  return {
    kind: asset.kind,
    mimeType: asset.mime_type,
    container: null,
    width: asset.width,
    height: asset.height,
    aspectRatio: asset.aspect_ratio,
    durationSeconds: asset.duration_seconds,
    hasAudio: asset.has_audio,
    byteSize: asset.byte_size,
    overallBitrateKbps: asset.byte_size && asset.duration_seconds && asset.duration_seconds > 0
      ? Math.round((asset.byte_size * 8) / asset.duration_seconds / 1000)
      : null,
    posterPresent: asset.poster_url !== null,
    variantRatios: Object.keys(asset.variants ?? {}),
  };
}

// ── uploadToMeta (§4.3 as reconfirmed by A1-10) ───────────────────────────────

export const META_VIDEO_POLL_INTERVAL_MS = 2_000;
export const META_VIDEO_POLL_MAX_ATTEMPTS = 60; // ≈2 min — then FAIL CLOSE (A1-10)

async function metaUploadImageBytes(
  client: ReturnType<typeof resolveMetaClient>,
  accountId: string,
  bytes: Uint8Array,
): Promise<string> {
  const payload = await metaGraph(client, "POST", `act_${accountId}/adimages`, {
    bytes: bytesToBase64(bytes),
  });
  const images = asRecord(payload.images);
  for (const value of Object.values(images)) {
    const hash = asRecord(value).hash;
    if (typeof hash === "string" && hash) return hash;
  }
  throw new CreativeUploadError(
    "meta",
    "meta_image_hash_missing",
    "Meta /adimages returned no image hash.",
  );
}

export const metaCreativeAdapter: CreativeUploadAdapter = {
  platform: "meta",
  upload: async (asset, ctx, deps = {}): Promise<CreativeUploadedRef> => {
    const client = resolveMetaClient(ctx.connection ?? null, ctx.lane);
    const accountId = ctx.external_account_id || client.config.adAccountId;
    const sleep = deps.sleep ?? defaultSleep;

    if (asset.kind === "image") {
      if (!asset.source_url) {
        throw new CreativeByteSourceError("image_source_missing", "Image creative has no source_url.");
      }
      const bytes = await fetchCreativeBytes(asset.source_url, deps);
      const hash = await metaUploadImageBytes(client, accountId, bytes);
      return {
        external_kind: "image",
        external_ref: hash,
        external_ref_extra: {},
        external_account_id: accountId,
      };
    }

    // Video: /advideos (file_url) → poll video_status='ready' → poster → thumbnail hash.
    const fileUrl = asset.mp4_master_url ?? asset.source_url;
    if (!fileUrl) {
      throw new CreativeByteSourceError("video_source_missing", "Video creative has no fetchable URL.");
    }
    const created = await metaGraph(client, "POST", `act_${accountId}/advideos`, {
      file_url: fileUrl,
      name: asset.name,
    });
    const videoId = String(created.id ?? "");
    if (!videoId) {
      throw new CreativeUploadError("meta", "meta_video_id_missing", "Meta /advideos returned no id.");
    }

    // A1-10: bounded poll; a video stuck in transcoding FAILS CLOSE (no-orphan).
    let ready = false;
    for (let attempt = 0; attempt < META_VIDEO_POLL_MAX_ATTEMPTS; attempt++) {
      const status = await metaGraph(client, "GET", videoId, { fields: "status" });
      const videoStatus = asRecord(status.status).video_status;
      if (videoStatus === "ready") {
        ready = true;
        break;
      }
      if (videoStatus === "error") {
        throw new CreativeUploadError(
          "meta",
          "meta_video_processing_failed",
          "Meta reported a processing error for this video.",
        );
      }
      await sleep(META_VIDEO_POLL_INTERVAL_MS);
    }
    if (!ready) {
      throw new CreativeUploadError(
        "meta",
        "meta_video_transcode_timeout",
        "Meta is still processing this video and it's taking too long. We stopped the campaign build rather than create half of it. Try again in a few minutes.",
      );
    }

    // Poster → thumbnail image_hash in external_ref_extra (consumed by #862-A4's video_data branch).
    if (!asset.poster_url) {
      throw new CreativeByteSourceError(
        "video_poster_missing",
        "Video creative has no poster_url — required (OD-4 / A1-8c).",
      );
    }
    const posterBytes = await fetchCreativeBytes(asset.poster_url, deps);
    const thumbnailHash = await metaUploadImageBytes(client, accountId, posterBytes);

    return {
      external_kind: "video",
      external_ref: videoId,
      external_ref_extra: { thumbnail_image_hash: thumbnailHash },
      external_account_id: accountId,
    };
  },
};

// ── uploadToTikTok (§4.3 + A1-9 hardening) ────────────────────────────────────

export const TIKTOK_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";

interface TiktokEnvelope {
  code: number;
  message: string;
  data: unknown;
}

async function tiktokPost(
  path: string,
  token: string,
  body: Record<string, unknown>,
  deps: CreativeUploadDeps,
): Promise<TiktokEnvelope> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${TIKTOK_API_BASE}${path}`, {
      method: "POST",
      headers: { "Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CreativeUploadError("tiktok", "tiktok_network_error", `TikTok request failed: ${detail}`);
  }
  const payload = await readJson(response);
  const code = typeof payload.code === "number" ? payload.code : -1;
  const message = typeof payload.message === "string" ? payload.message : "TikTok API error";
  if (!response.ok || code !== 0) {
    throw new CreativeUploadError(
      "tiktok",
      "tiktok_api_error",
      scrubCreativeSecrets(
        `TikTok API error (code ${code}): ${message}. ` +
          "Note: TikTok's URL fetcher has a 10-second window and ~10 MB guidance — a large or unreachable Bunny URL fails here; fall back to the MP4 master (A1-9).",
      ),
    );
  }
  return { code, message, data: payload.data };
}

/**
 * A1-9: file names are unique per advertiser — pre-check via the name-check
 * endpoint and append a timestamp suffix on collision. On ANY ambiguity
 * (endpoint error, unexpected shape) the suffix is appended anyway — a
 * suffixed name is always safe; a colliding one fails the upload.
 */
export async function tiktokEnsureUniqueFileName(
  token: string,
  advertiserId: string,
  fileName: string,
  deps: CreativeUploadDeps = {},
): Promise<string> {
  try {
    const check = await tiktokPost("/file/name/check/", token, {
      advertiser_id: advertiserId,
      file_name: fileName,
    }, deps);
    const data = asRecord(check.data);
    const exists = data.is_exist === true || data.exist === true;
    if (!exists) return fileName;
  } catch {
    // Ambiguous check → suffix defensively (never fail an upload on the pre-check).
  }
  const dot = fileName.lastIndexOf(".");
  const stamp = `_${Date.now()}`;
  return dot > 0 ? `${fileName.slice(0, dot)}${stamp}${fileName.slice(dot)}` : `${fileName}${stamp}`;
}

function firstTiktokUploadRecord(data: unknown): Record<string, unknown> {
  if (Array.isArray(data)) return asRecord(data[0]);
  return asRecord(data);
}

export const tiktokCreativeAdapter: CreativeUploadAdapter = {
  platform: "tiktok",
  upload: async (asset, ctx, deps = {}): Promise<CreativeUploadedRef> => {
    const token = requireEnv(ctx.tokenEnvVar, "tiktok");
    const advertiserId = ctx.external_account_id;

    if (asset.kind === "image") {
      if (!asset.source_url) {
        throw new CreativeByteSourceError("image_source_missing", "Image creative has no source_url.");
      }
      const fileName = await tiktokEnsureUniqueFileName(
        token,
        advertiserId,
        `${asset.name}.img`,
        deps,
      );
      const envelope = await tiktokPost("/file/image/ad/upload/", token, {
        advertiser_id: advertiserId,
        upload_type: "UPLOAD_BY_URL",
        image_url: asset.source_url,
        file_name: fileName,
      }, deps);
      const record = firstTiktokUploadRecord(envelope.data);
      const imageId = typeof record.image_id === "string" ? record.image_id : null;
      const materialId = typeof record.material_id === "string" ? record.material_id : null;
      if (!materialId || !imageId) {
        throw new CreativeUploadError(
          "tiktok",
          "tiktok_ids_missing",
          "TikTok image upload returned no image_id/material_id pair (A1-9 requires BOTH).",
        );
      }
      return {
        external_kind: "image",
        external_ref: materialId,
        external_ref_extra: { image_id: imageId, file_name: fileName },
        external_account_id: advertiserId,
      };
    }

    // Video — UPLOAD_BY_URL with Smart Fix on (A1-9: flaw_detect + auto_fix_enabled;
    // neither touches duration/watermarks/black bars/safe zones — those stay on the matrix).
    const videoUrl = asset.mp4_master_url ?? asset.source_url;
    if (!videoUrl) {
      throw new CreativeByteSourceError("video_source_missing", "Video creative has no fetchable URL.");
    }
    const fileName = await tiktokEnsureUniqueFileName(
      token,
      advertiserId,
      `${asset.name}.mp4`,
      deps,
    );
    const envelope = await tiktokPost("/file/video/ad/upload/", token, {
      advertiser_id: advertiserId,
      upload_type: "UPLOAD_BY_URL",
      video_url: videoUrl,
      file_name: fileName,
      flaw_detect: true,
      auto_fix_enabled: true,
      auto_bind_enabled: true,
    }, deps);
    const record = firstTiktokUploadRecord(envelope.data);
    const videoId = typeof record.video_id === "string" ? record.video_id : null;
    const materialId = typeof record.material_id === "string" ? record.material_id : null;
    if (!materialId || !videoId) {
      throw new CreativeUploadError(
        "tiktok",
        "tiktok_ids_missing",
        "TikTok video upload returned no video_id/material_id pair (A1-9 requires BOTH).",
      );
    }
    const extra: Record<string, unknown> = { video_id: videoId, file_name: fileName };
    if (record.fix_task_id !== undefined) extra.fix_task_id = record.fix_task_id;
    if (record.flaw_types !== undefined) extra.flaw_types = record.flaw_types;
    return {
      external_kind: "video",
      external_ref: materialId,
      external_ref_extra: extra,
      external_account_id: advertiserId,
    };
  },
};

// ── uploadToSnap (A1-2 mint + A1-3 bytes/multipart/chunked + poll READY) ──────

export const SNAP_API_BASE = "https://adsapi.snapchat.com/v1";
export const SNAP_TOKEN_URL = "https://accounts.snapchat.com/login/oauth2/access_token";
export const SNAP_SINGLE_SHOT_MAX_BYTES = 32 * 1024 * 1024;
export const SNAP_CHUNK_BYTES = 32 * 1024 * 1024;
export const SNAP_MAX_CHUNKS = 32; // 32 × 32 MB = 1 GB ceiling (A1-3)
export const SNAP_MEDIA_POLL_INTERVAL_MS = 2_000;
export const SNAP_MEDIA_POLL_MAX_ATTEMPTS = 60;

/**
 * A1-2: there is NO static Snap access token — mint per call from the refresh
 * grant (expires_in 3600, proven live S-P1). The minted token lives in memory
 * only. Env NAMES: SNAPCHAT_REFRESH_TOKEN / SNAPCHAT_CLIENT_ID /
 * SNAPCHAT_CLIENT_SECRET. (A1-2 also bans the legacy static-token env NAME the
 * original spec invented — a secret that will never exist; the issue-866
 * strict-grep gate enforces its absence repo-wide.)
 */
export async function mintSnapAccessToken(deps: CreativeUploadDeps = {}): Promise<string> {
  const refreshToken = requireEnv("SNAPCHAT_REFRESH_TOKEN", "snapchat");
  const clientId = requireEnv("SNAPCHAT_CLIENT_ID", "snapchat");
  const clientSecret = requireEnv("SNAPCHAT_CLIENT_SECRET", "snapchat");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const response = await fetchImpl(SNAP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const payload = await readJson(response);
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!response.ok || !accessToken) {
    throw new CreativeConnectionError(
      "snapchat",
      "snapchat_token_mint_failed",
      `Snap token mint failed (HTTP ${response.status}).`,
    );
  }
  return accessToken;
}

/**
 * A1-3 step 5 (envelope shape confirmed live, S-P5): an HTTP 200 with
 * request_status:"SUCCESS" can still carry sub_request_status:"FAILURE" —
 * EVERY per-entity sub_request_status is asserted, recursively, so a new
 * envelope nesting can never smuggle a failure past this check.
 */
export function assertSnapEnvelope(payload: Record<string, unknown>, context: string): void {
  const requestStatus = payload.request_status;
  if (typeof requestStatus !== "string" || requestStatus.toUpperCase() !== "SUCCESS") {
    throw new CreativeUploadError(
      "snapchat",
      "snapchat_request_failed",
      `Snap ${context}: request_status=${String(requestStatus)} (${
        scrubCreativeSecrets(JSON.stringify(payload.debug_message ?? payload.display_message ?? ""))
      })`,
    );
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
        throw new CreativeUploadError(
          "snapchat",
          "snapchat_sub_request_failed",
          `Snap ${context}: sub_request_status=${sub} — the 200/SUCCESS envelope carried a per-entity failure (A1-3).`,
        );
      }
      for (const child of Object.values(record)) stack.push(child);
    }
  }
}

async function snapJson(
  path: string,
  accessToken: string,
  init: RequestInit,
  deps: CreativeUploadDeps,
  context: string,
): Promise<Record<string, unknown>> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetchImpl(`${SNAP_API_BASE}${path}`, { ...init, headers });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CreativeUploadError("snapchat", "snapchat_network_error", `Snap ${context} failed: ${detail}`);
  }
  const payload = await readJson(response);
  if (!response.ok) {
    throw new CreativeUploadError(
      "snapchat",
      "snapchat_http_error",
      `Snap ${context}: HTTP ${response.status} ${
        scrubCreativeSecrets(JSON.stringify(payload.debug_message ?? payload.display_message ?? ""))
      }`,
    );
  }
  assertSnapEnvelope(payload, context);
  return payload;
}

function snapMediaFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const media = payload.media;
  if (Array.isArray(media)) return asRecord(asRecord(media[0]).media);
  return {};
}

export const snapchatCreativeAdapter: CreativeUploadAdapter = {
  platform: "snapchat",
  upload: async (asset, ctx, deps = {}): Promise<CreativeUploadedRef> => {
    const accessToken = await mintSnapAccessToken(deps);
    const sleep = deps.sleep ?? defaultSleep;
    const accountId = ctx.external_account_id;

    // Bytes, not URLs (A1-3: upload_from_url DOES NOT EXIST).
    const sourceUrl = asset.kind === "image"
      ? asset.source_url
      : resolveVideoByteSourceUrl(asset);
    if (!sourceUrl) {
      throw new CreativeByteSourceError("image_source_missing", "Image creative has no source_url.");
    }
    // A1-3 step 6: the ≤32 MB single-shot path is guaranteed; the chunked path
    // sits behind the size check with SNAP_MAX_CHUNKS bounding it at 1 GB. Edge
    // memory limits for the chunked branch are recorded as a WP3 runtime limit.
    const maxBytes = SNAP_CHUNK_BYTES * SNAP_MAX_CHUNKS;
    const bytes = await fetchCreativeBytes(sourceUrl, deps, maxBytes);

    // 1. Create the media entity.
    const createPayload = await snapJson(
      `/adaccounts/${accountId}/media`,
      accessToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media: [{
            name: asset.name,
            type: asset.kind === "image" ? "IMAGE" : "VIDEO",
            ad_account_id: accountId,
          }],
        }),
      },
      deps,
      "media create",
    );
    const mediaId = String(snapMediaFromPayload(createPayload).id ?? "");
    if (!mediaId) {
      throw new CreativeUploadError("snapchat", "snapchat_media_id_missing", "Snap media create returned no id.");
    }

    // 2. Upload the bytes — multipart/form-data, NOT JSON (A1-3).
    const fileName = asset.kind === "image" ? `${asset.name}.png` : `${asset.name}.mp4`;
    if (bytes.byteLength <= SNAP_SINGLE_SHOT_MAX_BYTES) {
      const form = new FormData();
      form.append("file", new Blob([bytes as BlobPart]), fileName);
      await snapJson(`/media/${mediaId}/upload`, accessToken, { method: "POST", body: form }, deps, "media upload");
    } else {
      // Chunked multipart-upload-v2: INIT → ADD → FINALIZE (max 32 × 32 MB).
      const chunkCount = Math.ceil(bytes.byteLength / SNAP_CHUNK_BYTES);
      if (chunkCount > SNAP_MAX_CHUNKS) {
        throw new CreativeUploadError(
          "snapchat",
          "snapchat_video_too_large",
          `video_too_large: ${bytes.byteLength} bytes needs ${chunkCount} chunks — Snap's ceiling is ${SNAP_MAX_CHUNKS} × 32 MB = 1 GB.`,
        );
      }
      const initPayload = await snapJson(
        `/media/${mediaId}/multipart-upload-v2?action=INIT&file_name=${encodeURIComponent(fileName)}&file_size=${bytes.byteLength}`,
        accessToken,
        { method: "POST" },
        deps,
        "multipart INIT",
      );
      const uploadId = String(asRecord(initPayload.result).upload_id ?? initPayload.upload_id ?? "");
      for (let part = 0; part < chunkCount; part++) {
        const chunk = bytes.subarray(part * SNAP_CHUNK_BYTES, (part + 1) * SNAP_CHUNK_BYTES);
        let lastError: unknown = null;
        let added = false;
        for (let attempt = 0; attempt < 3 && !added; attempt++) {
          try {
            const form = new FormData();
            form.append("file", new Blob([chunk as unknown as BlobPart]), fileName);
            await snapJson(
              `/media/${mediaId}/multipart-upload-v2?action=ADD&part_number=${part + 1}&upload_id=${encodeURIComponent(uploadId)}`,
              accessToken,
              { method: "POST", body: form },
              deps,
              `multipart ADD ${part + 1}/${chunkCount}`,
            );
            added = true;
          } catch (err) {
            lastError = err; // per-chunk retry (A1-3)
          }
        }
        if (!added) {
          const detail = lastError instanceof Error ? lastError.message : String(lastError);
          throw new CreativeUploadError(
            "snapchat",
            "snapchat_chunk_failed",
            `Snap chunk ${part + 1}/${chunkCount} failed after retries: ${scrubCreativeSecrets(detail)}`,
          );
        }
      }
      await snapJson(
        `/media/${mediaId}/multipart-upload-v2?action=FINALIZE&upload_id=${encodeURIComponent(uploadId)}`,
        accessToken,
        { method: "POST" },
        deps,
        "multipart FINALIZE",
      );
    }

    // 3. Poll media_status → READY (a creative referencing PENDING_UPLOAD fails — A1-3 step 4).
    for (let attempt = 0; attempt < SNAP_MEDIA_POLL_MAX_ATTEMPTS; attempt++) {
      const statusPayload = await snapJson(`/media/${mediaId}`, accessToken, { method: "GET" }, deps, "media status");
      const mediaStatus = snapMediaFromPayload(statusPayload).media_status;
      if (mediaStatus === "READY") {
        return {
          external_kind: asset.kind,
          external_ref: mediaId,
          external_ref_extra: {},
          external_account_id: accountId,
        };
      }
      await sleep(SNAP_MEDIA_POLL_INTERVAL_MS);
    }
    throw new CreativeUploadError(
      "snapchat",
      "snapchat_media_not_ready",
      "Snap media never reached READY — failing close rather than referencing PENDING_UPLOAD media (A1-3).",
    );
  },
};

// ── uploadToGoogle (A1-5 images · A1-4 YouTube resumable video) ───────────────

export const GOOGLE_ADS_DEFAULT_API_VERSION = "v24"; // A4.a: v25 does not exist
export const GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_YT_POLL_INTERVAL_MS = 2_000;
export const GOOGLE_YT_POLL_MAX_ATTEMPTS = 90;

export async function mintGoogleAccessToken(deps: CreativeUploadDeps = {}): Promise<string> {
  const refreshToken = requireEnv("GOOGLE_ADS_REFRESH_TOKEN", "google");
  const clientId = requireEnv("GOOGLE_ADS_OAUTH_CLIENT_ID", "google");
  const clientSecret = requireEnv("GOOGLE_ADS_OAUTH_CLIENT_SECRET", "google");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const payload = await readJson(response);
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!response.ok || !accessToken) {
    throw new CreativeConnectionError(
      "google",
      "google_token_mint_failed",
      `Google OAuth token mint failed (HTTP ${response.status}).`,
    );
  }
  return accessToken;
}

function googleAdsVersion(): string {
  return (resolveRuntimeString("google_ads_api_version", "GOOGLE_ADS_API_VERSION") ??
    GOOGLE_ADS_DEFAULT_API_VERSION).trim();
}

function googleHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN", "google"),
    "Content-Type": "application/json",
  };
  const loginCustomer = (Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") ?? "").trim();
  if (loginCustomer) headers["login-customer-id"] = loginCustomer;
  return headers;
}

/** A1-5: derive the unique-per-account asset name; suffix on collision. */
export function googleAssetName(creativeId: string, ratio: string, contentHash: string): string {
  const safeRatio = ratio.replace(/[^a-zA-Z0-9]/g, "_");
  return `mingla_${creativeId}_${safeRatio}_${contentHash.slice(0, 12)}`;
}

function isGoogleDuplicateNameError(message: string): boolean {
  return /duplicate|already exists|DUPLICATE_NAME|DUPLICATE_ASSET/i.test(message);
}

async function googleMutateImageAsset(
  customerId: string,
  accessToken: string,
  name: string,
  base64Data: string,
  deps: CreativeUploadDeps,
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const attempt = async (assetName: string): Promise<{ resourceName: string | null; error: string | null }> => {
    const response = await fetchImpl(
      `${GOOGLE_ADS_API_BASE}/${googleAdsVersion()}/customers/${customerId}/assets:mutate`,
      {
        method: "POST",
        headers: googleHeaders(accessToken),
        body: JSON.stringify({
          operations: [{ create: { name: assetName, type: "IMAGE", imageAsset: { data: base64Data } } }],
        }),
      },
    );
    const payload = await readJson(response);
    if (!response.ok) {
      const errRecord = asRecord(payload.error);
      const message = typeof errRecord.message === "string" ? errRecord.message : `HTTP ${response.status}`;
      return { resourceName: null, error: message };
    }
    const results = Array.isArray(payload.results) ? payload.results : [];
    const resourceName = asRecord(results[0]).resourceName;
    return {
      resourceName: typeof resourceName === "string" ? resourceName : null,
      error: null,
    };
  };

  const first = await attempt(name);
  if (first.resourceName) return first.resourceName;
  if (first.error && isGoogleDuplicateNameError(first.error)) {
    // A1-5: asset names are unique per account — auto-suffix on collision.
    const retry = await attempt(`${name}_${Date.now()}`);
    if (retry.resourceName) return retry.resourceName;
    throw new CreativeUploadError(
      "google",
      "google_asset_mutate_failed",
      `Google assets:mutate failed after name-suffix retry: ${scrubCreativeSecrets(retry.error ?? "no resourceName")}`,
    );
  }
  throw new CreativeUploadError(
    "google",
    "google_asset_mutate_failed",
    `Google assets:mutate failed: ${scrubCreativeSecrets(first.error ?? "no resourceName")}`,
  );
}

export const googleCreativeAdapter: CreativeUploadAdapter = {
  platform: "google",
  upload: async (asset, ctx, deps = {}): Promise<CreativeUploadedRef> => {
    const accessToken = await mintGoogleAccessToken(deps);
    const customerId = ctx.external_account_id.replace(/-/g, "");
    const sleep = deps.sleep ?? defaultSleep;

    if (asset.kind === "image") {
      // A1-5: URL is NOT an option — Google never fetches remote URLs; the API
      // has NO crop parameter. We pass PRE-CROPPED bytes per marketing ratio.
      const sources: { ratio: string; url: string; declaredBytes: number | null }[] = [];
      const masterRatioLabel = classifyRatio(asset.aspect_ratio, Object.keys(GOOGLE_IMAGE_SLOTS), 0.03);
      for (const ratio of Object.keys(GOOGLE_IMAGE_SLOTS)) {
        const variant = asset.variants?.[ratio];
        if (variant) {
          sources.push({ ratio, url: variant.source_url, declaredBytes: variant.byte_size ?? null });
        } else if (masterRatioLabel === ratio && asset.source_url) {
          sources.push({ ratio, url: asset.source_url, declaredBytes: asset.byte_size });
        }
      }
      const primary = sources.find((s) => s.ratio === "1.91:1");
      if (!primary) {
        // The deterministic fix is a crop the edge runtime cannot perform —
        // typed needs_transcode posture, never a half-transcoder.
        throw new CreativeValidationError(
          "google",
          {
            platform: "google",
            ok: false,
            needsTranscode: true,
            checks: [{
              platform: "google",
              rule: "image.marketing_1_91_missing",
              level: "needs_transcode",
              confidence: "OFFICIAL",
              message:
                "Google marketing images require a 1.91:1 asset (1200×628) and the API takes pre-encoded bytes with NO crop parameter — supply a pre-cropped 1.91:1 variant slot (A1-5).",
            }],
          },
          "Google image upload needs a pre-cropped 1.91:1 variant (the edge runtime cannot crop — A1-5).",
        );
      }

      const ratioResources: Record<string, string> = {};
      for (const source of sources) {
        const bytes = await fetchCreativeBytes(source.url, deps);
        // ≤5,120 KB and JPG/PNG only — GIF/WEBP rejected despite the MimeType enum (A1-5).
        if (bytes.byteLength > GOOGLE_IMAGE_MAX_BYTES) {
          throw new CreativeUploadError(
            "google",
            "google_image_too_large",
            `Google image asset (${source.ratio}) is ${bytes.byteLength} bytes — over the 5,120 KB cap and re-encoding is not possible in the edge runtime.`,
          );
        }
        const isJpg = bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
        const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50;
        if (!isJpg && !isPng) {
          throw new CreativeUploadError(
            "google",
            "google_image_bad_format",
            "Google only takes JPG or PNG for ad images — GIF and WEBP get rejected even though the format list suggests otherwise.",
          );
        }
        const name = googleAssetName(asset.id, source.ratio, asset.content_hash);
        ratioResources[source.ratio] = await googleMutateImageAsset(
          customerId,
          accessToken,
          name,
          bytesToBase64(bytes),
          deps,
        );
      }
      return {
        external_kind: "image",
        // Primary external_ref = the 1.91:1 marketing asset (A1-5).
        external_ref: ratioResources["1.91:1"],
        external_ref_extra: { ratio_resource_names: ratioResources },
        external_account_id: ctx.external_account_id,
      };
    }

    // Video — A1-4: YouTubeVideoUploadService resumable REST (channel_id omitted
    // ⇒ Google-managed channel, UNLISTED; no YouTube Data API involved).
    const sourceUrl = resolveVideoByteSourceUrl(asset);
    const bytes = await fetchCreativeBytes(sourceUrl, deps);
    const fetchImpl = deps.fetchImpl ?? fetch;
    const startResponse = await fetchImpl(
      `${GOOGLE_ADS_API_BASE}/resumable/upload/${googleAdsVersion()}/customers/${customerId}/youTubeVideoUploads:create`,
      {
        method: "POST",
        headers: {
          ...googleHeaders(accessToken),
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
        },
        body: JSON.stringify({}),
      },
    );
    if (!startResponse.ok) {
      const payload = await readJson(startResponse);
      throw new CreativeUploadError(
        "google",
        "google_yt_upload_start_failed",
        `YouTube resumable start failed: HTTP ${startResponse.status} ${
          scrubCreativeSecrets(JSON.stringify(asRecord(payload.error).message ?? ""))
        }`,
      );
    }
    const uploadUrl = startResponse.headers.get("X-Goog-Upload-URL");
    if (!uploadUrl) {
      throw new CreativeUploadError(
        "google",
        "google_yt_upload_url_missing",
        "YouTube resumable start returned no X-Goog-Upload-URL header.",
      );
    }
    const uploadResponse = await fetchImpl(uploadUrl, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
      },
      body: bytes as unknown as BodyInit,
    });
    const uploadPayload = await readJson(uploadResponse);
    if (!uploadResponse.ok) {
      throw new CreativeUploadError(
        "google",
        "google_yt_upload_failed",
        `YouTube resumable upload/finalize failed: HTTP ${uploadResponse.status}.`,
      );
    }
    const resourceName = typeof uploadPayload.resourceName === "string"
      ? uploadPayload.resourceName
      : typeof asRecord(uploadPayload.youTubeVideoUpload).resourceName === "string"
      ? String(asRecord(uploadPayload.youTubeVideoUpload).resourceName)
      : null;
    if (!resourceName) {
      throw new CreativeUploadError(
        "google",
        "google_yt_resource_missing",
        "YouTube resumable finalize returned no youTubeVideoUpload resourceName.",
      );
    }

    // Poll state: PENDING → UPLOADED → PROCESSED; fail-close on FAILED|REJECTED|UNAVAILABLE.
    for (let attempt = 0; attempt < GOOGLE_YT_POLL_MAX_ATTEMPTS; attempt++) {
      const pollResponse = await fetchImpl(`${GOOGLE_ADS_API_BASE}/${googleAdsVersion()}/${resourceName}`, {
        method: "GET",
        headers: googleHeaders(accessToken),
      });
      const pollPayload = await readJson(pollResponse);
      const state = typeof pollPayload.state === "string" ? pollPayload.state : null;
      if (state === "PROCESSED") {
        const videoId = typeof pollPayload.videoId === "string"
          ? pollPayload.videoId
          : typeof pollPayload.video_id === "string"
          ? String(pollPayload.video_id)
          : null;
        if (!videoId) {
          throw new CreativeUploadError(
            "google",
            "google_yt_video_id_missing",
            "YouTube upload PROCESSED but returned no video id.",
          );
        }
        return {
          external_kind: "video",
          external_ref: videoId, // → YoutubeVideoAsset { youtube_video_id } at ad-create (#867)
          external_ref_extra: { upload_resource_name: resourceName },
          external_account_id: ctx.external_account_id,
        };
      }
      if (state === "FAILED" || state === "REJECTED" || state === "UNAVAILABLE") {
        throw new CreativeUploadError(
          "google",
          "google_yt_processing_failed",
          `YouTube upload state=${state} — failing close (A1-4).`,
        );
      }
      await sleep(GOOGLE_YT_POLL_INTERVAL_MS);
    }
    throw new CreativeUploadError(
      "google",
      "google_yt_processing_timeout",
      "YouTube upload never reached PROCESSED — failing close rather than linking an unusable asset (A1-4).",
    );
  },
};

// ── uploadToReddit — A1-1 fail-close stub ─────────────────────────────────────

export const redditCreativeAdapter: CreativeUploadAdapter = {
  platform: "reddit",
  // deno-lint-ignore require-await
  upload: async (): Promise<CreativeUploadedRef> => {
    // GR-10: there is NO media id on a Reddit ad — the creative is a t3_ post
    // created via an async structured-posts job, owned by the Reddit spec.
    // This stub keeps the adapter registry total and FAILS CLOSE (A1-1).
    throw new CreativeLaneNotProvisionedError(
      "reddit",
      "reddit_lane_not_provisioned: Reddit ads reference a t3_ post (async structured-post job), not an uploaded media id — the Reddit creative path ships with the Reddit spec, not #866.",
    );
  },
};

// ── Adapter registry ──────────────────────────────────────────────────────────

export const CREATIVE_UPLOAD_ADAPTERS: Record<Platform, CreativeUploadAdapter> = {
  meta: metaCreativeAdapter,
  tiktok: tiktokCreativeAdapter,
  snapchat: snapchatCreativeAdapter,
  google: googleCreativeAdapter,
  reddit: redditCreativeAdapter,
};

// ── The resolver — cache-first, content-hash keyed, fail-close (§4.3 + A1-1) ──

/** The lock-row shape both acquisition seams take. */
export interface AcquireRefLockRow {
  creative_id: string;
  platform: Platform;
  lane: Lane;
  external_account_id: string;
  external_kind: "image" | "video";
  content_hash: string;
}

/** The minimal DB seam resolveCreativeRef needs (structurally satisfied by supabase-js). */
export interface CreativeRefDb {
  getConnection(platform: Platform, lane: Lane): Promise<AdConnectionRow | null>;
  getCreative(creativeId: string): Promise<AdCreativeRow | null>;
  getRef(
    creativeId: string,
    platform: Platform,
    lane: Lane,
    externalAccountId: string,
  ): Promise<CreativeRefRow | null>;
  /**
   * QA F-1: THE atomic, CHECKED lock acquisition. Returns true ⇔ THIS caller
   * won the status='uploading' lock; false ⇔ another resolver holds it (the
   * caller routes into the waiter path — it must NOT upload). The winning
   * condition (evaluated atomically against the UNIQUE
   * (creative_id, platform, lane, external_account_id) row) is: the row is
   * absent, OR status ∈ (pending, failed), OR status='uploading' with
   * updated_at older than `staleBefore` (F-2 crashed-holder takeover), OR
   * status='ready' with a content_hash ≠ row.content_hash (A1-1 stale bytes).
   *
   * OPTIONAL only for legacy single-writer in-memory fakes (the pre-rework
   * test seam): when absent, the resolver falls back to upsertRefUploading
   * and assumes the win — which is NOT concurrency-safe. Every REAL
   * implementation (createSupabaseCreativeRefDb) MUST provide this.
   */
  tryAcquireRefLock?(row: AcquireRefLockRow, staleBefore: string): Promise<boolean>;
  /** Legacy unchecked acquisition — single-writer fallback ONLY (see tryAcquireRefLock). */
  upsertRefUploading(row: AcquireRefLockRow): Promise<void>;
  markRefReady(
    creativeId: string,
    platform: Platform,
    lane: Lane,
    externalAccountId: string,
    ref: CreativeUploadedRef,
    contentHash: string,
  ): Promise<void>;
  markRefFailed(
    creativeId: string,
    platform: Platform,
    lane: Lane,
    externalAccountId: string,
    error: string,
  ): Promise<void>;
}

export const RESOLVE_LOCK_MAX_REREADS = 5;
export const RESOLVE_LOCK_REREAD_INTERVAL_MS = 1_500;

/**
 * QA F-2: a status='uploading' lock older than this is considered a crashed
 * holder and becomes acquirable. Sizing: the longest LEGITIMATE holder is the
 * chunked Snap path (fetch up to 1 GB + 32 ADD chunks × 3 retries + FINALIZE +
 * a 120 s READY poll); on top of that, Supabase edge functions carry a hard
 * wall-clock cap (~400 s), so ANY legitimate holder is finished or dead well
 * inside this bound. updated_at is touched once at acquisition (no heartbeat),
 * so the bound must exceed the WHOLE upload, not an interval — 15 minutes.
 */
export const STALE_LOCK_TAKEOVER_MS = 15 * 60_000;

function refLockIsStale(ref: CreativeRefRow, nowMs: number): boolean {
  if (ref.updated_at === undefined || ref.updated_at === null) return false; // unknown age = fresh (fail-safe)
  const parsed = Date.parse(ref.updated_at);
  if (Number.isNaN(parsed)) return false;
  return parsed < nowMs - STALE_LOCK_TAKEOVER_MS;
}

export interface ResolveCreativeRefOptions extends CreativeUploadDeps {
  adapters?: Record<Platform, CreativeUploadAdapter>;
  /** Skip the matrix gate (validation already enforced upstream this call). */
  skipValidation?: boolean;
}

/**
 * THE single entry point every channel engine calls at ad-create (§4.3):
 *   1. connection (fail-close)  2. creative (fail-close)
 *   3. matrix gate (fail-close BEFORE upload — hard-rejects and un-covered
 *      needs_transcode outcomes block the channel)
 *   4. cache read — a `ready` ref is returned ONLY on content-hash match
 *      (A1-1/GR-53); `uploading` awaits with backoff then throws retryable
 *   5. upsert `uploading` (the UNIQUE key is the lock) → adapter.upload →
 *      `ready` + hash snapshot, or `failed` + normalized error + re-throw.
 * NO ad exists without a resolved creative (extends #862's no-orphan contract).
 */
export async function resolveCreativeRef(
  db: CreativeRefDb,
  creativeId: string,
  platform: Platform,
  lane: Lane,
  opts: ResolveCreativeRefOptions = {},
): Promise<CreativeUploadedRef> {
  const sleep = opts.sleep ?? defaultSleep;
  const adapters = opts.adapters ?? CREATIVE_UPLOAD_ADAPTERS;

  // 1. Connection — fail-close; the engine surfaces it, no ad written.
  const conn = await db.getConnection(platform, lane);
  if (!conn || !conn.connected || conn.status !== "connected") {
    throw new CreativeConnectionError(
      platform,
      `${platform}_not_connected`,
      `No connected ${platform}/${lane} ad connection — connect the lane before referencing creatives.`,
    );
  }

  // 2. Creative — absent or archived → fail-close.
  const creative = await db.getCreative(creativeId);
  if (!creative) {
    throw new CreativeNotFoundError("creative_not_found", `Creative ${creativeId} does not exist.`);
  }
  if (creative.status === "archived") {
    throw new CreativeNotFoundError("creative_archived", `Creative ${creativeId} is archived.`);
  }

  // 3. Matrix gate — the §2 constants judge the PERSISTED probe facts. A
  //    hard-reject (or a needs_transcode with no covering variant) blocks the
  //    channel BEFORE any platform call.
  if (!opts.skipValidation) {
    const result = validateCreativeForChannel(platform, factsFromRow(creative));
    // QA F-3 fail-safe: a not_evaluable check flagged failSafe (audio-required
    // when hasAudio is UNKNOWN) blocks the channel exactly like a reject —
    // unknown must never soften into a pass on an audio-mandatory platform.
    const failSafeBlock = result.checks.find((c) => c.level === "not_evaluable" && c.failSafe === true);
    if (!result.ok || result.needsTranscode || failSafeBlock) {
      const firstBlock = result.checks.find((c) => c.level === "reject" || c.level === "needs_transcode") ??
        failSafeBlock;
      throw new CreativeValidationError(
        platform,
        result,
        firstBlock?.message ?? `Creative fails ${platform} validation.`,
      );
    }
  }

  const accountId = conn.external_account_id;
  const lockRow: AcquireRefLockRow = {
    creative_id: creativeId,
    platform,
    lane,
    external_account_id: accountId,
    external_kind: creative.kind,
    content_hash: creative.content_hash,
  };

  // 4./5. Cache read + ATOMIC CHECKED lock acquisition (QA F-1/F-2). One loop:
  //   - a `ready` ref with a MATCHING content hash returns from cache — the
  //     idempotency win (AC-4). PROTECTED GUARD: reverting this
  //     SELECT-ready-ref-before-upload makes RT-1 fail — without it every ad
  //     re-uploads the asset (double storage spend + Google immutable-asset churn).
  //   - a FRESH `uploading` ref means another resolver holds the lock → wait.
  //   - anything acquirable (absent / pending / failed / STALE uploading /
  //     ready-with-mismatched-hash) → tryAcquireRefLock. ONLY the winner
  //     uploads; losers loop back into the waiter and end up returning the
  //     winner's ref — two concurrent resolves = exactly ONE platform upload.
  let acquired = false;
  for (let attempt = 0; attempt <= RESOLVE_LOCK_MAX_REREADS; attempt++) {
    const observed = await db.getRef(creativeId, platform, lane, accountId);
    if (observed && observed.status === "ready" && observed.external_ref) {
      if (observed.content_hash === creative.content_hash) {
        return {
          external_kind: observed.external_kind,
          external_ref: observed.external_ref,
          external_ref_extra: observed.external_ref_extra ?? {},
          external_account_id: observed.external_account_id,
        };
      }
      // A1-1: hash mismatch ⇒ the cached platform object holds STALE bytes —
      // acquirable below for a fresh upload (on Google necessarily a fresh asset).
    }

    const freshUploading = observed !== null && observed.status === "uploading" &&
      !refLockIsStale(observed, Date.now());
    if (!freshUploading) {
      // Acquirable state observed — try to take the lock ATOMICALLY. The SQL
      // predicate re-checks the state, so a racer that beat us since the read
      // simply makes us lose (won=false) and we fall through to waiting.
      const staleBefore = new Date(Date.now() - STALE_LOCK_TAKEOVER_MS).toISOString();
      if (db.tryAcquireRefLock) {
        acquired = await db.tryAcquireRefLock(lockRow, staleBefore);
      } else {
        // Legacy single-writer fallback (in-memory fakes only — see the seam
        // doc). NOT concurrency-safe; every real DB impl provides tryAcquireRefLock.
        await db.upsertRefUploading(lockRow);
        acquired = true;
      }
      if (acquired) break;
    }
    if (attempt === RESOLVE_LOCK_MAX_REREADS) {
      throw new CreativeRefLockedError(
        `A concurrent create is uploading creative ${creativeId} to ${platform}/${lane} — retry shortly.`,
      );
    }
    await sleep(RESOLVE_LOCK_REREAD_INTERVAL_MS);
  }
  if (!acquired) {
    throw new CreativeRefLockedError(
      `A concurrent create is uploading creative ${creativeId} to ${platform}/${lane} — retry shortly.`,
    );
  }

  const ctx: LaneContext = {
    lane,
    external_account_id: accountId,
    tokenEnvVar: conn.token_env_var,
    pageId: typeof conn.extra?.page_id === "string" ? conn.extra.page_id as string : undefined,
    connection: conn,
  };

  try {
    const uploaded = await adapters[platform].upload(creative, ctx, opts);
    await db.markRefReady(creativeId, platform, lane, accountId, uploaded, creative.content_hash);
    return uploaded;
  } catch (err) {
    const normalized = normalizeCreativeError(platform, err);
    await db.markRefFailed(creativeId, platform, lane, accountId, normalized.message);
    if (
      err instanceof CreativeConnectionError || err instanceof CreativeValidationError ||
      err instanceof CreativeLaneNotProvisionedError || err instanceof CreativeByteSourceError
    ) {
      throw err; // already typed fail-close
    }
    throw new CreativeUploadError(
      platform,
      `${platform}_upload_failed`,
      normalized.message,
    );
  }
}

// ── Supabase-backed CreativeRefDb (used by the edge functions / engines) ──────

interface DbResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface SupabaseFilterLike extends PromiseLike<DbResult<Record<string, unknown>[]>> {
  eq(column: string, value: unknown): SupabaseFilterLike;
  or(filters: string): SupabaseFilterLike;
  select(columns: string): SupabaseFilterLike;
  maybeSingle(): Promise<DbResult<Record<string, unknown>>>;
}

interface SupabaseTableLike {
  select(columns: string): SupabaseFilterLike;
  upsert(
    values: Record<string, unknown>,
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): SupabaseFilterLike;
  update(values: Record<string, unknown>): SupabaseFilterLike;
}

/** Structurally satisfied by a supabase-js client — no supabase-js import here. */
export interface SupabaseLike {
  from(table: string): SupabaseTableLike;
}

export function createSupabaseCreativeRefDb(client: SupabaseLike): CreativeRefDb {
  const refKeyFilter = (
    query: SupabaseFilterLike,
    creativeId: string,
    platform: Platform,
    lane: Lane,
    externalAccountId: string,
  ): SupabaseFilterLike =>
    query
      .eq("creative_id", creativeId)
      .eq("platform", platform)
      .eq("lane", lane)
      .eq("external_account_id", externalAccountId);

  return {
    getConnection: async (platform, lane) => {
      const { data } = await client
        .from("ad_connections")
        .select("*")
        .eq("platform", platform)
        .eq("lane", lane)
        .maybeSingle();
      return data as unknown as AdConnectionRow | null;
    },
    getCreative: async (creativeId) => {
      const { data } = await client
        .from("ad_creatives")
        .select("*")
        .eq("id", creativeId)
        .maybeSingle();
      return data as unknown as AdCreativeRow | null;
    },
    getRef: async (creativeId, platform, lane, externalAccountId) => {
      const { data } = await refKeyFilter(
        client.from("ad_creative_platform_refs").select("*"),
        creativeId,
        platform,
        lane,
        externalAccountId,
      ).maybeSingle();
      return data as unknown as CreativeRefRow | null;
    },
    /**
     * QA F-1/F-2: the ATOMIC, CHECKED acquisition, in two atomic statements —
     * exactly one concurrent caller can win:
     *   1. INSERT … ON CONFLICT DO NOTHING (upsert + ignoreDuplicates) with
     *      RETURNING — a returned row means WE created the lock row ⇒ won.
     *   2. On conflict (row exists): a GUARDED UPDATE … RETURNING whose
     *      predicate is the acquirable-state condition. Postgres re-evaluates
     *      the predicate on the latest committed row version under row lock
     *      (READ COMMITTED update re-check), so of two racers exactly one
     *      matches; the loser gets zero rows ⇒ lost ⇒ waiter path.
     * The updated_at trigger stamps the takeover time; a crashed holder's row
     * becomes acquirable once updated_at < staleBefore (F-2).
     */
    tryAcquireRefLock: async (row, staleBefore) => {
      const insertResult = await client.from("ad_creative_platform_refs").upsert({
        ...row,
        status: "uploading",
        error: null,
      }, {
        onConflict: "creative_id,platform,lane,external_account_id",
        ignoreDuplicates: true,
      }).select("id");
      if (insertResult.error) {
        throw new Error(`ad_creative_platform_refs lock insert failed: ${insertResult.error.message}`);
      }
      if ((insertResult.data ?? []).length > 0) return true; // we created the row — lock is ours

      const updateResult = await refKeyFilter(
        client.from("ad_creative_platform_refs").update({
          status: "uploading",
          external_kind: row.external_kind,
          content_hash: row.content_hash,
          error: null,
        }),
        row.creative_id,
        row.platform,
        row.lane,
        row.external_account_id,
      ).or(
        // Acquirable states (kept in lockstep with the resolver's loop + the
        // seam doc): pending/failed retry, stale-uploading takeover (F-2),
        // ready-with-stale-bytes re-upload (A1-1). A FRESH 'uploading' or a
        // ready-with-matching-hash row matches nothing ⇒ zero rows ⇒ lost.
        `status.in.(pending,failed),` +
          `and(status.eq.uploading,updated_at.lt."${staleBefore}"),` +
          `and(status.eq.ready,content_hash.neq.${row.content_hash})`,
      ).select("id");
      if (updateResult.error) {
        throw new Error(`ad_creative_platform_refs lock update failed: ${updateResult.error.message}`);
      }
      return (updateResult.data ?? []).length > 0;
    },
    upsertRefUploading: async (row) => {
      const { error } = await client.from("ad_creative_platform_refs").upsert({
        ...row,
        status: "uploading",
        error: null,
      }, { onConflict: "creative_id,platform,lane,external_account_id" });
      if (error) throw new Error(`ad_creative_platform_refs upsert failed: ${error.message}`);
    },
    markRefReady: async (creativeId, platform, lane, externalAccountId, ref, contentHash) => {
      const { error } = await refKeyFilter(
        client.from("ad_creative_platform_refs").update({
          status: "ready",
          external_ref: ref.external_ref,
          external_ref_extra: ref.external_ref_extra,
          external_kind: ref.external_kind,
          external_account_id: ref.external_account_id,
          content_hash: contentHash,
          error: null,
          uploaded_at: new Date().toISOString(),
        }),
        creativeId,
        platform,
        lane,
        externalAccountId,
      );
      if (error) throw new Error(`ad_creative_platform_refs ready-update failed: ${error.message}`);
    },
    markRefFailed: async (creativeId, platform, lane, externalAccountId, errorMessage) => {
      const { error } = await refKeyFilter(
        client.from("ad_creative_platform_refs").update({
          status: "failed",
          error: scrubCreativeSecrets(errorMessage),
        }),
        creativeId,
        platform,
        lane,
        externalAccountId,
      );
      if (error) throw new Error(`ad_creative_platform_refs failed-update failed: ${error.message}`);
    },
  };
}
