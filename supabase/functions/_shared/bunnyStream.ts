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

// Hex-encoded SHA-256 of the input (used for the TUS AuthorizationSignature).
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Hex-encoded HMAC-SHA256 (webhook authenticity + the exported signer tests use).
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
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
): Promise<{ ok: true; guid: string } | { ok: false; reason: string }> {
  const libraryId = bunnyLibraryId();
  const apiKey = bunnyApiKey();
  if (libraryId.length === 0 || apiKey.length === 0) {
    return { ok: false, reason: "bunny_not_configured" };
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
    return { ok: false, reason: networkReason("bunny_create_network", error) };
  }
  void recordApiCall("bunny", response.ok, Date.now() - startedAt, response.status);
  if (!response.ok) {
    return { ok: false, reason: `bunny_create_http_${response.status}` };
  }
  let body: { guid?: unknown } | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const guid = typeof body?.guid === "string" ? body.guid.trim() : "";
  if (guid.length === 0) {
    return { ok: false, reason: "bunny_create_missing_guid" };
  }
  return { ok: true, guid };
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
  availableResolutions:
    typeof body.availableResolutions === "string" ? body.availableResolutions : null,
  encodeProgress: typeof body.encodeProgress === "number" ? body.encodeProgress : null,
});

// GET https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}
// https://docs.bunny.net/reference/video_getvideo
export async function bunnyGetVideo(
  guid: string,
): Promise<{ ok: true; video: BunnyVideo } | { ok: false; status: number; reason: string }> {
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
    response = await fetch(`${BUNNY_HOST}/library/${libraryId}/videos/${trimmed}`, {
      method: "GET",
      headers: { AccessKey: apiKey, accept: "application/json" },
    });
  } catch (error) {
    return { ok: false, status: 0, reason: networkReason("bunny_get_network", error) };
  }
  void recordApiCall("bunny", response.ok, Date.now() - startedAt, response.status);
  if (!response.ok) {
    return { ok: false, status: response.status, reason: `bunny_get_http_${response.status}` };
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (body === null || typeof body.guid !== "string") {
    return { ok: false, status: response.status, reason: "bunny_get_malformed" };
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
    response = await fetch(`${BUNNY_HOST}/library/${libraryId}/videos/${trimmed}`, {
      method: "DELETE",
      headers: { AccessKey: apiKey, accept: "application/json" },
    });
  } catch (error) {
    return { ok: false, reason: networkReason("bunny_delete_network", error) };
  }
  void recordApiCall("bunny", response.ok, Date.now() - startedAt, response.status);
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
export function bunnyBestMp4(video: BunnyVideo): { url: string; heightP: number } | null {
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

// Map the Bunny numeric webhook Status → our provider-agnostic job lifecycle.
// 0 Queued / 1 Processing / 2 Encoding → processing; 3 Finished → ready;
// 4 Resolution finished → processing (wait for 3); 5 Failed → failed; else ignore.
// https://docs.bunny.net/docs/stream-webhook
export function mapBunnyStatus(
  status: number,
): "processing" | "ready" | "failed" | "ignore" {
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
      return "ignore";
  }
}

export type BunnyWebhookSignatureResult =
  | { ok: true }
  | { ok: false; code: string; status: number; message: string };

// Verify a library webhook: HMAC-SHA256 of the RAW body with the read-only
// webhook key, constant-time compared against the X-BunnyStream-Signature header.
// https://docs.bunny.net/docs/stream-webhook
export async function verifyBunnyWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
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
  if (input.signatureHeader === null || input.signatureHeader.trim().length === 0) {
    return {
      ok: false,
      code: "missing_signature",
      status: 403,
      message: "Bunny webhook signature header is missing.",
    };
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
