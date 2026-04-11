# Implementor: Deep Analytics P0 — Dispatch A: Service Foundation (ORCH-0393)

## Mission

Build the Mixpanel service foundation: add 4 new service methods, set 20+ user properties at login/onboarding, register 7 super properties, and wire the remaining 5 dead tracking methods. This is the infrastructure that Dispatch B (new events + timed events) builds on.

## Evidence Trail

- `Mingla_Artifacts/outputs/PRODUCT_ORCH-0393_DEEP_ANALYTICS_TRACKING_PLAN.md` — the full tracking plan (READ THIS FIRST — sections 1, 2, 11, 13 are your primary references)
- `Mingla_Artifacts/outputs/INVESTIGATION_ANALYTICS_NOTIFICATION_ARCHITECTURE.md` — current event maps and identity lifecycle

## Scope

### IN SCOPE
1. Add 4 new methods to `mixpanelService.ts`
2. Set 20+ P0 user properties at login and onboarding completion
3. Register 7 super properties after login
4. Wire 5 remaining dead tracking methods to their call sites
5. Verify TypeScript compiles clean

### OUT OF SCOPE (Dispatch B)
- New tracking events (App Opened, Card Saved, Card Viewed, etc.)
- Timed events
- First-time milestones
- Funnel/dashboard configuration in Mixpanel UI

---

## Change 1: Add 4 New Service Methods to mixpanelService.ts

Read `mixpanelService.ts` fully before modifying. Add these methods to the class:

### 1a. registerSuperProperties

```typescript
/**
 * Register super properties that attach to every subsequent event.
 * Call after login and when relevant state changes (tier, city, mode).
 */
registerSuperProperties(properties: Record<string, any>): void {
  if (!this.initialized || !this.mixpanel) return;
  this.mixpanel.registerSuperProperties(properties);
}
```

### 1b. timeEvent

```typescript
/**
 * Start a timer for an event. When track() is later called with
 * the same event name, a $duration property is automatically added.
 */
timeEvent(eventName: string): void {
  if (!this.initialized || !this.mixpanel) return;
  this.mixpanel.timeEvent(eventName);
}
```

### 1c. incrementUserProperty

```typescript
/**
 * Increment a numeric user profile property (e.g., total_saves += 1).
 */
incrementUserProperty(property: string, by: number = 1): void {
  if (!this.initialized || !this.mixpanel) return;
  this.mixpanel.getPeople().increment(property, by);
}
```

### 1d. setUserPropertyOnce

```typescript
/**
 * Set user profile properties only if they don't already exist.
 * Used for first-time milestone dates (first_save_at, first_friend_at, etc.).
 */
setUserPropertyOnce(properties: Record<string, any>): void {
  if (!this.initialized || !this.mixpanel) return;
  this.mixpanel.getPeople().setOnce(properties);
}
```

---

## Change 2: Set P0 User Properties at Login

**File**: `mixpanelService.ts` — modify the existing `trackLogin()` method.

Currently it sets 3 properties (`$email`, `login_provider`, `last_login`). Expand it to set the full P0 identity + lifecycle properties.

The method signature needs to accept more data. Update to:

```typescript
trackLogin(user: {
  id: string;
  email?: string;
  provider?: string;
  displayName?: string;
  country?: string;
  city?: string;
  tier?: string;
  trialActive?: boolean;
  trialEndDate?: string | null;
  friendsCount?: number;
  isPaired?: boolean;
  platform?: string;
  appVersion?: string;
  onboardingCompleted?: boolean;
}): void {
  this.identify(user.id);

  // Identity properties
  this.setUserProperties({
    $email: user.email,
    $name: user.displayName,
    user_id: user.id,
    login_provider: user.provider ?? 'email',
    platform: user.platform ?? Platform.OS,
    app_version: user.appVersion ?? Application.nativeApplicationVersion ?? 'unknown',
    last_login: new Date().toISOString(),
  });

  // Set $created only on first login
  this.setUserPropertyOnce({
    $created: new Date().toISOString(),
  });

  // Lifecycle properties
  this.setUserProperties({
    subscription_tier: user.tier ?? 'free',
    trial_active: user.trialActive ?? false,
    trial_end_date: user.trialEndDate ?? null,
    onboarding_completed: user.onboardingCompleted ?? false,
    country: user.country ?? '',
    city: user.city ?? '',
  });

  // Social properties
  this.setUserProperties({
    friends_count: user.friendsCount ?? 0,
    is_paired: user.isPaired ?? false,
  });

  // Register super properties (attach to every future event)
  this.registerSuperProperties({
    subscription_tier: user.tier ?? 'free',
    city: user.city ?? '',
    platform: user.platform ?? Platform.OS,
    app_version: user.appVersion ?? Application.nativeApplicationVersion ?? 'unknown',
    session_mode: 'solo',
    is_paired: user.isPaired ?? false,
    trial_active: user.trialActive ?? false,
  });

  this.track('Login', {
    method: user.provider ?? 'email',
  });
}
```

**IMPORTANT**: You'll need to import `Platform` from `react-native` and `Application` from `expo-application` at the top of mixpanelService.ts. Check if these are already imported or available. If `expo-application` isn't installed, use `Constants.expoConfig?.version` from `expo-constants` instead.

**Then update the call site** in `app-mobile/app/index.tsx` (around line 922) to pass the additional data:

```typescript
mixpanelService.trackLogin({
  id: user.id,
  email: user.email,
  provider: session?.user?.app_metadata?.provider,
  displayName: profile?.display_name,
  country: profile?.country,
  city: profile?.city ?? profile?.location,
  tier: effectiveTier,
  trialActive: /* derive from subscription state */,
  trialEndDate: /* derive from subscription state */,
  friendsCount: /* from friends query if available, or 0 */,
  isPaired: /* from pairings query if available, or false */,
  onboardingCompleted: profile?.onboarding_completed ?? false,
});
```

Read the surrounding code in index.tsx to find what's available in scope. Use whatever data is accessible — don't restructure code to fetch new data. If a value isn't available at login time, pass `undefined` and it'll use the default.

---

## Change 3: Set User Properties at Onboarding Completion

**File**: `app-mobile/src/components/OnboardingFlow.tsx`

Near the existing `mixpanelService.trackOnboardingCompleted()` call (which we wired in ORCH-0387), add user property updates:

```typescript
// After trackOnboardingCompleted:
mixpanelService.setUserProperties({
  onboarding_completed: true,
  onboarding_completed_at: new Date().toISOString(),
  country: data.userCountry || '',
  city: /* if available from location step */,
  gender: data.userGender || '',
  language: data.userPreferredLanguage || 'en',
  intents: data.intents || [],
  intents_count: data.intents?.length ?? 0,
});

// Register updated super properties
mixpanelService.registerSuperProperties({
  city: /* from location data */,
});
```

Use whatever variables are available from the onboarding `data` object. Read the onboarding completion handler to see what's in scope.

---

## Change 4: Update Super Properties on State Changes

### 4a. Session mode switch

**File**: `app-mobile/src/components/CollaborationSessions.tsx`

Near the existing `mixpanelService.trackSessionSwitched()` calls (lines ~263 and ~475), add:

```typescript
mixpanelService.registerSuperProperties({ session_mode: mode });
```

Where `mode` is `'session'` or `'solo'`.

### 4b. Subscription tier change

**File**: `app-mobile/src/hooks/useRevenueCat.ts` or wherever subscription state changes.

After a successful purchase or tier change, update:

```typescript
mixpanelService.registerSuperProperties({ subscription_tier: newTier, trial_active: false });
mixpanelService.setUserProperties({ subscription_tier: newTier, trial_active: false });
```

Find the `usePurchasePackage` mutation's `onSuccess` callback — that's where tier changes.

### 4c. Pair state change

When a pair is formed or broken, update:

```typescript
mixpanelService.registerSuperProperties({ is_paired: true/false });
mixpanelService.setUserProperties({ is_paired: true/false });
```

Find the pair accept and unpair handlers in `usePairings.ts`.

---

## Change 5: Wire 5 Remaining Dead Methods

These methods exist in mixpanelService.ts but are never called. Wire them:

### 5a. trackLoginFailed

**File**: `app-mobile/app/index.tsx` or `app-mobile/src/hooks/useAuthSimple.ts`

Find where auth errors are caught and add:
```typescript
mixpanelService.trackLoginFailed(email, error.message);
```

Search for auth error handling — likely in the Google/Apple sign-in catch blocks.

### 5b. trackOnboardingStepSkipped

**File**: `app-mobile/src/components/OnboardingFlow.tsx`

The earlier investigation found no per-step skip handler. If a skip action exists anywhere in onboarding (even the "Skip for now" error recovery button), wire it there. If genuinely no skip action exists, document this in the report as "no call site exists — method remains for future use."

### 5c. trackDiscoverPersonAdded

**File**: `app-mobile/src/components/DiscoverScreen.tsx`

Search for the person-add handler (where a user creates/adds a person in the Discover tab). The method expects `{ person_name, has_birthday, gender }`. Wire it at the success point of the person creation.

### 5d. trackAccountSettingUpdated

**File**: `app-mobile/src/components/profile/AccountSettings.tsx`

Search for setting save handlers. The method expects `{ setting, value }`. Wire it alongside the existing `trackProfileSettingUpdated()` calls, or in places where account-level settings (not profile settings) are changed. Read AccountSettings.tsx to understand the distinction.

### 5e. trackLoginFailed (already listed as 5a — verify no duplicates)

This is the same as 5a. Only 4 unique dead methods remain after the ones wired in ORCH-0387.

**Correction**: The 5 remaining dead methods after ORCH-0387 are:
1. trackLoginFailed
2. trackOnboardingStepSkipped
3. trackDiscoverPersonAdded
4. trackAccountSettingUpdated
5. trackOnboardingCompleted — **WAIT, this was already wired in ORCH-0387.** Re-verify which methods are still dead by grepping for each method name in the codebase (excluding mixpanelService.ts itself).

---

## Constraints

- Do NOT change event names or property names for existing events — only ADD new properties and calls.
- Do NOT break the existing `trackLogin()` call — the new signature must be backward-compatible (all new params optional).
- All new service methods follow the same guard pattern: `if (!this.initialized || !this.mixpanel) return;`
- All analytics calls are fire-and-forget — never await, never let failures block user actions.
- Use `Platform.OS` for platform detection (already available in React Native).
- Follow naming conventions from section 11 of the tracking plan: Title Case events, snake_case properties.

## Success Criteria

1. **SC-1**: 4 new methods added to mixpanelService.ts (registerSuperProperties, timeEvent, incrementUserProperty, setUserPropertyOnce)
2. **SC-2**: trackLogin() accepts expanded user object and sets 20+ user properties
3. **SC-3**: 7 super properties registered after login (subscription_tier, city, platform, app_version, session_mode, is_paired, trial_active)
4. **SC-4**: Super properties update on session switch, subscription change, and pair state change
5. **SC-5**: User properties set at onboarding completion (onboarding_completed, country, city, gender, language, intents)
6. **SC-6**: All remaining dead methods either wired or documented as "no call site exists"
7. **SC-7**: TypeScript compiles clean
8. **SC-8**: No existing events removed or modified (additive only)
9. **SC-9**: $created set via setOnce (only on first login, never overwritten)

## Output

Implementation report: `Mingla_Artifacts/outputs/IMPLEMENTATION_ORCH-0393_P0A_REPORT.md`

Include:
- Old → New receipt for every file changed
- Which dead methods were wired vs. documented as no-call-site
- Which user properties couldn't be set due to scope limitations
- TypeScript compilation result
