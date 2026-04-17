# Implementation Report: ORCH-0460 — Place Pipeline Accuracy Overhaul

**Status:** implemented, partially verified
**Date:** 2026-04-17
**Files changed:** 3
**Scope:** Sections 12-20 of `AUDIT_SEEDING_AND_VALIDATION_ACCURACY.md`

---

## Layman Summary

Every filter in the pipeline was only checking one field (`primary_type`) on each Google place while the real identity sat in the secondary `types` array. This caused five categories to let in wrong places (restaurants in Creative & Arts, bars in Movies & Theatre, tobacco/bars/play in Brunch/Lunch, sports parks/farms in Play, garden stores in Flowers).

Fixed by teaching the filters to check the full types array, splitting the restaurants config into 3 to accommodate 58 new world cuisine types, expanding fine dining coverage, tightening five category definitions in the GPT prompt, adding protective whitelists for upscale chains, removing the upscale↔casual exclusivity rule per user decision, and syncing exclusion lists between four previously drifted systems.

**Risk called out:** The Brunch, Lunch & Casual category will lose some places that used to qualify as "brunch_lunch_casual + drinks_and_music" (wine bars with food, bar & grills, etc.). They now keep drinks_and_music only. This is intentional per the user's "real restaurants only" decision.

---

## Files Changed

### File 1: `supabase/functions/_shared/seedingCategories.ts`

**What it did before:**
- 13 category configs
- casual_eats had 49 includedTypes (1 away from Google's 50-type cap)
- casual_eats included cafe, coffee_shop, food_court, deli
- fine_dining only had 8 includedTypes
- play did not exclude sports/farm/kids secondary types
- play did not search for golf types

**What it does now:**
- 14 category configs (casual_eats split into 3 for 50-type limit)
- casual_eats = 45 includedTypes (sit-down restaurants only)
- casual_eats_world = 50 types (afghani, african, argentinian, basque, bavarian, belgian, british, burmese, cajun, cambodian, cantonese, chilean, cuban, dim_sum, dutch, filipino, halal, hawaiian, hungarian, irish, israeli, japanese_curry, latin_american, malaysian, mongolian_barbecue, north_indian, pakistani, persian, polish, portuguese, russian, scandinavian, soul_food, south_american, etc.)
- casual_eats_extended = 15 types (south_indian, sri_lankan, swiss, taiwanese, tex_mex, tibetan, tonkatsu, ukrainian, yakiniku, yakitori, burrito, chicken_wings, taco, etc.)
- fine_dining = 32 includedTypes (added 24 cuisine types for upscale coverage)
- play excludedPrimaryTypes +18 (sports_club, athletic_field, playground, farm, ranch, community_center, stadium, etc.)
- play includedTypes +2 (golf_course, indoor_golf_course)
- Brunch, Lunch & Casual exclusion list extracted to shared const `BRUNCH_LUNCH_CASUAL_EXCLUDED` — referenced identically by all 3 casual configs so they can never drift
- casual_eats excludedPrimaryTypes +20 (hookah_bar, tobacco_shop, amusement types, community_center, sports types, farm, ranch, food_court, cafeteria, etc.)

**Why:** Audit Sections 12, 18, 19. Direct spec mapping.

**Lines changed:** ~140 (mostly additive)

---

### File 2: `supabase/functions/ai-verify-pipeline/index.ts`

**What it did before:**
- `FLOWERS_BLOCKED_TYPES` only checked `primary_type`, allowed garden stores through if Google tagged them as `primary_type: florist`
- No stripping logic for creative_arts, movies_theatre, brunch_lunch_casual, play
- `enforceExclusivity()` stripped brunch_lunch_casual whenever upscale_fine_dining was present (3 call sites)
- EXCLUSION_KEYWORDS had 12 categories, missing sports_recreation, community_civic, tobacco_hookah
- Kids keyword list had 12 patterns
- Only 1 fine dining promotion tier (VERY_EXPENSIVE + 4.0+ rating)
- No protection for upscale chains like Nobu/Morton's — demotion list could accidentally strip them
- RESTAURANT_TYPES had 42 cuisines
- GPT SYSTEM_PROMPT had 16 examples and 10 category definitions; it explicitly said upscale and casual are mutually exclusive; it accepted food halls as brunch_lunch_casual; it had loose definitions for creative_arts, movies_theatre, brunch_lunch_casual, play

**What it does now:**
- **5 new category-specific blocked type sets** — `CREATIVE_ARTS_BLOCKED_TYPES` (~55 types), `MOVIES_THEATRE_BLOCKED_TYPES` (~45 types), `BRUNCH_CASUAL_BLOCKED_TYPES` (~35 types), `PLAY_BLOCKED_SECONDARY_TYPES` (15 types), and `GARDEN_STORE_PATTERNS` (25 name patterns)
- **Types-array checks in deterministicFilter** — for creative_arts and movies_theatre, strip if `primary_type` is blocked; for brunch_lunch_casual, strip if any type in the `types` array is blocked AND primary_type is not a real restaurant type (preserves restaurants-with-bars); for play, strip if any type in `types` array is blocked (catches Bethesda Park type); for flowers, strip if any type in `types` is blocked OR if name matches garden store patterns (catches Home Depot, Lowe's, Bunnings, etc. tagged as florist)
- **3 new EXCLUSION_KEYWORDS categories** — sports_recreation (30 patterns including "recreation center", "athletic complex", "community pool", "sportplatz", "polideportivo"), community_civic (20 patterns including "community center", "civic center", "senior center", "town hall", "gemeindezentrum"), tobacco_hookah (12 patterns including "tobacco", "cigar lounge", "hookah lounge", "shisha", "nargile")
- **Expanded kids keywords** — from 12 to 37 patterns (added toddler, baby, bounce house, bouncy, trampoline park, ball pit, play center, playland, play zone, playland, funland, jungle gym, adventure playground, play space, little ones, mommy and me, fun zone, discovery zone, little explorers, tiny town, sensory play, kids kingdom, imagination station)
- **RESTAURANT_TYPES expanded** — from 42 to 57 (added basque_restaurant, persian_restaurant, scandinavian_restaurant, argentinian_restaurant, swiss_restaurant, european_restaurant, australian_restaurant, gastropub, dim_sum_restaurant, filipino_restaurant, soul_food_restaurant, cuban_restaurant, hawaiian_restaurant)
- **`enforceExclusivity()` function REMOVED entirely** per user decision (ORCH-0460) — a restaurant can now qualify for both upscale_fine_dining AND brunch_lunch_casual if genuinely serves both. All 3 call sites updated to pass categories through unchanged.
- **New `UPSCALE_CHAIN_PROTECTION` whitelist** — 24 chains (Nobu, Morton's, Nusr-Et, Perry's, Capital Grille, Ruth's Chris, Fleming's, Eddie V's, Del Frisco's, Mastro's, STK, BOA Steakhouse, Peter Luger, Smith & Wollensky, The Palm, Lawry's, Cut by Wolfgang, Bazaar, Jean-Georges, Le Bernardin, Eleven Madison, Alinea, Per Se, Salt Bae)
- **Casual chain demotion guard** — demotion only fires if name matches CASUAL_CHAIN_DEMOTION AND does NOT match UPSCALE_CHAIN_PROTECTION
- **Second fine dining promotion tier** — added PRICE_LEVEL_EXPENSIVE + rating >= 4.0 + RESTAURANT_TYPES → promote. Catches acclaimed restaurants at EXPENSIVE tier that don't hit VERY_EXPENSIVE.
- **GPT SYSTEM_PROMPT rewritten** — 5 category definitions tightened (BRUNCH_LUNCH_CASUAL = real restaurants only / no bars/food courts/tobacco/play/sports; UPSCALE_FINE_DINING = loosened to allow high-end tapas/bistros/wine bars with food; CREATIVE_ARTS = adds "A restaurant/bar/cafe/store is NEVER creative_arts"; MOVIES_THEATRE = adds "A bar with live music is drinks_and_music, NOT movies_theatre"; PLAY = adds "NO sports parks/recreation centers, NO farms, NO community centers"). Mutual exclusivity language removed. 8 new worked examples added (20 total): community center reject, seasonal farm reject, sports recreation reject, kids play center reject, wine bar stays drinks-only despite "gallery" in name, stadium bar & grill stays drinks-only despite food, Nobu accepts both upscale+casual, Le Bernardin accepts upscale-only.

**Why:** Audit Sections 13, 14, 15, 16, 17, 18, 19.

**Lines changed:** ~450 (mostly additive; deterministicFilter expanded with 5 stripping blocks)

---

### File 3: `supabase/functions/_shared/categoryPlaceTypes.ts`

**What it did before:**
- `CATEGORY_EXCLUDED_PLACE_TYPES` for Creative & Arts was missing restaurant/bar/cafe types
- Same for Movies & Theatre
- Brunch, Lunch & Casual exclusions were minimal
- Play exclusions missed playground, indoor_playground, sports_complex, farm, community_center
- Play includedTypes included indoor_playground, skateboard_park, cycling_park (kids/fitness)
- Nature on-demand list missed 9 types that seeding searches for
- Brunch on-demand list missed 20 world cuisine types
- Upscale on-demand list missed 20 cuisine types now in seeding
- Play on-demand list missed golf types
- EXCLUDED_VENUE_NAME_KEYWORDS had 25 patterns, missing 8 keywords that ai-verify already had

**What it does now:**
- **Creative & Arts exclusions** +24 types (restaurant, fine_dining_restaurant, wine_bar, cafe, coffee_shop, cocktail_bar, lounge_bar, pub, brewery, brewpub, beer_garden, sports_bar, hookah_bar, irish_pub, convenience_store, grocery_store, supermarket, hotel, motel, gas_station, bistro, diner, brunch_restaurant, breakfast_restaurant)
- **Movies & Theatre exclusions** +25 types (restaurant, fine_dining_restaurant, fast_food_restaurant, cafe, coffee_shop, tea_house, bakery, bar, cocktail_bar, wine_bar, lounge_bar, pub, brewery, brewpub, beer_garden, sports_bar, hookah_bar, irish_pub, night_club, gastropub, bistro, diner, convenience_store, hotel, motel, gym, fitness_center)
- **Brunch, Lunch & Casual exclusions** +30 types (hookah_bar, sports_bar, irish_pub, brewery, brewpub, beer_garden, pub, cocktail_bar, lounge_bar, wine_bar, winery, bar_and_grill, amusement_center, amusement_park, bowling_alley, video_arcade, go_karting_venue, paintball_center, miniature_golf_course, karaoke, casino, adventure_sports_center, community_center, sports_complex, sports_club, athletic_field, stadium, arena, swimming_pool, food_court, cafeteria, tobacco_shop, farm, ranch, campground)
- **Play exclusions** +15 types (indoor_playground, playground, childrens_camp, sports_complex, sports_club, athletic_field, swimming_pool, tennis_court, sports_coaching, sports_school, farm, ranch, community_center, dog_park, campground)
- **Play includedTypes cleaned** — removed `indoor_playground`, `skateboard_park`, `cycling_park`. Added `golf_course`, `indoor_golf_course`, `adventure_sports_center`.
- **Nature on-demand list** +11 types (vineyard, wildlife_park, wildlife_refuge, woods, mountain_peak, river, island, city_park, fountain, lake, marina)
- **Brunch on-demand list** +19 types (world cuisines from casual_eats_world/extended + bistro, gastropub, noodle_shop, hot_pot_restaurant, dim_sum_restaurant). Removed fast_food_restaurant.
- **Upscale on-demand list** +20 types (fondue_restaurant, persian, scandinavian, basque, argentinian, swiss, european, australian, british, indian, korean, thai, turkish, vietnamese, brazilian, peruvian, moroccan, fusion, gastropub, bistro)
- **Venue name keywords** +8 patterns (indoor playground, chuck e. cheese, enfants, kinder, bambini, infantil, splash pad, soft play)

**Why:** Audit Sections 10, 15, 16, 17, 18, 19. Sync gap between on-demand experience generation and seeding/AI systems.

**Lines changed:** ~100 (additive)

---

## Spec Traceability

| Spec Section | Criterion | Status | Evidence |
|-----|------|--------|----------|
| 12 | casual_eats split under 50-type limit | PASS | casual_eats=45, casual_eats_world=50, casual_eats_extended=15 (verified via AST count) |
| 13 | Garden store leak fixed via types-array + name patterns | PASS | `GARDEN_STORE_PATTERNS` + types-array check in flowers stripping at ai-verify-pipeline line ~700 |
| 14 | No external imports of enforceExclusivity | PASS | Grep across supabase/, app-mobile/, mingla-admin/ — only one comment reference remains |
| 15 | Play sports parks blocked | PASS | PLAY_BLOCKED_SECONDARY_TYPES + sports_recreation keyword group + play excludedPrimaryTypes expanded |
| 15 | Play farms blocked | PASS | farm, ranch in PLAY_BLOCKED_SECONDARY_TYPES + play excludedPrimaryTypes |
| 15 | Play kids' centers blocked | PASS | kids keywords expanded 12→37 + PLAY_BLOCKED_SECONDARY_TYPES.indoor_playground/childrens_camp + play excludedPrimaryTypes |
| 15 | Play community centers blocked | PASS | community_civic keyword group + community_center in PLAY_BLOCKED_SECONDARY_TYPES + play excludedPrimaryTypes |
| 16 | Creative Arts strips restaurants/bars/cafes | PASS | CREATIVE_ARTS_BLOCKED_TYPES + stripping block 7a in deterministicFilter |
| 17 | Movies & Theatre strips bars/cafes/restaurants | PASS | MOVIES_THEATRE_BLOCKED_TYPES + stripping block 7b in deterministicFilter |
| 18 | Brunch Lunch Casual = restaurants only | PASS | 4 non-restaurant types removed from seeding; 20 types added to exclusions; BRUNCH_CASUAL_BLOCKED_TYPES + stripping block 7c + real-restaurant guard; GPT prompt rewritten |
| 18 | Real restaurant guard preserves restaurants with bars | PASS | stripping block 7c checks `isRealRestaurant` before stripping |
| 19 | Upscale expanded with world cuisines | PASS | fine_dining seeding 8→32 types; RESTAURANT_TYPES 42→57 |
| 19 | UPSCALE_CHAIN_PROTECTION whitelist active | PASS | Constant defined; demotion guarded at line 576 |
| 19 | EXPENSIVE+4.0 promotion tier | PASS | Added after VERY_EXPENSIVE tier in deterministicFilter |
| 19 | No upscale/casual mutual exclusivity | PASS | enforceExclusivity function removed; all 3 call sites pass raw categories; GPT prompt updated with new examples |
| 10 | Venue name keywords synced | PASS | EXCLUDED_VENUE_NAME_KEYWORDS +8 patterns synced from ai-verify kids list |
| 3D | Sync on-demand lists with seeding | PASS | Nature +11, Brunch +19, Upscale +20, Play rebuilt |

---

## Verification

### Syntax check
```
supabase/functions/_shared/seedingCategories.ts: OK
supabase/functions/_shared/categoryPlaceTypes.ts: OK
supabase/functions/ai-verify-pipeline/index.ts: OK
```
(Parsed with TypeScript AST — no syntax errors in any of the 3 files.)

### Type-count validation (50-limit)
```
casual_eats: 45 ✓
casual_eats_world: 50 ✓   (exactly at limit)
casual_eats_extended: 15 ✓
fine_dining: 32 ✓
play: 16 ✓
[all 14 configs under limit]
```

### No orphan references
- `enforceExclusivity` — 0 live references across entire monorepo (supabase/, app-mobile/, mingla-admin/). Only the deletion comment remains.
- All new constants (`CREATIVE_ARTS_BLOCKED_TYPES`, `MOVIES_THEATRE_BLOCKED_TYPES`, `BRUNCH_CASUAL_BLOCKED_TYPES`, `PLAY_BLOCKED_SECONDARY_TYPES`, `GARDEN_STORE_PATTERNS`, `UPSCALE_CHAIN_PROTECTION`) — each has exactly 1 definition + 1 usage in `deterministicFilter()`.

### What's UNVERIFIED (needs runtime testing)
- **End-to-end seeding** — did not actually run a Google Places search with the new configs against a live city. Needs the tester to run a small seeding operation in a test city and inspect the `places_returned` counts per config.
- **AI validation on existing pool** — did not run the new deterministicFilter against existing places to count how many get stripped/re-categorized. Needs the tester to run `admin-ai-verify` with scope=all to re-validate the pool and check:
  - Creative & Arts: any place with a restaurant/bar primary_type gets `ai_reason` containing "stripped 'creative_arts'"
  - Movies & Theatre: same
  - Brunch Lunch Casual: places with bar primary_type + restaurant in types get stripped; restaurants with bars preserved
  - Play: places with sports_complex/community_center/farm in types get stripped
  - Flowers: Home Depot / Lowe's / garden centers get stripped
- **GPT behavior change** — did not call GPT with the new SYSTEM_PROMPT on sample places. Needs tester to run sample classifications.
- **Upscale chain protection** — did not test with a place named "Nobu" + "Olive Garden"-pattern name to confirm protection fires.
- **Nobu-style dual categorization** — did not verify that a restaurant with `PRICE_LEVEL_VERY_EXPENSIVE + 4.0+` with existing `brunch_lunch_casual` in categories now ends up with BOTH categories instead of just upscale.

---

## Invariant Preservation Check

| Invariant | Preserved? | Notes |
|-----------|-----------|-------|
| `place_pool` table schema unchanged | YES | No schema changes made |
| `seeding_category` column values compatible | YES | All existing IDs preserved (casual_eats still exists); new IDs (casual_eats_world, casual_eats_extended) are additions |
| `ai_categories` column values compatible | YES | All existing values still valid; no slugs renamed |
| `VALID_SLUGS` unchanged (10 canonical slugs) | YES | Not modified |
| Deterministic filter returns same PreFilterResult interface | YES | Interface unchanged; only rule count added |
| GPT response schema (CLASSIFICATION_SCHEMA) unchanged | YES | JSON schema preserved |
| admin-seed-places edge function logic untouched | YES | Only config file modified |
| All user-facing queries still filter on `ai_approved = true` | N/A | Not modified by this change — pre-existing assumption |
| Backward compatibility with old `seeding_category` values (casual_eats, fine_dining etc.) | YES | All original IDs preserved; `resolveSeedingCategory` still maps them |

---

## Parity Check

**Not applicable.** This is backend-only work (edge functions + shared configs). No solo-mode / collab-mode distinction exists in the seeding or validation pipeline.

---

## Cache Safety Check

**No query keys affected.** This change modifies edge function logic only. React Query, Zustand, AsyncStorage are untouched.

**Downstream data quality:** After this ships:
1. Existing places in `place_pool` will continue to have their current `ai_categories` until re-validation runs
2. Running `admin-ai-verify` with scope=all will re-apply the new deterministic filter and update categories for affected places
3. User-facing queries filter on `ai_approved = true` (per orchestrator confirmation) so any re-classifications propagate automatically once validation completes
4. No schema migration required

---

## Regression Surface (what tester should check)

### Positive tests (should still work)
1. **Generic restaurants** (primary_type=restaurant) still get `brunch_lunch_casual`
2. **Acclaimed fine dining** (fine_dining_restaurant) still gets `upscale_fine_dining`
3. **Real museums** (primary_type=museum) still get `creative_arts`
4. **Real cinemas** (primary_type=movie_theater) still get `movies_theatre`
5. **Bowling alleys** still get `play`
6. **Parks** still get `nature`
7. **Coffee shops** still get `icebreakers`
8. **Cocktail bars** still get `drinks_and_music`
9. **Real florists** still get `flowers`
10. **Supermarkets** still get `groceries` (+ `flowers` for Whole Foods etc.)

### New behavior (should now work)
11. **Persian / Filipino / Cuban / Dim Sum restaurants** appear in `brunch_lunch_casual` (previously invisible)
12. **Golf courses + indoor golf** appear in `play` (previously invisible)
13. **Nobu, Spago** get BOTH `upscale_fine_dining` + `brunch_lunch_casual` (previously only upscale — mutual exclusivity removed)
14. **EXPENSIVE + 4.0+ restaurants** get auto-promoted to upscale (previously only VERY_EXPENSIVE)
15. **Nobu/Morton's/Ruth's Chris** are protected from accidental demotion via UPSCALE_CHAIN_PROTECTION

### Negative tests (should be stripped/rejected)
16. **Wine bar in historic building** — NO longer gets `creative_arts`
17. **Pub with Friday-night comedy** — NO longer gets `movies_theatre`
18. **Hookah lounge with appetizers** — NO longer gets `brunch_lunch_casual`
19. **Food hall / food court** — NO longer gets `brunch_lunch_casual`
20. **Bowling alley with restaurant** — NO longer gets `brunch_lunch_casual` (play only)
21. **Bethesda Park Recreation Center** (sports_complex in types) — NO longer gets `play`
22. **Phillips Farms** (farm in types) — NO longer gets `play`
23. **Riverside Community Center** — NO longer gets `play` or any category (keyword reject)
24. **Home Depot garden section** (florist primary + garden_center in types) — NO longer gets `flowers`
25. **Lowe's / Bunnings / Leroy Merlin** (any primary type, garden store name) — NO longer gets `flowers`
26. **Urban Air / Toddler Bounce World** — rejected (kids keyword list expanded)
27. **Cigar lounge / shisha bar** — rejected (tobacco_hookah keyword group)
28. **"Sportspark ABC"** — rejected (sports_recreation keyword group)
29. **"Senior Center"** — rejected (community_civic keyword group)

### Adjacent features that COULD regress
- **generate-single-cards** — uses `DISPLAY_NAME_TO_SLUG` built from SEEDING_CATEGORIES.label → id. Added 2 new labels (with suffixes), but original "Brunch, Lunch & Casual" label still maps to "casual_eats" unchanged. No regression expected. Verify manually.
- **generate-curated-experiences** — uses `SEEDING_CATEGORY_MAP[catId]?.label`. All existing category IDs still exist. No regression expected.
- **admin-seed-places** — will now generate 3 batches per tile for `brunch_lunch_casual` seeding (1 for each config). Cost impact: ~+$12.80 per city (200 tiles × 2 extra calls × $0.032). If admin UI displays a per-category cost estimate, it should scale correctly via `SEEDING_CATEGORIES.filter(c => c.appCategorySlug === 'brunch_lunch_casual')`.

---

## Constitutional Compliance

| # | Principle | Status |
|---|-----------|--------|
| 1 | No dead taps | N/A — backend only |
| 2 | One owner per truth | PASS — casual_eats exclusions extracted to shared constant so 3 configs can never drift |
| 3 | No silent failures | PASS — no new error paths added; existing error handling preserved |
| 4 | One query key per entity | N/A — backend only |
| 5 | Server state server-side | N/A — backend only |
| 6 | Logout clears everything | N/A — no user-data code touched |
| 7 | Label temporary fixes | PASS — no [TRANSITIONAL] items introduced |
| 8 | Subtract before adding | PASS — enforceExclusivity function REMOVED (not wrapped/shimmed); old flowers stripping block REPLACED (not duplicated); old per-category single-check REPLACED with full types-array check |
| 9 | No fabricated data | PASS — no data fabrication |
| 10 | Currency-aware UI | N/A — backend only |
| 11 | One auth instance | N/A — no auth touched |
| 12 | Validate at the right time | PASS — deterministic filter runs before GPT; types-array checks run after promotion/demotion as before |
| 13 | Exclusion consistency | PASS — THIS IS THE CHANGE. Seeding, deterministic filter, GPT prompt, and on-demand filter are now all synchronized on the same exclusion rules |
| 14 | Persisted-state startup | N/A — no client state touched |

---

## Transition Items

**None.** No `[TRANSITIONAL]` markers introduced. All changes are complete production code.

---

## Discoveries for Orchestrator

### 1. Existing casual_eats slug mismatch in `generate-single-cards` (pre-existing, unrelated)

`generate-single-cards/index.ts` line 33-36 builds `DISPLAY_NAME_TO_SLUG` mapping `cat.label → cat.id`. The resulting slug (e.g., `"casual_eats"`) is then used to query `place_pool.ai_categories` via `.contains([slug])`. But `ai_categories` stores the NEW app slug (`"brunch_lunch_casual"`, per ORCH-0434), not the seeding ID (`"casual_eats"`).

This looks like a pre-existing bug that would only affect places without the old slug in their ai_categories array. It's unrelated to ORCH-0460 and I did NOT modify it per scope discipline. Worth investigating separately — suggest a new ORCH to trace whether the query ever actually matches and whether this needs alignment to app slugs.

### 2. Potential need for a pool re-validation run

After this ships, existing `place_pool` rows carry their previously assigned `ai_categories`. The new types-array stripping rules will not apply to them until re-validation runs. For maximum cleanup benefit, recommend dispatching an admin-ai-verify run with `scope=all` (or at minimum `scope=approved` to re-evaluate currently-approved places) once this change is live.

### 3. admin-seed-places cost UI may need refresh

Cost estimation in admin UI scans `SEEDING_CATEGORIES.filter(c => c.appCategorySlug === slug)`. For `brunch_lunch_casual`, this now returns 3 configs instead of 1, tripling the shown cost estimate. This is correct behavior (more API calls = more cost), but UI may need copy adjustment to explain "Brunch, Lunch & Casual runs 3 searches per tile to catch all cuisine variations."

### 4. User decisions worth registering as durable rules

During the audit, user made 4 product decisions that should be registered in category-mapping.md for future reference:
- Icebreakers = cozy cafes AND fun first-date activities (still needs full definition — flagged in audit as pending)
- Wellness = permanently removed
- Brunch, Lunch & Casual = real restaurants ONLY (no food trucks, markets, food halls, food courts, delis, bars, tobacco, play venues, sports centers, campuses)
- Upscale & Fine Dining = allow high-end tapas/bistros/wine bars with food that pass the special-occasion test
- Upscale & Fine Dining + Brunch, Lunch & Casual are NOT mutually exclusive (Nobu-style restaurants get both)

Category mapping document (`.claude/skills/mingla-categorizer/references/category-mapping.md`) still references the old 13-category system with wellness. It should be updated to reflect the 10-category reality + these decisions.

### 5. No new migrations required for this change

All changes are in edge function code and shared config modules. No database schema changes. Admin can deploy via standard Supabase Functions deployment — `supabase functions deploy ai-verify-pipeline` and `supabase functions deploy admin-seed-places` (the latter because it imports from `_shared/seedingCategories.ts`).

---

## Deploy Notes

**Edge functions to redeploy:**
- `ai-verify-pipeline` (modified directly)
- `admin-seed-places` (imports from `_shared/seedingCategories.ts`)
- `generate-single-cards` (imports from `_shared/seedingCategories.ts`)
- `generate-curated-experiences` (imports from `_shared/seedingCategories.ts`)
- Any other edge function that imports `_shared/seedingCategories.ts` or `_shared/categoryPlaceTypes.ts`

**Safe deployment order:** Deploy all affected edge functions together. No ordering dependency.

**Database:** No migrations. No schema changes.

**Mobile:** No app changes. No OTA update required.
