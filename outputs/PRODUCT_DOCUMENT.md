# Mingla — Product Document

> Created: 2026-03-16 | Status: Partial (Analytics/Attribution focus) | Other sections pending full analysis

---

## 1. Product Overview

**Product:** Mingla — AI-powered experience discovery and social planning app
**Platform:** React Native (Expo) — iOS and Android
**Category:** B2C consumer app — social/lifestyle/experiences
**Core Loop:** Discover experiences → Save → Schedule → Plan with friends

> Updated: 2026-03-16 | Trigger: Initial area-focus analysis | Evidence: app-mobile/app/index.tsx, navigation, services | Confidence: H

---

## 2. Monetization Model

### Subscription Tiers (RevenueCat)

| Feature | Free | Pro | Elite |
|---------|------|-----|-------|
| Daily swipes | 20 | Unlimited | Unlimited |
| Pairings | 0 | 0 | Unlimited |
| Board sessions | 1 | 3 | Unlimited |
| Members per session | 5 | 5 | 15 |
| Curated cards | No | Yes | Yes |
| Custom starting point | No | Yes | Yes |

**Trial:** 7-day Elite access starts automatically on onboarding completion (DB trigger: `trg_create_subscription_on_onboarding`)

**Referral bonus:** 1 month Elite per accepted friend referral (unlimited earning potential)

**Effective tier resolution:** RevenueCat entitlement > active trial > referral bonus > Free

> Updated: 2026-03-16 | Trigger: AppsFlyer event analysis | Evidence: tierLimits.ts, revenueCatService.ts, subscriptionService.ts | Confidence: H

---

## 3. Analytics & Attribution Stack

### Architecture

```
User Action → Component
    ├→ mixpanelService.track*(...)        [Product events — 25+ events, fully wired]
    ├→ logAppsFlyerEvent(...)             [Attribution events — DEFINED BUT NOT WIRED]
    ├→ userInteractionService.track*()    [Detailed behavior → Supabase]
    └→ abTestingService.trackEvent()      [A/B test events → Supabase]
```

### AppsFlyer (Attribution)
- **SDK:** react-native-appsflyer ^6.17.8
- **Status:** Initialized at app startup, user ID linked on auth
- **Gap:** `logAppsFlyerEvent()` has ZERO callers — no in-app events reach AppsFlyer
- **Impact:** Cannot attribute downstream behavior (subscriptions, engagement) to campaigns
- **Files:** appsFlyerService.ts, index.tsx:59,267,274

### Mixpanel (Product Analytics)
- **SDK:** mixpanel-react-native ^3.3.0
- **Status:** Fully implemented with 25+ events
- **Events tracked:** Login, Onboarding (step viewed/completed/skipped/back), Preferences, Collaboration, Screen views, Card expansion, Experience scheduling/rescheduling, Friend requests, Sharing, Profile updates, Account settings
- **File:** mixpanelService.ts

### Supabase (Behavioral Analytics)
- **Status:** Fully implemented
- **Interaction types:** view, like, dislike, save, unsave, share, schedule, unschedule, click_details, swipe_left, swipe_right, tap
- **Context captured:** Category, price, rating, time of day, day of week, location, recommendation source/rank, time spent, scroll depth
- **Tables:** user_interactions, user_sessions, user_location_history, user_preference_learning
- **File:** userInteractionService.ts

### RevenueCat (Revenue)
- **SDK:** react-native-purchases ^9.12.0
- **Entitlements:** 'Mingla Pro', 'Mingla Elite'
- **File:** revenueCatService.ts

### OneSignal (Push Notifications)
- **SDK:** react-native-onesignal ^5.3.3
- **File:** oneSignalService.ts

### A/B Testing
- **Status:** Implemented for recommendation algorithm testing
- **File:** abTestingService.ts

> Updated: 2026-03-16 | Trigger: AppsFlyer event analysis | Evidence: All analytics service files | Confidence: H

---

## 4. Lifecycle & Retention Mechanics

### Activation Path
1. Install → OAuth signup (Google/Apple)
2. Onboarding flow (8 steps: phone, OTP, gender, birthday, country, language, location, preferences)
3. `has_completed_onboarding: true` → triggers subscription creation with 7-day Elite trial
4. First card deck loads → user starts swiping

### Lifecycle Notifications (Edge Function: notify-lifecycle)
| Type | Trigger | Timing |
|------|---------|--------|
| `onboarding_incomplete` | Signup without completing onboarding | 24+ hours after signup |
| `trial_ending` | Free trial about to expire | 1 day before trial_ends_at |
| `re_engagement` (3-day) | User inactive 3-7 days | Weekly bucket |
| `re_engagement` (7-day) | User inactive 7+ days | Biweekly bucket, personalized with friend name |
| `weekly_digest` | Active users in last 30 days | Weekly, includes stats (saves, visits, connections) |

### Referral Loop
1. User gets unique `referral_code` (format: `MGL-XXXXXXXX`)
2. Referred friend accepts friend request
3. DB trigger credits 1 month Elite to referrer
4. Push notification via notify-dispatch

> Updated: 2026-03-16 | Trigger: AppsFlyer event analysis | Evidence: notify-lifecycle/index.ts, subscriptionService.ts | Confidence: H

---

## 5-15. [Pending Full Analysis]

The following sections require a full product analysis (Mode F) to populate:
- User Model & Roles
- Core Feature Flows
- Navigation & Information Architecture
- Social & Collaboration System
- Content Model
- Search & Discovery
- Settings & Configuration
- Error Handling & Edge Cases
- Performance Characteristics
- Security Model

---

*Document maintained by PMM Codebase Analyst | Source of truth: codebase, not documentation*
