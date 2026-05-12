/**
 * brandCoverService — upload + verify + cleanup for brand cover media
 * (ORCH-0805, I-PROPOSED-BE BRAND_COVER_MEDIA_HONORED).
 *
 * Two entry points:
 *   1. `uploadBrandCover` — device file → Supabase Storage `brand_covers`
 *      bucket → verified public URL. Mirrors the proven ORCH-0786 avatar
 *      pipeline (rules → reader → service → verify → cleanup).
 *   2. `coverFromProviderRef` — wraps `validateBrandCoverProviderUrl` for
 *      the Pexels / Giphy paths where there is no upload, just URL
 *      persistence.
 *
 * Both return the same shape `{ publicUrl, mediaType }` so the upload hook
 * does not need to branch downstream.
 *
 * Per ORCH-0805 SPEC §6.3.
 */

import { supabase } from "./supabase";
import { readBrandCoverFileBytes } from "./brandCoverFileReader";
import {
  BRAND_COVER_MAX_BYTES,
  BrandCoverError,
  brandCoverMediaTypeFromMime,
  brandCoverStoragePath,
  extractBrandCoverStoragePath,
  generateBrandCoverPathToken,
  resolveBrandCoverContentType,
  validateBrandCoverProviderUrl,
  verifyBrandCoverPublicUrl,
  type BrandCoverAssetInput,
  type BrandCoverMediaType,
  type BrandCoverMimeType,
  type BrandCoverProviderRef,
} from "../utils/brandCoverRules";

export const BRAND_COVERS_BUCKET = "brand_covers";

export interface BrandCoverPersistedRef {
  publicUrl: string;
  mediaType: BrandCoverMediaType;
}

export interface BrandCoverUploadResult extends BrandCoverPersistedRef {
  storagePath: string;
  contentType: BrandCoverMimeType;
}

export interface BrandCoverUploadOptions {
  /** When provided, the previously-persisted public URL is parsed for its
   * storage path and best-effort removed after the new upload verifies. */
  previousPublicUrl?: string | null;
}

export const uploadBrandCover = async (
  brandId: string,
  input: BrandCoverAssetInput,
  options: BrandCoverUploadOptions = {},
): Promise<BrandCoverUploadResult> => {
  const contentType = resolveBrandCoverContentType(input);
  if (contentType === null) {
    throw new BrandCoverError(
      "unsupported_type",
      "Choose a JPEG, PNG, WebP, or GIF.",
    );
  }

  const { bytes, byteLength } = await readBrandCoverFileBytes(input.uri);

  // ORCH-0786 — fetch(uri).blob() silently returns size-0 on RN iOS.
  if (byteLength <= 0) {
    throw new BrandCoverError(
      "empty_local_file",
      "We couldn't read that file. Try another.",
    );
  }

  if (byteLength > BRAND_COVER_MAX_BYTES) {
    throw new BrandCoverError(
      "file_too_large",
      "That file is too large — pick one under 15 MB.",
    );
  }

  // Rotate the storage path on every upload — required so the public URL
  // string changes per pick and the native image cache cannot serve stale
  // bytes after reload. See ORCH-0786 stale-cache follow-up.
  const pathToken = generateBrandCoverPathToken();
  const storagePath = brandCoverStoragePath(brandId, contentType, pathToken);
  const { error: uploadError } = await supabase.storage
    .from(BRAND_COVERS_BUCKET)
    .upload(storagePath, bytes, {
      contentType,
      upsert: true,
    });

  if (uploadError !== null) {
    throw new BrandCoverError(
      "upload_failed",
      "Couldn't upload cover. Tap to try again.",
    );
  }

  const { data } = supabase.storage
    .from(BRAND_COVERS_BUCKET)
    .getPublicUrl(storagePath);

  await verifyBrandCoverPublicUrl(data.publicUrl);

  // Best-effort orphan cleanup. Never fail the upload on cleanup error.
  const previousPath = extractBrandCoverStoragePath(
    options.previousPublicUrl ?? null,
  );
  if (previousPath !== null && previousPath !== storagePath) {
    try {
      await supabase.storage.from(BRAND_COVERS_BUCKET).remove([previousPath]);
    } catch {
      // ignore — orphan cleanup is non-blocking
    }
  }

  return {
    publicUrl: data.publicUrl,
    storagePath,
    contentType,
    mediaType: brandCoverMediaTypeFromMime(contentType),
  };
};

/** Validates a Pexels / Giphy URL and returns it as a persistence-ready
 * ref. Used when the brand admin picks a library result instead of
 * uploading a device file. */
export const coverFromProviderRef = (
  ref: BrandCoverProviderRef,
): BrandCoverPersistedRef => {
  const validated = validateBrandCoverProviderUrl(ref);
  return {
    publicUrl: validated.publicUrl,
    mediaType: validated.mediaType,
  };
};
