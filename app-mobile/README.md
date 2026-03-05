# Mingla

A mobile-first experience discovery and planning app — swipe, save, and go. Built with React Native (Expo), TypeScript, Supabase, and 25 Deno edge functions.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native (Expo SDK 54), TypeScript strict |
| Server state | React Query |
| Client state | Zustand + AsyncStorage persistence |
| Backend | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| Edge functions | 25 Deno edge functions |
| AI | OpenAI GPT-4o-mini (structured JSON output) |
| Maps | Google Places API (New) |
| Events | Ticketmaster Discovery API v2 |
| Payments | Stripe Connect |
| Styling | StyleSheet.create only (no inline styles) |
| Navigation | Custom state-driven (no React Navigation) |
| Blur effects | expo-blur (iOS frosted glass, Android solid fallback) |

## Project Structure

```
app-mobile/
  app/
    index.tsx              # Entry point (AppContent)
  src/
    components/            # ~80+ UI components
      onboarding/          # OnboardingShell, PhoneInput, OTPInput, AudioRecorder
      signIn/              # WelcomeScreen (Google/Apple auth)
      ui/                  # CategoryTile, PulseDotLoader, etc.
      OnboardingFlow.tsx   # 5-step onboarding state machine
      SwipeableCards.tsx    # Tinder-style swipe interface
      ExpandedCardModal.tsx # Full card detail view
      DiscoverScreen.tsx   # Explore + Night Out tabs
      AppStateManager.tsx  # Root state orchestrator
    hooks/                 # ~28 React Query hooks
    services/              # ~53 service files (Supabase + API)
    contexts/              # 3 React contexts (Recommendations, Navigation, etc.)
    store/                 # Zustand store (appStore.ts)
    types/                 # TypeScript types (database + domain)
    constants/             # Design tokens, config, categories
      designSystem.ts      # Spacing, colors, typography, glass tokens
      categories.ts        # 12 experience categories
    utils/                 # 18 utility files
      throttledGeocode.ts  # Centralized throttled/cached reverse geocoding wrapper

supabase/
  functions/               # 25 Deno edge functions
    _shared/               # Shared modules (categoryPlaceTypes, cardPoolService, placesCache)
  migrations/              # 30+ SQL migration files
```

## Features

- **AI-powered swipe discovery** — preference-driven cards served from a card pool pipeline (zero API cost on cache hit)
- **12 experience categories** — Nature, First Meet (3-group: cafes + activities + culture), Picnic (7 outdoor park/garden types), Drink (2-group: alcohol + non-alcohol), Casual Eats, Fine Dining (11-type: steakhouses, French, seafood, Mediterranean, Spanish, tapas, oyster bars, bistros, gastropubs, wine bars), Watch (9-type: movie theaters, performing arts, concert halls, opera houses, philharmonic halls, amphitheatres, comedy clubs, live music, karaoke), Creative & Arts, Play, Wellness, Groceries & Flowers, Work & Business
- **First Meet 3-group alternation** — interleaved cafe/activity/culture types produce diverse cards (bowling alleys, art galleries, parks alongside coffee shops)
- **Drink 2-group alternation** — interleaved alcohol/non-alcohol types (bars, cocktail bars, breweries alongside coffee shops, tea houses, juice bars)
- **Picnic unified 7-type array** — park, city_park, picnic_ground, state_park, botanical_garden, garden, nature_preserve — consistent across all 10 edge function surfaces with 38-type exclude list
- **5 intent types** — Romantic, First Dates, Group Fun, Business, Solo Adventure (with curated multi-stop itineraries)
- **Ticketmaster Night Out** — real event cards with genre/date/price filtering and in-app ticketing
- **Collaboration sessions** — real-time boards with live participant updates
- **5-step onboarding** — cinematic animated welcome, phone verification, intent/category/budget/transport preferences, person import
- **Glassmorphism onboarding UI** — frosted glass bottom bar (expo-blur on iOS), full-width CTA with orange glow shadow, staggered text reveal animation
- **Holiday experiences** — seasonal curated content with archive/delete
- **Card pool pipeline** — place_pool + card_pool + user_card_impressions for efficient serving
- **Centralized geocoding** — all reverse geocoding goes through a single throttled wrapper with 1.5s rate limiting, LRU cache (50 entries, 30-min TTL), deduplication of concurrent requests, and automatic rate-limit retry
- **GPS + manual location** — HTTP-based forward geocoding (geocodingService), null-safe location handling, error/denied state distinction in onboarding

## Database Schema (Key Tables)

| Table | Purpose |
|-------|---------|
| profiles | User profiles (auth-linked) |
| preferences | User preferences (categories, budget, transport, travel time) |
| boards / board_members | Collaborative experience boards |
| experiences / saved_experiences | Place data and user saves |
| collaboration_sessions | Real-time collaboration |
| place_pool / card_pool | Pre-enriched card serving pipeline |
| user_card_impressions | Tracks seen cards for freshness |
| ticketmaster_events_cache | 2-hour TTL event cache |
| holidays | Seasonal experiences with archive |

## Edge Functions (Key)

| Function | Purpose |
|----------|---------|
| new-generate-experience- | Main card generation (Google Places + OpenAI) |
| generate-curated-experiences | Multi-stop itinerary cards |
| generate-session-experiences | Collaboration session cards |
| generate-experiences | Solo experience generation |
| discover-experiences | Explore tab discovery |
| discover-picnic-park | Dedicated Picnic Park card system |
| discover-drink | Dedicated Drink venue card system |
| discover-fine-dining | Dedicated Fine Dining card system |
| discover-cards | Discover tab card serving |
| recommendations-enhanced | Recommendation scoring engine |
| recommendations | Legacy recommendation engine |
| generate-person-experiences | Person-based experience generation |
| ticketmaster-events | Ticketmaster API proxy |
| refresh-place-pool | Daily pool refresh (free Place Details) |
| holiday-experiences | Seasonal content |

All edge functions import category-to-place-type mappings from `_shared/categoryPlaceTypes.ts` — the single source of truth. Zero hardcoded mappings exist in any individual function.

## Environment Variables

### Mobile (app.json / .env)
- `EXPO_PUBLIC_SUPABASE_URL` — Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key

### Supabase Secrets (edge functions)
- `GOOGLE_PLACES_API_KEY` — Google Places API (New)
- `OPENAI_API_KEY` — OpenAI GPT-4o-mini
- `TICKETMASTER_API_KEY` — Ticketmaster Discovery API v2
- `STRIPE_SECRET_KEY` — Stripe Connect
- `RESEND_API_KEY` — Email service

## Setup

```bash
cd app-mobile
npm install
npx expo start
```

Scan QR code with Expo Go (Android) or Camera (iOS).

For Supabase edge functions:
```bash
cd supabase
supabase functions serve
```

## Recent Changes

- **Category place type centralization** — all 10 active edge functions now import from `_shared/categoryPlaceTypes.ts`. Zero local CATEGORY_MAPPINGS or CATEGORY_TO_PLACE_TYPES objects remain.
- **Groceries & Flowers bug fix** — discover-experiences EXCLUDED_TYPES previously contained `grocery_store` and `supermarket`, causing zero results. Fixed by centralized DISCOVER_EXCLUDED_PLACE_TYPES that omits these valid types.
- **Holiday experiences** now support all 12 categories (previously missing Groceries & Flowers and Work & Business).
- **Dead code deletion** — removed 5 stale folders: `generate-session-experiences copy/`, `generate-experiences copy/`, `recommendations-backup/`, `versions/`, `gen-exp-new-keywords/`.
- **Centralized exclusion system** — CATEGORY_EXCLUDED_PLACE_TYPES, DISCOVER_EXCLUDED_PLACE_TYPES, and getExcludedTypesForCategory() added to canonical source.
