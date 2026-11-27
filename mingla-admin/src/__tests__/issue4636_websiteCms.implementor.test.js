// MINGLA-INVARIANT: I-4636-NO-IMAGE-TRANSFORM | issue #4636 | site media code never builds a Supabase /render/image URL (spend-cap hold #1643); pictures are resized in the browser.
// #4636 build 3 — the Admin Website pages CMS editor.
// Happy path: the click → select → edit → check → save shape → publish summary loop on a real
// converted page (its page-defaults.json sections), every one of the 41 registry blocks can be
// added with valid starting content, the side panel draws a block's fields from the registry,
// the picker offers every block, and the page wires the editor protocol, autosave, conflicts,
// publish + refresh, history, media and the view-only state.
// Adversarial: messages from another origin or malformed are ignored; <script>, unknown fields,
// a colour the section has no style for, over-long words and bad links are caught on the right
// field; server 22023 detail lands on the right section and field; reserved, taken, uppercase and
// 3-part addresses are refused; the storage meter warns at 70 % and refuses at 90 %.
// FAILS-ON-REVERT: deleting the editor-draft post in WebsitePagesPage.jsx fails "the page wires";
// deleting the maxPerPage check in canAdd fails "every registry block"; reverting the build
// (the editor files) fails every test here.
// Run: node --test src/__tests__/issue4636_websiteCms.implementor.test.js (from mingla-admin, after npm ci).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildHarness, readSrc, SRC } from "./support/issue4452Harness.js";
import * as M from "../lib/siteEditorModel.js";
import { fitWithin, kindOf } from "../lib/siteMediaFiles.js";
import { siteCms } from "../services/siteCmsService.js";

const MARKETING = path.resolve(SRC, "..", "..", "mingla-marketing");
const REGISTRY = JSON.parse(fs.readFileSync(path.join(MARKETING, "lib/site-blocks/registry.json"), "utf8"));
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(MARKETING, "lib/site-blocks/page-defaults.json"), "utf8"));
const RESERVED = JSON.parse(fs.readFileSync(path.join(MARKETING, "lib/site-pages/reserved-paths.json"), "utf8")).segments;
const SITE = "https://usemingla.com";
const ev = (origin, data) => ({ origin, data });
let seed = 0;
const rand = () => `00000000-0000-4000-8000-${String(++seed).padStart(12, "0")}`;

let h;
before(async () => {
  h = await buildHarness(`
import { renderToStaticMarkup as r } from "react-dom/server";
import { BlockPanel } from "../../components/website/BlockPanel.jsx";
import { SectionList } from "../../components/website/SectionList.jsx";
import { BlockPicker } from "../../components/website/PageModals.jsx";
import { SiteSettingsPanel } from "../../components/website/SettingsPanels.jsx";
import { StorageMeter } from "../../components/website/MediaLibrary.jsx";
export const panel = (p) => r(<BlockPanel onChange={() => {}} onAction={() => {}} onAddBelow={() => {}} openMedia={() => {}} media={{}} forms={[]} supabaseUrl="http://stub.local" {...p} />);
export const list = (p) => r(<SectionList onSelect={() => {}} onMove={() => {}} onAdd={() => {}} invalid={new Set()} {...p} />);
export const picker = (p) => r(<BlockPicker open onClose={() => {}} onPick={() => {}} {...p} />);
export const settings = (p) => r(<SiteSettingsPanel onChange={() => {}} errors={{}} {...p} />);
export const storage = (p) => r(<StorageMeter {...p} />);
`, { name: "issue4636-cms", stubs: { "context/ToastContext": "export const useToast = () => ({ addToast() {} });" } });
});

describe("#4636 happy path: click, edit, save, publish on /host", () => {
  it("a click on words in the preview selects that section and field; the edit saves as a valid block list and is listed for publish", () => {
    const live = M.stableIds(M.defaultSections(DEFAULTS, "host"));
    assert.ok(live.length >= 5, "the converted page starts from its coded sections");
    assert.ok(M.checkSections(REGISTRY, live).ok, "the coded sections pass the editor's checks");
    // The page reports a click on the tiles heading (editor-click from the framed site).
    const i = live.findIndex((s) => s.type === "tiles");
    const click = M.acceptPageMessage(ev(SITE, { type: "editor-click", page: "host", index: i, blockType: "tiles", field: "heading", text: "Built for every kind of host." }), SITE);
    assert.equal(click.index, i);
    assert.equal(M.topField(click.field), "heading");
    // Edit those words, then a list item's line, the way the side panel does.
    let block = { ...live[i], content: M.setAt(live[i].content, click.field, "Built for *every* host.") };
    block = { ...block, content: M.setAt(block.content, "items[1].line", "Plan it,") };
    const draft = live.map((s, j) => (j === i ? block : s));
    assert.equal(M.getAt(draft[i].content, "items[1].line"), "Plan it,");
    assert.equal(M.getAt(live[i].content, "items[1].line"), "Plan the trip,", "edits never mutate the published list");
    assert.ok(M.checkSections(REGISTRY, draft).ok);
    // Reorder and hide, then the publish summary names each change.
    const moved = M.toggleHidden(M.moveSection(draft, i, i + 1), 0);
    const name = (t) => REGISTRY.blocks.find((b) => b.key === t).name;
    assert.deepEqual(M.sectionChanges(REGISTRY, live, moved), [`Hid "${name(live[0].type)}"`, `Edited "${name("tiles")}"`, "Reordered sections"]);
  });

  it("every registry block can be added with valid starting content, and the picker offers all of them", () => {
    assert.equal(REGISTRY.blocks.length, 41);
    for (const b of REGISTRY.blocks) {
      const s = M.starterBlock(REGISTRY, DEFAULTS, b.key, { formId: "46360000-0000-4000-8000-00000000f001", rand });
      const c = M.checkBlock(REGISTRY, s);
      assert.ok(c.ok, `${b.key}: ${JSON.stringify(c.fields)}`);
      assert.match(s.id, /^[A-Za-z0-9_-]{1,64}$/);
    }
    const groups = M.pickerGroups(REGISTRY);
    assert.deepEqual(groups.map((g) => g.label), ["Heroes", "Story", "Media", "Actions", "Live from Mingla (fills itself)"]);
    assert.equal(groups.flatMap((g) => g.blocks).length, 41);
    const html = h.picker({ registry: REGISTRY, sections: [] });
    assert.equal((html.match(/data-pick-block="/g) || []).length, 41);
    // maxPerPage: a second Reel hero is not offered.
    const withHero = [M.starterBlock(REGISTRY, DEFAULTS, "reelHero", { rand })];
    assert.equal(M.canAdd(REGISTRY, withHero, "reelHero"), false);
    assert.match(h.picker({ registry: REGISTRY, sections: withHero }), /data-pick-block="reelHero" disabled=""/);
  });

  it("the side panel draws the block's fields from the registry, its colours, and the section actions", () => {
    const s = M.defaultSections(DEFAULTS, "host").find((x) => x.type === "tiles");
    const html = h.panel({ def: REGISTRY.blocks.find((b) => b.key === "tiles"), block: { ...s, id: "t1" }, index: 2, count: 6, canEdit: true });
    for (const t of [REGISTRY.blocks.find((b) => b.key === "tiles").name, ">Heading<", "Tiles", 'data-colour="paper"', 'data-colour="night"', "Duplicate", "Add below", "Layout is locked."]) assert.ok(html.includes(t), t);
    assert.ok(html.includes('id="sf-2-heading"'), "a click on the heading focuses this field");
    const ro = h.panel({ def: REGISTRY.blocks.find((b) => b.key === "tiles"), block: { ...s, id: "t1" }, index: 2, count: 6, canEdit: false });
    assert.ok(!ro.includes("Add below"), "view-only: no section actions");
    assert.match(ro, /<input id="sf-2-heading"[^>]*disabled=""/);
    const outline = h.list({ sections: M.stableIds(M.defaultSections(DEFAULTS, "host")), nameOf: (x) => x.type, selected: 0, canEdit: true, pageName: "For hosts" });
    assert.match(outline, /Drag reelHero to reorder/);
    assert.match(outline, /aria-label="Move reelHero down"/);
  });

  it("the menu and footer start from the coded ones and pass the site's rules", () => {
    assert.deepEqual(M.settingsProblems(M.CODED_SETTINGS), {});
    const nav = fs.readFileSync(path.join(MARKETING, "components/site/site-nav.tsx"), "utf8");
    const foot = fs.readFileSync(path.join(MARKETING, "components/marketing/footer.tsx"), "utf8");
    for (const l of M.CODED_SETTINGS.nav.top) assert.ok(nav.includes(`label: '${l.label}'`), l.label);
    for (const c of M.CODED_SETTINGS.footer.columns) for (const l of c.links) assert.ok(foot.includes(`label: '${l.label}'`), l.label);
    assert.match(h.settings({ content: {}, canEdit: true }), /data-edit-nav=""/);
    assert.match(h.settings({ content: M.CODED_SETTINGS, canEdit: true }), /Top links \(1–6\)/);
  });

  it("the page wires the protocol, autosave, conflicts, publish + refresh, history, media and view-only", () => {
    const src = readSrc("pages/WebsitePagesPage.jsx");
    for (const re of [
      /post\(\{ type: "editor-draft", page: doc\.key, seq: \+\+seq\.current, content: contentRef\.current \}\)/,
      /post\(\{ type: "editor-select", page: doc\.key, index: sel \}\)/,
      /const msg = acceptPageMessage\(e, siteOrigin\);/,
      /await cms\.saveDraft\(doc\.key, doc\.rev, content\)/,
      /e\.code === "page_draft_conflict"[^\n]*setSave\(\{ state: "conflict", message: COPY\.conflict \}\)/,
      /e\.code === "invalid_content"\) \{ setSrvErrs\(serverErrors\(e\.detail\)\)/,
      /await cms\.publish\(doc\.key, doc\.liveVersion, note\);/,
      /await cms\.revalidate\(key\)/,
      /await cms\.restore\(doc\.key, v, doc\.liveVersion\);/,
      /window\.addEventListener\("beforeunload", onUnload\)/,
      /COPY\.noAccess/,
      /data-view-only=""/,
    ]) assert.match(src, re);
    assert.match(readSrc("components/website/SectionList.jsx"), /DndContext sensors=\{sensors\}/);
  });

  it("the service calls name their RPCs with the migration's argument names", async () => {
    const calls = [];
    const cms = siteCms({ rpc: async (n, a) => { calls.push([n, a]); return { data: {}, error: null }; } });
    await cms.getPage("host"); await cms.saveDraft("host", 3, { sections: [] }); await cms.publish("host", 2, "note");
    await cms.history("host"); await cms.restore("host", 1, 2); await cms.previewToken("host", { sections: [] }); await cms.pagesState(); await cms.discardDraft("host");
    const sql = fs.readFileSync(path.resolve(SRC, "..", "..", "supabase/migrations/20281208004636_issue_4636_site_cms.sql"), "utf8")
      + fs.readdirSync(path.resolve(SRC, "..", "..", "supabase/migrations")).filter((f) => /issue_4452_site_pages|4452.*site/.test(f)).map((f) => fs.readFileSync(path.resolve(SRC, "..", "..", "supabase/migrations", f), "utf8")).join("\n");
    for (const [name, args] of calls) {
      const sig = sql.match(new RegExp(`FUNCTION public\\.${name}\\(([^)]*)\\)`));
      assert.ok(sig, `${name} exists`);
      for (const a of Object.keys(args ?? {})) assert.match(sig[1], new RegExp(`\\b${a}\\b`), `${name}(${a})`);
    }
  });
});

describe("#4636 adversarial", () => {
  it("only the framed site's well-formed messages are acted on", () => {
    const ok = { type: "editor-click", page: "host", index: 1, blockType: "tiles", field: null, text: "x" };
    assert.ok(M.acceptPageMessage(ev(SITE, ok), SITE));
    assert.equal(M.acceptPageMessage(ev("https://evil.example", ok), SITE), null);
    assert.equal(M.acceptPageMessage(ev("https://usemingla.com.evil.example", ok), SITE), null);
    assert.equal(M.acceptPageMessage(ev(SITE, { ...ok, index: -1 }), SITE), null);
    assert.equal(M.acceptPageMessage(ev(SITE, { ...ok, page: "../x" }), SITE), null);
    assert.equal(M.acceptPageMessage(ev(SITE, { ...ok, text: "x".repeat(201) }), SITE), null);
    assert.equal(M.acceptPageMessage(ev(SITE, { type: "editor-ready", v: 3, page: "host", mode: "blocks", blocks: [], height: 1 }), SITE), null);
    assert.equal(M.acceptPageMessage(ev(SITE, { type: "editor-blocks", page: "host", blocks: [{ index: 0, type: "x", id: null, top: -5, height: 1 }], height: 1 }), SITE), null);
    assert.equal(M.acceptPageMessage(ev(SITE, { type: "eval", page: "host" }), SITE), null);
    assert.equal(M.acceptPageMessage(ev(SITE, "editor-click"), SITE), null);
  });

  it("bad content is caught on the right field before any save", () => {
    const tiles = { ...M.defaultSections(DEFAULTS, "host").find((x) => x.type === "tiles"), id: "t" };
    const bad = (patch) => M.checkBlock(REGISTRY, { ...tiles, content: M.setAt(tiles.content, ...patch) }).fields;
    assert.match(bad(["heading", "<script>alert(1)</script>"]).heading, /Remove < and >/);
    assert.match(bad(["heading", "x".repeat(91)]).heading, /At most 90/);
    assert.match(bad(["heading", "one *two"]).heading, /Close the \*italic\*/);
    assert.match(bad(["items[0].action.to", "javascript:alert(1)"])["items[0].action.to"], /Use a page on the site/);
    assert.match(bad(["items[0].action.to", "//evil.example"])["items[0].action.to"], /Use a page on the site/);
    assert.match(bad(["items[0].media", "https://evil.example/x.jpg"])["items[0].media"], /Pick a picture or video/);
    assert.match(bad(["surprise", "x"]).surprise, /Not a field/);
    assert.match(M.checkBlock(REGISTRY, { ...tiles, colour: "clay" }).fields.colour, /isn't available/);
    assert.match(M.checkBlock(REGISTRY, { ...tiles, type: "nope" }).fields[""], /isn't known/);
    assert.match(M.checkBlock(REGISTRY, { ...tiles, version: 99 }).fields[""], /newer/);
    const forty = Array.from({ length: 41 }, (_, k) => ({ ...M.starterBlock(REGISTRY, DEFAULTS, "answer", { rand }), id: `a${k}` }));
    assert.match(M.checkSections(REGISTRY, forty).page.join(" "), /at most 40/);
    assert.equal(M.canAdd(REGISTRY, forty.slice(0, 40), "answer"), false);
    assert.match(M.checkBlock(REGISTRY, M.starterBlock(REGISTRY, DEFAULTS, "form", { rand })).fields.formId, /Pick a form/);
  });

  it("the server's invalid_content detail lands on the right section and field", () => {
    const out = M.serverErrors(JSON.stringify([
      { path: "sections[2]", code: "invalid_block", message: "tiles.items[1].title: longer than 40 characters" },
      { path: "sections[4].content.formId", code: "bad_form" },
      { path: "sections", code: "too_many_blocks" },
    ]));
    assert.deepEqual(out.byIndex[2], { "items[1].title": "Longer than 40 characters" });
    assert.deepEqual(out.byIndex[4], { formId: "Pick a live form." });
    assert.deepEqual(out.page, ["A page has at most 40 sections."]);
    assert.deepEqual(M.serverErrors("not json"), { byIndex: {}, page: [] });
  });

  it("new addresses: reserved, taken, malformed and three-part ones are refused", () => {
    const opts = { reserved: RESERVED, taken: ["/summer-socials"] };
    for (const p of ["/host", "/blog", "/api", "/host/new-thing", "/summer-socials"]) assert.equal(M.pathProblem(p, opts), "That address is already used.", p);
    for (const p of ["/Summer", "/a/b/c", "/a..b", "/-x", "/x_y", "/"]) assert.ok(M.pathProblem(p, opts), p);
    assert.equal(M.pathProblem("/winter-socials", opts), null);
    assert.equal(M.slugify("Summer Socials 2027!"), "/summer-socials-2027");
    assert.equal(M.redirectProblem("//evil.example", "/x"), "Send visitors to a page on usemingla.com (starting with /).");
    assert.equal(M.redirectProblem("/x", "/x"), "A page can't send visitors to itself.");
    assert.equal(M.redirectProblem("/", "/x"), null);
  });

  it("the storage meter warns at 70 % and refuses at 90 %; uploads are prepared without image transformations", () => {
    const GB = 1073741824;
    assert.equal(M.meter({ bytes: 1 * GB, limit_bytes: 5 * GB }).state, "ok");
    assert.equal(M.meter({ bytes: 3.6 * GB, limit_bytes: 5 * GB }).state, "warn");
    assert.equal(M.meter({ bytes: 4.6 * GB, limit_bytes: 5 * GB }).state, "blocked");
    assert.equal(M.meter({ bytes: 4.4 * GB, limit_bytes: 5 * GB }, 0.2 * GB).refuse, true, "an upload that would cross 90 % is refused");
    assert.match(h.storage({ usage: { bytes: 3.6 * GB, limit_bytes: 5 * GB } }), /data-storage-meter="warn"/);
    assert.match(h.storage({ usage: { bytes: 4.6 * GB, limit_bytes: 5 * GB } }), /uploads are paused/);
    assert.deepEqual(fitWithin(6000, 4000, 2400), { width: 2400, height: 1600 });
    assert.deepEqual(fitWithin(800, 600, 2400), { width: 800, height: 600 }, "never upscaled");
    assert.equal(kindOf({ type: "image/heic" }), null);
    assert.equal(kindOf({ type: "video/quicktime" }), null);
    for (const f of ["lib/siteMediaFiles.js", "components/website/MediaLibrary.jsx", "services/siteCmsService.js", "lib/siteEditorModel.js"]) {
      assert.ok(!readSrc(f).replace(/^\s*\/\/.*$/gm, "").includes("/render/image"), `${f} builds no /render/image URL`);
    }
    assert.equal(M.publicUrl("https://x.supabase.co/", "site-media", "library/a_thumb.jpg"), "https://x.supabase.co/storage/v1/object/public/site-media/library/a_thumb.jpg");
  });
});
