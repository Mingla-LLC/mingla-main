import sharp, { type Metadata } from "sharp";
import { sha256 } from "./crypto";
import { MEDIA_VARIANTS } from "./mediaPipeline";
import {
  OFFERING_MEDIA_KEY_RE,
  offeringMediaFolder,
  offeringMediaKey,
  type OfferingCoverMedia,
  type OfferingCoverRendition,
} from "../contracts/generated/artifactV2.ts";
import type { SiteOffering } from "../contracts/generated/offerings.ts";

/*
 * #2829 W7c (amendment A13.1) — renditions of the offering covers a site
 * shows (Mingla trip / event / experience covers), made ONCE at publish.
 *
 * Mingla stores a cover exactly as it was uploaded (often 1600–2600 px), and
 * a site may not ask an image service to resize it (the Supabase spend-cap
 * hold forbids Image Transformations). So the CMS does what it already does
 * for the site's own pictures: it reads the stored cover once, makes the
 * 4:3 centre crops (400×300, 768×576) and the 1600-wide picture with sharp,
 * WebP quality 80 (the same settings as site media), and
 * stores them in Sites storage under a content-addressed key
 * (`approved/<site>/<uuid-shaped digest prefix>/<source sha-256>/<name>.webp`).
 * A cover processed before is not processed again: its stored renditions are
 * read back and recorded. The publication records each cover's renditions by
 * the cover's path; the runtime serves them through `/om` with the cover's
 * token rules and offers them as `srcset`.
 *
 * A rendition larger than the cover in either direction is not made (the
 * card then offers the stored cover at its own width instead), exactly as
 * the brand's own pipeline skips a size bigger than the upload: a "768 crop"
 * of a 736-wide cover would be a different crop from the one the browser
 * draws from the stored cover. A cover smaller than every rendition has no
 * entry at all.
 *
 * A cover that cannot be read or decoded is left without renditions and
 * reported as a warning (the card then shows the stored cover); it never
 * fails the publish.
 */
export const MAX_COVER_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const SOURCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

export type CoverRenditionDeps = {
  /** The stored cover's bytes and declared type from Mingla's public cover storage, or null. */
  fetchCover(path: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  /** A Sites storage object's bytes, or null when it does not exist. */
  readStored(key: string): Promise<Uint8Array | null>;
  /** Write a Sites storage object (image/webp). */
  writeStored(key: string, bytes: Uint8Array): Promise<void>;
};

export type CoverRenditionWarning = { path: string; code: "COVER_UNREADABLE" | "COVER_NOT_AN_IMAGE" | "COVER_TOO_LARGE" | "STORAGE_UNAVAILABLE" };

/** The cover's displayed size (EXIF orientation applied, as `.rotate()` does). */
function orientedSize(meta: Metadata): { width: number; height: number } {
  const swap = typeof meta.orientation === "number" && meta.orientation >= 5;
  return swap ? { width: meta.height!, height: meta.width! } : { width: meta.width!, height: meta.height! };
}

async function renditionOf(source: Uint8Array, variant: (typeof MEDIA_VARIANTS)[number]): Promise<Uint8Array> {
  return new Uint8Array(await sharp(source, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize(variant.height === null
      ? { width: variant.width, withoutEnlargement: true }
      : { width: variant.width, height: variant.height, fit: "cover", position: "centre", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer());
}

async function describe(name: OfferingCoverRendition["name"], key: string, bytes: Uint8Array): Promise<OfferingCoverRendition> {
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height || meta.format !== "webp") throw new Error("STORAGE_UNAVAILABLE");
  return { name, width: meta.width, height: meta.height, integrity: await sha256(bytes), object_key: key };
}

/** One cover → its renditions (made now, or read back from an earlier publish). */
async function coverMedia(siteId: string, path: string, deps: CoverRenditionDeps): Promise<OfferingCoverMedia | CoverRenditionWarning | null> {
  let fetched: Awaited<ReturnType<CoverRenditionDeps["fetchCover"]>>;
  try {
    fetched = await deps.fetchCover(path);
  } catch {
    fetched = null;
  }
  if (!fetched || fetched.bytes.byteLength === 0) return { path, code: "COVER_UNREADABLE" };
  if (fetched.bytes.byteLength > MAX_COVER_SOURCE_BYTES) return { path, code: "COVER_TOO_LARGE" };
  if (!SOURCE_TYPES.has(fetched.contentType.split(";")[0]!.trim().toLowerCase())) return { path, code: "COVER_NOT_AN_IMAGE" };
  let meta: Metadata;
  try {
    meta = await sharp(fetched.bytes, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    return { path, code: "COVER_NOT_AN_IMAGE" };
  }
  if (!meta.width || !meta.height || (meta.pages && meta.pages > 1)) return { path, code: "COVER_NOT_AN_IMAGE" };
  if (meta.width * meta.height > MAX_PIXELS) return { path, code: "COVER_TOO_LARGE" };
  const sourceDigest = await sha256(fetched.bytes);
  const size = orientedSize(meta);
  const variants: OfferingCoverRendition[] = [];
  try {
    for (const variant of MEDIA_VARIANTS) {
      if (size.width < variant.width || (variant.height !== null && size.height < variant.height)) continue;
      const key = offeringMediaKey(siteId, sourceDigest, variant.name);
      const stored = await deps.readStored(key);
      if (stored && stored.byteLength > 0) {
        variants.push(await describe(variant.name, key, stored));
        continue;
      }
      const bytes = await renditionOf(fetched.bytes, variant);
      await deps.writeStored(key, bytes);
      const readback = await deps.readStored(key);
      if (!readback || readback.byteLength !== bytes.byteLength || await sha256(readback) !== await sha256(bytes)) {
        throw new Error("STORAGE_UNAVAILABLE");
      }
      variants.push(await describe(variant.name, key, bytes));
    }
  } catch {
    return { path, code: "STORAGE_UNAVAILABLE" };
  }
  if (!variants.length) return null;
  return { path, source_width: size.width, source_height: size.height, variants };
}

/**
 * Every distinct cover in the publish-time feed → its renditions, in feed
 * order. Covers that could not be processed are listed as warnings.
 */
export async function offeringCoverRenditions(
  siteId: string,
  offerings: readonly Pick<SiteOffering, "cover">[],
  deps: CoverRenditionDeps,
): Promise<{ media: OfferingCoverMedia[]; warnings: CoverRenditionWarning[] }> {
  const paths = [...new Set(offerings.flatMap((offering) => (offering.cover ? [offering.cover.path] : [])))];
  const media: OfferingCoverMedia[] = [];
  const warnings: CoverRenditionWarning[] = [];
  for (const path of paths) {
    const result = await coverMedia(siteId, path, deps);
    if (result === null) continue;
    if ("code" in result) warnings.push(result);
    else media.push(result);
  }
  return { media, warnings };
}

/*
 * #2829 W11 (amendment A14) — retention for offering-cover renditions.
 *
 * Renditions are content-addressed and shared by every publication that
 * shows the same cover, so they are never deleted with an artifact. The
 * retention sweep removes a rendition only when ALL of these hold:
 *  - its key is a rendition key of THIS site (`approved/<site>/<folder>/
 *    <digest>/<c400|c768|w1600>.webp` where the folder is the digest's own
 *    uuid-shaped prefix — a site photo's key has its media id there instead,
 *    so a photo can never be mistaken for a rendition);
 *  - no publication artifact the sweep keeps (Core-protected, or not yet old
 *    enough to purge) and no recent preview names it;
 *  - it was written more than the grace period ago (15 days: longer than the
 *    longest private preview link), so a publish or preview in flight keeps
 *    what it just made.
 * A cover whose renditions were removed and that comes back is processed
 * again at its next publish (the builder finds nothing stored and makes it).
 * Any failure to list or read refuses the whole cleanup: nothing is deleted.
 */
export const RENDITION_GRACE_MS = 15 * 24 * 60 * 60_000;

export type RenditionSweepDeps = {
  /** Every Sites storage object under a prefix, with its write time. */
  list(prefix: string): Promise<Array<{ key: string; lastModified: string }>>;
  /** One kept artifact's JSON (throws when it cannot be read). */
  readArtifact(key: string): Promise<unknown>;
  /** Delete one Sites storage object. */
  remove(key: string): Promise<void>;
};

/** The rendition keys one artifact names (anything malformed names nothing). */
export function renditionKeysOf(artifact: unknown): string[] {
  const media = artifact && typeof artifact === "object" ? (artifact as { offering_media?: unknown }).offering_media : undefined;
  if (!Array.isArray(media)) return [];
  return media.flatMap((entry) => {
    const variants = entry && typeof entry === "object" ? (entry as { variants?: unknown }).variants : undefined;
    return Array.isArray(variants)
      ? variants.flatMap((variant) => {
        const key = variant && typeof variant === "object" ? (variant as { object_key?: unknown }).object_key : undefined;
        return typeof key === "string" ? [key] : [];
      })
      : [];
  });
}

/** A rendition key of this site (and never a site photo's key). */
export function isSiteRenditionKey(siteId: string, key: string): boolean {
  const match = OFFERING_MEDIA_KEY_RE.exec(key);
  return Boolean(match && match[1] === siteId && match[2] === offeringMediaFolder(match[3]!));
}

export async function sweepOfferingRenditions(input: {
  siteId: string;
  /** Publication artifacts the sweep keeps. */
  keptArtifactKeys: readonly string[];
  /** Preview artifacts are found by listing `publications/<site>/preview-…`. */
  deps: RenditionSweepDeps;
  nowMs?: number;
}): Promise<{ scanned: number; kept: number; purged: number }> {
  const now = input.nowMs ?? Date.now();
  const referenced = new Set<string>();
  for (const key of input.keptArtifactKeys) {
    for (const rendition of renditionKeysOf(await input.deps.readArtifact(key))) referenced.add(rendition);
  }
  const previews = (await input.deps.list(`publications/${input.siteId}/preview-`))
    .filter((object) => Date.parse(object.lastModified) > now - RENDITION_GRACE_MS && object.key.endsWith(".json"));
  for (const preview of previews) {
    for (const rendition of renditionKeysOf(await input.deps.readArtifact(preview.key))) referenced.add(rendition);
  }
  const candidates = (await input.deps.list(`approved/${input.siteId}/`))
    .filter((object) => isSiteRenditionKey(input.siteId, object.key));
  let purged = 0;
  for (const object of candidates) {
    const written = Date.parse(object.lastModified);
    if (referenced.has(object.key) || !Number.isFinite(written) || written > now - RENDITION_GRACE_MS) continue;
    await input.deps.remove(object.key);
    purged += 1;
  }
  return { scanned: candidates.length, kept: candidates.length - purged, purged };
}
