# Launch Hardening Analysis — Mingla

**Date:** 2026-03-21
**Author:** Launch Hardener
**Status:** Phase 0-2 complete. Awaiting strategic direction before Phase 3-4.
**Input documents:** COMPREHENSIVE_BUG_REPORT.md (51 bugs), README.md, LAUNCH_READINESS_TRACKER.md

---

## 1. Executive Summary

### Top Launch Blockers (in foundational order)

1. **BUG-01: Category contract mismatch** — The entire card deck is empty. Mobile sends display names (`"Nature & Views"`), but `card_pool.categories` stores slugs (`"nature_views"`). The SQL `&&` overlap operator finds zero matches. **Every user sees zero cards.** This is the single most foundational issue.

2. **BUG-03: Per-category exclusions never enforced** — Extensive exclusion lists are defined in `categoryPlaceTypes.ts` but never imported by any active serving function. `query_pool_cards` only excludes 3 global types. Inappropriate places (kids' venues, Asian grocery stores in Fine Dining, etc.) appear freely.

3. **BUG-05 + notification gaps** — `accept_pair_request_atomic` is purely a DB operation that sends no notification. The `pair_request_accepted` type is mapped in `notify-dispatch` but has zero callers. Multiple other social actions may have similar gaps.

4. **Admin Card Pool page is non-operational** — 40 bugs covering: seeding_cities UUID dependency (should use TEXT), missing RPCs, no photo fill action, no card health visibility, no dry-run preview, no bulk actions, wrong tab structure.

### Most Foundational Issue

**The category contract.** Until BUG-01 is fixed, the app serves zero cards. Every other card-related bug is moot until this is resolved. This is a one-function fix (either in `resolveCategories()` or in the SQL RPC), but it must be done first.

### Bug Report Corrections (Verified via Code)

| Bug | Report Claim | Verification Result |
|-----|-------------|-------------------|
| BUG-02 | "Photos never copied to card_pool" | **DISPROVEN.** `generate-single-cards` correctly copies `stored_photo_urls[0]` → `image_url` and `stored_photo_urls.slice(0,5)` → `images`. Backfill migration `20260320300000` exists. The photo pipeline is fixed. |
| BUG-04 | "For You cards missing photos" | **Partially invalid.** Photo component is fixed (BUG-02 disproven). Category component (same as BUG-01) remains valid. |
| BUG-37 | "No photo fill action exists" | **Partially invalid.** Backfill migration exists. But no admin UI action for on-demand photo fill — that part is still valid. |

### Newly Discovered Gaps (Beyond the 51 Bugs)

1. **Card generators don't write city/country TEXT** — `insertCardToPool()` only sets `city_id` UUID. TEXT columns are backfilled by migration, not set at insert time. Any cards generated AFTER the backfill migration but BEFORE the next backfill will have NULL city/country TEXT. This is a ticking time bomb.

2. **Dual city reference system** — UUID-based (legacy CardPoolManagementPage) vs TEXT-based (Pool Intelligence V2) coexist. No migration path defined. CardPoolManagementPage can't see cities that exist in place_pool but not in seeding_cities.

3. **OneSignal login failure is silently swallowed** — If `OneSignal.login()` fails after 3 retries, push notifications silently stop working for the entire session. No error shown to user. No telemetry recorded. The "Masked Error" pattern.

4. **Foreground notification suppression is aggressive** — All non-message notification types are suppressed when app is in foreground. Social notifications (friend requests, pair activity, collaboration invites) are invisible if user has app open.

5. **No impression tracking verification** — BUG-11 claims 100% never-served, which is a consequence of BUG-01. But there's no independent verification that impression tracking WORKS correctly once BUG-01 is fixed.

---

## 2. Expanded Gap Investigation

### A. Category Contract — BROKEN

**Fact:** `generate-single-cards` writes slugs to `card_pool.categories` via `categoryToSlug()`. The serving pipeline sends display names via `PILL_TO_CATEGORY_NAME` → `resolveCategories()`. The SQL `&&` operator compares incompatible formats.

**Fact:** `MINGLA_CATEGORY_PLACE_TYPES` in `categoryPlaceTypes.ts` uses display names as keys. `seedingCategories.ts` uses display names as keys but generates slugs for storage. Two separate mappings exist with no canonical bridge.

**Fact:** BUG-09 is correct — seeding uses 10 types for First Meet, serving defines 29 types. These lists serve different purposes (seeding = Google API query types, serving = category resolution aliases) but the divergence is undocumented and confusing.

**Inference (HIGH confidence):** The category contract has no single source of truth. Three separate systems define categories: seedingCategories.ts (seeding), categoryPlaceTypes.ts (serving/aliases), and the mobile PILL_TO_CATEGORY_NAME (UI). They use different formats (slugs vs display names) with fragile conversion functions.

**README contradiction:** README says "Single source of truth — all category definitions live in `_shared/seedingCategories.ts` (seeding) and `_shared/categoryPlaceTypes.ts` (serving/aliases)." This is technically two sources of truth, and they diverge.

### B. Photo Contract — FIXED (with caveats)

**Fact:** `generate-single-cards` copies photos correctly (verified in code).
**Fact:** `generate-curated-experiences` copies photos correctly (verified in code).
**Fact:** Backfill migration `20260320300000` fills NULL/Unsplash URLs from place_pool.
**Fact:** `query_pool_cards` reads `image_url` and `images` directly from card_pool (no place_pool JOIN for photos).

**Caveat:** If the backfill migration hasn't been applied to production, existing cards may still have NULL photos. The code is fixed but the data may not be.

**Caveat:** No admin UI action exists for on-demand photo fill (BUG-37 partially valid). If new places get photos after their cards were generated, there's no way to push those photos to existing cards without running raw SQL or re-generating.

### C. Exclusion Contract — BROKEN

**Fact:** `CATEGORY_EXCLUDED_PLACE_TYPES` defined in `categoryPlaceTypes.ts:355-506` with comprehensive per-category exclusions.
**Fact:** `getExcludedTypesForCategory()` exported but NOT imported by any active serving function.
**Fact:** `query_pool_cards` SQL only excludes 3 global types: `gym`, `fitness_center`, `dog_park`.
**Fact:** `admin-seed-places` post-fetch filter (`applyPostFetchFilters`) only checks global exclusions, not per-category `excludedPrimaryTypes`.
**Fact:** Google Nearby Search API receives `excludedPrimaryTypes` but only filters on `primaryType`, not secondary `types` array.

**Inference (HIGH confidence):** The exclusion system is defense-in-depth on paper but defense-in-nothing in practice. Three layers exist (Google query, post-fetch, serve-time) and all three have gaps.

### D. City/Country Contract — TRANSITIONAL

**Fact:** `card_pool.city` and `card_pool.country` TEXT columns exist (added in Pool Intelligence V2 migration).
**Fact:** `place_pool.city` TEXT column exists with 3-pass backfill.
**Fact:** CardPoolManagementPage uses UUID-based `seeding_cities` exclusively.
**Fact:** Pool Intelligence V2 RPCs use TEXT-based filtering (zero seeding_cities dependency).
**Fact:** `insertCardToPool()` only writes `city_id` UUID, not city/country TEXT.
**Fact:** Card generation relies on migration backfill for TEXT columns.

**Inference (HIGH confidence):** The system is in a transitional state between UUID-based and TEXT-based city identity. The transition is incomplete — new cards get UUID but may not get TEXT until the next backfill. This will cause Pool Intelligence to show incomplete data for newly generated cards.

**Recommendation:** `insertCardToPool()` must write city/country TEXT at insert time, derived from the parent place_pool row. Migration backfill is a one-time fix, not a durable solution.

### E. Admin Card Pool — NON-OPERATIONAL

The 40 admin bugs (BUG-12 through BUG-51) collapse into 5 root causes:

1. **seeding_cities dependency** (BUG-12, 13, 14, 15, 20, 24, 25, 42, 44) — The page uses UUID-based seeding_cities for everything. Should use TEXT city/country from actual pool data.

2. **Wrong page boundaries** (BUG-16, 17, 18, 19) — Launch Readiness tab contains seeding concerns that belong on Place Pool page.

3. **Missing RPCs** (BUG-42, 43, 44, 45, 46) — No card-pool-native RPCs for country/city overview, photo gaps, or tile-level stats.

4. **Missing operator actions** (BUG-21, 22, 23, 28, 29, 37, 38, 39, 40, 41) — No dry-run, no bulk actions, no card health visibility, no photo fill, no cross-navigation.

5. **Slug/name confusion in UI** (BUG-26, 33) — Same root cause as BUG-01, manifesting in admin filters.

### F. Notification Reliability — GAPS BY OMISSION

**Fact:** `accept_pair_request_atomic` is purely DB — no notification sent. `pair_request_accepted` type exists in notify-dispatch type mapping but has zero callers.

**Fact:** 12 edge functions call notify-dispatch. Coverage is good for: friend requests, collaboration invites, messages, lifecycle (re-engagement, trial ending), calendar reminders.

**Fact:** Missing notification callers: pair request acceptance (BUG-05), link request acceptance (likely same pattern).

**Fact:** Suppression logging exists (returns reason codes) but is only in the HTTP response — no persistent telemetry table for suppressed notifications.

**Fact:** Foreground handler suppresses all non-message pushes. Social notifications are invisible if app is open.

**Inference (MEDIUM confidence):** The notification system is architecturally sound but has coverage gaps in the "acceptance" half of request/response flows. The pattern is: sending a request triggers a notification, but accepting it does not.

### G. Automation / Sustainability — FULLY MANUAL

**Fact:** Zero cron jobs. Zero auto-seeding. Zero auto-generation. Zero health alerts.
**Fact:** Comment in code: "Automatic refresh is disabled to eliminate $75/month in Google API costs."
**Fact:** No pool health monitoring. If categories drop below threshold, no alert fires.
**Fact:** 3-batch rotation ceiling in RecommendationsContext means finite content loops.

**Inference (HIGH confidence):** The pool will stale within weeks of launch without manual intervention. This is acceptable for a controlled beta but not for general availability. Minimum viable monitoring is needed: alert when any city drops below N cards per category.

---

## 3. Rewritten Bugs by Foundation Block

### Block 1: Category Contract Foundations

| Original ID | Foundation Title | Root Cause | Dependencies | Permanent Fix | Validation | README Impact |
|---|---|---|---|---|---|---|
| BUG-01 | Category format mismatch breaks all card serving | `card_pool.categories` stores slugs; serving pipeline sends display names | None — this is the root | Normalize in SQL RPC: convert p_categories to slugs before `&&` comparison, OR fix `resolveCategories()` to return slugs | Query `query_pool_cards` with known categories → returns >0 cards | Update "Category System" section to document canonical format |
| BUG-09 | Category type lists diverge seeding vs serving | Two separate type mappings with different scope | BUG-01 (same domain) | Document that seeding types ≠ serving aliases. Seeding = Google query types. Serving = category resolution. Both are intentional but must be documented. | Audit both lists, document purpose of each | Add "Category Type Lists" subsection |
| BUG-26 | Admin browse category filter slug/name confusion | Same format mismatch as BUG-01, manifesting in admin | BUG-01 | Once canonical format is locked, admin filters match | Admin category filter returns correct cards | N/A (admin) |
| BUG-33 | Gap analysis category counts mismatch | `placeStats` uses slugs, `cardStats` uses display names | BUG-01 | Normalize both to canonical format | Gap analysis shows matching counts | N/A (admin) |

**Why this block is first:** Without this fix, zero cards are served. Everything downstream is moot.

### Block 2: Exclusion Contract Foundations

| Original ID | Foundation Title | Root Cause | Dependencies | Permanent Fix | Validation | README Impact |
|---|---|---|---|---|---|---|
| BUG-03 | Per-category exclusions defined but never enforced | `getExcludedTypesForCategory()` not imported by active serving functions; `query_pool_cards` only has global exclusions | BUG-01 (must serve cards first to see exclusion issues) | Add per-category type exclusion to `query_pool_cards` SQL. Pass category + types to the RPC, filter cards whose place types overlap excluded types for their category. | Serve Fine Dining → no kids' venues, no fast food. Serve Drink → no grocery stores. | Update "Curated Experience Generation" global exclusions section |
| (new) | Post-fetch seeding filter doesn't check category-specific exclusions | `applyPostFetchFilters` only checks 3 global types | None | Add `config.excludedPrimaryTypes` check against ALL `types` array (not just `primaryType`) | Re-seed a tile → excluded types are filtered post-fetch | Update "Admin Seeding Pipeline" post-fetch filters section |

**Why this block is second:** Once cards are served (Block 1), users will see inappropriate content. Exclusions must work before real users see the deck.

### Block 3: Serve-Time Query Foundations

| Original ID | Foundation Title | Root Cause | Dependencies | Permanent Fix | Validation | README Impact |
|---|---|---|---|---|---|---|
| BUG-07 | Card repetition from finite pool + 3-batch ceiling | `MAX_BATCHES = 3` + impression saturation + 24h daily cache | BUG-01 (pool must serve first) | Increase MAX_BATCHES or switch to continuous rotation. Consider shorter daily cache TTL. | After fixing BUG-01, verify rotation works with 1,468 cards | Update "Card-Based Swipe Interface" section |
| BUG-11 | 100% never-served cards | Consequence of BUG-01 — zero cards served means zero impressions | BUG-01 | Fixing BUG-01 resolves this. Monitor impression tracking after fix. | After fix: served_count > 0 for served cards | N/A (metric, not contract) |
| BUG-04 | "For You" cards missing categories | Same category mismatch as BUG-01 | BUG-01 | Fixed by BUG-01 fix | discover-experiences returns categorized cards | N/A |

**Why this block is third:** These are downstream symptoms of Block 1. Most resolve automatically once the category contract is fixed.

### Block 4: City/Country Contract Foundations

| Original ID | Foundation Title | Root Cause | Dependencies | Permanent Fix | Validation | README Impact |
|---|---|---|---|---|---|---|
| BUG-12 | Cities dropdown reads seeding_cities, not actual data | CardPoolManagementPage queries seeding_cities for city list | BUG-43 (needs card-pool-native RPC) | New RPC: `admin_card_pool_city_overview()` returning distinct city/country with card counts from card_pool | Admin sees all cities that have cards, even if not in seeding_cities | N/A (admin) |
| BUG-14 | City selection uses UUID, not TEXT | Entire page passes seeding_cities.id UUID | BUG-12, BUG-42 | Rewrite page to use city TEXT + country TEXT from card_pool | All RPCs and filters use TEXT | Update "Pool Intelligence" data sources section |
| BUG-42 | admin_city_card_stats takes UUID, not TEXT | RPC signature accepts `p_city_id UUID` | None | New RPC or ALTER to accept `p_city TEXT, p_country TEXT` | RPC callable without seeding_cities reference | N/A (RPC) |
| BUG-43 | No card-pool country/city overview RPC | Missing server-side function | None | Create `admin_card_pool_overview(p_country TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL)` | Admin can see card counts by city without seeding_cities | N/A (RPC) |
| BUG-44 | Edge functions don't accept city TEXT | generate-single-cards only accepts `{ location, radiusMeters }` | None | Add `{ city: string }` parameter option that queries `place_pool WHERE city = ?` | Can generate cards by city name | N/A (edge function) |
| (new) | insertCardToPool doesn't write city/country TEXT | Only sets city_id UUID; TEXT backfilled by migration | None | Derive city/country from parent place_pool row at insert time | New cards have non-NULL city/country TEXT immediately | Update "Pool Intelligence" data sources to document this |
| BUG-20 | Generate Cards requires seeding_cities geometry | Uses center_lat/lng/radius from seeding_cities | BUG-44 | Edge functions accept city TEXT; compute bounding box from place_pool data | Can generate without seeding_cities | N/A (admin) |
| BUG-24 | Browse Cards unnecessary inner join with place_pool | Uses `card_pool.select("*, place_pool!inner(...)")` | BUG-14 | Query card_pool directly using card_pool.city TEXT | Curated cards (no place_pool_id) visible in browse | N/A (admin) |
| BUG-25 | Browse Cards city filter uses place_pool.city_id UUID | Filters by `place_pool.city_id` instead of `card_pool.city` | BUG-14 | Filter by `card_pool.city` TEXT | Cards filterable without place_pool join | N/A (admin) |

**Why this block is fourth:** The city/country contract underpins all admin operations. Must be stable before rebuilding the admin page.

### Block 5: Notification Reliability

| Original ID | Foundation Title | Root Cause | Dependencies | Permanent Fix | Validation | README Impact |
|---|---|---|---|---|---|---|
| BUG-05 | Sender not notified on pair acceptance | `accept_pair_request_atomic` is DB-only; no code calls notify-dispatch with `pair_request_accepted` | None | After RPC call succeeds, call `notify-dispatch` with type `pair_request_accepted` targeting the sender | Accept pair request → sender gets push within 10s | Update "Notifications System V2" section |
| BUG-06 | Push notifications silently suppressed | Quiet hours (10PM-8AM), foreground suppression, OneSignal linkage failure, rate limiting | None | Add suppression telemetry table. Make quiet hours configurable. Add OneSignal health check on app init. | Can query notification_suppression_log to see why any push was dropped | Add "Notification Delivery Guarantees" section |
| (new) | OneSignal login failure silently swallowed | `loginAndSubscribe` catches and warns but doesn't surface to user | None | Add telemetry event on OneSignal failure. Consider showing user a "notifications may not work" banner. | OneSignal failure → telemetry event + user notification | N/A (mobile) |
| (new) | Foreground suppresses all non-message notifications | All social/collaboration types invisible when app open | None | Review: should collaboration invites show in foreground? Consider allowing high-priority types. | Strategic decision needed | N/A |

**Why this block is fifth:** Notifications are user-facing reliability. Users must trust that actions produce visible responses.

### Block 6: Admin Card Pool Operating Model

| Original ID | Foundation Title | Root Cause | Dependencies | Permanent Fix | Validation |
|---|---|---|---|---|---|
| BUG-16, 17, 18, 19 | Launch Readiness tab on wrong page | Mixes seeding concerns with card management | None | Move to Place Pool page | Card Pool page has no seeding-related UI |
| BUG-21 | No dry-run preview for generation | UI doesn't use existing `dryRun` parameter | Block 4 (city TEXT) | Add "Preview" button that calls generation with `dryRun: true` | Admin sees preview before generating |
| BUG-22 | Raw JSON generation results | Results dumped as `JSON.stringify` | None | Parse result into structured summary | Admin sees "Generated 45 cards. 12 skipped." |
| BUG-23 | No curated generation filters | UI doesn't expose `experienceType`/`selectedCategories` | None | Add filter dropdowns | Admin can generate specific curated types |
| BUG-28 | No card detail expansion | Browse table is flat | None | Add expandable row or detail modal | Admin can see full card data |
| BUG-29 | No bulk actions | Cards activated/deactivated one at a time | None | Add multi-select + bulk action toolbar | Admin can bulk activate/deactivate |
| BUG-37 | No admin photo fill action | No UI to push place photos to cards | Block 4 (needs working RPCs) | Add "Fill Photos" button calling a new RPC | Admin can fill card photos from place_pool |
| BUG-38 | No orphaned card detection | `admin_card_pool_intelligence` computes it but not surfaced | Block 4 | Surface orphaned_cards from existing RPC on Card Health tab | Admin sees orphaned card count + list |
| BUG-39 | No stale card detection | No UI for cards with outdated parent places | Block 4 | Add stale card query (parent not refreshed 30+ days) | Admin sees stale cards |
| BUG-40 | No never-served visibility | No served_count = 0 filter | Block 1 (cards must be served first) | Add "Never Served" filter in Browse tab | Admin can find unserved cards |
| BUG-41 | No Place Pool cross-navigation | No link between pages | None | Add "View in Place Pool" button on card rows | One-click navigation |
| BUG-45 | No photo gap analysis RPC | Must compute client-side | None | Create server-side RPC | Fast photo gap analysis |
| BUG-46 | No tile-level card stats RPC | No equivalent to `admin_virtual_tile_intelligence` for cards | None | Create RPC | Tile-level card coverage |
| BUG-47, 48, 49, 50, 51 | UI/UX issues (breadcrumb, stats, tabs, loading, comments) | Admin page built for MVP, not operator console | All above blocks | Redesign with proper information architecture | Admin can operate card pool confidently |

### Block 7: UX / Label Consistency

| Original ID | Foundation Title | Root Cause | Dependencies | Permanent Fix | Validation |
|---|---|---|---|---|---|
| BUG-08 | Curated card labels show experience type, not pill name | `categoryLabel` set to experience type label | Block 1 (category contract) | Verify pill → experienceType mapping is 1:1. If so, this is by design. | User confirms label matches expectation |
| BUG-13 | Cities dropdown shows seeding status | Seeding status irrelevant for card management | Block 4 (new RPC) | Show card health metrics instead | Dropdown shows card counts, not seeding status |
| BUG-15 | "All Cities" has no intelligence | No summary view | Block 4 (new RPC) | Show country-level card pool overview | "All Cities" shows total cards, coverage |
| BUG-27 | No photo coverage indicator in browse | Only shows image_url exists | Block 6 | Show `images[]` count + parent availability | Photo status visible per card |
| BUG-30-36 | Gap Analysis issues (incomplete, limited, no tiles) | Place-pool-centric, not card-centric | Block 4 + Block 6 | Redesign as card-pool-centric gap analysis | Admin sees card gaps relative to place pool |
| BUG-34, 35 | Cross-city comparison hidden and incomplete | Hidden UX, seeding-dependent, missing card metrics | Block 4 | Integrated into "All Cities" overview | Cross-city visible by default |

### Block 8: Automation / Sustainability

| Original ID | Foundation Title | Root Cause | Dependencies | Permanent Fix | Validation |
|---|---|---|---|---|---|
| BUG-10 | Pool 100% manual, zero automation | Intentional cost decision | All above blocks | Minimum: pool health alerts. Stretch: scheduled re-seeding. | Alert fires when category < N cards |
| (new) | No pool health dashboard | No way to know pool is degrading | Block 4 | Admin overview shows health indicators | Admin sees red/yellow/green per city |
| (new) | No card freshness monitoring | No alert on stale content | Block 6 | Track `last_refreshed` on cards; alert when >30 days | Stale cards flagged automatically |

---

## 4. Dependency-Ordered Fix Plan

### Block 0: Bug Report Correction + Contract Decisions
**Purpose:** Establish ground truth before any code changes.
**Actions:**
- Confirm BUG-02 is resolved (verify backfill migration ran on production data)
- Decide canonical category format: slugs everywhere, or display names everywhere?
- Decide: should exclusions be enforced at SQL level (strongest) or edge function level?
- Decide: is CardPoolManagementPage rewrite in scope for launch, or deferred?

**Why first:** Every subsequent block depends on these decisions.

### Block 1: Category Contract Fix (BUG-01, BUG-04, BUG-09, BUG-11, BUG-26, BUG-33)
**Purpose:** Make the deck serve cards.
**Issues included:** BUG-01 (primary), BUG-04, BUG-09, BUG-11, BUG-26, BUG-33 (all downstream)
**Why before Block 2:** Can't test exclusions if no cards are served.
**Expected outcomes:** Users see cards. Impression tracking begins. Admin filters work.

### Block 2: Exclusion Enforcement (BUG-03)
**Purpose:** Ensure users don't see inappropriate content.
**Issues included:** BUG-03 + new post-fetch seeding filter gap
**Why before Block 3:** Safety/content quality must be enforced before optimizing serving.
**Expected outcomes:** Per-category exclusions applied at serve time. Post-fetch seeding filter catches missed types.

### Block 3: Notification Gaps (BUG-05, BUG-06, new gaps)
**Purpose:** Users get notified when actions are taken on their requests.
**Issues included:** BUG-05, BUG-06, OneSignal failure handling, foreground suppression review
**Why before Block 4:** Social features need reliable notifications before admin tooling.
**Expected outcomes:** Pair acceptance triggers push. Suppression is logged. OneSignal failure is visible.

### Block 4: City/Country Contract Migration (BUG-12, 14, 20, 24, 25, 42, 43, 44, new)
**Purpose:** Decouple card operations from seeding_cities. Make TEXT the canonical reference.
**Issues included:** BUG-12, 14, 20, 24, 25, 42, 43, 44, new (insertCardToPool TEXT gap)
**Why before Block 5:** Admin page rebuild needs stable RPCs and data model.
**Expected outcomes:** All card operations use TEXT city/country. New RPCs exist. insertCardToPool writes TEXT.

### Block 5: Admin Card Pool Rebuild (BUG-16-51 remaining)
**Purpose:** Transform Card Pool page into a truthful operator console.
**Issues included:** All remaining admin bugs
**Why before Block 6:** Operators need tools before automation can be designed.
**Expected outcomes:** Operator can see card health, fill photos, detect orphans/stale/unserved, generate with preview.

### Block 6: Serve-Time Quality (BUG-07, BUG-08)
**Purpose:** Improve card variety and label accuracy.
**Issues included:** BUG-07 (repetition), BUG-08 (labels)
**Why before Block 7:** UX polish after core functionality works.
**Expected outcomes:** Better rotation. Accurate labels.

### Block 7: Automation + Monitoring (BUG-10, new gaps)
**Purpose:** Make the system sustainable without constant manual intervention.
**Issues included:** BUG-10, pool health monitoring, card freshness alerts
**Why last:** Automation must be built on top of working, observable foundations.
**Expected outcomes:** Health alerts exist. Minimum intervention model defined.

---

## 5. Workstream Orchestration

### Workstream 1: Category Contract Fix

**Goal:** Make `query_pool_cards` return cards by fixing the category format mismatch.

**Root cause:** `card_pool.categories` stores slugs; serving pipeline sends display names.

**Recommended fix:** Normalize inside the SQL RPC `query_pool_cards`. Add a slug-conversion step that converts incoming display names to slugs before the `&&` comparison. This is the narrowest fix with the smallest blast radius.

**Alternative:** Fix `resolveCategories()` to return slugs instead of display names. But this changes the contract for ALL callers of that function, increasing blast radius.

**Systems touched:**
- SQL: `query_pool_cards` function (migration)
- OR: `_shared/cardPoolService.ts` resolveCategories function
- Mobile: None (if SQL fix) or deckService.ts (if client fix)
- Admin: CardPoolManagementPage.jsx category filters (same root cause)

**Backfills:** None needed — card_pool.categories already stores slugs correctly.

**Migrations:** One ALTER to `query_pool_cards` adding slug normalization.

**Validation:**
```sql
-- After fix, this should return >0:
SELECT count(*) FROM query_pool_cards(
  p_user_id := '<test-user-id>',
  p_categories := ARRAY['Nature & Views'],
  ...
);
```

**Telemetry:** Log category resolution in discover-cards (what was sent, what was resolved, how many cards returned).

**Go/no-go:** Cards returned > 0 for at least 8 of 12 visible categories.

### Workstream 2: Exclusion Enforcement

**Goal:** Prevent inappropriate places from appearing in category-filtered card serving.

**Root cause:** Per-category exclusions defined but never applied at any layer.

**Systems touched:**
- SQL: `query_pool_cards` — add per-category type exclusion logic
- Edge: `admin-seed-places/index.ts` — enhance post-fetch filter
- Shared: `_shared/categoryPlaceTypes.ts` — already has definitions (no change needed)

**Data cleanup:** Retroactively deactivate cards whose place_pool.types contain excluded types for their category.

**Migrations:**
1. ALTER `query_pool_cards` to accept place types and apply per-category exclusions
2. One-time cleanup: deactivate violating cards

**Validation:**
```sql
-- After fix, Fine Dining should not include children's stores:
SELECT * FROM query_pool_cards(
  p_categories := ARRAY['fine_dining'], ...
) WHERE types && ARRAY['children_store'];
-- Should return 0 rows
```

**Go/no-go:** Zero excluded-type cards served for each category.

### Workstream 3: Notification Gaps

**Goal:** Pair request acceptance sends push notification. Suppression is observable.

**Systems touched:**
- Mobile: After `acceptPairRequest` RPC call, invoke `notify-dispatch` edge function
- Edge: Potentially new `notify-pair-request-accepted` function (or add to existing flow)
- Mobile: OneSignal failure handling — add telemetry or user banner

**Validation:** Accept a pair request → sender receives push within 10 seconds.

**Go/no-go:** Push delivered for acceptance. Suppression reason queryable.

### Workstream 4: City/Country Contract

**Goal:** All card operations use TEXT city/country. Zero seeding_cities dependency for card management.

**Systems touched:**
- SQL: New RPCs (`admin_card_pool_overview`, updated `admin_city_card_stats` to accept TEXT)
- Edge: `generate-single-cards` and `generate-curated-experiences` accept `{ city: string }`
- Shared: `insertCardToPool()` — derive and write city/country TEXT from parent place
- Admin: CardPoolManagementPage.jsx — rewrite city selector to use card_pool data

**Migrations:**
1. New/updated RPCs
2. Backfill any remaining NULL city/country TEXT on card_pool (should already be covered by existing migration)

**Go/no-go:** CardPoolManagementPage works without any query to seeding_cities.

### Workstream 5: Admin Card Pool Rebuild

**Goal:** Card Pool page becomes a truthful operator console.

**Systems touched:**
- Admin: Full page rewrite of CardPoolManagementPage.jsx
- SQL: New RPCs for photo gaps, tile-level stats
- Admin: Move Launch Readiness to Place Pool page

**This is the largest workstream and may be deferred or phased.**

**Go/no-go:** Admin can answer: "How healthy is my card pool in City X?" in under 30 seconds.

---

## 6. README / Behavioral Contract Hardening

### Sections to Rewrite

**Category System (line 247-271):**
- ADD: Canonical storage format is SLUGS in `card_pool.categories`
- ADD: `resolveCategories()` converts all inputs to canonical form before SQL query
- ADD: `PILL_TO_CATEGORY_NAME` is UI-only; never sent to backend as-is
- FIX: "Single source of truth" claim — document that seedingCategories.ts defines seeding types, categoryPlaceTypes.ts defines serving aliases, and these are intentionally different scopes

**Card Generation & Serving Architecture (line 204-213):**
- ADD: "Card generators write city/country TEXT at insert time, derived from parent place_pool row"
- VERIFY: "generate-single-cards built" claim is accurate (it is)
- ADD: Photo pipeline contract: "Photos are copied from place_pool.stored_photo_urls to card_pool.image_url and card_pool.images at generation time"

**Curated Experience Generation (line 235-243):**
- ADD: Per-category exclusions are enforced at serve time via `query_pool_cards`
- ADD: Post-fetch seeding filter checks category-specific `excludedPrimaryTypes` against ALL `types`

### Stale Claims to Remove/Fix

- "No Unsplash anywhere" — verify this is still true after photo pipeline fix (it should be)
- README says "25 Deno Edge Functions" in reliability reference but repo has 61 — update

### New Invariants to Add

1. **Category format invariant:** `card_pool.categories` MUST store slugs. All serving functions MUST normalize input to slugs before querying.
2. **Photo source of truth invariant:** `place_pool.stored_photo_urls` is the source of truth. Card generation MUST copy photos at insert time. No serve-time photo resolution from place_pool.
3. **Exclusion enforcement invariant:** Per-category exclusions MUST be applied at serve time. Defining exclusions without enforcing them is a contract violation.
4. **City/country TEXT invariant:** All card and place operations MUST use TEXT city/country. UUID city_id is for FK integrity only, not for filtering or display.
5. **Notification completeness invariant:** Every social action that changes state for another user MUST send a notification to that user. "Relies on Realtime only" is not acceptable for critical state changes.

### Operational Health Checks to Document

1. **Card serving health:** `SELECT count(*) FROM query_pool_cards(...)` returns > 0 for standard user preferences
2. **Photo coverage:** `SELECT count(*) FILTER (WHERE image_url IS NOT NULL) * 100.0 / count(*) FROM card_pool WHERE is_active = true` > 80%
3. **Exclusion enforcement:** Zero cards served with excluded types for their category
4. **Pool freshness:** Average card age < 30 days
5. **Impression tracking:** `served_count > 0` for cards that have been active > 7 days
6. **Notification delivery:** Push success rate > 90% (excluding quiet hours and user preferences)

---

## 7. Final Launch Readiness Assessment

### Launch Blockers (MUST fix before launch)

1. **BUG-01: Category contract mismatch** — Zero cards served. Fix: 1 migration or 1 function change.
2. **BUG-03: Exclusion enforcement** — Inappropriate content in deck. Fix: 1 migration + 1 edge function change + 1 data cleanup.
3. **BUG-05: Pair acceptance notification** — Social trust broken. Fix: 1 edge function call added.
4. **(new) insertCardToPool TEXT gap** — Future cards lose city/country. Fix: 1 function change.

### Acceptable Deferrals (can launch without)

- **Admin Card Pool page rebuild (BUG-12-51)** — Operators can use Pool Intelligence V2 + raw SQL for now. Inconvenient but not user-facing.
- **BUG-07: Card repetition** — With 1,468 cards unlocked (after BUG-01 fix), repetition is tolerable for early launch.
- **BUG-08: Curated label alignment** — Cosmetic. Verify it's by design, document if so.
- **BUG-10: Pool automation** — Manual operation is fine for controlled launch. Need health alerts, not automation.
- **BUG-06: Notification suppression logging** — Nice to have. Current suppression behavior is mostly correct (quiet hours, rate limiting), just not observable.

### Unacceptable Deferrals (cannot launch without addressing)

- Cannot launch with zero cards served (BUG-01)
- Cannot launch with excluded content visible (BUG-03)
- Cannot launch with broken social notification loop (BUG-05)
- Cannot launch without impression tracking verification (BUG-11 resolution)

### Exact Criteria for "Hardened"

The system is hardened when:
1. `query_pool_cards` returns >0 cards for 12/12 visible categories ✗
2. Zero excluded-type cards appear in category-filtered results ✗
3. Pair request acceptance sends push notification to sender ✗
4. `card_pool.image_url` is non-NULL for >80% of active cards ○ (likely already true, verify)
5. New cards get city/country TEXT at insert time ✗
6. README accurately describes all behavioral contracts ✗
7. LAUNCH_READINESS_TRACKER reflects verified state with evidence ✗

**Current state: 0/7 criteria met. 4 are launch-blocking.**

---

## What Happens Next

This analysis is Phase 0-2. To proceed:

1. **Strategic decisions needed from you** (see below)
2. **Phase 3 (Implementation)** — I'll write precise prompts for the Architect (investigation/spec) and Implementor for each workstream, in block order
3. **Phase 4 (Contract Hardening)** — After implementation, I'll compose the README updates and tracker updates

The first implementation prompt will target **Block 1: Category Contract Fix** — because everything else depends on it.
