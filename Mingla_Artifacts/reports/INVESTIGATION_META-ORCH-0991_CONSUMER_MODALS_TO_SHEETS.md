# INVESTIGATION — META-ORCH-0991 [Consumer-app modals → slide-down bottom sheets (universal conversion)]

**Mode:** INVESTIGATE (scoping + architecture; NO product code, NO implementation diffs)
**Scope:** `app-mobile/` (consumer iOS + Android) ONLY
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/` on branch `META-ORCH-0991-consumer-modals-to-sheets`
**Investigator:** mingla-forensics+claude
**Date:** 2026-05-29
**Confidence:** HIGH on inventory + classification + architecture (source-read of every modal file + every gorhom sheet + app root). External API claims cited inline. No live-fire required (scoping/architecture investigation, not a reproducer-bound runtime bug; the existing swipe-dismiss behaviour of the 5 gorhom sheets is established in-code by ORCH-0696/0828/0908). Sims booted + Metro on :8087 left untouched per no-cross-session-interference rule.

---

## 0. Phase 0 ingest + comms ledger

- **COMMS_LEDGER scanned.** No OPEN `BLOCK`/`WARN` row targets `mingla-forensics`, `META-ORCH-0991`, or `ALL` requiring action. COMMS-0003 (`ALL`/WARN — external-API docs must be cited inline) is factored: every `@gorhom/bottom-sheet` API claim below carries a doc URL. No new cross-ORCH discovery to write.
- **Prior precedent ingested from in-code archaeology:**
  - **ORCH-0696** — established `glass.bottomSheet` chrome tokens; "DO NOT add new bottom sheets without consuming these tokens" (`designSystem.ts:272`).
  - **ORCH-0828 REWORK** — tried a `@gorhom/portal` `BottomSheetModalProvider` at app root, then **deleted it** and reverted to the inline `<BottomSheet>` pattern. New invariant `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` (`app/_layout.tsx:79-85`). **This is load-bearing for the primitive contract (§3).**
  - **ORCH-0908** — wrapped ExpandedCardModal's `<BottomSheet>` in an RN `<Modal>` so it z-stacks above the custom tab bar (`ExpandedCardModal.tsx:1787-1798`).
  - **ORCH-0975** — added the light-canvas `glass.notificationsSheet` token sibling.
  - Memory rule referenced in-code: `feedback_rn_sub_sheet_must_render_inside_parent` (sub-sheets render as sibling `<BottomSheet>` roots inside the parent's return fragment).

---

## 1. EXHAUSTIVE PER-MODAL INVENTORY

**Corrected total: 47 distinct modal/sheet/overlay components carrying 52 discrete `<Modal>`/`<BottomSheet>` overlay surfaces.** (Prior lightweight read said "~48 distinct components" — close; the authoritative dedupe is **47 components**. The "5 already on gorhom" count is **correct**; MessageInterface's apparent gorhom import is a comment only, it uses 4 RN Modals.)

Counts by current presentation:
- **`@gorhom/bottom-sheet` (already swipe-down):** 5 components (NotificationsSheet, ExpandedCardModal, ExpandedBusinessEventSheet, TicketCartSheet, CollabSessionChatBanners — the last hosts 3 sheet instances via one `CompactCollabBottomSheet` wrapper).
- **RN `<Modal>` transparent + `animationType="slide"`:** ~22 surfaces (the prime conversion targets — already slide from bottom, just no drag).
- **RN `<Modal>` transparent + `animationType="fade"`:** ~10 surfaces (center dialogs / confirmations).
- **RN `<Modal>` transparent + `animationType="none"` (custom Animated):** 4 surfaces (hand-rolled slide/center animations).
- **RN `<Modal>` `presentationStyle="pageSheet"`:** 3 surfaces (OS card sheet — CardDiscussionModal, CustomPaywallScreen, PersonHolidayView×2).
- **RN `<Modal>` `presentationStyle="fullScreen"` / fullscreen:** 3 surfaces (CollabDeckSheet, SessionViewModal, PostExperienceModal `transparent={false}`).

Legend — Presentation: `gorhom` / `slide` (RN slide) / `fade` (RN fade) / `none` (RN + custom Animated) / `pageSheet` / `fullScreen`. Swipe = already pan-down-dismiss. KB = has text input/keyboard. Nests = renders another modal/sheet inside or alongside.

| # | Component | File:line | What it shows | Presentation | Swipe | KB | Nests | Candidate |
|---|-----------|-----------|---------------|--------------|:----:|:--:|:-----:|-----------|
| 1 | NotificationsSheet | `components/NotificationsSheet.tsx:738` | Notifications feed (SectionList) | gorhom | Y | N | N | GOOD — already a sheet; Wave A migrate to primitive |
| 2 | ExpandedCardModal | `components/ExpandedCardModal.tsx:1799` (wrapped RNModal:1792) | Expanded place/event card detail | gorhom (+RN-Modal wrap) | Y | N | Y (LockedInBanner; opens sub-sheets) | GOOD — already a sheet; Wave A reference impl |
| 3 | ExpandedBusinessEventSheet | `components/expandedCard/ExpandedBusinessEventSheet.tsx:391` | Business event detail + buy CTA | gorhom | Y | N | Y (TicketCartSheet sibling root) | GOOD — already a sheet; Wave A migrate |
| 4 | TicketCartSheet | `components/expandedCard/TicketCartSheet.tsx:328` | Ticket qty cart + checkout CTA | gorhom (sticky footer) | Y | N | N (opened BY #3) | GOOD — already a sheet; Wave A migrate (sticky-footer pattern) |
| 5 | CollabSessionChatBanners (CompactCollabBottomSheet ×3: plans/matches/saved) | `components/chat/CollabSessionChatBanners.tsx:289` | Collab plans / matches / saved cards | gorhom | Y | N | N | GOOD — already sheets; Wave A migrate the local wrapper onto primitive |
| 6 | PreferencesSheet | `components/PreferencesSheet.tsx:1435` | Discover preference filters | slide | N | Y(1) | N | GOOD — Wave C (large, 1 input) |
| 7 | DismissedCardsSheet | `components/DismissedCardsSheet.tsx:127` | Left-swiped cards list | slide | N | N | N | GOOD — Wave B |
| 8 | AddToBoardModal | `components/AddToBoardModal.tsx:224` | Pick board to add card | fade | N | N | N | GOOD — Wave B (list picker) |
| 9 | ShareModal | `components/ShareModal.tsx:43` & `:194` | Share sheet (2 variants) | fade | N | N | Y (2 Modal roots in file) | GOOD — Wave B |
| 10 | BlockUserModal | `components/BlockUserModal.tsx:68` | Confirm block user | fade | N | N | N | GOOD — Wave B (center confirm) |
| 11 | ReportUserModal | `components/ReportUserModal.tsx:77` | Report reason + notes | fade | N | Y(2) | N | GOOD — Wave B |
| 12 | FriendRequestsModal | `components/FriendRequestsModal.tsx:160` | Incoming friend requests list | slide | N | N | N | GOOD — Wave B |
| 13 | BoardMemberManagementModal | `components/BoardMemberManagementModal.tsx:96` | Manage board members | fade | N | N | N | GOOD — Wave B |
| 14 | CustomHolidayModal | `components/CustomHolidayModal.tsx:151` | Create custom holiday (name+date) | slide | N | Y(2) | N | GOOD — Wave B (keyboard) |
| 15 | PostExperienceModal | `components/PostExperienceModal.tsx:456` | Post-experience review flow | fullScreen (`transparent={false}`) | N | N | N | BAD — fullscreen multi-step flow, not a sheet moment (see §2) |
| 16 | BetaFeedbackModal | `components/BetaFeedbackModal.tsx:581` | Screen-recording feedback (multi-step: category→record→review) | slide | N | N | Y (nested success/error Modal) | BAD — multi-step capture flow w/ screen-recording overlay; sheet pan fights the flow (see §2) |
| 17 | FeedbackHistorySheet | `components/FeedbackHistorySheet.tsx:245` (+nested `:293`) | Past feedback list + detail | slide (+nested fade) | N | N | Y (detail Modal) | GOOD — Wave C (nested) |
| 18 | InAppBrowserModal | `components/InAppBrowserModal.tsx:71` | WebView fullscreen browser | fade (transparent) | N | N | N | BAD — WebView fullscreen (see §2 exclusion) |
| 19 | ImageLightbox | `components/ImageLightbox.tsx:54` | Fullscreen pinch/pan image viewer | fade (transparent) | N | N | N | BAD — pinch/pan zoom conflicts with sheet pan (see §2 exclusion) |
| 20 | CustomPaywallScreen | `components/CustomPaywallScreen.tsx:272` | RevenueCat paywall | pageSheet | N | N | N | BAD (product call) — drag-to-dismiss makes monetization too easy to escape (see §2) |
| 21 | PairRequestModal | `components/PairRequestModal.tsx:293` | Send pair request (name fields) | slide | N | Y(3) | N | GOOD — Wave B (keyboard) |
| 22 | IncomingPairRequestCard | `components/IncomingPairRequestCard.tsx:145` | Accept/decline pair request | none (center Animated card) | N | N | N | GOOD — Wave B as center-dialog variant (NOT bottom-drag) |
| 23 | PairingInfoCard | `components/PairingInfoCard.tsx:89` | Pairing info dialog | none (center Animated card) | N | N | N | GOOD — Wave B as center-dialog variant |
| 24 | SessionViewModal | `components/SessionViewModal.tsx:670` | Board-session deck viewer (fullscreen SafeAreaView) | slide transparent (fullscreen container) | N | N | N (own GestureHandlerRootView) | BAD — fullscreen session deck; not a sheet (see §2) |
| 25 | ProposeDateTimeModal | `components/activity/ProposeDateTimeModal.tsx:432` | Propose date/time picker | none (hand-rolled Animated slide-up + backdrop) | N (manual) | N | N | GOOD — Wave B (already imitates a sheet; clean migration) |
| 26 | TicketPdfSheet | `components/activity/TicketPdfSheet.tsx:232` | Ticket PDF/QR viewer | slide | N | N | N | GOOD — Wave B (read-only content) |
| 27 | BoardSettingsDropdown | `components/board/BoardSettingsDropdown.tsx:639` | Board settings menu (rename input) | slide | N | Y(3) | N | GOOD — Wave B/C (keyboard) |
| 28 | CardDiscussionModal | `components/board/CardDiscussionModal.tsx:363` | Card discussion thread + composer | pageSheet | N | Y(2) | N | GOOD — Wave C (chat composer keyboard) |
| 29 | CollabDeckSheet | `components/connections/CollabDeckSheet.tsx:72` | Collab card swipe deck (mounts SwipeableCards) | fullScreen | N | N | Y (SwipeableCards) | BAD — horizontal/vertical card-swipe pan conflicts with sheet pan (see §2 exclusion) |
| 30 | CreateGroupChatSheet | `components/connections/CreateGroupChatSheet.tsx:147` | Create group chat (name + friend search) | slide | N | Y(4) | N | GOOD — Wave C (keyboard + search) |
| 31 | FriendPickerSheet | `components/connections/FriendPickerSheet.tsx:112` | Pick friends (search list) | slide | N | Y(2) | N | GOOD — Wave C (keyboard + search) |
| 32 | FriendsActionChooserSheet | `components/connections/FriendsActionChooserSheet.tsx:69` | Friend action chooser | slide | N | N | N | GOOD — Wave B |
| 33 | PendingCollabChatSheet | `components/connections/PendingCollabChatSheet.tsx:191` | Pending collab chat preview | slide | N | N | N | GOOD — Wave B |
| 34 | CityPickerSheet | `components/discover/CityPickerSheet.tsx:228` | City search picker | slide | N | Y(3) | N | GOOD — Wave C (keyboard + search) |
| 35 | ActionButtons (date/time picker) | `components/expandedCard/ActionButtons.tsx:656` | Inline date/time picker modal | slide | N | N | N | GOOD — Wave B |
| 36 | FriendActionsSheet | `components/friends/FriendActionsSheet.tsx:54` | Friend more-actions sheet | slide | N | N | N | GOOD — Wave B (shared sheet — see §5 blast) |
| 37 | AccountSettings (root sheet) | `components/profile/AccountSettings.tsx:462` | Account settings sheet | slide | N | N | Y (4 nested pickers) | GOOD — Wave C (nested-modal chain; see §3d) |
| 38 | AccountSettings → gender picker | `components/profile/AccountSettings.tsx:805` | Gender picker | slide | N | N | (child of #37) | GOOD — Wave C |
| 39 | AccountSettings → language picker | `components/profile/AccountSettings.tsx:829` | Language picker | slide | N | N | (child of #37) | GOOD — Wave C |
| 40 | AccountSettings → birthday picker | `components/profile/AccountSettings.tsx:858` | Birthday picker | slide | N | N | (child of #37) | GOOD — Wave C |
| 41 | AccountSettings → delete confirm | `components/profile/AccountSettings.tsx:885` | Delete-account confirm | fade | N | N | (child of #37) | GOOD — Wave B as center-confirm |
| 42 | BillingSheet | `components/profile/BillingSheet.tsx:168` | Billing / subscription info | slide | N | N | N | GOOD — Wave B |
| 43 | EditBioSheet | `components/profile/EditBioSheet.tsx:46` | Edit bio (textarea) | slide | N | Y(2) | N | GOOD — Wave C (keyboard) |
| 44 | EditInterestsSheet | `components/profile/EditInterestsSheet.tsx:75` | Edit interests (chips) | slide | N | N | N | GOOD — Wave B |
| 45 | LockedCardSchedulingSheet | `components/session/LockedCardSchedulingSheet.tsx:206` | Schedule a locked card | fade | N | N | N | GOOD — Wave B |
| 46 | MessageContextMenu | `components/chat/MessageContextMenu.tsx:93` | Long-press message actions | none (transparent) | N | N | N | GOOD — Wave B as context-menu (anchored) OR keep (see §2 — evaluate) |
| 47a | DiscoverScreen filter modal | `components/DiscoverScreen.tsx:1815` | Discover filters | slide | N | N | N | GOOD — Wave B/C (embedded-in-screen) |
| 47b | MessageInterface image preview | `components/MessageInterface.tsx:1791` | Sent-image preview | fade | N | N | — | BAD — image viewer (same class as ImageLightbox) |
| 47c | MessageInterface file-processing | `components/MessageInterface.tsx:1734` | Processing spinner overlay | fade transparent | N | N | — | BAD — transient blocking spinner, not a sheet |
| 47d | MessageInterface event-audience sheet | `components/MessageInterface.tsx:2171` | Event audience picker | slide | N | N | — | GOOD — Wave C (embedded-in-screen) |
| 47e | MessageInterface more-options menu | `components/MessageInterface.tsx:2336` | 1:1 chat more-options | slide | N | N | — | GOOD — Wave B (embedded-in-screen) |
| 47f | ConnectionsPage friends modal | `components/ConnectionsPage.tsx:3556` | Friends list modal (keyboard) | slide | N | Y(2) | Y (hosts sheets) | GOOD — Wave C (embedded-in-screen, keyboard) |
| 47g | PersonHolidayView saves list | `components/PersonHolidayView.tsx:1053` | Saved-places list | pageSheet | N | N | — | GOOD — Wave B (embedded-in-screen) |
| 47h | PersonHolidayView visits list | `components/PersonHolidayView.tsx:1085` | Visited-places list | pageSheet | N | N | — | GOOD — Wave B (embedded-in-screen) |

> Embedded-in-screen modals (rows 47a–47h) are `<Modal>` JSX living inside large screen components (DiscoverScreen, MessageInterface, ConnectionsPage, PersonHolidayView), not standalone files — they ARE in scope and counted.

---

## 2. RECOMMENDED EXCLUSION LIST (approve-ready — Seth's call)

These should stay as-is (NOT converted to drag-down sheets). Each line is the crisp reason.

**Hard-exclude (gesture / fullscreen / monetization conflicts):**

1. **ImageLightbox** (`ImageLightbox.tsx:54`) — fullscreen pinch-to-zoom + pan image viewer; a vertical pan-down-to-dismiss directly fights the image pan/zoom gesture. Keep as fullscreen fade Modal. *(Operator candidate — RECOMMEND EXCLUDE.)*
2. **MessageInterface image preview** (`MessageInterface.tsx:1791`) — same image-viewer class as ImageLightbox. RECOMMEND EXCLUDE.
3. **InAppBrowserModal** (`InAppBrowserModal.tsx:71`) — WebView fullscreen; the embedded web content owns scroll/pan and a sheet handle on top of a browser is wrong UX. Keep fullscreen. *(Operator candidate — RECOMMEND EXCLUDE.)*
4. **CollabDeckSheet** (`CollabDeckSheet.tsx:72`) — mounts `SwipeableCards`, the horizontal+vertical card-swipe deck; sheet pan-down would intercept the deck's vertical swipe. Already `presentationStyle="fullScreen"` deliberately. *(Operator candidate — RECOMMEND EXCLUDE.)*
5. **SessionViewModal** (`SessionViewModal.tsx:670`) — fullscreen board-session deck viewer with its OWN `GestureHandlerRootView`; it is a full screen, not a sheet moment. RECOMMEND EXCLUDE.
6. **CustomPaywallScreen** (`CustomPaywallScreen.tsx:272`) — **PRODUCT/MONETIZATION CALL.** Drag-to-dismiss makes the paywall trivially escapable (one flick), which can depress conversion vs an intentional close button. Currently `pageSheet` (already partially swipe-down on iOS). *(Operator candidate — RECOMMEND EXCLUDE pending Seth's monetization call; if he wants it converted, gate the handle behind a deliberate close, not pan-down.)*

**Soft-exclude (flow / transient — recommend keep, low value as drag-sheets):**

7. **PostExperienceModal** (`PostExperienceModal.tsx:456`) — fullscreen (`transparent={false}`) multi-step review-capture flow; not a peek-able sheet. RECOMMEND EXCLUDE.
8. **BetaFeedbackModal** (`BetaFeedbackModal.tsx:581`) — multi-step screen-recording feedback flow (category → recording → review → submit) with a nested success/error Modal and an active screen-recording overlay; sheet pan-down would abort a recording. RECOMMEND EXCLUDE.
9. **MessageInterface file-processing overlay** (`MessageInterface.tsx:1734`) — transient blocking "processing file" spinner; not interactive, must not be dismissable. RECOMMEND EXCLUDE.

**Evaluated and KEPT IN SCOPE (rejected as exclusions):**

- **MessageContextMenu** (`chat/MessageContextMenu.tsx:93`) — a long-press action menu. NOT excluded, but Wave-B note: convert to an anchored action sheet, not a full pan-down sheet (it should feel like a context menu). In scope.
- **IncomingPairRequestCard / PairingInfoCard / AccountSettings delete-confirm / BlockUserModal** — center confirmation dialogs. NOT excluded; convert to the primitive's **center-dialog variant** (no drag-down — a confirm dialog you can flick away is a footgun). In scope but flagged as center-variant, not bottom-drag.

**Net:** 9 surfaces recommended EXCLUDE (6 hard + 3 soft); CustomPaywallScreen is the one explicit product decision for Seth. Everything else is in scope.

---

## 3. SHARED `BaseBottomSheet` PRIMITIVE CONTRACT (Wave A foundation — architectural blast map)

> **Hard architectural constraint (load-bearing):** ORCH-0828 REWORK **deleted** the `@gorhom/portal` `BottomSheetModalProvider` and locked the project onto the **inline vanilla `<BottomSheet>`** pattern (invariant `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS`, `app/_layout.tsx:79-85`). There is **NO `BottomSheetModalProvider` and NO `@gorhom/portal`** anywhere in `app-mobile/` (verified by grep — `NONE FOUND`). The only app-root provider is `GestureHandlerRootView` at `app/_layout.tsx:62`. **The primitive MUST be built on vanilla `<BottomSheet>` (not `BottomSheetModal`)** unless META-ORCH-0991 explicitly re-litigates that invariant with operator sign-off — that re-litigation should be called out in the SPEC, because `BottomSheetModal` + a provider is the gorhom-canonical answer to z-stacking and would *replace* the RN-Modal-wrapper hack. **This is the single biggest architecture decision for the SPEC.**

Version in repo: `@gorhom/bottom-sheet@^5.2.8`, `react-native-gesture-handler@~2.28.0`, `react-native-reanimated@^4.1.5` (`app-mobile/package.json`).

### 3(a) Proposed props / API surface

Modeled on the 5 existing sheets (all share: `index`, `snapPoints`, `enablePanDownToClose`, `onChange`, `backdropComponent`, `backgroundStyle`, `handleIndicatorStyle`). Proposed `BaseBottomSheet` props:

| Prop | Type | Default | Source / rationale |
|------|------|---------|--------------------|
| `visible` | `boolean` | required | Drives `index={visible ? initialIndex : -1}` (declarative open/close — the proven pattern at `ExpandedBusinessEventSheet.tsx:175`, NOT imperative `present()`/`dismiss()`). |
| `onClose` | `() => void` | required | Called from `onChange(-1)` (pan-down / backdrop) AND any explicit close button. |
| `snapPoints` | `(string\|number)[]` | `glass.bottomSheet.snapPoints` (`['50%','90%']`) | Token-default; per-sheet override. `snapPoints` is the canonical gorhom prop. [docs: https://gorhom.dev/react-native-bottom-sheet/props] |
| `enableDynamicSizing` | `boolean` | `false` for known-height; `true` opt-in for small content-sized sheets | Lets short sheets (confirm dialogs, pickers) auto-size. v5 feature. [docs: https://gorhom.dev/react-native-bottom-sheet/ — "Dynamic Sizing"] |
| `variant` | `'sheet' \| 'center-dialog'` | `'sheet'` | `center-dialog` renders a centered card with NO pan-down (for confirms / pair-request cards — rows 22/23/41 + BlockUser/Report). Center variant does NOT use gorhom; it reuses the RN-Modal + centered Animated.View pattern already in IncomingPairRequestCard. |
| `keyboardBehavior` | `'interactive'\|'extend'\|'fillParent'` | `'interactive'` | For form sheets. [docs: https://gorhom.dev/react-native-bottom-sheet/keyboard-handling] |
| `keyboardBlurBehavior` | `'none'\|'restore'` | `'restore'` for forms | Matches the repo's documented usage pattern `keyboardBlurBehavior='restore'`. [docs: keyboard-handling] |
| `android_keyboardInputMode` | `'adjustPan'\|'adjustResize'` | `'adjustResize'` for forms | Android keyboard push. [docs: keyboard-handling] |
| `theme` | `'dark' \| 'light'` | `'light'` | ExpandedCardModal switches dark (TM events) vs light (places) via `isNightOut` (`ExpandedCardModal.tsx:1810-1819`); NotificationsSheet is light (`glass.notificationsSheet`). Primitive must expose both. |
| `scrollMode` | `'view' \| 'scroll' \| 'flatlist' \| 'sectionlist'` | `'scroll'` | Picks `BottomSheetView` / `BottomSheetScrollView` / `BottomSheetFlatList` / `BottomSheetSectionList` for the body so gestures don't fight the sheet pan (NotificationsSheet uses `BottomSheetSectionList`; ExpandedCard/Cart use `BottomSheetScrollView`; CollabBanners mix). **MUST** use gorhom's scrollables, never raw RN ScrollView/FlatList. [docs: https://gorhom.dev/react-native-bottom-sheet/scrollables] |
| `wrapInRNModal` | `boolean` | `false` | **The z-stacking escape hatch — see 3(c).** When `true`, wraps in RN `<Modal transparent animationType="none" statusBarTranslucent>` (the ORCH-0908 pattern). |
| `stickyFooter` | `ReactNode` | `undefined` | TicketCartSheet pins a checkout bar at the bottom of a flexed `BottomSheetView` (`TicketCartSheet.tsx:498`). Primitive should express this as a flex-column `BottomSheetView` with scroll body + pinned footer. |
| `showHandle` / `handleStyle` | `boolean` / style | `true` / token | Drag handle owns the chrome/close role on most surfaces (`ExpandedCardModal.tsx:1825`). |
| `children` | `ReactNode` | required | Sheet body. |

Backdrop: standardize the `BottomSheetBackdrop` with `appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close"` — identical across all 5 existing sheets (e.g. `ExpandedBusinessEventSheet.tsx:188-196`).

### 3(b) Keyboard handling — the form-sheet hazard

- **RN `<Modal>` auto-adjusts for the keyboard** via the OS (the slide modals today mostly "just work" because RN Modal hosts a native window). **`@gorhom/bottom-sheet` does NOT** — a plain `TextInput` inside a gorhom sheet does not coordinate with the sheet's position; you must use **`BottomSheetTextInput`**, which carries the internal `handleOnFocus`/`handleOnBlur` handlers that drive the sheet's keyboard response. [docs: https://gorhom.dev/react-native-bottom-sheet/keyboard-handling — "Plain TextInput components don't have built-in awareness… BottomSheetTextInput is necessary."]
- **Therefore every form modal being converted MUST swap `TextInput` → `BottomSheetTextInput`** and the primitive must set `keyboardBehavior`/`keyboardBlurBehavior`/`android_keyboardInputMode`. This is the single biggest source of conversion regressions.
- **Form/keyboard modals affected (KB=Y in §1):** ReportUserModal, CustomHolidayModal, PairRequestModal, BoardSettingsDropdown, CardDiscussionModal, CreateGroupChatSheet, FriendPickerSheet, CityPickerSheet, EditBioSheet, PreferencesSheet, ConnectionsPage friends modal — **11 surfaces**. These are the reason most keyboard modals are assigned to **Wave C** (highest regression risk).

### 3(c) Z-stacking over the tab bar — the ORCH-0908 pattern (MUST replicate)

- The app uses a **custom in-tree tab bar** (not React Navigation tabs — confirmed in `app/index.tsx`; HomePage and the tab bar are siblings under the Expo Router `Stack`). A vanilla `<BottomSheet>` "mounts in-tree and floats absolutely" (`app/_layout.tsx:83`) — so a sheet mounted **deep** in the deck tree (ExpandedCardModal) rendered *under* the tab bar / chat input, which are siblings higher up.
- **ORCH-0908 fix (`ExpandedCardModal.tsx:1787-1798`):** wrap the `<BottomSheet>` in an RN `<Modal transparent animationType="none" statusBarTranslucent>`. RN Modal hosts a separate native overlay window, lifting the whole sheet above the tab bar. **Cost:** the OS-window boundary is exactly what `BetaFeedbackButton.tsx:32` documents — `pointerEvents:'none'` on the parent does not reach into the Modal window, so the host must dismiss it explicitly on tab-blur.
- **Contrast:** NotificationsSheet (`HomePage.tsx:209`) does **NOT** wrap in RN Modal and z-stacks fine — because it's mounted high enough in the tree (above the tab bar sibling) that the absolute float already clears it. TicketCartSheet/ExpandedBusinessEventSheet render as sibling roots inside ExpandedCardModal's already-wrapped tree.
- **Primitive contract:** expose `wrapInRNModal` (default `false`). Surfaces mounted deep in the deck/chat tree set it `true`; surfaces mounted high (HomePage, profile root) leave it `false`. **Alternative the SPEC must weigh:** adopting `BottomSheetModal` + a single root `BottomSheetModalProvider` would solve z-stacking the gorhom-native way and let the primitive drop the `wrapInRNModal` hack entirely — but that **reverses invariant `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS`** and requires operator sign-off. [docs: https://gorhom.dev/react-native-bottom-sheet/modal — "BottomSheetModal is a bottom sheet wrapped in @gorhom/portal… renders on top of all of your screens."]

### 3(d) Nested-modal chains (one-sheet-at-a-time vs stacked)

- RN `<Modal>` stacks natively (a Modal opened from inside a Modal layers on the OS window stack). **Vanilla gorhom `<BottomSheet>` does NOT portal/stack** — that is exactly why ORCH-0828 reverted to "sibling `<BottomSheet>` roots in the same return fragment" (`ExpandedBusinessEventSheet.tsx:162-163`, memory `feedback_rn_sub_sheet_must_render_inside_parent`).
- **Affected chains:**
  - **AccountSettings** (`AccountSettings.tsx:462` root + 4 nested pickers at `:805/:829/:858/:885`) — today these are 5 sibling RN Modals toggled by separate `visible` flags. The picker Modals open *over* the settings Modal (RN window stack).
  - **MessageInterface** — 4 independent RN Modals on separate flags (not truly nested; mutually exclusive).
  - **ConnectionsPage friends modal** (`:3556`) hosts further sheets.
- **Primitive contract for nesting:** the primitive should express **one-sheet-at-a-time by default** — the parent sheet either (i) closes before the child opens, or (ii) the child renders as a sibling `<BottomSheet>` root in the same fragment with a higher snap, per the proven ORCH-0828 pattern. **True stacked sheets (child visually over parent) require `BottomSheetModal` + provider** — flag in SPEC as the only mechanism that gives RN-Modal-equivalent stacking. For AccountSettings, the cleanest Wave-C migration is: root sheet + child pickers as sibling roots, with the parent at a lower snap while a child is open. **Do NOT** try to nest a gorhom sheet inside another gorhom sheet's body — it breaks the gesture handler.

### 3(e) Gesture conflicts (PanResponder / simultaneousHandlers)

- **ExpandedCardModal** uses a `PanResponder` (`:1429`) for a swipe-down-to-close-from-content gesture in addition to the sheet pan. The primitive must ensure body content uses `BottomSheetScrollView`/`BottomSheetFlatList` (which internally wire `simultaneousHandlers`/`waitFor` to the sheet's pan) so content scroll and sheet drag don't fight. [docs: https://gorhom.dev/react-native-bottom-sheet/scrollables]
- **SwipeableCards** (the deck) and **ImageLightbox** (pinch/pan) are the irreconcilable gesture conflicts → §2 exclusions.
- The primitive should NOT add its own PanResponder; rely on gorhom's gesture system + gorhom scrollables. Where a surface needs the legacy content-pan-to-close (ExpandedCardModal), keep it local during migration, do not generalize into the primitive.

### 3(f) Design tokens — what exists vs what the primitive standardizes

Already centralized in `app-mobile/src/constants/designSystem.ts`:
- `glass.bottomSheet` (`:274-298`) — dark canvas: `scrim` (color/blur/fallback), `handle` (color/width 36/height 4/radius 2/margins), `hairline`, `topRadius: 28`, `snapPoints: ['50%','90%']`, `shadow`. ORCH-0696 mandate: "DO NOT add new bottom sheets without consuming these tokens."
- `glass.notificationsSheet` (`:301+`) — light canvas: `canvas #FFFFFF`, `topRadius: 28`, `backdropTint`, `handle`, `cardShadow`, `cardBorder`, unread tints, avatar ring, status dot.

**Primitive should standardize:** (1) a single `theme: 'dark'|'light'` switch that maps to `glass.bottomSheet` vs `glass.notificationsSheet`; (2) the backdrop component (`appearsOnIndex/disappearsOnIndex/pressBehavior` — currently re-declared in all 5 sheets); (3) the handle indicator style; (4) safe-area bottom padding (`Math.max(insets.bottom, 16)` — repeated in ExpandedCardModal/TicketCartSheet); (5) the `topRadius: 28` + hairline top-border. **Gap to fill:** there is no token for the center-dialog variant or for form-sheet keyboard offsets — the SPEC should add them.

---

## 4. WAVE ASSIGNMENT + EFFORT

**Wave A — Build the primitive + migrate the 5 existing sheets (foundation).**
Build `BaseBottomSheet` (vanilla `<BottomSheet>` inline, the props in §3a, dark+light theme, scroll/flatlist/sectionlist modes, `wrapInRNModal` escape hatch, sticky-footer support, center-dialog variant stub). Then migrate: NotificationsSheet, ExpandedCardModal (the RN-Modal-wrapped reference), ExpandedBusinessEventSheet, TicketCartSheet (sticky footer), CollabSessionChatBanners (3 instances via local wrapper). **Effort: L (largest single wave by risk)** — ExpandedCardModal is the highest-risk migration (PanResponder + RN-Modal wrap + dark/light + sub-sheet roots + checkout). Recommend ExpandedCardModal migrate LAST within Wave A behind a parity gate. ~6 components, ~1.5–2.5 days.

**Wave B — Simple form/center/picker/list modals (no nesting, ≤2 inputs, single snap).**
Rows: DismissedCardsSheet, AddToBoardModal, ShareModal, BlockUserModal (center), ReportUserModal, FriendRequestsModal, BoardMemberManagementModal, CustomHolidayModal, FriendsActionChooserSheet, PendingCollabChatSheet, ActionButtons date/time, FriendActionsSheet, BillingSheet, EditInterestsSheet, LockedCardSchedulingSheet, MessageContextMenu (anchored), ProposeDateTimeModal (already imitates a sheet — easy), TicketPdfSheet, IncomingPairRequestCard (center), PairingInfoCard (center), AccountSettings delete-confirm (center), PairRequestModal, MessageInterface more-options (47e), MessageInterface event-audience (47d), PersonHolidayView saves/visits (47g/47h), DiscoverScreen filter (47a). **~26 surfaces. Effort: M** (high count, low individual risk; the center-dialog ones reuse the variant; keyboard-light ones need `BottomSheetTextInput`). ~3–4 days, parallelizable.

**Wave C — Complex / nested / heavy-keyboard / search modals.**
Rows: PreferencesSheet (large), FeedbackHistorySheet (nested detail), BoardSettingsDropdown (rename input), CardDiscussionModal (chat composer), CreateGroupChatSheet (search+keyboard), FriendPickerSheet (search), CityPickerSheet (search), EditBioSheet (textarea), AccountSettings root + 3 pickers (nested chain — §3d), ConnectionsPage friends modal (47f, embedded + keyboard + hosts sheets). **~11 surfaces. Effort: M-L** (keyboard coordination + nested chains are where regressions hide). ~3–4 days.

**Excluded (no wave):** 9 surfaces in §2 (+ CustomPaywallScreen pending Seth).

**In-scope total to convert: ~43 surfaces** across Waves A/B/C (5 already-sheet migrations + ~38 RN-Modal conversions).

---

## 5. FIVE-TRUTH-LAYER + BLAST RADIUS

**Five-layer cross-check (architecture-level):**
- **Docs/precedent:** ORCH-0696 tokens + ORCH-0828 inline-only invariant + ORCH-0908 RN-Modal-wrap = the authoritative "how Mingla does sheets." A new primitive MUST encode all three or it will regress.
- **Schema:** N/A (pure client UI — no DB/RLS touched).
- **Code:** 5 sheets hand-roll the identical gorhom scaffold; 38 RN Modals each hand-roll backdrop/animation. The duplication is the cost the primitive removes.
- **Runtime:** keyboard coordination (3b) and z-stacking (3c) are the two runtime behaviours that silently differ between RN Modal and gorhom — the primitive's correctness lives here.
- **Data/state:** sheets are driven by `visible` flags in component state / Zustand; no persisted state. Safe.

**Blast-radius / regression risks (conversions that can break things elsewhere):**

1. **Shared sheets used from multiple hosts.** `FriendActionsSheet` is the unified more-menu shared by profile + friends-modal (per memory `feedback_friend_more_menu_shared_sheet` / ORCH-0987). Converting it changes both surfaces at once — verify on both. Same for ShareModal (used app-wide).
2. **ExpandedCardModal is the keystone.** It mounts from the Discover deck, Solo deck, Saved, and collab review flows, hosts sub-sheets (TicketCartSheet via ExpandedBusinessEventSheet), carries review-navigation chrome, and is the ORCH-0908 z-stacking exemplar. A regression here hits the core swipe loop. Migrate last in Wave A behind iOS+Android parity gates.
3. **Deep links that open modals.** Notification taps / friend-request / pair-request / collab-invite deep links open NotificationsSheet, FriendRequestsModal, PairRequestModal, IncomingPairRequestCard, CollabDeckSheet. The `visible`-flag entry points must keep working post-migration — verify deep-link → sheet-open on both platforms.
4. **Analytics tied to open/close.** CustomPaywallScreen fires `mixpanelService.trackPaywallDismissed` on dismiss (`CustomPaywallScreen.tsx:273`). Any sheet with open/close analytics must fire the SAME event on pan-down-dismiss as on button-close (gorhom pan-dismiss routes through `onChange(-1)` → `onClose`, so wire analytics in `onClose`, not the button handler). Audit every converted modal for dismiss-side analytics.
5. **Accessibility.** RN Modal sets `accessibilityViewIsModal` (CreateGroupChatSheet, FriendsActionChooserSheet, PendingCollabChatSheet, CollabDeckSheet) which traps VoiceOver focus. Vanilla gorhom `<BottomSheet>` does NOT trap focus the same way — the primitive must replicate focus-trap + `accessibilityViewIsModal` semantics (or keep `wrapInRNModal` for those), or VoiceOver users lose the modal boundary. **This is a real a11y regression vector.**
6. **Android keyboard + back button.** RN Modal's `onRequestClose` handles Android hardware back. gorhom sheets need the back handler wired explicitly. The primitive must handle Android back → `onClose`, and `android_keyboardInputMode` for form sheets (3b).

**Discoveries for orchestrator:**
- The **app-root architecture decision** (vanilla inline `<BottomSheet>` vs adopting `BottomSheetModal` + `BottomSheetModalProvider`) is the gating decision for the whole META-ORCH. Recommend the SPEC open with it. Adopting the provider would simplify z-stacking + true nesting but reverses `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` — operator sign-off required.
- `CustomPaywallScreen` is the one product/monetization decision Seth must make explicitly.
- No DB/edge/migration touched — strict-grep backend allowlist (COMMS-0002) is N/A for this META-ORCH unless a later sub-task adds backend files.

---

## Confidence

**HIGH** on inventory (every modal file read for presentation props + content + nesting + keyboard), classification, and the primitive contract (grounded in all 5 existing sheets + app root + the three governing ORCH precedents). External `@gorhom/bottom-sheet` API claims are doc-cited inline (note: gorhom.dev/unpkg intermittently refused fetches during this session; the keyboard-handling doc + GitHub README + in-repo usage corroborate every cited default). No live-fire performed — justified: this is a conversion-scoping/architecture investigation, not a reproducer-bound runtime bug, and the swipe-dismiss baseline is established in-code. Booted sims + Metro :8087 (another session's) left untouched.
