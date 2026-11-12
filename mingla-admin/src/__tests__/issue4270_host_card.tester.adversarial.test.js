// Issue #4270 (Wave 2) — tester adversarial checks for the host card, the
// Brand group host avatar, and the test-only copy of the old promised-event
// save. Different angles from the implementor's happy path:
//
//   Q-1  Add work item checks at the edges: 2 / 3 / 160 / 161 characters
//        after trimming, spaces only, yesterday vs today, a missing or odd
//        assignee list, http and javascript Files links; the item it sends
//        never carries instructions, done means, a tag or a kind, never a
//        blank Files link, and Host can see this is a real boolean
//   Q-2  kinds: inherited names (constructor, __proto__, toString) and an
//        unknown kind read as Event; a past row that is not live drops, a
//        past live one stays; every promised row says Promised
//   Q-3  the Brand groups address: other keys survive, host on/off only
//        touches side, a card panel is not a host card, a bad host id is
//        dropped, and Back walks list -> thread -> host card -> thread
//   Q-4  rendered: the avatar draws nothing with no host card or no access,
//        an error is a retry button, a ready one is labelled with the host
//        and escapes it; a To do row due today is not late, one due
//        yesterday is, "Host sees" only when the flag is true, "No owner"
//        when nobody owns it
//   Q-5  the #3980 test copy of the old save (D16): only pg_temp functions,
//        no transaction of its own, included only by PG17 suites under
//        supabase/migrations/__tests__ that open a transaction first and
//        never commit; no migration and no edge function names it
//   Q-6  W1 rework, client side: Done is the server's (no date re-filter),
//        a retired person card reads as To do with its tag
//
// Run: node --test src/__tests__/issue4270_host_card.tester.adversarial.test.js
// (from mingla-admin; Q-4 builds the real components with esbuild: run
// `npm ci` first, without it the test FAILS, it never skips).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { columnCards, eventKind, hostUpcomingRows, quickAddItem, quickAddProblems, readPersonAsTodo } from "../lib/opsModel.js";
import { brandGroupSearch, brandGroupView } from "../lib/panelStack.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const TESTS = path.join(REPO, "supabase", "migrations", "__tests__");
const FIXTURE = "issue_4270_promised_event_before_d16.fixture.sql";
const HOST = "42710000-0000-4000-c0f0-000000000001";
const GROUP = "42710000-0000-4000-e0f0-000000000009";

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
      resolveDir: HERE, sourcefile: "issue4270.host.tester.harness.jsx", loader: "jsx",
    },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    loader: { ".js": "jsx" },
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url); if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = class { constructor() { throw new Error("issue4270 render test: no network"); } };' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"VITE_SUPABASE_URL":"https://x.supabase.test","VITE_SUPABASE_ANON_KEY":"test"}' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4270-host-tester-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  harness = await import(pathToFileURL(file).href);
});

const fields = (list) => list.map((p) => p.field).sort();

describe("Q-1 Add work item at the edges", () => {
  const today = "2026-11-04";
  // #4398: one owner and one watcher.
  const ok = { title: "Chase the contract", owners: ["kemi@test.local"], watchers: ["bola@test.local"], due: today, filesUrl: "" };
  it("the title counts after trimming: 2 and 161 are refused, 3 and 160 pass, spaces only is empty", () => {
    assert.deepEqual(fields(quickAddProblems({ ...ok, title: "  ab  " }, today)), ["title"]);
    assert.deepEqual(fields(quickAddProblems({ ...ok, title: "  abc  " }, today)), []);
    assert.deepEqual(fields(quickAddProblems({ ...ok, title: "x".repeat(160) }, today)), []);
    assert.deepEqual(fields(quickAddProblems({ ...ok, title: "x".repeat(161) }, today)), ["title"]);
    assert.deepEqual(fields(quickAddProblems({ ...ok, title: "      " }, today)), ["title"]);
  });
  it("due today passes, yesterday and a non-date are refused, with different words", () => {
    assert.deepEqual(quickAddProblems({ ...ok, due: today }, today), []);
    const past = quickAddProblems({ ...ok, due: "2026-11-03" }, today);
    const odd = quickAddProblems({ ...ok, due: "4 Nov" }, today);
    assert.deepEqual(fields(past), ["due_on"]);
    assert.deepEqual(fields(odd), ["due_on"]);
    assert.notEqual(past[0].message, odd[0].message);
  });
  it("owner: none, or not a list, is refused with the form's words (#4398: one owner)", () => {
    for (const owners of [[], null, "kemi@test.local", undefined]) {
      const p = quickAddProblems({ ...ok, owners }, today);
      assert.deepEqual(fields(p), ["owners"], String(owners));
      assert.equal(p[0].message, "A card has one owner. Pick one person.");  // #4398: one owner
    }
  });
  it("Files link: http, javascript and a bare word are refused; https passes", () => {
    for (const filesUrl of ["http://drive.example.com/x", "javascript:alert(1)", "drive"]) {
      assert.deepEqual(fields(quickAddProblems({ ...ok, filesUrl }, today)), ["files_url"], filesUrl);
    }
    assert.deepEqual(quickAddProblems({ ...ok, filesUrl: "https://drive.example.com/x" }, today), []);
  });
  it("the item never carries what Mingla writes or a tag; a blank link is left out; the flag is a boolean", () => {
    const item = quickAddItem({ title: "  Chase  ", owners: ["kemi@test.local"], due: today, filesUrl: "   ", recordId: HOST });
    assert.deepEqual(Object.keys(item).sort(), ["due_on", "links", "on_brand_plan", "owners", "quick", "title", "watchers"]);
    assert.equal(item.title, "Chase");
    assert.equal(item.on_brand_plan, false);
    assert.equal(item.quick, true);
    assert.deepEqual(item.links, [{ kind: "host", id: HOST }]);
    const shown = quickAddItem({ title: "Poster", owners: ["a@test.local"], due: today, filesUrl: " https://x.example.com/f ", hostSees: true, recordId: HOST });
    assert.equal(shown.on_brand_plan, true);
    assert.equal(shown.files_url, "https://x.example.com/f");
    assert.equal(typeof quickAddItem({ title: "P", owners: [], due: today, hostSees: undefined, recordId: HOST }).on_brand_plan, "boolean");
  });
});

describe("Q-2 kinds and what stays listed", () => {
  it("inherited names and unknown kinds read as Event", () => {
    for (const kind of ["constructor", "__proto__", "toString", "hasOwnProperty", "promo_moment", "", null]) {
      assert.equal(eventKind({ kind }), "event", String(kind));
    }
    assert.equal(eventKind(null), "event");
    assert.equal(eventKind({ event_type: "rsvp" }), "rsvp");
  });
  it("a past row drops unless it is live; promised rows say Promised", () => {
    const today = "2026-11-04";
    const rows = hostUpcomingRows([
      { id: "a", title: "Old dinner", kind: "event", start_on: "2026-11-01", live: false },
      { id: "b", title: "Long course", kind: "experience", start_on: "2026-09-05", live: true },
      { id: "c", title: "Soon", kind: "rsvp", start_on: "2026-11-09", live: false },
    ], [
      { id: "x", title: "Promised brunch", expected_on: "2026-12-01", repeats: "none", status: "open" },
    ], today);
    assert.deepEqual(rows.map((r) => `${r.title}:${r.eventKind}:${r.live ? "live" : "-"}`.replace(/:undefined/, ":")),
      ["Long course:experience:live", "Soon:rsvp:-", "Promised brunch:promised:-"]);
  });
});

describe("Q-3 the Brand groups address", () => {
  it("other keys survive; host on and off only touch side", () => {
    const start = "tab=brand-groups&q=palm&group=" + GROUP;
    const open = brandGroupSearch(start, { host: HOST });
    const p = new URLSearchParams(open);
    assert.equal(p.get("q"), "palm");
    assert.equal(p.get("group"), GROUP);
    assert.equal(p.get("side"), `host:${HOST}`);
    const closed = new URLSearchParams(brandGroupSearch(open, { host: null }));
    assert.equal(closed.get("side"), null);
    assert.equal(closed.get("group"), GROUP);
    assert.equal(closed.get("q"), "palm");
  });
  it("a card panel is not a host card; a bad host id is dropped", () => {
    assert.equal(brandGroupView(`tab=brand-groups&side=card:${HOST}`).host, "");
    assert.equal(brandGroupView("tab=brand-groups&side=host:not-a-uuid").host, "");
    assert.equal(new URLSearchParams(brandGroupSearch("tab=brand-groups", { host: "../../x" })).get("side"), null);
  });
  it("Back walks list -> thread -> host card -> thread", () => {
    const list = brandGroupSearch("", {});
    const thread = brandGroupSearch(list, { group: GROUP, brand: null, host: null });
    const card = brandGroupSearch(thread, { group: GROUP, host: HOST });
    const views = [list, thread, card].map(brandGroupView);
    assert.deepEqual(views.map((v) => [v.group ? "g" : "-", v.host ? "h" : "-"].join("")), ["--", "g-", "gh"]);
    assert.deepEqual(brandGroupView(brandGroupSearch(card, { host: null })), views[1]);
    assert.equal(brandGroupView(brandGroupSearch(`tab=brand-groups&brand=${HOST}`, { group: GROUP, brand: null })).brand, "");
  });
});

describe("Q-4 rendered avatar and To do rows", () => {
  it("the avatar: nothing without a host card or access, a retry on error, a labelled and escaped button", () => {
    assert.equal(harness.avatar({ host: null }), "");
    assert.equal(harness.avatar({ host: { status: "none" } }), "");
    assert.match(harness.avatar({ host: { status: "error", retry: () => {} } }), /Try again/);
    const html = harness.avatar({ host: { status: "ready", recordId: HOST, name: "Ada <b>& Co</b>" }, open: false });
    assert.match(html, /aria-label="Open host card for Ada &lt;b&gt;&amp; Co&lt;\/b&gt;"/);
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /<b>/);
    assert.match(harness.avatar({ host: { status: "ready", recordId: HOST, name: "Ada" }, open: true }), /aria-expanded="true"/);
  });
  it("a row due today is not late, one due yesterday is; Host sees only when true; No owner when nobody owns it", () => {
    const today = "2026-11-04";
    const card = { id: HOST, title: "Call the venue", status: "todo", due_on: today, owners: [{ name: "Kemi" }], on_brand_plan: false };
    const now = harness.row({ card, today });
    assert.doesNotMatch(now, /Late ·/);
    assert.doesNotMatch(now, /Host sees/);
    assert.doesNotMatch(now, /No owner/);
    const late = harness.row({ card: { ...card, due_on: "2026-11-03", owners: [], on_brand_plan: true }, today });
    assert.match(late, /Late ·/);
    assert.match(late, /Host sees/);
    assert.match(late, /No owner/);
  });
});

describe("Q-5 the #3980 test copy of the old promised-event save stays in tests", () => {
  const fixture = fs.readFileSync(path.join(TESTS, FIXTURE), "utf8");
  const sqlNoComments = (s) => s.replace(/--.*$/gm, "");
  it("defines only pg_temp functions and opens or ends no transaction of its own", () => {
    const body = sqlNoComments(fixture);
    const created = [...body.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z_][\w.]*)/gi)].map((m) => m[1].toLowerCase());
    assert.ok(created.length >= 1);
    for (const name of created) assert.match(name, /^pg_temp\./, name);
    // Outside the function bodies: no transaction control and nothing lasting.
    const outside = body.replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, "");
    assert.doesNotMatch(outside, /\b(commit|rollback|begin|start\s+transaction|savepoint)\b/i);
    assert.doesNotMatch(outside, /create\s+(table|view|trigger|policy|schema|extension)\b/i);
    assert.doesNotMatch(outside, /\b(insert|update|delete|alter|drop|revoke)\b/i);
    for (const g of outside.match(/grant[^;]*;/gi) || []) assert.match(g, /^grant\s+execute\s+on\s+function\s+pg_temp\./i, g);
  });
  it("is included only by PG17 suites that open a transaction first and never commit", () => {
    const users = fs.readdirSync(TESTS).filter((f) => f !== FIXTURE && fs.readFileSync(path.join(TESTS, f), "utf8").includes(FIXTURE));
    assert.ok(users.length >= 10, `expected the 10 #3980 suites, got ${users.length}`);
    for (const f of users) {
      assert.match(f, /\.pg17\.test\.sql$/, f);
      const s = sqlNoComments(fs.readFileSync(path.join(TESTS, f), "utf8"));
      const include = s.indexOf(`\\ir ${FIXTURE}`);
      const begin = s.search(/^begin;/im);
      assert.ok(include > 0 && begin >= 0 && begin < include, `${f}: begin; must come before the include`);
      assert.doesNotMatch(s, /^\s*commit\s*;/im, f);
    }
  });
  it("no migration and no edge function names it or its functions", () => {
    const migrations = path.join(REPO, "supabase", "migrations");
    for (const f of fs.readdirSync(migrations).filter((n) => n.endsWith(".sql"))) {
      const s = fs.readFileSync(path.join(migrations, f), "utf8");
      assert.ok(!s.includes("t4270_promise") && !s.includes(FIXTURE), `migration ${f}`);
    }
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? (d.name === "node_modules" ? [] : walk(path.join(dir, d.name))) : [path.join(dir, d.name)]);
    for (const f of walk(path.join(REPO, "supabase", "functions"))) {
      const s = fs.readFileSync(f, "utf8");
      assert.ok(!s.includes("t4270_promise") && !s.includes("promised_event_before_d16"), path.relative(REPO, f));
    }
    assert.ok(!fs.existsSync(path.join(migrations, FIXTURE)), "the fixture is never a top-level migration");
  });
});

describe("Q-6 Wave 1 rework on the client", () => {
  it("Done is what the server sent: no date re-filter, latest due first", () => {
    const cards = [
      { id: "1", number: 1, status: "done", due_on: "2026-09-01", closed_at: "2026-09-02T10:00:00Z" },
      { id: "2", number: 2, status: "done", due_on: "2026-11-03", closed_at: "2026-11-03T10:00:00Z" },
    ];
    assert.deepEqual(columnCards(cards, "done").map((c) => c.id), ["2", "1"]);
  });
  it("a retired person card from an old server reads as To do, keeping its tag", () => {
    const out = readPersonAsTodo({ cards: [{ id: "p", status: "person", person_reason: "spend" }, { id: "q", status: "person" }] });
    assert.deepEqual(out.cards.map((c) => `${c.status}/${c.person_reason}`), ["todo/spend", "todo/other"]);
    assert.deepEqual(columnCards(out.cards, "todo").map((c) => c.id).sort(), ["p", "q"]);
  });
});
