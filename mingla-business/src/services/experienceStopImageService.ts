/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 5 (design §6.1)
 *
 * experienceStopImageService — uploads experience stop photos to the
 * brand-keyed device-upload path, INDEPENDENT of any event row (stops are
 * authored before the experience row exists, and stops are not event rows).
 *
 * Writes to the existing `brand_covers` bucket under
 *   `${brandId}/experience-stops/${token}.${ext}`
 * The bucket's RLS gates writes on `split_part(name, '/', 1) = brandId`
 * (the first path segment is the brand UUID), so this prefix inherits the
 * brand-admin write gate for free — and is reachable at author time (draft or
 * pre-publish), unlike the event-kind CoverTarget which requires an eventRowId.
 *
 * Reuses the proven brandCoverService upload mechanics (size guard → byte read →
 * upload → verify) with the new key prefix.
 */

import { supabase } from "./supabase";
import { readBrandCoverFileBytes } from "./brandCoverFileReader";
import { BRAND_COVERS_BUCKET } from "./brandCoverService";
import {
  BRAND_COVER_MAX_BYTES,
  BrandCoverError,
  generateBrandCoverPathToken,
  resolveBrandCoverContentType,
  verifyBrandCoverPublicUrl,
  type BrandCoverAssetInput,
} from "../utils/brandCoverRules";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Upload a single stop photo. Returns the verified public URL to store in
 * `experience_stops.image_urls`. Throws BrandCoverError with user-friendly
 * copy on any failure (Constitution #3 — no silent failures).
 */
export const uploadExperienceStopImage = async (
  brandId: string,
  input: BrandCoverAssetInput,
): Promise<string> => {
  const contentType = resolveBrandCoverContentType(input);
  if (contentType === null) {
    throw new BrandCoverError(
      "unsupported_type",
      "Choose a JPEG, PNG, WebP, or GIF.",
    );
  }

  if (
    typeof input.fileSize === "number" &&
    input.fileSize > BRAND_COVER_MAX_BYTES
  ) {
    throw new BrandCoverError(
      "file_too_large",
      "That photo is too large — pick one under 8 MB.",
    );
  }

  const { bytes, byteLength } = await readBrandCoverFileBytes(input.uri);
  if (byteLength <= 0) {
    throw new BrandCoverError(
      "empty_local_file",
      "We couldn't read that photo. Try another.",
    );
  }
  if (byteLength > BRAND_COVER_MAX_BYTES) {
    throw new BrandCoverError(
      "file_too_large",
      "That photo is too large — pick one under 8 MB.",
    );
  }

  const token = generateBrandCoverPathToken();
  const ext = EXT_BY_MIME[contentType] ?? "jpg";
  const storagePath = `${brandId}/experience-stops/${token}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BRAND_COVERS_BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: true });

  if (uploadError !== null) {
    throw new BrandCoverError(
      "upload_failed",
      "Couldn't upload that photo. Tap to retry.",
    );
  }

  const { data } = supabase.storage
    .from(BRAND_COVERS_BUCKET)
    .getPublicUrl(storagePath);

  await verifyBrandCoverPublicUrl(data.publicUrl);
  return data.publicUrl;
};
