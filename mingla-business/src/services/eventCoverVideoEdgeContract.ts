import { BUSINESS_APP_STORE_URL, BUSINESS_PLAY_MARKET_URL } from "../constants/storeLinks";

/**
 * #3040 — the ONE place the Host client writes down what it assumes about the
 * video lane's edge contract (SPEC §5.2, server wave of PR-1).
 *
 * The server wave (`supabase/**`) is built on a parallel branch. Every request
 * shape, response field and error code this client depends on that is NEW in
 * #3040 is named here, so reconciling the two waves is a read of one file.
 * Pure TypeScript: no React, no React Native (constants only). Suites that mock
 * the processing service partially can still import this module for real.
 */

/** Lane targets. `ad_creative` is new (E-1b/E-3a): non-superseding, owner-keyed. */
export type LaneTargetKind =
  | "event"
  | "brand"
  | "venue"
  | "venue_draft"
  | "trip_day_media"
  | "ad_creative";

/** Error and detail codes the client branches on. */
export const LANE_CODES = {
  /** E-3b: HTTP 426, `error`. Old JS shows `detail`; new JS shows H-14e. */
  clientVersionRequired: "client_version_required",
  /** E-3b: the `code` the 426 body carries alongside `error`. */
  clientOperationIdRequired: "client_operation_id_required",
  /** E-3h: 422 `validation_error` detail for an ad video under 5 s. */
  adVideoTooShort: "ad_video_too_short",
  /** E-3g: 422 `validation_error` detail for a source over 100 MB. */
  sourceTooLarge: "source_too_large",
  /** E-6c: 503 while the server materializes the ad creative row. */
  creativeMaterializePending: "creative_materialize_pending",
  /** E-6c: 409 when the job's own asset failed the trust probe (terminal). */
  creativeSourceUntrusted: "creative_source_untrusted",
  /** E-3e: 409 when a refresh is asked for a transfer that already has bytes. */
  transportHasBytes: "transport_has_bytes",
  /** E-3e: 503 structured failure of the transport refresh (retryable). */
  transportRefreshFailed: "transport_refresh_failed",
  /** E-3d: 503 when the replay presign could not extend the lease (retryable). */
  transportLeaseExtendFailed: "transport_lease_extend_failed",
} as const;

/** The H-14e sentence pair. The edge's 426 `detail` carries the same text. */
export const UPDATE_REQUIRED_COPY = {
  title: "Update Mingla Host to upload videos",
  body: "This version can’t upload videos anymore. Updating takes a minute.",
} as const;

/** True for the old-client rejection, by body code or by HTTP status. */
export const isClientVersionRequired = (
  payloadError: string | null | undefined,
  httpStatus?: number | null,
): boolean => payloadError === LANE_CODES.clientVersionRequired || httpStatus === 426;

/**
 * E-10a: the status-by-target body flag that limits the "latest job" lookup to
 * jobs still in flight (`source_uploading` … `ready`). Old servers ignore it,
 * so the client ALSO filters what comes back (see `isActiveLaneStatus`).
 */
export const STATUS_ACTIVE_ONLY_FLAG = { activeOnly: true } as const;

/** The statuses E-10a returns when `activeOnly` is set. */
export const ACTIVE_LANE_STATUSES: readonly string[] = [
  "source_uploading",
  "source_uploaded",
  "processing_queued",
  "processing",
  "ready",
];

export const isActiveLaneStatus = (status: string): boolean =>
  ACTIVE_LANE_STATUSES.includes(status);

/** E-6c / E-10b: the creative id on an `ad_creative` apply or status payload. */
export const readCreativeId = (payload: unknown): string | null => {
  if (payload === null || typeof payload !== "object") return null;
  const value = (payload as { creativeId?: unknown }).creativeId;
  return typeof value === "string" && value.length > 0 ? value : null;
};

/** E-10b: the rendition height the webhook chose (1080 when it fit). */
export const readRenditionHeight = (payload: unknown): number | null => {
  if (payload === null || typeof payload !== "object") return null;
  const value = (payload as { renditionHeight?: unknown }).renditionHeight;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** E-1d owner-key grammar, mirrored so the client never sends a key the edge refuses. */
export const AD_CREATIVE_OWNER_KEY_PATTERN = /^(admin-library|host-ad|ari):[A-Za-z0-9_-]{3,120}$/;

export const hostAdOwnerKey = (draftId: string): string => `host-ad:${draftId}`;
export const ariAdOwnerKey = (proposalId: string): string => `ari:${proposalId}`;
export const isValidAdCreativeOwnerKey = (key: string): boolean =>
  AD_CREATIVE_OWNER_KEY_PATTERN.test(key);

/**
 * B-C1 request headers. The edge logs them on a 426 (E-3b).
 *
 * The lane's CORS allow-list (`_shared/eventCoverVideo.ts corsHeaders`) names
 * both headers as of this PR, pinned by the Deno suite
 * `eventCoverVideo.issue3040.corsVersionHeaders`. Web still does not send them:
 * on merge the web build and the edge functions deploy separately, and a web
 * build that reaches users before the new CORS list would have every upload
 * preflight-rejected. Web has no store build that can be too old, so it loses
 * only a log field.
 * [TRANSITIONAL] web omits the version headers — exit: flip
 * `LANE_VERSION_HEADERS_ON_WEB` in the first PR after #3040's edge deploy is
 * confirmed live (the OPTIONS response lists `x-mingla-app-version`).
 */
export const LANE_VERSION_HEADERS_ON_WEB = false;
export const LANE_APP_VERSION_HEADER = "x-mingla-app-version";
export const LANE_PLATFORM_HEADER = "x-mingla-platform";

export const laneVersionHeaders = (
  platform: string,
  appVersion: string | null | undefined,
): Record<string, string> => {
  if (platform === "web" && !LANE_VERSION_HEADERS_ON_WEB) return {};
  const headers: Record<string, string> = { [LANE_PLATFORM_HEADER]: platform };
  if (typeof appVersion === "string" && appVersion.length > 0) {
    headers[LANE_APP_VERSION_HEADER] = appVersion;
  }
  return headers;
};

/** Store listings for the H-14e "Update app" action (native only). */
export const HOST_APP_STORE_URLS = {
  ios: BUSINESS_APP_STORE_URL,
  android: BUSINESS_PLAY_MARKET_URL,
} as const;

export const hostAppStoreUrl = (platform: string): string | null =>
  platform === "ios"
    ? HOST_APP_STORE_URLS.ios
    : platform === "android"
      ? HOST_APP_STORE_URLS.android
      : null;
