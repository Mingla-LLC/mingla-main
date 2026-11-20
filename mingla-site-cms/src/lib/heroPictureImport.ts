import type { PayloadRequest } from "payload";
import { cmsConfig } from "./config";
import { sha256 } from "./crypto";
import { completeUpload, createUploadGrant } from "./mediaPipeline";
import { writeObject } from "./objectStore";
import { emitCmsObservation } from "./observability";
import { MAX_COVER_SOURCE_BYTES, type CoverRenditionDeps } from "./offeringCoverRenditions";
import { parseOfferingsFeed, type SiteOffering } from "../contracts/generated/offerings.ts";

/*
 * #4453 booking-first Home — the hero's picture when the brand has neither a
 * Mingla brand cover nor a ready photo in its site Media.
 *
 * Found live on Gameland Lagos (2026-11-18): every picture the brand has lives
 * on its Mingla offerings, so the composer had no `media` for the hero (a
 * required Studio media relationship) and opened Home on a plain page header.
 *
 * Studio already reaches those pictures without any new Core surface: the
 * signed projection read the publish uses (`include=feed`) carries each
 * offering's `cover.path` in Mingla's public cover storage, and the publish
 * already reads covers from there (`storageCoverRenditionDeps().fetchCover`:
 * the configured Core origin, no redirects, capped). The picture is brought
 * in as ordinary site media through the SAME pipeline an owner's upload takes
 * (quarantine copy, checks, WebP re-encode, stripped metadata, renditions), so
 * the hero points at a READY Studio media record like any other.
 *
 * Which picture: the next experience's cover, then the next event's, then the
 * next trip's (the signed `next_offering` ids first, then any scheduled or
 * live offering of that kind, then any not cancelled). Image only (JPEG, PNG,
 * WebP), at most 15 MB, the pipeline's own pixel cap. Never an image service
 * (`/render/image` stays banned by the spend-cap hold).
 *
 * Imported ONCE: the pipeline records the source's SHA-256 as the media
 * `checksum`, and a READY image of this site with the same checksum is reused
 * instead of importing again.
 *
 * Never throws: a picture is a nicety, never a failed draft (null = the
 * composer keeps its plain page header).
 */
const PICTURE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const KIND_ORDER = ["experience", "event", "trip"] as const;
type CoverKind = (typeof KIND_ORDER)[number];

export type HeroPictureDeps = {
  /** The brand's offerings feed (Core's signed projection, `include=feed`). */
  loadFeed(): Promise<readonly Pick<SiteOffering, "id" | "kind" | "cover" | "status">[]>;
  /** A cover's bytes from Mingla's public cover storage, or null. */
  fetchCover: CoverRenditionDeps["fetchCover"];
};

/** The cover path the hero should use, or null (pure). */
export function pickOfferingCover(
  offerings: readonly Pick<SiteOffering, "id" | "kind" | "cover" | "status">[],
  next: Readonly<Partial<Record<CoverKind, string>>>,
): string | null {
  for (const kind of KIND_ORDER) {
    const ofKind = offerings.filter((offering) => offering.kind === kind && offering.cover?.type === "image" && offering.cover.path);
    const nextId = next[kind]?.toLowerCase();
    const chosen = ofKind.find((offering) => nextId && offering.id.toLowerCase() === nextId && offering.status !== "cancelled") ??
      ofKind.find((offering) => offering.status === "scheduled" || offering.status === "live") ??
      ofKind.find((offering) => offering.status !== "cancelled");
    if (chosen?.cover) return chosen.cover.path;
  }
  return null;
}

/** One stored cover → a READY media id of this site (reused by source digest), or null. */
export async function importCoverAsMedia(
  scoped: PayloadRequest,
  tenantId: string,
  coverPath: string,
  deps: Pick<HeroPictureDeps, "fetchCover">,
): Promise<string | null> {
  try {
    const fetched = await deps.fetchCover(coverPath);
    const type = fetched?.contentType.split(";")[0]!.trim().toLowerCase() ?? "";
    if (!fetched || fetched.bytes.byteLength === 0 || !PICTURE_TYPES.has(type)) {
      observe("cover_read->skipped", "VALIDATION_FAILED");
      return null;
    }
    if (fetched.bytes.byteLength > MAX_COVER_SOURCE_BYTES) {
      observe("cover_read->too_large", "MEDIA_REJECTED");
      return null;
    }
    const digest = await sha256(fetched.bytes);
    const existing = await scoped.payload.find({
      collection: "media",
      overrideAccess: true,
      depth: 0,
      limit: 1,
      where: { and: [
        { tenant: { equals: tenantId } },
        { state: { equals: "READY" } },
        { kind: { equals: "image" } },
        { checksum: { equals: digest } },
      ] },
    });
    if (existing.docs[0]) return String(existing.docs[0].id);
    const filename = `offering-cover.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
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
    const done = await completeUpload(scoped, String(grant.media_id), digest, fetched.bytes.byteLength) as { state?: unknown } | null;
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

/** The hero's picture from the brand's own Mingla offerings, or null. */
export async function heroPictureFromOfferings(
  scoped: PayloadRequest,
  input: { tenantId: string; next: Readonly<Partial<Record<CoverKind, string>>> },
  deps: HeroPictureDeps,
): Promise<string | null> {
  let path: string | null;
  try {
    path = pickOfferingCover(await deps.loadFeed(), input.next);
  } catch {
    observe("feed_read->skipped", "SERVICE_TEMPORARILY_UNAVAILABLE");
    return null;
  }
  return path ? importCoverAsMedia(scoped, input.tenantId, path, deps) : null;
}

/** Production wiring: the signed projection read and the publish's cover reader (loaded lazily). */
export function defaultHeroPictureDeps(siteId: string): HeroPictureDeps {
  return {
    async loadFeed() {
      const { readCoreProjection } = await import("./gateway");
      const projection = await readCoreProjection(`/internal/v1/sites/${siteId}/projection`, siteId, crypto.randomUUID(), [], false, false, true);
      return parseOfferingsFeed(projection.feed).offerings;
    },
    async fetchCover(path) {
      const { storageCoverRenditionDeps } = await import("./artifactBuilder");
      return storageCoverRenditionDeps().fetchCover(path);
    },
  };
}

function observe(transition: string, code: string): void {
  emitCmsObservation({
    event: "mingla_sites_state",
    metric: "compose.hero_picture_skipped",
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
