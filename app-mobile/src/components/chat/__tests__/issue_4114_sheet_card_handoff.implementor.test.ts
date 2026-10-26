// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 QA run 3 (P1) — a Plans sheet row did not open its card, and
// after one failed tap the header strip and the thread stopped opening it too.
// The card (its own iOS RN Modal) was presented while the Plans sheet (another
// RN Modal) was still up; iOS refused it ("already presenting"), the shared card
// state stayed set, and every later open set a target on an already-visible
// modal that never presented again. Same for the Matches sheet's details card.
//
// MINGLA-INVARIANT: I-4114-SHEET-CARD-ONE-MODAL | issue #4114 | A card opened from a chat sheet presents only after that sheet's native window has dismissed, and every open while a card is still set re-presents it.
//
// FAILS-ON-REVERT: present the card straight from a sheet row (no sheet
// close, no wait for the native dismiss), drop the clear-and-re-present step
// in `open`, stop clearing on close, or unwire onNativeDismiss / the row's
// onClose in either sheet, and this suite fails.

import {
  initialSheetCardState,
  sheetCardReducer,
} from "../sheetCardHandoff.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}
const read = (rel: string) => Deno.readTextFile(new URL(rel, import.meta.url));
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const run = (events) => events.reduce((s, e) => sheetCardReducer(s, e), initialSheetCardState());

Deno.test("a sheet row holds the card until the sheet's native window dismisses", () => {
  const held = run([{ type: "openFromSheet", target: "plan-A" }]);
  assertEquals(held.shown, null, "the card is NOT presented over the still-open sheet");
  assertEquals(held.pending, "plan-A", "the card waits");
  assertEquals(run([{ type: "openFromSheet", target: "plan-A" }, { type: "frame" }]).shown, null, "a frame alone does not present it");
  const shown = run([{ type: "openFromSheet", target: "plan-A" }, { type: "sheetDismissed" }]);
  assertEquals(shown, { shown: "plan-A", pending: null, waitFor: "none" }, "the card shows once the sheet has gone");
});

Deno.test("a stuck or refused card never swallows the next open (header and thread)", () => {
  // The run-3 failure: a card target is still set (iOS refused it). The next
  // open must take visible false → true, not just swap the target.
  const stuck = { shown: "plan-A", pending: null, waitFor: "none" };
  const reopened = sheetCardReducer(stuck, { type: "open", target: "plan-B" });
  assertEquals(reopened.shown, null, "the stale card is cleared first");
  assertEquals(sheetCardReducer(reopened, { type: "frame" }).shown, "plan-B", "and the new one presents on the next frame");
  // With nothing set, a header/thread open presents at once.
  assertEquals(run([{ type: "open", target: "plan-C" }]).shown, "plan-C", "a direct open presents normally");
});

Deno.test("close and cancel clear every bit of card state", () => {
  for (const type of ["close", "cancel"]) {
    for (const from of [
      run([{ type: "open", target: "x" }]),
      run([{ type: "openFromSheet", target: "x" }]),
      { shown: "x", pending: "y", waitFor: "frame" },
    ]) {
      assertEquals(sheetCardReducer(from, { type }), initialSheetCardState(), `${type} clears`);
    }
  }
  // After a close, the next open presents straight away.
  assertEquals(run([{ type: "open", target: "a" }, { type: "close" }, { type: "open", target: "b" }]).shown, "b", "reopen after close");
  // A stray dismiss (the sheet closing for any other reason) changes nothing.
  assertEquals(run([{ type: "open", target: "a" }, { type: "sheetDismissed" }]).shown, "a", "stray dismiss ignored");
});

Deno.test("both chat sheets use the handoff and their cards clear on close", async () => {
  const banners = stripComments(await read("../CollabSessionChatBanners.tsx"));
  const compact = banners.slice(banners.indexOf("function CompactCollabBottomSheet("), banners.indexOf("export interface CollabPlanCardSource"));
  assertEquals((compact.match(/onNativeDismiss=\{onNativeDismiss\}/g) ?? []).length, 2, "both sheet bodies pass the native dismiss through");

  const hook = banners.slice(banners.indexOf("export function useSheetCard<T>()"), banners.indexOf("export interface CollabPlanCard {"));
  assert(/useReducer\(/.test(hook) && /sheetCardReducer\(current, event\)/.test(hook), "the hook runs the handoff reducer");
  assert(/requestAnimationFrame\(\(\) => dispatch\(\{ type: "frame" \}\)\)/.test(hook), "re-present waits one frame");
  assert(/modalTarget: state\.shown/.test(hook), "the modal shows only the presented card");

  const plans = banners.slice(banners.indexOf("export function ScheduleSheet("), banners.indexOf("export function SavedToSessionCardsSheet("));
  assert(/onNativeDismiss=\{onSheetDismissed\}/.test(plans), "Plans: the sheet's dismiss releases the card");
  assert(/openPlanFromSheet\(item\);\s*onClose\(\);/.test(plans), "Plans: a row closes the sheet and holds the card");
  assert(!/onPress=\{\(\) => openPlan\(item\)\}/.test(plans), "Plans: a row never presents over the sheet");
  assert(/closePlan\(\);/.test(plans), "Plans: closing the card clears the shared state");

  const matches = banners.slice(banners.indexOf("export function SavedToSessionCardsSheet("), banners.indexOf("const styles = StyleSheet.create"));
  assert(/useSheetCard<ExpansionTarget>\(\)/.test(matches) && !/useState<ExpansionTarget/.test(matches), "Matches: uses the handoff, no private state");
  assert(/onNativeDismiss=\{onSheetDismissed\}/.test(matches), "Matches: the sheet's dismiss releases the card");
  assert(/openFromSheet\(target\);\s*onClose\(\);/.test(matches), "Matches: details close the sheet and hold the card");
  assert(/closeDetails\(\);/.test(matches), "Matches: closing the card clears its state");
});
