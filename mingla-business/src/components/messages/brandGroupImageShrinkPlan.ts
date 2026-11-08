/**
 * #4304 — media speed (A). Photos are shrunk on the phone before they are
 * uploaded to a Brand group: the long edge is capped at 2048 px and the photo
 * is re-encoded as JPEG at 0.8. A photo that is already small enough is left
 * alone. GIFs (animation), videos and documents are never touched. HEIC/HEIF is
 * always converted to JPEG so every viewer can open it, and its name and type
 * are corrected to `.jpg` / `image/jpeg`.
 *
 * Pure: no expo import, so it is safe in every test and render suite. The
 * native executor lives in brandGroupImageShrink.native.ts.
 */

export const BRAND_GROUP_IMAGE_MAX_EDGE = 2048;
export const BRAND_GROUP_IMAGE_JPEG_QUALITY = 0.8;

export interface BrandGroupShrinkInput {
  name: string;
  mimeType: string | null;
  width?: number | null;
  height?: number | null;
}

export type BrandGroupShrinkFormat = "jpeg" | "png";

export type BrandGroupShrinkPlan =
  /** Not a still photo we may touch (GIF, video, document) or already small. */
  | { action: "keep" }
  /** A still photo whose size the picker did not report: measure it first. */
  | { action: "measure" }
  | {
      action: "reencode";
      resize: { width: number } | { height: number } | null;
      format: BrandGroupShrinkFormat;
      name: string;
      mimeType: string;
    };

const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  heic: "image/heic", heif: "image/heif", gif: "image/gif",
};

const SHRINKABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export function brandGroupShrinkMime(input: Pick<BrandGroupShrinkInput, "name" | "mimeType">): string {
  const declared = String(input.mimeType ?? "").split(";", 1)[0].trim().toLowerCase();
  if (declared) return declared === "image/jpg" ? "image/jpeg" : declared;
  const extension = input.name.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_MIME[extension] ?? "";
}

function renamed(name: string, extension: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem || "photo"}.${extension}`;
}

function validDimension(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Decide what to do with one picked file. `width`/`height` are the real pixel
 * size when known (from the picker or from a measurement).
 */
export function planBrandGroupImageShrink(input: BrandGroupShrinkInput): BrandGroupShrinkPlan {
  const mime = brandGroupShrinkMime(input);
  if (!SHRINKABLE.has(mime)) return { action: "keep" };
  const heic = mime === "image/heic" || mime === "image/heif";
  if (!validDimension(input.width) || !validDimension(input.height)) return { action: "measure" };
  const longEdge = Math.max(input.width, input.height);
  const tooBig = longEdge > BRAND_GROUP_IMAGE_MAX_EDGE;
  if (!tooBig && !heic) return { action: "keep" };
  const resize = !tooBig
    ? null
    : input.width >= input.height
      ? { width: BRAND_GROUP_IMAGE_MAX_EDGE }
      : { height: BRAND_GROUP_IMAGE_MAX_EDGE };
  // PNG keeps PNG so a transparent screenshot or logo is not filled black;
  // every other still photo becomes a JPEG.
  if (mime === "image/png") {
    return { action: "reencode", resize, format: "png", name: input.name, mimeType: "image/png" };
  }
  return { action: "reencode", resize, format: "jpeg", name: renamed(input.name, "jpg"), mimeType: "image/jpeg" };
}
