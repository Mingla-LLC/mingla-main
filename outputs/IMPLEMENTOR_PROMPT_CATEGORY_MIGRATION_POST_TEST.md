# Implementor Prompt: Post-Test Fix + Commit + README Lock-in

## Fix

In `supabase/functions/discover-experiences/index.ts` line 135, add `&& !HIDDEN_CATEGORIES.has(c)` to the selectedCategories filter. A user with stale groceries in their profile could bypass the hidden category exclusion.

## Commit

```
feat: migrate category system from 12 to 13 — split Groceries/Flowers, add Live Performance, remove Work & Business

- Split "Groceries & Flowers" into Flowers (visible) + Groceries (hidden for curated picnic stops)
- Added Live Performance as own category (split from Watch)
- Renamed Nature → Nature & Views, Picnic → Picnic Park
- Removed Work & Business
- SQL migration backfills all existing data with new category names
- query_pool_cards excludes Groceries single cards from regular results
- Fixed picnic slug inconsistency across 3 edge functions
- Backward compatibility via 60+ alias maps — old slugs resolve correctly
- All 8 edge functions import from shared seedingCategories.ts
```

## README Lock-in

Add/update a "Category System" section:

1. **13 categories** — Nature & Views, First Meet, Picnic Park, Drink, Casual Eats, Fine Dining, Watch, Live Performance, Creative & Arts, Play, Wellness, Flowers, Groceries
2. **Groceries is hidden** — exists in system for curated picnic stops but never shown to users (not in preferences, not in category pills, excluded from regular card serving)
3. **Single source of truth** — all category definitions in seedingCategories.ts. No hardcoded lists elsewhere.
4. **Backward compatibility** — alias maps resolve old slugs (groceries_flowers, work_business, Nature, Picnic) to new categories. No user data breaks.
5. **Work & Business removed** — not a seeding category, not served.
