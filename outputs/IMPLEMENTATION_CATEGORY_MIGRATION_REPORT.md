# Implementation Report: Category System Migration (12 → 13 Categories)

**Date:** 2026-03-20
**Spec:** `outputs/FEATURE_CATEGORY_MIGRATION_SPEC.md`
**Status:** Complete — ready for testing

---

## 1. What Was There Before

- 12 categories: Nature, First Meet, Picnic (inconsistent slug), Drink, Casual Eats, Fine Dining, Watch (broad — included theaters/opera), Creative & Arts, Play, Wellness, Groceries & Flowers, Work & Business
- `categoryPlaceTypes.ts` used old display names as keys
- `seedingCategories.ts` had 5 entries with wrong `appCategory`/`appCategorySlug` mappings
- No concept of hidden categories — all 12 shown to users
- `query_pool_cards` had no Groceries exclusion

## 2. What Changed

### Database (Step 1)
- **New migration:** `supabase/migrations/20260320100000_category_migration_13.sql`
  - Renames `Nature` → `Nature & Views` in card_pool categories
  - Renames `Picnic` → `Picnic Park` in card_pool categories
  - Splits `Groceries & Flowers` → `Flowers` (florist) / `Groceries` (non-florist) in card_pool
  - Deactivates Work & Business-only cards, removes tag from multi-tagged cards
  - Same renames in place_pool.category
  - Migrates user profiles: `groceries_flowers` → `flowers`, removes `work_business`
  - Updates `query_pool_cards` with `AND NOT (cp.categories <@ v_hidden_categories)` on all 3 CTEs

### Backend Shared (Steps 2-3)
- **`_shared/categoryPlaceTypes.ts`** — Full rewrite:
  - 13 categories: `Nature & Views`, `First Meet`, `Picnic Park`, `Drink`, `Casual Eats`, `Fine Dining`, `Watch` (movie_theater only), `Live Performance` (NEW), `Creative & Arts`, `Play`, `Wellness`, `Flowers` (NEW), `Groceries` (NEW, hidden)
  - New exports: `HIDDEN_CATEGORIES`, `VISIBLE_CATEGORY_NAMES`
  - Updated `CATEGORY_ALIASES` with full backward compat (old slugs → new display names)
  - Updated `CATEGORY_EXCLUDED_PLACE_TYPES` with entries for all 13 categories including `Live Performance`, `Flowers`, `Groceries`
  - Refactored retail exclusions into shared `RETAIL_EXCLUSIONS` array

- **`_shared/seedingCategories.ts`** — 5 field updates:
  - `nature_views.appCategory`: `'Nature'` → `'Nature & Views'`
  - `picnic_park.appCategory`: `'Picnic'` → `'Picnic Park'`, `appCategorySlug`: `'picnic'` → `'picnic_park'`
  - `live_performance.appCategory`: `'Creative & Arts'` → `'Live Performance'`, `appCategorySlug`: `'creative_arts'` → `'live_performance'`
  - `flowers.appCategory`: `'Groceries & Flowers'` → `'Flowers'`, `appCategorySlug`: `'groceries_flowers'` → `'flowers'`
  - `groceries.appCategory`: `'Groceries & Flowers'` → `'Groceries'`, `appCategorySlug`: `'groceries_flowers'` → `'groceries'`

### Edge Functions (Step 4)
- **`generate-single-cards/index.ts`** — Updated `CATEGORY_FALLBACK_DESCRIPTIONS` to 13 categories
- **`discover-cards/index.ts`** — Added `HIDDEN_CATEGORIES` import + filter on resolved categories
- **`discover-experiences/index.ts`** — Updated `PREF_ID_TO_DISCOVER_CATEGORY` (15 entries with legacy compat), filtered `categoriesToFetch` through `HIDDEN_CATEGORIES`
- **`get-person-hero-cards/index.ts`** — Updated `INTENT_CATEGORY_MAP`: `picnic` → `picnic_park`, removed `groceries_flowers`/`work_business`, added `live_performance`

### Mobile Constants & Utils (Steps 5-6)
- **`constants/categories.ts`** — Removed `groceries_flowers` and `work_business` objects; added `live_performance` and `flowers` objects; renamed `nature.name` → `'Nature & Views'`; narrowed `watch` to movie_theater only; updated `getCategoryExperienceTypeCombinations` (renamed `picnic` → `picnic_park`, removed `groceries_flowers`, added `live_performance` and `flowers`)
- **`utils/categoryUtils.ts`** — Full rewrite: 13-slug `VALID_SLUGS`, `HIDDEN_CATEGORY_SLUGS`, `VISIBLE_CATEGORY_SLUGS`, updated all maps (readable names, icons, colors, slug lookups), `normalizeCategoryArray` migrates `groceries_flowers` → `flowers` and drops `work_business`
- **`constants/interestIcons.ts`** — Replaced `ShoppingCart`/`Briefcase` with `Music`/`Flower2`; updated `CATEGORY_ICON_MAP`
- **`constants/holidays.ts`** — Updated `INTENT_CATEGORY_MAP`: `picnic` → `picnic_park`, added `live_performance`, `flowers`

### Mobile Components (Step 6)
- **`PreferencesSheet.tsx`** — 12 pills: removed `groceries_flowers`/`work_business`, added `live_performance`/`flowers`, renamed `nature` label
- **`PreferencesSheet/PreferencesSections.tsx`** — Updated `CATEGORY_DESCRIPTIONS` (12 entries), `WIDE_CATEGORY_IDS` → `live_performance` + `creative_arts`
- **`CollaborationPreferences.tsx`** — Same pill updates as PreferencesSheet
- **`DiscoverScreen.tsx`** — Updated `CATEGORY_ICONS` and `ALL_CATEGORIES` arrays (kept old names as fallback entries)
- **`PersonHolidayView.tsx`** — Updated `CATEGORY_ICONS` map
- **`OnboardingFlow.tsx`** — Updated `getCategoryIcon()` function
- **`services/deckService.ts`** — Updated `DeckResponse.deckMode` type, `PILL_TO_CATEGORY_NAME`, `CATEGORY_PILL_MAP` (added `nature & views`, `live_performance`, `flowers`; old slugs map to new)

## 3. Spec Compliance

| Spec Section | Status |
|-------------|--------|
| §7 — 13 categories Before/After table | ✅ All 13 match |
| §8.1 — categoryPlaceTypes.ts | ✅ Full rewrite |
| §8.2 — seedingCategories.ts | ✅ 5 field updates |
| §8.3 — generate-single-cards | ✅ Fallback descriptions |
| §8.4 — discover-cards | ✅ Hidden filter added |
| §8.5 — discover-experiences | ✅ PREF_ID map + hidden filter |
| §8.6 — get-personalized-cards | ✅ No changes needed (uses resolveCategory) |
| §8.7 — get-holiday-cards | ✅ No changes needed (uses resolveCategory) |
| §8.8 — get-person-hero-cards | ✅ INTENT_CATEGORY_MAP updated |
| §8.9 — cardPoolService | ✅ No changes needed |
| §8.10 — query_pool_cards SQL | ✅ `<@` hidden category exclusion |
| §9.1 — categories.ts | ✅ Live Performance + Flowers added |
| §9.2 — categoryUtils.ts | ✅ Full rewrite |
| §9.3 — PreferencesSheet | ✅ 12 pills |
| §9.4 — PreferencesSections | ✅ Descriptions + wide IDs |
| §9.5 — Other mobile files | ✅ 6 additional files updated |
| §10.2 — Data backfill migration | ✅ Full SQL with card_pool, place_pool, profiles |

## 4. Deviations from Spec

1. **Added `Picnic`/`Nature` as backward-compat entries** in DiscoverScreen and PersonHolidayView icon maps — cards with old display names from DB will still get correct icons until the data migration runs.
2. **Refactored retail exclusions** in categoryPlaceTypes.ts into a shared `RETAIL_EXCLUSIONS` array — reduces duplication from ~12 copies to 1 shared + spread.
3. **`flower-outline` and `musical-notes-outline` icons** — Per spec §14.5-6, these need verification in the app's Ionicons set. If unavailable, fallback to `rose-outline`/`musical-note-outline`.

## 5. Known Limitations

1. **No new cards for Live Performance/Flowers categories yet** — these are new categories. Cards will only exist after running `generate-single-cards` for cities with the updated seeding config.
2. **Admin dashboard not updated** — per spec §6.1, this is a separate spec.
3. **Icon availability** — `flower-outline` and `musical-notes-outline` existence in the Ionicons version used by the app should be verified at runtime.

## 6. Files Inventory

### Created
- `supabase/migrations/20260320100000_category_migration_13.sql`

### Modified (Backend — 5 files)
- `supabase/functions/_shared/categoryPlaceTypes.ts`
- `supabase/functions/_shared/seedingCategories.ts`
- `supabase/functions/generate-single-cards/index.ts`
- `supabase/functions/discover-cards/index.ts`
- `supabase/functions/discover-experiences/index.ts`
- `supabase/functions/get-person-hero-cards/index.ts`

### Modified (Mobile — 10 files)
- `app-mobile/src/constants/categories.ts`
- `app-mobile/src/utils/categoryUtils.ts`
- `app-mobile/src/constants/interestIcons.ts`
- `app-mobile/src/constants/holidays.ts`
- `app-mobile/src/components/PreferencesSheet.tsx`
- `app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx`
- `app-mobile/src/components/CollaborationPreferences.tsx`
- `app-mobile/src/components/DiscoverScreen.tsx`
- `app-mobile/src/components/PersonHolidayView.tsx`
- `app-mobile/src/components/OnboardingFlow.tsx`
- `app-mobile/src/services/deckService.ts`

**Total: 1 new file, 16 modified files**

## 7. Handoff to Tester

Ready for brutal testing. Key areas to break:
1. Old user with `groceries_flowers` preference — does it resolve to Flowers?
2. Empty-prefs discover — do Groceries cards ever appear?
3. PreferencesSheet — exactly 12 pills, correct labels and icons?
4. Live Performance cards — do they appear after seeding?
5. All legacy slugs in the alias maps — do they resolve correctly?
6. `query_pool_cards` with `p_categories = '{}'` — no Groceries-only cards?
