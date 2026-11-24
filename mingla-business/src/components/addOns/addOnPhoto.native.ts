/**
 * issue #3281 S3 — native add-on photo: pick one photo, then make the two
 * JPEGs on the device. expo-image-manipulator decodes HEIC/HEIF on iOS, so
 * the resize is also the HEIC-to-JPEG step. Expo modules are imported at use,
 * never at module scope (ORCH-1296 class).
 */
import type * as ImageManipulatorTypes from "expo-image-manipulator";

import { readBrandCoverFileBytes } from "../../services/brandCoverFileReader";
import {
  launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync,
} from "../../utils/platformImagePicker";
import {
  ADD_ON_PHOTO_FULL_EDGE,
  ADD_ON_PHOTO_FULL_QUALITY,
  ADD_ON_PHOTO_MAX_BYTES,
  ADD_ON_PHOTO_THUMB_EDGE,
  ADD_ON_PHOTO_THUMB_QUALITY,
  AddOnPhotoError,
  fitLongEdge,
  isAcceptedAddOnPhoto,
  type PreparedAddOnPhoto,
} from "./addOnPhotoRules";

function release(target: { release?: () => void } | null): void {
  try {
    target?.release?.();
  } catch {
    // Already released by the runtime.
  }
}

export async function pickAddOnPhoto(): Promise<PreparedAddOnPhoto | null> {
  const permission = await requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new AddOnPhotoError("add_on_photo_permission");
  const result = await launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    allowsMultipleSelection: false,
    quality: 1,
  });
  if (result.canceled || result.assets === null || result.assets.length === 0) return null;
  const asset = result.assets[0];
  if (
    !isAcceptedAddOnPhoto({ mimeType: asset.mimeType, name: asset.fileName, uri: asset.uri }) ||
    (typeof asset.fileSize === "number" && asset.fileSize > ADD_ON_PHOTO_MAX_BYTES)
  ) {
    throw new AddOnPhotoError("add_on_photo_invalid");
  }

  let context: ImageManipulatorTypes.ImageManipulatorContext | null = null;
  let rendered: ImageManipulatorTypes.ImageRef | null = null;
  try {
    const Manipulator = await import("expo-image-manipulator");
    context = Manipulator.ImageManipulator.manipulate(asset.uri);
    rendered = await context.renderAsync();
    const sourceWidth = rendered.width;
    const sourceHeight = rendered.height;
    const make = async (edge: number, quality: number): Promise<{ uri: string; bytes: Uint8Array }> => {
      release(rendered);
      rendered = await (context as ImageManipulatorTypes.ImageManipulatorContext)
        .reset()
        .resize(fitLongEdge(sourceWidth, sourceHeight, edge))
        .renderAsync();
      const saved = await rendered.saveAsync({
        format: Manipulator.SaveFormat.JPEG,
        compress: quality,
      });
      const { bytes, byteLength } = await readBrandCoverFileBytes(saved.uri);
      if (byteLength <= 0) throw new AddOnPhotoError("add_on_photo_unreadable");
      return { uri: saved.uri, bytes };
    };
    const full = await make(ADD_ON_PHOTO_FULL_EDGE, ADD_ON_PHOTO_FULL_QUALITY);
    const thumb = await make(ADD_ON_PHOTO_THUMB_EDGE, ADD_ON_PHOTO_THUMB_QUALITY);
    return { full: full.bytes, thumb: thumb.bytes, previewUri: thumb.uri };
  } catch (cause) {
    if (cause instanceof AddOnPhotoError) throw cause;
    throw new AddOnPhotoError("add_on_photo_unreadable");
  } finally {
    release(rendered);
    release(context);
  }
}
