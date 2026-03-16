# Mingla — AppsFlyer In-App Event Map

> **Living document** — updated whenever analytics-related code changes.
> Last updated: 2026-03-16 | Confidence: HIGH (all source files read)
> Plan: Welcome Plan | 12,000 units | 10M events | 500K MAU

---

## Plan Budget

| Resource | Limit | Estimated Usage | Headroom |
|----------|-------|----------------|----------|
| Install units | 12,000 | — | — |
| In-app events | 10,000,000 | ~960,000 (at 12K installs × ~80 events/user) | 90% unused |
| MAU | 500,000 | — | — |

**Strategy:** Maximum granularity. Track every meaningful micro-conversion with rich parameters.

---

## Current Implementation Status

| Component | File | Status |
|-----------|------|--------|
| SDK initialization | `appsFlyerService.ts:21` → `initializeAppsFlyer()` | Wired in `index.tsx:267` |
| User ID linking | `appsFlyerService.ts:55` → `setAppsFlyerUserId()` | Wired in `index.tsx:274` |
| Event logging function | `appsFlyerService.ts:77` → `logAppsFlyerEvent()` | **WIRED — 19 events across 11 files** |
| Deep link listener | `appsFlyerService.ts:30` → `onDeepLinkListener: true` | Enabled but not routed to `deepLinkService.ts` |
| Install conversion data | `appsFlyerService.ts:29` → `onInstallConversionDataListener: true` | Enabled but referral code not extracted |

---

## Event Map

### Layer 1: Acquisition Funnel

> Purpose: Measure every step from install to activation. Answers "did the ad actually work?"

| # | Event Name | AF Standard? | Fire Point | Code Location | Parameters | Layman Explanation |
|---|-----------|:---:|------------|---------------|------------|-------------------|
| 1 | `af_complete_registration` | Yes | First-time OAuth success (Google/Apple) | `index.tsx:274` — after `setAppsFlyerUserId()` | `af_registration_method`: 'google' \| 'apple', `country`: profile.country | User created an account. First proof the ad brought a real human. |
| 2 | `af_login` | Yes | Returning user auth resolves (not first-time) | `index.tsx:274` — when `has_completed_onboarding: true` | `af_login_method`: 'google' \| 'apple' | User came back and opened the app again. Measures stickiness. |
| 3 | `onboarding_step_completed` | No | Each onboarding sub-step completes | `OnboardingFlow.tsx` — alongside `mixpanelService.trackOnboardingStepCompleted()` | `step`: number, `step_name`: string, `substep`: string | User finished one step of setup. Shows WHERE people drop off — per campaign. |
| 4 | `af_tutorial_completion` | Yes | `has_completed_onboarding: true` saved to DB | `OnboardingFlow.tsx:243` | `af_success`: true, `af_content`: 'onboarding', `steps_completed`: count, `gender`: string, `country`: string | User finished the ENTIRE onboarding. #1 activation event — trial starts here. |
| 5 | `af_start_trial` | Yes | Same moment as #4 (DB trigger creates 7-day Elite trial) | `OnboardingFlow.tsx:243` — fire after #4 | `af_trial_type`: 'elite_7day', `af_duration`: 7 | 7-day free Elite trial just started. Builds retargeting audience. |

**Onboarding sub-steps** (from `useOnboardingStateMachine.ts:11-18`):

| Step | Sub-steps |
|------|----------|
| 1 | welcome, phone, otp, gender_identity, details |
| 2 | value_prop, intents |
| 3 | location |
| 4 | celebration, categories, budget, transport, travel_time (+ manual_location if no GPS) |
| 5 | friends_and_pairing |
| 6 | collaborations |
| 7 | consent, getting_experiences |

---

### Layer 2: Core Engagement

> Purpose: Measure whether users reach the core value loop (discover → save → schedule). Answers "are they actually using the app?"

| # | Event Name | AF Standard? | Fire Point | Code Location | Parameters | Layman Explanation |
|---|-----------|:---:|------------|---------------|------------|-------------------|
| 6 | `af_content_view` | Yes | Card expanded to full detail view | Alongside `mixpanelService.trackCardExpanded()` | `af_content_type`: category, `af_content_id`: card_id, `af_price`: estimated_cost, `source`: 'home' \| 'saved' \| 'calendar', `rating`: number | User tapped a card to see details — they were genuinely interested. |
| 7 | `af_add_to_wishlist` | Yes | Card saved (swipe right) | `userInteractionService.trackSave()` at line 319 | `af_content_type`: category, `af_price`: estimated_cost, `af_content_id`: experience_id, `recommendation_rank`: number | User SAVED an experience. Core product action — like adding to cart. |
| 8 | `card_dismissed` | No | Card dismissed (swipe left) | `userInteractionService.trackSwipe('left')` | `af_content_type`: category, `recommendation_rank`: number | User swiped left (not interested). Save:dismiss ratio = targeting quality. |
| 9 | `experience_scheduled` | No | Saved card added to calendar | Alongside `mixpanelService.trackExperienceScheduled()` | `af_content_type`: category, `af_date`: scheduled_date, `source`: 'solo' \| 'collaboration', `af_content_id`: card_id | User added an experience to their calendar — real-world intent. Strongest engagement signal. |
| 10 | `experience_rescheduled` | No | Calendar entry rescheduled | Alongside `mixpanelService.trackExperienceRescheduled()` | `af_content_type`: category, `new_date`: string, `date_option`: 'now' \| 'today' \| 'weekend' \| 'custom' | User moved a scheduled experience to a different date. Still engaged. |
| 11 | `af_share` | Yes | Experience shared via any method | Alongside `mixpanelService.trackExperienceShared()` | `af_content_type`: share_method, `experience_category`: string | User shared an experience outside the app. Free organic distribution. |
| 12 | `preferences_updated` | No | User modifies discovery preferences | Alongside `mixpanelService.trackPreferencesUpdated()` | `is_collaboration`: boolean, `changes_count`: number, `intents_count`: number, `categories_count`: number, `travel_mode`: string | User customized their settings — a sign of investment in the app. |

---

### Layer 3: Social & Virality

> Purpose: Measure the social loop (invite → accept → pair → collaborate). Answers "are they bringing friends?"

| # | Event Name | AF Standard? | Fire Point | Code Location | Parameters | Layman Explanation |
|---|-----------|:---:|------------|---------------|------------|-------------------|
| 13 | `af_invite` | Yes | Friend request sent | Alongside `mixpanelService.trackFriendRequestSent()` | `af_content_type`: 'friend_request', `invite_method`: 'username' \| 'phone' | User sent a friend request. First step of the viral loop. |
| 14 | `friend_request_accepted` | No | Incoming friend request accepted | Alongside `mixpanelService.trackFriendRequestAccepted()` | `source`: 'notification' \| 'connections_page' | Someone accepted the user's friend request. Social connection is live. |
| 15 | `pair_request_sent` | No | Pair request sent to a friend | `pairingService.sendPairRequest()` call site | `tier`: current subscription tier | User asked a friend to pair (Elite-only feature). Shows premium social usage. |
| 16 | `pair_request_accepted` | No | Incoming pair request accepted | `pairingService.acceptPairRequest()` call site | — | Pair request accepted. Paired users are the stickiest cohort. |
| 17 | `referral_completed` | No | Referral credit awarded (`referral_credits.status = 'credited'`) | After `process-referral` edge function confirms credit, or client-side referral query | `total_bonus_months`: number | Referral actually worked — invited person joined. Completed viral loop. |

---

### Layer 4: Collaboration

> Purpose: Measure multiplayer engagement — the stickiest feature. Answers "are they planning with others?"

| # | Event Name | AF Standard? | Fire Point | Code Location | Parameters | Layman Explanation |
|---|-----------|:---:|------------|---------------|------------|-------------------|
| 18 | `collaboration_session_created` | No | Board session created | Alongside `mixpanelService.trackCollaborationSessionCreated()` | `invited_count`: number | User created a group planning board. Multiplayer engagement driver. |
| 19 | `collaboration_invite_sent` | No | Invites sent to a session | Alongside `mixpanelService.trackCollaborationInvitesSent()` | `session_id`: string, `invited_count`: number, `success_count`: number | User invited friends to their board. More invites = more viral spread. |
| 20 | `session_switched` | No | User switches solo ↔ collaboration | Alongside `mixpanelService.trackSessionSwitched()` | `mode`: 'solo' \| 'session' | User toggled between solo and group mode. Active multiplayer usage. |

---

### Layer 5: Revenue

> Purpose: Track every cent. Answers "are they paying — and is my ad spend profitable?"

| # | Event Name | AF Standard? | Fire Point | Code Location | Parameters | Layman Explanation |
|---|-----------|:---:|------------|---------------|------------|-------------------|
| 21 | `paywall_viewed` | No | User sees the upgrade screen | Where `presentPaywall()` / `presentPaywallIfNeeded()` is called, or PaywallScreen renders | `trigger`: 'feature_gate' \| 'profile' \| 'billing' \| 'trial_ending', `current_tier`: string | User saw the upgrade screen. Without this, you can't calculate paywall conversion rate. |
| 22 | `af_subscribe` | Yes | RevenueCat purchase succeeds | `useRevenueCat.ts:129` — `usePurchase` mutation `onSuccess` | `af_revenue`: price, `af_currency`: currency_code, `af_content_type`: 'pro' \| 'elite', `af_content_id`: package_identifier, `af_quantity`: 1, `trial_converted`: boolean | User PAID. The money event. AppsFlyer uses this to calculate ROAS. |
| 23 | `af_subscribe` (renewal) | Yes | Subscription auto-renews | **RevenueCat → AppsFlyer server integration** (dashboard config, no client code) | `af_revenue`, `af_currency`, `renewal_count` | Auto-renewal. Measures lifetime value per campaign — not just first purchase. |
| 24 | `trial_expired_no_conversion` | No | 7-day trial ends without subscribing | Client-side: when `trial_ends_at < NOW()` and tier resolves to 'free' | `days_active_during_trial`: number, `saves_during_trial`: number | Trial ended, user didn't subscribe. Builds "lost trial" retargeting audience. |

---

## Subscription Tiers Reference

> From `tierLimits.ts` and `subscriptions` migration

| Feature | Free | Pro | Elite |
|---------|------|-----|-------|
| Daily swipes | 20 | Unlimited | Unlimited |
| Pairings | 0 | 0 | Unlimited |
| Board sessions | 1 | 3 | Unlimited |
| Members per session | 5 | 5 | 15 |
| Curated cards | No | Yes | Yes |
| Custom starting point | No | Yes | Yes |

**Trial:** 7-day Elite on onboarding completion (trigger: `trg_create_subscription_on_onboarding`)
**Referral bonus:** 1 month Elite per accepted referral (trigger: `credit_referral_on_friend_accepted`)
**Tier resolution:** RevenueCat entitlement > active trial > referral bonus > Free

---

## OneLink Deep Links (Included in Plan)

| Link Purpose | Deep Link URI | Campaign Use Case |
|-------------|--------------|-------------------|
| Home feed | `mingla://home` | Generic install campaigns |
| Discover | `mingla://discover` | "Find experiences near you" campaigns |
| Specific session | `mingla://session/{id}` | Collaboration invite links shared via social |
| Subscription | `mingla://subscription` | Trial expiry retargeting ads |
| Onboarding resume | `mingla://onboarding` | Re-engagement for incomplete onboarding |
| Connections | `mingla://connections` | "Your friend is on Mingla" referral campaigns |
| Saved | `mingla://saved` | "Check your saved experiences" re-engagement |
| Calendar | `mingla://calendar/{entryId}` | "Your experience is tomorrow" reminder campaigns |

**Status:** `onDeepLinkListener` enabled in SDK init but NOT routed to `deepLinkService.ts`. Needs wiring.

---

## Referral Attribution (Included in Plan)

| Component | Location | Status |
|-----------|----------|--------|
| Referral codes | `profiles.referral_code` (format: `MGL-XXXXXXXX`) | Auto-generated on profile creation |
| Credit trigger | `credit_referral_on_friend_accepted` DB trigger | Atomically credits 1 month Elite |
| Notification | `process-referral` edge function → `notify-dispatch` | Sends push to referrer |
| AF integration | `onInstallConversionDataListener` | Enabled but NOT reading `af_sub1` referral code |

**Gap:** Referral links should use OneLink with `af_sub1=MGL-XXXXXXXX` so AppsFlyer attributes the install to the referrer.

---

## Cohort Reports to Configure

| Report | Group By | Measure Event(s) | Insight |
|--------|----------|------------------|---------|
| Activation funnel | Campaign source | #1 → #4 → #5 | Where each campaign's users drop off |
| Onboarding depth | Campaign source | #3 (by step param) | Which onboarding step kills conversion per source |
| Engagement quality | Campaign source | #7 count on D1, D7, D30 | Which campaigns bring real engagement |
| Save-to-schedule | Campaign source | #9 / #7 | Which sources bring users who actually plan outings |
| Viral coefficient | Campaign source | #13 count / #4 count | Which sources bring users who invite friends |
| Trial conversion | Campaign source | #22 / #5 | Revenue quality per source |
| Paywall conversion | Campaign source | #22 / #21 | Paywall effectiveness per audience |
| Retention (Dx) | Campaign source | #2 on D1, D7, D30 | Long-term user quality per source |

---

## Custom Dashboard Layout

```
Row 1: [Install Volume] [Registration Rate] [Onboarding Rate] [Trial Start Rate]
Row 2: [Saves D1]       [Saves D7]          [Schedules D7]    [Share Rate]
Row 3: [Invite Rate]    [Referral Rate]      [Viral Coefficient]
Row 4: [Paywall Views]  [Trial Conversion]   [ROAS]            [LTV Projection]
```

---

## Implementation Phases

| Phase | Events | Files to Modify | Effort | When |
|-------|--------|----------------|--------|------|
| 1 — Before any campaigns | #1-5, #22 | `index.tsx`, `OnboardingFlow.tsx`, `useRevenueCat.ts` | ~15 lines, <1hr | Now |
| 2 — Before scaling spend | #6-12, #21 | Card components, ShareModal, PreferencesSheet, schedule handlers | ~20 lines, <1hr | Before paid UA |
| 3 — Before referral campaigns | #13-17 + OneLink + referral wiring | `appsFlyerService.ts`, friend/pair components | ~40 lines + dashboard config, 2-3hr | Before viral campaigns |
| 4 — Ongoing optimization | #18-20, #24 + cohort dashboards | Collaboration components, trial check logic | ~15 lines + dashboard, 1-2hr | Iterative |

---

## What NOT to Track in AppsFlyer (Keep in Mixpanel Only)

These are product analytics, not attribution signals:

- Screen views / tab switches (internal navigation noise)
- Profile setting updates (low attribution signal)
- Onboarding "back" navigation (UX metric, not campaign metric)
- Preference resets (product metric)
- Friend blocked/removed (negative actions don't inform campaign quality)

---

## Change Log

| Date | Change | Trigger | Evidence |
|------|--------|---------|----------|
| 2026-03-16 | Initial creation — full 24-event map | AppsFlyer plan setup | All analytics service files, OnboardingFlow.tsx, useOnboardingStateMachine.ts, tierLimits.ts, subscriptions migration, referral_credits migration, process-referral edge function, revenueCatService.ts, useRevenueCat.ts, deepLinkService.ts, notify-lifecycle edge function |
| 2026-03-16 | Wired 19 of 24 events across 11 files | Implementation | index.tsx, OnboardingFlow.tsx, SwipeableCards.tsx, SavedTab.tsx, CalendarTab.tsx, ShareModal.tsx, CollaborationSessions.tsx, InviteParticipantsModal.tsx, FriendsModal.tsx, FriendRequestsModal.tsx, usePairings.ts, useRevenueCat.ts, CustomPaywallScreen.tsx. Not wired: #12 preferences_updated (no call site), #13 af_invite (no call site), #17 referral_completed (server-side), #23 renewal (RC server integration), #24 trial_expired (needs new client logic) |
