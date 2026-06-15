# INVESTIGATE — ORCH-1136 ROUND 3 [biz-web slow sheet animation] (Seth's runtime reframing)

**Phase:** INVESTIGATE (forensics). **No fix proposed — root cause + fix DIRECTION + regression contract only.**
**Surface:** mingla-business React-Native-Web build (business.usemingla.com), desktop + narrow web.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs-r2]/` on branch `ORCH-1136-biz-web-sheet-anim-r3` (tracks origin/main, includes R2 merge `8510b2fb2`).
**Round lineage:** R1 (source-only, merged, two conclusions later proven wrong) → R2 (reverted the R1 `position:'fixed'` regression, merge `8510b2fb2`, added gate `I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED`). **R3 reframes the two "remaining bugs" (Symptom 2 = event ⋯ does nothing; Symptom 3 = Hub switcher offset to the top) as ONE root cause via Seth's runtime test.**

## Comms ledger
Scanned `COMMS_LEDGER.md` active table. No `BLOCK`/`OPEN` row addressed to `mingla-forensics`, `ORCH-1136`, or `ALL` that bears on a web-only animation investigation. The open `ALL`/WARN rows are out of scope: COMMS-0027 (OTA shared-cache poisoning), COMMS-0028 (GIPHY key reachability), COMMS-0029 (`biz_update_live_trip` clobber), COMMS-0030 (iOS build break). Nothing to ack.

## Seth's R3 ground truth (OVERRIDES the R1/R2 dead-tap + position theories)
1. **Brand switcher on the HUB page**: the open animation "takes too long to come down. stays like this for a while." Screenshot shows the TopSheet lingering in a partial/mid-animation state (panel barely down, "Create a new brand" near the top, content faded). On HOME it is fast/fine.
2. **Event ⋯ button is NOT dead**: Seth tapped it, saw the `[ORCH-1136-DIAG]` toast (`brand=present`), and THEN the menu sheet appeared — slowly. "Maybe its a speed thing and it happens too slowly."

Unifying hypothesis to prove: **the web sheet open/close animation system runs too slowly / freezes when the underlying page is heavy** — explaining BOTH symptoms as one.

## Runtime env this pass
Bracket-free harness dir `/tmp/orch1136r2-harness/` (literal `[brackets]` in the worktree path break expo-router `require.context` — R1/R2 hazard, reused). Real `react-native-web@0.21.2` + `react-native-reanimated@4.1.7` + `react-native-worklets@0.5.1` (the app's exact versions) bundled with esbuild; driven in headless Chromium via Playwright. Auth was NOT needed — the mechanism is provable from the animation engine + a synthetic heavy/light DOM. Harnesses + verbatim outputs copied to `Mingla_Artifacts/evidence/ORCH-1136-R3/`.

---

## Q-scorecard

- **Q1 — Does the web sheet animation run on the JS/main thread (so a busy page can starve it), or on a compositor/UI thread (immune)?**
  **Verdict: PROVEN — JS/main thread.** On web, reanimated 4 loads `JSReanimated` (`ReanimatedModule/index.web.js` → `createJSReanimatedModule()`), NOT the native module. `withTiming` value steps are computed each frame inside the browser-native `requestAnimationFrame` (worklets `runLoop/uiRuntime/requestAnimationFrame.js` wraps `globalThis.requestAnimationFrame` — there is no separate UI thread on web), and each frame writes the new value **directly to `el.style.transform` / `el.style.opacity`** via `_updatePropsJS → updatePropsDOM` (`ReanimatedModule/js-reanimated/index.js:55-87`). Every animation frame is therefore a main-thread task.

- **Q2 — When a heavy page throws a long main-thread task during the open animation, what does the user see?**
  **Verdict: PROVEN (harness) — the panel FREEZES at its last-painted mid-open position for the duration of the block, then snaps to rest.** `withTiming` is wall-clock based (`animation/timing.js:56-64`: `progress = easing((now - startTime) / duration)`), so the final value is correct, but no intermediate frame can paint while the main thread is blocked → the half-open panel lingers, then jumps. This is EXACTLY Seth's "stays like this for a while" + the mid-animation screenshot.

- **Q3 — Why is Hub / event-detail (heavy) worse than Home (light)?**
  **Verdict: PROVEN (source weight asymmetry + harness).** Home renders ~4 heavy signals; Hub events renders 20+ (`ScrollView` + multiple card `.map()` lists + status derivations), and event-detail renders `EventCoverMedia` (hero video decode) + ticket/activity `.map()` lists. On the event page the ⋯ tap ALSO fires `setManageMenuVisible(true)`, re-rendering that heavy event tree on the same tick the menu mounts. These heavy pages emit ≥1 long (>50ms) main-thread task during the ~280ms anim window; Home does not. Same animation engine, different page budget → Q2's freeze fires on heavy pages only.

- **Q4 — Does this single root cause subsume the original Symptom 2 (event ⋯ "does nothing") and Symptom 3 (Hub switcher "offset to the top")?**
  **Verdict: YES (probable).** Symptom 2: the menu DOES mount + open (Seth saw the diag toast then the menu) — it was just so slow on the heavy event page it looked dead (R2 already refuted the primitive-incompatibility + mount-gate theories; R3 explains the residual slowness). Symptom 3: the "Hub switcher offset to the top" is the SAME freeze — the panel painted partway down (translateY ≈ −197…−268px, i.e. near the top) and stalled there; it is NOT a position/anchor bug (R2 already disproved the scroll-offset theory and reverted `position:fixed`). One mechanism, two faces.

- **Q5 — What fix makes ALL web sheets snappy without re-tripping the no-fixed gate and without touching native?**
  **Verdict: web-gated compositor-driven CSS transition on `transform`/`opacity` (NO `position:fixed`).** Direction in §Fix-direction. Native path stays byte-identical reanimated.

---

## Findings

### F-1 — Web sheet animations run on the main-thread JS rAF loop and write inline styles per frame (CONFIRMED ROOT CAUSE — engine mechanism)

- **Symptom:** sheets open/close slowly and "freeze" mid-animation on heavy web pages.
- **Layer:** code (animation engine) + runtime (Chromium harness).
- **Probe / Evidence:**
  - `node -e require('react-native-reanimated/package.json').version` → **`4.1.7`**; `react-native-web` → **`0.21.2`**; `react-native-worklets` → **`0.5.1`** (the app's exact versions).
  - `ReanimatedModule/index.web.js` (verbatim): `import { createJSReanimatedModule } from './js-reanimated'; export const ReanimatedModule = createJSReanimatedModule();` — **web uses JSReanimated, never the native module.**
  - `ReanimatedModule/js-reanimated/index.js:55-87` `updatePropsDOM`: `component.style[key] = domStyle[key]` per animated prop per frame (transform built by `createTransformValue`). **Each frame mutates inline DOM style on the main thread.**
  - `worklets/runLoop/uiRuntime/requestAnimationFrame.js:27-40`: `globalThis.requestAnimationFrame = callback => { … nativeRequestAnimationFrame(timestamp => { … __flushAnimationFrame(timestamp); }) }` — **the animation step runs inside the browser-native rAF callback (main thread); there is no separate UI thread on web.**
  - `animation/timing.js:56-64`: `const runtime = now - startTime; … const progress = animation.easing(runtime / config.duration); animation.current = startValue + (toValue - startValue) * progress;` — **wall-clock based** (a starved loop computes the correct value for elapsed time → it snaps, rather than running long).
  - Consumers: `TopSheet.tsx:203-231` (`withTiming(translateY)` ENTRY 280ms + `withTiming(scrimOpacity)` 220ms, `Easing.out/in(Easing.cubic)`); `Sheet.web.tsx:152-163` (`withTiming` on `scrimOpacity` + `cardOpacity` + `cardScale`, OPEN 200ms). Both are RN-web `Animated.View` with `useAnimatedStyle` → the JSReanimated DOM path above.
- **Mechanism:** every web sheet frame is a main-thread task that writes `el.style.transform`. When the main thread is busy, those frames cannot run/paint → the animation visibly stalls.
- **Severity:** CONFIRMED ROOT CAUSE (engine). Confidence: **confirmed** (source + version + runtime-proven path).

### F-2 — A long main-thread task during the open window FREEZES the panel at a mid-open position, then it snaps (CONFIRMED ROOT CAUSE — harness-proven)

- **Symptom (Seth):** Hub switcher "takes too long to come down, stays like this for a while" (mid-animation screenshot, panel near the top).
- **Layer:** runtime (real-rAF model, Chromium).
- **Probe / Evidence:** `evidence/ORCH-1136-R3/model.html` + `model_drive4.mjs` reproduce the EXACT documented path (main-thread rAF computing `timing.js`'s `progress=easing((now-start)/280)`, writing `panel.style.transform='translateY(v px)'` per frame — i.e. `updatePropsDOM`), over a HEAVY (120 media cards) vs LIGHT (4 rows) DOM, with a representative long task landing mid-open. Painted-position timeline (translateY px), VERBATIM:
  - **LIGHT (no burst):** `6:-596 32:-412 65:-268 99:-160 132:-87 166:-40 199:-14 232:-3 266:0` — smooth glide through every position.
  - **HEAVY, 250ms commit-burst @80ms:** `1:-686 19:-478 52:-319 334:-197 336:0 …` — paints to −319 then **FREEZES at ≈−197px (panel near the top) from ~52ms to 334ms (~280ms frozen)**, then snaps to 0.
  - **HEAVY, 450ms burst @60ms:** `1:-608 32:-412 512:-268 515:0 …` — **FREEZES at ≈−268px for ~480ms** then snaps.
  - `model_drive3.mjs` (single sync block delaying the first frame) VERBATIM samples at [0,50,100,150,200,280]ms: block=0ms `[-505,-270,-123,-42,-8,0]` (smooth); block=250ms `[-2,-2,-2,-2,-2,0]` (teleports to nearly-open, no slide); block=400ms `[0,0,0,0,0,0]` (pops straight open). Wall-clock timing makes the post-block frame jump to the elapsed-time position.
  - `model_drive_lt2.mjs`: a single 250ms commit-burst registers as a **252ms Long Task** in the browser `PerformanceObserver({entryTypes:["longtask"]})` — confirming a real heavy page's React commit / image decode is one >50ms main-thread task that blocks every anim frame for its duration.
- **Mechanism:** the half-open panel position painted by the last pre-block frame stays on screen for the whole block (the next `style.transform` write is queued behind the long task), then wall-clock timing snaps it to rest. The user sees "stuck near the top, then jumps."
- **Severity:** CONFIRMED ROOT CAUSE. Confidence: **probable** (mechanism + harness confirmed; the exact live long-task on the authed Hub/event page — React commit vs hero-video decode vs style recalc — is unnamed without auth, but the CLASS is proven and the source weight asymmetry is established).

### F-3 — Heavy pages emit the blocking task; light pages do not (SECONDARY ROOT CAUSE — weight asymmetry)

- **Symptom:** Hub + event-detail slow; Home fast.
- **Layer:** code (page weight) + runtime.
- **Probe / Evidence:** `grep -cE "BlurView|GlassChrome|Image|FlatList|ScrollView|\.map\("`: `app/(tabs)/home.tsx` = **4**; `app/(tabs)/hub/events.tsx` = **20+** (`ScrollView` + live/draft card `.map()` lists + `deriveCardStatus`); `app/event/[id]/index.tsx` mounts `EventCoverMedia` (hero video, `:693`) + ticket `.map()` (`:814`) + activity `.map()` (`:831`). On the event page, `handleManageOpen` (`:194`) calls `setManageMenuVisible(true)`, re-rendering that heavy tree on the menu's mount tick.
- **Mechanism:** the heavy pages produce the ≥1 long main-thread task during the anim window that F-2 needs; Home does not, so Home glides.
- **Severity:** SECONDARY ROOT CAUSE. Confidence: **probable**.

### F-4 — Subsumes original Symptom 2 (event ⋯) and Symptom 3 (Hub offset) — one root cause (CONFIRMED — reconciliation)

- **Evidence:** Seth saw the `[ORCH-1136-DIAG]` toast then the menu (`handleManageOpen` reached, `brand=present`, `setManageMenuVisible(true)` → `EventManageMenu` → `Sheet` → `Sheet.web.tsx` `DesktopCenteredCard` → reanimated `withTiming` opacity+scale → F-1/F-2 slow on the heavy event page). R2 already RULED OUT the primitive-incompatibility (event vs trip menu are identical `Sheet` primitives) and the mount-gate theories. Symptom 3's "offset to the top" = the F-2 freeze at translateY ≈ −197…−268px (panel near the top), NOT a position bug — R2 already reverted `position:fixed` and disproved the scroll-offset premise (`body{overflow:hidden}` ⇒ the host never document-scrolls).
- **Severity:** CONFIRMED (reconciliation). The `[ORCH-1136-DIAG]` block (`app/event/[id]/index.tsx:164-184`) can be **reaped at CLOSE** — it served its purpose (proved the handler runs + the toast renders + brand is present).

---

## Fix direction (NO code — contract only)

**Single fix that makes ALL web sheets snappy, web-gated, native byte-identical, no `position:fixed`:**

1. **Animate the sheet open/close on web via a compositor-driven CSS transition on `transform` + `opacity`, NOT the JS-thread reanimated rAF loop.** CSS transitions/animations on `transform`/`opacity` run on the browser **compositor thread**, which advances independently of main-thread JS — so a heavy page's React commit / image decode no longer freezes the slide. This is the load-bearing change: it moves the animation OFF the starved main thread. Implementation vector options for the SPEC to choose: (a) a `Platform.OS==='web'`-gated branch that toggles a CSS class / inline `transition` + target `transform` (the panel translates via `transform: translateY(0)` with `transition: transform 280ms cubic-bezier(...)`, scrim via `opacity` + `transition`), bypassing `useAnimatedStyle`/`withTiming` on web only; or (b) reanimated's web CSS-animation API if it can be driven equivalently. **Animate `transform`/`opacity` ONLY** (already what the code targets — `translateY`, `opacity`, `scale`) — never height/layout (avoids reflow). **Do NOT use `position:fixed`** (gate `I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED` forbids it; the R2 `absoluteFill` root + opaque scrim stay).

2. **Keep native (iOS/Android) on the existing reanimated `withTiming` path, byte-identical.** Native has a real UI thread; reanimated runs there off the JS thread already and is correct. Every change is `Platform.OS==='web'`-gated.

3. **Apply to all four shared web-animated sheet primitives** so every consumer benefits in one pass (see blast radius): `TopSheet.tsx`, `Sheet.web.tsx`, `SheetMobile.tsx`, plus `Modal.tsx`/`Toast.tsx` if the SPEC scopes them (the brand switcher + event ⋯ menu are `TopSheet` + `Sheet.web`).

4. **(Optional, complementary) defer the heavy-page commit off the open tick** so even the first frame isn't blocked — e.g. on the event page, schedule `setManageMenuVisible(true)` after the menu mount frame, or memoize the heavy event tree so the menu mount doesn't re-render it. This is a hardening adjunct, NOT the primary fix; the compositor-transition change (item 1) is sufficient and primitive-local.

**Why a duration/spring retune alone is INSUFFICIENT (ruled out):** `withTiming` is wall-clock based, so shortening 280ms does not prevent the freeze — a blocked main thread still cannot paint intermediate frames; it would just snap from a different position. The fix must move the animation off the main thread (compositor CSS), not merely shorten it.

## Regression-safety plan

- **Native byte-identical:** every change `Platform.OS==='web'`-gated; native keeps `withTiming` + `useSharedValue` + `useAnimatedStyle`. DEC-080/DEC-NEW-A: BOTH TopSheet consumers — `BrandSwitcherSheet` (`fixed-70`) + `UniversalCreatorSheet` (`compact`) — verified open-correctly on web AND unchanged on native; the event ⋯ `Sheet.web` menu + `GlobalSearchSheet` verified too.
- **No-fixed gate not re-tripped:** the CSS-transition approach uses `transform`/`opacity` on the existing `absoluteFill` (`position:absolute`) root — it introduces NO `position:'fixed'`, so `I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED` stays green. The R2 full-height + opaque scrim is untouched.
- **New regression contract (fails-on-revert):** a web harness (extend `evidence/ORCH-1136-R3/model.html` + a CSS-transition variant) that asserts, under a representative mid-open long main-thread task, the panel's painted `transform` continues to advance (compositor) rather than freezing at a mid-open position — FAIL when reverted to the JS-rAF path, PASS with the CSS transition. Plus a strict-grep gate asserting the web sheet animation is web-gated CSS (no `withTiming`-driven web `useAnimatedStyle` on these sheets) while native retains reanimated.
- **Reap the diagnostic:** delete the `[ORCH-1136-DIAG]` block (`app/event/[id]/index.tsx:164-184`) — its job (prove the handler runs + brand present + toast renders on web) is done.

## Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction vs prior rounds |
|-------|-------|--------------------------------|
| Docs | reanimated web = JSReanimated, main-thread rAF, inline-style DOM writes (vendor source) | R1/R2 never inspected the web animation engine |
| Schema/Query | n/a (UI) | — |
| Code | `withTiming`/`useAnimatedStyle` on TopSheet + Sheet.web; wall-clock timing; heavy Hub/event pages | R2's "event ⋯ handler not reached" was wrong — it IS reached (Seth saw the diag toast), just slow |
| Runtime | harness: LIGHT glides smoothly; HEAVY + a long task FREEZES the panel mid-open then snaps (translateY ≈ −197…−268px = near the top); a 250ms commit = one 252ms Long Task | R2 capped F-1 at suspected (no auth); R3 reframes via Seth's runtime test — slow, not dead |
| Data | n/a | — |

## Repro evidence summary
- **Proven at runtime (Chromium, no auth):** web reanimated = JSReanimated main-thread rAF writing inline `style.transform` per frame; `withTiming` is wall-clock; a long main-thread task during the 280ms window freezes the panel at its last mid-open position then snaps; a 250ms commit-burst = a single 252ms browser Long Task; LIGHT pages glide, HEAVY pages don't.
- **NOT reproduced (named blocker = no login):** the exact live long-task on the authed Hub/event page (React commit vs hero-video decode vs style recalc) — caps F-2/F-3 at probable. One authed Performance-tab capture (record the brand-chip tap on Hub) names it and lifts to proven.

## Blast radius / cross-surface
- **In-scope (Business Web):** every web sheet using the reanimated `withTiming` path — `TopSheet.tsx` (BrandSwitcherSheet + UniversalCreatorSheet), `Sheet.web.tsx` (event ⋯ via `EventManageMenu`, `GlobalSearchSheet`, all wide-desktop sheets), `SheetMobile.tsx` (narrow-web bottom sheets), `Modal.tsx`, `Toast.tsx`. ALL benefit from the compositor-transition fix.
- **Blast-flagged (native):** these are shared RN primitives — the fix MUST be web-gated so iOS/Android reanimated stays byte-identical.
- **Not touched:** Consumer app, Admin, Buyer-web public pages (separate surfaces; if they share these primitives the web-gate still applies, but they are out of this ORCH's scope).

## Invariant impact (flagged; not pre-decided)
- **DEC-080 / DEC-NEW-A** — TopSheet's 2 approved consumers; both must stay correct on web + native.
- **I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED** — must stay green; the fix uses `transform`/`opacity` transitions on the `absoluteFill` root, NO `position:fixed`.
- **Const #1 (no dead taps)** — Symptom 2 is resolved by making the menu open visibly fast (it already opens; the fix removes the "looks dead" slowness).

## Discoveries for orchestrator
1. **[HIGH] The slow web sheet animation is the SINGLE root cause behind both ORCH-1136 remaining symptoms** — reap the `[ORCH-1136-DIAG]` block at CLOSE; close Symptoms 2 + 3 together.
2. **[MED] The compositor-vs-main-thread distinction is general** — any RN-web `withTiming`-animated surface in mingla-business is subject to main-thread-blocking freeze on heavy pages; worth a follow-on audit beyond sheets (Modal/Toast already flagged in blast).
3. **[ENV] Reanimated 4 on web requires `process`/`global` shims + `.web.js` resolve order + a `TurboModuleRegistry`-free path to bundle standalone** — documented in the R3 harness; carry forward for future web-animation investigations.
4. **[ENV] Brackets in the worktree path break the web bundler** — reuse the bracket-free `/tmp` harness; carried from R1/R2.

## Confidence
- **F-1 (web engine = main-thread JS rAF + inline-style writes):** confirmed (source + version + runtime path).
- **F-2 (long task freezes the panel mid-open):** probable (harness-proven mechanism; exact live long-task unnamed without auth).
- **F-3 (heavy-vs-light asymmetry):** probable (source weight + harness).
- **F-4 (subsumes Symptoms 2 + 3):** probable (Seth's runtime test + R2's prior refutations).

## Recommended next phase
SPEC the web-gated compositor CSS-transition fix for the shared sheet primitives (TopSheet + Sheet.web at minimum; SheetMobile/Modal/Toast per SPEC scope), native byte-identical, no `position:fixed`. Bind: (1) the new fails-on-revert harness (compositor advances vs JS-rAF freeze under a mid-open long task); (2) a strict-grep gate that the web sheet animation is CSS-transition-driven (not `withTiming` web `useAnimatedStyle`) while native keeps reanimated; (3) reap the `[ORCH-1136-DIAG]` block. One batch. Recommend an authed Performance-tab capture of the Hub brand-chip tap as the first IMPLEMENT/TEST step to name the live long-task and lift F-2 to proven, but the fix does not depend on it (the compositor move fixes the freeze regardless of which task causes it).
