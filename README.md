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
| Edge Functions | 61 Deno serverless functions |
| AI | OpenAI GPT-4o-mini, Whisper (audio transcription) |
| Maps & Places | Google Places API (New) |
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

## Project Structure

```
Mingla/
├── app-mobile/
│   ├── app/
│   │   └── index.tsx                    # Entry point (AppContent)
│   ├── src/
│   │   ├── components/                  # ~100 UI components
│   │   ├── hooks/                       # ~67 React Query hooks + realtime hooks
│   │   ├── services/                    # ~75 service files
│   │   ├── contexts/                    # 3 React contexts
│   │   ├── store/                       # Zustand store (appStore)
│   │   ├── types/                       # TypeScript types
│   │   ├── constants/                   # Design tokens, config, categories
│   │   └── utils/                       # ~27 utility files
│   └── package.json
│
├── supabase/
│   ├── functions/                       # 61 Deno edge functions
│   │   ├── _shared/                     # Shared edge function utilities
│   │   ├── admin-send-email/            # Admin email sending via Resend
│   │   ├── admin-place-search/          # Google Places search for admin
│   │   ├── delete-user/                 # Server-side user deletion cascade
│   │   └── [function-name]/             # Individual edge functions
│   ├── migrations/                      # 204 SQL migration files
│   └── config.toml
│
├── mingla-admin/                        # Admin dashboard (React 19 + Vite + Tailwind v4)
│   └── src/
│       ├── App.jsx                      # Root with hash routing + Cmd+K
│       ├── pages/                       # 15 feature pages
│       │   ├── OverviewPage.jsx         # Dashboard with trends, alerts, activity
│       │   ├── UserManagementPage.jsx   # Users with filters, bulk actions, server-side delete
│       │   ├── SubscriptionManagementPage.jsx  # Subscriptions with server-side stats
│       │   ├── AnalyticsPage.jsx        # Analytics with server-side RPCs + Leaflet map
│       │   ├── ContentModerationPage.jsx # Content with image preview, bulk actions, review moderation
│       │   ├── PhotoPoolManagementPage.jsx  # Photo pool management
│       │   ├── BetaFeedbackPage.jsx     # Feedback with audio retry, bulk status
│       │   ├── PlacePoolBuilderPage.jsx # Place pool with dedup, edit modal
│       │   ├── EmailPage.jsx            # Email with DB templates, rate limits, segments
│       │   ├── ReportsPage.jsx          # Reports with severity, profiles, cross-nav
│       │   ├── AdminPage.jsx            # Admin users with roles, activity logs
│       │   ├── SettingsPage.jsx         # Settings (theme + feature flags + config + integrations)
│       │   ├── CityLauncherPage.jsx     # 5-step city seeding wizard
│       │   ├── TableBrowserPage.jsx     # Table browser with sorting, JSON expand
│       │   └── SeedPage.jsx             # Database tools with named RPCs
│       ├── components/
│       │   ├── layout/                  # AppShell, Sidebar (grouped), Header
│       │   ├── ui/                      # 14 reusable components (Button, Card, Table, Modal, etc.)
│       │   └── CommandPalette.jsx       # Global Cmd+K search
│       ├── context/                     # AuthContext, ThemeContext, ToastContext
│       └── lib/                         # Supabase client, constants, auditLog, exportCsv, formatters
│
├── backend/                             # Backend utilities
└── oauth-redirect/                      # Static OAuth callback page
```

---

## Features

### Admin Dashboard

A full-featured admin panel for managing the Mingla platform. Grouped sidebar navigation, hash-based URL routing, Cmd+K global search, sortable tables, CSV export, and audit logging across all pages.

- **Dashboard** — stat cards with 7-day trends, alerts bar (pending reports, expired caches, expiring overrides), quick actions, recent admin activity
- **Users** — advanced filters (country, date range, status, onboarding), column sorting, bulk actions (ban, export), server-side delete via edge function, cross-page deep linking
- **Subscriptions** — server-side stats via RPC, expiring override alerts, column sorting, CSV export
- **Analytics** — 5 server-side RPCs (growth, engagement, retention, funnel, geo), custom date range, Leaflet map on geography tab
- **Content** — image thumbnails, bulk actions, review moderation (approve/reject/flag)
- **Photos** — photo health dashboard, category backfill with progress, place refresh with cost confirmation
- **Feedback** — audio auto-retry on 403, bulk status update
- **Places** — deduplication enforcement, post-import editing, map view
- **Email** — database-backed templates, city/tier/activity segments, rate limiting (100/day), send history export
- **Reports** — severity classification, profile display (not UUIDs), detail modal, cross-page user navigation
- **Admin Users** — role display (Owner/Admin), per-admin activity log
- **Settings** — theme toggle (light/dark/system), feature flags, app config, integrations
- **City Launcher** — 5-step wizard: define area → search → import → review → launch
- **Table Browser** — sortable columns, JSON cell expansion, CSV export
- **Database Tools** — named RPC scripts with confirmation modals, owner-only custom SQL

### Database Schema (Admin-Specific Tables)

| Table | Purpose |
|-------|---------|
| `admin_users` | Admin email allowlist with roles (owner/admin) and status |
| `admin_audit_log` | Every admin action logged with actor, action, target, metadata |
| `admin_subscription_overrides` | Manual tier overrides with expiry |
| `admin_email_log` | Email send history with recipient counts |
| `admin_backfill_log` | Photo/place backfill operation tracking |
| `admin_config` | Key-value app configuration |
| `email_templates` | Database-backed email templates |
| `feature_flags` | Remote feature flag management |
| `integrations` | Third-party integration configuration |

### Server-Side RPCs (Admin)

| RPC | Purpose |
|-----|---------|
| `get_admin_emails()` | SECURITY DEFINER — returns only email+status for pre-auth login check |
| `admin_subscription_stats()` | Aggregated subscription tier counts |
| `admin_analytics_growth()` | Daily signup counts for date range |
| `admin_analytics_engagement()` | DAU/WAU/MAU + feature usage |
| `admin_analytics_retention()` | Weekly cohort retention matrix |
| `admin_analytics_funnel()` | Signup → onboard → interact → board funnel |
| `admin_analytics_geo()` | User count by country |
| `admin_seed_demo_profiles()` | Insert demo test profiles |
| `admin_clear_expired_caches()` | Clean expired cache entries |
| `admin_reset_inactive_sessions()` | Deactivate stale collaboration sessions |
| `admin_clear_demo_data()` | Remove demo profiles |
| `admin_exec_sql()` | Owner-only arbitrary SQL execution |

### Mobile App Features

- **Card-Based Swipe Interface** — swipe right to save, left to skip, up to expand. Curated multi-stop itinerary experiences interleaved with single-place cards. Pool-first serving from card_pool table.
- **Collaboration Sessions** — tier-gated real-time collaboration with synchronized deck generation, voting, RSVP, lock-in, calendar sync, and chat.
- **Real-Time Messaging** — dual-channel delivery, deduplication, optimistic messages, push notifications.
- **Notifications System V2** — 30+ notification types, unified dispatch, preference enforcement, quiet hours, deep linking.
- **Subscription Tiers** — Free/Pro/Elite with server-side enforcement. 7-day trial, referral bonuses.
- **Pairing System** — Elite-only 3-tier pairing with multi-dimensional preference learning.
- **AI Recommendations** — pool-first card serving, per-category queries, impression rotation, haversine travel estimation.
- **7-Step Onboarding** — state machine with phone verification, preference selection, friend/pairing setup, collaboration creation.

### Card Generation & Serving Architecture

**Design principle:** Card serving is read-only. Card generation is a separate admin-triggered process. Scoring is a serving concern.

- **discover-cards** — Pool-only card serving. Zero external API calls. Reads `card_pool`, applies 5-factor scoring personalized per user, filters by datetime/budget/price tier, returns cards. If pool is empty, returns `{ cards: [], hasMore: false }` HTTP 200 — not an error.
- **generate-single-cards** — Admin-triggered batch generator. Reads `place_pool`, writes single cards to `card_pool` with photos from `stored_photo_urls`. Skips places without downloaded photos. Dedup by `google_place_id`. Supports `dryRun` for safe testing.
- **generate-curated-experiences** — Admin-triggered. One generic `generateCardsForType()` reads `place_pool` exclusively (zero Google calls) and builds multi-stop itinerary cards with OpenAI enrichment. All stop categories come from `_shared/seedingCategories.ts`.
- **Scoring stays at serve time.** Generators write raw card data (no `matchScore`, no `scoringFactors`). `discover-cards` applies scoring per request based on user preferences.
- **All card-serving functions are card_pool-only.** This includes `discover-cards`, `discover-experiences`, `get-personalized-cards`, `get-holiday-cards`, and `get-person-hero-cards`. None make Google API, OpenAI, or `place_pool` calls at serve time. If `card_pool` is empty for a query, the function returns an empty array (HTTP 200), not an error.
- **No Google API calls at serve time.** All Google interaction (place seeding, photo downloads) happens in the admin pipeline. The serving layer never touches Google.

### Preferences → Deck Pipeline

**Behavioral contract for how user preferences flow through to card serving.**

- **exactTime is always forwarded** — when the user picks a specific time (Today / Weekend / Pick a Date), it flows from PreferencesSheet → useDeckCards → discover-cards request. "Now" sends the current timestamp.
- **Collab time aggregation** — `date_option` and `time_slot` use majority vote; `exact_time` uses earliest. All three are forwarded to discover-cards.
- **CTA gating** — "Lock It In" is disabled when required fields are incomplete. "Today" / "This Weekend" require a time slot. "Pick a Date" requires date AND time. "Now" has no time requirement.
- **Travel mode from card** — travel time and mode icon come from the card response (server-calculated), not from the user's current preference setting. Fallback to current pref for older cached cards.
- **Solo / collab parity** — both modes send the same time parameters to discover-cards.

### Card Photo Resolution

- **Source of truth:** `place_pool.stored_photo_urls` — Supabase Storage URLs downloaded from Google Places by admin.
- **Serve-time resolution:** `query_pool_cards` JOINs `place_pool` to get stored photos. `poolCardToApiCard` uses `resolvePhotoUrl()` to prefer stored URLs.
- **No Unsplash anywhere:** When no stored photo exists, cards receive `image: null`. Mobile handles its own placeholder. No silent Unsplash substitution in the pipeline.
- **No API keys to client:** Google API URLs with embedded keys must never reach mobile. All photos served as Supabase Storage URLs only.
- **Curated stop photos:** Resolved directly from `place_pool.stored_photo_urls` via `queryPlacePool()`. Places without photos are skipped at query time.

### Curated Experience Generation

**Design principle:** Zero Google API calls at generation time. All places come from `place_pool`. If the pool is empty for a category, the generator returns fewer cards — the admin must seed first.

- **Single generic generator** — one `generateCardsForType()` function driven by declarative `ExperienceTypeDef` configs. No per-type generator functions.
- **6 experience types** — adventurous, first-date, romantic, group-fun, picnic-dates, take-a-stroll. Friendly is deleted.
- **Category-based stops** — all stops reference the 13 seeding categories from `_shared/seedingCategories.ts`. No hardcoded type arrays anywhere in the generator.
- **Serve-time hours enforcement** — curated cards filtered in `discover-cards` if any stop would be closed at the user's calculated arrival time (cascading through stop durations + travel times).
- **Flowers stop** — optional/dismissible on Romantic and First Date. Always included by default. Mobile renders with flower icon + dismiss button.
- **Picnic reverse proximity** — finds the park first (anchor), then queries grocery and flowers within 3km of the park.
- **Global exclusions** — `gym`, `fitness_center`, `dog_park` excluded from all card serving (code + SQL `query_pool_cards`).

---

## Category System

Mingla uses **13 categories** — 12 visible to users + 1 hidden:

| # | Slug | Display Name | Visible |
|---|------|-------------|---------|
| 1 | `nature` | Nature & Views | Yes |
| 2 | `first_meet` | First Meet | Yes |
| 3 | `picnic_park` | Picnic Park | Yes |
| 4 | `drink` | Drink | Yes |
| 5 | `casual_eats` | Casual Eats | Yes |
| 6 | `fine_dining` | Fine Dining | Yes |
| 7 | `watch` | Watch | Yes |
| 8 | `live_performance` | Live Performance | Yes |
| 9 | `creative_arts` | Creative & Arts | Yes |
| 10 | `play` | Play | Yes |
| 11 | `wellness` | Wellness | Yes |
| 12 | `flowers` | Flowers | Yes |
| 13 | `groceries` | Groceries | **Hidden** |

**Key rules:**
- **Groceries is hidden** — exists in the system for curated picnic stops but never shown to users (not in preferences, not in category pills, excluded from regular card serving via `query_pool_cards`).
- **Single source of truth** — all category definitions live in `_shared/seedingCategories.ts` (seeding) and `_shared/categoryPlaceTypes.ts` (serving/aliases). No hardcoded lists elsewhere.
- **Backward compatibility** — alias maps in `categoryPlaceTypes.ts` resolve old slugs (`groceries_flowers`, `work_business`, `Nature`, `Picnic`) to new categories. No user data breaks on migration.
- **Work & Business removed** — not a date category, not seeded, not served.

---

## Environment Variables

### Mobile (`app-mobile/.env`)
- `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_ONESIGNAL_APP_ID`

### Admin (`mingla-admin/.env`)
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`

### Supabase Secrets
- `GOOGLE_PLACES_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`
- `ONESIGNAL_APP_ID` / `ONESIGNAL_API_KEY`
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER`

---

## Setup & Running

```bash
# Clone
git clone <repo-url> && cd mingla

# Mobile
cd app-mobile && npm install && npx expo start

# Admin Dashboard
cd mingla-admin && npm install && npm run dev

# Supabase (local)
cd supabase && supabase start
supabase db push   # Apply all migrations
```

---

## Recent Changes

- **Category migration (12 → 13)** — Split Groceries & Flowers into Flowers (visible) + Groceries (hidden). Added Live Performance (split from Watch). Renamed Nature → Nature & Views, Picnic → Picnic Park. Removed Work & Business. SQL backfill + 60+ alias maps for backward compatibility.
- **Curated generator overhaul** — Replaced 7 per-type generators (3,254 lines) with 1 generic pool-only generator (~900 lines). Zero Google API calls. Deleted Friendly experience type. Added Flowers optional stop, cascading hours filter, dog_park exclusion.
- **Card generation/serving separation** — Extracted `generate-single-cards` from `discover-cards`, stripped `discover-cards` to pool-only (1342→416 lines, zero external API calls). Generation and serving are now fully decoupled.
- **Card photo resolution fix** — `poolCardToApiCard` resolves photos from `place_pool.stored_photo_urls` only. No Unsplash fallbacks, no Google API keys to client.
- **Admin Dashboard Overhaul** — grouped sidebar navigation, hash-based URL routing, Cmd+K global search, column sorting, CSV export, audit logging
- **City Launcher** — 5-step wizard for seeding cities with place search, import, and review
