// ORCH-1157 [rsvp-public-redesign] Round-9 — implementor-owned happy-path
// regression for the Android see-through nav-bar gap fix on the wrapInRNModal
// host path (the deck/Discover DETAIL sheet path).
//
// ROOT CAUSE OF THE ROUND-8 MISS: Round-8 added the Android nav-bar filler ONLY
// to the inline (non-`wrapInRNModal`) return branch of BaseBottomSheet. But the
// consumer deck/Discover detail sheets (RSVP / event / trip / experience) all
// mount via `ExpandedCardModal` with `wrapInRNModal={true}`, which takes a
// DIFFERENT return branch — the one wrapping the gorhom sheet in an RN <Modal
// statusBarTranslucent>. That branch returned early, before the filler render, so
// the see-through band still showed (verified on a Samsung A72). Round-9 renders
// the SAME shared `androidNavFiller` as a SIBLING of `{sheet}` inside that
// modal's GestureHandlerRootView, painting the nav-bar inset region with the
// sheet's own background. The RN Modal window spans the full screen (incl. the
// nav-bar region), so an absolute bottom-anchored full-width filler lands exactly
// on the nav-bar inset → no see-through.
//
// The host pulls RN-bound siblings Deno cannot import, so this is asserted via
// SOURCE-CONTRACT. Each assertion is written to FAIL on a true LINE-DELETION
// revert of the Round-9 fix (delete the `{androidNavFiller}` render inside the
// RNModal branch → these assertions fail). Proof recorded in the implementation
// report. The Round-8 inline-path test (orch_1157_round8_*) stays green — that
// path is preserved.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const baseSheet = await read(
  "../../../app-mobile/src/components/ui/BaseBottomSheet.tsx",
);

// Isolate the wrapInRNModal branch: from `if (wrapInRNModal) {` to the close of
// its `</RNModal>);`. The filler MUST render inside this branch (Round-9).
const wrapBranch = baseSheet.slice(
  baseSheet.indexOf("if (wrapInRNModal) {"),
  baseSheet.indexOf("// Non-wrapped: announce a modal boundary"),
);

Deno.test("Round-9: the wrapInRNModal branch renders the Android nav-bar filler inside the RN <Modal>", () => {
  // The detail-sheet path (ExpandedCardModal → wrapInRNModal=true) now paints the
  // nav-bar inset region. The filler is rendered as a sibling of {sheet} inside
  // the modal's GestureHandlerRootView.
  assertStringIncludes(wrapBranch, "<RNModal");
  assertStringIncludes(wrapBranch, "statusBarTranslucent");
  assertStringIncludes(wrapBranch, "<GestureHandlerRootView");
  // Both the sheet and the filler render inside the GHRV (siblings).
  assertStringIncludes(wrapBranch, "{sheet}");
  // FAILS-ON-REVERT ANCHOR: deleting the `{androidNavFiller}` line in this branch
  // re-opens the see-through gap on every deck/Discover detail sheet.
  assertStringIncludes(wrapBranch, "{androidNavFiller}");
});

Deno.test("Round-9: the filler is a SIBLING of the gorhom sheet (ORCH-1016 viewport untouched)", () => {
  // Inside the GHRV, {sheet} comes first and {androidNavFiller} after it — the
  // filler is never nested inside the gorhom-measured <BottomSheet>, so the
  // snap/viewport math is unperturbed.
  const sheetIdx = wrapBranch.indexOf("{sheet}");
  const fillerIdx = wrapBranch.indexOf("{androidNavFiller}");
  assert(sheetIdx !== -1, "{sheet} must render in the wrapInRNModal branch");
  assert(
    fillerIdx !== -1,
    "{androidNavFiller} must render in the wrapInRNModal branch",
  );
  assert(
    fillerIdx > sheetIdx,
    "filler must be a sibling rendered AFTER {sheet}, not nested inside it",
  );
});

Deno.test("Round-9: the shared filler is computed ONCE, above the wrapInRNModal branch", () => {
  // Round-9 hoisted resolvedBgColor + androidNavFiller above `if (wrapInRNModal)`
  // so BOTH the inline and the modal branches reuse the SAME definition (no
  // duplication). Assert the single definition precedes the branch.
  const defIdx = baseSheet.indexOf("const androidNavFiller =");
  const branchIdx = baseSheet.indexOf("if (wrapInRNModal) {");
  assert(defIdx !== -1, "androidNavFiller must be defined");
  assert(
    defIdx < branchIdx,
    "androidNavFiller must be defined ABOVE the wrapInRNModal branch so both paths reuse it",
  );
  // Exactly one definition (no duplicate copy left in the inline branch).
  const occurrences = baseSheet.split("const androidNavFiller =").length - 1;
  assert(
    occurrences === 1,
    `expected exactly ONE androidNavFiller definition, found ${occurrences}`,
  );
  // The filler still keys on Android + a real nav-bar inset + the sheet's own bg.
  assertStringIncludes(baseSheet, "Platform.OS === 'android'");
  assertStringIncludes(baseSheet, "insets.bottom > 0");
  assertStringIncludes(baseSheet, "height: insets.bottom");
  assertStringIncludes(baseSheet, "backgroundColor: resolvedBgColor");
});

Deno.test("Round-9: the inline (Round-8) path STILL renders the filler (no regression)", () => {
  // The inline host return (non-wrapInRNModal) still renders {androidNavFiller}
  // as a sibling of the bounded inline host at inlineContainerHeight.
  const inlineBranch = baseSheet.slice(
    baseSheet.indexOf("// Non-wrapped: announce a modal boundary"),
  );
  assertStringIncludes(inlineBranch, "height: inlineContainerHeight");
  assertStringIncludes(inlineBranch, "{androidNavFiller}");
});
