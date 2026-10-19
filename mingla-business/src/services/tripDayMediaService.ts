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
 * mutation.
 *
 * #3040 B-C12 [A-12] — trip-day video now follows the SAME lane contract as a
 * cover: up to one minute and under 100 MB, compressed on the phone first (a
 * normal 1-minute phone clip used to be refused at 25 MB before compression
 * was even tried), read once by prepare (never pulled through JS twice),
 * resumable (the operation is remembered by the file's hash, so choosing the
 * same file again continues it), and watched for a bounded time. Images keep
 * their 25 MB cap (`TRIP_DAY_MEDIA_IMAGE_MAX_BYTES`).
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

/** 25 MB per IMAGE (SPEC §10 OQ-2) — under the event_covers 30 MB bucket limit,
 *  leaving upload headroom. #3040 — videos follow the lane's 100 MB contract. */
export const TRIP_DAY_MEDIA_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
/** #3040 B-C12 — the lane's source cap (post-compression on native, raw on web). */
export const TRIP_DAY_MEDIA_VIDEO_MAX_BYTES = 104_857_600;
/** #3040 B-C12 — how long the sheet watches a trip-day video before it stops. */
export const TRIP_DAY_VIDEO_WATCH_DEADLINE_MS = 660_000;

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
  phase: "checking" | "uploading" | "confirming" | "processing";
  percent: number | null;
};

/** #3040 B-C12 — the lane's error codes in host words; never a raw code. */
const TRIP_DAY_VIDEO_COPY: Record<string, string> = {
  video_source_type_unknown: "That video couldn't be used. Use MP4, MOV, M4V or WebM under 100 MB.",
  video_source_type_unsupported: "That video couldn't be used. Use MP4, MOV, M4V or WebM under 100 MB.",
  video_source_size_changed: "That video changed while it was being read. Choose it again.",
  video_source_unreadable: "We couldn't read that video. Choose it again.",
  video_storage_unavailable: "Your phone is out of space for this video. Free some space and try again.",
  video_source_too_large: "That video is over 100 MB. Try a shorter clip.",
  video_file_too_large: "That video is over 100 MB, even after shrinking it. Try a shorter clip.",
  video_compression_failed: "Your phone couldn't prepare that video. Try a shorter clip.",
  video_compression_stalled: "Your phone couldn't prepare that video. Try a shorter clip.",
  client_version_required: "Update Mingla Host to upload videos.",
  video_watch_deadline: "That video is still being prepared. Add it again in a few minutes — it won't upload twice.",
};

/**
 * #3040 B-C12 — the toast for a failed trip-day video. A lane error already
 * carries a host sentence; a bare code (`video_source_type_unknown`) or a
 * snake_case message never reaches the screen.
 */
export const tripDayVideoErrorCopy = (error: unknown): string => {
  const code = error !== null && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
  const message = error instanceof Error ? error.message : "";
  const mapped = (code !== null ? TRIP_DAY_VIDEO_COPY[code] : undefined) ?? TRIP_DAY_VIDEO_COPY[message];
  if (mapped !== undefined) return mapped;
  if (message.length > 0 && !/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(message)) return message;
  return "Couldn't upload that video. Try again.";
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
  options: TripDayMediaUploadOptions = {},
): Promise<TripDayMedia> => {
  // Keep the substantial TUS/provider implementation out of the shared eager
  // app chunk. Images never need it; video selection loads it on demand.
  const processing = await import("./eventCoverVideoAuthoringRuntime");
  const {
    applyEventCoverVideoJob,
    compressVideoLocally,
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

  onProgress?.({ phase: "checking", percent: null });
  // #3040 B-C12 — shrink on the phone first (native; a no-op on web), exactly
  // like a cover; the 100 MB cap applies to what is actually uploaded.
  const compressed = await compressVideoLocally({
    uri: input.uri,
    bytes: byteLength,
    durationMs,
    maxUncompressedBytes: TRIP_DAY_MEDIA_VIDEO_MAX_BYTES,
  });
  if (compressed.bytes > TRIP_DAY_MEDIA_VIDEO_MAX_BYTES) {
    throw new EventCoverVideoProcessingError(
      "video_file_too_large",
      TRIP_DAY_VIDEO_COPY.video_file_too_large,
    );
  }

  const provisionalOperationId = newOperationId();
  const extension = EXT_BY_MIME[contentType] as "mp4" | "mov" | "webm";
  const fileName = compressed.wasCompressed
    ? `trip-day-${provisionalOperationId}.mp4`
    : input.fileName?.trim() || `trip-day-${provisionalOperationId}.${extension}`;
  const prepared = await prepareEventCoverVideoSource({
    uri: compressed.uri,
    bytes: compressed.bytes,
    durationMs,
    fileName,
    mimeType: compressed.wasCompressed ? "video/mp4" : contentType,
    operationId: provisionalOperationId,
    ownedTemporary: compressed.wasCompressed,
  });

  // #3040 B-C12 — the same file chosen again continues the SAME operation:
  // the record is keyed by the file's hash, so the intent replays instead of
  // starting a second upload of identical bytes.
  const persistence = await import("./eventCoverVideoJobPersistence");
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id ?? null;
  const persistenceKey = `trip_day_media:${eventId}:${options.dayKey ?? "day"}:${prepared.sha256}`;
  const remembered = userId !== null
    ? await persistence.readPersistedCoverVideoJob(userId, persistenceKey)
    : null;
  const operationId = remembered?.clientOperationId ?? provisionalOperationId;
  const remember = async (jobId: string | null): Promise<void> => {
    if (userId === null) return;
    await persistence.writePersistedCoverVideoJob({
      userId, key: persistenceKey, jobId, clientOperationId: operationId,
      // The prepared copy is deleted after every attempt; resume re-prepares.
      sourceUri: null, sourceFingerprint: prepared.fingerprint,
      sourceBytes: prepared.bytes, sourceDurationMs: prepared.durationMs,
      sourceFileName: prepared.fileName, sourceMimeType: prepared.mimeType,
      sourceExtension: prepared.extension, sourceSha256: prepared.sha256,
      trimStartMs: 0, trimEndMs: prepared.durationMs, sourceAcknowledged: false,
    });
  };
  const forget = async (): Promise<void> => {
    if (userId === null) return;
    await persistence.removePersistedCoverVideoJob(userId, persistenceKey, { preserveSource: true });
  };

  // #3040 B-C12 — never an unbounded wait: an 11-minute watch (the server's
  // stall bound plus one reaper tick), and the sheet's own abort.
  const watch = new AbortController();
  const stopWatching = (): void => watch.abort();
  if (options.signal?.aborted) watch.abort();
  else options.signal?.addEventListener("abort", stopWatching, { once: true });
  let deadlineReached = false;
  const deadline = setTimeout(() => {
    deadlineReached = true;
    watch.abort();
  }, TRIP_DAY_VIDEO_WATCH_DEADLINE_MS);

  try {
    await remember(remembered?.jobId ?? null);
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
    await remember(intent.jobId);

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
        signal: watch.signal,
        onProgress: (progress) =>
          onProgress?.({
            phase: "uploading",
            percent: progress.indeterminate === true && progress.final !== true ? null : progress.percent,
          }),
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
      try {
        status = await waitForEventCoverVideoReady(intent.jobId, {
          signal: watch.signal,
          onStatus: (next) =>
            onProgress?.({
              phase: "processing",
              percent: next.progressPercent,
            }),
        });
      } catch (waitError) {
        if (deadlineReached) {
          // The job keeps going server-side; the record stays, so adding the
          // same file again picks up the finished video without re-uploading.
          throw new EventCoverVideoProcessingError(
            "video_watch_deadline",
            TRIP_DAY_VIDEO_COPY.video_watch_deadline,
          );
        }
        throw waitError;
      }
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
    await forget().catch(() => undefined);
    return {
      url: status.processedUrl,
      type: "video",
      provider: "bunny",
      // #3040 §6 — the day grid's "▶ m:ss" chip: the processed length, else
      // the length the host picked (the lane never changes a clip's length).
      durationMs: typeof status.processedDurationMs === "number" && status.processedDurationMs > 0
        ? Math.round(status.processedDurationMs)
        : prepared.durationMs,
    };
  } catch (error) {
    // A definite failure ends the operation; the next pick starts fresh.
    const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : null;
    const keep = code === "video_watch_deadline" || code === "source_upload_cancelled" ||
      code === "source_upload_failed" || code === "edge_error" || code === "network_offline";
    if (!keep) await forget().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener("abort", stopWatching);
    await deletePreparedEventCoverVideoSource(prepared.uri).catch(() => {});
  }
};

export type TripDayMediaUploadOptions = {
  /** The day this media belongs to; part of the resume key. */
  dayKey?: string;
  /** The sheet's abort (× on a tile): stops the transfer and the watch. */
  signal?: AbortSignal;
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
  options: TripDayMediaUploadOptions = {},
): Promise<TripDayMedia> => {
  const contentType = resolveTripDayMediaContentType(input);
  if (contentType === null) {
    throw new BrandCoverError(
      "unsupported_type",
      "Choose a JPEG, PNG, WebP, GIF, MP4, MOV, or WebM.",
    );
  }

  if (isVideoMime(contentType)) {
    // #3040 B-C12 — a video is NEVER read through JS here: prepare reads the
    // file once (and compression may shrink it first). Its size comes from
    // the picker; the lane's 100 MB cap applies to what is uploaded.
    const videoBytes = typeof input.fileSize === "number" && input.fileSize > 0 ? input.fileSize : 0;
    if (videoBytes <= 0) {
      throw new BrandCoverError(
        "empty_local_file",
        "We couldn't read that video. Choose it again.",
      );
    }
    return await uploadTripDayVideo(
      brandId,
      eventId,
      input,
      contentType,
      videoBytes,
      onVideoProgress,
      options,
    );
  }

  // Pre-read size guard (metadata) — surfaces a friendly reject before reading
  // 25 MB of bytes through the JS thread.
  if (
    typeof input.fileSize === "number" &&
    input.fileSize > TRIP_DAY_MEDIA_IMAGE_MAX_BYTES
  ) {
    throw new BrandCoverError(
      "file_too_large",
      "That photo is too large — pick one under 25 MB.",
    );
  }

  const { bytes, byteLength } = await readBrandCoverFileBytes(input.uri);
  if (byteLength <= 0) {
    throw new BrandCoverError(
      "empty_local_file",
      "We couldn't read that file. Try another.",
    );
  }
  if (byteLength > TRIP_DAY_MEDIA_IMAGE_MAX_BYTES) {
    throw new BrandCoverError(
      "file_too_large",
      "That photo is too large — pick one under 25 MB.",
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
