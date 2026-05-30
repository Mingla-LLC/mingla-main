#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression suite — META-ORCH-0991 Wave C BATCH 3 (FINAL in-scope batch)
 * [4 consumer modals → BaseBottomSheet].
 *
 * The last 4 in-scope conversions:
 *   1. CardDiscussionModal  — collab board card chat. Was a pageSheet RN <Modal> +
 *      KeyboardAwareView (header + scrolling messages + pinned composer). → light
 *      BaseBottomSheet, fixed ['92%'] snap (near-full-screen chat), wrapInRNModal
 *      (mounted inside SessionViewModal's RN Modal, over the deck — sibling of the
 *      already-wrapInRNModal ExpandedCardModal). Header slot + scrollMode="view"
 *      (own BottomSheetScrollView message thread) + stickyFooter composer whose
 *      <TextInput> is now <BottomSheetTextInput> (keyboard never covers it).
 *   2. FeedbackHistorySheet — feedback list + a NESTED fullscreen screenshot
 *      viewer. Root: light BaseBottomSheet, fixed ['75%'] snap (was maxHeight 75%),
 *      scrollMode="flatlist" (the feedback FlatList), wrapInRNModal (ProfilePage
 *      z-trap). The fullscreen screenshot viewer stays an RN <Modal> but is
 *      §13-GATED: the root is `visible={visible && !screenshotOpen}` + wrapped
 *      handleRootClose, so the two RN-Modal-backed surfaces never co-present on iOS.
 *   3. MessageInterface event-audience picker (~line 2176, ONLY that modal) — was a
 *      dark flex-end RN <Modal> (scrim + card + hand-rolled handle + .map roster).
 *      → dark BaseBottomSheet, fixed ['70%'] snap, scrollMode="scroll", wrapInRNModal
 *      (chat). The file's OTHER modals (image preview + file spinner — EXCLUDED) and
 *      the Batch-5 more-options sheet stay as-is → exactly TWO <BaseBottomSheet>.
 *   4. ConnectionsPage friends modal (~line 3556, ONLY that modal) — 4-tab modal
 *      that used a hand-rolled useKeyboard sheet-height/marginBottom hack. → light
 *      BaseBottomSheet, fixed ['88%'] snap (was screenHeight*0.88), scrollMode="scroll",
 *      wrapInRNModal (under the floating GlassBottomNav — Batch-2 z-trap), keyboard-
 *      aware. The useKeyboard sheet-height math + the RN <Modal> are gone. Its child
 *      surfaces (friend picker, action chooser, create-group, pair request, friend
 *      actions, report/block/add-to-board/paywall/incoming-pair/pending-collab) are
 *      all RN-Modal-backed; the friends sheet is §13-GATED on
 *      `visible={showFriendsModal && !anyFriendsChildOpen}` + handleFriendsModalClose
 *      so two RN-Modal-backed surfaces never co-present on iOS. AddFriendView (the
 *      friends-list tab's only TextInput owner, used ONLY in this modal) swaps its
 *      <TextInput> → <BottomSheetTextInput> and its CountryPickerModal (a fullScreen
 *      RN <Modal>) stays CountryPickerModal — the same proven Batch-4 PairRequestModal
 *      pattern where a fullScreen RN <Modal> sub-picker, opened by a user tap, stacks
 *      above the wrapInRNModal sheet and virtualizes its country list in its own window
 *      (a CountryPickerOverlay nested in the sheet's scroll body trips the
 *      "VirtualizedLists nested in a ScrollView" warning — rejected, sim-confirmed).
 *
 * Structural/contract test (the @gorhom/bottom-sheet host is NOT mountable in this
 * harness — same approach as the locked Wave-A/Batch-1..5/Wave-C-1/Wave-C-2 suites;
 * playbook §8). Stock gorhom motion (the primitive passes no animationConfigs).
 *
 * FAILS-ON-REVERT: verified by `git stash` of this batch's diff — reverting restores
 * the raw <Modal> shells + KeyboardAwareView + the event-audience scrim/card +
 * the friends useKeyboard sheet-height hack + AddFriendView's raw TextInput +
 * CountryPickerModal, flipping the assertions below. Anchor commit in the report.
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

const CARD_DISCUSSION = "app-mobile/src/components/board/CardDiscussionModal.tsx";
const FEEDBACK_HISTORY = "app-mobile/src/components/FeedbackHistorySheet.tsx";
const MESSAGE_INTERFACE = "app-mobile/src/components/MessageInterface.tsx";
const CONNECTIONS_PAGE = "app-mobile/src/components/ConnectionsPage.tsx";
const ADD_FRIEND_VIEW = "app-mobile/src/components/connections/AddFriendView.tsx";

function importsBaseBottomSheet(src) {
  return /import\s*\{[\s\S]*?BaseBottomSheet[\s\S]*?\}\s*from\s+['"][^'"]*ui\/BaseBottomSheet['"]/.test(
    src,
  );
}

function run() {
  // ════════════════════════════════════════════════════════════════════════
  // 1. CardDiscussionModal
  // ════════════════════════════════════════════════════════════════════════
  {
    const src = read(CARD_DISCUSSION);
    const c = code(src);

    assert.ok(importsBaseBottomSheet(src), "CD-1: must import BaseBottomSheet from ui/BaseBottomSheet");
    assert.ok(!importsGorhom(src), "CD-1: must NOT import @gorhom/bottom-sheet directly");
    assert.match(c, /<BaseBottomSheet\b/, "CD-1: must render <BaseBottomSheet>");

    assert.ok(!/<Modal\b/.test(c), "CD-2: no raw RN <Modal> shell may survive");
    assert.ok(!/^\s*Modal,?\s*$/m.test(c), "CD-2: RN Modal import must be removed");
    assert.ok(!/KeyboardAwareView/.test(c), "CD-2: KeyboardAwareView (gorhom owns keyboard now) must be removed");

    assert.ok(c.includes('"92%"') || c.includes("'92%'"), "CD-3: fixed ['92%'] snap (near-full-screen chat) must be present");
    assert.ok(!/enableDynamicSizing/.test(c), "CD-3: must use a FIXED snap, not enableDynamicSizing");

    assert.match(c, /wrapInRNModal/, "CD-4: must wrapInRNModal (mounted in SessionViewModal over the deck)");
    // Composer must be keyboard-aware: BottomSheetTextInput + interactive behavior.
    assert.match(c, /<BottomSheetTextInput\b/, "CD-5: composer <TextInput> must become <BottomSheetTextInput>");
    assert.match(c, /keyboardBehavior=["']interactive["']/, "CD-5: keyboardBehavior must be interactive");
    assert.match(c, /stickyFooter=/, "CD-5: composer must be pinned via stickyFooter");
    // The message thread rides BottomSheetScrollView, not a raw RN <ScrollView>.
    assert.match(c, /<BottomSheetScrollView\b/, "CD-6: message thread must use BottomSheetScrollView");
    assert.ok(!/<ScrollView\b/.test(c), "CD-6: no raw RN <ScrollView> may survive in the body");
    // ADVERSARIAL: the old full-screen container style must be gone.
    assert.ok(!/\bcontainer:\s*\{/.test(c) || /sheetBackground:/.test(c), "CD-A1: sheet canvas now comes from backgroundStyle (sheetBackground), not the old full-screen container");
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2. FeedbackHistorySheet (list + §13-gated nested fullscreen viewer)
  // ════════════════════════════════════════════════════════════════════════
  {
    const src = read(FEEDBACK_HISTORY);
    const c = code(src);

    assert.ok(importsBaseBottomSheet(src), "FH-1: must import BaseBottomSheet");
    assert.ok(!importsGorhom(src), "FH-1: must NOT import @gorhom/bottom-sheet directly");
    assert.equal((c.match(/<BaseBottomSheet\b/g) || []).length, 1, "FH-1: exactly ONE <BaseBottomSheet> (the root list)");

    // The root list <Modal> is gone; the nested fullscreen viewer is the ONLY RN <Modal> left.
    assert.equal((c.match(/<Modal\b/g) || []).length, 1, "FH-2: exactly ONE RN <Modal> remains (the §13-gated fullscreen screenshot viewer)");

    assert.ok(c.includes('"75%"') || c.includes("'75%'"), "FH-3: fixed ['75%'] snap (was maxHeight 75%) must be present");
    assert.match(c, /scrollMode=\{?\s*loadingOrError\s*\?\s*['"]view['"]\s*:\s*['"]flatlist['"]/, "FH-3: feedback list must use flatlist body (with loading/error → view)");
    assert.match(c, /wrapInRNModal/, "FH-4: must wrapInRNModal (ProfilePage z-trap)");

    // §13 ONE-SHEET-AT-A-TIME GATE on the nested fullscreen viewer.
    assert.match(c, /const\s+screenshotOpen\s*=/, "FH-5: must derive screenshotOpen from the viewer state");
    assert.match(c, /visible=\{\s*visible\s*&&\s*!screenshotOpen\s*\}/, "FH-5: root sheet visible must be GATED on `visible && !screenshotOpen` (no co-present)");
    assert.match(c, /const\s+handleRootClose\s*=/, "FH-5: must wrap the root onClose (handleRootClose) so suppress-for-child does not tear down the sheet");
    assert.match(c, /onClose=\{handleRootClose\}/, "FH-5: root sheet must use onClose={handleRootClose}");

    // ADVERSARIAL: the old hand-rolled scrim/sheet/handle styles must be gone.
    for (const key of ["backdrop:", "sheet:", "handle:"]) {
      assert.ok(!c.includes(key), `FH-A1: dead style key \`${key}\` must be removed (chrome from BaseBottomSheet now)`);
    }
    // ADVERSARIAL: the gate must not regress to an ungated root.
    assert.ok(!/visible=\{visible\}/.test(c), "FH-A2: root must NOT use ungated visible={visible} — reintroduces the co-present crash");
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. MessageInterface event-audience picker (ONLY that modal)
  // ════════════════════════════════════════════════════════════════════════
  {
    const src = read(MESSAGE_INTERFACE);
    const c = code(src);

    assert.ok(importsBaseBottomSheet(src), "MI-1: must import BaseBottomSheet");
    assert.ok(!importsGorhom(src), "MI-1: must NOT import @gorhom/bottom-sheet directly");
    // Exactly TWO sheets: the Batch-5 more-options sheet + the new event-audience sheet.
    assert.equal((c.match(/<BaseBottomSheet\b/g) || []).length, 2, "MI-2: exactly TWO <BaseBottomSheet> (more-options + event-audience); the other modals stay untouched");

    // The event-audience picker's old scrim/card/handle are gone.
    assert.ok(!/eventAudienceOverlay/.test(c), "MI-3: dead eventAudienceOverlay (old scrim) must be removed");
    assert.ok(!/styles\.eventAudienceSheet\b/.test(c), "MI-3: dead eventAudienceSheet (old flex-end card) must be removed");
    assert.ok(!/chatSheetHandle/.test(c), "MI-3: dead hand-rolled chatSheetHandle must be removed (gorhom handle owns it)");
    // The new dark canvas + fixed snap.
    assert.ok(c.includes('"70%"') || c.includes("'70%'"), "MI-4: event-audience fixed ['70%'] snap must be present");
    assert.match(c, /EVENT_AUDIENCE_SNAP/, "MI-4: event-audience snap const must exist");
    assert.match(c, /eventAudienceSheetBackground/, "MI-4: bespoke dark canvas must come from backgroundStyle (eventAudienceSheetBackground)");

    // The EXCLUDED modals must still be RN <Modal> (image preview + file spinner).
    assert.ok((c.match(/<Modal\b/g) || []).length >= 2, "MI-5: the EXCLUDED image-preview + file-spinner RN <Modal>s must remain untouched");
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4. ConnectionsPage friends modal (ONLY that modal) + AddFriendView
  // ════════════════════════════════════════════════════════════════════════
  {
    const src = read(CONNECTIONS_PAGE);
    const c = code(src);

    assert.ok(importsBaseBottomSheet(src), "CP-1: must import BaseBottomSheet");
    assert.ok(!importsGorhom(src), "CP-1: must NOT import @gorhom/bottom-sheet directly");
    assert.equal((c.match(/<BaseBottomSheet\b/g) || []).length, 1, "CP-1: exactly ONE <BaseBottomSheet> (the friends modal)");

    // The friends modal RN <Modal> shell + RN Modal import are gone.
    assert.ok(!/<Modal\b/.test(c), "CP-2: friends-modal RN <Modal> shell must be gone (file has no remaining <Modal> JSX)");
    assert.ok(!/^\s*Modal,?\s*$/m.test(c), "CP-2: RN Modal import must be removed");

    // Fixed snap + keyboard-aware + z-stack.
    assert.ok(c.includes('"88%"') || c.includes("'88%'"), "CP-3: fixed ['88%'] snap (was screenHeight*0.88) must be present");
    assert.match(c, /FRIENDS_MODAL_SNAP/, "CP-3: friends snap const must exist");
    assert.match(c, /keyboardBehavior=["']interactive["']/, "CP-3: keyboard-aware (interactive) for the friends search");
    assert.match(c, /wrapInRNModal/, "CP-4: must wrapInRNModal (under the floating GlassBottomNav — Batch-2 z-trap)");

    // The hand-rolled useKeyboard sheet-height hack is gone.
    assert.ok(!/const\s+sheetHeight\s*=/.test(c), "CP-5: hand-rolled sheetHeight math must be removed (gorhom owns keyboard)");
    assert.ok(!/styles\.sheetContainer\b/.test(c) && !/sheetContainer:/.test(c), "CP-5: dead sheetContainer style must be removed");
    assert.ok(!/sheetOverlay:/.test(c), "CP-5: dead sheetOverlay (old scrim) must be removed");
    assert.ok(!/sheetHandle:/.test(c), "CP-5: dead hand-rolled sheetHandle must be removed");

    // §13 ONE-SHEET-AT-A-TIME GATE — friends modal vs its RN-Modal-backed children.
    assert.match(c, /const\s+anyFriendsChildOpen\s*=/, "CP-6: must derive anyFriendsChildOpen from the child surface flags");
    assert.match(c, /visible=\{\s*showFriendsModal\s*&&\s*!anyFriendsChildOpen\s*\}/, "CP-6: friends sheet visible must be GATED on `showFriendsModal && !anyFriendsChildOpen`");
    assert.match(c, /const\s+handleFriendsModalClose\s*=/, "CP-6: must wrap the friends onClose (handleFriendsModalClose)");
    assert.match(c, /onClose=\{handleFriendsModalClose\}/, "CP-6: friends sheet must use onClose={handleFriendsModalClose}");
    // ADVERSARIAL: the gate must not regress to an ungated friends sheet.
    assert.ok(!/visible=\{showFriendsModal\}/.test(c), "CP-A1: friends sheet must NOT use ungated visible={showFriendsModal} — reintroduces the co-present crash");
  }

  // AddFriendView (the friends-list tab's TextInput owner) — keyboard-aware + §13-safe country picker.
  {
    const src = read(ADD_FRIEND_VIEW);
    const c = code(src);

    assert.match(c, /<BottomSheetTextInput\b/, "AF-1: phone field must be <BottomSheetTextInput> (keyboard-aware inside the sheet)");
    assert.match(src, /import\s*\{[\s\S]*?BottomSheetTextInput[\s\S]*?\}\s*from\s+['"][^'"]*ui\/BaseBottomSheet['"]/, "AF-1: BottomSheetTextInput must come from BaseBottomSheet (sole-consumer invariant)");
    assert.ok(!importsGorhom(src), "AF-1: must NOT import @gorhom/bottom-sheet directly");
    // The raw RN <TextInput> on the phone field must be gone (it is now BottomSheetTextInput).
    assert.ok(!/<TextInput\b/.test(c), "AF-1: raw RN <TextInput> must be replaced by <BottomSheetTextInput>");
    // The country picker stays CountryPickerModal (fullScreen RN <Modal>, Batch-4 precedent) —
    // a CountryPickerOverlay nested in the sheet scroll body trips the VirtualizedList warning.
    assert.match(c, /<CountryPickerModal\b/, "AF-2: country picker must stay CountryPickerModal (fullScreen RN Modal, Batch-4 precedent; virtualizes its list in its own window)");
    assert.ok(!/<CountryPickerOverlay\b/.test(c), "AF-2: CountryPickerOverlay (nested-in-sheet) must NOT be used — it nests a FlatList in the sheet's ScrollView (VirtualizedList warning)");
  }

  console.log("PASS META-ORCH-0991 Wave C Batch-3 regression suite (CD, FH, MI, CP, AF — 4 modals + 1 sub-component)");
}

run();
