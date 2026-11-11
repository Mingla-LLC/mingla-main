// #4382 Wave 2 — the support uploader's rules, with no React in them.
//
// Every image is re-drawn on a canvas before upload. A canvas keeps only the
// pixels, so camera details and location (EXIF, XMP) are gone, and the longest
// side is capped at 2,560 px. The output is checked for leftover metadata and
// refused if any is found, so a browser that ever kept it cannot leak it.
//
// MINGLA-INVARIANT: I-4382-SUPPORT-UPLOAD-STRIPS-METADATA | issue #4382 | Admin support images are re-encoded through a canvas (longest side <= 2560 px) and refused if the result still carries EXIF/XMP metadata
// MINGLA-INVARIANT: I-4382-SUPPORT-UPLOAD-LIMITS | issue #4382 | At most 10 images per message, 10 MB each, png/jpeg/webp/heic only

export const SUPPORT_UPLOAD_LIMITS = Object.freeze({
  maxImages: 10,
  maxBytes: 10 * 1024 * 1024,
  maxSide: 2560,
  acceptedMimes: Object.freeze(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]),
});

export const ACCEPT_ATTRIBUTE = "image/png,image/jpeg,image/webp,image/heic,image/heif";

/** Why a file was refused, in plain words. */
export const SKIP_REASON = Object.freeze({
  type: "Images only (PNG, JPEG, WebP or HEIC).",
  size: "Each image must be 10 MB or less.",
  count: "Up to 10 images per message.",
});

function mimeOf(file) {
  const type = String(file?.type || "").toLowerCase();
  if (type) return type;
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".heic") || name.endsWith(".heif")) return "image/heic";
  return "";
}

/**
 * Which of `files` can join `existingCount` images already in the message.
 * Returns { accepted: File[], skipped: [{ name, reason }] }.
 */
export function planAddFiles(existingCount, files) {
  const accepted = [];
  const skipped = [];
  let count = Math.max(0, Number(existingCount) || 0);
  for (const file of Array.from(files || [])) {
    const name = file?.name || "pasted-image.png";
    if (!SUPPORT_UPLOAD_LIMITS.acceptedMimes.includes(mimeOf(file))) {
      skipped.push({ name, reason: SKIP_REASON.type });
    } else if (!(Number(file?.size) > 0) || file.size > SUPPORT_UPLOAD_LIMITS.maxBytes) {
      skipped.push({ name, reason: SKIP_REASON.size });
    } else if (count >= SUPPORT_UPLOAD_LIMITS.maxImages) {
      skipped.push({ name, reason: SKIP_REASON.count });
    } else {
      accepted.push(file);
      count += 1;
    }
  }
  return { accepted, skipped };
}

/** One line telling the person what was skipped, or "" when nothing was. */
export function skippedMessage(skipped) {
  if (!skipped?.length) return "";
  const reasons = [...new Set(skipped.map((item) => item.reason))].join(" ");
  return `${skipped.length} file${skipped.length === 1 ? "" : "s"} skipped. ${reasons}`;
}

/** The size an image is drawn at: never larger, longest side <= maxSide. */
export function fitWithin(width, height, maxSide = SUPPORT_UPLOAD_LIMITS.maxSide) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const longest = Math.max(w, h);
  if (longest <= maxSide) return { width: w, height: h };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** Screenshots (PNG) stay PNG so text stays sharp; everything else is JPEG. */
export function outputMimeFor(inputMime) {
  return String(inputMime || "").toLowerCase() === "image/png" ? "image/png" : "image/jpeg";
}

function ascii(bytes, start, text) {
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[start + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * True when `bytes` (a Uint8Array of a PNG, JPEG or WebP file) still carries
 * EXIF or XMP metadata: a JPEG APP1 segment, a PNG eXIf/iTXt-XMP chunk, or a
 * WebP EXIF/XMP chunk.
 */
export function hasImageMetadata(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return false;
  // JPEG: walk the segments up to the image data.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= bytes.length && bytes[i] === 0xff) {
      const marker = bytes[i + 1];
      if (marker === 0xda || marker === 0xd9) break; // start of scan / end
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker === 0xe1) return true; // APP1 = EXIF or XMP
      if (length < 2) break;
      i += 2 + length;
    }
    return false;
  }
  // PNG: walk the chunks.
  if (bytes[0] === 0x89 && ascii(bytes, 1, "PNG")) {
    let i = 8;
    while (i + 8 <= bytes.length) {
      const length = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
      if (ascii(bytes, i + 4, "eXIf")) return true;
      if (ascii(bytes, i + 4, "iTXt") && ascii(bytes, i + 8, "XML:com.adobe.xmp")) return true;
      if (ascii(bytes, i + 4, "IEND")) break;
      i += 12 + length;
    }
    return false;
  }
  // WebP: RIFF container.
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    let i = 12;
    while (i + 8 <= bytes.length) {
      if (ascii(bytes, i, "EXIF") || ascii(bytes, i, "XMP ")) return true;
      const length = bytes[i + 4] + (bytes[i + 5] << 8) + (bytes[i + 6] << 16) + ((bytes[i + 7] << 24) >>> 0);
      i += 8 + length + (length % 2);
    }
    return false;
  }
  return false;
}

async function defaultDecode(file) {
  if (typeof createImageBitmap !== "function") throw new Error("This browser can't read images.");
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

function defaultCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBlob(canvas, mime, quality) {
  if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type: mime, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't prepare this image."))), mime, quality);
  });
}

/**
 * Re-draw `file` on a canvas: no metadata survives, the longest side is at most
 * 2,560 px, and the result is at most 10 MB (a PNG too large is re-encoded as
 * JPEG). Returns { blob, mime, width, height }. Throws with a plain message.
 * `deps` lets a test pass its own decode / canvas.
 */
export async function reencodeImage(file, deps = {}) {
  const decode = deps.decode || defaultDecode;
  const makeCanvas = deps.makeCanvas || defaultCanvas;
  const toBlob = deps.toBlob || canvasToBlob;
  let bitmap;
  try {
    bitmap = await decode(file);
  } catch {
    throw new Error("Couldn't read this image. Try a PNG or JPEG.");
  }
  const size = fitWithin(bitmap.width, bitmap.height);
  const canvas = makeCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Couldn't prepare this image.");
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close?.();

  let mime = outputMimeFor(mimeOf(file));
  let blob = await toBlob(canvas, mime, mime === "image/jpeg" ? 0.9 : undefined);
  if (blob.size > SUPPORT_UPLOAD_LIMITS.maxBytes && mime === "image/png") {
    mime = "image/jpeg";
    blob = await toBlob(canvas, mime, 0.85);
  }
  if (blob.size > SUPPORT_UPLOAD_LIMITS.maxBytes) {
    throw new Error("This image is still over 10 MB after shrinking.");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (hasImageMetadata(bytes)) {
    throw new Error("Couldn't remove the location and camera details from this image.");
  }
  return { blob, mime, width: size.width, height: size.height };
}

/** The uploader can hand over its ids only when every item has uploaded. */
export function uploadsReady(items) {
  return (items || []).every((item) => item.status === "done" && item.attachmentId);
}

export function uploadsBusy(items) {
  return (items || []).some((item) => item.status === "preparing" || item.status === "uploading");
}
