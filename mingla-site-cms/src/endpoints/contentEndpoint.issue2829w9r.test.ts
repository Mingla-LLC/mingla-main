/*
 * #2829 W9r — the Business app's content collections through Studio
 * (contentEndpoint.ts), with an in-memory Payload that applies the tenant
 * filter the way the multi-tenant plugin does.
 *
 *  - every read and write is limited to the signed site's tenant: another
 *    site's entry id is NOT_FOUND, never read or changed;
 *  - the signed rank is re-checked per action (confirm_review needs 50);
 *  - a stale revision is refused with the latest revision and who saved it;
 *  - reorder refuses a list that changed since it was read, then stores the
 *    owner's order (and the publish freezes it, site_display.manual_order);
 *  - an unconfirmed review can't be shown; confirming stamps who and when;
 *    unconfirming hides it;
 *  - fields are capped and markup refused (drafts skip Payload validation);
 *  - rich text arrives as the site's tree and is stored as Lexical that
 *    reads back as the same tree;
 *  - hidden past trips are written only through set_offering_visibility.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/config", () => ({ cmsConfig: () => ({ approvedBucket: "approved" }) }));
vi.mock("../lib/objectStore", () => ({ presignedGet: async (_bucket: string, key: string) => `https://storage.invalid/${key}?signed` }));
vi.mock("../lib/mediaPipeline", () => ({ createUploadGrant: vi.fn(), completeUpload: vi.fn() }));
vi.mock("../lib/gateway", () => ({ verifyCoreRequest: vi.fn() }));
vi.mock("../lib/observability", () => ({ observeCmsEndpoint: (_p: string, _d: string, handler: unknown) => handler }));

import {
  ContentError,
  draftChanges,
  parseContentBody,
  runContentAction,
  shapeEntryData,
  slugify,
  type ContentRequest,
} from "./contentEndpoint";
import { astToLexical } from "../lib/astToLexical";
import { richTextToAst } from "../lib/richTextToAst";
import { settingsDigest, siteDisplayOf } from "../lib/siteContent";
import { reviewConfirmation } from "../collections/SiteContent";

const SITE = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const MATE = "44444444-4444-4444-8444-444444444444";
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let db: Record<string, Doc[]>;
let clock = 0;

function stamp(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 9, 26, 12, 0, clock)).toISOString();
}

function matches(doc: Doc, where: Doc | undefined): boolean {
  if (!where) return true;
  if (Array.isArray(where.and)) return where.and.every((part: Doc) => matches(doc, part));
  return Object.entries(where).every(([field, condition]) => {
    const value = doc[field];
    if ("equals" in condition) return String(value) === String(condition.equals);
    if ("in" in condition) return condition.in.map(String).includes(String(value));
    return true;
  });
}

function sortDocs(docs: Doc[], sort: unknown): Doc[] {
  if (!Array.isArray(sort)) return docs;
  return [...docs].sort((a, b) => {
    const av = typeof a.sort_order === "number" ? a.sort_order : Number.POSITIVE_INFINITY;
    const bv = typeof b.sort_order === "number" ? b.sort_order : Number.POSITIVE_INFINITY;
    return av === bv ? String(a.createdAt).localeCompare(String(b.createdAt)) : av - bv;
  });
}

const payload = {
  find: async ({ collection, where, sort, req, overrideAccess }: Doc) => {
    // The multi-tenant plugin: a scoped (non-override) read sees its tenant only.
    const tenant = overrideAccess ? null : req?.user?.tenantId;
    const docs = (db[collection] ?? []).filter((doc) => (tenant ? doc.tenant === tenant : true) && matches(doc, where));
    return { docs: sortDocs(docs, sort), totalDocs: docs.length };
  },
  create: async ({ collection, data, req }: Doc) => {
    const doc = { id: String((db[collection]?.length ?? 0) + 100), createdAt: stamp(), ...data, updatedAt: stamp(), updated_by: req.user.id };
    db[collection] = [...(db[collection] ?? []), doc];
    return doc;
  },
  update: async ({ collection, id, data, req }: Doc) => {
    const doc = (db[collection] ?? []).find((row) => String(row.id) === String(id) && row.tenant === req.user.tenantId);
    if (!doc) throw new Error("NOT_FOUND");
    let next = { ...data };
    if (collection === "testimonials") {
      // Field access as configured: confirmed_real only through the confirm flag.
      if ("confirmed_real" in next && req.context.minglaConfirmReview !== true) delete next.confirmed_real;
      next = await reviewConfirmation({ data: next, originalDoc: doc, req } as never) as Doc;
    }
    Object.assign(doc, next, { updatedAt: stamp(), updated_by: req.user.id });
    return doc;
  },
  delete: async ({ collection, id, req }: Doc) => {
    db[collection] = (db[collection] ?? []).filter((row) => !(String(row.id) === String(id) && row.tenant === req.user.tenantId));
  },
};

function request(action: string, args: Doc, rank = 60, userId = OWNER): ContentRequest {
  return { action, siteId: SITE, brandId: BRAND, userId, rank, args };
}

function ctx(input: ContentRequest, tenantId = TENANT_A) {
  const req = { payload, context: {} } as never;
  const scoped = {
    payload,
    context: { minglaSignedCore: true },
    user: { id: input.userId, tenantId, rank: input.rank, siteId: SITE, brandId: BRAND },
  } as never;
  return { req, scoped, tenantId, request: input };
}

async function run(action: string, args: Doc, rank = 60, tenantId = TENANT_A, userId = OWNER): Promise<Doc> {
  return (await runContentAction(ctx(request(action, args, rank, userId), tenantId))) as Doc;
}

async function refusal(promise: Promise<unknown>): Promise<ContentError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ContentError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  clock = 0;
  db = {
    destinations: [
      { id: "1", tenant: TENANT_A, title: "France", slug: "france", enabled: true, createdAt: stamp(), updatedAt: stamp(), gallery: [{ media: "m1", alt: "" }] },
      { id: "2", tenant: TENANT_A, title: "Albania", slug: "albania", enabled: true, createdAt: stamp(), updatedAt: stamp() },
      { id: "9", tenant: TENANT_B, title: "Other site's", slug: "other", enabled: true, createdAt: stamp(), updatedAt: stamp() },
    ],
    stories: [],
    testimonials: [
      { id: "5", tenant: TENANT_A, quote: "Ten strangers on day one.", reviewer: "Alex R.", confirmed_real: false, enabled: false, createdAt: stamp(), updatedAt: stamp() },
    ],
    categories: [],
    "site-settings": [{ id: "s1", tenant: TENANT_A, hidden_offering_ids: [], updatedAt: stamp() }],
    media: [],
  };
});

describe("#2829 W9r content endpoint", () => {
  it("re-checks the signed rank per action and refuses unknown actions", () => {
    const body = (action: string, rank: number) => ({ action, site_id: SITE, brand_id: BRAND, user_id: OWNER, rank, args: {} });
    expect(() => parseContentBody(body("confirm_review", 20), SITE)).toThrow("FORBIDDEN");
    expect(() => parseContentBody(body("set_offering_visibility", 40), SITE)).toThrow("FORBIDDEN");
    expect(parseContentBody(body("update", 20), SITE).rank).toBe(20);
    expect(() => parseContentBody(body("drop_table", 60), SITE)).toThrow("VALIDATION_FAILED");
    expect(() => parseContentBody({ ...body("list", 60), site_id: "99999999-9999-4999-8999-999999999999" }, SITE)).toThrow("FORBIDDEN");
    expect(() => parseContentBody({ ...body("list", 60), tenant: TENANT_B }, SITE)).toThrow("VALIDATION_FAILED");
  });

  it("only ever reads and writes the signed site's tenant", async () => {
    const listed = await run("list", { collection: "destinations" });
    expect(listed.entries.map((row: Doc) => row.id)).toEqual(["1", "2"]);
    expect((await refusal(run("get", { collection: "destinations", id: "9" }))).message).toBe("NOT_FOUND");
    expect((await refusal(run("update", { collection: "destinations", id: "9", expected_revision: "x", data: { title: "Taken" } }))).message).toBe("NOT_FOUND");
    expect((await refusal(run("delete", { collection: "destinations", id: "9", expected_revision: "x" }))).message).toBe("NOT_FOUND");
    expect(db.destinations.find((row) => row.id === "9")?.title).toBe("Other site's");
    const created = await run("create", { collection: "destinations", data: { title: "Bali" } });
    expect(db.destinations.find((row) => row.id === created.entry.id)?.tenant).toBe(TENANT_A);
  });

  it("refuses a stale revision with the latest one and who saved it", async () => {
    await run("update", { collection: "destinations", id: "2", expected_revision: db.destinations[1]!.updatedAt, data: { tagline: "The Riviera" } }, 20, TENANT_A, MATE);
    const error = await refusal(run("update", { collection: "destinations", id: "2", expected_revision: "2026-10-26T12:00:04.000Z", data: { tagline: "Mine" } }));
    expect(error.message).toBe("REVISION_CONFLICT");
    expect(error.extra?.latest).toMatchObject({ revision: db.destinations[1]!.updatedAt, updated_by: MATE });
    expect(db.destinations[1]!.tagline).toBe("The Riviera");
  });

  it("reorders only an unchanged list, then the publish keeps the owner's order", async () => {
    const listed = await run("list", { collection: "destinations" });
    const stale = await refusal(run("reorder", { collection: "destinations", ids: ["2", "1"], expected_list_revision: "0".repeat(64) }));
    expect(stale.message).toBe("REVISION_CONFLICT");
    expect((await refusal(run("reorder", { collection: "destinations", ids: ["2"], expected_list_revision: listed.revision }))).message).toBe("VALIDATION_FAILED");
    const moved = await run("reorder", { collection: "destinations", ids: ["2", "1"], expected_list_revision: listed.revision });
    expect(moved.ids).toEqual(["2", "1"]);
    expect((await run("list", { collection: "destinations" })).entries.map((row: Doc) => row.id)).toEqual(["2", "1"]);
    expect(moved.audit).toEqual({ action: "content.reordered", collection: "destinations", count: 2 });

    const content = { destinations: [], categories: [], stories: [{ id: "a", sort_order: 1 }], testimonials: [{ id: "b" }] };
    expect(siteDisplayOf({ hidden_offering_ids: [] }, content as never)).toEqual({ manual_order: ["stories"], settings_digest: settingsDigest({}) });
    expect(siteDisplayOf(null, { destinations: [], categories: [], stories: [], testimonials: [] })).toBeUndefined();
  });

  it("keeps an unconfirmed review hidden; only confirm_review confirms, stamping who and when", async () => {
    const review = db.testimonials[0]!;
    expect((await refusal(run("set_visibility", { collection: "testimonials", id: "5", enabled: true, expected_revision: review.updatedAt }))).message).toBe("REVIEW_NOT_CONFIRMED");
    expect((await refusal(run("create", { collection: "testimonials", data: { quote: "Great", reviewer: "J", enabled: true } }))).message).toBe("REVIEW_NOT_CONFIRMED");
    // An ordinary update can't sneak the confirmation in.
    expect(() => shapeEntryData("testimonials", { confirmed_real: true })).toThrow("VALIDATION_FAILED");
    const confirmed = await run("confirm_review", { id: "5", confirmed: true, expected_revision: review.updatedAt });
    expect(confirmed.entry.confirmed).toBe(true);
    expect(review.confirmed_by).toBe(OWNER);
    expect(typeof review.confirmed_at).toBe("string");
    expect(confirmed.audit.action).toBe("content.review_confirmed");
    const shown = await run("set_visibility", { collection: "testimonials", id: "5", enabled: true, expected_revision: review.updatedAt });
    expect(shown.entry.enabled).toBe(true);
    const undone = await run("confirm_review", { id: "5", confirmed: false, expected_revision: review.updatedAt });
    expect(undone.entry.confirmed).toBe(false);
    expect(review.enabled).toBe(false);
    expect(review.confirmed_by).toBeNull();
  });

  it("caps fields, refuses markup and derives a free address", async () => {
    expect(() => shapeEntryData("destinations", { title: "x".repeat(121) })).toThrow("VALIDATION_FAILED");
    expect(() => shapeEntryData("stories", { title: "<script>alert(1)</script>" })).toThrow("VALIDATION_FAILED");
    expect(() => shapeEntryData("destinations", { tenant: TENANT_B })).toThrow("VALIDATION_FAILED");
    expect(() => shapeEntryData("destinations", { related_offerings: ["not-a-trip"] })).toThrow("VALIDATION_FAILED");
    expect(shapeEntryData("testimonials", { quote: "  typos teh same  " }).quote).toBe("typos teh same");
    expect(slugify("Côte d'Azur & Monaco")).toBe("cote-d-azur-and-monaco");
    const created = await run("create", { collection: "destinations", data: { title: "France" } });
    expect(created.entry.slug).toBe("france-2");
    expect(created.entry.enabled).toBe(false);
  });

  it("stores rich text as Lexical that reads back as the same tree", async () => {
    const doc = {
      type: "doc",
      children: [
        { type: "heading", level: 2, children: [{ type: "text", text: "Day 1" }] },
        { type: "paragraph", children: [{ type: "text", text: "Coffee on " }, { type: "text", text: "Rue de Bretagne", marks: ["bold"] }, { type: "break" }, { type: "link", href: "https://example.com", children: [{ type: "text", text: "map", marks: ["italic"] }] }] },
        { type: "list", ordered: false, items: [{ type: "list_item", children: [{ type: "text", text: "Musée Carnavalet" }] }] },
        { type: "list", ordered: true, items: [{ type: "list_item", children: [{ type: "text", text: "First" }] }] },
        { type: "quote", children: [{ type: "text", text: "Book a week ahead." }] },
      ],
    };
    expect(richTextToAst(astToLexical(doc))).toEqual(doc);
    expect(() => astToLexical({ type: "doc", children: [{ type: "image", src: "x" }] })).toThrow();
    const created = await run("create", { collection: "stories", data: { title: "Paris", content: doc } });
    expect(created.entry.content).toEqual(doc);
  });

  it("writes hidden past trips only through set_offering_visibility", async () => {
    const settings = db["site-settings"][0]!;
    const trip = "55555555-5555-4555-8555-555555555555";
    const result = await run("set_offering_visibility", { offering_id: trip, hidden: true, expected_revision: settings.updatedAt });
    expect(result.hidden_offering_ids).toEqual([trip]);
    expect(result.audit).toEqual({ action: "content.offering_visibility", collection: "offerings", entry: trip, visible: false });
    expect((await refusal(run("set_offering_visibility", { offering_id: trip, hidden: false, expected_revision: "stale" }))).message).toBe("REVISION_CONFLICT");
    expect((await run("get_display", {})).hidden_offering_ids).toEqual([trip]);
  });
});

describe("#2829 W9r changes since the last publish", () => {
  const live = {
    generated_at: "2026-10-26T12:00:00.000Z",
    pages: [{ path: "" }, { path: "about-us" }],
    collections: { destinations: [{ id: "1" }, { id: "2" }], stories: [], testimonials: [{ id: "5" }] },
    site_display: {},
  };
  const before = "2026-10-26T11:00:00.000Z";
  const after = "2026-10-26T13:00:00.000Z";
  it("names what changed, section by section, and nothing that didn't", () => {
    const changes = draftChanges({
      published: live,
      settings: { updatedAt: after, hidden_offering_ids: ["55555555-5555-4555-8555-555555555555"] },
      navigation: { updatedAt: before },
      footer: { updatedAt: before },
      pages: [{ id: "p1", title: "Home", updatedAt: before }, { id: "p2", title: "About us", updatedAt: after }],
      pagePaths: new Map([["p1", ""], ["p2", "about-us"]]),
      content: {
        destinations: [
          { id: "1", enabled: true, updatedAt: after },
          { id: "2", enabled: false, updatedAt: after },
          { id: "3", enabled: true, updatedAt: after },
        ],
        stories: [{ id: "s", enabled: false, updatedAt: after }],
        testimonials: [{ id: "5", enabled: true, confirmed_real: true, updatedAt: before }, { id: "6", enabled: true, confirmed_real: false, updatedAt: after }],
      },
    });
    // A version built before the settings digest: hiding a trip is not called a design change.
    expect(changes).toEqual([
      { section: "past", title: "Past trips", detail: "Which trips show in Trips we've run" },
      { section: "pages", title: "Pages", detail: "Edited: About us" },
      { section: "destinations", title: "Destinations", detail: "1 new destination · 1 destination edited · 1 destination hidden or removed" },
    ]);
  });
  it("tells hiding a past trip from a design change by the settings the live version was built from", () => {
    const built = { design: "voyage", tokens: { colors: { accent: "#ff6600" } }, hidden_offering_ids: [] as string[], updatedAt: before };
    const published = { ...live, collections: {}, site_display: { settings_digest: settingsDigest(built) } };
    const empty = { navigation: null, footer: null, pages: [], pagePaths: new Map(), content: { destinations: [], stories: [], testimonials: [] } };
    const trip = "55555555-5555-4555-8555-555555555555";
    expect(settingsDigest({ ...built, updatedAt: after, hidden_offering_ids: [trip] })).toBe(settingsDigest(built));
    expect(draftChanges({ ...empty, published, settings: { ...built, updatedAt: after, hidden_offering_ids: [trip] } }))
      .toEqual([{ section: "past", title: "Past trips", detail: "Which trips show in Trips we've run" }]);
    expect(draftChanges({ ...empty, published, settings: { ...built, updatedAt: after, tokens: { colors: { accent: "#0066ff" } } } }))
      .toEqual([{ section: "design", title: "Website design", detail: "Colours, fonts or other settings" }]);
  });

  it("says the whole website is new before the first publish, and nothing when the draft matches", () => {
    const empty = { settings: null, navigation: null, footer: null, pages: [], pagePaths: new Map(), content: { destinations: [], stories: [], testimonials: [] } };
    expect(draftChanges({ ...empty, published: null })).toEqual([{ section: "pages", title: "Your whole website", detail: "Not published yet" }]);
    expect(draftChanges({ ...empty, published: { ...live, collections: {} } })).toEqual([]);
  });
});
