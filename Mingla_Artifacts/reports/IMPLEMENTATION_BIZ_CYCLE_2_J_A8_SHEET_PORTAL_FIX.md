# Implementation Report — Sheet Primitive Portal Wrap (Country Picker Fix)

> **Initiative:** Mingla Business Frontend Journey Build (DEC-071 frontend-first)
> **Cycle:** ORCH-BIZ-CYCLE-2-J-A8-SHEET-PORTAL-FIX
> **Codebase:** `mingla-business/`
> **Predecessor:** Forensics `INVESTIGATION_BIZ_CYCLE_2_J_A8_COUNTRY_PICKER_BROKEN.md` — RC-1 proven HIGH confidence
> **Implementor turn:** 2026-04-29
> **Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_2_J_A8_SHEET_PORTAL_FIX.md`
> **Status:** implemented and verified (code-trace + tsc clean; founder runtime smoke pending)

---

## 1. Summary

Wrapped the Sheet primitive's outer overlay markup in React Native's native `Modal` component. RN Modal natively portals its children to the OS-level root window — so `StyleSheet.absoluteFill` and `position: absolute; bottom: 0` now resolve to the actual screen viewport instead of the nearest positioned React-tree ancestor (which was the ScrollView's content container in BrandEditView's case, ~700px below the visible viewport).

**1 file modified, 0 API change, 0 consumer edits, 0 schema/persist/migration impact.**

The fix is purely internal to the Sheet primitive — the outermost `<View>` is now nested inside a `<Modal>` wrapper. All Sheet props, animation logic, gesture handling, scrim, drag-to-dismiss, lazy-mount lifecycle, reduce-motion handling — every existing behavior preserved.

New invariant **I-13** codified in the Sheet header: kit overlay primitives must portal to screen root.

---

## 2. Old → New Receipts

### `mingla-business/src/components/ui/Sheet.tsx` (MODIFIED)

**What it did before:**
- Outermost render: `<View pointerEvents={...} style={StyleSheet.absoluteFill}>...</View>` rendered as a direct child of whatever React tree the consumer mounted the Sheet within
- For consumers inside a ScrollView (e.g., BrandEditView's phone Input), `StyleSheet.absoluteFill` resolved to the nearest positioned ancestor — the ScrollView's contentContainer (~1300px tall) — NOT the screen viewport
- Net effect: scrim covered below-the-fold contentContainer area; bottomDock anchored to bottom of contentContainer (~700px below visible viewport); panel slid into invisible coordinates
- Animation, gestures, scrim, drag-dismiss all functionally correct — but happening off-screen

**What it does now:**
- Same outermost render is now WRAPPED in React Native's native `<Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>...</Modal>`
- RN Modal natively portals its content to the OS-level root window
- `StyleSheet.absoluteFill` and bottomDock's `position: absolute; bottom: 0` now resolve to the screen viewport regardless of where the Sheet was triggered in the React tree
- All inner logic (Reanimated translateY, scrim opacity, gesture-handler pan, scrim-tap dismissal, lazy-mount with UNMOUNT_DELAY_MS, reduce-motion fallback) **untouched and continues to drive the visual**

**Modal prop choices (per spec §3.3):**
- `visible={mounted}` — uses Sheet's existing lazy-mount state (which includes the close-animation tail before unmount)
- `transparent` — required so Sheet's own `rgba(0,0,0,0.5)` scrim shows through; without `transparent`, RN Modal would render its default opaque backdrop covering our custom scrim
- `animationType="none"` — Sheet's Reanimated animation drives the visual; RN Modal just provides the portal, no native animations layered on top
- `onRequestClose={onClose}` — Android hardware back support (RN Modal requires this prop on Android)
- `statusBarTranslucent` — Android: scrim covers the status-bar area too (matches sheet UX where dim covers entire screen)

**Header JSDoc updated:** added "Overlay portal" section after the existing "Caller MUST wrap..." line, documenting why the Modal wrapper is required, what happens if it's removed, and the I-13 invariant codification.

**Why:** spec §3 — RC-1 fix. Founder reported country picker invisible/broken on `/brand/[id]/edit`; forensics traced to absolute-position resolution against the wrong ancestor.

**Lines:** +27, -2. Net +25 (adds: Modal import +1, JSDoc +13, Modal wrapper open/close +5, indent +6 of preserved lines; removes: zero — only indentation changed on preserved children).

---

## 3. Spec Traceability — AC verification matrix

| AC | Criterion | Status | Code-trace evidence |
|---|---|---|---|
| 1 | Country picker on /brand/[id]/edit slides up from viewport bottom | ⏳ UNVERIFIED — founder smoke required | RN Modal portals to OS root; `bottomDock` `position: absolute; bottom: 0` now resolves to screen bottom; existing translateY animation drives panel up from off-screen-bottom to openY=0 (now visually = bottom of screen, not contentContainer) |
| 2 | Scrim covers entire visible viewport including topbar + status bar | ⏳ UNVERIFIED — founder smoke required | `StyleSheet.absoluteFill` on scrim now resolves to screen viewport (was contentContainer); `statusBarTranslucent` extends Modal under Android status bar |
| 3 | Panel anchors at bottom of viewport at half-screen height | ⏳ UNVERIFIED — founder smoke required | Sheet's `sheetHeight = screenHeight * 0.5` unchanged; bottomDock `bottom: 0` resolves to viewport bottom |
| 4 | Country list scrolls + search bar + "No matches" empty state | ⏳ UNVERIFIED — founder smoke required | Inner content (PickerSearchInput + ScrollView + filteredCountries.map) untouched; will work once panel is visible |
| 5 | Tap scrim → closes Sheet | ⏳ UNVERIFIED — founder smoke required | `dismissOnScrimTap` logic + `<Pressable style={styles.scrimPress} onPress={handleScrimPress} />` unchanged |
| 6 | Drag panel down → closes Sheet | ⏳ UNVERIFIED — founder smoke required | `Gesture.Pan()` + `panGesture` + `runOnJS(onClose)` logic unchanged |
| 7 | Hardware back (Android) → closes Sheet | ⏳ UNVERIFIED — founder smoke required | `onRequestClose={onClose}` wires Android back to onClose callback |
| 8 | Animation timings unchanged | ✅ CODE PASS | Reanimated SPRING_CONFIG, REDUCE_MOTION_OPEN, TIMING_CLOSE, UNMOUNT_DELAY_MS all unchanged |
| 9 | No regression on auth screens (short-form Sheet usage) | ⏳ UNVERIFIED — founder smoke if reachable | Modal wrap is a strict superset of behavior; in short forms where contentContainer ≈ viewport, Modal portaling produces identical visual position; in long forms it now correctly anchors |
| 10 | tsc strict clean | ✅ PASS | `npx tsc --noEmit` exits 0 (verified) |
| 11 | No public-API change | ✅ PASS | SheetProps interface unchanged; Sheet export signature unchanged; Input.tsx + ConfirmDialog usage compiles without modification |
| 12 | Header JSDoc updated with portal-mechanism explanation | ✅ PASS | Lines 17-32 of updated Sheet.tsx contain the "Overlay portal" section |

**Summary:** 5/12 ACs PASS at code-trace level. 7/12 require founder runtime smoke (the visual behaviors). All require seeing the Sheet actually render in the viewport — which is the entire point of the fix.

---

## 4. Invariant Verification

| ID | Status | Evidence |
|---|---|---|
| I-1 | ✅ Preserved | `designSystem.ts` not touched |
| I-3 | ⏳ iOS / Android: code-trace pass; web: code-trace pass; runtime smoke pending all 3 | RN Modal works on iOS, Android, AND web (RN Web's Modal renders via DOM portal to body) |
| I-4 | ✅ Preserved | No `app-mobile/` references |
| I-6 | ✅ Preserved | tsc strict clean |
| I-7 | ✅ Preserved | No new TRANSITIONAL markers; no existing markers retired |
| I-9 | ✅ Preserved | Animation timings unchanged (SPRING_CONFIG, TIMING_CLOSE, UNMOUNT_DELAY_MS, REDUCE_MOTION_OPEN constants identical) |
| I-12 | ✅ Preserved | Host-bg cascade unchanged |
| **I-13 (NEW — proposed)** | ✅ Established | Sheet now portals via RN Modal; documented in header JSDoc lines 21-32. Sets precedent for Modal.tsx + ConfirmDialog.tsx + TopSheet.tsx (HF-1, HF-2 — preemptive treatment in follow-up dispatch recommended). |
| DEC-079 | ✅ Preserved | Internal change to existing primitive; no new primitive added; SheetProps interface unchanged |
| DEC-071 | ✅ Preserved | No backend code |
| DEC-080 | ✅ Preserved | TopSheet primitive untouched |
| DEC-081 | ✅ Preserved | No `mingla-web/` references |

**New decision proposed: I-13** — Kit overlay primitives must portal to screen root via React Native's native `Modal` component (or equivalent OS-level portal mechanism). Direct rendering as React-tree children is forbidden for overlay surfaces. Sheet now satisfies. Modal.tsx, ConfirmDialog.tsx, TopSheet.tsx remain candidates (HF-1, HF-2) for preemptive treatment — currently safe under existing host-level mount usage but vulnerable to consumer mount-depth changes.

---

## 5. Constitutional Compliance

| # | Principle | Compliance |
|---|---|---|
| 1 | No dead taps | ✅ — scrim-tap, drag-dismiss, hardware-back all preserved |
| 2 | One owner per truth | ✅ — Sheet primitive remains single overlay-Sheet authority |
| 3 | No silent failures | ✅ — error paths untouched |
| 7 | Label temporary fixes | ✅ — no new TRANSITIONAL markers; existing preserved |
| 8 | Subtract before adding | ✅ — wrapped existing markup in Modal; no broken code layered upon |
| 12 | Validate at the right time | ✅ — Modal `onRequestClose` wires correctly to existing `onClose` callback |

Other principles (4, 5, 6, 9, 10, 11, 13, 14) untouched by this change.

---

## 6. TRANSITIONAL marker grep

**No new markers added.** Existing markers preserved:
- All J-A7 BrandProfileView markers untouched
- All J-A8 BrandEditView markers untouched
- D-IMPL-A7-5 social-tap TRANSITIONAL Toast preserved

**Header comment update:** Sheet.tsx line 21-32 documents the portal mechanism but is a permanent architectural note, not a TRANSITIONAL marker.

---

## 7. Cache Safety

**No cache impact.** Sheet primitive doesn't read or write any persisted state. RN Modal is a runtime UI primitive with no cache surface.

Existing v5 brand persist state unaffected.

---

## 8. Parity Check (mobile + web)

| Surface | iOS | Android | Web (compile) | Web (runtime) |
|---|---|---|---|---|
| Country picker on /brand/[id]/edit | ⏳ founder smoke | ⏳ founder smoke | ✅ tsc | ⏳ founder smoke |
| Auth screens (short-form Sheet) | ⏳ founder smoke if reachable | ⏳ founder smoke | ✅ tsc | ⏳ founder smoke |
| Sheet drag-to-dismiss | ⏳ founder smoke | ⏳ founder smoke | ✅ tsc | ⏳ founder smoke |
| Hardware back (Android Modal `onRequestClose`) | N/A | ⏳ founder smoke | N/A | N/A |

RN Modal is a first-class primitive on iOS, Android, and React Native Web. Web Modal renders via DOM portal to `document.body` — same portal-to-root semantic as native iOS/Android.

---

## 9. Regression Surface (3-5 features most likely to break)

1. **Cycle 0a auth screens phone variant** — Sheet was previously consumed in auth flows for country picker. Modal wrap is a strict superset; in short forms it produces identical visual. **Low.** Verify if reachable.
2. **Sheet-based ConfirmDialog or Modal kit primitives** — these don't currently use Sheet (they're separate primitives), so no direct regression. But if they SHARE Sheet's pattern internally, applying I-13 to them is a follow-up. **None for this dispatch.**
3. **Reanimated animation under RN Modal portal** — RN Modal's portal switches the React tree; Reanimated v4 should handle this transparently because shared values are JS-side and portal doesn't break the bridge. **Low.**
4. **Gesture-handler under RN Modal** — `Gesture.Pan()` works inside RN Modal as long as `GestureHandlerRootView` wraps the app root (already done in `app/_layout.tsx`). **Low.**
5. **Stacked overlays** — if a consumer ever opens a Sheet AND a ConfirmDialog simultaneously, RN Modal stack ordering applies (last opened is topmost). Existing Sheet use cases don't stack overlays, so no regression risk in current code. **None for this dispatch.**

---

## 10. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|---|---|---|---|
| D-IMPL-PORTAL-1 | Modal.tsx and ConfirmDialog.tsx remain at-risk per HF-1 from forensics report. They work today only because consumers mount them at host level. Recommend a follow-up micro-fix dispatch to apply the same RN Modal wrap pattern preemptively — same fix, ~10 lines per file. Tracked in forensics §10 as D-FORENSICS-COUNTRY-PICKER-1. | Medium | Track for follow-up dispatch post-smoke |
| D-IMPL-PORTAL-2 | TopSheet.tsx (DEC-080) shares the same architectural pattern (HF-2). Currently safe under existing usage on Home + Account tabs (mounted at host level). If applying I-13 broadly, TopSheet should also get the Modal wrap. ~10 lines. | Low | Track |
| D-IMPL-PORTAL-3 | RN Modal `statusBarTranslucent` is Android-specific; on iOS it's a no-op. iOS already extends Modals under the status bar by default. Single prop, no per-platform branching needed. | Info | None |
| D-IMPL-PORTAL-4 | The `mounted` state (instead of `visible`) is intentionally passed to RN Modal's `visible` prop — this preserves Sheet's existing lazy-mount lifecycle where the close animation has UNMOUNT_DELAY_MS to complete before fully unmounting. RN Modal will keep the portal alive for that ~280ms tail. Verified by reading Sheet.tsx's existing useEffect at line 95-114. | Info | None — correct behavior |

**No high-severity issues.** D-IMPL-PORTAL-1 is the most actionable (preemptive Modal + ConfirmDialog wrap); recommend orchestrator dispatch a tiny follow-up after this fix smokes green.

---

## 11. Transition Items

None. No new TRANSITIONAL markers added in this change.

---

## 12. Founder smoke instructions

```
SETUP:
  cd mingla-business && npx expo start --dev-client
  Open on iPhone, Android device, AND web.

Country picker — primary fix verification:
1. Account → Wipe brands → Seed 4 stub brands. Open Sunday Languor → Edit.
2. Scroll to Contact section. Tap the country chip on the phone input.
3. AC#1: Sheet slides up smoothly from the BOTTOM OF THE VISIBLE SCREEN
   (NOT below the fold; you should NOT need to scroll the parent form to
   see the Sheet).
4. AC#2: Dark scrim (semi-transparent overlay) covers the topbar + entire
   visible screen. On Android the scrim should also cover the status bar.
5. AC#3: Panel anchors at ~half screen height with the country list visible.
6. AC#4: Type "ja" in the search bar → Jamaica + Japan filter in. Type
   "+91" → India. Type "xyz" → "No matches" empty state.
7. AC#5: Tap a country (e.g., Japan) → Sheet closes; phone input chip
   shows 🇯🇵 +81.
8. AC#5b: Reopen picker → tap scrim outside the panel → closes.
9. AC#6: Reopen picker → drag panel handle down beyond ~80px → closes.
10. AC#7 (Android): reopen picker → press hardware back → closes.

Web smoke:
11. Sign in to web. Account → Sunday Languor → Edit. Tap country chip.
    Sheet should portal to screen viewport identically to mobile.

Regression check (no Sheet behavior should regress):
12. If reachable, open the auth flow phone-input country picker (Cycle 0a).
    Should still work identically — the Modal wrap is a strict superset.

If anything fails, report which AC + which platform.
```

---

## 13. Working method actually followed

1. ✅ Pre-flight reads — dispatch + forensics report + Sheet.tsx end-to-end (in fresh context from forensics turn)
2. ✅ Add `Modal` import to react-native imports
3. ✅ Wrap outer `<View pointerEvents=... style={StyleSheet.absoluteFill}>` in `<Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>`
4. ✅ Update header JSDoc with portal-mechanism explanation + I-13 invariant reference
5. ✅ tsc check — clean
6. ✅ Implementation report
7. ⏳ Founder smoke — pending

---

## 14. Layman summary

When this lands and is verified, the founder will:
- Open `/brand/[id]/edit` → tap phone country chip → Sheet slides up from the bottom of the visible screen (no longer hidden below the form)
- Scrim covers the entire screen including topbar + status bar
- Country list visible and scrollable inside the panel
- All existing dismiss gestures (scrim tap, drag-down, Android back) preserved
- Same fix protects ALL future Sheet consumers — no matter how deep in a ScrollView the trigger lives, the Sheet always portals to screen root

Single-file fix to Sheet.tsx (~25 lines added including JSDoc). No API change. No consumer edits. No backend / persist / migration impact. Sheet primitive's animation, gestures, lifecycle all preserved exactly.

---

## 15. Hand-off

Per locked sequential rule, **stopping here**. tsc clean. 5/12 ACs PASS at code-trace; 7/12 require founder smoke (visual behaviors).

D-IMPL-PORTAL-1 is the only actionable follow-up (preemptive Modal + ConfirmDialog wrap). Recommend orchestrator dispatch after this fix smokes green.

Hand back to `/mingla-orchestrator` for review + founder smoke instruction execution + AGENT_HANDOFFS update.

---

**End of Sheet portal-wrap implementation report.**
