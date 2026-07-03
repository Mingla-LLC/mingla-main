/**
 * ORCH-1282 [marketing SMS wave 2] — MMS photo upload service.
 *
 * Uploads a single picked image to the EXISTING public `brand_covers` bucket
 * under `${brandId}/marketing-mms/${token}.${ext}`, then returns the VERIFIED
 * public URL to store in `channel_payload.media_urls` and hand to Twilio's
 * `MediaUrl` param.
 *
 * Why brand_covers (no new bucket / policy / migration):
 *   - The bucket has an anonymous public-read policy (`brand_covers_public_read`,
 *     migration 20260529000000), so a third-party fetcher (Twilio, server-side)
 *     can fetch the object — the exact guarantee MMS needs.
 *   - Bucket write RLS is keyed on `split_part(name,'/',1) = brandId`, so the
 *     `${brandId}/marketing-mms/…` prefix inherits the brand-admin write gate.
 *
 * A thin mirror of `experienceStopImageService.uploadExperienceStopImage`
 * (size guard → byte read → upload → verify) with STRICTER, carrier-honest MMS
 * limits: JPEG / PNG / GIF only, ≤ 5 MB. `webp` is dropped because carrier /
 * handset MMS support for it is inconsistent. `verifyBrandCoverPublicUrl` proves
 * reachability before the URL is ever written into a payload
 * (I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE).
 */

import { supabase } from "./supabase";
import { readBrandCoverFileBytes } from "./brandCoverFileReader";
import { BRAND_COVERS_BUCKET } from "./brandCoverService";
import {
  BrandCoverError,
  generateBrandCoverPathToken,
  resolveBrandCoverContentType,
  verifyBrandCoverPublicUrl,
  type BrandCoverAssetInput,
  type BrandCoverMimeType,
} from "../utils/brandCoverRules";

// Twilio reliably fetches ≤ 5 MB MMS media; anything larger risks a fetch
// failure at send time. Stricter than the 8 MB brand-cover cap on purpose.
export const MMS_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// MMS-safe still-image types. `image/webp` is intentionally excluded (carrier /
// handset MMS support is inconsistent); GIF is allowed (rides as a still).
const MMS_ALLOWED_MIME_TYPES: ReadonlySet<BrandCoverMimeType> = new Set<
  BrandCoverMimeType
>(["image/jpeg", "image/png", "image/gif"]);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

/**
 * Upload one MMS photo. Returns the VERIFIED public URL to persist in
 * `channel_payload.media_urls`. Throws `BrandCoverError` with user-friendly copy
 * on any failure (Constitution #3 — no silent failures). No local `file://` /
 * blob URI is ever returned — only the verified public URL.
 */
export const uploadMarketingMmsImage = async (
  brandId: string,
  input: BrandCoverAssetInput,
): Promise<string> => {
  const contentType = resolveBrandCoverContentType(input);
  if (contentType === null || !MMS_ALLOWED_MIME_TYPES.has(contentType)) {
    throw new BrandCoverError(
      "unsupported_type",
      "Add a JPEG, PNG, or GIF under 5 MB.",
    );
  }

  if (typeof input.fileSize === "number" && input.fileSize > MMS_MAX_BYTES) {
    throw new BrandCoverError(
      "file_too_large",
      "That photo is too large — pick one under 5 MB.",
    );
  }

  const { bytes, byteLength } = await readBrandCoverFileBytes(input.uri);
  if (byteLength <= 0) {
    throw new BrandCoverError(
      "empty_local_file",
      "We couldn't read that photo. Try another.",
    );
  }
  if (byteLength > MMS_MAX_BYTES) {
    throw new BrandCoverError(
      "file_too_large",
      "That photo is too large — pick one under 5 MB.",
    );
  }

  const token = generateBrandCoverPathToken();
  const ext = EXT_BY_MIME[contentType] ?? "jpg";
  const storagePath = `${brandId}/marketing-mms/${token}.${ext}`;

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

  // Prove Twilio can reach it (HEAD/GET) before it is written into any payload.
  await verifyBrandCoverPublicUrl(data.publicUrl);
  return data.publicUrl;
};
