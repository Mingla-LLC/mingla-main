# SPEC — META-ORCH-1235 — Business web "freezes on a loading screen (reload fixes it)"

**Phase:** SPEC (binding build contract)
**Surface:** `mingla-business/` (business.usemingla.com), web-first; native must not regress.
**Status:** READY FOR IMPLEMENT.
**Worktree:** `orch-1235-[bizweb-loading-freeze]` on branch `orch-1235-bizweb-loading-freeze`.
**Inputs (all read):** `INVESTIGATION_META-ORCH-1235_RUNTIME_REPRO.md`, `INVESTIGATION_META-ORCH-1235_STATIC_AUDIT.md`, `INVESTIGATION_META-ORCH-1235_BOOT_AUTH_GATING.md`.

---

## 0. Root cause (proven — what we are fixing)

Business-web data fetches have **no settle-guarantee**. A Supabase read that hangs (never resolves, never errors) — GoTrue web-lock contention / auth-warm window / `online`-`networkMode` pause / silently-dropped HTTP/2 stream — pins a full-screen `if (isLoading) return <Spinner/>` gate **forever**. The runtime repro caught exactly this: `/brand/[id]` froze on a permanent orange `ActivityIndicator`; `GET /rest/v1/brands` sat pending at 20 049 ms; only a **never-settling** read froze; a clean error degraded fine.

App-mobile already solves the class with `app-mobile/src/utils/withTimeout.ts` (a `Promise.race` settle-guarantee). Business web does **not** have it. **This spec ports that guarantee to business web and makes "every full-screen-spinner-gating query settles in bounded time" a CI-enforced invariant** — converting an infinite spinner into a bounded error + retry.

**This is a CLASS fix, not a screen fix.** The contract below is written so future code inherits the guarantee.

---

## 1. The `withTimeout` settle-guarantee (NEW FILE)

### 1.1 File to create

`mingla-business/src/utils/withTimeout.ts`

Mirror `app-mobile/src/utils/withTimeout.ts` exactly (`Promise.race` against a timer that REJECTS, timer cleaned up in `.finally`), then ADD a typed error and named default constants. Required contents:

```ts
/**
 * withTimeout — generic per-call settle-guarantee for business web (META-ORCH-1235).
 *
 * Races any thenable against a bounded deadline. If the promise never settles
 * (hung Supabase read, GoTrue web-lock contention, dropped HTTP/2 stream), it
 * REJECTS with a typed TimeoutError after `ms`, so the consumer surfaces an
 * error/retry instead of an infinite spinner. Mirrors app-mobile/src/utils/withTimeout.ts.
 */
export class TimeoutError extends Error {
  readonly isTimeout = true as const;
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export const isTimeoutError = (e: unknown): e is TimeoutError =>
  e instanceof TimeoutError ||
  (typeof e === "object" && e !== null && (e as { isTimeout?: unknown }).isTimeout === true);

// Default deadlines. Data reads get a generous ceiling (a slow-but-real read
// must still succeed); auth probes are tighter (they must finish well under the
// AuthContext 7s hard ceiling).
export const DATA_FETCH_TIMEOUT_MS = 15000;   // full-screen-gating data reads
export const AUTH_PROBE_TIMEOUT_MS = 5000;    // getSession()/getUser() probes (< 7s ceiling)

export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}
```

### 1.2 API contract (binding)

- `withTimeout(promise, ms, label)` — REJECTS with `TimeoutError` if `promise` does not settle within `ms`; otherwise resolves/rejects with the original outcome. Timer cleared on settle (no leak).
- MUST accept any `PromiseLike<T>` so it works on **Supabase query builders** (thenables — wrap the builder directly, e.g. `withTimeout(supabase.from("brands").select(...).maybeSingle(), ms, label)`), **`supabase.functions.invoke(...)`** (returns a Promise), and **`fetch(...)`**.
- `DATA_FETCH_TIMEOUT_MS = 15000`, `AUTH_PROBE_TIMEOUT_MS = 5000`. These are the only two magic numbers — both `export const` (no inline literals at call sites).
- `TimeoutError` carries `isTimeout: true` so React Query / loading gates can distinguish a timeout from a normal error without depending on message text. `isTimeoutError(e)` is the canonical predicate.

> NOTE — timeout vs AbortSignal. `withTimeout` is a **settle-guarantee only**: it stops the *consumer* from waiting forever, it does NOT cancel the underlying socket. That is correct and sufficient for this class (the bug is the wedged consumer, not the socket). Do NOT introduce `AbortController` plumbing into the Supabase query builder in this ORCH — out of scope, and supabase-js `.abortSignal()` support is uneven across builders. The retry-storm cap (§3) handles the orphaned-socket cost.

---

## 2. Where the settle-guarantee MUST be applied

### 2.1 The PRINCIPLE (generalizes — enforced in §6)

> **Any service function whose result drives a query whose `isLoading`/`isFetched` gates a full-screen spinner MUST race its network work against `withTimeout(..., DATA_FETCH_TIMEOUT_MS, <label>)` so it settles in bounded time.**

### 2.2 Injection point — DECISION: **service layer** (one consistent approach)

Wrap at the **service layer**, NOT in each `queryFn` and NOT via a global React Query `queryFn` wrapper.

Rationale (binding): (a) React Query v5 has **no built-in query timeout** — the timeout must live in the queryFn/service; (b) the service layer is the single choke point every consumer (hooks, imperative callers, recovery) already routes through, so wrapping there makes every consumer inherit the guarantee with the fewest edits and the least risk of a missed call site; (c) it keeps the labels meaningful (one label per service fn) and keeps the strict-grep gate (§6) checking a small, stable set of files. A global queryFn wrapper was rejected because it cannot see service labels, cannot apply per-call timeouts, and would not cover imperative (non-React-Query) service calls.

**Implementation shape at each wrapped service fn:** wrap the network awaits in `withTimeout(...)`. Where a service performs sequential awaits (e.g. `getBrand` does the brand read THEN `Promise.all([getEventCounts…, aggregateBrandStats…])`), **each network await is individually wrapped** (so neither leg can wedge), each with its own descriptive `label`. Preserve existing behavior on success exactly — only the never-settling path changes.

### 2.3 Exact service functions to wrap (priority order from the investigation)

| Pri | Service fn (file) | Consuming hook → full-screen gate | Wrap | Label(s) |
|---|---|---|---|---|
| P0 | `getBrand` (`mingla-business/src/services/brandsService.ts:731`) | `useBrand` (`src/hooks/useBrands.ts:254`) → `brand/[id]/index.tsx` `isBrandRouteResolving` → `BrandProfileView` spinner (**the proven freeze**) | brand read (`.maybeSingle()`) AND the `Promise.all([getEventCountsByBrandIds, aggregateBrandStatsByBrandIds])` — wrap both | `"getBrand:read"`, `"getBrand:stats"` |
| P0 | `getBrands` (`brandsService.ts:489`) | `useBrands` (`useBrands.ts:197`) → drives brand recovery / account brand list (the sibling pending read in the repro) | the `auth.getSession()` precheck (§5 reuse `AUTH_PROBE_TIMEOUT_MS`), the `brand_team_members` read, AND the owner-union `brands` read | `"getBrands:session"`, `"getBrands:membership"`, `"getBrands:owned"` |
| P0 | `getExperiencesByBrand` (`src/services/experiencesService.ts:159`) | `useExperiencesByBrand` (`src/hooks/useExperiencesByBrand.ts`) → `hub/experiences.tsx:249` full-screen `if (isLoading) <ActivityIndicator/>` | the `events` read | `"getExperiencesByBrand"` |
| P0 | `getTripsByBrand` (`src/services/tripsService.ts`, consumed `useTrips.ts:100`) | `useTripsByBrand` (`src/hooks/useTrips.ts:89`) → `hub/trips.tsx:235` full-screen spinner | the trips read | `"getTripsByBrand"` |
| P1 | the events-hub list service feeding `app/(tabs)/hub/events` | events-hub hook → events-hub full-screen gate | the events read | `"getEventsByBrand"` (use actual fn name) |
| P1 | `getMarketingOverview` (feeds `marketing/index.tsx:65` skeleton gate) | overview hook | the overview read | `"getMarketingOverview"` |

**P0 are mandatory for CLOSE.** P1 are required to satisfy the §6 generalized invariant (any full-screen-spinner-gating query) — implement them too; if any P1 service fn name differs from the table, the implementor uses the real name and records it in the implementation report. The strict-grep gate (§6.1) enumerates the authoritative list.

### 2.4 Explicitly OUT of scope (do NOT wrap / do NOT touch)

- Realtime `.subscribe()` channels — fire-and-forget cache invalidation, no loading flag waits on them (STATIC_AUDIT vector #12, cleared).
- The Stripe Connect embedded pages (`ConnectOnboardingBody.web.tsx:185` + 4 siblings) — the hang is inside `loadConnectAndInitialize()` (Stripe SDK/CDN load), NOT a Supabase read; `withTimeout` on a thenable does not fix an SDK init that never calls back. Out of scope for this ORCH (connect-route-only; separate follow-up). Note it in the report, do not implement.
- Boot/splash gates — already bounded at 7s (BOOT report); §5 hardens them minimally, nothing else.

---

## 3. React Query global config (`mingla-business/src/config/queryClient.ts`)

Edit the `defaultOptions.queries` block. Three changes, each with the constitutional-#3 "no silent failure" constraint:

1. **`networkMode: "always"`** — REQUIRED. Default `"online"` lets a `navigator.onLine === false` flap leave a never-fetched query in `fetchStatus: "paused"` with `isLoading` stuck true and no attempt/error (STATIC_AUDIT vector #7, the most likely intermittent *trigger*). `"always"` forces the query to run regardless of `navigator.onLine`, so a flap can never pause-stick it; combined with §1's `withTimeout`, a genuinely-dead network now surfaces a bounded error instead of an indefinite pause.
2. **Keep `retry: 2`** but **make the `TimeoutError` count as a normal retryable failure** (it already rejects, so it is retried) — do NOT special-case it away. After the retries exhaust, the query becomes `isError` → the gate (§4) shows error + retry. This is the desired bounded-failure behavior.
3. **Bound the retry cost** — keep `retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000)` (already capped). The runtime report saw a ~24-reads-in-25s storm on the error path (realtime `orders` invalidation + RQ refetch + retry backoff compounding). To cap it: do NOT raise `retry`; and the `withTimeout` ceiling (15s) bounds each attempt so the worst case is `1 + 2` attempts × (≤15s + backoff) rather than an unbounded pending socket pile-up. **Do not add a 4th retry. Do not lower `staleTime`** (would amplify refetch volume).

> No silent failures: every change above converts "stuck spinner" into "bounded error that the gate renders as retryable". Nothing is swallowed.

Final block (target):

```ts
queries: {
  staleTime: FIVE_MINUTES_MS,
  networkMode: "always",                       // META-ORCH-1235 — an online flap must not pause-stick a query
  retry: 2,
  retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
},
```

---

## 4. Full-screen loading gates → bounded error + RETRY (constitution #3)

On a timed-out/errored query, the gate MUST render an **error message + a Retry affordance** (calls `query.refetch()`), NOT an unbounded spinner. The `withTimeout` rejection (after `retry: 2`) flips `isError` true, so the existing `isError` arms now actually fire on a previously-hung read. Required per gate:

### 4.1 Brand profile (`brand/[id]/index.tsx` + `src/components/brand/BrandProfileView.tsx`)

The proven freeze. `isBrandRouteResolving` (`src/utils/coldLoadAuthGates.ts:28`) returns `true` while `brandIsNull && !queryIsFetched` — a hung read kept that true forever; with §2 wrapping `getBrand`, the read now rejects → `brandQuery.isError` true → `isFetched` true → `isBrandRouteResolving` flips false. The gate must NOT then fall through to a bare "Brand not found" for a **timeout/error** (which is recoverable, unlike a genuine not-found).

Contract:
- `brand/[id]/index.tsx` passes the query error state to `BrandProfileView` (add an `isError`/`onRetry` prop, or reuse the existing `isResolving` plumbing with an added error branch).
- `BrandProfileView` (`:476` block): when `brand === null && brandQuery.isError` → render an **error state** with a copy line ("Couldn't load this brand. Check your connection and try again.") and a **Retry button** wired to `brandQuery.refetch()`. Keep the existing genuine-not-found branch (`:495`) for `isFetched && !isError && brand === null`.
- The spinner branch (`brand === null && isResolving`) stays for the legitimate brief auth-warm window, but is now guaranteed to end (the underlying read settles within 15s).

### 4.2 Hub experiences (`app/(tabs)/hub/experiences.tsx`) and trips (`app/(tabs)/hub/trips.tsx`)

Both already have an `isError` arm (`experiences.tsx:257`, `trips.tsx:243`) that a never-settling promise never reached. With §2, the wrapped query now rejects → `isError` fires. **Add a Retry button to each existing `isError` block** (calls `query.refetch()`); keep the existing copy. The `isLoading` spinner branch (`:249` / `:235`) is retained but now guaranteed bounded.

### 4.3 Generalized rule (and §6 invariant)

> Every full-screen `if (query.isLoading) return <Spinner/>` gate MUST have a sibling `if (query.isError) return <ErrorWithRetry/>` whose Retry calls `refetch()`. A bare loading gate with no error+retry sibling is a freeze waiting to happen.

Apply this to the P1 gates too (events hub, marketing skeleton at `marketing/index.tsx:65` — its `isError` short-circuit already exists; add the Retry affordance).

---

## 5. Auth-probe hardening (minimal, safe — BOOT report)

The whole-app boot spinner is already bounded at ~7s (`AUTH_RESOLUTION_HARD_CEILING_MS`, `AuthContext.tsx:82`), so this is hardening, not the core fix. Two minimal, scoped changes:

### 5.1 Per-probe timeout shorter than the 7s ceiling

Wrap the two auth network probes so neither can consume the full 7s window:
- `supabase.auth.getSession()` inside `bootstrap()` (`AuthContext.tsx:285`) — it is already raced against the 3s `AUTH_BOOTSTRAP_TIMEOUT_MS`; do NOT duplicate or shorten that race. **No change required here** (already bounded < ceiling).
- `supabase.auth.getUser()` probe (`AuthContext.tsx:349`) — currently has **no per-call timeout**, only the outer 7s ceiling (BOOT report RACE D). Wrap it: `withTimeout(supabase.auth.getUser(), AUTH_PROBE_TIMEOUT_MS, "auth:getUser-probe")`. On `TimeoutError`, treat exactly as the existing probe-error path already treats an error (do not change the sign-out/keep semantics — only stop it from hanging). This keeps `setLoading(false)` reachable well before the 7s ceiling.
- `getBrands`' internal `auth.getSession()` precheck (§2.3) — wrap with `AUTH_PROBE_TIMEOUT_MS` (`"getBrands:session"`); on timeout it throws (same as the existing not-attached throw → consumer renders loading and RQ retries).

### 5.2 Unify the two stored-session readers (Race B)

There are two readers with **different acceptance criteria** that can disagree and leave `isWebAuthResolving` lingering:
- `readStoredWebSession()` (`AuthContext.tsx:101`) — strict: requires a usable `access_token` via `hasUsableBusinessSession`.
- `hasStoredSupabaseWebSession()` (`app/_layout.tsx:184`) — loose: matches any key containing the substring `"access_token"`.

**Make `_layout.tsx`'s loose reader delegate to the strict criterion** so they cannot disagree. Concretely: export a single canonical predicate from the auth/readiness module (e.g. `hasUsableStoredWebSession(): boolean` built on the SAME `hasUsableBusinessSession` check `readStoredWebSession` uses), and have `_layout.tsx:184` `hasStoredSupabaseWebSession()` call it instead of the loose substring scan. Result: `isWebAuthResolving` (`coldLoadAuthGates.ts:332`) can no longer stay true on a stale/partial token that the strict reader rejects.

**Scope guard:** this is the ONLY behavioral change to the boot path. Do not touch the 3s/7s timers, the module-level deadline anchors, the lock clamp, or the `onAuthStateChange` ordering. Keep it minimal — the boot gate is already bounded; this only removes the reader-disagreement linger.

---

## 6. DRAFT invariants (`I-PROPOSED-1235-*`) — each with enforcement + regression test

Register as modular strict-grep scripts in `.github/scripts/strict-grep/` (DEC-101 registry pattern) and add one job each to `.github/workflows/strict-grep-mingla-business.yml` (self-test step + run step, mirroring `i-proposed-1232-e-*`). Each must ship a `--self-test`.

### I-PROPOSED-1235-A — full-screen-spinner-gating services use `withTimeout`
**Statement:** every service fn in the authoritative list (§2.3 P0+P1) wraps its network await(s) in `withTimeout(..., DATA_FETCH_TIMEOUT_MS or AUTH_PROBE_TIMEOUT_MS, <label>)`.
**Enforcement:** `i-proposed-1235-a-fullscreen-queries-timeboxed.mjs` — for each `{file, fnName}` in an in-script registry, extract the fn body and assert it references `withTimeout(` and imports from `src/utils/withTimeout`. Self-test: a good body (has `withTimeout`) passes; a reverted body (raw `supabase.from(...).maybeSingle()` with no `withTimeout`) fails.
**Regression test:** `mingla-business/src/services/__tests__/brandsService.metaOrch1235.test.ts` — mock `supabase` so `getBrand`'s read never settles; assert `getBrand()` REJECTS with a `TimeoutError` within ~`DATA_FETCH_TIMEOUT_MS` (use fake timers) rather than hanging. Fails-on-revert: remove the wrap → test hangs/fails.

### I-PROPOSED-1235-B — `queryClient` networkMode is `"always"`
**Statement:** `mingla-business/src/config/queryClient.ts` sets `networkMode: "always"` on `defaultOptions.queries`.
**Enforcement:** `i-proposed-1235-b-querclient-networkmode-always.mjs` — assert the file contains `networkMode: "always"` inside the `queries` block (strip comments). Self-test good/bad.
**Regression test:** `mingla-business/src/config/__tests__/queryClient.metaOrch1235.test.ts` — assert `queryClient.getDefaultOptions().queries.networkMode === "always"`.

### I-PROPOSED-1235-C — no unbounded full-screen spinner (loading gate ⇒ error+retry sibling)
**Statement:** in the enumerated full-screen-gating screens (§4: `hub/experiences.tsx`, `hub/trips.tsx`, `brand/[id]/index.tsx` via `BrandProfileView.tsx`, events hub, `marketing/index.tsx`), any `if (...isLoading...) return <Spinner/>` full-screen gate has a sibling `isError` branch that renders a Retry affordance calling `refetch()`.
**Enforcement:** `i-proposed-1235-c-loading-gate-has-error-retry.mjs` — for each enumerated screen, assert both an `isLoading` full-screen return AND an `isError` return containing a retry handler (`refetch(`). Self-test: a screen with only `isLoading` fails; one with both passes.
**Regression test:** RTL test per gate (or one parametrized) — render the screen with the query forced to `isError`; assert the Retry control is present and `refetch` is invoked on press (e.g. `BrandProfileView.metaOrch1235.test.tsx`, extend the existing `hub` tests).

> NOTE: I-PROPOSED-1235-C is the generalized class guard. Its in-script screen registry is the source of truth for "which gates count"; adding a future full-screen-gating screen without an error+retry sibling fails CI.

---

## 7. Test plan — reproduce-then-prove-gone (browser-driven, Playwright/Chromium)

Mirror the RUNTIME_REPRO harness (`repro*.mjs`/`brandgate.mjs`): mint a real reviewer session via `reviewer-signin`, inject the Supabase session object into `localStorage["sb-gqnoajqerqhnvulmnyvv-auth-token"]` via `addInitScript`, serve the worktree web build (`npx expo start --web --clear`), and intercept ONLY `*.supabase.co` requests (bundle served full-speed).

### 7.1 REPRODUCE on CURRENT code (must fail = infinite spinner)
- Route to `/brand/<brandId>` with the brand-detail read hung. **Simulate a never-settling request in Playwright** via route interception that never fulfills:
  ```js
  await page.route('**/rest/v1/brands**', async () => { /* never call route.fulfill/abort — leave it hanging */ });
  ```
- Expect (current code): permanent orange `ActivityIndicator` (`testID="brand-profile-loading"`), pending `GET /rest/v1/brands` > 20s, no error. This is the baseline freeze. Capture screenshot.

### 7.2 PROVE-GONE on FIXED code (same hung read → bounded error+retry)
- Same route, same never-fulfilling interception.
- Expect (fixed): within ~`DATA_FETCH_TIMEOUT_MS` (15s) + retry backoff (worst case ~3 attempts; allow a ≤60s ceiling for the assertion) the spinner is REPLACED by the brand error state with a visible **Retry** control — **no infinite spinner**. Assert `testID="brand-profile-loading"` is gone and the Retry control is present.
- Then **un-hang** the route (start fulfilling normally) and press Retry → assert the brand profile renders. (Proves recovery without a page reload — the whole point.)

### 7.3 Healthy load still fast
- No interception (or pass-through). Assert `/brand/<id>` renders the profile in < 2s; spinner shown briefly or not at all. No regression on the happy path.

### 7.4 `online`-flap scenario no longer pauses-stuck
- Cold-load a full-screen-gating Hub tab (`hub/experiences`) while toggling the browser offline→online once during the initial fetch (`context.setOffline(true)` then `false`, or emulate an `navigator.onLine` flap). Expect: with `networkMode:"always"` the query still runs and settles (or times out to error+retry) — assert it does NOT sit on an indefinite spinner with no error. On CURRENT code this should be reproducible as a stuck spinner; on FIXED code it must resolve or error+retry.

### 7.5 Boot path stays bounded (no regression)
- Cold-load `/` with the stored session cleared and `auth/v1/*` hung. Assert the app leaves the boot spinner within the existing ~7s ceiling and lands on sign-in (BOOT report behavior preserved). Then with the §5.2 reader-unification: load with a **stale/partial** `sb-…-auth-token` (an `access_token` substring but not a usable session) → assert the app does NOT linger on `AuthResolvingScreen` (the loose reader no longer disagrees with the strict one) and resolves to sign-in within the ceiling.

### 7.6 Guards (must still pass)
- META-ORCH-1232 `i-proposed-1232-f-public-paths-ungated` and the rest of the 1232 family stay GREEN (do not weaken auth gates or the public-path allowlist).
- All existing strict-grep gates + the new `I-PROPOSED-1235-A/B/C` GREEN.
- `mingla-business` typecheck + lint + unit tests GREEN. Native build unaffected (changes are `Platform.OS === "web"`-safe: `withTimeout` is platform-agnostic, `networkMode:"always"` is RN-safe, the §5.2 reader is already web-guarded).

---

## 8. Guard rails (binding scope limits)

1. **Do NOT weaken auth gates or public-path allowlists.** §5.2 unifies readers toward the STRICTER criterion (never looser). The META-ORCH-1232 `i-proposed-1232-f` gate must stay green.
2. **Web-only behavior must not regress native.** `withTimeout` is platform-agnostic and safe on native; `networkMode:"always"` is RN-safe; the §5.2 reader change is inside an existing `Platform.OS === "web"` guard. Run the native typecheck.
3. **Stay in the freeze class.** Do NOT refactor unrelated screens, do NOT introduce `AbortController` plumbing, do NOT touch the Stripe Connect SDK-init hang (separate follow-up), do NOT change boot timers/anchors beyond §5.
4. **No silent failures (constitution #3).** Every timeout/error path surfaces a user-visible error + Retry; nothing is swallowed into an empty success.
5. **No new magic numbers.** Only `DATA_FETCH_TIMEOUT_MS` (15000) and `AUTH_PROBE_TIMEOUT_MS` (5000), both `export const` in `withTimeout.ts`.

---

## 9. CLOSE checklist (implementor + tester)

- [ ] `mingla-business/src/utils/withTimeout.ts` created (API §1).
- [ ] P0 services wrapped (§2.3): `getBrand`, `getBrands`, `getExperiencesByBrand`, `getTripsByBrand`. P1 wrapped or named-and-reported.
- [ ] `queryClient.ts` → `networkMode:"always"` (§3).
- [ ] Brand profile + Hub experiences/trips gates render error+Retry on a timed-out read (§4).
- [ ] `getUser()` probe wrapped; stored-session readers unified (§5).
- [ ] `I-PROPOSED-1235-A/B/C` scripts + workflow jobs + self-tests + regression tests (§6).
- [ ] Playwright reproduce-then-prove-gone (§7.1–7.2) captured; healthy/flap/boot scenarios (§7.3–7.5) green; guards (§7.6) green.
- [ ] Fails-on-revert demonstrated for the §6 regression tests.
