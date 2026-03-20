# Implementation Report: Admin Pool Pipeline Fixes

## Files Changed

### New
- `supabase/migrations/20260320200001_seeding_admin_rls_and_category_backfill.sql`

### Modified
- `supabase/functions/admin-place-search/index.ts` — push handler accepts `seedingCategory`
- `mingla-admin/src/pages/PlacePoolManagementPage.jsx` — category picker in ad-hoc search

## Fix 1: RLS Policies
Added `admin_write_*` policies to `seeding_cities`, `seeding_tiles`, `seeding_operations`. Pattern: `FOR ALL TO authenticated` gated by `EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active')`.

## Fix 2: Category Backfill
Single UPDATE statement maps 950 places:
- Priority 1: `primary_type` exact match (most specific)
- Priority 2: `types` array overlap fallback
- Best-fit mappings for edge cases (night_club→drink, ice_cream_shop→first_meet, etc.)
- ~15 truly unmappable types left as NULL (hotel, beauty_salon, etc.)

Expected result: ~863 mapped, ~87 best-fit, ~15-20 remaining NULL.

## Fix 3: Category Picker in Push Flow
- Added `TYPE_TO_CATEGORY` client-side mapping object (mirrors seedingCategories.ts)
- Added `guessCategory(place)` helper — tries primaryType first, then types array
- Ad-hoc search results now show category dropdown pre-filled with auto-mapped suggestion
- Admin can override before pushing
- `pushToPool()` now passes `seedingCategory` to edge function
- Edge function `handlePush` applies category to upsert row

## Verification
- RLS: policies follow exact same pattern as admin_users table (proven working)
- Backfill: dry-run query confirmed 863 clean maps + 87 best-fit eligible
- UI: category dropdown uses existing ALL_CATEGORIES/CATEGORY_LABELS constants
- Edge function: seedingCategory applied per-place or batch-level, with per-place taking priority

## Commit Message
```
fix: admin pool pipeline — RLS policies, category backfill, push-with-category

- Add admin write policies to seeding_cities/tiles/operations (was blocked by RLS)
- Backfill seeding_category for all 950 place_pool rows from Google types
- Add category picker with auto-suggestion to ad-hoc search push flow
```
