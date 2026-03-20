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
- **generate-curated-experiences** — Admin-triggered. Combines multiple places into multi-stop itinerary cards with OpenAI enrichment.
- **Scoring stays at serve time.** Generators write raw card data (no `matchScore`, no `scoringFactors`). `discover-cards` applies scoring per request based on user preferences.
- **No Google API calls at serve time.** All Google interaction (place seeding, photo downloads) happens in the admin pipeline. The serving layer never touches Google.

### Card Photo Resolution

- **Source of truth:** `place_pool.stored_photo_urls` — Supabase Storage URLs downloaded from Google Places by admin.
- **Serve-time resolution:** `query_pool_cards` JOINs `place_pool` to get stored photos. `poolCardToApiCard` uses `resolvePhotoUrl()` to prefer stored URLs.
- **No Unsplash anywhere:** When no stored photo exists, cards receive `image: null`. Mobile handles its own placeholder. No silent Unsplash substitution in the pipeline.
- **No API keys to client:** Google API URLs with embedded keys must never reach mobile. All photos served as Supabase Storage URLs only.
- **Curated stop photos:** Resolved from `place_pool.stored_photo_urls` post-upsert via `storedPhotoMap` in `generate-curated-experiences`. `getPhotoUrl`/`getAllPhotoUrls` stubs return null by design — photos are patched after the batch place upsert.

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

- **Card generation/serving separation** — Extracted `generate-single-cards` from `discover-cards`, stripped `discover-cards` to pool-only (1342→416 lines, zero external API calls). Generation and serving are now fully decoupled.
- **Card photo resolution fix** — `poolCardToApiCard` resolves photos from `place_pool.stored_photo_urls` only. No Unsplash fallbacks, no Google API keys to client.
- **Admin Dashboard Overhaul** — grouped sidebar navigation, hash-based URL routing, Cmd+K global search, column sorting, CSV export, audit logging
- **Security hardening** — admin_users anon SELECT replaced with SECURITY DEFINER RPC, user delete moved to server-side edge function
- **City Launcher** — 5-step wizard for seeding cities with place search, import, and review
