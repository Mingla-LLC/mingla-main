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
import {
  INBOX_ERROR_WORDS,
  PEOPLE_ERROR_WORDS,
  createAnswerGate,
  focusRefreshDue,
  hostCardFacts,
  openGroupStep,
  personName,
} from "../lib/brandGroupInbox.js";
import { createPanelHistory } from "../lib/brandGroupPanelHistory.js";

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
import { HostTeamSection } from "../components/crm/HostTeamSection.jsx";
import { PageLink } from "../components/ui/PanelStack.jsx";
export { assignHostToMe } from "../components/community/BrandGroupHeader.jsx";
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
export const empty = (p) => html(<ToastProvider><HostCardEmptyState {...p} /></ToastProvider>);
export const team = (p) => html(<HostTeamSection {...p} />);
export const pageLink = (p) => html(<PageLink {...p} />);
import { HostAvatarButton } from "../components/community/BrandGroupsPanel.jsx";
export const hostAvatar = (p) => html(<HostAvatarButton onOpen={() => {}} {...p} />);`,
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
  it("closing uses the panel's own history tags and never replaces history; a teammate who cannot open a kind gets nothing", () => {
    const panel = code("components/community/BrandGroupsPanel.jsx");
    const close = panel.slice(panel.indexOf("const closePanel = useCallback"), panel.indexOf("if (!sideOpen) return undefined;"));
    assert.ok(close.length > 40, "closePanel is found");
    assert.match(close, /const step = history\.closeStep\(\);/);
    assert.match(close, /window\.history\.go\(step\.delta\)/);
    assert.doesNotMatch(panel, /addEventListener\("popstate"/, "no popstate counting (Chrome fires popstate for the page's own pushes)");
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

// ── #4270 W7 rework 1: each tester defect, fixed and pinned ─────────────────

/**
 * A browser history that behaves like Chrome's for this page: assigning
 * location.hash adds an entry (with an empty state) and drops anything ahead
 * of it; replaceState rewrites the current entry; go(n) moves along.
 */
function fakeWindow(start) {
  const entries = [{ url: start, state: null }];
  let at = 0;
  const win = {
    entries,
    get index() { return at; },
    location: {
      get href() { return entries[at].url; },
      get hash() { return entries[at].url.slice(entries[at].url.indexOf("#")); },
      set hash(value) {
        const url = `${entries[at].url.split("#")[0]}${value.startsWith("#") ? value : `#${value}`}`;
        if (url === entries[at].url) return;
        entries.splice(at + 1);
        entries.push({ url, state: null });
        at = entries.length - 1;
      },
    },
    history: {
      get state() { return entries[at].state; },
      replaceState(state, _title, url) { entries[at] = { url: url ?? entries[at].url, state }; },
      go(delta) { at = Math.max(0, Math.min(entries.length - 1, at + delta)); },
    },
  };
  return win;
}

describe("R rework 1 (test report D-1 … D-14)", () => {
  const BASE = "https://admin.test/#/community?tab=brand-groups&group=g1";
  const sideHash = (side) => `#/community?tab=brand-groups&group=g1&side=${side}`;

  it("D-2 Close returns to exactly the entry the panel opened from, after inside links, Back and the panel's own Back", () => {
    const win = fakeWindow(BASE);
    win.location.hash = "#/community?tab=brand-groups&group=g1&marker=base";
    const opened = win.location.href;
    const ph = createPanelHistory(win);
    ph.begin();
    ph.push(() => { win.location.hash = sideHash(`calendar:${U1}`); });
    ph.push(() => { win.location.hash = sideHash(`content:${U2}`); });
    assert.equal(ph.depth(), 2);
    // The panel's Back rewrites the current entry (useHashQuery replaces with a null state).
    ph.replace(() => win.history.replaceState(null, "", `https://admin.test/${sideHash(`calendar:${U1}`)}`));
    assert.equal(ph.depth(), 2, "a replace keeps the entry's place");
    const step = ph.closeStep();
    assert.deepEqual(step, { kind: "go", delta: -2 });
    win.history.go(step.delta);
    assert.equal(win.location.href, opened, "lands on the entry the panel opened from, not one before it");
  });

  it("D-2 the browser's Back inside the panel, then a new inside link: Close still lands on the start", () => {
    const win = fakeWindow(BASE);
    const opened = win.location.href;
    const ph = createPanelHistory(win);
    ph.begin();
    ph.push(() => { win.location.hash = sideHash(`calendar:${U1}`); });
    ph.push(() => { win.location.hash = sideHash(`content:${U2}`); });
    win.history.go(-1); // the browser's Back: no counting needed, the entry carries its own place
    assert.equal(ph.depth(), 1);
    ph.push(() => { win.location.hash = sideHash(`host:${U2}`); });
    assert.equal(ph.depth(), 2);
    win.history.go(ph.closeStep().delta);
    assert.equal(win.location.href, opened);
  });

  it("D-2 a panel that arrived in the address (not this panel's entry) closes with a new entry; reopening the same side adds nothing", () => {
    const win = fakeWindow(`https://admin.test/${sideHash(`brand:${U1}`)}`);
    const ph = createPanelHistory(win);
    ph.push(() => { win.location.hash = sideHash(`host:${U2}`); });
    assert.deepEqual(ph.closeStep(), { kind: "push" });
    const fresh = createPanelHistory(win);
    fresh.begin();
    const before = win.entries.length;
    fresh.push(() => { win.location.hash = win.location.hash; });
    assert.equal(win.entries.length, before);
    assert.equal(fresh.depth(), 0);
    fresh.reset();
    assert.deepEqual(fresh.closeStep(), { kind: "push" }, "after reset nothing is ours");
  });

  it("D-2 the tag only rewrites the current entry's state, never its address", () => {
    const win = fakeWindow(BASE);
    const calls = [];
    const real = win.history.replaceState;
    win.history.replaceState = (state, title, url) => { calls.push(url); real(state, title, url); };
    const ph = createPanelHistory(win);
    ph.begin();
    ph.push(() => { win.location.hash = sideHash(`calendar:${U1}`); });
    assert.deepEqual(calls, [BASE, `https://admin.test/${sideHash(`calendar:${U1}`)}`]);
  });

  it("D-5 a slow answer for the group left behind never shows under the new one (delayed fixtures)", async () => {
    const gate = createAnswerGate();
    const wait = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
    const shown = [];
    const load = async (key, ms) => {
      const ticket = gate.begin(key);
      const rows = await wait(ms, `${key}-rows`);
      if (gate.applies(ticket)) shown.push(rows);
      return rows;
    };
    gate.open("harmattan");
    const slow = load("harmattan", 40);       // Harmattan's read answers late
    gate.open("lantern");                     // staff switch groups within a second
    const fast = load("lantern", 5);
    const retryElsewhere = load("ox", 1);     // Try again on a group no longer open
    assert.equal(await retryElsewhere, "ox-rows", "the caller still gets its rows");
    await Promise.all([slow, fast]);
    assert.deepEqual(shown, ["lantern-rows"], "only Lantern's messages show under Lantern's header");
    // An older read of the open group never overwrites a newer one.
    const older = load("lantern", 30);
    const newer = load("lantern", 5);
    await Promise.all([older, newer]);
    assert.deepEqual(shown, ["lantern-rows", "lantern-rows"]);
  });

  it("D-5 the thread, read state and plan loads go through their guards", () => {
    const panel = code("components/community/BrandGroupsPanel.jsx");
    const load = panel.slice(panel.indexOf("const loadThread = useCallback"), panel.indexOf("useEffect(() => { void loadGroups(); void loadInbox(); }"));
    assert.ok(load.indexOf("if (!current()) return rows;") > -1 && load.indexOf("if (!current()) return rows;") < load.indexOf("setMessages(rows)"), "the answer is checked before it is shown");
    assert.match(load, /const ticket = gate\.begin\(conversationId\);/);
    assert.match(panel, /threadGate\.current\.open\(selectedId\);/);
    assert.match(panel, /if \(item\.conversationId === selectedRef\.current\) await loadThread/);
    const live = code("hooks/useBrandGroupLive.js");
    assert.match(live, /if \(!gate\.applies\(ticket\)\) return;\s*setReads/);
    const plan = code("hooks/useBrandGroupPlanItems.js");
    assert.ok(plan.indexOf("const mine = ++seq.current;") < plan.indexOf("if (!recordId) { setItems([]);"), "a group without a host card still drops the last group's plan answer");
  });

  it("D-6 with the inbox read failing, a brand with a host card shows it (the pre-W7 lookup), never Create host card", () => {
    const g = { conversation_id: "c1", brand_id: U1, brand_name: "Harmattan Club", inbox_known: false, host: null };
    assert.deepEqual(hostCardFacts({ inboxStatus: "error", group: g, fallback: null }).needsFallback, true);
    const ready = hostCardFacts({ inboxStatus: "error", group: g, fallback: { status: "ready", recordId: U2, name: "Ade" } });
    assert.equal(ready.status, "ready");
    assert.equal(ready.host.record_id, U2);
    assert.equal(ready.host.owners, null, "owners unknown: no 'No owner' claim, no Assign to me");
    assert.equal(hostCardFacts({ inboxStatus: "error", group: g, fallback: { status: "error" } }).status, "unknown");
    assert.equal(hostCardFacts({ inboxStatus: "error", group: g, fallback: { status: "loading" } }).status, "loading");
    assert.equal(hostCardFacts({ inboxStatus: "error", group: g, fallback: { status: "none" } }).status, "none", "the old lookup's 'no card' is reliable");
    assert.equal(hostCardFacts({ inboxStatus: "loading", group: g, fallback: null }).status, "loading");
    // The inbox answered for this group: its word is final, no extra lookup.
    const known = { ...g, inbox_known: true };
    assert.deepEqual(hostCardFacts({ inboxStatus: "ready", group: known, fallback: null }), { status: "none", host: null, needsFallback: false });
    // The inbox answered but not for this group (a group created since): ask the old lookup.
    assert.equal(hostCardFacts({ inboxStatus: "ready", group: g, fallback: null }).needsFallback, true);
    assert.equal(mergeInbox([{ conversation_id: "c1" }], [])[0].inbox_known, false);
    assert.equal(mergeInbox([{ conversation_id: "c1" }], [{ conversation_id: "c1", host: null }])[0].inbox_known, true);
  });

  it("D-6 the rail and header when the host card cannot be read: plain words and Try again, no Create, no owner claim", () => {
    const g = { conversation_id: "c1", brand_id: U1, brand_name: "Harmattan Club", member_count: 2, unread_count: 0, muted: false };
    // The Host tab reads the CRM config (an AuthProvider) first; it draws the same NoHostCard.
    assert.match(code("components/community/BrandGroupRail.jsx"), /function HostTab[\s\S]*?if \(!host\) return <NoHostCard group=\{group\} hostStatus=\{hostStatus\}/);
    for (const tab of ["plan"]) {
      const unknown = harness.rail({ group: g, tab, canHosts: true, canBrands: true, host: null, hostStatus: "unknown", onRetryHost: () => {}, online: true });
      assert.doesNotMatch(unknown, /Create host card|Link existing/, `${tab}: never Create when nothing could be read`);
      assert.match(unknown, /data-host-unknown=""/);
      assert.match(unknown, /can&#x27;t be shown right now/);
      assert.match(unknown, />Try again</);
      const loading = harness.rail({ group: g, tab, canHosts: true, canBrands: true, host: null, hostStatus: "loading", online: true });
      assert.doesNotMatch(loading, /Create host card/);
      assert.match(loading, /Loading the host card/);
    }
    const noCard = code("components/community/BrandGroupRail.jsx");
    const fn = noCard.slice(noCard.indexOf("function NoHostCard"), noCard.indexOf("function PlanTab"));
    assert.ok(fn.indexOf('hostStatus === "unknown"') < fn.indexOf("<HostCardEmptyState"), "Create / Link only after loading and unknown are ruled out");
    // The header with Hosts access reads the CRM config (an AuthProvider): pinned in source.
    const header = code("components/community/BrandGroupHeader.jsx");
    assert.match(header, /const owners = Array\.isArray\(host\?\.owners\) \? host\.owners : null;/);
    assert.match(header, /\{showHost && owners && \(/, "no owner line (and no 'No owner') when owners are unknown");
    assert.match(code("components/community/BrandGroupRail.jsx"), /\{owners && owners\.length === 0 && \(/);
    assert.match(code("components/community/BrandGroupsPanel.jsx"), /const canAssign = canHosts && ownersKnown && !isOwner && !!myEmail;/);
  });

  it("D-6 / D-14 the People tab and the inbox toast use plain words, never the database's text", () => {
    const g = { conversation_id: "c1", brand_id: U1, brand_name: "Harmattan Club", member_count: 2, unread_count: 0, muted: false };
    const html = harness.rail({ group: g, tab: "people", canHosts: false, canBrands: false, peopleError: PEOPLE_ERROR_WORDS, onRetryPeople: () => {} });
    assert.match(html, /The brand team can&#x27;t be shown right now/);
    assert.match(html, />Try again</);
    assert.doesNotMatch(PEOPLE_ERROR_WORDS + INBOX_ERROR_WORDS, /function|schema|public\.|rpc/i);
    const panel = code("components/community/BrandGroupsPanel.jsx");
    assert.match(panel, /setPeople\(\{ conversationId: selectedId, rows: \[\], error: PEOPLE_ERROR_WORDS \}\)/);
    assert.match(panel, /description: INBOX_ERROR_WORDS/);
    assert.doesNotMatch(panel.slice(panel.indexOf("listBrandGroupPeople(selectedId)"), panel.indexOf("}, [selectedId, peopleTick]);")), /cause\?\.message \|\| ""/);
    assert.match(panel, /setInboxStatus\(\(prev\) => \(prev === "ready" \? "ready" : "error"\)\)/);
  });

  it("D-8 tapping the group selected by default opens it on a phone; the open thread is the only no-op", () => {
    assert.equal(openGroupStep("c1", { selectedId: "c1", viewGroup: "", sideOpen: false }), "open", "first load: c1 is selected but no thread is showing");
    assert.equal(openGroupStep("c1", { selectedId: "c1", viewGroup: "c1", sideOpen: false }), "none");
    assert.equal(openGroupStep("c1", { selectedId: "c1", viewGroup: "c1", sideOpen: true }), "open", "with the panel open, tapping closes it");
    assert.equal(openGroupStep("c2", { selectedId: "c1", viewGroup: "c1", sideOpen: false }), "open");
    assert.equal(openGroupStep("", { selectedId: "c1", viewGroup: "c1", sideOpen: false }), "none");
    assert.match(code("components/community/BrandGroupsPanel.jsx"), /if \(openGroupStep\(conversationId, \{ selectedId, viewGroup: view\.group, sideOpen: !!view\.side \}\) === "none"\) return;/);
  });

  it("D-9 Assign to me keeps an owner added since the page loaded; a failed read writes nothing", async () => {
    const writes = [];
    const api = {
      getRecord: async () => ({ record: { owners: ["kim@mingla.example", "ada@mingla.example"] } }),
      setOwners: async (id, emails) => { writes.push([id, emails]); return { ok: true }; },
    };
    const stale = { record_id: U2, owners: [{ email: "ada@mingla.example", name: "Ada" }] }; // Kim was added after this page loaded
    await harness.assignHostToMe(stale, "Seth@Mingla.example", api);
    assert.deepEqual(writes, [[U2, ["ada@mingla.example", "kim@mingla.example", "seth@mingla.example"]]]);
    const failing = { getRecord: async () => { throw new Error("offline"); }, setOwners: async () => { writes.push("wrote"); } };
    await assert.rejects(harness.assignHostToMe(stale, "seth@mingla.example", failing), /offline/);
    const shapeless = { getRecord: async () => ({ record: {} }), setOwners: async () => { writes.push("wrote"); } };
    await assert.rejects(harness.assignHostToMe(stale, "seth@mingla.example", shapeless), /nothing was changed/);
    assert.equal(writes.length, 1, "no write after a failed or shapeless read");
  });

  it("D-10 / N-2 the header's actions wrap on the thread column's own width (nothing clipped at 375, nor at 1440 with the panel open)", () => {
    const g = { conversation_id: "c1", brand_name: "Harmattan Club", member_count: 2, unread_count: 0, muted: false };
    const html = harness.header({ group: g, host: null, canHosts: false, people: [], online: true, onRailButton: () => {}, railButtonLabel: "Plan and host" });
    const shell = /<div data-thread-header="" class="([^"]*)"/.exec(html)?.[1] || "";
    assert.ok(shell.split(/\s+/).includes("@container"), `the header is a size container: ${shell}`);
    const actions = /<div data-header-actions="" class="([^"]*)"/.exec(html)?.[1] || "";
    assert.ok(actions, "the actions group is marked");
    const classes = actions.split(/\s+/);
    assert.ok(classes.includes("basis-full") && classes.includes("flex-wrap") && classes.includes("min-w-0"), actions);
    assert.ok(!classes.includes("shrink-0"), "no unprefixed shrink-0: in a narrow column the group may narrow and wrap");
    assert.ok(classes.includes("@2xl:shrink-0") && classes.includes("@2xl:basis-auto"), "beside the name only when the COLUMN is wide enough");
    assert.ok(!classes.some((c) => /^(sm|md|lg|xl):(basis|shrink)/.test(c)), "never the window's width: with the panel open at 1440 the column is narrow (N-2)");
  });

  it("D-11 picking a rail tab drops a used prefill; D-12 Esc in the composer lets go first; D-13 focus refresh is throttled", () => {
    const panel = code("components/community/BrandGroupsPanel.jsx");
    assert.match(panel, /const pickRailTab = \(tab\) => \{ setPlanPrefill\(null\); setWorkPrefill\(null\); setRailTab\(tab\); \};/);
    assert.match(panel, /onTab=\{pickRailTab\}/);
    const esc = panel.slice(panel.indexOf("const onKeyDown = (e) => {"), panel.indexOf('document.addEventListener("keydown", onKeyDown)'));
    assert.doesNotMatch(esc, /if \(!panel \|\| !panel\.contains\(active\)\) return;/, "a field outside the panel (the composer) is not ignored");
    assert.ok(esc.indexOf("active.blur();") > -1 && esc.indexOf("active.blur();") < esc.indexOf("return;\n      }"), "the field lets go and this Esc stops there");
    assert.equal(focusRefreshDue(0, NOW), true);
    assert.equal(focusRefreshDue(NOW - 59_999, NOW), false);
    assert.equal(focusRefreshDue(NOW - 60_000, NOW), true);
    assert.equal(focusRefreshDue("x", NOW), true);
    assert.match(panel, /const onFocus = \(\) => \{ if \(focusRefreshDue\(lastFullRead\.current\)\) void loadInbox\(\); \};/);
    assert.match(panel, /if \(withPlan\) lastFullRead\.current = Date\.now\(\);/);
  });

  it("D-4 one name helper: an address never shows; the People row's name, else 'A teammate'", () => {
    assert.equal(personName("Ada Obi"), "Ada Obi");
    assert.equal(personName("ada@club.example"), "A teammate");
    assert.equal(personName("ada@club.example", "Ada Obi"), "Ada Obi");
    assert.equal(personName("  ", null, "kim@x.example"), "A teammate");
    assert.equal(previewWords({ last_message_preview: "hi", last_message_sender_id: U1, last_message_sender_name: "ada@club.example" }, U2), "A teammate: hi");
    assert.equal(seenByWords([{ user_id: U1, display_name: "kim@club.example", last_read_at: ago(0) }], { created_at: ago(MIN) }, (id) => (id === U1 ? "Kim Obi" : null)), "Seen by Kim");
    assert.equal(typingWords(["kim@club.example"]), "A teammate is typing…");
    const html = harness.thread({ group: { brand_name: "Harmattan Club" }, entries: [{ type: "message", key: "m1", message: text("m1", U1, "hello", ago(MIN), { sender_display_name: "ada@club.example" }) }], myUserId: U2, reactions: new Map(), nameFor: (id) => (id === U1 ? "Ada Obi" : null) });
    assert.match(html, /Ada Obi/);
    assert.doesNotMatch(html, /@club\.example/);
    const people = harness.rail({ group: { conversation_id: "c1", brand_name: "H", member_count: 1 }, tab: "people", canHosts: false, people: [{ user_id: U1, display_name: "ada@club.example", role: "brand_owner" }] });
    assert.doesNotMatch(people, /@club\.example/);
  });

  it("D-1 a link to another page: opens beside when it can, plain words otherwise, the plain link elsewhere", () => {
    const opener = Object.assign(() => {}, { allows: (kind) => kind === "brand" });
    assert.equal(harness.pageLink({ href: "#/people", children: "Ada" }), '<a href="#/people" class="">Ada</a>', "no opener: unchanged");
    assert.equal(harness.pageLink({ href: "#/people", onOpenSide: opener, textClassName: "t", children: "Ada" }), '<span data-page-link-text="" class="t">Ada</span>');
    assert.equal(harness.pageLink({ href: "#/brands?tab=claims", onOpenSide: opener, hide: true, children: "Review the claim" }), "");
    assert.match(harness.pageLink({ href: "#/brands", side: { kind: "brand", id: U1 }, onOpenSide: opener, children: "H" }), new RegExp(`<button type="button" data-side-link="brand:${U1}"`));
    assert.doesNotMatch(harness.pageLink({ href: "#/brands", side: { kind: "host", id: U1 }, onOpenSide: opener, children: "H" }), /<button|href=/, "a kind this teammate cannot open is words, not a dead button");
    const read = { data: { brand: { id: U1, name: "Harmattan Club", slug: "harmattan" }, team: { owners: [], brand_members: [] } } };
    const inPanel = harness.team({ record: { id: U2 }, read, onOpenSide: opener });
    assert.doesNotMatch(inPanel, /href="#\//, "inside the Brand group panel nothing links to another page");
    assert.doesNotMatch(inPanel, /Open Brand group/);
    assert.match(inPanel, new RegExp(`data-side-link="brand:${U1}"`));
    const outside = harness.team({ record: { id: U2 }, read });
    assert.match(outside, /href="#\/community\?tab=brand-groups&amp;brand=/, "elsewhere Open Brand group is as before");
    assert.match(outside, new RegExp(`href="#/brands\\?brandId=${U1}"`));
  });

  it("D-1 every drawer the panel can show gets the opener, and the record's toast stays on the page", () => {
    const side = code("components/community/BrandGroupSidePanel.jsx");
    assert.match(side, /<SidePanel side=\{side\} onClose=\{onClose\} onChanged=\{onChanged\} onOpenSide=\{onOpenSide\} \/>/);
    assert.match(code("components/community/BrandGroupsPanel.jsx"), /onOpenSide=\{openSideInPanel\}/);
    const sp = code("components/panels/SidePanel.jsx");
    for (const re of [/<WorkDetail [^>]*onOpenSide=\{onOpenSide\}/, /onOpenSide=\{onOpenSide\}\s*\/>\s*\{reasonFor/, /<DraftsPage [^>]*onOpenSide=\{onOpenSide\}/, /<BrandDrawer [^>]*onOpenSide=\{onOpenSide\}/]) assert.match(sp, re);
    const rd = code("components/crm/RecordDrawer.jsx");
    const toast = rd.slice(rd.indexOf('label: "Open the card"'), rd.indexOf('label: "Open the card"') + 400);
    assert.match(toast, /if \(typeof onOpenSide === "function"\) onOpenSide\(pipeline === "creators" \? "creator" : "host", recordId\);\s*else window\.location\.hash/);
    assert.match(rd, /<HostTeamSection record=\{record\} read=\{hostRead\} onOpenSide=\{onOpenSide\} \/>/);
    assert.match(code("components/ops/CardPersonPanels.jsx"), /<WordingCard card=\{wording\}[^\n]*onOpenSide=\{onOpenSide\} \/>/);
  });
});

describe("R rework 2 (retest 1: R-1, N-2, N-3, X-1, toast reopen)", () => {
  const BASE = "https://admin.test/#/community?tab=brand-groups&group=g1";
  const sideHash = (side) => `#/community?tab=brand-groups&group=g1&side=${side}`;

  it("R-1 a rail tab picked with the panel open keeps the entry's tag: Close lands on the start and Back does not reopen the panel", () => {
    const win = fakeWindow(BASE);
    const opened = win.location.href;
    const ph = createPanelHistory(win);
    ph.begin();
    ph.push(() => { win.location.hash = sideHash(`host:${U1}`); });
    ph.push(() => { win.location.hash = sideHash(`brand:${U2}`); });
    // setRailTab: useHashQuery rewrites the entry with a null state.
    ph.replace(() => win.history.replaceState(null, "", `https://admin.test/${sideHash(`brand:${U2}`)}&rail=media`));
    assert.equal(ph.depth(), 2);
    win.history.go(ph.closeStep().delta);
    assert.equal(win.location.href, opened);
    const panel = code("components/community/BrandGroupsPanel.jsx");
    assert.match(panel, /const setRailTab = \(tab\) => panelHistory\.current\.replace\(\(\) => setSearch\(brandGroupSearch\(search, \{ rail: tab \}\), \{ replace: true \}\)\);/);
    assert.match(panel, /if \(match\) panelHistory\.current\.replace\(\(\) => setSearch\(brandGroupSearch\(search, \{ group: match\.conversation_id, brand: null \}\), \{ replace: true \}\)\);/);
  });

  it("toast reopen: a panel opened from a drawer's kept callback after Close is tagged, so its Close walks back", () => {
    const win = fakeWindow(BASE);
    const ph = createPanelHistory(win);
    ph.begin();
    ph.push(() => { win.location.hash = sideHash(`host:${U1}`); });
    win.history.go(ph.closeStep().delta);
    ph.reset();
    const closedAt = win.location.href;
    // RecordDrawer's "Open the card" toast, after the panel was closed.
    ph.follow(() => { win.location.hash = sideHash(`host:${U1}`); }, { panelOpen: false });
    assert.equal(ph.depth(), 1);
    assert.deepEqual(ph.closeStep(), { kind: "go", delta: -1 });
    win.history.go(-1);
    assert.equal(win.location.href, closedAt);
    // With the panel open, follow is a plain push (a pasted-link panel stays untagged).
    const pasted = fakeWindow(`https://admin.test/${sideHash(`brand:${U1}`)}`);
    const ph2 = createPanelHistory(pasted);
    ph2.follow(() => { pasted.location.hash = sideHash(`host:${U2}`); }, { panelOpen: true });
    assert.deepEqual(ph2.closeStep(), { kind: "push" });
    const panel = code("components/community/BrandGroupsPanel.jsx");
    assert.match(panel, /sideRef\.current = view\.side;/);
    assert.match(panel, /panelHistory\.current\.follow\(\(\) => stack\.openSide\(next\), \{ panelOpen: !!sideRef\.current \}\);/);
  });

  it("X-1 the mount effect sets mounted again (StrictMode dev mounts twice)", () => {
    assert.match(code("components/community/BrandGroupsPanel.jsx"), /useEffect\(\(\) => \{\s*mounted\.current = true;\s*return \(\) => \{ mounted\.current = false;/);
  });

  it("N-3 a host card that cannot be read says so, with Try again when there is one", () => {
    const withRetry = harness.hostAvatar({ host: { status: "error", retry: () => {} } });
    assert.match(withRetry, /The host card can’t be shown right now · Try again/);
    assert.match(withRetry, /^<button/);
    const noRetry = harness.hostAvatar({ host: { status: "error" } });
    assert.match(noRetry, /The host card can’t be shown right now/);
    assert.doesNotMatch(noRetry, /Try again|<button/);
    assert.doesNotMatch(withRetry + noRetry, /Couldn’t find/);
  });
});
