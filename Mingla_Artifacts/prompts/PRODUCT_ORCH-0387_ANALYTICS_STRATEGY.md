# Product Skill: Analytics Strategy for Launch (ORCH-0387)

## Mission

Define what analytics questions Mingla must be able to answer at launch, then scope exactly which events, services, and integrations need to be wired to answer them. This is product strategy, not engineering — tell us WHAT to measure and WHY, and the engineering team will figure out HOW.

## Context

Mingla has 4 external analytics/engagement services. They're all partially wired but none are fully operational:

- **Mixpanel** (behavioral analytics) — 33 tracking methods written, 17 actively called from code, but **completely dead** because `EXPO_PUBLIC_MIXPANEL_TOKEN` was never set. Zero data in the dashboard.
- **AppsFlyer** (attribution/marketing) — 25 events wired and firing, but never verified in the dashboard. No paid marketing yet.
- **RevenueCat** (subscriptions) — working. 0 paying users. 104 "customers" = app opens, not revenue.
- **OneSignal** (push notifications) — production-grade. 29 notification types, preferences, quiet hours, rate limiting. Working well.

The services don't talk to each other. Identity is fragmented. There are 19 cross-service parity gaps (events tracked in one service but not the other).

## What You Have to Work With

Read this document BEFORE answering — it's the verified ground truth:
`Mingla_Artifacts/outputs/INVESTIGATION_ANALYTICS_NOTIFICATION_ARCHITECTURE.md`

It contains:
1. **AppsFlyer Event Map** — every event, file:line, properties
2. **Mixpanel Event Map** — every method, which are active vs dead, call sites
3. **OneSignal Notification Registry** — every notification type, template, preference category
4. **Identity Lifecycle** — when each service identifies/clears users across 5 scenarios
5. **Cross-Service Parity Matrix** — gaps between services

Also reference:
- `Mingla_Artifacts/outputs/INVESTIGATION_CODE_INVENTORY.md` — 57 edge functions, 79 services, env var registry
- `Mingla_Artifacts/PRODUCT_SNAPSHOT.md` — current product state (92A, 24B, 4C, 4D, 168F out of 292 items)

## Questions to Answer

### 1. What are the 5 most important analytics questions for launch?

Think from the perspective of: what decisions will the team need to make in the first 30 days after launch, and what data do they need to make them?

Examples of question categories:
- **Acquisition**: Where do users come from? What's the install-to-onboarding conversion?
- **Activation**: What % complete onboarding? Where do they drop off?
- **Engagement**: Which features are used? How often do users return?
- **Retention**: Are users coming back after day 1? Day 7? Day 30?
- **Revenue**: What's the trial-to-paid conversion? Which paywall trigger converts best?
- **Social**: Are friend/pair features driving retention? Do connected users churn less?
- **Notifications**: Which push types drive re-engagement? What's the click-through rate?

### 2. Which service should own which question?

Map each question to the service best suited to answer it:
- **Mixpanel** — behavioral funnels, retention cohorts, feature usage, user journeys
- **AppsFlyer** — attribution, install source, campaign ROI (only relevant with paid marketing)
- **RevenueCat** — subscription metrics, trial conversion, revenue, churn
- **OneSignal** — push delivery rates, click-through, re-engagement (if push_clicked is wired)

### 3. What's the minimum viable analytics setup for launch?

Given that:
- Mixpanel is dead (needs token set + possibly wire 11 dead methods)
- AppsFlyer has 25 events but no verification
- OneSignal push_clicked is never populated
- No unified identity layer exists

What's the SMALLEST set of changes that answers the top 5 questions? Prioritize ruthlessly.

### 4. What can wait until post-launch?

Explicitly defer things that aren't needed for day-1 decisions. Examples:
- Full cross-service event parity (nice to have, not launch-blocking)
- Unified identity layer (important but complex)
- AppsFlyer dashboard verification (only matters with paid marketing)
- A/B testing infrastructure

### 5. What notification types should be active at launch?

Of the 29 notification types in OneSignal, which ones should be:
- **Active from day 1** — critical for user engagement
- **Enabled but monitored** — turned on but watch for spam complaints
- **Disabled until proven** — too risky without data on user tolerance
- **Deferred** — not needed yet (e.g., re-engagement for a brand new app)

### 6. What's the analytics "North Star" metric?

One number the team checks daily. What should it be for Mingla at launch?

## Constraints

- Mingla is pre-launch. No paying users yet. ~104 app installs.
- No paid marketing planned for launch (AppsFlyer attribution is future value).
- The app is iOS-first (TestFlight). Android is secondary.
- Budget for analytics tools is minimal — use free tiers where possible.
- Engineering bandwidth is limited — every analytics task competes with bug fixes.

## Output Format

Produce a strategy document with:

1. **Top 5 Analytics Questions** (ranked by launch importance)
2. **Service Ownership Map** (which service answers which question)
3. **Minimum Viable Analytics** (exact changes needed, ranked by priority)
4. **Deferred Items** (what can wait, with trigger conditions for when to revisit)
5. **Notification Launch Strategy** (which of the 29 types are day-1 active)
6. **North Star Metric** (one number, with definition and measurement method)
7. **Quick Wins** (things that take <1 hour and deliver immediate value)

Save as: `Mingla_Artifacts/outputs/ANALYTICS_STRATEGY_FOR_LAUNCH.md`
