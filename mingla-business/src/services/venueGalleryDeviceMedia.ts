/**
 * venueGalleryDeviceMedia (WEB) — ORCH-1300 [web gallery picker].
 *
 * The venue gallery ("Add photos") opens the device photo library with
 * MULTI-SELECT, capped at the remaining slots. On native that's
 * expo-image-picker (the `.native` split). On WEB the OS/Expo image picker does
 * not exist — before ORCH-1300 the gallery reached the permanent-cancel
 * `platformImagePicker.ts` STUB (`{ canceled: true }`), so "Add photos" was a
 * silent dead tap (Constitution #1 + #3).
 *
 * This web variant mirrors EXACTLY what ORCH-1097 did for the hero cover
 * (`coverPickerDeviceMedia.ts`): it routes through the shared, CI-guarded
 * browser file input `pickBrowserFiles` (`<input type=file multiple
 * accept="image/*">`). Multi-select is enabled and hard-capped at
 * `remainingSlots` via `maxFiles`. Validation is DEFERRED to
 * `venueGalleryService` (which vets type + size and accepts HEIC/HEIF whose
 * browser MIME is unreliable) — same posture as native, which returns raw
 * assets for the service to vet. The returned `uri` is a browser object URL that
 * the web `readBrandAvatarFileBytes` (`fetch(uri).arrayBuffer()`) already reads,
 * so the existing `uploadGalleryPhoto` path works unchanged.
 */

import { pickBrowserFiles } from "../utils/browserFilePicker";

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
 * Open the browser file picker with multi-select, capped at `remainingSlots`.
 * Resolves `{ canceled: true, assets: [] }` on a genuine empty selection and
 * THROWS (BrowserFilePickerError) when the picker is unavailable — the caller
 * converts that into a non-silent VenueGalleryError.
 */
export async function launchGalleryImagePicker(
  remainingSlots: number,
): Promise<GalleryDeviceMediaResult> {
  const result = await pickBrowserFiles({
    accept: "image/*",
    multiple: true,
    maxFiles: remainingSlots,
    // Defer type/size validation to venueGalleryService (HEIC-aware); native
    // likewise returns raw assets for the service to vet.
    validate: false,
  });
  return {
    canceled: result.canceled,
    assets: result.files.map((file) => ({
      uri: file.uri,
      mimeType: file.mimeType,
      fileName: file.name,
      fileSize: file.size,
    })),
  };
}
