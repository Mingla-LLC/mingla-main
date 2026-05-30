# SPEC — META-ORCH-0991 [Consumer-app modals → slide-down bottom sheets] — **WAVE A**

**Mode:** SPEC (no product code, no migrations, no edge deploys — contract only)
**Scope:** Wave A ONLY — the shared `BaseBottomSheet` primitive + migration of the **5 existing** `@gorhom/bottom-sheet` sheets onto it, with ZERO visual/behavioral regression. Wave B/C conversions are out of scope here (they consume this primitive later).
**Surface:** `app-mobile/` (consumer iOS + Android) ONLY.
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/` on branch `META-ORCH-0991-consumer-modals-to-sheets` (Metro :8087).
**Author:** mingla-forensics+claude
**Date:** 2026-05-29
**Source of truth:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0991_CONSUMER_MODALS_TO_SHEETS.md` (this branch).
**External-API docs verified (COMMS-0003 / I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED):** every `@gorhom/bottom-sheet` v5 API below is cited inline against the provider docs. Version in repo: `@gorhom/bottom-sheet@^5.2.8`, `react-native-gesture-handler@~2.28.0`, `react-native-reanimated@^4.1.5` (`app-mobile/package.json`).

---

## 0. Comms ledger + precedent ingest

- **COMMS_LEDGER scanned.** No OPEN `BLOCK` row targets `mingla-forensics`, `META-ORCH-0991`, or `ALL`. **COMMS-0003** (`ALL`/WARN — external-API docs cited inline at SPEC) is factored: every gorhom API is doc-cited. **COMMS-0002** (ORCH-0863 backend strict-grep allowlist) is **N/A** — Wave A touches zero `supabase/functions/` or `supabase/migrations/` files. No new cross-ORCH discovery to write.
- **Governing precedent (load-bearing):**
  - **ORCH-0696** — `glass.bottomSheet` chrome tokens (`designSystem.ts:274-298`). Mandate: "DO NOT add new bottom sheets without consuming these tokens."
  - **ORCH-0828 REWORK** — deleted the `@gorhom/portal` `BottomSheetModalProvider`; locked the project on the **inline vanilla `<BottomSheet>`** pattern. Invariant `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` (`app/_layout.tsx:79-85`).
  - **ORCH-0908** — wraps `<BottomSheet>` in an RN `<Modal transparent animationType="none" statusBarTranslucent>` so it z-stacks above the custom tab bar (`ExpandedCardModal.tsx:1786-1798`).
  - **ORCH-0975** — light-canvas `glass.notificationsSheet` token sibling (`designSystem.ts:301-344`) + the `orch-0975-notifications-sheet.mjs` strict-grep gate + the locked `NotificationsSheet.test.tsx` assertions. **Both gate AND test directly assert `NotificationsSheet.tsx` imports `@gorhom/bottom-sheet` and uses `BottomSheetSectionList` — migration MUST repoint them (see §8 + §11). This is the single highest-risk regression in Wave A.**
  - Memory: `feedback_rn_sub_sheet_must_render_inside_parent` — sub-sheets render as **sibling `<BottomSheet>` roots** inside the parent's return fragment, never nested inside another sheet's body.

---

## 1. Locked operator decisions (do NOT re-open)

These are inputs, not open questions. The investigation's §3 "biggest architecture decision" (vanilla inline vs `BottomSheetModal` + provider) is **CLOSED by operator**:

1. 🔒 **ARCHITECTURE = keep the existing INLINE vanilla `@gorhom/bottom-sheet` `<BottomSheet>` pattern.** NO root `BottomSheetModalProvider`. NO `@gorhom/portal`. The ORCH-0828 invariant `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` STANDS. The primitive packages the proven inline pattern and replicates the ORCH-0908 RN-Modal z-stacking wrapper as an **opt-in prop**. Nested-modal chains use **one-sheet-at-a-time** state (or sibling roots), NOT stacked providers.
2. 🔒 **SCOPE EXCLUSIONS (all waves):** CustomPaywallScreen, ImageLightbox, MessageInterface in-chat image preview, InAppBrowserModal, CollabDeckSheet, SessionViewModal, PostExperienceModal, BetaFeedbackModal, the MessageInterface file-processing spinner. Out of scope for Wave A and every other wave.
3. 🔒 **WAVE A = the primitive + the 5 existing sheets ONLY.** No RN-Modal conversions in this wave.

---

## 2. Scope, non-goals, assumptions

### Scope (Wave A)
- 🔒 Build `app-mobile/src/components/ui/BaseBottomSheet.tsx` — the single shared sheet primitive (§3–§6).
- 🔒 Migrate the 5 existing `@gorhom/bottom-sheet` consumers onto it with zero visual/behavioral regression (§7):
  1. `NotificationsSheet.tsx`
  2. `ExpandedCardModal.tsx` (keystone — RN-Modal wrap + dark/light theme + review-nav chrome + sub-sheets)
  3. `expandedCard/ExpandedBusinessEventSheet.tsx` (hosts TicketCartSheet sibling root)
  4. `expandedCard/TicketCartSheet.tsx` (sticky-footer pattern)
  5. `chat/CollabSessionChatBanners.tsx` (3 sheet instances via the local `CompactCollabBottomSheet` wrapper)
- 🔒 Strict-grep invariant forbidding NEW raw `@gorhom/bottom-sheet` usage outside `BaseBottomSheet.tsx` (§10).
- 🔒 Repoint the ORCH-0975 gate + locked test so they stay green post-migration (§8, §11).
- 🔒 Regression-test coverage per the Mingla gate (§12).

### Non-goals (Wave A)
- ❌ No RN-`<Modal>`→sheet conversions (those are Wave B/C; they consume this primitive — explicitly deferred).
- ❌ No re-litigation of the provider decision (locked §1.1).
- ❌ No paywall / image-viewer / fullscreen-flow changes (locked §1.2).
- ❌ No `center-dialog` variant *consumers* in Wave A — the variant exists in the primitive's API but its first consumers are Wave B confirm dialogs. Wave A ships the variant stub only if it costs nothing; if it adds risk, the implementor MAY defer the variant body to Wave B and ship only the `variant` prop typing + a `[TRANSITIONAL — center-dialog body lands Wave B]` guard. (🎨 OPEN — implementor's call.)
- ❌ No DB / edge / migration / RLS changes (pure client UI).

### Assumptions
- The 5 sheets' current on-device behavior is the **golden baseline** — "zero regression" is measured against the current `main`/branch build, not against an idealized design. Any deviation is a defect unless explicitly called 🎨 OPEN here.
- `reviewSwipeResponder` in `ExpandedCardModal.tsx:1427` is **created but never attached** to any view's `panHandlers` (verified by grep — single occurrence, no `{...reviewSwipeResponder.panHandlers}` site). Review navigation is driven by the on-screen chevron buttons in `reviewNavBar` (`:1829-1849`), NOT the PanResponder. **Therefore the only real gesture coexistence concern is `BottomSheetScrollView` body scroll vs the sheet's pan-down — which gorhom already wires internally.** The spec keeps the dead `reviewSwipeResponder` exactly as-is (do not delete it in Wave A — out of scope; flag as a §13 discovery).

---

## 3. `BaseBottomSheet` — API surface (prop contract)

🔒 **File location: `app-mobile/src/components/ui/BaseBottomSheet.tsx`.** Justification: `app-mobile/src/components/ui/` is the established home for shared cross-screen primitives (`Icon.tsx`, `GlassCard.tsx`, `KeyboardAwareScrollView.tsx`, `Toast.tsx`). A sheet primitive is exactly this class. Co-locate a barrel-free named export `export function BaseBottomSheet(...)` plus a `default` export (match repo convention; both NotificationsSheet and the expandedCard sheets use default exports for component files).

🔒 **Built on vanilla `BottomSheet`** (the default export of `@gorhom/bottom-sheet`), NOT `BottomSheetModal`. [docs: https://gorhom.dev/react-native-bottom-sheet/ — vanilla `BottomSheet`; modal variant is the separate `BottomSheetModal` we are NOT using per §1.1]

### 3.1 Props

🔒 = exact contract the implementor hits. 🎨 = handed to implementor/designer craft.

| Prop | Type | Default | Lock | Source / rationale + doc URL |
|------|------|---------|:----:|------------------------------|
| `visible` | `boolean` | — (required) | 🔒 | Declarative open/close: drives `index={visible ? initialIndex : -1}` on the inner `<BottomSheet>` (the proven pattern at `ExpandedBusinessEventSheet.tsx:393`, `NotificationsSheet.tsx:304`, `ExpandedCardModal.tsx:1801`). NO imperative `present()`/`dismiss()`. `index=-1` = closed. [docs: https://gorhom.dev/react-native-bottom-sheet/props — `index`: "`-1` initiates the sheet in closed state"] |
| `onClose` | `() => void` | — (required) | 🔒 | Called from `onChange(-1)` (pan-down + backdrop-press) AND any explicit close button. **All dismiss analytics MUST be wired here, not on the button handler** (§9 blast risk #4). |
| `snapPoints` | `(string \| number)[]` | `undefined` (use `enableDynamicSizing`) OR per-consumer | 🔒 | Canonical gorhom prop. String = percentage. Each migrating sheet passes its EXACT current snapPoints (§7). [docs: https://gorhom.dev/react-native-bottom-sheet/props — `snapPoints`: "String values should be a percentage"] |
| `initialIndex` | `number` | `0` | 🔒 | The snap index used when `visible` flips true. ExpandedCardModal opens at index **1** of `['50%','90%']` (`:1801`), so it passes `initialIndex={1}`. All others open at `0`. [docs: props — `index` default `0`] |
| `enableDynamicSizing` | `boolean` | `false` | 🔒 | **NOTE: gorhom v5 default is `true`; the primitive overrides to `false`** because all 5 Wave-A sheets pass explicit `snapPoints` and dynamic sizing previously caused the "collapse-to-zero" failure ORCH-0828 documented (`ExpandedBusinessEventSheet.tsx:382-388`). A consumer that wants content-sized sheets opts in explicitly. [docs: props — `enableDynamicSizing` default `true`] |
| `onChange` | `(index: number) => void` | `undefined` | 🔒 | Optional passthrough for consumers that log transitions (ExpandedBusinessEventSheet keeps a diagnostic log at `:203-211`). The primitive ALWAYS calls `onClose()` internally on `index === -1`; `onChange` fires in addition, after, for the consumer. [docs: props — `onChange`: "Called when sheet position changes, receives the index parameter"] |
| `enablePanDownToClose` | `boolean` | `true` | 🔒 | All 5 sheets set this. Swipe-down-to-dismiss is the core contract of the conversion program. Center-dialog variant forces `false`. [docs: props — `enablePanDownToClose` default `false`; primitive overrides to `true`] |
| `theme` | `'dark' \| 'light'` | `'light'` | 🔒 | Maps to `glass.bottomSheet` (dark) vs `glass.notificationsSheet` (light). ExpandedCardModal switches per `isNightOut` (`:1810-1819`); ExpandedBusinessEventSheet + TicketCartSheet are dark; NotificationsSheet + CollabSessionChatBanners are light. The primitive owns the `backgroundStyle` + `handleIndicatorStyle` + top-radius + hairline derivation from `theme` (§6). |
| `scrollMode` | `'view' \| 'scroll' \| 'flatlist' \| 'sectionlist'` | `'scroll'` | 🔒 | Selects the gorhom body container: `BottomSheetView` / `BottomSheetScrollView` / `BottomSheetFlatList` / `BottomSheetSectionList`. **MUST** use gorhom scrollables, never raw RN ScrollView/FlatList inside the sheet. NotificationsSheet = `sectionlist`; ExpandedCard/Business/Cart = `scroll`; CollabBanners = `scroll`; sticky-footer layouts = `view` (flex column, see `stickyFooter`). [docs: https://gorhom.dev/react-native-bottom-sheet/scrollables — "pre-integrated virtualized lists that utilize an internal functionality with the bottom sheet container to allow smooth panning interactions"] |
| `scrollProps` | `Partial<…>` | `undefined` | 🔒 | Forwarded to the chosen scrollable (e.g. `sections`/`renderItem` for sectionlist, `contentContainerStyle`, `showsVerticalScrollIndicator`, `onEndReached`). Typed as a discriminated union keyed on `scrollMode` so the implementor cannot pass `sections` to a `scroll` body. |
| `stickyFooter` | `ReactNode` | `undefined` | 🔒 | When set, the body renders inside a single flex-column `BottomSheetView`: scroll/list body claims `flex:1`, footer pinned at bottom with `paddingBottom: Math.max(insets.bottom, 16) + 16`. This is the TicketCartSheet pattern (`TicketCartSheet.tsx:322-345`). Mixing siblings at the `<BottomSheet>` root caused the sticky bar to float above content — the primitive enforces the single-flexed-container layout. |
| `wrapInRNModal` | `boolean` | `false` | 🔒 | **Z-stacking escape hatch (ORCH-0908).** When `true`, the entire `<BottomSheet>` is wrapped in RN `<Modal transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>` so it lifts above the custom tab bar / chat input. ExpandedCardModal + CompactCollabBottomSheet set `true`; NotificationsSheet sets `false`. (§5) |
| `keyboardBehavior` | `'interactive' \| 'extend' \| 'fillParent'` | `'interactive'` | 🔒 | For form/keyboard sheets (Wave B/C consumers). v5 default is already `interactive`. [docs: https://gorhom.dev/react-native-bottom-sheet/props — `keyboardBehavior` values `'extend' \| 'fillParent' \| 'interactive'`, default `'interactive'`] |
| `keyboardBlurBehavior` | `'none' \| 'restore'` | `'restore'` | 🔒 | **NOTE: gorhom v5 default is `none`; the primitive overrides to `restore`** so dismissing the keyboard restores the prior snap (the documented good-form behavior). [docs: props — `keyboardBlurBehavior` values `'none' \| 'restore'`, default `'none'`] |
| `android_keyboardInputMode` | `'adjustPan' \| 'adjustResize'` | `'adjustResize'` | 🔒 | **NOTE: gorhom v5 default is `adjustPan`; primitive overrides to `adjustResize`** for form sheets so Android pushes content above the keyboard. [docs: props — `android_keyboardInputMode` values `'adjustPan' \| 'adjustResize'`, default `'adjustPan'`] |
| `variant` | `'sheet' \| 'center-dialog'` | `'sheet'` | 🔒 | `center-dialog` = centered card, NO pan-down (forces `enablePanDownToClose=false`), reuses the RN-Modal + centered `Animated.View` pattern (NOT gorhom) — for confirm dialogs (Wave B). Wave A ships `'sheet'` consumers only; see §2 non-goal on the body. |
| `showHandle` | `boolean` | `true` | 🔒 | Drag handle (the chrome/close affordance on most surfaces). Hidden only for `center-dialog`. |
| `handleStyle` | `ViewStyle` | token-derived | 🎨 | Per-consumer override of the handle indicator; defaults derived from `theme` (§6). Designer owns the exact resting/active handle treatment (§6.4). |
| `backdropOpacity` | `number` | theme-derived | 🔒 | Existing sheets use a SPREAD of opacities (NotificationsSheet `0.32`, ExpandedCardModal `0.55`, CollabBanners `0.48`, ExpandedBusinessEventSheet/TicketCartSheet default). The primitive's default per theme: `light → 0.32`, `dark → 0.55`. Each migrating sheet passes its EXACT current value to preserve pixel parity (§7). |
| `accessibilityLabel` | `string` | `undefined` | 🔒 | Sheet-level a11y label (§5 a11y). |
| `children` | `ReactNode` | — (required) | 🔒 | Sheet body content. For `scroll`/`view` modes the children render inside the chosen container; for `flatlist`/`sectionlist` modes the list is data-driven via `scrollProps` and `children` is the optional header/footer slot. |

### 3.2 Backdrop — standardized

🔒 The primitive renders a single internal `BottomSheetBackdrop` with `appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" opacity={backdropOpacity}` — identical semantics across all 5 existing sheets (`ExpandedBusinessEventSheet.tsx:188-194`, `NotificationsSheet.tsx:336-347`, `TicketCartSheet.tsx:246-256`, `ExpandedCardModal.tsx:1702-1713`, `CollabSessionChatBanners.tsx:268-279`). Consumers do NOT pass `backdropComponent`; they only tune `backdropOpacity`. [docs: https://gorhom.dev/react-native-bottom-sheet/components/bottomsheetbackdrop — `appearsOnIndex` / `disappearsOnIndex` / `pressBehavior`]

### 3.3 Open/close + Android back

🔒 Internal `useEffect` mirrors the proven pattern: on `visible → true` call `ref.snapToIndex(initialIndex)`; on `visible → false` call `ref.close()` (`NotificationsSheet.tsx:306-312`, `ExpandedCardModal.tsx:1715-1721`). [docs: https://gorhom.dev/react-native-bottom-sheet/methods — `snapToIndex`, `close`]
🔒 Android hardware back: when `wrapInRNModal` is `true`, the RN `<Modal onRequestClose={onClose}>` handles back natively (current ExpandedCardModal/CompactCollabBottomSheet behavior). When `wrapInRNModal` is `false`, the primitive registers a `BackHandler` listener while `visible` that calls `onClose()` and returns `true`, then removes it on close/unmount (gorhom sheets do NOT auto-handle Android back — §9 blast risk #6). This restores RN-Modal-equivalent back behavior for non-wrapped sheets. (🎨 OPEN: the implementor MAY instead require `wrapInRNModal` for any sheet needing hardware-back capture if the BackHandler approach proves flaky on device — but a non-wrapped sheet that ignores Android back is a defect.)

---

## 4. Behavior in every state

🔒 The primitive must behave identically to the current sheets in each state. Definitions:

| State | Behavior |
|-------|----------|
| **closed** | `index=-1`; not mounted-visible; no backdrop; no focus trap; `BackHandler` listener removed. |
| **opening** | `visible` flips true → `animateOnMount`-style spring to `initialIndex`; backdrop fades in `appearsOnIndex=0`. [docs: props — `animateOnMount` default `true`] |
| **open at snap** | rests at a `snapPoints` entry; body scrollable via the chosen gorhom container; backdrop at full `backdropOpacity`. |
| **dragging-to-dismiss** | user pans the handle/header down; below the close threshold gorhom fires `onChange(-1)` → primitive calls `onClose()` (+ consumer `onChange`). Backdrop fades out `disappearsOnIndex=-1`. |
| **backdrop-press** | `pressBehavior="close"` → `onChange(-1)` → `onClose()`. |
| **explicit close button** | consumer calls `onClose()` directly (or `ref.close()` then `onChange(-1)` → `onClose()`); either path lands in `onClose`, so dismiss analytics fire exactly once (§9). |
| **keyboard-open** (form consumers, Wave B/C) | `keyboardBehavior='interactive'` keeps the focused `BottomSheetTextInput` above the keyboard; `keyboardBlurBehavior='restore'` restores snap on blur; Android uses `adjustResize`. Plain RN `TextInput` is FORBIDDEN inside the sheet — must be `BottomSheetTextInput` (§3.1 note; not exercised by Wave A's 5 sheets, all KB=N, but the contract must exist for Wave B/C). [docs: https://gorhom.dev/react-native-bottom-sheet/keyboard-handling — "a pre-integrated `TextInput` called `BottomSheetTextInput`"] |
| **rotation / safe-area change** | bottom padding recomputes from `useSafeAreaInsets()`; `Math.max(insets.bottom, 16)` floor preserved (§6.3). |

---

## 5. Z-stacking-over-tab-bar mode (`wrapInRNModal`) — the ORCH-0908 pattern

🔒 **Mechanism (replicate EXACTLY from `ExpandedCardModal.tsx:1786-1798`):** when `wrapInRNModal === true`, wrap the inner `<BottomSheet>` (and its backdrop) in:

```
<RNModal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
  …<BottomSheet …/>
</RNModal>
```

🔒 **Why:** the app uses a custom in-tree tab bar (siblings in the Expo Router `Stack`, `app/_layout.tsx:86`). A vanilla `<BottomSheet>` mounted DEEP in the deck/chat tree renders *under* the tab bar / chat input. The RN `<Modal>` hosts a separate OS overlay window that lifts the whole sheet above them. (`CompactCollabBottomSheet` already does this — `CollabSessionChatBanners.tsx:282-288`.)
🔒 **When `false`:** sheets mounted HIGH in the tree (HomePage hosts NotificationsSheet — `NotificationsSheet` z-stacks fine without the wrap). Default `false`.
🔒 **Known cost to preserve:** the OS-window boundary means a parent's `pointerEvents:'none'` does NOT reach into the Modal window (documented at `BetaFeedbackButton.tsx:32`). The host must dismiss the sheet explicitly on tab-blur — the primitive does NOT change this; hosts keep their current dismiss-on-blur logic.
🔒 **a11y inside the wrap:** RN `<Modal>` provides `accessibilityViewIsModal` focus-trap semantics natively. **For non-wrapped sheets, vanilla gorhom `<BottomSheet>` does NOT trap VoiceOver focus the same way** (§9 blast risk #5). The primitive must set `accessibilityViewIsModal` on the wrapped container, and for non-wrapped sheets set the root sheet container's `accessibilityViewIsModal`/`importantForAccessibility="yes"` + label so VoiceOver still announces a modal boundary. (🎨 OPEN: exact a11y tree shaping is designer/implementor craft, but losing the modal boundary vs today is a defect, not OPEN.)

🔒 **Re-litigation forbidden:** the primitive must NOT introduce a `BottomSheetModalProvider` to "solve" z-stacking the gorhom-native way. That reverses the locked ORCH-0828 invariant (§1.1).

---

## 6. Design tokens consumed + standardized

🔒 The primitive reads ONLY from `app-mobile/src/constants/designSystem.ts`. No magic numbers, no inline hex outside what the tokens already define.

### 6.1 Dark theme (`theme='dark'`) → `glass.bottomSheet` (`designSystem.ts:274-298`)
- `backgroundStyle.backgroundColor`: ExpandedCardModal uses `rgba(12,14,18,1)` and ExpandedBusinessEventSheet uses `#0c0e12` — **both must be preserved per-consumer** (§7). The primitive's dark default = `#0c0e12`; ExpandedCardModal overrides to `rgba(12,14,18,1)` to stay pixel-identical.
- `borderTopLeftRadius`/`borderTopRightRadius`: `glass.bottomSheet.topRadius` = **28**.
- `borderTopWidth`: `StyleSheet.hairlineWidth`; `borderTopColor`: `glass.bottomSheet.hairline` = `rgba(255,255,255,0.08)`.
- `handleIndicatorStyle.backgroundColor`: `glass.bottomSheet.handle.color` = `rgba(255,255,255,0.30)`; `width`: `36`; `height`: `4`.
- backdrop default opacity: `0.55`.

### 6.2 Light theme (`theme='light'`) → `glass.notificationsSheet` (`designSystem.ts:301-344`)
- `backgroundStyle.backgroundColor`: `glass.notificationsSheet.canvas` = `#FFFFFF`.
- top radius: `glass.notificationsSheet.topRadius` = **28**.
- `handleIndicatorStyle.backgroundColor`: `glass.notificationsSheet.handle.color` = `rgba(0,0,0,0.18)`; `width` `36`; `height` `4`.
- backdrop default opacity: `glass.notificationsSheet.backdropTint` alpha → `0.32`.

### 6.3 Safe-area bottom padding
🔒 `Math.max(insets.bottom, 16)` floor (repeated today in `ExpandedCardModal.tsx:1859`, `NotificationsSheet.tsx:322`, `TicketCartSheet.tsx:323`). The primitive owns this for `scrollMode` body + `stickyFooter`. Consumers may add additional content inset on top (e.g. ExpandedBusinessEventSheet's `Math.max(32, bottomContentInset)` — preserved by passing `scrollProps.contentContainerStyle`).

### 6.4 New tokens the SPEC requires (🎨 DESIGNER PASS owns the exact values)
The investigation flagged two gaps. The implementor must NOT invent these inline — they are added to `designSystem.ts` by the **designer pass** (§14):
- 🎨 `glass.bottomSheet.handleActive` / motion — handle resting vs active (dragging) treatment.
- 🎨 a `glass.centerDialog` token block (canvas, radius, shadow, backdrop) for the `center-dialog` variant — only needed when Wave B consumers land; Wave A may stub.

### 6.5 No-AI-slop bans (🔒 LOCKED)
- ❌ No new gradients, no decorative blur beyond the existing `glass.bottomSheet.scrim`/`backdropTint`, no emoji handles, no drop-shadow "glow." The sheet chrome is the two established token sets, full stop.
- ❌ No color-function syntax that RN rejects (`oklch(`/`color-mix(`/`lab(`) — HSL/hex/rgb only (consistent with `I-ARI-NO-OKLCH` discipline; not gated here but a craft rule).

**References examined:** Apple iOS sheet presentation (UISheetPresentationController detents + grabber), Linear's mobile sheets (handle + spring), Things 3 (calm light sheets), the 5 in-repo sheets as the literal golden baseline. The primitive does not invent a new look — it consolidates the look ORCH-0696/0975 already shipped.

---

## 7. Migration of the 5 existing sheets — per-sheet contract (ZERO regression)

For each: **what changes** (mechanical) and **what MUST stay pixel/behavior-identical** (the parity floor). Risk-ranked.

### 7.1 `chat/CollabSessionChatBanners.tsx` — **RISK: LOW** (cleanest, do FIRST)
- **Changes:** the local `CompactCollabBottomSheet` wrapper (`:249-318`) is replaced by a `BaseBottomSheet` with `theme='light'`, `wrapInRNModal={true}` (it currently wraps in RN Modal at `:282`), `scrollMode='scroll'`, `backdropOpacity={0.48}`, `snapPoints` passed through from each of the 3 callers (Plans/Matches/Saved). The header (title + close button) becomes `children` content above the scroll body, OR a `header` slot — keep it as children to minimize change.
- **MUST stay identical:** all 3 instances (`ScheduleSheet`/Plans + the matches + saved sheets), `opacity={0.48}` backdrop, `#6b7280` close icon, the `CompactCollabBottomSheet` callers' `title`/`closeAccessibilityLabel` props, the `BottomSheetScrollView` body for list content, the `verticalListContent` content style.
- **Test note:** `CollabSessionChatBanners.test.tsx` is a documented **no-op stub** (ORCH-0942) — no locked assertions to repoint. Safe.

### 7.2 `expandedCard/TicketCartSheet.tsx` — **RISK: LOW-MED** (sticky footer is the only novelty)
- **Changes:** `<BottomSheet>` (`:328-337`) → `BaseBottomSheet` with `theme='dark'`, `scrollMode='view'` (it uses a single flexed `BottomSheetView`), `stickyFooter={<the sticky bar>}`, `snapPoints={SHEET_SNAP_POINTS}`, `backdropOpacity` = current value. The header + body branches stay as `children`; the sticky CTA bar moves into the `stickyFooter` prop.
- **MUST stay identical:** the `stickyBar` `paddingBottom: insets.bottom + 16` (`:322-325`), all 5 render-states (loading/empty/sold_out/sales_closed/populated), the CTA label/disabled logic, `handleCancel`/`handleSheetChange` routing to `onCancel` via `onClose`, the `#0c0e12`-class dark background + handle, `enablePanDownToClose`.
- **Critical:** the sticky-footer layout (header + flex:1 body + pinned footer inside ONE `BottomSheetView`) is exactly the layout that broke when siblings were mixed at the root — the primitive's `stickyFooter` must produce this single-container layout (§3.1).

### 7.3 `NotificationsSheet.tsx` — **RISK: MED** (locked test + strict-grep gate must be repointed)
- **Changes:** `<BottomSheet>` (`:738-747`) → `BaseBottomSheet` with `theme='light'`, `wrapInRNModal={false}`, `scrollMode='sectionlist'`, `scrollProps={{ sections, keyExtractor, renderItem, renderSectionHeader, stickySectionHeadersEnabled:false, onEndReached, onEndReachedThreshold:0.3, onRefresh, refreshing:false, contentContainerStyle: listContentStyle }}`, `snapPoints={['88%']}` (current `SHEET_SNAP_POINTS`), `backdropOpacity={0.32}`. The header cluster (title/new-count pill/close/action row) + offline banner become the `children`/header slot rendered above the section list. The raw `import BottomSheet, { BottomSheetBackdrop, BottomSheetSectionList, BottomSheetView } from '@gorhom/bottom-sheet'` is REMOVED — the file now imports `BaseBottomSheet`.
- **MUST stay identical:** `['88%']` snap, the light canvas, the header copy/locale keys (`header.newCount`/`header.subtitle`/`markAllRead`/`clearAll`), the date-grouped `BottomSheetSectionList` content (now rendered by the primitive), empty/error/offline/skeleton states verbatim, `showMarkAllRead`/`showClearAll`/`showActionRow` derivations, the `Math.max(insets.bottom,16)+16` list bottom padding, the close-button `onPress → ref.close()` (now `onClose`).
- 🔒 **Gate + test repoint (HARD — §8 + §11):** ORCH-0975's `orch-0975-notifications-sheet.mjs` C1 asserts `NotificationsSheet.tsx` literally imports `@gorhom/bottom-sheet` + uses `BottomSheetSectionList`; the locked `NotificationsSheet.test.tsx` asserts the same on the file source. After migration both assertions move to **`BaseBottomSheet.tsx`** (the gorhom import + `BottomSheetSectionList` now live there). The gate + test must be updated to assert: (a) `NotificationsSheet.tsx` does NOT import RN `Modal` and DOES import `BaseBottomSheet` with `scrollMode="sectionlist"`; (b) `BaseBottomSheet.tsx` imports `@gorhom/bottom-sheet` and references `BottomSheetSectionList`. **Because this DELETES/edits assertions in a locked test, the migration commit body MUST carry `[TEST-MOD-APPROVED META-ORCH-0991]`** (memory `feedback_close_commit_precommit_checks.md`).

### 7.4 `expandedCard/ExpandedBusinessEventSheet.tsx` — **RISK: MED** (hosts a sibling sub-sheet)
- **Changes:** the parent `<BottomSheet>` (`:391-400`) → `BaseBottomSheet` with `theme='dark'`, `scrollMode='scroll'`, `snapPoints={SHEET_SNAP_POINTS}`, `initialIndex={SHEET_INITIAL_INDEX}`, `onChange` passthrough keeping the diagnostic log (`:203-211`), `backdropOpacity` current. The `PublicEventPage` stays inside `BottomSheetScrollView` (now via the primitive). **The `<TicketCartSheet>` sibling root (`:422-436`) stays a SIBLING in the SAME return fragment** — it is itself a `BaseBottomSheet` consumer (7.2), NOT nested inside the parent's body (memory `feedback_rn_sub_sheet_must_render_inside_parent`).
- **MUST stay identical:** the `<>…</>` fragment hosting parent sheet + sibling cart sheet, the `index={visible ? SHEET_INITIAL_INDEX : -1}` declarative open, the `#0c0e12` background + `rgba(255,255,255,0.32)` handle, the checkout `handleBuy`/`handleCartCheckout`/`handleCartCancel` flow, all `onClose` routing, the `sheetScrollContent` bottom padding.

### 7.5 `ExpandedCardModal.tsx` — **RISK: HIGH (keystone — migrate LAST behind a parity gate)**
- **Why highest risk:** mounts from Discover deck / Solo deck / Saved / collab review; carries dark/light theme switch (`isNightOut`), the RN-Modal z-stacking wrap, review-nav chrome, the (dead-but-present) `reviewSwipeResponder`, a `LockedInBanner`, and **nested child surfaces** (`InAppBrowserModal`, `ShareModal`, ticket browser) rendered INSIDE the sheet body fragment.
- **Changes:** the `<RNModal>…<BottomSheet>…</BottomSheet></RNModal>` block (`:1786-1822` + close `:2265-2266`) → `BaseBottomSheet` with `wrapInRNModal={true}`, `theme={isNightOut ? 'dark' : 'light'}`, `scrollMode='scroll'`, `snapPoints={glass.bottomSheet.snapPoints}`, `initialIndex={1}`, `backdropOpacity={0.55}`, `onClose={onClose}`. The conditional `handleIndicatorStyle`/`backgroundStyle` (currently inline-computed from `isNightOut`, `:1805-1820`) are replaced by `theme` — BUT the primitive must reproduce the EXACT current colors: dark `rgba(12,14,18,1)` bg + `rgba(255,255,255,0.30)` handle; light `#ffffff` bg + `rgba(0,0,0,0.30)` handle. The review-nav header (`ExpandedCardHeader` + `reviewNavBar`, `:1826-1851`) + `LockedInBanner` + the `BottomSheetScrollView` body all become `children`. The trailing child modals (`InAppBrowserModal` `:2235`, `ShareModal` `:2242`, ticket browser `:2230`) stay as siblings AFTER the scroll body inside the sheet — preserve their exact current position so they keep mounting over the sheet content.
- **MUST stay identical:** the RN-Modal z-stack wrap behavior over the tab bar (verify on device), `index={visible ? 1 : -1}`, the dark-vs-light pixel switch keyed on `isNightOut`, the review chevron nav (counter "{n} of {total}", `#eb7825` active / `#d1d5db` disabled), the `Math.max(insets.bottom,16)` body padding, the business-event early-return branch (`:1738-1746`) which delegates to ExpandedBusinessEventSheet (7.4), the `reviewSwipeResponder` left UNTOUCHED (§2 assumption — out of scope to remove), the `0.55` backdrop, all child-modal mount points.
- 🔒 **Migrate LAST in Wave A**, behind explicit iOS+Android live-fire parity verification (§12 T-12/T-13).

### 7.6 Migration order (🔒 LOCKED)
1. Build `BaseBottomSheet.tsx` + its unit tests.
2. CollabSessionChatBanners (7.1).
3. TicketCartSheet (7.2).
4. ExpandedBusinessEventSheet (7.4) — depends on TicketCartSheet being on the primitive.
5. NotificationsSheet (7.3) + repoint ORCH-0975 gate & locked test (§8/§11) in the SAME commit.
6. ExpandedCardModal (7.5) — last, behind the parity gate.

---

## 8. ORCH-0975 gate + locked-test interaction (HARD)

🔒 The migration of NotificationsSheet (7.3) **WILL break** two existing green checks unless updated in the same commit:
1. `orch-0975-notifications-sheet.mjs` C1 — asserts `NotificationsSheet.tsx` imports `@gorhom/bottom-sheet` + uses `BottomSheetSectionList`.
2. `app-mobile/src/components/__tests__/NotificationsSheet.test.tsx` — asserts the same on the file source (`from '@gorhom/bottom-sheet'`, `\bBottomSheetSectionList\b`), plus `doesNotMatch(/import …Modal… from 'react-native'/)` and `doesNotMatch(/<Modal\b/)` and `doesNotMatch(/ScrollView/)`.

🔒 **Required updates (same commit as 7.3):**
- Update C1 of `orch-0975-notifications-sheet.mjs` to: NotificationsSheet must NOT import RN `Modal`, MUST import `BaseBottomSheet`, MUST pass `scrollMode="sectionlist"`; AND `BaseBottomSheet.tsx` MUST import `@gorhom/bottom-sheet` and reference `BottomSheetSectionList`. (C2/C3 locale checks unchanged.)
- Update `NotificationsSheet.test.tsx`: repoint the `from '@gorhom/bottom-sheet'` + `BottomSheetSectionList` asserts to read `BaseBottomSheet.tsx` source; KEEP the `doesNotMatch(/…Modal…/)` and `doesNotMatch(/ScrollView/)` asserts on `NotificationsSheet.tsx` (still valid — it must not gain an RN Modal or raw ScrollView). The `<Modal` doesNotMatch on NotificationsSheet stays true (its wrapInRNModal is false).
- ⚠️ **Watch:** the new `NotificationsSheet.test.tsx` `doesNotMatch(/ScrollView/)` — `BottomSheetScrollView` contains the substring `ScrollView`. NotificationsSheet itself uses `sectionlist` mode and should not reference any `*ScrollView` symbol, so the assert stays satisfied. Confirm the `BaseBottomSheet` import line does not surface `ScrollView` into NotificationsSheet's source.
- 🔒 Commit body MUST include `[TEST-MOD-APPROVED META-ORCH-0991]` (memory `feedback_close_commit_precommit_checks.md`).

---

## 9. Cross-surface impact (Phase 2.5 — mandatory)

| Surface | Covered? | Behavior demanded / why not |
|---------|:--------:|------------------------------|
| **1. Consumer iOS** (`app-mobile/` iOS) | ✅ | Primary target. All 5 sheets swipe-down-dismiss + render pixel-identical to current. SC-iOS criteria in §10. |
| **2. Consumer Android** (`app-mobile/` Android) | ✅ | Parity is SHARED CODE (one primitive) but **two runtime behaviors differ and need separate gates**: hardware-back (§3.3) and keyboard `adjustResize` (Wave B/C). SC-Android criteria in §10. |
| 3. Buyer/anon Web (`mingla-business/`) | ❌ | Different repo; not touched. |
| 4. Business iOS (`mingla-business/`) | ❌ | Different app; has its own sheet stack (BrandSwitcherSheet/UniversalCreatorSheet TopSheet). Out of scope. |
| 5. Business Android | ❌ | Same as 4. |
| 6. Admin Web (`mingla-admin/`) | ❌ | No RN sheets; React+Vite. |
| 7. Business Web preview | ❌ | Out of scope. |

🔒 **Manual-parity success criteria split iOS/Android** for: z-stacking-over-tab-bar (SC-04), Android hardware-back (SC-06-Android), swipe-down-dismiss feel (SC-02). Implementor cannot ship iOS and skip Android.

🔵 **Blast-radius risks the migration must not regress (from investigation §5):**
1. Shared sheets / multi-host: NotificationsSheet (HomePage), ExpandedCardModal (4 mount surfaces) — verify each mount still opens.
2. ExpandedCardModal keystone hits the core swipe loop — migrate last, parity-gate (7.5).
3. Deep-link entry points (notification tap → NotificationsSheet; review flows → ExpandedCardModal) must still open via the `visible` flag — unchanged contract.
4. **Dismiss analytics:** all dismiss analytics MUST route through `onClose` (pan-down + button identical), per §3.1. None of the 5 Wave-A sheets currently fire paywall-style dismiss analytics, but `onChange` passthrough preserves any existing logging (ExpandedBusinessEventSheet diagnostic log).
5. **VoiceOver focus-trap:** non-wrapped gorhom sheets lose RN-Modal's `accessibilityViewIsModal` — the primitive must restore a modal boundary (§5).
6. **Android back:** the primitive owns `BackHandler` for non-wrapped sheets (§3.3).

---

## 10. Success criteria

Observable, testable, unambiguous. (SC-N-iOS / -Android where parity is manual.)

- **SC-01** `app-mobile/src/components/ui/BaseBottomSheet.tsx` exists, default-exports a `BaseBottomSheet` matching the §3.1 prop contract, and is the ONLY `app-mobile/src` file (besides itself) permitted to import `@gorhom/bottom-sheet` after Wave A (enforced by §11 gate).
- **SC-02-iOS / SC-02-Android** Each of the 5 migrated sheets opens on `visible=true`, rests at its exact prior snap point(s), and dismisses via pan-down, backdrop-press, AND explicit close — all three landing in `onClose`. (Live-fire both platforms.)
- **SC-03** Each migrated sheet is **visually identical** to the pre-migration build: background color, top-radius 28, handle color/size, backdrop opacity, body padding — per the per-sheet parity floors in §7. (Screenshot diff against baseline.)
- **SC-04-iOS / SC-04-Android** ExpandedCardModal + CompactCollabBottomSheet (the `wrapInRNModal=true` consumers) render ABOVE the custom tab bar / chat input (z-stack preserved). NotificationsSheet (`wrapInRNModal=false`) still z-stacks correctly from HomePage.
- **SC-05** TicketCartSheet's sticky CTA bar stays pinned at the bottom with `insets.bottom+16` padding above content scroll; all 5 render-states intact.
- **SC-06-Android** Android hardware-back dismisses every migrated sheet (via RN-Modal `onRequestClose` for wrapped, via `BackHandler` for non-wrapped) and lands in `onClose`.
- **SC-07** NotificationsSheet section list (date-grouped), empty/error/offline/skeleton states, header copy + action pills render identically; ORCH-0975 gate + locked test repointed and GREEN (§8).
- **SC-08** ExpandedCardModal dark-vs-light theme switch keyed on `isNightOut` produces the exact prior colors; review-nav chevrons + counter unchanged; business-event early-return branch still delegates to ExpandedBusinessEventSheet.
- **SC-09** ExpandedBusinessEventSheet still hosts TicketCartSheet as a sibling root (not nested); checkout flow unchanged.
- **SC-10** No raw RN `<ScrollView>`/`<FlatList>`/`<SectionList>` inside any sheet body — gorhom scrollables only (the primitive enforces via `scrollMode`).
- **SC-11** New strict-grep gate (§11) is registered, self-tests pass, and FAILS if any NEW `app-mobile/src` file (≠ `BaseBottomSheet.tsx`) imports `@gorhom/bottom-sheet`.
- **SC-12** VoiceOver announces a modal boundary on every migrated sheet (no focus leak to content behind the sheet).

---

## 11. Invariants

### Preserved (must not regress)
- 🔒 **I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS** (ORCH-0828) — no `BottomSheetModalProvider`/`@gorhom/portal`. The primitive uses vanilla `<BottomSheet>` only. Verified: no provider import added; `app/_layout.tsx` unchanged.
- 🔒 **ORCH-0696 token mandate** — all sheet chrome derives from `glass.bottomSheet`/`glass.notificationsSheet`. Verified: primitive reads tokens, no new inline hex beyond per-consumer parity overrides documented in §7.
- 🔒 **I-PROPOSED-ORCH-0975-NOTIFICATIONS-NO-RN-MODAL** — NotificationsSheet stays off RN Modal (now via `BaseBottomSheet`, `wrapInRNModal=false`). Gate repointed (§8).
- 🔒 **`feedback_rn_sub_sheet_must_render_inside_parent`** — TicketCartSheet stays a sibling root in ExpandedBusinessEventSheet's fragment.

### NEW invariant established (🔒 the strict-grep gate this SPEC requires)

**`I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER`**

> After Wave A, the ONLY file under `app-mobile/src/` permitted to import from `@gorhom/bottom-sheet` is `app-mobile/src/components/ui/BaseBottomSheet.tsx`. All other sheet surfaces consume the primitive. New hand-rolled gorhom usage is forbidden.

🔒 **Gate file:** `.github/scripts/strict-grep/meta-orch-0991-base-bottom-sheet-sole-consumer.mjs` (follows the `i-ari-no-oklch.mjs` template: `walk()` over `.ts`/`.tsx` under `app-mobile/src`, skip `__tests__`/`node_modules`, regex `from\s+['"]@gorhom\/bottom-sheet['"]`).
🔒 **Behavior:** PASS if the ONLY matching file is `app-mobile/src/components/ui/BaseBottomSheet.tsx`; FAIL listing every other offender. Includes a `--self-test` mode that asserts the gate itself flags a synthetic offender.
🔒 **CI registration:** add a `meta-orch-0991-base-bottom-sheet-sole-consumer` job to `.github/workflows/strict-grep-mingla-business.yml` (the workflow already triggers on `app-mobile/**` + `.github/scripts/strict-grep/**`), mirroring the `orch-0975-notifications-sheet` job block (checkout → setup-node@20 → `node …mjs`), and add a one-line registry comment under the "Currently registered gates" header.
🔵 **Note:** because this gate touches only `.github/scripts/strict-grep/` + `.github/workflows/` (NOT `supabase/functions/` or `supabase/migrations/`), the COMMS-0002 ORCH-0863 backend-allowlist requirement is **N/A**. No `ORCH_NNNN_BACKEND_ALLOWLIST` edit needed.

---

## 12. Test cases (Mingla regression-test gate)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Primitive opens | `<BaseBottomSheet visible snapPoints={['50%']}>` | mounts, springs to index 0, backdrop in | Component |
| T-02 | Pan-down dismiss → onClose | drag handle below threshold | `onChange(-1)` → `onClose()` called once | Component |
| T-03 | Backdrop-press dismiss → onClose | tap backdrop | `pressBehavior=close` → `onClose()` once | Component |
| T-04 | Explicit close → onClose | `visible=false` flip | `ref.close()` → `onChange(-1)` → `onClose()` once (no double-fire) | Component |
| T-05 | `scrollMode` selects container | each of view/scroll/flatlist/sectionlist | correct `BottomSheet*` body rendered; never raw RN list | Component |
| T-06 | Sticky footer layout | `stickyFooter` set | single flexed `BottomSheetView`; footer pinned with `insets.bottom+16`; body scrolls under | Component |
| T-07 | `wrapInRNModal=true` z-stack | mount deep + tab bar present | sheet renders above tab bar (RN Modal window) | Live-fire iOS+Android |
| T-08 | Android hardware-back (non-wrapped) | `wrapInRNModal=false`, press back | `onClose()` fires, returns `true`, listener removed on unmount | Live-fire Android |
| T-09 | Theme dark | `theme='dark'` | `#0c0e12`-class bg + `rgba(255,255,255,0.30)` handle + radius 28 | Component snapshot |
| T-10 | Theme light | `theme='light'` | `#FFFFFF` bg + `rgba(0,0,0,0.18)` handle + radius 28 | Component snapshot |
| T-11 | NotificationsSheet parity | migrated sheet, fixtures | section list + states + header identical; gate + locked test green | Component + gate |
| T-12 | ExpandedCardModal dark/light switch | TM event (night-out) vs place card | dark vs light pixel-identical to baseline; review-nav intact | Live-fire iOS+Android |
| T-13 | ExpandedCardModal z-stack over tab bar | open from Discover deck | sheet above tab bar + chat input; child modals (Share/InAppBrowser) still mount over body | Live-fire iOS+Android |
| T-14 | ExpandedBusinessEventSheet hosts cart | tap Buy → cart sheet | TicketCartSheet opens as sibling root over parent; checkout flow unchanged | Live-fire iOS |
| T-15 | Strict-grep gate self-test | synthetic offender file imports gorhom | gate FAILS listing offender; passes when only BaseBottomSheet imports gorhom | CI gate |
| T-16 | VoiceOver modal boundary | screen reader on, open any migrated sheet | focus trapped to sheet; content behind not reachable | Live-fire iOS (VoiceOver) |
| T-17 (adversarial) | Double-dismiss | pan-down WHILE pressing close | `onClose` fires once, no crash, no orphaned backdrop | Component |
| T-18 (adversarial) | Rapid visible toggle | `visible` true→false→true fast | sheet settles open, no stuck backdrop, no `snapToIndex` race | Component + live-fire |
| T-19 (adversarial) | Empty snapPoints + dynamic off | misconfig | typed error at compile (union enforces snapPoints when dynamic off) OR safe console-warn, no silent zero-height collapse | Component |

🔒 Regression-test files: a sibling `__tests__/BaseBottomSheet.test.tsx` (append-only per ORCH-0840). The NotificationsSheet locked test is EDITED (repointed) under `[TEST-MOD-APPROVED META-ORCH-0991]` (§8).
🔒 Live-fire: per memory `feedback_always_simulator_repro_described_behaviour` + `feedback_sim_test_drivers_maestro_default`, T-07/08/12/13/14/16/18 are verified on the iOS sim + Android emu before TEST verdict (tester phase, not this SPEC).

---

## 13. Implementation order + regression prevention

🔒 **Order:** (1) primitive + its unit tests → (2) §11 strict-grep gate + CI job → (3) CollabSessionChatBanners → (4) TicketCartSheet → (5) ExpandedBusinessEventSheet → (6) NotificationsSheet + §8 gate/test repoint (same commit, `[TEST-MOD-APPROVED META-ORCH-0991]`) → (7) ExpandedCardModal (parity-gated).

🔒 **Regression prevention:**
- The §11 strict-grep gate structurally prevents future hand-rolled gorhom usage — the whole point of the primitive.
- A protective header comment in `BaseBottomSheet.tsx` cites ORCH-0828 (inline-only), ORCH-0908 (`wrapInRNModal`), ORCH-0696/0975 (tokens) and forbids re-introducing a provider.
- ExpandedCardModal migrated LAST behind iOS+Android live-fire (highest blast radius).

🔵 **Discoveries for orchestrator:**
- `reviewSwipeResponder` (`ExpandedCardModal.tsx:1427`) is dead code (created, never attached). Out of Wave A scope; recommend a tiny cleanup ORCH or fold into a later wave — do NOT delete in Wave A.
- The `center-dialog` variant's first real consumers are Wave B confirm dialogs (BlockUserModal, IncomingPairRequestCard, PairingInfoCard, AccountSettings delete-confirm). Wave A only types the prop; the variant body + `glass.centerDialog` token land with Wave B.
- Wave B/C will consume this exact primitive for ~38 RN-Modal conversions — the prop contract here is forward-looking for keyboard (`BottomSheetTextInput`), search, and nested chains (one-sheet-at-a-time / sibling roots).

---

## 14. Designer pass (🎨 OPEN — sits between this SPEC and IMPLEMENT)

A `mingla-designer` DESIGN pass owns the following OPEN items before/alongside IMPLEMENT. They do NOT block the LOCKED functional contract above:
- 🎨 **Handle motion + active state** — resting vs dragging handle treatment (`glass.bottomSheet.handleActive` token values + any micro-animation feel). The 36×4 size + token colors are LOCKED; the *active* polish is OPEN.
- 🎨 **Snap-point feel / spring config** — within the band that preserves current dismiss thresholds; must not change the snapPoints values themselves (LOCKED per §7).
- 🎨 **Backdrop blur vs flat tint** — whether the light theme uses `glass.notificationsSheet.backdropTint` flat or a subtle blur; current behavior is the floor.
- 🎨 **`center-dialog` variant visual** — canvas/radius/shadow/backdrop for the Wave-B confirm-dialog look (`glass.centerDialog` token block).
- 🎨 **Reduced-motion + reduced-transparency fallbacks** for the sheet entrance.

LOCKED for the designer (NOT open): the two token sets (`glass.bottomSheet`/`glass.notificationsSheet`), top-radius 28, handle 36×4, safe-area floor `Math.max(insets.bottom,16)`, the per-sheet parity colors in §7, no-AI-slop bans (§6.5), the inline-vanilla architecture, the `wrapInRNModal` mechanism.

---

## 15. Confidence

**HIGH.** Every `@gorhom/bottom-sheet` v5 API is doc-verified inline (keyboard-handling, props with exact enum values + defaults, scrollables, methods pages all fetched 2026-05-29). All 5 sheets read in full for their `<BottomSheet>` JSX, backdrop, open/close wiring, theme, and nesting. The two highest-risk couplings (ORCH-0975 gate + locked test repoint; ExpandedCardModal RN-Modal-wrap + dark/light + sub-sheets) are pinned with exact line references and parity floors. The only assumption (dead `reviewSwipeResponder`) is grep-verified. No live-fire performed — correct for a SPEC; live-fire belongs to the tester phase per §12.
