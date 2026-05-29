# IMPLEMENTATION — META-ORCH-0991 Wave B Batch 2 [Consumer modals → BaseBottomSheet]

**Skill:** mingla-implementor+claude
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/`
on branch `META-ORCH-0991-consumer-modals-to-sheets`
**Status:** implemented and verified (sim-proven on iPhone 17 Pro)

## Scope

Convert EXACTLY 3 profile/settings form modals from RN `<Modal>` to
`BaseBottomSheet`, stock gorhom motion, roll-up + swipe-down-close like
`ExpandedBusinessEventSheet`. No other modal touched. Consumer `app-mobile/` only.
No backend / migrations / edge / external APIs.

1. `app-mobile/src/components/profile/EditBioSheet.tsx`
2. `app-mobile/src/components/profile/EditInterestsSheet.tsx`
3. `app-mobile/src/components/profile/BillingSheet.tsx`

Confirmed against `INVESTIGATION_META-ORCH-0991_CONSUMER_MODALS_TO_SHEETS.md`:
BillingSheet (row 42, Wave B), EditInterestsSheet (row 44, Wave B), EditBioSheet
(row 43, classified Wave C for its textarea — operator placed it in this Batch 2
with the other two; treated as a keyboard-aware form sheet, identical contract).
NONE on the exclusion list.

## Operator-confirmed rule applied + codified

Seth, 2026-05-29: **destructive/irreversible confirms (block, delete, leave,
remove, unfriend, cancel-order, sign-out) are NON-swipe centered confirm cards
(`variant="center-dialog"`, no pan-down); everything else is a full swipe-down
`BaseBottomSheet`.** All 3 Batch-2 targets are non-destructive forms → all full
swipe-down sheets. Rule codified in the playbook §1 (operator-confirmed banner)
and asserted by regression test T-6 (none may be a center-dialog).

## Comms ledger

Scanned on entry. No OPEN BLOCK targets mingla-implementor / META-ORCH-0991 /
ALL. The OPEN WARN rows (COMMS-0002 backend strict-grep allowlist, COMMS-0003
external-API docs) are N/A — zero backend/edge/migration files and zero external
APIs touched. COMMS-0006/0010 are other-ORCH and already ACKNOWLEDGED/RESOLVED.
No new cross-ORCH discovery to write.

## Key architecture finding — why all 3 wrap in RN Modal

`ProfilePage` renders inside the page `<View>` in `app-mobile/app/index.tsx`,
while `GlassBottomNavWithCoach` (the floating glass tab bar) renders as a LATER
SIBLING in the same tree (higher z-order). An unwrapped `BaseBottomSheet` floats
absolutely in-tree and would render UNDER that floating nav. The original RN
`<Modal>`s used a separate OS window precisely to z-stack over it. So all three
sheets use `wrapInRNModal` (true). Sim-confirmed: each sheet covers the tab bar
when open. (This is the §4 z-order trap; "top-level screen → don't wrap" only
holds when the screen's sheet already clears the nav — here it doesn't.)

---

## Old → New Receipts

### `app-mobile/src/components/profile/EditBioSheet.tsx`
**Before:** RN `<Modal transparent animationType="slide">` → `Pressable` backdrop
(`rgba(0,0,0,0.5)` flex-end scrim) → `KeyboardAwareView` → `Pressable` white
rounded-top card (header + raw RN `<TextInput>` multiline bio + counter + Save).
**Now:** `<BaseBottomSheet theme="light" enableDynamicSizing scrollMode="view"
wrapInRNModal keyboardBehavior="interactive" keyboardBlurBehavior="restore"
android_keyboardInputMode="adjustResize">`. Header → `header` prop; textarea +
counter + Save → `children`. Raw `<TextInput>` → `<BottomSheetTextInput>` (same
props). Dropped `Modal`/`TextInput`/`Pressable` imports, the `KeyboardAwareView`
import + wrapper, and the `backdrop`/`keyboardView`/`card` scrim/card styles.
**Why:** compact bio textarea form — becomes a true swipe-down sheet; the field
needs gorhom keyboard coordination so it isn't covered; opened over the floating
tab bar needs z-stacking.
**Snap:** `enableDynamicSizing` (content-height — preserves the prior compact
flex-end feel; don't force a tall snap). **Keyboard:** yes. **wrapInRNModal:** true.
**Lines changed:** ~55.

### `app-mobile/src/components/profile/EditInterestsSheet.tsx`
**Before:** RN `<Modal transparent animationType="slide">` → `Pressable` backdrop
(flex-end scrim) → `Pressable` white card capped at `maxHeight:'85%'` (header +
`ScrollView` of intent/category chips + Save footer).
**Now:** `<BaseBottomSheet theme="light" snapPoints={['85%']} scrollMode="scroll"
wrapInRNModal>`. Header → `header`; chip sections → scroll body (`children`,
`scrollProps={{ showsVerticalScrollIndicator:false }}`); Save → `stickyFooter`.
Dropped `Modal`/`ScrollView`/`Pressable` imports and the `backdrop`/`card`
scrim/card styles. Chip JSX, haptics, `hasChanged` dirty logic, `onSave` callback
byte-identical.
**Why:** chips picker capped at 85% → a true swipe-down sheet at the same height;
no text input so not keyboard-aware (Wave B).
**Snap:** `['85%']` (== prior `maxHeight:'85%'`). **Keyboard:** no.
**wrapInRNModal:** true. **Lines changed:** ~40.

### `app-mobile/src/components/profile/BillingSheet.tsx`
**Before:** RN `<Modal transparent animationType="slide">` → `View` overlay
(flex:1 scrim) → top `Pressable` tap-strip sized `windowHeight*0.08` → `View`
sheet (`flex:1`, `#f9fafb`, rounded top, **cosmetic non-draggable** `dragHandle`)
→ header + `ScrollView` (loading | error | current-plan card + tier cards +
restore) + nested `CustomPaywallScreen`.
**Now:** `<BaseBottomSheet theme="light" snapPoints={['92%']} scrollMode="scroll"
wrapInRNModal backgroundStyle={styles.sheetBackground}>`. Header → `header`; the
loading/error/populated content → scroll body (`children`, `scrollProps` carries
`contentContainerStyle` + `paddingHorizontal` + `keyboardShouldPersistTaps`); the
nested `CustomPaywallScreen` (its own RN `<Modal>`, excluded surface) stays in
`children` and floats independently. Dropped `Modal`/`ScrollView`/`Pressable`/
`useWindowDimensions`/`useMemo` imports and the `overlay`/`sheet`/`dragHandle`
styles + the `overlayTapStyle`/`SHEET_TOP` plumbing. Real gorhom handle replaces
the cosmetic one; pan-down + backdrop-press replace the top overlay tap-strip.
All tier config, CTA helpers, `CurrentPlanCard`/`TierCard`, restore/manage/paywall
handlers, i18n keys, analytics, and styling byte-identical.
**Why:** near-fullscreen detail sheet with a fake drag handle → a true swipe-down
sheet at the same ~92% height with a real handle.
**Snap:** `['92%']` (== prior `flex:1` from `windowHeight*0.08`). **Keyboard:** no.
**wrapInRNModal:** true. **Lines changed:** ~45.

---

## Cross-surface impact (Step 3.5)

- **Consumer iOS / Android** (`app-mobile/`): affected — the 3 profile sheets now
  present as bottom sheets. Parity automatic (shared RN code path; same component
  both platforms).
- **Buyer/anon Web, Business iOS/Android, Admin Web, Business Web preview:** NOT
  affected — these are consumer-app profile/settings surfaces with no analog on
  those surfaces.

Count >1 but parity automatic (single RN code path) — no manual drift to register.

## Spec / contract traceability

| Conversion-contract criterion | Result | Evidence |
|---|---|---|
| RN `<Modal>` shell → `<BaseBottomSheet>` | PASS | All 3; no `<Modal>` survives (test T-2). |
| Stock gorhom motion (no custom animation) | PASS | No `animationConfigs`; primitive untouched this batch. |
| Snap height suits content (not forced 90%) | PASS | Bio=dynamic, Interests=['85%'], Billing=['92%']. |
| Forms keyboard-usable (BottomSheetTextInput) | PASS | Bio field typed with keyboard up; field + counter + Save all visible (screenshot 03). |
| `wrapInRNModal` over the floating tab bar | PASS | All 3 = true; each sim-confirmed to cover the tab bar (screenshots 02/05/08). |
| Android back + backdrop-press close | PASS (mechanism) | Wrapped sheets get `onRequestClose` (back) + backdrop `pressBehavior="close"` from the primitive. Swipe-down close sim-verified all 3. |
| Behavior/props/copy/analytics/styling preserved | PASS | Only containers swapped; dirty-state + haptics + save callbacks intact (Interests chip → Save enabled, screenshot 06). |
| Rolls up + swipe-down-close like events sheet | PASS | Open screenshots 02/05/08 + swipe-close 04/07/09. |

## Sim verification (iPhone 17 Pro, UDID 17091E60-C3B6-4167-980D-60C348E177F6, Metro :8100)

Driver: Maestro 2.5.1 (operator-mandated; no osascript). Latest JS bundle loaded
via app relaunch against Metro :8100 before testing. Screenshots in
`Mingla_Artifacts/reports/screenshots/batch2/`.

- **EditBioSheet** — Profile → tap bio text "Love to travel and explore": rolls up
  as a content-height sheet with gorhom handle, rounded top, scrim, "Edit Bio"
  header + X, textarea + "26/160" counter, disabled Save (unchanged).
  `02_editbio_open.png`. Tapping the field raises the keyboard; the sheet rolls up
  with it and the field + counter + Save stay fully visible (typed " and find
  great spots" → "47/160", Save enabled). `03_editbio_keyboard.png`. Swipe-down
  dismisses back to Profile, bio unchanged. `04_editbio_after_swipe.png`.
- **EditInterestsSheet** — Profile → "Edit your interests" pencil: rolls up to 85%
  with handle, rounded top, scrim, "Edit Interests" header + X, intent + category
  chip sections (selected chips colored), pinned disabled Save.
  `05_editinterests_open.png`. Tapping "Adventurous" selects it (haptic) and
  enables Save (solid orange) — dirty logic intact. `06_editinterests_selected.png`.
  Swipe-down dismisses, interests unchanged. `07_editinterests_after_swipe.png`.
- **BillingSheet** — Profile → scroll to Account card → "Billing" row: rolls up to
  92% with handle, rounded top, `#f9fafb` canvas, "Your Plan" header + X, current
  plan card (Mingla+), "Compare plans" Free + Mingla+ tier cards (Current badge,
  perks, Manage Subscription CTA), Restore purchases link. Populated state renders
  correctly. `08_billing_scroll.png`. Swipe-down dismisses back to the Account
  card. `09_billing_after_swipe.png`.

No orphaned entry points — all 3 have live UI triggers (no temp `useState` flips
needed; working tree clean throughout).

## Regression Test (mandatory gate)

- **Path:** `app-mobile/src/components/ui/__tests__/WaveBBatch2.test.mjs`
- **Run (fixed code):** `node …/WaveBBatch2.test.mjs` → `PASS … (EditBio +
  EditInterests + Billing → BaseBottomSheet)`, exit 0.
- **Fails-on-revert:** `git stash push` of the 3 modals (keeping the test +
  primitive) → re-run → AssertionError on T-1, **exit 1**. `git stash pop` →
  re-run → exit 0. Verified at anchor commit
  `6c5328aae197e08864553894f68fc50ad6f2f9b1` (HEAD before this batch).
- **Coverage:** T-1 each consumes BaseBottomSheet + imports no gorhom; T-2 no raw
  `<Modal>`/`Modal` import survives; T-3 Bio = enableDynamicSizing + keyboardBehavior
  + BottomSheetTextInput + wrapInRNModal + no raw TextInput; T-4 Interests = ['85%']
  + wrapInRNModal; T-5 Billing = ['92%'] + wrapInRNModal; T-6 none is a
  center-dialog (operator rule — forms must be swipe-down). **Adversarial T-A1:**
  old scrim/card style keys GONE — `backdrop`/`card` (Bio+Interests),
  `overlay`/`sheet`/`dragHandle` (Billing) — catches a "nested the sheet inside the
  old overlay" half-migration AND proves the Billing cosmetic handle was replaced.
- Locked Wave-A `BaseBottomSheet.test.mjs` + Batch-1 `WaveBBatch1.test.mjs` both
  still PASS (no primitive change this batch).

## Gates

- **tsc:** `npx tsc --noEmit` from `app-mobile/` → 244 errors, **identical to the
  pre-change baseline** (verified via `git stash` compare: 244 with changes, 244
  without). Zero new errors; zero in any touched file.
- **strict-grep:** `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs` self-test
  PASS + live scan OK (409 files; BaseBottomSheet still the sole `@gorhom/bottom-sheet`
  importer — the 3 consumers import the primitive + its `BottomSheetTextInput`
  re-export, never gorhom).
- **Lint:** no lint script configured in app-mobile; tsc strict covers types.

## Invariants

- `I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER` — PRESERVED (gate green).
- `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` (ORCH-0828) — PRESERVED (no
  provider/portal added; primitive untouched).
- ORCH-0696 token mandate — PRESERVED (chrome from the primitive's light theme;
  Billing uses an explicit per-surface `backgroundStyle` parity override for its
  `#f9fafb` canvas, matching the prior sheet color).

## Cache / parity / state

No React Query keys, Zustand, or persisted state touched. BillingSheet's
subscription hooks/queries are unchanged (only the container swapped). Solo/collab
N/A. Pure client-UI container swap.

## Regression surface (for tester)

1. EditBioSheet save path — `handleSaveBio` → `authService.updateBio` still fires
   on Save (callback unchanged; verify a real save persists).
2. EditInterestsSheet save path — `handleSaveInterests(intents, categories)`
   callback unchanged; verify save persists both arrays.
3. BillingSheet upgrade flow — `handleChangePlan` → `CustomPaywallScreen` (excluded
   surface) opens over the sheet; verify the nested paywall still presents and
   dismisses (it is its own RN Modal).
4. BillingSheet loading/error states — only the populated state was sim-exercised;
   verify the loading spinner + error card + retry still render inside the scroll
   body (they were moved verbatim into `children`).
5. Android: hardware-back + keyboard adjustResize on EditBioSheet (verified by
   mechanism — wrapped sheet `onRequestClose` + `android_keyboardInputMode`;
   recommend an Android-emulator pass at TEST).

## Discoveries for orchestrator

- None new. (EditBioSheet was investigation-classified Wave C for its textarea but
  was dispatched in this Batch 2; handled as a keyboard-aware form sheet — same
  contract as Batch-1's ReportUserModal. No scope change.)

## Transition items

None.
