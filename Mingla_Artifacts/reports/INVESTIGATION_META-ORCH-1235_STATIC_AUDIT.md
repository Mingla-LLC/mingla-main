# INVESTIGATION — META-ORCH-1235 — Business web freezes on a loading screen (reload fixes it)
## STATIC AUDIT angle — exhaustive infinite-loading-vector enumeration

**Scope:** `mingla-business/` (business.usemingla.com), READ-ONLY, evidence-first.
**Symptom:** business web intermittently freezes on a spinner; reload fixes it → an async op never resolves, a loading flag stays `true` forever.
**React Query:** `@tanstack/react-query ^5.100.6`.

---

## HEADLINE FINDINGS

1. **Business web has NO general async timeout guard.** app-mobile ships `src/utils/withTimeout.ts` (a `Promise.race` timeout wrapper used across data fetches; e.g. `getConversations` 10s, `AccountSettings` 45s, `useForegroundRefresh` 8s). **`mingla-business/src/utils/withTimeout.ts` does NOT exist** (confirmed — no file). The ONLY timeout protection in the entire app lives in `AuthContext.tsx` (the 3s `Promise.race` boot timeout + 7s hard ceiling). **Every data-fetching React Query queryFn calls Supabase with no timeout.** React Query does NOT impose its own promise timeout — `isLoading`/`isFetching` stay `true` for as long as the queryFn promise is unsettled. A background-suspended socket / hung connection / dropped websocket-upgrade therefore pins any screen that early-returns a spinner on `isLoading`.

2. **The BOOT / AUTH / brand-recovery layer is hardened and is NOT the freeze.** `_layout.tsx` + `index.tsx` carry remount-immune module-level deadline anchors (`AUTH_RESOLUTION_HARD_CEILING_MS = 7000`, `AUTH_RESOLUTION_CEILING_MS`), the 2s `BRAND_FETCH_TIMEOUT_MS` splash backstop, and Zustand `hasHydrated` that is set synchronously in `onRehydrateStorage` on BOTH success and error arms. These cannot stick. The freeze is **downstream**, in a per-screen data gate that inherited none of these backstops.

3. **Strongest candidates are the per-screen full-render spinner gates** (`if (query.isLoading) return <Spinner/>`) fed by un-timed Supabase queries, plus the Stripe Connect embedded pages whose SDK init can hang.

---

## GLOBAL queryClient CONFIG (quoted) — `src/config/queryClient.ts:31-48`

```ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: FIVE_MINUTES_MS,          // 5 * 60 * 1000
      retry: 2,                            // ORCH-0964 bumped 1->2
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: { retry: 0 },
  },
});
```

**Config-level freeze contributors:**
- **No `networkMode` set** → defaults to `"online"`. On web, if the browser reports `navigator.onLine === false` (or flaps), an `online`-mode query that has never fetched sits in `fetchStatus: "paused"` — `isLoading` stays `true` indefinitely with no network attempt and no error. A spinner gated on `isLoading` never clears until connectivity is re-detected. **No timeout, no error.** (MED–HIGH contributor to intermittent freeze.)
- **No query-level timeout anywhere.** `retry: 2` + capped backoff only fire on a *rejected* promise. A promise that **never settles** is never retried and never errored — the failure mode behind this symptom. (HIGH.)
- `staleTime: 5min` is a *staleness* control, not a hang control — irrelevant to a never-settling promise but relevant to "looks stuck" after a focus/reconnect refetch.

---

## RANKED INFINITE-LOADING VECTOR TABLE

| # | Vector (file:line) | Gated flag | Failure mode (hung async) | Conf |
|---|---|---|---|---|
| 1 | `app/(tabs)/hub/experiences.tsx:249` `if (experiencesQuery.isLoading) return <ActivityIndicator/>` | `experiencesQuery.isLoading` from `useExperiencesByBrand` | Un-timed Supabase fetch never settles (suspended socket / paused online-mode query) → whole Experiences tab is a permanent spinner. Has an `isError` branch (`:257`) but a never-settling promise never reaches it. | **HIGH** |
| 2 | `app/(tabs)/hub/trips.tsx:235` `if (tripsQuery.isLoading) return <ActivityIndicator/>` | `tripsQuery.isLoading` from `useTripsByBrand` | Identical pattern to #1; full-screen block, no timeout, only an `isError` arm a hung promise never hits. | **HIGH** |
| 3 | `src/components/stripe/connect-pages/ConnectOnboardingBody.web.tsx:185` (`if (stripeConnectInstance === null) … "Initializing onboarding…"`) + siblings `ConnectAccountManagementBody.web.tsx:139`, `ConnectPartnerOnboardingBody.web.tsx:163`, `ConnectPartnerAccountManagementBody.web.tsx:125`, `ConnectTaxRegistrationsBody.web.tsx:92` | `stripeConnectInstance === null` | `loadConnectAndInitialize()` (`@stripe/connect-js`) hangs on SDK/CDN load or internal client-secret validation → instance stays `null` forever → permanent spinner. No timeout, no AbortController, no error boundary on the chunk. clientSecret itself comes from URL params (sync), so the hang is in Stripe's SDK load, not a fetch. Connect-route-only (not the common post-login path), hence below #1/#2. | **MED** |
| 4 | `app/(tabs)/marketing/index.tsx:65` `if (!overviewQuery.hasResolved && !overviewQuery.isError) return <skeleton/>` | `overviewQuery.hasResolved` (= `isFetched`) | Un-timed `getMarketingOverview` Supabase call never settles → Blast tab stuck as skeleton. `isError` short-circuit exists but a never-settling promise never errors. | **MED** |
| 5 | `app/(tabs)/connect-*.web.tsx` `React.lazy(...)` inside `<Suspense fallback={<ConnectLoadingFallback/>}>` (`connect-onboarding.web.tsx:21/29`, `connect-account-management.web.tsx:19/28`, partner variants) | Suspense promise (chunk fetch) | A JS-chunk fetch that hangs (not 404 — `chunkReloadGuard` only auto-reloads on a *failed* fetch) leaves the Suspense fallback up forever. No timeout on dynamic import. Mitigated by `src/diagnostics/chunkReloadGuard` for hard *failures*, NOT for a silently-stalled fetch. | **LOW–MED** |
| 6 | `app/(tabs)/hub/_layout.tsx:303` `loading={visibleTabs.isLoading}` from `useBrandOfferingCounts` (`useBrandOfferingCounts.ts`) | `visibleTabs.isLoading` | Pills show a spinner + go unclickable if the counts query hangs; `<Slot/>` below still renders, so it traps the user on the current sub-tab rather than the whole screen. | **MED** (partial) |
| 7 | `GLOBAL` `queryClient` no `networkMode` (`src/config/queryClient.ts`) | any `isLoading` on a never-fetched query | Browser `online=false`/flap → `online`-mode query paused, `isLoading` stuck true with no attempt/error. Amplifies #1/#2/#4. | **MED** |
| 8 | `app/account/edit-profile.tsx:280` `if (isLoading) return <Spinner/>` | `isLoading` | Full-screen gate on an un-timed account fetch; lower-traffic route. | **LOW** |
| 9 | `src/components/rsvp/RsvpGuestConsole.tsx:159`, `src/components/hub/HubSubNav.tsx:108` `if (isLoading)` blocks | `isLoading` | Same family, narrower surfaces. | **LOW** |
| 10 | `_layout.tsx` brand-splash gate (`brandReady`, `:270-288`) / `index.tsx` boot spinner (`:79`) / `AuthResolvingScreen` (`:678`) | `loading` / `brandReady` / `authResolving` | **HARDENED — NOT a vector.** 2s `BRAND_FETCH_TIMEOUT_MS` splash backstop + 7s `AUTH_RESOLUTION_HARD_CEILING_MS` + remount-immune module anchors guarantee these always release. Listed to record they were checked and cleared. | N/A |
| 11 | `useCurrentBrandRecovery.ts:209` `isResolving` | `isResolving` | Stays true while `!brandsQuery.isFetched || !creatorAccount.isFetched`. If those queries hang it would stick — BUT in `_layout.tsx` it's covered by `brandFetchTimedOut`, and `(tabs)/_layout.tsx:98` only affects tab visibility (renders `<Slot/>` unconditionally), and home (`home.tsx:170`) does not full-block on it. Not a standalone full-screen freeze. | **LOW** |
| 12 | Realtime channels (`useBrands.ts:144/211`, `useEventGroupChat`, `useBrandStripeStatus`, `useSupportQueue`, `useVenueWaitlist`, `useBusinessNotifications`, `useBrandStripeBankVerification`, `useOrderRealtimeSubscription`, …) | none | **NOT a vector.** Every `.subscribe()` is fire-and-forget cache-invalidation; no UI loading flag waits on `SUBSCRIBED`/connection state. A flaky socket degrades freshness, not boot. | N/A |

---

## TOP CANDIDATE(S) FOR THE INTERMITTENT FREEZE

**Primary: the Hub full-screen `isLoading` spinner gates — `hub/experiences.tsx:249` and `hub/trips.tsx:235` (HIGH).**
These are the cleanest match for "freezes on a spinner, reload fixes it":
- The render is literally `if (query.isLoading) return <ActivityIndicator/>` — the entire tab is the spinner.
- The query (`useExperiencesByBrand` / `useTripsByBrand`) is an un-timed Supabase call. With `staleTime` 60s/5min and `retry` only on *rejection*, a promise that never settles (background-suspended tab resumed onto a dead socket, or an `online`-mode query paused by an `online=false` flap) keeps `isLoading === true` with no error, no retry, no timeout.
- **Reload fixes it** because a fresh page mounts a brand-new query against a live socket. This is exactly the reported behavior.
- Cross-referenced with the META-ORCH-1232 auth-warm family: this is the same root disease one layer out — auth now warms correctly (`getBrands` is `getSession()`-gated, `isAuthReady` gating added), so the query *fires*, but once fired it has no settle-guarantee. The fix that was applied at the auth layer (timeout/ceiling) was **never applied at the data layer**.

**Secondary: Stripe Connect embedded pages (`ConnectOnboardingBody.web.tsx:185` + 4 siblings, MED)** — a real permanent-spinner if `loadConnectAndInitialize` hangs, but scoped to connect routes, so it explains a *subset* of freezes (operators doing payout onboarding), not the everyday post-login freeze.

**Amplifier: missing `networkMode` on the global queryClient (MED)** — turns a momentary `navigator.onLine` flap into a permanently-paused query with `isLoading` stuck true. This is the most likely *trigger* that converts vectors #1/#2/#4 from theoretical into the observed intermittent freeze.

### The single strongest statement
**Business web is missing the `withTimeout` / `Promise.race` settle-guarantee that app-mobile applies to its data fetches.** Combined with full-screen `if (isLoading) return <Spinner/>` gates on the Hub (experiences/trips) and the `online` default `networkMode`, any un-settling Supabase promise pins the screen until a manual reload — which is precisely META-ORCH-1235.

---

## "Does business web have the app-mobile timeout guards?" — NO
- `app-mobile/src/utils/withTimeout.ts` exists and is used (ConnectionsPage, OnboardingFlow, AccountSettings 45s, useForegroundRefresh 8s, deck fetch race).
- `mingla-business/src/utils/withTimeout.ts` **does not exist.**
- Business's ONLY timeout is in `AuthContext.tsx` (boot: 3s race `:285`, 7s ceiling `:82/249`). **No data-fetch query, service call, `functions.invoke`, or Stripe SDK init in business carries a timeout.**
