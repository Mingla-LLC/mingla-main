/**
 * issue #3281 S3 — what an add-on photo may be, shared by web and native.
 * Input: JPEG, PNG, WebP or HEIC (HEIF) under 5 MB. Stored: two JPEGs made on
 * the device (1080 px long edge at quality 0.8, 240 px at 0.7). Never a
 * Supabase image transformation (standing hold #1643).
 */

export const ADD_ON_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const ADD_ON_PHOTO_FULL_EDGE = 1080;
export const ADD_ON_PHOTO_FULL_QUALITY = 0.8;
export const ADD_ON_PHOTO_THUMB_EDGE = 240;
export const ADD_ON_PHOTO_THUMB_QUALITY = 0.7;

const ACCEPTED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);
const ACCEPTED_EXT = /\.(jpe?g|png|webp|hei[cf])$/i;

/** True when the picked file is a photo type the editor accepts. */
export const isAcceptedAddOnPhoto = (input: {
  mimeType?: string | null;
  name?: string | null;
  uri?: string | null;
}): boolean => {
  const mime = (input.mimeType ?? "").trim().toLowerCase();
  if (mime.length > 0 && mime !== "application/octet-stream") return ACCEPTED_MIME.has(mime);
  const name = (input.name ?? input.uri ?? "").split(/[?#]/, 1)[0] ?? "";
  return ACCEPTED_EXT.test(name);
};

/** The size that fits `edge` on the long side, never upscaling. */
export const fitLongEdge = (
  width: number,
  height: number,
  edge: number,
): { width: number; height: number } => {
  const long = Math.max(width, height);
  if (long <= edge || long <= 0) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const scale = edge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

/** A fresh v4-shaped id for the storage file name. */
export const newAddOnPhotoId = (): string => {
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoRef !== undefined && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

export interface PreparedAddOnPhoto {
  full: Uint8Array | Blob;
  thumb: Uint8Array | Blob;
  /** Shown on the tile while it uploads. */
  previewUri: string;
}

export class AddOnPhotoError extends Error {
  readonly code: "add_on_photo_invalid" | "add_on_photo_permission" | "add_on_photo_unreadable";
  constructor(code: AddOnPhotoError["code"]) {
    super(code);
    this.name = "AddOnPhotoError";
    this.code = code;
  }
}

export const ADD_ON_PHOTO_ERROR_COPY: Readonly<Record<AddOnPhotoError["code"], string>> = {
  add_on_photo_invalid: "Choose a JPEG, PNG, WebP or HEIC photo under 5 MB.",
  add_on_photo_permission: "Allow photo access in Settings to add a photo.",
  add_on_photo_unreadable: "We couldn't read that photo. Try another.",
};
