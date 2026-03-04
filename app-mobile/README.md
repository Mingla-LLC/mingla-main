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
    utils/                 # 12 utility files

supabase/
  functions/               # 25 Deno edge functions
  migrations/              # 30+ SQL migration files
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
- **GPS + manual location** — with city name geocoding and preference toggle

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
| generate-experiences | Main card generation (Google Places + OpenAI) |
| generate-curated-experiences | Multi-stop itinerary cards |
| generate-session-experiences | Collaboration session cards |
| discover-experiences | Explore tab discovery |
| ticketmaster-events | Ticketmaster API proxy |
| refresh-place-pool | Daily pool refresh (free Place Details) |
| holiday-experiences | Seasonal content |
| night-out-experiences | Legacy night out (replaced by Ticketmaster) |

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

- Onboarding glassmorphism overhaul — frosted glass bottom bar, full-width CTA with orange glow shadow, 4-phase cinematic text reveal animation on welcome screen
- "Back to sign in" escape hatch on first onboarding screen (signs out and returns to WelcomeScreen)
- expo-blur added for iOS backdrop blur (Android uses solid semi-transparent fallback)
- Glass design tokens added to designSystem.ts
- CTA button press animation (spring scale 0.97) with per-screen entrance animation
