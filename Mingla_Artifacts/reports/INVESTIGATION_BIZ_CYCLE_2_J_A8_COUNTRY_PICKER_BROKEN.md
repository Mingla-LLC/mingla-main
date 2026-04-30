# Investigation — Country Picker Sheet Broken on `/brand/[id]/edit`

> **Mode:** Forensics INVESTIGATE-ONLY
> **Issue ID:** ORCH-BIZ-CYCLE-2-J-A8-COUNTRY-PICKER-BROKEN
> **Codebase:** `mingla-business/`
> **Predecessor:** J-A8 polish implementor PASS (uncommitted) → orchestrator flex-column fix INSUFFICIENT → forensics dispatched
> **Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_2_J_A8_COUNTRY_PICKER_BROKEN.md`
> **Auditor turn:** 2026-04-29
> **Confidence:** **HIGH — root cause proven** with six-field evidence

---

## 1. Symptom Summary

**Founder verbatim:**
> "the modal is transparent, and i have to scroll up to even see there is a modal. I dont see the modal come up. Normally the modal is supposed to slide up as a bottom sheet, and its supposed to stop just benath the top bar. All countries should be scrollable within it. I see nothing"

**Expected:**
- Tap phone country chip → bottom sheet slides up from bottom of viewport
- Sheet panel anchors at ~half screen height
- Dark scrim covers the visible viewport
- Country list scrolls within the sheet panel
- Tap scrim or drag-down to dismiss

**Actual:**
- Tap phone country chip → nothing visibly happens
- No scrim appears over the visible viewport
- No panel slides up
- User must scroll the parent form to even discover the modal exists somewhere
- Country list is not visible

**Reproduction:** every time, on `/brand/[id]/edit`. (Question still open: does the same Sheet work in `/auth/*` routes? See Section 6 hypothesis testing.)

---

## 2. Investigation Manifest

| File | Layer | Read | Why |
|---|---|---|---|
| Dispatch | Spec input | ✅ | Hypothesis ladder + scope |
| `IMPLEMENTATION_BIZ_CYCLE_2_J_A8_BRAND_EDIT.md` | J-A8 baseline | ✅ (session) | BrandEditView mount tree — KAV → ScrollView → Inputs |
| `IMPLEMENTATION_CYCLE_1_ACCOUNT_ANCHOR.md` | Cycle 1 lessons | ✅ (session) | D-IMPL-44 GlassChrome content-driven sizing; TopSheet's working mount pattern |
| `mingla-business/src/components/ui/Sheet.tsx` | Primitive — under suspicion | ✅ end-to-end | Outer overlay markup |
| `mingla-business/src/components/ui/Input.tsx` | Phone variant trigger | ✅ (session) | Where the Sheet is rendered in the React tree |
| `mingla-business/src/components/brand/BrandEditView.tsx` | Route host | ✅ (session) | Mount tree: `<View host>` → `<KeyboardAvoidingView>` → `<ScrollView>` → ... → `<Input variant="phone">` |
| `mingla-business/app/brand/[id]/edit.tsx` | Route file | ✅ (session) | Top of mount chain |
| `mingla-business/app/_layout.tsx` | Root | ✅ (session) | `GestureHandlerRootView` + `SafeAreaProvider` + `Stack` |
| `mingla-business/src/components/ui/TopSheet.tsx` | Reference | ✅ (session) | DEC-080 — proven non-tab overlay mounted at HOST level |

`npx tsc --noEmit` clean (verified post-orchestrator-flex-column patch).

---

## 3. Findings

### 🔴 Root Cause — Proven (six-field evidence)

**RC-1 — Sheet renders inside ScrollView's content tree, not at screen root**

| Field | Value |
|---|---|
| **File + line** | Primary: `mingla-business/src/components/ui/Sheet.tsx:172-176` (outer View) and `:216-221` (`bottomDock` style). Trigger: `mingla-business/src/components/ui/Input.tsx` Sheet render block (currently lines ~688-744 after the orchestrator flex-column patch). |
| **Exact code** | Sheet outer (line 172): `<View pointerEvents={visible ? "auto" : "none"} style={StyleSheet.absoluteFill} testID={testID}>` Sheet bottomDock (line 216): `bottomDock: { position: "absolute", left: 0, right: 0, bottom: 0 }` Input render: `{isPhone ? (<Sheet visible={pickerOpen} ...>...</Sheet>) : null}` rendered as a sibling of the Input's main container View, **inside the consumer's parent** (which for BrandEditView is the ScrollView's contentContainer). |
| **What it does** | The Sheet primitive renders its overlay (scrim + panel) using `StyleSheet.absoluteFill` for the outer container and `position: "absolute"; bottom: 0` for the panel dock. In React Native, `position: "absolute"` resolves relative to the **nearest positioned ancestor in the React Native layout tree**, NOT the screen viewport. When mounted inside a ScrollView, the nearest positioned ancestor is the ScrollView's contentContainer (not the screen). The contentContainer extends to the height of all the ScrollView's children combined — for BrandEditView that's the photo card + about + contact + social (8 inputs) + display toggle + sticky-shelf padding ≈ 1100-1400 px on a 844-px iPhone viewport. The Sheet's scrim absoluteFills that ~1300px contentContainer, and the bottomDock anchors to **the bottom of the contentContainer** — ~700 px below the visible viewport. So the Sheet renders, animates, mounts correctly — but is positioned far below the user's screen, hidden inside scrollable form content. |
| **What it should do** | The Sheet's overlay must mount at the **screen root** — equivalent to the OS window — so `position: "absolute"; bottom: 0` resolves to the bottom of the visible viewport, regardless of which React component triggered the open. Industry-standard solutions: (a) Use React Native's native `Modal` component, which portals to the OS-level root window via a native bridge; (b) Implement a JavaScript Portal pattern (e.g., `react-native-portalize` or a custom OverlayHost provider mounted at `app/_layout.tsx` root); (c) Hoist the Sheet's render output to the route's host-level via prop drilling or context — same concept as how `BrandSwitcherSheet` (TopSheet) is mounted at host level in home.tsx and account.tsx (sibling of ScrollView, not inside it). |
| **Causal chain** | (1) Founder is on `/brand/[id]/edit`; mount tree is: Stack → route host (paddingTop:insets.top, bg:canvas.discover, flex:1) → BrandEditView (`<View flex:1>`) → KeyboardAvoidingView (flex:1) → ScrollView. (2) ScrollView contentContainerStyle has `paddingBottom: spacing.xl + Math.max(insets.bottom, spacing.md)` — typical contentHeight ~1300 px for the populated form. (3) Inside ScrollView: TopBar → photo card → About section (3 Inputs incl. multi-line bio) → Contact section (`<Input variant="phone">`) → Social Links (8 Inputs) → Display toggle. (4) Phone Input renders a Fragment `<>...<Sheet visible={pickerOpen} ...>{...children...}</Sheet></>`; the Sheet is a sibling of the Input's own container — both mounted as Fragment children inside the ScrollView. (5) Founder taps the country chip Pressable; `pickerOpen=true`. (6) Sheet's `mounted=true` triggers; outer `<View style={StyleSheet.absoluteFill}>` renders. (7) `StyleSheet.absoluteFill` evaluates against the nearest positioned ancestor — there is none with explicit `position` set in the chain ScrollView contentContainer → Fragment children, so RN treats the ScrollView's contentContainer as the absolute reference (ScrollView in RN behaves like `position: relative` for its content). (8) The scrim's `absoluteFill` therefore covers the entire 1300-px contentContainer; from the user's viewport (top of form, scrolled to top), they don't see darkness because the scrim is drawn at the wrong z-layer relative to scrolled content (and even if z-correct, the dark overlay extends below the fold). (9) The bottomDock's `position: absolute; bottom: 0` anchors to the bottom of the contentContainer (≈ 1300 px from top of contentContainer ≈ 700 px below visible viewport bottom). (10) The animated panel translates from `closedY = sheetHeight` (off-screen relative to contentContainer-bottom) to `openY = 0` (at the bottom of contentContainer). (11) Net result: scrim invisible because mis-anchored; panel slides into a position ~700 px below the user's viewport. (12) If the user scrolls the form down (or up if the contentContainer's coordinate space tricks them), they may glimpse the sheet's content far down the page. (13) Founder reports: transparent, no slide-up, no anchor, "have to scroll up to even see there is a modal." |
| **Verification step** | (a) On `/brand/[id]/edit` with `pickerOpen=true`, scroll the form to its bottom — the country picker Sheet should be visible at the very bottom of the scrollable content. (b) In React Native dev menu → "Show Inspector" → tap the (invisible-but-mounted) Sheet area at the bottom of the scrollable content — the inspector will reveal the Sheet's bbox is ~1100-1300 px tall, anchored below the visible viewport. (c) Lift the Sheet render OUT of the Input component to BrandEditView's host level (sibling of KeyboardAvoidingView, not inside it) — the Sheet should immediately render correctly: scrim covers the visible viewport, panel slides up from bottom of viewport. This last step is essentially the fix; running it confirms the diagnosis. |

---

### 🟠 Contributing Factors

**CF-1 — Sheet primitive provides no portal mechanism**

- File: `Sheet.tsx:172-209` end-to-end
- Sheet renders its overlay markup directly in the React tree where it's mounted; no use of `react-native`'s `Modal` component, no portal/teleport pattern, no OverlayHost provider
- Comment line 17-18: "Caller MUST wrap the app root in `GestureHandlerRootView`" — but the comment is silent on WHERE in the tree the Sheet itself can be mounted
- This means every consumer of Sheet must mount Sheet at a screen-root-equivalent level. There's no enforcement, no warning, no portal — entirely on the consumer's discipline
- **Why it's contributing, not root:** the absoluteFill+absolute-bottom pattern is fine FOR what it is; the root cause is that Input.tsx's Sheet mount location violates the implicit "must mount at root" contract. If Input mounted Sheet at the consumer's root level, the bug wouldn't exist.

**CF-2 — Cycle 0a auth flow happened to work despite the same architectural flaw**

- The country picker Sheet was originally consumed by Cycle 0a auth screens (`/auth/index.tsx` etc.)
- In auth screens, the form is short (1-2 inputs typically) and the ScrollView's contentContainer is approximately viewport height — meaning `absoluteFill`/`bottom: 0` resolved to coordinates that approximately matched the screen
- This created a false sense of "the Sheet works" in Cycle 0a
- BrandEditView (Cycle 2 J-A8) is the first long form that consumed `<Input variant="phone">`, exposing the latent flaw

### 🟡 Hidden Flaws

**HF-1 — Cycle 0a `Modal.tsx` and `ConfirmDialog.tsx` likely have the same architectural flaw**

- Same kit lineage; same Cycle 0a build pattern. Cycle 0a sub-phase C.3 reports describe Modal as "scale+opacity, GlassCard elevated body" without mentioning native portal usage.
- If Modal/ConfirmDialog also lack a portal mechanism, they too will fail when mounted inside ScrollViews on long forms.
- BrandEditView's existing ConfirmDialog (for unsaved-changes dialog) works because it's mounted at the BrandEditView **host** level (sibling of KeyboardAvoidingView, not inside it). Different mount depth → different observable result, but same latent flaw.
- **Why hidden flaw:** ConfirmDialog smoke-passed in J-A8 only because of correct mounting. Future overlay primitives in deep ScrollViews will fail the same way. Recommend adding a structural safeguard (Portal/OverlayHost) at kit level.

**HF-2 — TopSheet (DEC-080) has the same architectural pattern**

- TopSheet.tsx end-to-end uses `StyleSheet.absoluteFill` for the scrim and absolute-positioned panel
- TopSheet works for BrandSwitcherSheet because that consumer mounts TopSheet at host level in home.tsx + account.tsx — sibling of ScrollView, not inside it
- If a future consumer mounts BrandSwitcherSheet (TopSheet wrapper) inside a ScrollView, same regression
- **Mitigation:** spec a structural safeguard (portal pattern) OR document the host-level mount requirement as a Cycle 0a kit invariant.

### 🔵 Observations

**O-1 — The orchestrator's flex-column wrapper fix was orthogonal to the actual bug**
- The flex-column wrapper around search bar + ScrollView correctly solved a separate issue (ScrollView collapse if list were visible) but it had no effect on the panel's mount position, which is the actual bug
- The fix wasn't wrong; it was incomplete because the diagnosis was wrong (D-IMPL-42 flex-collapse vs RC-1 portal mount)
- Lesson: when symptoms include "modal transparent + doesn't slide" treat as overlay-mount issue first, layout issue second

**O-2 — KeyboardAvoidingView interaction was a red herring (Hypothesis H-3)**
- KAV doesn't affect absolute-position resolution at the React layout level — it only adjusts content padding when keyboard opens
- Even with KAV in the chain, the root cause is the Sheet's mount-inside-ScrollView, not KAV interaction

**O-3 — The Sheet's `Dimensions.get("window").height` (line 80) provides correct screen height**
- Sheet calculates `sheetHeight = screenHeight * 0.5` correctly
- Issue is ONLY where the panel is anchored, not how tall it is
- This rules out screen-dimension miscalculation as a cause

---

## 4. Five-Layer Cross-Check

| Layer | Truth |
|---|---|
| **Docs (Sheet.tsx header)** | Claims "bottom-anchored drag-to-dismiss panel" with snap-points relative to "screen height". The doc IMPLIES screen-relative positioning; the implementation only achieves it when mounted at root level — implicit contract not enforced or documented. |
| **Code (Sheet.tsx)** | `StyleSheet.absoluteFill` + `position: "absolute"; bottom: 0` — these are layout-tree-relative, NOT screen-relative. |
| **Code (Input.tsx)** | Sheet is rendered as a sibling of the Input main container, deep inside whatever React tree the consumer mounts the Input within. |
| **Runtime (BrandEditView)** | Mount chain: Stack → route host → BrandEditView → KAV → ScrollView → ... → Input → Sheet. Sheet is mounted ~6 layers deep, inside the ScrollView's content container. |
| **Runtime (auth screens)** | Same mount pattern, but ScrollView contentContainer height ≈ viewport height in short auth forms; flaw not previously visible. |

**Layers contradict** — the Sheet's docs imply screen-relative behavior, but the code only achieves that contingent on consumer mount discipline. The contract is implicit and unenforced.

---

## 5. Blast Radius

| Affected | Detail |
|---|---|
| ✅ **BROKEN** — Country picker on `/brand/[id]/edit` | Founder smoke confirms |
| ⚠️ **AT RISK** — Country picker on `/brand/[id]/edit` Phone field anywhere else in long forms | Same mount pattern; same outcome |
| ✅ **WORKS** — Country picker on `/auth/index.tsx` | Short form; contentContainer ≈ viewport (false success) |
| ⚠️ **AT RISK** — `Modal` and `ConfirmDialog` in any long-form ScrollView mount | Same architectural flaw inferred; only works because current consumers mount them at host level |
| ✅ **WORKS** — `BrandSwitcherSheet` (TopSheet) on Home + Account tabs | Mounted at host level (correct); not at risk under current usage |
| ⚠️ **AT RISK** — Future consumers of any kit overlay (Sheet/Modal/TopSheet/ConfirmDialog) | Implicit "mount at host" contract is undocumented and unenforced |

**Cross-domain impact:** none. Mingla Business only. Mingla mobile (`app-mobile/`) and admin (`mingla-admin/`) are on separate codebases with their own overlay primitives.

---

## 6. Hypothesis testing recap

| H | Status | Evidence |
|---|---|---|
| **H-1** Sheet overlay positioned relative to host View, not screen root | ✅ **CONFIRMED** — RC-1 above |
| **H-2** Sheet animation broken on this route | ❌ Refuted — animation works correctly; just happens at wrong screen position. Verified: useSharedValue + withSpring still drives translateY; the panel moves 0→openY correctly relative to its (wrong) anchor. |
| **H-3** KeyboardAvoidingView interferes with overlay | ❌ Refuted — KAV doesn't affect absolute-position resolution; even removing KAV from the tree wouldn't fix RC-1 because the Sheet still sits inside ScrollView. |
| **H-4** Recent flex-column wrapper introduced regression | ❌ Refuted — the flex-column wrapper changed only the inner layout of Sheet's children. The panel's mount position is the bug; flex layout inside the panel is downstream. The wrapper was a correct fix to a separate (subordinate) issue (ScrollView collapse if list were visible at all). Symptoms identical with or without the wrapper. |

**Result:** H-1 is the proven root cause. H-2/H-3/H-4 are eliminated.

---

## 7. Invariant Violations

- **Implicit (undocumented)** — kit overlays must mount at host-level. Was not codified. Consumers (Input.tsx phone variant) violate it.
- **Recommended new invariant:** kit overlay primitives (Sheet, Modal, ConfirmDialog, TopSheet) must mount at the route host level OR use a portal mechanism. For non-portaled primitives, document the mount-level requirement in the primitive's header comment AND in the consumer's documentation.

---

## 8. Fix Strategy (direction only — no spec; orchestrator picks)

Three viable fix directions, ordered by smallest-impact:

### Direction A — Use React Native's native `Modal` to wrap the Sheet's overlay markup (RECOMMENDED — minimum impact)

- React Native ships a `Modal` component that natively portals its content to the OS-level root window
- Wrap the Sheet's outer View in `<RNModal visible={mounted} transparent animationType="none">...</RNModal>`
- The animation logic (Reanimated translateY + scrim opacity) stays inside; only the OUTER mount layer changes
- Single-file change to `Sheet.tsx`. ~10 lines. No API change.
- Side effect: RN Modal handles Android hardware back natively; the Sheet primitive can keep or remove its existing back-button handling
- Side effect: RN Modal disables touches outside its content during display — already the desired behavior
- **Confidence:** HIGH. RN Modal is the industry standard for this use case. Rules out RC-1 and HF-1/HF-2 in one shot for ALL kit overlays that route through the same primitive.

### Direction B — Lift the Sheet render to consumer-level (host-mount discipline)

- Modify Input's phone variant to expose `pickerOpen` state via callback (`onCountryPickerOpen` prop) and `pickerSheet: ReactElement` ref
- Consumer mounts the returned sheet element at host level (sibling of ScrollView)
- Adds API surface to Input. Adds discipline burden on every consumer.
- **Confidence:** MEDIUM. Solves the bug but expands API surface and shifts burden to consumers. Higher long-term maintenance cost.

### Direction C — Add a kit-level OverlayHost / Portal provider

- Mount `<OverlayHost />` at root in `app/_layout.tsx`
- Sheet/Modal/ConfirmDialog/TopSheet all use a `useOverlayPortal()` hook to teleport their content to OverlayHost at render time
- New kit primitive (DEC-079 carve-out — proposed DEC-083 for Portal pattern)
- Largest scope; cleanest long-term architecture; treats HF-1 + HF-2 + RC-1 simultaneously
- **Confidence:** HIGH for correctness, but scope is much larger than the immediate need

**Recommendation:** **Direction A** — wrap Sheet's outer View in React Native's native `Modal` component. Smallest change, fixes RC-1 and HF-1/HF-2 (since Modal/ConfirmDialog can adopt the same pattern in a follow-up if smoke surfaces), no API change. Direction C is a candidate for Cycle-2 polish if future overlay regressions emerge.

---

## 9. Regression Prevention

If Direction A is chosen:
- **Code comment** in Sheet.tsx header documenting the RN Modal portal layer and why it's required
- **Document the mount contract** for kit overlay primitives — consumers can mount at any tree depth because the primitive portals internally
- **Test case** added to spec: open country picker from a long ScrollView form (BrandEditView), verify scrim covers visible viewport and panel anchors at bottom of viewport (not bottom of contentContainer)
- **New invariant proposed (e.g., I-13):** kit overlay primitives must portal to screen root — either via React Native's `Modal` component, or via a dedicated OverlayHost. Direct rendering as React-tree children is forbidden.

---

## 10. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|---|---|---|---|
| D-FORENSICS-COUNTRY-PICKER-1 | Cycle 0a `Modal.tsx` and `ConfirmDialog.tsx` likely share the same architectural flaw (HF-1). Smoke them in long-form ScrollView contexts before assuming they're production-ready. Currently only ConfirmDialog is in active use (BrandEditView host-level mount — works); Modal is not yet consumed by Cycle 1+ surfaces. | Medium | Track for follow-up smoke; if RN Modal portal fix is applied to Sheet via Direction A, apply the same to Modal + ConfirmDialog preemptively |
| D-FORENSICS-COUNTRY-PICKER-2 | TopSheet (DEC-080) has the same pattern (HF-2). Currently safe under existing usage but undocumented constraint. Consider a header-comment update OR adding it to the new I-13 invariant scope. | Low | Track |
| D-FORENSICS-COUNTRY-PICKER-3 | Cycle 0a auth screens never tripped this because the form is short. The issue would have been caught earlier with longer-form smoke testing. Recommend including "tap country picker → verify scrim covers viewport" as a Cycle 0a regression check on every future form-bearing screen. | Info | Track for tester checklist |
| D-FORENSICS-COUNTRY-PICKER-4 | Investigation effort: this is a well-understood RN platform pattern (overlay primitives must portal). Cycle 0a kit shipping without portal is a structural shortfall, not a one-off bug. The orchestrator's prior attempt (flex-column fix) misdiagnosed; the symptoms (transparent, no slide, no anchor) are the hallmark of mis-anchored absoluteFill, not of layout collapse. | Info | Future investigations: when "modal invisible" symptoms appear, check overlay mount depth FIRST. |

---

## 11. Confidence

**HIGH (root cause proven).** All six fields filled. Verification step (c) — lifting the Sheet render to host level — would empirically confirm the diagnosis if executed, but the architectural reasoning is self-evident: `position: "absolute"` resolves to nearest positioned ancestor in RN, which is the ScrollView's contentContainer in this mount tree, and the contentContainer is much taller than the viewport.

The fix direction recommendation (Direction A — RN Modal portal wrapper) is HIGH confidence based on standard React Native overlay patterns. Modal portaling solves the same class of bug across the entire kit overlay family.

---

## 12. Hand-off

Investigation complete. Single file: `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_2_J_A8_COUNTRY_PICKER_BROKEN.md`. No spec written per dispatch §5.

Recommended fix direction: **Direction A** (wrap Sheet's outer View in RN Modal). 1-file change, ~10 lines.

Orchestrator decides next dispatch:
1. Spec the fix per Direction A → implementor → smoke
2. Or spec Direction C (broader portal pattern) if you want to address HF-1 + HF-2 simultaneously

D-FORENSICS-COUNTRY-PICKER-1..4 logged for visibility.

---

**End of country picker investigation.**
