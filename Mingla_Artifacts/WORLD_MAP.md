# Mingla World Map

> Last updated: 2026-04-11
> Orchestrator version: 1.0
> This is the single source of truth for all Mingla product reality.

---

## Product Surface Inventory

| Surface | Domain | Key Files | Grade | Items Tracked | Coverage |
|---------|--------|-----------|-------|---------------|----------|
| Auth & Session | Mobile + Backend | useAuthSimple.ts, session management | Mixed (2A, 4B, 1C) | 7 | Partial |
| Onboarding | Mobile | OnboardingFlow.tsx, useOnboardingStateMachine.ts | Mixed (3A, 9F) | 12 | Weak |
| Discovery / Explore | Mobile + Backend | SwipeableCards.tsx, deckService.ts, RecommendationsContext.tsx | Strong (38A, 5B, 0C, 12F) | 55 | Strong |
| Collaboration Sessions | Mobile + Backend | SessionViewModal, CollaborationSessions.tsx | Mixed (3A, 4F) | 7 | Weak |
| Social / Friends | Mobile + Backend | friendsService.ts, ConnectionsPage.tsx | Mixed (1A, 1B, 5F) | 7 | Weak |
| Notifications | Mobile + Backend | notify-dispatch, NotificationsModal.tsx | Mixed (7A, 2B, 3F) | 12 | Partial |
| Saved / Boards | Mobile | LikesPage.tsx, boardService.ts | All F | 5 | Unaudited |
| Profile & Settings | Mobile | ProfilePage.tsx, AccountSettings.tsx | Mixed (3A, 1B, 6F) | 10 | Weak |
| Map & Location | Mobile + Backend | DiscoverMap.tsx, get-nearby-people | All F | 16 | Unaudited |
| Chat / DM | Mobile + Backend | messagingService.ts, useMessages.ts | All F | 8 | Unaudited |
| Payments & Subscriptions | Mobile + Backend | useRevenueCat.ts, PaywallScreen.tsx | Mixed (8A, 6B, 1C) | 15 | Strong |
| Calendar & Scheduling | Mobile | CalendarTab.tsx, calendarService.ts | All F | 8 | Unaudited |
| Holidays & Events | Mobile + Backend | holiday-experiences, CustomHolidayModal.tsx | Mixed (1B, 6F) | 7 | Weak |
| People Discovery | Mobile + Backend | DiscoverScreen.tsx, get-person-hero-cards | All F | 10 | Unaudited |
| Pairing System | Mobile + Backend | pairingService.ts, send-pair-request | Mixed (3A, 7F) | 10 | Weak |
| Sharing & Invites | Mobile + Backend | ShareModal.tsx, send-phone-invite | All F | 10 | Unaudited |
| Post-Experience & Reviews | Mobile + Backend | PostExperienceModal.tsx, record-visit | All F | 9 | Unaudited |
| Booking | Mobile | bookingService.ts | All F | 2 | Unaudited |
| Reporting & Moderation | Mobile + Admin + Backend | ReportModal, admin Reports page | All F (2×S0, 1×S1) | 3 | Unaudited |
| Network & Offline | Cross-cutting | networkMonitor.ts | Mixed (1B, 4F) | 5 | Weak |
| State & Cache | Cross-cutting | queryKeys.ts, Zustand stores | Mixed (5A, 3F) | 8 | Partial |
| Chat Responsiveness | Cross-cutting | messagingService.ts | All A | 4 | Strong |
| Hardening Infrastructure | Cross-cutting | withTimeout.ts, mutationErrorToast.ts | All A | 3 | Strong |
| Error Handling | Cross-cutting | ErrorBoundary.tsx, edgeFunctionError.ts | All F | 5 | Unaudited |
| Security & Auth | Cross-cutting | RLS policies, admin auth | Mixed (1A, 1B, 1C, 2D) | 13 | Weak |
| Deep Linking | Cross-cutting | deepLinkService.ts | Mixed (1B, 3F) | 4 | Weak |
| App Lifecycle | Cross-cutting | AppStateManager.tsx, AnimatedSplashScreen.tsx, useForegroundRefresh.ts | Mixed (2A, 10F) | 12 | Weak |
| Analytics & Tracking | Cross-cutting | appsFlyerService.ts, mixpanelService.ts | Mixed (1A, 7F) | 8 | Weak |
| Weather & External | Cross-cutting | weatherService.ts, geocodingService.ts | All F | 6 | Unaudited |
| UI Components | Cross-cutting | Toast.tsx, InAppBrowserModal.tsx | Mixed (3A, 7F) | 10 | Weak |
| Admin Panel | Admin | PlacePoolManagementPage.jsx, admin-seed-places | Mixed (1A, 4F) | 5 | Weak |
| Code Quality | Cross-cutting | tsconfig.json, all .ts/.tsx files | All A | 1 | Strong |

---

## User Journey

### Phase 1: Acquisition
Install → Welcome Screen → OAuth (Google/Apple)

### Phase 2: Onboarding
Phone OTP → Gender → Details → Value Prop → Intent → Location → Preferences → Friends → Collab → Consent → Deck Ready

### Phase 3: Core Loop
Explore (deck swipe) → Save → Schedule → Invite → Collaborate → Go → Review

### Phase 4: Retention
Calendar reminders → Push notifications → Holiday experiences → Re-engagement → Subscription upgrade

### Phase 5: Social
Friend discovery → Pair requests → DM → Map presence → Activity feed

---

## Issue Registry

### Section 1: Authentication & Session Management

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0001 | Phone OTP verification (onboarding) | Auth | S1 | quality-gap | verified | B | 2026-03-31 | INVESTIGATION_AUTH_WAVE1.md — backend solid, client in onboarding scope |
| ORCH-0002 | Session persistence | Auth | S1 | quality-gap | verified | B | 2026-03-25 | _hasHydrated gate + Zustand persistence |
| ORCH-0003 | Token refresh / expiry handling | Auth | S0 | bug | closed | A | 2026-03-24 | Commit aa9cfd68 |
| ORCH-0004 | Sign-out cleanup | Auth | S0 | bug | closed | A | 2026-03-31 | QA_ORCH-0004_SIGNOUT_CLEANUP_REPORT.md — RevenueCat/Mixpanel added, 401 rewired, dead code removed |
| ORCH-0005 | Google Sign-In flow | Auth | S1 | quality-gap | verified | C | 2026-03-31 | INVESTIGATION_AUTH_WAVE1.md — works but brittle string matching in retry logic |
| ORCH-0006 | Apple Sign-In flow | Auth | S1 | quality-gap | verified | B | 2026-03-31 | INVESTIGATION_AUTH_WAVE1.md — clean, minor fire-and-forget name risk |
| ORCH-0007 | Zombie auth prevention | Auth | S1 | bug | verified | B | 2026-03-23 | Commit 2a96c8f6 |
| ORCH-0348 | Auto-assign beta tester flag on signup + backfill existing users | Auth | S2 | missing-feature | closed | A | 2026-04-09 | Migration 20260409700000 applied. Column default → true, all existing rows backfilled. Verified: 0 users with false. |

### Section 2: Onboarding

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0008 | State machine progression | Onboarding | S0 | unaudited | open | F | — | — |
| ORCH-0009 | GPS requirement enforcement | Onboarding | S1 | unaudited | open | F | — | — |
| ORCH-0010 | Preference save reliability | Onboarding | S1 | bug | closed | A | 2026-03-23 | Commit 302b74d5 |
| ORCH-0011 | Resume after interruption | Onboarding | S1 | unaudited | open | F | — | — |
| ORCH-0012 | Audio recording (voice review) | Onboarding | S2 | unaudited | open | F | — | — |
| ORCH-0013 | Country/language picker | Onboarding | S2 | unaudited | open | F | — | — |
| ORCH-0014 | Intent selection step | Onboarding | S1 | unaudited | open | F | — | — |
| ORCH-0015 | Travel mode selection | Onboarding | S2 | unaudited | open | F | — | — |
| ORCH-0016 | Friends & pairing onboarding step | Onboarding | S2 | unaudited | open | F | — | — |
| ORCH-0017 | Consent step | Onboarding | S1 | unaudited | open | F | — | — |
| ORCH-0018 | Skip button responsiveness | Onboarding | S2 | bug | closed | A | 2026-03-23 | Commit 76cd2ca7 |
| ORCH-0350 | Update Terms/Privacy URLs app-wide to usemingla.com | Cross-cutting | S2 | missing-feature | closed | A | 2026-04-09 | QA_ORCH-0350-0351 PASS. All legal URLs centralized in urls.ts → usemingla.com. 660 lines hardcoded text deleted. InAppBrowserModal for Profile + Paywall. |
| ORCH-0351 | SMS consent checkbox gate before OTP on onboarding | Onboarding | S1 | missing-feature | closed | A | 2026-04-09 | QA_ORCH-0350-0351 PASS. Checkbox + TCPA consent text. CTA gated. InAppBrowserModal links. Full accessibility. |
| ORCH-0370 | OTP multi-channel support — add WhatsApp and voice call fallback channels via Twilio Verify | Onboarding | S2 | missing-feature | closed | A | 2026-04-10 | QA PASS. 16/16 tests, 0 defects. send-otp accepts channel param (sms/whatsapp/call). OTP sub-step shows fallback buttons. Consent text covers all channels. verify-otp untouched. |
| ORCH-0386 | App-wide i18n — translate all UI strings + move language picker to first onboarding screen | Onboarding + Cross-cutting | S2 | missing-feature | closed | A | 2026-04-11 | QA PASS. 13/13 SC, 5/5 regressions, 0 defects. i18next + react-i18next wired. Language picker first onboarding screen. 171 keys EN+ES. All onboarding strings use t(). |
| ORCH-0387 | Settings language picker uses stale hardcoded 10-language list instead of canonical 25 | Profile & Settings | S3 | quality-gap | open | F | — | Found during ORCH-0386 investigation |
| ORCH-0388 | 37 hardcoded 'en-US' locale strings in date/currency formatting — wrong for non-US users | Cross-cutting | S2 | bug | open | F | — | Found during ORCH-0386 investigation |

### Section 3: Discovery / Explore (Card Deck)

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0019 | Pool-first card pipeline | Discovery | S0 | architecture-flaw | closed | A | 2026-03-20 | Multiple commits |
| ORCH-0020 | Curated card generation | Discovery | S0 | architecture-flaw | closed | A | 2026-03-20 | Commits 77b92984, 27d4ea8b |
| ORCH-0021 | Category system (13 categories) | Discovery | S1 | architecture-flaw | closed | A | 2026-03-21 | Commits 6c7b2429, e42429af |
| ORCH-0022 | Admin seeding pipeline | Discovery | S1 | missing-feature | closed | A | 2026-03-20 | Commit 1bab3a10 |
| ORCH-0023 | Admin pool management (UI) | Discovery | S2 | missing-feature | closed | A | 2026-03-20 | Commits 9af5b5e4, 9493a697 |
| ORCH-0024 | Admin Card Pool page (rewrite) | Discovery | S1 | architecture-flaw | closed | A | 2026-03-21 | Commit e58d8769 |
| ORCH-0025 | Per-category exclusion enforcement | Discovery | S1 | bug | closed | A | 2026-03-21 | Commits 984f8be7, a408e1b1 |
| ORCH-0026 | City/country TEXT contract | Discovery | S1 | data-integrity | closed | A | 2026-03-21 | Commit 5db8dbe8 |
| ORCH-0027 | Card photo integrity | Discovery | S1 | data-integrity | closed | A | 2026-03-22 | Commit 7ca26b48 |
| ORCH-0028 | Curated nearest-place selection | Discovery | S2 | bug | closed | A | 2026-03-22 | Commit 35c10157 |
| ORCH-0029 | Curated per-user travel times | Discovery | S2 | bug | closed | A | 2026-03-22 | Commit 35c10157 |
| ORCH-0030 | Card photo coverage | Discovery | S1 | data-integrity | closed | A | 2026-03-22 | Commits 7ca26b48, 267b29b0 |
| ORCH-0031 | Broken icons (ICON_MAP) | Discovery | S2 | bug | closed | A | 2026-03-22 | Commit 88f2d43f |
| ORCH-0032 | "Now" filter live opening hours | Discovery | S1 | bug | closed | A | 2026-03-22 | Commit 28be9a63 |
| ORCH-0033 | Batch transition hang (16s) | Discovery | S1 | bug | closed | A | 2026-03-22 | Commit 28be9a63 |
| ORCH-0034 | Prefetch key alignment | Discovery | S2 | bug | closed | A | 2026-03-22 | Commit 28be9a63 |
| ORCH-0035 | Triple duplicate API calls | Discovery | S2 | performance | verified | B | 2026-03-22 | One hidden flaw remains |
| ORCH-0036 | ActionButtons analytics | Discovery | S3 | missing-feature | closed | A | 2026-03-22 | Commit dba7b3f0 |
| ORCH-0037 | Expanded card travel mode icon | Discovery | S3 | bug | closed | A | 2026-03-22 | Commit dba7b3f0 |
| ORCH-0038 | Coordinates replacing text in location | Discovery | S1 | bug | closed | A | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md — custom location now deterministic, GPS fallback eliminated |
| ORCH-0039 | Currency changes with GPS | Discovery | S1 | bug | open | F | — | INVESTIGATION_DECK_AND_DISCOVER.md |
| ORCH-0040 | priceLevel enum on paired cards | Discovery | S2 | bug | open | F | — | INVESTIGATION_DECK_AND_DISCOVER.md |
| ORCH-0041 | Curated cards missing Schedule button | Discovery | S1 | bug | open | F | — | INVESTIGATION_DECK_AND_DISCOVER.md |
| ORCH-0042 | Paired view repeated experiences | Discovery | S2 | bug | verified | B | 2026-03-24 | Commit 0ae81113 |
| ORCH-0043 | Policies open phone browser | Discovery | S2 | bug | open | F | — | User report |
| ORCH-0044 | Schedule picker behind modal | Discovery | S2 | bug | open | F | — | User report |
| ORCH-0045 | No schedule confirmation | Discovery | S2 | ux | open | F | — | User report |
| ORCH-0046 | Can't use current date to schedule | Discovery | S2 | bug | open | F | — | User report |
| ORCH-0047 | Slug on saved page | Discovery | S2 | bug | open | F | — | User report |
| ORCH-0048 | Curated/category round-robin broken | Discovery | S1 | bug | closed | A | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md — category interleave rewritten with round-robin balancer |
| ORCH-0049 | Schools in cards | Discovery | S1 | bug | closed | A | 2026-03-24 | Commit 0ae81113 |
| ORCH-0050 | AI Card Quality Gate | Discovery | S1 | architecture-flaw | verified | B | 2026-03-26 | Commits c9708465, 97a5dfd0 |
| ORCH-0051 | Flowers category too broad | Discovery | S2 | quality-gap | verified | B | 2026-03-26 | Commit 97a5dfd0 |
| ORCH-0052 | Curated AI stop descriptions missing | Discovery | S2 | bug | open | F | — | User report |
| ORCH-0053 | Push delivery via OneSignal | Discovery | S0 | bug | closed | A | 2026-03-22 | Commits 163ce5f1, 469b0f11 |
| ORCH-0054 | Per-category deck balancing | Discovery | S2 | bug | closed | A | 2026-03-22 | Commit 7fef7ed0 |
| ORCH-0055 | Curated card exclusion enforcement | Discovery | S1 | bug | closed | A | 2026-03-22 | Commit 7fef7ed0 |
| ORCH-0056 | Category balancing | Discovery | S2 | bug | closed | A | 2026-03-22 | Commit 7fef7ed0 |
| ORCH-0057 | Children's venue filter | Discovery | S1 | bug | closed | A | 2026-03-22 | Commit dba7b3f0 |
| ORCH-0058 | Empty category pools (operational) | Discovery | S2 | missing-feature | open | F | — | Needs seeding |
| ORCH-0059 | Discover retry responsiveness | Discovery | S2 | bug | closed | A | 2026-03-23 | Commit 2a96c8f6 |
| ORCH-0060 | Pull-to-refresh fix | Discovery | S2 | bug | closed | A | 2026-03-23 | Commit 2a96c8f6 |
| ORCH-0061 | Card rendering (all types) | Discovery | S1 | bug | closed | A | 2026-03-25 | Commits 5702067b + Pass 5 |
| ORCH-0062 | Swipe mechanics | Discovery | S1 | bug | closed | A | 2026-03-25 | Commits acf7e508 + Pass 5 |
| ORCH-0063 | Empty pool state | Discovery | S2 | quality-gap | verified | B | 2026-03-20 | HTTP 200 with empty array |
| ORCH-0064 | Preferences → deck pipeline | Discovery | S0 | architecture-flaw | closed | A | 2026-03-24 | Commit 79d0905b |
| ORCH-0065 | Solo mode | Discovery | S1 | quality-gap | verified | B | 2026-03-31 | INVESTIGATION_PREFS_DECK_CONTRACT.md — core contract verified, deck deterministic |
| ORCH-0066 | Collab mode parity | Discovery | S0 | architecture-flaw | closed | A | 2026-04-06 | QA_ORCH-0066_COLLAB_PREF_PARITY_REPORT.md + INVESTIGATION_UNIFY_PREFERENCE_SHEETS_REPORT.md — Phase 1: save/load parity + UNION aggregation (14/14 PASS). Phase 2: dead CollaborationPreferences.tsx deleted. All sub-issues closed. |
| ORCH-0266 | Double pagination — card pool unreachable | Discovery | S0 | bug | closed | A | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md — duplicate .range() removed, all 200 pool cards reachable |
| ORCH-0267 | Travel time not enforced in deck | Discovery | S1 | bug | closed | A | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md — hard filter added, out-of-range cards excluded |
| ORCH-0268 | NULL price tier passthrough | Discovery | S2 | bug | closed | A | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md — NULL price_level now filtered before deck assembly |
| ORCH-0272 | Cross-page dedup — pages return same 20 cards + UI freeze | Discovery | S0 | bug | closed | A | 2026-04-02 | QA_ORCH_0272_CROSS_PAGE_DEDUP_REPORT.md — ON CONFLICT predicate fixed, error throw + circuit breaker added. Migration applied live. 7/7 tests PASS. |
| ORCH-0301 | Swiped cards reappear in same session — duplicate cards in deck | Discovery | S1 | bug | spec-ready | F | — | FORENSIC_MASTER_REPORT.md — SwipeableCards.tsx:938 clears removedCards on batch append. Effect can't distinguish append from replacement. |
| ORCH-0302 | Exact address not persisting in preferences sheet — truncated to short form | Discovery | S1 | bug | spec-ready | F | — | FORENSIC_MASTER_REPORT.md — PreferencesSheet.tsx:530 saves suggestion.displayName (short) instead of suggestion.fullAddress. |
| ORCH-0303 | Under 10 cards then exhausted despite large pool | Discovery | S1 | bug | spec-ready | F | — | FORENSIC_MASTER_REPORT.md — limit:20 hardcoded in 3 places + datetime filter kills 60%+ evening cards + curated gets disproportionately small allocation. |
| ORCH-0304 | GPS location stuck on old city (Raleigh) — staleTime:Infinity + undefined refreshKey | Discovery | S0 | bug | spec-ready | F | — | FORENSIC_MASTER_REPORT.md — 3 compounding failures: staleTime:Infinity, undefined refreshKey in DiscoverScreen, one-shot GPS never resets. |
| ORCH-0305 | Card Pool page doesn't show AI-approved cards (64 fine dining Raleigh approved but not visible) | Admin | S1 | bug | open | F | — | User report 2026-04-04 — AI-categorized and approved places not appearing in card pool UI |
| ORCH-0306 | Cannot generate single cards for entire batch of available cards | Admin | S1 | bug | open | F | — | User report 2026-04-04 — generate cards button doesn't process all available cards |
| ORCH-0307 | Card generation has no progress feedback — no batch count, no live stats, just success message | Admin | S1 | ux | open | F | — | User report 2026-04-04 — unlike seeding/photo download which show live progress, card gen is fire-and-forget |
| ORCH-0308 | Pair request acceptance not updating in real-time for SENDER | Pairing | S1 | bug | open | F | — | User report 2026-04-04 — sender sends request, receiver accepts, sender's UI doesn't update. Realtime subscription exists but may not fire (RPC bypass, user_a/user_b ordering, or WebSocket disconnect). |
| ORCH-0309 | 921 cards had wrong categories — generated before AI recategorized, never updated | Discovery | S0 | data-integrity | closed | A | 2026-04-05 | SQL fix applied live: synced all card_pool.categories with place_pool.ai_categories. Structural fix: generate-single-cards now syncs categories on duplicate detection instead of just skipping. |
| ORCH-0310 | 724 AI-approved places globally have zero cards generated | Discovery | S1 | missing-feature | open | F | — | DB evidence: LEFT JOIN card_pool on place_pool_id shows 724 approved+active places with no card_pool entry. Blocked by ORCH-0305/0306. |
| ORCH-0311 | custom_lat/custom_lng NULL in DB despite custom location being set | Discovery | S1 | bug | open | F | — | DB evidence: preferences row has custom_location string but custom_lat=null, custom_lng=null. Fire-and-forget save not persisting coordinates. |
| ORCH-0312 | query_pool_cards RPC times out on cold call for large result sets (Baltimore 1335 cards) | Discovery | S1 | performance | open | F | — | Log evidence: "canceling statement due to statement timeout" + discover-cards ERROR 12008ms for Baltimore bbox. |
| ORCH-0313 | Timezone double-application in datetime filter — picks wrong day for scheduled dates | Discovery | S0 | bug | closed | A | 2026-04-05 | datetimePref already encodes local midnight as UTC. Edge function applied longitude offset (-5h) on top, pushing midnight April 6 (Monday) back to April 5 23:00 (Sunday). Most fine dining closed Sunday → 5 cards instead of 14+. Fixed: extract day directly from datetimePref without offset. |
| ORCH-0314 | Admin card pool dashboard shows counts by seeding_category not card_pool.categories — misleading | Admin | S2 | ux | open | F | — | Dashboard shows 32 fine dining for Raleigh but only 20 have fine_dining in card_pool.categories. Rest were AI-recategorized to casual_eats etc. |
| ORCH-0315 | Hidden CATEGORY_MIN_PRICE_TIER floor kills AI-approved fine dining cards with low price tiers | Discovery | S1 | architecture-flaw | closed | A | 2026-04-05 | scorePoolCards had a bougie price floor for fine_dining. 4 AI-approved cards (Brodeto, M Sushi, Omakase, The Pit) permanently invisible because price_tier was chill/comfy. Removed — AI is the sole quality gate. |
| ORCH-0273 | place_pool → card_pool data drift (13+ fields stale) | Discovery | S1 | architecture-flaw | closed | A | 2026-04-02 | QA_PLACE_POOL_CARD_POOL_SYNC_REPORT.md — Unified sync trigger, 16 fields + curated composites. Old website trigger replaced. 10/10 PASS. P3: redundant city/country trigger (cleanup). |
| ORCH-0274 | Photo backfill pipeline broken — no city filter, timeouts, no job tracking | Discovery | S1 | architecture-flaw | closed | A | 2026-04-02 | QA_PHOTO_BACKFILL_PHASE1_BACKEND_REPORT.md + QA_PHOTO_BACKFILL_PHASE2_ADMIN_UI_REPORT.md — Full job system: 2 tables, 9 actions, city-scoped batches, auto-advance, persist across reloads. P1 13/13 + P2 10/10 PASS. |

| ORCH-0392 | Travel mode pills overflow section container — "Driving" bleeds right edge after i18n label change | Discovery | S2 | regression | closed | A | 2026-04-11 | flexWrap: "wrap" added to travelModesGrid. Visually verified EN + ES on-device. Parent: ORCH-0386. |

### Section 4: Collaboration Sessions

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0067 | UI consolidation (single entry point) | Collaboration | S2 | design-debt | closed | A | 2026-03-23 | Commit 15fe8742 |
| ORCH-0068 | Board exit responsiveness | Collaboration | S2 | bug | closed | A | 2026-03-23 | Commit 76cd2ca7 |
| ORCH-0069 | Session load performance | Collaboration | S1 | performance | closed | A | 2026-03-24 | Commit 3ee1bce9 |
| ORCH-0070 | Session creation | Collaboration | S1 | unaudited | open | F | — | — |
| ORCH-0071 | Invite send/receive | Collaboration | S1 | unaudited | open | F | — | — |
| ORCH-0072 | Real-time sync | Collaboration | S1 | unaudited | open | F | — | — |
| ORCH-0073 | Voting mechanics | Collaboration | S1 | unaudited | open | F | — | — |
| ORCH-0074 | Session end / results | Collaboration | S2 | unaudited | open | F | — | — |
| ORCH-0075 | Concurrent mutation safety | Collaboration | S1 | unaudited | open | F | — | — |
| ORCH-0316 | Dead code: CollaborationPreferences.tsx deleted (1,753 lines, zero imports) | Collaboration | S1 | architecture-flaw | closed | A | 2026-04-06 | INVESTIGATION_UNIFY_PREFERENCE_SHEETS_REPORT.md — File was never imported. PreferencesSheet already handled both modes. Deleted. Parent: ORCH-0066. |
| ORCH-0317 | Collab time_slot missing from PreferencesSheet save + normalizer doesn't clear time_of_day | Collaboration | S0 | bug | closed | A | 2026-04-06 | QA_ORCH-0066_COLLAB_PREF_PARITY_REPORT.md — time_slot added to save payload, normalizer clears both fields on "now". 14/14 PASS. |
| ORCH-0318 | Travel constraint aggregation MEDIAN → Math.max (UNION) | Collaboration | S0 | bug | closed | A | 2026-04-06 | QA_ORCH-0066_COLLAB_PREF_PARITY_REPORT.md — Math.max replaces median. MODE_RANK for travel mode. DATE_RANK for date option. timeSlots UNION array. 14/14 PASS. |
| ORCH-0319 | custom_lat/lng missing from PreferencesSheet collab save + load | Collaboration | S1 | bug | closed | A | 2026-04-06 | QA_ORCH-0066_COLLAB_PREF_PARITY_REPORT.md — Coordinates added to save, structured use_gps_location loading, coords restored on load. 14/14 PASS. |
| ORCH-0320 | Legacy time_of_day / time_slot — collab load reads time_slot||time_of_day | Collaboration | S1 | bug | closed | A | 2026-04-06 | QA_ORCH-0066_COLLAB_PREF_PARITY_REPORT.md — Prefers time_slot, falls back to time_of_day. Both written on save. 14/14 PASS. |
| ORCH-0321 | PreferencesSheet collab load restores date_option with kebab + legacy compat | Collaboration | S1 | bug | closed | A | 2026-04-06 | QA_ORCH-0066_COLLAB_PREF_PARITY_REPORT.md — KEBAB_TO_DATE_OPTION map handles both formats. 14/14 PASS. |
| ORCH-0322 | RLS policy gap — board_session_preferences has no INSERT policy for non-creator participants | Collaboration | S1 | security | open | F | — | INVESTIGATION_COLLAB_PREF_PARITY_REPORT.md Finding 8 — Original migration only has SELECT + UPDATE (creator only). Needs separate investigation. |
| ORCH-0323 | generate-curated-experiences standalone aggregation stale — MIN, no time_slot, legacy location parse | Collaboration | S2 | design-debt | open | F | — | INVESTIGATION_COLLAB_PREF_PARITY_REPORT.md Findings 9+10 — Not used in deck flow but will break if called with session_id. |

### Section 5: Social / Friends

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0076 | Friend request send/accept/decline | Social | S1 | bug | verified | B | 2026-03-23 | Commit 76cd2ca7 |
| ORCH-0077 | Link intent flow | Social | S2 | unaudited | open | F | — | — |
| ORCH-0078 | Block/unblock/remove responsiveness | Social | S2 | bug | closed | A | 2026-03-23 | Commit 76cd2ca7 |
| ORCH-0079 | Friend-based content visibility | Social | S1 | unaudited | open | F | — | — |
| ORCH-0080 | Friend search (search-users) | Social | S2 | unaudited | open | F | — | Edge function `search-users` deleted as dead code (ORCH-0390). Feature never built. |
| ORCH-0081 | View friend profile | Social | S2 | unaudited | open | F | — | — |
| ORCH-0082 | Mute/unmute friends | Social | S3 | unaudited | open | F | — | — |

### Section 6: Notifications

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0083 | Push delivery (OneSignal) | Notifications | S1 | quality-gap | verified | B | 2026-03-21 | Investigation report |
| ORCH-0084 | Pair accepted notification | Notifications | S2 | missing-feature | closed | A | 2026-03-21 | Commit 376cd237 |
| ORCH-0085 | Pair activity preference enforcement | Notifications | S2 | bug | closed | A | 2026-03-21 | Commit 376cd237 |
| ORCH-0086 | Dead type cleanup | Notifications | S3 | design-debt | closed | A | 2026-03-21 | Commit 376cd237 |
| ORCH-0087 | In-app notifications | Notifications | S1 | unaudited | open | F | — | — |
| ORCH-0088 | Deep link from notification | Notifications | S2 | quality-gap | verified | B | 2026-03-23 | Commit 15fe8742 |
| ORCH-0089 | Notification for deleted content | Notifications | S2 | unaudited | open | F | — | — |
| ORCH-0090 | iOS app badge | Notifications | S2 | bug | closed | A | 2026-03-23 | Commits d4c6725e, ea655d36 |
| ORCH-0091 | DM unread realtime | Notifications | S2 | bug | closed | A | 2026-03-23 | Commit ea655d36 |
| ORCH-0092 | Notification send observability | Notifications | S2 | quality-gap | verified | B | 2026-03-23 | Commit ea655d36 |
| ORCH-0093 | Realtime subscription lifecycle | Notifications | S1 | architecture-flaw | closed | A | 2026-03-23 | Commit ea655d36 |
| ORCH-0349 | Acted-on notifications not auto-clearing (in-sheet + out-of-sheet) | Notifications | S1 | bug | closed | A | 2026-04-09 | QA PASS. DB trigger + graceful stale handling + out-of-sheet cleanup. Migration 20260409800000. |

### Section 7: Saved Experiences / Boards

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0094 | Save/unsave experience | Saved | S1 | unaudited | open | F | — | — |
| ORCH-0095 | Board create/edit/delete | Saved | S1 | unaudited | open | F | — | — |
| ORCH-0096 | Board sharing | Saved | S2 | unaudited | open | F | — | — |
| ORCH-0097 | Board RSVP | Saved | S2 | unaudited | open | F | — | — |
| ORCH-0098 | Saved content cache | Saved | S2 | unaudited | open | F | — | — |

### Section 8: Profile & Settings

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0099 | Profile cold-start freshness | Profile | S2 | bug | closed | A | 2026-03-23 | Commit a268b19f |
| ORCH-0100 | Preference updates + authority | Profile | S1 | architecture-flaw | closed | A | 2026-03-23 | Commits 302b74d5, a268b19f |
| ORCH-0101 | Category filter → deck sync | Profile | S1 | bug | closed | A | 2026-03-23 | Commit a268b19f |
| ORCH-0102 | Account deletion | Profile | S0 | unaudited | open | F | — | — |
| ORCH-0103 | Subscription tier freshness | Profile | S1 | quality-gap | verified | B | 2026-03-23 | Commit cdd3cac0 |
| ORCH-0104 | Purchase error handling | Profile | S1 | bug | closed | A | 2026-03-23 | Commit cdd3cac0 |
| ORCH-0105 | Subscription management | Profile | S1 | unaudited | open | F | — | — |
| ORCH-0106 | Edit bio | Profile | S3 | unaudited | open | F | — | — |
| ORCH-0107 | Edit interests | Profile | S3 | unaudited | open | F | — | — |
| ORCH-0108 | Privacy controls | Profile | S2 | unaudited | open | F | — | — |
| ORCH-0109 | Billing management | Profile | S2 | unaudited | open | F | — | — |
| ORCH-0110 | Terms/Privacy screens | Profile | S2 | unaudited | open | F | — | — |
| ORCH-0352 | Beta feedback modal — end-to-end defects (freeze, stale state, audio leak, icon errors, close-path gaps) | Profile | S1 | bug | closed | A | 2026-04-09 | QA PASS (AH-051). Full audit found 4 defects (missing pause icon, orphaned success timer, unstable onClose, cached permissions). All fixed in clean pass (AH-050). Prior patches preserved. 5 files changed total. |
| ORCH-0353 | Permission storm on first landing — 4 OS dialogs fire on boot | App Lifecycle | S1 | ux | closed | A | 2026-04-09 | Device-verified PASS. Split OneSignal login/permission, removed auto location/camera/tracking from MobileFeaturesProvider, ATT wait→0. Zero dialogs on Home. |
| ORCH-0354 | Coach mark guided tour system (10-step, cross-tab, resumable) | App Lifecycle | S1 | missing-feature | implementing | F | 2026-04-09 | Spec: SPEC_ORCH-0349_COACH_MARK_SYSTEM.md. Design: Hybrid bottom card + self-highlight. Phase 1 pending. Prerequisite ORCH-0353 complete. |
| ORCH-0371 | Beta feedback — optional screenshot attachments (up to 10) | Profile | S3 | missing-feature | closed | A | 2026-04-11 | QA PASS (0 defects, 17/17 SC). Commit a666dee7. Migration applied, functions deployed. Report: QA_ORCH-0371_FEEDBACK_SCREENSHOTS_REPORT.md |
| ORCH-0373 | Friend profile screen overhaul — hide username, add bio + stats (places/streak/friends non-tappable), fix interests, wire chat avatar tap, wire onMessage (friends-only gate) | Profile + Chat | S1 | quality-gap | closed | A | 2026-04-11 | QA PASS 12/12 + rework approved. 5 files changed. Message button gated to friends-only. Reports: QA_ORCH-0373 + REWORK_MESSAGE_GATE. |
| ORCH-0374 | Friend profile — show GPS city instead of country code, and make interests visible to all viewers (not just friends) | Profile | S1 | quality-gap | closed | A | 2026-04-11 | Implementation approved. GPS city persisted to profiles.location on profile open. RLS policy added for public display interests read. Migration: 20260411000002. Deploy order: migration first, then OTA. |
| ORCH-0377 | Beta feedback — allow users to delete their own submitted feedback | Profile | S2 | missing-feature | implementing | F | — | Spec: SPEC_ORCH-0377_DELETE_FEEDBACK.md. 4 files, 13 success criteria. Dispatched to implementor. |
| ORCH-0375 | Own-profile + friend-profile stats decorative — placesVisited=0, streakDays=0 hardcoded despite real computation engine existing | Profile | S2 | quality-gap | investigated | F | — | Constitutional Rule #9 violation (no fabricated data). ProfilePage.tsx:330-331 and ViewFriendProfileScreen.tsx:243-244 hardcode zeros. enhancedProfileService.ts has working calculateUserAchievements(). GamifiedHistory.tsx already uses real data. Fix: wire useEnhancedProfile into both screens. |

### Section 9: Map & Location

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0111 | Map rendering (dual provider) | Map | S1 | unaudited | open | F | — | — |
| ORCH-0112 | User location tracking | Map | S1 | unaudited | open | F | — | — |
| ORCH-0113 | Map location update | Map | S2 | unaudited | open | F | — | — |
| ORCH-0114 | Nearby people display | Map | S1 | unaudited | open | F | — | — |
| ORCH-0115 | Person bottom sheet on map | Map | S2 | unaudited | open | F | — | — |
| ORCH-0116 | Place pins on map | Map | S2 | unaudited | open | F | — | — |
| ORCH-0117 | Place heatmap | Map | S3 | unaudited | open | F | — | — |
| ORCH-0118 | Map filter bar | Map | S3 | unaudited | open | F | — | — |
| ORCH-0119 | Layer toggles | Map | S3 | unaudited | open | F | — | — |
| ORCH-0120 | Map bottom sheet | Map | S2 | unaudited | open | F | — | — |
| ORCH-0121 | Curated route display | Map | S2 | unaudited | open | F | — | — |
| ORCH-0122 | Go Dark / privacy FAB | Map | S2 | unaudited | open | F | — | — |
| ORCH-0123 | Activity feed overlay | Map | S3 | unaudited | open | F | — | — |
| ORCH-0124 | Activity status picker | Map | S3 | unaudited | open | F | — | — |
| ORCH-0125 | Map cards hook | Map | S2 | unaudited | open | F | — | — |
| ORCH-0126 | Discover map integration | Map | S1 | unaudited | open | F | — | — |
| ORCH-0366 | Edge function timeouts — query_pool_cards optimized, timeout 12s→20s, dead curated timeout removed | Map | S1 | performance | closed | A | 2026-04-10 | User-verified working. Migration 20260410000005. Commit 6bdbbd30. |
| ORCH-0324 | User marker disappears from map — map shrunk to 1px when person pill active | Map | S1 | bug | investigated | F | — | INVESTIGATION_MAP_BUGS_REPORT.md — mapHidden: 1x1px confuses react-native-maps marker rendering. paused=true disables nearby-people query. |
| ORCH-0325 | Map centering broken — animateToRegion races with 1px→fullscreen layout transition | Map | S1 | bug | investigated | F | — | INVESTIGATION_MAP_BUGS_REPORT.md — Both state updates in same tick; animation fires before map expands. |
| ORCH-0326 | Mock strangers invisible — bidirectional "everyone" visibility required + code defaults to "off" | Map | S1 | bug | investigated | F | — | INVESTIGATION_MAP_BUGS_REPORT.md — get-nearby-people:103 requires requester visibility="everyone". Code defaults to "off" (line 42) contradicting schema default "friends". |
| ORCH-0328 | Hidden flaw: get-nearby-people defaults visibility to "off" instead of schema default "friends" | Map | S1 | bug | closed | A | 2026-04-06 | Fixed: default changed to "friends" in get-nearby-people:42. |
| ORCH-0329 | Visibility filtering fixed — TARGET-based filter + friends_of_friends implemented | Map | S1 | bug | closed | A | 2026-04-06 | QA_ORCH-0329_VISIBILITY_FIXES_REPORT.md — 11/11 PASS. Switch statement checks TARGET's level. FoF single query. Bidirectional check removed (DEC-012). |
| ORCH-0330 | Visibility dropdown fixed — optimistic update + rollback + toast on error | Map | S1 | bug | closed | A | 2026-04-06 | QA_ORCH-0329_VISIBILITY_FIXES_REPORT.md — onMutate instant cache, onError rollback + toast. |
| ORCH-0327 | Stranger seeding — global grid, DiceBear avatars, friend request interception, updated categories | Map | S1 | missing-feature | closed | A | 2026-04-06 | QA_ORCH-0327_STRANGER_SEEDING_REPORT.md — 14/14 PASS. Code ready. Seed NOT yet run — deploy first, then call seed_global_grid. |
| ORCH-0331 | Admin dashboard seed filter — all profile queries now exclude is_seed=true | Admin | S1 | bug | closed | A | 2026-04-06 | QA_ORCH-0327_STRANGER_SEEDING_REPORT.md — 8 admin queries fixed (T-11 through T-14 PASS). |
| ORCH-0355 | Map person profile fixed — crash eliminated (.maybeSingle), shared category pills added to PersonBottomSheet | Map | S1 | bug | closed | A | 2026-04-10 | QA PASS (AH-059). `.single()` → `.maybeSingle()` prevents crash. Interests pills for all relationships. 18/18 tests pass. |
| ORCH-0365 | Phone number PII removed from ViewFriendProfileScreen — useFriendProfile no longer selects phone | Profile | S1 | security | closed | A | 2026-04-10 | QA PASS (AH-057). Phone removed from interface, select, return, and UI. Zero references remain. |
| ORCH-0356 | Strangers on discover map can be messaged — should only show Add Friend + View Profile. DM must be gated to friends-only app-wide (pairing/collab invites must NOT be affected). | Map | S1 | security | closed | A | 2026-04-09 | QA PASS (AH-054). 3-layer defense: UI gate (PersonBottomSheet), service gate (messagingService), RLS gate (blocked_users). 13/13 SC, 17/17 tests. Pairing/collab/deletion confirmed safe. |
| ORCH-0360 | Map interactions — broken block handler (wrong column), silent push notification failure (idempotency), block modal sluggish, add friend UX gaps | Map | S1 | bug | closed | A | 2026-04-10 | QA PASS. blockService replaces raw upsert, idempotency key unique per attempt, InteractionManager defers modal, push response logged. 17/17 tests. |
| ORCH-0358 | Friends-of-friends filter fixed — MapPrivacySettings + DB CHECK constraint updated | Map | S1 | bug | closed | A | 2026-04-10 | QA PASS (AH-057). FoF added to VISIBILITY_LEVELS + LABELS. DB constraint ALTERed live (migration 20260410000003). Verified via pg_constraint query. |
| ORCH-0359 | Place pins now show name labels — truncated place/stop name below each pin | Map | S2 | ux | closed | A | 2026-04-10 | QA PASS (AH-059). Text label added to PlacePinContent. Curated shows first stop name, singles show place name. 15-char truncation. |
| ORCH-0361 | Avatar disappearance fixed — 3s tracksViewChanges window for image loading | Map | S1 | bug | closed | A | 2026-04-10 | QA PASS (AH-059). Person markers `tracksViewChanges={true}` for 3s then false. Prevents permanent fallback on slow image load. |
| ORCH-0378 | Map pin labels redesigned — orange pill with "Category · Place Name", full text no truncation, widened wrappers | Map | S2 | ux | closed | A | 2026-04-11 | User-verified on device. PlacePin.tsx: orange pill (rgba(235,120,37,0.85)), getReadableCategoryName + title, no maxWidth/numberOfLines constraints. 3 iterations (v1 pill, v2 content, v3 no truncation). |
| ORCH-0379 | Fix pin tap regression + hide label on selection — anchor/tappable added to Markers, isSelected prop threaded through pin chain | Map | S1 | regression | closed | A | 2026-04-11 | User-verified on device. anchor={{x:0.5,y:0.27}} + tappable on both Markers. isSelected hides label pill when bottom sheet open. 3 files changed. |

### Section 10: Direct Messaging & Chat

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0127 | Send/receive messages | Chat | S1 | unaudited | open | F | — | — |
| ORCH-0128 | Message list rendering | Chat | S2 | unaudited | open | F | — | — |
| ORCH-0129 | Conversation list | Chat | S1 | unaudited | open | F | — | — |
| ORCH-0130 | Chat presence (online/typing) | Chat | S2 | unaudited | open | F | — | — |
| ORCH-0131 | Broadcast receiver (realtime) | Chat | S2 | unaudited | open | F | — | — |
| ORCH-0132 | Messaging realtime | Chat | S1 | unaudited | open | F | — | — |
| ORCH-0133 | DM email notification | Chat | S3 | unaudited | open | F | — | — |
| ORCH-0134 | Chat status line | Chat | S3 | unaudited | open | F | — | — |
| ORCH-0357 | Blocked/unfriended/deleted users still messageable — message field should be hidden, replaced with status banner explaining why ("You blocked this person" / "User deleted their account") | Chat | S1 | security | closed | A | 2026-04-09 | QA PASS (AH-054). Three banners (blocked/unfriended/deleted) with hidden input. Account deletion confirmed regression-free. |
| ORCH-0367 | Block/friend mutual exclusion — accept clears blocks, block cancels pending requests, stale data fixed | Chat + Social | S0 | data-integrity | closed | A | 2026-04-10 | User-verified: Seth+Arifat can message. Migration 20260410000004. Commit 6bdbbd30. |

### Section 11: Payments & Subscriptions

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0135 | Paywall screen | Payments | S0 | quality-gap | verified | B | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md |
| ORCH-0136 | Custom paywall screen | Payments | S1 | quality-gap | verified | B | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md |
| ORCH-0137 | RevenueCat integration | Payments | S0 | closed | closed | A | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md |
| ORCH-0138 | Subscription service | Payments | S1 | quality-gap | verified | C | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md |
| ORCH-0139 | Creator tier gating | Payments | S2 | quality-gap | verified | B | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md |
| ORCH-0140 | Feature gate enforcement | Payments | S1 | bug | verified | B | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md — session limits now enforced. Remaining gap: referral tier expiry (ORCH-0144) |
| ORCH-0141 | Swipe limit (free users) | Payments | S1 | bug | verified | B | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md — paywall now triggers, PanResponder feedback works. Remaining gap: client-authoritative count (OB-02) |
| ORCH-0142 | Referral processing | Payments | S2 | bug | verified | B | 2026-03-31 | QA_PAYMENTS_EXPIRY_TRIAL_REPORT.md — referral has finite expiry, tier correct. Remaining: no UI for "days remaining" (cosmetic) |
| ORCH-0143 | Referral tier: server 'pro', client 'elite' | Payments | S0 | bug | closed | A | 2026-03-31 | QA_PAYMENTS_CLEAR_BUGS_REPORT.md |
| ORCH-0144 | Referral bonus months never expire | Payments | S0 | bug | closed | A | 2026-03-31 | QA_PAYMENTS_EXPIRY_TRIAL_REPORT.md — date-based expiry, no cron |
| ORCH-0145 | Session creation limit not enforced | Payments | S1 | bug | closed | A | 2026-03-31 | QA_PAYMENTS_CLEAR_BUGS_REPORT.md |
| ORCH-0146 | Swipe paywall doesn't trigger (stale ref) | Payments | S1 | bug | closed | A | 2026-03-31 | QA_PAYMENTS_CLEAR_BUGS_REPORT.md |
| ORCH-0147 | Silent swipe blocking after limit | Payments | S2 | quality-gap | closed | A | 2026-03-31 | Fixed with ORCH-0146 — PanResponder now shows paywall |
| ORCH-0148 | useEffectiveTier can downgrade (misleading comment) | Payments | S2 | quality-gap | closed | A | 2026-03-31 | Fixed with ORCH-0143 — comment corrected in useSubscription.ts |
| ORCH-0149 | Trial abuse: delete+re-signup = infinite Elite | Payments | S1 | bug | closed | A | 2026-03-31 | QA_PAYMENTS_EXPIRY_TRIAL_REPORT.md — phone-hash table, checked at onboarding |
| ORCH-0372 | Price tier restructure: 3 tiers (Free/Pro/Elite) → 2 tiers (Free/Mingla+) | Payments | S0 | architecture-flaw | closed | A | 2026-04-11 | QA CONDITIONAL PASS (P1 reworked). 19/23 code tests PASS, 14 UNVERIFIED (device). DB migration applied, 3 edge functions deployed, ~22 frontend files updated, 2 deleted. Full pipeline: forensic → spec → W1 backend → W2 frontend → QA → rework → PASS. |

### Section 12: Calendar & Scheduling

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0143 | Calendar tab display | Calendar | S1 | unaudited | open | F | — | — |
| ORCH-0144 | Device calendar sync | Calendar | S2 | unaudited | open | F | — | — |
| ORCH-0145 | Calendar service | Calendar | S1 | unaudited | open | F | — | — |
| ORCH-0146 | Date options grid | Calendar | S2 | unaudited | open | F | — | — |
| ORCH-0147 | Propose date/time modal | Calendar | S2 | unaudited | open | F | — | — |
| ORCH-0148 | Weekend day selection | Calendar | S3 | unaudited | open | F | — | — |
| ORCH-0149 | Collaboration calendar | Calendar | S2 | unaudited | open | F | — | — |
| ORCH-0150 | Calendar button on cards | Calendar | S2 | unaudited | open | F | — | — |

### Section 13: Holidays & Events

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0151 | Holiday categories | Holidays | S2 | unaudited | open | F | — | — |
| ORCH-0152 | Holiday experiences | Holidays | S2 | unaudited | open | F | — | — |
| ORCH-0153 | Holiday cards | Holidays | S2 | unaudited | open | F | — | — |
| ORCH-0154 | Custom holidays CRUD | Holidays | S2 | unaudited | open | F | — | — |
| ORCH-0155 | Calendar holidays mapping | Holidays | S3 | unaudited | open | F | — | — |
| ORCH-0156 | Holiday reminder notifications | Holidays | S2 | bug | verified | B | 2026-03-21 | Commit d4c6725e |
| ORCH-0157 | Ticketmaster events | Holidays | S3 | unaudited | open | F | — | — |

### Section 14: People Discovery

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0158 | Discover screen (people) | People | S1 | unaudited | open | F | — | — |
| ORCH-0159 | Person grid cards | People | S2 | unaudited | open | F | — | — |
| ORCH-0160 | Person tab bar | People | S2 | unaudited | open | F | — | — |
| ORCH-0161 | Person holiday view | People | S2 | unaudited | open | F | — | — |
| ORCH-0162 | Person hero cards | People | S2 | unaudited | open | F | — | — |
| ORCH-0163 | Personalized cards | People | S2 | unaudited | open | F | — | — |
| ORCH-0164 | Link request banner | People | S2 | unaudited | open | F | — | — |
| ORCH-0165 | Link consent card | People | S2 | unaudited | open | F | — | — |
| ORCH-0166 | Enhanced profile view | People | S2 | unaudited | open | F | — | — |
| ORCH-0167 | Phone lookup (friend discovery) | People | S2 | unaudited | open | F | — | — |

### Section 15: Pairing System

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0168 | Send pair request | Pairing | S1 | unaudited | open | F | — | — |
| ORCH-0169 | Pair request modal | Pairing | S2 | unaudited | open | F | — | — |
| ORCH-0170 | Incoming pair request card | Pairing | S2 | unaudited | open | F | — | — |
| ORCH-0171 | Paired profile section | Pairing | S2 | unaudited | open | F | — | — |
| ORCH-0172 | Paired people row | Pairing | S2 | unaudited | open | F | — | — |
| ORCH-0173 | Paired saves list | Pairing | S2 | unaudited | open | F | — | — |
| ORCH-0174 | Paired map saved cards | Pairing | S2 | unaudited | open | F | — | — |
| ORCH-0175 | Pair accepted notification | Pairing | S2 | missing-feature | closed | A | 2026-03-21 | Commit 376cd237 |
| ORCH-0176 | Pair activity notifications | Pairing | S2 | bug | closed | A | 2026-03-21 | Commit 376cd237 |
| ORCH-0177 | Unpair flow (atomic RPC) | Pairing | S1 | bug | closed | A | 2026-03-22 | Commit 23f3a0dd |
| ORCH-0178 | Pairing info card | Pairing | S3 | unaudited | open | F | — | — |

### Section 16: Sharing & Invites

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0179 | Share modal | Sharing | S2 | unaudited | open | F | — | — |
| ORCH-0180 | User invite modal | Sharing | S2 | unaudited | open | F | — | — |
| ORCH-0181 | Phone invite flow | Sharing | S2 | unaudited | open | F | — | — |
| ORCH-0182 | Invite link share | Sharing | S2 | unaudited | open | F | — | — |
| ORCH-0183 | QR code display | Sharing | S3 | unaudited | open | F | — | — |
| ORCH-0184 | Invite code display | Sharing | S3 | unaudited | open | F | — | — |
| ORCH-0185 | Invite method selector | Sharing | S3 | unaudited | open | F | — | — |
| ORCH-0186 | Invite accept screen | Sharing | S2 | unaudited | open | F | — | — |
| ORCH-0187 | Board invite service | Sharing | S2 | unaudited | open | F | — | — |
| ORCH-0188 | Collaboration invite service | Sharing | S2 | unaudited | open | F | — | — |

### Section 17: Post-Experience & Reviews

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0189 | Post-experience modal | Post-Experience | S2 | unaudited | open | F | — | — |
| ORCH-0190 | Post-experience check | Post-Experience | S2 | unaudited | open | F | — | — |
| ORCH-0191 | Record visit | Post-Experience | S2 | unaudited | open | F | — | — |
| ORCH-0192 | Voice review recording | Post-Experience | S2 | unaudited | open | F | — | — |
| ORCH-0193 | Experience feedback | Post-Experience | S2 | unaudited | open | F | — | — |
| ORCH-0194 | Visit badge display | Post-Experience | S3 | unaudited | open | F | — | — |
| ORCH-0195 | Dismissed cards sheet | Post-Experience | S3 | unaudited | open | F | — | — |
| ORCH-0196 | Deck history sheet | Post-Experience | S3 | unaudited | open | F | — | — |
| ORCH-0197 | Feedback history sheet | Post-Experience | S3 | unaudited | open | F | — | — |

### Section 18: Booking

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0198 | Booking service | Booking | S2 | unaudited | open | F | — | — |
| ORCH-0199 | Enhanced favorites | Booking | S3 | unaudited | open | F | — | — |

### Section 19: Admin Panel (Place Pool Management)

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0332 | Admin cannot update existing city bbox — overlap check blocks self | Admin | S2 | missing-feature | investigated | F | 2026-04-08 | INVESTIGATION_CITY_UPDATE_AND_TILE_REGEN.md — Backend ready (p_exclude_id exists, RLS allows UPDATE, generate_tiles works). Pure UI work. CASCADE risk guarded by activeRun check. |
| ORCH-0333 | Admin cannot change tile radius on already-seeded city | Admin | S2 | missing-feature | investigated | F | 2026-04-08 | INVESTIGATION_CITY_UPDATE_AND_TILE_REGEN.md — TILE_RADIUS_OPTIONS exists. SeedTab needs picker + save-before-regenerate. No backend changes. |
| ORCH-0334 | Photo tab shows stale London run (180/351 batches) — old run has dead references | Admin | S3 | bug | open | F | — | Previous session: old photo backfill run data from pre-bbox migration. May need cancel/dismiss action. |
| ORCH-0335 | admin_place_photo_stats only counts AI-approved places — correct per spec but changed from before | Admin | S3 | quality-gap | open | F | — | Spec decision: photo stats scoped to AI-approved. Stats look different from pre-spec totals. Not a bug — document and close. |

### Section 20: User Reporting & Moderation

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0362 | Map report fixed — ReportUserModal replaces broken inline handler | Moderation | S0 | bug | closed | A | 2026-04-10 | QA PASS (AH-057). Old `map_interaction` enum removed. Now uses reportService.submitReport() via ReportUserModal. Error checking verified. |
| ORCH-0363 | Report modal delay fixed — premature block removed, single-block on submit | Moderation | S1 | ux | closed | A | 2026-04-10 | QA PASS (AH-057). `onBlockUser` call removed from handleReportUser. ReportUserModal.handleSubmit blocks once on submit. |
| ORCH-0364 | Admin reports RLS fixed — SELECT + UPDATE policies added, FK join hint corrected | Moderation | S0 | bug | closed | A | 2026-04-10 | QA PASS (AH-057). Migration 20260410000002 applied. is_admin_user() SELECT + UPDATE policies live. Join hint fixed to column-based. |

### Cross-Cutting: Network & Offline

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0200 | Offline browsing (saved cards) | Network | S2 | unaudited | open | F | — | — |
| ORCH-0201 | Network failure at every layer | Network | S1 | unaudited | open | F | — | — |
| ORCH-0202 | Slow network degradation | Network | S2 | unaudited | open | F | — | — |
| ORCH-0203 | Reconnection recovery | Network | S2 | unaudited | open | F | — | — |
| ORCH-0204 | Offline queue observability | Network | S2 | quality-gap | verified | B | 2026-03-23 | Commit 8839c00b |

### Cross-Cutting: State & Cache

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0205 | Query key consolidation | State | S1 | architecture-flaw | closed | A | 2026-03-23 | Commit 846e7cce |
| ORCH-0206 | Mutation error handling | State | S1 | quality-gap | closed | A | 2026-03-23 | Commit 27e475ac |
| ORCH-0207 | React Query cache invalidation | State | S2 | unaudited | open | F | — | — |
| ORCH-0208 | Zustand persistence schema versioning | State | S2 | unaudited | open | F | — | — |
| ORCH-0209 | App background/foreground state survival | State | S2 | bug | closed | A | 2026-03-31 | QA_LIVE_APP_STATE_PERSISTENCE_REPORT.md — always-mounted tabs + resume prefetch |
| ORCH-0210 | Memory pressure on large lists | State | S3 | unaudited | open | F | — | — |
| ORCH-0270 | Tab switching loading spinners | State | S1 | bug | closed | A | 2026-03-31 | QA_LIVE_APP_STATE_PERSISTENCE_REPORT.md — SP-01 root cause, always-mounted tabs |
| ORCH-0271 | PreferencesSheet loading shimmer on every open | State | S2 | bug | closed | A | 2026-03-31 | QA_LIVE_APP_STATE_PERSISTENCE_REPORT.md — opens from cache |
| ORCH-0300 | App doesn't feel alive — content freshness architecture flaw | State | S1 | architecture-flaw | spec-ready | F | — | FORENSIC_MASTER_REPORT.md — Content excluded from foreground refresh based on false "expensive API" assumption. All 3 content edge functions read from our DB, zero external calls. |

### Cross-Cutting: Chat Responsiveness

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0211 | Existing chat tap (cached) | Chat-Resp | S2 | bug | closed | A | 2026-03-23 | Commit 2549dbe6 |
| ORCH-0212 | First-time chat open | Chat-Resp | S2 | bug | closed | A | 2026-03-23 | Commit 2549dbe6 |
| ORCH-0213 | New conversation from picker | Chat-Resp | S2 | bug | closed | A | 2026-03-23 | Commit 2549dbe6 |
| ORCH-0214 | Block service timeout | Chat-Resp | S2 | bug | closed | A | 2026-03-23 | Commit 2549dbe6 |

### Cross-Cutting: Hardening Infrastructure

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0215 | withTimeout utility | Infra | S2 | missing-feature | closed | A | 2026-03-23 | Commit 06614e98 |
| ORCH-0216 | Mutation error toast utility | Infra | S2 | missing-feature | closed | A | 2026-03-23 | Commit 06614e98 |
| ORCH-0217 | Centralized query key factory | Infra | S2 | architecture-flaw | closed | A | 2026-03-23 | Commit 06614e98 |

### Cross-Cutting: Error Handling

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0218 | Error boundary coverage | Error | S1 | unaudited | open | F | — | — |
| ORCH-0219 | Edge function error extraction | Error | S2 | unaudited | open | F | — | — |
| ORCH-0220 | User-facing error messages | Error | S2 | unaudited | open | F | — | — |
| ORCH-0221 | Silent failure paths | Error | S1 | unaudited | open | F | — | — |
| ORCH-0222 | Service error contract | Error | S1 | design-debt | deferred | F | 2026-03-23 | TRANSITIONAL logging. Full fix deferred. |

### Cross-Cutting: Security & Auth

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0223 | RLS policy coverage | Security | S0 | quality-gap | verified | D | 2026-03-31 | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0224 | Admin auth (3-layer) | Security | S0 | quality-gap | closed | A | 2026-03-31 | INVESTIGATION_SECURITY_WAVE2.md, QA_ADMIN_USERS_RLS_REPORT.md — admin email exposure (SEC-01) fixed: get_admin_emails revoked from anon, replaced with is_admin_email boolean |
| ORCH-0225 | PII handling | Security | S0 | quality-gap | verified | C | 2026-03-31 | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0226 | Storage path injection | Security | S1 | quality-gap | verified | D | 2026-03-31 | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0250 | Avatars bucket no user-scoping | Security | S1 | bug | open | F | — | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0251 | Messages bucket public — DM files accessible without auth | Security | S1 | bug | open | F | — | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0252 | get_admin_emails() exposes admin list to anon | Security | S2 | bug | closed | A | 2026-03-31 | Fixed with ORCH-0258 — get_admin_emails revoked from anon, replaced with is_admin_email() boolean |
| ORCH-0253 | USING(true) on profiles — PII exposure | Security | S1 | bug | closed | A | 2026-03-31 | IMPLEMENTATION_EMERGENCY_RLS_FIX_REPORT.md, QA_EMERGENCY_RLS_FIX_REPORT.md |
| ORCH-0254 | Full phone numbers logged in console | Security | S3 | bug | open | F | — | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0255 | board-attachments + experience-images buckets missing | Security | S2 | bug | open | F | — | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0256 | Client-side brute-force lockout bypassable | Security | S3 | bug | open | F | — | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0257 | 6 edge functions have no auth (incl. Google Maps key) | Security | S2 | bug | open | F | — | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0258 | admin_users USING(true) on UPDATE/DELETE — privilege escalation | Security | S1 | bug | closed | A | 2026-03-31 | QA_ADMIN_USERS_RLS_REPORT.md — all permissive policies dropped, is_admin_user() gating |

### Cross-Cutting: Deep Linking

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0227 | Deep link service routing | DeepLink | S1 | unaudited | open | F | — | — |
| ORCH-0228 | Session deep links | DeepLink | S2 | quality-gap | verified | B | 2026-03-23 | Commit 15fe8742 |
| ORCH-0229 | Universal link handling | DeepLink | S2 | unaudited | open | F | — | — |
| ORCH-0230 | Deferred deep links (pre-install) | DeepLink | S2 | unaudited | open | F | — | — |

### Cross-Cutting: App Lifecycle

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0231 | Animated splash screen | Lifecycle | S2 | unaudited | open | F | — | — |
| ORCH-0232 | App loading screen | Lifecycle | S2 | unaudited | open | F | — | — |
| ORCH-0233 | Error boundary (app-wide) | Lifecycle | S1 | unaudited | open | F | — | — |
| ORCH-0234 | Error state component | Lifecycle | S2 | unaudited | open | F | — | — |
| ORCH-0235 | Offline indicator | Lifecycle | S2 | unaudited | open | F | — | — |
| ORCH-0236 | App state manager | Lifecycle | S1 | unaudited | open | F | — | — |
| ORCH-0237 | App handlers | Lifecycle | S2 | unaudited | open | F | — | — |
| ORCH-0238 | Notification system provider | Lifecycle | S1 | unaudited | open | F | — | — |
| ORCH-0239 | Mobile features provider | Lifecycle | S2 | unaudited | open | F | — | — |
| ORCH-0240 | Foreground refresh | Lifecycle | S2 | quality-gap | closed | A | 2026-03-31 | QA_LIVE_APP_STATE_PERSISTENCE_REPORT.md — refreshes ALL tabs (all mounted), preferences prefetched |
| ORCH-0241 | Lifecycle logger | Lifecycle | S3 | unaudited | open | F | — | — |
| ORCH-0368 | Bad merge artifact audit — corruption isolated to MessageInterface.tsx only. 88 files scanned with 6 detection passes, zero additional corruption found. | Lifecycle | S1 | regression | closed | A | 2026-04-10 | INVESTIGATION_ORCH-0368_BAD_MERGE_AUDIT.md — All 88 files clean. Fix: commit 8bc694c6. |

### Cross-Cutting: Analytics & Tracking

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0242 | AppsFlyer integration | Analytics | S1 | data-integrity | investigated | C | 2026-04-11 | INVESTIGATION_ANALYTICS_IDENTITY_AUDIT.md — 22 events wired, never verified in dashboard, identity not cleared on logout |
| ORCH-0243 | Mixpanel integration | Analytics | S1 | data-integrity | closed | A | 2026-04-11 | Token set, 17 active methods firing, 4 onboarding methods wired, preferences + friend request tracking wired. Live events confirmed in dashboard. |
| ORCH-0387 | Analytics identity & cross-service integration audit | Analytics | S1 | data-integrity | closed | B | 2026-04-11 | Mixpanel live (A), push_clicked wired (A), onboarding funnel tracked (A). Remaining: AppsFlyer logout gap (deferred), unified identity layer (deferred per product strategy). |
| ORCH-0388 | RevenueCat "customer" count inflation — 104 phantom customers | Analytics | S2 | data-integrity | investigated | C | 2026-04-11 | INVESTIGATION_ANALYTICS_IDENTITY_AUDIT.md — RC counts every SDK touch as "customer." Anonymous→identified merges may inflate. Need RC dashboard audit. |
| ORCH-0389 | OneSignal push_clicked tracking gap | Analytics | S2 | missing-feature | closed | A | 2026-04-11 | push_clicked + push_clicked_at now set on notification tap in processNotification. Mixpanel "Push Notification Clicked" event also fires. |
| ORCH-0244 | Screen logger | Analytics | S3 | unaudited | open | F | — | — |
| ORCH-0245 | Tracked pressable / touchable | Analytics | S3 | missing-feature | closed | A | 2026-03-22 | Commit dba7b3f0 |
| ORCH-0246 | User activity service | Analytics | S2 | unaudited | open | F | — | — |
| ORCH-0247 | User interaction service | Analytics | S2 | unaudited | open | F | — | — |
| ORCH-0248 | Session tracker | Analytics | S2 | unaudited | open | F | — | — |
| ORCH-0249 | A/B testing service | Analytics | S3 | unaudited | open | F | — | — |
| ORCH-0390 | Documentation truth sweep — all artifacts, READMEs, comments must reflect code reality | Documentation | S1 | documentation-drift | closed | A | 2026-04-11 | 3 phases complete: (1) Dead code elimination — 17 files, 4 exports, 4 edge fns, 3 RPCs removed (QA PASS). (2) Code inventory + analytics architecture — 57 edge fns, 79 services, 25 AF events, 33 MP methods, 29 notification types mapped. (3) Artifact sync — READMEs fixed (71→57), 4 queue docs deprecated, 5 decisions logged, Priority Board updated. |

### Cross-Cutting: Weather & External Data

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0250 | Weather service | Weather | S2 | unaudited | open | F | — | — |
| ORCH-0251 | Busyness data | Weather | S3 | unaudited | open | F | — | — |
| ORCH-0252 | Geocoding service | Weather | S2 | unaudited | open | F | — | — |
| ORCH-0253 | Currency service | Weather | S2 | unaudited | open | F | — | — |
| ORCH-0254 | Translation service | Weather | S3 | unaudited | open | F | — | — |
| ORCH-0255 | Locale preferences | Weather | S2 | unaudited | open | F | — | — |

### Cross-Cutting: UI Components & Design System

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0256 | Toast system | UI | S2 | unaudited | open | F | — | — |
| ORCH-0257 | In-app browser | UI | S2 | bug | closed | A | 2026-03-22 | Commit 0254bc4f |
| ORCH-0258 | Pull-to-refresh | UI | S2 | bug | closed | A | 2026-03-23 | Commit 2a96c8f6 |
| ORCH-0259 | Image with fallback | UI | S2 | unaudited | open | F | — | — |
| ORCH-0260 | Loading skeleton | UI | S3 | unaudited | open | F | — | — |
| ORCH-0261 | Keyboard-aware scroll view | UI | S2 | unaudited | open | F | — | — |
| ORCH-0262 | Success animation | UI | S3 | unaudited | open | F | — | — |
| ORCH-0263 | Popularity indicators | UI | S3 | unaudited | open | F | — | — |
| ORCH-0264 | Confidence score | UI | S3 | unaudited | open | F | — | — |
| ORCH-0265 | Icon map completeness | UI | S2 | bug | closed | A | 2026-03-22 | Commit 88f2d43f |

### Cross-Cutting: Code Quality & Type Safety

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0376 | 272 pre-existing TypeScript errors — full cleanup (dead code deletion + type fixes across 57 files) | Code Quality | S3 | design-debt | closed | A | 2026-04-11 | QA PASS 7/7, 0 defects (2 pre-existing noted). 272→0 errors. 50 dead files deleted. 57 files fixed. Reports: IMPLEMENTATION + QA_ORCH-0376_TYPESCRIPT_CLEANUP_REPORT.md |
| ORCH-0377 | Dead code: src/main.tsx | Code Quality | S3 | design-debt | closed | A | 2026-04-11 | Deleted in ORCH-0384 sweep. |
| ORCH-0378 | Dead code: SimpleAuthGuard.tsx | Code Quality | S3 | design-debt | closed | A | 2026-04-11 | Deleted in ORCH-0384 sweep. |
| ORCH-0379 | Dead code: PurchaseQRCode.tsx | Code Quality | S3 | design-debt | closed | A | 2026-04-11 | Deleted in ORCH-0384 sweep. |
| ORCH-0380 | SessionViewModal.tsx called 4 non-existent state setters — refactor remnant | Code Quality | S2 | bug | open | F | — | setParticipants/setSessionValid/setHasPermission/setIsAdmin removed during ORCH-0376. Session validation logic may be incomplete. |
| ORCH-0381 | calendar.tsx + checkbox.tsx are minimal stubs — need proper implementations if features activate | Code Quality | S3 | design-debt | open | F | — | Created during ORCH-0376 to satisfy imports from PreferencesSheet + OnboardingFlow. Functional but bare-minimum UI. |
| ORCH-0382 | BoardDiscussion dropdown menu renders flat — needs proper RN dropdown component | Collab Sessions | S2 | ux | open | F | — | Pre-existing: shadcn/Radix DropdownMenu never worked in RN. Now stubbed as pass-through (items always visible). Needs react-native-popup-menu or ActionSheet. QA_ORCH-0376 P2-001. |
| ORCH-0383 | enhancedFavoritesService dead code | Code Quality | S3 | design-debt | closed | A | 2026-04-11 | Deleted in ORCH-0384 sweep. smartNotificationService import stubbed. |
| ORCH-0384 | Full dead code sweep — 78 dead files deleted, 24K lines removed, across components/hooks/services/utils | Code Quality | S2 | design-debt | closed | A | 2026-04-11 | Forensic verified 87 candidates: 78 deleted, 12 false positives saved. 2 cascading fixes (useLifecycleLogger, enhancedFavoritesService). tsc=0, iOS build clean. Reports: INVESTIGATION + IMPLEMENTATION_ORCH-0384. |
| ORCH-0385 | Map avatars disappear after returning from background — `['nearby-people']` added to `CRITICAL_QUERY_KEYS` + tracksViewChanges reset | Map & Location | S1 | bug | closed | A | 2026-04-11 | QA PASS 7/7. Added `['nearby-people']` + `['map-settings']` to foreground refresh. tracksViewChanges resets on data change. 2 files, ~6 lines. Reports: INVESTIGATION + IMPLEMENTATION + QA_ORCH-0385. |

---

## Launch Readiness by Surface

See COVERAGE_MAP.md for detailed grade distribution.

---

## Active Investigations

| ID | Issue | Investigator | Started | Last Update | Status |
|----|-------|-------------|---------|-------------|--------|
| ORCH-0300 | App freshness architecture — content stale times, missing content realtime, foreground refresh gaps | Forensics | 2026-04-04 | 2026-04-04 | Dispatched |
| ORCH-0301–0304 | 4 deck bugs — duplicate cards, address not persisting, sparse deck, GPS location stale | Forensics | 2026-04-04 | 2026-04-04 | Dispatched |
| ORCH-0305–0307 | 3 admin card pool issues — browse visibility, generation skip transparency, progress feedback | Forensics | 2026-04-04 | 2026-04-04 | Dispatched |

---

## Top 20 Priorities

See PRIORITY_BOARD.md

---

## Invariant Registry

See INVARIANT_REGISTRY.md

---

## Decision Log

See DECISION_LOG.md

---

## Open Questions

| ID | Question | Context | Blocking | Date Raised |
|----|----------|---------|----------|-------------|
| OQ-001 | Is Phone OTP auth the only path or do Google/Apple bypass it? | Auth flow — determines S0 vs S1 | Yes — affects auth audit scope | 2026-03-30 |
| OQ-002 | Should Map/Chat/Calendar ship as launch features or be deferred? | 48+ F items across these three surfaces | Yes — determines audit scope | 2026-03-30 |
| OQ-003 | What is the launch city strategy? | Empty category pools need seeding per city | Yes — operational blocker | 2026-03-30 |

---

## Deferred Items

| ID | Title | Reason Deferred | Exit Condition | Date Deferred |
|----|-------|----------------|----------------|---------------|
| ORCH-0222 | Service error contract (ServiceResult<T>) | ~60+ call sites, high blast radius | Next hardening cycle | 2026-03-23 |

---

## Unresolved Operational Risks

| Risk | Probability | Impact | Mitigation | Owner |
|------|------------|--------|------------|-------|
| Empty category pools in launch city | High | Users see no cards for selected categories | Seeding pipeline exists but needs data | Ops |
| 54% of items at grade F (unaudited) | Certain | Unknown bugs shipping to production | Systematic audit wave needed | Orchestrator |
| No end-to-end test suite | Certain | Regressions undetectable without manual testing | Invest in automated testing | Engineering |
| Security layer completely unaudited | High | Potential data exposure, unauthorized access | RLS + PII audit needed before launch | Security |
