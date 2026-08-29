import type { EventCoverMediaType } from "../store/draftEventStore";

export const EVENT_COVER_MAX_BYTES = 30 * 1024 * 1024;
export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 15_000;
export const EVENT_COVER_UPLOAD_LIMIT_COPY =
  "Upload a JPEG, PNG, WebP, or GIF up to 30 MB.";

export type EventCoverMediaErrorCode =
  | "permission_denied"
  | "unsupported_type"
  | "file_too_large"
  | "video_too_long"
  | "video_duration_unknown"
  | "upload_failed"
  | "display_failed"
  | "missing_server_event_id"
  | "persist_mismatch";

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
  const cleanName = fileName.split(/[?#]/, 1)[0] ?? fileName;
  const match = /\.([a-z0-9]+)$/i.exec(cleanName);
  return match?.[1]?.toLowerCase() ?? "";
};

const uriExtension = (uri?: string | null): string => {
  if (typeof uri !== "string") return "";
  const withoutQuery = uri.split(/[?#]/, 1)[0] ?? uri;
  return fileExtension(withoutQuery);
};

const MIME_BY_EXTENSION: Record<string, string> = {
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mov: "video/quicktime",
  mp4: "video/mp4",
  png: "image/png",
  qt: "video/quicktime",
  webm: "video/webm",
  webp: "image/webp",
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

const FALLBACK_MIME_BY_TYPE: Record<EventCoverMediaType, string> = {
  gif: "image/gif",
  image: "image/jpeg",
  video: "video/mp4",
};

const GENERIC_MIME_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
]);

const UNSUPPORTED_IMAGE_EXTENSIONS = new Set(["heic", "heif"]);
const UNSUPPORTED_IMAGE_MIME_TYPES = new Set(["image/heic", "image/heif"]);
const supportedMime = (mimeType?: string | null): string | null => {
  const mime = cleanMime(mimeType);
  if (mime.length === 0 || GENERIC_MIME_TYPES.has(mime)) return null;
  if (mime === "image/jpg") return "image/jpeg";
  return EXTENSION_BY_MIME[mime] !== undefined ? mime : null;
};

export const eventCoverContentType = (input: {
  mediaType: EventCoverMediaType;
  mimeType?: string | null;
  fileName?: string | null;
  blobMimeType?: string | null;
  uri?: string | null;
  byteHeader?: Uint8Array | ArrayBuffer | null;
}): string => {
  const mime = supportedMime(input.mimeType);
  if (mime !== null) return mime;
  const extensionMime = MIME_BY_EXTENSION[fileExtension(input.fileName)];
  if (extensionMime !== undefined) return extensionMime;
  const uriMime = MIME_BY_EXTENSION[uriExtension(input.uri)];
  if (uriMime !== undefined) return uriMime;
  const blobMime = supportedMime(input.blobMimeType);
  if (blobMime !== null) return blobMime;
  const byteMime = sniffEventCoverMimeType(input.byteHeader);
  if (byteMime !== null) return byteMime;
  return FALLBACK_MIME_BY_TYPE[input.mediaType];
};

export const eventCoverExtension = (input: {
  mediaType: EventCoverMediaType;
  mimeType?: string | null;
  fileName?: string | null;
  uri?: string | null;
}): string => {
  const mime = cleanMime(input.mimeType);
  const mimeExtension = EXTENSION_BY_MIME[mime];
  if (input.mediaType === "video" && mimeExtension !== undefined) {
    return mimeExtension;
  }
  const extension = fileExtension(input.fileName);
  if (extension.length > 0 && MIME_BY_EXTENSION[extension] !== undefined) {
    return extension === "jpeg" ? "jpg" : extension;
  }
  const uriExt = uriExtension(input.uri);
  if (uriExt.length > 0 && MIME_BY_EXTENSION[uriExt] !== undefined) {
    return uriExt === "jpeg" ? "jpg" : uriExt;
  }
  return (
    mimeExtension ??
    (input.mediaType === "video"
      ? "mp4"
      : input.mediaType === "gif"
        ? "gif"
        : "jpg")
  );
};

export const classifyEventCoverMedia = (
  inputOrMimeType?:
    | string
    | null
    | {
        mimeType?: string | null;
        fileName?: string | null;
        uri?: string | null;
        pickerType?: string | null;
        byteHeader?: Uint8Array | ArrayBuffer | null;
      },
  legacyFileName?: string | null,
): EventCoverMediaType | null => {
  const input =
    typeof inputOrMimeType === "object" && inputOrMimeType !== null
      ? inputOrMimeType
      : { mimeType: inputOrMimeType, fileName: legacyFileName };
  const fileExt = fileExtension(input.fileName);
  const uriExt = uriExtension(input.uri);
  const mime = cleanMime(input.mimeType);
  if (mime === "image/gif" || fileExt === "gif" || uriExt === "gif") {
    return "gif";
  }
  if (
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/png" ||
    mime === "image/webp" ||
    fileExt === "jpg" ||
    fileExt === "jpeg" ||
    fileExt === "png" ||
    fileExt === "webp" ||
    uriExt === "jpg" ||
    uriExt === "jpeg" ||
    uriExt === "png" ||
    uriExt === "webp"
  ) {
    return "image";
  }
  if (
    mime === "video/mp4" ||
    mime === "video/quicktime" ||
    mime === "video/webm" ||
    fileExt === "mov" ||
    fileExt === "mp4" ||
    fileExt === "qt" ||
    fileExt === "webm" ||
    uriExt === "mov" ||
    uriExt === "mp4" ||
    uriExt === "qt" ||
    uriExt === "webm"
  ) {
    return "video";
  }
  const sniffed = sniffEventCoverMimeType(input.byteHeader);
  if (sniffed !== null) return classifyEventCoverMedia(sniffed, null);
  if (input.pickerType === "image") return "image";
  if (input.pickerType === "video") return "video";
  return null;
};

const bytesFromHeader = (
  byteHeader?: Uint8Array | ArrayBuffer | null,
): Uint8Array | null => {
  if (byteHeader === null || byteHeader === undefined) return null;
  return byteHeader instanceof Uint8Array
    ? byteHeader
    : new Uint8Array(byteHeader);
};

export const sniffEventCoverMimeType = (
  byteHeader?: Uint8Array | ArrayBuffer | null,
): string | null => {
  const bytes = bytesFromHeader(byteHeader);
  if (bytes === null || bytes.byteLength < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif";
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    if (
      bytes[8] === 0x71 &&
      bytes[9] === 0x74 &&
      bytes[10] === 0x20 &&
      bytes[11] === 0x20
    ) {
      return "video/quicktime";
    }
    return "video/mp4";
  }
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "video/webm";
  }
  return null;
};

export interface NormalizedEventCoverAsset {
  uri: string;
  pickerType: string | null;
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  durationMs: number | null;
  inferredMimeType: string | null;
  mediaType: EventCoverMediaType;
}

const assertSupportedRejection = (input: {
  mimeType?: string | null;
  fileName?: string | null;
  uri?: string | null;
}): void => {
  const mime = cleanMime(input.mimeType);
  const extensions = [
    fileExtension(input.fileName),
    uriExtension(input.uri),
  ].filter((extension) => extension.length > 0);
  if (
    UNSUPPORTED_IMAGE_MIME_TYPES.has(mime) ||
    extensions.some((extension) => UNSUPPORTED_IMAGE_EXTENSIONS.has(extension))
  ) {
    throw new EventCoverMediaError(
      "unsupported_type",
      "Choose a JPEG, PNG, WebP, or GIF.",
    );
  }
};

export const validateEventCoverAsset = (input: {
  mimeType?: string | null;
  fileName?: string | null;
  uri?: string | null;
  pickerType?: string | null;
  byteHeader?: Uint8Array | ArrayBuffer | null;
  fileSize?: number | null;
  durationMs?: number | null;
}): EventCoverMediaType => {
  assertSupportedRejection(input);
  const mediaType = classifyEventCoverMedia(input);
  if (mediaType === null) {
    throw new EventCoverMediaError(
      "unsupported_type",
      "Choose a JPG, PNG, GIF, MP4, MOV, or WebM file up to 30 MB and 15 seconds.",
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
  if (mediaType === "video" && typeof input.durationMs !== "number") {
    throw new EventCoverMediaError(
      "video_duration_unknown",
      "Choose a 15-second MP4, MOV, or WebM video.",
    );
  }
  if (
    mediaType === "video" &&
    typeof input.durationMs === "number" &&
    input.durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS
  ) {
    throw new EventCoverMediaError(
      "video_too_long",
      "Choose a video that is 15 seconds or shorter.",
    );
  }
  return mediaType;
};

export const normalizeEventCoverAsset = (input: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  pickerType?: string | null;
  fileSize?: number | null;
  durationMs?: number | null;
  byteHeader?: Uint8Array | ArrayBuffer | null;
}): NormalizedEventCoverAsset => {
  const mediaType = validateEventCoverAsset(input);
  const inferredMimeType = eventCoverContentType({
    byteHeader: input.byteHeader,
    fileName: input.fileName,
    mediaType,
    mimeType: input.mimeType,
    uri: input.uri,
  });
  return {
    uri: input.uri,
    pickerType: input.pickerType ?? null,
    mimeType: input.mimeType ?? null,
    fileName: input.fileName ?? null,
    fileSize: input.fileSize ?? null,
    durationMs: input.durationMs ?? null,
    inferredMimeType,
    mediaType,
  };
};

// ORCH-0964 — kept identical to @mingla/offering-rendering `coverMediaPresentation.ts`,
// which the shared EventCoverMedia uses. Both are the same pure 1:1 type→presentation
// mapping; if you change one, change the other (covered by eventCoverMedia.test.ts).
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

// ORCH-0992 [event-cover video paused on web] — kept identical to
// @mingla/offering-rendering `coverMediaPresentation.ts` `shouldFreezeCoverForReduceMotion`.
// A muted-autoplay-loop cover is ambient motion (like a GIF cover, never frozen);
// only non-ambient covers (sound-on / tap-to-play) still freeze to a still under
// reduce-motion. If you change one copy, change the other.
export const shouldFreezeCoverForReduceMotion = ({
  reduceMotion,
  autoplay,
  muted,
  loop,
}: {
  reduceMotion?: boolean;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
}): boolean => {
  const isAmbientMutedLoop =
    autoplay === true && muted === true && loop === true;
  return reduceMotion === true && !isAmbientMutedLoop;
};

export const isLegacyUnsafeEventCoverVideoUrl = (
  mediaUrl?: string | null,
  mediaType?: EventCoverMediaType | null,
): boolean => {
  if (mediaType !== "video" || typeof mediaUrl !== "string") return false;
  const cleanUrl = mediaUrl.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  return (
    cleanUrl.endsWith(".mov") ||
    cleanUrl.endsWith(".qt") ||
    cleanUrl.includes("video/quicktime")
  );
};

const isExpectedPublicContentType = (
  mediaType: EventCoverMediaType,
  contentType: string,
): boolean => {
  const normalized = contentType.trim().toLowerCase();
  if (normalized.length === 0) return false;
  if (mediaType === "video") return normalized.startsWith("video/");
  return normalized.startsWith("image/");
};

type FetchLike = typeof fetch;

const throwDisplayFailed = (): never => {
  throw new EventCoverMediaError(
    "display_failed",
    "Uploaded cover could not be displayed.",
  );
};

const contentLength = (response: Response): number | null => {
  const header = response.headers.get("content-length");
  if (header === null) return null;
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const contentRangeHasBytes = (response: Response): boolean => {
  const header = response.headers.get("content-range");
  if (header === null) return false;
  const match = /^bytes\s+\d+-\d+\/(\d+|\*)$/i.exec(header.trim());
  if (match === null || match[1] === "*") return false;
  const total = Number.parseInt(match[1], 10);
  return Number.isFinite(total) && total > 0;
};

const responseBodyHasBytes = async (response: Response): Promise<boolean> => {
  const withArrayBuffer = response as Response & {
    arrayBuffer?: () => Promise<{ byteLength?: number }>;
  };
  if (typeof withArrayBuffer.arrayBuffer === "function") {
    const bytes = await withArrayBuffer.arrayBuffer();
    return typeof bytes.byteLength === "number" && bytes.byteLength > 0;
  }
  const withBlob = response as Response & {
    blob?: () => Promise<{ size?: number }>;
  };
  if (typeof withBlob.blob === "function") {
    const blob = await withBlob.blob();
    return typeof blob.size === "number" && blob.size > 0;
  }
  return false;
};

const assertPublicResponseLooksRenderable = async (
  response: Response,
  mediaType: EventCoverMediaType,
  requireBodyProof: boolean,
): Promise<void> => {
  if (!response.ok) {
    throwDisplayFailed();
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!isExpectedPublicContentType(mediaType, contentType)) {
    throwDisplayFailed();
  }
  const length = contentLength(response);
  if (length === 0) throwDisplayFailed();
  if (length !== null && length > 0) return;
  if (contentRangeHasBytes(response)) return;
  if (requireBodyProof && (await responseBodyHasBytes(response))) return;
  if (requireBodyProof) throwDisplayFailed();
};

const publicResponseHasPositiveLength = (
  response: Response,
  mediaType: EventCoverMediaType,
): boolean => {
  if (!response.ok) throwDisplayFailed();
  const contentType = response.headers.get("content-type") ?? "";
  if (!isExpectedPublicContentType(mediaType, contentType)) {
    throwDisplayFailed();
  }
  const length = contentLength(response);
  if (length === 0) throwDisplayFailed();
  return (length !== null && length > 0) || contentRangeHasBytes(response);
};

export const verifyEventCoverPublicUrl = async (
  publicUrl: string,
  mediaType: EventCoverMediaType,
  fetchImpl: FetchLike = fetch,
): Promise<void> => {
  try {
    const head = await fetchImpl(publicUrl, { method: "HEAD" });
    if (head.ok && publicResponseHasPositiveLength(head, mediaType)) {
      return;
    }
    if (!head.ok && head.status !== 405 && head.status !== 501) {
      throwDisplayFailed();
    }
  } catch (error) {
    if (error instanceof EventCoverMediaError) throw error;
    // Some React Native/storage combinations do not support HEAD reliably.
  }

  const rangeResponse = await fetchImpl(publicUrl, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
  });
  await assertPublicResponseLooksRenderable(rangeResponse, mediaType, true);
};
