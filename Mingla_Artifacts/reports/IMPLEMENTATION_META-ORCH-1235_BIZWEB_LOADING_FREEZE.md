# IMPLEMENTATION — META-ORCH-1235 — business web loading-screen freeze

**Branch:** `orch-1235-bizweb-loading-freeze` · **Worktree:** `orch-1235-[bizweb-loading-freeze]`
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1235_BIZWEB_LOADING_FREEZE.md` (binding contract).
**Status:** IMPLEMENTED. P0 + P1 done. All three DRAFT invariants (A/B/C) shipped, self-tested, fails-on-revert proven. No auth gate or public path weakened (1232 family green).

---

## 1. NEW — `mingla-business/src/utils/withTimeout.ts`

Ports the app-mobile settle-guarantee, adds the typed error + named constants.

API:
- `withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T>` — `Promise.race` of `Promise.resolve(promise)` against a timer that REJECTS with `TimeoutError`; timer cleared in `.finally` (no leak). Accepts any `PromiseLike` → works on Supabase query builders (thenables), `functions.invoke`, `fetch`.
- `class TimeoutError extends Error { readonly isTimeout = true as const }` — message `"<label> timed out after <ms>ms"`, `name="TimeoutError"`.
- `isTimeoutError(e): e is TimeoutError` — `instanceof` OR duck-typed `isTimeout === true`.
- `DATA_FETCH_TIMEOUT_MS = 15000`, `AUTH_PROBE_TIMEOUT_MS = 5000` — the only two magic numbers, both `export const`.

Settle-guarantee only (no AbortController) — per spec NOTE; retry cap (§3) bounds orphaned-socket cost.

---

## 2. Service-layer wrapping (each sequential network await individually wrapped)

| Service fn | File:line (decl) | Wrapped await(s) | Label(s) | Deadline |
|---|---|---|---|---|
| `getBrand` | `mingla-business/src/services/brandsService.ts:756` | `.maybeSingle()` brand read; `Promise.all([getEventCounts…, aggregateBrandStats…])` | `getBrand:read`, `getBrand:stats` | DATA (15s) |
| `getBrands` | `brandsService.ts:497` | `auth.getSession()` precheck; `brand_team_members` read; owner-union `brands` read | `getBrands:session`, `getBrands:membership`, `getBrands:owned` | AUTH (5s) / DATA / DATA |
| `getExperiencesByBrand` | `src/services/experiencesService.ts:161` | `events` read; `aggregatePaidOrdersByEvent` leg | `getExperiencesByBrand`, `getExperiencesByBrand:agg` | DATA |
| `getTripsByBrand` | `src/services/tripsService.ts:814` | `events` read; `Promise.all([ticket_types, event_dates, ordersAgg])` | `getTripsByBrand`, `getTripsByBrand:detail` | DATA |
| `getMarketingOverview` (P1) | `src/services/marketing/marketingOverviewService.ts:74` | all 4 sequential reads (campaigns, recent, messages, clicks) | `getMarketingOverview:campaigns/recent/messages/clicks` | DATA |

Imports added: `brandsService.ts` (`withTimeout, DATA_FETCH_TIMEOUT_MS, AUTH_PROBE_TIMEOUT_MS`), `experiencesService.ts`, `tripsService.ts` (`withTimeout, DATA_FETCH_TIMEOUT_MS`), `marketingOverviewService.ts` (`withTimeout, DATA_FETCH_TIMEOUT_MS`).

Behavior on success preserved exactly — only the never-settling path changes (rejects with `TimeoutError`).

### P1 events-hub — SKIPPED (named + reasoned, per spec)
`app/(tabs)/hub/events.tsx` loads its lists via `<Suspense fallback={null}>` (line 760+), NOT a full-screen `if (isLoading) <Spinner/>` gate. It does not gate a full-screen spinner, so per spec §2.3 ("if a P1 target doesn't gate a full-screen spinner, note it and skip — do not invent") the events-hub list service was NOT wrapped. The four wrapped P0 services + `getMarketingOverview` cover every actual full-screen-spinner gate.

### OUT of scope (untouched, per spec §2.4)
- Realtime `.subscribe()` channels — fire-and-forget, no loading flag waits.
- Stripe Connect embedded pages (`ConnectOnboardingBody.web.tsx` + siblings) — the hang is inside `loadConnectAndInitialize()` (Stripe SDK/CDN load), not a Supabase read; `withTimeout` on a thenable cannot fix an SDK init that never calls back. Separate follow-up.
- Boot/splash timers + module-level deadline anchors — already bounded; §5 hardens minimally only.

---

## 3. queryClient — `mingla-business/src/config/queryClient.ts`

Diff (inside `defaultOptions.queries`):
```
  staleTime: FIVE_MINUTES_MS,
+ networkMode: "always",   // META-ORCH-1235 — an online flap must not pause-stick a query
  retry: 2,
  retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
```
`retry: 2` UNCHANGED. `retryDelay` capped at 4000ms UNCHANGED. `staleTime` UNCHANGED. A `TimeoutError` is a normal retryable rejection → after 2 retries the query becomes `isError` (bounded failure, no special-casing). No 4th retry, no lowered staleTime (avoids refetch-storm amplification).

---

## 4. Full-screen gates → bounded error + Retry (refetch)

| Gate | File | Wiring |
|---|---|---|
| Brand profile | `src/components/brand/BrandProfileView.tsx` | NEW props `isError?`, `onRetry?`. NEW branch `if (brand === null && isError)` renders "Couldn't load this brand. Check your connection and try again." + a **Retry** button (`testID="brand-profile-retry"`, `onPress={() => onRetry?.()}`), placed BEFORE the `isResolving` spinner and the genuine not-found branch (timeout = recoverable; not-found = not). Spinner branch (`brand === null && isResolving`, `testID="brand-profile-loading"`) retained, now guaranteed to end. |
| Brand route | `app/brand/[id]/index.tsx` | Passes `isError={brandQuery.isError}` and `onRetry={() => { void brandQuery.refetch(); }}` to `BrandProfileView`. |
| Hub experiences | `app/(tabs)/hub/experiences.tsx` | Existing `isError` arm gains a **Retry** `Pressable` (`testID="experiences-error-retry"`) → `experiencesQuery.refetch()`. New `retryButton`/`retryButtonLabel` styles. Spinner branch retained. |
| Hub trips | `app/(tabs)/hub/trips.tsx` | Existing `isError` arm gains a **Retry** `Pressable` (`testID="trips-error-retry"`) → `tripsQuery.refetch()`. New styles. |
| Marketing overview (P1) | `app/(tabs)/marketing/index.tsx` | Existing `isError`/`data===undefined` EmptyState gains a `cta={{ label: "Retry", onPress: () => overviewQuery.refetch() }}` (`testID="marketing-overview-error"`). Skeleton gate (`!hasResolved && !isError`) retained. |

---

## 5. Auth-probe hardening (minimal, §5)

- **getUser probe** (`src/context/AuthContext.tsx:~353`): wrapped `supabase.auth.getUser()` in `withTimeout(..., AUTH_PROBE_TIMEOUT_MS, "auth:getUser-probe")`. On timeout it throws → caught by the EXISTING `catch (probeException)` transport-failure arm which fails OPEN (keeps the user signed in). Sign-out/keep semantics unchanged; `setLoading(false)` now reachable well under the 7s ceiling. Import added (`withTimeout, AUTH_PROBE_TIMEOUT_MS`).
- **getSession precheck inside getBrands**: wrapped with `AUTH_PROBE_TIMEOUT_MS` (`getBrands:session`); on timeout it throws → consumer renders LOADING and RQ retries (same as the existing not-attached throw).
- **Reader unification (§5.2):** added canonical `hasUsableStoredWebSession()` to `src/utils/authReadiness.ts`, built on the SAME strict `hasUsableBusinessSession` check that `readStoredWebSession` uses (parses each `^sb-.+-auth-token$` localStorage value, requires a usable non-empty `access_token`). `app/_layout.tsx:184` `hasStoredSupabaseWebSession()` now delegates to it instead of the loose `value.includes("access_token")` substring scan. One source of truth → the two readers can no longer disagree, so `isWebAuthResolving` can't linger on a stale/partial token the strict reader rejects. The 3s/7s timers, module deadline anchors, lock clamp, and `onAuthStateChange` ordering were NOT touched.

---

## 6. DRAFT invariants — scripts + workflow jobs + self-tests + regression tests

Scripts under `.github/scripts/strict-grep/` (each has `--self-test`, registered in `.github/workflows/strict-grep-mingla-business.yml`):

- **I-PROPOSED-1235-A** `i-proposed-1235-a-fullscreen-queries-timeboxed.mjs` — in-script registry of the 5 gating service fns; for each, extracts the fn body and asserts it references `withTimeout(` AND the file imports from `utils/withTimeout`. Self-test: good body (withTimeout) passes; reverted raw `supabase.from(...).maybeSingle()` fails.
- **I-PROPOSED-1235-B** `i-proposed-1235-b-queryclient-networkmode-always.mjs` — asserts `networkMode: "always"` in queryClient.ts (comments stripped). Self-test good/bad.
- **I-PROPOSED-1235-C** `i-proposed-1235-c-loading-gate-has-error-retry.mjs` — in-script registry of the 5 full-screen-gating screens; for each asserts BOTH a loading gate AND an error branch with a Retry handler (`refetch(` and/or `onRetry`). Self-test: loading-only fails; both passes.

Workflow: 3 new jobs (`meta-orch-1235-a/b/c-*`) + 3 registry comment lines appended after the 1234 entry.

Regression tests (all NEW files — append-only gate not triggered; 17 tests, all green):
- `src/services/__tests__/brandsService.metaOrch1235.test.ts` — mocks `supabase` so `getBrand`'s `.maybeSingle()` NEVER settles; with fake timers, advancing past `DATA_FETCH_TIMEOUT_MS` makes `getBrand()` REJECT with a `TimeoutError` (asserted via `isTimeoutError`). Fails-on-revert: drop the wrap → hangs → fake timers never reject → test fails.
- `src/config/__tests__/queryClient.metaOrch1235.test.ts` — `queryClient.getDefaultOptions().queries.networkMode === "always"`; `retry === 2`; `retryDelay(10) ≤ 4000`.
- `src/components/brand/__tests__/BrandProfileView.metaOrch1235.test.tsx` — source-level (RN render unavailable in this jest env, mirrors the existing BrandProfileView.orch_1121 convention): asserts the brand error+Retry branch, the route's `isError`+`refetch` wiring, and the experiences/trips Retry→refetch wiring.
- `src/utils/__tests__/authReadiness.metaOrch1235.test.ts` — `hasUsableStoredWebSession` accepts a usable token, REJECTS an empty/partial token (the old loose-scan would have accepted), ignores non-supabase keys, survives unparseable values.
- `src/utils/__tests__/withTimeout.metaOrch1235.test.ts` — rejects-on-hang, resolves-in-time, propagates original rejection, constants pinned.

### Fails-on-revert proof (run in worktree)
- **B:** removed `networkMode: "always"` → `i-proposed-1235-b` FAIL (exit 1), restored → PASS.
- **A:** stripped all `withTimeout` from `getTripsByBrand` body → `i-proposed-1235-a` FAIL `[getTripsByBrand-timeboxed]` (exit 1), restored → PASS.
- **C:** removed `experiencesQuery.refetch()` from the isError arm → `i-proposed-1235-c` FAIL `[hub/experiences.tsx-error-retry]` (exit 1), restored → PASS.
- All three live runs PASS with violations=0; all `--self-test` PASS.

---

## 7. Guards / no-regression

- `i-proposed-1232-f` (public-safety, CLOSE-blocking) PASS; `1232-e`, `1232-d` PASS — no auth gate or public-path allowlist weakened. §5.2 unifies readers toward the STRICTER criterion (never looser).
- Typecheck: zero errors in any changed file (pre-existing repo errors are test-dep + app.config only; confirmed against baseline).
- ESLint changed files: 0 errors (only pre-existing warnings, none on new lines).
- Affected jest suites: baseline 17 failed / 36 passed → with 1235 changes 16 failed / 37 passed. The 16 remaining failures are PRE-EXISTING (mocks that don't stub `supabase.auth.getSession`, unrelated to this ORCH — verified identical with changes stashed). No new failures introduced; one additional suite (metaOrch1235) passes.
- Native not regressed: `withTimeout` is platform-agnostic; `networkMode:"always"` is RN-safe; the §5.2 reader change is inside the existing `Platform.OS === "web"` guard in `_layout.tsx`.

---

## 8. Not done here (handoff)
- Playwright reproduce-then-prove-gone (§7) — tester phase (browser-driven, requires a live web build + reviewer session). The unit-level fails-on-revert + the §6 regression tests cover the source contract.
- Stripe Connect SDK-init hang — explicitly out of scope (separate follow-up).
