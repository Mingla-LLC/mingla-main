# Investigation Report: Place Pool Data Quality — ORCH-0425, 0426, 0427

**Investigator:** Forensics Agent
**Date:** 2026-04-14
**Confidence:** HIGH — all root causes traced to exact code lines, verified against live data

---

## Layman Summary

Three problems, one shared root cause: **the AI validation pipeline's safety net has holes**.

When a place enters the pool, it goes through a 5-stage pipeline. Stage 2 is a fast,
free filter that catches obvious garbage (fast food, gyms, dentists) before the expensive
AI even sees it. But Stage 2 has two bugs:

1. **Underscore/space mismatch** — Google calls it `gas_station` (underscore), but our
   blacklist checks for "gas station" (space). String matching fails silently. Gas stations,
   car dealers, and laundromats walk right through.

2. **Missing venue types** — Garden centers, cemeteries, and funeral homes aren't in any
   blacklist at all. So a garden center named "Home Depot Garden Center" sails past Stage 2,
   then GPT sees "florist" in its Google types array and happily tags it as flowers.

For fine dining: GPT is told "when uncertain, default to casual_eats." Combined with no
deterministic promotion rule for VERY_EXPENSIVE restaurants, this means a $200/head
steakhouse gets "casual_eats" because GPT doesn't find the word "Michelin" in the search
results.

**Fix required:** Harden Stage 2 with type-based blocking, add a deterministic fine_dining
promotion rule, then re-run validation on affected places.

---

## Investigation Manifest

| # | File | Layer | Purpose |
|---|------|-------|---------|
| 1 | `supabase/functions/ai-verify-pipeline/index.ts` | Code | Full 5-stage pipeline — pre-filter, search, website, GPT, DB write |
| 2 | `supabase/functions/_shared/seedingCategories.ts` | Code | Google Nearby Search type configs — what gets seeded |
| 3 | `supabase/functions/_shared/categoryPlaceTypes.ts` | Code | Category names, type mappings, per-category exclusions |
| 4 | `.claude/skills/mingla-categorizer/references/category-mapping.md` | Docs | Authoritative spec v4.0 |
| 5 | Live DB queries (orchestrator) | Data | Confirmed all counts against production data |

---

## Finding 1: ORCH-0425 — Flowers Category Pollution

### 🔴 Root Cause A: Seeding exclusions not applied during AI validation

**File:** `ai-verify-pipeline/index.ts` (entire `deterministicFilter()` function, lines 305-330)
**File:** `seedingCategories.ts` (flowers config, lines 378-404)

**What happens:**
The seeding config correctly lists `garden_center` in `excludedPrimaryTypes` for flowers
(line 394). This exclusion is applied during the Google Nearby Search seeding step — it
prevents garden centers from being seeded *as flowers candidates*.

BUT: garden centers enter the pool via OTHER categories. For example, `nature_views`
includes `garden` in its `includedTypes` (line 48). A garden center gets seeded as a
nature candidate, enters the pool, then the AI pipeline processes it. The AI pipeline's
`deterministicFilter()` does NOT check per-category exclusions. It only checks:
- `FAST_FOOD_BLACKLIST` (line 310) — name matching only
- `EXCLUSION_KEYWORDS` (lines 314-317) — name + primaryType text matching
- `CASUAL_CHAIN_DEMOTION` (lines 320-327) — name matching only

None of these catch `garden_center` as a primary_type. GPT then sees `florist` in the
place's `types` array (Google often lists both `garden_center` and `florist` for nurseries)
and assigns `flowers`.

**What it should do:**
The AI pipeline should block specific primary_types from receiving specific categories.
A place with `primary_type = garden_center` should NEVER get the `flowers` category.

**Causal chain:**
1. Garden center seeded via nature_views (primary_type: garden_center, types include florist)
2. AI pipeline stage 2 checks name/keywords — no match, passes through
3. GPT sees `florist` in types array → assigns `flowers`
4. User sees "Home Depot Garden Center" in their Flowers deck

**Scope:** 26 garden centers + 1 cemetery + 1 funeral home + 1 farm + 1 bonsai supplier
= **30 places** that should never have flowers

### 🔴 Root Cause B: GPT over-applies flowers to supermarkets

**File:** `ai-verify-pipeline/index.ts`, SYSTEM_PROMPT line 97
**Code:**
```
FLOWERS: Florists, flower shops, flower bars. Large supermarkets with staffed floral
departments (like Whole Foods) qualify for BOTH flowers and groceries.
```

**What happens:**
The prompt says "large supermarkets with staffed floral departments" but GPT has no way to
know if a specific Carrefour Market has a staffed floral section. It defaults to "yes" for
ALL Carrefour/hypermarkets because Worked Example 1 shows Whole Foods → `["groceries","flowers"]`.
GPT generalizes: supermarket = flowers.

**What it should do:**
The flowers category for supermarkets should be restricted to a **named allowlist** of
chains known to have staffed floral departments (Whole Foods, Publix, Waitrose, H-E-B,
Wegmans). Generic supermarkets/hypermarkets should NOT get flowers.

**Scope:** 169 supermarkets/hypermarkets incorrectly tagged flowers

### 🟠 Contributing Factor C: Delivery-only florists not filtered

**File:** `ai-verify-pipeline/index.ts`, EXCLUSION_KEYWORDS line 44
**Code:** `delivery: ["ghost kitchen","delivery only","cloud kitchen","virtual kitchen"]`

**What happens:**
The delivery exclusion keywords only catch "delivery only", "ghost kitchen", etc. A florist
named "Barcelona Flower Delivery" doesn't match because "delivery" alone isn't a keyword —
only "delivery only" (two words) is. The spec says delivery-only florists (no storefront)
should be rejected.

**Scope:** 9 delivery-named florists

### 🔵 Observation D: Cemetery and funeral home as flowers

A cemetery (Evergreen Cemetery) and funeral home (La Pensée Fleurs) got tagged flowers.
Both have `florist` or flower-related names/types. GPT saw "flowers" signals and assigned
the category. These are covered by Root Cause A fix (primary_type blocking).

---

## Finding 2: ORCH-0426 — Weird Places in Pool

### 🔴 Root Cause E: Underscore/space mismatch in exclusion keyword matching

**File:** `ai-verify-pipeline/index.ts`, lines 305-317
**Code:**
```typescript
const checkText = `${name} ${primaryType}`.toLowerCase();
// ...
if (keywords.some((kw) => checkText.includes(kw.toLowerCase()))) {
```

**What happens:**
Google returns primary_type with underscores: `gas_station`, `car_dealer`, `funeral_home`.
The `EXCLUSION_KEYWORDS.utilitarian` list uses spaces: `"gas station"`, `"car dealership"`.

When `checkText = "shell gas_station"`, the check `"shell gas_station".includes("gas station")`
returns **false** because `gas_station` ≠ `gas station`.

This affects every keyword that should match a Google primary_type:
| Keyword | Google type | Match? |
|---------|-------------|--------|
| "gas station" | gas_station | ❌ NO |
| "car dealership" | car_dealer | ❌ NO (also different word) |
| "laundromat" | laundry | ❌ NO (different word entirely) |
| "car wash" | car_wash | ❌ NO |
| "parking garage" | parking | ❌ NO (different word) |
| "auto repair" | auto_repair | ❌ NO |
| "storage unit" | storage | ⚠️ Partial — "storage" matches but "storage unit" doesn't |

**What it should do:**
Either normalize underscores to spaces before matching, OR add underscore variants to the
keywords list, OR (better) add a separate `EXCLUDED_PRIMARY_TYPES` set that checks
`primary_type` directly.

**Causal chain:**
1. Gas station seeded (nature_views or drink includes nearby types)
2. Stage 2: "gas station" keyword doesn't match "gas_station" primary_type
3. GPT sees the place, finds it has food/drinks → assigns casual_eats/drink
4. User sees "Shell" and "LUKOIL" in their date cards

**Scope:** 5 gas stations + 1 car dealer + 2 laundromats = **8 confirmed**,
potentially more with car_wash, auto_repair, parking types

### 🔴 Root Cause F: Missing venue types in exclusion lists

**File:** `ai-verify-pipeline/index.ts`, EXCLUSION_KEYWORDS (lines 36-49)

**What's missing from ALL exclusion lists:**
- `cemetery` / `funeral_home` — never a date spot
- `garden_center` — not in exclusion keywords
- `lake` with no meaningful name — not filtered (though most lakes are fine)

**Scope:** 2 cemeteries + 1 funeral home + 1 car dealer (also missing)

### 🟡 Hidden Flaw G: Lake "27513" tagged fine_dining + wellness

A lake with the name "27513" (a zip code) was tagged `fine_dining + wellness`. This is a
pure GPT hallucination — the lake has no rating, no reviews, no website. GPT received a
nearly empty fact sheet and fabricated categories.

**Fix:** Add a minimum-data guard: if a place has no rating AND no reviews AND no website,
the deterministic filter should reject it (or at minimum, flag for manual review instead of
letting GPT hallucinate).

### 🟡 Hidden Flaw H: Churches as live_performance/creative_arts — gray area

15 churches are in the pool. Some are genuinely date-worthy cultural landmarks (Notre-Dame,
Sagrada Familia, Westminster Abbey → creative_arts). Some host concerts (St Martin-in-the-Fields
→ live_performance). A few are regular parish churches tagged live_performance with no
evidence of public performances.

**Recommendation:** Keep landmark churches (rating 4.5+, tourist_attraction in types).
Filter regular worship-only churches via a deterministic check: `primary_type = church AND
NOT types.includes('tourist_attraction') AND NOT types.includes('cultural_landmark')` → reject.

---

## Finding 3: ORCH-0427 — Fine Dining Undercount

### 🔴 Root Cause I: No deterministic promotion for VERY_EXPENSIVE restaurants

**File:** `ai-verify-pipeline/index.ts`, `deterministicFilter()` lines 305-330

**What happens:**
The deterministic filter has a DEMOTION rule (casual chain → downgrade from fine_dining,
line 320-327) but NO PROMOTION rule. There is no code path that says "if price_level is
VERY_EXPENSIVE and rating is 4.3+, promote to fine_dining."

The only way a place gets fine_dining is if:
1. Its `primary_type` is `fine_dining_restaurant` (Google assigns this), OR
2. GPT decides to assign `fine_dining` based on the fact sheet

For VERY_EXPENSIVE steakhouses like "The Ruxton Steakhouse" (4.4★), GPT sees the fact
sheet, doesn't find explicit "Michelin" or "tasting menu" in the search evidence, and
defaults to casual_eats per the prompt instruction: "When genuinely uncertain, default
to casual_eats."

**What it should do:**
Add a deterministic rule in Stage 2:
- `price_level = PRICE_LEVEL_VERY_EXPENSIVE` + `rating >= 4.0` + restaurant-type primary_type
  → auto-add `fine_dining` to categories (alongside whatever GPT assigns)

**Scope:** 8 VERY_EXPENSIVE + estimated ~50-100 EXPENSIVE that should be fine_dining

### 🟠 Contributing Factor J: GPT prompt biases toward casual_eats

**File:** `ai-verify-pipeline/index.ts`, SYSTEM_PROMPT line 73

**Code:**
```
When genuinely uncertain, default to casual_eats.
```

Combined with the fine_dining definition requiring specific luxury keywords ("upscale",
"elegant", "tasting menu", "sommelier", "Michelin", "acclaimed", "refined"), GPT has a
strong bias toward casual_eats. The worked examples don't include a single fine_dining
classification — every restaurant example is casual_eats or casual_eats + drink.

**What it should do:**
1. Add a worked example showing a VERY_EXPENSIVE restaurant → fine_dining
2. Change the uncertainty instruction to: "When genuinely uncertain AND price_level is
   EXPENSIVE or VERY_EXPENSIVE, lean toward fine_dining. Otherwise default to casual_eats."
3. Add: "PRICE_LEVEL_VERY_EXPENSIVE is a very strong signal for fine_dining. Most
   VERY_EXPENSIVE restaurants are fine dining unless they are clearly casual (food halls,
   buffets, themed restaurants)."

### 🟡 Hidden Flaw K: Dual-tagging fine_dining + casual_eats

Many places (Aba Austin, Air Restaurant, Alla Vita, etc.) receive BOTH `fine_dining` and
`casual_eats`. From the user's perspective, this means the same restaurant appears in both
categories. This dilutes the fine_dining experience — swiping through fine dining shouldn't
show the same places you see in casual eats.

**Recommendation:** Treat fine_dining and casual_eats as mutually exclusive. If a place
gets fine_dining, strip casual_eats. This is a product decision — flag for user.

---

## Blast Radius

| What's affected | Impact |
|----------------|--------|
| Flowers deck | 96% garbage — users see garden centers, supermarkets, cemeteries |
| Casual Eats deck | Bloated with 306+ restaurants that should be fine_dining |
| Fine Dining deck | Thin at 918 — missing hundreds of legitimately upscale restaurants |
| All decks | 82+ non-date-worthy venues (gas stations, car dealers, etc.) leak through |
| User trust | Seeing a gas station or funeral home in date suggestions erodes confidence |

---

## Fix Strategy (Direction Only)

### Phase 1: Harden the deterministic pre-filter (Stage 2)

1. **Fix underscore/space mismatch:** Normalize `primary_type` by replacing underscores
   with spaces before keyword matching. One-line fix:
   `const checkText = \`\${name} \${primaryType.replace(/_/g, ' ')}\`.toLowerCase();`

2. **Add EXCLUDED_PRIMARY_TYPES set:** A new Set of primary_types that should NEVER be
   approved regardless of name:
   ```
   cemetery, funeral_home, gas_station, car_dealer, car_wash, car_rental,
   auto_repair, parking, storage, laundry, locksmith, plumber, electrician,
   roofing_contractor, insurance_agency, real_estate_agency, accounting,
   post_office, fire_station, police, courthouse, prison
   ```
   Check: `if (EXCLUDED_PRIMARY_TYPES.has(primaryType)) → reject`

3. **Add per-category type blocks:** A map of `category → blocked_primary_types`:
   ```
   flowers: [garden_center, garden, farm, supplier, cemetery, funeral_home,
             restaurant, meal_takeaway, bar, food_store]
   ```
   Applied AFTER GPT classification: strip blocked categories from GPT output.

4. **Add minimum-data guard:** If `!rating && !review_count && !website` → reject
   (prevents GPT hallucination on empty fact sheets).

### Phase 2: Fix fine_dining classification

5. **Deterministic promotion rule:** In Stage 2, if `price_level = VERY_EXPENSIVE` AND
   `rating >= 4.0` AND primary_type is a restaurant type → add `fine_dining` to categories.

6. **Update GPT prompt:**
   - Add worked example: VERY_EXPENSIVE restaurant → fine_dining
   - Strengthen price_level as a signal for fine_dining
   - Remove or qualify "when uncertain, default to casual_eats"

7. **Mutual exclusivity rule:** If categories include `fine_dining`, strip `casual_eats`.
   (Needs product confirmation.)

### Phase 3: Clean existing data

8. **Flowers cleanup:** Remove flowers tag from all garden_centers, non-allowlisted
   supermarkets, delivery-only florists, cemeteries, funeral homes.

9. **Weird venue cleanup:** Reject all gas_station, car_dealer, cemetery, funeral_home
   places in pool.

10. **Fine dining re-evaluation:** Re-run pipeline on all EXPENSIVE/VERY_EXPENSIVE
    casual_eats-only places with the updated rules.

### Re-run Required?

YES — pipeline code fix alone only prevents future bad data. Existing 267 flowers places,
82 weird venues, and 306 misclassified restaurants need re-processing.

**Recommended approach:** SQL cleanup for obvious cases (garden_center → strip flowers,
gas_station → set ai_approved=false), then re-run AI pipeline only for fine_dining
re-evaluation (306 places, ~$0.21 cost).

---

## Invariant Violations

- **INV-009: No fabricated data** — A lake named "27513" was given fine_dining + wellness
  with zero evidence. GPT fabricated categories on an empty fact sheet.
- **INV-013: Exclusion consistency** — Garden centers are excluded from flowers seeding
  but not from flowers classification. Two systems disagree.

---

## Discoveries for Orchestrator

1. **The underscore/space bug affects ALL exclusion keywords**, not just the three issues
   reported. Any Google type with underscores could bypass the filter. Full audit of
   EXCLUSION_KEYWORDS vs actual Google types needed.
2. **Hypermarkets not in seeding exclusion but should be** — `hypermarket` is in
   seedingCategories flowers excludedPrimaryTypes, but 169 hypermarkets still got tagged
   flowers by the AI pipeline (cross-category seeding + no per-category type blocks in AI).
3. **The delivery keyword "delivery only" (two words) is too narrow** — should also check
   for "flower delivery", "same day delivery", "delivery service" patterns.
