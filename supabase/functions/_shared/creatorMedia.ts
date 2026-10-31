// #3872 R3 — provider control plane for creator-owned review media.
// This intentionally uses a separate Bunny Stream library and CREATOR_ env
// namespace so creator uploads can never consume or bypass the event-cover cap.

import {
  BUNNY_TIMEOUTS_MS,
  type BunnyCallOptions,
  bunnyDeleteVideo,
  fetchWithTimeout,
  mapBunnyStatusFromApiVideo,
  sha256Hex,
} from "./bunnyStream.ts";

const VIDEO_HOST = "https://video.bunnycdn.com";
const ACCOUNT_HOST = "https://api.bunny.net";
const TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";
const SHARED_CREDENTIAL_BUNDLE = "AD_CONVERSION_TOKENS";

export const CREATOR_MEDIA_MAX_BYTES = 150 * 1024 * 1024;
export const CREATOR_MEDIA_MAX_DURATION_S = 90;
export const CREATOR_MEDIA_CAP_PCT = 90;

export type CreatorMediaConfig = {
  libraryId: string;
  apiKey: string;
  accountApiKey: string;
  cdnHostname: string;
  tokenKey: string;
  webhookKey: string;
  storageCapBytes: number;
  trafficCapBytes: number;
};

const positiveNumber = (raw: string | undefined): number => {
  const value = Number(raw ?? "");
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/**
 * The project is at its governed secret-name ceiling. Production Creator
 * Bunny values therefore live in the existing encrypted credential map;
 * direct names remain a compatibility seam for local development and tests.
 * Values are never emitted when the bundle is absent or malformed.
 */
const creatorMediaEnv = (name: string): string | undefined => {
  try {
    const raw = Deno.env.get(SHARED_CREDENTIAL_BUNDLE);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed[name];
      if (typeof value === "string" && value.trim()) return value;
    }
  } catch {
    // Direct values are a local/test compatibility fallback when the governed
    // production bundle is absent or malformed.
  }
  const direct = Deno.env.get(name);
  return direct?.trim() ? direct : undefined;
};

export function creatorMediaConfig(): CreatorMediaConfig {
  return {
    libraryId: (creatorMediaEnv("CREATOR_BUNNY_STREAM_LIBRARY_ID") ?? "")
      .trim(),
    apiKey: (creatorMediaEnv("CREATOR_BUNNY_STREAM_API_KEY") ?? "").trim(),
    accountApiKey: (creatorMediaEnv("CREATOR_BUNNY_ACCOUNT_API_KEY") ?? "")
      .trim(),
    cdnHostname: (creatorMediaEnv("CREATOR_BUNNY_STREAM_CDN_HOSTNAME") ?? "")
      .trim(),
    tokenKey: (creatorMediaEnv("CREATOR_BUNNY_STREAM_TOKEN_KEY") ?? "")
      .trim(),
    webhookKey: (creatorMediaEnv("CREATOR_BUNNY_STREAM_WEBHOOK_KEY") ?? "")
      .trim(),
    storageCapBytes: positiveNumber(
      creatorMediaEnv("CREATOR_BUNNY_STORAGE_CAP_BYTES"),
    ),
    trafficCapBytes: positiveNumber(
      creatorMediaEnv("CREATOR_BUNNY_TRAFFIC_CAP_BYTES"),
    ),
  };
}

export type CapacityDecision = {
  blocked: boolean;
  reason:
    | "under_cap"
    | "capacity_reached"
    | "provider_not_configured"
    | "usage_unreadable"
    | "settings_invalid";
  usedPercent: number | null;
};

export function evaluateCreatorMediaCapacity(input: {
  storageUsage: unknown;
  trafficUsage: unknown;
  storageCapBytes: number;
  trafficCapBytes: number;
  enabledResolutions: unknown;
  mp4Fallback: unknown;
  keepOriginalFiles?: unknown;
  tokenAuthentication?: unknown;
  playerTokenAuthentication?: unknown;
  allowDirectPlay?: unknown;
}): CapacityDecision {
  const storage = Number(input.storageUsage);
  const traffic = Number(input.trafficUsage);
  if (
    !Number.isFinite(storage) || !Number.isFinite(traffic) ||
    !(input.storageCapBytes > 0) || !(input.trafficCapBytes > 0)
  ) {
    return { blocked: true, reason: "usage_unreadable", usedPercent: null };
  }
  const resolutions = typeof input.enabledResolutions === "string"
    ? input.enabledResolutions.split(",").map((part) =>
      part.trim().toLowerCase()
    )
    : [];
  const requiredResolutions = ["240p", "360p", "480p", "720p", "1080p"];
  if (
    requiredResolutions.some((resolution) =>
      !resolutions.includes(resolution)
    ) ||
    input.mp4Fallback !== true ||
    input.keepOriginalFiles !== false || input.tokenAuthentication !== true ||
    input.playerTokenAuthentication !== true || input.allowDirectPlay !== true
  ) {
    return { blocked: true, reason: "settings_invalid", usedPercent: null };
  }
  const usedPercent = Math.max(
    (100 * storage) / input.storageCapBytes,
    (100 * traffic) / input.trafficCapBytes,
  );
  return usedPercent >= CREATOR_MEDIA_CAP_PCT
    ? { blocked: true, reason: "capacity_reached", usedPercent }
    : { blocked: false, reason: "under_cap", usedPercent };
}

export async function readCreatorMediaCapacity(
  config = creatorMediaConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<CapacityDecision> {
  if (
    config.libraryId.length === 0 || config.apiKey.length === 0 ||
    config.accountApiKey.length === 0 || config.cdnHostname.length === 0 ||
    config.tokenKey.length === 0 || config.webhookKey.length === 0 ||
    config.storageCapBytes <= 0 || config.trafficCapBytes <= 0
  ) {
    return {
      blocked: true,
      reason: "provider_not_configured",
      usedPercent: null,
    };
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${ACCOUNT_HOST}/videolibrary/${config.libraryId}`,
      {
        headers: {
          AccessKey: config.accountApiKey,
          accept: "application/json",
        },
      },
      BUNNY_TIMEOUTS_MS.usage,
      fetchImpl,
    );
  } catch {
    return { blocked: true, reason: "usage_unreadable", usedPercent: null };
  }
  if (!response.ok) {
    return { blocked: true, reason: "usage_unreadable", usedPercent: null };
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (body === null) {
    return { blocked: true, reason: "usage_unreadable", usedPercent: null };
  }
  // Bunny applies Stream CDN token authentication on the library's backing
  // pull zone. The video-library API currently returns
  // EnableTokenAuthentication=null even when the pull zone is protected, so
  // treating that nullable mirror as provider truth would permanently block a
  // correctly configured library. Verify the authoritative pull-zone setting
  // before allowing an upload.
  const pullZoneId = Number(body.PullZoneId);
  if (!Number.isInteger(pullZoneId) || pullZoneId <= 0) {
    return { blocked: true, reason: "settings_invalid", usedPercent: null };
  }
  let pullZoneResponse: Response;
  try {
    pullZoneResponse = await fetchWithTimeout(
      `${ACCOUNT_HOST}/pullzone/${pullZoneId}`,
      {
        headers: {
          AccessKey: config.accountApiKey,
          accept: "application/json",
        },
      },
      BUNNY_TIMEOUTS_MS.usage,
      fetchImpl,
    );
  } catch {
    return { blocked: true, reason: "usage_unreadable", usedPercent: null };
  }
  if (!pullZoneResponse.ok) {
    return { blocked: true, reason: "usage_unreadable", usedPercent: null };
  }
  let pullZoneBody: Record<string, unknown> | null = null;
  try {
    pullZoneBody = await pullZoneResponse.json();
  } catch {
    pullZoneBody = null;
  }
  if (pullZoneBody === null) {
    return { blocked: true, reason: "usage_unreadable", usedPercent: null };
  }
  return evaluateCreatorMediaCapacity({
    storageUsage: body.StorageUsage,
    trafficUsage: body.TrafficUsage,
    storageCapBytes: config.storageCapBytes,
    trafficCapBytes: config.trafficCapBytes,
    enabledResolutions: body.EnabledResolutions,
    mp4Fallback: body.EnableMP4Fallback,
    keepOriginalFiles: body.KeepOriginalFiles,
    tokenAuthentication: pullZoneBody.ZoneSecurityEnabled,
    playerTokenAuthentication: body.PlayerTokenAuthenticationEnabled,
    allowDirectPlay: body.AllowDirectPlay,
  });
}

type VideoResult =
  | { ok: true; videoId: string }
  | { ok: false; reason: string; ambiguous?: boolean };

export async function findCreatorVideoByTitle(
  title: string,
  config = creatorMediaConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<VideoResult | { ok: true; videoId: null }> {
  if (config.libraryId.length === 0 || config.apiKey.length === 0) {
    return { ok: false, reason: "provider_not_configured" };
  }
  const url = new URL(`${VIDEO_HOST}/library/${config.libraryId}/videos`);
  url.searchParams.set("page", "1");
  url.searchParams.set("itemsPerPage", "100");
  url.searchParams.set("search", title);
  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      { headers: { AccessKey: config.apiKey, accept: "application/json" } },
      BUNNY_TIMEOUTS_MS.findByTitle,
      fetchImpl,
    );
  } catch {
    return { ok: false, reason: "provider_lookup_unreadable", ambiguous: true };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: `provider_lookup_${response.status}`,
      ambiguous: true,
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
    return { ok: false, reason: "provider_lookup_malformed", ambiguous: true };
  }
  const matches = items.filter((item) =>
    item !== null && typeof item === "object" &&
    (item as Record<string, unknown>).title === title &&
    typeof (item as Record<string, unknown>).guid === "string"
  ).map((item) => String((item as Record<string, unknown>).guid));
  if (matches.length > 1) {
    return {
      ok: false,
      reason: "provider_identity_ambiguous",
      ambiguous: true,
    };
  }
  return { ok: true, videoId: matches[0] ?? null };
}

export async function createCreatorVideo(
  title: string,
  config = creatorMediaConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<VideoResult> {
  if (config.libraryId.length === 0 || config.apiKey.length === 0) {
    return { ok: false, reason: "provider_not_configured" };
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${VIDEO_HOST}/library/${config.libraryId}/videos`,
      {
        method: "POST",
        headers: {
          AccessKey: config.apiKey,
          accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      },
      BUNNY_TIMEOUTS_MS.create,
      fetchImpl,
    );
  } catch {
    return { ok: false, reason: "provider_create_unreadable", ambiguous: true };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: `provider_create_${response.status}`,
      ambiguous: response.status >= 500 || response.status === 408 ||
        response.status === 429,
    };
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const videoId = typeof body?.guid === "string" ? body.guid.trim() : "";
  return videoId.length > 0
    ? { ok: true, videoId }
    : { ok: false, reason: "provider_create_missing_id", ambiguous: true };
}

export async function presignCreatorUpload(
  videoId: string,
  config = creatorMediaConfig(),
  expirySeconds = 3600,
) {
  const authorizationExpire = Math.floor(Date.now() / 1000) + expirySeconds;
  const authorizationSignature = await sha256Hex(
    `${config.libraryId}${config.apiKey}${authorizationExpire}${videoId}`,
  );
  return {
    tusEndpoint: TUS_ENDPOINT,
    libraryId: config.libraryId,
    videoId,
    authorizationExpire,
    authorizationSignature,
  };
}

export async function creatorPlaybackUrl(
  videoId: string,
  config = creatorMediaConfig(),
  nowMs = Date.now(),
): Promise<{ url: string; expiresAt: string } | null> {
  if (
    config.libraryId.length === 0 || config.tokenKey.length === 0 ||
    !/^[0-9a-f-]{20,}$/i.test(videoId)
  ) return null;
  const expires = Math.floor(nowMs / 1000) + 3600;
  // Bunny embed-view tokens are SHA-256(key + video ID + expiry). Keep the
  // signing key server-side and return only the finished, short-lived URL.
  const token = await sha256Hex(`${config.tokenKey}${videoId}${expires}`);
  return {
    url: `https://player.mediadelivery.net/embed/${
      encodeURIComponent(config.libraryId)
    }/${encodeURIComponent(videoId)}?token=${token}&expires=${expires}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
};

const hmacSha256 = async (key: string, message: string): Promise<string> => {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)),
    ),
  );
};

/**
 * A short-lived, single-file Bunny CDN grant for the approved MP4 master.
 * Advanced token authentication signs the exact path; the token key never
 * leaves this function and the grant cannot be reused for another asset.
 */
export async function creatorDownloadUrl(
  videoId: string,
  width: number | null,
  height: number | null,
  config = creatorMediaConfig(),
  nowMs = Date.now(),
): Promise<{ url: string; expiresAt: string; filename: string } | null> {
  if (
    config.cdnHostname.length === 0 || config.tokenKey.length === 0 ||
    !/^[0-9a-f-]{20,}$/i.test(videoId)
  ) return null;
  const sourceDimensions = [Number(width), Number(height)].filter((value) =>
    Number.isFinite(value) && value > 0
  );
  // Bunny's both-dimensions scaling cannot create a rendition larger than
  // either source edge. Using height alone asks for a nonexistent rendition
  // on portrait uploads (a 360x640 source was signed as play_480p.mp4).
  const sourceResolution = sourceDimensions.length > 0
    ? Math.min(...sourceDimensions)
    : 240;
  const rendition = sourceResolution >= 1080
    ? 1080
    : sourceResolution >= 720
    ? 720
    : sourceResolution >= 480
    ? 480
    : sourceResolution >= 360
    ? 360
    : 240;
  const path = `/${videoId}/play_${rendition}p.mp4`;
  const expires = Math.floor(nowMs / 1000) + 15 * 60;
  const signature = await hmacSha256(config.tokenKey, `${path}${expires}`);
  const host = config.cdnHostname.replace(/^https?:\/\//i, "").replace(
    /\/$/,
    "",
  );
  return {
    url: `https://${host}${path}?token=HS256-${signature}&expires=${expires}`,
    expiresAt: new Date(expires * 1000).toISOString(),
    filename: `mingla-approved-video-${videoId.slice(0, 8)}.mp4`,
  };
}

export type CreatorProviderVideo = {
  videoId: string;
  lifecycle: "processing" | "ready" | "failed" | "ignore";
  durationSeconds: number | null;
  sourceBytes: number | null;
  width: number | null;
  height: number | null;
};

const finitePositive = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export async function getCreatorVideo(
  videoId: string,
  config = creatorMediaConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<
  | { ok: true; video: CreatorProviderVideo }
  | { ok: false; reason: string; absent?: boolean }
> {
  if (config.libraryId.length === 0 || config.apiKey.length === 0) {
    return { ok: false, reason: "provider_not_configured" };
  }
  let providerResponse: Response;
  try {
    providerResponse = await fetchWithTimeout(
      `${VIDEO_HOST}/library/${config.libraryId}/videos/${
        encodeURIComponent(videoId)
      }`,
      { headers: { AccessKey: config.apiKey, accept: "application/json" } },
      BUNNY_TIMEOUTS_MS.get,
      fetchImpl,
    );
  } catch {
    return { ok: false, reason: "provider_get_unreadable" };
  }
  if (providerResponse.status === 404) {
    return { ok: false, reason: "provider_video_absent", absent: true };
  }
  if (!providerResponse.ok) {
    return { ok: false, reason: `provider_get_${providerResponse.status}` };
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = await providerResponse.json();
  } catch {
    body = null;
  }
  const guid = typeof body?.guid === "string" ? body.guid.trim() : "";
  const status = Number(body?.status);
  if (guid !== videoId || !Number.isInteger(status)) {
    return { ok: false, reason: "provider_get_malformed" };
  }
  return {
    ok: true,
    video: {
      videoId,
      lifecycle: mapBunnyStatusFromApiVideo(status),
      durationSeconds: finitePositive(body?.length),
      sourceBytes: finitePositive(body?.storageSize),
      width: finitePositive(body?.width),
      height: finitePositive(body?.height),
    },
  };
}

export function deleteCreatorVideo(
  videoId: string,
  config = creatorMediaConfig(),
  fetchImpl: typeof fetch = fetch,
  observeApiCall?: BunnyCallOptions["observeApiCall"],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (config.libraryId.length === 0 || config.apiKey.length === 0) {
    return Promise.resolve({ ok: false, reason: "provider_not_configured" });
  }
  return bunnyDeleteVideo(videoId, {
    libraryId: config.libraryId,
    apiKey: config.apiKey,
    timeoutMs: BUNNY_TIMEOUTS_MS.delete,
    fetchImpl,
    observeApiCall,
  });
}
