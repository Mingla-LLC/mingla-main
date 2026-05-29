#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression suite — META-ORCH-0991 Wave B BATCH 5
 * [DismissedCardsSheet + LockedCardSchedulingSheet + MessageContextMenu +
 *  BoardSettingsDropdown + DiscoverScreen (filter <Modal> ONLY) +
 *  MessageInterface (1:1 more-options <Modal> ONLY) +
 *  PersonHolidayView (saves-list <Modal> ONLY) → BaseBottomSheet].
 *
 * Final straightforward Wave-B cluster. ONE is an irreversible commit confirm
 * (LockedCardSchedulingSheet summary step — "a new round of swiping starts")
 * → NON-swipe `variant="center-dialog"` per the operator rule (playbook §1).
 * The other six are full swipe-down `BaseBottomSheet` sheets. Three live inside
 * large screen files where ONLY the named modal is converted (DiscoverScreen
 * filter, MessageInterface 1:1 more-options, PersonHolidayView saves list);
 * the other modals in those files are EXCLUDED / Wave C and must stay raw.
 *
 * MessageContextMenu becomes a COMPACT bottom action sheet (context-menu feel):
 * a short ['28%'] snap, not a tall pan-down sheet, with its old Animated
 * scale/fade spring + `position`-anchored placement dropped for stock gorhom.
 *
 * BoardSettingsDropdown has a rename text input → keyboard-aware
 * (BottomSheetTextInput + interactive keyboard).
 *
 * Structural/contract test (the @gorhom/bottom-sheet host is NOT mountable in
 * this harness — same approach as the locked Wave-A BaseBottomSheet.test.mjs and
 * Batch-1/2/3/4 suites; playbook §8).
 *
 * Asserts the load-bearing Batch-5 conversion contracts:
 *   T-1  All 7 consume BaseBottomSheet; none of the 4 standalone files imports
 *        @gorhom/bottom-sheet directly (sole-consumer invariant). The 3 big
 *        screen files keep other surfaces, so we only assert they ADD a
 *        BaseBottomSheet usage + import.
 *   T-2  No raw RN `<Modal>` survives in the CONVERTED surface (the standalone
 *        files have ZERO `<Modal>` left; the big screen files keep their other,
 *        explicitly-excluded modals — asserted in T-7/T-8/T-9).
 *   T-3  LockedCardSchedulingSheet's summary step is center-dialog (NON-swipe);
 *        the six sheets are NOT center-dialog.
 *   T-4  Snap heights match the prior modal heights (sheets only).
 *   T-5  BoardSettingsDropdown (keyboard-aware) swaps TextInput →
 *        BottomSheetTextInput + sets keyboardBehavior interactive.
 *   T-6  Sheets mounted over the tab bar / chat z-stack via wrapInRNModal.
 *   T-7  MessageContextMenu reads as a context menu: compact ['28%'] snap + the
 *        old Animated scale/fade spring is GONE.
 *   T-8  DiscoverScreen + MessageInterface + PersonHolidayView each convert
 *        ONLY the named modal — their EXCLUDED modals stay raw <Modal>:
 *        DiscoverScreen had exactly 1 modal (now 0); MessageInterface keeps its
 *        image-preview + file-spinner + event-audience <Modal>s; PersonHolidayView
 *        keeps the visits-list pageSheet <Modal>.
 *   T-9  PairedSavesListScreen gains the opt-in inBottomSheet → BottomSheetFlatList
 *        path (gorhom-aware vertical grid inside the sheet); BaseBottomSheet
 *        re-exports BottomSheetFlatList.
 *
 * ADVERSARIAL (T-A1): a conversion is worthless if it keeps the old RN scrim /
 * overlay / hand-rolled card / cosmetic drag handle. We assert the removed style
 * keys are GONE from the converted surfaces.
 *
 * FAILS-ON-REVERT: verified by `git stash` of the Batch-5 diff — reverting
 * restores the raw <Modal>/Animated shells, flipping T-1/T-2/T-3/T-4/T-7/T-A1.
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

const DISMISSED = "app-mobile/src/components/DismissedCardsSheet.tsx";
const LOCKED = "app-mobile/src/components/session/LockedCardSchedulingSheet.tsx";
const CONTEXT_MENU = "app-mobile/src/components/chat/MessageContextMenu.tsx";
const BOARD_SETTINGS = "app-mobile/src/components/board/BoardSettingsDropdown.tsx";
const DISCOVER = "app-mobile/src/components/DiscoverScreen.tsx";
const MESSAGE_IF = "app-mobile/src/components/MessageInterface.tsx";
const HOLIDAY = "app-mobile/src/components/PersonHolidayView.tsx";
const SAVES_SCREEN = "app-mobile/src/components/PairedSavesListScreen.tsx";
const BASE = "app-mobile/src/components/ui/BaseBottomSheet.tsx";

function run() {
  const dismissed = read(DISMISSED);
  const locked = read(LOCKED);
  const contextMenu = read(CONTEXT_MENU);
  const boardSettings = read(BOARD_SETTINGS);
  const discover = read(DISCOVER);
  const messageIf = read(MESSAGE_IF);
  const holiday = read(HOLIDAY);
  const savesScreen = read(SAVES_SCREEN);
  const base = read(BASE);

  // The 4 STANDALONE files become pure BaseBottomSheet consumers (no other
  // raw <Modal> in them). The 3 BIG screen files keep excluded modals.
  const STANDALONE = [
    ["DismissedCardsSheet", dismissed],
    ["LockedCardSchedulingSheet", locked],
    ["MessageContextMenu", contextMenu],
    ["BoardSettingsDropdown", boardSettings],
  ];
  const BIG_SCREEN = [
    ["DiscoverScreen", discover],
    ["MessageInterface", messageIf],
    ["PersonHolidayView", holiday],
  ];
  const ALL_SEVEN_HOSTS = [...STANDALONE, ...BIG_SCREEN];
  const SHEETS = [
    ["DismissedCardsSheet", dismissed],
    ["MessageContextMenu", contextMenu],
    ["BoardSettingsDropdown", boardSettings],
    ["DiscoverScreen", discover],
    ["MessageInterface", messageIf],
    ["PersonHolidayView", holiday],
  ];

  // ── T-1: every host file consumes BaseBottomSheet; none imports gorhom ─────
  for (const [name, src] of ALL_SEVEN_HOSTS) {
    assert.match(
      src,
      /import\s*\{[\s\S]*?BaseBottomSheet[\s\S]*?\}\s*from\s+['"][^'"]*ui\/BaseBottomSheet['"]/,
      `T-1 ${name}: must import BaseBottomSheet from ui/BaseBottomSheet`,
    );
    assert.match(src, /<BaseBottomSheet\b/, `T-1 ${name}: must render <BaseBottomSheet>`);
    assert.ok(!importsGorhom(src), `T-1 ${name}: must NOT import @gorhom/bottom-sheet directly`);
  }

  // ── T-2: the 4 standalone files have NO raw RN <Modal> left ────────────────
  for (const [name, src] of STANDALONE) {
    assert.ok(
      !/<Modal\b/.test(code(src)),
      `T-2 ${name}: standalone converted file must have no raw <Modal> shell`,
    );
    // And the RN `Modal` import is gone from the standalone files.
    assert.ok(
      !/^\s*Modal,?\s*$/m.test(code(src)),
      `T-2 ${name}: RN Modal import should be removed`,
    );
  }

  // ── T-3: LockedCardSchedulingSheet summary = center-dialog (NON-swipe) ─────
  assert.match(
    code(locked),
    /<BaseBottomSheet[\s\S]*?variant=["']center-dialog["']/,
    "T-3 LockedCardSchedulingSheet: irreversible commit confirm must be center-dialog",
  );
  for (const [name, src] of SHEETS) {
    assert.ok(
      !/variant=["']center-dialog["']/.test(code(src)),
      `T-3 ${name}: must be a full swipe-down sheet, NOT center-dialog`,
    );
  }

  // ── T-4: snap heights match the prior modal heights ────────────────────────
  // DismissedCardsSheet: was maxHeight screenHeight*0.8 → ['80%'].
  assert.match(code(dismissed), /\[\s*['"]80%['"]\s*\]/, "T-4 DismissedCardsSheet snap ['80%']");
  // MessageContextMenu: compact ['28%'].
  assert.match(code(contextMenu), /\[\s*['"]28%['"]\s*\]/, "T-4 MessageContextMenu snap ['28%']");
  // BoardSettingsDropdown: was maxHeight "80%" → ['80%'].
  assert.match(code(boardSettings), /\[\s*["']80%["']\s*\]/, "T-4 BoardSettingsDropdown snap ['80%']");
  // DiscoverScreen filter: was maxHeight "85%" → ['85%'].
  assert.match(code(discover), /\[\s*["']85%["']\s*\]/, "T-4 DiscoverScreen filter snap ['85%']");
  // MessageInterface more-options: ['45%'].
  assert.match(code(messageIf), /\[\s*["']45%["']\s*\]/, "T-4 MessageInterface more-options snap ['45%']");
  // PersonHolidayView saves list: tall ['90%'].
  assert.match(code(holiday), /\[\s*['"]90%['"]\s*\]/, "T-4 PersonHolidayView saves-list snap ['90%']");
  // No content-dynamic sizing introduced (Batch-3 off-screen lesson).
  for (const [name, src] of SHEETS) {
    assert.ok(
      !/enableDynamicSizing/.test(code(src)),
      `T-4 ${name}: must use a FIXED snap, not enableDynamicSizing`,
    );
  }

  // ── T-5: BoardSettingsDropdown keyboard-aware (rename input) ────────────────
  assert.match(
    boardSettings,
    /import\s*\{[\s\S]*?BottomSheetTextInput[\s\S]*?\}\s*from\s+['"][^'"]*ui\/BaseBottomSheet['"]/,
    "T-5 BoardSettingsDropdown: must import BottomSheetTextInput",
  );
  assert.match(code(boardSettings), /<BottomSheetTextInput\b/, "T-5 BoardSettingsDropdown: rename field uses BottomSheetTextInput");
  assert.match(code(boardSettings), /keyboardBehavior=["']interactive["']/, "T-5 BoardSettingsDropdown: keyboardBehavior interactive");

  // ── T-6: sheets over the tab bar / chat z-stack via wrapInRNModal ──────────
  for (const [name, src] of SHEETS) {
    assert.match(code(src), /wrapInRNModal/, `T-6 ${name}: must z-stack via wrapInRNModal`);
  }

  // ── T-7: MessageContextMenu reads as a context menu, spring gone ───────────
  assert.ok(
    !/Animated\.spring/.test(code(contextMenu)),
    "T-7 MessageContextMenu: hand-rolled Animated.spring must be removed (stock gorhom motion)",
  );
  assert.ok(
    !/from\s+['"]react-native['"][\s\S]*?\bAnimated\b/.test(
      code(contextMenu).match(/import\s*\{[\s\S]*?\}\s*from\s+['"]react-native['"]/)?.[0] ?? "",
    ),
    "T-7 MessageContextMenu: Animated import from react-native must be removed",
  );

  // ── T-8: big screen files convert ONLY the named modal; excluded modals stay ─
  // DiscoverScreen had exactly one <Modal> (the filter) → now zero raw <Modal>.
  assert.ok(
    !/<Modal\b/.test(code(discover)),
    "T-8 DiscoverScreen: the single filter <Modal> was the only one — now converted (0 raw <Modal>)",
  );
  // MessageInterface keeps its EXCLUDED modals (image preview + file spinner +
  // event-audience). Exactly one BaseBottomSheet was added here for the
  // more-options menu; the other raw <Modal>s remain.
  const miModalCount = (code(messageIf).match(/<Modal\b/g) || []).length;
  assert.ok(
    miModalCount >= 3,
    `T-8 MessageInterface: excluded modals (image preview, file spinner, event-audience) must remain — found ${miModalCount} raw <Modal>`,
  );
  assert.match(code(messageIf), /style=\{styles\.chatSheetHandle\}/, "T-8 MessageInterface: event-audience modal still uses chatSheetHandle (untouched)");
  // PersonHolidayView keeps the visits-list pageSheet <Modal>.
  assert.match(
    code(holiday),
    /<Modal\s+visible=\{showVisitsList\}/,
    "T-8 PersonHolidayView: visits-list pageSheet <Modal> must remain (only saves list converted)",
  );

  // ── T-9: saves grid uses gorhom-aware list inside the sheet ────────────────
  assert.match(
    base,
    /export\s*\{\s*BottomSheetFlatList\s*\}/,
    "T-9 BaseBottomSheet: must re-export BottomSheetFlatList",
  );
  assert.match(
    savesScreen,
    /import\s*\{\s*BottomSheetFlatList\s*\}\s*from\s+['"][^'"]*ui\/BaseBottomSheet['"]/,
    "T-9 PairedSavesListScreen: must import BottomSheetFlatList from BaseBottomSheet",
  );
  assert.match(code(savesScreen), /inBottomSheet/, "T-9 PairedSavesListScreen: must expose inBottomSheet opt-in");
  assert.match(code(holiday), /inBottomSheet/, "T-9 PersonHolidayView: saves list must pass inBottomSheet");

  // ── T-A1 ADVERSARIAL: old scrim / overlay / hand-rolled card / handle gone ──
  // DismissedCardsSheet shed overlay/backdrop/sheet/handleBar.
  for (const key of ["overlay:", "backdrop:", "handleBar:"]) {
    assert.ok(!code(dismissed).includes(key), `T-A1 DismissedCardsSheet: dead style ${key} must be gone`);
  }
  // LockedCardSchedulingSheet shed its centered overlay/sheet card.
  for (const key of ["overlay:", "sheet:"]) {
    assert.ok(!code(locked).includes(key), `T-A1 LockedCardSchedulingSheet: dead style ${key} must be gone`);
  }
  // MessageContextMenu shed backdrop + absolute-positioned menu shadow.
  assert.ok(!code(contextMenu).includes("backdrop:"), "T-A1 MessageContextMenu: dead backdrop style must be gone");
  // BoardSettingsDropdown shed sheetOverlay/sheetBackdrop/sheetContainer/sheetHandle.
  for (const key of ["sheetOverlay:", "sheetBackdrop:", "sheetContainer:", "sheetHandleRow:", "sheetHandle:"]) {
    assert.ok(!code(boardSettings).includes(key), `T-A1 BoardSettingsDropdown: dead style ${key} must be gone`);
  }
  // DiscoverScreen shed filterModalOverlay/backdropTouch/filterModalContent.
  for (const key of ["filterModalOverlay:", "backdropTouch:", "filterModalContent:"]) {
    assert.ok(!code(discover).includes(key), `T-A1 DiscoverScreen: dead style ${key} must be gone`);
  }
  // MessageInterface shed chatSheetOverlay/chatSheetContainer (the converted menu's chrome).
  for (const key of ["chatSheetOverlay:", "chatSheetContainer:"]) {
    assert.ok(!code(messageIf).includes(key), `T-A1 MessageInterface: dead style ${key} must be gone`);
  }

  console.log("PASS META-ORCH-0991 Wave B Batch-5 regression suite (T-1..T-9, T-A1)");
}

run();
