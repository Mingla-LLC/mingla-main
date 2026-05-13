/**
 * brandAvatarService — upload pipeline for the brand profile photo.
 *
 * Pipeline (called by `useBrandAvatarUpload`):
 *   1. Resolve content type from the picker asset (throws `unsupported_type`
 *      for HEIC, GIF, video, or anything outside JPEG/PNG/WEBP).
 *   2. Pre-read size guard via `expo-image-picker`'s `asset.fileSize` to
 *      avoid blocking the JS thread on a multi-MB read of a file we'd
 *      reject anyway (ORCH-0805 GIF freeze precedent).
 *   3. Read bytes via `expo-file-system.File.arrayBuffer()` (RN-iOS-safe;
 *      `fetch(uri).blob()` silently returns size-0 on some content:// URIs
 *      per ORCH-0786).
 *   4. Post-read size guards (file_too_large > 5 MB; empty_local_file ≤ 0).
 *   5. Rotate storage path token so the public URL string changes per
 *      upload (defeats native image cache stale-bytes — ORCH-0786 precedent).
 *   6. Direct `supabase.storage.from('brand_avatars').upload(...)` — no
 *      edge function needed. The bucket's RLS policy gates writes to
 *      brand-admin+ via the first '/'-segment of the path.
 *   7. Verify the resulting public URL serves bytes via HEAD/Range probe.
 *   8. Best-effort orphan cleanup of the previous storage path.
 *
 * Square enforcement is handled at the PICKER tier: `BrandAvatarPickerSheet`
 * calls `expo-image-picker.launchImageLibraryAsync` with
 * `allowsEditing: true, aspect: [1, 1]` so Android enforces a 1:1 crop and
 * iOS offers a 1:1 overlay hint. We trust the user with the native crop
 * UI — if they ignore the hint on iOS, the resulting photo is uploaded
 * as-picked and the round-circle Avatar primitive cover-crops it at
 * render time. No server-side or service-side square enforcement.
 *
 * Returns `{ publicUrl, storagePath, contentType }`. The hook composes
 * this with `useUpdateBrand().mutateAsync({ patch: { photo, profile-
 * PhotoType: "image" } })` for the DB write — same pattern as
 * useBrandCoverUpload.
 *
 * Per ORCH-0807 SPEC §6.2 (revised 2026-05-12 — operator chose no manipulator
 * dep; trust users with the native crop).
 */

import { supabase } from "./supabase";
import { readBrandAvatarFileBytes } from "./brandAvatarFileReader";
import {
  BRAND_AVATAR_MAX_BYTES,
  BrandAvatarError,
  brandAvatarStoragePath,
  extractBrandAvatarStoragePath,
  generateBrandAvatarPathToken,
  resolveBrandAvatarContentType,
  verifyBrandAvatarPublicUrl,
  type BrandAvatarAssetInput,
  type BrandAvatarMimeType,
} from "../utils/brandAvatarRules";

export const BRAND_AVATARS_BUCKET = "brand_avatars";

export interface BrandAvatarUploadResult {
  publicUrl: string;
  storagePath: string;
  contentType: BrandAvatarMimeType;
}

export interface BrandAvatarUploadOptions {
  /** When provided, the previously-persisted public URL is parsed for its
   * storage path and best-effort removed after the new upload verifies. */
  previousPublicUrl?: string | null;
}

export const uploadBrandAvatar = async (
  brandId: string,
  input: BrandAvatarAssetInput,
  options: BrandAvatarUploadOptions = {},
): Promise<BrandAvatarUploadResult> => {
  // 1. Validate content type.
  const contentType = resolveBrandAvatarContentType(input);
  if (contentType === null) {
    throw new BrandAvatarError(
      "unsupported_type",
      "Choose a JPEG, PNG, or WebP photo.",
    );
  }

  // 2. Pre-read size guard. Reject oversize files via the picker's
  //    `asset.fileSize` BEFORE the byte read (avoid blocking the JS thread
  //    on a read we'd reject anyway).
  if (
    typeof input.fileSize === "number" &&
    input.fileSize > BRAND_AVATAR_MAX_BYTES
  ) {
    throw new BrandAvatarError(
      "file_too_large",
      "That file is too large — pick one under 5 MB.",
    );
  }

  // 3. Read bytes (RN-iOS-safe via expo-file-system).
  const { bytes, byteLength } = await readBrandAvatarFileBytes(input.uri);

  // 4. Post-read size guards.
  if (byteLength <= 0) {
    throw new BrandAvatarError(
      "empty_local_file",
      "We couldn't read that file. Try another.",
    );
  }
  if (byteLength > BRAND_AVATAR_MAX_BYTES) {
    throw new BrandAvatarError(
      "file_too_large",
      "That file is too large — pick one under 5 MB.",
    );
  }

  // 5. Rotate storage path token per upload — public URL string changes
  //    per pick so native image caches cannot serve stale bytes.
  const pathToken = generateBrandAvatarPathToken();
  const storagePath = brandAvatarStoragePath(brandId, contentType, pathToken);

  // 6. Direct Supabase Storage upload. RLS on `brand_avatars` gates writes
  //    to brand_admin+ via split_part(name, '/', 1)::uuid. No edge fn.
  const { error: uploadError } = await supabase.storage
    .from(BRAND_AVATARS_BUCKET)
    .upload(storagePath, bytes, {
      contentType,
      upsert: true,
    });
  if (uploadError !== null) {
    throw new BrandAvatarError(
      "upload_failed",
      "Couldn't upload photo. Tap to try again.",
    );
  }

  const { data } = supabase.storage
    .from(BRAND_AVATARS_BUCKET)
    .getPublicUrl(storagePath);

  // 7. Verify the URL actually serves bytes (HEAD/Range probe).
  await verifyBrandAvatarPublicUrl(data.publicUrl);

  // 8. Best-effort orphan cleanup of the prior path. Never fail the
  //    upload on cleanup error.
  const previousPath = extractBrandAvatarStoragePath(
    options.previousPublicUrl ?? null,
  );
  if (previousPath !== null && previousPath !== storagePath) {
    try {
      await supabase.storage
        .from(BRAND_AVATARS_BUCKET)
        .remove([previousPath]);
    } catch {
      // ignore — orphan cleanup is non-blocking
    }
  }

  return {
    publicUrl: data.publicUrl,
    storagePath,
    contentType,
  };
};
