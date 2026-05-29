// @ts-nocheck
// ORCH-0987 ADVERSARIAL regression test — friend more-menu pure logic.
// Tester-authored. Attacks a DIFFERENT angle than the implementor happy-path test:
// invariants the SHEET and HOOK silently depend on — precedence across the full truth
// table, total-function coverage (no fall-through), the display-order contract
// (pair row at index 0), no-duplicate actions, and an exact scope-creep guard on the
// action set. Deno-runnable (friendMenu.ts has no RN deps).
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { derivePairAction, FRIEND_MENU_ACTIONS } from "../friendMenu.ts";

const VALID = new Set(["unpair", "pending", "pair"]);

Deno.test("ORCH-0987 ADVERSARIAL: derivePairAction is total over the full 2x2 truth table", () => {
  for (const isPaired of [true, false]) {
    for (const isPending of [true, false]) {
      const r = derivePairAction(isPaired, isPending);
      assert(VALID.has(r), `(${isPaired},${isPending}) returned non-union value: ${r}`);
    }
  }
});

Deno.test("ORCH-0987 ADVERSARIAL: paired ALWAYS suppresses pending (precedence invariant)", () => {
  // The sheet renders the pending row only when not paired; if this ever returned
  // "pending" while paired, a paired friend would see a dead 'request pending' row.
  assertEquals(derivePairAction(true, true), "unpair");
  assertEquals(derivePairAction(true, false), "unpair");
  // No combination with isPaired=true may yield "pending".
  for (const isPending of [true, false]) {
    assert(derivePairAction(true, isPending) !== "pending");
  }
});

Deno.test("ORCH-0987 ADVERSARIAL: pending requires not-paired AND pending true", () => {
  // "pending" is reachable on exactly one input; guards against a future change that
  // widens it (e.g. returning pending on isPaired).
  assertEquals(derivePairAction(false, true), "pending");
  assertEquals(derivePairAction(false, false), "pair");
});

Deno.test("ORCH-0987 ADVERSARIAL: action set has no duplicates", () => {
  const unique = new Set(FRIEND_MENU_ACTIONS);
  assertEquals(unique.size, FRIEND_MENU_ACTIONS.length, "duplicate action in FRIEND_MENU_ACTIONS");
});

Deno.test("ORCH-0987 ADVERSARIAL: action set is EXACTLY the six expected, in order (scope-creep guard)", () => {
  // Exact match catches both a dropped action and a silently-added one. Order matters:
  // the sheet renders the pair-state-aware row first, so 'pair' MUST be index 0.
  assertEquals([...FRIEND_MENU_ACTIONS], [
    "pair",
    "addToSession",
    "mute",
    "removeFriend",
    "block",
    "report",
  ]);
  assertEquals(FRIEND_MENU_ACTIONS[0], "pair");
});
