import * as DocumentPicker from "expo-document-picker";
import {
  launchImageLibraryAsync,
  type PlatformImagePickerAsset,
  requestMediaLibraryPermissionsAsync,
} from "../../utils/platformImagePicker";

// D-0: shared picker types and the permission error come only from the Shared
// module. On iOS and Android the platform-neutral picker specifier resolves
// back to this very file, so importing through it yields undefined.
import {
  AriAttachmentPickerPermissionError,
  type AriAttachmentSource,
  type AriPickedFile,
} from "./ariAttachmentPickerShared";

const DOCUMENT_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
  "application/csv",
];

/** expo-image-picker assets carry pixel dimensions the shared wrapper type omits. */
type PhotoAsset = PlatformImagePickerAsset & {
  width?: number | null;
  height?: number | null;
};

export async function pickAriAttachmentFiles(
  source: AriAttachmentSource,
  remaining: number,
): Promise<AriPickedFile[]> {
  if (source === "photos") {
    const permission = await requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new AriAttachmentPickerPermissionError(
        permission.canAskAgain !== true,
      );
    }
    const result = await launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
    });
    if (result.canceled) return [];
    return result.assets.slice(0, remaining).map((asset: PhotoAsset) => ({
      uri: asset.uri,
      name: asset.fileName ?? `image-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? null,
      size: typeof asset.fileSize === "number" && asset.fileSize > 0 ? asset.fileSize : null,
      width: asset.width ?? null,
      height: asset.height ?? null,
    }));
  }

  const result = await DocumentPicker.getDocumentAsync({
    type: DOCUMENT_MIMES,
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, remaining).map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? null,
    size: typeof asset.size === "number" && asset.size > 0 ? asset.size : null,
  }));
}
