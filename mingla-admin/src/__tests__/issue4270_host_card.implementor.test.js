// Issue #4270 (Wave 2) — implementor happy path for the host card and the
// Brand group host avatar in Admin.
//
//   C-1  host card order: To do, (Plan: Wave 3, not shown yet), On Mingla,
//        Brand and team, Status, Details; Details folds contact, ICP, region,
//        channels, contact rule, imports, log and activity; a deep link opens
//        Details before it focuses a field
//   C-2  On Mingla has no form to add a promised event (D9) and no "Work on
//        this host"; rows say their kind (Event, Experience, Trip, RSVP,
//        Promised) and a trip on now stays, "Live now"; the empty line names
//        the Host app; Repeats and Cancel stay for a saved promised date
//   C-3  To do: open cards oldest due first; a late due date is red; the tag
//        and "Host sees"; Add work item checks what, assignees, due (today or
//        later) and an https Files link before it sends; "Host can see this"
//        is off by default; the item is a quick add linked to the host
//   C-4  the brand shows once (Brand and team), with Open Brand group; the
//        brand's team by name and role
//   C-5  Brand groups: the host avatar shows only to staff who can open Hosts
//        and only when the brand has a host card; it opens the host card
//        (side=host:<id>); list -> thread -> host card in the address;
//        desktop beside the chat, 1024-1279 over the list, phone one pane
//
// Run: node --test src/__tests__/issue4270_host_card.implementor.test.js
// (from mingla-admin; C-3 and C-5 build the real components with esbuild:
// run `npm ci` first, without it the test FAILS, it never skips).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EVENT_KIND_WORDS, eventKind, hostUpcomingRows, quickAddItem, quickAddProblems } from "../lib/opsModel.js";
import { brandGroupSearch, brandGroupView } from "../lib/panelStack.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(read(rel));

let harness;
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
import { HostToDoRow } from "../components/crm/HostToDoSection.jsx";
import { HostAvatarButton } from "../components/community/BrandGroupsPanel.jsx";
export function row(props) { return renderToStaticMarkup(<HostToDoRow {...props} />); }
export function avatar(props) { return renderToStaticMarkup(<HostAvatarButton onOpen={() => {}} {...props} />); }`,
      resolveDir: HERE, sourcefile: "issue4270.host.harness.jsx", loader: "jsx",
    },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    loader: { ".js": "jsx" },
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url); if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = class { constructor() { throw new Error("issue4270 render test: no network"); } };' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"VITE_SUPABASE_URL":"https://x.supabase.test","VITE_SUPABASE_ANON_KEY":"test"}' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4270-host-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  harness = await import(pathToFileURL(file).href);
});

describe("C-1 the host card's order", () => {
  const drawer = code("components/crm/RecordDrawer.jsx");
  it("To do, Plan, On Mingla, Brand and team, Status, then Details", () => {
    const at = (needle) => { const i = drawer.indexOf(needle); assert.ok(i > 0, `missing ${needle}`); return i; };
    const order = [
      at("<HostToDoSection"),
      at("<HostPlanSection"),
      at("<OnMinglaSection"),
      at("<HostTeamSection"),
      at('data-host-section="status"'),
      at("<DetailsFold isHosts={isHosts}"),
    ];
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    // Wave 3: the Plan block shows (HostPlanSection, data-host-section="plan").
    assert.match(code("components/crm/HostPlanSection.jsx"), /data-host-section="plan"/);
  });
  it("Status holds stage, next action, due, Move to and Needs attention; Details folds the rest", () => {
    const status = drawer.slice(drawer.indexOf('data-host-section="status"'), drawer.indexOf("<DetailsFold isHosts={isHosts}"));
    for (const words of ['label="Stage"', 'label="Next action"', 'label="Due"', "Move to {next.label}", "Needs attention", "Assign to me", "Fill in"]) assert.ok(status.includes(words), words);
    const fold = drawer.slice(drawer.indexOf("<DetailsFold isHosts={isHosts}"), drawer.indexOf("</DetailsFold>"));
    for (const words of ['label="ICP"', 'label="Region"', "<OwnersField", "<IdentifiersField", "<ContactRuleField", "Preferred channel", 'label="Source"', "Channels used", "<MinglaLinkField", "Imported from ClickUp", "<RecentTouchNotice", "<LogForm", "<ActivityLog"]) assert.ok(fold.includes(words), words);
    assert.match(drawer, /Details · contact rule, imports, log and activity/);
  });
  it("a deep link to a folded field opens Details first", () => {
    assert.match(drawer, /const fold = target\?\.closest\?\.\("details"\)/);
    assert.match(drawer, /if \(fold && !fold\.open\) fold\.open = true;/);
  });
});

describe("C-2 On Mingla lists what the brand has (D9, D10)", () => {
  const section = code("components/crm/OnMinglaSection.jsx");
  it("no form to add a promised event, no Work on this host", () => {
    assert.doesNotMatch(section, /Save\. Steps and Calendar fill in by themselves/);
    assert.doesNotMatch(section, /Add \{which\}/);
    assert.doesNotMatch(section, /Work on this host/);
    assert.doesNotMatch(section, /setExpectedEvent\(item,/);
    assert.match(section, /No events, experiences or trips coming up\. Hosts create them in the Host app\./);
    // A saved promised date still repeats and cancels.
    assert.match(section, /ops\.setExpectedEvent\(\{ record_id: id, id: x\.id, repeats \}/);
    assert.match(section, /ops\.setExpectedEvent\(\{ record_id: id, id: x\.id, status: "cancelled"/);
  });
  it("each row says its kind; a trip on now stays and says Live now", () => {
    const today = "2026-11-04";
    const rows = hostUpcomingRows([
      { id: "t", title: "Long trip", kind: "trip", start_on: "2026-09-25", live: true, state: { k: "live" } },
      { id: "x", title: "Pottery", kind: "experience", start_on: "2026-11-20", state: {} },
      { id: "o", title: "Old night", kind: "event", start_on: "2026-10-01", live: false, state: {} },
    ], [{ id: "p", title: "Brunch", status: "open", expected_on: "2026-12-01", state: {} }], today);
    assert.deepEqual(rows.map((r) => `${r.title}:${EVENT_KIND_WORDS[r.eventKind]}:${!!r.live}`), ["Long trip:Trip:true", "Pottery:Experience:false", "Brunch:Promised:false"]);
    assert.equal(eventKind({ event_type: "rsvp" }), "rsvp");
    assert.equal(eventKind({ kind: "weird" }), "event");
    assert.match(section, /data-live-now=""[^>]*>Live now</);
    assert.match(section, /e\.start_on >= today \|\| e\.live/);
  });
});

describe("C-3 To do and Add work item (D4)", () => {
  it("a row: late due date in red, tag, Host sees, owners; it opens the card", () => {
    const html = harness.row({ card: { id: "c1", number: 7, title: "Chase the venue", status: "todo", due_on: "2026-11-01", person_reason: "send", tag: "send", on_brand_plan: true, owners: [{ name: "Gia" }] }, today: "2026-11-04" });
    assert.match(html, /Late · 1 Nov/);
    assert.match(html, /color-error-700[^"]*"[^>]*>Late/);
    assert.match(html, /You send/);
    assert.match(html, /data-host-sees=""[^>]*>Host sees/);
    assert.match(html, /href="#\/work-board\?card=c1"/);
    const noOwner = harness.row({ card: { id: "c2", title: "Nobody", status: "todo", due_on: "2026-11-09", owners: [] }, today: "2026-11-04" });
    assert.match(noOwner, />No owner</);
    assert.doesNotMatch(noOwner, /Late ·/);
  });
  it("the form checks what, assignees, due and the Files link before sending", () => {
    const today = "2026-11-04";
    const fields = (form) => quickAddProblems(form, today).map((p) => p.field);
    assert.deepEqual(fields({ title: "ok", owners: [], due: "", filesUrl: "http://x.test" }), ["title", "owners", "due_on", "files_url"]);
    assert.equal(quickAddProblems({ title: "Chase it", owners: [] , due: today }, today)[0].message, "Pick at least one assignee");
    assert.deepEqual(fields({ title: "Chase it", owners: ["a@x.test"], due: "2026-11-03" }), ["due_on"]);
    assert.deepEqual(fields({ title: "Chase it", owners: ["a@x.test"], due: today, filesUrl: "https://drive.google.com/x" }), []);
  });
  it("the item is a quick add linked to this host; Host can see this is off unless ticked", () => {
    const item = quickAddItem({ title: " Chase it ", owners: ["a@x.test"], watchers: ["b@x.test"], due: "2026-11-10", recordId: "r1" });
    assert.deepEqual(item, { quick: true, title: "Chase it", owners: ["a@x.test"], watchers: ["b@x.test"], due_on: "2026-11-10", links: [{ kind: "host", id: "r1" }], on_brand_plan: false });
    assert.equal(quickAddItem({ title: "x", owners: [], due: "", recordId: "r1", hostSees: true, filesUrl: "https://a.test" }).on_brand_plan, true);
    const section = code("components/crm/HostToDoSection.jsx");
    assert.match(section, /hostSees: false/);
    assert.match(section, /Host can see this task on their plan/);
    assert.match(section, /\{busy \? "Adding…" : "Add work item"\}/);
    assert.match(section, /`Added\. Card \$\{row\.card\?\.number \?\? ""\} is in To do for \$\{names\.length \? names\.join\(", "\) : "its owners"\}\.`/);
    assert.match(section, /You’re offline/);
  });
});

describe("C-4 Brand and team: the brand once", () => {
  it("the brand, Open Brand group, owners and the brand's team; On Mingla does not repeat it", () => {
    const team = code("components/crm/HostTeamSection.jsx");
    assert.match(team, /Open Brand group/);
    assert.match(team, /#\/community\?tab=brand-groups&brand=/);
    assert.match(team, /Mingla owners/);
    assert.match(team, /BRAND_ROLE_WORDS\[m\.role\]/);
    const section = code("components/crm/OnMinglaSection.jsx");
    assert.doesNotMatch(section, /Brand linked/);
    assert.doesNotMatch(section, /data\.brand\.name|brand\?\.name/);
  });
});

describe("C-5 Brand groups open the host card", () => {
  it("the avatar: hidden with no host card, a skeleton while loading, a named button when there is one", () => {
    assert.equal(harness.avatar({ host: null }), "");
    assert.equal(harness.avatar({ host: { status: "none" } }), "");
    assert.match(harness.avatar({ host: { status: "loading" } }), /data-host-avatar="loading"/);
    const html = harness.avatar({ host: { status: "ready", recordId: "r1", name: "Foodie Fantasy" }, open: false });
    assert.match(html, /aria-label="Open host card for Foodie Fantasy"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, />FF</);
  });
  it("only staff who can open Hosts see it", () => {
    const panel = code("components/community/BrandGroupsPanel.jsx");
    assert.match(panel, /const canHosts = canOpenPage\(access, "hosts"\);/);
    assert.match(panel, /const hostButton = canHosts && host\.brandId === selectedBrandId/);
    assert.match(panel, /const hostOpen = !!view\.host && canHosts;/);
    assert.match(code("services/opsService.js"), /supabase\.rpc\("ops_brand_host_record", \{ p_brand_id: brandId \}\)/);
  });
  it("the address walks list -> thread -> host card", () => {
    const thread = brandGroupSearch("tab=brand-groups", { group: "g1", brand: null, host: null });
    assert.equal(thread, "tab=brand-groups&group=g1");
    const card = brandGroupSearch(thread, { group: "g1", host: "11111111-2222-4333-8444-555555555555" });
    assert.deepEqual(brandGroupView(card), { group: "g1", brand: "", host: "11111111-2222-4333-8444-555555555555" });
    assert.deepEqual(brandGroupView(brandGroupSearch(card, { host: null })), { group: "g1", brand: "", host: "" });
    assert.deepEqual(brandGroupView("tab=brand-groups&brand=b1"), { group: "", brand: "b1", host: "" });
  });
  it("beside the chat from 1280px, over the list from 1024px, one pane at a time below", () => {
    const panel = code("components/community/BrandGroupsPanel.jsx");
    assert.match(panel, /xl:grid-cols-\[260px_minmax\(0,1fr\)_minmax\(0,420px\)\]/);
    assert.match(panel, /lg:grid-cols-\[minmax\(0,420px\)_minmax\(0,1fr\)\]/);
    assert.match(panel, /data-pane-host="" className="flex min-w-0 flex-col lg:order-first xl:order-none"/);
    assert.match(panel, /const pane = hostOpen \? "host" : view\.group \? "thread" : "list";/);
    assert.match(panel, /Back to Brand groups/);
    assert.match(panel, /Back to the chat/);
  });
});
