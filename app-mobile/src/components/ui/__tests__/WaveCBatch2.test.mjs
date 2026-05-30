#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression suite — META-ORCH-0991 Wave C BATCH 2
 * [AccountSettings nested-modal chain → BaseBottomSheet].
 *
 * The hardest Wave-C conversion: ONE component that was 5 sibling RN <Modal>s —
 * a root account-settings Modal plus 4 nested-picker Modals (gender, language,
 * birthday, delete-confirm) toggled by separate `visible` flags, where the
 * picker Modals open OVER the root on the iOS window stack.
 *
 * gorhom sheets do NOT portal/stack, and (proven on the iPhone 17 Pro sim during
 * this implement) two `wrapInRNModal` BaseBottomSheets CANNOT co-present on iOS —
 * iOS throws "Attempt to present <RCTFabricModalHostViewController> … which is
 * already presenting <RCTFabricModalHostViewController>" and the child silently
 * fails to appear. The conversion therefore uses the playbook §3d
 * ONE-SHEET-AT-A-TIME (option i) pattern:
 *
 *   • Root settings → BaseBottomSheet (sheet variant), fixed ['92%'] snap
 *     (was a flex:1 sheet from windowHeight*0.08 ≈ 92% — BillingSheet precedent),
 *     wrapInRNModal (mounts from ProfilePage UNDER the floating GlassBottomNav —
 *     the Batch-2 z-trap), light theme.
 *   • The 3 pickers → sibling BaseBottomSheet roots (gender ['45%'], language
 *     ['70%'] = its old maxHeight 70%, birthday ['60%']), each wrapInRNModal.
 *   • The root's `visible` is GATED on `!anyChildOpen`: while any picker /
 *     country-picker / delete-dialog is open, the root sheet's RN-Modal window
 *     is DROPPED so the child owns the single iOS presentation slot. The root's
 *     onClose is wrapped (`handleRootClose`) so the suppressed-for-child close
 *     does NOT fire the parent onClose (which would tear down the whole flow).
 *     On child dismiss the root re-presents at its prior snap → value applied.
 *   • Delete-account confirm → variant="center-dialog" (NON-swipe), per the
 *     operator destructive-confirm rule (playbook §1) — multi-step confirm/
 *     deleting/success/error states render as the dialog children; the local
 *     scrim/card/overlay chrome was stripped (the dialog supplies it).
 *   • The BirthdayPicker's 3 column wheels were raw RN <ScrollView>s (vertical
 *     lists inside a sheet → they fight the pan); they are now
 *     BottomSheetScrollView so they coordinate with the sheet gesture.
 *   • CountryPickerModal is an EXCLUDED sub-component (not one of the 5 targets);
 *     it stays as a sibling fragment, untouched (BillingSheet/PairRequest
 *     precedent).
 *
 * Sim-verified on iPhone 17 Pro via Metro :8100: root rolls up; each picker
 * presents over the (dismissed) root, a pick returns to settings with the value
 * applied (Gender Man→Woman captured), birthday Cancel + delete "Never mind"
 * both return cleanly; delete confirm is a centered NON-swipe card; root
 * swipe-down dismisses to the Profile page. No stuck/blank sheet at any step.
 *
 * Structural/contract test (the @gorhom/bottom-sheet host is NOT mountable in
 * this harness — same approach as the locked Wave-A BaseBottomSheet.test.mjs and
 * the Batch-1..5 + Wave-C-Batch-1 suites; playbook §8).
 *
 * Asserts the load-bearing conversion contracts:
 *   T-1  AccountSettings consumes BaseBottomSheet; does NOT import gorhom directly.
 *   T-2  No raw RN <Modal> SHELL survives in the file; RN Modal import removed.
 *   T-3  Exactly FIVE <BaseBottomSheet> (root + 3 pickers + delete center-dialog).
 *   T-4  The delete-account confirm is the ONLY center-dialog (destructive rule);
 *        the root + 3 pickers are NOT center-dialog (swipe-down sheets).
 *   T-5  Fixed snaps present (no enableDynamicSizing): ['92%'] ['45%'] ['70%'] ['60%'].
 *   T-6  Every sheet z-stacks via wrapInRNModal (ProfilePage tab-bar trap).
 *   T-7  NESTING STATE MACHINE — root `visible` is gated on !anyChildOpen AND a
 *        wrapped root onClose handler swallows the suppressed-for-child close.
 *   T-8  Birthday column wheels use BottomSheetScrollView (gorhom-aware), not raw
 *        RN <ScrollView>.
 *
 * ADVERSARIAL (T-A1): a conversion is worthless if it keeps the old RN scrim /
 * overlay / hand-rolled sheet card / cosmetic drag handle / picker-overlay /
 * delete-overlay styles. Assert those dead style keys are GONE.
 *
 * ADVERSARIAL (T-A2 — the nesting footgun this batch exists to guard): if a
 * future edit makes the root `visible={visible}` (ungated) again while keeping
 * the pickers wrapInRNModal, the two-RN-Modal co-present crash returns and the
 * pickers silently fail to appear on iOS. Assert the gate is INTACT: the root
 * must NOT be rendered with a bare `visible={visible}` and the `anyChildOpen`
 * derivation must exist.
 *
 * FAILS-ON-REVERT: verified by `git stash` of this batch's diff — reverting
 * restores the raw <Modal> shells + the picker/delete overlays + the
 * windowHeight*0.08 sheet, flipping T-1/T-2/T-3/T-4/T-5/T-6/T-7/T-8/T-A1/T-A2.
 * Anchor commit recorded in the implementation report.
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

const ACCOUNT_SETTINGS = "app-mobile/src/components/profile/AccountSettings.tsx";

function run() {
  const src = read(ACCOUNT_SETTINGS);
  const c = code(src);

  // ── T-1: consumes BaseBottomSheet; no direct gorhom import ─────────────────
  assert.match(
    src,
    /import\s*\{[\s\S]*?BaseBottomSheet[\s\S]*?\}\s*from\s+['"][^'"]*ui\/BaseBottomSheet['"]/,
    "T-1: must import BaseBottomSheet from ui/BaseBottomSheet",
  );
  assert.match(c, /<BaseBottomSheet\b/, "T-1: must render <BaseBottomSheet>");
  assert.ok(!importsGorhom(src), "T-1: must NOT import @gorhom/bottom-sheet directly");

  // ── T-2: no raw RN <Modal> shell survives; RN Modal import removed ─────────
  assert.ok(
    !/<Modal\b/.test(c),
    "T-2: converted file must have no raw <Modal> shell (root + pickers + delete all converted)",
  );
  assert.ok(
    !/^\s*Modal,?\s*$/m.test(c),
    "T-2: RN Modal import should be removed from the react-native import",
  );
  // Pressable was only used for the old scrim taps — must be gone too.
  assert.ok(
    !/^\s*Pressable,?\s*$/m.test(c),
    "T-2: RN Pressable import (old scrim taps) should be removed",
  );

  // ── T-3: exactly FIVE BaseBottomSheet (root + 3 pickers + delete dialog) ───
  const sheetCount = (c.match(/<BaseBottomSheet\b/g) || []).length;
  assert.equal(
    sheetCount,
    5,
    `T-3: expected exactly 5 <BaseBottomSheet> (root + gender + language + birthday + delete center-dialog), found ${sheetCount}`,
  );

  // ── T-4: ONLY the delete-account confirm is center-dialog ──────────────────
  const centerDialogCount = (c.match(/variant=["']center-dialog["']/g) || []).length;
  assert.equal(
    centerDialogCount,
    1,
    `T-4: exactly ONE center-dialog (the destructive delete-account confirm), found ${centerDialogCount}`,
  );
  // The center-dialog must be the delete surface (its onClose is closeDeleteModal).
  assert.match(
    c,
    /variant=["']center-dialog["'][\s\S]{0,200}closeDeleteModal/,
    "T-4: the center-dialog must be the delete-account confirm (onClose={closeDeleteModal})",
  );

  // ── T-5: fixed snaps present; no enableDynamicSizing ───────────────────────
  for (const snap of ["92%", "45%", "70%", "60%"]) {
    assert.ok(
      c.includes(`"${snap}"`),
      `T-5: fixed snap ['${snap}'] must be present (root 92 / gender 45 / language 70 / birthday 60)`,
    );
  }
  assert.ok(
    !/enableDynamicSizing/.test(c),
    "T-5: must use FIXED snaps, not enableDynamicSizing (off-screen lesson)",
  );
  // The old windowHeight*0.08 sheet-top math must be gone.
  assert.ok(
    !/useWindowDimensions/.test(c),
    "T-5: old useWindowDimensions sheet-sizing must be gone (snap replaces it)",
  );

  // ── T-6: every sheet z-stacks via wrapInRNModal ────────────────────────────
  const wrapCount = (c.match(/wrapInRNModal/g) || []).length;
  // 4 sheet-variant surfaces wrap (root + 3 pickers); the center-dialog is
  // RN-Modal-backed automatically, so it does NOT take wrapInRNModal.
  assert.ok(
    wrapCount >= 4,
    `T-6: the 4 sheet-variant surfaces must z-stack via wrapInRNModal, found ${wrapCount}`,
  );

  // ── T-7: NESTING STATE MACHINE — root gated + wrapped onClose ──────────────
  assert.match(
    c,
    /const\s+anyChildOpen\s*=/,
    "T-7: must derive `anyChildOpen` from the picker/country/delete flags",
  );
  assert.match(
    c,
    /visible=\{\s*visible\s*&&\s*!anyChildOpen\s*\}/,
    "T-7: root sheet `visible` must be GATED on `visible && !anyChildOpen` (one-sheet-at-a-time — frees the single iOS RN-Modal presentation slot)",
  );
  assert.match(
    c,
    /const\s+handleRootClose\s*=/,
    "T-7: must wrap the root onClose (`handleRootClose`) so a suppressed-for-child close does not tear down the whole settings flow",
  );
  assert.match(
    c,
    /onClose=\{handleRootClose\}/,
    "T-7: the root sheet must use `onClose={handleRootClose}` (not the bare parent onClose)",
  );

  // ── T-8: birthday column wheels use the gorhom-aware scroller ──────────────
  assert.match(
    c,
    /<BottomSheetScrollView\b/,
    "T-8: birthday column wheels must use BottomSheetScrollView (gorhom-aware), not raw RN <ScrollView>",
  );
  assert.match(
    src,
    /import\s*\{[\s\S]*?BottomSheetScrollView[\s\S]*?\}\s*from\s+['"][^'"]*ui\/BaseBottomSheet['"]/,
    "T-8: BottomSheetScrollView must be imported from BaseBottomSheet (sole-consumer invariant)",
  );

  // ── T-A1 ADVERSARIAL: old scrim/overlay/sheet/handle/picker/delete styles gone
  for (const key of [
    "overlay:",
    "sheet:",
    "dragHandle:",
    "pickerOverlay:",
    "pickerSheet:",
    "pickerHandle:",
    "deleteOverlay:",
    "deleteModalContainer:",
  ]) {
    assert.ok(
      !c.includes(key),
      `T-A1: dead style key \`${key}\` must be removed (chrome now from BaseBottomSheet / center-dialog)`,
    );
  }

  // ── T-A2 ADVERSARIAL: the nesting gate must not regress to ungated visible ─
  // If a future edit drops the gate (root `visible={visible}`) while keeping the
  // pickers wrapInRNModal, the two-RN-Modal co-present crash returns on iOS and
  // the pickers silently fail. The root must NEVER be rendered with a bare
  // `visible={visible}` (it must be the gated form asserted in T-7).
  assert.ok(
    !/visible=\{visible\}/.test(c),
    "T-A2: root sheet must NOT use ungated `visible={visible}` — that re-introduces the two-RN-Modal co-present crash (pickers silently fail). Use `visible={visible && !anyChildOpen}`.",
  );

  console.log("PASS META-ORCH-0991 Wave C Batch-2 regression suite (T-1..T-8, T-A1, T-A2)");
}

run();
