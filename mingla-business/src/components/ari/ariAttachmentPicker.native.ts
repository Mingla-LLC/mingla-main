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

  // #3429 P0 follow-up — ORCH-1296 class. `expo-document-picker` evaluates
  // `expo-modules-core`'s EventEmitter against a native global at IMPORT time,
  // so a module-scope import here made merely importing the picker fatal
  // anywhere the native module is not registered — it killed all six of
  // #1486's dormant AriChatScreen render tests. Resolve it when a person
  // actually opens the file picker, exactly as ariAttachmentFileReader.native
  // does for expo-file-system.
  const DocumentPicker = await import("expo-document-picker");
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
