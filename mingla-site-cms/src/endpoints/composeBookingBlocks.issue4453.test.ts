/**
 * #4453 Fault 2 — "We couldn't create your draft".
 *
 * Build on a design pass (composer v2) for an events + experiences brand
 * composes availability, ticket-tier and how-it-works blocks. Studio's page
 * hook `gateBookingBlocks` refuses a NEW booking block on a signed request
 * unless Core signed SITES_BOOKING_BLOCKS in (`minglaBookingBlocks`), and the
 * compose call never carried it, so the first page write failed with 409.
 *
 * Drives the REAL compose endpoint; every page write runs the REAL Pages
 * beforeChange hooks (enforcePage, bindRequestTenant, gateBookingBlocks,
 * stampBlockReview). Only Payload's storage and Core's signature are faked.
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
  return { payload, pages };
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

async function compose(extra: Doc = {}) {
  const { payload, pages } = fakePayload();
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
  return { response, json, pages };
}

const bookingBlocksOf = (pages: Doc[]) => pages.flatMap((page) => (page.blocks as Doc[] | undefined) ?? []).filter((block) => usesBookingBlocksFeature(block));

afterEach(() => vi.restoreAllMocks());

describe("#4453 Fault 2 — compose on a design pass meets the booking-blocks page hook", () => {
  // Before the fix the same compose (no `booking_blocks`) answered
  // 409 {"ok":false,"error":{"code":"BOOKING_BLOCKS_OFF"}} with safe_error_code null.
  it("flag on (Core signs booking_blocks: true): 200 and the booking blocks are written through the page hooks", async () => {
    const { response, json, pages } = await compose({ booking_blocks: true });
    expect(response.status, JSON.stringify(json)).toBe(200);
    expect((json.data as Doc).composer).toBe("v2");
    const types = bookingBlocksOf(pages).map((block) => block.blockType);
    expect(types).toEqual(expect.arrayContaining(["availability", "ticket_tiers", "process_steps"]));
    // Every composed section is still stamped Draft by the real review hook.
    for (const block of bookingBlocksOf(pages)) expect((block.review as Doc | undefined)?.state).toBe("draft");
  });

  it("flag off (booking_blocks: false): 200 with no booking block, no booking bar and no Mingla rating", async () => {
    const { response, json, pages } = await compose({ booking_blocks: false });
    expect(response.status, JSON.stringify(json)).toBe(200);
    expect(pages.length).toBeGreaterThan(1);
    expect(bookingBlocksOf(pages)).toEqual([]);
  });

  it("an older Core that sends no booking_blocks reads as off: 200, never a failed draft", async () => {
    const { response, json, pages } = await compose();
    expect(response.status, JSON.stringify(json)).toBe(200);
    expect(bookingBlocksOf(pages)).toEqual([]);
  });

  it("booking_blocks must be a strict boolean", async () => {
    for (const bad of ["true", 1, null, {}]) {
      const { response, json } = await compose({ booking_blocks: bad });
      expect(response.status).toBe(400);
      expect((json.error as Doc).code).toBe("VALIDATION_FAILED");
    }
  });

  it("a refused compose logs its own code as safe_error_code (it was null)", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "info").mockImplementation((line: unknown) => { logs.push(String(line)); });
    const { payload } = fakePayload();
    payload.create.mockImplementation(async () => { throw new Error("BOOKING_BLOCKS_OFF"); });
    const raw = JSON.stringify(body({ booking_blocks: false }));
    const req = { text: async () => raw, headers: new Headers(), payload, context: {}, user: null } as unknown as PayloadRequest;
    const response = await composeEndpoints[0]!.handler(req);
    expect(response.status).toBe(409);
    const refused = logs.map((line) => { try { return JSON.parse(line) as Doc; } catch { return {}; } })
      .find((row) => row.metric === "cms.compose.refused");
    expect(refused).toMatchObject({ safe_error_code: "BOOKING_BLOCKS_OFF", status_code: 409, route: "/internal/compose-from-plan" });
  });
});
