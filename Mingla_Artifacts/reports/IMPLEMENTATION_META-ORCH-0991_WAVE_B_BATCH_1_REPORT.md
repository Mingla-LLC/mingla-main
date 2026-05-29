# IMPLEMENTATION — META-ORCH-0991 Wave B Batch 1 [Consumer modals → BaseBottomSheet]

**Skill:** mingla-implementor+claude
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/`
on branch `META-ORCH-0991-consumer-modals-to-sheets`
**Commit:** `1e8714b497f75cd377c2b25c648ed42584b7d6e3`
**Status:** implemented and verified (sim-proven on iPhone 17 Pro)

## Scope

Convert EXACTLY 3 Wave B modals from RN `<Modal>` to `BaseBottomSheet`, stock gorhom
motion, roll-up + swipe-down-close like `ExpandedBusinessEventSheet`. No other modal
touched. Consumer `app-mobile/` only. No backend / migrations / edge / external APIs.

All 3 confirmed Wave B and NOT on the exclusion list (investigation rows 10/11/12).

## Comms ledger

Scanned on entry. No OPEN BLOCK/WARN targets mingla-implementor, META-ORCH-0991, or ALL
requiring action. COMMS-0002 (backend strict-grep allowlist) and COMMS-0003 (external-API
docs) are N/A — zero backend/edge/migration files and zero external APIs touched. No new
cross-ORCH discovery to write.

---

## Old → New Receipts

### `app-mobile/src/components/ui/BaseBottomSheet.tsx`
**Before:** imported the four gorhom body containers + backdrop; no text-input export.
**Now:** also imports + **re-exports `BottomSheetTextInput`** so form consumers get
keyboard-aware input without importing gorhom directly (the sole-consumer gate forbids
that). One added import symbol + one `export { BottomSheetTextInput }` line + doc comment.
**Why:** ReportUserModal (and future form sheets) must use `BottomSheetTextInput`; gate
I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER forbids consumers importing gorhom.
**Lines changed:** ~12.

### `app-mobile/src/components/BlockUserModal.tsx`
**Before:** RN `<Modal transparent animationType="fade">` → `TouchableWithoutFeedback`
overlay (centered scrim) → white rounded card with the block-confirm content.
**Now:** `<BaseBottomSheet variant="center-dialog" theme="light">`; the centered card
chrome (scrim, radius, padding, shadow, maxWidth) comes from `glass.centerDialog`. Inner
content (shield icon, title, bullet list, reason chips, Cancel/Block) byte-identical. Local
`overlay` + `container` scrim/card styles removed (container reduced to transparent
passthrough). `Modal`/`TouchableWithoutFeedback` imports dropped.
**Why:** Block is a destructive confirm — investigation §2 mandates a centered dialog with
NO flick-away pan-down (footgun rule), which is exactly the primitive's center-dialog.
**Snap height:** N/A (center-dialog). **wrapInRNModal:** auto (center-dialog is RN-Modal-backed).
**Lines changed:** ~35.

### `app-mobile/src/components/ReportUserModal.tsx`
**Before:** RN `<Modal transparent animationType="fade">` → `flex-end` overlay + backdrop
touch + `modalContainer` (`minHeight:'95%'`, rounded top) → header / `ScrollView` / footer /
disclaimer; a raw RN `<TextInput>` for additional details.
**Now:** `<BaseBottomSheet snapPoints={['90%']} scrollMode="scroll" wrapInRNModal
keyboardBehavior="interactive" keyboardBlurBehavior="restore"
android_keyboardInputMode="adjustResize">`. Header → `header` prop; reason cards + details
→ scroll body (`children`); actions + disclaimer → `stickyFooter`. `<TextInput>` →
`<BottomSheetTextInput>`. Removed `overlay`/`backdropTouch`/`modalContainer` styles +
`Modal`/`ScrollView`/`TextInput` imports + the `if (!isOpen) return null` early-return
(visible now drives the sheet).
**Why:** it was already a bottom-anchored 95% form — becomes a true swipe-down sheet; the
free-text field needs gorhom keyboard coordination; opened over chat needs z-stacking.
**Snap height:** `['90%']` (preserves prior `minHeight:'95%'` feel). **wrapInRNModal:** true
(opened from chat more-menu / FriendActionsSheet / ConnectionsPage, over the tab bar).
**Lines changed:** ~70.

### `app-mobile/src/components/FriendRequestsModal.tsx`
**Before:** RN `<Modal transparent animationType="slide">` → `flex-end` overlay + backdrop
touch + `sheetContent` (`height: SCREEN_HEIGHT*0.88`, rounded top, cosmetic non-draggable
handle) → header / (loading | ScrollView list) / footer.
**Now:** `<BaseBottomSheet snapPoints={['88%']} scrollMode="scroll" theme="light">`. Header
→ `header` prop; request list (+ loading/empty states) → scroll body; footer note →
`stickyFooter` (undefined while loading). Real gorhom drag handle replaces the cosmetic
one. Removed `sheetOverlay`/`backdropTouch`/`sheetContent`/`dragHandle*` styles + the
`SCREEN_HEIGHT`/`Dimensions`/`useSafeAreaInsets`/`Modal`/`ScrollView` usages + early-return.
**Why:** it was a hand-rolled fixed-height fake sheet (no real drag) — becomes a true
swipe-down sheet at the same height.
**Snap height:** `['88%']` (== prior `SCREEN_HEIGHT*0.88`). **wrapInRNModal:** false
(mounted high in the tree from HomePage; the float clears the tab bar, same as
NotificationsSheet — sim-confirmed the tab bar is fully visible behind it).
**Lines changed:** ~55.

---

## Cross-surface impact (Step 3.5)

- **Consumer iOS / Android** (`app-mobile/`): affected — the 3 modals now present as bottom
  sheets. Parity is automatic (shared RN code path; same component on both platforms).
- **Buyer/anon Web, Business iOS/Android, Admin Web, Business Web preview:** NOT affected —
  these modals are consumer-app social surfaces with no analog on those surfaces.

Count >1 but parity automatic (single RN code path) — no manual drift to register.

---

## Spec / contract traceability

| Conversion-contract criterion | Result | Evidence |
|---|---|---|
| RN `<Modal>` shell → `<BaseBottomSheet>` | PASS | All 3 files; no `<Modal>` survives (regression T-2). |
| Stock gorhom motion (no custom animation) | PASS | No `animationConfigs` anywhere; primitive unchanged on motion. |
| Snap height suits content (not forced 90%) | PASS | Block=center-dialog, Report=['90%'], Friends=['88%']. |
| Forms keyboard-usable (BottomSheetTextInput) | PASS | Report details field typed with keyboard up; value read back (41/500). Screenshots 13. |
| `wrapInRNModal` when over tab bar/chat | PASS | Report=true (chat), Friends=false (home) — both sim-verified. |
| Android back + backdrop-press close | PASS (mechanism) | Primitive wires BackHandler (unwrapped) + onRequestClose (wrapped/center); backdrop pressBehavior="close". Backdrop/swipe close sim-verified. |
| Behavior/props/copy/analytics/styling preserved | PASS | Inner JSX unchanged; only containers swapped. |
| Rolls up + swipe-down-close like events sheet | PASS | Screenshots 06/09/15 (open) + 07/14/16 (swipe-close). |

---

## Sim verification (iPhone 17 Pro, UDID 17091E60-…, Metro :8100)

Driver: Maestro 2.5.1 (operator-mandated; no osascript). Screenshots in
`Mingla_Artifacts/reports/screenshots/`.

- **BlockUserModal** — Friends → Ari O. chat → kebab → "Block User": renders as a centered
  confirm dialog (shield, "Block Ari O.?", bullets, reason chips, Cancel/Block), scrim
  behind, stacked above the chat more-menu. Cancel dismisses cleanly. `06_block_dialog.png`,
  `07_after_block_cancel.png`. NOT pan-down (by design).
- **ReportUserModal** — same path → "Report User": rolls up to 90% with gorhom handle,
  rounded top, scrim, fixed header (flag + title + X), scrolling reason cards, pinned footer
  (Cancel / Submit Report, disabled until reason picked). Selecting Spam highlights + reveals
  the details field + enables Submit. Tapping the field raises the keyboard, the sheet rolls
  to full and the field stays usable (typed 41 chars, read back from hierarchy). Swipe-down
  dismisses back to chat. `09_report_sheet.png`, `12_reason_selected.png`,
  `13_keyboard_up.png`, `14_after_swipe_close.png`.
- **FriendRequestsModal** — no live UI trigger exists (`setShowFriendRequestsModal(true)` is
  never called anywhere in app-mobile — pre-existing orphaned entry point). Verified by a
  temporary local `useState(true)` flip (NOT committed; reverted with `git checkout --` —
  working tree confirmed clean). Renders as a real sheet at 88% with gorhom handle, rounded
  top, scrim, header ("Friend Requests" / "All caught up"), empty-state body, pinned footer.
  Swipe-down dismisses; home + tab bar fully visible behind (confirms no-wrapInRNModal is
  correct). `15_friend_requests.png`, `16_fr_after_swipe.png`.

---

## Regression Test (mandatory gate)

- **Path:** `app-mobile/src/components/ui/__tests__/WaveBBatch1.test.mjs`
- **Run (fixed code):** `node app-mobile/src/components/ui/__tests__/WaveBBatch1.test.mjs`
  → `PASS … (BlockUser + ReportUser + FriendRequests → BaseBottomSheet)`, exit 0.
- **Fails-on-revert:** `git stash push -- <the 3 modals>` (keeping the test + primitive) →
  re-run → AssertionError on T-1, **exit 1**. `git stash pop` → re-run → exit 0.
  Verified at anchor commit `3687f8ec792694945e41cd570694538e8d78b26a` (HEAD before the fix).
- **Coverage:** T-1 each modal imports+renders BaseBottomSheet and imports no gorhom; T-2 no
  raw `<Modal>`/`Modal` import survives; T-3 Block uses center-dialog; T-4 Report = ['90%'] +
  keyboardBehavior + BottomSheetTextInput + wrapInRNModal + no raw TextInput; T-5 Friends =
  ['88%'] + no wrapInRNModal; T-6 primitive re-exports BottomSheetTextInput. **Adversarial
  T-A1:** the old scrim/overlay style keys (`overlay`, `modalContainer`, `sheetOverlay`,
  `sheetContent`) are GONE — catches a "nested the sheet inside the old overlay" half-migration.
- The locked Wave-A suite `BaseBottomSheet.test.mjs` still PASSES (primitive change additive).

## Gates

- **tsc:** `npx tsc --noEmit` from `app-mobile/` → 244 errors, **identical to the pre-change
  baseline** (verified via `git stash` compare). Zero new errors; zero in any touched file.
- **strict-grep:** `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs` self-test PASS +
  live scan OK (409 files; BaseBottomSheet still the sole `@gorhom/bottom-sheet` importer).
- **Lint:** not run separately (no lint script configured in app-mobile; tsc strict covers types).

## Invariants

- `I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER` — PRESERVED (gate green; consumers use
  the primitive's re-export, never gorhom directly).
- `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` (ORCH-0828) — PRESERVED (no provider/
  portal added; primitive unchanged on architecture).
- ORCH-0696 token mandate — PRESERVED (chrome from `glass.bottomSheet`/`notificationsSheet`/
  `centerDialog` via the primitive).

## Cache / parity / state

No React Query, Zustand, persisted state, or query keys touched. Pure client-UI container
swap. Solo/collab N/A.

## Regression surface (for tester)

1. FriendActionsSheet (shared more-menu) → Block/Report still open correctly from profile +
   friends-modal hosts (these modals render inside it).
2. ConnectionsPage Block/Report (3 call sites) — same components, verify each path.
3. Chat more-menu (MessageInterface 47e) → Block/Report z-stack over the chat input.
4. NotificationsSheet ↔ FriendRequestsModal "opens on top" comment — if a live trigger is
   ever added, verify the sibling render order keeps Friends above Notifications.
5. Android: hardware-back + keyboard adjustResize on ReportUserModal (verified by mechanism;
   recommend an Android-emulator pass at TEST).

## Discoveries for orchestrator

- **Orphaned entry point:** `setShowFriendRequestsModal(true)` is never called anywhere in
  `app-mobile/` — FriendRequestsModal is mounted in HomePage but unreachable via UI. Not
  caused by this ORCH; flagging for the orchestrator to register (either wire a trigger,
  e.g. from NotificationsSheet, or remove the dead mount).
- **Wave B playbook** written at `Mingla_Artifacts/specs/WAVE_B_CONVERSION_PLAYBOOK_META-ORCH-0991.md`
  so the remaining ~23 conversions are mechanical.

## Transition items

None.
