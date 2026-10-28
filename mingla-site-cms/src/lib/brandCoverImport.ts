import type { PayloadRequest } from "payload";
import { cmsConfig } from "./config";
import { sha256 } from "./crypto";
import { completeUpload, createUploadGrant } from "./mediaPipeline";
import { writeObject } from "./objectStore";
import { emitCmsObservation } from "./observability";
import type { CoverRenditionDeps } from "./offeringCoverRenditions";

/*
 * #2829 W11 (amendment A17) — "the hero uses the brand cover photo when one
 * exists". When "Create website draft" writes Home, the brand's Mingla cover
 * (a path in Mingla's own public cover storage, chosen by Core) is brought in
 * as ordinary site media through the SAME pipeline an owner's upload takes:
 * a quarantine copy, then the checks, the re-encode to WebP, the stripped
 * metadata and the renditions. Nothing reads a third-party host.
 *
 * Returns the READY media id, or null (the colour panel is used instead) when
 * the cover can't be read, isn't a JPEG/PNG/WebP picture, or the pipeline
 * refuses it. Never throws: a cover is a nicety, never a failed draft.
 */
const PICTURE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function importBrandCover(
  scoped: PayloadRequest,
  coverPath: string,
  deps: Pick<CoverRenditionDeps, "fetchCover">,
): Promise<string | null> {
  try {
    const fetched = await deps.fetchCover(coverPath);
    const type = fetched?.contentType.split(";")[0]!.trim().toLowerCase() ?? "";
    if (!fetched || fetched.bytes.byteLength === 0 || !PICTURE_TYPES.has(type)) {
      observe("cover_read->skipped", "VALIDATION_FAILED");
      return null;
    }
    const filename = `brand-cover.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
    const grant = await createUploadGrant(scoped, { filename, content_type: type, bytes: fetched.bytes.byteLength });
    const media = await scoped.payload.findByID({
      collection: "media",
      id: grant.media_id,
      overrideAccess: true,
      depth: 0,
      showHiddenFields: true,
    }) as { quarantine_key?: unknown };
    if (typeof media.quarantine_key !== "string") throw new Error("INVALID_STATE");
    await writeObject(cmsConfig().quarantineBucket, media.quarantine_key, fetched.bytes, type);
    const done = await completeUpload(scoped, String(grant.media_id), await sha256(fetched.bytes), fetched.bytes.byteLength) as { state?: unknown } | null;
    if (done?.state !== "READY") {
      observe("cover_import->refused", "MEDIA_REJECTED");
      return null;
    }
    return String(grant.media_id);
  } catch {
    observe("cover_import->failed", "SERVICE_TEMPORARILY_UNAVAILABLE");
    return null;
  }
}

function observe(transition: string, code: string): void {
  emitCmsObservation({
    event: "mingla_sites_state",
    metric: "compose.brand_cover_skipped",
    request_id: crypto.randomUUID(),
    operation_id: null,
    site_id: null,
    publication_id: null,
    direction: "core_to_cms",
    route: "/api/internal/compose-from-plan",
    state_transition: transition,
    latency_ms: 0,
    retry_count: 0,
    safe_error_code: code,
    status_code: null,
    version: "sites-v1",
  });
}
