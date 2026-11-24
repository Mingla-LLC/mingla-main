// Issue #4571 (design v5, approved by Seth) -- the Hosts and Creators board
// redesign: cards, the Live rule, the record panel, several owners and
// watchers, and Work linked both ways. Implementor tests for Admin.
//
//   L-1  a Live card past its date stays in Live: not in Stale, not in
//        staleIds, not under the Stale filter, and it says "Past due · date"
//        (rendered); a non-Live card past its date is still Stale
//   P-1  host problems are ONE amber count with the list on hover, never a
//        stack of red pills (rendered); creators have none
//   O-1  several owners render as two faces then +N, watchers as an eye with
//        a count (rendered); no owner is a quiet dashed chip
//   C-1  the card order and weight: name, type · region, one status line,
//        contacts and owners, next step with due, touched and the move;
//        overdue stands forward, nothing due sits flat; a creator in
//        Negotiating offers Mark signed until the agreement is signed
//   W-1  link and unlink an existing Work card from the record panel through
//        the person-facing ops_work_update / ops_work_link_remove with the
//        card's revision; closed cards, a 21st link and a brand-only link are
//        refused in words; a server error reaches the caller (and the panel
//        shows it as a toast); the picker joins search results to open cards
//   R-1  the card's status line: a reply waiting beats demo and next-event
//        facts, which beat "Stuck in <stage>", which beats the round (rendered)
//   J-1  the panel's section jump links: only the record's own sections, in
//        body order; each scrolls to its data-jump target; the active one
//        follows the scroll; they are keyboard buttons
//   S-1  a Work card opens OVER the record panel (panel one hidden, kept
//        mounted) with "Back to <record>" closing panel two; a host or creator
//        linked on the Work card opens here, or switches to its tab
//
// FAILS-ON-REVERT: without NEVER_STALE a live card past due sits in Stale;
// without cardProblems the card renders red pills; without the over layout
// panel two sits beside panel one with no Back.
//
// Run: node --test src/__tests__/issue4571_board_redesign.implementor.test.js
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { boardColumns, filterByDueChip, isStale, pastDueWords, staleIds } from "../lib/outreachView.js";
import { cardProblems, cardStatus } from "../lib/recordCardModel.js";
import { WORK_LINK_MAX, linkWorkToRecord, openWorkCount, recordLinkKind, unlinkWorkFromRecord, workPickerRows } from "../lib/recordWorkLinks.js";
import { recordSideRoute } from "../lib/panelStack.js";
import { activeJump, jumpSections } from "../lib/recordPanelModel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, "..", rel), "utf8");

const HARNESS = `
import { renderToStaticMarkup } from "react-dom/server";
import { RecordCard } from "../components/crm/RecordCard.jsx";
import { HostNextContext } from "../hooks/useOpsWork.js";
import { PanelStack } from "../components/ui/PanelStack.jsx";
import { Drawer } from "../components/ui/Drawer.jsx";
import { ToastProvider } from "../context/ToastContext.jsx";
export function card(props, hostNext = null) {
  const el = <RecordCard regions={[{ id: "r1", name: "Lagos" }]} team={TEAM} today="2026-11-24" onOpen={() => {}} onMove={() => {}} {...props} />;
  return renderToStaticMarkup(<ToastProvider>{hostNext ? <HostNextContext.Provider value={hostNext}>{el}</HostNextContext.Provider> : el}</ToastProvider>);
}
const TEAM = [
  { email: "ada@usemingla.com", name: "Ada" }, { email: "tomi@usemingla.com", name: "Tomi" },
  { email: "rae@usemingla.com", name: "Rae" }, { email: "jon@usemingla.com", name: "Jon" },
];
export function stack({ over = false, title = "" } = {}) {
  const noop = () => {};
  const panels = { trail: [], back: noop, closeSide: noop, titles: { current: {} } };
  return renderToStaticMarkup(
    <PanelStack stack={panels} over={over} narrow={over ? undefined : false} firstSize="record" firstTitle={title}
      first={<Drawer open onClose={noop} title="Lantern Supper Club"><p data-record="">record</p></Drawer>}
      second={<Drawer open onClose={noop} title="Work card" bare><p data-work="">work</p></Drawer>} />
  );
}
`;

let h;
before(async () => {
  let esbuild;
  try { esbuild = await import("esbuild"); } catch { assert.fail("esbuild is not installed: run `npm ci` in mingla-admin"); }
  const noSupabase = {
    name: "no-supabase",
    setup(build) {
      build.onResolve({ filter: /lib\/supabase$/ }, () => ({ path: "supabase-stub", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const supabase = { rpc: async () => ({ data: null, error: null }), auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };", loader: "js" }));
    },
  };
  const out = await esbuild.build({
    stdin: { contents: HARNESS, resolveDir: HERE, sourcefile: "issue4571.board.harness.jsx", loader: "jsx" },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    plugins: [noSupabase], loader: { ".js": "jsx" },
    banner: { js: 'import { createRequire as __r } from "node:module"; const require = __r(import.meta.url);' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"VITE_SUPABASE_URL":"https://x.supabase.test","VITE_SUPABASE_ANON_KEY":"test"}' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4571-board-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  h = await import(pathToFileURL(file).href);
});

const HOSTS = {
  id: "hosts", label: "Hosts", singular: "host",
  icps: [{ id: "supper", label: "Supper club" }],
  stages: [
    { id: "prospect", label: "Prospect" }, { id: "contacted", label: "Contacted" }, { id: "replied", label: "Replied" },
    { id: "meeting", label: "Demo booked" }, { id: "onboarded", label: "Onboarded" }, { id: "live", label: "Live", auto: true },
    { id: "lost", label: "Lost", terminal: true },
  ],
};
const CREATORS = {
  id: "creators", label: "Creators", singular: "creator", icps: [],
  stages: [
    { id: "identified", label: "Identified" }, { id: "contacted", label: "Contacted" }, { id: "replied", label: "Replied" },
    { id: "negotiating", label: "Negotiating" }, { id: "booked", label: "Booked" }, { id: "posted", label: "Posted" },
    { id: "passed", label: "Passed", terminal: true },
  ],
};
const TODAY = "2026-11-24";
const host = (over = {}) => ({ id: "h1", pipeline: "hosts", name: "Calabash Jazz Brunch", stage: "contacted", icp: "supper", region_id: "r1", owners: ["ada@usemingla.com"], identifiers: [{ id: "i1", kind: "email", value: "hi@calabash.example", key: "hi@calabash.example", status: "ok" }], ...over });

describe("L-1 Live never goes Stale", () => {
  const live = host({ id: "live1", stage: "live", due_on: "2026-11-22" });
  const stuck = host({ id: "c1", stage: "contacted", due_on: "2026-11-22" });
  it("a live card due before today is not stale, not in staleIds, not under the Stale filter", () => {
    assert.equal(isStale(live, TODAY), false);
    assert.deepEqual(staleIds([live, stuck], TODAY), ["c1"]);
    assert.deepEqual(filterByDueChip([live, stuck], "stale", TODAY).map((r) => r.id), ["c1"]);
  });
  it("it sits in the Live column; the Stale column (and so the Reset count) holds only the non-Live card", () => {
    const cols = boardColumns(HOSTS, [live, stuck], TODAY, { warn: () => {} });
    const col = (id) => cols.find((c) => c.id === id).cards.map((r) => r.id);
    assert.deepEqual(col("stale"), ["c1"]);
    assert.deepEqual(col("live"), ["live1"]);
    assert.equal(cols.reduce((n, c) => n + c.cards.length, 0), 2, "every card is in exactly one column");
  });
  it("it says Past due with the date, only for Live and only once the date has passed", () => {
    assert.equal(pastDueWords(live, TODAY), "Past due · 22 Nov");
    assert.equal(pastDueWords({ ...live, due_on: "2025-12-30" }, TODAY), "Past due · 30 Dec 2025");
    assert.equal(pastDueWords({ ...live, due_on: TODAY }, TODAY), "");
    assert.equal(pastDueWords(stuck, TODAY), "");
  });
  it("the Live card renders the overdue-style Past due chip instead of Overdue", () => {
    const html = h.card({ record: live, def: HOSTS });
    assert.match(html, /data-past-due=""[^>]*color-error-50[^>]*>Past due · 22 Nov</);
    assert.doesNotMatch(html, />Overdue</);
    assert.match(html, /data-weight="urgent"/, "a past-due card stands forward");
  });
});

describe("P-1 one amber problem count replaces the red pills", () => {
  const bare = host({ owners: [], region_id: null, icp: "" });
  it("cardProblems lists what is wrong on hosts and nothing on creators", () => {
    assert.deepEqual(cardProblems(HOSTS, bare), ["No owner", "Missing type, region"]);
    assert.deepEqual(cardProblems(CREATORS, { ...bare, pipeline: "creators" }), []);
  });
  it("the card renders one count with the list in a hover tooltip, and no red pill", () => {
    const html = h.card({ record: bare, def: HOSTS }, { h1: { needs_next: false } });
    assert.match(html, /data-problem-count="2"[^>]*color-warning-50/);
    assert.match(html, /role="tooltip" data-problem-list=""[^>]*><b[^>]*>Needs attention<\/b>No owner · Missing type, region</);
    assert.doesNotMatch(html, /rounded-full bg-\[var\(--color-error-50\)\] px-2 py-px/, "no red reason pills");
    assert.match(html, /aria-label="Open Calabash Jazz Brunch, needs attention: No owner, Missing type, region"/);
  });
  it("a healthy card has no count", () => {
    assert.doesNotMatch(h.card({ record: host(), def: HOSTS }), /data-problem-count/);
  });
});

describe("O-1 several owners and watchers on the card", () => {
  it("three owners: two faces then +1, and the watcher eye with its count", () => {
    const html = h.card({ record: host({ owners: ["ada@usemingla.com", "rae@usemingla.com", "tomi@usemingla.com"], watchers: ["jon@usemingla.com", "rae@usemingla.com"] }), def: HOSTS });
    assert.match(html, /data-owner-faces="3"/);
    assert.match(html, /title="Owners: Ada, Rae, Tomi"/);
    assert.match(html, /data-more-owners=""[^>]*>\+1</);
    assert.match(html, /data-watchers="2" title="Watching: Jon, Rae"/);
  });
  it("no owner is a quiet dashed chip (the warning is the amber count)", () => {
    const html = h.card({ record: host({ owners: [] }), def: HOSTS });
    assert.match(html, /data-no-owner=""[^>]*border-dashed/);
  });
});

describe("C-1 card order, weight and the moves", () => {
  it("name, type · region, status, contacts and owners, next step and due, then touched and the move", () => {
    const html = h.card({ record: host({ due_on: "2026-11-30", next_action: "Send the menu deck", open_work: 2, last_touch: { at: new Date(Date.now() - 2 * 3600e3).toISOString(), actor_name: "Ada", channel: "phone" } }), def: HOSTS }, { h1: { needs_next: true } });
    const at = (re) => { const m = re.exec(html); assert.ok(m, String(re)); return m.index; };
    const order = [at(/>Calabash Jazz Brunch</), at(/>Supper club · Lagos</), at(/data-next-event="none"/), at(/data-quick-links=""/), at(/data-owner-faces/), at(/data-next-step=""[^>]*>Send the menu deck</), at(/Touched 2h ago · 2 open/), at(/aria-label="Move Calabash Jazz Brunch to Replied"/)];
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });
  it("nothing due and nothing wrong sits flat; due today stands forward", () => {
    assert.match(h.card({ record: host(), def: HOSTS }), /data-weight="quiet"/);
    assert.match(h.card({ record: host({ due_on: TODAY }), def: HOSTS }), /data-weight="urgent"/);
  });
  it("a stale card with no more urgent fact says where it is stuck (the stage tag)", () => {
    const html = h.card({ record: host({ due_on: "2026-11-01" }), def: HOSTS, stageTag: "Contacted" });
    assert.match(html, /data-stage-tag="contacted"[^>]*>[\s\S]*?Stuck in <b>Contacted<\/b>/);
  });
  it("the status line picks the most useful fact and never invents one", () => {
    assert.equal(cardStatus(HOSTS, host({ suggest_replied: { at: "x" } })).kind, "reply");
    assert.equal(cardStatus(HOSTS, host({ cadence: { round: 1, of: 6, steps: [] } })).words, "Round 1 of 6");
    assert.equal(cardStatus(HOSTS, host()), null);
  });
  it("a creator in Negotiating offers Mark signed until the agreement is signed, then the move", () => {
    const creator = { id: "c9", pipeline: "creators", name: "Night Bites Durham", stage: "negotiating", owners: ["ada@usemingla.com"], identifiers: [] };
    assert.match(h.card({ record: creator, def: CREATORS }), /data-sign-gate=""[\s\S]*?Mark signed/);
    const signed = h.card({ record: { ...creator, agreement: "signed" }, def: CREATORS });
    assert.doesNotMatch(signed, /data-sign-gate/);
    assert.match(signed, /aria-label="Move Night Bites Durham to Booked"/);
  });
  it("Mark signed opens the card on the agreement field", () => {
    assert.match(read("components/crm/RecordCard.jsx"), /onOpen\(record, \{ field: "agreement" \}\)/);
    assert.match(read("pages/PipelinePage.jsx"), /openCard\(record\.id, \{ field: opts\?\.field \|\| null \}\)/);
  });
});

function fakeOps(card, { fail = null } = {}) {
  const calls = [];
  return {
    calls,
    getWork: async (id) => { calls.push(["getWork", id]); return { card }; },
    updateWork: async (id, changes, revision) => { calls.push(["updateWork", id, changes, revision]); if (fail) throw fail; return { card: { ...card, links: changes.links, revision: revision + 1 } }; },
    removeLink: async (id, link, subs, revision) => { calls.push(["removeLink", id, link, subs, revision]); if (fail) throw fail; return { card }; },
  };
}
const REC = { id: "rec-1", pipeline: "hosts", name: "Lantern Supper Club" };

describe("W-1 link and unlink existing Work from the record panel", () => {
  it("link sends the card's links plus this record, with the card's revision", async () => {
    const ops = fakeOps({ id: "w1", number: 4877, status: "todo", revision: 7, links: [{ kind: "brand", id: "b1", label: "Lantern" }] });
    const res = await linkWorkToRecord(ops, "w1", REC);
    assert.equal(res.already, false);
    assert.deepEqual(ops.calls[1], ["updateWork", "w1", { links: [{ kind: "brand", id: "b1" }, { kind: "host", id: "rec-1" }] }, 7]);
  });
  it("a creator links as kind creator", async () => {
    assert.equal(recordLinkKind({ pipeline: "creators" }), "creator");
    const ops = fakeOps({ id: "w2", number: 4866, status: "doing", revision: 1, links: [] });
    await linkWorkToRecord(ops, "w2", { ...REC, pipeline: "creators" });
    assert.deepEqual(ops.calls[1][2], { links: [{ kind: "creator", id: "rec-1" }] });
  });
  it("an already linked card is not written again", async () => {
    const ops = fakeOps({ id: "w1", number: 1, status: "todo", revision: 1, links: [{ kind: "host", id: "rec-1" }] });
    assert.equal((await linkWorkToRecord(ops, "w1", REC)).already, true);
    assert.equal(ops.calls.length, 1);
  });
  it("a closed card and a 21st link are refused in words before any write", async () => {
    await assert.rejects(linkWorkToRecord(fakeOps({ id: "w", number: 5, status: "done", revision: 1, links: [] }), "w", REC), { token: "card_closed", message: /Card 5 is closed/ });
    const full = Array.from({ length: WORK_LINK_MAX }, (_, i) => ({ kind: "event", id: `e${i}` }));
    const ops = fakeOps({ id: "w", number: 6, status: "todo", revision: 1, links: full });
    await assert.rejects(linkWorkToRecord(ops, "w", REC), { token: "too_many_links", message: /already links 20 records/ });
    assert.equal(ops.calls.filter((c) => c[0] === "updateWork").length, 0);
  });
  it("the server's error (a stale revision) reaches the caller, which shows it", async () => {
    const stale = Object.assign(new Error("This card changed. Showing the latest."), { token: "stale_write" });
    await assert.rejects(linkWorkToRecord(fakeOps({ id: "w", number: 8, status: "todo", revision: 2, links: [] }, { fail: stale }), "w", REC), { token: "stale_write" });
    await assert.rejects(unlinkWorkFromRecord(fakeOps({ id: "w", number: 8, status: "todo", revision: 2, links: [{ kind: "host", id: "rec-1" }] }, { fail: stale }), "w", REC), { token: "stale_write" });
    const section = read("components/crm/HostToDoSection.jsx");
    assert.match(section, /catch \(error\) \{\n\s+addToast\(\{ variant: "error", title: `Card \$\{pick\.number \?\? ""\} not linked`, description: opsErrorWords\(error\) \}\);/);
    assert.match(section, /catch \(error\) \{\n\s+addToast\(\{ variant: "error", title: `Card \$\{card\.number \?\? ""\} not unlinked`, description: opsErrorWords\(error\) \}\);/);
  });
  it("unlink removes this record's link with the card's revision; a brand-only reach is refused in words", async () => {
    const ops = fakeOps({ id: "w1", number: 4877, status: "todo", revision: 9, links: [{ kind: "host", id: "rec-1" }] });
    await unlinkWorkFromRecord(ops, "w1", REC);
    assert.deepEqual(ops.calls[1], ["removeLink", "w1", { kind: "host", id: "rec-1" }, false, 9]);
    await assert.rejects(unlinkWorkFromRecord(fakeOps({ id: "w", number: 3, status: "todo", revision: 1, links: [] }), "w", REC), { token: "not_linked" });
    await assert.rejects(unlinkWorkFromRecord(fakeOps({ id: "w", number: 3, status: "done", revision: 1, links: [{ kind: "host", id: "rec-1" }] }), "w", REC), { token: "card_closed" });
  });
  it("the picker shows only open cards not already here, with number, title, status and owners", () => {
    const rows = workPickerRows(
      [{ id: "a", label: "Chase contract", sub: "Card 10" }, { id: "b", label: "Closed one", sub: "Card 11" }, { id: "c", label: "Already", sub: "Card 12" }],
      [{ id: "a", number: 10, title: "Chase contract", status: "doing", owners: [{ name: "Ada" }], due_on: "2026-11-30" }, { id: "c", number: 12, title: "Already", status: "todo", owners: [] }],
      ["c"],
    );
    assert.deepEqual(rows, [{ id: "a", number: 10, title: "Chase contract", status: "doing", owners: [{ name: "Ada" }], due_on: "2026-11-30" }]);
    const section = read("components/crm/HostToDoSection.jsx");
    assert.match(section, /ops\.searchLinks\("card", query\)/, "the picker searches with ops_link_search('card', q)");
    assert.match(section, />Link existing work</);
    assert.match(section, /data-unlink-work=\{card\.id\}/);
  });
  it("the card's open count follows a link or unlink at once", () => {
    assert.equal(openWorkCount([{ status: "todo" }, { status: "done" }, { status: "doing" }]), 2);
    const panel = read("components/crm/RecordPanel.jsx");
    assert.match(panel, /applyRecord\(\{ \.\.\.record, open_work: openNow \}\)/);
    assert.match(panel, /onLinksChanged=\{\(\) => \{ work\.retry\(\);/);
  });
  it("no new RPC: the linking uses the Work card's own person-facing functions", () => {
    const lib = read("lib/recordWorkLinks.js");
    assert.doesNotMatch(lib, /supabase\.rpc/);
    assert.match(lib, /ops\.updateWork\(card\.id, \{ links: next \}, card\.revision\)/);
    assert.match(lib, /ops\.removeLink\(card\.id, \{ kind, id: record\.id \}, false, card\.revision\)/);
  });
});

describe("S-1 the Work card opens over the record and goes back", () => {
  it("with `over`, panel two covers panel one (kept mounted, hidden) and offers Back to the record", () => {
    const html = h.stack({ over: true, title: "Lantern Supper Club" });
    assert.match(html, /data-panel-stack="covered"/);
    assert.match(html, /data-panel-slot="1" aria-hidden="true" class="[^"]*hidden/);
    assert.match(html, /data-record=""/, "the record panel stays mounted, so nothing typed is lost");
    assert.match(html, /data-panel-back=""[\s\S]*?Back to Lantern Supper Club/);
  });
  it("without it, the panels sit side by side as on other pages", () => {
    assert.match(h.stack({ over: false }), /data-panel-stack="side-by-side"/);
  });
  it("the Hosts page stacks a Work card over the record and Back closes it", () => {
    const page = read("pages/PipelinePage.jsx");
    assert.match(page, /over=\{stack\.side\?\.kind === "card" \|\| stack\.side\?\.kind === "thread"\}/);
    assert.match(page, /firstTitle=\{openRecordInList\?\.name \|\| ""\}/);
    assert.match(read("components/ui/PanelStack.jsx"), /\{ label: `Back to \$\{titles\[1\] \|\| firstTitle \|\| "the first panel"\}`, onClick: stack\.closeSide \}/);
  });
  it("a host or creator linked on the Work card opens here, or switches tab", () => {
    const H = "11111111-1111-4111-8111-111111111111", C = "22222222-2222-4222-8222-222222222222", W = "33333333-3333-4333-8333-333333333333";
    assert.deepEqual(recordSideRoute({ kind: "host", id: H }, "hosts"), { kind: "here", id: H });
    assert.deepEqual(recordSideRoute({ kind: "creator", id: C }, "hosts"), { kind: "tab", hash: `#/outreach?tab=creators&card=${C}` });
    assert.deepEqual(recordSideRoute({ kind: "host", id: H }, "creators"), { kind: "tab", hash: `#/outreach?tab=hosts&card=${H}` });
    assert.deepEqual(recordSideRoute({ kind: "card", id: W }, "hosts"), { kind: "side" });
    assert.deepEqual(recordSideRoute({ kind: "host", id: "not-an-id" }, "hosts"), { kind: "side" }, "a malformed id is never routed");
    assert.match(read("pages/PipelinePage.jsx"), /<PanelLinksContext\.Provider value=\{recordLinks\}>/);
  });
});

describe("R-1 the most urgent status wins", () => {
  it("reply waiting > stuck (past its date) > demo cancelled > next demo > next event > demo lock > round", () => {
    const all = { suggest_replied: { at: "x" }, demo_gate: { locked: true, demo_cancelled: true }, next_demo: { call_at: "2026-11-25T10:00:00Z" }, cadence: { round: 2, of: 6, steps: [] } };
    const opts = { stageTag: "Contacted", hostRow: { needs_next: true } };
    const no = (o) => cardStatus(HOSTS, host({ ...all, ...o }), opts).kind;
    assert.equal(no({}), "reply");
    assert.equal(no({ suggest_replied: null }), "stale");
    assert.equal(cardStatus(HOSTS, host({ ...all, suggest_replied: null }), { hostRow: opts.hostRow }).kind, "cancelled");
    const rest = { suggest_replied: null, demo_gate: { locked: true } };
    assert.equal(cardStatus(HOSTS, host({ ...all, ...rest }), { hostRow: opts.hostRow }).kind, "demo");
    assert.equal(cardStatus(HOSTS, host({ ...all, ...rest, next_demo: null }), { hostRow: opts.hostRow }).kind, "event");
    assert.equal(cardStatus(HOSTS, host({ ...all, ...rest, next_demo: null })).kind, "lock");
    assert.equal(cardStatus(HOSTS, host({ cadence: all.cadence })).kind, "round");
  });
  it("a stale card with a reply waiting shows the reply, not Stuck in", () => {
    const html = h.card({ record: host({ due_on: "2026-11-01", suggest_replied: { at: "x" } }), def: HOSTS, stageTag: "Contacted" });
    assert.match(html, /data-tile-replied=""[^>]*>[\s\S]*?Replied by email\? Open to move it\./);
    assert.doesNotMatch(html, /Stuck in/);
  });
  it("a Prospect host past its date with no demo says Stuck in Prospect · past its date, even when locked", () => {
    const html = h.card({ record: host({ stage: "prospect", due_on: "2026-11-01", demo_gate: { locked: true } }), def: HOSTS, stageTag: "Prospect" });
    assert.match(html, /data-stage-tag="prospect"[^>]*>[\s\S]*?Stuck in <b>Prospect<\/b> · past its date/);
    assert.doesNotMatch(html, /data-demo-lock/);
  });
  it("a lock-only card still shows the lock", () => {
    const html = h.card({ record: host({ stage: "replied", demo_gate: { locked: true } }), def: HOSTS });
    assert.match(html, /data-demo-lock=""[^>]*>[\s\S]*?Demo booked locked/);
  });
});

describe("J-1 the panel's section jump links", () => {
  it("hosts get their sections in body order; Needs attention only when it shows", () => {
    assert.deepEqual(jumpSections({ isHosts: true, hasAttention: true }).map((j) => j.label),
      ["Needs attention", "Follow-up", "Contacts", "Work", "Demos", "Calls", "Plan", "On Mingla", "Team", "Details", "Activity"]);
    assert.equal(jumpSections({ isHosts: true, hasAttention: false })[0].key, "followup");
  });
  it("creators get Deal and Handle and reach, and no host-only sections", () => {
    assert.deepEqual(jumpSections({ isHosts: false, hasAttention: false }).map((j) => j.label),
      ["Follow-up", "Deal", "Handle and reach", "Work", "Calls", "Details", "Activity"]);
  });
  it("the active link is the last section that reached the top; the last one at the bottom", () => {
    const offsets = [{ key: "followup", top: -300 }, { key: "contacts", top: -20 }, { key: "work", top: 140 }];
    assert.equal(activeJump(offsets), "contacts");
    assert.equal(activeJump([{ key: "followup", top: 10 }, { key: "work", top: 400 }]), "followup");
    assert.equal(activeJump(offsets, { atBottom: true }), "work");
    assert.equal(activeJump([]), "");
  });
  it("every link has a target in the panel body, and they are keyboard buttons that scroll and focus", () => {
    const panel = read("components/crm/RecordPanel.jsx");
    for (const j of jumpSections({ isHosts: true, hasAttention: true }).concat(jumpSections({ isHosts: false, hasAttention: false }))) {
      assert.match(panel, new RegExp(`data-jump="${j.key}"`), j.key);
    }
    assert.match(panel, /<nav aria-label="Sections" data-jump-links=""/);
    assert.match(panel, /<button key=\{j\.key\} type="button" data-jump-link=\{j\.key\} aria-current=\{activeSection === j\.key \? "true" : undefined\} onClick=\{\(\) => jumpTo\(j\.key\)\}/);
    assert.match(panel, /el\.scrollIntoView\?\.\(\{ block: "start", behavior: "smooth" \}\);/);
    assert.match(panel, /el\.focus\?\.\(\{ preventScroll: true \}\);/);
    assert.match(panel, /box\.addEventListener\("scroll", onScroll, \{ passive: true \}\);/);
  });
});
