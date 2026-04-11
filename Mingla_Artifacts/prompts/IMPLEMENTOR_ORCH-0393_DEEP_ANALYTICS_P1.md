# Implementor: Deep Analytics P1 — New Events + First-Time Milestones (ORCH-0393)

## Mission

Complete the P1 analytics implementation: add remaining events, wire first-time milestones with AsyncStorage persistence, add Card Viewed with deck position tracking, and wire the Experience Scheduled timed event. This completes all 5 funnels with full event coverage.

## Evidence Trail

- `Mingla_Artifacts/outputs/PRODUCT_ORCH-0393_DEEP_ANALYTICS_TRACKING_PLAN.md` — sections 3, 7, 10 (P1)
- P0A committed `122bb927`, P0B committed `f4ce00b4`
- mixpanelService.ts now has: registerSuperProperties, timeEvent, incrementUserProperty, setUserPropertyOnce, plus 19 tracking methods from P0B

## Scope

### IN SCOPE
1. Add ~10 new tracking methods to mixpanelService.ts
2. Wire Card Viewed with deck position tracking in SwipeableCards.tsx
3. Wire Deck Exhausted event
4. Wire Feature Gate Hit in useFeatureGate.ts or consuming components
5. Wire remaining social events (Session Joined, Board Card Voted, Pair Declined, Referral Link Shared)
6. Wire Experience Unsaved
7. Add 9 first-time milestones with AsyncStorage flags + setUserPropertyOnce
8. Add Experience Scheduled timed event (save→schedule duration)
9. Add remaining P1 user properties (demographics, preferences)
10. TypeScript compiles clean

### OUT OF SCOPE
- Engagement scoring edge function (P2)
- Onboarding Abandoned detection (P2 — needs next-open check logic)
- Experience Visited (needs visit confirmation flow — may not exist yet)
- Mixpanel dashboard/funnel configuration (manual config, not code)
- Server-side events (P3)

---

## Part 1: New Tracking Methods in mixpanelService.ts

### 1. Deck Exhausted
```typescript
trackDeckExhausted(props: { cards_seen: number; cards_saved: number; cards_dismissed: number; session_mode: string }): void
```
Already defined in P0B. Just needs wiring.

### 2. Feature Gate Hit
```typescript
trackFeatureGateHit(props: { feature: string; current_tier: string }): void
```
Already defined in P0B. Just needs wiring.

### 3. Collaboration Session Joined
```typescript
trackCollaborationSessionJoined(props: { session_id: string; session_name: string; inviter_name?: string }): void {
  this.track('Collaboration Session Joined', props);
  this.incrementUserProperty('total_sessions_participated');
}
```

### 4. Board Card Voted
```typescript
trackBoardCardVoted(props: { session_id: string; card_id: string; vote: 'up' | 'down' }): void {
  this.track('Board Card Voted', props);
}
```

### 5. Pair Request Declined
```typescript
trackPairRequestDeclined(props: { sender_name?: string }): void {
  this.track('Pair Request Declined', props);
}
```

### 6. Referral Link Shared
```typescript
trackReferralLinkShared(props: { method: string }): void {
  this.track('Referral Link Shared', props);
}
```

### 7. Experience Unsaved
```typescript
trackExperienceUnsaved(props: { card_id: string; card_title: string; category: string }): void {
  this.track('Experience Unsaved', props);
}
```

---

## Part 2: Wire Card Viewed with Deck Position

**File**: `app-mobile/src/components/SwipeableCards.tsx`

The swipe deck shows one card at a time. Add a position counter ref:

```typescript
const deckPositionRef = useRef(0);
```

Increment it each time a card is swiped (in the swipe handler). Fire `trackCardViewed` when the next card becomes the current card. Find where `currentRec` (or equivalent) updates to the next card in the deck — that's when a new card is "viewed."

The card data has `.id`, `.title`, `.category`, and `.cardType`. Use `cardType === 'curated'` for `is_curated`.

**Key**: Don't fire on every re-render — only fire when the card index changes. Use a ref to track the last-fired card ID and skip if it's the same.

---

## Part 3: Wire Feature Gate Hit

**File**: `app-mobile/src/hooks/useFeatureGate.ts` or wherever the paywall is triggered from a feature check.

Search the codebase for where `CustomPaywallScreen` is rendered and what `feature` prop is passed. The `Feature Gate Hit` event should fire at the moment the user attempts a gated action, BEFORE the paywall opens. The properties are `feature` (which gated feature) and `current_tier` (user's current tier).

Look for patterns like:
```typescript
if (!canAccess('curated_cards')) {
  showPaywall('curated_cards');
}
```

Add `mixpanelService.trackFeatureGateHit({ feature: 'curated_cards', current_tier: tier })` right before the paywall opens.

---

## Part 4: Wire Remaining Social Events

### Collaboration Session Joined
**File**: `app-mobile/src/services/collaborationInviteService.ts` or wherever invite acceptance results in joining a session.
Search for `acceptCollaborationInvite` — fire after successful join.

### Board Card Voted
**File**: `app-mobile/src/components/board/` — search for vote handler
Search for the vote/thumbs-up/thumbs-down handler in board card components.

### Pair Request Declined
**File**: `app-mobile/src/hooks/usePairings.ts`
Search for `declinePairRequest` mutation — fire in onSuccess.

### Referral Link Shared
**File**: Search for referral link copy/share handler. Check `ShareModal.tsx` or profile page for referral link sharing.

### Experience Unsaved
**File**: `app-mobile/src/components/activity/SavedTab.tsx` or wherever unsave/remove-from-saves happens.
Search for unsave handler.

---

## Part 5: First-Time Milestones (9 milestones)

Each milestone fires ONCE per user lifetime. Implementation pattern:

```typescript
// In the tracking method:
private async checkAndFireMilestone(key: string, eventName: string, property: string): Promise<void> {
  try {
    const fired = await AsyncStorage.getItem(`mp_milestone_${key}`);
    if (fired) return;
    this.track(eventName);
    this.setUserPropertyOnce({ [property]: new Date().toISOString() });
    AsyncStorage.setItem(`mp_milestone_${key}`, '1').catch(() => {});
  } catch {
    // Silently skip — milestone tracking is non-critical
  }
}
```

Add this private method to MixpanelService, then call it from the relevant tracking methods:

| # | Milestone | Fire From | AsyncStorage Key | User Property |
|---|----------|-----------|-----------------|---------------|
| 1 | First Card Saved | `trackCardSaved()` | `mp_milestone_first_save` | `first_save_at` |
| 2 | First Card Expanded | `trackCardExpanded()` | `mp_milestone_first_expand` | `first_expand_at` |
| 3 | First Experience Scheduled | `trackExperienceScheduled()` | `mp_milestone_first_schedule` | `first_schedule_at` |
| 4 | First Friend Added | `trackFriendRequestAccepted()` | `mp_milestone_first_friend` | `first_friend_at` |
| 5 | First Session Created | `trackCollaborationSessionCreated()` | `mp_milestone_first_session` | `first_session_at` |
| 6 | First Pair Formed | `trackPairRequestAccepted()` | `mp_milestone_first_pair` | `first_pair_at` |
| 7 | First Share | `trackExperienceShared()` | `mp_milestone_first_share` | `first_share_at` |
| 8 | First Referral | (when referral event fires — may not exist client-side) | `mp_milestone_first_referral` | `first_referral_at` |
| 9 | First Visit | (when experience visited fires — deferred if no client event) | `mp_milestone_first_visit` | `first_visit_at` |

**Import AsyncStorage** at the top of mixpanelService.ts:
```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
```

**Important**: The `checkAndFireMilestone` method is async but should be fire-and-forget from the tracking methods. Don't await it — just call it.

---

## Part 6: Experience Scheduled Timed Event

In `trackCardSaved()`, add `this.timeEvent('Experience Scheduled')` — this starts the timer when a card is saved. When `trackExperienceScheduled()` fires later (could be minutes, hours, or days later), the `$duration` property will show the save-to-schedule gap.

**Note**: Since `timeEvent` persists until the event fires (or the SDK resets), this works even across app sessions. But if the user saves multiple cards before scheduling any, only the LAST save's timer will be active. This is acceptable — it measures the most recent save-to-schedule gap.

---

## Part 7: Additional P1 User Properties

At login (in `trackLogin`), add these P1 properties if available in scope:

```typescript
// P1 demographic properties
gender: user.gender,
language: user.language,
age: user.age, // if calculable from birthday

// P1 engagement properties
total_sessions_participated: user.sessionsCount,
referral_count: user.referralCount,
sessions_count: user.sessionsCount,
```

Read the login call site in index.tsx to see what additional profile data is available. Add only what's in scope — don't fetch new data.

---

## Constraints

- Do NOT modify existing event names or properties
- Do NOT remove any AppsFlyer calls
- AsyncStorage milestone keys must be prefixed with `mp_milestone_` to avoid collision
- Milestone checks are fire-and-forget — never block user actions
- All analytics calls are fire-and-forget
- Follow naming conventions: Title Case events, snake_case properties

## Success Criteria

1. **SC-1**: Card Viewed fires when each new card appears in the deck, with position_in_deck
2. **SC-2**: Deck Exhausted fires when no more cards are available
3. **SC-3**: Feature Gate Hit fires when user attempts a gated action
4. **SC-4**: All social events wired (Session Joined, Board Voted, Pair Declined, Referral Shared)
5. **SC-5**: Experience Unsaved fires on card removal from saves
6. **SC-6**: 9 first-time milestones implemented with AsyncStorage persistence
7. **SC-7**: Experience Scheduled timed event starts on card save
8. **SC-8**: TypeScript compiles clean
9. **SC-9**: No existing events removed or modified

## Output

Implementation report: `Mingla_Artifacts/outputs/IMPLEMENTATION_ORCH-0393_P1_REPORT.md`
