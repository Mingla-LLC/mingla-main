// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4261 Wave F — the suggest-a-place hint reads "You lock in the winner."
// when the viewer is the one who locks (it read "You locks in the winner.").
//
// FAILS-ON-REVERT: drop the plan_suggest_place_helper_you key, or have
// PlanPlaceSuggestSheet pass "You" into the third-person helper for the
// viewer → a case below fails.

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertMatch(actual: string, pattern: RegExp): void {
  if (!pattern.test(actual)) throw new Error(`${JSON.stringify(actual)} does not match ${pattern}`);
}

const chat = JSON.parse(
  await Deno.readTextFile(new URL("../../../i18n/locales/en/chat.json", import.meta.url)),
);
const sheet = await Deno.readTextFile(new URL("../PlanPlaceSuggestSheet.tsx", import.meta.url));

Deno.test("the viewer-locks variant is second person", () => {
  assertEquals(chat.plan_suggest_place_helper_you, "Everyone taps every place that works. You lock in the winner.");
  assert(!/\{\{name\}\}/.test(chat.plan_suggest_place_helper_you));
  assertMatch(chat.plan_suggest_place_helper, /\{\{name\}\} locks in the winner\.$/);
});

Deno.test("the sheet picks the you-variant exactly when the viewer locks", () => {
  const helperLine = sheet.split("\n").find((line) => line.includes("chat:plan_suggest_place_helper"));
  assert(helperLine, "helper line missing");
  assertMatch(
    helperLine,
    /plan && \(plan\.canLock \|\| plan\.createdBy === viewerId\) \? "chat:plan_suggest_place_helper_you" : "chat:plan_suggest_place_helper"/,
  );
});
