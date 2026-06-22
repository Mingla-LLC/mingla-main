# IMPLEMENTATION — ORCH-1211 [business notifications inbox crashes on mobile web]

- **Worktree:** `~/Desktop/mingla-orchs/1211-[notif-web-crash]/` on branch `1211-notif-web-crash`
- **Branch commit:** `7daa1e1f97f31065d97e582f7042616a64cfadbe`
- **Rebased onto:** `origin/main` (`a39a66bd2`); picked up `92317610d`.
- **SPEC:** `Mingla_Artifacts/SPEC_ORCH-1211_notif-web-crash.md` (Shape A, recommended).
- **Status:** implemented and verified (gate PASS-on-fix / FAIL-on-revert proven; jest web-render proof reproduces the exact prod TypeError on revert). Native byte-identical.
- **Ship path:** business WEB via Vercel `[deploy]` ONLY. NO `eas update` (COMMS-0052 BLOCK; acked).

---

## 1. Summary

Tapping the bell on Mingla Business web (`/notifications`) crashed the entire page into the global "Something broke." fallback. Root cause (proven by forensics via live Chromium): `BusinessNotificationsScreen.tsx:145` called the `react-native-reanimated` builder `LinearTransition.duration(...)` at **module top level**. `LinearTransition` is `undefined` on web at module-eval, so reading `.duration` threw `TypeError: Cannot read properties of undefined (reading 'duration')` the instant the route imported the screen — before any render guard — bubbling to the global `ErrorBoundary`.

Fix (Shape A, one line + load-bearing comment): `const EXPAND_TRANSITION = isWeb ? undefined : LinearTransition.duration(durations.entry).easing(EASE_OUT);`. On web the guard short-circuits → the undefined builder is never touched → the inbox renders. On native the `!isWeb` branch is byte-identical to before. Backed by a CI-wired strict-grep gate that fails if the unguarded top-level builder is reintroduced or if `ReanimatedSwipeable` is allowed to render on web, plus a jest web-render proof.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Verified how | Result | Commit |
|----|-----------|--------------|--------|--------|
| SC-1-Web | `/notifications` renders the inbox on web, no "Something broke." | jest web-render (rnw + reanimated pinned to proven web condition) renders populated/empty/error states; DOM never contains "Something broke" | ✓ PASS | `7daa1e1f9` |
| SC-2-Web | Expand/collapse tap still works on web, no throw | `EXPAND_TRANSITION = undefined` on web; `layout={reducedMotion ? undefined : EXPAND_TRANSITION}` resolves to `undefined` (no animated reflow, row still toggles); render proof confirms no throw | ✓ PASS (static + render) | `7daa1e1f9` |
| SC-3-Web | Web delete (`WebTrashButton` → `softDelete`) unchanged | `softDelete` path + `WebTrashButton` untouched (not in the diff); only the layout-animation constant changed | ✓ PASS (no-touch) | `7daa1e1f9` |
| SC-4-iOS / SC-4-Android | Native expand animation + swipe-to-delete unchanged | source diff is the single guard line + comment; `!isWeb` branch is byte-identical `LinearTransition.duration(durations.entry).easing(EASE_OUT)`; gate T-5 asserts the native builder is still present | ✓ PASS (no-regression) | `7daa1e1f9` |
| SC-5 | Strict-grep gate FAILS on unguarded top-level builder + on web-renderable swipeable; PASSES on fix | gate self-test 7/7 PASS; live PASS on fix; FAIL (exit 1, line 145) on reverted file | ✓ PASS | `7daa1e1f9` |

---

## 3. Files changed (8)

| File | Change | Δ |
|------|--------|---|
| `mingla-business/src/components/notifications/BusinessNotificationsScreen.tsx` | `EXPAND_TRANSITION` guarded `isWeb ? undefined : …` + ORCH-1211 comment | +9 / −1 |
| `.github/scripts/strict-grep/orch-1211-notif-web-render-safe.mjs` | NEW gate + `--self-test` (7 cases) | +~290 (new) |
| `.github/workflows/strict-grep-mingla-business.yml` | NEW `orch-1211-notif-web-render-safe` job (self-test + live) | +14 |
| `mingla-business/package.json` | NEW `test:orch-1211` script (gate self-test + live + jest render) | +1 |
| `mingla-business/jest.orch1211.notifweb.render.cjs` | NEW web-render jest config (rnw alias + reanimated/swipeable stubs) | +~60 (new) |
| `mingla-business/jest.orch1211.reanimated-web-stub.cjs` | NEW reanimated web-condition stub (`LinearTransition === undefined`) | +~75 (new) |
| `mingla-business/jest.orch1211.swipeable-stub.cjs` | NEW ReanimatedSwipeable passthrough stub | +~20 (new) |
| `mingla-business/src/components/notifications/__tests__/notifWebRender.orch1211.web.render.test.tsx` | NEW web-render proof (T-1/T-2/T-6) | +~120 (new) |

---

## 4. Data-model changes applied

None. No migration, no table/column/RLS change. (DO-NOT-TOUCH honored.)

## 5. Edge functions touched

None. No edge-function change, no deploy. (DO-NOT-TOUCH honored.)

---

## 6. Regression tests added

- **Strict-grep gate (authoritative fails-on-revert):** `.github/scripts/strict-grep/orch-1211-notif-web-render-safe.mjs`
  - `--self-test`: **PASS (7/7 cases)** — fires on unguarded top-level builder, passes on `isWeb ?`-guarded, ignores builder calls inside function bodies, ignores comment mentions, fires on a swipeable without an `if (isWeb) return` guard, passes with the guard, fires on other builders (`FadeOutDown.springify()`).
  - Live on **fixed** file: **PASS (exit 0)**.
  - Live on **reverted** file (line 145 → unguarded, by TRUE LINE DELETION of the guard): **FAIL (exit 1)** — `BusinessNotificationsScreen.tsx:145: module-top-level reanimated layout-builder call … Guard it with isWeb ? undefined : …`.
- **Jest web-render proof (happy-path, the dispatch's required test):** `mingla-business/src/components/notifications/__tests__/notifWebRender.orch1211.web.render.test.tsx` — T-1 (populated row title), T-2 (empty "You're all caught up"), T-6 (error "Couldn't load…" + "Retry"). **3/3 PASS on fix.**
  - **fails-on-revert verified at commit `7daa1e1f97f31065d97e582f7042616a64cfadbe`** (true line-deletion of the guard): reverting line 145 to `const EXPAND_TRANSITION = LinearTransition.duration(durations.entry).easing(EASE_OUT);` makes the render test throw the EXACT production error — `TypeError: Cannot read properties of undefined (reading 'duration')` at `BusinessNotificationsScreen.tsx:145:44` — and all 3 tests FAIL. Restoring the guard → 3/3 PASS again.
  - The render config pins reanimated to the proven web module-eval condition (`LinearTransition === undefined`) and aliases `react-native → react-native-web` (so `Platform.OS === "web"`), making this a faithful reproduction rather than the jest-mis-resolved path the spec §7 warns about.

Both the gate and the render test ship in the SAME branch/commit as the fix (visible in `git diff origin/main...HEAD --name-only`). Append-only: all NEW files; no existing test modified or deleted.

---

## 7. Old → New receipt

### `BusinessNotificationsScreen.tsx`
- **Before:** `const EXPAND_TRANSITION = LinearTransition.duration(durations.entry).easing(EASE_OUT);` ran unconditionally at module top level. On web, `LinearTransition` is `undefined` → `.duration` throws at import → `/notifications` crashed into the global ErrorBoundary.
- **Now:** `const EXPAND_TRANSITION = isWeb ? undefined : LinearTransition.duration(durations.entry).easing(EASE_OUT);` with a load-bearing ORCH-1211 comment. Web: `undefined` (no top-level builder call; row reflow is instant — graceful degrade). Native: byte-identical builder via the `!isWeb` branch. The two `layout={reducedMotion ? undefined : EXPAND_TRANSITION}` consumers (lines ~529/~539) and the `if (isWeb) return <Reanimated.View>` swipeable guard (line ~526) are unchanged.
- **Why:** SC-1-Web (stop the crash), SC-4 (preserve native), ORCH-1211 root cause.
- **Lines changed:** +9 / −1.

---

## 8. Cross-surface impact

| Surface | Affected? | What changes | Parity |
|---------|-----------|--------------|--------|
| Consumer iOS (`app-mobile`) | No | does not import this screen | n/a |
| Consumer Android (`app-mobile`) | No | same | n/a |
| Buyer/anon Web | No | `/notifications` is operator-only | n/a |
| Business iOS | Yes (regression-guard only) | inbox + swipe + expand animation UNCHANGED (native branch byte-identical) | automatic (shared, platform-guarded) |
| Business Android | Yes (regression-guard only) | same | automatic |
| Admin Web (`mingla-admin`) | No | separate app | n/a |
| Business Web (deployed) | **Yes (the fix)** | bell → inbox renders (skeleton/populated/empty/error), no "Something broke."; web delete via `WebTrashButton`; expand/collapse works without the reflow animation | manual (platform-split via `isWeb`) |

---

## 9. Smoke result

- Gate `--self-test`: PASS (7/7). Gate live on fix: PASS. Gate live on reverted file: FAIL (exit 1, line 145) → restored: PASS.
- `npm run test:orch-1211` (gate self-test + live + jest render): all green; 3/3 render tests PASS.
- Jest render fails-on-revert: reverted line 145 → exact prod `TypeError: Cannot read properties of undefined (reading 'duration')` at line 145 → all 3 fail; restored → 3/3 PASS.
- `tsc --noEmit`: no NEW error referencing `BusinessNotificationsScreen`/`EXPAND_TRANSITION`. The render test carries the same benign pre-existing `react-dom/server` TS7016 declaration warning that the committed `orch1190r2` web-render test already has (render tests run via babel-jest, not tsc).
- YAML: workflow validated with js-yaml (OK).
- No real-device/sim run by the implementor (web-only fix); the live real-Chromium `/notifications` load + native no-regression device check is the tester's adversarial dispatch (spec §7).

---

## 10. Known issues / deferred

- **OQ-1 (spec):** web expand/collapse reflow is now instant (no animated height transition) — the recommended graceful degrade. An animated web reflow is a follow-on polish, NOT this crash-fix scope.
- The optional bundle-hygiene extras (lazy/native-only `LinearTransition` import; native-only `ReanimatedSwipeable` require) were NOT done — they are explicitly optional in the spec and not required to fix the crash; the import is harmless on web (the CALL threw, not the import — proven by the clean `expo export`). No `[TRANSITIONAL]` markers introduced.
- The jest config `.cjs` files are tracked (matching repo precedent — `jest.orch1193.*` etc. are committed); they are committed here too so the closing diff is self-contained.

---

## 11. Operator action required

- **No migration** (none written). **No edge-fn deploy** (none touched).
- **COMMS-0052 ack (docs):** I appended the ORCH-1211 implementor ack to `COMMS_LEDGER.md` on the anchor, but the one-file commit to `main` was blocked by the harness main-commit guard. The edit is left UNSTAGED in the anchor working tree (`~/Desktop/mingla-main/COMMS_LEDGER.md`) for Seth/orchestrator to commit:
  ```bash
  cd /Users/sethogieva/Desktop/mingla-main
  git add COMMS_LEDGER.md
  MINGLA_ALLOW_MAIN_COMMIT=1 git commit -m "COMMS-0052 ack: mingla-implementor (ORCH-1211 notif-web-crash) — web-only fix, NO business OTA"
  git push origin main
  ```
- **Ship at CLOSE:** business WEB via Vercel `[deploy]` ONLY. **NO `eas update`** (COMMS-0052 BLOCK in force). The pure-JS fix also rides the next business native build, but the prod web crash clears on the Vercel deploy alone.

---

## 12. Discoveries for Orchestrator

- None outside scope. The fix is a one-line guard; the swipeable native-only guard and the soft-delete (`deleted_at`) contract were verified intact (read, not changed).
- The new invariant **I-PROPOSED-1211-NOTIF-WEB-RENDER-SAFE** (DRAFT in the spec) is now enforced by the committed gate; the orchestrator flips it ACTIVE at CLOSE.
