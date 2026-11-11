/**
 * #4382 Wave 4 — pick support screenshots in the browser (Host web). The
 * native build uses supportImagePicker.native.ts.
 */
import { pickBrowserFiles } from "../../utils/browserFilePicker";
import type { SupportPickedImage } from "./supportRequestModel";

export class SupportPhotoAccessError extends Error {
  constructor() {
    super("Photo access is off.");
    this.name = "SupportPhotoAccessError";
  }
}

export async function pickSupportImages(remaining: number): Promise<SupportPickedImage[]> {
  if (remaining <= 0) return [];
  const result = await pickBrowserFiles({
    accept: "image/png,image/jpeg,image/webp,image/heic,.png,.jpg,.jpeg,.webp,.heic",
    multiple: true,
    maxFiles: remaining,
    validate: false,
  });
  if (result.canceled) return [];
  return result.files.slice(0, remaining).map((file) => ({
    uri: file.uri,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    webFile: file.file,
  }));
}
