// @ts-nocheck
// ORCH-0987 regression test — friend more-menu pure logic. Deno-runnable (friendMenu.ts
// has no RN deps). Fails-on-revert anchor for the pair-state derivation + the 6-action set.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { derivePairAction, FRIEND_MENU_ACTIONS } from "../friendMenu.ts";

Deno.test("ORCH-0987 paired friend -> unpair row", () => {
  assertEquals(derivePairAction(true, false), "unpair");
});

Deno.test("ORCH-0987 pending pair -> pending row", () => {
  assertEquals(derivePairAction(false, true), "pending");
});

Deno.test("ORCH-0987 neither -> send pair request row", () => {
  assertEquals(derivePairAction(false, false), "pair");
});

Deno.test("ORCH-0987 paired takes precedence over pending", () => {
  assertEquals(derivePairAction(true, true), "unpair");
});

Deno.test("ORCH-0987 menu exposes all six actions incl. block + report", () => {
  assertEquals(FRIEND_MENU_ACTIONS.length, 6);
  assertEquals(FRIEND_MENU_ACTIONS.includes("block"), true);
  assertEquals(FRIEND_MENU_ACTIONS.includes("report"), true);
  assertEquals(FRIEND_MENU_ACTIONS.includes("addToSession"), true);
});
