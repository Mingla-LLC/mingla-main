# IMPLEMENTATION — META-ORCH-0991 Wave C: AccountSettings nested-modal chain → BaseBottomSheet

**ORCH:** META-ORCH-0991 [Consumer-app modals → slide-down bottom sheets] — Wave C, AccountSettings.
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/` on branch `META-ORCH-0991-consumer-modals-to-sheets`.
**Surface touched:** `app-mobile/src/components/profile/AccountSettings.tsx` (sole product file) + new regression test.
**Status:** implemented and verified (sim-proven on iPhone 17 Pro via Metro :8100).
**Anchor commit (fails-on-revert proof):** `b2232b6a36d7a63412f42aa0bbf156d43d9e278b`.

---

## 1. What changed in plain English

AccountSettings was 5 stacked RN `<Modal>`s (a root settings sheet + 3 nested pickers + a delete-account confirm). All 5 are now the shared `BaseBottomSheet`: the root + 3 pickers are swipe-down sheets; the delete confirm is a centered NON-swipe dialog (so you can't flick away a destructive confirm). The nesting is handled with a one-sheet-at-a-time state machine so the pickers reliably appear and return you to settings with your pick applied — no stuck/blank sheet.

## 2. Nesting approach chosen (the hard part)

**Pattern: one-sheet-at-a-time, sibling roots (investigation §3d option i).**

The dispatch offered two options. I attempted the simplest first — sibling `wrapInRNModal` roots that co-present — and it **failed on the sim with a hard iOS error**:

```
(UIKitCore) [UIKit:Presentation] Attempt to present <RCTFabricModalHostViewController: 0x…>
on <UIViewController: 0x…> which is already presenting <RCTFabricModalHostViewController: 0x…>.
```

Two `wrapInRNModal` `BaseBottomSheet`s cannot co-present on iOS — the second RN Modal silently fails because the first already owns the single presentation slot. (This is the same class of constraint that made the investigation flag "true stacked sheets require BottomSheetModal + provider", which is a locked-out architecture per ORCH-0828.)

**Resolution (glitch-free, ships):** gate the root sheet's `visible` on `!anyChildOpen`. While any child surface (gender / language / birthday picker, the excluded country picker, or the delete dialog) is open, the root sheet's RN-Modal window is dropped — freeing the slot for the child. On child dismiss (`setShow*(false)` from a pick, or the child's own swipe/backdrop/back), `anyChildOpen` flips false and the root re-presents at its `['92%']` snap with the new value applied. This reproduces the original UX (pick a value → return to settings) exactly.

**Footgun guarded:** the root's `onClose` is wrapped (`handleRootClose`) — when the root is merely *suppressed for a child*, the internal close that `BaseBottomSheet` fires (`onChange(-1)` → `onClose`) is swallowed so it does NOT call the parent `onClose` and tear down the whole settings flow. Only a genuine user dismiss (no child open) propagates. Regression test T-7 + adversarial T-A2 lock this state machine in.

I rejected option ii (picker as a swappable view INSIDE the root sheet body) because nesting a gorhom scrollable inside another sheet's body fights the pan gesture (investigation §3d explicit "Do NOT") and would also have re-rendered the whole settings tree.

## 3. Per-modal decisions

| Surface | Variant | Snap | wrapInRNModal | Notes |
|---|---|---|---|---|
| Root account-settings (`:462`) | sheet (light) | `['92%']` | yes | Was `flex:1` from `windowHeight*0.08` ≈ 92% (BillingSheet precedent). header (title + close X) + `scroll` body (the accordion ScrollView → primitive `scrollMode="scroll"`). Mounts from ProfilePage under the floating GlassBottomNav → wrap (Batch-2 z-trap). |
| Gender picker (`:805`) | sheet (light) | `['45%']` | yes | Short tap-list. header (title) + `scroll` body (`.map` options). |
| Language picker (`:829`) | sheet (light) | `['70%']` | yes | Was `maxHeight:'70%'` → `['70%']`. 29-language scrollable list rides `BottomSheetScrollView` via `scrollMode="scroll"`. |
| Birthday picker (`:858`) | sheet (light) | `['60%']` | yes | `scrollMode="view"` (consumer owns the 3-column body + buttons). The 3 column wheels were raw RN `<ScrollView>` → swapped to `BottomSheetScrollView` (vertical lists inside a sheet must coordinate with the pan). |
| Delete-account confirm (`:885`) | **center-dialog** (light) | — | n/a (RN-Modal-backed) | Destructive confirm rule (playbook §1). Multi-step confirm/deleting/success/error states render as the dialog children; stripped local `deleteOverlay`/`deleteModalContainer` scrim+card (dialog supplies scrim/card/radius/padding/shadow). |
| CountryPicker (`:873`) | UNCHANGED | — | — | Excluded sub-component (`CountryPickerModal`, not one of the 5 targets). Kept as a fragment sibling, untouched, and folded into `anyChildOpen` so it also suppresses the root. |

## 4. Old → New Receipts

### app-mobile/src/components/profile/AccountSettings.tsx
**What it did before:** Root settings + gender + language + birthday + delete-confirm were 5 RN `<Modal>`s; the root used a hand-rolled `overlay`/`sheet`/`dragHandle` + a `Pressable` top tap-strip sized by `useWindowDimensions()*0.08`; pickers used `pickerOverlay`/`pickerSheet`/`pickerHandle` scrims; delete used `deleteOverlay`/`deleteModalContainer`. Birthday column wheels were raw RN `<ScrollView>`. Picker Modals stacked over the root on the iOS window stack.
**What it does now:** Root + 3 pickers are `<BaseBottomSheet>` swipe-down sheets (fixed snaps, `wrapInRNModal`, stock gorhom motion); delete is `variant="center-dialog"`. Nesting is a one-sheet-at-a-time state machine: root `visible={visible && !anyChildOpen}` + wrapped `handleRootClose`. Birthday wheels use `BottomSheetScrollView`. All dead scrim/overlay/handle styles removed; `Modal`/`Pressable`/`ScrollView`/`useWindowDimensions` react-native imports dropped.
**Why:** META-ORCH-0991 conversion of the AccountSettings nested-modal chain; operator destructive-confirm rule for delete; playbook §2 fixed-snap + §3d nesting + §6 preserve-behavior.
**Lines changed:** ~150 (render tree + imports + snap consts + orchestration + style removals).

**Preserved verbatim (zero behavior change):** all field-update logic (`updateField`, `handleSelect*`, `handleCycleVisibility`, `updateCountry`), the entire delete pipeline (`executeDeleteAccount` 45s wall-clock timeout + AppState background-return detection + `closeDeleteModal` 10s deleting-guard), all Mixpanel analytics (`trackProfileSettingUpdated`/`trackAccountSettingUpdated`), all i18n keys, notification-prefs upserts, accordion logic, `BirthdayPicker` selection/validation, and all option/row/card styles.

### app-mobile/src/components/ui/__tests__/WaveCBatch2.test.mjs (new)
**What it does:** Structural regression suite — T-1..T-8 + adversarial T-A1/T-A2. Asserts BaseBottomSheet consumed (no direct gorhom import), no raw `<Modal>` shell, exactly 5 sheets, exactly 1 center-dialog (the delete confirm), fixed snaps present + no `enableDynamicSizing`/`useWindowDimensions`, `wrapInRNModal` on the 4 sheet surfaces, the nesting state machine intact (gated `visible` + `handleRootClose`), birthday wheels on `BottomSheetScrollView`, dead styles gone, and (T-A2) the gate cannot regress to ungated `visible={visible}` (which re-introduces the iOS two-RN-Modal crash).

## 5. Spec / requirement traceability

| Requirement | Status | Evidence |
|---|---|---|
| Root → BaseBottomSheet swipe-down sheet (tall fixed snap) | PASS | `['92%']` sheet; sim shot `acct_03_root_sheet.png` (rolls up, drag handle, swipe-closes `acct_12`). |
| Gender picker → nested | PASS | sheet `['45%']`; `acct_04b_gender.png` open, `acct_05_after_gender.png` Man→Woman applied on return. |
| Language picker → nested | PASS | sheet `['70%']`, scrollable; `acct_06_language.png` open, `acct_07b_after_lang.png` return. |
| Birthday picker → nested | PASS | sheet `['60%']`, column wheels + buttons on-screen; `acct_08_birthday.png` open, `acct_09_after_bday.png` Cancel returns. |
| Delete confirm → center-dialog (NON-swipe) | PASS | `variant="center-dialog"`; `acct_10_delete_dialog.png` centered card, `acct_11` "Never mind" cancels. |
| Chain works glitch-free, no stuck/blank sheet | PASS | full chain driven on sim; root re-presents with value after every child dismiss. |
| Preserve behavior/copy/callbacks/analytics/styling | PASS | only the container changed; §4 preserved-verbatim list. |
| Android hardware-back + backdrop-press close | PASS (mechanism) | sheets `wrapInRNModal` → RN `<Modal onRequestClose>` (back) + gorhom backdrop `pressBehavior="close"`; center-dialog RN-Modal `onRequestClose`. (Android not driven; iOS backdrop/swipe verified.) |
| Stock gorhom motion | PASS | primitive passes no `animationConfigs`. |
| tsc clean | PASS | 244 errors = baseline, 0 new, 0 mentioning AccountSettings. |
| Sole-gorhom gate | PASS | gate + self-test green. |
| Regression test (happy + fails-on-revert + adversarial) | PASS | WaveCBatch2 passes; fails-on-revert exit 1 @ `b2232b6a`, restored exit 0; T-A1/T-A2 adversarial. |

## 6. Cross-surface impact (Step 3.5)

- **Consumer iOS** — AFFECTED. AccountSettings sheet chain; sim-verified.
- **Consumer Android** — AFFECTED (same shared file/code path; parity automatic). Back/backdrop close wired via the primitive; not driven on emulator this pass (iOS-equivalent mechanism). No Android-specific code.
- **Buyer/anon web, Business iOS/Android, Admin web, Business web** — NOT affected. AccountSettings is a consumer `app-mobile/` profile surface with no analog on those surfaces.

## 7. Regression Test

- **Path:** `app-mobile/src/components/ui/__tests__/WaveCBatch2.test.mjs`
- **Passing run:** `PASS META-ORCH-0991 Wave C Batch-2 regression suite (T-1..T-8, T-A1, T-A2)` (exit 0).
- **Fails-on-revert:** verified at `b2232b6a36d7a63412f42aa0bbf156d43d9e278b` — `git stash` of AccountSettings.tsx → test exits 1; `git stash pop` → exits 0.
- **Adversarial:** T-A1 (dead scrim/overlay/handle styles gone) + T-A2 (nesting gate cannot regress to ungated `visible={visible}` — guards the iOS two-RN-Modal co-present crash). Tester will layer a second adversarial test.
- Ships in the same commit as the fix.

## 8. Invariants

- `I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER` — PRESERVED. `BottomSheetScrollView` imported from `BaseBottomSheet`, not gorhom; gate + self-test green.
- ORCH-0828 vanilla-inline-`<BottomSheet>` (no provider/portal) — PRESERVED; nesting solved without `BottomSheetModal`.

## 9. Discoveries for Orchestrator

- **NEW reusable pattern (added to playbook §13):** two `wrapInRNModal` BaseBottomSheets cannot co-present on iOS. Any future nested-sheet chain (e.g. ConnectionsPage friends modal hosting sheets, FeedbackHistorySheet detail) must use the one-sheet-at-a-time gate (`visible={parent && !anyChildOpen}` + a wrapped parent onClose) OR share a single RN-Modal window — never two live wrapped sheets at once.
- No side bugs found. CountryPicker remains an excluded sub-modal (own component).

## 10. Verification matrix (sim)

iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6`, Metro :8100, Maestro driver:
1. Profile → Account Settings → root sheet rolls up (`acct_03`).
2. Gender row → picker presents (`acct_04b`); tap Woman → returns to settings, Gender = Woman (`acct_05`).
3. Language row → picker presents, list scrolls (`acct_06`); pick English → returns (`acct_07b`).
4. Birthday row → picker presents, wheels + buttons on-screen (`acct_08`); Cancel → returns, date unchanged (`acct_09`).
5. Delete My Account → centered NON-swipe dialog (`acct_10`); "Never mind" → returns to settings (`acct_11`).
6. Swipe down on root → dismisses to Profile page (`acct_12`).

No stuck/blank sheet, no double-fire, no co-present crash at any step.
