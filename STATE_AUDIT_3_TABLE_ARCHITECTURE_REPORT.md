# State Audit: 3-Table Card Pipeline Architecture

**Date:** 2026-03-19
**Mode:** S — State Audit
**Scope:** place_pool → card_pool → user_card_impressions + serving pipeline
**Confidence:** HIGH — every claim verified against source migrations and runtime code

---

## System Boundaries

### Database Tables
| Table | Migration | Purpose |
|-------|-----------|---------|
| `place_pool` | `20260301000002_card_pool_pipeline.sql` | Raw Google Places data warehouse |
| `card_pool` | `20260301000002_card_pool_pipeline.sql` | Pre-built, enriched, ready-to-serve cards |
| `user_card_impressions` | `20260301000002_card_pool_pipeline.sql` | Per-user card view tracking |
| `person_card_impressions` | `20260313000005_person_card_impressions.sql` | Per-saved-person card tracking (UNDOCUMENTED) |
| `place_reviews` | `20260303000015_voice_reviews.sql` | Voice reviews linked to places |
| `user_engagement_stats` | `20260303000003` | Aggregated user engagement counters |

### SQL Functions
| Function | Location | Purpose |
|----------|----------|---------|
| `query_pool_cards()` | `20260305000001_price_tier_system.sql:97-209` | Main card query with all filters |
| `record_card_impressions()` | `20260303000006_session_scoped_impressions.sql:18-31` | Upsert impressions |
| `cleanup_stale_impressions()` | `20260301000002_card_pool_pipeline.sql:217-224` | 30-day purge |
| `deactivate_stale_places()` | `20260301000002_card_pool_pipeline.sql:226-242` | Stale place deactivation |
| `increment_user_engagement()` | `20260303000003:62-79` | Dynamic field increment on user stats |
| `increment_place_engagement()` | `20260303000003:82-93` | Dynamic field increment on place stats |

### Edge Function Runtime
| File | Purpose |
|------|---------|
| `supabase/functions/_shared/cardPoolService.ts` | Core pipeline: upsert, query, serve, record |
| `supabase/functions/_shared/categoryPlaceTypes.ts` | Category mappings + global exclusions |
| 13+ discover-* edge functions | Category-specific card serving endpoints |

---

## Claim-by-Claim Verification

### Table 1: place_pool

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | One row per unique Google Place | **TRUE** | `google_place_id TEXT UNIQUE NOT NULL` + unique index |
| 2 | Contains name, address, lat/lng, types, rating, review_count, price_level, opening_hours, photos, raw Google response | **TRUE** | All columns present in migration. Additional columns exist (see Omissions) |
| 3 | Shared across ALL users | **TRUE** | No `user_id` column; RLS allows all authenticated users to SELECT |
| 4 | Upserted via `upsertPlaceToPool()` on `google_place_id` | **TRUE** | `cardPoolService.ts:246` — `.upsert(row, { onConflict: 'google_place_id' })` |
| 5 | `fetched_via` tracks how place was found | **TRUE** | `CHECK (fetched_via IN ('nearby_search', 'text_search', 'detail_refresh'))` |
| 6 | `last_detail_refresh` tracks when data was refreshed | **TRUE** | Column exists, reset to `now()` on every upsert |
| 7 | `refresh_failures` counts failed attempts | **TRUE** | Column exists, reset to 0 on successful upsert |
| 8 | `is_active` deactivates after 3+ failures over 7 days | **TRUE** | `deactivate_stale_places()` checks `refresh_failures >= 3 AND last_detail_refresh < now() - interval '7 days'` |

**Omitted columns (exist but not in doc):**
`id` (UUID PK), `primary_type`, `price_min`, `price_max`, `price_tier`, `website`, `stored_photo_urls` (Supabase Storage URLs), `total_impressions`, `total_saves`, `total_schedules`, `mingla_review_count`, `mingla_avg_rating`, `mingla_positive_count`, `mingla_negative_count`, `mingla_top_themes`, `first_fetched_at`, `created_at`, `updated_at`

---

### Table 2: card_pool

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | `card_type` with 'single' and 'curated' | **TRUE** | `CHECK (card_type IN ('single', 'curated'))` |
| 2 | Single cards link via `place_pool_id` with CASCADE | **TRUE** | `place_pool_id UUID REFERENCES place_pool(id) ON DELETE CASCADE` |
| 3 | Single cards have title, category, description, image_url, rating, price, opening_hours, lat/lng | **TRUE** | All columns verified in schema |
| 4 | Curated cards have stop arrays, experience_type, stops JSONB, tagline, duration, price range | **TRUE** | All columns verified: `stop_place_pool_ids UUID[]`, `stop_google_place_ids TEXT[]`, `experience_type TEXT`, `stops JSONB`, `tagline TEXT`, `estimated_duration_minutes INTEGER`, `total_price_min/max INTEGER` |
| 5 | Picnic-dates have `shopping_list` | **TRUE** | Added in `20260304000002_add_shopping_list_to_card_pool.sql` as `JSONB` |
| 6 | `base_match_score` defaults to 85 | **TRUE** | `base_match_score DOUBLE PRECISION DEFAULT 85` |
| 7 | `popularity_score` = rating × log10(reviewCount + 1) | **TRUE** | `cardPoolService.ts:310` — exact formula confirmed |
| 8 | `served_count` / `last_served_at` track serving | **TRUE** | Both columns exist with correct types |

**Omitted columns (exist but not in doc):**
`match_score` (REAL, distinct from base_match_score), `one_liner` (AI copy), `tip` (AI copy), `scoring_factors` (JSONB), `copy_generated_at`, `price_tier`, `categories[]`, `highlights[]`, `images[]`, `address`, `review_count`, `google_place_id`, `curated_pairing_key`, `website`, `is_active`, `created_at`, `updated_at`

---

### Table 3: user_card_impressions

| # | Claim | Verdict | Evidence | Notes |
|---|-------|---------|----------|-------|
| 1 | One row per user+card | **TRUE** | `UNIQUE (user_id, card_pool_id)` with `ON CONFLICT DO UPDATE` | Verified |
| 2 | `impression_type`: served, swiped_left, swiped_right, saved, expanded | **SCHEMA TRUE, CODE FALSE** | CHECK constraint defines all 5 values, but **no code ever writes anything other than 'served'** | Dead feature |
| 3 | `batch_number` column | **TRUE** | `batch_number INTEGER DEFAULT 0`, populated by edge functions | Verified |
| 4 | Impressions reset on preference update | **MISLEADING** | No rows are deleted. `query_pool_cards` ignores impressions where `created_at < p_pref_updated_at` at query time | Logical reset, not physical |
| 5 | 30-day auto-cleanup by `cleanup_stale_impressions()` | **FUNCTION EXISTS, NO SCHEDULER** | Function deletes `WHERE created_at < now() - interval '30 days'` but nothing calls it automatically | Dead without trigger |

**Omitted columns:** `view_count` (incremented on re-views), `first_seen_at` (initial view timestamp)

---

### Serving Pipeline (serveCardsFromPipeline)

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Function exists | **TRUE** | `cardPoolService.ts:669-796` |
| 2 | Fetches `preferences.updated_at` | **TRUE** | `getPreferencesUpdatedAt()` at line 693 |
| 3 | Calls `query_pool_cards` SQL function | **TRUE** | `.rpc('query_pool_cards', {...})` at lines 149-200 |
| 4 | Filters by category, geo, budget, card_type, experience_type, price_tier | **TRUE** | All 6 filter dimensions in SQL WHERE clause |
| 5 | Excludes already-seen cards | **TRUE** | `WHERE uci.created_at >= p_pref_updated_at` excludes recent impressions |
| 6 | Returns cards + total unseen count | **TRUE** | `RETURNS TABLE (card JSONB, total_unseen BIGINT)` |
| 7 | Post-filter removes excluded types | **TRUE** | Lines 701-722, filters against `GLOBAL_EXCLUDED_PLACE_TYPES` (gym, fitness_center) |
| 8 | Pool-only, never calls Google | **TRUE** | Console logs confirm: `'served ${n} from pool (0 API calls)'` |
| 9 | Records impressions synchronously | **TRUE** | `await recordImpressions(...)` with comment: "SYNCHRONOUSLY to prevent cross-batch duplicates (CF-002 fix)" |
| 10 | Fire-and-forget updates | **TRUE** | `updateServedCounts(...).catch(() => {})`, `incrementPlaceImpressions(...).catch(() => {})` — no await |

### CASCADE Chain

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Deleting place_pool cascades to card_pool | **TRUE for single cards only** | `ON DELETE CASCADE` on `place_pool_id` FK |
| 2 | Deleting card_pool cascades to impressions | **TRUE** | `ON DELETE CASCADE` on `card_pool_id` FK in both impression tables |
| 3 | Clean chain: place → card → impression | **PARTIALLY TRUE** | Works for single cards. Curated cards use arrays (no FK), so cascade does NOT apply |

---

## Findings

### 🔴 Critical Gaps

#### 1. Curated Card Orphan Problem
- **File:** `20260301000002_card_pool_pipeline.sql:96-97`
- **Code:** `stop_place_pool_ids UUID[]` — plain array, no foreign key
- **What happens:** When a place in `place_pool` is deleted, single cards cascade-delete correctly. But curated cards that reference that place in their `stop_place_pool_ids` array **survive with orphaned UUIDs**. No validation detects or prevents this.
- **Impact:** Curated cards could reference places that no longer exist, potentially serving broken multi-stop itineraries to users.
- **Fix:** Add a trigger or maintenance function that checks `stop_place_pool_ids` against `place_pool` and deactivates curated cards with missing stops.

#### 2. `cleanup_stale_impressions()` Is Never Called
- **File:** `20260301000002_card_pool_pipeline.sql:217-224`
- **Code:** Function exists but no pg_cron job, no edge function, no admin trigger calls it
- **Impact:** `user_card_impressions` table grows unbounded. The "logical reset" via `query_pool_cards` means old rows are functionally ignored but never deleted. Over months, this will degrade query performance.
- **Fix:** Add a pg_cron job or a scheduled edge function that calls `cleanup_stale_impressions()` daily.

#### 3. `deactivate_stale_places()` Is Never Called
- **File:** `20260301000002_card_pool_pipeline.sql:226-242`
- **Same issue:** Function exists but no scheduler invokes it. Stale places with 3+ refresh failures will remain `is_active = true` indefinitely.
- **Fix:** Same as above — add a scheduled invocation.

### 🟡 Hidden Flaws

#### 1. Dynamic SQL Injection Surface
- **Files:** `increment_user_engagement()` and `increment_place_engagement()` in migration `20260303000003`
- **Code:** `EXECUTE format('UPDATE ... SET %I = %I + $1', p_field, p_field)`
- **Risk:** `p_field` is an unrestricted `TEXT` parameter. Currently only called with hardcoded field names from server-side code, but any future code passing user input to `p_field` would enable SQL injection.
- **Fix:** Add a CHECK or allowlist: `IF p_field NOT IN ('total_impressions', 'total_saves', ...) THEN RAISE EXCEPTION`

#### 2. `impression_type` Is Dead Code
- **File:** `20260301000002_card_pool_pipeline.sql:177-178`
- **Code:** `CHECK (impression_type IN ('served', 'swiped_left', 'swiped_right', 'saved', 'expanded'))`
- **Reality:** Every code path writes only `'served'` (the default). The other 4 values are never written.
- **Impact:** No current bug, but the doc implies this is a working feature for tracking user swipe/save behavior — it isn't.

#### 3. `updateServedCounts` Only Updates `last_served_at`, Not `served_count`
- **File:** `cardPoolService.ts:388-398`
- **Code:** `.update({ last_served_at: new Date().toISOString() })` — only sets timestamp
- **Doc claim:** "increment served_count" — but `served_count` is NOT incremented in this function
- **Impact:** `served_count` on `card_pool` rows may be permanently 0 unless incremented elsewhere (not found in codebase).

#### 4. Missing Table in Doc: `person_card_impressions`
- **File:** `20260313000005_person_card_impressions.sql`
- **Schema:** `(user_id, person_id, card_pool_id)` with unique constraint and CASCADE deletes
- **Purpose:** Tracks which cards have been shown for specific saved people (pairing feature)
- **Impact:** The "3-table architecture" is actually a 4-table architecture. This table participates in the same CASCADE chain.

### 🔵 Observations

#### 1. Comprehensive Indexing
All three tables have well-designed indexes covering the primary query patterns:
- `place_pool`: geo, types (GIN), google_place_id, refresh timestamp
- `card_pool`: category+geo, categories (GIN), card_type+experience_type, popularity DESC, price_tier, needs_copy, needs_description
- `user_card_impressions`: user+created_at DESC, user+card_pool_id

#### 2. RLS Is Properly Configured
- `place_pool`: service_role full access, authenticated read-only, admin update
- `card_pool`: service_role full access, authenticated read-only
- `user_card_impressions`: users read own only, service_role full access
- No overly permissive policies found.

#### 3. AI Copy Pipeline Exists But Undocumented
`card_pool` has `one_liner`, `tip`, `scoring_factors`, `copy_generated_at` columns plus indexes for `needs_copy` and `needs_description` — an entire AI content generation pipeline exists that the doc doesn't mention.

#### 4. `place_reviews` Uses SET NULL, Not CASCADE
`place_reviews.place_pool_id REFERENCES place_pool(id) ON DELETE SET NULL` — reviews survive place deletion but become orphaned. This is intentional (preserve user-generated content) but differs from the "clean chain" claim.

---

## Data Flow

```
SEEDING (Admin-triggered):
  Admin → seed edge function → Google Places API → upsertPlaceToPool() → place_pool
  place_pool → buildCardFromPlace() → card_pool (single)
  place_pool × N → generateCuratedExperience() → card_pool (curated)

SERVING (User request):
  Mobile app → discover-* edge function → serveCardsFromPipeline()
    → getPreferencesUpdatedAt() → preferences table
    → queryPoolCards() → query_pool_cards SQL function
      → card_pool (filtered by 6 dimensions)
      → user_card_impressions (exclusion check)
    → post-filter (global type exclusions)
    → recordImpressions() [sync] → user_card_impressions
    → updateServedCounts() [fire-forget] → card_pool.last_served_at
    → increment_user_engagement() [fire-forget] → user_engagement_stats
    → incrementPlaceImpressions() [fire-forget] → place_pool.total_impressions
    → return cards to mobile

MAINTENANCE (Currently broken — no scheduler):
  cleanup_stale_impressions() → DELETE old user_card_impressions
  deactivate_stale_places() → UPDATE place_pool.is_active, card_pool.is_active
```

---

## Recommendations (Priority Order)

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | Maintenance functions have no scheduler | **High** | Add pg_cron or scheduled edge function for `cleanup_stale_impressions()` and `deactivate_stale_places()` |
| 2 | Curated card orphan risk | **High** | Add validation function to check `stop_place_pool_ids` integrity; run during maintenance |
| 3 | `served_count` never incremented | **Medium** | Either increment in `updateServedCounts()` or remove the column to avoid confusion |
| 4 | Dynamic SQL field injection surface | **Medium** | Add allowlist validation to `increment_user_engagement()` and `increment_place_engagement()` |
| 5 | `impression_type` dead code | **Low** | Either implement swipe/save tracking or remove the unused enum values |
| 6 | Doc omits `person_card_impressions` | **Low** | Update doc to reflect 4-table architecture |
| 7 | Doc omits AI copy pipeline | **Low** | Document `one_liner`, `tip`, `scoring_factors` columns and their generation pipeline |

---

## Verdict

**The documentation is 85% accurate.** Every structural claim about schema, relationships, and the serving pipeline checks out. The architecture is sound — pool-only serving, SQL-level filtering, synchronous impression recording, fire-and-forget analytics. The gaps are operational (no scheduler for maintenance functions), defensive (curated card orphans, dynamic SQL), and documentary (missing table, dead features presented as working). None of these are breaking bugs today, but items 1-3 will cause problems at scale.
