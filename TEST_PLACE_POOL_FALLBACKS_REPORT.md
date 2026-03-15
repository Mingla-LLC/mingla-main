# Test Report: Place Pool Fallbacks (discover-experiences + get-person-hero-cards)
**Date:** 2026-03-15
**Tester:** Brutal Tester Skill
**Verdict:** CONDITIONAL PASS

---

## Executive Summary

Two place_pool fallback implementations were reviewed: one in `discover-experiences/index.ts` (Discover grid) and one in `get-person-hero-cards/index.ts` (paired person cards). Both follow the same pattern as the previously-reviewed `discover-cards` fallback and are well-structured. The core query logic (geo bounding box + types overlap + rating sort) is correct and consistent across all three endpoints. However, `discover-experiences` has **two omissions** (no impression recording, no daily cache write) that undermine the "one query eliminates all Google calls for the rest of the day" claim, and `get-person-hero-cards` has an **env var name mismatch** that may produce broken image URLs.

---

## Test Manifest

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| Logic Correctness | 6 | 5 | 1 | 0 |
| Data Consistency | 4 | 2 | 2 | 0 |
| Security | 2 | 2 | 0 | 0 |
| Performance | 3 | 1 | 0 | 2 |
| Pattern Compliance | 4 | 3 | 0 | 1 |
| **TOTAL** | **19** | **13** | **3** | **3** |

---

## HIGH-001: discover-experiences — No Impression Recording for Place Pool Fallback

**File:** `supabase/functions/discover-experiences/index.ts` (lines 628-770)
**Category:** Data Consistency
**Severity:** HIGH

**What's Wrong:**

The card_pool path (line 562-567) records impressions via `recordImpressions(adminClient, userId, servedPoolCardIds)`. The place_pool fallback does NOT record impressions at all. This means:

1. The impression-based freshness system won't know these cards were shown
2. The next request (before card_pool takes over) will serve the exact same places again
3. The card_pool path's "session-scoped filtering" (line 365-372) won't filter these out since no impression exists

The `insertCardToPool` fire-and-forget (line 714-735) should seed card_pool for future requests, so the second request should use the card_pool path which DOES record impressions. But if that insert fails silently, the place_pool fallback will serve the same cards indefinitely without any rotation.

**Evidence:**
```typescript
// Card_pool path (line 562-567) — records impressions:
if (servedPoolCardIds.length > 0) {
  recordImpressions(adminClient, userId, servedPoolCardIds).catch(() => {});
}

// Place_pool fallback (lines 628-770) — NO recordImpressions call
```

**Required Fix:**
After building `ppHeroCards` and `ppGridCards`, record impressions for the served cards. The card IDs here are google_place_ids, so you'll need to use the card_pool IDs from the `insertCardToPool` results, or record impressions after the card_pool inserts complete. Simplest approach:

```typescript
// After the insertCardToPool calls, collect the card_pool IDs and record:
if (userId) {
  const ppAllCardIds = [...ppHeroCards, ...ppGridCards].map(c => c.id);
  // These are google_place_ids, which is what recordImpressions expects as card identifiers
  recordImpressions(adminClient, userId, ppAllCardIds).catch(() => {});
}
```

**Why This Matters:**
Without impression tracking, the Discover page will show identical cards every time the place_pool fallback fires, breaking the rotation/freshness system.

---

## HIGH-002: discover-experiences — No Daily Cache Write for Place Pool Fallback

**File:** `supabase/functions/discover-experiences/index.ts` (lines 628-770)
**Category:** Data Consistency / Performance
**Severity:** HIGH

**What's Wrong:**

The card_pool path (lines 570-595) writes to `discover_daily_cache`, which the mobile client checks before calling the edge function. The place_pool fallback returns a response but does NOT write to `discover_daily_cache`. This means:

1. The mobile client's 24-hour cache is not populated
2. The next app open within 24 hours will hit the edge function again instead of using the cached response
3. The implementor's claim "this one fast query eliminates all Google calls for the rest of the day" is only partially true — it eliminates Google calls, but the edge function is still called repeatedly

On the second call, the `insertCardToPool` from the first call should have seeded card_pool, so the card_pool path takes over and writes the daily cache. So this is a first-request-only issue. But it's still an unnecessary extra round trip.

**Evidence:**
```typescript
// Card_pool path (line 570-595) — writes daily cache:
adminClient.from("discover_daily_cache").delete()...then(() =>
  adminClient.from("discover_daily_cache").insert({...})
)

// Place_pool fallback (lines 740-764) — returns response, NO cache write
return new Response(JSON.stringify({...}));
```

**Required Fix:**
Add the same daily cache write pattern after building the response, before returning. Copy the pattern from lines 570-595 using `ppHeroCards`, `ppGridCards`, `ppFeaturedCard`, and `ppExpiresAt`.

---

## HIGH-003: get-person-hero-cards — Env Var Name Mismatch for API Key

**File:** `supabase/functions/get-person-hero-cards/index.ts` (line 459)
**Category:** Configuration / Broken Images
**Severity:** HIGH (confirmed inconsistency, impact depends on env config)

**What's Wrong:**

The place_pool fallback reads the API key as `Deno.env.get("GOOGLE_PLACES_API_KEY")`. But the other endpoints use a different env var name:

| Endpoint | Env Var Read | Constant Name |
|----------|-------------|---------------|
| discover-cards (line 46) | `GOOGLE_MAPS_API_KEY` | `GOOGLE_PLACES_API_KEY` |
| discover-experiences (line 24) | `GOOGLE_MAPS_API_KEY` | `GOOGLE_API_KEY` |
| get-person-hero-cards (line 459) | `GOOGLE_PLACES_API_KEY` | *(inline)* |

If only `GOOGLE_MAPS_API_KEY` is set in the Supabase env config (which is the name used by both other endpoints), then `Deno.env.get("GOOGLE_PLACES_API_KEY")` returns `undefined`, producing image URLs like:
```
https://places.googleapis.com/v1/.../media?maxWidthPx=800&key=
```
These will return 403 from Google, resulting in **broken images for all place_pool fallback cards** in paired person views.

Note: The pre-existing gap-fill code at line 353 has the same issue (`GOOGLE_PLACES_API_KEY`). If gap-fill works in production, then both env vars are set and this is a non-issue. But the inconsistency is still a maintenance risk.

**Required Fix:**
Read the API key once at the top of the file using the canonical env var name:
```typescript
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
```
Then use `GOOGLE_API_KEY` everywhere instead of inline `Deno.env.get()` calls.

---

## MED-001: discover-experiences — Sequential Category Queries Instead of Parallel

**File:** `supabase/functions/discover-experiences/index.ts` (line 639)
**Category:** Performance
**Severity:** MEDIUM

**What's Wrong:**

The place_pool fallback uses a `for...of` loop (sequential) to query place_pool per category. With 12 categories, this means 12 sequential DB queries. The card_pool path at line 335 uses `Promise.all()` (parallel) for the same pattern.

Each query takes ~20-50ms to Supabase. Sequential: 12 x 30ms = 360ms. Parallel: ~30ms total. For a fallback designed to be fast (<1s), this adds unnecessary latency.

**Required Fix:**
Replace the `for...of` loop with `Promise.all(categoriesToFetch.map(async (category) => {...}))`, same as the card_pool path. The `break` after one place per category can be replaced with returning after the first match.

---

## MED-002: get-person-hero-cards — Deno.env.get() Called Inside Loop

**File:** `supabase/functions/get-person-hero-cards/index.ts` (line 459)
**Category:** Performance / Code Quality
**Severity:** MEDIUM (low functional impact)

**What's Wrong:**

`Deno.env.get("GOOGLE_PLACES_API_KEY")` is called inside the inner `for` loop, once per place. The value never changes during execution. It should be read once outside the loop.

**Required Fix:**
Move the env var read before the loop:
```typescript
const googleApiKey = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
```
Then use `googleApiKey` in the URL template.

---

## MED-003: get-person-hero-cards — Dynamic Imports in Hot Path

**File:** `supabase/functions/get-person-hero-cards/index.ts` (lines 417-418)
**Category:** Performance
**Severity:** MEDIUM

**What's Wrong:**

```typescript
const { getPlaceTypesForCategory } = await import("../_shared/categoryPlaceTypes.ts");
const { insertCardToPool } = await import("../_shared/cardPoolService.ts");
```

These dynamic imports add ~10-50ms of overhead every time the fallback runs. `resolveCategories` is already statically imported from `categoryPlaceTypes.ts` (line 3), so `getPlaceTypesForCategory` could be added to that static import. `insertCardToPool` would need a new static import.

**Required Fix:**
Add to the static imports at the top of the file:
```typescript
import { resolveCategories, getPlaceTypesForCategory } from "../_shared/categoryPlaceTypes.ts";
import { insertCardToPool } from "../_shared/cardPoolService.ts";
```
Remove the dynamic imports at lines 417-418.

---

## What Passed

### Things Done Right

1. **Correct geo bounding box math.** Both files use `radius / 111320` for lat delta and `radius / (111320 * cos(lat * PI / 180))` for lng delta. This is the standard approximation and matches discover-cards exactly.

2. **Deduplication is thorough.** discover-experiences uses `ppServedPlaceIds` Set. get-person-hero-cards tracks both `existingIds` and `existingGpids` to prevent duplicates against cards already served from card_pool/gap-fill. The final dedup safety net at line 526-533 is an additional guard.

3. **Card interface compliance.** get-person-hero-cards builds `Card` objects that match the `Card` interface exactly (all 22 fields populated). discover-experiences builds cards matching the same shape as `poolRowToApiCard`. No missing fields that would cause mobile crashes.

4. **Fire-and-forget `insertCardToPool` pattern.** Both files insert into card_pool with `.catch(() => {})`, ensuring the fallback doesn't fail if the insert fails. Future requests will find these cards in card_pool and skip both place_pool and Google entirely.

5. **Early termination.** get-person-hero-cards breaks out of loops when `ppCards.length >= needed`, avoiding unnecessary queries once the gap is filled.

6. **Graceful error handling.** Both fallbacks are wrapped in try/catch with `console.warn` — failures are non-fatal and the code falls through to Google API as the last resort.

7. **Hero/grid separation in discover-experiences.** The place_pool fallback correctly separates hero cards (max 2 from HERO_CATEGORIES_RESOLVED) from grid cards, matching the card_pool path's behavior.

---

## Implementation Claim Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| "discover-experiences: queries place_pool per category using types overlap" | Yes | Yes | `.overlaps('types', placeTypes)` at line 651 |
| "builds hero + grid cards" | Yes | Yes | Hero/grid split at lines 707-711 |
| "inserts them into card_pool for future requests" | Yes | Yes | `insertCardToPool` at line 715, fire-and-forget |
| "Discover grid caches for 24 hours" | Yes | PARTIAL | Response includes `expiresAt` (24h), but NO `discover_daily_cache` write (HIGH-002) |
| "eliminates all Google calls for the rest of the day" | Yes | PARTIAL | Eliminates Google calls, but edge function is still called each time until card_pool is populated |
| "get-person-hero-cards: queries place_pool within 50km" | Yes | Yes | `ppRadiusMeters = 50000` at line 420 |
| "builds Card objects matching the exact interface" | Yes | Yes | All 22 Card interface fields populated |
| "inserts them into card_pool" | Yes | Yes | `insertCardToPool` at line 490, fire-and-forget |
| "could eliminate Google calls indefinitely" | Yes | Yes | Once in card_pool, RPC serves them. Cards persist until shuffled |

---

## Recommendations

### Must Fix Before Merge
1. **HIGH-003**: Fix env var name in get-person-hero-cards — use `GOOGLE_MAPS_API_KEY` consistently (or verify both are set in Supabase config)

### Strongly Recommended
2. **HIGH-001**: Add `recordImpressions` call to discover-experiences place_pool fallback
3. **HIGH-002**: Add `discover_daily_cache` write to discover-experiences place_pool fallback

### Should Fix Soon
4. **MED-001**: Parallelize category queries in discover-experiences fallback (Promise.all)
5. **MED-003**: Convert dynamic imports to static imports in get-person-hero-cards
6. **MED-002**: Move Deno.env.get() outside the loop in get-person-hero-cards

---

## Verdict Justification

**CONDITIONAL PASS** — The core place_pool query logic is correct and the pattern is consistent across all three endpoints. Both fallbacks will successfully serve cards without Google API calls, and both seed card_pool for future requests. However:

- **HIGH-003** (env var mismatch) could cause broken images in production if only `GOOGLE_MAPS_API_KEY` is configured — this needs a quick verification or fix before merge.
- **HIGH-001 + HIGH-002** (missing impressions + cache) mean the discover-experiences fallback works but doesn't fully integrate with the existing freshness/caching infrastructure. The second request will work perfectly (card_pool takes over), so this is a first-request-only degradation, not a functional failure.

If `GOOGLE_PLACES_API_KEY` is confirmed to be set in Supabase env config, HIGH-003 drops to MEDIUM and this can merge with the understanding that HIGH-001 and HIGH-002 are fast follow-ups.
