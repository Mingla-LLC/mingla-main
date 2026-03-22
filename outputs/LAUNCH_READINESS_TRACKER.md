# Launch Readiness Tracker

> **Last updated:** 2026-03-20
> **Status:** Active — photo pipeline + card generator + discover-cards cleanup all landed
>
> This is the single source of truth for Mingla's launch readiness.
> Every entry requires evidence. No grade promotions without proof.
> See `.claude/skills/Launch Hardener/references/pipeline-gates.md` for grade definitions.

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
| Token refresh / expiry handling | F | — | Unaudited | 401 detector exists but coverage unverified |
| Sign-out cleanup | F | — | Unaudited | — |
| Zombie auth prevention | F | — | Unaudited | Detector in queryClient.ts — needs full path audit |

### 2. Onboarding

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| State machine progression | F | — | Unaudited | indexOf bug was fixed previously |
| GPS requirement enforcement | F | — | Unaudited | No skip path — intentional |
| Preference save reliability | F | — | Unaudited | **Known issue:** PreferencesService silently catches errors |
| Resume after interruption | F | — | Unaudited | — |
| Audio recording (voice review) | F | — | Unaudited | E.164 sanitization was applied |

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
| Curated generation proximity logic | F | — | User report | Tiered proximity (3km/5km/fallback) should be simplified to nearest place. Planned for Block 8. |
| Curated travel time per user mode | F | — | User report | Travel time between stops should use user's chosen mode, not fixed. Planned for Block 8. |
| Unsplash fallback photos (operational) | F | — | INVESTIGATION_LOG_BUGS_MARCH_22.md Bug #1 | card_pool image_url still NULL for many cards. Need diagnostic: are place photos downloaded? If not, run backfill-place-photos then regenerate. Planned for Block 7. |
| Broken icons (ICON_MAP) | A | 2026-03-22 | Commit 88f2d43f | 11 missing entries added to Icon.tsx ICON_MAP. Blank icons on pills + preferences fixed. |
| "Now" filter uses stale isOpenNow | F | — | BUG_REPORT_CARD_SERVING_PIPELINE.md Bug #2 + Log Bug #3 | discover-cards "now" path causes 15s timeout. Stale boolean + pool scarcity. Planned for Block 6. |
| Triple duplicate API calls | F | — | INVESTIGATION_LOG_BUGS_MARCH_22.md Bug #4 | Unstable array refs in React Query keys cause 2-3x redundant fetches. Planned for Block 6. |
| 16s batch transition hang | F | — | INVESTIGATION_LOG_BUGS_MARCH_22.md Bug #5 | Context doesn't detect 0-card exhaustion, waits 16s timeout. Planned for Block 6. |
| Unlabeled analytics taps | F | — | INVESTIGATION_LOG_BUGS_MARCH_22.md Bug #8 | ExpandedCardHeader missing analytics label. Planned for Block 7. |
| Per-category deck balancing | F | — | BUG_REPORT_CARD_SERVING_PIPELINE.md Bug #3 | Popular categories dominate deck. SQL returns global top-N, client round-robin starved. Needs SQL window function or split queries. Planned for Block 6. |
| Curated cards bypass exclusion | F | — | BUG_REPORT_CARD_SERVING_PIPELINE.md Bug #6 | Two gaps: generation doesn't check category_type_exclusions, serve-time NOT EXISTS passes NULL place_pool_id curated cards. Planned for Block 6. |
| Children's play spaces pass filters | F | — | BUG_REPORT_CARD_SERVING_PIPELINE.md Bug #7 | Google types kids' venues as amusement_center (same as adult). Name-based heuristic or indoor_playground exclusion needed. Planned for Block 7. |
| Empty category pools (operational) | F | — | BUG_REPORT_CARD_SERVING_PIPELINE.md Bug #5 | Flowers, First Meet etc. have zero cards in Raleigh. Needs seeding + coverage monitoring. Planned for Block 7. |
| Card rendering (all types) | F | — | Unaudited | — |
| Swipe mechanics | F | — | Unaudited | Swipe limit exists |
| Empty pool state | B | 2026-03-20 | Commits f1880d93, 7dbeb362 | All 5 serving functions return HTTP 200 with empty array when pool empty. Tested on device for discover-cards. |
| Preferences → deck pipeline | B | 2026-03-20 | Commit cf194099. Test report: TEST_REPORT_PREFERENCES_PIPELINE.md | exactTime/timeSlot wired through solo+collab. CTA gating added. Travel mode from card. Dead weekendDay removed. Known: AM/PM noon boundary in collab time aggregation (MVP accepted). |
| Solo mode | F | — | Unaudited | — |
| Collab mode parity | C | 2026-03-20 | Commit cf194099 | Time aggregation added to collab. Parity improved but not fully audited. |

### 4. Collaboration Sessions

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Session creation | F | — | Unaudited | — |
| Invite send/receive | F | — | Unaudited | — |
| Real-time sync | F | — | Unaudited | Supabase Realtime |
| Voting mechanics | F | — | Unaudited | useSessionVoting.ts (20KB) |
| Session end / results | F | — | Unaudited | — |
| Concurrent mutation safety | F | — | Unaudited | Multiple participants editing |

### 5. Social / Friends

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Friend request send/accept/decline | F | — | Unaudited | — |
| Link intent flow | F | — | Unaudited | — |
| Block/mute | F | — | Unaudited | — |
| Friend-based content visibility | F | — | Unaudited | RLS policies |
| Pairing / paired saves | F | — | Unaudited | — |

### 6. Notifications

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Push delivery (OneSignal) | B | 2026-03-21 | Investigation: INVESTIGATION_FULL_NOTIFICATION_SYSTEM.md | OneSignal integration verified: registration, external_id, permission flow all correct. Sound uses OS defaults (acceptable for launch). |
| Pair accepted notification | A | 2026-03-21 | Commit 376cd237. Test report: TEST_REPORT_NOTIFICATION_PASS1.md | New edge function, both accept paths wired, fire-and-forget. 23/23 tests green. |
| Pair activity preference enforcement | A | 2026-03-21 | Commit 376cd237 | paired_user_saved_card/visited now respect friend_requests toggle. |
| Dead type cleanup | A | 2026-03-21 | Commit 376cd237 | 6 dead types removed from dispatch, icons, actions, routing, case handlers. |
| In-app notifications | F | — | Unaudited | — |
| Deep link from notification | F | — | Unaudited | — |
| Notification for deleted content | F | — | Unaudited | Cross-cutting concern |
| iOS app badge | A | 2026-03-21 | Commit d4c6725e. Test report: TEST_REPORT_NOTIFICATION_PASS2.md | iosBadgeType: Increase on all push payloads. Reset on modal open + markAllAsRead. 27/27 tests green. |
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
| Profile view/edit | F | — | Unaudited | — |
| Preference updates | F | — | Unaudited | Ties to masked error in PreferencesService |
| Account deletion | F | — | Unaudited | — |
| Subscription management | F | — | Unaudited | RevenueCat integration |

---

## Cross-Cutting Concerns

### Network & Offline

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Offline browsing (saved cards) | F | — | Unaudited | Deck batches persisted to AsyncStorage |
| Network failure at every layer | F | — | Unaudited | — |
| Slow network degradation | F | — | Unaudited | — |
| Reconnection recovery | F | — | Unaudited | refetchOnReconnect: 'always' |

### State & Cache

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| React Query cache invalidation | F | — | Unaudited | After every mutation |
| Zustand persistence schema versioning | F | — | Unaudited | DECK_SCHEMA_VERSION exists |
| App background → foreground state survival | F | — | Unaudited | useForegroundRefresh.ts |
| Memory pressure on large lists | F | — | Unaudited | — |

### Error Handling

| Item | Grade | Last Verified | Evidence | Notes |
|------|-------|--------------|----------|-------|
| Error boundary coverage | F | — | Unaudited | Class-based, wraps entire tree |
| Edge function error extraction | F | — | Unaudited | Duck-typing utility exists |
| User-facing error messages | F | — | Unaudited | Are they actionable? |
| Silent failure paths | F | — | Unaudited | FP-01 catalog |

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
