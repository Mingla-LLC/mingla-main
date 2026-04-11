# Deep Analytics Tracking Plan — ORCH-0393

> **Date:** 2026-04-11
> **Author:** Product Mind
> **Status:** Blueprint — ready for implementor dispatch
> **Depends on:** ORCH-0387 (Mixpanel + push wiring)

---

## Current State (Reality Check)

| Dimension | Today | After This Plan |
|-----------|-------|-----------------|
| User properties set | 3 (`$email`, `login_provider`, `last_login`) | **34** |
| Super properties | 0 | **7** |
| Active Mixpanel events | 20 | **56** |
| Dead Mixpanel methods | 11 | **0** (all wired or removed) |
| Funnels defined | 0 | **5** |
| Cohorts defined | 0 | **8** |
| Timed events | 0 | **6** |
| First-time milestones | 0 | **9** |
| Dashboards | 0 | **6** recommended |

Mixpanel today is a half-wired event log. After this plan, it becomes the brain that tells you exactly where every user is in their journey, what they'll do next, and where the product is bleeding value.

---

## 1. User Property Architecture

These properties live on every user's Mixpanel profile. Set them at login, update them when they change.

### 1.1 Identity Properties

| Property | Type | Set When | Example | Priority |
|----------|------|----------|---------|----------|
| `$email` | string | Login | "user@example.com" | P0 |
| `$name` | string | Login / profile update | "Sarah Chen" | P0 |
| `$phone` | string | Onboarding (Step 1) | "+14155551234" | P1 |
| `$created` | datetime | First login (once) | "2026-04-11T14:30:00Z" | P0 |
| `user_id` | string | Login | Supabase UUID | P0 |
| `login_provider` | string | Login | "apple" / "google" / "email" | P0 |
| `platform` | string | Login | "ios" / "android" | P0 |
| `app_version` | string | Every login | "1.4.2" | P0 |

### 1.2 Demographic Properties

| Property | Type | Set When | Example | Priority |
|----------|------|----------|---------|----------|
| `gender` | string | Onboarding / profile update | "male" / "female" / "non-binary" / "prefer_not_to_say" | P1 |
| `age` | number | Calculated from birthday at login | 27 | P1 |
| `country` | string | Onboarding (location) | "US" | P0 |
| `city` | string | Onboarding (location) / GPS | "San Francisco" | P0 |
| `language` | string | Onboarding | "en" | P1 |

### 1.3 Preference Properties

| Property | Type | Set When | Example | Priority |
|----------|------|----------|---------|----------|
| `intents` | list | Onboarding + preference update | ["romantic", "adventurous"] | P0 |
| `intents_count` | number | Onboarding + preference update | 2 | P0 |
| `travel_mode` | string | Onboarding + preference update | "driving" / "walking" / "transit" | P1 |
| `budget_tier` | string | Derived from budget range | "mid" (from $25-$75) | P1 |
| `categories_count` | number | Preference update | 5 | P1 |

### 1.4 Lifecycle Properties

| Property | Type | Set When | Example | Priority |
|----------|------|----------|---------|----------|
| `onboarding_completed` | boolean | Onboarding end | true | P0 |
| `onboarding_completed_at` | datetime | Onboarding end (once) | "2026-04-11T14:35:00Z" | P0 |
| `subscription_tier` | string | Login + subscription change | "free" / "mingla_plus" | P0 |
| `trial_active` | boolean | Login + trial events | true / false | P0 |
| `trial_end_date` | datetime | Trial start | "2026-04-18T00:00:00Z" | P0 |
| `days_since_signup` | number | Every login (computed) | 14 | P2 |
| `last_active_date` | datetime | Every app open | "2026-04-11" | P1 |

### 1.5 Social Properties

| Property | Type | Set When | Example | Priority |
|----------|------|----------|---------|----------|
| `friends_count` | number | Friend add/remove | 8 | P0 |
| `is_paired` | boolean | Pair accept/remove | true | P0 |
| `sessions_count` | number | Session create/delete | 3 | P1 |
| `referral_count` | number | Referral credited | 2 | P1 |

### 1.6 Engagement Properties

| Property | Type | Set When | Example | Priority |
|----------|------|----------|---------|----------|
| `total_saves` | number | Increment on save | 47 | P0 |
| `total_scheduled` | number | Increment on schedule | 12 | P1 |
| `total_sessions_participated` | number | Increment on session join | 5 | P1 |
| `engagement_score` | number | Computed weekly (see §8) | 72 | P2 |

> **Implementation note:** Properties marked "increment" should use `mixpanel.getPeople().increment()` not `.set()`. Properties marked "once" should use `.setOnce()`.

---

## 2. Super Properties

Super properties attach to **every single event** automatically. Set them after login and update on change. These are the dimensions you'll use to slice every report.

| Super Property | Type | Set When | Example | Priority |
|----------------|------|----------|---------|----------|
| `subscription_tier` | string | Login + tier change | "free" / "mingla_plus" | P0 |
| `city` | string | Login + location change | "San Francisco" | P0 |
| `platform` | string | App init | "ios" / "android" | P0 |
| `app_version` | string | App init | "1.4.2" | P0 |
| `session_mode` | string | Session switch | "solo" / "collaboration" | P0 |
| `is_paired` | boolean | Pair state change | true / false | P1 |
| `trial_active` | boolean | Login + trial events | true / false | P1 |

**Implementation:** Call `mixpanel.registerSuperProperties({...})` after login and on each state change. Call `mixpanel.unregisterSuperProperty(key)` and re-register when values change.

---

## 3. Complete Event Taxonomy

### 3.1 Authentication & Identity

| # | Event Name | Trigger | Properties | Funnel | Priority |
|---|-----------|---------|------------|--------|----------|
| 1 | `App Opened` | App comes to foreground | `source` (cold/warm/push), `seconds_since_last_open` | Retention | P0 |
| 2 | `Login` | User authenticates | `method` (apple/google/email) | Onboarding | P0 |
| 3 | `Login Failed` | Auth error | `email`, `reason`, `method` | — | P1 |
| 4 | `Logout` | User signs out | — | — | P1 |
| 5 | `Signup Completed` | First-ever login | `method`, `country` | Onboarding | P0 |

### 3.2 Onboarding

| # | Event Name | Trigger | Properties | Funnel | Priority |
|---|-----------|---------|------------|--------|----------|
| 6 | `Onboarding Step Viewed` | Step screen appears | `step`, `step_name` | Onboarding | P0 |
| 7 | `Onboarding Step Completed` | User advances past step | `step`, `step_name`, `duration_seconds`, step-specific extras (see below) | Onboarding | P0 |
| 8 | `Onboarding Step Back` | User goes back | `from_step`, `from_step_name` | — | P1 |
| 9 | `Onboarding Step Skipped` | User skips optional step | `step`, `step_name` | Onboarding | P0 |
| 10 | `Onboarding Completed` | Final step done | `total_duration_seconds`, `steps_skipped`, `intents`, `gender`, `travel_mode` | Onboarding, Activation | P0 |
| 11 | `Onboarding Abandoned` | User closes app mid-onboarding (detect on next open) | `last_step`, `last_step_name`, `time_spent_seconds` | Onboarding | P1 |

**Step-specific extras for `Onboarding Step Completed`:**

| Step | Extra Properties |
|------|-----------------|
| Intent Selection | `intents` (list), `intents_count` |
| Location Setup | `location_method` (gps/manual), `city` |
| Categories | `categories` (list), `categories_count` |
| Budget | `budget_min`, `budget_max`, `budget_tier` |
| Travel Mode | `travel_mode`, `constraint_type`, `constraint_value` |
| Friends & Pairing | `friends_invited_count`, `pair_sent` (boolean) |

### 3.3 Discovery & Card Interactions

| # | Event Name | Trigger | Properties | Funnel | Priority |
|---|-----------|---------|------------|--------|----------|
| 12 | `Card Viewed` | Card appears in swipe deck | `card_id`, `card_title`, `category`, `position_in_deck`, `is_curated` | Activation | P0 |
| 13 | `Card Saved` | Swipe right / tap save | `card_id`, `card_title`, `category`, `is_curated`, `position_in_deck`, `decision_time_seconds` | Activation, Content | P0 |
| 14 | `Card Dismissed` | Swipe left | `card_id`, `card_title`, `category`, `is_curated`, `position_in_deck`, `decision_time_seconds` | Content | P0 |
| 15 | `Card Expanded` | Tap to view details | `card_id`, `card_title`, `category`, `source` (home/saved/calendar) | Activation | P0 |
| 16 | `Deck Exhausted` | No more cards in deck | `cards_seen`, `cards_saved`, `cards_dismissed`, `session_mode` | Content | P1 |
| 17 | `Deck Refreshed` | Preferences changed → new deck | `trigger` (preference_change/pull_refresh/auto), `previous_cards_remaining` | — | P2 |

### 3.4 Saves & Scheduling

| # | Event Name | Trigger | Properties | Funnel | Priority |
|---|-----------|---------|------------|--------|----------|
| 18 | `Experience Saved` | Card added to saves | `card_id`, `card_title`, `category`, `source` (swipe/detail/session) | Activation | P0 |
| 19 | `Experience Unsaved` | Removed from saves | `card_id`, `card_title`, `category`, `days_since_saved` | — | P1 |
| 20 | `Experience Scheduled` | Date set for saved card | `card_id`, `card_title`, `category`, `source` (solo/collaboration), `scheduled_date`, `days_until_scheduled` | Activation | P0 |
| 21 | `Experience Rescheduled` | Date changed | `entry_id`, `entry_title`, `category`, `new_scheduled_date`, `date_option` | — | P1 |
| 22 | `Experience Unscheduled` | Removed from calendar | `entry_id`, `entry_title`, `category`, `was_visited` | — | P2 |
| 23 | `Experience Visited` | Calendar reminder confirmed / review prompted | `entry_id`, `entry_title`, `category`, `days_since_scheduled` | Content | P1 |

### 3.5 Preferences

| # | Event Name | Trigger | Properties | Funnel | Priority |
|---|-----------|---------|------------|--------|----------|
| 24 | `Preferences Updated` | User saves preference changes | `is_collaboration_mode`, `changes_count`, `intents`, `intents_count`, `categories_count`, `budget_min`, `budget_max`, `travel_mode`, `constraint_type`, `date_option`, `time_slot`, `location` | — | P0 |
| 25 | `Preferences Reset` | User resets to defaults | `is_collaboration_mode` | — | P1 |

### 3.6 Social & Collaboration

| # | Event Name | Trigger | Properties | Funnel | Priority |
|---|-----------|---------|------------|--------|----------|
| 26 | `Friend Request Sent` | User sends request | `recipient_username`, `source` (search/discover/contacts) | Social | P0 |
| 27 | `Friend Request Accepted` | User accepts incoming | `request_id`, `sender_name` | Social | P0 |
| 28 | `Friend Request Declined` | User declines incoming | `request_id`, `sender_name` | — | P1 |
| 29 | `Friend Removed` | User removes friend | `friend_name` | — | P2 |
| 30 | `Friend Blocked` | User blocks someone | `reason` | — | P2 |
| 31 | `Pair Request Sent` | User sends pair request | `target_name` | Social | P0 |
| 32 | `Pair Request Accepted` | User accepts pair | `sender_name` | Social | P0 |
| 33 | `Pair Request Declined` | User declines pair | `sender_name` | — | P1 |
| 34 | `Collaboration Session Created` | New session | `session_name`, `invited_friends_count` | Social | P0 |
| 35 | `Collaboration Invites Sent` | Invites dispatched | `session_id`, `session_name`, `invited_count`, `success_count` | Social | P0 |
| 36 | `Collaboration Session Joined` | User joins a session they were invited to | `session_id`, `session_name`, `inviter_name` | Social | P0 |
| 37 | `Session Switched` | User toggles solo/session | `mode` (solo/session), `session_name` | — | P1 |
| 38 | `Board Card Voted` | User votes on session card | `session_id`, `card_id`, `vote` (up/down) | Social | P1 |
| 39 | `Referral Link Shared` | User shares referral link | `method` (copy/sms/social) | Social, Revenue | P0 |
| 40 | `Referral Completed` | Referred user signs up | `referred_user_id` | Social, Revenue | P0 |

### 3.7 Subscription & Revenue

| # | Event Name | Trigger | Properties | Funnel | Priority |
|---|-----------|---------|------------|--------|----------|
| 41 | `Paywall Viewed` | Paywall screen shown | `trigger` (feature_gate/general/trial_ending), `gated_feature` | Revenue | P0 |
| 42 | `Paywall Dismissed` | User closes paywall without action | `trigger`, `time_on_paywall_seconds` | Revenue | P0 |
| 43 | `Trial Started` | Elite trial begins | `trial_duration_days` | Revenue | P0 |
| 44 | `Trial Expired` | Trial ends without conversion | `trial_days`, `features_used_during_trial` | Revenue | P0 |
| 45 | `Subscription Purchased` | User subscribes | `plan` (monthly/annual), `tier`, `revenue`, `currency`, `is_trial_conversion` | Revenue | P0 |
| 46 | `Subscription Cancelled` | User cancels (from RevenueCat webhook) | `plan`, `tier`, `days_subscribed`, `reason` | Revenue | P1 |
| 47 | `Feature Gate Hit` | User tries gated feature on free tier | `feature` (curated_cards/pairing/custom_starting_point/session_creation), `current_tier` | Revenue | P0 |

### 3.8 Navigation & Engagement

| # | Event Name | Trigger | Properties | Funnel | Priority |
|---|-----------|---------|------------|--------|----------|
| 48 | `Screen Viewed` | User navigates to main screen | `screen`, `screen_key` | — | P0 |
| 49 | `Tab Viewed` | User switches tab within screen | `screen`, `tab` | — | P1 |
| 50 | `Experience Shared` | User shares an experience | `experience_title`, `method` (platform/copy_link/copy_message) | — | P1 |
| 51 | `Push Notification Clicked` | User taps push notification | `notification_type`, `deep_link` | Re-engagement | P0 |
| 52 | `Profile Updated` | User changes profile info | `field` (name/username/picture/etc), `action` (uploaded/removed for pictures) | — | P2 |

### 3.9 Coach Marks (12-Step Guided Tour)

The app has a full spotlight-based coach tour (12 steps across Home, Discover, Connections, Profile). This is the first experience after onboarding — if users drop here, they miss core features.

| # | Event Name | Trigger | Properties | Funnel | Priority |
|---|-----------|---------|------------|--------|----------|
| 55 | `Coach Mark Viewed` | Spotlight overlay shown | `step_id`, `step_title`, `tab`, `target_id` | Activation | P0 |
| 56 | `Coach Mark Completed` | User taps "Got it" / "Let's go!" | `step_id`, `step_title`, `tab` | Activation | P0 |
| 57 | `Coach Mark Skipped` | User dismisses entire tour early | `last_step_seen`, `steps_completed`, `steps_remaining` | Activation | P0 |
| 58 | `Coach Tour Completed` | All 12 steps finished | `total_duration_seconds` | Activation | P0 |

**Timed event:** Start `Coach Tour Completed` timer when step 1 is viewed. Gives total tour duration automatically.

**User properties:**
- `coach_tour_completed` (boolean, `.setOnce()`)
- `coach_tour_completed_at` (datetime, `.setOnce()`)
- `coach_steps_seen` (number — tracks how far they got if they bailed)

**First-time milestone:** Add `First Coach Tour Completed` → sets `coach_tour_completed_at`.

**Key question:** At which step do most users bail? If step 4 (collaboration) is the drop-off, users never learn about sessions — that directly explains low session adoption.

### 3.10 Discover People & Holidays

| # | Event Name | Trigger | Properties | Funnel | Priority |
|---|-----------|---------|------------|--------|----------|
| 53 | `Discover Person Added` | Person created in Discover | `person_name`, `has_birthday`, `gender` | — | P1 |
| 54 | `Discover Custom Holiday Added` | Holiday added for person | `holiday_name`, `date`, `categories`, `categories_count`, `person_id` | — | P1 |

---

## 4. Funnel Definitions

### 4.1 Onboarding Funnel

**Purpose:** Where do new users drop off during setup?

```
Signup Completed → Onboarding Step Completed (step=1) → ... → Onboarding Completed
```

| Step | Event | Filter | Expected Conversion |
|------|-------|--------|-------------------|
| Entry | `Signup Completed` | — | 100% |
| Step 1 | `Onboarding Step Completed` | step_name = "Account Setup" | 90% |
| Step 2 | `Onboarding Step Completed` | step_name = "Intent Selection" | 85% |
| Step 3 | `Onboarding Step Completed` | step_name = "Location Setup" | 75% |
| Step 4 | `Onboarding Step Completed` | step_name = "Categories/Budget/Travel" | 65% |
| Step 5 | `Onboarding Step Completed` | step_name = "Friends & Pairing" | 60% |
| Complete | `Onboarding Completed` | — | 55% |

**Breakdowns:** platform, login_provider, country
**Key question:** Where is the biggest single drop? That step needs UX attention first.

### 4.2 Activation Funnel

**Purpose:** Do onboarded users experience core value?

```
Onboarding Completed → Card Viewed → Card Saved → Card Expanded → Experience Scheduled
```

| Step | Event | Completion Window | Expected Conversion |
|------|-------|-------------------|-------------------|
| Entry | `Onboarding Completed` | — | 100% |
| First Swipe | `Card Viewed` | Within 5 min | 90% |
| First Save | `Card Saved` | Within first session | 60% |
| First Expand | `Card Expanded` | Within 24 hours | 45% |
| First Schedule | `Experience Scheduled` | Within 7 days | 20% |

**Breakdowns:** subscription_tier, city, intents
**Key question:** What % of users who save a card ever schedule it? If <30%, scheduling UX is broken.

### 4.3 Social Funnel

**Purpose:** Are users building social connections?

```
Friend Request Sent → Friend Request Accepted → Collaboration Session Created → Board Card Voted
```

| Step | Event | Expected Conversion |
|------|-------|-------------------|
| Entry | `Friend Request Sent` | 100% |
| Accepted | `Friend Request Accepted` | 65% |
| Session Created | `Collaboration Session Created` | 30% |
| Active Collaboration | `Board Card Voted` | 15% |

**Breakdowns:** subscription_tier, friends_count
**Key question:** What's the friend-request-to-session conversion? If users add friends but never collaborate, the session UX isn't compelling enough.

### 4.4 Revenue Funnel

**Purpose:** How does free → paid conversion work?

```
Trial Started → Feature Gate Hit → Paywall Viewed → Subscription Purchased
```

| Step | Event | Expected Conversion |
|------|-------|-------------------|
| Entry | `Trial Started` | 100% |
| Hit Gate | `Feature Gate Hit` | 70% |
| See Paywall | `Paywall Viewed` | 50% |
| Convert | `Subscription Purchased` | 8-12% |

**Alternative path:** `Trial Expired` → `Paywall Viewed` (trigger=trial_ending) → `Subscription Purchased`

**Breakdowns:** gated_feature (which feature triggers most conversions?), trial_active, platform
**Key question:** Which gated feature has the highest paywall-to-purchase conversion? Double down on that gate.

### 4.5 Re-engagement Funnel

**Purpose:** Do dormant users come back?

```
Push Notification Clicked → App Opened → Card Viewed → Card Saved
```

| Step | Event | Filter | Expected Conversion |
|------|-------|--------|-------------------|
| Entry | `Push Notification Clicked` | notification_type = re_engagement* | 100% |
| App Open | `App Opened` | Within 1 hour | 85% |
| Browse | `Card Viewed` | Within same session | 50% |
| Save | `Card Saved` | Within same session | 20% |

**Breakdowns:** notification_type, days_since_last_active, subscription_tier
**Key question:** Which push notification type has the best click-to-save ratio? That's your winning re-engagement template.

---

## 5. Cohort Definitions

### 5.1 Lifecycle Cohorts

| Cohort | Definition | Purpose |
|--------|-----------|---------|
| **New Users** | `$created` within last 7 days | Onboarding optimization |
| **Activated Users** | Has done `Card Saved` AND `Card Expanded` within first 7 days | Core value experienced |
| **Trial Users** | `trial_active` = true | Trial-to-paid conversion targeting |
| **Paying Users** | `subscription_tier` = "mingla_plus" | Revenue and retention analysis |
| **Churned Trial** | `trial_active` = false AND `subscription_tier` = "free" AND `onboarding_completed` = true | Win-back campaigns |

### 5.2 Behavioral Cohorts

| Cohort | Definition | Purpose |
|--------|-----------|---------|
| **Social Users** | `friends_count` >= 3 OR `sessions_count` >= 1 | Social feature adoption |
| **Solo Power Users** | `total_saves` >= 20 AND `friends_count` = 0 | Understand non-social value |
| **At-Risk** | Was active in last 30 days, inactive for last 7 days | Churn prevention |

### 5.3 Persona-Based Cohorts (Weekly auto-compute)

| Cohort | Signal | Maps to Persona |
|--------|--------|----------------|
| **Date Planners** | `is_paired` = true AND `intents` contains "romantic" or "first-date" | Date Planner / Committed Couple |
| **Squad Organizers** | `sessions_count` >= 2 AND `friends_count` >= 3 | Squad Organizer |
| **Solo Explorers** | `friends_count` = 0 AND `total_saves` >= 5 AND NOT paired | Solo Explorer |
| **New Arrivals** | `$created` within last 30 days AND `city` changed in last 30 days | New Arrival |

---

## 6. Timed Event Strategy

Timed events measure **duration** automatically. Call `mixpanel.timeEvent("Event Name")` when the timer starts, then `mixpanel.track("Event Name")` when it ends. Mixpanel adds a `$duration` property in seconds.

| # | Timed Event | Start Trigger | End Trigger | What It Tells You | Priority |
|---|------------|---------------|-------------|-------------------|----------|
| 1 | `Onboarding Completed` | `Signup Completed` fires | `Onboarding Completed` fires | Total onboarding duration — are users rushing or struggling? | P0 |
| 2 | `Card Saved` | `Card Viewed` fires | `Card Saved` fires (same card_id) | Decision time per card — fast = confident, slow = uncertain | P0 |
| 3 | `Card Dismissed` | `Card Viewed` fires | `Card Dismissed` fires (same card_id) | How quickly do users reject? Fast rejects = bad match | P0 |
| 4 | `Experience Scheduled` | `Experience Saved` fires | `Experience Scheduled` fires (same card_id) | Time from "I like this" to "I'm going" — shorter = higher intent | P1 |
| 5 | `Paywall Dismissed` | `Paywall Viewed` fires | `Paywall Dismissed` fires | Time spent considering — longer = more interested, may convert with better copy | P1 |
| 6 | `Session Ended` | `App Opened` fires | App goes to background (AppState listener) | Total session length — your core engagement metric | P0 |

**Implementation note for card decision time:** Since `timeEvent` is global (one timer per event name), and users see cards sequentially in the swipe deck, the timer naturally resets when each new card is viewed. This works because cards are shown one at a time.

---

## 7. First-Time Milestone Events

These fire **once per user lifetime** using `mixpanel.getPeople().setOnce()` to timestamp them. They mark progression through the product.

| # | Milestone | Fires When | User Property Set | Priority |
|---|----------|-----------|-------------------|----------|
| 1 | `First Card Saved` | First-ever `Card Saved` event | `first_save_at` (datetime) | P0 |
| 2 | `First Card Expanded` | First-ever `Card Expanded` | `first_expand_at` | P0 |
| 3 | `First Experience Scheduled` | First-ever `Experience Scheduled` | `first_schedule_at` | P0 |
| 4 | `First Friend Added` | First-ever `Friend Request Accepted` (either direction) | `first_friend_at` | P0 |
| 5 | `First Session Created` | First-ever `Collaboration Session Created` | `first_session_at` | P1 |
| 6 | `First Pair Formed` | First-ever `Pair Request Accepted` (either direction) | `first_pair_at` | P1 |
| 7 | `First Share` | First-ever `Experience Shared` | `first_share_at` | P1 |
| 8 | `First Referral` | First-ever `Referral Completed` | `first_referral_at` | P2 |
| 9 | `First Visit` | First-ever `Experience Visited` (confirmed visit) | `first_visit_at` | P1 |

**How to implement:** In the tracking method, check a local flag (AsyncStorage) before firing. If `first_save_fired` is not set, fire `First Card Saved` event, set the user property with `.setOnce()`, and set the local flag. This avoids checking Mixpanel state on every event.

**Why these matter:** The time gaps between milestones tell you everything.
- `$created` → `first_save_at` = Time to first value (should be <5 min)
- `first_save_at` → `first_schedule_at` = Intent-to-action gap (should be <7 days)
- `$created` → `first_friend_at` = Social activation speed (faster = stickier)
- `first_friend_at` → `first_session_at` = Social-to-collab conversion (the collaboration value proof)

---

## 8. Engagement Scoring Model

A single number (0-100) that tells you how engaged a user is. Computed weekly, stored as user property `engagement_score`.

### 8.1 Scoring Components

| Signal | Weight | 0 Points | 50 Points | 100 Points |
|--------|--------|----------|-----------|------------|
| **Recency** (days since last active) | 30% | >30 days | 7 days | Today |
| **Frequency** (sessions in last 14 days) | 25% | 0 | 3-4 | 10+ |
| **Depth** (cards saved in last 14 days) | 20% | 0 | 3-5 | 15+ |
| **Social** (friends + sessions active) | 15% | 0 friends, 0 sessions | 2 friends | 5+ friends OR active session |
| **Monetization** (tier) | 10% | Free, trial expired | Free, trial active | Mingla Plus |

### 8.2 Score → Segment

| Score Range | Segment | Description | Action |
|-------------|---------|-------------|--------|
| 80-100 | **Power User** | Highly engaged, high retention probability | Nurture, ask for referrals, beta features |
| 60-79 | **Active** | Regular user, healthy engagement | Encourage social features, schedule prompts |
| 40-59 | **Casual** | Uses occasionally, hasn't fully activated | Activation nudges, highlight unused features |
| 20-39 | **At Risk** | Declining engagement | Re-engagement pushes, "we miss you" emails |
| 0-19 | **Dormant** | Hasn't been active recently | Win-back campaign, aggressive re-engagement |

### 8.3 Implementation

This score should NOT be computed client-side. Options:
1. **Supabase Edge Function** (recommended) — runs weekly via cron, reads user activity from DB, calls Mixpanel API to set `engagement_score` property
2. **Mixpanel Computed Property** (if available on plan) — define formula in Mixpanel UI

The implementor should use option 1 (edge function) since it keeps logic in our control and works with any Mixpanel plan.

---

## 9. Dashboard Recommendations

### 9.1 Daily Pulse (check every morning)

| Metric | Source | Alert If |
|--------|--------|----------|
| DAU | `App Opened` unique users today | <80% of 7-day average |
| New signups today | `Signup Completed` count | <50% of 7-day average |
| Onboarding completion rate (7-day rolling) | Funnel 4.1 | <50% |
| Cards saved today | `Card Saved` count | <70% of 7-day average |
| Trial conversions today | `Subscription Purchased` where `is_trial_conversion` = true | 0 for 2+ consecutive days |
| Push click rate | `Push Notification Clicked` / pushes sent | <5% |

### 9.2 Activation Board (check weekly)

| Metric | Source |
|--------|--------|
| Activation rate (% reaching Card Saved within 7 days of signup) | Funnel 4.2 |
| Time to first save (median) | Milestone gap: `$created` → `first_save_at` |
| First-session save rate | `Card Saved` in same session as `Onboarding Completed` |
| Activation rate by platform | Funnel 4.2, broken down by `platform` |
| Activation rate by login method | Funnel 4.2, broken down by `login_provider` |

### 9.3 Retention Board (check weekly)

| Metric | Source |
|--------|--------|
| D1 / D7 / D30 retention | Mixpanel retention report on `App Opened` |
| Retention by subscription tier | Retention report, segmented by `subscription_tier` |
| Retention: paired vs unpaired | Retention report, segmented by `is_paired` |
| Retention: social (friends >= 3) vs solo | Retention report, segmented by cohort |
| Weekly active users trend | `App Opened` unique users, 7-day window, 12-week chart |

### 9.4 Revenue Board (check weekly)

| Metric | Source |
|--------|--------|
| Trial → Paid conversion rate | Funnel 4.4 |
| Paywall view → Purchase rate | `Subscription Purchased` / `Paywall Viewed` |
| Feature gate → Paywall → Purchase by feature | Funnel 4.4, broken by `gated_feature` |
| MRR estimate | `Subscription Purchased` count × plan price |
| Paywall dismissal rate | `Paywall Dismissed` / `Paywall Viewed` |
| Avg time on paywall | `$duration` of `Paywall Dismissed` |

### 9.5 Social Board (check weekly)

| Metric | Source |
|--------|--------|
| Friend requests sent per DAU | `Friend Request Sent` / DAU |
| Friend request acceptance rate | `Friend Request Accepted` / `Friend Request Sent` |
| % users with 1+ friend | Cohort: `friends_count` >= 1 |
| Sessions created per week | `Collaboration Session Created` count |
| Session join rate (invites → joins) | `Collaboration Session Joined` / `Collaboration Invites Sent` |
| Pair formation rate | `Pair Request Accepted` / `Pair Request Sent` |

### 9.6 Content Quality Board (check weekly)

| Metric | Source |
|--------|--------|
| Save rate (saves / views) | `Card Saved` / `Card Viewed` |
| Save rate by category | Segmented by `category` |
| Avg decision time (save) | `$duration` of `Card Saved` |
| Avg decision time (dismiss) | `$duration` of `Card Dismissed` |
| Deck exhaustion rate | `Deck Exhausted` / unique swipe sessions |
| Expand rate (expands / saves) | `Card Expanded` / `Card Saved` |

---

## 10. Implementation Priority

### P0 — Must Have Before Launch (Week 1-2)

These are the events and properties without which you cannot measure anything meaningful.

| What | Items | Effort |
|------|-------|--------|
| **Wire dead methods** | Connect 11 existing dead Mixpanel methods to their call sites (they're already written!) | Small — just add calls |
| **Super properties** | Register 7 super properties after login | Small |
| **User properties** | Set 20 P0 user properties at login + onboarding + subscription change | Medium |
| **New events** | `App Opened`, `Signup Completed`, `Card Saved`, `Card Dismissed`, `Card Viewed`, `Paywall Dismissed`, `Feature Gate Hit`, `Trial Started`, `Trial Expired`, `Subscription Purchased`, `Push Notification Clicked`, `Coach Mark Viewed`, `Coach Mark Completed`, `Coach Mark Skipped`, `Coach Tour Completed` | Medium |
| **Timed events** | Onboarding duration, card decision time, session length | Small |
| **Onboarding funnel** | Define in Mixpanel UI | Config only |
| **Activation funnel** | Define in Mixpanel UI | Config only |
| **Daily Pulse dashboard** | Build in Mixpanel UI | Config only |

### P1 — High Value (Week 3-4)

| What | Items | Effort |
|------|-------|--------|
| **Additional user properties** | 10 P1 properties (demographics, preferences, social) | Small |
| **New events** | `Deck Exhausted`, `Experience Unsaved`, `Experience Visited`, `Pair Request Sent/Accepted/Declined`, `Collaboration Session Joined`, `Board Card Voted`, `Referral Link Shared`, `Onboarding Abandoned` | Medium |
| **First-time milestones** | All 9 milestone events + AsyncStorage flags + `.setOnce()` properties | Medium |
| **Revenue funnel** | Define in Mixpanel UI | Config only |
| **Social funnel** | Define in Mixpanel UI | Config only |
| **Retention board** | Build in Mixpanel UI | Config only |
| **Revenue board** | Build in Mixpanel UI | Config only |

### P2 — Nice to Have (Week 5-6)

| What | Items | Effort |
|------|-------|--------|
| **Engagement scoring** | Edge function + weekly cron + Mixpanel property update | Medium |
| **Remaining user properties** | `days_since_signup`, `engagement_score` | Small (depends on scoring) |
| **New events** | `Deck Refreshed`, `Experience Unscheduled`, `Login Failed` improvements | Small |
| **Persona cohorts** | Define auto-computing cohorts in Mixpanel | Config only |
| **Content quality board** | Build in Mixpanel UI | Config only |
| **Social board** | Build in Mixpanel UI | Config only |

### P3 — Future Enhancement

| What | Items | Effort |
|------|-------|--------|
| **A/B testing integration** | Feature flags → Mixpanel properties for experiment tracking | Medium |
| **Server-side events** | Referral completed, subscription webhooks → Mixpanel server API | Medium |
| **Cross-platform identity** | If web app launches, merge identities | Complex |
| **Predictive churn model** | Use engagement score + behavioral signals to predict churn | Complex |

---

## 11. Naming Conventions & Standards

### Event Names
- **Title Case**, spaces between words: `Card Saved`, not `card_saved` or `cardSaved`
- **Past tense** for completed actions: `Saved`, `Completed`, `Sent`
- **Object first**: `Card Saved` not `Saved Card` (makes alphabetical grouping useful)

### Property Names
- **snake_case**: `card_id`, `subscription_tier`
- **Boolean prefixes**: `is_` or `has_` — `is_curated`, `has_birthday`
- **Counts suffix**: `_count` — `friends_count`, `intents_count`
- **Dates suffix**: `_at` for datetimes, `_date` for date-only — `first_save_at`, `scheduled_date`
- **Duration suffix**: `_seconds` — `decision_time_seconds`, `total_duration_seconds`

### Reserved Mixpanel Properties (never override)
- `$email`, `$name`, `$phone`, `$created`, `$city`, `$region`, `$country_code`
- `$device`, `$os`, `$browser`, `$screen_height`, `$screen_width`
- `distinct_id`, `time`, `$duration`

---

## 12. Parity Resolution Plan

The forensic audit (ORCH-0390) found 12 events in AppsFlyer but not Mixpanel, and 9 in Mixpanel but not AppsFlyer.

### Strategy: Mixpanel becomes the product analytics brain. AppsFlyer stays as the attribution/marketing brain.

**Do NOT replicate every AppsFlyer event in Mixpanel.** Instead:

| AppsFlyer-only Event | Add to Mixpanel? | Reason |
|---------------------|------------------|--------|
| `af_add_to_wishlist` (card save) | **Yes** → becomes `Card Saved` | Core product event, must be in Mixpanel |
| `card_dismissed` | **Yes** → becomes `Card Dismissed` | Core product event |
| `preferences_updated` | **Yes** → wire existing dead method | Already written, just not called |
| `pair_request_sent/accepted` | **Yes** → new events | Social funnel needs them |
| `af_subscribe` | **Yes** → becomes `Subscription Purchased` | Revenue funnel |
| `trial_expired_no_conversion` | **Yes** → becomes `Trial Expired` | Revenue funnel |
| `paywall_viewed` | **Yes** → new event | Revenue funnel |
| `af_start_trial` | **Yes** → becomes `Trial Started` | Revenue funnel |
| `onboarding_step_completed` | **Yes** → wire existing dead methods | Already written! |
| `af_tutorial_completion` | **Yes** → wire existing dead method | Already written! |
| `referral_completed` (S2S) | **P3** — requires server-side Mixpanel | Complex, defer |
| `af_complete_registration` | **Yes** → becomes `Signup Completed` | New event, distinct from Login |

---

## 13. Implementation Contract

For the implementor agent:

### Service Changes (`mixpanelService.ts`)

1. **Add `registerSuperProperties(props)` method** — wraps `mixpanel.registerSuperProperties()`
2. **Add `timeEvent(eventName)` method** — wraps `mixpanel.timeEvent()`
3. **Add `incrementUserProperty(prop, by)` method** — wraps `mixpanel.getPeople().increment()`
4. **Add `setUserPropertyOnce(props)` method** — wraps `mixpanel.getPeople().setOnce()`
5. **Add new tracking methods** for: `App Opened`, `Signup Completed`, `Card Saved`, `Card Dismissed`, `Card Viewed`, `Deck Exhausted`, `Paywall Dismissed`, `Feature Gate Hit`, `Trial Started`, `Trial Expired`, `Subscription Purchased`, `Push Notification Clicked`, `Pair Request Sent/Accepted/Declined`, `Collaboration Session Joined`, `Board Card Voted`, `Referral Link Shared`, `Session Ended`
6. **Add first-time milestone logic** with AsyncStorage flags
7. **Wire all 11 dead methods** to their call sites

### Call Site Wiring

| Method | Wire Into |
|--------|-----------|
| `trackOnboardingStepViewed` | `OnboardingFlow.tsx` — each step render |
| `trackOnboardingStepCompleted` | `OnboardingFlow.tsx` — each step advance |
| `trackOnboardingStepBack` | `OnboardingFlow.tsx` — back button handler |
| `trackOnboardingStepSkipped` | `OnboardingFlow.tsx` — skip button handler |
| `trackOnboardingCompleted` | `OnboardingFlow.tsx` — final step complete |
| `trackPreferencesUpdated` | `PreferencesSheet.tsx` — save handler (alongside existing AF call) |
| `trackDiscoverPersonAdded` | `DiscoverScreen.tsx` — person add handler |
| `trackFriendRequestSent` | `useFriends.ts` — send handler (alongside existing AF call) |
| `trackAccountSettingUpdated` | `AccountSettings.tsx` — save handlers |
| `trackLoginFailed` | `index.tsx` — auth error handler |
| `trackCoachMarkViewed` | `CoachMarkContext.tsx` or `SpotlightOverlay.tsx` — when step becomes active |
| `trackCoachMarkCompleted` | `SpotlightOverlay.tsx` — "Got it" button handler |
| `trackCoachMarkSkipped` | `SpotlightOverlay.tsx` or `CoachMarkContext.tsx` — dismiss/skip handler |
| `trackCoachTourCompleted` | `CoachMarkContext.tsx` — after step 12 completed |

### Super Property Registration Points

| When | Properties to Set |
|------|------------------|
| After `initialize()` | `platform`, `app_version` |
| After `trackLogin()` | `subscription_tier`, `city`, `is_paired`, `trial_active` |
| After `trackSessionSwitched()` | `session_mode` |
| After subscription change | `subscription_tier`, `trial_active` |
| After pair state change | `is_paired` |

---

## Summary

This plan transforms Mixpanel from a partial event log into a complete user intelligence system. The P0 work (wiring dead methods + super properties + core new events) can be done in 1-2 focused implementation sessions because **half the code already exists** — it was written and never connected.

After P0, you'll be able to answer:
- Where exactly do users drop off in onboarding?
- What % of users who save a card actually schedule it?
- Which gated feature drives the most subscriptions?
- Are paired users really more retained than solo users?
- Which push notification type brings users back most effectively?

After P1, you'll be able to answer:
- What does a power user look like in their first 7 days?
- Which persona cohort has the highest LTV?
- How long does it take to go from "first friend" to "first session"?

After P2, you'll be able to predict:
- Which users will churn before they do
- Which users are ready for an upsell
- Where the product is leaking value in real time
