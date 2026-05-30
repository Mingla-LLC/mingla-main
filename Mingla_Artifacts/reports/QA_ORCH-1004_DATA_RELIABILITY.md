# QA — ORCH-1004 [Business web data reliability]

**Mode:** TARGETED (orchestrator TEST dispatch) · **Worktree:** `~/Desktop/mingla-orchs/ORCH-1004-[biz-web-data-reliability]/` · **Branch:** `ORCH-1004-biz-web-data-reliability`
**Implementation under test:** commit `5bf446b29` · **Baseline:** `origin/main` @ `53e28e712`
**Tester:** mingla-tester+claude · **Date:** 2026-05-29

---

## VERDICT: PASS

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 0 | **P4:** 2 (praise)
- Report: `Mingla_Artifacts/reports/QA_ORCH-1004_DATA_RELIABILITY.md`
- Sim/web evidence: **Web — buyer-web anon render PROVEN** (Playwright/Chromium headless, static export, 5 public routes, `proven` level). iOS/Android: **EXEMPT** — the fix is a shared React Query `enabled`-gate + AuthContext logic with identical single code path across platforms; the symptom + the highest-risk regression (buyer-web public pages) are web-only (URL persists across refresh → the pre-auth race is web-specific per the investigation). No native/UI-layout surface changed; no platform-divergent code. Stated per Phase 0.A skip rule.
- Regression tests: implementor happy-path = `mingla-business/src/hooks/__tests__/authScopedQueryReadiness.test.ts` (✅ green, ✅ fails-on-revert independently re-verified by tester @ working tree); implementor adversarial = `mingla-business/src/hooks/__tests__/orch1004AuthScopedQueryGate.test.ts` (✅ green); **tester adversarial = `mingla-business/src/hooks/__tests__/orch1004AllowlistIntegrity.test.ts` (✅ 9/9 green, ✅ fails-on-revert proven — different angle: allowlist/auth-scoped-list data-integrity + "no public hook silently regresses behind the gate").**

### Verdict gate
- PASS requires `proven` live-fire on every applicable platform → met: web `proven`, iOS/Android exempt (shared-code, web-only symptom + regression surface).
- The highest-risk regression (buyer-web anon rendering) is proven, not asserted. `test:orch-1004` is green.

### Completion condition (`/goal`) — all five clauses satisfied
1. Every independent test green — outputs captured below.
2. `tsc --noEmit` clean on all touched `src/hooks/` + `src/context/` files — captured (0 in-scope errors).
3. Both regression tests + the tester test present in `git diff origin/main...HEAD --name-only`; tester test attacks a different angle; implementor fails-on-revert independently re-verified @ working tree.
4. UI/runtime web leg reproduces at `proven` (anon render); iOS/Android exempt with reason. A stale-Metro-cache build blocker was RESOLVED (not noted) — see §3.
5. Zero open P0 / P1.

---

## 1. Scope + blast radius

Diff vs `origin/main` (`git diff origin/main...HEAD --name-only`): 19 hook files gated + `AuthContext.tsx` (+ its locked timeout test) + new strict-grep gate `orch-1004-auth-scoped-query-readiness.mjs` + workflow job + `package.json` (`test:orch-1004`) + 2 implementor tests + 3 artifacts. No migration / RLS / edge-function / queryClient changes — confirmed (`git diff` shows none). RLS not weakened (no DB touch at all). Out-of-scope packages (`packages/phone-input/`, `packages/event-rendering/`) untouched.

## 2. Test + tsc results (captured)

### `npm run test:orch-1004` — GREEN
```
ORCH-1004 gate self-test PASS (6/6 cases).
ORCH-1004 gate PASS: all 24 auth-scoped hooks gate enabled on isAuthReady; 5 public/dual-use hooks left ungated (buyer-web protected).
PASS src/hooks/__tests__/authScopedQueryReadiness.test.ts
PASS src/hooks/__tests__/orch1004AuthScopedQueryGate.test.ts
Test Suites: 2 passed, 2 total · Tests: 15 passed, 15 total
```

### `npx jest AuthContext CoverPicker authReadiness` — GREEN
```
PASS src/components/ui/__tests__/CoverPicker.videoSourceCeiling.test.ts
PASS src/components/ui/__tests__/orch1001CoverPickerWebSplit.test.ts
PASS src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts
PASS src/utils/__tests__/authReadiness.test.ts
PASS src/context/__tests__/AuthContext.timeout.test.ts
Test Suites: 5 passed, 5 total · Tests: 30 passed, 30 total
```

### All three ORCH-1004 hook tests together — GREEN
```
PASS src/hooks/__tests__/orch1004AllowlistIntegrity.test.ts
PASS src/hooks/__tests__/orch1004AuthScopedQueryGate.test.ts
PASS src/hooks/__tests__/authScopedQueryReadiness.test.ts
Test Suites: 3 passed, 3 total · Tests: 24 passed, 24 total
```

### Only-allowed pre-existing failure — CONFIRMED out-of-scope
`__tests__/services/eventCoverVideoProcessingService.compression.test.ts` fails with `TypeError: Cannot read properties of undefined (reading 'getSession')` at `eventCoverVideoProcessingService.ts:669` (`supabase.auth.getSession()` — the test doesn't mock `supabase.auth`). ORCH-1004 did NOT touch that test or its service (`git diff origin/main...HEAD` shows neither file) → fails identically on `main`. Allowed per dispatch.

### `npx tsc --noEmit` — clean for touched files
0 errors in any `src/hooks/` or `src/context/` file (grep of full tsc output → "NONE in src/hooks or src/context"). All tsc errors are in untouched `packages/phone-input/` + `packages/event-rendering/` (module-resolution + pre-existing implicit-any; `git diff` confirms `packages/` untouched). No NEW errors introduced.

## 3. LOAD-BEARING REGRESSION — buyer-web anon rendering (PROVEN, web `proven`)

**Blocker RESOLVED (not noted):** the first `npx expo export -p web` produced a degenerate 984 KB / 628-module bundle that threw `No routes found` on every route — a stale Metro cache artifact in the worktree (symlinked `node_modules`). A differential build of `origin/main` (anchor checkout) under the same server + probe rendered fine (`rootLen=5804, 0 errors`), proving the empty bundle was NOT an ORCH-1004 regression and NOT an environment limitation. Rebuilding the worktree export with `--clear` produced a full **8.79 MB** bundle (byte-comparable to main's 8.78 MB, same route chunks `NativeCheckoutPaymentBoundary` / `evictEndedEvents` / `reapOrphanStorageKeys`). Per `feedback_sim_boot_blocker_must_resolve_not_note.md` the blocker was fixed, not used as a terminal verdict.

**Evidence harness:** `mingla-business/playwright/orch1004-anon-render-probe.mjs` (committed). Static server `playwright/meta-orch-0952-static-server.mjs` on `127.0.0.1:8089` serving `web-build-orch1004test` (deleted post-run, not committed). Chromium headless, fresh context per route, `localStorage`/`sessionStorage` cleared via `addInitScript` BEFORE app code runs → truly anonymous (probe asserts `hasAuthToken=false` per route).

| Route | #root innerHTML length | page errors | hasAuthToken | ok |
|------|------|------|------|------|
| `/` (app shell cold-open) | 5804 | 0 | false | ✅ |
| `/e/some-brand/some-event` (usePublicEvents) | 1384 | 0 | false | ✅ |
| `/b/some-brand` (useBrand single, public shell) | 1610 | 0 | false | ✅ |
| `/t/some-brand/some-trip` (usePublicTripBySlug) | 894 | 0 | false | ✅ |
| `/checkout-trip/<uuid>/intake` (**useIntakeSchema, ungated**) | 2156 | 0 | false | ✅ |

Probe verdict: **PASS** (exit 0). Every anon route mounts `#root` with content and 0 page-level JS errors, with no session attached. The `checkout-trip/.../intake` page — which reads the intentionally-ungated `useIntakeSchema` — renders anonymously (2156 chars), confirming the dual-use allowlist decision (D-1) does not starve the anon buyer intake path.

## 4. Fix-mechanism proof (Step 3) — disabled→enabled, fails-on-revert

Independently re-verified by the tester (not trusting the implementor's claim):
- **Happy-path mechanism:** `useTrips` reverted (`isAuthReady &&` stripped from both `enabled` lines) → `authScopedQueryReadiness.test.ts` FAILS at line 95 (`expect(call.enabled).toBe(false)` — query would fire pre-auth). Restored → green. So the gate is what produces disabled-when-not-ready / enabled-when-ready, preserving the `DISABLED_KEY` (I-DISABLED-QUERY-IS-LOADING).
- **Gate mechanism:** with `useTrips` reverted the strict-grep gate exits 1 (`useTrips.ts: isAuthReady ... not wired into an "enabled" computation`); restored → exits 0 (`all 24 auth-scoped hooks gate ...`).

## 5. Tester adversarial test (Step 0.5(b)) — DIFFERENT angle

**Path:** `mingla-business/src/hooks/__tests__/orch1004AllowlistIntegrity.test.ts` (9 tests, all green).

**Angle (distinct from both implementor tests):** the implementor's happy-path proves one hook gates at runtime; the implementor's adversarial test drives the gate's classifier against planted fixtures + runs the gate subprocess + asserts a FIXED set of named public hooks are ungated. This tester test treats the gate's two curated lists as a **security-load-bearing data contract** and attacks their integrity + completeness — parsing `AUTH_SCOPED_HOOK_FILES` + `PUBLIC_HOOK_ALLOWLIST` straight out of the gate source and asserting:
- **R2** — every allowlisted public hook is genuinely ungated in real source AND carries a non-empty (>10-char) anon reason (no hook waved through with empty justification).
- **R1 disjointness** — no file in both lists.
- **R1 auth-scoped completeness** — every registered auth-scoped hook that exists on disk is genuinely gated.
- **R1 buyer-web completeness (the dispatch's named risk)** — by directory enumeration, EVERY `usePublic*.ts` hook on disk + the dual-use `useIntakeSchema.ts` is (a) ungated and (b) present in the allowlist, so a NEW public hook cannot silently regress behind the auth gate (the implementor's fixed name-list test cannot catch a newly-added public hook).

**Passing run:**
```
PASS src/hooks/__tests__/orch1004AllowlistIntegrity.test.ts
Tests: 9 passed, 9 total
```

**Fails-on-revert (proven):** injecting `isAuthReady &&` into `usePublicEvents` (the exact buyer-web silent-regression the dispatch named) → the test FAILS on 2 assertions (R2 "ungated + reasoned" + R1 "no public hook silently regresses behind the gate", line 139 `expect(isGated(src)).toBe(false)`). Restored → 9/9 green.

## 6. AuthContext late-session fix (Part 2 / RC-3) — verified

Diff reviewed line-by-line: post-timeout, a passive late event (`INITIAL_SESSION`/`TOKEN_REFRESHED`/`USER_UPDATED`) WITH a usable session (`hasUsableBusinessSession(s)`) clears `bootstrapTimedOutRef` and FALLS THROUGH to the shared `setSession`/`setUser` writes (so `isAuthReady` flips true → gated queries fire). A passive late event with NO usable session is still ignored (stale echo). The `SIGNED_IN`-only recovery + first-event analytics block remains gated to `_event === "SIGNED_IN"` (verified at AuthContext.tsx:341), so ORCH-0887-A anti-flash / no-duplicate-analytics is preserved. The locked `AuthContext.timeout.test.ts` (modified under `[TEST-MOD-APPROVED ORCH-1004]`) passes (18 tests; part of the 30/30 above).

## 7. Constitution + invariants
- **#2 one owner per truth / #3 no silent failures:** improved — the empty-success-cached-as-data silent failure (RC-2) is closed by the readiness gate. PASS.
- **#5 server-state-server-side, #11 one-auth-instance, #14 persisted-state startup:** unaffected; the persisted brand store still rehydrates sync, but the query now waits for auth readiness. PASS.
- **I-DISABLED-QUERY-IS-LOADING (ORCH-0889):** preserved — every gated hook keeps `DISABLED_KEY` (verified in `useTrips` diff). PASS.
- RLS not weakened (no DB change). queryClient retry/staleTime unchanged. PASS.

## 8. P4 — praise
- The strict-grep gate's curated-list-over-AST-heuristic choice + the self-test (6 cases) + npm-wiring check + bidirectional allowlist cross-check is exactly the right durability posture for a security-load-bearing gate.
- The dual-use `useIntakeSchema` deviation (D-1) was correctly caught against the SPEC by DB-probing the `trip_intake_schemas_anon_select` policy rather than blindly following the SPEC's gate list — proven correct by this QA's anon intake-page render.

## Discoveries for orchestrator
- `useTripIntakeSchemaByTier` is dead code (no callers) — implementor already flagged for a future cleanup ORCH. No action here.
- The worktree's symlinked `node_modules` causes `expo export -p web` to emit a degenerate bundle WITHOUT `--clear`. Any future web-export QA in a worktree must pass `--clear` (or the 984 KB / "No routes found" false-negative recurs). Recommend folding into the worktree web-export runbook.

## Cross-surface skip statement
iOS/Android legs skipped: the change is a shared React Query `enabled`-gate + AuthContext branch with a single code path; the symptom + the load-bearing regression are web-specific (URL-persisted authed routes); no native module, layout, gesture, or platform-divergent code touched. Per Phase 0.A this is a valid skip, stated with reason.
