# Wave B Conversion Playbook — META-ORCH-0991 [Consumer modals → bottom sheets]

**Audience:** any implementor converting the remaining Wave B / Wave C `app-mobile/`
modals from RN `<Modal>` to `BaseBottomSheet`.
**Goal:** make the remaining ~23 conversions mechanical, consistent, and gate-clean.
**Proven by:** Wave B Batch 1 (BlockUserModal, ReportUserModal, FriendRequestsModal),
sim-verified on iPhone 17 Pro 2026-05-29.

The shared primitive is `app-mobile/src/components/ui/BaseBottomSheet.tsx`. Read its
prop table once — every decision below maps to a prop on it. Motion is **stock gorhom
default** (the primitive passes NO `animationConfigs`); never add a custom spring.

---

## 0. The hard gate you must not trip

`I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER`
(`.github/scripts/strict-grep/meta-orch-0991-base-bottom-sheet-sole-consumer.mjs`):
**`BaseBottomSheet.tsx` is the ONLY file under `app-mobile/src/` allowed to
`import ... from '@gorhom/bottom-sheet'`.**

- Need `BottomSheetTextInput`, `BottomSheetScrollView`, etc. in a consumer? **Import it
  from `BaseBottomSheet`, not from gorhom.** The primitive re-exports
  `BottomSheetTextInput` (added in Batch 1). If you need another gorhom export, add a
  one-line re-export to the primitive — do not import gorhom in the consumer.
- The gate matches import *statements*, not comments, so prose mentions are fine.
- Run before commit: `node .github/scripts/strict-grep/meta-orch-0991-base-bottom-sheet-sole-consumer.mjs`
  (and `--self-test`).

---

## 1. Pick the variant: sheet vs center-dialog

> **OPERATOR-CONFIRMED RULE (Seth, 2026-05-29):** **destructive / irreversible
> confirms (block, delete, leave, remove, unfriend, cancel-order, sign-out, etc.)
> are NON-swipe centered confirm cards (`variant="center-dialog"`, no
> pan-down-to-dismiss) so they can't be flicked away by accident. EVERYTHING ELSE
> is a full swipe-down `BaseBottomSheet`.** This was previously the investigation
> §2 "footgun" recommendation; it is now a hard, operator-confirmed rule for all
> remaining Wave B / Wave C conversions.

| If the modal is… | Use | Why |
|---|---|---|
| A **destructive / irreversible confirm** (block, delete, leave, remove, unfriend, cancel-order, sign-out) | `variant="center-dialog"` | A confirm you can flick away by accident is a footgun (operator-confirmed 2026-05-29). Center-dialog = centered card, NO pan-down, RN-Modal-backed (z-stacks + Android back for free). |
| A **form, list, picker, detail, or action menu** (everything else) | default (`variant="sheet"`) | Rolls up + swipe-down-to-dismiss like the events sheet. |

Center-dialog needs almost nothing: `visible`, `onClose`, `theme`, `accessibilityLabel`,
children. It supplies scrim + card + radius + padding + shadow from `glass.centerDialog`.
**Strip the consumer's own scrim/overlay/card-background/padding** — make the inner
`container` a transparent passthrough (`{ width: '100%' }`) so chrome doesn't double up.

---

## 2. Pick the snap height (sheet variant only) — by content type

Pass `snapPoints={[...]}` as a module-level const. Match the OLD modal's height; do not
force 90%.

| Content type | Snap | Rationale |
|---|---|---|
| Short confirm / 1–2 field form that was a centered card | `enableDynamicSizing` (content-height) **or** `['50%']`/`['60%']` | Opens compact; don't waste screen. |
| Medium form (was `minHeight: 90–95%` / `flex-end`) | `['90%']` | Preserves the prior tall-form feel (ReportUserModal). |
| List / feed (was a fixed `SCREEN_HEIGHT * 0.8x` card) | match it: `['88%']`, or `['50%','90%']` for a preview→full gesture | FriendRequestsModal was `0.88` → `['88%']`. NotificationsSheet-class feeds can use the two-stop token `glass.bottomSheet.snapPoints`. |
| Full detail (events/place card) | `glass.bottomSheet.snapPoints` `['50%','90%']`, `initialIndex={1}` | The events-sheet pattern. |

**Rule of thumb:** read the old style's `height` / `minHeight` / `justifyContent` and
translate it. `flex-end` + `minHeight:'95%'` → `['90%']`. Fixed `height: H*0.88` → `['88%']`.
Centered → center-dialog (no snap).

---

## 3. Keyboard handling (any sheet with a text input)

A raw RN `<TextInput>` inside a gorhom sheet does **not** coordinate with the keyboard and
gets covered. For every form sheet:

1. `import { BaseBottomSheet, BottomSheetTextInput } from '.../ui/BaseBottomSheet'`.
2. Swap **every** `<TextInput>` → `<BottomSheetTextInput>` (same props work).
3. On `<BaseBottomSheet>` set:
   - `keyboardBehavior="interactive"`
   - `keyboardBlurBehavior="restore"`
   - `android_keyboardInputMode="adjustResize"`
4. Remove the `TextInput` import from `react-native`.

Verified in Batch 1: ReportUserModal's details field stays usable with the keyboard up
(sheet rolls to full, field accessible, 41/500 chars typed and read back).

---

## 4. `wrapInRNModal` — when to z-stack over the tab bar

`BaseBottomSheet` floats absolutely in-tree. Whether you need the RN-Modal wrap
(ORCH-0908) depends ONLY on where the sheet is mounted:

| Mounted from… | `wrapInRNModal` | Example |
|---|---|---|
| Deep in the deck/chat tree, **over the custom tab bar or chat input** | `wrapInRNModal` (true) | ReportUserModal (opened from the chat more-menu / FriendActionsSheet / ConnectionsPage). |
| **High in the tree** (HomePage, profile root, a screen whose sheet already clears the tab bar) | omit (false) | FriendRequestsModal (HomePage), NotificationsSheet. |
| `center-dialog` variant | N/A | It is RN-Modal-backed already — z-stacks automatically. |

How to decide fast: find every caller (`grep -rn ComponentName app-mobile/src`). If a
caller is inside a chat / deck / another sheet that sits over the tab bar → wrap. If the
only caller is a top-level screen → don't. When unsure, sim-test both: a wrapped sheet
that should be unwrapped looks fine; an unwrapped sheet that needed wrapping renders
*under* the tab bar (you'll see it).

---

## 5. Body composition — header / scroll body / sticky footer

Map the old layout onto the primitive's slots instead of hand-rolling containers:

- **Fixed top bar** (title, close X, drag-handle area) → `header={<View>…</View>}`. Drop
  any hand-rolled drag handle; the primitive renders the real gorhom handle.
- **Scrolling middle** → the `children`, with `scrollMode="scroll"` (or `"sectionlist"` /
  `"flatlist"` for lists — never a raw RN `ScrollView`/`FlatList` inside a sheet).
  Pass list/scroll props via `scrollProps`.
- **Pinned bottom bar** (submit/cancel, disclaimer, footer note) → `stickyFooter={…}`.
  It stays above the keyboard. Footer can be conditional (e.g. `undefined` while loading).
- For `view` mode the consumer owns the whole container tree (use for keystone sheets).

---

## 6. Preserve-behavior checklist (run for EVERY conversion)

Only the **container** changes. Confirm each before commit:

- [ ] All inner JSX, copy (i18n keys), and styling of the content are byte-identical.
- [ ] All callbacks/props/`onConfirm`/`onReport`/accept-decline handlers unchanged.
- [ ] **Dismiss analytics fire on `onClose`, never on a button handler** — pan-down and
      backdrop-press route through `onChange(-1)` → `onClose`, so any
      `track*Dismissed`/close event must live in `onClose` or it won't fire on swipe.
      (Audit: does the old modal track anything on close?)
- [ ] Loading / empty / error / submitting states still render (move them into `children`).
- [ ] Removed the raw `<Modal>` AND its `Modal` import from `react-native`.
- [ ] Removed dead styles: old `overlay`/`sheetOverlay`/`backdropTouch`/`modalContainer`/
      `sheetContent`/cosmetic `dragHandle*`. (These are the adversarial test's tripwires.)
- [ ] If it had a `if (!isOpen) return null` early-return, you can keep it OR let `visible`
      drive the sheet (the latter animates the close; the former is fine when the parent
      conditionally mounts the component).
- [ ] `theme` chosen: `'light'` (default, `glass.notificationsSheet`) vs `'dark'`
      (`glass.bottomSheet`, e.g. TM/business event surfaces).
- [ ] `accessibilityLabel` set on the sheet.
- [ ] Android hardware-back closes (primitive wires `BackHandler` for unwrapped sheets and
      `onRequestClose` for wrapped/center-dialog — free, just verify it closes).

---

## 7. Verify (mandatory per repro rule)

For each modal, on a booted sim via the worktree's Metro:

1. Open it through the real UI → confirm it rolls up like the events sheet.
2. Swipe it down → confirm it dismisses and `onClose` fires once (no double-fire,
   no stuck backdrop).
3. Form sheets: select state that reveals the input, tap it, type → confirm the keyboard
   does not cover the field (and read the value back from `maestro hierarchy`).
4. Screenshot each state.
5. **Orphaned entry points:** if a modal has no live UI trigger (grep finds the
   `setShow…(true)` is never called), temporarily flip its `useState` seed to `true` for
   the sim run, screenshot, then `git checkout --` the file. NEVER commit the temp flip.

Tooling: Maestro only (`~/.maestro/bin/maestro --device <UDID>`). Never `osascript`.
Tap option cards by their `accessibilityText` (e.g. `"Spam, Unwanted or repetitive
messages"`) when a short label substring won't match. Reload via Fast Refresh (edit +
save reaches the sim through Metro); no rebuild needed for JS-only changes.

---

## 8. Gates before commit

- `npx tsc --noEmit` from `app-mobile/` → 0 NEW errors vs the baseline (Batch 1 baseline
  was 244 pre-existing; confirm your diff adds none via a `git stash` baseline compare).
- Strict-grep sole-consumer gate green (§0).
- A regression test under `app-mobile/src/components/ui/__tests__/` (structural — the
  gorhom host isn't mountable in the harness): assert the modal imports BaseBottomSheet,
  renders `<BaseBottomSheet>`, no raw `<Modal>`/gorhom import survives, the chosen
  snap/variant/wrapInRNModal is correct, plus one adversarial assertion (old scrim styles
  gone). **Verify fails-on-revert** (`git stash` the modal changes → test must exit 1).
- Commit message: `META-ORCH-0991 Wave B: convert <Modal> → BaseBottomSheet`.

---

## 9. Batch 1 decision record (reference examples)

| Modal | Variant | Snap | Keyboard | wrapInRNModal | Notes |
|---|---|---|---|---|---|
| BlockUserModal | center-dialog | — | no | n/a (auto) | Block confirm = footgun rule. Stripped local scrim/card. |
| ReportUserModal | sheet | `['90%']` | yes (BottomSheetTextInput + interactive) | **true** | Opened over chat. header + scroll body + sticky footer (actions + disclaimer). |
| FriendRequestsModal | sheet | `['88%']` | no | **false** | Mounted high from HomePage. Real handle replaces cosmetic one. header + list + sticky footer. |

## 10. Batch 2 decision record (profile/settings form cluster)

All three mount from `ProfilePage`, which renders INSIDE the page `<View>` while the
floating `GlassBottomNav` renders as a LATER sibling in the same tree — so an
unwrapped sheet renders *under* the floating tab bar. **All three therefore use
`wrapInRNModal` (true)** to z-stack above it (sim-confirmed: each sheet covers the
tab bar). This is the same z-order trap §4 describes; "mounted from a top-level
screen → don't wrap" only holds when that screen's sheet already clears the nav.
None are destructive → all full swipe-down sheets (operator rule §1).

| Modal | Variant | Snap | Keyboard | wrapInRNModal | Notes |
|---|---|---|---|---|---|
| EditBioSheet | sheet | `enableDynamicSizing` (content-height) | **yes** (BottomSheetTextInput + interactive) | **true** | Was a compact flex-end card. header + view body + footer save. Dropped `KeyboardAwareView` (gorhom owns keyboard). |
| EditInterestsSheet | sheet | `['85%']` | no | **true** | Was `maxHeight:'85%'` flex-end card → ['85%']. header + scroll chip body + sticky footer save. |
| BillingSheet | sheet | `['92%']` | no | **true** | Was `flex:1` from `windowHeight*0.08` (≈92%) with hand-rolled drag handle + top overlay tap-strip → ['92%'] + real gorhom handle + pan-down/backdrop close. header + scroll body. Nested CustomPaywallScreen is its own RN Modal (excluded) and floats independently. |
