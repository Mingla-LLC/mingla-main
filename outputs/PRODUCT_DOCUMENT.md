# Mingla — Product Document

> Created: 2026-03-16 | Updated: 2026-03-29 | Status: Complete (Full Forensic Analysis)
> Source of truth: codebase, not documentation

---

## 1. Product Overview

**Product:** Mingla — AI-powered experience discovery and social planning app
**Platform:** React Native (Expo) — iOS and Android
**Admin:** React 19 + Vite web dashboard for operators
**Backend:** Supabase (PostgreSQL + 72 Edge Functions + Realtime + Storage)
**Category:** B2C consumer app — social/lifestyle/experiences
**Core Loop:** Set preferences -> Discover experiences -> Save -> Schedule -> Go with friends

> Updated: 2026-03-29 | Trigger: Full forensic analysis | Evidence: All three domains analyzed | Confidence: H

---

## 2. Monetization Model

### Subscription Tiers (RevenueCat)

| Feature | Free | Pro | Elite |
|---------|------|-----|-------|
| Daily swipes | 20 | Unlimited | Unlimited |
| Pairings | 0 | 0 | Unlimited |
| Board sessions | 1 (up to 5 people) | 3 (up to 5 people) | Unlimited (up to 15 people) |
| Curated cards | No | Yes | Yes |
| Custom starting point | No | Yes | Yes |

**Trial:** 7-day Elite access starts automatically on onboarding completion (DB trigger: `trg_create_subscription_on_onboarding`)

**Referral bonus:** 1 month Elite per accepted friend referral (unlimited earning potential). Tracked in `referral_credits` table. Credited atomically when `friend_requests.status` -> accepted.

**Effective tier resolution:** RevenueCat entitlement > admin override > active trial > referral bonus > Free

**Swipe enforcement:** Free users hit paywall after 20th swipe/day. `daily_swipe_counts` table tracks per-user per-day. PanResponder synchronously blocks swipe 21+.

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: tierLimits.ts, revenueCatService.ts, subscriptionService.ts, CustomPaywallScreen.tsx | Confidence: H

---

## 3. Architecture Overview

### Monorepo Structure

| Domain | Path | Stack | Lines |
|--------|------|-------|-------|
| Mobile | `app-mobile/` | React Native, Expo, TypeScript, React Query, Zustand | ~100 components, ~67 hooks, ~75 services |
| Admin | `mingla-admin/` | React 19, Vite, JSX, Tailwind v4, Framer Motion, Recharts, Leaflet | 42 files, 14 pages, 14 UI components |
| Backend | `supabase/` | PostgreSQL, 72 Deno Edge Functions, RLS, Realtime, Storage | 293 migrations, 30+ RPCs |

### State Management (Mobile)
- **React Query:** Server state (preferences, saved cards, calendar, subscriptions, conversations)
- **Zustand:** Client state (app store: user, profile, deck batches, navigation)
- **React Context:** Navigation, Recommendations, Cards Cache, Toast
- **AsyncStorage:** Crash recovery (onboarding data), trial expiry flags, location cache

### Navigation Model
- Custom tab-based (NOT React Navigation)
- `currentPage` state drives tab switching via `useAppState()`
- Full-screen overlays: priority render order (friend profile > paywall > legal docs > current page)
- Modal sheets: overlay current tab, keep tabs visible
- Deep links: `mingla://` custom scheme + universal links (`usemingla.com`)

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: index.tsx, AppStateManager.tsx, all navigation | Confidence: H

---

## 4. User Model & Roles

### Consumer (Mobile App)
- **Auth:** Google Sign-In or Apple Sign-In (OAuth) -> phone verification (Twilio OTP)
- **Identity:** first_name, last_name, phone (E.164), gender (8 options), birthday, country, language
- **Tiers:** Free, Pro, Elite (see Monetization)
- **Relationships:** Friend, Paired, Stranger, Blocked, Muted

### Admin (Dashboard)
- **Auth:** 3-layer (email allowlist -> password -> OTP 2FA)
- **Roles:** Owner, Admin (from `admin_users` table)
- **Invited flow:** Magic link -> password setup -> auto-activate

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: AuthContext.jsx, WelcomeScreen.tsx, AccountSettings.tsx | Confidence: H

---

## 5. Complete User Journey: Onboarding

### Pre-Onboarding: Authentication
1. User opens app -> `WelcomeScreen` with Google/Apple sign-in buttons
2. OAuth completes -> `profiles` row auto-created (DB trigger)
3. If `has_completed_onboarding = false` -> onboarding flow launches

### Step 1: Authentication & Identity (5 substeps)

**1a. Welcome**
- UI: Cinematic text reveal ("Hey, {firstName}. Good taste just walked in.")
- Input: First name + Last name
- Result: Names saved to `profiles` table

**1b. Phone**
- UI: Phone input with country picker
- Input: E.164 phone number
- Result: OTP sent via `send-otp` edge function (Twilio Verify)

**1c. OTP**
- UI: 6-digit code entry with auto-complete
- Input: 6-digit SMS code
- Failure: After 3 attempts, auto-resends fresh code
- Result: Phone verified, saved to `profiles.phone` server-side

**1d. Gender Identity**
- UI: Radio list (man, woman, non-binary, transgender, genderqueer, genderfluid, agender, prefer-not-to-say)
- Input: One selection (required)

**1e. Details**
- UI: 3 pickers (Country, Date of Birth, Language)
- Birthday validation: min age 13, max 120 years
- Country change triggers currency + measurement system auto-update
- Result: Profile updated with gender, birthday, country, language, currency, measurement_system

### Step 2: Intent & Value Proposition (2 substeps)

**2a. Value Prop**
- UI: 3 sequential "beats" with animations
  1. "Know exactly where to go"
  2. "For dates, friends & solo runs"
  3. "Find it fast. Go."

**2b. Intents**
- UI: 6 selectable cards (radio, pick 1)
- Options: adventurous, first-date, romantic, group-fun, picnic-dates, take-a-stroll
- Result: Intent stored, `onboarding_step = 3` persisted

### Step 3: Location

- UI: "Enable location" button -> GPS permission request
- If granted: High-accuracy GPS fix (10s timeout) -> reverse geocode to city name
- GPS is required: No skip path. Manual location only available as Step 4 resume fallback.
- Result: Coordinates + city name stored

### Step 4: Preferences (up to 6 substeps)

**4a. Celebration** — Breathing room screen ("You're all set!")

**4b. Manual Location** (only if GPS denied) — Text input with autocomplete

**4c. Categories** — Grid of 13 category tiles (max 3 selections)
- nature, casual_eats, drink, fine_dining, watch, live_performance, creative_arts, play, wellness, flowers, first_meet, picnic, picnic_park

**4d. Budget** — 3 price tier cards (multi-select, min 1)
- comfy ($), bougie ($$), fancy ($$$)

**4e. Transport** — 4 tiles (radio): walking, biking, transit, driving

**4f. Travel Time** — Presets (15, 30, 45, 60 min) + custom (5-120 min)
- Result: All Step 4 preferences saved to `preferences` table. Deck pool pre-warmed.

### Step 5: Friends & Pairing

- UI: Phone input for friend lookup + add friend button
- Can add existing users, send invites to non-users, send pair requests
- Incoming friend requests shown if any
- Skip option: "I'll do this later"

### Step 6: Collaborations

- UI: Select friends -> name session -> "Create session" button
- Can accept pending collaboration invites
- Skip option: Optional, can continue without creating

### Step 7: Consent & Launch (2 substeps)

**7a. Consent**
- UI: Shield icon, "One quick thing" headline, privacy message
- CTA: "Sounds good -- let's go"

**7b. Getting Experiences**
- UI: Spinning compass with progress bar -> "Your deck is ready" success
- Backend: `has_completed_onboarding = true`, `onboarding_step = 0`
- Fires: `af_tutorial_completion`, `af_start_trial` (7-day Elite)
- Clears AsyncStorage persistence
- User lands on Home tab with first deck loaded

### Crash Recovery
- Every change debounce-saved to AsyncStorage (500ms)
- On restart: `useOnboardingResume` restores step + data from AsyncStorage + DB `onboarding_step`

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: OnboardingFlow.tsx, useOnboardingStateMachine.ts, useOnboardingResume.ts, all step components | Confidence: H

---

## 6. Navigation & Information Architecture

### Bottom Tab Bar (5 tabs)

| Tab | Label | Icon | Component | Badge |
|-----|-------|------|-----------|-------|
| 1 | Explore | home-outline | HomePage.tsx | -- |
| 2 | Discover | compass-outline | DiscoverScreen.tsx | -- |
| 3 | Chats | chatbubbles-outline | ConnectionsPage.tsx | Unread message count |
| 4 | Likes | heart-outline | LikesPage.tsx | Unread board messages |
| 5 | Profile | person-outline | ProfilePage.tsx | -- |

Note: "Saved" tab exists in code but is commented out in the nav bar.

### Full-Screen Overlays (hide tabs)
- **ViewFriendProfileScreen** — triggered by `viewingFriendProfileId`
- **PaywallScreen** — triggered by `showPaywall` or deep link `mingla://subscription`
- **TermsOfService** — triggered by `showTermsOfService`
- **PrivacyPolicy** — triggered by `showPrivacyPolicy`

### Modal Sheets (overlay, keep tabs visible)
- **PreferencesSheet** — solo or collab preferences
- **ShareModal** — native share integration
- **PostExperienceModal** — locked modal for voice reviews after scheduled experience

### Deep Links

| Route | Target | Parameters |
|-------|--------|------------|
| `mingla://home` | Home tab | -- |
| `mingla://discover` | Discover tab | -- |
| `mingla://connections` | Chats tab | `tab=messages`, `conversationId` |
| `mingla://session/{id}` | Home tab | Opens specific session |
| `mingla://messages/{id}` | Chats tab | Opens conversation |
| `mingla://calendar/{id}` | Likes tab | Opens calendar entry |
| `mingla://review/{id}` | Likes tab | Triggers review modal |
| `mingla://profile` | Profile tab | -- |
| `mingla://subscription` | Paywall overlay | -- |
| `mingla://onboarding` | Restart onboarding | -- |
| `mingla://board/{code}` | Board invite | Legacy |
| `mingla://likes` | Likes tab | -- |

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: index.tsx navigation, deepLinkService.ts | Confidence: H

---

## 7. Core Feature: Preference Sheet

### What It Is
Modal interface for customizing discovery parameters. Available in both solo and collaboration modes.

### Preferences Available

| Setting | Options | Constraint |
|---------|---------|-----------|
| Experience Types (Intents) | 6 types (adventurous, first-date, romantic, group-fun, picnic-dates, take-a-stroll) | Max 3 |
| Place Categories | 12 types (nature, drink, casual_eats, fine_dining, watch, live_performance, creative_arts, play, wellness, flowers, first_meet, picnic_park) | Max 8 |
| Price Tiers | Chill ($), Comfy ($$), Bougie ($$$), Lavish ($$$$) | Min 1 |
| Travel Mode | Walking, Biking, Transit, Driving | Pick 1 |
| Travel Time | 15, 30, 60 min presets or custom (5-120 min) | Required |
| Date Option | Now, Today, This Weekend, Pick a Date | Pick 1 |
| Time Slot | Brunch (11-1), Afternoon (2-5), Dinner (6-9), Late Night (10-12) | Optional |
| Starting Point | GPS (default) or Custom Location (Pro/Elite only) | GPS required for free |

### What Happens After Save
1. Preferences written to `preferences` table (solo) or `board_session_preferences` (collab)
2. `RecommendationsContext` detects change
3. New `batchSeed` generated (forces fresh card fetch)
4. Deck clears and loads new cards matching new preferences

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: PreferencesSheet.tsx (14K lines), PreferencesSections.tsx, PreferencesSectionsAdvanced.tsx | Confidence: H

---

## 8. Core Feature: Swipeable Card Deck (Home Tab)

### What It Is
Tinder-style infinite card carousel on the Home/Explore tab. Users swipe left (pass) or right (save) to discover experiences.

### Card Types

| Type | Source | Content |
|------|--------|---------|
| Category Cards | `discover-cards` edge function + `card_pool` table | Single place: name, photo, rating, distance, travel time, category, price |
| Curated Cards | `generate-curated-experiences` edge function | Multi-stop itinerary: anchor + 3-5 companion stops, route map, timeline |

Cards are interleaved 1:1 (regular : curated) for variety. Batch size: 20 cards.

### Card Data Shown
- Primary photo + gallery
- Title, category icon + label
- Rating (0-5 stars) + review count
- Price range ($ tier label)
- Distance + travel time from user
- Match score (0-100)
- Description, highlights, pro tip
- Opening hours + open/closed status

### Swipe Actions & Outcomes

| Action | Gesture/Button | Database Effect | UI Result |
|--------|---------------|-----------------|-----------|
| Save (Like) | Swipe right | `INSERT INTO saves` (liked) + `user_interactions` (swipe_right) | Card disappears, added to Saved tab |
| Pass (Dismiss) | Swipe left | `INSERT INTO saves` (disliked) + `user_interactions` (swipe_left) | Card disappears, added to dismissed history |
| Expand | Tap card / Up button | None | Opens ExpandedCardModal with full details |
| Schedule | Button in expanded view | `INSERT INTO calendar_entries` | Toast: "Added to calendar" |
| Share | Button in expanded view | Calls native share sheet | OS share menu |

### Deck Loading States

| State | UI | Trigger |
|-------|------|---------|
| INITIAL_LOADING | Skeleton placeholder cards | Component mount or preference change |
| LOADED | First card visible with swipe gestures | Batch received |
| BATCH_LOADING | "Pulling up more for you" spinner | < 5 cards remaining, prefetch triggered |
| BATCH_SLOW | Indeterminate progress bar | Batch takes > 2s |
| EXHAUSTED | "No more cards" + refresh button | All cards in all batches swiped |
| ERROR | Error message + "Try Again" | Network failure |

### Swipe Limit Enforcement
- Free: 20/day (PanResponder blocks swipe 21+, shows paywall)
- Pro/Elite: Unlimited
- Tracked in `daily_swipe_counts` table, resets daily

### Collaboration Mode
In collab mode, the deck uses `generate-session-deck` edge function which aggregates group preferences. Swipe state tracked per-user in `board_card_interactions`.

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: SwipeableCards.tsx (2100+ lines), deckService.ts, RecommendationsContext.tsx | Confidence: H

---

## 9. Core Feature: Discover Map (Discover Tab)

### What It Is
Interactive map-based discovery with nearby people, place markers, route visualization, and privacy controls.

### Map Technology
- iOS: react-native-maps (Apple Maps)
- Android: MapLibre with CartoDB light tiles
- No POIs, traffic, buildings shown (clean presentation)

### What Appears on the Map

**User's Own Marker**
- Avatar + initials badge (56x68)
- Pulsing orange ring animation
- Status bubble below showing activity status
- Tap: Shows greeting alert

**Place Markers (max 30 visible)**
- Wave 1 (fast, ~500ms): Up to 200 single places from `card_pool` via `discover-cards`
- Wave 2 (slow, 2-5s): AI-generated curated routes via `curatedExperiencesService`
- 8 slots reserved for curated cards, 22 for singles
- Pin design: Colored border by price tier (green=chill, blue=comfy, purple=bougie, amber=lavish)
- Badges: Heart (saved), People (paired person saved), Calendar (scheduled)

**Curated Route Visualization**
- Dashed orange polyline connecting all stops
- Numbered stop markers (1, 2, 3...)
- Tap stop for tooltip with place name + role

**People Markers (nearby users)**
- Fetched via `get-nearby-people` edge function (15km radius, 60s refresh)
- Pin design: Avatar circle with colored border (orange=paired, blue=friend, gray=stranger)
- Online dot: Green if active in last 15 min
- Taste match badge (strangers only): Orange pill showing % match

### Visibility & Privacy

| Setting | Who Sees You |
|---------|-------------|
| Everyone | All map users |
| Friends of friends | Extended network |
| Friends | Accepted friends only |
| Paired | Paired users only |
| Nobody | Completely hidden |

**Privacy Obfuscation:** Real location never exposed to clients. Approximate location uses deterministic daily offset (300-500m) + rotation per pairing. Paired users appear together.

**"Go Dark":** Hides you for specified duration regardless of visibility setting.

### Map Interactions

| Tap Target | Result |
|-----------|--------|
| Place pin | MapBottomSheet (45% or 90% snap): image, title, category, rating, Details + Next buttons |
| Person pin | PersonBottomSheet (40% snap): avatar, name, relationship label, Message/Invite/Profile buttons |
| Stranger pin | Additional: Taste match %, shared categories, Add Friend (10/day limit), Block, Report |
| User's own marker | Alert greeting |

### Map Layers (Toggleable)
- **People** (default on): Nearby user markers
- **Places** (default on): Card markers
- **Feed** (default off): Real-time activity notifications (paired saves, visits)
- **Heatmap** (default off): Semi-transparent density dots for at-a-glance visualization

### Activity Status
- 4 presets: "Exploring", "Looking for plans", "Open to meet", "Busy"
- Custom text option
- Optional expiration timer
- Location updated every 60s (100m minimum distance)

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: DiscoverMap.tsx, DiscoverScreen.tsx, all map/ components, get-nearby-people edge function | Confidence: H

---

## 10. Core Feature: Pairing & Connections System

### Relationship Types

| Type | How Established | What It Enables |
|------|----------------|-----------------|
| **Stranger** | Default state | Map visibility (if both set to "everyone"), taste match % |
| **Friend** | Accept friend request | DM chat, collaboration invites, profile visibility, map visibility |
| **Paired** | Accept pair request (Elite only) | Shared saves, custom holidays, birthday/gender visibility, paired discovery cards, always visible on map |
| **Blocked** | Block action (any state) | Complete mutual invisibility everywhere |
| **Muted** | Mute action | Messages still appear but notifications suppressed |

### Friend Request Flow
1. User A sends friend request (from map, discover, phone invite)
2. User B receives push notification + in-app notification
3. User B accepts/declines
4. On accept: Bidirectional `friends` rows created, referral credit triggered if applicable

### 3-Tier Pairing System

**Tier 1: Direct (Friends Only)**
- Precondition: Already friends
- Pair request is immediately visible to receiver
- Pill state: bright, normal color

**Tier 2: Conditional (Non-Friends)**
- Sends friend request + hidden pair request simultaneously
- Pair request `visibility = 'hidden_until_friend'`
- DB trigger `reveal_pair_requests_on_friend_accept()` unhides when friendship accepted
- Pill state: greyed out until friend request accepted, then pending

**Tier 3: Pre-Signup (Phone-Based)**
- Sends SMS invite to non-registered phone number
- Creates `pending_pair_invites` row
- On target signup: converts to Tier 1 or 2 depending on friendship status
- Pill state: greyed, shows phone number

### What Pairing Unlocks
- Shared saved cards (automatic on pair acceptance)
- Custom holidays (user-created dates like "Sarah's Birthday")
- Birthday + gender visible in pairing info
- Paired discovery cards (experiences for "us" not just "me")
- Always visible on map to each other
- Personalized holiday experience cards
- All shared data cascades delete on unpair

### Collaboration Sessions
1. Creator invites friends -> `collaboration_sessions` + `collaboration_invites` created
2. Friend accepts invite -> `session_participants` updated, board auto-created when >= 2 accepted
3. Board preferences seeded from acceptor's solo preferences
4. All participants collaborate on shared board: voting, RSVP, discussion
5. Session types: group_hangout, date_night, squad_outing, business_meeting

### Collaboration Session UI
- **Pill bar** on Home tab: Shows active sessions + invitations as horizontal scrollable pills
- **CollaborationModule modal**: Full management with Sessions/Invites/Create tabs
- **Board**: Shared activity board with saved cards, votes, RSVP, chat

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: pairingService.ts, friendsService.ts, ConnectionsPage.tsx, CollaborationSessions.tsx, all pairing migrations | Confidence: H

---

## 11. Core Feature: Chat System

### Architecture
Two separate chat systems:
1. **Direct Messages (1:1)** — Between friends/paired users
2. **Board Chat** — Within collaboration sessions (separate tables)

### Direct Message Features

| Feature | Implementation |
|---------|---------------|
| Text messages | `messages.content`, `message_type='text'` |
| Image sharing | Supabase Storage, `message_type='image'`, 240x200 preview |
| Video sharing | Placeholder UI (expo-av rebuild pending), `message_type='video'` |
| File sharing | Document icon + name + size, `message_type='file'` |
| Read receipts | Double blue checkmark when read (via `message_reads` table) |
| Typing indicators | Ephemeral broadcast (no DB storage), 3 bouncing dots, 4s timeout |
| Online/offline status | Heartbeat every 30s via `conversation_presence`, 60s stale threshold |
| Message grouping | Same sender + within 2 min = grouped (compact spacing) |
| Push notifications | Via `notify-message` edge function -> OneSignal |
| Block enforcement | Checked at conversation creation + send time |
| Mute support | Messages appear but notifications suppressed |

### Message Delivery (Dual Channel)
1. **Broadcast** (instant): Supabase Realtime broadcast channel
2. **Postgres Changes** (backup): Subscription on `messages` table
3. Deduplication via `broadcastSeenIds` ref

### Chat Creation
- Lazy: Only created when first message is sent (not on friendship/pairing)
- Block check before creation
- `getOrCreateDirectConversation()` finds existing or creates new

### Board Chat (Collaboration)
- Board-level discussion (`board_messages`) with mentions and replies
- Card-specific threads (`board_card_messages`)
- Emoji reactions (`board_discussion_reactions`)
- Read receipts per message type

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: messagingService.ts, MessageInterface.tsx, chatPresenceService.ts, all chat components | Confidence: H

---

## 12. Core Feature: Saved Tab & Calendar (Likes Tab)

### Saved Tab

**What Can Be Saved:** Regular places (single cards) and curated multi-stop experiences (Pro/Elite)

**How to Save:**
- Swipe right on deck card
- Tap save button on expanded card modal
- Save from map bottom sheet

**Saved Card Display:**
- Image thumbnail (80x80) + title + category + rating + price
- Source badge: Blue "Solo" or Purple "Collaboration [Session Name]"
- Meta stats: Views, Likes, Saves counts
- Quick actions: Schedule (orange), Share, Remove (red)

**Filters:** Text search, When (all time/today/this week/this month/upcoming), Category, Price tier

**Storage:** `saved_card` table (solo) or `board_saved_cards` table (collab)

### Calendar Tab

**How to Schedule:**
1. Tap "Schedule" on any saved card
2. `ProposeDateTimeModal` opens with date options: Now, Today, Weekend, Custom
3. Opening hours checked for selected date/time (all stops for curated cards)
4. On confirm: Card removed from Saved, entry created in `calendar_entries`
5. Native device calendar event created (expo-calendar) with 15-min reminder
6. Toast: "Scheduled! [Card Name] has been moved to your calendar"

**Calendar Display:**
- Active section (expanded): Future/upcoming items sorted by date
- Archive section (collapsed): Past items
- Per entry: Image, title, category, date/time, status badge (Pending/Confirmed/Completed)
- Quick actions: Reschedule, Share, Remove, QR Code (if purchased)

**Reschedule:** Opens same date/time picker, updates both Supabase + device calendar event

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: SavedTab.tsx, CalendarTab.tsx, savedCardsService.ts, calendarService.ts, deviceCalendarService.ts | Confidence: H

---

## 13. Core Feature: Profile & Settings

### Profile Screen

**Visible Elements:**
- Hero section: Avatar, name (editable inline), bio (160 char, via EditBioSheet)
- Interests: Multi-select pill UI for intents + categories (via EditInterestsSheet)
- Stats row: Saved experiences count, Connections count, Boards count
- Gamified level: Explorer -> Adventurer -> Trailblazer -> Legend (based on places visited)
- Paired profile section (if paired, Elite only)
- Links to: Billing, Account Settings, Privacy Policy, Terms of Service
- Sign Out button

**Photo Management:**
- Single avatar (not gallery)
- Upload: Camera or library -> 1:1 crop -> 800x800 max -> 0.8 quality -> Supabase Storage `avatars/{userId}_{timestamp}`
- Remove: Confirmation alert -> avatar_url set to NULL

### Account Settings (5 Accordion Sections)

**Section 1: The Basics**
- Country (auto-updates currency + measurement system)
- Birthday (date picker)
- Gender (4 options: Woman, Man, Non-binary, Prefer not to say)
- Language (10 languages)

**Section 2: Privacy**
- Profile Visibility: Friends Only / Everyone / Nobody (ghost mode)
- Show Activity toggle
- Notifications master toggle
- Map Privacy settings

**Section 3: Notification Preferences**
- Push Notifications (master toggle)
- Friends & Pairing, Link Requests, Messages, Collaboration Invites, Marketing (sub-toggles)
- Quiet Hours: Time range + DM bypass toggle

**Section 4: Quiet Hours**
- Start/end time pickers
- DM Bypass toggle (messages bypass quiet hours)

**Section 5: App Info**
- Version, Build number, Debug info

**Delete Account:**
- Multi-step confirmation flow (45s timeout)
- Calls `delete-user` edge function (GDPR cascade delete)
- Auto sign-out on success

### Subscription Management (BillingSheet)
- Current plan card: Tier name, icon, trial badge + days remaining, referral bonus badge
- Compare plans: Free vs Pro vs Elite with feature checklists
- Upgrade CTA -> CustomPaywallScreen (RevenueCat)
- Restore Purchases button

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: ProfilePage.tsx, AccountSettings.tsx, BillingSheet.tsx, CustomPaywallScreen.tsx | Confidence: H

---

## 14. Analytics & Attribution Stack

### Architecture

```
User Action -> Component
    |-> mixpanelService.track*(...)        [Product events - 25+ events, fully wired]
    |-> logAppsFlyerEvent(...)             [Attribution events - partially wired]
    |-> userInteractionService.track*()    [Detailed behavior -> Supabase]
    |-> abTestingService.trackEvent()      [A/B test events -> Supabase]
```

### Mixpanel (Product Analytics) -- Fully Implemented
- 25+ events: Login, Onboarding steps, Preferences, Collaboration, Screen views, Card interactions, Scheduling, Friend requests, Sharing, Profile updates, Account settings

### Supabase (Behavioral Analytics) -- Fully Implemented
- Interaction types: view, like, dislike, save, unsave, share, schedule, click_details, swipe_left, swipe_right, tap
- Context: category, price, rating, time of day, day of week, location, recommendation source/rank
- Tables: `user_interactions`, `user_sessions`, `user_location_history`, `user_preference_learning`

### RevenueCat (Revenue) -- Fully Implemented
- Entitlements: 'Mingla Pro', 'Mingla Elite'
- Sync: After every purchase/restore, writes tier + expiry to Supabase

### OneSignal (Push Notifications) -- Fully Implemented
- Deep link routing per notification type
- Thread grouping (DMs grouped by conversation)

### A/B Testing -- Implemented
- Recommendation algorithm testing via `abTestingService`

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: All analytics service files | Confidence: H

---

## 15. Lifecycle & Retention Mechanics

### Activation Path
1. Install -> OAuth signup (Google/Apple)
2. 7-step onboarding flow (phone, identity, intents, location, preferences, friends, consent)
3. `has_completed_onboarding: true` -> 7-day Elite trial starts
4. First deck loads -> user starts swiping

### Lifecycle Notifications (Edge Function: notify-lifecycle)

| Type | Trigger | Timing |
|------|---------|--------|
| `onboarding_incomplete` | Signup without completing onboarding | 24+ hours after signup |
| `trial_ending` | Free trial about to expire | 1 day before trial_ends_at |
| `re_engagement` (3-day) | User inactive 3-7 days | Weekly bucket |
| `re_engagement` (7-day) | User inactive 7+ days | Biweekly bucket, personalized with friend name |
| `weekly_digest` | Active users in last 30 days | Weekly, includes stats |

### Retention Mechanics
- **Trial urgency:** 7-day countdown creates conversion pressure
- **Referral loop:** Each friend = 1 month Elite (viral growth + retention)
- **Collaboration stickiness:** Group sessions create social obligation to return
- **Calendar reminders:** Scheduled experiences push users back into app
- **Paired discovery:** Shared saves + custom holidays create relationship-driven engagement
- **Post-experience reviews:** Voice review modal after scheduled activity (locked, non-dismissible)
- **Taste matching:** Strangers see compatibility %, driving friend requests
- **Activity feed:** Real-time paired user activity on map

### Referral Loop Detail
1. User gets unique `referral_code` (format: `MGL-XXXXXXXX`)
2. Sends phone invite with deep link
3. Referred friend signs up + accepts friend request
4. DB trigger: `credit_referral_on_friend_accepted` credits 1 month Elite to referrer
5. Push notification sent to referrer

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: notify-lifecycle/index.ts, referral_credits migration, all retention-related code | Confidence: H

---

## 16. Backend Infrastructure

### Database: 70+ Tables
Key table groups:
- **Identity:** profiles, preferences, subscriptions, notification_preferences
- **Social:** friend_requests, pair_requests, pairings, blocked_users, muted_users, pending_pair_invites
- **Discovery:** place_pool (50K+ places), card_pool (pre-built cards), user_card_impressions
- **Collaboration:** collaboration_sessions, session_participants, collaboration_invites, boards, board_saved_cards, board_votes, board_rsvps
- **Messaging:** conversations, conversation_participants, messages, message_reads, conversation_presence, board_messages, board_card_messages
- **Activity:** saves, saved_cards, calendar_entries, user_visits, place_reviews, custom_holidays
- **Analytics:** user_interactions, user_preference_learning, user_location_history, user_sessions, user_activity
- **Admin:** admin_users, admin_audit_log, admin_subscription_overrides, feature_flags, admin_config

### Edge Functions: 72 Total
Key groups:
- **Discovery (12):** discover-cards, discover-{category} (10 category-specific), discover-experiences
- **Personalization (5):** get-personalized-cards, get-holiday-cards, get-person-hero-cards, get-paired-saves, get-nearby-people
- **Notifications (9):** notify-dispatch (central hub), notify-pair-activity, notify-invite-response, calendar/holiday reminders, lifecycle notifications
- **Auth (3):** send-otp, verify-otp, delete-user
- **Admin (6):** admin-seed-places, admin-refresh-places, backfill-place-photos, admin-send-email, admin-seed-map-strangers
- **Card Generation (4):** generate-single-cards, generate-curated-experiences, ai-validate-cards
- **Misc:** weather, events, ticketmaster-events, get-google-maps-key, keep-warm

### Card Serving Pipeline
1. Query `card_pool` by category + location bounding box
2. Exclude `user_card_impressions` (already seen)
3. Filter by opening hours (timezone-aware)
4. Filter by price tier match
5. Score 5 factors: category affinity, time-of-day, rating, popularity, preference learning
6. Rank by score descending
7. Paginate by batch_seed * limit
8. Record impressions (UNIQUE per user+card)
9. Return `{cards[], hasMore, diagnostics}`

Impressions reset when preferences change (trigger: `clear_impressions_on_preference_change`).

### Storage Buckets

| Bucket | Purpose |
|--------|---------|
| avatars | Profile pictures |
| place-photos | Google Places photos cached locally |
| person-audio | Audio clips for linked persons |
| messages | File attachments in DMs |
| voice-reviews | Post-visit voice feedback |
| beta-feedback | Screenshots from beta testers |

### Cron Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| cleanup-old-notifications | Weekly (Sun 3 AM UTC) | Delete expired + 90-day-old |
| keep-warm | Every 5 min | Ping edge functions to prevent cold starts |
| cleanup-stale-impressions | Daily (2 AM UTC) | Delete impressions > 30 days |
| deactivate-stale-places | Daily (1 AM UTC) | Mark stale place_pool inactive |
| cleanup-push-tokens | Weekly | Delete tokens inactive 30+ days |
| holiday-reminder | Daily (9 AM user tz) | Notify upcoming custom holidays |
| calendar-reminder | Daily (8 AM user tz) | Remind of next day's scheduled cards |

### RLS Security Model
- User owns: own profile, preferences, saves, interactions, conversations, messages, calendar, push tokens
- User can view (friends): friend profile + avatar, friend preferences
- Service role bypasses all RLS (admin functions, notifications)
- Session-based: only participants view/modify collaboration data

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: All 293 migrations, all 72 edge functions, RPCs | Confidence: H

---

## 17. Admin Dashboard (Operator Experience)

### Pages & Capabilities

| Page | Purpose | Key Actions |
|------|---------|-------------|
| **Dashboard** | 8 stat cards + alerts + recent activity | Quick action buttons to Reports, Moderation, Feedback |
| **User Management** | Full user list + detailed profiles | Edit, ban/unban, promote beta, impersonate, delete, export CSV |
| **Subscriptions** | Tier management | Grant/revoke tier overrides with expiry, view history |
| **Content Moderation** | Experiences, Card Pool, Reviews, Cache | View, edit, delete, bulk actions |
| **Place Pool** | 7 sub-tabs: Seed, Map, Browse, Photos, AI, Stale, Stats | Import cities, backfill photos, manage visibility |
| **Card Pool** | Overview, Browse, Generate, Health | Generate cards, monitor quality |
| **Analytics** | Growth, Engagement, Retention, Funnel, Geography | Time range selector (7d/30d/60d/90d/custom), Recharts |
| **Reports** | User safety reports | Status management (pending/reviewed/resolved/dismissed) |
| **Feedback** | App feedback + audio playback | Status workflow (new/reviewed/actioned/dismissed) |
| **Email** | Segment-based campaigns | Compose to segments (country/tier/status/activity), 100/day limit |
| **Admin Users** | Admin account management | Invite (magic link), revoke, activity audit |
| **Settings** | Theme, Feature Flags, App Config, Integrations | Toggle flags, manage config |
| **Table Browser** | Raw database access | Browse all 56 tables, sort, filter, export CSV |
| **Database Tools** | Seed scripts | Demo profiles, cache cleanup, session reset |
| **Pool Intelligence** | Geographic inventory, Category maturity, Neighborhood grid, Uncategorized, Card pool | City-level coverage analysis |

### Audit & Logging
- Every admin action logged to `admin_audit_log` with admin_email, action, target, metadata, timestamp
- Activity viewable per admin user

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: All mingla-admin/src/pages/ files | Confidence: H

---

## 18. Notification System

### Notification Types

| Type | Trigger | Channel | Deep Link |
|------|---------|---------|-----------|
| friend_request_received | Friend request sent | Push + In-app | `mingla://connections?tab=requests` |
| pair_request_received | Visible pair request | Push + In-app | `mingla://discover?pairRequest={id}` |
| pair_request_accepted | Pair acceptance | Push + In-app | `mingla://discover?pairing={id}` |
| collaboration_invite_received | Session invite | Push + In-app | Session view |
| session_member_joined | Participant accepts | Push + In-app | Session view |
| direct_message_received | DM sent | Push + In-app | `mingla://messages/{conversationId}` |
| paired_user_saved_card | Paired user saves card | In-app (map feed) | Map focus |
| paired_user_visited | Paired user visits place | In-app (map feed) | Map focus |
| calendar_reminder | Upcoming scheduled activity | Push | `mingla://calendar/{entryId}` |
| holiday_reminder | Upcoming custom holiday | Push | Holiday view |
| trial_ending | 1 day before trial expires | Push | `mingla://subscription` |
| onboarding_incomplete | 24h+ without completing | Push | `mingla://onboarding` |
| re_engagement | 3-7+ days inactive | Push | `mingla://home` |
| weekly_digest | Weekly for active users | Push | `mingla://home` |

### Dispatch Logic (notify-dispatch edge function)
1. Deduplication via `idempotency_key`
2. Preference check: `notification_preferences.{type}` must be true
3. Quiet hours: 10 PM - 8 AM (timezone-aware), DMs bypass
4. Create `notifications` row (in-app)
5. Send push via OneSignal (if `push_enabled`)

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: notify-dispatch, notify-lifecycle, all notification edge functions | Confidence: H

---

## 19. Security Model

### Authentication
- **Mobile:** OAuth (Google/Apple) -> phone OTP verification (Twilio)
- **Admin:** Email allowlist -> password -> OTP 2FA

### Row-Level Security
- Every table has RLS policies
- Users can only access own data + data from relationships they're part of
- Service role bypasses all RLS (edge functions, admin operations)
- Partial unique indexes prevent duplicate active relationships

### Privacy
- Map location: Real lat/lng never exposed. Approximate location uses deterministic daily offset (300-500m)
- Paired users: Custom rotation ensures they appear together
- Blocked users: Complete mutual invisibility (bidirectional)
- Profile visibility modes: Friends Only / Everyone / Nobody

### Data Protection
- Phone numbers sanitized (E.164 -> underscored in storage paths)
- `delete-user` edge function: GDPR cascade delete of all user data
- Beta feedback preserved anonymized on deletion
- Push tokens cleaned up after 30 days of inactivity

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: RLS policies across all migrations, privacy obfuscation logic | Confidence: H

---

## 20. Known Limitations & Technical Debt

| Area | Issue | Severity |
|------|-------|----------|
| PreferencesService | `updateUserPreferences` silently catches errors, returns true | Medium |
| Video playback | Not implemented in DMs (expo-av rebuild pending) | Low |
| Friend removal | Button exists but shows "Coming Soon" | Low |
| Group chats | Table supports `type='group'` but UI only shows direct | Low |
| Message editing | DB has `updated_at` but no UI to edit | Low |
| DM reactions | Not implemented (board has reactions, DMs don't) | Low |
| Photo gallery | Single avatar only (no multi-photo profile) | Low |
| Audio profile recording | Referenced in memory but no implementation found | Low |
| Profile verification | Not implemented | Low |
| MapFilterBar | Component exists but not wired into DiscoverMap | Low |
| Privacy controls | Partially implemented (some mock data) | Medium |
| Quiet hours | UI visible but full enforcement unclear | Low |

> Updated: 2026-03-29 | Trigger: Full analysis | Evidence: Traced all TODO/Coming Soon references | Confidence: H

---

*Document maintained by PMM Codebase Analyst | Source of truth: codebase, not documentation*
