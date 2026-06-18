// ORCH-1157 [rsvp-public-redesign] Round-12 — implementor-owned happy-path
// regression for the SYSTEM-BAR / edge-to-edge nav-bar fix on the INLINE
// (non-wrapInRNModal) BaseBottomSheet path — the host the consumer deck/Discover
// DETAIL sheets (RSVP / event / trip / experience) actually mount.
//
// WHY ROUNDS 8–11 FAILED (proven on a Samsung A72, clean-cache, dp): scrH=853.33,
// winH=774.76, insBot=48. The inline detail-sheet host — and gorhom's own backdrop
// (StyleSheet.absoluteFillObject INSIDE that host) — is bounded to winH per the
// ORCH-1016 viewport invariant; the Android nav-bar band (~48dp) lives BELOW winH,
// OUTSIDE the host. With Expo-54 edge-to-edge the app draws behind a TRANSLUCENT
// nav bar, so the Discover deck shows THROUGH the band. NO in-tree layer can paint
// there — every absolute child resolves against the winH-bounded clipping ancestor
// (Round-8 bare filler + Round-11 screen-height layer both stopped at the nav-bar
// TOP on-device). There is also NO installed JS nav-bar-color API (no
// expo-navigation-bar / react-native-edge-to-edge; only detect-only
// react-native-is-edge-to-edge), and adding one needs a native rebuild (forbidden,
// must ship OTA).
//
// THE FIX (Round-12): on Android with a nav-bar inset, host the inline sheet inside
// a transparent full-screen RN <Modal statusBarTranslucent navigationBarTranslucent>
// — a SEPARATE native window that spans scrH including the nav-bar band. The bounded
// `inlineHost` (height = inlineContainerHeight = winH) is preserved INSIDE it, so
// gorhom still measures winH (ORCH-1016 untouched); the retained `androidNavFiller`
// (sheet-bg strip) is rendered as a sibling INSIDE the window, so its bottom:0 now
// reaches the TRUE screen bottom and paints the 48dp band. A GestureHandlerRootView
// inside the window re-activates pan-down-to-dismiss; onRequestClose wires
// hardware-back. iOS / gesture-nav (insets.bottom===0) render the bare inlineHost
// unchanged.
//
// The host pulls RN-bound siblings Deno cannot import, so this is asserted via
// SOURCE-CONTRACT (same approach as the locked META-ORCH-0991 / Round-8/9/10
// suites). Comments are stripped before the load-bearing JSX assertions so a mere
// comment mention can never satisfy fails-on-revert. Each assertion is written to
// FAIL on a true LINE-DELETION revert of the Round-12 fix (delete the
// androidNeedsFullScreenWindow modal-wrap return → the inline path renders the bare
// host again and the band returns). Fails-on-revert proof recorded in the report.

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
// the detail sheets actually take. Bound the slice from the inline `if (!visible)`
// guard to BEFORE the CenterDialog function (a separate component that
// legitimately uses its own RN <Modal>).
const inlineBranch = stripComments(
  baseSheet.slice(
    baseSheet.indexOf("if (!visible) return sheet;"),
    baseSheet.indexOf("function CenterDialog"),
  ),
);

Deno.test("Round-12: the inline path gates a full-screen window on Android + a nav-bar inset", () => {
  // FAILS-ON-REVERT ANCHOR: the Android nav-bar-inset gate that triggers the
  // window wrap. Deleting it removes the wrap → the inline path renders the bare
  // host and the band returns.
  assertStringIncludes(inlineBranch, "androidNeedsFullScreenWindow");
  assertStringIncludes(inlineBranch, "Platform.OS === 'android'");
  assertStringIncludes(inlineBranch, "insets.bottom > 0");
});

Deno.test("Round-12: the inline window is a transparent RN <Modal> with navigationBarTranslucent (spans scrH)", () => {
  // The separate native window is the ONLY layer that reaches the physical screen
  // bottom. navigationBarTranslucent makes it span the nav-bar band; it requires
  // statusBarTranslucent. transparent keeps the deck/dim visible behind the sheet.
  const wrapIdx = inlineBranch.indexOf("if (androidNeedsFullScreenWindow)");
  assert(wrapIdx !== -1, "the Round-12 window-wrap branch must exist");
  const wrapSlice = inlineBranch.slice(wrapIdx);
  assertStringIncludes(wrapSlice, "<RNModal");
  assertStringIncludes(wrapSlice, "navigationBarTranslucent");
  assertStringIncludes(wrapSlice, "statusBarTranslucent");
  assertStringIncludes(wrapSlice, "transparent");
  // Android hardware-back inside the separate window.
  assertStringIncludes(wrapSlice, "onRequestClose={onClose}");
});

Deno.test("Round-12: the bounded inlineHost is preserved INSIDE the window (ORCH-1016 untouched)", () => {
  // gorhom must still measure winH — the host keeps its explicit
  // inlineContainerHeight; only its WRAPPER (a full-screen window) changed.
  assertStringIncludes(inlineBranch, "const inlineHost = (");
  assertStringIncludes(inlineBranch, "height: inlineContainerHeight");
  assertStringIncludes(inlineBranch, "styles.inlineContainer");
  // The window renders the bounded host, NOT a re-measured full-screen sheet.
  const wrapSlice = inlineBranch.slice(
    inlineBranch.indexOf("if (androidNeedsFullScreenWindow)"),
  );
  assertStringIncludes(wrapSlice, "{inlineHost}");
});

Deno.test("Round-12: the GestureHandlerRootView + nav-bar filler render INSIDE the window", () => {
  const wrapSlice = inlineBranch.slice(
    inlineBranch.indexOf("if (androidNeedsFullScreenWindow)"),
  );
  // Pan-down-to-dismiss needs a GHRV inside the separate native window (Bug-1).
  assertStringIncludes(wrapSlice, "<GestureHandlerRootView");
  // The retained sheet-bg strip is a sibling of the host INSIDE the window, so its
  // bottom:0 resolves against the TRUE screen bottom (the modal window spans scrH).
  assertStringIncludes(wrapSlice, "{androidNavFiller}");
});

Deno.test("Round-12: iOS / gesture-nav fall through to the BARE inline host (no window, no behaviour change)", () => {
  // After the Android window branch, the function returns the bare inlineHost —
  // iOS and Android-gesture-nav are unchanged.
  const afterWrap = inlineBranch.slice(
    inlineBranch.indexOf("if (androidNeedsFullScreenWindow)"),
  );
  // The final fall-through return is the bare host (not wrapped).
  assertStringIncludes(afterWrap, "return inlineHost;");
});

Deno.test("Round-12: the androidNavFiller strip keeps the sheet's own bg + nav-bar-inset height (Round-8 contract)", () => {
  // The painted strip is exactly insets.bottom (the nav-bar region) in the sheet's
  // own resolved background colour — preserved from Round-8.
  assertStringIncludes(baseSheet, "height: insets.bottom");
  assertStringIncludes(baseSheet, "backgroundColor: resolvedBgColor");
});

Deno.test("Round-12: the dead Round-11 in-tree screen-height layer is gone (no regression to a non-working mechanism)", () => {
  // An in-tree layer can never reach scrH (proven on the A72); it must not return.
  assert(
    !baseSheet.includes("androidNavFillerScreenLayer"),
    "the dead Round-11 screen-height layer must not be re-introduced",
  );
  assert(
    !baseSheet.includes("Dimensions.get('screen').height"),
    "the Round-11 Dimensions screen-height escape must be gone (modal window provides scrH)",
  );
});

Deno.test("Round-12: no temporary geometry DIAG markers remain in the host", () => {
  assert(!baseSheet.includes("ORCH-1157-DIAG"), "DIAG markers must be reaped");
  assert(!baseSheet.includes("GAPDIAG"), "GAPDIAG markers must be reaped");
});
