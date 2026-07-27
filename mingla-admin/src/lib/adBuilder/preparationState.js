/**
 * ISSUE-1184 video Phase A — pure preparation state policy.
 *
 * Server rows are authoritative. This module only orders work, normalizes
 * envelopes, rejects stale responses, and derives the READY create subset.
 */

// ISSUE-997 D1: Google joins the PREPARATION queue so a Google video can walk
// meta→snapchat→tiktok→google to READY (its YouTube resumable upload). Google
// video CREATE stays a SEPARATE, still-fail-closed gate (it is intentionally NOT
// added to VIDEO_CREATE_PLATFORMS / VIDEO_CREATE_ENABLED until 997-D2), so a
// prepared-READY Google row is still excluded from the build as approximation_only.
export const PREPARATION_ORDER = Object.freeze([
  "meta",
  "snapchat",
  "tiktok",
  "google",
]);
// ISSUE-997 C: TikTok joins the video-create subset (paused-video wired
// end-to-end). Google stays out of the CREATE subset until the separate 997-D2
// sub-wave — preparation (above) is wired in D1, create remains fail-closed.
export const VIDEO_CREATE_PLATFORMS = Object.freeze(["meta", "snapchat", "tiktok"]);
export const ACTIVE_PREPARATION_STATES = Object.freeze(["uploading", "processing"]);
export const TERMINAL_PREPARATION_STATES = Object.freeze(["ready", "failed", "timed_out"]);
const BUNNY_VIDEO_ID = /^[A-Za-z0-9-]{1,128}$/;

/**
 * Derive the only poster path accepted by the Phase A server contract. The MP4
 * and poster share the same Bunny CDN origin and recorded video identity.
 */
export function deriveBunnyPosterUrl(mp4MasterUrl, bunnyVideoId) {
  const id = typeof bunnyVideoId === "string" ? bunnyVideoId.trim() : "";
  if (!BUNNY_VIDEO_ID.test(id)) return "";
  try {
    const url = new URL(String(mp4MasterUrl ?? "").trim());
    const segments = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    if (
      url.protocol !== "https:" || url.username || url.password || url.port ||
      url.search || url.hash || !segments.includes(id)
    ) return "";
    return `${url.origin}/${id}/thumbnail.jpg`;
  } catch {
    return "";
  }
}

/** Exact source keys sent by the Creative step for a recorded Bunny video. */
export function buildVideoSourcePayload({
  bunnyVideoId,
  mp4MasterUrl,
  posterUrl,
}) {
  return {
    bunny_video_id: String(bunnyVideoId ?? "").trim(),
    poster_url: String(posterUrl ?? "").trim(),
    mp4_master_url: String(mp4MasterUrl ?? "").trim(),
    source_url: String(mp4MasterUrl ?? "").trim(),
  };
}

/** Stable identity for discarding an older provider-preview response. */
export function previewRequestFingerprint(request) {
  return request ? JSON.stringify(request) : "";
}

export function preparationKey(creativeId, platform) {
  return `${creativeId ?? "unrecorded"}::${platform}`;
}

export function emptyPreparation(platform) {
  return {
    platform,
    state: "not_started",
    capability: platform === "meta"
      ? "create_and_real_preview"
      : platform === "snapchat"
      ? "create_and_approx_preview"
      // ISSUE-997 C: kept in lock-step with the edge capabilityFor("tiktok") default
      // (still "preview_only" — see the note there). This label is cosmetic; TikTok
      // video create is gated by VIDEO_CREATE_PLATFORMS + VIDEO_CREATE_ENABLED, not
      // by this string. Server rows override this default anyway (normalizePreparation).
      : "preview_only",
    cached: true,
    retryable: false,
    error: null,
    trace_id: null,
  };
}

export function normalizePreparation(value, platform) {
  if (!value || typeof value !== "object") return emptyPreparation(platform);
  const allowed = new Set([
    "not_started",
    "uploading",
    "processing",
    "ready",
    "failed",
    "timed_out",
  ]);
  const state = allowed.has(value.state) ? value.state : "not_started";
  return {
    ...emptyPreparation(platform),
    ...value,
    platform,
    state,
    retryable: value.retryable === true,
    cached: value.cached === true,
  };
}

/** A response may update only the same creative/platform generation requested. */
export function applyPreparationResponse(state, {
  creativeId,
  platform,
  generation,
  response,
}) {
  if (!state || state.creativeId !== creativeId || state.generation !== generation) return state;
  return {
    ...state,
    rows: {
      ...state.rows,
      [platform]: normalizePreparation(response, platform),
    },
  };
}

export function createPreparationSession(creativeId, generation = 1) {
  return {
    creativeId,
    generation,
    stopped: false,
    runningPlatform: null,
    rows: Object.fromEntries(PREPARATION_ORDER.map((platform) => [
      platform,
      emptyPreparation(platform),
    ])),
  };
}

export function pendingQueue({ fundedPlatforms = [], rows = {}, stopped = false }) {
  if (stopped) return [];
  const funded = new Set(fundedPlatforms);
  return PREPARATION_ORDER.filter((platform) => {
    if (!funded.has(platform)) return false;
    const state = rows[platform]?.state ?? "not_started";
    return state === "not_started" || state === "uploading" || state === "processing";
  });
}

export function readyVideoSubset({ fundedPlatforms = [], rows = {} }) {
  const funded = new Set(fundedPlatforms);
  return VIDEO_CREATE_PLATFORMS.filter((platform) =>
    funded.has(platform) && rows[platform]?.state === "ready"
  );
}

export function videoPreparationGate(input) {
  const ready = readyVideoSubset(input);
  return {
    ready,
    canContinue: ready.length > 0,
    excluded: (input.fundedPlatforms ?? [])
      .filter((platform) => !ready.includes(platform))
      .map((platform) => ({
        platform,
        // ISSUE-997 C: tiktok is now in VIDEO_CREATE_PLATFORMS, so it is excluded
        // ONLY when its preparation is not ready (preparation_<state>) — never as
        // "preview_only". google (approximation_only) / reddit (video_excluded) stay.
        reason: platform === "google"
          ? "approximation_only"
          : platform === "reddit"
          ? "video_excluded"
          : `preparation_${input.rows?.[platform]?.state ?? "not_started"}`,
      })),
  };
}

export function retryDelayMs(row) {
  const seconds = Number(row?.retry_after_seconds);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) * 1000 : 10_000;
}

/** Canonical terminal 502 is data, not a generic transport failure. */
export function normalizePreparationInvoke(result, parsedError) {
  if (
    result?.error &&
    parsedError?.status === 502 &&
    parsedError?.body?.state === "failed" &&
    parsedError?.body?.cached === false
  ) {
    return {
      data: normalizePreparation(parsedError.body, parsedError.body.platform),
      error: null,
      terminalDiscovered: true,
    };
  }
  return result?.error ? { ...result, parsedError } : result;
}
