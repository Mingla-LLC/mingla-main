import * as DocumentPicker from "expo-document-picker";
import {
  launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync,
} from "../../utils/platformImagePicker";

import {
  AriAttachmentPickerPermissionError,
  type
  AriAttachmentSource,
  AriPickedFile,
} from "./ariAttachmentPicker";

const DOCUMENT_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
  "application/csv",
];

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
    return result.assets.slice(0, remaining).map((asset) => ({
      uri: asset.uri,
      name: asset.fileName ?? `image-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? null,
      size: asset.fileSize ?? 0,
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
    size: asset.size ?? 0,
  }));
}

export type { AriAttachmentSource, AriPickedFile };
