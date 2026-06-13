/**
 * ORCH-1119 [trip-day-media-gallery] · SPEC §4.3a
 *
 * tripDayMediaService — direct device upload of a single trip-day media item
 * (image OR video) to the brand/event-keyed `event_covers` bucket. Modeled on
 * experienceStopImageService.ts (F-8) but:
 *   - writes to `event_covers` (image AND video MIME, 30 MB bucket cap) instead
 *     of the images-only `brand_covers`,
 *   - keys 2-segment `{brandId}/{eventId}/trip-day-media/{token}.{ext}` so the
 *     event_covers RLS (foldername[1]=brand_id, foldername[2]=event.id, caller
 *     rank >= event_manager) gates the write,
 *   - returns a typed `{url, type:"image"|"video", ...}` instead of a bare URL
 *     (the renderer NEVER auto-detects — every item carries an explicit type,
 *     ORCH-1069/0978 rule).
 *
 * This is the DIRECT upload path (NOT the heavy cover-video transcode pipeline,
 * which writes a single column and cannot back a many-URL gallery — F-7). The
 * raw chosen file is uploaded as-is; the 25 MB byte cap is the practical bound
 * (no client transcode, no duration cap in v1 — OQ-2/OQ-3).
 *
 * Trips-only + per-day-only. NOT shared with experiences/events (locked scope).
 *
 * Throws BrandCoverError (reused) with user-facing copy on every failure
 * (Constitution #3 — no silent failure).
 */

import { supabase } from "./supabase";
import { readBrandCoverFileBytes } from "./brandCoverFileReader";
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
}

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

/**
 * Upload a single trip-day media item. Returns the verified public URL + an
 * explicit `type`. Throws BrandCoverError with user-facing copy on any failure.
 */
export const uploadTripDayMedia = async (
  brandId: string,
  eventId: string,
  input: TripDayMediaAssetInput,
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
