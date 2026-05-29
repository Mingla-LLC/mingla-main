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
 * PreferencesSheet (the 4th dispatch target) is INTENTIONALLY EXCLUDED from this
 * batch: its body (a KeyboardAwareScrollView with 5 deep Animated sections + an
 * absolute footer + a sibling paywall Modal) could NOT be made to scroll inside
 * a gorhom <BottomSheet> — four documented patterns were tried on the iPhone 17
 * Pro sim (scrollMode="view" + nested BottomSheetScrollView; scrollMode="scroll"
 * + header/stickyFooter slots; scrollMode="scroll" + inline footer; two-stop
 * ['50%','90%'] snap) and in EVERY case gorhom mounted only ~3 of 5 sections,
 * reported "1 page", and refused to scroll to the travel/"How far?" sections or
 * the Apply button — a broken, un-shippable state. PreferencesSheet therefore
 * remains its original RN <Modal>; the blocker is documented for the orchestrator
 * (Wave C remaining). This test ASSERTS PreferencesSheet stays an RN Modal so a
 * future "fix" doesn't silently ship the broken sheet without re-verifying scroll.
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
 *   T-8  PreferencesSheet is UNCHANGED (still an RN <Modal>) — blocker guard.
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

  // ── T-8: PreferencesSheet stays an RN <Modal> (blocker guard) ──────────────
  // The conversion is intentionally NOT shipped — its body cannot scroll inside
  // a gorhom sheet (see suite header). Assert it still uses the RN Modal so a
  // future change re-verifies scroll on the sim before flipping it.
  assert.match(
    code(prefs),
    /<Modal\b/,
    "T-8 PreferencesSheet: must still use an RN <Modal> (gorhom-scroll blocker — do NOT convert without sim-proving body scroll)",
  );
  assert.ok(
    !/import\s*\{\s*BaseBottomSheet[\s\S]*?\}\s*from\s+['"]\.\/ui\/BaseBottomSheet['"]/.test(prefs),
    "T-8 PreferencesSheet: must NOT import BaseBottomSheet until the body-scroll blocker is resolved",
  );

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
