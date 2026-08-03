import { readBrandAvatarFileBytes } from "./brandAvatarFileReader";
import {
  pickGalleryPhotos,
  type GalleryPickAsset,
  VenueGalleryError,
} from "./venueGalleryService";
import { supabase } from "./supabase";
import type { StayMediaInput } from "../types/stayInventory";
import { generateBrandAvatarPathToken } from "../utils/brandAvatarRules";

const BUCKET = "brand_covers";
const MAX_BYTES = 10 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

function contentTypeFor(asset: GalleryPickAsset): string | null {
  const declared = (asset.mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (declared in EXTENSIONS) return declared;
  const extension = (asset.fileName ?? asset.uri)
    .split("?")[0]
    .split(".")
    .pop()
    ?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  return null;
}

export const pickStayOfferingPhotos = pickGalleryPhotos;

export function stayOfferingMediaUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function uploadStayOfferingPhoto(input: {
  brandId: string;
  venueId: string;
  asset: GalleryPickAsset;
  isCover: boolean;
  altText?: string;
}): Promise<StayMediaInput> {
  const contentType = contentTypeFor(input.asset);
  if (contentType === null) {
    throw new VenueGalleryError(
      "unsupported_type",
      "Choose a JPEG, PNG, WebP, HEIC, or HEIF photo.",
    );
  }
  if (
    typeof input.asset.fileSize === "number" &&
    input.asset.fileSize > MAX_BYTES
  ) {
    throw new VenueGalleryError(
      "file_too_large",
      "Each photo must be under 10 MB.",
    );
  }
  const { bytes, byteLength } = await readBrandAvatarFileBytes(input.asset.uri);
  if (byteLength < 1 || byteLength > MAX_BYTES) {
    throw new VenueGalleryError(
      byteLength < 1 ? "empty_local_file" : "file_too_large",
      byteLength < 1
        ? "We couldn’t read that photo."
        : "Each photo must be under 10 MB.",
    );
  }
  const token = generateBrandAvatarPathToken();
  const path = `${input.brandId}/stays/${input.venueId}/${token}.${EXTENSIONS[contentType]}`;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error !== null || !data?.id) {
    throw new VenueGalleryError(
      "upload_failed",
      "Couldn’t upload that photo. Try again.",
    );
  }
  return {
    storageObjectId: data.id,
    altText: input.altText?.trim() || undefined,
    isCover: input.isCover,
  };
}
