// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4261 Wave B2 — the plans-in-chats pure model (spec 5.7) and the
// wiring rules the phone owns.
//
// FAILS-ON-REVERT:
// - orderMatches without the needs-my-vote sort → the Matches ordering case fails.
// - planQuoteNote / viewerQuoteSnapshot reading anyone's votes but the viewer's
//   → the "quote from my own picks" case fails.
// - lockableLeader / canLockWithoutVote ignoring `canLock` (creator / session
//   admin, server-decided) → the lock gating case fails.
// - a vote / RSVP / thumbs mutation or service that posts a chat line
//   (sendMessage, messages insert, notify) → the "votes post no chat line" case fails.
// - mergePlaceResults putting Mapbox rows (or the typed row) before pool rows
//   → the place order case fails.
// MINGLA-INVARIANT: I-4261-PLACE-SEARCH-POOL-FIRST | issue #4261 | Place results list Mingla pool rows before Mapbox rows, and the typed address row last.

import {
  applyReactionPatch,
  applyRsvpPatch,
  applyVotePatch,
  blankPlanForm,
  canLockWithoutVote,
  canPostPlan,
  chatPlanKindOf,
  formatPlanTime,
  isFutureSlot,
  leadingOption,
  linkDomainOf,
  lockableLeader,
  mergePlaceResults,
  needsMyVote,
  orderMatches,
  parsePlanQuote,
  planErrorKey,
  planHeaderInputs,
  planQuoteNote,
  quickDays,
  rsvpSummary,
  shortPlanTime,
  suggestRandomSlot,
  toggledChoice,
  viewerQuoteSnapshot,
} from "../planModel.ts";
import { buildCollabHeaderStrip, planStripTap } from "../chatHeaderModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

const ME = "me";
const plan = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  source: "chat",
  sessionId: null,
  savedCardId: null,
  messageId: `m-${id}`,
  messageVisible: true,
  createdBy: "ada",
  createdByName: "Ada",
  title: id,
  whereKind: "none",
  place: null,
  link: null,
  whenMode: "poll",
  openTimes: true,
  status: "deciding",
  scheduledAt: null,
  durationMinutes: null,
  lockedAt: null,
  lockedBy: null,
  note: null,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  options: [],
  rsvps: { going: [], maybe: [], cant: [] },
  reactions: { up: [], down: [] },
  commentCount: 0,
  canLock: false,
  canEdit: false,
  canCancel: false,
  canAddTime: true,
  ...over,
});
const option = (id: string, startsAt: string, voterIds: string[] = []) => ({ id, startsAt, addedBy: "ada", voterIds });

// en strings for the quote note (chat.json values).
const EN: Record<string, string> = {
  plan_quote_you_voted: "You voted {{times}}",
  plan_quote_and: "{{list}} and {{last}}",
  plan_quote_going: "you're going",
  plan_quote_maybe: "you said maybe",
  plan_quote_cant: "you can't make it",
  plan_quote_voting: "Voting on a time",
};
const t = (key: string, params: Record<string, unknown> = {}) =>
  (EN[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params[name] ?? ""));

Deno.test("canPost matrix (prototype canPost)", () => {
  const base = blankPlanForm();
  assertEquals(canPostPlan(base), false, "nothing typed: no post");
  assertEquals(canPostPlan({ ...base, title: "Rooftop" }), true, "title + vote with open times");
  assertEquals(canPostPlan({ ...base, title: "Rooftop", openTimes: false }), false, "closed vote needs two times");
  assertEquals(
    canPostPlan({ ...base, title: "Rooftop", openTimes: false, options: [{ date: "2026-11-06", time: "19:00" }, { date: "2026-11-07", time: "20:00" }] }),
    true,
    "closed vote with two times",
  );
  assertEquals(canPostPlan({ ...base, title: "x", when: "set" }), false, "set time needs a date");
  assertEquals(canPostPlan({ ...base, when: "set", date: "2026-11-06", where: "place", place: { source: "typed", name: "Kemi's", area: null } }), true, "a place stands in for a title");
  assertEquals(canPostPlan({ ...base, where: "link", link: "tickets.example.com/x" }), true, "a link domain stands in for a title");
  assertEquals(canPostPlan({ ...base, where: "link", link: "not a link" }), false, "a non-link is no title");
  assertEquals(linkDomainOf("https://www.Example.com/a"), "example.com", "domain without www");
});

Deno.test("leader: most votes, a tie goes to the earliest time", () => {
  const a = option("a", "2026-11-07T19:00:00Z", ["x"]);
  const b = option("b", "2026-11-06T19:00:00Z", ["y"]);
  const c = option("c", "2026-11-08T19:00:00Z", ["x", "y"]);
  assertEquals(leadingOption([a, b])?.id, "b", "tie → earliest");
  assertEquals(leadingOption([a, b, c])?.id, "c", "most votes wins");
  assertEquals(leadingOption([]), null, "no options, no leader");
});

Deno.test("needs my vote and Matches order: needs-your-vote first, then newest", () => {
  const voted = plan("voted", {
    createdAt: "2026-11-03T10:00:00Z",
    options: [option("o1", "2026-11-06T19:00:00Z", [ME])],
    reactions: { up: [ME], down: [] },
  });
  const noThumbs = plan("noThumbs", { createdAt: "2026-11-01T10:00:00Z", whenMode: "none" });
  const pollPending = plan("pollPending", {
    createdAt: "2026-11-02T10:00:00Z",
    options: [option("o2", "2026-11-06T19:00:00Z", ["ada"])],
    reactions: { up: [ME], down: [] },
  });
  const locked = plan("locked", { status: "scheduled", scheduledAt: "2026-11-09T19:00:00Z" });
  assertEquals(needsMyVote(voted, ME), false, "voted + thumbs: nothing to do");
  assertEquals(needsMyVote(noThumbs, ME), true, "no thumbs from me");
  assertEquals(needsMyVote(pollPending, ME), true, "a time vote I have not answered");
  assertEquals(
    orderMatches([voted, noThumbs, pollPending, locked], ME).map((p) => p.id),
    ["pollPending", "noThumbs", "voted"],
    "needs-vote first (newest first among them), locked plans left out",
  );
});

Deno.test("lock gating: only a locker (creator / session admin) and only with a voted leader", () => {
  const options = [option("o1", "2026-11-06T19:00:00Z", ["ada"]), option("o2", "2026-11-07T19:00:00Z")];
  assertEquals(lockableLeader(plan("p", { options, canLock: false })), null, "not the creator or an admin: no lock");
  assertEquals(lockableLeader(plan("p", { options, canLock: true }))?.id, "o1", "the locker gets the leader");
  assertEquals(
    lockableLeader(plan("p", { options: [option("o3", "2026-11-06T19:00:00Z")], canLock: true })),
    null,
    "a leader with no votes cannot be locked in",
  );
  assertEquals(canLockWithoutVote(plan("p", { canLock: false })), false, "no time vote, not a locker: no Lock it in");
  assertEquals(canLockWithoutVote(plan("p", { canLock: true })), true, "no time vote, locker: Lock it in");
  assertEquals(canLockWithoutVote(plan("p", { canLock: true, status: "scheduled" })), false, "locked plans stay locked");
  assertEquals(planErrorKey("not_allowed", "lock", "chat"), "plan_only_creator_locks", "chat lock refusal copy");
  assertEquals(planErrorKey("not_allowed", "lock", "deck"), "plan_only_admin_locks", "deck lock refusal copy");
  assertEquals(planErrorKey("conflict_too_many_times", "addTime"), "plan_too_many_times", "9th time copy");
  assertEquals(planErrorKey("unavailable", "rsvp"), "plan_unavailable", "block copy");
});

Deno.test("the quote is built from the viewer's own picks only", () => {
  const p = plan("Rooftop", {
    options: [
      option("o1", "2026-11-06T20:00:00Z", [ME, "ada"]),
      option("o2", "2026-11-07T19:00:00Z", [ME]),
      option("o3", "2026-11-08T16:00:00Z", ["ada"]),
    ],
    rsvps: { going: [ME], maybe: ["ada"], cant: [] },
  });
  const mine = viewerQuoteSnapshot(p, ME);
  assertEquals(mine.votedStartsAt, ["2026-11-06T20:00:00Z", "2026-11-07T19:00:00Z"], "only my two votes");
  assertEquals(mine.rsvp, "going", "my RSVP, not Ada's maybe");
  assertEquals(
    planQuoteNote(mine, "en-US", "UTC", t),
    "You voted Fri 8:00 PM and Sat 7:00 PM, you're going",
    "localised note from my picks",
  );
  const ada = viewerQuoteSnapshot(p, "ada");
  assertEquals(planQuoteNote(ada, "en-US", "UTC", t), "You voted Fri 8:00 PM and Sun 4:00 PM, you said maybe", "Ada's own note differs");
  assertEquals(planQuoteNote({ votedStartsAt: [], rsvp: null }, "en-US", "UTC", t), "Voting on a time", "nothing picked");
  assertEquals(planQuoteNote({ votedStartsAt: [], rsvp: "cant" }, "en-US", "UTC", t), "You can't make it", "capitalised");
  assertEquals(parsePlanQuote({ title: "X", votedStartsAt: ["a", 3], rsvp: "nope" }), { title: "X", votedStartsAt: ["a"], rsvp: null }, "defensive parse");
  assertEquals(parsePlanQuote(null), null, "no snapshot");
});

Deno.test("time labels come from Intl", () => {
  assertEquals(formatPlanTime("2026-11-06T20:00:00Z", "en-US", "UTC"), "Fri 6 Nov · 8:00 PM", "long label");
  assertEquals(shortPlanTime("2026-11-06T20:00:00Z", "en-US", "UTC"), "Fri 8:00 PM", "lock label");
  assertEquals(formatPlanTime("nope", "en-US", "UTC"), "", "bad input");
});

Deno.test("RSVP summary, toggles and optimistic patches", () => {
  const p = plan("p", { rsvps: { going: ["a", "b"], maybe: ["c"], cant: [] }, options: [option("o1", "2026-11-06T19:00:00Z")] });
  assertEquals(rsvpSummary(p), { going: 2, maybe: 1, cant: 0 }, "counts");
  assertEquals(toggledChoice("going", "going"), null, "tap the same again clears");
  assertEquals(toggledChoice("maybe", "going"), "going", "tap another switches");
  const payload = { viewerId: ME, memberCount: 4, historyVisibleFrom: null, plans: [p] };
  const voted = applyVotePatch(payload, "o1", ME, true);
  assertEquals(voted.plans[0].options[0].voterIds, [ME], "vote on");
  assertEquals(applyVotePatch(voted, "o1", ME, false).plans[0].options[0].voterIds, [], "vote off");
  const rsvp = applyRsvpPatch(payload, "p", "c", "going");
  assertEquals([rsvp.plans[0].rsvps.going, rsvp.plans[0].rsvps.maybe], [["a", "b", "c"], []], "RSVP moves");
  const thumbs = applyReactionPatch(payload, "p", ME, "down");
  assertEquals(thumbs.plans[0].reactions, { up: [], down: [ME] }, "thumbs down");
  assertEquals(payload.plans[0].options[0].voterIds, [], "patches never mutate the cached payload");
});

Deno.test("suggest a random time: future, never a duplicate, null when full", () => {
  const now = new Date(2026, 10, 3, 12, 0); // Tue 3 Nov, noon
  const all: Array<{ date: string; time: string }> = [];
  for (let i = 0; i < 20; i += 1) {
    const slot = suggestRandomSlot(all, now, () => 0);
    if (!slot) break;
    assert(isFutureSlot(slot, now), "never in the past");
    assert(!all.some((s) => s.date === slot.date && s.time === slot.time), "never a duplicate");
    all.push(slot);
  }
  assertEquals(all.length, 7, "seven Thu–Sun evening / weekend slots in the next week");
  assertEquals(suggestRandomSlot(all, now, () => 0.5), null, "null when every slot is taken");
  const lateSunday = new Date(2026, 10, 8, 18, 0); // Sun 8 Nov 18:00
  const next = suggestRandomSlot([], lateSunday, () => 0);
  assert(next && next.date !== "2026-11-08", "past Sunday slots are skipped");
});

Deno.test("quick days across a week boundary", () => {
  assertEquals(
    quickDays(new Date(2026, 10, 3, 9)).map((d) => d.date),
    ["2026-11-03", "2026-11-04", "2026-11-06", "2026-11-07"],
    "Tue: tonight, tomorrow, Fri, Sat",
  );
  assertEquals(
    quickDays(new Date(2026, 10, 6, 9)).map((d) => d.date),
    ["2026-11-06", "2026-11-07", "2026-11-13", "2026-11-14"],
    "Fri: next Fri and Sat are after tomorrow",
  );
  assertEquals(
    quickDays(new Date(2026, 11, 31, 9)).map((d) => d.date),
    ["2026-12-31", "2027-01-01", "2027-01-08", "2027-01-02"],
    "Thu 31 Dec crosses the year",
  );
});

Deno.test("chatPlanKindOf for every chat kind", () => {
  assertEquals(chatPlanKindOf({ isGroupChat: false }), "direct", "1:1");
  assertEquals(chatPlanKindOf({ isGroupChat: false, isBlocked: true }), null, "blocked 1:1");
  assertEquals(chatPlanKindOf({ isGroupChat: false, isUnfriended: true }), null, "unfriended 1:1");
  assertEquals(chatPlanKindOf({ isGroupChat: false, isDeletedAccount: true }), null, "deleted account");
  assertEquals(chatPlanKindOf({ isGroupChat: true, linkedEntityType: "session", sessionId: "s" }), "session", "collab group");
  assertEquals(chatPlanKindOf({ isGroupChat: true, linkedEntityType: "direct" }), "plain", "plain group");
  assertEquals(chatPlanKindOf({ isGroupChat: true, linkedEntityType: "trip" }), null, "trip chat");
  assertEquals(chatPlanKindOf({ isGroupChat: true, linkedEntityType: "event" }), null, "event chat");
  assertEquals(chatPlanKindOf({ isGroupChat: true, linkedEntityType: "direct", programKind: "local" }), null, "program chat");
  assertEquals(chatPlanKindOf({ isGroupChat: true, linkedEntityType: "event", isBrandChannel: true }), null, "brand channel");
  assertEquals(chatPlanKindOf({ isGroupChat: false, isEnquiry: true }), null, "brand enquiry");
});

Deno.test("place results: pool first, Mapbox next (de-duped), typed row last", () => {
  const rows = mergePlaceResults(
    [{ id: "p1", name: "Skyline Terrace", area: "Victoria Island, Lagos", lat: 6.4, lng: 3.4 }],
    [
      { mapboxId: "m1", name: "Skyline terrace", area: "Victoria Island, Lagos" },
      { mapboxId: "m2", name: "Terrace Park", area: "Ozumba Mbadiwe Ave" },
    ],
    "sky",
  );
  assertEquals(rows.map((r) => r.kind), ["pool", "mapbox", "typed"], "order");
  assertEquals(rows[0].onMingla, true, "pool rows are On Mingla");
  assertEquals(rows[1].name, "Terrace Park", "the Mapbox copy of a pool place is dropped");
  assertEquals(mergePlaceResults([], [], "  "), [], "no typed row for an empty query");
});

Deno.test("votes, RSVPs and thumbs post no chat line (phone side)", async () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const service = strip(await Deno.readTextFile(new URL("../../../services/chatPlansService.ts", import.meta.url)));
  for (const fn of ["setPlanVote", "setPlanRsvp", "setPlanReaction"]) {
    const at = service.indexOf(`export function ${fn}(`);
    assert(at >= 0, `${fn} exists`);
    const body = service.slice(at, service.indexOf("\n}\n", at));
    assert(/call<[^>]+>\('plan_set_(vote|rsvp|reaction)'/.test(body), `${fn} is one plan RPC`);
    assert(!/from\('messages'\)|sendMessage|notify/.test(body), `${fn} writes no chat message`);
  }
  const hooks = strip(await Deno.readTextFile(new URL("../../../hooks/useChatPlans.ts", import.meta.url)));
  for (const hook of ["useSetPlanVote", "useSetPlanRsvp", "useSetPlanReaction"]) {
    const at = hooks.indexOf(`export function ${hook}(`);
    assert(at >= 0, `${hook} exists`);
    const body = hooks.slice(at, hooks.indexOf("\n}\n", at));
    assert(!/notifyPlanMessage|sendMessage|notify-message/.test(body), `${hook} sends no push and no chat line`);
    assert(/onMutate:/.test(body) && /rollback\(/.test(body), `${hook} is optimistic with a rollback`);
  }
});

Deno.test("header strip from the plan list: Matches {n}, {n} to vote, next plan opens its card", () => {
  const plans = [
    plan("todo", { reactions: { up: [], down: [] } }),
    plan("done", { reactions: { up: [ME], down: [] } }),
    plan("chatLocked", { status: "scheduled", scheduledAt: "2099-01-02T19:00:00Z" }),
    plan("deckLocked", { source: "deck", savedCardId: "sc1", cardData: { title: "Afro jazz" }, status: "scheduled", scheduledAt: "2099-01-03T19:00:00Z" }),
  ];
  const inputs = planHeaderInputs(plans, ME);
  const strip = buildCollabHeaderStrip({
    actionIds: ["matches", "swipe", "plans"],
    matches: inputs.matches,
    matchesLoading: false,
    plans: inputs.scheduled,
    plansLoading: false,
    seenMatchIds: new Set(),
    now: Date.parse("2026-11-03T12:00:00Z"),
    untitled: "A plan",
  });
  assertEquals(strip.matches?.count, 2, "two plans being decided");
  assertEquals(strip.matches?.toVote, 1, "one waits on my vote");
  assertEquals(strip.plan?.title, "chatLocked", "the soonest locked-in plan");
  assertEquals(planStripTap(strip.plan, "plan"), { kind: "chatPlan", planId: "chatLocked" }, "a chat plan jumps to its card");
  assertEquals(planStripTap({ savedCardId: "sc1", planRef: { kind: "deck", savedCardId: "sc1" } }, "plan"), { kind: "card", savedCardId: "sc1" }, "a deck plan opens its place card");
  assertEquals(planStripTap(strip.plan, "more"), { kind: "sheet" }, "+N more opens Plans");
});
