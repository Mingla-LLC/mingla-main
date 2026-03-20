# Tester Prompt: Admin Pool Management — Phase 1 (Foundation)

## What Was Implemented

Migration + edge function + admin-place-search fix. Full report from Implementor. Spec at `outputs/FEATURE_ADMIN_POOL_MANAGEMENT_SPEC.md` (§8, §9).

## Files to Test

- `supabase/migrations/20260320200000_admin_pool_management.sql`
- `supabase/functions/admin-seed-places/index.ts`
- `supabase/functions/admin-place-search/index.ts`

## Database Migration

1. Verify `seeding_cities` table exists with: id, google_place_id (UNIQUE), name, country, country_code, center_lat, center_lng, coverage_radius_km, tile_radius_m, status (CHECK), created_at, updated_at, UNIQUE(name, country)
2. Verify `seeding_tiles` table exists with: id, city_id (FK CASCADE), tile_index, center_lat, center_lng, radius_m, row_idx, col_idx, UNIQUE(city_id, tile_index)
3. Verify `seeding_operations` table exists with: id, city_id (FK CASCADE), tile_id (FK SET NULL), seeding_category, app_category, status (CHECK), all counter columns, estimated_cost_usd, error_message, error_details (JSONB), timestamps
4. Verify place_pool has: city_id (FK SET NULL), country, seeding_category columns
5. Verify RLS enabled on all 3 new tables
6. Verify service_role has ALL access on all 3 tables
7. Verify authenticated has SELECT on all 3 tables
8. Verify indexes exist: idx_seeding_tiles_city, idx_seeding_operations_city, idx_seeding_operations_status
9. Verify `admin_edit_place` RPC exists and is SECURITY DEFINER
10. Verify `admin_city_place_stats` RPC exists and returns JSONB
11. Verify `admin_city_card_stats` RPC exists and returns JSONB
12. Verify country backfill query exists (parses last comma-separated part of address)

## admin-seed-places Edge Function

### generate_tiles action
13. Verify it computes hex-grid tile centers from city center + radius
14. Verify tiles are filtered to within the coverage circle
15. Verify tiles are inserted to seeding_tiles with city_id FK
16. Verify existing tiles are deleted before regeneration (idempotent)

### preview_cost action
17. Verify cost calculation: tileCount × categoryCount × $0.032
18. Verify `exceedsHardCap: true` when estimate > $70
19. Verify `hardCapUsd: 70` in response

### seed action
20. Verify Google Nearby Search is called (NOT Text Search)
21. Verify request uses `locationRestriction.circle` with tile center + radius
22. Verify request uses `includedTypes` and `excludedPrimaryTypes` from seedingCategories.ts
23. Verify `rankPreference: "POPULARITY"` in request
24. Verify `places.businessStatus` in field mask
25. Verify post-fetch filter: reject CLOSED_PERMANENTLY
26. Verify post-fetch filter: reject no photos (photos null or empty)
27. Verify post-fetch filter: reject global excluded types (gym, fitness_center, dog_park)
28. Verify NO rejection for missing rating — no-rating places must be ALLOWED
29. Verify selective upsert: only Google-sourced fields overwritten, admin-edited fields preserved
30. Verify structured error logging: error_details JSONB with tile_id, category, error_type, http_status, response_body, message, timestamp
31. Verify sequential tile processing within a category (100ms delay)
32. Verify max 4 concurrent categories
33. Verify 10s timeout per Google API call
34. Verify `acknowledgeHardCap` required when cost > $70
35. Verify seeding_operations row created with all counters populated

## admin-place-search Fix

36. Verify locationBias added when lat/lng/radius provided
37. Verify businessStatus added to field mask
38. Verify timeoutFetch wrapper used
39. Verify refresh action removed

## Cross-cutting

40. No unused imports
41. No TypeScript/syntax errors
42. seedingCategories.ts is imported (not hardcoded category configs)

## Output

Produce `outputs/TEST_REPORT_ADMIN_POOL_PHASE1.md` with pass/fail for each item.
