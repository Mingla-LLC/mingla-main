/**
 * #4304 — media speed (A), native executor. Shrinks a picked still photo
 * before it is uploaded (see brandGroupImageShrinkPlan.ts for the rules).
 *
 * expo-image-manipulator 14 and expo-file-system 19 already ship in the Host
 * app binary. Both are resolved at use: an expo module evaluates
 * expo-modules-core at import time (ORCH-1296 class), so a module-scope
 * import is fatal wherever the native module is not registered.
 */
import type * as ImageManipulatorTypes from "expo-image-manipulator";

import { getFileInfoAsync } from "../../utils/platformFileSystem";
import type { BrandGroupPickedFile } from "./brandGroupFilePickerShared";
import {
  BRAND_GROUP_IMAGE_JPEG_QUALITY,
  planBrandGroupImageShrink,
} from "./brandGroupImageShrinkPlan";

export interface BrandGroupShrinkCandidate extends BrandGroupPickedFile {
  width?: number | null;
  height?: number | null;
}

function release(target: { release?: () => void } | null): void {
  try {
    target?.release?.();
  } catch {
    // Already released by the runtime; nothing left to free.
  }
}

/**
 * Returns the file to upload: the shrunk JPEG/PNG copy, or the original when
 * the photo is already small, is not a still photo, or cannot be decoded (the
 * original then still uploads — a shrink failure never drops a file).
 */
export async function shrinkBrandGroupPickedFile(file: BrandGroupShrinkCandidate): Promise<BrandGroupPickedFile> {
  const original: BrandGroupPickedFile = { uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size };
  let plan = planBrandGroupImageShrink(file);
  if (plan.action === "keep") return original;
  let context: ImageManipulatorTypes.ImageManipulatorContext | null = null;
  let rendered: ImageManipulatorTypes.ImageRef | null = null;
  try {
    const Manipulator = await import("expo-image-manipulator");
    context = Manipulator.ImageManipulator.manipulate(file.uri);
    rendered = await context.renderAsync();
    if (plan.action === "measure") {
      plan = planBrandGroupImageShrink({ ...file, width: rendered.width, height: rendered.height });
      if (plan.action !== "reencode") return original;
    }
    if (plan.resize) {
      release(rendered);
      rendered = await context.reset().resize(plan.resize).renderAsync();
    }
    const saved = await rendered.saveAsync(plan.format === "png"
      ? { format: Manipulator.SaveFormat.PNG }
      : { format: Manipulator.SaveFormat.JPEG, compress: BRAND_GROUP_IMAGE_JPEG_QUALITY });
    const info = await getFileInfoAsync(saved.uri);
    const size = typeof info.size === "number" && info.size > 0 ? info.size : null;
    return { uri: saved.uri, name: plan.name, mimeType: plan.mimeType, size };
  } catch (cause) {
    console.warn("[#4304] photo shrink skipped; uploading the original", cause instanceof Error ? cause.message : cause);
    return original;
  } finally {
    release(rendered);
    release(context);
  }
}
