import { pickBrowserFiles } from "../../utils/browserFilePicker";
import type { BrandGroupFileSource, BrandGroupPickedFile } from "./brandGroupFilePickerShared";

const ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif,.gif,.mp4,.mov,.webm,.mp3,.m4a,.wav,.pdf,.docx,.xlsx,.txt,.csv,image/*,video/*,audio/*";

export async function pickBrandGroupFiles(
  source: BrandGroupFileSource,
  remaining: number,
): Promise<BrandGroupPickedFile[]> {
  const result = await pickBrowserFiles({
    accept: ACCEPT,
    multiple: source !== "camera",
    capture: source === "camera" ? "environment" : false,
    maxFiles: source === "camera" ? 1 : remaining,
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
