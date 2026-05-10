import { supabase } from "./supabase";
import { BusinessAuthNotReadyError } from "../utils/authReadiness";

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

  constructor(code: string, message: string) {
    super(message);
    this.name = "EventCoverVideoProcessingError";
    this.code = code;
  }
}

const throwMalformed = (label: string): never => {
  throw new EventCoverVideoProcessingError(
    "malformed_response",
    `${label} returned an unexpected response.`,
  );
};

const processingErrorFromPayload = (
  payload: EdgeErrorPayload | null,
  fallback: string,
): EventCoverVideoProcessingError | BusinessAuthNotReadyError => {
  if (payload?.error === "unauthenticated") {
    return new BusinessAuthNotReadyError(
      "unauthenticated",
      "Finishing sign-in. Try again in a moment.",
    );
  }
  if (payload?.error === "provider_not_configured") {
    return new EventCoverVideoProcessingError(
      "provider_not_configured",
      payload.detail ?? EVENT_COVER_VIDEO_NOT_CONFIGURED_COPY,
    );
  }
  if (payload?.error === "validation_error") {
    return new EventCoverVideoProcessingError(
      "validation_error",
      validationDetailMessage(payload.detail),
    );
  }
  if (payload?.error === "forbidden") {
    return new EventCoverVideoProcessingError(
      "forbidden",
      "You do not have permission to update this event cover.",
    );
  }
  if (payload?.error === "not_found") {
    return new EventCoverVideoProcessingError(
      "not_found",
      "This video cover job could not be found.",
    );
  }
  if (payload?.error === "job_not_ready") {
    return new EventCoverVideoProcessingError(
      "job_not_ready",
      "Video is still processing. Try again in a moment.",
    );
  }
  if (typeof payload?.error === "string") {
    return new EventCoverVideoProcessingError(
      payload.error,
      payload.detail ?? fallback,
    );
  }
  return new EventCoverVideoProcessingError("edge_error", fallback);
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

const edgeError = async (
  error: unknown,
  fallback: string,
): Promise<EventCoverVideoProcessingError | BusinessAuthNotReadyError> => {
  const maybe = error as {
    message?: string;
    context?: { status?: number; json?: () => Promise<unknown> };
  };
  if (maybe?.context?.status === 401) {
    devWarn("edge-error-auth", {
      fallback,
      message: maybe.message,
      status: maybe.context.status,
    });
    return new BusinessAuthNotReadyError(
      "unauthenticated",
      "Finishing sign-in. Try again in a moment.",
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
        );
      }
    } catch {
      // Keep the edge message fallback when the function body is unavailable.
    }
  }
  return new EventCoverVideoProcessingError("edge_error", maybe?.message ?? fallback);
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
    throw await edgeError(error, "Could not prepare video upload.");
  }
  if (data?.error !== undefined) {
    devWarn("upload-intent-rejected", {
      detail: data.detail,
      error: data.error,
      requestId,
    });
    throw processingErrorFromPayload(data, "Could not prepare video upload.");
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
    throwMalformed("event-cover-video-upload-intent");
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
}): Promise<void> => {
  const formData = new FormData();
  Object.entries(input.upload.fields).forEach(([key, value]) => {
    if (key !== "resource_type") formData.append(key, value);
  });
  formData.append("file", {
    name: input.fileName ?? "event-cover.mov",
    type: input.mimeType ?? "video/quicktime",
    uri: input.uri,
  } as unknown as Blob);

  const response = await fetch(input.upload.url, {
    body: formData,
    method: "POST",
  });
  if (!response.ok) {
    let detail = `Cloud upload failed (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body?.error?.message === "string") detail = body.error.message;
    } catch {
      // Keep status detail when provider body is not JSON.
    }
    devWarn("source-upload-failed", {
      detail,
      status: response.status,
    });
    throw new EventCoverVideoProcessingError("source_upload_failed", detail);
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
