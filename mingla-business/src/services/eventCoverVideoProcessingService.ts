import { supabase } from "./supabase";
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
export const EVENT_COVER_VIDEO_PROCESSING_COPY =
  Platform.OS === "web"
    ? "Video covers: MP4, MOV, M4V, or WebM • up to 15 seconds • under 100 MB. Mingla makes a browser-safe MP4 under 25 MB."
    : "Video covers: MP4, MOV, or M4V • up to 15 seconds • under 100 MB. Mingla makes a browser-safe MP4 under 25 MB.";
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
}

export type EventCoverVideoUploadStage =
  | { phase: "idle"; percent: 0 }
  | { phase: "picking"; percent: 0 }
  | { phase: "preparing" | "validating" | "intent_pending" | "ack_pending" | "reattaching"; percent: 0 }
  | { phase: "compressing"; percent: number | null }
  | { phase: "uploading"; percent: number }
  | { phase: "processing"; percent: number | null }
  | { phase: "detached"; percent: 0; sourceAcknowledged: boolean }
  | { phase: "ready"; percent: 100 }
  | { phase: "applying"; percent: 100 }
  | { phase: "applied"; percent: 100 }
  | { phase: "error"; percent: 0; code: string; message: string };

export type CompressionProgress = { phase: "compressing"; percent: number };

export interface EventCoverVideoStatus {
  jobId: string;
  // ORCH-0989: null for brand-target jobs.
  eventId: string | null;
  brandId: string;
  // ORCH-0989: "event" (default) or "brand".
  targetKind?: "event" | "brand" | "venue" | "venue_draft";
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
      return "Choose another 15-second clip and try again.";
    case "trim_invalid":
    case "trim_out_of_range":
    case "trim_over_duration":
      return "Choose a valid 15-second clip and try again.";
    case "event_id_invalid_uuid":
    case "brand_id_invalid_uuid":
      return "This event is still syncing. Reopen the draft and try again.";
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

const emitUploadProgress = (
  callback: ((progress: EventCoverVideoUploadProgress) => void) | undefined,
  bytesSent: number,
  bytesTotal: number,
): void => {
  if (
    callback === undefined ||
    !Number.isFinite(bytesSent) ||
    !Number.isFinite(bytesTotal) ||
    bytesTotal <= 0
  ) {
    return;
  }
  callback({
    bytesSent: Math.max(0, bytesSent),
    bytesTotal,
    percent: clampPercent((bytesSent / bytesTotal) * 100),
    phase: "source_upload",
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

const loadVideoCompressor = ():
  | { compress: (uri: string, options: unknown, onProgress?: (progress: number) => void) => Promise<string> }
  | null => {
  if (Platform.OS === "web") return null;
  try {
    // react-native-compressor Video.compress API:
    // https://github.com/numandev1/react-native-compressor#compress-1
    return require("react-native-compressor").Video ?? null;
  } catch {
    return null;
  }
};

export const compressVideoLocally = async (input: {
  uri: string;
  bytes: number;
  durationMs: number;
  onProgress?: (progress: CompressionProgress) => void;
}): Promise<{
  uri: string;
  bytes: number;
  durationMs: number;
  wasCompressed: boolean;
}> => {
  const compressor = loadVideoCompressor();
  if (compressor === null || input.bytes < 5 * 1024 * 1024) {
    return {
      uri: input.uri,
      bytes: input.bytes,
      durationMs: input.durationMs,
      wasCompressed: false,
    };
  }
  const compressedUri = await compressor.compress(
    input.uri,
    { compressionMethod: "auto" },
    (progress: number) => {
      input.onProgress?.({
        percent: clampPercent(progress * 100),
        phase: "compressing",
      });
    },
  );
  return {
    uri: compressedUri,
    bytes: await statFileSize(compressedUri, input.bytes),
    durationMs: input.durationMs,
    wasCompressed: true,
  };
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
  return new EventCoverVideoProcessingError(
    "edge_error",
    fallback,
    edgeMetadata,
  );
};

type EventCoverVideoUploadIntentInput = {
  // ORCH-0989: "event" (default) or "brand". Brand-target jobs carry no eventId.
  target?: "event" | "brand" | "venue" | "venue_draft";
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
        headers: { Authorization: `Bearer ${accessToken}` },
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

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// TUS Upload-Metadata values are base64. filetype/title are ASCII (mime + a job
// UUID), so a tiny pure encoder works on BOTH native (no global btoa) and web.
const toBase64 = (input: string): string => {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 63] : "=";
  }
  return out;
};

export const tusMetadata = (
  metadata: { filetype?: string; title?: string; sha256?: string } | undefined,
): string => {
  const filetype = metadata?.filetype ?? "video/mp4";
  const parts = [`filetype ${toBase64(filetype)}`];
  const title = metadata?.title;
  if (typeof title === "string" && title.length > 0) {
    parts.push(`title ${toBase64(title)}`);
  }
  const sha256 = metadata?.sha256;
  if (typeof sha256 === "string" && sha256.length > 0) {
    parts.push(`sha256 ${toBase64(sha256)}`);
  }
  return parts.join(",");
};

const resolveTusLocation = (base: string, location: string): string => {
  if (/^https?:\/\//i.test(location)) return location;
  try {
    return new URL(location, base).toString();
  } catch {
    return location;
  }
};

const patchTusWithXhr = (input: {
  url: string;
  blob: Blob;
  headers: Record<string, string>;
  onProgress?: (progress: EventCoverVideoUploadProgress) => void;
  signal?: AbortSignal;
}): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = (): void => {
      xhr.abort();
      reject(cancelledUploadError());
    };
    if (input.signal?.aborted) {
      abort();
      return;
    }
    input.signal?.addEventListener("abort", abort, { once: true });
    xhr.upload.onprogress = (event) => {
      emitUploadProgress(input.onProgress, event.loaded, event.total);
    };
    xhr.onerror = () => {
      input.signal?.removeEventListener("abort", abort);
      reject(
        new EventCoverVideoProcessingError(
          "source_upload_failed",
          "Video upload failed before processing. Try again.",
        ),
      );
    };
    xhr.onload = () => {
      input.signal?.removeEventListener("abort", abort);
      if (xhr.status === 200 || xhr.status === 204) {
        resolve();
        return;
      }
      reject(
        new EventCoverVideoProcessingError(
          "source_upload_failed",
          "We couldn't upload this video. Check your connection and resume.",
        ),
      );
    };
    xhr.open("PATCH", input.url);
    Object.entries(input.headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });
    xhr.send(input.blob);
  });

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
    throw new EventCoverVideoProcessingError(
      "source_upload_failed",
      "Video file could not be read.",
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

const EVENT_COVER_TUS_CHUNK_BYTES = 5 * 1024 * 1024;

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
  let webBlob: Blob | null = null;
  if (Platform.OS === "web") {
    // ORCH-1303: read the picked clip's bytes from its browser object URL.
    // A raw fetch() rejection here surfaces an opaque "Failed to fetch"
    // (Constitution #3 non-actionable). Wrap it in an honest, actionable
    // error so the operator knows what to do next. The happy path (a valid
    // `blob:` uri) is unchanged.
    try {
      const blobResponse = await fetch(input.uri);
      webBlob = await blobResponse.blob();
    } catch {
      throw new EventCoverVideoProcessingError(
        "source_upload_failed",
        "Could not read the selected video in your browser. Try a shorter MP4, or upload the cover from the Mingla Host app.",
      );
    }
    if (bytes <= 0) bytes = webBlob.size;
  } else if (bytes <= 0) {
    bytes = await statFileSize(input.uri, 0);
  }
  if (bytes <= 0) {
    throw new EventCoverVideoProcessingError(
      "source_upload_failed",
      "Video file was empty.",
    );
  }

  let offset = await headTusOffset(input.upload, input.signal);
  if (offset > bytes) throw new EventCoverVideoProcessingError("transport_integrity_failed", "We couldn't resume this upload. Choose the original video again.");
  while (offset < bytes) {
    const chunkLength = Math.min(EVENT_COVER_TUS_CHUNK_BYTES, bytes - offset);
    const patchHeaders = {
      ...input.upload.fields,
      "Content-Type": "application/offset+octet-stream",
      "Content-Length": String(chunkLength),
      "Tus-Resumable": "1.0.0",
      "Upload-Offset": String(offset),
    };
    if (Platform.OS === "web") {
      await patchTusWithXhr({
        blob: (webBlob as Blob).slice(offset, offset + chunkLength),
        headers: patchHeaders,
        onProgress: (progress) => emitUploadProgress(input.onProgress, offset + progress.bytesSent, bytes),
        signal: input.signal,
        url: input.upload.url,
      });
    } else {
      await patchTusNative({ headers: patchHeaders, onProgress: undefined, signal: input.signal, uri: input.uri, url: input.upload.url });
    }
    const serverOffset = await headTusOffset(input.upload, input.signal);
    if (serverOffset <= offset || serverOffset > bytes) {
      throw new EventCoverVideoProcessingError("transport_integrity_failed", "We couldn't resume this upload. Choose the original video again.");
    }
    offset = serverOffset;
    emitUploadProgress(input.onProgress, offset, bytes);
  }
  emitUploadProgress(input.onProgress, 1, 1);
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
    { body: { jobId }, signal },
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
  target: "event" | "brand" | "venue" | "venue_draft"; eventId?: string; brandId: string; venueId?: string; draftOwnerKey?: string; signal?: AbortSignal;
}): Promise<EventCoverVideoStatus | null> => {
  const { signal, ...body } = input;
  const { data, error } = await supabase.functions.invoke<StatusResponse>("event-cover-video-status", { body, signal });
  if (error) {
    const mapped = await edgeError(error, "Could not restore video processing status.");
    if (mapped.code === "not_found") return null;
    throw mapped;
  }
  if (data?.error === "not_found") return null;
  if (data?.error) throw processingErrorFromPayload(data, "Could not restore video processing status.");
  return data ? mapStatusResponse(data, "event-cover-video-status") : null;
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
    targetKind: payload.targetKind === "brand" || payload.targetKind === "venue" || payload.targetKind === "venue_draft"
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
  };
};

export const acknowledgeEventCoverVideoSourceUploaded = async (input: {
  // ORCH-0989: "event" (default) or "brand". Brand-target carries no eventId.
  target?: "event" | "brand" | "venue" | "venue_draft";
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
    { body: { jobId, expectedVersion, expectedProcessedUrl } },
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
    { body: { jobId } },
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
