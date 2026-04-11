# Mixpanel Dashboard & Funnel Setup Guide

> Date: 2026-04-11
> For: Manual configuration in Mixpanel UI (mixpanel.com)
> Prerequisite: All P0/P1/P2 analytics events must be shipping data first

---

## Step 1: Create the 5 Funnels

### Funnel 1: Onboarding

**Name**: Onboarding Funnel
**Steps** (in order):
1. `Signup Completed`
2. `Onboarding Step Completed` WHERE `step_name` = "Account Setup"
3. `Onboarding Step Completed` WHERE `step_name` = "Intent Selection"
4. `Onboarding Step Completed` WHERE `step_name` = "Location Setup"
5. `Onboarding Completed`

**Conversion window**: 1 hour
**Breakdown by**: `platform`, `login_provider` (in method property)

### Funnel 2: Activation

**Name**: Activation Funnel
**Steps**:
1. `Onboarding Completed`
2. `Card Viewed`
3. `Card Saved`
4. `Card Expanded`
5. `Experience Scheduled`

**Conversion window**: 7 days
**Breakdown by**: `subscription_tier`, `city`

### Funnel 3: Social

**Name**: Social Funnel
**Steps**:
1. `Friend Request Sent`
2. `Friend Request Accepted` (as receiver)
3. `Collaboration Session Created`
4. `Board Card Voted`

**Conversion window**: 30 days
**Breakdown by**: `subscription_tier`, `friends_count`

### Funnel 4: Revenue

**Name**: Revenue Funnel
**Steps**:
1. `Trial Started`
2. `Paywall Viewed` WHERE `gated_feature` IS SET (Feature Gate Hit)
3. `Paywall Viewed` (any trigger)
4. `Subscription Purchased`

**Conversion window**: 30 days
**Breakdown by**: `gated_feature`, `platform`

### Funnel 5: Re-engagement

**Name**: Re-engagement Funnel
**Steps**:
1. `Push Notification Clicked`
2. `App Opened`
3. `Card Viewed`
4. `Card Saved`

**Conversion window**: 1 hour
**Breakdown by**: `notification_type`

---

## Step 2: Create the 6 Dashboards

### Dashboard 1: Daily Pulse (check every morning)

Create a new dashboard called "Daily Pulse" with these reports:

| Report Name | Type | Event | Metric | Time Range |
|------------|------|-------|--------|-----------|
| DAU | Insights | `App Opened` | Unique users | Last 7 days, daily |
| New Signups | Insights | `Signup Completed` | Total count | Last 7 days, daily |
| Onboarding Rate | Funnel | Onboarding Funnel | Conversion % | Last 7 days |
| Cards Saved | Insights | `Card Saved` | Total count | Last 7 days, daily |
| Push Click Rate | Insights formula | `Push Notification Clicked` / (estimate from OneSignal) | Ratio | Last 7 days |

### Dashboard 2: Activation Board (check weekly)

| Report Name | Type | Event | Details |
|------------|------|-------|---------|
| Activation Rate | Funnel | Activation Funnel | % reaching Card Saved within 7 days |
| Time to First Save | Insights | Look at milestone gap: `$created` → `first_save_at` on user profiles | Use Insights → User Profiles → first_save_at minus $created |
| First-Session Save Rate | Insights | `Card Saved` WHERE session = same as `Onboarding Completed` | Within 5 min window |
| Activation by Platform | Funnel | Activation Funnel | Breakdown by `platform` |
| Activation by Login Method | Funnel | Activation Funnel | Breakdown by `method` |

### Dashboard 3: Retention Board (check weekly)

| Report Name | Type | Details |
|------------|------|---------|
| D1 / D7 / D30 Retention | Retention | First event: `App Opened`, Return event: `App Opened` |
| Retention by Tier | Retention | Same, breakdown by `subscription_tier` |
| Retention: Paired vs Solo | Retention | Same, breakdown by `is_paired` |
| Retention: Social vs Solo | Retention | Same, segment by `friends_count` >= 3 vs < 3 |
| WAU Trend | Insights | `App Opened` unique users, 7-day rolling, 12-week chart |

### Dashboard 4: Revenue Board (check weekly)

| Report Name | Type | Details |
|------------|------|---------|
| Trial → Paid Conversion | Funnel | Revenue Funnel |
| Paywall → Purchase Rate | Insights formula | `Subscription Purchased` / `Paywall Viewed` |
| Feature Gate → Purchase by Feature | Funnel | Revenue Funnel, breakdown by `gated_feature` |
| Paywall Dismissal Rate | Insights formula | `Paywall Dismissed` / `Paywall Viewed` |
| Avg Time on Paywall | Insights | `Paywall Dismissed`, show `$duration` average |

### Dashboard 5: Social Board (check weekly)

| Report Name | Type | Details |
|------------|------|---------|
| Friend Requests / DAU | Insights formula | `Friend Request Sent` count / `App Opened` unique users |
| Friend Accept Rate | Insights formula | `Friend Request Accepted` / `Friend Request Sent` |
| % Users with 1+ Friend | Insights | User profiles WHERE `friends_count` >= 1 |
| Sessions Created / Week | Insights | `Collaboration Session Created` count, weekly |
| Pair Formation Rate | Insights formula | `Pair Request Accepted` / `Pair Request Sent` |

### Dashboard 6: Content Quality Board (check weekly)

| Report Name | Type | Details |
|------------|------|---------|
| Save Rate | Insights formula | `Card Saved` / `Card Viewed` |
| Save Rate by Category | Insights | `Card Saved` count, breakdown by `category` |
| Avg Decision Time (Save) | Insights | `Card Saved`, show `$duration` average |
| Avg Decision Time (Dismiss) | Insights | `Card Dismissed`, show `$duration` average |
| Deck Exhaustion Rate | Insights | `Deck Exhausted` count vs total swipe sessions |

---

## Step 3: Create User Cohorts

### Lifecycle Cohorts

1. **New Users**: User profile WHERE `$created` within last 7 days
2. **Activated Users**: Users who did `Card Saved` AND `Card Expanded` within 7 days of `$created`
3. **Trial Users**: User profile WHERE `trial_active` = true
4. **Paying Users**: User profile WHERE `subscription_tier` = "mingla_plus"
5. **Churned Trial**: User profile WHERE `trial_active` = false AND `subscription_tier` = "free" AND `onboarding_completed` = true

### Behavioral Cohorts

6. **Social Users**: User profile WHERE `friends_count` >= 3 OR `sessions_count` >= 1
7. **Solo Power Users**: User profile WHERE `total_saves` >= 20 AND `friends_count` = 0
8. **At-Risk**: User profile WHERE `engagement_segment` = "at_risk" (after P2 scoring ships)

---

## Step 4: Set Up Alerts

In Mixpanel → Alerts, create:

| Alert | Condition | Notify |
|-------|-----------|--------|
| DAU Drop | `App Opened` unique users < 80% of 7-day average | Email |
| Onboarding Broken | Onboarding Funnel conversion < 40% for any step | Email |
| Zero Signups | `Signup Completed` count = 0 for 24 hours | Email |
| Trial Conversion Drop | Revenue Funnel final step < 5% for 7 days | Email |

---

## Notes

- **Wait for data**: Most reports need at least 7 days of data to show meaningful trends. Set up the dashboards now, but don't draw conclusions until Week 2.
- **Retention reports**: Need at least 30 days of data for D30 retention. D1 and D7 will show results within 1-2 weeks.
- **Engagement segment**: The `engagement_segment` property will only appear after the P2 engagement scoring edge function runs its first weekly cycle.
- **North Star metric**: Your North Star is **Weekly Active Planners** — users who did `Card Saved` OR `Experience Scheduled` in the last 7 days. Create this as a saved Insights report on the Daily Pulse dashboard.
