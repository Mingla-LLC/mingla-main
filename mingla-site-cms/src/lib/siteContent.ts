import { createHash } from "node:crypto";
import type { PayloadRequest } from "payload";
import {
  MAX_CATEGORIES,
  MAX_DESTINATIONS,
  MAX_STORIES,
  MAX_TESTIMONIALS,
  type SiteCollections,
  type SiteDestination,
  type SiteStory,
  type SiteTestimonial,
} from "../contracts/generated/collections.ts";
import { MAX_HIDDEN_OFFERINGS, type ManualOrderCollection, type MediaRef, type SiteDisplay } from "../contracts/generated/artifactV2.ts";
import { richTextToAst } from "./richTextToAst";
import { collectMediaIds } from "./mediaFields";
import { Categories, Destinations, Stories, Testimonials } from "../collections/SiteContent";

const CONTENT_HOLDERS = [Destinations, Stories, Categories, Testimonials] as const;

/*
 * #2829 W5 — THE ONE WAY TO READ AND PUBLISH A TENANT'S CONTENT COLLECTIONS
 * (destinations, stories, categories, testimonials).
 *
 * Every read takes every entry of the tenant (`pagination: false`) and refuses,
 * with a named reason, a tenant over the site limits — never a capped read
 * that silently drops entries (the six-page lesson). The same reader feeds
 * the publish, the preview, the draft digest and the media reference scan, so
 * a picture used only by a destination can never look unused to retention.
 */
type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const CONTENT_COLLECTION_SLUGS = ["destinations", "stories", "categories", "testimonials"] as const;
export type ContentCollectionSlug = (typeof CONTENT_COLLECTION_SLUGS)[number];
export type TenantContent = Record<ContentCollectionSlug, AnyDoc[]>;

const LIMITS: Record<ContentCollectionSlug, number> = {
  destinations: MAX_DESTINATIONS,
  stories: MAX_STORIES,
  categories: MAX_CATEGORIES,
  testimonials: MAX_TESTIMONIALS,
};

export class ContentLimitExceededError extends Error {
  constructor() {
    super("CONTENT_LIMIT_EXCEEDED");
  }
}

export async function findTenantContent(
  req: PayloadRequest,
  tenantId: string | number,
  options: { overrideAccess?: boolean } = {},
): Promise<TenantContent> {
  const entries = await Promise.all(CONTENT_COLLECTION_SLUGS.map(async (collection) => {
    const result = await req.payload.find({
      collection,
      req,
      overrideAccess: options.overrideAccess ?? false,
      draft: true,
      depth: 0,
      pagination: false,
      // #2829 W9r — the owner's order (Business app reorder), then creation
      // order for entries never reordered (null sort_order sorts last).
      sort: ["sort_order", "createdAt"],
      where: { tenant: { equals: tenantId } },
    });
    if (result.docs.length > LIMITS[collection]) throw new ContentLimitExceededError();
    return [collection, result.docs as AnyDoc[]] as const;
  }));
  return Object.fromEntries(entries) as TenantContent;
}

/**
 * What the draft digest covers. Absent when a tenant has no content at all,
 * so a site without collections keeps the digest it had before W5.
 */
export function contentForDigest(content: TenantContent | null | undefined): TenantContent | undefined {
  if (!content) return undefined;
  return CONTENT_COLLECTION_SLUGS.some((slug) => content[slug].length > 0) ? content : undefined;
}

function relationId(value: unknown): string {
  return value && typeof value === "object" ? String((value as { id?: unknown }).id ?? "") : String(value ?? "");
}

const rows = (value: unknown): AnyDoc[] => (Array.isArray(value) ? (value as AnyDoc[]) : []);

/** Every media id a tenant's content uses (retention must treat them as used). */
export function contentMediaIds(content: TenantContent): Set<string> {
  // #2829 — derived from each collection's schema (mediaFields.ts), so a
  // picture field added to a destination, story, category or review is in
  // the in-use scan the moment it exists.
  const ids = new Set<string>();
  for (const holder of CONTENT_HOLDERS) {
    for (const doc of content[holder.slug as ContentCollectionSlug] ?? []) collectMediaIds(holder.fields, doc, ids);
  }
  return ids;
}

/**
 * A Payload date as the calendar day the editor picked (YYYY-MM-DD). Studio's
 * day picker stores the editor's local midnight as an instant, so the nearest
 * UTC midnight is that day for any editor within ±12 hours of UTC.
 */
export function calendarDayOf(value: unknown): string | null {
  const time = typeof value === "string" || value instanceof Date ? new Date(value).getTime() : Number.NaN;
  if (!Number.isFinite(time)) return null;
  const day = 86_400_000;
  return new Date(Math.round(time / day) * day).toISOString().slice(0, 10);
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** `{ key: value }` when the trimmed value is non-empty, else `{}` (absent means absent). */
function opt(key: string, value: unknown): Record<string, string> {
  const text = trimmed(value);
  return text ? { [key]: text } : {};
}

function seoOf(value: unknown): { seo?: SiteStory["seo"] } {
  const record = (value ?? {}) as AnyDoc;
  const seo = {
    ...opt("title", record.title),
    ...opt("description", record.description),
    ...(record.noindex === true ? { noindex: true as const } : {}),
  };
  return Object.keys(seo).length ? { seo } : {};
}

export type MediaRenderer = (mediaId: unknown, alt: string) => MediaRef;

/**
 * The publication's frozen collections: enabled entries only, testimonials
 * only when confirmed as real, the owner's words exactly (trimmed), rich text
 * as the closed tree, pictures as this artifact's media records.
 */
export function shapeSiteCollections(content: TenantContent, renderMedia: MediaRenderer): SiteCollections {
  const shown = (doc: AnyDoc) => doc.enabled !== false;
  const categories = content.categories
    .filter((doc) => trimmed(doc.slug) && trimmed(doc.title))
    .map((doc) => ({ id: String(doc.id), slug: trimmed(doc.slug), title: trimmed(doc.title) }));
  const categorySlug = new Map(categories.map((row) => [row.id, row.slug]));
  const picture = (value: unknown, alt: string) => (relationId(value) ? renderMedia(value, alt) : undefined);

  const destinations: SiteDestination[] = content.destinations.filter(shown).map((doc) => {
    const title = trimmed(doc.title);
    const facts = {
      ...opt("language", doc.facts?.language),
      ...opt("currency", doc.facts?.currency),
      ...opt("religion", doc.facts?.religion),
      ...opt("timezone", doc.facts?.timezone),
    };
    const body = richTextToAst(doc.body);
    const featured = picture(doc.featured_image, title);
    const seasons = rows(doc.seasons).map((season) => {
      const activities = rows(season.activities).map((row) => trimmed(row.text)).filter(Boolean);
      const image = picture(season.image, trimmed(season.heading));
      return {
        heading: trimmed(season.heading),
        ...opt("body", season.body),
        ...(activities.length ? { activities } : {}),
        ...(image ? { image } : {}),
      };
    });
    const didYouKnow = rows(doc.did_you_know).map((row) => trimmed(row.text)).filter(Boolean);
    const related = [...new Set(rows(doc.related_offerings).map((row) => trimmed(row.offering_id).toLowerCase()).filter(Boolean))];
    const gallery = rows(doc.gallery).filter((row) => relationId(row.media)).map((row) => renderMedia(row.media, trimmed(row.alt)));
    return {
      id: String(doc.id),
      slug: trimmed(doc.slug),
      title,
      ...opt("country", doc.country),
      ...(featured ? { featured_image: featured } : {}),
      ...opt("tagline", doc.tagline),
      ...opt("summary", doc.summary),
      ...(Object.keys(facts).length ? { facts } : {}),
      ...opt("story_heading", doc.story_heading),
      ...(body ? { body } : {}),
      ...(seasons.length ? { seasons } : {}),
      ...(didYouKnow.length ? { did_you_know: didYouKnow } : {}),
      ...(related.length ? { related_offering_ids: related } : {}),
      ...(gallery.length ? { gallery } : {}),
      ...seoOf(doc.seo),
    };
  });

  const stories: SiteStory[] = content.stories.filter(shown).flatMap((doc) => {
    const content = richTextToAst(doc.content);
    const day = calendarDayOf(doc.published_at);
    if (!content || !day) return []; // a story with no words or no date is not published
    const category = categorySlug.get(relationId(doc.category));
    const featured = picture(doc.featured_image, trimmed(doc.title));
    return [{
      id: String(doc.id),
      slug: trimmed(doc.slug),
      title: trimmed(doc.title),
      published_at: day,
      ...(category ? { category } : {}),
      ...(featured ? { featured_image: featured } : {}),
      ...opt("excerpt", doc.excerpt),
      content,
      ...seoOf(doc.seo),
    }];
  });

  const testimonials: SiteTestimonial[] = content.testimonials
    .filter((doc) => shown(doc) && doc.confirmed_real === true)
    .flatMap((doc) => {
      const day = calendarDayOf(doc.review_date);
      const quote = typeof doc.quote === "string" ? doc.quote.trim() : "";
      if (!day || !quote) return [];
      const related = trimmed(doc.related_offering).toLowerCase();
      return [{
        id: String(doc.id),
        quote,
        reviewer: trimmed(doc.reviewer),
        review_date: day,
        ...opt("trip_name", doc.trip_name),
        ...(related ? { related_offering_id: related } : {}),
      }];
    });

  return { destinations, stories, categories, testimonials };
}

const OFFERING_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Did the owner reorder this collection in the Business app (any entry carries an order)? */
export function isCollectionReordered(docs: readonly AnyDoc[]): boolean {
  return docs.some((doc) => typeof doc.sort_order === "number");
}

/**
 * #2829 W9r — the owner's display choices frozen into the artifact, or
 * undefined when there are none (so earlier artifacts are unchanged): past
 * trips hidden from the site and the collections in the owner's own order.
 */
/** Keys of a settings document that are bookkeeping, not what the site shows. */
const SETTINGS_DIGEST_SKIP = new Set(["id", "createdAt", "updatedAt", "hidden_offering_ids", "_status", "tenant"]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

/**
 * #2829 W9r — the settings a version was built from, as one digest, without
 * the past-trip visibility list (that has its own "Past trips" change) and
 * bookkeeping fields. Equal digests: the design and settings did not change.
 */
export function settingsDigest(settings: unknown): string {
  const doc = settings && typeof settings === "object" ? settings as Record<string, unknown> : {};
  const shown = Object.fromEntries(Object.entries(doc).filter(([key]) => !SETTINGS_DIGEST_SKIP.has(key)));
  return createHash("sha256").update(JSON.stringify(canonical(shown))).digest("hex");
}

export function siteDisplayOf(settings: unknown, content: TenantContent): SiteDisplay | undefined {
  const raw = (settings as { hidden_offering_ids?: unknown } | null)?.hidden_offering_ids;
  const hidden = [...new Set((Array.isArray(raw) ? raw : [])
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.toLowerCase())
    .filter((id) => OFFERING_UUID.test(id)))].sort().slice(0, MAX_HIDDEN_OFFERINGS);
  const manual: ManualOrderCollection[] = [];
  if (isCollectionReordered(content.stories)) manual.push("stories");
  if (isCollectionReordered(content.testimonials)) manual.push("testimonials");
  const display: SiteDisplay = {
    ...(hidden.length ? { hidden_offering_ids: hidden } : {}),
    ...(manual.length ? { manual_order: manual } : {}),
    ...(settings ? { settings_digest: settingsDigest(settings) } : {}),
  };
  return Object.keys(display).length ? display : undefined;
}
