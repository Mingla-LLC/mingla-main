# Spec: AI Validation Pipeline Hardening (ORCH-0425, 0426, 0427)

**Author:** Forensics Agent (spec mode)
**Date:** 2026-04-14
**Investigation:** `INVESTIGATION_ORCH-0425-0426-0427_POOL_DATA_QUALITY.md`

---

## Layman Summary

We're making two changes:

1. **Split the validation pipeline** so you can run the free rules filter without paying
   for web searches or AI. A new "Run Rules Filter" button on the admin page runs only the
   hardcoded rules — costs $0, runs in seconds, catches gas stations, garden centers,
   cemeteries, and promotes expensive restaurants to fine dining.

2. **Fix the rules themselves** — normalize underscores so `gas_station` matches "gas station",
   block venue types that are never date spots, strip flowers from garden centers, promote
   VERY_EXPENSIVE restaurants to fine dining, and reject empty-profile places that GPT
   hallucinates on.

No mobile app changes. No database schema changes. One edge function updated, one admin
page updated, one SQL cleanup script.

---

## Scope

**IN:**
- Backend: `rules_only` mode in `ai-verify-pipeline`
- Backend: Stage 2 deterministic filter fixes
- Backend: Stage 5 GPT prompt updates
- Admin: "Run Rules Filter" button on Pipeline tab
- SQL: One-time cleanup of existing bad data

**OUT (explicit):**
- Supermarket flowers cleanup (needs research — Carrefour etc. DO sell bouquets)
- Fine dining / casual_eats mutual exclusivity (pending product decision)
- Re-running full AI on 306 expensive restaurants (user triggers separately after deploy)
- Seeding logic changes
- Mobile app changes

---

## Success Criteria

| # | Criterion | How to Verify |
|---|-----------|--------------|
| SC-1 | Admin can click "Run Rules Filter" and process places with $0 Serper/GPT cost | Run on 100 places, check `ai_validation_results.cost_usd = 0` for every row, no Serper/OpenAI calls in function logs |
| SC-2 | Places with blocked primary_types get `ai_approved = false` | Query `place_pool WHERE primary_type = 'gas_station' AND ai_approved = true` → 0 rows |
| SC-3 | Flowers stripped from garden_center/cemetery/funeral_home/farm/supplier/restaurant/meal_takeaway/bar/food_store primary_types | Query `place_pool WHERE primary_type = 'garden_center' AND 'flowers' = ANY(ai_categories)` → 0 rows |
| SC-4 | Underscore normalization catches all Google types | `"gas_station"` in primary_type triggers `utilitarian` exclusion keyword match |
| SC-5 | VERY_EXPENSIVE + 4.0+ rating restaurants get `fine_dining` in categories | Query a known case like "The Ruxton Steakhouse" → `fine_dining` in ai_categories |
| SC-6 | No-data places (null rating + 0 reviews + null website) get rejected | "27513" lake → `ai_approved = false` |
| SC-7 | Full AI validation still works unchanged | Run full pipeline on 10 places → Serper called, GPT called, results written normally |
| SC-8 | `ai_reason` explains every rules-filter decision | Every rules-filter result has a non-empty reason starting with "Rules:" |
| SC-9 | GPT prompt includes VERY_EXPENSIVE fine_dining example | Read prompt text, verify worked example present |
| SC-10 | Rules filter shows progress and final stats in admin UI | Button shows count → runs → shows accepted/rejected/modified/unchanged |

---

## Edge Function Changes

### File: `supabase/functions/ai-verify-pipeline/index.ts`

### Change 1: New constants (add after line 53, after CASUAL_CHAIN_DEMOTION)

```typescript
// ── Blocked Primary Types (never a date spot) ───────────────────────────────
const BLOCKED_PRIMARY_TYPES = new Set([
  "cemetery", "funeral_home", "gas_station", "car_dealer", "car_wash",
  "car_rental", "auto_repair", "parking", "storage", "laundry",
  "locksmith", "plumber", "electrician", "roofing_contractor",
  "insurance_agency", "real_estate_agency", "accounting",
  "post_office", "fire_station", "police", "courthouse",
]);

// ── Flowers: primary_types that must NEVER get the flowers category ─────────
const FLOWERS_BLOCKED_TYPES = new Set([
  "garden_center", "garden", "farm", "supplier", "cemetery", "funeral_home",
  "restaurant", "meal_takeaway", "bar", "food_store",
]);

// ── Delivery-only patterns (strip flowers if matched + not a florist) ───────
const DELIVERY_ONLY_PATTERNS = [
  "flower delivery", "floral delivery", "same day delivery",
  "same-day delivery", "livraison de fleurs", "livraison fleurs",
  "blumen lieferung", "entrega de flores",
];

// ── Restaurant primary_types (for fine_dining promotion) ────────────────────
const RESTAURANT_TYPES = new Set([
  "restaurant", "fine_dining_restaurant", "american_restaurant",
  "asian_restaurant", "asian_fusion_restaurant", "barbecue_restaurant",
  "brazilian_restaurant", "caribbean_restaurant", "chinese_restaurant",
  "ethiopian_restaurant", "french_restaurant", "fusion_restaurant",
  "german_restaurant", "greek_restaurant", "indian_restaurant",
  "indonesian_restaurant", "italian_restaurant", "japanese_restaurant",
  "korean_restaurant", "korean_barbecue_restaurant", "lebanese_restaurant",
  "mediterranean_restaurant", "mexican_restaurant", "middle_eastern_restaurant",
  "moroccan_restaurant", "north_indian_restaurant", "peruvian_restaurant",
  "ramen_restaurant", "seafood_restaurant", "spanish_restaurant",
  "sushi_restaurant", "tapas_restaurant", "turkish_restaurant",
  "vegan_restaurant", "vegetarian_restaurant", "vietnamese_restaurant",
  "steak_house", "bistro", "british_restaurant", "belgian_restaurant",
  "fondue_restaurant", "oyster_bar_restaurant",
]);
```

### Change 2: Fix `deterministicFilter()` (replace lines 305-330)

The current function signature and return type need extending. New interface:

```typescript
interface PreFilterResult {
  verdict: "reject" | "accept" | "modify" | "pass";
  reason?: string;
  categories?: string[];
  stageResolved?: number;
}
```

New `deterministicFilter()` implementation:

```typescript
function deterministicFilter(place: any): PreFilterResult {
  const name = place.name || "";
  const primaryType = place.primary_type || "";
  // FIX: normalize underscores to spaces for keyword matching
  const normalizedType = primaryType.replace(/_/g, " ");
  const checkText = `${name} ${normalizedType}`.toLowerCase();

  // 1. Blocked primary types — instant reject
  if (BLOCKED_PRIMARY_TYPES.has(primaryType)) {
    return {
      verdict: "reject",
      reason: `Rules: blocked primary_type '${primaryType}' — not a date venue`,
      categories: [],
      stageResolved: 2,
    };
  }

  // 2. Minimum-data guard — reject empty-profile places
  const rating = place.rating;
  const reviews = place.review_count || 0;
  const website = place.website;
  if (rating == null && reviews === 0 && !website) {
    return {
      verdict: "reject",
      reason: "Rules: no rating, no reviews, no website — insufficient data",
      categories: [],
      stageResolved: 2,
    };
  }

  // 3. Fast food blacklist
  if (nameMatches(name, FAST_FOOD_BLACKLIST)) {
    return {
      verdict: "reject",
      reason: "Pipeline: fast food chain — rejected",
      categories: [],
      stageResolved: 2,
    };
  }

  // 4. Exclusion keywords (now with normalized underscores)
  for (const [category, keywords] of Object.entries(EXCLUSION_KEYWORDS)) {
    if (keywords.some((kw) => checkText.includes(kw.toLowerCase()))) {
      return {
        verdict: "reject",
        reason: `Pipeline: excluded type (${category}) — rejected`,
        categories: [],
        stageResolved: 2,
      };
    }
  }

  // 5. Casual chain demotion
  if (nameMatches(name, CASUAL_CHAIN_DEMOTION)) {
    const cats = [...(place.ai_categories || [])];
    if (cats.includes("fine_dining")) {
      const newCats = cats.filter((c: string) => c !== "fine_dining");
      if (!newCats.includes("casual_eats")) newCats.push("casual_eats");
      return {
        verdict: "accept",
        reason: "Pipeline: sit-down chain — downgraded from fine_dining to casual_eats",
        categories: newCats,
        stageResolved: 2,
      };
    }
  }

  // 6. Fine dining promotion: VERY_EXPENSIVE + 4.0+ rating + restaurant type
  if (
    place.price_level === "PRICE_LEVEL_VERY_EXPENSIVE" &&
    rating != null && rating >= 4.0 &&
    RESTAURANT_TYPES.has(primaryType)
  ) {
    const cats = [...(place.ai_categories || [])];
    if (!cats.includes("fine_dining")) {
      cats.push("fine_dining");
      return {
        verdict: "modify",
        reason: "Rules: VERY_EXPENSIVE + high rating restaurant — promoted to fine_dining",
        categories: cats,
        stageResolved: 2,
      };
    }
  }

  // 7. Per-category type blocking: strip flowers from non-flower types
  const cats = [...(place.ai_categories || [])];
  let modified = false;
  let modifyReason = "";

  if (cats.includes("flowers") && FLOWERS_BLOCKED_TYPES.has(primaryType)) {
    const idx = cats.indexOf("flowers");
    cats.splice(idx, 1);
    modified = true;
    modifyReason = `Rules: stripped 'flowers' from primary_type '${primaryType}'`;
  }

  // 8. Delivery-only florist detection (conservative: must match pattern AND not be a florist)
  if (
    cats.includes("flowers") &&
    primaryType !== "florist" &&
    DELIVERY_ONLY_PATTERNS.some((p) => name.toLowerCase().includes(p))
  ) {
    const idx = cats.indexOf("flowers");
    if (idx >= 0) {
      cats.splice(idx, 1);
      modified = true;
      modifyReason = `Rules: delivery-only pattern in name, not a florist — stripped 'flowers'`;
    }
  }

  if (modified) {
    // If stripping left zero categories AND place was previously approved, reject it
    if (cats.length === 0) {
      return {
        verdict: "reject",
        reason: modifyReason + " — no remaining categories, rejected",
        categories: [],
        stageResolved: 2,
      };
    }
    return { verdict: "modify", reason: modifyReason, categories: cats, stageResolved: 2 };
  }

  return { verdict: "pass" };
}
```

### Change 3: Handle "modify" verdict in `processPlace()` (update lines 348-363)

The current code only handles `reject` and `accept` from the pre-filter. Add `modify`:

```typescript
async function processPlace(place: any): Promise<PlaceResult> {
  // Stage 2: Deterministic
  const preFilter = deterministicFilter(place);
  if (preFilter.verdict !== "pass") {
    return {
      decision: preFilter.verdict === "modify" ? "reclassify" : preFilter.verdict,
      categories: preFilter.categories || [],
      primary_identity: place.primary_type || "unknown",
      confidence: "high",
      reason: preFilter.reason || "",
      evidence: "",
      stage_resolved: preFilter.stageResolved || 2,
      website_verified: false,
      search_results: [],
      cost_usd: 0,
    };
  }

  // Stage 3-5 continue unchanged...
```

### Change 4: New action handler `handleRunRulesFilter` 

Add a new handler that processes places using ONLY Stage 2. No Serper, no GPT.

```typescript
async function handleRunRulesFilter(body: any, userId: string): Promise<Response> {
  const db = getDb();
  const scope = body.scope || "all";
  const batchSize = Math.min(body.batch_size || 100, 200); // larger batches OK — no API calls

  // Build query for matching places
  let countQuery = db.from("place_pool")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  if (scope === "unvalidated") countQuery = countQuery.is("ai_approved", null);
  else if (scope === "failed") countQuery = countQuery.not("ai_validated_at", "is", null).is("ai_approved", null);
  if (body.category) countQuery = countQuery.contains("ai_categories", [body.category]);
  if (body.city_id) countQuery = countQuery.eq("city_id", body.city_id);
  if (body.city) countQuery = countQuery.ilike("city", `%${body.city}%`);

  const { count: totalPlaces, error: countErr } = await countQuery;
  if (countErr) return json({ error: countErr.message }, 500);
  if (!totalPlaces || totalPlaces === 0) return json({ status: "nothing_to_do", total_places: 0 });

  // Create a job record for audit trail
  const { data: job, error: jobErr } = await db
    .from("ai_validation_jobs")
    .insert({
      status: "running",
      scope,
      total_places: totalPlaces,
      processed: 0,
      approved: 0,
      rejected: 0,
      reclassified: 0,
      failed: 0,
      category_filter: body.category || null,
      city_filter: body.city || null,
      dry_run: body.dry_run || false,
      batch_size: batchSize,
      total_batches: Math.ceil(totalPlaces / batchSize),
      estimated_cost_usd: 0, // Free!
      triggered_by: userId,
      started_at: new Date().toISOString(),
      // Mark this as a rules-only run
      stage: "rules_only",
    })
    .select("id")
    .single();
  if (jobErr) return json({ error: jobErr.message }, 500);

  // Process in batches (paginated reads)
  let offset = 0;
  let totalProcessed = 0;
  let totalRejected = 0;
  let totalModified = 0;
  let totalUnchanged = 0;

  while (true) {
    let query = db.from("place_pool")
      .select("id, name, primary_type, types, rating, review_count, website, price_level, ai_categories, ai_approved")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (scope === "unvalidated") query = query.is("ai_approved", null);
    else if (scope === "failed") query = query.not("ai_validated_at", "is", null).is("ai_approved", null);
    if (body.category) query = query.contains("ai_categories", [body.category]);
    if (body.city_id) query = query.eq("city_id", body.city_id);
    if (body.city) query = query.ilike("city", `%${body.city}%`);

    const { data: places, error: fetchErr } = await query;
    if (fetchErr) {
      console.error("Rules filter fetch error:", fetchErr.message);
      break;
    }
    if (!places || places.length === 0) break;

    for (const place of places) {
      const result = deterministicFilter(place);
      totalProcessed++;

      if (result.verdict === "pass") {
        totalUnchanged++;
        continue; // No rule triggered — leave place as-is
      }

      // A rule triggered — write the result
      if (!body.dry_run) {
        if (result.verdict === "reject") {
          totalRejected++;
          await db.from("place_pool").update({
            ai_approved: false,
            ai_categories: [],
            ai_reason: result.reason,
            ai_validated_at: new Date().toISOString(),
          }).eq("id", place.id);
        } else if (result.verdict === "modify") {
          totalModified++;
          await db.from("place_pool").update({
            ai_categories: result.categories,
            ai_reason: result.reason,
            ai_validated_at: new Date().toISOString(),
          }).eq("id", place.id);
        } else if (result.verdict === "accept") {
          totalModified++;
          await db.from("place_pool").update({
            ai_approved: true,
            ai_categories: result.categories,
            ai_reason: result.reason,
            ai_validated_at: new Date().toISOString(),
          }).eq("id", place.id);
        }

        // Audit trail in ai_validation_results
        await db.from("ai_validation_results").insert({
          job_id: job.id,
          place_id: place.id,
          decision: result.verdict === "modify" ? "reclassify" : result.verdict,
          previous_categories: place.ai_categories || [],
          new_categories: result.categories || [],
          primary_identity: place.primary_type || "unknown",
          confidence: "high",
          reason: result.reason,
          evidence: "",
          stage_resolved: 2,
          website_verified: false,
          search_results: null,
          cost_usd: 0,
        });
      } else {
        // Dry run — still count
        if (result.verdict === "reject") totalRejected++;
        else totalModified++;
      }
    }

    offset += batchSize;
  }

  // Finalize job
  await db.from("ai_validation_jobs").update({
    status: "completed",
    stage: "complete",
    processed: totalProcessed,
    rejected: totalRejected,
    reclassified: totalModified,
    approved: totalProcessed - totalRejected - totalModified,
    cost_usd: 0,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id);

  return json({
    status: "completed",
    run_id: job.id,
    total_processed: totalProcessed,
    rejected: totalRejected,
    modified: totalModified,
    unchanged: totalUnchanged,
    cost_usd: 0,
    dry_run: body.dry_run || false,
  });
}
```

### Change 5: Register the new action in the serve handler

Add to the switch statement (after line 1048):

```typescript
case "run_rules_filter": return handleRunRulesFilter(body, authResult.userId);
```

### Change 6: Update SYSTEM_PROMPT (GPT prompt)

Three changes to the prompt text:

**6a. Add to FINE_DINING definition (after "When genuinely uncertain, default to casual_eats"):**

Replace:
```
When genuinely uncertain, default to casual_eats.
```
With:
```
When genuinely uncertain AND price is MODERATE or INEXPENSIVE or unknown, default to casual_eats. When price is EXPENSIVE or VERY_EXPENSIVE with rating 4.0+, lean toward fine_dining — most high-end restaurants don't advertise "Michelin" or "tasting menu" in their Google snippets.
```

**6b. Add to FINE_DINING definition (after the chain rule paragraph):**

Add:
```
PRICE_LEVEL_VERY_EXPENSIVE is a very strong signal. Unless the place is clearly casual (food hall, buffet, themed chain, sports bar), a VERY_EXPENSIVE restaurant with 4.0+ rating should get fine_dining.
```

**6c. Add a new worked example (after Example 17):**

```
Example 18: "The Ruxton Steakhouse" type:steak_house price:PRICE_LEVEL_VERY_EXPENSIVE rating:4.4 → {"d":"accept","c":["fine_dining"],"pi":"upscale steakhouse","w":true,"r":"VERY_EXPENSIVE steakhouse with high rating — fine_dining","f":"high"}

Example 19: "Fogo de Chão Brazilian Steakhouse" type:brazilian_restaurant price:PRICE_LEVEL_EXPENSIVE rating:4.8 → {"d":"accept","c":["fine_dining","casual_eats"],"pi":"upscale Brazilian steakhouse chain","w":true,"r":"EXPENSIVE chain steakhouse with exceptional rating — fine_dining + casual_eats","f":"high"}
```

---

## Admin UI Changes

### File: `mingla-admin/src/pages/AIValidationPage.jsx`

### Change 1: Add rules filter state to PipelineTab

Add to the state declarations (after line 370):

```jsx
const [rulesRunning, setRulesRunning] = useState(false);
const [rulesResult, setRulesResult] = useState(null);
```

### Change 2: Add `handleRunRulesFilter` function

Add after `handleStart` (after line 459):

```jsx
const handleRunRulesFilter = async () => {
  if (!selectedCityId) { toast({ variant: "warning", title: "Select a city first" }); return; }
  setRulesRunning(true);
  setRulesResult(null);
  try {
    const data = await invoke({
      action: "run_rules_filter",
      scope,
      city_id: selectedCityId,
      city: cityName,
      category: scope === "category" ? category : undefined,
      dry_run: dryRun,
    });
    if (data.status === "nothing_to_do") {
      toast({ variant: "info", title: "No places to process with current filters" });
      return;
    }
    setRulesResult(data);
    toast({
      variant: "success",
      title: `Rules filter complete — ${fmt(data.rejected)} rejected, ${fmt(data.modified)} modified, ${fmt(data.unchanged)} unchanged`,
    });
    if (onRefresh) onRefresh();
  } catch (err) {
    toast({ variant: "error", title: "Rules filter failed", description: err.message });
  } finally {
    if (mountedRef.current) setRulesRunning(false);
  }
};
```

### Change 3: Add the "Run Rules Filter" button and results display

Add immediately BEFORE the existing "Start Verification" button (before line 762). 
Place inside the same `<div className="space-y-4">`, after the dry run checkbox:

```jsx
{/* Rules Filter Button */}
<Button variant="secondary" icon={Shield} onClick={handleRunRulesFilter}
  disabled={rulesRunning || !preview?.places_to_process}
  loading={rulesRunning}
  className="w-full">
  {rulesRunning
    ? "Running Rules Filter..."
    : `Run Rules Filter — Free (${fmt(preview?.places_to_process || 0)} places)`}
</Button>
<p className="text-xs text-[var(--color-text-tertiary)] -mt-2">
  Applies hardcoded rules only (blocked types, category corrections, fine dining promotion). No AI credits used.
</p>

{/* Rules Filter Results */}
{rulesResult && (
  <div className="bg-[var(--color-success-50)] border border-[var(--color-success-200)] rounded-lg p-4">
    <p className="text-sm font-semibold text-[var(--color-success-700)] mb-2">Rules Filter Complete</p>
    <div className="grid grid-cols-4 gap-3 text-center">
      <div>
        <p className="text-lg font-semibold text-[var(--color-text-primary)]">{fmt(rulesResult.total_processed)}</p>
        <p className="text-xs text-[var(--color-text-secondary)]">Processed</p>
      </div>
      <div>
        <p className="text-lg font-semibold text-[var(--color-error-600)]">{fmt(rulesResult.rejected)}</p>
        <p className="text-xs text-[var(--color-text-secondary)]">Rejected</p>
      </div>
      <div>
        <p className="text-lg font-semibold text-[var(--color-info-600)]">{fmt(rulesResult.modified)}</p>
        <p className="text-xs text-[var(--color-text-secondary)]">Modified</p>
      </div>
      <div>
        <p className="text-lg font-semibold text-[var(--color-text-tertiary)]">{fmt(rulesResult.unchanged)}</p>
        <p className="text-xs text-[var(--color-text-secondary)]">Unchanged</p>
      </div>
    </div>
    {rulesResult.dry_run && (
      <p className="text-xs text-[var(--color-warning-600)] mt-2 font-medium">⚠ Dry run — no changes written</p>
    )}
  </div>
)}
```

Import `Shield` from lucide-react at the top of the file (where other icons are imported).

### Change 4: Update preview to show $0 cost for rules filter

The existing preview shows cost and time estimates for full AI runs. The "Run Rules Filter"
button doesn't need cost estimation since it's free. The preview section already shows
places count which is sufficient. No change needed to the preview — the button label
itself says "Free".

---

## SQL Cleanup Script (One-Time)

Run AFTER deploying the code changes. This cleans existing bad data.

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
-- (Do NOT reject — they may have other valid categories)
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

**DO NOT run:**
- Any update touching supermarket/hypermarket flowers (needs research)
- Any fine_dining promotion via SQL (run through the rules filter button instead, so there's
  an audit trail in `ai_validation_results`)

---

## Implementation Order

1. **Edge function: constants** — Add `BLOCKED_PRIMARY_TYPES`, `FLOWERS_BLOCKED_TYPES`,
   `DELIVERY_ONLY_PATTERNS`, `RESTAURANT_TYPES`
2. **Edge function: PreFilterResult interface** — Add `"modify"` to verdict union
3. **Edge function: deterministicFilter()** — Replace with new implementation
4. **Edge function: processPlace()** — Handle `"modify"` verdict
5. **Edge function: handleRunRulesFilter()** — New handler
6. **Edge function: serve handler** — Register `"run_rules_filter"` action
7. **Edge function: SYSTEM_PROMPT** — Update fine_dining text + add worked examples
8. **Admin UI: state + handler** — Add `rulesRunning`, `rulesResult`, `handleRunRulesFilter`
9. **Admin UI: button + results** — Add "Run Rules Filter" button and results card
10. **Deploy edge function** — `supabase functions deploy ai-verify-pipeline`
11. **Run SQL cleanup** — Execute the 4 cleanup queries
12. **Run rules filter** — Click "Run Rules Filter" on `scope: all` for each active city

---

## Test Cases

| # | Scenario | Input | Expected | Layer |
|---|----------|-------|----------|-------|
| T-01 | Rules filter rejects gas station | Place: Shell, primary_type: gas_station | ai_approved=false, reason starts with "Rules:" | Edge function |
| T-02 | Rules filter rejects cemetery | Place: Evergreen Cemetery, primary_type: cemetery | ai_approved=false | Edge function |
| T-03 | Rules filter strips flowers from garden center | Place: Home Depot Garden Center, ai_categories: [flowers, nature_views] | ai_categories: [nature_views], flowers removed | Edge function |
| T-04 | Rules filter strips flowers from restaurant | Place: Blossom Garden (meal_takeaway), ai_categories: [casual_eats, flowers] | ai_categories: [casual_eats] | Edge function |
| T-05 | Rules filter does NOT strip flowers from florist | Place: Boule de Neige Fleuriste, primary_type: florist | ai_categories unchanged | Edge function |
| T-06 | Rules filter does NOT strip flowers from supermarket | Place: Carrefour, primary_type: supermarket, ai_categories: [groceries, flowers] | UNCHANGED — supermarkets out of scope | Edge function |
| T-07 | Underscore normalization | Place with primary_type: car_wash | Rejected via utilitarian keyword | Edge function |
| T-08 | Fine dining promotion | Place: VERY_EXPENSIVE, 4.4★, steak_house | fine_dining added to ai_categories | Edge function |
| T-09 | Fine dining NOT promoted for low rating | Place: VERY_EXPENSIVE, 3.5★, restaurant | No fine_dining added (below 4.0 threshold) | Edge function |
| T-10 | Fine dining NOT promoted for MODERATE price | Place: MODERATE, 4.8★, restaurant | No promotion (not VERY_EXPENSIVE) | Edge function |
| T-11 | Minimum-data guard | Place: rating=null, reviews=0, website=null | Rejected | Edge function |
| T-12 | Minimum-data guard allows rating-only | Place: rating=4.5, reviews=0, website=null | NOT rejected (has rating) | Edge function |
| T-13 | Rules filter $0 cost | Run on 50 places | ai_validation_results.cost_usd = 0 for all, no Serper/OpenAI logs | Edge function |
| T-14 | Rules filter dry run | Run with dry_run: true | response.dry_run=true, no place_pool updates | Edge function |
| T-15 | Full pipeline still works | Run full AI validation on 5 places | Serper + GPT called, results written normally | Edge function |
| T-16 | Admin button visible | Load Pipeline tab | "Run Rules Filter — Free" button visible above "Start Verification" | Admin UI |
| T-17 | Admin results display | Run rules filter | Stats card shows processed/rejected/modified/unchanged | Admin UI |
| T-18 | Delivery-only detection | Place: "Barcelona Flower Delivery", primary_type: gift_shop | flowers stripped | Edge function |
| T-19 | Delivery keyword false positive avoidance | Place: "Bouquet & Delivery Florist", primary_type: florist | flowers NOT stripped (primary_type is florist) | Edge function |
| T-20 | GPT prompt respects new fine_dining guidance | Send VERY_EXPENSIVE steakhouse to GPT | GPT returns fine_dining | Stage 5 |

---

## Regression Prevention

1. **Structural: `BLOCKED_PRIMARY_TYPES` is a Set** — O(1) lookup, easy to add new types
   in the future. One location, one source of truth.
2. **The underscore normalization is applied globally** — any future Google type with
   underscores will automatically match.
3. **The rules filter creates audit trail entries** — every decision is in
   `ai_validation_results` with `stage_resolved: 2` and `cost_usd: 0`, making it easy
   to distinguish rules-filter results from AI results.
4. **The `stage` field on `ai_validation_jobs`** is set to `"rules_only"` for rules-filter
   runs, allowing filtering in the admin UI and analytics.

---

## Handoff to Implementor

1. Read this spec completely before writing any code.
2. Start with the edge function changes (steps 1-7) — they are the core.
3. The admin UI changes (steps 8-9) are straightforward — one button, one handler, one results card.
4. Deploy the edge function BEFORE running SQL cleanup.
5. Run SQL cleanup in the specified order (blocked types first, then flowers strip, then empty-category cleanup, then no-data guard).
6. After cleanup, use the admin "Run Rules Filter" button on `scope: all` to apply fine dining promotion. This creates the audit trail.
7. Do NOT touch supermarket flowers. Do NOT implement mutual exclusivity. These are out of scope.
