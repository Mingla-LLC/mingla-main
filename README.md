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
| Edge Functions | 48 Deno serverless functions |
| AI | OpenAI GPT-4o-mini, Whisper (audio transcription) |
| Maps & Places | Google Places API (New) |
| Live Events | Ticketmaster Discovery API v2 |
| SMS | Twilio (OTP verification + Programmable Messaging for invites) |
| Payments | Stripe Connect |
| Push Notifications | Expo Push Notifications |
| Analytics | Mixpanel (event tracking, user identification, coach mark analytics) |
| Navigation | Custom state-driven (no React Navigation) |
| Styling | StyleSheet only (no inline styles) |
| SVG | react-native-svg (spotlight masks, illustrations) |

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
│   │   │   ├── education/             # Coach mark system (CoachMarkProvider, Overlay, Tooltip, SpotlightMask, Milestone, ReplayTipsScreen, Illustrations)
│   │   │   ├── expandedCard/          # Expanded card sub-components (ActionButtons, etc.)
│   │   │   ├── profile/               # ProfileHeroSection, PhotosGallery, InterestsSection, StatsRow, EditBioSheet, EditInterestsSheet, ViewFriendProfileScreen, ProfilePersonalInfoSection
│   │   │   └── ui/                     # Shared UI primitives
│   │   ├── hooks/                      # ~39 React Query hooks (incl. useCoachMarkTarget, useCoachMarkEngine)
│   │   ├── services/                   # ~62 service files (incl. coachMarkService)
│   │   ├── contexts/                   # 3 React contexts
│   │   ├── store/                      # Zustand stores (appStore, coachMarkStore)
│   │   ├── types/                      # TypeScript types (incl. coachMark.ts)
│   │   ├── constants/                  # Design tokens, config, categories, holidays, coachMarks
│   │   └── utils/                      # 12 utility files
│   ├── app.json
│   ├── eas.json
│   └── package.json
│
├── supabase/
│   ├── functions/                      # 48 Deno edge functions
│   │   ├── _shared/                   # Shared edge function utilities
│   │   ├── send-phone-invite/         # Phone invite SMS via Twilio
│   │   └── [function-name]/           # Individual edge functions
│   ├── migrations/                    # 120+ SQL migration files
│   └── config.toml
│
└── oauth-redirect/                    # Static OAuth callback page
```

---

## Features

### Contextual Education System (Coach Marks v2)

A progressive disclosure engine that teaches users features in context. Key aspects:

- **58 coach marks** across 7 groups (Explore, Discover, Chats, Likes, Profile, Board, Action) plus a tutorial finale
- **First-launch tutorial**: On first app launch after onboarding, a full linear tutorial auto-navigates the user through every tab and screen, showing all 58 marks in sequence. No skip, no exit — only "Next" and "Back to start". Session limits and cooldowns are disabled during the tutorial. Marks without available targets display centered without a spotlight
- **Auto-navigation**: The tutorial provider orchestrates tab/page navigation via `onNavigate` callback, waiting for target registration before showing each mark
- **Context-triggered (normal mode)**: After tutorial completion, marks fire when users naturally encounter features (tab visits, actions, element visibility)
- **Rate-limited (normal mode)**: Max 5 marks per session, 3-second cooldown between marks (cooldown clears on tab navigation)
- **Self-measuring tooltips**: Two-phase render (invisible measure → position) with safe area awareness via `useSafeAreaInsets()` — zero hardcoded coordinates or height guesses
- **Deliberate dismissal only**: Backdrop taps do nothing — users must press "Got it"/"Next" or "Skip all" to proceed. Buttons are locked during the entrance animation to prevent accidental dismissal
- **Scroll-safe queue**: Off-screen targets stay in queue instead of being permanently dropped
- **Step indicator**: Global "3 of 58" progress during tutorial, group-level "3 of 9" during normal mode
- **Replay Tips screen**: Profile settings navigates to a dedicated screen with expandable groups. Tap a group's "Replay" button to replay all tips in that group, or tap an individual tip to auto-navigate and replay just that one
- **Reduced motion support**: Instant show/hide when system accessibility reduce-motion is enabled
- **SVG spotlight mask**: Semi-transparent overlay with a cutout hole highlighting the target element
- **Animated illustrations**: Gesture demos (swipe, tap, long-press), feature icons with sparkles, welcome scenes
- **Milestone celebrations**: Full-screen confetti celebrations when users complete mark groups (7 milestones, skipped during tutorial)
- **Cross-device persistence**: Progress synced via Supabase `coach_mark_progress` table with AsyncStorage fallback
- **Prerequisite chains**: Marks only appear after their prerequisites are completed (normal mode)
- **Group skip**: "Skip all [group]" dismisses remaining marks in a category (normal mode only)
- **Mixpanel analytics**: Every shown/completed/skipped mark and milestone is tracked

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

### Profile Page

The profile page is a decomposed orchestrator (~340 lines) composing 7 sub-components:

- **ProfileHeroSection** -- Avatar with initials fallback and camera badge, display name, username, location with refresh, bio display (tappable to edit), and profile completion hints
- **ProfilePhotosGallery** -- 3-slot horizontal gallery for additional photos beyond the avatar. Upload via image picker, long-press to remove. Photos stored as `TEXT[]` on the profiles table, uploaded to Supabase Storage "avatars" bucket
- **ProfileInterestsSection** -- Displays user intents (filled orange pills) and categories (outlined pills). Tappable pencil icon opens the edit sheet
- **ProfileStatsRow** -- 3-column stats display: Saved count, Connections count, Boards count
- **EditBioSheet** -- Bottom sheet modal with multiline text input, 160-character limit with counter
- **EditInterestsSheet** -- Bottom sheet modal for multi-selecting intents and categories. Uses onboarding intent definitions with per-intent colors. Saves to the preferences table

The profile also includes visibility mode cycling (public/friends/private), activity status toggle, notifications toggle, "Replay Tips" (navigates to a dedicated screen with expandable group lists and per-tip replay), settings links (account, profile info, privacy), recent activity list, legal links, and sign out.

### View Friend Profile

Tapping a friend's avatar in the connections list opens their full profile as an overlay screen. Shows their hero section, photo gallery, interests, stats, a message button, and a remove friend option. Access is controlled by 3 RLS policies that enforce visibility based on the friend's `visibility_mode` setting. Private profiles show a "This profile isn't available" error state.

### For You System

The person-centric "For You" view provides personalized recommendations for each saved person:

- **Birthday Hero Card** -- Orange hero card with birthday countdown and AI-generated gift/experience summary (~80 char). Falls back to a dark "Picks" card when no birthday is set.
- **Person Recommendation Cards** -- Horizontal scroll of 2-3 personalized place cards powered by the linked user's swipe data via `get-personalized-cards`.
- **Holiday Rows** -- Expandable rows for upcoming holidays, sorted by days away, with real card loading from `get-holiday-cards` (pool-first + Google Places fallback). Gender-filtered standard holidays plus user-created custom holidays.
- **Swipe-to-Archive** -- PanResponder-based swipe gesture on holiday rows with archive/unarchive persistence in the database.
- **Custom Holiday Modal** -- Create personal special days with name, date picker (month + day scrollable pills), description, and category selection.
- **Elite People Summary** -- Horizontal cards showing upcoming birthdays across all saved people. Non-Elite users see a BlurView teaser with upgrade CTA.

### Link a Friend

The "Link a Friend" flow supports two methods:

- **Search Mingla** -- Search existing Mingla users by username and send friend link requests.
- **Invite by Phone** -- Enter a phone number with country picker (defaults to device locale), send an SMS invite via Twilio. When the invited person signs up and verifies their phone, both users are automatically linked as friends with `saved_people` entries created on both sides. Rate limited to 10 invites per 24 hours.

### Connect Page

The Connect page manages friend relationships:

- **Add Friends** -- Username search with debounced queries via `search-users` edge function. Send friend link requests with haptic feedback.
- **Requests** -- View and respond to pending friend link requests with accept/decline actions.
- **Blocked** -- Manage blocked users.
- **Invite** -- Share invite link via system share sheet.
- **Pill Filters** -- Horizontal scrollable pill navigation with badge counts for pending requests.
- **Avatar Navigation** -- Tapping a friend's avatar in the chat list navigates to their full profile.

### Friend Links System

- Friend link requests sent via `send-friend-link` edge function with push notifications
- Phone invites via `send-phone-invite` edge function with Twilio SMS and auto-linking on signup
- Mirror writes to legacy `friend_requests` table preserve referral credit triggers
- Auto-convert trigger creates `friend_links` + `saved_people` when invited users sign up
- Duplicate-prevention on `saved_people` entries during link acceptance (`.maybeSingle()` check)
- Saved people entries created for every synced friend during onboarding (not gated on audio recording)
- Cross-invalidation of React Query caches on link accept (friend links + saved people + personalized cards)

### AI-Powered Recommendations
- Experience cards built from real Google Places data, enriched by GPT-4o-mini
- Audio-to-recommendations pipeline: voice notes transcribed (Whisper), analyzed (GPT-4o-mini), used to generate personalized experience cards
- Card pool data pipeline: pool-first serving, falls back to Google Places API
- 5-factor scoring algorithm ranks cards by category match, tag overlap, popularity, quality, and text relevance
- AI summary generation for birthday hero cards via `generate-ai-summary` edge function
- Proximity-optimized stop pairing: consecutive stops on curated cards are proximity-chained (3km → 5km → closest fallback) so users spend time enjoying the experience, not traveling between distant locations. Applies to adventurous, first-date, romantic, friendly, and group-fun intents

### Card-Based Swipe Interface
- Swipe right to save, left to skip, up to expand full details
- PanResponder with ref-based closure management for reliable gesture handling
- Curated multi-stop itinerary experiences interleaved with single-place cards
- Expanded card modal with image gallery, weather forecast, busyness predictions, and match score breakdown
- Dismissed cards review sheet for reconsidering skipped cards
- Batch auto-advance when all cards in a batch have been swiped (regular and curated)
- Unified loading states with pulsing-dot animation (initial load, slow batch, batch transition, overlay) -- no stock spinners

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
| `profiles` | User profiles: phone, referral_code, gender, birthday, country, preferred_language, bio, avatar_url, photos (TEXT[]), visibility_mode |
| `preferences` | User preference settings (categories, price tiers, intents, travel) |
| `subscriptions` | Subscription tier, trial, referral bonus months |

### Education & Coach Marks

| Table | Purpose |
|-------|---------|
| `coach_mark_progress` | Tracks completed coach marks per user (user_id, coach_mark_id, completed_at). UNIQUE constraint on (user_id, coach_mark_id). Users can read, write, and delete their own rows (DELETE enabled for "Replay Tips" reset). |

### Push Notifications

| Table | Purpose |
|-------|---------|
| `user_push_tokens` | Expo push tokens per user/device (platform, device_id, updated_at) |

### Social Tables

| Table | Purpose |
|-------|---------|
| `friend_requests` | Legacy friend request lifecycle (used for referral credit triggers) |
| `friends` | Bidirectional friendship records (user_id, friend_user_id, status) |
| `friend_links` | Friend link requests (pending/accepted) for synced friends |
| `blocked_users` | User blocks |
| `pending_invites` | Phone invites for non-app users (auto-converts to friend_links + saved_people on signup) |
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
| `send-phone-invite` | Validate phone, create pending invite, send SMS via Twilio |
| `send-friend-request-email` | Email notifications for friend requests |
| `send-collaboration-invite` | Push notifications for session invites |
| `notify-invite-response` | Push notifications for invite responses |
| `send-message-email` | Push notifications for new direct messages |
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
EXPO_PUBLIC_MIXPANEL_TOKEN=your-mixpanel-token  # Optional: analytics disabled if not set
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
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_VERIFY_SERVICE_SID
TWILIO_FROM_PHONE (or TWILIO_MESSAGING_SERVICE_SID)
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

# 4. Run Supabase migrations (includes coach_mark_progress table)
supabase db push

# 5. Deploy edge functions
supabase functions deploy

# 6. Configure Twilio env vars in Supabase dashboard
#    TWILIO_FROM_PHONE or TWILIO_MESSAGING_SERVICE_SID

# 7. Start Expo
npx expo start

# 8. Test on physical device (Android/iPhone)
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

- **Proximity-Optimized Stop Pairing** -- Curated card generators now proximity-chain consecutive stops using a tiered 3km → 5km → closest fallback. Stop 2 is always the highest-rated place near stop 1, and stop 3 (adventure) near stop 2. Applies to adventurous, first-date, romantic, friendly, and group-fun intents. Picnic and stroll are untouched.
- **One shared utility function** -- `selectClosestHighestRated` added to `generate-curated-experiences` edge function. Piggybacks on existing score-sorted place pools with zero new API calls or database changes.
- **6 surgical line replacements** -- Stop 2+ selection changed from `available[0]` (highest score only) to proximity-aware selection across 5 generators (including both normal and fallback paths in first-date).

---

## License

This project is proprietary. All rights reserved.
