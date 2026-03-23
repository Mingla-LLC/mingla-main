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
│       ├── pages/                       # 13 feature pages
│       │   ├── OverviewPage.jsx         # Dashboard with trends, alerts, activity
│       │   ├── UserManagementPage.jsx   # Users with filters, bulk actions, server-side delete
│       │   ├── SubscriptionManagementPage.jsx  # Subscriptions with server-side stats
│       │   ├── AnalyticsPage.jsx        # Analytics with server-side RPCs + Leaflet map
│       │   ├── ContentModerationPage.jsx # Content with image preview, bulk actions, review moderation
│       │   ├── PlacePoolManagementPage.jsx  # Place pool: 6 tabs (seed, map, browse, photos, stale, stats)
│       │   ├── PoolIntelligencePage.jsx    # Pool Intelligence: 5-tab drill-down (geo, categories, grid, uncat, cards)
│       │   ├── CardPoolManagementPage.jsx   # Card pool: 4 tabs (readiness, generate, browse, gaps)
│       │   ├── BetaFeedbackPage.jsx     # Feedback with audio retry, bulk status
│       │   ├── EmailPage.jsx            # Email with DB templates, rate limits, segments
│       │   ├── ReportsPage.jsx          # Reports with severity, profiles, cross-nav
│       │   ├── AdminPage.jsx            # Admin users with roles, activity logs
│       │   ├── SettingsPage.jsx         # Settings (theme + feature flags + config + integrations)
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
- **Place Pool** — 6-tab management: tile-based seeding with cost preview, Leaflet map view with status-colored tiles (gray/blue/green/red) and coverage gap detection (orange dashed), browse/filter/edit pool with rating filter, photo management with tile/category/rating filters and partial batch controls with cost estimates, stale review, stats with seeding history
- **Card Pool (hardened 2026-03-21)** — 4-tab management fully rewritten to TEXT-based V2 RPCs, zero seeding_cities dependency. Overview (card intelligence stat cards + category health), Browse (direct card_pool TEXT query, card detail modal, bulk activate/deactivate — curated cards no longer excluded), Generate (fixed request body format, bounding box from place_pool data, dry-run toggle, category + experience type filters, formatted results), Card Health (orphaned/stale/never-served cards, category gaps, cross-city comparison via single admin_country_overview RPC). Breadcrumb navigation matching PoolIntelligencePage. Must never happen: referencing seeding_cities, seeding_tiles, or UUID-param RPCs from this page.
- **Feedback** — audio auto-retry on 403, bulk status update
- **Email** — database-backed templates, city/tier/activity segments, rate limiting (100/day), send history export
- **Reports** — severity classification, profile display (not UUIDs), detail modal, cross-page user navigation
- **Admin Users** — role display (Owner/Admin), per-admin activity log
- **Settings** — theme toggle (light/dark/system), feature flags, app config, integrations
- **Database Tools** — named RPC scripts with confirmation modals
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
| `admin_edit_place()` | SECURITY DEFINER — selective place update with card cascade |
| `admin_country_overview()` | Per-country aggregates from actual place_pool data |
| `admin_country_city_overview(TEXT)` | Per-city aggregates within a country |
| `admin_pool_category_health(TEXT, TEXT)` | Category maturity scoped by country/city |
| `admin_virtual_tile_intelligence(TEXT, TEXT)` | Virtual ~500m neighborhood grid from bounding box |
| `admin_uncategorized_places(TEXT, TEXT, INT, INT)` | Paginated uncategorized places by country/city |
| `admin_card_pool_intelligence(TEXT, TEXT)` | Card pool metrics scoped by country/city |
| `admin_assign_place_category(UUID[], TEXT)` | Bulk category assignment for places |
| `admin_city_place_stats()` | Server-side per-city place aggregates (totals, photos, staleness, by-category) |
| `admin_city_card_stats()` | Server-side per-city card aggregates (by type, category, gaps) |
| `admin_seed_demo_profiles()` | Insert demo test profiles |
| `admin_clear_expired_caches()` | Clean expired cache entries |
| `admin_reset_inactive_sessions()` | Deactivate stale collaboration sessions |
| `admin_clear_demo_data()` | Remove demo profiles |
| `admin_exec_sql()` | Owner-only arbitrary SQL execution |

### Admin Seeding Pipeline

**Design principle:** Cities are broken into a hex-grid of tiles. Each tile × category = one Google Nearby Search call with explicit type filtering. No Text Search for structured seeding.

1. **Tile-based seeding** — `admin-seed-places` edge function. Cities defined with center + radius. Grid generated with spacing = tile_radius × 1.4. Default tile radius: 1500m. Each tile gets 13 category searches.
2. **$70 hard cap** — `preview_cost` action calculates search + estimated photo cost. Returns `exceedsHardCap: true` if over $70. `seed` action requires `acknowledgeHardCap: true` to proceed over cap.
3. **Post-fetch filters** — reject permanently closed, reject no photos, reject global excluded types (gym, fitness_center, dog_park). No-rating places are allowed.
4. **Selective upsert** — re-seeding preserves admin-edited fields (`price_tier`, `is_active`, `stored_photo_urls`). Only Google-sourced fields are refreshed. Two-step: insert-new then batch-update-existing.
5. **Structured error logging** — every tile failure logged in `seeding_operations.error_details` JSONB with tile_id, category, HTTP status, response body (truncated to 500 chars), error type, timestamp.
6. **City status flow** — `draft` → `seeding` → `seeded` → `launched`. Only transitions to "seeded" when places are actually inserted. Falls back to "draft" on total failure.
7. **Seeding tables** — `seeding_cities` (city definitions with google_place_id), `seeding_tiles` (tile grid, CASCADE on city delete), `seeding_operations` (per-category operation logs).

### Admin Dashboard — Pool Management

Two full-featured pages replacing three old ones (PlacePoolBuilderPage, CityLauncherPage, PhotoPoolManagementPage).

1. **Two pages** — Place Pool Management (seed, map, browse, photos, stale, stats) and Card Pool Management (readiness, generate, browse, gaps).
2. **City selector** — Google Places Autocomplete validates cities. Auto-generates hex-grid tiles on save.
3. **Map view** — Leaflet with tile grid overlay, category-coded pins (13 colors), status coloring (gray=unseeded, blue=partial, green=full, red=errors), coverage gap detection (orange dashed for tiles with <5 places).
4. **Photo management** — integrated into Place Pool with tile/category/rating filters, sort by rating or impressions, partial batch downloads with limit control and cost estimates.
5. **Launch readiness** — 7-step checklist (tiles, places ≥50, photos ≥80%, single cards, curated ≥10, categories ≥8/13, spend ≤$70), 13-category traffic lights, SVG readiness gauge, Launch button gated on all-green.
6. **Cross-city comparison** — when no city selected, Gap Analysis shows all cities with places, cards, photo %, and spend vs $70 cap side-by-side.

### Admin Dashboard — Pool Intelligence

A seeding-independent database exploration tool. Shows what exists in `place_pool` and `card_pool` — segmented by country, city, neighborhood, and category. Has nothing to do with seeding. The admin uses this to understand the current state, then goes to the seeding pages to act.

1. **Country-first navigation** — top-level filter reads `DISTINCT country` from actual `place_pool.country` values (not `seeding_cities`). Breadcrumb: All Countries → Country → City.
2. **Geographic Inventory** — default tab. Shows country table (places, cards, photos, categories, uncategorized count, city count). Click a country to see its cities. Click a city to drill into categories.
3. **Category Maturity** — per-category breakdown scoped by country and optionally city. Shows place count, card count (single + curated), photo coverage, avg rating, health status. Health = green (≥80% of places have cards), yellow (≥50%), red (<50%).
4. **Neighborhood Grid** — virtual ~500m tile grid computed on-the-fly from the bounding box of places in a city. No storage, no seeding dependency. Table view + grid view toggle. Any city with places gets a grid automatically.
5. **Uncategorized Places** — paginated list of places with NULL `seeding_category`, filterable by country/city. Bulk category assignment via `admin_assign_place_category` RPC with 13-slug validation.
6. **Card Pool Intelligence** — card metrics scoped by country/city. Active/inactive, single/curated, orphaned cards (parent place deleted), stale cards (not refreshed 30+ days), image coverage, serving stats, per-category JSONB breakdown.
7. **Every metric has a plain-English subtitle** — "Active Cards: Cards available to show users", "Orphaned Cards: Cards whose parent place was deactivated or deleted", etc.
8. **Data sources (hardened 2026-03-21)** — `place_pool.country` and `place_pool.city` (TEXT columns) populated on every insert path: `admin-seed-places` extracts locality from Google addressComponents with seeding_cities.name fallback, `generate-single-cards` and `generate-curated-experiences` copy from parent place, `upsertPlaceToPool` extracts from Google data. `card_pool.country` and `card_pool.city` denormalized for direct filtering. Propagation trigger cascades place city/country changes to cards. Zero JOINs to seeding tables at runtime. Must never happen: inserting a place or card without setting city TEXT.
9. **Virtual tiles** — computed per-request from bounding box using floor division (~0.0045° latitude ≈ 500m, longitude adjusted by cosine). Deterministic: same places = same grid. No `seeding_tiles` dependency.

### Mobile App Features

- **Card-Based Swipe Interface** — swipe right to save, left to skip, up to expand. Curated multi-stop itinerary experiences interleaved with single-place cards. Pool-first serving from card_pool table.
- **Collaboration Sessions** — tier-gated real-time collaboration with synchronized deck generation, voting, RSVP, lock-in, calendar sync, and chat.
- **Real-Time Messaging** — dual-channel delivery, deduplication, optimistic messages, push notifications.
- **Notifications System V2 (hardened 2026-03-22)** — unified dispatch via `notify-dispatch` (preferences, quiet hours, idempotency, push via OneSignal, in-app via Realtime). Push delivery hardened: `sendPush()` detects empty OneSignal notification id (silent failure), JSON parse errors return false, all outcomes logged. Pair request accepted notification dispatched. Pair activity types respect `friend_requests` preference. Session member left notification wired. iOS badge increments on every push, resets on modal open and markAllAsRead. Holiday reminders via cron. 6 dead types removed. All new notifications MUST go through `notify-dispatch` — no direct OneSignal calls. Must never happen: sendPush() returning true when push was not delivered.
- **Subscription Tiers** — Free/Pro/Elite with server-side enforcement. 7-day trial, referral bonuses.
- **Pairing System** — Elite-only 3-tier pairing with multi-dimensional preference learning.
- **Paired view dedup (hardened 2026-03-22):** `seenCardIds` ref deduplicates cards across holiday sections — birthday section renders first (highest priority). Each CardRow handles fetch errors independently with retry button. Birthday NaN guards prevent broken text from malformed dates. Must never happen: same card appearing in multiple paired view sections.
- **Atomic unpair (hardened 2026-03-23):** `unpair_atomic` SECURITY DEFINER RPC handles unpair in one transaction — verifies auth, updates pair_request to 'unpaired', deletes pairing with CASCADE. Replaces 3-step client code that swallowed RLS errors. Must never happen: catching and swallowing RLS violations as success.
- **Delete account FK cascades (hardened 2026-03-23):** Broken `handle_user_deletion_cleanup` trigger removed (referenced dropped columns). 7 FKs referencing `auth.users(id)` changed from `NO ACTION` to `ON DELETE SET NULL` so user deletion succeeds. 3 admin audit columns (`admin_backfill_log.triggered_by`, `admin_subscription_overrides.granted_by`, `place_admin_actions.acted_by`) had `NOT NULL` dropped to resolve SET NULL + NOT NULL conflict. Must never happen: adding a FK to `auth.users` with `NO ACTION` or `CASCADE` (use `SET NULL` for audit columns, `CASCADE` only for user-owned data tables with matching RLS).
- **Block-state chat tap (hardened 2026-03-23):** Chat tap uses synchronous `blockedUsers` cache lookup (React Query) — zero network calls on the critical path. Background fire-and-forget bidirectional check with `latestSelectedChatRef` stale-guard (prevents wrong-chat overwrite on rapid switching). Send-time check uses `activeChatIsBlocked || blockedUsers.some(...)` — belt-and-suspenders with RLS as the real authority. No-cache message fetch paths have 8s `Promise.race` timeout. Must never happen: awaiting a network call before opening a chat, or a background block-check result applying to a different chat than the one that triggered it.
- **Country picker status bar fix (hardened 2026-03-23):** React Native `<Modal>` creates a new native iOS window without the root `SafeAreaProvider`. `SafeAreaView` inside the modal read zero insets, causing content to render behind the status bar. Fix: `CountryPickerModal` and `CountryPickerOverlay` each wrap `CountryPickerContent` in their own `<SafeAreaProvider>`, scoped to the correct window. All 6 consumers (AddFriendView, PairRequestModal, PhoneInput, CreateSessionModal, CollaborationModule, CollaborationSessions) inherit the fix automatically. Must never happen: using `SafeAreaView` or `useSafeAreaInsets` inside a `<Modal>` without a local `SafeAreaProvider`.
- **AI Recommendations** — pool-first card serving, per-category queries, impression rotation, haversine travel estimation.
- **7-Step Onboarding** — state machine with phone verification, preference selection, friend/pairing setup, collaboration creation.

### Card Generation & Serving Architecture

**Design principle:** Card serving is read-only. Card generation is a separate admin-triggered process. Scoring is a serving concern.

- **discover-cards (hardened 2026-03-22)** — Pool-only card serving. Zero external API calls. Reads `card_pool`, applies 5-factor scoring personalized per user, filters by datetime/budget/price tier, returns cards. If pool is empty, returns `{ cards: [], hasMore: false }` HTTP 200 — not an error. **"Now" mode uses live opening hours** — computes open/closed from stored `openingHours` via `parseHoursText()` + `new Date()`. Cards without opening hours data pass through (included by default). Must never happen: filtering by stale `isOpenNow` boolean.
- **Timezone-aware opening hours (hardened 2026-03-22):** `isPlaceOpenNow` uses `utc_offset_minutes` (from Google Places API, stored on place_pool + card_pool) to compute venue local time. When offset is available, computes `Date.now() + offset * 60_000` with UTC methods. When null (existing cards before re-seed), falls back to device local time. Single canonical parser: `extractWeekdayText` — all other custom parsers removed. Must never happen: using device local time when venue timezone offset is available, or maintaining multiple independent opening hours parsers.
- **generate-single-cards** — Admin-triggered batch generator. Reads `place_pool`, writes single cards to `card_pool` with photos from `stored_photo_urls`. Skips places without downloaded photos. Dedup by `google_place_id`. Supports `dryRun` for safe testing.
- **generate-curated-experiences** — Admin-triggered. One generic `generateCardsForType()` reads `place_pool` exclusively (zero Google calls) and builds multi-stop itinerary cards with OpenAI enrichment. All stop categories come from `_shared/seedingCategories.ts`.
- **Scoring stays at serve time.** Generators write raw card data (no `matchScore`, no `scoringFactors`). `discover-cards` applies scoring per request based on user preferences.
- **discover-experiences auth guard (hardened 2026-03-23):** Edge function returns HTTP 401 with `{ error: 'auth_required' }` when auth fails — no longer returns silent empty 200. Client detects 401, refreshes session token via `supabase.auth.refreshSession()`, retries once. Date guard (`lastDiscoverFetchDateRef`) not set on auth errors (allows retry on next foreground), IS set on server errors (avoids hammering). UNIQUE constraint on `discover_daily_cache(user_id, us_date_key)` dropped — conflicted with hash-based caching pattern. Must never happen: returning HTTP 200 with empty cards when auth has failed.
- **discover-experiences category slug fix (hardened 2026-03-23):** Centralized `DISPLAY_TO_SLUG`/`SLUG_TO_DISPLAY` mapping + `toSlug()`/`toDisplay()` helpers in `_shared/categoryPlaceTypes.ts`. Edge function now queries `card_pool` with slugs (`toSlug(cat)`) and returns display names to client (`toDisplay(card.category)`). All 6 comparison points fixed (pool query, findBestForCategory, rotation path, response mapping, cache-hit hero reconstruction). Client retry-on-empty narrowed to auth failures only. Fetch mutex ref prevents duplicate concurrent requests. Must never happen: querying `card_pool.category` with display names instead of slugs.
- **Paired view slug fix + dedup + quality (hardened 2026-03-23):** `query_person_hero_cards` SQL function now normalizes display names → slugs (CASE/WHEN block matching `query_pool_cards`). New `p_exclude_card_ids` param enables server-side card dedup across holiday sections. `staleTime: Infinity` on both `usePairedCards` and `usePersonHeroCards` — cards persist until shuffle, no auto-refresh. Travel time computed client-side via haversine + speed-by-mode and shown on expanded paired view cards. Must never happen: querying `card_pool.category` with display names in any SQL function.
- **All card-serving functions are card_pool-only.** This includes `discover-cards`, `discover-experiences`, `get-personalized-cards`, `get-holiday-cards`, and `get-person-hero-cards`. None make Google API, OpenAI, or `place_pool` calls at serve time. If `card_pool` is empty for a query, the function returns an empty array (HTTP 200), not an error.
- **No Google API calls at serve time.** All Google interaction (place seeding, photo downloads) happens in the admin pipeline. The serving layer never touches Google.

### Preferences → Deck Pipeline

**Behavioral contract for how user preferences flow through to card serving.**

- **exactTime is always forwarded** — when the user picks a specific time (Today / Weekend / Pick a Date), it flows from PreferencesSheet → useDeckCards → discover-cards request. "Now" sends the current timestamp.
- **Collab time aggregation** — `date_option` and `time_slot` use majority vote; `exact_time` uses earliest. All three are forwarded to discover-cards.
- **CTA gating** — "Lock It In" is disabled when required fields are incomplete. "Today" / "This Weekend" require a time slot. "Pick a Date" requires date AND time. "Now" has no time requirement.
- **Travel mode from card** — travel time and mode icon come from the card response (server-calculated), not from the user's current preference setting. Fallback to current pref for older cached cards.
- **Solo / collab parity** — both modes send the same time parameters to discover-cards.
- **Preference save truthfulness (hardened 2026-03-22):** `updateUserPreferences()` returns `false` on failure — never returns `true` when save didn't persist. Background retry still attempts recovery. Must never happen: returning `true` from a failed save.
- **Custom location persistence (hardened 2026-03-22):** GPS toggle preserves custom location in refs — toggling GPS on/off restores the previous custom location. `custom_location` stores the display name ("London, UK"), never raw coordinates. Google Places suggestions resolve placeId → coordinates via `getPlaceCoordinates()` before accepting. Must never happen: storing coordinate strings as location display name, or accepting a suggestion with null coordinates.
- **Currency + measurement locked from onboarding (hardened 2026-03-22):** Currency and measurement system are set during onboarding and never re-derived from GPS, device locale, or location changes. PreferencesSheet must never call `detectLocaleFromCoordinates`. Must never happen: currency changing when user browses a different city.
- **Realtime + foreground freshness (hardened 2026-03-23):** `useSocialRealtime` subscribes to 10+ Supabase tables (friend_requests, pair_requests, pairings, messages, calendar_entries, etc.) with server-side filters and targeted invalidation. `useForegroundRefresh` handles auth refresh on long idle, WebSocket reconnection, and invalidation of 17 query families. Both mounted in `AppStateManager.tsx`. Must never happen: these hooks being unmounted or commented out.
- **Truthful error states (hardened 2026-03-22):** API failures show ERROR with retry (not "That's a Wrap"). Empty pool (200 OK, 0 cards) shows EMPTY. Preference save failure shows toast. Saved page distinguishes filtered-empty from truly-empty. Category deselect shows feedback near pills. Must never happen: disguising an API error as deck exhaustion.
- **In-app browser for external URLs (hardened 2026-03-22):** Web content (booking, terms, privacy, Twitter) opens via `WebBrowser.openBrowserAsync` (Safari VC / Chrome Custom Tabs). `Linking.openURL` reserved for tel:, sms:, maps:, and deep links only. Must never happen: opening an http/https URL via Linking.openURL.
- **Scheduling (hardened 2026-03-22):** iOS pickers render as absolute overlays inside the main Modal (not sibling Modals — those don't stack on iOS). Date mode has explicit "Next" button so pre-selected date can be confirmed without spinner scroll. All time pickers use `is24Hour={false}` (12-hour AM/PM). Haptic feedback on schedule success. Partial unique index prevents duplicate pending calendar entries. Must never happen: rendering a picker in a sibling Modal on iOS, or creating duplicate calendar entries for the same card.

### Card Photo Resolution

- **Source of truth:** `place_pool.stored_photo_urls` — Supabase Storage URLs downloaded from Google Places by admin.
- **Serve-time resolution:** `query_pool_cards` JOINs `place_pool` to get stored photos. `poolCardToApiCard` uses `resolvePhotoUrl()` to prefer stored URLs.
- **No Unsplash anywhere:** When no stored photo exists, cards receive `image: null`. Mobile handles its own placeholder. No silent Unsplash substitution in the pipeline.
- **Null-safe image arrays (hardened 2026-03-22):** All `images` array construction uses `.filter(Boolean)` to prevent `[undefined]`. Pattern: `(card.images?.length > 0 ? card.images : [card.image]).filter(Boolean)`. Must never happen: passing `[undefined]` as images array to any rendering component.
- **No API keys to client:** Google API URLs with embedded keys must never reach mobile. All photos served as Supabase Storage URLs only.
- **Curated stop photos:** Resolved directly from `place_pool.stored_photo_urls` via `queryPlacePool()`. Places without photos are skipped at query time.
- **Curated card hero images (hardened 2026-03-22):** Every curated card must have `image_url` (hero) and `images` (gallery up to 5) set from the first stop's place photos. The generator sets these on new cards (lines 1200-1201). Legacy cards backfilled via `card_pool_stops → place_pool` join. Must never happen: curated card with NULL image_url while its stops have photos.

### Curated Experience Generation

**Design principle:** Zero Google API calls at generation time. All places come from `place_pool`. If the pool is empty for a category, the generator returns fewer cards — the admin must seed first.

- **Single generic generator** — one `generateCardsForType()` function driven by declarative `ExperienceTypeDef` configs. No per-type generator functions.
- **6 experience types** — adventurous, first-date, romantic, group-fun, picnic-dates, take-a-stroll. Friendly is deleted.
- **Optional stops (hardened 2026-03-22):** Compact swipe card shows ONLY main (non-optional) stops. Expanded modal shows full plan with optional stops labeled "Suggested" and dismissible. Shopping list (picnic-dates) renders as top-level section above stops. AI descriptions render per stop from `stop.aiDescription` — optional stops get `OPTIONAL side-stop, can be skipped` marker in the AI prompt so descriptions explain optionality. Picnic Flowers is optional (cards generate without florists). Descriptions truncate at 4 lines with "Read more" toggle. Must never happen: optional stops appearing on the compact card face, or shopping list buried inside a stop.
- **Curated card labels (hardened 2026-03-21)** — `poolCardToApiCard` reconstructs `categoryLabel` from `card.experience_type` using `EXPERIENCE_TYPE_LABELS` mapping (must match `CURATED_TYPE_LABELS` in generator). Single cards use `category` slug resolved by mobile via `getReadableCategoryName()`. These are two separate paths — do not unify them.
- **Nearest-place stop selection (hardened 2026-03-22)** — `selectClosestHighestRated()` picks the nearest candidate by haversine distance. No more tiered 3km/5km logic. Pre-sorted array means equidistant ties break to highest-rated. Must never happen: tiered proximity tiers that skip closer places in favor of farther high-rated ones.
- **Per-user travel times (hardened 2026-03-22)** — `poolCardToApiCard()` recomputes curated card inter-stop travel times at serve time using the requesting user's location and travel mode. First stop reflects user's current location (not admin's generation-time location). `estimatedDurationMinutes` recalculated. Unified `estimateTravelMin` with per-mode detour factors (driving 1.4x, transit 1.3x, walking 1.3x). Must never happen: serving baked generation-time travel times without recomputation.
- **Category-based stops** — all stops reference the 13 seeding categories from `_shared/seedingCategories.ts`. No hardcoded type arrays anywhere in the generator.
- **Serve-time hours enforcement** — curated cards filtered in `discover-cards` if any stop would be closed at the user's calculated arrival time (cascading through stop durations + travel times).
- **Flowers stop** — optional/dismissible on Romantic and First Date. Always included by default. Mobile renders with flower icon + dismiss button.
- **Picnic reverse proximity** — finds the park first (anchor), then queries grocery and flowers within 3km of the park.
- **Global exclusions** — `gym`, `fitness_center`, `dog_park` excluded from all card serving (code + SQL `query_pool_cards`).
- **Children's + school venue filter (hardened 2026-03-22)** — `EXCLUDED_VENUE_NAME_KEYWORDS` in `categoryPlaceTypes.ts` rejects places with child-related AND school-related keywords (kids, toddler, bounce, school, academy, institute, university, college, etc.) at generation time. School types (`school`, `primary_school`, `secondary_school`, `university`, `preschool`) added to global exclusions — filtered at both SQL and TypeScript levels. Must never happen: schools or kids' venues appearing in a dating app.
- **Flowers category (hardened 2026-03-22):** `includedTypes: ['florist']` only — no grocery stores or supermarkets. Grocery/retail types explicitly excluded. Must never happen: department stores surfacing as "Flowers" recommendations.
- **Per-category exclusions (hardened 2026-03-21)** — `category_type_exclusions` table (~697 rows) maps each of the 13 categories to their excluded Google Places types. `query_pool_cards` checks the user's selected categories against the place's types via NOT EXISTS join — if the place has a type excluded for the queried category, the card is filtered out. Exclusions are based on what the user is browsing (v_slug_categories), not what the card is tagged with. Empty category filter = no per-category exclusions, only globals. Admin-auditable: `SELECT * FROM category_type_exclusions WHERE category_slug = ?`.
- **Curated card exclusion (hardened 2026-03-22)** — Curated cards (place_pool_id = NULL) are checked via `card_pool_stops → place_pool → category_type_exclusions` join. Both global and per-category exclusions enforced at serve time. At generation time, `generate-curated-experiences` queries `category_type_exclusions` table (DB-driven, not hardcoded lists) to filter stop candidates. Must never happen: curated card with excluded-type stops passing through unfiltered.
- **Category balancing (hardened 2026-03-22)** — `query_pool_cards` uses `ROW_NUMBER() OVER (PARTITION BY category)` with per-category cap (`CEIL(limit / num_categories)`) to ensure balanced deck representation. Applied to primary + fallback CTEs. Count CTE returns true total. No balancing when no categories selected. Must never happen: single category dominating a multi-category query.
- **Seeding post-fetch filter (hardened 2026-03-21)** — `admin-seed-places` `applyPostFetchFilters` checks ALL `types[]` (not just `primaryType`) against the full exclusion set (global + category-specific) via `getExcludedTypesForCategory()`. Prevents excluded-type places from entering `place_pool` at seeding time.

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

**Category format contract (hardened 2026-03-21):**
- **Canonical storage format is SLUGS** — `card_pool.categories` stores slugs (e.g., `nature_views`, `casual_eats`). This is the source of truth for category identity in the database.
- **Strict SQL normalization** — `query_pool_cards` accepts both display names and slugs but normalizes strictly to the 13 known category slugs via an exhaustive CASE expression. Unknown values are silently dropped — no fuzzy matching, no fallback conversion.
- **Pill = what you get** — when a user selects a category pill, they must only see cards from that exact category. No cross-contamination from loose matching. Enforced at SQL level.
- **Adding a new category requires** — adding WHEN branches for both display name AND slug to the CASE expression in `query_pool_cards`, plus entries in `seedingCategories.ts`, `categoryPlaceTypes.ts`, and rows in `category_type_exclusions` table.
- **Must never happen** — storing display names in `card_pool.categories`, using a regex fallback for unknown categories, bypassing the CASE normalization, or serving cards with excluded types for the queried category.

**Exclusion contract (hardened 2026-03-21):**
- **Three enforcement layers** — (1) Google API excludedPrimaryTypes at query time, (2) post-fetch filter checks ALL types against category + global exclusions before inserting into place_pool, (3) SQL NOT EXISTS in query_pool_cards checks place types against category_type_exclusions table at serve time.
- **Schema-enforced** — `category_type_exclusions` table is the runtime source of truth. No code path can bypass it. Auditable via direct SQL query.
- **Card-centric filtering (corrected 2026-03-21)** — exclusions are checked against the card's OWN categories (cp.categories), not the user's selected categories. Each card is only filtered by exclusions for the categories it belongs to. This prevents cross-category contamination: selecting Nature + Watch must not let Nature's ban on `movie_theater` kill Watch cards. A Watch card at a cinema is fine; a Nature card at a cinema is killed.
- **Global exclusions are independent** — gym, fitness_center, dog_park are always excluded regardless of category, via separate v_excluded_types check.
- **Must never happen** — serving a card whose place has types excluded for the card's own categories, checking exclusions against v_slug_categories instead of cp.categories (causes cross-contamination), or removing the category_type_exclusions table without replacing its enforcement.

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

- **Card Image Pipeline Fix** — All 10 category discover functions gutted to pool-only (~70 lines each, down from ~500). Removed all legacy Google API fallback code (`getPhotoUrl`, `batchSearchPlaces`, `getAllPhotoUrls`). Added error logging to 3 silent `.catch(() => {})` sites. New `backfill-place-photos` edge function re-downloads photos for places with empty `stored_photo_urls`. SQL migration backfills `card_pool.image_url` from `place_pool.stored_photo_urls` for cards with Unsplash/NULL images.
- **Pool Intelligence V2** — Complete rewrite: country-first navigation (All Countries → Country → City), zero seeding dependencies, virtual ~500m neighborhood grid computed from place bounding boxes, 6 new RPCs using TEXT country/city filters instead of UUID city_id, `place_pool.city` column with 3-pass backfill, `card_pool.city`/`country` columns, plain-English metric labels on every stat.
- **Beta Feedback preserved on user deletion** — Changed `beta_feedback.user_id` FK from `ON DELETE CASCADE` to `ON DELETE SET NULL`. The `delete-user` edge function now scrubs PII before profile deletion while preserving all feedback metadata, audio recordings, and admin notes.
- **Delete Account Fix** — Removed broken `handle_user_deletion_cleanup` trigger (referenced dropped columns, blocked all user deletions). Changed 7 `NO ACTION` FKs to `ON DELETE SET NULL`. Companion migration drops `NOT NULL` on 3 admin audit columns that conflicted with SET NULL cascades.
