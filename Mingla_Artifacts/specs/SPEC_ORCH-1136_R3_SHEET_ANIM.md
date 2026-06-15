# SPEC — ORCH-1136 ROUND 3 [biz-web sheet animation: compositor CSS transition on web]

**Phase:** SPEC (forensics). **This is a binding contract, not code.** Illustrative snippets ≤3 lines.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs-r2]/` on branch `ORCH-1136-biz-web-sheet-anim-r3` (tracks origin/main incl. R2 merge `8510b2fb2`).
**App:** `mingla-business/` (React-Native-Web + native; SHARED primitives).
**Source investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1136_R3_SHEET_ANIM.md` (F-1..F-4; harness evidence `Mingla_Artifacts/evidence/ORCH-1136-R3/`).
**Comms ledger:** scanned `COMMS_LEDGER.md` active table on entry — no `BLOCK`/`OPEN` row addressed to `mingla-forensics`, `ORCH-1136`, or `ALL` bearing on a web-only animation fix. Open `ALL`/WARN rows (COMMS-0027 OTA cache, COMMS-0028 GIPHY key, COMMS-0029 `biz_update_live_trip` clobber, COMMS-0030 iOS build) are out of scope. Nothing to ack.

---

## 1. Executive summary

On `mingla-business` web, sheet/overlay open and close animations run on the **JS main thread** via `react-native-reanimated@4.1.7`'s `JSReanimated` shim: `withTiming` computes each frame inside the browser-native `requestAnimationFrame` (no off-thread driver exists on web) and writes `transform`/`opacity` directly to the DOM per frame (`updatePropsDOM`). When a heavy page (Hub events, event detail) throws a long (>50ms) main-thread task during the ~200–280ms open window, no animation frame can paint — the half-open panel **FREEZES** at its last-painted mid-slide position (translateY ≈ −197…−268px, near the top), then `withTiming`'s wall-clock timing snaps it to rest. Light pages (Home) glide because they emit no blocking task. This single root cause subsumes both ORCH-1136 residual symptoms (Symptom 3 "Hub switcher offset to the top" = the frozen mid-slide; Symptom 2 "event ⋯ dead" = the menu opens too slowly to notice).

**The fix:** for `Platform.OS === 'web'` ONLY, drive the open/close animation with a **compositor-thread CSS transition** on `transform: translateY(...)` (TopSheet/SheetMobile) / `transform: scale(...)` (Sheet.web/Modal) + `opacity` — the compositor advances independently of main-thread JS, so a heavy page's React commit or image decode no longer freezes the slide. Native (iOS/Android) keeps its existing reanimated `withTiming`/`withSpring` path **byte-identical** behind the web gate. The harness already proves this works: `evidence/ORCH-1136-R3/css.html` + `css_drive.mjs` show the CSS-transition panel advancing to rest with `maxFreeze ≈ 0ms` under the exact 250ms commit-burst that froze the rAF path for ~280–480ms.

This batch also reaps the `[ORCH-1136-DIAG]` block at `app/event/[id]/index.tsx` (the event ⋯ is understood — slow, not dead) and binds a fails-on-revert harness + a strict-grep gate.

---

## 2. Scope & non-goals

### In scope
1. **Web-gated compositor CSS-transition animation** for the shared sheet/overlay primitives that currently animate via reanimated `withTiming` on web (per §3 per-component table):
   - `TopSheet.tsx` (BrandSwitcherSheet `fixed-70` + UniversalCreatorSheet `compact`) — **PRIMARY** (Symptom 3).
   - `Sheet.web.tsx` `DesktopCenteredCard` (event ⋯ `EventManageMenu`, `GlobalSearchSheet`, all wide-desktop sheets) — **PRIMARY** (Symptom 2).
   - `Modal.tsx` (centred overlay; web Escape-dismiss; same `withTiming` scale+opacity main-thread path) — **INCLUDED** (§4.3 justification).
   - `Toast.tsx` (top banner; same `withTiming` translateY+opacity main-thread path) — **INCLUDED** (§4.4 justification).
   - `SheetMobile.tsx` (narrow-web bottom sheet via `MobileSheet`) — **INCLUDED, web-gated** (§4.5 justification).
2. **Reap the `[ORCH-1136-DIAG]` block** at `app/event/[id]/index.tsx` (~lines 164–184) — replace with the normal handler; keep the non-silent brand-not-resolved guard (Const #1).
3. **One fails-on-revert regression harness** (extend `evidence/ORCH-1136-R3/`) + **one strict-grep gate** (web sheet animation is CSS-transition-driven; native keeps reanimated; no height/layout animation on the web sheet path).

### Non-goals (explicitly NOT in this ORCH)
- **Native (iOS/Android) animation changes** — native MUST stay byte-identical. Only `Platform.OS === 'web'` branches change.
- **Re-introducing `position:'fixed'`** — BANNED (gate `I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED`). The R2 `StyleSheet.absoluteFill` root + opaque scrim stay.
- **Round-1 Batch A (brand-list) + Batch C (top-bar 8px) behavior** — untouched.
- **Brand-list state ownership** — stays in React Query (Const #5). No `setBrands()` introduced.
- **The "defer the heavy-page commit off the open tick" hardening adjunct** (investigation Fix-direction item 4) — OUT. The compositor move is sufficient and primitive-local; deferring the `setManageMenuVisible(true)` commit is a separate optimization that is NOT needed once the animation is off the main thread. Do not add it.
- **Consumer app / Admin / Buyer-web public pages** — separate surfaces, out of this ORCH's scope even if they share these primitives.
- **An authed Performance-tab capture to NAME the exact live long-task** — RECOMMENDED as a TEST-phase confirmation (lifts F-2 to proven), but the fix does not depend on it; not a blocker for IMPLEMENT.

### Assumptions
- On web the swipe-to-dismiss pan gesture is **already a no-op**: `WebSafeGestureDetector.web.tsx` renders children directly, so the `Gesture.Pan().onUpdate` path that mutates `translateY.value` mid-drag NEVER runs on web. Therefore the web animation path only needs to handle open/close (two discrete states) — there is no live finger-tracking to preserve on web. This is load-bearing: the CSS-transition approach (state flip → transition to target) is fully sufficient for web because web never needs per-frame drag values.
- The R2 overlay root is `StyleSheet.absoluteFill` (`position:absolute`) on all platforms and stays that way.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | **No** | — | none | n/a — different app; out of ORCH scope |
| 2 | Consumer Android (`app-mobile/`) | **No** | — | none | n/a — different app; out of ORCH scope |
| 3 | Buyer/anonymous Web (`mingla-business/` public `/e`,`/b`,`/t`,`/checkout`) | **No** (incidental) | If a public page mounts one of these primitives it inherits the web-gated CSS transition automatically; no public-page behavior is targeted or required to change | none (inherited via shared primitive) | automatic (shared code, web-gated) |
| 4 | Business iOS | **Yes — MUST stay byte-identical** | Brand switcher, creator "+", event ⋯ menu, modals, toasts, bottom sheets animate EXACTLY as before (reanimated `withTiming`/`withSpring`) | the 5 primitives — native branch untouched | manual gate: every change is `Platform.OS==='web'`-branched; native path unchanged |
| 5 | Business Android | **Yes — MUST stay byte-identical** | Same as iOS | same | same |
| 6 | **Business Web** (`business.usemingla.com`, RN-Web) | **Yes — PRIMARY TARGET** | Brand switcher slides down snappily on Hub (no freeze near the top); event ⋯ menu opens immediately; creator "+" sheet snappy; all on a heavy page. Modals/toasts/bottom-sheets also glide on heavy pages | `TopSheet.tsx`, `Sheet.web.tsx`, `SheetMobile.tsx`, `Modal.tsx`, `Toast.tsx`, `app/event/[id]/index.tsx` (DIAG reap) | manual — web branch authored per-file |
| 7 | Admin Web (`mingla-admin/`, adjacent) | **No** | — | none | n/a — separate app |

This ORCH is **Business Web (surface 6)** primary, with a **hard byte-identical guarantee on Business iOS/Android (surfaces 4/5)**.

---

## 4. Layered specification

This is a **component-layer-only** change. No DB, no edge function, no service, no hook, no realtime. The entire blast radius is 5 shared UI primitives + 1 screen handler + 1 harness + 1 CI gate.

### 4.0 The web animation mechanism (shared design — applies to every primitive below)

**Native path (unchanged):** keep `useSharedValue` + `withTiming`/`withSpring` + `useAnimatedStyle` + the `Animated.View` exactly as today. The `useEffect` that drives the shared values runs on native only (gate the *web* behavior, not the native one — see "gating shape" below).

**Web path (new):** the animated `Animated.View` reads an **inline CSS `transition` + a target transform/opacity** driven by a plain React state flip, instead of a reanimated `useAnimatedStyle`. The mechanism, identical for every primitive (only the animated property and duration/easing differ):

1. A boolean `animateOpen` React state, initialized `false`.
2. On mount (when `mounted` flips true and the panel is in the DOM at its CLOSED transform), flip `animateOpen` to `true` on the **next frame** (`requestAnimationFrame`, or a 0ms `setTimeout` fallback) so the browser registers the CLOSED start state first, THEN the transition to OPEN fires. (Flipping in the same commit as mount = no transition, instant pop. The next-frame flip is load-bearing.)
3. On `visible → false`, flip `animateOpen` to `false` immediately; the inline `transition` animates back to the CLOSED transform; the existing lazy-unmount timer (`UNMOUNT_DELAY_MS`) still unmounts AFTER the close transition completes (timings already match — see per-component table; verify each `UNMOUNT_DELAY_MS ≥` the web close duration + ~40ms).
4. The web style object applies, on the SAME `Animated.View`:
   - `transition: 'transform <DUR>ms <EASING>, opacity <SCRIM_DUR>ms <EASING>'` (or per-property as the component needs),
   - `transform` = CLOSED-transform when `!animateOpen`, OPEN-transform when `animateOpen`,
   - `will-change: 'transform'` (and `'opacity'` for the scrim) — compositor-layer hint (already present in the harness; promotes the element to its own layer so the transition is compositor-driven).
   - `opacity` for the scrim handled the same way (CLOSED `0` → OPEN `1`).
5. **Animate `transform` and `opacity` ONLY.** NEVER `height`, `top`, `width`, or any layout property (those reflow on the main thread and defeat the whole fix). The CLOSED→OPEN delta MUST be expressed purely as a `translateY`/`scale`/`opacity` change. Panel `height` stays a static style (already the case — e.g. TopSheet's `height: panelHeight`).
6. **Reduce-motion (web):** when `prefers-reduced-motion` / `useReducedMotion()` is true, use opacity-only with the same transition (no translate/scale), matching the native reduce-motion contract.

**Gating shape (per file).** Two acceptable patterns — IMPLEMENT picks one and applies it uniformly:
- **(Preferred) `.web.tsx` sibling** for the animated render, OR
- **In-file `Platform.OS === 'web'` branch**: the reanimated hooks (`useSharedValue`/`useAnimatedStyle`/`withTiming`) must NOT execute on web (calling reanimated web hooks is the fragility class that caused 3 prior web crashes — see `WebSafeGestureDetector`'s history). Because React hooks cannot be conditionally called, the cleanest in-file shape is: split the body into a `WebPanel`/`NativePanel` (or `<Foo>` dispatches to `<FooWeb>`/`<FooNative>`) so each variant calls only its own hooks. **The web variant must call ZERO reanimated hooks** (no `useSharedValue`, no `useAnimatedStyle`, no `withTiming`). This both fixes the freeze AND removes the reanimated-on-web fragility for these primitives.

> **Why not "shorten the duration" or "use reanimated's web CSS API":** investigation §Fix-direction ruled out duration retune (wall-clock `withTiming` still can't paint intermediate frames while blocked — it would snap from a different position). Reanimated's web CSS-animation API is permitted IF it provably compiles to a real compositor CSS `transition`/`animation` with zero per-frame main-thread JS writes; the plain-CSS-transition approach is the proven, dependency-free default and is what the harness validates — prefer it.

### 4.1 `TopSheet.tsx` — BrandSwitcherSheet (`fixed-70`) + UniversalCreatorSheet (`compact`) — PRIMARY

- **Animated properties (web):** panel `transform: translateY(closedY → 0)` where `closedY = -panelHeight`; scrim `opacity: 0 → 1`.
- **Open transition (web):** `transform 280ms cubic-bezier(0.33, 1, 0.68, 1)` (ease-out-cubic, matches the harness `css.html` and the native `ENTRY_DURATION = 280` + `Easing.out(Easing.cubic)`); scrim `opacity 220ms cubic-bezier(0.33, 0, 0.67, 1)` (matches `SCRIM_DURATION = 220`).
- **Close transition (web):** `transform 240ms cubic-bezier(0.33, 0, 0.67, 1)` (ease-in-cubic, matches `EXIT_DURATION = 240`); scrim `opacity 220ms` ease-in.
- **CLOSED/OPEN states:** CLOSED `translateY(-panelHeight)`; OPEN `translateY(0)`. `panelHeight` stays a static `height` style (NOT animated).
- **Compact-mode interaction:** the existing `compactInvisible` (opacity 0 until first `onLayout` measurement) MUST be preserved — on web, when `measuredCompactHeight === null` render at `opacity: 0` with NO transition fired yet; once measured, mount at CLOSED transform then next-frame-flip to OPEN. The `closedY = -panelHeight` depends on the measured height; ensure the web transition uses the measured `panelHeight` (re-fire the next-frame open flip when `panelHeight` transitions from 0 to measured, so the slide starts from the correct off-screen position — do NOT slide from `-0px`).
- **Pan gesture (web):** no-op already (`WebSafeGestureDetector.web.tsx`) — the web variant does not need the `panGesture` `onUpdate` translate path. Keep the gesture wiring for native; the web variant may omit it.
- **Overlay root:** stays `StyleSheet.absoluteFill` (`position:absolute`). NO `position:'fixed'`. Scrim stays the opaque-on-mobile-web fallback path (`shouldUseRealBlur`) untouched.
- **Lazy-unmount:** `UNMOUNT_DELAY_MS = 280` ≥ web close 240 + 40. OK — keep.
- **Escape/Android-back:** unchanged.

### 4.2 `Sheet.web.tsx` `DesktopCenteredCard` — event ⋯ menu + GlobalSearchSheet — PRIMARY

- This file is **web-only** (Metro picks it on web), so the whole component is the web variant — NO native byte-identical concern inside this file, but it MUST NOT call reanimated hooks on the main-thread-rAF path.
- **Animated properties (web):** card `opacity: 0 → 1` + `transform: scale(0.96 → 1)`; scrim `opacity: 0 → 1`.
- **Open transition:** `opacity 200ms` + `transform 200ms` `cubic-bezier(0.33, 1, 0.68, 1)` (matches `OPEN_DURATION_MS = 200`, `Easing.out(Easing.cubic)`); scrim `opacity 200ms` ease-out.
- **Close transition:** `opacity 180ms` + `transform 180ms` `cubic-bezier(0.33, 0, 0.67, 1)` (matches `CLOSE_DURATION_MS = 180`).
- **CLOSED/OPEN states:** CLOSED `opacity:0, scale(0.96)`; OPEN `opacity:1, scale(1)`. Reduce-motion: opacity-only (`scale` stays 1).
- **Lazy-unmount:** `UNMOUNT_DELAY_MS = 220` ≥ 180 + 40. OK — keep.
- **`verticalAlign="top"` + width/max-height clamps:** static layout styles — untouched (NOT animated).
- **Narrow-web branch (`!isWideDesktop`) → `MobileSheet`:** delegates to `SheetMobile.tsx` — covered by §4.5; this file's change is only the `DesktopCenteredCard` path.
- **Remove the reanimated import** from this file's animated path (replace `useSharedValue`/`useAnimatedStyle`/`withTiming`/`cancelAnimation` usage in `DesktopCenteredCard` with the CSS-transition state mechanism). This closes the reanimated-on-web fragility for this primitive too.

### 4.3 `Modal.tsx` — centred overlay — INCLUDED

- **Justification for inclusion:** identical main-thread mechanism — `withTiming` on `panelScale` (0.96→1) + `panelOpacity` + `scrimOpacity`, written per-frame on web via `JSReanimated`. On a heavy page a Modal (e.g. a ConfirmDialog over a busy wizard) exhibits the SAME freeze. It shares the exact F-1 root cause; excluding it would leave a known-janky web overlay. IN scope.
- **Animated properties (web):** panel `opacity: 0 → 1` + `transform: scale(0.96 → 1)`; scrim `opacity: 0 → 1`.
- **Open transition:** `opacity 200ms` + `transform 200ms` ease-out-cubic (matches `ENTRY_DURATION = 200`). **Close:** `180ms`→ NO; matches `EXIT_DURATION = 160` ease-in-cubic. Use `160ms` close to match native.
- **Lazy-unmount:** `UNMOUNT_DELAY_MS = 200` ≥ 160 + 40. OK — keep.
- **Native (iOS/Android):** byte-identical — web-gated branch only.

### 4.4 `Toast.tsx` — top banner — INCLUDED

- **Justification for inclusion:** same main-thread mechanism — `withTiming` on `translateY` (−40→0) + `opacity`, per-frame web DOM writes. A toast that fires while a heavy page commits (very common: a success toast right after a save that re-renders a heavy list) freezes mid-slide. Shares F-1. IN scope.
- **Animated properties (web):** wrap `transform: translateY(-40 → 0)` + `opacity: 0 → 1`.
- **Open transition:** `transform 220ms` + `opacity 220ms` ease-out-cubic (matches `ENTRY_DURATION = 220`). **Close:** `160ms` ease-in-cubic (matches `EXIT_DURATION = 160`).
- **Swipe-offset (web):** the `swipeOffset` shared value is driven only by the pan gesture, which is a no-op on web (`WebSafeGestureDetector.web.tsx`). So the web variant animates `translateY` (entry/exit) only — `swipeOffset` is always 0 on web and can be dropped from the web transform. Native keeps `translateY + swipeOffset`.
- **Lazy-unmount:** `UNMOUNT_DELAY_MS = EXIT_DURATION + 40 = 200` ≥ 160 + 40. OK.
- **Native:** byte-identical — web-gated branch only. (`GestureHandlerRootView` + the Android pan-freeze fix in the comment are native concerns — leave untouched.)

### 4.5 `SheetMobile.tsx` — narrow-web bottom sheet — INCLUDED (web-gated)

- **Justification for inclusion:** on narrow web (< 1024px) `Sheet.web.tsx` delegates to `MobileSheet` (this file), which animates the panel via `withTiming(closedY)` on close and **`withSpring(openY)` on open** — both on the web main-thread rAF. On a heavy narrow-web page the bottom sheet exhibits the same freeze. It is a shared native+web primitive (NOT a `.web` file), so the change MUST be web-gated; **native keeps the spring byte-identical**.
- **Animated properties (web):** panel `transform: translateY(closedY → 0)`; scrim `opacity: 0 → 1`. (`closedY = sheetHeight`, slides up from the bottom.)
- **Open transition (web):** the native open is a `withSpring` (damping 22, stiffness 200, mass 1) — a CSS `transition` cannot reproduce a spring exactly. Use a **snappy ease-out approximation**: `transform 280ms cubic-bezier(0.22, 1, 0.36, 1)` (a slightly overshoot-free ease-out that reads as "spring-like settle"); document that web's open is an ease-out approximation of native's spring (acceptable — web has no off-thread spring driver; correctness/no-freeze > exact spring parity). **Close (web):** `transform 240ms cubic-bezier(0.33, 0, 0.67, 1)` (matches native `TIMING_CLOSE = 240` ease-in-cubic).
- **Reduce-motion (web):** opacity-only fade, matching native `REDUCE_MOTION_OPEN`.
- **Lazy-unmount:** `UNMOUNT_DELAY_MS = 280` ≥ web open 280 / close 240 + safety. OK — keep.
- **Pan gesture (web):** no-op already. Web variant omits the `onUpdate` translate path.
- **Native (iOS/Android):** the `withSpring` open + `withTiming` close stay **byte-identical**.

### 4.6 `app/event/[id]/index.tsx` — DIAG reap (NOT an animation change)

- Delete the `[ORCH-1136-DIAG]` block (lines ~164–184: the `if (Platform.OS === "web") { … console.log … setToast({ visible:true, message: "[DIAG] …" }) }` discriminator). Keep `handleManageOpen` as the real handler:
  - Keep the **non-silent guard** (Const #1, no dead taps): `if (brand === null) { setToast({ visible:true, message: "Loading brand… tap again in a moment." }); return; }` then `setManageMenuVisible(true);`.
  - The `useCallback` dependency array stays `[brand]`.
- After reap: the menu opens fast on web via the new `Sheet.web.tsx` CSS transition (§4.2), so the "looks dead" slowness is gone and the diagnostic is no longer needed.
- This satisfies the META-ORCH-0744 **I-PROPOSED-L** process invariant (DIAG markers reaped at CLOSE).

### 4.7 Layers NOT touched (justified)

- **Database / RLS / migrations:** none — pure UI.
- **Edge functions / services / hooks:** none. Brand-list stays in React Query (Const #5); no `setBrands()` (gate I-PROPOSED-C unaffected).
- **Realtime:** none.

---

## 5. Success criteria

Per-surface where parity is manual (`-Web` = Business Web surface 6; `-Native` = Business iOS+Android surfaces 4/5).

- **SC-1-Web (TopSheet / brand switcher on Hub):** Open the brand switcher from the top-bar chip while on the Hub events page (heavy). The panel slides DOWN from behind the top-bar to its anchor in ~280ms WITHOUT freezing/lingering at a mid-slide position near the top. Closing slides up in ~240ms. (Resolves Symptom 3.)
- **SC-2-Web (event ⋯ menu):** On an event detail page (heavy), tap ⋯. The `EventManageMenu` sheet appears IMMEDIATELY (fade+scale-in in ~200ms) — not after a perceptible delay. No `[DIAG]` toast appears (DIAG reaped). (Resolves Symptom 2.)
- **SC-3-Web (creator "+" sheet):** Open the UniversalCreatorSheet via the "+" on a heavy page. The compact TopSheet slides down snappily after its first measurement, no mid-slide freeze.
- **SC-4-Web (Modal / Toast / bottom-sheet on heavy page):** A centred Modal, a Toast fired during a heavy commit, and a narrow-web bottom sheet each animate smoothly (no mid-animation freeze) on a heavy page.
- **SC-5-Native (parity — iOS + Android):** Brand switcher, creator "+", event ⋯ menu, Modal, Toast, bottom sheet animate EXACTLY as before the change (reanimated `withTiming`/`withSpring`) on both iOS and Android. Visual + timing diff vs pre-change = zero. (Byte-identical native control flow + timing.)
- **SC-6 (no reflow):** The web animation animates `transform`/`opacity` ONLY — no `height`/`top`/`width`/layout animation appears on the web sheet path (verified by the strict-grep gate §9 + a DOM check that panel `height` is static during the open).
- **SC-7 (no-fixed invariant):** `I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED` stays GREEN — no `position:'fixed'` reintroduced; overlay root stays `StyleSheet.absoluteFill`.
- **SC-8 (close timing correct):** No sheet unmounts before its close transition finishes on web (no abrupt disappear); the scrim fades out with the panel.
- **SC-9 (reduce-motion):** With OS "reduce motion" on, web sheets fade (opacity-only) with no translate/scale — matching native.
- **SC-10 (regression harness fails-on-revert):** The §9 harness PASSES with the CSS-transition path and FAILS (detects a mid-open freeze) when reverted to the JS-rAF path.

---

## 6. Invariants

### Preserved
- **I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED** (`.github/scripts/strict-grep/i-proposed-topsheet-web-viewport-anchor.mjs`) — the fix uses `transform`/`opacity` transitions on the existing `StyleSheet.absoluteFill` root; introduces NO `position:'fixed'`. Verified by the existing gate (must stay green) + SC-7.
- **DEC-080 / DEC-NEW-A** (TopSheet's 2 approved consumers: BrandSwitcherSheet `fixed-70` + UniversalCreatorSheet `compact`) — both must open correctly on web AND stay unchanged on native. Verified SC-1-Web, SC-3-Web, SC-5-Native.
- **Const #1 (no dead taps)** — event ⋯ never a silent no-op: the menu opens fast on web; the brand-not-resolved guard stays (non-silent toast). Verified SC-2-Web + §4.6.
- **Const #5 (brand-list state in React Query)** — no `setBrands()` introduced; gate `I-PROPOSED-C` (i-proposed-c-brand-crud-via-react-query.mjs) unaffected.
- **I-PROPOSED-L (DIAG reaped at CLOSE)** — §4.6 reaps the `[ORCH-1136-DIAG]` block.
- **I-13 (overlay primitives portal to screen root)** — `Modal.tsx`/`Toast.tsx`/`SheetMobile.tsx` keep their `Modal`/`RNModal` portal wrapper; the web CSS-transition is applied to the inner animated `Animated.View`, not by removing the portal.

### New (proposed — DRAFT until CLOSE; orchestrator flips ACTIVE)
- **I-PROPOSED-1136-WEB-SHEET-CSS-TRANSITION (DRAFT):** In `mingla-business`, the shared sheet/overlay primitives (`TopSheet.tsx`, `Sheet.web.tsx`, `SheetMobile.tsx`, `Modal.tsx`, `Toast.tsx`) MUST drive their **web** open/close animation via a compositor CSS `transition` on `transform`/`opacity` (NOT a `withTiming`/`withSpring`-driven `useAnimatedStyle` on the web main-thread rAF), while the **native** path retains reanimated. No `height`/`top`/`width`/layout property may be animated on the web sheet path. Enforced by the §9 strict-grep gate.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | TopSheet open on heavy page (web) | Open brand switcher on Hub events while a 250ms commit-burst lands mid-open | Panel advances to rest (no freeze near top); `maxFreeze < ~30ms` | runtime (harness + browser) |
| T-2 | TopSheet open on light page (web) | Open brand switcher on Home | Smooth glide (unchanged from today's good case) | runtime |
| T-3 | Event ⋯ menu (web) | Tap ⋯ on event detail (heavy) | `EventManageMenu` fades+scales in ~200ms immediately; NO `[DIAG]` toast | runtime |
| T-4 | Compact creator sheet (web) | Open "+" UniversalCreatorSheet on heavy page | Slides down after first measurement; no mid-slide freeze; no slide-from-(-0) glitch | runtime |
| T-5 | Modal on heavy page (web) | Open a ConfirmDialog over a busy wizard | Scale+fade-in smooth; close fades out before unmount | runtime |
| T-6 | Toast during commit (web) | Fire a success toast right after a save that re-renders a heavy list | Slides down + fades without freezing mid-slide | runtime |
| T-7 | Narrow-web bottom sheet (web) | Open a bottom sheet at < 1024px on a heavy page | Slides up (ease-out) without freeze; close ease-in | runtime |
| T-8 | Native parity (iOS) | Open all 5 primitives on a heavy biz iOS screen | Animations identical to pre-change (reanimated); no behavior diff | device |
| T-9 | Native parity (Android) | Same on Android | Identical to pre-change | device |
| T-10 | Reduce-motion (web) | OS reduce-motion on; open each primitive | Opacity-only fade, no translate/scale | runtime |
| T-11 | No-fixed gate | Run `i-proposed-topsheet-web-viewport-anchor.mjs` | GREEN (no `position:'fixed'`) | CI |
| T-12 | New CSS-transition gate | Run the §9 gate (incl. `--self-test`) | GREEN; self-test proves it FAILS on a `withTiming`-web-fixture and PASSES on a CSS-transition fixture | CI |
| T-13 | Fails-on-revert harness | Run §9 harness against rAF vs CSS panel | rAF FREEZES (fail), CSS ADVANCES (pass) | runtime harness |
| T-14 | Close timing | Close each web sheet | Scrim + panel animate out together; element unmounts only after the close transition | runtime |

---

## 8. Implementation order

1. **`TopSheet.tsx`** — web-gate the animation: split into native (reanimated, unchanged) + web (CSS-transition state mechanism per §4.0/§4.1). Verify the compact `closedY` uses measured height. Keep overlay root `StyleSheet.absoluteFill`.
2. **`Sheet.web.tsx`** — replace `DesktopCenteredCard`'s reanimated path with the CSS-transition mechanism (§4.2). Remove reanimated imports from the animated path.
3. **`SheetMobile.tsx`** — web-gate the panel/scrim animation (§4.5); native spring+timing byte-identical.
4. **`Modal.tsx`** — web-gate the scale+opacity animation (§4.3); native byte-identical.
5. **`Toast.tsx`** — web-gate the translateY+opacity animation (§4.4); native (incl. swipeOffset) byte-identical.
6. **`app/event/[id]/index.tsx`** — reap the `[ORCH-1136-DIAG]` block (§4.6).
7. **Harness** — extend `Mingla_Artifacts/evidence/ORCH-1136-R3/` with the fails-on-revert assertion (§9).
8. **Strict-grep gate** — add `i-proposed-1136-web-sheet-css-transition.mjs` + register a job in `strict-grep-mingla-business.yml` + a header registry line (§9).

Each step: run `tsc`/lint for the file, then the bracket-free `/tmp` web-bundle smoke (brackets break the bundler — use a `/tmp` checkout) to confirm the web bundle builds and the sheet opens.

---

## 9. Regression prevention (fails-on-revert)

### 9a. Runtime harness (fails-on-revert)
Extend `Mingla_Artifacts/evidence/ORCH-1136-R3/` (the CSS variant `css.html` + `css_drive.mjs` already exist and prove the compositor path). Add a **single assertion driver** that runs BOTH `model.html` (JS-rAF) and `css.html` (CSS-transition) under the identical HEAVY-page + 250ms-commit-burst-at-80ms scenario, computes the longest mid-open freeze for each, and asserts:
- `css.html` mid-open `maxFreeze < 30ms` (panel advances on the compositor) → PASS,
- `model.html` (the reverted path) mid-open `maxFreeze > 150ms` (panel frozen) → confirms the freeze the fix removes.

The driver exits non-zero if the CSS path freezes (i.e. if someone reverts the web sheet back to the JS-rAF `withTiming` path, the compositor assertion fails). This is the load-bearing fails-on-revert proof: **the CSS path advances under a mid-open long task; the rAF path does not.** Reference the harness from the strict-grep gate's header comment and the IMPLEMENT report.

### 9b. Strict-grep gate (structural safeguard)
New gate `.github/scripts/strict-grep/i-proposed-1136-web-sheet-css-transition.mjs` (modular per DEC-101; register one job in `.github/workflows/strict-grep-mingla-business.yml` + one header registry line, mirroring the ORCH-1137 lucide gate pattern). The gate, for each of the 5 primitives (`TopSheet.tsx`, `Sheet.web.tsx`, `SheetMobile.tsx`, `Modal.tsx`, `Toast.tsx`):
1. **PASS requires** a web-gated CSS `transition` on `transform`/`opacity` is present in the file's web path (e.g. the literal `transition:` with `transform`/`opacity` inside a `Platform.OS === 'web'` branch or a `.web.tsx` sibling).
2. **FAIL** if a `withTiming(`/`withSpring(` value drives a `useAnimatedStyle` `transform`/`opacity` on the **web** path (the reverted construct) — i.e. the web variant must call ZERO reanimated animation hooks.
3. **FAIL** if any `height`/`top`/`width`/`left`/`right`/`bottom` appears inside the web `transition:` property list (no layout/reflow animation).
4. **Comments stripped first** (so rationale comments naming `withTiming` don't trip it), matching the existing no-fixed gate's comment-strip approach.
5. **`--self-test` mode** (mirroring the lucide gate): assert GREEN on a CSS-transition fixture and RED on a `withTiming`-web fixture, so the gate's discriminating power is proven in CI.

Protective comment in the gate header: explains WHY (ORCH-1136 R3 F-1/F-2 — web reanimated is main-thread rAF and freezes under a heavy-page long task; the fix moves web sheet animation to the compositor; reverting to `withTiming` on web reintroduces the freeze).

### 9c. Existing gate stays green
`i-proposed-topsheet-web-viewport-anchor.mjs` (I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED) MUST remain GREEN — the fix introduces no `position:'fixed'` and keeps `StyleSheet.absoluteFill`. (T-11.)

---

## 10. Open questions

1. **Spring → ease-out approximation on narrow-web bottom sheet (`SheetMobile.tsx`).** Native opens with `withSpring`; web has no off-thread spring driver, so §4.5 approximates with `cubic-bezier(0.22, 1, 0.36, 1)` ease-out over 280ms. This is a deliberate, documented small visual delta on narrow web only (no native change). **Default decision: accept** (correctness/no-freeze > exact spring parity on web). Flag for Seth's eyeball at TEST — if he wants a closer spring feel, a multi-step CSS `@keyframes` spring curve can be substituted without changing the architecture. NOT a blocker.
2. **`.web.tsx` sibling vs in-file `Platform.OS` branch** (§4.0 gating shape) — IMPLEMENT's choice; both satisfy the gate. Recommendation: in-file split-component branch for `TopSheet`/`SheetMobile`/`Modal`/`Toast` (keeps one file), and `Sheet.web.tsx` is already web-only. No decision needed from Seth.

No question blocks IMPLEMENT.

---

## 11. Downstream routing

- **Next phase: IMPLEMENT** → `mingla-implementor` (business side). Build §4 exactly, in the §8 order, inside the worktree. Web bundling MUST use a **bracket-free `/tmp` checkout** (literal `[brackets]` in the worktree path break the expo-router bundler — R1/R2/R3 hazard).
- **Then: TEST** → `mingla-tester` (business side). Live-fire SC-1..SC-10 on Business Web (heavy Hub + event detail) AND native parity (SC-5) on iOS sim + Android emu (or Seth's physical device). Recommend the optional authed Performance-tab capture of the Hub brand-chip tap to NAME the live long-task and lift F-2 to proven (not a gate).
- **Then: CLOSE** → `mingla-orchestrator`. Flip I-PROPOSED-1136-WEB-SHEET-CSS-TRANSITION to ACTIVE; confirm the DIAG reap (I-PROPOSED-L); World Map + bug-list sync; OTA the business-app web per the OTA runbook if Seth wants it live.
- **Working tree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs-r2]/` on branch `ORCH-1136-biz-web-sheet-anim-r3`.

---

## Scoped allowlist (implementor may modify)

- `mingla-business/src/components/ui/TopSheet.tsx`
- `mingla-business/src/components/ui/Sheet.web.tsx`
- `mingla-business/src/components/ui/SheetMobile.tsx`
- `mingla-business/src/components/ui/Modal.tsx`
- `mingla-business/src/components/ui/Toast.tsx`
- `mingla-business/app/event/[id]/index.tsx` (DIAG reap ONLY — lines ~164–184; do not alter other handlers)
- `Mingla_Artifacts/evidence/ORCH-1136-R3/` (extend harness — add the fails-on-revert driver)
- `.github/scripts/strict-grep/i-proposed-1136-web-sheet-css-transition.mjs` (new gate)
- `.github/workflows/strict-grep-mingla-business.yml` (register the new gate job + header registry line ONLY)
- NEW `.web.tsx` siblings of the above primitives IF the implementor chooses the sibling-file gating shape (§4.0) — allowed.

## DO-NOT-TOUCH (stop-and-amend before touching)

- The **native** branches/timings of all 5 primitives (must stay byte-identical).
- `WebSafeGestureDetector.tsx` / `.web.tsx` (the web no-op gesture contract is relied upon, not changed).
- `i-proposed-topsheet-web-viewport-anchor.mjs` (the no-fixed gate — must stay green, not edited).
- Any consumer of these sheets (BrandSwitcherSheet, UniversalCreatorSheet, EventManageMenu, GlobalSearchSheet call sites) — they inherit the fix; do not edit them.
- Brand-list data/state (React Query; no `setBrands()`).
- Round-1 Batch A (brand-list) + Batch C (top-bar 8px) code.
- Anchor checkout (`~/Desktop/mingla-main`) and every other worktree.

The implementor MUST request a SPEC amendment (append in-file or `SPEC_AMENDMENT_ORCH-1136_R3_SHEET_ANIM.md`) before touching anything outside the allowlist.
