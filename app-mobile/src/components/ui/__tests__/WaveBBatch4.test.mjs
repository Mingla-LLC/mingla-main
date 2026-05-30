#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression suite — META-ORCH-0991 Wave B BATCH 4
 * [PairRequestModal + IncomingPairRequestCard + PairingInfoCard +
 *  CustomHolidayModal + ProposeDateTimeModal + TicketPdfSheet +
 *  ActionButtons (iOS date/time picker modal ONLY) → BaseBottomSheet].
 *
 * Pairing + custom-holiday + scheduling cluster. TWO of the seven are pure
 * destructive/irreversible CONFIRM cards (accept/decline a pair request; cancel
 * a pairing) → NON-swipe `variant="center-dialog"` per the operator rule
 * (playbook §1). The other five are full swipe-down `BaseBottomSheet` sheets.
 * Two of the sheets are keyboard-aware (PairRequest: search + phone fields;
 * CustomHoliday: name field) → BottomSheetTextInput + interactive keyboard.
 *
 * Structural/contract test (the @gorhom/bottom-sheet host is NOT mountable in
 * this harness — same approach as the locked Wave-A BaseBottomSheet.test.mjs and
 * Batch-1/2/3 suites; playbook §8).
 *
 * Asserts the load-bearing Batch-4 conversion contracts:
 *   T-1  All 7 consume BaseBottomSheet and NONE imports @gorhom/bottom-sheet
 *        directly (sole-consumer invariant — primary fails-on-revert anchor:
 *        reverting any conversion re-adds a raw RN <Modal>/hand-rolled Animated
 *        shell and drops the <BaseBottomSheet> usage).
 *   T-2  No raw RN `<Modal>` SHELL survives in the converted surface. (Note:
 *        ProposeDateTimeModal legitimately keeps RN Modals for its iOS OS pickers
 *        and PairRequestModal renders the excluded CountryPickerModal sub-modal —
 *        those are asserted separately, T-7/T-8, not as the main shell.)
 *   T-3  The two confirm cards are center-dialog (NON-swipe); the five sheets are
 *        NOT center-dialog.
 *   T-4  Snap heights match the prior modal heights (sheets only).
 *   T-5  Keyboard-aware sheets swap TextInput → BottomSheetTextInput + set
 *        keyboardBehavior interactive.
 *   T-6  Sheets mounted over the tab bar z-stack via wrapInRNModal.
 *   T-7  ProposeDateTimeModal keeps its DateTimePicker and wraps the iOS OS
 *        pickers in their own RN Modals (float above the sheet window); custom
 *        slide spring is gone.
 *   T-8  PairRequestModal keeps the excluded CountryPickerModal sub-modal.
 *   T-9  ActionButtons: ONLY the date/time picker modal converted; the Android
 *        native DateTimePicker branch + the rest of the file are intact.
 *
 * ADVERSARIAL (T-A1): a conversion is worthless if it keeps the old RN scrim /
 * overlay or the hand-rolled fixed-position card / cosmetic drag handle. We assert
 * the removed style keys are GONE.
 *
 * FAILS-ON-REVERT: verified by `git stash` of the Batch-4 diff — reverting
 * restores the raw <Modal>/Animated shells, flipping T-1/T-2/T-3/T-4/T-5/T-6/T-A1.
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

const PAIR_REQUEST = "app-mobile/src/components/PairRequestModal.tsx";
const INCOMING = "app-mobile/src/components/IncomingPairRequestCard.tsx";
const PAIRING_INFO = "app-mobile/src/components/PairingInfoCard.tsx";
const CUSTOM_HOLIDAY = "app-mobile/src/components/CustomHolidayModal.tsx";
const PROPOSE = "app-mobile/src/components/activity/ProposeDateTimeModal.tsx";
const TICKET_PDF = "app-mobile/src/components/activity/TicketPdfSheet.tsx";
const ACTION_BUTTONS = "app-mobile/src/components/expandedCard/ActionButtons.tsx";

function run() {
  const pairRequest = read(PAIR_REQUEST);
  const incoming = read(INCOMING);
  const pairingInfo = read(PAIRING_INFO);
  const customHoliday = read(CUSTOM_HOLIDAY);
  const propose = read(PROPOSE);
  const ticketPdf = read(TICKET_PDF);
  const actionButtons = read(ACTION_BUTTONS);

  const ALL = [
    ["PairRequestModal", pairRequest],
    ["IncomingPairRequestCard", incoming],
    ["PairingInfoCard", pairingInfo],
    ["CustomHolidayModal", customHoliday],
    ["ProposeDateTimeModal", propose],
    ["TicketPdfSheet", ticketPdf],
    ["ActionButtons", actionButtons],
  ];
  const CONFIRM_CARDS = [
    ["IncomingPairRequestCard", incoming],
    ["PairingInfoCard", pairingInfo],
  ];
  const SHEETS = [
    ["PairRequestModal", pairRequest],
    ["CustomHolidayModal", customHoliday],
    ["ProposeDateTimeModal", propose],
    ["TicketPdfSheet", ticketPdf],
    ["ActionButtons", actionButtons],
  ];

  // ── T-1: all 7 consume BaseBottomSheet, none imports gorhom directly ───────
  for (const [name, src] of ALL) {
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

  // ── T-2: no raw RN <Modal> SHELL where it was the converted surface ────────
  // PairRequest/Incoming/PairingInfo/CustomHoliday/TicketPdf must shed Modal
  // entirely. ProposeDateTime + ActionButtons keep RN Modals (OS pickers /
  // unrelated), asserted in T-7/T-9 — excluded from this blanket check.
  const FULL_SHED = [
    ["PairRequestModal", pairRequest],
    ["IncomingPairRequestCard", incoming],
    ["PairingInfoCard", pairingInfo],
    ["CustomHolidayModal", customHoliday],
    ["TicketPdfSheet", ticketPdf],
  ];
  for (const [name, src] of FULL_SHED) {
    assert.doesNotMatch(code(src), /<Modal\b/, `T-2 ${name} must not retain a raw RN <Modal> shell`);
    assert.doesNotMatch(
      code(src),
      /import\s+(?:RNModal[\s\S]*?|\{[^}]*\bModal\b[^}]*\})\s+from\s+["']react-native["']/,
      `T-2 ${name} must not import Modal from react-native`,
    );
  }

  // ── T-3: confirm cards are center-dialog; sheets are NOT ───────────────────
  for (const [name, src] of CONFIRM_CARDS) {
    assert.match(
      code(src),
      /variant=["']center-dialog["']/,
      `T-3 ${name} is a destructive/irreversible confirm → center-dialog (NON-swipe)`,
    );
  }
  for (const [name, src] of SHEETS) {
    assert.doesNotMatch(
      code(src),
      /variant=["']center-dialog["']/,
      `T-3 ${name} is a form/picker/viewer → full swipe-down sheet (NOT center-dialog)`,
    );
  }

  // ── T-4: snap heights match the prior modal heights (sheets only) ──────────
  assert.match(code(pairRequest), /PAIR_REQUEST_SNAP_POINTS\s*=\s*\[\s*['"]85%['"]\s*\]/, "T-4 PairRequest snap ['85%'] (== prior maxHeight 85%)");
  assert.match(code(pairRequest), /snapPoints=\{PAIR_REQUEST_SNAP_POINTS\}/, "T-4 PairRequest passes its snap");
  assert.match(code(customHoliday), /CUSTOM_HOLIDAY_SNAP_POINTS\s*=\s*\[\s*['"]88%['"]\s*\]/, "T-4 CustomHoliday snap ['88%'] (== prior SCREEN_HEIGHT*0.88)");
  assert.match(code(propose), /PROPOSE_DATE_TIME_SNAP_POINTS\s*=\s*\[\s*['"]85%['"]\s*\]/, "T-4 Propose snap ['85%'] (== prior SCREEN_HEIGHT*0.85)");
  assert.match(code(ticketPdf), /TICKET_PDF_SNAP_POINTS\s*=\s*\[\s*['"]88%['"]\s*\]/, "T-4 TicketPdf snap ['88%'] (== prior maxHeight 88%)");
  assert.match(code(actionButtons), /DATE_TIME_PICKER_SNAP_POINTS\s*=\s*\[\s*['"]45%['"]\s*\]/, "T-4 ActionButtons picker snap ['45%']");
  // Fixed snaps only — no content-dynamic sizing (Batch-3 off-screen lesson).
  for (const [name, src] of SHEETS) {
    assert.doesNotMatch(code(src), /enableDynamicSizing/, `T-4 ${name} must use a fixed snap, NOT enableDynamicSizing (off-screen risk)`);
  }

  // ── T-5: keyboard-aware sheets swap to BottomSheetTextInput + interactive ──
  for (const [name, src] of [["PairRequestModal", pairRequest], ["CustomHolidayModal", customHoliday]]) {
    assert.match(
      src,
      /import\s+\{[^}]*\bBottomSheetTextInput\b[^}]*\}\s+from\s+['"][^'"]*ui\/BaseBottomSheet['"]/,
      `T-5 ${name} imports BottomSheetTextInput from the primitive`,
    );
    assert.match(code(src), /<BottomSheetTextInput\b/, `T-5 ${name} renders BottomSheetTextInput (keyboard-aware)`);
    assert.doesNotMatch(code(src), /<TextInput\b/, `T-5 ${name} must NOT keep a raw RN <TextInput> in the sheet`);
    assert.match(code(src), /keyboardBehavior=["']interactive["']/, `T-5 ${name} sets keyboardBehavior interactive`);
  }
  // The two confirm cards + read-only/picker sheets have no text input.
  assert.doesNotMatch(code(incoming), /BottomSheetTextInput/, "T-5 IncomingPairRequestCard has no text input");

  // ── T-6: sheets mounted over the tab bar z-stack via wrapInRNModal ─────────
  for (const [name, src] of SHEETS) {
    assert.match(code(src), /wrapInRNModal/, `T-6 ${name} z-stacks over the tab bar via wrapInRNModal`);
  }

  // ── T-7: ProposeDateTime keeps DateTimePicker; iOS OS pickers in own RN
  //        Modals; custom slide spring gone ────────────────────────────────
  assert.match(code(propose), /<DateTimePicker\b/, "T-7 Propose keeps the DateTimePicker");
  assert.match(code(propose), /<RNModal\b/, "T-7 Propose wraps the iOS OS pickers in their own RN Modal(s)");
  assert.match(code(propose), /stickyFooter=\{/, "T-7 Propose pins ProposeDateTimeFooter (stickyFooter)");
  assert.match(code(propose), /theme=["']dark["']/, "T-7 Propose preserves the dark surface");
  assert.match(code(propose), /backgroundStyle=\{PROPOSE_DATE_TIME_BACKGROUND_STYLE\}/, "T-7 Propose keeps its #1C1C1E canvas via backgroundStyle override");
  assert.doesNotMatch(code(propose), /Animated\.spring|Animated\.timing|slideAnim|backdropAnim/, "T-7 Propose custom slide/backdrop springs removed (stock gorhom motion)");

  // ── T-8: PairRequest keeps the excluded CountryPickerModal sub-modal ───────
  assert.match(code(pairRequest), /<CountryPickerModal\b/, "T-8 PairRequest keeps the CountryPickerModal sub-modal (excluded surface)");

  // ── T-9: ActionButtons — ONLY the iOS picker modal converted ───────────────
  // The Android native picker branch (display="default", no Modal) stays; the
  // iOS branch is now a BaseBottomSheet. Exactly ONE <BaseBottomSheet> usage.
  const abSheetCount = (code(actionButtons).match(/<BaseBottomSheet\b/g) || []).length;
  assert.equal(abSheetCount, 1, "T-9 ActionButtons converts ONLY the iOS date/time picker (exactly 1 <BaseBottomSheet>)");
  assert.match(code(actionButtons), /display="default"/, "T-9 ActionButtons keeps the Android native DateTimePicker branch");
  // The rest of ActionButtons is untouched — its primary save/schedule flow stays.
  assert.match(code(actionButtons), /handleDateTimePickerChange/, "T-9 ActionButtons keeps its picker change handler (rest of file intact)");
  assert.match(code(actionButtons), /pickerMode === "date" \? handleDatePickerConfirm : handleTimePickerConfirm/, "T-9 ActionButtons preserves the Next/Done confirm wiring");

  // ── T-A1 (adversarial): old RN scrim/overlay/hand-rolled shells are GONE ───
  assert.doesNotMatch(code(pairRequest), /overlay:\s*\{/, "T-A1 PairRequest old `overlay` scrim style removed");
  assert.doesNotMatch(code(pairRequest), /sheet:\s*\{/, "T-A1 PairRequest old `sheet` card style removed");
  assert.doesNotMatch(code(pairRequest), /handleContainer:\s*\{/, "T-A1 PairRequest cosmetic `handleContainer` removed (real gorhom handle)");
  assert.doesNotMatch(code(incoming), /overlay:\s*\{/, "T-A1 Incoming old `overlay` scrim style removed");
  assert.doesNotMatch(code(incoming), /backdrop:\s*\{/, "T-A1 Incoming old `backdrop` style removed");
  assert.doesNotMatch(code(pairingInfo), /overlay:\s*\{/, "T-A1 PairingInfo old `overlay` scrim style removed");
  assert.doesNotMatch(code(pairingInfo), /backdrop:\s*\{/, "T-A1 PairingInfo old `backdrop` style removed");
  assert.doesNotMatch(code(customHoliday), /sheetContent:\s*\{/, "T-A1 CustomHoliday old `sheetContent` card style removed");
  assert.doesNotMatch(code(customHoliday), /handleContainer:\s*\{/, "T-A1 CustomHoliday cosmetic `handleContainer` removed (real gorhom handle)");
  assert.doesNotMatch(code(propose), /bottomSheet:\s*\{/, "T-A1 Propose old `bottomSheet` absolute card style removed");
  assert.doesNotMatch(code(propose), /handleContainer:\s*\{/, "T-A1 Propose cosmetic `handleContainer` removed (real gorhom handle)");
  assert.doesNotMatch(code(ticketPdf), /dragHandle:\s*\{/, "T-A1 TicketPdf cosmetic `dragHandle` removed (real gorhom handle)");
  assert.doesNotMatch(code(actionButtons), /modalOverlay:\s*\{/, "T-A1 ActionButtons old `modalOverlay` scrim style removed");
  assert.doesNotMatch(code(actionButtons), /backdropTouch:\s*\{/, "T-A1 ActionButtons old `backdropTouch` style removed");
}

try {
  run();
  console.log(
    "PASS META-ORCH-0991 Wave B Batch-4 regression suite (PairRequest + Incoming + PairingInfo + CustomHoliday + ProposeDateTime + TicketPdf + ActionButtons-picker → BaseBottomSheet)",
  );
} catch (error) {
  console.error(error);
  process.exit(1);
}
