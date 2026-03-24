# Launch Readiness Tracker

> **Last updated:** 2026-03-23
> **Status:** Active — Blocks 1-8 complete (all A). Deck hardening complete (10 passes). Launch hardening in progress (Pass 0 done).
>
> This is the single source of truth for Mingla's launch readiness.
> Every entry requires evidence. No grade promotions without proof.
> See `.claude/skills/Launch Hardener/references/pipeline-gates.md` for grade definitions.
>
> **Full bug inventory:** `outputs/MASTER_BUG_LIST.md` — 109 bugs total (44 completed, 59 pending across 6 passes, 6 deferred). Every user-reported bug and forensic finding tracked with ID, source, file reference, and pass assignment.

---

## Grade Legend

| Grade | Meaning |
|-------|---------|
| **A** | Launch-ready. All criteria pass. Tested with evidence. |
| **B** | Solid. Core works. 1-2 non-critical edge cases unverified. |
| **C** | Functional. Happy path works. Error handling incomplete. |
| **D** | Fragile. Works sometimes. Known failure modes. |
| **F** | Broken or unaudited. Cannot ship. |

---

## Critical User Flows

### 1. Authentication & Session Management

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Phone OTP sign-in | F | — | Unaudited | — |
| Session persistence (background/foreground) | F | — | Unaudited | — |
| Token refresh / expiry handling | B | 2026-03-23 | Commit 2a96c8f6. Test: TEST_PASS_3_REPORT.md (34/34 green) | Grace period prevents burst 401s on resume from triggering false sign-out. Alert shown before sign-out. Transitional: 401 counter heuristic remains. |
| Sign-out cleanup | F | — | Unaudited | — |
| Zombie auth prevention | B | 2026-03-23 | Commit 2a96c8f6. Test: TEST_PASS_3_REPORT.md (34/34 green) | 401 detector hardened with grace period + user-facing alert. Still heuristic-based (transitional). |

### 2. Onboarding

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| State machine progression | F | — | Unaudited | indexOf bug was fixed previously |
| GPS requirement enforcement | F | — | Unaudited | No skip path — intentional |
| Preference save reliability | A | 2026-03-23 | Commit 302b74d5. Test: TEST_PASS_4_REPORT.md (27/27 green) | 6 redundant writes removed. Atomic save with withTimeout(8000) + retry UI on failure. PreferencesService throws on error. |
| Resume after interruption | F | — | Unaudited | — |
| Audio recording (voice review) | F | — | Unaudited | E.164 sanitization was applied |
| Skip button responsiveness | A | 2026-03-23 | Commit 76cd2ca7. Test: TEST_PASS_2_REPORT.md (46/46 green) | onComplete() fires first, profile update in background with withTimeout(5000) |

### 3. Discovery / Explore (Card Deck)

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Pool-first card pipeline | A | 2026-03-20 | Commits 94143183, 058c10a5, f1880d93, 7dbeb362. Test reports: TEST_REPORT_PHOTO_FIX.md, TEST_REPORT_CARD_GENERATOR.md, TEST_REPORT_STRIP_4_FUNCTIONS.md | ALL card-serving functions now card_pool-only. Photo pipeline fixed. generate-single-cards built. 1,463 lines of Google/OpenAI/place_pool code removed from 4 additional functions. README locked in. Verified on device. |
| Curated card generation | A | 2026-03-20 | Commits 77b92984, 27d4ea8b. Test report: TEST_REPORT_CURATED_OVERHAUL.md | Generic generator from place_pool, zero Google. 6 experience types (Friendly deleted). Flowers optional stop. Cascading hours filter. dog_park global exclusion. README locked in. |
| Category system (13 categories) | A | 2026-03-21 | Commits 6c7b2429, e42429af. Test reports: TEST_REPORT_CATEGORY_MIGRATION.md, TEST_REPORT_CATEGORY_CONTRACT.md | 12→13 migration complete. **Category contract hardened:** strict slug normalization in query_pool_cards (26 CASE branches, ELSE NULL for unknowns). Hidden categories fixed to slug format. Curated card labels restored via EXPERIENCE_TYPE_LABELS. 21/21 tests green. README locked in. |
| Admin seeding pipeline (backend) | A | 2026-03-20 | Commit 1bab3a10 | 3 new tables, seeding edge function, admin-place-search fixed. README locked in. |
| Admin pool management (UI) | A | 2026-03-20 | Commits 9af5b5e4, 9493a697 | Place Pool (6 tabs) unchanged. Card Pool fully rewritten — see below. |
| Admin Card Pool page (rewrite) | A | 2026-03-21 | Commit e58d8769. Test report: TEST_REPORT_ADMIN_CARD_POOL.md | Full UUID→TEXT rewrite. 4 new tabs (Overview, Browse, Generate, Card Health). V2 RPCs, breadcrumb nav, fixed generation, card detail modal, bulk actions. Zero seeding_cities refs. 35/35 tests green. Resolves 28/40 admin bugs. README locked in. |
| Per-category exclusion enforcement | A | 2026-03-21 | Commits 984f8be7, a408e1b1. Test reports: TEST_REPORT_EXCLUSION_ENFORCEMENT.md, TEST_REPORT_EXCLUSION_REGRESSION_FIX.md | category_type_exclusions table (~697 rows). **Regression fixed:** NOT EXISTS uses cp.categories (card's own), not v_slug_categories (user's query) — prevents cross-category contamination. Missing place_pool_id index added. 22/22 + 16/16 tests green. README locked in. |
| City/country TEXT contract | A | 2026-03-21 | Commit 5db8dbe8. Test report: TEST_REPORT_CITY_COUNTRY_CONTRACT.md | All 5 insert paths populate city/country TEXT. Backfill migration eliminates NULLs. Propagation trigger cascades changes. 28/28 tests green. README locked in. |
| Card photo integrity | A | 2026-03-22 | Commit 7ca26b48. Test report: TEST_REPORT_CARD_PHOTO_INTEGRITY.md | 844 curated hero images backfilled from first stop. 6 singles linked by google_place_id. 29 orphans deleted. card_image_pct added to cross-city RPCs. 14 dirty city values cleaned. 27/27 tests green. |
| Curated nearest-place selection | A | 2026-03-22 | Commit 35c10157. Test report: TEST_REPORT_CURATED_GENERATION.md | Pure haversine nearest replaces 3km/5km tiers. 26/26 tests green. |
| Curated per-user travel times | A | 2026-03-22 | Commit 35c10157 | Serve-time recomputation in poolCardToApiCard. Unified estimateTravelMin with per-mode detour factors. |
| Card photo coverage | A | 2026-03-22 | Commits 7ca26b48, 267b29b0. Diagnostic: 948/948 places, 1655/1655 cards have images. | Block 5b backfill + Block 6 photo regression fix. stored_photo_urls and photos restored to query_pool_cards enriched CTEs. |
| Broken icons (ICON_MAP) | A | 2026-03-22 | Commit 88f2d43f | 11 missing entries added to Icon.tsx ICON_MAP. Blank icons on pills + preferences fixed. |
| "Now" filter live opening hours | A | 2026-03-22 | Commit 28be9a63. Test report: TEST_REPORT_SERVE_TIME_PASS1.md | Stale isOpenNow replaced with live parseHoursText() + new Date(). NULL hours pass through. 21/21 tests green. |
| Batch transition hang (16s) | A | 2026-03-22 | Commit 28be9a63 | Immediate exhaustion detection when 0 cards returned. 16s safety net preserved. |
| Prefetch key alignment | A | 2026-03-22 | Commit 28be9a63 | exactTime added to prefetch key at position 14, matching useDeckCards. |
| Triple duplicate API calls | B | 2026-03-22 | INVESTIGATION_SERVE_TIME_QUALITY.md | Already fixed in current code (arrays serialized, GPS rounded). Prefetch key alignment fixed in Pass 1. One hidden flaw remains (not blocking). |
| 16s batch transition hang | A | 2026-03-22 | Commit 28be9a63 | Immediate exhaustion detection added in Pass 1. 16s safety net preserved. |
| ActionButtons analytics | A | 2026-03-22 | Commit dba7b3f0 | 9 buttons tracked with TrackedTouchableOpacity. |
| Expanded card travel mode icon | A | 2026-03-22 | Commit dba7b3f0 | Uses card.travelMode with effectiveTravelMode fallback. |
| Deck hardening: coordinates replacing text | F | — | INVESTIGATION_DECK_AND_DISCOVER.md #10 | PreferencesSheet loads custom_location (coords) instead of location (display name). |
| Deck hardening: currency changes with GPS | F | — | INVESTIGATION_DECK_AND_DISCOVER.md #3/#4 | Locale re-derived from GPS instead of locked from onboarding. |
| Deck hardening: priceLevel enum on paired cards | F | — | INVESTIGATION_DECK_AND_DISCOVER.md (new) | PersonHolidayView maps priceRange={c.priceLevel} — shows Google enum string. |
| Deck hardening: curated no Schedule button | F | — | INVESTIGATION_DECK_AND_DISCOVER.md #8 | ActionButtons inside {!isCuratedCard} block. |
| Deck hardening: paired view repeated experiences | F | — | INVESTIGATION_DECK_AND_DISCOVER.md #5 | No cross-section dedup in CardRow sections. |
| Deck hardening: policies open phone browser | F | — | User report | Should always use in-app browser with back button. |
| Deck hardening: schedule picker behind modal | F | — | User report | DateTimePicker renders behind schedule modal on saved page. |
| Deck hardening: no schedule confirmation | F | — | User report | Schedules abruptly from expanded card, no confirmation. |
| Deck hardening: can't use current date to schedule | F | — | User report | Shows Cancel not Done for already-selected date. |
| Deck hardening: slug on saved page | F | — | User report | Shows fine_dining instead of Fine Dining. |
| Deck hardening: curated/category round-robin broken | F | — | User report | Curated overwhelms or category cards don't appear. |
| Schools in cards | F | — | User report | Sport school in Creative & Arts. Need global type + keyword exclusion. |
| Flowers category too broad | F | — | User report | Surfaces department stores, not just florists. |
| Curated AI stop descriptions missing | F | — | User report | Stops should explain rationale. Picnic dates returns zero cards. |
| Push delivery via OneSignal | A | 2026-03-22 | Commits 163ce5f1, 469b0f11. Test report: TEST_REPORT_PUSH_DELIVERY_FIX.md | sendPush() detects empty id + parse errors. Root cause: android_channel_id not configured in OneSignal → 400 error killing ALL platforms. Disabled channel IDs. Legacy API key updated to Rich API Key. Push confirmed working on both iOS and Android. |
| Missing icon: paper-plane-outline | A | 2026-03-22 | Commit ba2a37be | Added to ICON_MAP → Send. |
| Per-category deck balancing | A | 2026-03-22 | Commit 7fef7ed0 | See "Category balancing" above. Resolved. |
| Curated card exclusion enforcement | A | 2026-03-22 | Commit 7fef7ed0. Test report: TEST_REPORT_SERVE_TIME_PASS2.md | Serve-time NOT EXISTS via card_pool_stops + generation-time DB-driven exclusion. Nature slug regression caught and fixed. 26/26 tests green. |
| Category balancing | A | 2026-03-22 | Commit 7fef7ed0 | ROW_NUMBER partition with per-category cap. Count CTE unaffected. No balancing when no categories selected. |
| Children's venue filter | A | 2026-03-22 | Commit dba7b3f0 | isChildVenueName() with 20+ keywords. Applied in both generators. Space-padded to avoid false positives. |
| Empty category pools (operational) | F | — | BUG_REPORT_CARD_SERVING_PIPELINE.md Bug #5 | Flowers, First Meet etc. have zero cards in Raleigh. Needs seeding + coverage monitoring. Planned for Block 7. |
| Discover retry responsiveness | A | 2026-03-23 | Commit 2a96c8f6. Test: TEST_PASS_3_REPORT.md (34/34 green) | Loading state set before async work. Spinner appears instantly on retry. |
| Pull-to-refresh (Calendar/Saved) | A | 2026-03-23 | Commit 2a96c8f6. Test: TEST_PASS_3_REPORT.md (34/34 green) | user?.id added to useCallback deps. Fixes stale closure silent no-op. |
| Card rendering (all types) | C | 2026-03-24 | Commit 5702067b. Test: TEST_PASS1_KILL_THE_LIES.md (27/27 green + 3 mediums fixed) | Pass 1: Fabricated data removed (fake ratings, travel times, prices). Currency wired to all 10 price surfaces. Curated title fixed. Opening hours rendered. Travel icons corrected. Remaining: icon system consolidation (5 systems), star color unification, image fallback consistency. |
| Swipe mechanics | F | — | Unaudited | Swipe limit exists |
| Empty pool state | B | 2026-03-20 | Commits f1880d93, 7dbeb362 | All 5 serving functions return HTTP 200 with empty array when pool empty. Tested on device for discover-cards. |
| Preferences → deck pipeline | B | 2026-03-20 | Commit cf194099. Test report: TEST_REPORT_PREFERENCES_PIPELINE.md | exactTime/timeSlot wired through solo+collab. CTA gating added. Travel mode from card. Dead weekendDay removed. Known: AM/PM noon boundary in collab time aggregation (MVP accepted). |
| Solo mode | F | — | Unaudited | — |
| Collab mode parity | C | 2026-03-20 | Commit cf194099 | Time aggregation added to collab. Parity improved but not fully audited. |

### 4. Collaboration Sessions

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| UI consolidation (single entry point) | A | 2026-03-23 | Commit 15fe8742. Test: TEST_COLLABORATION_UI_CONSOLIDATION_REPORT.md (47/47 green) | Pill bar → SessionViewModal is the only path. CollaborationModule + BoardViewScreen deleted. Notifications + deep links rerouted. 8 files deleted, 11 modified. |
| Board exit responsiveness | A | 2026-03-23 | Commit 76cd2ca7. Test: TEST_PASS_2_REPORT.md (46/46 green) | Modal closes instantly, 4 DB ops in background. Critical failure toasts, cleanup warns only. |
| Session creation | F | — | Unaudited | — |
| Invite send/receive | F | — | Unaudited | — |
| Real-time sync | F | — | Unaudited | Supabase Realtime |
| Voting mechanics | F | — | Unaudited | useSessionVoting.ts (20KB) |
| Session end / results | F | — | Unaudited | — |
| Concurrent mutation safety | F | — | Unaudited | Multiple participants editing |

### 5. Social / Friends

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Friend request send/accept/decline | B | 2026-03-23 | Commit 76cd2ca7. Test: TEST_PASS_2_REPORT.md (46/46 green) | Accept/decline non-blocking. Redundant refetches removed. Error toasts on failure. Send flow unaudited. |
| Link intent flow | F | — | Unaudited | — |
| Block/unblock/remove responsiveness | A | 2026-03-23 | Commit 76cd2ca7. Test: TEST_PASS_2_REPORT.md (46/46 green) | All 4 handlers (block, unblock, remove×2) non-blocking. Modals/alerts close instantly. Background work with error toasts. |
| Friend-based content visibility | F | — | Unaudited | RLS policies |
| Pairing / paired saves | F | — | Unaudited | — |

### 6. Notifications

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Push delivery (OneSignal) | B | 2026-03-21 | Investigation: INVESTIGATION_FULL_NOTIFICATION_SYSTEM.md | OneSignal integration verified: registration, external_id, permission flow all correct. Sound uses OS defaults (acceptable for launch). |
| Pair accepted notification | A | 2026-03-21 | Commit 376cd237. Test report: TEST_REPORT_NOTIFICATION_PASS1.md | New edge function, both accept paths wired, fire-and-forget. 23/23 tests green. |
| Pair activity preference enforcement | A | 2026-03-21 | Commit 376cd237 | paired_user_saved_card/visited now respect friend_requests toggle. |
| Dead type cleanup | A | 2026-03-21 | Commit 376cd237 | 6 dead types removed from dispatch, icons, actions, routing, case handlers. |
| In-app notifications | F | — | Unaudited | board-view targets updated to home (2026-03-23) |
| Deep link from notification | B | 2026-03-23 | Commit 15fe8742 | `mingla://session/{id}` routes to home + auto-open modal. board-view deep links eliminated. Known: invalid sessionId lingers (medium finding). |
| Notification for deleted content | F | — | Unaudited | Cross-cutting concern |
| iOS app badge | A | 2026-03-23 | Commits d4c6725e, ea655d36. Tests: TEST_REPORT_NOTIFICATION_PASS2.md + TEST_PASS_7_REPORT.md (22/22 green) | Badge resets on markAllAsRead + modal open + last-read. SDK v5 setBadgeCount limitation documented. |
| DM unread realtime | A | 2026-03-23 | Commit ea655d36. Test: TEST_PASS_7_REPORT.md (22/22 green) | message_reads INSERT listener on social-realtime channel. Conversation list invalidated on read. |
| Notification send observability | B | 2026-03-23 | Commit ea655d36. Test: TEST_PASS_7_REPORT.md (22/22 green) | withTimeout(5000) on all board notifications. Empty catches eliminated. Transitional: no retry queue. |
| Realtime subscription lifecycle | A | 2026-03-23 | Commit ea655d36. Audit: AUDIT_REALTIME_SUBSCRIPTIONS.md | 6 channels audited. Sign-out, resume, user-switch all correct via useEffect cleanup. |
| Session member left notification | A | 2026-03-21 | Commit d4c6725e | notifyMemberLeft wired in ManageBoardModal (leave + admin-remove). Skip on session deletion. |
| Holiday reminders | A | 2026-03-21 | Commit d4c6725e | New edge function + cron at 9 AM UTC. Per-user timezone. reminders preference column. Known: custom_holidays.year is NOT NULL, no recurring holidays yet. |
| Email notifications | F | — | Unaudited | — |

### 7. Saved Experiences / Boards

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Save/unsave experience | F | — | Unaudited | — |
| Board create/edit/delete | F | — | Unaudited | — |
| Board sharing | F | — | Unaudited | — |
| Board RSVP | F | — | Unaudited | — |
| Saved content cache | F | — | Unaudited | — |

### 8. Profile & Settings

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Profile cold-start freshness | A | 2026-03-23 | Commit a268b19f. Test: TEST_PASS_8_REPORT.md (25/25 green) | Always fetches fresh on mount. Persisted profile provides instant UI. Dead Zustand preferences removed. |
| Preference updates + authority | A | 2026-03-23 | Commits 302b74d5, a268b19f. Tests: TEST_PASS_4_REPORT.md + TEST_PASS_8_REPORT.md | Atomic onboarding save (Pass 4). StaleTime 60s. Dead Zustand field removed. Authority map: AUTHORITY_MAP_PREFERENCES_PROFILE.md |
| Category filter → deck sync | A | 2026-03-23 | Commit a268b19f. Test: TEST_PASS_8_REPORT.md (25/25 green) | PreferencesSheet invalidates deck-cards + userPreferences after save. No more stale cards after filter change. |
| Account deletion | F | — | Unaudited | — |
| Subscription tier freshness | B | 2026-03-23 | Commit cdd3cac0. Test: TEST_PASS_5_REPORT.md (27/27 green) | StaleTime 5min→60s. Transitional: "take highest of 3" model remains. Exception list: TIER_AUTHORITY_EXCEPTION_LIST.md |
| Purchase error handling | A | 2026-03-23 | Commit cdd3cac0. Test: TEST_PASS_5_REPORT.md (27/27 green) | onError on all 4 RC mutations. Sync retry + info toast in both paywall screens. |
| Subscription management | F | — | Unaudited | RevenueCat integration |

---

## Deck Hardening (Passes 1-6)

> **Full details:** `outputs/MASTER_BUG_LIST.md`
> **Source investigations:** `INVESTIGATION_DECK_AND_DISCOVER.md` + `INVESTIGATION_UX_FORENSIC.md`

| Pass | Bugs | Focus | Status |
|------|------|-------|--------|
| 1a | 4 | Null safety + crash prevention | **DONE** — commit 184c8873, 14/14 green |
| 1b | 4 | Silent failures + preferences | **DONE** — commit 8f5c3851, 18/18 green |
| 1c | 4 | Curated card state (optional stops, ActionButtons, shopping list, AI desc) | **DONE** — commit 2633cafa, 21/21 green |
| 2a | 3 | Currency + pricing + slug display | **DONE** — commit 3d79c0d6, 15/15 green |
| 2b | 3 | Paired view dedup + error state + birthday | **DONE** — commit a49fc518, 18/18 green |
| 2c | 5 | Timezone pipeline + parser unification + lat/lng | **DONE** — commit 106d18f7, 21/21 green |
| 3a | 4 | Error states + truthfulness | **DONE** — commit f95a5fad, 19/19 green |
| 3b | 2 | In-app browser + avatar fallback | **DONE** — commit 0254bc4f, 14/14 green |
| 3c | 1 | Rating falsy fix (3 deferred: flicker, round-robin OK, skeleton intentional) | **DONE** — commit c10d8971 |
| 4a | 4 | Scheduling — iOS picker, date confirm, 12hr, haptic | **DONE** — commit ae2d17f2, 13/13 green |
| 4b | 3 | Schools exclusion + flowers florist-only + 5 icons | **DONE** — commit 073da431, 15/15 green |
| 4c | 3 | AI optional marker + picnic flowers optional + description truncation | **DONE** — commit 08396f14, 15/15 green |
| 5a | 2 | Removal toast + calendar dedup (2 deferred: deactivated cards, calendar perm already handled) | **DONE** — commit 322fbdb2, 12/12 green |
| 5b | 1 | Duration NaN guard (3 deferred: swipe limit, batch race, weather) | **DONE** — commit e8c81dc4 |
| 6 | 7 | Polish — seat map, coord bounds, suggestion race, category filter, safe images (9 deferred/skipped) | **DONE** — commit c7b8c691 |
| 7 | 2 | Realtime + freshness — mount useSocialRealtime + useForegroundRefresh (were dead code) | **DONE** — commit f3312371 |
| 8 | 3 | Calendar slugs + reschedule cache + review reset (4 deferred/resolved: data gap, collab ID, review screen, weekend fixed by 4a) | **DONE** — commit 88f94d26 |
| 9 | 2 | Atomic unpair RPC — replaces error-swallowing 3-step code | **DONE** — commit 23f3a0dd |
| 10 | 1 | board_saved_cards DELETE RLS policy (review blank fixed by Pass 4b) | **DONE** — commit 1069a81a |

---

## Cross-Cutting Concerns

### Network & Offline

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Offline browsing (saved cards) | F | — | Unaudited | Deck batches persisted to AsyncStorage |
| Network failure at every layer | F | — | Unaudited | — |
| Slow network degradation | F | — | Unaudited | — |
| Reconnection recovery | F | — | Unaudited | refetchOnReconnect: 'always' |
| Offline queue observability | B | 2026-03-23 | Commit 8839c00b. Test: TEST_PASS_9B_REPORT.md (16/16 green) | Discards logged (console.error). Queue cleared on logout. Transitional: no user notification on discard, no retry UI for board actions. |

### State & Cache

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Query key consolidation | A | 2026-03-23 | Commit 846e7cce. Test: TEST_PASS_6_REPORT.md (30/30 green) | One factory per entity. Saved cards (3→1), person cards (2→1), blocked users (2→1). 18 hardcoded keys replaced. Old useBlockedUsers deleted. Dead Zustand field removed. Grep proof: zero orphaned literals. |
| Mutation error handling | A | 2026-03-23 | Commit 27e475ac. Test: TEST_PASS_9A_REPORT.md (24/24 green) | 16 mutations got onError. 7 silent catches logged. ~50 remaining are non-state-changing (documented). |
| React Query cache invalidation | F | — | Unaudited | After every mutation |
| Zustand persistence schema versioning | F | — | Unaudited | DECK_SCHEMA_VERSION exists |
| App background → foreground state survival | F | — | Unaudited | useForegroundRefresh.ts |
| Memory pressure on large lists | F | — | Unaudited | — |

### Chat & Conversation Responsiveness (Pass 1)

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Existing chat tap (cached messages) | A | 2026-03-23 | Commit bef4ca3b (prior) + 2549dbe6. Test: TEST_PASS_1_REPORT.md (28/28 green) | Synchronous block check from cache, UI opens instantly |
| First-time chat open (no cache) | A | 2026-03-23 | Commit 2549dbe6. Test: TEST_PASS_1_REPORT.md (28/28 green) | UI opens immediately with empty state, messages fetch in background (8s timeout) |
| New conversation from friend picker | A | 2026-03-23 | Commit 2549dbe6. Test: TEST_PASS_1_REPORT.md (28/28 green) | Chat opens before getOrCreate. Offline fallback + error toast on total failure. |
| Block service timeout | A | 2026-03-23 | Commit 2549dbe6. Test: TEST_PASS_1_REPORT.md (28/28 green) | hasBlockBetween + isBlockedByUser wrapped in withTimeout(5000) |

### Hardening Infrastructure (Pass 0)

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| withTimeout utility | A | 2026-03-23 | Commit 06614e98. Test: TEST_PASS_0_REPORT.md (38/38 green) | Generic Promise.race wrapper, leak-free cleanup |
| Mutation error toast utility | A | 2026-03-23 | Commit 06614e98. Test: TEST_PASS_0_REPORT.md (38/38 green) | Defense-in-depth: Supabase codes, SQL/stack rejection, network/timeout detection |
| Centralized query key factory | A | 2026-03-23 | Commit 06614e98. Test: TEST_PASS_0_REPORT.md (38/38 green) | savedCardKeys factory. Pass 6 consolidates remaining 8 factories. |

### Error Handling

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Error boundary coverage | F | — | Unaudited | Class-based, wraps entire tree |
| Edge function error extraction | F | — | Unaudited | Duck-typing utility exists |
| User-facing error messages | F | — | Unaudited | Are they actionable? |
| Silent failure paths | F | — | Unaudited | FP-01 catalog |
| Service error contract | F | 2026-03-23 | Transitional containment in Pass 10. | DEFERRED: 4 service functions return null/[]/fallback on error. [TRANSITIONAL] logging added. Full fix: ServiceResult<T> return type migration (~60+ call sites). Owner: next hardening cycle. |

### Security & Auth

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| RLS policy coverage | F | — | Unaudited | 392+ policies |
| Admin auth (3-layer) | F | — | Unaudited | Complex with localStorage flags |
| PII handling | F | — | Unaudited | Phone numbers, location data |
| Storage path injection | F | — | Unaudited | E.164 sanitization applied in one place |

---

## Curated Card Integrity (Previously Hardened)

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| CRIT-001: Pool reference validity | C | 2026-03-19 | Migration deployed | Needs full pipeline verification |
| CRIT-002: Cascade deactivation | C | 2026-03-19 | Migration deployed | Needs full pipeline verification |
| CRIT-003: No orphaned curated cards | C | 2026-03-19 | Migration deployed | Needs full pipeline verification |

> **Note:** These were implemented via migrations but have not been through the
> full Launch Hardener pipeline (audit → spec → implement → test → review).
> Grade C reflects "deployed but not fully verified."

---

## Resolved Issues

| Issue | Resolution | Date | Pipeline Evidence |
|-------|-----------|------|-------------------|
| BUG-01: Category slug mismatch (zero cards served) | Strict slug normalization in query_pool_cards — 26 CASE branches, ELSE NULL, COALESCE for empty safety | 2026-03-21 | Spec: SPEC_CATEGORY_CONTRACT.md. Test: TEST_REPORT_CATEGORY_CONTRACT.md (21/21 green). Commit: e42429af. README locked in. |
| BUG-01b: Groceries hidden category leak | v_hidden_categories changed from 'Groceries' to 'groceries' (slug format) | 2026-03-21 | Same commit and test report as BUG-01 |
| Curated card labels missing (Romantic, Group Fun, Picnic Dates) | EXPERIENCE_TYPE_LABELS added to poolCardToApiCard, reconstructs categoryLabel from experience_type | 2026-03-21 | Same commit and test report as BUG-01 |

---

## Decision Log

_Architectural decisions made during hardening, to prevent re-litigation._

| Decision | Date | Reasoning | Alternatives Rejected |
|----------|------|-----------|-----------------------|
| Slugs as canonical category format | 2026-03-21 | card_pool already stores slugs; narrowest fix is SQL normalization | Display names everywhere (requires backfill + generator changes), both directions (adds complexity) |
| Strict mode — no fuzzy fallback for unknown categories | 2026-03-21 | Broken callers should fail visibly (too many cards) not silently (zero cards). User demands pill = what you get. | Backward compat with regex fallback (hides future bugs) |

---

## How to Use This Tracker

1. **Before starting work:** Read the relevant section to understand current state.
2. **After completing a pipeline:** Update the grade with evidence.
3. **When discovering a new issue:** Add it immediately at grade F.
4. **Grade promotion requires proof.** Test results, not claims.
5. **Never downgrade without explanation.** If something regressed, document why.

**The tracker reflects reality. If you're unsure, the grade is F.**
