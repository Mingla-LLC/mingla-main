# Mingla

Mingla is a mobile app for discovering personalized date and experience recommendations powered by AI, real-time location data, and social collaboration.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Mobile Framework | React Native (Expo SDK 54), TypeScript |
| Server State | TanStack React Query v5 |
| Client State | Zustand (persisted to AsyncStorage) |
| Backend | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| Edge Functions | Deno/TypeScript (29 serverless functions) |
| AI | OpenAI GPT-4o-mini |
| Maps & Places | Google Places API (New) |
| Live Events | Ticketmaster Discovery API v2 |
| Weather | OpenWeather API |
| Phone Verification | Twilio Verify API |
| Payments | Stripe Connect |
| Push Notifications | Expo Push Notifications |
| Analytics | Mixpanel |

---

## Project Structure

```
Mingla/
├── app-mobile/                              # React Native (Expo) mobile app
│   ├── app/
│   │   └── index.tsx                        # Root component — navigation, auth, providers
│   ├── assets/                              # Icons, images, splash screen, logo
│   ├── src/
│   │   ├── components/                      # 147+ UI components
│   │   │   ├── board/                       # Board view, settings, discussion, cards, invites
│   │   │   ├── collaboration/               # Session creation, invites, cards
│   │   │   ├── connections/                 # Chat list, pill filters, friend picker
│   │   │   ├── debug/                       # Debug modal
│   │   │   ├── expandedCard/                # 14 detail sections (gallery, weather, match, timeline)
│   │   │   ├── onboarding/                  # 10 onboarding components (6 new V2 + 4 legacy kept)
│   │   │   ├── PreferencesSheet/            # Preference section panels
│   │   │   ├── profile/                     # Settings, privacy, legal pages
│   │   │   ├── signIn/                      # Welcome screen, OAuth buttons
│   │   │   ├── ui/                          # 45+ shadcn-style primitives + PulseDotLoader, CategoryTile
│   │   │   ├── OnboardingFlow.tsx           # V2 5-step onboarding orchestrator
│   │   │   └── ... (87+ more root-level components)
│   │   ├── config/
│   │   │   └── queryClient.ts              # React Query config + AsyncStorage persister
│   │   ├── constants/
│   │   │   ├── categories.ts               # 12 category definitions + curated pairings
│   │   │   ├── colors.ts                   # Brand color palette
│   │   │   ├── countries.ts                # 240+ countries with dial codes and flag emojis
│   │   │   ├── designSystem.ts             # Design tokens (spacing, radius, typography)
│   │   │   ├── holidays.ts                 # Holiday definitions + gender mappings
│   │   │   └── priceTiers.ts              # 4-tier price system (Chill/Comfy/Bougie/Lavish)
│   │   ├── contexts/
│   │   │   ├── CardsCacheContext.tsx        # Card caching (30min TTL, 10 entries)
│   │   │   ├── NavigationContext.tsx        # Modal state + navigation helpers
│   │   │   └── RecommendationsContext.tsx   # Dual-mode card pipeline (solo/collab)
│   │   ├── hooks/                           # 36 custom React hooks
│   │   │   ├── useDeckCards.ts             # Unified solo deck (pool-first)
│   │   │   ├── useFriendLinks.ts           # Friend link request lifecycle
│   │   │   ├── useOnboardingStateMachine.ts # V2 onboarding {step, subStep} state machine
│   │   │   ├── usePersonAudio.ts           # Audio clip CRUD for standard persons
│   │   │   ├── usePersonalizedCards.ts     # Smart For You personalized cards
│   │   │   ├── useSavedPeople.ts           # Saved people CRUD (standard + linked)
│   │   │   └── ... (30 more)
│   │   ├── services/                        # 61 service modules
│   │   │   ├── friendLinkService.ts        # Friend link API (send/respond/unlink)
│   │   │   ├── otpService.ts               # Twilio Verify OTP send/verify via edge functions
│   │   │   ├── personAudioService.ts       # Audio clip upload/delete via Storage
│   │   │   ├── personalizedCardsService.ts # Smart For You edge function client
│   │   │   ├── deckService.ts              # Unified deck pipeline (solo + collaboration)
│   │   │   ├── supabase.ts                 # Supabase client singleton
│   │   │   └── ... (55+ more)
│   │   ├── store/
│   │   │   └── appStore.ts                 # Zustand store (persisted to AsyncStorage)
│   │   ├── styles/                          # Shared StyleSheet styles
│   │   ├── types/
│   │   │   ├── index.ts                    # Core domain types (User, Preferences, Board)
│   │   │   ├── onboarding.ts              # V2 onboarding types, state machine, constants
│   │   │   ├── recommendation.ts           # Canonical Recommendation card type
│   │   │   ├── expandedCardTypes.ts        # Expanded modal data types
│   │   │   ├── curatedExperience.ts        # Multi-stop itinerary types
│   │   │   ├── friendLink.ts              # Friend link request/response types
│   │   │   ├── personAudio.ts             # Audio clip types
│   │   │   └── holidayTypes.ts            # Holiday type definitions
│   │   └── utils/                           # 19 utility modules
│   │       ├── categoryUtils.ts            # Category slug/icon/color lookups
│   │       ├── cardConverters.ts           # Card type conversions + dedup
│   │       ├── localeDetection.ts         # Auto currency/measurement from coordinates
│   │       ├── sessionRotation.ts         # Collaboration preference rotation logic
│   │       ├── sessionPrefsUtils.ts       # Session preference aggregation utilities
│   │       ├── responsive.ts              # Proportional scaling (iPhone 14 base)
│   │       └── ... (13 more)
│   ├── app.json                             # Expo config (bundle ID, permissions, plugins)
│   ├── eas.json                             # EAS Build profiles
│   └── package.json                         # Dependencies
│
├── supabase/                                # Supabase backend
│   ├── functions/                           # 29 Edge Functions + shared utilities
│   │   ├── _shared/                        # Shared modules
│   │   │   ├── cardPoolService.ts          # Pool-first serving engine
│   │   │   ├── categoryPlaceTypes.ts       # Category-to-place-type mappings
│   │   │   ├── placesCache.ts              # Google Places API caching (per-type + bundled category search)
│   │   │   ├── priceTiers.ts              # Canonical 4-tier price system (shared source of truth)
│   │   │   └── textSearchHelper.ts         # Text search fallback
│   │   ├── send-otp/                       # Twilio Verify: send OTP to phone number
│   │   ├── verify-otp/                     # Twilio Verify: verify OTP + save phone to profile
│   │   ├── search-users/                   # User search for friend linking
│   │   ├── send-friend-link/               # Send friend link request + push notification
│   │   ├── respond-friend-link/            # Accept/decline link + create saved_people
│   │   ├── unlink-friend/                  # Remove link from both sides
│   │   ├── get-personalized-cards/         # Smart For You activity-based card scoring
│   │   ├── new-generate-experience-/       # Core pool-first card generation
│   │   ├── discover-cards/                 # Unified card discovery with pagination
│   │   ├── generate-curated-experiences/   # Multi-stop itinerary builder
│   │   ├── ticketmaster-events/            # Real Ticketmaster live events
│   │   ├── process-voice-review/           # GPT audio transcription + sentiment
│   │   ├── refresh-place-pool/             # Daily place data refresh
│   │   ├── warm-cache/                    # Pre-populate Places cache on app open
│   │   └── ... (14 more)
│   ├── migrations/                          # 120 SQL migration files
│   └── config.toml                          # Supabase project config
│
├── oauth-redirect/                          # Static OAuth callback page
├── app.json                                 # Root Expo config
├── eas.json                                 # Root EAS Build config
└── bun.lockb                                # Bun lockfile
```

---

## Features

### Authentication and Onboarding

- OAuth sign-in via Google and Apple Sign-In
- 5-step guided onboarding with phone verification via Twilio Verify OTP:
  - **Step 1 -- Welcome & Phone:** Country picker (240+ countries), phone input with E.164 formatting, 6-digit OTP verification with auto-submit
  - **Step 2 -- Intents:** Value proposition beats with animated transitions, single-select intent cards with radio behavior (Adventurous, First Dates, Romantic, Friendly, Group Fun, Picnic Dates, Take a Stroll). Exactly 1 intent required. Hint text: "Pick the one that excites you most"
  - **Step 3 -- Location:** GPS permission request with fallback to manual city input. Back-navigation shows persisted "Locked in" state instead of re-prompting for GPS
  - **Step 4 -- Preferences:** Category grid (12 categories, pick 1-3), 4-tile price tier selector (Chill/Comfy/Bougie/Lavish) with currency-converted range labels, transport mode (walking/biking/transit/driving), travel time (15-60 min). Hint text: "Pick up to 3 that match your vibe". Background card generation fires at Step 4 to Step 5 transition
  - **Step 5 -- Add Someone:** Three paths -- Invite (birthday, gender, audio, contact), Add (name, birthday, gender, audio), or Skip. Cards finish generating during this step
  - **Launch:** Grand reveal with rotating loading text, card deck animation
- Intents stored separately from categories in `preferences.intents` column
- Resume-aware: major step persists to DB, sub-steps are ephemeral. One-shot resume guard prevents auth re-initialization cycles from overwriting in-progress selections
- Account types: Explorer (consumer) or Curator (content creator)

### Home / Explore Tab -- Swipeable Card Deck

- AI-generated experience cards built from real Google Places data, enriched by GPT-4o-mini with descriptions, highlights, and match scores
- Swipe right to save, left to skip, up to expand full details
- Unified deck pipeline (`deckService.fetchDeck()`) serves both solo and collaboration modes. Pool-first card serving from card_pool with SQL-level pagination and impression exclusion; falls back to Google Places only when the pool is exhausted (bundled category search: 1 API call per category instead of 1 per type). Synchronous impression recording prevents cross-batch duplicates. Batch timeout of 5 seconds. Prefetch threshold at 8 cards remaining
- Curated multi-stop itinerary cards interleaved at a 1:1 ratio with regular cards. Adventure intent uses 4 dedicated groups (Outdoor, Exotic Eats, Adrenaline, Culture) for 3-stop itineraries. First Date intent uses 3 dedicated groups (Fun Activity, Cultural, Fine Dining) for 2-stop itineraries with strict alternation between ice-breaker activities and cultural outings paired with upscale dining. Romantic intent uses 2 dedicated groups (Romance Start: galleries, museums, landmarks, theaters; Romance Finish: upscale restaurants, wine bars) for intimate 2-stop date itineraries with romantic-toned AI descriptions. Friendly intent uses 4 starting groups (Adrenaline, Entertainment, Outdoor, Cultural) then 1 Finish group (Casual Dining, 19 restaurant types) for 2-stop hangout itineraries with strict 4-way rotation for maximum diversity and cascading fallback when a group is exhausted. Group Fun intent uses 2 starting groups (Activity: bowling, arcades, go-karts, karaoke; Entertainment: movies, concerts, comedy clubs) then 1 Finish group (Casual Dining, 19 restaurant types) for 2-stop group activity itineraries with strict 2-way alternation and dedicated exclude list (water parks, libraries, coworking spaces, business centers). Picnic Dates intent uses dedicated type groups (Grocery: grocery_store, supermarket; Picnic Spot: park, picnic_ground, beach) for 2-stop picnic itineraries with parks searched near the grocery (3km radius), an AI-generated shopping checklist (8-12 emoji-prefixed items) rendered as a tickable checklist under the grocery stop, and a 4-type exclude list (department_store, electronics_store, furniture_store, warehouse_store). Take A Stroll intent uses 3 dedicated groups (Start Point: 11 cafe/coffee types; Stroll Place: 12 nature types as anchor; Finish: 11 restaurant types) for 3-stop itineraries with anchor-based search (nature found near user first, cafe found within 2km of nature, restaurant found within 3km of nature), stroll-toned AI descriptions, stop 3 labeled "Optional", and a 26-type exclude list filtering active/loud/retail/transit venues
- Expanded card modal with image gallery, weather forecast, busyness predictions, match score breakdown, companion stops, and timeline
- Deck batch navigation with forward/backward history persisted across sessions
- Dismissed cards review sheet for reconsidering left-swiped cards (persisted across app restarts via AsyncStorage)
- Solo and collaboration mode toggle

### Discover Tab

- Personalized daily feed with hero cards driven by user's top preferred categories
- Category browsing across all 12 categories with icon pills
- Holiday experiences with gender-specific filtering (Mother's Day, Father's Day, Non-Binary People's Day)
- Night Out section powered by Ticketmaster Discovery API with genre, date, and price filtering plus in-app ticket purchasing
- For You section with saved people (standard and linked) and personalized holiday/occasion card rows
- City-specific, location-aware content

### Linked Persons and Smart For You

- Two paths for adding people: Standard Person (manual name, birthday, gender, audio descriptions) or Linked Friend (real Mingla user)
- Standard persons display birthday hero cards with countdown and holiday-based card rows mapped by category (Romantic, Fine Dining, Play, Wellness)
- Gender-filtered holidays: Man sees Father's Day and International Men's Day; Woman sees Mother's Day and International Women's Day; all other genders see International Non-Binary People's Day
- Audio descriptions: record or upload up to 5 voice clips (60 seconds each) per standard person for AI-informed card generation
- Friend linking: search Mingla users by username or phone, send a link request with push notification, target user accepts or declines via in-app consent banner
- Bi-directional linking: on acceptance, both users automatically see each other as linked person pills in their For You tabs with auto-pulled profile data (name, birthday, gender, avatar)
- Smart For You personalization: once a linked friend has 10+ card swipes, their actual in-app activity (swipes, saves, schedules, reviews) drives card scoring with weighted signals -- Scheduled (+5), Positive Review (+4), Saved (+3), Swiped Right (+2), Swiped Left (-1), Negative Review (-3) -- fully overriding default holiday category mappings
- Linked friend birthday cards use curated multi-stop itineraries (post-threshold) instead of single-place cards
- Either user can unlink at any time, immediately removing person pills from both sides and stopping data sharing
- Standard persons are fully editable; linked persons show a view-only profile with unlink option

### Connect Tab -- Chat

- WhatsApp-style unified chat list sorted by most recent message with avatar, preview, timestamp, and unread badges
- Pill filters (Add, Requests, Blocked, Invite) for inline friend management
- Friend picker sheet for starting new conversations
- Real-time direct messaging with text, images, video, and file attachments
- Block, mute, and report functionality

### Likes Tab

- Saved/liked cards with category, type, and date filtering
- Boards: collaborative boards/sessions with participant avatars, card voting, RSVP, threaded discussion, and @mentions
- Calendar view of scheduled experiences with date grid and time slots
- Device calendar export via Expo Calendar
- Post-experience review modal with star rating and voice recording (up to 5 clips)
- QR code display for in-store/mobile payments

### Collaboration Sessions

- Named sessions with multi-friend selection, real-time card swiping, voting, RSVP, and chat
- Sessions use the unified deck pipeline (`deckService.fetchDeck()`) for card generation, the same pipeline that powers solo mode
- Preference rotation system: the session creator's preferences load first, then a "Next person's picks" button rotates through participants by join order, skipping participants who have not set preferences
- Non-rotating preferences (price tiers, travel mode, budget) are aggregated across all participants: union of price tiers, widest budget range, median travel constraint, majority vote on travel mode
- Realtime sync via Supabase Realtime: preference changes from any participant trigger a deck refresh for all participants within 10 seconds. State, votes, messages, presence, and typing indicators all sync in real time
- Push notifications for session invites, accepts, and declines

### Profile and Settings

- Uploadable avatar, display name, username, gamified stats (achievements, streaks, milestones)
- Auto locale detection: currency and measurement system automatically set from GPS/manual location during onboarding and preference changes (reverse geocode, country, currency + Imperial/Metric)
- Privacy controls for profile visibility, location sharing, budget sharing
- Account deletion with full cascade across all tables

### Category System (v3)

12 experience categories, each with verified Google Places API type mappings, intent compatibility, and UX theming:

| Slug | Display Name | Color | Icon |
|------|-------------|-------|------|
| `nature` | Nature | `#10B981` | `leaf-outline` |
| `first_meet` | First Meet | `#6366F1` | `chatbubbles-outline` |
| `picnic` | Picnic | `#84CC16` | `basket-outline` |
| `drink` | Drink | `#F59E0B` | `wine-outline` |
| `casual_eats` | Casual Eats | `#F97316` | `fast-food-outline` |
| `fine_dining` | Fine Dining | `#7C3AED` | `restaurant-outline` |
| `watch` | Watch | `#3B82F6` | `film-outline` |
| `creative_arts` | Creative & Arts | `#EC4899` | `color-palette-outline` |
| `play` | Play | `#EF4444` | `game-controller-outline` |
| `wellness` | Wellness | `#14B8A6` | `body-outline` |
| `groceries_flowers` | Groceries & Flowers | `#22C55E` | `cart-outline` |
| `work_business` | Work & Business | `#64748B` | `briefcase-outline` |

### Price Tier System

4-tier pricing model mapped directly to Google Places API price levels:

| Tier | Label | Range | Google Levels | Color | Icon |
|------|-------|-------|--------------|-------|------|
| `chill` | Chill | $50 max | FREE + INEXPENSIVE | `#10B981` | `leaf-outline` |
| `comfy` | Comfy | $50-$150 | MODERATE | `#3B82F6` | `cafe-outline` |
| `bougie` | Bougie | $150-$300 | EXPENSIVE | `#8B5CF6` | `sparkles-outline` |
| `lavish` | Lavish | $300+ | VERY_EXPENSIVE | `#F59E0B` | `diamond-outline` |

Single source of truth in `_shared/priceTiers.ts` (edge) and `constants/priceTiers.ts` (mobile). All card display, filtering, onboarding, preferences, and pool storage use these canonical tiers. Currency conversion applies to range labels.

### Preferences System

- Intents: single-select with radio button behavior (max 1 at a time). 7 options: Adventurous, First Dates, Romantic, Friendly, Group Fun, Picnic Dates, Take a Stroll
- Categories: 12 category pills with intent-based filtering, capped at 3 selections
- Minimum 1 total selection (intent or category) required in PreferencesSheet and CollaborationPreferences
- Price tiers: multi-select from 4 tiers (Chill, Comfy, Bougie, Lavish) displayed with currency-converted range labels. Stored as `price_tiers` text array in preferences
- Travel mode: walking, driving, transit, cycling
- Travel constraint: time-based or distance-based
- Date/time: Now, Tonight, This Weekend, or exact date/time picker
- GPS toggle for GPS-derived vs. manually-entered location
- Preference changes reset the card impression boundary so previously seen cards become eligible again

---

## Database Schema Overview

### Core Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles: name, username, avatar, birthday, gender, phone, push_token, currency, measurement system, visibility, onboarding status |
| `preferences` | Per-user settings: price_tiers (4-tier system), budget_min/budget_max (legacy), categories, intents, date/time, travel mode, travel constraint, use_gps_location, updated_at |
| `experiences` | Seed/legacy experience catalog |
| `saves` | User-experience save relationships |
| `saved_cards` | Denormalized saved card data |
| `user_interactions` | Behavioral tracking (view, like, dislike, save, swipe, share, schedule) |
| `user_preference_learning` | AI-computed affinity scores per category/time/location |
| `user_engagement_stats` | Per-user lifetime engagement totals (cards seen, saved, scheduled, reviews) |

### Pipeline Tables

| Table | Purpose |
|-------|---------|
| `place_pool` | Shared enriched Google Places data with analytics columns (impressions, saves, schedules, reviews), price_tier column |
| `card_pool` | Pre-built cards (single or curated type) linked to place_pool, price_tier column for tier-based filtering |
| `user_card_impressions` | Per-user card "seen" tracking, session-scoped to preference changes |
| `google_places_cache` | Google Places API response cache (24h default TTL, 72h for popular entries with hit_count > 3) with next_page_token for pagination and automatic page draining. Category-level bundled searches use `cat:` prefix keys |
| `ticketmaster_events_cache` | Ticketmaster API response cache (2h TTL) |
| `discover_daily_cache` | Per-city daily discover feed cache (24h TTL) |

### People and Linked Persons Tables

| Table | Purpose |
|-------|---------|
| `saved_people` | Per-user saved people with name, birthday, gender, initials. Extended with `linked_user_id`, `link_id`, and `is_linked` columns for linked friends |
| `person_experiences` | AI-generated experiences per person per occasion (birthday, holidays) |
| `friend_links` | Friend link requests with status lifecycle (pending, accepted, declined, cancelled, unlinked). Unique index prevents duplicate active links between the same pair |
| `person_audio_clips` | Audio description clips for standard persons: storage path, duration, sort order. Max 5 per person, 60 seconds each |

### Social and Messaging Tables

| Table | Purpose |
|-------|---------|
| `friends` | Friendship relationships with status (pending, accepted, blocked) |
| `blocked_users` | Block relationships with reason |
| `muted_users` | Mute relationships |
| `conversations` | DM conversation metadata |
| `messages` | Direct messages between users |

### Collaboration Tables

| Table | Purpose |
|-------|---------|
| `collaboration_sessions` | Named sessions with status lifecycle, `active_preference_owner_id` (tracks whose preferences are currently active), `rotation_order` (JSON array of participant IDs in join order for preference rotation) |
| `session_participants` | Session membership with admin flags |
| `collaboration_invites` | Invite lifecycle tracking |
| `board_session_preferences` | Per-session preference overrides (categories, intents, `price_tiers`, `date_option`) |
| `board_saved_cards` | Cards added to boards |
| `board_votes` | User votes on board cards |
| `board_card_rsvps` | RSVP responses for scheduled board cards |
| `board_messages` | Board-level chat messages |
| `board_card_messages` | Card-level discussion threads |

### Calendar and Reviews Tables

| Table | Purpose |
|-------|---------|
| `calendar_entries` | Scheduled experiences with feedback_status and review_id |
| `place_reviews` | Voice reviews with star rating, audio paths, AI transcription, sentiment, themes |

---

## Edge Functions Overview

### Experience Generation and Discovery (Pool-First)

| Function | Purpose |
|----------|---------|
| `new-generate-experience-` | Core pool-first card generation engine. Serves pre-built cards from card_pool, gap-fills from Google Places |
| `discover-cards` | Unified card discovery with SQL-level pagination (`query_pool_cards` function), impression exclusion, and nextPageToken pool expansion |
| `generate-curated-experiences` | Multi-stop itinerary builder with AI descriptions and travel time estimates. Adventure intent: 3-stop cards from 4 dedicated groups with round-robin combos. First Date intent: 2-stop cards (ice-breaker activity or cultural outing, then upscale dinner) with strict alternation. Romantic intent: 2-stop cards (cultural/artistic venue, then upscale restaurant) with romantic-toned AI descriptions. Friendly intent: 2-stop cards (activity, then casual dining) with 4-way starting group rotation. Group Fun intent: 2-stop cards (activity/entertainment, then casual dining) with 2-way alternation. Picnic Dates intent: 2-stop cards (grocery, then park/picnic spot near grocery) with AI-generated shopping checklist. Take A Stroll intent: 3-stop cards (cafe, then nature anchor, then restaurant "Optional") with anchor-based search and stroll-toned AI descriptions |
| `discover-experiences` | General discovery for all 12 categories with 24h daily cache |
| `discover-casual-eats` | Category-specific discovery: Casual Eats |
| `discover-creative-arts` | Category-specific discovery: Creative & Arts |
| `discover-drink` | Category-specific discovery: Drink |
| `discover-fine-dining` | Category-specific discovery: Fine Dining |
| `discover-first-meet` | Category-specific discovery: First Meet |
| `discover-nature` | Category-specific discovery: Nature |
| `discover-picnic-park` | Category-specific discovery: Picnic |
| `discover-play` | Category-specific discovery: Play |
| `discover-watch` | Category-specific discovery: Watch |
| `discover-wellness` | Category-specific discovery: Wellness |
| `generate-person-experiences` | Parses person description via OpenAI, finds matching Google Places per occasion |
| `holiday-experiences` | Holiday-themed cards with category overrides and gender filtering |

### Phone Verification (Onboarding V2)

| Function | Purpose |
|----------|---------|
| `send-otp` | Twilio Verify API proxy: sends OTP to phone number. Validates JWT and E.164 format, handles rate limiting |
| `verify-otp` | Twilio Verify API proxy: verifies OTP code. On success, saves phone to profiles.phone server-side using service role |

### Linked Persons and Smart For You

| Function | Purpose |
|----------|---------|
| `search-users` | Search Mingla users by username or phone number for friend linking. Returns id, username, display_name, avatar_url. Excludes self and incomplete profiles |
| `send-friend-link` | Create a friend link request and send Expo push notification to the target user |
| `respond-friend-link` | Accept or decline a pending link request. On accept: create saved_people entries for both users with auto-pulled profile data, notify requester via push |
| `unlink-friend` | Remove link from both sides: update friend_links status to 'unlinked', delete both saved_people entries |
| `get-personalized-cards` | Smart For You engine. Queries a linked friend's swipe, save, schedule, and review history. Computes category affinity scores with weighted signals. Returns personalized card recommendations ranked by activity data |

### Events and Live Data

| Function | Purpose |
|----------|---------|
| `ticketmaster-events` | Real live events from Ticketmaster Discovery API for the Night Out section |
| `night-out-experiences` | Legacy AI-generated nightlife (deprecated, replaced by Ticketmaster) |
| `weather` | OpenWeather API proxy with 5-minute in-memory cache |

### AI Enhancement

| Function | Purpose |
|----------|---------|
| `ai-reason` | Weather-aware recommendation reasoning |
| `process-voice-review` | Background voice review processor: GPT audio transcription, sentiment analysis, theme extraction |

### Maps and Location

| Function | Purpose |
|----------|---------|
| `places` | General Google Places search by category |
| `get-companion-stops` | Nearby companion POIs for multi-stop experiences |
| `get-picnic-grocery` | Nearby groceries for picnic planning |
| `get-google-maps-key` | Securely serve Google Maps API key (JWT required) |
| `refresh-place-pool` | Daily refresh: update stale place_pool entries, propagate data to card_pool, deactivate removed places |
| `warm-cache` | Pre-populate Google Places cache on app open. Bundles all categories into parallel `batchSearchByCategory()` calls so first swipe is instant |
| `backfill-place-websites` | One-time admin function to populate website URLs for existing places |

### Social and Notifications

| Function | Purpose |
|----------|---------|
| `send-collaboration-invite` | Push notification for session invites |
| `send-friend-request-email` | Push notification for friend requests |
| `send-message-email` | Push notification for DMs and @mentions |
| `notify-invite-response` | Push notification for session invite accept/decline |

### User Management

| Function | Purpose |
|----------|---------|
| `delete-user` | Complete user deletion with cascading cleanup across all tables |

---

## Environment Variables

### Mobile App (`app-mobile/.env`)

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_MIXPANEL_TOKEN=your-mixpanel-token    # optional, graceful no-op if missing
```

Additional values configured in `app.json` extras:

- `IOS_CLIENT_ID` -- Google OAuth client ID for iOS

### Supabase Secrets (Edge Functions)

```bash
npx supabase secrets set GOOGLE_MAPS_API_KEY=xxx
npx supabase secrets set OPENAI_API_KEY=xxx
npx supabase secrets set TICKETMASTER_API_KEY=xxx
npx supabase secrets set OPENWEATHER_API_KEY=xxx
npx supabase secrets set RESEND_API_KEY=xxx
npx supabase secrets set TWILIO_ACCOUNT_SID=xxx
npx supabase secrets set TWILIO_AUTH_TOKEN=xxx
npx supabase secrets set TWILIO_VERIFY_SERVICE_SID=xxx
```

---

## Setup and Running Instructions

### Prerequisites

- Node.js 18+
- Bun (for lockfile resolution)
- Expo CLI (`npx expo`)
- Supabase CLI (`npx supabase`)
- Twilio account with Verify service configured (trial account works for development with verified caller IDs)
- Physical Android or iPhone device for testing (no emulators)

### Mobile App

```bash
cd app-mobile

# Install dependencies
bun install

# Start Expo development server
npx expo start

# Start with cache cleared
npx expo start --clear

# Type-check
npx tsc --noEmit
```

### Backend (Supabase)

```bash
# Push all migrations (includes onboarding V2 intents column)
echo "y" | npx supabase db push --linked --include-all

# Deploy OTP edge functions
npx supabase functions deploy send-otp
npx supabase functions deploy verify-otp

# Deploy all edge functions
npx supabase functions deploy

# Serve a function locally
npx supabase functions serve function-name --env-file .env.local
```

### EAS Build (Mobile Distribution)

```bash
# Development client
npx eas build --platform android --profile development
npx eas build --platform ios --profile development

# Preview APK
npx eas build --platform android --profile preview

# Production
npx eas build --platform android --profile production
npx eas build --platform ios --profile production
```

### OAuth Redirect

The `oauth-redirect/` directory contains a static site deployed to Vercel/Netlify that handles Google and Apple OAuth callback token extraction.

---

## Recent Changes

- **Unified Card Delivery Pipeline Phase 1 (2026-03-05):** Merged solo and collaboration card delivery into a single pipeline powered by `deckService.fetchDeck()`. Deleted 4 edge functions (`generate-session-experiences`, `recommendations-enhanced`, `recommendations`, `enhance-cards`) and 3 components (`RecommendationsGrid`, `ActivityPage`, `BoardsTab`). Collaboration sessions now use preference rotation (creator first, "Next person's picks" rotates by join order) with non-rotating prefs aggregated across participants (union of price tiers, widest budget, median travel constraint, majority vote on travel mode). Realtime sync triggers deck refresh within 10 seconds of any participant's preference change.

- **Selection Limits (2026-03-05):** Intents changed from multi-select to radio button behavior (max 1). Categories capped at 3 selections. Minimum 1 total selection (intent or category) enforced in PreferencesSheet and CollaborationPreferences. Onboarding hint text updated accordingly.

- **Curated Card Interleave (2026-03-05):** Changed curated card interleave ratio from 1 per 3 regular cards to 1:1. Batch timeout reduced from 30s to 5s. Prefetch threshold increased from 5 cards remaining to 8.

- **Likes Tab Consolidation (2026-03-05):** Likes Tab now handles boards, saved cards, and calendar (previously split across a separate Activity Tab). `ActivityPage.tsx` deleted.

---

## License

This project is proprietary. All rights reserved.
