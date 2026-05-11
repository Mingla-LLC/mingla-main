export const CREATOR_AVATAR_MAX_BYTES = 10 * 1024 * 1024;

export const CREATOR_AVATAR_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type CreatorAvatarMimeType =
  (typeof CREATOR_AVATAR_ALLOWED_MIME_TYPES)[number];

export type CreatorAvatarErrorCode =
  | "permission_denied"
  | "unsupported_type"
  | "file_too_large"
  | "empty_local_file"
  | "upload_failed"
  | "display_failed";

export class CreatorAvatarError extends Error {
  code: CreatorAvatarErrorCode;

  constructor(code: CreatorAvatarErrorCode, message: string) {
    super(message);
    this.name = "CreatorAvatarError";
    this.code = code;
  }
}

export interface CreatorAvatarAssetInput {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}

type FetchLike = typeof fetch;

const MIME_BY_EXTENSION: Record<string, CreatorAvatarMimeType> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const EXTENSION_BY_MIME: Record<CreatorAvatarMimeType, string> = {
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

const isCreatorAvatarMimeType = (
  mimeType: string,
): mimeType is CreatorAvatarMimeType =>
  CREATOR_AVATAR_ALLOWED_MIME_TYPES.includes(
    mimeType as CreatorAvatarMimeType,
  );

const fileExtension = (value?: string | null): string => {
  if (typeof value !== "string") return "";
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
  const match = /\.([a-z0-9]+)$/i.exec(withoutQuery);
  return match?.[1]?.toLowerCase() ?? "";
};

const supportedMime = (mimeType?: string | null): CreatorAvatarMimeType | null => {
  const mime = cleanMime(mimeType);
  if (mime.length === 0 || GENERIC_MIME_TYPES.has(mime)) return null;
  if (mime === "image/jpg") return "image/jpeg";
  return isCreatorAvatarMimeType(mime) ? mime : null;
};

export const resolveCreatorAvatarContentType = (
  input: CreatorAvatarAssetInput,
): CreatorAvatarMimeType | null => {
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

// ORCH-0786 follow-up — Rotate the storage path on every upload so the public
// URL changes per pick. Without rotation, deterministic paths + upsert kept the
// same URL string and native image caches served stale bytes after reload.
// The RLS predicate `split_part(name, '.', 1) = auth.uid()::text` still matches
// because the first dot-segment is still the user id.
export const generateCreatorAvatarPathToken = (): string => {
  const millis = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${millis}${rand}`;
};

export const creatorAvatarStoragePath = (
  userId: string,
  contentType: CreatorAvatarMimeType,
  pathToken: string,
): string =>
  `${userId}.${pathToken}.${EXTENSION_BY_MIME[contentType]}`;

const CREATOR_AVATAR_PATH_REGEX =
  /\/storage\/v1\/object\/public\/creator_avatars\/([^?#]+)/;

export const extractCreatorAvatarStoragePath = (
  publicUrl: string | null | undefined,
): string | null => {
  if (typeof publicUrl !== "string" || publicUrl.length === 0) return null;
  const match = CREATOR_AVATAR_PATH_REGEX.exec(publicUrl);
  return match?.[1] ?? null;
};

const throwUploadFailed = (): never => {
  throw new CreatorAvatarError(
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

export const verifyCreatorAvatarPublicUrl = async (
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
    if (error instanceof CreatorAvatarError) throw error;
  }

  const rangeResponse = await fetchImpl(publicUrl, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
  });
  await assertAvatarResponseHasBytes(rangeResponse, true);
};
