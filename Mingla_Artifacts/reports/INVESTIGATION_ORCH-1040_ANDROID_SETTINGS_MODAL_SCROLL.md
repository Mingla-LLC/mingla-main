# INVESTIGATION — ORCH-1040 [android-settings-modal-scroll]

**Mode:** INVESTIGATE (investigation only — NO fixes)
**Date:** 2026-06-01
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1040-[android-settings-modal-scroll]/` on branch `ORCH-1040-android-settings-modal-scroll`
**Confidence:** `root cause PROVEN` (six-field evidence + live Pixel 8 Pro repro)
**Comms ledger:** read on entry; no BLOCK/WARN addressed to ORCH-1040 or mingla-forensics. COMMS-0017 (Samsung A72 reservation) is RESOLVED — physical device free. No new cross-ORCH discovery requiring a COMMS write (the blast radius is contained to the consumer app's sheet primitive and is registered below as a Discovery for the orchestrator).

---

## Symptom Summary

| | |
|---|---|
| **Expected** | The Account Settings modal (consumer app, Profile → Account Settings) scrolls so every section + the Red Zone "Delete My Account" is reachable. |
| **Actual (Android)** | The modal body is **completely frozen** — it does not scroll a single pixel no matter the gesture. Once enough sections are expanded that content overflows the 92%-tall sheet, the lower content (rest of Notification Settings, Quiet Hours, App Information, Red Zone / Delete My Account) is permanently unreachable. |
| **iOS** | Scrolls fine (per operator report; corroborated by the architecture — see §5 + §6). |
| **Reproduction** | Always, once content overflows the viewport. With only the default "The Basics" section expanded, content fits and the bug is hidden; expand 2+ sections and it bites. |
| **Platform** | Android-specific. |

---

## The Settings Modal — Component + Scroll Wiring Map

**Component:** `app-mobile/src/components/profile/AccountSettings.tsx`
**Host:** rendered from `app-mobile/src/components/ProfilePage.tsx:590` (`<AccountSettings visible={showAccountSettings} … />`), opened by the "Account Settings" row at `ProfilePage.tsx:535-542`.
**Sheet primitive:** `app-mobile/src/components/ui/BaseBottomSheet.tsx` (the sole `@gorhom/bottom-sheet` consumer in `app-mobile/src`, gorhom **v5.2.8**).

The root settings sheet (`AccountSettings.tsx:515-541`) is wired as:

```tsx
<BaseBottomSheet
  visible={visible && !anyChildOpen}
  snapPoints={SETTINGS_SNAP}        // ["92%"]
  scrollMode="scroll"               // ← gorhom owns the scroll
  wrapInRNModal                     // ← RN Modal carrier (z-stacks above the floating nav)
  header={ <View style={styles.header}> … Settings + close-X … </View> }   // ← THE PROBLEM
  scrollProps={{ style: styles.scrollContent, contentContainerStyle: {…} }}
>
  {/* 5 AccordionCards + the Red Zone delete block — TALL, overflows 92% */}
</BaseBottomSheet>
```

It uses `scrollMode="scroll"` AND a `header=` prop. That combination routes through the **header-bearing scroll branch** in the primitive (`BaseBottomSheet.tsx:526-558`):

```tsx
case 'scroll': {
  const scroll = (
    <BottomSheetScrollView
      style={ hasHeader ? [styles.flexContainer, scrollPropsTyped?.style] : … }  // flex:1
      contentContainerStyle={withBottomInset(…)}
    >
      {children}
    </BottomSheetScrollView>
  );
  if (hasHeader) {
    return (
      <BottomSheetView style={[styles.flexContainer, bodyContainerStyle]}>  // flex:1 WRAPPER
        {header}
        {scroll}                                                            // scroll NOT a direct child
      </BottomSheetView>
    );
  }
  return scroll;   // ← bare path (no header): scroll IS the direct child
}
```

When `header` is present, the `BottomSheetScrollView` is wrapped inside a `BottomSheetView`. It is **NOT the direct child of gorhom's sheet content** — it is a grandchild behind a flex wrapper.

---

## Root Cause (🔴 — six fields)

### 🔴 F1 — Header-wrapped scroll inside a `BottomSheetView` freezes the body on Android

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/ui/BaseBottomSheet.tsx:550-557` (the `hasHeader` branch wrapping the scroll in `BottomSheetView`), triggered by `AccountSettings.tsx:520` (`scrollMode="scroll"`) + `AccountSettings.tsx:523-535` (`header={…}`). |
| **Exact code** | `return (<BottomSheetView style={[styles.flexContainer, bodyContainerStyle]}>{header}{scroll}</BottomSheetView>);` where `styles.flexContainer = { flex: 1 }`. |
| **What it does** | On Android (gorhom 5.2.8), nesting the `BottomSheetScrollView` inside a `flex:1 BottomSheetView` causes the native Android ScrollView to size its scrollable extent to its *content* rather than to a bounded viewport. The scroll viewport ≈ content height, so **maxScrollY collapses to 0** and the body cannot scroll, even though the sheet content overflows the 92% snap. The handle, the fixed header, and the scroll all live inside one `flex:1` `BottomSheetView`, and Android's nested-ScrollView measurement in that layout does not yield a bounded inner viewport. |
| **What it should do** | The `BottomSheetScrollView` must be the **bare direct child** of gorhom's `BottomSheetContent` (no `BottomSheetView` wrapper), so gorhom binds a bounded viewport = (containerHeight − handleHeight) and the tall content scrolls. This is the exact pattern ORCH-1016 proved on a physical Samsung A72. |
| **Causal chain** | META-ORCH-0991 converted AccountSettings to `BaseBottomSheet` with a fixed-title `header` + `scrollMode="scroll"` (`ccf848aaa`) → the primitive's header branch wraps the scroll in a `flex:1 BottomSheetView` → on Android the wrapped `BottomSheetScrollView` measures its scrollable height as its content height → maxScrollY = 0 → swipes/flings do nothing → the user expands sections, content overflows the 92% sheet, and Quiet Hours / App Information / Red Zone / Delete My Account fall below the fold with no way to reach them. iOS does not exhibit this because its native ScrollView nested in the same layout still derives a bounded viewport (gorhom ships a *separate* Android scrollable container — see F2). |
| **Verification step** | LIVE on Pixel 8 Pro (`emulator-5554`): opened Settings, expanded Privacy + Notification Settings to force overflow, then swiped/flung the body. Captured the `uiautomator` bounds of the topmost element ("The Basics" header) and a mid element ("Push Notifications") **before and after** multiple aggressive flings. All bounds were byte-identical before/after — the body moved 0px. Repro screenshots below. |

#### Live Pixel 8 Pro repro evidence (PROVEN)

Device: Pixel 8 Pro AVD (`emulator-5554`, screen 1344×2992), consumer app `com.mingla.app.v2`, Metro :8109 + adb reverse (reused, not killed).

| Probe | Element | Bounds BEFORE swipe | Bounds AFTER swipe/fling |
|---|---|---|---|
| Topmost | "The Basics section" header | `[51,479][1293,635]` | `[51,479][1293,635]` (unchanged after 500ms swipe AND after 3 aggressive 200ms flings) |
| Mid | "Push Notifications" text | `[99,2383][1053,2444]` | `[99,2383][1053,2444]` (unchanged) |
| Scrollable node | gorhom BottomSheetScrollView | `[0,476][1344,2992]` | `[0,476][1344,2992]` (unchanged) |

There IS a `scrollable="true"` node present (gorhom mounts the scroll), but `maxScrollY = 0` so it never moves. With Privacy + Notification Settings expanded, the bottom-most reachable elements are "Quiet Hours" (`y=2380`) and "App Information" (`y=2578`); the **Red Zone / "Delete My Account" never renders into the viewport** at any scroll position.

Screenshots (in this folder):
- `INVESTIGATION_ORCH-1040…/10_settings_open.png` — default state, only "The Basics" expanded (content fits → bug hidden).
- `REPRO_android_settings_frozen.png` — Privacy + Notification Settings expanded, content overflows.
- `REPRO_android_after_aggressive_swipe_unchanged.png` — after multiple aggressive up-swipes/flings: **pixel-identical**, body frozen, lower sections unreachable.

### 🟠 F2 — Why iOS scrolls and Android does not (gorhom platform split)

gorhom 5.2.8 ships **platform-specific scrollable containers**:
- `node_modules/@gorhom/bottom-sheet/src/components/bottomSheetScrollable/ScrollableContainer.tsx` (iOS / default)
- `node_modules/@gorhom/bottom-sheet/src/components/bottomSheetScrollable/ScrollableContainer.android.tsx` (Android-only)

The Android container wraps the scrollable in `BottomSheetDraggableScrollable` (+ a refresh-control branch) and its native ScrollView, nested under a `flex:1 BottomSheetView` whose own height resolves from the gorhom host measurement, does **not** clamp the inner scroll viewport the way iOS does. Layout/scroll math is driven by the host `onLayout` (`BottomSheetHostingContainer.tsx`) + `useAnimatedLayout.ts` (`containerHeight = modal ? rawContainerHeight − verticalInset : rawContainerHeight`); with `enableDynamicSizing=false` (the primitive's default, `BaseBottomSheet.tsx:313`) `setContentSize` is a no-op (`useBottomSheetContentSizeSetter.ts`), so gorhom relies purely on the bounded-viewport binding — which the wrapper defeats on Android specifically. This is the same iOS-fragile / Android-dead asymmetry gorhom documents for gestures, here manifested for scroll-viewport binding. **Classification: contributing factor** — it explains the platform asymmetry; the fixable defect is F1 (Mingla's wrapper), not gorhom.

### 🟠 F3 — The strict-grep gate's `wrapInRNModal`-is-safe assumption is FALSE on Android

`.github/scripts/strict-grep/i-bottomsheet-inline-scroll-binding.mjs` (the ORCH-1016 invariant gate) skips any sheet that uses `wrapInRNModal` (lines 84-86), on the documented theory:

> "This is INVISIBLE for sheets rendered via `wrapInRNModal` (the RN Modal gives gorhom a bounded full-screen parent, so the wrapped scroll still binds) — so the bug only bites INLINE sheets."

The live Pixel 8 Pro repro **disproves that for the header-wrapped path**: `AccountSettings` uses `wrapInRNModal` AND still does not scroll on Android. The RN Modal carrier bounds the *outer* parent, but the inner `BottomSheetScrollView` is still wrapped in a `flex:1 BottomSheetView` (because of `header`), and on Android that inner wrapper still collapses the scroll viewport. So `wrapInRNModal` is NOT a sufficient safety condition when a `header`/`stickyFooter`/`bodyContainerStyle` wrapper is also present. The gate passes green (verified: `node …i-bottomsheet-inline-scroll-binding.mjs` → OK) while the bug ships. **Classification: contributing factor / test gap** — the gate created false confidence (same failure mode F3 in the ORCH-1016 trace: "source tests proved wiring, not visible geometry").

---

## Comparison to the ORCH-1016 Fixed Pattern (precedent to reuse)

ORCH-1016 (commit `31e6c39e0`, verified on physical iPhone 17e + Samsung A72) root-caused the identical mechanism and fixed it via the **bare `scrollMode="scroll"` direct-child binding**. Its gate documents the rule verbatim:

> "gorhom's `BottomSheetScrollView` only gets a bounded viewport — and therefore only scrolls — when it is effectively the DIRECT child of `BottomSheetContent`. The moment a sheet wraps its scroll in a gorhom `BottomSheetView` (which is what BaseBottomSheet's `header`, `stickyFooter`, or `bodyContainerStyle` branches do), gorhom sizes the sheet to that wrapper's CONTENT height, so the scroll viewport == content, maxScroll == 0, and the body FREEZES."

The verified-scrolling reference sheet `ExpandedBusinessEventSheet.tsx` (allowlisted in the gate) uses `scrollMode="scroll"` with **NO `header=` prop** — the scroll is the bare direct child (`ExpandedBusinessEventSheet.tsx:450`, `hidesBottomNav` at `:451`, no header). That is exactly the difference: **AccountSettings has a `header` prop; the working sheets do not.**

AccountSettings is the same wrapped-scroll anti-pattern ORCH-1016 fixed — it was simply missed because (a) it lives behind `wrapInRNModal`, which the gate exempts, and (b) the bug only surfaces when content overflows (multiple accordions expanded), which the default single-expanded state hides.

---

## Five-Layer Cross-Check

| Layer | Finding |
|---|---|
| **Docs** | The ORCH-1016 gate + `BaseBottomSheet` header doc-comments say a wrapped scroll freezes inline, and claim `wrapInRNModal` is safe. Live repro contradicts the "wrapInRNModal is safe" clause for the header path. |
| **Schema** | N/A (pure client UI / layout bug). |
| **Code** | `BaseBottomSheet.tsx:550-557` wraps scroll in `BottomSheetView` when `header` present; `AccountSettings.tsx:520+523` passes both. gorhom 5.2.8 ships `ScrollableContainer.android.tsx`. |
| **Runtime** | Pixel 8 Pro: scrollable node present, maxScrollY=0, body 0px movement after aggressive flings (uiautomator bounds identical before/after). |
| **Data** | N/A. |

Layers **disagree**: Docs (gate) say `wrapInRNModal` ⇒ safe; Runtime says header-wrapped scroll freezes on Android even with `wrapInRNModal`. Runtime holds the truth.

---

## Blast Radius

17 consumer sheets use the SAME risky pattern (`header=` + `scrollMode="scroll"` + `wrapInRNModal`) and share the identical body composition — every one whose content can overflow the snap height on Android is at risk of the same frozen scroll:

```
components/ReportUserModal.tsx
components/ExpandedCardModal.tsx
components/BoardMemberManagementModal.tsx
components/AddToBoardModal.tsx
components/CustomHolidayModal.tsx
components/PairRequestModal.tsx
components/MessageInterface.tsx
components/ShareModal.tsx
components/ConnectionsPage.tsx
components/discover/CityPickerSheet.tsx
components/chat/CollabSessionChatBanners.tsx
components/activity/ProposeDateTimeModal.tsx
components/connections/CreateGroupChatSheet.tsx
components/profile/BillingSheet.tsx          ← settings-adjacent
components/profile/AccountSettings.tsx       ← THE reported bug
components/profile/EditInterestsSheet.tsx
(+ the orch_1016_rework4 test)
```

AccountSettings is the worst offender because it has the most content (5 accordions + non-collapsible Red Zone). Sheets with short, never-overflowing content (e.g. a 2-button confirm) won't visibly break, but `CityPickerSheet`, `BillingSheet`, `EditInterestsSheet`, `ConnectionsPage`, `MessageInterface` are tall-content candidates that should be re-verified on Android.

---

## Fix Strategy (direction only — NOT a spec, NOT code)

Match the ORCH-1016 precedent: **make the `BottomSheetScrollView` the bare direct child of the gorhom sheet content for AccountSettings (and the other tall header+scroll sheets).** Two viable shapes, in preference order:

1. **Move the header INTO the scroll content (recommended, smallest, precedent-exact).** Drop the `header=` prop on `AccountSettings`'s root `BaseBottomSheet` and render the Settings title + close-X as the first child *inside* the scroll body (a non-sticky scrolling header). This makes the path fall into the **bare** `case 'scroll'` branch (`BaseBottomSheet.tsx:558` `return scroll;`) — scroll = direct child = bounded viewport = scrolls on Android. Target: `AccountSettings.tsx:515-541` (remove `header`, prepend the header markup to children). The title scrolling away is acceptable for a settings sheet; matches the EBES/working-sheet pattern.

2. **Fix the primitive so a header-bearing `scrollMode="scroll"` binds on Android.** If a pinned (non-scrolling) header is a hard product requirement, the primitive's header+scroll branch (`BaseBottomSheet.tsx:550-557`) must give the inner `BottomSheetScrollView` a genuinely bounded viewport on Android — e.g. an explicit measured height on the wrapper rather than `flex:1`, or restructure so gorhom still sees the scroll as the bound child. Higher blast radius (touches the shared primitive + all 17 consumers) and must be re-verified on-device for every consumer; only choose this if the pinned header is non-negotiable.

**Also required regardless of which shape:** fix the gate `i-bottomsheet-inline-scroll-binding.mjs` so `wrapInRNModal` no longer auto-exempts a header/stickyFooter/bodyContainerStyle-wrapped scroll (F3) — otherwise the regression silently re-ships. The gate should flag header+scroll sheets *even when wrapped in RN Modal* unless they carry the `@sheet-scroll-ok:` directive certifying on-device Android verification.

**Verification bar for the fix:** on Pixel 8 Pro (or Samsung A72), open Settings, expand Privacy + Notification Settings, swipe up, and confirm "The Basics" header scrolls off the top AND "Delete My Account" becomes reachable — measured via `uiautomator` bounds delta, not a source assertion (per the ORCH-1016 "runtime geometry, not source" gate lesson).

---

## Regression Prevention

- Tighten `i-bottomsheet-inline-scroll-binding.mjs`: remove the blanket `wrapInRNModal` exemption for header/stickyFooter/bodyContainerStyle-wrapped scrolls; require `@sheet-scroll-ok: <on-device Android reason>` for any such sheet.
- Add a runtime/geometry regression (uiautomator or Maestro `assertVisible` on the bottom-most settings element after a scroll) — source-regex tests passed green here while the body was frozen.

---

## Discoveries for Orchestrator

1. **Blast radius (P1):** 16 OTHER consumer sheets share AccountSettings' header+scroll+wrapInRNModal pattern (list in Blast Radius). The tall-content ones (`CityPickerSheet`, `BillingSheet`, `EditInterestsSheet`, `ConnectionsPage`, `MessageInterface`) likely have the same Android frozen-scroll and should be in-scope for the fix or a follow-up sweep ORCH.
2. **Gate defect (P1):** `i-bottomsheet-inline-scroll-binding.mjs` exempts `wrapInRNModal` sheets and therefore PASSES green on this proven bug — false confidence. The gate's own root-cause doc-comment is wrong about `wrapInRNModal` being a sufficient safety condition on Android.
3. **iOS contrast not live-verified:** the consumer app on the booted iPhone 17 Pro sim sits at the logged-out login screen and exposes only Apple/Google login (no visible phone-OTP button on that screen), so the reviewer-OTP login was not completed within scope. The iOS "scrolls fine" claim is corroborated by (a) operator report and (b) the gorhom platform-split architecture (F2) + the working iOS history of the same primitive — confidence on the iOS side is `probable` by mechanism. The **Android bug itself is `PROVEN`** by live repro, which is the load-bearing claim.

---

## Confidence

**Android root cause: PROVEN** — six-field evidence + live Pixel 8 Pro repro with before/after uiautomator bounds showing 0px movement after aggressive flings; the distinguishing factor (header-wrapped scroll vs bare scroll) confirmed against the ORCH-1016 gate + the verified-scrolling `ExpandedBusinessEventSheet` reference.
**iOS contrast: probable** (mechanism + history; not live-fired due to logged-out sim + login scope).
