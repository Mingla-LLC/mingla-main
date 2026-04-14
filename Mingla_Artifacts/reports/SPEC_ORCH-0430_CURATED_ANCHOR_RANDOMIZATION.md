# Spec: Curated Experience Anchor Randomization (ORCH-0430)

**Date:** 2026-04-14
**Investigation:** In-conversation forensic trace, HIGH confidence

---

## Layman Summary

Every time you ask for a picnic date (or any curated experience), you get the same venues
because the system always picks the highest-rated place first. The fix: shuffle the top
results before picking, so you get different quality venues each time. The `shuffle()`
function already exists in the file — we just need to use it.

---

## Scope

**IN:**
- Shuffle fetched places in `fetchSinglesForCategory` before returning
- Keep quality floor (only shuffle within top results, not random junk)
- Benefits all 6 curated experience types, not just picnic

**OUT:**
- Pre-building more curated cards in card_pool (separate operational task)
- Changes to pool-serving logic (impression tracking handles that)
- Mobile app changes
- Admin UI changes

---

## Success Criteria

| # | Criterion | How to Verify |
|---|-----------|--------------|
| SC-1 | Two consecutive requests for same experience type + location return different anchor venues | Call generate-curated-experiences twice, compare anchor place IDs |
| SC-2 | Returned venues are still quality (rating 4.0+ dominant) | Check ratings of returned stops across 10 requests |
| SC-3 | All 6 experience types benefit | Test picnic-dates, adventurous, first-date — all show variety |
| SC-4 | Proximity constraints for non-anchor stops still respected | Grocery stores still within 3km of picnic park |
| SC-5 | No regression — existing pool-served curated cards unaffected | Pool serving path doesn't use fetchSinglesForCategory |
| SC-6 | Non-anchor first-main-stop also varies | Standard experience types (non-reverse-anchor) show variety too |

---

## Edge Function Changes

### File: `supabase/functions/generate-curated-experiences/index.ts`

### Change 1: Shuffle results in `fetchSinglesForCategory` (lines 279-306)

The function currently returns results sorted by `rating DESC` — deterministic. Add a
weighted shuffle that keeps high-rated places near the top but with randomness.

**Strategy: Shuffle the top N, keep the quality floor.**

The DB query already filters by location (bounding box) and limits to 50. These are all
quality-filtered, location-relevant places. We don't need to protect against junk — the
query already does that. Simply shuffling the returned results gives variety while
maintaining the quality floor (all results have images and are within radius).

Replace the return statement (lines 302-305):

```typescript
  if (error || !data) return [];

  // Only keep cards with images (should always be true, but safety net)
  const filtered = data.filter((card: any) => card.images?.length > 0 || card.image_url);
  // Shuffle to ensure variety across requests (all results are quality-filtered by DB query)
  return shuffle(filtered);
```

**Why this works:**
- The DB query already sorts by rating DESC and limits to 50 — these are the best 50
  places in the area. All are quality.
- Shuffling means `anchorPlaces[0]` picks a random good park, not always THE best park.
- Each request gets a different shuffle seed → different anchor → different experience.
- The `globalUsedPlaceIds` dedup within a request still prevents duplicates in a single batch.

### Change 2: No change needed to anchor selection (line 513)

`const anchor = anchorPlaces[0]` is fine — it picks the first element of a shuffled array,
which is now random. No code change needed here.

### Change 3: No change needed to first-main-stop selection (line 593)

`available[0]` picks the first of the shuffled array — now random. No change needed.

### Change 4: No change needed to `selectClosestHighestRated` (line 714)

This function selects the closest place for non-first stops. It's proximity-based, which
is correct for chaining stops. The shuffle doesn't affect this — by the time we're picking
stop 2+, we want the closest to stop 1. Leave unchanged.

---

## What This Changes Per Selection Point

| Selection Point | Before | After |
|----------------|--------|-------|
| Anchor (reverse-anchor, line 513) | Always top-rated park | Random quality park |
| First main stop (standard, line 593) | Always top-rated venue | Random quality venue |
| Non-anchor near-anchor stops (line 551) | Closest to anchor | Closest to anchor (unchanged — proximity matters) |
| Subsequent stops (standard, line 594) | Closest to previous | Closest to previous (unchanged — proximity matters) |

The key insight: **only the FIRST pick in each chain needs randomization.** Subsequent
stops should still be proximity-chained (closest to previous stop) because travel time
matters for a multi-stop date. The shuffle of the source array handles this naturally —
`selectClosestHighestRated` works on a shuffled input, so it picks the closest from a
random subset, which still gives some variety.

---

## SQL Cleanup

None needed. This is a generation-time fix, not a data fix.

---

## Implementation Order

1. Read `fetchSinglesForCategory` (lines 279-306)
2. Replace the return (lines 302-305) with shuffled version
3. Verify `shuffle` function is available in scope (it is — line 677)
4. Deploy edge function
5. Test by requesting picnic-dates twice from same location

**That's it. One function, one change, two lines.**

---

## Test Cases

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| T-01 | Picnic variety | 2 requests, same location, picnic-dates | Different anchor parks (high probability) |
| T-02 | First-date variety | 2 requests, same location, first-date | Different first stops |
| T-03 | Quality maintained | 10 requests, check ratings | Average rating ≥ 4.0 across all anchors |
| T-04 | Proximity still works | Picnic date stops | Grocery within 3km of park |
| T-05 | Pool serving unaffected | Request when pool has enough cards | Serves from pool, not generated |
| T-06 | Single request dedup | Request limit=5 | 5 different anchor parks within batch |
| T-07 | Small pool graceful | Area with only 3 parks | Returns 3 cards without error |

---

## Regression Prevention

1. **The shuffle is on the returned array, not the DB query.** The DB still fetches the
   best 50 by rating — shuffle happens after. If shuffle is ever removed, behavior
   reverts to deterministic (safe degradation).
2. **All existing filters preserved.** Bounding box, is_active, card_type, categories,
   image filter — all still applied before shuffle.
3. **`globalUsedPlaceIds` dedup within request still works.** Shuffle doesn't affect
   the dedup set — it just changes which place is tried first.

---

## Handoff to Implementor

1. One file: `supabase/functions/generate-curated-experiences/index.ts`
2. One change: lines 302-305, replace return with shuffled version
3. `shuffle()` already exists at line 677 — just use it
4. Do NOT change anchor selection logic, stop selection logic, or proximity chaining
5. Do NOT touch card_pool serving, mobile app, or admin UI
