# Investigation Prompt: City/Country Contract (Block 4)

**Target skill:** Software and Code Architect (Investigator mode)
**Gate:** 1 (Audit)
**Block:** 4 — City/Country TEXT Contract + Seeding Independence

---

## Context

The README states that Pool Intelligence is seeding-independent — `place_pool.city`/`place_pool.country` and `card_pool.city`/`card_pool.country` are TEXT columns that support direct filtering without runtime `seeding_cities` dependency. But the original bug report flagged issues with new cards losing city data and admin pages potentially still depending on legacy UUID-based seeding tables.

We need to verify whether the city/country contract is actually honored end-to-end or if there are gaps.

---

## Investigation Scope

### A. City/Country Data Population

Trace how city and country get populated for EACH path that creates or updates records:

1. **place_pool** — when `admin-seed-places` inserts a new place, how does `city` and `country` get set? From Google Places API response? From the seeding_cities config? Is it always populated?

2. **card_pool** — when `generate-single-cards` creates a card, how does `city` and `country` get set? Copied from `place_pool`? Computed? Can it be NULL?

3. **card_pool (curated)** — when `generate-curated-experiences` creates a curated card, how does `city` and `country` get set? Curated cards may span multiple places. Which place's city/country wins?

4. **Backfill** — was there a backfill migration for existing place_pool/card_pool rows? Search for migrations that populate city/country columns. Are there NULL gaps?

### B. Seeding Dependencies

Search for every remaining runtime reference to `seeding_cities` and `seeding_tiles` tables outside of the seeding pipeline itself:

1. **Pool Intelligence RPCs** — do any of the admin RPCs (`admin_country_overview`, `admin_country_city_overview`, `admin_pool_category_health`, etc.) JOIN to `seeding_cities`? They should use `place_pool.city`/`place_pool.country` directly.

2. **Card Pool Management page** — does `CardPoolManagementPage.jsx` reference `seeding_cities` anywhere? City selector, gap analysis, readiness checks?

3. **discover-cards / query_pool_cards** — does the card serving pipeline reference `seeding_cities` at all?

4. **Any other edge function or service** — search broadly for `seeding_cities` and `seeding_tiles` outside of `admin-seed-places` and the seeding UI tab.

### C. City/Country Data Quality

1. **Can city or country be NULL?** — check column constraints. Are they NOT NULL? If not, how many NULLs exist in practice?

2. **Format consistency** — are city names stored consistently? (e.g., "Raleigh" vs "raleigh" vs "Raleigh, NC"). Same for country. Is there normalization?

3. **Google Places address parsing** — when a place is seeded, how is the city extracted from the Google response? `addressComponents`? `formattedAddress`? Is it reliable?

4. **card_pool.city/country propagation** — when a place_pool record's city changes (e.g., admin edit), does the card_pool record update? Is there a trigger or cascade?

### D. Admin Card Pool Page — City Dependency

1. **City selector** — how does the Card Pool Management page get its list of available cities? From `seeding_cities`? Or from `DISTINCT card_pool.city`?

2. **Gap analysis** — the cross-city comparison tab shows places/cards/photos per city. Where does it get city data from?

3. **Generation** — when generating cards from the admin UI, does it pass city as a filter? How?

4. **Readiness checks** — the launch readiness checklist references city. Where does it get the city context?

---

## Files to Search

### Database
- Search migrations for `place_pool.city`, `place_pool.country`, `card_pool.city`, `card_pool.country` column definitions, NOT NULL constraints, backfills
- Search for any migration that references `seeding_cities` in a JOIN that isn't part of the seeding pipeline

### Edge Functions
- `supabase/functions/admin-seed-places/index.ts` — how city/country are set on place_pool insert
- `supabase/functions/generate-single-cards/index.ts` — how city/country are set on card_pool insert
- `supabase/functions/generate-curated-experiences/index.ts` — how city/country are set on curated card insert
- Search ALL edge functions for `seeding_cities` references

### Admin
- `mingla-admin/src/pages/CardPoolManagementPage.jsx` — city selector, generation, gap analysis
- `mingla-admin/src/pages/PoolIntelligencePage.jsx` — city/country navigation
- `mingla-admin/src/pages/PlacePoolManagementPage.jsx` — city dependency

### RPCs
- All `admin_*` RPCs in migrations — check for `seeding_cities` JOINs

---

## Output Format

Write to `outputs/INVESTIGATION_CITY_COUNTRY_CONTRACT.md` with:

1. **City/Country Population Map** — for each path (seed, single-card gen, curated gen), exactly how city/country are set, whether they can be NULL, and what format they use

2. **Seeding Dependency Inventory** — every file that references `seeding_cities` or `seeding_tiles`, classified as:
   - CORRECT (seeding pipeline, expected)
   - VIOLATION (runtime dependency that should use city/country TEXT)
   - HARMLESS (comments, old migrations that ran once)

3. **Data Quality Assessment** — NULL counts, format consistency, propagation gaps

4. **Admin Page City Source** — where each admin page gets its city list and whether it's seeding-dependent

5. **Gaps Found** — specific issues with the city/country contract

6. **Recommendations** — what to fix, prioritized

Label everything as FACT / INFERENCE / RECOMMENDATION.
