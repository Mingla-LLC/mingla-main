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
| Edge Functions | 49 Deno serverless functions |
| AI | OpenAI GPT-4o-mini, Whisper (audio transcription) |
| Maps & Places | Google Places API (New) |
| Live Events | Ticketmaster Discovery API v2 |
| SMS | Twilio (OTP verification + Programmable Messaging for invites) |
| Payments | Stripe Connect |
| Push Notifications | Expo Push Notifications |
| Analytics | Mixpanel (event tracking, user identification) |
| Navigation | Custom state-driven (no React Navigation) |
| Styling | StyleSheet only (no inline styles) |
| SVG | react-native-svg |

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
│   │   │   ├── expandedCard/          # Expanded card sub-components (ActionButtons, etc.)
│   │   │   ├── profile/               # ProfileHeroSection, PhotosGallery, InterestsSection, StatsRow, EditBioSheet, EditInterestsSheet, ViewFriendProfileScreen, ProfilePersonalInfoSection
│   │   │   └── ui/                     # Shared UI primitives
│   │   ├── hooks/                      # ~38 React Query hooks
│   │   ├── services/                   # ~62 service files
│   │   ├── contexts/                   # 3 React contexts
│   │   ├── store/                      # Zustand store (appStore)
│   │   ├── types/                      # TypeScript types
│   │   ├── constants/                  # Design tokens, config, categories, holidays
│   │   └── utils/                      # 12 utility files
│   ├── app.json
│   ├── eas.json
│   └── package.json
│
├── supabase/
│   ├── functions/                      # 49 Deno edge functions
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

**Step 5 -- Social** -- add friends by phone (persisted to DB immediately), collaboration session management (always shown, even if friends step is skipped), then choose a path:
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

The profile also includes visibility mode cycling (public/friends/private), activity status toggle, notifications toggle, settings links (account, profile info, privacy), recent activity list, legal links, and sign out.

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
- **Invite by Phone** -- Enter a phone number with country picker (defaults to device locale), send an SMS invite via Twilio. When the invited person signs up and verifies their phone, both users become basic friends. Profile linkage requires separate consent from both users. Rate limited to 10 invites per 24 hours.

### Connect Page

The Connect page manages friend relationships:

- **Add Friends** -- Phone number entry with country picker (reuses full-screen CountryPickerModal with ISO code search), debounced phone lookup, send friend link requests or invite non-users via Share. "Sent" tab shows pending requests with cancel option.
- **Requests** -- View and respond to pending friend link requests with accept/decline actions.
- **Blocked** -- Manage blocked users.
- **Invite** -- Share invite link via system share sheet.
- **Pill Filters** -- Horizontal scrollable pill navigation with badge counts for pending requests.
- **Avatar Navigation** -- Tapping a friend's avatar in the chat list navigates to their full profile.

### Friend Links System

- Friend link requests sent via `send-friend-link` edge function with push notifications
- Phone invites via `send-phone-invite` edge function with Twilio SMS and basic friendship on signup
- Mirror writes to legacy `friend_requests` table preserve referral credit triggers (upsert handles re-sends)
- Auto-convert trigger creates `friend_links` + `friends` rows as basic friendship when invited users sign up (no auto-linking)
- Two-phase consent: accepting a friend request creates basic friendship only. Profile linkage (sharing name, birthday, gender, avatar) requires explicit consent from both users via `respond-link-consent`
- Link consent prompts appear in the Connections page "Requests" panel with accept/decline buttons
- Post-onboarding badge dot on Connections tab when pending link consents exist
- Re-initiation: users can re-initiate declined link consent via the add person flow, resetting the consent state
- Cross-invalidation of React Query caches on consent response (link consent + saved people + friend links)
- Saved people entries created for every synced friend during onboarding (not gated on audio recording)
- Unified visibility: onboarding Step 5 and ConnectionsPage read from both `friend_requests` and `friend_links`, with Realtime subscriptions for instant updates and correct routing per source system
- `lookup-phone` checks both `friends` and `friend_links` tables for friendship/pending status

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

### Push Notifications

| Table | Purpose |
|-------|---------|
| `user_push_tokens` | Expo push tokens per user/device (platform, device_id, updated_at) |

### Social Tables

| Table | Purpose |
|-------|---------|
| `friend_requests` | Legacy friend request lifecycle with RLS (used for referral credit triggers) |
| `friends` | Bidirectional friendship records (user_id, friend_user_id, status) |
| `friend_links` | Friend link requests with two-phase consent (pending/accepted + link_status: none/pending_consent/consented/declined) |
| `blocked_users` | User blocks |
| `pending_invites` | Phone invites for non-app users (auto-converts to pending friend_links + friend_requests on signup; user must explicitly accept) |
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
| `send-friend-link` | Send friend link invitations (with referral mirror write + re-initiation after declined consent) |
| `respond-friend-link` | Process friend link responses (creates basic friendship + initiates consent flow) |
| `respond-link-consent` | Process link consent responses (creates linked saved_people when both consent) |
| `unlink-friend` | Remove friend connections (requires consented link_status) |
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

# 4. Run Supabase migrations
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

- **Social Systems Stability Sprint** -- Fixed 7 bugs and 3 hardening items across friend requests, friend linking, and collaboration sessions. Phone invite trigger now creates everything as PENDING (user must explicitly accept). RLS enabled on `friend_requests` (with WITH CHECK). Friend accept is idempotent (upsert) and mirrors to friend_links. Collaboration step always shown during onboarding. Friends added during onboarding persisted to DB immediately. Decline cascades to friend_links. Collaboration sessions created during onboarding now visible in the main app (pending/dormant status included). Added realtime subscriptions to ConnectionsPage and DiscoverScreen for instant social updates.
- **Link Consent — Two-Phase Profile Sharing** -- Accepting a friend request creates basic friendship only. Profile linkage requires explicit consent from both users.
- **Phone Invite No Auto-Link** -- The phone invite auto-convert trigger creates pending relationships only, not automatic acceptance.

---

## License

This project is proprietary. All rights reserved.
