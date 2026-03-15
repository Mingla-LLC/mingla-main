# Spec: Background Pool Infrastructure — Pre-Warming, Cron Jobs, and Pool Lifecycle

**Status:** Draft — Future Work
**Priority:** P1 — eliminates cold-start latency for all users
**Scope:** Fix 4 of the card pipeline reliability initiative
**Depends on:** SPEC_CARD_PIPELINE_RELIABILITY.md (Fixes 1–3 must ship first)
**Author:** Architect Agent
**Date:** 2026-03-14

---

## 1. Problem Statement

The card pool (`place_pool` + `card_pool`) is currently populated ONLY by user-triggered requests. There are zero background jobs, zero cron functions, and zero scheduled workers. Every piece of infrastructure relies on reactive, user-initiated actions:

| Operation | Current Trigger | Problem |
|-----------|----------------|---------|
| Pool population | User's first deck fetch | First request in new location = cold Google API (3-8s) |
| Pool warming | App open (2s delay, fire-and-forget) | Fires AFTER deck query starts; can't help first load |
| Cache cleanup (`cleanup_expired_places_cache`) | SQL function exists, no trigger | Expired cache entries pile up indefinitely |
| Stale place deactivation (`deactivate_stale_places`) | SQL function exists, no trigger | Dead places served as "active" for weeks |
| Place data refresh | No mechanism found | Place details (hours, rating, photos) go stale after 24h |
| Impression cleanup (`cleanup_stale_impressions`) | SQL function exists, no trigger | 30-day-old impressions never cleaned |

**Consequences:**
1. Users in new locations always experience slow first load (chicken-and-egg pool)
2. `google_places_cache` grows unbounded with expired entries
3. `place_pool` and `card_pool` grow unbounded with no eviction
4. Stale place data (wrong hours, closed permanently) served to users
5. `user_card_impressions` accumulates 30+ day old entries, slowing impression-exclusion queries

---

## 2. Intended User Outcome

1. Users in the top 50 US metro areas see cards within 1-2 seconds on first app open (pool pre-populated)
2. Place data is always fresh (hours, rating, photos refreshed daily)
3. Closed/dead places are automatically removed within 24 hours
4. Database stays lean (expired cache, stale impressions cleaned automatically)
5. No user-facing behavior change — all improvements are invisible backend optimizations

---

## 3. Scope and Non-Goals

### In Scope
- **Cron 1:** Nightly pool pre-warming for top metro areas
- **Cron 2:** Daily expired cache cleanup
- **Cron 3:** Daily stale place deactivation
- **Cron 4:** Weekly impression cleanup
- **Cron 5:** Daily place detail refresh for active places
- **Pool eviction:** TTL-based card expiration (30 days inactive)
- **Monitoring:** Structured logging for all cron operations

### Non-Goals
- Real-time pool updates (WebSocket push of new cards)
- User-specific pool pre-warming (personalized cold-start optimization)
- International market pre-warming (US only for v1)
- Pool analytics dashboard
- Changes to client-side code (this spec is 100% server-side)
- Changes to the real-time deck serving path (covered by SPEC_CARD_PIPELINE_RELIABILITY)

---

## 4. Architecture Overview

### 4.1 Current State

```
User Request ──→ discover-cards ──→ Pool Query ──→ (empty) ──→ Google API ──→ Response
                                                                    ↓
                                                              Fire-and-forget:
                                                              Store to pool
```

### 4.2 Target State

```
User Request ──→ discover-cards ──→ Pool Query ──→ (populated!) ──→ Response (fast)

                                        ↑ Pool populated by:
                                        │
  ┌─────────────────────────────────────┤
  │                                     │
  │  Cron: nightly-pool-warm            │  ← Pre-warms top 50 metros
  │  Cron: daily-place-refresh          │  ← Refreshes active place details
  │  Cron: daily-cache-cleanup          │  ← Removes expired google_places_cache
  │  Cron: daily-stale-deactivate       │  ← Deactivates places with 3+ refresh failures
  │  Cron: weekly-impression-cleanup    │  ← Removes 30-day-old impressions
  │  Cron: monthly-pool-eviction        │  ← Removes 30-day inactive cards
  └─────────────────────────────────────┘
```

---

## 5. Cron 1 — Nightly Pool Pre-Warming

### 5.1 Purpose

Pre-populate `card_pool` for the top 50 US metro areas × 6 core categories so that any user in those areas gets instant results on first load.

### 5.2 Trigger

- **Schedule:** Daily at 03:00 UTC (10 PM EST / 7 PM PST — low traffic)
- **Mechanism:** Supabase pg_cron (PostgreSQL extension) OR external cron (GitHub Actions, AWS EventBridge) calling a Supabase edge function
- **Duration budget:** Max 30 minutes per run

### 5.3 Metro Areas (v1)

Top 50 US Combined Statistical Areas by population. Store as a database table `warm_pool_targets`:

```sql
CREATE TABLE warm_pool_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,  -- 1 = highest priority
  categories TEXT[] NOT NULL DEFAULT ARRAY['Nature', 'Casual Eats', 'Drink', 'Fine Dining', 'Watch', 'Play'],
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_warmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with top 10 initially:
INSERT INTO warm_pool_targets (city_name, lat, lng, priority) VALUES
  ('New York', 40.7128, -74.0060, 1),
  ('Los Angeles', 34.0522, -118.2437, 2),
  ('Chicago', 41.8781, -87.6298, 3),
  ('Houston', 29.7604, -95.3698, 4),
  ('Phoenix', 33.4484, -112.0740, 5),
  ('Philadelphia', 39.9526, -75.1652, 6),
  ('San Antonio', 29.4241, -98.4936, 7),
  ('San Diego', 32.7157, -117.1611, 8),
  ('Dallas', 32.7767, -96.7970, 9),
  ('Austin', 30.2672, -97.7431, 10);
```

### 5.4 Edge Function: `cron-warm-pool`

**New file:** `supabase/functions/cron-warm-pool/index.ts`

```
For each target in warm_pool_targets WHERE is_active = true
  ORDER BY priority ASC:

  1. Call discover-cards internally with warmPool=true for each category
  2. Rate limit: max 2 concurrent Google API calls (respect quota)
  3. Log: city, categories warmed, cards added, duration
  4. Update last_warmed_at on target row
  5. If single city takes > 60s, skip remaining categories and move to next city
```

**Auth:** Uses `SUPABASE_SERVICE_ROLE_KEY` (no user auth needed for warming).

**Google API Budget:**
- 6 categories × 50 cities = 300 API calls max per nightly run
- At $0.032 per Nearby Search call = ~$9.60/day = ~$288/month
- With 24h cache, most calls hit cache on subsequent nights = ~$50/month steady state

### 5.5 Acceptance Criteria

- [ ] `warm_pool_targets` table exists with seed data
- [ ] `cron-warm-pool` edge function runs nightly at 03:00 UTC
- [ ] Each target city has pool cards for all 6 core categories after first run
- [ ] Function completes within 30 minutes
- [ ] Function is idempotent (running twice doesn't duplicate cards — `card_pool` has UNIQUE constraint on `google_place_id`)
- [ ] `last_warmed_at` is updated per city
- [ ] Failed cities are logged but don't block other cities
- [ ] Google API rate limits are respected (max 2 concurrent calls)

---

## 6. Cron 2 — Daily Cache Cleanup

### 6.1 Purpose

Remove expired rows from `google_places_cache` to prevent unbounded table growth.

### 6.2 Implementation

**Existing SQL function:** `cleanup_expired_places_cache()` already exists (migration 20260301000001).

**New:** Add pg_cron schedule:

```sql
SELECT cron.schedule(
  'cleanup-expired-cache',
  '0 4 * * *',  -- Daily at 04:00 UTC
  $$SELECT cleanup_expired_places_cache()$$
);
```

### 6.3 Acceptance Criteria

- [ ] Expired cache entries (expires_at < now()) are deleted daily
- [ ] Function logs number of rows deleted
- [ ] No impact on active cache entries

---

## 7. Cron 3 — Daily Stale Place Deactivation

### 7.1 Purpose

Mark places as `is_active = false` when they haven't been refreshed in 7 days AND have 3+ refresh failures. This prevents serving closed/dead places.

### 7.2 Implementation

**Existing SQL function:** `deactivate_stale_places()` already exists (migration 20260301000002).

**New:** Add pg_cron schedule:

```sql
SELECT cron.schedule(
  'deactivate-stale-places',
  '30 4 * * *',  -- Daily at 04:30 UTC
  $$SELECT deactivate_stale_places()$$
);
```

### 7.3 Downstream Effect

When a place is deactivated:
- Its cards in `card_pool` should also be excluded from serving
- `query_pool_cards` RPC already filters `is_active = true` on the `card_pool` table
- **Verify:** Does `card_pool.is_active` cascade from `place_pool.is_active`? **Open question — check schema.**
  - If YES: no change needed
  - If NO: Add a trigger or update the deactivation function to also set `card_pool.is_active = false` for affected cards

### 7.4 Acceptance Criteria

- [ ] Places with `last_detail_refresh < now() - 7 days` AND `refresh_failures >= 3` are deactivated daily
- [ ] Deactivated places' cards are excluded from pool serving
- [ ] Function logs number of places deactivated
- [ ] Active places with recent refreshes are NOT affected

---

## 8. Cron 4 — Weekly Impression Cleanup

### 8.1 Purpose

Remove `user_card_impressions` older than 30 days to keep the impression-exclusion query fast.

### 8.2 Implementation

**Existing SQL function:** `cleanup_stale_impressions()` exists.

**New:** Add pg_cron schedule:

```sql
SELECT cron.schedule(
  'cleanup-stale-impressions',
  '0 5 * * 0',  -- Weekly on Sunday at 05:00 UTC
  $$SELECT cleanup_stale_impressions()$$
);
```

### 8.3 Acceptance Criteria

- [ ] Impressions older than 30 days are deleted weekly
- [ ] Function logs number of rows deleted
- [ ] Recent impressions are NOT affected (user doesn't see duplicate cards)

---

## 9. Cron 5 — Daily Place Detail Refresh

### 9.1 Purpose

Refresh place details (hours, rating, photos, price level) for active places to keep data fresh. Uses Google Places Details API (Place Details (Basic) is free, Details (Advanced) is $0.025/call).

### 9.2 Implementation

**New edge function:** `cron-refresh-places`

```
Query place_pool WHERE:
  is_active = true
  AND last_detail_refresh < now() - interval '24 hours'
ORDER BY last_detail_refresh ASC
LIMIT 500  -- Process 500 places per run

For each place:
  1. Call Google Places Details API (v1/places/{placeId})
     with fieldMask: displayName,rating,userRatingCount,regularOpeningHours,photos,priceLevel,businessStatus
  2. If businessStatus = 'CLOSED_PERMANENTLY': deactivate place
  3. If success: update place_pool row, set last_detail_refresh = now(), refresh_failures = 0
  4. If failure: increment refresh_failures
  5. Rate limit: max 5 concurrent calls
```

**Google API Budget:**
- 500 places/day × $0.025/call (Advanced) = $12.50/day = $375/month
- Alternative: Use Basic fields only ($0.00/call) for hours + rating
- **Recommendation:** Use Basic fields (free tier) for v1

**Schedule:**

```sql
SELECT cron.schedule(
  'refresh-place-details',
  '0 6 * * *',  -- Daily at 06:00 UTC
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/cron-refresh-places',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
  )$$
);
```

### 9.3 Acceptance Criteria

- [ ] 500 most-stale active places are refreshed daily
- [ ] Permanently closed places are deactivated
- [ ] `last_detail_refresh` and `refresh_failures` are updated
- [ ] Google API rate limits are respected
- [ ] Failed refreshes increment failure counter (don't crash the run)
- [ ] Function completes within 15 minutes

---

## 10. Pool Eviction — 30-Day Inactive Card TTL

### 10.1 Purpose

Remove cards from `card_pool` that haven't been served to ANY user in 30 days. Prevents unbounded growth.

### 10.2 Implementation

**New SQL function:**

```sql
CREATE OR REPLACE FUNCTION evict_inactive_cards()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH inactive_cards AS (
    SELECT cp.id
    FROM card_pool cp
    LEFT JOIN user_card_impressions uci ON uci.card_pool_id = cp.id
      AND uci.created_at > now() - interval '30 days'
    WHERE cp.created_at < now() - interval '30 days'
      AND uci.id IS NULL  -- No impressions in last 30 days
  )
  DELETE FROM card_pool
  WHERE id IN (SELECT id FROM inactive_cards);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE LOG 'evict_inactive_cards: deleted % cards', deleted_count;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
```

**Schedule:**

```sql
SELECT cron.schedule(
  'evict-inactive-cards',
  '0 7 1 * *',  -- Monthly on 1st at 07:00 UTC
  $$SELECT evict_inactive_cards()$$
);
```

### 10.3 Safety Guardrails

- Only evicts cards older than 30 days with ZERO impressions in that period
- Cards that are actively being served are never evicted
- `place_pool` entries are NOT evicted (they're shared infrastructure; only deactivated via stale check)
- Add a `max_eviction_count` guard: `LIMIT 10000` on the DELETE to prevent runaway deletion

### 10.4 Acceptance Criteria

- [ ] Cards with no impressions in 30 days AND older than 30 days are deleted monthly
- [ ] Cards with recent impressions are NOT deleted
- [ ] Max 10,000 cards evicted per run (safety limit)
- [ ] Function logs count of evicted cards
- [ ] `place_pool` entries are unaffected

---

## 11. Monitoring and Observability

Each cron function should log structured output:

```json
{
  "cron": "warm-pool",
  "started_at": "2026-03-14T03:00:00Z",
  "completed_at": "2026-03-14T03:18:42Z",
  "duration_ms": 1122000,
  "cities_processed": 50,
  "cities_skipped": 2,
  "cards_added": 3847,
  "api_calls_made": 294,
  "errors": ["Phoenix: Google API 429 rate limited"]
}
```

### Alert Conditions (future — not in v1 scope)

- Warm pool fails for > 5 cities in a single run
- Cache cleanup deletes > 100,000 rows (unexpected growth)
- Place refresh has > 50% failure rate
- Any cron function takes > 45 minutes

---

## 12. Implementation Order

1. **Cron 2 (cache cleanup)** — Easiest, uses existing SQL function, 15 minutes
2. **Cron 3 (stale deactivation)** — Uses existing SQL function, verify cascade to card_pool, 30 minutes
3. **Cron 4 (impression cleanup)** — Uses existing SQL function, 15 minutes
4. **Cron 1 (pool warming)** — New edge function + targets table, 2-3 hours
5. **Cron 5 (place refresh)** — New edge function, 2-3 hours
6. **Pool eviction** — New SQL function + schedule, 1 hour

Steps 1-3 can ship immediately (use existing infrastructure). Steps 4-6 require new code.

---

## 13. Cost Estimate

| Cron | Frequency | Google API Calls | Cost/Month |
|------|-----------|-----------------|------------|
| Pool warming | Nightly | ~300 (mostly cache hits after week 1) | ~$50 steady state |
| Place refresh | Daily | 500 (Basic = free) | $0 |
| Cache cleanup | Daily | 0 | $0 |
| Stale deactivation | Daily | 0 | $0 |
| Impression cleanup | Weekly | 0 | $0 |
| Pool eviction | Monthly | 0 | $0 |
| **Total** | | | **~$50/month** |

---

## 14. Dependencies and Constraints

### Must Ship First
- SPEC_CARD_PIPELINE_RELIABILITY Fixes 1-3 (hasMore bug, deadline guard, state machine)
- Without Fix 2 (fast pool serve), pre-warming is wasted — the pool-first path must work reliably before investing in populating it

### Infrastructure Requirements
- **pg_cron extension** must be enabled on Supabase project (check: `SELECT * FROM pg_extension WHERE extname = 'pg_cron'`)
- If pg_cron is not available, fall back to **Supabase Database Webhooks** or **external cron** (GitHub Actions scheduled workflow calling edge function endpoints)
- Edge functions used by crons need longer timeout than default (300s vs 60s) — check Supabase plan limits

### Database Size Impact
- Pool warming adds ~4,000 cards per nightly run (50 cities × ~80 cards each)
- After 30 days: ~120,000 cards in pool (assuming no eviction overlap)
- With monthly eviction: steady state ~50,000–80,000 active cards
- Storage: ~50,000 cards × 5KB average = ~250MB — well within Supabase limits

---

## 15. Open Questions

1. **Is pg_cron enabled on the current Supabase project?** If not, what's the alternative scheduling mechanism? GitHub Actions? Supabase Database Webhooks?

2. **Does `card_pool.is_active` cascade from `place_pool.is_active`?** If not, the stale deactivation cron needs to update both tables.

3. **Should warm pool targets be user-density-driven?** Instead of static top 50 cities, should we warm based on where actual users are? **Recommendation:** Start static, add dynamic targeting in v2 based on user signup locations.

4. **What Google API quotas exist on the current API key?** Default is 5,000 requests/day. Pool warming + place refresh = ~800/day. Confirm there's headroom for user-triggered requests.

5. **Should place refresh use the free Basic fields or paid Advanced fields?** Basic (free) gives: displayName, rating, photos, regularOpeningHours, businessStatus. Advanced ($0.025) adds: reviews, editorial summary. **Recommendation:** Basic for v1.
