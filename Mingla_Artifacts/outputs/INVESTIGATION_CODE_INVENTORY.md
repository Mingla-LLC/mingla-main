# Code Inventory (ORCH-0390 Dispatch 1)

> Date: 2026-04-11
> Verified by: Forensic code read (not grep alone)
> Status: Complete

---

## Summary

| Category | Count |
|----------|-------|
| Edge functions (deployable) | **57** |
| Shared utilities (_shared/) | **13** |
| Mobile services | **79** |
| Environment variables | **41 unique** (15 configured, 12 missing, 3 dead, 6 hardcoded, 3 auto-injected, 2 duplicate) |

### README Discrepancies

| Document | Claims | Actual | Delta |
|----------|--------|--------|-------|
| README.md (root) | 71 edge functions | 57 | **-14** (4 deleted as dead, ~10 overcounted or never existed) |
| app-mobile/README.md | 27 edge functions | 57 total (mobile calls ~25 of them) | Misleading framing — 27 was likely "mobile-facing" subset |

---

## 1. Edge Function Inventory (57 functions)

### Card & Experience Generation (12)

| # | Name | Purpose | Trigger | Auth | External APIs | Key Env Vars |
|---|------|---------|---------|------|---------------|-------------|
| 1 | discover-cards | Pool-first single-place card serving | Client | Auth user | Google Places (fallback) | GOOGLE_MAPS_API_KEY |
| 2 | discover-experiences | Curated multi-stop experiences from pool | Client | Auth user | None | — |
| 3 | generate-curated-experiences | Admin batch curated card generation | Client | Service role | OpenAI, Google Places | OPENAI_API_KEY, GOOGLE_MAPS_API_KEY |
| 4 | generate-holiday-categories | Holiday category card generation | Client | Auth user | OpenAI | OPENAI_API_KEY |
| 5 | generate-session-deck | Collab session deck from aggregated prefs | Client | Auth user | Google Places, OpenAI | GOOGLE_MAPS_API_KEY, OPENAI_API_KEY |
| 6 | generate-single-cards | Batch single-place cards from pool | Client | Service role | None | — |
| 7 | get-holiday-cards | Fetch holiday cards with metadata | Client | Auth user | None | — |
| 8 | get-personalized-cards | Personalized deck from preferences | Client | Auth user | Google Places, OpenAI | GOOGLE_MAPS_API_KEY, OPENAI_API_KEY |
| 9 | holiday-experiences | Holiday-specific experience cards | Client | Auth user | Google Places, OpenAI | GOOGLE_MAPS_API_KEY |
| 10 | new-generate-experience- | Core experience generation | Client | Auth user | Google Places, OpenAI | GOOGLE_MAPS_API_KEY, OPENAI_API_KEY |
| 11 | night-out-experiences | Night-out experience cards | Client | Auth user | Google Places, OpenAI | GOOGLE_MAPS_API_KEY |
| 12 | replace-curated-stop | Replace stop in curated itinerary | Client | Auth user | None | — |

### Places & Location (6)

| # | Name | Purpose | Trigger | Auth | External APIs | Key Env Vars |
|---|------|---------|---------|------|---------------|-------------|
| 13 | get-companion-stops | Nearby companion places for strolls | Client | Anon | Google Places | GOOGLE_MAPS_API_KEY |
| 14 | get-nearby-people | Nearby profiles with taste matching | Client | Auth user | None | — |
| 15 | get-picnic-grocery | Grocery stores for picnic shopping | Client | Anon | Google Places | GOOGLE_MAPS_API_KEY |
| 16 | places | Google Places search & serve | Client | Anon | Google Places | GOOGLE_MAPS_API_KEY |
| 17 | update-map-location | Update user's map location | Client | Auth user | None | — |
| 18 | weather | Weather data fetch | Client | Anon | OpenWeather | OPENWEATHER_API_KEY |

### People & Social (7)

| # | Name | Purpose | Trigger | Auth | External APIs | Key Env Vars |
|---|------|---------|---------|------|---------------|-------------|
| 19 | get-paired-saves | Fetch pair partner's saved cards | Client | Auth user | None | — |
| 20 | get-person-hero-cards | Hero cards for saved person/pair | Client | Auth user | None | — |
| 21 | lookup-phone | Phone number user lookup | Client | Auth user | None | — |
| 22 | send-pair-request | Pair request + SMS notification | Client | Auth user | Twilio SMS | TWILIO_* |
| 23 | send-phone-invite | App invite via SMS | Client | Auth user | Twilio SMS | TWILIO_* |
| 24 | send-friend-request-email | Friend request notification | Client | Auth user | None | — |
| 25 | process-referral | Referral check + AppsFlyer S2S | Client | Auth user | AppsFlyer S2S | APPSFLYER_DEV_KEY |

### Notifications (11)

| # | Name | Purpose | Trigger | Auth | External APIs | Key Env Vars |
|---|------|---------|---------|------|---------------|-------------|
| 26 | notify-dispatch | Central notification hub | Edge fn | Service role | OneSignal | ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY |
| 27 | notify-message | Message push notifications | Client/trigger | Service role | None (via dispatch) | — |
| 28 | notify-calendar-reminder | Calendar reminders (cron) | pg_cron hourly | Service role | None (via dispatch) | — |
| 29 | notify-holiday-reminder | Holiday reminders (cron) | pg_cron daily 9AM | Service role | None (via dispatch) | — |
| 30 | notify-invite-response | Invite accept/decline notification | Client | Service role | None (via dispatch) | — |
| 31 | notify-lifecycle | Re-engagement + lifecycle (cron) | pg_cron daily 10AM | Service role | None (via dispatch) | — |
| 32 | notify-pair-activity | Pair save/visit notifications | Client | Service role | None (via dispatch) | — |
| 33 | notify-pair-request-visible | Pair request reveal notification | Client | Service role | None (via dispatch) | — |
| 34 | notify-referral-credited | Referral credit notification | pg_net trigger | Service role | None (via dispatch) | — |
| 35 | send-friend-accepted-notification | Friend accept notification | Client | Service role | None (via dispatch) | — |
| 36 | send-pair-accepted-notification | Pair accept notification | Client | Service role | None (via dispatch) | — |

### Auth & User (4)

| # | Name | Purpose | Trigger | Auth | External APIs | Key Env Vars |
|---|------|---------|---------|------|---------------|-------------|
| 37 | send-otp | Send OTP (SMS/WhatsApp/call) | Client | Auth user | Twilio Verify | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID |
| 38 | verify-otp | Verify OTP code | Client | Auth user | Twilio Verify | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID |
| 39 | delete-user | Account deletion + cascade | Client | Auth user | None | — |
| 40 | record-visit | Log place visit | Client | Auth user | None | — |

### Collaboration (1)

| # | Name | Purpose | Trigger | Auth | External APIs | Key Env Vars |
|---|------|---------|---------|------|---------------|-------------|
| 41 | send-collaboration-invite | Session invite + optional SMS | Client | Auth user | Twilio SMS | TWILIO_* |

### AI & Validation (3)

| # | Name | Purpose | Trigger | Auth | External APIs | Key Env Vars |
|---|------|---------|---------|------|---------------|-------------|
| 42 | ai-reason | Weather-aware activity recs | Client | Anon | OpenAI | OPENAI_API_KEY |
| 43 | ai-verify-pipeline | AI place classification + blacklist | Client | Service role | OpenAI, Serper | OPENAI_API_KEY, SERPER_API_KEY |
| 44 | generate-ai-summary | AI place descriptions | Client | Service role | OpenAI | OPENAI_API_KEY |

### Admin Operations (5)

| # | Name | Purpose | Trigger | Auth | External APIs | Key Env Vars |
|---|------|---------|---------|------|---------------|-------------|
| 45 | admin-place-search | Search & index via Google Places | Client | Service role | Google Places | GOOGLE_MAPS_API_KEY |
| 46 | admin-refresh-places | Refresh place details from Google | Client | Service role | Google Places | GOOGLE_MAPS_API_KEY |
| 47 | admin-seed-map-strangers | Seed fake stranger profiles for map | Client | Service role | None | — |
| 48 | admin-seed-places | Batch seed places via Google Nearby | Client | Service role | Google Places | GOOGLE_MAPS_API_KEY |
| 49 | admin-send-email | Send bulk emails | Client | Service role | Resend | RESEND_API_KEY |

### Events & External (3)

| # | Name | Purpose | Trigger | Auth | External APIs | Key Env Vars |
|---|------|---------|---------|------|---------------|-------------|
| 50 | events | Seeded Creative & Hands-On events | Client | Anon | Eventbrite (optional) | EVENTBRITE_TOKEN |
| 51 | ticketmaster-events | Music events from Ticketmaster | Client | Auth user | Ticketmaster | TICKETMASTER_API_KEY |
| 52 | submit-feedback | Beta feedback with audio/screenshots | Client | Auth user | None | — |

### Infrastructure (5)

| # | Name | Purpose | Trigger | Auth | External APIs | Key Env Vars |
|---|------|---------|---------|------|---------------|-------------|
| 53 | backfill-place-photos | Download & store Google photos | Client | Service role | Google Places Media | GOOGLE_MAPS_API_KEY |
| 54 | keep-warm | Warm isolates of high-traffic functions | pg_cron hourly | Service role | None | — |
| 55 | warm-cache | Pre-generate cards by category | Manual/cron | Service role | Google Places, OpenAI | GOOGLE_MAPS_API_KEY |
| 56 | refresh-place-pool | DEPRECATED — auto refresh disabled | Disabled | Service role | None | — |
| 57 | send-message-email | Message notification (push only) | Trigger | Service role | None | — |

---

## 2. Shared Utility Inventory (13 files)

| # | Name | Purpose | Consumers | External APIs | Env Vars |
|---|------|---------|-----------|---------------|----------|
| 1 | cardPoolService.ts | Pool-first card pipeline (serve, record impressions, upsert) | 7 edge fns | Google Places (fallback) | None |
| 2 | categoryPlaceTypes.ts | 13 Mingla categories ↔ Google Places type mapping | 11 edge fns | None | None |
| 3 | copyEnrichmentService.ts | AI one-liner/tip enrichment for cards | ~2 edge fns | OpenAI | None (key passed as param) |
| 4 | photoStorageService.ts | Download Google photos → Supabase Storage | 1 edge fn | Google Places Media | None |
| 5 | placesCache.ts | Google Places API wrapper (nearby, text, batch) | 8 edge fns | Google Places | None |
| 6 | priceTiers.ts | 4-tier price model (Chill/Comfy/Bougie/Lavish) | 9 edge fns | None | None |
| 7 | push-utils.ts | OneSignal push notification sender | 2 edge fns | OneSignal REST API | ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY |
| 8 | push-translations.ts | Server-side push notification i18n (EN/ES) | 1 edge fn | None | None |
| 9 | scoringService.ts | 5-factor card ranking algorithm | 1 edge fn | None | None |
| 10 | seedingCategories.ts | 13 category configs for admin seeding | 3 edge fns | None | None |
| 11 | stopAlternatives.ts | Alternative stop finder for curated cards | 1 edge fn | None | None |
| 12 | textSearchHelper.ts | Text search fallback for non-standard types | ~2 edge fns | Google Places | None |
| 13 | timeoutFetch.ts | fetch() with AbortController timeout (8-10s) | 5 edge fns | None | None |

---

## 3. Mobile Service Inventory (79 files)

### By Category

**Core Infrastructure (4)**
supabase.ts, networkMonitor.ts, offlineService.ts, deepLinkService.ts

**Auth & Profile (5)**
authService.ts, otpService.ts, preferencesService.ts, enhancedProfileService.ts, permissionOrchestrator.ts

**Analytics & Tracking (6)**
appsFlyerService.ts, mixpanelService.ts, oneSignalService.ts, sessionTracker.ts, userActivityService.ts, userInteractionService.ts

**Subscriptions & Billing (3)**
revenueCatService.ts, subscriptionService.ts, deviceInfoService.ts

**Discovery & Cards (5)**
deckService.ts, sessionDeckService.ts, curatedExperiencesService.ts, savedCardsService.ts, stopReplacementService.ts

**Location & Maps (4)**
locationService.ts, enhancedLocationService.ts, enhancedLocationTrackingService.ts, geocodingService.ts

**Social & Friends (5)**
friendsService.ts, connectionsService.ts, pairingService.ts, pairedSavesService.ts, phoneLookupService.ts

**Messaging (3)**
messagingService.ts, chatPresenceService.ts, inAppNotificationService.ts

**Board & Collaboration (10)**
boardService.ts, boardSessionService.ts, boardCardService.ts, boardDiscussionService.ts, boardMessageService.ts, boardNotificationService.ts, boardInviteService.ts, boardErrorHandler.ts, boardCache.ts, collaborationInviteService.ts

**Calendar & Visits (3)**
calendarService.ts, deviceCalendarService.ts, visitService.ts

**Holidays & People (5)**
customHolidayService.ts, holidayCardsService.ts, holidayCategoryService.ts, holidayExperiencesService.ts, personHeroCardsService.ts

**Experiences & Booking (4)**
experienceGenerationService.ts, experiencesService.ts, savesService.ts, bookingService.ts

**Moderation & Reports (3)**
reportService.ts, blockService.ts, muteService.ts

**Feedback (1)**
betaFeedbackService.ts

**Notifications (2)**
boardNotificationService.ts, smartNotificationService.ts

**Camera & Media (1)**
cameraService.ts

**Currency & Weather (3)**
currencyService.ts, countryCurrencyService.ts, weatherService.ts

**Other (6)**
phoneInviteService.ts, realtimeService.ts, recommendationHistoryService.ts, nightOutExperiencesService.ts, sessionService.ts, enhancedLocationTrackingService.ts

### Edge Function Usage (which services call which functions)

| Service | Edge Functions Called |
|---------|---------------------|
| otpService.ts | send-otp, verify-otp |
| deckService.ts | discover-cards |
| sessionDeckService.ts | discover-cards, generate-curated-experiences |
| curatedExperiencesService.ts | generate-curated-experiences |
| boardNotificationService.ts | notify-dispatch, notify-message |
| boardMessageService.ts | notify-message |
| betaFeedbackService.ts | submit-feedback |
| collaborationInviteService.ts | activate-collaboration-session |

---

## 4. Environment Variable Registry

### CRITICAL — Missing from .env (features broken)

| Variable | Where Used | Impact |
|----------|-----------|--------|
| EXPO_PUBLIC_MIXPANEL_TOKEN | mixpanelService.ts | **All analytics dead** |
| EXPO_PUBLIC_GOOGLE_MAPS_API_KEY | busynessService.ts, geocodingService.ts | Busyness + geocoding broken on client |
| EXPO_PUBLIC_BESTTIME_API_KEY | busynessService.ts | Busyness data unavailable |
| EXPO_PUBLIC_IOS_CLIENT_ID | useAuthSimple.ts | iOS Google Sign-In may fail |

### Hardcoded in Source (acceptable for these SDKs)

| Variable | File | Value (truncated) | Risk Level |
|----------|------|-------------------|-----------|
| ONESIGNAL_APP_ID | oneSignalService.ts:8 | 388b3efc... | Low (public SDK key) |
| AF_DEV_KEY | appsFlyerService.ts:9 | W29Z6cq... | Low (public SDK key) |
| RC_API_KEY (iOS) | revenueCatService.ts:17 | appl_yzY... | Low (public SDK key) |
| RC_API_KEY (Android) | revenueCatService.ts:18 | goog_oUp... | Low (public SDK key) |

Note: OneSignal, AppsFlyer, and RevenueCat SDKs are designed to have public-facing keys embedded in mobile apps. This is standard practice, not a security issue.

### Edge Function Env Vars (must be set in Supabase dashboard)

| Variable | # Functions | Category |
|----------|------------|----------|
| SUPABASE_URL | 40+ | Auto-injected |
| SUPABASE_SERVICE_ROLE_KEY | 40+ | Auto-injected |
| SUPABASE_ANON_KEY | 15+ | Auto-injected |
| GOOGLE_MAPS_API_KEY | 11 | Must configure |
| OPENAI_API_KEY | 7 | Must configure |
| TWILIO_ACCOUNT_SID | 4 | Must configure |
| TWILIO_AUTH_TOKEN | 4 | Must configure |
| TWILIO_VERIFY_SERVICE_SID | 2 | Must configure |
| ONESIGNAL_APP_ID | 1 (_shared) | Must configure |
| ONESIGNAL_REST_API_KEY | 1 (_shared) | Must configure |
| RESEND_API_KEY | 1 | Must configure |
| TICKETMASTER_API_KEY | 1 | Optional |
| OPENWEATHER_API_KEY | 1 | Optional |
| EVENTBRITE_TOKEN | 1 | Optional |
| SERPER_API_KEY | 1 | Optional |
| APPSFLYER_DEV_KEY | 1 | Optional |

### Dead Config (set but never used)

| Variable | Where Set | Notes |
|----------|----------|-------|
| EXPO_PUBLIC_FOURSQUARE_API_KEY | app-mobile/.env | Never read in code |
| GOOGLE_WEB_CLIENT_SECRET | app.json extra | Empty string, never used |
| GOOGLE_IOS_CLIENT_SECRET | app.json extra | Empty string, never used |

---

## 5. Admin Dashboard Data Patterns (16 pages)

| Page | Edge Functions | RPCs | Direct Tables |
|------|--------------|------|--------------|
| AdminPage | — | — | admin_users, admin_audit_log |
| AIValidationPage | ai-verify-pipeline | 6 RPCs (admin_ai_*) | — |
| AnalyticsPage | — | 5 RPCs (admin_analytics_*) | user_sessions, profiles |
| BetaFeedbackPage | — | — | beta_feedback |
| CardPoolManagementPage | generate-single-cards | 8 RPCs (admin_card_*) | card_pool, card_pool_stops |
| ContentModerationPage | — | — | experiences, card_pool, profiles, place_reviews |
| EmailPage | admin-send-email | — | email_templates, admin_email_log |
| OverviewPage | — | — | Dynamic tables (count mode) |
| PhotoPoolManagementPage | — | 12 RPCs (admin_photo_*) | — |
| PlacePoolManagementPage | backfill-place-photos, admin-seed-places | 7 RPCs (admin_place_*) | place_pool, seeding_cities, seeding_* |
| ReportsPage | — | — | user_reports |
| SeedPage | admin-seed-map-strangers | Dynamic seed RPCs | — |
| SettingsPage | — | — | feature_flags, app_config |
| SubscriptionManagementPage | — | 5 RPCs (admin_*_subscription*) | — |
| TableBrowserPage | — | — | Dynamic (any table) |
| UserManagementPage | delete-user | — | 25+ tables |

### Admin-Exclusive Edge Functions (6)

These are called ONLY from admin, never from mobile:
1. ai-verify-pipeline
2. generate-single-cards
3. backfill-place-photos
4. admin-seed-places
5. admin-seed-map-strangers
6. admin-send-email

### Admin RPC Count: 41 unique RPCs

---

## Discrepancies Found

| # | Discrepancy | Impact |
|---|-------------|--------|
| 1 | README claims "71 edge functions" — actual count is 57 | README must be updated |
| 2 | app-mobile/README claims "27 edge functions" — misleading (27 is mobile-facing subset of 57 total) | README must clarify |
| 3 | EXPO_PUBLIC_MIXPANEL_TOKEN missing from .env AND .env.example | All Mixpanel analytics dead |
| 4 | EXPO_PUBLIC_FOURSQUARE_API_KEY in .env but never used in code | Dead config, remove |
| 5 | admin-send-email uses direct fetch() to edge function URL instead of supabase.functions.invoke() | Pattern deviation (works but inconsistent) |
| 6 | refresh-place-pool is deprecated/disabled but still deployed | Remove or document as disabled |
| 7 | new-generate-experience- has trailing dash in directory name | Unusual naming, but functional |
| 8 | 4 deleted edge functions still referenced in README | Stale docs (flagged by tester P3-1) |
