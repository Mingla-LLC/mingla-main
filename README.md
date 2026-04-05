# Mingla

Discover experiences, plan with friends.

A monorepo mobile + admin platform for social discovery -- combining an interactive map, pool-first card serving, real-time collaboration, and a swipe interface to help users find and plan experiences together.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Mobile | React Native (Expo), TypeScript strict |
| Server State | React Query |
| Client State | Zustand |
| Backend | Supabase (PostgreSQL + Auth + Realtime + Storage + Edge Functions + RLS) |
| Edge Functions | ~71 Deno serverless functions |
| AI | OpenAI GPT-5.4-mini (card quality gate with web search), GPT-4o-mini (AI reasons), Whisper (audio transcription) |
| Maps & Places | Google Maps (CartoDB Positron tiles -- clean barren map, faint roads, city names only, no POIs), Google Places API (New) |
| Live Events | Ticketmaster Discovery API v2 |
| SMS | Twilio (OTP verification + Programmable Messaging for invites) |
| Email | Resend (admin email sending) |
| Payments | RevenueCat (subscription management) + Stripe Connect |
| Push Notifications | OneSignal (FCM v1 + APNs) |
| Analytics | Mixpanel (event tracking, user identification) |
| Admin Dashboard | React 19, Vite, Tailwind CSS v4, Framer Motion, Recharts, Leaflet |
| Navigation | Custom state-driven (no React Navigation) |
| Styling | StyleSheet only (no inline styles) |
| SVG | react-native-svg |
| Network State | expo-network (React Query onlineManager integration) |
| Dev Telemetry | Full-firehose activity tracker with domain-tagged logging (`__DEV__` only) |

---

## Architecture Constitution

**These are non-negotiable. Every change to this codebase must satisfy them. Violations require explicit justification in the PR/commit or they are rejected.**

1. **No dead taps.** No primary interaction may wait on non-critical network work before visible UI response. Show UI first, fetch after.

2. **One owner per truth.** Every important domain fact has one authoritative owner. If you need a second cache, document why and how it syncs.

3. **No silent failures.** No state-changing action may fail silently. Every mutation has an `onError` handler. Every service catch block logs.

4. **One key per entity.** One entity family uses one query-key factory. All mutations invalidate via the factory's `all` prefix.

5. **Server state stays server-side.** Server-authoritative state is not persisted locally unless there is a documented offline contract.

6. **Logout clears everything.** Logout must clear all private local data -- React Query, Zustand, AsyncStorage, in-memory queues, realtime channels.

7. **Label what's temporary.** Transitional fixes must be labeled `[TRANSITIONAL]` and tracked in `docs/TRANSITIONAL_ITEMS_REGISTRY.md` with an owner and exit condition.

8. **Subtract before adding.** When fixing an ownership or consistency issue, remove the competing path -- don't add a sync layer on top.

9. **No fabricated data.** Never render hardcoded fallback values as if they were real data. Missing data = hidden or "--". A fake "4.5" rating is worse than no rating.

10. **Currency-aware everywhere.** Every price display must use the user's currency via `useLocalePreferences()` or prop-threaded `currency`. No hardcoded `$` symbols.

11. **One auth instance.** Only one component may call `useAuthSimple()` -- the root AppStateManager. All other components read auth state from `useAppStore()` or receive it via props. Duplicate auth instances cause racing token refreshes that break Android.

12. **Validate at the right time.** Schedule validation checks the selected time, not the current time. Any time-dependent validation must use the user's chosen datetime, not `new Date()`.

13. **Exclusions must be consistent across all card-serving paths.** Every card-serving function (discover-cards, discover-experiences, generate-curated-experiences) must apply the same exclusion filters: global type exclusions, per-category type exclusions, AND venue name keyword exclusions (`isChildVenueName`). Check the full `types` array, not just `primary_type`.

14. **Prefer persisted state for instant startup.** On cold start, use Zustand-persisted state (profile, preferences, saved cards) to render immediately. Refresh from server in background. Gate on `_hasHydrated`, not network responses.

### Supporting Documents

| Document | Purpose |
|----------|---------|
| [`docs/DOMAIN_ADRS.md`](docs/DOMAIN_ADRS.md) | Source of truth per domain (block state, subscriptions, saved cards, notifications, preferences, service errors) |
| [`docs/IMPLEMENTATION_GATES.md`](docs/IMPLEMENTATION_GATES.md) | Pre-code checklist every implementor must complete |
| [`docs/MUTATION_CONTRACT.md`](docs/MUTATION_CONTRACT.md) | Standard for all state-changing operations |
| [`docs/QUERY_KEY_REGISTRY.md`](docs/QUERY_KEY_REGISTRY.md) | Canonical query key shapes and invalidation rules |
| [`docs/TRANSITIONAL_ITEMS_REGISTRY.md`](docs/TRANSITIONAL_ITEMS_REGISTRY.md) | Temporary solutions tracker with owners and exit conditions |

---

## Behavioral Contracts

Verified behaviors from the launch hardening session. These are load-bearing -- do not change without understanding the full chain.

### Preferences -> Deck Contract
- On preference change (solo): optimistic cache updated immediately, deck resets via preferencesRefreshKey bump, new cards fetched with new preferences. No invalidateQueries race -- AppHandlers is the single owner.
- On preference change (collab): board_session_preferences updated in DB, session deck query invalidated via `queryClient.invalidateQueries(['session-deck', sessionId])`.
- Stale batch rejection: cached deck batches include prefsHash. On cold start, batches with non-matching hash are rejected (safe migration for old batches without hash).

### Save Contract
- On swipe-right: card removed from deck (optimistic), save fires.
  - Success: card stays removed, toast shown.
  - Failure: card rolls back into deck (removedCards Set delete), Alert shown by AppHandlers.
  - `handleSaveCard` returns `Promise<boolean>` -- true on success/duplicate, false on failure.

### Schedule Validation Contract
- Hours validation occurs AFTER user picks a time, not before.
- Uses `isPlaceOpenAt(weekdayText, selectedDateTime)`, not `isPlaceOpenNow()`.
- Soft gate: Alert with "Schedule Anyway" option (hours data may be stale).
- Curated cards: each stop validated at estimated arrival time (cumulative duration + travel).

### Session Load Contract
- 6 queries in 1 parallel phase (was 11 queries in 3 sequential phases).
- Validation derived from Phase 1 data (no separate BoardErrorHandler queries).
- Saved cards + unread count fire at T=0 (not gated on validation).
- Expected: ~0.5s healthy, ~2s degraded.

### Auth Contract
- Single `useAuthSimple()` instance in AppStateManager. All others use `useAppStore()`.
- On TOKEN_REFRESHED: `invalidateQueries()` retries all failed queries with new token.
- Cold start: 5s grace period prevents 3-strike forced sign-out during token refresh.
- Zustand `_hasHydrated` gate: app renders from persisted state immediately, refreshes in background. No "Getting things ready" blocking screen for returning users.

### AI Quality Gate Contract
- AI is the sole quality gate for card serving. All old type exclusion NOT EXISTS blocks have been removed from `query_pool_cards`.
- Serving filter: `COALESCE(ai_override, ai_approved, false) = true`. Unvalidated cards (`ai_approved IS NULL`) are HIDDEN. Admin override wins, then AI verdict, then default hidden.
- `original_categories` is set exactly once (first validation). It is never overwritten on re-validation.
- `categories` is REPLACED with AI's `fits_categories` list when AI approves. If AI rejects (empty list), categories stay as original (card hidden by `ai_approved = false`).
- Seeding accepts all place types -- only rejects no-photos and permanently closed. AI filters quality post-seeding.
- `isChildVenueName()` is preserved as a safety net in all generation + serving functions. This catches kids venues with adult Google types (e.g., "Kids Fun Zone Bowling" typed as `bowling_alley`).
- `category_type_exclusions` table stays in the DB for audit and rollback. Not queried by `query_pool_cards` anymore.
- Curated cards validated per-stop: non-optional stop failure -> entire card rejected. Optional stop failure -> noted but card passes. GPT failure on optional stop does NOT reject the card.
- Zero-stop curated cards are automatically rejected with reason "No stops found" (prevents infinite retry).
- `ai-validate-cards` is admin-only (service_role key or admin JWT). Sequential processing, no parallelism. ~$0.005/card single, ~$0.02/card curated.
- GPT failures are isolated per-card -- a failed card gets `ai_reason = 'AI validation failed: ...'` and `ai_validated_at` set, but `ai_approved` stays NULL (will be retried on next run).
- Must never happen: removing `original_categories` column, removing `isChildVenueName()` safety net, dropping `category_type_exclusions` table, or allowing non-admin access to `ai-validate-cards`.

### Exclusion Contract
- All 3 card-serving functions apply: GLOBAL_EXCLUDED_PLACE_TYPES (type check), category_type_exclusions (DB table), `isChildVenueName()` (keyword check).
- Type checks scan full `types[]` array, not just `primary_type`.
- Curated stops: both stop types AND stop names checked.

### Card Display Contract
- Missing rating: hidden (no badge/text). Never show "0.0" or fake "4.5".
- Missing travel time: hidden. Never show "15m" or "12 min drive".
- Missing price: show "--" (em dash). Never show "$12-28".
- Star color: `#fbbf24` on light backgrounds, `white` on dark/image overlays.
- Travel icon: `getTravelModeIcon(travelMode)` -- car-outline for driving, bicycle for biking, bus-outline for transit, walk-outline for walking, navigate-outline for unknown/null.
- Currency: all price displays use user's currency via `useLocalePreferences()` or prop-threaded currency code. No hardcoded `$` symbols.

---

## Project Structure

```
Mingla/
├── app-mobile/
│   ├── app/
│   │   └── index.tsx                    # Entry point (AppContent)
│   ├── src/
│   │   ├── components/
│   │   │   ├── map/                     # Discover Map feature
│   │   │   │   ├── DiscoverMap.tsx       # Edge-to-edge map with floating pill bar
│   │   │   │   ├── PlacePin.tsx
│   │   │   │   ├── AnimatedPlacePin.tsx
│   │   │   │   ├── PersonPin.tsx         # User avatar marker with profile photo
│   │   │   │   ├── CuratedRoute.tsx      # Curated pins (46x46) with map-outline icon
│   │   │   │   ├── MapBottomSheet.tsx     # 3 snap points (15% peek, 45% preview, 90% expanded)
│   │   │   │   ├── PersonBottomSheet.tsx
│   │   │   │   ├── MapFilterBar.tsx       # Floating rounded pill bar (solid white, 24px border radius)
│   │   │   │   ├── ActivityStatusPicker.tsx  # Collapsible bottom-left pill with dropdown
│   │   │   │   ├── ActivityFeedOverlay.tsx
│   │   │   │   ├── PlaceHeatmap.tsx       # Marker+View circles (no native dependency)
│   │   │   │   ├── LayerToggles.tsx       # Collapsible orange FAB at bottom-right
│   │   │   │   ├── GoDarkFAB.tsx
│   │   │   │   └── MapPrivacySettings.tsx
│   │   │   ├── activity/
│   │   │   │   └── CardFilterBar.tsx    # Shared filter for SavedTab + CalendarTab
│   │   │   └── ...                      # ~107 UI components
│   │   ├── hooks/
│   │   │   ├── useMapCards.ts           # Fetches 200 single + all 6 curated types
│   │   │   ├── useMapLocation.ts
│   │   │   ├── useMapSettings.ts
│   │   │   ├── useNearbyPeople.ts
│   │   │   └── ...                      # ~73 React Query hooks + realtime hooks
│   │   ├── services/                    # ~81 service files
│   │   ├── contexts/                    # 3 React contexts
│   │   ├── store/                       # Zustand store (appStore)
│   │   ├── types/                       # TypeScript types
│   │   ├── constants/                   # Design tokens, config, categories
│   │   └── utils/                       # ~31 utility files
│   └── package.json
│
├── supabase/
│   ├── functions/                       # ~71 Deno edge functions
│   │   ├── _shared/                     # Shared edge function utilities
│   │   ├── update-map-location/         # User map location updates
│   │   ├── get-nearby-people/           # Nearby people with taste matching
│   │   ├── keep-warm/                   # Cold start elimination
│   │   └── [function-name]/             # Individual edge functions
│   ├── migrations/                      # 288 SQL migration files
│   │   └── (includes: user_map_settings, user_taste_matches,
│   │        taste_match_rpc, friend_request_source,
│   │        device_calendar_event_id, sync_display_name_trigger)
│   └── config.toml
│
├── mingla-admin/                        # Admin dashboard (React 19 + Vite + Tailwind v4)
│   └── src/
│       ├── App.jsx                      # Root with hash routing + Cmd+K
│       ├── pages/                       # 18 feature pages
│       ├── components/
│       │   ├── layout/                  # AppShell, Sidebar, Header
│       │   ├── ui/                      # 14 reusable components
│       │   └── CommandPalette.jsx       # Global Cmd+K search
│       ├── context/                     # AuthContext, ThemeContext, ToastContext
│       └── lib/                         # Supabase client, constants, formatters
│
├── backend/                             # Backend utilities
└── oauth-redirect/                      # Static OAuth callback page
```

---

## Key Features

### Discover Map
- Edge-to-edge interactive map with CartoDB Positron tiles (clean barren map -- faint roads, city names only, no POIs)
- Floating rounded pill bar (solid white, 24px border radius) with category icons matched to preferences sheet (direct slug-to-icon map)
- useMapCards hook fetches 200 single cards + all 6 curated types with open-now filtering built in (single + curated all-stops-open)
- Cards without photos or titles automatically hidden
- For You pill centers map on user location
- User avatar marker with profile photo + "This is you" callout
- Curated pins larger (46x46) with map-outline icon
- Bottom sheet with 3 snap points (15% peek, 45% preview, 90% expanded), no dismiss
- Friends and paired people visible on map with privacy controls
- Taste matching for nearby strangers (Jaccard similarity)
- Bidirectional visibility for strangers; friends-of-friends visibility option
- Default visibility set to 'friends' (not 'off')
- Location seeded on first map load
- ActivityStatusPicker: collapsible pill at bottom-left with dropdown (visibility settings + people toggle + status presets + custom). Status stays until changed (no auto-expiry)
- LayerToggles: collapsible orange FAB at bottom-right with labeled dropdown (Places, Go Dark, Activity Feed, Heatmap)
- Both menus: matching style -- orange FABs, labeled rows, checkmarks
- Go Dark mode (24h invisibility)
- Curated multi-stop routes with polyline visualization
- Pin entrance animations (staggered spring cascade)
- Real-time activity feed overlay
- PlaceHeatmap uses Marker+View circles (no native dependency)
- Android fallback screen when native map module unavailable

### Discovery and Cards
- Card-based swipe interface with pool-first serving and 5-factor scoring
- AI card quality gate (GPT-5.4-mini with web search)
- Shared CardFilterBar component for SavedTab and CalendarTab
- Inactive paired pills use darker grey (#e5e7eb)
- Pill bar borderRadius 24, solid white

### Social
- Real-time collaboration sessions with synchronized decks
- Session voting, RSVP, and lock awareness
- Dual-channel real-time messaging with deduplication
- @username removed from friend lists (display names only)
- Elite-only 3-tier pairing with preference learning
- Unified notification dispatch with preferences and quiet hours
- Fire-and-forget push notifications for instant UI response (friend accept 4.6s down to instant)

### Onboarding and Identity
- Onboarding: name collection, friends, pairing, collaborations, consent
- Country picker unlocked in onboarding and Account Settings with auto-derived currency/units
- Centralized name display via `getDisplayName()` (53 inline fallback chains replaced)
- `sync_display_name` trigger keeps profile display names in sync
- Delete account modal redesigned
- Keyboard fixes across MessageInterface, BoardDiscussionTab, and onboarding screens

### Calendar and Scheduling
- Calendar sync with device event ID tracking for proper reschedule and unschedule
- Partial unique index prevents duplicate pending entries
- All calendar methods request permissions properly

### Subscriptions
- Subscription tiers (Free/Pro/Elite) with server-side enforcement
- Unified tier price ranges with updated rates

### Coach Tour
- Interactive 11-stop guided walkthrough with spotlight overlay
- Auto-triggers after onboarding completion, replayable from Profile settings
- SVG mask cutout overlay with animated tooltip cards and step progression
- Mock data injection via React Query cache seeding (zero network calls during tour)
- Per-stop progress tracking in `coach_mark_progress` table
- Covers: deck, preferences, sessions, invites, collab prefs, pairings, map, chats, saved, calendar, profile
- App kill recovery via persisted Zustand state

### Performance
- keep-warm edge function eliminates cold starts
- Skeleton cards during loading
- Prefetch for anticipated navigation
- Persisted Zustand state for instant cold-start rendering

---

## Database Schema Overview

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles with display name, phone, avatar, onboarding state, is_seed flag |
| `preferences` | User preferences (categories, budget, travel mode, location) |
| `place_pool` | Seeded places with Google data, photos, AI status |
| `card_pool` | Generated cards (single + curated) with AI validation |
| `saved_card` | User-saved cards |
| `calendar_entries` | Scheduled cards with device event ID tracking |
| `collaboration_sessions` | Real-time collaboration sessions |
| `session_participants` | Session membership and roles |
| `boards` | Collaboration boards within sessions |
| `board_collaborators` | Board membership |
| `board_votes` | Card votes within boards |
| `board_card_rsvps` | RSVP status for board cards |
| `friend_requests` | Friend request lifecycle (with source tracking) |
| `pairings` | Active pairing relationships |
| `blocked_users` | User block list |
| `user_map_settings` | Map privacy, activity status, go-dark state |
| `user_taste_matches` | Precomputed taste similarity scores |
| `user_reports` | User-submitted reports with severity |
| `admin_users` | Admin email allowlist with roles |
| `admin_audit_log` | Admin action audit trail |
| `seeding_runs` | Batch seeding sessions |
| `seeding_batches` | Per tile x category seeding execution |

---

## Edge Functions

~72 Deno edge functions deployed on Supabase.

### Discovery and Serving
- `discover-cards` -- Pool-only card serving with 5-factor scoring
- `discover-experiences` -- Daily curated experience serving
- ~~Per-category discover functions~~ — Removed. `discover-cards` handles all categories in a single unified call.
- `get-personalized-cards` -- Personalized card recommendations
- `get-holiday-cards` -- Holiday-themed card serving
- `get-person-hero-cards` -- Hero cards for paired people view
- `get-paired-saves` -- Paired user saved cards
- `get-companion-stops` -- Companion stop suggestions
- `get-picnic-grocery` -- Grocery stop for picnic experiences

### Map
- `update-map-location` -- User map location and activity status updates
- `get-nearby-people` -- Nearby people discovery with taste matching

### Generation and AI
- `generate-single-cards` -- Batch single card generation from place pool
- `generate-curated-experiences` -- Multi-stop itinerary generation
- `generate-experiences`, `generate-holiday-categories` -- Experience generation utilities
- `generate-ai-summary` -- AI place summaries
- `generate-session-deck` -- Collaboration session deck generation
- `ai-validate-cards` -- AI quality gate (GPT-5.4-mini with web search)
- `ai-reason` -- AI reasoning for card decisions
- `new-generate-experience-`, `night-out-experiences`, `holiday-experiences` -- Legacy experience generators

### Admin
- `admin-seed-places` -- Tile-based place seeding with sequential batch approval
- `admin-place-search` -- Google Places search for admin
- `admin-refresh-places` -- Refresh place data from Google
- `admin-seed-map-strangers` -- Seed fake stranger profiles around real users for map population
- `admin-send-email` -- Email sending via Resend
- `admin-feedback` -- Feedback management
- `backfill-place-photos` -- Re-download photos for places
- `backfill-place-websites` -- Backfill place website data
- `refresh-place-pool` -- Bulk place pool refresh

### Auth and Identity
- `send-otp` -- OTP code delivery via Twilio
- `verify-otp` -- OTP verification
- `lookup-phone` -- Phone number lookup
- `search-users` -- User search
- `delete-user` -- Server-side user deletion with FK cascades

### Social
- `send-friend-request-email` -- Friend request email notification
- `send-friend-accepted-notification` -- Friend accepted push notification
- `send-pair-request` -- Pair request initiation
- `send-pair-accepted-notification` -- Pair accepted push notification
- `send-collaboration-invite` -- Collaboration invite delivery
- `send-phone-invite` -- SMS invite to non-users
- `send-message-email` -- Message notification email
- `process-referral` -- Referral code processing

### Notifications
- `notify-dispatch` -- Unified notification dispatch (preferences, quiet hours, idempotency)
- `notify-calendar-reminder` -- Calendar event reminders
- `notify-holiday-reminder` -- Holiday reminders via cron
- `notify-invite-response` -- Invite response notifications
- `notify-lifecycle` -- Lifecycle event notifications
- `notify-message` -- Message push notifications
- `notify-pair-activity` -- Pair activity notifications
- `notify-pair-request-visible` -- Pair request visibility notifications
- `notify-referral-credited` -- Referral credit notifications

### Utilities
- `keep-warm` -- Periodic invocation to eliminate cold starts
- `warm-cache` -- Cache warming for frequently accessed data
- `events` -- Event processing
- `ticketmaster-events` -- Ticketmaster API integration
- `places` -- Places API proxy
- `weather` -- Weather data
- `process-voice-review` -- Whisper audio transcription
- `record-visit` -- Visit recording
- `submit-feedback` -- User feedback submission
- `get-google-maps-key` -- Secure Maps API key delivery

### Shared
- `_shared/` -- Shared utilities (CORS, Supabase client, category definitions, seeding categories, error handling)

---

## Environment Variables

### Mobile (`app-mobile/.env`)
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_ONESIGNAL_APP_ID`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`

### Admin (`mingla-admin/.env`)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Supabase Secrets
- `GOOGLE_PLACES_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`
- `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`

---

## Setup Instructions

```bash
# Clone the repository
git clone <repo-url> && cd mingla

# Mobile app
cd app-mobile
npm install
npx expo start

# Admin dashboard
cd mingla-admin
npm install
npm run dev

# Supabase (local development)
cd supabase
supabase start
supabase db push   # Apply all migrations
```

---

## Recent Changes

- **OneSignal crash fix** -- Centralised all `OneSignal.Notifications.clearAll()` calls into a single `clearNotificationBadge()` wrapper in `oneSignalService.ts` with try/catch and a `_loginComplete` guard. Eliminates SIGABRT crash caused by native ObjC exceptions when badge-clearing raced with the in-flight OneSignal login sequence. No file outside `oneSignalService.ts` imports OneSignal directly.
- **Seed map strangers** -- Admin edge function (`admin-seed-map-strangers`) creates fake international stranger profiles around real users so the Discover Map looks populated. 50 diverse names, random preferences/activity statuses, clean `is_seed` flag for bulk cleanup. Three actions: seed (single point), seed_around_all_users, cleanup.
- **Interactive coach tour** -- 11-stop guided walkthrough with spotlight overlay, mock data injection, per-stop tracking, auto-trigger after onboarding, replayable from Profile. SVG mask cutout, Reanimated animations, zero Supabase calls during tour.
- **Discover Map polish** -- Edge-to-edge map with CartoDB Positron tiles, floating rounded pill bar (solid white, 24px border radius), useMapCards fetches 200 single + all 6 curated types with open-now filtering, cards without photos/titles hidden, category icons matched to preferences sheet via direct slug-to-icon map, user avatar marker with profile photo + "This is you" callout, curated pins at 46x46 with map-outline icon, bottom sheet with 3 snap points (15% peek, 45% preview, 90% expanded, no dismiss), For You pill centers on user location.
- **Map controls** -- ActivityStatusPicker as collapsible bottom-left pill (visibility settings, people toggle, status presets, custom status, no auto-expiry). LayerToggles as collapsible orange FAB at bottom-right (Places, Go Dark, Activity Feed, Heatmap). Both menus: matching style with orange FABs, labeled rows, checkmarks. PlaceHeatmap uses Marker+View circles (no native dependency).
- **Map visibility** -- Bidirectional visibility for strangers, friends-of-friends option added, default visibility changed from 'off' to 'friends', location seeded on first map load, Android fallback screen when native map module unavailable.
- **UI refinements** -- Inactive paired pills darker grey (#e5e7eb), pill bar borderRadius 24 solid white, @username removed from friend lists, delete account modal redesigned, keyboard fixes across MessageInterface/BoardDiscussionTab/onboarding.
- **Onboarding and identity** -- Name collection during onboarding with sync_display_name trigger, country picker unlocked in onboarding and Account Settings with auto-derived currency/units, centralized name display via `getDisplayName()` replacing 53 inline fallback chains.
- **Performance and reliability** -- Fire-and-forget push notifications (friend accept 4.6s down to instant), all calendar methods request permissions properly, keep-warm edge function eliminates cold starts, skeleton cards during loading, prefetch for anticipated navigation.
- **Card pipeline** -- 5 passes of hardening across card generation and serving. Fabricated data eliminated. AI quality gate (GPT-5.4-mini with web search) replaces all type-based exclusion logic. Unified tier price ranges with updated rates. Truthful error states throughout.
- **Calendar sync** -- Device event ID tracking for proper reschedule and unschedule. Partial unique index prevents duplicate pending entries. Shared CardFilterBar for SavedTab and CalendarTab.
