// Issue #4270 (Wave 7) — tester adversarial suite for the staff Brand group
// inbox model and the side panel's address contract. A different angle from
// the implementor's happy path: boundaries, malformed input, tampered
// addresses, ordering ties and the degraded (no inbox facts) shape.
//
//   M  lib/brandGroupInbox.js at its edges: waiting-time boundaries and the
//      14d+ cap, filters with bad data, the degraded merge, folding across
//      days and interruptions, plan-line matching with hostile titles,
//      Try again's "did it land?", Seen by, reactions, the Add to plan prefill
//   P  lib/panelStack.js under address tampering: kinds a page does not own,
//      path-like and over-long ids, rail values, close steps for odd counts
//
// Known defects found by this test pass are pinned as `todo` tests (they run,
// report, and do not fail the suite); each turns into a plain test when the
// fix lands. See the #4270 W7 test report.
//
// Run: node --no-experimental-websocket --test src/__tests__/issue4270_w7_inbox_model.tester.adversarial.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyInboxFilter,
  defaultInboxFilter,
  foldThread,
  inboxSummary,
  inboxSummaryWords,
  matchPlanLine,
  mergeInbox,
  planActivityWords,
  planLineTitle,
  planPrefillFromMessages,
  previewWords,
  reactionToggle,
  seenByWords,
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
  parseSideValue,
  sideCloseStep,
} from "../lib/panelStack.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 10, 7, 18, 0, 0).getTime();
const at = (msAgo) => new Date(NOW - msAgo).toISOString();
const U1 = "11111111-2222-4333-8444-555555555555";
const U2 = "21111111-2222-4333-8444-555555555555";
const ME = "31111111-2222-4333-8444-555555555555";

const group = (id, extra = {}) => ({ conversation_id: id, brand_name: `Brand ${id}`, last_message_preview: "", ...extra });

describe("M the inbox model at its edges", () => {
  it("M-1 waiting words: the 14d+ cap starts exactly at 14 days, never a day early", () => {
    assert.equal(waitingWords(at(14 * DAY), NOW), "14d+");
    assert.equal(waitingWords(at(14 * DAY - 1), NOW), "13d 23h", "one millisecond under 14 days is still counted");
    assert.equal(waitingWords(at(40 * DAY), NOW), "14d+", "an old unanswered message never shows 40d");
    assert.equal(waitingWords(at(DAY), NOW), "1d 0h");
    assert.equal(waitingWords(at(HOUR), NOW), "1h 0m");
  });

  it("M-2 waiting words: never 0m, never negative, never NaN", () => {
    assert.equal(waitingWords(at(5_000), NOW), "1m", "a message 5 s old is waiting 1m, not 0m");
    assert.equal(waitingWords(new Date(NOW + 10 * MIN).toISOString(), NOW), "1m", "a clock ahead of the server never shows a negative wait");
    assert.equal(waitingWords("not a date", NOW), "");
    assert.equal(waitingWords(null, NOW), "");
    assert.equal(waitingWords(undefined, NOW), "");
  });

  it("M-3 Needs reply keeps only waiting groups, oldest first, and a bad date sorts last instead of first", () => {
    const rows = [
      group("a", { waiting_since: at(10 * MIN) }),
      group("b", { waiting_since: null }),
      group("c", { waiting_since: at(3 * HOUR) }),
      group("d", { waiting_since: "garbage" }),
      group("e", { waiting_since: at(2 * DAY) }),
    ];
    const out = applyInboxFilter(rows, "needs_reply").map((r) => r.conversation_id);
    assert.deepEqual(out, ["e", "c", "a", "d"]);
    assert.deepEqual(rows.map((r) => r.conversation_id), ["a", "b", "c", "d", "e"], "the server order the All filter shows is not mutated");
    assert.deepEqual(applyInboxFilter(rows, "all").map((r) => r.conversation_id), ["a", "b", "c", "d", "e"]);
  });

  it("M-4 Mine and Plan this week trust only real facts (no truthy strings, no zero counts, no missing host)", () => {
    const rows = [
      group("a", { host: { mine: true, plan: { this_week: 2 } } }),
      group("b", { host: { mine: "true", plan: { this_week: "0" } } }),
      group("c", { host: null }),
      group("d", { host: { mine: false, plan: null } }),
      group("e", { host: { mine: 1, plan: { this_week: -1 } } }),
    ];
    assert.deepEqual(applyInboxFilter(rows, "mine").map((r) => r.conversation_id), ["a"]);
    assert.deepEqual(applyInboxFilter(rows, "plan_week").map((r) => r.conversation_id), ["a"]);
  });

  it("M-5 search: blank queries change nothing; a match on the host card name works with no host on other rows", () => {
    const rows = [group("a", { brand_name: "Harmattan Club", host: null }), group("b", { brand_name: "Ox", host: { name: "Ade Harmattan" } })];
    assert.equal(applyInboxFilter(rows, "all", "   ").length, 2);
    assert.deepEqual(applyInboxFilter(rows, "all", "  ADE ").map((r) => r.conversation_id), ["b"]);
    assert.deepEqual(applyInboxFilter(rows, "all", "harmattan").map((r) => r.conversation_id), ["a", "b"]);
  });

  it("M-6 default filter and summary: nobody waiting means All and no summary line", () => {
    assert.equal(defaultInboxFilter([]), "all");
    assert.equal(defaultInboxFilter(null), "all");
    assert.equal(defaultInboxFilter([group("a", { waiting_since: null })]), "all");
    assert.equal(inboxSummaryWords(inboxSummary([group("a")], NOW)), "");
    const s = inboxSummary([group("a", { waiting_since: at(20 * MIN) }), group("b", { waiting_since: at(20 * DAY) })], NOW);
    assert.deepEqual(s, { waiting: 2, oldest: "14d+" });
    assert.equal(inboxSummaryWords(s), "2 groups waiting on Mingla · oldest 14d+");
  });

  it("M-7 degraded merge: with no inbox facts every group still shows, with no wait and no host", () => {
    const out = mergeInbox([group("a"), group("b")], []);
    assert.equal(out.length, 2);
    for (const row of out) {
      assert.equal(row.waiting_since, null);
      assert.equal(row.host, null);
    }
    const stray = mergeInbox([group("a")], [{ conversation_id: "zzz", waiting_since: at(MIN), host: null }]);
    assert.deepEqual(stray.map((r) => r.conversation_id), ["a"], "a fact for a group not in the list never adds a row");
    assert.equal(stray[0].waiting_since, null);
  });

  it("M-8 light refresh keeps the plan of the last full read, and only for the same group", () => {
    const plan = { next: { title: "Doors", on: "2026-11-08" }, this_week: 1 };
    const out = mergeInbox([group("a"), group("b")],
      [{ conversation_id: "a", host: { name: "A", plan: null } }, { conversation_id: "b", host: { name: "B", plan: null } }],
      { a: plan });
    assert.deepEqual(out[0].host.plan, plan);
    assert.equal(out[1].host.plan, null);
  });

  it("M-9 folding: a host message between plan lines splits the card; midnight splits it too", () => {
    const line = (id, iso) => ({ id, sender_id: null, message_type: "system", content: `Seth added “${id}” to the plan.`, created_at: iso });
    const lateNight = new Date(2026, 10, 6, 23, 59, 0).toISOString();
    const pastMidnight = new Date(2026, 10, 7, 0, 1, 0).toISOString();
    const entries = foldThread([
      line("p1", lateNight),
      line("p2", pastMidnight),
      { id: "m1", sender_id: U1, message_type: "text", content: "hi", created_at: new Date(2026, 10, 7, 0, 2, 0).toISOString() },
      line("p3", new Date(2026, 10, 7, 0, 3, 0).toISOString()),
      { id: "e1", sender_id: U1, message_type: "brand_enquiry_card", content: "{}", created_at: new Date(2026, 10, 7, 0, 4, 0).toISOString() },
    ], new Date(NOW));
    assert.deepEqual(entries.map((e) => e.type), ["day", "plan", "day", "plan", "message", "plan", "message"]);
    assert.deepEqual(entries.filter((e) => e.type === "plan").map((e) => e.lines.map((l) => l.id)), [["p1"], ["p2"], ["p3"]]);
    assert.equal(new Set(entries.map((e) => e.key)).size, entries.length, "every entry has its own key");
  });

  it("M-10 a system line written by a person is not a plan line and is never folded", () => {
    const entries = foldThread([
      { id: "s1", sender_id: U1, message_type: "system", content: "Ada created the group.", created_at: at(2 * MIN) },
      { id: "p1", sender_id: null, message_type: "system", content: "Seth added “A” to the plan.", created_at: at(MIN) },
    ], new Date(NOW));
    assert.deepEqual(entries.filter((e) => e.type !== "day").map((e) => e.type), ["message", "plan"]);
  });

  it("M-11 plan-line titles: the last quoted title wins; no quotes means no title", () => {
    assert.equal(planLineTitle("Seth renamed “Old” to “New name”."), "New name");
    assert.equal(planLineTitle("Seth moved “Menu reveal” to Sun 8 Nov."), "Menu reveal");
    assert.equal(planLineTitle("Seth added a plan item."), "");
    assert.equal(planLineTitle(null), "");
    assert.equal(planLineTitle("Seth added “” to the plan."), "");
  });

  it("M-12 matching: events never match; emoji, odd spacing and a 160-character title do; ' · Brand (2)' is unwrapped", () => {
    const long = "L".repeat(150) + " ten chars";
    const items = [
      { kind: "event", id: "e1", title: "Doors open" },
      { kind: "post", id: "p1", title: "🔥 Lineup   Reveal" },
      { kind: "task", id: "t1", title: long },
      { kind: "post", id: "p2", title: "Menu drop · Harmattan Club (2)" },
    ];
    assert.equal(matchPlanLine("Seth added “Doors open” to the plan.", items, "Harmattan Club"), null, "an event title is not a plan line target");
    assert.equal(matchPlanLine("Seth added “🔥 lineup reveal” to the plan.", items, "Harmattan Club")?.id, "p1");
    assert.equal(matchPlanLine(`Seth added “${long}” to the plan.`, items, "Harmattan Club")?.id, "t1");
    assert.equal(matchPlanLine("Seth added “Menu drop” to the plan.", items, "Harmattan Club")?.id, "p2");
    assert.equal(matchPlanLine("Seth removed “Gone” from the plan.", items, "Harmattan Club"), null, "a removed item is plain text");
    assert.equal(matchPlanLine("Seth added “Menu drop” to the plan.", items, ""), null, "without the brand name the suffix is not stripped");
    assert.equal(matchPlanLine("no quotes here", items, "Harmattan Club"), null);
  });

  it("M-13 activity words: different people, or a non-add line, read as plan updates", () => {
    assert.equal(planActivityWords([{ content: "Seth added “A” to the plan." }, { content: "Ada added “B” to the plan." }]), "2 plan updates");
    assert.equal(planActivityWords([{ content: "Seth added “A” to the plan." }, { content: "Seth moved “A” to Sun." }]), "2 plan updates");
    assert.equal(planActivityWords(["Seth added “A” to the plan."]), "Seth added 1 item to the plan");
    assert.equal(planActivityWords([]), "0 plan updates");
  });

  it("M-14 Try again: someone else's identical words, or my own from before the send, do not count as landed", () => {
    const item = { content: "  On our way  ", at: NOW };
    assert.equal(sendLanded([{ sender_id: U1, content: "On our way", created_at: at(-1000) }], item, ME), false, "a teammate's same words are not my send");
    assert.equal(sendLanded([{ sender_id: ME, content: "On our way", created_at: at(6_000) }], item, ME), false, "my same words 6 s before the send are an older message");
    assert.equal(sendLanded([{ sender_id: ME, content: "On our way", created_at: at(4_000) }], item, ME), true);
    assert.equal(sendLanded([{ sender_id: ME, content: "On our way!", created_at: at(-1000) }], item, ME), false, "different words never match");
    assert.equal(sendLanded(null, item, ME), false);
  });

  it("M-15 Seen by: only reads at or after the message, first names, +N beyond two", () => {
    const msg = { created_at: at(10 * MIN) };
    const reads = [
      { display_name: "Ada Obi", last_read_at: at(11 * MIN) },
      { display_name: "Kim Lee", last_read_at: at(10 * MIN) },
      { display_name: "Tolu A", last_read_at: at(MIN) },
      { display_name: "Zara", last_read_at: at(0) },
      { display_name: "Bad", last_read_at: "nope" },
    ];
    assert.equal(seenByWords(reads, msg), "Seen by Kim, Tolu +1");
    assert.equal(seenByWords(reads, { created_at: "nope" }), "");
    assert.equal(seenByWords([], msg), "");
  });

  it("M-16 typing words: blank and non-string names are dropped, three or more become a count", () => {
    assert.equal(typingWords(["", "   ", 42, null]), null);
    assert.equal(typingWords(["Ada Obi", "", "Kim"]), "Ada and Kim are typing…");
    assert.equal(typingWords(["a", "b", "c", "d"]), "4 people are typing…");
  });

  it("M-17 reactions: unknown emoji sort last; a toggle only ever removes the viewer's own row", () => {
    const rows = [
      { id: "r1", message_id: "m", user_id: U1, emoji: "🦄" },
      { id: "r2", message_id: "m", user_id: U1, emoji: "🔥" },
      { id: "r3", message_id: "m", user_id: ME, emoji: "❤️" },
      { id: "r4", message_id: "m", user_id: U2, emoji: "❤️" },
      { id: "bad", message_id: null, user_id: U1, emoji: "❤️" },
    ];
    const pills = summariseReactions(rows, ME).get("m");
    assert.deepEqual(pills.map((p) => [p.emoji, p.count, p.mine]), [["❤️", 2, true], ["🔥", 1, false], ["🦄", 1, false]]);
    assert.deepEqual(reactionToggle(rows, "m", "🔥", ME), { action: "add" }, "another person's 🔥 is never removed by me");
    assert.deepEqual(reactionToggle(rows, "m", "❤️", ME), { action: "remove", rowId: "r3" });
    assert.deepEqual(reactionToggle(rows, "other", "❤️", ME), { action: "add" });
  });

  it("M-18 Add to plan prefill: a long title is cut at a word, the note stays within 500 characters", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const out = planPrefillFromMessages([
      { sender_display_name: "Ada", content: `${words}\n\n` },
      { sender_display_name: "", content: "x".repeat(600) },
      { sender_display_name: "Kim", content: "   " },
    ]);
    assert.ok(out.title.length <= 160, `title ${out.title.length} chars`);
    assert.ok(!/\s$/.test(out.title) && !out.title.includes("\n"));
    assert.ok(words.startsWith(out.title), "the title is a whole-word prefix");
    assert.ok(out.note.length <= 500, `note ${out.note.length} chars`);
    assert.ok(out.note.startsWith("From the Brand group: Ada: word0"));
    assert.ok(out.note.includes("Someone: x"), "a sender with no name is 'Someone'");
    assert.ok(!out.note.includes("Kim"), "a blank message adds nothing");
    assert.deepEqual(planPrefillFromMessages([]), { title: "", note: "" });
  });

  // ── Known defects (todo until fixed) ─────────────────────────────────────
  it("M-D1 matching prefers the exact title over a ' (2)' sibling listed earlier", {
    todo: "#4270 W7 test report D-3: matchPlanLine returns the first loose match, so a line naming “Lineup reveal” opens “Lineup reveal (2)”",
  }, () => {
    const items = [
      { kind: "post", id: "dup", title: "Lineup reveal (2)", on: "2026-11-08" },
      { kind: "post", id: "exact", title: "Lineup reveal", on: "2026-11-09" },
    ];
    assert.equal(matchPlanLine("Seth added “Lineup reveal” to the plan.", items, "Harmattan Club")?.id, "exact");
  });

  it("M-D2 a teammate whose display name is an address is never shown by that address", {
    todo: "#4270 W7 test report D-4: previewWords and seenByWords print email-shaped names from the #4304 reads (2 of 113 brand teammates in production)",
  }, () => {
    const preview = previewWords({ last_message_preview: "hi", last_message_sender_id: U1, last_message_sender_name: "ada@club.example" }, ME);
    assert.ok(!preview.includes("@"), preview);
    const seen = seenByWords([{ display_name: "kim@club.example", last_read_at: at(0) }], { created_at: at(MIN) });
    assert.ok(!seen.includes("@"), seen);
  });

  it("M-D3 Try again treats a send as landed when the browser clock runs a little ahead of the server", {
    todo: "#4270 W7 test report D-7: sendLanded compares the browser's send time with the server's created_at, so a clock 10 s fast resends a message that already landed",
  }, () => {
    const browserAt = NOW + 10_000; // the browser's clock is 10 s fast
    assert.equal(sendLanded([{ sender_id: ME, content: "On our way", created_at: new Date(NOW + 500).toISOString() }], { content: "On our way", at: browserAt }, ME), true);
  });
});

describe("P the side panel address under tampering", () => {
  it("P-1 calendar exists only on Brand groups: other pages refuse side=calendar", () => {
    assert.ok(!SIDE_KINDS.includes("calendar"));
    assert.ok(BRAND_GROUP_SIDE_KINDS.includes("calendar"));
    assert.equal(parseSide(`side=calendar:${U1}`), null, "the Work page (default kinds) ignores a calendar side");
    assert.deepEqual(parseSide(`side=calendar:${U1}`, BRAND_GROUP_SIDE_KINDS), { kind: "calendar", id: U1 });
  });

  it("P-2 a tampered side never parses: path-like, over-long, unknown kind, empty id, double colon", () => {
    for (const value of [
      "brand:../../x",
      `brand:${U1}/../../admin`,
      `host:${U1}${"0".repeat(81 - 41)}`,
      `${"x".repeat(81)}`,
      `nope:${U1}`,
      "brand:",
      `:${U1}`,
      `brand::${U1}`,
      `brand:${U1}?side=host:${U2}`,
      "drafts:../all",
    ]) {
      assert.equal(parseSideValue(value, BRAND_GROUP_SIDE_KINDS), null, value);
    }
    assert.deepEqual(parseSideValue(`brand:${U1.toUpperCase()}`, BRAND_GROUP_SIDE_KINDS), { kind: "brand", id: U1 }, "ids are lower-cased");
  });

  it("P-3 the view drops a rail tab it does not know and a side it cannot parse", () => {
    const v = brandGroupView(`tab=brand-groups&group=g1&rail=admin&side=brand:../../x`);
    assert.equal(v.rail, "");
    assert.equal(v.side, null);
    assert.equal(v.host, "");
    assert.equal(brandGroupView("rail=media").rail, "media");
  });

  it("P-4 address writes: side null removes only the side; a bad rail is removed, a good one kept", () => {
    const start = `tab=brand-groups&group=g1&rail=host&side=calendar:${U1}`;
    const closed = new URLSearchParams(brandGroupSearch(start, { side: null }));
    assert.equal(closed.get("side"), null);
    assert.equal(closed.get("group"), "g1");
    assert.equal(closed.get("rail"), "host");
    const badRail = new URLSearchParams(brandGroupSearch(start, { rail: "javascript:alert(1)" }));
    assert.equal(badRail.get("rail"), null);
    const opened = new URLSearchParams(brandGroupSearch("tab=brand-groups&group=g1", { side: { kind: "calendar", id: U2 } }));
    assert.equal(opened.get("side"), `calendar:${U2}`, "the calendar kind survives a Brand group address write");
    const tampered = new URLSearchParams(brandGroupSearch("tab=brand-groups", { side: { kind: "nope", id: U2 } }));
    assert.equal(tampered.get("side"), null);
    assert.equal(tampered.get("tab"), "brand-groups");
  });

  it("P-5 close steps: only a positive whole count walks history back; anything else pushes", () => {
    for (const odd of [0, -1, -3, 1.5, NaN, null, undefined, "x", Infinity]) {
      assert.deepEqual(sideCloseStep(odd), { kind: "push" }, String(odd));
    }
    assert.deepEqual(sideCloseStep(1), { kind: "go", delta: -1 });
    assert.deepEqual(sideCloseStep(4), { kind: "go", delta: -4 });
  });
});
