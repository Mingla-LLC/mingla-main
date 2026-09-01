// META-ORCH-1270 — Bunny Stream helpers for the event-cover video pipeline.
//
// All Bunny HTTP + signing lives here (the mirror of the Cloudinary helpers in
// eventCoverVideo.ts). Every endpoint/param was verified against docs.bunny.net
// on 2026-07-03 (URLs cited inline). The Stream management + upload calls target
// https://video.bunnycdn.com and authenticate with the header
// `AccessKey: {BUNNY_STREAM_API_KEY}` (the library API key). Delivery is over the
// pull-zone CDN host {BUNNY_STREAM_CDN_HOSTNAME}.
//
// FAIL CLOSED: every ambiguous provider result returns a structured `{ ok:false }`
// (never throws into the host path, never fabricates a guid/URL). Secrets are read
// from Deno.env only — never hardcoded, never returned to the client (only the
// presigned AuthorizationSignature reaches the client).

// ORCH-1201 — Layer-C passive health observation (fire-and-forget, best-effort).
import { recordApiCall } from "./apiHealthLog.ts";

const BUNNY_HOST = "https://video.bunnycdn.com";
// TUS resumable creation endpoint (client-direct, signed).
// https://docs.bunny.net/stream/tus-resumable-uploads
const BUNNY_TUS = "https://video.bunnycdn.com/tusupload";
// META-ORCH-1270 (Phase 2) — account-level API host for the usage read (alarm +
// circuit-breaker). Authenticates with the ACCOUNT key (BUNNY_ACCOUNT_API_KEY),
// distinct from the Stream library key. https://docs.bunny.net/reference/videolibrarypublic_index
const BUNNY_ACCOUNT_HOST = "https://api.bunny.net";

export type BunnyVideo = {
  guid: string;
  status: number;
  // duration in seconds (int); nullable until encoding produces it.
  length: number | null;
  // stored source bytes (int64); nullable until the upload registers.
  storageSize: number | null;
  // CSV of rendered heights like "720p,480p,360p"; nullable pre-encode.
  availableResolutions: string | null;
  encodeProgress: number | null;
  outputCodecs?: string | null;
  originalHash?: string | null;
};

function bunnyLibraryId(): string {
  return Deno.env.get("BUNNY_STREAM_LIBRARY_ID") ?? "";
}
function bunnyApiKey(): string {
  return Deno.env.get("BUNNY_STREAM_API_KEY") ?? "";
}
function bunnyCdnHost(): string {
  return Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME") ?? "";
}
// META-ORCH-1270 (Phase 2) — the ACCOUNT-level API key for the usage read.
function bunnyAccountApiKey(): string {
  return Deno.env.get("BUNNY_ACCOUNT_API_KEY") ?? "";
}

// Hex-encoded SHA-256 of the input (used for the TUS AuthorizationSignature).
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Hex-encoded HMAC-SHA256 (webhook authenticity + the exported signer tests use).
export async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
};

const networkReason = (prefix: string, error: unknown): string =>
  `${prefix}_${error instanceof Error ? error.name : "error"}`;

// Create the video object; returns its guid (the videoId).
// POST https://video.bunnycdn.com/library/{libraryId}/videos
// https://docs.bunny.net/reference/video_createvideo
export async function bunnyCreateVideo(
  title: string,
): Promise<
  { ok: true; guid: string } | { ok: false; reason: string; retryable: boolean }
> {
  const libraryId = bunnyLibraryId();
  const apiKey = bunnyApiKey();
  if (libraryId.length === 0 || apiKey.length === 0) {
    return { ok: false, reason: "bunny_not_configured", retryable: false };
  }
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${BUNNY_HOST}/library/${libraryId}/videos`, {
      method: "POST",
      headers: {
        AccessKey: apiKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ title }),
    });
  } catch (error) {
    return {
      ok: false,
      reason: networkReason("bunny_create_network", error),
      retryable: true,
    };
  }
  void recordApiCall(
    "bunny",
    response.ok,
    Date.now() - startedAt,
    response.status,
  );
  if (!response.ok) {
    return {
      ok: false,
      reason: `bunny_create_http_${response.status}`,
      retryable: response.status >= 500 || response.status === 408 ||
        response.status === 429,
    };
  }
  let body: { guid?: unknown } | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const guid = typeof body?.guid === "string" ? body.guid.trim() : "";
  if (guid.length === 0) {
    return { ok: false, reason: "bunny_create_missing_guid", retryable: true };
  }
  return { ok: true, guid };
}

export type BunnyVideoTitleLookup =
  | { ok: true; guid: string | null }
  | { ok: false; reason: string };

// Resolve an ambiguous Create by the exact deterministic job title before any
// caller is allowed to create again. Bunny search can be partial, so every page
// is exhausted and the result is filtered by exact title. Zero exact matches is
// authoritative absence; duplicate exact matches remain ambiguous/fail closed.
export async function bunnyFindVideoByTitle(
  title: string,
): Promise<BunnyVideoTitleLookup> {
  const libraryId = bunnyLibraryId();
  const apiKey = bunnyApiKey();
  const exactTitle = title.trim();
  if (
    libraryId.length === 0 || apiKey.length === 0 || exactTitle.length === 0
  ) {
    return { ok: false, reason: "bunny_lookup_not_configured" };
  }
  const matches = new Set<string>();
  let page = 1;
  while (true) {
    const url = new URL(`${BUNNY_HOST}/library/${libraryId}/videos`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("itemsPerPage", "100");
    url.searchParams.set("search", exactTitle);
    let response: Response;
    const startedAt = Date.now();
    try {
      response = await fetch(url, {
        headers: { AccessKey: apiKey, accept: "application/json" },
      });
    } catch (error) {
      return {
        ok: false,
        reason: networkReason("bunny_lookup_network", error),
      };
    }
    void recordApiCall(
      "bunny",
      response.ok,
      Date.now() - startedAt,
      response.status,
    );
    if (!response.ok) {
      return {
        ok: false,
        reason: `bunny_lookup_http_${response.status}`,
      };
    }
    let body: Record<string, unknown> | null = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const items = Array.isArray(body?.items) ? body.items : null;
    if (items === null) {
      return { ok: false, reason: "bunny_lookup_malformed" };
    }
    for (const item of items) {
      if (
        typeof item === "object" && item !== null &&
        (item as Record<string, unknown>).title === exactTitle
      ) {
        const guid = (item as Record<string, unknown>).guid;
        if (typeof guid === "string" && guid.trim().length > 0) {
          matches.add(guid.trim());
        }
      }
    }
    const totalItems = Number(body?.totalItems);
    const itemsPerPage = Number(body?.itemsPerPage);
    const currentPage = Number(body?.currentPage ?? page);
    if (
      !Number.isFinite(totalItems) || !Number.isFinite(itemsPerPage) ||
      !Number.isFinite(currentPage) || totalItems < 0 || itemsPerPage <= 0 ||
      currentPage < 1
    ) {
      return { ok: false, reason: "bunny_lookup_malformed" };
    }
    if (currentPage * itemsPerPage >= totalItems) break;
    page = currentPage + 1;
  }
  if (matches.size > 1) {
    return { ok: false, reason: "bunny_lookup_duplicate_identity" };
  }
  return { ok: true, guid: matches.values().next().value ?? null };
}

export type BunnyTusPresign = {
  tusEndpoint: string;
  libraryId: string;
  videoId: string;
  // sha256Hex(libraryId + apiKey + expire + videoId) — the four values
  // concatenated with NO delimiters, per the docs. NOTE: async because WebCrypto
  // SHA-256 is async (the spec's synchronous signature is not achievable with
  // crypto.subtle) — documented in the Phase-1 implementation report.
  authorizationSignature: string;
  authorizationExpire: number; // UNIX seconds at which the signature expires.
};

// Presign a TUS resumable upload for an existing videoId (so the AccessKey is
// never exposed to the client). Signature recipe (verbatim from the docs):
//   SHA256(library_id + api_key + expiration_time + video_id)
// expiration_time is in UNIX SECONDS.
// https://docs.bunny.net/stream/tus-resumable-uploads
export async function bunnyPresignTusUpload(
  videoId: string,
  expirySeconds = 3600,
): Promise<BunnyTusPresign> {
  const libraryId = bunnyLibraryId();
  const apiKey = bunnyApiKey();
  const authorizationExpire = Math.floor(Date.now() / 1000) + expirySeconds;
  const authorizationSignature = await sha256Hex(
    `${libraryId}${apiKey}${authorizationExpire}${videoId}`,
  );
  return {
    tusEndpoint: BUNNY_TUS,
    libraryId,
    videoId,
    authorizationSignature,
    authorizationExpire,
  };
}

const toBunnyVideo = (body: Record<string, unknown>): BunnyVideo => ({
  guid: typeof body.guid === "string" ? body.guid : "",
  status: typeof body.status === "number" ? body.status : Number(body.status),
  length: typeof body.length === "number" ? body.length : null,
  storageSize: typeof body.storageSize === "number" ? body.storageSize : null,
  availableResolutions: typeof body.availableResolutions === "string"
    ? body.availableResolutions
    : null,
  encodeProgress: typeof body.encodeProgress === "number"
    ? body.encodeProgress
    : null,
  outputCodecs: typeof body.outputCodecs === "string"
    ? body.outputCodecs
    : null,
  originalHash: typeof body.originalHash === "string"
    ? body.originalHash.toLowerCase()
    : null,
});

// GET https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}
// https://docs.bunny.net/reference/video_getvideo
export async function bunnyGetVideo(
  guid: string,
): Promise<
  { ok: true; video: BunnyVideo } | {
    ok: false;
    status: number;
    reason: string;
  }
> {
  const libraryId = bunnyLibraryId();
  const apiKey = bunnyApiKey();
  if (libraryId.length === 0 || apiKey.length === 0) {
    return { ok: false, status: 0, reason: "bunny_not_configured" };
  }
  const trimmed = guid.trim();
  if (trimmed.length === 0) {
    return { ok: false, status: 0, reason: "missing_guid" };
  }
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(
      `${BUNNY_HOST}/library/${libraryId}/videos/${trimmed}`,
      {
        method: "GET",
        headers: { AccessKey: apiKey, accept: "application/json" },
      },
    );
  } catch (error) {
    return {
      ok: false,
      status: 0,
      reason: networkReason("bunny_get_network", error),
    };
  }
  void recordApiCall(
    "bunny",
    response.ok,
    Date.now() - startedAt,
    response.status,
  );
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: `bunny_get_http_${response.status}`,
    };
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (body === null || typeof body.guid !== "string") {
    return {
      ok: false,
      status: response.status,
      reason: "bunny_get_malformed",
    };
  }
  return { ok: true, video: toBunnyVideo(body) };
}

// DELETE https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}
// Replaces cloudinaryDestroy. A delete of an absent guid returns 404 → idempotent
// (treated as ok) so reap/reclaim paths never fail on an already-gone asset.
// https://docs.bunny.net/reference/video_deletevideo
export async function bunnyDeleteVideo(
  guid: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const libraryId = bunnyLibraryId();
  const apiKey = bunnyApiKey();
  if (libraryId.length === 0 || apiKey.length === 0) {
    return { ok: false, reason: "bunny_not_configured" };
  }
  const trimmed = guid.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "missing_guid" };
  }
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(
      `${BUNNY_HOST}/library/${libraryId}/videos/${trimmed}`,
      {
        method: "DELETE",
        headers: { AccessKey: apiKey, accept: "application/json" },
      },
    );
  } catch (error) {
    return { ok: false, reason: networkReason("bunny_delete_network", error) };
  }
  void recordApiCall(
    "bunny",
    response.ok,
    Date.now() - startedAt,
    response.status,
  );
  if (response.ok || response.status === 404) {
    return { ok: true };
  }
  return { ok: false, reason: `bunny_delete_http_${response.status}` };
}

// Auto-generated poster still (replaces deriveCoverPosterUrl's so_0 trick).
// https://{cdnHostname}/{videoGuid}/thumbnail.jpg
export function bunnyThumbnailUrl(guid: string): string {
  return `https://${bunnyCdnHost()}/${guid}/thumbnail.jpg`;
}

// Delivery MP4 for <video>/expo-video. Requires "MP4 Fallback" enabled on the
// library (console). https://{cdnHostname}/{videoGuid}/play_{H}p.mp4
export function bunnyPlayUrl(guid: string, heightP: number): string {
  return `https://${bunnyCdnHost()}/${guid}/play_${heightP}p.mp4`;
}

// Highest available rendition height <= 720 from availableResolutions
// ("720p,480p" → 720). Returns null when no <=720p rendition exists (fail closed).
export function bunnyBestMp4(
  video: BunnyVideo,
): { url: string; heightP: number } | null {
  const raw = video.availableResolutions;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const heights = raw
    .split(",")
    .map((token) => Number.parseInt(token.trim().replace(/p$/i, ""), 10))
    .filter((height) => Number.isFinite(height) && height > 0 && height <= 720);
  if (heights.length === 0) return null;
  const heightP = Math.max(...heights);
  return { url: bunnyPlayUrl(video.guid, heightP), heightP };
}

// ── #2905 THE TWO BUNNY STATUS ENUMS ────────────────────────────────────────
//
// Bunny publishes TWO DIFFERENT numeric enums under the same name `Status`/
// `status`, and 3 and 4 mean the OPPOSITE thing in each. Until #2905 a single
// unnamed `mapBunnyStatus()` served both, and the reconciler fed it the wrong
// one — so a FINISHED video was read as "still encoding" and the job wedged
// forever (production job e055c562-…, wedged 2026-08-30 → 2026-09-01).
//
//   WEBHOOK enum  — the POST body Bunny sends to event-cover-video-webhook.
//     0 Queued · 1 Processing · 2 Encoding · 3 FINISHED · 4 ResolutionFinished
//     · 5 Failed · 6..10 presigned-upload / caption / title events.
//     Proven from production: every job that ever reached `applied` carries
//     provider_payload.bunny_webhook = {"Status": 3, …} (17 rows).
//
//   API VIDEO-OBJECT enum — the `status` field of
//     GET /library/{id}/videos/{guid}, i.e. `bunnyGetVideo().video.status`.
//     0 Created · 1 Uploaded · 2 Processing · 3 TRANSCODING · 4 FINISHED
//     · 5 Error · 6 UploadFailed · 7 JitSegmenting · 8 JitPlaylistsCreated.
//     Proven from production: the wedged row persisted status 4 together with
//     encodeProgress 100 and storageSize 14,808,154 against a 3,050,776-byte
//     source — API 4 is terminal-finished, not "one step before finished".
//
// RULE: never map a value without saying WHICH enum it came from. The two
// mappers below are named for their source, and exactly ONE function is
// allowed to cross between them (`bunnyApiVideoStatusAsWebhookStatus`).
// ────────────────────────────────────────────────────────────────────────────

export type BunnyLifecycle = "processing" | "ready" | "failed" | "ignore";

// Map the Bunny numeric WEBHOOK Status → our provider-agnostic job lifecycle.
// 0 Queued / 1 Processing / 2 Encoding → processing; 3 Finished → ready;
// 4 Resolution finished → processing (wait for 3); 5 Failed → failed.
// 6 PresignedUploadStarted / 7 PresignedUploadFinished / 8 PresignedUploadFailed
// / 9 CaptionsGenerated / 10 TitleOrDescriptionGenerated are NOT part of the
// cover-video encode lifecycle → intentionally ignored (fall through to default).
// https://docs.bunny.net/stream/webhooks (verified 2026-07-03)
//
// #2905: DO NOT feed this an API video-object status. It is correct exactly as
// written for the webhook stream and must not change — 17 production rows prove
// real Bunny webhooks send Status 3 on finish. Renamed from `mapBunnyStatus` so
// the enum it belongs to is stated at every call site.
export function mapBunnyStatusFromWebhook(status: number): BunnyLifecycle {
  switch (status) {
    case 0:
    case 1:
    case 2:
      return "processing";
    case 3:
      return "ready";
    case 4:
      return "processing";
    case 5:
      return "failed";
    default:
      // 6/7/8/9/10 and any future/unknown status are intentionally ignored.
      return "ignore";
  }
}

// #2905 — map the Bunny API VIDEO-OBJECT `status` (bunnyGetVideo().video.status)
// → the same provider-agnostic lifecycle. This is a DIFFERENT enum from the
// webhook one above: here 4 is Finished and 3 is Transcoding.
// https://docs.bunny.net/reference/video_getvideo
//
// 7 JitSegmenting / 8 JitPlaylistsCreated are just-in-time encoding transitions
// that only occur on JIT-enabled libraries; they are transitional, never
// terminal, so they map to `processing` and the reaper's stall deadline is the
// backstop if a JIT library never reaches 4.
export function mapBunnyStatusFromApiVideo(status: number): BunnyLifecycle {
  switch (status) {
    case 0: // Created
    case 1: // Uploaded
    case 2: // Processing
    case 3: // Transcoding  ← NOT finished. The webhook enum's 3 IS finished.
    case 7: // JitSegmenting
    case 8: // JitPlaylistsCreated
      return "processing";
    case 4: // Finished     ← terminal. The webhook enum's 4 is NOT terminal.
      return "ready";
    case 5: // Error
    case 6: // UploadFailed
      return "failed";
    default:
      return "ignore";
  }
}

// #2905 — THE ONE SANCTIONED ENUM CROSSING.
//
// The reconciler (event-cover-video-reaper) recovers a job by reading provider
// truth from the API and replaying it through the SAME finalize implementation
// the live webhook uses, which requires a webhook-enum body. Rather than let an
// API number silently masquerade as a webhook number (the #2905 defect), the
// API status is mapped to a lifecycle by its OWN mapper and then re-expressed as
// the canonical webhook status for that lifecycle:
//
//     API 4 Finished    → lifecycle "ready"      → webhook 3 Finished
//     API 3 Transcoding → lifecycle "processing" → webhook 2 Encoding
//     API 5 Error       → lifecycle "failed"     → webhook 5 Failed
//     anything else     → lifecycle "ignore"     → null (do not synthesize)
//
// Returning null (never a number) for `ignore` keeps an unknown provider status
// from being laundered into a lifecycle-bearing webhook body.
export function bunnyApiVideoStatusAsWebhookStatus(
  apiStatus: number,
): number | null {
  switch (mapBunnyStatusFromApiVideo(apiStatus)) {
    case "ready":
      return 3; // webhook Finished
    case "processing":
      return 2; // webhook Encoding
    case "failed":
      return 5; // webhook Failed
    case "ignore":
      return null;
  }
}

export type BunnyWebhookSignatureResult =
  | { ok: true }
  | { ok: false; code: string; status: number; message: string };

// Verify a library webhook against Bunny's confirmed v1 signing envelope
// (docs.bunny.net/stream/webhooks, verified 2026-07-03). A signed POST carries
// THREE headers: X-BunnyStream-Signature-Version (v1), -Signature-Algorithm
// (hmac-sha256), and -Signature = lowercase-hex HMAC-SHA256 of the EXACT RAW
// body keyed by the library read-only key (BUNNY_STREAM_WEBHOOK_KEY). We
// lowercase-normalize + constant-time compare the hex. A PRESENT signature whose
// version or algorithm is wrong or missing is REJECTED 403 — never silently
// accepted. `signatureVersion`/`signatureAlgorithm` are the header values (string
// when present, null when absent) supplied by the webhook handler; omitting them
// (undefined) preserves the legacy signature-only check for the exported-helper
// unit tests. A truly ABSENT signature is handled by the caller (fetch re-verify
// fallback), not here.
export async function verifyBunnyWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  signatureVersion?: string | null;
  signatureAlgorithm?: string | null;
  secret: string;
}): Promise<BunnyWebhookSignatureResult> {
  if (input.secret.length === 0) {
    return {
      ok: false,
      code: "missing_webhook_secret",
      status: 500,
      message: "Bunny webhook signing secret is not configured.",
    };
  }
  if (
    input.signatureHeader === null || input.signatureHeader.trim().length === 0
  ) {
    return {
      ok: false,
      code: "missing_signature",
      status: 403,
      message: "Bunny webhook signature header is missing.",
    };
  }
  // The signature is present → its v1 envelope MUST be valid. The handler always
  // supplies both header values (string|null); a null/wrong value here means the
  // POST claimed a signature without the confirmed v1/hmac-sha256 envelope, which
  // we reject rather than trust. (Undefined = exported-helper unit test → skip.)
  if (
    input.signatureVersion !== undefined ||
    input.signatureAlgorithm !== undefined
  ) {
    const version = (input.signatureVersion ?? "").trim().toLowerCase();
    if (version !== "v1") {
      return {
        ok: false,
        code: "unsupported_signature_version",
        status: 403,
        message: "Bunny webhook signature version is unsupported.",
      };
    }
    const algorithm = (input.signatureAlgorithm ?? "").trim().toLowerCase();
    if (algorithm !== "hmac-sha256") {
      return {
        ok: false,
        code: "unsupported_signature_algorithm",
        status: 403,
        message: "Bunny webhook signature algorithm is unsupported.",
      };
    }
  }
  const expected = await hmacSha256Hex(input.secret, input.rawBody);
  const provided = input.signatureHeader.trim().toLowerCase();
  if (!constantTimeEqual(expected, provided)) {
    return {
      ok: false,
      code: "invalid_signature",
      status: 403,
      message: "Bunny webhook signature is invalid.",
    };
  }
  return { ok: true };
}

// ── META-ORCH-1270 (Phase 2): account-level usage read (alarm + circuit-breaker) ──

export type BunnyLibraryUsage = { storageUsage: number; trafficUsage: number };

// GET https://api.bunny.net/videolibrary/{libraryId} with the ACCOUNT key.
// Returns StorageUsage + TrafficUsage (bytes). Shared by probeBunny (the health
// alarm) and the upload-intent circuit-breaker so both read usage the same way.
// FAIL CLOSED on ambiguity: a config-present-but-non-numeric body returns
// { ok:false, reason:"bunny_usage_non_numeric" } — the caller must NOT treat an
// unreadable usage as healthy (Vector-D root cause). Config-ABSENT is a distinct
// { ok:false, reason:"bunny_usage_not_configured" } (grey, pre-cutover).
// https://docs.bunny.net/reference/videolibrarypublic_index
export async function bunnyFetchLibraryUsage(
  timeoutMs = 5000,
): Promise<
  { ok: true; usage: BunnyLibraryUsage } | {
    ok: false;
    status: number;
    reason: string;
  }
> {
  const libraryId = bunnyLibraryId();
  const accountKey = bunnyAccountApiKey();
  if (libraryId.length === 0 || accountKey.length === 0) {
    return { ok: false, status: 0, reason: "bunny_usage_not_configured" };
  }
  let response: Response;
  try {
    response = await fetch(`${BUNNY_ACCOUNT_HOST}/videolibrary/${libraryId}`, {
      method: "GET",
      headers: { AccessKey: accountKey, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      reason: networkReason("bunny_usage_network", error),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: `bunny_usage_http_${response.status}`,
    };
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (body === null) {
    return {
      ok: false,
      status: response.status,
      reason: "bunny_usage_malformed",
    };
  }
  const storageUsage = typeof body.StorageUsage === "number"
    ? body.StorageUsage
    : Number(body.StorageUsage);
  const trafficUsage = typeof body.TrafficUsage === "number"
    ? body.TrafficUsage
    : Number(body.TrafficUsage);
  if (!Number.isFinite(storageUsage) || !Number.isFinite(trafficUsage)) {
    // Config present but the vendor returned non-numeric usage — the DANGEROUS
    // state the alarm must surface loudly, never resolve to green.
    return {
      ok: false,
      status: response.status,
      reason: "bunny_usage_non_numeric",
    };
  }
  return { ok: true, usage: { storageUsage, trafficUsage } };
}

// Pure: percent used = the HIGHER of the storage/traffic ratios against their
// caps. Returns null when a value is non-numeric or a cap is <= 0 (cannot
// compute → the caller must treat it as UNREADABLE, never healthy).
export function bunnyUsagePct(input: {
  storageUsage: unknown;
  trafficUsage: unknown;
  storageCapBytes: number;
  trafficCapBytes: number;
}): { usedPercent: number; storagePct: number; trafficPct: number } | null {
  const s = typeof input.storageUsage === "number"
    ? input.storageUsage
    : Number(input.storageUsage);
  const t = typeof input.trafficUsage === "number"
    ? input.trafficUsage
    : Number(input.trafficUsage);
  if (!Number.isFinite(s) || !Number.isFinite(t)) return null;
  if (!(input.storageCapBytes > 0) || !(input.trafficCapBytes > 0)) return null;
  const storagePct = (100 * s) / input.storageCapBytes;
  const trafficPct = (100 * t) / input.trafficCapBytes;
  return {
    usedPercent: Math.max(storagePct, trafficPct),
    storagePct,
    trafficPct,
  };
}
