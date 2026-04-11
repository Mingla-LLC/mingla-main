# Implementor: Deep Analytics P2 — Engagement Scoring + Onboarding Abandoned + Experience Visited (ORCH-0393)

## Mission

Three final analytics pieces: (1) a Supabase edge function that computes a 0-100 engagement score for every user weekly and pushes it to Mixpanel via HTTP API, (2) Onboarding Abandoned detection on next app open, (3) wire the Experience Visited event from the existing visit flow.

## Evidence Trail

- `Mingla_Artifacts/outputs/PRODUCT_ORCH-0393_DEEP_ANALYTICS_TRACKING_PLAN.md` — section 8 (engagement scoring model)
- P0A/P0B/P1 already shipped — mixpanelService.ts has all foundation methods

## Scope

### IN SCOPE
1. New edge function: `compute-engagement-scores` — reads user activity, computes scores, pushes to Mixpanel
2. New migration: pg_cron job to run the function weekly
3. Onboarding Abandoned detection in app/index.tsx
4. Experience Visited event wired from ActionButtons.tsx visit handler
5. TypeScript compiles clean

### OUT OF SCOPE
- Mixpanel dashboard/funnel configuration (separate manual guide)
- P3 items (A/B testing, server-side events, cross-platform identity)

---

## Change 1: Engagement Scoring Edge Function

### What It Does

Runs weekly via cron. For each active user:
1. Queries activity data from Supabase tables
2. Computes a 0-100 engagement score using the 5-factor model
3. Determines segment (Power/Active/Casual/At-Risk/Dormant)
4. Pushes score + segment to Mixpanel user profile via HTTP API

### Scoring Model (from tracking plan section 8)

| Signal | Weight | 0 Points | 50 Points | 100 Points |
|--------|--------|----------|-----------|------------|
| Recency (days since last active) | 30% | >30 days | 7 days | Today |
| Frequency (sessions in last 14 days) | 25% | 0 | 3-4 | 10+ |
| Depth (cards saved in last 14 days) | 20% | 0 | 3-5 | 15+ |
| Social (friends + sessions active) | 15% | 0 friends, 0 sessions | 2 friends | 5+ friends OR active session |
| Monetization (tier) | 10% | Free, trial expired | Free, trial active | Mingla Plus |

### Score → Segment

| Score | Segment |
|-------|---------|
| 80-100 | power_user |
| 60-79 | active |
| 40-59 | casual |
| 20-39 | at_risk |
| 0-19 | dormant |

### Edge Function Implementation

**File**: `supabase/functions/compute-engagement-scores/index.ts`

```typescript
// Auth: service_role only (cron-triggered)
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EXPO_PUBLIC_MIXPANEL_TOKEN
// Tables read: profiles, user_sessions, saved_card, friends, subscriptions, pairings
// External API: Mixpanel Engage API (https://api.mixpanel.com/engage)
```

**Query to compute scores** — use a single SQL query or RPC that returns:
- `user_id`
- `days_since_active` — from `profiles.updated_at` or last `user_sessions.started_at`
- `sessions_14d` — COUNT from `user_sessions` WHERE `started_at > now() - interval '14 days'`
- `saves_14d` — COUNT from `saved_card` WHERE `created_at > now() - interval '14 days'`
- `friends_count` — COUNT from `friends` WHERE `status = 'accepted'`
- `has_active_session` — EXISTS from `collaboration_sessions` WHERE user is participant
- `tier` — from `subscriptions.tier` or `get_effective_tier(user_id)`
- `trial_active` — from subscription state

**Mixpanel HTTP API** to update user profiles:
```
POST https://api.mixpanel.com/engage#profile-set
Content-Type: application/json

[{
  "$token": "f475c3f34381fef9cc8682a714b5768e",
  "$distinct_id": "<user_id>",
  "$set": {
    "engagement_score": 72,
    "engagement_segment": "active",
    "engagement_scored_at": "2026-04-11T10:00:00Z"
  }
}]
```

The Mixpanel Engage API accepts batches of up to 2000 profiles per request. Process users in batches.

**Error handling**: Log failures but don't throw. If Mixpanel API is down, scores are still computed — they'll be pushed next week.

### Migration for Cron Job

**File**: `supabase/migrations/20260411300001_schedule_engagement_scoring.sql`

```sql
SELECT cron.schedule(
  'compute-engagement-scores-weekly',
  '0 6 * * 1',  -- Every Monday at 6 AM UTC
  $$
  SELECT net.http_post(
    url := (SELECT current_setting('app.settings.supabase_url') || '/functions/v1/compute-engagement-scores'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Use the same pattern as existing cron jobs (see `20260316000003_schedule_notification_cron_jobs.sql` for reference).

---

## Change 2: Onboarding Abandoned Detection

**File**: `app-mobile/app/index.tsx`

On app open, check if the user has a persisted onboarding state (from AsyncStorage) but `profile.has_completed_onboarding` is false. If so, fire:

```typescript
mixpanelService.track('Onboarding Abandoned', {
  last_step: savedOnboardingData?.step ?? 'unknown',
  last_step_name: savedOnboardingData?.stepName ?? 'unknown',
});
```

**Where to check**: In the existing login useEffect, after profile is loaded. If `!profile.has_completed_onboarding` AND the user was previously in onboarding (check AsyncStorage for onboarding persistence key), fire the event ONCE (use a ref to prevent refiring).

**Key files to read**:
- `app-mobile/src/utils/onboardingPersistence.ts` — has `loadOnboardingData()` which reads from AsyncStorage
- `app-mobile/app/index.tsx` — the login useEffect where profile is available

The event should fire ONLY when:
1. User is authenticated (has user.id)
2. Profile is loaded (has_completed_onboarding === false)
3. User has been seen before (not a brand-new signup — check if `$created` was set previously, or if onboarding persistence data exists)
4. Not already fired this session (ref guard)

---

## Change 3: Experience Visited Event

**File**: `app-mobile/src/components/expandedCard/ActionButtons.tsx`

The investigation found:
- `handleVisitPress()` at line 335 exists
- `useRecordVisit()` hook exists in `useVisits.ts`
- The UI shows "Mark Visited" / "I went here" button

Wire the Mixpanel event in the visit handler, after the visit is recorded:

```typescript
mixpanelService.track('Experience Visited', {
  card_id: cardData.id,
  card_title: cardData.title,
  category: cardData.category,
});
```

Add the method to mixpanelService.ts:

```typescript
trackExperienceVisited(props: { card_id: string; card_title: string; category: string }): void {
  this.track('Experience Visited', props);
  this.checkAndFireMilestone('first_visit', 'First Visit', 'first_visit_at');
}
```

Find the `handleVisitPress` in ActionButtons.tsx and add the Mixpanel call after the visit is recorded successfully.

---

## Constraints

- The edge function must use the Mixpanel HTTP API (not the React Native SDK)
- The Mixpanel token can be hardcoded in the edge function (it's a public project token, same as client-side)
- Cron migration follows existing patterns (pg_net.http_post)
- Do NOT deploy the migration — write the SQL file only
- All analytics calls are fire-and-forget
- TypeScript compiles clean

## Success Criteria

1. **SC-1**: Edge function `compute-engagement-scores` exists and computes 0-100 score using 5-factor model
2. **SC-2**: Edge function pushes scores to Mixpanel via HTTP API in batches
3. **SC-3**: Cron migration schedules the function weekly (Monday 6 AM UTC)
4. **SC-4**: Onboarding Abandoned fires once on app open when user has incomplete onboarding
5. **SC-5**: Experience Visited fires when user taps "Mark Visited" with milestone tracking
6. **SC-6**: TypeScript compiles clean
7. **SC-7**: No existing events removed or modified

## Output

Implementation report: `Mingla_Artifacts/outputs/IMPLEMENTATION_ORCH-0393_P2_REPORT.md`
