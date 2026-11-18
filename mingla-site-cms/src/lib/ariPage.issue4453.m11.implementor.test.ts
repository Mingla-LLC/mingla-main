// MINGLA-INVARIANT: I-SITES-ARI-QUESTIONS-OWNER-ONLY | issue #4453 | owner_questions, ari_request and origin never appear in any artifact; a page Ari added that the owner has not accepted (draft_by_ari) is disabled in every artifact and absent from every artifact but the private preview, so no menu, footer or page_links entry points at it.
// MINGLA-INVARIANT: I-SITES-NO-UNSELLABLE-OFFERS | issue #4453 | no Ari page plan or owner answer may offer something Mingla cannot sell yet (gift cards, vouchers, memberships, passes); each is refused with UNSELLABLE_OFFER and writes nothing.
/*
 * #4453 milestone 11 (spec v2.1 §3, SC-AP1, SC-AP2, SC-AP3, SC-N3) — "Add a
 * page with Ari" in Studio: the confirmed plan writes exactly one disabled
 * Draft-by-Ari page, one Draft menu entry and one work-log entry; every
 * refusal in SC-AP3 names its code and writes nothing; the owner's answer is
 * written verbatim; "Publish this page" reviews and switches it on; and the
 * builder never publishes a Draft-by-Ari page, its menu entry or its
 * questions (only the private preview keeps it, disabled and marked).
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
import { ARI_REFUSAL_CODES, type AriActionContext } from "./ariSiteActions";
import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";
import { DESIGNS } from "../contracts/generated/designs.ts";
import { ARI_PAGE_CODES } from "../contracts/generated/ariPage.ts";

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

async function refusal(args: Record<string, unknown>, context = ctx()): Promise<string> {
  try {
    await runAriPageAction("propose_site_page", args, context);
  } catch (error) {
    return (error as Error).message;
  }
  return "no refusal";
}

describe("#4453 milestone 11 propose_site_page (SC-AP1)", () => {
  it("writes one disabled Draft-by-Ari page, one Draft menu entry before About, one work-log entry", async () => {
    const result = await runAriPageAction("propose_site_page", plan(), ctx());
    const pages = writes.filter((w) => w.collection === "pages");
    expect(pages).toHaveLength(1);
    expect(pages[0]!.data).toMatchObject({ enabled: false, origin: "ari", ari_draft: true, ari_request: OWNER_REQUEST, slug: "private-hire" });
    expect((pages[0]!.data!.owner_questions as unknown[]).length).toBe(2);
    // Every block is stamped Draft by Ari by the review hook; the Ari page fields need this action's context.
    expect(pages[0]!.context).toMatchObject({ minglaReviewSource: "ari", minglaAriPage: true });
    const nav = writes.filter((w) => w.collection === "navigation");
    expect(nav).toHaveLength(1);
    const items = nav[0]!.data!.items as Array<Record<string, unknown>>;
    expect(items.map((item) => item.label)).toEqual(["Private hire", "About"]);
    expect(items[0]).toMatchObject({ draft: true });
    expect(workLog).toHaveLength(1);
    expect(workLog[0]).toMatchObject({ tool: "propose_site_page", actor: "ari" });
    expect(result).toMatchObject({ enabled: false, draft_by_ari: true, draft_only: true, page_path: "private-hire" });
    expect(nonces.size).toBe(0);
  });

  it("flag off: ARI_ADD_PAGE_OFF and nothing written", async () => {
    expect(await refusal(plan(), ctx(false))).toBe("ARI_ADD_PAGE_OFF");
    expect(writes).toHaveLength(0);
  });

  it("every milestone 11 code is a named Studio refusal", () => {
    for (const code of ARI_PAGE_CODES) expect(ARI_REFUSAL_CODES.has(code)).toBe(true);
  });
});

describe("#4453 milestone 11 refusals (SC-AP3), each writing nothing", () => {
  const cases: Array<[string, () => Record<string, unknown>, string, () => void]> = [
    ["a gift-card page", () => plan({ page: { ...plan().page, title: "Gift vouchers", slug: "gift-vouchers", menu_label: "Vouchers" } }), "UNSELLABLE_OFFER", () => undefined],
    ["an outbound booking button", () => plan({ blocks: [...plan().blocks, { type: "cta", variant: variant("cta"), heading: "Plan your night", label: "Book now", href: "https://bookings.example.com/x" }] }), "VALIDATION_FAILED", () => undefined],
    ["an invented price", () => plan({ blocks: [{ type: "page_header", variant: variant("page_header"), heading: "Private hire from ₦250,000" }] , questions: [] }), "CLAIM_NOT_BACKED", () => undefined],
    ["a have without a source", () => plan({ have: [{ text: "Seats 40", source: "mingla_record" }] }), "HAVE_WITHOUT_SOURCE", () => undefined],
    ["a reserved slug", () => plan({ page: { ...plan().page, slug: "api" } }), "VALIDATION_FAILED", () => undefined],
    ["a detail base slug", () => plan({ page: { ...plan().page, slug: "trips" } }), "VALIDATION_FAILED", () => undefined],
    ["a 13th block", () => plan({ blocks: Array.from({ length: 13 }, () => ({ type: "page_header", variant: variant("page_header"), heading: "x" })), questions: [] }), "VALIDATION_FAILED", () => undefined],
    ["a legal page Ari would write", () => plan({ page: { ...plan().page, title: "Privacy policy", slug: "privacy-policy", menu_label: "Privacy" } }), "ARI_PAGE_NOT_ALLOWED", () => undefined],
    ["a duplicate page", () => plan({ page: { ...plan().page, title: "About", slug: "about-us" } }), "ARI_PAGE_DUPLICATE", () => undefined],
    ["a request not cited verbatim", () => plan({ cites: [{ kind: "owner_words", quote: "something else" }] }), "CITATION_REQUIRED", () => undefined],
    ["a question on a required field", () => plan({ questions: [{ key: "h", question: "Heading?", block_index: 0, field_path: "heading" }] }), "VALIDATION_FAILED", () => undefined],
    ["an 11th Ari page", () => plan(), "ARI_PAGE_LIMIT", () => {
      state.pages.push(...Array.from({ length: 10 }, (_, n) => page(`a${n}`, `ari-${n}`, `Ari ${n}`, { origin: "ari", ari_draft: false })));
    }],
    ["a 4th open Draft", () => plan(), "ARI_DRAFT_PAGES_OPEN", () => {
      state.pages.push(...Array.from({ length: 3 }, (_, n) => page(`d${n}`, `draft-${n}`, `Draft ${n}`, { origin: "ari", ari_draft: true, enabled: false })));
    }],
    ["a 4th plan in 10 minutes", () => plan(), "ARI_PAGE_RATE_LIMITED", () => { workLog.push({}, {}, {}); }],
    ["a stale revision", () => plan({ expected_site_revision: "rev-0" }), "REVISION_CONFLICT", () => undefined],
  ];
  for (const [name, args, code, arrange] of cases) {
    it(`${name} -> ${code}`, async () => {
      arrange();
      const before = workLog.length;
      expect(await refusal(args())).toBe(code);
      expect(writes.filter((w) => w.collection !== "work-log")).toHaveLength(0);
      expect(workLog.length).toBe(before);
    });
  }
});

describe("#4453 milestone 11 answers and Publish this page (spec v2.1 §3.2-§3.3)", () => {
  const draftPage = () => page("p9", "private-hire", "Private hire", {
    origin: "ari", ari_draft: true, enabled: false,
    blocks: [{ id: "b0", blockType: "page_header", heading: "Private hire" }, { id: "b1", blockType: "team", members: [{ name: "Ada" }], review: { state: "draft", source: "ari" } }],
    owner_questions: [{ key: "ada_role", question: "What does Ada do?", block_index: 1, field_path: "members.0.role" }],
  });
  const owner = () => {
    const c = ctx();
    return { req: c.req, scoped: c.scoped, tenantId: c.tenantId, userId: c.userId, brandId: BRAND };
  };

  it("the owner's answer is written word for word, the question removed, the block still Draft", async () => {
    state.pages.push(draftPage());
    const out = await runOwnerAriPageAction("ari_page_answer", { page_id: "p9", question_key: "ada_role", answer: "Head chef, 12 years" }, owner());
    const update = writes.find((w) => w.collection === "pages")!;
    expect((update.data!.blocks as Array<Record<string, unknown>>)[1]).toMatchObject({ members: [{ name: "Ada", role: "Head chef, 12 years" }] });
    expect(update.data!.owner_questions).toEqual([]);
    expect(update.context).toMatchObject({ minglaReviewSource: "ari", minglaAriPage: true });
    expect(out).toMatchObject({ remaining_questions: 0 });
  });

  it("an answer offering a voucher or a booking is refused", async () => {
    state.pages.push(draftPage());
    await expect(runOwnerAriPageAction("ari_page_answer", { page_id: "p9", question_key: "ada_role", answer: "Sells our gift vouchers" }, owner())).rejects.toThrow("UNSELLABLE_OFFER");
    await expect(runOwnerAriPageAction("ari_page_answer", { page_id: "p9", question_key: "ada_role", answer: "Takes bookings and deposits" }, owner())).rejects.toThrow("BOOKING_THROUGH_ENQUIRY");
    await expect(runOwnerAriPageAction("ari_page_answer", { page_id: "p9", question_key: "nope", answer: "x" }, owner())).rejects.toThrow("QUESTION_NOT_FOUND");
    expect(writes.filter((w) => w.collection === "pages")).toHaveLength(0);
  });

  it("Publish this page: every block reviewed, the page on, the Draft marks cleared, a history line", async () => {
    state.pages.push(draftPage());
    state.navigation.items.unshift({ id: "i0", label: "Private hire", target_type: "page", page: "p9", draft: true });
    const out = await runOwnerAriPageAction("ari_page_accept", { page_id: "p9" }, owner());
    const update = writes.find((w) => w.collection === "pages")!;
    expect(update.data).toMatchObject({ enabled: true, ari_draft: false });
    expect(update.context).toMatchObject({ minglaMarkReviewed: "all", minglaAriPage: true });
    const nav = writes.find((w) => w.collection === "navigation")!;
    expect((nav.data!.items as Array<Record<string, unknown>>)[0]).toMatchObject({ draft: false, label: "Private hire" });
    expect(out).toMatchObject({ enabled: true, unanswered: 1, history_line: "Page added with Ari: Private hire" });
    expect(workLog.at(-1)).toMatchObject({ actor: "user", tool: "ari_page_accept" });
  });

  // #4453 m11 rework (tester P3-1) — publishing closes Ari's questions; nothing can be written into a published page.
  it("Publish this page closes Ari's open questions (owner_questions emptied)", async () => {
    state.pages.push(draftPage());
    await runOwnerAriPageAction("ari_page_accept", { page_id: "p9" }, owner());
    const update = writes.find((w) => w.collection === "pages")!;
    expect(update.data!.owner_questions).toEqual([]);
  });

  it("Ari's answer tool refuses a page the owner already published (origin ari, ari_draft false), writing nothing", async () => {
    state.pages.push({ ...draftPage(), ari_draft: false, enabled: true });
    const args = {
      brand_id: BRAND, site_id: "00000000-0000-4000-8000-0000000c0011", page_path: "private-hire", question_key: "ada_role",
      answer: "Head chef", why: "The owner told me Ada's role.", cites: [{ kind: "owner_words", quote: "Ada is our head chef" }],
    };
    await expect(runAriPageAction("answer_site_page_question", args, ctx())).rejects.toThrow("PAGE_NOT_ARI_DRAFT");
    expect(writes).toHaveLength(0);
    expect(workLog).toHaveLength(0);
  });

  it("the owner's answer route refuses a page already published, writing nothing", async () => {
    state.pages.push({ ...draftPage(), ari_draft: false, enabled: true });
    await expect(runOwnerAriPageAction("ari_page_answer", { page_id: "p9", question_key: "ada_role", answer: "Head chef" }, owner())).rejects.toThrow("PAGE_NOT_ARI_DRAFT");
    expect(writes).toHaveLength(0);
    expect(workLog).toHaveLength(0);
  });

  it("Remove deletes the Draft page and its menu entry; an owner page is never touched", async () => {
    state.pages.push(draftPage());
    state.navigation.items.unshift({ id: "i0", label: "Private hire", target_type: "page", page: "p9", draft: true });
    await runOwnerAriPageAction("ari_page_remove", { page_id: "p9" }, owner());
    expect(writes.some((w) => w.op === "delete" && w.collection === "pages")).toBe(true);
    expect((writes.find((w) => w.collection === "navigation")!.data!.items as unknown[])).toHaveLength(1);
    await expect(runOwnerAriPageAction("ari_page_remove", { page_id: "about" }, owner())).rejects.toThrow("PAGE_NOT_ARI_DRAFT");
  });
});

describe("#4453 milestone 11 the builder never publishes a Draft-by-Ari page (SC-N3, SC-AP2)", () => {
  const TENANT = "00000000-0000-4000-8000-000000004453";
  async function build(includeAriDrafts: boolean, enabledByHand = false) {
    const settings = { id: "s1", tenant: TENANT, display_name: "Proof", short_description: "x", canonical_url: "https://proof.sites.usemingla.com", seo_title: "Proof", seo_description: "x" };
    const pages = [
      { id: "p1", tenant: TENANT, slug: "", title: "Home", enabled: true, blocks: [{ id: "h", blockType: "page_header", heading: "Welcome" }] },
      { id: "p2", tenant: TENANT, slug: "about", title: "About", enabled: true, blocks: [{ id: "a", blockType: "page_header", heading: "About us" }] },
      {
        id: "p3", tenant: TENANT, slug: "private-hire", title: "Private hire", enabled: enabledByHand,
        origin: "ari", ari_draft: true, ari_request: "OWNER-REQUEST-SECRET",
        owner_questions: [{ key: "q", question: "OWNER-QUESTION-SECRET", block_index: 0, field_path: "subheading" }],
        blocks: [{ id: "x", blockType: "page_header", heading: "Private hire", review: { state: "draft", source: "ari" } }],
      },
    ];
    const navigation = [{ id: "n1", tenant: TENANT, items: [
      { label: "Private hire", target_type: "page", page: "p3", draft: true },
      { label: "About", target_type: "page", page: "p2" },
      { label: "Hire", target_type: "page", page: "p3" },
    ], header_cta: { label: "Hire us", target_type: "page", page: "p3" } }];
    state.pages = pages; // the builder reads every page through findAllTenantPages (mocked above)
    const collections: Record<string, unknown[]> = { pages, navigation, footer: [{ id: "f1", tenant: TENANT }], "site-settings": [settings], media: [] };
    const sourceDigest = await publicationDraftDigest({ pages, navigation: navigation[0]!, footer: collections.footer![0] ?? null, settings, media: [] });
    const req = { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never;
    return buildPublicationArtifact(req, {
      tenant: { id: TENANT, core_site_id: "00000000-0000-4000-8000-000000004454", core_brand_id: "00000000-0000-4000-8000-000000004455", primary_hostname: "proof.sites.usemingla.com" },
      operationId: "op-4453", publicationId: includeAriDrafts ? `preview-${"a".repeat(32)}` : "00000000-0000-4000-8000-000000004456", sourceRevisionId: "rev-4453", sourceDigest,
      generatedAt: "2026-11-17T00:00:00Z", enforceReview: !includeAriDrafts, includeAriDrafts,
    } as never);
  }

  it("a publish leaves the page, its menu entries, the header button and its questions out", async () => {
    for (const enabledByHand of [false, true]) {
      const built = await build(false, enabledByHand);
      expect(built.artifact.pages.map((p) => p.path).sort()).toEqual(["", "about"]);
      const text = built.serialized;
      for (const secret of ["private-hire", "OWNER-QUESTION-SECRET", "OWNER-REQUEST-SECRET", "owner_questions", "ari_request", "\"origin\"", "draft_by_ari"]) expect(text).not.toContain(secret);
      expect(built.artifact.navigation.items.map((item) => item.label)).toEqual(["About"]);
      expect(built.artifact.navigation.header_cta).toBeUndefined();
    }
  });

  it("the private preview keeps it disabled and marked, with no owner-only field", async () => {
    const built = await build(true, true);
    const draft = built.artifact.pages.find((p) => p.path === "private-hire")!;
    expect(draft).toMatchObject({ enabled: false, draft_by_ari: true });
    expect(built.serialized).not.toContain("OWNER-QUESTION-SECRET");
    expect(built.serialized).not.toContain("OWNER-REQUEST-SECRET");
    expect(built.artifact.navigation.items.map((item) => item.label)).toEqual(["About"]);
  });
});
