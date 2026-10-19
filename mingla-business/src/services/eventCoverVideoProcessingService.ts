import Constants from "expo-constants";
// #3040 — the ONE web TUS uploader and the lane's numeric contract.
import {
  tusMetadata as laneTusMetadata,
  uploadSourceWeb,
  VIDEO_LIMITS,
  VideoUploadError,
} from "@mingla/video-upload";
import { supabase } from "./supabase";
import {
  isClientVersionRequired,
  laneVersionHeaders,
  LANE_CODES,
  readCreativeId,
  readRenditionHeight,
  STATUS_ACTIVE_ONLY_FLAG,
  isActiveLaneStatus,
  UPDATE_REQUIRED_COPY,
  type LaneTargetKind,
} from "./eventCoverVideoEdgeContract";
import { BusinessAuthNotReadyError } from "../utils/authReadiness";
import { EVENT_COVER_MAX_VIDEO_DURATION_MS } from "../utils/eventCoverMediaRules";
import { Platform } from "react-native";
import {
  getFileInfoAsync,
} from "../utils/platformFileSystem";
// ORCH-1295 — native TUS PATCH transport (File.bytes() + expo/fetch). Metro
// resolves the *.native.ts on device and the *.ts web stub in the web bundle,
// keeping expo-file-system / expo/fetch out of web.
import {
  patchBunnyTusNative,
  readEventCoverVideoChunk,
} from "./eventCoverVideoTusPatch";

declare const require: (moduleName: string) => {
  Video?: {
    compress: (
      uri: string,
      options: unknown,
      onProgress?: (progress: number) => void,
    ) => Promise<string>;
  };
};

export { EVENT_COVER_MAX_VIDEO_DURATION_MS };
export const EVENT_COVER_SOURCE_CEILING_MS = EVENT_COVER_MAX_VIDEO_DURATION_MS;
// #3040 B-C15/B-C20 — ONE limits line per media, from the approved design (D4).
// The old two-line copy promised a 25 MB output and omitted WebM on native.
export const EVENT_COVER_VIDEO_LIMITS_COPY = "MP4, MOV, M4V or WebM · Up to 1 minute · Under 100 MB";
export const EVENT_COVER_PHOTO_LIMITS_COPY = "JPEG, PNG, WebP or GIF · Under 30 MB";
export const AD_VIDEO_LIMITS_COPY = "MP4, MOV, M4V or WebM · 5 seconds to 1 minute · Under 100 MB";
/** @deprecated #3040 — kept as an alias of the single video limits line. */
export const EVENT_COVER_VIDEO_PROCESSING_COPY = EVENT_COVER_VIDEO_LIMITS_COPY;
/** #3040 B-C20 — the pipeline's source cap, from the shared limits table. */
export const EVENT_COVER_SOURCE_MAX_BYTES = VIDEO_LIMITS.SOURCE_MAX_BYTES;
export const EVENT_COVER_VIDEO_NOT_CONFIGURED_COPY =
  "Video cover processing is not configured yet. Images and GIFs still work.";

export type EventCoverVideoApplyMode = "draft_auto" | "published_manual";
export type EventCoverVideoJobStatus =
  | "source_uploading"
  | "source_uploaded"
  | "processing_queued"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled"
  | "superseded"
  | "applied";

// #966 — Bunny/TUS is the sole cover-video transport. The Cloudinary multipart
// legs were removed as dead residue post-META-1270; the server always returns
// `protocol: "tus"`.
export type EventCoverVideoUploadProtocol = "tus";

// META-ORCH-1270 — the upload descriptor the client acts on. `fields` are opaque
// server-supplied strings the client forwards blindly (Cloudinary signed params
// OR the Bunny TUS creation headers). NO provider secret ever appears here.
export type EventCoverVideoUploadDescriptor = {
  url: string;
  fields: Record<string, string>;
  protocol?: EventCoverVideoUploadProtocol;
  videoId?: string;
  metadata?: { filetype?: string; title?: string; sha256?: string };
};

interface UploadIntentResponse {
  jobId?: string;
  // C1 (META-ORCH-1270): widened to include "bunny" (logged only, never branched).
  provider?: "cloudinary" | "bunny";
  upload?: {
    url?: string;
    protocol?: EventCoverVideoUploadProtocol;
    videoId?: string;
    fields?: Record<string, string>;
    metadata?: { filetype?: string; title?: string; sha256?: string };
  };
  error?: string;
  detail?: string;
  initializing?: boolean;
  retryAfterMs?: number;
  status?: EventCoverVideoStatus;
}

export type EventCoverVideoUploadIntent =
  | { jobId: string; upload: EventCoverVideoUploadDescriptor }
  | { jobId: string; status: EventCoverVideoStatus; initializing: boolean; retryAfterMs: number };

type EdgeErrorPayload = { error?: string; detail?: string };

export type EventCoverVideoProcessingPhase =
  | "upload_intent"
  | "source_upload"
  | "source_uploaded"
  | "status"
  | "cancel"
  | "apply";

interface EventCoverVideoErrorMetadata {
  requestId?: string;
  phase?: EventCoverVideoProcessingPhase;
  edgeStatus?: number;
  edgeError?: string;
  edgeDetail?: string;
  lastStatus?: EventCoverVideoStatus;
}

export interface EventCoverVideoUploadProgress {
  phase: "source_upload";
  bytesSent: number;
  bytesTotal: number;
  percent: number;
  /**
   * #3040 B-C8 — true when the transfer cannot report byte-true progress (a
   * native source of one chunk or less). The card shows "Uploading…" with no %.
   */
  indeterminate?: boolean;
  /** #3040 — true only on the emission after the server confirmed every byte. */
  final?: boolean;
}

/**
 * #3040 — why a job is `detached` (design truth rules T3/T4/T5):
 *   - `offline`      H-10: the device reports no network; auto-resumes.
 *   - `interrupted`  H-11: a server or transport error, after 3 auto-retries.
 *   - `repick`       H-12: the bytes cannot be re-read here (web reload/unmount).
 *   - `watching`     the watch deadline passed; the job runs on server-side.
 */
export type EventCoverVideoDetachedReason = "offline" | "interrupted" | "repick" | "watching";

export type EventCoverVideoUploadStage =
  | { phase: "idle"; percent: 0 }
  | { phase: "picking"; percent: 0 }
  // #3040 B-C18 — web: the file chooser closed and the duration is being read.
  | { phase: "reading"; percent: 0 }
  | { phase: "preparing" | "validating" | "intent_pending" | "ack_pending" | "reattaching"; percent: 0 }
  | { phase: "compressing"; percent: number | null }
  | {
      phase: "uploading";
      /** Byte-true % (server-confirmed, held at 99 until the last byte), or null. */
      percent: number | null;
      confirmedBytes?: number;
      totalBytes?: number;
      /** #3040 B-C9 — an automatic retry is in flight ("Reconnecting…"). */
      retrying?: boolean;
    }
  | {
      phase: "processing";
      percent: number | null;
      timing: "normal" | "delayed" | "breached";
    }
  | {
      phase: "detached";
      percent: 0;
      sourceAcknowledged: boolean;
      reason?: EventCoverVideoDetachedReason;
      confirmedBytes?: number;
      totalBytes?: number;
    }
  | { phase: "ready"; percent: 100 }
  | { phase: "applying"; percent: 100 }
  | { phase: "applied"; percent: 100 }
  | {
      phase: "error";
      percent: 0;
      code: string;
      message: string;
      /** #3040 B-C1 — false for answers no retry can change (e.g. app too old). */
      canRetry?: boolean;
    };

export type CompressionProgress = { phase: "compressing"; percent: number };

export interface EventCoverVideoStatus {
  jobId: string;
  // ORCH-0989: null for brand-target jobs.
  eventId: string | null;
  brandId: string;
  // ORCH-0989: "event" (default) or "brand".
  targetKind?: LaneTargetKind;
  venueId: string | null;
  draftOwnerKey: string | null;
  clientOperationId: string | null;
  status: EventCoverVideoJobStatus;
  applyMode: EventCoverVideoApplyMode;
  stageLabel: string;
  progressKind: "determinate" | "indeterminate" | "terminal";
  progressPercent: number | null;
  isTerminal: boolean;
  canRetry: boolean;
  canCheckAgain: boolean;
  canCancel: boolean;
  processedUrl: string | null;
  processedMimeType: string | null;
  processedPosterUrl: string | null;
  processedBytes: number | null;
  processedDurationMs: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  safeJobCode: string;
  createdAt: string | null;
  updatedAt: string | null;
  sourceUploadedAt: string | null;
  appliedAt: string | null;
  cancelledAt: string | null;
  applicationVersion: number;
  applicationReceipt: Record<string, unknown> | null;
  /** #3040 E-10b — the ad creative row for an `ad_creative` job, once it exists. */
  creativeId?: string | null;
  /** #3040 E-10b — the provider rendition height the lane served. */
  renditionHeight?: number | null;
}

interface StatusResponse extends Partial<EventCoverVideoStatus> {
  error?: string;
  detail?: string;
}

export type EventCoverVideoProviderUploadResponse = {
  asset_id?: string;
  public_id?: string;
  bytes?: number;
  duration?: number;
  format?: string;
  resource_type?: string;
};

type WaitForEventCoverVideoReadyOptions = {
  pollIntervalMs?: number;
  onStatus?: (status: EventCoverVideoStatus) => void;
  /** @deprecated Processing has no client deadline; retained for old callers. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

export class EventCoverVideoProcessingError extends Error {
  code: string;
  requestId?: string;
  phase?: EventCoverVideoProcessingPhase;
  edgeStatus?: number;
  edgeError?: string;
  edgeDetail?: string;
  lastStatus?: EventCoverVideoStatus;

  constructor(
    code: string,
    message: string,
    metadata: EventCoverVideoErrorMetadata = {},
  ) {
    super(message);
    this.name = "EventCoverVideoProcessingError";
    this.code = code;
    this.requestId = metadata.requestId;
    this.phase = metadata.phase;
    this.edgeStatus = metadata.edgeStatus;
    this.edgeError = metadata.edgeError;
    this.edgeDetail = metadata.edgeDetail;
    this.lastStatus = metadata.lastStatus;
  }
}

const attachVideoErrorMetadata = <
  T extends EventCoverVideoProcessingError | BusinessAuthNotReadyError,
>(
  error: T,
  metadata: EventCoverVideoErrorMetadata,
): T => {
  Object.assign(error, metadata);
  return error;
};

const throwMalformed = (
  label: string,
  metadata: EventCoverVideoErrorMetadata = {},
): never => {
  throw new EventCoverVideoProcessingError(
    "malformed_response",
    `${label} returned an unexpected response.`,
    metadata,
  );
};

const processingErrorFromPayload = (
  payload: EdgeErrorPayload | null,
  fallback: string,
  metadata: EventCoverVideoErrorMetadata = {},
): EventCoverVideoProcessingError | BusinessAuthNotReadyError => {
  const edgeMetadata = {
    ...metadata,
    edgeDetail: payload?.detail ?? metadata.edgeDetail,
    edgeError: payload?.error ?? metadata.edgeError,
  };
  if (payload?.error === "unauthenticated") {
    return attachVideoErrorMetadata(
      new BusinessAuthNotReadyError(
        "unauthenticated",
        "Finishing sign-in. Try again in a moment.",
      ),
      edgeMetadata,
    );
  }
  // #3040 B-C1 — the lane refuses an app too old to upload (HTTP 426). Never a
  // generic retry: no retry can change this answer, only an update can.
  if (isClientVersionRequired(payload?.error, metadata.edgeStatus)) {
    return new EventCoverVideoProcessingError(
      LANE_CODES.clientVersionRequired,
      UPDATE_REQUIRED_COPY.body,
      edgeMetadata,
    );
  }
  if (payload?.error === LANE_CODES.creativeMaterializePending) {
    return new EventCoverVideoProcessingError(
      LANE_CODES.creativeMaterializePending,
      "Saving to your ad. Checking how it fits each platform.",
      edgeMetadata,
    );
  }
  if (payload?.error === "provider_not_configured") {
    return new EventCoverVideoProcessingError(
      "provider_not_configured",
      payload.detail ?? EVENT_COVER_VIDEO_NOT_CONFIGURED_COPY,
      edgeMetadata,
    );
  }
  if (payload?.error === "validation_error") {
    return new EventCoverVideoProcessingError(
      "validation_error",
      validationDetailMessage(payload.detail),
      edgeMetadata,
    );
  }
  if (payload?.error === "forbidden") {
    return new EventCoverVideoProcessingError(
      "forbidden",
      "You do not have permission to update this event cover.",
      edgeMetadata,
    );
  }
  if (payload?.error === "not_found") {
    return new EventCoverVideoProcessingError(
      "not_found",
      "This video cover job could not be found.",
      edgeMetadata,
    );
  }
  if (payload?.error === "job_not_ready") {
    return new EventCoverVideoProcessingError(
      "job_not_ready",
      "Your video is still processing. You can check again in a moment.",
      edgeMetadata,
    );
  }
  if (payload?.error === "upload_temporarily_unavailable") {
    return new EventCoverVideoProcessingError(
      "upload_temporarily_unavailable",
      "Video uploads are updating. Try again in a moment.",
      edgeMetadata,
    );
  }
  if (payload?.error === "upload_initializing") {
    return new EventCoverVideoProcessingError(
      "upload_initializing",
      "Your resumable upload is still being prepared. Try again in a moment.",
      edgeMetadata,
    );
  }
  if (payload?.error === "upload_verification_pending") {
    return new EventCoverVideoProcessingError(
      "upload_verification_pending",
      "Your upload arrived and is still being verified. Check again in a moment.",
      edgeMetadata,
    );
  }
  if (payload?.error === "internal_error") {
    return new EventCoverVideoProcessingError(
      "internal_error",
      internalErrorDetailMessage(payload.detail),
      edgeMetadata,
    );
  }
  if (typeof payload?.error === "string") {
    return new EventCoverVideoProcessingError(
      payload.error,
      fallback,
      edgeMetadata,
    );
  }
  return new EventCoverVideoProcessingError("edge_error", fallback, edgeMetadata);
};

const internalErrorDetailMessage = (detail?: string): string => {
  switch (detail) {
    case "event_read_failed":
      return "Could not verify this event before upload. Try again.";
    case "role_check_failed":
    case "role_rank_failed":
      return "Could not verify your event permissions before upload. Try again.";
    case "job_insert_failed":
      return "Could not create a video processing job. Try again.";
    case "provider_payload_update_failed":
      return "Could not finish preparing the video processing job. Try again.";
    default:
      return "Could not prepare video upload. Try again.";
  }
};

const validationDetailMessage = (detail?: string): string => {
  switch (detail) {
    case "source_size_out_of_range":
      return "Video file size was missing or over 100 MB. Try another trimmed clip.";
    case "source_duration_out_of_range":
      return "Choose another video up to 1 minute long and try again.";
    case "trim_invalid":
    case "trim_out_of_range":
    case "trim_over_duration":
      return "Choose a valid video up to 1 minute long and try again.";
    case "event_id_invalid_uuid":
    case "brand_id_invalid_uuid":
      return "This event is still syncing. Reopen the draft and try again.";
    // #3040 E-3g/E-3h — the edge mirrors the pick-time checks.
    case LANE_CODES.adVideoTooShort:
      return "Ad videos need at least 5 seconds. Choose another video.";
    case LANE_CODES.sourceTooLarge:
      return "Videos must be under 100 MB. Try a shorter clip.";
    case "invalid_json":
      return "Video upload request was malformed. Try again.";
    default:
      return detail ?? "This video cover could not be prepared.";
  }
};

const devLog = (label: string, payload: Record<string, unknown>): void => {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.info(`[eventCoverVideoProcessingService] ${label}`, payload);
  }
};

const devWarn = (label: string, payload: Record<string, unknown>): void => {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn(`[eventCoverVideoProcessingService] ${label}`, payload);
  }
};

type EventCoverVideoUploadTelemetry = {
  eventId: string;
  applyMode: EventCoverVideoApplyMode;
  jobId?: string;
  phase: EventCoverVideoProcessingPhase;
  errorCode?: string;
  timestamp: string;
};

export const logEventCoverVideoUploadTelemetry = (
  eventName:
    | "video_cover_upload_intent_failed"
    | "video_cover_upload_ready"
    | "video_cover_upload_preview_rolled_back",
  payload: EventCoverVideoUploadTelemetry,
): void => {
  devWarn(eventName, payload);
};

const errorCodeOf = (error: unknown, fallback = "unknown"): string => {
  if (
    error !== null &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  if (
    error !== null &&
    typeof error === "object" &&
    typeof (error as { edgeError?: unknown }).edgeError === "string"
  ) {
    return (error as { edgeError: string }).edgeError;
  }
  return fallback;
};

const clampPercent = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value)));

// #3040 B-C8 / design T1-T2 — the percent is server-confirmed bytes ÷ total,
// FLOORED and held at 99 until the emission that follows the server's
// confirmation of the last byte (`final`). Rounding up used to show 100 while
// the last chunk was still unconfirmed.
const emitUploadProgress = (
  callback: ((progress: EventCoverVideoUploadProgress) => void) | undefined,
  bytesSent: number,
  bytesTotal: number,
  options: { final?: boolean; indeterminate?: boolean } = {},
): void => {
  if (
    callback === undefined ||
    !Number.isFinite(bytesSent) ||
    !Number.isFinite(bytesTotal) ||
    bytesTotal <= 0
  ) {
    return;
  }
  const truePercent = Math.floor((bytesSent / bytesTotal) * 100);
  callback({
    bytesSent: Math.max(0, bytesSent),
    bytesTotal,
    percent: options.final === true ? 100 : Math.max(0, Math.min(99, truePercent)),
    phase: "source_upload",
    indeterminate: options.indeterminate === true,
    final: options.final === true,
  });
};

const statFileSize = async (
  uri: string,
  fallbackBytes: number,
): Promise<number> => {
  try {
    const info = await getFileInfoAsync(uri);
    const size = (info as { exists?: boolean; size?: unknown }).size;
    if (info.exists && typeof size === "number" && size > 0) return size;
  } catch {
    // Keep the caller-provided bytes when the platform cannot stat the URI.
  }
  return fallbackBytes;
};

interface VideoCompressorModule {
  compress: (
    uri: string,
    options: unknown,
    onProgress?: (progress: number) => void,
  ) => Promise<string>;
  cancelCompression?: (cancellationId: string) => void;
  activateBackgroundTask?: (onExpired?: (data: unknown) => void) => Promise<unknown>;
  deactivateBackgroundTask?: () => Promise<unknown>;
}

const loadVideoCompressor = (): VideoCompressorModule | null => {
  if (Platform.OS === "web") return null;
  try {
    // react-native-compressor Video API. Option and method names below are read
    // from the INSTALLED package's own types
    // (node_modules/react-native-compressor/lib/typescript/src/Video/index.d.ts),
    // not from the docs site — `maxSize`, `progressDivider`,
    // `getCancellationId`, `cancelCompression`, `activateBackgroundTask` and
    // `deactivateBackgroundTask` are all declared there.
    return require("react-native-compressor").Video ?? null;
  } catch {
    return null;
  }
};

// Issue #3128 follow-up — the reporter's clip was 4K, and that is the whole
// story of the 19-minute failure.
//
// The trim editor is a keyframe STREAM COPY (`enablePreciseTrimming: false`,
// issue #1350), so trimming to one minute preserves the source resolution AND bitrate:
// the compressor was handed a full-bitrate 4K stream and asked to transcode it
// on a phone. `compressionMethod: "auto"` sizes its target from that source, so
// it tried to keep 4K — minutes of work, and on this device it never finished.
//
// Nothing downstream wants 4K. Bunny transcodes server-side and delivers a
// 720p-max ladder (`play_720p.mp4` is what every applied cover here resolves
// to), so every pixel above 1080p is spent to be thrown away twice — once by
// the phone, once by the provider.
//
// So: downscale to 1080p on the way in. A quarter of the pixels of 4K, well
// above anything the delivery ladder serves, and a job a phone can actually
// finish.
// #3134 — 1280, not 1920. Bunny's delivery ladder tops out at 720p in this
// project (`play_720p.mp4` on every applied cover), so 1080p is a rung nobody
// is served: it costs the phone a bigger encode and the host a bigger upload to
// produce pixels the provider then discards. 1280 is exactly what gets
// delivered, and four times the pixels of the 640 the library's `auto` mode
// silently used — which is why a real device's cover came back 360x640.
// #3040 §2 — the lane now serves 1080p (Snapchat needs 1080×1920), so the
// phone keeps a 1920 long edge at 8 Mbps: a full minute is ≈61 MB plus audio,
// inside the 100 MB source cap with room to spare.
const COMPRESSION_MAX_EDGE_PX = VIDEO_LIMITS.NATIVE_COMPRESSION_MAX_EDGE_PX;
const COMPRESSION_BITRATE_BPS = VIDEO_LIMITS.NATIVE_COMPRESSION_BITRATE_BPS;
// `auto` reports progress rarely enough that the sheet showed a bare spinner
// with no percentage. This asks for an update every 1%, which also gives the
// stall detector below a real signal to watch instead of silence.
const COMPRESSION_PROGRESS_DIVIDER = 1;

// Issue #3128 — the compressor used to be awaited with NOTHING guarding it: no
// timeout, no abort, no progress requirement. Observed on a real iPhone,
// production build, 2026-09-08: "Optimizing video…" for 19 minutes and then a
// generic "We couldn't finish this video upload", with no job row ever created
// — so nothing was ever uploaded and the word "upload" was a lie about which
// step died.
//
// Two guards, and one change of posture.
//
// STALL, not total time. The window resets on every progress callback, so a
// genuinely slow compression of a large 4K clip survives; one that has gone
// quiet does not. A hard ceiling sits behind it for the case where progress
// keeps arriving but the job never ends.
//
// PREFER SUCCEEDING. Compression is an optimisation, not a requirement. If the
// original is already within the pipeline's size contract, a failed or stalled
// compression falls back to uploading it untouched rather than failing the
// host's cover for an optimisation they never asked for.
//
// NAME THE REAL CAUSE. When we do have to fail, the underlying error travels
// with the message. The generic fallback in `safeUploadError` told us nothing
// about why, on the one path where "why" is the whole question.
const COMPRESSION_STALL_MS = 90_000;
const COMPRESSION_CEILING_MS = 600_000;

export const compressVideoLocally = async (input: {
  uri: string;
  bytes: number;
  durationMs: number;
  maxUncompressedBytes?: number;
  onProgress?: (progress: CompressionProgress) => void;
}): Promise<{
  uri: string;
  bytes: number;
  durationMs: number;
  wasCompressed: boolean;
}> => {
  const compressor = loadVideoCompressor();
  const untouched = {
    uri: input.uri,
    bytes: input.bytes,
    durationMs: input.durationMs,
    wasCompressed: false,
  };
  if (compressor === null || input.bytes < VIDEO_LIMITS.NATIVE_COMPRESSION_MIN_SOURCE_BYTES) return untouched;

  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let settled = false;
  let stallTimer: ReturnType<typeof setInterval> | null = null;

  const deadline = new Promise<never>((_, reject) => {
    stallTimer = setInterval(() => {
      if (settled) return;
      const now = Date.now();
      const quietFor = now - lastProgressAt;
      const ranFor = now - startedAt;
      if (quietFor < COMPRESSION_STALL_MS && ranFor < COMPRESSION_CEILING_MS) return;
      reject(
        new EventCoverVideoProcessingError(
          "video_compression_stalled",
          quietFor >= COMPRESSION_STALL_MS
            ? `Compressing stopped responding after ${Math.round(quietFor / 1000)}s.`
            : `Compressing did not finish within ${Math.round(ranFor / 1000)}s.`,
        ),
      );
    }, 5_000);
  });

  // The library owns a real cancellation handle; without it a stalled race
  // abandons the promise while the native transcode keeps burning the battery.
  let cancellationId: string | null = null;
  // And it owns an explicit background task. iOS suspends a backgrounded app,
  // which halts an AVFoundation export — the reporter switched apps to send a
  // screenshot while this ran. Best effort: if the platform declines it, the
  // stall detector below is still the backstop.
  try {
    await compressor.activateBackgroundTask?.();
  } catch {
    // Not fatal — compression simply stays foreground-only on this device.
  }

  try {
    const compressedUri = await Promise.race([
      compressor.compress(
        input.uri,
        {
          compressionMethod: "manual",
          maxSize: COMPRESSION_MAX_EDGE_PX,
          bitrate: COMPRESSION_BITRATE_BPS,
          progressDivider: COMPRESSION_PROGRESS_DIVIDER,
          getCancellationId: (id: string) => { cancellationId = id; },
        },
        (progress: number) => {
          lastProgressAt = Date.now();
          input.onProgress?.({
            percent: clampPercent(progress * 100),
            phase: "compressing",
          });
        },
      ),
      deadline,
    ]);
    return {
      uri: compressedUri,
      bytes: await statFileSize(compressedUri, input.bytes),
      durationMs: input.durationMs,
      wasCompressed: true,
    };
  } catch (compressionError) {
    // Compression is an optimisation. If the original already fits, ship it.
    const fallbackCeiling = input.maxUncompressedBytes;
    if (typeof fallbackCeiling === "number" && input.bytes <= fallbackCeiling) {
      return untouched;
    }
    const detail = compressionError instanceof Error
      ? compressionError.message
      : String(compressionError);
    throw new EventCoverVideoProcessingError(
      "video_compression_failed",
      `Your phone couldn\u2019t prepare this video (${detail}). Try a shorter clip, or record at a lower resolution.`,
    );
  } finally {
    settled = true;
    if (stallTimer !== null) clearInterval(stallTimer);
    if (cancellationId !== null) {
      try { compressor.cancelCompression?.(cancellationId); } catch { /* best effort */ }
    }
    try {
      await compressor.deactivateBackgroundTask?.();
    } catch {
      // Best effort: releasing the task must never mask the real outcome.
    }
  }
};

const edgeError = async (
  error: unknown,
  fallback: string,
  metadata: EventCoverVideoErrorMetadata = {},
): Promise<EventCoverVideoProcessingError | BusinessAuthNotReadyError> => {
  const maybe = error as {
    message?: string;
    context?: { status?: number; json?: () => Promise<unknown> };
  };
  const edgeMetadata = {
    ...metadata,
    edgeStatus: maybe?.context?.status ?? metadata.edgeStatus,
  };
  if (maybe?.context?.status === 401) {
    devWarn("edge-error-auth", {
      fallback,
      message: maybe.message,
      status: maybe.context.status,
    });
    return attachVideoErrorMetadata(
      new BusinessAuthNotReadyError(
        "unauthenticated",
        "Finishing sign-in. Try again in a moment.",
      ),
      {
        ...edgeMetadata,
        edgeError: "unauthenticated",
      },
    );
  }
  if (typeof maybe?.context?.json === "function") {
    try {
      const payload = await maybe.context.json();
      if (isClientVersionRequired(null, maybe.context.status) && (payload === null || typeof payload !== "object")) {
        return processingErrorFromPayload({ error: LANE_CODES.clientVersionRequired }, fallback, edgeMetadata);
      }
      if (payload !== null && typeof payload === "object") {
        const edgePayload = payload as EdgeErrorPayload;
        devWarn("edge-error-payload", {
          detail: edgePayload.detail,
          error: edgePayload.error,
          fallback,
          message: maybe.message,
          status: maybe.context.status,
        });
        return processingErrorFromPayload(
          edgePayload,
          fallback,
          edgeMetadata,
        );
      }
    } catch {
      // Keep the edge message fallback when the function body is unavailable.
    }
  }
  if (isClientVersionRequired(null, maybe?.context?.status)) {
    return processingErrorFromPayload({ error: LANE_CODES.clientVersionRequired }, fallback, edgeMetadata);
  }
  // #3040 B-C9 / design T4 — "offline" copy only when the device says so. On
  // web the browser's own flag is the truth; native asks NetInfo in the hook.
  if (maybe?.context?.status === undefined && isBrowserOffline()) {
    return new EventCoverVideoProcessingError(
      "network_offline",
      "You're offline. It'll pick up when you reconnect.",
      edgeMetadata,
    );
  }
  return new EventCoverVideoProcessingError(
    "edge_error",
    fallback,
    edgeMetadata,
  );
};

/** #3040 B-C9 — web only: the browser reports no network. Native returns false. */
export const isBrowserOffline = (): boolean =>
  Platform.OS === "web" &&
  typeof navigator !== "undefined" &&
  (navigator as { onLine?: boolean }).onLine === false;

/** #3040 B-C1 — the version headers the lane logs on a 426 (native only). */
const laneHeaders = (): Record<string, string> =>
  laneVersionHeaders(Platform.OS, Constants.expoConfig?.version ?? null);

type EventCoverVideoUploadIntentInput = {
  // ORCH-0989: "event" (default) or "brand". Brand-target jobs carry no eventId.
  target?: LaneTargetKind;
  eventId?: string;
  venueId?: string;
  draftOwnerKey?: string;
  clientOperationId?: string;
  brandId: string;
  applyMode: EventCoverVideoApplyMode;
  sourceFileName?: string | null;
  sourceMimeType?: string | null;
  sourceExtension?: string;
  sourceSha256?: string;
  sourceBytes: number;
  sourceDurationMs: number;
  trimStartMs?: number;
  trimEndMs?: number;
  refreshTransport?: boolean;
};

type DeterministicEventCoverVideoUploadIntentInput = EventCoverVideoUploadIntentInput & {
  clientOperationId: string;
  sourceExtension: string;
  sourceSha256: string;
};

// Legacy callers cannot receive replay/status envelopes because the edge
// rejects their missing immutable identity with 426. Preserve that truthful
// success type while deterministic callers handle both descriptor and replay.
export function createEventCoverVideoUploadIntent(
  input: DeterministicEventCoverVideoUploadIntentInput,
): Promise<EventCoverVideoUploadIntent>;
export function createEventCoverVideoUploadIntent(
  input: EventCoverVideoUploadIntentInput,
): Promise<Extract<EventCoverVideoUploadIntent, { upload: EventCoverVideoUploadDescriptor }>>;
export async function createEventCoverVideoUploadIntent(
  input: EventCoverVideoUploadIntentInput,
): Promise<EventCoverVideoUploadIntent> {
  const requestId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  devLog("upload-intent-request", {
    applyMode: input.applyMode,
    brandId: input.brandId,
    eventId: input.eventId,
    requestId,
    sourceBytes: input.sourceBytes,
    sourceDurationMs: input.sourceDurationMs,
    sourceMimeType: input.sourceMimeType,
    trimEndMs: input.trimEndMs,
    trimStartMs: input.trimStartMs,
  });
  let data: UploadIntentResponse | null = null;
  let error: unknown = null;
  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (sessionError !== null || typeof accessToken !== "string" || accessToken.length === 0) {
      throw new BusinessAuthNotReadyError(
        "unauthenticated",
        "Finishing sign-in. Try again in a moment.",
      );
    }
    const response = await supabase.functions.invoke<UploadIntentResponse>(
      "event-cover-video-upload-intent",
      {
        body: { ...input, clientRequestId: requestId },
        headers: { ...laneHeaders(), Authorization: `Bearer ${accessToken}` },
      },
    );
    data = response.data;
    error = response.error;
  } catch (caught) {
    logEventCoverVideoUploadTelemetry("video_cover_upload_intent_failed", {
      applyMode: input.applyMode,
      errorCode: errorCodeOf(caught),
      eventId: input.eventId ?? "",
      phase: "upload_intent",
      timestamp: new Date().toISOString(),
    });
    throw caught;
  }
  if (error) {
    devWarn("upload-intent-edge-error", {
      applyMode: input.applyMode,
      brandId: input.brandId,
      eventId: input.eventId ?? "",
      requestId,
    });
    const preparedError = await edgeError(error, "Could not prepare video upload.", {
      phase: "upload_intent",
      requestId,
    });
    logEventCoverVideoUploadTelemetry("video_cover_upload_intent_failed", {
      applyMode: input.applyMode,
      errorCode: errorCodeOf(preparedError, "edge_error"),
      eventId: input.eventId ?? "",
      phase: "upload_intent",
      timestamp: new Date().toISOString(),
    });
    throw preparedError;
  }
  if (data?.error !== undefined) {
    devWarn("upload-intent-rejected", {
      detail: data.detail,
      error: data.error,
      requestId,
    });
    const preparedError = processingErrorFromPayload(data, "Could not prepare video upload.", {
      phase: "upload_intent",
      requestId,
    });
    logEventCoverVideoUploadTelemetry("video_cover_upload_intent_failed", {
      applyMode: input.applyMode,
      errorCode: errorCodeOf(preparedError, data.error),
      eventId: input.eventId ?? "",
      phase: "upload_intent",
      timestamp: new Date().toISOString(),
    });
    throw preparedError;
  }
  const jobId = data?.jobId;
  if (
    typeof jobId === "string" && data?.status !== undefined &&
    typeof data.status.status === "string"
  ) {
    return {
      jobId,
      status: data.status,
      initializing: data.initializing === true,
      retryAfterMs: typeof data.retryAfterMs === "number"
        ? Math.max(250, Math.min(2_000, data.retryAfterMs))
        : 1_000,
    };
  }
  const uploadUrl = data?.upload?.url;
  const uploadFields = data?.upload?.fields;
  if (
    typeof jobId !== "string" ||
    typeof uploadUrl !== "string" ||
    uploadFields === undefined
  ) {
    devWarn("upload-intent-malformed", {
      hasFields: uploadFields !== undefined,
      hasJobId: typeof jobId === "string",
      hasUploadUrl: typeof uploadUrl === "string",
      requestId,
    });
    throwMalformed("event-cover-video-upload-intent", {
      phase: "upload_intent",
      requestId,
    });
  }
  devLog("upload-intent-ready", {
    jobId,
    provider: data?.provider,
    requestId,
  });
  return {
    jobId: jobId as string,
    upload: {
      fields: uploadFields as Record<string, string>,
      url: uploadUrl as string,
      // META-ORCH-1270 — carry the transport discriminator + Bunny-only fields
      // through so the upload leg can branch. Absent for the Cloudinary path.
      protocol: data?.upload?.protocol,
      videoId: data?.upload?.videoId,
      metadata: data?.upload?.metadata,
    },
  };
}

// META-ORCH-1270 — TUS (Bunny) transport helpers ────────────────────────────
const cancelledUploadError = (): EventCoverVideoProcessingError =>
  new EventCoverVideoProcessingError(
    "source_upload_cancelled",
    "Video upload was cancelled.",
  );

// #3040 — TUS metadata encoding moved to the shared package (one owner for
// Host web, native and Admin). Re-exported so existing callers keep working.
export const tusMetadata = laneTusMetadata;

const resolveTusLocation = (base: string, location: string): string => {
  if (/^https?:\/\//i.test(location)) return location;
  try {
    return new URL(location, base).toString();
  } catch {
    return location;
  }
};

// #3040 B-C8 / I-VIDEO-ONE-UPLOADER — the web PATCH loop lives in
// `@mingla/video-upload` (`uploadSourceWeb`), shared with Admin. Its typed
// failures are translated here so every caller sees one error type.
const laneUploadError = (error: unknown): unknown => {
  if (error instanceof VideoUploadError) {
    return new EventCoverVideoProcessingError(error.code, error.message, {
      edgeDetail: error.detail,
    });
  }
  return error;
};

// ORCH-1295 — the native TUS PATCH no longer streams through expo-file-system's
// BINARY_CONTENT upload task (which dropped the TUS `Upload-Offset` header →
// Bunny 400 "Video upload failed (400)") and does NOT use `fetch(uri).blob()`
// (which silently returns a size-0 Blob on RN iOS — ORCH-0786 — i.e. an empty
// body). It reads the clip bytes with the native `File` API and streams them via
// `expo/fetch`, which sends `Upload-Offset` / `Tus-Resumable` /
// `Content-Type: application/offset+octet-stream` VERBATIM → Bunny 204. All
// native-module access is isolated in eventCoverVideoTusPatch.native.ts (Metro
// web-excludes it). expo/fetch has no upload-progress event, so this leg emits a
// coarse start/finish bar; abort is honored via the shared AbortSignal.
const patchTusNative = async (input: {
  url: string;
  uri: string;
  headers: Record<string, string>;
  onProgress?: (progress: EventCoverVideoUploadProgress) => void;
  signal?: AbortSignal;
}): Promise<void> => {
  if (input.signal?.aborted) throw cancelledUploadError();

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const offset = Number(input.headers["Upload-Offset"] ?? 0);
    const length = Number(input.headers["Content-Length"] ?? 0);
    bytes = await readEventCoverVideoChunk(input.uri, offset, length);
  } catch (error) {
    if (input.signal?.aborted) throw cancelledUploadError();
    if (error instanceof EventCoverVideoProcessingError) throw error;
    // #3040 B-C11 — the prepared copy lives in the OS cache, which iOS and
    // Android may purge. A copy that cannot be read is gone for good: say so
    // (design H-12) instead of offering a Resume that can never work.
    throw new EventCoverVideoProcessingError(
      "source_file_gone",
      "Your phone cleared the copy we were uploading. Choose the video again.",
      { edgeDetail: "source_read_failed" },
    );
  }
  if (input.signal?.aborted) throw cancelledUploadError();

  emitUploadProgress(input.onProgress, 0, 1);

  let result: { status: number; bodyText: string };
  try {
    result = await patchBunnyTusNative({
      body: bytes,
      headers: input.headers,
      signal: input.signal,
      url: input.url,
    });
  } catch (error) {
    if (input.signal?.aborted) throw cancelledUploadError();
    if (error instanceof EventCoverVideoProcessingError) throw error;
    throw new EventCoverVideoProcessingError(
      "source_upload_failed",
      "We couldn't upload this video. Check your connection and resume.",
      { edgeDetail: "tus_patch_transport_failed" },
    );
  }
  if (input.signal?.aborted) throw cancelledUploadError();

  if (result.status !== 200 && result.status !== 204) {
    throw new EventCoverVideoProcessingError(
      "transport_integrity_failed",
      "We couldn't resume this upload. Choose the original video again.",
      { edgeDetail: `tus_patch_http_${result.status}` },
    );
  }
  emitUploadProgress(input.onProgress, 1, 1);
};

// #3040 B-C8 — 2 MiB native chunks: a clip of a few MB now shows real steps
// instead of sitting at 0% for the whole transfer. Web uses the package's
// 8 MiB chunks with in-flight XHR progress.
const EVENT_COVER_TUS_CHUNK_BYTES = VIDEO_LIMITS.TUS_CHUNK_NATIVE_BYTES;

const headTusOffset = async (
  upload: EventCoverVideoUploadDescriptor,
  signal?: AbortSignal,
): Promise<number> => {
  let response: Response;
  try {
    response = await fetch(upload.url, {
      method: "HEAD",
      headers: { ...upload.fields, "Tus-Resumable": "1.0.0" },
      signal,
    });
  } catch {
    if (signal?.aborted) throw cancelledUploadError();
    throw new EventCoverVideoProcessingError("source_upload_failed", "Connection interrupted. Resume when you're back online.", { edgeDetail: "tus_head_transport_failed" });
  }
  if (!response.ok) {
    throw new EventCoverVideoProcessingError(
      "transport_integrity_failed",
      "We couldn't resume this upload. Choose the original video again.",
      { edgeDetail: `tus_head_http_${response.status}` },
    );
  }
  const offset = Number(response.headers.get("Upload-Offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new EventCoverVideoProcessingError("transport_integrity_failed", "We couldn't resume this upload. Choose the original video again.");
  }
  return offset;
};

export const uploadEventCoverVideoSourceViaTus = async (input: {
  upload: EventCoverVideoUploadDescriptor;
  uri: string;
  bytes?: number;
  onProgress?: (progress: EventCoverVideoUploadProgress) => void;
  signal?: AbortSignal;
}): Promise<EventCoverVideoProviderUploadResponse | null> => {
  if (input.signal?.aborted) throw cancelledUploadError();

  let bytes = typeof input.bytes === "number" && input.bytes > 0 ? input.bytes : 0;
  if (Platform.OS === "web") {
    // ORCH-1303: read the picked clip's bytes from its browser object URL.
    // A raw fetch() rejection here surfaces an opaque "Failed to fetch"
    // (Constitution #3 non-actionable). Wrap it in an honest, actionable
    // error so the operator knows what to do next. The happy path (a valid
    // `blob:` uri) is unchanged.
    let webBlob: Blob;
    try {
      const blobResponse = await fetch(input.uri);
      webBlob = await blobResponse.blob();
    } catch {
      throw new EventCoverVideoProcessingError(
        "source_file_gone",
        "Could not read the selected video in your browser. Choose the video again.",
      );
    }
    try {
      await uploadSourceWeb({
        file: webBlob,
        transport: { url: input.upload.url, headers: { ...input.upload.fields } },
        signal: input.signal,
        onProgress: (progress) => {
          input.onProgress?.({
            phase: "source_upload",
            bytesSent: progress.confirmedBytes,
            bytesTotal: progress.totalBytes,
            percent: progress.percent,
            final: progress.final,
          });
        },
      });
    } catch (error) {
      throw laneUploadError(error);
    }
    return null;
  }
  if (bytes <= 0) {
    bytes = await statFileSize(input.uri, 0);
  }
  if (bytes <= 0) {
    throw new EventCoverVideoProcessingError(
      "source_upload_failed",
      "Video file was empty.",
    );
  }

  // #3040 B-C8 — a source of one chunk or less cannot show byte-true steps:
  // the card shows "Uploading…" without a percent instead of 0% → 100%.
  const indeterminate = bytes <= EVENT_COVER_TUS_CHUNK_BYTES;
  let offset = await headTusOffset(input.upload, input.signal);
  if (offset > bytes) throw new EventCoverVideoProcessingError("transport_integrity_failed", "We couldn't resume this upload. Choose the original video again.");
  emitUploadProgress(input.onProgress, offset, bytes, { indeterminate });
  while (offset < bytes) {
    const chunkLength = Math.min(EVENT_COVER_TUS_CHUNK_BYTES, bytes - offset);
    const patchHeaders = {
      ...input.upload.fields,
      "Content-Type": "application/offset+octet-stream",
      "Content-Length": String(chunkLength),
      "Tus-Resumable": "1.0.0",
      "Upload-Offset": String(offset),
    };
    await patchTusNative({ headers: patchHeaders, onProgress: undefined, signal: input.signal, uri: input.uri, url: input.upload.url });
    const serverOffset = await headTusOffset(input.upload, input.signal);
    if (serverOffset <= offset || serverOffset > bytes) {
      throw new EventCoverVideoProcessingError("transport_integrity_failed", "We couldn't resume this upload. Choose the original video again.");
    }
    offset = serverOffset;
    // Emitted after EVERY confirmed chunk (PATCH answered, HEAD agrees).
    if (offset < bytes) emitUploadProgress(input.onProgress, offset, bytes, { indeterminate });
  }
  emitUploadProgress(input.onProgress, bytes, bytes, { final: true, indeterminate });
  return null;
};

export const uploadEventCoverVideoSource = async (input: {
  upload: EventCoverVideoUploadDescriptor;
  uri: string;
  bytes?: number;
  jobId?: string;
  fileName?: string | null;
  mimeType?: string | null;
  onProgress?: (progress: EventCoverVideoUploadProgress) => void;
  signal?: AbortSignal;
}): Promise<EventCoverVideoProviderUploadResponse | null> => {
  // #966 — Bunny/TUS is the sole transport. The server always returns
  // `protocol: "tus"`; the Cloudinary multipart/XHR/chunked legs were removed as
  // dead residue post-META-1270. A non-"tus" descriptor is unreachable in
  // production — fail loud rather than silently attempt a retired path.
  if (input.upload.protocol === "tus") {
    return await uploadEventCoverVideoSourceViaTus(input);
  }
  throw new EventCoverVideoProcessingError(
    "provider_not_configured",
    EVENT_COVER_VIDEO_NOT_CONFIGURED_COPY,
  );
};

export const fetchEventCoverVideoStatus = async (
  jobId: string,
  signal?: AbortSignal,
): Promise<EventCoverVideoStatus> => {
  const { data, error } = await supabase.functions.invoke<StatusResponse>(
    "event-cover-video-status",
    { body: { jobId }, signal, headers: laneHeaders() },
  );
  if (error) throw await edgeError(error, "Could not check video processing status.");
  if (data?.error !== undefined) {
    throw processingErrorFromPayload(
      data,
      "Could not check video processing status.",
    );
  }
  if (data === null) {
    throwMalformed("event-cover-video-status");
  }
  return mapStatusResponse(data as StatusResponse, "event-cover-video-status");
};

export const fetchEventCoverVideoStatusByTarget = async (input: {
  target: LaneTargetKind; eventId?: string; brandId: string | null; venueId?: string; draftOwnerKey?: string; signal?: AbortSignal;
  /**
   * #3040 E-10a / design T6 — only a job still in flight. A finished, failed
   * or cancelled latest job is never handed back to a freshly opened sheet.
   * Older servers ignore the flag, so the answer is filtered here as well.
   */
  activeOnly?: boolean;
}): Promise<EventCoverVideoStatus | null> => {
  const { signal, activeOnly, ...rest } = input;
  const body = activeOnly === true ? { ...rest, ...STATUS_ACTIVE_ONLY_FLAG } : rest;
  const { data, error } = await supabase.functions.invoke<StatusResponse>("event-cover-video-status", { body, signal, headers: laneHeaders() });
  if (error) {
    const mapped = await edgeError(error, "Could not restore video processing status.");
    if (mapped.code === "not_found") return null;
    throw mapped;
  }
  if (data?.error === "not_found") return null;
  if (data?.error) throw processingErrorFromPayload(data, "Could not restore video processing status.");
  const mapped = data ? mapStatusResponse(data, "event-cover-video-status") : null;
  if (mapped !== null && activeOnly === true && !isActiveLaneStatus(mapped.status)) return null;
  return mapped;
};

const mapStatusResponse = (
  payload: StatusResponse,
  label: string,
): EventCoverVideoStatus => {
  const responseJobId = payload.jobId;
  const statusValue = payload.status;
  if (typeof responseJobId !== "string" || typeof statusValue !== "string") {
    throwMalformed(label);
  }
  const canonicalJobId = responseJobId as string;
  const status = statusValue as EventCoverVideoJobStatus;
  const stageLabel =
    typeof payload.stageLabel === "string" ? payload.stageLabel : status;
  return {
    applyMode: payload.applyMode === "published_manual" ? "published_manual" : "draft_auto",
    appliedAt: payload.appliedAt ?? null,
    brandId: typeof payload.brandId === "string" ? payload.brandId : "",
    canCancel: Boolean(payload.canCancel),
    canCheckAgain: Boolean(payload.canCheckAgain),
    canRetry: Boolean(payload.canRetry),
    cancelledAt: payload.cancelledAt ?? null,
    createdAt: payload.createdAt ?? null,
    // ORCH-0989: null for brand-target jobs (the edge fn returns null eventId).
    eventId: typeof payload.eventId === "string" ? payload.eventId : null,
    targetKind: payload.targetKind === "brand" || payload.targetKind === "venue" || payload.targetKind === "venue_draft" || payload.targetKind === "trip_day_media" || payload.targetKind === "ad_creative"
      ? payload.targetKind
      : "event",
    venueId: typeof payload.venueId === "string" ? payload.venueId : null,
    draftOwnerKey: typeof payload.draftOwnerKey === "string" ? payload.draftOwnerKey : null,
    clientOperationId: typeof payload.clientOperationId === "string" ? payload.clientOperationId : null,
    failureCode: payload.failureCode ?? null,
    // Retained as internal diagnostics for legacy callers; UI paths map only
    // the finite failureCode and safe job code below.
    failureMessage: payload.failureMessage ?? null,
    safeJobCode: typeof payload.safeJobCode === "string" ? payload.safeJobCode : canonicalJobId.slice(0, 8),
    isTerminal: Boolean(payload.isTerminal),
    jobId: canonicalJobId,
    processedBytes: typeof payload.processedBytes === "number" ? payload.processedBytes : null,
    processedDurationMs:
      typeof payload.processedDurationMs === "number" ? payload.processedDurationMs : null,
    processedMimeType: payload.processedMimeType ?? null,
    processedPosterUrl: payload.processedPosterUrl ?? null,
    processedUrl: payload.processedUrl ?? null,
    progressKind: payload.progressKind ?? "indeterminate",
    progressPercent:
      typeof payload.progressPercent === "number" ? payload.progressPercent : null,
    sourceUploadedAt: payload.sourceUploadedAt ?? null,
    stageLabel,
    status,
    updatedAt: payload.updatedAt ?? null,
    applicationVersion: typeof payload.applicationVersion === "number" ? payload.applicationVersion : 0,
    applicationReceipt: payload.applicationReceipt !== null && typeof payload.applicationReceipt === "object"
      ? payload.applicationReceipt as Record<string, unknown>
      : null,
    creativeId: readCreativeId(payload),
    renditionHeight: readRenditionHeight(payload),
  };
};

export const acknowledgeEventCoverVideoSourceUploaded = async (input: {
  // ORCH-0989: "event" (default) or "brand". Brand-target carries no eventId.
  target?: LaneTargetKind;
  jobId: string;
  eventId?: string;
  brandId: string;
  providerUploadResponse?: EventCoverVideoProviderUploadResponse | null;
}): Promise<EventCoverVideoStatus> => {
  const requestId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const { data, error } = await supabase.functions.invoke<StatusResponse>(
    "event-cover-video-source-uploaded",
    {
      body: {
        ...input,
        clientRequestId: requestId,
      },
      headers: laneHeaders(),
    },
  );
  if (error) {
    throw await edgeError(error, "Could not confirm video upload.", {
      phase: "source_uploaded",
      requestId,
    });
  }
  if (data?.error !== undefined) {
    throw processingErrorFromPayload(data, "Could not confirm video upload.", {
      phase: "source_uploaded",
      requestId,
    });
  }
  if (data === null) {
    throwMalformed("event-cover-video-source-uploaded", {
      phase: "source_uploaded",
      requestId,
    });
  }
  return mapStatusResponse(data as StatusResponse, "event-cover-video-source-uploaded");
};

export const applyEventCoverVideoJob = async (
  jobId: string,
  expectedVersion?: number,
  expectedProcessedUrl?: string,
): Promise<string> => {
  const { data, error } = await supabase.functions.invoke<{ processedUrl?: string }>(
    "event-cover-video-apply",
    { body: { jobId, expectedVersion, expectedProcessedUrl }, headers: laneHeaders() },
  );
  if (error) throw await edgeError(error, "Could not save processed video cover.");
  if ((data as { error?: string; detail?: string } | null)?.error !== undefined) {
    throw processingErrorFromPayload(
      data as { error?: string; detail?: string },
      "Could not save processed video cover.",
    );
  }
  const processedUrl = data?.processedUrl;
  if (typeof processedUrl !== "string") {
    throwMalformed("event-cover-video-apply");
  }
  return processedUrl as string;
};

export const cancelEventCoverVideoJob = async (
  input: string | { jobId: string; uploadAbortController?: AbortController | null },
): Promise<EventCoverVideoStatus> => {
  const jobId = typeof input === "string" ? input : input.jobId;
  if (typeof input !== "string") {
    input.uploadAbortController?.abort();
  }
  const { data, error } = await supabase.functions.invoke<StatusResponse>(
    "event-cover-video-cancel",
    { body: { jobId }, headers: laneHeaders() },
  );
  if (error) {
    throw await edgeError(error, "Could not cancel video processing.", {
      phase: "cancel",
    });
  }
  if (data?.error !== undefined) {
    throw processingErrorFromPayload(data, "Could not cancel video processing.", {
      phase: "cancel",
    });
  }
  if (data === null) throwMalformed("event-cover-video-cancel");
  return mapStatusResponse(data as StatusResponse, "event-cover-video-cancel");
};

export const waitForEventCoverVideoReady = async (
  jobId: string,
  options: WaitForEventCoverVideoReadyOptions | number = {},
): Promise<EventCoverVideoStatus> => {
  const pollIntervalMs =
    typeof options === "number" ? 1500 : options.pollIntervalMs ?? 1500;
  const onStatus = typeof options === "number" ? undefined : options.onStatus;
  const signal = typeof options === "number" ? undefined : options.signal;
  const delay = (ms: number): Promise<void> => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(cancelledUploadError()); }, { once: true });
  });
  let lastStatus: EventCoverVideoStatus | undefined;
  let failureCount = 0;
  while (true) {
    let status: EventCoverVideoStatus;
    try {
      status = await fetchEventCoverVideoStatus(jobId, signal);
      failureCount = 0;
    } catch (error) {
      if (
        error instanceof EventCoverVideoProcessingError &&
        ["forbidden", "not_found", "validation_error", "unauthenticated"].includes(error.code)
      ) throw error;
      failureCount += 1;
      const backoff = Math.min(30_000, pollIntervalMs * 2 ** Math.min(failureCount, 5));
      await delay(backoff + Math.floor(Math.random() * 250));
      continue;
    }
    lastStatus = status;
    onStatus?.(status);
    if (status.status === "ready" || status.status === "applied") {
      logEventCoverVideoUploadTelemetry("video_cover_upload_ready", {
        applyMode: status.applyMode,
        eventId: status.eventId ?? "",
        jobId: status.jobId,
        phase: "status",
        timestamp: new Date().toISOString(),
      });
      return status;
    }
    if (status.status === "failed" || status.status === "cancelled" || status.status === "superseded") {
      const safeMessage = status.status === "cancelled"
        ? "Video upload was cancelled."
        : status.status === "superseded"
        ? "A newer video was selected."
        : `We couldn't process this video. Choose another video, or contact support with job code ${status.safeJobCode}.`;
      throw new EventCoverVideoProcessingError(
        status.failureCode ?? status.status,
        safeMessage,
        { lastStatus: status, phase: "status" },
      );
    }
    await delay(pollIntervalMs);
  }
};
