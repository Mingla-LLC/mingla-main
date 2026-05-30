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

> **HARD LESSON (Batch 3, re-confirmed Batch 4):** **content-height /
> `enableDynamicSizing` can render a sheet OFF the bottom of the screen** — gorhom
> measures the children below the viewport (especially inside the `wrapInRNModal`
> window) and snaps to a y-offset that's partly or fully off-screen. **Prefer an
> explicit fixed snap height** (`['40%']` / `['45%']` / `['55%']` / `['85%']` / `['88%']`
> as fits the content, translated from the old modal's `maxHeight`/`SCREEN_HEIGHT*`)
> over content-dynamic sizing, UNLESS you have sim-confirmed the dynamic sheet renders
> fully on-screen. When in doubt, fixed snap. Every Batch-4 sheet used a fixed snap and
> all six harness-mounted sheets rendered fully on-screen.

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

## 11. Batch 4 decision record (pairing / custom-holiday / scheduling cluster)

Two of the seven are pure destructive/irreversible CONFIRM cards → NON-swipe
`variant="center-dialog"` (operator rule §1). Two of the sheets are keyboard-aware.
ProposeDateTimeModal was a HAND-ROLLED Animated slide-up (not an RN `<Modal>` sheet) —
the custom slide/backdrop springs were deleted for stock gorhom motion. Every sheet
used a FIXED snap per the §2 off-screen lesson (sim-confirmed on-screen).

| Modal | Variant | Snap | Keyboard | wrapInRNModal | Notes |
|---|---|---|---|---|---|
| PairRequestModal | sheet | `['85%']` | **yes** (×2 inputs) | **true** | Was flex-end `maxHeight:'85%'`. header + scroll body. Mounted from ConnectionsPage (renders before the floating GlassBottomNav sibling) → wrap. Kept excluded `CountryPickerModal` sub-modal as a fragment sibling (BillingSheet precedent). |
| IncomingPairRequestCard | **center-dialog** | — | no | n/a (auto) | Accept/decline confirm. Stripped scrim/backdrop/card + scale-fade spring → glass.centerDialog. Busy/success dismiss-guard preserved (handleClose no-ops while busy/success). |
| PairingInfoCard | **center-dialog** | — | no | n/a (auto) | Cancel-pairing confirm. Stripped scrim/card + spring. |
| CustomHolidayModal | sheet | `['88%']` | **yes** (name) | **true** | Was flex-end `SCREEN_HEIGHT*0.88`. header + scroll body. Inner year/month/day pill pickers stay horizontal `<ScrollView>` (orthogonal to the sheet pan — sideways scroll is fine; only a VERTICAL raw list fights the pan). ViewFriendProfileScreen over the nav → wrap. |
| ProposeDateTimeModal | sheet (dark) | `['85%']` | no | **true** | Was a HAND-ROLLED Animated slide-up. Custom slide/backdrop springs DELETED → stock gorhom. header + scroll body + **stickyFooter** (ProposeDateTimeFooter). Dark `#1C1C1E` via backgroundStyle. iOS date+time pickers now each in their OWN RN `<Modal>` so they float ABOVE the sheet's wrapInRNModal window (were absolute overlays inside the single old Modal). Android native pickers unchanged. |
| TicketPdfSheet | sheet (dark) | `['88%']` | no | **true** | Was flex-end `maxHeight:'88%'`. `scrollMode="view"` (consumer owns the body) because the QR carousel is a HORIZONTAL paging `<ScrollView>` that must keep paging — do NOT convert a horizontal paging carousel to BottomSheetScrollView. Bespoke `#15181f`/topRadius 28 via backgroundStyle. |
| ActionButtons (iOS picker ONLY) | sheet (light) | `['45%']` | no | **true** | ONLY the iOS date/time `<Modal>` (~line 656). `scrollMode="view"`, header = title + Cancel/Back-to-date/Next-or-Done (TrackedTouchableOpacity analytics preserved), DateTimePicker spinner as body. Android `display="default"` branch + the rest of ActionButtons UNTOUCHED → expect exactly ONE `<BaseBottomSheet>` in the file. ExpandedCard over the tab bar → wrap. |

**Two patterns worth reusing:**
- **OS pickers above a wrapInRNModal sheet:** when a sheet contains/launches a native
  date/time picker AND the sheet is `wrapInRNModal`, each picker overlay must be its own
  RN `<Modal>` (not an in-tree absolute View) so it z-stacks above the sheet's OS window.
  (ProposeDateTimeModal did this for both pickers.)
- **Horizontal paging carousel inside a sheet:** use `scrollMode="view"` and keep the raw
  horizontal `<ScrollView pagingEnabled>` — the "no raw list inside a sheet" rule targets
  VERTICAL lists that fight the pan gesture; a horizontal pager is orthogonal and safe.
  (TicketPdfSheet.)

## 12. Batch C-1 decision record (search / keyboard-list cluster)

The first Wave-C cluster: search/keyboard sheets. All non-destructive → full
swipe-down sheets. All mount over the floating tab bar / Discover nav / inside
chat → **wrapInRNModal**. Stock gorhom motion. **3 of the 4 dispatched targets
shipped; PreferencesSheet hit a hard gorhom-scroll blocker (see below).**

| Modal | Variant | Snap | Keyboard | Body mode | wrapInRNModal | Notes |
|---|---|---|---|---|---|---|
| CreateGroupChatSheet | sheet (light) | `['90%']` | **yes** (name + search inputs) | `scroll` (header + `BottomSheetScrollView` body + **stickyFooter** Create button) | **true** | Was flex-end `maxHeight:'85%'` RN `<Modal>`. The friend list is a `.map`, not a long FlatList — fine in the scroll body. `availableFriends.length > 3` search-field gate preserved. Restores the old `accessibilityViewIsModal` focus-trap (via the RN-Modal wrap). Sim-verified: roll-up, keyboard never covers name field / footer, selection toggles + Create enables, swipe-close. |
| FriendPickerSheet | sheet (light) | `['88%']` | **yes** (search) | **`flatlist`** (long friend results → `BottomSheetFlatList`; loading/no-friends/no-results states are the FlatList `ListEmptyComponent`; header = title+close+search via `ListHeaderComponent`) | **true** | Was height `'88%'` RN `<Modal>` with a raw RN `<FlatList>` + the hand-rolled `useKeyboard` footer-padding hack (both DELETED — gorhom owns keyboard + the list). **Orphaned entry point** (`setFriendPickerVisible(true)` is never called in ConnectionsPage) — sim-verified by a TEMP `useState(true)` flip, screenshotted, then `git checkout --` (never committed; playbook §7.5). Sim-verified: roll-up, keyboard never covers search/results, live filter ("Ava" → 1 result), swipe-close. |
| CityPickerSheet | sheet (**dark**) | `['90%']` | **yes** (autoFocus search) | `scroll` (header + status/results body) | **true** | Was an RN `<Modal>` + a hand-rolled `KeyboardAvoidingView` lifting a `flex:1` sheet (DELETED — gorhom owns keyboard). Bespoke dark canvas `rgba(20,22,26,0.98)` + topRadius 24 preserved via `backgroundStyle`. `autoFocus` + 250ms autocomplete debounce + all status rows preserved. Mounted on Discover before the floating GlassBottomNav (same z-trap as the Batch-5 Night Out filter). Sim-verified: roll-up, autoFocus, keyboard never covers field/results, live Google-Places filter ("Brooklyn" → 5 results), swipe-close. |
| **PreferencesSheet** | sheet (light) | `['90%']` | **yes** (×2 inputs) | **direct-child `scroll`** (title + 5 sections + Apply/Reset row are ALL direct children of the bare `BottomSheetScrollView`; NO `header`/`stickyFooter` slots) | **true** | REBUILT 2026-05-29. The first overflowing-body sheet — exposed that the `header`/`stickyFooter` slots break gorhom scroll on overflow (root cause in the HARD LESSON below). Fixed by rendering header/body/footer as direct scroll children; the two nested fields → `BottomSheetTextInput`, suggestions dropdown → `BottomSheetScrollView`. Legacy inline full-screen path (visible undefined) preserved with `KeyboardAwareScrollView`. Cream `#fff9f5` canvas via `backgroundStyle`. Sim-verified: all 5 sections scroll, Apply reachable + applies + closes, swipe-down close. ZERO primitive changes. |

**Pattern worth reusing — search/keyboard-list sheet:**
- **Long VERTICAL result list → `scrollMode="flatlist"`** with the data/renderItem/
  keyExtractor passed via `scrollProps`, the search header as the implicit
  `ListHeaderComponent` (the primitive uses `header ?? children`), and the
  loading/empty/no-results states as `scrollProps.ListEmptyComponent`. This keeps
  the list scroll coordinated with the sheet pan and avoids a raw RN `<FlatList>`.
  (FriendPickerSheet.)
- **Short `.map` result list → `scrollMode="scroll"`** (the `.map` rows ride the
  `BottomSheetScrollView`); swap every `<TextInput>` → `<BottomSheetTextInput>`,
  set `keyboardBehavior="interactive"` + `keyboardBlurBehavior="restore"` +
  `android_keyboardInputMode="adjustResize"`, and DROP any hand-rolled
  `KeyboardAvoidingView` / `useKeyboard` padding hack — gorhom owns keyboard
  coordination once the field is a `BottomSheetTextInput`. (CreateGroupChatSheet,
  CityPickerSheet.)

> **HARD LESSON (Batch C-1, RESOLVED 2026-05-29) — a tall scrolling body must be
> a DIRECT child of `scrollMode="scroll"`; the `header`/`stickyFooter` slots
> break gorhom scroll when the body OVERFLOWS.** PreferencesSheet was the first
> converted sheet whose body genuinely overflows its snap height, and it exposed
> a real limitation. The prior batch's 4 attempts all failed because they used
> the primitive's `header` (and/or `stickyFooter`) slot.
>
> **ROOT CAUSE (sim-proven on iPhone 17 Pro, controlled isolation):** gorhom's
> `BottomSheetScrollView` only scrolls when it is a **DIRECT child of
> `<BottomSheet>`**. `BaseBottomSheet`'s `header` slot (scroll+header path,
> BaseBottomSheet.tsx ~394-401) and `stickyFooter` slot (~362-368) both wrap the
> scrollable inside an intermediate flexed `<BottomSheetView>`. That intermediate
> view makes the scrollview a non-direct descendant, so gorhom never hands the
> content-pan off to the scrollview — every drag is treated as a sheet-pan and an
> overflowing body will not move (only swipe-down-to-close works). Proof: a body
> of 40 dummy `<Text>` rows scrolled cleanly as the BARE direct child of
> `scrollMode="scroll"`, but stuck the moment ONLY `header={...}` was added back;
> Animated.View sections, wrapInRNModal, GestureHandlerRootView, and the paywall
> child were each ruled OUT by live sim edits.
>
> **THE FIX (reuse this for any overflowing-body sheet):** render the title, the
> scrolling sections, AND the pinned-looking footer as **DIRECT children** of
> `scrollMode="scroll"` (the bare `BottomSheetScrollView`). Do NOT use the
> `header` or `stickyFooter` slots on such a sheet. The title + CTA scroll WITH
> the content (acceptable; the old RN-Modal sheet scrolled them too). Set the
> per-surface canvas via `backgroundStyle` (not `bodyContainerStyle`, which feeds
> the slot wrapper). Also migrate any nested `<TextInput>` →
> `<BottomSheetTextInput>` and any nested vertical `<ScrollView>` →
> `<BottomSheetScrollView>` (both re-exported from `BaseBottomSheet`).
> Sim-verified: all 5 sections render + scroll + Apply reachable + apply/close +
> swipe-down close.
>
> **CAVEAT for the `header`/`stickyFooter` slots:** they are still correct for
> sheets whose content FITS the snap height (EditInterestsSheet, the short
> pickers) — those never need to scroll, so the wrapper is harmless. Only switch
> to the direct-child pattern when the body can overflow. (If a future sheet
> needs BOTH a pinned header AND overflow scroll, the primitive should be
> upgraded to gorhom's native sticky-first-child support — see the implementation
> report's "Discoveries for orchestrator" #1.) Detail:
> `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0991_WAVE_C_PREFERENCESSHEET_REBUILD_REPORT.md`.

## 13. Batch C-2 decision record (AccountSettings nested-modal chain)

One component, 5 surfaces: a root account-settings sheet + 3 nested pickers
(gender/language/birthday) + a delete-account confirm. The pickers used to open
*over* the root on the iOS window stack. All non-destructive surfaces are
swipe-down sheets; the delete confirm is a NON-swipe center-dialog (operator
rule §1). All sheet surfaces mount from ProfilePage under the floating
GlassBottomNav → `wrapInRNModal` (Batch-2 z-trap).

| Modal | Variant | Snap | Body mode | wrapInRNModal | Notes |
|---|---|---|---|---|---|
| Root account-settings | sheet (light) | `['92%']` | `scroll` (header + accordion body) | **true** | Was `flex:1` from `windowHeight*0.08` ≈ 92%. |
| Gender picker | sheet (light) | `['45%']` | `scroll` (`.map` options) | **true** | Short tap-list. |
| Language picker | sheet (light) | `['70%']` | `scroll` (29-lang list rides BottomSheetScrollView) | **true** | Was `maxHeight:'70%'`. |
| Birthday picker | sheet (light) | `['60%']` | `view` (consumer owns body) | **true** | 3 column wheels → swapped raw RN `<ScrollView>` to `BottomSheetScrollView`. |
| Delete-account confirm | **center-dialog** | — | — | n/a (auto) | Destructive confirm rule. Multi-step states as children; stripped local overlay/card. |

> **HARD LESSON (Batch C-2) — two `wrapInRNModal` BaseBottomSheets CANNOT
> co-present on iOS.** Rendering picker sheets as sibling `wrapInRNModal` roots
> that try to layer over an also-`wrapInRNModal` root crashes with
> `(UIKitCore) [UIKit:Presentation] Attempt to present
> <RCTFabricModalHostViewController> … which is already presenting
> <RCTFabricModalHostViewController>` and the child silently fails to appear
> (sim-confirmed iPhone 17 Pro). RN `<Modal>`s stack; two RN-Modal-wrapped gorhom
> sheets fight for the single iOS presentation slot. True stacked sheets would
> need `BottomSheetModal` + provider — a LOCKED-OUT architecture (ORCH-0828).
>
> **The fix — one-sheet-at-a-time GATE (the reusable nested-chain pattern):**
> 1. Derive `const anyChildOpen = showA || showB || …` from every child flag
>    (including any excluded sub-modal, e.g. CountryPicker).
> 2. Gate the PARENT sheet: `visible={visible && !anyChildOpen}`. While a child
>    is open the parent's RN-Modal window is dropped → the child owns the slot.
>    On child dismiss the parent re-presents at its prior snap, value applied.
> 3. WRAP the parent onClose: `const handleRootClose = useCallback(() => { if
>    (anyChildOpen) return; onClose(); }, …)` and pass `onClose={handleRootClose}`.
>    This is load-bearing — `BaseBottomSheet` fires `onClose` on `onChange(-1)`
>    when `visible` flips false, so without the guard the suppress-for-child
>    close would call the PARENT onClose and tear down the whole flow.
> 4. Children are normal sibling `<BaseBottomSheet>` roots in the same fragment,
>    each `wrapInRNModal`, each with its own `visible`/`onClose` flag.
>
> This is investigation §3d option (i) ("parent closes before the child opens").
> Guard it with a test that asserts the gate is intact AND that the parent is
> NEVER rendered with a bare `visible={visible}` (adversarial — an ungated parent
> re-introduces the crash). See `WaveCBatch2.test.mjs` T-7 + T-A2.

---

## PRIMITIVE REWORK (sheet bugs 1 / 2 / 4 / 4a) — commit `554db7904`, 2026-05-29

Post-conversion operator forensics (`INVESTIGATION_META-ORCH-0991_SHEET_BUGS.md`)
surfaced four primitive-level defects. All fixed in `BaseBottomSheet.tsx` (+ the
shared `PublicEventPage` for the event sheet). New rules for every future sheet:

1. **Swipe-down-to-close now works in `wrapInRNModal` mode** (was dead on Android,
   fragile on iOS). The primitive wraps the modal-hosted sheet in a
   `GestureHandlerRootView` inside the RN `<Modal>`. Consumers do nothing — every
   `wrapInRNModal` sheet inherits working drag-to-dismiss. Do NOT remove that GHRV.

2. **The primitive OWNS the bottom inset.** It applies `max(insets.bottom,16)` as
   `paddingBottom` on the scroll / flatlist / sectionlist / sticky-footer content
   container, MERGED via `Math.max` with any padding the consumer already passes
   (never reduced). **Stop hand-rolling `paddingBottom: insets.bottom+…`** in new
   sheets unless you need MORE than the floor — pass your extra value and the
   primitive takes the larger. Existing hand-rolled sheets are safe (additive max).

3. **`tabBarAware` prop (opt-in, default false) — ENABLED on the 2 in-tree sheets
   (finishing pass).** Set it on a sheet rendered BELOW the visible floating
   `GlassBottomNav` to add the nav content height (`BOTTOM_NAV_CONTENT_HEIGHT`,
   exported from `useAppLayout`) to the bottom padding so the last button clears
   Mingla's menu too. Leave it OFF for `wrapInRNModal` sheets — they z-stack ABOVE
   the nav (nav hidden behind the backdrop) so the menu can't overlap them; they
   only need the OS-inset floor.
   - **Currently set on (and ONLY on):** `NotificationsSheet` (`wrapInRNModal={false}`)
     and `FriendRequestsModal` (no wrap) — the two HomePage in-tree absolute-float
     sheets the app-root nav z-stacks over.
   - **Do NOT set it on EBES / TicketCartSheet / the AccountSettings pickers** even
     though they are non-`wrapInRNModal`: they mount INSIDE a `wrapInRNModal` parent
     window, so the nav is hidden behind that parent and tab-bar padding would open a
     wrong gap. (The finishing-pass test asserts TicketCartSheet stays non-tabBarAware.)
   - **Sticky-footer sheets:** when `tabBarAware`, the primitive wraps the
     `stickyFooter` with the nav clearance and pads the scroll body above it with the
     OS-inset ONLY (`withFooterClearance`) — so the pinned footer clears the menu
     without a gap above it. Non-tabBarAware sticky footers (e.g. TicketCartSheet,
     which hand-rolls `insets.bottom+16`) are never double-padded.

4. **Header / sticky-footer slots are overflow-safe.** The header-present `scroll`
   branch makes the scroll claim `flex:1` below the fixed header, so a TALL
   (overflowing) body still scrolls. You may now use the `header` / `stickyFooter`
   slots with tall content; PreferencesSheet's per-sheet direct-children workaround
   is no longer required for new sheets (it remains valid).

5. **No raw RN `<ScrollView>` inside a gorhom sheet — single scroll host.** The
   event sheet froze because the shared `PublicEventPage` rendered a raw RN
   `<ScrollView>` nested inside the sheet's gorhom scroll. `PublicEventPage` now
   takes an injectable `ScrollComponent` (default RN `ScrollView` for web/business;
   `ExpandedBusinessEventSheet` injects the gorhom `BottomSheetScrollView`
   re-exported from `BaseBottomSheet` and uses `scrollMode="view"`). Pattern for
   any sheet hosting a shared/cross-platform body that itself scrolls: inject the
   gorhom scroll host rather than nesting a raw RN scroll, and use `scrollMode="view"`
   so the primitive does not add a SECOND scroll.

Regression guard: `app-mobile/src/components/ui/__tests__/BaseBottomSheetRework.test.mjs`
(R-1/R-4b/R-4a/R-2 + adversarial; fails-on-revert at `b0063fcad`). Live-verified on
iOS sim + Android emulator — see the rework implementation report.

## Finishing pass — Discover card tap + cover thumbnails (bugs 3a / 3b)

Two per-surface fixes that surfaced during sheet QA (NOT primitive-level):

A. **Tappable cards inside a screen-level RN `<ScrollView>` must use an RNGH
   `Gesture.Tap`, not a bare `<Pressable onPress>`.** A `Pressable` loses its tap
   to the scroll on the slightest finger drift. Wrap the card body in
   `<GestureDetector gesture={Gesture.Tap().maxDistance(16).maxDuration(500).runOnJS(true).onEnd(open)}>`.
   For a card with a nested action button (e.g. a save-heart), give the inner button
   its own `Gesture.Tap` and compose the card-open tap with
   `.requireExternalGestureToFail(saveTap)` so the button wins in its region.
   **If the card's background is a native media surface** (a shared `EventCoverMedia`
   with a `VideoView`/`Image`), wrap that media in a `pointerEvents="none"` View —
   otherwise the native view captures the touch and the card's GestureDetector
   never fires (this only bites video-cover cards; image-only cards have no
   touch-capturing native child). Pattern lives in `discover/BusinessEventCard.tsx`
   + `DiscoverScreen.tsx` `EventGridCard`.

B. **Card covers render via the SHARED `EventCoverMedia` (`@mingla/event-rendering`),
   never a hand-rolled `ExpoImage` + hue band** (COMMS-0007). The shared component
   gives video covers a real poster frame (`autoplay={false}` for grid thumbnails →
   a paused first frame, no concurrent playback), images the built-in `onError` →
   hue-band fallback + per-`mediaUrl` error reset, and null/errored covers the shared
   band. For consumer-app images that are NOT a shared cover surface (the Discover
   Ticketmaster card), add `recyclingKey`, a `placeholder` blurhash, and an `onError`
   dark-band fallback directly. Never leave a remote `<ExpoImage>` on a card without
   `onError` + `recyclingKey` (Android expo-image shows nothing on a failed decode
   and recycles the wrong image otherwise).

Regression guard: `app-mobile/src/components/ui/__tests__/MetaOrch0991FinishingPass.test.mjs`
(A tab-bar / B card-tap / C cover-render + adversarial; fails-on-revert at `cd68b3805`).
iOS-verified (posters render, taps reliable); Android Ticketmaster-photo render needs a
REAL device (emulator can't reach the Ticketmaster CDN) — see the finishing-pass report.
