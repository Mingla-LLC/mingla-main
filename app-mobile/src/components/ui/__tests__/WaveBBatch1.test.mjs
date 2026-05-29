#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression suite — META-ORCH-0991 Wave B BATCH 1
 * [BlockUserModal + ReportUserModal + FriendRequestsModal → BaseBottomSheet].
 *
 * Structural/contract test (the @gorhom/bottom-sheet host is NOT mountable in
 * this harness — same approach as the locked Wave-A BaseBottomSheet.test.mjs
 * and NotificationsSheet.test.tsx; SPEC §12).
 *
 * Asserts the load-bearing Batch-1 conversion contracts:
 *   T-1  All 3 modals consume BaseBottomSheet and NONE imports
 *        @gorhom/bottom-sheet directly (sole-consumer invariant preserved —
 *        I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER). This is the
 *        primary fails-on-revert anchor: reverting any conversion re-adds a
 *        raw RN <Modal> shell and drops the <BaseBottomSheet> usage.
 *   T-2  No raw RN `<Modal` shell survives in any of the 3 files (the container
 *        was actually swapped, not layered).
 *   T-3  BlockUserModal uses variant="center-dialog" (a block confirm must NOT
 *        be a flick-away pan-down sheet — investigation §2 footgun rule).
 *   T-4  ReportUserModal is a real sheet at the chosen snap ['90%'], runs
 *        keyboard-aware (keyboardBehavior + BottomSheetTextInput, NOT a raw RN
 *        TextInput), and z-stacks via wrapInRNModal (opened over chat).
 *   T-5  FriendRequestsModal is a real sheet at ['88%'] and does NOT wrap in RN
 *        Modal (mounted high in the tree from HomePage, like NotificationsSheet).
 *   T-6  The primitive re-exports BottomSheetTextInput so form consumers stay
 *        gate-clean.
 *
 * ADVERSARIAL angle (T-A1): a conversion is worthless if it keeps the old
 * center/flex-end RN scrim instead of letting the sheet own the backdrop. We
 * assert the removed scrim/overlay style keys (`overlay` in Block/Report,
 * `sheetOverlay`/`sheetContent` in FriendRequests) are GONE — catching a
 * "wrapped the sheet inside the old overlay View" half-migration that would
 * still render but double up chrome and break pan-down.
 *
 * FAILS-ON-REVERT: verified by `git stash` of the Batch-1 diff — reverting
 * restores the raw <Modal> shells, flipping T-1/T-2/T-3/T-4/T-5 and the
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
  const BLOCK = "app-mobile/src/components/BlockUserModal.tsx";
  const REPORT = "app-mobile/src/components/ReportUserModal.tsx";
  const FRIENDS = "app-mobile/src/components/FriendRequestsModal.tsx";
  const BASE = "app-mobile/src/components/ui/BaseBottomSheet.tsx";

  const block = read(BLOCK);
  const report = read(REPORT);
  const friends = read(FRIENDS);
  const base = read(BASE);

  // ── T-1: all 3 consume BaseBottomSheet, none imports gorhom directly ───────
  for (const [name, src] of [
    ["BlockUserModal", block],
    ["ReportUserModal", report],
    ["FriendRequestsModal", friends],
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

  // ── T-2: no raw RN <Modal> shell survives ──────────────────────────────────
  for (const [name, src] of [
    ["BlockUserModal", block],
    ["ReportUserModal", report],
    ["FriendRequestsModal", friends],
  ]) {
    assert.doesNotMatch(
      code(src),
      /<Modal\b/,
      `T-2 ${name} must not retain a raw RN <Modal> shell`,
    );
    // The `Modal` import from react-native must be gone too.
    assert.doesNotMatch(
      code(src),
      /import\s+\{[^}]*\bModal\b[^}]*\}\s+from\s+["']react-native["']/,
      `T-2 ${name} must not import Modal from react-native`,
    );
  }

  // ── T-3: BlockUserModal is a center-dialog (no flick-away pan-down) ─────────
  assert.match(
    code(block),
    /variant=["']center-dialog["']/,
    "T-3 BlockUserModal uses variant='center-dialog'",
  );

  // ── T-4: ReportUserModal — real sheet, keyboard-aware, z-stacked ───────────
  assert.match(code(report), /snapPoints=\{REPORT_SNAP_POINTS\}/, "T-4 Report passes its snap");
  assert.match(code(report), /REPORT_SNAP_POINTS\s*=\s*\[\s*['"]90%['"]\s*\]/, "T-4 Report snap is ['90%']");
  assert.match(code(report), /wrapInRNModal/, "T-4 Report z-stacks over chat (wrapInRNModal)");
  assert.match(code(report), /keyboardBehavior=/, "T-4 Report is keyboard-aware");
  assert.match(code(report), /<BottomSheetTextInput\b/, "T-4 Report uses BottomSheetTextInput");
  assert.doesNotMatch(
    code(report),
    /<TextInput\b/,
    "T-4 Report must NOT keep a raw RN <TextInput> (keyboard would hide it inside a gorhom sheet)",
  );
  assert.doesNotMatch(
    code(report),
    /import\s+\{[^}]*\bTextInput\b[^}]*\}\s+from\s+["']react-native["']/,
    "T-4 Report must not import TextInput from react-native",
  );

  // ── T-5: FriendRequestsModal — real sheet at ['88%'], NOT RN-Modal-wrapped ─
  assert.match(code(friends), /snapPoints=\{FRIEND_REQUESTS_SNAP_POINTS\}/, "T-5 Friends passes its snap");
  assert.match(
    code(friends),
    /FRIEND_REQUESTS_SNAP_POINTS\s*=\s*\[\s*['"]88%['"]\s*\]/,
    "T-5 Friends snap is ['88%'] (preserves prior 0.88 height)",
  );
  assert.doesNotMatch(
    code(friends),
    /wrapInRNModal/,
    "T-5 Friends must NOT wrapInRNModal (mounted high in tree from HomePage)",
  );

  // ── T-6: primitive re-exports BottomSheetTextInput ─────────────────────────
  assert.match(
    base,
    /export\s*\{\s*BottomSheetTextInput\s*\}/,
    "T-6 BaseBottomSheet re-exports BottomSheetTextInput for gate-clean form consumers",
  );

  // ── T-A1 (adversarial): old RN scrim/overlay style shells are GONE ─────────
  // A half-migration that nests <BaseBottomSheet> inside the old overlay View
  // would still render but double the chrome and kill pan-down. The removed
  // style keys prove the container was actually swapped, not layered.
  assert.doesNotMatch(code(block), /overlay:\s*\{/, "T-A1 BlockUserModal old `overlay` scrim style removed");
  assert.doesNotMatch(code(report), /overlay:\s*\{/, "T-A1 ReportUserModal old `overlay` scrim style removed");
  assert.doesNotMatch(code(report), /modalContainer:\s*\{/, "T-A1 ReportUserModal old `modalContainer` style removed");
  assert.doesNotMatch(code(friends), /sheetOverlay:\s*\{/, "T-A1 FriendRequestsModal old `sheetOverlay` scrim removed");
  assert.doesNotMatch(code(friends), /sheetContent:\s*\{/, "T-A1 FriendRequestsModal old fixed-height `sheetContent` removed");
}

try {
  run();
  console.log(
    "PASS META-ORCH-0991 Wave B Batch-1 regression suite (BlockUser + ReportUser + FriendRequests → BaseBottomSheet)",
  );
} catch (error) {
  console.error(error);
  process.exit(1);
}
