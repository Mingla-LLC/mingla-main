/**
 * #4453 website workspace (build contract B) — Ari's workspace actions:
 * the planning snapshot, one typed step at a time, and rolling a change set
 * back; plus the relaxed "one design pass per draft" rule.
 *
 * Drives the REAL /internal/ari endpoint with the REAL collection hooks; only
 * Payload's storage and Core's signature are faked
 * (workspaceTestKit.issue4453.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const envelope = vi.hoisted(() => ({ operation_id: null as string | null }));
vi.mock("../lib/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/gateway")>()),
  // Core signs the caller's operation id into the envelope (one per step).
  verifyCoreRequest: vi.fn(async () => ({ site_id: "44530000-0000-4000-8000-00000000c001", ...(envelope.operation_id ? { operation_id: envelope.operation_id } : {}) })),
  callCore: vi.fn(async () => { throw new Error("the workspace never asks Core for anything"); }),
}));
vi.mock("../lib/config", () => ({ cmsConfig: () => ({ approvedBucket: "approved", artifactBucket: "artifacts" }) }));
vi.mock("../lib/objectStore", () => ({ presignedGet: vi.fn(async () => "https://thumbs.test/x"), readObject: vi.fn(), writeObject: vi.fn() }));
vi.mock("../lib/lookSavedReport", () => ({ reportLookSavedHook: () => async () => undefined }));
vi.mock("../lib/observability", () => ({ emitCmsObservation: async () => {}, observeCmsEndpoint: (_r: string, _d: string, handler: unknown) => handler }));

import { sitesEndpoints } from "./sitesEndpoints";
import { contentEndpoints } from "./contentEndpoint";
import { ARI_DESIGNER_ACTIONS, ARI_REFUSAL_CODES, parseAriEvidence, runAriDesignerAction, type AriActionContext } from "../lib/ariSiteActions";
import { parseSignedDesignPass } from "../lib/designPassInputs";
import { undoRedo } from "../lib/draftHistory";
import { SITE_WORKSPACE_ACTIONS, WORKSPACE_MAX_BYTES } from "../lib/siteWorkspace";
import {
  BRAND, EVENT, PHOTO_A, PHOTO_B, PHOTO_C, PHOTO_PROCESSING, SITE, TENANT, USER,
  blocksOf, memberRequest, pageOf, revisionOf, seedSite, signedRequest, type Doc,
} from "./workspaceTestKit.issue4453";

type Site = Awaited<ReturnType<typeof seedSite>>;

const ariEndpoint = sitesEndpoints.find((endpoint) => endpoint.path === "/internal/ari")!;

const EVIDENCE = {
  booking_identity: 1,
  brand: { id: BRAND, name: "Gameland", description: "Play together. Game nights in Lagos for friends.", city: "Lagos", slug: "gameland", contact_email: "hello@gameland.example", contact_phone: null, social_handles: [] },
  offerings: [{ id: EVENT, kind: "event", title: "Friday Game Night", summary: "Consoles and board games.", start_at: "2026-12-04T19:00:00+01:00", min_price_minor: 500000, currency: "NGN" }],
};
const CITES = [{ kind: "owner_words", quote: "Make the top of the page about Lagos" }];
const GROUP = "44530000-0000-4000-8000-0000000f0001";

async function ari(site: Site, action: string, args: Doc = {}, extra: Doc = {}) {
  const response = await ariEndpoint.handler(signedRequest(site, {
    action, site_id: SITE, brand_id: BRAND, user_id: USER, rank: 20, args, evidence: EVIDENCE, ...extra,
  }));
  const json = await response.json() as Doc;
  return { status: response.status, data: (json.data ?? {}) as Doc, error: (json.error ?? {}) as Doc };
}

const apply = (site: Site, step: Doc, extra: Doc = {}) =>
  ari(site, "apply_site_change", { group_id: GROUP, group_label: "Make Home about Lagos", why: "The owner asked for it.", cites: CITES, step, ...extra });
const sectionId = (site: Site, pageId: string, type: string) => String(blocksOf(site, pageId).find((block) => block.blockType === type)!.id);

let site: Site;
beforeEach(async () => {
  envelope.operation_id = null;
  site = await seedSite();
});

describe("#4453 get_site_workspace", () => {
  it("the three actions are designer actions Studio answers", () => {
    for (const action of SITE_WORKSPACE_ACTIONS) expect(ARI_DESIGNER_ACTIONS.has(action), action).toBe(true);
    expect([...SITE_WORKSPACE_ACTIONS].sort()).toEqual(["apply_site_change", "get_site_workspace", "undo_site_change_group"]);
  });

  it("one compact snapshot: pages with their sections, the look, the menu, what can be added, photos and Mingla's facts", async () => {
    const { status, data } = await ari(site, "get_site_workspace");
    expect(status).toBe(200);
    expect(data.draft_digest).toMatch(/^[0-9a-f]{64}$/);
    expect((data.pages as Doc[]).map((page) => [page.id, page.title, page.path, page.enabled, page.in_menu])).toEqual([
      [site.homeId, "Home", "", true, false], [site.aboutId, "About", "about", true, true],
    ]);
    const hero = data.pages[0].sections[0] as Doc;
    expect(hero).toMatchObject({
      id: sectionId(site, site.homeId, "hero"), index: 0, type: "hero", label: "Top of the page", layout: "pop-stack",
      layouts: ["pop-stack", "fullbleed", "editorial", "arch"], feed: false, review: { state: "draft", source: "composer" },
      // Every photo spot is listed, the empty ones too (a step names a spot by its slot).
      media: [{ slot: "media", media_id: PHOTO_A }, { slot: "video", media_id: null }],
    });
    expect(hero.fields).toContainEqual({ key: "heading", value: "Play together" });
    expect(hero.fields).toContainEqual({ key: "ctas.0.label", value: "See what's on" });
    expect(data.pages[0].sections[3]).toMatchObject({ type: "offering_grid", label: "Your events", feed: true });
    expect(data.look).toMatchObject({ design: "pop", tokens: {}, readability_warnings: expect.any(Array) });
    expect(data.menu).toEqual([{ page_id: site.aboutId, label: "About" }]);
    expect((data.addable_sections as Doc[]).map((entry) => entry.type)).toContain("faq");
    // Ari adds only the kinds its own tools may write.
    expect((data.addable_sections as Doc[]).map((entry) => entry.type)).not.toContain("page_links");
    expect(data.media).toContainEqual({ id: PHOTO_A, kind: "photo", caption: "arcade-floor.jpg" });
    expect((data.media as Doc[]).map((item) => item.id)).not.toContain(PHOTO_PROCESSING);
    expect(data.facts.brand).toMatchObject({ id: BRAND, name: "Gameland", city: "Lagos" });
    expect(data.facts.offerings).toEqual([{ id: EVENT, kind: "event", title: "Friday Game Night", start_at: "2026-12-04T19:00:00+01:00", min_price_minor: 500000, currency: "NGN" }]);
    expect(JSON.stringify(data).length).toBeLessThan(WORKSPACE_MAX_BYTES);
  });

  it("lists every photo spot of a section, the empty ones too, so a step can name the spot to fill", async () => {
    pageOf(site, site.homeId).blocks[0].media = null;
    const { data } = await ari(site, "get_site_workspace");
    const hero = data.pages[0].sections[0] as Doc;
    expect(hero.media).toContainEqual({ slot: "media", media_id: null });
    const filled = await apply(site, { op: "set_section_media", page_id: site.homeId, section_id: hero.id, slot: "media", media_id: PHOTO_B }, { cites: [{ kind: "owner_material", media_id: PHOTO_B }] });
    expect(filled.status, JSON.stringify(filled.error)).toBe(200);
  });

  it("long words are cut at 280 characters and flagged", async () => {
    pageOf(site, site.homeId).blocks[2].items[0].answer = "word ".repeat(150).trim();
    const { data } = await ari(site, "get_site_workspace");
    const field = (data.pages[0].sections[2].fields as Doc[]).find((row) => row.key === "items.0.answer")!;
    expect(field.truncated).toBe(true);
    expect(String(field.value).length).toBe(280);
    expect(data.truncated_at).toBe(280);
  });

  it("stays under 24 KB however large the site is, and says what it left out", async () => {
    const template = structuredClone(pageOf(site, site.aboutId));
    const longText = "A long paragraph about game nights in Lagos. ".repeat(40);
    for (let n = 0; n < 40; n += 1) {
      site.rows("pages").push({
        ...structuredClone(template), id: crypto.randomUUID(), title: `Page ${n}`, slug: `page-${n}`,
        blocks: Array.from({ length: 30 }, (_, at) => ({ id: `${n}-${at}`.padEnd(24, "0"), blockType: "faq", variant: "split", heading: longText.slice(0, 120), items: [{ id: `${n}-${at}-q`, question: longText.slice(0, 240), answer: longText.slice(0, 1000) }] })),
      });
    }
    for (let n = 0; n < 80; n += 1) site.rows("media").push({ id: crypto.randomUUID(), tenant: TENANT, state: "READY", kind: "image", detected_mime: "image/jpeg", original_filename_safe: `photo-with-a-long-name-${n}.jpg` });
    const { status, data } = await ari(site, "get_site_workspace");
    expect(status).toBe(200);
    expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThanOrEqual(WORKSPACE_MAX_BYTES);
    expect(data.compacted).toBe(true);
    // Every page is still named; the ones that did not fit say so.
    expect((data.pages as Doc[]).length).toBe(42);
    expect((data.pages as Doc[]).some((page) => page.sections_omitted === true)).toBe(true);
    expect(data.pages[0].id).toBe(site.homeId);
    expect(data.pages[0].sections.length).toBe(5);
  });
});

describe("#4453 get_site_workspace on one very long page", () => {
  it("still names every section of the page, within the limit", async () => {
    const long = "A long paragraph about game nights in Lagos. ".repeat(30);
    pageOf(site, site.homeId).blocks = Array.from({ length: 60 }, (_, at) => ({
      id: `home-${at}`.padEnd(24, "0"), blockType: "faq", variant: "split", heading: long.slice(0, 120),
      items: Array.from({ length: 8 }, (_row, n) => ({ id: `q-${at}-${n}`, question: long.slice(0, 240), answer: long.slice(0, 1000) })),
    }));
    const { status, data } = await ari(site, "get_site_workspace");
    expect(status).toBe(200);
    expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThanOrEqual(WORKSPACE_MAX_BYTES);
    expect(data.pages[0].sections).toHaveLength(60);
    expect(data.pages[0].sections[59]).toMatchObject({ index: 59, type: "faq", label: "Questions and answers 60" });
  });
});

describe("#4453 apply_site_change", () => {
  it("edit_section: applies the words as Ari, stamps the section Draft by Ari, logs why, and records an undo entry", async () => {
    const hero = sectionId(site, site.homeId, "hero");
    // No Draft flag from Core: in the workspace a section Ari changes is ALWAYS the owner's to read.
    const { status, data } = await apply(site, { op: "edit_section", page_id: site.homeId, section_id: hero, edits: [{ key: "heading", value: "Lagos plays here" }], layout: "editorial" });
    expect(status).toBe(200);
    expect(data).toEqual({ ok: true, group_id: GROUP, page_revision: "2", touched: { page_id: site.homeId, section_id: hero }, draft_only: true });
    const stored = blocksOf(site, site.homeId)[0]!;
    expect([stored.heading, stored.variant]).toEqual(["Lagos plays here", "editorial"]);
    expect(stored.review).toMatchObject({ state: "draft", source: "ari", by: null });
    expect(site.rows("work-log")).toHaveLength(1);
    expect(site.rows("work-log")[0]).toMatchObject({ part: "copy", decision: "The owner asked for it.", actor: "ari", tool: "apply_site_change", target: `page:${site.homeId}#${hero}`, revision: "2" });
    expect(site.rows("draft-changes")).toHaveLength(1);
    expect(site.rows("draft-changes")[0]).toMatchObject({ group_id: GROUP, group_label: "Make Home about Lagos", actor: "ari", actor_user_id: USER, target: "page", target_id: site.homeId, state: "applied" });
  });

  it("an owner's reviewed section goes back to Draft when Ari changes it", async () => {
    pageOf(site, site.homeId).blocks[0].review = { state: "reviewed", source: "person", at: "2026-11-18T09:00:00.000Z", by: USER };
    await apply(site, { op: "edit_section", page_id: site.homeId, section_id: sectionId(site, site.homeId, "hero"), edits: [{ key: "heading", value: "Lagos plays here" }] });
    expect(blocksOf(site, site.homeId)[0]!.review).toMatchObject({ state: "draft", source: "ari" });
    // The sections it did not touch keep theirs.
    expect(blocksOf(site, site.homeId)[1]!.review).toMatchObject({ state: "draft", source: "composer" });
  });

  it("Ari's rules: copy cites its source, is truth-checked, a layout is one this design draws, a photo is ready", async () => {
    const hero = sectionId(site, site.homeId, "hero");
    const edit = (edits: Doc[], extra: Doc = {}) => apply(site, { op: "edit_section", page_id: site.homeId, section_id: hero, edits }, extra);

    expect((await edit([{ key: "heading", value: "Lagos plays here" }], { cites: [] })).error.code).toBe("CITATION_REQUIRED");
    expect((await edit([{ key: "heading", value: "Lagos plays here" }], { cites: [{ kind: "mingla_record", record_id: "44530000-0000-4000-8000-0000000000aa" }] })).error.code).toBe("CITATION_INVALID");
    const claim = await edit([{ key: "subheading", value: "The best arcade in Africa, open since 1999 with 250 consoles." }]);
    expect(claim.error.code).toBe("CLAIM_NOT_BACKED");
    expect((claim.error.claims as string[]).length).toBeGreaterThan(0);
    const layout = await apply(site, { op: "edit_section", page_id: site.homeId, section_id: hero, layout: "cover-bottom-search" }, { cites: [] });
    expect(layout.error).toMatchObject({ code: "LAYOUT_NOT_IN_DESIGN", variants: ["pop-stack", "fullbleed", "editorial", "arch"] });
    expect((await apply(site, { op: "set_section_media", page_id: site.homeId, section_id: hero, slot: "media", media_id: PHOTO_PROCESSING }, { cites: [] })).error.code).toBe("MEDIA_PROCESSING");
    // The same refusals as the owner's own edits.
    expect((await edit([{ key: "heading", value: "x".repeat(121) }])).error.code).toBe("VALUE_TOO_LONG");
    expect((await edit([{ key: "ctas.0.href", value: "https://tickets.example/book" }])).error.code).toBe("VALIDATION_FAILED");
    expect((await apply(site, { op: "edit_section", page_id: site.homeId, section_id: "nope", edits: [{ key: "heading", value: "Lagos" }] })).error.code).toBe("SECTION_NOT_FOUND");
    expect((await apply(site, { op: "edit_section", page_id: "44530000-0000-4000-8000-0000000000ff", section_id: hero, edits: [{ key: "heading", value: "Lagos" }] })).error.code).toBe("PAGE_NOT_FOUND");
    // A question form never offers a booking.
    pageOf(site, site.aboutId).blocks.push({ id: "c0ffee000000000000000001", blockType: "contact_form", variant: "neutral", heading: "Ask us", submit_label: "Send" });
    const booking = await apply(site, { op: "edit_section", page_id: site.aboutId, section_id: "c0ffee000000000000000001", edits: [{ key: "submit_label", value: "Book now" }] });
    expect(booking.error.code).toBe("BOOKING_THROUGH_ENQUIRY");
    // Nothing above reached the draft, the log or the history.
    expect(revisionOf(site, site.homeId)).toBe("1");
    expect(site.rows("work-log")).toEqual([]);
    expect(site.rows("draft-changes")).toEqual([]);
    for (const code of ["SECTION_NOT_FOUND", "FIELD_NOT_EDITABLE", "VALUE_TOO_LONG", "LAYOUT_NOT_IN_DESIGN", "UNREADABLE_COLOURS", "CHANGED_SINCE", "HOME_ALWAYS_ON"]) expect(ARI_REFUSAL_CODES.has(code), code).toBe(true);
  });

  it("the step is typed: a group, a reason, a known op, no revision and no stray keys", async () => {
    const hero = sectionId(site, site.homeId, "hero");
    const step = { op: "move_section", page_id: site.homeId, section_id: hero, to_index: 1 };
    const send = (args: Doc) => ari(site, "apply_site_change", args);
    const full = { group_id: GROUP, group_label: "Move it", why: "Asked.", step };
    for (const [name, args] of Object.entries({
      "no group": { ...full, group_id: undefined },
      "bad group": { ...full, group_id: "one" },
      "no label": { ...full, group_label: "" },
      "no why": { ...full, why: "" },
      "no step": { ...full, step: null },
      "unknown op": { ...full, step: { ...step, op: "publish" } },
      "names a revision": { ...full, step: { ...step, expected_revision: "1" } },
      "stray key": { ...full, step: { ...step, blocks: [] } },
    })) {
      expect((await send(args)).error.code, name).toBe("VALIDATION_FAILED");
    }
    expect(revisionOf(site, site.homeId)).toBe("1");
  });

  it("every other op: move, remove, add (with its words), a photo, the menu and turning a page off", async () => {
    const faq = sectionId(site, site.homeId, "faq");
    const moved = await apply(site, { op: "move_section", page_id: site.homeId, section_id: faq, to_index: 1 }, { cites: [] });
    expect(moved.data).toMatchObject({ ok: true, page_revision: "2", touched: { page_id: site.homeId, section_id: faq } });
    expect(blocksOf(site, site.homeId).map((block) => block.blockType)).toEqual(["hero", "faq", "rich_text", "offering_grid", "gallery"]);

    const removed = await apply(site, { op: "remove_section", page_id: site.homeId, section_id: sectionId(site, site.homeId, "gallery") }, { cites: [] });
    expect(removed.data).toMatchObject({ page_revision: "3", touched: { page_id: site.homeId } });
    expect((await apply(site, { op: "remove_section", page_id: site.homeId, section_id: sectionId(site, site.homeId, "hero") }, { cites: [] })).error.code).toBe("SECTION_CANNOT_BE_REMOVED");

    // A new section needs every word it must have: Ari never leaves starter words behind.
    const bare = await apply(site, { op: "add_section", page_id: site.aboutId, type: "pull_quote", after_section_id: null }, { cites: [] });
    expect(bare.error).toMatchObject({ code: "VALIDATION_FAILED", problems: ["add_section needs words for quote"] });
    const added = await apply(site, { op: "add_section", page_id: site.aboutId, type: "pull_quote", after_section_id: sectionId(site, site.aboutId, "page_header"), edits: [{ key: "quote", value: "Play together." }, { key: "attribution", value: "Gameland" }] });
    expect(added.status).toBe(200);
    const quote = blocksOf(site, site.aboutId)[1]!;
    expect(quote).toMatchObject({ blockType: "pull_quote", quote: "Play together.", attribution: "Gameland", review: { state: "draft", source: "ari" } });
    expect(added.data.touched).toEqual({ page_id: site.aboutId, section_id: quote.id });
    expect((await apply(site, { op: "add_section", page_id: site.aboutId, type: "page_links", after_section_id: null }, { cites: [] })).error.code).toBe("SECTION_TYPE_NOT_AVAILABLE");

    const photo = await apply(site, { op: "set_section_media", page_id: site.homeId, section_id: sectionId(site, site.homeId, "hero"), slot: "media", media_id: PHOTO_B }, { cites: [{ kind: "owner_material", media_id: PHOTO_B }] });
    expect(photo.status).toBe(200);
    expect(blocksOf(site, site.homeId)[0]).toMatchObject({ media: PHOTO_B, review: { state: "draft", source: "ari" } });

    const menu = await apply(site, { op: "set_menu", items: [{ page_id: site.aboutId, label: "Our story" }] });
    expect(menu.data).toMatchObject({ ok: true, menu_revision: site.rows("navigation")[0]!.updatedAt, touched: {} });
    expect(site.rows("navigation")[0]!.items.map((item: Doc) => item.label)).toEqual(["Our story", "Instagram"]);
    expect((await apply(site, { op: "set_menu", items: [{ page_id: site.aboutId, label: "About" }] }, { cites: [] })).error.code).toBe("CITATION_REQUIRED");
    expect((await apply(site, { op: "set_menu", items: [{ page_id: site.homeId, label: "Home" }] })).error.code).toBe("VALIDATION_FAILED");

    const off = await apply(site, { op: "set_page_enabled", page_id: site.aboutId, enabled: false }, { cites: [] });
    expect(off.status).toBe(200);
    expect(pageOf(site, site.aboutId).enabled).toBe(false);
    expect((await apply(site, { op: "set_page_enabled", page_id: site.homeId, enabled: false }, { cites: [] })).error.code).toBe("HOME_ALWAYS_ON");
  });

  it("set_look: changes colours it names and keeps the rest; an unreadable pair is refused with the nearest readable colour", async () => {
    site.rows("site-settings")[0]!.tokens = { colors: { surface: "#fafafa" } };
    const ok = await apply(site, { op: "set_look", tokens: { colors: { canvas: "#fffaf0" } }, radius: "soft" }, { cites: [] });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ ok: true, look_revision: site.rows("site-settings")[0]!.updatedAt, touched: {} });
    expect(site.rows("site-settings")[0]).toMatchObject({ radius: "soft", tokens: { colors: { surface: "#fafafa", canvas: "#fffaf0" } } });

    const before = structuredClone(site.rows("site-settings")[0]!);
    const unreadable = await apply(site, { op: "set_look", tokens: { colors: { ink_body: "#fffaf1" } } }, { cites: [] });
    expect(unreadable.error.code).toBe("UNREADABLE_COLOURS");
    expect((unreadable.error.problems as string[]).length).toBeGreaterThan(0);
    expect(site.rows("site-settings")[0]).toEqual(before);
    // Ari changes the whole style through the design pass; the owner picks any style in Design.
    expect((await apply(site, { op: "set_look", design: "haven" }, { cites: [] })).error.code).toBe("VALIDATION_FAILED");
    expect((await apply(site, { op: "set_look" }, { cites: [] })).error.code).toBe("VALIDATION_FAILED");
  });

  it("set_look fonts: Ari names a family; it is stored as a Google font beside the fonts the owner already chose", async () => {
    site.rows("site-settings")[0]!.fonts = { body: { family: "Inter", source: "google" } };
    const ok = await apply(site, { op: "set_look", fonts: { display: { family: "Playfair Display" } } }, { cites: [] });
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    // Without a source the fonts check refuses the choice (or the look drops it when read back).
    expect(site.rows("site-settings")[0]!.fonts).toEqual({ body: { family: "Inter", source: "google" }, display: { family: "Playfair Display", source: "google" } });
    const before = structuredClone(site.rows("site-settings")[0]!);
    const unknown = await apply(site, { op: "set_look", fonts: { display: { family: "Not A Real Font" } } }, { cites: [] });
    expect(unknown.error.code).toBe("VALIDATION_FAILED");
    expect(site.rows("site-settings")[0]).toEqual(before);
  });

  it("each step reads the current revision itself and tries once more on a clash", async () => {
    const update = site.payload.update;
    let clashes = 1;
    site.payload.update = (async (args: Doc) => {
      if (args.collection === "pages" && clashes > 0) {
        clashes -= 1;
        throw new Error("REVISION_CONFLICT");
      }
      return update(args);
    }) as typeof update;
    const hero = sectionId(site, site.homeId, "hero");
    const once = await apply(site, { op: "edit_section", page_id: site.homeId, section_id: hero, edits: [{ key: "heading", value: "Lagos plays here" }] });
    expect(once.status).toBe(200);
    expect(blocksOf(site, site.homeId)[0]!.heading).toBe("Lagos plays here");
    clashes = 2;
    const twice = await apply(site, { op: "edit_section", page_id: site.homeId, section_id: hero, edits: [{ key: "heading", value: "Lagos, again" }] });
    expect([twice.status, twice.error.code]).toEqual([409, "REVISION_CONFLICT"]);
    expect(blocksOf(site, site.homeId)[0]!.heading).toBe("Lagos plays here");
    site.payload.update = update;
  });
});

describe("#4453 apply_site_change runs once per operation id", () => {
  const OP = "44530000-0000-4000-8000-0000000f0a01";
  const addQuote = () => apply(site, { op: "add_section", page_id: site.aboutId, type: "pull_quote", after_section_id: null, edits: [{ key: "quote", value: "Play together." }] });

  it("a repeat returns the first result and applies nothing: no second section, history row or log row", async () => {
    envelope.operation_id = OP;
    const first = await addQuote();
    expect(first.status).toBe(200);
    const snapshot = { blocks: structuredClone(blocksOf(site, site.aboutId)), revision: revisionOf(site, site.aboutId) };
    expect(site.rows("draft-changes")).toHaveLength(1);
    expect(site.rows("draft-changes")[0]).toMatchObject({ operation_id: OP, result: first.data });

    const again = await addQuote();
    expect(again.status).toBe(200);
    expect(again.data).toEqual({ ...first.data, repeated: true });
    expect(blocksOf(site, site.aboutId)).toEqual(snapshot.blocks);
    expect(revisionOf(site, site.aboutId)).toBe(snapshot.revision);
    expect(site.rows("draft-changes")).toHaveLength(1);
    expect(site.rows("work-log")).toHaveLength(1);

    // Another step (its own id) does apply.
    envelope.operation_id = "44530000-0000-4000-8000-0000000f0a02";
    expect((await addQuote()).status).toBe(200);
    expect(blocksOf(site, site.aboutId).filter((block) => block.blockType === "pull_quote")).toHaveLength(2);
    expect(site.rows("draft-changes")).toHaveLength(2);
  });

  it("a repeat while the first try is still running is refused (never a second copy); a refused first try can run again", async () => {
    envelope.operation_id = OP;
    const update = site.payload.update;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    site.payload.update = (async (args: Doc) => {
      if (args.collection === "pages") await gate;
      return update(args);
    }) as typeof update;
    const first = addQuote();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await addQuote();
    expect([second.status, second.error.code]).toEqual([409, "STEP_IN_PROGRESS"]);
    release();
    expect((await first).status).toBe(200);
    site.payload.update = update;
    expect(blocksOf(site, site.aboutId).filter((block) => block.blockType === "pull_quote")).toHaveLength(1);
    expect(((await addQuote()).data as Doc).repeated).toBe(true);

    // A first try that was refused left nothing behind: the same id runs once it is right.
    envelope.operation_id = "44530000-0000-4000-8000-0000000f0a03";
    const refused = await apply(site, { op: "add_section", page_id: site.aboutId, type: "pull_quote", after_section_id: null });
    expect(refused.error.code).toBe("VALIDATION_FAILED");
    expect(site.rows("gateway-nonces").filter((row) => String(row.nonce).startsWith("site-step:"))).toHaveLength(1);
    expect((await addQuote()).status).toBe(200);
    expect(blocksOf(site, site.aboutId).filter((block) => block.blockType === "pull_quote")).toHaveLength(2);
  });
});

describe("#4453 the snapshot names every id the way a step names it", () => {
  it("has draft_digest, and every id sits under id, page_id, section_id or media_id; a step built from it applies", async () => {
    const { data } = await ari(site, "get_site_workspace");
    expect(data.draft_digest).toMatch(/^[0-9a-f]{64}$/);
    const idKeys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== "object") return;
      for (const [key, inner] of Object.entries(value as Doc)) {
        if (key === "id" || key.endsWith("_id")) idKeys.add(key);
        walk(inner);
      }
    };
    walk(data);
    expect([...idKeys].sort()).toEqual(["id", "media_id", "page_id"]);
    // Pages and sections are `id`; a section's photo is `media_id`; a menu entry is `page_id`; the library's photos are `id`.
    const page = (data.pages as Doc[])[0]!;
    const section = (page.sections as Doc[])[2]!;
    expect(section.lists).toEqual([{ name: "items", min: 1, max: expect.any(Number), count: 2, fields: ["question", "answer"] }]);
    const applied = await apply(site, { op: "edit_section", page_id: page.id, section_id: section.id, list_ops: [{ list: "items", op: "add", after_index: 1, values: { question: "Can I bring friends too?", answer: "Yes, bring your squad." } }] });
    expect(applied.status, JSON.stringify(applied.error)).toBe(200);
    expect(blocksOf(site, site.homeId)[2]!.items).toHaveLength(3);
    expect(blocksOf(site, site.homeId)[2]!.review).toMatchObject({ state: "draft", source: "ari" });
  });

  it("Ari's list steps: a new row needs its words and a source; remove and move need neither", async () => {
    const faq = sectionId(site, site.homeId, "faq");
    const step = (list_ops: Doc[], extra: Doc = {}) => apply(site, { op: "edit_section", page_id: site.homeId, section_id: faq, list_ops }, extra);
    expect((await step([{ list: "items", op: "add", after_index: null }])).error).toMatchObject({ code: "VALIDATION_FAILED", problems: ["the new row needs words for items.0.question", "the new row needs words for items.0.answer"] });
    expect((await step([{ list: "items", op: "add", after_index: null, values: { question: "Is it loud?", answer: "Yes." } }], { cites: [] })).error.code).toBe("CITATION_REQUIRED");
    expect((await step([{ list: "items", op: "add", after_index: null, values: { question: "Is it the best in Africa?", answer: "Voted number 1 since 1999." } }])).error.code).toBe("CLAIM_NOT_BACKED");
    expect((await step([{ list: "items", op: "move", index: 1, to_index: 0 }], { cites: [] })).status).toBe(200);
    expect((await step([{ list: "items", op: "remove", index: 0 }], { cites: [] })).status).toBe(200);
    expect((await step([{ list: "items", op: "remove", index: 0 }], { cites: [] })).error).toMatchObject({ code: "LIST_ROW_REQUIRED", list: "items", min: 1 });
    // The top's fact badges are the owner's own Quick facts: not Ari's to add.
    expect((await apply(site, { op: "edit_section", page_id: site.homeId, section_id: sectionId(site, site.homeId, "hero"), list_ops: [{ list: "fact_badges", op: "add", after_index: null, values: { big: "24", small: "consoles" } }] })).error.code).toBe("LIST_NOT_EDITABLE");
    expect(blocksOf(site, site.homeId)[2]!.items.map((row: Doc) => row.question)).toEqual(["Can I bring friends?"]);
  });
});

describe("#4453 undo_site_change_group", () => {
  it("a multi-step run is one change set: undone together, on every page, the look and the menu", async () => {
    const start = { home: structuredClone(blocksOf(site, site.homeId)), about: structuredClone(blocksOf(site, site.aboutId)), menu: structuredClone(site.rows("navigation")[0]!.items), settings: structuredClone(site.rows("site-settings")[0]!) };
    const hero = sectionId(site, site.homeId, "hero");
    expect((await apply(site, { op: "edit_section", page_id: site.homeId, section_id: hero, edits: [{ key: "heading", value: "Lagos plays here" }] })).status).toBe(200);
    expect((await apply(site, { op: "move_section", page_id: site.homeId, section_id: sectionId(site, site.homeId, "faq"), to_index: 1 }, { cites: [] })).status).toBe(200);
    expect((await apply(site, { op: "add_section", page_id: site.aboutId, type: "pull_quote", after_section_id: null, edits: [{ key: "quote", value: "Play together." }] })).status).toBe(200);
    expect((await apply(site, { op: "set_menu", items: [{ page_id: site.aboutId, label: "Our story" }] })).status).toBe(200);
    expect((await apply(site, { op: "set_look", radius: "round" }, { cites: [] })).status).toBe(200);

    // The owner sees ONE entry, by Ari, with the request's name.
    const history = await contentEndpoints[0]!.handler(signedRequest(site, { action: "history", site_id: SITE, brand_id: BRAND, user_id: USER, rank: 20, args: {} }));
    expect(((await history.json()) as Doc).data.entries).toEqual([{ group_id: GROUP, label: "Make Home about Lagos", actor: "ari", at: expect.any(String), state: "applied" }]);

    const undone = await ari(site, "undo_site_change_group", { group_id: GROUP });
    expect(undone.status).toBe(200);
    expect(undone.data).toMatchObject({ group_id: GROUP, label: "Make Home about Lagos", look: true, menu: true, undone: true, draft_only: true });
    expect([...(undone.data.pages as string[])].sort()).toEqual([site.homeId, site.aboutId].sort());
    // Everything is as it was, stamps included: nothing is left half-applied.
    expect(blocksOf(site, site.homeId)).toEqual(start.home);
    expect(blocksOf(site, site.aboutId)).toEqual(start.about);
    expect(site.rows("navigation")[0]!.items.map(({ id: _id, ...item }: Doc) => item)).toEqual(start.menu.map(({ id: _id, ...item }: Doc) => item));
    expect(site.rows("site-settings")[0]!.radius ?? null).toEqual(start.settings.radius ?? null);

    // Rolling back twice, or a run whose first step failed (nothing recorded), is not an error.
    const again = await ari(site, "undo_site_change_group", { group_id: GROUP });
    expect([again.status, again.data.undone]).toEqual([200, false]);
    const never = await ari(site, "undo_site_change_group", { group_id: "44530000-0000-4000-8000-0000000f00ff" });
    expect([never.status, never.data.undone]).toEqual([200, false]);
    expect((await ari(site, "undo_site_change_group", {})).error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses when the owner has changed one of those sections since (CHANGED_SINCE), leaving the draft alone", async () => {
    const hero = sectionId(site, site.homeId, "hero");
    await apply(site, { op: "edit_section", page_id: site.homeId, section_id: hero, edits: [{ key: "heading", value: "Lagos plays here" }] });
    pageOf(site, site.homeId).blocks[0].heading = "The owner's own line";
    const refused = await ari(site, "undo_site_change_group", { group_id: GROUP });
    expect([refused.status, refused.error.code]).toEqual([409, "CHANGED_SINCE"]);
    expect(blocksOf(site, site.homeId)[0]!.heading).toBe("The owner's own line");
  });
});

describe("#4453 the design pass may run again once the last one was undone or published", () => {
  function passContext(): AriActionContext {
    const scoped = memberRequest(site, { minglaReviewSource: "ari", minglaBookingBlocks: true });
    return {
      req: scoped, scoped, tenantId: TENANT, siteId: SITE, brandId: BRAND, userId: USER, rank: 50,
      evidence: parseAriEvidence(EVIDENCE, BRAND),
      designPass: parseSignedDesignPass({
        plan: { offerings_selected: ["events"], venue_descriptor: null, story: { who: "Gamers in Lagos", why: "Play together" } },
        answers: { value_points: [{ title: "Every console", sentence: "Every console you know." }, { title: "Friendly hosts", sentence: "Hosts who play too." }], faq: [{ question: "Can I bring friends?", answer: "Yes, bring your squad." }], process_steps: [], quick_facts: null },
        address: null,
        facts: { upcoming: { trip: 0, event: 3, experience: 0 }, ended: { trip: 0, event: 2, experience: 0 }, next_offering: { event: EVENT }, bookable: { event: 2 }, public_ticket_tiers: 2, mingla_reviews: 0 },
        style_library: true,
        live_fingerprints: [],
      }),
    };
  }
  const pass = (design: string) => runAriDesignerAction("propose_site_design_pass", { design_key: design, why: "It fits game nights.", cites: [{ kind: "mingla_record", record_id: EVENT }] }, passContext());
  const history = () => ({ req: memberRequest(site), scoped: memberRequest(site), tenantId: TENANT, userId: USER });

  it("refused twice on the same draft; allowed after its change set is undone; refused again once that one stands; allowed after a publish", async () => {
    const before = structuredClone(blocksOf(site, site.homeId));
    const first = await pass("pop") as Doc;
    expect(first.draft_only).toBe(true);
    expect(blocksOf(site, site.homeId)).not.toEqual(before);
    await expect(pass("pop")).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");

    // The pass is one undoable change set, by Ari.
    const rows = site.rows("draft-changes");
    expect(new Set(rows.map((row) => row.group_id)).size).toBe(1);
    expect(rows.every((row) => row.actor === "ari" && row.tool === "propose_site_design_pass" && row.group_label === "Ari designed your website")).toBe(true);

    const undone = await undoRedo(history(), "undo", null);
    expect(undone.label).toBe("Ari designed your website");
    expect(blocksOf(site, site.homeId)).toEqual(before);
    // A page the pass created is switched off again (never deleted).
    for (const page of site.rows("pages")) if (![site.homeId, site.aboutId].includes(String(page.id))) expect(page.enabled).toBe(false);

    // Undone: the draft is back where it was, so Ari may design it again, even inside the first claim's ten minutes.
    const second = await pass("pop") as Doc;
    expect(second.draft_only).toBe(true);
    await expect(pass("pop")).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");

    // Redone counts as standing too.
    await undoRedo(history(), "undo", null);
    await undoRedo(history(), "redo", null);
    await expect(pass("pop")).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");

    // Published: a new draft starts, with one fresh pass.
    site.rows("publication-jobs").push({ id: "job-1", tenant: TENANT, status: "published", createdAt: new Date(Date.now() + 60_000).toISOString() });
    const third = await pass("pop") as Doc;
    expect(third.draft_only).toBe(true);
  });
});
