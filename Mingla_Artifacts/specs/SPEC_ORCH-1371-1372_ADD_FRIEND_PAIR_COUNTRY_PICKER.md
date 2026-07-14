# SPEC — ORCH-1371 + ORCH-1372 (batched) — consumer country-picker hidden on iOS

- **Mode:** SPEC (binding build contract; no product code written here). Batched: **ORCH-1371** [add-friend-country-picker-hidden] + **ORCH-1372** [pair-request-country-picker-hidden].
- **Worktree:** `~/Desktop/mingla-orchs/1371-[friend-country-picker-hidden]/` on branch `1371-friend-country-picker-hidden` (rebased on `origin/main` `83997ba44`).
- **Source of truth:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1371_ADD_FRIEND_COUNTRY_PICKER_HIDDEN.md` (root cause PROVEN; iOS-only; Android control PROVEN working on physical Galaxy A72).
- **Locked decisions (Seth, 2026-07-14):** Approach A (surgical — mirror `AccountSettings.tsx:651-683`). Do NOT adopt the shared `packages/phone-input` overlay path. Do NOT touch the shared package or onboarding. Picker-convergence DEFERRED. Batch both bugs in one worktree/PR.
- **Comms ledger:** COMMS-0096 (WARN, OPEN — `I-RELEASE-VERSION-PARITY`) acknowledged: this SPEC touches NO `app.json` `expo.version` (both already `1.1.2`), so the parity gate is unaffected.

---

## 1. Executive summary

On the consumer app (iOS), tapping the country/dial-code chip in **Add friend** (Friends page → 4-tab Friends modal) does nothing — the "Select Country" picker never appears, so the user cannot change the country code before entering a phone number. The identical bug exists in **Pair with someone** ("Pair by phone" section).

**Root cause (proven):** iOS presents only ONE modal at a time. Both flows open the country picker (`CountryPickerModal` = an RN `<Modal presentationStyle="fullScreen">`) as a **second RN `<Modal>` co-present with** the sheet's own `wrapInRNModal` RN `<Modal>` window. iOS refuses the second presentation ("Attempt to present … which is already presenting …"), so the picker's window never mounts and reads as hidden. Android stacks nested `<Modal>`s as Dialog windows, so it works there (runtime-proven).

**Fix (surgical, mirrors `AccountSettings.tsx:638-683`):** the country picker must NEVER be co-present with a parent `wrapInRNModal` sheet's RN `<Modal>`. Drop/close the parent sheet's RN-Modal window BEFORE the picker presents, and restore it when the picker closes — freeing iOS's single presentation slot. The typed phone value and the selected country MUST survive that close/reopen round-trip.

- **ORCH-1371 (AddFriendView):** `AddFriendView` is a CHILD rendered inside `ConnectionsPage`'s friends sheet — it does not own that sheet. So the picker-open flag AND the transient phone-input state are **hoisted up to `ConnectionsPage`**, the flag is added to the existing META-ORCH-0991 §13 `anyFriendsChildOpen` gate, and the `<CountryPickerModal>` is rendered as a **sibling of the friends `<BaseBottomSheet>`** (surviving the drop, presenting into the freed slot).
- **ORCH-1372 (PairRequestModal):** `PairRequestModal` OWNS its own `<BaseBottomSheet>`, so the fix is self-contained inside the component — gate its own sheet `visible={visible && !showCountryPicker}` and swallow the suppress-for-child close, exactly as `AccountSettings` does. No `ConnectionsPage` change needed for 1372.

Pure client-side React Native JS. Consumer OTA-eligible per-platform once merged. No DB / edge / schema / native change.

---

## 2. Scope & non-goals

### In scope
1. **ORCH-1371** — consumer `AddFriendView` country picker: hoist state to `ConnectionsPage`, gate via `anyFriendsChildOpen`, render picker as sibling, preserve typed phone + selected country across the round-trip.
2. **ORCH-1372** — consumer `PairRequestModal` country picker: self-gate its own sheet + swallow-close, render picker as sibling (already is), preserve phone + country.
3. Delete the false "Batch-4 PairRequestModal precedent — proven to work" comment in `AddFriendView.tsx:15-24` and replace with an accurate note.
4. A **fails-on-revert** CI regression guard (strict-grep gate) + DRAFT invariant `I-PROPOSED-1371-PICKER-NOT-COPRESENT-WITH-SHEET-MODAL`.
5. Amend the now-false assertions in the local structural suite `WaveCBatch3.test.mjs` (AF-2 block) so it stops pinning the buggy structure.

### Non-goals (explicitly OUT — do NOT do these)
- **NO shared-package edits.** `packages/phone-input/**` is untouched — no picker-convergence, no `CountryPickerOverlay` adoption, no changes to `pickerPresentation.ts`. (Investigation §7 flagged the two-implementation drift; converging is a SEPARATE deferred ORCH.)
- **NO onboarding edits** (`packages/phone-input/PhoneInput.tsx`, onboarding country step — already correct, single-modal).
- **NO `AccountSettings.tsx` edit** — it is the reference control (already correct); read it, mirror it, do not modify it.
- **NO `BaseBottomSheet.tsx` edit** — reuse the existing `wrapInRNModal` + gate mechanism as-is.
- **NO `app.json` version touch** (either app) — `I-RELEASE-VERSION-PARITY` (COMMS-0096) must stay green; both are `1.1.2`.
- **NO business / buyer-web / admin change** — those surfaces do not use these components.
- **NO redesign** of the picker UI/UX, chip, or phone row. Behavior-preserving structural fix only.

### Assumptions
- The consumer friends flow renders exactly one friends `<BaseBottomSheet>` (`ConnectionsPage.tsx:3652`) and the picker/PairRequestModal/etc. as siblings after it (`:3910`+). Confirmed by read.
- `CountryPickerModal.handleSelect` (`packages/phone-input/CountryPickerModal.tsx:152-160`) fires `onSelect(code)` THEN `onClose()` on row tap — i.e. selecting a country both updates the value and dismisses the picker in a single synchronous batch. Confirmed by read. The fix relies on this.
- RN `<Modal visible={false}>` unmounts its children (`BaseBottomSheet.tsx:806-867` wraps content in `<RNModal visible={visible}>`). Confirmed — this is why the transient phone state must live in a component that does NOT unmount during the drop.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|--------------------------------|--------------------|--------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | **YES — fix target** | Country picker appears on chip tap in both Add friend and Pair; select applies + returns to the row with the typed phone intact | `AddFriendView.tsx`, `ConnectionsPage.tsx`, `PairRequestModal.tsx` | shared code |
| 2 | **Consumer Android** (`app-mobile/` Android) | **YES — must stay working, cannot regress** | Identical to today: picker appears, select applies, phone intact (proven working on Galaxy A72) | same shared code | shared code — no `Platform.OS` branch added (mirrors AccountSettings, which gates unconditionally and works on Android) |
| 3 | Buyer/anonymous Web (`mingla-business/`) | NO | Does not use `AddFriendView` / `PairRequestModal` / consumer friends flow | — | n/a |
| 4 | Business iOS | NO | Same — separate app, no consumer friends flow | — | n/a |
| 5 | Business Android | NO | Same | — | n/a |
| 6 | Admin Web (`mingla-admin/`) | NO | No friends/pairing UI | — | n/a |
| 7 | Business Web preview | NO | No consumer friends flow | — | n/a |

**Android no-regression is a HARD requirement.** The fix is the SAME code on both platforms (no `Platform.OS` guard — mirroring `AccountSettings`, which gates unconditionally and is proven on Android). On Android the picker is `presentationStyle="fullScreen"` (covers the whole screen); whether the friends sheet is present behind it is invisible, and the hoisted state survives the unmount/remount identically on both platforms, so user-visible Android behavior is unchanged. This is proven-safe by the `AccountSettings` precedent already shipping the identical unconditional-gate pattern on Android. See SC-2 / TC-A1.

---

## 4. Layered specification

Only the **Component** layer is touched (plus CI/test tooling). No DB / RLS / edge / service / hook / realtime layer is involved.

### 4A. `app-mobile/src/components/connections/AddFriendView.tsx` (ORCH-1371)

`AddFriendView` STOPS owning the phone-input transient state and STOPS rendering the picker. It receives them from `ConnectionsPage` (which does not unmount during the sheet drop).

**A-1 — Delete the false comment (`:15-24`).** Remove the block beginning `// META-ORCH-0991 Wave C: AddFriendView is rendered ONLY inside the ConnectionsPage` … through `… because the Modal is a separate window.` Replace with:

> A ≤6-line accurate note stating: the country picker is HOISTED to `ConnectionsPage` and rendered as a SIBLING of the friends sheet, gated closed via `anyFriendsChildOpen`, because iOS presents only one modal at a time and a `wrapInRNModal` sheet cannot co-present a second RN `<Modal>` picker (subtract-before-adding). Cross-reference `AccountSettings.tsx:638-683` as the proven pattern. Do NOT reintroduce a "Batch-4 precedent" claim.

**A-2 — Props interface (`:52-66`).** ADD four props (keep the existing six unchanged):
- `selectedCountry: CountryData` — read for the chip + E.164.
- `phoneNumber: string` — the controlled phone-field value (hoisted).
- `onPhoneNumberChange: (text: string) => void` — replaces local `setPhoneNumber`.
- `onOpenCountryPicker: () => void` — opens the hoisted picker.

**A-3 — Remove hoisted local state (`:103-113`).** DELETE the `phoneNumber`, `selectedCountry`, and `showCountryPicker` `useState` declarations. KEEP `actionStatus` + `actionError` local (they may reset on remount — acceptable; not required to persist).

**A-4 — Reads now come from props.** `phoneRawDigits` / `phoneE164` (`:120-124`) derive from the `phoneNumber` + `selectedCountry` props (logic byte-identical).

**A-5 — Every `setPhoneNumber(...)` → `onPhoneNumberChange(...)`.** Includes the two clear-on-success calls (`:167`, `:199` → `onPhoneNumberChange("")`) and the phone field `onChangeText` (`:416`). Add `onPhoneNumberChange` to the `handlePhoneAction` `useCallback` deps (`:210-219`).

**A-6 — Remove `handleCountrySelect` (`:245-250`)** — it moves to `ConnectionsPage`.

**A-7 — Chip tap (`:397-399`).** `onPress={onOpenCountryPicker}` (was `() => setShowCountryPicker(true)`).

**A-8 — Phone field (`:413-431`).** `value={phoneNumber}`; `onChangeText` calls `onPhoneNumberChange(text)` then the existing `actionStatus`-reset branch (unchanged).

**A-9 — DELETE the picker render (`:523-531`)** — the entire `<CountryPickerModal … />` block plus its comment. AddFriendView's return becomes `<View style={styles.container}>{glassCard}</View>`.

**A-10 — Prune imports.** REMOVE `import { CountryPickerModal } from "../onboarding/CountryPickerModal";` (`:31`) and `getDefaultCountryCode`, `getCountryByCode` from `../../constants/countries` (`:27-29`, now unused). KEEP `CountryData` (`:30` — used by the new prop type).

### 4B. `app-mobile/src/components/ConnectionsPage.tsx` (ORCH-1371)

`ConnectionsPage` becomes the owner of the add-friend picker flag + the transient phone state, and renders the picker as a sibling of the friends sheet.

**B-1 — Imports.** ADD (none currently present): `import { CountryPickerModal } from "./onboarding/CountryPickerModal";`, `import type { CountryData } from "../types/onboarding";`, and `import { getDefaultCountryCode, getCountryByCode } from "../constants/countries";`.

**B-2 — State (near `:618-620`, beside `friendPickerVisible` / `friendsModalTab`).** ADD:
- `addFriendCountry: CountryData` (setter `setAddFriendCountry`) initialized `getCountryByCode(getDefaultCountryCode()) ?? { code:"US", name:"United States", dialCode:"+1", flag:"🇺🇸" }` (mirror `AddFriendView.tsx:104-112`).
- `addFriendPhone: string` (setter `setAddFriendPhone`) initialized `""`.
- `addFriendPickerOpen: boolean` (setter `setAddFriendPickerOpen`) initialized `false`.

**B-3 — Extend the §13 gate (`:794-805`).** ADD `addFriendPickerOpen ||` to the `anyFriendsChildOpen` boolean expression. Everything else in that expression and `handleFriendsModalClose` (`:806-810`) is unchanged. The friends sheet's `visible={showFriendsModal && !anyFriendsChildOpen}` (`:3653`) and `onClose={handleFriendsModalClose}` (`:3654`) are unchanged and now automatically drop the sheet when the picker opens.

**B-4 — Select handler.** ADD `handleAddFriendCountrySelect = useCallback((code:string)=>{ const c = getCountryByCode(code); if (c) setAddFriendCountry(c); }, [])` (mirror the deleted `AddFriendView.handleCountrySelect`).

**B-5 — Reset-on-open effect (preserve pre-1371 semantics).** ADD a `useEffect` keyed on `[showFriendsModal]` that, on the false→true edge (`if (showFriendsModal) { … }`), resets `setAddFriendPhone("")`, resets `setAddFriendCountry(default)`, and `setAddFriendPickerOpen(false)`. Rationale: before 1371, `AddFriendView` unmounted on modal close, so reopening showed an empty field + default country. Because `showFriendsModal` stays `true` throughout a picker round-trip (only `anyFriendsChildOpen` gates `visible`), this effect does NOT fire mid-round-trip → the typed value survives; it fires only on a genuine reopen → matches old semantics. (Do NOT key this on `anyFriendsChildOpen`.)

**B-6 — Wire `AddFriendView` props (`:3741-3748`).** ADD: `selectedCountry={addFriendCountry}`, `phoneNumber={addFriendPhone}`, `onPhoneNumberChange={setAddFriendPhone}`, `onOpenCountryPicker={() => setAddFriendPickerOpen(true)}`.

**B-7 — Render the picker as a sibling of the friends sheet.** Insert immediately AFTER `</BaseBottomSheet>` (`:3910`), before `{/* Friend Picker Sheet */}` (`:3912`):

```
<CountryPickerModal visible={addFriendPickerOpen} selectedCode={addFriendCountry.code}
  onSelect={handleAddFriendCountrySelect} onClose={() => setAddFriendPickerOpen(false)} />
```

Because it is a SIBLING of the friends `<BaseBottomSheet>` (not a descendant), it survives the sheet's drop and presents into the freed iOS slot. On row-select, `handleSelect` fires `onSelect` (updates `addFriendCountry`) then `onClose` (`setAddFriendPickerOpen(false)` → gate flips → friends sheet re-presents → `AddFriendView` remounts reading the new country + the preserved phone from props).

### 4C. `app-mobile/src/components/PairRequestModal.tsx` (ORCH-1372)

`PairRequestModal` owns its own sheet, so mirror `AccountSettings` WITHIN the component. Its phone state (`phoneNumber`, `selectedCountry`, `searchQuery` at `:107-118`) already lives on the component (not on the sheet's children) and the `PairRequestModal` component stays mounted throughout (`ConnectionsPage` keeps `showPairRequestModal` true), so that state survives the inner-sheet drop with no hoist.

**C-1 — Gate the sheet (`:312`).** Change the `<BaseBottomSheet>` `visible={visible}` → `visible={visible && !showCountryPicker}`. (Mirror of `AccountSettings.tsx:683` `visible={visible && !anyChildOpen}`.)

**C-2 — Swallow the suppress-for-child close.** The `<BaseBottomSheet onClose>` prop (`:313`) currently is `handleClose`, which resets `phoneNumber` AND calls the parent `onClose` — that would tear down the whole flow and clear the phone when the sheet drops for the picker. ADD a wrapped handler and use it ONLY on the sheet's `onClose` prop:

```
const handleSheetClose = useCallback(() => { if (showCountryPicker) return; handleClose(); }, [showCountryPicker, handleClose]);
```

Set the `<BaseBottomSheet onClose={handleSheetClose}>` (`:313`). The header X button (`:301`) KEEPS `onPress={handleClose}` (a genuine user dismiss must fully close). (Mirror of `AccountSettings.handleRootClose` `:658-677`.)

**C-3 — Picker sibling stays (`:586-591`).** `<CountryPickerModal>` already renders as a sibling of the `<BaseBottomSheet>` inside the `<>` fragment — leave it; it now presents into the freed slot when the sheet drops. `handleClose` (`:287-294`) already includes `setShowCountryPicker(false)` — unchanged.

**C-4 — No hoist, no `ConnectionsPage` change for 1372.** `PairRequestModal`'s `visible` prop and `onClose` prop from `ConnectionsPage` (`:4018-4025`) are unchanged.

### 4D. Regression tooling (see §9)
- NEW strict-grep gate `.github/scripts/strict-grep/orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs`.
- NEW CI job in `.github/workflows/strict-grep-mingla-business.yml`.
- Register in `.github/scripts/strict-grep/README.md`.
- Amend `app-mobile/src/components/ui/__tests__/WaveCBatch3.test.mjs` (AF-2 + prose).
- DRAFT invariant entry in `Mingla_Artifacts/INVARIANT_REGISTRY.md`.

---

## 5. Success criteria (observable, testable)

- **SC-1-iOS (1371):** Consumer iOS. Friends page → Friends modal → Friends tab → tap the flag/dial chip → the "Select Country" full-screen picker APPEARS. (Today: nothing.)
- **SC-2-Android (1371):** Consumer Android. Same tap → picker still APPEARS and functions exactly as today (no regression).
- **SC-3 (1371 round-trip):** With a phone number already typed (e.g. `7700900123`) and a non-default country selected in the picker, on returning to the Add-friend row: the typed phone value is INTACT and the newly selected country (flag + dial code) is applied to the chip and to the built E.164. Neither is lost.
- **SC-4 (1371 gate):** While the picker is open, the friends sheet's RN-Modal window is NOT co-present (it is dropped); when the picker closes (row-select, X, or backdrop), the friends sheet re-presents at the friend-list tab. No stuck/blank state; the whole friends flow is not torn down.
- **SC-5 (1371 reopen semantics):** Fully closing the Friends modal and reopening it shows an EMPTY phone field + the default country (pre-1371 behavior preserved).
- **SC-6-iOS (1372):** Consumer iOS. Friends → "Pair with someone" → "Pair by phone" → tap the chip → picker APPEARS. (Today: nothing.)
- **SC-7-Android (1372):** Consumer Android. Same → picker still APPEARS + functions as today.
- **SC-8 (1372 round-trip):** In Pair-by-phone, with a typed phone + a selected country, returning from the picker keeps the phone intact and applies the selected country. The PairRequestModal is not torn down (search query + phone survive).
- **SC-9 (comment truth):** `AddFriendView.tsx` no longer contains the words "Batch-4 PairRequestModal precedent … proven to work"; the replacement note references the AccountSettings gate + the iOS one-modal-at-a-time constraint.
- **SC-10 (guard):** The strict-grep gate `orch-1371-1372-picker-not-copresent` passes on the fixed tree and FAILS on any revert of §4A/§4B/§4C structural changes; its `--self-test` passes.
- **SC-11 (parity untouched):** `git diff` shows NO change to `app-mobile/app.json` or `mingla-business/app.json`; `I-RELEASE-VERSION-PARITY` + `I-RELEASE-SUBMIT-CONFIG` gates stay green.

---

## 6. Invariants

### Preserved (must not break)
- **META-ORCH-0991 §13 one-sheet-at-a-time** (`ConnectionsPage.tsx:786-810`, `:3653`): the friends sheet drops while any RN-Modal-backed child is open. This fix BRINGS the add-friend country picker UNDER this invariant (it was the sole child violating it) by adding `addFriendPickerOpen` to `anyFriendsChildOpen`. Verified by: the picker flag appears in the gate expression; friends sheet keeps `visible={showFriendsModal && !anyFriendsChildOpen}`.
- **I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER** (`meta-orch-0991-base-bottom-sheet-sole-consumer.mjs`, CI job at workflow L709-720): only `BaseBottomSheet.tsx` may import `@gorhom/bottom-sheet`. This fix adds NO gorhom import to `AddFriendView` / `ConnectionsPage` / `PairRequestModal` (`CountryPickerModal` is an RN `<Modal>`, not gorhom). Gate stays green.
- **I-RELEASE-VERSION-PARITY / I-RELEASE-SUBMIT-CONFIG** (COMMS-0096/0097): no `app.json` / `eas.json` touch. Green.
- **`feedback_rn_sub_sheet_must_render_inside_parent`** family: for 1371, the picker is a sibling of the friends sheet in `ConnectionsPage` (the one-window host) rather than nested inside the scroll body — consistent with the ORCH-1315 sibling-overlay principle without adopting the overlay component.

### New (proposed — flips ACTIVE at CLOSE; orchestrator owns the flip)

**`I-PROPOSED-1371-PICKER-NOT-COPRESENT-WITH-SHEET-MODAL` (DRAFT)**
- **Rule:** In the consumer friends/pairing flow, a country-picker `<Modal>` (`CountryPickerModal`) must NEVER be rendered as a co-present sibling/descendant of a `wrapInRNModal` `BaseBottomSheet`'s presented RN `<Modal>` window. Concretely: (a) `AddFriendView.tsx` must NOT render `<CountryPickerModal>` and must NOT own the `showCountryPicker` state (both hoisted to `ConnectionsPage`); (b) `ConnectionsPage.tsx` renders the add-friend `<CountryPickerModal>` as a sibling of the friends sheet AND includes `addFriendPickerOpen` in `anyFriendsChildOpen`, keeping `visible={showFriendsModal && !anyFriendsChildOpen}`; (c) `PairRequestModal.tsx`'s own `<BaseBottomSheet>` is gated `visible={visible && !showCountryPicker}` with a swallow-for-child `onClose`, so its picker never co-presents.
- **Enforcement:** strict-grep gate `.github/scripts/strict-grep/orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs` (`--self-test` + live), CI job `orch-1371-1372-picker-not-copresent` in `strict-grep-mingla-business.yml` (PR-blocking; workflow already triggers on `app-mobile/**`). Registered in the strict-grep README.
- **Regression test:** fails-on-revert — on the pre-fix tree INV-1 fails (AddFriendView still renders `<CountryPickerModal>`) and INV-3 fails (PairRequestModal sheet is bare `visible={visible}`); after the fix all pass. See §9.
- **Established:** DRAFT at IMPLEMENT; flips ACTIVE at CLOSE.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| TC-1 | 1371 happy iOS | Tap chip in Add friend (iOS sim) | "Select Country" picker presents full-screen | UI/runtime |
| TC-2 | 1371 round-trip | Type `7700900123`, tap chip, pick "United Kingdom +44" | Picker closes; chip shows 🇬🇧 +44; phone field still shows `7700900123`; E.164 = `+447700900123` | UI/state |
| TC-3 | 1371 gate integrity | Open picker, then close via X | Friends sheet re-presents on the Friends tab; not torn down; friend list intact | UI/runtime |
| TC-4 | 1371 reopen | Type a number, close Friends modal entirely, reopen | Phone field empty + default country (pre-1371 semantics) | UI/state |
| TC-5 | 1371 Android no-regress | Repeat TC-1..TC-3 on Android (Galaxy A72) | Identical to pre-fix working behavior | UI/runtime |
| TC-6 | 1372 happy iOS | Tap chip in Pair-by-phone (iOS) | Picker presents | UI/runtime |
| TC-7 | 1372 round-trip | Type phone + search a friend + pick a country | Country applied; phone + search query intact; modal not torn down | UI/state |
| TC-8 | 1372 Android no-regress | TC-6/TC-7 on Android | Identical to pre-fix | UI/runtime |
| TC-9 | back while picker open (Android) | Hardware back with picker open | Picker dismisses via its `onClose` → gate flips → sheet re-presents (no dead state). iOS fullScreen has no swipe-dismiss; only row-select / X close it | UI/runtime |
| TC-10 | re-entrancy | Open→close→reopen the picker 3× rapidly | Each cycle presents + restores cleanly; phone preserved throughout | UI/runtime |
| TC-11 | keyboard interplay | Focus phone field (keyboard up), then tap chip | Picker presents over the field; its own search input is usable; on close, focus/keyboard state does not wedge the sheet | UI/runtime |
| TC-A1 | guard fails-on-revert | Revert §4A (restore picker in AddFriendView) | `orch-1371-1372-picker-not-copresent` INV-1 FAILS | CI |
| TC-A2 | guard fails-on-revert | Revert §4C (`visible={visible}` in PairRequestModal) | INV-3 FAILS | CI |
| TC-A3 | guard self-test | `node …orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs --self-test` | good fixtures pass, bad fixtures fail | CI |
| TC-A4 | sole-gorhom gate | Run `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs` | PASS (no new gorhom import) | CI |

**Tester adversarial angle (leave open):** confirm (a) on iOS the friends sheet actually drops (not merely z-behind) while the picker is up — e.g. the sheet is not intercepting touches; (b) `addFriendPhone` does NOT leak between two DIFFERENT users if account switch occurs while the Friends modal is open; (c) rapid double-tap on the chip cannot open two pickers; (d) selecting a country and immediately backgrounding/foregrounding the app does not lose the applied country.

---

## 8. Implementation order

1. **`AddFriendView.tsx`** — A-1 comment; A-2 props; A-3 remove state; A-4/A-5/A-6/A-7/A-8/A-9 wiring + picker removal; A-10 imports. (Component compiles against new props; will be red until ConnectionsPage passes them — expected.)
2. **`ConnectionsPage.tsx`** — B-1 imports; B-2 state; B-3 gate; B-4 select handler; B-5 reset effect; B-6 props; B-7 sibling picker.
3. **`PairRequestModal.tsx`** — C-1 gate; C-2 swallow-close; verify C-3 sibling + C-4 no external change.
4. **`orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs`** — write the gate + `--self-test`; prove fails-on-revert BEFORE and PASS after (Step 0.5).
5. **`strict-grep-mingla-business.yml`** — add the CI job (self-test step + live step), mirroring an existing job (e.g. the ORCH-1322 block).
6. **`.github/scripts/strict-grep/README.md`** — register the gate.
7. **`WaveCBatch3.test.mjs`** — amend AF-2 + prose (see §9).
8. **`Mingla_Artifacts/INVARIANT_REGISTRY.md`** — add the DRAFT invariant entry.
9. Typecheck + run the gate + run `WaveCBatch3.test.mjs` + `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs`; then live-fire on iOS sim + physical Android per §7.

---

## 9. Regression prevention (fails-on-revert contract)

### Primary guard (CI-blocking) — the Step-0.5 assertion
NEW `.github/scripts/strict-grep/orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs`, comment-stripped reads of the three files, with `--self-test` (good/bad fixtures). Assertions:

- **INV-1 (AddFriendView hoisted):** `AddFriendView.tsx` MUST NOT contain `<CountryPickerModal` AND MUST NOT contain `showCountryPicker` / `setShowCountryPicker` (state fully hoisted).
- **INV-2 (ConnectionsPage renders + gates):** `ConnectionsPage.tsx` MUST contain `<CountryPickerModal`; its `anyFriendsChildOpen` expression MUST include `addFriendPickerOpen`; and MUST contain the exact gate `visible={showFriendsModal && !anyFriendsChildOpen}` (adversarial: MUST NOT contain bare `visible={showFriendsModal}`).
- **INV-3 (PairRequestModal self-gates):** `PairRequestModal.tsx` MUST contain `visible={visible && !showCountryPicker}` (comment-stripped) AND MUST NOT contain a bare `visible={visible}` (the pre-fix ungated sheet).

**Fails-on-revert proof (Step 0.5, run BEFORE writing the fix):** execute the gate against the current buggy tree → INV-1 fails (AddFriendView renders `<CountryPickerModal>` at `:526`) and INV-3 fails (PairRequestModal sheet is `visible={visible}` at `:312`). After the fix → all INV pass. Reverting any of §4A/§4B(gate)/§4C re-fails a specific INV. Wired PR-blocking so a future revert cannot merge green. Append-only.

### Secondary — protective comments
The replacement comment in `AddFriendView.tsx` (A-1) and a one-line comment on the `ConnectionsPage` sibling picker (B-7) and the `PairRequestModal` gate (C-1) must each state the "why" (iOS one-modal-at-a-time; subtract-before-adding; mirror `AccountSettings.tsx:638-683`) so a future editor does not re-nest the picker.

### Amend the stale local suite (NOT CI-gating, but must not lie)
`app-mobile/src/components/ui/__tests__/WaveCBatch3.test.mjs` currently ASSERTS the buggy structure and encodes the false rationale:
- `:230` `assert.match(c, /<CountryPickerModal\b/, "AF-2: country picker must stay CountryPickerModal …")` → CHANGE to assert the picker is NOT in AddFriendView: `assert.ok(!/<CountryPickerModal\b/.test(c), "AF-2 (ORCH-1371): picker HOISTED to ConnectionsPage — AddFriendView must NOT render <CountryPickerModal> (iOS co-present-with-sheet fix)")`.
- `:231` (no `<CountryPickerOverlay>`) — KEEP.
- Update the prose comment `:35-42` (and the AF section header) to drop the "Batch-4 precedent … stacks above the wrapInRNModal sheet" claim and state the picker is now hoisted + gated.
- Verify the CP block still passes: `CP-2` `:194` `!/<Modal\b/.test(c)` — the new `<CountryPickerModal` token does NOT match `/<Modal\b/` (the `<` is followed by `C`, not `M`), so CP-2 stays green. `CP-1` `:191` (exactly one `<BaseBottomSheet>`) stays green (we add a `<CountryPickerModal>`, not a sheet). `CP-6` gate assertions stay green (gate string unchanged; we only add a disjunct inside `anyFriendsChildOpen`). Note: this suite is not wired into CI; the append-only test gate should bless the AF-2 amendment at CLOSE (see Open Questions Q2).

---

## 10. Open questions

- **Q1 (Android gate — resolved, stated for the tester):** the fix gates unconditionally (no `Platform.OS` branch), mirroring `AccountSettings`. This makes Android also drop+restore the friends/pair sheet around the picker. It is proven-safe (AccountSettings ships this on Android; the fullScreen picker hides the transition; state is hoisted). If the tester finds ANY Android visual regression (flicker on restore), the fallback is to guard the `anyFriendsChildOpen` disjunct / the PairRequest gate to `Platform.OS === "ios"` — but do this ONLY on evidence; the default contract is unconditional.
- **Q2 (append-only test gate):** amending `WaveCBatch3.test.mjs` AF-2 changes an existing assertion. Per `feedback_test_append_only_gate.md` this may need the append-only override token / orchestrator bless at CLOSE. The amendment is legitimate (the assertion pinned a provably-false structure). Flag at the CLOSE pre-commit check.
- **Q3 (reset scope):** B-5 resets `addFriendPhone` + `addFriendCountry` on Friends-modal reopen to preserve pre-1371 semantics (empty field + default country). If Seth prefers the newer "retain last typed across reopen" UX, drop the reset. Default = preserve old behavior (specified). No blocker either way.

None of the above block IMPLEMENT.

---

## 11. Downstream routing

- **Next → `mingla-implementor`** in this worktree (`~/Desktop/mingla-orchs/1371-[friend-country-picker-hidden]/` on `1371-friend-country-picker-hidden`). Build §4 in the §8 order; prove the §9 fails-on-revert guard; typecheck; live-fire iOS sim (SC-1/3/4/6/8) + physical Android no-regress (SC-2/5/7); write the implementation report.
- **Then → `mingla-tester`** — adversarial per §7 (esp. the leave-open angles + Android no-regression), source + runtime.
- **Then → `mingla-orchestrator` CLOSE** — flip `I-PROPOSED-1371-PICKER-NOT-COPRESENT-WITH-SHEET-MODAL` DRAFT→ACTIVE, bless the AF-2 append-only amendment, per-platform consumer OTA (never `--platform all`), COMMS entry, registry/World-Map sync, reap worktree.

### Scoped allowlist (implementor may modify ONLY these)
- `app-mobile/src/components/connections/AddFriendView.tsx`
- `app-mobile/src/components/ConnectionsPage.tsx`
- `app-mobile/src/components/PairRequestModal.tsx`
- `.github/scripts/strict-grep/orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs` (NEW)
- `.github/workflows/strict-grep-mingla-business.yml` (add one CI job)
- `.github/scripts/strict-grep/README.md` (register the gate)
- `app-mobile/src/components/ui/__tests__/WaveCBatch3.test.mjs` (amend AF-2 + prose only)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (add the DRAFT entry)

### DO-NOT-TOUCH (stop-and-amend before any change)
- `packages/phone-input/**` (shared package — no convergence, no overlay)
- `app-mobile/src/components/onboarding/CountryPickerModal.tsx` (thin wrapper — reuse as-is)
- `app-mobile/src/components/profile/AccountSettings.tsx` (reference control)
- `app-mobile/src/components/ui/BaseBottomSheet.tsx`
- `app-mobile/app.json`, `mingla-business/app.json` (version parity)
- Any business / buyer-web / admin file.

Anything outside the allowlist requires a `SPEC_AMENDMENT_ORCH-1371-1372_*.md` before editing — never silently widen.
