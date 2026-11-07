// Issue #4270 (Wave 7) — tester adversarial suite for the Brand group's
// stay-on-page rule, its access gates and its live layer. A different angle
// from the implementor's happy path:
//
//   S  links: a brand link inside any panel page opens beside (and stays a
//      plain link elsewhere); no Brand group file writes the address, pushes
//      history or opens a window; the only plain links are the two "full page"
//      ones
//   A  access: which side kinds a teammate may open; a tampered rail tab for
//      Support without Hosts access; the header without Hosts access
//   L  live layer: typing payloads that are spoofed, oversized or malformed
//
// I-4270-W7-BRAND-GROUP-STAYS-ON-PAGE: nothing in a Brand group navigates away
// (Seth, 2026-11-07 design rule). Known defects are pinned as `todo` tests
// (they run and report but do not fail the suite) until the fix lands; S-D1
// became a plain test in W7 rework 1.
//
// Run: node --no-experimental-websocket --test src/__tests__/issue4270_w7_stay_on_page.tester.adversarial.test.js
// (from mingla-admin, after `npm ci`; without esbuild the test FAILS, never skips).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(fs.readFileSync(path.join(SRC, rel), "utf8"));

const U1 = "11111111-2222-4333-8444-555555555555";
const U2 = "21111111-2222-4333-8444-555555555555";
const ME = "31111111-2222-4333-8444-555555555555";

let h;
before(async () => {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test");
  }
  const out = await esbuild.build({
    stdin: {
      contents: `import { renderToStaticMarkup } from "react-dom/server";
import { PanelLinksContext } from "../components/ui/PanelStack.jsx";
import { HostTeamSection } from "../components/crm/HostTeamSection.jsx";
import { BrandGroupRail } from "../components/community/BrandGroupRail.jsx";
import { BrandGroupHeader } from "../components/community/BrandGroupHeader.jsx";
import { BrandGroupStrip } from "../components/community/BrandGroupStrip.jsx";
import { PlanActivityCard } from "../components/community/PlanActivityCard.jsx";
export { sideAllowed } from "../components/community/BrandGroupsPanel.jsx";
export { typingEntry, TYPING_TTL_MS } from "../hooks/useBrandGroupLive.js";
const html = (el) => renderToStaticMarkup(el);
const inPanel = (el) => <PanelLinksContext.Provider value={{ openSide: () => {} }}>{el}</PanelLinksContext.Provider>;
export const team = (p, panel) => html(panel ? inPanel(<HostTeamSection {...p} />) : <HostTeamSection {...p} />);
export const teamWith = (p) => html(<HostTeamSection {...p} />);
export const rail = (p) => html(<BrandGroupRail onTab={() => {}} openFresh={() => {}} onPreview={() => {}} people={[]} staff={[]} {...p} />);
export const header = (p) => html(<BrandGroupHeader onToggleMute={() => {}} {...p} />);
export const strip = (p) => html(<BrandGroupStrip onShowList={() => {}} onOpen={() => {}} {...p} />);
export const planCard = (p) => html(<PlanActivityCard {...p} />);`,
      resolveDir: HERE, sourcefile: "issue4270.w7.tester.harness.jsx", loader: "jsx",
    },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    loader: { ".js": "jsx" },
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url); if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = class { constructor() { throw new Error("issue4270 W7 tester render test: no network"); } };' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"VITE_SUPABASE_URL":"https://x.supabase.test","VITE_SUPABASE_ANON_KEY":"test"}' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4270-w7-tester-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  h = await import(pathToFileURL(file).href);
});

const group = { conversation_id: "c1", brand_id: U1, brand_name: "Harmattan Club", member_count: 2, unread_count: 0, muted: false };

// The Brand group's own files: the page, its columns, its panel and its live hooks.
const BRAND_GROUP_FILES = [
  "components/community/BrandGroupsPanel.jsx",
  "components/community/BrandGroupList.jsx",
  "components/community/BrandGroupStrip.jsx",
  "components/community/BrandGroupHeader.jsx",
  "components/community/BrandGroupThread.jsx",
  "components/community/PlanActivityCard.jsx",
  "components/community/BrandGroupComposer.jsx",
  "components/community/BrandGroupRail.jsx",
  "components/community/HostCardEmptyState.jsx",
  "components/community/BrandCalendarSide.jsx",
  "components/community/BrandGroupSidePanel.jsx",
  "hooks/useBrandGroupLive.js",
  "hooks/useBrandGroupPlanItems.js",
  "lib/brandGroupInbox.js",
];

describe("S stay on page", () => {
  it("S-1 a host card's brand opens beside on any panel page and stays a plain link elsewhere", () => {
    const read = { data: { brand: { id: U1, name: "Harmattan Club", slug: "harmattan" }, team: { owners: [], brand_members: [] } } };
    const panel = h.team({ record: { id: U2 }, read }, true);
    assert.match(panel, new RegExp(`<button type="button" data-side-link="brand:${U1}"[^>]*>Harmattan Club</button>`), "inside a panel page the brand is a side link button");
    assert.doesNotMatch(panel, /href="#\/brands\?brandId=/, "inside a panel page no link to the Brands page");
    const plain = h.team({ record: { id: U2 }, read }, false);
    assert.match(plain, new RegExp(`<a href="#/brands\\?brandId=${U1}"[^>]*>Harmattan Club</a>`), "outside a panel page it is the plain link it always was");
  });

  it("S-2 no Brand group file writes the address, walks history forward, opens a window or routes", () => {
    for (const rel of BRAND_GROUP_FILES) {
      const src = code(rel);
      assert.doesNotMatch(src, /window\.location(\.hash|\.href)?\s*=(?!=)/, `${rel} assigns window.location`);
      assert.doesNotMatch(src, /location\.(assign|replace)\s*\(/, `${rel} calls location.assign/replace`);
      assert.doesNotMatch(src, /history\.(pushState|replaceState)\s*\(/, `${rel} writes history directly (the panel goes through useHashQuery)`);
      assert.doesNotMatch(src, /window\.open\s*\(/, `${rel} opens a window`);
      assert.doesNotMatch(src, /\bnavigate\s*\(/, `${rel} routes away`);
      assert.doesNotMatch(src, /history\.(forward|go\(\s*[1-9])/, `${rel} walks history forward`);
    }
  });

  it("S-3 the only plain links in a Brand group are the explicit full-page ones", () => {
    let fullPage = 0;
    for (const rel of BRAND_GROUP_FILES) {
      const src = code(rel);
      for (const m of src.matchAll(/<a\b[^>]*>/g)) {
        assert.match(m[0], /data-full-page=""/, `${rel}: a plain link that is not "full page": ${m[0].slice(0, 120)}`);
        fullPage += 1;
      }
    }
    assert.equal(fullPage, 1, "one explicit link in the Brand group's own files (Open the Calendar); the panel's Open full page comes from SidePanel");
  });

  it("S-4 a plan activity card without Hosts access is plain text even when every line matches", () => {
    const lines = [
      { id: "p1", sender_id: null, message_type: "system", content: "Seth added “Menu drop” to the plan.", created_at: new Date().toISOString() },
      { id: "p2", sender_id: null, message_type: "system", content: "Seth added “Call the DJ” to the plan.", created_at: new Date().toISOString() },
    ];
    const items = [{ kind: "post", id: U1, title: "Menu drop", on: "2026-11-08" }, { kind: "task", id: U2, title: "Call the DJ", on: "2026-11-09" }];
    const withAccess = h.planCard({ lines, items, brandName: "Harmattan Club", onOpen: () => {} });
    assert.match(withAccess, new RegExp(`data-plan-line="post:${U1}"`));
    assert.match(withAccess, new RegExp(`data-plan-line="task:${U2}"`));
    const without = h.planCard({ lines, items, brandName: "Harmattan Club", onOpen: null });
    assert.doesNotMatch(without, /<button/, "no button, so no dead tap, without Hosts access");
    assert.equal((without.match(/data-system-line=""/g) || []).length, 2);
    assert.match(without, /2 plan updates|Seth added 2 items to the plan/);
  });

  // ── Defect found by the test pass, fixed in W7 rework 1 (was todo) ───────
  it("S-D1 drawers that open inside the Brand group panel carry no plain link that leaves Community", () => {
    const reachable = [
      "components/brands/BrandDrawer.jsx",
      "components/crm/HostTeamSection.jsx",
      "pages/DraftsPage.jsx",
      "components/ops/WordingQueue.jsx",
    ];
    const offenders = [];
    for (const rel of reachable) {
      const src = code(rel);
      for (const m of src.matchAll(/<a\b[^>]*href=\{?[`"]#\/[^>]*>/g)) {
        if (!/data-full-page/.test(m[0])) offenders.push(`${rel}: ${m[0].slice(0, 90)}`);
      }
      // Each link to another page goes through PageLink with the panel's opener.
      for (const m of src.matchAll(/<PageLink\b[^>]*>/g)) {
        if (!/onOpenSide=\{onOpenSide\}/.test(m[0])) offenders.push(`${rel}: PageLink without the opener: ${m[0].slice(0, 90)}`);
      }
    }
    assert.deepEqual(offenders, []);
    // The record's failed-save toast: inside the panel it reopens the card there.
    const rd = code("components/crm/RecordDrawer.jsx");
    for (const m of rd.matchAll(/window\.location\.hash\s*=/g)) {
      assert.match(rd.slice(Math.max(0, m.index - 160), m.index), /if \(typeof onOpenSide === "function"\)[^\n]*\n\s*else $/, "RecordDrawer writes the address only without the panel's opener");
    }
    // Rendered: inside the panel the host card's team block links nowhere else.
    const read = { data: { brand: { id: U1, name: "Harmattan Club", slug: "harmattan" }, team: { owners: [], brand_members: [] } } };
    const opener = Object.assign(() => {}, { allows: () => true });
    const inPanel = h.teamWith({ record: { id: U2 }, read, onOpenSide: opener });
    assert.doesNotMatch(inPanel, /href="#\//);
  });
});

describe("A access", () => {
  it("A-1 side kinds: a brand needs Brands; every other kind needs Hosts and Creators; unknown kinds never open", () => {
    const side = (kind) => ({ kind, id: U1 });
    const none = { canHosts: false, canBrands: false };
    const hostsOnly = { canHosts: true, canBrands: false };
    const brandsOnly = { canHosts: false, canBrands: true };
    for (const kind of ["card", "host", "creator", "content", "event", "expected", "drafts", "calendar"]) {
      assert.equal(h.sideAllowed(side(kind), hostsOnly), true, kind);
      assert.equal(h.sideAllowed(side(kind), brandsOnly), false, `${kind} without Hosts access`);
      assert.equal(h.sideAllowed(side(kind), none), false, kind);
    }
    assert.equal(h.sideAllowed(side("brand"), brandsOnly), true);
    assert.equal(h.sideAllowed(side("brand"), hostsOnly), false, "a brand without Brands access stays closed");
    for (const bad of [null, undefined, side("nope"), side("__proto__"), side("constructor"), { id: U1 }]) {
      assert.equal(h.sideAllowed(bad, { canHosts: true, canBrands: true }), false, JSON.stringify(bad));
    }
  });

  it("A-2 a tampered rail=host for Support without Hosts access falls back to Media, with no host card actions", () => {
    const host = { record_id: U2, name: "Ade", owners: [], plan: null };
    const html = h.rail({ group, tab: "host", canHosts: false, canBrands: true, host });
    assert.deepEqual([...html.matchAll(/role="tab"[^>]*>([A-Za-z]+)</g)].map((m) => m[1]), ["Media", "People"]);
    assert.match(html, /id="rail-tab-media" aria-selected="true"/);
    for (const words of ["Create host card", "Link existing", "Open host card beside", "Assign to me", "Change stage", "Marketing plan"]) {
      assert.ok(!html.includes(words), `"${words}" shows without Hosts access`);
    }
  });

  it("A-3 the header without Hosts access: no stage, no owner line, no Assign, even when a host card is passed", () => {
    const host = { record_id: U2, name: "Ade", stage: "onboarded", owners: [], region_id: null, icp: null };
    const html = h.header({ group, host, canHosts: false, people: [], canAssign: true, online: true });
    assert.doesNotMatch(html, /Mingla owner/);
    assert.doesNotMatch(html, /No owner/);
    assert.doesNotMatch(html, /Assign to me/);
    assert.doesNotMatch(html, /data-header-stage/);
    assert.match(html, /aria-label="Mute this Brand group"/);
  });

  it("A-4 the strip: a muted group's unread dot is grey, the current group is marked, labels count unread", () => {
    const groups = [
      { ...group, conversation_id: "c1", unread_count: 3, muted: true },
      { ...group, conversation_id: "c2", brand_name: "Ox", unread_count: 0 },
    ];
    const html = h.strip({ groups, selectedId: "c2" });
    assert.match(html, /aria-label="Show the full group list"/);
    assert.match(html, /aria-label="Open Harmattan Club Brand group, 3 unread"/);
    assert.match(html, /aria-label="Open Ox Brand group, 0 unread" aria-current="true"/);
    assert.match(html, /bg-\[var\(--gray-500\)\][^>]*>3</, "muted unread is grey");
  });
});

describe("L live layer", () => {
  it("L-1 typing payloads: spoofed, malformed or my own are ignored; names are one short line", () => {
    const now = 1_000_000;
    for (const bad of [null, undefined, "typing", 42, [], {}, { user_id: 7, name: "x" }, { user_id: "", name: "x" }, { user_id: "u".repeat(65), name: "x" }, { name: "no id" }]) {
      assert.equal(h.typingEntry(bad, ME, now), null, JSON.stringify(bad));
    }
    assert.equal(h.typingEntry({ user_id: ME, name: "Me" }, ME, now), null, "my own typing never shows");
    const huge = h.typingEntry({ user_id: U1, name: `Ada\n\t${"x".repeat(10_000)}` }, ME, now);
    assert.ok(huge.name.length <= 40, `name is ${huge.name.length} chars`);
    assert.ok(!/[\n\t]/.test(huge.name));
    assert.equal(huge.until, now + h.TYPING_TTL_MS, "every entry expires");
    assert.equal(h.typingEntry({ user_id: U1, name: { toString: () => "evil" } }, ME, now).name, "Someone", "a non-string name is never stringified");
    assert.equal(h.typingEntry({ user_id: U1, name: "   " }, ME, now).name, "Someone");
    assert.deepEqual(h.typingEntry({ user_id: U1, stopped: true, name: "Ada" }, ME, now), { userId: U1, stopped: true });
    assert.equal(h.typingEntry({ user_id: U1, stopped: "true", name: "Ada" }, ME, now).stopped, false, "only a real true stops");
  });
});
