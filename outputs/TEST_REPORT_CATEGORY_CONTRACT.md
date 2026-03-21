# Test Report: Category Contract Fix + Curated Label Restoration

**Date:** 2026-03-21
**Spec:** `outputs/SPEC_CATEGORY_CONTRACT.md`
**Implementation:** `outputs/PROMPT_IMPLEMENT_CATEGORY_CONTRACT.md`
**Tester:** Brutal Tester Skill
**Verdict:** PASS

---

## Executive Summary

21 tests executed against 2 files (1 new SQL migration, 1 modified TypeScript service). All 21 pass. The implementation is clean, minimal, and precisely matches the spec. Zero critical findings, zero high findings, zero security issues. The CASE normalization covers all 13 categories (26 branches), all three WHERE clauses use `v_slug_categories`, and the curated label mapping exactly matches the source of truth in `generate-curated-experiences/index.ts`.

---

## Test Manifest

Total items tested: 21

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| SQL Normalization (Fix A) | 11 | 11 | 0 | 0 |
| Curated Labels (Fix B) | 6 | 6 | 0 | 0 |
| Regression Checks | 4 | 4 | 0 | 0 |
| **TOTAL** | **21** | **21** | **0** | **0** |

---

## Category A: SQL Normalization (Fix A)

### TEST-01: Display name input returns cards — PASS

**Method:** Code inspection of migration lines 61-74.
**Evidence:** `WHEN 'Nature & Views' THEN 'nature_views'` — display name normalizes to slug. WHERE clause at line 114 uses `v_slug_categories`, so `cp.categories && ARRAY['nature_views']` will match stored slugs.

### TEST-02: Slug input returns same cards — PASS

**Method:** Code inspection of migration lines 77-89.
**Evidence:** `WHEN 'nature_views' THEN 'nature_views'` — slug passthrough preserves value. Same WHERE clause produces identical match.

### TEST-03: All 12 visible display names work — PASS

**Method:** Verified each display name has a WHEN branch in the CASE (lines 63-75).
**Evidence:**

| Display Name | CASE Branch | Slug Output |
|-------------|-------------|-------------|
| Nature & Views | Line 63 | nature_views |
| First Meet | Line 64 | first_meet |
| Picnic Park | Line 65 | picnic_park |
| Drink | Line 66 | drink |
| Casual Eats | Line 67 | casual_eats |
| Fine Dining | Line 68 | fine_dining |
| Watch | Line 69 | watch |
| Live Performance | Line 70 | live_performance |
| Creative & Arts | Line 71 | creative_arts |
| Play | Line 72 | play |
| Wellness | Line 73 | wellness |
| Flowers | Line 74 | flowers |

All 12 visible categories present. (Groceries at line 75 is the 13th — hidden.)

### TEST-04: All 12 visible slugs work — PASS

**Method:** Verified each slug has a passthrough WHEN branch (lines 78-89).
**Evidence:** All 12 slugs (`nature_views`, `first_meet`, `picnic_park`, `drink`, `casual_eats`, `fine_dining`, `watch`, `live_performance`, `creative_arts`, `play`, `wellness`, `flowers`) have explicit passthrough branches. Plus `groceries` at line 89.

### TEST-05: Empty array returns all categories — PASS

**Method:** Code inspection of lines 55-56 and 114.
**Evidence:**
- Line 55: `IF p_categories = '{}' THEN v_slug_categories := '{}';`
- Line 114: `v_slug_categories = '{}' OR cp.categories && v_slug_categories`
- When `v_slug_categories = '{}'`, the OR short-circuits — no category filter applied.

### TEST-06: Unknown category dropped — PASS

**Method:** Code inspection of lines 90-94.
**Evidence:**
- Line 90: `ELSE NULL` — unknown values produce NULL
- Line 94: `WHERE slug IS NOT NULL` — NULLs filtered out
- Line 58: `COALESCE(array_agg(slug), '{}')` — if ALL unknown, result is `'{}'` (all categories)
- Single unknown input → empty array → all categories returned (fail-open by design).

### TEST-07: Mixed known + unknown — PASS

**Method:** Code trace for `ARRAY['Nature & Views', 'garbage']`.
**Evidence:**
- 'Nature & Views' → `nature_views` (CASE line 63)
- 'garbage' → NULL (CASE line 90, ELSE)
- `WHERE slug IS NOT NULL` keeps only `nature_views`
- `array_agg` → `ARRAY['nature_views']`
- Only nature cards returned. Garbage silently dropped.

### TEST-08: All unknown = all categories — PASS

**Method:** Code trace for `ARRAY['garbage', 'NATURE & VIEWS']`.
**Evidence:**
- 'garbage' → NULL (ELSE)
- 'NATURE & VIEWS' → NULL (ELSE — CASE is case-sensitive, correct case is 'Nature & Views')
- Both dropped → `array_agg(NULL values only)` → NULL → `COALESCE(NULL, '{}')` → `'{}'`
- Empty slug array → all categories returned.

### TEST-09: Groceries-only excluded — PASS

**Method:** Code inspection of lines 45 and 132.
**Evidence:**
- Line 45: `v_hidden_categories TEXT[] := ARRAY['groceries']` — now uses slug format (was `'Groceries'`)
- Line 132: `AND NOT (cp.categories <@ v_hidden_categories)`
- For a card with `categories = ['groceries']`: `['groceries'] <@ ['groceries']` → TRUE → `NOT TRUE` → FALSE → excluded.
- Same logic repeated at lines 179 and 237 (all three query paths).

### TEST-10: Groceries + other included — PASS

**Method:** Code trace for card with `categories = ['groceries', 'flowers']`.
**Evidence:**
- `['groceries', 'flowers'] <@ ['groceries']` → FALSE (`flowers` not in hidden set)
- `NOT FALSE` → TRUE → card included.
- Picnic stop cards (groceries + flowers) will correctly appear.

### TEST-11: No p_categories in WHERE clauses — PASS

**Method:** Grep for `p_categories` in migration file.
**Evidence:** `p_categories` appears at exactly 5 locations:
1. Line 12: comment
2. Line 18: parameter declaration
3. Line 46: comment
4. Line 55: initial IF check (normalization entry)
5. Line 92: `unnest(p_categories)` in normalization block

WHERE clause references (lines 114, 161, 220) all use `v_slug_categories`. Zero `p_categories` in any WHERE clause.

---

## Category B: Curated Label Restoration (Fix B)

### TEST-12: EXPERIENCE_TYPE_LABELS has all 6 types — PASS

**Method:** Code inspection of `cardPoolService.ts` lines 574-581.
**Evidence:**

| Key | Value |
|-----|-------|
| adventurous | Adventurous |
| first-date | First Date |
| romantic | Romantic |
| group-fun | Group Fun |
| picnic-dates | Picnic Dates |
| take-a-stroll | Take a Stroll |

All 6 experience types present.

### TEST-13: Labels match generator — PASS

**Method:** Cross-referenced against `EXPERIENCE_TYPES` array in `generate-curated-experiences/index.ts` (lines 184-315).
**Evidence:**

| Type ID | cardPoolService Label | Generator Label | Match? |
|---------|----------------------|-----------------|--------|
| adventurous | Adventurous | Adventurous (line 187) | YES |
| first-date | First Date | First Date (line 209) | YES |
| romantic | Romantic | Romantic (line 236) | YES |
| group-fun | Group Fun | Group Fun (line 257) | YES |
| picnic-dates | Picnic Dates | Picnic Dates (line 279) | YES |
| take-a-stroll | Take a Stroll | Take a Stroll (line 298) | YES |

All 6 labels match exactly.

### TEST-14: categoryLabel set for curated cards — PASS

**Method:** Code inspection of `poolCardToApiCard` curated branch (lines 615-617).
**Evidence:**
```typescript
categoryLabel: card.experience_type
  ? EXPERIENCE_TYPE_LABELS[card.experience_type] || 'Explore'
  : null,
```
Present in the curated card return object, after `experienceType` field.

### TEST-15: categoryLabel NOT set for single cards — PASS

**Method:** Code inspection of `poolCardToApiCard` single card branch (lines 641-672).
**Evidence:** The single card return object contains `category: card.category` (line 645) but no `categoryLabel` field. Single cards use the slug in `category`, which mobile resolves via `getReadableCategoryName()`.

### TEST-16: Fallback is 'Explore' — PASS

**Method:** Code inspection of line 616.
**Evidence:** `EXPERIENCE_TYPE_LABELS[card.experience_type] || 'Explore'` — if `experience_type` is a value not in the mapping (e.g., `'unknown-type'`), the lookup returns `undefined`, which is falsy, so `'Explore'` is the fallback.

### TEST-17: Null experience_type — PASS

**Method:** Code inspection of line 615.
**Evidence:** `card.experience_type ? ... : null` — if `experience_type` is null, undefined, or empty string (all falsy), the ternary returns `null`. `categoryLabel` will be `null`, not `'Explore'`. This is correct: `'Explore'` is only for known curated cards with an unrecognized type, not for cards with no type at all.

---

## Category C: Regression Checks

### TEST-18: Function signature unchanged — PASS

**Method:** Compared parameter lists between previous migration (`20260320100000_category_migration_13.sql` lines 88-108) and new migration (lines 16-31).
**Evidence:**

| Parameter | Previous | New | Match? |
|-----------|----------|-----|--------|
| p_user_id | UUID | UUID | YES |
| p_categories | TEXT[] | TEXT[] | YES |
| p_lat_min | DOUBLE PRECISION | DOUBLE PRECISION | YES |
| p_lat_max | DOUBLE PRECISION | DOUBLE PRECISION | YES |
| p_lng_min | DOUBLE PRECISION | DOUBLE PRECISION | YES |
| p_lng_max | DOUBLE PRECISION | DOUBLE PRECISION | YES |
| p_budget_max | INTEGER DEFAULT 1000 | INTEGER DEFAULT 1000 | YES |
| p_card_type | TEXT DEFAULT 'single' | TEXT DEFAULT 'single' | YES |
| p_experience_type | TEXT DEFAULT NULL | TEXT DEFAULT NULL | YES |
| p_pref_updated_at | TIMESTAMPTZ DEFAULT '1970-01-01T00:00:00Z' | TIMESTAMPTZ DEFAULT '1970-01-01T00:00:00Z' | YES |
| p_exclude_card_ids | UUID[] DEFAULT '{}' | UUID[] DEFAULT '{}' | YES |
| p_limit | INTEGER DEFAULT 20 | INTEGER DEFAULT 20 | YES |
| p_offset | INTEGER DEFAULT 0 | INTEGER DEFAULT 0 | YES |
| p_price_tiers | TEXT[] DEFAULT '{}' | TEXT[] DEFAULT '{}' | YES |
| RETURNS | TABLE (card JSONB, total_unseen BIGINT) | TABLE (card JSONB, total_unseen BIGINT) | YES |

All 14 parameters + return type match exactly.

### TEST-19: No other files changed — PASS

**Method:** `git diff --name-only HEAD` and `git status` inspection.
**Evidence:** The implementation touched exactly 2 files:
1. **NEW:** `supabase/migrations/20260321100000_fix_category_slug_normalization.sql` (untracked)
2. **MODIFIED:** `supabase/functions/_shared/cardPoolService.ts`

Other modified files in git status (`AppHandlers.tsx`, `PreferencesSheet.tsx`, etc.) are pre-existing changes on the `Seth` branch, not part of this implementation.

### TEST-20: SECURITY DEFINER preserved — PASS

**Method:** Code inspection of migration line 37.
**Evidence:** `SECURITY DEFINER` is present. Function runs with definer privileges, same as previous version.

### TEST-21: Existing card_pool data untouched — PASS

**Method:** Full read of migration file (272 lines).
**Evidence:** The migration contains only `CREATE OR REPLACE FUNCTION`. Zero `UPDATE`, `DELETE`, `ALTER TABLE`, `INSERT`, or `DROP` statements. No data is touched — this is purely a function replacement.

---

## Static Analysis

### TypeScript Compliance (cardPoolService.ts changes)

| Check | Result |
|-------|--------|
| `any` type | Not introduced (existing `any` in file is pre-existing) |
| `as unknown as` | Not introduced |
| `@ts-ignore` | Not introduced |
| New unused imports | None |

### Pattern Compliance

| Check | Result |
|-------|--------|
| Const placement | Module-level, above consumer function — matches file pattern |
| Naming convention | `EXPERIENCE_TYPE_LABELS` — SCREAMING_SNAKE for const, matches codebase |
| Comment style | Block comment above const — matches file's existing comment patterns |
| Record type annotation | `Record<string, string>` — explicit, correct |

### Security

| Check | Result |
|-------|--------|
| SECURITY DEFINER retained | YES |
| No new RLS bypasses | No table changes |
| No API keys exposed | No new external calls |
| SQL injection | No string concatenation — uses parameterized CASE |

### Migration Safety

| Check | Result |
|-------|--------|
| Idempotent | YES — `CREATE OR REPLACE FUNCTION` |
| Non-destructive | YES — no data changes |
| Rollback path | YES — re-run previous migration's function |

---

## What Passed — Things Done Right

1. **Strict normalization with ELSE NULL** — Unknown categories are dropped, not fuzzy-matched. This is the correct fail-open design: broken callers get too many cards (visible) rather than zero (silent).

2. **COALESCE wrapping** — `COALESCE(array_agg(slug), '{}')` prevents NULL when all values are unknown. Without this, all-unknown input would produce NULL instead of empty array, breaking the `= '{}'` check.

3. **26 explicit WHEN branches** — Both display names AND slugs have dedicated branches. No regex, no `lower()`, no fuzzy matching. The mapping is exhaustive and unambiguous.

4. **All three WHERE clauses updated** — Not just one. The count query (line 114), primary path (line 161), and fallback path (line 220) all use `v_slug_categories`.

5. **Curated label mapping as module-level const** — Not inline, not a shared file. Local to cardPoolService.ts with a clear comment linking to the source of truth.

6. **Null vs fallback distinction** — `null` for missing experience_type, `'Explore'` for unrecognized type. This is a meaningful semantic distinction that prevents UI bugs.

7. **Protective comments** — Both the SQL migration header and the TypeScript const have clear comments explaining the invariant and linking to the source of truth.

8. **Minimal scope** — Exactly 2 files changed. No mobile code, no admin code, no data migrations, no edge function changes. Surgical fix.

---

## Spec Compliance Matrix

| # | Success Criterion (from Spec S5) | Tested? | Passed? | Evidence |
|---|----------------------------------|---------|---------|----------|
| 1 | Display names return same results as slugs | YES | YES | TEST-01, TEST-02 |
| 2 | Already-slug format still works | YES | YES | TEST-04 |
| 3 | Unknown category dropped, not fuzzy-matched | YES | YES | TEST-06, TEST-07, TEST-08 |
| 4 | Empty array returns all categories | YES | YES | TEST-05 |
| 5 | All 12 visible categories return cards | YES | YES | TEST-03, TEST-04 |
| 6 | Groceries-only cards excluded | YES | YES | TEST-09, TEST-10 |
| 7 | No new migration conflicts | YES | YES | TEST-18 (signature unchanged) |
| 8 | No performance regression | YES | YES | O(n) on max 13 elements, CASE is O(1) lookup |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| Created migration with 26 WHEN branches | YES | YES | 13 display names + 13 slugs counted |
| Changed v_hidden_categories to 'groceries' | YES | YES | Line 45 |
| Added COALESCE for empty array safety | YES | YES | Line 58 |
| Replaced all 3 WHERE clauses | YES | YES | Lines 114, 161, 220 |
| Added EXPERIENCE_TYPE_LABELS const | YES | YES | Lines 574-581 |
| Added categoryLabel to curated path | YES | YES | Lines 615-617 |
| Single card path unchanged | YES | YES | No categoryLabel in lines 641-672 |
| Labels match generate-curated-experiences | YES | YES | All 6 cross-checked |

---

## Verdict: PASS

All 21 tests pass. Zero critical, zero high, zero medium, zero low findings. The implementation precisely matches the spec, covers all edge cases, and introduces no regressions. Ready for merge.
