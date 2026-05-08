import type { EventCoverMediaType } from "../store/draftEventStore";

export const EVENT_COVER_MAX_BYTES = 30 * 1024 * 1024;
export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 15_000;

export type EventCoverMediaErrorCode =
  | "permission_denied"
  | "unsupported_type"
  | "file_too_large"
  | "video_too_long"
  | "upload_failed"
  | "missing_server_event_id";

export class EventCoverMediaError extends Error {
  code: EventCoverMediaErrorCode;

  constructor(code: EventCoverMediaErrorCode, message: string) {
    super(message);
    this.name = "EventCoverMediaError";
    this.code = code;
  }
}

const cleanMime = (mimeType?: string | null): string =>
  typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";

const fileExtension = (fileName?: string | null): string => {
  if (typeof fileName !== "string") return "";
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match?.[1]?.toLowerCase() ?? "";
};

export const classifyEventCoverMedia = (
  mimeType?: string | null,
  fileName?: string | null,
): EventCoverMediaType | null => {
  const mime = cleanMime(mimeType);
  const ext = fileExtension(fileName);
  if (mime === "image/gif" || ext === "gif") return "gif";
  if (
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/png" ||
    mime === "image/webp" ||
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "png" ||
    ext === "webp"
  ) {
    return "image";
  }
  if (
    mime === "video/mp4" ||
    mime === "video/webm" ||
    ext === "mp4" ||
    ext === "webm"
  ) {
    return "video";
  }
  return null;
};

export const validateEventCoverAsset = (input: {
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  durationMs?: number | null;
}): EventCoverMediaType => {
  const mediaType = classifyEventCoverMedia(input.mimeType, input.fileName);
  if (mediaType === null) {
    throw new EventCoverMediaError(
      "unsupported_type",
      "Choose an image, GIF, or short MP4/WebM video.",
    );
  }
  if (
    typeof input.fileSize === "number" &&
    input.fileSize > EVENT_COVER_MAX_BYTES
  ) {
    throw new EventCoverMediaError(
      "file_too_large",
      "Covers must be 30 MB or smaller.",
    );
  }
  if (
    mediaType === "video" &&
    typeof input.durationMs !== "number"
  ) {
    throw new EventCoverMediaError(
      "video_too_long",
      "Cover videos must include duration and be 15 seconds or shorter.",
    );
  }
  if (
    mediaType === "video" &&
    typeof input.durationMs === "number" &&
    input.durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS
  ) {
    throw new EventCoverMediaError(
      "video_too_long",
      "Cover videos must be 15 seconds or shorter.",
    );
  }
  return mediaType;
};

export const resolveEventCoverMediaPresentation = ({
  mediaUrl,
  mediaType,
  hasMediaError,
  reduceMotion,
}: {
  mediaUrl?: string | null;
  mediaType?: EventCoverMediaType | null;
  hasMediaError?: boolean;
  reduceMotion?: boolean;
}): "fallback" | "image" | "gif" | "video" | "video_still" => {
  if (hasMediaError === true || mediaUrl === null || mediaUrl === undefined) {
    return "fallback";
  }
  if (mediaType === "video") {
    return reduceMotion === true ? "video_still" : "video";
  }
  if (mediaType === "gif") return "gif";
  if (mediaType === "image") return "image";
  return "fallback";
};
