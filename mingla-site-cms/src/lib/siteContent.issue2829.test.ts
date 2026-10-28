/*
 * #2829 W5 (T-W5, SC-23) — Studio's content collections reach a publication
 * exactly, and only as they should.
 *
 *  - enabled destinations, stories and categories, and testimonials ONLY when
 *    confirmed as real, are frozen into the artifact (no source note, no
 *    unconfirmed quote), the owner's words verbatim, rich text as the closed
 *    tree, days as the day the editor picked, pictures as this site's media;
 *  - the collection, history and form blocks are shaped from Studio rows; a
 *    list with nothing to show is dropped; the ledger and linked reviews read
 *    the feed (frozen as the snapshot);
 *  - the draft digest covers the content (an edit after validate is a
 *    conflict) and is unchanged for a site with no content;
 *  - "confirmed as real" cannot be written through Core's signed (Ari) path;
 *  - a picture used only by a destination is "in use" to retention;
 *  - an over-limit tenant is refused, never truncated.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, Uint8Array>();
const projectionCalls: Array<{ feed: boolean }> = [];
vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
vi.mock("./gateway", () => ({
  readCoreProjection: async (_path: string, _site: string, _op: string, _ids: string[], _menu: boolean, _venue: boolean, includeFeed: boolean) => {
    projectionCalls.push({ feed: includeFeed });
    return { offerings: [], feed: includeFeed ? FEED : null, menu: [], menu_venue_id: null };
  },
}));
vi.mock("./objectStore", () => ({
  writeObject: async (bucket: string, key: string, bytes: Uint8Array) => { stored.set(`${bucket}:${key}`, bytes); },
  readObject: async (bucket: string, key: string) => {
    const value = stored.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
}));

import { assertArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";
import type { FontPipelineDeps } from "./fontAssets";
import { calendarDayOf, contentMediaIds, ContentLimitExceededError, findTenantContent, shapeSiteCollections, type TenantContent } from "./siteContent";
import { richTextToAst } from "./richTextToAst";
import { confirmedRealAccess, Destinations, Testimonials } from "../collections/SiteContent";
import { tombstoneMedia } from "./mediaPipeline";

const SITE = "00000000-0000-4000-8000-000000000001";
const BRAND = "00000000-0000-4000-8000-000000000002";
const PICTURE = "00000000-0000-4000-8000-0000000000aa";
const DEST_A = "00000000-0000-4000-8000-0000000000d1";
const DEST_OFF = "00000000-0000-4000-8000-0000000000d2";
const STORY = "00000000-0000-4000-8000-0000000000e1";
const CATEGORY = "00000000-0000-4000-8000-0000000000c1";
const REVIEW_OK = "00000000-0000-4000-8000-0000000000f1";
const REVIEW_UNCONFIRMED = "00000000-0000-4000-8000-0000000000f2";
const TRIP = "11111111-1111-4111-8111-000000000001";
const TRIP_2 = "11111111-1111-4111-8111-000000000002";

const FEED = {
  generated_at: "2026-10-26T00:00:00.000Z",
  brand: { slug: "fixture", currency: "USD", payment_rails: "stripe" },
  offerings: [TRIP, TRIP_2].map((id, index) => ({
    id, kind: "trip", slug: `trip-${index}`, title: `Trip ${index}`, summary: null, cover: null, destination_text: "Coast",
    start_at: `2025-0${index + 1}-14T05:00:00+00:00`, end_at: `2025-0${index + 1}-15T04:59:00+00:00`, timezone: "America/New_York", status: "ended",
    bookings_closed: true, capacity: null, spots_left: null, group_minimum: null, min_price_minor: null, currency: null,
    has_free_tier: false, public_url: `https://host.usemingla.com/t/fixture/trip-${index}`, waitlist_enabled: false, installments_available: false,
  })),
};

const lexical = (children: unknown[]) => ({ root: { type: "root", children } });
const paragraph = (text: string, format = 0) => ({ type: "paragraph", children: [{ type: "text", text, format }] });

const media = {
  id: PICTURE,
  tenant: "t1",
  state: "READY",
  width: 2000,
  height: 1000,
  rendition_manifest: {
    renditions: [{ width: 1440, target_width: 1440, digest: "a".repeat(64), key: `approved/${SITE}/${PICTURE}/${"a".repeat(64)}/1440.webp` }],
  },
};

function content(): TenantContent {
  return {
    destinations: [
      {
        id: DEST_A, slug: "harbour-coast", title: " Harbour Coast ", country: "Fixtureland", featured_image: PICTURE,
        tagline: "Salt air.", facts: { language: "Fixture tongue", currency: "", religion: null, timezone: "Coast time" },
        body: lexical([{ type: "heading", tag: "h2", children: [{ type: "text", text: "Why" }] }, paragraph("We go back.", 1)]),
        seasons: [{ heading: "Summer", body: "Warm.", activities: [{ text: "Swim" }, { text: " " }], image: PICTURE }],
        did_you_know: [{ text: "Old harbour." }],
        related_offerings: [{ offering_id: TRIP.toUpperCase() }, { offering_id: TRIP }],
        gallery: [{ media: PICTURE, alt: "The harbour at dawn" }],
        seo: { title: "", description: "Coast guide", noindex: false },
        enabled: true,
      },
      { id: DEST_OFF, slug: "hidden-place", title: "Hidden", enabled: false },
    ],
    stories: [
      { id: STORY, slug: "first-light", title: "First light", published_at: "2026-03-01T23:00:00.000Z", category: CATEGORY, content: lexical([paragraph("Before dawn.")]), enabled: true },
      { id: "00000000-0000-4000-8000-0000000000e2", slug: "empty", title: "Empty", published_at: "2026-03-01T00:00:00.000Z", content: lexical([]), enabled: true },
    ],
    categories: [{ id: CATEGORY, slug: "notes", title: "Notes" }],
    testimonials: [
      { id: REVIEW_OK, quote: "  Best expierence,  would go agian. ", reviewer: "Fixture R", review_date: "2025-08-02T04:00:00.000Z", trip_name: "", related_offering: TRIP, source_note: "Copied from a review site", confirmed_real: true, enabled: true },
      { id: REVIEW_UNCONFIRMED, quote: "Unconfirmed praise.", reviewer: "Nobody", review_date: "2025-08-03T00:00:00.000Z", source_note: "Unknown", confirmed_real: false, enabled: true },
    ],
  };
}

const offlineFonts: FontPipelineDeps = {
  fetch: (async () => { throw new Error("NO_NETWORK_IN_TESTS"); }) as typeof fetch,
  storeFont: async () => {},
  cachedFaces: async (key) => key.split("|")[1]!.split(",").map((weight, index) => ({
    family: key.split("|")[0]!, weight: Number(weight), style: "normal" as const, unicode_range: "U+0000-00FF",
    digest: String(index).padEnd(64, "b"), bytes: 1000,
  })),
  saveFaces: async () => {},
};

async function build(blocks: unknown[], tenantContent: TenantContent = content(), digestContent: TenantContent | undefined = tenantContent) {
  const tenant = { id: "t1", core_site_id: SITE, core_brand_id: BRAND, primary_hostname: "brand.sites.localhost" };
  const settings = { id: "settings-1", tenant: "t1", display_name: "Brand" };
  const page = { id: "page-home", tenant: "t1", slug: "", title: "Home", enabled: true, blocks };
  const collections: Record<string, unknown[]> = {
    pages: [page], navigation: [{ id: "nav-1", tenant: "t1", items: [] }], footer: [{ id: "footer-1", tenant: "t1" }],
    "site-settings": [settings], media: [media], ...tenantContent,
  };
  const sourceDigest = await publicationDraftDigest({
    pages: [page], navigation: collections.navigation![0] ?? null, footer: collections.footer![0] ?? null, settings, media: [media], content: digestContent,
  });
  const req = { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never;
  return buildPublicationArtifact(req, {
    tenant: tenant as never, operationId: "op-w5", publicationId: "00000000-0000-4000-8000-000000000905",
    sourceRevisionId: "rev-w5", sourceDigest, generatedAt: "2026-10-26T00:00:00Z", fontPipeline: offlineFonts,
  });
}

beforeEach(() => {
  stored.clear();
  projectionCalls.length = 0;
});

describe("#2829 W5 collections reach the publication exactly", () => {
  it("freezes enabled entries and confirmed reviews only, verbatim, with no internal note", async () => {
    const built = await build([{ blockType: "divider" }]);
    const { collections } = built.artifact;
    expect(collections.destinations.map((row) => row.slug)).toEqual(["harbour-coast"]);
    const destination = collections.destinations[0]!;
    expect(destination.title).toBe("Harbour Coast");
    expect(destination.facts).toEqual({ language: "Fixture tongue", timezone: "Coast time" });
    expect(destination.related_offering_ids).toEqual([TRIP]);
    expect(destination.seasons).toEqual([expect.objectContaining({ heading: "Summer", activities: ["Swim"] })]);
    expect(destination.gallery?.[0]).toMatchObject({ id: PICTURE, url: `/media/${PICTURE}/1440.webp`, alt: "The harbour at dawn" });
    expect(destination.body).toEqual({
      type: "doc",
      children: [
        { type: "heading", level: 2, children: [{ type: "text", text: "Why" }] },
        { type: "paragraph", children: [{ type: "text", text: "We go back.", marks: ["bold"] }] },
      ],
    });
    expect(destination.seo).toEqual({ description: "Coast guide" });
    // A story with no words is not published; the day is the day the editor picked (UTC+1 midnight).
    expect(collections.stories).toEqual([expect.objectContaining({ slug: "first-light", published_at: "2026-03-02", category: "notes" })]);
    expect(collections.testimonials).toEqual([
      { id: REVIEW_OK, quote: "Best expierence,  would go agian.", reviewer: "Fixture R", review_date: "2025-08-02", related_offering_id: TRIP },
    ]);
    expect(built.serialized).not.toContain("Copied from a review site");
    expect(built.serialized).not.toContain("Unconfirmed praise");
    expect(() => assertArtifactV2(JSON.parse(built.serialized))).not.toThrow();
  });

  it("shapes the collection, history and form blocks and reads the feed for the ledger", async () => {
    const built = await build([
      { blockType: "destination_grid", heading: "Where we go", destinations: [{ destination: DEST_A }] },
      { blockType: "story_grid", heading: "Stories", category: CATEGORY, limit: 3 },
      { blockType: "testimonials", heading: "Reviews", from_collection: true, items: [] },
      { blockType: "offering_history", heading: "Trips we've run", kind: "trip", series: [{ label: "Run", offering_ids: [{ offering_id: TRIP }, { offering_id: TRIP_2 }] }, { label: "Lonely", offering_ids: [{ offering_id: TRIP }] }] },
      { blockType: "contact_form", heading: "Write", show_phone: true, submit_label: "Send", fallback_email: "hello@fixture.invalid", success_text: "" },
      { blockType: "newsletter_signup", heading: "Join", button_label: "Subscribe", small_print: "Any time." },
    ]);
    expect(projectionCalls).toEqual([{ feed: true }]);
    expect(built.artifact.offerings_snapshot.map((row) => row.id)).toEqual([TRIP, TRIP_2]);
    expect(built.artifact.pages[0]!.blocks).toEqual([
      { type: "destination_grid", variant: "neutral", heading: "Where we go", destinations: [{ slug: "harbour-coast" }] },
      { type: "story_grid", variant: "neutral", heading: "Stories", category: "notes", limit: 3 },
      { type: "testimonials", variant: "atelier", heading: "Reviews", from_collection: true },
      { type: "offering_history", variant: "neutral", heading: "Trips we've run", kind: "trip", series: [{ label: "Run", offering_ids: [{ id: TRIP }, { id: TRIP_2 }] }] },
      { type: "contact_form", variant: "neutral", heading: "Write", show_phone: true, submit_label: "Send", fallback_email: "hello@fixture.invalid" },
      { type: "newsletter_signup", variant: "neutral", heading: "Join", button_label: "Subscribe", small_print: "Any time." },
    ]);
    expect(() => assertArtifactV2(JSON.parse(built.serialized))).not.toThrow();
  });

  it("drops a list with nothing to show instead of publishing a heading over nothing", async () => {
    const empty: TenantContent = { ...content(), destinations: [], testimonials: content().testimonials.filter((row) => row.confirmed_real !== true) };
    const built = await build([
      { blockType: "destination_grid", heading: "Where we go" },
      { blockType: "testimonials", heading: "Reviews", from_collection: true },
      { blockType: "story_grid", heading: "Missing category", category: "00000000-0000-4000-8000-0000000000c9" },
      { blockType: "divider" },
    ], empty);
    expect(built.artifact.pages[0]!.blocks.map((block) => block.type)).toEqual(["divider"]);
  });
});

describe("#2829 W5 the draft digest covers content", () => {
  it("refuses a publish whose content changed after the draft was checked", async () => {
    const before = content();
    const after = content();
    after.testimonials[0]!.quote = "Edited after validate.";
    await expect(build([{ blockType: "divider" }], after, before)).rejects.toThrow("REVISION_CONFLICT");
  });

  it("keeps the digest of a site with no content exactly as before W5", async () => {
    const base = { pages: [{ id: "p" }], navigation: null, footer: null, settings: { id: "s" }, media: [] };
    const none: TenantContent = { destinations: [], stories: [], categories: [], testimonials: [] };
    expect(await publicationDraftDigest({ ...base, content: none })).toBe(await publicationDraftDigest(base));
    expect(await publicationDraftDigest({ ...base, content: content() })).not.toBe(await publicationDraftDigest(base));
  });
});

describe("#2829 W5 guards", () => {
  it("lets only a person in Studio confirm a review, never Core's signed (Ari) path", () => {
    const field = Testimonials.fields.find((entry) => (entry as { name?: string }).name === "confirmed_real") as { access?: Record<string, unknown> };
    expect(field.access?.update).toBe(confirmedRealAccess);
    expect(field.access?.create).toBe(confirmedRealAccess);
    expect(confirmedRealAccess({ req: { context: { minglaSignedCore: true }, user: { id: "u" } } } as never)).toBe(false);
    // #2829 W9r — only brand admins and owners (rank 50) confirm (§37 answer 2).
    expect(confirmedRealAccess({ req: { context: {}, user: { id: "u", rank: 60 } } } as never)).toBe(true);
    expect(confirmedRealAccess({ req: { context: {}, user: { id: "u", rank: 20 } } } as never)).toBe(false);
    expect(confirmedRealAccess({ req: { context: { minglaSignedCore: true, minglaConfirmReview: true }, user: { id: "u", rank: 50 } } } as never)).toBe(true);
    expect(confirmedRealAccess({ req: { context: { minglaSignedCore: true, minglaConfirmReview: true }, user: { id: "u", rank: 20 } } } as never)).toBe(false);
    expect(confirmedRealAccess({ req: { context: {} } } as never)).toBe(false);
  });

  it("counts a picture used only by a destination or story as in use", () => {
    const ids = contentMediaIds({ ...content(), stories: [{ id: STORY, featured_image: "00000000-0000-4000-8000-0000000000bb" }] });
    expect(ids.has(PICTURE)).toBe(true);
    expect(ids.has("00000000-0000-4000-8000-0000000000bb")).toBe(true);
  });

  it("keeps every entry on the editor's own site (no orphans, no cross-site writes)", async () => {
    const hook = Destinations.hooks!.beforeChange![0]!;
    const TENANT = "00000000-0000-4000-8000-0000000000a1";
    const OTHER = "00000000-0000-4000-8000-0000000000a2";
    const req = { user: { id: "u", tenantId: TENANT }, context: {} };
    const run = (data: Record<string, unknown>, operation: "create" | "update" = "create", originalDoc?: Record<string, unknown>, request: unknown = req) =>
      (hook as unknown as (args: Record<string, unknown>) => Record<string, unknown>)({ data, operation, originalDoc, req: request });
    expect(run({ title: "X" }).tenant).toBe(TENANT);
    expect(run({ title: "X", tenant: { id: TENANT } }).tenant).toBe(TENANT);
    expect(() => run({ title: "X", tenant: OTHER })).toThrow("FORBIDDEN");
    expect(() => run({ title: "X" }, "update", { tenant: OTHER })).toThrow("FORBIDDEN");
    // The operator's server-side import names its tenant in the context; an HTTP caller cannot.
    expect(run({ title: "X" }, "create", undefined, { context: { minglaOperatorImportTenantId: OTHER } }).tenant).toBe(OTHER);
    expect(run({ title: "X" }, "create", undefined, { user: { id: "u", tenantId: TENANT }, context: { minglaOperatorImportTenantId: OTHER } }).tenant).toBe(TENANT);
    expect(() => run({ title: "X" }, "create", undefined, { context: {} })).toThrow("FORBIDDEN");
  });

  it("refuses to retire a picture a destination still uses", async () => {
    const writes: string[] = [];
    const req = {
      context: {},
      user: { id: "u", tenantId: "t1", siteId: SITE },
      payload: {
        findByID: async () => ({ ...media, tenant: "t1" }),
        find: async ({ collection }: { collection: string }) => ({ docs: collection === "destinations" ? [{ id: DEST_A, featured_image: PICTURE }] : [] }),
        update: async () => { writes.push("update"); return {}; },
      },
    } as never;
    await expect(tombstoneMedia(req, PICTURE)).rejects.toThrow("MEDIA_IN_USE_DRAFT");
    expect(writes).toEqual([]);
  });

  it("refuses an over-limit tenant instead of truncating", async () => {
    const req = { payload: { find: async ({ collection }: { collection: string }) => ({ docs: collection === "categories" ? Array.from({ length: 51 }, (_, i) => ({ id: String(i) })) : [] }) } } as never;
    await expect(findTenantContent(req, "t1")).rejects.toBeInstanceOf(ContentLimitExceededError);
  });
});

describe("#2829 W5 rich text and days", () => {
  it("keeps words, drops markup and unsafe links", () => {
    const doc = richTextToAst(lexical([
      { type: "paragraph", children: [{ type: "link", fields: { url: "javascript:alert(1)" }, children: [{ type: "text", text: "click" }] }, { type: "linebreak" }, { type: "text", text: "safe", format: 2 }] },
      { type: "list", listType: "number", children: [{ type: "listitem", children: [{ type: "text", text: "one" }] }] },
      { type: "upload", children: [{ type: "text", text: "kept words" }] },
      { type: "paragraph", children: [{ type: "link", fields: { url: "https://example.com" }, children: [{ type: "text", text: "ok" }] }] },
    ]));
    expect(doc).toEqual({
      type: "doc",
      children: [
        { type: "paragraph", children: [{ type: "text", text: "click" }, { type: "break" }, { type: "text", text: "safe", marks: ["italic"] }] },
        { type: "list", ordered: true, items: [{ type: "list_item", children: [{ type: "text", text: "one" }] }] },
        { type: "paragraph", children: [{ type: "text", text: "kept words" }] },
        { type: "paragraph", children: [{ type: "link", href: "https://example.com", children: [{ type: "text", text: "ok" }] }] },
      ],
    });
    expect(richTextToAst(lexical([]))).toBeNull();
  });

  it("reads a picked day the same way east and west of UTC", () => {
    expect(calendarDayOf("2026-03-02T05:00:00.000Z")).toBe("2026-03-02"); // New York midnight
    expect(calendarDayOf("2026-03-01T23:00:00.000Z")).toBe("2026-03-02"); // Paris midnight
    expect(calendarDayOf("not a date")).toBeNull();
    expect(shapeSiteCollections({ destinations: [], stories: [], categories: [], testimonials: [] }, () => { throw new Error("unused"); }))
      .toEqual({ destinations: [], stories: [], categories: [], testimonials: [] });
  });
});
