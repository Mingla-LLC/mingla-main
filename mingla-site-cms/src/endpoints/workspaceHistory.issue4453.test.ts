/**
 * #4453 website workspace (build contract C) — undo and redo, and the review
 * stamps around them.
 *
 * Drives the REAL content endpoint with the REAL collection hooks; only
 * Payload's storage and Core's signature are faked
 * (workspaceTestKit.issue4453.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/gateway", () => ({
  verifyCoreRequest: vi.fn(async () => ({ site_id: "44530000-0000-4000-8000-00000000c001" })),
  callCore: vi.fn(async () => { throw new Error("the workspace never asks Core for anything"); }),
}));
vi.mock("../lib/config", () => ({ cmsConfig: () => ({ approvedBucket: "approved", artifactBucket: "artifacts" }) }));
vi.mock("../lib/objectStore", () => ({ presignedGet: vi.fn(async () => "https://thumbs.test/x"), readObject: vi.fn() }));
vi.mock("../lib/lookSavedReport", () => ({ reportLookSavedHook: () => async () => undefined }));
vi.mock("../lib/observability", () => ({ emitCmsObservation: async () => {}, observeCmsEndpoint: (_r: string, _d: string, handler: unknown) => handler }));

import { contentEndpoints } from "./contentEndpoint";
import { HISTORY_ROW_CAP, sameContent } from "../lib/draftHistory";
import { BRAND, PHOTO_A, PHOTO_C, SITE, TEAMMATE, USER, blocksOf, pageOf, revisionOf, seedSite, signedRequest, type Doc } from "./workspaceTestKit.issue4453";

type Site = Awaited<ReturnType<typeof seedSite>>;

async function call(site: Site, action: string, args: Doc = {}, user = USER) {
  const response = await contentEndpoints[0]!.handler(signedRequest(site, { action, site_id: SITE, brand_id: BRAND, user_id: user, rank: 20, args }));
  const json = await response.json() as Doc;
  const { audit: _audit, ...data } = (json.data ?? {}) as Doc;
  return { status: response.status, data, error: (json.error ?? {}) as Doc };
}

const sectionId = (site: Site, pageId: string, type: string) => String(blocksOf(site, pageId).find((block) => block.blockType === type)!.id);
const edit = (site: Site, type: string, key: string, value: string, extra: Doc = {}, user = USER) =>
  call(site, "edit_section", { page_id: site.homeId, expected_revision: revisionOf(site, site.homeId), section_id: sectionId(site, site.homeId, type), edits: [{ key, value }], ...extra }, user);
const summary = async (site: Site) => (await call(site, "workspace")).data.history as Doc;
const entries = async (site: Site, user = USER) => (await call(site, "history", {}, user)).data.entries as Doc[];

let site: Site;
beforeEach(async () => {
  vi.useRealTimers();
  site = await seedSite();
});
afterEach(() => vi.useRealTimers());

describe("#4453 undo and redo: a page", () => {
  it("undo writes the section back as it was (ids and its Draft stamp included); redo applies the change again", async () => {
    const before = structuredClone(blocksOf(site, site.homeId));
    await edit(site, "faq", "heading", "Before you come");
    expect(await summary(site)).toEqual({ can_undo: true, can_redo: false, undo_label: "Edit Questions and answers", redo_label: null });
    const after = structuredClone(blocksOf(site, site.homeId));
    expect(after[2]!.review).toMatchObject({ state: "reviewed", source: "person" });

    const undone = await call(site, "undo");
    expect(undone.status).toBe(200);
    expect(undone.data).toEqual({ group_id: expect.stringMatching(/^[0-9a-f-]{36}$/), label: "Edit Questions and answers", pages: [site.homeId], look: false, menu: false });
    // Exactly as it was: the same section ids, and the section is a Draft from the composer again.
    expect(blocksOf(site, site.homeId)).toEqual(before);
    expect(revisionOf(site, site.homeId)).toBe("3");
    expect(await summary(site)).toEqual({ can_undo: false, can_redo: true, undo_label: null, redo_label: "Edit Questions and answers" });

    const redone = await call(site, "redo");
    expect(redone.data).toMatchObject({ group_id: undone.data.group_id, pages: [site.homeId] });
    expect(blocksOf(site, site.homeId)).toEqual(after);
    expect(revisionOf(site, site.homeId)).toBe("4");
    expect(await summary(site)).toMatchObject({ can_undo: true, can_redo: false });
  });

  it("round trips a move, a removal, an added section and a photo swap", async () => {
    const start = structuredClone(blocksOf(site, site.homeId));
    const rev = () => revisionOf(site, site.homeId);
    await call(site, "move_section", { page_id: site.homeId, expected_revision: rev(), section_id: sectionId(site, site.homeId, "faq"), to_index: 0 });
    await call(site, "remove_section", { page_id: site.homeId, expected_revision: rev(), section_id: sectionId(site, site.homeId, "gallery") });
    await call(site, "add_section", { page_id: site.homeId, expected_revision: rev(), type: "pull_quote", after_section_id: null });
    const end = structuredClone(blocksOf(site, site.homeId));
    expect((await entries(site)).map((entry) => entry.label)).toEqual(["Add Quote", "Remove Photos", "Move Questions and answers"]);
    for (let n = 0; n < 3; n += 1) expect((await call(site, "undo")).status).toBe(200);
    expect(blocksOf(site, site.homeId)).toEqual(start);
    expect((await call(site, "undo")).error.code).toBe("NOTHING_TO_UNDO");
    for (let n = 0; n < 3; n += 1) expect((await call(site, "redo")).status).toBe(200);
    expect(blocksOf(site, site.homeId)).toEqual(end);
    expect((await call(site, "redo")).error.code).toBe("NOTHING_TO_REDO");
  });

  it("CHANGED_SINCE: a change is not undone once the page has moved on, and nothing is written", async () => {
    await edit(site, "faq", "heading", "First");
    const first = (await entries(site))[0]!.group_id;
    await edit(site, "rich_text", "heading", "Second");
    const untouched = structuredClone(pageOf(site, site.homeId));

    const refused = await call(site, "undo", { group_id: first });
    expect([refused.status, refused.error.code]).toEqual([409, "CHANGED_SINCE"]);
    expect(refused.error).toMatchObject({ target: "page", page_id: site.homeId });
    expect(pageOf(site, site.homeId)).toEqual(untouched);
    expect((await entries(site)).map((entry) => entry.state)).toEqual(["applied", "applied"]);

    // In order it works: the newer change first, then the older one.
    expect((await call(site, "undo")).status).toBe(200);
    expect((await call(site, "undo", { group_id: first })).status).toBe(200);
    expect(blocksOf(site, site.homeId)[2]!.heading).toBe("Good to know");

    // A save from Studio in between: redo no longer fits either.
    pageOf(site, site.homeId).blocks[2].heading = "Edited in Studio";
    const redo = await call(site, "redo");
    expect(redo.error.code).toBe("CHANGED_SINCE");
    expect(blocksOf(site, site.homeId)[2]!.heading).toBe("Edited in Studio");
  });

  it("the comparison ignores row ids and review stamps: reviewing a section does not block an undo", async () => {
    await edit(site, "faq", "heading", "Before you come");
    const marked = await call(site, "mark_reviewed", { page_id: site.homeId, block_ids: "all" });
    expect(marked.status).toBe(200);
    expect(sameContent({ id: "a", review: { state: "draft" }, items: [{ id: "x", text: "One" }], empty: [], nothing: null }, { id: "b", items: [{ id: "y", text: "One" }] })).toBe(true);
    expect(sameContent({ items: [{ text: "One" }] }, { items: [{ text: "Two" }] })).toBe(false);
    expect((await call(site, "undo")).status).toBe(200);
    expect(blocksOf(site, site.homeId)[2]!.heading).toBe("Good to know");
  });

  it("a new change means the undone one can no longer be redone", async () => {
    await edit(site, "faq", "heading", "First");
    await call(site, "undo");
    expect((await summary(site)).can_redo).toBe(true);
    await edit(site, "rich_text", "heading", "Something else");
    expect(await summary(site)).toEqual({ can_undo: true, can_redo: false, undo_label: "Edit Words", redo_label: null });
    expect((await call(site, "redo")).error.code).toBe("NOTHING_TO_REDO");
    expect((await entries(site)).map((entry) => [entry.label, entry.state])).toEqual([["Edit Words", "applied"]]);
    expect(site.rows("draft-changes").map((row) => row.state).sort()).toEqual(["applied", "superseded"]);
  });
});

describe("#4453 undo and redo: the look and the menu", () => {
  it("round trips the look", async () => {
    const settings = () => site.rows("site-settings")[0]!;
    const saved = await call(site, "set_look", { expected_revision: settings().updatedAt, design: "haven", radius: "soft", tokens: { colors: { canvas: "#fff8f0" } } });
    expect(saved.status).toBe(200);
    expect((await summary(site)).undo_label).toBe("Change the style");
    const undone = await call(site, "undo");
    expect(undone.data).toMatchObject({ pages: [], look: true, menu: false });
    expect(settings().design).toBe("pop");
    expect(settings().radius ?? null).toBeNull();
    expect(settings().tokens ?? null).toBeNull();
    await call(site, "redo");
    expect(settings()).toMatchObject({ design: "haven", radius: "soft", tokens: { colors: { canvas: "#fff8f0" } } });
    // Changed by hand since: the undo is refused and the look stays.
    settings().radius = "round";
    expect((await call(site, "undo")).error).toMatchObject({ code: "CHANGED_SINCE", target: "look" });
    expect(settings().radius).toBe("round");
  });

  it("round trips the menu (set_menu records history)", async () => {
    const navigation = () => site.rows("navigation")[0]!;
    const labels = () => navigation().items.map((item: Doc) => item.label);
    const cleared = await call(site, "set_menu", { page_ids: [], expected_revision: navigation().updatedAt });
    expect(cleared.status).toBe(200);
    expect(labels()).toEqual(["Instagram"]);
    expect((await summary(site)).undo_label).toBe("Change the menu");
    const undone = await call(site, "undo");
    expect(undone.data).toMatchObject({ pages: [], look: false, menu: true });
    expect(labels()).toEqual(["About", "Instagram"]);
    await call(site, "redo");
    expect(labels()).toEqual(["Instagram"]);
  });

  it("the cover screen's change is undoable too (set_cover records history)", async () => {
    const saved = await call(site, "set_cover", { expected_revision: "1", photo_media_id: PHOTO_C });
    expect(saved.status, JSON.stringify(saved.error)).toBe(200);
    expect(blocksOf(site, site.homeId)[0]!.media).toBe(PHOTO_C);
    expect((await summary(site)).undo_label).toBe("Change the cover");
    await call(site, "undo");
    expect(blocksOf(site, site.homeId)[0]!.media).toBe(PHOTO_A);
  });

  it("turning a page off is one change: the page and the menu come back together", async () => {
    await call(site, "set_page_enabled", { page_id: site.aboutId, expected_revision: "1", enabled: false });
    expect((await entries(site)).map((entry) => entry.label)).toEqual(["Turn off About"]);
    const undone = await call(site, "undo");
    expect(undone.data).toMatchObject({ label: "Turn off About", pages: [site.aboutId], look: false, menu: true });
    expect(pageOf(site, site.aboutId).enabled).toBe(true);
    expect(site.rows("navigation")[0]!.items.map((item: Doc) => item.label)).toEqual(["About", "Instagram"]);
  });
});

describe("#4453 change sets, typing and the history list", () => {
  it("writes that share a group_id are one entry, undone together", async () => {
    const group = { group_id: "44530000-0000-4000-8000-0000000e0001", group_label: "Rewrite the top of Home" };
    await edit(site, "hero", "heading", "Lagos plays here", group);
    await edit(site, "hero", "subheading", "Every Friday night.", group);
    await edit(site, "rich_text", "heading", "How we started", group);
    expect(await entries(site)).toEqual([{ group_id: group.group_id, label: "Rewrite the top of Home", actor: "you", at: expect.any(String), state: "applied" }]);
    const undone = await call(site, "undo");
    expect(undone.data).toMatchObject({ group_id: group.group_id, label: "Rewrite the top of Home", pages: [site.homeId] });
    const blocks = blocksOf(site, site.homeId);
    expect([blocks[0]!.heading, blocks[0]!.subheading, blocks[1]!.heading]).toEqual(["Play together", "Game nights in Lagos.", "Our story"]);
    // One write for the page, however many steps touched it.
    expect(revisionOf(site, site.homeId)).toBe("5");
    for (const bad of [{ group_id: "not-a-uuid" }, { group_id: group.group_id, group_label: "x".repeat(121) }]) {
      expect((await edit(site, "hero", "heading", "x", bad)).error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("typing merges: the same person, section and field again within 30 seconds is one entry", async () => {
    // Times run forward from the real clock: the store stamps rows with a clock that never goes
    // back, so a fixed date in the past (as this was until 2026-11-19 10:00 UTC) merged everything.
    const start = Date.now() + 60_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    await edit(site, "faq", "heading", "B");
    vi.setSystemTime(start + 10_000);
    await edit(site, "faq", "heading", "Be");
    vi.setSystemTime(start + 35_000);
    await edit(site, "faq", "heading", "Before you come");
    expect(site.rows("draft-changes")).toHaveLength(1);
    expect(await entries(site)).toHaveLength(1);

    // More than 30 seconds after the last keystroke: a new entry.
    vi.setSystemTime(start + 70_000);
    await edit(site, "faq", "heading", "Before you arrive");
    // Another field, and another person, never merge.
    vi.setSystemTime(start + 72_000);
    await edit(site, "faq", "items.0.question", "Can I bring a friend?");
    vi.setSystemTime(start + 74_000);
    await edit(site, "faq", "items.0.question", "Can I bring two friends?", {}, TEAMMATE);
    expect(site.rows("draft-changes")).toHaveLength(4);

    // One undo takes back the whole typed run.
    vi.setSystemTime(start + 120_000);
    await call(site, "undo");
    await call(site, "undo");
    await call(site, "undo");
    expect(blocksOf(site, site.homeId)[2]!.heading).toBe("Before you come");
    await call(site, "undo");
    expect(blocksOf(site, site.homeId)[2]!.heading).toBe("Good to know");
  });

  it("the history list is newest first, at most 30, and says who: you, a teammate or Ari", async () => {
    await edit(site, "faq", "heading", "Mine");
    await edit(site, "rich_text", "heading", "Theirs", {}, TEAMMATE);
    site.rows("draft-changes").push({ ...structuredClone(site.rows("draft-changes")[0]!), id: "ari-row", group_id: "44530000-0000-4000-8000-0000000e0009", seq: 3, actor: "ari", group_label: "Tighten the top", label: "Edit Top of the page", updatedAt: "2026-11-19T12:00:00.000Z" });
    expect((await entries(site)).map((entry) => [entry.label, entry.actor])).toEqual([["Tighten the top", "ari"], ["Edit Words", "teammate"], ["Edit Questions and answers", "you"]]);
    expect((await entries(site, TEAMMATE)).map((entry) => entry.actor)).toEqual(["ari", "you", "teammate"]);
    for (let n = 0; n < 34; n += 1) {
      await call(site, "move_section", { page_id: site.homeId, expected_revision: revisionOf(site, site.homeId), section_id: sectionId(site, site.homeId, "faq"), to_index: n % 2 ? 2 : 4 });
    }
    const list = await entries(site);
    expect(list).toHaveLength(30);
    expect(list.every((entry) => entry.label === "Move Questions and answers")).toBe(true);
  });

  it("keeps the latest 200 rows per site", async () => {
    for (let n = 0; n < HISTORY_ROW_CAP + 6; n += 1) {
      const moved = await call(site, "move_section", { page_id: site.homeId, expected_revision: revisionOf(site, site.homeId), section_id: sectionId(site, site.homeId, "faq"), to_index: n % 2 ? 2 : 4 });
      expect(moved.status).toBe(200);
    }
    const rows = site.rows("draft-changes");
    expect(rows).toHaveLength(HISTORY_ROW_CAP);
    expect(Math.min(...rows.map((row) => Number(row.seq)))).toBe(7);
    expect((await call(site, "undo")).status).toBe(200);
  });
});

describe("#4453 review stamps", () => {
  it("mark_reviewed refuses when the page was saved between its read and its write (it used to overwrite that save)", async () => {
    // It read the sections, then wrote them back naming no revision; Payload filled in the CURRENT one, so a
    // teammate's save in between passed the conflict check and was overwritten with the older sections.
    const find = site.payload.find;
    let raced = false;
    site.payload.find = (async (args: Doc) => {
      const result = await find(args);
      if (args.collection === "pages" && !raced) {
        raced = true;
        const page = pageOf(site, site.homeId);
        page.blocks[1].heading = "Saved by a teammate";
        page.revision = 2;
      }
      return result;
    }) as typeof find;
    const refused = await call(site, "mark_reviewed", { page_id: site.homeId, block_ids: "all" });
    site.payload.find = find;
    expect([refused.status, refused.error.code]).toEqual([409, "REVISION_CONFLICT"]);
    expect(blocksOf(site, site.homeId)[1]!.heading).toBe("Saved by a teammate");
    expect(blocksOf(site, site.homeId)[1]!.review).toMatchObject({ state: "draft" });
  });

  it("mark_reviewed reviews one section or all of them, and is not a change to undo", async () => {
    const one = await call(site, "mark_reviewed", { page_id: site.homeId, block_ids: [sectionId(site, site.homeId, "faq")] });
    expect(one.status, JSON.stringify(one.error)).toBe(200);
    expect(one.data).toMatchObject({ page_id: site.homeId, count: 4 });
    expect(blocksOf(site, site.homeId)[2]!.review).toMatchObject({ state: "reviewed", source: "composer", by: USER });
    const all = await call(site, "mark_reviewed", { page_id: site.homeId, block_ids: "all" });
    expect(all.data).toMatchObject({ count: 0, blocks: [] });
    expect(revisionOf(site, site.homeId)).toBe("3");
    // "Looks good" is not a change to undo.
    expect(site.rows("draft-changes")).toEqual([]);
    expect(await summary(site)).toMatchObject({ can_undo: false });
  });

  it("a section the Mingla team made reads as theirs everywhere, and the owner's edit reviews it", async () => {
    const block = pageOf(site, site.homeId).blocks[1];
    block.review = { state: "draft", source: "team", at: "2026-11-19T09:00:00.000Z", by: null };
    const status = await call(site, "review_status");
    const home = (status.data.pages as Doc[]).find((page) => page.id === site.homeId)!;
    expect(home.blocks).toContainEqual({ id: block.id, type: "rich_text", source: "team" });
    const sections = (await call(site, "page_sections", { page_id: site.homeId })).data.sections as Doc[];
    expect(sections[1]!.review).toEqual({ state: "draft", source: "team" });
    // Another section's edit leaves the team's Draft stamp exactly as it was.
    await edit(site, "faq", "heading", "Before you come");
    expect(blocksOf(site, site.homeId)[1]!.review).toEqual({ state: "draft", source: "team", at: "2026-11-19T09:00:00.000Z", by: null });
    await edit(site, "rich_text", "heading", "Our story, by us");
    expect(blocksOf(site, site.homeId)[1]!.review).toMatchObject({ state: "reviewed", source: "person", by: USER });
    // Undo brings the team's Draft back, still theirs.
    await call(site, "undo");
    expect(blocksOf(site, site.homeId)[1]!.review).toEqual({ state: "draft", source: "team", at: "2026-11-19T09:00:00.000Z", by: null });
  });

  it("an edit to a section already reviewed keeps its stamp; an unstamped section stays unstamped", async () => {
    const blocks = pageOf(site, site.homeId).blocks as Doc[];
    blocks[2]!.review = { state: "reviewed", source: "ari", at: "2026-11-18T09:00:00.000Z", by: TEAMMATE };
    blocks[1]!.review = null;
    await edit(site, "faq", "heading", "Before you come");
    await edit(site, "rich_text", "heading", "Ours");
    expect(blocksOf(site, site.homeId)[2]!.review).toEqual({ state: "reviewed", source: "ari", at: "2026-11-18T09:00:00.000Z", by: TEAMMATE });
    expect(blocksOf(site, site.homeId)[1]!.review).toBeNull();
  });
});
