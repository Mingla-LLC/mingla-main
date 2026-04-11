# Product Skill: Deep Analytics Tracking Plan (ORCH-0393)

## Mission

Design a state-of-the-art Mixpanel implementation that gives Mingla genius-level understanding of every user throughout their entire lifecycle. This isn't "track some events" — this is "build a behavioral intelligence system" using every Mixpanel feature available.

The goal: when you look at any user in Mixpanel, you can answer:
- Who are they? (demographics, intent, taste profile)
- How did they get here? (acquisition source, referral chain)
- Where are they in their journey? (lifecycle stage, activation status)
- What do they love? (category affinity, feature usage patterns)
- Are they healthy? (engagement velocity, churn risk signals)
- What's their revenue potential? (tier, conversion likelihood)
- Who do they influence? (social graph, referral power)

## Context

### What We Have Today (just shipped)

Mixpanel is live with 17 active tracking methods:
- Login, logout, screen views
- Card expanded (home, saved, calendar)
- Experience scheduled, rescheduled
- Experience shared (copy message, social, copy link)
- Preferences reset, preferences updated
- Friend request accepted/declined/sent, friend removed, friend blocked
- Collaboration session created, invites sent, session switched
- Custom holiday added
- Tab viewed
- Profile picture/setting updated
- Onboarding step viewed/completed/back/completed
- Push notification clicked

### What's Missing (the gap to genius-level)

1. **User Properties** — we call `identify()` and set email/provider, but we don't build a rich user profile in Mixpanel. No demographics, no preferences, no tier, no lifecycle stage.

2. **Super Properties** — no global properties set that attach to every event (like current_tier, has_friends, city, platform).

3. **Increment Properties** — no running counters on user profiles (total_cards_saved, total_experiences_scheduled, total_friends, sessions_count).

4. **Timed Events** — no duration tracking (how long does onboarding take? how long between first save and first schedule?).

5. **Revenue Tracking** — Mixpanel has a `$revenue` people property but we never set it. RevenueCat tracks revenue, but Mixpanel can't build revenue funnels.

6. **Lifecycle Stage Tracking** — no concept of "this user is in activation" vs "this user is retained" vs "this user is churning."

7. **Content Quality Signals** — we track card_expanded but not: which categories get saved vs dismissed? which card sources (pool vs curated) perform better?

8. **Session Depth** — we track screen views but not: how many cards did they swipe per session? how deep into discovery did they go?

9. **Social Graph Metrics** — we track friend requests but not: how many friends does this user have? are they a connector or an isolate?

10. **Churn Risk Signals** — no tracking of declining engagement velocity, preference changes that signal dissatisfaction, or feature abandonment.

11. **Feature Discovery** — we don't track first-time feature usage (first time using map, first time creating a session, first time messaging).

12. **Funnel Events** — some critical funnel steps are missing events entirely (card swipe left/right as separate events with properties, save confirmation, schedule confirmation).

## What Mixpanel Can Do (features to leverage)

Reference the React Native SDK docs. Key capabilities:

1. **User Profiles (People)** — `.getPeople().set()` for persistent user properties
2. **Super Properties** — `.registerSuperProperties()` for properties on every event
3. **Increment** — `.getPeople().increment()` for running counters
4. **Timed Events** — `.timeEvent()` to measure duration between start and end
5. **Union** — `.getPeople().union()` for list-type properties (categories_saved, features_used)
6. **Once Properties** — `.getPeople().setOnce()` for first-time values (first_save_date, signup_source)
7. **Group Analytics** — `.setGroup()` for analyzing by cohort/group
8. **Revenue** — `.getPeople().trackCharge()` for revenue tracking

## Deliverables

### 1. User Property Architecture

Define EVERY property that should live on the Mixpanel user profile. Organize by:

**Identity Properties** (set once at signup)
- signup_date, signup_method, country, city, platform, app_version, etc.

**Demographic Properties** (set during onboarding, updated when changed)
- gender, age_range, intent (dating/friends/solo), language, etc.

**Preference Properties** (updated when preferences change)
- favorite_categories, price_tier_preference, travel_mode, etc.

**Lifecycle Properties** (updated as user progresses)
- lifecycle_stage (new/activated/engaged/retained/churning/dormant)
- onboarding_completed (boolean + date)
- activation_status (what activation criteria have been met)
- last_active_date

**Social Properties** (updated on social actions)
- friends_count, pairs_count, sessions_count
- is_connected (boolean — has at least 1 friend)
- referral_count

**Revenue Properties** (updated on subscription changes)
- current_tier (free/mingla_plus)
- trial_status (active/expired/converted)
- total_revenue (via trackCharge)
- subscription_start_date

**Engagement Properties** (incremented over time)
- total_cards_saved, total_cards_dismissed
- total_experiences_scheduled, total_experiences_completed
- total_sessions_created, total_messages_sent
- total_shares

### 2. Super Properties Architecture

Define global properties that attach to EVERY event automatically:

- current_tier, has_friends, city, platform, app_version, session_mode (solo/collab), etc.

These should be set on login and updated when relevant state changes.

### 3. Event Taxonomy (Complete)

Define every event that should exist, organized by lifecycle stage:

**Acquisition** → **Onboarding** → **Activation** → **Engagement** → **Retention** → **Revenue** → **Referral**

For each event:
- Event name (standardized naming convention)
- Properties (every property with type and example value)
- When it fires (exact user action)
- Why it matters (what question does this answer)
- Which funnel(s) it belongs to

Include events that DON'T exist yet but should.

### 4. Funnel Definitions

Define the key funnels that should be built in Mixpanel:

**Onboarding Funnel**: App Open → Sign In → Step 1 → Step 2 → ... → Complete
**Activation Funnel**: First Screen → First Swipe → First Save → First Schedule → First Go
**Social Funnel**: First Friend Request → First Accept → First Session → First Collab Save
**Revenue Funnel**: Paywall View → Package Select → Purchase → Renewal
**Re-engagement Funnel**: Push Received → Push Clicked → Session Started → Action Taken

For each funnel: the exact events, the expected conversion rates, and what a drop-off at each stage means.

### 5. Cohort Definitions

Define user cohorts for analysis:
- By signup week (for retention curves)
- By acquisition source
- By onboarding completion
- By social connection status
- By subscription tier
- By engagement level (power/casual/at-risk/dormant)
- By city/country

### 6. Timed Event Strategy

Which user actions should have duration tracking?
- Onboarding (total time)
- Time to first save (from signup)
- Time to first schedule (from first save)
- Time to first friend (from signup)
- Session duration (per app open)
- Card decision time (how long they look before swiping)

### 7. First-Time Event Strategy

Track "first time" milestones:
- First card save
- First experience scheduled
- First friend added
- First session created
- First message sent
- First share
- First map interaction
- First paywall view
- First purchase

These should use `.getPeople().setOnce()` to record the date of first occurrence.

### 8. Engagement Scoring Model

Define how to calculate an engagement score from tracked data:
- What signals indicate a healthy user?
- What signals indicate churn risk?
- How to segment users into power/casual/at-risk/dormant?

### 9. Dashboard Recommendations

What Mixpanel dashboards should be built?
- Daily pulse (North Star + top 5 metrics)
- Onboarding health
- Feature adoption
- Social network growth
- Revenue pipeline
- Churn risk monitor

### 10. Implementation Priority

Rank every new tracking addition by:
- **P0**: Must have before launch (answers the 5 core questions)
- **P1**: First week after launch
- **P2**: First month
- **P3**: Nice to have

## Constraints

- Everything must be implementable via `mixpanel-react-native` SDK (not browser SDK)
- Methods available: track, identify, getPeople().set/setOnce/increment/union/trackCharge, registerSuperProperties, timeEvent, setGroup
- Budget: Mixpanel free tier (up to 20M events/month — plenty for current scale)
- No backend changes for analytics — all tracking is client-side
- Don't break existing events — add to them, don't restructure

## Output

Save as: `Mingla_Artifacts/outputs/DEEP_ANALYTICS_TRACKING_PLAN.md`

This should be the single reference document that an implementor reads and wires up — every event, every property, every funnel, every cohort, every dashboard. Nothing left to interpretation.
