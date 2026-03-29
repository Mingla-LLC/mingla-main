# Mingla — Product Marketing Document

> Created: 2026-03-16 | Updated: 2026-03-29 | Status: Complete (Launch-Ready)
> Source of truth: codebase, not documentation

---

## 1. Product Positioning

### One-Liner
Mingla is the AI-powered experience discovery app that tells you exactly where to go -- for dates, friends, and solo adventures -- and helps you plan it together.

### Category
AI-powered experience discovery and social planning (B2C consumer app)

### Core Value Proposition
Stop scrolling "best restaurants near me." Mingla learns your taste, budget, and vibe, then delivers a personalized deck of experiences you'll actually love -- and lets you plan them with the people who matter.

### Differentiators (Code-Verified)

| Differentiator | Evidence | Why It Matters |
|---------------|----------|----------------|
| **AI-matched experience deck** | 5-factor scoring (category affinity, time-of-day, rating, popularity, preference learning) + curated multi-stop itineraries | Not just a list of restaurants -- a ranked, personalized deck that gets smarter with every swipe |
| **Collaborative planning boards** | `collaboration_sessions` + `boards` + voting + RSVP + board chat with mentions | Friends don't just get a link -- they co-decide in real time with votes and discussions |
| **3-tier pairing system** | pair_requests with visible/hidden_until_friend gating + pending phone invites | Deep relationship layer that unlocks shared discovery, custom holidays, paired recommendations |
| **Privacy-first social map** | Deterministic location obfuscation, bidirectional visibility controls, 5-level privacy settings | See who's nearby without sacrificing safety -- approximate location, never exact |
| **Swipe-to-schedule pipeline** | Discover -> Save -> Schedule -> Device calendar sync with opening hours validation | The only app where swiping right on a restaurant puts it on your calendar with a reminder |
| **Taste matching** | `user_taste_matches` table + compute_taste_match RPC + shared category display | Strangers on the map show compatibility %, creating organic social discovery |

### Positioning Statement
For urban explorers aged 21-35 who are tired of the "where should we go?" conversation, Mingla is the experience discovery app that delivers personalized activity recommendations and lets you plan them collaboratively -- unlike Google Maps (search-based, no social), Yelp (review-based, no planning), or group chats (chaos, no curation).

> Updated: 2026-03-29 | Trigger: Full forensic analysis | Evidence: All services, edge functions, database schema | Confidence: H

---

## 2. ICP Definition & Segments

### Primary ICP: Urban Social Planner (21-35)
- **Who:** Young professionals in metro areas who go out 2-4x/week
- **Pain:** "Where should we go?" decision fatigue, group coordination chaos, generic recommendations
- **Behavior signals (from code):**
  - Sets preferences for specific intents (first-date, romantic, group-fun)
  - Uses collaboration sessions to plan with friends
  - Saves 5+ cards per session
  - Schedules activities to device calendar
- **Activation path:** Onboarding -> first deck swipe -> first save -> first schedule
- **Monetization:** Pro tier for curated cards + custom starting point, Elite for pairing + unlimited sessions

### Secondary ICP: Coupled Explorer
- **Who:** People in relationships who want to discover new date spots
- **Pain:** Running out of date ideas, repetitive routines
- **Behavior signals:**
  - Uses pairing feature (Elite only)
  - Sets "romantic" or "first-date" intents
  - Creates custom holidays (anniversaries, birthdays)
  - Views paired discovery cards (experiences for "us")
- **Activation path:** Onboarding -> pair with partner -> shared saves -> schedule together
- **Monetization:** Elite tier (pairing is Elite-gated)

### Tertiary ICP: Solo Adventurer
- **Who:** Independent person who likes discovering new places alone
- **Pain:** Boredom, wanting to break routines, finding hidden gems
- **Behavior signals:**
  - Solo mode only (no collaboration sessions)
  - Broad category selection (nature, wellness, creative arts)
  - High swipe volume (uses all 20 free or upgrades)
  - Schedules activities for self
- **Activation path:** Onboarding -> swipe deck -> save -> schedule
- **Monetization:** Pro tier for unlimited swipes + curated cards

### Segment Sizing Signals (from code)
- Onboarding collects intent (adventurous, first-date, romantic, group-fun, picnic-dates, take-a-stroll) -- this IS the segment signal
- Gender collected (8 options) but not used for matching -- experience-first, not people-first
- Country + language -> market segmentation capability
- Travel mode preference (walking/biking/transit/driving) -> urban density indicator

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: Onboarding intents, preference options, tier gating, pairing system | Confidence: H

---

## 3. User Journey Maps

### Journey 1: First-Time User (Install to First Value)

```
INSTALL -> WELCOME SCREEN
  |
  v
OAuth Sign-In (Google/Apple)
  |
  v
ONBOARDING (7 steps, ~4 min)
  Step 1: Name -> Phone -> OTP -> Gender -> Birthday/Country/Language
  Step 2: Value prop beats -> Select intent (adventurous/date/romantic/group/picnic/stroll)
  Step 3: Enable GPS location
  Step 4: Select categories (max 3) -> Budget -> Transport -> Travel time
  Step 5: Add friends by phone (optional, skippable)
  Step 6: Create collaboration session (optional, skippable)
  Step 7: Consent -> "Your deck is ready"
  |
  v
7-DAY ELITE TRIAL STARTS (automatic)
  |
  v
HOME TAB: First deck loads (20 personalized cards)
  |
  v
FIRST SWIPE RIGHT -> Card saved! (FIRST VALUE MOMENT)
  |
  v
LIKES TAB: Saved card visible with Schedule button
  |
  v
TAP SCHEDULE -> Pick date/time -> Opening hours validated -> Device calendar synced
  |
  v
SCHEDULED! (User has a plan. Core value delivered.)
```

**Key conversion points:**
- Install -> Onboarding start: OAuth friction only
- Onboarding start -> Complete: 7 steps, GPS required, ~4 min
- Complete -> First swipe: Immediate (deck pre-warmed during onboarding)
- First swipe -> First save: Depends on card quality + preference accuracy
- First save -> First schedule: Requires intentional action

### Journey 2: Social Planner (Group Outing)

```
HOME TAB -> Tap "Create Session" pill
  |
  v
Select friends -> Name the session -> Create
  |
  v
Friends receive push notification + in-app invite
  |
  v
Friend accepts -> Board auto-created -> Preferences seeded
  |
  v
Both users swipe deck (session mode) -> Cards saved to shared board
  |
  v
BOARD VIEW: See all saved cards + vote (like/dislike) + RSVP (yes/no/maybe)
  |
  v
Board chat: Discuss cards with @mentions + card-specific threads
  |
  v
Group consensus reached -> Schedule winning card
  |
  v
All participants get calendar reminder
```

### Journey 3: Paired Discovery (Couples)

```
DISCOVER TAB -> Tap friend's pill -> Send pair request (Elite only)
  |
  v
TIER 1 (friends): Request visible immediately
TIER 2 (non-friends): Friend request + hidden pair request
TIER 3 (non-users): SMS invite + pending pair intent
  |
  v
Partner accepts pair request -> PAIRED!
  |
  v
UNLOCKED:
  - Shared saved cards (automatic)
  - Custom holidays ("Our Anniversary", "Partner's Birthday")
  - Paired discovery cards (experiences for "us")
  - Always visible on map to each other
  - Birthday + gender visible in pairing info
  |
  v
DISCOVER MAP: See partner's location + activity status + shared saves
  |
  v
Holiday reminder -> Get personalized experience cards for the occasion
```

### Journey 4: Map Discovery (Serendipitous)

```
DISCOVER TAB -> Map loads with nearby places + people
  |
  v
SEE: Place pins (colored by price), People pins (colored by relationship), Activity statuses
  |
  v
TAP PLACE PIN -> Bottom sheet: Image, title, rating, category, distance
  -> "Details" for full info | "Next" to cycle to next card
  |
  v
TAP STRANGER PIN -> Bottom sheet: Avatar, name, taste match %, shared categories
  -> "Add Friend" (10/day limit) | "Message" | "Block/Report"
  |
  v
TAP FRIEND PIN -> Bottom sheet: Avatar, name, status
  -> "Message" | "Invite to session" | "View profile"
  |
  v
TOGGLE LAYERS: People on/off, Places on/off, Activity feed, Heatmap
  |
  v
SET STATUS: "Exploring" / "Looking for plans" / "Open to meet" / "Busy"
```

### Journey 5: Returning User (Retention Loop)

```
PUSH NOTIFICATION: "Sarah saved a new spot!" (paired activity)
  |
  v
Open app -> Map shows Sarah's new save with orange people badge
  |
  v
Tap to see what she saved -> Like it? Save it too -> Schedule together
  |
  v
--- OR ---
  |
  v
PUSH NOTIFICATION: "Your scheduled experience is tomorrow!"
  |
  v
Open app -> Calendar entry shows QR code + details
  |
  v
Visit place -> PostExperienceModal appears (locked, non-dismissible)
  |
  v
Record voice review -> Rating saved -> Place review created
  |
  v
Preference learning updated -> Next deck is even more personalized
```

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: Complete flow traces across all screens | Confidence: H

---

## 4. Feature-to-Benefit Mapping

### Consumer-Facing

| Feature | What It Does | User Benefit | Marketing Angle |
|---------|-------------|--------------|-----------------|
| **Personalized deck** | AI scores cards on 5 factors, learns from swipes | "Every swipe teaches Mingla your taste" | Never get a bad recommendation again |
| **Curated multi-stop cards** | 3-5 stop itineraries with route + timeline | "A full plan, not just a pin on a map" | Date night planned in one swipe |
| **Swipe-to-schedule** | Right swipe -> save -> schedule -> device calendar | "From discovery to your calendar in 3 taps" | Stop bookmarking. Start going. |
| **Collaboration boards** | Shared card board + voting + RSVP + chat | "Plan together without the group chat chaos" | Everyone votes. Nobody argues. |
| **Discover Map** | See nearby people + places + curated routes on map | "See what's around you and who's exploring" | Your city, visualized by vibe |
| **Taste matching** | Compatibility % with nearby strangers | "Find people who like the same spots you do" | Meet people through places, not profiles |
| **Pairing** | Shared saves, custom holidays, paired cards | "Discover together with your person" | Your relationship's activity planner |
| **7-day Elite trial** | Full access from day one | "Try everything, decide later" | No paywall on day one |
| **Referral rewards** | 1 month Elite per friend who joins | "Invite friends, get free premium" | Bring your crew, keep your perks |
| **Opening hours check** | Validates all stops are open at chosen time | "Never show up to a closed restaurant" | Plans that actually work |
| **Voice reviews** | Record audio feedback after visiting | "Tell us what you thought" | Your voice improves everyone's deck |
| **Custom holidays** | Create special dates tied to paired person | "Never forget your anniversary plans" | Mingla remembers so you don't have to |

### Operator-Facing (Admin Dashboard)

| Feature | What It Does | Operator Benefit |
|---------|-------------|-----------------|
| 56-table browser | Raw database access with export | Debug anything without engineering |
| Segment email | Campaign by country/tier/status/activity | Target the right users at the right time |
| Place pool builder | Import cities from Google Places API | Launch new markets in hours, not weeks |
| Content moderation | Review/edit/delete experiences | Maintain quality without code deploys |
| Pool intelligence | Geographic inventory + category maturity | Know where to invest in content |
| Feature flags | Toggle features on/off | Ship safely with instant rollback |
| Subscription overrides | Grant premium manually | Support, partnerships, influencer deals |
| Audit logging | Every admin action tracked | Accountability and compliance |

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: All features traced to implementation | Confidence: H

---

## 5. Messaging Framework

### Brand Voice
- **Tone:** Confident, playful, decisive. Like a friend who always knows where to go.
- **Evidence from code:** Onboarding copy ("Good taste just walked in"), value prop beats ("Find it fast. Go."), status presets ("Looking for plans", "Open to meet")
- **Not:** Generic, corporate, over-enthusiastic, or feature-listy

### Primary Messages (by ICP)

**Urban Social Planner:**
> "Stop asking 'where should we go?' Mingla tells you. Swipe, save, schedule -- done."

**Coupled Explorer:**
> "Date night, planned in one swipe. Mingla learns what you both love and plans it for you."

**Solo Adventurer:**
> "Your city has more than you think. Mingla finds the spots you'd never Google."

### Tagline Options (derived from code copy)
- "Find it fast. Go." (from onboarding beat 3)
- "Know exactly where to go." (from onboarding beat 1)
- "Good taste walks in." (from welcome screen)
- "Discover. Plan. Go." (from core loop)

### Elevator Pitch
Mingla is a mobile app that uses AI to match you with personalized experiences -- restaurants, activities, nature spots, date ideas -- based on your taste, budget, and vibe. You swipe through a deck of recommendations, save what you like, schedule it to your calendar, and plan it with friends through collaborative boards. It's like having a local expert who knows exactly what you're into.

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: All copy strings in onboarding, UI labels, notification templates | Confidence: H

---

## 6. Competitive Positioning

### Competitive Landscape

| Competitor | What They Do | What Mingla Does Differently |
|-----------|-------------|------------------------------|
| **Google Maps** | Search-based place finding | AI-personalized deck (no searching), social planning, swipe UX |
| **Yelp** | Review-based discovery | Proactive recommendations (not reactive search), collaborative boards, scheduling |
| **TripAdvisor** | Tourist-focused reviews | Local-first (not tourist), real-time social map, taste matching |
| **Tinder/Hinge** | People matching via swipes | Experience matching (places, not faces), planning tools, no dating pressure |
| **Meetup** | Event-based group activities | Spontaneous discovery (not scheduled events), AI curation, private groups |
| **Partiful** | Event invitations | Experience discovery + planning (not just invites), AI recommendations |
| **Date Night App** | Couple date ideas | Multi-segment (not just couples), collaborative boards, real-time map |

### Mingla's Moat (from code)

1. **Data flywheel:** Every swipe trains `user_preference_learning` -> better recommendations -> more swipes
2. **Social graph lock-in:** Friends, pairs, collaboration sessions create switching costs
3. **Place pool depth:** 50K+ pre-enriched places with cached photos, descriptions, hours
4. **Card pool intelligence:** Pre-built cards with scoring, not raw API data
5. **Collaborative planning:** Group decision-making (votes, RSVP, board chat) is hard to replicate

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: Technical architecture, data model, feature depth | Confidence: M (competitive analysis is market-dependent)

---

## 7. Attribution & Campaign Measurement

### What's Measurable Today
- **Install volume** per campaign/channel (AppsFlyer automatic)
- **Product engagement** patterns (Mixpanel -- 25+ events)
- **Behavioral depth** (Supabase -- card interactions, timing, location context)
- **Revenue** (RevenueCat -- subscription status, LTV)

### Key Marketing Metrics

| Metric | Formula | Events Required |
|--------|---------|----------------|
| Install -> Signup Rate | registrations / installs | af_complete_registration |
| Signup -> Activation Rate | tutorial_completions / registrations | af_tutorial_completion |
| Trial -> Paid Conversion | subscriptions / trial_starts | af_subscribe, af_start_trial |
| ROAS | subscription_revenue / ad_spend | af_subscribe (with af_revenue) |
| Viral Coefficient | invites_sent / activated_users | af_invite, af_tutorial_completion |
| Engagement Quality | saves / activated_users | af_add_to_wishlist, af_tutorial_completion |
| Intent Depth | schedules / saves | experience_scheduled, af_add_to_wishlist |
| Retention (Dx) | logins_day_x / installs | af_login |

### Retargeting Audiences

| Audience | Definition | Use Case |
|----------|-----------|----------|
| Installed, not registered | Install event, no af_complete_registration | Re-engagement ads |
| Registered, not onboarded | af_complete_registration, no af_tutorial_completion | Push to complete setup |
| Trial active, not subscribed | af_start_trial, no af_subscribe | Trial conversion campaigns |
| Trial expired, not subscribed | af_start_trial > 7 days ago, no af_subscribe | Win-back offers |
| Active savers, not subscribers | af_add_to_wishlist > 5, no af_subscribe | Upgrade nudge |
| Inviters (high viral value) | af_invite > 0 | Lookalike audiences |
| Subscribers | af_subscribe | Exclusion lists, upsell (Pro -> Elite) |

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: appsFlyerService.ts, mixpanelService.ts, all analytics services | Confidence: H

---

## 8. Go-to-Market Strategy (Code-Informed)

### Launch Readiness (What the Code Says)

**Ready:**
- Full onboarding flow (7 steps, crash recovery, resume)
- Card deck with 2-wave loading (pool + curated)
- Collaboration sessions with full board workflow
- 3-tier pairing system
- DM chat with presence + typing indicators
- Discover Map with privacy controls
- Save -> Schedule -> Device calendar pipeline
- 7-day Elite trial with referral bonus loop
- Admin dashboard with place pool management + email campaigns
- 72 edge functions, 70+ tables, comprehensive RLS

**Growth Levers Built Into the Product:**

| Lever | Mechanism | Viral Coefficient Potential |
|-------|-----------|---------------------------|
| **Phone invites** | Onboarding Step 5 prompts adding friends by phone | Direct invite with deep link |
| **Referral rewards** | 1 month Elite per accepted friend | Strong incentive for existing users to invite |
| **Collaboration invites** | Session invites via friends list, link, QR code | Social planning requires friends on the platform |
| **Share modal** | Native share of experience cards | Content-driven awareness |
| **Map friend requests** | 10/day friend requests to strangers on map | Organic network growth within geography |
| **Pair invites to non-users** | Tier 3 pair request sends SMS to non-registered phones | Relationship-driven pull |

### City Launch Playbook (from admin tools)

1. **Seed place pool:** Admin -> Place Pool -> Seed & Import -> Search Google Places by city
2. **Backfill photos:** Admin -> Place Pool -> Photos -> Backfill by city
3. **Generate cards:** Admin -> Card Pool -> Generate -> Create single + curated cards
4. **Validate quality:** Admin -> Card Pool -> Health -> Check coverage by category
5. **Seed map strangers:** `admin-seed-map-strangers` edge function populates Discover Map
6. **Soft launch:** Feature flag gating + segment email to local users
7. **Monitor:** Analytics -> Geography -> Watch signup + engagement by city

### Monetization Path

```
Day 0: Install -> OAuth -> Onboarding
Day 0: Elite trial starts (7 days, all features)
Day 1-6: User discovers, saves, schedules, collaborates, pairs
Day 6: Push notification: "Your trial ends tomorrow"
Day 7: Trial expires -> Free tier (20 swipes/day, 1 session, no pairing, no curated)
Day 7+: Upgrade friction points:
  - Swipe 21 blocked by paywall
  - "Create Session" hits limit -> paywall
  - "Pair" button -> paywall (Elite only)
  - "Curated cards" badge -> paywall
  - "Custom starting point" -> paywall
```

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: Admin tools, referral system, tier gating, notification lifecycle | Confidence: H

---

## 9. Content & Campaign Strategy (Code-Informed)

### Content Pillars (derived from app categories)

| Pillar | App Categories | Content Themes |
|--------|---------------|----------------|
| **Date Night** | first_meet, fine_dining, romantic intent | "Where to take them", couple discovery, pairing feature stories |
| **Squad Goals** | group-fun intent, casual_eats, drink, play | "Plan together", collaboration board stories, voting feature |
| **Urban Explorer** | nature, creative_arts, wellness, adventurous intent | "Hidden gems", solo discovery, map exploration |
| **Weekend Plans** | picnic, picnic_park, live_performance, watch | "This weekend in [city]", schedule feature, curated routes |

### Lifecycle Email Segments (Built Into Admin)

| Segment | Filter | Campaign Type |
|---------|--------|---------------|
| All Users | -- | Product updates, new city launches |
| By Country | country field | Localized content, market-specific |
| By Onboarding Status | has_completed_onboarding | Completion nudges, tutorial content |
| By Subscription Tier | free/pro/elite | Upgrade campaigns, tier-specific value |
| By Last Active (7d/30d/90d) | activity timestamp | Re-engagement, win-back |
| By City | location field | City-specific recommendations, local events |
| Inactive 30+ days | last_active > 30d ago | Win-back offers, what's new |

### Push Notification Strategy (Already Built)

| Timing | Notification | Purpose |
|--------|-------------|---------|
| 24h post-signup | Onboarding incomplete | Complete setup |
| Trial day 6 | Trial ending | Create urgency |
| 3 days inactive | Re-engagement | Bring back |
| 7+ days inactive | Re-engagement (personalized) | Mentions friend name |
| Weekly | Digest | Stats + engagement |
| Day before scheduled | Calendar reminder | Drive visit |
| Holiday eve | Holiday reminder | Drive paired experience |

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: notify-lifecycle, admin email page, notification preferences | Confidence: H

---

## 10. Key Metrics to Track at Launch

### North Star Metric
**Scheduled Experiences per Active User per Week** -- this is the ultimate measure of value delivery (user discovered something AND committed to going).

### Funnel Metrics

| Stage | Metric | Target |
|-------|--------|--------|
| Acquisition | Install -> Onboarding Start | > 80% |
| Activation | Onboarding Start -> Complete | > 60% |
| First Value | Complete -> First Save | > 70% (within first session) |
| Engagement | First Save -> First Schedule | > 30% |
| Retention | D1 / D7 / D30 | 50% / 25% / 15% |
| Monetization | Trial -> Paid | > 5% |
| Referral | Users who invite >= 1 friend | > 20% |

### Feature Adoption Metrics

| Feature | Metric | Healthy Signal |
|---------|--------|---------------|
| Deck | Swipes per session | > 10 |
| Save | Save rate (right swipes / total swipes) | 15-30% |
| Schedule | Schedule rate (scheduled / saved) | > 20% |
| Map | Map sessions per week | > 2 |
| Chat | Messages sent per week | > 5 (among connected users) |
| Collaboration | Sessions created per user | > 0.3 |
| Pairing | Pair requests sent (Elite) | > 0.5 |
| Referral | Invites sent per user | > 1 |

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: Feature depth, engagement mechanics, tier structure | Confidence: M (targets are estimates, need calibration)

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **Cold start (empty place pool)** | High for new cities | Critical | Admin place pool builder + Google Places API seeding pipeline |
| **Onboarding drop-off** | Medium (7 steps) | High | Crash recovery, skip options on Steps 5-6, progress bar |
| **Free tier too restrictive** | Medium | High | 20 swipes/day is enough to discover value; trial gives full access |
| **Pairing = Elite only** | Medium | Medium | Referral loop gives free path to Elite; trial period to experience |
| **Map requires GPS** | Low | Medium | Required in onboarding; manual location fallback exists |
| **Quiet map (few users)** | High at launch | High | Seed map strangers feature populates with "stranger" profiles |
| **Group planning friction** | Medium | Medium | Simple flow: create session -> invite -> board auto-created |

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: Feature gating, admin tools, onboarding design | Confidence: H

---

*Document maintained by PMM Codebase Analyst | Source of truth: codebase, not documentation*
