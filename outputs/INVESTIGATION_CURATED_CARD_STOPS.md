# Investigation: Curated Card Stop Generation, Rotation & Alternation

**Date:** 2026-03-24
**Scope:** Full forensic trace of how curated card stops are generated, stored, served, and what alternates between cards
**Files Read:** 17 files across edge functions, shared services, migrations, types, and mobile components

---

## How Curated Card Stops Work (Plain English)

Each curated card is a **multi-stop itinerary** (2-5 venues). The system works in three phases:

1. **Generation** — The `generate-curated-experiences` edge function builds cards from pre-seeded venues in `place_pool`. Each experience type (adventurous, first-date, romantic, group-fun, picnic-dates, take-a-stroll) has a **template** that says "Stop 1 is an Activity, Stop 2 is Drinks, Stop 3 is Dinner." Each template has **combos** — different category combinations that fill those stop slots.

2. **Storage** — Cards go into `card_pool` (parent) with stops as JSONB. Normalized child rows go into `card_pool_stops` (one row per stop, with FK to place_pool).

3. **Serving** — The `query_pool_cards` RPC fetches cards, filters by user impressions/budget/location, and returns them. Travel times are recomputed at serve-time for each user's actual location.

---

## What Shows in Each Experience Type & What Alternates

### Adventurous — 3 stops, 4 combos

| Stop | Role | Alternates Between |
|------|------|--------------------|
| 1 | Activity | `nature_views` (parks, hiking, scenic) **OR** `play` (bowling, arcades, go-karts) |
| 2 | Drinks | `drink` ONLY (bars, pubs, breweries) — **never alternates** |
| 3 | Dinner | `casual_eats` **OR** `fine_dining` |

### First Date — 4 stops, 8 combos

| Stop | Role | Alternates Between |
|------|------|--------------------|
| 1 | Flowers *(optional, dismissible)* | `flowers` ONLY — **never alternates** |
| 2 | Activity | `watch` (movie theaters only!) **OR** `creative_arts` **OR** `live_performance` **OR** `first_meet` (cafes, bookstores) |
| 3 | Dinner | `casual_eats` **OR** `fine_dining` |
| 4 | Drinks | `drink` ONLY — **never alternates** |

### Romantic — 4 stops, 2 combos

| Stop | Role | Alternates Between |
|------|------|--------------------|
| 1 | Flowers *(optional, dismissible)* | `flowers` ONLY — **never alternates** |
| 2 | Experience | `creative_arts` **OR** `live_performance` |
| 3 | Dinner | `fine_dining` ONLY — **never alternates** |
| 4 | Drinks | `drink` ONLY — **never alternates** |

### Group Fun — 3 stops, 4 combos

| Stop | Role | Alternates Between |
|------|------|--------------------|
| 1 | Activity | `play` **OR** `watch` (movie theaters only!) |
| 2 | Food | `casual_eats` **OR** `fine_dining` |
| 3 | Drinks | `drink` ONLY — **never alternates** |

### Picnic Dates — 3 stops, 1 combo

| Stop | Role | Alternates Between |
|------|------|--------------------|
| 1 | Groceries | `groceries` ONLY |
| 2 | Flowers *(optional, dismissible)* | `flowers` ONLY |
| 3 | Picnic Spot *(reverse-anchor)* | `picnic_park` ONLY |

**Zero combo variety.** Every picnic card has the exact same category structure. Only the specific venues change.

### Take a Stroll — 2 stops, 2 combos

| Stop | Role | Alternates Between |
|------|------|--------------------|
| 1 | Nature | `nature_views` ONLY — **never alternates** |
| 2 | Food | `casual_eats` **OR** `fine_dining` |

---

## BUGS FOUND

### BUG 1 (RED): Stop Label "End With" Missing When Optional Stops Are Skipped

**File:** `supabase/functions/generate-curated-experiences/index.ts:422-427`
**Defective Code:**
```typescript
const stopLabels = totalStops === 2
    ? ['Start Here', 'End With']
    : totalStops === 3
      ? ['Start Here', 'Then', 'End With']
      : ['Start Here', 'Then', 'Then', 'End With'];
const stopLabel = stopLabels[Math.min(stopNumber - 1, stopLabels.length - 1)] || 'Explore';
```

**What's wrong:** `totalStops` is always `typeDef.stops.length` (the *declared* count including optional stops), but `stopNumber` is the position in the *actually built* array. When Flowers is skipped in first-date/romantic/picnic, the last stop gets label "Then" instead of "End With".

**Example — First Date without Flowers:**
- Defined: 4 stops → labels array = `['Start Here', 'Then', 'Then', 'End With']`
- Actually built: 3 stops (Activity, Dinner, Drinks)
- Stop 1 (Activity): index 0 → "Start Here" ✓
- Stop 2 (Dinner): index 1 → "Then" ✓
- Stop 3 (Drinks): index 2 → "Then" ✗ **should be "End With"**

**Impact:** Users see "Then" as the last stop label instead of "End With" on every card where Flowers was unavailable. This affects first-date, romantic, and picnic-dates.

**Fix:** Use `stops.length` (actual count) for label array sizing, not `typeDef.stops.length`.

---

### BUG 2 (RED): Fine Dining Price Floor Filter Is Dead Code

**File:** `supabase/functions/generate-curated-experiences/index.ts:651-653`
**Defective Code:**
```typescript
if (catId === 'fine_dining' && !tierMeetsMinimum(...) && p.price_tier !== 'bougie' && p.price_tier !== 'baller') {
    // Allow if price_tier is already set correctly, otherwise check price_level
}
```

**What's wrong:** The if-block body is **completely empty**. The comment describes intent to filter cheap places out of fine_dining, but there's no `return false`. Every venue passes through regardless of price tier.

**Impact:** Fine dining stops can include cheap restaurants (e.g., a `$` fast-casual place that happens to have `fine_dining_restaurant` as its Google type). This directly contradicts the experience promise of "romantic dinner" and "fine dining" stops.

**Fix:** Add `return false;` inside the if-block.

---

### BUG 3 (RED): Curated Cards Share `google_place_id` With Single Cards — Upsert Collision

**File:** `supabase/functions/generate-curated-experiences/index.ts:1217`
**Defective Code:**
```typescript
google_place_id: mainStops[0]?.placeId || card.id || `curated-${Date.now()}-...`
```

Combined with the upsert on line 1261:
```typescript
.upsert(cardRows, { onConflict: 'google_place_id' })
```

And the unique index:
```sql
CREATE UNIQUE INDEX idx_card_pool_unique_google_place_id ON card_pool(google_place_id);
```

**What's wrong:** A curated card's `google_place_id` is set to the first main stop's Google Place ID. A single card for the same venue has the *same* `google_place_id`. The upsert with `onConflict: 'google_place_id'` means:

1. **Curated cards overwrite single cards** — If a single card for "Joe's Bar" exists, and then a curated card starting at "Joe's Bar" is generated, the curated card's upsert *replaces* the single card.
2. **Only one curated card per first-stop venue** — Two adventurous cards both starting at Central Park cannot coexist. The second upsert overwrites the first.
3. **Dedup in RPC compounds the issue** — `DISTINCT ON (google_place_id)` in `query_pool_cards` dedupes cards sharing a first-stop venue, even when they have completely different itineraries.

**Impact:** Massive reduction in card variety. Cards are silently destroyed on storage. Two "adventurous" cards with different routes but the same starting park — only one survives. A curated card can also silently replace a popular single card.

**Fix:** Curated cards should use a synthetic ID for `google_place_id`, e.g., `curated_${experienceType}_${hash_of_all_stop_ids}`. This prevents collision with single cards and allows multiple curated cards sharing a first stop.

---

## DESIGN CONCERNS (Not Bugs, But Limit Quality)

### CONCERN 1: Drinks Stop Never Alternates Across All Types

Every single experience type hardcodes `drink` for the Drinks slot. The `drink` category maps to: bar, cocktail_bar, lounge_bar, wine_bar, pub, brewery, beer_garden, brewpub.

This means you can never get a curated card where the "drinks" stop is, say, a tea house, dessert bar, or juice shop. For users who don't drink alcohol, there's zero variety in that slot.

### CONCERN 2: `watch` Category = Only Movie Theaters

The `watch` seeding category includes only `movie_theater`. Its excluded types include museums, art galleries, and everything else. This means:
- First-date combos 1-2 (Activity=watch) only generate movie theater activities
- Group-fun combos 3-4 (Activity=watch) only generate movie theater activities
- In cities with few movie theaters in the pool, these combos silently fail

### CONCERN 3: Picnic Has Zero Combo Variety

Only 1 combo: `['groceries', 'flowers', 'picnic_park']`. Every picnic card has the exact same structure. Only the specific grocery store, florist, and park change. There's no structural variety at all.

Possible additions: deli instead of grocery, bakery instead of grocery, waterfront instead of park.

### CONCERN 4: Romantic Dinner Is Always Fine Dining

Both romantic combos hardcode `fine_dining` for Dinner. In cities with few fine dining venues in the pool, romantic cards may be underproduced. Also limits variety for users who want "romantic but casual."

### CONCERN 5: Dead Variable in Combo List Builder

**File:** `supabase/functions/generate-curated-experiences/index.ts:558`
```typescript
const shuffled = shuffle([...typeDef.combos]); // Created but NEVER used
while (comboList.length < limit * 2) {
    comboList.push(...shuffle([...typeDef.combos]));
}
```

The `shuffled` variable on line 558 is allocated and shuffled but never pushed into `comboList`. The while loop independently shuffles fresh copies. Minor waste, no functional impact.

---

## CATEGORY → GOOGLE TYPES REFERENCE

For completeness, here's what Google Place types each stop category resolves to:

| Category ID | Google Place Types |
|-------------|-------------------|
| `nature_views` | beach, botanical_garden, garden, hiking_area, national_park, nature_preserve, park, scenic_spot, state_park, observation_deck, tourist_attraction |
| `drink` | bar, cocktail_bar, lounge_bar, wine_bar, pub, brewery, beer_garden, brewpub |
| `casual_eats` | restaurant, bistro, brunch_restaurant, breakfast_restaurant, diner, cafe, coffee_shop, sandwich_shop, pizza_restaurant, hamburger_restaurant, mexican_restaurant, mediterranean_restaurant, thai_restaurant, vegetarian_restaurant |
| `fine_dining` | fine_dining_restaurant, french_restaurant, italian_restaurant, steak_house, seafood_restaurant, wine_bar |
| `play` | amusement_center, bowling_alley, miniature_golf_course, go_karting_venue, paintball_center, video_arcade, karaoke, amusement_park |
| `watch` | movie_theater |
| `creative_arts` | art_gallery, art_museum, art_studio, museum, history_museum, performing_arts_theater, cultural_center, cultural_landmark, sculpture |
| `live_performance` | performing_arts_theater, concert_hall, opera_house, philharmonic_hall, amphitheatre |
| `first_meet` | book_store, cafe, coffee_shop, tea_house, bakery, dessert_shop, juice_shop, bistro, wine_bar, lounge_bar |
| `flowers` | florist |
| `groceries` | grocery_store, supermarket |
| `picnic_park` | picnic_ground, park |
| `wellness` | spa, massage_spa, sauna, wellness_center, yoga_studio |

---

## FULL GENERATION ALGORITHM (Step by Step)

### Step 1: Calculate Search Radius
From user's travel mode + constraint: `radius = speed × travelConstraint × 1000/60`. Clamped to 500m-50km.

### Step 2: Pre-Fetch Places
For each unique category across all combos, query `place_pool` within the radius. Filter by: types match, has photos, not a child venue, not excluded type. Sort by rating descending.

**Exception — Picnic (reverse-anchor):** Find the park first, then query other categories within 3km of the park.

### Step 3: Build Combo List
Shuffle the experience type's combos, repeat until `limit × 2` entries. This is the round-robin attempt list.

### Step 4: For Each Combo, Build Stops
- **First non-optional stop:** Pick highest-rated place (quality first)
- **Subsequent stops:** Pick closest place to previous stop (proximity chaining)
- **Optional stops:** Skip gracefully if no places available
- **Budget check:** Per-stop budget = total budget / number of required stops
- **Dedup:** Track used place IDs globally to prevent the same venue appearing in multiple cards

### Step 5: Validate Card
- Must have all required (non-optional) stops
- Total price must be within budget
- First stop's travel time must be ≤ 1.5× travel constraint
- No duplicate place IDs within the card

### Step 6: AI Enrichment
- Generate stop descriptions via OpenAI (tone varies by experience type)
- For picnic: generate shopping list
- Fire-and-forget: teaser text for paywall preview

### Step 7: Store in Pool
- Upsert card to `card_pool` with `onConflict: 'google_place_id'` ← **BUG 3**
- Insert normalized stops to `card_pool_stops`
- Integrity check: delete any cards with missing stops

### Step 8: Serve from Pool
- `query_pool_cards` RPC filters by location, budget, experience_type, user impressions
- Unseen cards served first (by popularity score)
- When all seen → fallback rotation by oldest-impression-first
- Serve-time: recompute travel times for requesting user's actual location

---

## VERDICTS SUMMARY

| # | Finding | Severity | Type |
|---|---------|----------|------|
| BUG 1 | Stop labels wrong when optional stops skipped | RED — user-visible | Label logic defect |
| BUG 2 | Fine dining price floor is dead code | RED — quality breach | Empty if-block |
| BUG 3 | Curated cards collide with single cards on google_place_id | RED — data corruption | Upsert conflict key |
| CONCERN 1 | Drinks stop never alternates | YELLOW — variety | Design limitation |
| CONCERN 2 | `watch` = only movie_theater | YELLOW — variety | Narrow category |
| CONCERN 3 | Picnic has zero combo variety | YELLOW — variety | Single combo |
| CONCERN 4 | Romantic dinner always fine_dining | YELLOW — variety | Fixed category |
| CONCERN 5 | Dead `shuffled` variable | LOW — code quality | Unused allocation |
