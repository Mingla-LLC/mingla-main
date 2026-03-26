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
| Edge Functions | ~70 Deno serverless functions |
| AI | OpenAI GPT-5.4-mini (card quality gate with web search), GPT-4o-mini (AI reasons), Whisper (audio transcription) |
| Maps & Places | Google Maps (CartoDB Positron tiles), Google Places API (New) |
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
│   │   │   │   ├── DiscoverMap.tsx
│   │   │   │   ├── PlacePin.tsx
│   │   │   │   ├── AnimatedPlacePin.tsx
│   │   │   │   ├── PersonPin.tsx
│   │   │   │   ├── CuratedRoute.tsx
│   │   │   │   ├── MapBottomSheet.tsx
│   │   │   │   ├── PersonBottomSheet.tsx
│   │   │   │   ├── MapFilterBar.tsx
│   │   │   │   ├── ActivityStatusPicker.tsx
│   │   │   │   ├── ActivityFeedOverlay.tsx
│   │   │   │   ├── PlaceHeatmap.tsx
│   │   │   │   ├── LayerToggles.tsx
│   │   │   │   ├── GoDarkFAB.tsx
│   │   │   │   └── MapPrivacySettings.tsx
│   │   │   ├── activity/
│   │   │   │   └── CardFilterBar.tsx    # Shared filter for SavedTab + CalendarTab
│   │   │   └── ...                      # ~100+ UI components
│   │   ├── hooks/
│   │   │   ├── useMapCards.ts
│   │   │   ├── useMapLocation.ts
│   │   │   ├── useMapSettings.ts
│   │   │   ├── useNearbyPeople.ts
│   │   │   └── ...                      # ~67+ React Query hooks + realtime hooks
│   │   ├── services/                    # ~75 service files
│   │   ├── contexts/                    # 3 React contexts
│   │   ├── store/                       # Zustand store (appStore)
│   │   ├── types/                       # TypeScript types
│   │   ├── constants/                   # Design tokens, config, categories
│   │   └── utils/                       # ~27 utility files
│   └── package.json
│
├── supabase/
│   ├── functions/                       # ~70 Deno edge functions
│   │   ├── _shared/                     # Shared edge function utilities
│   │   ├── update-map-location/         # User map location updates
│   │   ├── get-nearby-people/           # Nearby people with taste matching
│   │   ├── keep-warm/                   # Cold start elimination
│   │   └── [function-name]/             # Individual edge functions
│   ├── migrations/                      # 287 SQL migration files
│   │   └── (includes: user_map_settings, user_taste_matches,
│   │        taste_match_rpc, friend_request_source,
│   │        device_calendar_event_id, sync_display_name_trigger)
│   └── config.toml
│
├── mingla-admin/                        # Admin dashboard (React 19 + Vite + Tailwind v4)
│   └── src/
│       ├── App.jsx                      # Root with hash routing + Cmd+K
│       ├── pages/                       # 14 feature pages
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

- Interactive discovery map with CartoDB Positron tiles
- Friends and paired people visible on map with privacy controls
- Taste matching for nearby strangers (Jaccard similarity)
- Activity status picker (Exploring, Looking for plans, etc.)
- Go Dark mode (24h invisibility)
- Curated multi-stop routes with polyline visualization
- Pin entrance animations (staggered spring cascade)
- Real-time activity feed overlay
- Circle-based heatmap of popular areas
- Collapsible layer toggles (places, people, feed, heatmap, go dark)
- Shared CardFilterBar component for SavedTab and CalendarTab
- Calendar reschedule with device event ID tracking
- Session voting, RSVP, and lock awareness
- Card-based swipe interface with pool-first serving and 5-factor scoring
- Onboarding: name collection, friends, pairing, collaborations, consent
- Fire-and-forget push notifications for instant UI response
- keep-warm edge function for cold start elimination
- AI card quality gate (GPT-5.4-mini with web search)
- Real-time collaboration sessions with synchronized decks
- Subscription tiers (Free/Pro/Elite) with server-side enforcement
- Elite-only 3-tier pairing with preference learning
- Dual-channel real-time messaging with deduplication
- Unified notification dispatch with preferences and quiet hours

---

## Database Schema Overview

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles with display name, phone, avatar, onboarding state |
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

~70 Deno edge functions deployed on Supabase. New functions marked with **(new)**.

### Discovery and Serving
- `discover-cards` -- Pool-only card serving with 5-factor scoring
- `discover-experiences` -- Daily curated experience serving
- `discover-casual-eats`, `discover-creative-arts`, `discover-drink`, `discover-fine-dining`, `discover-first-meet`, `discover-nature`, `discover-picnic-park`, `discover-play`, `discover-watch`, `discover-wellness` -- Per-category discover functions
- `get-personalized-cards` -- Personalized card recommendations
- `get-holiday-cards` -- Holiday-themed card serving
- `get-person-hero-cards` -- Hero cards for paired people view
- `get-paired-saves` -- Paired user saved cards
- `get-companion-stops` -- Companion stop suggestions
- `get-picnic-grocery` -- Grocery stop for picnic experiences

### Map **(new)**
- `update-map-location` **(new)** -- User map location and activity status updates
- `get-nearby-people` **(new)** -- Nearby people discovery with taste matching

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
- `keep-warm` **(new)** -- Periodic invocation to eliminate cold starts
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

- **Discover Map (4 phases)** -- Interactive map with place pins on CartoDB Positron tiles, people layer with privacy controls, taste matching for nearby strangers (Jaccard similarity), curated multi-stop route visualization, staggered spring pin entrance animations, activity feed overlay, circle-based heatmap, collapsible layer toggles, Go Dark mode (24h invisibility).
- **Onboarding overhaul** -- Name collection during onboarding with sync_display_name trigger, shell footer pattern for consistent bottom navigation, keyboard avoidance fixes, country picker unlocked in onboarding and Account Settings with auto-derived currency/units.
- **Card pipeline reliability** -- 5 passes of hardening across card generation and serving. Fabricated data eliminated (no fake ratings, prices, or travel times). AI quality gate (GPT-5.4-mini with web search) replaces all type-based exclusion logic. Truthful error states throughout.
- **Calendar sync** -- Device event ID tracking for proper reschedule and unschedule. Partial unique index prevents duplicate pending entries. Shared CardFilterBar component for SavedTab and CalendarTab.
- **Performance** -- keep-warm edge function eliminates cold starts, skeleton cards during loading, prefetch for anticipated navigation, fire-and-forget push notifications for instant UI response.
