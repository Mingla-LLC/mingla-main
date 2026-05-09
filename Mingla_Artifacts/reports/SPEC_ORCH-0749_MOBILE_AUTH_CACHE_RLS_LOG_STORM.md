# Spec: ORCH-0749 Mobile Auth/Cache/RLS Log Storm

> Date: 2026-05-07
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md`
> Root cause: split auth-null cleanup plus persisted user-scoped pending/stale React Query work
> Status: ready for implementation

## 1. Layman Summary

When the app signs out, reloads, or switches users, old private user work can keep running. That makes the app look haunted: old user IDs keep appearing, some requests say "success" while also saying "not authenticated", AppsFlyer gets blocked by RLS, RevenueCat flips between user and anonymous state, and Metro prints repeated pending-query errors.

This spec makes auth transitions boring and predictable. When the app has no user, all private work for the old user must stop. When the app switches users, old user data must not leak into the new user's query/cache/integration work. The fix must also include automated regression tests that run in the repo so this class of bug cannot quietly return.

## 2. User Story

As a Mingla user, I want sign-out, app reload, and account switching to fully reset private app state, so that I never see stale data, broken empty states, auth errors, or analytics/device writes from a previous account.

## 3. Scope

### In Scope

- Mobile app auth-null/sign-out/user-switch cleanup.
- React Query persistence and hydration filtering.
- User-scoped query removal/cancellation for auth transitions.
- Blocked-users service/hook ownership contract.
- AppsFlyer stale async registration guard.
- `recordEngagement` unauthenticated guard.
- `profile-interests` missing preferences row behavior.
- Profile render storm caused by root whole-store subscription plus `tabScroll`.
- Low-risk warning cleanup for Apple cancel logging, missing icon mappings, and AppsFlyer listener flags.
- Repo-running automated regression tests for every behavior change.

### Non-Goals

- Do not weaken Supabase RLS or grant anon/public access to `record_engagement`.
- Do not remove React Query persistence wholesale unless implementation proves a smaller purge/filter helper cannot be made safe.
- Do not convert auth failures into successful empty arrays.
- Do not refactor navigation, deck generation, RevenueCat purchase UI, onboarding UX, or unrelated query domains.
- Do not migrate all `expo-av` usage in this implementation. Track it separately as SDK debt unless it blocks this fix.
- Do not fix RevenueCat App Store Connect product approval in code. That is an external launch operation.

### Assumptions

- `app-mobile` has no Jest/Vitest test script today. Implementation must add a small repo-running regression harness or CI scripts as part of this fix.
- Existing TypeScript baseline has unrelated failures in `ConnectionsPage.tsx` and `HomePage.tsx`; implementation must not add new TypeScript failures and must report baseline separately.
- Live DB RLS/grants from investigation are authoritative enough for this spec. No DB policy relaxation is needed.

### Dependencies

- `README.md` Architecture Constitution.
- `docs/IMPLEMENTATION_GATES.md`.
- `docs/MUTATION_CONTRACT.md`.
- `docs/QUERY_KEY_REGISTRY.md`.
- `docs/DOMAIN_ADRS.md` ADR-001, ADR-005, ADR-006.

## 4. Evidence Trace

| Requirement | Comes From | Confidence |
| --- | --- | --- |
| Centralized auth cleanup | Investigation Finding 1; `README.md` #6 and #11 | Confirmed |
| Pending query dehydration filter | Investigation Finding 2; TanStack hydration behavior | Confirmed |
| Blocked-users expected-user ownership | Investigation Finding 3; ADR-001 | Confirmed |
| Profile interests missing row default | Investigation Finding 4; ADR-005; live preferences PK | Confirmed |
| AppsFlyer current-user guard | Investigation Finding 5; live RLS policies | Confirmed |
| `recordEngagement` auth guard | Investigation Finding 6; live function grants | Confirmed |
| Profile render storm fix | Investigation Finding 7; Zustand whole-store subscription | Confirmed |
| Automated tests required | User directive; skill hardening; implementation gates | Binding |

## 5. Success Criteria

1. Starting the app with no Supabase session and a persisted cache from a prior user does not execute prior-user query functions, SDK login calls, or DB writes.
2. Signing out user A and signing in as user B removes or invalidates user A-scoped React Query state before user B's app work starts.
3. A pending `['userPreferences', userId]` query is never dehydrated into AsyncStorage and replayed as a rejecting pending promise.
4. `CancelledError` and `AbortError` from deliberate query cancellation do not trigger production query error breadcrumbs or Metro error spam.
5. Blocked-users queries distinguish "authenticated user has no blocked users" from "query ran while unauthenticated or wrong actor".
6. `profile-interests` returns empty interests/categories when a preferences row is absent instead of throwing `Cannot coerce the result to a single JSON object`.
7. AppsFlyer device registration no-ops if its async callback resolves after auth changed or disappeared.
8. `recordEngagement` does not call the RPC when no authenticated Supabase session exists.
9. Scrolling Profile no longer forces root app re-renders in lockstep with `tabScroll`.
10. Apple auth cancellation is logged as expected user cancellation, not as an app error.
11. Missing icon warnings for `list-outline` and `sunny` are removed by supported mappings or call-site changes.
12. Repo-running automated tests cover the new behavior and would catch the original regression.

## 6. Invariants

### Must Preserve

| Invariant | Enforcement In This Spec | Verification |
| --- | --- | --- |
| Logout clears everything | One idempotent private-state cleanup path for auth-null/sign-out/user-switch | Auth transition regression tests |
| One auth instance | Do not add `useAuthSimple()` outside root AppStateManager | Static check/review |
| One owner per truth | React Query owns server state; Zustand only persisted UI/profile contract | Code review and tests |
| Server state stays server-side unless documented | Persist only safe settled cache; remove auth-mismatched private queries | Persistence tests |
| No silent failures | Auth mismatch is skipped/cancelled/typed, not fake success | Service tests |
| One key per entity | Reuse documented query keys/factories; do not invent alternate friends/preferences keys | Static check/review |
| Subtract before adding | Remove/harden direct sign-out bypasses instead of adding parallel cleanup layers | Code review |

### New Invariants

| Invariant | Owner | Enforcement | Verification |
| --- | --- | --- | --- |
| Pending queries are not persisted | React Query persistence layer | Dehydrate filter helper | Regression test |
| User-scoped persisted cache must match current auth user | Auth/cache cleanup helper | Purge/remove mismatched keys on auth-null/user-switch | Regression test |
| Async integration writes must verify current actor before private DB writes | Integration services | Current Supabase user check immediately before write | AppsFlyer test |

## 7. Database / RLS / Migration

None.

Do not add migrations for this fix. The investigation proved:

- `appsflyer_devices` policies already enforce `auth.uid() = user_id`.
- `record_engagement` already grants execution to `authenticated` and revokes `PUBLIC`.
- `preferences.profile_id` is a primary key, so duplicate preferences rows are not the profile-interests failure mode.

Rollback: no DB rollback required.

## 8. Edge Functions / RPCs / Webhooks

### `record_engagement`

- **Path:** Supabase RPC called from `app-mobile/src/services/cardEngagementService.ts`.
- **Auth:** Must remain authenticated only. Do not grant anon/public.
- **Spec:** Client must check current Supabase session before calling RPC. If no session or no user, skip the RPC and log at debug/dev level only.
- **Error responses:** Authenticated RPC errors may still warn because they represent real server/write failures.
- **Deploy notes:** No edge deploy needed.

All other edge functions/RPCs/webhooks: none.

## 9. Service Layer

### Auth Cleanup Helper

- **Target paths:** `app-mobile/src/config/queryClient.ts`, `app-mobile/src/components/AppStateManager.tsx`, `app-mobile/src/hooks/useAuthSimple.ts`, and a new helper module if needed, such as `app-mobile/src/utils/authCleanup.ts`.
- **Contract:** Expose one idempotent cleanup function for private user state. It must be safe to call multiple times from sign-out, auth listener `SIGNED_OUT`, initial no-session startup, and direct bypass remediation.
- **Required behavior:**
  - Cancel in-flight queries before clearing/removing.
  - Remove user-scoped query families for the previous user.
  - Clear/purge persisted React Query state for private/user-scoped keys.
  - Clear Zustand private state through existing store cleanup.
  - Clear private AsyncStorage entries using the existing sweep rules, but preserve allowed non-private app/device keys.
  - Clear realtime queues/channels where currently handled by full sign-out.
  - Call integration logout/no-op guards without blocking user-visible navigation.
- **Error contract:** Cleanup failures must be logged; non-critical SDK cleanup must not block visible sign-out.
- **Non-goal:** Do not create a second auth source or new component-level `useAuthSimple()`.

### `friendsService.fetchBlockedUsers`

- **Path:** `app-mobile/src/services/friendsService.ts`.
- **Signature:** Must accept expected user ID or route through a service result that includes actor state.
- **Current behavior:** Calls `blockService.getBlockedUsers()` without expected user ID and returns `[]` on `Not authenticated`.
- **Required behavior:** If Supabase current user is missing or does not match expected query user, return/throw a typed auth-state cancellation result. Do not log this as "Error fetching blocked users" and do not return `[]` as success.
- **True empty behavior:** Only return `[]` when an authenticated matching user has no blocked rows.

### `blockService.getBlockedUsers`

- **Path:** `app-mobile/src/services/blockService.ts`.
- **Signature:** Accept expected user ID or expose a checked variant.
- **Required behavior:** Verify `supabase.auth.getUser()` returns a user whose ID matches the expected query key user before querying `blocked_users`.
- **Error contract:** Auth mismatch is not a server failure; it must be observable to the hook as disabled/cancelled/stale actor.

### `registerAppsFlyerDevice`

- **Path:** `app-mobile/src/services/appsFlyerService.ts`.
- **Required behavior:** In the async AppsFlyer UID callback, immediately before Supabase upsert, read current Supabase user/session and require it matches the closed-over `userId`. If not, no-op.
- **Duplicate prevention:** Avoid repeated upsert attempts for the same `(userId, appsflyer_uid)` during one app session where practical.
- **Error contract:** Real RLS/write failures still warn once with enough context, but expected stale callback no-ops should be debug-level/no-op.

### `recordEngagement`

- **Path:** `app-mobile/src/services/cardEngagementService.ts`.
- **Required behavior:** Check current session/user before `supabase.rpc('record_engagement', ...)`.
- **Unauthenticated behavior:** Return without RPC. No warning/error breadcrumb.
- **Authenticated RPC failure:** Continue warning because that indicates real backend failure.

### Profile Interests

- **Path:** `app-mobile/src/hooks/useProfileInterests.ts`.
- **Required behavior:** Replace `.single()` with `.maybeSingle()` and default to empty `display_intents`/`display_categories` when no row exists.
- **Mutation behavior:** Updates must use upsert semantics or the canonical `PreferencesService.updateUserPreferences()` so a user without a preferences row can save profile interests.
- **Error contract:** DB/network/RLS errors still throw; missing row does not.

## 10. Hook / State / Cache Layer

### React Query Persistence Filter

- **Path:** `app-mobile/app/index.tsx`, or extracted helper such as `app-mobile/src/utils/queryPersistence.ts`.
- **Current behavior:** Excludes queries where `fetchStatus === 'fetching'`, but allows pending lightweight queries such as `['userPreferences', userId]`.
- **Required behavior:**
  - Do not dehydrate `query.state.status === 'pending'`.
  - Do not dehydrate queries with non-idle fetch state.
  - Do not dehydrate auth/user-scoped keys if the user ID in the key is absent or mismatched.
  - Keep existing heavy-key exclusions.
  - Prefer extracting predicate logic into a pure helper so it can be regression-tested without loading the whole RN app.

### Query Error Logging

- **Path:** `app-mobile/src/config/queryClient.ts`.
- **Current behavior:** QueryCache logs every error and dumps breadcrumbs.
- **Required behavior:** If error is `CancelledError`, `AbortError`, or a TanStack cancellation from deliberate cleanup, skip error-level logging and breadcrumbs. Use dev debug logging only if useful.
- **Non-goal:** Do not suppress real auth/RLS/network failures.

### `useBlockedUsers`

- **Path:** `app-mobile/src/hooks/useFriendsQuery.ts`.
- **Query key:** Continue `friendsKeys.blocked(userId)`.
- **Required behavior:** Query function passes the expected `userId` into the service. If no user ID, query remains disabled. If service reports stale actor/auth mismatch, query should cancel/skip or throw a typed non-noisy cancellation, not cache `[]`.
- **Retry:** Do not retry auth-mismatch cancellation as a network failure.

### Auth State Listener

- **Path:** `app-mobile/src/hooks/useAuthSimple.ts`.
- **Required behavior:** `SIGNED_OUT` and initial no-session state must invoke or delegate to the same private cleanup contract used by manual sign-out. Avoid loops by making the cleanup idempotent and separating local cleanup from the final `supabase.auth.signOut()` call.
- **Direct bypasses:** Replace direct `supabase.auth.signOut()` in profile-not-found handling or have it call the cleanup wrapper. Do the same for onboarding and account deletion paths identified in the investigation.

### `AppStateManager`

- **Path:** `app-mobile/src/components/AppStateManager.tsx`.
- **Current behavior:** `useAppStore()` with no selector subscribes root app state to the entire Zustand store.
- **Required behavior:** Replace whole-store subscription with selectors for only fields needed by AppStateManager. Use shallow equality where appropriate.
- **Sign-out handler:** Continue to own the canonical user-initiated sign-out path, but share cleanup logic with auth listener/no-session cases.

### `appStore.setTabScroll`

- **Path:** `app-mobile/src/store/appStore.ts`.
- **Required behavior:** Add no-op guard when a scroll write would not materially change the stored value. Use a threshold appropriate for scroll restoration, such as integer equality or a small pixel delta.
- **Optional:** If implementation proves a better bounded fix, move high-frequency scroll registry state outside the root-invalidating store and only commit on navigation/tab leave.

## 11. Component / Screen Layer

### Account Deletion / Account Settings

- **Path:** `app-mobile/src/components/profile/AccountSettings.tsx`.
- **Required behavior:** Remove direct `supabase.auth.signOut().catch(() => {})` bypasses or route them through the centralized cleanup/sign-out contract.
- **Failure behavior:** Do not add silent catches for state-changing operations.

### Onboarding Back To Welcome

- **Path:** `app-mobile/src/components/OnboardingFlow.tsx`.
- **Required behavior:** Replace direct Supabase sign-out bypass with shared cleanup/sign-out path or an explicit auth-null cleanup call before sign-out.

### Apple Sign-In Cancellation

- **Path:** `app-mobile/src/hooks/useAuthSimple.ts` and/or `app-mobile/src/utils/logger.ts`.
- **Required behavior:** User cancellation code `ERR_REQUEST_CANCELED` must be treated as expected cancellation before `logger.error()` or `console.error()` is called.
- **User state:** No auth state change should be triggered by a user-cancelled Apple attempt.

### Icons

- **Paths:** `app-mobile/src/components/ui/Icon.tsx`, `app-mobile/src/components/CuratedExperienceSwipeCard.tsx`, `app-mobile/src/components/WeatherSection.tsx` or exact call sites found by implementation.
- **Required behavior:** `list-outline` and `sunny` must either be supported mappings or call sites must use supported names such as existing `sunny-outline`.

### AppsFlyer Listener Flags

- **Path:** `app-mobile/src/services/appsFlyerService.ts`.
- **Required behavior:** Either register handlers for enabled AppsFlyer deep link/conversion listeners or disable listener flags if Mingla does not consume those events yet.
- **Non-goal:** Do not invent attribution product behavior. If handlers are added, they may be logging-only unless product routing already exists.

## 12. Business / Admin / Public Parity

- Business app changes: none.
- Admin changes: none.
- Public/web changes: none.
- Operational dependency: RevenueCat products in App Store Connect remain external launch blockers for purchases. This spec does not close that blocker.

## 13. Realtime / Notifications / Analytics

- Realtime: cleanup must preserve existing channel/queue clearing behavior from full sign-out. Do not add new realtime behavior.
- Notifications: OneSignal login/logout should keep current behavior but must not run with stale user IDs after cleanup/user switch.
- Analytics:
  - AppsFlyer stale actor writes must no-op.
  - Mixpanel disabled warning remains env config unless implementor chooses low-risk dev-noise suppression.
  - RevenueCat purchase/offering dashboard warnings remain external config, not app-code success criteria.

## 14. Implementation Order

1. Add the test harness/gates first enough to encode current failing behavior. Because `app-mobile` has no Jest/Vitest script, implementor must add a minimal repo-running test path. Acceptable approaches:
   - Add focused CI shell/Node scripts under `app-mobile/scripts/ci/` for static and pure-helper regression tests; or
   - Add a small test runner dependency such as Vitest only if needed and scoped to pure modules with RN/Supabase mocks.
2. Extract pure helpers where needed for testability:
   - Query dehydration predicate/user-scoped key matching.
   - Cancellation-error classifier.
   - Auth actor match helper.
3. Implement React Query persistence/hydration filters and cancellation logging.
4. Implement centralized auth-null/private-state cleanup and route all sign-out/no-session/direct bypass paths through it.
5. Harden blocked-users expected-user contract.
6. Harden AppsFlyer and record-engagement auth guards.
7. Fix `profile-interests` missing-row and upsert semantics.
8. Fix root whole-store subscription and `tabScroll` no-op guard.
9. Apply low-risk warning cleanup: Apple cancel logging, icons, AppsFlyer listener flags.
10. Run focused regression tests, lint, and `npx tsc --noEmit`; document baseline TypeScript failures separately.
11. Write implementation report under `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md`.

## 15. Test Matrix

| ID | Scenario | Input/Setup | Expected | Layer | Verification |
| --- | --- | --- | --- | --- | --- |
| T1 | Pending preferences query dehydration | Mock query with key `['userPreferences','user-a']`, `status: 'pending'` | Dehydrate predicate returns false | Cache helper | Automated repo test |
| T2 | Fetching/non-idle query dehydration | Mock query with non-idle fetch state | Dehydrate predicate returns false | Cache helper | Automated repo test |
| T3 | Settled matching-user lightweight query | Mock current user `user-a`, settled `['userPreferences','user-a']` if persistence is allowed | Predicate behavior matches documented contract | Cache helper | Automated repo test |
| T4 | Mismatched auth-scoped query | Current user `user-b`, query key embeds `user-a` | Query is not dehydrated and is removable on cleanup | Cache helper | Automated repo test |
| T5 | Auth-null startup with old persisted user | No current user, prior cache contains user A keys | User A keys removed/not executed | Auth/cache cleanup | Automated test or CI script with mocked queryClient |
| T6 | User switch A -> B | Previous user A queries exist, current user B signs in | A queries cancelled/removed before B work | Auth/cache cleanup | Automated test with mocked queryClient |
| T7 | Cancelled query logging | `CancelledError`/`AbortError` passed to classifier | No error-level QueryCache breadcrumb path | Query logging | Automated test |
| T8 | Blocked users wrong actor | Query key user A, Supabase current user null/B | Does not cache `[]`; reports stale actor/cancelled state | Service/hook | Automated service test with mocked Supabase |
| T9 | Blocked users true empty | Query key user A, current user A, DB returns no rows | Returns `[]` as real empty success | Service | Automated service test |
| T10 | Profile interests missing row | Preferences query returns no row | Hook/service result defaults to empty arrays, no thrown single-row error | Preferences hook/service | Automated pure/service test or mocked hook test |
| T11 | Profile interests save without row | No preferences row, update interests | Upsert creates/updates row via canonical contract | Preferences service | Automated service mock test |
| T12 | AppsFlyer stale callback | `registerAppsFlyerDevice('user-a')`, callback resolves when current user is null/B | Supabase upsert is not called | Integration service | Automated mock test |
| T13 | AppsFlyer matching actor | Callback resolves while current user is A | Upsert called with user A payload | Integration service | Automated mock test |
| T14 | recordEngagement unauthenticated | No session/current user | `supabase.rpc` is not called | Engagement service | Automated mock test |
| T15 | recordEngagement authenticated | Current user exists | RPC called with existing payload shape | Engagement service | Automated mock test |
| T16 | Profile scroll no-op | Repeated `setTabScroll('profile', sameY)` | Store state object not rewritten/root subscriber not notified | Zustand store | Automated store test or CI script |
| T17 | Root store subscription guard | `AppStateManager` no longer uses unselected `useAppStore()` | Whole-store subscription pattern absent | Static invariant | CI shell gate |
| T18 | Direct sign-out bypass guard | Direct `supabase.auth.signOut()` no longer appears in identified bypass files except within approved auth wrapper | No bypasses | Static invariant | CI shell gate |
| T19 | Apple cancel logging | Simulated `ERR_REQUEST_CANCELED` | No `logger.error`/breadcrumb dump | Auth logging | Automated helper test or static plus manual |
| T20 | Icon warnings | `list-outline` and `sunny` call sites | Supported icon names/mappings exist | UI static | CI shell gate or lint/static test |

If a listed automated test cannot be implemented without a full RN runtime, the implementor must document why and replace only that row with a precise tester manual gate. Auth/cache/RLS tests T1-T15 must not be manual-only unless technically impossible.

## 16. Regression Prevention

- **Structural safeguard:** Extract auth/cache/persistence decisions into pure helpers rather than embedding them only inside React components.
- **Static safeguard:** Add CI script(s) that fail on reintroduced direct sign-out bypasses and root whole-store subscription in `AppStateManager`.
- **Behavioral tests:** Add repo-running tests for query persistence filtering, auth actor matching, blocked-users semantics, AppsFlyer guard, recordEngagement guard, and profile interests missing-row semantics.
- **Documentation:** Implementation report must list each new test and the original log symptom it protects against.
- **Artifacts:** Tester must verify the tests exist and run before PASS.

## 17. Rollback And Deploy Safety

- **Migration order:** None.
- **Edge deploy:** None.
- **Mobile OTA vs native build:** Most changes are JS/TS and can ship OTA if no native dependency is added. If implementation adds a test-only devDependency, no native build is required. If implementation adds runtime packages, reassess.
- **Business/admin web deploy:** None.
- **Env vars/secrets:** None.
- **Partial rollback risk:** Rolling back only service guards while leaving persistence cleanup may reintroduce log storm. Treat this as one mobile release unit.
- **External blockers:** RevenueCat products still require App Store Connect approval before production purchase readiness.

## 18. Common Mistakes

1. Treating `Not authenticated` blocked-users as a harmless empty list. That hides the bug.
2. Clearing Zustand while leaving persisted React Query private data behind.
3. Filtering only `fetchStatus === 'fetching'` and forgetting `status === 'pending'`.
4. Adding a second auth owner instead of sharing an idempotent cleanup helper.
5. Weakening RLS or grants to fix client stale actor bugs.
6. Logging user-cancelled Apple auth as an app failure.
7. Fixing Profile render count by deleting render logs instead of removing the root invalidation cause.
8. Adding manual QA notes instead of repo-running regression tests.

## 19. Handoff To Implementor

Implement ORCH-0749 as one bounded mobile stability package. Start by adding the regression harness/gates, then extract testable helpers for query persistence and auth actor checks, then centralize cleanup and route all auth-null/sign-out paths through it. Do not touch DB policies, RevenueCat purchase configuration, or unrelated deck/navigation flows. The implementation is not complete until repo-running tests cover the original regression class and the report maps each test to the fixed behavior.

