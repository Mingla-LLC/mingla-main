# Implementor Prompt: Admin Pool Management — Phase 1 (Foundation)

## Spec

Read the full spec at `outputs/FEATURE_ADMIN_POOL_MANAGEMENT_SPEC.md`. This is a phased implementation. Phase 1 covers: database, shared config, edge function, and fixing admin-place-search.

## Phase 1 Scope

### Step 1: Database Migration
Create in ONE migration file:
- `seeding_cities` table (with google_place_id for Autocomplete validation)
- `seeding_tiles` table
- `seeding_operations` table (with error_details JSONB — see §8.3.1)
- Add columns to `place_pool`: city_id, country, seeding_category
- Create RPCs: `admin_edit_place` (SECURITY DEFINER), `admin_city_place_stats`, `admin_city_card_stats`
- Backfill `country` on existing places from address (last comma-separated part)
- RLS policies on all new tables
- Indexes per spec §8

### Step 2: `admin-seed-places` Edge Function
New file: `supabase/functions/admin-seed-places/index.ts`

3 actions:
- `generate_tiles` — compute tile grid from city center + radius, insert to seeding_tiles
- `preview_cost` — calculate cost estimate, enforce $70 hard cap (exceedsHardCap flag)
- `seed` — execute seeding per tile × category using Google Nearby Search with configs from seedingCategories.ts

Key requirements:
- Uses Nearby Search (NOT Text Search) with locationRestriction.circle
- 13 category configs from seedingCategories.ts (already exists)
- Post-fetch filters: reject closed permanently, reject no photos, reject global excluded types (gym, fitness_center, dog_park)
- No-rating places ARE allowed
- Selective upsert: only overwrite Google-sourced fields, preserve admin-edited fields
- Structured error logging per tile/category in error_details JSONB
- Sequential tiles within a category (100ms delay), parallel across categories (up to 4 concurrent)
- Timeout: 10s per Google API call via timeoutFetch

### Step 3: Fix `admin-place-search`
- Wire lat/lng/radius through as locationBias when provided
- Add businessStatus to field mask
- Add timeoutFetch wrapper

## Do NOT build in Phase 1
- Admin UI pages (Phase 2)
- Map view (Phase 2)
- Killing old pages (Phase 3)

## After Implementation

Report back with: migration file, edge function file, admin-place-search changes, and confirmation that:
1. Tiles generate correctly for a test city
2. preview_cost returns accurate estimates with $70 cap check
3. seed action calls Nearby Search (not Text Search)
4. Post-fetch filters work (no-photo rejected, closed rejected, no-rating ALLOWED)
5. Selective upsert preserves admin-edited fields
6. Error logging captures tile-level failures in error_details JSONB
