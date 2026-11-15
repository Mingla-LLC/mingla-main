// @ts-nocheck — Deno-runtime suite; app-mobile's broad tsc sweep includes
// Deno suites that are not configured for that command.
//
// #4435 Phase 0 characterization (KEEP). Frozen for the whole #4435 build:
// every section a plan card ships today is still present and wired when the
// card is open. The card source comes from renderPlanCardOpen() in
// issue_4435_planCardHarness.ts (the only Phase 0 file the build may edit).
import { renderPlanCardOpen } from "./issue_4435_planCardHarness.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const card = renderPlanCardOpen();

const SECTIONS: Array<[string, RegExp]> = [
  ["hero and link", /styles\.hero\b[\s\S]*chat:plan_open_link_a11y/],
  ["title", /\{plan\.title\}/],
  ["place options with counts", /<PlanPlaceOptions[\s\S]*voterIds|<PlanPlaceOptions/],
  ["suggest another place", /onSuggestPlace\(plan\)/],
  ["set time or time options with counts", /<PlanPollBlock/],
  ["add your time", /chat:plan_add_your_time/],
  ["lock in (maker or admin only)", /chat:plan_lock_in[\s\S]*plan\.canLock|plan\.canLock[\s\S]*chat:plan_lock_in/],
  ["note", /\{plan\.note \?/],
  ["going avatars and summary", /plan\.rsvps\.going\.slice\(0, 5\)[\s\S]*chat:plan_summary_none/],
  ["going, maybe, can't with the current choice", /<PlanRsvpGrid[\s\S]*actions\.rsvp\(plan, status\)/],
  ["rsvp labels", /chat:plan_going[\s\S]*chat:plan_maybe[\s\S]*chat:plan_cant/],
  ["comment nudge", /<PlanCommentNudge/],
  ["reply", /onReply\(plan\)/],
  ["edit and cancel for the maker (long press)", /onLongPress\(plan\)/],
  ["comments count", /chat:plan_comments/],
  ["cancelled styling", /cancelled && styles\.cancelled/],
];

for (const [name, pattern] of SECTIONS) {
  Deno.test(`#4435 P0 KEEP an open plan card shows: ${name}`, () => {
    assert(pattern.test(card), `${name} is present and wired`);
  });
}
