import { pickBrowserFiles } from "../../utils/browserFilePicker";
import type { BrandGroupFileSource, BrandGroupPickedFile, BrandGroupPickOptions } from "./brandGroupFilePickerShared";

const ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif,.gif,.mp4,.mov,.webm,.mp3,.m4a,.wav,.pdf,.docx,.xlsx,.txt,.csv,image/*,video/*,audio/*";
// #4255 rework (P4): the Photos and Camera buttons of an images-only picker
// (Mingla team) accept pictures alone on the web too.
export const IMAGE_ONLY_ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,image/*";
const IMAGE_NAME = /\.(jpe?g|png|webp|gif|heic|heif)$/i;

/** The accept string for one picker button. */
export function brandGroupPickAccept(source: BrandGroupFileSource, options: BrandGroupPickOptions = {}): string {
  if (source !== "files" && options.imagesOnly) return IMAGE_ONLY_ACCEPT;
  return options.accept ?? ACCEPT;
}

/** A browser's "All files" choice can still hand back a document: keep pictures only. */
export function isPickedImage(file: { name: string; mimeType?: string | null }): boolean {
  const mime = String(file.mimeType ?? "").toLowerCase();
  if (mime) return mime.startsWith("image/");
  return IMAGE_NAME.test(file.name);
}

export async function pickBrandGroupFiles(
  source: BrandGroupFileSource,
  remaining: number,
  options: BrandGroupPickOptions = {},
): Promise<BrandGroupPickedFile[]> {
  const result = await pickBrowserFiles({
    accept: brandGroupPickAccept(source, options),
    multiple: source !== "camera",
    capture: source === "camera" ? "environment" : false,
    maxFiles: source === "camera" ? 1 : remaining,
    validate: false,
  });
  if (result.canceled) return [];
  const imagesOnly = source !== "files" && options.imagesOnly === true;
  return result.files.filter((file) => !imagesOnly || isPickedImage(file)).map((file) => ({
    uri: file.uri,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    webFile: file.file,
  }));
}
