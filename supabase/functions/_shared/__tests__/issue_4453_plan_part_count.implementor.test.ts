/**
 * #4453 final rework — Ari's "Part n of N" eyebrow follows the parts the host
 * sees. With SITES_PROOF_PART off, Core does not list `proof`, so the count is
 * the pre-#4453 eight parts, byte for byte. With it on, `proof` is part 5 of 9.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { visiblePlanParts } from "../ariFlows/websiteSetup.ts";
import { PLAN_PARTS } from "../siteContracts/sitePlan.ts";

const keys = (plan: Record<string, unknown>) =>
  visiblePlanParts(plan).map((part) => part.key);

function planWith(listed: readonly string[]): Record<string, unknown> {
  return { status: { parts: listed.map((key) => ({ key, done: false })) } };
}

const WITHOUT_PROOF = PLAN_PARTS.map((part) => part.key).filter((key) => key !== "proof");

Deno.test("#4453 flags off: proof not listed → 8 parts, brand is part 2 of 8", () => {
  const plan = planWith(WITHOUT_PROOF);
  assertEquals(keys(plan), [
    "offer", "brand", "look", "story", "approve", "build", "first_offering", "publish",
  ]);
  assertEquals(keys(plan).indexOf("approve") + 1, 5);
});

Deno.test("#4453 flags off: a plan with no status parts still counts 8", () => {
  assertEquals(visiblePlanParts({}).length, 8);
});

Deno.test("#4453 flag on: Core lists proof → 9 parts, proof is part 5 of 9", () => {
  const plan = planWith(PLAN_PARTS.map((part) => part.key));
  assertEquals(visiblePlanParts(plan).length, 9);
  assertEquals(keys(plan).indexOf("proof") + 1, 5);
  assertEquals(keys(plan).indexOf("approve") + 1, 6);
});
