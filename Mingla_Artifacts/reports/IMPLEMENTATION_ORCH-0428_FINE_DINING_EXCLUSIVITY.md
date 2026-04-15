# Implementation Report: Fine Dining / Casual Eats Mutual Exclusivity (ORCH-0428)

**Date:** 2026-04-14
**Spec:** `SPEC_ORCH-0428_FINE_DINING_EXCLUSIVITY.md`
**Status:** Implemented, partially verified (needs deploy + runtime)

---

## File Changed

### supabase/functions/ai-verify-pipeline/index.ts

**What it did before:** fine_dining and casual_eats could coexist in ai_categories. GPT
could return both. The fine dining promotion rule added fine_dining without stripping
casual_eats. Admin overrides passed categories through without validation. Example 19
explicitly taught GPT to return both.

**What it does now:**
- `enforceExclusivity()` helper (line 97): if fine_dining present, strips casual_eats
- Applied in classifyPlace() post-processing (line 334): GPT results enforced
- Applied in deterministicFilter() check 6 (line 438): promotion rule enforced
- Applied in handleOverride() (line 1122): admin overrides enforced
- SYSTEM_PROMPT: "MUTUALLY EXCLUSIVE" instruction added to FINE_DINING definition
- Example 19: changed from `["fine_dining","casual_eats"]` to `["fine_dining"]`

**Lines changed:** ~15 added/modified

---

## Spec Traceability

| SC | Criterion | Verification |
|----|-----------|-------------|
| SC-1 | No dual-tagged places | UNVERIFIED — needs SQL cleanup after deploy |
| SC-2 | deterministicFilter strips casual_eats on promotion | PASS — enforceExclusivity wraps cats at line 438 |
| SC-3 | GPT results stripped | PASS — enforceExclusivity wraps parsed.c at line 334 |
| SC-4 | Admin override stripped | PASS — enforceExclusivity wraps body.categories at line 1122 |
| SC-5 | Example 19 fixed | PASS — shows `["fine_dining"]` only |
| SC-6 | Full pipeline no regression | UNVERIFIED — needs runtime test |
| SC-7 | Rules filter no regression | UNVERIFIED — needs runtime test |
| SC-8 | Other combos unaffected | PASS — enforceExclusivity only filters when fine_dining present |

---

## SQL Cleanup (Ready to Run After Deploy)

```sql
UPDATE place_pool
SET ai_categories = array_remove(ai_categories, 'casual_eats'),
    ai_reason = 'Rules cleanup: fine_dining and casual_eats mutually exclusive — stripped casual_eats',
    ai_validated_at = NOW()
WHERE 'fine_dining' = ANY(ai_categories)
AND 'casual_eats' = ANY(ai_categories)
AND is_active = true;
```

---

## Regression Surface

1. Full AI validation pipeline (GPT classification path)
2. Rules filter (deterministicFilter promotion path)
3. Admin Review Queue overrides
4. Casual eats deck size (loses ~555 places that move to fine_dining only)

---

## Discoveries for Orchestrator

None.
