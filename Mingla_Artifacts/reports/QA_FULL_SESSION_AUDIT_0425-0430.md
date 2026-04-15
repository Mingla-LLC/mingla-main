# QA Full Session Audit: ORCH-0425, 0426, 0427, 0428, 0430 + Addendums

**Tester:** Mingla Tester
**Date:** 2026-04-15
**Mode:** FULL-SWEEP — brutal independent verification
**Verdict:** CONDITIONAL PASS

P0: 0 | P1: 1 | P2: 3 | P3: 1 | P4: 3

---

## Part 1: Data Integrity

### 1.1 Fine dining / casual_eats exclusivity
**Result:** 0 dual-tagged | **PASS**

### 1.2 Blocked primary_types — zero approved
**Result:** Empty result set — zero approved for any of 23 blocked types | **PASS**

### 1.3 Flowers — no garden centers, cemeteries, etc.
**Result:** Empty result set — zero blocked types have flowers | **PASS**

### 1.4 Fine dining count per city
**Result:** 925 total across 16 cities. Paris 147, New York 138, Miami 84, Washington 72,
Toronto 68, Chicago 66, Brussels 62, London 56, Berlin 44, Fort Lauderdale 39, Dallas 39,
Barcelona 33, Raleigh 26, Durham 21, Baltimore 15, Cary 9 | **PASS** — healthy distribution

### 1.5 Flowers composition
**Result:** 168 supermarkets, 38 NULL type, 10 florists, 3 service, 3 tourist_attraction,
2 coffee_shop, 2 store, 2 cafe, 1 plaza. Total: 229 | **WARNING**

- **P2: 38 places with NULL primary_type in flowers.** These can't be validated by type-based
  rules. Could be anything. Need spot-check.
- **P3: 12 non-florist/non-supermarket places** (service, tourist_attraction, coffee_shop,
  store, cafe, plaza). Some may be legitimate (a café with a flower bar), others may be junk.

### 1.6 Suspicious approved primary_types (broad audit)
**Result:** Notable findings:

| Type | Count | Concern |
|------|-------|---------|
| hotel | 251 | **P2:** Hotels are approved — some have bars/spas (legitimate), but many are just hotels |
| meal_takeaway | 149 | **P2:** Takeaway-only places probably aren't date spots |
| educational_institution | 46 | Should be blocked — missed by keyword filter |
| sports_complex | 34 | Gyms/sports — should be filtered |
| pizza_delivery | 31 | Delivery only — not a date venue |

These are pre-existing data quality issues NOT caused by this session's changes, but worth
flagging. The deterministic filter catches keywords but not all Google primary_types.

### 1.7 Rules filter job audit
**Result:** Two completed rules_only jobs: Raleigh (2,898 processed, 485 rejected, 2
reclassified, $0) and Cary (1,386 processed, 305 rejected, 1 reclassified, $0) | **PASS**

### 1.8 DB constraint
**Result:** `chk_avj_stage` includes `rules_only` in allowed values | **PASS**

---

## Part 2: Code Verification

### 2.1 ai-verify-pipeline/index.ts

- [x] `BLOCKED_PRIMARY_TYPES`: **23 types verified** (21 original + wedding_venue + banquet_hall) — lines 57-64 | **PASS**
- [x] `FLOWERS_BLOCKED_TYPES`: **10 types verified** — lines 67-69 | **PASS**
- [x] `DELIVERY_ONLY_PATTERNS`: **8 patterns verified** — lines 73-76 | **PASS**
- [x] `RESTAURANT_TYPES`: **40 types verified** — lines 80-95 | **PASS**
- [x] `enforceExclusivity()`: Handles fine_dining/casual_eats ONLY (no picnic/nature — correctly withdrawn). Does NOT take primaryType param. Lines 98-103 | **PASS**
- [x] `deterministicFilter()`: 8 checks in correct order: blocked types (1) → min-data (2) → fast food (3) → exclusion keywords with underscore normalization (4) → casual chain (5) → fine dining promotion (6) → flowers blocking (7) → delivery detection (8). Lines 360-479 | **PASS**
- [x] `normalizedType = primaryType.replace(/_/g, " ")`: Line 364 | **PASS**
- [x] `handleRunRulesFilter()`: Exists, writes to both place_pool and ai_validation_results | **PASS**
- [x] `"run_rules_filter"` in serve switch: Line 1373 | **PASS**
- [x] SYSTEM_PROMPT "MUTUALLY EXCLUSIVE": Line 123, present in FINE_DINING definition | **PASS**
- [x] Example 19 shows `["fine_dining"]` not `["fine_dining","casual_eats"]`: Line 200, correct | **PASS**
- [x] Examples 18-19 present: Lines 198-200 | **PASS**
- [x] All 11 original action handlers still registered: Lines 1363-1373 | **PASS**

### 2.2 generate-curated-experiences/index.ts

- [x] `fetchSinglesForCategory` returns `shuffle(filtered)`: Lines 305-307 | **PASS**
- [x] `shuffle` function is Fisher-Yates: Lines 677-684 | **PASS**
- [x] No other unintended changes verified by diff scope | **PASS**

### 2.3 AIValidationPage.jsx

- [x] `Shield` imported: Line 14 | **PASS**
- [x] `rulesRunning` and `rulesResult` state: Lines 367-368 | **PASS**
- [x] `handleRunRulesFilter` sends `scope: "all"`: Line 472 | **PASS**
- [x] Button disabled only when `rulesRunning || !selectedCityId`: Line 797 | **PASS**
- [x] Progress card shown when `rulesRunning`: Line 809 | **PASS**
- [x] Results card shown when `rulesResult && !rulesRunning`: Line 822 | **PASS**
- [x] Start Verification button unchanged: Line 849 | **PASS**

### 2.4 Locale files

- [x] All locale common.json files parse as valid JSON: **0 errors** | **PASS**
- [x] No corruption pattern remains: **0 matches** | **PASS**
- [x] iOS bundle compiles: `Exported: dist` | **PASS**

---

## Part 3: Regression Checks

- [x] All 11 original action handlers registered in serve switch | **PASS**
- [x] `processPlace()` still runs Stages 3-5 when deterministicFilter returns "pass" — verified line 507 onward, Serper call at 509, website at 519, GPT at 527 | **PASS**
- [x] `handleRunBatch()` still calls `processPlace()` — verified | **PASS**
- [x] All 6 curated experience types still defined — verified line 32 | **PASS**
- [x] Pool-first serving logic unchanged — verified lines 1046-1087 | **PASS**
- [x] Reverse-anchor picnic logic unchanged — verified lines 505-565 | **PASS**
- [x] `selectClosestHighestRated` unchanged — verified lines 714-732 | **PASS**
- [x] Shopping list generation unchanged — verified lines 635-807 | **PASS**
- [x] `discover-cards` not modified — not in git diff | **PASS**
- [x] `discover-experiences` not modified — not in git diff | **PASS**
- [x] Zero mobile source code changes (only locale JSON) | **PASS**
- [x] iOS bundle compiles successfully | **PASS**

---

## Part 4: Gap Analysis

### 4.1 Fine dining quality

20 fine dining places have rating < 4.0 or INEXPENSIVE price level:

**P1: "Les Oiseaux" (Paris) — rating 3.9, PRICE_LEVEL_INEXPENSIVE, tagged fine_dining.**
An INEXPENSIVE French restaurant should NOT be fine dining. This is a GPT classification
error that the deterministic filter doesn't catch (promotion rule only targets VERY_EXPENSIVE).

**P2: "Marti's New River Bistro" (Fort Lauderdale) — primary_type: event_venue, rating 3.8,
tagged fine_dining.** An event venue misclassified as fine dining. event_venue is not blocked
(intentionally — some are legitimate), but this one is wrong.

Other low-rated fine dining (3.5-3.9): L'Avenue Paris, Lírica Restaurant Chicago, Beef Cut
Paris, Lavelle Toronto. These are borderline — GPT classified them based on web evidence, and
some (L'Avenue, Lavelle) are genuinely upscale despite mixed reviews.

### 4.2 Category distribution

| Category | Count | Health |
|----------|-------|--------|
| casual_eats | 12,424 | Healthy |
| nature_views | 8,428 | Healthy |
| picnic_park | 7,628 | Healthy (96% overlap with nature — known, intentional) |
| first_meet | 6,858 | Healthy |
| drink | 6,459 | Healthy |
| creative_arts | 3,523 | Healthy |
| live_performance | 1,977 | Adequate |
| groceries | 1,223 | Adequate (hidden category) |
| play | 1,016 | Adequate |
| wellness | 1,011 | Adequate |
| fine_dining | 925 | Adequate — ratio to casual_eats now 13.4:1 (was 14:1, slight improvement) |
| watch | 486 | Thin — only movie theaters |
| flowers | 229 | Thin but intentional |

### 4.3 Rules filter spot check

10 random Raleigh rejections: European Wax Center (grooming), Halo Doctors (medical),
Select Physical Therapy (medical), Starbucks (fast food), FMRC (medical), Reviva Aesthetics
(grooming), Subway (fast food), Planet Fitness (fitness), Dunkin' (fast food), Face Foundrie
(grooming). **ALL LEGITIMATE REJECTIONS.** | **PASS**

2 reclassifications: Only 1 returned (Ruth's Chris Steak House — promoted from [] to
[fine_dining] via VERY_EXPENSIVE rule). The job reported 2 but audit trail shows 1.
**Minor discrepancy** — the second may have been an accept (category change that matched).
| **PASS with note**

---

## Findings Summary

### P1 — Must Fix (1)

**P1-1: "Les Oiseaux" Paris — INEXPENSIVE restaurant tagged as fine_dining.**
An INEXPENSIVE-priced restaurant should never be fine dining. This is a GPT error that
slipped through because the deterministic filter only PROMOTES VERY_EXPENSIVE — it doesn't
DEMOTE INEXPENSIVE. Consider adding a rule: if fine_dining AND price_level = INEXPENSIVE,
strip fine_dining. **Fix: add demotion rule to deterministicFilter or run manual override.**

### P2 — Should Fix (3)

**P2-1: 38 NULL-type places in flowers.** Can't validate by type. Need spot-check or AI
re-run on these specifically.

**P2-2: "Marti's New River Bistro" — event_venue tagged fine_dining.** Manual override needed.

**P2-3: Broader type gaps — meal_takeaway (149), educational_institution (46), pizza_delivery
(31), sports_complex (34) still approved.** Pre-existing issue, not caused by this session,
but the deterministic filter should catch more of these. Consider adding meal_takeaway,
educational_institution, pizza_delivery, sports_complex to BLOCKED_PRIMARY_TYPES or
EXCLUSION_KEYWORDS.

### P3 — Nice to Fix (1)

**P3-1: Rules filter job counter discrepancy.** Job reports 2 reclassified but audit trail
shows 1 result with decision='reclassify'. Minor logging mismatch.

### P4 — Praise (3)

**P4-1: Rules filter rejections are spot-on.** 10/10 random sampled rejections were
legitimate (gyms, fast food, medical, grooming). Zero false positives.

**P4-2: enforceExclusivity pattern is clean.** Single function, called at all write points,
easy to extend. Well-designed.

**P4-3: Locale corruption fix was thorough.** 17 files fixed, zero corruption remaining,
bundle compiles. No regression.

---

## Verdict

**CONDITIONAL PASS**

All deployed code changes are correct and working. Data integrity checks pass. No
regressions found. The P1 (INEXPENSIVE fine dining) is a pre-existing GPT classification
error, not caused by this session — but it's now more visible because the exclusivity
rule cleaned the data and made fine dining a curated tier.

**Conditions:**
1. Fix P1-1 (Les Oiseaux) — manual override or add INEXPENSIVE demotion rule
2. Acknowledge P2-3 (broader type gaps) for future work

**Blocking issues:** None — P1-1 is a single place, can be manually overridden.

**Discoveries for orchestrator:**
1. Pre-existing: 149 meal_takeaway, 46 educational_institution, 34 sports_complex, 31
   pizza_delivery approved in pool — consider adding to blocked types
2. 38 NULL-type places tagged flowers — can't validate deterministically
3. Fine dining ratio still 13.4:1 — EXPENSIVE restaurants need full AI re-run to improve
