/**
 * ORCH-1119 [trip-day-media-gallery] · SPEC §4.3a
 *
 * tripDayMediaService — upload a single trip-day media item. Images keep the
 * brand/event-keyed `event_covers` Storage path; videos use the same resumable
 * Bunny/TUS job lane as Host cover and ad-source videos. This preserves the
 * ordered many-item trip_days.media model without writing a cover column.
 *
 * Image uploads are modeled on experienceStopImageService.ts (F-8):
 *   - writes image MIME types to `event_covers` (30 MB bucket cap),
 *   - keys 2-segment `{brandId}/{eventId}/trip-day-media/{token}.{ext}` so the
 *     event_covers RLS (foldername[1]=brand_id, foldername[2]=event.id, caller
 *     rank >= event_manager) gates the write,
 *   - returns a typed `{url, type:"image"|"video", ...}` instead of a bare URL
 *     (the renderer NEVER auto-detects — every item carries an explicit type,
 *     ORCH-1069/0978 rule).
 *
 * Video uploads use target `trip_day_media`: the pipeline processes and returns
 * a reusable MP4 URL, while its apply receipt deliberately performs no cover
 * mutation. The 25 MB item cap remains; the shared one-minute video contract
 * now applies consistently to trip-day video too.
 *
 * Trips-only + per-day-only. NOT shared with experiences/events (locked scope).
 *
 * Throws BrandCoverError (reused) with user-facing copy on every failure
 * (Constitution #3 — no silent failure).
 */

import { supabase } from "./supabase";
import { readBrandCoverFileBytes } from "./brandCoverFileReader";
import type { EventCoverVideoStatus } from "./eventCoverVideoProcessingService";
import {
  BrandCoverError,
  generateBrandCoverPathToken,
  verifyBrandCoverPublicUrl,
} from "../utils/brandCoverRules";
import type { TripDayMedia } from "./tripsService";

export const TRIP_DAY_MEDIA_BUCKET = "event_covers";

/** Per-day gallery cap (SPEC §10 OQ-1). */
export const MAX_TRIP_DAY_MEDIA = 8;

/** 25 MB per item (SPEC §10 OQ-2) — under the event_covers 30 MB bucket limit,
 *  leaving upload headroom. Images are tiny; videos are the constraint. */
export const TRIP_DAY_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

const GENERIC_MIME_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
]);

export interface TripDayMediaAssetInput {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}

export type TripDayVideoUploadProgress = {
  phase: "uploading" | "confirming" | "processing";
  percent: number | null;
};

const cleanMime = (mime?: string | null): string =>
  typeof mime === "string" ? mime.trim().toLowerCase() : "";

const fileExtension = (value?: string | null): string => {
  if (typeof value !== "string") return "";
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
  const match = /\.([a-z0-9]+)$/i.exec(withoutQuery);
  return match?.[1]?.toLowerCase() ?? "";
};

/**
 * Resolve a supported content-type from the asset's metadata + filename/URI
 * extension. Returns the normalized MIME (one of the event_covers allowlist) or
 * null when unsupported. `image/jpg` is normalized to `image/jpeg`.
 */
export const resolveTripDayMediaContentType = (
  input: TripDayMediaAssetInput,
): string | null => {
  const mime = cleanMime(input.mimeType);
  if (mime.length > 0 && !GENERIC_MIME_TYPES.has(mime)) {
    const normalized = mime === "image/jpg" ? "image/jpeg" : mime;
    if (normalized in EXT_BY_MIME) return normalized;
    // An explicit but unsupported MIME (e.g. text/plain) is a hard reject — do
    // NOT fall back to the extension, or a .txt renamed .mp4 would slip through.
    return null;
  }
  // No usable MIME — derive from extension.
  const fileExt = fileExtension(input.fileName);
  const uriExt = fileExtension(input.uri);
  const ext = fileExt.length > 0 ? fileExt : uriExt;
  return IMAGE_MIME_BY_EXT[ext] ?? VIDEO_MIME_BY_EXT[ext] ?? null;
};

const isVideoMime = (mime: string): boolean => mime.startsWith("video/");

const newOperationId = (): string => {
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const acknowledgeTripDayVideo = async (input: {
  jobId: string;
  eventId: string;
  brandId: string;
  processing: typeof import("./eventCoverVideoAuthoringRuntime");
}): Promise<EventCoverVideoStatus> => {
  const {
    acknowledgeEventCoverVideoSourceUploaded,
    EventCoverVideoProcessingError,
  } = input.processing;
  const deadlineAt = Date.now() + 150_000;
  let status = await acknowledgeEventCoverVideoSourceUploaded({
    target: "trip_day_media",
    jobId: input.jobId,
    eventId: input.eventId,
    brandId: input.brandId,
  });
  while (status.status === "source_uploading") {
    if (Date.now() >= deadlineAt) {
      throw new EventCoverVideoProcessingError(
        "source_ack_timeout",
        "We couldn't confirm this video upload. Try again.",
        { lastStatus: status, phase: "source_uploaded" },
      );
    }
    await wait(2_000);
    status = await acknowledgeEventCoverVideoSourceUploaded({
      target: "trip_day_media",
      jobId: input.jobId,
      eventId: input.eventId,
      brandId: input.brandId,
    });
  }
  return status;
};

const uploadTripDayVideo = async (
  brandId: string,
  eventId: string,
  input: TripDayMediaAssetInput,
  contentType: string,
  byteLength: number,
  onProgress?: (progress: TripDayVideoUploadProgress) => void,
): Promise<TripDayMedia> => {
  // Keep the substantial TUS/provider implementation out of the shared eager
  // app chunk. Images never need it; video selection loads it on demand.
  const processing = await import("./eventCoverVideoAuthoringRuntime");
  const {
    applyEventCoverVideoJob,
    createEventCoverVideoUploadIntent,
    EVENT_COVER_MAX_VIDEO_DURATION_MS,
    EventCoverVideoProcessingError,
    uploadEventCoverVideoSource,
    waitForEventCoverVideoReady,
  } = processing;
  const { deletePreparedEventCoverVideoSource, prepareEventCoverVideoSource } =
    processing;
  const durationMs = Math.round(Number(input.durationMs ?? 0));
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new EventCoverVideoProcessingError(
      "video_duration_unknown",
      "We couldn't read that video's duration. Choose it again.",
    );
  }
  if (durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS) {
    throw new EventCoverVideoProcessingError(
      "video_duration_over_cap",
      "Choose a video that is one minute or shorter.",
    );
  }

  const operationId = newOperationId();
  const extension = EXT_BY_MIME[contentType] as "mp4" | "mov" | "webm";
  const fileName = input.fileName?.trim() ||
    `trip-day-${operationId}.${extension}`;
  const prepared = await prepareEventCoverVideoSource({
    uri: input.uri,
    bytes: byteLength,
    durationMs,
    fileName,
    mimeType: contentType,
    operationId,
  });

  try {
    const intent = await createEventCoverVideoUploadIntent({
      target: "trip_day_media",
      eventId,
      brandId,
      applyMode: "published_manual",
      clientOperationId: operationId,
      sourceFileName: prepared.fileName,
      sourceMimeType: prepared.mimeType,
      sourceExtension: prepared.extension,
      sourceSha256: prepared.sha256,
      sourceBytes: prepared.bytes,
      sourceDurationMs: prepared.durationMs,
      trimStartMs: 0,
      trimEndMs: prepared.durationMs,
    });

    let status: EventCoverVideoStatus;
    if ("upload" in intent) {
      onProgress?.({ phase: "uploading", percent: 0 });
      await uploadEventCoverVideoSource({
        upload: intent.upload,
        uri: prepared.uri,
        bytes: prepared.bytes,
        jobId: intent.jobId,
        fileName: prepared.fileName,
        mimeType: prepared.mimeType,
        onProgress: (progress) =>
          onProgress?.({ phase: "uploading", percent: progress.percent }),
      });
      onProgress?.({ phase: "confirming", percent: null });
      status = await acknowledgeTripDayVideo({
        jobId: intent.jobId,
        eventId,
        brandId,
        processing,
      });
    } else {
      status = intent.status;
    }

    if (!["ready", "applied"].includes(status.status)) {
      onProgress?.({
        phase: "processing",
        percent: status.progressPercent,
      });
      status = await waitForEventCoverVideoReady(intent.jobId, {
        onStatus: (next) =>
          onProgress?.({
            phase: "processing",
            percent: next.progressPercent,
          }),
      });
    }
    if (!status.processedUrl) {
      throw new EventCoverVideoProcessingError(
        "processed_video_missing",
        "The video finished processing without a playable copy. Try again.",
      );
    }
    if (status.status !== "applied") {
      await applyEventCoverVideoJob(
        status.jobId,
        status.applicationVersion,
        status.processedUrl,
      );
    }
    return {
      url: status.processedUrl,
      type: "video",
      provider: "bunny",
    };
  } finally {
    await deletePreparedEventCoverVideoSource(prepared.uri).catch(() => {});
  }
};

/**
 * Upload a single trip-day media item. Returns the verified public URL + an
 * explicit `type`. Throws BrandCoverError with user-facing copy on any failure.
 */
export const uploadTripDayMedia = async (
  brandId: string,
  eventId: string,
  input: TripDayMediaAssetInput,
  onVideoProgress?: (progress: TripDayVideoUploadProgress) => void,
): Promise<TripDayMedia> => {
  const contentType = resolveTripDayMediaContentType(input);
  if (contentType === null) {
    throw new BrandCoverError(
      "unsupported_type",
      "Choose a JPEG, PNG, WebP, GIF, MP4, MOV, or WebM.",
    );
  }

  // Pre-read size guard (metadata) — surfaces a friendly reject before reading
  // 25 MB of bytes through the JS thread.
  if (
    typeof input.fileSize === "number" &&
    input.fileSize > TRIP_DAY_MEDIA_MAX_BYTES
  ) {
    throw new BrandCoverError(
      "file_too_large",
      "That file is too large — pick one under 25 MB.",
    );
  }

  const { bytes, byteLength } = await readBrandCoverFileBytes(input.uri);
  if (byteLength <= 0) {
    throw new BrandCoverError(
      "empty_local_file",
      "We couldn't read that file. Try another.",
    );
  }
  if (byteLength > TRIP_DAY_MEDIA_MAX_BYTES) {
    throw new BrandCoverError(
      "file_too_large",
      "That file is too large — pick one under 25 MB.",
    );
  }

  if (isVideoMime(contentType)) {
    return await uploadTripDayVideo(
      brandId,
      eventId,
      input,
      contentType,
      byteLength,
      onVideoProgress,
    );
  }

  const token = generateBrandCoverPathToken();
  const ext = EXT_BY_MIME[contentType] ?? "bin";
  const storagePath = `${brandId}/${eventId}/trip-day-media/${token}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(TRIP_DAY_MEDIA_BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: true });

  if (uploadError !== null) {
    throw new BrandCoverError(
      "upload_failed",
      "Couldn't upload that file. Tap to retry.",
    );
  }

  const { data } = supabase.storage
    .from(TRIP_DAY_MEDIA_BUCKET)
    .getPublicUrl(storagePath);

  await verifyBrandCoverPublicUrl(data.publicUrl);

  return {
    url: data.publicUrl,
    type: isVideoMime(contentType) ? "video" : "image",
    provider: "library",
    ...(typeof input.width === "number" ? { width: input.width } : {}),
    ...(typeof input.height === "number" ? { height: input.height } : {}),
  };
};
