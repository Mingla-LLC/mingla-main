# Spec: Picnic Park / Nature & Views Mutual Exclusivity (ORCH-0429)

**Date:** 2026-04-14
**Investigation:** `INVESTIGATION_ORCH-0429_PICNIC_NATURE_EXCLUSIVITY.md`

---

## Layman Summary

Picnic Park and Nature & Views are 96% identical decks. After this fix, each place gets
the one tag that actually describes it: parks with lawns → picnic, scenic spots → nature.
The decision is based on what Google calls the place (primary_type), so it's free and
instant — no AI re-run needed.

---

## Scope

**IN:**
- Extend `enforceExclusivity()` to accept optional `primaryType` parameter
- Add picnic_park/nature_views exclusivity logic using primary_type-based rules
- Add constant sets for picnic-winning and nature-winning primary_types
- Update all 3 call sites to pass primaryType where available
- Update SYSTEM_PROMPT: rewrite definitions as mutually exclusive
- SQL cleanup of 7,626 dual-tagged places

**OUT:**
- Mobile app changes (zero)
- Admin UI changes (zero)
- Curated experience generation changes (unaffected — uses picnic_park tag which still exists)
- Seeding logic changes

---

## Success Criteria

| # | Criterion | How to Verify |
|---|-----------|--------------|
| SC-1 | No place has both `picnic_park` and `nature_views` | `SELECT COUNT(*) FROM place_pool WHERE 'picnic_park' = ANY(ai_categories) AND 'nature_views' = ANY(ai_categories) AND is_active = true` → 0 |
| SC-2 | park/city_park/picnic_ground places have picnic_park only | Query confirms |
| SC-3 | hiking_area/beach/scenic_spot/etc. have nature_views only | Query confirms |
| SC-4 | Ambiguous types (garden, tourist_attraction, NULL) default to nature_views | Query confirms |
| SC-5 | GPT prompt defines the two as mutually exclusive | Read SYSTEM_PROMPT |
| SC-6 | All 3 enforcement points pass primaryType | Grep enforceExclusivity calls |
| SC-7 | Curated picnic experiences still work | picnic_park tag still exists on parks |
| SC-8 | Full pipeline and rules filter still work (no regression) | Run on test places |
| SC-9 | fine_dining/casual_eats exclusivity still works | Unchanged behavior |

---

## Edge Function Changes

### File: `supabase/functions/ai-verify-pipeline/index.ts`

### Change 1: Add type sets for picnic/nature resolution

Add after `RESTAURANT_TYPES` (before the `enforceExclusivity` function):

```typescript
// ── Picnic vs Nature: primary_types that determine the winner ───────────────
const PICNIC_WINS_TYPES = new Set([
  "park", "city_park", "picnic_ground",
]);

const NATURE_WINS_TYPES = new Set([
  "hiking_area", "state_park", "nature_preserve", "botanical_garden",
  "scenic_spot", "lake", "beach", "observation_deck", "national_park",
  "wildlife_park", "wildlife_refuge", "river", "marina", "island",
  "mountain_peak", "waterfront", "historical_landmark", "farm", "sculpture",
]);
```

### Change 2: Extend `enforceExclusivity()` to accept primaryType

Replace the current function (lines 97-103):

```typescript
// ── Category Exclusivity Rules ──────────────────────────────────────────────
function enforceExclusivity(categories: string[], primaryType?: string): string[] {
  // Rule 1: fine_dining and casual_eats are mutually exclusive (fine_dining wins)
  if (categories.includes("fine_dining")) {
    categories = categories.filter(c => c !== "casual_eats");
  }

  // Rule 2: picnic_park and nature_views are mutually exclusive (type-based)
  if (categories.includes("picnic_park") && categories.includes("nature_views")) {
    if (primaryType && PICNIC_WINS_TYPES.has(primaryType)) {
      categories = categories.filter(c => c !== "nature_views");
    } else {
      // nature_views wins for: nature types, ambiguous types, unknown types
      categories = categories.filter(c => c !== "picnic_park");
    }
  }

  return categories;
}
```

**Design rationale:** 
- The function stays pure — same input always produces same output
- `primaryType` is optional — if not provided, nature_views wins (safe default)
- PICNIC_WINS_TYPES is a short allowlist (3 types). Everything else → nature wins.
  This is intentionally conservative — only obvious picnic spots get picnic_park.
- fine_dining rule unchanged — still runs first

### Change 3: Update call site in `classifyPlace()` (line 335)

The factSheet is available in scope. Pass `factSheet.type`:

Replace:
```typescript
parsed.c = enforceExclusivity(
  (parsed.c || []).filter((s: string) => VALID_SLUGS.has(s))
);
```

With:
```typescript
parsed.c = enforceExclusivity(
  (parsed.c || []).filter((s: string) => VALID_SLUGS.has(s)),
  factSheet.type as string | undefined
);
```

### Change 4: Update call site in `deterministicFilter()` check 6 (line 439)

`primaryType` is already a local variable in this function. Pass it:

Replace:
```typescript
categories: enforceExclusivity(cats),
```

With:
```typescript
categories: enforceExclusivity(cats, primaryType),
```

### Change 5: Update call site in `handleOverride()` (line 1123)

This handler currently only fetches `place_id` from the result. Extend it to also
fetch `primary_type` from `place_pool`:

Replace:
```typescript
// Get place_id from result
const { data: result } = await db.from("ai_validation_results").select("place_id").eq("id", resultId).single();
if (!result) return json({ error: "Result not found" }, 404);
```

With:
```typescript
// Get place_id from result
const { data: result } = await db.from("ai_validation_results").select("place_id").eq("id", resultId).single();
if (!result) return json({ error: "Result not found" }, 404);

// Get primary_type for exclusivity enforcement
const { data: placeData } = await db.from("place_pool").select("primary_type").eq("id", result.place_id).single();
const overridePrimaryType = placeData?.primary_type || "";
```

Then update the write (line 1123):

Replace:
```typescript
ai_categories: enforceExclusivity(body.categories || []),
```

With:
```typescript
ai_categories: enforceExclusivity(body.categories || [], overridePrimaryType),
```

### Change 6: Update SYSTEM_PROMPT

Replace the current definitions (lines 141-143):

```
NATURE_VIEWS: Parks, trails, beaches, botanical gardens, scenic viewpoints, observation decks, waterfronts, bridges, harbors, nature preserves. Parks with grass also get picnic_park.

PICNIC_PARK: Parks with open lawns where you can lay a blanket. Almost always paired with nature_views.
```

With:

```
NATURE_VIEWS: Scenic outdoor spots where the draw is the VIEW or the WALK — trails, hiking areas, beaches, botanical gardens, scenic viewpoints, observation decks, waterfronts, bridges, harbors, nature preserves, state parks, national parks, lakes, rivers, wildlife areas. NOT generic city parks with lawns (those are picnic_park). IMPORTANT: nature_views and picnic_park are MUTUALLY EXCLUSIVE. Never assign both.

PICNIC_PARK: Parks with open grass or lawns where you can lay a blanket and have a picnic — generic parks, city parks, neighborhood parks, recreation grounds. The vibe is "bring food, sit on grass." NOT scenic viewpoints, hiking trails, beaches, or botanical gardens (those are nature_views). IMPORTANT: picnic_park and nature_views are MUTUALLY EXCLUSIVE. Never assign both.
```

### Change 7: Add worked examples for the split

Add after the existing Example 19:

```
Example 20: "Prospect Park" type:park → {"d":"accept","c":["picnic_park"],"pi":"urban park","w":false,"r":"City park with open lawns — picnic_park (not nature_views, mutually exclusive)","f":"high"}

Example 21: "Griffith Observatory Trail" type:hiking_area → {"d":"accept","c":["nature_views"],"pi":"hiking trail with scenic views","w":false,"r":"Hiking trail — nature_views (not picnic_park, mutually exclusive)","f":"high"}
```

---

## SQL Cleanup (One-Time)

Run after deploying. Three queries in order:

```sql
-- 1. Parks with lawns → keep picnic_park, strip nature_views
UPDATE place_pool
SET ai_categories = array_remove(ai_categories, 'nature_views'),
    ai_reason = 'Rules cleanup: park/city_park/picnic_ground → picnic_park only (mutually exclusive with nature_views)',
    ai_validated_at = NOW()
WHERE primary_type IN ('park', 'city_park', 'picnic_ground')
AND 'picnic_park' = ANY(ai_categories)
AND 'nature_views' = ANY(ai_categories)
AND is_active = true;

-- 2. Scenic spots → keep nature_views, strip picnic_park
UPDATE place_pool
SET ai_categories = array_remove(ai_categories, 'picnic_park'),
    ai_reason = 'Rules cleanup: scenic type → nature_views only (mutually exclusive with picnic_park)',
    ai_validated_at = NOW()
WHERE primary_type IN (
  'hiking_area', 'state_park', 'nature_preserve', 'botanical_garden',
  'scenic_spot', 'lake', 'beach', 'observation_deck', 'national_park',
  'wildlife_park', 'wildlife_refuge', 'river', 'marina', 'island',
  'mountain_peak', 'waterfront', 'historical_landmark', 'farm', 'sculpture'
)
AND 'picnic_park' = ANY(ai_categories)
AND 'nature_views' = ANY(ai_categories)
AND is_active = true;

-- 3. Ambiguous types → default to nature_views, strip picnic_park
UPDATE place_pool
SET ai_categories = array_remove(ai_categories, 'picnic_park'),
    ai_reason = 'Rules cleanup: ambiguous type → default nature_views (mutually exclusive with picnic_park)',
    ai_validated_at = NOW()
WHERE 'picnic_park' = ANY(ai_categories)
AND 'nature_views' = ANY(ai_categories)
AND is_active = true;
```

Query 3 is the catch-all — it handles everything not caught by queries 1 and 2
(garden, tourist_attraction, NULL, plaza, etc.). Order matters.

---

## Implementation Order

1. Add `PICNIC_WINS_TYPES` and `NATURE_WINS_TYPES` constants
2. Replace `enforceExclusivity()` with extended version (primaryType param)
3. Update `classifyPlace()` call site — pass `factSheet.type`
4. Update `deterministicFilter()` call site — pass `primaryType`
5. Update `handleOverride()` — fetch primary_type, pass to enforceExclusivity
6. Update SYSTEM_PROMPT — rewrite definitions + add Examples 20-21
7. Deploy edge function
8. Run SQL cleanup (3 queries in order)

---

## Test Cases

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| T-01 | Park with both tags | categories: [picnic_park, nature_views], primaryType: park | [picnic_park] |
| T-02 | Hiking area with both | categories: [picnic_park, nature_views], primaryType: hiking_area | [nature_views] |
| T-03 | Beach with both | categories: [picnic_park, nature_views], primaryType: beach | [nature_views] |
| T-04 | Garden with both (ambiguous) | categories: [picnic_park, nature_views], primaryType: garden | [nature_views] (default) |
| T-05 | NULL type with both | categories: [picnic_park, nature_views], primaryType: undefined | [nature_views] (default) |
| T-06 | Only picnic_park (no conflict) | categories: [picnic_park], primaryType: park | [picnic_park] (unchanged) |
| T-07 | Only nature_views (no conflict) | categories: [nature_views], primaryType: hiking_area | [nature_views] (unchanged) |
| T-08 | fine_dining + casual_eats still works | categories: [fine_dining, casual_eats], primaryType: restaurant | [fine_dining] |
| T-09 | Park with picnic + drink | categories: [picnic_park, nature_views, drink], primaryType: park | [picnic_park, drink] |
| T-10 | Override with both + park type | handleOverride with [picnic_park, nature_views] | Written as [picnic_park] |
| T-11 | SQL cleanup complete | Query dual-tagged count | 0 rows |
| T-12 | Curated picnic experiences | Query card_pool curated picnic | Still exist, stops reference picnic_park |

---

## Regression Prevention

1. **Structural:** `PICNIC_WINS_TYPES` is a 3-item Set — only obvious picnic spots. Conservative.
2. **GPT prompt:** Explicit "MUTUALLY EXCLUSIVE" + "Never assign both" in both definitions + 2 worked examples
3. **New invariant:** "picnic_park and nature_views must never coexist in ai_categories"
4. **enforceExclusivity handles both rules in one function** — single enforcement point, zero drift risk

---

## Handoff to Implementor

1. Read this spec. 7 code changes + 3 SQL queries.
2. The function signature change is backwards-compatible — `primaryType` is optional.
3. All existing fine_dining logic is preserved — just extended with the picnic/nature rule.
4. The SYSTEM_PROMPT changes are text rewrites of 2 definitions + 2 new examples.
5. The handleOverride change adds one DB query — be careful to handle the case where placeData is null.
6. Do NOT touch curated experience generation. Do NOT touch mobile app.
