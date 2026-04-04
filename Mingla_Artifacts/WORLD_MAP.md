# Mingla World Map

> Last updated: 2026-04-02
> Orchestrator version: 1.0
> This is the single source of truth for all Mingla product reality.

---

## Product Surface Inventory

| Surface | Domain | Key Files | Grade | Items Tracked | Coverage |
|---------|--------|-----------|-------|---------------|----------|
| Auth & Session | Mobile + Backend | useAuthSimple.ts, session management | Mixed (2A, 4B, 1C) | 7 | Partial |
| Onboarding | Mobile | OnboardingFlow.tsx, useOnboardingStateMachine.ts | Mixed (2A, 9F) | 11 | Weak |
| Discovery / Explore | Mobile + Backend | SwipeableCards.tsx, deckService.ts, RecommendationsContext.tsx | Strong (38A, 5B, 0C, 12F) | 55 | Strong |
| Collaboration Sessions | Mobile + Backend | SessionViewModal, CollaborationSessions.tsx | Mixed (3A, 4F) | 7 | Weak |
| Social / Friends | Mobile + Backend | friendsService.ts, ConnectionsPage.tsx | Mixed (1A, 1B, 5F) | 7 | Weak |
| Notifications | Mobile + Backend | notify-dispatch, NotificationsModal.tsx | Strong (6A, 2B, 3F) | 11 | Partial |
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
| Network & Offline | Cross-cutting | networkMonitor.ts | Mixed (1B, 4F) | 5 | Weak |
| State & Cache | Cross-cutting | queryKeys.ts, Zustand stores | Mixed (5A, 3F) | 8 | Partial |
| Chat Responsiveness | Cross-cutting | messagingService.ts | All A | 4 | Strong |
| Hardening Infrastructure | Cross-cutting | withTimeout.ts, mutationErrorToast.ts | All A | 3 | Strong |
| Error Handling | Cross-cutting | ErrorBoundary.tsx, edgeFunctionError.ts | All F | 5 | Unaudited |
| Security & Auth | Cross-cutting | RLS policies, admin auth | Mixed (1A, 1B, 1C, 2D) | 13 | Weak |
| Deep Linking | Cross-cutting | deepLinkService.ts | Mixed (1B, 3F) | 4 | Weak |
| App Lifecycle | Cross-cutting | AppStateManager.tsx, AnimatedSplashScreen.tsx | Mixed (2A, 9F) | 11 | Weak |
| Analytics & Tracking | Cross-cutting | appsFlyerService.ts, mixpanelService.ts | Mixed (1A, 7F) | 8 | Weak |
| Weather & External | Cross-cutting | weatherService.ts, geocodingService.ts | All F | 6 | Unaudited |
| UI Components | Cross-cutting | Toast.tsx, InAppBrowserModal.tsx | Mixed (3A, 7F) | 10 | Weak |

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
| ORCH-0066 | Collab mode parity | Discovery | S1 | quality-gap | verified | B | 2026-03-31 | INVESTIGATION_PREFS_DECK_CONTRACT.md — collab verified as part of SC-09, parity confirmed |
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
| ORCH-0273 | place_pool → card_pool data drift (13+ fields stale) | Discovery | S1 | architecture-flaw | closed | A | 2026-04-02 | QA_PLACE_POOL_CARD_POOL_SYNC_REPORT.md — Unified sync trigger, 16 fields + curated composites. Old website trigger replaced. 10/10 PASS. P3: redundant city/country trigger (cleanup). |
| ORCH-0274 | Photo backfill pipeline broken — no city filter, timeouts, no job tracking | Discovery | S1 | architecture-flaw | closed | A | 2026-04-02 | QA_PHOTO_BACKFILL_PHASE1_BACKEND_REPORT.md + QA_PHOTO_BACKFILL_PHASE2_ADMIN_UI_REPORT.md — Full job system: 2 tables, 9 actions, city-scoped batches, auto-advance, persist across reloads. P1 13/13 + P2 10/10 PASS. |

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

### Section 5: Social / Friends

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0076 | Friend request send/accept/decline | Social | S1 | bug | verified | B | 2026-03-23 | Commit 76cd2ca7 |
| ORCH-0077 | Link intent flow | Social | S2 | unaudited | open | F | — | — |
| ORCH-0078 | Block/unblock/remove responsiveness | Social | S2 | bug | closed | A | 2026-03-23 | Commit 76cd2ca7 |
| ORCH-0079 | Friend-based content visibility | Social | S1 | unaudited | open | F | — | — |
| ORCH-0080 | Friend search (search-users) | Social | S2 | unaudited | open | F | — | — |
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

### Cross-Cutting: Analytics & Tracking

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0242 | AppsFlyer integration | Analytics | S1 | unaudited | open | F | — | — |
| ORCH-0243 | Mixpanel integration | Analytics | S2 | unaudited | open | F | — | — |
| ORCH-0244 | Screen logger | Analytics | S3 | unaudited | open | F | — | — |
| ORCH-0245 | Tracked pressable / touchable | Analytics | S3 | missing-feature | closed | A | 2026-03-22 | Commit dba7b3f0 |
| ORCH-0246 | User activity service | Analytics | S2 | unaudited | open | F | — | — |
| ORCH-0247 | User interaction service | Analytics | S2 | unaudited | open | F | — | — |
| ORCH-0248 | Session tracker | Analytics | S2 | unaudited | open | F | — | — |
| ORCH-0249 | A/B testing service | Analytics | S3 | unaudited | open | F | — | — |

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
