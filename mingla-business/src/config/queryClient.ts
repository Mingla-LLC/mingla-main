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
 * Persistence: NOT wired in 13a. `@tanstack/react-query-persist-client` +
 * `@tanstack/query-async-storage-persister` are installed but unused. A future
 * cycle can layer persistence (mirror app-mobile's setup) when offline-tolerant
 * server state grows. Cycle 13a's persisted client cache lives in
 * `useBrandTeamStore` (Zustand-persist) only.
 */

import { QueryClient } from "@tanstack/react-query";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: FIVE_MINUTES_MS,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
