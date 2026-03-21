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
| Admin pool management (UI) | A | 2026-03-20 | Commits 9af5b5e4, 9493a697 | Place Pool (6 tabs: seed, map, browse, photos, stale, stats) + Card Pool (4 tabs: readiness, generate, browse, gaps). Map with tile status coloring + coverage gaps. Photo filters + batch controls. 3 old pages killed. README locked in. |
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
| Push delivery (OneSignal) | F | — | Unaudited | external_id model |
| In-app notifications | F | — | Unaudited | — |
| Deep link from notification | F | — | Unaudited | — |
| Notification for deleted content | F | — | Unaudited | Cross-cutting concern |
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
