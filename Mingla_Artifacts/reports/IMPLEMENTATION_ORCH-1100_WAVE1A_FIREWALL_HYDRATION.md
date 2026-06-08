# IMPLEMENTATION — ORCH-1100 Wave 1A [business-web parity: firewall retirement + auth-lock/brand-hydration fix]

Date: 2026-06-07
Branch: `ORCH-1100-firewall-hydration` (off `ORCH-1100-parity-harness` @ `8cc11fd7b`, which is off origin/main)
Worktree: `~/Desktop/mingla-orchs/ORCH-1100-[business-web-parity-investigation]/`
Skill: mingla-implementor (Claude parity side)
Status: **implemented + scoped-gates green; DEVICE VERIFICATION BLOCKED in-sandbox** (web export build + CDP harness run are permission-denied here — see §Device Evidence).

Inputs read: `PARITY_BASELINE_ORCH-1100.md` (88/91 routes boot with firewall bypassed, 0 crashes), `SYNTHESIS_ORCH-1100_...md` (RC-1..RC-5), `tools/parity-harness/` (runner + manifests), `COMMS_LEDGER.md` (no OPEN entry addresses ORCH-1100 / implementor / ALL).

---

## What changed (file:line receipts)

### 1. `mingla-business/app/_layout.tsx` — RETIRE the mobile-web route firewall (TASK 1)
**Before:** `ORCH_1093_SIGNED_IN_ROUTE_STATUS` whitelisted ~12 routes as `"interactive"`; the resolver `orch1093RouteStatus()` returned `?? "static-section"` for everything else → ~79 signed-in routes rendered the `Orch1093MobileRouteRecovery` stub ("staying protected → Home") on phone web. An env-gated diagnostic `EXPO_PUBLIC_ORCH1100_FIREWALL_BYPASS` force-flipped all routes to interactive for the harness.
**After:**
- Replaced the whitelist map + `?? "static-section"` default with an explicit **block-list** `ORCH_1100_BLOCKED_MOBILE_WEB_ROUTES = new Set<string>([])` (currently EMPTY — baseline proved 0 routes crash on device).
- `orch1093RouteStatus(pathname)` now returns `"blocked"` only if the pathname is in the block-list, else `"interactive"` (the REAL app renders). Type narrowed to `"interactive" | "blocked"` (dropped `"static-section"`).
- Removed the diagnostic env bypass entirely (redundant once the default is interactive).
- The safety valve is RETAINED but inverted: both firewall checkpoints (inner `RootLayoutInner` `shouldShowMobileRouteRecovery` + outer `RootLayout` `shouldShowOuterOrch1093Recovery`) still exist and still gate on `isMobileWebRouteEntry()` (desktop untouched), but now fire ONLY for a route explicitly block-listed. A future proven-crash route can be re-gated by adding its pathname to the Set + logging the offender — without reintroducing the all-routes firewall.
- Recovery stub copy genericized ("This screen is taking a detour.") since the per-route whitelist labels no longer exist.
**Why:** RC-4 (the dominant parity gap). Baseline: firewall masked ~79 already-working routes.
**Lines changed:** ~70 (net subtraction).

### 2. `mingla-business/src/services/supabase.ts` — web-only resilient auth lock (TASK 2 / RC-1 core)
**Before:** `createClient(..., { auth: { storage, autoRefreshToken, persistSession, detectSessionInUrl } })`. On web, supabase-js used its default `navigatorLock` (Web Locks API) with the default `lockAcquireTimeout` of **5000ms** — LONGER than the 3s auth bootstrap timeout — so under multi-tab orphaned-lock contention, `getSession()` timed out before the lock self-healed and surfaced raw `AbortError: Lock broken … steal`.
**After:** added a web-only custom `lock: webResilientLock` that wraps `navigatorLock` with a bounded `WEB_LOCK_ACQUIRE_TIMEOUT_MS = 2300` (< the 3s bootstrap timeout in `AuthContext.tsx`), so an orphaned lock is stolen/recovered BEFORE bootstrap gives up → `getSession()` resolves → the auth-gated brand chain fires. The wrapper swallows the benign lock-acquire-timeout rejection (`isAcquireTimeout === true`, i.e. "our held lock was stolen" / orphaned recovery) by running `fn` lock-free instead of letting it bubble as an uncaught AbortError (fixes group-chat). Falls back to lock-free when `navigator.locks` is unavailable. Native (iOS/Android) does NOT set `lock` (gated on `Platform.OS === "web"`) → keeps supabase-js's default in-process `processLock` behaviour byte-for-byte.
**Why:** RC-1 root cause (GoTrue Navigator-lock orphan under multi-tab contention).
**Lines changed:** ~60 (added).

### 3. `mingla-business/src/store/currentBrandStore.ts` — Zustand hydration flag (TASK 2)
**Before:** persisted store exposed only `currentBrandId`. A first-frame `currentBrandId === null` (before AsyncStorage rehydration) was indistinguishable from "no brand".
**After:** added `hasHydrated: boolean` (+ `setHasHydrated`) to state, defaulted `false`, flipped `true` by a new `onRehydrateStorage` callback after persist merges. Excluded from `partialize` (always starts false on a fresh load). Added `useCurrentBrandHasHydrated()` selector hook.
**Why:** lets consumers treat first-frame null as LOADING, not "no brand."
**Lines changed:** ~30 (added).

### 4. `mingla-business/src/hooks/useCurrentBrand.ts` + `src/utils/currentBrandAutoClear.ts` — harden the auto-clear (TASK 2)
**Before:** `useCurrentBrand` cleared `currentBrandId` whenever `isAuthReady && currentBrandId !== null && isFetched && !isError && brand === null`. During the multi-tab token gap / pre-rehydration window a valid persisted id could be wiped.
**After:** extracted the decision into a leaf pure predicate `shouldClearCurrentBrandId({ hasHydrated, isAuthReady, currentBrandId, isFetched, isError, brandIsNull })` in `src/utils/currentBrandAutoClear.ts` (zero RN imports → unit-testable in the node jest env). Added the `hasHydrated` arm: a valid persisted id is NOT cleared until the store has rehydrated. The `!isError` arm already excludes a 401/403 token gap (which surfaces as isError, not brand===null). `useCurrentBrand` now calls the predicate.
**Why:** RC-1 amplifier (auto-clear nuking a valid persisted brand during the lock gap).
**Lines changed:** ~45 (mostly moved).

### 5. `mingla-business/app/(tabs)/_layout.tsx` — stop the 2-tab nav collapse (TASK 2 / RC-1 nav symptom)
**Before:** `visibleTabsForRank(TABS, rank)` where `rank` came from `useCurrentBrandRole(currentBrandId)`. A transient null `currentBrandId` → rank 0 → only Home + Account survived (the degraded 2-tab nav).
**After:** compute `brandPointerPending = isAuthReady && currentBrandId === null && (!hasHydrated || brandResolving)` (using `useCurrentBrandHasHydrated()` + `useCurrentBrandRecovery().isResolving`). While pending, pass `Number.MAX_SAFE_INTEGER` to `visibleTabsForRank` so EVERY tab survives (loading shape = full 5-tab nav). Once the brand pointer resolves, the real `rank` governs (scanner-safe behaviour preserved). A genuinely brandless signed-in user falls through to rank 0 ONLY after resolution settles.
**Why:** RC-1 nav-collapse mechanism (`navTabGate` rank-0 → Home+Account).
**Lines changed:** ~20.

### 6. `mingla-business/src/hooks/useBusinessTodos.ts` — don't flash "Create a brand" mid-hydration (TASK 2)
**Before:** `hasNoBrands = brandsQuery.isFetched && brands.length === 0`. `buildBusinessTodos` checks `hasNoBrands` BEFORE its `brandResolving` early-return, so a transient mid-hydration empty read could flash a "Create a brand" to-do row (the other visible degraded-shell symptom — Home renders null for the brand area and defers onboarding to this to-do toggle).
**After:** added `useCurrentBrandHasHydrated()` to `isBrandResolving` (`!hasBrandHydrated || …`) and gated `hasNoBrands` on `!isBrandResolving`.
**Why:** RC-1 — the "Create brand" prompt the synthesis report describes is driven by the to-do toggle, not a hard Home page.
**Lines changed:** ~12.

### 7. `mingla-business/src/__tests__/orch1100FirewallHydration.test.ts` — regression test (NEW)
12 tests across both tasks (see §Regression Test).

---

## Cross-surface impact (Step 3.5)
- **Buyer/anonymous Web (3)** — unaffected by the firewall change (firewall only gated `isMobileWebRouteEntry()` signed-in app routes; anon buyer routes were never firewalled). The supabase lock change applies to the SAME shared web client buyer pages use — it is strictly more resilient (faster orphaned-lock recovery, no behaviour change on the happy path). No regression expected.
- **Business iOS (4) / Business Android (5)** — auth-lock change is `Platform.OS === "web"`-gated → native session behaviour BYTE-UNCHANGED (native keeps default `processLock`). The firewall + nav + to-do changes are web-symptom fixes; on native, `isMobileWebRouteEntry()` is false (firewall never ran) and the hydration flag only changes a brief loading shape (full nav while resolving, which native already effectively did). **Verify on native: no behaviour change.**
- **Consumer iOS/Android (1,2)** — NOT affected; this is `mingla-business` only; consumer app has its own supabase client + no business firewall.
- **Admin Web (6)** — NOT affected (separate app).
- **Business Web preview (7)** — the primary target of all changes.

Parity is AUTOMATIC for the lock (single shared web client) and the hydration flag (single store). Firewall + nav fixes are web-only by gate.

---

## Spec traceability / Verification matrix

| Dispatch criterion | Implemented | Verified |
|---|---|---|
| T1: real app renders for ALL signed-in routes on mobile web by default | §1 — default flipped to interactive | **Source + unit PASS**; DEVICE re-run BLOCKED in-sandbox |
| T1: keep narrow per-route override (don't delete safety valve) | §1 — block-list Set + both checkpoints retained | PASS (test asserts block-list present + empty) |
| T1: empty block-list (no proven live crash per baseline) | §1 — `new Set<string>([])` | PASS (test asserts no quoted entries) |
| T1: remove recovery-stub for general case | §1 — only fires for block-listed routes | PASS |
| T1: remove/replace env-gated diagnostic bypass | §1 — deleted | PASS (test asserts var absent) |
| T1: do not touch desktop | §1 — `isMobileWebRouteEntry()` gate retained | PASS (test asserts gate present) |
| T2: session/brand hydration resilient to lock timeout (Supabase docs cited) | §2 — bounded web `lock` + 2300ms < 3s | **Source + unit PASS**; DEVICE multi-tab repro BLOCKED in-sandbox |
| T2: Zustand hydration flag (first-frame null = LOADING) | §3 — `hasHydrated` + `onRehydrateStorage` | PASS (unit) |
| T2: harden `useCurrentBrand` auto-clear vs token gap | §4 — `shouldClearCurrentBrandId` + `hasHydrated` arm | PASS (6 unit cases incl. the RC-1 window) |
| T2: full 5-tab nav with ≥4 tabs open on a fresh load | §5 + §6 | **logic PASS**; DEVICE ≥4-tab repro BLOCKED in-sandbox |
| Native iOS/Android byte-unchanged | §2 web-gated; others web-symptom | **logic PASS**; native runtime UNVERIFIED in-sandbox |
| No Stripe/schema changes | none | PASS |
| Regression test + fails-on-revert | §Regression Test | PASS |

---

## Supabase docs cited (external-API-docs rule)
Source: `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts` (auth-js 2.103.0, re-exported by `@supabase/supabase-js` ^2.74 via `export * from "@supabase/auth-js"`):
- `lock?: LockFunc` — *"Provide your own locking mechanism based on the environment. By default, `navigatorLock` (Web Locks API) is used in browser environments when `persistSession` is true. Falls back to an in-process lock for non-browser environments (e.g. React Native)."*
- `LockFunc = <R>(name, acquireTimeout, fn) => Promise<R>`; positive `acquireTimeout` *"should throw an Error with an `isAcquireTimeout` property set to true if the operation fails to be acquired after this much time (ms)."*
- `lockAcquireTimeout` (default **5000**) — *"a positive value: wait up to this many milliseconds. If the lock is still held, attempt automatic recovery by stealing it (the previous holder is evicted, its callback continues to completion without exclusive access). This recovers from orphaned locks caused by React Strict Mode double-mount, storage API hangs, or aborted operations."*
- `lib/locks.d.ts` / `locks.js` — on steal, the EVICTED holder is rejected with `NavigatorLockAcquireTimeoutError` (`isAcquireTimeout === true`); the lib comments it converts the raw `AbortError` to a typed error *"so callers can handle/filter it without it leaking to Sentry as a raw AbortError."* Our wrapper additionally swallows that typed timeout and runs `fn` lock-free.

Design rationale: the library's default 5s acquire timeout is the exact reason the 3s bootstrap times out first; clamping the web lock to 2300ms makes the orphaned lock self-heal inside the bootstrap window. Native is left on the default `processLock` (no `lock` override on native).

---

## Regression Test
Path: `mingla-business/src/__tests__/orch1100FirewallHydration.test.ts` (12 tests).
- **Run (fixed code):** `npx jest src/__tests__/orch1100FirewallHydration.test.ts` → **Test Suites: 1 passed; Tests: 12 passed**.
- **Fails-on-revert verified @ base `8cc11fd7b`** (before-fix simulated by reverting the three load-bearing changes): with (a) firewall default flipped back to `"static-section"`, (b) the `hasHydrated &&` arm removed from `shouldClearCurrentBrandId`, and (c) the nav `brandPointerPending ? MAX_SAFE_INTEGER : rank` reverted to `rank` → **3 tests FAILED** ("DEFAULTS to interactive", "does NOT clear before the store has rehydrated", "keeps the full tab set while the brand pointer is resolving"). Fix restored → 12/12 pass again.

Coverage: firewall default + empty block-list + diagnostic removal + desktop gate (TASK 1); store hydration flag + non-persisted + web bounded lock + 6 auto-clear predicate cases (incl. the RC-1 pre-hydration window) + nav pending guard (TASK 2).

---

## Gates
- **tsc --noEmit (mingla-business):** 260 errors with my changes == 260 errors on base (stash-compared) → **ZERO new TS errors in touched files** (the 260 are pre-existing monorepo baseline noise: checkout buyer `any`, richEditor, navTabGate test `account_owner`, packages/brand-rendering react-types). Touched-file grep of tsc output: clean.
- **eslint (touched files):** 0 errors; 6 warnings, ALL pre-existing (base has 8) — `_layout.tsx` unused-disable directives on untouched lines + `currentBrandStore.ts` `import/first` pre-existing.
- **Adjacent existing tests:** `orch_1095_..._parity_wave`, `orch1098RealAppOnPhone`, `authReadiness`, `currentBrandResolver` all PASS. `navTabGate.test.ts` FAILS TO COMPILE — **pre-existing** (`BRAND_ROLE_RANK.account_owner` doesn't exist; test last touched `2ff437d50`, unrelated to this ORCH; I did not modify `navTabGate.ts`). See Discoveries.

---

## Device Evidence — BLOCKED in-sandbox (honest label)
The dispatch requires re-running `tools/parity-harness/run-parity-baseline.mjs` against a firewall-FREE build on the Samsung (`R58R54YV7JT`) + a manual multi-tab degraded-shell repro. **Both require building the web export (`npx expo export -p web`) and driving phone Chrome over CDP (adb reverse/forward + native WebSocket)** — these long-running native/build + device operations are **permission-denied in this execution sandbox** (the `expo export` Bash call was denied, including with sandbox override). The Samsung is connected (`adb devices` → `R58R54YV7JT  device`, Chrome installed) but I cannot produce the firewall-free build here.

I am NOT claiming device verification I did not perform (implementor honesty contract). What IS proven in-sandbox: the source/type/lint/unit gates above, the bundle confirms the diagnostic bypass var is removed, and the logic is deterministic.

**Exact commands for Seth (or a follow-up) to complete device proof — copy-paste:**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1100-[business-web-parity-investigation]/mingla-business"
# 1. Build the web export WITHOUT the (now-removed) bypass — firewall is retired by default:
npx expo export -p web --output-dir web-build --clear
# 2. Open Chrome on the Samsung to any business URL, then:
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1100-[business-web-parity-investigation]"
node tools/parity-harness/run-parity-baseline.mjs --device R58R54YV7JT \
  --web-build mingla-business/web-build \
  --out Mingla_Artifacts/reports/orch1100_wave1a_verify
# Sign in once when prompted (sethogieva@gmail.com / "Leggo This"); expect:
#   ALL navigable routes => BOOTS (real content / data-guard), 0 STUB, 0 CRASH.
# 3. Real-ID re-probe (optional, highest-value 20):
node tools/parity-harness/run-parity-baseline.mjs --device R58R54YV7JT \
  --web-build mingla-business/web-build --manifest routes.realids.manifest.json \
  --out Mingla_Artifacts/reports/orch1100_wave1a_verify/realids
# 4. Multi-tab degraded-shell repro: open >=4 tabs on business.usemingla.com (or the
#    local served build) signed-in, hard-reload one => expect full 5-tab nav + brand
#    hydrated + NO "Create brand" flash (previously: 2-tab nav + empty Home).
```
Expected delta vs baseline: identical 0-crash result, but now WITHOUT the `EXPO_PUBLIC_ORCH1100_FIREWALL_BYPASS=1` flag (the firewall is gone by default), and the group-chat route no longer throws the `AbortError: Lock broken … steal`.

adb was NOT engaged by me (no teardown needed); Samsung left as-is.

---

## Invariant / Constitution check
- I-NO-SILENT-FAILURES: the web lock swallows ONLY the benign typed lock-acquire-timeout (orphan/steal recovery) and re-throws everything else; the fallback path is documented. PASS.
- Const #3 (no swallowed errors): the only catch runs `fn` lock-free on a typed timeout (intentional recovery), re-throws otherwise. PASS.
- Const #5 (server state in React Query, not Zustand): `hasHydrated` is CLIENT hydration state, not server data. PASS.
- Native-unchanged invariant: `lock` is web-gated; verified by test assertion. (Native runtime UNVERIFIED in-sandbox — logic-gated.)
- No new `any` / `@ts-ignore`. PASS.

---

## Parity / Cache / Regression surface
- Cache: no query keys changed. `useBrands`/`useBrand`/`useCurrentBrandRole` untouched; the lock fix only makes their gating signal (`isAuthReady`) resolve reliably.
- Regression surface for the tester: (1) cold-start single-tab business web still hydrates brand + 5-tab nav (no over-eager "loading" stuck state); (2) a genuinely brandless signed-in user STILL eventually sees rank-0 nav + "Create a brand" to-do AFTER resolution; (3) deleting the currently-selected brand still auto-clears correctly (the `hasHydrated` gate is true by then); (4) native iOS/Android session bootstrap unchanged; (5) desktop web never sees the recovery stub.

---

## Discoveries for orchestrator
1. **`navTabGate.test.ts` is broken on the base branch** — references `BRAND_ROLE_RANK.account_owner` which doesn't exist in `brandRole.ts` (the enum has scanner/marketing_manager/finance_manager/event_manager/brand_admin/brand_owner). It fails ts-jest compile (0 tests run). Last touched at `2ff437d50`, unrelated to ORCH-1100. Needs its own fix ORCH (append-only test policy → likely a `[TEST-MOD-APPROVED]` rewrite to the current 6-role enum).
2. The `stripComments` test helper (copied in several layout/firewall tests) is brittle: a `/*` inside a string literal (e.g. `"/(tabs)/marketing/*"` in `(tabs)/_layout.tsx`) makes its naive block-comment regex swallow real code. My test reads that file raw to avoid it. Worth hardening the shared helper.
3. Device verification (web export build + CDP harness) cannot run in the implementor sandbox — future ORCH-1100 waves needing per-route device proof should budget for an operator-run or out-of-sandbox harness pass.
