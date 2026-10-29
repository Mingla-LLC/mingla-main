import { pickBrowserFiles } from "../../utils/browserFilePicker";
import type {
  AriAttachmentSource,
  AriPickedFile,
} from "./ariAttachmentPickerShared";

export const ARI_ATTACHMENT_ACCEPT = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".pdf",
  ".docx",
  ".txt",
  ".csv",
  ".mp3",
  ".m4a",
  ".wav",
  ".mp4",
  ".mov",
  ".webm",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "video/mp4",
  "video/quicktime",
  "video/webm",
].join(",");

export async function pickAriAttachmentFiles(
  _source: AriAttachmentSource,
  remaining: number,
): Promise<AriPickedFile[]> {
  const result = await pickBrowserFiles({
    accept: ARI_ATTACHMENT_ACCEPT,
    multiple: true,
    maxFiles: remaining,
    validate: false,
  });
  if (result.canceled) return [];
  return result.files.map((file) => ({
    uri: file.uri,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    webFile: file.file,
  }));
}
