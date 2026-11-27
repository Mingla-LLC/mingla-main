// #4636 — prepare a media-library upload in the browser, before any network call.
//
// Pictures (JPEG, PNG or WebP) are re-encoded to a JPEG of at most 2400 px on
// the long edge and 5 MiB, plus a 480 px `_thumb.jpg`. Videos (MP4 only, at
// most 50 MB and 60 s) keep their file; a poster frame is captured from the
// clip as `_poster.jpg`. All of it runs on a <canvas> here: no Supabase Image
// Transformations, ever (spend-cap hold #1643, I-4636-NO-IMAGE-TRANSFORM).
import { IMAGE_MAX_BYTES, mediaPickProblem } from "../services/siteCmsService.js";

export const IMAGE_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
export const IMAGE_LONG_EDGE = 2400;
export const THUMB_LONG_EDGE = 480;
export const POSTER_LONG_EDGE = 1280;

/** The size that fits `w × h` inside a `max` long edge (never upscaled). */
export function fitWithin(w, h, max) {
  const long = Math.max(w, h);
  if (!(long > 0)) return { width: 0, height: 0 };
  const s = Math.min(1, max / long);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** What a picked file is: "image", "video" or null (refused). */
export function kindOf(file) {
  if (IMAGE_TYPES.includes(file?.type)) return "image";
  if (file?.type === "video/mp4") return "video";
  return null;
}

function canvasBlob(source, width, height, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare pictures.");
  ctx.fillStyle = "#ffffff"; // a transparent PNG becomes white, not black
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The picture couldn't be prepared."))), "image/jpeg", quality));
}

/** { file, still, width, height } for a picture: the web copy (≤ 2400 px, ≤ 5 MiB) and its thumbnail. */
export async function preparePicture(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That picture couldn't be read. Try a JPEG, PNG or WebP.");
  }
  const size = fitWithin(bitmap.width, bitmap.height, IMAGE_LONG_EDGE);
  let blob = null;
  for (const q of [0.86, 0.78, 0.7, 0.6]) {
    blob = await canvasBlob(bitmap, size.width, size.height, q);
    if (blob.size <= IMAGE_MAX_BYTES) break;
  }
  const problem = mediaPickProblem({ kind: "image", bytes: blob.size });
  if (problem) throw new Error(problem);
  const t = fitWithin(bitmap.width, bitmap.height, THUMB_LONG_EDGE);
  const still = await canvasBlob(bitmap, t.width, t.height, 0.8);
  bitmap.close?.();
  return { file: blob, still, width: size.width, height: size.height, seconds: null };
}

/** { file, still, width, height, seconds } for an MP4: the file as picked and a poster frame. */
export async function prepareVideo(file) {
  const early = mediaPickProblem({ kind: "video", type: file.type, bytes: file.size, seconds: 1 });
  if (early) throw new Error(early);
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("That video couldn't be read. Try another MP4."));
    });
    const seconds = Math.round(video.duration * 100) / 100;
    const problem = mediaPickProblem({ kind: "video", type: file.type, bytes: file.size, seconds });
    if (problem) throw new Error(problem);
    await new Promise((resolve, reject) => {
      video.onseeked = resolve;
      video.onerror = () => reject(new Error("The video's cover frame couldn't be made."));
      video.currentTime = Math.min(1, seconds / 2);
    });
    const p = fitWithin(video.videoWidth, video.videoHeight, POSTER_LONG_EDGE);
    const still = await canvasBlob(video, p.width, p.height, 0.82);
    return { file, still, width: video.videoWidth, height: video.videoHeight, seconds };
  } finally {
    URL.revokeObjectURL(url);
  }
}
