# Implementor: Analytics Quick Wins (ORCH-0387)

## Mission

Wire Mingla's analytics to actually collect data. Set the Mixpanel token, connect 7 existing-but-unwired tracking methods, remove dead config, and populate the push_clicked column. Total scope: ~73 minutes of surgical edits. No new methods to write — everything already exists.

## Context

Mixpanel has been completely dead since the app launched because `EXPO_PUBLIC_MIXPANEL_TOKEN` was never added to `.env`. The service has 33 tracking methods, 17 are actively called from components, but all calls silently no-op because the token is missing. Additionally, 7 tracking methods are defined in `mixpanelService.ts` but never called from the codebase — even though the equivalent AppsFlyer calls exist at the exact same locations.

This is a plugging-in task, not a building task.

## Evidence Trail

- `Mingla_Artifacts/outputs/INVESTIGATION_ANALYTICS_NOTIFICATION_ARCHITECTURE.md` — full event maps, parity matrix
- `Mingla_Artifacts/outputs/ANALYTICS_STRATEGY_FOR_LAUNCH.md` — product strategy defining these as the minimum viable analytics
- `Mingla_Artifacts/outputs/INVESTIGATION_CODE_INVENTORY.md` — env var registry showing token is missing

## Changes (7 items, in order)

### 1. Set EXPO_PUBLIC_MIXPANEL_TOKEN in .env (5 min)

**File**: `app-mobile/.env`

Add the Mixpanel project token. The user must provide this value from their Mixpanel dashboard (Project Settings → Access Keys → Token).

**Action**: Add line `EXPO_PUBLIC_MIXPANEL_TOKEN=<token_from_user>` to `.env`

**IMPORTANT**: Do NOT hardcode a fake token. Ask the user for the real token value before proceeding. If the user doesn't have it available, add a placeholder comment and continue with the other changes — the methods will activate once the real token is set.

### 2. Add token to .env.example (2 min)

**File**: `app-mobile/.env.example`

Add: `EXPO_PUBLIC_MIXPANEL_TOKEN=your_mixpanel_project_token`

### 3. Remove dead FOURSQUARE key from .env (1 min)

**File**: `app-mobile/.env`

Remove the line containing `EXPO_PUBLIC_FOURSQUARE_API_KEY`. This key is set but never read by any code. Verified in INVESTIGATION_CODE_INVENTORY.md.

### 4. Wire 5 onboarding Mixpanel methods in OnboardingFlow.tsx (30 min)

**File**: `app-mobile/src/components/OnboardingFlow.tsx`

The AppsFlyer onboarding events already fire from this file. Add Mixpanel calls next to each one:

**4a.** Near `logAppsFlyerEvent('af_tutorial_completion'` (line ~278):
```typescript
mixpanelService.trackOnboardingCompleted({ gender, country });
```

**4b.** Near `logAppsFlyerEvent('onboarding_step_completed'` (line ~706):
```typescript
mixpanelService.trackOnboardingStepCompleted(stepNumber, { substep });
```

**4c.** Add `trackOnboardingStepViewed()` at the beginning of each step render. The onboarding state machine has a `currentStep` value — fire `mixpanelService.trackOnboardingStepViewed(currentStep)` when the step changes. Find the `useEffect` or render logic that updates the visible step and add the call there.

**4d.** For step back navigation (if there's a back button handler), add:
```typescript
mixpanelService.trackOnboardingStepBack(currentStep);
```

**4e.** For skip actions (if there's a skip button handler), add:
```typescript
mixpanelService.trackOnboardingStepSkipped(currentStep);
```

**Import**: Ensure `mixpanelService` is imported at the top of OnboardingFlow.tsx:
```typescript
import { mixpanelService } from '../services/mixpanelService';
```

**Finding the right locations**: Search for `logAppsFlyerEvent` calls in OnboardingFlow.tsx — the Mixpanel calls go right next to them. For step viewed/back/skip, search for the step transition logic in the onboarding state machine.

### 5. Wire trackPreferencesUpdated() in PreferencesSheet.tsx (10 min)

**File**: `app-mobile/src/components/PreferencesSheet.tsx`

Near `logAppsFlyerEvent('preferences_updated'` (line ~863), add:

```typescript
mixpanelService.trackPreferencesUpdated({
  isCollaborationMode: isCollaboration,
  changesCount: Object.keys(changedFields).length, // or however changes are counted
  intents: selectedIntents,
  intentsCount: selectedIntents?.length ?? 0,
  categories: selectedCategories,
  categoriesCount: selectedCategories?.length ?? 0,
  budgetMin: budgetMin,
  budgetMax: budgetMax,
  travelMode: travelMode,
  constraintType: constraintType,
  constraintValue: constraintValue,
  dateOption: dateOption,
  timeSlot: timeSlot,
  location: location,
});
```

**Note**: Adapt the property names to match what's available in the save handler's scope. The method signature in mixpanelService.ts (line ~182) shows the expected shape. Use whatever variables are already in scope at the save point — don't import new data.

### 6. Wire trackFriendRequestSent() in useFriends.ts (5 min)

**File**: `app-mobile/src/hooks/useFriends.ts`

Near `logAppsFlyerEvent('af_invite'` (line ~220), add:

```typescript
mixpanelService.trackFriendRequestSent({ recipient_username: recipientUsername });
```

**Import**: Ensure `mixpanelService` is imported. Use whatever variable holds the recipient's username/name in the current scope.

### 7. Populate push_clicked on notification tap (20 min)

**File**: `app-mobile/app/index.tsx`

In the notification click handler (search for `onNotificationClicked` or `processNotification`), after the notification is processed, update the database:

```typescript
// After processing the notification click:
if (notificationId) {
  supabase
    .from('notifications')
    .update({ push_clicked: true, push_clicked_at: new Date().toISOString() })
    .eq('id', notificationId)
    .then(() => {})
    .catch((err) => console.warn('[PUSH] Failed to record click:', err));
}
```

The `notificationId` should be available in the notification's `data` payload (it's included by notify-dispatch: `data: { notificationId, type, ... }`).

**Fire-and-forget**: This is a non-blocking analytics update. Don't await it. Don't let it fail the click handling.

Also add a Mixpanel event for the click:

```typescript
mixpanelService.track('Push Notification Clicked', {
  notification_type: data?.type ?? 'unknown',
  notification_id: notificationId,
});
```

## Constraints

- Do NOT create new tracking methods. Only call existing ones.
- Do NOT modify mixpanelService.ts — the methods are already correct.
- Do NOT remove any AppsFlyer calls. The Mixpanel calls go NEXT TO them, not instead of them.
- Do NOT change any business logic. These are analytics-only additions.
- Fire-and-forget for all analytics calls — never let tracking failures block user actions.
- If a variable isn't available in scope, use the closest equivalent or skip that property (don't restructure code to access it).

## Success Criteria

1. **SC-1**: `EXPO_PUBLIC_MIXPANEL_TOKEN` is present in `.env` (or placeholder comment if user hasn't provided token)
2. **SC-2**: `EXPO_PUBLIC_MIXPANEL_TOKEN` is documented in `.env.example`
3. **SC-3**: `EXPO_PUBLIC_FOURSQUARE_API_KEY` is removed from `.env`
4. **SC-4**: `trackOnboardingCompleted()` fires when onboarding finishes
5. **SC-5**: `trackOnboardingStepCompleted()` fires on each step completion
6. **SC-6**: `trackOnboardingStepViewed()` fires when each step renders
7. **SC-7**: `trackPreferencesUpdated()` fires on preference save
8. **SC-8**: `trackFriendRequestSent()` fires on friend request send
9. **SC-9**: `notifications.push_clicked` is set to `true` when user taps a push notification
10. **SC-10**: Mixpanel event "Push Notification Clicked" fires on push tap with notification_type property
11. **SC-11**: TypeScript compiles clean (`npx tsc --noEmit`)
12. **SC-12**: No existing AppsFlyer events removed or modified

## Anti-Patterns

- Do NOT wrap analytics calls in try/catch unless they're in a context where an exception would crash the app. The mixpanelService already handles errors internally.
- Do NOT add `await` to analytics calls. They're fire-and-forget by design.
- Do NOT add analytics calls inside render functions or useMemo — only in event handlers and useEffect callbacks.
- Do NOT log analytics in loops (e.g., don't track "step viewed" for every re-render, only on step CHANGE).

## Output

Produce an implementation report listing:
- Each change made with file:line
- Variables used for properties (so tester can verify data correctness)
- Any properties that couldn't be wired due to scope limitations
- TypeScript compilation result
