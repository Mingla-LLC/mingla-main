# TEST — ORCH-1315 + ORCH-1314 (joint) — paywall presents from the preferences sheet

- **ORCH-IDs:** ORCH-1315 [preferences-custom-location-paywall-not-firing] + ORCH-1314 [preferences-sheet-curated-paywall-dead-gate]
- **Worktree / branch:** `~/Desktop/mingla-orchs/orch-1315-[preferences-custom-location-paywall-not-firing]/` on `orch-1315-preferences-custom-location-paywall-not-firing`
- **Under test:** product commit `ea01e9ffa`; report `c521f8962` (HEAD at test time)
- **Tester:** mingla-tester · **Date:** 2026-07-05
- **Metro:** worktree, port 8091 (dev-client)

---

## 1. Verdict

**FAIL** — P0: 0 · **P1: 1 (suspected, source-strong)** · P2: 0 · P3: 0 · P4: 2

**Why FAIL (two independent reasons, either sufficient):**
1. **No runtime confirmation of the core presentation on any platform.** The consumer dev-build installed on the only booted iOS sim (`com.mingla.app.v2`) **red-screens at the app ROOT** on `react-native-keyboard-controller` not being linked (`_layout.tsx:39` → `KeyboardRoot.native.tsx:6`) — the exact ORCH-1317 blocker. The app never reaches Home, let alone the preferences sheet. Stubbing `KeyboardRoot` is FORBIDDEN (spec DO-NOT-TOUCH + "temporary stubs reverted; do not reintroduce"); a fresh native build is BLOCKED by the same ORCH-1317 failure. No Android emulator is available. Therefore **every presentation SC (1315 SC-1..SC-6, 1314 SC-1..SC-7) is source-only ⇒ capped at "suspected," which per the tester ladder can never be PASS.**
2. **Suspected P1 geometry defect (the dispatch's explicit FAIL condition).** The `presentInline` overlay is a `position:absolute` **child of gorhom's `BottomSheetScrollView`** (sheet path uses `scrollMode="scroll"`, and `{paywall}` is a direct scroll child). Absolute children of a ScrollView are positioned relative to the **scroll CONTENT**, not the viewport, so they scroll with the content. The overlay's opaque background (`inset:0`) covers the viewport at any scroll offset, but the actual paywall **content** (`inlineViewport`, pinned to content-top) is scrolled off-screen once the sheet has been scrolled before the trigger. The dispatch: *"If it renders off-screen/clipped when scrolled, that is a FAIL condition."* See Finding P1.

This routes back to the orchestrator for (a) a geometry decision/rework and (b) a real runtime pass. It is **not** a rejection of the code's logic — the tests, typecheck, DIAG-zero, and all fails-on-revert proofs are green, and the headline GPS case (top of sheet, scroll≈0) is *likely* correct — but a UI change cannot ship on source reasoning alone, and the scrolled case is a probable trap.

---

## 2. SC-by-SC matrix

Legend: SUSPECTED = source-verified only (runtime blocked); the confidence ceiling for a UI change is "suspected," which is never PASS.

### ORCH-1315 (custom-location / GPS)
| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1-iOS | Free tap gated GPS → paywall overlay over sheet within ~1 frame | **SUSPECTED / BLOCKED** | Source: `{paywall}` mounted inside `<BaseBottomSheet>` window with `presentInline` (PreferencesSheet.tsx:1460-1467, 1558); overlay branch present (CustomPaywallScreen.tsx). Runtime BLOCKED — app red-screens at root (ORCH-1317, §7 screenshot). |
| SC-1-Android | Same on Android | **BLOCKED** | No Android emulator this session; shared JS but Modal-stacking differs — must be verified live. |
| SC-2 | LABEL + LOCK ICON (not just thumb) present paywall (F-3) | **SUSPECTED** | Whole locked GPS row is `TouchableOpacity onPress={onLockedTap}` with button role + a11y label (PreferencesSectionsAdvanced.tsx:196-207). No runtime tap proof. |
| SC-3 | Dismiss returns to sheet, selections intact | **SUSPECTED** | Overlay returns `null` on close; sheet never unmounts (`showPaywall` state only). No runtime proof. |
| SC-4/SC-5 | Mingla+ taps switch OFF → text input, NO paywall | **SUSPECTED** | `isLocked=false` → input renders; gate policy untouched. Could not flip entitlement (runtime blocked before login). |
| SC-6 | read-only participant view (`isEditable=false`) never presents paywall | **SUSPECTED (source PASS)** | `if (!isEditable) return` preserved ahead of both gates (PreferencesSheet.tsx:557,619) and in `onLockedTap` (1303). |
| SC-analytics | `paywall_viewed`/`trackPaywallViewed` still fire | **SUSPECTED (source PASS)** | Analytics `useEffect(isVisible)` untouched; both render modes emit shared `content`. |

### ORCH-1314 (curated)
| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 | Free user sees curated lock banner | **SUSPECTED** | `isCuratedLocked={!canAccess('curated_cards')}` (PreferencesSheet.tsx:1301); banner in `PreferencesSections`. Runtime blocked. |
| SC-2 | Banner tap → curated paywall | **SUSPECTED** | Reachable after Change 1; `onLockedTap` sets `curated_cards` + `setShowPaywall(true)` (1303-1306). |
| SC-3 | Switch tap → paywall, no `intentToggle` mutate | **SUSPECTED (source PASS)** | `handleIntentToggleChange` short-circuits BEFORE `setIntentToggle` (620-628). |
| SC-4 | Every pill tap → paywall, no intent select | **SUSPECTED (source PASS)** | `handleIntentToggle` short-circuits BEFORE `setSelectedIntents` (558-566). |
| SC-5 | Mingla+ → no banner, normal behavior | **SUSPECTED (source PASS)** | `isCuratedLocked=false` for Mingla+; handlers fall through. |
| SC-6 | read-only view → no paywall | **SUSPECTED (source PASS)** | `if (!isEditable) return` preserved first in both handlers. |
| SC-7 | GPS/`custom_starting_point` gate byte-unchanged | **SUSPECTED (source PASS)** | `onLockedTap` block for GPS untouched; row affordance is additive only. |

### Overlay geometry watch-item (report §9.2)
| Item | Result | Evidence |
|------|--------|----------|
| Paywall fully visible + correctly positioned when sheet is scrolled far down before trigger | **FAIL (suspected, source-strong)** | Overlay is a `position:absolute` scroll-child of `BottomSheetScrollView` → content-relative → clipped/off-screen when scrolled. See Finding **P1**. |

### Non-regression (other paywall sites)
| Item | Result | Evidence |
|------|--------|----------|
| ≥2 of the other paywall sites keep the normal RN Modal (presentInline=false) | **PASS (source, structural)** | Only `PreferencesSheet.tsx` + `CustomPaywallScreen.tsx` reference `presentInline`; **SwipeableCards.tsx:3268, DiscoverScreen.tsx:2345, ConnectionsPage.tsx:4010, CalendarTab.tsx:2840, SavedTab.tsx:2107, BillingSheet.tsx:261** pass no `presentInline` → default `false` → `presentationStyle="pageSheet"` Modal path (byte-identical; the only inline-only addition, the close button, is gated `presentInline && (...)`). |

---

## 3. Findings

### P1 — [SUSPECTED, source-strong] `presentInline` overlay is a scroll-child → clipped/off-screen when the sheet is scrolled before the trigger
- **Evidence:** `PreferencesSheet.tsx:1519-1561` — the sheet path uses `<BaseBottomSheet … scrollMode="scroll">` and renders `{headerContent}{bodyContent}{footer}{paywall}` as children. Per `BaseBottomSheet.tsx:648-687` (scroll mode, no `header` slot) those children are DIRECT children of `<BottomSheetScrollView>`. `CustomPaywallScreen.tsx` overlay = `styles.inlineOverlay` (`position:'absolute', top/left/right/bottom:0, zIndex:1000`) with `inlineViewport` (`height: windowHeight`) pinned at the overlay's top. In React Native an absolutely-positioned child of a ScrollView is laid out relative to the **content container** (full content height), and translates with scroll. Sheet content exceeds the 90%-snap viewport and DOES scroll (the file's own ORCH-1043 comments exist precisely to make 5 sections scroll).
- **Impact:** At scroll offset `Y>0` when the paywall opens: the opaque `inlineOverlay` background still covers the viewport (good — sheet hidden), but the paywall **content** (`inlineViewport`, pinned to content-top y=0) is shifted up by `Y`. Once `Y` exceeds the header height (~60px) the **close "X" is off-screen**; once `Y ≥ windowHeight` the paywall is entirely off-screen and the user sees a **blank opaque screen with no visible way to dismiss** (no OS swipe chrome in overlay mode) — a dead-end unless they blind-scroll up. Realistically reachable for: the curated **pills** (below the Switch → typically need a small scroll to tap → close button clipped), and ANY trigger after the user has scrolled the sheet. The headline GPS row sits at the very top (scroll≈0) so the exact reported symptom likely presents correctly.
- **Required fix:** Present the paywall **viewport-relative**, not as a scroll-child. Options: (a) implementor's own flagged fallback — pass the paywall via `BaseBottomSheet`'s `header` slot (viewport-relative, still in-window) — but validate it does not re-trigger the ORCH-1043 scroll-freeze; (b) render the overlay as a sibling of `<BottomSheetScrollView>` inside the `wrapInRNModal` window (needs a BaseBottomSheet affordance — likely a small primitive change, separate allowlist); (c) on `showPaywall=true`, programmatically scroll the sheet's `BottomSheetScrollView` to offset 0 before/as the overlay mounts (cheapest, but a race). Recommend (a) or (b).
- **Retest:** Live-fire on a keyboard-controller-capable iOS build: scroll the preferences sheet ~1 full viewport down, tap a curated pill (and separately toggle GPS after scrolling), confirm the paywall header + close button are fully on-screen and dismissable.

### P4 — [PRAISE] Clean regression isolation via optional-prop default
`presentInline` defaults `false` and only `PreferencesSheet` opts in; the shared `content` block keeps Modal-mode byte-identical for the 6 other call sites. The closed inline path correctly returns `null` (verified by the adversarial test), avoiding a touch-swallowing stray overlay.

### P4 — [NOTE] Legacy full-screen path also uses the inline overlay
`legacyInlineContent` (`PreferencesSheet.tsx:1494`, the `visible===undefined` root mount) renders the same `presentInline` paywall inside its own full-screen SafeAreaView (not a competing Modal) — functionally correct there, but it is ALSO wrapped in a `KeyboardAwareScrollView` (`1479`), so the same scroll-child geometry caveat (P1) applies if that path is exercised while scrolled.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Ran against the working tree at HEAD `c521f8962` (product `ea01e9ffa`), true line-deletion via script, restored via `git checkout --` (tree left clean each time). Runner: `npx tsx` from `app-mobile/`.

| Fix reverted | Test | Reverted | Restored | Failing assertion |
|--------------|------|----------|----------|-------------------|
| ORCH-1315: remove `presentInline` from the preferences paywall element | `orch-1315-…test.tsx` | **exit 1** | exit 0 | `T-A1: … MUST carry presentInline` (line 67) |
| ORCH-1314: `isCuratedLocked={!canAccess('curated_cards')}` → `{false}` | `orch-1314-…test.tsx` | **exit 1** | exit 0 | `Part A: isCuratedLocked MUST be wired to !canAccess('curated_cards')` (line 66) |
| ORCH-1314: remove `!canAccess('curated_cards')` short-circuit from handlers | `orch-1314-…test.tsx` | **exit 1** | exit 0 | `Part A: handleIntentToggleChange must gate on !canAccess('curated_cards')` (line 83) |

All three reverts fail the implementor's tests; all restore green. Implementor happy-path fails-on-revert **independently reproduced**.

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `app-mobile/src/components/__tests__/orch-1315-1314-paywall-inline-closed-null.test.tsx` (NEW, append-only, ORCH-tagged protective header, `require.main===module` self-test).
- **Angle (distinct from implementor):** the implementor tests pin the overlay WHEN VISIBLE + the read-only/Mingla+ behavior. Mine pins the **CLOSED-STATE MOUNT INVARIANT** neither covers: when `presentInline` is true and `isVisible` is false, `CustomPaywallScreen` must render `null` — it must NOT leave its opaque `position:absolute` zIndex-1000 `inlineOverlay` mounted over the sheet (which would silently swallow/misroute touches across the whole sheet while "closed"). Also pins that the non-inline default stays a `visible`-controlled RN `<Modal>` (SC-5 structural).
- **Result:** PASS on correct code. **fails-on-revert verified at `c521f8962`:** making the overlay mount unconditionally (removing the `isVisible ? (…) : null` gate) → **exit 1** (`Part A … MUST be gated on isVisible`, line 85); restore → exit 0; tree clean.
- **In closing diff:** all three test files (`orch-1315-…`, `orch-1314-…`, and this adversarial file) appear in `git diff origin/main...HEAD --name-only` after commit.

---

## 6. Constitution 14-rule matrix (against the diff)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | **AT RISK** | F-3 dead-tap FIXED (whole locked GPS row pressable). BUT P1 geometry can render the overlay's close button off-screen when scrolled → a "closed by no visible control" trap. Flagged. |
| 2 | One owner per truth | PASS | Single shared `{paywall}` element + shared `showPaywall` state; no competing owner. |
| 3 | No silent failures | PASS | Gates short-circuit to a visible paywall; no swallowed errors added. |
| 4 | One query key per entity | N/A | No query keys changed. |
| 5 | Server state server-side | N/A | No Zustand/server-state change. |
| 6 | Logout clears everything | N/A | Unrelated. |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional code. |
| 8 | Subtract before adding | PASS | Removed the dead `isCuratedLocked={false}` and the out-of-window paywall sibling; added the in-window overlay. |
| 9 | No fabricated data | PASS | No data fabricated. |
| 10 | Currency-aware | N/A | Unrelated. |
| 11 | One auth instance | N/A | Uses existing `user`/`canAccess`. |
| 12 | Validate at the right time | PASS | `!isEditable` guard precedes gate in both handlers. |
| 13 | Exclusion consistency | PASS | Mutual-exclusion min-selection logic untouched (runs only past the gate). |
| 14 | Persisted-state startup | N/A | No hydration change. |

No automatic-P0 constitutional violation. Rule 1 flagged as AT-RISK contingent on the P1 geometry outcome.

---

## 7. Device / parity matrix

| Surface | Result | Detail |
|---------|--------|--------|
| Consumer iOS (`app-mobile`) | **BLOCKED** | Booted sim iPhone 17 Pro Max (iOS 26.4). Metro (worktree, 8091) bundled; dev-build `com.mingla.app.v2` **red-screens at app root**: *"The package 'react-native-keyboard-controller' doesn't seem to be linked"* — `_layout.tsx:39` → `KeyboardRoot.native.tsx:6`. Screenshot: `scratchpad/ios_redscreen.png`. None of the 3 touched files import keyboard-controller (blocker is pre-existing ORCH-1317; the installed build lacks the native module; JS half present in node_modules). Cannot reach preferences sheet. |
| Consumer Android (`app-mobile`) | **BLOCKED** | No Android emulator booted; not reachable this session. Same JS red-screen risk if the Android dev-build also lacks keyboard-controller. |
| Buyer/anon Web | N/A | Consumer-only surface. |
| Business iOS / Android | N/A | Different app. |
| Admin Web (adjacent) | N/A | No consumer feature-gate. |
| Business Web preview (adjacent) | N/A | Different app. |
| Physical iPhone (HITL) | **NOT RUN** | Non-interactive session — cannot pause for Seth's live device this turn. This is the fastest unblock (see §Operator-unblock ask). |

**Operator-unblock ask (to make runtime possible):** either (1) Seth drives his physical iPhone (a real signed build with keyboard-controller linked) through: open preferences → tap GPS switch OFF → observe overlay over sheet → scroll down, tap a curated pill → observe overlay position/close-button → dismiss → confirm selections intact; OR (2) provide/point to a consumer dev build (sim or device) with `react-native-keyboard-controller` linked so the Metro-8091 path completes. Native rebuild from this worktree is itself blocked by ORCH-1317.

---

## 8. Gate results (source-verifiable, all green)

- **Typecheck:** `npx tsc --noEmit -p tsconfig.json` — no errors referencing the 3 touched product files (baseline errors elsewhere unchanged).
- **Implementor tests:** `orch-1315-…` PASS, `orch-1314-…` PASS (`npx tsx`).
- **Tester adversarial test:** PASS + fails-on-revert verified (§5).
- **DIAG markers:** `[ORCH-1315-DIAG]` / `[ORCH-1314-DIAG]` — **zero** matches in product code.
- **presentInline blast-radius:** contained to `PreferencesSheet.tsx` + `CustomPaywallScreen.tsx` only.

---

## 9. Discoveries for orchestrator

- **ORCH-1317 blocks ALL consumer-app runtime QA on this session's iOS sim.** The installed `com.mingla.app.v2` dev-build lacks the `react-native-keyboard-controller` native module → hard red-screen at app root for any current-worktree JS. Until a keyboard-controller-linked dev build exists (or ORCH-1317 lands), the tester cannot live-fire ANY consumer UI change on the sim — this is a standing QA blocker, not specific to 1315/1314.
- **Systemic modal-over-modal risk (already in SPEC_ORCH-1315 §2 non-goals):** `BillingSheet` / `ConnectionsPage` / `DiscoverScreen` present `CustomPaywallScreen` and may themselves live inside a sheet context; if ever hosted inside a `wrapInRNModal` sheet they hit the same F-1 silent-drop and should adopt `presentInline`. Separate ORCH.
- **Geometry fix may need a BaseBottomSheet affordance** (a viewport-relative in-window overlay slot) — currently no clean slot exists that is both in-window and outside the scroll content. Consider adding one so future in-sheet overlays are viewport-anchored by construction.

---

## 10. Routing

**FAIL → REWORK (mingla-implementor)** for the P1 geometry (viewport-relative presentation) **and** a real runtime pass (physical iPhone HITL or a keyboard-controller-linked dev build) before CLOSE. Do NOT flip `I-PROPOSED-1315-*` / `I-PROPOSED-1314-*` to ACTIVE until the paywall is proven to present correctly (incl. the scrolled case) on a live device/sim. The gate wiring, dead-tap fix, regression isolation, tests, and DIAG-zero are all green — the blocker is presentation geometry + missing runtime, not the gate logic.
