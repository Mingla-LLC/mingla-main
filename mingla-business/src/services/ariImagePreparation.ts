/**
 * Issue #3429 REWORK-1 (D-5, SPEC AMENDMENT section 3.1) — pure image
 * preparation planner shared by the native and web preparers.
 *
 * Seth's decision (#issuecomment-5712780283 / -5712859450): every image is
 * prepared on the device or in the browser before upload. The longest side is
 * at most 1,600 px (never upscaled), the image is always re-encoded so camera
 * and location metadata are stripped, PNG and WebP sources become WebP so
 * transparency survives, and everything else becomes JPEG. No server or paid
 * image service is involved.
 */

export const ARI_IMAGE_PREPARED_LONG_EDGE = 1_600;
export const ARI_IMAGE_PREPARED_COMPRESS = 0.85;
export const ARI_IMAGE_SOURCE_MAX_BYTES = 60 * 1024 * 1024;
export const ARI_IMAGE_SOURCE_MAX_PIXELS = 120_000_000;

export type AriImageSourceKind = "jpeg" | "png" | "webp" | "heic";
export type AriPreparedImageFormat = "jpeg" | "webp";

export interface AriImagePreparationInput {
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  width?: number | null;
  height?: number | null;
}

export interface AriImageDimensions {
  width: number;
  height: number;
}

export type AriImagePreparationPlan =
  | { kind: "refuse"; code: "IMAGE_SOURCE_TOO_LARGE" }
  | {
    kind: "prepare";
    source: AriImageSourceKind;
    format: AriPreparedImageFormat;
    mimeType: "image/jpeg" | "image/webp";
    name: string;
    compress: number;
    /** The known-dimension target, or null when the source size is unknown. */
    resize: AriImageDimensions | null;
  };

function extensionOf(name: string): string {
  const clean = name.split(/[?#]/, 1)[0] ?? name;
  const match = /\.([a-z0-9]+)$/i.exec(clean.trim());
  return match ? match[1].toLowerCase() : "";
}

/** JPEG, PNG, WebP, HEIC or HEIF by MIME or by extension; otherwise null. */
export function ariImageSourceKind(
  name: string,
  mimeType: string | null,
): AriImageSourceKind | null {
  const mime = (mimeType ?? "").split(";", 1)[0].trim().toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpeg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic" || mime === "image/heif") return "heic";
  if (mime && mime !== "application/octet-stream") return null;
  switch (extensionOf(name)) {
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "png":
      return "png";
    case "webp":
      return "webp";
    case "heic":
    case "heif":
      return "heic";
    default:
      return null;
  }
}

/** Scale down (never up) so the long edge is at most 1,600 px, flooring. */
export function ariPreparedDimensions(
  width: number,
  height: number,
): AriImageDimensions {
  const longEdge = Math.max(width, height);
  if (longEdge <= ARI_IMAGE_PREPARED_LONG_EDGE) return { width, height };
  const scale = ARI_IMAGE_PREPARED_LONG_EDGE / longEdge;
  return width >= height
    ? {
      width: ARI_IMAGE_PREPARED_LONG_EDGE,
      height: Math.max(1, Math.floor(height * scale)),
    }
    : {
      width: Math.max(1, Math.floor(width * scale)),
      height: ARI_IMAGE_PREPARED_LONG_EDGE,
    };
}

/** Original base name with the prepared extension. */
export function ariPreparedName(
  name: string,
  format: AriPreparedImageFormat,
): string {
  const base = name.trim().replace(/\.[a-z0-9]+$/i, "") || "photo";
  return `${base}.${format === "webp" ? "webp" : "jpg"}`;
}

export function planAriImagePreparation(
  input: AriImagePreparationInput,
): AriImagePreparationPlan | null {
  const source = ariImageSourceKind(input.name, input.mimeType);
  if (source === null) return null;
  const knownWidth = typeof input.width === "number" && input.width > 0
    ? input.width
    : null;
  const knownHeight = typeof input.height === "number" && input.height > 0
    ? input.height
    : null;
  if (
    (input.sizeBytes ?? 0) > ARI_IMAGE_SOURCE_MAX_BYTES ||
    (knownWidth !== null && knownHeight !== null &&
      knownWidth * knownHeight > ARI_IMAGE_SOURCE_MAX_PIXELS)
  ) {
    return { kind: "refuse", code: "IMAGE_SOURCE_TOO_LARGE" };
  }
  const format: AriPreparedImageFormat = source === "png" || source === "webp"
    ? "webp"
    : "jpeg";
  const resize = knownWidth !== null && knownHeight !== null &&
      Math.max(knownWidth, knownHeight) > ARI_IMAGE_PREPARED_LONG_EDGE
    ? ariPreparedDimensions(knownWidth, knownHeight)
    : null;
  return {
    kind: "prepare",
    source,
    format,
    mimeType: format === "webp" ? "image/webp" : "image/jpeg",
    name: ariPreparedName(input.name, format),
    compress: ARI_IMAGE_PREPARED_COMPRESS,
    resize,
  };
}

/** A prepared copy ready to become the attachment draft. */
export interface AriPreparedImage {
  uri: string;
  name: string;
  mimeType: "image/jpeg" | "image/webp";
  /** Actual output byte length, never the picker's reported size. */
  sizeBytes: number;
  width: number;
  height: number;
  webFile?: File;
}

export class AriImagePreparationError extends Error {
  readonly code:
    | "IMAGE_SOURCE_TOO_LARGE"
    | "IMAGE_UNREADABLE"
    | "HEIC_NOT_SUPPORTED_IN_BROWSER";

  constructor(code: AriImagePreparationError["code"]) {
    super(code);
    this.name = "AriImagePreparationError";
    this.code = code;
  }
}
