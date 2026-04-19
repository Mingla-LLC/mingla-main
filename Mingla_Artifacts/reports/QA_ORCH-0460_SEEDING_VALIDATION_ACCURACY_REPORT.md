# QA Report: ORCH-0460 — Place Pipeline Accuracy Overhaul

**Tester:** mingla-tester
**Date:** 2026-04-17
**Mode:** TARGETED (orchestrator-dispatched)
**Spec:** `Mingla_Artifacts/specs/AUDIT_SEEDING_AND_VALIDATION_ACCURACY.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0460_SEEDING_VALIDATION_ACCURACY_REPORT.md`
**Tester prompt:** `Mingla_Artifacts/prompts/TEST_ORCH-0460_SEEDING_VALIDATION_ACCURACY.md`

---

## VERDICT: **FAIL** — Rework required

- **P0:** 1 (critical regression — flowers stripping kills 168 legitimate supermarkets)
- **P1:** 2 (live GPT unverified, invariant #13 violation)
- **P2:** 1 (TopGolf edge case inconsistency)
- **P3:** 0
- **P4:** 2 (praise for shared constant pattern, tight real-restaurant guard)

**Blocking issue:** The new types-array check on `FLOWERS_BLOCKED_TYPES` will strip the `flowers` category from **168 out of 180 places** currently having flowers — and **168 of those 168 are legitimate supermarkets** (Whole Foods, Trader Joe's, Carrefour, Waitrose, Safeway, Publix) that the GPT prompt **explicitly names as the canonical "keep flowers" examples**. Only 1 actual garden store in the strip list.

**Net effect on the Flowers category:** A 93% data loss to the wrong targets. The fix's intent is inverted in practice.

**This cannot ship.** Rework required before re-dispatch.

---

## Phase-by-Phase Results

### Phase 1 — Syntax & Integrity: **PASS (4/4)**

| Test | Result | Evidence |
|------|--------|----------|
| T-1.1 AST parse all 3 files | PASS | seedingCategories.ts 565 lines, categoryPlaceTypes.ts 641 lines, ai-verify-pipeline/index.ts 1631 lines. No syntax errors. |
| T-1.2 Zero enforceExclusivity live refs | PASS | Only 1 reference remains — a deletion comment on line 241 |
| T-1.3 All 14 configs under 50-type limit | PASS | Max count = 50 (casual_eats_world, at cap). Min = 1 (watch). Total configs = 14. |
| T-1.4 All 5 stripping blocks present in deterministicFilter | PASS | creative_arts (line 641), movies_theatre (650), brunch_lunch_casual (660), play (675), flowers (688), plus flowers-delivery (708). |

### Phase 2 — Deterministic Filter Unit Tests: **PASS (25/26)**

Built a standalone Node.js harness (`tmp/test-deterministic-filter.mjs`) that transpiles the deterministic filter and its constants from the actual source file, then runs 26 fixtures.

**Results summary:**

| Category | Fixtures | Pass | Fail |
|----------|----------|------|------|
| Creative & Arts stripping | 3 | 3 | 0 |
| Movies & Theatre stripping | 3 | 3 | 0 |
| Brunch, Lunch & Casual stripping | 4 | 4 | 0 |
| Play stripping | 4 | 3 | 1 (T-2.14 TopGolf edge) |
| Flowers stripping (garden stores) | 4 | 4 | 0 |
| Upscale promotion | 2 | 2 | 0 |
| Upscale chain protection | 2 | 2 | 0 |
| New keyword groups | 4 | 4 | 0 |
| **Total** | **26** | **25** | **1** |

**Analysis of T-2.14 (TopGolf):** The test expected `verdict: "pass"` (TopGolf keeps both `play` + `brunch_lunch_casual`). Actual: brunch_lunch_casual stripped because input had `primary_type: amusement_center` + `amusement_center` in types array. The code IS CORRECT per the user's explicit decision ("A bowling alley with a restaurant is play, NOT brunch_lunch_casual"). My test expectation was optimistic. However, this surfaces a P2 inconsistency with GPT prompt Example 2 which shows TopGolf getting both categories with `type:restaurant`. If Google actually returns `primary_type:amusement_center` for TopGolf, GPT (following Example 2's pattern) would assign both, then re-validation would strip brunch. This creates non-idempotent behavior depending on when classification happens.

**Verdict:** PASS. The 1 variance is explainable and does not block.

### Phase 3 — GPT Classification Smoke: **STATIC PASS (15/15) — LIVE UNVERIFIED**

Live GPT calls not executable in this environment (no OpenAI API key accessible; orchestrator forbids deploying the updated edge function to test live). Pivoted to static SYSTEM_PROMPT verification.

**Static checks:**

| Test | Result | Evidence |
|------|--------|----------|
| T-3.1 Mutual exclusivity removed | PASS | "MUTUALLY EXCLUSIVE" / "never upscale_fine_dining + brunch_lunch_casual" not in prompt |
| T-3.2 Dual-category guidance present | PASS | "A restaurant can qualify for BOTH upscale_fine_dining AND brunch_lunch_casual" |
| T-3.3 Brunch rejects food trucks/halls/tobacco | PASS | "NO food trucks", "NO food courts", "NO market stalls or food halls", "hookah lounge" all present |
| T-3.4 Upscale accepts tapas/bistros/wine bars | PASS | "High-end tapas bars, acclaimed bistros", "lavish", "bougie" all present |
| T-3.5 Creative Arts excludes food/drink | PASS | "A restaurant, bar, cafe, wine bar, or store is NEVER creative_arts" |
| T-3.6 Movies & Theatre rejects bars-with-music | PASS | "A bar that hosts live music on weekends is drinks_and_music", "DEDICATED performing arts venues" |
| T-3.7 Play rejects sports/farms/community | PASS | "NO sports parks or recreation centers", "NO farms or seasonal", "NO community centers" |
| T-3.8 Community center reject example | PASS | Example 17 "Riverside Community Center" |
| T-3.9 Phillips Farms reject example | PASS | Example 18 present |
| T-3.10 Bethesda Park reject example | PASS | Example 19 present |
| T-3.11 Nobu dual-category example | PASS | Example 23 with both categories |
| T-3.12 Le Bernardin upscale-only example | PASS | Example 24 present |
| T-3.13 Wine Gallery drinks-only example | PASS | Example 21 present |
| T-3.14 24 total worked examples | PASS | Confirmed via grep count |
| T-3.15 All 10 category definitions | PASS | All 10 slugs covered |

**P1 FINDING:** Live GPT behavior is NOT verified. The prompt text is correct, but we have not confirmed GPT actually follows the new guidance at runtime. This is a runtime verification gap. Before deploying to production, the test city should be used to run a small batch of places through the live pipeline and inspect GPT's actual responses.

### Phase 4 — Pool Re-Validation Diagnostic: **CRITICAL FAIL (P0)**

Ran predictive SQL queries against `place_pool` to forecast what the new deterministic filter will do to existing `ai_approved=true` places when it's deployed and re-validation runs.

**Total approved places in pool:** 41,727

**Predicted impact per bucket:**

| Category Strip | Places Affected | % of Pool |
|----------------|-----------------|-----------|
| Creative & Arts | 70 | 0.17% |
| Movies & Theatre | 140 | 0.34% |
| Brunch, Lunch & Casual | 975 | 2.34% |
| Play | 295 | 0.71% |
| **Flowers** | **180** | **0.43%** |
| **TOTAL** | **~1,660** | **~3.98%** |

### The P0 Finding: Flowers bucket is semantically WRONG

Spot-checked the 180 places that would lose `flowers`. Top results:

```
Whole Foods Market         (grocery_store, flowers+groceries)  ← GPT CANONICAL EXAMPLE
Trader Joe's (x3)          (grocery_store, flowers+groceries)
Waitrose & Partners (x2)   (supermarket,   flowers+groceries)
Safeway                    (grocery_store, has `florist` in types!, flowers+groceries)
Carrefour Market (x6)      (supermarket,   flowers+groceries)
```

**All of these have `food_store` in their Google types array. `food_store` is in `FLOWERS_BLOCKED_TYPES`. The new types-array check will strip flowers from every major supermarket in the pool.**

**Quantified damage:**

```
legit_supermarkets_that_will_lose_flowers: 168
actual_garden_stores_caught:                 1
total_flowers_to_strip:                    180
```

**168 out of 180 (93%) are false positives.** The fix's intent was to remove garden stores leaking into Flowers. Instead, it removes the exact supermarkets that the GPT prompt explicitly says should have BOTH flowers and groceries.

Meanwhile, actual garden stores (Home Depot garden sections, local nurseries, etc.) rarely get `flowers` in their `ai_categories` to begin with because their `primary_type` is usually `garden_center` or `home_improvement_store` — types that never resulted in flowers-assignment in the first place. So the change has near-zero effect on its intended target.

**Root cause of the P0:**

The original `FLOWERS_BLOCKED_TYPES` Set was designed for `primary_type` matching. `food_store` was in that list because when a place's **primary** type is `food_store`, it's usually a specialty food shop (not a supermarket with florals).

When ORCH-0460 expanded the check to the full `types` array (line 689-690 of ai-verify-pipeline/index.ts), the `food_store` entry started matching every supermarket. Google's Place Type taxonomy uses `food_store` as a generic parent type that accompanies `grocery_store`, `supermarket`, `hypermarket`, etc.

```
// Current code in ai-verify-pipeline/index.ts:107-112
const FLOWERS_BLOCKED_TYPES = new Set([
  "garden_center", "garden", "farm", "supplier", "cemetery", "funeral_home",
  "restaurant", "meal_takeaway", "bar", "food_store",  ← "food_store" is the problem
]);
// Line 689-690: check against types array:
const hasBlockedFlowerType = FLOWERS_BLOCKED_TYPES.has(primaryType)
  || typesArray.some((t: string) => FLOWERS_BLOCKED_TYPES.has(t));  ← types-array check fires for every supermarket
```

**Recommended fix (orchestrator-gated):**

Split `FLOWERS_BLOCKED_TYPES` into two sets — one for `primary_type` checks (broad, including `food_store`) and one for `types`-array checks (tight, excluding `food_store`):

```typescript
// For primary_type check (keeps current broad behavior)
const FLOWERS_BLOCKED_PRIMARY_TYPES = new Set([
  "garden_center", "garden", "farm", "supplier", "cemetery", "funeral_home",
  "restaurant", "meal_takeaway", "bar", "food_store",
]);

// For types-array check (tighter — only types that NEVER appear on legitimate supermarkets)
const FLOWERS_BLOCKED_SECONDARY_TYPES = new Set([
  "garden_center", "farm", "cemetery", "funeral_home",
  // NOT food_store — appears on every supermarket
  // NOT restaurant / meal_takeaway / bar — could be false positives on food halls with floral
  // NOT supplier — too generic
  // NOT garden — too generic (matches botanical_garden etc.)
]);

// In deterministicFilter():
if (cats.includes("flowers")) {
  const hasBlockedFlowerType = FLOWERS_BLOCKED_PRIMARY_TYPES.has(primaryType)
    || typesArray.some((t: string) => FLOWERS_BLOCKED_SECONDARY_TYPES.has(t));
  // ... rest unchanged
}
```

Alternative fix: add an allowlist guard:

```typescript
const isLegitSupermarket = typesArray.includes("grocery_store")
  || typesArray.includes("supermarket")
  || typesArray.includes("hypermarket");
if (hasBlockedFlowerType && !isLegitSupermarket) { /* strip */ }
```

Either fix resolves the P0.

### Phase 5 — Regression Surface: **PASS (6/6)**

| Test | Result | Evidence |
|------|--------|----------|
| T-5.1 Seeding produces 3 batches per tile for casual | PASS | admin-seed-places iterates SEEDING_CATEGORIES array → writes config.appCategorySlug per tile. All 3 casual configs share slug "brunch_lunch_casual" → 3 search operations per tile, rows all stored with same app slug. |
| T-5.2 `coverage_check` action still handled | PASS | Dispatcher line 1692, handler line 440 |
| T-5.3 generate-single-cards still imports SEEDING_CATEGORIES | PASS | Line 5 import, line 34 iteration. New configs will also be iterated. No structural break. |
| T-5.4 generate-curated-experiences still imports SEEDING_CATEGORY_MAP | PASS | Line 4 import, line 634 usage. New config IDs added to map; existing combos still resolve. |
| T-5.5 BLOCKED_PRIMARY_TYPES still rejects | PASS | Check at line 529, 23 types preserved |
| T-5.6 FAST_FOOD_BLACKLIST still rejects | PASS | Check at line 552, 67 chains preserved |

### Phase 6 — Constitutional Compliance: **FAIL (P1)**

| Rule | Status | Evidence |
|------|--------|----------|
| #1 No dead taps | N/A | Backend only |
| #2 One owner per truth | PASS | Shared `BRUNCH_LUNCH_CASUAL_EXCLUDED` constant is a CORRECT application of this rule |
| #3 No silent failures | PASS | All modified errors still surface; existing error handling preserved |
| #4 One query key per entity | N/A | Backend only |
| #5 Server state server-side | N/A | Backend only |
| #6 Logout clears everything | N/A | Backend only |
| #7 Label temporary fixes | PASS | No `[TRANSITIONAL]` items introduced |
| #8 Subtract before adding | PASS | enforceExclusivity() properly removed (not shimmed); old flowers stripping replaced (not duplicated) |
| #9 No fabricated data | PASS | N/A directly but no fabrication introduced |
| #10 Currency-aware UI | N/A | Backend only |
| #11 One auth instance | N/A | Backend only |
| #12 Validate at the right time | PASS | Deterministic filter runs before GPT, stripping runs after promotion/demotion |
| **#13 Exclusion consistency** | **FAIL** | **40 gaps between pipeline BLOCKED types and on-demand CATEGORY_EXCLUDED_PLACE_TYPES** |
| #14 Persisted-state startup | N/A | Backend only |

**P1 FINDING (Invariant #13 violation):**

The pipeline's types-array block lists and the on-demand system's exclusion lists have drifted:

| Category | Pipeline BLOCKED count | On-demand EXCLUDED count (incl. RETAIL) | Gaps |
|----------|----------------------|----------------------------------------|------|
| Creative & Arts | 62 types | 14 listed + 39 retail = 53 | **32 gaps** |
| Movies & Theatre | 41 types | 47 listed + 39 retail = 86 | **8 gaps** |
| Brunch, Lunch & Casual | 36 types | 41 listed + 39 retail = 80 | **0 gaps** ✅ |
| Play | 13 types | 34 listed + 39 retail = 73 | **0 gaps** ✅ |

**Creative & Arts 32 missing types:**
`american_restaurant`, `asian_restaurant`, `barbecue_restaurant`, `brazilian_restaurant`, `chinese_restaurant`, `french_restaurant`, `german_restaurant`, `greek_restaurant`, `indian_restaurant`, `italian_restaurant`, `japanese_restaurant`, `korean_restaurant`, `mexican_restaurant`, `seafood_restaurant`, `spanish_restaurant`, `thai_restaurant`, `turkish_restaurant`, `vietnamese_restaurant`, `hamburger_restaurant`, `pizza_restaurant`, `ramen_restaurant`, `sushi_restaurant`, `steak_house`, `buffet_restaurant`, `gastropub`, `winery`, `bar_and_grill`, `tea_house`, `bakery`, `ice_cream_shop`, `gym`, `fitness_center`.

**Movies & Theatre 8 missing types:**
`brunch_restaurant`, `breakfast_restaurant`, `ice_cream_shop`, `winery`, `bar_and_grill`, `amusement_center`, `bowling_alley`, `video_arcade`.

**Why this is P1 not P0:** The deterministic filter is the PRIMARY gate — places pass through it before being stored in `place_pool` with `ai_approved=true`. The on-demand filter is a SECONDARY gate applied during on-the-fly experience generation when the pool is thin. A place filtered out by the deterministic filter will never reach the on-demand gate, so the gap has limited practical impact. But it IS a constitutional violation and should be fixed alongside the P0 rework.

**Fix:** Add the missing types to `CATEGORY_EXCLUDED_PLACE_TYPES['Creative & Arts']` and `['Movies & Theatre']` in `categoryPlaceTypes.ts`. Essentially copy the pipeline's `CREATIVE_ARTS_BLOCKED_TYPES` and `MOVIES_THEATRE_BLOCKED_TYPES` contents into the corresponding on-demand exclusion lists.

---

## Severity Breakdown

### P0 — CRITICAL (1)

**P0-1: Flowers types-array check strips 168 legitimate supermarkets**
- Location: `supabase/functions/ai-verify-pipeline/index.ts:688-704`
- Root cause: `food_store` in `FLOWERS_BLOCKED_TYPES` is a broad Google type present on every supermarket; applied to types-array rather than just primary_type
- Impact: Whole Foods, Trader Joe's, Carrefour, Waitrose, Safeway, Publix, Kroger all lose `flowers` category on re-validation. These are the canonical examples in the GPT prompt.
- Blast radius: 168 places (4% of approved pool). 93% false-positive rate on the new feature.
- Fix: See Phase 4 section above. Either split the set or add supermarket allowlist guard.
- Blocks merge: YES

### P1 — HIGH (2)

**P1-1: Live GPT behavior unverified**
- Test harness couldn't invoke live GPT (no API key, cannot deploy)
- Static prompt verification passed 15/15, but runtime behavior is extrapolation
- Mitigation: Orchestrator should schedule a limited test-city batch run after P0 fix to validate GPT against the 5 scenarios in Phase 3 of the tester prompt
- Blocks merge: Should not ship without at least smoke verification

**P1-2: Constitutional Invariant #13 violated (40 gaps)**
- Creative & Arts: 32 types blocked by pipeline but not by on-demand exclusion list
- Movies & Theatre: 8 types blocked by pipeline but not by on-demand
- Brunch, Lunch & Casual and Play: fully synced ✅
- Fix: Sync the on-demand exclusion lists to match the pipeline blocked type sets
- Blocks merge: Recommended to fix in same pass as P0

### P2 — MEDIUM (1)

**P2-1: GPT prompt Example 2 (TopGolf) inconsistent with deterministic filter**
- GPT prompt Example 2 shows TopGolf with `type:restaurant` → both `play` + `brunch_lunch_casual`
- Real Google data often tags TopGolf with `primary_type:amusement_center` → deterministic filter strips brunch_lunch_casual on re-validation
- Non-idempotent: first classification accepts both; re-validation strips one
- Fix: Either update Example 2 to match real data OR add a TopGolf-specific exception to the brunch stripping logic
- Blocks merge: No, but worth addressing before deploy

### P3 — LOW (0)

None.

### P4 — NOTES / PRAISE (2)

**P4-1: Shared `BRUNCH_LUNCH_CASUAL_EXCLUDED` constant is excellent.** Extracting the 40-line exclusion array into a named constant referenced by all 3 casual configs is exactly the right move to prevent drift. This is a POSITIVE application of Constitutional #2 (one owner per truth). Pattern worth replicating if `fine_dining` ever gets split.

**P4-2: Real-restaurant guard in brunch stripping is correctly implemented.** Line 662-663 guards against false-positive stripping when `primary_type` is a legitimate restaurant type — this correctly preserves places like "restaurant-with-bar" from being stripped just because `bar` appears in the types array. Thoughtful protection against overreach.

---

## Verification of Implementation Report Claims

| Claim | Implementor said | Tester verified |
|-------|------------------|-----------------|
| All 3 files parse cleanly | YES | CONFIRMED |
| 14 seeding configs, all under 50 types | YES | CONFIRMED (count: 14, max: 50 at cap) |
| Zero live enforceExclusivity refs | YES | CONFIRMED (only deletion comment remains) |
| 24 GPT worked examples | YES | CONFIRMED |
| 5 blocked-type sets + upscale protection | YES | CONFIRMED all 6 constants present with 1 usage each |
| EXPENSIVE + 4.0 promotion tier | YES | CONFIRMED at line 612 |
| Mutual exclusivity fully removed | YES | CONFIRMED: function deleted, 3 call sites replaced, GPT prompt text updated, new Nobu/Le Bernardin examples |
| Garden store name patterns active | YES | CONFIRMED functionally — BUT false positive due to overly broad `food_store` type |
| "Partially verified" status | YES — honest about Phase 3/4 not run | CONFIRMED accurate. The runtime testing they deferred IS where the P0 surfaced. |

**The implementor's "partially verified" label was honest and appropriate.** They correctly flagged what they hadn't tested; the P0 is exactly in the area they flagged as unverified. No dishonesty.

---

## Discoveries for Orchestrator

### D-1: Update ORCH-0463 evidence with P0 finding

ORCH-0463 ("Garden stores leaking into Flowers — types array not checked, only primary_type") is the sub-issue where the P0 surfaced. The audit was correct that the types-array wasn't checked. The implementation fixed that, but the `food_store` entry in the blocklist makes the fix over-aggressive. Register the P0 fix decision in ORCH-0463.

### D-2: Consider a pool-impact dry-run before every re-validation dispatch

ORCH-0460 implementation report correctly noted "recommend dispatching admin-ai-verify with scope=all after deploy." In light of the P0, suggest adding a **dry-run impact preview** step: run the NEW deterministic filter against a sample of currently-approved places, count how many would lose each category, and review the top 20 names by category before the real re-validation executes. A read-only diagnostic query (like the one I used in Phase 4) could save a 168-supermarket regression before it happens.

### D-3: Pre-existing state in working tree

The `supabase/functions/admin-seed-places/index.ts` file shows a 2-line uncommitted change that is NOT from ORCH-0460. Already registered as ORCH-0466 in the World Map ("admin-seed-places create_run returns 500"). Flagging for awareness — this change will ride along if the user commits ORCH-0460 without isolating.

### D-4: category-mapping.md still stale

Already registered as ORCH-0472. The file still references the 13-category system with wellness. Should be updated to match ORCH-0460 outcomes once this work is merged.

### D-5: Cleanup of test artifacts

I left test harnesses in `tmp/test-deterministic-filter.mjs`, `tmp/phase6-invariant-check.mjs`, `tmp/phase6-v2.mjs`, `tmp/phase6-v3.mjs`, and `tmp/filter-harness.mjs`. These are standalone Node scripts with no app impact. Can be kept for re-runs on retest or deleted. Not in git (tmp/ isn't tracked).

---

## Specific Rework Instructions for Implementor

### Required for re-dispatch:

**Fix 1 (P0):** In `supabase/functions/ai-verify-pipeline/index.ts`, split `FLOWERS_BLOCKED_TYPES` into primary and secondary lists:

```typescript
// Replace the single FLOWERS_BLOCKED_TYPES with two sets:
const FLOWERS_BLOCKED_PRIMARY_TYPES = new Set([
  "garden_center", "garden", "farm", "supplier", "cemetery", "funeral_home",
  "restaurant", "meal_takeaway", "bar", "food_store",
]);
const FLOWERS_BLOCKED_SECONDARY_TYPES = new Set([
  "garden_center", "farm", "cemetery", "funeral_home",
]);
```

Then in `deterministicFilter()` (around line 688-704):

```typescript
if (cats.includes("flowers")) {
  const hasBlockedFlowerType = FLOWERS_BLOCKED_PRIMARY_TYPES.has(primaryType)
    || typesArray.some((t: string) => FLOWERS_BLOCKED_SECONDARY_TYPES.has(t));
  // rest unchanged
}
```

**Fix 2 (P1-2):** Sync on-demand exclusion lists to pipeline blocked type sets.

In `supabase/functions/_shared/categoryPlaceTypes.ts`:

- Add 32 missing types to `CATEGORY_EXCLUDED_PLACE_TYPES['Creative & Arts']`
- Add 8 missing types to `CATEGORY_EXCLUDED_PLACE_TYPES['Movies & Theatre']`

Exact missing types listed in Phase 6 section above.

### Recommended but not required for merge:

**Fix 3 (P2-1):** Update GPT prompt Example 2 (TopGolf) from `type:restaurant` to `type:amusement_center` to match real Google data, OR add a note explaining that primary_type determines whether brunch_lunch_casual can coexist with play.

### Verification after rework:

Re-run Phase 4 diagnostic query against the pool. After Fix 1, expected outcomes:

- Flowers-to-strip count drops from 180 to ~1-20 places (actual garden stores only)
- Specifically: Whole Foods, Trader Joe's, Carrefour, Waitrose, Safeway, Publix all NO LONGER in the strip list
- Shannon Florist & Nursery still strips (legitimate — "nursery" in name)

---

## Retest Instructions

When implementation comes back:
1. Verify Fix 1 via Phase 4 re-run of the predictive SQL query
2. Verify Fix 2 via Phase 6 re-run (`node tmp/phase6-v3.mjs`)
3. Verify no regressions via Phase 2 re-run (`node tmp/test-deterministic-filter.mjs`)
4. Expand Phase 4 to count per-supermarket-chain impact, ensuring all canonical chains are preserved
5. If orchestrator approves a test-city run, validate Phase 3 live GPT behavior on 5-10 places

Name for retest report: `QA_ORCH-0460_SEEDING_VALIDATION_ACCURACY_REPORT_RETEST_1.md`

If more than 2 retest cycles required, flag to orchestrator as "stuck in loop."
