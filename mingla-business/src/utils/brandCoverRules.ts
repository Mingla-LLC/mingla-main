/**
 * brandCoverRules — pure utilities backing the brand cover upload pipeline
 * (ORCH-0805, I-PROPOSED-BE BRAND_COVER_MEDIA_HONORED).
 *
 * Mirrors the proven `creatorAvatarRules` pattern from ORCH-0786 but with:
 *   - GIF allowed (avatar rules reject GIF)
 *   - 15 MB cap (avatar is 10 MB) to accommodate animated GIF covers
 *   - Storage path uses brand UUID as a folder segment so RLS can
 *     `split_part(name, '/', 1)` to gate writes by brand admin membership
 *
 * Adding a new MIME type? Update `BRAND_COVER_ALLOWED_MIME_TYPES`, the
 * MIME_BY_EXTENSION map, the EXTENSION_BY_MIME map, AND the migration's
 * `allowed_mime_types` ARRAY together — drift will be caught by the
 * orch-0805 strict-grep gate.
 *
 * Per ORCH-0805 SPEC §6.1.
 */

// ORCH-0805 hotfix (2026-05-12) — lowered from 15 MB to 8 MB after operator
// device smoke reported full app freeze on a real GIF pick. Root cause:
// reading 10–30 MB of bytes through expo-file-system blocks the JS thread
// long enough to look like a hard freeze. 8 MB keeps cover quality high
// while bounding worst-case read time to ~1–2 s on real devices. Bucket
// `file_size_limit` lowered to match in
// `20260529000001_orch_0805_brand_covers_lower_cap.sql` to preserve
// Constitution #13 exclusion-consistency.
export const BRAND_COVER_MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export const BRAND_COVER_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type BrandCoverMimeType =
  (typeof BRAND_COVER_ALLOWED_MIME_TYPES)[number];

/** Stored on `brands.cover_media_type`. "image" for jpeg/png/webp; "gif" for gif. */
export type BrandCoverMediaType = "image" | "gif";

export type BrandCoverErrorCode =
  | "permission_denied"
  | "unsupported_type"
  | "file_too_large"
  | "empty_local_file"
  | "upload_failed"
  | "display_failed"
  | "provider_search_failed"
  | "provider_invalid_url";

export class BrandCoverError extends Error {
  readonly code: BrandCoverErrorCode;

  constructor(code: BrandCoverErrorCode, message: string) {
    super(message);
    this.name = "BrandCoverError";
    this.code = code;
  }
}

export interface BrandCoverAssetInput {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}

const MIME_BY_EXTENSION: Record<string, BrandCoverMimeType> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const EXTENSION_BY_MIME: Record<BrandCoverMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const GENERIC_MIME_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
]);

const cleanMime = (mimeType?: string | null): string =>
  typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";

const isBrandCoverMimeType = (
  mimeType: string,
): mimeType is BrandCoverMimeType =>
  BRAND_COVER_ALLOWED_MIME_TYPES.includes(mimeType as BrandCoverMimeType);

const fileExtension = (value?: string | null): string => {
  if (typeof value !== "string") return "";
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
  const match = /\.([a-z0-9]+)$/i.exec(withoutQuery);
  return match?.[1]?.toLowerCase() ?? "";
};

const supportedMime = (
  mimeType?: string | null,
): BrandCoverMimeType | null => {
  const mime = cleanMime(mimeType);
  if (mime.length === 0 || GENERIC_MIME_TYPES.has(mime)) return null;
  if (mime === "image/jpg") return "image/jpeg";
  return isBrandCoverMimeType(mime) ? mime : null;
};

/** Resolve content type from input metadata + URI extension. Returns null
 * if the asset is not a supported cover MIME type. */
export const resolveBrandCoverContentType = (
  input: BrandCoverAssetInput,
): BrandCoverMimeType | null => {
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

/** Map MIME → the `cover_media_type` discriminator persisted on `brands`. */
export const brandCoverMediaTypeFromMime = (
  mime: BrandCoverMimeType,
): BrandCoverMediaType => (mime === "image/gif" ? "gif" : "image");

/** Generate a per-upload path token so the public URL changes per pick
 * (defeats native image cache holding stale bytes — ORCH-0786 precedent). */
export const generateBrandCoverPathToken = (): string => {
  const millis = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${millis}${rand}`;
};

/** Compose the bucket-relative storage path. Convention is
 * `{brandId}/{token}.{ext}` — the first '/'-segment is the brand UUID
 * which the RLS policy reads via `split_part(name, '/', 1)` to gate writes
 * to brand admins of that brand. */
export const brandCoverStoragePath = (
  brandId: string,
  contentType: BrandCoverMimeType,
  pathToken: string,
): string => `${brandId}/${pathToken}.${EXTENSION_BY_MIME[contentType]}`;

const BRAND_COVER_PATH_REGEX =
  /\/storage\/v1\/object\/public\/brand_covers\/([^?#]+)/;

/** Parse the bucket-relative storage path back out of a public URL. Used
 * for best-effort orphan cleanup after path rotation. */
export const extractBrandCoverStoragePath = (
  publicUrl: string | null | undefined,
): string | null => {
  if (typeof publicUrl !== "string" || publicUrl.length === 0) return null;
  const match = BRAND_COVER_PATH_REGEX.exec(publicUrl);
  return match?.[1] ?? null;
};

// ----- HEAD/Range probe to verify upload visibility (avatar precedent) -----

type FetchLike = typeof fetch;

const throwUploadFailed = (): never => {
  throw new BrandCoverError(
    "upload_failed",
    "Couldn't upload cover. Tap to try again.",
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

const assertCoverResponseHasBytes = async (
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

/** Confirm the just-uploaded public URL is visible and non-empty before
 * the service returns success. Mirrors the avatar precedent: try HEAD
 * first, fall back to a single-byte GET range probe (mandatory body
 * proof) when the storage edge does not implement HEAD. */
export const verifyBrandCoverPublicUrl = async (
  publicUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> => {
  try {
    const head = await fetchImpl(publicUrl, { method: "HEAD" });
    if (head.ok) {
      await assertCoverResponseHasBytes(head, false);
      return;
    }
    if (head.status !== 405 && head.status !== 501) {
      throwUploadFailed();
    }
  } catch (error) {
    if (error instanceof BrandCoverError) throw error;
  }

  const rangeResponse = await fetchImpl(publicUrl, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
  });
  await assertCoverResponseHasBytes(rangeResponse, true);
};

// ----- Provider URL allowlist (Pexels / Giphy) -----

const PEXELS_HOST_ALLOWLIST = new Set([
  "images.pexels.com",
  "videos.pexels.com",
]);

const GIPHY_HOST_REGEX = /^[a-z0-9-]+\.giphy\.com$/;

export interface BrandCoverProviderRef {
  provider: "pexels" | "giphy";
  publicUrl: string;
  attribution: { name: string; url: string } | null;
}

/** Validate a Pexels/Giphy URL before persisting to `brands.cover_media_url`.
 * Throws on host mismatch so a malicious caller cannot inject arbitrary
 * URLs through the picker. Returns the resolved media type for
 * `brands.cover_media_type`. */
export const validateBrandCoverProviderUrl = (
  ref: BrandCoverProviderRef,
): { publicUrl: string; mediaType: BrandCoverMediaType } => {
  let parsed: URL;
  try {
    parsed = new URL(ref.publicUrl);
  } catch {
    throw new BrandCoverError(
      "provider_invalid_url",
      "That cover link doesn't look right.",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new BrandCoverError(
      "provider_invalid_url",
      "Cover URLs must be HTTPS.",
    );
  }
  const host = parsed.host.toLowerCase();
  if (ref.provider === "pexels") {
    if (!PEXELS_HOST_ALLOWLIST.has(host)) {
      throw new BrandCoverError(
        "provider_invalid_url",
        "That isn't a Pexels image URL.",
      );
    }
    return { publicUrl: ref.publicUrl, mediaType: "image" };
  }
  if (ref.provider === "giphy") {
    if (!GIPHY_HOST_REGEX.test(host)) {
      throw new BrandCoverError(
        "provider_invalid_url",
        "That isn't a GIPHY URL.",
      );
    }
    return { publicUrl: ref.publicUrl, mediaType: "gif" };
  }
  // exhaustive — the provider union is "pexels" | "giphy"
  const _exhaustive: never = ref.provider;
  void _exhaustive;
  throw new BrandCoverError(
    "provider_invalid_url",
    "Unknown cover source.",
  );
};
