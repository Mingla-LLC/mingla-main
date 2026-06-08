# IMPLEMENTATION — ORCH-1100 Wave 1B: Glass transparency (RC-2) + Composer interaction (RC-3)

Date: 2026-06-07
Skill: mingla-implementor (Claude)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1100-ui-fixes` on branch `ORCH-1100-ui-fixes` (off clean `origin/main` HEAD `129df41e1`)
Scope: business-app **web only** fixes; native iOS/Android byte-unchanged behavior. CODE + unit tests; no device (Wave-2 interaction harness owns device verification).

Source reports read: `SYNTHESIS_ORCH-1100_BUSINESS_WEB_PARITY_ROOT_CAUSES_AND_STRATEGY.md` (RC-2 + RC-3 fully specified there with file:line). The standalone `_FRONT_B_/_FRONT_C_/DEVICE_RUNTIME` detail files were not present on disk in any worktree/anchor (only the SYNTHESIS + PARITY_BASELINE were committed); the SYNTHESIS + the dispatch brief carried the complete root-cause + file:line detail, so implementation proceeded against those.

Comms ledger: read on entry. Only OPEN entry matching `ALL` is **COMMS-0021** (WARN — provider-neutral seller copy). Factored: this wave makes **zero copy changes**, so the neutral copy is preserved untouched. No BLOCK entry targets this skill / ORCH-1100 / ALL.

---

## TASK 1 — RC-2 Glass transparency (device-proven)

### Root cause (from SYNTHESIS)
On phone web (< 768px) `scripts/inject-mobile-blur-css.mjs` injects `@media (max-width:767px){* { backdrop-filter:none !important }}` to dodge the mobile-web blur compositor crash. `CSS.supports("backdrop-filter")` still returns true, so a naive support check is defeated at runtime: the BlurView renders a glass panel whose blur is stripped → only a ~6% tint over a transparent base. Device-proven: the "Switch brand" TopSheet rendered `background-color: rgba(0,0,0,0)`. Only `SheetMobile` had the correct `!(Platform.OS==="web" && windowWidth<768)` inline guard; the other 5 surfaces had no width awareness.

### Shared helper (single source of truth) — NEW FILE
`mingla-business/src/utils/glassBlur.ts`
- `export const shouldUseRealBlur = (windowWidth: number): boolean` — the ONE decision for every glass surface:
  - iOS → `true` (real UIVisualEffectView blur)
  - Android → `false` (expo-blur backdrop too thin — ANDROID_GLASS_USES_OPAQUE_FALLBACK)
  - web → `false` when `windowWidth < 768` (mirrors the blur-kill media rule) **OR** when `backdrop-filter` is unsupported; `true` otherwise (wide desktop with support).
- `export const supportsBackdropFilter: boolean` — module-scope CSS.supports probe (was duplicated in 4 files).
- `export const MOBILE_WEB_BLUR_KILL_MAX_WIDTH = 768` — pinned to the `@media (max-width:767px)` rule (i.e. `< 768`).

This generalizes the native ANDROID_GLASS_USES_OPAQUE_FALLBACK policy to the web blur-kill case, in one place, so it can't drift per-component.

### The 5 gapped components fixed + SheetMobile refactored

| File | Before | After | Why |
|------|--------|-------|-----|
| `src/components/ui/SheetMobile.tsx` | local `supportsBackdropFilter` + no-arg `shouldUseRealBlur()` + inline `!(web && windowWidth<768)` at L290 | imports shared `shouldUseRealBlur`; `blurOk = shouldUseRealBlur(windowWidth)`; removed local copies + unused `Platform` import | single source of truth (was the canonical reference) |
| `src/components/ui/TopSheet.tsx` (brand switcher — top priority) | local copies; width-blind `shouldUseRealBlur()` | added `useWindowDimensions`; `blurOk = shouldUseRealBlur(windowWidth)`; removed local copies | the worst RC-2 offender (`rgba(0,0,0,0)` on device) |
| `src/components/ui/GlassChrome.tsx` | local copies; width-blind | added `useWindowDimensions`; `blurOk = shouldUseRealBlur(windowWidth)`; removed local copies + unused `Platform` import | chrome surfaces (top bars / navs) went transparent on phone web |
| `src/components/ui/Toast.tsx` | module-scope `blurOk` (no width access) | per-render `blurOk = shouldUseRealBlur(windowWidth)` via `useWindowDimensions`; removed module-scope copies + unused `Platform` import | toast card went see-through on phone web |
| `src/components/marketing/BlastCustomersCta.tsx` | `Platform.OS === "android"` inline only (no web case) | `blurOk = shouldUseRealBlur(windowWidth)`; BlurView/opaque branch flipped to `blurOk ? <BlurView> : <View FALLBACK>`; removed unused `Platform` import | sticky CTA capsule went transparent on phone web |
| `src/components/ari/AiDisclosureModal.tsx` | `BlurViewOrOpaque` checked `Platform.OS === "android"` | `BlurViewOrOpaque` now `useWindowDimensions` + `!shouldUseRealBlur(windowWidth)` → opaque; removed unused `Platform` import | first-launch consent sheet leaked content on phone web |

Opaque fallback fill in every case is the kit `rgba(20, 22, 26, 0.92)` (or AiDisclosureModal's opaque `#1a1416` `opaqueSheet`, both ≥0.92). Desktop (≥768px) appearance unchanged. Native (iOS=blur, Android=opaque) behavior byte-identical (the helper returns exactly what the old per-component checks returned on native).

---

## TASK 2 — RC-3 Composer (device-proven, pre-existing, web-only)

### RC-3 (1) BACK button dead
`app/(tabs)/marketing/campaigns/compose.tsx` — `navigation.addListener("beforeRemove")`
- **Before:** on dirty exit, always `ev.preventDefault?.()` then `Alert.alert(...)`. `Alert.alert` is a NO-OP on react-native-web → nav stayed cancelled forever → Back looked dead.
- **After:** web-gated early branch ABOVE the preventDefault: `if (Platform.OS === "web") { void flushDraft(); return; }`. On web we don't block the exit — the existing debounced autosave (`useComposerDraft` + `flushDraft`) already persists edits; we fire one final flush and let navigation proceed. Native path (preventDefault + `Alert.alert("Save your draft?")` Save/Discard) unchanged.

### RC-3 (2) BODY untappable
- `src/components/marketing/ComposerV2/ComposerV2Editor.tsx`
  - **Before:** `bodyHeight` for non-wide-desktop used the iPhone-pell-tuned `windowHeight - insets - CHROME_CONTENT_PX(376) - keyboardHeight`. On phone web the extra TopBar + MarketingSubNav + browser URL bar overflow the budget → contenteditable collapsed to a ~23px strip.
  - **After:** added `isPhoneWeb = isWeb && !isWideDesktop` (from `useResponsiveLayout`). New phone-web branch: `bodyHeight = Math.max(PHONE_WEB_BODY_MIN_PX (360), Math.round(windowHeight * 0.6))` — a robust floor so the contenteditable always has real, tappable height. Native iOS/Android arithmetic (and the wide-desktop branch) unchanged.
- `src/components/marketing/ComposerV2/ComposerCanvas.web.tsx` (web-only file)
  - **Before:** narrow-web fall-through (`!isWideDesktop`) returned a bare `<>{editor}</>` — no scroll. With a generous fixed body height the column overflows the phone-web viewport and the body bottom + footer were unreachable.
  - **After:** wraps the narrow-web editor column in a `<ScrollView keyboardShouldPersistTaps="handled">` (+ `narrowScroll`/`narrowScrollContent` styles, `flexGrow:1` so short composers still fill, tall ones scroll). This is WEB-ONLY (`.web.tsx`); the native pell "NO ScrollView around the editor" constraint (`ComposerCanvas.tsx` Fragment passthrough) is untouched — verified by test.

Native iOS pell layout is web-gated out via the `.web.tsx` split + `isPhoneWeb` flag — byte-unchanged.

---

## Regression tests (Step 0.5) + fails-on-revert

All under the closing diff (shipped in the same branch as the fix).

### NEW tests
1. `src/utils/__tests__/glassBlur.test.ts` — **runtime** test of the real helper logic (mocks `react-native` Platform + `globalThis.CSS`, `jest.isolateModules` per case). Asserts iOS=blur, Android=opaque, phone-web(<768)=opaque, desktop-web(≥768)=blur, breakpoint=768.
   - Fails-on-revert: removing `if (windowWidth < MOBILE_WEB_BLUR_KILL_MAX_WIDTH) return false;` → "phone web (< 768px) uses the opaque fallback" FAILS. ✅ verified.
2. `src/components/__tests__/orch1100GlassTransparency.test.ts` — source/structural gate over all 6 surfaces (5 gapped + SheetMobile): each imports the shared helper, calls `shouldUseRealBlur(windowWidth)` (not the old no-arg form), reads a live `useWindowDimensions` width, keeps the ≥0.92 opaque fallback, and defines NO local `supportsBackdropFilter`/`shouldUseRealBlur` (single source of truth).
   - Fails-on-revert: reverting TopSheet to `shouldUseRealBlur(9999)` (width-blind) → "TopSheet is width-aware" FAILS. ✅ verified.
3. `src/components/marketing/__tests__/orch1100ComposerInteraction.test.ts` — composer web back-guard (web branch returns before preventDefault; native Alert guard preserved; web-before-preventDefault ordering) + body-scroll (`isPhoneWeb` flag, `PHONE_WEB_BODY_MIN_PX` 360 floor, narrow-web ScrollView wrap, native ComposerCanvas stays a bare Fragment).
   - Fails-on-revert: removing the compose.tsx web branch → 3 tests FAIL; reverting ComposerCanvas.web to bare `<>{editor}</>` → narrow-web-ScrollView test FAILS. ✅ both verified.

### MODIFIED existing tests — `[TEST-MOD-APPROVED ORCH-1100]`
RC-2 legitimately moved the per-component `Platform.OS==="android"` opaque-fallback decision into the shared helper, which the META-ORCH-1002 source tests pinned by *location*. The BEHAVIORAL guarantees they protect (iOS=blur, Android=opaque ≥0.92, kit fallback fill, no iOS-reachable opaque path) are **preserved** — re-pointed at the shared helper. The append-only CI gate honors `[TEST-MOD-APPROVED ORCH-1100]` in the commit body.
- `src/components/__tests__/metaOrch1002SubDBusinessGlass.test.ts` — 3 straggler describe-blocks (Toast / AiDisclosureModal / BlastCustomersCta) re-pointed at `shouldUseRealBlur(windowWidth)`. The no-flatten Symptom-A sweep assertions are untouched.
- `src/components/__tests__/metaOrch1002SubDBusinessGlass.adversarial.test.ts` — the B/C straggler block re-pointed; the cross-file "iOS never opaque" assertion, the Part A no-flatten diff harness, and the Part D shadow-clip detector are untouched.

### Test run (anchor node_modules via symlink; worktree cwd)
```
jest glassBlur.test orch1100GlassTransparency orch1100ComposerInteraction metaOrch1002SubDBusinessGlass --runInBand
→ Test Suites: 1 failed, 4 passed, 5 total ; Tests: 1 failed, 80 passed, 81 total
```
The single failure is **pre-existing and not caused by this wave**: `metaOrch1002SubDBusinessGlass.adversarial › diff harness sanity` runs `git diff origin/main...HEAD` and requires > 150 `overflow:'hidden'` blocks — that only holds on the META-ORCH-1002 PR branch. Verified it ALSO fails on a clean `git stash`ed origin/main checkout (1 failed, 6 passed). Flagged in Discoveries.

Adjacent suites (`metaOrch1002AndroidGlass Sheet.web Toast.test useResponsiveLayout orch_1096`) → 6 suites / 36 tests all PASS.

---

## Gates

- **web:export:** `expo export -p web --output-dir web-build --clear` → `Exported: web-build` with the full route set (real bundle, not a degenerate "No routes found"). PASS.
- **tsc --noEmit:** 260 errors with my changes; **260 errors on clean origin/main** (identical) — I added ZERO new type errors. The baseline noise is from the symlinked-node_modules package resolution (`@mingla/payments-native`, `packages/brand-rendering` react) + pre-existing test typings; none reference any file I touched (0 errors in glassBlur/TopSheet/GlassChrome/Toast/BlastCustomersCta/AiDisclosureModal/SheetMobile/compose/ComposerV2Editor/ComposerCanvas).
- **Native untouched:** every change is web-gated — `shouldUseRealBlur` returns the exact old native value (iOS=true/Android=false); the composer back web-branch returns ABOVE the native `Alert.alert`; the composer body fix is `isPhoneWeb`-gated + lives in `ComposerCanvas.web.tsx`; `ComposerCanvas.tsx` (native) stays a bare Fragment (test-asserted). No `app-mobile/` files touched. No Stripe / schema / edge / migration changes.

---

## Cross-surface impact (Step 3.5)
- **Buyer/anon web + Business web preview (3 + 7):** AFFECTED — glass surfaces now opaque on phone web; composer Back works + body tappable/scrollable on phone web. Parity automatic (shared helper / web-gated splits).
- **Consumer iOS/Android (1,2):** UNAFFECTED — no `app-mobile/` touch.
- **Business iOS/Android (4,5):** UNAFFECTED behavior — web-gated; native returns identical values.
- **Admin web (6):** UNAFFECTED — these components are mingla-business only.

## Discoveries for orchestrator
1. **Pre-existing flaky gate:** `metaOrch1002SubDBusinessGlass.adversarial › diff harness sanity` fails on any branch where the META-ORCH-1002 overflow:'hidden' sweep is already merged into `origin/main` (it diffs HEAD vs origin/main and needs >150 clipped blocks). Confirmed failing on clean origin/main. Recommend the orchestrator register a follow-up to make that one test branch-agnostic (read absolute HEAD state, not the diff) or retire it post-merge.
2. The standalone `INVESTIGATION_ORCH-1100_FRONT_B/_FRONT_C/DEVICE_RUNTIME.md` detail files are not committed anywhere reachable (only SYNTHESIS + PARITY_BASELINE are). Not blocking (SYNTHESIS carried the detail) but the orchestrator may want them archived.

## Transition items
None.
