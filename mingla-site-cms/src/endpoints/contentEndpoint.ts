import type { Endpoint, PayloadRequest } from "payload";
import { sitesJsonResponse } from "../lib/http";
import { observeCmsEndpoint } from "../lib/observability";
import { verifyCoreRequest } from "../lib/gateway";
import { cmsConfig } from "../lib/config";
import { presignedGet, readObject } from "../lib/objectStore";
import { findAllTenantPages } from "../lib/tenantPages";
import { completeUpload, createUploadGrant } from "../lib/mediaPipeline";
import { astToLexical } from "../lib/astToLexical";
import { richTextToAst } from "../lib/richTextToAst";
import { calendarDayOf, settingsDigest } from "../lib/siteContent";
import { facesForSlot, ttfPreviewFace } from "../lib/fontAssets";
import { fontObjectKey, payloadFontPipeline, payloadTtfPipeline, ttfObjectKey } from "../lib/fontAssetStore";
import { findCatalogFont, searchCatalogFonts, type FontCategory } from "../contracts/generated/fontCatalog.ts";
import { isFontFamilyName, nearestWeight } from "../contracts/generated/fontSlots.ts";
import { SLUG_PATTERN } from "../contracts/generated/routes.ts";
import { MAX_NAV_ITEMS, MAX_REDIRECTS, MAX_SLUG_LENGTH } from "../contracts/generated/limits.ts";
import { DEFAULT_SITE_ROUTES } from "../contracts/generated/routes.ts";
import {
  MAX_CATEGORIES,
  MAX_COLLECTION_GALLERY,
  MAX_DESTINATION_SEASONS,
  MAX_DESTINATIONS,
  MAX_DID_YOU_KNOW,
  MAX_RELATED_OFFERINGS,
  MAX_SEASON_ACTIVITIES,
  MAX_STORIES,
  MAX_TESTIMONIAL_QUOTE,
  MAX_TESTIMONIALS,
} from "../contracts/generated/collections.ts";

/*
 * #2829 W9r — the Business app's content collections (Website › Content:
 * destinations, stories, reviews, story categories), photos through the
 * existing media pipeline, and the site's hidden past trips.
 *
 * Core is the only caller (brand-site-control POST /v1/sites/<id>/content):
 * it checked entitlement and the member's live rank for the action
 * (brand_site_content_authorize, one rank list in SQL), validated any Mingla
 * offering id against the brand's own feed, and signed this request. Studio:
 *   - takes the tenant ONLY from the signed site id (+ brand cross-check);
 *   - runs every collection read and write as that member, overrideAccess
 *     false, so the multi-tenant access and bindRequestTenant apply;
 *   - re-checks the action's minimum rank from the signed rank;
 *   - refuses a stale revision with the latest one (nothing is overwritten
 *     silently) and caps every field itself (drafts skip Payload validation).
 * Drafts only: nothing here publishes.
 */

type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTRY_ID = /^[A-Za-z0-9-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const THUMB_TTL_SECONDS = 3600;

export const CONTENT_COLLECTIONS = ["destinations", "stories", "testimonials"] as const;
export type ContentCollection = (typeof CONTENT_COLLECTIONS)[number];

/** The same minimum ranks as Core's brand_site_content_min_rank (defence in depth). */
export const CONTENT_ACTION_MIN_RANK: Readonly<Record<string, number>> = {
  list: 20,
  get: 20,
  create: 20,
  update: 20,
  reorder: 20,
  set_visibility: 20,
  delete: 20,
  categories: 20,
  create_category: 20,
  rename_category: 20,
  reorder_categories: 20,
  delete_category: 20,
  media_upload_grant: 20,
  media_complete: 20,
  media_status: 20,
  media_library: 20,
  get_display: 20,
  font_previews: 20,
  draft_changes: 20,
  pages: 20,
  set_menu: 20,
  cover: 20,
  set_cover: 20,
  font_search: 20,
  // #2829 W9b — "Why it looks like this" (read-only) and the six design checks.
  work_log: 20,
  design_checks: 20,
  confirm_review: 50,
  set_offering_visibility: 50,
};

const LIMITS: Record<ContentCollection, number> = {
  destinations: MAX_DESTINATIONS,
  stories: MAX_STORIES,
  testimonials: MAX_TESTIMONIALS,
};

export class ContentError extends Error {
  constructor(code: string, readonly extra?: Record<string, unknown>) {
    super(code);
  }
}

function fail(code: string, extra?: Record<string, unknown>): never {
  throw new ContentError(code, extra);
}

export type ContentRequest = {
  action: string;
  siteId: string;
  brandId: string;
  userId: string;
  rank: number;
  args: AnyDoc;
};

/** The signed body, key by key. */
export function parseContentBody(body: unknown, envelopeSiteId: string): ContentRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("VALIDATION_FAILED");
  const value = body as AnyDoc;
  const allowed = new Set(["action", "site_id", "brand_id", "user_id", "rank", "args"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail("VALIDATION_FAILED");
  const action = String(value.action ?? "");
  const minimum = CONTENT_ACTION_MIN_RANK[action];
  if (minimum === undefined) fail("VALIDATION_FAILED");
  if (value.site_id !== envelopeSiteId || !UUID.test(String(value.brand_id)) || !UUID.test(String(value.user_id))) {
    fail("FORBIDDEN");
  }
  const rank = Number(value.rank);
  if (!Number.isInteger(rank) || rank < minimum) fail("FORBIDDEN");
  const args = value.args && typeof value.args === "object" && !Array.isArray(value.args) ? (value.args as AnyDoc) : {};
  return { action, siteId: envelopeSiteId, brandId: String(value.brand_id), userId: String(value.user_id).toLowerCase(), rank, args };
}

export function collectionOf(value: unknown): ContentCollection {
  return (CONTENT_COLLECTIONS as readonly unknown[]).includes(value) ? (value as ContentCollection) : fail("VALIDATION_FAILED");
}

function entryIdOf(value: unknown): string {
  const id = typeof value === "number" ? String(value) : value;
  return typeof id === "string" && ENTRY_ID.test(id) ? id : fail("VALIDATION_FAILED");
}

/** Trimmed words up to `max` characters (never markup), or null when empty. */
export function cap(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") fail("VALIDATION_FAILED");
  const text = value.replace(/\u0000/g, "").trim();
  if (!text) return null;
  if (text.length > max || /<\s*\/?\s*[a-z!]/i.test(text)) fail("VALIDATION_FAILED");
  return text;
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, Math.min(MAX_SLUG_LENGTH, 60))
    .replace(/-+$/g, "");
  return slug || "entry";
}

function slugOf(value: unknown): string | null {
  const slug = cap(value, MAX_SLUG_LENGTH);
  if (slug === null) return null;
  return SLUG_PATTERN.test(slug) ? slug : fail("SLUG_INVALID");
}

function mediaIdOf(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const id = typeof value === "number" ? String(value) : value;
  return typeof id === "string" && ENTRY_ID.test(id) ? id : fail("VALIDATION_FAILED");
}

function offeringOf(value: unknown): string {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : fail("VALIDATION_FAILED");
}

function list<T>(value: unknown, max: number, each: (row: unknown) => T): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) fail("VALIDATION_FAILED");
  return value.map(each);
}

function richText(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  try {
    return astToLexical(value);
  } catch {
    fail("VALIDATION_FAILED");
  }
}

function day(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !DAY.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) fail("VALIDATION_FAILED");
  return `${value}T00:00:00.000Z`;
}

function has(data: AnyDoc, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function bool(value: unknown): boolean {
  return typeof value === "boolean" ? value : fail("VALIDATION_FAILED");
}

/**
 * The fields the app may write, per collection, shaped and capped. Only keys
 * present in `data` are written (a partial update). `confirmed_real` is not
 * here: only confirm_review sets it.
 */
export function shapeEntryData(collection: ContentCollection, data: AnyDoc): AnyDoc {
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("VALIDATION_FAILED");
  const out: AnyDoc = {};
  const take = (key: string, shape: (value: unknown) => unknown) => {
    if (has(data, key)) out[key] = shape(data[key]);
  };
  const allowed: Record<ContentCollection, string[]> = {
    destinations: ["title", "slug", "country", "featured_image", "tagline", "summary", "facts", "story_heading", "body",
      "seasons", "did_you_know", "related_offerings", "gallery", "seo", "enabled"],
    stories: ["title", "slug", "published_at", "category", "featured_image", "excerpt", "content", "seo", "enabled"],
    testimonials: ["quote", "reviewer", "review_date", "trip_name", "related_offering", "source_note", "enabled"],
  };
  if (Object.keys(data).some((key) => !allowed[collection].includes(key))) fail("VALIDATION_FAILED");
  take("enabled", bool);
  take("slug", slugOf);
  take("featured_image", mediaIdOf);
  take("seo", (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("VALIDATION_FAILED");
    const seo = value as AnyDoc;
    if (Object.keys(seo).some((key) => key !== "noindex")) fail("VALIDATION_FAILED");
    return { noindex: bool(seo.noindex) };
  });
  if (collection === "destinations") {
    take("title", (value) => cap(value, 120));
    take("country", (value) => cap(value, 80));
    take("tagline", (value) => cap(value, 200));
    take("summary", (value) => cap(value, 600));
    take("story_heading", (value) => cap(value, 120));
    take("body", richText);
    take("facts", (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("VALIDATION_FAILED");
      const facts = value as AnyDoc;
      if (Object.keys(facts).some((key) => !["language", "currency", "religion", "timezone"].includes(key))) fail("VALIDATION_FAILED");
      return {
        language: cap(facts.language, 120),
        currency: cap(facts.currency, 120),
        religion: cap(facts.religion, 120),
        timezone: cap(facts.timezone, 120),
      };
    });
    take("seasons", (value) => list(value, MAX_DESTINATION_SEASONS, (row) => {
      const season = (row ?? {}) as AnyDoc;
      const heading = cap(season.heading, 120);
      if (!heading) fail("VALIDATION_FAILED");
      return {
        heading,
        body: cap(season.body, 1000),
        activities: list(season.activities, MAX_SEASON_ACTIVITIES, (item) => {
          const text = cap(typeof item === "string" ? item : (item as AnyDoc)?.text, 120);
          return text ? { text } : fail("VALIDATION_FAILED");
        }),
        image: mediaIdOf(season.image),
      };
    }));
    take("did_you_know", (value) => list(value, MAX_DID_YOU_KNOW, (row) => {
      const text = cap(typeof row === "string" ? row : (row as AnyDoc)?.text, 400);
      return text ? { text } : fail("VALIDATION_FAILED");
    }));
    take("related_offerings", (value) => list(value, MAX_RELATED_OFFERINGS, (row) =>
      ({ offering_id: offeringOf(typeof row === "string" ? row : (row as AnyDoc)?.offering_id) })));
    take("gallery", (value) => list(value, MAX_COLLECTION_GALLERY, (row) => {
      const item = (row ?? {}) as AnyDoc;
      const media = mediaIdOf(item.media);
      return media ? { media, alt: cap(item.alt, 240) } : fail("VALIDATION_FAILED");
    }));
  }
  if (collection === "stories") {
    take("title", (value) => cap(value, 160));
    take("excerpt", (value) => cap(value, 400));
    take("published_at", day);
    take("category", (value) => (value === null || value === "" ? null : entryIdOf(value)));
    take("content", richText);
  }
  if (collection === "testimonials") {
    take("quote", (value) => {
      // Word for word: kept exactly as pasted (only the outer whitespace goes).
      if (value === null || value === undefined) return null;
      if (typeof value !== "string" || value.trim().length > MAX_TESTIMONIAL_QUOTE || /<\s*\/?\s*[a-z!]/i.test(value)) fail("VALIDATION_FAILED");
      return value.trim() || null;
    });
    take("reviewer", (value) => cap(value, 80));
    take("review_date", day);
    take("trip_name", (value) => cap(value, 120));
    take("related_offering", (value) => (value === null || value === "" ? null : offeringOf(value)));
    take("source_note", (value) => cap(value, 500));
  }
  return out;
}

/** The revision of a whole list (reorder refuses when anything changed since it was read). */
export async function listRevision(docs: readonly AnyDoc[]): Promise<string> {
  const text = docs.map((doc) => `${doc.id}:${doc.updatedAt}`).join("|");
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function conflict(doc: AnyDoc): never {
  fail("REVISION_CONFLICT", {
    latest: {
      revision: String(doc.updatedAt ?? ""),
      updated_by: typeof doc.updated_by === "string" && UUID.test(doc.updated_by) ? doc.updated_by : null,
      updated_at: String(doc.updatedAt ?? ""),
    },
  });
}

function relationId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value && typeof value === "object" ? String((value as AnyDoc).id ?? "") || null : String(value);
}

/** Every media id an entry uses (main picture, gallery, seasons). */
function entryMediaIds(doc: AnyDoc): string[] {
  const ids = [relationId(doc.featured_image)];
  for (const row of Array.isArray(doc.gallery) ? doc.gallery : []) ids.push(relationId(row?.media));
  for (const row of Array.isArray(doc.seasons) ? doc.seasons : []) ids.push(relationId(row?.image));
  return ids.filter((id): id is string => Boolean(id));
}

/** A one-row summary for the app's list (no rich text). */
export function entrySummary(collection: ContentCollection, doc: AnyDoc, thumbs: ReadonlyMap<string, string>) {
  const featured = relationId(doc.featured_image);
  const gallery = Array.isArray(doc.gallery) ? doc.gallery : [];
  const base = {
    id: String(doc.id),
    revision: String(doc.updatedAt ?? ""),
    enabled: doc.enabled !== false,
    sort_order: typeof doc.sort_order === "number" ? doc.sort_order : null,
    thumb_url: featured ? thumbs.get(featured) ?? null : null,
  };
  if (collection === "destinations") {
    return {
      ...base,
      title: String(doc.title ?? ""),
      slug: String(doc.slug ?? ""),
      country: doc.country ?? null,
      tagline: doc.tagline ?? null,
      photo_count: (featured ? 1 : 0) + gallery.length,
      photos_missing_alt: gallery.filter((row: AnyDoc) => !(typeof row?.alt === "string" && row.alt.trim())).length,
      trip_count: Array.isArray(doc.related_offerings) ? doc.related_offerings.length : 0,
    };
  }
  if (collection === "stories") {
    return {
      ...base,
      title: String(doc.title ?? ""),
      slug: String(doc.slug ?? ""),
      category: relationId(doc.category),
      published_at: calendarDayOf(doc.published_at),
      excerpt: doc.excerpt ?? null,
    };
  }
  return {
    ...base,
    quote: String(doc.quote ?? ""),
    reviewer: String(doc.reviewer ?? ""),
    review_date: calendarDayOf(doc.review_date),
    trip_name: doc.trip_name ?? null,
    related_offering: doc.related_offering ?? null,
    confirmed: doc.confirmed_real === true,
    confirmed_at: doc.confirmed_at ?? null,
  };
}

/** The full editable entry for the editor (rich text as the site's tree). */
export function entryDetail(collection: ContentCollection, doc: AnyDoc, thumbs: ReadonlyMap<string, string>) {
  const summary = entrySummary(collection, doc, thumbs);
  const picture = (value: unknown) => {
    const id = relationId(value);
    return id ? { id, thumb_url: thumbs.get(id) ?? null } : null;
  };
  if (collection === "destinations") {
    return {
      ...summary,
      featured_image: picture(doc.featured_image),
      summary: doc.summary ?? null,
      facts: {
        language: doc.facts?.language ?? null,
        currency: doc.facts?.currency ?? null,
        religion: doc.facts?.religion ?? null,
        timezone: doc.facts?.timezone ?? null,
      },
      story_heading: doc.story_heading ?? null,
      body: richTextToAst(doc.body),
      seasons: (Array.isArray(doc.seasons) ? doc.seasons : []).map((row: AnyDoc) => ({
        heading: row.heading ?? "",
        body: row.body ?? null,
        activities: (Array.isArray(row.activities) ? row.activities : []).map((item: AnyDoc) => String(item.text ?? "")),
        image: picture(row.image),
      })),
      did_you_know: (Array.isArray(doc.did_you_know) ? doc.did_you_know : []).map((row: AnyDoc) => String(row.text ?? "")),
      related_offerings: (Array.isArray(doc.related_offerings) ? doc.related_offerings : []).map((row: AnyDoc) => String(row.offering_id ?? "")),
      gallery: (Array.isArray(doc.gallery) ? doc.gallery : []).map((row: AnyDoc) => ({ ...picture(row.media), alt: row.alt ?? null })),
      seo: { noindex: doc.seo?.noindex === true },
    };
  }
  if (collection === "stories") {
    return {
      ...summary,
      featured_image: picture(doc.featured_image),
      content: richTextToAst(doc.content),
      seo: { noindex: doc.seo?.noindex === true },
    };
  }
  return { ...summary, source_note: doc.source_note ?? null };
}

export type ContentCtx = {
  req: PayloadRequest;
  scoped: PayloadRequest;
  tenantId: string;
  request: ContentRequest;
};
type Ctx = ContentCtx;

export function scopedRequest(req: PayloadRequest, input: ContentRequest, tenantId: string, extra: AnyDoc = {}): PayloadRequest {
  return {
    ...req,
    context: { ...req.context, minglaSignedCore: true, ...extra },
    user: {
      id: input.userId,
      collection: "studio-users",
      siteId: input.siteId,
      brandId: input.brandId,
      tenantId,
      rank: input.rank,
      tenants: [{ tenant: tenantId }],
    } as never,
  } as PayloadRequest;
}

async function allEntries(ctx: Ctx, collection: ContentCollection | "categories"): Promise<AnyDoc[]> {
  const result = await ctx.req.payload.find({
    collection,
    req: ctx.scoped,
    overrideAccess: false,
    draft: true,
    depth: 0,
    pagination: false,
    sort: ["sort_order", "createdAt"],
    where: { tenant: { equals: ctx.tenantId } },
  });
  return result.docs as AnyDoc[];
}

async function oneEntry(ctx: Ctx, collection: ContentCollection | "categories", id: string): Promise<AnyDoc> {
  const result = await ctx.req.payload.find({
    collection,
    req: ctx.scoped,
    overrideAccess: false,
    draft: true,
    depth: 0,
    limit: 1,
    where: { and: [{ tenant: { equals: ctx.tenantId } }, { id: { equals: id } }] },
  });
  return (result.docs[0] as AnyDoc | undefined) ?? fail("NOT_FOUND");
}

/** One-hour links to the stored 640w renditions of this tenant's READY media. */
async function thumbsFor(ctx: Ctx, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter((id) => ENTRY_ID.test(id));
  const thumbs = new Map<string, string>();
  if (!unique.length) return thumbs;
  const media = await ctx.req.payload.find({
    collection: "media",
    overrideAccess: true,
    showHiddenFields: true,
    depth: 0,
    pagination: false,
    where: { and: [{ tenant: { equals: ctx.tenantId } }, { id: { in: unique } }, { state: { equals: "READY" } }] },
  });
  for (const item of media.docs as AnyDoc[]) {
    const key = renditionKey(item);
    if (key) thumbs.set(String(item.id), await presignedGet(cmsConfig().approvedBucket, key, THUMB_TTL_SECONDS));
  }
  return thumbs;
}

function renditionKey(item: AnyDoc): string | null {
  const manifest = item.rendition_manifest as { renditions?: Array<{ key?: string; width?: number }>; poster?: { key?: string } } | null;
  const rendition = manifest?.renditions?.find((row) => row.width === 640) ??
    manifest?.renditions?.find((row) => typeof row.key === "string");
  return typeof rendition?.key === "string" ? rendition.key : null;
}

async function freeSlug(ctx: Ctx, collection: ContentCollection | "categories", wanted: string): Promise<string> {
  const taken = new Set((await allEntries(ctx, collection)).map((doc) => String(doc.slug ?? "")));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${wanted.slice(0, MAX_SLUG_LENGTH - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return fail("SLUG_TAKEN");
}

function expected(args: AnyDoc): string {
  return typeof args.expected_revision === "string" && args.expected_revision ? args.expected_revision : fail("VALIDATION_FAILED");
}

async function update(ctx: Ctx, collection: ContentCollection | "categories", id: string, data: AnyDoc, req = ctx.scoped): Promise<AnyDoc> {
  try {
    return (await ctx.req.payload.update({
      collection,
      id,
      req,
      overrideAccess: false,
      draft: true,
      depth: 0,
      data: data as never,
    })) as AnyDoc;
  } catch (error) {
    if (error instanceof Error && error.name === "ValidationError" && /address/i.test(JSON.stringify((error as AnyDoc).data ?? error.message))) {
      fail("SLUG_TAKEN");
    }
    throw error;
  }
}

export async function runContentAction(ctx: Ctx): Promise<unknown> {
  const { action, args } = ctx.request;
  switch (action) {
    case "list": {
      const collection = collectionOf(args.collection);
      const docs = await allEntries(ctx, collection);
      const thumbs = await thumbsFor(ctx, docs.flatMap((doc) => {
        const featured = relationId(doc.featured_image);
        return featured ? [featured] : [];
      }));
      return {
        collection,
        revision: await listRevision(docs),
        reordered: docs.some((doc) => typeof doc.sort_order === "number"),
        entries: docs.map((doc) => entrySummary(collection, doc, thumbs)),
      };
    }
    case "get": {
      const collection = collectionOf(args.collection);
      const doc = await oneEntry(ctx, collection, entryIdOf(args.id));
      const thumbs = await thumbsFor(ctx, entryMediaIds(doc));
      return { collection, entry: entryDetail(collection, doc, thumbs) };
    }
    case "create": {
      const collection = collectionOf(args.collection);
      const data = shapeEntryData(collection, args.data ?? {});
      if (collection === "testimonials" && data.enabled === true) fail("REVIEW_NOT_CONFIRMED");
      const existing = await allEntries(ctx, collection);
      if (existing.length >= LIMITS[collection]) fail("CONTENT_LIMIT_EXCEEDED");
      const name = String(data.title ?? data.reviewer ?? "").trim();
      if (collection !== "testimonials" && !name) fail("TITLE_REQUIRED");
      if (collection === "testimonials" && !(typeof data.quote === "string" && data.quote)) fail("QUOTE_REQUIRED");
      if (collection !== "testimonials") data.slug = await freeSlug(ctx, collection, data.slug ?? slugify(name));
      if (collection === "stories" && !data.published_at) data.published_at = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
      // A new entry is a private draft until the owner shows it.
      if (data.enabled === undefined) data.enabled = false;
      // Entries appended after a reorder go to the end of the owner's order.
      if (existing.some((doc) => typeof doc.sort_order === "number")) data.sort_order = existing.length + 1;
      const created = (await ctx.req.payload.create({
        collection,
        req: ctx.scoped,
        overrideAccess: false,
        draft: true,
        depth: 0,
        data: { ...data, tenant: ctx.tenantId } as never,
      })) as AnyDoc;
      const thumbs = await thumbsFor(ctx, entryMediaIds(created));
      return { collection, entry: entryDetail(collection, created, thumbs), audit: { action: "content.created", collection, entry: String(created.id) } };
    }
    case "update": {
      const collection = collectionOf(args.collection);
      const id = entryIdOf(args.id);
      const doc = await oneEntry(ctx, collection, id);
      if (String(doc.updatedAt) !== expected(args)) conflict(doc);
      const data = shapeEntryData(collection, args.data ?? {});
      if (collection === "testimonials" && data.enabled === true && doc.confirmed_real !== true) fail("REVIEW_NOT_CONFIRMED");
      if (collection !== "testimonials" && has(data, "title") && !data.title) fail("TITLE_REQUIRED");
      if (collection === "testimonials" && has(data, "quote") && !data.quote) fail("QUOTE_REQUIRED");
      if (has(data, "slug") && data.slug === null) delete data.slug;
      const oldSlug = typeof doc.slug === "string" ? doc.slug : null;
      const updated = await update(ctx, collection, id, data);
      // "Changing it later keeps the old address working": a permanent
      // redirect from the old page address to the new one.
      if (collection !== "testimonials" && oldSlug && typeof updated.slug === "string" && updated.slug !== oldSlug) {
        await keepOldAddress(ctx, collection, oldSlug, updated.slug);
      }
      const thumbs = await thumbsFor(ctx, entryMediaIds(updated));
      return { collection, entry: entryDetail(collection, updated, thumbs), audit: { action: "content.updated", collection, entry: id } };
    }
    case "set_visibility": {
      const collection = collectionOf(args.collection);
      const id = entryIdOf(args.id);
      const doc = await oneEntry(ctx, collection, id);
      if (String(doc.updatedAt) !== expected(args)) conflict(doc);
      const enabled = bool(args.enabled);
      if (collection === "testimonials" && enabled && doc.confirmed_real !== true) fail("REVIEW_NOT_CONFIRMED");
      const updated = await update(ctx, collection, id, { enabled });
      return {
        collection,
        entry: entrySummary(collection, updated, new Map()),
        audit: { action: "content.visibility", collection, entry: id, visible: enabled },
      };
    }
    case "delete": {
      const collection = collectionOf(args.collection);
      const id = entryIdOf(args.id);
      const doc = await oneEntry(ctx, collection, id);
      if (String(doc.updatedAt) !== expected(args)) conflict(doc);
      await ctx.req.payload.delete({ collection, id, req: ctx.scoped, overrideAccess: false, depth: 0 });
      return { collection, deleted: id, audit: { action: "content.deleted", collection, entry: id } };
    }
    case "reorder":
    case "reorder_categories": {
      const collection = action === "reorder" ? collectionOf(args.collection) : "categories";
      const docs = await allEntries(ctx, collection);
      if (typeof args.expected_list_revision !== "string" || args.expected_list_revision !== await listRevision(docs)) {
        fail("REVISION_CONFLICT", { latest: { revision: await listRevision(docs), updated_by: null, updated_at: null } });
      }
      const ids = list(args.ids, docs.length, (value) => entryIdOf(value));
      const current = new Set(docs.map((doc) => String(doc.id)));
      if (ids.length !== docs.length || new Set(ids).size !== ids.length || ids.some((id) => !current.has(id))) fail("VALIDATION_FAILED");
      const byId = new Map(docs.map((doc) => [String(doc.id), doc]));
      for (const [index, id] of ids.entries()) {
        if (byId.get(id)?.sort_order !== index + 1) await update(ctx, collection, id, { sort_order: index + 1 });
      }
      const after = await allEntries(ctx, collection);
      return {
        collection,
        revision: await listRevision(after),
        ids: after.map((doc) => String(doc.id)),
        audit: { action: "content.reordered", collection, count: ids.length },
      };
    }
    case "confirm_review": {
      const id = entryIdOf(args.id);
      const doc = await oneEntry(ctx, "testimonials", id);
      if (String(doc.updatedAt) !== expected(args)) conflict(doc);
      const confirmed = bool(args.confirmed);
      // The one path that may set "confirmed as real" (Core checked rank 50).
      const confirmReq = scopedRequest(ctx.req, ctx.request, ctx.tenantId, { minglaConfirmReview: true });
      const updated = await update(ctx, "testimonials", id, { confirmed_real: confirmed }, confirmReq);
      if ((updated.confirmed_real === true) !== confirmed) fail("FORBIDDEN");
      return {
        collection: "testimonials",
        entry: entrySummary("testimonials", updated, new Map()),
        audit: { action: confirmed ? "content.review_confirmed" : "content.review_unconfirmed", collection: "testimonials", entry: id, visible: updated.enabled === true },
      };
    }
    case "categories": {
      const [categories, stories] = await Promise.all([allEntries(ctx, "categories"), allEntries(ctx, "stories")]);
      const uses = new Map<string, number>();
      for (const story of stories) {
        const category = relationId(story.category);
        if (category) uses.set(category, (uses.get(category) ?? 0) + 1);
      }
      return {
        revision: await listRevision(categories),
        categories: categories.map((doc) => ({
          id: String(doc.id),
          title: String(doc.title ?? ""),
          slug: String(doc.slug ?? ""),
          revision: String(doc.updatedAt ?? ""),
          story_count: uses.get(String(doc.id)) ?? 0,
        })),
      };
    }
    case "create_category": {
      const title = cap(args.title, 80) ?? fail("TITLE_REQUIRED");
      const existing = await allEntries(ctx, "categories");
      if (existing.length >= MAX_CATEGORIES) fail("CONTENT_LIMIT_EXCEEDED");
      const created = (await ctx.req.payload.create({
        collection: "categories",
        req: ctx.scoped,
        overrideAccess: false,
        draft: true,
        depth: 0,
        data: {
          tenant: ctx.tenantId,
          title,
          slug: await freeSlug(ctx, "categories", slugify(title)),
          ...(existing.some((doc) => typeof doc.sort_order === "number") ? { sort_order: existing.length + 1 } : {}),
        } as never,
      })) as AnyDoc;
      return { id: String(created.id), audit: { action: "content.created", collection: "categories", entry: String(created.id) } };
    }
    case "rename_category": {
      const id = entryIdOf(args.id);
      const doc = await oneEntry(ctx, "categories", id);
      if (String(doc.updatedAt) !== expected(args)) conflict(doc);
      const title = cap(args.title, 80) ?? fail("TITLE_REQUIRED");
      await update(ctx, "categories", id, { title });
      return { id, audit: { action: "content.updated", collection: "categories", entry: id } };
    }
    case "delete_category": {
      const id = entryIdOf(args.id);
      const doc = await oneEntry(ctx, "categories", id);
      if (String(doc.updatedAt) !== expected(args)) conflict(doc);
      const stories = await allEntries(ctx, "stories");
      if (stories.some((story) => relationId(story.category) === id)) fail("CATEGORY_IN_USE");
      await ctx.req.payload.delete({ collection: "categories", id, req: ctx.scoped, overrideAccess: false, depth: 0 });
      return { deleted: id, audit: { action: "content.deleted", collection: "categories", entry: id } };
    }
    case "media_upload_grant": {
      const grant = await createUploadGrant(ctx.scoped, {
        filename: String(args.filename || "photo").slice(0, 160),
        content_type: String(args.content_type || ""),
        bytes: Number(args.bytes),
      });
      return { ...grant, audit: { action: "media.upload_requested", collection: "media", entry: String(grant.media_id) } };
    }
    case "media_complete": {
      const id = entryIdOf(args.media_id);
      const media = (await completeUpload(ctx.scoped, id, String(args.checksum || ""), Number(args.bytes))) as AnyDoc | null;
      if (!media) fail("MEDIA_REJECTED");
      return { media_id: String(media.id), state: media.state, rejection_code: media.rejection_code ?? null };
    }
    case "media_status": {
      const id = entryIdOf(args.media_id);
      const media = (await ctx.req.payload.find({
        collection: "media",
        overrideAccess: true,
        showHiddenFields: true,
        depth: 0,
        limit: 1,
        where: { and: [{ tenant: { equals: ctx.tenantId } }, { id: { equals: id } }] },
      })).docs[0] as AnyDoc | undefined;
      if (!media) fail("NOT_FOUND");
      const thumbs = media.state === "READY" ? await thumbsFor(ctx, [id]) : new Map<string, string>();
      return { media_id: id, state: media.state, rejection_code: media.rejection_code ?? null, thumb_url: thumbs.get(id) ?? null };
    }
    case "media_library": {
      const media = await ctx.req.payload.find({
        collection: "media",
        overrideAccess: true,
        showHiddenFields: true,
        depth: 0,
        limit: 60,
        sort: "-updatedAt",
        where: { and: [{ tenant: { equals: ctx.tenantId } }, { state: { equals: "READY" } }] },
      });
      const docs = (media.docs as AnyDoc[]).filter((item) => String(item.declared_mime ?? "").startsWith("image/"));
      const thumbs = await thumbsFor(ctx, docs.map((item) => String(item.id)));
      return {
        media: docs.map((item) => ({
          id: String(item.id),
          filename: String(item.original_filename_safe || "Website photo"),
          width: typeof item.width === "number" ? item.width : null,
          height: typeof item.height === "number" ? item.height : null,
          thumb_url: thumbs.get(String(item.id)) ?? null,
        })),
      };
    }
    case "font_search": {
      // The whole catalogue (~1,700 families) stays in Studio; the app asks.
      const query = typeof args.query === "string" ? args.query.slice(0, 64) : "";
      const category = typeof args.category === "string" &&
          ["sans-serif", "serif", "display", "handwriting", "monospace"].includes(args.category)
        ? (args.category as FontCategory)
        : undefined;
      return {
        fonts: searchCatalogFonts(query, { category, limit: 30 }).map((font) => ({
          family: font.family,
          category: font.category,
        })),
      };
    }
    case "font_previews": {
      /*
       * Specimens for the app's font rows: the same validated, content-
       * addressed woff2 Studio's preview serves (fetched once by the font
       * pipeline from fonts.gstatic.com, never by a visitor), as one-hour
       * links. At most 12 families per call (rows load as they scroll in).
       */
      const families = list(args.families, 12, (value) => {
        if (typeof value !== "string" || !isFontFamilyName(value)) fail("VALIDATION_FAILED");
        return value;
      });
      // #2829 W11 (A17): the app on iPhone/Android asks for TrueType.
      const ttf = args.format === "ttf";
      if (args.format !== undefined && args.format !== "woff2" && !ttf) fail("VALIDATION_FAILED");
      const previews: Array<{ family: string; url: string | null }> = [];
      for (const family of families) {
        const font = findCatalogFont(family);
        if (!font) {
          previews.push({ family, url: null });
          continue;
        }
        if (ttf) {
          try {
            const face = await ttfPreviewFace(payloadTtfPipeline(ctx.req), family, nearestWeight(400, font.weights));
            previews.push({ family, url: await presignedGet(cmsConfig().approvedBucket, ttfObjectKey(face.digest), THUMB_TTL_SECONDS) });
          } catch {
            previews.push({ family, url: null });
          }
          continue;
        }
        try {
          const faces = await facesForSlot(
            payloadFontPipeline(ctx.req),
            { family, weights: [nearestWeight(400, font.weights)], italic: false },
            ["latin"],
          );
          const face = faces.find((candidate) => candidate.style === "normal") ?? faces[0];
          previews.push({
            family,
            url: face ? await presignedGet(cmsConfig().approvedBucket, fontObjectKey(face.digest), THUMB_TTL_SECONDS) : null,
          });
        } catch {
          // A family Google can't serve right now shows its name in the system face.
          previews.push({ family, url: null });
        }
      }
      return { previews };
    }
    case "cover":
    case "set_cover": {
      // The big photo or video at the top of the home page: the home page's
      // first hero (its required picture, and the optional background film).
      const pages = await findAllTenantPages(ctx.scoped, ctx.tenantId);
      const home = (pages as AnyDoc[]).find((page) => !page.parent && (page.slug ?? "") === "");
      const blocks = Array.isArray(home?.blocks) ? home!.blocks as AnyDoc[] : [];
      const heroIndex = blocks.findIndex((block) => block.blockType === "hero");
      if (!home || heroIndex < 0) {
        if (action === "cover") return { available: false, revision: null, photo: null, video: null };
        fail("NOT_FOUND");
      }
      const hero = blocks[heroIndex]!;
      if (action === "set_cover") {
        if (String(home.revision ?? "") !== expected(args)) conflict({ updatedAt: home.revision, updated_by: home.updated_by });
        const next = { ...hero };
        if (has(args, "photo_media_id")) {
          const photo = mediaIdOf(args.photo_media_id);
          if (!photo) fail("VALIDATION_FAILED"); // the home page always needs its picture
          next.media = photo;
        }
        if (has(args, "video_media_id")) {
          const video = mediaIdOf(args.video_media_id);
          if (video) {
            const doc = (await ctx.req.payload.find({
              collection: "media", overrideAccess: true, showHiddenFields: true, depth: 0, limit: 1,
              where: { and: [{ tenant: { equals: ctx.tenantId } }, { id: { equals: video } }, { state: { equals: "READY" } }] },
            })).docs[0] as AnyDoc | undefined;
            if (!doc || doc.detected_mime !== "video/mp4") fail("VALIDATION_FAILED");
            if (typeof doc.duration_ms === "number" && doc.duration_ms > 15_000) fail("VIDEO_TOO_LONG");
          }
          next.video = video;
        }
        const nextBlocks = blocks.map((block, index) => (index === heroIndex ? next : block));
        await ctx.req.payload.update({
          collection: "pages", id: home.id, req: ctx.scoped, overrideAccess: false, draft: true, depth: 0,
          data: { blocks: nextBlocks, revision: home.revision } as never,
        });
        return { saved: true, audit: { action: "content.updated", collection: "pages", entry: String(home.id) } };
      }
      const photoId = relationId(hero.media);
      const videoId = relationId(hero.video);
      const media = (await ctx.req.payload.find({
        collection: "media", overrideAccess: true, showHiddenFields: true, depth: 0, pagination: false,
        where: { and: [{ tenant: { equals: ctx.tenantId } }, { id: { in: [photoId, videoId].filter(Boolean) as string[] } }] },
      })).docs as AnyDoc[];
      const thumbs = await thumbsFor(ctx, [photoId, videoId].filter(Boolean) as string[]);
      const describe = (id: string | null) => {
        const doc = media.find((item) => String(item.id) === id);
        return id && doc ? {
          id,
          name: String(doc.original_filename_safe ?? "Cover"),
          thumb_url: thumbs.get(id) ?? null,
          duration_ms: typeof doc.duration_ms === "number" ? doc.duration_ms : null,
        } : null;
      };
      return { available: true, revision: String(home.revision ?? ""), photo: describe(photoId), video: describe(videoId) };
    }
    case "design_checks": {
      // #2829 W9b — the Publish review runs the six checks on open. Core put
      // the Mingla facts in `evidence` (never the caller); results are stored
      // against this exact draft, which is what a first publish needs.
      const { parseAriEvidence, runDesignChecksFor } = await import("../lib/ariSiteActions");
      return runDesignChecksFor({
        req: ctx.req,
        scoped: ctx.scoped,
        tenantId: ctx.tenantId,
        siteId: ctx.request.siteId,
        brandId: ctx.request.brandId,
        userId: ctx.request.userId,
        rank: ctx.request.rank,
        evidence: parseAriEvidence(args.evidence, ctx.request.brandId),
      }, "user");
    }
    case "work_log": {
      // #2829 W9b — newest first; the decision and its citations, never
      // anything a visitor sees. Quotes are the owner's own words.
      const result = await ctx.req.payload.find({
        collection: "work-log",
        overrideAccess: true,
        depth: 0,
        limit: 50,
        sort: "-createdAt",
        where: { tenant: { equals: ctx.tenantId } },
      });
      return {
        entries: (result.docs as AnyDoc[]).map((doc) => ({
          id: String(doc.id),
          part: String(doc.part ?? ""),
          decision: String(doc.decision ?? ""),
          cites: Array.isArray(doc.cites) ? doc.cites : [],
          actor: doc.actor === "user" ? "user" : "ari",
          target: typeof doc.target === "string" ? doc.target : null,
          created_at: String(doc.createdAt ?? ""),
        })),
      };
    }
    case "pages": {
      // The site's pages in menu order (the header menu is Navigation's
      // top-level page items), then the rest; footer links as they are.
      const [pages, navigation, footer] = await Promise.all([
        findAllTenantPages(ctx.scoped, ctx.tenantId),
        siteSingleton(ctx, "navigation"),
        siteSingleton(ctx, "footer"),
      ]);
      const { tenantPagePaths } = await import("../lib/pageTree");
      let paths = new Map<string, string>();
      try {
        paths = tenantPagePaths(pages as never);
      } catch {
        // An unresolvable tree still lists its pages (publish names the problem).
      }
      const items = (Array.isArray(navigation?.items) ? navigation.items : []) as AnyDoc[];
      const menuOrder = new Map<string, number>();
      items.forEach((item, index) => {
        const id = relationId(item.page);
        if (item.target_type !== "url" && id && !menuOrder.has(id)) menuOrder.set(id, index);
        for (const child of Array.isArray(item.children) ? item.children as AnyDoc[] : []) {
          const childId = relationId(child.page);
          if (childId && !menuOrder.has(childId)) menuOrder.set(childId, index + 0.5);
        }
      });
      const rows = (pages as AnyDoc[]).map((page) => ({
        id: String(page.id),
        title: String(page.title ?? "Page"),
        path: paths.get(String(page.id)) ?? null,
        kind: page.kind ?? "standard",
        collection_kind: page.collection_kind ?? null,
        planned_offering: page.planned_offering ?? null,
        enabled: page.enabled !== false,
        in_menu: menuOrder.has(String(page.id)),
        in_group: items.some((item) => (Array.isArray(item.children) ? item.children as AnyDoc[] : []).some((child) => relationId(child.page) === String(page.id))),
        menu_index: menuOrder.get(String(page.id)) ?? null,
        revision: String(page.updatedAt ?? ""),
      }));
      rows.sort((a, b) => {
        if (a.path === "") return -1;
        if (b.path === "") return 1;
        const ai = a.menu_index ?? Number.POSITIVE_INFINITY;
        const bi = b.menu_index ?? Number.POSITIVE_INFINITY;
        return ai === bi ? a.title.localeCompare(b.title) : ai - bi;
      });
      const footerLinks = ((Array.isArray(footer?.links) ? footer.links : []) as AnyDoc[]).map((link) => ({ label: String(link.label ?? ""), href: String(link.href ?? "") }));
      return {
        revision: String(navigation?.updatedAt ?? ""),
        wordmark: typeof navigation?.wordmark === "string" ? navigation.wordmark : null,
        pages: rows,
        footer_links: footerLinks,
      };
    }
    case "set_menu": {
      // The owner's header menu: these pages, in this order. Links to other
      // addresses and grouped ("More") items are kept as they were.
      const navigation = await siteSingleton(ctx, "navigation");
      if (!navigation) fail("NOT_FOUND");
      if (String(navigation.updatedAt) !== expected(args)) conflict(navigation);
      const pages = await findAllTenantPages(ctx.scoped, ctx.tenantId);
      const byId = new Map((pages as AnyDoc[]).map((page) => [String(page.id), page]));
      const wanted = list(args.page_ids, MAX_NAV_ITEMS, (value) => entryIdOf(value));
      if (new Set(wanted).size !== wanted.length || wanted.some((id) => !byId.has(id))) fail("VALIDATION_FAILED");
      const items = (Array.isArray(navigation.items) ? navigation.items : []) as AnyDoc[];
      const keep = items.filter((item) => item.target_type === "url" || (Array.isArray(item.children) && item.children.length > 0));
      const existing = new Map(items.filter((item) => item.target_type !== "url").map((item) => [relationId(item.page) ?? "", item]));
      const next = [
        ...wanted.map((id) => {
          const item = existing.get(id);
          if (item && !(Array.isArray(item.children) && item.children.length > 0)) {
            const { id: _rowId, ...rest } = item;
            return { ...rest, page: id };
          }
          return { label: String(byId.get(id)!.title ?? "Page").slice(0, 40), target_type: "page", page: id };
        }),
        ...keep.map(({ id: _rowId, ...rest }) => rest),
      ];
      if (next.length > MAX_NAV_ITEMS) fail("CONTENT_LIMIT_EXCEEDED");
      const updated = (await ctx.req.payload.update({
        collection: "navigation",
        id: navigation.id,
        req: ctx.scoped,
        overrideAccess: false,
        draft: true,
        depth: 0,
        data: { items: next } as never,
      })) as AnyDoc;
      return { revision: String(updated.updatedAt ?? ""), audit: { action: "content.updated", collection: "navigation", entry: String(navigation.id) } };
    }
    case "draft_changes": {
      const key = args.active_artifact_key;
      let published: Published | null = null;
      if (typeof key === "string") {
        if (!/^publications\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}\.json$/.test(key) ||
          !key.startsWith(`publications/${ctx.request.siteId}/`)) fail("FORBIDDEN");
        published = JSON.parse(new TextDecoder().decode(await readObject(cmsConfig().artifactBucket, key))) as Published;
      }
      const one = async (collection: "site-settings" | "navigation" | "footer") =>
        ((await ctx.req.payload.find({
          collection,
          req: ctx.scoped,
          overrideAccess: false,
          draft: true,
          depth: 0,
          limit: 1,
          where: { tenant: { equals: ctx.tenantId } },
        })).docs[0] as AnyDoc | undefined) ?? null;
      const [settings, navigation, footer, pages, destinations, stories, testimonials] = await Promise.all([
        one("site-settings"),
        one("navigation"),
        one("footer"),
        findAllTenantPages(ctx.scoped, ctx.tenantId),
        allEntries(ctx, "destinations"),
        allEntries(ctx, "stories"),
        allEntries(ctx, "testimonials"),
      ]);
      const pagePaths = new Map<string, string>();
      try {
        const { tenantPagePaths } = await import("../lib/pageTree");
        for (const [id, path] of tenantPagePaths(pages as never)) pagePaths.set(id, path);
      } catch {
        // A draft whose page tree doesn't resolve still lists its edits as edits.
      }
      const changes = draftChanges({
        published,
        settings,
        navigation,
        footer,
        pages: pages as AnyDoc[],
        pagePaths,
        content: { destinations, stories, testimonials },
      });
      return { published_at: published?.generated_at ?? null, changes };
    }
    case "get_display": {
      const settings = await siteSettings(ctx);
      return {
        revision: String(settings.updatedAt ?? ""),
        hidden_offering_ids: Array.isArray(settings.hidden_offering_ids) ? settings.hidden_offering_ids : [],
      };
    }
    case "set_offering_visibility": {
      const settings = await siteSettings(ctx);
      if (String(settings.updatedAt) !== expected(args)) conflict(settings);
      const offering = offeringOf(args.offering_id);
      const hidden = bool(args.hidden);
      const current = new Set<string>(Array.isArray(settings.hidden_offering_ids) ? settings.hidden_offering_ids : []);
      if (hidden) current.add(offering);
      else current.delete(offering);
      if (current.size > 500) fail("CONTENT_LIMIT_EXCEEDED");
      const visibilityReq = scopedRequest(ctx.req, ctx.request, ctx.tenantId, { minglaOfferingVisibility: true });
      const updated = (await ctx.req.payload.update({
        collection: "site-settings",
        id: settings.id,
        req: visibilityReq,
        overrideAccess: false,
        draft: true,
        depth: 0,
        data: { hidden_offering_ids: [...current].sort() } as never,
      })) as AnyDoc;
      return {
        revision: String(updated.updatedAt ?? ""),
        hidden_offering_ids: Array.isArray(updated.hidden_offering_ids) ? updated.hidden_offering_ids : [],
        audit: { action: "content.offering_visibility", collection: "offerings", entry: offering, visible: !hidden },
      };
    }
    default:
      return fail("VALIDATION_FAILED");
  }
}

async function keepOldAddress(ctx: Ctx, collection: "destinations" | "stories", from: string, to: string): Promise<void> {
  const settings = await siteSettings(ctx);
  const routes = (settings.routes ?? {}) as Record<string, unknown>;
  const base = typeof routes[collection] === "string" ? String(routes[collection]) : DEFAULT_SITE_ROUTES[collection];
  const path = (slug: string) => `/${[base, slug].filter(Boolean).join("/")}`;
  const rows = (Array.isArray(settings.redirects) ? settings.redirects : []) as AnyDoc[];
  const kept = rows
    .filter((row) => row.from !== path(from))
    .map((row) => ({ from: row.from, to: row.to === path(from) ? path(to) : row.to, status: row.status }));
  if (kept.length >= MAX_REDIRECTS) return; // the old address then simply stops working; the site stays valid
  await ctx.req.payload.update({
    collection: "site-settings",
    id: settings.id,
    req: ctx.scoped,
    overrideAccess: false,
    draft: true,
    depth: 0,
    data: { redirects: [...kept, { from: path(from), to: path(to), status: "308" }] } as never,
  });
}

async function siteSingleton(ctx: Ctx, collection: "navigation" | "footer"): Promise<AnyDoc | null> {
  return ((await ctx.req.payload.find({
    collection,
    req: ctx.scoped,
    overrideAccess: false,
    draft: true,
    depth: 0,
    limit: 1,
    where: { tenant: { equals: ctx.tenantId } },
  })).docs[0] as AnyDoc | undefined) ?? null;
}

async function siteSettings(ctx: Ctx): Promise<AnyDoc> {
  const result = await ctx.req.payload.find({
    collection: "site-settings",
    req: ctx.scoped,
    overrideAccess: false,
    draft: true,
    depth: 0,
    limit: 1,
    where: { tenant: { equals: ctx.tenantId } },
  });
  return (result.docs[0] as AnyDoc | undefined) ?? fail("NOT_FOUND");
}

export type DraftChange = { section: string; title: string; detail: string };

type Published = {
  generated_at?: string;
  pages?: Array<{ path?: string; title?: string }>;
  collections?: Partial<Record<"destinations" | "stories" | "testimonials", Array<{ id?: string }>>>;
  site_display?: { hidden_offering_ids?: string[]; settings_digest?: string };
};

const COLLECTION_WORDS: Record<ContentCollection, { section: string; title: string; one: string; many: string }> = {
  destinations: { section: "destinations", title: "Destinations", one: "destination", many: "destinations" },
  stories: { section: "stories", title: "Stories", one: "story", many: "stories" },
  testimonials: { section: "reviews", title: "Reviews", one: "review", many: "reviews" },
};

function newer(value: unknown, since: number): boolean {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) && time > since;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * #2829 W9r — "N changes since you last published": what the draft has that
 * the live version doesn't, in the owner's words, each pointing at its
 * section. Entries and pages saved after the live version was made count as
 * changed; collection entries the live version shows but the draft no longer
 * does (hidden or deleted) count as removed. Nothing published yet: everything
 * is new.
 */
export function draftChanges(input: {
  published: Published | null;
  settings: AnyDoc | null;
  navigation: AnyDoc | null;
  footer: AnyDoc | null;
  pages: AnyDoc[];
  pagePaths: ReadonlyMap<string, string>;
  content: Record<ContentCollection, AnyDoc[]>;
}): DraftChange[] {
  const since = input.published ? Date.parse(String(input.published.generated_at ?? "")) : Number.NEGATIVE_INFINITY;
  const changes: DraftChange[] = [];
  if (!input.published) {
    changes.push({ section: "pages", title: "Your whole website", detail: "Not published yet" });
    return changes;
  }
  if (input.settings && newer(input.settings.updatedAt, since)) {
    const hiddenNow = new Set<string>(Array.isArray(input.settings.hidden_offering_ids) ? input.settings.hidden_offering_ids : []);
    const hiddenLive = new Set(input.published.site_display?.hidden_offering_ids ?? []);
    const hiddenChanged = hiddenNow.size !== hiddenLive.size || [...hiddenNow].some((id) => !hiddenLive.has(id));
    if (hiddenChanged) {
      changes.push({ section: "past", title: "Past trips", detail: "Which trips show in Trips we've run" });
    }
    // A version built before the digest existed can only be compared by time.
    const liveDigest = input.published.site_display?.settings_digest;
    if (liveDigest ? settingsDigest(input.settings) !== liveDigest : !hiddenChanged) {
      changes.push({ section: "design", title: "Website design", detail: "Colours, fonts or other settings" });
    }
  }
  const livePaths = new Set((input.published.pages ?? []).map((page) => String(page.path ?? "")));
  const changedPages = input.pages.filter((page) => newer(page.updatedAt, since));
  const newPages = changedPages.filter((page) => !livePaths.has(input.pagePaths.get(String(page.id)) ?? "\u0000"));
  const editedPages = changedPages.filter((page) => livePaths.has(input.pagePaths.get(String(page.id)) ?? "\u0000"));
  if (newPages.length) {
    changes.push({ section: "pages", title: "Pages", detail: `New: ${newPages.map((page) => String(page.title ?? "Page")).slice(0, 3).join(", ")}` });
  }
  if (editedPages.length) {
    changes.push({ section: "pages", title: "Pages", detail: `Edited: ${editedPages.map((page) => String(page.title ?? "Page")).slice(0, 3).join(", ")}` });
  }
  if ((input.navigation && newer(input.navigation.updatedAt, since)) || (input.footer && newer(input.footer.updatedAt, since))) {
    changes.push({ section: "pages", title: "Menu", detail: "The menu or footer changed" });
  }
  for (const collection of CONTENT_COLLECTIONS) {
    const words = COLLECTION_WORDS[collection];
    const live = new Set((input.published.collections?.[collection] ?? []).map((row) => String(row.id ?? "")));
    const docs = input.content[collection] ?? [];
    const shown = (doc: AnyDoc) => doc.enabled !== false && (collection !== "testimonials" || doc.confirmed_real === true);
    const added = docs.filter((doc) => shown(doc) && !live.has(String(doc.id)));
    const edited = docs.filter((doc) => shown(doc) && live.has(String(doc.id)) && newer(doc.updatedAt, since));
    const draftShown = new Set(docs.filter(shown).map((doc) => String(doc.id)));
    const removed = [...live].filter((id) => !draftShown.has(id));
    const reordered = docs.some((doc) => newer(doc.updatedAt, since)) && docs.some((doc) => typeof doc.sort_order === "number");
    const parts = [
      added.length ? `${plural(added.length, `new ${words.one}`, `new ${words.many}`)}` : "",
      edited.length ? `${plural(edited.length, `${words.one} edited`, `${words.many} edited`)}` : "",
      removed.length ? `${plural(removed.length, `${words.one} hidden or removed`, `${words.many} hidden or removed`)}` : "",
    ].filter(Boolean);
    if (!parts.length && reordered) parts.push("New order");
    if (parts.length) changes.push({ section: words.section, title: words.title, detail: parts.join(" · ") });
  }
  return changes;
}

const NAMED_CODES = new Set([
  "FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED", "REVISION_CONFLICT", "REVIEW_NOT_CONFIRMED",
  "TITLE_REQUIRED", "QUOTE_REQUIRED", "SLUG_TAKEN", "SLUG_INVALID", "CATEGORY_IN_USE",
  "CONTENT_LIMIT_EXCEEDED", "MEDIA_REJECTED", "MEDIA_PROCESSING", "VIDEO_TOO_LONG",
]);

export function contentFailure(error: unknown): Response {
  let code = error instanceof Error ? error.message : "";
  if (error instanceof Error && error.name === "ValidationError") code = "VALIDATION_FAILED";
  if (code === "SIGNATURE_INVALID" || code === "REPLAY_DETECTED") code = "FORBIDDEN";
  if (!NAMED_CODES.has(code)) code = "SERVICE_TEMPORARILY_UNAVAILABLE";
  const extra = error instanceof ContentError ? error.extra ?? {} : {};
  return sitesJsonResponse(
    { ok: false, error: { code, ...extra } },
    code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : code === "SERVICE_TEMPORARILY_UNAVAILABLE" ? 503 : 409,
  );
}

async function contentHandler(req: PayloadRequest): Promise<Response> {
  try {
    const raw = (await req.text?.()) || "";
    const envelope = await verifyCoreRequest(req, raw, "/api/internal/content");
    const request = parseContentBody(JSON.parse(raw), envelope.site_id);
    const tenant = (await req.payload.find({
      collection: "tenants",
      overrideAccess: true,
      depth: 0,
      limit: 1,
      where: { core_site_id: { equals: envelope.site_id } },
    })).docs[0] as AnyDoc | undefined;
    if (!tenant || tenant.core_brand_id !== request.brandId) fail("FORBIDDEN");
    const tenantId = String(tenant.id);
    const data = await runContentAction({ req, scoped: scopedRequest(req, request, tenantId), tenantId, request });
    return sitesJsonResponse({ ok: true, data }, 200);
  } catch (error) {
    return contentFailure(error);
  }
}

export const contentEndpoints: Endpoint[] = [
  {
    path: "/internal/content",
    method: "post",
    handler: observeCmsEndpoint("/internal/content", "core_to_cms", contentHandler),
  },
];
