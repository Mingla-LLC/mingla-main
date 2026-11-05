// Issue #4270 (Wave 3) — implementor happy path for the brand plan in Admin.
//
//   B-1  the Calendar drawer: Brand, Collab with (a creator, optional), Host
//        sees ("Being made · Thu 12 Nov", "Not on the plan: add a date",
//        "No brand"), Plan link (https only; staff and hosts see it); the
//        Drive link says Staff only; a Calendar card shows its brand
//   B-2  the host card's Plan block: by week with Today; each item's link is
//        a button with the site name; staff "+ Add link" / "Change link" on
//        posts and tasks, never on events; "From Host app" on a host's item
//   B-3  Add to plan: Post or Task with the design's help words, What, Due,
//        Link, Note, owners and (tasks) watchers; the form's checks; the item
//        sent; the toast words
//   B-4  services call ops_brand_plan, ops_brand_plan_add and
//        ops_brand_plan_set_link; a plan line shows as a quiet centred line
//        in Brand groups
//
// Run: node --test src/__tests__/issue4270_brand_plan_admin.implementor.test.js
// (from mingla-admin; B-2 builds the real Plan row with esbuild: run `npm ci`
// first, without it the test FAILS, it never skips).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  KIND_HELP,
  emptyPlanForm,
  hostSeesWords,
  isPlanLine,
  linkSite,
  planAddItem,
  planAddedWords,
  planFormProblems,
  planWeeks,
  planLinkProblem,
  planTaskDefaults,
} from "../lib/brandPlan.js";
import { filesHost, filesUrlProblem } from "../lib/opsModel.js";
import { sideHref } from "../lib/panelStack.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(fs.readFileSync(path.join(SRC, rel), "utf8"));
const TODAY = "2026-11-04"; // a Wednesday

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
import { PlanRow } from "../components/crm/HostPlanSection.jsx";
export function row(props) { return renderToStaticMarkup(<PlanRow online onSaveLink={async () => true} {...props} />); }`,
      resolveDir: HERE, sourcefile: "issue4270.plan.harness.jsx", loader: "jsx",
    },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    loader: { ".js": "jsx" },
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"VITE_SUPABASE_URL":"https://x.supabase.test","VITE_SUPABASE_ANON_KEY":"test"}' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4270-plan-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  harness = await import(pathToFileURL(file).href);
});

describe("B-1 the Calendar knows a post's brand", () => {
  it("Host sees words", () => {
    assert.equal(hostSeesWords({ brand_id: "b", host_state: "being_made", host_state_words: "Being made", publish_at: "2026-11-12T18:00:00Z" }), "Being made · Thu 12 Nov");
    assert.equal(hostSeesWords({ brand_id: "b", host_state: null, publish_at: null }), "Not on the plan: add a date");
    assert.equal(hostSeesWords({ brand_id: null }), "No brand");
  });
  it("the drawer has Brand, Collab with, Host sees and Plan link; the Drive link is Staff only", () => {
    const drawer = code("components/contentCalendar/ContentDrawer.jsx");
    assert.match(drawer, /<LinkSearchField id="content-brand" label="Brand" kind="brand"/);
    assert.match(drawer, /label="Collab with" kind="creator"/);
    assert.match(drawer, /helper="A creator from the Creators board \(optional\)"/);
    assert.match(drawer, /save\(\{ brand_id: pick\?\.id \|\| null \}\)/);
    assert.match(drawer, /save\(\{ collaborator_record_id: pick\?\.id \|\| null \}\)/);
    assert.match(drawer, />Host sees<\/span>/);
    assert.match(drawer, /<Field label="Plan link" htmlFor="content-plan-link" helper="Staff and the brand’s hosts see this link\."/);
    assert.match(drawer, /save\(\{ plan_link_url: value \|\| null \}\)/);
    assert.match(drawer, /<Field label="Drive link" htmlFor="content-drive" helper="Staff only">/);
  });
  it("a Calendar card shows its brand", () => {
    assert.match(code("components/contentCalendar/ContentCard.jsx"), /item\.brand_name && <span data-brand-chip=""/);
  });
});

describe("B-2 the Plan block on the host card", () => {
  it("is by week with Today marked", () => {
    const weeks = planWeeks([
      { kind: "post", id: "1", on: "2026-11-03" },
      { kind: "task", id: "2", on: "2026-11-06" },
      { kind: "event", id: "3", on: "2026-11-12" },
      { kind: "post", id: "4", on: "2026-11-20" },
    ], TODAY);
    assert.deepEqual(weeks.map((w) => w.label), ["This week", "Next week", "Week of 16 Nov"]);
    assert.equal(weeks[0].today, true);
    assert.equal(weeks[0].todayIndex, 1, "Today sits after the item that was yesterday");
    assert.deepEqual(planWeeks([], TODAY).map((w) => w.label), ["This week"]);
  });
  it("a post's link is a button with the site name, and staff can change it", () => {
    const html = harness.row({ item: { kind: "post", id: "p1", title: "Menu reveal carousel", on: "2026-11-12", state: "being_made", state_words: "Being made", link: { url: "https://www.canva.com/x", site: "canva.com" }, can_link: true, by: "mingla", revision: 2 } });
    assert.match(html, /data-plan-link=""[^>]*href="https:\/\/www\.canva\.com\/x"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    assert.match(html, /↗<\/span><span[^>]*>canva\.com<\/span>/);
    assert.match(html, />Change link</);
    assert.match(html, />Being made</);
    assert.doesNotMatch(html, /From Host app/);
  });
  it("a task without a link offers + Add link; a host's item says From Host app", () => {
    const html = harness.row({ item: { kind: "task", id: "t1", title: "Print the menus", on: "2026-11-14", state: "todo", state_words: "To do", link: null, can_link: true, by: "host", revision: 1 } });
    assert.match(html, />\+ Add link</);
    assert.match(html, /data-from-host-app=""/);
  });
  it("events carry no link editor", () => {
    const html = harness.row({ item: { kind: "event", id: "e1", title: "Supper Club", on: "2026-11-12", state: "on_mingla", state_words: "On Mingla", link: null, can_link: false, by: "host" } });
    assert.doesNotMatch(html, /Add link|Change link|data-plan-link/);
    assert.match(html, />Event</);
  });
  it("the block is the host card's Plan, shared with the host, with an empty line", () => {
    const src = code("components/crm/HostPlanSection.jsx");
    assert.match(src, /data-host-section="plan"/);
    assert.match(src, /Shared with the host/);
    assert.match(src, /Nothing planned yet\. Add the first post or task you want\./);
    assert.match(src, /fetchBrandPlan\(recordId, addDays\(today, -7\), addDays\(today, 90\), today\)/);
  });
});

describe("B-3 Add to plan", () => {
  it("uses the design's help words for Post and Task", () => {
    assert.equal(KIND_HELP.task, "Task: becomes a Work card in To do, sorted by its due date.");
    assert.equal(KIND_HELP.post, "Post: goes on the Calendar for this brand as an Idea with this date, and always shows on the host's plan. No Work card.");
    assert.match(code("components/crm/HostPlanSection.jsx"), /\{KIND_HELP\[form\.type\]\}/);
  });
  it("checks what it is, the date, the link and the owners", () => {
    const words = (form) => planFormProblems({ ...emptyPlanForm(["kemi@usemingla.com"]), ...form }, TODAY).map((p) => p.message);
    assert.deepEqual(words({}), ["Say what it is.", "Pick a date."]);
    assert.deepEqual(words({ title: "Dress code", on: "2026-11-03" }), ["Pick today or a later date."]);
    assert.deepEqual(words({ title: "Dress code", on: TODAY, link: "http://example.com" }), ["Links start with https://"]);
    assert.deepEqual(words({ type: "task", title: "Go", on: TODAY }), ["Say what it is in 3 to 160 characters."]);
    assert.deepEqual(words({ type: "task", title: "Print menus", on: TODAY, owners: [] }), ["Pick at least one owner."]);
    assert.deepEqual(words({ title: "Dress code", on: TODAY, link: "https://canva.com/x" }), []);
  });
  it("sends type, title, date, link, note and people", () => {
    assert.deepEqual(planAddItem({ type: "post", title: "  Dress code ", on: TODAY, link: "", note: "", owners: ["a@x"], watchers: ["b@x"] }),
      { type: "post", title: "Dress code", on: TODAY, owners: ["a@x"] });
    assert.deepEqual(planAddItem({ type: "task", title: "Print", on: TODAY, link: "https://x.example.com/f", note: "Two hundred", owners: ["a@x"], watchers: ["b@x"] }),
      { type: "task", title: "Print", on: TODAY, link: "https://x.example.com/f", note: "Two hundred", owners: ["a@x"], watchers: ["b@x"] });
  });
  it("says where it went", () => {
    assert.equal(planAddedWords({ status: "added", kind: "post", item: { on: "2026-11-12" } }), "Post added to the Calendar as an Idea for Thu 12 Nov. It is on the host's plan.");
    assert.equal(planAddedWords({ status: "added", kind: "task", item: { number: 42, owners: [{ name: "Gia" }] } }), "Added. Card 42 is in To do for Gia.");
    assert.equal(planAddedWords({ status: "refused" }), "");
  });
  it("the form keeps what was typed on failure and says Adding… while saving", () => {
    const src = code("components/crm/HostPlanSection.jsx");
    assert.match(src, /setFailed\(opsErrorWords\(error\)\)/);
    assert.match(src, /Couldn’t add it\. \{failed\}/);
    assert.match(src, /\{busy \? "Adding…" : "Add to plan"\}/);
    assert.match(src, /You’re offline/);
  });
});

describe("B-4 services and the quiet line", () => {
  it("calls the plan functions", () => {
    const svc = code("services/opsService.js");
    assert.match(svc, /rpc\("ops_brand_plan", \{ p_record_id: recordId, p_from: from, p_to: to, p_today: today \|\| null \}\)/);
    assert.match(svc, /rpc\("ops_brand_plan_add", \{ p_record_id: recordId, p_item: item, p_request_key: requestKey \}\)/);
    assert.match(svc, /rpc\("ops_brand_plan_set_link", \{ p_kind: kind, p_id: id, p_link: link \|\| null, p_expected_revision: revision \}\)/);
  });
  it("a plan line is a system message with no sender, shown as a quiet line", () => {
    assert.equal(isPlanLine({ message_type: "system", sender_id: null }), true);
    assert.equal(isPlanLine({ message_type: "system", sender_id: "u1" }), false);
    assert.equal(isPlanLine({ message_type: "text", sender_id: null }), false);
    assert.match(code("components/community/BrandGroupsPanel.jsx"), /if \(isPlanLine\(message\)\) \{\s*return <p key=\{message\.id\} data-system-line=""/);
  });
  it("site names", () => {
    assert.equal(linkSite("https://www.canva.com/design/x"), "canva.com");
    assert.equal(linkSite("http://canva.com"), "");
  });
  it("W4 rework: a site name reads as its real address, and a link needs a site", () => {
    assert.equal(linkSite("https://саnvа.com/x"), "xn--nv-6kcc5f.com");
    assert.equal(linkSite("https://www.bücher.example/x"), "xn--bcher-kva.example");
    for (const bad of ["https:///evil.example", "https://:443/evil", "https://?x=1", "https://#x"]) {
      assert.equal(linkSite(bad), "", bad);
      assert.equal(planLinkProblem(bad), "Links start with https://", bad);
      assert.equal(filesUrlProblem(bad), "Links start with https://", bad);
    }
    assert.equal(planLinkProblem("https://canva.com\u{1D173}.evil.example"), "Links start with https://");
    assert.equal(planLinkProblem("https://саnvа.com/x"), "");
    assert.equal(filesHost("https://саnvа.com/x"), "xn--nv-6kcc5f.com");
    assert.equal(filesUrlProblem("https://drive.google.com/x"), "");
  });
  it("W4 retest: plan and Files links both refuse www with nothing after it, % in a site, IP addresses and dead stops", () => {
    for (const bad of ["https://www./x", "https://canva.com%2eevil.example/", "https://%d1%81anva.example/", "https://134744072/", "https://8.8.8.8/", "https://0x8.0x8.0x8.0x8/",
      "https://[2606:4700:4700::1111]/", "https://canva\u2024com/", "https://a\u24881com/", "https://a|b.example/", "https://user@evil.example/", "https://canva.com\u200B.evil.example/"]) {
      assert.equal(planLinkProblem(bad), "Links start with https://", bad);
      assert.equal(filesUrlProblem(bad), "Links start with https://", bad);
    }
    for (const good of ["https://www.canva.com/x", "https://canva\u3002com/x", "https://canva.com/50%25-off", "https://1password.com/"]) {
      assert.equal(planLinkProblem(good), "", good);
      assert.equal(filesUrlProblem(good), "", good);
    }
  });
});

// Rework after the Wave 3 test: P1-1, P3-2, P3-7, P3-9.
describe("W3 rework: the Plan block's links and the form's defaults", () => {
  const plan = code("components/crm/HostPlanSection.jsx");
  const ID = "42730000-0000-4000-d0f0-000000000001";
  it("P1-1 a plan row links to what the Calendar and Work board read", () => {
    assert.ok(plan.includes("href={sideHref(itemSide(item))}"));
    assert.ok(!plan.includes("?item="), "the Calendar reads card=, never item=");
    assert.equal(sideHref({ kind: "content", id: ID }), `#/content-calendar?card=${ID}`);
    assert.equal(sideHref({ kind: "card", id: ID }), `#/work-board?card=${ID}`);
    assert.equal(sideHref({ kind: "event", id: ID }), `#/content-calendar?event=event:${ID}`);
    assert.equal(sideHref({ kind: "expected", id: ID }), `#/content-calendar?event=expected:${ID}`);
  });
  it("P3-7 upper-case schemes are refused here too, as the server refuses them", () => {
    assert.equal(planLinkProblem("HTTPS://X.COM"), "Links start with https://");
    assert.equal(planLinkProblem("Https://x.com"), "Links start with https://");
    assert.equal(linkSite("HTTPS://X.COM"), "");
  });
  it("P3-2 hidden characters and anything before the site name are refused, as on the server", () => {
    for (const bad of ["https://canva.com\u202Emoc.live", "https://canva.com\u200B/x", "https://canva.com/\u0007", "https://canva.com\u00A0/x", "https://canva.com/\u{E0001}",
      "https://canva.com:x@evil.example", "https://canva.com@evil.example/", "https://canva.com\\@evil.example"]) {
      assert.equal(planLinkProblem(bad), "Links start with https://", JSON.stringify(bad));
    }
    assert.equal(planLinkProblem("https://canva.com/@tobi/x"), "");
    assert.equal(planLinkProblem("https://example.com/caf\u00E9"), "", "ordinary non-English letters are fine");
  });
  it("P3-9 the form shows the task defaults the server returns, and sends them", () => {
    const d = planTaskDefaults({ task_defaults: { owners: ["gia@x.test"], watchers: ["kunle@x.test"] } }, ["other@x.test"]);
    assert.deepEqual(d, { owners: ["gia@x.test"], watchers: ["kunle@x.test"] });
    assert.deepEqual(planTaskDefaults(null, ["other@x.test"]), { owners: ["other@x.test"], watchers: [] });
    assert.ok(plan.includes('watchers: type === "task" ? taskDefaults.watchers : []'));
    assert.deepEqual(planAddItem({ type: "task", title: "Print", on: "2026-12-01", link: "", note: "", owners: d.owners, watchers: d.watchers }).watchers, ["kunle@x.test"]);
    assert.deepEqual(planAddItem({ type: "task", title: "Print", on: "2026-12-01", link: "", note: "", owners: d.owners, watchers: [] }).watchers, [], "cleared means nobody");
  });
});
