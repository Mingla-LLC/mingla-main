#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression suite — META-ORCH-0991 Wave B BATCH 3
 * [ShareModal + AddToBoardModal + BoardMemberManagementModal +
 *  FriendActionsSheet + FriendsActionChooserSheet + PendingCollabChatSheet
 *  → BaseBottomSheet].
 *
 * Share / board / friend-action cluster. NONE is a pure destructive-confirm
 * dialog (their confirms are inline content or RN Alert), so all six are full
 * swipe-down `BaseBottomSheet` sheets (NOT center-dialog). All six mount from
 * in-tree screens that sit over the custom tab bar / chat (ConnectionsPage,
 * app/index.tsx, ExpandedCardModal, SessionViewModal, BoardDiscussion,
 * ViewFriendProfileScreen) and were previously RN <Modal> separate-window
 * overlays, so all six z-stack via `wrapInRNModal` — which also restores the
 * `accessibilityViewIsModal` focus-trap the chooser + pending sheets relied on
 * (investigation §5 a11y note).
 *
 * Structural/contract test (the @gorhom/bottom-sheet host is NOT mountable in
 * this harness — same approach as the locked Wave-A BaseBottomSheet.test.mjs
 * and Batch-1/Batch-2 suites; playbook §8).
 *
 * Asserts the load-bearing Batch-3 conversion contracts:
 *   T-1  All 6 consume BaseBottomSheet and NONE imports @gorhom/bottom-sheet
 *        directly (sole-consumer invariant — primary fails-on-revert anchor:
 *        reverting any conversion re-adds a raw RN <Modal> shell and drops the
 *        <BaseBottomSheet> usage).
 *   T-2  No raw RN `<Modal>` shell + no `Modal` import survives in any of the 6.
 *   T-3  All 6 z-stack via wrapInRNModal (over the tab bar / chat; restores the
 *        modal focus-trap).
 *   T-4  ShareModal converts BOTH <Modal> roots (the no-data guard + the main
 *        share card) — exactly two <BaseBottomSheet> usages, both at ['90%'].
 *   T-5  AddToBoardModal — list picker at ['80%'] with a sticky footer.
 *   T-6  BoardMemberManagementModal — member list at ['80%'] (inline destructive
 *        confirms stay as body content, not a separate center-dialog).
 *   T-7  FriendActionsSheet — content-height action menu (enableDynamicSizing),
 *        and it still renders its three sub-modals (AddToBoard/Block/Report).
 *   T-8  FriendsActionChooserSheet — content-height chooser (enableDynamicSizing).
 *   T-9  PendingCollabChatSheet — dark sheet at ['88%'] with an explicit dark
 *        backgroundStyle override; inner people list is a BottomSheetScrollView
 *        (NOT a raw RN <ScrollView>, which would fight the sheet pan gesture).
 *   T-10 None of the 6 is a center-dialog (none is a pure destructive confirm).
 *
 * ADVERSARIAL (T-A1): a conversion is worthless if it keeps the old RN scrim /
 * overlay or the hand-rolled fixed-position card. We assert the removed style
 * keys are GONE: `overlay`/`modalOverlay`/`backdropTouch`/`modalContainer`
 * (Share/AddToBoard/BoardMember/FriendActions), `backdrop`/`handle` (chooser +
 * pending). Catches a "wrapped the new sheet inside the old overlay View"
 * half-migration that would double the chrome and break pan-down, and proves the
 * hand-rolled cosmetic drag handles were replaced by the real gorhom one.
 *
 * FAILS-ON-REVERT: verified by `git stash` of the Batch-3 diff — reverting
 * restores the raw <Modal> shells, flipping T-1/T-2/.../T-10 + T-A1. Anchor
 * commit recorded in the implementation report.
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

const SHARE = "app-mobile/src/components/ShareModal.tsx";
const ADD_BOARD = "app-mobile/src/components/AddToBoardModal.tsx";
const BOARD_MEMBER = "app-mobile/src/components/BoardMemberManagementModal.tsx";
const FRIEND_ACTIONS = "app-mobile/src/components/friends/FriendActionsSheet.tsx";
const CHOOSER = "app-mobile/src/components/connections/FriendsActionChooserSheet.tsx";
const PENDING = "app-mobile/src/components/connections/PendingCollabChatSheet.tsx";

function run() {
  const share = read(SHARE);
  const addBoard = read(ADD_BOARD);
  const boardMember = read(BOARD_MEMBER);
  const friendActions = read(FRIEND_ACTIONS);
  const chooser = read(CHOOSER);
  const pending = read(PENDING);

  const ALL = [
    ["ShareModal", share],
    ["AddToBoardModal", addBoard],
    ["BoardMemberManagementModal", boardMember],
    ["FriendActionsSheet", friendActions],
    ["FriendsActionChooserSheet", chooser],
    ["PendingCollabChatSheet", pending],
  ];

  // ── T-1: all 6 consume BaseBottomSheet, none imports gorhom directly ───────
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

  // ── T-2: no raw RN <Modal> shell survives + no Modal import ────────────────
  for (const [name, src] of ALL) {
    assert.doesNotMatch(code(src), /<Modal\b/, `T-2 ${name} must not retain a raw RN <Modal> shell`);
    assert.doesNotMatch(
      code(src),
      /import\s+(?:RNModal[\s\S]*?|\{[^}]*\bModal\b[^}]*\})\s+from\s+["']react-native["']/,
      `T-2 ${name} must not import Modal from react-native`,
    );
  }

  // ── T-3: all 6 z-stack over the tab bar / chat (restores focus-trap) ───────
  for (const [name, src] of ALL) {
    assert.match(code(src), /wrapInRNModal/, `T-3 ${name} z-stacks via wrapInRNModal`);
  }

  // ── T-4: ShareModal converts BOTH <Modal> roots → exactly 2 BaseBottomSheet ─
  const shareSheetCount = (code(share).match(/<BaseBottomSheet\b/g) || []).length;
  assert.equal(shareSheetCount, 2, "T-4 ShareModal converts BOTH Modal roots (2 <BaseBottomSheet>)");
  assert.match(
    code(share),
    /SHARE_SHEET_SNAP_POINTS\s*=\s*\[\s*['"]90%['"]\s*\]/,
    "T-4 ShareModal snap is ['90%'] (preserves prior maxHeight 90%)",
  );

  // ── T-5: AddToBoardModal — list picker at ['80%'] with a sticky footer ─────
  assert.match(code(addBoard), /snapPoints=\{ADD_TO_BOARD_SNAP_POINTS\}/, "T-5 AddToBoard passes its snap");
  assert.match(
    code(addBoard),
    /ADD_TO_BOARD_SNAP_POINTS\s*=\s*\[\s*['"]80%['"]\s*\]/,
    "T-5 AddToBoard snap is ['80%'] (preserves prior maxHeight 80%)",
  );
  assert.match(code(addBoard), /stickyFooter=\{/, "T-5 AddToBoard pins its Cancel/Add footer (stickyFooter)");

  // ── T-6: BoardMemberManagementModal — member list at ['80%'] ───────────────
  assert.match(code(boardMember), /snapPoints=\{BOARD_MEMBER_SNAP_POINTS\}/, "T-6 BoardMember passes its snap");
  assert.match(
    code(boardMember),
    /BOARD_MEMBER_SNAP_POINTS\s*=\s*\[\s*['"]80%['"]\s*\]/,
    "T-6 BoardMember snap is ['80%'] (preserves prior maxHeight 80%)",
  );
  assert.match(code(boardMember), /stickyFooter=\{/, "T-6 BoardMember pins its actions footer (inline confirms stay in body)");

  // ── T-7: FriendActionsSheet — fixed-snap menu + keeps its sub-modals ───────
  // A fixed snap (NOT enableDynamicSizing) is required: content-height sheets
  // inside the RN-Modal wrap snap off-screen-bottom (sim-observed). ['55%'].
  assert.match(code(friendActions), /snapPoints=\{FRIEND_ACTIONS_SNAP_POINTS\}/, "T-7 FriendActions passes its snap");
  assert.match(
    code(friendActions),
    /FRIEND_ACTIONS_SNAP_POINTS\s*=\s*\[\s*['"]55%['"]\s*\]/,
    "T-7 FriendActions snap is ['55%'] (fixed, fits max rows; NOT off-screen content-height)",
  );
  assert.doesNotMatch(code(friendActions), /enableDynamicSizing/, "T-7 FriendActions must NOT use enableDynamicSizing (off-screen in RN-Modal wrap)");
  assert.match(code(friendActions), /<AddToBoardModal\b/, "T-7 FriendActions still renders AddToBoardModal");
  assert.match(code(friendActions), /<BlockUserModal\b/, "T-7 FriendActions still renders BlockUserModal");
  assert.match(code(friendActions), /<ReportUserModal\b/, "T-7 FriendActions still renders ReportUserModal");

  // ── T-8: FriendsActionChooserSheet — fixed-snap chooser ────────────────────
  assert.match(code(chooser), /snapPoints=\{FRIENDS_ACTION_CHOOSER_SNAP_POINTS\}/, "T-8 Chooser passes its snap");
  assert.match(
    code(chooser),
    /FRIENDS_ACTION_CHOOSER_SNAP_POINTS\s*=\s*\[\s*['"]40%['"]\s*\]/,
    "T-8 Chooser snap is ['40%'] (== prior maxHeight 40%; fixed, NOT off-screen content-height)",
  );
  assert.doesNotMatch(code(chooser), /enableDynamicSizing/, "T-8 Chooser must NOT use enableDynamicSizing (off-screen in RN-Modal wrap)");

  // ── T-9: PendingCollabChatSheet — dark, ['88%'], dark bg, gorhom inner list ─
  assert.match(code(pending), /theme=["']dark["']/, "T-9 Pending is the dark surface");
  assert.match(code(pending), /snapPoints=\{PENDING_COLLAB_SNAP_POINTS\}/, "T-9 Pending passes its snap");
  assert.match(
    code(pending),
    /PENDING_COLLAB_SNAP_POINTS\s*=\s*\[\s*['"]88%['"]\s*\]/,
    "T-9 Pending snap is ['88%'] (preserves prior maxHeight 88%)",
  );
  assert.match(code(pending), /backgroundStyle=\{SHEET_BACKGROUND_STYLE\}/, "T-9 Pending keeps its dark canvas via backgroundStyle override");
  assert.match(code(pending), /<BottomSheetScrollView\b/, "T-9 Pending inner people list uses BottomSheetScrollView");
  assert.doesNotMatch(
    code(pending),
    /<ScrollView\b/,
    "T-9 Pending must NOT keep a raw RN <ScrollView> inside the sheet (fights the pan gesture)",
  );

  // ── T-10: none of the 6 is a center-dialog (none is a pure destructive confirm) ─
  for (const [name, src] of ALL) {
    assert.doesNotMatch(
      code(src),
      /variant=["']center-dialog["']/,
      `T-10 ${name} is a sheet/list/menu, NOT a pure destructive confirm → must be a swipe-down sheet`,
    );
  }

  // ── T-A1 (adversarial): old RN scrim/overlay/hand-rolled shells are GONE ───
  assert.doesNotMatch(code(share), /overlay:\s*\{/, "T-A1 ShareModal old `overlay` scrim style removed");
  assert.doesNotMatch(code(share), /modalContainer:\s*\{/, "T-A1 ShareModal old `modalContainer` card style removed");
  assert.doesNotMatch(code(share), /backdropTouch:\s*\{/, "T-A1 ShareModal old `backdropTouch` style removed");
  assert.doesNotMatch(code(addBoard), /modalOverlay:\s*\{/, "T-A1 AddToBoard old `modalOverlay` scrim style removed");
  assert.doesNotMatch(code(addBoard), /modalContainer:\s*\{/, "T-A1 AddToBoard old `modalContainer` card style removed");
  assert.doesNotMatch(code(boardMember), /modalOverlay:\s*\{/, "T-A1 BoardMember old `modalOverlay` scrim style removed");
  assert.doesNotMatch(code(boardMember), /modalContainer:\s*\{/, "T-A1 BoardMember old `modalContainer` card style removed");
  assert.doesNotMatch(code(friendActions), /overlay:\s*\{/, "T-A1 FriendActions old `overlay` scrim style removed");
  assert.doesNotMatch(code(friendActions), /handle:\s*\{/, "T-A1 FriendActions cosmetic `handle` removed (replaced by gorhom handle)");
  assert.doesNotMatch(code(chooser), /backdrop:\s*\{/, "T-A1 Chooser old `backdrop` scrim style removed");
  assert.doesNotMatch(code(chooser), /handle:\s*\{/, "T-A1 Chooser cosmetic `handle` removed (replaced by gorhom handle)");
  assert.doesNotMatch(code(pending), /backdrop:\s*\{/, "T-A1 Pending old `backdrop` scrim style removed");
  assert.doesNotMatch(code(pending), /handle:\s*\{/, "T-A1 Pending cosmetic `handle` removed (replaced by gorhom handle)");
}

try {
  run();
  console.log(
    "PASS META-ORCH-0991 Wave B Batch-3 regression suite (Share + AddToBoard + BoardMember + FriendActions + Chooser + PendingCollab → BaseBottomSheet)",
  );
} catch (error) {
  console.error(error);
  process.exit(1);
}
