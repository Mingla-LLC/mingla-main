# INVESTIGATION — ORCH-1211 [business notifications inbox crashes on mobile web]

- **Worktree:** `~/Desktop/mingla-orchs/1211-[notif-web-crash]/` on branch `1211-notif-web-crash`
- **Date:** 2026-06-22
- **Skill:** mingla-forensics (INVESTIGATE)
- **Confidence:** **root cause PROVEN** (live runtime error captured in real Chromium against the actual `expo start --web` dev server)
- **COMMS handled:** COMMS-0052 (BLOCK/OPEN) acknowledged — business OTA is frozen; this is a web-only fix that ships via Vercel `[deploy]` only.

---

## 1. Symptom summary (expected vs actual)

- **Expected:** On Mingla **Business over mobile web**, tapping the notifications bell (`router.push("/notifications")`) renders the notifications inbox (`BusinessNotificationsScreen`).
- **Actual (Seth, today):** The global crash fallback appears — **"Something broke." / "We're on it." / "Try again" / "Get help"** — and the user never sees the inbox.

The fallback copy matches `DefaultFallback` in `mingla-business/src/components/ui/ErrorBoundary.tsx` (verbatim: "Something broke.", "We're on it.", buttons "Try again" / "Get help"), which is the default fallback of the global `ErrorBoundary` wrapping `<Stack>` in `app/_layout.tsx:712`. The screen's OWN data-error state renders a single **"Retry"** button (`ErrorState`, line 686) — so the observed two-button fallback is the GLOBAL boundary catching a hard render-time throw, NOT the graceful data-error path. Confirmed.

---

## 2. Investigation manifest (files read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `COMMS_LEDGER.md` (anchor) | Mandatory on-entry; found + acked COMMS-0052 (business OTA frozen). |
| 2 | `mingla-business/src/components/notifications/BusinessNotificationsScreen.tsx` | The screen named in the dispatch; the suspected throw site. Read verbatim, all 1079 lines. |
| 3 | `mingla-business/app/notifications.tsx` | The route that imports + mounts the screen; the import that triggers eval. |
| 4 | `mingla-business/src/components/ui/ErrorBoundary.tsx` | Confirm the fallback copy + that it is the global boundary. |
| 5 | `mingla-business/app/_layout.tsx` (697–714) | Confirm `ErrorBoundary` wraps `<Stack>` → catches route render throws. |
| 6 | `node_modules/react-native-gesture-handler/ReanimatedSwipeable/package.json` + subpath module | Test the orchestrator's `ReanimatedSwipeable`-import hypothesis. |
| 7 | `node_modules/react-native-reanimated/...` (index, package.json, layoutReanimation/LinearTransition) | Resolve `LinearTransition` web behavior. |
| 8 | `mingla-business/src/constants/designSystem.ts` (durations) | Rule out `durations.entry` being the undefined value. |
| 9 | `.github/scripts/strict-grep/orch-1105-web-gesture-safe.mjs`, `orch-1001-no-native-turbomodule-in-web-bundle.mjs` | Establish the web-native-on-web crash precedent + the gate shape + the `.web` stub budget (ORCH-1083/1001). |

---

## 3. Q-scorecard

**Q1 — Is the two-button fallback the GLOBAL boundary, not the screen's own error state?**
Verdict: **YES (proven).** Copy + buttons match `DefaultFallback`; the screen's data error is a single "Retry". See F-1.

**Q2 — Is the crash a hard RENDER/EVAL throw on `/notifications`, not the graceful data path?**
Verdict: **YES (proven).** Live error captured; the stack is `<global>` (module eval), reached via `app/notifications.tsx:31` import. See F-2.

**Q3 — Is the orchestrator's leading hypothesis (the unconditional `ReanimatedSwipeable` import at line 53 throws on web) the actual cause?**
Verdict: **NO — REFUTED.** The real Metro web export (`expo export -p web`) bundled cleanly (664 modules, no error), and the captured runtime stack points to **line 145**, not the import. `ReanimatedSwipeable` is a real (latent) web-render hazard but it is NOT the throw site here because its USAGE is guarded (`if (isWeb) return <NotificationRowInner/>`) and its IMPORT resolves without throwing. See F-3 / F-4.

**Q4 — What is the exact throwing line and value?**
Verdict: **`BusinessNotificationsScreen.tsx:145`** — `const EXPAND_TRANSITION = LinearTransition.duration(durations.entry).easing(EASE_OUT);`. `LinearTransition` (from `react-native-reanimated`) is **`undefined` at module eval on web**, so `.duration` throws `TypeError: Cannot read properties of undefined (reading 'duration')`. This is a **module-top-level call** that runs the instant the route chunk is required — before any render guard. See F-2 (proven).

**Q5 — Regression window / who introduced it?**
Verdict: **commit `caaab1377` (ORCH-1142, PR #485, 2026-06-15).** `git blame` line 145 = `caaab1377`. Same commit the orchestrator flagged, but a different line than hypothesized. See F-5.

**Q6 — Blast radius beyond `/notifications` web?**
Verdict: **contained.** Only `app/notifications.tsx` imports `BusinessNotificationsScreen`. Native (iOS/Android) is unaffected (`LinearTransition` is defined on native). See §6.

---

## 4. Findings (six-field evidence)

### F-1 — The fallback is the GLOBAL ErrorBoundary, not the screen's data-error state
- **Symptom:** Two buttons "Try again" + "Get help" under "Something broke. / We're on it."
- **Layer:** code
- **Probe:** Read `ErrorBoundary.tsx` + `_layout.tsx`; compare to the screen's `ErrorState`.
- **Evidence:** `ErrorBoundary.tsx:59-79` `DefaultFallback` renders Text "Something broke." (`:62`), "We're on it." (`:63`), `<Button label="Try again" …/>` (`:66`), `<Button label="Get help" …/>` (`:72`). `_layout.tsx:697-713` mounts `<ErrorBoundary …><Stack …/></ErrorBoundary>`. The screen's own error path: `BusinessNotificationsScreen.tsx:686` `<Text style={styles.retryLabel}>Retry</Text>` (single button).
- **Mechanism:** A render/eval throw inside any `<Stack>` route → the global `ErrorBoundary` → `DefaultFallback` (two buttons). The single-"Retry" screen state is never reached because the throw is in module eval, before the screen's JSX renders.
- **Severity:** CONFIRMED ROOT CAUSE (the boundary is the surface; the throw below is the cause).

### F-2 — `LinearTransition.duration()` at module top-level throws on web (THE root cause)
- **Symptom:** `TypeError: Cannot read properties of undefined (reading 'duration')`.
- **Layer:** runtime (live repro) + code.
- **Probe:** `npx expo start --web --port 8099`; real Chromium (Playwright) → `http://localhost:8099/notifications`; captured `console`/`pageerror` + screenshot; then disassembled the served web bundle.
- **Evidence (verbatim):**
  - Dev error overlay (screenshot `evidence/ORCH-1211/dev-overlay-notifications.png`): **"Uncaught Error — Cannot read properties of undefined (reading 'duration')"**, **Source: `src/components/notifications/BusinessNotificationsScreen.tsx (145:44)`**, highlighted line `const EXPAND_TRANSITION = LinearTransition.duration(durations.entry).easing(EASE_OUT);`, **Call Stack: `<global>` BusinessNotificationsScreen.tsx:145:44 → `<global>` app/notifications.tsx:31**.
  - Served web bundle line 417302: `const EXPAND_TRANSITION = _reactNativeReanimated.LinearTransition.duration(_constantsDesignSystem.durations.entry).easing(EASE_OUT);`
  - Source line 145 (`BusinessNotificationsScreen.tsx`): `const EXPAND_TRANSITION = LinearTransition.duration(durations.entry).easing(EASE_OUT);`
  - `durations.entry` IS defined (`designSystem.ts:338 entry: 260`) — so the undefined value is `LinearTransition`, not `durations`. Confirmed by the bundle reading `.LinearTransition.duration`.
- **Mechanism:** `import { … LinearTransition … } from "react-native-reanimated"` (line 41) + the **module-top-level** `LinearTransition.duration(...)` call (line 145) execute the moment `app/notifications.tsx` imports the screen. On the web target, `LinearTransition` resolves to `undefined` at this eval point, so `.duration` throws. The uncaught throw bubbles up the route mount → the global `ErrorBoundary` → `DefaultFallback`. (Dev shows the red overlay; production shows the two-button fallback — same throw.)
- **Severity:** CONFIRMED ROOT CAUSE.

### F-3 — The orchestrator's `ReanimatedSwipeable`-import hypothesis is REFUTED as the throw site
- **Symptom:** (hypothesis) line 53 `import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable"` crashes web at import.
- **Layer:** runtime + schema (package resolution).
- **Probe:** `npx expo export -p web --output-dir /tmp/orch1211-webbuild` (the REAL Metro web resolver); inspected the subpath `package.json`.
- **Evidence:** `expo export -p web` succeeded: "Web Bundled … index.js (664 modules)", `web bundles (1): … 985 kB`, **no eval/import error**. The `ReanimatedSwipeable` subpath `package.json` has fields `main`/`module`/`react-native`/`types` but **no `browser` field** (so web resolves to the native module path) — yet importing it does NOT throw at eval (it only pulls in references; `GestureDetector`/`measure`/`runOnUI` are not CALLED at module load). The captured runtime stack is line 145, not line 53.
- **Mechanism:** The import is a latent web hazard only if `ReanimatedSwipeable` is RENDERED on web — but its render is guarded (`if (isWeb) return <NotificationRowInner/>`, line 526). It is therefore NOT the cause of this crash. The crash is the unguarded module-top-level `LinearTransition.duration()` at line 145.
- **Severity:** RULED OUT (as the throw site for ORCH-1211). See F-4 for its disposition.

### F-4 — `ReanimatedSwipeable` import is a latent (not currently firing) web hazard — flag, do not let the fix re-introduce it
- **Symptom:** none today (usage guarded), but the import has no `.web` stub.
- **Layer:** code.
- **Probe:** Read `ReanimatedSwipeable.js` internals + `orch-1105-web-gesture-safe.mjs`.
- **Evidence:** `ReanimatedSwipeable.js` line 8 `import { GestureDetector } from '../../handlers/gestures/GestureDetector';` + line 5 `useAnimatedRef, measure, runOnUI`. `orch-1105-web-gesture-safe.mjs` documents the exact crash class: "react-native-gesture-handler@2.28's `<GestureDetector>` calls `Reanimated.useEvent`, which has no web implementation. Mounting a bare `<GestureDetector>` on web throws and crashes the whole route." Today `ReanimatedSwipeable` is only rendered on native (guarded at line 526), so this does not fire.
- **Mechanism:** If a future change removed the `if (isWeb)` guard at line 526 (or rendered the swipeable on web), the `GestureDetector` → `useEvent` web crash would fire. The SPEC must preserve the guard and should additionally remove the unconditional import from the web bundle for defense-in-depth (matches the ORCH-1083/1001 stub budget).
- **Severity:** SUSPECTED CONTRIBUTOR (latent; in scope to harden, not the firing cause).

### F-5 — Regression window
- **Symptom:** Worked before; broke after ORCH-1142.
- **Layer:** code (git history).
- **Probe:** `git blame -L 145,145` + `git log -S`.
- **Evidence:** `git blame` line 145 → `caaab1377e (Seth Ogieva 2026-06-15) const EXPAND_TRANSITION = LinearTransition.duration(durations.entry).easing(EASE_OUT);`. `git log -S "LinearTransition.duration(durations.entry)"` → `caaab1377 ORCH-1142: business notifications full-read (tap-to-expand) + soft-delete [deploy] (#485)`.
- **Mechanism:** ORCH-1142 added BOTH the `ReanimatedSwipeable` import (line 53) AND the `LinearTransition` expand/collapse layout animation (lines 41 + 145). The latter is the actual web breaker.
- **Severity:** CONFIRMED (regression window).

---

## 5. Five-Truth-Layer reconciliation

| Layer | Finding |
|-------|---------|
| **Docs** | The screen's own JSDoc (line 22) lists a "web variant" state — web IS a supported surface; the inbox is meant to render on web. The crash contradicts the design intent. |
| **Schema (pkg resolution)** | `react-native-reanimated` has no `browser`/`index.web` entry that strips `LinearTransition`; `LinearTransition` extends `ComplexAnimationBuilder` (`layoutReanimation/defaultTransitions/LinearTransition.js:14`). On web it evaluates to `undefined` AT THE EVAL POINT line 145 — a web layout-animation-builder availability gap. |
| **Code** | Line 145 calls `LinearTransition.duration(...)` at MODULE TOP LEVEL (no `isWeb` guard, runs at import). Line 53 imports `ReanimatedSwipeable` unconditionally (latent, guarded usage). |
| **Runtime** | Live Chromium against `expo start --web`: uncaught `TypeError: Cannot read properties of undefined (reading 'duration')` at `BusinessNotificationsScreen.tsx:145:44`, reached via `app/notifications.tsx:31`. |
| **Data** | N/A — the throw is in module eval, before any DB read; the hook never runs. |

**Contradiction flagged:** Docs say web is supported; code introduces a web-undefined symbol at module top level. The **code layer holds the truth** for the bug; the **runtime layer proves it**.

---

## 6. Blast radius & cross-surface map

- **In scope (broken):** Business **mobile web** + business **desktop web** `/notifications` route (surface 7 "Business Web preview" — and the deployed business web). The throw is at module eval, so EVERY web visit to `/notifications` crashes regardless of auth/data.
- **Out of scope (unaffected):** Business **iOS** + **Android** native (`LinearTransition` is defined on native; the screen renders fine — this matches Seth's report being web-only). Consumer iOS/Android, buyer/anon web, admin web do NOT import `BusinessNotificationsScreen` (grep: only `app/notifications.tsx` imports it).
- **Single importer:** `grep -rln BusinessNotificationsScreen app/ src/` → `app/notifications.tsx` (+ the screen itself + one jest test). Fix is contained to the screen file (+ optional `.web` sibling / gate).

---

## 7. Repro evidence (what was run)

1. `npx expo export -p web` → **bundled cleanly, 664 modules, no error** (refutes the import-throws-at-eval hypothesis under the real toolchain).
2. `npx expo start --web --port 8099` (real dev server) + Playwright real Chromium → `GET /notifications` → captured **`TypeError: Cannot read properties of undefined (reading 'duration')` at `BusinessNotificationsScreen.tsx:145:44`**, call stack `<global>` → `app/notifications.tsx:31`. Screenshot saved: `Mingla_Artifacts/evidence/ORCH-1211/dev-overlay-notifications.png` (expo-router dev error overlay showing line 145 highlighted).
3. Web bundle disassembly at line 417302 confirmed the compiled call `_reactNativeReanimated.LinearTransition.duration(_constantsDesignSystem.durations.entry)`.
4. `durations.entry` proven defined (`designSystem.ts:338`) — isolates `LinearTransition` as the undefined value.

> Note: a jest react-native-web render attempt produced a DIFFERENT error (`react-native-worklets` resolving to its native `src/` under jest's node resolver) — that was a JEST-ENVIRONMENT artifact, not the web bug, and is discarded. The authoritative evidence is the real `expo start --web` + Chromium repro above.

---

## 8. Invariant impact

- **I-WEB-GESTURE-SAFE (ORCH-1105, ACTIVE):** about `GestureDetector` direct imports in `mingla-business/src/components/ui` swipe sheets. `BusinessNotificationsScreen.tsx` is in `…/components/notifications/`, OUTSIDE that gate's `UI_DIR` scope, and the hazard here is a different symbol (`LinearTransition`, not `GestureDetector`). The existing gate does NOT cover this file. FLAG: the fix should add a sibling gate covering reanimated-layout-builder + ReanimatedSwipeable on web for the notifications screen (proposed in SPEC).
- **ORCH-1142 contract (soft-delete only; keep `deleted_at` fetch filter; no hard delete):** must be preserved by the fix. No change to the hook or delete semantics.
- No RLS/security impact (pure client render).

---

## 9. Discoveries for orchestrator

- **D-1 (latent, F-4):** `ReanimatedSwipeable` is imported unconditionally with no `.web` stub. Not firing today (guarded usage) but a future un-guard would crash web with the ORCH-1105 `useEvent` class. Recommend the SPEC harden it (defense-in-depth) but it is NOT required to fix ORCH-1211.
- **D-2:** The notifications screen sits OUTSIDE the `orch-1105-web-gesture-safe.mjs` gate scope (`components/ui` only). Reanimated-on-web hazards in `components/notifications/` are currently ungated — a new gate is warranted.
- **D-3 (COMMS-0052, acked):** This crash is on PROD business web right now and CANNOT be fixed by OTA (business OTA frozen). The Vercel web deploy is the ONLY ship path and is unaffected by the OTA freeze.

---

## 10. Confidence + recommended next phase

- **Confidence:** **root cause PROVEN** — live runtime error captured in real Chromium against the actual dev server, exact line + stack + screenshot, bundle disassembly, undefined-value isolated, regression commit identified.
- **Recommended next phase:** SPEC (this dispatch is INVESTIGATE+SPEC; SPEC follows as `SPEC_ORCH-1211_notif-web-crash.md`).
- **Recommended scope (direction only):** make the reanimated layout-animation (line 145 `LinearTransition`) web-safe so `/notifications` renders the inbox on web, WITHOUT changing native swipe-to-delete UX or the ORCH-1142 soft-delete contract; harden the latent `ReanimatedSwipeable` import as defense-in-depth; add a fails-on-revert regression guard + a happy-path web-render proof. Web-only; ships via Vercel `[deploy]`; NO business `eas update` (COMMS-0052).
