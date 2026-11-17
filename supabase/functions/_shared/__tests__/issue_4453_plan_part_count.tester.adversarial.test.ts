/**
 * #4453 final retest — tester adversarial for the flags-off part count.
 * Angle the implementor's test does not take: malformed or hostile plan status
 * (null rows, strings, a status that is not an object, `proof` listed twice,
 * unknown keys, Core listing parts out of order). The count must stay 8 or 9,
 * in PLAN_PARTS order, and with `proof` absent every part keeps the number it
 * had on main before #4453 (offer 1 … publish 8).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { visiblePlanParts } from "../ariFlows/websiteSetup.ts";

// The pre-#4453 order on origin/main, written out (not derived from PLAN_PARTS).
const MAIN_ORDER = ["offer", "brand", "look", "story", "approve", "build", "first_offering", "publish"];
const keys = (plan: Record<string, unknown>) => visiblePlanParts(plan).map((part) => part.key);

Deno.test("#4453 tester: malformed status rows never add or drop a part (flags off)", () => {
  const hostile: Record<string, unknown>[] = [
    { status: null },
    { status: "parts" },
    { status: { parts: "proof" } },
    { status: { parts: [null, 7, "proof", { key: null }, { key: "PROOF" }, { key: "nope" }] } },
    { status: { parts: [{ key: "publish" }, { key: "offer" }] } },
  ];
  for (const plan of hostile) assertEquals(keys(plan), MAIN_ORDER, JSON.stringify(plan));
});

Deno.test("#4453 tester: flags off, every part keeps main's number", () => {
  const plan = { status: { parts: MAIN_ORDER.map((key) => ({ key, done: false })) } };
  MAIN_ORDER.forEach((key, index) => assertEquals(keys(plan).indexOf(key) + 1, index + 1, key));
});

Deno.test("#4453 tester: proof listed twice or out of order still counts once, in plan order", () => {
  const plan = { status: { parts: [{ key: "proof" }, { key: "publish" }, { key: "proof" }, { key: "offer" }] } };
  assertEquals(keys(plan), ["offer", "brand", "look", "story", "proof", "approve", "build", "first_offering", "publish"]);
});
