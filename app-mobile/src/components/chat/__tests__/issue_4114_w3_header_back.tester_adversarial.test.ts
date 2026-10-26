// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 3 — tester adversarial suite for the collab header strip and
// Android back in a thread. The implementor suite checks the normal strip; this
// one attacks the boundaries:
//   * every plan in the past and no matches: the strip shows only the muted
//     last plan, never "+N more", never a matches cell;
//   * a plan at exactly "now" is upcoming; an unparseable date is never upcoming;
//   * nothing to show hides the strip (no empty bar);
//   * matches seen by saved-card id: a re-fetched match with a new row id but the
//     same card stays seen;
//   * Android back with nested layers always closes the top-most one first, and
//     a layer flagged false never swallows the press.
//
// FAILS-ON-REVERT: sort Past oldest-first, count past plans in moreCount, or
// reorder CHAT_BACK_LAYERS so a sheet closes before the context menu above it,
// and this suite fails.

import { buildCollabHeaderStrip, groupPlans, hasUnseenMatches, matchKey } from "../chatHeaderModel.ts";
import { CHAT_BACK_LAYERS, resolveChatBack } from "../../../utils/threadModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const NOW = Date.parse("2026-10-26T18:00:00.000Z");
const plan = (id: string, offsetMs: number, title = id) => ({
  savedCardId: id,
  cardData: { title },
  scheduledAt: new Date(NOW + offsetMs).toISOString(),
});
const strip = (over: Record<string, unknown>) =>
  buildCollabHeaderStrip({
    actionIds: [],
    matches: [],
    matchesLoading: false,
    plans: [],
    plansLoading: false,
    seenMatchIds: new Set(),
    now: NOW,
    untitled: "Untitled plan",
    ...over,
  });

Deno.test("#4114 W3 adversarial: all plans past and no matches shows only the latest past plan, muted", () => {
  const model = strip({
    actionIds: ["plans"],
    plans: [plan("oldest", -10 * 86400000), plan("latest", -3600000), plan("middle", -86400000)],
  });
  assert(model.visible, "the strip shows (there is a plan)");
  assertEquals(model.matches, null, "no matches cell without the matches action");
  assertEquals(model.plan?.state, "past", "muted past state");
  assertEquals(model.plan?.title, "latest", "the most recent past plan, not the oldest");
  assertEquals(model.plan?.moreCount, 0, "past plans never count as +N more");
});

Deno.test("#4114 W3 adversarial: a plan at exactly now is upcoming; a bad date never is", () => {
  const { upcoming, past } = groupPlans([
    { scheduledAt: new Date(NOW).toISOString() },
    { scheduledAt: "not-a-date" },
    { scheduledAt: "" },
  ], NOW);
  assertEquals(upcoming.length, 1, "now is upcoming");
  assertEquals(past.length, 2, "unparseable dates fall to Past, never Upcoming");
  const model = strip({ actionIds: ["plans"], plans: [plan("past", -1), plan("next", 1), plan("later", 2)] });
  assertEquals([model.plan?.state, model.plan?.title, model.plan?.moreCount], ["upcoming", "next", 1], "one upcoming beats past; +1 more");
});

Deno.test("#4114 W3 adversarial: nothing to show hides the strip entirely", () => {
  const model = strip({ actionIds: ["swipe"] });
  assertEquals([model.visible, model.matches, model.plan], [false, null, null], "only the swipe action: no strip");
});

Deno.test("#4114 W3 adversarial: a match re-fetched under a new row id stays seen by its card id", () => {
  const first = { id: "row-1", saved_card_id: "card-9" };
  const refetched = { id: "row-2", saved_card_id: "card-9" };
  assertEquals(matchKey(first), matchKey(refetched), "seen is keyed by card");
  assert(!hasUnseenMatches([matchKey(refetched)], new Set([matchKey(first)])), "no false unseen dot after a refetch");
  assert(hasUnseenMatches([matchKey({ id: "row-3", saved_card_id: "card-10" })], new Set(["card-9"])), "a new card is unseen");
  const model = strip({ actionIds: ["matches"], matches: [first], matchesLoading: true, seenMatchIds: new Set(["card-9"]) });
  assertEquals([model.matches?.count, model.matches?.loading, model.matches?.hasUnseen], [1, false, false], "loaded rows never show a spinner");
});

Deno.test("#4114 W3 adversarial: Android back closes the top-most nested layer first and never a false one", () => {
  assertEquals(resolveChatBack({}), "leaveThread", "nothing open: leave the thread");
  assertEquals(resolveChatBack({ contextMenu: false, mediaSheet: false }), "leaveThread", "false flags never swallow back");
  const nested: Array<[Record<string, boolean>, string]> = [
    [{ mediaSheet: true, imagePreview: true }, "imagePreview"],
    [{ groupInfo: true, eventDetail: true }, "eventDetail"],
    [{ collabMatches: true, expandedCard: true }, "expandedCard"],
    [{ moreMenu: true, contextMenu: true }, "contextMenu"],
    [{ collabDeck: true, collabPrefs: true, contextMenu: true }, "contextMenu"],
  ];
  for (const [open, expected] of nested) {
    assertEquals(resolveChatBack(open), expected, `open ${Object.keys(open).join("+")}`);
  }
  // Pressing back repeatedly unwinds every layer and then leaves.
  const open: Record<string, boolean> = Object.fromEntries(CHAT_BACK_LAYERS.map((layer) => [layer, true]));
  const closed: string[] = [];
  for (let i = 0; i <= CHAT_BACK_LAYERS.length; i += 1) {
    const target = resolveChatBack(open);
    closed.push(target);
    if (target !== "leaveThread") open[target] = false;
  }
  assertEquals(closed.length, CHAT_BACK_LAYERS.length + 1, "one press per layer, then leave");
  assertEquals(closed[closed.length - 1], "leaveThread", "the thread closes last");
  assertEquals(new Set(closed).size, closed.length, "no layer closes twice");
});
