/**
 * ORCH-1315 [preferences-custom-location-paywall-not-firing] — the custom-location
 * (GPS) paywall must actually PRESENT when a free user taps the gated affordance in
 * the preferences sheet, and the natural tap targets must not be dead.
 *
 * WHY this test exists (fails-on-revert contract):
 *   The preferences sheet renders inside a BaseBottomSheet `wrapInRNModal` RN-Modal
 *   window. `CustomPaywallScreen` was a SECOND RN `<Modal presentationStyle=
 *   "pageSheet">`, and iOS will NOT reliably present a second RN Modal over an
 *   already-presented one — so the paywall silently never appeared (root cause F-1).
 *   The fix adds an in-window overlay mode (`presentInline`) to CustomPaywallScreen
 *   and opts the preferences paywall into it, mounted INSIDE the sheet window.
 *   A secondary UX gap (F-3): only the Switch thumb fired the paywall; the row /
 *   label / lock icon were dead taps — now the whole locked GPS row is pressable.
 *   Invariant I-PROPOSED-1315-PAYWALL-PRESENTS-FROM-SHEET.
 *
 * Conventions mirror the sibling `orch-0943-prefs-apply-coord-coherence.test.tsx`
 * (source-structure `readSource` + `assert.match`) and
 * `connections/__tests__/PairingPaywall.orch1239.test.tsx` (behavioral decision
 * model). Runs standalone via `require.main === module` (execute with `npx tsx`).
 *
 * fails-on-revert:
 *   • remove `presentInline` from CustomPaywallScreen or its inline-overlay branch
 *     → T-A2/T-A3 fail (exit 1).
 *   • remove `presentInline` from the preferences paywall element → T-A1 fails.
 *   • revert the locked GPS row to a non-pressable View → T-A4 fails.
 */

declare const module: any;
declare const process: any;
declare const require: any;

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function resolveRepoFile(relPath: string): string {
  const appMobilePath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(appMobilePath)) return appMobilePath;
  return path.resolve(process.cwd(), "app-mobile", relPath);
}

function readSource(relPath: string): string {
  return fs.readFileSync(resolveRepoFile(relPath), "utf8");
}

// ── Behavioral model: the locked GPS row / label / lock icon fires onLockedTap,
//    and PreferencesSheet's onLockedTap opens the custom_starting_point paywall
//    ONLY when the sheet is editable (participant read-only view never triggers it).
type GpsTap = { showPaywall: boolean; feature?: string; toggles?: boolean };
function resolveGpsLockedTap({ isEditable, isLocked }: { isEditable: boolean; isLocked: boolean }): GpsTap {
  if (!isLocked) return { showPaywall: false, toggles: true }; // Mingla+: switch toggles normally
  if (!isEditable) return { showPaywall: false };              // read-only participant view
  return { showPaywall: true, feature: "custom_starting_point" };
}

export function runOrch1315CustomLocationPaywallTest() {
  const prefs = readSource("src/components/PreferencesSheet.tsx");
  const paywall = readSource("src/components/CustomPaywallScreen.tsx");
  const advanced = readSource("src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx");
  const baseSheet = readSource("src/components/ui/BaseBottomSheet.tsx");

  // ── T-A1: the preferences paywall element carries `presentInline` ─────────────
  const paywallConstStart = prefs.indexOf("const paywall = (");
  assert.ok(paywallConstStart !== -1, "T-A1: `const paywall = (` must exist in PreferencesSheet");
  const paywallConstBlock = prefs.slice(paywallConstStart, prefs.indexOf(");", paywallConstStart));
  assert.match(paywallConstBlock, /<CustomPaywallScreen/, "T-A1: paywall renders CustomPaywallScreen");
  assert.match(
    paywallConstBlock,
    /presentInline/,
    "T-A1 (fails-on-revert): the preferences CustomPaywallScreen MUST carry `presentInline` — without it iOS silently drops the nested Modal over the sheet",
  );

  // ── T-A1b: the paywall is routed through the VIEWPORT-FIXED `overlay` slot ─────
  // (NOT a scroll child — a scroll child scrolls off-screen when the sheet is
  //  scrolled down before a gated tap: the ORCH-1315 P1 geometry bug the tester
  //  caught. The slot is a sibling of the gorhom sheet, so it is viewport-relative.)
  assert.match(
    prefs,
    /overlay=\{paywall\}/,
    "T-A1b (fails-on-revert): the paywall MUST be routed through BaseBottomSheet's viewport-fixed `overlay` slot, not mounted as a scroll child",
  );

  // ── T-A1c: BaseBottomSheet exposes the additive `overlay` slot as a SIBLING of
  //    the gorhom sheet INSIDE the wrapInRNModal window, painted AFTER {sheet}. ───
  assert.match(baseSheet, /overlay\?\s*:\s*ReactNode/, "T-A1c: BaseBottomSheet declares the additive `overlay?: ReactNode` slot");
  const ghrvIdx = baseSheet.indexOf("<GestureHandlerRootView");
  const ghrvClose = baseSheet.indexOf("</GestureHandlerRootView>", ghrvIdx);
  assert.ok(ghrvIdx !== -1 && ghrvClose !== -1, "T-A1c: the wrapInRNModal GestureHandlerRootView must exist");
  const ghrvBlock = baseSheet.slice(ghrvIdx, ghrvClose);
  const sheetChildIdx = ghrvBlock.indexOf("{sheet}");
  const overlayChildIdx = ghrvBlock.indexOf("{overlay}");
  assert.ok(
    sheetChildIdx !== -1 && overlayChildIdx !== -1 && overlayChildIdx > sheetChildIdx,
    "T-A1c (fails-on-revert): {overlay} renders as a SIBLING of {sheet}, AFTER it (paints above), inside the wrapInRNModal window",
  );

  // ── T-A2: CustomPaywallScreen exposes the `presentInline` prop + default ──────
  assert.match(paywall, /presentInline\?\s*:\s*boolean/, "T-A2: `presentInline?: boolean` prop declared");
  assert.match(paywall, /presentInline\s*=\s*false/, "T-A2: `presentInline` defaults false so the 7 other call sites keep RN Modal behavior");

  // ── T-A3: CustomPaywallScreen has the in-window absolute-overlay branch ───────
  assert.match(paywall, /presentInline\s*\?/, "T-A3 (fails-on-revert): a `presentInline ?` render branch must exist");
  assert.match(paywall, /inlineOverlay/, "T-A3 (fails-on-revert): the inline-overlay style must exist");
  const overlayStyleStart = paywall.indexOf("inlineOverlay:");
  assert.ok(overlayStyleStart !== -1, "T-A3: inlineOverlay style block");
  const overlayStyleBlock = paywall.slice(overlayStyleStart, overlayStyleStart + 260);
  assert.match(overlayStyleBlock, /position:\s*'absolute'/, "T-A3: overlay is absolutely positioned");
  assert.match(overlayStyleBlock, /backgroundColor:\s*'#1C1C1E'/, "T-A3: overlay is opaque");
  // The default Modal path is preserved for the non-inline call sites.
  assert.match(paywall, /presentationStyle="pageSheet"/, "T-A3: the default RN <Modal> path is preserved");

  // ── T-A4: the locked GPS row is a whole-row pressable → onLockedTap (F-3) ─────
  assert.match(
    advanced,
    /isLocked\s*\?\s*\(\s*<TouchableOpacity/,
    "T-A4 (fails-on-revert): when isLocked the GPS row must be a TouchableOpacity (dead-tap fix)",
  );
  const lockedTouchStart = advanced.indexOf("isLocked ? (");
  const lockedTouchBlock = advanced.slice(lockedTouchStart, lockedTouchStart + 420);
  assert.match(lockedTouchBlock, /onPress=\{onLockedTap\}/, "T-A4: the locked row calls onLockedTap");
  assert.match(lockedTouchBlock, /accessibilityRole="button"/, "T-A4: locked row has button role");
  assert.match(
    lockedTouchBlock,
    /accessibilityLabel="Upgrade to set a custom starting point"/,
    "T-A4: locked row has the upgrade a11y label",
  );
  // The custom text input must still be hidden for locked users (guard unchanged).
  assert.match(advanced, /!useGpsLocation\s*&&\s*!isLocked/, "T-A4: custom location input stays hidden for locked users");

  // ── T-B: behavioral model — locked GPS tap routing ───────────────────────────
  {
    const free = resolveGpsLockedTap({ isEditable: true, isLocked: true });
    assert.equal(free.showPaywall, true, "T-B1: locked + editable → paywall");
    assert.equal(free.feature, "custom_starting_point", "T-B1: feature is custom_starting_point");
  }
  {
    const readOnly = resolveGpsLockedTap({ isEditable: false, isLocked: true });
    assert.equal(readOnly.showPaywall, false, "T-B2: read-only participant view → NO paywall");
  }
  {
    const plus = resolveGpsLockedTap({ isEditable: true, isLocked: false });
    assert.equal(plus.showPaywall, false, "T-B3: Mingla+ (unlocked) → no paywall");
    assert.equal(plus.toggles, true, "T-B3: Mingla+ switch toggles normally");
  }
}

if (require.main === module) {
  try {
    runOrch1315CustomLocationPaywallTest();
    console.log("PASS ORCH-1315 preferences custom-location paywall (presentInline + F-3 dead-tap)");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
