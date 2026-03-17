# Mingla

A mobile-first experience discovery and planning app — swipe, save, and go. Built with React Native (Expo), TypeScript, Supabase, and 27 Deno edge functions.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native (Expo SDK 54), TypeScript strict |
| Server state | React Query |
| Client state | Zustand + AsyncStorage persistence |
| Backend | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| Edge functions | 27 Deno edge functions |
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
      BetaFeedbackButton.tsx   # Conditional feedback button (beta testers only)
      BetaFeedbackModal.tsx    # Audio recording + category + submit flow
      FeedbackHistorySheet.tsx # Past submissions list with playback
    hooks/                 # ~29 React Query hooks
      useBetaFeedback.ts   # Beta tester check, feedback history, submit mutation
    services/              # ~56 service files (Supabase + API)
      betaFeedbackService.ts  # FeedbackRecorder class, upload, submit, history
      deviceInfoService.ts    # Device metadata collection (OS, model, app version)
      sessionTracker.ts       # App session duration tracker
    contexts/              # 3 React contexts (Recommendations, Navigation, etc.)
    store/                 # Zustand store (appStore.ts)
    types/                 # TypeScript types (database + domain)
    constants/             # Design tokens, config, categories
      designSystem.ts      # Spacing, colors, typography, glass tokens
      categories.ts        # 12 experience categories
    utils/                 # 18 utility files
      throttledGeocode.ts  # Centralized throttled/cached reverse geocoding wrapper

supabase/
  functions/               # 27 Deno edge functions
    _shared/               # Shared modules (categoryPlaceTypes, cardPoolService, placesCache)
    submit-feedback/       # Beta feedback submission (validates beta tester, denormalizes user data)
    admin-feedback/        # Admin CRUD for feedback (list, get, update status, add notes, audio URLs)
  migrations/              # 40+ SQL migration files
```

## Features

- **AI-powered swipe discovery** — preference-driven cards served from a card pool pipeline (zero API cost on cache hit)
- **12 experience categories** — Nature, First Meet, Picnic, Drink, Casual Eats, Fine Dining, Watch, Creative & Arts, Play, Wellness, Groceries & Flowers, Work & Business
- **5 intent types** — Romantic, First Dates, Group Fun, Business, Solo Adventure (with curated multi-stop itineraries)
- **Ticketmaster Night Out** — real event cards with genre/date/price filtering and in-app ticketing
- **Collaboration sessions** — real-time boards with live participant updates
- **5-step onboarding** — cinematic animated welcome, phone verification, intent/category/budget/transport preferences, person import
- **Glassmorphism onboarding UI** — frosted glass bottom bar (expo-blur on iOS), full-width CTA with orange glow shadow, staggered text reveal animation
- **Holiday experiences** — seasonal curated content with archive/delete
- **Card pool pipeline** — place_pool + card_pool + user_card_impressions for efficient serving
- **Beta tester feedback system** — audio recording (up to 5 min), category selection, device/context metadata collection, submission history with playback. Admin API for triage via separate admin repo.
- **Centralized geocoding** — all reverse geocoding goes through a single throttled wrapper with rate limiting, LRU cache, and deduplication

## Database Schema (Key Tables)

| Table | Purpose |
|-------|---------|
| profiles | User profiles (auth-linked, includes `is_beta_tester` and `is_admin` flags) |
| preferences | User preferences (categories, budget, transport, travel time) |
| boards / board_members | Collaborative experience boards |
| experiences / saved_experiences | Place data and user saves |
| collaboration_sessions | Real-time collaboration |
| place_pool / card_pool | Pre-enriched card serving pipeline |
| user_card_impressions | Tracks seen cards for freshness |
| ticketmaster_events_cache | 2-hour TTL event cache |
| holidays | Seasonal experiences with archive |
| beta_feedback | Beta tester audio feedback submissions with device/context metadata |

## Edge Functions (Key)

| Function | Purpose |
|----------|---------|
| new-generate-experience- | Main card generation (Google Places + OpenAI) |
| generate-curated-experiences | Multi-stop itinerary cards |
| generate-session-experiences | Collaboration session cards |
| discover-cards | Discover tab card serving |
| recommendations-enhanced | Recommendation scoring engine |
| ticketmaster-events | Ticketmaster API proxy |
| refresh-place-pool | Daily pool refresh (free Place Details) |
| submit-feedback | Beta feedback submission (validates beta tester, denormalizes user snapshot) |
| admin-feedback | Admin CRUD for feedback (list, get, update status, add notes, signed audio URLs) |

## Storage Buckets

| Bucket | Purpose |
|--------|---------|
| voice-reviews | Place review audio clips (1-year signed URLs) |
| beta-feedback | Beta tester feedback audio (1-hour signed URLs, private, RLS-protected) |

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

Run pending migrations:
```bash
supabase db push
```

## Recent Changes

- **Beta tester feedback system** — full audio feedback pipeline: 4 SQL migrations (profile flags, beta_feedback table, RLS policies, storage bucket), 2 new edge functions (submit-feedback, admin-feedback), 3 new services (betaFeedbackService, deviceInfoService, sessionTracker), React Query hook, and 3 UI components (BetaFeedbackModal, FeedbackHistorySheet, BetaFeedbackButton) integrated into ProfilePage
- **Admin API contract** — admin-feedback edge function provides list/get/update_status/add_note/get_audio_url actions for the separate admin repo to consume
- **No new dependencies** — uses expo-device and expo-constants (already installed) for device metadata
