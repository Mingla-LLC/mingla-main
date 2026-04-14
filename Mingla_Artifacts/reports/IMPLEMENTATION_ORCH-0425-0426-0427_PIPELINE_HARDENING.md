# Implementation Report: AI Validation Pipeline Hardening (ORCH-0425, 0426, 0427)

**Date:** 2026-04-14
**Spec:** `SPEC_ORCH-0425-0426-0427_PIPELINE_HARDENING.md`
**Status:** Implemented, partially verified (needs deploy + runtime testing)

---

## Files Changed

### 1. supabase/functions/ai-verify-pipeline/index.ts

**What it did before:** Single-mode pipeline that always runs Stages 2-5 (deterministic
filter → Serper search → website verification → GPT classification). The deterministic
filter had 3 checks (fast food, exclusion keywords, casual chain demotion) with an
underscore/space mismatch bug. No per-category type blocking. No fine dining promotion.
No minimum-data guard. No way to run rules without burning API credits.

**What it does now:**
- 4 new constant sets: `BLOCKED_PRIMARY_TYPES` (21 types), `FLOWERS_BLOCKED_TYPES` (10),
  `DELIVERY_ONLY_PATTERNS` (8 patterns), `RESTAURANT_TYPES` (40 types)
- `PreFilterResult` interface now includes `"modify"` verdict
- `deterministicFilter()` has 8 checks: blocked types → min-data guard → fast food →
  exclusion keywords (with underscore normalization) → casual chain demotion → fine dining
  promotion → flowers type blocking → delivery-only detection
- `processPlace()` maps `"modify"` verdict to `"reclassify"` decision
- New `handleRunRulesFilter()` handler: processes places using ONLY Stage 2, $0 cost,
  writes audit trail to `ai_validation_results`, creates job record with `stage: "rules_only"`
- New action `"run_rules_filter"` registered in serve handler switch
- SYSTEM_PROMPT updated: fine_dining definition now includes VERY_EXPENSIVE guidance,
  uncertainty instruction qualified by price level, 2 new worked examples (Examples 18-19)

**Lines changed:** ~300 added, ~30 replaced

### 2. mingla-admin/src/pages/AIValidationPage.jsx

**What it did before:** Pipeline tab had one button ("Start Verification") that runs the
full Stages 2-5 pipeline.

**What it does now:**
- `Shield` icon imported from lucide-react
- Two new state variables: `rulesRunning`, `rulesResult`
- New `handleRunRulesFilter()` function that calls `action: "run_rules_filter"`
- New "Run Rules Filter — Free" button (secondary style, Shield icon) above existing
  "Start Verification" button, with subtitle explaining what it does
- Results card showing Processed/Rejected/Modified/Unchanged after rules filter completes
- Dry run warning badge if applicable

**Lines changed:** ~60 added

---

## Spec Traceability

| SC | Criterion | Implementation | Verification |
|----|-----------|---------------|-------------|
| SC-1 | Rules filter $0 cost | `handleRunRulesFilter` never calls Serper or GPT, `cost_usd: 0` | UNVERIFIED — needs runtime test |
| SC-2 | Blocked types rejected | `BLOCKED_PRIMARY_TYPES.has(primaryType)` → reject | PASS — code verified |
| SC-3 | Flowers stripped from blocked types | `FLOWERS_BLOCKED_TYPES.has(primaryType)` → strip flowers | PASS — code verified |
| SC-4 | Underscore normalization | `primaryType.replace(/_/g, " ")` before keyword matching | PASS — code verified |
| SC-5 | VERY_EXPENSIVE promotion | Check 6 in `deterministicFilter()` adds fine_dining | PASS — code verified |
| SC-6 | No-data rejection | Check 2: `rating == null && reviews === 0 && !website` → reject | PASS — code verified |
| SC-7 | Full pipeline unchanged | `processPlace()` still runs Stages 3-5 after Stage 2 pass | PASS — code verified |
| SC-8 | ai_reason documented | All rules-filter results write reason to `ai_reason` | PASS — code verified |
| SC-9 | GPT prompt updated | Examples 18-19 added, VERY_EXPENSIVE guidance added | PASS — code verified |
| SC-10 | Admin UI shows results | Results card with 4 stats + dry run badge | PASS — code verified |

---

## SQL Cleanup Queries (Ready to Run After Deploy)

```sql
-- 1. Reject all places with blocked primary_types
UPDATE place_pool
SET ai_approved = false,
    ai_reason = 'Rules cleanup: blocked primary_type',
    ai_validated_at = NOW()
WHERE primary_type IN (
  'cemetery', 'funeral_home', 'gas_station', 'car_dealer', 'car_wash',
  'car_rental', 'auto_repair', 'parking', 'storage', 'laundry',
  'locksmith', 'plumber', 'electrician', 'roofing_contractor',
  'insurance_agency', 'real_estate_agency', 'accounting',
  'post_office', 'fire_station', 'police', 'courthouse'
)
AND is_active = true
AND ai_approved = true;

-- 2. Strip 'flowers' from non-flower primary_types
UPDATE place_pool
SET ai_categories = array_remove(ai_categories, 'flowers'),
    ai_reason = 'Rules cleanup: stripped flowers from ' || primary_type,
    ai_validated_at = NOW()
WHERE primary_type IN (
  'garden_center', 'garden', 'farm', 'supplier', 'cemetery',
  'funeral_home', 'restaurant', 'meal_takeaway', 'bar', 'food_store'
)
AND 'flowers' = ANY(ai_categories)
AND is_active = true;

-- 3. Reject places left with zero categories after stripping
UPDATE place_pool
SET ai_approved = false,
    ai_reason = 'Rules cleanup: no remaining categories after flowers stripped',
    ai_validated_at = NOW()
WHERE ai_categories = '{}'
AND is_active = true
AND ai_approved = true;

-- 4. Reject no-data places (no rating, no reviews, no website)
UPDATE place_pool
SET ai_approved = false,
    ai_reason = 'Rules cleanup: no rating, no reviews, no website — insufficient data',
    ai_validated_at = NOW()
WHERE rating IS NULL
AND (review_count IS NULL OR review_count = 0)
AND website IS NULL
AND is_active = true
AND ai_approved = true;
```

---

## Surprises

None. The spec was precise and the code matched expectations.

---

## Regression Surface

1. **Full AI validation pipeline** — the deterministicFilter changes affect both rules-only
   AND full pipeline mode. Must verify SC-7 with a real run.
2. **Card generation** — places rejected by rules filter won't appear in future card
   generation. Existing cards from rejected places persist until regenerated.
3. **Admin Command Center** — stats (validated/unvalidated counts) will shift after rules
   filter runs. The dashboard reads from the same place_pool data.
4. **Review Queue** — rules-filter results with `stage_resolved: 2` will appear in the
   review queue if they're reclassified. This is correct behavior.

---

## Discoveries for Orchestrator

None — all changes were within spec scope.
