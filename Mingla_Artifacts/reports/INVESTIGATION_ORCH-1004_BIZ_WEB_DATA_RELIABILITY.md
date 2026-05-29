# ORCH-1004 — Business web data reliability (dropdowns won't load / empty pages / multiple refreshes)

**Severity:** S1-high · **Class:** `bug` + `architecture-flaw` + `data-integrity`
**Affected Surfaces:** business-web (primary — the symptom is web-specific because web keeps the URL across a refresh and restores authed routes directly). business-iOS/Android share the same hooks and have a milder version of the race. NOT in scope: admin-web, consumer apps.
**Status:** INVESTIGATE complete — root cause proven across code + schema + live data. No code written. Awaiting steering before SPEC/IMPLEMENT.

## Symptom (operator report)

"Some parts load slowly, the dropdowns won't load completely, you have to refresh multiple times to view a page because it returns empty."

## Root cause — an auth-bootstrap race that caches empty results as success

Three proven facts combine:

### RC-1 — Auth-scoped queries gate on persisted IDs, not on auth readiness (source-proven)
- `currentBrandId` is persisted in a Zustand-persist store (`src/store/currentBrandStore.ts`, `PersistedState = Pick<…,"currentBrandId">`). On web it rehydrates **synchronously** from localStorage on first render.
- The Supabase client (`src/services/supabase.ts`: `persistSession: true`, `autoRefreshToken: true`) restores its session **asynchronously**.
- ~20 data hooks gate `enabled` on the persisted id only — e.g. `useTrips` (`enabled: brandId !== null`), `useBrandOfferingCounts`, `useAuditLog`, `useBrandCustomers`, `useAudienceList`, `useUserTemplates`, `useOrderInstallments`, `useTripOrders`, `useExperiencesByBrand`, `usePendingExperiences`, the Stripe hooks, etc. Only `useEventOrders` gates correctly: `enabled: !loading && session !== null`.
- Net: on cold load these queries **fire before the auth token is attached**.

### RC-2 — RLS returns an empty array (a SUCCESS), so retry never fires and the empty result is cached (live-probe-proven)
Read-only probe against production REST with the anon key only (no user JWT):
- `brand_team_members` → **HTTP 200 `[]`** (auth-scoped table — RLS filters all rows for anon; NOT a 401/error).
- `events` → 200 + rows, `brands` → 200 + rows (these are intentionally anon-readable for the public buyer pages).

So an auth-scoped query fired pre-auth comes back **200 + empty**. React Query treats it as a successful fetch:
- `retry: 2` (queryClient default) only fires on **errors** → never triggers for empty-success.
- `staleTime: 5 min` serves the cached empty result for 5 minutes.
- `refetchOnWindowFocus: false` → returning to the tab does not refetch.
- Only a **hard refresh** re-mounts and re-queries. If the session is attached that time, it works → "refresh multiple times."

This also explains "parts load, dropdowns don't": public data (`events`, `brands`) renders even pre-auth, while auth-scoped data (team, audiences, drafts, orders, customers, role-gated dropdowns) comes back empty.

### RC-3 — The 3s bootstrap timeout strands the session and permanently ignores the late one (source-proven, aggravating tail case)
`src/context/AuthContext.tsx` (ORCH-0887-A): `getSession()` is raced against `AUTH_BOOTSTRAP_TIMEOUT_MS = 3000`. On timeout it sets `session=null, loading=false` and `bootstrapTimedOutRef = true`, then **ignores every late passive session event** (`INITIAL_SESSION` / `TOKEN_REFRESHED` / `USER_UPDATED`) for the rest of that page load (lines 269–301). Only an explicit `SIGNED_IN`/`SIGNED_OUT` clears the gate. So on a slow cold start the real session, when it finally resolves, is discarded — the app stays anon until the user manually refreshes (and wins the <3s race). At the root route this shows the sign-in screen; on a directly-loaded authed route it shows empty auth-scoped data.

## Five-layer cross-check
- **Code:** ~20 hooks gate on brandId/accountId/eventId only; `queryClient` retries on error only; AuthContext ignores late sessions post-timeout.
- **Schema/RLS:** auth-scoped tables return empty (not error) for anon — proven by live probe.
- **Runtime:** Supabase session restores async; the 3s race + supabase-js not blocking requests on session-restore opens the pre-auth window.
- **Data:** empty array cached as success (staleTime 5 min).
- **Docs:** ORCH-0964 already observed "a single transient failure… left surfaces errored… didn't fully load" and bumped `retry 1→2` — a partial patch that cannot help, because empty-success is not an error.

## Proposed fix direction (NOT yet implemented — for steering)
1. **Gate every auth-scoped hook on session readiness**, using the proven `useEventOrders` template (`enabled: !loading && session !== null && <id> !== null`). Disabled queries already render as loading (invariant `I-DISABLED-QUERY-IS-LOADING`, ORCH-0889), so the UX becomes "loading → data" instead of "empty." Public-only hooks (`useBusinessEvents`/`usePublicEvents`/`useBrands` reading anon-readable tables) can stay as-is or be split.
2. **Refetch on auth transition:** when the session attaches (anon→authed / SIGNED_IN), invalidate auth-scoped queries so a late session repopulates without a manual refresh.
3. **Fix RC-3:** instead of permanently ignoring the late real session, apply it and invalidate queries. The original reason for ignoring it (avoid an anon→home flash + duplicate analytics) can be met without stranding the user anon.
4. Consider a small shared `useAuthScopedQuery` wrapper so the gate can't be forgotten again, plus a strict-grep gate that an auth-scoped hook must gate on session readiness.

## Open scoping questions for the operator
- **A) Scope:** fix all ~20 hooks in one sweep, or start with the auth-context late-session fix (RC-3) + the highest-traffic hooks (home/dashboard/dropdowns) and follow with the rest?
- **B) Reproduce-before-fix:** confirm live on web with a real business login + throttled network (a notify-list "sim/login" item — needs operator credentials or go-ahead) to capture the exact failing query, or proceed on the source+probe proof above (already conclusive)?
