#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression suite — META-ORCH-0991 Wave B BATCH 2
 * [EditBioSheet + EditInterestsSheet + BillingSheet → BaseBottomSheet].
 *
 * Profile/settings form cluster. All three are NON-destructive → full
 * swipe-down `BaseBottomSheet` sheets (NOT center-dialog). All mount from
 * ProfilePage, which sits UNDER the floating GlassBottomNav (a later sibling in
 * the tree), so all three z-stack via `wrapInRNModal` — otherwise the sheet
 * renders under the floating tab bar.
 *
 * Structural/contract test (the @gorhom/bottom-sheet host is NOT mountable in
 * this harness — same approach as the locked Wave-A BaseBottomSheet.test.mjs
 * and the Batch-1 WaveBBatch1.test.mjs; SPEC §12).
 *
 * Asserts the load-bearing Batch-2 conversion contracts:
 *   T-1  All 3 sheets consume BaseBottomSheet and NONE imports
 *        @gorhom/bottom-sheet directly (sole-consumer invariant preserved —
 *        I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER). Primary
 *        fails-on-revert anchor: reverting any conversion re-adds a raw RN
 *        <Modal> shell and drops the <BaseBottomSheet> usage.
 *   T-2  No raw RN `<Modal>` shell + no `Modal` import survives in any of the 3.
 *   T-3  EditBioSheet — has a textarea → keyboard-aware (keyboardBehavior +
 *        BottomSheetTextInput, NOT a raw RN TextInput), content-height via
 *        enableDynamicSizing, z-stacks via wrapInRNModal.
 *   T-4  EditInterestsSheet — chips picker, snap ['85%'] (preserves prior
 *        maxHeight 85%), z-stacks via wrapInRNModal, no text input.
 *   T-5  BillingSheet — full-detail sheet at snap ['92%'] (preserves prior
 *        ~92% height), z-stacks via wrapInRNModal.
 *   T-6  None of the 3 is a center-dialog (these are forms, not destructive
 *        confirms — they MUST be swipe-down sheets per the operator rule).
 *
 * ADVERSARIAL (T-A1): a conversion is worthless if it keeps the old flex-end RN
 * scrim/overlay or the hand-rolled fixed-height card. We assert the removed
 * style keys are GONE: `backdrop`/`card` (Bio+Interests), `overlay`/`sheet`/
 * `dragHandle` (Billing). Catches a "wrapped the sheet inside the old overlay
 * View" half-migration that would still render but double the chrome and break
 * pan-down, and proves the cosmetic Billing drag handle was replaced by the real
 * gorhom one.
 *
 * FAILS-ON-REVERT: verified by `git stash` of the Batch-2 diff — reverting
 * restores the raw <Modal> shells, flipping T-1/T-2/T-3/T-4/T-5/T-6 and the
 * adversarial T-A1. Anchor commit recorded in the implementation report.
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

function run() {
  const BIO = "app-mobile/src/components/profile/EditBioSheet.tsx";
  const INTERESTS = "app-mobile/src/components/profile/EditInterestsSheet.tsx";
  const BILLING = "app-mobile/src/components/profile/BillingSheet.tsx";

  const bio = read(BIO);
  const interests = read(INTERESTS);
  const billing = read(BILLING);

  // ── T-1: all 3 consume BaseBottomSheet, none imports gorhom directly ───────
  for (const [name, src] of [
    ["EditBioSheet", bio],
    ["EditInterestsSheet", interests],
    ["BillingSheet", billing],
  ]) {
    assert.match(
      src,
      /import\s+\{[^}]*\bBaseBottomSheet\b[^}]*\}\s+from\s+['"][^'"]*ui\/BaseBottomSheet['"]/,
      `T-1 ${name} imports BaseBottomSheet from the primitive`,
    );
    assert.match(src, /<BaseBottomSheet\b/, `T-1 ${name} renders <BaseBottomSheet>`);
    assert.ok(
      !importsGorhom(src),
      `T-1 ${name} must NOT import @gorhom/bottom-sheet directly`,
    );
  }

  // ── T-2: no raw RN <Modal> shell survives + no Modal import ────────────────
  for (const [name, src] of [
    ["EditBioSheet", bio],
    ["EditInterestsSheet", interests],
    ["BillingSheet", billing],
  ]) {
    assert.doesNotMatch(
      code(src),
      /<Modal\b/,
      `T-2 ${name} must not retain a raw RN <Modal> shell`,
    );
    assert.doesNotMatch(
      code(src),
      /import\s+\{[^}]*\bModal\b[^}]*\}\s+from\s+["']react-native["']/,
      `T-2 ${name} must not import Modal from react-native`,
    );
  }

  // ── T-3: EditBioSheet — keyboard-aware textarea, content-height, z-stacked ─
  assert.match(code(bio), /enableDynamicSizing/, "T-3 Bio opens content-height (enableDynamicSizing)");
  assert.match(code(bio), /wrapInRNModal/, "T-3 Bio z-stacks over the floating tab bar (wrapInRNModal)");
  assert.match(code(bio), /keyboardBehavior=/, "T-3 Bio is keyboard-aware");
  assert.match(code(bio), /<BottomSheetTextInput\b/, "T-3 Bio uses BottomSheetTextInput");
  assert.doesNotMatch(
    code(bio),
    /<TextInput\b/,
    "T-3 Bio must NOT keep a raw RN <TextInput> (keyboard would hide it inside a gorhom sheet)",
  );
  assert.doesNotMatch(
    code(bio),
    /import\s+\{[^}]*\bTextInput\b[^}]*\}\s+from\s+["']react-native["']/,
    "T-3 Bio must not import TextInput from react-native",
  );

  // ── T-4: EditInterestsSheet — chips picker, snap ['85%'], z-stacked ────────
  assert.match(code(interests), /snapPoints=\{EDIT_INTERESTS_SNAP_POINTS\}/, "T-4 Interests passes its snap");
  assert.match(
    code(interests),
    /EDIT_INTERESTS_SNAP_POINTS\s*=\s*\[\s*['"]85%['"]\s*\]/,
    "T-4 Interests snap is ['85%'] (preserves prior maxHeight 85%)",
  );
  assert.match(code(interests), /wrapInRNModal/, "T-4 Interests z-stacks over the floating tab bar");

  // ── T-5: BillingSheet — full-detail sheet at ['92%'], z-stacked ────────────
  assert.match(code(billing), /snapPoints=\{BILLING_SNAP_POINTS\}/, "T-5 Billing passes its snap");
  assert.match(
    code(billing),
    /BILLING_SNAP_POINTS\s*=\s*\[\s*["']92%["']\s*\]/,
    "T-5 Billing snap is ['92%'] (preserves prior ~92% height)",
  );
  assert.match(code(billing), /wrapInRNModal/, "T-5 Billing z-stacks over the floating tab bar");

  // ── T-6: none of the 3 is a center-dialog (forms must be swipe-down) ───────
  for (const [name, src] of [
    ["EditBioSheet", bio],
    ["EditInterestsSheet", interests],
    ["BillingSheet", billing],
  ]) {
    assert.doesNotMatch(
      code(src),
      /variant=["']center-dialog["']/,
      `T-6 ${name} is a form, NOT a destructive confirm → must be a swipe-down sheet (operator rule)`,
    );
  }

  // ── T-A1 (adversarial): old RN scrim/overlay/hand-rolled shells are GONE ───
  assert.doesNotMatch(code(bio), /backdrop:\s*\{/, "T-A1 EditBioSheet old `backdrop` scrim style removed");
  assert.doesNotMatch(code(bio), /card:\s*\{/, "T-A1 EditBioSheet old `card` flex-end card style removed");
  assert.doesNotMatch(code(interests), /backdrop:\s*\{/, "T-A1 EditInterestsSheet old `backdrop` scrim style removed");
  assert.doesNotMatch(code(interests), /card:\s*\{/, "T-A1 EditInterestsSheet old `card` flex-end card style removed");
  assert.doesNotMatch(code(billing), /overlay:\s*\{/, "T-A1 BillingSheet old `overlay` scrim style removed");
  assert.doesNotMatch(code(billing), /sheet:\s*\{/, "T-A1 BillingSheet old `sheet` flex:1 container style removed");
  assert.doesNotMatch(
    code(billing),
    /dragHandle:\s*\{/,
    "T-A1 BillingSheet cosmetic `dragHandle` removed (replaced by the real gorhom handle)",
  );
}

try {
  run();
  console.log(
    "PASS META-ORCH-0991 Wave B Batch-2 regression suite (EditBio + EditInterests + Billing → BaseBottomSheet)",
  );
} catch (error) {
  console.error(error);
  process.exit(1);
}
