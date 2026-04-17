# SPEC: ORCH-0434 Preferences Simplification

**Version:** 1.0
**Date:** 2026-04-15
**Status:** Awaiting Review
**Source:** DESIGN_ORCH-0434 + INVESTIGATION Phase 1 + Phase 2 Pipeline Trace
**Phases:** 9 (each independently deployable and testable)

---

## Scope

Restructure the entire preferences/discovery system: collapse 13 categories to 8, remove budget and time-slot filters from user preferences, redesign the preferences sheet and onboarding flow, migrate all existing user data, and update the admin dashboard. ~55 files across mobile, backend, and admin.

## Non-Goals

- Changing the 5-stage pipeline architecture (Seed → AI Validate → Generate Cards → Serve → Curate)
- Fixing the pre-existing 3-way aggregator discrepancy on `travel_constraint_value` (median vs max vs min)
- Consolidating `experiencesService.ts` into `preferencesService.ts` (optional Phase 9 task, not required)
- Card design changes (price tier pills as sub-filters — deferred to future initiative)
- Changing price tier definitions on places (chill/comfy/bougie/lavish stay as-is on `place_pool` and `card_pool`)

---

## Global Invariants (Must Hold Across ALL Phases)

| ID | Invariant | Verification |
|---|---|---|
| INV-1 | Cards continue to serve correctly at every phase boundary | Query `discover-cards` after each phase, verify non-empty response |
| INV-2 | No user loses their preference selections — migration preserves intent | `SELECT COUNT(*) FROM preferences WHERE categories = '{}'` = 0 after migration |
| INV-3 | Solo and collab modes both work identically | Test both modes after each UI phase |
| INV-4 | Deployed mobile app (pre-OTA) continues to function during Phase 1-3 | Old slugs still resolve via backward-compat CASE table |
| INV-5 | No place is orphaned — every `ai_categories` value maps to a valid slug | `SELECT DISTINCT unnest(ai_categories) FROM place_pool` returns only valid slugs |
| INV-6 | Curated experiences still generate — no combo references a nonexistent slug | Run `generate-curated-experiences` for all 6 types, verify non-error response |

---

## Phase Dependencies

```
Phase 1 (DB) ──→ Phase 2 (Shared Libs) ──→ Phase 3 (Edge Functions)
                                                    │
Phase 4 (Constants/Types) ◄─────────────────────────┘
     │
Phase 5 (Services/Hooks) ◄── Phase 4
     │
Phase 6 (Preferences Sheet) ◄── Phase 5
Phase 7 (Onboarding) ◄── Phase 5
Phase 8 (Admin) ◄── Phase 1
     │
Phase 9 (Cleanup) ◄── ALL previous phases verified
```

Phase 4 can start after Phase 3 is deployed.
Phase 6, 7, 8 can run in parallel after Phase 5.
Phase 9 runs last, after all others are verified.

---

# PHASE 1: Database Foundation

## Scope

Add new columns, migrate all slug data across 5 tables, update 3 RPCs. No application code changes. The deployed mobile app must continue working throughout.

## Files

- New migration file: `supabase/migrations/2026MMDD_orch0434_phase1_slug_migration.sql`

## 1.1 New Columns

```sql
-- preferences table
ALTER TABLE preferences
  ADD COLUMN IF NOT EXISTS intent_toggle boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS category_toggle boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS selected_dates date[] DEFAULT NULL;

-- board_session_preferences table
ALTER TABLE board_session_preferences
  ADD COLUMN IF NOT EXISTS intent_toggle boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS category_toggle boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS selected_dates date[] DEFAULT NULL;
```

## 1.2 Slug Migration — User Preferences

```sql
-- Step 1: Slug renames on preferences.categories
UPDATE preferences SET categories = (
  SELECT array_agg(DISTINCT
    CASE slug
      WHEN 'nature_views' THEN 'nature'
      WHEN 'picnic_park' THEN 'nature'
      WHEN 'drink' THEN 'drinks_and_music'
      WHEN 'first_meet' THEN 'icebreakers'
      WHEN 'casual_eats' THEN 'brunch_lunch_casual'
      WHEN 'fine_dining' THEN 'upscale_fine_dining'
      WHEN 'watch' THEN 'movies_theatre'
      WHEN 'live_performance' THEN 'movies_theatre'
      WHEN 'wellness' THEN NULL  -- removed
      WHEN 'flowers' THEN NULL   -- hidden from user prefs
      ELSE slug
    END
  )
  FROM unnest(categories) AS slug
  WHERE CASE slug
    WHEN 'wellness' THEN false
    WHEN 'flowers' THEN false
    ELSE true
  END
)
WHERE categories IS NOT NULL AND array_length(categories, 1) > 0;

-- Step 2: Handle empty arrays (users who had only wellness/flowers)
UPDATE preferences
SET categories = ARRAY['nature', 'drinks_and_music', 'icebreakers']
WHERE categories IS NULL OR categories = '{}' OR array_length(categories, 1) = 0;

-- Step 3: Same for intents column (no slug changes, but remove any stale values)
-- Intents are unchanged: adventurous, first-date, romantic, group-fun, picnic-dates, take-a-stroll

-- Step 4: Remove flowers from preferences.categories (hidden from users)
UPDATE preferences
SET categories = array_remove(categories, 'flowers')
WHERE 'flowers' = ANY(categories);

-- Recheck empties after flowers removal
UPDATE preferences
SET categories = ARRAY['nature', 'drinks_and_music', 'icebreakers']
WHERE categories = '{}' OR array_length(categories, 1) = 0;
```

## 1.3 Slug Migration — Display Categories

`display_categories` stores display NAMES, not slugs.

```sql
UPDATE preferences SET display_categories = (
  SELECT array_agg(DISTINCT
    CASE name
      WHEN 'Picnic Park' THEN 'Nature & Views'
      WHEN 'Drink' THEN 'Drinks & Music'
      WHEN 'First Meet' THEN 'Icebreakers'
      WHEN 'Casual Eats' THEN 'Brunch, Lunch & Casual'
      WHEN 'Fine Dining' THEN 'Upscale & Fine Dining'
      WHEN 'Watch' THEN 'Movies & Theatre'
      WHEN 'Live Performance' THEN 'Movies & Theatre'
      WHEN 'Wellness' THEN NULL
      WHEN 'Flowers' THEN NULL
      ELSE name
    END
  )
  FROM unnest(display_categories) AS name
  WHERE name NOT IN ('Wellness', 'Flowers')
)
WHERE display_categories IS NOT NULL AND array_length(display_categories, 1) > 0;
```

## 1.4 Slug Migration — Board Session Preferences

```sql
-- Same slug migration as preferences.categories
UPDATE board_session_preferences SET categories = (
  SELECT array_agg(DISTINCT
    CASE slug
      WHEN 'nature_views' THEN 'nature'
      WHEN 'picnic_park' THEN 'nature'
      WHEN 'drink' THEN 'drinks_and_music'
      WHEN 'first_meet' THEN 'icebreakers'
      WHEN 'casual_eats' THEN 'brunch_lunch_casual'
      WHEN 'fine_dining' THEN 'upscale_fine_dining'
      WHEN 'watch' THEN 'movies_theatre'
      WHEN 'live_performance' THEN 'movies_theatre'
      WHEN 'wellness' THEN NULL
      WHEN 'flowers' THEN NULL
      ELSE slug
    END
  )
  FROM unnest(categories) AS slug
  WHERE slug NOT IN ('wellness', 'flowers')
)
WHERE categories IS NOT NULL AND array_length(categories, 1) > 0;
```

## 1.5 Slug Migration — Place Pool

```sql
-- ai_categories: array column
UPDATE place_pool SET ai_categories = (
  SELECT array_agg(DISTINCT
    CASE slug
      WHEN 'nature_views' THEN 'nature'
      WHEN 'picnic_park' THEN 'nature'
      WHEN 'drink' THEN 'drinks_and_music'
      WHEN 'first_meet' THEN 'icebreakers'
      WHEN 'casual_eats' THEN 'brunch_lunch_casual'
      WHEN 'fine_dining' THEN 'upscale_fine_dining'
      WHEN 'watch' THEN 'movies_theatre'
      WHEN 'live_performance' THEN 'movies_theatre'
      WHEN 'wellness' THEN NULL
      ELSE slug
    END
  )
  FROM unnest(ai_categories) AS slug
  WHERE slug != 'wellness'
)
WHERE ai_categories IS NOT NULL AND array_length(ai_categories, 1) > 0;

-- seeding_category: scalar column
UPDATE place_pool SET seeding_category = CASE seeding_category
  WHEN 'nature_views' THEN 'nature'
  WHEN 'picnic_park' THEN 'nature'
  WHEN 'drink' THEN 'drinks_and_music'
  WHEN 'first_meet' THEN 'icebreakers'
  WHEN 'casual_eats' THEN 'brunch_lunch_casual'
  WHEN 'fine_dining' THEN 'upscale_fine_dining'
  WHEN 'watch' THEN 'movies_theatre'
  WHEN 'live_performance' THEN 'movies_theatre'
  WHEN 'wellness' THEN NULL
  ELSE seeding_category
END
WHERE seeding_category IS NOT NULL;
```

## 1.6 Slug Migration — Card Pool

```sql
-- category: scalar TEXT (primary category)
UPDATE card_pool SET category = CASE category
  WHEN 'nature_views' THEN 'nature'
  WHEN 'picnic_park' THEN 'nature'
  WHEN 'drink' THEN 'drinks_and_music'
  WHEN 'first_meet' THEN 'icebreakers'
  WHEN 'casual_eats' THEN 'brunch_lunch_casual'
  WHEN 'fine_dining' THEN 'upscale_fine_dining'
  WHEN 'watch' THEN 'movies_theatre'
  WHEN 'live_performance' THEN 'movies_theatre'
  WHEN 'wellness' THEN 'brunch_lunch_casual'  -- fallback for orphaned wellness cards
  ELSE category
END
WHERE category IS NOT NULL;

-- categories: TEXT[] array
UPDATE card_pool SET categories = (
  SELECT array_agg(DISTINCT
    CASE slug
      WHEN 'nature_views' THEN 'nature'
      WHEN 'picnic_park' THEN 'nature'
      WHEN 'drink' THEN 'drinks_and_music'
      WHEN 'first_meet' THEN 'icebreakers'
      WHEN 'casual_eats' THEN 'brunch_lunch_casual'
      WHEN 'fine_dining' THEN 'upscale_fine_dining'
      WHEN 'watch' THEN 'movies_theatre'
      WHEN 'live_performance' THEN 'movies_theatre'
      WHEN 'wellness' THEN NULL
      ELSE slug
    END
  )
  FROM unnest(categories) AS slug
  WHERE slug != 'wellness'
)
WHERE categories IS NOT NULL AND array_length(categories, 1) > 0;
```

## 1.7 Slug Migration — Category Type Exclusions

```sql
UPDATE category_type_exclusions SET category = CASE category
  WHEN 'nature_views' THEN 'nature'
  WHEN 'picnic_park' THEN 'nature'
  WHEN 'drink' THEN 'drinks_and_music'
  WHEN 'first_meet' THEN 'icebreakers'
  WHEN 'casual_eats' THEN 'brunch_lunch_casual'
  WHEN 'fine_dining' THEN 'upscale_fine_dining'
  WHEN 'watch' THEN 'movies_theatre'
  WHEN 'live_performance' THEN 'movies_theatre'
  WHEN 'wellness' THEN 'brunch_lunch_casual'
  ELSE category
END;

-- Deduplicate after merge (nature_views + picnic_park both became nature)
DELETE FROM category_type_exclusions a
USING category_type_exclusions b
WHERE a.ctid < b.ctid
  AND a.category = b.category
  AND a.excluded_type = b.excluded_type;
```

## 1.8 RPC: `query_pool_cards` — Updated

The full RPC is rewritten with:
- **Category CASE table:** accepts BOTH old and new slugs (backward compat for deployed app). All old slugs resolve to new canonical slugs.
- **Price filtering REMOVED:** entire `v_any_tier / v_use_tiers / v_price_exempt` block deleted from WHERE clause.
- **Parameters removed:** `p_budget_max`, `p_price_tiers` dropped from signature.
- **`v_hidden_categories`:** stays as `ARRAY['groceries', 'flowers']` (flowers now hidden).

New CASE table entries (backward compat — accepts old AND new):
```
'nature' → 'nature', 'nature_views' → 'nature', 'nature & views' → 'nature',
'picnic_park' → 'nature', 'picnic park' → 'nature', 'picnic' → 'nature',
'drinks_and_music' → 'drinks_and_music', 'drink' → 'drinks_and_music', 'drinks' → 'drinks_and_music', 'drinks & music' → 'drinks_and_music',
'icebreakers' → 'icebreakers', 'first_meet' → 'icebreakers', 'first meet' → 'icebreakers',
'brunch_lunch_casual' → 'brunch_lunch_casual', 'casual_eats' → 'brunch_lunch_casual', 'casual eats' → 'brunch_lunch_casual', 'brunch, lunch & casual' → 'brunch_lunch_casual',
'upscale_fine_dining' → 'upscale_fine_dining', 'fine_dining' → 'upscale_fine_dining', 'fine dining' → 'upscale_fine_dining', 'upscale & fine dining' → 'upscale_fine_dining',
'movies_theatre' → 'movies_theatre', 'watch' → 'movies_theatre', 'live_performance' → 'movies_theatre', 'live performance' → 'movies_theatre', 'movies & theatre' → 'movies_theatre',
'creative_arts' → 'creative_arts', 'creative & arts' → 'creative_arts',
'play' → 'play',
'wellness' → 'brunch_lunch_casual',  -- orphan fallback
'flowers' → 'flowers', 'groceries' → 'groceries'
```

## 1.9 RPC: `compute_taste_match` — Updated

Remove `price_tiers` from similarity calc. Reweight: 70% categories, 30% intents.

## 1.10 Success Criteria

| ID | Criterion | Verification |
|---|---|---|
| SC-1.1 | No `nature_views` exists in any `categories` column | `SELECT COUNT(*) FROM preferences WHERE 'nature_views' = ANY(categories)` = 0 |
| SC-1.2 | No `picnic_park` exists in user preferences | `SELECT COUNT(*) FROM preferences WHERE 'picnic_park' = ANY(categories)` = 0 |
| SC-1.3 | No `wellness` exists in any categories column | Same pattern, all tables |
| SC-1.4 | No `flowers` in user-facing preferences | `SELECT COUNT(*) FROM preferences WHERE 'flowers' = ANY(categories)` = 0 |
| SC-1.5 | `flowers` still in `place_pool.ai_categories` | `SELECT COUNT(*) FROM place_pool WHERE 'flowers' = ANY(ai_categories)` > 0 |
| SC-1.6 | No empty categories arrays | `SELECT COUNT(*) FROM preferences WHERE categories = '{}' OR categories IS NULL` = 0 |
| SC-1.7 | New columns exist | `SELECT intent_toggle, category_toggle, selected_dates FROM preferences LIMIT 1` succeeds |
| SC-1.8 | Old mobile app still works | Send old slugs `['nature','drink']` to `query_pool_cards`, get non-empty results |
| SC-1.9 | New slugs work | Send `['drinks_and_music','icebreakers']` to `query_pool_cards`, get non-empty results |
| SC-1.10 | Price filtering removed | Cards of ALL price tiers returned regardless of params |
| SC-1.11 | Display categories migrated | No `'Wellness'` or `'Flowers'` in display_categories |

## 1.11 Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1.1 | Old slug resolves | `p_categories = ARRAY['nature']` | Returns nature cards | RPC |
| T-1.2 | New slug resolves | `p_categories = ARRAY['drinks_and_music']` | Returns bar/club cards | RPC |
| T-1.3 | Mixed old+new | `p_categories = ARRAY['drink','icebreakers']` | Returns both | RPC |
| T-1.4 | Wellness user migrated | User had `['wellness']` only | Now has `['nature','drinks_and_music','icebreakers']` | DB |
| T-1.5 | Flowers user migrated | User had `['flowers','nature']` | Now has `['nature']` | DB |
| T-1.6 | Duplicate after merge | User had `['nature','picnic_park']` | Now has `['nature']` (deduplicated) | DB |
| T-1.7 | Display names migrated | User had `['Fine Dining','Watch']` | Now has `['Upscale & Fine Dining','Movies & Theatre']` | DB |
| T-1.8 | Price filter removed | RPC called without price params | All tiers returned | RPC |

## 1.12 Rollback Plan

All column additions are additive (no drops). Slug migration UPDATEs can be reversed with inverse CASE mapping. Save a snapshot before migration: `CREATE TABLE preferences_backup_0434 AS SELECT * FROM preferences;`

## 1.13 Implementation Order

1. Create backup tables
2. Add new columns (intent_toggle, category_toggle, selected_dates)
3. Run slug migration on preferences
4. Run slug migration on display_categories
5. Run slug migration on board_session_preferences
6. Run slug migration on place_pool (ai_categories, seeding_category)
7. Run slug migration on card_pool (category, categories)
8. Run slug migration on category_type_exclusions
9. Update query_pool_cards RPC
10. Update compute_taste_match RPC
11. Verify all success criteria

---

# PHASE 2: Backend Shared Libraries

## Scope

Update 5 shared TypeScript files used by all edge functions.

## Files & Changes

### `_shared/categoryPlaceTypes.ts`

**MINGLA_CATEGORY_PLACE_TYPES:** Remove `'Picnic Park'`, `'Wellness'` entries. Rename: `'Drink'` → `'Drinks & Music'`, `'First Meet'` → `'Icebreakers'`, `'Casual Eats'` → `'Brunch, Lunch & Casual'`, `'Fine Dining'` → `'Upscale & Fine Dining'`, `'Watch'` + `'Live Performance'` → `'Movies & Theatre'` (merge types arrays). Add `night_club`, `live_music_venue`, `karaoke` to `'Drinks & Music'`.

**CATEGORY_ALIASES:** Rewrite all ~60 entries. Keep old slugs as backward-compat aliases resolving to new display names. Add new slug aliases.

**DISPLAY_TO_SLUG / SLUG_TO_DISPLAY:** Full rewrite with new 10 entries (8 visible + flowers + groceries). `'Nature & Views': 'nature'` (NOT `nature_views`).

**HIDDEN_CATEGORIES:** `new Set(['Groceries', 'Flowers'])` (add Flowers).

**CATEGORY_EXCLUDED_PLACE_TYPES:** Rekey from old slugs to new. Merge `nature_views` + `picnic_park` exclusions into `nature`.

### `_shared/seedingCategories.ts`

Update `appCategorySlug` values:
- `nature_views` config → `appCategorySlug: 'nature'`
- `picnic_park` config → `appCategorySlug: 'nature'`
- `drink` config → `appCategorySlug: 'drinks_and_music'`, add `night_club`, `live_music_venue`, `karaoke` to `includedTypes`
- `first_meet` config → `appCategorySlug: 'icebreakers'`
- `casual_eats` config → `appCategorySlug: 'brunch_lunch_casual'`
- `fine_dining` config → `appCategorySlug: 'upscale_fine_dining'`
- `watch` config → `appCategorySlug: 'movies_theatre'`
- `live_performance` config → `appCategorySlug: 'movies_theatre'`
- `wellness` config → REMOVE entirely
- `creative_arts`, `play`, `flowers`, `groceries` → unchanged

### `_shared/cardPoolService.ts`

Remove from `PoolQueryParams`: `budgetMin`, `budgetMax`, `priceTiers`.
Remove from `queryPoolCards()` call: `p_budget_max`, `p_price_tiers` params.

### `_shared/scoringService.ts`

Remove `priceTiers` from `ScoringParams` interface.

### `_shared/stopAlternatives.ts`

`nature_views: 60` → `nature: 60`. Remove `picnic_park: 75`. Add `movies_theatre` with merged duration.

## Success Criteria

| ID | Criterion |
|---|---|
| SC-2.1 | `ALL_CATEGORY_NAMES` returns 10 names (8 visible + Flowers + Groceries) |
| SC-2.2 | `resolveCategory('drink')` returns `'Drinks & Music'` |
| SC-2.3 | `resolveCategory('nature_views')` returns `'Nature & Views'` (backward compat) |
| SC-2.4 | `DISPLAY_TO_SLUG['Nature & Views']` returns `'nature'` (NOT `nature_views`) |
| SC-2.5 | `HIDDEN_CATEGORIES` contains both `'Groceries'` and `'Flowers'` |
| SC-2.6 | No TypeScript compilation errors across all edge functions |

---

# PHASE 3: Edge Function Updates

## Scope

Update 12 edge functions. The most critical change is `filterByDateTime()` in `discover-cards`.

## Key Changes

### `discover-cards/index.ts`

**REMOVE:** `TIME_SLOT_RANGES`, `VALID_SLOTS`, `rawTimeSlot`/`rawTimeSlots` from request body parsing, `priceTiers`/`budgetMax` from request body parsing.

**MODIFY `filterByDateTime()`:** Simplify to 3 modes:
- `dateOption === 'today'`: check if place is open from current local time onwards (NOT just "right now" — include places opening later today)
- `dateOption === 'this_weekend'`: check Saturday + Sunday openness
- `dateOption === 'pick_dates'` + `selectedDates[]`: check if open on ANY selected date
- KEEP: `ALWAYS_OPEN_TYPES` bypass, Google periods parsing, text-based hours parsing
- ADD: `opening_hours IS NULL` → EXCLUDE card (hard rule from design spec)

**New request body params:** `selectedDates?: string[]` (ISO date strings).
**Removed request body params:** `timeSlot`, `timeSlots`, `priceTiers`, `budgetMax`.

### `generate-session-deck/index.ts`

**`AggregatedPrefs`:** Remove `priceTiers`, `budgetMin`, `budgetMax`, `timeSlots`. Add `selectedDates: string[]`.

**`aggregateAllPrefs()`:** Remove price tier union, budget min/max, timeSlots union. Add `selectedDates` union (all participants' dates merged).

**`computePreferencesHash()`:** Remove `priceTiers`, `budgetMin`, `budgetMax`, `timeSlots` from hash input. Add `selectedDates`.

**Request body to discover-cards:** Remove `budgetMax`, `priceTiers`, `timeSlots`. Add `selectedDates`.

**Request body to generate-curated-experiences:** Remove `budgetMin`, `budgetMax`.

### `generate-curated-experiences/index.ts`

**EXPERIENCE_TYPES combos:** Update ALL category slugs per Phase 2 investigation A1-A11 mapping.

**`aggregateSessionPreferences()`:** Remove `budgetMin`/`budgetMax` aggregation. Remove budget-related returns.

**Remove:** `perStopBudget` calculation, budget ceiling check (`if (totalMin > budgetMax) continue`).

**Keep:** Fine dining bougie gate, but change `catId === 'fine_dining'` → `catId === 'upscale_fine_dining'`.

**`CATEGORY_DURATION_MINUTES`:** Update keys with new slugs.

**Request body parsing:** Remove `budgetMin`, `budgetMax` from destructure (but keep accepting them silently for backward compat with deployed session-deck).

### `ai-verify-pipeline/index.ts`

**`VALID_SLUGS`:** New set: `"flowers","upscale_fine_dining","nature","icebreakers","drinks_and_music","brunch_lunch_casual","movies_theatre","creative_arts","play","groceries"`. Remove `wellness`, `nature_views`, `picnic_park`, `drink`, `first_meet`, `casual_eats`, `fine_dining`, `watch`, `live_performance`.

**GPT SYSTEM_PROMPT:** Rewrite category descriptions. Key new descriptions:
- `NATURE: Parks, gardens, scenic spots, picnic grounds, hiking trails, beaches. Absorbs former picnic_park.`
- `DRINKS_AND_MUSIC: Bars, pubs, cocktail lounges, nightclubs, live music venues, karaoke.`
- `ICEBREAKERS: Cafes, coffee shops, tea houses, bookstores, low-key first-date spots.`
- `BRUNCH_LUNCH_CASUAL: Any eating place that opens from 11:00 for daytime meals.`
- `UPSCALE_FINE_DINING: Restaurants priced comfy to lavish — upscale dining experiences.`
- `MOVIES_THEATRE: Cinemas, theatres, concert halls, performing arts venues.`

**`enforceExclusivity()`:** Change `fine_dining` → `upscale_fine_dining`, `casual_eats` → `brunch_lunch_casual`.

**Deterministic rules:** Update casual chain demotion and fine dining promotion with new slugs.

### Other Edge Functions

- `night-out-experiences/index.ts`: `categories: ['Drink']` → `categories: ['Drinks & Music']`
- `holiday-experiences/index.ts`: Update HOLIDAYS display names
- `discover-experiences/index.ts`: `HIDDEN_CATEGORIES = new Set(['groceries', 'flowers'])`
- `replace-curated-stop/index.ts`: Update category list
- `get-person-hero-cards/index.ts`: Remove `preference_type = 'time_of_day'` queries
- `admin-seed-map-strangers/index.ts`: Update ALL_INTENTS, category arrays

## Success Criteria

| ID | Criterion |
|---|---|
| SC-3.1 | `discover-cards` returns cards when called with `dateOption: 'today'` and no timeSlots |
| SC-3.2 | `discover-cards` returns cards with `dateOption: 'this_weekend'` |
| SC-3.3 | `discover-cards` returns cards with `dateOption: 'pick_dates'` + `selectedDates: ['2026-04-19']` |
| SC-3.4 | Cards without `opening_hours` are excluded from results |
| SC-3.5 | `generate-curated-experiences` generates cards for all 6 experience types with new slugs |
| SC-3.6 | `ai-verify-pipeline` assigns new slugs (not old) to new places |
| SC-3.7 | `generate-session-deck` produces a deck without referencing budget/timeSlots |

---

# PHASE 4: Mobile Constants & Types

## Scope

Update all constant files, type definitions, and utility functions in the mobile app. This phase produces TypeScript compilation errors that Phase 5 resolves.

## Files & Exact Changes

### `constants/categories.ts`

Rewrite the `categories` array: 12 → 8 entries. New slugs, display names, icons, colors, Google Places anchors, descriptions. Remove wellness, flowers (from visible array), picnic_park (merged into nature). Add drinks_and_music, icebreakers, brunch_lunch_casual, upscale_fine_dining, movies_theatre.

### `constants/priceTiers.ts`

Remove `PRICE_EXEMPT_CATEGORIES` export. Keep all other exports (PRICE_TIERS, PriceTierSlug, helpers).

### `constants/interestIcons.ts`

`CATEGORY_ICON_MAP`: 12 → 8 entries. New keys: `nature` (Trees), `drinks_and_music` (Wine/Music), `icebreakers` (Sparkles/Coffee), `brunch_lunch_casual` (UtensilsCrossed), `upscale_fine_dining` (ChefHat), `movies_theatre` (Film/Music), `creative_arts` (Palette), `play` (Gamepad2).

### `types/preferences.ts`

Remove from `UserPreferences`: `budget_min`, `budget_max`, `time_slot`, `price_tiers`.
Add: `intent_toggle: boolean`, `category_toggle: boolean`, `selected_dates: string[] | null`.
Keep `date_option` but document new allowed values: `'today' | 'this_weekend' | 'pick_dates'`.

### `types/onboarding.ts`

Remove `selectedPriceTiers` from `OnboardingData`.
Remove `'budget'` from `Step4SubStep` union. Add `'when'`.
Remove `DEFAULT_PRICE_TIERS`.
Update `DEFAULT_CATEGORIES` to `['nature', 'drinks_and_music', 'icebreakers']`.

### `utils/categoryUtils.ts`

`VALID_SLUGS`: new Set of 10 (8 visible + flowers + groceries).
`HIDDEN_CATEGORY_SLUGS`: add `'flowers'`.
`VISIBLE_CATEGORY_SLUGS`: 8 entries.
Rewrite alias maps — old slugs resolve to new (nature_views→nature, drink→drinks_and_music, etc.).
`normalizeCategoryArray`: handle old→new migration, deduplicate after merge.

### `utils/preferencesConverter.ts`

Remove `time_slot`/`time_slots` clearing from `normalizePreferencesForSave()`.
Remove `priceTiers`, `budgetRange` from `PreferencesSheetState`.
Add `intentToggle`, `categoryToggle`, `selectedDates`.

### `utils/sessionPrefsUtils.ts`

Remove from `AggregatedCollaborationPrefs`: `price_tiers`, `budget_min`, `budget_max`, `time_slot`/`timeSlots`.
Remove from `aggregateAllPrefs()`: price tier union, budget aggregation, time slot handling.
Update category slug defaults.

### `i18n/locales/en/preferences.json`

Remove `time_slots` section, `budget` section.
Update `category_descriptions` to 8 entries with new keys.
Add: `intents_toggle_title: "Want us to create experiences for you?"`, `categories_toggle_title: "See what's popular near you"`.
Update `date_options`: `today`, `this_weekend`, `pick_dates` with descriptions.

### All 28 other locale files

Same structural changes. Add new keys, remove old keys.

## Success Criteria

| ID | Criterion |
|---|---|
| SC-4.1 | `categories` array has exactly 8 entries |
| SC-4.2 | `VALID_SLUGS` has 10 entries |
| SC-4.3 | `normalizeCategoryArray(['nature_views','drink','wellness'])` returns `['nature','drinks_and_music']` |
| SC-4.4 | `UserPreferences` has no `budget_min`/`budget_max`/`time_slot`/`price_tiers` |
| SC-4.5 | `DEFAULT_CATEGORIES` is `['nature','drinks_and_music','icebreakers']` |

---

# PHASE 5: Mobile Services & Hooks

## Scope

Update all services and hooks that read/write/pass preferences. Resolves TypeScript compilation errors from Phase 4.

## Files

All files listed in the Phase 5 section of the spec prompt. Each file's exact changes are defined by the removed fields (budget_min, budget_max, price_tiers, time_slot, time_slots) and renamed slugs.

**Key patterns to apply across all files:**

1. Remove `priceTiers`, `budgetMin`, `budgetMax`, `timeSlots` from all function parameters, request bodies, and interface fields
2. Remove `time_slot`, `exact_time` from all DB write payloads
3. Update hardcoded category slug defaults from `['nature','casual_eats','drink']` to `['nature','drinks_and_music','icebreakers']`
4. Update `buildDeckQueryKey()` to exclude removed params
5. Update date_option mapping: `"Now"→"today"`, `"This Weekend"→"this_weekend"`, `"Pick a Date"→"pick_dates"`. Remove `"Today"` (merged with Now).

## Success Criteria

| ID | Criterion |
|---|---|
| SC-5.1 | TypeScript compiles with zero errors |
| SC-5.2 | App launches without crash |
| SC-5.3 | Preferences load correctly for existing user |
| SC-5.4 | Deck fetches cards with new category slugs |
| SC-5.5 | Collab session deck generates correctly |

---

# PHASE 6: Preferences Sheet Redesign

## Scope

Rewrite the preferences sheet UI: new section order, toggles, no budget/time slots.

## New Section Order

1. **Starting Point** — GPS toggle / custom address input
2. **When** — Today / This Weekend / Pick Date(s) with multi-day calendar
3. **Intents** — Toggle ("Want us to create experiences for you?") + mood pills
4. **Categories** — Toggle ("See what's popular near you") + 8 category pills
5. **Getting There** — Travel mode + travel limit

## Key UI Behaviors

- All sections animate in sequentially on sheet open (premium feel)
- Intent toggle default: ON. Category toggle default: ON.
- When toggled OFF: pills collapse with animation
- When toggled ON: at least 1 selection required
- Lock In button: context-aware, disabled until all active sections have selections
- Returning users: pre-filled with last selections, all sections visible
- Solo/collab: identical UI

## Success Criteria

| ID | Criterion |
|---|---|
| SC-6.1 | Sheet opens with 5 sections in correct order |
| SC-6.2 | No time slot pills visible anywhere |
| SC-6.3 | No budget/price tier section visible |
| SC-6.4 | 8 category pills shown (not 12) |
| SC-6.5 | Intent toggle collapses/expands pills |
| SC-6.6 | Category toggle collapses/expands pills |
| SC-6.7 | Lock In disabled when active section has 0 selections |
| SC-6.8 | Lock In saves correctly in solo mode |
| SC-6.9 | Lock In saves correctly in collab mode |
| SC-6.10 | Returning user sees their previous selections |

---

# PHASE 7: Onboarding Redesign

## Scope

Mirror the preferences sheet in the onboarding flow.

## Step 4 New Sub-Steps

`['celebration', 'when', 'categories', 'transport', 'travel_time']`

(Budget sub-step removed. "When" sub-step added before categories.)

## Key Changes

- Remove budget sub-step rendering entirely
- "When" sub-step: same 3 options as preferences sheet (Today / This Weekend / Pick Date(s))
- Categories sub-step: 8 categories (from `constants/categories.ts`)
- `handleSavePreferences`: remove price_tiers, budget_min, budget_max from write payload
- Fix EditInterestsSheet bug: `toggleCategory(cat.name)` → `toggleCategory(cat.slug)`

## Success Criteria

| ID | Criterion |
|---|---|
| SC-7.1 | Onboarding Step 4 has no budget sub-step |
| SC-7.2 | Onboarding Step 4 has "When" sub-step |
| SC-7.3 | Categories sub-step shows 8 tiles |
| SC-7.4 | handleSavePreferences writes no budget/price_tiers fields |
| SC-7.5 | EditInterestsSheet tracks by slug, not display name |
| SC-7.6 | Full onboarding flow completes without error |

---

# PHASE 8: Admin Dashboard

## Scope

Update 4 admin pages with new category slugs.

## Files & Changes

### `PlacePoolManagementPage.jsx`

`CATEGORY_COLORS`: 13 → 10 entries (8 visible + flowers + groceries) with new slug keys.
`CATEGORY_LABELS`: same reshape.
`TYPE_TO_CATEGORY`: update ~60 Google type mappings to new slugs. `night_club: "drinks_and_music"`, etc.
`ALL_CATEGORIES`: auto-derived from CATEGORY_LABELS.

### `CardPoolManagementPage.jsx`

Same updates as PlacePoolManagementPage (independent copy).

### `AIValidationPage.jsx`

Update 4 constants: category list, labels, colors, icons.

### `UserManagementPage.jsx`

Remove `time_slot` ProfileField display at 2 locations.

## Success Criteria

| ID | Criterion |
|---|---|
| SC-8.1 | Place Pool page loads with 10 categories |
| SC-8.2 | Card Pool page loads with new category labels |
| SC-8.3 | AI Validation page shows new category names |
| SC-8.4 | User Management page has no time_slot field |

---

# PHASE 9: Cleanup

## Scope

Drop deprecated columns, remove backward-compat, delete dead code.

## 9.1 Column Drops

```sql
ALTER TABLE preferences
  DROP COLUMN IF EXISTS budget_min,
  DROP COLUMN IF EXISTS budget_max,
  DROP COLUMN IF EXISTS time_slot,
  DROP COLUMN IF EXISTS exact_time,
  DROP COLUMN IF EXISTS time_slots,
  DROP COLUMN IF EXISTS price_tiers;

ALTER TABLE board_session_preferences
  DROP COLUMN IF EXISTS budget_min,
  DROP COLUMN IF EXISTS budget_max,
  DROP COLUMN IF EXISTS time_slot,
  DROP COLUMN IF EXISTS exact_time,
  DROP COLUMN IF EXISTS time_of_day,
  DROP COLUMN IF EXISTS price_tiers;
```

## 9.2 RPC Cleanup

Remove backward-compat old slug entries from `query_pool_cards` CASE table. Keep only new canonical slugs.

## 9.3 Dead Code Deletion (18 blocks from Phase 2 investigation Part G)

Delete all 18 identified dead code blocks: TIME_SLOT_RANGES, VALID_SLOTS, price tier section rendering, selectedPriceTiers state, budget sub-step, backCompatBudgetMax, PRICE_EXEMPT_CATEGORIES, calculateBudgetScore, time_slot migration shim, etc.

## 9.4 Backup Table Cleanup

```sql
DROP TABLE IF EXISTS preferences_backup_0434;
```

## Success Criteria

| ID | Criterion |
|---|---|
| SC-9.1 | `preferences` table has no budget_min/max, time_slot, exact_time, time_slots, price_tiers columns |
| SC-9.2 | `board_session_preferences` has same columns removed |
| SC-9.3 | No dead code blocks remain |
| SC-9.4 | Full app regression test passes |
| SC-9.5 | Old slugs no longer accepted by RPC (only new slugs) |

## Rollback Plan

Column drops are IRREVERSIBLE. Only execute Phase 9 after ALL previous phases are verified in production for at least 48 hours. Backup tables from Phase 1 provide last-resort recovery.

---

## `nature_views` Unification — Phase Assignment

All 21 locations from Phase 2 investigation Part H, assigned to phases:

| # | Location | Phase |
|---|---|---|
| H1 | `_shared/seedingCategories.ts` id field | Phase 2 |
| H2 | `_shared/categoryPlaceTypes.ts` SLUG_TO_DISPLAY | Phase 2 |
| H3 | `_shared/categoryPlaceTypes.ts` DISPLAY_TO_SLUG | Phase 2 |
| H4 | `generate-curated-experiences` combos | Phase 3 |
| H5 | `generate-curated-experiences` CATEGORY_DURATION_MINUTES | Phase 3 |
| H6 | `_shared/stopAlternatives.ts` durations | Phase 2 |
| H7 | `replace-curated-stop` category list | Phase 3 |
| H8 | `ai-verify-pipeline` VALID_SLUGS + prompt | Phase 3 |
| H9 | `deckService.ts` CATEGORY_PILL_MAP alias | Phase 5 |
| H10 | `priceTiers.ts` comment | Phase 4 |
| H11 | Migration RPC CASE table | Phase 1 |
| H12 | Migration `v_price_exempt` | Phase 1 (removed — no price filtering) |
| H13 | ~26 historical migrations | No change needed — superseded by Phase 1 RPC |
| H14 | `PlacePoolManagementPage.jsx` | Phase 8 |
| H15 | `CardPoolManagementPage.jsx` | Phase 8 |
| H16 | `AIValidationPage.jsx` | Phase 8 |
| H17 | i18n locale files `category_nature_views` key | Phase 4 |
| H18 | `card_pool.category` data | Phase 1 (SQL UPDATE) |
| H19 | `place_pool.ai_categories` data | Phase 1 (SQL UPDATE) |
| H20 | `card_pool.categories` data | Phase 1 (SQL UPDATE) |
| H21 | `category_type_exclusions` table data | Phase 1 (SQL UPDATE) |

**i18n key decision:** Add new keys (`category_nature`, `category_drinks_and_music`, etc.). Keep old keys (`category_nature_views`, etc.) for 1 release cycle as fallback, then remove in Phase 9.

---

## Regression Prevention

### Structural Safeguards

1. **Single source of truth for category slugs:** `_shared/categoryPlaceTypes.ts` (backend) and `constants/categories.ts` (mobile). All other files derive from these.
2. **Backward-compat CASE table:** Phases 1-8 accept old slugs. Phase 9 removes them. This gives the full OTA cycle for the mobile app to update.
3. **Backup tables:** Created in Phase 1, dropped in Phase 9. Provides rollback for data migration.

### Tests That Catch Regression

- `SELECT DISTINCT unnest(ai_categories) FROM place_pool` — verify only valid slugs exist
- `SELECT DISTINCT category FROM card_pool` — same
- `discover-cards` integration test with each new category slug
- `generate-curated-experiences` for all 6 experience types
- Full onboarding flow end-to-end
- Preferences sheet save in solo + collab modes
