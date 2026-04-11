# Analytics Strategy for Launch

> Date: 2026-04-11
> Author: Product Skill
> Status: Strategy recommendation — pending user approval

---

## The Honest Starting Point

Mingla has ~104 app installs, zero paying customers, and zero behavioral data. The analytics plumbing exists (code is written across 4 services) but one service is unplugged (Mixpanel), one is unverified (AppsFlyer), and none of them share information. The notification system is the only thing firing on all cylinders.

This strategy is designed for a team with limited engineering bandwidth launching an iOS-first app with no paid marketing. Every recommendation passes a single filter: **will this data change a decision we make in the first 30 days?**

---

## 1. Top 5 Analytics Questions for Launch

Ranked by "if we can't answer this, we'll make a bad decision."

### Q1: Where do users drop off during onboarding?

**Why this is #1**: Onboarding is the gate to everything. If 80% of users quit at the location permission step, no other feature matters. Every user who fails onboarding is a user you paid to acquire and got nothing from.

**Decision it drives**: Which onboarding step to simplify, reorder, or remove.

**What we need**: Step-by-step completion funnel — how many users start step 1, how many reach step 2, etc. Including substeps.

### Q2: Are users completing the core loop (swipe → save → schedule)?

**Why**: This is the product's reason to exist. If users swipe but never save, the discovery is entertaining but not useful. If they save but never schedule, they're window-shopping. We need to know where the loop breaks.

**Decision it drives**: What to fix first — card quality, save UX, or scheduling flow.

**What we need**: Funnel from first swipe → first save → first schedule → first calendar entry. Per-user, not aggregated.

### Q3: Do connected users (friends/pairs) retain better than solo users?

**Why**: Mingla's thesis is that social planning drives retention. If it's true, we should invest in friend/pair features. If it's not, we should focus on solo discovery quality.

**Decision it drives**: Where to allocate engineering resources — social features vs. discovery.

**What we need**: D1/D7/D30 retention cohorts segmented by "has at least 1 friend" vs. "solo." Friend request sent → accepted conversion rate.

### Q4: What's the trial-to-paid conversion rate?

**Why**: Revenue model viability. 0% conversion means the paywall is broken or the value prop is wrong. Even 2% tells us there's signal.

**Decision it drives**: Whether to adjust pricing, trial length, paywall trigger, or feature gating.

**What we need**: Trial start count, trial expiry count, conversion count, which paywall trigger (feature gate) had the highest conversion.

### Q5: Which push notifications bring users back?

**Why**: Push is the primary re-engagement lever for a pre-launch app with no ad budget. If calendar reminders drive re-opens but re-engagement pushes don't, we know where to invest.

**Decision it drives**: Which notification types to increase/decrease frequency on.

**What we need**: Per-notification-type: sent count, click-through rate, session started after click.

---

## 2. Service Ownership Map

| Question | Primary Service | Secondary | Why |
|----------|----------------|-----------|-----|
| Q1: Onboarding drop-off | **Mixpanel** | AppsFlyer (already tracks steps) | Mixpanel funnels are purpose-built for step-by-step analysis |
| Q2: Core loop completion | **Mixpanel** | — | Sequential user journey analysis is Mixpanel's core strength |
| Q3: Social vs. solo retention | **Mixpanel** | — | Cohort segmentation by user property (has_friend) |
| Q4: Trial-to-paid conversion | **RevenueCat** | AppsFlyer (revenue events) | RevenueCat is the source of truth for subscription state |
| Q5: Push re-engagement | **OneSignal** + **Mixpanel** | — | OneSignal for delivery stats, Mixpanel for post-click behavior (requires push_clicked wiring) |

**AppsFlyer's role at launch**: Passive. It's already firing 25 events. Let it accumulate data. It becomes critical only when paid marketing starts. Don't spend engineering time verifying the dashboard now.

**RevenueCat's role at launch**: Already working. The "104 customers" number is just terminology — ignore it. Focus on trial conversion once users start hitting paywalls.

---

## 3. Minimum Viable Analytics (ranked by priority)

### Tier 1 — Must have before launch (answers Q1-Q4)

| # | Change | Effort | What It Unlocks |
|---|--------|--------|----------------|
| 1 | **Set EXPO_PUBLIC_MIXPANEL_TOKEN in .env** | 5 minutes | Turns on ALL 17 active Mixpanel methods instantly. Screen views, login, card interactions, scheduling, social actions — all start flowing. |
| 2 | **Wire 5 dead onboarding Mixpanel methods** | 30 minutes | The methods exist. The AppsFlyer calls exist in the same locations. Just add the Mixpanel calls next to them in OnboardingFlow.tsx. Answers Q1 completely. |
| 3 | **Wire trackPreferencesUpdated()** | 10 minutes | Method exists, never called. Add call next to the AppsFlyer `preferences_updated` event in PreferencesSheet.tsx. Answers "are users customizing?" |
| 4 | **Add EXPO_PUBLIC_MIXPANEL_TOKEN to .env.example** | 2 minutes | So no developer ever repeats this mistake. |

**Total effort: ~1 hour. Answers Q1, Q2, Q3, Q4 (via RevenueCat for Q4).**

### Tier 2 — Wire within first week (answers Q5)

| # | Change | Effort | What It Unlocks |
|---|--------|--------|----------------|
| 5 | **Populate push_clicked on notification tap** | 20 minutes | One line in the notification click handler. Updates the existing DB column. Answers Q5. |
| 6 | **Fire Mixpanel event on notification click** | 15 minutes | Track which notification type drove re-engagement. Property: notification_type. |
| 7 | **Wire trackFriendRequestSent()** | 5 minutes | Method exists, never called. Call from the same location as `af_invite`. Completes the friend funnel in Mixpanel. |

**Total effort: ~40 minutes. Completes Q5 and the social funnel.**

### Tier 3 — Wire within first month (nice-to-have depth)

| # | Change | Effort | What It Unlocks |
|---|--------|--------|----------------|
| 8 | Wire trackLoginFailed() | 10 min | Visibility into auth failures |
| 9 | Wire trackAccountSettingUpdated() | 10 min | Profile completion tracking |
| 10 | Wire trackDiscoverPersonAdded() | 10 min | Social graph growth tracking |
| 11 | Add Mixpanel events for subscription (purchase, trial_expired, paywall_viewed) | 30 min | Revenue funnel in Mixpanel (not just RevenueCat) |

---

## 4. Deferred Items

| Item | Why Defer | Revisit Trigger |
|------|----------|----------------|
| AppsFlyer dashboard verification | No paid marketing → no attribution value yet | When first paid campaign launches |
| Unified identity layer | Complex, low impact at ~100 users (device sharing unlikely) | When user count exceeds 1,000 or multi-device support is needed |
| Full cross-service event parity | 19 gaps, but each service serves a different purpose | Never — parity for parity's sake wastes engineering time. Fix gaps only when a specific question requires data from a specific service. |
| AppsFlyer logout identity clear | Device sharing is edge case at current scale | When user-reported identity confusion occurs |
| A/B testing infrastructure | Need baseline metrics first | When D7 retention is measurable and stable |
| OneSignal tier tagging | Query-based targeting works fine at current scale | When push audience exceeds 10,000 and segment-based campaigns are needed |

---

## 5. Notification Launch Strategy

### Day 1 Active (critical for engagement)

| Type | Category | Rationale |
|------|----------|-----------|
| friend_request_received | Social | Core social loop — accept/decline drives connection graph |
| friend_request_accepted | Social | Positive reinforcement, drives further social action |
| pair_request_received | Social | Core monetization trigger (pairing is premium) |
| pair_request_accepted | Social | Reinforcement + drives paired discovery |
| collaboration_invite_received | Sessions | Group planning is a key differentiator |
| collaboration_invite_accepted | Sessions | Positive feedback for session creators |
| direct_message_received | Messages | Essential for social features. DM bypass quiet hours = correct. |
| board_message_mention | Messages | @mentions are high-signal, low-volume |
| calendar_reminder_tomorrow | Reminders | Drives actual experience completion (the "Go" step) |
| calendar_reminder_today | Reminders | Same — without this, scheduled experiences get forgotten |
| onboarding_incomplete | Marketing | Recovers drop-offs. Only fires once per user. Low spam risk. |
| trial_ending | Marketing | Revenue-critical. Must remind before trial lapses. |

### Enabled but Monitored (watch for fatigue)

| Type | Category | What to Watch |
|------|----------|--------------|
| board_card_saved | Sessions | Can be noisy in active sessions. Monitor: if users disable collaboration_invites preference, reduce frequency. |
| board_card_voted | Sessions | Same — watch disable rate. |
| board_message_received | Messages | Group chat can be spammy. 5-min bucket dedup is good. Watch disable rate. |
| paired_user_saved_card | Social | 3/day limit is good. Watch if users find it intrusive. |
| holiday_reminder | Reminders | Nice personal touch. Only fires when holidays exist. Low risk. |
| visit_feedback_prompt | Reminders | Post-visit is high-intent moment. But could feel nagging if too frequent. |
| referral_credited | Social | Pure positive signal. Very low volume. Keep active. |

### Disabled Until Proven (too risky without data)

| Type | Category | Why Disable |
|------|----------|------------|
| re_engagement_3d | Marketing | A brand-new app has no baseline for "inactive." Users who installed 3 days ago and haven't returned may not appreciate a push. Enable after D7 retention baseline is established. |
| re_engagement_7d | Marketing | Same reasoning but worse — 7-day push to someone who tried the app once and left feels desperate. Enable after 500+ users with retention data. |
| weekly_digest | Marketing | No meaningful activity data to summarize at launch. Enable when average user has >5 saves and >1 visit per week. |

### Deferred (not needed yet)

| Type | Category | Why Defer |
|------|----------|----------|
| session_member_left | Sessions | Negative signal. No proven value in notifying when someone leaves. Enable only if user research shows demand. |
| collaboration_invite_declined | Sessions | Already in-app only (no push). Keep as-is. |
| paired_user_visited | Social | Already in-app only. Keep as-is. |
| board_card_rsvp | Sessions | Low priority — RSVP feature isn't core to initial session use. Enable when sessions have >3 participants regularly. |
| board_card_message | Messages | Card-specific comments are a power-user feature. Enable when board usage proves regular. |

---

## 6. North Star Metric

### **Weekly Active Planners (WAP)**

**Definition**: Users who saved OR scheduled at least one experience in the last 7 days.

**Why this, not MAU or DAU**:
- MAU is vanity at 104 users. It doesn't tell you if the product works.
- DAU rewards addictive behavior, not value delivery.
- **"Saved or scheduled"** captures the product's core value proposition: helping people plan real experiences. A user who saves a card has demonstrated intent. A user who schedules has committed.
- It's measurable today: `af_add_to_wishlist` (AppsFlyer) + `experience_scheduled` (both services) give us this number immediately.
- It naturally grows as the product improves: better cards → more saves. Better scheduling → more calendar entries. Better social → more collaborative saves.

**Measurement**: Mixpanel cohort: users where `Card Expanded` OR `Experience Scheduled` event occurred in trailing 7 days. Cross-reference with RevenueCat tier for free vs. paid breakdown.

**Target**: At launch, 20% of active users should be Weekly Active Planners. If less than 10%, the save/schedule flow needs urgent attention.

---

## 7. Quick Wins (< 1 hour total)

| # | What | Time | Impact |
|---|------|------|--------|
| 1 | Set EXPO_PUBLIC_MIXPANEL_TOKEN in .env | 5 min | **Massive** — unlocks all behavioral data instantly |
| 2 | Add token to .env.example | 2 min | Prevents recurrence |
| 3 | Remove EXPO_PUBLIC_FOURSQUARE_API_KEY from .env | 1 min | Clean dead config |
| 4 | Wire 5 onboarding Mixpanel methods in OnboardingFlow.tsx | 30 min | Onboarding funnel visibility |
| 5 | Wire trackPreferencesUpdated() in PreferencesSheet.tsx | 10 min | Preference usage visibility |
| 6 | Wire trackFriendRequestSent() in useFriends.ts | 5 min | Complete friend funnel |
| 7 | Populate push_clicked on notification tap | 20 min | Push engagement tracking |

**Total: ~73 minutes of engineering work. Answers all 5 launch questions.**

---

## Summary: The One-Page Version

**North Star**: Weekly Active Planners (users who saved/scheduled in last 7 days)

**Top 5 Questions**: Onboarding drop-off → Core loop completion → Social retention lift → Trial conversion → Push re-engagement

**Service roles**: Mixpanel = behavioral intelligence (the one to fix NOW). RevenueCat = revenue truth (already working). AppsFlyer = attribution (defer). OneSignal = engagement engine (already working, wire push_clicked).

**Engineering ask**: ~73 minutes of work to go from zero analytics to launch-ready analytics. The code is already written — just set one token and call 7 existing methods.

**Notification launch plan**: 12 types active day 1, 7 monitored, 3 disabled until retention data exists, 5 deferred.

**What NOT to do**: Don't build a unified identity layer. Don't chase cross-service parity. Don't verify AppsFlyer dashboards. Don't build A/B testing. All deferred until you have enough users to make those investments worthwhile.
