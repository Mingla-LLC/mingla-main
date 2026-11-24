import type { PayloadRequest } from "payload";
import { cmsConfig } from "./config";
import { sha256 } from "./crypto";
import { completeUpload, createUploadGrant } from "./mediaPipeline";
import { writeObject } from "./objectStore";
import { emitCmsObservation } from "./observability";
import { MAX_COVER_SOURCE_BYTES, type CoverRenditionDeps } from "./offeringCoverRenditions";

/*
 * #4572 item 3 (D3) — "Choose a photo" starts with the brand's own pictures.
 *
 * Core sends the brand's logo, its cover (the still when it is a video) and
 * up to 11 event flyers (their stills) as `library_sources` with Build, and
 * again from "Bring in my brand photos" (POST /api/internal/library-import).
 * Each comes in as ordinary site media through the SAME pipeline an owner's
 * upload takes (quarantine copy, checks, WebP re-encode, stripped metadata),
 * ONCE: a READY picture of this site with the same SHA-256 is reused.
 *
 * Where a picture may come from: Mingla's public storage on the configured
 * Core origin (`brand_avatars|brand_covers|event_covers`), or a still on a
 * stream CDN host listed in SITES_VIDEO_CDN_HOSTS (the name the renderer
 * reads). No redirects, at most 15 MB, JPEG/PNG/WebP only. Anything else is
 * skipped and observed, never a failed draft.
 *
 * The source is named in the media's file name ("Logo - …", "Cover - …",
 * "Flyer - …"), which the chooser shows; no new Studio field.
 */
export type LibrarySourceKind = "brand_logo" | "brand_cover" | "event_flyer";
export type LibrarySource = {
  kind: LibrarySourceKind;
  label: string;
  path?: string;
  stream_poster?: { host: string; video_id: string; file: string };
};
export type ImportedLibraryItem = { kind: LibrarySourceKind; mediaId: string };

export const MAX_LIBRARY_SOURCES = 13;
const KINDS: readonly LibrarySourceKind[] = ["brand_logo", "brand_cover", "event_flyer"];
const PATH_RE = /^(?:brand_avatars|brand_covers|event_covers)\/[A-Za-z0-9._/-]{1,400}$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const VIDEO_ID_RE = /^[0-9a-f-]{36}$/;
const FILE_RE = /^thumbnail(?:_[A-Za-z0-9]{1,16})?\.jpg$/;
const PICTURE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function plain(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pathOk(value: unknown): value is string {
  return typeof value === "string" && PATH_RE.test(value) &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..");
}

/**
 * Core's list, checked whole: a single bad entry refuses the envelope (null),
 * exactly as a bad `cover_photo_path` does. Absent = an empty list.
 */
export function parseLibrarySources(value: unknown): LibrarySource[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_LIBRARY_SOURCES) return null;
  const out: LibrarySource[] = [];
  for (const row of value) {
    if (!plain(row) || !KINDS.includes(row.kind as LibrarySourceKind)) return null;
    if (Object.keys(row).some((key) => !["kind", "label", "path", "stream_poster"].includes(key))) return null;
    if (typeof row.label !== "string" || !row.label.trim() || row.label.length > 160 || /[<>]/.test(row.label)) return null;
    const hasPath = row.path !== undefined;
    const hasStill = row.stream_poster !== undefined;
    if (hasPath === hasStill) return null;
    if (hasPath) {
      if (!pathOk(row.path)) return null;
      out.push({ kind: row.kind as LibrarySourceKind, label: row.label.trim(), path: row.path });
      continue;
    }
    const still = row.stream_poster;
    if (!plain(still) || Object.keys(still).length !== 3 ||
      typeof still.host !== "string" || !HOST_RE.test(still.host) ||
      typeof still.video_id !== "string" || !VIDEO_ID_RE.test(still.video_id) ||
      typeof still.file !== "string" || !FILE_RE.test(still.file)) return null;
    out.push({ kind: row.kind as LibrarySourceKind, label: row.label.trim(), stream_poster: { host: still.host, video_id: still.video_id, file: still.file } });
  }
  return out;
}

/** SITES_VIDEO_CDN_HOSTS as a list of hostnames (the renderer's rule: comma separated, lowercase). */
export function videoCdnHosts(value: string | undefined = process.env.SITES_VIDEO_CDN_HOSTS): readonly string[] {
  return (value ?? "").split(",").map((host) => host.trim().toLowerCase()).filter((host) => HOST_RE.test(host));
}

export type LibraryFetch = (url: string, init: RequestInit) => Promise<Response>;

export type BrandLibraryDeps = {
  /** A picture in Mingla's public storage (the publish's own reader). */
  fetchCover: CoverRenditionDeps["fetchCover"];
  /** A stream still: only https, only an allowed host, no redirects. */
  fetchStill(still: NonNullable<LibrarySource["stream_poster"]>): Promise<{ bytes: Uint8Array; contentType: string } | null>;
};

export function streamStillFetcher(hosts: readonly string[], fetcher: LibraryFetch = fetch): BrandLibraryDeps["fetchStill"] {
  return async (still) => {
    if (!hosts.includes(still.host)) return null;
    const response = await fetcher(`https://${still.host}/${still.video_id}/${still.file}`, { redirect: "manual", cache: "no-store" });
    if (response.status !== 200) return null;
    if (Number(response.headers.get("content-length") ?? "0") > MAX_COVER_SOURCE_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_COVER_SOURCE_BYTES) return null;
    return { bytes, contentType: response.headers.get("content-type") ?? "" };
  };
}

function fileName(label: string, type: string): string {
  const base = label.replace(/[^A-Za-z0-9._ -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140) || "Brand photo";
  return `${base}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
}

async function importOne(scoped: PayloadRequest, tenantId: string, source: LibrarySource, deps: BrandLibraryDeps): Promise<string | null> {
  const fetched = source.path ? await deps.fetchCover(source.path) : source.stream_poster ? await deps.fetchStill(source.stream_poster) : null;
  const type = fetched?.contentType.split(";")[0]!.trim().toLowerCase() ?? "";
  if (!fetched || fetched.bytes.byteLength === 0 || !PICTURE_TYPES.has(type)) {
    observe("library_read->skipped", "VALIDATION_FAILED");
    return null;
  }
  if (fetched.bytes.byteLength > MAX_COVER_SOURCE_BYTES) {
    observe("library_read->too_large", "MEDIA_REJECTED");
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
      { checksum: { equals: digest } },
    ] },
  });
  if (existing.docs[0]) return String(existing.docs[0].id);
  const grant = await createUploadGrant(scoped, { filename: fileName(source.label, type), content_type: type, bytes: fetched.bytes.byteLength });
  const media = await scoped.payload.findByID({ collection: "media", id: grant.media_id, overrideAccess: true, depth: 0, showHiddenFields: true }) as { quarantine_key?: unknown };
  if (typeof media.quarantine_key !== "string") throw new Error("INVALID_STATE");
  await writeObject(cmsConfig().quarantineBucket, media.quarantine_key, fetched.bytes, type);
  const done = await completeUpload(scoped, String(grant.media_id), digest, fetched.bytes.byteLength) as { id?: unknown; state?: unknown } | null;
  if (done?.state !== "READY") {
    observe("library_import->refused", "MEDIA_REJECTED");
    return null;
  }
  return String(done.id ?? grant.media_id);
}

/** Every source, in order, each once; a picture that can't come in is skipped (observed), never thrown. */
export async function importBrandLibrary(
  scoped: PayloadRequest,
  tenantId: string,
  sources: readonly LibrarySource[],
  deps: BrandLibraryDeps,
): Promise<ImportedLibraryItem[]> {
  const out: ImportedLibraryItem[] = [];
  for (const source of sources.slice(0, MAX_LIBRARY_SOURCES)) {
    try {
      const mediaId = await importOne(scoped, tenantId, source, deps);
      if (mediaId && !out.some((item) => item.mediaId === mediaId)) out.push({ kind: source.kind, mediaId });
    } catch {
      observe("library_import->failed", "SERVICE_TEMPORARILY_UNAVAILABLE");
    }
  }
  return out;
}

/** The hero's picture from the library: the brand cover still, else the first flyer still. */
export function libraryHeroPicture(items: readonly ImportedLibraryItem[]): string | null {
  return items.find((item) => item.kind === "brand_cover")?.mediaId ?? items.find((item) => item.kind === "event_flyer")?.mediaId ?? null;
}

export function defaultBrandLibraryDeps(): BrandLibraryDeps {
  return {
    async fetchCover(path) {
      const { storageCoverRenditionDeps } = await import("./artifactBuilder");
      return storageCoverRenditionDeps().fetchCover(path);
    },
    fetchStill: streamStillFetcher(videoCdnHosts()),
  };
}

function observe(transition: string, code: string): void {
  emitCmsObservation({
    event: "mingla_sites_state",
    metric: "compose.brand_library_skipped",
    request_id: crypto.randomUUID(),
    operation_id: null,
    site_id: null,
    publication_id: null,
    direction: "core_to_cms",
    route: "/api/internal/library-import",
    state_transition: transition,
    latency_ms: 0,
    retry_count: 0,
    safe_error_code: code,
    status_code: null,
    version: "sites-v1",
  });
}
