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
| Edge Functions | 60 Deno serverless functions |
| AI | OpenAI GPT-4o-mini, Whisper (audio transcription) |
| Maps & Places | Google Places API (New) |
| Live Events | Ticketmaster Discovery API v2 |
| SMS | Twilio (OTP verification + Programmable Messaging for invites) |
| Payments | RevenueCat (subscription management) + Stripe Connect |
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
│   │   │   ├── profile/               # ProfileHeroSection, EditBioSheet,
│   │   │   │                           # EditInterestsSheet, ViewFriendProfileScreen, Toggle, SettingsRow
│   │   │   ├── chat/                   # MessageBubble, ChatStatusLine, TypingIndicator
│   │   │   ├── discussion/            # EmojiReactionPicker, SuggestionPopup, EmptyDiscussion
│   │   │   └── ui/                     # Design system primitives (Button, Toast, CategoryTile, etc.)
│   │   ├── hooks/                      # ~67 React Query hooks + realtime hooks
│   │   ├── services/                   # ~75 service files (including deepLinkService.ts)
│   │   ├── contexts/                   # 3 React contexts (Navigation, CardCache, Recommendations)
│   │   ├── store/                      # Zustand store (appStore)
│   │   ├── types/                      # TypeScript types
│   │   ├── constants/                  # Design tokens, config, categories, holidays, countries, languages, tier limits
│   │   └── utils/                      # ~27 utility files
│   ├── app.json
│   ├── eas.json
│   └── package.json
│
├── supabase/
│   ├── functions/                      # 60 Deno edge functions
│   │   ├── _shared/                   # Shared edge function utilities
│   │   └── [function-name]/           # Individual edge functions
│   ├── migrations/                    # 221 SQL migration files
│   └── config.toml
│
├── mingla-admin/                       # Admin tooling
├── backend/                            # Backend utilities
└── oauth-redirect/                     # Static OAuth callback page
```

---

## Features

### Notifications System V2

Server-side authoritative notification system replacing the previous AsyncStorage-based approach. All notification state lives in the `notifications` database table with Supabase Realtime subscriptions for instant in-app delivery.

- **30+ notification types** covering social, collaboration, messaging, calendar, pairing, content, and lifecycle domains
- **Unified dispatch** through the `notify-dispatch` edge function with preference enforcement, quiet hours, rate limiting, and idempotency
- **Redesigned notification center** with filter tabs (All, Social, Sessions, Messages), action buttons, date grouping
- **Supabase Realtime subscription** for instant in-app delivery via `useNotifications` hook
- **Deep link navigation** from notification tap and push tap via `deepLinkService.ts`
- **Push action buttons** (Accept/Decline) directly from system tray
- **Notification preferences UI** with granular per-type toggles and quiet hours configuration
- **Cron-driven automation**: calendar reminders (tomorrow, today, feedback prompts), lifecycle nudges (onboarding incomplete, trial ending, re-engagement), weekly digest, and notification cleanup
- **Timezone-aware quiet hours** (10 PM - 8 AM in user's local timezone)

### Subscription Tiers & Feature Gating

Mingla operates on a 3-tier subscription model: Free, Pro, and Elite. Feature gating is enforced at both client-side (instant UX feedback) and server-side (tamper-proof enforcement via SQL functions).

| Feature | Free | Pro | Elite |
|---------|------|-----|-------|
| Regular Cards | Full access | Full access | Full access |
| Curated Cards | Blurred + AI teaser overlay | Full access | Full access + priority pool |
| Starting Point | GPS only (toggle locked) | Custom location | Custom + saved locations |
| Swipes | 20/day (counter visible) | Unlimited | Unlimited |
| Pairing | None (paywall on tap) | None (paywall on tap) | Unlimited |
| Collaboration Sessions | 1 session, 5 members | 3 sessions, 5 members | Unlimited, 15 members |
| 7-Day Trial | Full Elite access on signup | — | — |
| Referral Bonus | +1 month Elite per referral | — | — |

**Pricing:** Pro ($2/wk, $5/mo, $50/yr) · Elite ($3/wk, $9.99/mo, $80/yr)

A custom branded paywall (CustomPaywallScreen) shows tier comparison, contextual headers based on the triggering feature, and handles RevenueCat purchases with Supabase sync.

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
- **Account Section** — edit profile, replay tips, account settings
- Legal links (Privacy Policy, Terms of Service) and sign out

### View Friend Profile

Tapping a friend's avatar opens their full profile as an overlay. Access controlled by 3 RLS policies based on `visibility_mode`. Private profiles show an error state. Paired friends' profiles include saves and visits sections with horizontal card strips, a bilateral toggle for "For both of you" preference matching, and a "Tuned to [Name]" personalization badge.

### Preference Intelligence System

Multi-dimensional preference learning from swipe behavior (category, price tier, time of day, distance willingness). Paired users can see each other's saved places and visits. Features include:

- **Visit confirmation** — "I went here" button on saved cards opens optional voice review flow. Visit signals carry highest learning weight (0.35).
- **Paired saves/visits** — Read-only view of partner's saved and visited places via horizontal card strips and full-page grid views.
- **Bilateral matching** — "For both of you" toggle finds preference overlap between paired users, showing places they'd both enjoy.
- **Multi-dimension learning** — Trigger extracts category, price tier, time of day, and distance bucket from every interaction.
- **Confidence thresholds** — Preferences below 0.15 confidence (~2 interactions) are excluded from paired view queries.
- **Learning indicators** — Subtle toasts for new users at 5 and 10 swipe milestones.

### Pairing System (Elite Only)

Pairing replaces the legacy Saved People system. Real behavior data (swipes, saves, visits) drives multi-dimensional personalization (category, price, time, distance). Custom holidays generate a 50/50 blend of both users' preferences. Pairing is exclusively available to Elite tier users — Free and Pro users see a paywall on any pairing attempt. Server-side enforcement via `check_pairing_allowed()` SQL function.

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

- Session creation is tier-gated: Free (1 active session, 5 members), Pro (3, 5 members), Elite (unlimited, 15 members). Server-side enforcement via `check_session_creation_allowed()` SQL function.
- All tiers can join sessions created by others (viral loop).
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
- Free users see curated cards fully blurred with AI teaser overlays (LockedCuratedCard) — unswipeable, unexpandable, with upgrade CTA
- Free users have a 20-swipe daily limit with visible counter pill and hard paywall at limit
- Expanded card modal with image gallery, weather forecast, busyness predictions, match score breakdown
- Dismissed cards review sheet
- Batch auto-advance with unified pulsing-dot loading states
- **Image prefetching** — next 2 card images prefetched during swipe for instant photo transitions
- **DeckUIState state machine** — explicit discriminated union (`INITIAL_LOADING`, `LOADED`, `BATCH_LOADING`, `BATCH_SLOW`, `MODE_TRANSITIONING`, `EXHAUSTED`, `EMPTY`, `ERROR`) replaces ad-hoc boolean composition for deterministic render branching

### AI-Powered Recommendations

- Pool-first card serving from the `card_pool` table (sub-second) with `skipGapFill` fast path
- **Pool maturity gate** — `checkPoolMaturity()` short-circuits warm pool and Google API calls when the pool already has sufficient cards at the user's location
- **Pool-only Discover page** — `discover-experiences` serves exclusively from pool with zero Google API calls when any category coverage exists. Missing categories are omitted from the grid rather than triggering expensive API calls
- **Per-category pool queries** — prevents popularity starvation by querying 50 cards per category instead of a single `.limit(500)` blob
- **Impression rotation** — when all matching cards have been seen, `query_pool_cards` falls back to serving least-recently-seen cards instead of returning empty and triggering Google API fallback
- **Haversine travel estimation** — Discover page uses haversine distance + speed-based estimation instead of Google Distance Matrix API for travel time hints
- **Warm pool deduplication** — module-level timestamp prevents redundant warm pool calls when onboarding fires one within 30 seconds of RecommendationsContext mount
- Background gap-fill populates pool asynchronously after pool-serve responses
- 12-second server-side response deadline prevents client timeout cascade
- "Generate More" fallback via GPT-4o-mini + Google Places API
- 5-factor scoring algorithm (category match, tag overlap, popularity, quality, text relevance)
- Proximity-optimized stop pairing for curated cards (3km/5km/closest)
- AI summary generation for birthday hero cards
- AI-generated teaser text for locked curated cards (no place names revealed)

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
- Push notifications via OneSignal (FCM v1 + APNs) routed through notify-dispatch

### Additional Features

- GPS and manual location with travel time preferences (custom location is a Pro+ feature)
- Holiday planning with custom holidays, archiving, and pool-first card sourcing with shuffle
- Post-experience reviews with star ratings and voice recordings
- Device calendar export
- Boards with card voting, RSVP, iMessage-style discussion (emoji reactions, photo attachments, typing indicators, read receipts, @mentions, #card-tags)
- Universal deep links via usemingla.com with unified deep link parser (`deepLinkService.ts`)
- Night Out section powered by Ticketmaster
- Navigation state persistence across process death
- **Stale-while-revalidate caching** — deck cards, saved cards, and calendar entries persist to AsyncStorage for instant-on startup (returning users see cached data in <100ms, background refetch updates silently)
- **Adjacent-screen prefetching** — Discover data and friends list prefetched while idle on Home tab; tab switches feel instant
- **Edge function warming** — `keep-warm` cron job pings 6 critical functions every 5 minutes, eliminating 5-10s cold starts
- **3-tier resume optimization** — trivial backgrounds (<5s) skip query invalidation entirely; short backgrounds (5-30s) invalidate critical queries; long backgrounds (>=30s) add auth refresh + WebSocket reconnection
- **Server-side realtime filtering** — social subscriptions filter at database level (messages by receiver_id, pairings by user_a_id/user_b_id) instead of receiving all events and filtering client-side
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
| `profiles` | User profiles: phone, referral_code, gender, birthday, country, preferred_language, bio, avatar_url, visibility_mode, timezone |
| `preferences` | User preference settings (categories, price tiers, intents, travel) |
| `subscriptions` | Subscription tier, trial, referral bonus months |
| `daily_swipe_counts` | Per-user daily swipe tracking for free-tier rate limiting. Atomic upsert via `increment_daily_swipe_count()` |

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
| `user_visits` | Confirmed place visits with card snapshot, source tracking, and paired-user read access |

### Chat & Presence Tables

| Table | Purpose |
|-------|---------|
| `conversation_presence` | Per-user, per-conversation online status with heartbeat timestamps |

### Notification Tables

| Table | Purpose |
|-------|---------|
| `notifications` | Server-side authoritative notification storage. Columns include user_id, type (30+ types), title, body, data (JSONB for deep links and metadata), read status, action state (pending/accepted/declined), idempotency_key, created_at. Synced to clients via Supabase Realtime subscription. This is the single source of truth for all in-app notifications. |
| `notification_preferences` | Per-user granular notification toggles by type, quiet hours enabled/start/end, and `dm_bypass_quiet_hours` column for allowing DM notifications to bypass quiet hours |
| `user_push_tokens` | Legacy Expo push tokens (unused — OneSignal manages tokens internally) |

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
| `card_pool` | Enriched place cards with curated `stopsData` JSONB and `teaser_text` for locked card overlays |
| `place_pool` | Place data pool from Google Places |
| `user_card_impressions` | Tracks which cards users have seen (discover/swipe) |
| `person_card_impressions` | Tracks shown cards per saved person (hero cards + holiday rows) |
| `ticketmaster_events_cache` | Cached Ticketmaster events (2-hour TTL) |
| `discover_daily_cache` | Cached discover feed results |
| `curated_places_cache` | Cached curated experience places |

### Key SQL Functions (Tier Gating)

| Function | Purpose |
|----------|---------|
| `get_effective_tier(user_id)` | Returns 'free', 'pro', or 'elite' based on RC sync + trial + referral |
| `get_tier_limits(tier)` | Returns JSONB with all tier limit constants |
| `increment_daily_swipe_count(user_id)` | Atomic upsert of daily swipe counter |
| `get_remaining_swipes(user_id)` | Returns remaining swipes, limit, used count, reset time |
| `check_session_creation_allowed(user_id)` | Returns whether user can create another session |
| `check_pairing_allowed(user_id)` | Returns whether user can pair (Elite only) |
| `get_session_member_limit(user_id)` | Returns max participants for new sessions |
| `update_user_preferences_from_interaction()` | Trigger: extracts category, price_tier, time_of_day, distance_bucket from user_interactions. Weighted by interaction type (visit=0.35 highest). |

### Cron Jobs (pg_cron)

| Job | Purpose |
|-----|---------|
| `keep-warm` | Pings 6 critical edge function isolates every 5 minutes to eliminate cold starts |
| `notify-calendar-reminder` | Fires calendar reminders: tomorrow previews, day-of reminders, and post-event feedback prompts |
| `notify-lifecycle` | Fires lifecycle notifications: onboarding incomplete nudges, trial ending warnings, re-engagement after inactivity, weekly digest |
| Notification cleanup | Purges read notifications older than 90 days to keep the table lean |

---

## Edge Functions

### Experience Generation

| Function | Purpose |
|----------|---------|
| `generate-experiences` | AI-powered place recommendations |
| `new-generate-experience-` | Next-gen experience generation with card pool pipeline |
| `generate-curated-experiences` | Multi-stop itinerary generation with AI teaser text for locked display |
| `get-personalized-cards` | Personalized card retrieval based on swipe data |
| `get-person-hero-cards` | Pool-first card serving for person hero section and holiday rows. Supports `mode: "default" \| "shuffle" \| "bilateral"` with multi-dimension preference blending (category, price tier, distance), confidence thresholds, and custom holiday 50/50 blend |
| `get-holiday-cards` | Holiday card sourcing, primarily for "Generate More" requests via GPT-4o-mini |
| `generate-ai-summary` | AI birthday/gift summary via GPT-4o-mini (~80 char) with occasion-aware suggestions |
| `generate-holiday-categories` | AI-generated 6-category slot sets for holidays via GPT-4o-mini |
| `discover-experiences` | Explore/discover tab |
| `discover-cards` | Discover card generation with swipe limit enforcement and curated card stripping for free users |
| `generate-session-deck` | Server-side synchronized deck generation for collaboration sessions |
| `discover-[category]` | Per-category discover endpoints (12 functions) |
| `holiday-experiences` | Holiday-specific experience generation |
| `refresh-place-pool` | Daily card pool refresh |
| `warm-cache` | Pre-stocks place_pool + card_pool for frequently accessed locations |
| `keep-warm` | Cron-driven ping to keep 6 critical function isolates warm (every 5 min) |

### Social and Notifications

| Function | Purpose |
|----------|---------|
| `lookup-phone` | Phone number lookup for friend search |
| `search-users` | Username-based user search |
| `send-phone-invite` | Validate phone, create pending invite, send SMS via Twilio |
| `send-friend-request-email` | Friend request notification — routes through `notify-dispatch` for preference checks, quiet hours, and push delivery |
| `send-friend-accepted-notification` | Friend acceptance notification — routes through `notify-dispatch` for preference checks, quiet hours, and push delivery |
| `send-collaboration-invite` | Session invite notification — routes through `notify-dispatch` for preference checks, quiet hours, and push delivery |
| `notify-invite-response` | Invite response notification — routes through `notify-dispatch` for preference checks, quiet hours, and push delivery |
| `send-message-email` | Push notification for new direct messages |
| `send-pair-request` | Handles all 3 pairing tiers with Elite-only tier gating — routes through `notify-dispatch` for preference checks, quiet hours, and push delivery |
| `notify-pair-request-visible` | Hidden pair request revealed notification — routes through `notify-dispatch` for preference checks, quiet hours, and push delivery |
| `process-referral` | Referral credit reconciliation + push notification |
| `notify-dispatch` | Unified notification dispatch: preference checks, quiet hours (timezone-aware 10 PM - 8 AM), rate limiting, idempotency, push delivery via OneSignal, and server-side `notifications` table insert for Realtime sync |
| `notify-message` | DM and board message notifications with rate-limited batching to prevent notification storms during active conversations |
| `notify-calendar-reminder` | Cron-driven calendar reminders: tomorrow preview, day-of reminder, and post-event feedback prompt |
| `notify-lifecycle` | Cron-driven lifecycle notifications: onboarding incomplete nudge, trial ending warning, re-engagement after inactivity, weekly digest |
| `notify-pair-activity` | Paired user activity notifications: partner saved a card, partner visited a place |
| `notify-referral-credited` | Referral reward notification fired via pg_net trigger when a referral credit is recorded |

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
| `get-paired-saves` | Paginated paired user's saved cards with category filtering and pairing verification |
| `record-visit` | Records visit + triggers preference learning (weight 0.35). Upserts user_visits, inserts user_interactions |
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

### RevenueCat (configured in-code)

The RevenueCat API key is configured directly in `app-mobile/src/services/revenueCatService.ts`. Replace the test key with production keys before launch. Product IDs (`mingla_pro_weekly`, `mingla_pro_monthly`, `mingla_pro_annual`, `mingla_elite_weekly`, `mingla_elite_monthly`, `mingla_elite_annual`) must be configured in the RevenueCat dashboard and linked to App Store Connect / Google Play Console products.

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

# 7. Configure RevenueCat products in dashboard
#    Create 6 products, map to entitlements, set up offerings

# 8. Start Expo
npx expo start

# 9. Test on physical device (Android/iPhone)
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

- **Notifications System V2** — Server-side authoritative notification system with 30+ types, unified `notify-dispatch` edge function (preference enforcement, quiet hours, rate limiting, idempotency), redesigned notification center with filter tabs and action buttons, Supabase Realtime subscription for instant delivery, deep link navigation from push and in-app taps, and cron-driven calendar reminders and lifecycle nudges. 6 new edge functions, 3 new migrations, `useNotifications` hook, `deepLinkService`, and `notifications` + `notification_preferences` tables.
- **Preference Intelligence System** — Multi-dimensional preference learning (category, price tier, time of day, distance), visit confirmation ("I went here"), paired saves/visits sharing, bilateral matching toggle, learning indicator toasts, and personalized badge.
- **Monetization tier gating** — Full feature gating across Free/Pro/Elite tiers for curated cards, starting point, swipes, pairing, and collaboration sessions with dual-layer enforcement (client + server), custom branded paywall, and RevenueCat integration
- **Performance overhaul** — Zero-wait app experience via stale-while-revalidate caching, adjacent-screen prefetching, image prefetching, edge function warming, 3-tier resume debounce, server-side realtime filtering, and 40-60% smaller card payloads

---

## License

This project is proprietary. All rights reserved.
