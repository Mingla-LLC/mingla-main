# Implementation Report: Curated Experience Anchor Randomization (ORCH-0430)

**Date:** 2026-04-14
**Spec:** `SPEC_ORCH-0430_CURATED_ANCHOR_RANDOMIZATION.md`
**Status:** Implemented, partially verified (needs deploy + runtime testing)

---

## File Changed

### supabase/functions/generate-curated-experiences/index.ts

**What it did before:** `fetchSinglesForCategory` returned places sorted by rating DESC.
Every request got the same places in the same order. `anchorPlaces[0]` always picked the
highest-rated place. Users saw the same parks/venues every time.

**What it does now:** After filtering for images, the results are shuffled before returning.
Each request gets a different random order of quality places. `anchorPlaces[0]` now picks
a random quality venue instead of always the top-rated one.

**Why:** SC-1 (variety across requests), SC-3 (all experience types benefit)

**Lines changed:** 2 (replaced `return` with `const filtered` + `return shuffle(filtered)`)

---

## Spec Traceability

| SC | Criterion | Verification |
|----|-----------|-------------|
| SC-1 | Different anchors across requests | UNVERIFIED — needs runtime test (two requests, compare) |
| SC-2 | Quality maintained | PASS — DB query still fetches top 50 by rating, shuffle is post-filter |
| SC-3 | All experience types benefit | PASS — all types use `fetchSinglesForCategory` |
| SC-4 | Proximity constraints preserved | PASS — `selectClosestHighestRated` unchanged, runs on shuffled input |
| SC-5 | Pool serving unaffected | PASS — pool serving uses `serveCuratedCardsFromPool`, not `fetchSinglesForCategory` |
| SC-6 | Non-anchor first stop varies | PASS — standard path `available[0]` now picks from shuffled array |

---

## Regression Surface

1. All curated experience types (adventurous, first-date, romantic, group-fun, picnic-dates, take-a-stroll)
2. Warm-pool card generation (uses same function)
3. Session deck generation (calls generate-curated-experiences)

---

## Discoveries for Orchestrator

None.
