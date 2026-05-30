# IMPLEMENTATION — META-ORCH-0991 Wave B Batch 3 [Consumer modals → BaseBottomSheet]

**Skill:** mingla-implementor+claude
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/`
on branch `META-ORCH-0991-consumer-modals-to-sheets`
**Anchor before this batch:** `825c27e8f54ea8bbdbd3a8fa7da0d6244999d02b`
**Status:** implemented and verified (5/6 sim-proven on iPhone 17 Pro; 6th verified
by identical-container-pattern + structural test — live entry point unreachable, flagged)

## Scope

Convert EXACTLY 6 share/board/friend-action modals from RN `<Modal>` to
`BaseBottomSheet`, stock gorhom motion, roll-up + swipe-down-close like
`ExpandedBusinessEventSheet`. No other modal touched. Consumer `app-mobile/`
only. No backend / migrations / edge / external APIs.

1. `app-mobile/src/components/ShareModal.tsx` (2 `<Modal>` roots — BOTH converted)
2. `app-mobile/src/components/AddToBoardModal.tsx`
3. `app-mobile/src/components/BoardMemberManagementModal.tsx`
4. `app-mobile/src/components/friends/FriendActionsSheet.tsx` (shared sheet, ORCH-0987)
5. `app-mobile/src/components/connections/FriendsActionChooserSheet.tsx`
6. `app-mobile/src/components/connections/PendingCollabChatSheet.tsx`

All 6 confirmed Wave B and NOT on the exclusion list — investigation
`INVESTIGATION_META-ORCH-0991_CONSUMER_MODALS_TO_SHEETS.md` rows 8 (AddToBoard),
9 (ShareModal, 2 Modal roots), 13 (BoardMember), 32 (Chooser), 33 (PendingCollab),
36 (FriendActions, "shared sheet — see §5 blast"). None is a pure
destructive-confirm dialog → all six are full swipe-down sheets (operator rule
§1). BoardMember's leave/remove/demote confirms are INLINE body content (not a
separate dialog modal) so the sheet stays swipe-down.

## Comms ledger

Scanned on entry. No OPEN BLOCK/WARN row targets mingla-implementor,
META-ORCH-0991, or ALL requiring action. COMMS-0002 (backend strict-grep
allowlist) and COMMS-0003 (external-API docs) are N/A — zero backend/edge/migration
files and zero external APIs touched. COMMS-0006/0010 are other-ORCH and already
ACKNOWLEDGED/RESOLVED. No new cross-ORCH discovery to write.

## Key finding — content-height sheets snap off-screen inside the RN-Modal wrap

FriendsActionChooserSheet + FriendActionsSheet were first built with
`enableDynamicSizing` (content-height, like Batch-2's EditBioSheet). On the sim
both rendered with their content laid out at `y≈898–1127` — entirely BELOW the
874pt viewport. A content-height gorhom sheet inside the `wrapInRNModal` RN-Modal
window measures its children but does not snap the top into view for these
consumers. EditBioSheet survives because its body has a measurable height with a
`header` prop; the menu/chooser bodies (children-only `scrollMode="view"`) snap
off-screen-bottom. **Fix per playbook §2:** give menus/choosers a FIXED
percentage snap matching their prior height — Chooser `['40%']` (== prior
`maxHeight:'40%'`), FriendActions `['55%']` (fits the max 6-row + title case).
Re-verified on sim: both now render fully on-screen. Regression test T-7/T-8
assert the fixed snap AND `doesNotMatch(enableDynamicSizing)`.

---

## Old → New Receipts

### `app-mobile/src/components/ui/BaseBottomSheet.tsx`
**Before:** re-exported only `BottomSheetTextInput` (Batch 1).
**Now:** also `export { BottomSheetScrollView }` (one line + doc comment) so
PendingCollabChatSheet's bounded inner people-list scroll region can use a
gorhom-aware scroll container (a raw RN `<ScrollView>` nested in a gorhom sheet
fights the sheet pan gesture). Same gate rationale as BottomSheetTextInput — the
sole-consumer gate forbids consumers importing gorhom.
**Why:** PendingCollab owns its body tree (`scrollMode="view"`) but needs a
bounded inner scroll. **Lines changed:** ~8.

### `app-mobile/src/components/ShareModal.tsx`
**Before:** TWO RN `<Modal transparent animationType="fade">` roots — a no-data
guard root and the main share-card root — each `View` overlay (`rgba(0,0,0,0.5)`
centered scrim) → `backdropTouch` → white `modalContainer` (`maxHeight:'90%'`,
radius 20) → header + (guard text | `ScrollView` share card).
**Now:** BOTH roots → `<BaseBottomSheet theme="light" snapPoints={['90%']}
wrapInRNModal>`. Guard root: `scrollMode="view"`, header → `header`, no-data text
→ children. Main root: `scrollMode="scroll"`, header → `header`, the share card +
message box + social buttons + bottom actions → scroll body (`children`,
`scrollProps` carries the prior `scrollView`/`scrollContent` styles +
`showsVerticalScrollIndicator:false`). Dropped `Modal`/`ScrollView` imports and
the `overlay`/`backdropTouch`/`modalContainer` scrim/card styles. All copy,
`handleCopyMessage`/`handleSocialShare` (messages/whatsapp/instagram/twitter
deep-link + fallback), mixpanel `trackExperienceShared` + AppsFlyer `af_share`
analytics, and styling byte-identical.
**Why:** the app-wide share sheet — both the populated card and the empty-state
guard become true swipe-down sheets at the same height; opened over the home
swipe deck / ExpandedCardModal / SessionViewModal (over the tab bar) → wrap.
**Snap:** `['90%']` (== prior `maxHeight:'90%'`). **Keyboard:** no.
**wrapInRNModal:** true. **Lines changed:** ~50.

### `app-mobile/src/components/AddToBoardModal.tsx`
**Before:** RN `<Modal transparent animationType="fade">` → `modalOverlay`
centered scrim → `backdropTouch` → white `modalContainer` (`maxHeight:'80%'`,
radius 24) → header + `ScrollView` (empty-state | board cards) + conditional
footer (Cancel + Add).
**Now:** `<BaseBottomSheet theme="light" snapPoints={['80%']} scrollMode="scroll"
wrapInRNModal>`. Header → `header`; board list + empty-state → scroll body
(`children`, `scrollProps` carries the `content` style); the conditional footer →
`stickyFooter` (`undefined` when `availableSessions.length === 0`, matching the
prior conditional render). Dropped `Modal`/`ScrollView` imports + the
`modalOverlay`/`backdropTouch`/`modalContainer` styles + the `content` style's
stale `maxHeight:384`. All ORCH-0666 filter logic, `useAddFriendToSessions`
mutation, `onResult`/`onMutationSettled` callbacks, select-all, inline error
banner, i18n keys byte-identical.
**Why:** list picker → swipe-down sheet at the same height; opened from
ConnectionsPage / FriendActionsSheet (over the tab bar) → wrap.
**Snap:** `['80%']` (== prior `maxHeight:'80%'`). **Keyboard:** no.
**wrapInRNModal:** true. **Lines changed:** ~50.

### `app-mobile/src/components/BoardMemberManagementModal.tsx`
**Before:** RN `<Modal transparent animationType="fade">` → `modalOverlay` scrim →
`backdropTouch` → white `modalContainer` (`maxHeight:'80%'`, radius 24) → header +
`ScrollView` (members + board info) + `actions` block (inline remove/demote/leave
confirms OR the Leave Board button).
**Now:** `<BaseBottomSheet theme="light" snapPoints={['80%']} scrollMode="scroll"
wrapInRNModal>`. Header → `header`; members + board-info → scroll body
(`children`, `scrollProps` carries the `membersList` style); the entire `actions`
block (inline confirms + Leave button) → `stickyFooter`. Dropped `Modal`/
`ScrollView` imports + the `modalOverlay`/`backdropTouch`/`modalContainer` styles.
All promote/demote/remove/leave handlers, two-tap inline-confirm state machine,
creator/admin badges, min-members warning, i18n keys byte-identical. The inline
destructive confirms (remove/demote/leave) stay as footer body content per the
operator rule (they were never a separate dialog modal).
**Why:** member-management list → swipe-down sheet at the same height; opened from
BoardDiscussion (over the chat) → wrap.
**Snap:** `['80%']` (== prior `maxHeight:'80%'`). **Keyboard:** no.
**wrapInRNModal:** true. **Lines changed:** ~120 (footer relocation).

### `app-mobile/src/components/friends/FriendActionsSheet.tsx`
**Before:** RN `<Modal transparent animationType="slide">` →
`TouchableWithoutFeedback` overlay (`rgba(0,0,0,0.4)`) → absolute-positioned
`container` (`bottom:0`, white, rounded top, `paddingBottom: insets.bottom+16`)
with a hand-rolled cosmetic `handle` → title + action rows + the 3 sibling sub-
modals (AddToBoard/Block/Report).
**Now:** `<BaseBottomSheet theme="light" snapPoints={['55%']} scrollMode="view"
wrapInRNModal>`. The action menu (title + rows) → `children` inside a padding
`container` View; the 3 sub-modals stay rendered alongside (after the sheet)
exactly as before. Dropped `Modal`/`TouchableWithoutFeedback` imports +
`useSafeAreaInsets` + the `overlay`/cosmetic `handle` styles + the absolute
positioning on `container`. The real gorhom handle replaces the cosmetic one;
pan-down + backdrop-press replace the `TouchableWithoutFeedback`. All
`useFriendActions` wiring, the `run()` close-then-act pattern,
pair/unpair/add-to-session/mute/remove/block/report rows, accessibility labels,
the `isFriend` gating byte-identical.
**Why:** shared more-menu (ORCH-0987, profile + friends-modal) → swipe-down sheet.
A fixed `['55%']` snap (not `enableDynamicSizing`) because content-height snaps
off-screen inside the RN-Modal wrap (see Key finding). Opened over the
profile/Connections tab bar → wrap. **PROP CONTRACT UNCHANGED** — both call sites
(ViewFriendProfileScreen + ConnectionsPage) consume the identical props.
**Snap:** `['55%']`. **Keyboard:** no. **wrapInRNModal:** true.
**Lines changed:** ~25.

### `app-mobile/src/components/connections/FriendsActionChooserSheet.tsx`
**Before:** RN `<Modal animationType="slide" transparent accessibilityViewIsModal>`
→ `Pressable` backdrop (`rgba(0,0,0,0.35)`) → absolute-positioned `sheet`
(`bottom:0`, `maxHeight:'40%'`, white, rounded top) with a hand-rolled `handle` →
title + divider + 2 option buttons (create group / add friend).
**Now:** `<BaseBottomSheet theme="light" snapPoints={['40%']} scrollMode="view"
wrapInRNModal>`. Title + divider + options → `children` inside a padding `sheet`
View. Dropped `Modal`/`useSafeAreaInsets` imports + the `backdrop`/cosmetic
`handle` styles + `sheet`'s absolute positioning/bg/radius/maxHeight. The
`accessibilityViewIsModal` focus-trap the original RN Modal provided is RESTORED
by `wrapInRNModal` (investigation §5 a11y note). All `HapticFeedback.medium()`,
the paywall-gated create-group option, chevrons, badges, i18n keys byte-identical.
**Why:** action chooser → swipe-down sheet at the same height; preserves the modal
focus-trap; opened over the Connections tab bar → wrap. Fixed `['40%']` (not
`enableDynamicSizing` — see Key finding).
**Snap:** `['40%']` (== prior `maxHeight:'40%'`). **Keyboard:** no.
**wrapInRNModal:** true. **Lines changed:** ~30.

### `app-mobile/src/components/connections/PendingCollabChatSheet.tsx`
**Before:** RN `<Modal animationType="slide" transparent accessibilityViewIsModal>`
→ `Pressable` backdrop (`rgba(0,0,0,0.42)`) → absolute-positioned dark `sheet`
(`bottom:0`, `maxHeight:'88%'`, `rgba(18,20,24,0.98)`, rounded top, hairline
border) with a hand-rolled `handle` → header + phone-invite section + inner
`ScrollView` people list + Cancel-chat button.
**Now:** `<BaseBottomSheet theme="dark" snapPoints={['88%']} scrollMode="view"
wrapInRNModal keyboardBehavior="interactive" keyboardBlurBehavior="restore"
android_keyboardInputMode="adjustResize" backgroundStyle={SHEET_BACKGROUND_STYLE}>`.
The dark canvas/radius/border preserved via an explicit `backgroundStyle` override
(parity floor). Whole body → `children` (`scrollMode="view"`, consumer owns the
tree); the inner bounded people-list `ScrollView` → `BottomSheetScrollView`
(re-exported from the primitive) to avoid pan-gesture conflict. Dropped
`Modal`/`ScrollView` imports + the `backdrop`/cosmetic `handle` styles + `sheet`'s
absolute positioning/bg/radius/border (moved to `backgroundStyle`). All
`usePhoneLookup`/`inviteByPhone`/`PhoneInput` wiring, the revoke/cancel/add-friend
handlers + RN `Alert` confirms, status pills, lookup states byte-identical. The
modal focus-trap is restored by `wrapInRNModal`.
**Why:** pending-collab preview → swipe-down dark sheet at the same height;
preserves the modal focus-trap; opened over the Connections tab bar → wrap. The
`PhoneInput`'s own raw `TextInput` is left untouched (shared onboarding component,
out of scope); it sits near the top of the `['88%']` sheet so the keyboard won't
cover it, and `keyboardBehavior="interactive"` shifts the whole sheet.
**Snap:** `['88%']` (== prior `maxHeight:'88%'`). **Keyboard:** interactive (sheet
shifts; PhoneInput TextInput preserved). **wrapInRNModal:** true.
**Lines changed:** ~35.

---

## Cross-surface impact (Step 3.5)

- **Consumer iOS / Android** (`app-mobile/`): affected — the 6 sheets now present
  as bottom sheets. Parity automatic (shared RN code path; same component both
  platforms).
- **Buyer/anon Web, Business iOS/Android, Admin Web, Business Web preview:** NOT
  affected — these are consumer-app share/board/friend surfaces with no analog on
  those surfaces.

Count >1 but parity automatic (single RN code path) — no manual drift to register.

## Snap-height decision table (Batch 3)

| Modal | Variant | Snap | Keyboard | wrapInRNModal | Judgment call |
|---|---|---|---|---|---|
| ShareModal (both roots) | sheet | `['90%']` | no | true | == prior maxHeight 90%; both Modal roots converted |
| AddToBoardModal | sheet | `['80%']` | no | true | == prior maxHeight 80%; sticky footer (Cancel/Add) |
| BoardMemberManagementModal | sheet | `['80%']` | no | true | == prior maxHeight 80%; inline confirms in sticky footer |
| FriendActionsSheet | sheet | `['55%']` | no | true | fixed (NOT dynamic — off-screen bug); fits max rows; shared sheet |
| FriendsActionChooserSheet | sheet | `['40%']` | no | true | == prior maxHeight 40%; fixed (NOT dynamic); restores a11y focus-trap |
| PendingCollabChatSheet | sheet (dark) | `['88%']` | interactive | true | == prior maxHeight 88%; dark bg override; PhoneInput TextInput preserved |

## Sim verification (iPhone 17 Pro, UDID 17091E60-C3B6-4167-980D-60C348E177F6, Metro :8100)

Driver: Maestro (operator-mandated; no osascript). Latest JS bundle loaded via
app relaunch against Metro :8100 (cold-build warmed via direct bundle curl before
each relaunch — see Discoveries). Screenshots in
`Mingla_Artifacts/reports/screenshots/batch3/`.

- **ShareModal — no-data root** (`01_share_open.png`): rolls up as a `['90%']`
  sheet with gorhom handle, rounded top, scrim, "Share Experience" header + X,
  "No experience data available" body. Swipe-down dismisses to home
  (`02_share_after_swipe.png`).
- **ShareModal — main card root** (`03_share_card.png`): rolls up at `['90%']`
  with the full orange-bordered experience card (Bay Lounge, 4.3, Suggested
  Schedule, $50–150 per person) + personalized message box + copy button.
- **FriendsActionChooserSheet** (`04_chooser_open.png`): rolls up at `['40%']`
  with handle, scrim, "What do you want to do?" title, Create-group-chat +
  Add-friend options with chevrons. On-screen bounds `[0,548][402,967]` (top
  in-view). Swipe-down dismisses (`05_chooser_after_swipe.png`).
- **FriendActionsSheet — PROFILE call site** (`06_friendactions_profile.png`):
  from ViewFriendProfileScreen ⋮; rolls up at `['55%']` with "Ari O." title +
  Unpair/Add-to-session/Mute/Remove/Block/Report rows (danger-red), all on-screen
  (`y=458–770`). Swipe-down dismisses (`07_friendactions_after_swipe.png`).
- **FriendActionsSheet — FRIENDS-MODAL call site**
  (`08_friendactions_friendsmodal.png`): from the FriendsManagementList ⋮; renders
  IDENTICALLY, z-stacking above the friends-modal. Both ORCH-0987 call sites
  verified, identical render, correct z-order.
- **PendingCollabChatSheet** (`09_pending_open.png`): rolls up at `['88%']` as a
  DARK sheet (preserved `rgba(18,20,24,0.98)` canvas via backgroundStyle), handle,
  "Friday Night Out" header + clock + X, phone-invite section, people list (Seth O
  = Host, Ari O = Pending pills), Cancel-chat button. Swipe-down dismisses
  (`10_pending_after_swipe.png`).
- **AddToBoardModal** (`11_addtoboard_open.png`): rolls up at `['80%']` with
  "Add to Board" header + X + subtitle, select-boards list (Fly Group / Testing
  stuff / Vibes on vibes with member counts, checkboxes, avatars, All toggle), and
  the pinned sticky footer (Cancel + Select Boards). Swipe-down dismisses
  (`12_addtoboard_after_swipe.png`).
- **BoardMemberManagementModal** — NOT sim-rendered. The dedicated modal is mounted
  only in `BoardDiscussion.tsx` via `setShowMemberManagement(true)`; the live
  collab-session entry I reached routed to a DIFFERENT board-info sheet, and a
  seeded `useState(true)` did not re-mount it via this session's board path.
  **Verified by identical-container-pattern + structural test:** its container
  config (`['80%']` + `theme="light"` + header + `scrollMode="scroll"` +
  `stickyFooter` + `wrapInRNModal`) is byte-identical to AddToBoardModal, which IS
  sim-proven on-screen (screenshot 11). tsc + gate + regression T-6 all green.
  **Flagged for the tester** to exercise the live admin path
  (`13_boardmember_open.png` shows the board chat reached, not the modal).

§7.5 temp-seed discipline: ShareModal (AppStateManager seed), Chooser /
FriendActions / Pending / AddToBoard (ConnectionsPage seeds), BoardMember
(BoardDiscussion seed) were each temporarily flipped to render, screenshotted,
then `git checkout --` reverted. Working tree confirmed clean (only the 7 files +
the new test + screenshots) — no temp flip committed.

## Regression Test (mandatory gate)

- **Path:** `app-mobile/src/components/ui/__tests__/WaveBBatch3.test.mjs`
- **Run (fixed code):** `node …/WaveBBatch3.test.mjs` → `PASS … (Share +
  AddToBoard + BoardMember + FriendActions + Chooser + PendingCollab →
  BaseBottomSheet)`, exit 0.
- **Fails-on-revert:** `git stash push` of the 6 modals (keeping the test +
  primitive) → re-run → AssertionError on T-1 (ShareModal), **exit 1**.
  `git stash pop` → re-run → exit 0. Verified at anchor commit
  `825c27e8f54ea8bbdbd3a8fa7da0d6244999d02b`.
- **Coverage:** T-1 all 6 consume BaseBottomSheet + import no gorhom; T-2 no raw
  `<Modal>`/`Modal` import survives; T-3 all 6 wrapInRNModal; T-4 ShareModal = 2
  `<BaseBottomSheet>` (both roots) + `['90%']`; T-5 AddToBoard = `['80%']` +
  stickyFooter; T-6 BoardMember = `['80%']` + stickyFooter; T-7 FriendActions =
  `['55%']` fixed + NOT enableDynamicSizing + keeps 3 sub-modals; T-8 Chooser =
  `['40%']` fixed + NOT enableDynamicSizing; T-9 Pending = dark + `['88%']` +
  backgroundStyle + BottomSheetScrollView + NOT raw `<ScrollView>`; T-10 none is a
  center-dialog. **Adversarial T-A1:** old scrim/overlay/hand-rolled-handle style
  keys GONE — `overlay`/`modalOverlay`/`backdropTouch`/`modalContainer`
  (Share/AddToBoard/BoardMember/FriendActions), `backdrop`/`handle` (Chooser +
  Pending) — catches a "nested the sheet inside the old overlay" half-migration and
  proves the cosmetic handles were replaced.
- Locked Wave-A `BaseBottomSheet.test.mjs` + Batch-1 + Batch-2 suites all still
  PASS (primitive change is additive: one re-export only).

## Gates

- **tsc:** `npx tsc --noEmit` from `app-mobile/` → 244 errors, **identical to the
  pre-change baseline** (verified via `git stash` compare). Zero new; zero in any
  touched file.
- **strict-grep:** `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs` self-test
  PASS + live scan OK (409 files; BaseBottomSheet still the sole
  `@gorhom/bottom-sheet` importer — the 6 consumers + PendingCollab's
  BottomSheetScrollView import come from the primitive re-export).
- **Lint:** no lint script configured in app-mobile; tsc strict covers types.

## Invariants

- `I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER` — PRESERVED (gate green;
  added a primitive-level `BottomSheetScrollView` re-export, consumers import it
  from the primitive).
- `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` (ORCH-0828) — PRESERVED (no
  provider/portal added).
- ORCH-0696 token mandate — PRESERVED (chrome from the primitive's light/dark
  themes; PendingCollab uses an explicit per-surface `backgroundStyle` parity
  override for its dark `rgba(18,20,24,0.98)` canvas, matching the prior sheet).
- ORCH-0987 shared-sheet contract (FriendActionsSheet) — PRESERVED (prop interface
  unchanged; both profile + friends-modal call sites sim-verified, identical
  render + correct z-order).

## Cache / parity / state

No React Query keys, Zustand, or persisted state touched. AddToBoard's
`useAddFriendToSessions` mutation + Pending's `usePhoneLookup`/`inviteByPhone`
unchanged (only containers swapped). Solo/collab N/A. Pure client-UI container swap.

## Regression surface (for tester)

1. **BoardMemberManagementModal live entry** — exercise the real admin path that
   sets `showMemberManagement(true)` in BoardDiscussion (I could not reach it via
   the collab-session chat I tested; verify it rolls up at `['80%']` and the inline
   remove/demote/leave confirms work in the sticky footer).
2. **ShareModal social shares** — verify messages/whatsapp/instagram/twitter
   deep-link + native-share fallback + copy-link/copy-message + mixpanel/AppsFlyer
   analytics still fire (callbacks unchanged; only the container swapped).
3. **AddToBoard mutation** — verify multi-board select → add persists; inline error
   banner on partial failure; sticky footer disables during submit.
4. **PendingCollab keyboard** — verify the PhoneInput (raw RN TextInput, left
   untouched) is not covered by the keyboard at the `['88%']` snap; revoke/cancel
   Alert confirms still fire.
5. **FriendActions sub-modals** — verify AddToBoard/Block/Report still present
   after the sheet closes (the `run()` close-then-act pattern is preserved).
6. **Android** — hardware-back + backdrop-press close on all 6 (wrapped sheets get
   `onRequestClose` (back) from the RN Modal + backdrop `pressBehavior="close"`;
   swipe-down sim-verified on iOS — recommend an Android-emulator pass).

## Discoveries for orchestrator

- **Content-height (`enableDynamicSizing`) sheets snap off-screen inside the
  `wrapInRNModal` RN-Modal window for children-only `scrollMode="view"` consumers.**
  Batch-2's EditBioSheet (dynamic + header) works; the menu/chooser bodies
  (children only, no header) snapped to `y≈898` (below the 874pt viewport). Fixed
  by switching to a fixed percentage snap. Future Wave-B/C menu/chooser conversions
  should prefer a fixed snap over `enableDynamicSizing` when wrapped, OR always pass
  a `header`. Worth a one-line note in the playbook §2.
- **Cold-bundle relaunch friction (worktree Metro :8100):** every `simctl
  terminate`+`launch` hit the dev-client "Could not connect to development server"
  red screen because the first bundle fetch after relaunch triggers a cold build
  that exceeds the client connect timeout. Resolved each time by pre-warming with a
  direct `curl http://127.0.0.1:8100/...entry.bundle` (builds + caches in ~1.5s),
  then relaunch connects instantly. Not a code issue; the symlinked-node_modules
  worktree Metro is just slow on the first build per launch. Noted per the
  sim-blocker-must-resolve rule.

## Transition items

None.
