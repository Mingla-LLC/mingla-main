# Mingla — AI-Powered Experience Discovery Platform

Mingla is a full-stack, AI-driven experience discovery platform that recommends personalized activities, events, and places based on preferences, location, social context, budget, and travel constraints. The platform ships as a **React Native (Expo) mobile app** backed by a **Supabase backend** (PostgreSQL, Edge Functions, Realtime subscriptions, Row-Level Security) and integrates **OpenAI GPT-4o-mini**, **Google Places API (New)**, **Ticketmaster Discovery API**, and **OpenWeather API**.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Mobile App — Feature Inventory](#mobile-app--feature-inventory)
5. [Navigation Architecture](#navigation-architecture)
6. [Experience Categories (v3)](#experience-categories-v3)
7. [Card Pool Data Pipeline](#card-pool-data-pipeline)
8. [Supabase Backend](#supabase-backend)
9. [Edge Functions — Complete Inventory](#edge-functions--complete-inventory)
10. [Database Schema](#database-schema)
11. [Authentication & Security](#authentication--security)
12. [State Management](#state-management)
13. [Custom Hooks — Complete Inventory](#custom-hooks--complete-inventory)
14. [Services Layer — Complete Inventory](#services-layer--complete-inventory)
15. [Type System](#type-system)
16. [Constants & Design System](#constants--design-system)
17. [Utilities](#utilities)
18. [Component Library](#component-library)
19. [AI & External Integrations](#ai--external-integrations)
20. [Project Structure](#project-structure)
21. [Dependencies](#dependencies)
22. [Build & Deployment](#build--deployment)
23. [Development Workflows](#development-workflows)
24. [Contributing](#contributing)
25. [License](#license)

---

## Project Overview

Mingla combines **location-aware discovery**, **AI personalization**, **real-time social collaboration**, and a **pool-first card pipeline** into a single mobile experience. Users swipe through AI-generated experience cards produced from real Google Places data, plan outings with friends on collaborative boards, manage their calendar, message connections, and track their activity — all within a cohesive orange-themed UI.

### What Makes Mingla Different

| Capability | Details |
|---|---|
| **Pool-First Card Pipeline** | Pre-built cards stored in `card_pool` are served with zero API calls. Only when the pool is exhausted does the system fall back to Google Places. This eliminates most per-request costs while keeping content fresh via daily `refresh-place-pool` maintenance. |
| **AI-Generated Cards** | Every recommendation card is enriched by OpenAI GPT-4o-mini using real Google Maps Places data, Ticketmaster events, weather forecasts, and the user's learned preference profile. |
| **12 Experience Categories** | Nature, First Meet, Picnic, Drink, Casual Eats, Fine Dining, Watch, Creative & Arts, Play, Wellness, Groceries & Flowers, Work & Business — each with dedicated Google Places type mappings, intent compatibility, and UX theming. |
| **Collaborative Sessions** | Users create named sessions, invite friends, swipe cards together in real time, vote/RSVP on a shared board, and chat within card-level discussion threads — all powered by Supabase Realtime. |
| **Curated Multi-Stop Itineraries** | AI-generated 3-stop itinerary cards (e.g., "Solo Adventure") interleaved in the solo swipe deck with stop timelines, travel durations, and per-stop detail. |
| **Ticketmaster Night Out** | The Night Out section shows real live events from the Ticketmaster Discovery API with genre/date/price filtering and in-app ticket purchasing. |
| **Discover Tab** | A daily-refreshing, location-aware feed of curated experiences organized by all 12 categories, holidays, and night-out options with city-specific AI enrichment. |
| **Behavioral Learning** | Every swipe, view, save, and share is recorded via `user_interactions`. A trigger-driven `user_preference_learning` table continuously refines the user's affinity scores across categories, times, and price bands. |
| **Deck Batch History** | Users can navigate back through previous swipe batches. History is persisted to Zustand/AsyncStorage and restored across sessions. |
| **Custom Navigation** | Entirely custom state-driven navigation (no React Navigation library). Auth state gates screen selection; modals overlay on tab-based pages; collaboration sessions create a secondary "mode" layer. |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Mobile Client                              │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  React Native (Expo SDK 54) + TypeScript                      │  │
│  │  React Query v5 (server cache) · Zustand (client state)       │  │
│  │  Custom State-Driven Navigation (NO React Navigation)         │  │
│  └─────────────────────┬──────────────────────────────────────────┘  │
└────────────────────────┼─────────────────────────────────────────────┘
                         │  Supabase JS SDK
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Supabase Platform                             │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │  Auth (JWT)   │  │  Realtime    │  │  Storage (avatars)        │  │
│  │  Email/Pass   │  │  Presence    │  │  RLS-protected bucket     │  │
│  │  Phone OTP    │  │  Broadcasts  │  └───────────────────────────┘  │
│  │  Google OAuth │  │  Typing      │                                 │
│  │  Apple Sign-In│  └──────────────┘                                 │
│  └──────────────┘                                                    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  PostgreSQL Database (Row Level Security · Triggers)          │    │
│  │  Core: profiles, preferences, experiences, saves              │    │
│  │  Pipeline: place_pool, card_pool, user_card_impressions       │    │
│  │  Social: friends, conversations, messages, blocked_users      │    │
│  │  Collab: collaboration_sessions, session_participants, boards │    │
│  │  Cache: google_places_cache, ticketmaster_events_cache,       │    │
│  │         discover_daily_cache                                  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  Edge Functions (25+ Deno/TypeScript)                         │    │
│  │  Shared: cardPoolService · categoryPlaceTypes · placesCache   │    │
│  │  Pipeline: new-generate-experience- · discover-[category]-    │    │
│  │  AI: enhance-cards · ai-reason · generate-curated-experiences │    │
│  │  Events: ticketmaster-events · holiday-experiences            │    │
│  │  Social: send-collaboration-invite · send-friend-request-email│    │
│  │  Maintenance: refresh-place-pool (daily)                      │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
           │                │                 │                │
           ▼                ▼                 ▼                ▼
    ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐
    │  OpenAI    │  │ Google Maps  │  │ Ticketmaster │  │ Resend   │
    │  GPT-4o   │  │  Places API  │  │ Discovery v2 │  │ (Email)  │
    │  mini     │  │  (New)       │  │              │  │          │
    └────────────┘  └──────────────┘  └──────────────┘  └──────────┘
                                                              │
                    ┌──────────────┐                          │
                    │ OpenWeather  │                          │
                    │  API         │                          │
                    └──────────────┘                          │
```

### Data Pipeline Flow

```
User Request (batchSeed=N) → Edge Function (Deno)
    ↓
[1] Query preferences (DB)
    ↓
[2] Query card_pool with offset (batchSeed × limit)
    ├── Filter: categories, geo (lat±δ, lng±δ), budget, card_type
    ├── Exclude: user_card_impressions (session-scoped: since last pref change)
    ├── Dedup: by google_place_id
    ├── If pool ≥ limit at offset → SERVE DIRECTLY (0 API calls)
    ├── If pool < limit at offset → Try nextPageToken expansion
    │   ├── Check google_places_cache for entries with next_page_token
    │   ├── Fetch next page from Google (pageToken-only request)
    │   ├── Insert new places into place_pool + card_pool
    │   └── Retry pool query
    └── If still < limit → Gap analysis (batch Google Places)
    ↓
[3] Record impressions (user_card_impressions)
    ↓
[4] Return cards + hasMore flag to mobile → SwipeableCards deck
```

---

## Tech Stack

### Mobile App (`app-mobile/`)

| Layer | Technology | Version |
|---|---|---|
| Framework | React Native + Expo SDK | 0.81.4 / SDK 54 |
| Language | TypeScript (strict mode) | ~5.9 |
| Router | Expo Router (file-based) | ~6.0.10 |
| Server State | TanStack React Query | v5.90 |
| Client State | Zustand (persisted to AsyncStorage) | v5.0.8 |
| Backend Client | Supabase JS SDK | v2.74 |
| Animations | React Native Reanimated | v4.1.5 |
| Gestures | React Native Gesture Handler | ~2.28 |
| Location | Expo Location | ~19.0.7 |
| Camera | Expo Camera + Image Picker + Image Manipulator | ~17.0.8 |
| Auth (Google) | @react-native-google-signin | v16.0 |
| Auth (Apple) | expo-apple-authentication | v8.0.7 |
| Haptics | Expo Haptics | ~15.0.7 |
| Notifications | Expo Notifications | ~0.32.12 |
| Calendar | Expo Calendar | ~15.0.7 |
| Images | Expo Image (with fallback component) | ~3.0.8 |
| QR Codes | react-native-qrcode-svg | v6.3.21 |
| Web Views | React Native WebView (OAuth flow) | v13.16 |
| Offline Storage | @react-native-async-storage | v2.2.0 |
| Date Picker | @react-native-community/datetimepicker | v8.5.0 |
| Icons | Expo Vector Icons (Ionicons) | ~15.0.2 |
| Safe Area | react-native-safe-area-context | ~5.6.0 |

### Backend (`supabase/`)

| Layer | Technology |
|---|---|
| Database | PostgreSQL (Supabase-managed) with 100+ migrations |
| API | Auto-generated REST (PostgREST) + Realtime (WebSocket) |
| Edge Functions | 25+ Deno/TypeScript serverless functions |
| Auth | Supabase Auth with JWT + RLS |
| Storage | Supabase Storage (avatars bucket) |
| Email | Resend API (transactional emails) |

---

## Mobile App — Feature Inventory

### 1. Authentication & Onboarding

| Feature | Description |
|---|---|
| **Welcome Screen** | Branded entry with sign-in / sign-up options |
| **Email + Password** | Traditional auth via Supabase Auth |
| **Phone (OTP)** | Phone number sign-up with SMS verification code |
| **Google OAuth** | Google sign-in via WebView-based OAuth flow with `expo-web-browser` |
| **Apple Sign-In** | Native Apple authentication on iOS (uses `expo-apple-authentication`) |
| **Email OTP Verification** | Post-signup email verification screen (skipped for OAuth users) |
| **11-Step Onboarding** | Welcome → Account Setup (name, username, photo) → Intent Selection (adventurous, romantic, business, etc.) → Vibe Selection (12 categories) → Location Setup (GPS permission) → Travel Mode (walking/driving/transit/cycling) → Travel Constraint (time or distance) → Budget Range ($25/$50/$100/$150 presets) → Date/Time Preference → Invite Friends → Magic (loading animation) |
| **Account Types** | Explorer (consumer) or Curator (content creator) — chosen during sign-up |
| **Onboarding Persistence** | `has_completed_onboarding` flag in DB; step progress tracked via `onboarding_step` |

### 2. Home / Explore Tab — Swipeable Card Deck

| Feature | Description |
|---|---|
| **AI-Generated Experience Cards** | Full-bleed image cards with title, category badge, rating, distance, price range, match score |
| **Swipe Mechanics** | Swipe right = like/save, swipe left = dislike/skip, swipe up = expand details. Pan responder with gesture handler. |
| **Card Stack Preview** | Visual card stack showing next cards behind the current one |
| **Curated Multi-Stop Cards** | 3-stop itinerary cards (e.g., "Solo Adventure") interleaved every 3rd regular card. Discriminated via `cardType: 'curated'` |
| **Expanded Card Modal** | Rich detail view: image gallery, description, highlights, practical details (hours, parking, transit), match breakdown, weather forecast, busyness forecast, companion stops, timeline, action buttons |
| **Companion Stops** | AI-suggested nearby stops paired with the main experience |
| **Weather Section** | Real-time weather for outdoor recommendations (from OpenWeather API) |
| **Busyness Forecast** | Crowd level predictions by time of day |
| **Match Score Breakdown** | Visual breakdown of recommendation factors: location, budget, category, time, popularity |
| **Experience Feedback Modal** | Post-interaction feedback ("too expensive", "too far", etc.) stored in `experience_feedback` |
| **Deck Batch Navigation** | Navigate forward/backward through batch history. Pre-fetch triggers at 75% card consumption. Batches persisted to Zustand/AsyncStorage. Replace-not-append batch transitions: each new batch fully replaces the old one, preventing unbounded array growth and dedup deadlocks. Two-tier batch timeout: 10s "Still loading..." intermediate state, 30s hard exhaustion timeout. Late-arriving batches automatically recover the deck. Pool re-warms on preference changes for fast first-batch serving. |
| **Dismissed Cards Review** | When the deck is exhausted, users can review all left-swiped cards in a scrollable bottom sheet. Each card shows thumbnail, title, category, rating, and distance with "Reconsider" (re-add to deck) and "Save" (bookmark) actions. Tapping a card opens the full ExpandedCardModal. Haptic feedback on actions. List clears on preference change. |
| **Solo vs. Collaboration Mode** | Toggle between personal recommendations and session-scoped cards via CollaborationSessions pill bar |
| **Skeleton Loading** | Shimmer placeholder cards while deck generates |

### 3. Discover Tab

| Feature | Description |
|---|---|
| **Personalized Daily Feed** | AI-generated grid of 2 hero cards (user's top 2 preferred categories, defaulting to Fine Dining + Play) + grid cards for remaining selected categories. Hero and grid categories are driven by user preferences — changing preferences refreshes the feed within 3 seconds. Cached in `discover_daily_cache` (24h TTL) with per-preference-set cache keys so switching preferences back serves from cache instantly. Pool-first path enforces per-category round-robin diversity via a 3-pass selection algorithm (extract heroes → one-per-category → fill remaining). "Policies & Reservations" button opens Google Maps for each venue via `placeId` |
| **Category Browsing** | Horizontal category pills for all 12 categories with Ionicon icons and brand colors |
| **Holiday Experiences** | Reads device calendar for upcoming holidays (falls back to 15 hardcoded holidays). Each holiday maps to primary + secondary categories. Gender-specific holidays (Mother's Day → feminine gifts, Father's Day → masculine activities) |
| **Night-Out Section (Ticketmaster)** | Real live events from Ticketmaster Discovery API. Genre filter (server-side GENRE_TO_KEYWORDS map), date filter (getDateRange → startDate/endDate), price filter (client-side priceMin/priceMax). "Get Tickets" opens in-app browser via `expo-web-browser` |
| **Saved People** | Add special people (partner, friends) and see personalized holiday gift / date ideas |
| **Custom Holidays** | Users can add personal celebrations (anniversaries, birthdays) |
| **City-Specific Content** | Location-aware — adapts to user's current city |
| **Search & Filters** | Date picker, budget filters, category filters |

### 4. Connections Tab

| Feature | Description |
|---|---|
| **Friends List** | All connections with online/offline/away status indicators |
| **Friend Requests** | Send (by username or email), receive, accept, decline friend requests. Email notification via `send-friend-request-email` edge function |
| **Add Friend Modal** | Search by username or email with suggestion list |
| **Direct Messaging** | Real-time 1:1 chat with friends. Supports text, images, and file attachments |
| **Conversation List** | All active conversations with unread counts, last message preview, timestamps |
| **Message Read Receipts** | Track message read status via `board_message_reads` |
| **Block User** | Block/unblock with cascading effects on messages and visibility. Reason tracking (spam, harassment, etc.) |
| **Mute User** | Mute conversations without blocking |
| **Report User** | In-app reporting system with category selection |
| **Profile Visibility** | Privacy controls: visible, friends-only, hidden |
| **Local Caching** | Connections cached with version control (`CONNECTIONS_CACHE_VERSION`) for instant rendering |

### 5. Likes Tab

| Feature | Description |
|---|---|
| **Scheduled Experiences** | Calendar view of scheduled activities with date grid and time slots |
| **Calendar Integration** | Export to device calendar via Expo Calendar. Date proposal system with weekend day selection |
| **Experience Reviews** | Prompted to review past scheduled experiences. `usePendingReviews` hook checks on mount + app foreground, waits 10 seconds, then shows modal (once per return to app) |
| **QR Code Display** | QR codes for in-store/mobile payments on purchased experiences |

### 6. Activity Tab

| Feature | Description |
|---|---|
| **Boards Tab** | All collaborative boards/sessions with status, participant count, unread messages, gradient backgrounds |
| **Saved Tab** | All saved/liked experience cards with filtering by category/experience type/date range, sort options |
| **Calendar Tab** | Scheduled experiences on date grid. Archive functionality. Propose new dates |
| **Board View Screen** | Full board experience: header with participant avatars, settings dropdown, tabs for cards/discussion |
| **Board Cards** | Swipeable session cards with vote counts, RSVP status |
| **Board Discussion** | Threaded messaging per board with typing indicators, @mentions (autocomplete popover), card-level discussions |
| **Board Settings** | Rename, manage members (promote admin, kick), invite new participants, leave session |
| **Board Preferences** | Per-session budget, category, and travel constraint overrides |
| **Vote & RSVP** | Vote on cards, RSVP to scheduled experiences |
| **Date Proposal** | Propose specific dates/times for cards, see group availability via DateOptionsGrid |

### 7. Profile Tab

| Feature | Description |
|---|---|
| **Profile Page** | Avatar (uploadable via camera or photo library), display name, username, account type badge, join date, stats (saved, boards, connections, visited) |
| **Gamified Stats** | Achievements, streaks, interaction stats, milestone tracking via `useEnhancedProfile` |
| **Profile Settings** | Edit first name, last name, username, profile photo. Identity updates synced to Supabase |
| **Account Settings** | Currency selection (50+ currencies: USD, EUR, GBP, NGN, JPY, INR, etc.), measurement system (Metric/Imperial), notification toggle |
| **Privacy Controls** | Profile visibility mode, location sharing, budget sharing, category sharing, date/time sharing toggles |
| **Blocked Users** | View and manage blocked users list with unblock |
| **Terms of Service** | Full in-app legal terms rendered in WebView |
| **Privacy Policy** | Full in-app privacy policy rendered in WebView |
| **Sign Out** | Clears all local state, AsyncStorage, Zustand store, React Query cache |
| **Delete Account** | Calls `delete-user` Edge Function to cascade-remove all user data across all tables |

### 8. Collaboration Sessions

| Feature | Description |
|---|---|
| **Session Pills Bar** | Horizontal scrollable bar at top of Home showing: Solo button (always available), active sessions (orange), sent invites (grey), received invites (pulsing) |
| **Create Session** | Named sessions with multi-friend selection from connections list. 3-step flow: details → friends → confirm |
| **Invite Flow** | Send invitations to friends. Email notification via `send-collaboration-invite`. Invitee sees pending pill, inviter sees active pill |
| **Accept / Decline / Cancel** | Full invite lifecycle management. Accept → update status → add participant → create board (idempotent) |
| **Session-Scoped Cards** | Cards generated for group's combined preferences (widest budget, union of categories, majority travel mode, centroid location) |
| **Real-time Sync** | Session state, votes, messages, presence, and typing indicators sync via Supabase Realtime channels |
| **Auto-Cleanup** | Sessions with fewer than 2 accepted participants are automatically deleted (DB trigger) |
| **Board Integration** | Each session has an associated board for persistent card voting, discussion, and scheduling |

### 9. Preferences System

| Feature | Description |
|---|---|
| **Preferences Sheet** | Bottom sheet modal with collapsible sections |
| **Categories** | 12 experience categories with Ionicon icons and brand colors. All categories always visible regardless of intent selection — curated pills and category pills are fully independent selection layers |
| **Experience Types** | Intent-based: adventurous, romantic, friendly, group-fun, business, first-dates, solo-adventure, picnic-dates |
| **Budget Presets** | Quick-select: $25 / $50 / $100 / $150 (updated from old $100/$200/$500 presets) |
| **Group Size** | People count selector |
| **Travel Mode** | Walking, driving, transit, cycling |
| **Travel Constraint** | Time-based (minutes) or distance-based (km/miles) |
| **Date/Time** | Now, Tonight, This Weekend, or exact date/time picker. "Anytime" flexible option |
| **GPS Toggle** | Toggle between GPS-derived and manually-entered location. `use_gps_location` persisted to DB |
| **Collaboration Preferences** | Per-session preference overrides (same UI, different storage) |
| **Preference Change → Impression Reset** | Changing any preference updates `preferences.updated_at`, which resets the "seen" boundary in `user_card_impressions` |

### 10. Notifications

| Feature | Description |
|---|---|
| **In-App Notification System** | Custom notification bar with auto-dismiss, tap-to-navigate actions |
| **Push Notifications** | Expo Notifications for background alerts |
| **Friend Request Alerts** | Real-time polling for incoming friend requests |
| **Board Invite Alerts** | Notifications for session invitations |
| **Unread Badges** | Tab badges on Connect (DM unread) and Likes (board message unread) |
| **Notification Modal** | Full notification history with sections: Today, Earlier, This Week. Tap navigates to relevant screen |
| **Smart Delivery** | `smartNotificationService` for intelligent notification timing |

### 11. Coach Map / Guided Tour

| Feature | Description |
|---|---|
| **Interactive Tutorial** | 5-step overlay highlighting UI elements on first launch |
| **Target Elements** | Preferences button, collaborate button, session pills, navigation tabs |
| **Welcome Dialog** | "Welcome to Mingla" modal with "Start tour" / "Skip" options |
| **Floating Help Button** | Dismissable help button re-triggers the welcome dialog |
| **Completion Tracking** | Tour status (`completed` / `skipped`) stored in profile |

### 12. Debug & Feedback

| Feature | Description |
|---|---|
| **Debug Modal** | 5-tap hidden gesture (configurable tap count + 2000ms window) opens diagnostic panel |
| **App Feedback Modal** | In-app feedback form (rating, message, category) triggered after 3 days, re-prompted every 30 days |
| **Experience Feedback** | Per-card feedback stored in `experience_feedback` table |
| **Profile Debug** | `profile-debug.ts` utility for querying and logging profile data from Supabase |

### 13. Offline & Performance

| Feature | Description |
|---|---|
| **React Query Persistence** | Server state cached to AsyncStorage via `@tanstack/query-async-storage-persister` with 24-hour TTL |
| **Card Pool Pipeline** | Pre-built cards served from `card_pool` with zero API calls. Gap-fill from Google Places on demand |
| **Cards Cache Context** | In-memory + AsyncStorage cache with 30-minute expiration, 10-entry LRU limit. Hash-based cache keys with ~1km location precision |
| **Discover Daily Cache** | Server-side `discover_daily_cache` table with 24h TTL |
| **Google Places Cache** | `google_places_cache` table with 24h TTL, keyed by (place_type, location_key, radius_bucket) |
| **Ticketmaster Cache** | `ticketmaster_events_cache` table with 2-hour TTL |
| **Offline Indicator** | Visual indicator when network is unavailable |
| **Network Monitor** | `networkMonitor` service tracking connectivity state |
| **Skeleton Cards** | Shimmer-animated loading placeholders |
| **Offline Preferences** | `offlineService` reads/writes preferences to AsyncStorage for instant startup |

---

## Navigation Architecture

Mingla uses a **custom state-driven navigation system** — no React Navigation library. The root component (`app-mobile/app/index.tsx`, 2,613 lines) orchestrates all screen transitions through React state, Zustand, and React Query.

### Screen Decision Tree

```
┌─ Auth Loading?
│  └─ YES → Splash / loading screen
│
├─ Authenticated?
│  └─ NO → SignInPage (WelcomeScreen → SignIn / SignUp forms)
│
├─ Profile loaded?
│  └─ NO → SignInPage
│
├─ Needs Email Verification? (non-OAuth users)
│  └─ YES → EmailOTPVerificationScreen
│
├─ Needs Onboarding?
│  └─ YES → OnboardingFlow (11 steps)
│
└─ All good → MainTabs + Bottom Navigation
```

### Tab Structure (Bottom Navigation Bar)

| Tab | Ionicon | State Value | Component |
|-----|---------|-------------|-----------|
| Explore | `home-outline` | `"home"` | `HomePage.tsx` |
| Discover | `compass-outline` | `"discover"` | `DiscoverScreen.tsx` |
| Connect | `people-outline` | `"connections"` | `ConnectionsPage.tsx` |
| Likes | `heart-outline` | `"likes"` | `LikesPage.tsx` |
| Profile | `person-outline` | `"profile"` | `ProfilePage.tsx` |

Active tab highlighted in orange (`#eb7825`), inactive in gray (`#9CA3AF`). Unread message badges on Connect and Likes.

### Sub-Pages (via `setCurrentPage`)

| Page | State Value | Component |
|------|-------------|-----------|
| Activity | `"activity"` | `ActivityPage.tsx` |
| Board View | `"board-view"` | `BoardViewScreen.tsx` |
| Saved | `"saved"` | `SavedExperiencesPage.tsx` |

### Modal / Overlay System

Full-screen overlays render above main content when their state flag is `true`:

| Overlay | Trigger | Component |
|---------|---------|-----------|
| Preferences | Header button or session management | `PreferencesSheet.tsx` |
| Collaboration | Create session button | `CollaborationModule.tsx` |
| Terms of Service | Profile settings | `TermsOfService.tsx` |
| Privacy Policy | Profile settings | `PrivacyPolicy.tsx` |
| Account Settings | Profile settings | `AccountSettings.tsx` |
| Profile Settings | Profile page | `ProfileSettings.tsx` |
| Onboarding | First launch / forced | `OnboardingFlow.tsx` |

Floating/content modals:

| Modal | Component |
|-------|-----------|
| Share | `ShareModal` |
| Feedback | `FeedbackModal` |
| Experience Review | `ExperienceReviewModal` |
| Coach Map | `CoachMap` |
| Debug | `DebugModal` (5-tap gesture) |
| Notifications | `NotificationsModal` |
| Friend Requests | `FriendRequestsModal` |
| Welcome Dialog | Modal with start tour / skip |

### Session/Collaboration State Layer

```typescript
currentMode: "solo" | string   // "solo" or session name
currentSessionId: string | null // null if solo, UUID if in session
```

Switching sessions changes the card generation pipeline: solo mode uses `useDeckCards` (pool-first), collaboration mode uses `useRecommendationsQuery` with combined participant preferences.

### Provider Nesting Order

```
PersistQueryClientProvider (React Query offline)
  └─ CardsCacheProvider (card caching)
       └─ RecommendationsProvider (experience generation engine)
            └─ MobileFeaturesProvider (feature flags)
                 └─ NavigationProvider (modal state)
                      └─ AppContent (main render tree)
```

---

## Experience Categories (v3)

Mingla supports **12 richly-defined experience categories**, each with verified Google Places API (New) type mappings (February 2026 taxonomy), intent compatibility, and UX theming. All invalid/fabricated types removed in v3 — every type has been verified against Google's Table A.

| Slug | Display Name | Color | Ionicon | Google Places Types (Primary) |
|------|-------------|-------|---------|-------------------------------|
| `nature` | Nature | `#10B981` | `leaf-outline` | park, national_park, hiking_area, botanical_garden, state_park, zoo |
| `first_meet` | First Meet | `#6366F1` | `chatbubbles-outline` | cafe, coffee_shop, tea_house, ice_cream_shop, dessert_shop, bakery |
| `picnic` | Picnic | `#84CC16` | `basket-outline` | park, picnic_ground, garden, botanical_garden, national_park |
| `drink` | Drink | `#F59E0B` | `wine-outline` | bar, wine_bar, cocktail_bar, pub, coffee_shop, brewery, night_club |
| `casual_eats` | Casual Eats | `#F97316` | `fast-food-outline` | restaurant, fast_food_restaurant, hamburger_restaurant, pizza_restaurant, ramen_restaurant |
| `fine_dining` | Fine Dining | `#7C3AED` | `restaurant-outline` | fine_dining_restaurant, french_restaurant, italian_restaurant, steak_house, seafood_restaurant |
| `watch` | Watch | `#3B82F6` | `film-outline` | movie_theater, performing_arts_theater, comedy_club, live_music_venue, concert_hall |
| `creative_arts` | Creative & Arts | `#EC4899` | `color-palette-outline` | art_gallery, museum, art_studio, art_museum, performing_arts_theater, cultural_center |
| `play` | Play | `#EF4444` | `game-controller-outline` | bowling_alley, amusement_park, water_park, video_arcade, amusement_center, miniature_golf_course |
| `wellness` | Wellness | `#14B8A6` | `body-outline` | spa, massage, sauna, wellness_center, yoga_studio, massage_spa |
| `groceries_flowers` | Groceries & Flowers | `#22C55E` | `cart-outline` | grocery_store, supermarket, farmers_market, garden_center |
| `work_business` | Work & Business | `#64748B` | `briefcase-outline` | cafe, coffee_shop, tea_house |

### Category Definition Structure

Each category in `constants/categories.ts` includes:

```typescript
{
  slug: string,
  name: string,
  icon: string,
  description: string,
  detailedDescription: string,
  expectedActivities: string[],
  apiMapping: {
    googlePlaces: { coreAnchors: string[], attributes: string[] },
    eventbrite: { eventTypes: string[] }
  },
  logic: {
    hardFilter: object,
    pairingRule: object,
    hierarchy: 'broad' | 'niche',
    fallbackBehavior: object
  },
  ux: {
    activeColor: string,
    subcategories: string[],
    contextualPreview: string
  },
  compatibility: {
    compatibleWith: string[],
    incompatibleWith: string[]
  },
  activityType: 'stationary' | 'mobile' | 'mixed',
  duration: 'short' | 'medium' | 'long'
}
```

### Intent → Category Relationship

As of the Deck Pipeline Overhaul (2026-03-02), curated intent pills and category pills are **fully independent selection layers** on the mobile client. There is no compatibility matrix restricting which categories are visible when intents are selected. Users can select any combination of intents (Romantic, Group Fun, First Date, etc.) AND any combination of categories simultaneously. The curated experience engine on the server side knows which place types to pair for each intent — the mobile client does not enforce restrictions.

### Database Default

```sql
ARRAY['Nature', 'Casual Eats', 'Drink']
```

### Legacy Category Migration

| Old Name | New Name |
|----------|----------|
| Stroll / Take a Stroll | Nature |
| Sip & Chill | Drink |
| Screen & Relax | Watch |
| Creative & Hands-On | Creative & Arts |
| Picnics | Picnic |
| Play & Move | Play |
| Dining / Dining Experience | Fine Dining |

---

## Card Pool Data Pipeline

The card pool pipeline replaces direct Google API calls with pool-first serving. Pre-built cards stored in `card_pool` are served with zero API calls. Only when the pool is exhausted does the system fall back to Google Places.

### Architecture

```
┌──────────────┐     ┌──────────────┐     ┌────────────────────┐
│  place_pool  │────→│  card_pool   │────→│ user_card_impressions│
│  (Google     │     │  (pre-built  │     │ (per-user "seen"    │
│   Places     │     │   cards)     │     │  tracking)          │
│   cache)     │     │              │     │                     │
└──────────────┘     └──────────────┘     └────────────────────┘
       ↑                    ↑                      ↑
       │                    │                      │
  Google Places      Edge Functions         Preference Change
  API (New)          (upsert on gap-fill)   resets boundary
```

### Key Tables

| Table | Purpose | TTL/Refresh |
|-------|---------|-------------|
| `place_pool` | Shared enriched Google Places data. One row per unique `google_place_id` | Daily refresh via `refresh-place-pool` |
| `card_pool` | Pre-built, ready-to-serve cards (`single` or `curated` type) | Deactivated when place deactivates |
| `user_card_impressions` | Per-user card "seen" tracking. `(user_id, card_pool_id)` primary key | Resets when `preferences.updated_at` changes |
| `google_places_cache` | Cached Google Places API responses. Key: `(place_type, location_key, radius_bucket)`. Stores `next_page_token` for pagination and `pages_fetched` counter | 24h TTL |

### Serving Logic (`cardPoolService.ts`)

1. **Query pool with offset**: `card_pool` filtered by categories (array overlap), geo bounds (lat/lng ± delta), budget (price range overlap), excluding user's impressions (session-scoped: all impressions since `preferences.updated_at`). Changing any preference resets the session — previously seen cards become eligible again. **Server-side dedup** by `google_place_id` ensures the same physical place listed under multiple categories only appears once (highest popularity score wins). Applies `offset` parameter to skip cards from previous batches (`batchSeed × limit`)
2. **If pool ≥ 80% of requested limit at offset**: Serve directly (0 API calls). `hasMore` calculated from `totalPoolSize > (offset + limit)`. Cards enriched with real distance/travel time via haversine + estimateTravelMin
3. **If pool exhausted at offset (batchSeed > 0)**: Check `google_places_cache` for entries with `next_page_token`. For each, call `fetchNextPage` which sends a pageToken-only request to Google Places API, appends results to cache, then inserts new places into `place_pool` + `card_pool`. Retry pool query with expanded pool
4. **If pool < 80% of limit**: Gap analysis identifies missing categories, then batch Google Places searches fill gaps. The 80% threshold ensures full batches survive downstream dedup
5. **Batched upsert results**: New places → `place_pool` in a single batched upsert, new cards → `card_pool` in a single batched upsert. This replaces previous sequential per-place inserts, reducing ~80 DB round-trips to exactly 2 calls
6. **Short-circuit on API fetch**: When `serveCardsFromPipeline()` already fetched from Google (fromApi > 0), `discover-cards` returns those cards immediately instead of falling through to a redundant second `batchSearchPlaces()` call
7. **Card format**: All output paths produce API-compatible fields: `priceMin`/`priceMax` (numeric), `distanceKm` (haversine from user), `travelTimeMin` (mode-aware estimate), `isOpenNow` (boolean), `openingHours` (parsed `Record<string, string>`)
8. **Record impressions**: Log `user_card_impressions` via `record_card_impressions` RPC — upserts with `ON CONFLICT DO UPDATE` to bump `created_at`, increment `view_count`, and preserve `first_seen_at`
9. **Return cards**: With metadata: `fromPool` count, `fromApi` count, `totalPoolSize`, `hasMore` flag

### Curated Cards (Multi-Stop Itineraries)

Curated cards are discriminated by `card_type: 'curated'` and include:
- `stop_place_pool_ids: UUID[]` — references to `place_pool`
- `stops: JSONB` — array of stop details (name, type, address, travel time, duration)
- `tagline`, `total_price_min`, `total_price_max`, `estimated_duration_minutes`
- `experience_type` (adventurous, romantic, friendly, group-fun, picnic-dates)

### Daily Refresh (`refresh-place-pool`)

Runs daily to keep `place_pool` data fresh:
- Fetches places not refreshed in 24h
- Calls Google Place Details by ID (FREE — Basic fields only)
- 404/410 → deactivates place + cascades to `card_pool`
- Increments `refresh_failures` on errors

---

## Supabase Backend

### Core Tables

| Table | Purpose |
|---|---|
| `profiles` | User profiles: name, username, avatar, currency, measurement system, visibility, coach map status, account type, onboarding status |
| `preferences` | Per-user settings: budget_min/max, categories[], date_option, time_slot, exact_time, use_gps_location, custom_location, travel_mode, travel_constraint, updated_at |
| `experiences` | Seed/legacy experience catalog: title, category, place_id, coordinates, price, duration, opening hours, metadata |
| `saves` | User-experience save relationships: liked, disliked, saved, unsaved |
| `saved_cards` | Denormalized saved card data for quick access |
| `user_interactions` | Behavioral tracking: view, like, dislike, save, unsave, share, schedule, swipe, tap, click_details |
| `user_location_history` | Location tracking for pattern learning |
| `user_preference_learning` | AI-computed affinity scores per category/time/location with confidence levels |
| `user_sessions` | Analytics sessions grouping related interactions |
| `app_feedback` | In-app feedback submissions (rating, message, category) |
| `experience_feedback` | Per-experience feedback |

### Pipeline Tables

| Table | Purpose |
|---|---|
| `place_pool` | Shared enriched Google Places data. `google_place_id` UNIQUE. Includes: name, address, lat/lng, types[], rating, review_count, price_level, opening_hours, photos, website, raw_google_data, is_active |
| `card_pool` | Pre-built cards (`single` or `curated`). Links to `place_pool` via `place_pool_id` FK. Includes: title, categories[], description, highlights, images, address, lat/lng, rating, popularity_score, base_match_score |
| `user_card_impressions` | Per-user "seen" tracking. PK: `(user_id, card_pool_id)`. Includes `batch_number` and `created_at` |
| `google_places_cache` | Google Places API response cache. Composite key: `(place_type, location_key, radius_bucket, search_strategy, text_query)`. Includes `next_page_token` (TEXT) for pagination and `pages_fetched` (INTEGER) counter. 24h TTL |
| `ticketmaster_events_cache` | Ticketmaster API response cache. Key: `cache_key` TEXT (geo+keywords+date). 2h TTL |
| `discover_daily_cache` | Per-city daily discover feed cache. 24h TTL |
| `saved_people` | Per-user saved people (with optional description for AI). RLS: owner-only. Cascade deletes to `person_experiences` |
| `person_experiences` | AI-generated experiences per person per occasion (birthday, holiday). FK to `saved_people`. RLS: owner via join |

### Social & Messaging Tables

| Table | Purpose |
|---|---|
| `friends` | Friendship relationships with status (pending, accepted, blocked) |
| `blocked_users` | Block relationships with reason enum |
| `muted_users` | Mute relationships |
| `user_reports` | User-submitted abuse reports |
| `conversations` | DM conversation metadata |
| `messages` | Direct messages between users |

### Collaboration Tables

| Table | Purpose |
|---|---|
| `collaboration_sessions` | Named sessions with status lifecycle (pending → active → completed). `created_by` FK |
| `session_participants` | Session membership with `is_admin` flags and acceptance status |
| `collaboration_invites` | Invite lifecycle tracking (pending → accepted/declined) |
| `board_session_preferences` | Per-session preference overrides (separate `categories` and `intents` columns) |
| `board_saved_cards` | Cards added to boards with `card_data` JSONB |
| `board_votes` | User votes on board cards |
| `board_card_rsvps` | RSVP responses for scheduled board cards |
| `board_messages` | Board-level chat messages |
| `board_card_messages` | Card-level discussion threads |
| `board_message_reads` | Message read receipts |
| `board_card_message_reads` | Card message read receipts |
| `board_participant_presence` | Real-time participant presence tracking |
| `board_typing_indicators` | Real-time typing status |
| `board_user_swipe_states` | Per-user swipe state on board cards |

### Calendar

| Table | Purpose |
|---|---|
| `calendar_entries` | Scheduled experiences with date/time, source, card data |

### Entity Relationships

```
auth.users ──┐
             ├── profiles (1:1)
             │     ├── preferences (1:1)
             │     ├── friends (M:N via friends table)
             │     ├── blocked_users (1:M)
             │     ├── muted_users (1:M)
             │     └── user_reports (1:M)
             │
             ├── user_interactions (1:M)
             │     └── trigger → user_preference_learning
             │
             ├── user_card_impressions (1:M → card_pool)
             │
             ├── saves (M:N with experiences)
             ├── saved_cards (1:M)
             ├── calendar_entries (1:M)
             │
             ├── collaboration_sessions (1:M as creator)
             │     ├── session_participants (M:N)
             │     ├── collaboration_invites (1:M)
             │     ├── board_session_preferences (1:M)
             │     ├── board_saved_cards (1:M)
             │     ├── board_votes (1:M)
             │     ├── board_card_rsvps (1:M)
             │     ├── board_messages (1:M)
             │     ├── board_card_messages (1:M)
             │     ├── board_participant_presence (1:M)
             │     └── board_typing_indicators (1:M)
             │
             ├── conversations (M:N)
             │     └── messages (1:M)
             │
             └── app_feedback (1:M)
                   experience_feedback (1:M)

place_pool ──→ card_pool (1:M via place_pool_id FK)
card_pool ──→ user_card_impressions (1:M)
```

### Row Level Security

Every table has RLS enabled with policies enforcing:
- **Ownership**: Users can only read/write their own data
- **Session membership**: Board/session data accessible only to participants
- **Friendship**: Profile visibility respects block lists
- **Authenticated role**: Insert/update restricted to `authenticated` role
- **Service role for pipeline**: `place_pool`, `card_pool` write-only for `service_role`; `authenticated` read-only
- **SECURITY DEFINER functions**: Trigger functions that cross RLS boundaries (e.g., preference learning from interactions)

### Database Triggers

| Trigger | Effect |
|---|---|
| `update_updated_at_column` | Auto-updates `updated_at` on any row modification |
| `update_user_preferences_from_interaction` | AFTER INSERT on `user_interactions` → updates `user_preference_learning` affinity scores (SECURITY DEFINER) |
| `accept_friend_request` | Auto-creates reciprocal friendship on acceptance |
| `add_board_card` | Side effects when cards are added to boards |
| `handle_board_vote` | Processes vote aggregation |
| `auto_create_profile` | Creates profile row on new user sign-up |
| `cleanup_session_under_two_participants` | AFTER DELETE on `session_participants` → auto-deletes sessions below 2 members |
| `sync_invite_inviter_ids` | Keeps `inviter_id` and `invited_by` columns in sync |

### Migrations

100+ incremental SQL migration files spanning January 2025 through March 2026. Key milestones:

| Date | Migration | Purpose |
|------|-----------|---------|
| 2025-01-26 | Initial | Core schema + RLS setup |
| 2025-01-27+ | 80+ files | RLS policies, messaging, boards, avatars, collaboration |
| 2026-02-28 | `20260228000001` | Category system v2 (9→12 categories) |
| 2026-02-28 | `20260228000002` | GPS toggle (`use_gps_location`) |
| 2026-03-01 | `20260301000001` | Google Places cache table |
| 2026-03-01 | `20260301000002` | Card pool pipeline (`place_pool`, `card_pool`, `user_card_impressions`) |
| 2026-03-01 | `20260301000003` | Ticketmaster events cache |
| 2026-03-02 | `20260302000001` | Turbo pipeline optimizations |
| 2026-03-02 | `20260302000003` | Fix google_places_cache UNIQUE constraint (NULL text_query → NOT NULL DEFAULT '') |
| 2026-03-02 | `20260302000004` | Card pool dedup (partial unique index on google_place_id for single cards) |
| 2026-03-02 | `20260302000005` | Saved people + person experiences tables (Add Person → curated experiences) |
| 2026-03-02 | `20260302000006` | Pool pagination: add `next_page_token` (TEXT) and `pages_fetched` (INTEGER) to `google_places_cache` |

---

## Edge Functions — Complete Inventory

### Experience Generation & Discovery (Pool-First)

| Function | Auth | External APIs | DB Tables | Purpose |
|----------|------|---------------|-----------|---------|
| `new-generate-experience-` | No (code) | Google Places, OpenAI | `card_pool`, `place_pool`, `preferences`, `user_card_impressions` | Core pool-first experience generation engine. Serves pre-built cards, gap-fills from Google Places |
| `generate-experiences` | No | Google Places, OpenAI | `experiences`, `card_pool` | Legacy standalone experience generation (pre-pool era) |
| `generate-session-experiences` | No | Google Places, OpenAI | `board_session_preferences`, `card_pool`, `place_pool` | Collaboration mode: aggregates all participants' preferences (widest budget, union categories, majority travel mode, centroid location) |
| `generate-curated-experiences` | JWT | Google Places, OpenAI | `card_pool`, `place_pool`, `user_card_impressions` | 3-stop itinerary builder. Generates stop routes with travel times, AI descriptions, duration estimates |
| `discover-cards` | JWT | Google Places, OpenAI | `card_pool`, `place_pool`, `google_places_cache`, `user_card_impressions` | Unified card discovery — pool-first serving for all 12 categories with offset-based pagination (`batchSeed × limit` skip). When pool exhausted at offset, expands pool via `nextPageToken` pagination from `google_places_cache`, inserts new places into `place_pool` + `card_pool`, and retries. Falls back to Google Places batch search if pool still insufficient. Batch upsert with dedup, fire-and-forget AI enrichment. Returns `hasMore` flag computed from `totalPoolSize > (offset + limit)`. |
| `generate-person-experiences` | JWT | Google Places, OpenAI | `saved_people`, `person_experiences` | Parses person description via OpenAI into interests, finds matching Google Places for each occasion (birthday, holidays), stores curated per-person experiences |
| `discover-experiences` | No | Google Places, OpenAI | `discover_daily_cache`, `card_pool`, `place_pool` | General discovery for all 12 categories with 24h daily cache |
| `discover-casual-eats` | No | Google Places, OpenAI | `discover_daily_cache`, `card_pool` | Category-specific: Casual Eats |
| `discover-creative-arts` | No | Google Places, OpenAI | `discover_daily_cache`, `card_pool` | Category-specific: Creative & Arts |
| `discover-drink` | No | Google Places, OpenAI | `discover_daily_cache`, `card_pool` | Category-specific: Drink |
| `discover-fine-dining` | No | Google Places, OpenAI | `discover_daily_cache`, `card_pool` | Category-specific: Fine Dining |
| `discover-first-meet` | No | Google Places, OpenAI | `discover_daily_cache`, `card_pool` | Category-specific: First Meet |
| `discover-nature` | No | Google Places, OpenAI | `discover_daily_cache`, `card_pool` | Category-specific: Nature |
| `discover-picnic-park` | No | Google Places, OpenAI | `discover_daily_cache`, `card_pool` | Category-specific: Picnic |
| `discover-play` | No | Google Places, OpenAI | `discover_daily_cache`, `card_pool` | Category-specific: Play |
| `discover-watch` | No | Google Places, OpenAI | `discover_daily_cache`, `card_pool` | Category-specific: Watch |
| `discover-wellness` | No | Google Places, OpenAI | `discover_daily_cache`, `card_pool` | Category-specific: Wellness |
| `holiday-experiences` | No | Google Places, OpenAI | `card_pool`, `place_pool` | Holiday-themed cards with hardcoded holidays and category overrides |

### Events & Live Data

| Function | Auth | External APIs | DB Tables | Purpose |
|----------|------|---------------|-----------|---------|
| `ticketmaster-events` | No | Ticketmaster Discovery API v2 | `ticketmaster_events_cache` | Real live events for Night Out tab. 2h cache TTL. Extracts: event name, artist, venue, price, tickets URL, genre |
| `night-out-experiences` | No | Google Places, OpenAI | `card_pool` | Legacy AI-generated nightlife (replaced by Ticketmaster) |
| `weather` | No | OpenWeather API | (in-memory, 5min) | Current weather by lat/lng. Falls back to mock sunny data if no API key |

### AI Enhancement & Reasoning

| Function | Auth | External APIs | Purpose |
|----------|------|---------------|---------|
| `enhance-cards` | No | OpenAI GPT-4o-mini | Card enrichment with personalization context (group size, intents, time window, budget, travel mode). Returns enhanced matchScore, description, highlights |
| `ai-reason` | JWT | OpenAI GPT-4o-mini | Weather-aware recommendations. Returns: `weather_badge`, `adjusted_duration`, `safety_notes`, `indoor_alternative` |

### Maps & Location

| Function | Auth | External APIs | Purpose |
|----------|------|---------------|---------|
| `places` | No | Google Places | General place search by category slug. Falls back to seed `experiences` table |
| `get-companion-stops` | No | Google Places | Nearby companion POIs for multi-stop experiences (default 500m radius). Builds stroll route timeline |
| `get-picnic-grocery` | No | Google Places | Find nearby groceries for picnic planning |
| `get-google-maps-key` | JWT | — | Securely serve Google Maps API key to client |
| `refresh-place-pool` | No (maintenance) | Google Place Details (FREE) | Daily refresh: update stale place_pool entries, deactivate 404/410s, cascade to card_pool |

### Recommendations & Scoring

| Function | Auth | External APIs | Purpose |
|----------|------|---------------|---------|
| `recommendations-enhanced` | No | Google Places, OpenAI | Personalized scoring: category match, budget fit, distance, ratings, user interaction history |
| `recommendations` | No | Google Places, OpenAI | Legacy base recommendation engine |

### Social & Email Notifications

| Function | Auth | External APIs | Purpose |
|----------|------|---------------|---------|
| `send-collaboration-invite` | JWT | Resend | Email invite to join collaboration session. Dynamic HTML template with inviter name, session name, accept/decline links |
| `send-friend-request-email` | JWT | Resend | Friend request email notification. Different templates for existing users vs. signup invitations |
| `send-message-email` | JWT | Resend | DM/mention email notification. Orange-highlighted @mentions, hashtag highlighting |
| `notify-invite-response` | JWT | Resend | Notify inviter of session invite accept/decline |

### User Management

| Function | Auth | Purpose |
|----------|------|---------|
| `delete-user` | JWT | Complete user deletion with cascading cleanup: reassign session admin → remove from participants → auto-delete sessions < 2 members → clean messages/conversations → clean friends → delete profile + auth user |

### Shared Utilities (`_shared/`)

| Module | Purpose |
|--------|---------|
| `cardPoolService.ts` | Core pool-first serving engine with offset-based pagination. `serveCardsFromPipeline()` (accepts `offset` param for batch skip), `serveCuratedCardsFromPool()`, `upsertPlaceToPool()`, `insertCardToPool()`, `recordImpressions()`. `queryPoolCards()` applies offset after impression filtering + dedup, with dynamic fetch limit `Math.max(limit*3, (offset+limit)*2)`. Includes `haversine()`, `estimateTravelMin()`, `parseGoogleOpeningHours()` for computing real distance/travel time and parsing opening hours. All card output paths produce API-compatible numeric fields (`priceMin`, `priceMax`, `distanceKm`, `travelTimeMin`, `isOpenNow`) |
| `categoryPlaceTypes.ts` (210 lines) | Single source of truth: `MINGLA_CATEGORY_PLACE_TYPES` (display name → Google types), `CATEGORY_ALIASES` (all variations), `resolveCategory()`, `getPlaceTypesForCategory()`, `INTENT_IDS`, `filterOutIntents()` |
| `placesCache.ts` (~340 lines) | Google Places API caching: `searchPlacesWithCache()` (single type, stores `nextPageToken`), `fetchNextPage()` (pageToken-only pagination, appends to cache, clears expired tokens), `batchSearchPlaces()` (parallel multi-type). Location key precision: `lat.toFixed(2),lng.toFixed(2)` (~1.1km grid) |
| `textSearchHelper.ts` (57 lines) | Fallback for non-standard place types (e.g., "sip and paint", "cooking classes"). `textSearchPlaces()` with keyword replacement |

---

## Authentication & Security

### Auth Methods

| Method | Implementation | Status |
|---|---|---|
| Email + Password | Supabase Auth | Active |
| Phone + OTP (SMS) | Supabase Auth | Active |
| Google OAuth | WebView flow via `expo-web-browser` → callback to `oauth-redirect/index.html` | Active |
| Apple Sign-In | Native via `expo-apple-authentication` (iOS 13+) | Active |
| Email OTP Verification | Post-signup 6-digit code via `input-otp` component | Active (skipped for OAuth) |

### Security Layers

1. **Supabase Auth (JWT)** — Every API call carries a JWT; `auth.uid()` is the single source of identity
2. **Row Level Security (RLS)** — All tables have RLS enabled. Policies enforce ownership, session membership, friendship-based visibility
3. **Service Role Isolation** — Pipeline tables (`place_pool`, `card_pool`) are write-only for `service_role`; mobile clients get read-only access
4. **SECURITY DEFINER Functions** — Trigger functions that cross RLS boundaries (e.g., writing to `user_preference_learning` from interaction inserts) use explicit `search_path`
5. **Edge Function JWT Verification** — Critical functions (AI reasoning, API key retrieval, email sending, user deletion) require valid JWT. Discovery/weather endpoints are public
6. **OAuth Redirect Page** — Dedicated static page (`oauth-redirect/`) handles OAuth callback token extraction
7. **API Key Proxy** — Google Maps key served via `get-google-maps-key` edge function (JWT-required), never embedded in client code
8. **Account Deletion** — `delete-user` cascade removes all user data across every table
9. **Blocked User Isolation** — Blocking cascades to hide profiles, prevent messages, and remove from conversation views via RLS policies

---

## State Management

### Zustand Store (`appStore.ts`)

Persisted to AsyncStorage with selective `partialize`:

```
Auth State
├── user: User | null
├── isAuthenticated: boolean
└── profile: User | null

User Data
├── preferences: Preferences | null
├── saves: Save[]
└── boards: Board[]

Session State (NOT persisted)
├── currentSession: CollaborationSession | null
├── availableSessions: CollaborationSession[]
├── pendingInvites: CollaborationInvite[]
└── isInSolo: boolean

Card State
├── currentCardIndex: number
└── batchSeed: number

Deck History (persisted)
├── deckBatches: DeckBatch[] (cards + activePills + timestamp per batch)
├── currentDeckBatchIndex: number
├── deckPrefsHash: string (reset trigger)
└── deckSchemaVersion: number (bumped to invalidate stale batches on deploy)

UI State (NOT persisted)
└── showAccountSettings: boolean
```

### React Contexts (3)

| Context | Purpose | Key State |
|---------|---------|-----------|
| `CardsCacheContext` | Local card state persistence. 10-entry Map with 30-minute expiration. Hash-based cache keys with ~1km location precision. AsyncStorage-backed | `getCachedCards()`, `setCachedCards()`, `generateCacheKey()` |
| `NavigationContext` | Modal control and navigation helpers | `isCreateSessionModalOpen`, `isPreferencesModalOpen`, `navigateToConnections()`, `navigateToSaved()` |
| `RecommendationsContext` | Single source of truth for all deck/recommendation cards. Dual-mode (solo/collaboration). Batch history. Pre-fetch at 75% consumption | `recommendations[]`, `batchSeed`, `loading`, `generateNextBatch()`, `restorePreviousBatch()`, `handleDeckCardProgress()` |

### React Query Configuration

```typescript
defaultOptions: {
  queries: {
    staleTime: 5 * 60 * 1000,        // 5 minutes
    gcTime: 24 * 60 * 60 * 1000,      // 24 hours
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }
}
// Persisted to AsyncStorage via @tanstack/query-async-storage-persister
```

---

## Custom Hooks — Complete Inventory

### Authentication & User (4)

| Hook | Purpose | Key Functions |
|------|---------|---------------|
| `useAuth` | Legacy auth hook with manual session management | `signUp()`, `signIn()`, `signOut()`, `updateProfile()` |
| `useAuthSimple` | Enhanced auth with OTP, Google, Apple Sign-In | `signUp()`, `signIn()`, `verifyEmailOTP()`, `signUpWithPhone()`, `verifyPhoneOTP()`, `signInWithGoogle()`, `signInWithApple()`, `signOut()` |
| `useUserProfile` | Profile loading and updates | `loadProfile()`, `updateProfile()`, `uploadAvatar()`, `refreshProfile()` |
| `useUserPreferences` | React Query hook for preferences | Cached with 5-min stale time, 24h cache duration |

### Experience & Cards (9)

| Hook | Purpose | Key Details |
|------|---------|-------------|
| `useDeckCards` | Unified deck cards (solo mode) | Wraps `deckService.fetchDeck()` (parallel category + curated pipelines via `Promise.allSettled`). 30-min stale time. Returns `Recommendation[]` with `deckMode`, `activePills`, and `hasMore` flag |
| `useRecommendationsQuery` | Collaboration mode recommendations | Wraps `ExperienceGenerationService.generateExperiences()`. 1-hour stale time |
| `useCuratedExperiences` | Multi-stop itinerary cards | Supports 7 types: adventurous, first-date, romantic, friendly, group-fun, picnic-dates, take-a-stroll. Background batch `skipDescriptions: true` |
| `useExperiences` | Generic experience fetching (legacy) | `fetchExperiences()`, `fetchNearbyPlaces()`, `saveExperience()`, `getSavedExperiences()` |
| `useSavedCards` | React Query saved cards | Wraps `savedCardsService.fetchSavedCards()` |
| `useSaves` | Manual saves management | `addSave()`, `updateSave()`, `removeSave()`. Real-time Supabase subscriptions |
| `useBoardSavedCards` | Board session cards | Wraps `BoardCardService.getSessionSavedCards()`. Transforms `card_data` to `SavedCard` |
| `useDiscoverQuery` | Discover screen data | 10 grid cards + 2 hero cards (Fine Dining + Play). 1-hour stale, 24h cache |
| `useSavedPeople` | Saved people (Supabase) | CRUD hooks for `saved_people` table. 5-min stale time. Includes `useCreatePerson`, `useDeletePerson`, `usePersonExperiences`, `useGeneratePersonExperiences` |

### Social & Friends (2)

| Hook | Purpose | Key Functions |
|------|---------|---------------|
| `useFriends` | Comprehensive friend management | `fetchFriends()` (bidirectional with batch profile fetch), `loadFriendRequests()`, `addFriend()`, `acceptFriendRequest()`, `declineFriendRequest()`, `removeFriend()`, `blockFriend()`, `unblockFriend()`, `cancelFriendRequest()` |
| `useBlockedUsers` | Block management | `blockUser()`, `unblockUser()`, `isUserBlocked()`, `checkHasBlockBetween()` |

### Board & Collaboration (5)

| Hook | Purpose | Key Functions |
|------|---------|---------------|
| `useBoards` | Board CRUD | `fetchBoards()`, `createBoard()`, `updateBoard()`, `deleteBoard()`, `addCollaborator()`, `removeCollaborator()`. Real-time subscriptions |
| `useBoardSession` | Session preferences and metadata | `loadSession()`, `updatePreferences()`, `getInviteLink()`. Real-time participant updates |
| `useEnhancedBoards` | Advanced board management | `createBoard()`, `updateBoard()`, `addExperienceToBoard()`, `removeExperienceFromBoard()`, `setActiveBoardForCollaboration()` |
| `useSessionManagement` | Complex session orchestration | `loadUserSessions()` (6 parallel queries), `createCollaborativeSession()`, `acceptInvite()` (idempotent), `declineInvite()`, `switchToCollaborative()`, `switchToSolo()`, `cancelSession()`. Real-time on 3 tables |
| `useRealtimeSession` | Legacy session realtime | Parallel to `useSessionManagement` for compatibility |

### Messages & Notifications (2)

| Hook | Purpose | Key Functions |
|------|---------|---------------|
| `useMessages` | Conversation and messaging | `fetchMessages()`, `loadMessages()`, `sendMessage()` (text/image/file), `createConversation()`, `setCurrentConversation()` |
| `useInAppNotifications` | Notification management | `markAsRead()`, `markAllAsRead()`, `clearAll()`, `removeNotification()`. Returns `unreadCount` |

### Activity & Calendar (4)

| Hook | Purpose | Key Details |
|------|---------|-------------|
| `useRecentActivity` | User activity history | Fetches via `userActivityService.fetchRecentActivity()`. Default limit: 20 |
| `useCalendarEntries` | Calendar entries | Wraps `CalendarService.fetchUserCalendarEntries()`. Always fresh (staleTime: 0) |
| `useCalendarHolidays` | Holiday calendar | Reads device calendar, falls back to 15 hardcoded holidays. Maps holiday → primary + secondary category |
| `usePendingReviews` | Day-after review prompts | Checks on mount + app foreground. 10-second delay, once per return to app |

### Profile & Gamification (1)

| Hook | Purpose | Key Functions |
|------|---------|---------------|
| `useEnhancedProfile` | Gamified profile and privacy | `loadGamifiedData()`, `trackActivity()`, `backfillActivityHistory()`, `setExperiencePrivacy()`, `updateProfilePrivacy()`, `checkMilestones()` |

### Utility Hooks (5)

| Hook | Purpose |
|------|---------|
| `usePreferencesData` | Lazy-loading preferences for modal efficiency. Separates data loading from UI rendering. Offline cache support |
| `useUserLocation` | Location with GPS/custom fallback. Reads `use_gps_location` from preferences. Falls back to San Francisco default. Persists to AsyncStorage |
| `useDebounce` | Simple value debouncer. Returns debounced value after delay ms |
| `useKeyboard` | iOS/Android keyboard awareness. Returns `{ isVisible, keyboardHeight, dismiss() }` |
| `useDebugGesture` | 5-tap debug modal trigger. Configurable tap count (5) and window (2000ms) |

---

## Services Layer — Complete Inventory

### Core Authentication & Backend (2)

| Service | Purpose |
|---------|---------|
| `authService.ts` | Profile CRUD: `loadUserProfile()`, `updateUserProfile()`, `uploadAvatar()` |
| `supabase.ts` | Supabase client singleton with auth configuration and 30-second global fetch timeout wrapper via `Promise.race` (reliable on React Native Android where `AbortController.abort()` silently fails) |

### Experience Generation & Cards (9)

| Service | Purpose |
|---------|---------|
| `experienceGenerationService.ts` | Calls edge functions: `generateExperiences()` → new-generate-experience-, `generateSessionExperiences()` → generate-session-experiences, `discoverExperiences()` → discover-experiences |
| `deckService.ts` | Unified deck service: `fetchDeck()` runs category and curated pipelines in parallel via `Promise.allSettled` with 15-second `Promise.race` timeouts. Per-category round-robin interleaving (Nature→Drink→Fine Dining→Nature→...). `warmDeckPool()` → background pool pre-warming with 15s timeout. Returns `{ cards, deckMode, activePills, total, hasMore }` |
| `curatedExperiencesService.ts` | `generateCuratedExperiences()` → generate-curated-experiences. Returns `CuratedExperienceCard[]` |
| `holidayExperiencesService.ts` | `generateHolidayExperiences()` → holiday-experiences |
| `nightOutExperiencesService.ts` | `fetchTicketmasterEvents()` → ticketmaster-events. Returns events with artistName, venueName, ticketUrl, priceRange |
| `savedPeopleService.ts` | CRUD for `saved_people` table + experience generation via `generate-person-experiences` edge function |
| `experiencesService.ts` | User preferences and interaction tracking |
| `savedCardsService.ts` | `fetchSavedCards(userId)` from recommendations |
| `enhancedFavoritesService.ts` | Favorite management with analytics |

### Board & Collaboration (5)

| Service | Purpose |
|---------|---------|
| `boardCardService.ts` | `getSessionSavedCards(sessionId)` — board-saved cards |
| `boardSessionService.ts` | Session-level operations |
| `boardInviteService.ts` | Shareable invite link generation |
| `boardMessageService.ts` | Board messaging operations |
| `boardErrorHandler.ts` | Unified error handling for board operations |

### Social & Connections (4)

| Service | Purpose |
|---------|---------|
| `connectionsService.ts` | User connection management |
| `blockService.ts` | `blockUser(userId, reason)`, `unblockUser()`, `getBlockedUsers()`, `isUserBlocked()`, `hasBlockBetween()` |
| `muteService.ts` | Mute notification management |
| `reportService.ts` | User/content reporting |

### Location & Maps (4)

| Service | Purpose |
|---------|---------|
| `locationService.ts` | Location utilities (legacy) |
| `enhancedLocationService.ts` | `getCurrentLocation()`, `getLastKnownLocation()` with permissions |
| `enhancedLocationTrackingService.ts` | Background location tracking |
| `geocodingService.ts` | Address geocoding |

### Notifications (4)

| Service | Purpose |
|---------|---------|
| `notificationService.ts` | Push notification management |
| `enhancedNotificationService.ts` | Advanced notification handling |
| `smartNotificationService.ts` | Intelligent notification delivery timing |
| `inAppNotificationService.ts` | In-app toast/banner: `subscribe()`, `markAsRead()`, `markAllAsRead()`, `clearAll()` |

### Calendar & Scheduling (2)

| Service | Purpose |
|---------|---------|
| `calendarService.ts` | `fetchUserCalendarEntries(userId)` — scheduled experiences |
| `deviceCalendarService.ts` | Device calendar: `hasPermissions()`, `requestPermissions()`, `getHolidaysFromCalendar(daysAhead)` |

### User Activity & Personalization (4)

| Service | Purpose |
|---------|---------|
| `userActivityService.ts` | `fetchRecentActivity(userId, limit)` |
| `userInteractionService.ts` | Interaction tracking (views, swipes, saves) |
| `enhancedPersonalizationService.ts` | Personalization engine |
| `enhancedProfileService.ts` | Gamified profile: `getGamifiedProfileData()`, `trackActivity()`, `backfillUserActivityHistory()`, `setExperiencePrivacy()`, `updateProfilePrivacy()`, `checkMilestones()` |

### Preferences & Settings (3)

| Service | Purpose |
|---------|---------|
| `preferencesService.ts` | `getUserPreferences()`, `updatePreferences()` — budget, categories, travel, constraints |
| `countryCurrencyService.ts` | Currency by country mapping |
| `currencyService.ts` | Currency conversion |

### Caching & Offline (4)

| Service | Purpose |
|---------|---------|
| `recommendationCacheService.ts` | Card cache management |
| `recommendationHistoryService.ts` | Recent recommendation tracking |
| `boardCache.ts` | Board data caching |
| `offlineService.ts` | Offline persistence: `getOfflineUserPreferences()`, `cacheUserPreferences()` via AsyncStorage |

### Real-time & Sync (2)

| Service | Purpose |
|---------|---------|
| `realtimeService.ts` | Supabase Realtime: `subscribeToBoardSession()`, `subscribeToBoard()`, `subscribeToSession()`, `sendBoardUpdate()`, `sendSessionMessage()`, `unsubscribeAll()` |
| `realtimeRecommendationService.ts` | Real-time recommendation updates |

### Messaging (1)

| Service | Purpose |
|---------|---------|
| `messagingService.ts` | Direct message operations |

### Feedback (1)

| Service | Purpose |
|---------|---------|
| `experienceFeedbackService.ts` | `getPendingReviewEntries(userId)` — unreviewed scheduled experiences |

### Device & System (6)

| Service | Purpose |
|---------|---------|
| `cameraService.ts` | Camera operations (photo capture, library access) |
| `weatherService.ts` | OpenWeather API integration |
| `busynessService.ts` | Location busyness/popularity predictions |
| `bookingService.ts` | Booking integration |
| `translationService.ts` | Translation service |
| `networkMonitor.ts` | Network connectivity state tracking |

### Analytics & Testing (2)

| Service | Purpose |
|---------|---------|
| `debugService.ts` | Debug utilities |
| `abTestingService.ts` | A/B testing framework |

---

## Type System

### Core Types (`src/types/index.ts`)

| Type | Fields | Purpose |
|------|--------|---------|
| `User` | Auth, preferences, visibility, onboarding status | User profile |
| `RecommendationsRequest` | Budget, categories, time window, travel mode, origin | API request structure |
| `RecommendationCard` | Location, pricing, routing, opening hours, ratings | Single experience card |
| `CollaborationSession` | Participants, status, name, created_by | Group planning session |
| `SessionInvite` | Invite status tracking | Invitation lifecycle |
| `ActivePreferences` | Budget, categories, travel, datetime | Current search preferences |
| `Preferences` | Full DB schema: budget_min/max, categories[], use_gps_location, updated_at | Database preferences |
| `Experience` | Title, category, place_id, coordinates, price, duration | Stored experience |
| `Save` | Status (liked/disliked/saved/unsaved), scheduling | User save relationship |
| `Board` | Name, collaborators, status | Shared planning board |
| `ProfileGamifiedData` | Badges, stats, achievements, timeline, milestones | Gamification |

### Recommendation Type (`src/types/recommendation.ts`)

The canonical card type used across the entire deck pipeline:

```typescript
interface Recommendation {
  id: string;
  title: string;
  category: string;
  rating: number;
  budget: string;
  images: string[];
  address: string;
  location: { lat: number; lng: number };
  timeAway: string;
  distance: string;
  travelTime: string;
  experienceType: string;
  description: string;
  highlights: string[];
  tags: string[];
  fullDescription: string;
  views: number;
  likes: number;
  saves: number;
  shares: number;
  matchScore: number;
  matchFactors: MatchFactors;
  website?: string;
  phone?: string;
  placeId?: string;
  openingHours: string | { weekday_text: string[] };
  strollData?: StrollData;           // Multi-stop itinerary
}
```

### Expanded Card Types (`src/types/expandedCardTypes.ts`)

| Type | Purpose |
|------|---------|
| `ExpandedCardData` | Full card details for modal view. Includes strollData, picnicData, nightOutData |
| `WeatherData` | Temperature, condition, humidity, UV index, wind |
| `BusynessData` | Crowd level predictions with popular times |
| `BookingOption` | Integration with OpenTable, Eventbrite, Viator |
| `TimelineStep` | Single activity step (id, title, description, duration, icon) |
| `TimelineData` | Complete activity timeline |

### Curated Experience Types (`src/types/curatedExperience.ts`)

| Type | Purpose |
|------|---------|
| `CuratedStop` | Individual stop: stopLabel, place data, pricing, hours, travel times, aiDescription, estimatedDurationMinutes |
| `CuratedExperienceCard` | Complete itinerary card with all stops array |

---

## Constants & Design System

### Colors (`src/constants/colors.ts`)

| Token | Value | Usage |
|---|---|---|
| `primary` | `#eb7825` | Main brand orange; buttons, active tabs, badges, headers |
| `lightOrange` | `#fef3e8` | Light orange backgrounds, selected states |
| `success` | `#10b981` | Confirmation, online status |
| `error` | `#ef4444` | Errors, destructive actions |
| `gray50`–`gray900` | `#f9fafb`–`#111827` | Text, borders, backgrounds |
| `white` | `#ffffff` | Backgrounds |
| `black` | `#000000` | Text |

### Design System Tokens (`src/constants/designSystem.ts`)

```
Spacing:     xs(4) sm(8) md(16) lg(24) xl(32) xxl(48)
Radius:      sm(8) md(12) lg(16) xl(24) full(999)
Typography:  xs(12) sm(14) base(16) lg(18) xl(20) xxl(24) xxxl(32)
FontWeights: regular(400) medium(500) semibold(600) bold(700)
Shadows:     sm/md/lg/xl with shadowColor, offset, opacity, radius, elevation
Animations:  fast(150ms) normal(300ms) slow(500ms) with easing curves
TouchTargets: minimum(44) comfortable(48) large(56)
```

Common pre-configured styles: card, button, input, heading, body, caption.

### CURATED_EXPERIENCES Constant

Maps experience types to category pairings for curated multi-stop itinerary generation.

### INTENT_IDS Set

Filters out experience intents (adventurous, romantic, business, etc.) before Google Places searches, since intents are not place categories.

---

## Utilities

### Category Utilities (`src/utils/categoryUtils.ts`)

| Function | Purpose |
|----------|---------|
| `getReadableCategoryName()` | Convert translation keys/slugs to display names. Handles legacy keys and old slugs |
| `getCategorySlug()` | Convert to canonical slug |
| `getCategoryIcon()` | Get Ionicon name for category |
| `getCategoryColor()` | Get brand color. Maps: nature→#10B981, drink→#F59E0B, fine_dining→#7C3AED, etc. |

### Card Converters (`src/utils/cardConverters.ts`)

| Function | Purpose |
|----------|---------|
| `shuffleArray()` | Fisher-Yates shuffle |
| `roundRobinInterleave()` | Interleave multiple card arrays while deduping |
| `curatedToRecommendation()` | Convert `CuratedExperienceCard` to `Recommendation` |
| `computePrefsHash()` | Hash preferences for cache key generation |
| `INTENT_IDS` | Set of well-known intent IDs (adventurous, romantic, etc.) |
| `separateIntentsAndCategories()` | Split mixed array into intents vs. category names |

### Animation Utilities (`src/utils/animations.ts`)

`AnimationUtils` class with static methods:
- Physics: `spring()`, `timing()`
- Effects: `fadeIn()`, `fadeOut()`, `slideInFromBottom()`, `slideOutToBottom()`, `bounce()`, `shake()`, `pulse()`
- Composition: `stagger()`, `parallel()`, `sequence()`
- UI: `buttonPress()` (scale down/up sequence)
- Presets: `AnimationPresets` for success, error, loading, modal

### Haptic Feedback (`src/utils/hapticFeedback.ts`)

`HapticFeedback` class with custom patterns:
- Impact: `light()`, `medium()`, `heavy()`
- Notification: `success()`, `warning()`, `error()`
- UI: `selection()`
- Custom: `cardSwipe`, `cardLike`, `cardDislike`, `buttonPress`, `toggleSwitch`, `sliderMove`, `longPress`, `pullToRefresh`, `navigation`, `save`, `delete`, `share`
- Hook: `useHapticFeedback()` for easy access

### Currency Utilities (`src/utils/currency.ts`)

| Function | Purpose |
|----------|---------|
| `getCurrencySymbol()` | Map 50+ currencies to symbols (USD→$, EUR→€, GBP→£, JPY→¥, INR→₹, etc.) |
| `formatNumberWithCommas()` | Thousand separators |
| `formatCurrency()` | Format amount with symbol and commas |
| `formatPriceRangeWithCommas()` | Handle ranges: "$20-40", "$100+" |

### Number Formatting (`src/utils/numberFormatter.ts`)

| Function | Purpose |
|----------|---------|
| `formatDecimal()` | Max 2 decimals, remove trailing zeros |
| `formatToOneDecimal()` | 1 decimal for ratings |
| `formatCoordinates()` | 4 decimals for lat/lng |
| `formatPercentage()` | Percentage with 1 decimal |
| `formatLargeNumber()` | K/M suffixes (1500 → "1.5K") |
| `formatDistance()` | km/miles with m/ft for short distances |
| `formatDuration()` | Minutes to human-readable (90min → "1h 30min") |

### Date Utilities (`src/utils/dateUtils.ts`)

| Function | Purpose |
|----------|---------|
| `formatTimestamp()` | Relative time ("2 hours ago", "3 days ago") |
| `formatMonthYear()` | "Jan 2026" format |
| `formatActivityDate()` | "Jan 10" format for recent activity |

### Preferences Converter (`src/utils/preferencesConverter.ts`)

`convertPreferencesToRequest()` — converts `PreferencesSheetState` to `RecommendationsRequest`:
- Location: current GPS or custom coordinates
- Time window: Now / Tonight / ThisWeekend / Custom
- Travel mode: WALKING / DRIVING / TRANSIT
- Budget and constraint mapping
- Default location fallback: Cary, NC (35.7915, -78.7811)

### Timeline Generator (`src/utils/timelineGenerator.ts`)

`generateTimeline()` — category-specific step-by-step timelines. Example: Stroll → Cafe → Walk → Photo spot → Snack.

### Username Utilities (`src/utils/usernameUtils.ts`)

| Function | Purpose |
|----------|---------|
| `sanitizeUsername()` | Lowercase, alphanumeric + underscore only |
| `generateUsernameFromName()` | "firstname_lastname" + 4-digit random |
| `checkUsernameAvailability()` | Query Supabase profiles |
| `generateUniqueUsername()` | Retry logic with fallback to timestamp |

### Curated Timeline (`src/utils/curatedToTimeline.ts`)

`curatedStopsToTimeline()` — converts `CuratedStop[]` to `TimelineStep[]` with travel segments between stops.

### Cost Converter (`src/utils/costConverter.ts`)

| Function | Purpose |
|----------|---------|
| `convertCostToNumber()` | Parse "$20-40" → 30 (average) |
| `formatCostForDisplay()` | Format for UI |
| `getCostRangeFromPriceLevel()` | Map 1-5 to price ranges |

### Country Codes (`src/utils/countryCodes.ts`)

50+ countries with dial codes, flag emojis, and ISO codes. Popular countries listed first.

---

## Component Library

### Root-Level Components (20+)

| Component | Purpose |
|-----------|---------|
| `HomePage.tsx` | Main swipeable card deck with header, sessions bar, notifications |
| `SwipeableCards.tsx` (79KB) | Master card swiping interface: pan responder, card pooling, curated interleaving, skeleton loading |
| `ExpandedCardModal.tsx` (75KB) | Full-screen card detail: image gallery, weather, busyness, match factors, timeline, actions |
| `PreferencesSheet.tsx` | Bottom sheet for preference editing (solo and collaboration modes) |
| `ActivityPage.tsx` | Tab interface: boards, saved, calendar |
| `ConnectionsPage.tsx` | Friends, messaging, collaboration sessions |
| `ProfilePage.tsx` | User profile with stats, settings navigation, gamified data |
| `DiscoverScreen.tsx` | Holiday/night-out/category discovery with Ticketmaster integration |
| `SignInPage.tsx` | Auth flow orchestration: welcome → sign-in/up → account setup |
| `OnboardingFlow.tsx` | 11-step onboarding progression |
| `CollaborationSessions.tsx` | Horizontal session pill bar (solo + active/pending/sent) |
| `CuratedExperienceSwipeCard.tsx` | Multi-image strip card for curated itineraries |
| `DetailedExperienceCard.tsx` | Animated card with gesture handlers |
| `ExperienceCard.tsx` | Reusable experience card (compact/full modes) |
| `RecommendationsGrid.tsx` | Grid of recommendations with A/B testing |
| `SkeletonCard.tsx` | Shimmer loading placeholder |
| `CardStackPreview.tsx` | Stacked card preview behind main card |
| `DeckHistorySheet.tsx` | Bottom sheet for swipe batch history |
| `DismissedCardsSheet.tsx` | Bottom sheet for reviewing/reconsidering left-swiped cards |
| `PullToRefresh.tsx` | Pull-to-refresh with Reanimated animations + haptic feedback |

### Activity Subdirectory (9)

`BoardsTab`, `SavedTab`, `CalendarTab`, `ExperienceCard` (compact), `BoardCard`, `ProposeDateTimeModal`, `ProposeDateTimeFooter`, `DateOptionsGrid`, `WeekendDaySelection`

### Board Subdirectory (20)

`BoardViewScreen`, `BoardHeader`, `BoardTabs`, `BoardSessionList`, `BoardSessionCard`, `BoardPreferencesForm`, `BoardSettingsModal`, `BoardSettingsDropdown`, `BoardDiscussionTab`, `CardDiscussionModal`, `SwipeableSessionCards`, `ParticipantAvatars`, `InviteAcceptScreen`, `InviteCodeDisplay`, `InviteLinkShare`, `InviteMethodSelector`, `QRCodeDisplay`, `ManageBoardModal`, `MentionPopover`, `ModeToggleButton`

### Collaboration Subdirectory (6)

`CreateTab` (3-step session creation), `SessionsTab`, `InvitesTab`, `SessionCard`, `InviteCard`, `CollaborationFriendsTab`

### Connections Subdirectory (4)

`FriendsTab`, `MessagesTab`, `FriendCard`, `ConversationCard`

### Expanded Card Subdirectory (14)

`ExpandedCardHeader`, `ImageGallery`, `CardInfoSection`, `DescriptionSection`, `HighlightsSection`, `WeatherSection`, `BusynessSection`, `PracticalDetailsSection`, `MatchFactorsBreakdown`, `MatchScoreBox`, `TimelineSection`, `CompanionStopsSection`, `ActionButtons`, `FeedbackModal`

### Onboarding Subdirectory (11)

`WelcomeStep`, `AccountSetupStep`, `IntentSelectionStep`, `VibeSelectionStep`, `LocationSetupStep`, `TravelModeStep`, `TravelConstraintStep`, `BudgetRangeStep`, `DateTimePrefStep`, `InviteFriendsStep`, `MagicStep`

### Sign-In Subdirectory (6)

`WelcomeScreen`, `SignInForm`, `SignUpForm`, `PhoneSignUpForm`, `OTPScreen`, `SignUpAsStep`

### Profile Subdirectory (10)

`ProfilePage`, `ProfilePhotoSection`, `ProfilePersonalInfoSection`, `ProfileAccountSection`, `ProfilePrivacySection`, `ProfileSettings`, `AccountSettings`, `PrivacyControls`, `PrivacyPolicy`, `TermsOfService`

### Modal Components (16)

`AddFriendModal`, `AddToBoardModal`, `NotificationsModal`, `FriendRequestsModal`, `FriendSelectionModal`, `ShareModal`, `CreateSessionModal`, `SessionViewModal`, `UserInviteModal`, `PurchaseModal`, `PurchaseQRCode`, `BlockUserModal`, `BlockedUsersModal`, `ReportUserModal`, `EnhancedBoardModal`, `InAppBrowserModal`

### System/Infrastructure Components (12)

`AppStateManager`, `AppHandlers`, `MobileFeaturesProvider`, `NotificationSystem`, `NotificationBar`, `OfflineIndicator`, `ErrorBoundary`, `ErrorState`, `SuccessAnimation`, `Toast`, `ToastManager`, `HeaderControls`

### UI Primitives (`src/components/ui/`) — 45+ shadcn-style components

**Layout/Structure**: `card`, `separator`, `aspect-ratio`, `scroll-area`, `sidebar`

**Forms/Input**: `input`, `textarea`, `button` (variants: default, destructive, outline, secondary, ghost, link), `label`, `form` (react-hook-form), `checkbox`, `radio-group`, `switch`, `select`, `combobox`, `slider`, `input-otp`, `toggle`, `toggle-group`

**Modals/Overlays**: `dialog`, `alert-dialog`, `drawer`, `sheet`, `popover`, `hover-card`, `dropdown-menu`, `context-menu`

**Navigation**: `tabs`, `breadcrumb`, `pagination`, `navigation-menu`

**Display**: `badge`, `avatar`, `alert`, `progress`, `calendar`, `carousel`, `skeleton`, `chart`, `table`, `command`, `menubar`, `sonner`, `tooltip`

**Utilities**: `use-mobile` (screen size hook), `utils` (className merging), `KeyboardAwareView`, `LoadingSkeleton`, `Toast`, `ToastContainer`

---

## AI & External Integrations

| Service | Usage | Rate Limit | Key Secret |
|---|---|---|---|
| **OpenAI GPT-4o-mini** | Card enrichment (descriptions, highlights, match reasoning), weather-aware safety notes, curated itinerary AI descriptions | Tier-dependent | `OPENAI_API_KEY` |
| **Google Places API (New)** | Core venue discovery: nearbySearch, textSearch, Place Details (free by ID for refresh). Types mapped via `categoryPlaceTypes.ts` | 5,000 req/day base | `GOOGLE_MAPS_API_KEY` |
| **Ticketmaster Discovery API v2** | Live music/concert/festival events for Night Out tab. MUSIC_SEGMENT_ID filtering. Genre, date, price filtering | 5,000 req/day | `TICKETMASTER_API_KEY` |
| **OpenWeather API** | Current weather conditions and forecasts for outdoor activity recommendations. 5-min in-memory cache | Tier-dependent | `OPENWEATHER_API_KEY` |
| **Resend** | Transactional email delivery: collaboration invites, friend requests, message notifications, invite responses | Tier-dependent | `RESEND_API_KEY` |

---

## Project Structure

```
Mingla/
├── app-mobile/                              # React Native (Expo) mobile app
│   ├── app/
│   │   └── index.tsx                        # Root component (2,613 lines) — navigation, auth, providers
│   ├── assets/                              # Icons, images, splash screen, logo
│   ├── src/
│   │   ├── components/                      # 150+ UI components
│   │   │   ├── activity/                   # BoardsTab, SavedTab, CalendarTab, ProposeDateTimeModal
│   │   │   ├── auth/                       # GoogleOAuthWebView
│   │   │   ├── board/                      # BoardViewScreen, settings, discussion, cards, invites (20 files)
│   │   │   ├── collaboration/              # CreateTab, SessionsTab, InvitesTab, cards
│   │   │   ├── connections/                # FriendsTab, MessagesTab, cards
│   │   │   ├── debug/                      # DebugModal
│   │   │   ├── expandedCard/               # 14 detail sections (gallery, weather, busyness, match, timeline)
│   │   │   ├── figma/                      # ImageWithFallback
│   │   │   ├── onboarding/                 # 11 onboarding step components
│   │   │   ├── PreferencesSheet/           # PreferencesSections, PreferencesSectionsAdvanced
│   │   │   ├── profile/                    # Settings, privacy, legal (10 files)
│   │   │   ├── signIn/                     # WelcomeScreen, forms, OTP (6 files)
│   │   │   ├── ui/                         # 45+ shadcn-style primitives
│   │   │   └── utils/                      # Formatter utilities
│   │   ├── config/
│   │   │   └── queryClient.ts              # React Query configuration + AsyncStorage persister
│   │   ├── constants/
│   │   │   ├── categories.ts               # 11 category definitions + CURATED_EXPERIENCES + INTENT_IDS
│   │   │   ├── colors.ts                   # Brand color palette
│   │   │   └── designSystem.ts             # Design tokens (spacing, radius, typography, shadows)
│   │   ├── contexts/
│   │   │   ├── CardsCacheContext.tsx        # Card caching (30min TTL, 10 entries, AsyncStorage)
│   │   │   ├── NavigationContext.tsx        # Modal state + navigation helpers
│   │   │   └── RecommendationsContext.tsx   # Dual-mode card pipeline (solo/collab)
│   │   ├── data/
│   │   │   └── mockConnections.ts          # Development mock data
│   │   ├── debug/
│   │   │   └── profile-debug.ts            # Profile data inspection utility
│   │   ├── hooks/                           # 32 custom React hooks
│   │   │   ├── useAuth.ts                  # Legacy auth
│   │   │   ├── useAuthSimple.ts            # Enhanced auth (OTP, Google, Apple)
│   │   │   ├── useDeckCards.ts             # Unified solo deck (pool-first)
│   │   │   ├── useCuratedExperiences.ts    # Multi-stop itinerary cards
│   │   │   ├── useSessionManagement.ts     # Collaboration session orchestration
│   │   │   ├── useFriends.ts               # Friend management
│   │   │   ├── useMessages.ts              # Messaging
│   │   │   ├── useCalendarHolidays.ts      # Device calendar holidays
│   │   │   ├── usePendingReviews.ts        # Day-after review prompts
│   │   │   ├── useEnhancedProfile.ts       # Gamified profile
│   │   │   └── ... (22 more)
│   │   ├── services/                        # 65+ service modules
│   │   │   ├── supabase.ts                 # Supabase client singleton
│   │   │   ├── deckService.ts              # Unified deck (replaces 7 hooks)
│   │   │   ├── experienceGenerationService.ts
│   │   │   ├── curatedExperiencesService.ts
│   │   │   ├── nightOutExperiencesService.ts # Ticketmaster integration
│   │   │   ├── realtimeService.ts          # Supabase Realtime subscriptions
│   │   │   ├── blockService.ts             # User blocking
│   │   │   ├── offlineService.ts           # AsyncStorage offline support
│   │   │   ├── networkMonitor.ts           # Connectivity tracking
│   │   │   └── ... (55 more)
│   │   ├── store/
│   │   │   └── appStore.ts                 # Zustand store (persisted to AsyncStorage)
│   │   ├── styles/                          # Shared StyleSheet styles
│   │   ├── types/
│   │   │   ├── index.ts                    # Core domain types (User, Preferences, Board, etc.)
│   │   │   ├── recommendation.ts           # Canonical Recommendation card type
│   │   │   ├── expandedCardTypes.ts        # Expanded modal data types
│   │   │   └── curatedExperience.ts        # Multi-stop itinerary types
│   │   └── utils/
│   │       ├── categoryUtils.ts            # Category slug/icon/color lookups
│   │       ├── cardConverters.ts           # Card type conversions + dedup
│   │       ├── animations.ts               # AnimationUtils class + presets
│   │       ├── hapticFeedback.ts           # HapticFeedback class + patterns
│   │       ├── currency.ts                 # 50+ currency symbols + formatting
│   │       ├── numberFormatter.ts          # Number/distance/duration formatting
│   │       ├── dateUtils.ts                # Relative time formatting
│   │       ├── preferencesConverter.ts     # Preferences → API request conversion
│   │       ├── timelineGenerator.ts        # Category-specific step timelines
│   │       ├── usernameUtils.ts            # Username generation + validation
│   │       ├── curatedToTimeline.ts        # CuratedStop[] → TimelineStep[]
│   │       ├── costConverter.ts            # Price string parsing
│   │       ├── countryCodes.ts             # 50+ country dial codes
│   │       └── general.ts                  # Utility helpers
│   ├── app.json                             # Expo config (bundle ID, permissions, plugins)
│   ├── eas.json                             # EAS Build profiles (dev/preview/production)
│   ├── package.json                         # Dependencies
│   └── tsconfig.json                        # TypeScript strict mode config
│
├── supabase/                                # Supabase backend
│   ├── functions/                           # 25+ Edge Functions
│   │   ├── _shared/                        # Shared utilities
│   │   │   ├── cardPoolService.ts          # Pool-first serving engine (2,473 lines)
│   │   │   ├── categoryPlaceTypes.ts       # Canonical category→place type mappings
│   │   │   ├── placesCache.ts              # Google Places API caching
│   │   │   └── textSearchHelper.ts         # Text search fallback
│   │   ├── new-generate-experience-/       # Core pool-first generation
│   │   ├── generate-curated-experiences/   # Multi-stop itinerary builder
│   │   ├── generate-session-experiences/   # Collaboration mode generation
│   │   ├── discover-experiences/           # General discovery (all categories)
│   │   ├── discover-nature/                # Category-specific discovery
│   │   ├── discover-casual-eats/
│   │   ├── discover-creative-arts/
│   │   ├── discover-drink/
│   │   ├── discover-fine-dining/
│   │   ├── discover-first-meet/
│   │   ├── discover-picnic-park/
│   │   ├── discover-play/
│   │   ├── discover-watch/
│   │   ├── discover-wellness/
│   │   ├── ticketmaster-events/            # Real Ticketmaster live events
│   │   ├── holiday-experiences/            # Holiday-themed cards
│   │   ├── night-out-experiences/          # Legacy nightlife (deprecated)
│   │   ├── refresh-place-pool/             # Daily place data refresh (free API)
│   │   ├── enhance-cards/                  # AI card enrichment
│   │   ├── ai-reason/                      # Weather-aware reasoning
│   │   ├── places/                         # Google Maps proxy
│   │   ├── get-companion-stops/            # Multi-stop POI finder
│   │   ├── get-picnic-grocery/             # Picnic supply stops
│   │   ├── get-google-maps-key/            # Secure Maps key serving
│   │   ├── recommendations-enhanced/       # Scoring-based recommendations
│   │   ├── recommendations/                # Legacy recommendations
│   │   ├── weather/                        # OpenWeather proxy (5min cache)
│   │   ├── send-collaboration-invite/      # Session invite emails (Resend)
│   │   ├── send-friend-request-email/      # Friend request emails
│   │   ├── send-message-email/             # DM/mention notification emails
│   │   ├── notify-invite-response/         # Invite response emails
│   │   ├── delete-user/                    # Cascade user deletion
│   │   ├── events/                         # Generic event fetch
│   │   └── versions/                       # App version checking
│   ├── migrations/                          # 100+ SQL migration files
│   ├── config.toml                          # Supabase project config (JWT settings per function)
│   ├── schema.sql                           # Reference schema
│   └── seed.sql                             # Seed data
│
├── oauth-redirect/                          # Static OAuth callback page
│   ├── index.html                          # Token extraction from URL hash
│   └── _redirects                          # SPA routing rule
│
├── .github/                                 # CI/CD workflows
├── app.json                                 # Root Expo config
├── eas.json                                 # Root EAS Build config
├── bun.lockb                                # Bun lockfile
└── README.md                                # This file
```

---

## Dependencies

### Mobile App — Key Dependencies

**Framework & Runtime:**
- `expo` ~54.0.12, `react` 19.1.0, `react-native` 0.81.4, `expo-router` ~6.0.10

**State Management:**
- `zustand` ^5.0.8, `@tanstack/react-query` ^5.90.16, `@tanstack/query-async-storage-persister` ^5.90.18

**Backend & Auth:**
- `@supabase/supabase-js` ^2.74.0, `@react-native-google-signin/google-signin` ^16.0.0, `expo-apple-authentication` ^8.0.7

**UI & Navigation:**
- `@react-navigation/native` ^7.1.8, `@react-navigation/bottom-tabs` ^7.4.0, `expo-vector-icons` ~15.0.2, `react-native-gesture-handler` ~2.28.0, `react-native-reanimated` ^4.1.5, `react-native-safe-area-context` ~5.6.0

**Device APIs:**
- `expo-location` ~19.0.7, `expo-camera` ~17.0.8, `expo-image-picker` ^17.0.8, `expo-image-manipulator` ^14.0.7, `expo-haptics` ~15.0.7, `expo-notifications` ~0.32.12, `expo-calendar` ~15.0.7, `expo-device` ^8.0.9

**Media & Content:**
- `expo-image` ~3.0.8, `react-native-qrcode-svg` ^6.3.21, `react-native-webview` ^13.16.0

**Storage:**
- `@react-native-async-storage/async-storage` ^2.2.0

**Date/Time:**
- `@react-native-community/datetimepicker` ^8.5.0

### Backend — Edge Function Dependencies

All edge functions run on **Deno** (Supabase Edge Functions runtime). Dependencies imported from:
- `https://esm.sh/@supabase/supabase-js` — Supabase client
- `https://deno.land/std` — Deno standard library
- Shared modules from `_shared/` directory

---

## Build & Deployment

### Mobile App (EAS Build)

```bash
# Development client (internal distribution)
npx eas build --platform android --profile development
npx eas build --platform ios --profile development

# Preview APK (internal distribution)
npx eas build --platform android --profile preview

# Production builds
npx eas build --platform android --profile production
npx eas build --platform ios --profile production

# Submit to stores
npx eas submit --platform android
npx eas submit --platform ios
```

**Build Profiles** (from `eas.json`):
- `development`: Dev client, internal distribution
- `preview`: APK on Android, internal distribution
- `production`: Production APK on Android, auto-increment version

**Bundle IDs:**
- iOS: `com.mingla.app.v2`
- Android: `com.sethogieva.minglagreatdev`

**EAS Project ID:** `fa733082-682f-4e47-92cc-6013b0640373`

### Backend (Supabase)

```bash
# Push all migrations
echo "y" | npx supabase db push --linked --include-all

# Deploy a specific edge function
npx supabase functions deploy function-name

# Deploy all edge functions
npx supabase functions deploy

# Set secrets
npx supabase secrets set GOOGLE_MAPS_API_KEY=xxx
npx supabase secrets set OPENAI_API_KEY=xxx
npx supabase secrets set TICKETMASTER_API_KEY=xxx
npx supabase secrets set OPENWEATHER_API_KEY=xxx
npx supabase secrets set RESEND_API_KEY=xxx
```

### OAuth Redirect

Static site deployed to Vercel/Netlify. Handles Google and Apple OAuth callback token extraction.

---

## Development Workflows

### Mobile App

```bash
cd app-mobile

# Start development server
npx expo start

# Clear cache and start
npx expo start --clear

# Run on specific platform
npx expo run:android
npx expo run:ios

# Type-check
npx tsc --noEmit

# Lint
npx expo lint
```

### Environment Configuration

Create `app-mobile/.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Database Migrations

```bash
# From repo root (where supabase/ folder is)

# Push all migrations
echo "y" | npx supabase db push --linked --include-all

# Create a new migration
npx supabase migration new my_migration_name

# Reset local database
npx supabase db reset
```

### Edge Functions

```bash
# Deploy specific function
npx supabase functions deploy function-name

# Deploy all
npx supabase functions deploy

# Serve locally
npx supabase functions serve function-name --env-file .env.local
```

### TypeScript Configuration

- Extends `expo/tsconfig.base`
- Strict mode enabled
- JSX: `react-jsx`
- ES module interop + synthetic default imports
- Path alias: `@/*` → `./*`

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run type checking (`npx tsc --noEmit`)
5. Commit with descriptive messages
6. Push to your branch
7. Open a Pull Request

### Commit Conventions

- `Add:` — New features
- `Fix:` — Bug fixes
- `Refactor:` — Code restructuring
- `Docs:` — Documentation updates
- `Migration:` — Database schema changes

### Key Conventions

- **StyleSheet only** — no inline style objects
- **React Query** for all server state; **Zustand** for client-only persistent state
- **RLS on every table** — never expose API keys to mobile
- **All DB access** via Supabase JS client or edge functions
- **Custom navigation** — no React Navigation library
- **Categories use display-name format** ('Fine Dining') in `PreferencesSheet.tsx`, not slugs

---

## Recent Changes (2026-03-03)

- **Session-Scoped Impressions:** Replaced the 200-card sliding window with preference-session scoping. Cards seen since the last preference change are excluded; changing any preference makes all previous cards eligible again. Impressions now recorded via `record_card_impressions` RPC with `view_count` and `first_seen_at` analytics columns. Covering index `idx_impressions_user_session` added for session-scoped queries. Both `cardPoolService.ts` and `discover-experiences` updated.
- **Preference History Trigger Fix:** Migration `20260303000005` restores the correct JSONB-based `create_preference_history()` trigger function.
- **Policies & Reservations Button Fix:** Fixed compound data pipeline failure at 9 independent points that prevented the "Policies & Reservations" button from appearing on regular cards.
- **Preferences Save — Resilient Timeout & Performance:** Three-layer timeout defense (12s service, 30s fetch, 15s UI safety net) guarantees the user sees success or failure within 12 seconds.
- **Preferences Save Reliability (6-fix batch):** Triple-fire save button fixed; `people_count: undefined` fixed; `board_session_preferences` now stores `intents` in a separate column.
- **Dismissed Cards Review UI:** New `DismissedCardsSheet` bottom sheet lets users review left-swiped cards on deck exhaustion.
- **Pool Pagination (batchSeed Offset + nextPageToken):** Each swipe batch now gets a distinct slice of the card pool via offset-based pagination.
- **For You Hero Card Personalization:** Hero cards display user's top 2 preferred categories.

---

## License

This project is proprietary. All rights reserved.

---

**Built with care by the Mingla team.**
