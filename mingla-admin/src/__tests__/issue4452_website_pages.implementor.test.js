// #4452 §7.6 (Admin Website pages, T-7.6a–e, T-7.0):
//   T-7.6a SC-158  the list is the site's manifest (no-store), grouped, with New (≤ 14 days), the dirty dot and "pop-up only"
//   T-7.6b SC-159  a marker click opens the panel for that spot; messages from another origin are ignored
//   T-7.6c SC-160  the hero editor's limits 48 / 24 / 200 / 28 with counters; Reset restores the designed words
//   T-7.6d SC-161  a stale publish: "<Name> published <path> <n> min ago."; Keep both rebases into free spots; Replace publishes over (risky path)
//   T-7.6e SC-162  History lists versions; Restore makes a new live version
//   blocks         one block per spot, Move up / down to the next free spot, the pop-up spot takes a Form only
//   T-7.0  SC-163  view-only members: every edit control disabled, with the Website editor role hint
//
// FAILS-ON-REVERT: letting Keep both put my block over theirs (dropping the
// `taken` check) fails T-7.6d; accepting messages from any origin fails T-7.6b.
//
// Run: node --test src/__tests__/issue4452_website_pages.implementor.test.js (from mingla-admin).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildHarness, readSrc, SRC } from "./support/issue4452Harness.js";

let h;
before(async () => {
  h = await buildHarness(`
import { renderToStaticMarkup as r } from "react-dom/server";
import * as M from "../../lib/sitePagesModel.js";
import { PageSidePanel } from "../../components/website/PageSidePanel.jsx";
export { M };
export const panel = (p) => r(<PageSidePanel setPanel={() => {}} onEdit={() => {}} forms={[]} tpl={null} {...p} />);
`, {
    name: "issue4452-pages",
    stubs: {
      "context/ToastContext": "export const useToast = () => ({ addToast() {} });",
      "services/formsService": "export const getForm = async () => ({});",
    },
  });
});

const NOW = Date.parse("2026-11-20T12:00:00Z");
const MANIFEST = {
  pages: [
    { key: "home", path: "/", group: "Explore", since: "2026-01-01", title: "Home" },
    { key: "creators", path: "/creators", group: "Company", since: "2026-11-16", title: "Creators", spots: [{ key: "after-hero", label: "after the hero", kind: "inline" }, { key: "after-clips", label: "after the clips", kind: "inline" }, { key: "after-steps", label: "after the steps", kind: "inline" }, { key: "before-footer", label: "before the footer", kind: "inline" }], hero: { h1: 48, em: 24, lead: 200, buttons: 2 } },
    { key: "events", path: "/host/events", group: "Host landing pages", since: "2026-10-01", title: "Events", template: "host", spots: [{ key: "after-hero", label: "after the hero", kind: "inline" }] },
  ],
};
const CREATORS = MANIFEST.pages[1];
const blk = (id, spot, type = "banner", extra = {}) => ({ id: `44520000-0000-4000-8000-${String(id).padStart(12, "0")}`, type, spot, ...extra });

describe("#4452 T-7.6a the page list", () => {
  it("comes from the site's manifest, fetched with cache: no-store", () => {
    const svc = readSrc("services/websitePagesService.js");
    assert.match(svc, /fetch\(`\$\{origin\}\/site-manifest\.json`, \{ cache: "no-store", credentials: "omit" \}\)/);
    assert.equal(h.M.MANIFEST_FAILED, "Couldn't load the page list from usemingla.com.");
  });
  it("groups in order; New within 14 days; the dirty dot; pop-up only for pages without spots", () => {
    const groups = h.M.pageList(MANIFEST, [{ page_key: "creators", draft: { changes: 2 } }], NOW);
    assert.deepEqual(groups.map((g) => g.label), ["Explore", "Company", "Host landing pages"]);
    const all = groups.flatMap((g) => g.items);
    const by = Object.fromEntries(all.map((p) => [p.key, p]));
    assert.deepEqual([by.home.isNew, by.creators.isNew, by.events.isNew], [false, true, false]);
    assert.equal(by.creators.changes, 2);
    assert.equal(by.home.popupOnly, true);
    assert.equal(by.creators.popupOnly, false);
  });
  it("a page added to the registry appears (with New) without any Admin change", () => {
    const more = { pages: [...MANIFEST.pages, { key: "new-page", path: "/new", group: "Explore", since: "2026-11-19" }] };
    const item = h.M.pageList(more, [], NOW).flatMap((g) => g.items).find((p) => p.key === "new-page");
    assert.ok(item && item.isNew);
  });
});

describe("#4452 T-7.6b the iframe channel", () => {
  const ev = (origin, data) => ({ origin, data });
  it("a marker click from the site opens that spot; another origin is ignored", () => {
    const site = "https://usemingla.com";
    assert.deepEqual(h.M.editorMessage(ev(site, { type: "spot-click", page: "creators", spot: "after-steps" }), site), { type: "spot-click", page: "creators", spot: "after-steps" });
    assert.equal(h.M.editorMessage(ev("https://evil.com", { type: "spot-click", page: "creators", spot: "after-steps" }), site), null);
    assert.equal(h.M.editorMessage(ev(site, { type: "spot-click", page: "creators" }), site), null, "malformed");
    assert.equal(h.M.editorMessage(ev(site, { type: "eval", page: "creators" }), site), null);
    const src = readSrc("pages/WebsitePagesPage.jsx");
    assert.match(src, /const msg = editorMessage\(e, new URL\(SITE_ORIGIN\)\.origin\);/);
    assert.match(src, /if \(msg\.type === "spot-click"\) setPanel\(\{ kind: "spot", spot: msg\.spot \}\);/);
  });
  it("the frame is the real page, with this Admin origin for the site to answer", () => {
    assert.equal(h.M.editorFrameUrl("https://usemingla.com", "tok_en", "https://admin.usemingla.com", 420), "https://usemingla.com/site-preview/tok_en?editor=1&ao=https%3A%2F%2Fadmin.usemingla.com&y=420");
    assert.equal(h.M.TOKEN_REMINT_MS, 50 * 60 * 1000);
  });
});

describe("#4452 T-7.6c the hero editor", () => {
  it("enforces 48 / 24 / 200 / 28 with n/limit counters; Reset restores the designed words", () => {
    const html = h.panel({ page: CREATORS, panel: { kind: "hero" }, canEdit: true, doc: { content: { blocks: [] } } });
    for (const [label, max] of [["Headline", 48], ["Italic ending", 24], ["Lead", 200], ["Button 1", 28], ["Button 2", 28]]) {
      assert.ok(new RegExp(`<span>${label}</span><span data-counter=""[^>]*>\\d+/${max}</span>`).test(html), `${label} ${max}`);
      assert.ok(html.includes(`maxLength="${max}"`) || html.includes(`maxlength="${max}"`), `${label} maxLength`);
    }
    assert.match(html, /Reset to the designed words/);
    assert.match(html, /Limits keep the headline on its designed lines at every screen size/);
    assert.deepEqual(h.M.heroOf({ blocks: [] }, "creators").h1, "Get hired to show people what a city");
    const edited = { blocks: [blk(1, "after-hero")], hero: { h1: "x", em: "", lead: "", buttons: [] } };
    assert.deepEqual(h.M.resetHero(edited), { blocks: [blk(1, "after-hero")] });
    assert.deepEqual(h.M.heroProblems({ h1: "x".repeat(49), em: "y".repeat(25), lead: "", buttons: [{ text: "z".repeat(29) }] }), ["Headline: 1 to 48 characters.", "Italic ending: 24 characters at most.", "Button 1: 1 to 28 characters."]);
  });
  it("the designed words match the site's coded hero", () => {
    const creators = fs.readFileSync(path.join(SRC, "..", "..", "mingla-marketing", "app", "creators", "page.tsx"), "utf8");
    const locals = fs.readFileSync(path.join(SRC, "..", "..", "mingla-marketing", "app", "locals", "page.tsx"), "utf8");
    for (const [src, key] of [[creators, "creators"], [locals, "locals"]]) {
      const c = h.M.CODED_HEROES[key];
      for (const t of [c.h1, c.em, c.lead, c.buttons[0].text, c.buttons[1].text]) assert.ok(src.includes(`'${t}'`), `${key}: ${t}`);
    }
  });
});

describe("#4452 T-7.6d conflicts (risky path)", () => {
  it('says "<Name> published <path> <n> min ago."', () => {
    const c = h.M.conflictLine(JSON.stringify({ code: "page_conflict", live_version: 7, published_by: "Ray", published_at: "2026-11-20T11:55:00Z" }), "/creators", NOW);
    assert.deepEqual(c, { line: "Ray published /creators 5 min ago.", liveVersion: 7 });
  });
  it("Keep both: mine go into free spots; a spot they filled keeps theirs and mine is listed, not published", () => {
    const base = { blocks: [blk(1, "after-hero")] };
    const mine = { blocks: [blk(1, "after-hero"), blk(2, "after-steps"), blk(3, "before-footer")] };
    const theirs = { blocks: [blk(1, "after-hero"), blk(9, "before-footer")] };
    const { content, bumped } = h.M.rebaseKeepBoth(mine, theirs, base);
    assert.deepEqual(content.blocks.map((b) => [b.spot, b.id.slice(-1)]).sort(), [["after-hero", "1"], ["after-steps", "2"], ["before-footer", "9"]]);
    assert.deepEqual(bumped.map((b) => [b.spot, b.block.id.slice(-1)]), [["before-footer", "3"]]);
  });
  it("Keep both keeps a block I removed removed, and my hero edit wins only if I changed it", () => {
    const base = { blocks: [blk(1, "after-hero")], hero: { h1: "A" } };
    const mine = { blocks: [], hero: { h1: "A" } };
    const theirs = { blocks: [blk(1, "after-hero"), blk(5, "after-clips")], hero: { h1: "Theirs" } };
    const out = h.M.rebaseKeepBoth(mine, theirs, base).content;
    assert.deepEqual(out.blocks.map((b) => b.spot), ["after-clips"]);
    assert.deepEqual(out.hero, { h1: "Theirs" });
    const out2 = h.M.rebaseKeepBoth({ ...mine, hero: { h1: "Mine" } }, theirs, base).content;
    assert.deepEqual(out2.hero, { h1: "Mine" });
  });
  it("Replace publishes over theirs with their live version; theirs stays in History", () => {
    const src = readSrc("pages/WebsitePagesPage.jsx");
    assert.match(src, /onClick=\{\(\) => publish\(\{ replaceOver: conflict\.liveVersion \}\)\}/);
    assert.match(src, /await publishPage\(selKey, replaceOver \?\? doc\.liveVersion\)/);
    assert.match(src, /if \(e\.code === "PT409" && \/page_conflict\/\.test\(e\.message \|\| ""\)\)/);
    assert.match(src, /Keep both puts your blocks in spots that are still free\. Replace publishes your draft over theirs; their version stays in History\./);
  });
  it("the change list names each change", () => {
    const lines = h.M.contentChanges({ blocks: [blk(1, "after-hero"), blk(2, "after-steps")] }, { blocks: [{ ...blk(1, "after-hero"), text: "new" }, blk(3, "before-footer", "form")], hero: { h1: "x" } });
    assert.deepEqual(lines, ["Changed the banner at after-hero", "Added form at before-footer", "Removed the banner at after-steps", "Changed the hero words"]);
  });
});

describe("#4452 T-7.6e history and restore; publish refreshes", () => {
  it("Restore makes a new live version through admin_site_page_restore; Publish then refreshes the site", () => {
    const src = readSrc("pages/WebsitePagesPage.jsx");
    assert.match(src, /await restorePage\(selKey, v, doc\.liveVersion\);/);
    assert.match(src, /Published\. \$\{page\.path\} refreshes in under a minute\./);
    assert.match(src, /Saved\. The page did not refresh; Retry/);
    const svc = readSrc("services/websitePagesService.js");
    assert.match(svc, /rpc\("admin_site_page_restore", \{ p_page_key: pageKey, p_version: version, p_expected_live_version: expectedLive \}\)/);
    assert.match(svc, /supabase\.functions\.invoke\("admin-blog", \{ body: \{ action: "revalidate_page" \} \}\)/);
  });
});

describe("#4452 blocks: spots, moves and the pop-up spot", () => {
  it("one block per spot", () => {
    const c = h.M.putBlock({ blocks: [] }, blk(1, "after-hero"));
    assert.throws(() => h.M.putBlock(c, blk(2, "after-hero")), /That spot already has a block/);
  });
  it("Move up / down goes to the next FREE spot, or says there is none", () => {
    const spots = CREATORS.spots;
    let c = { blocks: [blk(1, "after-hero"), blk(2, "after-clips")] };
    const down = h.M.moveBlock(c, blk(1, "x").id, 1, spots);
    assert.equal(down.content.blocks.find((b) => b.id === blk(1, "x").id).spot, "after-steps", "skips the taken after-clips");
    c = { blocks: [blk(1, "after-hero")] };
    assert.deepEqual(h.M.moveBlock(c, blk(1, "x").id, -1, spots), { error: "No free spot that way." });
  });
  it("the pop-up spot adds a Form only, with the default settings", () => {
    const b = h.M.newBlock("buttons", "popup", { formId: "f" });
    assert.deepEqual([b.type, b.spot, b.form_id, b.popup], ["popup", "popup", "f", { trigger: "scroll_half", freq: "weekly", devices: "all", style: "centre" }]);
    const html = h.panel({ page: CREATORS, panel: { kind: "spot", spot: "popup" }, canEdit: true, doc: { content: { blocks: [] } } });
    assert.match(html, />Form</);
    assert.doesNotMatch(html, /Button row|Banner/);
  });
  it("an inline spot offers Form, Button row and Banner, in the brand style", () => {
    const html = h.panel({ page: CREATORS, panel: { kind: "spot", spot: "after-steps" }, canEdit: true, doc: { content: { blocks: [] } } });
    for (const t of [">Form<", ">Button row<", ">Banner<", "Blocks come in the Mingla brand style. You choose the words and where buttons go; the look is fixed."]) assert.ok(html.includes(t), t);
  });
  it("a template page offers Use on all host pages", () => {
    const html = h.panel({ page: MANIFEST.pages[2], panel: { kind: "spot", spot: "after-hero" }, canEdit: true, doc: { content: { blocks: [] } } });
    assert.match(html, /Use on all host pages/);
  });
});

describe("#4452 T-7.0 view-only on Website pages", () => {
  it("every edit control is disabled", () => {
    const html = h.panel({ page: CREATORS, panel: { kind: "spot", spot: "after-steps" }, canEdit: false, doc: { content: { blocks: [] } } });
    const buttons = (html.match(/<button[^>]*>[^<]*(Form|Button row|Banner)<\/button>/g) || []);
    assert.equal(buttons.length, 3);
    assert.ok(buttons.every((b) => /disabled=""/.test(b)));
    assert.match(readSrc("pages/WebsitePagesPage.jsx"), /\{doc && !canEdit && <ReadOnlyHint \/>\}/);
  });
});
