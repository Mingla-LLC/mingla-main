/**
 * #4453 — Gameland Lagos's live run (2026-11-18), the Build side:
 *
 *   1. "Rebuild my pages" kept every page: the compose endpoint never asked
 *      composer v2 to replace pages still entirely Draft (only Ari's design
 *      pass did). Host's dialog promises "Ari builds your pages again from
 *      your plan, in your chosen design. Pages you have edited yourself are
 *      kept."
 *   5. Build composed in the PLAN's design (Voyage: hero `fullbleed`, poster
 *      cards that print words over the offering's own poster) while the site
 *      was drawn in Pop (`pop-stack`, `cards`).
 *
 * Drives the REAL compose endpoint with the REAL Pages hooks (the review
 * stamp included); only Payload's storage and Core's signature are faked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/gateway", () => ({
  verifyCoreRequest: vi.fn(async () => ({ site_id: SITE })),
  callCore: vi.fn(async () => { throw new Error("Studio must not ask Core for the flag on a signed compose"); }),
}));

import type { PayloadRequest } from "payload";
import { composeEndpoints } from "./composeEndpoint";
import { Pages } from "../collections/Pages";
import { usesBookingBlocksFeature } from "../contracts/generated/blocks.ts";

const SITE = "44530000-0000-4000-8000-00000000a001";
const BRAND = "44530000-0000-4000-8000-00000000a002";
const USER = "44530000-0000-4000-8000-00000000a003";
const TENANT = "44530000-0000-4000-8000-00000000a004";
const EVENT = "44530000-0000-4000-8000-00000000a005";
const EXPERIENCE = "44530000-0000-4000-8000-00000000a006";
const MEDIA = Array.from({ length: 5 }, (_, i) => `44530000-0000-4000-8000-0000000b000${i}`);

type Doc = Record<string, unknown>;

function idsIn(where: unknown): string[] | null {
  const seen: string[][] = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const row = value as Doc;
    if (row.id && typeof row.id === "object" && Array.isArray((row.id as Doc).in)) seen.push((row.id as Doc).in as string[]);
    for (const child of Object.values(row)) walk(child);
  };
  walk(where);
  return seen[0] ?? null;
}

/** Payload's storage, faked; page writes run the real collection hooks. */
function fakePayload() {
  const pages: Doc[] = [];
  const navigation: Doc[] = [];
  const settings: Doc[] = [];
  const media: Doc[] = MEDIA.map((id) => ({ id, tenant: TENANT, state: "READY", kind: "image" }));
  let nextId = 1;
  async function runHooks(data: Doc, originalDoc: Doc | undefined, req: PayloadRequest, operation: "create" | "update") {
    let next = data;
    for (const hook of Pages.hooks?.beforeChange ?? []) {
      next = ((await hook({ data: next, originalDoc, req, operation, collection: Pages, context: req.context } as never)) ?? next) as Doc;
    }
    return next;
  }
  const payload = {
    find: vi.fn(async ({ collection, where }: { collection: string; where?: unknown }) => {
      let docs: Doc[] = [];
      if (collection === "tenants") docs = [{ id: TENANT, core_site_id: SITE, core_brand_id: BRAND }];
      else if (collection === "pages") docs = pages;
      else if (collection === "navigation") docs = navigation;
      else if (collection === "site-settings") docs = settings;
      else if (collection === "media") {
        const ids = idsIn(where);
        docs = ids ? media.filter((doc) => ids.includes(String(doc.id))) : media;
      }
      return { docs, totalDocs: docs.length };
    }),
    count: vi.fn(async () => ({ totalDocs: 0 })),
    create: vi.fn(async ({ collection, data, req }: { collection: string; data: Doc; req: PayloadRequest }) => {
      if (collection === "pages") {
        const stored = { ...(await runHooks(data, undefined, req, "create")), id: `page-${nextId++}` };
        pages.push(stored);
        return stored;
      }
      const stored = { ...data, id: `${collection}-${nextId++}` };
      if (collection === "navigation") navigation.push(stored);
      return stored;
    }),
    update: vi.fn(async ({ collection, id, data, req }: { collection: string; id: string; data: Doc; req: PayloadRequest }) => {
      const list = collection === "pages" ? pages : navigation;
      const index = list.findIndex((doc) => String(doc.id) === String(id));
      const original = list[index]!;
      const next = collection === "pages" ? await runHooks(data, original, req, "update") : data;
      list[index] = { ...original, ...next };
      return list[index];
    }),
  };
  return { payload, pages, settings };
}

function body(extra: Doc = {}): Doc {
  return {
    kind: "compose_from_plan",
    site_id: SITE,
    brand_id: BRAND,
    user_id: USER,
    plan: { offerings_selected: ["events", "experiences"], venue_descriptor: null, story: { who: "Gamers in Lagos", why: "Play together" } },
    brand: { name: "Gameland", tagline: "Play together", bio: "Lagos's game nights.", contact_email: "hello@example.com", city: "Lagos" },
    review_drafts: true,
    design_pass: {
      design_key: "pop",
      plan: { offerings_selected: ["events", "experiences"], story: { who: "Gamers in Lagos", why: "Play together" } },
      answers: {
        value_points: [{ title: "Every console", sentence: "Every console you know." }, { title: "Friendly hosts", sentence: "Hosts who play too." }],
        faq: [{ question: "Can I bring friends?", answer: "Yes, bring your squad." }],
        process_steps: [{ title: "Pick a night", text: "Choose a date." }, { title: "Get a ticket", text: "Buy it here." }, { title: "Play", text: "Show up and play." }],
        quick_facts: null,
      },
      address: null,
      facts: {
        upcoming: { trip: 0, event: 3, experience: 2 },
        ended: { trip: 0, event: 2, experience: 1 },
        next_offering: { event: EVENT, experience: EXPERIENCE },
        bookable: { event: 2, experience: 4 },
        public_ticket_tiers: 2,
        mingla_reviews: 30,
      },
    },
    ...extra,
  };
}

async function compose(extra: Doc = {}, store: ReturnType<typeof fakePayload> = fakePayload()) {
  const { payload, pages } = store;
  const raw = JSON.stringify(body(extra));
  const req = {
    text: async () => raw,
    headers: new Headers(),
    payload,
    context: {},
    user: null,
  } as unknown as PayloadRequest;
  const response = await composeEndpoints[0]!.handler(req);
  const json = await response.json() as Doc;
  return { response, json, pages, store };
}

const pageBySlug = (pages: Doc[], slug: string) => pages.find((page) => page.slug === slug)!;
const blocksOf = (page: Doc) => (page.blocks as Doc[] | undefined) ?? [];

afterEach(() => vi.restoreAllMocks());

describe("#4453 Rebuild my pages", () => {
  it("replaces every page still entirely Draft (Home included), at the same page ids, and says which", async () => {
    const first = await compose({ booking_blocks: true });
    expect(first.response.status, JSON.stringify(first.json)).toBe(200);
    const before = first.pages.map((page) => ({ id: page.id, slug: page.slug }));
    expect(before.length).toBeGreaterThan(2);
    // Something the old Build left behind on a Draft page goes on the rebuild.
    blocksOf(pageBySlug(first.pages, "about")).push({ blockType: "rich_text", width: "narrow", content: null, review: { state: "draft", source: "composer", at: "2026-11-18T00:00:00.000Z", by: null } });

    const second = await compose({ booking_blocks: true }, first.store);
    expect(second.response.status, JSON.stringify(second.json)).toBe(200);
    const data = second.json.data as Doc;
    expect(data.created).toEqual([]);
    expect(new Set(data.replaced as string[])).toEqual(new Set(["home", ...before.filter((page) => page.slug !== "").map((page) => String(page.slug))]));
    // No page was added twice; every page is still at its id.
    expect(second.pages.map((page) => ({ id: page.id, slug: page.slug }))).toEqual(before);
    expect(blocksOf(pageBySlug(second.pages, "about")).filter((block) => block.blockType === "rich_text" && block.content === null)).toEqual([]);
    for (const page of second.pages) for (const block of blocksOf(page)) expect((block.review as Doc).state).toBe("draft");
  });

  it("keeps a page with any section the owner reviewed (or edited), word for word", async () => {
    const first = await compose({ booking_blocks: true });
    const about = pageBySlug(first.pages, "about");
    blocksOf(about)[0]!.review = { state: "reviewed", source: "composer", at: "2026-11-18T01:00:00.000Z", by: USER };
    blocksOf(about)[0]!.heading = "Our story, in our words";
    const kept = JSON.stringify(about.blocks);

    const second = await compose({ booking_blocks: true }, first.store);
    expect(second.response.status).toBe(200);
    expect((second.json.data as Doc).replaced).not.toContain("about");
    expect(JSON.stringify(pageBySlug(second.pages, "about").blocks)).toBe(kept);
  });
});

describe("#4453 Build composes in the site's own design", () => {
  it("uses Studio's design (Pop) over the plan's (Voyage): Pop's hero and cards, never Voyage's poster", async () => {
    const store = fakePayload();
    store.settings.push({ id: "settings-1", tenant: TENANT, design: "pop" });
    const pass = { ...(body().design_pass as Doc), design_key: "voyage" };
    const { response, json, pages } = await compose({ booking_blocks: true, design_pass: pass }, store);
    expect(response.status, JSON.stringify(json)).toBe(200);
    const home = blocksOf(pageBySlug(pages, ""));
    expect(home.find((block) => block.blockType === "hero")?.variant).toBe("pop-stack");
    const grids = pages.flatMap(blocksOf).filter((block) => block.blockType === "offering_grid");
    expect(grids.length).toBeGreaterThan(0);
    for (const grid of grids) expect(grid.variant).toBe("cards");
  });

  it("with no Studio design on record, the plan's design is used; an offering grid still never starts on poster", async () => {
    const pass = { ...(body().design_pass as Doc), design_key: "voyage" };
    const { response, json, pages } = await compose({ booking_blocks: true, design_pass: pass });
    expect(response.status, JSON.stringify(json)).toBe(200);
    expect(blocksOf(pageBySlug(pages, "")).find((block) => block.blockType === "hero")?.variant).toBe("fullbleed");
    const grids = pages.flatMap(blocksOf).filter((block) => block.blockType === "offering_grid");
    expect(grids.length).toBeGreaterThan(0);
    for (const grid of grids) expect(grid.variant).toBe("photo-card");
  });
});
