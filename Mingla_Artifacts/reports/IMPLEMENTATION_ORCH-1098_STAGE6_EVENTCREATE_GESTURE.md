# IMPLEMENTATION — ORCH-1098 Stage 6: the event-create gesture crash on phone web

Date: 2026-06-07
Author: Claude (mingla-implementor)
Worktree: `~/Desktop/mingla-orchs/ORCH-1098-[business-web-real-app-on-mobile]/` on branch `ORCH-1098-stage6-eventcreate-gesture`
Base: `a5ff7759f` (ORCH-1098 Stage 5 — the React #300 + compose-OOM residual chain; NOT yet merged to main, so Stage 6 is stacked on it so the Stage-5 hooks-order fix is retained — see "Branch base" below).
Device: physical Samsung **SM-A725F** (adb serial `R58R54YV7JT`), Android 14, Chrome (CDP-driven).
Constraints honoured: native iOS/Android **byte-unchanged** (web-gated split); NO auth/Stripe/schema change; NO new deps; NO deploy/OTA/merge. adb reverse/forward torn down; local server killed; temp device screencaps removed; Samsung left as-is.

---

## Headline

**FIXED — yes.** The 3rd reanimated-on-web crash in this app is closed.

The "Create event, experience, or trip" picker (`UniversalCreatorSheet`) opens a **`TopSheet`**, whose `<GestureDetector>` calls `react-native-gesture-handler`'s `useAnimatedGesture()` → `Reanimated.useEvent(...)`. **`react-native-reanimated@4` removed `useEvent`** and the reanimated WEB shim does not provide it, so the instant the sheet mounts on phone web it throws `TypeError: Reanimated.useEvent is not a function`, the RN error boundary renders "Something broke," and the route redirects to `/`. Exactly the QA-reported signature.

Fix = **a small systemic web-gate**: a shared `WebSafeGestureDetector` (native = real `<GestureDetector>`, byte-identical; `.web.tsx` = passthrough that never mounts `GestureDetector`). The **three** overlay primitives that mount a swipe gesture (`TopSheet`, `SheetMobile`, `Toast`) now route through it, so the entire `useEvent`-on-web crash class is closed in one move — not just the one component on the create path. Native is byte-unchanged.

Device-proven on the Samsung with a controlled before/after on the SAME lever URL: BEFORE → "Something broke"; AFTER → the create picker renders fully, zero `useEvent` errors.

---

## Branch base (deviation from the literal dispatch, justified)

The dispatch said `git checkout -b … origin/main`. I instead based Stage 6 on the **Stage 5 branch** (`a5ff7759f`), because:
- Stage 5's `app/_layout.tsx` React #300 fix is NOT yet on `origin/main` (Stage 5 is pushed to `origin/ORCH-1098-stage5-residuals`, unmerged).
- The QA that found this gesture crash ran against a build that INCLUDED Stage 5 (it confirms "React #300 is gone"). Branching off bare `origin/main` would re-introduce React #300 and the compose OOM, contradicting the dispatch's own note that "Stage 5 … holds."
- Stage 6 is the next link in the same residual chain. Net diff vs origin/main therefore contains Stage 5 + Stage 6; the orchestrator should merge them as the chain (or merge Stage 5 first, then Stage 6).

---

## Root cause (file:line)

Mechanism chain (all on the create-flow path):

1. `/hub/events` "+" button (`app/(tabs)/hub/_layout.tsx:187`, `accessibilityLabel="Create event, experience, or trip"`) → opens `UniversalCreatorSheet` (`app/(tabs)/hub/_layout.tsx:227-234`).
2. `src/components/ui/UniversalCreatorSheet.tsx:108` renders `<TopSheet visible … heightMode="compact">`.
3. `src/components/ui/TopSheet.tsx` (pre-fix `:353`) renders `<GestureDetector gesture={panGesture}>` once the sheet is `mounted` (i.e. visible).
4. `react-native-gesture-handler@2.28`'s `GestureDetector` calls `useAnimatedGesture()` →
   `node_modules/react-native-gesture-handler/lib/module/handlers/gestures/GestureDetector/useAnimatedGesture.js:135`:
   `const event = Reanimated.useEvent(callback, [...], needsRebuild);`
5. `react-native-reanimated@4.1.1` removed `useEvent`; the reanimated **web** shim has no `useEvent` → `Reanimated.useEvent` is `undefined` → `TypeError: Reanimated.useEvent is not a function`.
6. Uncaught → RN error boundary → "Something broke" → redirect to `/`.

This is NOT a deprecated v1/v2 gesture API in our source — there is **no** `useAnimatedGestureHandler` / `Animated.event` / `<PanGestureHandler>` anywhere in `app/`, `src/`, or `packages/`. The offender is the **modern `Gesture.Pan()` + `<GestureDetector>` v2 API**, which is correct on native but whose internal reanimated `useEvent` dependency is missing in the reanimated-4 web build. So the right fix is to web-gate the `GestureDetector`, not to migrate an API.

The same defect latently affects `SheetMobile.tsx` (`:317`, the narrow-web bottom sheet that `Sheet.web.tsx` delegates to) and `Toast.tsx` (`:366`, swipe-up dismiss) — any time either mounts on web it would throw the same `useEvent`. Both are fixed in this pass.

### Why static analysis alone said only "suspected"
No source-level deprecated gesture API exists; the minified production stack named `e.useAnimatedGesture` (a gesture-handler internal, not our code). The exact component (`UniversalCreatorSheet` → `TopSheet`) and the exact trigger (sheet OPEN, not first paint) were confirmed on device (below), not inferred.

---

## Fix — systemic web-gate (smallest robust)

### New: `src/components/ui/WebSafeGestureDetector.tsx` (+~70) and `.web.tsx` (+~35)
- **Native (`.tsx`):** `({gesture, children}) => <GestureDetector gesture={gesture}>{children}</GestureDetector>`. Byte-equivalent to a bare `<GestureDetector>` — native swipe behaviour unchanged.
- **Web (`.web.tsx`):** `({children}) => children`. No `GestureDetector` mounted → the reanimated `useEvent` code path never runs → no crash. `gesture` is accepted for API parity and ignored. Type-only `react-native-gesture-handler` import only (no value import on web).
- Swipe-to-dismiss is a native nicety; on web every sheet + toast already dismisses via scrim-tap, the explicit close button, and Android back — so nothing user-facing is lost on web.

### Why systemic over per-component splits
A per-component `.web.tsx` for each of TopSheet/SheetMobile/Toast (mirroring `BottomNav.web.tsx` / `TemplatePreviewDrawer.web.tsx`) would also work, but it would duplicate each sheet's ~150-line body across two files and leave every FUTURE sheet a latent phone-web crash. One shared `WebSafeGestureDetector` closes the whole class with three one-line tag swaps and keeps native byte-identical. (Discovery #1 of Stage 5 explicitly recommended sweeping for exactly this `.web.tsx`-falls-through-to-native pattern.)

### Babel/config angle — checked, not applicable
There is **no `babel.config.js`** in `mingla-business`; it uses `babel-preset-expo`, which already bundles the worklets plugin correctly. The crash is purely the gesture-handler↔reanimated-4 web API mismatch, not a missing/misordered babel plugin. A config-level fix is neither available nor needed.

### Modified consumers (import swap + `<GestureDetector>` → `<WebSafeGestureDetector>`)
- `src/components/ui/TopSheet.tsx` — `import { Gesture }` (dropped `GestureDetector`) + `import { WebSafeGestureDetector }`; tag at `:355`/`:434`.
- `src/components/ui/SheetMobile.tsx` — same; tag at `:319`/`:387`.
- `src/components/ui/Toast.tsx` — `import { Gesture, GestureHandlerRootView }` (dropped `GestureDetector`, kept the safe `GestureHandlerRootView`) + wrapper import; tag at `:366`/`:455`.

---

## Old → New receipts

### `src/components/ui/WebSafeGestureDetector.tsx` (new)
**Before:** did not exist.
**After:** native passthrough to the real `<GestureDetector>`.
**Why:** native must keep identical swipe behaviour while web gets a crash-free variant.

### `src/components/ui/WebSafeGestureDetector.web.tsx` (new)
**Before:** did not exist.
**After:** web passthrough that renders `children` and never mounts `GestureDetector` (kills the `useEvent` path).
**Why:** reanimated-4 web shim lacks `useEvent`; mounting `<GestureDetector>` on web crashes.

### `src/components/ui/TopSheet.tsx`
**Before:** `import { Gesture, GestureDetector }`; `<GestureDetector gesture={panGesture}>`.
**After:** `import { Gesture }` + `import { WebSafeGestureDetector }`; `<WebSafeGestureDetector gesture={panGesture}>`.
**Why:** TopSheet is the SOLE crash on the create path (UniversalCreatorSheet → TopSheet).
**Lines changed:** ~4.

### `src/components/ui/SheetMobile.tsx`
**Before/After:** same swap. **Why:** latent identical crash whenever a bottom Sheet opens on web (PublishErrorsSheet, GlobalSearchSheet, etc.). **Lines changed:** ~4.

### `src/components/ui/Toast.tsx`
**Before/After:** same swap (kept `GestureHandlerRootView`). **Why:** latent identical crash whenever a toast appears on web. **Lines changed:** ~4.

---

## Device evidence — controlled before/after on the Samsung

Because localhost has no session and the wizard's edit route is signed-out-gated, I used a **temporary web-only lever** (`/event/create?s6sheettest=1`, `Platform.OS==="web"`, mirrors the Stage-5 `?s5bisect=` lever) that mounts the two crashing sheets OPEN signed-out: `UniversalCreatorSheet` (→TopSheet) and a bottom `Sheet` (→SheetMobile). **The lever + its component were REMOVED before commit** (`git clean`; `app/event/create.tsx` reverted to byte-clean — verified 0 lever refs).

Driver: local `expo export -p web` served over `adb reverse tcp:8099`; Chrome remote-debugging (CDP) for console + DOM; `adb screencap` for screenshots.

| Run | Build | URL | Result |
|---|---|---|---|
| **BEFORE (prod, signed-in)** | production `business.usemingla.com` (Leggo This) | `/hub/events` → click "Create event, experience, or trip" | URL → `/`; body = "Something broke"; **`TypeError: n.Reanimated.useEvent is not a function`** (1 console error). Screenshot `stage6_screens/before_prod_something_broke.png`. Validates the harness + reproduces the QA exactly. |
| **BEFORE (lever, reverted consumers)** | local export with the 3 consumers reverted to bare `<GestureDetector>` | `/event/create?s6sheettest=1` | `brokeScreen: true` ("Something broke / Try again / Get help"). Screenshot `stage6_screens/before_lever_something_broke.png`. |
| **AFTER (lever, fix applied)** | local export with the `WebSafeGestureDetector` fix | `/event/create?s6sheettest=1` | `brokeScreen: false`; body = **"What are you creating? … Create event … Create experience … Create trip or otherwise"** (the picker renders fully) + the bottom Sheet mounted; **0 `useEvent`/`useAnimatedGesture` errors, 0 exceptions, 0 console errors**. Screenshot `stage6_screens/after_lever_creator_sheet_open.png`. |
| **AFTER — next step** | same | click "Create event" in the open picker | routed to `/event/create` (param cleared), no crash, `brokeScreen: false`. (The subsequent `/event/[id]/edit` wizard is signed-out-gated on localhost → shows the route recovery, not the wizard; that is the session limitation, not the bug. The wizard's own tree uses NO `GestureDetector` — only `PublishErrorsSheet`→`Sheet`, now fixed.) |

Same device, same lever URL: BEFORE crashes, AFTER renders the exact picker that crashed. That is the decisive proof.

Logcat: no SIGSEGV / renderer crash either way — this is a JS `TypeError` caught by the RN error boundary, consistent with the QA.

---

## Regression test (Step 0.5)

`mingla-business/__tests__/orch1098Stage6EventCreateGestureWebSafe.test.ts` (12 tests). Source-structure assertions (the RN-web overlays are jsdom-fragile; the Stage-4/5 gates use the same source-parse approach):
- `WebSafeGestureDetector.tsx` exists and delegates to the REAL `<GestureDetector>` (native byte-equivalent).
- `WebSafeGestureDetector.web.tsx` never mounts `<GestureDetector>`, imports only a type from gesture-handler, and returns `children`.
- TopSheet / SheetMobile / Toast each: no bare `<GestureDetector …>` in JSX; wrap with `<WebSafeGestureDetector gesture=…>`; do not value-import `GestureDetector` from gesture-handler.

**Passing run:** 12 passed, 12 total.
**Fails-on-revert verified @ `a5ff7759f`:** with the 3 consumers reverted to bare `<GestureDetector>` (`git stash push -- TopSheet SheetMobile Toast`), the suite went **9 failed / 3 passed** (the 3 wrapper-existence tests stay green, as designed); restoring the fix → 12/12 green again. The test genuinely exercises the bug.
**Ships in the same diff:** `git diff origin/main...HEAD --name-only` includes the test file.

Broader: `__tests__/orch1098*` + `src/components/ui/__tests__/Sheet*` → **7 suites / 50 tests PASS** (includes Stage 4 adversarial BottomNav-reanimated gate + Stage 5 gates + this Stage 6 gate).

---

## Verification matrix / completion condition

1. Crash fixed (in-app picker) — **PASS** (device before/after; AFTER renders the picker, 0 `useEvent`).
2. Crash fixed (deep-link path) — **PASS by mechanism**: the deep-link `/event/create` was already redirect-clean; the crash was the picker sheet, now web-gated. AFTER "click Create event" routed with no crash.
3. Next wizard step renders — **PASS by code-path**: wizard steps use no `GestureDetector`; the only wizard sheet (`PublishErrorsSheet`→`Sheet`→`SheetMobile`) is now fixed. Signed-out localhost can't mount the signed-in wizard to screenshot it (route-gated); not a regression.
4. Regression test green + fails-on-revert @ `a5ff7759f` — **PASS**.
5. `tsc --noEmit` clean on touched files; `eslint` clean on touched files — **PASS** (260 full-tree baseline unchanged — pre-existing, same on origin/main).
6. `web:export` exit 0 (clean build, no lever) — **PASS**.
7. Native byte-unchanged — **PASS**: the only native-reachable change is the `WebSafeGestureDetector.tsx` (native) which delegates to the real `<GestureDetector>` with the same `gesture`+single-child; Metro picks `.web.tsx` only on web. No `.tsx`/native logic in TopSheet/SheetMobile/Toast changed besides the wrapper tag, which on native renders the identical `<GestureDetector>`.

No edge-function / migration / Deno work in this ORCH (web-only RN components) → that part of the completion condition is N/A.

---

## Cross-surface impact

- **Business Web (phone browser)** — TARGET: the create picker (and every sheet/toast) opens without "Something broke". Files: the 3 consumers + the new wrapper pair.
- **Business Web (desktop)** — unaffected: desktop never hit `useEvent` because `Sheet.web.tsx`'s wide branch is a plain `<Modal>` card (no GestureDetector); TopSheet desktop is the same component but desktop reanimated web is fine here — the wrapper passthrough is harmless (desktop simply loses a swipe affordance it never used with a mouse).
- **Business iOS / Android (native)** — byte-unchanged: `WebSafeGestureDetector.tsx` (native) renders the real `<GestureDetector>`; native swipe-to-dismiss on every sheet + toast behaves exactly as before.
- **Consumer app / Admin / buyer-anon web** — N/A (different codebases; this is `mingla-business` only).

---

## Constitutional / invariant check
- No `any`, no `@ts-ignore`, explicit return types on the new wrapper. — PASS
- No silent catches added. — PASS (N/A)
- All overlay states preserved (the sheets still render loading/open/close; only the gesture wrapper changed). — PASS
- TopSheet two-acceptable-consumers invariant (DEC-NEW-A) untouched — wrapper is internal to TopSheet. — PASS
- Append-only tests: only NEW test file added; no existing test modified. — PASS

---

## Discoveries for orchestrator

1. **Three reanimated-on-web crash classes are now all closed via the SAME pattern** (BottomNav `.web.tsx`, TemplatePreviewDrawer `.web.tsx`, and now `WebSafeGestureDetector`). Recommend any FUTURE swipe/gesture overlay routes through `WebSafeGestureDetector` rather than importing `GestureDetector` directly — the Stage-6 regression test enforces this for the existing three; a repo-wide strict-grep gate (`no bare GestureDetector import in src/`) would make it permanent.
2. **Stage 5 + Stage 6 are an unmerged chain.** Stage 5 (`a5ff7759f`) is on `origin/ORCH-1098-stage5-residuals`, not main; Stage 6 is stacked on it. Merge Stage 5 then Stage 6 (or the combined branch). A bare-`origin/main` merge of Stage 6 alone would lack the Stage-5 React #300 + compose-OOM fixes.
3. **Signed-in production smoke is deploy-bounded.** The AFTER proof is on a local export (loop/crash is auth-independent — proven by the lever). A signed-in production smoke of the in-app "Create event, experience, or trip" button on `business.usemingla.com` should be run once Stage 5+6 merge + deploy (mirrors Stage 5 Discovery #3).

---

## Completion

FIXED and device-proven. Targeted-but-systemic web-gate (`WebSafeGestureDetector`) closes the `Reanimated.useEvent`-on-web crash class; native byte-unchanged; regression test green + fails-on-revert @ `a5ff7759f`; web:export exit 0; tsc/eslint clean on touched files. Temporary lever removed; adb reverse/forward + local server torn down; device temp files removed; Samsung left as-is. No deploy/OTA/merge (orchestrator owns).
