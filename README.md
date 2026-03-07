# Mingla

Mingla is a mobile app for planning social outings. It combines AI-powered place recommendations, real-time collaboration, and a card-based swipe interface to help users discover and plan experiences with friends.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Mobile | React Native (Expo), TypeScript |
| Server State | React Query |
| Client State | Zustand |
| Backend | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| Edge Functions | 47 Deno serverless functions |
| AI | OpenAI GPT-4o-mini, Whisper (audio transcription) |
| Maps & Places | Google Places API (New) |
| Live Events | Ticketmaster Discovery API v2 |
| Payments | Stripe Connect |
| Push Notifications | Expo Push Notifications |
| Navigation | Custom state-driven (no React Navigation) |
| Styling | StyleSheet only (no inline styles) |

---

## Project Structure

```
Mingla/
├── app-mobile/
│   ├── app/
│   │   └── index.tsx                    # Entry point (AppContent)
│   ├── src/
│   │   ├── components/                  # ~90+ UI components
│   │   │   ├── onboarding/             # OnboardingShell, PhoneInput, OTPInput, etc.
│   │   │   ├── connections/            # AddFriendView, RequestsView, PillFilters
│   │   │   ├── board/                  # Board-related components
│   │   │   └── ui/                     # Shared UI primitives
│   │   ├── hooks/                      # ~33 React Query hooks
│   │   ├── services/                   # ~59 service files
│   │   ├── contexts/                   # 3 React contexts
│   │   ├── store/                      # Zustand store
│   │   ├── types/                      # TypeScript types (incl. onboarding.ts, holidayTypes.ts)
│   │   ├── constants/                  # Design tokens, config, categories, holidays
│   │   └── utils/                      # 12 utility files
│   ├── app.json
│   ├── eas.json
│   └── package.json
│
├── supabase/
│   ├── functions/                      # 47 Deno edge functions
│   │   ├── _shared/                   # Shared edge function utilities
│   │   ├── get-holiday-cards/         # Holiday card sourcing (pool + Google fallback)
│   │   ├── generate-ai-summary/       # AI birthday/gift summary via GPT-4o-mini
│   │   └── [function-name]/           # Individual edge functions
│   ├── migrations/                    # 120+ SQL migration files
│   └── config.toml
│
└── oauth-redirect/                    # Static OAuth callback page
```

---

## Features

### Onboarding Flow

The onboarding flow uses a 5-step state machine with sub-steps within each step.

**Step 1 -- Account & Identity** has 5 sub-steps:
1. **Welcome** -- app introduction screen
2. **Phone** -- phone number entry with country picker
3. **OTP** -- 6-digit verification code
4. **Gender Identity** -- 8 inclusive gender options
5. **Personal Details** -- country, date of birth, and preferred language

**Step 2 -- Intents** -- value proposition and intent selection

**Step 3 -- Location** -- GPS permission request

**Step 4 -- Preferences** -- manual location (if GPS denied), category selection, price tiers, transport mode, travel time

**Step 5 -- Social** -- add friends by phone, create collaboration sessions, then choose a path:
- **Path A (Sync):** Select friends to sync with, record audio descriptions, friend link requests sent automatically. Audio is transcribed via Whisper, analyzed by GPT-4o-mini, and used to generate personalized experience cards. Saved people entries are created for every synced friend regardless of audio.
- **Path B (Add person):** Name, birthday, gender, then audio recording. Creates a saved person with AI-generated experience recommendations.
- **Skip:** Goes straight to the app.

### For You System

The person-centric "For You" view provides personalized recommendations for each saved person:

- **Birthday Hero Card** -- Orange hero card with birthday countdown and AI-generated gift/experience summary (~80 char). Falls back to a dark "Picks" card when no birthday is set.
- **Person Recommendation Cards** -- Horizontal scroll of 2-3 personalized place cards powered by the linked user's swipe data via `get-personalized-cards`.
- **Holiday Rows** -- Expandable rows for upcoming holidays, sorted by days away, with real card loading from `get-holiday-cards` (pool-first + Google Places fallback). Gender-filtered standard holidays plus user-created custom holidays.
- **Swipe-to-Archive** -- PanResponder-based swipe gesture on holiday rows with archive/unarchive persistence in the database.
- **Custom Holiday Modal** -- Create personal special days with name, date picker (month + day scrollable pills), description, and category selection.
- **Elite People Summary** -- Horizontal cards showing upcoming birthdays across all saved people. Non-Elite users see a BlurView teaser with upgrade CTA.

### Connect Page

The Connect page (formerly "Chats") manages friend relationships:

- **Add Friends** -- Username search with debounced queries via `search-users` edge function. Send friend link requests with haptic feedback.
- **Requests** -- View and respond to pending friend link requests with accept/decline actions.
- **Blocked** -- Manage blocked users.
- **Invite** -- Share invite link via system share sheet.
- **Pill Filters** -- Horizontal scrollable pill navigation with badge counts for pending requests.

### Friend Links System

- Friend link requests sent via `send-friend-link` edge function with push notifications
- Mirror writes to legacy `friend_requests` table preserve referral credit triggers
- Duplicate-prevention on `saved_people` entries during link acceptance (`.maybeSingle()` check)
- Saved people entries created for every synced friend during onboarding (not gated on audio recording)
- Cross-invalidation of React Query caches on link accept (friend links + saved people + personalized cards)

### AI-Powered Recommendations
- Experience cards built from real Google Places data, enriched by GPT-4o-mini
- Audio-to-recommendations pipeline: voice notes transcribed (Whisper), analyzed (GPT-4o-mini), used to generate personalized experience cards
- Card pool data pipeline: pool-first serving, falls back to Google Places API
- 5-factor scoring algorithm ranks cards by category match, tag overlap, popularity, quality, and text relevance
- AI summary generation for birthday hero cards via `generate-ai-summary` edge function

### Card-Based Swipe Interface
- Swipe right to save, left to skip, up to expand full details
- Curated multi-stop itinerary experiences interleaved with single-place cards
- Expanded card modal with image gallery, weather forecast, busyness predictions, and match score breakdown
- Dismissed cards review sheet for reconsidering skipped cards

### 12-Category System

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

### 4-Tier Price System

| Tier | Label | Range | Google Levels | Color |
|------|-------|-------|--------------|-------|
| `chill` | Chill | $50 max | FREE + INEXPENSIVE | `#10B981` |
| `comfy` | Comfy | $50-$150 | MODERATE | `#3B82F6` |
| `bougie` | Bougie | $150-$300 | EXPENSIVE | `#8B5CF6` |
| `lavish` | Lavish | $300+ | VERY_EXPENSIVE | `#F59E0B` |

### Collaboration Sessions
- Named sessions with multi-friend selection
- Real-time card swiping, voting, RSVP, lock-in, calendar sync, and chat
- Preference rotation system cycles through participants' preferences
- Consensus lock-in with auto calendar entries
- Realtime sync via Supabase Realtime

### Subscription System
- Free, Pro, and Elite tiers with 1-week trial
- Referral bonus months for inviting friends
- Stripe Connect payment processing

### Additional Features
- GPS and manual location with travel time preferences
- Audio clips for saved people with AI-powered transcription and interest extraction
- Holiday planning with custom holidays, archiving, and real card sourcing
- Post-experience reviews with star ratings and voice recordings
- Device calendar export
- Boards with card voting, RSVP, threaded discussion, and @mentions
- Universal deep links via usemingla.com
- Night Out section powered by Ticketmaster

---

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles: phone, referral_code, gender, birthday, country, preferred_language |
| `preferences` | User preference settings (categories, price tiers, intents, travel) |
| `subscriptions` | Subscription tier, trial, referral bonus months |

### Social Tables

| Table | Purpose |
|-------|---------|
| `friend_requests` | Legacy friend request lifecycle (used for referral credit triggers) |
| `friends` | Bidirectional friendship records |
| `friend_links` | Friend link requests (pending/accepted) for synced friends |
| `blocked_users` | User blocks |
| `pending_invites` | Phone invites for non-app users |
| `pending_session_invites` | Collaboration session invites for non-app users |
| `referral_credits` | Referral credit audit log |

### People & Experiences Tables

| Table | Purpose |
|-------|---------|
| `saved_people` | Saved people with name, birthday, gender, AI-generated description |
| `person_audio_clips` | Audio recordings describing saved people |
| `person_experiences` | AI-generated experience cards per person per occasion |
| `custom_holidays` | User-created holidays for specific saved people (name, month, day, categories) |
| `archived_holidays` | Tracks which holidays a user has archived for a specific person |

### Collaboration Tables

| Table | Purpose |
|-------|---------|
| `collaboration_sessions` | Collaboration session records |
| `collaboration_invites` | Session invite records |
| `session_participants` | Session participant records |
| `boards` | Collaboration boards |
| `board_session_preferences` | Per-session preference settings |

### Pipeline Tables

| Table | Purpose |
|-------|---------|
| `card_pool` | Enriched place cards shared across users |
| `place_pool` | Place data pool from Google Places |
| `user_card_impressions` | Tracks which cards users have seen |
| `ticketmaster_events_cache` | Cached Ticketmaster events (2-hour TTL) |
| `google_places_cache` | Cached Google Places API responses |
| `discover_daily_cache` | Cached discover feed results |
| `curated_places_cache` | Cached curated experience places |

---

## Edge Functions

### Experience Generation

| Function | Purpose |
|----------|---------|
| `generate-experiences` | AI-powered place recommendations |
| `new-generate-experience-` | Next-gen experience generation with card pool pipeline |
| `generate-curated-experiences` | Multi-stop itinerary generation |
| `generate-person-experiences` | Person-specific experience recommendations |
| `process-person-audio` | Audio transcription (Whisper) + GPT analysis + experience generation |
| `get-personalized-cards` | Personalized card retrieval based on swipe data |
| `get-holiday-cards` | Holiday card sourcing: pool-first + Google Places fallback |
| `generate-ai-summary` | AI birthday/gift summary via GPT-4o-mini (~80 char) |
| `discover-experiences` | Explore/discover tab |
| `discover-cards` | Discover card generation |
| `discover-[category]` | Per-category discover endpoints |
| `holiday-experiences` | Holiday-specific experience generation |
| `refresh-place-pool` | Daily card pool refresh |
| `warm-cache` | Cache warming for frequently accessed data |

### Social and Notifications

| Function | Purpose |
|----------|---------|
| `lookup-phone` | Phone number lookup for friend search |
| `search-users` | Username-based user search |
| `send-friend-link` | Send friend link invitations (with referral mirror write) |
| `respond-friend-link` | Process friend link responses (with duplicate prevention) |
| `unlink-friend` | Remove friend connections |
| `send-friend-request-email` | Email notifications for friend requests |
| `send-collaboration-invite` | Push notifications for session invites |
| `notify-invite-response` | Push notifications for invite responses |
| `send-message-email` | Email notifications for messages |
| `process-referral` | Manual referral credit reconciliation |

### Authentication

| Function | Purpose |
|----------|---------|
| `send-otp` | Send phone verification OTP |
| `verify-otp` | Verify phone OTP code |

### Events and Places

| Function | Purpose |
|----------|---------|
| `ticketmaster-events` | Ticketmaster event proxy |
| `events` | General event handling |
| `places` | Place details proxy |
| `get-google-maps-key` | Secure Google Maps key retrieval |
| `get-companion-stops` | Companion stop suggestions for itineraries |
| `get-picnic-grocery` | Picnic and grocery place suggestions |
| `night-out-experiences` | Night out experience generation |

### Utilities

| Function | Purpose |
|----------|---------|
| `ai-reason` | AI reasoning endpoint |
| `weather` | Weather forecast data |
| `process-voice-review` | Voice review transcription |
| `delete-user` | Account deletion |
| `backfill-place-websites` | Backfill missing place websites in card pool |

---

## Environment Variables

### Mobile App (`app-mobile/.env`)

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Supabase Secrets (Edge Functions)

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_PLACES_API_KEY
OPENAI_API_KEY
TICKETMASTER_API_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

---

## Setup and Running

### Prerequisites

- Node.js 18+
- Expo CLI (`npx expo`)
- Supabase CLI (`npx supabase`)
- Physical Android or iPhone device for testing (no emulators)

### Getting Started

```bash
# 1. Clone the repo
git clone <repo-url>
cd Mingla

# 2. Install mobile dependencies
cd app-mobile
npm install

# 3. Copy environment file and fill in keys
cp .env.example .env

# 4. Run Supabase migrations (includes custom_holidays + archived_holidays tables)
supabase db push

# 5. Deploy edge functions (includes get-holiday-cards, generate-ai-summary)
supabase functions deploy

# 6. Start Expo
npx expo start

# 7. Test on physical device (Android/iPhone)
```

### EAS Build

```bash
# Development client
npx eas build --platform android --profile development
npx eas build --platform ios --profile development

# Preview
npx eas build --platform android --profile preview

# Production
npx eas build --platform android --profile production
npx eas build --platform ios --profile production
```

---

## Recent Changes

- **For You System** -- Birthday hero cards with AI summary, person recommendation cards, expandable holiday rows with real card sourcing (pool-first + Google Places fallback), custom holiday creation modal, archive/unarchive with database persistence, and Elite people summary with BlurView teaser.
- **Connect Page Redesign** -- Rewrote AddFriendView to use `sendFriendLink` edge function instead of legacy direct DB inserts. Added haptics, updated copy.
- **Friend Link Pipeline Fixes** -- Mirror writes to `friend_requests` for referral credits, duplicate prevention on `saved_people` during link acceptance, cross-invalidation of personalized card caches.
- **Onboarding Bug Fix** -- `saved_people` entries now created for every synced friend regardless of audio recording (was previously gated on audio existence).
- **Re-enabled Disabled Code** -- Restored `usePersonExperiences` hook and `saveDiscoverCache()` call in DiscoverScreen.

---

## License

This project is proprietary. All rights reserved.
