# Tester Prompt: Category System Migration (12 → 13)

## What Was Implemented

16 files modified + 1 new. Full report at `outputs/IMPLEMENTATION_CATEGORY_MIGRATION_REPORT.md`. Spec at `outputs/FEATURE_CATEGORY_MIGRATION_SPEC.md`.

## What to Verify

### Data Migration (SQL)

1. Verify migration exists and backfills existing card_pool/place_pool rows with new category names
2. Verify picnic/picnic_park slug inconsistency is resolved — grep all data-touching code for both, should be consistent
3. Verify "Groceries & Flowers" split — old rows updated to either "Flowers" or "Groceries" as appropriate
4. Verify Work & Business removed — no cards or places with this category should be served
5. Verify query_pool_cards excludes Groceries-only single cards from regular results

### 13 Categories Correct

6. Count categories in seedingCategories.ts — must be exactly 13
7. Verify the 13: Nature & Views, First Meet, Picnic Park, Drink, Casual Eats, Fine Dining, Watch, Live Performance, Creative & Arts, Play, Wellness, Flowers, Groceries
8. Verify Work & Business is NOT in the list

### Groceries Hidden

9. Grep mobile `PreferencesSheet` for "Groceries" — should NOT appear as selectable
10. Grep mobile category pills for "Groceries" — should NOT appear
11. Verify Groceries cards are excluded from discover-cards single card results
12. Verify Groceries places still exist in place_pool (for curated picnic stops)

### New Categories Visible

13. Verify Live Performance appears in mobile category list
14. Verify Flowers appears in mobile category list
15. Verify both have icons assigned

### Renamed Categories

16. Verify "Nature & Views" (not "Nature") in all mobile-facing strings
17. Verify "Picnic Park" (not "Picnic") in all mobile-facing strings

### Backward Compatibility

18. Verify alias maps exist — old slugs (groceries_flowers, work_business, Nature, Picnic) resolve to new categories
19. Verify no TypeScript errors in changed files
20. Verify no unused imports

### Backend — All 8 Edge Functions

21. Verify all edge functions import categories from seedingCategories.ts (not hardcoded lists)
22. Verify picnic slug is consistent across discover-experiences, get-person-hero-cards, and any other function that had the inconsistency
23. Grep all edge functions for hardcoded "Groceries & Flowers" — should be ZERO
24. Grep all edge functions for "Work & Business" — should be ZERO (except alias maps)

## Output

Produce `outputs/TEST_REPORT_CATEGORY_MIGRATION.md` with pass/fail for each item.
