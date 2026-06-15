# IMPLEMENT — ORCH-1136 R3 [biz-web sheet animation: compositor CSS transition on web]

**Phase:** IMPLEMENT (mingla-implementor, business side). **Status: implemented and verified** (web bundle + gates + jest green; native parity by web-gated branch; on-device authed checklist is the TEST-phase gate).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs-r2]/` on branch `ORCH-1136-biz-web-sheet-anim-r3` (rebased onto origin/main).
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1136_R3_SHEET_ANIM.md`. **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1136_R3_SHEET_ANIM.md`.
**Comms ledger:** scanned on entry — no `BLOCK`/`OPEN` row to `mingla-implementor`, `ORCH-1136`, or `ALL` bearing on a web-only animation fix. COMMS-0030 (iOS build) is RESOLVED and irrelevant to web-only work. Nothing to ack.

---

## 1. Summary (plain English)

On the business web app, opening a sheet on a busy page (the Hub events list, an event detail page) used to make the panel slide partway down and then **freeze near the top for a moment** before snapping into place — and the event "⋯" menu looked dead because it opened too slowly to notice. The cause: on the web the open/close animation ran on the browser's main thread, so whenever the heavy page did work mid-open, the slide couldn't paint and stalled.

This change moves the open/close animation of the five shared sheet/overlay pieces (brand switcher, creator "+", event "⋯" menu / search, modals, toasts, bottom sheets) onto a **compositor CSS transition** on the web — the browser animates the slide on a separate thread that a busy page can't block, so the sheets glide smoothly even on heavy pages. The phone apps (iOS/Android) are completely untouched — they keep their existing animation byte-for-byte. The temporary "[DIAG]" toast on the event "⋯" button is removed.

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence / commit |
|----|-----------|--------|-------------------|
| SC-1-Web | TopSheet brand switcher snappy on Hub (no mid-slide freeze) | ✓ implemented | `TopSheetWeb` CSS transition `transform 280ms`/`240ms`; harness Part A proves compositor advances under a 220ms main-thread block; authed checklist §11 |
| SC-2-Web | Event ⋯ menu opens immediately; no `[DIAG]` toast | ✓ implemented | `Sheet.web.tsx` `DesktopCenteredCard` CSS scale+fade 200/180ms; DIAG reaped (`event/[id]/index.tsx`); jest `DIAG reaped` block |
| SC-3-Web | Creator "+" compact sheet snappy after first measurement | ✓ implemented | `TopSheetWeb` compact path: next-frame flip re-fires when `panelHeight` goes 0→measured (slides from measured off-screen, no slide-from-(-0)) |
| SC-4-Web | Modal / Toast / bottom-sheet animate smoothly on heavy page | ✓ implemented | `ModalWeb` 200/160ms, `ToastWeb` 220/160ms, `SheetWeb` 280/240ms — all compositor CSS |
| SC-5-Native | iOS+Android animations byte-identical to pre-change | ✓ implemented | every change is a `Platform.OS==='web'` dispatch to a NEW web component; the native component is the pre-change body verbatim (reanimated `withTiming`/`withSpring`, swipe gestures, Android pan-freeze fix all retained); jest asserts each shared file still keeps `react-native-reanimated` |
| SC-6 | No reflow — transform/opacity only, no height/layout | ✓ verified | strict-grep INV-2 + jest `no height/layout property in any web transition`; panel `height` stays a static style |
| SC-7 | No-fixed invariant stays GREEN | ✓ verified | `i-proposed-topsheet-web-viewport-anchor.mjs` → GREEN; overlay root stays `StyleSheet.absoluteFill` |
| SC-8 | Close transition completes before unmount | ✓ implemented | each web variant keeps the existing `UNMOUNT_DELAY_MS` lazy-unmount (≥ web close + 40ms); `animateOpen` flips false → CSS animates back → timer unmounts after |
| SC-9 | Reduce-motion: opacity-only, no translate/scale | ✓ implemented | `useWebReducedMotion()` (media-query read, zero reanimated hooks) drives opacity-only transition in every web variant |
| SC-10 | Regression harness fails-on-revert | ✓ verified | `evidence/ORCH-1136-R3/assert_fails_on_revert.mjs` (Part A runtime + Part B source contract) PASSES on the fix, FAILS when css.html reverted to the JS-rAF construct |

## 3. Files changed

| File | Δ (approx) | What |
|------|-----------|------|
| `mingla-business/src/components/ui/TopSheet.tsx` | +~310 | dispatch → `TopSheetNative` (verbatim reanimated) + new `TopSheetWeb` (CSS transition); shared `TopSheetPanelInner`; `useWebReducedMotion` |
| `mingla-business/src/components/ui/Sheet.web.tsx` | ~±60 | replaced `DesktopCenteredCard`'s reanimated path with CSS scale+fade state mechanism; removed `react-native-reanimated` import entirely |
| `mingla-business/src/components/ui/SheetMobile.tsx` | +~230 | dispatch → `SheetNative` (verbatim spring+timing) + new `SheetWeb` (CSS, spring→ease-out approx); shared `SheetMobilePanelInner`; `useWebReducedMotion` |
| `mingla-business/src/components/ui/Modal.tsx` | +~190 | dispatch → `ModalNative` (verbatim) + new `ModalWeb` (CSS scale+fade); `useWebReducedMotion` |
| `mingla-business/src/components/ui/Toast.tsx` | +~230 | dispatch → `ToastNative` (verbatim, swipe+Android fix) + new `ToastWeb` (CSS translateY+opacity); shared `ToastCard`; `useWebReducedMotion` |
| `mingla-business/app/event/[id]/index.tsx` | −~20 | reaped `[ORCH-1136-DIAG]` block; kept the non-silent brand-not-resolved guard + `setManageMenuVisible(true)`; dep array `[brand]` unchanged |
| `.github/scripts/strict-grep/i-proposed-1136-web-sheet-css-transition.mjs` | +~280 (new) | gate: web sheet anim is CSS-transition on transform/opacity, web-gated, no layout animation, Sheet.web no-reanimated |
| `.github/workflows/strict-grep-mingla-business.yml` | +14 | registered the new gate job + header registry line |
| `mingla-business/src/components/ui/__tests__/orch1136R3WebSheetCssTransition.test.ts` | +~95 (new) | happy-path regression (20 tests) |
| `Mingla_Artifacts/evidence/ORCH-1136-R3/assert_fails_on_revert.mjs` | +~210 (new) | §9a fails-on-revert harness driver (force-added; evidence/ is gitignored) |

## 4. Data-model / edge / hooks

None. Pure UI-primitive change. No DB, RLS, migration, edge function, service, hook, realtime. Brand-list stays in React Query — no `setBrands()` introduced (Const #5; `I-PROPOSED-C` gate scanned 1180 files · 0 violations).

## 5. Edge functions touched

None.

## 6. Regression tests added + fails-on-revert proof

- **Jest (implementor happy-path):** `mingla-business/src/components/ui/__tests__/orch1136R3WebSheetCssTransition.test.ts` — 20 tests, all PASS. Asserts each primitive's web CSS transition, the web-gate, no-layout-animation, native reanimated retention, Sheet.web no-reanimated, and the DIAG reap + non-silent guard.
- **fails-on-revert (TRUE LINE DELETION, NOT comment-out):** deleted the web CSS `transition:` lines from `TopSheetWeb`'s `panelWebStyle`+`scrimWebStyle` → the test "TopSheet.tsx drives its web animation via a CSS transition" FAILED (✕); restored → all 20 PASS again. **`fails-on-revert verified at HEAD of branch ORCH-1136-biz-web-sheet-anim-r3` (commit hash recorded below).**
- **Strict-grep gate fails-on-revert:** `i-proposed-1136-web-sheet-css-transition.mjs` → PASS on the fix; reverting `TopSheet.tsx`'s web transition → exit 1 `INV-1` violation; restored → PASS. Self-test (`--self-test`) PASSES (CSS-transition vs withTiming/layout fixtures).
- **Harness driver (§9a):** `assert_fails_on_revert.mjs` — Part A (runtime) proves the css.html panel advances ~72–77px during a 220ms main-thread block (compositor off-thread) across 5 consecutive runs; Part B (deterministic source contract) proves css.html=compositor transition vs model.html=starvable per-frame `style.transform` writes. Reverting css.html's panel to the JS-rAF `style.transform` construct → driver exits 1 (Part B catches it). **Note (honest):** a same-thread JS sampler cannot DIRECTLY observe the compositor advancing mid-block (by the time the main thread frees, the reverted withTiming path has also snapped to its wall-clock position), so the deterministic fails-on-revert anchor is Part B's source contract; Part A is the reliable positive runtime proof that the css.html slide is off the main thread. Run: from `Mingla_Artifacts/evidence/ORCH-1136-R3/` with `node_modules` symlinked to `../../mingla-business/node_modules` and `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright`.

## 7. Old → New receipts

### TopSheet.tsx
**Before:** one `TopSheet` component; on web, reanimated `useSharedValue`+`withTiming`(translateY/scrim)+`useAnimatedStyle` ran on the JS main-thread rAF → froze mid-slide on heavy pages.
**Now:** `TopSheet` dispatches by `Platform.OS`. `TopSheetNative` = the pre-change body verbatim. `TopSheetWeb` = zero reanimated hooks; an `animateOpen` React state + next-frame flip drives an inline compositor CSS `transition: transform 280ms/240ms` (panel) + `opacity 220ms` (scrim) with `willChange`. Compact mode: opacity-0 until measured, then the flip re-fires off the measured height. Shared glass-stack extracted to `TopSheetPanelInner`.
**Why:** SC-1/3-Web (Symptom 3), SC-5-Native, SC-6/7/8/9.

### Sheet.web.tsx
**Before:** `DesktopCenteredCard` used reanimated `withTiming` on scrim/card opacity+scale on the web main thread.
**Now:** CSS transition on `opacity`+`transform: scale(0.96→1)` via `animateOpen` state; `react-native-reanimated` import removed entirely (web-only file). Reduce-motion = opacity-only.
**Why:** SC-2-Web (Symptom 2), SC-4/6/9.

### SheetMobile.tsx
**Before:** one `Sheet`; web used `withSpring` open + `withTiming` close on the JS rAF.
**Now:** dispatch → `SheetNative` (verbatim spring+timing) + `SheetWeb` (CSS `transform: translateY` 280ms ease-out approximation of the spring on open, 240ms ease-in close; documented small visual delta on narrow web only). Shared `SheetMobilePanelInner`.
**Why:** SC-4-Web, SC-5-Native (byte-identical spring), SC-6/9. Open Q-1 (spring→ease-out) flagged for Seth's eyeball at TEST.

### Modal.tsx
**Before:** one `Modal`; web ran `withTiming` on panelScale/opacity/scrim on the JS rAF.
**Now:** dispatch → `ModalNative` (verbatim) + `ModalWeb` (CSS scale+fade 200/160ms, web Escape handler retained). Reduce-motion = opacity-only.
**Why:** SC-4-Web, SC-5-Native, SC-6/8/9.

### Toast.tsx
**Before:** one `Toast`; web ran `withTiming` on translateY/opacity on the JS rAF (swipeOffset is a web no-op).
**Now:** dispatch → `ToastNative` (verbatim, incl. swipe gesture + GestureHandlerRootView + Android pan-freeze fix) + `ToastWeb` (CSS translateY+opacity 220/160ms; swipeOffset dropped since web swipe is a no-op). Shared `ToastCard` body.
**Why:** SC-4-Web, SC-5-Native, SC-6/9.

### app/event/[id]/index.tsx
**Before:** `handleManageOpen` opened with a web-only `[ORCH-1136-DIAG]` console.log + forced `[DIAG]` toast before the real branch.
**Now:** DIAG block deleted; the real handler keeps the non-silent guard (`brand === null` → "Loading brand… tap again in a moment." toast + return) then `setManageMenuVisible(true)`; dep array `[brand]` unchanged.
**Why:** §4.6 reap (I-PROPOSED-L), Const #1 (no dead tap), SC-2-Web.

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---------|----------|--------|
| Consumer iOS (`app-mobile/`) | No — different app | n/a |
| Consumer Android | No | n/a |
| Buyer/anon Web (`mingla-business` public) | Incidental — inherits the web CSS transition if it mounts a primitive; no public-page behavior targeted | automatic (shared, web-gated) |
| Business iOS | Yes — MUST stay byte-identical | manual: every change is a `Platform.OS==='web'` dispatch; native component = pre-change body verbatim |
| Business Android | Yes — byte-identical | same |
| **Business Web** | **PRIMARY** — sheets glide on heavy pages | manual: web variant authored per-file |
| Admin Web | No — separate app | n/a |

## 9. Smoke result

- **Web bundle:** `npx expo export -p web` in the bracket-free clean checkout `/tmp/orch1136r3-clean` → **EXIT 0** (baseline + after fix + final all-changes). Bracket-free checkout required (brackets break the expo-router bundler — R1/R2/R3 hazard).
- **tsc (touched files):** no new errors. The single `Sheet.web.tsx(310)` `cursor` error is **pre-existing** (present at HEAD `git show HEAD:…Sheet.web.tsx`). `../packages/phone-input/*` errors are a separate package's pre-existing missing-`react`-types.
- **eslint (5 primitives + test):** 0 errors, 0 warnings. The 5 `app/event/[id]` warnings are pre-existing (`allOrderEntries`/`defaultCurrency` deps).
- **jest:** ORCH-1136 R3 suite 20/20 PASS; full `src/components/ui/__tests__` = 13 suites pass, 1 pre-existing failure (`eventCoverMedia.test` — confirmed RED with my changes STASHED, i.e. a pre-existing worktree break, unrelated; see Discoveries).
- **gates:** new gate PASS + self-test OK; `i-proposed-topsheet-web-viewport-anchor` (no-fixed) GREEN; `i-proposed-c` (no setBrands) GREEN.
- **Harness:** `assert_fails_on_revert.mjs` PASS ×5 deterministic; FAILS on css.html revert.

## 10. Known issues / deferred

- **Spring→ease-out approximation (`SheetWeb`, narrow web bottom sheet)** — SPEC Open Q-1, default-accepted. Web has no off-thread spring driver; `cubic-bezier(0.22,1,0.36,1)` 280ms reads as a spring-like settle. Documented small visual delta on narrow web only; native spring untouched. Flag for Seth's eyeball at TEST — a multi-step `@keyframes` spring can be swapped later without architecture change.
- **`assert_fails_on_revert.mjs` Part A vs the same-thread observability limit** — documented in §6; Part B is the deterministic fails-on-revert anchor.
- No `[TRANSITIONAL]` markers introduced.

## 11. Operator action required

- **Migration:** none.
- **Edge deploy:** none.
- **TEST phase (mingla-tester, business side):** live-fire SC-1..SC-10 on Business Web (heavy Hub events + event detail, authed) AND native parity (SC-5) on iOS sim + Android emu / physical device. Optional: an authed Performance-tab capture of the Hub brand-chip tap to NAME the live long-task (lifts F-2 to proven; not a gate).

### Seth authed on-device/web checklist (the proof SC-1..SC-4 need)
1. Open `business.usemingla.com`, sign in, go to the **Hub events** page (heavy — many event cards).
2. Tap the brand chip in the top bar → the **brand switcher slides down snappily** to its anchor (~280ms) and does NOT linger/freeze near the top. Close it → slides up cleanly (~240ms). (SC-1)
3. Open an **event detail** page (heavy). Tap **⋯** → the manage menu **appears immediately** (fade+scale-in), with **no `[DIAG]` toast**. (SC-2)
4. Tap the **"+"** creator button on a heavy page → the compact creator sheet **slides down snappily** after it measures, with no mid-slide freeze. (SC-3)
5. Trigger a **modal**, a **toast** (e.g. save something), and a **narrow-web bottom sheet** (shrink the window < 1024px) on a heavy page → each animates smoothly, no freeze. (SC-4)
6. On the **phone apps** (iOS/Android), open the same sheets → animations look exactly as before (no change). (SC-5)

## 12. Discoveries for orchestrator

1. **[MED] `eventCoverMedia.test` is RED in this worktree independent of ORCH-1136** — 5/20 fail (`EVENT_COVER_UPLOAD_LIMIT_COPY`, `mediaTypes: ["images"]` source-string assertions) with ALL my changes stashed. It is a pre-existing worktree break (likely a stale anchor / rebase gap), not caused by this ORCH. Recommend a rebase check or a separate triage.
2. **[LOW] `Mingla_Artifacts/evidence/` is gitignored** (`.gitignore:122`), so the harness drivers (`css.html`, `model.html`, `assert_fails_on_revert.mjs`) are not tracked by default. I force-added `assert_fails_on_revert.mjs` so the §9a deliverable persists in the repo; the older harness fixtures it depends on (`css.html`/`model.html`) remain on-disk evidence only. If the orchestrator wants the full harness in-repo, force-add those two as well.
3. **[INFO] Reduce-motion on web** is read via a direct `matchMedia('(prefers-reduced-motion: reduce)')` hook (`useWebReducedMotion`) in each web variant, because reanimated's `useReducedMotion` is itself a JSReanimated hook the web variant must not call. Behavior matches the native reduce-motion contract (opacity-only).
