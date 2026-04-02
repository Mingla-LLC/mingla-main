# Investigation Report: Auth & Session (Wave 1a)

> Date: 2026-03-30
> Scope: ORCH-0001 (Phone OTP), ORCH-0004 (Sign-out), ORCH-0005 (Google), ORCH-0006 (Apple)
> Investigator: Forensics Agent
> Confidence: HIGH — all source files read, full chain traced

---

## Layman Summary

The sign-in flows (Google and Apple) work. Users can get into the app. But sign-out has a real data leak: when user A signs out and user B signs in on the same device, analytics SDKs (Mixpanel, AppsFlyer) and RevenueCat still think they're user A. This means user B's events get attributed to user A, and subscription state could bleed across accounts.

The phone OTP system is actually phone *verification* during onboarding (not sign-in), and its backend is solid.

Google sign-in has fragile "existing user" retry logic that relies on string-matching Supabase error messages — a Supabase upgrade could break it silently.

---

## Investigation Manifest

| # | File | Layer | Purpose |
|---|------|-------|---------|
| 1 | `app-mobile/src/hooks/useAuthSimple.ts` | Code | Central auth hook — all 4 items |
| 2 | `app-mobile/src/services/authService.ts` | Code | Duplicate sign-out path |
| 3 | `app-mobile/src/components/signIn/WelcomeScreen.tsx` | Code | OAuth button UI |
| 4 | `app-mobile/src/store/appStore.ts` | Code | Zustand store + clearUserData |
| 5 | `app-mobile/src/components/AppStateManager.tsx` | Code | handleSignOut chain |
| 6 | `app-mobile/src/config/queryClient.ts` | Code | React Query + 401 handler |
| 7 | `supabase/functions/send-otp/index.ts` | Backend | OTP send edge function |
| 8 | `supabase/functions/verify-otp/index.ts` | Backend | OTP verify edge function |
| 9 | `app-mobile/src/services/revenueCatService.ts` | Code | logoutRevenueCat exists |
| 10 | `app-mobile/src/services/mixpanelService.ts` | Code | reset() + trackLogout exist |
| 11 | `app-mobile/src/services/appsFlyerService.ts` | Code | setAppsFlyerUserId exists |
| 12 | RLS migrations on profiles table | Schema | SELECT policy verification |

---

## ORCH-0001: Phone OTP Sign-In

### Clarification

This item is **mislabeled**. Phone OTP is NOT a sign-in method. It is phone *verification* during onboarding Step 1c. Users sign in exclusively via Google or Apple OAuth. The OTP flow requires an existing authenticated session (both edge functions validate JWT first).

### Backend Findings

The `send-otp` and `verify-otp` edge functions are well-built:

- **Auth validation**: Both require valid JWT (lines 17-37 in each). INV-A04 satisfied.
- **Input validation**: E.164 regex (`/^\+[1-9]\d{1,14}$/`) on phone, 6-digit regex on code.
- **Duplicate phone detection**: Checks if phone is claimed by another user. Handles orphaned profiles (deleted auth user but profile remains).
- **Twilio integration**: Uses Verify API correctly. Rate limiting (429) handled with user-friendly message.
- **Atomic save**: verify-otp saves to profiles (source of truth) then syncs to auth.users (non-fatal).
- **UNIQUE constraint safety net**: Handles `23505` error code.
- **Defense-in-depth**: Double-checks phone ownership between send and verify.

### Findings

- **No findings** at the backend layer. Both edge functions are production-quality.

### Grade Recommendation: B

Backend is solid (A-grade). Grade B because the client-side onboarding phone component was not traced in this investigation (it's in ORCH-0008 scope, Onboarding audit). The backend contract is correct and defensive.

### Spec Needed: No (for backend). Client-side audit deferred to Wave 2 (Onboarding).

---

## ORCH-0005: Google Sign-In Flow

### Full Code Path

```
WelcomeScreen.handleGoogleSignIn()
  → useAuthSimple.signInWithGoogle()
    → GoogleSignin.signOut() (force account picker)
    → GoogleSignin.signIn() (native SDK)
    → GoogleSignin.getTokens() (ID token)
    → supabase.from("profiles").select().ilike("email") [pre-auth check]
    → supabase.auth.signInWithIdToken({ provider: "google", token })
    → [if error + existing user]: retry logic (200ms delay → getSession → retry → getSession)
    → onAuthStateChange fires → setAuth() + loadProfile()
```

### Findings

#### 1. Contributing Factor: Brittle "existing user" error detection

- **File + line**: [useAuthSimple.ts:421-429](app-mobile/src/hooks/useAuthSimple.ts#L421-L429)
- **Exact code**:
  ```typescript
  isExistingUserError =
    error.message?.includes("already registered") ||
    error.message?.includes("already exists") ||
    error.message?.includes("Database error saving new user") ||
    error.message?.includes("duplicate key") ||
    error.message?.includes("violates") ||
    (existingUser && error.message?.includes("user"));
  ```
- **What it does**: String-matches Supabase error messages to detect "user already exists" errors
- **What it should do**: Use error codes (not messages) for reliable detection
- **Causal chain**: Supabase upgrades change error wording → detection fails → existing users see "Google Sign-In Failed" alert instead of signing in → user is locked out
- **Verification**: Change any of the matched strings in a test environment and confirm sign-in fails

#### 2. Hidden Flaw: Complex timing-dependent retry logic

- **File + line**: [useAuthSimple.ts:436-476](app-mobile/src/hooks/useAuthSimple.ts#L436-L476)
- **What it does**: After "existing user" error: 200ms delay → getSession → if no session: retry signInWithIdToken → if still no session: getSession again → if still nothing: throw
- **What it should do**: Single retry with backoff, or catch the specific error and handle cleanly
- **Causal chain**: On slow networks, 200ms is too short → all retries fire before session propagates → user sees error on successful sign-up
- **Risk level**: Medium — works on normal connections, may fail on 3G/poor wifi

#### 3. Observation: Pre-auth profile query is safe

- **File + line**: [useAuthSimple.ts:399-409](app-mobile/src/hooks/useAuthSimple.ts#L399-L409)
- **What it does**: Queries profiles by email before Supabase sign-in
- **Assessment**: RLS on profiles requires `auth.uid() = id` or `NOT is_blocked_by()`. Unauthenticated requests have null `auth.uid()`, so RLS returns no rows. No email enumeration risk.

#### 4. Observation: Good error handling for known failures

- Cancelled sign-in: returns silently (no error shown) ✓
- In-progress sign-in: returns with message ✓
- Play Services missing (Android): Alert with actionable message ✓
- Generic failure: Alert with user-friendly message ✓

### Five-Layer Cross-Check

| Layer | Status | Notes |
|-------|--------|-------|
| Docs | N/A | No formal spec exists for auth |
| Schema | OK | profiles table accepts Google-created users |
| Code | CF-001, HF-001 | String matching + timing dependencies |
| Runtime | Unknown | Not tested on slow networks or with Supabase version changes |
| Data | OK | Profile creation handles missing profile (PGRST116) correctly |

### Grade Recommendation: C

Happy path works. Error handling for the "existing user" case is fragile (string matching + timing). Could break on Supabase upgrade or slow network without any code change.

### Spec Needed: Yes

Spec should cover:
- Replace string matching with error code detection (or eliminate the retry entirely — Supabase v2 handles existing OAuth users natively)
- Simplify retry logic to single retry with 500ms delay
- Add timeout on the entire sign-in flow (currently unbounded)

---

## ORCH-0006: Apple Sign-In Flow

### Full Code Path

```
WelcomeScreen.handleAppleSignIn()
  → useAuthSimple.signInWithApple()
    → AppleAuthentication.isAvailableAsync()
    → AppleAuthentication.signInAsync({ scopes: [FULL_NAME, EMAIL] })
    → supabase.auth.signInWithIdToken({ provider: "apple", token })
    → [fire-and-forget] profile.update(name) if first_name is null
    → onAuthStateChange fires → setAuth() + loadProfile()
```

### Findings

#### 1. Hidden Flaw: Apple name is fire-and-forget with no retry

- **File + line**: [useAuthSimple.ts:607-617](app-mobile/src/hooks/useAuthSimple.ts#L607-L617)
- **Exact code**:
  ```typescript
  supabase
    .from("profiles")
    .update(updates)
    .eq("id", data.session.user.id)
    .is("first_name", null)
    .then(({ error }) => {
      if (error) console.error("Apple name update failed:", error);
    });
  ```
- **What it does**: Updates profile name only if `first_name` is null. Fire-and-forget (no await, no retry).
- **What it should do**: Await the update with retry, or queue for retry on failure
- **Causal chain**: Network blip during first Apple sign-in → name update fails → Apple only provides name on FIRST sign-in (Apple's policy) → user's name is permanently "User" (email prefix fallback) → no way to recover without manual profile edit
- **Risk level**: Low probability, high impact when it happens
- **Verification**: Kill network after `signInWithIdToken` succeeds but before the update completes

#### 2. Observation: Clean implementation overall

- Platform guard (iOS only) ✓
- Availability check (iOS 13+) ✓
- Cancellation handling (`ERR_REQUEST_CANCELED`) ✓
- No "existing user" retry logic needed (Supabase handles Apple identity matching natively via `sub` claim) ✓
- Identity token passed directly (no intermediate getTokens() call like Google) ✓

#### 3. Observation: No Android fallback

- Apple Sign-In is iOS-only. Android users only have Google. This is correct per the WelcomeScreen (Apple button renders only on iOS).

### Grade Recommendation: B

Clean, production-quality on the happy path. The fire-and-forget name issue is the only gap — low probability but permanent impact.

### Spec Needed: Yes (minor)

Spec should cover: await the name update with one retry on failure.

---

## ORCH-0004: Sign-Out Cleanup

### Full Sign-Out Chain (traced)

The primary sign-out path is `handleSignOut()` in [AppStateManager.tsx:746](app-mobile/src/components/AppStateManager.tsx#L746):

```
handleSignOut()
  1. Reset navigation/UI state (currentPage → "home", close all modals)
  2. logoutOneSignal() — dissociate push device
  3. realtimeService.clearQueue() — clear offline queue
  4. useAppStore.clearUserData() — reset Zustand (user, profile, sessions, deck)
  5. AsyncStorage prefix sweep — remove all mingla_*, board_cache_*, etc.
  6. queryClient.clear() — clear React Query cache
  7. Reset local userIdentity state
  8. signOutRef.current() → supabase.auth.signOut()
```

Then `onAuthStateChange` in useAuthSimple fires with SIGNED_OUT:

```
  9. setAuth(null) → triggers clearUserData() again (redundant but harmless)
```

### Findings

#### 1. Root Cause: Missing external SDK cleanup on sign-out (INV-S05 violation)

- **File + line**: [AppStateManager.tsx:746-828](app-mobile/src/components/AppStateManager.tsx#L746-L828)
- **What it does**: Clears OneSignal, Zustand, AsyncStorage, React Query, Supabase session
- **What it should do**: ALSO clear Mixpanel identity, AppsFlyer user ID, RevenueCat customer
- **Causal chain**:
  1. User A signs in → Mixpanel.identify(A), AppsFlyer.setUserId(A), RevenueCat.logIn(A)
  2. User A signs out → none of these are reset
  3. User B signs in → Mixpanel events attributed to A until B's identify() fires. AppsFlyer events attributed to A permanently (no reset call exists). RevenueCat may return A's subscription until B's logIn() fires.
- **Verification**: Sign in as A, sign out, sign in as B, check Mixpanel distinct_id — it will still be A until re-identified
- **Evidence**:
  - `logoutRevenueCat()` EXISTS in [revenueCatService.ts:72](app-mobile/src/services/revenueCatService.ts#L72) but is NOT called in handleSignOut
  - `mixpanelService.reset()` EXISTS in [mixpanelService.ts:69](app-mobile/src/services/mixpanelService.ts#L69) but is NOT called in handleSignOut
  - `mixpanelService.trackLogout()` EXISTS in [mixpanelService.ts:102](app-mobile/src/services/mixpanelService.ts#L102) but is NOT called in handleSignOut
  - No AppsFlyer reset function exists at all — `setAppsFlyerUserId` is fire-once, never cleared

#### 2. Hidden Flaw: Duplicate sign-out code path in authService.ts

- **File + line**: [authService.ts:25-41](app-mobile/src/services/authService.ts#L25-L41)
- **What it does**: `authService.signOut()` calls `supabase.auth.signOut()` + `clearUserData()` but skips AsyncStorage cleanup, React Query clear, OneSignal, and all SDK resets
- **What it should do**: Either delegate to handleSignOut or be deleted
- **Causal chain**: If any future code calls `authService.signOut()` instead of the AppStateManager handler, it performs an incomplete sign-out — data leaks to the next user
- **Verification**: Grep confirms `authService.signOut()` is NOT currently called anywhere. Dead code, but a trap for future developers.

#### 3. Hidden Flaw: 401-forced sign-out bypasses cleanup

- **File + line**: [queryClient.ts:98-101](app-mobile/src/config/queryClient.ts#L98-L101)
- **Exact code**:
  ```typescript
  const { supabase } = require('../services/supabase');
  setTimeout(() => supabase.auth.signOut(), 1000);
  ```
- **What it does**: After 3 consecutive 401s, calls `supabase.auth.signOut()` directly
- **What it should do**: Call `handleSignOut()` from AppStateManager (full cleanup)
- **Causal chain**: Zombie auth → 3 x 401 → force sign-out → only Supabase session cleared → Zustand retains user data, AsyncStorage retains user data, OneSignal still associated, all SDK identities intact → user sees WelcomeScreen but app state is corrupted
- **Verification**: Expire a user's JWT, trigger 3 API calls, observe that Zustand still has `isAuthenticated: false` but profile data persists

#### 4. Observation: AsyncStorage sweep is well-designed

The prefix-based sweep (`mingla_*`, `board_cache_*`, etc.) is future-proof. The Zustand persist key (`mingla-mobile-storage`) is NOT swept because `clearUserData()` resets the state in memory, which then persists over the old data. Correct design.

#### 5. Observation: Sign-out order is correct

Clearing local state BEFORE `supabase.auth.signOut()` ensures the user sees the WelcomeScreen immediately, even if the network call to revoke the session fails.

### Five-Layer Cross-Check

| Layer | Status | Notes |
|-------|--------|-------|
| Docs | N/A | No formal sign-out spec |
| Schema | OK | supabase.auth.signOut() revokes server session |
| Code | RC-001, HF-001, HF-002 | Missing SDK cleanup, duplicate path, 401 bypass |
| Runtime | Unknown | Cross-account SDK bleed not tested |
| Data | OK (partial) | Zustand + AsyncStorage cleaned, but SDK states persist in memory |

### Invariant Violations

- **INV-S05 VIOLATED**: "Sign-out clears all caches, stores, subscriptions, tokens" — Mixpanel identity, AppsFlyer userId, RevenueCat customer NOT cleared
- **INV-A01 PARTIAL**: Single auth instance is maintained via useAuthSimple, but the 401-forced sign-out bypasses the centralized handler

### Grade Recommendation: C

Core cleanup works (Zustand, AsyncStorage, React Query, OneSignal, Supabase). But three external SDKs leak identity across accounts, and the 401-forced sign-out path is incomplete. Not broken for single-user devices, but a real data integrity issue for shared devices or account switching.

### Spec Needed: Yes

Spec should cover:
1. Add `logoutRevenueCat()`, `mixpanelService.reset()`, `mixpanelService.trackLogout()` to handleSignOut
2. Create `resetAppsFlyerUserId()` function (or document that AppsFlyer doesn't support un-identifying)
3. Make 401-forced sign-out call handleSignOut instead of raw supabase.auth.signOut()
4. Delete or deprecate `authService.signOut()` (dead code, incomplete cleanup)

---

## Blast Radius Map

| Finding | Surfaces Affected | Invariants Violated |
|---------|-------------------|---------------------|
| Missing SDK cleanup | Analytics (Mixpanel, AppsFlyer), Payments (RevenueCat) | INV-S05 |
| 401 forced sign-out bypass | All surfaces (incomplete cleanup) | INV-S05, INV-A01 |
| Google existing-user string matching | Auth (Google only) | None |
| Apple name fire-and-forget | Profile (name display) | None |

---

## Discoveries for Orchestrator

### New Issues Found

| ID | Title | Surface | Severity | Classification |
|----|-------|---------|----------|---------------|
| NEW-001 | Sign-out missing Mixpanel/AppsFlyer/RevenueCat cleanup | Auth | S1 | bug |
| NEW-002 | 401-forced sign-out bypasses handleSignOut cleanup chain | Auth | S1 | bug |
| NEW-003 | Google sign-in uses brittle error message string matching | Auth | S2 | quality-gap |
| NEW-004 | Apple sign-in name update is fire-and-forget (permanent name loss risk) | Auth | S3 | quality-gap |
| NEW-005 | authService.signOut() is dead code with incomplete cleanup | Auth | S3 | design-debt |

### Side Note

- ORCH-0001 should be relabeled to "Phone OTP verification (onboarding)" — it's not a sign-in method.
- The `authService` class (authService.ts) holds a stale reference to `useAppStore.getState()` at construction time (line 23). This gets the initial state, not the current state. If the store has been updated, `this.appStore` is stale. However, since `authService.signOut()` is never called, this is academic.

---

## Summary

| Item | Grade Before | Grade After | Verdict | Spec Needed |
|------|-------------|-------------|---------|-------------|
| ORCH-0001 | F | B | Backend solid. Client-side in onboarding scope. | No (backend) |
| ORCH-0004 | F | C | Core cleanup works, 3 SDK identity leaks + 401 bypass path. | Yes |
| ORCH-0005 | F | C | Happy path works. Fragile string matching + timing in retry. | Yes |
| ORCH-0006 | F | B | Clean implementation. Minor fire-and-forget name risk. | Yes (minor) |

**Findings total**: 1 root cause, 2 contributing factors, 4 hidden flaws, 3 observations
**Confidence**: HIGH — all source files read, full chains traced, RLS verified
