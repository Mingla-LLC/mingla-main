// ORCH-1157 [rsvp-public-redesign] Round-11 — implementor-owned happy-path
// regression for the DATA-BACKED Android see-through nav-bar gap fix on the
// INLINE (non-wrapInRNModal) BaseBottomSheet path — the host the consumer deck/
// Discover DETAIL sheets (RSVP / event / trip / experience) actually mount.
//
// WHY ROUNDS 8/9/10 MISSED IT (proven on a Samsung A72, runtime logcat, dp):
// the OPEN detail sheet logged `wrapInRNModal:false`. ExpandedCardModal returns
// <ConsumerEventDetailScreen> EARLY — and that screen mounts an INLINE
// BaseBottomSheet (wrapInRNModal default false) — BEFORE ExpandedCardModal's own
// wrapInRNModal=true sheet. So the gapping host is the INLINE path, NOT the
// wrapInRNModal branch Rounds 9/10 patched. Geometry: scrH=853.33, winH=774.76,
// insTop=30.58, insBot=48 (scrH−winH ≈ insTop+insBot). The gorhom inline host is
// bounded to `inlineContainerHeight` (= windowHeight = winH, ORCH-1016), so the
// sheet bottom lands at the nav-bar TOP and the 48dp band below winH is unpainted
// → the edge-to-edge Discover deck shows through. Round-8's bare sibling filler
// (position:absolute; bottom:0) resolved its `bottom:0` against the winH-bounded
// ancestor, so it stopped at the nav-bar TOP too and never painted the band.
//
// THE FIX (Round-11): in the inline return path, wrap the `androidNavFiller` in a
// screen-height layer (`styles.androidNavFillerScreenLayer`: position:absolute;
// top:0; height = Dimensions.get('screen').height) that anchors at the overlay's
// top (= physical screen top) and EXPLICITLY spans scrH. An absolute child with
// an explicit `height` escapes the parent's winH height constraint, so the
// filler's `bottom:0` now reaches the TRUE physical screen bottom and covers the
// nav-bar inset region with the sheet's own bg. NO RN <Modal> / NO
// navigationBarTranslucent on the inline path (Round-10 invariant preserved). The
// filler height stays exactly `insets.bottom` (the nav-bar region) with the
// sheet's own `resolvedBgColor`.
//
// The host pulls RN-bound siblings Deno cannot import, so this is asserted via
// SOURCE-CONTRACT (same approach as the locked META-ORCH-0991 / Round-8/9/10
// suites). Comments are stripped before the load-bearing JSX assertions so a mere
// comment mention can never satisfy fails-on-revert. Each assertion is written to
// FAIL on a true LINE-DELETION revert of the Round-11 fix (delete the screen
// layer wrapper in the inline return → the filler resolves against winH again and
// the band returns). Fails-on-revert proof recorded in the implementation report.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const baseSheet = await read(
  "../../../app-mobile/src/components/ui/BaseBottomSheet.tsx",
);

// Strip block + line comments so assertions key on REAL JSX/CODE, never comment
// prose (the comment-out / comment-mention trap guard).
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// Isolate the inline (non-wrapInRNModal) return path — the visible-sheet branch
// that the detail sheets actually take. Bound the slice to BEFORE the
// CenterDialog function (a separate component that legitimately uses its own RN
// <Modal>) so the no-Modal assertion keys only on the inline sheet path.
const inlineBranch = stripComments(
  baseSheet.slice(
    baseSheet.indexOf("// Non-wrapped: announce a modal boundary"),
    baseSheet.indexOf("function CenterDialog"),
  ),
);

Deno.test("Round-11: the inline path renders the filler inside the screen-height layer (reaches scrH bottom)", () => {
  // The inline host stays bounded to inlineContainerHeight (= winH, ORCH-1016).
  assertStringIncludes(inlineBranch, "height: inlineContainerHeight");
  // FAILS-ON-REVERT ANCHOR: the filler is rendered as a child of the
  // androidNavFillerScreenLayer, which is sized to the PHYSICAL screen height so
  // the filler's bottom:0 reaches the true screen bottom (not the winH ancestor).
  assertStringIncludes(inlineBranch, "styles.androidNavFillerScreenLayer");
  assertStringIncludes(inlineBranch, "Dimensions.get('screen').height");
  // The bare filler is still the painted element inside that layer.
  assertStringIncludes(inlineBranch, "{androidNavFiller}");
});

Deno.test("Round-11: the inline screen layer is rendered AFTER the inline host, with the filler nested INSIDE it", () => {
  const hostIdx = inlineBranch.indexOf("styles.inlineContainer");
  const layerIdx = inlineBranch.indexOf("styles.androidNavFillerScreenLayer");
  const fillerIdx = inlineBranch.indexOf("{androidNavFiller}");
  assert(hostIdx !== -1, "inline host must render");
  assert(layerIdx !== -1, "screen-height layer must render in the inline path");
  assert(fillerIdx !== -1, "the filler must render in the inline path");
  // The screen layer comes after the host (sibling, ORCH-1016 host untouched)...
  assert(
    layerIdx > hostIdx,
    "screen layer must be a sibling rendered AFTER the bounded inline host",
  );
  // ...and the filler is nested INSIDE the screen layer (its child), so it
  // resolves bottom:0 against scrH, not the winH ancestor.
  assert(
    fillerIdx > layerIdx,
    "the filler must be nested inside the screen-height layer (child), not a bare sibling of the inline host",
  );
});

Deno.test("Round-11: the screen-layer style spans from the top with no fixed height (height set at render = scrH)", () => {
  const styleSlice = baseSheet.slice(
    baseSheet.indexOf("androidNavFillerScreenLayer: {"),
  );
  const styleBlock = styleSlice.slice(0, styleSlice.indexOf("}"));
  assertStringIncludes(styleBlock, "position: 'absolute'");
  assertStringIncludes(styleBlock, "top: 0");
  // The style does NOT hard-code a height; it is supplied at render time as
  // Dimensions.get('screen').height (the physical screen) so it spans scrH.
  assert(
    !styleBlock.includes("height:"),
    "androidNavFillerScreenLayer must not hard-code a height — screen height is applied at render",
  );
});

Deno.test("Round-11: the filler height is still the nav-bar inset, with the sheet's own bg (unchanged contract)", () => {
  // The painted strip is exactly insets.bottom (the Android nav-bar region) in the
  // sheet's own resolved background colour — the Round-8 contract, preserved.
  assertStringIncludes(baseSheet, "height: insets.bottom");
  assertStringIncludes(baseSheet, "backgroundColor: resolvedBgColor");
  assertStringIncludes(baseSheet, "insets.bottom > 0");
  assertStringIncludes(baseSheet, "Platform.OS === 'android'");
});

Deno.test("Round-11: the inline path adds NO RN Modal / navigationBarTranslucent (Round-10 invariant preserved)", () => {
  // The geometry fix on the inline path is the screen-height layer, NOT a Modal.
  assert(
    !inlineBranch.includes("navigationBarTranslucent"),
    "inline path must not gain navigationBarTranslucent (wrapInRNModal-only, Round-10)",
  );
  assert(
    !inlineBranch.includes("<RNModal"),
    "inline path must not render an RN <Modal> (it has no Modal on the visible path)",
  );
});

Deno.test("Round-11: the temporary geometry DIAG is fully removed from the host", () => {
  // The Round-11 dispatch requires ZERO [ORCH-1157-DIAG] / GAPDIAG markers in
  // product code after the fix. Assert the host carries none.
  assert(
    !baseSheet.includes("ORCH-1157-DIAG"),
    "the [ORCH-1157-DIAG] markers must be fully reaped",
  );
  assert(
    !baseSheet.includes("GAPDIAG"),
    "the GAPDIAG log markers must be fully reaped",
  );
  // The throwaway diag overlay / marker styles must be gone too.
  assert(!baseSheet.includes("diagOverlay"), "diag overlay must be removed");
  assert(!baseSheet.includes("diagContentMarker"), "diag marker must be removed");
});
