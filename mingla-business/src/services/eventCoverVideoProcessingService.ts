import { supabase } from "./supabase";

export const EVENT_COVER_FINAL_MAX_BYTES = 25 * 1024 * 1024;
export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 15_000;
export const EVENT_COVER_MAX_SOURCE_VIDEO_BYTES = 500 * 1024 * 1024;
export const EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS = 5 * 60 * 1000;
export const EVENT_COVER_VIDEO_PROCESSING_COPY =
  "Upload any phone video up to 5 minutes. Trim it to 15 seconds; Mingla compresses the cover to a browser-safe MP4 under 25 MB.";
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

const edgeError = (error: unknown, fallback: string): EventCoverVideoProcessingError => {
  const maybe = error as { message?: string; context?: { json?: () => Promise<unknown> } };
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
  const { data, error } = await supabase.functions.invoke<UploadIntentResponse>(
    "event-cover-video-upload-intent",
    { body: input },
  );
  if (error) throw edgeError(error, "Could not prepare video upload.");
  if (data?.error === "provider_not_configured") {
    throw new EventCoverVideoProcessingError(
      "provider_not_configured",
      data.detail ?? EVENT_COVER_VIDEO_NOT_CONFIGURED_COPY,
    );
  }
  const jobId = data?.jobId;
  const uploadUrl = data?.upload?.url;
  const uploadFields = data?.upload?.fields;
  if (
    typeof jobId !== "string" ||
    typeof uploadUrl !== "string" ||
    uploadFields === undefined
  ) {
    throwMalformed("event-cover-video-upload-intent");
  }
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
  if (error) throw edgeError(error, "Could not check video processing status.");
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
  if (error) throw edgeError(error, "Could not save processed video cover.");
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
