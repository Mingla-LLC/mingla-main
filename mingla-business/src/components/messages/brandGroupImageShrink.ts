/**
 * #4304 — media speed (A), web. Browser uploads are not shrunk: the web
 * manipulator decodes through a canvas, which cannot read HEIC and drops
 * EXIF orientation handling to the browser, so a re-encode here could rotate
 * or fail photos that upload fine today. The native file does the shrink.
 */
import type { BrandGroupPickedFile } from "./brandGroupFilePickerShared";

export interface BrandGroupShrinkCandidate extends BrandGroupPickedFile {
  width?: number | null;
  height?: number | null;
}

export async function shrinkBrandGroupPickedFile(file: BrandGroupShrinkCandidate): Promise<BrandGroupPickedFile> {
  return { uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size, webFile: file.webFile };
}
