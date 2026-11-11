import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
  requestMediaLibraryPermissionsAsync,
  type PlatformImagePickerAsset,
} from "../../utils/platformImagePicker";
import {
  BrandGroupFilePermissionError,
  type BrandGroupFileSource,
  type BrandGroupPickOptions,
  type BrandGroupPickedFile,
} from "./brandGroupFilePickerShared";
import { shrinkBrandGroupPickedFile, type BrandGroupShrinkCandidate } from "./brandGroupImageShrink";

const DOCUMENT_MIMES = [
  "image/*", "video/*", "audio/*", "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/csv", "application/csv",
];

function fromMedia(asset: PlatformImagePickerAsset): BrandGroupShrinkCandidate {
  const fallbackExtension = asset.type === "video" ? "mp4" : "jpg";
  return {
    uri: asset.uri,
    name: asset.fileName || `mingla-${Date.now()}.${fallbackExtension}`,
    mimeType: asset.mimeType ?? null,
    size: typeof asset.fileSize === "number" ? asset.fileSize : null,
    width: typeof asset.width === "number" ? asset.width : null,
    height: typeof asset.height === "number" ? asset.height : null,
  };
}

/** #4304 — camera and library photos are shrunk before upload; videos are not. */
async function fromMediaShrunk(assets: PlatformImagePickerAsset[]): Promise<BrandGroupPickedFile[]> {
  const files: BrandGroupPickedFile[] = [];
  for (const asset of assets) {
    const candidate = fromMedia(asset);
    files.push(asset.type === "video" ? { uri: candidate.uri, name: candidate.name, mimeType: candidate.mimeType, size: candidate.size } : await shrinkBrandGroupPickedFile(candidate));
  }
  return files;
}

export async function pickBrandGroupFiles(source: BrandGroupFileSource, remaining: number, options: BrandGroupPickOptions = {}): Promise<BrandGroupPickedFile[]> {
  const mediaTypes: ("images" | "videos")[] = options.imagesOnly ? ["images"] : ["images", "videos"];
  if (source === "camera") {
    const permission = await requestCameraPermissionsAsync();
    if (!permission.granted) throw new BrandGroupFilePermissionError("camera");
    const result = await launchCameraAsync({ mediaTypes, quality: 1 });
    return result.canceled ? [] : fromMediaShrunk(result.assets.slice(0, 1));
  }
  if (source === "photos") {
    const permission = await requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new BrandGroupFilePermissionError("photos");
    const result = await launchImageLibraryAsync({
      mediaTypes, allowsMultipleSelection: true, selectionLimit: remaining, quality: 1,
    });
    return result.canceled ? [] : fromMediaShrunk(result.assets.slice(0, remaining));
  }
  const DocumentPicker = await import("expo-document-picker");
  const result = await DocumentPicker.getDocumentAsync({ type: options.documentMimes ? [...options.documentMimes] : DOCUMENT_MIMES, multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  return result.assets.slice(0, remaining).map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? null,
    size: typeof asset.size === "number" ? asset.size : null,
  }));
}
