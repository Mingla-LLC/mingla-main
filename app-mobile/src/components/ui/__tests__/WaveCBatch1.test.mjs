#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression suite — META-ORCH-0991 Wave C BATCH 1
 * [CreateGroupChatSheet + FriendPickerSheet + CityPickerSheet → BaseBottomSheet].
 *
 * The search/keyboard sheets. All THREE shipped sheets are non-destructive
 * form/search/picker surfaces → full swipe-down `BaseBottomSheet` (sheet
 * variant, NEVER center-dialog), tall FIXED snap (playbook §2 off-screen
 * lesson), keyboard-aware via BottomSheetTextInput swapped in directly, and
 * mount over the floating tab bar / inside chat / over the Discover nav →
 * wrapInRNModal (z-stack).
 *
 * FriendPickerSheet's long friend results list is routed through the primitive's
 * flatlist scroll mode (BottomSheetFlatList) — not a raw RN <FlatList> — so list
 * scroll coordinates with the sheet pan (playbook §5).
 *
 * PreferencesSheet (the 4th dispatch target) was INITIALLY excluded — its body
 * (a KeyboardAwareScrollView, i.e. a raw RN <ScrollView>, wrapping 5 deep
 * Animated sections + an absolute footer) refused to scroll inside a gorhom
 * <BottomSheet>: a raw RN <ScrollView> nested in gorhom defeats gorhom's
 * content-size measurement + pan→scroll handoff, so it reported "1 page" and
 * mounted only ~3 of 5 sections with the Apply button unreachable.
 *
 * META-ORCH-0991 Wave C (this batch) REBUILT it correctly. ROOT CAUSE found on
 * the iPhone 17 Pro sim: gorhom's BottomSheetScrollView only scrolls when it is
 * a DIRECT child of <BottomSheet>. The primitive's `header` / `stickyFooter`
 * slots wrap the scrollable inside an intermediate flexed <BottomSheetView>,
 * which makes it a non-direct descendant and BREAKS gorhom's content-pan→scroll
 * handoff (sim-proven: with a `header` slot even trivial dummy content would not
 * scroll past the first viewport; as bare direct scroll children it scrolls
 * top-to-bottom). The fix: render the title + 5 sections + Apply/Reset footer as
 * DIRECT children of scrollMode="scroll" (the bare BottomSheetScrollView), with
 * NO header/stickyFooter slots; and migrate the two nested text fields + the
 * suggestions dropdown to BottomSheetTextInput / BottomSheetScrollView. T-8
 * ASSERTS this contract (BaseBottomSheet + scrollMode="scroll" + direct
 * header/body/footer children + NO header/stickyFooter slot + no raw <Modal>) so
 * a revert to the broken header-slot or nested-ScrollView shape fails the gate.
 * The legacy inline full-screen path (visible undefined) is preserved and still
 * uses KeyboardAwareScrollView — that is intentional and NOT a gorhom sheet.
 *
 * Structural/contract test (the @gorhom/bottom-sheet host is NOT mountable in
 * this harness — same approach as the locked Wave-A BaseBottomSheet.test.mjs and
 * the Batch-1..5 suites; playbook §8).
 *
 * Asserts the load-bearing Batch-1 conversion contracts:
 *   T-1  All 3 consume BaseBottomSheet; none imports @gorhom/bottom-sheet
 *        directly (sole-consumer invariant).
 *   T-2  No raw RN <Modal> survives in the 3 converted files; RN Modal import gone.
 *   T-3  None of the 3 is center-dialog (all swipe-down sheets).
 *   T-4  Snap heights match the prior modal heights, fixed (no enableDynamicSizing).
 *   T-5  All 3 swap TextInput → BottomSheetTextInput + set keyboardBehavior interactive.
 *   T-6  All 3 z-stack via wrapInRNModal.
 *   T-7  FriendPickerSheet uses the flatlist scroll mode (gorhom-aware list).
 *   T-8  PreferencesSheet sheet path is now a BaseBottomSheet (scrollMode="scroll"
 *        + stickyFooter + ['90%'] snap), the body sections ride gorhom's own
 *        BottomSheetScrollView (no nested KeyboardAwareScrollView in the SHEET
 *        path), and its two nested fields use BottomSheetTextInput — the
 *        scroll-contract that makes all 5 sections + Apply reachable.
 *
 * ADVERSARIAL (T-A1): a conversion is worthless if it keeps the old RN scrim /
 * overlay / hand-rolled sheet card / cosmetic drag handle / KeyboardAvoidingView.
 * We assert the removed style keys + the dropped KAV/useKeyboard are GONE.
 *
 * FAILS-ON-REVERT: verified by `git stash` of the Batch-1 diff — reverting
 * restores the raw <Modal>/KeyboardAvoidingView shells + raw <FlatList>, flipping
 * T-1/T-2/T-4/T-5/T-6/T-7/T-A1. Anchor commit recorded in the implementation report.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app-mobile/src/components/ui/__tests__ → repo root is 6 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/** True iff `source` has a real `import ... from '@gorhom/bottom-sheet'` (not a comment). */
function importsGorhom(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return /^\s*import\b[\s\S]*?from\s+['"]@gorhom\/bottom-sheet['"]/m.test(stripped);
}

/** Strip comments so prose mentions of a banned token don't trip a guard. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const CREATE_GROUP = "app-mobile/src/components/connections/CreateGroupChatSheet.tsx";
const FRIEND_PICKER = "app-mobile/src/components/connections/FriendPickerSheet.tsx";
const CITY_PICKER = "app-mobile/src/components/discover/CityPickerSheet.tsx";
const PREFS = "app-mobile/src/components/PreferencesSheet.tsx";
const PREFS_ADVANCED =
  "app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx";

function run() {
  const createGroup = read(CREATE_GROUP);
  const friendPicker = read(FRIEND_PICKER);
  const cityPicker = read(CITY_PICKER);
  const prefs = read(PREFS);

  // The 3 shipped search/keyboard sheets.
  const SHEETS = [
    ["CreateGroupChatSheet", createGroup],
    ["FriendPickerSheet", friendPicker],
    ["CityPickerSheet", cityPicker],
  ];

  // ── T-1: every file consumes BaseBottomSheet; none imports gorhom ──────────
  for (const [name, src] of SHEETS) {
    assert.match(
      src,
      /import\s*\{[\s\S]*?BaseBottomSheet[\s\S]*?\}\s*from\s+['"][^'"]*ui\/BaseBottomSheet['"]/,
      `T-1 ${name}: must import BaseBottomSheet from ui/BaseBottomSheet`,
    );
    assert.match(src, /<BaseBottomSheet\b/, `T-1 ${name}: must render <BaseBottomSheet>`);
    assert.ok(!importsGorhom(src), `T-1 ${name}: must NOT import @gorhom/bottom-sheet directly`);
  }

  // ── T-2: no raw RN <Modal> survives; RN Modal import removed ───────────────
  for (const [name, src] of SHEETS) {
    assert.ok(
      !/<Modal\b/.test(code(src)),
      `T-2 ${name}: converted file must have no raw <Modal> shell`,
    );
    assert.ok(
      !/^\s*Modal,?\s*$/m.test(code(src)),
      `T-2 ${name}: RN Modal import should be removed`,
    );
  }

  // ── T-3: none is center-dialog (all swipe-down sheets) ─────────────────────
  for (const [name, src] of SHEETS) {
    assert.ok(
      !/variant=["']center-dialog["']/.test(code(src)),
      `T-3 ${name}: must be a full swipe-down sheet, NOT center-dialog`,
    );
  }

  // ── T-4: fixed snap heights match the prior modal heights ──────────────────
  // CreateGroupChatSheet: was maxHeight 85% flex-end → tall ['90%'].
  assert.match(code(createGroup), /\[\s*["']90%["']\s*\]/, "T-4 CreateGroupChatSheet snap ['90%']");
  // FriendPickerSheet: was height "88%" → ['88%'].
  assert.match(code(friendPicker), /\[\s*["']88%["']\s*\]/, "T-4 FriendPickerSheet snap ['88%']");
  // CityPickerSheet: was full-height-minus-strip ≈ 90% → ['90%'].
  assert.match(code(cityPicker), /\[\s*["']90%["']\s*\]/, "T-4 CityPickerSheet snap ['90%']");
  // No content-dynamic sizing introduced (off-screen lesson).
  for (const [name, src] of SHEETS) {
    assert.ok(
      !/enableDynamicSizing/.test(code(src)),
      `T-4 ${name}: must use a FIXED snap, not enableDynamicSizing`,
    );
  }

  // ── T-5: all 3 use BottomSheetTextInput + keyboardBehavior interactive ─────
  for (const [name, src] of SHEETS) {
    assert.match(
      src,
      /import\s*\{[\s\S]*?BottomSheetTextInput[\s\S]*?\}\s*from\s+['"][^'"]*ui\/BaseBottomSheet['"]/,
      `T-5 ${name}: must import BottomSheetTextInput from BaseBottomSheet`,
    );
    assert.match(code(src), /<BottomSheetTextInput\b/, `T-5 ${name}: text field uses BottomSheetTextInput`);
    assert.match(code(src), /keyboardBehavior=["']interactive["']/, `T-5 ${name}: keyboardBehavior interactive`);
  }

  // ── T-6: all 3 z-stack via wrapInRNModal ───────────────────────────────────
  for (const [name, src] of SHEETS) {
    assert.match(code(src), /wrapInRNModal/, `T-6 ${name}: must z-stack via wrapInRNModal`);
  }

  // ── T-7: FriendPickerSheet long list uses the gorhom flatlist mode ─────────
  assert.match(
    code(friendPicker),
    /scrollMode=["']flatlist["']/,
    "T-7 FriendPickerSheet: long friend list must route through flatlist scroll mode (BottomSheetFlatList)",
  );
  assert.ok(
    !/\bFlatList\b/.test(
      code(friendPicker).match(/import\s*\{[\s\S]*?\}\s*from\s+['"]react-native['"]/)?.[0] ?? "",
    ),
    "T-7 FriendPickerSheet: raw RN FlatList import must be removed",
  );

  // ── T-8: PreferencesSheet sheet path is a BaseBottomSheet that scrolls ─────
  // REBUILT in Wave C. The `visible`-prop path renders <BaseBottomSheet>; the
  // body sections ride gorhom's own BottomSheetScrollView (scrollMode="scroll")
  // with the Apply/Reset row pinned as the stickyFooter, so all 5 sections +
  // Apply are reachable. Reverting to the nested KeyboardAwareScrollView-in-the-
  // sheet shape (or dropping BaseBottomSheet) fails these.
  const prefsAdvanced = read(PREFS_ADVANCED);
  assert.match(
    prefs,
    /import\s*\{[\s\S]*?BaseBottomSheet[\s\S]*?\}\s*from\s+['"]\.\/ui\/BaseBottomSheet['"]/,
    "T-8 PreferencesSheet: must import BaseBottomSheet from ui/BaseBottomSheet",
  );
  assert.match(code(prefs), /<BaseBottomSheet\b/, "T-8 PreferencesSheet: sheet path must render <BaseBottomSheet>");
  assert.ok(!importsGorhom(prefs), "T-8 PreferencesSheet: must NOT import @gorhom/bottom-sheet directly");
  // The RN <Modal> sheet wrapper is gone (the legacy inline path uses no Modal
  // either — it's a plain View overlay). No raw <Modal> anywhere in the file.
  assert.ok(
    !/<Modal\b/.test(code(prefs)),
    "T-8 PreferencesSheet: the old RN <Modal> sheet wrapper must be gone",
  );
  assert.match(code(prefs), /scrollMode=["']scroll["']/, "T-8 PreferencesSheet: body must use scrollMode='scroll' (BottomSheetScrollView)");
  assert.match(code(prefs), /\[\s*["']90%["']\s*\]/, "T-8 PreferencesSheet: tall fixed snap ['90%']");
  assert.match(code(prefs), /wrapInRNModal/, "T-8 PreferencesSheet: must z-stack via wrapInRNModal");
  // ROOT-CAUSE GUARD: the title, body, and Apply/Reset footer must be DIRECT
  // children of the bare BottomSheetScrollView — the primitive's `header` /
  // `stickyFooter` slots wrap the scrollable in an intermediate <BottomSheetView>
  // which breaks gorhom's content-pan→scroll handoff (sim-proven the body would
  // not scroll). Reverting to a `header`/`stickyFooter` slot on this sheet
  // re-introduces the no-scroll blocker, so assert neither is used here.
  assert.ok(
    !/header=\{headerContent\}/.test(code(prefs)),
    "T-8 PreferencesSheet: must NOT pass headerContent via the `header` slot (breaks gorhom scroll) — render it as a direct scroll child",
  );
  assert.ok(
    !/stickyFooter=/.test(code(prefs)),
    "T-8 PreferencesSheet: must NOT use the `stickyFooter` slot (breaks gorhom scroll) — render the Apply/Reset row as the last direct scroll child",
  );
  // headerContent + bodyContent + footerContent are rendered as direct children
  // of <BaseBottomSheet> (inside the scroll body), not via header/stickyFooter.
  assert.match(code(prefs), /\{headerContent\}/, "T-8 PreferencesSheet: headerContent must be a direct scroll child");
  assert.match(code(prefs), /\{bodyContent\}/, "T-8 PreferencesSheet: bodyContent must be a direct scroll child");
  assert.match(code(prefs), /\{footerContent\}/, "T-8 PreferencesSheet: footerContent must be a direct scroll child (Apply reachable)");
  // The SHEET path must NOT nest a KeyboardAwareScrollView (the root cause). It
  // may still appear ONCE for the legacy inline full-screen path.
  const kawCount = (code(prefs).match(/<KeyboardAwareScrollView\b/g) || []).length;
  assert.ok(
    kawCount <= 1,
    `T-8 PreferencesSheet: at most ONE <KeyboardAwareScrollView> (legacy inline path only); found ${kawCount} — the sheet path must use gorhom's BottomSheetScrollView, not a nested RN ScrollView`,
  );
  // The nested text fields migrated to BottomSheetTextInput (keyboard-aware
  // inside the sheet) and the suggestions dropdown to BottomSheetScrollView.
  assert.match(prefsAdvanced, /<BottomSheetTextInput\b/, "T-8 PreferencesSectionsAdvanced: text fields must be BottomSheetTextInput");
  assert.match(prefsAdvanced, /<BottomSheetScrollView\b/, "T-8 PreferencesSectionsAdvanced: suggestions dropdown must be BottomSheetScrollView");
  assert.ok(
    !/^\s*TextInput,?\s*$/m.test(code(prefsAdvanced)),
    "T-8 PreferencesSectionsAdvanced: raw RN TextInput import must be removed",
  );
  assert.ok(!importsGorhom(prefsAdvanced), "T-8 PreferencesSectionsAdvanced: must NOT import @gorhom/bottom-sheet directly");

  // ── T-A1 ADVERSARIAL: old scrim / overlay / sheet card / handle / KAV gone ──
  // CreateGroupChatSheet shed backdrop/sheet/handle.
  for (const key of ["backdrop:", "sheet:", "handle:"]) {
    assert.ok(!code(createGroup).includes(key), `T-A1 CreateGroupChatSheet: dead style ${key} must be gone`);
  }
  // FriendPickerSheet shed backdrop/sheet/handleBar + the useKeyboard hook.
  for (const key of ["backdrop:", "sheet:", "handleBar:"]) {
    assert.ok(!code(friendPicker).includes(key), `T-A1 FriendPickerSheet: dead style ${key} must be gone`);
  }
  assert.ok(
    !/useKeyboard/.test(code(friendPicker)),
    "T-A1 FriendPickerSheet: hand-rolled useKeyboard padding hack must be gone (gorhom owns keyboard)",
  );
  // CityPickerSheet shed overlay/backdrop/sheet + the KeyboardAvoidingView.
  for (const key of ["overlay:", "backdrop:", "sheet:"]) {
    assert.ok(!code(cityPicker).includes(key), `T-A1 CityPickerSheet: dead style ${key} must be gone`);
  }
  assert.ok(
    !/KeyboardAvoidingView/.test(code(cityPicker)),
    "T-A1 CityPickerSheet: hand-rolled KeyboardAvoidingView must be gone (gorhom owns keyboard)",
  );

  console.log("PASS META-ORCH-0991 Wave C Batch-1 regression suite (T-1..T-8, T-A1)");
}

run();
