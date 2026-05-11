import { supabase } from "./supabase";
import { BusinessAuthNotReadyError } from "../utils/authReadiness";
import * as FileSystem from "expo-file-system/legacy";

export const EVENT_COVER_FINAL_MAX_BYTES = 25 * 1024 * 1024;
export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 15_000;
export const EVENT_COVER_MAX_SOURCE_VIDEO_BYTES = 500 * 1024 * 1024;
export const EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS = 5 * 60 * 1000;
export const EVENT_COVER_VIDEO_PROCESSING_COPY =
  "Use your phone's trim screen for videos longer than 15 seconds; Mingla compresses the cover to a browser-safe MP4 under 25 MB.";
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
  | "status"
  | "apply";

interface EventCoverVideoErrorMetadata {
  requestId?: string;
  phase?: EventCoverVideoProcessingPhase;
  edgeStatus?: number;
  edgeError?: string;
  edgeDetail?: string;
}

export interface EventCoverVideoUploadProgress {
  phase: "source_upload";
  bytesSent: number;
  bytesTotal: number;
  percent: number;
}

export interface EventCoverVideoStatus {
  jobId: string;
  status: EventCoverVideoJobStatus;
  applyMode: EventCoverVideoApplyMode;
  processedUrl: string | null;
  processedMimeType: string | null;
  processedBytes: number | null;
  processedDurationMs: number | null;
  failureCode: string | null;
  failureMessage: string | null;
}

interface StatusResponse extends Partial<EventCoverVideoStatus> {
  error?: string;
  detail?: string;
}

export class EventCoverVideoProcessingError extends Error {
  code: string;
  requestId?: string;
  phase?: EventCoverVideoProcessingPhase;
  edgeStatus?: number;
  edgeError?: string;
  edgeDetail?: string;

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
      "Video is still processing. Try again in a moment.",
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
      return "Video file size was missing or over 500 MB. Try another trimmed clip.";
    case "source_duration_out_of_range":
      return "Video duration metadata was missing or out of range. Try another 15-second clip.";
    case "trim_invalid":
    case "trim_out_of_range":
    case "trim_over_duration":
      return "Native trim did not return a valid 15-second clip. Trim again and retry.";
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

const uploadEventCoverVideoSourceWithXhr = async (input: {
  upload: { url: string; fields: Record<string, string> };
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  onProgress?: (progress: EventCoverVideoUploadProgress) => void;
}): Promise<void> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
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
      reject(
        new EventCoverVideoProcessingError(
          "source_upload_failed",
          "Video upload failed before processing. Try again.",
        ),
      );
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        emitUploadProgress(input.onProgress, 1, 1);
        resolve();
        return;
      }
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Keep status detail when provider body is not JSON.
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
  trimStartMs: number;
  trimEndMs: number;
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
  const { data, error } = await supabase.functions.invoke<UploadIntentResponse>(
    "event-cover-video-upload-intent",
    { body: { ...input, clientRequestId: requestId } },
  );
  if (error) {
    devWarn("upload-intent-edge-error", {
      applyMode: input.applyMode,
      brandId: input.brandId,
      eventId: input.eventId,
      requestId,
    });
    throw await edgeError(error, "Could not prepare video upload.", {
      phase: "upload_intent",
      requestId,
    });
  }
  if (data?.error !== undefined) {
    devWarn("upload-intent-rejected", {
      detail: data.detail,
      error: data.error,
      requestId,
    });
    throw processingErrorFromPayload(data, "Could not prepare video upload.", {
      phase: "upload_intent",
      requestId,
    });
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
  fileName?: string | null;
  mimeType?: string | null;
  onProgress?: (progress: EventCoverVideoUploadProgress) => void;
}): Promise<void> => {
  const parameters = Object.fromEntries(
    Object.entries(input.upload.fields).filter(([key]) => key !== "resource_type"),
  );
  try {
    const task = FileSystem.createUploadTask(
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
    const result = await task.uploadAsync();
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
  } catch (error) {
    if (error instanceof EventCoverVideoProcessingError) throw error;
    devWarn("source-upload-task-failed", {
      message: error instanceof Error ? error.message : String(error),
      fallback: "xhr",
    });
    await uploadEventCoverVideoSourceWithXhr(input);
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
  const payload = data as StatusResponse;
  const responseJobId = payload.jobId;
  const statusValue = payload.status;
  if (typeof responseJobId !== "string" || typeof statusValue !== "string") {
    throwMalformed("event-cover-video-status");
  }
  return {
    applyMode: payload.applyMode === "published_manual" ? "published_manual" : "draft_auto",
    failureCode: payload.failureCode ?? null,
    failureMessage: payload.failureMessage ?? null,
    jobId: responseJobId as string,
    processedBytes: typeof payload.processedBytes === "number" ? payload.processedBytes : null,
    processedDurationMs:
      typeof payload.processedDurationMs === "number" ? payload.processedDurationMs : null,
    processedMimeType: payload.processedMimeType ?? null,
    processedUrl: payload.processedUrl ?? null,
    status: statusValue as EventCoverVideoJobStatus,
  };
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

export const waitForEventCoverVideoReady = async (
  jobId: string,
  timeoutMs = 120_000,
): Promise<EventCoverVideoStatus> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await fetchEventCoverVideoStatus(jobId);
    if (status.status === "ready" || status.status === "applied") return status;
    if (status.status === "failed" || status.status === "cancelled") {
      throw new EventCoverVideoProcessingError(
        status.failureCode ?? status.status,
        status.failureMessage ?? "Video processing failed.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new EventCoverVideoProcessingError(
    "processing_timeout",
    "Video is still processing. Try again in a moment.",
  );
};
