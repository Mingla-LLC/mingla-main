import { runtimeConfig } from "./config";
import { readPrivateObject } from "./storageReader";
import type { PreviewArtifactKey } from "./previewArtifact";
import { MAX_PREVIEW_SECTIONS_BYTES, previewSectionIdsFor, previewSectionsKey } from "../contracts/generated/previewSections.ts";

/*
 * #4453 website workspace (build contract D) — which Studio section drew each
 * block of ONE page of a private preview.
 *
 * Studio stores the list beside the preview artifact (see the contract module
 * for why it is never inside the artifact). This reads it for the owner's
 * private preview only: the public site, a share link and the plan preview
 * never call it. The list is advisory, so EVERY failure (no object, an older
 * Studio, a slow or failing read, another artifact's list, a length that does
 * not match the page) answers null, and the page renders exactly as it would
 * without section marks. Nothing here can make a preview fail.
 */
export async function loadPreviewSectionIds(
  parsed: PreviewArtifactKey,
  page: { path: string; blocks: readonly unknown[] },
): Promise<string[] | null> {
  try {
    const key = previewSectionsKey(parsed.key);
    if (!key || page.blocks.length === 0) return null;
    const response = await readPrivateObject(runtimeConfig().artifactBucket, key, "no-store");
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_PREVIEW_SECTIONS_BYTES) return null;
    return previewSectionIdsFor(JSON.parse(new TextDecoder().decode(bytes)), {
      artifactDigest: parsed.digest,
      pagePath: page.path,
      blockCount: page.blocks.length,
    });
  } catch {
    return null;
  }
}
