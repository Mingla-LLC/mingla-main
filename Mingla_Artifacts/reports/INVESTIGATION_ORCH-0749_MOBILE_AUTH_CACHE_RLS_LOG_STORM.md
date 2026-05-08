# INVESTIGATION ORCH-0749 - Mobile Auth/Cache/RLS Log Storm

Date: 2026-05-07
Owner: forensic-mingla
Scope: app-mobile auth lifecycle, React Query persistence/hydration, Supabase service/RLS failures, profile screen render storm, and integration warning classification.

## Verdict

The log dump is a cluster, not a single bug. The primary confirmed root cause is that auth-null/sign-out transitions do not consistently run the same cleanup path, while persisted React Query state can rehydrate user-scoped pending/stale queries. That lets old-user queries keep running after the app has moved to signed-out or another-user state. The downstream symptoms include `userPreferences` pending hydration `CancelledError`, blocked-users "Not authenticated" results hidden as successful empty arrays, AppsFlyer RLS failures, RevenueCat user/anonymous churn, and stale user IDs appearing after sign-out.

There are also separate confirmed defects:

- `profile-interests` uses `.single()` against `preferences`, but a missing preferences row is allowed by the canonical preferences service. This causes `Cannot coerce the result to a single JSON object`.
- `record_engagement` is being called while the Supabase request role is not authenticated. Live DB grants are correct for `authenticated`, so this should be guarded client-side rather than weakening DB permissions.
- Profile render storm is caused by a whole-store Zustand subscription in `AppStateManager` combined with frequent `tabScroll` writes.
- Several warnings are config/noise, but a few are production readiness blockers: RevenueCat products not approved in App Store Connect, AppsFlyer listener flags with no listeners, missing icon mappings, and `expo-av` SDK debt.

## Evidence Sources

- User-provided iOS Expo log from app startup, auth reload, Apple cancel, Google login, tab navigation, Profile screen, and deck fetch.
- App code:
  - `app-mobile/app/index.tsx`
  - `app-mobile/src/components/AppStateManager.tsx`
  - `app-mobile/src/hooks/useAuthSimple.ts`
  - `app-mobile/src/config/queryClient.ts`
  - `app-mobile/src/hooks/useUserPreferences.ts`
  - `app-mobile/src/hooks/usePreferencesData.ts`
  - `app-mobile/src/hooks/useFriendsQuery.ts`
  - `app-mobile/src/services/friendsService.ts`
  - `app-mobile/src/services/blockService.ts`
  - `app-mobile/src/hooks/useProfileInterests.ts`
  - `app-mobile/src/services/preferencesService.ts`
  - `app-mobile/src/services/appsFlyerService.ts`
  - `app-mobile/src/services/cardEngagementService.ts`
  - `app-mobile/src/store/appStore.ts`
  - `app-mobile/src/hooks/useTabScrollRegistry.ts`
  - `app-mobile/src/components/ProfilePage.tsx`
  - `app-mobile/src/components/ui/Icon.tsx`
- Live schema dump:
  - `/tmp/mingla_public_schema_live.sql`
- Contracts:
  - `README.md`
  - `docs/DOMAIN_ADRS.md`
  - `docs/QUERY_KEY_REGISTRY.md`
  - `docs/MUTATION_CONTRACT.md`
  - `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md`
- Verification:
  - `cd app-mobile && npx tsc --noEmit`

## Confirmed Finding 1 - Sign-Out/Auth-Null Cleanup Is Split

### Symptom

The logs show a user session, then `SIGNED_OUT`, then user-scoped queries and integrations continue to run under the old user ID:

- `friends.blocked.c727...` succeeds as `Array(0)` and also logs `Error fetching blocked users: Not authenticated`.
- `subscription.c727...`, `subscription.server-tier.c727...`, and RevenueCat requests continue after Welcome screen.
- AppsFlyer device registration repeatedly fails RLS for the old user, while a later Google user succeeds.
- `userPreferences.c727...` pending hydration repeatedly rejects with `CancelledError`.

### Code Evidence

`AppStateManager.handleSignOut()` is the complete cleanup path. It resets app UI state, logs out integrations, clears user data, sweeps AsyncStorage, clears React Query, and then calls Supabase sign-out.

`useAuthSimple` has weaker paths:

- Initial no-session branch only calls `setAuth(null)`.
- Auth listener `SIGNED_OUT` only calls `setAuth(null)` and `clearUserData()`.
- Profile-not-found handling calls `supabase.auth.signOut()` directly.
- `OnboardingFlow.handleBackToWelcome` calls `supabase.auth.signOut()` directly and explicitly notes it bypasses `handleSignOut`.
- `AccountSettings` account deletion flows call `supabase.auth.signOut().catch(() => {})` before or outside the complete cleanup path.

`authService.ts` states that direct sign-out is not allowed and the sole sign-out path should be `handleSignOut()` in `AppStateManager`. The code currently violates that contract.

### Root Cause Proof

- Where: `useAuthSimple`, `OnboardingFlow`, `AccountSettings`, and the auth-state listener.
- What: Some auth-null transitions clear only local auth/user state instead of cancelling/removing server state and persisted query state.
- Trigger: App reload, direct Supabase sign-out, profile-not-found sign-out, onboarding back-to-welcome, account deletion, auth listener receiving `SIGNED_OUT`.
- Propagation: React Query and integration callbacks still hold old user IDs while Supabase current auth is null or another user.
- Invariant violated: `README.md` "Logout clears everything", one auth instance, server state belongs in React Query with coherent ownership.
- Why now: Pending query persistence and multiple integration effects expose stale user state during cold start/reload and provider login transitions.

### Fix Contract

- Centralize all sign-out/no-session cleanup through one idempotent function.
- On any transition from authenticated user to null, cancel in-flight queries, remove user-scoped queries, clear or purge persisted React Query state, and then clear app state.
- Direct `supabase.auth.signOut()` calls must be replaced with the centralized sign-out pathway or followed by the exact same cleanup.
- Integration async callbacks must verify the current Supabase user still matches the closed-over user ID before writing.

## Confirmed Finding 2 - Pending React Query Hydration Is Persisted

### Symptom

Repeated Metro error:

`A query that was dehydrated as pending ended up rejecting. [["userPreferences","c727..."]]: Error: CancelledError`

### Code Evidence

The app uses `PersistQueryClientProvider` with an AsyncStorage persister in `app-mobile/app/index.tsx`.

The dehydrate filter excludes heavy keys and queries where `query.state.fetchStatus === 'fetching'`, but it allows lightweight queries such as preferences and does not exclude all `status === 'pending'` queries.

TanStack Query's hydration code logs this exact message when a dehydrated pending query promise later rejects. In `@tanstack/query-core/build/modern/hydration.js`, pending query state is dehydrated with a promise; when that promise rejects, the library logs the redacted production warning.

### Root Cause Proof

- Where: React Query persistence filter in `app-mobile/app/index.tsx`.
- What: A pending user-scoped preferences query is allowed into persisted dehydrated state.
- Trigger: Reload/auth transition while `['userPreferences', userId]` is pending or cancelled.
- Propagation: Hydration resumes the pending promise; cancellation/rejection is reported by TanStack.
- Invariant violated: Persisted cache must not preserve transient auth-scoped pending work across auth changes.
- Why now: Preferences are explicitly treated as lightweight and are persisted, while logout/no-session paths do not always purge persisted query state.

### Fix Contract

- Exclude `query.state.status === 'pending'` and non-idle fetch states from dehydration.
- Exclude or purge auth-scoped keys whose embedded user ID does not match the currently authenticated user.
- Treat `CancelledError`/`AbortError` as cancellation in QueryCache logging, not as production query failure/breadcrumb dump.
- On auth user mismatch or null session, remove persisted React Query state for user-owned keys.

## Confirmed Finding 3 - Blocked Users Masks Auth Failure As Success

### Symptom

The log shows both:

- `[QUERY] success friends.blocked.<userId> | dataType="Array(0)"`
- `ERROR Error fetching blocked users: Not authenticated`

### Code Evidence

`useBlockedUsers(userId, enabled)` uses query key `friendsKeys.blocked(userId ?? "")`, but its query function calls `friendsService.fetchBlockedUsers()` without passing the expected user ID.

`blockService.getBlockedUsers()` reads `supabase.auth.getUser()` at execution time. If there is no auth user, it returns `{ data: [], error: "Not authenticated" }`.

`friendsService.fetchBlockedUsers()` logs the error with `console.error` and returns `[]`, so React Query records the query as successful.

### Root Cause Proof

- Where: `friendsService.fetchBlockedUsers()` and `blockService.getBlockedUsers()`.
- What: The service uses current auth instead of the query key user, then converts an auth failure into empty data.
- Trigger: Stale user-scoped query runs after auth null/mismatch.
- Propagation: UI and QueryCache see successful empty data, while console logs an error.
- Invariant violated: No silent failures and query key ownership must match the data owner.
- Why now: Auth cleanup split lets old queries execute during signed-out state.

### Fix Contract

- Pass expected user ID through the blocked-users service path.
- If current auth is missing or does not match the query user, throw/skip as an auth-state cancellation, not a successful empty result.
- Keep `[]` only for true "authenticated user has no blocked users".

## Confirmed Finding 4 - `profile-interests` Uses `.single()` On Optional Row

### Symptom

Profile tab logs:

`[QUERY] ERROR profile-interests.<userId> | Error: Cannot coerce the result to a single JSON object`

### Code Evidence

`useProfileInterests` queries:

`preferences.select('display_intents, display_categories').eq('profile_id', targetId).single()`

`PreferencesService.getUserPreferences()` uses `.maybeSingle()` and returns `null` on missing data, and `updateUserPreferences()` uses upsert. This is the canonical preference behavior.

Live schema confirms:

- `preferences` primary key is `profile_id`, so duplicate preference rows cannot cause this error.
- Policies allow authenticated reads of display preferences and own preferences, so for an authenticated own profile this is not explained by RLS hiding duplicate data.

### Root Cause Proof

- Where: `app-mobile/src/hooks/useProfileInterests.ts`.
- What: `.single()` treats a valid missing preferences row as a thrown query error.
- Trigger: User exists but preferences row has not been created or is not visible yet.
- Propagation: QueryCache logs error and breadcrumbs dump.
- Invariant violated: Preferences source-of-truth contract uses nullable/maybe-single reads and offline/default fallback semantics.
- Why now: New provider login or migrated user can reach Profile before default preferences are present.

### Fix Contract

- Use `.maybeSingle()` and default to `{ intents: [], categories: [] }` when no preferences row exists.
- Or ensure default preferences row creation before Profile loads, then keep `.single()` only if the invariant is enforced and tested.
- Update mutation should upsert via the canonical preferences service or match its semantics.

## Confirmed Finding 5 - AppsFlyer RLS Failure Is Actor Mismatch, Not Missing Policy

### Symptom

`[AppsFlyer] Device registration failed: new row violates row-level security policy for table "appsflyer_devices"`

### Live DB Evidence

Live `appsflyer_devices` policies allow authenticated users to insert/update/select/delete their own rows where `auth.uid() = user_id`. Grants exist for `anon`, `authenticated`, and `service_role`, with RLS enforcing ownership.

### Code Evidence

`registerAppsFlyerDevice(userId)` starts an async `getAppsFlyerUID` callback and later upserts:

- `user_id: userId`
- `appsflyer_uid`
- platform/app metadata

The callback uses the closed-over `userId`, but the Supabase client's current auth may be null or a different user when the upsert executes.

The logs show repeated failures for the old `c727...` user and successful registration for later Google user `b17...`, matching an auth-timing/actor mismatch.

### Root Cause Proof

- Where: `app-mobile/src/services/appsFlyerService.ts`.
- What: Async callback writes for a closed-over user ID without verifying current auth still matches.
- Trigger: Auth reload/sign-out/sign-in while AppsFlyer UID callback is pending.
- Propagation: RLS compares current `auth.uid()` with payload `user_id` and rejects.
- Invariant violated: Client writes must be scoped to the active authenticated actor.
- Why now: App startup initializes integrations before auth has fully settled and cleanup is not centralized.

### Fix Contract

- Before upsert, read current Supabase user/session and require `currentUser.id === userId`.
- No-op if auth is missing or changed.
- Debounce duplicate device registration attempts per user/device.
- Keep RLS policies strict.

## Confirmed Finding 6 - `record_engagement` Is Called Without Authenticated Role

### Symptom

`[recordEngagement] RPC error: permission denied for function record_engagement`

### Live DB Evidence

Live `record_engagement` grants:

- `PUBLIC` revoked.
- `authenticated` granted.
- `service_role` granted.

The function body itself raises `Authentication required` if `auth.uid()` is null. The observed `permission denied for function` happens before the body, which means the request role is not `authenticated` for that RPC.

### Root Cause Proof

- Where: `cardEngagementService.fire()`.
- What: Fire-and-forget RPC runs without a valid authenticated Supabase session/role.
- Trigger: Engagement call during stale auth/cache transition or before token attachment.
- Propagation: DB rejects function execution.
- Invariant violated: Auth-required RPCs must not be called by anonymous clients.
- Why now: Same startup/auth transition lets UI interactions and analytics calls outlive session coherence.

### Fix Contract

- Guard `recordEngagement` with a current authenticated session check.
- If no session, skip and log debug-level telemetry only.
- Do not grant `record_engagement` to anon/public.

## Confirmed Finding 7 - Profile Render Storm Is Root Store Subscription Plus Scroll Writes

### Symptom

Profile tab logs `render-count` climbing from 1 to 52 while `tabScroll` updates repeat.

### Code Evidence

`AppStateManager.useAppState()` calls `useAppStore()` with no selector and destructures many fields. This subscribes root app state to the whole Zustand store.

`ProfilePage` wires `useTabScrollRegistry('profile')` into `KeyboardAwareScrollView.onScroll`.

`useTabScrollRegistry` throttles writes to about every 100ms and calls `setTabScroll(key, y)`.

`appStore.setTabScroll` always writes a new `tabScroll` object, with no no-op guard for unchanged or near-unchanged `y`.

Because the root app subscribes to the whole store, every scroll-position write can re-render `AppContent` and its child pages.

### Root Cause Proof

- Where: `AppStateManager.useAppState()` and `appStore.setTabScroll`.
- What: Whole-store subscription magnifies frequent scroll state writes into app-level re-renders.
- Trigger: Scrolling Profile.
- Propagation: `tabScroll` update -> Zustand store change -> root app state update -> ProfilePage re-render.
- Invariant violated: High-frequency UI state must not invalidate the root app tree.
- Why now: Scroll restoration state is persisted in the global store used by root auth/navigation state.

### Fix Contract

- Replace `useAppStore()` whole-store subscription with selectors for only the fields `AppStateManager` needs.
- Add no-op/threshold guard in `setTabScroll`.
- Consider moving scroll registry state out of the root global store or only committing on tab leave/momentum end.

## Warning Classification

| Log | Classification | Reason | Fix Direction |
| --- | --- | --- | --- |
| `Mixpanel disabled - token not set` | Config/noise | `EXPO_PUBLIC_MIXPANEL_TOKEN` is missing | Set token for envs where analytics should run, or suppress expected dev warning |
| `expo-av deprecated` | Real SDK debt | App imports `Audio` from `expo-av`, dependency present | Migrate audio usage to `expo-audio` before SDK removal |
| RevenueCat products `READY_TO_SUBMIT` | Production blocker for purchases | RevenueCat/App Store Connect products are not approved | Complete App Store Connect subscription/product approval |
| RevenueCat `Purchases instance already set` | Dev/reload noise with possible singleton hardening | Native SDK survives JS reload while module `_configured` resets | Guard configure against native already-configured state where SDK supports it |
| RevenueCat anonymous requests after logout | Auth-transition side effect | Logout/login effects race during auth-null transitions | Centralized auth cleanup and current-user guards |
| AppsFlyer `onDeepLinking`/`onInstallConversionDataLoaded` no listeners | Config/noise or missing feature | Listener flags are enabled without handlers | Disable listener flags or register handlers |
| Apple sign-in canceled logged as error | Instrumentation bug | User cancellation is expected but logged via `logger.error` before special handling | Treat `ERR_REQUEST_CANCELED` as info/no-op |
| CoachMark targetRef never attached | UI tour bug/noise | Dev-only warning says step target did not attach | Reattach step target or skip centered fallback for unavailable target |
| Unknown icons `list-outline`, `sunny` | Cosmetic UI bug | Icons are used but not mapped in `Icon.tsx` | Add mappings or change call sites to supported names |

## Fix Priority

1. Centralize auth-null/sign-out cleanup and purge/cancel user-scoped React Query state.
2. Harden React Query persistence against pending/auth-mismatched queries and cancellation logging.
3. Fix service ownership contracts for blocked users, AppsFlyer device registration, and record engagement.
4. Fix `profile-interests` missing-row semantics.
5. Fix profile render storm by removing root whole-store subscription and guarding scroll writes.
6. Clean warnings/config debt: RevenueCat product status, AppsFlyer listener flags, Apple cancel logging, icons, coach mark target, `expo-av`.

## Test Plan For Implementation

Required tests after implementation:

- Start app with no Supabase session and persisted cache from a prior user. Verify no old-user queries run and no old user ID appears in logs.
- Sign in as user A, navigate home/connections/profile, sign out, then sign in as user B. Verify no A-scoped query keys execute after B login.
- Force reload during a pending `userPreferences` query. Verify no TanStack pending dehydration rejection is logged.
- Run blocked-users query while signed out. Verify it is disabled/cancelled, not reported as successful empty data.
- Create or simulate a user with no `preferences` row. Profile interests should return empty arrays without query error.
- Trigger AppsFlyer device registration while signing out/in. Verify stale callback no-ops instead of RLS failure.
- Call `recordEngagement` while unauthenticated. Verify it skips before RPC.
- Scroll Profile for 10 seconds. Verify render counts do not climb in lockstep with `tabScroll` writes.

## Verification Performed

`cd app-mobile && npx tsc --noEmit` currently fails on known baseline errors unrelated to this investigation:

- `src/components/ConnectionsPage.tsx(2763,52)` - `Friend` type mismatch missing `name` and `isOnline`.
- `src/components/HomePage.tsx(246,19)` - `SessionSwitcherItem` missing `state`.
- `src/components/HomePage.tsx(249,54)` - same missing `state`.

No product code or migrations were changed during this forensic pass.

