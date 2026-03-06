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
| Edge Functions | 27+ Deno serverless functions |
| AI | OpenAI GPT-4o-mini |
| Maps & Places | Google Places API (New) |
| Live Events | Ticketmaster Discovery API v2 |
| Payments | Stripe Connect |
| Push Notifications | Expo Push Notifications |
| Navigation | Custom state-driven (no React Navigation) |
| Styling | StyleSheet only (no inline styles) |

---

## Project Structure

```
Mingla/
├── app-mobile/
│   ├── app/
│   │   └── index.tsx                    # Entry point (AppContent)
│   ├── src/
│   │   ├── components/                  # ~85+ UI components
│   │   │   ├── onboarding/             # OnboardingShell, PhoneInput, OTPInput,
│   │   │   │                           # SegmentedProgressBar, OnboardingFriendsStep,
│   │   │   │                           # OnboardingCollaborationStep, etc.
│   │   │   ├── board/                  # Board-related components
│   │   │   └── ui/                     # Shared UI primitives
│   │   ├── hooks/                      # ~30 React Query hooks
│   │   ├── services/                   # ~55 service files
│   │   ├── contexts/                   # 3 React contexts
│   │   ├── store/                      # Zustand store
│   │   ├── types/                      # TypeScript types
│   │   ├── constants/                  # Design tokens, config, categories, price tiers
│   │   └── utils/                      # 12 utility files
│   ├── app.json
│   ├── eas.json
│   └── package.json
│
├── supabase/
│   ├── functions/                      # 27+ Deno edge functions
│   │   ├── _shared/                   # Shared edge function utilities
│   │   └── [function-name]/           # Individual edge functions
│   ├── migrations/                    # 115+ SQL migration files
│   └── config.toml
│
└── oauth-redirect/                    # Static OAuth callback page
```

---

## Features

### AI-Powered Recommendations
- Experience cards built from real Google Places data, enriched by GPT-4o-mini with descriptions, highlights, and match scores
- Card pool data pipeline: pool-first serving from pre-built card pool, falls back to Google Places API only when the pool is exhausted
- 5-factor scoring algorithm ranks cards by category match, tag overlap, popularity, quality, and text relevance

### Card-Based Swipe Interface
- Swipe right to save, left to skip, up to expand full details
- Curated multi-stop itinerary experiences interleaved with single-place cards (Solo Adventure, First Date, Romantic, Friendly, Group Fun, Picnic, Stroll)
- Expanded card modal with image gallery, weather forecast, busyness predictions, and match score breakdown
- Dismissed cards review sheet for reconsidering skipped cards
- Deck batch navigation with forward/backward history

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
- Consensus lock-in: when all participants RSVP "attending," the card auto-locks and creates calendar entries
- Realtime sync via Supabase Realtime for votes, RSVPs, messages, presence, and typing indicators
- Push notifications for session invites, accepts, and declines

### Friend System
- Add friends by username or phone number
- Accept/decline friend requests with push notifications
- Block and mute functionality
- Friend linking for personalized "For You" recommendations

### Friends and Collaboration Onboarding
- Add friends by phone number during onboarding
- Create collaboration sessions before entering the main app
- Phone-based invites for non-app users that auto-resolve when they sign up

### Subscription System
- Free, Pro, and Elite tiers with 1-week trial
- Referral bonus months for inviting friends
- Stripe Connect payment processing

### Universal Links
- Deep linking via usemingla.com for invite and board URLs

### Discover Tab
- Personalized daily feed driven by user preferences
- Category browsing across all 12 categories
- Holiday experiences with gender-specific filtering
- Night Out section powered by Ticketmaster with genre, date, and price filtering
- In-app ticket purchasing via expo-web-browser

### Phone-Based Invites
- Invite non-app users by phone number
- Send collaboration invites to any phone number
- Pending invites auto-resolve when the invited user signs up

### Additional Features
- GPS and manual location with travel time preferences
- Audio clips for saved people
- Holiday planning and archiving
- Post-experience reviews with star ratings and voice recordings
- Device calendar export
- Boards with card voting, RSVP, threaded discussion, and @mentions

---

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles, phone, referral_code |
| `preferences` | User preference settings (categories, price tiers, travel) |
| `subscriptions` | Subscription tier, trial, referral bonus months |

### Social Tables

| Table | Purpose |
|-------|---------|
| `friend_requests` | Friend request lifecycle |
| `friends` | Bidirectional friendship records |
| `blocked_users` | User blocks |
| `pending_invites` | Phone invites for non-app users |
| `pending_session_invites` | Collaboration session invites for non-app users |
| `referral_credits` | Referral credit audit log |

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
| `ticketmaster_events_cache` | Cached Ticketmaster events |

---

## Edge Functions

### Experience Generation

| Function | Purpose |
|----------|---------|
| `generate-experiences` | AI-powered place recommendations |
| `generate-curated-experiences` | Multi-stop itinerary generation |
| `generate-session-experiences` | Collaboration session recommendations |
| `discover-experiences` | Explore/discover tab |
| `refresh-place-pool` | Daily card pool refresh |

### Social and Notifications

| Function | Purpose |
|----------|---------|
| `lookup-phone` | Phone number lookup for friend search |
| `process-referral` | Manual referral credit reconciliation |
| `send-collaboration-invite` | Push notifications for session invites |

### Events

| Function | Purpose |
|----------|---------|
| `ticketmaster-events` | Ticketmaster event proxy |

---

## Environment Variables

### Mobile App (`app-mobile/.env`)

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
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

# 6. Start Expo
npx expo start

# 7. Test on physical device (Android/iPhone)
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

- **Friends and Collaboration Onboarding** -- Phone-based friend adding and session creation during onboarding flow
- **Subscription System** -- Free/Pro/Elite tiers with trial and referral rewards via Stripe Connect
- **Universal Links** -- Deep linking via usemingla.com for invites and board URLs
- **Phone-Based Invites** -- Invite non-app users by phone, auto-resolve on signup
- **In-App Phone Invites** -- Send collaboration invites to any phone number

---

## License

This project is proprietary. All rights reserved.
