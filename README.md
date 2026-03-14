# Mingla

Mingla is a mobile app for planning social outings -- combining pool-first card serving, real-time collaboration, and a card-based swipe interface to help users discover and plan experiences with friends.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Mobile | React Native (Expo), TypeScript |
| Server State | React Query |
| Client State | Zustand |
| Backend | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| Edge Functions | 50 Deno serverless functions |
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
| Dev Telemetry | Full-firehose activity tracker with domain-tagged logging (`__DEV__` only) |

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
│   │   │   ├── profile/               # ProfileHeroSection, InterestsSection, Toggle, SettingsRow, EditProfileSheet, EditBioSheet, EditInterestsSheet
│   │   │   ├── chat/                   # MessageBubble, ChatStatusLine, TypingIndicator
│   │   │   ├── discussion/            # Board discussion components (MessageBubble, TypingIndicator, EmojiReactionPicker, SuggestionPopup, EmptyDiscussion)
│   │   │   └── ui/                     # Shared UI primitives
│   │   ├── hooks/                      # ~62 React Query hooks + realtime hooks
│   │   ├── services/                   # ~74 service files
│   │   ├── contexts/                   # 3 React contexts
│   │   ├── store/                      # Zustand store (appStore)
│   │   ├── types/                      # TypeScript types
│   │   ├── constants/                  # Design tokens, config, categories, holidays
│   │   └── utils/                      # ~25 utility files
│   ├── app.json
│   ├── eas.json
│   └── package.json
│
├── supabase/
│   ├── functions/                      # 50 Deno edge functions
│   │   ├── _shared/                   # Shared edge function utilities
│   │   ├── send-phone-invite/         # Phone invite SMS via Twilio
│   │   └── [function-name]/           # Individual edge functions
│   ├── migrations/                    # SQL migration files
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

**Step 5 -- Social** -- friends, consent, collaboration session management, then choose a path:
- **Friends** (OnboardingFriendsStep) -- Interactive phone input to add friends or invite non-users to the platform. Incoming pending friend requests are displayed above the phone input with accept/decline buttons, haptic feedback, and visual feedback animations. Accepting a friend request triggers the DB trigger that reveals hidden collaboration invites. No longer auto-skipped.
- **Consent** (OnboardingConsentStep) -- Interactive step with explicit data consent. No longer auto-skipped.
- **Path A (Sync):** Select friends to sync with, record audio descriptions. Audio is transcribed via Whisper, analyzed by GPT-4o-mini, and used to generate personalized experience cards. Saved people entries are created for every synced friend regardless of audio.
- **Path B (Add person):** Streamlined 4-step flow: Name, birthday, gender, then confirm. The confirmation step features warm personal copy, staggered entrance animations, and an "Add to my people" CTA. No audio recording -- cards are served instantly from the pool.
- **Skip:** Goes straight to the app.

### Profile Page

The profile page is a clean, modern single-scroll experience with 5 sections and inline editing via bottom sheets. No sub-screens -- all editing happens from the profile page itself.

- **ProfileHeroSection** -- 104px avatar with initials gradient fallback and camera badge, display name, @username, location with refresh, bio display (tappable to edit via EditBioSheet), and profile completion hints
- **ProfileInterestsSection** -- Displays user intents (filled orange pills) and categories (outlined pills). Tappable pencil icon opens the EditInterestsSheet
- **ProfileStatsRow** -- 3-column stats display: Saved count, Friends count, Boards count. Each stat is tappable for navigation
- **Settings Section** -- Notifications toggle, Profile Visibility cycling (Friends Only / Everyone / Nobody), Show Activity toggle. Uses shared Toggle and SettingsRow components
- **Account Section** -- Edit Profile (opens EditProfileSheet bottom sheet for name, username, bio), Replay Tips, Account settings navigation
- **EditProfileSheet** -- Bottom sheet for editing first name, last name, username (with real-time sanitization), and bio (160 char max)
- **EditBioSheet** -- Bottom sheet modal with multiline text input, 160-character limit with counter
- **EditInterestsSheet** -- Bottom sheet modal for multi-selecting intents and categories
- **Toggle** -- Shared animated toggle component with haptic feedback, used by all toggle rows
- **SettingsRow** -- Reusable row component handling toggle, value-cycling, and navigation row variants

The profile also includes legal links (Privacy Policy, Terms of Service) and sign out.

### View Friend Profile

Tapping a friend's avatar in the connections list opens their full profile as an overlay screen. Shows their hero section, interests, stats, a message button, and a remove friend option. Access is controlled by 3 RLS policies that enforce visibility based on the friend's `visibility_mode` setting. Private profiles show a "This profile isn't available" error state.

### Pairing (Replaces Saved People)

Pairing replaces the manual Saved People system. Instead of recording voice descriptions and relying on AI to generate experience suggestions, users pair with real people and their actual behavior data (swipes, saves, visits) drives personalization.

**3-Tier Pairing System:**
- **Tier 1 (Friend):** Send a direct pair request to any Mingla friend. Push + in-app notification. Pill shows at full opacity with "Pending" badge.
- **Tier 2 (Mingla, not friend):** Enter phone number of a Mingla user. Creates friend request + hidden pair request. Receiver sees friend request first. When friendship accepted, DB trigger (`reveal_pair_requests_on_friend_accept`) flips pair request visibility and fires push notification. Sender sees greyed-out pill ("Waiting for friend request").
- **Tier 3 (Not on Mingla):** Enter phone number of non-Mingla user. SMS invite sent. When person signs up and verifies phone, DB trigger auto-creates both friend request + hidden pair request. Same chain as Tier 2 from there. Sender sees greyed-out pill ("Waiting to join").

**Pill States on Discover:**
- `active` — Full color, tappable, shows PersonHolidayView with hero cards and holidays
- `pending_active` — Full opacity + "Pending" badge (Tier 1: friend, awaiting pair accept)
- `greyed_waiting_friend` — 40% opacity (Tier 2: waiting for friend accept)
- `greyed_waiting_pair` — 40% opacity (Tier 2: friend accepted, waiting for pair accept)
- `greyed_waiting_signup` — 40% opacity (Tier 3: waiting for person to join Mingla)

**PairingInfoCard:** Tapping a greyed/pending pill shows a bottom sheet with status message + "Cancel Pair Request" button.

**PersonHolidayView (for active pairings):**
- Birthday hero card with countdown and days away
- Holiday rows sorted by proximity, gender-filtered, with pool-first hero card fetching via `get-person-hero-cards` (now blends the paired user's learned preferences from `user_preference_learning` with holiday categories)
- Custom holidays tied to the pairing (CASCADE deleted on unpair)
- Swipe-to-archive on holiday rows

**Unpair:** Long-press active pill → confirmation → deletes pairing + CASCADEs to custom holidays, archived holidays, and card impressions.

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
- Push-to-in-app notification pipeline for friend requests and friend acceptances (with foreground `friend_request` and `friend_accepted` push handling and deduplication against polling) and collaboration invites. Both friend request and acceptance push notifications respect `notification_preferences`.
- Realtime subscriptions for `pending_invites`, `saved_people`, `messages`, `friends`, and `calendar_entries` tables
- `lookup-phone` checks `friends` and `friend_requests` tables for friendship/pending status

### AI-Powered Recommendations
- Pool-first card serving: hero cards and holiday cards are sourced directly from the `card_pool` table by location and categories, delivering results in under 1 second
- "Generate More" fallback: GPT-4o-mini generates deeper recommendations beyond the pool, using Google Places API for fresh data
- Audio-to-recommendations pipeline (onboarding only): voice notes transcribed (Whisper), analyzed (GPT-4o-mini), used to generate personalized experience cards
- Card pool data pipeline: pool-first serving, falls back to Google Places API for "Generate More" requests
- 5-factor scoring algorithm ranks cards by category match, tag overlap, popularity, quality, and text relevance
- AI summary generation for birthday hero cards via `generate-ai-summary` edge function
- Proximity-optimized stop pairing: consecutive stops on curated cards are proximity-chained (3km -> 5km -> closest fallback) so users spend time enjoying the experience, not traveling between distant locations. Applies to adventurous, first-date, romantic, friendly, and group-fun intents
- Full curated card data pipeline: edge functions pass complete stop data (`stopsData`) through to mobile, enabling multi-stop timeline rendering in the ExpandedCardModal with per-stop name, image, duration, and price

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
- Friendship is a prerequisite for collaboration session **activation** but not **creation**. Non-friends can be invited to sessions -- a hidden invite is created with `pending_friendship=true`, and a friend request is sent simultaneously. When the friend request is accepted, the invite auto-reveals. If declined, the invite is cancelled and empty sessions are deleted.
- **Atomic friend operations:** Friend accept and removal use PostgreSQL RPC functions (`accept_friend_request_atomic`, `remove_friend_atomic`) that wrap all DB operations in a single transaction -- no split state between `friend_requests` and `friends` tables is possible. The accept RPC returns revealed collaboration invite IDs deterministically from within the same transaction, eliminating timing-window race conditions.
- **Defense-in-depth friendship check:** Session creation checks both `friends` table (primary) and `friend_requests` table (fallback) to handle any historical desync.
- Unified session creation flow via `CreateSessionContent` component (embedded in CollaborationModule's Create tab, also available standalone)
- Named sessions with multi-friend selection via `FriendSelectionModal`
- Phone number invites: invite friends by phone number, non-friends get a friend request first, non-platform users get an SMS invite via Share sheet with auto-conversion on signup (DB triggers handle the full pending -> converted pipeline for both friend invites AND session invites)
- **Phone invite catch-up push:** When a new user signs up and verifies their phone, freshly converted invites (< 60s old) trigger a system push notification in addition to the in-app notification.
- JWT-validated invite edge function prevents impersonation
- **Notification preferences enforced:** Both `send-collaboration-invite` and `notify-invite-response` edge functions check `notification_preferences.collaboration_invites` before sending push -- respects user opt-out settings.
- Real-time card swiping, voting (with synchronous double-tap guard), RSVP, lock-in, calendar sync, and chat
- Union-based preference aggregation: all participants' categories, intents, and price tiers are merged; budget uses widest range; travel mode uses deterministic majority vote (alphabetical tie-break); travel time uses median; datetime uses earliest; location uses midpoint
- Server-side synchronized deck generation: a single canonical deck is generated per session and stored in `session_decks`, ensuring all participants see identical cards in identical order
- Idempotent preference seeding (upsert) on invite acceptance -- safe against double-accept race conditions
- Auto-copy of solo preferences to collaboration sessions on invite acceptance and onboarding completion
- Push notifications for collaboration invites via OneSignal (awaited with error logging)
- Realtime deck refresh: when any participant updates preferences, a new deck is generated and all clients are notified via Supabase Realtime
- Realtime invite status: InvitesTab auto-refreshes via Supabase Realtime subscription when invites are created, accepted, or cancelled
- **Consolidated realtime subscriptions:** Session management uses a single realtime channel in index.tsx for pill bar updates; CollaborationModule maintains its own channel for modal-specific data. Redundant duplicate subscription eliminated.
- Session status loading guard: action buttons (Start Voting, Mark Complete) only render after status is confirmed from DB -- prevents premature actions on pending sessions
- **Concurrent board creation protection:** DB-level partial unique index on `collaboration_sessions.board_id` (non-null values only) prevents duplicate boards. App-side optimistic locking (`.is('board_id', null)`) ensures only one accept creates the board; the loser cleans up its orphaned board immediately.
- Consensus lock-in with auto calendar entries
- Realtime sync via Supabase Realtime (collaboration_invites, collaboration_sessions, session_participants all published to supabase_realtime)
- In-app notification catch-up mechanism: on foreground resume and after friend request acceptance, pending invites are queried and notifications are created for any missed while the app was in background/killed or newly revealed by the friend acceptance trigger, with deduplication via ref-tracked invite IDs
- **Industry-standard foreground recovery:** Centralized `useForegroundRefresh` hook is the single authority for resume-triggered query work. React Query's `focusManager` is explicitly disabled to prevent uncontrolled, auth-unvalidated refetches. On resume: auth session is validated with 8-second timeout, then all critical React Query caches are invalidated for background refresh. Short backgrounds (< 30 seconds) skip auth and query invalidation entirely. Cached data remains visible during refresh -- no spinner on resume when cached data exists. Network timeout is 12 seconds (industry standard), worst-case spinner capped at 25 seconds instead of permanent hang. Resume safety timeout re-arms on every background resume to cap spinner at 10 seconds.
- **Memoized pill bar data:** `collaborationSessions` array is memoized via `useMemo` to prevent unnecessary re-renders of the `CollaborationSessions` pill bar.

### Subscription System
- Free, Pro, and Elite tiers with 1-week trial
- Referral bonus months for inviting friends
- Stripe Connect payment processing

### Console Telemetry & Breadcrumb Trail (Dev Only)

A `__DEV__`-only full-firehose activity tracker that logs every user interaction, state change, background process, network call, realtime event, push notification, and lifecycle event to the Metro terminal with color-coded domain prefixes. Every log line starts with a domain tag -- `[TAP]`, `[NAV]`, `[STORE]`, `[EDGE]`, `[REALTIME]`, `[PUSH]`, `[LIFECYCLE]`, `[QUERY]`, `[MUTATION]` -- so you can scan or search by category instantly. All logs also record breadcrumbs into a 30-entry ring buffer that dumps on errors.

- **TrackedTouchableOpacity / TrackedPressable** -- Drop-in replacements for TouchableOpacity and Pressable that auto-log taps with label resolution (logId > accessibilityLabel > testID > child text > "(unlabeled)")
- **Zustand devLogger middleware** -- Intercepts every `set()` call on the app store, computes a diff of changed keys (skipping functions), and logs `[STORE] set(key) | changed={...}` with summarized values. Zero-cost in production.
- **trackedInvoke wrapper** -- Drop-in replacement for `supabase.functions.invoke()` that logs `[EDGE] → functionName` on call and `[EDGE] ← functionName OK/ERROR Nms` on response with full request/response bodies. Migrated in the 5 most active services.
- **Realtime channel logging** -- Every `.on()` handler in `realtimeService.ts` logs `[REALTIME] channelId | eventType | payload`. Subscribe/unsubscribe lifecycle events are logged.
- **Push notification logging** -- OneSignal login, permission, foreground receive, and notification tap events all log via `[PUSH]` domain.
- **React Query global callbacks** -- QueryCache `onSuccess` logs `[QUERY] success key`, MutationCache `onMutate`/`onSuccess`/`onError` logs `[MUTATION] start/success/ERROR key`.
- **Lifecycle hook** -- `useLifecycleLogger()` logs app foreground/background transitions, keyboard show/hide with height, memory warnings (iOS), and network connectivity changes.
- **Breadcrumb ring buffer** -- Stores last 30 user actions with `breadcrumbs.add()` / `breadcrumbs.dump()`
- **Auto-dump on errors** -- `logger.error()`, query/mutation failures, and ErrorBoundary catches all trigger breadcrumb dumps
- **Screen transition logging** -- `useScreenLogger()` hook logs `[NAV] home -> discover` on every screen change
- **Button tracking** -- The design system `Button` component auto-logs taps without replacing its base TouchableOpacity
- **Zero production overhead** -- All logging is gated behind `__DEV__` with early returns on hot paths
- **logger.render() excluded** -- Render logs are deliberately excluded from breadcrumbs to prevent 60fps noise from flushing real user actions

### Native UX
- **Pull-to-refresh** on SavedTab, CalendarTab, DiscoverScreen, and ConnectionsPage
- **Haptic feedback** on all interactive buttons (buttonPress, success, warning, error, selection patterns)
- **Duplicate mutation guards** -- isPending checks prevent double-tap on accept/decline/send buttons
- **Push notifications** -- OneSignal handles all push delivery (FCM v1 + APNs), token management, and device registration. Edge functions target users by Supabase UUID via OneSignal REST API

### Additional Features
- GPS and manual location with travel time preferences
- Audio-to-recommendations pipeline for onboarding sync path (Whisper transcription + GPT-4o-mini interest extraction)
- Holiday planning with custom holidays, archiving, and pool-first card sourcing with shuffle
- Shuffle mechanic on hero cards and holiday rows -- fade-out/fade-in animation, no-repeat guarantee via impression tracking
- Post-experience reviews with star ratings and voice recordings
- Device calendar export
- Boards with card voting, RSVP, iMessage-style discussion (inverted FlatList, emoji reactions, photo attachments, typing indicators, read receipts, @mentions, #card-tags)
- Universal deep links via usemingla.com
- Night Out section powered by Ticketmaster

---

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles: phone, referral_code, gender, birthday, country, preferred_language, bio, avatar_url, show_activity, visibility_mode. Legacy `photos` TEXT[] column retained but unused by app |
| `preferences` | User preference settings (categories, price tiers, intents, travel) |
| `subscriptions` | Subscription tier, trial, referral bonus months |

### Push Notifications

| Table | Purpose |
|-------|---------|
| `user_push_tokens` | Legacy Expo push tokens (unused -- OneSignal manages tokens internally). Retained as safety net. |

### Social Tables

| Table | Purpose |
|-------|---------|
| `friend_requests` | Friend request lifecycle with RLS. Atomic accept via `accept_friend_request_atomic` RPC. |
| `friends` | Bidirectional friendship records (user_id, friend_user_id, status). Atomic removal via `remove_friend_atomic` RPC. |
| `blocked_users` | User blocks |
| `pending_invites` | Phone invites for non-app users (auto-converts to friend_requests on signup) |
| `pending_session_invites` | Collaboration session invites for non-app users |
| `referral_credits` | Referral credit audit log |

### Chat & Presence Tables

| Table | Purpose |
|-------|---------|
| `conversation_presence` | Per-user, per-conversation online status with heartbeat timestamps. Auto-update trigger on row modification. Stale presence cleanup function. |

### Pairing Tables

| Table | Purpose |
|-------|---------|
| `pair_requests` | Pair request lifecycle across 3 tiers. Columns: `visibility` ('visible'\|'hidden_until_friend'), `gated_by_friend_request_id` (FK for Tier 2/3 chaining), `pending_display_name`, `pending_phone_e164`. Atomic accept via `accept_pair_request_atomic` RPC. |
| `pairings` | Active bidirectional pairings. `user_a_id < user_b_id` constraint prevents duplicates. CASCADE deletes to custom_holidays, archived_holidays, person_card_impressions. |
| `pending_pair_invites` | Tier 3 phone invites for non-Mingla users. Auto-converts to friend_request + pair_request on phone verification via DB trigger. |

### People & Experiences Tables (Legacy + Pairing)

| Table | Purpose |
|-------|---------|
| `saved_people` | Legacy saved people (deprecated — replaced by pairings) |
| `custom_holidays` | User-created holidays. Now linked to pairings via `pairing_id` and `paired_user_id` columns (legacy `person_id` retained for backward compat) |
| `archived_holidays` | Tracks which holidays a user has archived. Now supports `pairing_id` and `paired_user_id` columns |
| `person_card_impressions` | Tracks which cards each paired person has been shown. Now supports `paired_user_id` column |

### Collaboration Tables

| Table | Purpose |
|-------|---------|
| `collaboration_sessions` | Collaboration session records |
| `collaboration_invites` | Session invite records (canonical columns: `inviter_id`, `invited_user_id`, `pending_friendship` boolean default false -- controls invite visibility until friendship is established) |
| `session_participants` | Session participant records |
| `boards` | Collaboration boards |
| `board_messages` | Discussion messages per session (content, image_url, mentions, reply_to_id) |
| `board_message_reads` | Read receipts (message_id, user_id, read_at) |
| `board_message_reactions` | Emoji reactions per message (message_id, user_id, emoji with unique constraint) |
| `board_session_preferences` | Per-session preference settings (auto-seeded from solo preferences) |
| `session_decks` | Canonical server-generated decks per session (JSONB cards, preferences hash, 24h expiry, RLS for participants) |

### Pipeline Tables

| Table | Purpose |
|-------|---------|
| `card_pool` | Enriched place cards shared across users. Curated cards include full `stopsData` JSONB with per-stop details (name, image, duration, price). |
| `place_pool` | Place data pool from Google Places |
| `user_card_impressions` | Tracks which cards users have seen (discover/swipe) |
| `person_card_impressions` | Tracks which cards each saved person has been shown (hero cards + holiday rows), enabling no-repeat shuffle and "Generate More" exclusions |
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
| `send-pair-request` | Handles all 3 pairing tiers: friend (Tier 1), Mingla non-friend via phone (Tier 2), non-Mingla via SMS invite (Tier 3). Auto-detects tier from input. |
| `notify-pair-request-visible` | Sends push + in-app notification when a hidden pair request becomes visible (after friend request acceptance) |
| `get-personalized-cards` | Personalized card retrieval based on swipe data |
| `get-person-hero-cards` | Pool-first card serving for person hero section and holiday rows. Now accepts `pairedUserId` to blend the paired user's learned preferences (`user_preference_learning`) with holiday categories. Queries `card_pool` directly by location + blended categories using `query_person_hero_cards` DB function with progressive radius expansion. Tracks impressions in `person_card_impressions` (via `paired_user_id` column). Sub-second response time. |
| `get-holiday-cards` | Holiday card sourcing -- now primarily used for "Generate More" requests (`generate_more` mode with GPT-4o-mini for deeper AI-generated suggestions excluding already-seen IDs). Uses shared `mapPoolCardToResponseCard` helper to build consistent card responses across all modes (replacing 3 previous inline card builders). Returns full `stopsData`, `estimatedDurationMinutes`, `experienceType`, `categories`, and `shoppingList` on every card. Legacy `holiday` and `hero` modes still available but superseded by `get-person-hero-cards` for default card loads. |
| `generate-ai-summary` | AI birthday/gift summary via GPT-4o-mini (~80 char). Extended with optional `customDayName`/`customDayYear` fields for occasion-aware suggestions that reference both the person and the special day |
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
| `send-friend-request-email` | Push notification for friend requests (via OneSignal). Checks `notification_preferences` before sending. |
| `send-friend-accepted-notification` | Push notification when a friend request is accepted (via OneSignal). Notifies the original sender. Checks `notification_preferences` before sending. |
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

- **Pairing Feature (replaces Saved People)** -- 3-tier pairing system: pair with friends (Tier 1), Mingla users via phone (Tier 2), or invite non-Mingla users (Tier 3). Chained friend request → pair request flow with DB triggers for automatic reveal and push notifications. Greyed-out pills with status info for pending pairings. Hero cards blend paired user's learned preferences with holiday categories.
- **Database: 6 new migrations** -- pair_requests, pairings, pending_pair_invites tables + atomic accept RPC + data access policies + cleanup of person_audio_clips/person_experiences tables.
- **Edge Functions: 2 new, 2 removed** -- Added send-pair-request (all 3 tiers) and notify-pair-request-visible. Removed process-person-audio and generate-person-experiences (replaced by real behavior data).
- **Mobile: Full UI overhaul** -- PairRequestModal (friend picker + phone input), PairingInfoCard (status overlay), DiscoverScreen pill rendering (5 visual states), PersonHolidayView (pairedUserId-based), NotificationsModal (pair_request accept/decline).
- **Realtime: pair_requests + pairings subscriptions** -- useSocialRealtime now subscribes to pair_requests and pairings tables for instant cache invalidation.

---

## License

This project is proprietary. All rights reserved.
