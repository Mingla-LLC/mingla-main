import { pickBrowserFiles } from "../../utils/browserFilePicker";

export type AriAttachmentSource = "all" | "photos" | "documents";

export interface AriPickedFile {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number;
  webFile?: File;
}

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
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
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
