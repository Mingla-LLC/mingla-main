# Implementor: Deep Analytics P0 — Dispatch B: New Events + Timed Events + Coach Marks (ORCH-0393)

## Mission

Add ~18 new tracking events, 3 timed events, and 4 coach mark events to Mixpanel. Dispatch A (already shipped) built the service foundation (4 new methods, 20+ user properties, 7 super properties). This dispatch adds the events that populate the funnels.

## Evidence Trail

- `Mingla_Artifacts/outputs/PRODUCT_ORCH-0393_DEEP_ANALYTICS_TRACKING_PLAN.md` — sections 3, 6, 3.9 are your primary references
- Dispatch A is already committed (`122bb927`) — mixpanelService.ts now has `registerSuperProperties`, `timeEvent`, `incrementUserProperty`, `setUserPropertyOnce`

## Scope

### IN SCOPE
1. Add new tracking methods to `mixpanelService.ts` for each new event
2. Wire each method to its call site
3. Add 3 timed events (onboarding duration, card decision time, session length)
4. Add 4 coach mark events
5. Add `incrementUserProperty` calls for engagement counters (total_saves, total_scheduled)
6. TypeScript compiles clean

### OUT OF SCOPE
- First-time milestones with AsyncStorage flags (P1)
- Engagement scoring edge function (P2)
- Funnel/dashboard configuration in Mixpanel UI (manual config)
- Server-side events (P3)

---

## Part 1: New Tracking Methods in mixpanelService.ts

Add these methods to the service class. Follow the existing pattern (guard clause + this.track).

### 1. App Opened
```typescript
trackAppOpened(props: { source: 'cold' | 'warm' | 'push'; secondsSinceLastOpen?: number }): void {
  this.track('App Opened', props);
}
```

### 2. Signup Completed
```typescript
trackSignupCompleted(props: { method: string; country?: string }): void {
  this.track('Signup Completed', props);
}
```

### 3. Card Viewed
```typescript
trackCardViewed(props: { card_id: string; card_title: string; category: string; position_in_deck: number; is_curated: boolean }): void {
  this.timeEvent('Card Saved');
  this.timeEvent('Card Dismissed');
  this.track('Card Viewed', props);
}
```
Note: Starting timers for both Card Saved and Card Dismissed here — whichever fires next gets the $duration automatically.

### 4. Card Saved
```typescript
trackCardSaved(props: { card_id: string; card_title: string; category: string; is_curated: boolean; position_in_deck?: number; source?: string }): void {
  this.track('Card Saved', props);
  this.incrementUserProperty('total_saves');
}
```

### 5. Card Dismissed
```typescript
trackCardDismissed(props: { card_id: string; card_title: string; category: string; is_curated: boolean; position_in_deck?: number }): void {
  this.track('Card Dismissed', props);
}
```

### 6. Deck Exhausted
```typescript
trackDeckExhausted(props: { cards_seen: number; cards_saved: number; cards_dismissed: number; session_mode: string }): void {
  this.track('Deck Exhausted', props);
}
```

### 7. Paywall Viewed
```typescript
trackPaywallViewed(props: { trigger: string; gated_feature?: string }): void {
  this.timeEvent('Paywall Dismissed');
  this.track('Paywall Viewed', props);
}
```

### 8. Paywall Dismissed
```typescript
trackPaywallDismissed(props: { trigger: string }): void {
  this.track('Paywall Dismissed', props);
}
```

### 9. Feature Gate Hit
```typescript
trackFeatureGateHit(props: { feature: string; current_tier: string }): void {
  this.track('Feature Gate Hit', props);
}
```

### 10. Trial Started
```typescript
trackTrialStarted(props: { trial_duration_days: number }): void {
  this.track('Trial Started', props);
}
```

### 11. Trial Expired
```typescript
trackTrialExpired(props: { trial_days: number }): void {
  this.track('Trial Expired', props);
}
```

### 12. Subscription Purchased
```typescript
trackSubscriptionPurchased(props: { plan: string; tier: string; revenue: number; currency: string; is_trial_conversion?: boolean }): void {
  this.track('Subscription Purchased', props);
  this.setUserProperties({ subscription_tier: props.tier });
  this.registerSuperProperties({ subscription_tier: props.tier, trial_active: false });
}
```

### 13. Pair Request Sent
```typescript
trackPairRequestSent(props: { target_name?: string }): void {
  this.track('Pair Request Sent', props);
}
```

### 14. Pair Request Accepted
```typescript
trackPairRequestAccepted(props: { sender_name?: string }): void {
  this.track('Pair Request Accepted', props);
}
```

### 15. Session Ended
```typescript
trackSessionEnded(): void {
  this.track('Session Ended');
}
```

### 16-19. Coach Mark Events
```typescript
trackCoachMarkViewed(props: { step_id: string; step_title: string; tab: string; target_id?: string }): void {
  this.track('Coach Mark Viewed', props);
}

trackCoachMarkCompleted(props: { step_id: string; step_title: string; tab: string }): void {
  this.track('Coach Mark Completed', props);
}

trackCoachMarkSkipped(props: { last_step_seen: string; steps_completed: number; steps_remaining: number }): void {
  this.track('Coach Mark Skipped', props);
}

trackCoachTourCompleted(): void {
  this.track('Coach Tour Completed');
  this.setUserProperties({ coach_tour_completed: true, coach_tour_completed_at: new Date().toISOString() });
}
```

---

## Part 2: Wire New Events to Call Sites

### App Opened — `app/index.tsx`
Find the AppState listener or the main app mount. Fire on app becoming active:
- `source: 'cold'` on initial mount
- `source: 'warm'` on foreground resume (AppState 'active')
- `source: 'push'` when opened via push notification (check if notification data exists)

Also start the session timer: `mixpanelService.timeEvent('Session Ended')` on app open.

### Signup Completed — `app/index.tsx`
In the login useEffect, distinguish first-time vs returning users. Fire `trackSignupCompleted` only when `profile?.has_completed_onboarding === false` (new user who hasn't onboarded yet). Use `setUserPropertyOnce` to ensure it only fires once.

### Card Viewed — `app-mobile/src/components/SwipeableCards.tsx`
Find where the current card is rendered/becomes visible in the swipe deck. Fire when each new card appears. The card object should have `id`, `title`, `category`. Track position with a counter.

### Card Saved — `app-mobile/src/components/SwipeableCards.tsx`
Find the swipe-right handler (near `logAppsFlyerEvent('af_add_to_wishlist')`). Fire alongside it.

### Card Dismissed — `app-mobile/src/components/SwipeableCards.tsx`
Find the swipe-left handler (near `logAppsFlyerEvent('card_dismissed')`). Fire alongside it.

### Paywall Viewed — `app-mobile/src/components/CustomPaywallScreen.tsx`
Near the existing `logAppsFlyerEvent('paywall_viewed')`. Fire alongside it.

### Paywall Dismissed — `app-mobile/src/components/CustomPaywallScreen.tsx`
Find the dismiss/close handler. Fire when user closes paywall without purchasing.

### Feature Gate Hit — `app-mobile/src/hooks/useFeatureGate.ts` or wherever feature gating triggers the paywall
Find where a gated feature check triggers a paywall. Fire before showing the paywall.

### Trial Started — `app-mobile/src/components/OnboardingFlow.tsx`
Near `logAppsFlyerEvent('af_start_trial')`. Fire alongside it.

### Trial Expired — `app-mobile/src/hooks/useSubscription.ts`
Near `logAppsFlyerEvent('trial_expired_no_conversion')`. Fire alongside it.

### Subscription Purchased — `app-mobile/src/hooks/useRevenueCat.ts`
Near `logAppsFlyerEvent('af_subscribe')`. Fire alongside it with plan/tier/revenue props.

### Pair Request Sent — `app-mobile/src/hooks/usePairings.ts`
Near `logAppsFlyerEvent('pair_request_sent')`. Fire alongside it.

### Pair Request Accepted — `app-mobile/src/hooks/usePairings.ts`
Near `logAppsFlyerEvent('pair_request_accepted')`. Already has the pair accept handler.

### Session Ended — `app/index.tsx`
Fire when app goes to background (AppState becomes 'background' or 'inactive'). The timer was started at App Opened, so $duration is automatic.

### Coach Mark Events — `app-mobile/src/contexts/CoachMarkContext.tsx` + `app-mobile/src/components/SpotlightOverlay.tsx`
Read these files to find:
- Where each step becomes active → `trackCoachMarkViewed`
- Where "Got it" / "Next" is tapped → `trackCoachMarkCompleted`
- Where tour is dismissed/skipped → `trackCoachMarkSkipped`
- Where final step completes → `trackCoachTourCompleted`

Also start a timer at tour start: `mixpanelService.timeEvent('Coach Tour Completed')` when step 1 activates.

---

## Part 3: Timed Events

### Onboarding Duration
Already partially done — `trackOnboardingCompleted` exists. Add `mixpanelService.timeEvent('Onboarding Completed')` at the start of onboarding (when `Signup Completed` fires or when OnboardingFlow mounts).

### Card Decision Time
Handled by `trackCardViewed` starting timers for both `Card Saved` and `Card Dismissed`. When either fires, $duration is automatically included.

### Session Length
Handled by `timeEvent('Session Ended')` on App Opened, and `track('Session Ended')` on background.

---

## Constraints

- Do NOT modify existing event names or properties
- Do NOT remove any AppsFlyer calls — Mixpanel calls go NEXT TO them
- All new methods follow the existing guard pattern
- All analytics calls are fire-and-forget
- Follow naming conventions: Title Case events, snake_case properties
- Use `incrementUserProperty` for counters (total_saves, etc.) — not `.set()`

## Success Criteria

1. **SC-1**: ~18 new tracking methods added to mixpanelService.ts
2. **SC-2**: Each method wired to its call site (next to the AppsFlyer equivalent where applicable)
3. **SC-3**: Card decision time tracking works (timeEvent on Card Viewed, auto-$duration on Card Saved/Dismissed)
4. **SC-4**: Session length tracking works (timeEvent on App Opened, track Session Ended on background)
5. **SC-5**: Onboarding duration tracking works (timeEvent at start, auto-$duration on Onboarding Completed)
6. **SC-6**: Coach mark events fire from CoachMarkContext/SpotlightOverlay
7. **SC-7**: `incrementUserProperty('total_saves')` fires on every card save
8. **SC-8**: TypeScript compiles clean
9. **SC-9**: No existing events removed or modified

## Output

Implementation report: `Mingla_Artifacts/outputs/IMPLEMENTATION_ORCH-0393_P0B_REPORT.md`
