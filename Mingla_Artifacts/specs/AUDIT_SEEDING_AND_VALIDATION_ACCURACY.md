# Full-Scale Audit: Seeding & AI Validation Accuracy

**Date:** 2026-04-17
**Scope:** Every Google Place type, every seeding config, every exclusion list, every deterministic rule, every GPT prompt instruction. Nothing skipped.
**Updated:** 2026-04-17 — Added Google 50-type limit analysis, casual_eats split strategy, garden store flowers leak.

---

## Table of Contents

1. [Google Table A: What's Available vs What Mingla Uses](#1-google-table-a-gap-analysis)
2. [Seeding Config vs On-Demand Type List Discrepancies](#2-seeding-vs-on-demand-discrepancies)
3. [Cross-Category Type Overlaps](#3-cross-category-type-overlaps)
4. [Exclusion List Fragmentation (4 Independent Systems)](#4-exclusion-list-fragmentation)
5. [Post-Fetch Filter Weakness](#5-post-fetch-filter-weakness)
6. [Deterministic Filter Audit](#6-deterministic-filter-audit)
7. [GPT System Prompt Audit](#7-gpt-system-prompt-audit)
8. [Chain Rule Audit](#8-chain-rule-audit)
9. [Flowers/Groceries Overlap Problem](#9-flowersgroceries-overlap)
10. [Venue Name Keyword Sync](#10-venue-name-keyword-sync)
11. [Recommendations (Prioritized)](#11-recommendations)
12. [Google 50-Type Limit & casual_eats Split Strategy](#12-google-50-type-limit)
13. [Garden Store Flowers Leak](#13-garden-store-flowers-leak)
14. [Categorizer Verdict on Recommendations](#14-categorizer-verdict)

---

## 1. Google Table A Gap Analysis

Google's Places API (New) offers **474 types** in Table A. Mingla uses a fraction. Below is a per-category breakdown of what Mingla currently seeds, what Google offers that Mingla doesn't use, and whether each unused type is a **missed opportunity**, **correctly ignored**, or **ambiguous**.

### 1A. Food & Drink (Google offers 166 types)

**Mingla currently seeds across all food categories (casual_eats + fine_dining + first_meet + drink):**

casual_eats: restaurant, bistro, brunch_restaurant, breakfast_restaurant, diner, cafe, coffee_shop, sandwich_shop, pizza_restaurant, hamburger_restaurant, mexican_restaurant, mediterranean_restaurant, thai_restaurant, vegetarian_restaurant, american_restaurant, asian_restaurant, barbecue_restaurant, brazilian_restaurant, caribbean_restaurant, chinese_restaurant, ethiopian_restaurant, french_restaurant, fusion_restaurant, gastropub, german_restaurant, greek_restaurant, indian_restaurant, indonesian_restaurant, italian_restaurant, japanese_restaurant, korean_restaurant, korean_barbecue_restaurant, lebanese_restaurant, middle_eastern_restaurant, moroccan_restaurant, peruvian_restaurant, ramen_restaurant, seafood_restaurant, spanish_restaurant, sushi_restaurant, tapas_restaurant, turkish_restaurant, vegan_restaurant, vietnamese_restaurant, buffet_restaurant, deli, food_court, noodle_shop, hot_pot_restaurant (49 types)

fine_dining: fine_dining_restaurant, french_restaurant, italian_restaurant, steak_house, seafood_restaurant, wine_bar, fondue_restaurant, oyster_bar_restaurant (8 types)

first_meet (icebreakers): book_store, cafe, coffee_shop, tea_house, bakery, dessert_shop, juice_shop, bistro, wine_bar, lounge_bar, acai_shop, bagel_shop, cake_shop, cat_cafe, chocolate_shop, chocolate_factory, coffee_roastery, coffee_stand, confectionery, dessert_restaurant, ice_cream_shop (21 types)

drink: bar, cocktail_bar, lounge_bar, wine_bar, pub, brewery, beer_garden, brewpub, bar_and_grill, hookah_bar, irish_pub, night_club, winery, sports_bar, live_music_venue, karaoke (16 types)

**Google Table A Food & Drink types Mingla does NOT seed anywhere:**

| Type | Verdict | Rationale |
|------|---------|-----------|
| **afghani_restaurant** | MISSED — add to casual_eats | Real sit-down cuisine. On-demand has it but seeding doesn't. |
| **african_restaurant** | MISSED — add to casual_eats | Real sit-down cuisine. On-demand has it but seeding doesn't. |
| **argentinian_restaurant** | MISSED — add to casual_eats | Sit-down dining. Common in cities with Argentine communities. |
| **asian_fusion_restaurant** | MISSED — add to casual_eats | Common cuisine type, distinct from generic "asian_restaurant". |
| **australian_restaurant** | MISSED — add to casual_eats | Real cuisine type (especially in cities with Oz expats). |
| **austrian_restaurant** | MISSED — add to casual_eats | Real cuisine, especially in European cities. |
| **bangladeshi_restaurant** | MISSED — add to casual_eats | Distinct from "indian_restaurant" in Google's taxonomy. |
| **basque_restaurant** | MISSED — add to casual_eats | Regional cuisine, often upscale. Could also seed fine_dining. |
| **bavarian_restaurant** | MISSED — add to casual_eats | Common in German cities and beer-garden districts. |
| **belgian_restaurant** | MISSED — add to casual_eats | Real cuisine type. |
| **british_restaurant** | MISSED — add to casual_eats | Pub food, fish & chips, etc. |
| **burmese_restaurant** | MISSED — add to casual_eats | Growing cuisine type in US cities. |
| **burrito_restaurant** | AMBIGUOUS | Could be counter-service (reject) or sit-down (casual). Worth adding with AI validation as the quality gate. |
| **cafeteria** | CORRECTLY IGNORED | Institutional dining, not date-worthy. |
| **cajun_restaurant** | MISSED — add to casual_eats | Sit-down cuisine, especially in Southern US cities. |
| **californian_restaurant** | MISSED — add to casual_eats | Regional US cuisine. |
| **cambodian_restaurant** | MISSED — add to casual_eats | Growing cuisine type. |
| **candy_store** | AMBIGUOUS | Could be icebreakers if it has seating. AI validation can decide. |
| **cantonese_restaurant** | MISSED — add to casual_eats | Distinct from generic "chinese_restaurant". |
| **chicken_restaurant** | AMBIGUOUS | Often counter-service. Likely rejected by AI. But sit-down chicken restaurants exist. |
| **chicken_wings_restaurant** | AMBIGUOUS | Often casual bar food (Buffalo Wild Wings style). Could be casual_eats + drinks_and_music. |
| **chilean_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **chinese_noodle_restaurant** | MISSED — add to casual_eats | Distinct from generic "chinese_restaurant". |
| **colombian_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **croatian_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **cuban_restaurant** | MISSED — add to casual_eats | Real cuisine, common in Miami/NYC. |
| **czech_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **danish_restaurant** | MISSED — add to casual_eats | Real cuisine, especially Scandinavian cities. |
| **dessert_restaurant** | Already in icebreakers seeding | ✓ |
| **dim_sum_restaurant** | MISSED — add to casual_eats | Sit-down dining, very date-worthy. |
| **dog_cafe** | AMBIGUOUS | Niche cafe type. Could be icebreakers. Risk: "dog" in name might trigger false exclusion. |
| **donut_shop** | MISSED — add to icebreakers | On-demand has it in icebreakers but seeding doesn't. |
| **dumpling_restaurant** | MISSED — add to casual_eats | Sit-down dining. |
| **dutch_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **eastern_european_restaurant** | MISSED — add to casual_eats | Covers Polish, Romanian, etc. |
| **european_restaurant** | MISSED — add to casual_eats | Broad type. |
| **falafel_restaurant** | AMBIGUOUS | Often counter-service. Could let AI decide. |
| **family_restaurant** | AMBIGUOUS | "Family" in name might wrongly suggest kids venue. Actually means casual sit-down. Add to casual_eats. |
| **fast_food_restaurant** | CORRECTLY EXCLUDED | Already in exclusion lists everywhere. |
| **filipino_restaurant** | MISSED — add to casual_eats | Real cuisine, growing in US cities. |
| **fish_and_chips_restaurant** | MISSED — add to casual_eats | Sit-down in UK/Australia. Counter-service elsewhere. Let AI decide. |
| **gyro_restaurant** | AMBIGUOUS | Often counter-service. |
| **halal_restaurant** | MISSED — add to casual_eats | Real cuisine type. |
| **hamburger_restaurant** | Already in casual_eats | ✓ |
| **hawaiian_restaurant** | MISSED — add to casual_eats | Poke, plate lunch — real cuisine. |
| **hot_dog_restaurant** | CORRECTLY IGNORED | Counter-service/street food. |
| **hot_dog_stand** | CORRECTLY IGNORED | Street vendor. |
| **hungarian_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **irish_restaurant** | MISSED — add to casual_eats | Distinct from irish_pub. |
| **israeli_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **japanese_curry_restaurant** | MISSED — add to casual_eats | Distinct type, popular in Japanese cities. |
| **japanese_izakaya_restaurant** | MISSED — add to casual_eats OR drinks_and_music | Izakayas are drink-centric dining. Could dual-categorize. |
| **kebab_shop** | AMBIGUOUS | Often counter-service in Europe. But sit-down kebab restaurants exist. |
| **latin_american_restaurant** | MISSED — add to casual_eats | Broad type. |
| **malaysian_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **meal_delivery** | CORRECTLY IGNORED | Not a venue. |
| **meal_takeaway** | CORRECTLY IGNORED | Not a dine-in venue. |
| **mongolian_barbecue_restaurant** | MISSED — add to casual_eats | Sit-down, interactive dining. |
| **north_indian_restaurant** | MISSED — add to casual_eats | Distinct from generic "indian_restaurant". |
| **pakistani_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **pastry_shop** | MISSED — add to icebreakers | Café-adjacent, seating common. |
| **persian_restaurant** | MISSED — add to casual_eats | Real cuisine, often upscale. |
| **pizza_delivery** | CORRECTLY IGNORED | Not a venue. |
| **polish_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **portuguese_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **romanian_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **russian_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **salad_shop** | AMBIGUOUS | Often counter-service (Sweetgreen style). Already in fast food blacklist. |
| **scandinavian_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **shawarma_restaurant** | AMBIGUOUS | Often counter-service. |
| **snack_bar** | CORRECTLY IGNORED | Not a date spot. |
| **soul_food_restaurant** | MISSED — add to casual_eats | Real sit-down cuisine. |
| **soup_restaurant** | AMBIGUOUS | Can be counter-service or sit-down. |
| **south_american_restaurant** | MISSED — add to casual_eats | Broad type. |
| **south_indian_restaurant** | MISSED — add to casual_eats | Distinct from generic "indian_restaurant". |
| **southwestern_us_restaurant** | MISSED — add to casual_eats | Regional US cuisine. |
| **sri_lankan_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **swiss_restaurant** | MISSED — add to casual_eats | Real cuisine, fondue etc. |
| **taco_restaurant** | AMBIGUOUS | Can be counter-service or sit-down. |
| **taiwanese_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **tex_mex_restaurant** | MISSED — add to casual_eats | Very common. |
| **tibetan_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **tonkatsu_restaurant** | MISSED — add to casual_eats | Japanese specialty. |
| **ukrainian_restaurant** | MISSED — add to casual_eats | Real cuisine. |
| **western_restaurant** | MISSED — add to casual_eats | Broad type. |
| **yakiniku_restaurant** | MISSED — add to casual_eats | Japanese BBQ, sit-down. |
| **yakitori_restaurant** | MISSED — add to casual_eats OR drinks_and_music | Often bar-adjacent. |

**SUMMARY:** Mingla misses **~58 restaurant cuisine types** that Google offers in Table A. These are all real sit-down restaurant types that would populate the Brunch, Lunch & Casual category. Some (basque_restaurant, persian_restaurant, japanese_izakaya_restaurant) could also feed Upscale & Fine Dining.

**Impact:** Cities with diverse cuisine scenes (NYC, London, LA, Toronto, Dubai, Singapore) are significantly under-seeded. A dim_sum_restaurant, a soul_food_restaurant, or a Filipino restaurant would never appear in Mingla's pool unless Google also tags them with the generic "restaurant" type.

### 1B. Entertainment & Recreation (Google offers 55 types)

**Mingla currently seeds:** adventure_sports_center, amphitheatre, amusement_center, amusement_park, aquarium, botanical_garden, bowling_alley, casino, city_park, comedy_club, concert_hall, cultural_center, dance_hall, event_venue, ferris_wheel, garden, go_karting_venue, hiking_area, karaoke, live_music_venue, marina, miniature_golf_course, movie_theater, national_park, night_club, observation_deck, opera_house, paintball_center, park, philharmonic_hall, picnic_ground, planetarium, roller_coaster, skateboard_park, state_park, tourist_attraction, video_arcade, vineyard, water_park, wildlife_park, wildlife_refuge, zoo (42 types)

**Google Table A types Mingla does NOT seed:**

| Type | Verdict | Rationale |
|------|---------|-----------|
| **banquet_hall** | CORRECTLY EXCLUDED | Already in BLOCKED_PRIMARY_TYPES. |
| **barbecue_area** | AMBIGUOUS | Public BBQ spot, could be nature. But it's a facility, not a scenic venue. |
| **childrens_camp** | CORRECTLY IGNORED | Kids-only venue. |
| **community_center** | CORRECTLY IGNORED | Civic, not date-worthy. |
| **convention_center** | CORRECTLY IGNORED | Corporate/event space. |
| **cycling_park** | CORRECTLY EXCLUDED | Sports/fitness, in nature exclusions. |
| **dog_park** | CORRECTLY EXCLUDED | In GLOBAL_EXCLUDED_PLACE_TYPES. |
| **historical_landmark** | MISSED — add to creative_arts | Seeding has historical_place but NOT historical_landmark. Google has both as separate types. |
| **indoor_playground** | CORRECTLY IGNORED | Kids venue. |
| **internet_cafe** | AMBIGUOUS | Could be icebreakers in some markets (Asia, Middle East). Risky — often gaming cafes. |
| **movie_rental** | CORRECTLY IGNORED | Not a venue. |
| **off_roading_area** | AMBIGUOUS | Could be play/adventure. Niche. |
| **plaza** | AMBIGUOUS | On-demand icebreakers includes it, but seeding doesn't. A plaza isn't a business — it's a location. Low value. |
| **visitor_center** | AMBIGUOUS | Information center, not a date venue. But some (national park visitor centers) have exhibits. |
| **wedding_venue** | CORRECTLY EXCLUDED | In BLOCKED_PRIMARY_TYPES. |
| **ice_skating_rink** | Already in play seeding | ✓ |

**MISSED:** Only historical_landmark is a clear gap. Everything else is correctly ignored or ambiguous.

### 1C. Culture (Google offers 12 types)

**Mingla currently seeds:** art_gallery, art_museum, art_studio, auditorium, castle, cultural_landmark, historical_place, history_museum, monument, museum, performing_arts_theater, sculpture (12 types)

**Google Table A types Mingla does NOT seed:**

| Type | Verdict | Rationale |
|------|---------|-----------|
| **fountain** | Already in nature_views seeding | ✓ (It's in Google's Culture category but Mingla seeds it as nature.) |

**Mingla seeds ALL 12 Culture types.** Full coverage. No gaps.

### 1D. Natural Features (Google offers 8 types)

**Mingla currently seeds:** beach, island, lake, mountain_peak, nature_preserve, river, scenic_spot, woods (8 types)

**Mingla seeds ALL 8 Natural Feature types.** Full coverage.

### 1E. Shopping (Google offers 43 types)

**Mingla currently seeds:** book_store (icebreakers), grocery_store (flowers + groceries), supermarket (flowers + groceries) — 3 types

**Google Table A types Mingla does NOT seed:**

| Type | Verdict | Rationale |
|------|---------|-----------|
| **asian_grocery_store** | CORRECTLY EXCLUDED | In both flowers and groceries excludedPrimaryTypes. |
| **butcher_shop** | AMBIGUOUS | Specialty food shop. Could be groceries. Not date-worthy on its own. |
| **convenience_store** | CORRECTLY EXCLUDED | In exclusion lists. |
| **farmers_market** | AMBIGUOUS | Could be nature or groceries. Often outdoor, social. But inconsistent — some are just parking-lot stalls. |
| **flea_market** | AMBIGUOUS | Could be creative_arts or play. Social activity. |
| **gift_shop** | CORRECTLY IGNORED | Retail, not a date venue. |
| **health_food_store** | CORRECTLY EXCLUDED | In exclusion lists. |
| **jewelry_store** | CORRECTLY IGNORED | Retail. |
| **liquor_store** | CORRECTLY EXCLUDED | In exclusion lists. |
| **market** | CORRECTLY EXCLUDED | Too generic. In exclusion lists. |
| **tea_store** | AMBIGUOUS | Could be icebreakers if it has seating/tasting. |
| **thrift_store** | AMBIGUOUS | Vintage shopping is a popular date activity. Could be creative_arts or play. |
| All other retail types | CORRECTLY IGNORED | Not date venues. |

**Potential additions:** flea_market (play/creative), thrift_store (play), tea_store (icebreakers) — all would need AI validation as the quality gate.

### 1F. Sports (Google offers 21 types)

**Mingla currently seeds:** adventure_sports_center, ice_skating_rink (play) — 2 types

| Type | Verdict | Rationale |
|------|---------|-----------|
| **golf_course** | MISSED — add to play | Golf dates are real. TopGolf is already conceptually in play via "amusement_center". But actual golf courses are a separate type. |
| **indoor_golf_course** | MISSED — add to play | Simulator golf (TopGolf, Five Iron). Very date-worthy. |
| **ski_resort** | AMBIGUOUS | Seasonal. Date-worthy but niche. |
| **sports_activity_location** | AMBIGUOUS | Too generic. Could catch batting cages, climbing walls, etc. Risky. |
| **arena** | CORRECTLY IGNORED | Spectator venue, not an activity. |
| **fitness_center** / **gym** | CORRECTLY EXCLUDED | In GLOBAL_EXCLUDED_PLACE_TYPES. |
| **swimming_pool** | CORRECTLY IGNORED | Not a date venue (public pools). |
| **tennis_court** | CORRECTLY IGNORED | Not a commercial date venue. |
| **playground** | CORRECTLY IGNORED | Kids. |
| All other sports types | CORRECTLY IGNORED | Athletic/spectator, not date activities. |

**MISSED:** golf_course and indoor_golf_course are clear gaps for the Play category.

### 1G. Services (Google offers 46 types)

**Mingla currently seeds:** florist (flowers) — 1 type

| Type | Verdict | Rationale |
|------|---------|-----------|
| **tour_agency** | AMBIGUOUS | Not the tour itself — just the booking office. Ignore. |
| **tourist_information_center** | AMBIGUOUS | Not a date activity. |
| All grooming/beauty types | CORRECTLY EXCLUDED | hair_salon, beauty_salon, nail_salon, barber_shop, etc. All in exclusion lists. |
| All professional services | CORRECTLY EXCLUDED | lawyer, electrician, plumber, etc. |
| **pet_care** / **pet_boarding_service** | CORRECTLY IGNORED | Not date venues. |
| **cemetery** | CORRECTLY EXCLUDED | In BLOCKED_PRIMARY_TYPES. |

**No gaps.** Services are correctly filtered.

### 1H. Health & Wellness (Google offers 20 types)

**Mingla seeds NONE.** All health/wellness types (spa, sauna, massage, yoga_studio, etc.) are excluded.

| Type | Verdict | Rationale |
|------|---------|-----------|
| **spa** | DEBATABLE | Couples spa is a real date activity. Currently excluded post-ORCH-0434 (Wellness removed). |
| **sauna** | DEBATABLE | Same as spa — could be a date in some markets (Scandinavian, Korean). |
| **massage** / **massage_spa** | CORRECTLY EXCLUDED | Too personal for a date activity suggestion. |
| All medical types | CORRECTLY EXCLUDED | Not venues. |

**Note:** The removal of Wellness as a category means couples spa experiences are no longer surfaced. This is a deliberate product decision, not an oversight.

### 1I. Lodging (Google offers 18 types)

**Mingla seeds NONE.** Correctly — hotels are not date activities.

| Type | Verdict | Rationale |
|------|---------|-----------|
| **bed_and_breakfast** | AMBIGUOUS | Some B&Bs have restaurants/cafes. But the venue itself is lodging. Ignore. |
| All other lodging | CORRECTLY IGNORED | Not date venues. |

### 1J. Places of Worship (Google offers 6 types)

**Mingla seeds NONE.**

| Type | Verdict | Rationale |
|------|---------|-----------|
| **church** / **mosque** / **synagogue** / **temple** / etc. | AMBIGUOUS | Some are architectural landmarks (Notre-Dame, Sagrada Familia). But categorizing places of worship as "date spots" is culturally sensitive. Best left to AI on a case-by-case basis via tourist_attraction or cultural_landmark types instead. |

**Correct decision to exclude.** These can still appear if tagged as tourist_attraction or cultural_landmark.

---

## 2. Seeding vs On-Demand Discrepancies

The seeding system (seedingCategories.ts) and the on-demand system (categoryPlaceTypes.ts MINGLA_CATEGORY_PLACE_TYPES) have separate type lists. They SHOULD be aligned but aren't.

### Types in Seeding NOT in On-Demand

| Type | Seeding Category | On-Demand Category | Issue |
|------|-----------------|-------------------|-------|
| city_park | nature_views | Not listed | Minor — subsumes into park |
| vineyard | nature_views | Not listed | **GAP:** Vineyards are seeded but never searched on-demand |
| island | nature_views | Not listed | Minor — rare natural feature |
| wildlife_park | nature_views | Not listed | **GAP:** Seeded but not on-demand |
| wildlife_refuge | nature_views | Not listed | **GAP:** Seeded but not on-demand |
| woods | nature_views | Not listed | **GAP:** Seeded but not on-demand |
| fountain | nature_views | Not listed (Culture type in Google) | Minor |
| mountain_peak | nature_views | Not listed | **GAP:** Seeded but not on-demand |
| river | nature_views | Not listed | **GAP:** Seeded but not on-demand |
| acai_shop | first_meet | Not listed | Missing specific café type |
| bagel_shop | first_meet | Not listed | Missing specific food type |
| cat_cafe | first_meet | Not listed | Missing |
| chocolate_shop | first_meet | Not listed | Missing |
| chocolate_factory | first_meet | Not listed | Missing |
| coffee_stand | first_meet (also in on-demand drinks) | Only in drinks, not icebreakers | **MISMATCH** |
| confectionery | first_meet | Not listed | Missing |
| dessert_restaurant | first_meet | Not listed | Missing |
| fondue_restaurant | fine_dining | Not listed | Missing |
| oyster_bar_restaurant | fine_dining | Not listed | Missing |
| noodle_shop | casual_eats | Not listed | **GAP** |
| hot_pot_restaurant | casual_eats | Not listed | **GAP** |
| auditorium | live_performance | Not listed for movies_theatre | **MISMATCH** — seeding: movies_theatre, on-demand: not listed |
| historical_place | creative_arts | Not listed | Missing |
| historical_landmark | creative_arts | Not listed | Missing |
| monument | creative_arts | Not listed (in seeding only) | Missing |
| sculpture | creative_arts | Not listed | Missing |
| adventure_sports_center | play | Not listed | **GAP** |
| ferris_wheel | play | Not listed | Missing |
| roller_coaster | play | Not listed | Missing (part of amusement_park?) |
| water_park | play | Not listed separately | Missing |
| ice_skating_rink | play | Not listed | **GAP** |

### Types in On-Demand NOT in Seeding

| Type | On-Demand Category | Seeding Category | Issue |
|------|-------------------|-----------------|-------|
| donut_shop | icebreakers | NOT in first_meet seeding | **MISMATCH** |
| breakfast_restaurant | icebreakers (on-demand) | casual_eats (seeding) | **Category mismatch** — seeded as casual but on-demand searches icebreakers |
| brunch_restaurant | icebreakers (on-demand) | casual_eats (seeding) | **Category mismatch** — same as above |
| plaza | icebreakers | NOT in any seeding | On-demand has it, seeding doesn't |
| garden | icebreakers (on-demand) | nature_views (seeding) | **Category mismatch** — seeded as nature but on-demand searches icebreakers |
| park | icebreakers (on-demand) | nature_views (seeding) | **Category mismatch** — same |
| botanical_garden | icebreakers (on-demand) | nature_views (seeding) | **Category mismatch** — same |
| bowling_alley | icebreakers (on-demand) | play (seeding) | **Category mismatch** — seeded as play but on-demand searches icebreakers |
| miniature_golf_course | icebreakers (on-demand) | play (seeding) | **Category mismatch** — same |
| video_arcade | icebreakers (on-demand) | play (seeding) | **Category mismatch** — same |
| amusement_center | icebreakers (on-demand) | play (seeding) | **Category mismatch** — same |
| go_karting_venue | icebreakers (on-demand) | play (seeding) | **Category mismatch** — same |
| paintball_center | icebreakers (on-demand) | play (seeding) | **Category mismatch** — same |
| comedy_club | icebreakers (on-demand) | live_performance (seeding) | **Category mismatch** |
| dance_hall | icebreakers (on-demand) | live_performance (seeding) | **Category mismatch** |
| tourist_attraction | icebreakers (on-demand) | nature_views (seeding) | **Category mismatch** |
| art_museum | icebreakers (on-demand) | creative_arts (seeding) | **Category mismatch** |
| museum | icebreakers (on-demand) | creative_arts (seeding) | **Category mismatch** |
| cultural_center | icebreakers (on-demand) | creative_arts (seeding) | **Category mismatch** |
| afghani_restaurant | casual (on-demand) | NOT in any seeding | **GAP** |
| african_restaurant | casual (on-demand) | NOT in any seeding | **GAP** |

### Root Cause

The on-demand system's icebreakers category is **dramatically broader** than seeding's icebreakers. On-demand icebreakers includes parks, museums, arcades, bowling alleys, comedy clubs — essentially "any fun low-pressure activity." Seeding's icebreakers is strictly "cafes and sweet spots."

This means:
- **On-demand experiences** can suggest bowling for an icebreaker date, but bowling alleys are **seeded under play**, not icebreakers
- The `seeding_category` field on those bowling alleys says "play", so any query filtering by seeding_category for icebreakers would miss them
- This only works because AI validation assigns `ai_categories` independently of seeding_category

**Verdict:** This is architecturally sound IF queries use `ai_categories` (not `seeding_category`). But it means seeding's category names are misleading — they're search strategies, not actual categories.

---

## 3. Cross-Category Type Overlaps

Types that appear in multiple seeding categories' `includedTypes`:

| Type | Categories (Seeding) | Risk |
|------|---------------------|------|
| **cafe** | first_meet, casual_eats | Low — casual_eats excludes it via AI, first_meet is primary |
| **coffee_shop** | first_meet, casual_eats | Low — same as cafe |
| **bistro** | first_meet, casual_eats | Low — AI decides |
| **wine_bar** | first_meet, fine_dining, drink | **MEDIUM** — same place gets seeded 3x. Deduplication handles it, but wastes API calls. |
| **lounge_bar** | first_meet, drink | Low — deduplicated |
| **french_restaurant** | casual_eats, fine_dining | **MEDIUM** — same place seeded 2x. AI must decide casual vs upscale. |
| **italian_restaurant** | casual_eats, fine_dining | **MEDIUM** — same as french_restaurant |
| **seafood_restaurant** | casual_eats, fine_dining | **MEDIUM** — same |
| **steak_house** | casual_eats (missing but should be?), fine_dining | Note: steak_house is NOT in casual_eats seeding, only fine_dining. |
| **live_music_venue** | drink, live_performance | Low — same place, different search context |
| **karaoke** | drink, play (and excluded from icebreakers) | Low — deduplicated |
| **performing_arts_theater** | creative_arts, live_performance | Low — same place, AI decides category |
| **park** | nature_views, picnic_park | Low — same parent category |
| **city_park** | nature_views, picnic_park | Low — same parent category |
| **grocery_store** | flowers, groceries | **HIGH** — overlap is the Flowers/Groceries problem (see Section 9) |
| **supermarket** | flowers, groceries | **HIGH** — same |

### API Cost Impact

Each overlap means the same physical place gets fetched by multiple tile searches. The upsert deduplication (`ignoreDuplicates: true`) prevents duplicate rows, but the Google API call is still made and billed. For a city with 200 tiles:

- wine_bar in 3 categories = 600 API calls that return mostly the same results
- french_restaurant in 2 categories = 400 API calls with heavy overlap
- grocery_store in 2 categories = 400 API calls with near-total overlap

**Recommendation:** Accept the overlap as a cost trade-off for completeness, OR run a dedup pass before batch creation that skips tile+type combos already covered by another category's search.

---

## 4. Exclusion List Fragmentation

Four independent exclusion systems operate with minimal synchronization:

### System 1: Seeding Exclusions (seedingCategories.ts)

Each of 13 categories has its own `excludedPrimaryTypes` array. These are passed to Google's API as `excludedPrimaryTypes` in the request body, meaning **Google filters them server-side before returning results.**

**Total unique exclusions across all categories:** ~85 types (with heavy overlap between categories).

### System 2: AI Validation Deterministic Filter (ai-verify-pipeline.ts)

- FAST_FOOD_BLACKLIST: 67 chain name substrings
- BLOCKED_PRIMARY_TYPES: 23 types
- EXCLUSION_KEYWORDS: 12 category groups, ~90 keyword substrings
- FLOWERS_BLOCKED_TYPES: 10 types
- CASUAL_CHAIN_DEMOTION: 21 chain name substrings
- RESTAURANT_TYPES: 47 types (used for promotion, not exclusion)

### System 3: On-Demand Exclusions (categoryPlaceTypes.ts)

- GLOBAL_EXCLUDED_PLACE_TYPES: 5 types (gym, fitness_center, dog_park, school, preschool + secondary_school, primary_school, university)
- CATEGORY_EXCLUDED_PLACE_TYPES: Per-category arrays (10 categories), each including RETAIL_EXCLUSIONS (43 types)
- DISCOVER_EXCLUDED_PLACE_TYPES: 24 types (superset of global)
- EXCLUDED_VENUE_NAME_KEYWORDS: 25 keyword patterns

### System 4: Post-Fetch Seeding Filter (admin-seed-places.ts)

- **Only checks:** permanently closed + no photos
- **No type-based filtering** — comment says "Phase 2: Type exclusions removed — AI is the sole quality gate"

### Sync Gaps Found

**A. BLOCKED_PRIMARY_TYPES (AI pipeline) vs Seeding excludedPrimaryTypes:**

| Blocked Type (AI) | In Seeding Exclusions? | Gap? |
|--------------------|----------------------|------|
| cemetery | Not in any seeding excludedPrimaryTypes | **YES** — a cemetery could theoretically be returned by a nature search if Google tags it as "park" |
| funeral_home | Not in any seeding excludedPrimaryTypes | **YES** — same |
| car_dealer | Not in any seeding excludedPrimaryTypes | **YES** |
| car_wash | Not in any seeding excludedPrimaryTypes | **YES** |
| car_rental | Not in any seeding excludedPrimaryTypes | **YES** |
| auto_repair | Not in any seeding excludedPrimaryTypes | **YES** |
| parking | Not in any seeding excludedPrimaryTypes | **YES** — but parking lots have no photos, so post-fetch filter catches them |
| storage | Not in any seeding excludedPrimaryTypes | **YES** |
| laundry | Not in any seeding excludedPrimaryTypes | **YES** |
| locksmith | Not in any seeding excludedPrimaryTypes | **YES** |
| plumber | Not in any seeding excludedPrimaryTypes | **YES** |
| electrician | Not in any seeding excludedPrimaryTypes | **YES** |
| roofing_contractor | Not in any seeding excludedPrimaryTypes | **YES** |
| insurance_agency | Not in any seeding excludedPrimaryTypes | **YES** |
| real_estate_agency | Not in any seeding excludedPrimaryTypes | **YES** |
| accounting | Not in any seeding excludedPrimaryTypes | **YES** |
| post_office | Not in any seeding excludedPrimaryTypes | **YES** |
| fire_station | Not in any seeding excludedPrimaryTypes | **YES** |
| police | Not in any seeding excludedPrimaryTypes | **YES** |
| courthouse | Not in any seeding excludedPrimaryTypes | **YES** |
| wedding_venue | In some seeding excludedPrimaryTypes (nature) | Partial |
| banquet_hall | In some seeding excludedPrimaryTypes (nature) | Partial |

**Why this matters less than it looks:** These types would never appear in a Nearby Search for `includedTypes: ['cafe', 'restaurant']` because Google only returns places matching the included types. The excluded types in the seeding API call are a safety net for cases where Google's type taxonomy is ambiguous (a place tagged as both "park" AND "cemetery"). Still, adding them globally would be belt-and-suspenders.

**B. FAST_FOOD_BLACKLIST (AI pipeline) not replicated anywhere else:**

The 67-chain blacklist exists ONLY in the AI validation pipeline. Neither seeding nor on-demand has it. This is architecturally correct — the blacklist is a name-based filter, not a type-based filter, so it can't be applied at the Google API level. It COULD be applied in the post-fetch filter during seeding, but the deliberate design choice is "let everything in, let AI clean it up."

**C. GLOBAL_EXCLUDED_PLACE_TYPES (categoryPlaceTypes.ts) vs Seeding:**

| Global Exclusion | In Seeding Exclusions? |
|------------------|----------------------|
| gym | In most seeding excludedPrimaryTypes | ✓ |
| fitness_center | In most seeding excludedPrimaryTypes | ✓ |
| dog_park | In nature_views and picnic_park only | **PARTIAL** — not excluded in play, creative_arts |
| school | NOT in any seeding excludedPrimaryTypes | **GAP** |
| primary_school | NOT in any seeding excludedPrimaryTypes | **GAP** |
| secondary_school | NOT in any seeding excludedPrimaryTypes | **GAP** |
| university | NOT in any seeding excludedPrimaryTypes | **GAP** |
| preschool | NOT in any seeding excludedPrimaryTypes | **GAP** |

**These are unlikely to appear** in seeding results because the `includedTypes` wouldn't match schools. But if Google tags a place as both "park" and "school" (a school playground), it could slip through.

---

## 5. Post-Fetch Filter Weakness

The seeding post-fetch filter (admin-seed-places.ts lines 252-275) only checks two things:

1. `businessStatus === "CLOSED_PERMANENTLY"` → reject
2. `!photos || photos.length === 0` → reject

**Everything else passes.** The comment explicitly says: *"Phase 2: Type exclusions removed — AI is the sole quality gate."*

### What this means

- A McDonald's searched via the casual_eats `restaurant` type **enters the pool**. AI rejects it later, but it's in `place_pool` with `ai_approved = null` until validation runs.
- A hair salon that Google wrongly tags as a "cafe" **enters the pool**.
- A closed-for-renovation venue with photos **enters the pool**.

### Is this a problem?

**It depends on validation coverage.** If AI validation runs promptly after seeding, the pool stays clean. If there's a delay, the pool contains unvalidated garbage that could leak into user-facing features if any code path queries `place_pool` without checking `ai_approved`.

**Check:** Are there any code paths that query place_pool without filtering on `ai_approved = true`?

This is worth auditing separately. If all user-facing queries filter on `ai_approved`, the loose post-fetch filter is fine. If not, it's a data quality risk.

---

## 6. Deterministic Filter Audit

The deterministic filter (ai-verify-pipeline.ts `deterministicFilter()`) runs 8 checks in order. Here's a pedantic audit of each.

### Check 1: BLOCKED_PRIMARY_TYPES (23 types)

**Current list:** cemetery, funeral_home, gas_station, car_dealer, car_wash, car_rental, auto_repair, parking, storage, laundry, locksmith, plumber, electrician, roofing_contractor, insurance_agency, real_estate_agency, accounting, post_office, fire_station, police, courthouse, wedding_venue, banquet_hall

**Missing types that should be blocked:**

| Type | Rationale |
|------|-----------|
| **campground** | Not a date venue (overnight camping). Currently in nature seeding exclusions but not in BLOCKED_PRIMARY_TYPES. |
| **rv_park** | Not a date venue. |
| **mobile_home_park** | Not a venue at all. |
| **apartment_building** / **apartment_complex** / **condominium_complex** / **housing_complex** | Not venues. Unlikely to appear but defensive. |
| **government_office** / **local_government_office** | Non-venue. |
| **embassy** | Non-venue. |
| **city_hall** | Non-venue. |
| **neighborhood_police_station** | Non-venue. |
| **medical_center** / **medical_clinic** / **medical_lab** | Already caught by EXCLUSION_KEYWORDS['medical'], but not in BLOCKED_PRIMARY_TYPES. |
| **hospital** / **general_hospital** | Same — caught by keywords, not by type. |
| **drugstore** / **pharmacy** | Same. |
| **stable** | Not a venue. |

**Verdict:** The keyword-based check (Check 4) catches most of these, so the type-based check doesn't need to be exhaustive. But adding government/housing types to BLOCKED_PRIMARY_TYPES provides a faster rejection path (Check 1 runs before Check 4).

### Check 2: Minimum Data Guard

Rejects places with no rating AND no reviews AND no website. This is sound — such places are either new, fake, or data-poor.

**Potential issue:** Some legitimate outdoor venues (trails, viewpoints) might have no website and few reviews. But they'd have ratings from Google Maps contributions. This check is unlikely to catch false positives.

### Check 3: FAST_FOOD_BLACKLIST (67 chains)

**Missing chains that should be added:**

| Chain | Presence | Rationale |
|-------|----------|-----------|
| **Wingstop** | In list as "wingstop" | ✓ |
| **Chipotle** | In list as "chipotle" | ✓ |
| **Raising Cane's** | In list as "raising cane" | ✓ |
| **Portillo's** | NOT in list | Counter-service/drive-through chain. Should be added. |
| **Culver's** | NOT in list | Fast-casual chain. Borderline — has table service in some locations. |
| **Wawa** | NOT in list | Convenience store with food. Should be added. |
| **Sheetz** | NOT in list | Same as Wawa. |
| **7-Eleven** | NOT in list | Convenience store. Already excluded by type (convenience_store) but name-based catch is belt-and-suspenders. |
| **Pret a Manger** | In list as "pret a manger" | ✓ |
| **Greggs** | In list as "greggs" | ✓ |
| **Nandos** | NOT in FAST_FOOD_BLACKLIST — in CASUAL_CHAIN_DEMOTION instead | Correct placement — Nando's has table service. |
| **Popeyes** | In list as "popeyes" | ✓ |
| **Chick-fil-A** | In list as "chick-fil-a" | ✓ |
| **El Pollo Loco** | In list as "el pollo loco" | ✓ |
| **Auntie Anne's** | NOT in list | Pretzel chain. Counter-service. Should be added. |
| **Cinnabon** | NOT in list | Counter-service. Should be added. |
| **Wetzel's Pretzels** | NOT in list | Counter-service. Should be added. |
| **Pinkberry** | NOT in list | Frozen yogurt chain. Borderline. |
| **Taco Cabana** | NOT in list | Fast food. Should be added. |
| **Checkers** | In list as "checkers" | ✓ |
| **Habit Burger** | NOT in list | Fast-casual. Should be added. |
| **Smashburger** | NOT in list | Fast-casual. Should be added. |
| **Noodles & Company** | NOT in list | Fast-casual. Should be added. |
| **McAlister's Deli** | NOT in list | Fast-casual chain. Should be added. |
| **Corner Bakery Cafe** | NOT in list | Fast-casual. Borderline. |
| **Au Bon Pain** | NOT in list | Fast-casual. Should be added. |
| **Sbarro** | NOT in list | Counter-service pizza. Should be added. |
| **Popeye's Louisiana Kitchen** | Covered by "popeyes" | ✓ |

**International chains to consider:**

| Chain | Region | Rationale |
|-------|--------|-----------|
| **Maoz Vegetarian** | Europe | Fast-casual falafel chain. |
| **PAUL** | Europe/Middle East | Bakery chain. Borderline — has seating. |
| **Le Pain Quotidien** | Global | Bakery-restaurant chain. Has table service. Should be CASUAL_CHAIN_DEMOTION, not blacklist. |
| **MAX Burgers** | Scandinavia | Fast food chain. |
| **Hesburger** | Nordic/Baltic | Fast food chain. |
| **Lotteria** | Asia | Fast food chain. |
| **MOS Burger** | Asia | Fast food chain. |
| **Yoshinoya** | Asia/US | Fast food chain. |
| **CoCo Ichibanya** | Asia/US | Curry chain. Fast-casual with table service. Borderline. |
| **Oporto** | Australia | Fast food chain. |
| **Hungry Jack's** | Australia | Fast food (Burger King brand). |

### Check 4: EXCLUSION_KEYWORDS (12 categories, ~90 keywords)

**Audit of each category:**

**Medical (10 keywords):** hospital, clinic, dentist, doctor, pharmacy, chiropractor, physiotherapy, veterinary, optometrist, urgent care
- **Missing:** orthodontist, dermatologist, podiatrist, audiologist. Low risk — these rarely appear in place searches for restaurants/bars.

**Government (7 keywords):** dmv, courthouse, post office, police station, embassy, city hall, fire station
- **Missing:** "town hall" (UK English), "mairie" (French), "rathaus" (German). Low risk for English-language markets.

**Education (5 keywords):** school, daycare, preschool, tutoring, university campus
- **Missing:** "college campus", "seminary". Low risk — "school" catches most.

**Grooming (24 keywords):** threading, waxing studio, lash extension, microblading, permanent makeup, nail salon, hair salon, barber, kosmetikstudio, institut de beaute, beauty parlour, tanning studio, brow bar, beauty salon, beauty lounge, beauty world, beauty bar, med spa, medspa, aesthetics spa, aesthetic clinic, beauty studio
- **THOROUGH.** This is the most comprehensive keyword list. Good coverage of European terms.
- **Missing:** "eyelash", "mani pedi", "blowout bar", "hair studio". Minor.

**Fitness (7 keywords):** gym, fitness center, crossfit, yoga studio, pilates, martial arts dojo, boxing gym
- **Missing:** "climbing gym", "barre studio", "spin class", "orangetheory", "f45", "peloton studio". These are niche but growing.

**Kids (12 keywords):** kids play, children's, indoor playground, kidz, chuck e. cheese, kidzone, enfants, kinder, bambini, infantil, splash pad, soft play
- **CRITICAL GAPS vs categoryPlaceTypes.EXCLUDED_VENUE_NAME_KEYWORDS:**
  - Missing: **toddler**, **baby/babies**, **bounce/bouncy**, **trampoline**, **little ones**, **mommy/mommy and me**, **fun zone/funzone**, **jungle gym**, **play space/playspace**, **daycare** (in education, not kids), **pre-school** (in education, not kids)
  - These ARE in categoryPlaceTypes but NOT in the AI pipeline's kids keywords
  - Impact: A venue named "Toddler Bounce Zone" would pass the AI pipeline deterministic filter but be caught by on-demand filtering. Inconsistent.

**Utilitarian (7 keywords):** gas station, car wash, laundromat, storage unit, parking garage, auto repair, car dealership
- Overlaps with BLOCKED_PRIMARY_TYPES. Belt-and-suspenders approach is correct.

**Delivery (4 keywords):** ghost kitchen, delivery only, cloud kitchen, virtual kitchen
- Complete for current market.

**Food truck (3 keywords):** food truck, food cart, mobile kitchen
- Complete.

**Not a venue (12 keywords):** real estate, insurance, accounting, law firm, consulting, contractor, plumber, electrician, production company, booking agency, talent agency, event management
- **Missing:** "staffing agency", "marketing agency", "design studio" (non-creative), "co-working". Minor.

**Gambling (4 keywords):** spielhalle, betting shop, slot machine, gambling hall
- **Missing English terms:** "bookmaker", "betting parlor", "off-track betting", "OTB". Also missing: "pachinko" (Japan).

**Allotment (8 keywords):** kleingartenanlage, kleingarten, kolonie, schrebergarten, allotment garden, jardin partage, community garden, volkstuinen
- Very thorough for European markets.

### Check 5: CASUAL_CHAIN_DEMOTION (21 chains)

Demotes upscale_fine_dining → brunch_lunch_casual for sit-down chains.

**Current list:** olive garden, red lobster, outback, cheesecake factory, applebee, chili's, tgi friday, denny's, ihop, waffle house, cracker barrel, texas roadhouse, red robin, buffalo wild wings, longhorn steakhouse, nando's, wagamama, yo! sushi, pizza express, pizzaexpress, hippopotamus

**Missing chains:**

| Chain | Rationale |
|-------|-----------|
| **Bob Evans** | Sit-down chain restaurant. |
| **Perkins** | Sit-down family restaurant. |
| **Friendly's** | Sit-down chain. |
| **Shoney's** | Sit-down chain. |
| **Golden Corral** | Already in FAST_FOOD_BLACKLIST. Should it be in demotion instead? It has table service (buffet). **Decision needed.** |
| **Ruby Tuesday** | Sit-down chain. |
| **Hooters** | Sit-down chain. |
| **Bonefish Grill** | Sit-down chain. Borderline upscale. |
| **Carrabba's** | Sit-down chain. |
| **Cheddar's** | Sit-down chain. |
| **Benihana** | Sit-down chain. Borderline — entertainment dining. |
| **P.F. Chang's** | Sit-down chain. Often perceived as upscale-casual. |
| **Buca di Beppo** | Sit-down chain. |
| **Maggiano's** | Sit-down chain. |
| **Seasons 52** | Sit-down chain. More upscale than casual. **Borderline.** |
| **Capital Grille** | Upscale chain. Should be PROTECTED, not demoted. Like Nobu/Morton's. |
| **Ruth's Chris** | Upscale chain. Should be PROTECTED. |
| **Fleming's** | Upscale chain. Should be PROTECTED. |
| **Eddie V's** | Upscale chain. Should be PROTECTED. |
| **Del Frisco's** | Upscale chain. Should be PROTECTED. |
| **Mastro's** | Upscale chain. Should be PROTECTED. |
| **STK** | Upscale chain. Should be PROTECTED. |
| **BOA Steakhouse** | Upscale chain. Should be PROTECTED. |

**CRITICAL FINDING:** There is no UPSCALE_CHAIN_WHITELIST. The demotion logic (Check 5) fires on any name match in CASUAL_CHAIN_DEMOTION. If someone accidentally adds "ruth's chris" or "capital grille" to this list, legitimate upscale chains get demoted. The system has a blacklist but no whitelist.

**Recommendation:** Create an UPSCALE_CHAIN_PROTECTION list that PREVENTS demotion, regardless of any other rule. This protects: Nobu, Morton's, Nusr-Et, Perry's, Capital Grille, Ruth's Chris, Fleming's, Eddie V's, Del Frisco's, Mastro's, STK, BOA, Peter Luger, etc.

### Check 6: Fine Dining Auto-Promotion

Promotes to upscale_fine_dining if: PRICE_LEVEL_VERY_EXPENSIVE + rating >= 4.0 + primary_type is in RESTAURANT_TYPES.

**Audit of RESTAURANT_TYPES (47 types):**

The list includes all major restaurant types. Missing types from Google's Table A that could be fine dining:

| Missing Type | Should Add? |
|-------------|-------------|
| basque_restaurant | YES — often upscale |
| persian_restaurant | YES — often upscale |
| scandinavian_restaurant | YES — often upscale (Nordic cuisine) |
| swiss_restaurant | YES — fondue/upscale |
| argentinian_restaurant | YES — steakhouse culture |
| european_restaurant | YES — broad type |

**Logic audit:** The promotion only fires if `ai_categories` doesn't already include `upscale_fine_dining`. This means it can only promote places that are in the pool with OTHER categories. It won't affect places that already have the correct category.

**Edge case:** A place with PRICE_LEVEL_VERY_EXPENSIVE, 4.0 rating, and primary_type `bar` would NOT be promoted because `bar` is not in RESTAURANT_TYPES. This is correct — an expensive bar should be drinks_and_music, not fine_dining.

### Check 7: Flowers Type Guard

Strips `flowers` from places with primary_type in FLOWERS_BLOCKED_TYPES: garden_center, garden, farm, supplier, cemetery, funeral_home, restaurant, meal_takeaway, bar, food_store.

**Missing types that should strip flowers:**

| Type | Rationale |
|------|-----------|
| **convenience_store** | Not a flower shop. |
| **discount_store** | Not a flower shop. |
| **discount_supermarket** | Not a flower shop. |
| **warehouse_store** | Not a flower shop (Costco flower section is a stretch). |
| **wholesaler** | Not a retail flower shop. |
| **health_food_store** | Unlikely to have flowers. |
| **market** | Too generic — could be a flower market. Ambiguous. |

### Check 8: Delivery-Only Florist Detection

Strips flowers from non-florists matching delivery patterns: "flower delivery", "floral delivery", "same day delivery", "same-day delivery", "livraison de fleurs", "livraison fleurs", "blumen lieferung", "entrega de flores".

**Missing patterns:**

| Pattern | Language | Rationale |
|---------|----------|-----------|
| **"flowers delivered"** | English | Common phrasing. |
| **"order flowers"** | English | Online-only businesses. |
| **"send flowers"** | English | Same. |
| **"flower subscription"** | English | Subscription services, not walk-in shops. |
| **"consegna fiori"** | Italian | Flower delivery. |
| **"envio de flores"** | Spanish | Flower shipping. |
| **"bloemen bezorgen"** | Dutch | Flower delivery. |

---

## 7. GPT System Prompt Audit

The GPT-4o-mini system prompt (ai-verify-pipeline.ts lines 111-189) is the final classification authority. Here's a pedantic audit.

### Category Definitions — Completeness

**UPSCALE_FINE_DINING:**
- Definition is thorough. Signals are clear (upscale ambience, high-end cuisine, reservation culture, sommelier, Michelin).
- **Gap:** No mention of omakase restaurants, prix fixe menus, or chef's table experiences — all strong upscale signals.
- **Gap:** No mention of wine pairing menus.

**BRUNCH_LUNCH_CASUAL:**
- Clear. Includes chain restaurants with table service.
- **Gap:** "Food halls and food markets with vendors" is mentioned but Google may tag these as `food_court`. The deterministic filter doesn't explicitly handle the food_hall vs food_court distinction.

**DRINKS_AND_MUSIC:**
- Clear and comprehensive.
- **Gap:** "Speakeasies" and "rooftop bars" mentioned in definition but Google has no specific types for these. They'd be tagged as `bar` or `cocktail_bar`. This is fine — the prompt teaches GPT to recognize them from context.

**ICEBREAKERS:**
- Clear. "Any casual low-pressure spot for a 45-minute conversation."
- **CONFLICT with on-demand list:** The on-demand system includes bowling alleys, arcades, museums in icebreakers, but the GPT prompt defines it as cafes/coffee shops only. GPT would NOT classify a bowling alley as icebreakers. This is an intentional divergence — seeding uses AI definitions, on-demand uses broader experience definitions.

**MOVIES_THEATRE:**
- Clear. Cinemas + performing arts.
- **Gap:** "Drive-in cinemas" mentioned but Google's type is just `movie_theater`. GPT needs to recognize drive-ins from name/context.
- **Good:** Explicitly excludes "film production companies, booking agencies, dance studios."

**PLAY:**
- Clear. Broad activity list.
- **Gap:** "Escape rooms" mentioned but Google has no `escape_room` type. They'd be tagged as `amusement_center` or `tourist_attraction`. GPT needs to recognize from name.
- **Gap:** "Rock climbing" mentioned but Google has no specific type. Would be `sports_activity_location` or `adventure_sports_center`.
- **Gap:** "Kayaking, skydiving" mentioned — these are outdoor activities with no stable venue. Google might not have business listings for them.

**CREATIVE_ARTS:**
- Clear.
- **Gap:** "Immersive art (teamLab, Meow Wolf)" mentioned but Google tags these as `tourist_attraction` or `art_gallery`. GPT needs name recognition.

**NATURE:**
- Clear and comprehensive.

**GROCERIES:**
- "Specialty food stores, gourmet markets, butcher shops, cheese shops" — broader than the seeding type list (just grocery_store + supermarket).
- **Gap:** GPT might classify a butcher shop as groceries, but butcher_shop is never seeded. It would only appear if it shares a Google type with a seeded category.

**FLOWERS:**
- "Large supermarkets with staffed floral departments (like Whole Foods) qualify for BOTH flowers and groceries." — Clear guidance.
- **Gap:** How does GPT know if a supermarket has a "staffed floral department"? It can't — it relies on the name ("Whole Foods" is known, but "Kroger" or "Publix" also have them). This is the fundamental Flowers/Groceries problem.

### Worked Examples — Coverage Analysis

16 examples provided. Categories covered:

| Category | Examples | Count |
|----------|----------|-------|
| groceries + flowers | Whole Foods | 1 |
| play + brunch_lunch_casual | TopGolf | 1 |
| movies_theatre | AMC | 1 |
| brunch_lunch_casual + drinks_and_music | Barcelona Wine Bar | 1 |
| brunch_lunch_casual | Morgan Street Food Hall | 1 |
| reject (kids) | KidZania | 1 |
| drinks_and_music | Legends Nightclub | 1 |
| icebreakers | Paris Baguette | 1 |
| creative_arts | Living Kiln Studio | 1 |
| reject (fitness) | Planet Fitness | 1 |
| reject (beauty) | Beauty Blinks | 1 |
| reject (kids) | Urban Air Trampoline Park | 1 |
| creative_arts | Painting with a Twist | 1 |
| upscale_fine_dining | The Ruxton Steakhouse | 1 |
| upscale_fine_dining | Fogo de Chao | 1 |
| movies_theatre | Jazz at Lincoln Center | 1 |

**Missing example coverage:**

| Scenario | Why it matters |
|----------|---------------|
| **Nature venue** | No example of a park/trail/beach being accepted as nature. GPT might under-classify outdoor venues. |
| **Reclassify example** | No example showing a place moving from wrong category to right one. |
| **Multi-category (3+)** | No example of a place getting 3 categories (e.g., aquarium → creative_arts + play + nature). |
| **Low-confidence example** | No example where GPT should flag medium/low confidence. |
| **Brewery vs bar** | No example distinguishing a brewery (drinks_and_music) from a brewery with a restaurant (drinks_and_music + brunch_lunch_casual). |
| **Wine bar reclassify** | No example of a wine bar being assigned drinks_and_music when seeded as icebreakers. |
| **Grocery without flowers** | No example of a grocery store that should NOT get flowers (Aldi, Lidl, discount stores). |
| **Casual chain acceptance** | No example of Olive Garden being accepted as brunch_lunch_casual (not rejected). |
| **Upscale chain protection** | No example of Nobu/Morton's being classified as upscale_fine_dining despite being a chain. |

### Prompt Structure Observations

- Response format uses compact JSON keys (d, c, pi, w, r, f) to minimize output tokens. Smart for cost.
- `strict: true` JSON schema enforcement prevents hallucinated fields.
- Valid category slugs are filtered post-response (line 319-325). This catches any GPT hallucination of non-existent categories.
- `enforceExclusivity()` runs after GPT response. **REMOVED per user decision 2026-04-17** — upscale and casual can coexist. A restaurant that fits both categories (e.g., Nobu with its casual lunch and upscale dinner) gets both.

### Cost Optimization Observation

The prompt is ~1,800 tokens (system) + ~200 tokens (fact sheet) = ~2,000 input tokens per place. At $0.15/M input tokens for gpt-4o-mini, that's $0.0003 per place. Output is ~50-80 tokens at $0.6/M = $0.00004. Total: ~$0.00034 per place.

**The prompt could be shorter** — the 16 worked examples add ~800 tokens. But they're crucial for classification accuracy, so this is a good trade-off.

---

## 8. Chain Rule Audit

### Three-Tier System (per category-mapping.md)

| Tier | Action | List Source |
|------|--------|------------|
| Hard reject | Delete entirely | FAST_FOOD_BLACKLIST (67 chains) |
| Casual demotion | upscale → casual | CASUAL_CHAIN_DEMOTION (21 chains) |
| Upscale pass | Keep as fine_dining | **NO EXPLICIT LIST** — relies on NOT being in demotion list |

### Chains in CASUAL_CHAIN_DEMOTION not in category-mapping.md

| Chain | In category-mapping.md? | In CASUAL_CHAIN_DEMOTION? | Issue |
|-------|------------------------|--------------------------|-------|
| Texas Roadhouse | No | Yes | Filter is stricter than rules |
| Longhorn Steakhouse | No | Yes | Same |
| Nando's | No | Yes | Same |
| Yo! Sushi | No | Yes | Same |
| Pizza Express / PizzaExpress | No | Yes | Same |

These 5 chains are being demoted by the filter but aren't documented in the authoritative rules. The rules should be updated to include them, or the filter should be relaxed.

### Chains explicitly protected in rules but with NO code protection

| Chain | category-mapping.md says | Code protection? |
|-------|--------------------------|-----------------|
| Nobu | fine_dining (pass) | NONE — relies on absence from demotion list |
| Morton's | fine_dining (pass) | NONE |
| Nusr-Et (Salt Bae) | fine_dining (pass) | NONE |
| Perry's Steakhouse | fine_dining (pass) | NONE |

**Risk:** If any of these names accidentally enter CASUAL_CHAIN_DEMOTION (through a bulk update, copy-paste error, etc.), they'd be silently demoted. An UPSCALE_CHAIN_PROTECTION whitelist would prevent this.

---

## 9. Flowers/Groceries Overlap

### The Problem

Both Flowers and Groceries seed with `grocery_store` + `supermarket`. The same physical store gets fetched by both seeding configs. The deduplication prevents duplicate rows, but the place enters the pool tagged with whichever seeding category found it first.

### How Categories Are Actually Assigned

1. **Seeding:** Tags the place with `seeding_category` (either "flowers" or "groceries" depending on which search found it)
2. **AI validation:** Independently assigns `ai_categories` — could be `["groceries"]`, `["flowers"]`, or `["groceries", "flowers"]`
3. **GPT's guidance:** "Large supermarkets with staffed floral departments (like Whole Foods) qualify for BOTH"

### Where It Breaks

GPT has no reliable signal for "staffed floral department." It relies on:
- **Name recognition** — "Whole Foods" → both. But what about "HEB"? "Publix"? "Wegmans"? These also have excellent floral departments.
- **No metadata** — Google Places API doesn't return "has floral department" as a field.
- **Web evidence** — Serper search might find mentions of floral services, but it's unreliable.

### Current Safety Nets

| Filter | What it catches |
|--------|----------------|
| FLOWERS_BLOCKED_TYPES | Strips flowers from: garden_center, garden, farm, supplier, cemetery, funeral_home, restaurant, bar, food_store |
| Seeding excludedPrimaryTypes (flowers) | Blocks: asian_grocery_store, health_food_store, farmers_market, convenience_store, discount_store, discount_supermarket, wholesaler, warehouse_store, butcher_shop, liquor_store, garden_center |
| Delivery pattern check | Strips flowers from non-florists with "delivery" in name |

### What STILL slips through

A discount supermarket like **Aldi** or **Lidl** gets tagged by Google as `grocery_store`. Seeding's `excludedPrimaryTypes` for flowers includes `discount_supermarket` and `discount_store`, but NOT `grocery_store` itself (because that would block Whole Foods too). If Google tags Aldi as `grocery_store` (not `discount_supermarket`), it enters the pool and GPT must decide.

**GPT's decision:** Highly dependent on web evidence and name recognition. GPT knows "Aldi" is budget and probably won't assign flowers. But obscure regional discount chains? Coin flip.

### Recommendations

1. **Add discount chain names to a FLOWERS_STRIP_NAMES list:** Aldi, Lidl, Dollar General, Dollar Tree, Family Dollar, Save-A-Lot, Grocery Outlet, WinCo, Aldi Sud, Aldi Nord, Penny, Netto, etc.
2. **Add known floral supermarkets to a FLOWERS_KEEP_NAMES list:** Whole Foods, Trader Joe's, Wegmans, HEB, Publix, Kroger, Safeway, etc. (These are large supermarkets known for floral departments.)
3. **Or:** Accept the imprecision and rely on GPT. The flowers category is hidden from users anyway — it's used for gifting features. A few false positives (discount stores with flowers) have low user impact.

---

## 10. Venue Name Keyword Sync

### EXCLUDED_VENUE_NAME_KEYWORDS (categoryPlaceTypes.ts) — 25 patterns

Used by: on-demand card generation (`isExcludedVenueName()` / `isChildVenueName()`)

### EXCLUSION_KEYWORDS['kids'] (ai-verify-pipeline.ts) — 12 keywords

Used by: AI validation deterministic filter

### Gap Analysis

| Keyword | In categoryPlaceTypes | In ai-verify kids | Status |
|---------|----------------------|-------------------|--------|
| kids / kidz | YES | YES ("kids play", "kidz") | ✓ Synced |
| children / child | YES | YES ("children's") | ✓ Synced |
| toddler / toddlers | YES | **NO** | **GAP** |
| baby / babies | YES | **NO** | **GAP** |
| bounce / bouncy | YES | **NO** | **GAP** |
| trampoline | YES | **NO** | **GAP** |
| play space / playspace | YES | **NO** | **GAP** |
| little ones | YES | **NO** | **GAP** |
| mommy / mommy and me | YES | **NO** | **GAP** |
| tot / tots | YES | **NO** | **GAP** |
| preschool / pre-school | YES | YES (in education, not kids) | Partial |
| daycare / day care | YES | YES (in education, not kids) | Partial |
| jungle gym | YES | **NO** | **GAP** |
| fun zone / funzone | YES | **NO** | **GAP** |
| kidzone / kid zone | YES | YES | ✓ Synced |
| school | YES | YES (education) | ✓ Synced |
| academy | YES | **NO** | **GAP** |
| institute | YES | **NO** | **GAP** |
| training center | YES | **NO** | **GAP** |
| learning center | YES | **NO** | **GAP** |
| university / college | YES | YES (education) | ✓ Synced |
| seminary | YES | **NO** | **GAP** |
| indoor playground | NO | YES | Reverse gap |
| chuck e. cheese | NO | YES | Reverse gap |
| enfants | NO | YES | Reverse gap |
| kinder | NO | YES | Reverse gap |
| bambini | NO | YES | Reverse gap |
| infantil | NO | YES | Reverse gap |
| splash pad | NO | YES | Reverse gap |
| soft play | NO | YES | Reverse gap |

**13 keywords in categoryPlaceTypes missing from ai-verify.** These are venue names that would pass AI validation but get caught by on-demand filtering — inconsistent behavior.

**8 keywords in ai-verify missing from categoryPlaceTypes.** These are international/specific terms that AI catches but on-demand doesn't.

### Impact

A venue named "Toddler Bounce World" would:
1. **Pass** seeding (no name-based filtering in seeding)
2. **Pass** AI validation deterministic filter (no "toddler" or "bounce" in EXCLUSION_KEYWORDS)
3. **Reach GPT** — GPT would likely reject it ("kids-only venue")
4. But if GPT misses it → **Caught** by on-demand `isExcludedVenueName()` before reaching users

So the gap is **mitigated by GPT** in most cases. But it's still an inconsistency that should be fixed.

---

## 11. Recommendations (Prioritized)

### P0 — High Impact, Easy Fix

**11.1. Add ~58 missing restaurant types to casual_eats seeding**

Add to `seedingCategories.ts` casual_eats `includedTypes`:
```
afghani_restaurant, african_restaurant, argentinian_restaurant, asian_fusion_restaurant,
australian_restaurant, austrian_restaurant, bangladeshi_restaurant, basque_restaurant,
bavarian_restaurant, belgian_restaurant, british_restaurant, burmese_restaurant,
cajun_restaurant, californian_restaurant, cambodian_restaurant, cantonese_restaurant,
chilean_restaurant, chinese_noodle_restaurant, colombian_restaurant, croatian_restaurant,
cuban_restaurant, czech_restaurant, danish_restaurant, dim_sum_restaurant,
dumpling_restaurant, dutch_restaurant, eastern_european_restaurant, european_restaurant,
family_restaurant, filipino_restaurant, fish_and_chips_restaurant, halal_restaurant,
hawaiian_restaurant, hungarian_restaurant, irish_restaurant, israeli_restaurant,
japanese_curry_restaurant, japanese_izakaya_restaurant, latin_american_restaurant,
malaysian_restaurant, mongolian_barbecue_restaurant, north_indian_restaurant,
pakistani_restaurant, persian_restaurant, polish_restaurant, portuguese_restaurant,
romanian_restaurant, russian_restaurant, scandinavian_restaurant, soul_food_restaurant,
south_american_restaurant, south_indian_restaurant, southwestern_us_restaurant,
sri_lankan_restaurant, swiss_restaurant, taiwanese_restaurant, tex_mex_restaurant,
tibetan_restaurant, tonkatsu_restaurant, ukrainian_restaurant, western_restaurant,
yakiniku_restaurant, yakitori_restaurant
```

Also add cuisine types that could be upscale to `fine_dining` seeding: basque_restaurant, persian_restaurant, scandinavian_restaurant, argentinian_restaurant, swiss_restaurant.

Also add these to the AI pipeline's RESTAURANT_TYPES for promotion eligibility.

**11.2. Sync venue name keywords between ai-verify and categoryPlaceTypes**

Add to `EXCLUSION_KEYWORDS['kids']` in ai-verify-pipeline.ts:
```
"toddler", "baby", "babies", "bounce", "bouncy", "trampoline",
"little ones", "mommy", "mommy and me", "fun zone", "funzone",
"jungle gym", "play space", "playspace"
```

Add to `EXCLUDED_VENUE_NAME_KEYWORDS` in categoryPlaceTypes.ts:
```
"indoor playground", "chuck e. cheese", "enfants", "kinder",
"bambini", "infantil", "splash pad", "soft play"
```

**11.3. Add missing seeding types to on-demand lists**

Add to `MINGLA_CATEGORY_PLACE_TYPES` in categoryPlaceTypes.ts:
- Nature & Views: vineyard, wildlife_park, woods, mountain_peak, river, island, city_park, fountain
- Icebreakers: acai_shop, bagel_shop, cat_cafe, chocolate_shop, confectionery, pastry_shop, candy_store, dessert_restaurant
- Upscale & Fine Dining: fondue_restaurant, oyster_bar_restaurant
- Brunch, Lunch & Casual: noodle_shop, hot_pot_restaurant, dim_sum_restaurant, and all the new cuisine types
- Play: adventure_sports_center, ice_skating_rink, ferris_wheel
- Creative & Arts: historical_place, historical_landmark, monument, sculpture, castle

### P1 — High Impact, Medium Effort

**11.4. Create UPSCALE_CHAIN_PROTECTION whitelist**

New constant in ai-verify-pipeline.ts:
```typescript
const UPSCALE_CHAIN_PROTECTION = [
  "nobu", "morton's", "nusr-et", "salt bae", "perry's steakhouse",
  "capital grille", "ruth's chris", "fleming's", "eddie v's",
  "del frisco's", "mastro's", "stk", "boa steakhouse",
  "peter luger", "smith & wollensky", "the palm",
  "lawry's", "cut by wolfgang", "bazaar", "jean-georges",
];
```

Modify Check 5 (casual chain demotion) to skip if name matches UPSCALE_CHAIN_PROTECTION.

**11.5. Add golf types to play seeding**

Add to play `includedTypes`: `golf_course`, `indoor_golf_course`
Add to play `excludedPrimaryTypes`: nothing (these are unambiguous)

**11.6. Add missing fast food chains to blacklist**

Add to FAST_FOOD_BLACKLIST: portillo's, wawa, sheetz, auntie anne's, cinnabon, habit burger, smashburger, noodles & company, mcalister's, au bon pain, sbarro

Add international: hungry jack's, max burgers, hesburger, lotteria, mos burger, yoshinoya, oporto

**11.7. Add missing sit-down chains to CASUAL_CHAIN_DEMOTION**

Add: bob evans, perkins, friendly's, shoney's, ruby tuesday, hooters, bonefish grill, carrabba's, cheddar's, buca di beppo, maggiano's, p.f. chang's, benihana

**11.8. Expand FLOWERS_BLOCKED_TYPES**

Add: convenience_store, discount_store, discount_supermarket, warehouse_store, wholesaler, health_food_store

### P2 — Medium Impact, Low Effort

**11.9. Add missing restaurant types to RESTAURANT_TYPES (for fine dining promotion)**

Add: basque_restaurant, persian_restaurant, scandinavian_restaurant, swiss_restaurant, argentinian_restaurant, european_restaurant, australian_restaurant, british_restaurant

**11.10. Add GPT worked examples for uncovered scenarios**

Add examples for:
- Nature venue acceptance (park → nature)
- Reclassify (seeded as X, reclassified to Y)
- Grocery without flowers (Aldi → groceries only)
- Casual chain acceptance (Olive Garden → brunch_lunch_casual)
- Upscale chain protection (Morton's → upscale_fine_dining)
- Brewery with restaurant (dual category)
- Low-confidence case (no hours, unclear type)

**11.11. Add historical_landmark to creative_arts seeding**

Currently only historical_place is in seeding. Google has both as separate types.

**11.12. Document CASUAL_CHAIN_DEMOTION vs category-mapping.md differences**

Either update category-mapping.md to include Texas Roadhouse, Longhorn, Nando's, Yo! Sushi, Pizza Express, or remove them from the demotion list.

### P3 — Low Impact, Defensive

**11.13. Add government/housing types to BLOCKED_PRIMARY_TYPES**

Add: government_office, local_government_office, embassy, city_hall, neighborhood_police_station, apartment_building, apartment_complex, condominium_complex, housing_complex, campground, rv_park, mobile_home_park, stable

**11.14. Add climbing/fitness niche keywords to EXCLUSION_KEYWORDS['fitness']**

Add: "climbing gym", "barre studio", "spin class", "orangetheory", "f45"

**11.15. Add English gambling terms to EXCLUSION_KEYWORDS['gambling']**

Add: "bookmaker", "betting parlor", "off-track betting", "otb", "pachinko"

**11.16. Consider adding flea_market and thrift_store to play/creative_arts seeding**

Thrift store dates and flea market browsing are popular activities. Low-risk addition with AI as quality gate.

---

## Summary Metrics

| Area | Current State | After P0 Fixes | After P0+P1 |
|------|--------------|----------------|-------------|
| Restaurant types seeded | 49 of 166 (30%) | ~110 of 166 (66%) | ~110 of 166 (66%) |
| Entertainment types seeded | 42 of 55 (76%) | 42 of 55 (76%) | 44 of 55 (80%) |
| Culture types seeded | 12 of 12 (100%) | 12 of 12 (100%) | 12 of 12 (100%) |
| Natural feature types seeded | 8 of 8 (100%) | 8 of 8 (100%) | 8 of 8 (100%) |
| Seeding ↔ On-demand sync | ~30 mismatches | ~5 mismatches | ~2 mismatches |
| Venue name keywords synced | 12 of 25 (48%) | 25 of 25 (100%) | 25 of 25 (100%) |
| Fast food chains covered | 67 | 67 | ~85 |
| Casual chains covered | 21 | 21 | ~34 |
| Upscale chain protection | 0 chains | 0 chains | ~20 chains |
| GPT worked examples | 16 | 16 | ~23 |

---

## Files That Need Changes

| File | Changes | Priority |
|------|---------|----------|
| `supabase/functions/_shared/seedingCategories.ts` | Split casual_eats into 2 configs, add golf types, historical_landmark, donut_shop, pastry_shop | P0, P1 |
| `supabase/functions/_shared/categoryPlaceTypes.ts` | Sync on-demand lists with seeding, add venue name keywords | P0 |
| `supabase/functions/ai-verify-pipeline/index.ts` | Sync keywords, add chains, create UPSCALE_CHAIN_PROTECTION, expand RESTAURANT_TYPES, add GPT examples, fix garden store flowers leak (types array check) | P0, P1, P2 |
| `.claude/skills/mingla-categorizer/references/category-mapping.md` | Update to 10-category system, document chain rule differences | P0, P2 |

---

## 12. Google 50-Type Limit & casual_eats Split Strategy

### The Constraint

Google Places API (New) Nearby Search allows a **maximum of 50 types** in the `includedTypes` parameter per request. This is a hard API limit — exceeding it returns an error.

### Current Type Counts Per Seeding Config

| Config | Current Count | At Limit? |
|--------|--------------|-----------|
| **casual_eats** | **49** | **YES — 1 away from the wall** |
| nature_views | 23 | No |
| first_meet (icebreakers) | 21 | No |
| drink | 16 | No |
| play | 14 | No |
| creative_arts | 14 | No |
| live_performance | 10 | No |
| fine_dining | 8 | No |
| picnic_park | 3 | No |
| flowers | 3 | No |
| groceries | 2 | No |
| watch | 1 | No |

### The Problem

The audit identified ~58 missing restaurant cuisine types from Google Table A. Adding them to the single casual_eats config would push it to ~107 types — more than double the limit.

### The Solution: Split casual_eats Into Two Configs

The same pattern already exists in the codebase: nature has two configs (nature_views + picnic_park), and movies_theatre has two configs (watch + live_performance). Multiple seeding configs can map to the same `appCategorySlug`.

**Config 1: casual_eats (keep existing — 49 types)**

The current list stays unchanged. These are the highest-frequency cuisine types that cover the majority of restaurants in any city:

restaurant, bistro, brunch_restaurant, breakfast_restaurant, diner, cafe, coffee_shop, sandwich_shop, pizza_restaurant, hamburger_restaurant, mexican_restaurant, mediterranean_restaurant, thai_restaurant, vegetarian_restaurant, american_restaurant, asian_restaurant, barbecue_restaurant, brazilian_restaurant, caribbean_restaurant, chinese_restaurant, ethiopian_restaurant, french_restaurant, fusion_restaurant, gastropub, german_restaurant, greek_restaurant, indian_restaurant, indonesian_restaurant, italian_restaurant, japanese_restaurant, korean_restaurant, korean_barbecue_restaurant, lebanese_restaurant, middle_eastern_restaurant, moroccan_restaurant, peruvian_restaurant, ramen_restaurant, seafood_restaurant, spanish_restaurant, sushi_restaurant, tapas_restaurant, turkish_restaurant, vegan_restaurant, vietnamese_restaurant, buffet_restaurant, deli, food_court, noodle_shop, hot_pot_restaurant

**Config 2: casual_eats_world (new — ~50 types)**

All the cuisine-specific types that Google offers but Config 1 doesn't cover. These capture the long tail of world cuisines:

afghani_restaurant, african_restaurant, argentinian_restaurant, asian_fusion_restaurant, australian_restaurant, austrian_restaurant, bangladeshi_restaurant, basque_restaurant, bavarian_restaurant, belgian_restaurant, british_restaurant, burmese_restaurant, cajun_restaurant, californian_restaurant, cambodian_restaurant, cantonese_restaurant, chilean_restaurant, chinese_noodle_restaurant, colombian_restaurant, croatian_restaurant, cuban_restaurant, czech_restaurant, danish_restaurant, dim_sum_restaurant, dumpling_restaurant, dutch_restaurant, eastern_european_restaurant, european_restaurant, family_restaurant, filipino_restaurant, fish_and_chips_restaurant, halal_restaurant, hawaiian_restaurant, hungarian_restaurant, irish_restaurant, israeli_restaurant, japanese_curry_restaurant, latin_american_restaurant, malaysian_restaurant, mongolian_barbecue_restaurant, north_indian_restaurant, pakistani_restaurant, persian_restaurant, polish_restaurant, portuguese_restaurant, romanian_restaurant, russian_restaurant, scandinavian_restaurant, soul_food_restaurant, south_american_restaurant

**Config 3: casual_eats_extended (new — remaining ~15 types)**

The remaining cuisine types plus ambiguous/borderline types where AI validation is the quality gate:

south_indian_restaurant, southwestern_us_restaurant, sri_lankan_restaurant, swiss_restaurant, taiwanese_restaurant, tex_mex_restaurant, tibetan_restaurant, tonkatsu_restaurant, ukrainian_restaurant, western_restaurant, yakiniku_restaurant, yakitori_restaurant, burrito_restaurant, chicken_wings_restaurant, taco_restaurant

All three configs share:
- `appCategory: 'Brunch, Lunch & Casual'`
- `appCategorySlug: 'brunch_lunch_casual'`
- Same `excludedPrimaryTypes` array

### Cost Impact

Each tile in a city gets searched once per seeding config. Adding 2 more casual_eats configs means each tile gets 3 restaurant searches instead of 1. For a city with 200 tiles:

| | Before | After |
|--|--------|-------|
| API calls for casual_eats | 200 | 600 |
| Cost at $0.032/call | $6.40 | $19.20 |
| Additional cost per city | — | +$12.80 |

This is modest. The bigger cost factor is that many results will be duplicates (a restaurant tagged as both `restaurant` and `cuban_restaurant` appears in Config 1 and Config 2). The upsert deduplication handles this — no duplicate rows, just wasted API calls. In practice, Config 2 and 3 will surface primarily restaurants that Config 1 missed because they ONLY have a cuisine-specific type, which is exactly the gap we're fixing.

### Types That Should NOT Go in casual_eats

Per the categorizer's verdict, these types from Google Table A are explicitly excluded:

| Type | Reason |
|------|--------|
| cafeteria | Institutional dining, not date-worthy |
| fast_food_restaurant | Already in exclusions everywhere |
| hot_dog_restaurant | Counter-service / street food |
| hot_dog_stand | Street vendor |
| kebab_shop | Predominantly counter-service in most markets |
| meal_delivery | Not a venue |
| meal_takeaway | Not a dine-in venue |
| pizza_delivery | Not a venue |
| salad_shop | Counter-service (Sweetgreen etc.), already in fast food blacklist |
| shawarma_restaurant | Predominantly counter-service |
| snack_bar | Not a date spot |
| candy_store | Retail, no seating |
| dog_cafe | Risk of false exclusion ("dog" keyword), niche, already caught by `cafe` type |
| falafel_restaurant | Predominantly counter-service |
| gyro_restaurant | Predominantly counter-service |
| soup_restaurant | Ambiguous — often counter-service |

Also excluded per categorizer verdict:

| Type | Reason |
|------|--------|
| flea_market | Auto-rejection #7: seasonal/unpredictable |
| thrift_store | Auto-rejection #9: retail |
| internet_cafe | Gaming cafes, not date spots |
| ski_resort | Seasonal, multi-day destination |
| barbecue_area | Facility amenity, not a destination |

---

## 13. Garden Store Flowers Leak

### The Problem

Garden stores and nurseries are appearing in the flowers category even though they sell potted plants, soil, and gardening supplies — not date-worthy bouquets.

### Root Cause

The leak happens because **all filters only check `primary_type`, never the full `types` array.**

Here's the chain of events:

1. A garden center that also sells cut flowers gets tagged by Google with `types: ['garden_center', 'florist', 'store']`
2. Google assigns `primary_type: 'florist'` (because cut flowers are one of their services)
3. Seeding searches for `includedTypes: ['florist']` — Google returns this place
4. Seeding's `excludedPrimaryTypes` checks for `garden_center` — but `primary_type` is `florist`, so it passes
5. AI validation's `FLOWERS_BLOCKED_TYPES` checks `primary_type` — it's `florist`, so it passes
6. GPT sees "name: [Garden Store Name], type: florist" and may assign flowers

At no point does any system check whether `garden_center` appears in the `types` array.

### The Fix (Two Layers)

**Layer 1: Deterministic filter — check the `types` array, not just `primary_type`**

In `ai-verify-pipeline.ts`, the flowers stripping logic (line 438) currently does:

```typescript
if (cats.includes("flowers") && FLOWERS_BLOCKED_TYPES.has(primaryType)) {
```

It should ALSO check the types array:

```typescript
const typesArray: string[] = place.types || [];
const hasBlockedFlowerType = FLOWERS_BLOCKED_TYPES.has(primaryType)
  || typesArray.some(t => FLOWERS_BLOCKED_TYPES.has(t));

if (cats.includes("flowers") && hasBlockedFlowerType) {
```

This catches any place that has `garden_center`, `garden`, `farm`, or `supplier` ANYWHERE in its types, even if the primary_type is `florist`.

**Layer 2: Name-based garden store detection**

Add a new constant for garden/nursery name patterns:

```typescript
const GARDEN_STORE_PATTERNS = [
  "garden center", "garden centre", "garden store",
  "nursery", "plant nursery", "garden nursery",
  "lawn and garden", "lawn & garden",
  "landscaping", "landscape supply",
  "home and garden", "home & garden",
  "gartencenter", "gartencenter", "jardinerie",
  "vivero", "vivaio", "tuincentrum",
  "baumarkt", "home depot", "lowe's", "lowes",
  "bunnings", "b&q", "leroy merlin", "hornbach",
  "obi ", "castorama", "gamm vert",
];
```

In the flowers stripping logic, add:

```typescript
const isGardenStore = GARDEN_STORE_PATTERNS.some(p =>
  place.name.toLowerCase().includes(p)
);

if (cats.includes("flowers") && (hasBlockedFlowerType || isGardenStore)) {
  // Strip flowers — garden stores sell plants, not bouquets
}
```

**Exception:** If the primary_type is `florist` AND the name does NOT contain garden patterns AND the types array does NOT contain `garden_center` — keep flowers. This is a real florist.

### The Authoritative Rule

From category-mapping.md:

> **flowers test:** "Can I reliably walk in and leave with a nice, date-worthy bouquet?"
> **Excludes:** Garden centers (potted plants only)
> **Edge case:** Garden center that also sells bouquets → flowers ONLY if cut bouquets are a regular offering, not seasonal

The key distinction: a **florist** makes and sells bouquets as their primary business. A **garden center** sells plants, soil, tools, and might have some pre-wrapped bouquets by the register as an afterthought. The test is whether bouquets are the primary offering.

### Files to Change

| File | Change |
|------|--------|
| `supabase/functions/ai-verify-pipeline/index.ts` | Add `GARDEN_STORE_PATTERNS`, modify flowers stripping to check `types` array + name patterns |
| `supabase/functions/_shared/seedingCategories.ts` | Add `home_improvement_store` to flowers `excludedPrimaryTypes` if not already present (already there — confirmed) |

---

## 14. Categorizer Verdict on Audit Recommendations

The categorization engine reviewed all 16 recommendations from Section 11 against the authoritative category-mapping.md rules. Verdict:

### APPROVED (Do These)

| # | Recommendation | Verdict |
|---|---------------|---------|
| 11.1 | Add ~58 missing restaurant types (via split) | **YES** — biggest impact. Must split into 2-3 configs due to 50-type limit. |
| 11.2 | Sync venue name keywords | **YES** — pure hygiene, no controversy. |
| 11.3 | Add missing seeding types to on-demand lists | **YES** — sync gap, not a classification change. |
| 11.4 | Create UPSCALE_CHAIN_PROTECTION whitelist | **YES** — rules explicitly name protected chains. Code should enforce. |
| 11.5 | Add golf_course, indoor_golf_course to play | **YES** — rules literally say "indoor golf simulators (TopGolf-style)." |
| 11.6 | Add missing fast food chains to blacklist | **YES** — defensive, no downside. |
| 11.7 | Add missing sit-down chains to CASUAL_CHAIN_DEMOTION | **YES** — with care (see note below). |
| 11.8 | Expand FLOWERS_BLOCKED_TYPES | **YES** — plus the types-array check fix from Section 13. |
| 11.9 | Add missing restaurant types to RESTAURANT_TYPES | **YES** — needed for auto-promotion of world cuisines. |
| 11.10 | Add GPT worked examples | **YES** — covers real gaps in example coverage. |
| 11.11 | Add historical_landmark to creative_arts | **YES** — Google has it as a separate type from historical_place. |
| 11.12 | Document chain list differences | **YES** — rules and code must agree. |
| 11.13 | Add government/housing to BLOCKED_PRIMARY_TYPES | **YES** — defensive, near-zero risk. |
| 11.14 | Add fitness niche keywords | **YES** — "orangetheory", "f45" are real gaps. |
| 11.15 | Add English gambling terms | **YES** — "bookmaker", "betting parlor" are real gaps. |

### REJECTED (Do Not Do These)

| # | Recommendation | Verdict | Reason |
|---|---------------|---------|--------|
| 11.16 | Add flea_market, thrift_store to play/creative_arts | **NO** | Violates auto-rejection rules #7 (seasonal) and #9 (retail). |

### NEEDS PRODUCT DECISION

| Issue | Question |
|-------|----------|
| **Icebreakers identity** | Is icebreakers "cozy cafes for conversation" (what the rules say) or "any fun first-date activity" (what on-demand lists say)? Seeding and on-demand currently disagree. Rules say cafes. |
| **Wellness removal** | ORCH-0434 removed wellness. The rules still define it. Should category-mapping.md drop it, or should the category come back? Couples spa is a real date activity with no current home. |
| **Post-fetch filter policy** | Should the fast food blacklist run during seeding (keeping the pool cleaner) or stay AI-only (current design)? Trade-off: cleaner pool vs. simpler seeding code. |

### NOTE on 11.7 (Casual Chain Additions)

Adding chains to CASUAL_CHAIN_DEMOTION is only safe for chains that are **genuinely casual sit-down** — table service, real menus, but not upscale. The following from the audit are approved:

**Add:** Bob Evans, Perkins, Friendly's, Ruby Tuesday, Hooters, Cheddar's, Buca di Beppo, P.F. Chang's

**Do NOT add (borderline upscale):** Bonefish Grill, Carrabba's, Maggiano's, Seasons 52, Benihana — these need individual assessment against the fine_dining quality test before being demoted.

**Definitely do NOT add (these are upscale):** Capital Grille, Ruth's Chris, Fleming's, Eddie V's, Del Frisco's, Mastro's, STK — these should go on the UPSCALE_CHAIN_PROTECTION whitelist instead.

---

## 15. Play Category Deep Audit

### The Problem

Four types of venues are leaking into the play category that don't belong:
1. Sports parks / recreation centers (e.g., Bethesda Park)
2. Farms with seasonal attractions (e.g., Phillips Farms)
3. Children's parks and play centers
4. Community centers

All four share the same root cause: Google assigns them a `primary_type` that's in our `includedTypes` (usually `amusement_center` or `amusement_park`), and our filters only check `primary_type`, never the full `types` array.

### Play Category Definition (from category-mapping.md)

> "Active fun, games, competition, thrills, or adventure. This is about **adults having fun on a date.**"

> Test: "Will the user be actively playing, competing, having physical fun, or experiencing a thrill on this date?"

### Current Play Seeding Config

**includedTypes (14):** amusement_center, bowling_alley, miniature_golf_course, go_karting_venue, paintball_center, video_arcade, karaoke, amusement_park, adventure_sports_center, casino, ferris_wheel, roller_coaster, water_park, ice_skating_rink

**excludedPrimaryTypes (28):** movie_theater, performing_arts_theater, concert_hall, opera_house, philharmonic_hall, comedy_club, live_music_venue, dance_hall, bar, cocktail_bar, lounge_bar, wine_bar, night_club, restaurant, fine_dining_restaurant, fast_food_restaurant, cafe, coffee_shop, museum, art_gallery, art_museum, gym, fitness_center, shopping_mall, corporate_office, coworking_space, convention_center, wedding_venue, banquet_hall, community_center, park, beach, scenic_spot, hiking_area, national_park, hotel, motel, store, department_store

### Leak 1: Sports Parks & Recreation Centers

**How they get in:** Google tags multipurpose recreation complexes as `amusement_center` or `adventure_sports_center`. A place like "Bethesda Park Recreation Center" with basketball courts, a pool, and athletic fields gets `primary_type: amusement_center` because it has recreational facilities.

**What's missing from excludedPrimaryTypes:**

| Type | Why it should be excluded |
|------|--------------------------|
| `sports_club` | Sports clubs, not date activities |
| `sports_activity_location` | Generic sports facility |
| `sports_complex` | Athletic complex |
| `athletic_field` | Playing fields |
| `swimming_pool` | Public pools (fitness, not fun) |
| `tennis_court` | Court sports |
| `playground` | Children's equipment |
| `sports_coaching` | Training facilities |
| `sports_school` | Training facilities |
| `arena` | Spectator venues |
| `stadium` | Spectator venues |
| `race_course` | Spectator venues |
| `fitness_center` | Already excluded, but confirm |

**What's missing from the deterministic filter:**

No `sports_recreation` keyword category exists. These name patterns pass unchecked:

```
"sports park", "recreation center", "rec center", "athletic center",
"athletic complex", "sports complex", "community pool", "public pool",
"sports field", "ball field", "baseball field", "softball field",
"soccer field", "football field", "tennis center", "swim center",
"aquatic center", "fitness park", "sportplatz", "polideportivo",
"centro deportivo", "complexe sportif", "leisure centre",
"recreation ground", "sports ground", "playing field"
```

**What's missing from the types array check:**

The deterministic filter never checks the `types` array. A place with `types: ['sports_complex', 'amusement_center']` and `primary_type: 'amusement_center'` passes because only `primary_type` is checked.

### Leak 2: Farms with Seasonal Attractions

**How they get in:** Farms with seasonal activities (pumpkin patches, corn mazes, hayrides, apple picking) get tagged by Google as `amusement_park` or `tourist_attraction` because they offer entertainment. The play seeding config includes `amusement_park`.

**What's missing from excludedPrimaryTypes:**

| Type | Why it should be excluded |
|------|--------------------------|
| `farm` | Agricultural — not a date venue |
| `ranch` | Agricultural — not a date venue |

Note: Even adding these to `excludedPrimaryTypes` won't fully fix it. The problem is that Google assigns `primary_type: amusement_park` to farms with seasonal attractions. The `primary_type` is `amusement_park`, not `farm`. The `farm` type is buried in the `types` array.

**What's missing from the deterministic filter:**

No `farm_seasonal` keyword category exists. These name patterns pass unchecked:

```
"farm", "farms", "ranch", "orchard", "pumpkin patch", "corn maze",
"hayride", "u-pick", "pick your own", "pyo ", "farmstead",
"agritourism", "bauernhof", "ferme ", "granja", "fattoria",
"apple picking", "berry picking", "strawberry picking"
```

**Why farms don't belong in play:**

The authoritative rules say:
> Auto-rejection #7: "SEASONAL/UNPREDICTABLE: farmers markets, flea markets, pop-ups with no fixed schedule"

Most farm attractions are seasonal (fall pumpkin patches, spring berry picking). They fail the reliability test. A user browsing play in February shouldn't see a pumpkin farm that's closed until October.

### Leak 3: Children's Parks & Play Centers

**How they get in:** Kids' play centers get tagged by Google as `amusement_center` (which is in our `includedTypes`). Examples: indoor playgrounds, bounce houses, kids' adventure parks, children's discovery centers.

**What's currently caught:**

The deterministic filter's kids keywords: "kids play", "children's", "indoor playground", "kidz", "chuck e. cheese", "kidzone", "enfants", "kinder", "bambini", "infantil", "splash pad", "soft play"

**What's NOT caught — massive keyword gaps:**

| Missing Pattern | Examples that would slip through |
|-----------------|--------------------------------|
| "play center" / "play centre" | "Adventure Play Centre" |
| "playland" | "Fantasy Playland" |
| "funland" | "Super Funland" |
| "wonderland" | "Kids Wonderland" (but "Alice in Wonderland" themed bar would be false positive — needs "kids" or children's context) |
| "discovery zone" | "Discovery Zone Family Fun" |
| "imagination station" | "Imagination Station" |
| "little explorers" | "Little Explorers Adventure" |
| "tiny town" | "Tiny Town Play Village" |
| "jungle gym" | Already in categoryPlaceTypes but NOT in ai-verify EXCLUSION_KEYWORDS |
| "bounce house" / "bouncy castle" | "Bounce House Party Center" |
| "ball pit" | "Ball Pit Kingdom" |
| "climbing frame" | "Indoor Climbing Frame Park" |
| "play area" | "Indoor Play Area" |
| "adventure playground" | "Bethesda Adventure Playground" |
| "sensory play" | "Sensory Play Studio" |
| "party center" / "party centre" | "Kids Party Center" (already caught by "kids" but "Birthday Party Centre" isn't) |
| "family fun" | "Family Fun Center" — tricky, some adult-friendly venues use this |
| "play zone" | "Super Play Zone" |
| "play world" | "Play World" |
| "play park" | "Indoor Play Park" |
| "play land" | "Play Land Adventure" |

**The indoor_playground problem:**

`indoor_playground` is in the on-demand Play type list (categoryPlaceTypes.ts line 97) but NOT in the seeding `includedTypes`. This means:
- Seeding never searches for it (good)
- But on-demand experience generation could pull indoor playgrounds into play suggestions (bad)
- `indoor_playground` should be REMOVED from the on-demand Play list and added to Play's `CATEGORY_EXCLUDED_PLACE_TYPES`

**The types array gap:**

A children's play center with `types: ['indoor_playground', 'amusement_center']` and `primary_type: 'amusement_center'` passes all filters. The deterministic filter should check: if `playground`, `indoor_playground`, or `childrens_camp` appears ANYWHERE in the `types` array, reject for play (unless overridden by clear adult-venue signals).

### Leak 4: Community Centers

**How they get in:** Community centers that host recreational activities (game nights, karaoke, dance classes) get tagged by Google as `amusement_center` or `community_center`. The seeding config DOES exclude `community_center` as a `primary_type` — but if Google assigns `primary_type: amusement_center` with `community_center` in the `types` array, it passes.

**What's missing from the deterministic filter:**

No `community_civic` keyword category exists. These patterns pass unchecked:

```
"community center", "community centre", "civic center", "civic centre",
"recreation department", "parks and recreation", "parks & recreation",
"parks & rec", "senior center", "senior centre", "youth center",
"youth centre", "community hall", "town hall", "village hall",
"gemeindezentrum", "maison de quartier", "centro comunitario",
"centre communautaire", "community house", "neighborhood center",
"neighbourhood centre"
```

**The types array gap:**

Same as above. If `community_center` appears in the `types` array, it should be rejected for play regardless of `primary_type`.

### Comprehensive Fix for Play

**A. Seeding config changes (seedingCategories.ts)**

Add to play `excludedPrimaryTypes`:
```
sports_club, sports_activity_location, sports_complex, athletic_field,
swimming_pool, tennis_court, playground, sports_coaching, sports_school,
arena, stadium, race_course, farm, ranch, childrens_camp,
indoor_playground, dog_park, campground
```

**B. On-demand config changes (categoryPlaceTypes.ts)**

Remove from Play `includedTypes` (line 94-100):
- `indoor_playground` — almost always kids
- `skateboard_park` — sports/fitness, not adult date activity
- `cycling_park` — sports/fitness, not adult date activity

Add to Play `CATEGORY_EXCLUDED_PLACE_TYPES` (line 463-471):
```
indoor_playground, playground, childrens_camp, sports_complex,
sports_club, athletic_field, swimming_pool, tennis_court,
sports_coaching, sports_school, farm, ranch, community_center,
dog_park, campground
```

**C. Deterministic filter changes (ai-verify-pipeline.ts)**

Add three new keyword categories to `EXCLUSION_KEYWORDS`:

```typescript
sports_recreation: [
  "sports park", "recreation center", "rec center", "recreation centre",
  "athletic center", "athletic complex", "sports complex",
  "community pool", "public pool", "sports field", "ball field",
  "baseball field", "softball field", "soccer field", "football field",
  "tennis center", "swim center", "aquatic center", "fitness park",
  "sportplatz", "polideportivo", "centro deportivo", "complexe sportif",
  "leisure centre", "leisure center", "recreation ground", "sports ground",
  "playing field"
],
farm_seasonal: [
  "farm", "farms", "ranch", "orchard", "pumpkin patch", "corn maze",
  "hayride", "u-pick", "pick your own", "farmstead", "agritourism",
  "bauernhof", "ferme ", "granja", "fattoria",
  "apple picking", "berry picking", "strawberry picking"
],
community_civic: [
  "community center", "community centre", "civic center", "civic centre",
  "recreation department", "parks and recreation", "parks & recreation",
  "senior center", "senior centre", "youth center", "youth centre",
  "community hall", "town hall", "village hall", "gemeindezentrum",
  "maison de quartier", "centro comunitario", "centre communautaire",
  "neighborhood center", "neighbourhood centre"
],
```

Expand existing `kids` keywords:
```typescript
kids: [
  // Existing
  "kids play", "children's", "indoor playground", "kidz",
  "chuck e. cheese", "kidzone", "enfants", "kinder",
  "bambini", "infantil", "splash pad", "soft play",
  // Add these
  "toddler", "baby", "babies", "bounce house", "bouncy castle",
  "bounce ", "bouncy", "trampoline park", "ball pit",
  "play center", "play centre", "playland", "play land",
  "play zone", "play world", "play park", "funland",
  "jungle gym", "adventure playground", "play space", "playspace",
  "little ones", "mommy and me", "mommy & me", "fun zone", "funzone",
  "discovery zone", "little explorers", "tiny town", "sensory play",
  "kids kingdom", "imagination station",
],
```

**D. Types array check (ai-verify-pipeline.ts)**

Add a new check in `deterministicFilter()` after the existing keyword checks. This is the same pattern as the garden store flowers fix — check the full `types` array, not just `primary_type`:

```typescript
// Play-specific types array check
const PLAY_BLOCKED_SECONDARY_TYPES = new Set([
  "community_center", "sports_complex", "sports_club",
  "athletic_field", "swimming_pool", "playground",
  "indoor_playground", "childrens_camp", "farm", "ranch",
  "sports_coaching", "sports_school", "dog_park",
]);

const typesArray: string[] = place.types || [];
if (cats.includes("play")) {
  const hasBlockedPlayType = typesArray.some(t =>
    PLAY_BLOCKED_SECONDARY_TYPES.has(t)
  );
  if (hasBlockedPlayType) {
    // Strip play category
    const idx = cats.indexOf("play");
    cats.splice(idx, 1);
    modified = true;
    modifyReason = `Rules: stripped 'play' — types array contains non-play type`;
  }
}
```

**E. GPT prompt improvements**

Add worked examples to the system prompt:

```
Example 17: "Bethesda Park Recreation Center" type:amusement_center →
{"d":"reject","c":[],"pi":"sports recreation center","w":true,
"r":"Recreation center with athletic facilities — not adult play venue","f":"high"}

Example 18: "Phillips Farms" type:amusement_park →
{"d":"reject","c":[],"pi":"seasonal farm attraction","w":true,
"r":"Farm with seasonal activities — seasonal/unpredictable, reject","f":"high"}

Example 19: "Adventure Play Centre" type:amusement_center →
{"d":"reject","c":[],"pi":"children's play center","w":true,
"r":"Indoor play center for children — not adult date venue","f":"high"}

Example 20: "Riverside Community Center" type:amusement_center →
{"d":"reject","c":[],"pi":"community center","w":false,
"r":"Community center — civic facility, not a date venue","f":"high"}
```

Add to the PLAY definition in the system prompt:

```
PLAY: Active fun for adults — bowling, arcades, escape rooms (indoor AND
outdoor), go-karts, laser tag, karaoke, mini golf, axe throwing,
TopGolf/golf simulators, trampoline parks (adult-friendly), VR experiences,
rock climbing, kayaking, skydiving, scavenger hunts, outdoor adventure games.
NO kids-only venues, NO gyms, NO gambling halls (exception: upscale casinos
like Bellagio). NO sports parks or recreation centers (athletic fields, pools,
tennis courts). NO farms or seasonal agricultural attractions (pumpkin patches,
corn mazes, berry picking). NO community centers or civic facilities.
```

### Impact Assessment

| Fix Layer | What It Catches | False Positive Risk |
|-----------|----------------|-------------------|
| Seeding excludedPrimaryTypes | Places where Google correctly assigns the problematic type as primary | Zero — these types never belong in play |
| Keyword categories | Places with revealing names regardless of Google type | Low — "farm" could match "Farmer's Arcade" but that's extremely rare |
| Types array check | Places where the problematic type is secondary, not primary | Low — the blocked types are unambiguous |
| GPT examples | Places that pass all deterministic filters | Zero — examples teach, don't filter |

The "farm" keyword has the highest false-positive risk. A legitimate venue named "The Farm Arcade" or "Farmer's Bowl" could get caught. The mitigation: the keyword check rejects the place entirely from the pool (all categories), not just from play. This is probably too aggressive for "farm" — it should strip play specifically, not reject entirely.

**Recommendation:** The `farm_seasonal` keywords should NOT go in `EXCLUSION_KEYWORDS` (which rejects entirely). Instead, they should be a play-specific name check that strips the play category only, similar to how `FLOWERS_BLOCKED_TYPES` strips flowers specifically. This preserves the place for other categories (a farm could still be nature_views) while removing it from play.

---

## 16. Creative & Arts Deep Audit

### The Problem

Restaurants, wine bars, and convenience stores are appearing in creative_arts.

### How They Leak In

These places do NOT enter through creative_arts seeding. The seeding `excludedPrimaryTypes` already blocks `restaurant`, `wine_bar`, `bar`, `cafe`, `coffee_shop`. They enter through OTHER seeding configs (casual_eats seeds the restaurant, drinks seeds the wine bar) and then **GPT assigns creative_arts as an additional category.**

**Leak path 1 — Restaurant in a historic building:**
1. Restaurant seeded via casual_eats (primary_type: restaurant)
2. Google `types` array includes `cultural_landmark` or `historical_place`
3. GPT sees "cultural_landmark" in the type data and assigns `creative_arts + brunch_lunch_casual`
4. Deterministic filter has no rule saying "restaurants can't be creative_arts"

**Leak path 2 — Wine bar in a gallery district:**
1. Wine bar seeded via drinks (primary_type: wine_bar)
2. Web evidence mentions "art" or "gallery" in the neighborhood description
3. GPT assigns `drinks_and_music + creative_arts`

**Leak path 3 — Convenience store near a landmark:**
1. Convenience store somehow enters pool (possibly tagged as `store` with `cultural_landmark` in types)
2. GPT sees cultural_landmark context and assigns creative_arts

### Why the Current Filters Don't Catch It

The deterministic filter only rejects or modifies based on `primary_type` and name keywords. It has no rule that says: "if a place is primarily a restaurant/bar/store, it cannot be creative_arts." The stripping logic (like FLOWERS_BLOCKED_TYPES) exists for flowers but not for creative_arts.

The on-demand exclusions for Creative & Arts (categoryPlaceTypes.ts line 453-461) block `fast_food_restaurant`, `bar`, `night_club` — but are missing:

| Missing from Creative & Arts exclusions | Why it should be excluded |
|---|---|
| `restaurant` | A restaurant is never a museum |
| `wine_bar` | A wine bar is never a gallery |
| `cafe`, `coffee_shop` | A cafe is never a cultural center |
| `cocktail_bar`, `lounge_bar` | Bars are never arts venues |
| `pub`, `brewery`, `brewpub`, `beer_garden` | Pubs are never arts venues |
| `convenience_store`, `grocery_store`, `supermarket` | Retail is never arts |
| `hookah_bar`, `sports_bar`, `irish_pub` | Bars are never arts |
| `hotel`, `motel` | Hotels are never arts |
| `gas_station` | Never arts |

### The Fix

**A. Deterministic filter — add CREATIVE_ARTS_BLOCKED_TYPES**

New constant and stripping logic, same pattern as FLOWERS_BLOCKED_TYPES:

```typescript
const CREATIVE_ARTS_BLOCKED_TYPES = new Set([
  // Food & drink — a restaurant/bar is NEVER creative_arts
  "restaurant", "american_restaurant", "asian_restaurant", "barbecue_restaurant",
  "brazilian_restaurant", "chinese_restaurant", "french_restaurant",
  "german_restaurant", "greek_restaurant", "indian_restaurant",
  "italian_restaurant", "japanese_restaurant", "korean_restaurant",
  "mexican_restaurant", "seafood_restaurant", "spanish_restaurant",
  "thai_restaurant", "turkish_restaurant", "vietnamese_restaurant",
  "fine_dining_restaurant", "fast_food_restaurant", "brunch_restaurant",
  "breakfast_restaurant", "hamburger_restaurant", "pizza_restaurant",
  "ramen_restaurant", "sushi_restaurant", "steak_house", "bistro",
  "diner", "buffet_restaurant", "gastropub",
  // All bar/drink types
  "bar", "cocktail_bar", "wine_bar", "lounge_bar", "pub", "brewery",
  "brewpub", "beer_garden", "sports_bar", "hookah_bar", "irish_pub",
  "night_club", "winery", "bar_and_grill",
  // Cafe types
  "cafe", "coffee_shop", "tea_house", "bakery", "ice_cream_shop",
  // Retail
  "convenience_store", "grocery_store", "supermarket", "store",
  "department_store", "shopping_mall",
  // Other non-arts
  "hotel", "motel", "gas_station", "gym", "fitness_center",
]);
```

In `deterministicFilter()`, add:

```typescript
if (cats.includes("creative_arts") && CREATIVE_ARTS_BLOCKED_TYPES.has(primaryType)) {
  const idx = cats.indexOf("creative_arts");
  cats.splice(idx, 1);
  modified = true;
  modifyReason = `Rules: stripped 'creative_arts' — primary_type '${primaryType}' is not an arts venue`;
}
```

Also check the `types` array — if the MAJORITY of types are food/drink, strip creative_arts even if one type is `cultural_landmark`.

**B. GPT prompt — add explicit exclusion rule**

Add to CREATIVE_ARTS definition:

```
CREATIVE_ARTS: Museums (all types), art galleries, cultural centers with exhibits,
sculpture parks, immersive art (teamLab, Meow Wolf), pottery/paint-and-sip
studios open to public, planetariums, aquariums, visitable castles/landmarks.
Aquarium → creative_arts + play.
A restaurant, bar, cafe, wine bar, or store is NEVER creative_arts — even if it's
in a historic building, near a landmark, or has art on the walls. The place must
BE an arts/culture venue, not just be located near one.
```

**C. On-demand exclusions — add missing types**

Add to `CATEGORY_EXCLUDED_PLACE_TYPES['Creative & Arts']`:
```
restaurant, fine_dining_restaurant, wine_bar, cafe, coffee_shop,
cocktail_bar, lounge_bar, pub, brewery, brewpub, beer_garden,
sports_bar, hookah_bar, irish_pub, convenience_store, grocery_store,
supermarket, hotel, motel, gas_station
```

### What We DON'T Lose

This fix only strips creative_arts from places that are primarily food/drink/retail. A genuine museum, gallery, or cultural center keeps creative_arts. A museum that happens to have a cafe inside still gets creative_arts — because its `primary_type` is `museum`, not `cafe`.

---

## 17. Movies & Theatre Deep Audit

### The Problem

Cafes, bars, and pubs are appearing in movies_theatre.

### How They Leak In

Same pattern as creative_arts. These places enter through drinks_and_music or icebreakers seeding, then GPT adds movies_theatre because it sees music/performance context.

**Leak path 1 — Bar with live music:**
1. Bar seeded via drinks (primary_type: bar or pub)
2. Google `types` array includes `live_music_venue`
3. GPT sees "live music" and assigns `drinks_and_music + movies_theatre`
4. But a bar with a band on Friday nights is NOT a performing arts venue

**Leak path 2 — Cafe in a theater district:**
1. Cafe seeded via icebreakers (primary_type: cafe)
2. Web evidence mentions nearby theaters or "pre-show drinks"
3. GPT assigns `icebreakers + movies_theatre`

**Leak path 3 — Pub with comedy night:**
1. Pub seeded via drinks (primary_type: pub)
2. Google `types` includes `comedy_club`
3. GPT sees "comedy" and assigns movies_theatre
4. But a pub with an open mic is NOT a comedy club

### The Critical Distinction

The category-mapping.md rule for live_performance says:

> "Bars with occasional live music: If live music is a regular, scheduled, primary draw (e.g., jazz club, live music bar) → live_performance + drink. If it's just background entertainment on weekends → drink only."

GPT doesn't reliably make this distinction. It sees `live_music_venue` in the types and defaults to adding movies_theatre.

### The Fix

**A. Deterministic filter — add MOVIES_THEATRE_BLOCKED_TYPES**

```typescript
const MOVIES_THEATRE_BLOCKED_TYPES = new Set([
  // Food & drink — bars/cafes are NEVER movies_theatre
  "restaurant", "fine_dining_restaurant", "fast_food_restaurant",
  "brunch_restaurant", "breakfast_restaurant", "bistro", "diner",
  "cafe", "coffee_shop", "tea_house", "bakery", "ice_cream_shop",
  "bar", "cocktail_bar", "wine_bar", "lounge_bar", "pub", "brewery",
  "brewpub", "beer_garden", "sports_bar", "hookah_bar", "irish_pub",
  "night_club", "winery", "bar_and_grill", "gastropub",
  // Retail
  "convenience_store", "grocery_store", "supermarket", "store",
  "department_store", "shopping_mall",
  // Other non-performance
  "hotel", "motel", "gas_station", "gym", "fitness_center",
  "amusement_center", "bowling_alley", "video_arcade",
]);
```

In `deterministicFilter()`:

```typescript
if (cats.includes("movies_theatre") && MOVIES_THEATRE_BLOCKED_TYPES.has(primaryType)) {
  const idx = cats.indexOf("movies_theatre");
  cats.splice(idx, 1);
  modified = true;
  modifyReason = `Rules: stripped 'movies_theatre' — primary_type '${primaryType}' is not a cinema or performance venue`;
}
```

**B. GPT prompt — tighten the definition**

Current:
```
MOVIES_THEATRE: Real cinemas with screens and scheduled movies... Also includes
performing arts venues: concert halls, theaters, opera houses, comedy clubs,
jazz clubs, amphitheaters.
```

Replace with:
```
MOVIES_THEATRE: Real cinemas with screens and scheduled movies — movie theaters,
indie cinemas, drive-ins, IMAX, AMC, Regal, Cinemark, Alamo Drafthouse. Also
includes DEDICATED performing arts venues: concert halls, theaters, opera houses,
comedy clubs, jazz clubs, amphitheaters. The venue must be PRIMARILY a cinema or
performance space. A bar that hosts live music is drinks_and_music, NOT
movies_theatre. A pub with comedy night is drinks_and_music, NOT movies_theatre.
A cafe near a theater is icebreakers, NOT movies_theatre. Only assign
movies_theatre if the place IS a cinema, theater, or concert hall — not if it
merely hosts occasional entertainment.
```

**C. On-demand exclusions — add missing types**

Add to `CATEGORY_EXCLUDED_PLACE_TYPES['Movies & Theatre']`:
```
restaurant, fine_dining_restaurant, fast_food_restaurant,
cafe, coffee_shop, tea_house, bakery,
bar, cocktail_bar, wine_bar, lounge_bar, pub, brewery, brewpub,
beer_garden, sports_bar, hookah_bar, irish_pub, night_club,
gastropub, bistro, diner,
convenience_store, hotel, motel, gym, fitness_center
```

**D. Seeding config — reconsider `event_venue` in live_performance**

The live_performance seeding includes `event_venue`. This is a very broad Google type — it catches wedding venues, corporate event spaces, and community halls alongside legitimate performance spaces. Consider removing it from seeding `includedTypes` and relying on the more specific types (`performing_arts_theater`, `concert_hall`, etc.) to find real venues.

### What We DON'T Lose

Real cinemas, theaters, concert halls, opera houses, comedy clubs keep movies_theatre. A dedicated jazz club (primary_type: `live_music_venue`, not `bar`) keeps movies_theatre. The fix only strips movies_theatre from places that are primarily food/drink/retail.

---

## 18. Brunch, Lunch & Casual Deep Audit

### The New Definition (Per User Decision)

**Brunch, Lunch & Casual = real restaurants only.** Tables, waiters, a menu. Not food trucks, not markets, not food halls, not food courts, not delis, not bars, not pubs, not lounges, not tobacco shops, not play venues, not sports centers, not campuses.

Dinner restaurants qualify — the category is "casual dining," not literally "brunch and lunch only."

### What Currently Leaks In and Why

**Leak 1 — Bars and pubs:**
Google tags many bar-and-grill spots as `restaurant`. Primary_type is `restaurant`, so they pass seeding. But the place is really a bar that serves food. The deterministic filter has no way to distinguish "restaurant with a bar" from "bar with food" based on type alone.

**Leak 2 — Play venues:**
A bowling alley with a restaurant gets `primary_type: restaurant` from Google (because the restaurant is prominent). Seeding catches it as casual_eats. Same for entertainment venues with dining (Dave & Buster's style).

**Leak 3 — Tobacco/hookah:**
Hookah bars that serve food get tagged as `restaurant` or `cafe` by Google. The seeding exclusion blocks `hookah_bar` as primary_type, but if Google assigns `restaurant` as primary with `hookah_bar` in the types array, it passes.

**Leak 4 — Food courts, delis, markets:**
Currently in seeding `includedTypes`: `food_court`, `deli`. These need to come out per the new definition.

**Leak 5 — Sports centers/campuses:**
Campus dining halls tagged as `restaurant` or `cafeteria`. Sports center restaurants tagged as `restaurant`.

### The Fix

**A. Seeding config — remove non-restaurant types**

Remove from casual_eats `includedTypes`:
- `cafe` — moves to icebreakers only (cafes are conversation spots, not meal restaurants)
- `coffee_shop` — same, icebreakers only
- `food_court` — not a real restaurant
- `deli` — counter service, not a sit-down restaurant

Add to casual_eats `excludedPrimaryTypes`:
```
food_court, deli, snack_bar, cafeteria,
hookah_bar, tobacco_shop,
amusement_park, amusement_center, bowling_alley, video_arcade,
adventure_sports_center, go_karting_venue, paintball_center,
community_center, sports_complex, sports_club, athletic_field,
stadium, arena,
campground, farm, ranch
```

Note: `cafe` and `coffee_shop` are currently in casual_eats `includedTypes`. Removing them is a deliberate choice — cafes belong in icebreakers. A cafe that serves full meals (brunch, lunch) will also be tagged as `brunch_restaurant` or `restaurant` by Google, so it won't be lost. We're only losing cafes that are purely coffee/pastry spots — and those belong in icebreakers, not brunch_lunch_casual.

**B. Deterministic filter — add BRUNCH_CASUAL_BLOCKED_TYPES**

New types-array check. If any of these appear in the `types` array, strip brunch_lunch_casual:

```typescript
const BRUNCH_CASUAL_BLOCKED_TYPES = new Set([
  // Bars/drink venues — if the types array reveals it's really a bar
  "bar", "cocktail_bar", "wine_bar", "lounge_bar", "pub", "brewery",
  "brewpub", "beer_garden", "sports_bar", "hookah_bar", "irish_pub",
  "night_club", "winery", "bar_and_grill",
  // Play/entertainment — if it's really an entertainment venue
  "amusement_center", "amusement_park", "bowling_alley", "video_arcade",
  "go_karting_venue", "paintball_center", "miniature_golf_course",
  "adventure_sports_center", "casino", "karaoke",
  // Sports/civic
  "community_center", "sports_complex", "sports_club", "athletic_field",
  "stadium", "arena", "swimming_pool",
  // Tobacco/hookah
  "tobacco_shop",
  // Non-restaurant food
  "food_court", "cafeteria",
  // Farms
  "farm", "ranch",
]);
```

**IMPORTANT — this is a types-array check, not a primary_type check.** The logic:

```typescript
if (cats.includes("brunch_lunch_casual")) {
  const hasBlockedType = typesArray.some(t => BRUNCH_CASUAL_BLOCKED_TYPES.has(t));
  if (hasBlockedType && !isRestaurantPrimary(primaryType)) {
    // Strip brunch_lunch_casual — not a real restaurant
  }
}
```

The `isRestaurantPrimary()` guard is critical. We do NOT want to strip brunch_lunch_casual from a legitimate restaurant that happens to have a bar area. The rule is: if the `primary_type` is a restaurant type, keep it. If the `primary_type` is `bar` or `amusement_center` but the place also has `restaurant` in its types, strip brunch_lunch_casual — the bar/entertainment is the primary identity.

```typescript
function isRestaurantPrimary(primaryType: string): boolean {
  return RESTAURANT_TYPES.has(primaryType)
    || primaryType === "brunch_restaurant"
    || primaryType === "breakfast_restaurant"
    || primaryType === "bistro"
    || primaryType === "diner";
}
```

**C. Deterministic filter — add keyword categories**

New `tobacco_hookah` keyword category in EXCLUSION_KEYWORDS:
```typescript
tobacco_hookah: [
  "tobacco", "cigar lounge", "cigar bar", "hookah lounge",
  "shisha", "shisha lounge", "hookah cafe", "nargile",
  "chicha", "tabak", "tabac",
],
```

New `campus_dining` keyword category (strips brunch_lunch_casual, doesn't reject entirely):
```typescript
campus_dining: [
  "campus dining", "campus cafe", "campus restaurant",
  "student center", "student union", "dining hall",
  "university dining", "college dining", "cafeteria",
],
```

**D. GPT prompt — tighten the definition**

Current:
```
BRUNCH_LUNCH_CASUAL: Any real sit-down restaurant where you'd grab a meal.
Includes chain restaurants with table service (Olive Garden, IHOP, Outback).
Includes food halls and food markets with vendors. NO fast food/counter-service/
grab-and-go chains (McDonald's, Subway, Starbucks). Wine bars and tapas bars
with food → brunch_lunch_casual + drinks_and_music.
```

Replace with:
```
BRUNCH_LUNCH_CASUAL: A real sit-down restaurant with tables, waiters, and a
menu. The kind of place you'd say "let's grab dinner" or "let's do brunch."
Includes chain restaurants with table service (Olive Garden, IHOP, Outback).
Includes all cuisines. NO food trucks, NO food courts, NO market stalls, NO
food halls, NO delis/counter-service, NO campus dining halls. A bar or pub
that serves food is drinks_and_music, NOT brunch_lunch_casual — the test is
whether the PRIMARY identity is a restaurant. A hookah lounge with appetizers
is NOT brunch_lunch_casual. A bowling alley with a restaurant is play, NOT
brunch_lunch_casual. A wine bar with tapas is drinks_and_music, NOT
brunch_lunch_casual. Only assign brunch_lunch_casual if you would describe
the place as "a restaurant" first and foremost.
```

**E. On-demand exclusions — add missing types**

Add to `CATEGORY_EXCLUDED_PLACE_TYPES['Brunch, Lunch & Casual']`:
```
hookah_bar, sports_bar, irish_pub, brewery, brewpub, beer_garden,
pub, cocktail_bar, lounge_bar, wine_bar, winery, bar_and_grill,
amusement_center, amusement_park, bowling_alley, video_arcade,
go_karting_venue, paintball_center, miniature_golf_course, karaoke,
casino, adventure_sports_center,
community_center, sports_complex, sports_club, athletic_field,
stadium, arena, swimming_pool,
food_court, cafeteria, tobacco_shop,
farm, ranch, campground
```

### What We Lose (Intentionally)

| Removed | Why | Impact |
|---------|-----|--------|
| `cafe` from seeding | Cafes are icebreakers, not restaurants | Low — cafes with real food menus are also tagged `restaurant` or `brunch_restaurant` by Google |
| `coffee_shop` from seeding | Same as cafe | Low — same reason |
| `food_court` from seeding | Not a real restaurant | Food courts had questionable date-worthiness anyway |
| `deli` from seeding | Counter service | Low — sit-down delis are also tagged `restaurant` |
| Wine bars with food | Now drinks_and_music only | Deliberate — wine bars are drink venues, not restaurants |
| Bar & grills | Now drinks_and_music only (unless primary_type is a restaurant type) | Some legitimate restaurant-bars may lose brunch_lunch_casual, but they keep drinks_and_music |

### What We DON'T Lose

- Any restaurant with `primary_type` that's a restaurant type keeps brunch_lunch_casual
- A restaurant that also has a bar area keeps brunch_lunch_casual (because the primary_type is restaurant)
- All 49+ cuisine types stay
- Chain restaurants with table service stay (Olive Garden, IHOP, etc.)
- Brunch spots, breakfast spots, diners all stay

---

## 19. Upscale & Fine Dining Deep Audit

### The Problem

Too restrictive. Missing great venues because:
1. Only 8 types in seeding — misses cuisine-specific upscale restaurants
2. GPT prompt explicitly excludes "tapas bars, bistros, brasseries, gastropubs" — but some of these ARE special-occasion spots
3. Auto-promotion only fires for VERY_EXPENSIVE + 4.0+ — misses EXPENSIVE restaurants that are genuinely upscale

### The New Definition (Per User Decision)

Upscale & Fine Dining qualifies if:
- It sells food (not a pure bar/lounge)
- It passes the special-occasion test: lavish, bougie
- High-end tapas bars, acclaimed bistros, upscale wine bars with food all qualify

### What's Currently Too Restrictive

**Seeding — only 8 types:**

`fine_dining_restaurant`, `french_restaurant`, `italian_restaurant`, `steak_house`, `seafood_restaurant`, `wine_bar`, `fondue_restaurant`, `oyster_bar_restaurant`

An acclaimed Persian restaurant, a Michelin-starred Japanese omakase, a high-end Scandinavian tasting menu, an upscale Argentine steakhouse — none of these get seeded under fine_dining unless Google also tags them as `fine_dining_restaurant`.

**GPT prompt — too many hard exclusions:**

Current prompt says:
> "Examples that are NOT upscale_fine_dining: wine bars, tapas bars, bistros, brasseries, gastropubs, charming but casual restaurants."

This blanket-excludes venues that CAN be upscale:
- Tickets (Barcelona) — tapas bar, Michelin-starred
- Bistro Paul Bert (Paris) — bistro, acclaimed fine dining
- Bazaar by José Andrés — tapas, clearly special-occasion
- The NoMad Bar (NYC) — wine bar, upscale, food-forward

**Auto-promotion — too narrow:**

Only fires for `PRICE_LEVEL_VERY_EXPENSIVE` + 4.0+ rating. But many upscale restaurants have `PRICE_LEVEL_EXPENSIVE` (not VERY_EXPENSIVE) and are genuinely fine dining. The promotion threshold should include EXPENSIVE restaurants with high ratings (4.0+) and upscale signals.

Also, the `RESTAURANT_TYPES` list used for promotion is missing many cuisine types that can be upscale.

### The Fix

**A. Seeding config — expand includedTypes**

Add to fine_dining `includedTypes`:
```
japanese_restaurant, persian_restaurant, scandinavian_restaurant,
argentinian_restaurant, basque_restaurant, swiss_restaurant,
european_restaurant, australian_restaurant, british_restaurant,
greek_restaurant, indian_restaurant, korean_restaurant,
thai_restaurant, turkish_restaurant, vietnamese_restaurant,
spanish_restaurant, tapas_restaurant, mediterranean_restaurant,
brazilian_restaurant, peruvian_restaurant, moroccan_restaurant,
fusion_restaurant, gastropub, bistro
```

This brings fine_dining to ~33 types (well under the 50 limit). These types can ALL be upscale — it's up to AI validation to decide which specific restaurants qualify.

Note: Many of these overlap with casual_eats seeding. That's intentional — the same physical restaurant gets found by both searches, but deduplication prevents duplicate rows. AI then decides: is this place casual or upscale?

**B. Deterministic filter — expand auto-promotion**

Current promotion rule (line 416-431):
```
PRICE_LEVEL_VERY_EXPENSIVE + rating >= 4.0 + RESTAURANT_TYPES → promote
```

Add a second promotion tier:
```
PRICE_LEVEL_EXPENSIVE + rating >= 4.0 + RESTAURANT_TYPES → promote
```

This catches acclaimed restaurants at the EXPENSIVE tier that are clearly upscale but don't hit VERY_EXPENSIVE. A 4.0-rated EXPENSIVE restaurant is very likely a special-occasion spot.

Expand `RESTAURANT_TYPES` to include all new cuisine types added above, plus:
```
basque_restaurant, persian_restaurant, scandinavian_restaurant,
argentinian_restaurant, swiss_restaurant, european_restaurant,
australian_restaurant, british_restaurant, tapas_restaurant,
gastropub, bistro
```

**C. GPT prompt — loosen the definition**

Current:
```
Examples that are NOT upscale_fine_dining: wine bars, tapas bars, bistros,
brasseries, gastropubs, charming but casual restaurants.
```

Replace with:
```
High-end tapas bars, acclaimed bistros, and upscale wine bars with
substantial food menus CAN qualify as upscale_fine_dining if they pass the
special-occasion test. The question is not "what type of venue is this?" but
"does this feel lavish, bougie, special-occasion?" A Michelin-starred bistro
is upscale_fine_dining. A neighborhood bistro with $15 mains is
brunch_lunch_casual. A wine bar with a tasting menu and sommelier service is
upscale_fine_dining. A wine bar with cheese plates is drinks_and_music.
The venue MUST serve food — a pure cocktail bar with no food menu is
drinks_and_music regardless of how upscale it is.

Examples that are NOT upscale_fine_dining: casual neighborhood bistros,
standard-price brasseries, basic gastropubs, chain restaurants (unless they
pass the upscale test like Nobu or Morton's), any venue that doesn't serve food.
```

**D. On-demand exclusions — already good**

The current Upscale & Fine Dining exclusions (line 431-441) are thorough — they block fast food, casual types, bars, play venues, kids venues, and all retail. No changes needed.

### What We Gain

| New Coverage | Example |
|---|---|
| Cuisine-specific upscale restaurants | Acclaimed Persian, Japanese omakase, Scandinavian tasting menus |
| High-end tapas | Tickets, Bazaar, upscale tapas bars |
| Acclaimed bistros | Michelin-starred or critically acclaimed bistros |
| Upscale wine bars with food | Wine bars with tasting menus, substantial food programs |
| EXPENSIVE restaurants with high ratings | Places at 4.0+ rating and EXPENSIVE pricing |

### What We DON'T Gain (Still Excluded)

- Casual neighborhood bistros (stay in brunch_lunch_casual)
- Standard-price brasseries (stay in brunch_lunch_casual)
- Basic gastropubs (stay in brunch_lunch_casual or drinks_and_music)
- Pure cocktail/wine bars without food (stay in drinks_and_music)
- Chain restaurants that fail the upscale test (stay in brunch_lunch_casual)

### False Positive Risk

Expanding seeding types means more restaurants enter the pool tagged for fine_dining evaluation. Most won't qualify — a random `thai_restaurant` is usually casual. But the AI validation pipeline handles this:
1. Deterministic filter checks price level + rating
2. GPT evaluates whether it's genuinely upscale
3. Casual restaurants get reclassified to brunch_lunch_casual

The extra seeding cost is minimal — these types overlap with casual_eats, so most restaurants are already in the pool. We're just giving AI a second chance to evaluate them for upscale.

---

## 20. Master Fix Summary — Seeding & Deterministic Filter

### Seeding Config Changes (seedingCategories.ts)

| Config | Change | Types Added | Types Removed |
|--------|--------|-------------|---------------|
| **casual_eats** | Remove non-restaurant types | — | `cafe`, `coffee_shop`, `food_court`, `deli` |
| **casual_eats** | Add to excludedPrimaryTypes | +20 types (hookah, tobacco, amusement, sports, campus, farm) | — |
| **casual_eats_world** (NEW) | Split for 50-type limit | +50 world cuisine types | — |
| **casual_eats_extended** (NEW) | Split for 50-type limit | +15 remaining cuisine types | — |
| **fine_dining** | Expand cuisine coverage | +25 cuisine types | — |
| **play** | Expand excludedPrimaryTypes | +16 types (sports, farm, playground, campus) | — |
| **creative_arts** | No seeding changes needed | — | — |
| **watch/live_performance** | Consider removing `event_venue` | — | `event_venue` (optional) |

### Deterministic Filter Changes (ai-verify-pipeline.ts)

**New blocked-type sets (category-specific stripping):**

| Set | Purpose | Types |
|-----|---------|-------|
| `CREATIVE_ARTS_BLOCKED_TYPES` | Strip creative_arts from restaurants/bars/retail | ~55 food/drink/retail types |
| `MOVIES_THEATRE_BLOCKED_TYPES` | Strip movies_theatre from restaurants/bars/retail | ~45 food/drink/retail types |
| `BRUNCH_CASUAL_BLOCKED_TYPES` | Strip brunch_lunch_casual from bars/play/tobacco | ~35 bar/play/civic types |
| `PLAY_BLOCKED_SECONDARY_TYPES` | Strip play from sports/farms/kids/community | ~15 types |
| Expand `FLOWERS_BLOCKED_TYPES` | Strip flowers from garden stores (existing fix) | +6 types |

**New keyword categories in EXCLUSION_KEYWORDS:**

| Category | Keywords | Action |
|----------|----------|--------|
| `sports_recreation` | 30 patterns (sports park, rec center, athletic complex, etc.) | Reject entirely |
| `community_civic` | 20 patterns (community center, civic center, etc.) | Reject entirely |
| `tobacco_hookah` | 12 patterns (tobacco, cigar, hookah, shisha, etc.) | Reject entirely |
| `farm_seasonal` | 16 patterns (farm, ranch, orchard, pumpkin patch, etc.) | Strip play only (not full reject) |
| `campus_dining` | 10 patterns (campus dining, dining hall, student center, etc.) | Strip brunch_lunch_casual only |
| Expand `kids` | +25 patterns (toddler, baby, bounce house, play center, etc.) | Reject entirely |

**Types array checks (new pattern — check full `types` array, not just primary_type):**

Applied to: creative_arts, movies_theatre, brunch_lunch_casual, play, flowers (garden store fix)

This is the single most impactful change. Every leak documented in this audit shares the same root cause: `primary_type` says one thing, `types` array says another. Checking the full array catches them all.

**Auto-promotion expansion:**

| Current | New |
|---------|-----|
| VERY_EXPENSIVE + 4.0+ → upscale | Keep |
| — | EXPENSIVE + 4.0+ → upscale (NEW) |
| 47 types in RESTAURANT_TYPES | ~70 types (add all new cuisine types) |

### GPT Prompt Changes (ai-verify-pipeline.ts)

| Category | Change |
|----------|--------|
| CREATIVE_ARTS | Add: "A restaurant, bar, cafe, or store is NEVER creative_arts" |
| MOVIES_THEATRE | Add: "A bar with live music is drinks_and_music, NOT movies_theatre" |
| BRUNCH_LUNCH_CASUAL | Rewrite: restaurants only, no food courts/markets/bars/play/tobacco |
| UPSCALE_FINE_DINING | Loosen: high-end tapas, acclaimed bistros, upscale wine bars with food qualify |
| PLAY | Add: "NO sports parks, NO farms, NO community centers" |
| Worked examples | Add 8+ new examples covering all fixed categories |

### On-Demand Exclusion Changes (categoryPlaceTypes.ts)

| Category | Types to Add |
|----------|-------------|
| Creative & Arts | +20 food/drink/retail types |
| Movies & Theatre | +25 food/drink/retail types |
| Brunch, Lunch & Casual | +30 bar/play/sports/tobacco types |
| Play | +15 sports/farm/kids/community types |
| Remove `indoor_playground` from Play includedTypes | It's almost always kids |
| Remove `skateboard_park`, `cycling_park` from Play includedTypes | Sports/fitness |
