import { supabase } from "./supabase";
import { BusinessAuthNotReadyError } from "../utils/authReadiness";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

declare const require: (moduleName: string) => {
  Video?: {
    compress: (
      uri: string,
      options: unknown,
      onProgress?: (progress: number) => void,
    ) => Promise<string>;
  };
};

export const EVENT_COVER_FINAL_MAX_BYTES = 25 * 1024 * 1024;
export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000;
export const EVENT_COVER_MAX_SOURCE_VIDEO_BYTES = 100 * 1024 * 1024;
export const EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS = 60_000;
export const EVENT_COVER_VIDEO_PROCESSING_COPY =
  "Use your phone's trim screen to keep video covers to 29 seconds. Mingla compresses the cover to a browser-safe MP4 under 25 MB.";
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
  | "applied";

interface UploadIntentResponse {
  jobId?: string;
  provider?: "cloudinary";
  upload?: {
    url?: string;
    fields?: Record<string, string>;
  };
  error?: string;
  detail?: string;
}

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
  | { phase: "compressing"; percent: number }
  | { phase: "uploading"; percent: number }
  | { phase: "processing"; percent: number }
  | { phase: "ready"; percent: 100 }
  | { phase: "error"; percent: 0; code: string; message: string };

export type CompressionProgress = { phase: "compressing"; percent: number };

export interface EventCoverVideoStatus {
  jobId: string;
  eventId: string;
  brandId: string;
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
  processedBytes: number | null;
  processedDurationMs: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  sourceUploadedAt: string | null;
  appliedAt: string | null;
  cancelledAt: string | null;
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
  timeoutMs?: number;
  pollIntervalMs?: number;
  onStatus?: (status: EventCoverVideoStatus) => void;
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
      payload.detail ?? fallback,
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
      return "Video duration metadata was missing or out of range. Try another 30-second clip.";
    case "trim_invalid":
    case "trim_out_of_range":
    case "trim_over_duration":
      return "Native trim did not return a valid 30-second clip. Trim again and retry.";
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

const cloudinaryUploadFailureDetail = (body: unknown, status: number): string => {
  if (
    body !== null &&
    typeof body === "object" &&
    typeof (body as { error?: { message?: unknown } }).error?.message === "string"
  ) {
    return (body as { error: { message: string } }).error.message;
  }
  return `Cloud upload failed (${status}).`;
};

const sanitizeProviderUploadResponse = (
  body: unknown,
): EventCoverVideoProviderUploadResponse | null => {
  if (body === null || typeof body !== "object") return null;
  const payload = body as Record<string, unknown>;
  return {
    asset_id: typeof payload.asset_id === "string" ? payload.asset_id : undefined,
    bytes: typeof payload.bytes === "number" ? payload.bytes : undefined,
    duration: typeof payload.duration === "number" ? payload.duration : undefined,
    format: typeof payload.format === "string" ? payload.format : undefined,
    public_id: typeof payload.public_id === "string" ? payload.public_id : undefined,
    resource_type:
      typeof payload.resource_type === "string" ? payload.resource_type : undefined,
  };
};

const statFileSize = async (
  uri: string,
  fallbackBytes: number,
): Promise<number> => {
  try {
    const info = await FileSystem.getInfoAsync(uri);
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

const uploadEventCoverVideoSourceWithXhr = async (input: {
  upload: { url: string; fields: Record<string, string> };
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  onProgress?: (progress: EventCoverVideoUploadProgress) => void;
  signal?: AbortSignal;
}): Promise<EventCoverVideoProviderUploadResponse | null> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = (): void => {
      xhr.abort();
      reject(
        new EventCoverVideoProcessingError(
          "source_upload_cancelled",
          "Video upload was cancelled.",
        ),
      );
    };
    if (input.signal?.aborted) {
      abort();
      return;
    }
    input.signal?.addEventListener("abort", abort, { once: true });
    const formData = new FormData();
    Object.entries(input.upload.fields).forEach(([key, value]) => {
      if (key !== "resource_type") formData.append(key, value);
    });
    formData.append("file", {
      name: input.fileName ?? "event-cover.mov",
      type: input.mimeType ?? "video/quicktime",
      uri: input.uri,
    } as unknown as Blob);

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
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Keep status detail when provider body is not JSON.
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        emitUploadProgress(input.onProgress, 1, 1);
        resolve(sanitizeProviderUploadResponse(body));
        return;
      }
      const detail = cloudinaryUploadFailureDetail(body, xhr.status);
      devWarn("source-upload-failed", {
        detail,
        status: xhr.status,
      });
      reject(new EventCoverVideoProcessingError("source_upload_failed", detail));
    };
    xhr.open("POST", input.upload.url);
    xhr.send(formData);
  });

const uploadEventCoverVideoSourceInChunks = async (input: {
  upload: { url: string; fields: Record<string, string> };
  uri: string;
  bytes: number;
  jobId: string;
  fileName?: string | null;
  mimeType?: string | null;
  onProgress?: (progress: EventCoverVideoUploadProgress) => void;
  signal?: AbortSignal;
}): Promise<EventCoverVideoProviderUploadResponse | null> => {
  const response = await fetch(input.uri);
  const file = await response.blob();
  const totalBytes = input.bytes > 0 ? input.bytes : file.size;
  const chunkSize = 10 * 1024 * 1024;
  let lastResponse: EventCoverVideoProviderUploadResponse | null = null;

  for (let start = 0; start < totalBytes; start += chunkSize) {
    if (input.signal?.aborted) {
      throw new EventCoverVideoProcessingError(
        "source_upload_cancelled",
        "Video upload was cancelled.",
      );
    }
    const end = Math.min(start + chunkSize, totalBytes) - 1;
    const chunk = file.slice(start, end + 1, input.mimeType ?? file.type);
    const formData = new FormData();
    Object.entries(input.upload.fields).forEach(([key, value]) => {
      if (key !== "resource_type") formData.append(key, value);
    });
    formData.append("file", chunk, input.fileName ?? "event-cover.mp4");
    // Cloudinary chunked upload headers:
    // https://support.cloudinary.com/hc/en-us/articles/208263735-Guidelines-for-implementing-chunked-upload-to-Cloudinary
    const chunkResponse = await fetch(input.upload.url, {
      body: formData,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${totalBytes}`,
        "X-Unique-Upload-Id": input.jobId,
      },
      method: "POST",
      signal: input.signal,
    });
    const body = await chunkResponse.json().catch(() => null);
    if (!chunkResponse.ok) {
      const detail = cloudinaryUploadFailureDetail(body, chunkResponse.status);
      throw new EventCoverVideoProcessingError("source_upload_failed", detail);
    }
    lastResponse = sanitizeProviderUploadResponse(body);
    emitUploadProgress(input.onProgress, end + 1, totalBytes);
  }

  return lastResponse;
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
    maybe?.message ?? fallback,
    edgeMetadata,
  );
};

export const createEventCoverVideoUploadIntent = async (input: {
  eventId: string;
  brandId: string;
  applyMode: EventCoverVideoApplyMode;
  sourceFileName?: string | null;
  sourceMimeType?: string | null;
  sourceBytes: number;
  sourceDurationMs: number;
  trimStartMs?: number;
  trimEndMs?: number;
}): Promise<{ jobId: string; upload: { url: string; fields: Record<string, string> } }> => {
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
    sourceFileName: input.sourceFileName,
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
      eventId: input.eventId,
      phase: "upload_intent",
      timestamp: new Date().toISOString(),
    });
    throw caught;
  }
  if (error) {
    devWarn("upload-intent-edge-error", {
      applyMode: input.applyMode,
      brandId: input.brandId,
      eventId: input.eventId,
      requestId,
    });
    const preparedError = await edgeError(error, "Could not prepare video upload.", {
      phase: "upload_intent",
      requestId,
    });
    logEventCoverVideoUploadTelemetry("video_cover_upload_intent_failed", {
      applyMode: input.applyMode,
      errorCode: errorCodeOf(preparedError, "edge_error"),
      eventId: input.eventId,
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
      eventId: input.eventId,
      phase: "upload_intent",
      timestamp: new Date().toISOString(),
    });
    throw preparedError;
  }
  const jobId = data?.jobId;
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
    },
  };
};

export const uploadEventCoverVideoSource = async (input: {
  upload: { url: string; fields: Record<string, string> };
  uri: string;
  bytes?: number;
  jobId?: string;
  fileName?: string | null;
  mimeType?: string | null;
  onProgress?: (progress: EventCoverVideoUploadProgress) => void;
  signal?: AbortSignal;
}): Promise<EventCoverVideoProviderUploadResponse | null> => {
  if (
    Platform.OS === "web" &&
    typeof input.bytes === "number" &&
    input.bytes > 50 * 1024 * 1024 &&
    typeof input.jobId === "string"
  ) {
    return await uploadEventCoverVideoSourceInChunks({
      ...input,
      bytes: input.bytes,
      jobId: input.jobId,
    });
  }
  const parameters = Object.fromEntries(
    Object.entries(input.upload.fields).filter(([key]) => key !== "resource_type"),
  );
  let task:
    | { uploadAsync: () => Promise<unknown>; cancelAsync?: () => Promise<void> }
    | null = null;
  const abort = (): void => {
    void task?.cancelAsync?.();
  };
  try {
    if (input.signal?.aborted) {
      throw new EventCoverVideoProcessingError(
        "source_upload_cancelled",
        "Video upload was cancelled.",
      );
    }
    input.signal?.addEventListener("abort", abort, { once: true });
    task = FileSystem.createUploadTask(
      input.upload.url,
      input.uri,
      {
        fieldName: "file",
        httpMethod: "POST",
        mimeType: input.mimeType ?? "video/quicktime",
        parameters,
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      },
      (event) => {
        emitUploadProgress(
          input.onProgress,
          event.totalBytesSent,
          event.totalBytesExpectedToSend,
        );
      },
    );
    const result = await task.uploadAsync() as
      | { body: string; status: number }
      | null
      | undefined;
    input.signal?.removeEventListener("abort", abort);
    if (input.signal?.aborted) {
      throw new EventCoverVideoProcessingError(
        "source_upload_cancelled",
        "Video upload was cancelled.",
      );
    }
    if (result === null || result === undefined) {
      throw new EventCoverVideoProcessingError(
        "source_upload_failed",
        "Cloud upload did not return a response.",
      );
    }
    if (result.status < 200 || result.status >= 300) {
      let body: unknown = null;
      try {
        body = JSON.parse(result.body);
      } catch {
        // Keep status detail when provider body is not JSON.
      }
      const detail = cloudinaryUploadFailureDetail(body, result.status);
      devWarn("source-upload-failed", {
        detail,
        status: result.status,
      });
      throw new EventCoverVideoProcessingError("source_upload_failed", detail);
    }
    emitUploadProgress(input.onProgress, 1, 1);
    try {
      return sanitizeProviderUploadResponse(JSON.parse(result.body));
    } catch {
      return null;
    }
  } catch (error) {
    input.signal?.removeEventListener("abort", abort);
    if (error instanceof EventCoverVideoProcessingError) throw error;
    if (input.signal?.aborted) {
      throw new EventCoverVideoProcessingError(
        "source_upload_cancelled",
        "Video upload was cancelled.",
      );
    }
    devWarn("source-upload-task-failed", {
      message: error instanceof Error ? error.message : String(error),
      fallback: "xhr",
    });
    return await uploadEventCoverVideoSourceWithXhr(input);
  }
};

export const fetchEventCoverVideoStatus = async (
  jobId: string,
): Promise<EventCoverVideoStatus> => {
  const { data, error } = await supabase.functions.invoke<StatusResponse>(
    "event-cover-video-status",
    { body: { jobId } },
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

const mapStatusResponse = (
  payload: StatusResponse,
  label: string,
): EventCoverVideoStatus => {
  const responseJobId = payload.jobId;
  const statusValue = payload.status;
  if (typeof responseJobId !== "string" || typeof statusValue !== "string") {
    throwMalformed(label);
  }
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
    eventId: typeof payload.eventId === "string" ? payload.eventId : "",
    failureCode: payload.failureCode ?? null,
    failureMessage: payload.failureMessage ?? null,
    isTerminal: Boolean(payload.isTerminal),
    jobId: responseJobId as string,
    processedBytes: typeof payload.processedBytes === "number" ? payload.processedBytes : null,
    processedDurationMs:
      typeof payload.processedDurationMs === "number" ? payload.processedDurationMs : null,
    processedMimeType: payload.processedMimeType ?? null,
    processedUrl: payload.processedUrl ?? null,
    progressKind: payload.progressKind ?? "indeterminate",
    progressPercent:
      typeof payload.progressPercent === "number" ? payload.progressPercent : null,
    sourceUploadedAt: payload.sourceUploadedAt ?? null,
    stageLabel,
    status,
    updatedAt: payload.updatedAt ?? null,
  };
};

export const acknowledgeEventCoverVideoSourceUploaded = async (input: {
  jobId: string;
  eventId: string;
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

export const applyEventCoverVideoJob = async (jobId: string): Promise<string> => {
  const { data, error } = await supabase.functions.invoke<{ processedUrl?: string }>(
    "event-cover-video-apply",
    { body: { jobId } },
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
  const timeoutMs = typeof options === "number" ? options : options.timeoutMs ?? 120_000;
  const pollIntervalMs =
    typeof options === "number" ? 1500 : options.pollIntervalMs ?? 1500;
  const onStatus = typeof options === "number" ? undefined : options.onStatus;
  const startedAt = Date.now();
  let lastStatus: EventCoverVideoStatus | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    const status = await fetchEventCoverVideoStatus(jobId);
    lastStatus = status;
    onStatus?.(status);
    if (status.status === "ready" || status.status === "applied") {
      logEventCoverVideoUploadTelemetry("video_cover_upload_ready", {
        applyMode: status.applyMode,
        eventId: status.eventId,
        jobId: status.jobId,
        phase: "status",
        timestamp: new Date().toISOString(),
      });
      return status;
    }
    if (status.status === "failed" || status.status === "cancelled") {
      throw new EventCoverVideoProcessingError(
        status.failureCode ?? status.status,
        status.failureMessage ?? "Video processing failed.",
        { lastStatus: status, phase: "status" },
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new EventCoverVideoProcessingError(
    "processing_timeout",
    "Your video is still processing. You can check again in a moment.",
    { lastStatus, phase: "status" },
  );
};
