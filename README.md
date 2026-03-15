# Mingla

A mobile app for planning social outings — combining pool-first card serving, real-time collaboration, and a card-based swipe interface to help users discover and plan experiences with friends.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Mobile | React Native (Expo), TypeScript |
| Server State | React Query |
| Client State | Zustand |
| Backend | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| Edge Functions | 51 Deno serverless functions |
| AI | OpenAI GPT-4o-mini, Whisper (audio transcription) |
| Maps & Places | Google Places API (New) |
| Live Events | Ticketmaster Discovery API v2 |
| SMS | Twilio (OTP verification + Programmable Messaging for invites) |
| Payments | Stripe Connect |
| Push Notifications | OneSignal (FCM v1 + APNs) |
| Analytics | Mixpanel (event tracking, user identification) |
| Navigation | Custom state-driven (no React Navigation) |
| Styling | StyleSheet only (no inline styles) |
| SVG | react-native-svg |
| Network State | expo-network (React Query onlineManager integration) |
| Dev Telemetry | Full-firehose activity tracker with domain-tagged logging (`__DEV__` only) |

---

## Project Structure

```
Mingla/
├── app-mobile/
│   ├── app/
│   │   └── index.tsx                    # Entry point (AppContent)
│   ├── src/
│   │   ├── components/                  # ~100 UI components
│   │   │   ├── onboarding/             # OnboardingShell, PhoneInput, OTPInput,
│   │   │   │                           # OnboardingFriendsAndPairingStep,
│   │   │   │                           # OnboardingCollaborationStep,
│   │   │   │                           # OnboardingConsentStep, SegmentedProgressBar
│   │   │   ├── connections/            # RequestsView, FriendsManagementList, PillFilters, AddFriendView
│   │   │   ├── board/                  # BoardViewScreen, BoardDiscussionTab, SwipeableSessionCards
│   │   │   ├── expandedCard/           # ActionButtons, ImageGallery, TimelineSection, WeatherSection
│   │   │   ├── profile/               # ProfileHeroSection, EditProfileSheet, EditBioSheet,
│   │   │   │                           # EditInterestsSheet, ViewFriendProfileScreen, Toggle, SettingsRow
│   │   │   ├── chat/                   # MessageBubble, ChatStatusLine, TypingIndicator
│   │   │   ├── discussion/            # EmojiReactionPicker, SuggestionPopup, EmptyDiscussion
│   │   │   └── ui/                     # Design system primitives (Button, Toast, CategoryTile, etc.)
│   │   ├── hooks/                      # ~62 React Query hooks + realtime hooks
│   │   ├── services/                   # ~73 service files
│   │   ├── contexts/                   # 3 React contexts (Navigation, CardCache, Recommendations)
│   │   ├── store/                      # Zustand store (appStore)
│   │   ├── types/                      # TypeScript types
│   │   ├── constants/                  # Design tokens, config, categories, holidays, countries, languages
│   │   └── utils/                      # ~27 utility files
│   ├── app.json
│   ├── eas.json
│   └── package.json
│
├── supabase/
│   ├── functions/                      # 51 Deno edge functions
│   │   ├── _shared/                   # Shared edge function utilities
│   │   └── [function-name]/           # Individual edge functions
│   ├── migrations/                    # 196 SQL migration files
│   └── config.toml
│
├── mingla-admin/                       # Admin tooling
├── backend/                            # Backend utilities
└── oauth-redirect/                     # Static OAuth callback page
```

---

## Features

### Onboarding Flow (7-Step State Machine)

The onboarding flow uses a 7-step state machine with sub-steps within each step. All friend and pairing actions during onboarding use real production services (`friendsService`, `pairingService`, `useFriends`, `usePairings`).

**Step 1 — Account & Identity** has 5 sub-steps:
1. **Welcome** — app introduction screen
2. **Phone** — phone number entry with country picker
3. **OTP** — 6-digit verification code
4. **Gender Identity** — 8 inclusive gender options
5. **Personal Details** — country, date of birth, and preferred language

**Step 2 — Intents** — value proposition and intent selection

**Step 3 — Location** — GPS permission request

**Step 4 — Preferences** — manual location (if GPS denied), celebration, category selection, price tiers, transport mode, travel time

**Step 5 — Friends & Pairing** — unified screen (`OnboardingFriendsAndPairingStep`) combining friend addition and pairing into a single step. Users can add friends by phone number, accept incoming friend requests, and send/accept pair requests all from one screen. Tracks `OnboardingPairAction` entries (type, target, tier, request/pairing IDs) for audit and state.

**Step 6 — Collaborations** — create collaboration sessions with friends (`OnboardingCollaborationStep`). Named sessions with multi-friend selection.

**Step 7 — Consent & Launch** has 2 sub-steps:
1. **Consent** (`OnboardingConsentStep`) — explicit data consent
2. **Getting Experiences** (`GettingExperiencesScreen`) — animated loading/ready screen with compass spinner and checkmark reveal

The progress bar displays 7 segments. `OnboardingData` tracks `addedFriends`, `pairActions`, `skippedFriends`, and `createdSessions`. The old Path A/B/C branching, `OnboardingSyncStep`, audio recording fields, `invitePath`, `personName`, `personBirthday`, `personGender`, and `selectedSyncFriends` have all been removed.

### Profile Page

A single-scroll experience with 5 sections and inline editing via bottom sheets:

- **ProfileHeroSection** — avatar with initials gradient fallback, display name, @username, location, bio, profile completion hints
- **ProfileInterestsSection** — intents (filled orange pills) and categories (outlined pills) with edit via EditInterestsSheet
- **ProfileStatsRow** — 3-column tappable stats: Saved, Friends, Boards
- **Settings Section** — notifications toggle, profile visibility cycling, show activity toggle
- **Account Section** — edit profile (EditProfileSheet), replay tips, account settings
- Legal links (Privacy Policy, Terms of Service) and sign out

### View Friend Profile

Tapping a friend's avatar opens their full profile as an overlay. Access controlled by 3 RLS policies based on `visibility_mode`. Private profiles show an error state.

### Pairing System

Pairing replaces the legacy Saved People system. Real behavior data (swipes, saves, visits) drives personalization instead of audio descriptions.

**3-Tier Pairing:**
- **Tier 1 (Friend):** Direct pair request to any Mingla friend
- **Tier 2 (Mingla, not friend):** Phone number lookup creates friend request + hidden pair request. DB trigger reveals pair request on friend acceptance.
- **Tier 3 (Not on Mingla):** SMS invite. DB trigger auto-creates friend request + pair request on phone verification.

**Pill States on Discover:** `active`, `incoming_request`, `pending_active`, `greyed_waiting_friend`, `greyed_waiting_pair`, `greyed_waiting_signup`

**PersonHolidayView:** Birthday hero card with countdown, "Add to calendar" with 7-tier reminder system, deterministic 6-card layout per occasion (3 curated + 3 category), shuffle button, AI-generated holiday categories cached 30 days, custom holidays with commemoration display, swipe-to-archive.

### Connect Page

- **Friends Management Modal** — two-tab modal (Friends with search + dropdown menu, Requests with accept/decline)
- **Real-Time Messaging** — dual-channel delivery (Supabase broadcast + postgres_changes backup), deduplication, optimistic messages
- **Compact Chat UI** — sender grouping, timestamp pills, read receipts (sent/delivered/read)
- **Presence & Typing** — realtime online/offline status with 30-second heartbeat, typing indicators via broadcast
- **Inverted FlatList** — standard chat pattern

### Collaboration Sessions

- Friendship prerequisite for activation (not creation). Non-friends get hidden invites that auto-reveal on friend acceptance.
- Atomic friend operations via PostgreSQL RPC (`accept_friend_request_atomic`, `remove_friend_atomic`)
- Phone number invites with auto-chain (friend request + session add in one tap)
- Server-side synchronized deck generation stored in `session_decks`
- Union-based preference aggregation across all participants
- Real-time card swiping, voting, RSVP, lock-in, calendar sync, and chat
- Concurrent board creation protection via DB-level partial unique index

### Card-Based Swipe Interface

- Swipe right to save, left to skip, up to expand
- Curated multi-stop itinerary experiences interleaved with single-place cards
- Expanded card modal with image gallery, weather forecast, busyness predictions, match score breakdown
- Dismissed cards review sheet
- Batch auto-advance with unified pulsing-dot loading states

### AI-Powered Recommendations

- Pool-first card serving from the `card_pool` table (sub-second)
- "Generate More" fallback via GPT-4o-mini + Google Places API
- 5-factor scoring algorithm (category match, tag overlap, popularity, quality, text relevance)
- Proximity-optimized stop pairing for curated cards (3km/5km/closest)
- AI summary generation for birthday hero cards

### 12-Category System

| Slug | Display Name | Color |
|------|-------------|-------|
| `nature` | Nature | `#10B981` |
| `first_meet` | First Meet | `#6366F1` |
| `picnic` | Picnic | `#84CC16` |
| `drink` | Drink | `#F59E0B` |
| `casual_eats` | Casual Eats | `#F97316` |
| `fine_dining` | Fine Dining | `#7C3AED` |
| `watch` | Watch | `#3B82F6` |
| `creative_arts` | Creative & Arts | `#EC4899` |
| `play` | Play | `#EF4444` |
| `wellness` | Wellness | `#14B8A6` |
| `groceries_flowers` | Groceries & Flowers | `#22C55E` |
| `work_business` | Work & Business | `#64748B` |

### 4-Tier Price System

| Tier | Label | Range | Google Levels |
|------|-------|-------|--------------|
| `chill` | Chill | $50 max | FREE + INEXPENSIVE |
| `comfy` | Comfy | $50-$150 | MODERATE |
| `bougie` | Bougie | $150-$300 | EXPENSIVE |
| `lavish` | Lavish | $300+ | VERY_EXPENSIVE |

### Native UX

- Pull-to-refresh on SavedTab, CalendarTab, DiscoverScreen, ConnectionsPage
- Haptic feedback on all interactive buttons
- Duplicate mutation guards via isPending checks
- Push notifications via OneSignal (FCM v1 + APNs)

### Additional Features

- Subscription system (Free, Pro, Elite) with Stripe Connect
- GPS and manual location with travel time preferences
- Holiday planning with custom holidays, archiving, and pool-first card sourcing with shuffle
- Post-experience reviews with star ratings and voice recordings
- Device calendar export
- Boards with card voting, RSVP, iMessage-style discussion (emoji reactions, photo attachments, typing indicators, read receipts, @mentions, #card-tags)
- Universal deep links via usemingla.com
- Night Out section powered by Ticketmaster
- Navigation state persistence across process death
- Deep link deferral for unauthenticated users (24-hour TTL)
- Centralized 401 handler with auto-sign-out after 3 consecutive failures
- Network-aware query refetching via expo-network + React Query onlineManager

### Console Telemetry & Breadcrumb Trail (Dev Only)

A `__DEV__`-only full-firehose activity tracker with color-coded domain prefixes (`[TAP]`, `[NAV]`, `[STORE]`, `[EDGE]`, `[REALTIME]`, `[PUSH]`, `[LIFECYCLE]`, `[QUERY]`, `[MUTATION]`). Features TrackedTouchableOpacity/TrackedPressable, Zustand devLogger middleware, trackedInvoke wrapper, realtime channel logging, push notification logging, React Query global callbacks, lifecycle hook, and a 30-entry breadcrumb ring buffer with auto-dump on errors.

---

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles: phone, referral_code, gender, birthday, country, preferred_language, bio, avatar_url, visibility_mode |
| `preferences` | User preference settings (categories, price tiers, intents, travel) |
| `subscriptions` | Subscription tier, trial, referral bonus months |

### Social Tables

| Table | Purpose |
|-------|---------|
| `friend_requests` | Friend request lifecycle with RLS. Atomic accept via `accept_friend_request_atomic` RPC |
| `friends` | Bidirectional friendship records. Atomic removal via `remove_friend_atomic` RPC |
| `blocked_users` | User blocks |
| `pending_invites` | Phone invites for non-app users (auto-converts on signup) |
| `pending_session_invites` | Collaboration session invites for non-app users |
| `referral_credits` | Referral credit audit log |

### Pairing Tables

| Table | Purpose |
|-------|---------|
| `pair_requests` | Pair request lifecycle across 3 tiers. Supports `visibility`, `gated_by_friend_request_id`, `pending_display_name`, `pending_phone_e164`. Atomic accept via `accept_pair_request_atomic` RPC |
| `pairings` | Active bidirectional pairings (`user_a_id < user_b_id`). CASCADE deletes to custom_holidays, archived_holidays, person_card_impressions |
| `pending_pair_invites` | Tier 3 phone invites for non-Mingla users. Auto-converts via DB trigger |

### People & Experiences Tables

| Table | Purpose |
|-------|---------|
| `saved_people` | Legacy saved people (deprecated — replaced by pairings) |
| `custom_holidays` | User-created holidays linked to pairings via `pairing_id` and `paired_user_id` |
| `archived_holidays` | Tracks archived holidays per user. Supports `pairing_id` and `paired_user_id` |
| `person_card_impressions` | Tracks shown cards per paired person for no-repeat shuffle |

### Chat & Presence Tables

| Table | Purpose |
|-------|---------|
| `conversation_presence` | Per-user, per-conversation online status with heartbeat timestamps |

### Collaboration Tables

| Table | Purpose |
|-------|---------|
| `collaboration_sessions` | Session records with board_id partial unique index |
| `collaboration_invites` | Invite records with `pending_friendship` boolean for visibility gating |
| `session_participants` | Session participant records |
| `boards` | Collaboration boards |
| `board_messages` | Discussion messages (content, image_url, mentions, reply_to_id) |
| `board_message_reads` | Read receipts |
| `board_message_reactions` | Emoji reactions per message |
| `board_session_preferences` | Per-session preferences (auto-seeded from solo preferences) |
| `session_decks` | Server-generated decks per session (JSONB, SHA-256 hash dedup, 24h expiry) |

### Pipeline Tables

| Table | Purpose |
|-------|---------|
| `card_pool` | Enriched place cards with curated `stopsData` JSONB |
| `place_pool` | Place data pool from Google Places |
| `user_card_impressions` | Tracks which cards users have seen (discover/swipe) |
| `person_card_impressions` | Tracks shown cards per saved person (hero cards + holiday rows) |
| `ticketmaster_events_cache` | Cached Ticketmaster events (2-hour TTL) |
| `google_places_cache` | Cached Google Places API responses |
| `discover_daily_cache` | Cached discover feed results |
| `curated_places_cache` | Cached curated experience places |

### Push Notifications

| Table | Purpose |
|-------|---------|
| `user_push_tokens` | Legacy Expo push tokens (unused — OneSignal manages tokens internally) |

---

## Edge Functions

### Experience Generation

| Function | Purpose |
|----------|---------|
| `generate-experiences` | AI-powered place recommendations |
| `new-generate-experience-` | Next-gen experience generation with card pool pipeline |
| `generate-curated-experiences` | Multi-stop itinerary generation |
| `get-personalized-cards` | Personalized card retrieval based on swipe data |
| `get-person-hero-cards` | Pool-first card serving for person hero section and holiday rows. Supports `mode: "default" \| "shuffle"` with paired user preference blending |
| `get-holiday-cards` | Holiday card sourcing, primarily for "Generate More" requests via GPT-4o-mini |
| `generate-ai-summary` | AI birthday/gift summary via GPT-4o-mini (~80 char) with occasion-aware suggestions |
| `generate-holiday-categories` | AI-generated 6-category slot sets for holidays via GPT-4o-mini |
| `discover-experiences` | Explore/discover tab |
| `discover-cards` | Discover card generation |
| `generate-session-deck` | Server-side synchronized deck generation for collaboration sessions |
| `discover-[category]` | Per-category discover endpoints (12 functions) |
| `holiday-experiences` | Holiday-specific experience generation |
| `refresh-place-pool` | Daily card pool refresh |
| `warm-cache` | Cache warming for frequently accessed data |

### Social and Notifications

| Function | Purpose |
|----------|---------|
| `lookup-phone` | Phone number lookup for friend search |
| `search-users` | Username-based user search |
| `send-phone-invite` | Validate phone, create pending invite, send SMS via Twilio |
| `send-friend-request-email` | Push notification for friend requests (via OneSignal) |
| `send-friend-accepted-notification` | Push notification when a friend request is accepted |
| `send-collaboration-invite` | Push notification for session invites |
| `notify-invite-response` | Push notification for invite responses |
| `send-message-email` | Push notification for new direct messages |
| `send-pair-request` | Handles all 3 pairing tiers with auto-detection |
| `notify-pair-request-visible` | Push + in-app notification when hidden pair request becomes visible |
| `process-referral` | Referral credit reconciliation + push notification |

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
| `admin-place-search` | Admin place search utility |

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
ONESIGNAL_APP_ID
ONESIGNAL_REST_API_KEY
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

## Recent Changes (Onboarding Overhaul)

- **7-step onboarding replaces 5-step flow** — Steps 1-4 unchanged; Step 5 is now Friends & Pairing (unified), Step 6 is Collaborations, Step 7 is Consent + Getting Experiences. Progress bar updated to 7 segments.
- **Path A/B/C branching removed** — The old sync path (audio recording, Whisper transcription, AI analysis), add-person path (name/birthday/gender entry), and skip path have all been deleted. `OnboardingSyncStep.tsx` removed entirely.
- **New `OnboardingFriendsAndPairingStep` component** — combines friend addition and pair requests into a single unified screen using real production services (`friendsService`, `pairingService`, `useFriends`, `usePairings`). New `OnboardingPairAction` type tracks pair requests sent/accepted during onboarding.
- **New `GettingExperiencesScreen` inline component** — animated loading/ready state with compass spinner animation and checkmark reveal, replacing the old immediate launch.
- **`OnboardingData` simplified** — removed `invitePath`, `personName`, `personBirthday`, `personGender`, audio fields, and `selectedSyncFriends`. Added `pairActions: OnboardingPairAction[]` and `createdSessions: CreatedSession[]`.

---

## License

This project is proprietary. All rights reserved.
