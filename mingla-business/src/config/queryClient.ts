/**
 * queryClient — single React Query QueryClient for mingla-business (Cycle 13a).
 *
 * NEW Cycle 13a: this is the first cycle in mingla-business that fetches live
 * server data into hooks. `useCurrentBrandRole` + `useAuditLog` (per Cycle 13a
 * SPEC §4.6 + §4.12) are the inaugural consumers.
 *
 * Constitutional notes:
 *   - #5 server state in React Query, never Zustand.
 *   - #4 query keys come from per-hook factories, never hardcoded strings.
 *
 * Defaults are mobile-appropriate:
 *   - staleTime: 5 minutes — role/team/audit changes are rare.
 *   - retry: 1 — single retry on transient errors; consumer surfaces isError otherwise.
 *   - refetchOnWindowFocus: false — RN doesn't have a true "window focus" event;
 *     blur/focus on tab switch creates noise without value.
 *   - refetchOnReconnect: true — re-fetch when connectivity returns.
 *
 * Persistence: NOT wired. `@tanstack/react-query-persist-client` +
 * `@tanstack/query-async-storage-persister` are installed but unused. A future
 * cycle can layer persistence (mirror app-mobile's setup) when offline-tolerant
 * server state grows. (Historical note: Cycle 13a's brandTeamStore used to
 * persist via Zustand-persist; ORCH-1050 demoted it to in-memory optimistic-
 * only and moved canonical state into public.brand_invitations + React Query.)
 */

import { QueryClient } from "@tanstack/react-query";

import { isPermissionDeniedError } from "../utils/edgeFunctionErrors";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * #1863 §4.5.2 — the exact behavioural equivalent of the old `retry: 2`.
 *
 * `node_modules/@tanstack/query-core/build/modern/retryer.js:88-95` calls
 * `retry(failureCount, error)` with the PRE-INCREMENT, 0-based counter and
 * increments afterwards, so `failureCount < 2` yields attempts at 0 and 1 and
 * stops at 2 — three attempts total — with `retryDelay(0)=1000ms` and
 * `retryDelay(1)=2000ms`. That reproduces the cadence measured on device
 * (1.27-1.37s then 2.38-2.47s) exactly.
 *
 * `failureCount <= 2` would silently add a FOURTH attempt to every query in the
 * app. Test T-A2 counts real `queryFn` invocations and goes red if it does.
 */
const DEFAULT_QUERY_RETRY_COUNT = 2;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: FIVE_MINUTES_MS,
      // META-ORCH-1235: an `online` flap (navigator.onLine === false) must not
      // leave a never-fetched query in fetchStatus "paused" with isLoading stuck
      // true and no attempt/error. "always" forces the query to run regardless of
      // navigator.onLine; combined with src/utils/withTimeout (service layer), a
      // genuinely-dead network surfaces a bounded error+retry instead of an
      // indefinite pause-stuck spinner.
      networkMode: "always",
      // ORCH-0964: bumped 1 -> 2 with capped exponential backoff. A single
      // transient failure on the brand/identity fetch left surfaces errored
      // (empty state behind a lifted splash = "didn't fully load"); the extra
      // retry lets flaky-network loads recover on their own.
      //
      // #1863 §4.5.2 — a PERMISSION DENIAL IS TERMINAL and is never retried.
      // GLOBAL, not two per-hook overrides: a 403 is terminal for every query
      // in this app, and two per-hook overrides is exactly the shape that left
      // `brand-stripe-balances` bleeding 606 denials while its twin was known
      // and fixed. The global default also covers the third hook nobody has
      // written yet. Everything that is NOT a permission denial — 5xx, timeout,
      // malformed payload, genuine network failure — retries exactly as before
      // (SC-6, SC-8). Mutation defaults (`retry: 0`) are untouched.
      retry: (failureCount, error) =>
        isPermissionDeniedError(error)
          ? false
          : failureCount < DEFAULT_QUERY_RETRY_COUNT,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
