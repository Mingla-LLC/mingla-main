/**
 * ORCH-1119C [trip-day-media-gallery · HEIC fix]
 *
 * normalizeTripDayImage — convert an iOS HEIC/HEIF photo to JPEG on-device BEFORE
 * it is uploaded to the trip-day media gallery.
 *
 * WHY: iPhones shoot HEIC by default. The native picker returns
 * `mimeType:"image/heic"` (or a `.heic`/`.heif` URI/fileName). The upload service
 * (`tripDayMediaService.resolveTripDayMediaContentType`) HARD-REJECTS any explicit
 * but unsupported MIME (correctly — a renamed `.txt` must not slip through), so
 * every iPhone photo failed with "Choose a JPEG, PNG, WebP, GIF, MP4, MOV, or
 * WebM." and the day's gallery rendered nothing (uploadedCount:0). HEIC also does
 * not render on Android or the public web trip page. The fix Seth chose is to
 * transcode HEIC/HEIF -> JPEG client-side (the only option that renders on iOS +
 * Android + web).
 *
 * SCOPE (trips-only, native picker only):
 *   - HEIC / HEIF (by mimeType OR by `.heic`/`.heif` extension on the URI or
 *     fileName, case-insensitive) -> transcode to JPEG via expo-image-manipulator,
 *     return the new `.jpg` uri + `image/jpeg` mimeType + `.jpg` fileName.
 *   - Already-web-safe images (jpeg / png / webp) -> PASS THROUGH unchanged.
 *   - GIF -> PASS THROUGH unchanged (transcoding to JPEG would kill the animation).
 *   - Videos (mov / quicktime / mp4 / webm) -> PASS THROUGH unchanged.
 *   - Anything else -> PASS THROUGH unchanged (the upload service makes the final
 *     accept/reject decision; this helper ONLY converts HEIC/HEIF).
 *
 * The web picker (`pickBrowserFiles`) is NOT routed through here — browsers do not
 * hand back HEIC the same way, and `expo-image-manipulator` has no DOM path. This
 * helper is called only from `TripDayMediaSheet.pickFromLibrary`'s native branch.
 *
 * Trips-only. NOT shared with experiences/events/the cover pipeline (locked scope).
 */

import * as ImageManipulator from "expo-image-manipulator";

/** The asset shape handed to `uploadTripDayMedia` — a subset of an expo-image-picker asset. */
export interface NormalizableImageAsset {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
}

const cleanMime = (mime?: string | null): string =>
  typeof mime === "string" ? mime.trim().toLowerCase() : "";

/** True when the value (URI or fileName) ends with `.heic` or `.heif` (ignoring any query/hash). */
const hasHeicExtension = (value?: string | null): boolean => {
  if (typeof value !== "string") return false;
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
  return /\.hei[cf]$/i.test(withoutQuery.trim());
};

/**
 * Detect a HEIC/HEIF asset by explicit MIME OR by a `.heic`/`.heif` extension on
 * the URI or fileName (covers the `mimeType:null` picker case).
 */
export const isHeicAsset = (asset: NormalizableImageAsset): boolean => {
  const mime = cleanMime(asset.mimeType);
  if (mime === "image/heic" || mime === "image/heif") return true;
  return hasHeicExtension(asset.uri) || hasHeicExtension(asset.fileName);
};

/** Swap a fileName's extension for `.jpg` (or append it when there's no extension). */
const toJpegFileName = (fileName?: string | null): string => {
  if (typeof fileName !== "string" || fileName.trim().length === 0) {
    return "trip-day-photo.jpg";
  }
  const trimmed = fileName.trim();
  return trimmed.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
};

/**
 * Return an upload-ready asset. HEIC/HEIF inputs are transcoded to JPEG (new uri +
 * `image/jpeg` mime + `.jpg` fileName); everything else (jpeg/png/webp/gif/video)
 * is returned UNCHANGED. The post-conversion `fileSize` is unknown, so it is
 * dropped (the upload service re-reads the real byte length and enforces the cap).
 */
export const normalizeTripDayImage = async (
  asset: NormalizableImageAsset,
): Promise<NormalizableImageAsset> => {
  if (!isHeicAsset(asset)) {
    // jpeg / png / webp / GIF / video / unknown -> untouched. GIF must NOT be
    // converted (kills the animation); videos must NOT be converted.
    return asset;
  }

  const result = await ImageManipulator.manipulateAsync(asset.uri, [], {
    compress: 0.9,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return {
    ...asset,
    uri: result.uri,
    mimeType: "image/jpeg",
    fileName: toJpegFileName(asset.fileName),
    // The transcoded file's byte length is unknown here — drop the stale HEIC
    // size so the upload service measures the real JPEG bytes.
    fileSize: null,
    // Prefer the manipulator's reported dimensions when present.
    width: typeof result.width === "number" ? result.width : (asset.width ?? null),
    height:
      typeof result.height === "number" ? result.height : (asset.height ?? null),
  };
};
