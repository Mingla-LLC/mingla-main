// MINGLA-INVARIANT: I-PROPOSED-2829-16 | issue #2829 | The six design checks only warn and never change the site; a site's first publish is refused until the checks have run on exactly the version being published.
/*
 * #2829 W9b — Ari as the website designer, Studio side (lib/ariSiteActions.ts
 * + lib/designChecks.ts), over an in-memory Payload that applies the tenant
 * filter the way the multi-tenant plugin does.
 *
 *  - copy with a number, price, date or superlative nothing backs is REFUSED
 *    (CLAIM_NOT_BACKED names it) and nothing is written; the owner's quoted
 *    words or Mingla's feed back a claim;
 *  - every write needs a citation of this brand's own things, and writes the
 *    work log ("Why it looks like this") with the reason and citations;
 *  - a stale revision is refused (a Studio edit in between wins);
 *  - colours are stored EXACTLY as proposed; readability is reported, never
 *    adjusted (R-10);
 *  - a layout must be one the site's design draws;
 *  - a review comes only from text the owner pasted, word for word, and is
 *    created hidden and unconfirmed — Ari cannot show it or mark it real;
 *  - a whole-site composition is validated against the generated catalogue
 *    and applied all together or not at all; the menu takes Ari's labels;
 *  - the six design checks flag seeded problems, are stored per draft
 *    digest, and a FIRST publish is refused until a run exists for the draft.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ cmsConfig: () => ({ approvedBucket: "approved", artifactBucket: "artifacts" }) }));
vi.mock("./objectStore", () => ({ presignedGet: async (_b: string, key: string) => `https://storage.invalid/${key}`, readObject: vi.fn(), writeObject: vi.fn() }));
vi.mock("./mediaPipeline", () => ({ createUploadGrant: vi.fn(), completeUpload: vi.fn() }));
vi.mock("./gateway", () => ({ verifyCoreRequest: vi.fn(), callCore: vi.fn() }));
vi.mock("./observability", () => ({ observeCmsEndpoint: (_p: string, _d: string, handler: unknown) => handler, emitCmsObservation: vi.fn() }));

import {
  AriRefusal,
  assertFirstPublishChecked,
  ariBlockToStudio,
  designChecksRanOn,
  loadDraftState,
  parseAriEvidence,
  runAriDesignerAction,
  type AriActionContext,
} from "./ariSiteActions";
import { runDesignChecks } from "./designChecks";

const SITE = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const TRIP = "55555555-5555-4555-8555-555555555555";
const OTHER_BRAND_TRIP = "66666666-6666-4666-8666-666666666666";
const MEDIA_OK = "77777777-7777-4777-8777-777777777777";
const MEDIA_OTHER_TENANT = "88888888-8888-4888-8888-888888888888";
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let db: Record<string, Doc[]>;
let clock = 0;
let nextId = 1000;
const stamp = () => new Date(Date.UTC(2026, 9, 26, 12, 0, (clock += 1))).toISOString();

function matches(doc: Doc, where: Doc | undefined): boolean {
  if (!where) return true;
  if (Array.isArray(where.and)) return where.and.every((part: Doc) => matches(doc, part));
  return Object.entries(where).every(([field, condition]) => {
    const value = doc[field];
    if ("equals" in condition) return String(value) === String(condition.equals);
    if ("in" in condition) return condition.in.map(String).includes(String(value));
    if ("not_equals" in condition) return String(value) !== String(condition.not_equals);
    return true;
  });
}

let failNextPageUpdate = false;
const payload = {
  db: {},
  find: async ({ collection, where, req, overrideAccess, limit }: Doc) => {
    const tenant = overrideAccess ? null : req?.user?.tenantId;
    const docs = (db[collection] ?? []).filter((doc) => (tenant ? doc.tenant === tenant : true) && matches(doc, where));
    return { docs: typeof limit === "number" && limit > 0 ? docs.slice(0, limit) : docs, totalDocs: docs.length };
  },
  findByID: async ({ collection, id }: Doc) => (db[collection] ?? []).find((doc) => String(doc.id) === String(id)),
  create: async ({ collection, data, req }: Doc) => {
    const doc = {
      id: String((nextId += 1)),
      createdAt: stamp(),
      ...data,
      ...(req?.context?.minglaAriDraft === true ? { drafted_by: "ari" } : {}),
      updatedAt: stamp(),
      ...(collection === "pages" ? { revision: 1 } : {}),
    };
    if (collection === "testimonials" && doc.confirmed_real === true && req?.context?.minglaConfirmReview !== true) doc.confirmed_real = false;
    db[collection] = [...(db[collection] ?? []), doc];
    return doc;
  },
  update: async ({ collection, id, data, req }: Doc) => {
    if (collection === "pages" && failNextPageUpdate) {
      failNextPageUpdate = false;
      throw new Error("SERVICE_TEMPORARILY_UNAVAILABLE");
    }
    const doc = (db[collection] ?? []).find((row) => String(row.id) === String(id) && row.tenant === req.user.tenantId);
    if (!doc) throw new Error("NOT_FOUND");
    Object.assign(doc, data, { updatedAt: stamp() });
    if (collection === "pages") doc.revision = Number(doc.revision ?? 0) + 1;
    return doc;
  },
  delete: async () => undefined,
};

const EVIDENCE = parseAriEvidence({
  brand: { id: BRAND, name: "Young & Stamped", description: "Small-group trips for solo travellers since 2019.", city: "London" },
  offerings: [{
    id: TRIP, kind: "trip", title: "Bali Escape", summary: "Eight days in Bali", destination_text: "Bali",
    start_at: "2027-03-12T00:00:00Z", end_at: "2027-03-19T00:00:00Z", timezone: "UTC",
    min_price_minor: 120000, currency: "GBP", capacity: 12, spots_left: 4, group_minimum: 6,
  }],
}, BRAND)!;

function ctx(tenantId = TENANT_A, evidence = EVIDENCE): AriActionContext {
  const req = { payload, context: {} } as never;
  const scoped = { payload, context: { minglaSignedCore: true }, user: { id: OWNER, tenantId, rank: 20, siteId: SITE, brandId: BRAND } } as never;
  return { req, scoped, tenantId, siteId: SITE, brandId: BRAND, userId: OWNER, rank: 20, evidence };
}

const OWNER_WORDS = [{ kind: "owner_words", quote: "We take ten people on every trip" }];

async function refusal(promise: Promise<unknown>): Promise<AriRefusal> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AriRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

function page(path: string) {
  return db.pages!.find((doc) => (doc.slug ?? "") === path)!;
}

beforeEach(() => {
  clock = 0;
  failNextPageUpdate = false;
  db = {
    "site-settings": [{ id: "s1", tenant: TENANT_A, design: "voyage", tokens: {}, fonts: {}, updatedAt: "settings-r1" }],
    navigation: [{ id: "n1", tenant: TENANT_A, items: [{ id: "row", label: "Old", target_type: "page", page: "p2" }, { id: "x", label: "Shop", target_type: "url", url: "https://shop.example" }], updatedAt: "nav-r1" }],
    footer: [{ id: "f1", tenant: TENANT_A, updatedAt: "footer-r1" }],
    pages: [
      { id: "p1", tenant: TENANT_A, slug: "", title: "Home", kind: "standard", enabled: true, revision: 3, updatedAt: "p1",
        blocks: [{ blockType: "hero", variant: "cover-bottom-search", heading: "Leave with your people", media: MEDIA_OK, ctas: [] }] },
      { id: "p2", tenant: TENANT_A, slug: "about", title: "About", kind: "standard", enabled: true, revision: 5, updatedAt: "p2",
        blocks: [{ blockType: "rich_text", variant: "prose", heading: "Who we are", content: null }] },
      { id: "p9", tenant: TENANT_B, slug: "", title: "Other", kind: "standard", enabled: true, revision: 1, updatedAt: "p9", blocks: [] },
    ],
    media: [
      { id: MEDIA_OK, tenant: TENANT_A, state: "READY", detected_mime: "image/jpeg", width: 2400 },
      { id: MEDIA_OTHER_TENANT, tenant: TENANT_B, state: "READY", detected_mime: "image/jpeg", width: 2400 },
    ],
    destinations: [], stories: [], categories: [], testimonials: [],
    "work-log": [], "design-check-runs": [], "publication-jobs": [],
  };
});

describe("#2829 W9b propose_site_copy refuses claims Mingla can't back", () => {
  it("refuses an unbacked number and superlative, writes nothing and logs nothing", async () => {
    const error = await refusal(runAriDesignerAction("propose_site_copy", {
      page_path: "", expected_revision: "3", why: "Stronger headline", cites: OWNER_WORDS,
      edits: [{ block_index: 0, field: "heading", value: "The best trips: 500 travellers and counting" }],
    }, ctx()));
    expect(error.message).toBe("CLAIM_NOT_BACKED");
    expect(error.extra.claims).toEqual([
      "Check: 'best' isn't backed by anything in Mingla",
      "Check: '500 travellers' isn't backed by anything in Mingla",
    ]);
    expect(page("").blocks[0].heading).toBe("Leave with your people");
    expect(db["work-log"]).toHaveLength(0);
  });

  it("accepts claims the feed, the brand or the owner's quoted words back, and logs why with the citation", async () => {
    const result = await runAriDesignerAction("propose_site_copy", {
      page_path: "", expected_revision: "3", why: "Uses the owner's own line about group size.", cites: OWNER_WORDS,
      edits: [{ block_index: 0, field: "heading", value: "We take ten people on every trip, from £1,200, since 2019" }],
    }, ctx());
    expect(result).toMatchObject({ page_path: "", previous_revision: 3, revision: 4, draft_only: true });
    expect(page("").blocks[0].heading).toBe("We take ten people on every trip, from £1,200, since 2019");
    expect(db["work-log"]).toHaveLength(1);
    expect(db["work-log"]![0]).toMatchObject({
      tenant: TENANT_A, part: "copy", actor: "ari", tool: "propose_site_copy", target: "page:",
      decision: "Uses the owner's own line about group size.", cites: OWNER_WORDS, revision: "4",
    });
  });

  it("refuses a stale revision (a Studio edit in between wins)", async () => {
    const error = await refusal(runAriDesignerAction("propose_site_copy", {
      page_path: "", expected_revision: "2", why: "x", cites: OWNER_WORDS,
      edits: [{ block_index: 0, field: "heading", value: "Hello" }],
    }, ctx()));
    expect(error.message).toBe("REVISION_CONFLICT");
    expect(error.extra.latest_revision).toBe("3");
  });
});

describe("#2829 W9b every write cites this brand's own things", () => {
  it("refuses a write without a citation", async () => {
    const error = await refusal(runAriDesignerAction("propose_block_variant", {
      page_path: "", expected_revision: "3", block_index: 0, variant: "cover-bottom-search", why: "x", cites: [],
    }, ctx()));
    expect(error.message).toBe("CITATION_REQUIRED");
  });

  it("refuses a Mingla record or a photo that isn't this brand's", async () => {
    expect((await refusal(runAriDesignerAction("propose_block_variant", {
      page_path: "", expected_revision: "3", block_index: 0, variant: "cover-bottom-search", why: "x",
      cites: [{ kind: "mingla_record", record_id: OTHER_BRAND_TRIP }],
    }, ctx()))).message).toBe("CITATION_INVALID");
    expect((await refusal(runAriDesignerAction("propose_block_variant", {
      page_path: "", expected_revision: "3", block_index: 0, variant: "cover-bottom-search", why: "x",
      cites: [{ kind: "owner_material", media_id: MEDIA_OTHER_TENANT }],
    }, ctx()))).message).toBe("MEDIA_NOT_FOUND");
  });
});

describe("#2829 W9b looks and layouts", () => {
  it("stores the proposed colours exactly and only REPORTS readability (R-10)", async () => {
    const result = await runAriDesignerAction("propose_site_tokens", {
      expected_revision: "settings-r1", why: "Owner's brand colours", cites: OWNER_WORDS,
      tokens: { colors: { canvas: "#ffffff", ink_body: "#dddddd" } },
    }, ctx());
    expect(db["site-settings"]![0]!.tokens).toEqual({ colors: { canvas: "#ffffff", ink_body: "#dddddd" } });
    const warnings = result.readability_warnings as Array<{ pair: string; foreground: string; suggestion: string | null }>;
    const body = warnings.find((warning) => warning.pair === "body_on_canvas")!;
    expect(body.foreground).toBe("#dddddd");
    expect(typeof body.suggestion).toBe("string");
    expect(db["work-log"]![0]).toMatchObject({ part: "tokens", tool: "propose_site_tokens" });
  });

  it("refuses a layout the site's design doesn't draw", async () => {
    const error = await refusal(runAriDesignerAction("propose_block_variant", {
      page_path: "", expected_revision: "3", block_index: 0, variant: "atelier", why: "x", cites: OWNER_WORDS,
    }, ctx()));
    expect(error.message).toBe("VARIANT_NOT_IN_DESIGN");
    expect(error.extra.variants).toEqual(["cover-bottom-search"]);
  });
});

describe("#2829 W9b reviews only from text the owner pasted; never shown or confirmed by Ari", () => {
  const review = { quote: "Ten strangers on day one, family by day eight.", reviewer: "Alex R.", review_date: "2025-06-27" };
  it("needs the owner's pasted text and the quote word for word", async () => {
    expect((await refusal(runAriDesignerAction("propose_site_collection_entry", {
      collection: "testimonials", operation: "create", data: review, why: "x", cites: OWNER_WORDS,
    }, ctx()))).message).toBe("OWNER_SOURCE_REQUIRED");
    expect((await refusal(runAriDesignerAction("propose_site_collection_entry", {
      collection: "testimonials", operation: "create", data: { ...review, quote: "Best trip ever, 10/10." }, why: "x", cites: OWNER_WORDS,
      owner_source_text: "Alex R. wrote: Ten strangers on day one, family by day eight.",
    }, ctx()))).message).toBe("REVIEW_SOURCE_MISMATCH");
  });

  it("refuses to show it or mark it real", async () => {
    for (const key of ["enabled", "confirmed_real"]) {
      expect((await refusal(runAriDesignerAction("propose_site_collection_entry", {
        collection: "testimonials", operation: "create", data: { ...review, [key]: true }, why: "x", cites: OWNER_WORDS,
        owner_source_text: "Alex R. wrote: Ten strangers on day one, family by day eight.",
      }, ctx()))).message).toBe("VALIDATION_FAILED");
    }
  });

  it("creates it hidden, unconfirmed and marked as drafted by Ari", async () => {
    const result = await runAriDesignerAction("propose_site_collection_entry", {
      collection: "testimonials", operation: "create", data: review, why: "The owner pasted this review.", cites: OWNER_WORDS,
      owner_source_text: "From WeTravel — Alex R. wrote:\nTen strangers on day one,   family by day eight.",
    }, ctx());
    expect(result).toMatchObject({ collection: "testimonials", shown_on_website: false, confirmed_real: false, needs_owner_confirmation: true });
    const stored = db.testimonials![0]!;
    expect(stored).toMatchObject({ enabled: false, drafted_by: "ari", tenant: TENANT_A });
    expect(stored.confirmed_real ?? false).toBe(false);
    expect(db["work-log"]![0]).toMatchObject({ part: "collection", target: `testimonials:${stored.id}` });
  });
});

describe("#2829 W9b whole-site composition", () => {
  it("translates Ari's blocks to Studio's storage (declared renames only)", () => {
    expect(ariBlockToStudio({ type: "hero", variant: "cover-bottom-search", heading: "Hi", media_id: MEDIA_OK, ctas: [] }))
      .toEqual({ blockType: "hero", variant: "cover-bottom-search", heading: "Hi", media: MEDIA_OK, ctas: [] });
    expect(ariBlockToStudio({ type: "offering_grid", variant: "photo-card", offering_ids: [{ id: TRIP }] }))
      .toEqual({ blockType: "offering_grid", variant: "photo-card", offering_ids: [{ offering_id: TRIP }] });
  });

  it("applies pages and the menu together, with Ari's labels; links to other websites stay", async () => {
    const draft = await loadDraftState(ctx().req, ctx().scoped, TENANT_A);
    const result = await runAriDesignerAction("propose_site_composition", {
      expected_site_revision: draft.digest, why: "Plan approved: trips first.", cites: OWNER_WORDS,
      pages: [{ page_path: "about", blocks: [{ type: "rich_text", variant: "prose", heading: "Who we are", body: "We take ten people on every trip." }] }],
      new_pages: [{ slug: "trips", title: "Trips", blocks: [{ type: "offering_grid", variant: "photo-card", kind: "trip", mode: "upcoming" }] }],
      menu: [{ page_path: "trips", label: "Our trips" }, { page_path: "about", label: "About us" }],
    }, ctx());
    expect(result.site_revision).not.toBe(draft.digest);
    expect(page("about").blocks[0]).toMatchObject({ blockType: "rich_text", variant: "prose" });
    expect(page("trips").blocks[0]).toMatchObject({ blockType: "offering_grid", kind: "trip" });
    const items = db.navigation![0]!.items as Doc[];
    expect(items.map((item) => item.label)).toEqual(["Our trips", "About us", "Shop"]);
    expect(db["work-log"]![0]).toMatchObject({ part: "composition", target: "site" });
  });

  it("refuses a block the catalogue doesn't allow, and changes nothing", async () => {
    const draft = await loadDraftState(ctx().req, ctx().scoped, TENANT_A);
    const before = JSON.stringify(db.pages);
    const error = await refusal(runAriDesignerAction("propose_site_composition", {
      expected_site_revision: draft.digest, why: "x", cites: OWNER_WORDS,
      pages: [
        { page_path: "about", blocks: [{ type: "rich_text", variant: "prose", body: "Fine." }] },
        { page_path: "", blocks: [{ type: "hero", variant: "cover-bottom-search", heading: "<script>x</script>", media_id: MEDIA_OK, ctas: [] }] },
      ],
    }, ctx()));
    expect(error.message).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(db.pages)).toBe(before);
    expect(db["work-log"]).toHaveLength(0);
  });

  it("refuses a composition made against an older draft", async () => {
    const error = await refusal(runAriDesignerAction("propose_site_composition", {
      expected_site_revision: "0".repeat(64), why: "x", cites: OWNER_WORDS, menu: [{ page_path: "about", label: "About" }],
    }, ctx()));
    expect(error.message).toBe("REVISION_CONFLICT");
  });
});

describe("#2829 W9b the six design checks", () => {
  it("flag seeded problems as warnings in plain English", () => {
    const checks = runDesignChecks({
      pages: [
        { id: "p1", slug: "", title: "Home", enabled: true, blocks: [
          { blockType: "hero", variant: "cover-bottom-search", heading: "The best small-group trips for solo travellers in Europe and Asia", media: "small", ctas: [] },
          { blockType: "gallery", variant: "voyage", images: [{ media: MEDIA_OK, alt: "" }] },
          { blockType: "cta", variant: "dark-panel-glow", heading: "Lorem ipsum", label: "Go", href: "/tirps" },
        ] },
      ],
      settings: { design: "voyage", tokens: { colors: { canvas: "#ffffff", ink_body: "#eeeeee" } } },
      navigation: { items: [] },
      media: [{ id: MEDIA_OK, width: 2400, detected_mime: "image/jpeg" }, { id: "small", width: 640, detected_mime: "image/jpeg" }],
      content: {},
      evidence: { offerings: [], brand_texts: ["Young & Stamped"] },
      owner_texts: [],
    });
    const byKey = Object.fromEntries(checks.map((check) => [check.key, check]));
    expect(checks.map((check) => check.key)).toEqual(["words", "photos", "readability", "links", "truth", "phone"]);
    expect(byKey.words!.items.some((item) => item.message.includes("placeholder text"))).toBe(true);
    expect(byKey.photos!.items.some((item) => item.message.includes("640 px wide"))).toBe(true);
    expect(byKey.photos!.items.some((item) => item.message.includes("no description"))).toBe(true);
    expect(byKey.readability!.status).toBe("warn");
    expect(byKey.links!.items[0]!.message).toContain("“/tirps” doesn't go to a page on your website");
    expect(byKey.truth!.items[0]!.message).toContain("Check: 'best' isn't backed by anything in Mingla");
    expect(byKey.phone!.items[0]!.message).toContain("on a phone this design fits about 42");
  });

  it("offers the text wordmark for a tiny logo and an Add 3 photos to-do when the logo is the only image", () => {
    const checks = runDesignChecks({
      pages: [{ id: "p1", slug: "", title: "Home", enabled: true, blocks: [{ blockType: "page_header", heading: "Neutral Travel" }] }],
      settings: { design: "voyage", logo: "logo-small" },
      navigation: { items: [] },
      media: [{ id: "logo-small", width: 120, height: 60, detected_mime: "image/png" }],
      content: {}, evidence: { offerings: [], brand_texts: ["Neutral Travel"] }, owner_texts: [],
    });
    const photoMessages = checks.find((check) => check.key === "photos")!.items.map((item) => item.message);
    expect(photoMessages.some((message) => message.includes("Preview it small on both light and dark backgrounds"))).toBe(true);
    expect(photoMessages.some((message) => message.includes("use the text logo"))).toBe(true);
    expect(photoMessages).toContain("No photos yet. The colour hero stays intentional; add 3 photos when you are ready.");
  });

  it("are stored per draft digest, and a FIRST publish is refused until they ran on that draft", async () => {
    await expect(assertFirstPublishChecked({ payload } as never, TENANT_A, "a".repeat(64))).rejects.toThrow("DESIGN_CHECKS_REQUIRED");
    const run = await runAriDesignerAction("run_site_design_checks", {}, ctx()) as { draft_digest: string; checks: unknown[] };
    expect(run.checks).toHaveLength(6);
    expect(await designChecksRanOn({ payload } as never, TENANT_A, run.draft_digest)).toBe(true);
    expect(await designChecksRanOn({ payload } as never, TENANT_B, run.draft_digest)).toBe(false);
    await expect(assertFirstPublishChecked({ payload } as never, TENANT_A, run.draft_digest)).resolves.toBeUndefined();
    // A run on an older draft does not count for a changed one.
    await expect(assertFirstPublishChecked({ payload } as never, TENANT_A, "b".repeat(64))).rejects.toThrow("DESIGN_CHECKS_REQUIRED");
    // Once a site has published, later publishes never wait on the checks.
    db["publication-jobs"]!.push({ id: "j1", tenant: TENANT_A, status: "published" });
    await expect(assertFirstPublishChecked({ payload } as never, TENANT_A, "b".repeat(64))).resolves.toBeUndefined();
  });
});
