// #3872 R3 — provider control plane for creator-owned review media.
// This intentionally uses a separate Bunny Stream library and CREATOR_ env
// namespace so creator uploads can never consume or bypass the event-cover cap.

import {
  BUNNY_TIMEOUTS_MS,
  fetchWithTimeout,
  mapBunnyStatusFromApiVideo,
  sha256Hex,
} from "./bunnyStream.ts";

const VIDEO_HOST = "https://video.bunnycdn.com";
const ACCOUNT_HOST = "https://api.bunny.net";
const TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";

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

export function creatorMediaConfig(): CreatorMediaConfig {
  return {
    libraryId: (Deno.env.get("CREATOR_BUNNY_STREAM_LIBRARY_ID") ?? "").trim(),
    apiKey: (Deno.env.get("CREATOR_BUNNY_STREAM_API_KEY") ?? "").trim(),
    accountApiKey: (Deno.env.get("CREATOR_BUNNY_ACCOUNT_API_KEY") ?? "").trim(),
    cdnHostname: (Deno.env.get("CREATOR_BUNNY_STREAM_CDN_HOSTNAME") ?? "")
      .trim(),
    tokenKey: (Deno.env.get("CREATOR_BUNNY_STREAM_TOKEN_KEY") ?? "").trim(),
    webhookKey: (Deno.env.get("CREATOR_BUNNY_STREAM_WEBHOOK_KEY") ?? "").trim(),
    storageCapBytes: positiveNumber(
      Deno.env.get("CREATOR_BUNNY_STORAGE_CAP_BYTES"),
    ),
    trafficCapBytes: positiveNumber(
      Deno.env.get("CREATOR_BUNNY_TRAFFIC_CAP_BYTES"),
    ),
  };
}

export type CapacityDecision = {
  blocked: boolean;
  reason:
    | "under_cap"
    | "capacity_reached"
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
  if (
    !resolutions.includes("1080p") || input.mp4Fallback !== true ||
    input.keepOriginalFiles !== false || input.tokenAuthentication !== true
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
    config.libraryId.length === 0 || config.accountApiKey.length === 0 ||
    config.storageCapBytes <= 0 || config.trafficCapBytes <= 0
  ) {
    return { blocked: true, reason: "usage_unreadable", usedPercent: null };
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
  return evaluateCreatorMediaCapacity({
    storageUsage: body.StorageUsage,
    trafficUsage: body.TrafficUsage,
    storageCapBytes: config.storageCapBytes,
    trafficCapBytes: config.trafficCapBytes,
    enabledResolutions: body.EnabledResolutions,
    mp4Fallback: body.EnableMP4Fallback,
    keepOriginalFiles: body.KeepOriginalFiles,
    tokenAuthentication: body.EnableTokenAuthentication,
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
  const token = await sha256Hex(`${videoId}${config.tokenKey}${expires}`);
  return {
    url: `https://iframe.mediadelivery.net/embed/${
      encodeURIComponent(config.libraryId)
    }/${encodeURIComponent(videoId)}?token=${token}&expires=${expires}`,
    expiresAt: new Date(expires * 1000).toISOString(),
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

export async function deleteCreatorVideo(
  videoId: string,
  config = creatorMediaConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (config.libraryId.length === 0 || config.apiKey.length === 0) {
    return { ok: false, reason: "provider_not_configured" };
  }
  let providerResponse: Response;
  try {
    providerResponse = await fetchWithTimeout(
      `${VIDEO_HOST}/library/${config.libraryId}/videos/${
        encodeURIComponent(videoId)
      }`,
      { method: "DELETE", headers: { AccessKey: config.apiKey } },
      BUNNY_TIMEOUTS_MS.delete,
      fetchImpl,
    );
  } catch {
    return { ok: false, reason: "provider_delete_unreadable" };
  }
  return providerResponse.ok || providerResponse.status === 404
    ? { ok: true }
    : { ok: false, reason: `provider_delete_${providerResponse.status}` };
}
