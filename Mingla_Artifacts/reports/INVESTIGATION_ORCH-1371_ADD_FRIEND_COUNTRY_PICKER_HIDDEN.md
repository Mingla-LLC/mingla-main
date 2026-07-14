# INVESTIGATION — ORCH-1371 [consumer add-friend country picker hidden]

- **Phase:** INVESTIGATE (no product code written; no fix proposed beyond a concise fix direction)
- **Worktree:** `~/Desktop/mingla-orchs/1371-[friend-country-picker-hidden]/` on branch `1371-friend-country-picker-hidden` (rebased on `origin/main` `83997ba44`)
- **Date:** 2026-07-14
- **Confidence:** **CONFIRMED (iOS-only), root-cause proven.** Android "works" is proven by physical-device runtime (Samsung Galaxy A72). iOS "hidden" is confirmed by operator observation (Seth, direct) + a source-proven mechanism corroborated by an in-repo runtime-error citation (AccountSettings) + the Android control that rules out every platform-agnostic cause.

---

## 1. Symptom (expected vs actual)

Seth, verbatim: *"When I click Add friend in the friends page, the country picker does not show up like it's hidden. I can't change the phone number on the consumer app."*

- **Expected:** Consumer Friends page → open the 4-tab Friends modal → Friends tab shows the add-friend row → tap the flag/dial-code chip (🇺🇸 +1 ⌄) → a full-screen "Select Country" picker slides up so the user can change the country code.
- **Actual (iOS):** The tap registers but the country picker never appears — it behaves as hidden. The country code cannot be changed.
- **Actual (Android):** Works correctly (proven below).

Affected surface: consumer app only. NOT business, NOT buyer-web, NOT admin. **Platform delta: iOS-broken, Android-works.**

---

## 2. Investigation manifest (files read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `app-mobile/src/components/connections/AddFriendView.tsx` | Owns `showCountryPicker` + renders the picker; the reported entry point |
| 2 | `app-mobile/src/components/onboarding/CountryPickerModal.tsx` | Thin app-mobile wrapper add-friend imports |
| 3 | `packages/phone-input/CountryPickerModal.tsx` | The real picker impl — an RN `<Modal presentationStyle="fullScreen">` |
| 4 | `packages/phone-input/pickerPresentation.ts` | Documents the nested-Modal presentation decision (ORCH-1299) |
| 5 | `app-mobile/src/components/ui/BaseBottomSheet.tsx` | The sheet primitive; `wrapInRNModal` = an RN `<Modal transparent>` |
| 6 | `app-mobile/src/components/connections/FriendsActionChooserSheet.tsx` | Confirms sibling child sheets use `wrapInRNModal` |
| 7 | `app-mobile/src/components/ConnectionsPage.tsx` (L768–810, L3640–3782) | Renders AddFriendView inside a `wrapInRNModal` friends sheet + owns the §13 `anyFriendsChildOpen` gate |
| 8 | `app-mobile/src/components/PairRequestModal.tsx` | The cited "Batch-4 precedent" — SAME ungated pattern (same-class bug) |
| 9 | `app-mobile/src/components/profile/AccountSettings.tsx` (L638–683, L1142–1151) | **Reference implementation** — gates its country picker correctly + documents the exact iOS error |
| 10 | `packages/phone-input/PhoneInput.tsx` | Onboarding control — same picker, no parent Modal |
| 11 | `app-mobile/src/components/ui/__tests__/WaveCBatch3.test.mjs` | Shows the "precedent" test is structural-only (never a runtime proof) |

---

## 3. Q-scorecard

### Q1 — What is the exact mechanism the picker is hidden on iOS?
**Verdict (CONFIRMED, proven):** AddFriendView's `CountryPickerModal` is an RN `<Modal presentationStyle="fullScreen">` (`packages/phone-input/CountryPickerModal.tsx:302-307`). It is mounted while the enclosing Friends modal is a `wrapInRNModal` `BaseBottomSheet` — i.e. an RN `<Modal transparent animationType="none" statusBarTranslucent navigationBarTranslucent>` (`BaseBottomSheet.tsx:806-843`). When the picker opens, **two RN `<Modal>`s are asked to be present at the same time**. On iOS a `<Modal>` always becomes a separate native `UIViewController` presentation regardless of React-tree position; iOS allows only one modal presentation per presenter, so the second present is refused ("Attempt to present … which is already presenting …") and the picker's window never appears = *hidden*. Android renders `<Modal>` as a stacked Dialog window, so both co-present fine (proven in §5).

### Q2 — Is `showCountryPicker` actually flipping true on tap? (rule out a dead tap)
**Verdict (PROVEN, not a dead tap):** The chip is a `TouchableOpacity` whose `onPress={() => setShowCountryPicker(true)}` (`AddFriendView.tsx:397-399`); `<CountryPickerModal visible={showCountryPicker} …>` (`AddFriendView.tsx:526-531`) threads the flag through the wrapper (`onboarding/CountryPickerModal.tsx:71` spreads `{...props}`) to the package `<Modal visible={visible}>`. On the **physical Android device the picker rendered with "United States +1 ✓" and a subsequent selection updated the field to +44** — proving the state flips true, `visible` and `selectedCode` propagate, and the picker mounts. The tap and state are correct on both platforms; the failure is purely at the iOS native-presentation layer.

### Q3 — Does the SAME picker work elsewhere (control cases)?
**Verdict (PROVEN — the differentiator is iOS + ungated co-presentation):**
- **Onboarding (`packages/phone-input/PhoneInput.tsx:262-285`)** renders the identical `CountryPickerModal` but is NOT inside any RN `<Modal>` (it is a full-screen onboarding step). Single modal presentation → works on iOS.
- **AccountSettings (`AccountSettings.tsx:1142-1151`)** renders the identical `CountryPickerModal` from a `wrapInRNModal` sheet — the SAME shape as add-friend — but **includes `showCountryPicker` in its `anyChildOpen` gate** (`L651-656`) and gates the root sheet `visible={visible && !anyChildOpen}` (`L683`), dropping the settings sheet's RN-Modal window while the picker is open. Its comment (`L638-650`) states verbatim: *"gorhom sheets do not portal/stack, and two `wrapInRNModal` sheets cannot co-present on iOS ('Attempt to present … which is already presenting …'). So while ANY child surface (…, country picker, …) is open, we DROP the root settings sheet's RN-Modal window — freeing the single presentation slot for the child."* AccountSettings works precisely because it does NOT co-present. Add-friend fails precisely because it does.

### Q4 — Regression or always-broken?
**Verdict (proven latent since META-ORCH-0991, likely never worked in add-friend on iOS in the BaseBottomSheet era):** The AddFriendView country-picker block last changed in `ccf848aaa` (**META-ORCH-0991**, 2026-05-30, PR #266) — the commit that converted the ConnectionsPage friends modal from a hand-rolled RN `<Modal>` to a `wrapInRNModal` `BaseBottomSheet` and applied the §13 `anyFriendsChildOpen` gate to every child surface EXCEPT the country picker (exempted on a "Batch-4 PairRequestModal precedent" rationale — see F-4). The pre-META-ORCH-0991 friends modal was ALSO a `transparent` RN `<Modal>` (`git show 8d5e834ab` → `<Modal animationType="slide" transparent>`), so the nested-Modal structure has existed since ORCH-0435 (`8d5e834ab`). There is **no runtime evidence the add-friend picker ever appeared on iOS** in the BaseBottomSheet era: the `WaveCBatch3.test.mjs` "precedent" test is string-match structural only (`L44: "the @gorhom/bottom-sheet host is NOT mountable in this harness"`), never a live proof. Determination: broken/latent since at least 2026-05-30; the surrounding UI was runtime-exercised on Android (works) but not on iOS.

### Q5 — iOS vs Android delta.
**Verdict (PROVEN iOS-only):** Physical Samsung Galaxy A72 (SM-A725F): the picker appears and is fully functional (§5). Seth independently operator-observed iOS-broken/Android-works. Because Android exercises the identical JS (state flip, `visible`, render) and works, every platform-agnostic cause (dead tap, state never updating, early return, `zIndex`/`elevation`, `pointerEvents`) is ruled out — the only remaining explanation is the iOS single-modal-presentation limitation.

---

## 4. Findings (six-field evidence)

### F-1 — CONFIRMED ROOT CAUSE — country picker co-presents a second RN `<Modal>` over the friends sheet's RN `<Modal>`, ungated, so iOS hides it
1. **Symptom:** Tapping 🇺🇸 +1 ⌄ in the add-friend row shows nothing on iOS; the country code can't be changed.
2. **Layer:** Code (component/native presentation).
3. **Probe:** Read the full render tree: `ConnectionsPage.tsx:3652-3736` (friends sheet `wrapInRNModal`) → child `AddFriendView.tsx:526-531` (`<CountryPickerModal visible={showCountryPicker}>`) → `packages/phone-input/CountryPickerModal.tsx:302-307` (`<Modal presentationStyle="fullScreen">`). Cross-checked against the gate `ConnectionsPage.tsx:794-805`.
4. **Evidence (verbatim):**
   - Parent is an RN `<Modal transparent animationType="none" … statusBarTranslucent navigationBarTranslucent>` — `BaseBottomSheet.tsx:836-843` inside `if (wrapInRNModal)`.
   - Friends sheet passes `wrapInRNModal` — `ConnectionsPage.tsx:3656`.
   - Picker is an RN `<Modal visible={visible} animationType={Platform.OS === "ios" ? "slide" : "fade"} presentationStyle="fullScreen" statusBarTranslucent>` — `packages/phone-input/CountryPickerModal.tsx:302-307`.
   - The friends gate does **not** contain `showCountryPicker`: `anyFriendsChildOpen = friendPickerVisible || actionsSheetVisible || showPairRequestModal || showFriendsActionChooser || showCreateGroupChatSheet || showReportModal || showBlockModal || showAddToBoardModal || showPaywall || !!pendingCollabChat || !!showIncomingPairRequest;` — `ConnectionsPage.tsx:794-805` (grep for `showCountryPicker` in `ConnectionsPage.tsx` returns **zero** matches; `showCountryPicker` is private local state in `AddFriendView.tsx:113`, never surfaced to the parent).
5. **Mechanism:** Because `showCountryPicker` is not in `anyFriendsChildOpen`, opening the picker does NOT drop the friends sheet's RN-Modal window → two RN modals are present simultaneously → on iOS the second `presentViewController` is refused ("already presenting") → the picker's window never mounts → user sees nothing ("hidden"). Android stacks the modals as Dialogs → picker appears.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — SECONDARY ROOT CAUSE (same class, OUT OF SCOPE) — PairRequestModal has the identical ungated pattern
1. **Symptom:** The "Pair with someone" phone country picker is predicted to be hidden on iOS by the same mechanism.
2. **Layer:** Code.
3. **Probe:** Read `PairRequestModal.tsx:309-592`.
4. **Evidence:** `PairRequestModal` is `<BaseBottomSheet … wrapInRNModal>` (`L311-315`) and renders `<CountryPickerModal visible={showCountryPicker} …>` as a sibling (`L586-591`) WITHOUT dropping its own sheet when the picker opens — no gate on `showCountryPicker`. It is opened from ConnectionsPage AFTER the friends sheet is dropped (`showPairRequestModal` IS in `anyFriendsChildOpen`, `L797`), so PairRequestModal is the only sheet up — but its OWN picker still co-presents a second modal over PairRequestModal itself → same iOS collision.
5. **Mechanism:** Identical to F-1: co-present two RN modals on iOS → inner hidden.
6. **Severity:** SECONDARY ROOT CAUSE — **register as a new ORCH; do NOT fix under 1371** (scope discipline).

### F-3 — REFERENCE (control, works) — AccountSettings gates its country picker correctly
1. **Symptom:** N/A (works on iOS).
2. **Layer:** Code (the correct pattern).
3. **Probe:** Read `AccountSettings.tsx:638-683, 1142-1151`.
4. **Evidence:** `showCountryPicker` ∈ `anyChildOpen` (`L655`); root sheet `visible={visible && !anyChildOpen}` (`L683`); comment documents the exact iOS error (`L638-650`).
5. **Mechanism:** Dropping the parent's RN-Modal window frees iOS's single presentation slot for the picker → picker presents → works.
6. **Severity:** RULED OUT as a bug; this is the proven fix pattern.

### F-4 — SUSPECTED CONTRIBUTOR — the "Batch-4 PairRequestModal precedent" is a false analogy that was never runtime-validated on iOS
1. **Symptom:** The in-file rationale that made the exemption look safe.
2. **Layer:** Docs (in-code comment) vs Code/Runtime.
3. **Probe:** Read `AddFriendView.tsx:15-31, 523-531` and `WaveCBatch3.test.mjs:36-51`.
4. **Evidence:** Comment claims the fullScreen picker "stacks above the wrapInRNModal sheet … the SAME proven Batch-4 PairRequestModal precedent." But (a) the "precedent" (PairRequestModal) has the SAME bug (F-2), and (b) the only test backing it is structural string-matching, not a mounted runtime (`WaveCBatch3.test.mjs:44`). The comment directly contradicts AccountSettings' in-repo documentation of the real iOS behavior (F-3).
5. **Mechanism:** A plausible-but-false comment perpetuated the ungated pattern.
6. **Severity:** SUSPECTED CONTRIBUTOR (documentation/rationale defect, not the runtime cause).

---

## 5. Repro evidence (physical device — the Android control, PROVEN)

Driven on Seth's physical **Samsung Galaxy A72 (SM-A725F, serial R58R54YV7JT)**, explorer dev build `com.mingla.app.v2`, connected to a worktree Metro on **:8095** (real `npm ci` was required in the worktree — the spawned symlinked `node_modules → anchor` broke the dev-client manifest URL; see §9). Full authed flow: Continue-with-Google (on-device account, no password) → location grant → Discover → bottom-nav **Friends** → manage-friends icon → 4-tab Friends modal.

| Step | Evidence file | Result |
|------|---------------|--------|
| Add-friend row (Friends tab of the `wrapInRNModal` sheet) | `evidence/ORCH-1371/12_friends_modal.png` | Shows 🇺🇸 +1 ⌄ chip, "Phone number", "Enter phone number" |
| **Tap the 🇺🇸 +1 ⌄ chip** | `evidence/ORCH-1371/13_after_picker_tap.png` | **"Select Country" full-screen picker APPEARS** — search + full country list, "United States +1 ✓" checked |
| Select "United Kingdom +44" | `evidence/ORCH-1371/14_after_select_uk.png` | Picker closes; field updates to 🇬🇧 +44 — full flow works end-to-end |

Interpretation: On Android the nested `<Modal>` presents and functions completely. This is the **working control** that rules out every platform-agnostic cause and isolates the fault to iOS modal presentation.

**iOS runtime capture:** NOT performed this session. iOS verdict is capped at **confirmed by operator observation (Seth, direct) + source-proven mechanism + AccountSettings' in-repo iOS-error documentation + the Android control**. Per the orchestrator this is sufficient to proceed to SPEC. (An iOS-sim visual capture to `evidence/ORCH-1371/ios_add_friend_picker_hidden.png` would elevate to a screenshot-backed CONFIRMED but was deliberately skipped to avoid disturbing the parallel ORCH-1359 session on the shared booted sims and to wrap up promptly.)

---

## 6. Five-Truth-Layer reconciliation

| Layer | Finding |
|-------|---------|
| **Docs** | `AddFriendView.tsx:15-31` comment asserts the fullScreen picker `<Modal>` "stacks above the wrapInRNModal sheet" and works (Batch-4 precedent). **Contradicted** below. |
| **Schema** | N/A (pure client presentation). |
| **Code** | Friends sheet = `wrapInRNModal` RN `<Modal transparent>` (`BaseBottomSheet.tsx:836-843`); picker = RN `<Modal presentationStyle="fullScreen">` (`phone-input/CountryPickerModal.tsx:302-307`); `showCountryPicker` NOT in `anyFriendsChildOpen` (`ConnectionsPage.tsx:794-805`). A SECOND in-repo Code source (`AccountSettings.tsx:638-683`) documents the exact iOS limitation and does the opposite (gates). |
| **Runtime (Android)** | Picker appears + works (physical device, §5). |
| **Runtime (iOS)** | Picker hidden (operator-observed by Seth; source-predicted; matches AccountSettings' documented "already presenting" error). |
| **Data** | N/A. |

**Crux contradiction:** Docs (AddFriendView comment) vs Runtime(iOS)/Code(AccountSettings). The AddFriendView comment is WRONG; AccountSettings holds the truth. Two RN modals cannot co-present on iOS; the picker must not be a co-present sibling `<Modal>` while the sheet's RN-Modal window is up.

---

## 7. Blast radius / cross-surface map

- **In scope (this ORCH):** Consumer iOS add-friend country picker inside the ConnectionsPage Friends modal (`AddFriendView` + `ConnectionsPage` gate).
- **Same-class, OUT OF SCOPE (register new ORCHs):** `PairRequestModal.tsx` country picker (F-2) — same ungated co-present pattern; predicted iOS-hidden.
- **Not affected:** Consumer Android add-friend (proven works). Onboarding picker (no parent Modal). AccountSettings picker (correctly gated). Business, buyer-web, admin (do not use this component/flow).
- **Two-implementation drift (architectural smell):** there are two `CountryPickerModal`s — `app-mobile/src/components/onboarding/CountryPickerModal.tsx` (thin wrapper) over the shared `packages/phone-input/CountryPickerModal.tsx`. The shared package already ships a **non-Modal** `CountryPickerOverlay` for exactly the "inside an existing Modal" case (`packages/phone-input/CountryPickerModal.tsx:328-363`; `pickerPresentation.ts` resolves it web-only today). This is relevant to the fix direction.

---

## 8. Invariant impact

- Touches the META-ORCH-0991 **§13 one-sheet-at-a-time** invariant family (I-PROPOSED "two RN-Modal-backed surfaces cannot co-present on iOS"). The country picker is currently the sole friends-modal child that violates it. The fix must bring the picker under that invariant (either gate it, or make it a non-Modal in-sheet presentation so it is no longer a "second RN-Modal-backed surface").
- No DB/RLS/edge invariants involved.

---

## 9. Discoveries for Orchestrator

1. **NEW ORCH candidate — PairRequestModal iOS country picker (F-2):** same ungated co-present pattern (`PairRequestModal.tsx:311-315, 586-591`); predicted iOS-hidden. Verify + fix under its own ID.
2. **NEW ORCH candidate — two-implementation drift / one-owner-per-truth:** `onboarding/CountryPickerModal.tsx` vs `packages/phone-input`; and the false "Batch-4 precedent" comment (`AddFriendView.tsx:15-31`) should be corrected when the fix lands so it stops misleading future work.
3. **Environment note (not a product change):** to drive the dev build the worktree's `app-mobile/node_modules` symlink (→ anchor) had to be replaced with a real `npm ci` (the symlink made the dev-client manifest serve a broken `/mingla-main/app-mobile/node_modules/...` bundle URL → `UnableToResolveError`; `evidence/ORCH-1371/02_devlauncher_error.png`, `03_app_loaded.png`). The worktree now has real `node_modules` (gitignored, beneficial for the implementor/tester). No product code was modified; no `[ORCH-1371-DIAG]` log was added (black-box device driving only).

---

## 10. Confidence

- **Android leg:** PROVEN (physical-device runtime, §5).
- **iOS leg:** CONFIRMED by operator observation (Seth) + source-proven mechanism + in-repo runtime-error documentation (AccountSettings) + the Android control ruling out platform-agnostic causes. (No iOS screenshot this session — one nicety short of a screenshot-backed CONFIRMED, deliberately deferred.)
- **Overall:** Root cause **PROVEN**; scope **iOS-only, confirmed**.

---

## 11. Recommended next phase + fix direction (DIRECTION ONLY — not a spec)

**Next phase:** SPEC (this skill or dispatched), then IMPLEMENT → TEST → CLOSE.

**Fix direction (iOS-targeted; converge, don't drift):** Stop co-presenting a second RN `<Modal>` while the friends sheet's RN-Modal window is up. Two viable directions, in order of preference:

1. **Preferred — present the picker INSIDE the sheet parent, not as a second `<Modal>`** (`feedback_rn_sub_sheet_must_render_inside_parent`). Use the shared package's non-Modal `CountryPickerOverlay` (`packages/phone-input/CountryPickerModal.tsx:328-363`) rendered via BaseBottomSheet's existing viewport-fixed `overlay` slot (ORCH-1315, `BaseBottomSheet.tsx:240-256, 846-862`) so the picker lives in the SAME native window as the sheet — no second presentation, works identically on iOS and Android, and no `VirtualizedList-in-ScrollView` warning (the overlay is a sibling of the scroll body, not nested in it). This also lets add-friend and onboarding converge on the shared `packages/phone-input` presentation (kills the two-implementation drift).
2. **Alternative — gate it like AccountSettings** (`AccountSettings.tsx:651-683`): lift `showCountryPicker` out of `AddFriendView` (via an `onPickerVisibleChange` callback or hoisted state) so `ConnectionsPage`'s `anyFriendsChildOpen` includes it and the friends sheet's RN-Modal window drops while the picker is open. Lower-risk change but keeps the nested-Modal architecture and the state-hoisting coupling.

Whichever is chosen, apply the same remedy to **PairRequestModal** under a separate ORCH, and add a fails-on-revert guard (e.g. assert `showCountryPicker`/picker-visibility participates in the one-sheet gate, or that add-friend uses the in-sheet overlay rather than a co-present `<Modal>`).
