# Spec: Fine Dining / Casual Eats Mutual Exclusivity (ORCH-0428)

**Date:** 2026-04-14
**Investigation:** `INVESTIGATION_ORCH-0428_FINE_DINING_EXCLUSIVITY.md`

---

## Layman Summary

When a restaurant qualifies as fine dining, it should only appear in the fine dining deck —
not also in casual eats. One new helper function, called at 3 points in the pipeline, plus
a GPT prompt fix and a SQL cleanup of 555 existing dual-tagged places.

---

## Scope

**IN:**
- New `enforceExclusivity()` helper function
- Call it in classifyPlace post-processing, deterministicFilter check 6, handleOverride
- Update SYSTEM_PROMPT Example 19 and add exclusivity instruction
- SQL cleanup of existing dual-tagged data

**OUT:**
- Mobile app changes (zero needed)
- Admin UI changes (zero needed)
- Any other category exclusivity rules (only fine_dining vs casual_eats)

---

## Success Criteria

| # | Criterion | How to Verify |
|---|-----------|--------------|
| SC-1 | No place in place_pool has both `fine_dining` and `casual_eats` in ai_categories | `SELECT COUNT(*) FROM place_pool WHERE 'fine_dining' = ANY(ai_categories) AND 'casual_eats' = ANY(ai_categories) AND is_active = true` → 0 |
| SC-2 | When deterministicFilter promotes to fine_dining, casual_eats is stripped | Trace check 6: place with `[casual_eats]` + VERY_EXPENSIVE → returns `[fine_dining]` not `[casual_eats, fine_dining]` |
| SC-3 | When GPT returns both, casual_eats is stripped before writing | classifyPlace returns `[fine_dining, drink]` not `[fine_dining, casual_eats, drink]` |
| SC-4 | When admin overrides with both, casual_eats is stripped | handleOverride with `categories: ["fine_dining", "casual_eats"]` → writes `["fine_dining"]` |
| SC-5 | Example 19 no longer teaches GPT to return both | Read SYSTEM_PROMPT, verify Example 19 shows `["fine_dining"]` only |
| SC-6 | Full pipeline still works (no regression) | Run full validation on 5 places → normal results |
| SC-7 | Rules filter still works (no regression) | Run rules filter → normal results |
| SC-8 | Other category combinations unaffected | fine_dining + drink → both kept. casual_eats + drink → both kept. |

---

## Edge Function Changes

### File: `supabase/functions/ai-verify-pipeline/index.ts`

### Change 1: New helper function

Add after the `RESTAURANT_TYPES` constant (after line 94), before `SOCIAL_DOMAINS`:

```typescript
// ── Category Exclusivity: fine_dining and casual_eats are mutually exclusive ─
function enforceExclusivity(categories: string[]): string[] {
  if (categories.includes("fine_dining")) {
    return categories.filter(c => c !== "casual_eats");
  }
  return categories;
}
```

### Change 2: Apply in classifyPlace() post-processing

At line 326, after the VALID_SLUGS filter, add exclusivity enforcement:

Replace:
```typescript
parsed.c = (parsed.c || []).filter((s: string) => VALID_SLUGS.has(s));
```

With:
```typescript
parsed.c = enforceExclusivity(
  (parsed.c || []).filter((s: string) => VALID_SLUGS.has(s))
);
```

### Change 3: Apply in deterministicFilter() check 6

At line 424, after pushing fine_dining, apply exclusivity to the array before returning:

Replace:
```typescript
cats.push("fine_dining");
return {
  verdict: "modify",
  reason: "Rules: VERY_EXPENSIVE + high rating restaurant — promoted to fine_dining",
  categories: cats,
  stageResolved: 2,
};
```

With:
```typescript
cats.push("fine_dining");
return {
  verdict: "modify",
  reason: "Rules: VERY_EXPENSIVE + high rating restaurant — promoted to fine_dining",
  categories: enforceExclusivity(cats),
  stageResolved: 2,
};
```

### Change 4: Apply in handleOverride()

At line 1112, enforce exclusivity on admin-provided categories:

Replace:
```typescript
ai_categories: body.categories || [],
```

With:
```typescript
ai_categories: enforceExclusivity(body.categories || []),
```

### Change 5: Update SYSTEM_PROMPT

**5a. Add exclusivity instruction to FINE_DINING definition.**

After the sentence ending with "...don't advertise 'Michelin' or 'tasting menu' in their Google snippets." add:

```
IMPORTANT: fine_dining and casual_eats are MUTUALLY EXCLUSIVE. If a place qualifies for fine_dining, do NOT also assign casual_eats. A fine dining restaurant is fine_dining only. If it also has a bar, it can be fine_dining + drink, but never fine_dining + casual_eats.
```

**5b. Update Example 19:**

Replace:
```
Example 19: "Fogo de Chão Brazilian Steakhouse" type:brazilian_restaurant price:PRICE_LEVEL_EXPENSIVE rating:4.8 → {"d":"accept","c":["fine_dining","casual_eats"],"pi":"upscale Brazilian steakhouse chain","w":true,"r":"EXPENSIVE chain steakhouse with exceptional rating — fine_dining + casual_eats","f":"high"}
```

With:
```
Example 19: "Fogo de Chão Brazilian Steakhouse" type:brazilian_restaurant price:PRICE_LEVEL_EXPENSIVE rating:4.8 → {"d":"accept","c":["fine_dining"],"pi":"upscale Brazilian steakhouse chain","w":true,"r":"EXPENSIVE chain steakhouse with exceptional rating — fine_dining (not casual_eats — mutually exclusive)","f":"high"}
```

---

## SQL Cleanup (One-Time)

Run after deploying the code changes:

```sql
-- Strip casual_eats from all places that have both fine_dining and casual_eats
UPDATE place_pool
SET ai_categories = array_remove(ai_categories, 'casual_eats'),
    ai_reason = 'Rules cleanup: fine_dining and casual_eats mutually exclusive — stripped casual_eats',
    ai_validated_at = NOW()
WHERE 'fine_dining' = ANY(ai_categories)
AND 'casual_eats' = ANY(ai_categories)
AND is_active = true;
```

---

## Implementation Order

1. Add `enforceExclusivity()` helper function
2. Apply in `classifyPlace()` post-processing (line 326)
3. Apply in `deterministicFilter()` check 6 (line 424)
4. Apply in `handleOverride()` (line 1112)
5. Update SYSTEM_PROMPT — add exclusivity instruction + fix Example 19
6. Deploy edge function
7. Run SQL cleanup

---

## Test Cases

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| T-01 | enforceExclusivity with both | `["fine_dining", "casual_eats", "drink"]` | `["fine_dining", "drink"]` |
| T-02 | enforceExclusivity without fine_dining | `["casual_eats", "drink"]` | `["casual_eats", "drink"]` (unchanged) |
| T-03 | enforceExclusivity fine_dining only | `["fine_dining"]` | `["fine_dining"]` (unchanged) |
| T-04 | enforceExclusivity empty | `[]` | `[]` (unchanged) |
| T-05 | deterministicFilter promotes VERY_EXPENSIVE | Place: casual_eats + VERY_EXPENSIVE + 4.5★ | Returns `[fine_dining]` not `[casual_eats, fine_dining]` |
| T-06 | GPT returns both | GPT: `["fine_dining", "casual_eats"]` | Post-processing strips to `["fine_dining"]` |
| T-07 | Admin override with both | Override: `["fine_dining", "casual_eats"]` | Written as `["fine_dining"]` |
| T-08 | GPT returns casual_eats only | GPT: `["casual_eats"]` | Unchanged — no fine_dining present |
| T-09 | Example 19 in prompt | Read SYSTEM_PROMPT | Shows `["fine_dining"]` not `["fine_dining","casual_eats"]` |
| T-10 | SQL cleanup complete | Query dual-tagged count | 0 rows |

---

## Regression Prevention

1. **Structural:** `enforceExclusivity()` is a pure function — easy to test, impossible to forget since it's inline at every write point
2. **GPT prompt:** Explicit "MUTUALLY EXCLUSIVE" instruction + worked example prevents GPT from learning to return both
3. **New invariant:** "fine_dining and casual_eats must never coexist in ai_categories" — add to invariant registry

---

## Handoff to Implementor

1. Read this spec. 5 code changes + 1 SQL cleanup.
2. The `enforceExclusivity` function is 4 lines. Each call site is a one-line change.
3. The SYSTEM_PROMPT changes are text edits — add one sentence, modify one example.
4. Do NOT create a separate enforcement for the rules filter handler — it already uses `deterministicFilter()` which gets Change 3.
5. Do NOT touch mobile app or admin UI.
