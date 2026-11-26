/**
 * #4453 website workspace (build contract A) — the owner's section actions.
 *
 * Drives the REAL content endpoint with the REAL Pages, Site settings and
 * Navigation hooks (the revision check, the ready-media check, the review
 * stamp); only Payload's storage and Core's signature are faked
 * (workspaceTestKit.issue4453.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/gateway", () => ({
  verifyCoreRequest: vi.fn(async () => ({ site_id: "44530000-0000-4000-8000-00000000c001" })),
  callCore: vi.fn(async () => { throw new Error("the workspace never asks Core for anything"); }),
}));
vi.mock("../lib/config", () => ({ cmsConfig: () => ({ approvedBucket: "approved", artifactBucket: "artifacts" }) }));
vi.mock("../lib/objectStore", () => ({
  presignedGet: vi.fn(async (_bucket: string, key: string) => `https://thumbs.test/${key}`),
  readObject: vi.fn(async () => { throw new Error("not read"); }),
}));
vi.mock("../lib/lookSavedReport", () => ({ reportLookSavedHook: () => async () => undefined }));

import { contentEndpoints, CONTENT_ACTION_MIN_RANK, WORKSPACE_ACTIONS } from "./contentEndpoint";
import { DESIGNS, DESIGN_KEYS } from "../contracts/generated/designs.ts";
import { BLOCK_TYPES } from "../contracts/generated/blocks.ts";
import { ADDABLE_SECTION_TYPES, SECTION_WORDS, layoutsFor, sectionCatalog } from "../lib/sectionActions";
import {
  BRAND, PHOTO_A, PHOTO_B, PHOTO_C, PHOTO_PROCESSING, SITE, USER, VIDEO, LONG_VIDEO,
  blocksOf, pageOf, revisionOf, seedSite, signedRequest, type Doc,
} from "./workspaceTestKit.issue4453";

type Site = Awaited<ReturnType<typeof seedSite>>;

async function call(site: Site, action: string, args: Doc = {}, who: { user?: string; rank?: number } = {}) {
  const response = await contentEndpoints[0]!.handler(signedRequest(site, {
    action, site_id: SITE, brand_id: BRAND, user_id: who.user ?? USER, rank: who.rank ?? 20, args,
  }));
  const json = await response.json() as Doc;
  // `audit` is for Core alone (it records the change and strips it before the app sees the answer).
  const { audit, ...data } = (json.data ?? {}) as Doc;
  return { status: response.status, ok: json.ok === true, data, audit: audit as Doc | undefined, error: (json.error ?? {}) as Doc };
}

const sections = async (site: Site, pageId: string) => (await call(site, "page_sections", { page_id: pageId })).data.sections as Doc[];
const section = async (site: Site, pageId: string, type: string) => (await sections(site, pageId)).find((row) => row.type === type)!;

let site: Site;
beforeEach(async () => {
  vi.useRealTimers();
  site = await seedSite();
});

describe("#4453 workspace reads", () => {
  it("every workspace action is a content action at the content rank", () => {
    for (const action of WORKSPACE_ACTIONS) expect(CONTENT_ACTION_MIN_RANK[action], action).toBe(20);
    expect([...WORKSPACE_ACTIONS].sort()).toEqual([
      "add_section", "edit_section", "history", "move_section", "page_sections", "redo", "remove_section",
      "section_catalog", "set_look", "set_page_enabled", "set_section_media", "undo", "workspace",
    ]);
  });

  it("workspace: the draft, the look and menu revisions, every page, and what undo would do", async () => {
    const { status, data } = await call(site, "workspace");
    expect(status).toBe(200);
    expect(data.draft_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(data.design).toBe("pop");
    expect(data.look_revision).toBe(site.rows("site-settings")[0]!.updatedAt);
    expect(data.menu_revision).toBe(site.rows("navigation")[0]!.updatedAt);
    expect(data.pages).toEqual([
      { id: site.homeId, title: "Home", path: "", enabled: true, in_menu: false, revision: "1", ari_draft: false, unreviewed: 5 },
      { id: site.aboutId, title: "About", path: "about", enabled: true, in_menu: true, revision: "1", ari_draft: false, unreviewed: 2 },
    ]);
    expect(data.history).toEqual({ can_undo: false, can_redo: false, undo_label: null, redo_label: null });
  });

  it("page_sections: plain names by type and position, the design's layouts, fields, photos and what fills itself", async () => {
    const { status, data } = await call(site, "page_sections", { page_id: site.homeId });
    expect(status).toBe(200);
    expect(data.page).toEqual({ id: site.homeId, title: "Home", path: "", revision: "1" });
    const rows = data.sections as Doc[];
    expect(rows.map((row) => row.label)).toEqual(["Top of the page", "Words", "Questions and answers", "Your events", "Photos"]);
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2, 3, 4]);
    expect(rows.map((row) => row.id)).toEqual(blocksOf(site, site.homeId).map((block) => block.id));
    expect(rows.map((row) => row.feed)).toEqual([false, false, false, true, false]);
    for (const row of rows) expect(row.review).toEqual({ state: "draft", source: "composer" });

    const hero = rows[0]!;
    expect(hero.layout).toBe("pop-stack");
    expect(hero.layouts).toEqual([
      { key: "pop-stack", label: "Signature" },
      { key: "fullbleed", label: "Full picture" },
      { key: "editorial", label: "Words beside the picture" },
      { key: "arch", label: "Arched picture" },
    ]);
    expect(hero.can_remove).toBe(false);
    expect(hero.fields).toContainEqual({ key: "heading", label: "Heading", kind: "text", value: "Play together", max: 120 });
    expect(hero.fields).toContainEqual({ key: "subheading", label: expect.any(String), kind: "multiline", value: "Game nights in Lagos.", max: 300 });
    expect(hero.fields).toContainEqual({ key: "ctas.0.label", label: "Label 1", kind: "text", value: "See what's on", max: 80 });
    expect(hero.fields).toContainEqual({ key: "ctas.0.href", label: "Link 1", kind: "mingla_link", value: "/events", max: 2048 });
    expect(hero.media).toEqual([
      { slot: "media", label: "Photo", media_id: PHOTO_A, thumb_url: `https://thumbs.test/r/${PHOTO_A}/640.jpg` },
      { slot: "video", label: "Video", media_id: null, thumb_url: null },
    ]);

    const words = rows[1]!;
    expect(words.fields).toContainEqual({ key: "body", label: "Text", kind: "richtext", value: "We run game nights for friends.", max: 5000 });
    expect(words.can_remove).toBe(true);

    const faq = rows[2]!;
    expect((faq.fields as Doc[]).map((field) => field.key)).toEqual(["eyebrow", "heading", "items.0.question", "items.0.answer", "items.1.question", "items.1.answer"]);
    expect(faq.fields).toContainEqual({ key: "items.1.answer", label: "Answer 2", kind: "multiline", value: "Snacks are on sale.", max: 1000 });

    const gallery = rows[4]!;
    expect((gallery.media as Doc[]).map((slot) => [slot.slot, slot.label, slot.media_id])).toEqual([
      ["images.0", "Photo 1", PHOTO_A], ["images.1", "Photo 2", PHOTO_B], ["images.2", "Add a photo", null],
    ]);
    expect(gallery.fields).toContainEqual({ key: "images.0.alt", label: "Photo description 1", kind: "multiline", value: "The arcade floor", max: 240 });
  });

  it("section names and layout names are owner words in every design: never block, variant, token or revision", () => {
    const banned = /\b(block|variant|token|revision)s?\b/i;
    for (const type of BLOCK_TYPES) expect(SECTION_WORDS[type], type).not.toMatch(banned);
    for (const design of DESIGN_KEYS) {
      for (const type of BLOCK_TYPES) {
        const layouts = layoutsFor(design, type);
        expect(layouts.map((layout) => layout.key)).toEqual([...DESIGNS[design].variants[type]]);
        expect(new Set(layouts.map((layout) => layout.label)).size, `${design}.${type} layout names are distinct`).toBe(layouts.length);
        for (const layout of layouts) expect(layout.label, `${design}.${type}.${layout.key}`).not.toMatch(banned);
      }
      for (const entry of sectionCatalog(design, "user")) {
        expect(`${entry.label} ${entry.description}`, `${design}.${entry.type}`).not.toMatch(banned);
      }
    }
  });

  it("section_catalog: what an owner may add in this design, in plain words", async () => {
    const { data } = await call(site, "section_catalog");
    const types = data.types as Doc[];
    expect(types.map((entry) => entry.type)).toEqual([...ADDABLE_SECTION_TYPES]);
    expect(types.find((entry) => entry.type === "faq")).toEqual({ type: "faq", label: "Questions and answers", description: "Questions and answers that open and close.", needs_photo: false });
    expect(types.filter((entry) => entry.needs_photo).map((entry) => entry.type)).toEqual(["hero", "media_feature", "gallery"]);
    // #4575: the cover ("Big picture") is the owner's to add, first. The live booking sections are not added from here.
    for (const type of ["availability", "ticket_tiers", "process_steps"]) expect(types.map((entry) => entry.type)).not.toContain(type);
  });

  it("refuses a member below the content rank, and an unknown page", async () => {
    expect((await call(site, "workspace", {}, { rank: 10 })).status).toBe(403);
    const missing = await call(site, "page_sections", { page_id: "44530000-0000-4000-8000-0000000000ff" });
    expect([missing.status, missing.error.code]).toEqual([404, "NOT_FOUND"]);
  });
});

describe("#4453 edit_section", () => {
  it("changes words and the layout, returns the new revision, and reviews the Draft section the owner changed", async () => {
    const faq = await section(site, site.homeId, "faq");
    const { status, data, audit } = await call(site, "edit_section", {
      page_id: site.homeId, expected_revision: "1", section_id: faq.id,
      edits: [{ key: "heading", value: "Before you come" }, { key: "items.1.answer", value: "Yes: jollof and small chops." }],
    });
    expect(status).toBe(200);
    expect(data).toEqual({ page_revision: "2" });
    expect(audit).toEqual({ action: "content.updated", collection: "pages", entry: site.homeId });
    const stored = blocksOf(site, site.homeId);
    expect(stored[2]!.heading).toBe("Before you come");
    expect(stored[2]!.items[1].answer).toBe("Yes: jollof and small chops.");
    expect(stored[2]!.items[0].answer).toBe("Yes, bring your squad.");
    // A person changed it: reviewed, by them. Every other section keeps its Draft stamp.
    expect(stored[2]!.review).toMatchObject({ state: "reviewed", source: "person", by: USER });
    for (const index of [0, 1, 3, 4]) expect(stored[index]!.review).toMatchObject({ state: "draft", source: "composer" });

    const hero = await section(site, site.homeId, "hero");
    const layout = await call(site, "edit_section", { page_id: site.homeId, expected_revision: "2", section_id: hero.id, layout: "editorial" });
    expect(layout.data).toEqual({ page_revision: "3" });
    expect(blocksOf(site, site.homeId)[0]!.variant).toBe("editorial");
  });

  it("rich text travels as plain paragraphs, both ways", async () => {
    const words = await section(site, site.homeId, "rich_text");
    await call(site, "edit_section", { page_id: site.homeId, expected_revision: "1", section_id: words.id, edits: [{ key: "body", value: "First paragraph.\n\nSecond paragraph." }] });
    const stored = blocksOf(site, site.homeId)[1]!.content.root.children as Doc[];
    expect(stored.map((node) => node.children[0].text)).toEqual(["First paragraph.", "Second paragraph."]);
    const again = await section(site, site.homeId, "rich_text");
    expect((again.fields as Doc[]).find((field) => field.key === "body")!.value).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("refuses a stale revision with the latest one, and writes nothing", async () => {
    const faq = await section(site, site.homeId, "faq");
    await call(site, "edit_section", { page_id: site.homeId, expected_revision: "1", section_id: faq.id, edits: [{ key: "heading", value: "One" }] });
    const stale = await call(site, "edit_section", { page_id: site.homeId, expected_revision: "1", section_id: faq.id, edits: [{ key: "heading", value: "Two" }] });
    expect([stale.status, stale.error.code]).toEqual([409, "REVISION_CONFLICT"]);
    expect(stale.error.latest).toMatchObject({ revision: "2" });
    expect(blocksOf(site, site.homeId)[2]!.heading).toBe("One");
    expect((await call(site, "edit_section", { page_id: site.homeId, section_id: faq.id, edits: [{ key: "heading", value: "x" }] })).error.code).toBe("VALIDATION_FAILED");
  });

  it("names each refusal: unknown section, field not editable, value too long, required, markup, layout not in this design", async () => {
    const hero = await section(site, site.homeId, "hero");
    const edit = (args: Doc) => call(site, "edit_section", { page_id: site.homeId, expected_revision: "1", section_id: hero.id, ...args });

    expect((await edit({ section_id: "nope", edits: [{ key: "heading", value: "x" }] })).error).toMatchObject({ code: "SECTION_NOT_FOUND" });
    for (const key of ["variant", "media", "booking_target_id", "ctas.7.label", "review", "__proto__", "ctas.0.label.extra"]) {
      const refused = await edit({ edits: [{ key, value: "x" }] });
      expect(refused.error, key).toMatchObject({ code: "FIELD_NOT_EDITABLE", key });
    }
    expect((await edit({ edits: [{ key: "ctas.0.href", value: "https://tickets.example/book" }] })).error)
      .toMatchObject({ code: "VALIDATION_FAILED", key: "ctas.0.href" });
    expect((await edit({ edits: [{ key: "heading", value: "x".repeat(121) }] })).error).toMatchObject({ code: "VALUE_TOO_LONG", key: "heading", max: 120 });
    expect((await edit({ edits: [{ key: "ctas.0.label", value: "  " }] })).error).toMatchObject({ code: "FIELD_REQUIRED", key: "ctas.0.label" });
    expect((await edit({ edits: [{ key: "heading", value: "<b>Play</b>" }] })).error).toMatchObject({ code: "VALIDATION_FAILED" });
    const layout = await edit({ layout: "cover-bottom-search" });
    expect(layout.error).toMatchObject({ code: "LAYOUT_NOT_IN_DESIGN", layouts: ["pop-stack", "fullbleed", "editorial", "arch"] });
    expect((await edit({})).error.code).toBe("VALIDATION_FAILED");
    // Nothing above was written.
    expect(revisionOf(site, site.homeId)).toBe("1");
    expect(site.rows("draft-changes")).toEqual([]);
  });

  it("an optional field can be emptied", async () => {
    const hero = await section(site, site.homeId, "hero");
    const { status } = await call(site, "edit_section", { page_id: site.homeId, expected_revision: "1", section_id: hero.id, edits: [{ key: "subheading", value: "" }] });
    expect(status).toBe(200);
    expect(blocksOf(site, site.homeId)[0]!.subheading).toBeNull();
  });
});

describe("#4453 list rows: add, remove and move (list_ops)", () => {
  const ops = (list_ops: Doc[], extra: Doc = {}) => call(site, "edit_section", {
    page_id: site.homeId, expected_revision: revisionOf(site, site.homeId), section_id: blocksOf(site, site.homeId)[2]!.id, list_ops, ...extra,
  });
  const questions = () => blocksOf(site, site.homeId)[2]!.items.map((row: Doc) => row.question);

  it("page_sections describes each list whose rows can change", async () => {
    const rows = await sections(site, site.homeId);
    expect(rows[2]!.lists).toEqual([{
      name: "items", label: expect.any(String), item_label: "Question", min: 1, max: expect.any(Number), count: 2,
      fields: [{ key: "question", label: "Question", kind: "multiline", max: 240 }, { key: "answer", label: "Answer", kind: "multiline", max: 1000 }],
    }]);
    // The top's headline lines can be added; its buttons need a link, so their rows are not added by hand.
    expect((rows[0]!.lists as Doc[]).map((list) => list.name)).toEqual(["heading_lines", "fact_badges"]);
    expect((rows[0]!.lists as Doc[])[0]).toMatchObject({ item_label: "Line", min: 0, count: 0 });
    // Photos are changed through their photo spots, and a section Mingla fills has no rows to add.
    expect(rows[4]!.lists).toEqual([]);
    expect(rows[3]!.lists).toEqual([]);
  });

  it("adds a row with its words (or starter words), at the top or after a row", async () => {
    const added = await ops([{ list: "items", op: "add", after_index: 0, values: { question: "Where do I park?", answer: "On the street outside." } }]);
    expect(added.status, JSON.stringify(added.error)).toBe(200);
    expect(added.data).toEqual({ page_revision: "2" });
    expect(questions()).toEqual(["Can I bring friends?", "Where do I park?", "Is there food?"]);
    expect(blocksOf(site, site.homeId)[2]!.items[1].id).toMatch(/^[0-9a-f]{24}$/);
    // A person changed the section: reviewed, by them.
    expect(blocksOf(site, site.homeId)[2]!.review).toMatchObject({ state: "reviewed", source: "person" });

    await ops([{ list: "items", op: "add", after_index: null }]);
    expect(blocksOf(site, site.homeId)[2]!.items[0]).toMatchObject({ question: "Add a question", answer: "Add the answer" });
    // Rows first, then words: one call adds a row and writes into it.
    await ops([{ list: "items", op: "add", after_index: 3 }], { edits: [{ key: "items.4.question", value: "Is it loud?" }] });
    expect(questions()).toEqual(["Add a question", "Can I bring friends?", "Where do I park?", "Is there food?", "Is it loud?"]);
  });

  it("removes and moves rows, and all of it is one undoable change", async () => {
    const before = structuredClone(blocksOf(site, site.homeId));
    const done = await ops([{ list: "items", op: "add", after_index: 1, values: { question: "Third?", answer: "Yes." } }, { list: "items", op: "move", index: 2, to_index: 0 }, { list: "items", op: "remove", index: 1 }]);
    expect(done.status).toBe(200);
    expect(questions()).toEqual(["Third?", "Is there food?"]);
    expect(site.rows("draft-changes")).toHaveLength(1);
    expect(site.rows("draft-changes")[0]).toMatchObject({ label: "Edit Questions and answers", merge_key: null });
    expect((await call(site, "undo")).status).toBe(200);
    expect(blocksOf(site, site.homeId)).toEqual(before);
  });

  it("names each refusal: a list that is not edited by hand, a full list, the last row it must keep, a bad row or field", async () => {
    for (const list of ["images", "ctas", "nope", 7]) {
      const refused = await call(site, "edit_section", { page_id: site.homeId, expected_revision: "1", section_id: blocksOf(site, site.homeId)[list === "images" ? 4 : 0]!.id, list_ops: [{ list, op: "add", after_index: null }] });
      expect(refused.error.code, String(list)).toBe("LIST_NOT_EDITABLE");
    }
    const grid = await call(site, "edit_section", { page_id: site.homeId, expected_revision: "1", section_id: blocksOf(site, site.homeId)[3]!.id, list_ops: [{ list: "offerings", op: "add", after_index: null }] });
    expect(grid.error.code).toBe("LIST_NOT_EDITABLE");

    const one = await ops([{ list: "items", op: "remove", index: 0 }, { list: "items", op: "remove", index: 0 }]);
    expect(one.error).toMatchObject({ code: "LIST_ROW_REQUIRED", list: "items", min: 1 });
    const max = (await sections(site, site.homeId))[2]!.lists[0].max as number;
    pageOf(site, site.homeId).blocks[2].items = Array.from({ length: max }, (_, n) => ({ id: `row-${n}`, question: `Q${n}?`, answer: "A." }));
    expect((await ops([{ list: "items", op: "add", after_index: null }])).error).toMatchObject({ code: "LIST_LIMIT_REACHED", list: "items", max });

    pageOf(site, site.homeId).blocks[2].items.length = 2;
    expect((await ops([{ list: "items", op: "add", after_index: null, values: { question: "x".repeat(241) } }])).error).toMatchObject({ code: "VALUE_TOO_LONG", max: 240 });
    expect((await ops([{ list: "items", op: "add", after_index: null, values: { href: "/x" } }])).error.code).toBe("FIELD_NOT_EDITABLE");
    expect((await ops([{ list: "items", op: "add", after_index: null, values: { question: "<i>x</i>" } }])).error.code).toBe("VALIDATION_FAILED");
    for (const bad of [{ list: "items", op: "remove", index: 99 }, { list: "items", op: "move", index: 0, to_index: -1 }, { list: "items", op: "add", after_index: 99 }, { list: "items", op: "clear" }, "add"]) {
      expect((await ops([bad as Doc])).error.code, JSON.stringify(bad)).toBe("VALIDATION_FAILED");
    }
    expect(revisionOf(site, site.homeId)).toBe("1");
  });
});

describe("#4453 move, remove and add a section", () => {
  it("move_section puts a section at a new place and keeps every stamp", async () => {
    const faq = await section(site, site.homeId, "faq");
    const { data } = await call(site, "move_section", { page_id: site.homeId, expected_revision: "1", section_id: faq.id, to_index: 4 });
    expect(data).toEqual({ page_revision: "2" });
    expect(blocksOf(site, site.homeId).map((block) => block.blockType)).toEqual(["hero", "rich_text", "offering_grid", "gallery", "faq"]);
    for (const block of blocksOf(site, site.homeId)) expect(block.review).toMatchObject({ state: "draft", source: "composer" });
    for (const to of [-1, 5, 1.5, "2"]) {
      expect((await call(site, "move_section", { page_id: site.homeId, expected_revision: "2", section_id: faq.id, to_index: to })).error.code, String(to)).toBe("VALIDATION_FAILED");
    }
    expect((await call(site, "move_section", { page_id: site.homeId, expected_revision: "1", section_id: faq.id, to_index: 0 })).error.code).toBe("REVISION_CONFLICT");
  });

  it("remove_section takes a section off the page; the home page keeps its top picture", async () => {
    const rows = await sections(site, site.homeId);
    const { data } = await call(site, "remove_section", { page_id: site.homeId, expected_revision: "1", section_id: rows[2]!.id });
    expect(data).toEqual({ page_revision: "2" });
    expect(blocksOf(site, site.homeId).map((block) => block.blockType)).toEqual(["hero", "rich_text", "offering_grid", "gallery"]);
    const hero = await call(site, "remove_section", { page_id: site.homeId, expected_revision: "2", section_id: rows[0]!.id });
    expect(hero.error.code).toBe("SECTION_CANNOT_BE_REMOVED");
    expect((await call(site, "remove_section", { page_id: site.homeId, expected_revision: "2", section_id: rows[2]!.id })).error.code).toBe("SECTION_NOT_FOUND");
  });

  it("add_section places a new section after the named one (or at the top), with starter words the owner must read", async () => {
    const rows = await sections(site, site.aboutId);
    const added = await call(site, "add_section", { page_id: site.aboutId, expected_revision: "1", type: "faq", after_section_id: rows[0]!.id });
    expect(added.status).toBe(200);
    expect(added.data.page_revision).toBe("2");
    const stored = blocksOf(site, site.aboutId);
    expect(stored.map((block) => block.blockType)).toEqual(["page_header", "faq", "rich_text"]);
    expect(added.data.section_id).toBe(stored[1]!.id);
    expect(stored[1]!.variant).toBe("split");
    expect(stored[1]!.items).toHaveLength(2);
    expect(stored[1]!.items[0]).toMatchObject({ question: "Add a question", answer: "Add the answer" });
    // Starter words are the owner's to read before publishing; writing their own reviews it.
    expect(stored[1]!.review).toMatchObject({ state: "draft", source: "person" });
    await call(site, "edit_section", { page_id: site.aboutId, expected_revision: "2", section_id: stored[1]!.id, edits: [{ key: "items.0.question", value: "Where are you?" }] });
    expect(blocksOf(site, site.aboutId)[1]!.review).toMatchObject({ state: "reviewed", source: "person" });

    const top = await call(site, "add_section", { page_id: site.aboutId, expected_revision: "3", type: "divider", after_section_id: null });
    expect(top.status).toBe(200);
    expect(blocksOf(site, site.aboutId)[0]!.blockType).toBe("divider");
  });

  it("a photo section starts from one of the owner's ready photos", async () => {
    const none = await call(site, "add_section", { page_id: site.aboutId, expected_revision: "1", type: "gallery", after_section_id: null });
    expect(none.error.code).toBe("MEDIA_REQUIRED");
    const processing = await call(site, "add_section", { page_id: site.aboutId, expected_revision: "1", type: "gallery", after_section_id: null, media_id: PHOTO_PROCESSING });
    expect(processing.error.code).toBe("MEDIA_PROCESSING");
    const ok = await call(site, "add_section", { page_id: site.aboutId, expected_revision: "1", type: "media_feature", after_section_id: null, media_id: PHOTO_C });
    expect(ok.status).toBe(200);
    expect(blocksOf(site, site.aboutId)[0]).toMatchObject({ blockType: "media_feature", media: PHOTO_C, alignment: "left" });
  });

  it("refuses a type that cannot be added, an unknown place, and a full page", async () => {
    const add = (args: Doc) => call(site, "add_section", { page_id: site.aboutId, expected_revision: "1", after_section_id: null, ...args });
    for (const type of ["availability", "nonsense", 7]) expect((await add({ type })).error.code, String(type)).toBe("SECTION_TYPE_NOT_AVAILABLE");
    // #4572 item 8 follows #4575: a cover is not refused off Home; it only needs its photo.
    expect((await add({ type: "hero" })).error.code).toBe("MEDIA_REQUIRED");
    expect((await add({ type: "faq", after_section_id: "nope" })).error.code).toBe("SECTION_NOT_FOUND");
    pageOf(site, site.aboutId).blocks = Array.from({ length: 60 }, () => ({ id: crypto.randomUUID().slice(0, 24), blockType: "divider", variant: "neutral" }));
    expect((await add({ type: "faq" })).error).toMatchObject({ code: "SECTION_LIMIT_REACHED", max: 60 });
  });
});

describe("#4453 set_section_media", () => {
  it("swaps a section's photo for a ready one, adds a short video to the top, and edits a photo list", async () => {
    const hero = await section(site, site.homeId, "hero");
    const swap = await call(site, "set_section_media", { page_id: site.homeId, expected_revision: "1", section_id: hero.id, slot: "media", media_id: PHOTO_C });
    expect(swap.data).toEqual({ page_revision: "2" });
    expect(blocksOf(site, site.homeId)[0]!.media).toBe(PHOTO_C);
    expect(blocksOf(site, site.homeId)[0]!.review).toMatchObject({ state: "reviewed", source: "person" });
    await call(site, "set_section_media", { page_id: site.homeId, expected_revision: "2", section_id: hero.id, slot: "video", media_id: VIDEO });
    expect(blocksOf(site, site.homeId)[0]!.video).toBe(VIDEO);

    const gallery = await section(site, site.homeId, "gallery");
    await call(site, "set_section_media", { page_id: site.homeId, expected_revision: "3", section_id: gallery.id, slot: "images.2", media_id: PHOTO_C });
    expect(blocksOf(site, site.homeId)[4]!.images.map((row: Doc) => row.media)).toEqual([PHOTO_A, PHOTO_B, PHOTO_C]);
    await call(site, "set_section_media", { page_id: site.homeId, expected_revision: "4", section_id: gallery.id, slot: "images.0", media_id: null });
    expect(blocksOf(site, site.homeId)[4]!.images.map((row: Doc) => row.media)).toEqual([PHOTO_B, PHOTO_C]);
    // The description the owner wrote stays with its photo.
    await call(site, "set_section_media", { page_id: site.homeId, expected_revision: "5", section_id: gallery.id, slot: "images.0", media_id: PHOTO_A });
    expect(blocksOf(site, site.homeId)[4]!.images[0]).toMatchObject({ media: PHOTO_A });
  });

  it("refuses media that is not ready, not this site's, the wrong kind, too long, or a spot the section does not have", async () => {
    const hero = await section(site, site.homeId, "hero");
    const set = (args: Doc) => call(site, "set_section_media", { page_id: site.homeId, expected_revision: "1", section_id: hero.id, ...args });
    expect((await set({ slot: "media", media_id: PHOTO_PROCESSING })).error.code).toBe("MEDIA_PROCESSING");
    expect((await set({ slot: "media", media_id: "44530000-0000-4000-8000-0000000d00ff" })).error.code).toBe("MEDIA_NOT_FOUND");
    expect((await set({ slot: "media", media_id: VIDEO })).error.code).toBe("MEDIA_WRONG_KIND");
    expect((await set({ slot: "video", media_id: PHOTO_A })).error.code).toBe("MEDIA_WRONG_KIND");
    expect((await set({ slot: "video", media_id: LONG_VIDEO })).error.code).toBe("VIDEO_TOO_LONG");
    // The top picture is always needed: it can be swapped, never cleared.
    expect((await set({ slot: "media", media_id: null })).error.code).toBe("VALIDATION_FAILED");
    for (const slot of ["poster", "images.0", "media.0", "", 3]) expect((await set({ slot, media_id: PHOTO_B })).error.code, String(slot)).toBe("VALIDATION_FAILED");
    const gallery = await section(site, site.homeId, "gallery");
    expect((await set({ section_id: gallery.id, slot: "images.9", media_id: PHOTO_C })).error.code).toBe("VALIDATION_FAILED");
    expect(revisionOf(site, site.homeId)).toBe("1");
  });
});

describe("#4453 set_look and set_page_enabled", () => {
  const lookRevision = () => String(site.rows("site-settings")[0]!.updatedAt);

  it("set_look saves the style, colours, corners, button shape and motion, and reports readability", async () => {
    const saved = await call(site, "set_look", {
      expected_revision: lookRevision(), design: "haven", radius: "soft", button_shape: "pill", motion: "calm",
      tokens: { colors: { canvas: "#ffffff", ink_body: "#f4f4f4" } },
    });
    expect(saved.status).toBe(200);
    const stored = site.rows("site-settings")[0]!;
    expect(stored).toMatchObject({ design: "haven", radius: "soft", button_shape: "pill", motion: "calm", tokens: { colors: { canvas: "#ffffff", ink_body: "#f4f4f4" } } });
    expect(saved.data.look_revision).toBe(stored.updatedAt);
    const warnings = saved.data.warnings as Doc[];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatchObject({ pair: "body_on_canvas", sentence: expect.any(String), suggestion: expect.stringMatching(/^#[0-9a-f]{6}$/) });
    expect((await call(site, "workspace")).data.design).toBe("haven");
  });

  it("refuses a stale look, an unknown style, a colour that is not a colour, and nothing at all", async () => {
    const current = lookRevision();
    expect((await call(site, "set_look", { expected_revision: "2020-01-01T00:00:00.000Z", radius: "soft" })).error).toMatchObject({ code: "REVISION_CONFLICT", latest: { revision: current } });
    for (const bad of [{ design: "brutal" }, { radius: "huge" }, { button_shape: 3 }, { motion: "wild" }, { tokens: { colors: { canvas: "red" } } }, { tokens: "blue" }, { fonts: { display: { family: "Not A Real Font", source: "google" } } }, {}]) {
      const refused = await call(site, "set_look", { expected_revision: current, ...bad });
      expect(refused.error.code, JSON.stringify(bad)).toBe("VALIDATION_FAILED");
    }
    expect(lookRevision()).toBe(current);
  });

  it("set_page_enabled turns a page off and takes it out of the menu; Home is always on", async () => {
    const off = await call(site, "set_page_enabled", { page_id: site.aboutId, expected_revision: "1", enabled: false });
    expect(off.data).toEqual({ page_revision: "2", menu_changed: true });
    expect(pageOf(site, site.aboutId).enabled).toBe(false);
    // The link to another website stays; the page's own entry goes.
    expect(site.rows("navigation")[0]!.items.map((item: Doc) => item.label)).toEqual(["Instagram"]);
    const pages = (await call(site, "workspace")).data.pages as Doc[];
    expect(pages.find((page) => page.id === site.aboutId)).toMatchObject({ enabled: false, in_menu: false });

    const on = await call(site, "set_page_enabled", { page_id: site.aboutId, expected_revision: "2", enabled: true });
    expect(on.data).toEqual({ page_revision: "3", menu_changed: false });
    expect(pageOf(site, site.aboutId).enabled).toBe(true);

    const home = await call(site, "set_page_enabled", { page_id: site.homeId, expected_revision: "1", enabled: false });
    expect(home.error.code).toBe("HOME_ALWAYS_ON");
    expect(pageOf(site, site.homeId).enabled).toBe(true);
    expect((await call(site, "set_page_enabled", { page_id: site.aboutId, expected_revision: "3", enabled: "no" })).error.code).toBe("VALIDATION_FAILED");
    expect((await call(site, "set_page_enabled", { page_id: site.aboutId, expected_revision: "1", enabled: false })).error.code).toBe("REVISION_CONFLICT");
  });
});
