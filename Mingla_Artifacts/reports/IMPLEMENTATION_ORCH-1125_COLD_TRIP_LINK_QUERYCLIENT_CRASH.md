# IMPLEMENTATION — ORCH-1125: cold deep-link to a native public route crashes "No QueryClient set"

**Phase:** IMPLEMENT (mingla-implementor). **Status:** implemented and self-verified (structural + unit gates green; cold-deep-link runtime verification deferred to a release build per SPEC §9/§10 — tester/orchestrator scope).
**Date:** 2026-06-12
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1125-[cold-deeplink-queryclient]/` on branch `ORCH-1125-cold-deeplink-queryclient` (rebased on origin/main, head `f16527285`).
**Commit:** `4793b0543`.
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1125_COLD_TRIP_LINK_QUERYCLIENT_CRASH.md` (binding).

---

## 1. Summary (plain English)

In the consumer native app, the React Query provider lived inside the Home (`/`) route, so it was a *sibling* of public deep-link routes (`/t/`, `/b/`, `/brand/`) rather than their ancestor. A buyer opening a shared trip/brand link from a cold start (fresh process) routed straight to one of those sibling routes before Home ever mounted — the route's first data fetch ran with no QueryClient and crashed with "No QueryClient set, use QueryClientProvider to set one."

The fix hoists the provider (and its Android cache-size safety gate, its persistence config, and the animated splash) out of the Home route and up to the expo-router root layout, wrapping `<Stack/>` (and therefore *every* route). Cold deep-link or warm in-app navigation, every route is now wrapped by exactly one QueryClient. It is a pure-JS/RN relocation — OTA-able, no native rebuild.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Verified how | Status | Commit |
|----|-----------|--------------|--------|--------|
| SC-1 | Cold deep-link to `/t/{brand}/{trip}` renders, no "No QueryClient" crash | Provider now wraps `<Stack/>` at root (structural gate + render test prove the mechanism); true cold-route runtime needs a release build (§9) | ✓ code / runtime UNVERIFIED (release-build, tester) | `4793b0543` |
| SC-2 | Same for `/b/{slug}` and `/brand/{slug}` | Same hoist covers all routes under `<Stack/>` | ✓ code / runtime UNVERIFIED (release-build) | `4793b0543` |
| SC-3 | Warm in-app nav (deck → trip, Home) unchanged | `AppContent` unchanged, still consumes ambient providers; no route logic touched | ✓ code / runtime UNVERIFIED (device, tester) | `4793b0543` |
| SC-4 | Exactly ONE QueryClient; persistence intact | Singleton imported from `src/config/queryClient.ts`; `.mjs` T-6/T-6b assert no `new QueryClient(` in `app/` + import present | ✓ | `4793b0543` |
| SC-5 | Android `cacheReady` pre-clear runs BEFORE provider mounts | Effect + `cacheReady &&` gate moved verbatim to root; `.mjs` T-7a/b/c | ✓ | `4793b0543` |
| SC-6 | Splash paints immediately on cold launch (Home or deep-link) | `AnimatedSplashScreen` moved to root as `!splashDone` sibling (renders independent of `cacheReady`); `.mjs` T-8a/b | ✓ code / runtime UNVERIFIED (device) | `4793b0543` |
| SC-7 | No double mount (exactly one provider, in `_layout.tsx`, none in `index.tsx`) | bash gate conditions A/B/C; `.mjs` T-4a/b | ✓ | `4793b0543` |
| SC-8 | Structural: provider present in `_layout.tsx`, absent in `index.tsx` | `check-rq-provider-at-root-layout.sh` PASS; fails-on-revert proven | ✓ | `4793b0543` |

Surfaces 1 (iOS) and 2 (Android) share the same `app-mobile` JS → **parity automatic**. The only platform-specific concern (Android 2 MB CursorWindow) is preserved by keeping the `cacheReady` gate at root.

---

## 3. Files changed (6 files, +401 / −60)

| File | Change | Δ |
|------|--------|---|
| `app-mobile/app/_layout.tsx` | Added provider/gate/splash + 6 imports; rewrote `RootLayout` return | +76 / −2 |
| `app-mobile/app/index.tsx` | Removed `App()` shell (provider/gate/splash); collapsed export to `Sentry.wrap(AppContent)`; pruned 4 dead imports | +13 / −60 |
| `app-mobile/package.json` | Added `"test:orch-1125"` script (one line) | +1 / −1 |
| `app-mobile/scripts/ci/check-rq-provider-at-root-layout.sh` | NEW strict-grep gate | +79 |
| `app-mobile/scripts/ci/orch-1125-regression-check.mjs` | NEW static regression (11 checks) | +146 |
| `app-mobile/app/__tests__/coldRouteQueryProvider.orch1125.test.ts` | NEW cold-route render test (node-test + react-dom/server) | +84 |

All six are inside the SPEC §12 allowlist. **No file outside the allowlist was touched** (`git status` confirms only these + the untracked forensics SPEC). No `mingla-business`, no `src/config/queryClient.ts`, no data hook, no native config, no lockfile churn.

---

## 4. Data-model changes applied

None. No DB / migration / RLS / edge / service / hook / realtime change. Component/root-layout layer only.

---

## 5. Edge functions touched

None.

---

## 6. Regression tests added — fails-on-revert proof

**Test 1 — static structural gate (`.mjs`):** `app-mobile/scripts/ci/orch-1125-regression-check.mjs` (11 checks: T-4a/b/c provider-at-root-not-index, T-6/T-6b single-client, T-7a/b/c cacheReady gate, T-8a/b splash, P-1 persistOptions verbatim). All PASS.

**Test 2 — strict-grep bash gate:** `app-mobile/scripts/ci/check-rq-provider-at-root-layout.sh` (conditions A/B/C). PASS, exit 0.

**Test 3 — cold-route render test:** `app-mobile/app/__tests__/coldRouteQueryProvider.orch1125.test.ts` — renders a `useQuery`-calling route-screen probe via `react-dom/server`; asserts it throws the EXACT `/No QueryClient set/` error WITHOUT a provider ancestor (the crash) and renders cleanly WITH one (the fix). Both tests PASS under `node --experimental-strip-types --test`.

> **Harness substitution (documented per Prime Directive 6):** `app-mobile` has **no jest and no `@testing-library/react-native` / `react-test-renderer`** installed — its tests run under Node's built-in test runner with type-stripping (the launch-city / mjs pattern). A jest+RTL render of the real `/t/[brandSlug]/[tripSlug]` screen is therefore not runnable in this worktree (and adding those heavy devDeps is outside the §12 allowlist). The SPEC §9(c) *intent* — prove the "No QueryClient" crash is governed by provider PRESENCE, not the fetch — is met with a runnable `react-dom/server` render of the same `useQuery`-outside-vs-inside-provider mechanism. This is stronger than a non-runnable `.tsx` stub: it actually executes and throws the real error string. Filed in §12 as the deferred-detail for the tester.

**Fails-on-revert (true line deletion, NOT comment-out):** I deleted the `<PersistQueryClientProvider>` wrapper from `_layout.tsx` (leaving bare `<Stack/>`) AND re-added a `PersistQueryClientProvider` mount into `index.tsx` (the exact regression). Result:
- `check-rq-provider-at-root-layout.sh` → **exit 1** (conditions B + C violated).
- `orch-1125-regression-check.mjs` → **exit 1** (5/11 failed: T-4a, T-4b, T-4c, T-7a, P-1).

Restored the fix → both gates exit 0 and the render test passes again.

**`fails-on-revert verified at commit `4793b0543`.** Test paths: `app-mobile/scripts/ci/orch-1125-regression-check.mjs`, `app-mobile/scripts/ci/check-rq-provider-at-root-layout.sh`, `app-mobile/app/__tests__/coldRouteQueryProvider.orch1125.test.ts`. Run via `cd app-mobile && npm run test:orch-1125` (+ `bash scripts/ci/check-rq-provider-at-root-layout.sh`).

Passing run (restored state):
```
PASS T-4a … PASS P-1   ORCH-1125 static regression passed (11 checks).
ok 1 - cold deep-link route WITHOUT a QueryClient ancestor throws "No QueryClient set" (the ORCH-1125 crash)
ok 2 - the SAME route wrapped by the QueryClient provider (root-layout condition) renders without throwing
# tests 2 # pass 2 # fail 0
I-PROPOSED-RQ-PROVIDER-AT-ROOT-LAYOUT: PASS (provider at root, absent from routes).
```

---

## 7. Old → New receipts

### `app-mobile/app/_layout.tsx`
**Before:** `RootLayout` returned `<GestureHandlerRootView><StripeNativeProvider><Stack/></StripeNativeProvider></GestureHandlerRootView>` — no QueryClient anywhere in the root tree.
**Now:** added imports (`AsyncStorage`, `PersistQueryClientProvider`, `queryClient`+`asyncStoragePersister`, `shouldDehydrateMinglaQuery`, `useAppStore`, `AnimatedSplashScreen`); added `cacheReady`/`splashDone` state + the 1.5 MB cache pre-clear `useEffect`; return now mounts `{cacheReady && (<PersistQueryClientProvider …><Stack/></PersistQueryClientProvider>)}` INSIDE `StripeNativeProvider`, with `{!splashDone && <AnimatedSplashScreen/>}` as a sibling.
**Why:** SC-1/2/7/8 — the provider must wrap every route so cold deep-links inherit a client; SC-5 (cacheReady gate moved with it); SC-6 (splash moved to root so deep-links also splash).
**Lines:** +76 / −2.

### `app-mobile/app/index.tsx`
**Before:** `function App()` owned `cacheReady`/`splashDone` state, the cache pre-clear effect, the `PersistQueryClientProvider` wrapping `<AppContent/>`, and the `AnimatedSplashScreen`; `export default Sentry.wrap(App)`.
**Now:** `App()` deleted; `export default Sentry.wrap(AppContent)`. Pruned dead imports `PersistQueryClientProvider`, `AnimatedSplashScreen`, `asyncStoragePersister` (line trimmed to `import { queryClient } …`), `shouldDehydrateMinglaQuery`. Kept `queryClient` (used by `prefetchQuery` + `dismissCollaborationInviteNotifications`), `AsyncStorage` (9 other uses), `useAppStore` (2 other uses) — grep-verified.
**Why:** SC-3 (Home content unchanged, just stops owning the provider); SC-7 (no double mount).
**Lines:** +13 / −60.

### `app-mobile/package.json`
**Before/Now:** added `"test:orch-1125"` running the `.mjs` static gate then the node-test render test. One line; no dependency change.
**Why:** wire the gates into the standard `test:*` CI surface (SC-8 / §6).

---

## 8. Cross-surface impact

| # | Surface | Affected | What changes / why not | Parity |
|---|---------|----------|------------------------|--------|
| 1 | Consumer iOS | YES | Cold deep-link renders instead of crashing; warm nav + splash unchanged | shared → auto |
| 2 | Consumer Android | YES | Same; 2 MB CursorWindow pre-clear preserved | shared → auto |
| 3 | Buyer/anon Web (`mingla-business`) | NO | Already root-correct + runtime-proven clean (SPEC §2); untouched | n/a |
| 4 | Business iOS | NO | Different app | n/a |
| 5 | Business Android | NO | Different app | n/a |
| 6 | Admin Web | NO | Unrelated | n/a |
| 7 | Business Web preview | NO | Unrelated | n/a |

Parity 1↔2 automatic (same JS). No manual parity surfaces.

---

## 9. Smoke / verification result

- `tsc --noEmit` (whole app): 345 errors both with and without the change (stash-compared) — **zero** errors reference `app/_layout.tsx` or `app/index.tsx`; the 345 are the repo's pre-existing baseline. The two edited files are tsc-clean. **No new type error introduced.**
- `check-rq-provider-at-root-layout.sh` → PASS (exit 0).
- `check-single-sentry-init.sh` → PASS (I-SENTRY-SINGLE-INIT preserved).
- `npm run test:orch-1125` → 11 static + 2 render checks PASS.
- Fails-on-revert → both structural gates exit 1 on the reverted state; restored → exit 0.
- **NOT run (out of implementor scope, per SPEC §9/§10):** true cold-deep-link runtime repro — requires a release/standalone build because the Expo dev-client hijacks `com.mingla.app.v2://` and always boots `/` first. This is the tester's/orchestrator's release-build step.

---

## 10. Known issues / deferred

- **Runtime SC-1/SC-2/SC-3/SC-6 are UNVERIFIED at code-ship time** — they need a release/standalone `app-mobile` build (SPEC §9 binding caveat). A dev-client "didn't crash" is NOT acceptance for the cold-route criteria.
- No `[TRANSITIONAL]` code introduced. No tech debt.

---

## 11. Operator action required

- **No migration. No edge-function deploy.** (Component-only change.)
- **OTA at CLOSE** (orchestrator): `eas update --platform ios` then `eas update --platform android` (per `feedback_eas_ota_publish_per_platform.md` — never `--platform all`).
- **Schedule a release-build cold-deep-link verification** (or fold into the next standalone build): cold-launch `com.mingla.app.v2://t/{brand}/{trip}`, `://b/{slug}`, `://brand/{slug}` on a release build; expect each to render, none to crash.
- **CLOSE:** flip `I-PROPOSED-RQ-PROVIDER-AT-ROOT-LAYOUT` DRAFT → ACTIVE (registry) and wire `check-rq-provider-at-root-layout.sh` into the CI workflow alongside the other `check-*.sh` gates.

---

## 12. Discoveries for Orchestrator

- **`app-mobile` has no jest / RTL / react-test-renderer.** The several existing `*.test.tsx` files use jest globals (`describe/it/expect`) but no jest binary is installed in the worktree — they are not runnable here and rely on a CI-provisioned jest (or are stale). The *runnable* harness is Node's `--experimental-strip-types --test` (the `.mjs`/`.test.ts` pattern). I used the runnable harness for ORCH-1125's render test and documented the substitution (§6). Not a blocker for this ORCH; flagging so the tester picks the right harness and so the orchestrator knows the `.tsx` jest tests' run-status is ambiguous in worktrees.
- **No comms-ledger action was required** for ORCH-1125 (zero OPEN BLOCK rows; the recent ALL/ORCH-1116 entries are unrelated ID-collision/WARN notices). No new COMMS entry written (no cross-ORCH discovery).
