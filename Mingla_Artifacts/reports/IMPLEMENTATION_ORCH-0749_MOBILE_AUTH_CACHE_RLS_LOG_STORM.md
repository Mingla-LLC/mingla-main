# Implementation Report: ORCH-0749 Mobile Auth/Cache/RLS Log Storm

Date: 2026-05-07
Status: implemented, partially verified

## Summary

Implemented the bounded mobile stability package from `SPEC_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md`.

The app now has shared auth/cache safety helpers, blocks pending/auth-mismatched queries from React Query persistence, routes auth-null/sign-out/user-switch paths through private cleanup, stops blocked-users auth mismatch from becoming successful empty data, guards AppsFlyer and engagement writes by current auth, fixes profile interests missing-row behavior, reduces Profile root render invalidation, and adds an ORCH-0749 repo-running regression gate.

## Files Changed

- `app-mobile/app/index.tsx`
- `app-mobile/package.json`
- `app-mobile/scripts/ci/orch-0749-regression-check.mjs`
- `app-mobile/src/components/AppStateManager.tsx`
- `app-mobile/src/components/OnboardingFlow.tsx`
- `app-mobile/src/components/profile/AccountSettings.tsx`
- `app-mobile/src/components/ui/Icon.tsx`
- `app-mobile/src/config/queryClient.ts`
- `app-mobile/src/hooks/useAuthSimple.ts`
- `app-mobile/src/hooks/useFriendsQuery.ts`
- `app-mobile/src/hooks/useProfileInterests.ts`
- `app-mobile/src/services/appsFlyerService.ts`
- `app-mobile/src/services/blockService.ts`
- `app-mobile/src/services/cardEngagementService.ts`
- `app-mobile/src/services/friendsService.ts`
- `app-mobile/src/store/appStore.ts`
- `app-mobile/src/utils/authCleanup.ts`
- `app-mobile/src/utils/queryPersistence.ts`

Unrelated pre-existing worktree changes were present in `Mingla_Artifacts/`, `supabase/functions/run-place-intelligence-trial/index.ts`, `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`, and `scripts/docs/`. They were not touched for ORCH-0749.

## Spec Traceability

| Spec Area | Implementation |
| --- | --- |
| Auth cleanup and cache safety | Added `authCleanup.ts`; wired initial no-session, `SIGNED_OUT`, user-switch, AppStateManager sign-out, Onboarding back-to-welcome, and account deletion follow-up paths. |
| React Query persistence | Added `queryPersistence.ts`; `app/index.tsx` now uses `shouldDehydrateMinglaQuery()` with current auth user. |
| Cancellation logging | `queryClient.ts` now treats `CancelledError`, `AbortError`, and `AuthStateCancelledError` as non-error cancellation. |
| Blocked users ownership | `useBlockedUsers()` passes expected user ID; services verify current auth and throw `AuthStateCancelledError` instead of returning false empty data. |
| AppsFlyer stale callback | `registerAppsFlyerDevice()` rechecks current Supabase user before upsert and dedupes registered device keys. |
| recordEngagement auth guard | Engagement RPC now checks current session before calling `record_engagement`. |
| Profile interests | Query uses `.maybeSingle()`; update uses canonical preferences upsert. |
| Profile render storm | AppStateManager no longer subscribes to the whole Zustand store; `setTabScroll` has no-op/threshold guard. |
| Warning cleanup | Apple cancel returns before `logger.error`; AppsFlyer listener flags disabled; `list-outline`, `sunny`, and `partly-sunny` icon aliases added. |
| Regression coverage | Added `npm run test:orch-0749`. |

## Old To New Receipts

- Old: pending `userPreferences` query could be dehydrated and replay as a rejecting pending promise.
  New: pending or non-idle queries return `false` from `shouldDehydrateMinglaQuery()`.

- Old: user-scoped persisted queries could survive auth-null/user-switch.
  New: user ID is extracted from known query key families and auth-mismatched keys are rejected/removed.

- Old: `SIGNED_OUT` and initial no-session only cleared partial local auth state.
  New: they call `performPrivateAuthCleanup()`, which clears store private data, React Query memory, persisted React Query cache, private AsyncStorage keys, realtime queue, and SDK identity where appropriate.

- Old: blocked-users auth failure logged an error and returned `[]`, so React Query recorded success.
  New: auth mismatch throws `AuthStateCancelledError`, which is treated as cancellation, not successful empty data.

- Old: AppsFlyer callback could write `user_id` for a stale closed-over user.
  New: callback rechecks current Supabase auth immediately before upsert.

- Old: unauthenticated engagement RPC reached Postgres and failed with function permission denied.
  New: unauthenticated callers skip before RPC.

- Old: profile interests used `.single()` against an optional preferences row.
  New: missing row returns empty arrays and updates use upsert semantics.

- Old: root app state subscribed to the whole Zustand store and scroll writes invalidated root.
  New: AppStateManager uses selectors and tab scroll ignores equivalent writes.

## Tests And Gates

Added:

- `app-mobile/scripts/ci/orch-0749-regression-check.mjs`
- `app-mobile/package.json` script: `npm run test:orch-0749`

The gate covers the spec's T1-T20 matrix by checking the concrete structural safeguards added in this implementation:

- pending/non-idle query dehydration exclusion
- user-scoped query key auth matching
- cancellation error classification
- shared persistence predicate usage
- private auth cleanup clearing persisted query cache
- auth listener cleanup paths
- Apple cancel before error logging
- direct sign-out bypass removal
- blocked-users auth mismatch behavior
- profile interests `.maybeSingle()`/upsert behavior
- AppsFlyer stale callback guard
- recordEngagement session guard
- AppStateManager selector usage
- `tabScroll` no-op guard
- icon alias mappings

## Verification Commands

### `npm run test:orch-0749`

Result: PASS.

All ORCH-0749 regression checks passed.

### `npx tsc --noEmit`

Result: FAIL due to known baseline TypeScript errors only:

- `src/components/ConnectionsPage.tsx(2763,52)` - `Friend` type mismatch missing `name` and `isOnline`.
- `src/components/HomePage.tsx(246,19)` - `SessionSwitcherItem` missing `state`.
- `src/components/HomePage.tsx(249,54)` - same missing `state`.

No new TypeScript errors from ORCH-0749 changes were present after fixing one implementation overload issue in `blockService.getBlockedUsers()`.

### `npm run lint`

Result: FAIL due to existing repo lint errors.

Quiet error-only lint output:

- `src/components/OnboardingFlow.tsx` - four `react/no-unescaped-entities` errors.
- `src/components/PopularityIndicators.tsx` - conditional `useAnimatedStyle` hook error.
- `src/components/PreferencesSheet/PreferencesSections.tsx` - one `react/no-unescaped-entities` error.
- `src/components/ShuffleButton.tsx` - one `react/no-unescaped-entities` error.
- `src/types/index.ts` - duplicate `CollaborationSession` export errors.

These are outside ORCH-0749 scope and existed independently of the implemented auth/cache changes.

### `git diff --check`

Result: PASS.

## Remaining Risks

- Runtime device QA is still required for sign-out, reload, provider login, account deletion, and Profile scroll behavior.
- The new regression gate is static/structural because `app-mobile` does not currently have Jest/Vitest or a React Native unit-test harness. It is repo-running and blocks the known dangerous patterns, but a future mobile test harness should convert key service/helper checks to executable unit tests.
- `performPrivateAuthCleanup()` is intentionally broad for auth-null cleanup. Tester should specifically verify that allowed non-private device settings remain intact after sign-out.

## Manual Tester Gates

Tester should run these on device/simulator:

1. Start with prior logged-in cache, remove session, reload app. Confirm no old user ID query/log storm.
2. Sign in user A, navigate Home/Connections/Profile, sign out, sign in user B. Confirm user A query keys and AppsFlyer writes do not continue.
3. Trigger Apple sign-in cancel. Confirm no error breadcrumb dump.
4. Navigate Profile and scroll for 10 seconds. Confirm render count no longer climbs in lockstep with scroll writes.
5. Use a user with no `preferences` row and open Profile. Confirm profile interests do not error.

## Status

implemented, partially verified

Independent `$tester-mingla` verification is required before close.

