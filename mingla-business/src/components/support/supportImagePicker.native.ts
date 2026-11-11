/**
 * #4382 Wave 4 — pick support screenshots on iOS and Android.
 *
 * expo-image-picker, expo-image-manipulator and expo-file-system already ship
 * in the Host app binary (brand group media uses all three), so this adds no
 * native module. Each one is loaded at use, never at module scope, so render
 * suites without the native module stay importable.
 */
import { shrinkBrandGroupPickedFile } from "../messages/brandGroupImageShrink";
import {
  launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync,
} from "../../utils/platformImagePicker";
import { getFileInfoAsync } from "../../utils/platformFileSystem";
import type { SupportPickedImage } from "./supportRequestModel";

export class SupportPhotoAccessError extends Error {
  constructor() {
    super("Photo access is off.");
    this.name = "SupportPhotoAccessError";
  }
}

export async function pickSupportImages(remaining: number): Promise<SupportPickedImage[]> {
  if (remaining <= 0) return [];
  const permission = await requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new SupportPhotoAccessError();
  const result = await launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: remaining,
    quality: 1,
    exif: false,
  });
  if (result.canceled) return [];
  const picked: SupportPickedImage[] = [];
  for (const asset of result.assets.slice(0, remaining)) {
    const shrunk = await shrinkBrandGroupPickedFile({
      uri: asset.uri,
      name: asset.fileName || `screenshot-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? null,
      size: typeof asset.fileSize === "number" ? asset.fileSize : null,
      width: typeof asset.width === "number" ? asset.width : null,
      height: typeof asset.height === "number" ? asset.height : null,
    });
    let size = shrunk.size;
    if (typeof size !== "number" || size <= 0) {
      const info = await getFileInfoAsync(shrunk.uri);
      size = typeof info.size === "number" && info.size > 0 ? info.size : null;
    }
    picked.push({
      uri: shrunk.uri,
      name: shrunk.name,
      mimeType: shrunk.mimeType,
      size,
      // A shrunk copy has new dimensions; only the original's are known.
      width: shrunk.uri === asset.uri && typeof asset.width === "number" ? asset.width : null,
      height: shrunk.uri === asset.uri && typeof asset.height === "number" ? asset.height : null,
    });
  }
  return picked;
}
