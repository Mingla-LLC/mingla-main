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
  type BrandGroupPickedFile,
} from "./brandGroupFilePickerShared";

const DOCUMENT_MIMES = [
  "image/*", "video/*", "audio/*", "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/csv", "application/csv",
];

function fromMedia(asset: PlatformImagePickerAsset): BrandGroupPickedFile {
  const fallbackExtension = asset.type === "video" ? "mp4" : "jpg";
  return {
    uri: asset.uri,
    name: asset.fileName || `mingla-${Date.now()}.${fallbackExtension}`,
    mimeType: asset.mimeType ?? null,
    size: typeof asset.fileSize === "number" ? asset.fileSize : null,
  };
}

export async function pickBrandGroupFiles(source: BrandGroupFileSource, remaining: number): Promise<BrandGroupPickedFile[]> {
  if (source === "camera") {
    const permission = await requestCameraPermissionsAsync();
    if (!permission.granted) throw new BrandGroupFilePermissionError("camera");
    const result = await launchCameraAsync({ mediaTypes: ["images", "videos"], quality: 1 });
    return result.canceled ? [] : result.assets.slice(0, 1).map(fromMedia);
  }
  if (source === "photos") {
    const permission = await requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new BrandGroupFilePermissionError("photos");
    const result = await launchImageLibraryAsync({
      mediaTypes: ["images", "videos"], allowsMultipleSelection: true, selectionLimit: remaining, quality: 1,
    });
    return result.canceled ? [] : result.assets.slice(0, remaining).map(fromMedia);
  }
  const DocumentPicker = await import("expo-document-picker");
  const result = await DocumentPicker.getDocumentAsync({ type: DOCUMENT_MIMES, multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  return result.assets.slice(0, remaining).map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? null,
    size: typeof asset.size === "number" ? asset.size : null,
  }));
}
