/**
 * Issue #3429 REWORK-1 (D-5) — Business web Ari image preparation.
 *
 * Browser-only, zero-cost: decode with `createImageBitmap` (EXIF orientation
 * applied), falling back to `HTMLImageElement.decode()`, then draw into a
 * canvas no larger than the target and re-encode. PNG and WebP sources try
 * WebP (keeps transparency) and fall back to JPEG on a white ground where the
 * browser cannot encode WebP (Safari). A browser that cannot decode HEIC gets
 * `HEIC_NOT_SUPPORTED_IN_BROWSER` and nothing is uploaded.
 */

import {
  AriImagePreparationError,
  type AriImagePreparationInput,
  type AriPreparedImage,
  ariPreparedDimensions,
  ariPreparedName,
  planAriImagePreparation,
} from "./ariImagePreparation";

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeInBrowser(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through to the image element, which some browsers decode more
      // formats with; if it also fails the caller maps the failure.
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
  } catch (error: unknown) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function prepareAriImage(
  input: AriImagePreparationInput & { uri: string; webFile?: File },
): Promise<AriPreparedImage> {
  const plan = planAriImagePreparation(input);
  if (plan === null) throw new AriImagePreparationError("IMAGE_UNREADABLE");
  if (plan.kind === "refuse") throw new AriImagePreparationError(plan.code);
  if (!input.webFile) throw new AriImagePreparationError("IMAGE_UNREADABLE");

  let decoded: DecodedImage;
  try {
    decoded = await decodeInBrowser(input.webFile);
  } catch {
    throw new AriImagePreparationError(
      plan.source === "heic" ? "HEIC_NOT_SUPPORTED_IN_BROWSER" : "IMAGE_UNREADABLE",
    );
  }
  try {
    if (decoded.width < 1 || decoded.height < 1) {
      throw new AriImagePreparationError("IMAGE_UNREADABLE");
    }
    if (decoded.width * decoded.height > 120_000_000) {
      throw new AriImagePreparationError("IMAGE_SOURCE_TOO_LARGE");
    }
    const target = ariPreparedDimensions(decoded.width, decoded.height);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) throw new AriImagePreparationError("IMAGE_UNREADABLE");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    let blob: Blob | null = null;
    let format = plan.format;
    if (plan.format === "webp") {
      context.clearRect(0, 0, target.width, target.height);
      context.drawImage(decoded.source, 0, 0, target.width, target.height);
      const webp = await canvasToBlob(canvas, "image/webp", plan.compress);
      if (webp && webp.type === "image/webp") blob = webp;
      else format = "jpeg";
    }
    if (blob === null) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, target.width, target.height);
      context.drawImage(decoded.source, 0, 0, target.width, target.height);
      const jpeg = await canvasToBlob(canvas, "image/jpeg", plan.compress);
      if (!jpeg || jpeg.type !== "image/jpeg") {
        throw new AriImagePreparationError("IMAGE_UNREADABLE");
      }
      blob = jpeg;
    }
    const mimeType = format === "webp" ? "image/webp" as const : "image/jpeg" as const;
    const name = ariPreparedName(input.name, format);
    const webFile = new File([blob], name, { type: mimeType });
    return {
      uri: URL.createObjectURL(webFile),
      name,
      mimeType,
      sizeBytes: webFile.size,
      width: target.width,
      height: target.height,
      webFile,
    };
  } finally {
    decoded.release();
  }
}
