/**
 * venueGalleryDeviceMedia (NATIVE) — ORCH-1300 [web gallery picker].
 *
 * The native split preserves the EXACT pre-ORCH-1300 gallery behavior: it opens
 * the real device photo library with multi-select via `expo-image-picker`
 * (resolved through `platformImagePicker.native.ts`), capped at the remaining
 * slots. ORCH-1300 changed ONLY the web path (see the sibling `.ts`); native
 * picker behavior is untouched — same options, same picker, same result shape.
 */

import { launchImageLibraryAsync } from "../utils/platformImagePicker";

export type GalleryDeviceMediaAsset = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
};

export type GalleryDeviceMediaResult = {
  canceled: boolean;
  assets: GalleryDeviceMediaAsset[];
};

/**
 * Open the native photo library with multi-select, capped at `remainingSlots`.
 * Byte-for-byte the options the gallery used before ORCH-1300.
 */
export async function launchGalleryImagePicker(
  remainingSlots: number,
): Promise<GalleryDeviceMediaResult> {
  const result = await launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: remainingSlots,
    quality: 0.7,
  });
  return {
    canceled: result.canceled,
    assets: result.assets.map((asset) => ({
      uri: asset.uri,
      mimeType: asset.mimeType ?? null,
      fileName: asset.fileName ?? null,
      fileSize: asset.fileSize ?? null,
    })),
  };
}
