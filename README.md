# Mingla

Mingla is a mobile app for planning social outings -- combining AI-powered place recommendations, real-time collaboration, and a card-based swipe interface to help users discover and plan experiences with friends.

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
| Push Notifications | OneSignal (FCM v1 + APNs) |
| Analytics | Mixpanel (event tracking, user identification) |
| Navigation | Custom state-driven (no React Navigation) |
| Styling | StyleSheet only (no inline styles) |
| SVG | react-native-svg |
| Dev Telemetry | Breadcrumb ring buffer + TrackedTouchableOpacity (`__DEV__` only) |

---

## Project Structure

```
Mingla/
├── app-mobile/
│   ├── app/
│   │   └── index.tsx                    # Entry point (AppContent)
│   ├── src/
│   │   ├── components/                  # ~100+ UI components
│   │   │   ├── onboarding/             # OnboardingShell, PhoneInput, OTPInput, etc.
│   │   │   ├── connections/            # RequestsView, FriendsManagementList, PillFilters
│   │   │   ├── board/                  # Board-related components
│   │   │   ├── expandedCard/           # Expanded card sub-components (ActionButtons, etc.)
│   │   │   ├── profile/               # ProfileHeroSection, PhotosGallery, InterestsSection, etc.
│   │   │   ├── chat/                   # MessageBubble, ChatStatusLine, TypingIndicator
│   │   │   └── ui/                     # Shared UI primitives
│   │   ├── hooks/                      # ~61 React Query hooks + realtime hooks
│   │   ├── services/                   # ~75 service files
│   │   ├── contexts/                   # 3 React contexts
│   │   ├── store/                      # Zustand store (appStore)
│   │   ├── types/                      # TypeScript types
│   │   ├── constants/                  # Design tokens, config, categories, holidays
│   │   └── utils/                      # ~24 utility files
│   ├── app.json
│   ├── eas.json
│   └── package.json
│
├── supabase/
│   ├── functions/                      # 48 Deno edge functions
│   │   ├── _shared/                   # Shared edge function utilities
│   │   ├── send-phone-invite/         # Phone invite SMS via Twilio
│   │   └── [function-name]/           # Individual edge functions
│   ├── migrations/                    # 171 SQL migration files
│   └── config.toml
│
├── mingla-admin/                       # Admin tooling
├── backend/                            # Backend utilities
└── oauth-redirect/                     # Static OAuth callback page
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

**Step 5 -- Social** -- collaboration session management, then choose a path:
- **Path A (Sync):** Select friends to sync with, record audio descriptions. Audio is transcribed via Whisper, analyzed by GPT-4o-mini, and used to generate personalized experience cards. Saved people entries are created for every synced friend regardless of audio.
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

### Person Page (For You)

The person-centric "For You" view provides personalized recommendations for each saved person with a redesigned card-forward layout:

- **Birthday Hero Section** -- Displays the person's age prominently alongside birthday countdown. A horizontal scroll of AI-curated hero cards (`PersonCuratedCard`) shows top-pick experiences tailored to the person's interests via GPT-4o-mini category extraction. A "Generate More" button fetches additional recommendations, excluding already-seen cards. Falls back to a dark "Picks" card when no birthday is set.
- **Hero Cards Pipeline** -- The `useHeroCards` hook calls `get-holiday-cards` in `hero` mode, which uses GPT-4o-mini to extract interest categories from the person's description, matches curated cards from the pool, and falls back to Google Places when the pool is insufficient. The `useGenerateMoreCards` mutation calls `generate_more` mode with `excludeCardIds` to avoid duplicates.
- **PersonGridCard** -- Unified grid card component matching the For You tab design. Shows venue image, category-colored badge, price tier pill, rating, and opens Google Maps on tap. Used across holiday rows for consistent visual treatment.
- **PersonCuratedCard** -- Compact curated card for the hero section horizontal scroll. Shows multi-stop itinerary info (stop count, price range) in a condensed format.
- **Holiday Rows** -- Expandable rows for upcoming holidays, sorted by days away, with real card loading from `get-holiday-cards` (pool-first + Google Places fallback). Cards render as `PersonGridCard` for unified design. Up to 3 tappable cards per category with venue images, readable category labels with colored badges, gradient overlays, and Google Maps navigation on tap. Intent-based sections (e.g., romantic) resolve to mapped category slugs before querying. Gender-filtered standard holidays plus user-created custom holidays.
- **Swipe-to-Archive** -- PanResponder-based swipe gesture on holiday rows with archive/unarchive persistence in the database.
- **Custom Holiday Modal** -- Create personal special days with name, date picker (month + day scrollable pills), description, and category selection.
- **Elite People Summary** -- Horizontal cards showing upcoming birthdays across all saved people. Non-Elite users see a BlurView teaser with upgrade CTA.

### Connect Page

The Connect page manages friend relationships and real-time messaging:

- **Friends Management Modal** -- Two-tab modal: "Friends" tab shows all accepted friends with search, three-dot dropdown menu (Mute/Unmute, Remove Friend, Block User, Report User); "Requests" tab shows pending friend requests with accept/decline. Badge on Requests tab shows pending count.
- **Blocked** -- Manage blocked users.
- **Invite** -- Share invite link via system share sheet.
- **Pill Filters** -- Horizontal scrollable pill navigation with badge counts for pending requests.
- **Avatar Navigation** -- Tapping a friend's avatar in the chat list navigates to their full profile.
- **Real-Time Messaging** -- Dual-channel delivery: Supabase broadcast for sub-second messages (<500ms) plus postgres_changes as backup (1-3s). Deduplication via shared `broadcastSeenIds` ref prevents double-rendering. Optimistic messages with temp IDs replaced by real DB IDs after successful send. Failed messages shown with error state.
- **Compact Chat UI** -- Messages grouped by sender (same sender within 2 minutes = one group). Grouped messages use compact border radius. Timestamp pills shown on >5 minute gaps. Read receipts: single check (sent), double gray (delivered), double orange (read).
- **Presence & Typing** -- Real-time online/offline status via Supabase Realtime presence channels with 30-second heartbeat. 60-second stale threshold for ghost detection. Typing indicators via broadcast (no DB writes). 3-second auto-stop, 4-second expiry.
- **Inverted FlatList** -- Standard React Native chat pattern replacing ScrollView. Prevents scroll jump on load-more. New messages appear at bottom without manual scroll management.

### Friends Management Modal

The Friends Management Modal (accessible from the Chats page header via the people icon) provides a two-tab interface:

- **Friends Tab** -- Searchable list of all accepted friends. Each friend row shows avatar (with initials fallback), display name, username, and muted badge. Three-dot dropdown menu offers: Mute/Unmute (with loading state), Remove Friend (with confirmation alert), Block User (opens BlockUserModal), Report User (opens ReportUserModal). Tapping outside closes open dropdowns.
- **Requests Tab** -- Incoming friend requests with accept/decline buttons. Red badge on the tab shows pending count.

### Phone Invites

- Phone invites via `send-phone-invite` edge function with Twilio SMS and basic friendship on signup
- Rate limited to 10 invites per 24 hours
- Push-to-in-app notification pipeline for friend requests and collaboration invites
- Realtime subscriptions for `pending_invites`, `saved_people`, `messages`, `friends`, and `calendar_entries` tables
- `lookup-phone` checks `friends` and `friend_requests` tables for friendship/pending status

### AI-Powered Recommendations
- Experience cards built from real Google Places data, enriched by GPT-4o-mini
- Audio-to-recommendations pipeline: voice notes transcribed (Whisper), analyzed (GPT-4o-mini), used to generate personalized experience cards
- Card pool data pipeline: pool-first serving, falls back to Google Places API
- 5-factor scoring algorithm ranks cards by category match, tag overlap, popularity, quality, and text relevance
- AI summary generation for birthday hero cards via `generate-ai-summary` edge function
- GPT-4o-mini category extraction from person descriptions for hero card curation
- Proximity-optimized stop pairing: consecutive stops on curated cards are proximity-chained (3km -> 5km -> closest fallback) so users spend time enjoying the experience, not traveling between distant locations. Applies to adventurous, first-date, romantic, friendly, and group-fun intents

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
- Unified session creation flow via `CreateSessionContent` component (embedded in CollaborationModule's Create tab, also available standalone)
- Named sessions with multi-friend selection via `FriendSelectionModal`
- Phone number invites: invite friends by phone number, non-friends get a friend request first, non-platform users get an SMS invite via Share sheet with auto-conversion on signup (DB triggers handle the full pending → converted pipeline for both friend invites AND session invites)
- JWT-validated invite edge function prevents impersonation
- Real-time card swiping, voting (with synchronous double-tap guard), RSVP, lock-in, calendar sync, and chat
- Union-based preference aggregation: all participants' categories, intents, and price tiers are merged; budget uses widest range; travel mode uses deterministic majority vote (alphabetical tie-break); travel time uses median; datetime uses earliest; location uses midpoint
- Server-side synchronized deck generation: a single canonical deck is generated per session and stored in `session_decks`, ensuring all participants see identical cards in identical order
- Idempotent preference seeding (upsert) on invite acceptance — safe against double-accept race conditions
- Auto-copy of solo preferences to collaboration sessions on invite acceptance and onboarding completion
- Push notifications for collaboration invites via OneSignal (awaited with error logging)
- Realtime deck refresh: when any participant updates preferences, a new deck is generated and all clients are notified via Supabase Realtime
- Realtime invite status: InvitesTab auto-refreshes via Supabase Realtime subscription when invites are created, accepted, or cancelled
- Session status loading guard: action buttons (Start Voting, Mark Complete) only render after status is confirmed from DB — prevents premature actions on pending sessions
- DB-level unique constraint on `collaboration_sessions.board_id` prevents concurrent board creation race condition
- Consensus lock-in with auto calendar entries
- Realtime sync via Supabase Realtime (collaboration_invites, collaboration_sessions, session_participants all published to supabase_realtime)
- In-app notification catch-up mechanism: on foreground resume, pending invites are queried and notifications are created for any missed while the app was in background/killed, with deduplication via ref-tracked invite IDs

### Subscription System
- Free, Pro, and Elite tiers with 1-week trial
- Referral bonus months for inviting friends
- Stripe Connect payment processing

### Console Telemetry & Breadcrumb Trail (Dev Only)

A `__DEV__`-only telemetry system that auto-logs every user interaction into a 30-entry ring buffer. When any error fires, the full breadcrumb trail dumps to the Metro console with timestamps and elapsed deltas.

- **TrackedTouchableOpacity** -- Drop-in replacement for TouchableOpacity that auto-logs taps with label resolution (logId > accessibilityLabel > testID > child text > "(unlabeled)")
- **Breadcrumb ring buffer** -- Stores last 30 user actions (taps, navigations, mutations, lifecycle events) with `breadcrumbs.add()` / `breadcrumbs.dump()`
- **Auto-dump on errors** -- `logger.error()`, query/mutation failures, and ErrorBoundary catches all trigger breadcrumb dumps
- **Screen transition logging** -- `useScreenLogger()` hook logs `[NAV] home -> discover` on every screen change
- **Lifecycle logging** -- `useLifecycleLogger()` logs app foreground/background transitions and network connectivity changes
- **Button tracking** -- The design system `Button` component auto-logs taps without replacing its base TouchableOpacity
- **Zero production overhead** -- All breadcrumb operations are gated behind `__DEV__`
- **logger.render() excluded** -- Render logs are deliberately excluded from breadcrumbs to prevent 60fps noise from flushing real user actions

### Native UX
- **Pull-to-refresh** on SavedTab, CalendarTab, DiscoverScreen, and ConnectionsPage
- **Haptic feedback** on all interactive buttons (buttonPress, success, warning, error, selection patterns)
- **Duplicate mutation guards** -- isPending checks prevent double-tap on accept/decline/send buttons
- **Push notifications** -- OneSignal handles all push delivery (FCM v1 + APNs), token management, and device registration. Edge functions target users by Supabase UUID via OneSignal REST API

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
| `user_push_tokens` | Legacy Expo push tokens (unused -- OneSignal manages tokens internally). Retained as safety net. |

### Social Tables

| Table | Purpose |
|-------|---------|
| `friend_requests` | Friend request lifecycle with RLS |
| `friends` | Bidirectional friendship records (user_id, friend_user_id, status) |
| `blocked_users` | User blocks |
| `pending_invites` | Phone invites for non-app users (auto-converts to friend_requests on signup) |
| `pending_session_invites` | Collaboration session invites for non-app users |
| `referral_credits` | Referral credit audit log |

### Chat & Presence Tables

| Table | Purpose |
|-------|---------|
| `conversation_presence` | Per-user, per-conversation online status with heartbeat timestamps. Auto-update trigger on row modification. Stale presence cleanup function. |

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
| `collaboration_invites` | Session invite records (canonical columns: `inviter_id`, `invited_user_id`) |
| `session_participants` | Session participant records |
| `boards` | Collaboration boards |
| `board_session_preferences` | Per-session preference settings (auto-seeded from solo preferences) |
| `session_decks` | Canonical server-generated decks per session (JSONB cards, preferences hash, 24h expiry, RLS for participants) |

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
| `get-holiday-cards` | Holiday card sourcing with three modes: `holiday` (pool-first + Google fallback per category), `hero` (GPT-4o-mini category extraction from person description, curated card matching, Google Places fallback, priceTier derivation), and `generate_more` (additional cards excluding already-seen IDs) |
| `generate-ai-summary` | AI birthday/gift summary via GPT-4o-mini (~80 char) |
| `discover-experiences` | Explore/discover tab |
| `discover-cards` | Discover card generation |
| `generate-session-deck` | Server-side synchronized deck generation for collaboration sessions (aggregates preferences, calls discover-cards internally, caches in session_decks with SHA-256 hash deduplication) |
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
| `send-collaboration-invite` | Push notification for session invites (via OneSignal) |
| `notify-invite-response` | Push notification for invite responses (via OneSignal) |
| `send-message-email` | Push notification for new direct messages (via OneSignal) |
| `process-referral` | Manual referral credit reconciliation + push notification |

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

## Recent Changes

- **Realtime Publication Fix** -- Added `collaboration_invites`, `collaboration_sessions`, and `session_participants` to the `supabase_realtime` publication. All existing realtime subscriptions now actually receive events (previously they silently received nothing).
- **Column Consolidation** -- Eliminated duplicate columns on `collaboration_invites` (`invitee_id`/`invited_user_id` and `inviter_id`/`invited_by`). The table now has exactly two participant columns: `inviter_id` (sender) and `invited_user_id` (recipient). Sync triggers removed. All app code, RLS policies, and edge functions use canonical columns only.
- **In-App Notification Catch-Up** -- Added a foreground resume mechanism that queries pending invites and creates in-app notifications for any missed while the app was in background/killed, with deduplication via `notifiedCollabInviteIdsRef`.
- **Debounced Invite Handler** -- Changed the `collaboration_invites` INSERT realtime handler in `useSessionManagement.ts` from immediate `loadUserSessions()` to debounced (300ms), preventing thundering herd when multiple invitations arrive simultaneously.
- **Delete-User Edge Function** -- Updated `delete-user` to reference `invited_user_id` instead of the dropped `invitee_id` column.

---

## License

This project is proprietary. All rights reserved.
