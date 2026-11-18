/*
 * #4453 milestone 11 TESTER (adversarial) — "Add a page with Ari", angles the
 * implementor suite does not take:
 *   1. a forged plan (page.enabled true, ari_draft false, origin "owner") still
 *      writes ONE disabled Draft-by-Ari page;
 *   2. another brand's page id never resolves for answer / Publish / Remove;
 *   3. Ari's own answer tool: flag, verbatim owner cite, voucher refusal;
 *   4. a page UNDER a Draft-by-Ari page, a link to it from a live page, and a
 *      Draft menu child never reach a publish (fails if the builder's
 *      underAriDraft filter is deleted).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {}, observeCmsEndpoint: (_r: string, _d: string, handler: unknown) => handler }));
vi.mock("./gateway", () => ({
  readCoreProjection: async () => ({ offerings: [], menu: [], menu_venue_id: null }),
  callCore: vi.fn(),
  verifyCoreRequest: vi.fn(),
}));
const stored = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("./objectStore", () => ({
  writeObject: async (bucket: string, key: string, bytes: Uint8Array) => { stored.set(`${bucket}:${key}`, bytes); },
  readObject: async (bucket: string, key: string) => {
    const value = stored.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
}));
const state = vi.hoisted(() => ({ pages: [] as Array<Record<string, unknown>>, navigation: { id: "nav", items: [] as Array<Record<string, unknown>> }, digest: "rev-1" }));
vi.mock("./tenantPages", () => ({ findAllTenantPages: vi.fn(async () => state.pages) }));
vi.mock("./ariSiteActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ariSiteActions")>();
  return {
    ...actual,
    loadDraftState: vi.fn(async () => ({ pages: state.pages, settings: null, navigation: state.navigation, footer: null, media: [], content: {}, digest: state.digest })),
  };
});

import { runAriPageAction, runOwnerAriPageAction } from "./ariPage";
import { type AriActionContext } from "./ariSiteActions";
import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";
import { DESIGNS } from "../contracts/generated/designs.ts";

const BRAND = "00000000-0000-4000-8000-0000000b0011";
const OWNER_REQUEST = "Can you add a page about private hire? Our team is Ada and Tunde.";
const variant = (type: "page_header" | "team" | "cta") => DESIGNS.atelier.variants[type][0];

type Write = { op: string; collection: string; data?: Record<string, unknown>; context?: Record<string, unknown> };
let writes: Write[];
let workLog: Array<Record<string, unknown>>;
let nonces: Set<string>;

function page(id: string, slug: string, title: string, extra: Record<string, unknown> = {}) {
  return { id, slug, title, parent: null, enabled: true, revision: 1, blocks: [{ id: `${id}-b`, blockType: "page_header", heading: title }], ...extra };
}

beforeEach(() => {
  writes = [];
  workLog = [];
  nonces = new Set();
  state.pages = [page("home", "", "Home"), page("about", "about", "About")];
  state.navigation = { id: "nav", items: [{ id: "i1", label: "About", target_type: "page", page: "about" }] };
});

function ctx(addPage = true): AriActionContext {
  const payload = {
    find: vi.fn(async ({ collection, where }: { collection: string; where?: { nonce?: { equals: string } } }) => {
      if (collection === "work-log") return { docs: [], totalDocs: workLog.length };
      if (collection === "navigation") return { docs: [state.navigation] };
      if (collection === "gateway-nonces") return { docs: nonces.has(String(where?.nonce?.equals)) ? [{ expires_at: new Date(Date.now() + 60_000).toISOString() }] : [] };
      return { docs: [] };
    }),
    create: vi.fn(async ({ collection, data, req }: { collection: string; data: Record<string, unknown>; req?: { context?: Record<string, unknown> } }) => {
      if (collection === "gateway-nonces") {
        if (nonces.has(String(data.nonce))) throw Object.assign(new Error("nonce"), { data: { errors: [{ path: "nonce" }] } });
        nonces.add(String(data.nonce));
        return { id: data.nonce };
      }
      if (collection === "work-log") workLog.push(data);
      writes.push({ op: "create", collection, data, context: req?.context });
      return { id: `new-${writes.length}`, revision: 1 };
    }),
    update: vi.fn(async ({ collection, data, req }: { collection: string; data: Record<string, unknown>; req?: { context?: Record<string, unknown> } }) => {
      writes.push({ op: "update", collection, data, context: req?.context });
      return { id: "u", revision: 2, ...data };
    }),
    delete: vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === "gateway-nonces") { nonces.clear(); return { docs: [] }; }
      writes.push({ op: "delete", collection });
      return { docs: [] };
    }),
    db: {},
  };
  const req = { payload, context: {} } as never;
  return {
    req, scoped: { payload, context: { minglaSignedCore: true } } as never, tenantId: "t1", siteId: "00000000-0000-4000-8000-0000000c0011",
    brandId: BRAND, userId: "00000000-0000-4000-8000-0000000a0011", rank: 50, addPage,
    evidence: { brand: { id: BRAND, name: "Lagos Supper Club", description: null, city: "Lagos", slug: "lagos-supper" }, booking_identity: true, offerings: [] },
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    brand_id: BRAND,
    site_id: "00000000-0000-4000-8000-0000000c0011",
    expected_site_revision: "rev-1",
    request: OWNER_REQUEST,
    page: { title: "Private hire", menu_label: "Private hire", slug: "private-hire", seo: { title: "Private hire", description: "Hire the whole room for your group." } },
    blocks: [
      { type: "page_header", variant: variant("page_header"), heading: "Private hire" },
      { type: "team", variant: variant("team"), heading: "Who looks after you", members: [{ name: "Ada" }, { name: "Tunde" }] },
    ],
    have: [{ text: "Our team is Ada and Tunde", source: "owner_words" }],
    questions: [
      { key: "ada_role", question: "What does Ada do on the night?", block_index: 1, field_path: "members.0.role", placeholder: "Head chef" },
      { key: "tunde_role", question: "What does Tunde do?", block_index: 1, field_path: "members.1.role" },
    ],
    why: "The owner asked for a private hire page.",
    cites: [{ kind: "owner_words", quote: OWNER_REQUEST }],
    ...overrides,
  };
}

const owner = (c = ctx()) => ({ req: c.req, scoped: c.scoped, tenantId: c.tenantId, userId: c.userId, brandId: BRAND });
const draftPage = () => page("p9", "private-hire", "Private hire", {
  origin: "ari", ari_draft: true, enabled: false,
  blocks: [{ id: "b0", blockType: "page_header", heading: "Private hire" }, { id: "b1", blockType: "team", members: [{ name: "Ada" }], review: { state: "draft", source: "ari" } }],
  owner_questions: [{ key: "ada_role", question: "What does Ada do?", block_index: 1, field_path: "members.0.role" }],
});

describe("#4453 m11 tester: Ari cannot switch its own page on", () => {
  it("a forged plan with page.enabled, ari_draft false and origin owner still writes a disabled Draft-by-Ari page", async () => {
    const forged = plan({
      enabled: true, ari_draft: false, origin: "owner",
      page: { ...plan().page, enabled: true, ari_draft: false, origin: "owner", draft: false },
    });
    await runAriPageAction("propose_site_page", forged, ctx());
    const pages = writes.filter((w) => w.collection === "pages");
    expect(pages).toHaveLength(1);
    expect(pages[0]!.data).toMatchObject({ enabled: false, ari_draft: true, origin: "ari" });
    const items = writes.find((w) => w.collection === "navigation")!.data!.items as Array<Record<string, unknown>>;
    expect(items.filter((item) => item.draft === true)).toHaveLength(1);
  });
});

describe("#4453 m11 tester: another brand's page never resolves", () => {
  for (const action of ["ari_page_answer", "ari_page_accept", "ari_page_remove"] as const) {
    it(`${action} with a page id outside this tenant -> NOT_FOUND, nothing written`, async () => {
      state.pages.push(draftPage());
      await expect(runOwnerAriPageAction(action, { page_id: "other-brand-p9", question_key: "ada_role", answer: "Head chef" }, owner())).rejects.toThrow("NOT_FOUND");
      expect(writes).toHaveLength(0);
      expect(workLog).toHaveLength(0);
    });
  }
  it("Publish this page twice: the second is refused (already accepted)", async () => {
    state.pages.push({ ...draftPage(), ari_draft: false, enabled: true });
    await expect(runOwnerAriPageAction("ari_page_accept", { page_id: "p9" }, owner())).rejects.toThrow("PAGE_NOT_ARI_DRAFT");
    await expect(runOwnerAriPageAction("ari_page_remove", { page_id: "p9" }, owner())).rejects.toThrow("PAGE_NOT_ARI_DRAFT");
    expect(writes).toHaveLength(0);
  });
});

describe("#4453 m11 tester: answer_site_page_question (Ari relays the owner)", () => {
  const args = (over: Record<string, unknown> = {}) => ({
    brand_id: BRAND, site_id: "00000000-0000-4000-8000-0000000c0011", page_path: "private-hire", question_key: "ada_role",
    answer: "Head chef", why: "The owner told me Ada's role.", cites: [{ kind: "owner_words", quote: "Ada is our head chef" }], ...over,
  });
  it("flag off -> ARI_ADD_PAGE_OFF, nothing written", async () => {
    state.pages.push(draftPage());
    await expect(runAriPageAction("answer_site_page_question", args(), ctx(false))).rejects.toThrow("ARI_ADD_PAGE_OFF");
    expect(writes).toHaveLength(0);
  });
  it("an answer the owner never said -> CITATION_REQUIRED, nothing written", async () => {
    state.pages.push(draftPage());
    await expect(runAriPageAction("answer_site_page_question", args({ answer: "Michelin-starred head chef" }), ctx())).rejects.toThrow("CITATION_REQUIRED");
    await expect(runAriPageAction("answer_site_page_question", args({ cites: [{ kind: "mingla_record", record_id: BRAND }] }), ctx())).rejects.toThrow("CITATION_REQUIRED");
    expect(writes).toHaveLength(0);
  });
  it("even the owner's words offering a pass are refused", async () => {
    state.pages.push(draftPage());
    await expect(runAriPageAction("answer_site_page_question", args({ answer: "Sells season passes", cites: [{ kind: "owner_words", quote: "Ada sells season passes" }] }), ctx())).rejects.toThrow("UNSELLABLE_OFFER");
    expect(writes).toHaveLength(0);
  });
  it("an owner page is not Ari's to answer on", async () => {
    await expect(runAriPageAction("answer_site_page_question", args({ page_path: "about" }), ctx())).rejects.toThrow("PAGE_NOT_ARI_DRAFT");
  });
  it("the owner's verbatim words are written; the block stays Draft by Ari", async () => {
    state.pages.push(draftPage());
    await runAriPageAction("answer_site_page_question", args(), ctx());
    const update = writes.find((w) => w.collection === "pages")!;
    expect((update.data!.blocks as Array<Record<string, unknown>>)[1]).toMatchObject({ members: [{ name: "Ada", role: "Head chef" }] });
    expect(update.context).toMatchObject({ minglaReviewSource: "ari", minglaAriPage: true });
    expect(update.data).not.toHaveProperty("enabled");
    expect(update.data).not.toHaveProperty("ari_draft");
  });
});

describe("#4453 m11 tester: nothing under or linking to a Draft-by-Ari page is published (SC-N3)", () => {
  const TENANT = "00000000-0000-4000-8000-000000004453";
  async function build(includeAriDrafts: boolean) {
    const settings = { id: "s1", tenant: TENANT, display_name: "Proof", short_description: "x", canonical_url: "https://proof.sites.usemingla.com", seo_title: "Proof", seo_description: "x" };
    const pages = [
      { id: "p1", tenant: TENANT, slug: "", title: "Home", enabled: true, blocks: [
        { id: "h", blockType: "page_header", heading: "Welcome" },
        { id: "c", blockType: "cta", heading: "Hire the room", label: "See private hire", target_type: "page", page: "p3" },
      ] },
      { id: "p2", tenant: TENANT, slug: "about", title: "About", enabled: true, blocks: [{ id: "a", blockType: "page_header", heading: "About us" }] },
      {
        id: "p3", tenant: TENANT, slug: "private-hire", title: "Private hire", enabled: true,
        origin: "ari", ari_draft: true, ari_request: "OWNER-REQUEST-SECRET",
        owner_questions: [{ key: "q", question: "OWNER-QUESTION-SECRET", block_index: 0, field_path: "subheading" }],
        blocks: [{ id: "x", blockType: "page_header", heading: "Private hire", review: { state: "draft", source: "ari" } }],
      },
      { id: "p4", tenant: TENANT, slug: "menus", title: "Hire menus", parent: "p3", enabled: true, blocks: [{ id: "y", blockType: "page_header", heading: "CHILD-OF-DRAFT" }] },
    ];
    const navigation = [{ id: "n1", tenant: TENANT, items: [
      { label: "About", target_type: "page", page: "p2", children: [{ label: "Hire menus", target_type: "page", page: "p4" }, { label: "Hire", target_type: "page", page: "p3", draft: true }] },
    ] }];
    state.pages = pages;
    const collections: Record<string, unknown[]> = { pages, navigation, footer: [{ id: "f1", tenant: TENANT, links: [{ label: "Hire", target_type: "page", page: "p3" }] }], "site-settings": [settings], media: [] };
    const sourceDigest = await publicationDraftDigest({ pages, navigation: navigation[0]!, footer: collections.footer![0] ?? null, settings, media: [] });
    const req = { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never;
    return buildPublicationArtifact(req, {
      tenant: { id: TENANT, core_site_id: "00000000-0000-4000-8000-000000004454", core_brand_id: "00000000-0000-4000-8000-000000004455", primary_hostname: "proof.sites.usemingla.com" },
      operationId: "op-4453", publicationId: includeAriDrafts ? `preview-${"a".repeat(32)}` : "00000000-0000-4000-8000-000000004456", sourceRevisionId: "rev-4453", sourceDigest,
      generatedAt: "2026-11-17T00:00:00Z", enforceReview: false, includeAriDrafts,
    } as never);
  }

  it("a publish has neither the Draft page nor the page under it, and no link to either", async () => {
    const built = await build(false);
    expect(built.artifact.pages.map((p) => p.path).sort()).toEqual(["", "about"]);
    for (const secret of ["private-hire", "CHILD-OF-DRAFT", "OWNER-QUESTION-SECRET", "OWNER-REQUEST-SECRET", "draft_by_ari", "Hire menus"]) {
      expect(built.serialized).not.toContain(secret);
    }
  });

  it("the private preview keeps the Draft page and its child disabled (child unmarked), with no owner-only field", async () => {
    const built = await build(true);
    const byPath = new Map(built.artifact.pages.map((p) => [p.path, p]));
    expect(byPath.get("private-hire")).toMatchObject({ enabled: false, draft_by_ari: true });
    expect(byPath.get("private-hire/menus")).toMatchObject({ enabled: false });
    expect(built.serialized).not.toContain("OWNER-QUESTION-SECRET");
    expect(built.serialized).not.toContain("OWNER-REQUEST-SECRET");
    expect(JSON.stringify(built.artifact.navigation)).not.toContain("private-hire");
  });
});
