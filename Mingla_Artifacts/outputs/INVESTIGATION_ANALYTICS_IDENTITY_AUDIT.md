# Analytics & Identity Integration Audit

> ORCH-0387 | Severity: S1 | Class: data-integrity
> Date: 2026-04-11
> Status: Investigation complete, pending user direction

---

## Executive Summary

Mingla has four external services for user analytics and engagement: **Mixpanel** (behavioral analytics), **RevenueCat** (subscriptions/revenue), **AppsFlyer** (attribution/marketing), and **OneSignal** (push notifications). All four use the same Supabase UUID as user identity. But they operate in silos — no service knows what the others are doing, and one is completely dead.

---

## System-by-System Findings

### 1. Mixpanel — COMPLETELY DEAD

| Aspect | Status |
|--------|--------|
| SDK installed | Yes (`mixpanel-react-native@^3.3.0`) |
| Service written | Yes (519 lines, 40+ tracking methods) |
| Integrated in app | Yes (19 files, all user journeys covered) |
| Token configured | **NO — `EXPO_PUBLIC_MIXPANEL_TOKEN` not in any .env** |
| Data in dashboard | Zero |

**Root cause**: The service checks for the token at startup. When missing, it logs a warning and every tracking call becomes a silent no-op. The entire behavioral analytics pipeline is wired but unplugged.

**Impact**: Zero visibility into user behavior — no funnel data, no retention cohorts, no feature usage metrics, no screen flow analytics. Product decisions are flying blind.

### 2. RevenueCat — Working but Misleading

| Aspect | Status |
|--------|--------|
| SDK installed | Yes (`react-native-purchases@^9.12.0`) |
| User identification | Supabase UUID (correct) |
| Anonymous handling | SDK-generated → merge on login |
| Subscription sync | RC → Supabase after purchase/restore |
| API keys | Hardcoded per platform (acceptable for RC) |

**The "104 customers" problem**: RevenueCat counts any device that interacted with the SDK as a "customer." Since `configureRevenueCat()` runs on every app mount — even for anonymous users before sign-in — every app open registers a "customer." The 104 number likely represents total unique devices/users who have opened the app, not paying customers.

**Potential inflation sources**:
- Anonymous → identified merges may not deduplicate perfectly
- Test/dev devices during development
- Simulator builds (though RC usually warns about these)

**What's actually correct**: 0 active subscriptions, $0 revenue — nobody has paid. The revenue/subscription data is truthful. Only the "customer" count framing is misleading.

### 3. AppsFlyer — Most Complete Client-Side, Never Audited

| Aspect | Status |
|--------|--------|
| SDK installed | Yes (`react-native-appsflyer@^6.17.8`) |
| User identification | Supabase UUID via `setAppsFlyerUserId()` |
| Device registration | Yes — stored in `appsflyer_devices` table for S2S |
| Events tracked | 22 custom events across 14 files |
| S2S events | Yes (referral_completed via edge function) |
| Dashboard verified | **Never audited** |

**Events covered**: Login, registration, trial start, subscribe, trial expiry, experience scheduling, collaboration, friend/pair activity, card interactions, sharing, paywall views, onboarding completion, preferences, session switching.

**Key gap**: Nobody has verified these events actually arrive in the AppsFlyer dashboard correctly. The event map document may be stale.

### 4. OneSignal — Production-Grade, Most Mature

| Aspect | Status |
|--------|--------|
| SDK installed | Yes (`react-native-onesignal@^5.3.3`) |
| User identification | Supabase UUID as `external_id` |
| Edge functions | 11 notification functions |
| Notification types | 15+ types across 6 categories |
| Preferences | Per-category toggles + quiet hours |
| Rate limiting | Per-type, per-user, per-5min window |
| Idempotency | Key-based dedup on every notification |
| Deep linking | Full support with pending link queue |
| Badge management | iOS increment + reset on open |
| Cleanup | Weekly cron (90-day TTL) |

**Strengths**: This is a well-engineered system. Central dispatcher pattern, preference enforcement, timezone-aware quiet hours, DM bypass option, action buttons on pushes, realtime sync to in-app notification center.

**Gaps found**:
- `push_clicked` column exists in notifications table but is never populated
- Android channels commented out due to OneSignal 400 errors
- `dm_bypass_quiet_hours` toggle exists in DB but not exposed in settings UI
- No analytics tracking of push delivery/click rates (not sent to Mixpanel or AppsFlyer)

---

## Identity Lifecycle — The Full Picture

### How each service identifies users

| Service | User ID | When Set | When Cleared | Anonymous Phase |
|---------|---------|----------|-------------|-----------------|
| OneSignal | Supabase UUID (external_id) | Post-auth (`loginToOneSignal`) | Sign-out (`logoutOneSignal`) | SDK device ID |
| RevenueCat | Supabase UUID (appUserId) | App mount + post-auth | Sign-out (`logoutRevenueCat`) | RC anonymous ID → merge |
| AppsFlyer | Supabase UUID (customerUserId) | Post-auth (`setAppsFlyerUserId`) | Never explicitly cleared | AF device UID |
| Mixpanel | Supabase UUID (identify) | Post-auth (`trackLogin`) | Sign-out (`reset`) | Anonymous (DEAD) |

### Identity sequence on app launch (index.tsx)

```
1. configureRevenueCat(user?.id ?? null)     — line 257
2. initializeOneSignal()                      — line 282
3. loginToOneSignal(user.id)                  — line 291 (if authenticated)
4. setAppsFlyerUserId(user.id)                — line 314 (if authenticated)
5. registerAppsFlyerDevice(user.id)           — line 315 (if authenticated)
6. mixpanelService.initialize()               — line 251
7. mixpanelService.trackLogin()               — line 922 (on auth state change)
```

### Identity sequence on sign-out (AppStateManager.tsx)

```
1. resetOneSignalIdentity()                   — line 746
2. logoutRevenueCat()                         — line 749 (fire-and-forget)
3. mixpanelService.reset()                    — line 756 (dynamic import)
4. [AppsFlyer — NOT cleared]                  — gap
```

### Critical gaps

1. **AppsFlyer identity is never cleared on logout** — if user A logs out and user B logs in on the same device, AppsFlyer may still attribute events to user A until `setAppsFlyerUserId(userB.id)` runs on the new session.

2. **No unified identity event** — each service is identified independently. If any one call fails silently, that service disagrees with the others about who the user is. There's no verification or reconciliation.

3. **Mixpanel is dead** — even if the token were set, the identity call only fires on auth state change. If the auth state doesn't change (app reopen with persisted session), Mixpanel may not re-identify.

4. **RevenueCat anonymous merge risk** — anonymous purchases before sign-in get merged, but if the merge fails silently, the user loses their purchase history on that device.

---

## Cross-Service Integration Gaps

### What DOES talk to each other

| Event | Source | Destination | Status |
|-------|--------|-------------|--------|
| Purchase | RevenueCat | AppsFlyer (`af_subscribe`) | Working |
| Purchase | RevenueCat | Supabase (`syncSubscriptionFromRC`) | Working |
| Trial expiry | Subscription hook | AppsFlyer (`trial_expired_no_conversion`) | Working |
| Paywall view | Custom paywall | AppsFlyer (`paywall_viewed`) | Working |
| Referral | Edge function | AppsFlyer S2S (`referral_completed`) | Working |

### What DOES NOT talk to each other

| Gap | Impact |
|-----|--------|
| Push delivery → no analytics event | Can't measure notification effectiveness |
| Push click → `push_clicked` never set | Can't measure engagement from notifications |
| OneSignal segments → not informed by RC tier | Can't target pushes by subscription status |
| AppsFlyer attribution → not stored in Supabase | Can't see where users came from in admin |
| Mixpanel → dead | No behavioral analytics at all |
| RC "customer" count → not reconciled with Supabase auth.users | Can't verify if counts match |
| Purchase → no Mixpanel event | Can't build revenue funnels in Mixpanel |
| Notification preference changes → no analytics | Can't see if users disable pushes |
| Sign-out → AppsFlyer not cleared | Identity contamination risk |

---

## Notification System — Complete Type Inventory

### Edge Functions (11 total)

| Function | Trigger | Types Sent |
|----------|---------|------------|
| notify-dispatch | Central hub (all others call this) | — |
| notify-message | Client call | direct_message_received, board_message_received, board_message_mention, board_card_message |
| notify-calendar-reminder | Cron hourly @:15 | calendar_reminder_tomorrow, calendar_reminder_today, visit_feedback_prompt |
| notify-holiday-reminder | Cron daily 9AM UTC | holiday_reminder |
| notify-invite-response | Client call | collaboration_invite_accepted, collaboration_invite_declined (no push) |
| notify-lifecycle | Cron daily 10AM UTC | onboarding_incomplete, trial_ending, re_engagement_3d/7d, weekly_digest |
| notify-pair-activity | Client call | paired_user_saved_card, paired_user_visited (no push) |
| notify-pair-request-visible | Client call | pair_request_received |
| notify-referral-credited | pg_net trigger | referral_credited |
| send-friend-accepted-notification | Client call | friend_request_accepted |
| send-pair-accepted-notification | Client call | pair_request_accepted |

### Client-Side Notifications (boardNotificationService.ts)

| Event | Type | Sent To |
|-------|------|---------|
| Card saved to board | board_card_saved | Other participants |
| Card voted | board_card_voted | Card saver |
| Card RSVP'd | board_card_rsvp | Card saver |
| Member joined session | session_member_joined | Other participants |
| Member left session | session_member_left | Other participants |

### Preference Categories

| Category | Pref Key | Default | Types Governed |
|----------|----------|---------|----------------|
| Social | friend_requests | TRUE | friend_request_*, pair_request_*, paired_user_* |
| Sessions | collaboration_invites | TRUE | collaboration_invite_*, session_member_*, board_card_* |
| Messages | messages | TRUE | direct_message_*, board_message_* |
| Reminders | reminders | TRUE | calendar_reminder_*, holiday_reminder, visit_feedback_prompt |
| Marketing | marketing | FALSE | re_engagement_*, weekly_digest, onboarding_incomplete, trial_ending |

### Quiet Hours

- Window: 10 PM – 8 AM in user's timezone
- Exception: DMs bypass if `dm_bypass_quiet_hours = true`
- Enforced server-side in notify-dispatch

---

## Documentation State

| Document | Current State | Needs Update |
|----------|--------------|-------------|
| AppsFlyer Event Map (outputs/) | May be stale | Yes — verify against 22 events found |
| World Map (ORCH-0242, 0243) | Grade F, unaudited | Yes — update with investigation findings |
| README | No analytics section | Yes — add analytics architecture overview |
| .env.example | Missing MIXPANEL_TOKEN | Yes — add with instructions |
| COVERAGE_MAP | Analytics at "Weak" | Yes — update coverage |

---

## Recommended Approach

### Option A: Full Integration Sweep (recommended)

**Phase 1 — Fix what's broken (immediate)**
1. Set Mixpanel token in .env (and .env.example)
2. Clear AppsFlyer identity on logout
3. Populate `push_clicked` on notification tap
4. Verify all 22 AppsFlyer events arrive in dashboard

**Phase 2 — Build unified identity layer**
1. Create `analyticsIdentityService.ts` — single function called on login/logout that identifies/clears ALL 4 services atomically
2. Add error recovery: if any service fails to identify, log + retry
3. Add identity verification: on app foreground, check all services agree on current user

**Phase 3 — Cross-service event bridge**
1. Fire Mixpanel events for: push sent, push clicked, subscription change, tier change
2. Store AppsFlyer attribution data in Supabase for admin visibility
3. Set OneSignal tags from RevenueCat tier (enables targeted push campaigns)
4. Add notification preference change tracking to Mixpanel

**Phase 4 — Documentation sync**
1. Update AppsFlyer event map
2. Create analytics architecture document
3. Update README with analytics setup instructions
4. Update .env.example
5. Update World Map grades

### Option B: Quick-win first

1. Set Mixpanel token → data starts flowing immediately
2. Fix AppsFlyer logout gap
3. Defer everything else

### Option C: Product-first scope

1. Define what analytics questions matter for launch
2. Only fix what's needed to answer those questions
3. Defer nice-to-haves
