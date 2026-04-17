# How Mingla Finds, Seeds, and Validates Places

This document explains the full pipeline: how places get into Mingla's pool, what search terms find them, what filters clean them up, and how AI decides what stays.

---

## The Big Picture

Places go through a **three-stage journey** before users ever see them:

1. **Seeding** -- Google Places API finds venues in a city and dumps them into `place_pool`
2. **Deterministic filtering** -- Hard-coded rules instantly reject fast food, salons, gas stations, etc.
3. **AI classification** -- GPT-4o-mini reads each surviving place's profile + web evidence and assigns final categories

Two category systems coexist:
- `seeding_category` -- which Google search found this place (used for pipeline tracking)
- `ai_categories` -- the final categories users see (assigned independently by AI)

---

## Part 1: Seeding (How Places Get Found)

### How it works

The admin seeds a city by dividing it into a **tile grid** -- overlapping circles of 1,500-2,500m radius. For each tile, the system runs a Google Places **Nearby Search** using curated type lists per category.

There are **no keyword search terms**. Seeding uses Google's `includedTypes` parameter (structured place types like `cafe`, `bar`, `art_gallery`), not free-text keywords. The one exception is Upscale & Fine Dining, which also has a **Text Search** fallback using phrases like `"fine dining restaurant"` and `"upscale restaurant"`.

### Seeding configs (13 configs mapping to 10 app categories)

Some app categories use multiple seeding configs to cast a wider net. Nature & Views has two (general nature + picnic-specific). Movies & Theatre has two (cinemas + live performance).

---

#### Brunch, Lunch & Casual

**Included types:** `restaurant`, `bistro`, `brunch_restaurant`, `breakfast_restaurant`, `diner`, `cafe`, `coffee_shop`, `sandwich_shop`, `pizza_restaurant`, `hamburger_restaurant`, `mexican_restaurant`, `mediterranean_restaurant`, `thai_restaurant`, `vegetarian_restaurant`, `american_restaurant`, `asian_restaurant`, `barbecue_restaurant`, `brazilian_restaurant`, `caribbean_restaurant`, `chinese_restaurant`, `ethiopian_restaurant`, `french_restaurant`, `fusion_restaurant`, `gastropub`, `german_restaurant`, `greek_restaurant`, `indian_restaurant`, `indonesian_restaurant`, `italian_restaurant`, `japanese_restaurant`, `korean_restaurant`, `korean_barbecue_restaurant`, `lebanese_restaurant`, `middle_eastern_restaurant`, `moroccan_restaurant`, `peruvian_restaurant`, `ramen_restaurant`, `seafood_restaurant`, `spanish_restaurant`, `sushi_restaurant`, `tapas_restaurant`, `turkish_restaurant`, `vegan_restaurant`, `vietnamese_restaurant`, `buffet_restaurant`, `deli`, `food_court`, `noodle_shop`, `hot_pot_restaurant`

**Excluded primary types:** `fine_dining_restaurant`, all bar/pub/nightclub types, `fast_food_restaurant`, entertainment venues, fitness/corporate, retail/services (gas stations, grocery stores, hotels)

---

#### Nature & Views (two seeding configs)

**Config 1 -- General nature:**
`beach`, `botanical_garden`, `garden`, `hiking_area`, `national_park`, `nature_preserve`, `park`, `scenic_spot`, `state_park`, `observation_deck`, `tourist_attraction`, `city_park`, `fountain`, `island`, `lake`, `marina`, `mountain_peak`, `river`, `vineyard`, `woods`, `wildlife_park`, `wildlife_refuge`, `zoo`, `aquarium`

**Config 2 -- Picnic-focused:**
`picnic_ground`, `park`, `city_park`

**Excluded primary types (both):** Sports/fitness venues (dog parks, gyms, skateboard parks), camping/utility, entertainment/nightlife, civic/corporate, food/drink establishments

---

#### Icebreakers

**Included types:** `book_store`, `cafe`, `coffee_shop`, `tea_house`, `bakery`, `dessert_shop`, `juice_shop`, `bistro`, `wine_bar`, `lounge_bar`, `acai_shop`, `bagel_shop`, `cake_shop`, `cat_cafe`, `chocolate_shop`, `chocolate_factory`, `coffee_roastery`, `coffee_stand`, `confectionery`, `dessert_restaurant`, `ice_cream_shop`

**Excluded primary types:** Loud/party venues (nightclubs, sports bars, breweries), full restaurants, entertainment, fitness/corporate

---

#### Drinks & Music

**Included types:** `bar`, `cocktail_bar`, `lounge_bar`, `wine_bar`, `pub`, `brewery`, `beer_garden`, `brewpub`, `bar_and_grill`, `hookah_bar`, `irish_pub`, `night_club`, `winery`, `sports_bar`, `live_music_venue`, `karaoke`

**Excluded primary types:** Food-primary (restaurants, cafes, bakeries), entertainment (cinemas, bowling), fitness/corporate

---

#### Creative & Arts

**Included types:** `art_gallery`, `art_museum`, `art_studio`, `museum`, `history_museum`, `performing_arts_theater`, `cultural_center`, `cultural_landmark`, `sculpture`, `aquarium`, `castle`, `historical_place`, `historical_landmark`, `monument`, `planetarium`

**Excluded primary types:** Live performance venues (concert halls, comedy clubs), cinemas, bars/restaurants, play/recreation, fitness/corporate, nature, retail/hotels

---

#### Movies & Theatre (two seeding configs)

**Config 1 -- Cinemas:**
`movie_theater`

**Config 2 -- Live performance:**
`performing_arts_theater`, `concert_hall`, `opera_house`, `philharmonic_hall`, `amphitheatre`, `auditorium`, `comedy_club`, `event_venue`, `live_music_venue`, `dance_hall`

**Excluded primary types (both):** Cross-category leakage (museums for cinemas, cinemas for live), bars/restaurants, play/recreation, fitness/corporate

---

#### Upscale & Fine Dining

**Included types:** `fine_dining_restaurant`, `french_restaurant`, `italian_restaurant`, `steak_house`, `seafood_restaurant`, `wine_bar`, `fondue_restaurant`, `oyster_bar_restaurant`

**Text Search fallback keywords:** `"fine dining restaurant"`, `"upscale restaurant"`, `"tasting menu restaurant"`

**Excluded primary types:** Casual food (fast food, cafes, bakeries, buffets, pizza, hamburger, sandwich shops), bars/pubs, entertainment, corporate, retail/services

---

#### Play

**Included types:** `amusement_center`, `bowling_alley`, `miniature_golf_course`, `go_karting_venue`, `paintball_center`, `video_arcade`, `karaoke`, `amusement_park`, `adventure_sports_center`, `casino`, `ferris_wheel`, `roller_coaster`, `water_park`, `ice_skating_rink`

**Excluded primary types:** Performance venues, bars/restaurants, museums, fitness/corporate, nature, retail/hotels

---

#### Groceries

**Included types:** `grocery_store`, `supermarket`

**Excluded primary types:** Wrong grocery types (florists, garden centers, farmers markets, liquor stores, health food stores, convenience stores), food service, retail, corporate, medical/services

---

#### Flowers

**Included types:** `florist`, `grocery_store`, `supermarket`

**Excluded primary types:** Niche/specialty groceries (Asian grocery, health food, farmers market, convenience/discount stores), wholesale/warehouse, specialty food (butcher, liquor), general retail (department stores, garden centers, malls), non-grocery (restaurants, bars, cinemas, museums, gyms), medical/services

---

### Post-fetch filters during seeding

After Google returns results, the seeder applies two filters before inserting into `place_pool`:
- **Must have photos** -- places without any photos are discarded
- **Must not be permanently closed**

---

## Part 2: Deterministic Pre-Filter (Stage 2)

Before AI ever sees a place, hard-coded rules handle the obvious cases. This catches ~80% of rejections at zero cost.

### The filter runs these checks in order:

**1. Blocked primary types (instant reject)**

Cemetery, funeral home, gas station, car dealer, car wash, car rental, auto repair, parking, storage, laundry, locksmith, plumber, electrician, roofing contractor, insurance agency, real estate agency, accounting, post office, fire station, police, courthouse, wedding venue, banquet hall.

**2. Minimum data guard**

If a place has no rating AND no reviews AND no website, it's rejected as insufficient data.

**3. Fast food blacklist (56 chains)**

McDonald's, Burger King, KFC, Wendy's, Subway, Taco Bell, Chick-fil-A, Five Guys, Popeyes, Panda Express, Domino's, Papa John's, Pizza Hut, Little Caesar's, Sonic Drive-In, Jack in the Box, Arby's, Carl's Jr, Hardee's, Del Taco, Raising Cane's, Whataburger, In-N-Out, Wingstop, Chipotle, Shake Shack, Checkers, Rally's, Church's Chicken, El Pollo Loco, Golden Corral, Bojangles, Cook Out, Zaxby's, Panera Bread, Jersey Mike's, Jimmy John's, Firehouse Subs, Qdoba, Potbelly, Sweetgreen, Tropical Smoothie, Moe's Southwest, CAVA, Starbucks, Dunkin', Tim Hortons, Costa Coffee, Krispy Kreme, Greggs, Pret a Manger, Quick, Nordsee, Baskin-Robbins, Cold Stone Creamery, Haagen-Dazs, Insomnia Cookies, Crumbl, Smoothie King, Nothing Bundt, Rita's Italian Ice, Jollibee, Pollo Tropical, Pollo Campero, Telepizza.

**4. Exclusion keywords (checked against name + type)**

| Category | Keywords |
|---|---|
| Medical | hospital, clinic, dentist, doctor, pharmacy, chiropractor, physiotherapy, veterinary, optometrist, urgent care |
| Government | dmv, courthouse, post office, police station, embassy, city hall, fire station |
| Education | school, daycare, preschool, tutoring, university campus |
| Grooming | threading, waxing studio, lash extension, microblading, permanent makeup, nail salon, hair salon, barber, beauty salon, beauty lounge, beauty bar, med spa, medspa, aesthetics spa, aesthetic clinic, tanning studio, brow bar, and more |
| Fitness | gym, fitness center, crossfit, yoga studio, pilates, martial arts dojo, boxing gym |
| Kids | kids play, children's, indoor playground, chuck e. cheese, kidzone, splash pad, soft play |
| Utilitarian | gas station, car wash, laundromat, storage unit, parking garage, auto repair, car dealership |
| Delivery-only | ghost kitchen, delivery only, cloud kitchen, virtual kitchen |
| Food truck | food truck, food cart, mobile kitchen |
| Not a venue | real estate, insurance, accounting, law firm, consulting, contractor, plumber, electrician, production company, booking agency, talent agency, event management |
| Gambling | spielhalle, betting shop, slot machine, gambling hall |
| Allotment | kleingartenanlage, kleingarten, schrebergarten, allotment garden, community garden, and more |

**5. Casual chain demotion**

If a place's name matches a sit-down chain (Olive Garden, Red Lobster, Outback, Cheesecake Factory, Applebee's, Chili's, TGI Friday's, Denny's, IHOP, Waffle House, Cracker Barrel, Texas Roadhouse, Red Robin, Buffalo Wild Wings, Longhorn Steakhouse, Nando's, Wagamama, Yo! Sushi, Pizza Express, Hippopotamus), and it was tagged as `upscale_fine_dining`, it gets **downgraded** to `brunch_lunch_casual`. These are real restaurants with table service -- they just aren't upscale.

**6. Fine dining auto-promotion**

If a restaurant has `PRICE_LEVEL_VERY_EXPENSIVE` + rating >= 4.0, it gets **promoted** to `upscale_fine_dining` automatically. The `upscale_fine_dining` and `brunch_lunch_casual` categories are mutually exclusive -- a place can never have both.

**7. Flowers type guard**

Strips the `flowers` category from places whose primary type is garden center, farm, supplier, cemetery, funeral home, restaurant, bar, or food store. Also strips flowers from delivery-only patterns ("flower delivery", "floral delivery", "same day delivery") unless the place is actually a florist.

---

## Part 3: AI Classification (Stages 3-5)

Places that survive the deterministic filter go through three more stages.

### Stage 3: Web Search (Serper API)

The system Googles `"place name" "address"` and grabs the top 5 results. This provides real-world context that Google's place data alone can't -- reviews, articles, menus, social presence.

**Cost:** $0.0004 per place.

### Stage 4: Website Verification

From the search results, the system looks for an **owned domain** -- a real website that isn't just a Yelp, Google, Facebook, TripAdvisor, or other social/directory page. If found, it checks that the domain actually resolves (5-second timeout).

**Filtered social domains:** Google, Facebook, Instagram, Twitter/X, Yelp, TripAdvisor, Foursquare, YouTube, TikTok, LinkedIn, Pinterest, Fresha, Treatwell, Groupon, Booksy, Planity, ClassPass, MindBody, Wikipedia, Yellow Pages, and more.

**Why this matters:** Some categories (upscale_fine_dining, movies_theatre, creative_arts, play) require a `candidate_website` to qualify. If the AI can't find a real website, those categories won't be assigned.

### Stage 5: GPT-4o-mini Classification

The AI receives a **fact sheet** for each place containing:
- Name, primary type, current categories
- Price level, rating, review count
- Whether it has a website and opening hours
- Top 3 search result snippets (truncated to 650 chars)

It returns:
- **Decision:** accept, reject, or reclassify
- **Categories:** which of the 10 categories apply
- **Primary identity:** what the place fundamentally is (e.g., "upscale steakhouse", "pottery studio")
- **Confidence:** high, medium, or low
- **Reason:** plain-English explanation

**Cost:** ~$0.00045 per place (input + output tokens).

### What the AI knows about each category

The GPT system prompt defines each category with examples:

| Category | AI Definition (summary) |
|---|---|
| **Brunch, Lunch & Casual** | Any real sit-down restaurant. Includes chain restaurants with table service (Olive Garden, IHOP). Food halls and food markets. NO fast food/counter-service. |
| **Nature & Views** | Parks, trails, beaches, botanical gardens, scenic viewpoints, observation decks, waterfronts, nature preserves, picnic grounds, hiking areas. |
| **Icebreakers** | Cafes, coffee shops, tea houses, bakeries with seating, bookstore cafes, ice cream parlors, juice bars. Casual low-pressure spots for a 45-minute conversation. |
| **Drinks & Music** | Bars, cocktail bars, wine bars, breweries, pubs, speakeasies, rooftop bars, nightclubs, live music venues, karaoke bars, hookah bars, wineries. |
| **Creative & Arts** | Museums, art galleries, cultural centers, sculpture parks, immersive art, pottery/paint-and-sip studios, planetariums, aquariums, castles/landmarks. |
| **Movies & Theatre** | Real cinemas (AMC, Regal, indie, drive-in, IMAX). Performing arts: concert halls, theaters, opera houses, comedy clubs, jazz clubs, amphitheaters. |
| **Upscale & Fine Dining** | Special occasion restaurants. Signals: upscale ambience, high-end cuisine, reservation culture, elevated service, $$$/$$$$ pricing, "upscale/elegant/tasting menu/sommelier/Michelin." Mutually exclusive with Brunch, Lunch & Casual. |
| **Play** | Active fun for adults -- bowling, arcades, escape rooms, go-karts, laser tag, karaoke, mini golf, axe throwing, TopGolf, VR, rock climbing, kayaking. NO kids-only venues. |
| **Groceries** | Grocery stores, supermarkets, specialty food stores, gourmet markets, butcher shops, cheese shops. |
| **Flowers** | Florists, flower shops, flower bars. Large supermarkets with staffed floral departments get BOTH flowers and groceries. |

### Key AI rules

- **Low ratings don't disqualify.** A bar with 3.2 stars is still a bar. Ratings measure quality, not category fitness.
- **Mutually exclusive:** `upscale_fine_dining` and `brunch_lunch_casual` can never coexist on the same place.
- **Website required for some categories:** upscale_fine_dining, movies_theatre, creative_arts, and play require a real website to qualify.
- **No opening hours = lower confidence** (unless it's a park/trail/outdoor venue).
- **Multi-category allowed:** A tapas wine bar gets both `brunch_lunch_casual` + `drinks_and_music`. An aquarium gets `creative_arts` + `play`.
- **Reclassify over reject:** If a place is in the wrong category but fits a different one, the AI reclassifies rather than rejecting.

---

## Part 4: Post-Classification

### Exclusivity enforcement

After GPT returns categories, the pipeline runs `enforceExclusivity()` -- if `upscale_fine_dining` is present, `brunch_lunch_casual` is stripped. This is a hard rule, not AI discretion.

### Hallucination guard

GPT output is filtered against the 10 valid category slugs. Any category string GPT invents that isn't in the canonical list gets silently dropped.

### What gets written to the database

For each place, `place_pool` is updated with:
- `ai_approved` -- true/false
- `ai_categories` -- array of category slugs
- `ai_primary_identity` -- what the place is (e.g., "wine bar", "art museum")
- `ai_confidence` -- 0.95 (high), 0.7 (medium), 0.4 (low)
- `ai_reason` -- why the decision was made
- `ai_web_evidence` -- search result snippets
- `ai_validated_at` -- timestamp

### Admin review queue

After a validation run, the admin can review:
- **Low confidence** decisions (AI wasn't sure)
- **Reclassified** places (AI changed the category)
- **All overrides** (admin manually changed an AI decision)

Admins can override any AI decision: accept, reject, or reclassify with different categories. Overrides go directly to `place_pool` and are marked in the audit trail.

---

## Part 5: Cost and Scale

| Component | Cost per place | Notes |
|---|---|---|
| Deterministic filter | $0 | Runs locally, no API calls |
| Serper web search | $0.0004 | Only for places that pass Stage 2 |
| GPT-4o-mini | ~$0.00045 | Input + output tokens |
| **Total per place** | **~$0.00085** | Only for places reaching Stage 5 |

~80% of rejections happen in the deterministic filter (Stage 2) at zero cost. A city with 10,000 places might only send ~2,000 to GPT.

### Safety guardrails

- **Cost cap:** If actual cost exceeds 2x the estimate, the run auto-pauses.
- **Quota detection:** If OpenAI returns a quota error, the run pauses immediately with a clear message.
- **Stale batch detection:** Batches stuck in "running" for >5 minutes get auto-failed.
- **Batch-by-batch execution:** The admin triggers each batch manually -- no runaway processes.

---

## Part 6: Global Exclusions (Applied Everywhere)

These place types are excluded from ALL categories, ALL searches, and ALL card generation:

`gym`, `fitness_center`, `dog_park`, `school`, `primary_school`, `secondary_school`, `university`, `preschool`

Additionally, **venue name keywords** block places across all categories:
- Kids venues: "kids", "children", "toddler", "baby", "bounce", "trampoline", "play space", "jungle gym", "fun zone"
- Education: "school", "academy", "institute", "training center", "university", "college"

---

## Part 7: The 10 Canonical Categories

| Display Name | DB Slug | Visible to Users | Notes |
|---|---|---|---|
| Brunch, Lunch & Casual | `brunch_lunch_casual` | Yes | Largest category. Mutually exclusive with upscale. |
| Nature & Views | `nature` | Yes | Includes picnic grounds. No opening hours required. |
| Icebreakers | `icebreakers` | Yes | Low-pressure first-date spots. |
| Drinks & Music | `drinks_and_music` | Yes | Bars, nightlife, live music. |
| Creative & Arts | `creative_arts` | Yes | Museums, galleries, cultural venues. Requires website. |
| Movies & Theatre | `movies_theatre` | Yes | Cinemas + live performance. Requires website. |
| Upscale & Fine Dining | `upscale_fine_dining` | Yes | Special occasion. Requires website. Mutually exclusive with casual. |
| Play | `play` | Yes | Active fun for adults. Requires website. |
| Groceries | `groceries` | Hidden | Backend-only. Users don't browse this. |
| Flowers | `flowers` | Hidden | Backend-only. Used for gifting features. |

### Backward compatibility

The system maintains aliases for every past category name: `casual_eats` -> Brunch, Lunch & Casual, `first_meet` -> Icebreakers, `drink` -> Drinks & Music, `watch` / `live_performance` -> Movies & Theatre, `fine_dining` -> Upscale & Fine Dining, `sip & chill` -> Drinks & Music, `stroll` -> Nature & Views, and dozens more. Old data never breaks.

---

## Key Files

| File | What it does |
|---|---|
| `supabase/functions/_shared/seedingCategories.ts` | 13 seeding configs with Google type lists |
| `supabase/functions/_shared/categoryPlaceTypes.ts` | 10-category taxonomy, aliases, exclusion lists |
| `supabase/functions/ai-verify-pipeline/index.ts` | Full 5-stage validation pipeline |
| `supabase/functions/admin-seed-places/index.ts` | Google Places seeding engine (tile-based) |
| `mingla-admin/src/pages/SeedPage.jsx` | Admin UI for seeding |
| `mingla-admin/src/pages/AIValidationPage.jsx` | Admin UI for validation runs and review |
