/**
 * brandAvatarRules — validation utilities for the brand profile photo
 * upload pipeline.
 *
 * Mirrors `brandCoverRules.ts` (ORCH-0805) with two differences:
 *   1. Tighter MIME allowlist — image/jpeg, image/png, image/webp ONLY
 *      (no GIF, no video — avatars are static).
 *   2. Smaller size cap — 5 MB (avatars are smaller than covers).
 *
 * Square enforcement is NOT performed here. The crop UX is offered to the
 * user at the picker tier via `expo-image-picker`'s
 * `allowsEditing: true, aspect: [1, 1]` (Android enforces; iOS hints).
 * If the user produces a non-square crop on iOS by ignoring the overlay,
 * the photo is uploaded as-picked and the round-circle Avatar primitive
 * cover-crops at render time. Operator decision 2026-05-12: trust the
 * user with the native crop, do not add a manipulator dependency.
 *
 * Per ORCH-0807 SPEC §6.1 (revised 2026-05-12).
 */

/** Maximum file size for the raw picker output. */
export const BRAND_AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** Static images only — NO GIF, NO video. */
export const BRAND_AVATAR_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type BrandAvatarMimeType =
  (typeof BRAND_AVATAR_ALLOWED_MIME_TYPES)[number];

export type BrandAvatarErrorCode =
  | "permission_denied"
  | "unsupported_type"
  | "file_too_large"
  | "empty_local_file"
  | "upload_failed"
  | "display_failed";

export class BrandAvatarError extends Error {
  code: BrandAvatarErrorCode;

  constructor(code: BrandAvatarErrorCode, message: string) {
    super(message);
    this.name = "BrandAvatarError";
    this.code = code;
  }
}

export interface BrandAvatarAssetInput {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}

const MIME_BY_EXTENSION: Record<string, BrandAvatarMimeType> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const EXTENSION_BY_MIME: Record<BrandAvatarMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const GENERIC_MIME_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
]);

const cleanMime = (mimeType?: string | null): string =>
  typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";

const isBrandAvatarMimeType = (
  mimeType: string,
): mimeType is BrandAvatarMimeType =>
  BRAND_AVATAR_ALLOWED_MIME_TYPES.includes(mimeType as BrandAvatarMimeType);

const fileExtension = (value?: string | null): string => {
  if (typeof value !== "string") return "";
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
  const match = /\.([a-z0-9]+)$/i.exec(withoutQuery);
  return match?.[1]?.toLowerCase() ?? "";
};

const supportedMime = (mimeType?: string | null): BrandAvatarMimeType | null => {
  const mime = cleanMime(mimeType);
  if (mime.length === 0 || GENERIC_MIME_TYPES.has(mime)) return null;
  if (mime === "image/jpg") return "image/jpeg";
  return isBrandAvatarMimeType(mime) ? mime : null;
};

export const resolveBrandAvatarContentType = (
  input: BrandAvatarAssetInput,
): BrandAvatarMimeType | null => {
  const mime = cleanMime(input.mimeType);
  if (
    mime.length > 0 &&
    !GENERIC_MIME_TYPES.has(mime) &&
    supportedMime(mime) === null
  ) {
    return null;
  }
  const directMime = supportedMime(input.mimeType);
  if (directMime !== null) return directMime;
  const fileMime = MIME_BY_EXTENSION[fileExtension(input.fileName)];
  if (fileMime !== undefined) return fileMime;
  const uriMime = MIME_BY_EXTENSION[fileExtension(input.uri)];
  return uriMime ?? null;
};

/** Generate a per-upload path token so the public URL changes per pick
 * (defeats native image cache holding stale bytes — ORCH-0786 precedent). */
export const generateBrandAvatarPathToken = (): string => {
  const millis = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${millis}${rand}`;
};

/** Compose the bucket-relative storage path. Convention is
 * `{brandId}/{token}.{ext}` — the first '/'-segment is the brand UUID
 * which the RLS policy reads via `split_part(name, '/', 1)` to gate writes
 * to brand admins of that brand. Mirrors brandCoverStoragePath. */
export const brandAvatarStoragePath = (
  brandId: string,
  contentType: BrandAvatarMimeType,
  pathToken: string,
): string => `${brandId}/${pathToken}.${EXTENSION_BY_MIME[contentType]}`;

const BRAND_AVATAR_PATH_REGEX =
  /\/storage\/v1\/object\/public\/brand_avatars\/([^?#]+)/;

/** Parse the bucket-relative storage path back out of a public URL. Used
 * for best-effort orphan cleanup after path rotation. */
export const extractBrandAvatarStoragePath = (
  publicUrl: string | null | undefined,
): string | null => {
  if (typeof publicUrl !== "string" || publicUrl.length === 0) return null;
  const match = BRAND_AVATAR_PATH_REGEX.exec(publicUrl);
  return match?.[1] ?? null;
};

type FetchLike = typeof fetch;

const throwUploadFailed = (): never => {
  throw new BrandAvatarError(
    "upload_failed",
    "Couldn't upload photo. Tap to try again.",
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
  if (typeof withArrayBuffer.arrayBuffer !== "function") return false;
  const bytes = await withArrayBuffer.arrayBuffer();
  return typeof bytes.byteLength === "number" && bytes.byteLength > 0;
};

const assertAvatarResponseHasBytes = async (
  response: Response,
  requireBodyProof: boolean,
): Promise<void> => {
  if (!response.ok) throwUploadFailed();
  const length = contentLength(response);
  if (length === 0) throwUploadFailed();
  if (length !== null && length > 0) return;
  if (contentRangeHasBytes(response)) return;
  if (requireBodyProof && (await responseBodyHasBytes(response))) return;
  if (requireBodyProof) throwUploadFailed();
};

/** Verify the public URL serves bytes (HEAD or Range fallback). Mirrors
 * the ORCH-0786 creator avatar verifier. Throws `BrandAvatarError(
 * "upload_failed")` if the URL is unreachable. */
export const verifyBrandAvatarPublicUrl = async (
  publicUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> => {
  try {
    const head = await fetchImpl(publicUrl, { method: "HEAD" });
    if (head.ok) {
      await assertAvatarResponseHasBytes(head, false);
      return;
    }
    if (head.status !== 405 && head.status !== 501) {
      throwUploadFailed();
    }
  } catch (error) {
    if (error instanceof BrandAvatarError) throw error;
  }

  const rangeResponse = await fetchImpl(publicUrl, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
  });
  await assertAvatarResponseHasBytes(rangeResponse, true);
};
