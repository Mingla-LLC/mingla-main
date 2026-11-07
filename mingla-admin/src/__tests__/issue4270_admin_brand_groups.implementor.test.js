// Issue #4270 (Wave 7) — implementor happy path for Admin › Community › Brand
// groups, the premium staff view.
//
//   A  the pure model (lib/brandGroupInbox.js): waiting words (with the 14d+
//      cap), filters and their order, the default filter, previews, the
//      folded thread with day dividers, plan line titles and matching, the
//      activity words, quick replies, Seen by, typing, reactions, the Add to
//      plan prefill and Try again's "did it land?"
//   B  the side panel contract (lib/panelStack.js): the brand kind, the
//      Brand-group-only calendar kind, the view and the address, closing
//   C  the services call the new reads, #4304's read state and reactions,
//      and the media list (with the thumbnail variant)
//   D  rendered: a list row (waiting, next, unread, muted, its label), the
//      strip, the plan activity card, the side panel's trail, the rail's
//      tabs, the no-host-card state, the thread's actions
//   E  source contracts: nothing navigates away; Esc waits for a dialog; the
//      panel's links come back through PanelLinksContext
//
// Run: node --test src/__tests__/issue4270_admin_brand_groups.implementor.test.js
// (from mingla-admin; D builds the real components with esbuild: run `npm ci`
// first, without it the test FAILS, it never skips).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  INBOX_FILTERS,
  REACTION_EMOJI,
  applyInboxFilter,
  dayDividerLabel,
  defaultInboxFilter,
  foldThread,
  inboxSummary,
  inboxSummaryWords,
  matchPlanLine,
  mergeInbox,
  nextPlanWords,
  planActivityWords,
  planLineTitle,
  planPrefillFromMessages,
  previewWords,
  quickReplies,
  reactionToggle,
  seenByWords,
  sendFailureWords,
  sendLanded,
  summariseReactions,
  typingWords,
  waitingWords,
} from "../lib/brandGroupInbox.js";
import {
  BRAND_GROUP_SIDE_KINDS,
  SIDE_KINDS,
  brandGroupSearch,
  brandGroupView,
  parseSide,
  sideCloseStep,
  sideHref,
} from "../lib/panelStack.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(fs.readFileSync(path.join(SRC, rel), "utf8"));

const NOW = new Date(2026, 10, 7, 18, 0, 0).getTime(); // Sat 7 Nov 2026, 18:00 local
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const U1 = "11111111-2222-4333-8444-555555555555";
const U2 = "21111111-2222-4333-8444-555555555555";

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
import { BrandGroupRow, BrandGroupList } from "../components/community/BrandGroupList.jsx";
import { BrandGroupStrip } from "../components/community/BrandGroupStrip.jsx";
import { PlanActivityCard } from "../components/community/PlanActivityCard.jsx";
import { BrandGroupSidePanel } from "../components/community/BrandGroupSidePanel.jsx";
import { BrandGroupRail } from "../components/community/BrandGroupRail.jsx";
import { BrandGroupThread } from "../components/community/BrandGroupThread.jsx";
import { BrandGroupHeader } from "../components/community/BrandGroupHeader.jsx";
import { BrandGroupComposer } from "../components/community/BrandGroupComposer.jsx";
import { HostCardEmptyState } from "../components/community/HostCardEmptyState.jsx";
import { ToastProvider } from "../context/ToastContext.jsx";
const html = (el) => renderToStaticMarkup(el);
export const row = (p) => html(<BrandGroupRow onOpen={() => {}} {...p} />);
export const list = (p) => html(<BrandGroupList onFilter={() => {}} onQuery={() => {}} onOpen={() => {}} {...p} />);
export const strip = (p) => html(<BrandGroupStrip onShowList={() => {}} onOpen={() => {}} {...p} />);
export const planCard = (p) => html(<PlanActivityCard {...p} />);
export const sidePanel = (p) => html(<BrandGroupSidePanel onClose={() => {}} onOpenInside={() => {}} onBackToChat={() => {}} {...p} />);
export const rail = (p) => html(<BrandGroupRail onTab={() => {}} openFresh={() => {}} onPreview={() => {}} people={[]} staff={[]} {...p} />);
export const thread = (p) => html(<BrandGroupThread roleWordsFor={() => ""} onReact={() => {}} onReply={() => {}} onAddToPlan={() => {}} onToggleSelect={() => {}} onSignal={() => {}} onCopy={() => {}} onPreview={() => {}} onRetrySend={() => {}} onDeleteSend={() => {}} {...p} />);
export const header = (p) => html(<BrandGroupHeader onToggleMute={() => {}} {...p} />);
export const composer = (p) => html(<BrandGroupComposer onChange={() => {}} onSend={() => {}} onChip={() => {}} {...p} />);
export const empty = (p) => html(<ToastProvider><HostCardEmptyState {...p} /></ToastProvider>);`,
      resolveDir: HERE, sourcefile: "issue4270.w7.harness.jsx", loader: "jsx",
    },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    loader: { ".js": "jsx" },
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url); if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = class { constructor() { throw new Error("issue4270 W7 render test: no network"); } };' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"VITE_SUPABASE_URL":"https://x.supabase.test","VITE_SUPABASE_ANON_KEY":"test"}' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4270-w7-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  harness = await import(pathToFileURL(file).href);
});

const planLine = (id, content, at) => ({ id, conversation_id: "c1", sender_id: null, message_type: "system", content, created_at: at });
const text = (id, sender, content, at, extra = {}) => ({ id, conversation_id: "c1", sender_id: sender, message_type: "text", content, created_at: at, sender_display_name: "Ada Obi", ...extra });

describe("A the pure model", () => {
  it("waiting words: minutes, hours and minutes, days and hours, capped at 14d+", () => {
    assert.equal(waitingWords(ago(59_000), NOW), "1m");
    assert.equal(waitingWords(ago(12 * MIN), NOW), "12m");
    assert.equal(waitingWords(ago(2 * HOUR + 14 * MIN), NOW), "2h 14m");
    assert.equal(waitingWords(ago(3 * DAY + 4 * HOUR), NOW), "3d 4h");
    assert.equal(waitingWords(ago(15 * DAY), NOW), "14d+");
    assert.equal(waitingWords(null, NOW), "");
  });
  const groups = [
    { conversation_id: "a", brand_name: "Harmattan Club", last_message_preview: "Seth added", member_count: 1 },
    { conversation_id: "b", brand_name: "Lantern Room", last_message_preview: "Can someone check our ticket link?", member_count: 2 },
    { conversation_id: "c", brand_name: "SSNS", last_message_preview: "Hi there", member_count: 3 },
  ];
  const inbox = [
    { conversation_id: "a", waiting_since: null, host: { record_id: "r1", name: "Harmattan Host", mine: true, plan: { next: { kind: "post", id: "p1", title: "Doors open tonight", on: "2026-11-08" }, this_week: 2 } } },
    { conversation_id: "b", waiting_since: ago(2 * HOUR + 14 * MIN), host: { record_id: "r2", name: "Lantern", mine: false, plan: { next: null, this_week: 0 } } },
    { conversation_id: "c", waiting_since: ago(48 * MIN), host: null },
  ];
  it("filters: Needs reply is oldest wait first; Mine; Plan this week; All keeps the order; search covers brand, host and message", () => {
    assert.deepEqual(INBOX_FILTERS, ["needs_reply", "mine", "plan_week", "all"]);
    const rows = mergeInbox(groups, inbox);
    assert.deepEqual(applyInboxFilter(rows, "needs_reply").map((r) => r.conversation_id), ["b", "c"]);
    assert.deepEqual(applyInboxFilter(rows, "mine").map((r) => r.conversation_id), ["a"]);
    assert.deepEqual(applyInboxFilter(rows, "plan_week").map((r) => r.conversation_id), ["a"]);
    assert.deepEqual(applyInboxFilter(rows, "all").map((r) => r.conversation_id), ["a", "b", "c"]);
    assert.deepEqual(applyInboxFilter(rows, "all", "  LANTERN ").map((r) => r.conversation_id), ["b"]);
    assert.deepEqual(applyInboxFilter(rows, "all", "harmattan host").map((r) => r.conversation_id), ["a"]);
    assert.deepEqual(applyInboxFilter(rows, "all", "ticket link").map((r) => r.conversation_id), ["b"]);
  });
  it("the default filter is Needs reply only when someone waits; the summary line", () => {
    const rows = mergeInbox(groups, inbox);
    assert.equal(defaultInboxFilter(rows), "needs_reply");
    assert.equal(defaultInboxFilter(mergeInbox(groups, [])), "all");
    const summary = inboxSummary(rows, NOW);
    assert.deepEqual(summary, { waiting: 2, oldest: "2h 14m" });
    assert.equal(inboxSummaryWords(summary), "2 groups waiting on Mingla · oldest 2h 14m");
    assert.equal(inboxSummaryWords({ waiting: 0, oldest: "" }), "");
  });
  it("a light refresh (plan not read) keeps the last plan", () => {
    const light = [{ conversation_id: "a", waiting_since: null, host: { record_id: "r1", name: "Harmattan Host", mine: true, plan: null } }];
    const rows = mergeInbox(groups.slice(0, 1), light, { a: { next: null, this_week: 4 } });
    assert.equal(rows[0].host.plan.this_week, 4);
  });
  it("previews: You, a first name, Photo, a quiet line, the team size", () => {
    assert.equal(previewWords({ last_message_preview: "Hello", last_message_sender_id: U1, last_message_type: "text" }, U1), "You: Hello");
    assert.equal(previewWords({ last_message_preview: "Hello", last_message_sender_id: U2, last_message_sender_name: "Ada Obi", last_message_type: "text" }, U1), "Ada: Hello");
    assert.equal(previewWords({ last_message_preview: "x.jpg", last_message_sender_id: U2, last_message_sender_name: "Ada", last_message_type: "image" }, U1), "Ada: Photo");
    assert.equal(previewWords({ last_message_preview: "", last_message_sender_id: U1, last_message_type: "video" }, U1), "You: Video");
    assert.equal(previewWords({ last_message_preview: "Seth added “X” to the plan for Sat 7 Nov.", last_message_sender_id: null, last_message_type: "system" }, U1), "Seth added “X” to the plan for Sat 7 Nov.");
    assert.equal(previewWords({ last_message_preview: "", member_count: 1 }, U1), "1 teammate");
    assert.equal(previewWords({ last_message_preview: "", member_count: 4 }, U1), "4 teammates");
  });
  it("next plan words: weekday and title, at most 40 characters", () => {
    assert.equal(nextPlanWords({ next: { on: "2026-11-08", title: "Doors open tonight" } }), "Sun · Doors open tonight");
    const long = nextPlanWords({ next: { on: "2026-11-13", title: "Announce the next Sunday Rooftop Sessions date with tickets" } });
    assert.ok(long.length <= 40, long);
    assert.ok(long.startsWith("Fri · Announce") && long.endsWith("…"));
    assert.equal(nextPlanWords(null), "");
  });
  it("day dividers and the folded thread: two runs of plan lines stay two cards", () => {
    const now = new Date(NOW);
    assert.equal(dayDividerLabel(new Date(2026, 10, 7, 9).toISOString(), now), "Today");
    assert.equal(dayDividerLabel(new Date(2026, 10, 6, 9).toISOString(), now), "Yesterday");
    assert.equal(dayDividerLabel(new Date(2026, 9, 21, 9).toISOString(), now), "Wed 21 Oct");
    assert.equal(dayDividerLabel(new Date(2025, 9, 21, 9).toISOString(), now), "Tue 21 Oct 2025");
    const t = (h) => new Date(2026, 10, 7, h).toISOString();
    const entries = foldThread([
      text("m1", U2, "Get this", new Date(2026, 9, 21, 14, 18).toISOString()),
      planLine("p1", "Seth added “A” to the plan for Sat 7 Nov.", t(10)),
      planLine("p2", "Seth added “B” to the plan for Sun 8 Nov.", t(10)),
      text("m2", U1, "On it", t(11)),
      planLine("p3", "Seth moved “A” to Mon 9 Nov.", t(12)),
    ], now);
    assert.deepEqual(entries.map((e) => (e.type === "day" ? `day:${e.label}` : e.type === "plan" ? `plan:${e.lines.map((l) => l.id).join("+")}` : `msg:${e.message.id}`)),
      ["day:Wed 21 Oct", "msg:m1", "day:Today", "plan:p1+p2", "msg:m2", "plan:p3"]);
  });
  it("plan line titles: add, move, rename (the new title), link, remove", () => {
    assert.equal(planLineTitle("Seth added “Lineup reveal” to the plan for Sat 7 Nov."), "Lineup reveal");
    assert.equal(planLineTitle("Seth moved “Lineup reveal” to Sun 8 Nov."), "Lineup reveal");
    assert.equal(planLineTitle("Seth renamed “Old menu” to “Menu reveal”."), "Menu reveal");
    assert.equal(planLineTitle("Seth added a link to “Menu reveal”."), "Menu reveal");
    assert.equal(planLineTitle("Ada removed “Menu reveal” from the plan."), "Menu reveal");
    assert.equal(planLineTitle("No quotes here"), "");
  });
  it("matching a line to a plan item, with the brand tail and a count; only posts and tasks", () => {
    const items = [
      { kind: "post", id: "p1", title: "Lineup reveal · Harmattan Club", on: "2026-11-07" },
      { kind: "task", id: "t1", title: "Book a photographer (2)", on: "2026-11-12" },
      { kind: "post", id: "p2", title: "R5 same words · Harmattan Club (2)", on: "2026-11-09" },
      { kind: "event", id: "e1", title: "Sunday Rooftop", on: "2026-11-08" },
    ];
    assert.equal(matchPlanLine("Seth added “Lineup  Reveal” to the plan for Sat 7 Nov.", items, "Harmattan Club")?.id, "p1");
    assert.equal(matchPlanLine("Seth added “Book a photographer” to the plan for Thu 12 Nov.", items, "Harmattan Club")?.id, "t1");
    assert.equal(matchPlanLine("Ada added “R5 same words” to the plan for Mon 9 Nov.", items, "Harmattan Club")?.id, "p2");
    assert.equal(matchPlanLine("Seth added “Sunday Rooftop” to the plan for Sun 8 Nov.", items, "Harmattan Club"), null, "events are never matched");
    assert.equal(matchPlanLine("Seth removed “Gone” from the plan.", items, "Harmattan Club"), null);
  });
  it("activity words", () => {
    const adds = ["A", "B", "C", "D", "E"].map((x, i) => planLine(`p${i}`, `Seth added “${x}” to the plan for Sat 7 Nov.`, ago(MIN)));
    assert.equal(planActivityWords(adds), "Seth added 5 items to the plan");
    assert.equal(planActivityWords(adds.slice(0, 1)), "Seth added 1 item to the plan");
    assert.equal(planActivityWords([adds[0], planLine("x", "Ada added “Z” to the plan for Sun 8 Nov.", ago(MIN)), adds[1]]), "3 plan updates");
    assert.equal(planActivityWords([planLine("r", "Seth renamed “A” to “B”.", ago(MIN))]), "1 plan update");
  });
  it("quick replies fill the composer: with and without an event", () => {
    const chips = quickReplies({
      weekItems: [{ kind: "post", title: "Doors open tonight", on: "2026-11-08" }, { kind: "task", title: "Book a photographer", on: "2026-11-08" }],
      nextEvent: { title: "Sunday Rooftop Sessions", on: "2026-11-08" },
      brandName: "Harmattan Club",
    });
    assert.deepEqual(chips.map((c) => c.label), ["Share this week's plan", "Ask for event photos", "Promote Sunday Rooftop Sessions"]);
    assert.equal(chips[0].text, "This week's plan for Harmattan Club:\n• Sun 8 Nov · Post · Doors open tonight\n• Sun 8 Nov · Task · Book a photographer");
    assert.equal(chips[1].text, "Could you send us 3 to 5 photos or short clips from your last event? We'll use them for your next posts.");
    assert.equal(chips[2].text, "Let's promote Sunday Rooftop Sessions on Sun 8 Nov. What would you like us to highlight?");
    assert.deepEqual(quickReplies({ weekItems: [], nextEvent: null, brandName: "X" }).map((c) => c.label), ["Ask for event photos"]);
  });
  it("Seen by, with +N; typing words", () => {
    const message = { created_at: ago(10 * MIN) };
    const reads = [
      { display_name: "Ada Obi", last_read_at: ago(MIN) },
      { display_name: "Kim", last_read_at: ago(2 * MIN) },
      { display_name: "Tunde", last_read_at: ago(3 * MIN) },
      { display_name: "Old", last_read_at: ago(HOUR) },
    ];
    assert.equal(seenByWords(reads.slice(0, 1), message), "Seen by Ada");
    assert.equal(seenByWords(reads.slice(0, 2), message), "Seen by Ada, Kim");
    assert.equal(seenByWords(reads, message), "Seen by Ada, Kim +1");
    assert.equal(seenByWords(reads.slice(3), message), "");
    assert.equal(typingWords(["info"]), "info is typing…");
    assert.equal(typingWords(["info", "Kim Ade"]), "info and Kim are typing…");
    assert.equal(typingWords(["a", "b", "c"]), "3 people are typing…");
    assert.equal(typingWords([]), null);
  });
  it("reactions: the six emoji, pills in order, mine marked, the toggle", () => {
    assert.deepEqual(REACTION_EMOJI, ["❤️", "👍", "😂", "😮", "😢", "🔥"]);
    const rows = [
      { id: "r1", message_id: "m1", user_id: U2, emoji: "🔥" },
      { id: "r2", message_id: "m1", user_id: U1, emoji: "👍" },
      { id: "r3", message_id: "m1", user_id: U2, emoji: "👍" },
    ];
    assert.deepEqual(summariseReactions(rows, U1).get("m1"), [{ emoji: "👍", count: 2, mine: true }, { emoji: "🔥", count: 1, mine: false }]);
    assert.deepEqual(reactionToggle(rows, "m1", "👍", U1), { action: "remove", rowId: "r2" });
    assert.deepEqual(reactionToggle(rows, "m1", "🔥", U1), { action: "add" });
  });
  it("Add to plan from selected messages; Try again checks before sending", () => {
    const long = `${"word ".repeat(40)}end`;
    const prefill = planPrefillFromMessages([text("m1", U2, `Could you help us\npush the Sunday rooftop?`, ago(MIN)), text("m2", U2, long, ago(MIN), { sender_display_name: "Kim" })]);
    assert.equal(prefill.title, "Could you help us push the Sunday rooftop?");
    assert.ok(prefill.note.startsWith("From the Brand group: Ada Obi: Could you help us push the Sunday rooftop? · Kim: word"));
    assert.ok(prefill.note.length <= 500);
    assert.ok(planPrefillFromMessages([text("m3", U2, long, ago(MIN))]).title.length <= 160);
    const sent = { content: "Also sharing the dress code", at: NOW };
    assert.equal(sendLanded([text("x", U1, "Also sharing the dress code", new Date(NOW - 2000).toISOString())], sent, U1), true);
    assert.equal(sendLanded([text("x", U1, "Also sharing the dress code", new Date(NOW - 60_000).toISOString())], sent, U1), false);
    assert.equal(sendLanded([text("x", U2, "Also sharing the dress code", new Date(NOW).toISOString())], sent, U1), false);
    assert.equal(sendFailureWords(new TypeError("Failed to fetch")), "Not sent: connection lost");
    assert.equal(sendFailureWords(new Error("conversation_unavailable")), "Not sent: conversation_unavailable");
  });
});

describe("B the side panel contract", () => {
  it("a brand opens beside on every panel page; the calendar only in a Brand group", () => {
    assert.ok(SIDE_KINDS.includes("brand"));
    assert.ok(!SIDE_KINDS.includes("calendar"));
    assert.deepEqual(BRAND_GROUP_SIDE_KINDS, [...SIDE_KINDS, "calendar"]);
    assert.equal(sideHref({ kind: "brand", id: U1 }), `#/brands?brandId=${U1}`);
    assert.equal(parseSide(`side=calendar:${U1}`), null, "the Work page refuses a calendar");
    assert.deepEqual(parseSide(`side=calendar:${U1}`, BRAND_GROUP_SIDE_KINDS), { kind: "calendar", id: U1 });
    assert.equal(parseSide("side=brand:../../x", BRAND_GROUP_SIDE_KINDS), null);
  });
  it("the view names the group, the side and the rail tab; host stays the host card", () => {
    assert.deepEqual(brandGroupView(`tab=brand-groups&group=g1&side=content:${U1}&rail=media`),
      { group: "g1", brand: "", host: "", side: { kind: "content", id: U1 }, rail: "media" });
    assert.equal(brandGroupView(`tab=brand-groups&side=host:${U1}`).host, U1);
    assert.equal(brandGroupView("tab=brand-groups&rail=elsewhere").rail, "");
  });
  it("the address: side set and cleared, rail kept, the host patch still works", () => {
    const open = brandGroupSearch("tab=brand-groups&group=g1", { side: { kind: "calendar", id: U1 }, rail: "plan" });
    assert.equal(new URLSearchParams(open).get("side"), `calendar:${U1}`);
    assert.equal(new URLSearchParams(open).get("rail"), "plan");
    assert.equal(new URLSearchParams(brandGroupSearch(open, { side: null })).get("side"), null);
    assert.equal(new URLSearchParams(brandGroupSearch(open, { host: U2 })).get("side"), `host:${U2}`);
  });
  it("closing walks back what this page pushed, else pushes (never a replace)", () => {
    assert.deepEqual(sideCloseStep(1), { kind: "go", delta: -1 });
    assert.deepEqual(sideCloseStep(3), { kind: "go", delta: -3 });
    assert.deepEqual(sideCloseStep(0), { kind: "push" });
  });
});

describe("C the services", () => {
  const svc = code("services/communityService.js");
  it("call the inbox, the people list, #4304's read state, reactions and media", () => {
    assert.match(svc, /rpc\("issue_4270_brand_group_inbox", \{\s*p_today: todayIso\(\),\s*p_with_plan: withPlan,\s*\}\)/);
    assert.match(svc, /rpc\("issue_4270_brand_group_people", \{\s*p_conversation_id: conversationId,\s*\}\)/);
    assert.match(svc, /rpc\("issue_4304_list_brand_group_read_state"/);
    assert.match(svc, /rpc\("issue_3988_list_brand_group_media", \{[\s\S]*?p_kind: kind === "files" \? "files" : "media"[\s\S]*?p_limit: 60/);
    assert.match(svc, /from\("direct_message_reactions"\)[\s\S]*?\.insert\(\{ message_id: messageId, user_id: userId, emoji \}\)/);
    assert.match(svc, /throw new Error\("That reaction was already removed\."\)/);
    assert.match(svc, /const variant = thumb \? "&variant=thumb" : "";/);
  });
});

describe("D rendered", () => {
  const group = {
    conversation_id: "c1", brand_name: "Harmattan Club", unread_count: 2, member_count: 1, muted: false,
    last_message_at: ago(10 * MIN), last_message_preview: "Can someone check our ticket link?", last_message_sender_id: U2, last_message_sender_name: "Ada",
    waiting_since: ago(2 * HOUR + 14 * MIN), host: { plan: { next: { on: "2026-11-08", title: "Doors open tonight" }, this_week: 1 } },
  };
  it("a row: waiting, next, unread, and its label", () => {
    const html = harness.row({ group, selected: true, myUserId: U1, nowMs: NOW });
    assert.match(html, /aria-label="Harmattan Club, waiting 2h 14m, 2 unread, next Sun Doors open tonight"/);
    assert.match(html, /aria-current="true"/);
    assert.match(html, /data-waiting=""[^>]*>Waiting 2h 14m</);
    assert.match(html, /data-next-plan=""[^>]*>Next: Sun · Doors open tonight</);
    assert.match(html, /data-unread=""[^>]*bg-\[var\(--color-brand-500\)\][^>]*>2</);
    assert.match(html, />Ada: Can someone check our ticket link\?</);
  });
  it("a muted row: Muted · no staff push and a grey badge", () => {
    const html = harness.row({ group: { ...group, muted: true }, nowMs: NOW });
    assert.match(html, /data-muted-row=""[^>]*>Muted · no staff push</);
    assert.match(html, /data-unread=""[^>]*bg-\[var\(--gray-500\)\]/);
  });
  it("the list: filters with counts (Mine and Plan this week only with Hosts access), empty Needs reply", () => {
    const withHosts = harness.list({ rows: [group], all: [group], filter: "needs_reply", query: "", canHosts: true, waitingCount: 3, nowMs: NOW });
    assert.match(withHosts, /aria-pressed="true"[^>]*>Needs reply · 3</);
    assert.match(withHosts, />Mine</);
    assert.match(withHosts, />Plan this week</);
    assert.match(withHosts, /<span class="sr-only">Search brand groups<\/span>/);
    assert.match(withHosts, /placeholder="Search brands, hosts, messages"/);
    const support = harness.list({ rows: [], all: [group, { ...group, conversation_id: "c2" }], filter: "needs_reply", query: "", canHosts: false, waitingCount: 0, nowMs: NOW });
    assert.doesNotMatch(support, />Mine</);
    assert.doesNotMatch(support, />Plan this week</);
    assert.match(support, /No brand is waiting on Mingla/);
    assert.match(support, /Every host message has a staff reply\./);
    assert.match(support, />Show all 2 groups</);
    const loading = harness.list({ rows: [], all: [], loading: true, filter: "all", query: "", nowMs: NOW });
    assert.equal((loading.match(/<li class="flex gap-3/g) || []).length, 8, "8 skeleton rows");
  });
  it("the strip: show the list, then one button per group", () => {
    const html = harness.strip({ groups: [group], selectedId: "c1" });
    assert.match(html, /aria-label="Show the full group list"/);
    assert.match(html, /aria-label="Open Harmattan Club Brand group, 2 unread"[^>]*aria-current="true"/);
  });
  it("plan activity: matched lines are buttons, an unmatched line is plain text", () => {
    const items = [{ kind: "post", id: U1, title: "Lineup reveal · Harmattan Club", on: "2026-11-07" }];
    const html = harness.planCard({
      lines: [planLine("p1", "Seth added “Lineup reveal” to the plan for Sat 7 Nov.", ago(MIN)), planLine("p2", "Seth added “Gone” to the plan for Sun 8 Nov.", ago(MIN))],
      items, brandName: "Harmattan Club", onOpen: () => {},
    });
    assert.match(html, />Seth added 2 items to the plan</);
    assert.match(html, new RegExp(`<button type="button" data-plan-line="post:${U1}"[\\s\\S]*?Sat 7 Nov[\\s\\S]*?Post[\\s\\S]*?Lineup reveal · Harmattan Club`));
    assert.match(html, /<p data-system-line=""[^>]*>Seth added “Gone” to the plan for Sun 8 Nov\.<\/p>/);
    const noAccess = harness.planCard({ lines: [planLine("p1", "Seth added “Lineup reveal” to the plan for Sat 7 Nov.", ago(MIN))], items, brandName: "Harmattan Club", onOpen: null });
    assert.doesNotMatch(noAccess, /<button/, "without a way to open, no dead button");
  });
  it("the thread: plan lines sit in the card with no message actions; messages have React, Reply, Add to plan, More", () => {
    const entries = foldThread([text("m1", U2, "Push the rooftop?", ago(2 * MIN)), planLine("p1", "Seth added “A” to the plan for Sat 7 Nov.", ago(MIN))], new Date(NOW));
    const html = harness.thread({ group, entries, myUserId: U1, canPlan: true, planItems: [], onOpenSide: () => {} });
    assert.match(html, /role="log" aria-label="Messages with Harmattan Club" aria-live="polite"/);
    assert.equal((html.match(/data-message-actions=""/g) || []).length, 1, "one message, one action bar; the plan line has none");
    for (const label of ["React", "Reply", "Add to plan", "More actions"]) assert.match(html, new RegExp(`aria-label="${label}"`));
    assert.match(html, /data-plan-activity=""[\s\S]*data-system-line=""/);
    const pending = harness.thread({ group, entries: [], pending: [{ localId: "l1", content: "Dress code", state: "failed", error: "Not sent: connection lost" }], myUserId: U1, planItems: [] });
    assert.match(pending, /Not sent: connection lost[\s\S]*>Try again<[\s\S]*>Delete</);
  });
  it("the side panel: a trail Brand › A › B, the panel's Back to A, and Close", () => {
    const stack = { trail: [{ side: { kind: "content", id: U2 }, title: "Lineup reveal" }], titles: { current: { 1: "", 2: "" } }, back() {}, backTo() {} };
    const html = harness.sidePanel({ stack, side: { kind: "calendar", id: U1 }, brandName: "Harmattan Club" });
    assert.match(html, /<nav aria-label="Panel trail"[^>]*><ol/);
    assert.match(html, /Harmattan Club[\s\S]*<button[^>]*>Lineup reveal<\/button>[\s\S]*aria-current="page"/);
    assert.match(html, /data-panel-back=""[\s\S]*Back to Lineup reveal/);
    assert.match(html, /aria-label="Close"/);
    assert.match(html, /Calendar · Harmattan Club/);
    assert.match(html, /<\/svg> Back to the chat<\/button>/);
  });
  it("the rail: a tablist; Support without Hosts access sees Media and People only", () => {
    const html = harness.rail({ group, tab: "people", canHosts: true, people: [{ user_id: U2, display_name: "info", role: "brand_owner" }], staff: ["Seth"] });
    assert.match(html, /role="tablist" aria-label="Brand context"/);
    assert.deepEqual([...html.matchAll(/role="tab"[^>]*>([A-Za-z]+)</g)].map((m) => m[1]), ["Plan", "Host", "Media", "People"]);
    assert.match(html, /role="tab" id="rail-tab-people" aria-selected="true" aria-controls="rail-panel-people"/);
    assert.match(html, /Brand team · 1/);
    assert.match(html, />info<\/span><span[^>]*>Owner</);
    assert.doesNotMatch(html, /@/, "no email on the People tab");
    assert.match(html, /Every Mingla Support teammate gets a push for each message unless they mute the group\./);
    const support = harness.rail({ group, tab: "plan", canHosts: false });
    assert.deepEqual([...support.matchAll(/role="tab"[^>]*>([A-Za-z]+)</g)].map((m) => m[1]), ["Media", "People"]);
    assert.match(support, /Photos, videos and files shared in this group/);
  });
  it("no host card: create or link (Hosts access); one line without it", () => {
    const html = harness.empty({ brandName: "Lantern Room", brandId: U1, canHosts: true });
    assert.match(html, /No host card for Lantern Room yet/);
    assert.match(html, /A brand&#x27;s plan lives on its host card\. Link one and the plan, To do and pipeline show here\./);
    assert.match(html, />Create host card</);
    assert.match(html, />Link existing</);
    assert.match(harness.empty({ brandName: "Lantern Room", brandId: U1, canHosts: false }), /This brand has no host card yet\./);
  });
  it("the header for a Support teammate: name, team line, Mute; the composer's words", () => {
    const html = harness.header({ group, host: null, canHosts: false, people: [{ display_name: "info", role: "brand_owner" }], online: true });
    assert.match(html, />Harmattan Club</);
    assert.match(html, /1 teammate · info \(Owner\)/);
    assert.match(html, /aria-label="Mute this Brand group" aria-pressed="false"/);
    assert.doesNotMatch(html, /Assign to me|Mingla owner/);
    const box = harness.composer({ brandName: "Harmattan Club", value: "", chips: quickReplies({ brandName: "Harmattan Club" }), replyingAs: "Seth Ogieva", selectedCount: 2, canPlanActions: true });
    assert.match(box, />2 messages selected</);
    for (const label of ["Create product signal", "Add to plan", "Make a work card", "Cancel"]) assert.match(box, new RegExp(`>${label}<`));
    assert.match(box, /<span class="sr-only">Message Harmattan Club<\/span>/);
    assert.match(box, /placeholder="Message Harmattan Club…"/);
    assert.match(box, /Replying as <strong[^>]*>Seth Ogieva · Mingla Support<\/strong> · the brand team gets a push/);
  });
});

describe("E source contracts", () => {
  // I-4270-W7-BRAND-GROUP-STAYS-ON-PAGE: nothing in a Brand group navigates away (Seth, 2026-11-07 design rule).
  const files = ["BrandGroupsPanel", "BrandGroupList", "BrandGroupStrip", "BrandGroupHeader", "BrandGroupThread", "PlanActivityCard",
    "BrandGroupComposer", "BrandGroupRail", "HostCardEmptyState", "BrandCalendarSide", "BrandGroupSidePanel"];
  it("no component writes the address or links away, except Open the Calendar", () => {
    for (const name of files) {
      const src = code(`components/community/${name}.jsx`);
      assert.doesNotMatch(src, /window\.location\s*(=|\.(href|hash)\s*=|\.(assign|replace)\s*\()/, `${name} navigates`);
      assert.doesNotMatch(src, /window\.open\(/, `${name} opens a window`);
      const hrefs = [...src.matchAll(/\bhref=\{?["'`]?([^"'`}\s>]*)/g)].map((m) => m[1]);
      assert.deepEqual(hrefs, name === "BrandCalendarSide" ? ["#/content-calendar"] : [], `${name} links away`);
    }
  });
  it("links inside the panel and the rail come back through PanelLinksContext", () => {
    assert.match(code("components/community/BrandGroupSidePanel.jsx"), /<PanelLinksContext\.Provider value=\{links\}>[\s\S]*<PanelSlotContext\.Provider value=\{slot\}>/);
    assert.match(code("components/community/BrandGroupRail.jsx"), /<PanelLinksContext\.Provider value=\{links\}>[\s\S]*<HostPlanSection/);
    assert.match(code("components/community/BrandGroupRail.jsx"), /const links = useMemo\(\(\) => \(\{ openSide: openFresh \}\), \[openFresh\]\);/);
  });
  it("Esc waits for a dialog on top, lets a field go first, then closes the panel", () => {
    const panel = code("components/community/BrandGroupsPanel.jsx");
    const esc = panel.slice(panel.indexOf("const onKeyDown = (e) => {"), panel.indexOf('document.addEventListener("keydown", onKeyDown)'));
    assert.match(esc, /if \(e\.key !== "Escape" \|\| e\.defaultPrevented\) return;/);
    assert.match(esc, /if \(document\.querySelector\('\[aria-modal="true"\]'\)\) return;/);
    assert.ok(esc.indexOf("active.blur()") < esc.indexOf("closePanel()"), "a field lets go before the panel closes");
  });
  it("closing uses sideCloseStep and never replaces history; a teammate who cannot open a kind gets nothing", () => {
    const panel = code("components/community/BrandGroupsPanel.jsx");
    const close = panel.slice(panel.indexOf("const closePanel = useCallback"), panel.indexOf("const onPop = () =>"));
    assert.ok(close.length > 40, "closePanel is found");
    assert.match(close, /sideCloseStep\(pushesHere\.current\)/);
    assert.match(close, /window\.history\.go\(step\.delta\)/);
    assert.doesNotMatch(close, /replace:\s*true/);
    assert.match(panel, /const side = sideAllowed\(view\.side, \{ canHosts, canBrands \}\) \? view\.side : null;/);
    assert.match(panel, /if \(side\.kind === "brand"\) return !!canBrands;/);
  });
  it("the light refresh after a message reads no plans; the counts reach the page", () => {
    const panel = code("components/community/BrandGroupsPanel.jsx");
    assert.match(panel, /void loadInbox\(\{ withPlan: false \}\);/);
    assert.match(panel, /const LIGHT_REFRESH_MS = 1_500;/);
    assert.match(code("pages/CommunitySupportPage.jsx"), /<BrandGroupsPanel onCounts=\{onBrandGroupCounts\} \/>/);
  });
});
