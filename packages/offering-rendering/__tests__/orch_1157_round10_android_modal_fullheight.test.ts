// ORCH-1157 [rsvp-public-redesign] Round-10 — implementor-owned happy-path
// regression for the REAL Android see-through nav-bar gap geometry fix.
//
// WHY ROUNDS 8 + 9 FAILED (proven on a Samsung A72): both rounds added a filler
// of `height: insets.bottom` anchored to the bottom of the wrapInRNModal host's
// GestureHandlerRootView. But the RN <Modal statusBarTranslucent> window on
// Android draws under the STATUS bar ONLY — it stays inset ABOVE the NAVIGATION
// bar. So the GHRV + the gorhom hosting container measure `screenHeight − navBar`
// (or less). gorhom computes snapPoints (['50%','90%']) as a fraction of THAT
// short container and anchors the sheet body to the container bottom, which lands
// at the TOP of the nav bar. The edge-to-edge deck/Discover root window shows
// through the whole region below that — a band TALLER than insets.bottom — and
// the fillers (anchored to the GHRV bottom = the nav-bar top, height insets.bottom)
// painted the wrong strip, leaving the band visible.
//
// THE FIX (Round-10): add `navigationBarTranslucent` to the RN <Modal>. It makes
// the Android Modal window draw under the NAVIGATION bar too, so the GHRV + gorhom
// container measure the TRUE full screen height. The 90% sheet body then reaches
// the real screen bottom → NO band, on any device, regardless of nav-bar inset
// size. This is geometry-correct, not a sized filler. iOS evaluates the prop as a
// no-op (unchanged). `navigationBarTranslucent` REQUIRES `statusBarTranslucent`
// (already present) per the RN Modal contract.
//
// The host pulls RN-bound siblings Deno cannot import, so this is asserted via
// SOURCE-CONTRACT (same approach as the locked META-ORCH-0991 / Round-9 suites).
// Each assertion is written to FAIL on a true LINE-DELETION revert of the Round-10
// fix (delete the `navigationBarTranslucent` prop from the RNModal in the
// wrapInRNModal branch → these assertions fail). Fails-on-revert proof recorded in
// the implementation report. The Round-8/9 filler tests stay green (the filler is
// retained as harmless redundancy).

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const baseSheet = await read(
  "../../../app-mobile/src/components/ui/BaseBottomSheet.tsx",
);

// Isolate the wrapInRNModal branch: from `if (wrapInRNModal) {` to the start of
// the non-wrapped branch. The detail-sheet RN <Modal> lives here.
const wrapBranch = baseSheet.slice(
  baseSheet.indexOf("if (wrapInRNModal) {"),
  baseSheet.indexOf("// Non-wrapped: announce a modal boundary"),
);

// Strip block + line comments so assertions key on REAL JSX, never comment prose
// (a comment mentioning the prop must NOT satisfy fails-on-revert — the prop has
// to exist as actual code). This is the comment-out trap guard.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const wrapBranchCode = stripComments(wrapBranch);

Deno.test("Round-10: the wrapInRNModal RN <Modal> is navigationBarTranslucent (window reaches the true screen bottom)", () => {
  // The detail-sheet path (ExpandedCardModal → wrapInRNModal=true) opens its RN
  // <Modal> in THIS branch. It MUST carry `navigationBarTranslucent` so the
  // Android Modal window draws under the nav bar and the gorhom container measures
  // the full screen height — eliminating the see-through band at the geometry level.
  assertStringIncludes(wrapBranchCode, "<RNModal");
  // FAILS-ON-REVERT ANCHOR: deleting this prop re-shortens the Modal window to
  // (screenHeight − navBar), the 90% sheet body stops at the nav-bar top, and the
  // see-through deck band returns on every deck/Discover detail sheet. Keyed on
  // the comment-stripped JSX so a mere comment mention cannot satisfy it.
  assertStringIncludes(wrapBranchCode, "navigationBarTranslucent");
});

Deno.test("Round-10: navigationBarTranslucent is paired with statusBarTranslucent (RN Modal contract)", () => {
  // RN warns + ignores navigationBarTranslucent unless statusBarTranslucent is
  // also true. Both must be present as real JSX in the same RN <Modal>.
  assertStringIncludes(wrapBranchCode, "statusBarTranslucent");
  const statusIdx = wrapBranchCode.indexOf("statusBarTranslucent");
  const navIdx = wrapBranchCode.indexOf("navigationBarTranslucent");
  assert(statusIdx !== -1, "statusBarTranslucent must be present");
  assert(navIdx !== -1, "navigationBarTranslucent must be present");
});

Deno.test("Round-10: the CenterDialog RN <Modal> is NOT made navigationBarTranslucent (scope discipline)", () => {
  // Only the detail-sheet (wrapInRNModal) Modal gets the geometry fix. The
  // center-dialog Modal is a centered card on a scrim — it must not be touched.
  const centerBranch = stripComments(
    baseSheet.slice(baseSheet.indexOf("function CenterDialog")),
  );
  assert(
    !centerBranch.includes("navigationBarTranslucent"),
    "CenterDialog Modal must NOT carry navigationBarTranslucent (out of scope)",
  );
});

Deno.test("Round-10: snapPoints still drive the body to the container bottom (no inline-host regression)", () => {
  // [TEST-MOD-APPROVED ORCH-1157] — Round-10 originally asserted the inline path
  // carries NO navigationBarTranslucent. Round-12 SUPERSEDES that: the inline path
  // now hosts the bounded sheet inside a full-screen RN <Modal
  // navigationBarTranslucent> (the only mechanism that reaches the physical screen
  // bottom — proven on the A72). The ENDURING Round-10 invariant — gorhom still
  // measures inlineContainerHeight (ORCH-1016) — is unchanged and still asserted.
  const inlineBranch = stripComments(
    baseSheet.slice(
      baseSheet.indexOf("// Non-wrapped: announce a modal boundary"),
    ),
  );
  // ORCH-1016 viewport invariant: the gorhom host is bounded to the window height,
  // whether or not it is later placed inside the Round-12 full-screen window.
  assertStringIncludes(inlineBranch, "height: inlineContainerHeight");
});
