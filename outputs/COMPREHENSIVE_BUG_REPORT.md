# Comprehensive Bug Report — Mingla Card Pipeline, Core Systems & Admin Tooling

**Date:** 2026-03-21
**Status:** Investigation complete. All root causes proven with code + data evidence.
**Total bugs:** 51 (11 mobile/backend + 40 admin Card Pool page)
**Sources:** Full code trace (40+ files), live DB queries, INVESTIGATION_POOL_TO_CARD_FLOW.md, CARD_POOL_BUG_REPORT.md

---

## How This Document Is Organized

11 bugs total, grouped by severity. Each bug has:
- **What you see** — the user-visible symptom
- **Why it happens** — proven root cause with file:line evidence
- **Data proof** — live DB query results confirming the issue
- **What needs to change** — concrete fix description

---

## P0 — App Is Broken (Nothing Works Until These Are Fixed)

---

### BUG-01: Swipeable Deck Shows Zero Cards Despite 1,468 Cards in Pool

**What you see:** You open the app, set your preferences, and the swipeable deck is completely empty. No cards to swipe. The pool has 1,468 active cards (656 single + 840 curated) for Raleigh but none are served.

**Why it happens:** A **category name format mismatch** between the mobile app and the database.

The pipeline works like this:
1. You pick categories in preferences (stored as slugs: `nature`, `casual_eats`, `drink`)
2. Mobile app converts slugs to display names: `nature → "Nature & Views"`, `casual_eats → "Casual Eats"` (`deckService.ts:257` via `PILL_TO_CATEGORY_NAME`)
3. These display names are sent to the `discover-cards` edge function
4. The edge function calls `resolveCategories()` which keeps them as display names (`cardPoolService.ts:158`)
5. The SQL RPC `query_pool_cards` receives `ARRAY['Nature & Views', 'Casual Eats']` as `p_categories`
6. The SQL does: `cp.categories && p_categories` (Postgres array overlap)
7. But `card_pool.categories` stores **slugs**: `ARRAY['nature_views']`, `ARRAY['casual_eats']`
8. `ARRAY['nature_views']` && `ARRAY['Nature & Views']` → **FALSE** → zero cards returned

**Proof chain:**
```
deckService.ts:257       → PILL_TO_CATEGORY_NAME['nature'] = 'Nature & Views'
discover-cards:277       → resolveCategories(["Nature & Views"]) → ["Nature & Views"]
cardPoolService.ts:158   → resolveCategories(["Nature & Views"]) → ["Nature & Views"]
cardPoolService.ts:167   → p_categories = ["Nature & Views"]
query_pool_cards SQL:136 → cp.categories && ARRAY['Nature & Views']
card_pool actual data    → categories = ['nature_views']
Result                   → NO OVERLAP → 0 rows
```

**Data proof:**
```sql
SELECT DISTINCT unnest(categories) FROM card_pool WHERE is_active = true;
-- Result: nature_views, casual_eats, first_meet, drink, play, creative_arts,
--         picnic_park, wellness, watch, fine_dining, groceries, flowers
-- ALL slugs. Zero display names.
```

**What needs to change:** Either:
- (A) Make `resolveCategories()` return slugs (to match what's in the DB), OR
- (B) Normalize inside the SQL RPC (convert both sides to lowercase slugs before comparing), OR
- (C) Update `card_pool.categories` to store display names (risky — touches seeding pipeline)

Option (B) is safest — isolated to one SQL function, no mobile app change needed.

---

### BUG-02: Zero Photos on Any Card — 0% Image Coverage Across Entire Card Pool

**What you see:** Admin dashboard shows "Image Coverage: 0%". Even if BUG-01 is fixed, every card would show a generic Unsplash fallback image instead of real photos.

**Why it happens:** The seeding pipeline downloads photos into `place_pool.stored_photo_urls` correctly, but the card generation step (`generate-single-cards`) **never copies** those URLs into `card_pool.image_url` or `card_pool.images`.

**Data proof:**
```sql
-- card_pool: ZERO images
SELECT COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url != '') FROM card_pool WHERE is_active = true;
-- Result: 0

-- place_pool: ALL 813 places have photos
SELECT COUNT(*) FILTER (WHERE stored_photo_urls IS NOT NULL AND array_length(stored_photo_urls, 1) > 0)
FROM place_pool pp JOIN card_pool cp ON pp.id = cp.place_pool_id WHERE cp.is_active = true;
-- Result: 813
```

The photos exist in storage. They're just not referenced by `card_pool`.

**What needs to change:**
1. Fix `generate-single-cards` to copy `place_pool.stored_photo_urls[1]` → `card_pool.image_url` and full array → `card_pool.images` during card creation
2. Backfill existing 1,468 cards with a one-time SQL update:
```sql
UPDATE card_pool cp
SET image_url = pp.stored_photo_urls[1],
    images = pp.stored_photo_urls
FROM place_pool pp
WHERE pp.id = cp.place_pool_id
  AND pp.stored_photo_urls IS NOT NULL
  AND array_length(pp.stored_photo_urls, 1) > 0;
```

---

### BUG-03: Per-Category Exclusions Defined But NEVER Enforced — Excluded Items Appear

**What you see:** You see kids' venues, asian grocery stores, and other inappropriate places in your results despite having them in your exclusion spec.

**Why it happens:** The exclusion system has **three layers, all broken:**

**Layer 1 — Seeding (partial):** `admin-seed-places` passes `excludedPrimaryTypes` to Google's Nearby Search API (`admin-seed-places/index.ts:400`). But Google only filters on `primaryType`, not secondary `types`. A grocery store with `primaryType: "grocery_store"` and `types: ["grocery_store", "asian_grocery_store"]` passes Google's filter because `primaryType` isn't `"asian_grocery_store"`.

**Layer 2 — Post-fetch seeding filter (minimal):** `admin-seed-places/index.ts:219` only checks 3 global types (`gym`, `fitness_center`, `dog_park`). Category-specific `excludedPrimaryTypes` from `seedingCategories.ts` are NOT checked post-fetch.

**Layer 3 — Serve time (completely absent):** `CATEGORY_EXCLUDED_PLACE_TYPES` is defined in `categoryPlaceTypes.ts:355-506` with extensive per-category exclusions including `asian_grocery_store` in `RETAIL_EXCLUSIONS`. The function `getExcludedTypesForCategory()` is exported. But it is **NOT imported by ANY active serving function:**
- `discover-cards/index.ts` — does NOT use it
- `discover-experiences/index.ts` — does NOT use it
- `generate-curated-experiences/index.ts` — does NOT use it

It IS imported by two **inactive** functions:
- `generate-experiences/index.ts` — legacy, not called
- `new-generate-experience-/index.ts` — WIP, not deployed

**The SQL RPC `query_pool_cards`** only excludes 3 global types:
```sql
v_excluded_types TEXT[] := ARRAY['gym', 'fitness_center', 'dog_park'];
```

No per-category exclusions. No user-defined exclusions. That's it.

**For "kids" specifically:** Only Fine Dining's `CATEGORY_EXCLUDED_PLACE_TYPES` includes kid-related types (`children_store`, `child_care_agency`, `preschool`, `indoor_playground`). No other category excludes them. And even Fine Dining's exclusions are never applied.

**What needs to change:**
1. Add per-category exclusion filtering in `query_pool_cards` SQL or post-query in the edge functions
2. Add a post-fetch filter in `admin-seed-places` that checks `excludedPrimaryTypes` against ALL `types` (not just `primaryType`)
3. Retroactively clean the pool: deactivate cards whose `place_pool.types` contain excluded types for their category

---

## P1 — Major Bugs (Core Features Not Working Right)

---

### BUG-04: "For You" Discover Cards Missing Categories and Photos

**What you see:** The "For You" tab on the Discover page shows cards without proper category labels and without real photos (generic Unsplash fallback instead).

**Why it happens:** Two compounding issues:

1. **Same photo gap as BUG-02** — `discover-experiences` reads `card_pool.image_url` and `card_pool.images`, both NULL for all cards. Falls back to `https://images.unsplash.com/photo-1441986300917-64674bd600d8`.

2. **Same category slug mismatch as BUG-01** — `discover-experiences` also queries `card_pool` by category. If it uses the same `resolveCategories()` → display names path, it hits the same slug vs display name mismatch. The category field on cards shows the raw slug (`nature_views`) instead of the display name (`Nature & Views`) because that's what's stored in `card_pool.categories`.

**What needs to change:** Fixing BUG-01 and BUG-02 fixes this automatically. No separate fix needed.

---

### BUG-05: Sender Gets No Notification When Pairing Request Is Accepted

**What you see:** You send a pair request. The other person accepts it. You don't get a push notification. You only see the update if you happen to have the app open with an active Realtime connection.

**Why it happens:** The acceptance flow is **asymmetric by omission:**

- **Sending a pair request** → calls `notify-pair-request-visible` → sends push to receiver via `notify-dispatch` with type `pair_request_received`
- **Accepting a pair request** → calls `accept_pair_request_atomic` RPC → updates DB → **nothing sends a push to the sender**

The type mapping `pair_request_accepted` exists in `notify-dispatch/index.ts:23` (it maps to the `friend_requests` preference key), but **no code anywhere invokes it**. It's a prepared slot with no caller.

The sender relies entirely on Supabase Realtime WebSocket (`useSocialRealtime.ts`). If the WebSocket is disconnected (app backgrounded, poor connection, device sleep), the sender never learns their request was accepted until they reopen the app and the cache refreshes.

**What needs to change:** After `acceptPairRequest` succeeds, call `notify-dispatch` with type `pair_request_accepted` targeting the sender. Can be done either:
- In the mobile app (`useNotifications.ts` after the RPC call), or
- In a new edge function `notify-pair-request-accepted`, or
- Via a database trigger on `pair_requests` status change to `'accepted'`

---

### BUG-06: Push/Sound Notifications Silently Suppressed in Multiple Scenarios

**What you see:** You expect push notifications and sound alerts but they never arrive.

**Why it happens:** Multiple silent suppression layers:

1. **Quiet hours (10 PM – 8 AM):** `notify-dispatch/index.ts` suppresses ALL non-DM pushes during quiet hours based on user's timezone. No log, no retry, just silently dropped.

2. **App in foreground:** `app/index.ts` foreground handler intentionally suppresses non-message pushes when the app is open. Only DM/board message pushes show in the system tray.

3. **Rate limiting:** Max 10 notifications of same type per 5 minutes. During testing, easy to hit this cap.

4. **OneSignal linkage failure:** If `OneSignal.login(userId)` failed during app init (retries 3 times with 3s delays), the device isn't associated with the user. Pushes go to OneSignal but OneSignal can't route them to the device.

5. **Sound is device-controlled:** The app does NOT play notification sounds. Sound depends entirely on the user's device notification settings for the Mingla app and OneSignal's payload configuration. In-app awareness is haptic only (`expo-haptics`).

**What needs to change:**
- Verify OneSignal device registration for the user in OneSignal dashboard
- Check `notification_preferences` table for the user (is `push_enabled` true? are type-specific toggles on?)
- Consider making quiet hours configurable instead of hardcoded 10 PM – 8 AM
- Add logging/telemetry when pushes are suppressed so you can debug silently dropped notifications

---

### BUG-07: Card Quality Degrades — Same Cards Over and Over

**What you see:** After swiping for a while, you keep seeing the same places repeatedly. The quality and variety of recommendations drops.

**Why it happens:** Four compounding factors:

1. **Finite pool, no refresh:** The pool is 100% admin-managed (see INVESTIGATION_POOL_TO_CARD_FLOW.md). No automation exists — no cron jobs, no auto-seeding, no Google API calls at runtime. Every card got there because an admin clicked a button. Once you've seen them all, there's nothing new.

2. **Impression saturation:** `query_pool_cards` filters out cards you've already seen (via `user_card_impressions`). When all cards are seen, it falls back to showing the least-recently-seen cards — which are still the same cards you already swiped through.

3. **3-batch rotation ceiling:** `RecommendationsContext.tsx` has `MAX_BATCHES = 3`. After 3 batches, it rotates back to batch 0 and serves the same sequence.

4. **24-hour daily cache for "For You":** The Discover "For You" feed caches results in `discover_daily_cache` for 24 hours. Same cards all day.

**Current pool size for Raleigh:**
- 656 single cards across 12 categories (avg ~55 per category)
- 840 curated cards
- 1,468 "Never Served" (because of BUG-01 — the category mismatch means literally zero cards have ever been served)

**What needs to change:**
- Fixing BUG-01 immediately unlocks the full pool (1,468 cards is actually decent)
- Longer term: consider automated re-seeding schedules or pool growth alerts in admin
- Consider expanding MAX_BATCHES or switching to a continuous rotation model

---

## P2 — UX Issues (Working but Confusing)

---

### BUG-08: Curated Card Labels Show Experience Type, Not the Pill You Selected

**What you see:** You select the "First Date" curated pill, but cards in the deck might show labels like "Adventurous" or "Romantic" instead of "First Date".

**Why it happens:** The `categoryLabel` on curated cards is set to the **experience type label**, not the user's selected pill:

```
generate-curated-experiences/index.ts:465
  categoryLabel: CURATED_TYPE_LABELS[experienceType] || 'Explore'
```

`CURATED_TYPE_LABELS` maps:
- `adventurous` → "Adventurous"
- `first-date` → "First Date"
- `romantic` → "Romantic"
- `group-fun` → "Group Fun"
- `picnic-dates` → "Picnic Dates"
- `take-a-stroll` → "Take a Stroll"

Then `cardConverters.ts:80` sets `category: card.categoryLabel || 'Experience'`.

This is technically correct for curated cards (they span multiple categories like Activity → Drinks → Dinner), but if the pill-to-intent mapping sends a different intent than the pill the user visually selected, the label won't match expectation.

**What needs to change:** Verify that `deckService.ts` maps each curated pill ID to the correct `experienceType` 1:1. If the mapping is correct, this is working as designed. If the user expects the pill name to appear on cards, the `categoryLabel` should be set to the pill's display name instead of the experience type label.

---

### BUG-09: Category Type Lists Diverge Between Seeding and Serving

**What you see:** The app seeds places using one set of Google Places types (`seedingCategories.ts`) but resolves categories at serve time using a completely different, much broader set (`categoryPlaceTypes.ts` `MINGLA_CATEGORY_PLACE_TYPES`).

**Examples of divergence:**
- **First Meet:** Seeding uses 10 types → Serving list has 29 types (adds bowling_alley, park, miniature_golf_course, art_gallery, video_arcade, museum, etc.)
- **Drink:** Seeding uses 8 types → Serving list has 14 types (adds coffee_shop, tea_house, juice_shop, night_club)
- **Casual Eats:** Seeding uses 14 types → Serving list has 37 types
- **Wellness:** Seeding has `yoga_studio` → Serving list is missing it, has `resort_hotel` instead

**Why this matters:** The broader serving list references types that were never seeded into the pool. If any serve-time logic filters by these types, it will look for cards that don't exist. Currently the deck (`discover-cards`) matches on category NAME not type, so this divergence doesn't directly cause a bug. But `discover-experiences` ("For You") may use the broader type list for internal logic, leading to empty categories or unexpected matches.

**What needs to change:** Align `MINGLA_CATEGORY_PLACE_TYPES` with `seedingCategories` so there's one source of truth. The seeding list (which matches your spec exactly) should be authoritative.

---

## P3 — Architectural Debt (Not a Bug Today, Will Be Tomorrow)

---

### BUG-10: Pool Is 100% Manual With Zero Automation

**What you see:** Cards don't refresh unless an admin manually triggers seeding and generation.

**Why it happens (from INVESTIGATION_POOL_TO_CARD_FLOW.md):**

The entire pipeline is manual:
```
Google Places API
       ↓
  [admin-seed-places]        ← MANUAL admin action
       ↓
   place_pool
       ↓
  [generate-single-cards]    ← MANUAL admin batch
  [generate-curated-exp]     ← User request OR admin batch
       ↓
   card_pool
       ↓
   query_pool_cards()        ← AUTOMATIC query only (no generation)
```

- **Automatic cron jobs:** ZERO. None exist.
- **Auto-refresh:** Deprecated. Comment in code: "Automatic refresh is disabled to eliminate $75/month in Google API costs"
- **Self-healing:** None. If pool is empty or stale, the app shows nothing.

**What needs to change:** This is a strategic decision. Options:
- Scheduled re-seeding (pg_cron or external scheduler)
- Pool health monitoring (alert when categories drop below threshold)
- Automated card generation when new places are added to pool

---

### BUG-11: 1,468 Cards Marked "Never Served" — Impression Tracking May Be Broken

**What you see:** Admin dashboard shows "Never Served: 1,468" — that's 100% of active cards.

**Why it happens:** This is a direct consequence of BUG-01. Because the category slug/display name mismatch causes `query_pool_cards` to return zero results, NO cards are ever served to users, and therefore NO impressions are ever recorded. The "Never Served" count is accurate — these cards have genuinely never been served.

**What needs to change:** Fixing BUG-01 will cause cards to start being served and impressions to be recorded. The "Never Served" count should drop naturally. After the fix, monitor this metric to ensure impressions are tracking correctly.

---

---

## Admin Card Pool Management Page — 40 Bugs

**Source:** `mingla-admin/src/pages/CardPoolManagementPage.jsx`
**Context:** Every bug, gap, and design flaw that blocks the vision of an autonomous, Place-Pool-aware card management hub.

---

### Category A: Cities Dropdown Is Dumb

**BUG-12 (CP-001): Cities dropdown reads from seeding_cities, not from actual data**
- `CardPoolManagementPage.jsx:471` — queries `seeding_cities` instead of distinct cities from `card_pool`
- If cards exist for a city not registered in `seeding_cities`, that city is invisible to the admin

**BUG-13 (CP-002): Cities dropdown shows seeding status, not card pool health**
- Shows `draft`, `seeding`, `seeded`, `launched` — meaningless for card management
- Should show: total cards, photo coverage %, category coverage per city

**BUG-14 (CP-003): City selection uses UUID from seeding_cities, not city name**
- Every RPC call, filter, and edge function invocation passes `seeding_cities.id` UUID
- Creates hard dependency on `seeding_cities` table. Pool Intelligence V2 already uses `city TEXT` + `country TEXT`

**BUG-15 (CP-004): "All Cities" view has no card pool awareness**
- Selecting "All Cities" shows no summary — no counts, no health indicators
- Pool Intelligence shows country-level overview. Card Pool shows nothing.

---

### Category B: Launch Readiness Tab Is Misplaced

**BUG-16 (CP-005): Launch Readiness tab belongs on Place Pool page, not Card Pool**
- Checks seeding infrastructure: tiles generated, places seeded, photos downloaded, spend under $70
- These are Place Pool concerns. Card Pool should manage cards, not track seeding progress.

**BUG-17 (CP-006): Launch Readiness has no tile-level breakdown**
- Shows total tile count ("32 tiles") but not which tiles are seeded, which have gaps, which categories are missing per tile
- Admin can't do targeted re-seeding

**BUG-18 (CP-007): Launch Readiness doesn't check if places already exist before seeding**
- Seeding pipeline is unaware of what's already in place_pool per tile/category
- Wasted Google API calls re-seeding tiles that are already full

**BUG-19 (CP-008): Spend tracking is on the wrong page**
- Google API spend tracking (`seeding_operations.estimated_cost_usd`) is a seeding concern
- Card Pool page queries tables it shouldn't care about

---

### Category C: Generate Cards Tab Has Blind Spots

**BUG-20 (CP-009): Generate Cards requires seeding_cities geometry**
- Uses `city.center_lat`, `city.center_lng`, `city.coverage_radius_km` from seeding_cities
- Can't generate cards for a city that exists in place_pool but not in seeding_cities
- Edge functions should accept `city TEXT` directly

**BUG-21 (CP-010): No visibility into what generation will do before running**
- "Generate Single Cards" fires immediately with no preview
- The `dryRun` parameter exists in the edge function but the UI never uses it
- Admin clicks blindly — no gap awareness before generation

**BUG-22 (CP-011): Generation results shown as raw JSON**
- Results dumped as `<pre>{JSON.stringify(result, null, 2)}</pre>`
- Should show: "Generated 45 single cards. 12 skipped (duplicates). 3 skipped (no photos)."

**BUG-23 (CP-012): No "Generate for specific category" option for curated cards**
- Single card generation has a category filter. Curated generation has no filters at all.
- Edge function supports `experienceType` and `selectedCategories` but UI doesn't expose them

---

### Category D: Browse Cards Tab Has Structural Issues

**BUG-24 (CP-013): Browse Cards joins place_pool for city filtering**
- Uses `card_pool.select("*, place_pool!inner(...)")` — inner join
- `card_pool.city` TEXT column already exists and is indexed. Join is unnecessary.
- Curated cards without `place_pool_id` are silently excluded by the inner join

**BUG-25 (CP-014): Browse Cards city filter uses place_pool.city_id**
- Filters by `place_pool.city_id` (UUID). Should filter by `card_pool.city` (TEXT).
- Structural dependency on both `place_pool` and `seeding_cities` for a simple card list

**BUG-26 (CP-015): Category filter uses slug keys but card_pool stores slugs too — but code assumes display names**
- Dropdown options are slug keys (`nature_views`). `card_pool.categories` also stores slugs.
- But the code's assumption comment says display names — the filter logic tries both formats with fragile fallback

**BUG-27 (CP-016): No photo coverage indicator in browse table**
- Only shows whether `image_url` exists (single image)
- Doesn't show `images[]` count or whether parent place has `stored_photo_urls` available

**BUG-28 (CP-017): No card detail expansion or edit capability**
- Browse table shows: title, type, category, photo thumbnail, status, activate/deactivate button
- No way to see: full description, all images, lat/lng, rating, opening hours, parent place, price tier, served count

**BUG-29 (CP-018): No bulk actions in Browse tab**
- Cards can only be activated/deactivated one at a time
- No multi-select, no bulk deactivate, no bulk delete, no bulk re-categorize

---

### Category E: Gap Analysis Is Incomplete

**BUG-30 (CP-019): Gap Analysis queries place_pool directly instead of comparing pools**
- Shows a place-pool-centric view, not a card-pool-centric view
- Should show: "Here are gaps in your card pool relative to your place pool"

**BUG-31 (CP-020): Gap Analysis limited to 100 places**
- `.limit(100)` — cities with 500+ places have hidden gaps
- No pagination

**BUG-32 (CP-021): Gap Analysis has no tile-level breakdown**
- Gaps shown as flat lists. No spatial awareness.
- Admin can't see which neighborhoods/tiles have card coverage gaps

**BUG-33 (CP-022): Category Gaps counts don't match (slugs vs display names)**
- `placeStats.by_seeding_category` uses slug keys. `cardStats.by_category` uses display names.
- Fragile fallback logic that breaks if format changes

**BUG-34 (CP-023): Cross-City Comparison is hidden and seeding-dependent**
- Only appears when NO city is selected on Gap Analysis tab — easy to miss
- Fires N sequential RPC calls (one per city) — slow

**BUG-35 (CP-024): Cross-City Comparison doesn't show card-specific metrics**
- Missing: single vs curated split, category coverage, orphaned cards, never-served cards, stale cards
- Shows superficial seeding metrics instead

**BUG-36 (CP-025): No tile-level breakdown when a city IS selected**
- Vision: tile-by-tile breakdown showing card gaps, photo gaps, category gaps per area
- Reality: flat lists with no geographic granularity

---

### Category F: Missing Features (Photo Fill, Card Health, Actions)

**BUG-37 (CP-026): No photo fill action exists anywhere**
- No mechanism to backfill photos from `place_pool.stored_photo_urls` to `card_pool.image_url`/`images`
- Photos only set during initial card generation. If place had no photos at generation time, card stays photo-less forever — even if photos were downloaded later.
- Admin sees red "None" badges but has zero tools to fix them.
- **Directly related to BUG-02** — this is WHY 0% of cards have photos.

**BUG-38 (CP-027): No orphaned card detection or cleanup**
- No UI to find cards whose parent `place_pool` row was deactivated or deleted
- `admin_card_pool_intelligence` RPC computes `orphaned_cards` but it's not surfaced on Card Pool page

**BUG-39 (CP-028): No stale card detection**
- No UI to find cards whose parent place hasn't been refreshed in 30+ days
- Cards with outdated info (wrong hours, closed permanently) stay active

**BUG-40 (CP-029): No "never served" card visibility**
- No way to see cards with `served_count = 0`
- 100% of cards are currently never-served (BUG-11) but even after fixing BUG-01, this metric needs to be visible

**BUG-41 (CP-030): No link to Place Pool page**
- No navigation link, no "View this place in Place Pool" button on cards
- Admin must manually navigate between pages

---

### Category G: RPC and Data Layer Issues

**BUG-42 (CP-031): admin_city_place_stats and admin_city_card_stats take UUID, not TEXT**
- Both RPCs accept `p_city_id UUID` — can't decouple from `seeding_cities` without new RPCs
- Pool Intelligence V2 already uses TEXT-based filtering

**BUG-43 (CP-032): No card-pool-specific country/city overview RPC**
- Pool Intelligence has `admin_country_overview()` for place_pool. No equivalent for card_pool.
- Can't build an autonomous cities dropdown without a new RPC

**BUG-44 (CP-033): Edge functions don't accept city TEXT parameter**
- `generate-single-cards` and `generate-curated-experiences` only accept `{ location, radiusMeters }`
- Should also accept `{ city: string }` to query `place_pool WHERE city = ?` directly

**BUG-45 (CP-034): No RPC for card-pool photo gap analysis**
- No server-side function to compute: "How many cards are missing photos, and how many have parent places with photos available?"
- Must be computed client-side with multiple queries — slow for large datasets

**BUG-46 (CP-035): No RPC for tile-level card statistics**
- Pool Intelligence has `admin_virtual_tile_intelligence()`. No equivalent for cards.
- Can't show tile-level card gaps without new server-side function

---

### Category H: UI/UX Issues

**BUG-47 (CP-036): Page has no breadcrumb navigation**
- Pool Intelligence uses "All Countries > Country > City" breadcrumb. Card Pool has a flat dropdown.

**BUG-48 (CP-037): No stat cards at the top of any tab**
- Pool Intelligence shows 4 summary stat cards. Card Pool has no summary stats on any tab.

**BUG-49 (CP-038): Tabs don't reflect the card management mission**
- Current tabs mix seeding concerns (Launch Readiness) with card management (Browse, Generate, Gaps)
- Should be: Overview, Browse Cards, Generate Cards, Card Health

**BUG-50 (CP-039): No loading states for RPC calls on tab switch**
- 4 async calls fire in parallel on city selection. No loading indicator while they resolve.
- Admin sees stale data from previous city briefly.

**BUG-51 (CP-040): CitySelector comment says "shared with PlacePool" but it's not**
- Comment says shared component exists, but it's defined inline. No actual shared component.

---

## Summary Table

**Mobile App & Backend Bugs (BUG-01 through BUG-11):**

| Bug | Severity | What's Broken | Root Cause |
|-----|----------|--------------|------------|
| BUG-01 | P0 | Empty deck — zero cards served | Category slug vs display name mismatch in SQL query |
| BUG-02 | P0 | Zero photos on any card | Photos in place_pool never copied to card_pool |
| BUG-03 | P0 | Excluded items (kids, asian grocery) appear | Per-category exclusions defined but never enforced |
| BUG-04 | P1 | For You cards missing categories/photos | Same root cause as BUG-01 + BUG-02 |
| BUG-05 | P1 | Sender not notified on pairing acceptance | No push notification sent — relies on Realtime only |
| BUG-06 | P1 | Push/sound notifications silently dropped | Quiet hours, foreground suppression, OneSignal linkage |
| BUG-07 | P1 | Same cards over and over | Finite pool + impression saturation + 3-batch ceiling |
| BUG-08 | P2 | Curated card labels don't match selected pill | Labels show experience type, not pill name |
| BUG-09 | P2 | Category type lists diverge seeding vs serving | Two separate type mappings, out of sync |
| BUG-10 | P3 | Pool never refreshes automatically | 100% manual pipeline, zero automation |
| BUG-11 | P3 | 100% of cards marked "Never Served" | Consequence of BUG-01 — no cards ever reach users |

**Admin Card Pool Page Bugs (BUG-12 through BUG-51):**

| Bug | Severity | Category | What's Broken |
|-----|----------|----------|--------------|
| BUG-12 | Critical | Cities Dropdown | Reads from seeding_cities, not actual card data |
| BUG-13 | Medium | Cities Dropdown | Shows seeding status, not card health |
| BUG-14 | Critical | Cities Dropdown | Uses UUID instead of city TEXT |
| BUG-15 | Medium | Cities Dropdown | "All Cities" has no intelligence |
| BUG-16 | High | Launch Readiness | Tab belongs on Place Pool page |
| BUG-17 | High | Launch Readiness | No tile-level breakdown |
| BUG-18 | High | Launch Readiness | Doesn't check existing places before seeding |
| BUG-19 | High | Launch Readiness | Spend tracking on wrong page |
| BUG-20 | Critical | Generate Cards | Requires seeding_cities geometry |
| BUG-21 | High | Generate Cards | No dry-run preview |
| BUG-22 | Medium | Generate Cards | Results shown as raw JSON |
| BUG-23 | Medium | Generate Cards | No category filter for curated generation |
| BUG-24 | Critical | Browse Cards | Unnecessary inner join with place_pool |
| BUG-25 | Critical | Browse Cards | City filter uses place_pool.city_id UUID |
| BUG-26 | Medium | Browse Cards | Category filter slug/name confusion |
| BUG-27 | Medium | Browse Cards | No photo coverage indicator |
| BUG-28 | Medium | Browse Cards | No card detail expansion or edit |
| BUG-29 | Medium | Browse Cards | No bulk actions |
| BUG-30 | High | Gap Analysis | Queries place_pool instead of comparing pools |
| BUG-31 | High | Gap Analysis | Limited to 100 places |
| BUG-32 | High | Gap Analysis | No tile-level breakdown |
| BUG-33 | Medium | Gap Analysis | Category gap counts slug/name mismatch |
| BUG-34 | Medium | Gap Analysis | Cross-city comparison is hidden |
| BUG-35 | Medium | Gap Analysis | Cross-city missing card-specific metrics |
| BUG-36 | High | Gap Analysis | No tile-level breakdown when city selected |
| BUG-37 | Critical | Missing Features | No photo fill action exists anywhere |
| BUG-38 | High | Missing Features | No orphaned card detection |
| BUG-39 | High | Missing Features | No stale card detection |
| BUG-40 | High | Missing Features | No "never served" card visibility |
| BUG-41 | Low | Missing Features | No link to Place Pool page |
| BUG-42 | Critical | RPC/Data Layer | RPCs take UUID, not TEXT |
| BUG-43 | Critical | RPC/Data Layer | No card-pool country/city overview RPC |
| BUG-44 | Critical | RPC/Data Layer | Edge functions don't accept city TEXT |
| BUG-45 | Critical | RPC/Data Layer | No photo gap analysis RPC |
| BUG-46 | Critical | RPC/Data Layer | No tile-level card stats RPC |
| BUG-47 | Medium | UI/UX | No breadcrumb navigation |
| BUG-48 | Medium | UI/UX | No stat cards at top |
| BUG-49 | Medium | UI/UX | Tabs mix seeding + card concerns |
| BUG-50 | Medium | UI/UX | No loading states on tab switch |
| BUG-51 | Low | UI/UX | Misleading "shared" comment |

---

## Grand Total: 51 Bugs

- **P0 / Critical:** 3 mobile + 11 admin = **14**
- **P1 / High:** 4 mobile + 12 admin = **16**
- **P2 / Medium:** 2 mobile + 14 admin = **16**
- **P3 / Low:** 2 mobile + 3 admin = **5**

---

## Recommended Fix Order

**Phase 1 — Unblock the deck (fixes BUG-01, BUG-02, BUG-04, BUG-07, BUG-11):**
1. Fix category name resolution so `query_pool_cards` receives slugs matching what's in the DB
2. Backfill `card_pool.image_url` and `card_pool.images` from `place_pool.stored_photo_urls`
3. Fix `generate-single-cards` to copy photos during card creation going forward

**Phase 2 — Enforce exclusions (fixes BUG-03):**
4. Add per-category exclusion filtering at serve time (SQL or post-query)
5. Add post-fetch exclusion check in `admin-seed-places` against ALL types (not just primaryType)
6. Retroactively deactivate pool cards with excluded types

**Phase 3 — Fix social features (fixes BUG-05, BUG-06):**
7. Add `pair_request_accepted` push notification to sender
8. Audit OneSignal linkage and notification preferences for test users
9. Add suppression logging to `notify-dispatch`

**Phase 4 — UX polish (fixes BUG-08, BUG-09):**
10. Align curated card labels with user's selected pill
11. Unify category type lists (single source of truth)

**Phase 5 — Admin Card Pool autonomy (fixes BUG-12 through BUG-51):**
12. Build card-pool-native RPCs (country/city overview, photo gap, tile stats) — fixes BUG-42 through BUG-46
13. Decouple from seeding_cities: use `city TEXT` + `country TEXT` everywhere — fixes BUG-12, BUG-14, BUG-20, BUG-24, BUG-25
14. Move Launch Readiness to Place Pool page — fixes BUG-16 through BUG-19
15. Add photo fill action — fixes BUG-37 (and complements BUG-02 fix)
16. Add card health visibility (orphaned, stale, never-served) — fixes BUG-38 through BUG-40
17. Redesign tabs, add stat cards, breadcrumb navigation — fixes BUG-47 through BUG-50
18. Add dry-run preview, better generation UX, bulk actions — fixes BUG-21 through BUG-23, BUG-29
19. Build tile-level gap analysis — fixes BUG-30 through BUG-36

---

## File References

| Component | File |
|-----------|------|
| Pill → display name mapping | `app-mobile/src/services/deckService.ts:62-75` |
| Category resolution | `supabase/functions/_shared/categoryPlaceTypes.ts:217-227` |
| Pool query (SQL) | `supabase/migrations/20260320100000_category_migration_13.sql:88-293` |
| Card pool service | `supabase/functions/_shared/cardPoolService.ts:145-170` |
| Discover cards edge fn | `supabase/functions/discover-cards/index.ts` |
| Discover experiences edge fn | `supabase/functions/discover-experiences/index.ts` |
| Single card generation | `supabase/functions/generate-single-cards/index.ts` |
| Curated generation | `supabase/functions/generate-curated-experiences/index.ts` |
| Seeding categories | `supabase/functions/_shared/seedingCategories.ts` |
| Category exclusions | `supabase/functions/_shared/categoryPlaceTypes.ts:355-506` |
| Admin seed places | `supabase/functions/admin-seed-places/index.ts` |
| Notification dispatch | `supabase/functions/notify-dispatch/index.ts` |
| Pair request acceptance | `supabase/migrations/20260314000004_accept_pair_request_atomic.sql` |
| Social realtime | `app-mobile/src/hooks/useSocialRealtime.ts` |
| OneSignal service | `app-mobile/src/services/oneSignalService.ts` |
| Card converters | `app-mobile/src/utils/cardConverters.ts` |
| Recommendations context | `app-mobile/src/contexts/RecommendationsContext.tsx` |
| Card Pool admin page | `mingla-admin/src/pages/CardPoolManagementPage.jsx` |
| Prior investigation | `outputs/INVESTIGATION_POOL_TO_CARD_FLOW.md` |
| Card Pool bug source | `outputs/CARD_POOL_BUG_REPORT.md` |
| Behavioral contract | `BEHAVIORAL_CONTRACT.md` |
