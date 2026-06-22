# SPEC — ORCH-1211 [business notifications inbox crashes on mobile web]

- **Worktree:** `~/Desktop/mingla-orchs/1211-[notif-web-crash]/` on branch `1211-notif-web-crash`
- **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1211_notif-web-crash.md` (root cause PROVEN)
- **Skill:** mingla-forensics (SPEC)
- **Ship path:** business WEB via Vercel `[deploy]` ONLY. **NO `eas update` / business OTA** (COMMS-0052 BLOCK in force — business OTA frozen until next native build). Pure-JS web-render fix; it rides the next business native build too, but the prod web crash is fixed by the Vercel deploy alone.

---

## 1. Executive summary

The Mingla Business `/notifications` route crashes the WHOLE page into the global "Something broke." fallback on web. Root cause (proven): `BusinessNotificationsScreen.tsx:145` calls `LinearTransition.duration(durations.entry)` at **module top level**. `LinearTransition` (a `react-native-reanimated` layout-animation builder) is **`undefined` on web at that eval point**, so reading `.duration` throws `TypeError: Cannot read properties of undefined (reading 'duration')` the instant the route imports the screen — before any render guard. The throw bubbles to the global `ErrorBoundary`, showing "Something broke. / Try again / Get help". Fix: make the layout-animation construction web-safe (no top-level reanimated-builder call that is undefined on web) so the inbox renders on web. Native swipe-to-delete UX and the ORCH-1142 soft-delete contract are unchanged.

---

## 2. Scope & non-goals

**In scope:**
- Make `BusinessNotificationsScreen.tsx` render on web without throwing — eliminate the module-top-level `LinearTransition.duration(...)` web crash (line 145, consumed at lines 529 & 539 as `layout={EXPAND_TRANSITION}`).
- Defense-in-depth (F-4): ensure the unconditional `ReanimatedSwipeable` import (line 53) does not regress into a web crash; keep its render guarded to native only.
- A fails-on-revert strict-grep regression gate + a happy-path web-render proof.

**Non-goals (explicitly NOT this ORCH):**
- NO change to native (iOS/Android) swipe-to-delete UX, the swipe panel, haptics, or the chevron animation — they work and are untouched.
- NO change to `useBusinessNotifications` (the hook), the `deleted_at` fetch filter, soft-delete semantics, or the DB. ORCH-1142 contract preserved (soft-delete only; never hard delete).
- NO change to the global `ErrorBoundary` or `_layout.tsx`.
- NO `eas update` / OTA of any kind. NO migration, NO edge fn.
- NO broad reanimated-on-web refactor across other screens.

**Assumptions:** reanimated `4.1.7`, gesture-handler `2.28.0` (verified installed). `LinearTransition` is defined on native (the screen renders fine on device today) and undefined on web at module-eval. `Platform.OS` / the existing `isWeb` const (line 140) is the platform discriminant already used throughout the file.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior demanded | Files touched there | Parity |
|---|---------|----------|--------------------------------|---------------------|--------|
| 1 | Consumer iOS (`app-mobile`) | No | n/a — does not import this screen | none | n/a |
| 2 | Consumer Android (`app-mobile`) | No | n/a | none | n/a |
| 3 | Buyer/anon Web (`mingla-business` public routes) | No | n/a — `/notifications` is operator-only (I-21) | none | n/a |
| 4 | Business iOS | Yes (regression-guard only) | Inbox + native swipe-to-delete + expand animation UNCHANGED | `BusinessNotificationsScreen.tsx` (shared file) | automatic (shared, guarded by platform) |
| 5 | Business Android | Yes (regression-guard only) | Same as iOS, UNCHANGED | same | automatic |
| 6 | Admin Web (`mingla-admin`) | No | n/a — separate app | none | n/a |
| 7 | **Business Web preview / deployed business web** | **Yes (the fix)** | Tapping the bell renders the notifications inbox (populated/empty/error states), NO global "Something broke." crash; web delete via the always-visible trash (existing `WebTrashButton`); expand/collapse works (web layout animation may degrade gracefully to no-animation or a web-safe transition) | `BusinessNotificationsScreen.tsx` web branch | manual (platform-split) |

Surfaces 1/2/3/6 not covered: they never import `BusinessNotificationsScreen` (single importer is `app/notifications.tsx`).

---

## 4. Layered specification

Only the **Component** layer is touched. DB / edge / service / hook / realtime: **unaffected — do not touch.**

### Component — `BusinessNotificationsScreen.tsx`

**Problem code (verbatim, current):**
- Line 41 (import): `LinearTransition,` (named import from `react-native-reanimated`)
- Line 145 (module top level): `const EXPAND_TRANSITION = LinearTransition.duration(durations.entry).easing(EASE_OUT);`
- Lines 529 & 539 (consumers): `layout={reducedMotion ? undefined : EXPAND_TRANSITION}`

**Required fix (implementor picks the minimal shape that satisfies the contract; the contract is binding, the shape below is the recommended one):**

The module-top-level `LinearTransition.duration(...)` call MUST NOT execute on web (it throws). Make `EXPAND_TRANSITION` resolve to a web-safe value. Two acceptable shapes:

- **Shape A (recommended — platform-guard the builder call, keep one file):** Replace the unconditional top-level constant with a platform-guarded one so web gets a safe value and native keeps the exact existing animation:
  - `const EXPAND_TRANSITION = isWeb ? undefined : LinearTransition.duration(durations.entry).easing(EASE_OUT);`
  - Then at the two `layout=` consumers, web already passes `undefined` (no layout animation on web — acceptable degraded state; the row still renders, expands/collapses without the animated reflow). Native is byte-identical to today.
  - This removes the web crash with a one-line guard and zero behavior change on native. `LinearTransition` is still imported (harmless on web — it's the CALL that throws, not the import; proven by the clean `expo export`), so no import change is strictly required. The implementor MAY additionally make the import lazy/native-only for tidiness but it is NOT required.

- **Shape B (platform-split file):** Extract the row-layout-animation concern into a `.web` sibling per the ORCH-1083/1001 stub-budget precedent (e.g. a tiny `notifRowLayoutTransition.ts` exporting `EXPAND_TRANSITION` on native and `undefined` on `.web.ts`). Heavier; only choose if Shape A cannot satisfy the gate cleanly.

**Mandatory behavior:**
- Web: `EXPAND_TRANSITION` MUST be `undefined` (or a web-defined transition that does not throw) so no top-level reanimated-builder method is invoked on web.
- Native: the layout animation MUST be byte-for-byte the existing `LinearTransition.duration(durations.entry).easing(EASE_OUT)` (verify the rendered native behavior is unchanged).
- The `reducedMotion ? undefined : EXPAND_TRANSITION` guard at lines 529/539 stays.

**Defense-in-depth (F-4) — REQUIRED minimal:**
- The `if (isWeb) return <Reanimated.View …><NotificationRowInner {...props} /></Reanimated.View>;` guard at line 526 (which keeps `ReanimatedSwipeable` off web) MUST be preserved. The implementor MUST NOT render `ReanimatedSwipeable` on web. (No code change needed if untouched; the gate below enforces it.)
- OPTIONAL (implementor discretion, low cost): make the `ReanimatedSwipeable` import native-only (platform `require`/`.web` stub) so it never enters the web bundle. Not required to fix the crash; nice-to-have for bundle hygiene.

**States (unchanged — must still render on web after fix):** skeleton (`query.isLoading`), error+retry (`query.isError && length===0`), empty (`length===0`), populated (sections + rows). All four must render on web without throwing.

---

## 5. Success criteria

- **SC-1-Web (the fix):** Navigating to `/notifications` on business web renders the inbox UI (skeleton → then populated/empty/error), and the page does NOT show the global "Something broke. / We're on it. / Try again / Get help" fallback. Proven by a real-Chromium render with NO uncaught `TypeError` and NO "Something broke" text in the DOM.
- **SC-2-Web:** The expand/collapse tap still works on web (tapping a row toggles expanded body) — with or without the reflow animation; it must not throw.
- **SC-3-Web:** The web delete affordance (always-visible trash, `WebTrashButton`) still calls `softDelete` (no regression to the ORCH-1142 web delete path).
- **SC-4-iOS / SC-4-Android (no regression):** On native, the row expand/collapse layout animation is unchanged (still `LinearTransition.duration(260).easing(out)`), and swipe-to-delete (`ReanimatedSwipeable` + full-swipe auto-commit + tap-delete) is unchanged. Soft-delete only; `deleted_at` filter intact.
- **SC-5 (gate):** A strict-grep gate FAILS if a module-top-level (unguarded) reanimated layout-builder call is reintroduced in `BusinessNotificationsScreen.tsx`, and FAILS if `ReanimatedSwipeable` becomes renderable on web (guard removed). It PASSES on the fixed file.

---

## 6. Invariants

- **Preserve I-WEB-GESTURE-SAFE (ORCH-1105, ACTIVE)** in spirit: no reanimated-on-web crash from this route. The existing gate's literal scope is `components/ui`; this fix adds a sibling gate for `components/notifications` (below).
- **Preserve the ORCH-1142 soft-delete contract:** soft-delete only, `deleted_at` fetch filter intact, no hard delete. The fix touches only the layout-animation constant + (optionally) the swipe import — never the delete path.
- **Propose new invariant (DRAFT, flips ACTIVE at CLOSE — orchestrator owns the flip):**
  - **I-PROPOSED-1211-NOTIF-WEB-RENDER-SAFE (DRAFT):** `mingla-business/src/components/notifications/BusinessNotificationsScreen.tsx` MUST NOT (a) invoke a `react-native-reanimated` layout-animation builder (`LinearTransition`/`FadeIn`/`SlideIn`/etc. `.duration(`/`.easing(`/`.springify(`) at module top level without an `isWeb`/`Platform.OS` guard, and (b) MUST keep `ReanimatedSwipeable` rendered on native only (the `if (isWeb) return` guard before the `<ReanimatedSwipeable>` JSX). Rationale: both are `undefined`/crash-on-web vectors that take down the whole route via the global ErrorBoundary.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 (happy, web) | Render notif screen on web with rows | react-native-web render of `BusinessNotificationsScreen` (hook mocked, 1 populated row) | No throw; DOM contains the row title; no "Something broke" | Component (web render) |
| T-2 (happy, web, empty) | Render with zero rows | hook mock `notifications: []`, not loading | EmptyState "You're all caught up" renders, no throw | Component (web render) |
| T-3 (gate, fails-on-revert) | Strict-grep: unguarded top-level layout builder | run gate against the FIXED file | PASS; against the reverted (line-145 unguarded) file → FAIL exit 1 | CI gate |
| T-4 (gate, self-test) | `--self-test` proves the gate fires | inject a synthetic unguarded `LinearTransition.duration(` line | gate exits non-zero | CI gate |
| T-5 (native no-regression) | Native expand animation intact | grep/assert native branch still constructs `LinearTransition.duration(durations.entry).easing(` | present + reachable on native | Component (static) |
| T-6 (error path, web) | Render with `query.isError` + no cache | hook mock isError, [] | ErrorState ("Couldn't load…", single "Retry") renders, no throw | Component (web render) |

> The web-render proof (T-1/T-2/T-6) is the happy-path regression test required by the dispatch. The DIFFERENT adversarial angle for the tester (below) must be a LIVE real-Chromium load of the actual `/notifications` route, not just the jest render.

**Adversarial angle for the tester (distinct from the happy-path test):** the jest react-native-web render path is KNOWN to mis-resolve `react-native-worklets` to its native `src/` under jest's node resolver (see investigation §7 note) — a jest-only artifact. So the tester MUST NOT rely solely on a jest web-render; the tester's distinct adversarial proof is a **real-Chromium load of the running `expo start --web` `/notifications` route** (Playwright, as in the investigation) asserting (a) NO uncaught `TypeError`/"duration" pageerror, (b) the inbox text renders, AND a **fails-on-revert** check: revert line 145 to the unguarded form, reload, and confirm the crash returns. Additionally, the tester should confirm on a **real signed-in business web session** (Seth's physical Samsung via adb+CDP, memory `reference_drive_samsung_adb_cdp_web_forensics.md`) that the production ErrorBoundary fallback is gone and the inbox loads — since the dev overlay and the prod ErrorBoundary are different renderings of the same throw.

---

## 8. Implementation order

1. **Component fix** — `BusinessNotificationsScreen.tsx`: guard the module-top-level `LinearTransition.duration(...)` so it never runs on web (Shape A recommended: `const EXPAND_TRANSITION = isWeb ? undefined : LinearTransition.duration(durations.entry).easing(EASE_OUT);`). Add a load-bearing comment citing ORCH-1211 + the `LinearTransition`-undefined-on-web reason. Confirm the `if (isWeb) return` swipeable guard (line 526) is intact.
2. **Regression gate** — add `.github/scripts/strict-grep/orch-1211-notif-web-render-safe.mjs` (model: `orch-1105-web-gesture-safe.mjs` / `orch-1001-no-native-turbomodule-in-web-bundle.mjs`), with `--self-test`. Register it as a job in `.github/workflows/strict-grep-mingla-business.yml` and add a `test:orch-1211` script to `mingla-business/package.json`.
3. **Web-render proof** — add a jest web-render test (model: `jest.orch1193.sheetscroll.web.render.cjs` aliasing `react-native$ → react-native-web`, hook mocked) asserting T-1/T-2/T-6. NOTE the jest-worklets caveat (§7) — if the jest path cannot be made to resolve reanimated-web cleanly, the gate (step 2) + the tester's real-Chromium proof are the authoritative fails-on-revert guard, and the jest render is best-effort.
4. **Self-verify** — run the gate (PASS on fix, FAIL on revert), run the web-render test, and (implementor) re-run the real-Chromium `/notifications` load to confirm SC-1-Web.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** strict-grep gate `orch-1211-notif-web-render-safe.mjs` enforcing I-PROPOSED-1211-NOTIF-WEB-RENDER-SAFE.
- **The exact catch:** the gate reads `BusinessNotificationsScreen.tsx` and FAILS (exit 1) if it finds a module-top-level (not inside a function, not behind an `isWeb`/`Platform.OS` ternary/guard) invocation of a reanimated layout-builder method matching `/\b(LinearTransition|FadeIn[A-Za-z]*|FadeOut[A-Za-z]*|SlideIn[A-Za-z]*|SlideOut[A-Za-z]*|ZoomIn[A-Za-z]*|ZoomOut[A-Za-z]*|CurvedTransition|JumpingTransition|SequencedTransition|FadingTransition|EntryExitTransition)\s*\.\s*(duration|easing|springify|delay|build)\s*\(/` UNLESS the same line contains `isWeb ?` / `Platform.OS` guard; AND FAILS if `<ReanimatedSwipeable` appears without a preceding `if (isWeb) return` guard in the file. `--self-test` injects a synthetic unguarded line and asserts the gate fires.
- **Proven fails-on-revert:** reverting line 145 to the unguarded `const EXPAND_TRANSITION = LinearTransition.duration(durations.entry).easing(EASE_OUT);` makes the gate exit 1 (the line matches the builder pattern with no `isWeb` guard); restoring the guarded form makes it exit 0. The tester additionally proves the runtime fails-on-revert in real Chromium (§7).
- **Protective comment (in the source, required):** at line 145, e.g. `// ORCH-1211: LinearTransition is undefined on web at module-eval — calling .duration() at top level throws "Cannot read properties of undefined (reading 'duration')" and crashes /notifications into the global ErrorBoundary. Guard the builder call to native; web gets no layout animation (graceful). Do NOT remove the isWeb guard.`

---

## 10. Open questions

- **OQ-1:** Web expand/collapse with `EXPAND_TRANSITION = undefined` means the row reflow is instant (no animated height transition) on web. This is the recommended graceful degradation and is consistent with the design's "web variant" state. If Seth wants an animated web reflow, that is a follow-on polish (web-defined `LinearTransition` via reanimated's web layout path, or a CSS transition) — NOT in this crash-fix scope. **Default: ship the no-animation web degrade.**
- **OQ-2:** None blocking. The fix is a one-line guard; no decision needed to proceed.

---

## 11. Downstream routing

- **Next = mingla-implementor (business side).** Build per §8 in this worktree.
- **Then = mingla-tester** — run the adversarial real-Chromium `/notifications` proof + fails-on-revert (§7), confirm native no-regression (SC-4) on device.
- **Then = mingla-orchestrator CLOSE** — flip I-PROPOSED-1211-NOTIF-WEB-RENDER-SAFE to ACTIVE; ship to business web via **Vercel `[deploy]` ONLY** (NO `eas update`; COMMS-0052). The pure-JS fix also rides the next business native build, but the prod web crash clears on the Vercel deploy.

### Scoped allowlist (implementor MAY change ONLY these)
- `mingla-business/src/components/notifications/BusinessNotificationsScreen.tsx`
- `.github/scripts/strict-grep/orch-1211-notif-web-render-safe.mjs` (new)
- `.github/workflows/strict-grep-mingla-business.yml` (add the one job)
- `mingla-business/package.json` (add `test:orch-1211` script)
- New jest web-render test + its config under `mingla-business/` (e.g. `jest.orch1211.web.render.cjs` + `__tests__/orch1211NotifWebRender.web.render.test.tsx` + worktree-local mock/stub files)

### DO-NOT-TOUCH (stop-and-amend before any change here)
- `mingla-business/app/notifications.tsx` (the route — no change needed)
- `mingla-business/src/hooks/useBusinessNotifications.ts` (the hook / delete semantics / `deleted_at` filter)
- `mingla-business/src/components/ui/ErrorBoundary.tsx`, `app/_layout.tsx`
- The native swipe path: `NotificationRow` native branch, `ReanimatedSwipeable` render, `SwipeRightAction`, haptics, chevron animation — behavior must be byte-identical on native
- Any DB / migration / edge function / RLS
- Any `eas update` / app.config / OTA channel
