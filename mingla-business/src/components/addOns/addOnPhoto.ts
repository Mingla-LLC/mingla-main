/**
 * issue #3281 S3 — web add-on photo: pick one file, then make the two JPEGs in
 * a canvas. Browsers hand back JPEG, PNG or WebP here (the native file owns
 * HEIC). `imageOrientation: "from-image"` keeps phone photos upright.
 */
import {
  pickBrowserFiles,
  revokeBrowserPickedFiles,
} from "../../utils/browserFilePicker";
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

const toJpeg = (bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob> => {
  const size = fitLongEdge(bitmap.width, bitmap.height, edge);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (context === null) return Promise.reject(new AddOnPhotoError("add_on_photo_unreadable"));
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob !== null && blob.size > 0 ? resolve(blob) : reject(new AddOnPhotoError("add_on_photo_unreadable"))),
      "image/jpeg",
      quality,
    );
  });
};

export async function pickAddOnPhoto(): Promise<PreparedAddOnPhoto | null> {
  const result = await pickBrowserFiles({
    accept: "image/jpeg,image/png,image/webp",
    maxFiles: 1,
    multiple: false,
    validate: false,
  });
  if (result.canceled || result.files.length === 0) return null;
  const picked = result.files[0];
  try {
    if (
      !isAcceptedAddOnPhoto({ mimeType: picked.mimeType, name: picked.name }) ||
      picked.size <= 0 ||
      picked.size > ADD_ON_PHOTO_MAX_BYTES
    ) {
      throw new AddOnPhotoError("add_on_photo_invalid");
    }
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(picked.file, { imageOrientation: "from-image" });
    } catch {
      throw new AddOnPhotoError("add_on_photo_invalid");
    }
    try {
      const full = await toJpeg(bitmap, ADD_ON_PHOTO_FULL_EDGE, ADD_ON_PHOTO_FULL_QUALITY);
      const thumb = await toJpeg(bitmap, ADD_ON_PHOTO_THUMB_EDGE, ADD_ON_PHOTO_THUMB_QUALITY);
      return { full, thumb, previewUri: URL.createObjectURL(thumb) };
    } finally {
      bitmap.close();
    }
  } finally {
    revokeBrowserPickedFiles([picked]);
  }
}
