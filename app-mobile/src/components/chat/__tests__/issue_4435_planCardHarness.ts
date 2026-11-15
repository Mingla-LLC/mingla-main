// @ts-nocheck — Deno-runtime helper; app-mobile's broad tsc sweep includes
// Deno suites that are not configured for that command.
//
// #4435 Phase 0 harness for the plan card KEEP test. It returns everything an
// OPEN plan card is built from. This is the one Phase 0 file the build may
// edit: when the card folds by default (Wave 4), the open body moves into
// PlanCardDetails and this harness adds that file, so the unedited KEEP test
// keeps proving that nothing is lost when a card is opened.
const root = new URL("../../../../", import.meta.url);

export function renderPlanCardOpen(): string {
  return [
    "src/components/chat/PlanCardBubble.tsx",
    // #4435 W3c: the card folds by default; its open body is PlanCardDetails.
    "src/components/chat/PlanCardDetails.tsx",
  ].map((p) => Deno.readTextFileSync(new URL(p, root))).join("\n");
}
