/**
 * venueGalleryService — META-ORCH-1009 Sub-E venue photo gallery.
 *
 * A self-listed/claimed venue must add 5–20 gallery photos (in addition to the
 * hero). This service:
 *   1. Opens the photo library with MULTI-SELECT (pick many at once, capped at the
 *      remaining slots) — `expo-image-picker`.
 *   2. Uploads each picked image to the existing `brand_covers` storage bucket at
 *      `{brandId}/gallery/{token}.{ext}` (its RLS gates writes by the first path
 *      segment = the brand the caller admins; public read serves them). Reuses the
 *      proven brand-avatar byte-reader + content-type + size-guard helpers — no
 *      new upload primitive.
 *   3. The resulting public URLs are persisted server-side via the
 *      `sync_gallery` pipeline action (see businessPlaceAuthoringService).
 *
 * Photos only (the hero may be a video; the gallery is images). No manipulator
 * dependency — we lean on the picker's `quality` + a 10 MB guard, same posture as
 * brandAvatarService (operator chose no manipulator dep, ORCH-0807).
 */

import * as ImagePicker from "expo-image-picker";

import { supabase } from "./supabase";
import { readBrandAvatarFileBytes } from "./brandAvatarFileReader";
import { generateBrandAvatarPathToken } from "../utils/brandAvatarRules";

export const VENUE_GALLERY_BUCKET = "brand_covers";
export const VENUE_GALLERY_MAX_BYTES = 10 * 1024 * 1024;

// META-ORCH-1009 Sub-F: the gallery accepts HEIC/HEIF too — iPhone's default photo
// format. (The brand-avatar resolver is JPEG/PNG/WEBP only because that flow uses
// an editing crop that re-encodes; multi-select gallery picks deliver originals,
// which on iOS are HEIC.) Gemini vision + iOS rendering both handle HEIC.
type GalleryMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/heif";
const EXT_BY_MIME: Record<GalleryMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};
const MIME_BY_EXT: Record<string, GalleryMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};
function resolveGalleryContentType(asset: {
  mimeType?: string | null;
  fileName?: string | null;
  uri?: string | null;
}): GalleryMime | null {
  const m = (asset.mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (m in EXT_BY_MIME) return m as GalleryMime;
  const name = asset.fileName ?? asset.uri ?? "";
  const ext = name.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? null;
}

export class VenueGalleryError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "VenueGalleryError";
  }
}

export interface GalleryPickAsset {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}

/**
 * Open the library with multi-select, capped at `remainingSlots` so the operator
 * can never exceed the max. Returns [] when cancelled.
 */
export async function pickGalleryPhotos(
  remainingSlots: number,
): Promise<GalleryPickAsset[]> {
  if (remainingSlots <= 0) return [];
  let result: ImagePicker.ImagePickerResult;
  try {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remainingSlots,
      quality: 0.7,
    });
  } catch {
    throw new VenueGalleryError("picker_failed", "Couldn't open photos. Try again.");
  }
  if (result.canceled) return [];
  return result.assets.map((a) => ({
    uri: a.uri,
    mimeType: a.mimeType ?? null,
    fileName: a.fileName ?? null,
    fileSize: a.fileSize ?? null,
  }));
}

/**
 * Upload one picked image to the gallery path and return its public URL.
 * Throws VenueGalleryError on unsupported type / too large / read / upload fail.
 */
export async function uploadGalleryPhoto(
  brandId: string,
  asset: GalleryPickAsset,
): Promise<string> {
  const contentType = resolveGalleryContentType(asset);
  if (contentType === null) {
    throw new VenueGalleryError(
      "unsupported_type",
      "That file isn't a photo we can use. Try a different image.",
    );
  }
  if (typeof asset.fileSize === "number" && asset.fileSize > VENUE_GALLERY_MAX_BYTES) {
    throw new VenueGalleryError("file_too_large", "Each photo must be under 10 MB.");
  }

  const { bytes, byteLength } = await readBrandAvatarFileBytes(asset.uri);
  if (byteLength <= 0) {
    throw new VenueGalleryError("empty_local_file", "We couldn't read that photo.");
  }
  if (byteLength > VENUE_GALLERY_MAX_BYTES) {
    throw new VenueGalleryError("file_too_large", "Each photo must be under 10 MB.");
  }

  const path = `${brandId}/gallery/${generateBrandAvatarPathToken()}.${EXT_BY_MIME[contentType]}`;
  const { error } = await supabase.storage
    .from(VENUE_GALLERY_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error !== null) {
    throw new VenueGalleryError("upload_failed", "Couldn't upload photo. Try again.");
  }
  const { data } = supabase.storage.from(VENUE_GALLERY_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
