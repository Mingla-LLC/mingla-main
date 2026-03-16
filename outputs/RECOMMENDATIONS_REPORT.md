# Mingla — AppsFlyer Maximum Granularity Attribution Strategy

> Generated: 2026-03-16 | Mode: Area Focus (Analytics/Attribution) | Confidence: HIGH (all files read)
> Plan: Welcome Plan | 12,000 units | 10M in-app events | 500K MAU

---

## Executive Summary

Your plan gives you **10,000,000 in-app events** against **12,000 installs** — that's **833 events per user**. You have effectively unlimited headroom. The correct strategy is **maximum granularity**: track every meaningful micro-conversion, every funnel step, and every engagement signal with rich parameters. This gives AppsFlyer the data it needs to build precise cohort reports, retargeting audiences, and ROAS calculations.

**Critical gap:** `logAppsFlyerEvent()` exists at `appsFlyerService.ts:77` but has **ZERO callers** in the entire codebase. AppsFlyer currently only sees installs and user IDs — no events whatsoever.

---

## Your Plan's Strengths to Leverage

| Feature | How to Exploit It |
|---------|------------------|
| **10M in-app events** | Track ALL 24 events below (not just 5-12). At 12K installs you'll use ~300K events max. |
| **OneLink deep-linking** | Wire AppsFlyer's `onDeepLinkListener` (already enabled in SDK init at `appsFlyerService.ts:29-30`) to your `deepLinkService.ts` — attribute deep link opens to specific campaigns |
| **Referrals & user invites** | Map your existing referral system (`referral_credits` table, `process-referral` edge function) to AppsFlyer's invite tracking |
| **Cohort & retention reports** | The `af_login` event + rich parameters enable D1/D7/D30 retention cohorts broken down by campaign, country, and onboarding path |
| **Custom dashboard** | Build a funnel dashboard: Install → Register → Onboard → Trial → First Save → First Schedule → Subscribe |
| **Smart Banners** | Once events flow, you can show smart banners on your web presence with deep links that AppsFlyer attributes |

---

## Maximum Granularity Event Plan (24 Events)

### Layer 1: ACQUISITION FUNNEL (5 events)

These measure every step from install to activation. Fire order matters — AppsFlyer uses event sequencing for funnel analysis.

| # | Event Name | Type | When It Fires | Code Location | Parameters |
|---|-----------|------|--------------|---------------|------------|
| 1 | `af_complete_registration` | Standard | OAuth sign-up success (first time only — not returning logins) | `index.tsx:274` — after `setAppsFlyerUserId()` | `af_registration_method`: 'google' \| 'apple', `country`: profile.country |
| 2 | `af_login` | Standard | Returning user auth resolves (not first-time) | `index.tsx:274` — when user already has `has_completed_onboarding: true` | `af_login_method`: 'google' \| 'apple', `days_since_install`: computed |
| 3 | `onboarding_step_completed` | Custom | Each onboarding sub-step completes | `OnboardingFlow.tsx` — where Mixpanel `trackOnboardingStepCompleted()` fires | `step`: number, `step_name`: string (from STEP_SUBSTEPS map), `substep`: string |
| 4 | `af_tutorial_completion` | Standard | `has_completed_onboarding: true` saved to DB | `OnboardingFlow.tsx:243` | `af_success`: true, `af_content`: 'onboarding', `steps_completed`: count, `gender`: string, `country`: string |
| 5 | `af_start_trial` | Standard | Same moment as #4 (DB trigger creates 7-day Elite trial) | `OnboardingFlow.tsx:243` (fire immediately after #4) | `af_trial_type`: 'elite_7day', `af_duration`: 7 |

**Why onboarding_step_completed (#3) matters:** Your onboarding has 7 steps with 17 sub-steps (`useOnboardingStateMachine.ts:11-18`). Tracking each step tells you WHERE users drop off during onboarding — per campaign. If a TikTok campaign's users bail at the location step but Instagram's complete, that's actionable. At 12K installs × 17 sub-steps = 204K events maximum — well within your 10M budget.

### Layer 2: CORE ENGAGEMENT (7 events)

These measure whether users reached the product's core value loop (discover → save → schedule).

| # | Event Name | Type | When It Fires | Code Location | Parameters |
|---|-----------|------|--------------|---------------|------------|
| 6 | `af_content_view` | Standard | Card expanded to full detail view | Where `trackCardExpanded()` fires in components | `af_content_type`: category, `af_content_id`: card_id, `af_price`: estimated_cost, `source`: 'home' \| 'saved' \| 'calendar', `rating`: number |
| 7 | `af_add_to_wishlist` | Standard | Card saved (swipe right) | `userInteractionService.trackSave()` at line 319 | `af_content_type`: category, `af_price`: estimated_cost, `af_content_id`: experience_id, `recommendation_rank`: number |
| 8 | `card_dismissed` | Custom | Card dismissed (swipe left) | `userInteractionService.trackSwipe('left')` | `af_content_type`: category, `recommendation_rank`: number |
| 9 | `experience_scheduled` | Custom | Saved card added to calendar | Where `trackExperienceScheduled()` fires | `af_content_type`: category, `af_date`: scheduled_date, `source`: 'solo' \| 'collaboration', `af_content_id`: card_id |
| 10 | `experience_rescheduled` | Custom | Calendar entry rescheduled | Where `trackExperienceRescheduled()` fires | `af_content_type`: category, `new_date`: string, `date_option`: 'now' \| 'today' \| 'weekend' \| 'custom' |
| 11 | `af_share` | Standard | Experience shared via any method | Where `trackExperienceShared()` fires | `af_content_type`: share_method ('copy_link' \| 'copy_message' \| 'social_platform'), `experience_category`: string |
| 12 | `preferences_updated` | Custom | User modifies discovery preferences | Where `trackPreferencesUpdated()` fires | `is_collaboration`: boolean, `changes_count`: number, `intents_count`: number, `categories_count`: number, `travel_mode`: string, `budget_min`: number, `budget_max`: number |

**Why card_dismissed (#8) matters:** The save:dismiss ratio per campaign source is your single best indicator of targeting quality. A campaign with 80% dismissals is bringing the wrong audience. A campaign with 30% dismissals found your ICP.

### Layer 3: SOCIAL & VIRALITY (5 events)

These measure the social loop: invite → accept → pair → collaborate. Your plan includes "Referrals & user invites" — these events power it.

| # | Event Name | Type | When It Fires | Code Location | Parameters |
|---|-----------|------|--------------|---------------|------------|
| 13 | `af_invite` | Standard | Friend request sent | Where `trackFriendRequestSent()` fires | `af_content_type`: 'friend_request', `invite_method`: 'username' \| 'phone' |
| 14 | `friend_request_accepted` | Custom | Incoming friend request accepted | Where `trackFriendRequestAccepted()` fires | `source`: 'notification' \| 'connections_page' |
| 15 | `pair_request_sent` | Custom | Pair request sent to a friend | pairingService.sendPairRequest() call site | `tier`: current subscription tier |
| 16 | `pair_request_accepted` | Custom | Incoming pair request accepted | pairingService.acceptPairRequest() call site | — |
| 17 | `referral_completed` | Custom | Referral credit awarded (friend accepted + credit status = 'credited') | `process-referral` edge function success OR client-side after referral query | `referrer_id`: uuid, `total_bonus_months`: number |

**Why separate friend vs. pair events:** Friend requests are free for everyone. Pair requests are Elite-only (`canPair()` returns true only for Elite, per `tierLimits.ts:60`). Tracking both shows you: (a) which campaigns bring social users, and (b) which of those convert to the tier that unlocks pairing.

### Layer 4: COLLABORATION (3 events)

These measure the multiplayer engagement loop — your stickiest feature.

| # | Event Name | Type | When It Fires | Code Location | Parameters |
|---|-----------|------|--------------|---------------|------------|
| 18 | `collaboration_session_created` | Custom | Board session created | Where `trackCollaborationSessionCreated()` fires | `invited_count`: number, `session_name_length`: number |
| 19 | `collaboration_invite_sent` | Custom | Invites sent to a session | Where `trackCollaborationInvitesSent()` fires | `session_id`: string, `invited_count`: number, `success_count`: number |
| 20 | `session_switched` | Custom | User switches solo ↔ collaboration | Where `trackSessionSwitched()` fires | `mode`: 'solo' \| 'session', `session_name`: string |

### Layer 5: REVENUE (4 events)

These are your money events. Every cent of ROAS calculation depends on these.

| # | Event Name | Type | When It Fires | Code Location | Parameters |
|---|-----------|------|--------------|---------------|------------|
| 21 | `paywall_viewed` | Custom | User sees the paywall screen | Where `presentPaywall()` or `presentPaywallIfNeeded()` is called, or PaywallScreen renders | `trigger`: 'feature_gate' \| 'profile' \| 'billing' \| 'trial_ending', `current_tier`: string |
| 22 | `af_subscribe` | Standard | RevenueCat purchase succeeds | `useRevenueCat.ts:129` — `usePurchase` mutation `onSuccess` | `af_revenue`: price, `af_currency`: currency_code, `af_content_type`: 'pro' \| 'elite', `af_content_id`: package_identifier, `af_quantity`: 1, `trial_converted`: boolean |
| 23 | `af_subscribe` (renewal) | Standard | **Use RevenueCat → AppsFlyer server integration for this** | RevenueCat dashboard config | `af_revenue`, `af_currency`, `renewal_count` |
| 24 | `trial_expired_no_conversion` | Custom | User's 7-day trial ends without subscribing | Client-side check when `trial_ends_at < NOW()` and tier resolves to 'free' | `days_active_during_trial`: number, `saves_during_trial`: number |

**Critical: paywall_viewed (#21)** — Without this, you know someone subscribed but not how many people SAW the paywall and didn't. Paywall conversion rate per campaign is the key lever for monetization optimization.

---

## Event Budget Math

| Category | Events | Est. per user | × 12K installs | Total |
|----------|--------|--------------|----------------|-------|
| Acquisition (registration, login, onboarding steps) | 5 | ~20 | 240,000 | |
| Core Engagement (views, saves, dismisses, schedules, shares) | 7 | ~50 | 600,000 | |
| Social & Virality (invites, friend/pair actions, referrals) | 5 | ~5 | 60,000 | |
| Collaboration (sessions, invites, switches) | 3 | ~3 | 36,000 | |
| Revenue (paywall, subscribe, trial expiry) | 4 | ~2 | 24,000 | |
| **Total** | **24** | **~80** | | **~960,000** |

**You'll use ~960K of your 10M budget (9.6%).** You have massive headroom. Go granular.

---

## OneLink Deep Linking Setup (Free With Your Plan)

Your SDK already has `onDeepLinkListener: true` at `appsFlyerService.ts:30`, but the deep link data isn't being routed to your `deepLinkService.ts`. Here's what to wire:

### What OneLink Gives You
- **Campaign-attributed deep links**: Create links like `mingla.onelink.me/abc123` that open to specific screens AND carry campaign attribution data
- **Deferred deep linking**: User clicks ad → App Store → installs → opens app → lands on the exact screen from the ad, with attribution preserved
- **Smart banners**: Web visitors see a "Open in Mingla" banner → click → attributed install

### Deep Links to Create in AppsFlyer Dashboard

| Link Purpose | Deep Link Value | Use Case |
|-------------|----------------|----------|
| Home feed | `mingla://home` | Generic app install campaigns |
| Discover | `mingla://discover` | "Find date ideas near you" campaigns |
| Specific session | `mingla://session/{id}` | Collaboration invite links shared via social |
| Subscription | `mingla://subscription` | Trial expiry retargeting ads |
| Onboarding resume | `mingla://onboarding` | Re-engagement for incomplete onboarding |
| Friend profile | `mingla://connections` | "Your friend is on Mingla" referral campaigns |

### Code Change Needed
Route AppsFlyer's deep link callback to your existing parser:

```typescript
// In appsFlyerService.ts — add after initSdk
appsFlyer.onDeepLink((res) => {
  if (res?.deepLinkStatus === 'FOUND') {
    const deepLinkValue = res.data?.deep_link_value; // e.g., 'mingla://discover'
    if (deepLinkValue) {
      // Route to your existing deep link handler
      const action = parseDeepLink(deepLinkValue);
      // Store for execution after auth resolves
      pendingDeepLinkRef.current = action;
    }
  }
});
```

---

## Referral Attribution (Free With Your Plan)

Your plan includes "Referrals & user invites." Your referral system is already built (`referral_credits` table, `process-referral` edge function, `MGL-XXXXXXXX` codes). Here's how to connect it to AppsFlyer:

### What to Configure
1. **AppsFlyer Referral Links**: When user shares their referral code, wrap it in a OneLink: `mingla.onelink.me/referral?referral_code=MGL-ABC12345&af_sub1=MGL-ABC12345`
2. **Attribution flow**: New user installs via referral link → AppsFlyer attributes install to referrer → `af_sub1` carries the referral code → your app reads it from install conversion data and auto-applies the referral

### Code Change Needed
Read referral code from AppsFlyer install data:

```typescript
// In appsFlyerService.ts — add onInstallConversionData handler
appsFlyer.onInstallConversionData((data) => {
  const referralCode = data?.data?.af_sub1;
  if (referralCode?.startsWith('MGL-')) {
    // Store for referral credit creation after onboarding
    AsyncStorage.setItem('pending_referral_code', referralCode);
  }
});
```

---

## Cohort & Retention Dashboard Configuration

With the events above, configure these cohort reports in AppsFlyer:

### Recommended Cohort Reports

| Report | Group By | Measure | Insight |
|--------|----------|---------|---------|
| Activation funnel | Campaign source | af_complete_registration → af_tutorial_completion → af_start_trial | Where each campaign's users drop off |
| Onboarding depth | Campaign source | onboarding_step_completed (step parameter) | Which step kills conversion per source |
| Engagement quality | Campaign source | af_add_to_wishlist count on Day 1, 7, 30 | Which campaigns bring real engagement |
| Save-to-schedule | Campaign source | experience_scheduled / af_add_to_wishlist | Which sources bring users who actually plan outings |
| Viral coefficient | Campaign source | af_invite count / af_tutorial_completion count | Which sources bring users who invite friends |
| Trial conversion | Campaign source | af_subscribe / af_start_trial | Revenue quality per source |
| Paywall → purchase | Campaign source | af_subscribe / paywall_viewed | Paywall effectiveness per audience |
| Retention | Campaign source | af_login on D1, D7, D30 | Long-term user quality per source |

### Custom Dashboard Layout

```
Row 1: [Install Volume] [Registration Rate] [Onboarding Rate] [Trial Start Rate]
Row 2: [Saves D1] [Saves D7] [Schedules D7] [Share Rate]
Row 3: [Invite Rate] [Referral Completion Rate] [Viral Coefficient]
Row 4: [Paywall View Rate] [Trial Conversion Rate] [ROAS] [LTV Projection]
```

---

## Implementation Priority

### Phase 1 (Do Now — Before Running Any Campaigns)
Wire events 1-5 (acquisition funnel) + 22 (subscribe). These are your non-negotiables for any paid marketing.

**Files to touch:** `index.tsx`, `OnboardingFlow.tsx`, `useRevenueCat.ts`
**Effort:** ~15 lines of code, <1 hour

### Phase 2 (Before Scaling Spend)
Wire events 6-12 (core engagement) + 21 (paywall_viewed).

**Files to touch:** Card interaction components, ShareModal, PreferencesSheet, scheduling handlers
**Effort:** ~20 lines, <1 hour

### Phase 3 (Before Referral/Viral Campaigns)
Wire events 13-17 (social) + OneLink deep linking + referral attribution.

**Files to touch:** `appsFlyerService.ts` (deep link handler), friend/pair request components
**Effort:** ~40 lines + AppsFlyer dashboard config, 2-3 hours

### Phase 4 (Ongoing Optimization)
Wire events 18-20 (collaboration) + 24 (trial expiry). Configure cohort dashboards.

**Files to touch:** Collaboration components, trial check logic
**Effort:** ~15 lines + dashboard config, 1-2 hours

---

## What NOT to Track in AppsFlyer

Keep these in Mixpanel only — they're product analytics, not attribution signals:

- Screen views (too granular, no attribution value)
- Tab switches (internal navigation noise)
- Profile setting updates (low-signal for campaign optimization)
- Onboarding step "back" navigation (interesting for UX, not for attribution)
- Preference resets (product metric, not campaign metric)
- Friend blocked/removed (negative actions don't inform campaign quality)

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| `logAppsFlyerEvent()` called before SDK init | Low | Function already guards with `if (!_initialized) return` |
| Double-counting revenue (client + RC server integration) | Medium | Use RC server integration for renewals ONLY; client-side for initial purchase |
| iOS ATT opt-out reduces attribution quality | Medium | SDK already waits 10s for ATT (`timeToWaitForATTUserAuthorization: 10`). Add ATT prompt before onboarding. |
| Event parameter names don't match AF standard schema | Medium | Use exact AF parameter names (`af_revenue`, `af_currency`, `af_content_type`, etc.) — verified against SDK docs |
| Hitting event limit | Very Low | 960K estimated vs 10M limit — 90% headroom |

---

*Report generated by PMM Codebase Analyst | All claims backed by direct code inspection (HIGH confidence)*
*Plan context: Welcome Plan, 12K units, 10M events, 500K MAU — event strategy optimized for maximum granularity*
