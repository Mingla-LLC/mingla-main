# Investigation: Fine Dining / Casual Eats Mutual Exclusivity (ORCH-0428)

**Date:** 2026-04-14
**Confidence:** HIGH — every write path to ai_categories traced with exact line numbers

---

## Layman Summary

555 restaurants currently appear in both the fine dining and casual eats decks. There are
exactly 5 code paths where categories get written to the database, and 4 of them can
produce dual-tagging. The fix needs a single enforcement function called at all 4 points.

---

## Every Write Path to `ai_categories` in place_pool

| # | Location | Handler | What Writes | Can Dual-Tag? |
|---|----------|---------|-------------|--------------|
| W-1 | Line 896 | `handleRunBatch` → `processPlace` | GPT result categories | **YES** — GPT can return both |
| W-2 | Line 1112 | `handleOverride` | Admin override categories | **YES** — admin can manually set both |
| W-3 | Line 1266 | `handleRunRulesFilter` (reject path) | Empty array `[]` | NO — always empty |
| W-4 | Line 1273 | `handleRunRulesFilter` (modify path) | deterministicFilter result | **YES** — check 6 adds fine_dining without stripping casual_eats |
| W-5 | Line 1281 | `handleRunRulesFilter` (accept path) | deterministicFilter result | **YES** — same as W-4 |

---

## Findings

### 🔴 Root Cause A: deterministicFilter check 6 adds fine_dining without stripping casual_eats

**File:** `ai-verify-pipeline/index.ts:416-431`
**Code:**
```typescript
// 6. Fine dining promotion: VERY_EXPENSIVE + 4.0+ rating + restaurant type
const cats = [...(place.ai_categories || [])];
if (!cats.includes("fine_dining")) {
  cats.push("fine_dining");
  return { verdict: "modify", ... };
}
```
**What it does:** Copies existing categories, adds `fine_dining`, returns. If the place already had `casual_eats`, both are now present.
**What it should do:** After adding `fine_dining`, strip `casual_eats` from the array.
**Causal chain:** Place has `[casual_eats]` → rules filter promotes to fine_dining → categories become `[casual_eats, fine_dining]` → place appears in both decks.
**Verification:** Query `place_pool WHERE price_level = 'PRICE_LEVEL_VERY_EXPENSIVE' AND 'fine_dining' = ANY(ai_categories) AND 'casual_eats' = ANY(ai_categories)`.

### 🔴 Root Cause B: GPT classifyPlace() post-processing has no exclusivity filter

**File:** `ai-verify-pipeline/index.ts:321-326`
**Code:**
```typescript
parsed.c = (parsed.c || []).filter((s: string) => VALID_SLUGS.has(s));
```
**What it does:** Filters hallucinated category names but does NOT enforce exclusivity. If GPT returns `["fine_dining", "casual_eats"]`, both pass through.
**What it should do:** After filtering valid slugs, if `fine_dining` is present, strip `casual_eats`.
**Causal chain:** GPT returns both → valid slugs filter passes both → categories written to place_pool with both → dual-tagging.

### 🔴 Root Cause C: SYSTEM_PROMPT Example 19 teaches GPT to return both

**File:** `ai-verify-pipeline/index.ts:191`
**Code:**
```
Example 19: "Fogo de Chão Brazilian Steakhouse" ... → {"d":"accept","c":["fine_dining","casual_eats"],...}
```
**What it does:** Explicitly teaches GPT that returning both is correct.
**What it should do:** Example should return `["fine_dining"]` only.

### 🟠 Contributing Factor D: handleOverride allows admin to set both

**File:** `ai-verify-pipeline/index.ts:1112`
**Code:** `ai_categories: body.categories || []`
**What it does:** Writes whatever the admin sends — no validation. An admin could manually set both tags via the Review Queue override.
**What it should do:** Apply the same exclusivity rule before writing.

### 🔵 Observation E: processPlace() Stage 5 result passes GPT categories directly

**File:** `ai-verify-pipeline/index.ts:554`
**Code:** `categories: decision === "reject" ? [] : result.categories`
**What it does:** Passes GPT's categories through unchanged to the write point at W-1. No post-processing between GPT and DB write. The enforcement at classifyPlace() (Root Cause B fix) would catch this before it reaches here.

---

## Enforcement Strategy: Single Function, Multiple Call Sites

**Recommendation: Create one `enforceExclusivity()` helper, call it at 3 points.**

A single enforcement function that strips `casual_eats` when `fine_dining` is present:
```
function enforceExclusivity(categories: string[]): string[] {
  if (categories.includes("fine_dining")) {
    return categories.filter(c => c !== "casual_eats");
  }
  return categories;
}
```

Call it at:
1. **classifyPlace() post-processing** (line 326) — catches all GPT results
2. **deterministicFilter() check 6** (line 424) — catches rules filter promotions
3. **handleOverride()** (line 1112) — catches admin overrides

This is better than a single enforcement point because:
- GPT results and deterministic results take different paths
- Admin overrides bypass both GPT and deterministicFilter
- Three call sites with one shared function = zero drift risk

---

## Existing Data

555 places currently have both `fine_dining` and `casual_eats`. SQL cleanup needed.

---

## Blast Radius

- **Fine dining deck:** Gains exclusivity — only genuine fine dining, no overlap with casual
- **Casual eats deck:** Loses ~555 places that were dual-tagged (they move to fine dining only)
- **User preferences:** Users who selected ONLY casual_eats will no longer see these 555 places. Users who selected fine_dining will still see them. Users who selected BOTH will see them in fine_dining deck only.
- **Mobile app:** Zero changes — reads from pool
- **Admin Review Queue:** Override path needs enforcement too

---

## Discoveries for Orchestrator

None.
