# Investigation Report: ORCH-0424 — Remove Max Selection Limits on Intents & Categories

**Investigator:** Forensics
**Date:** 2026-04-14
**Confidence:** HIGH (every file read, every layer traced)
**Verdict:** Safe to remove limits. Blast radius is well-contained across 14 enforcement points and 28+ locale files, but no downstream logic assumes bounded arrays.

---

## Symptom Summary

**Current behavior:** Users can select max 3 categories and exactly 1 intent (radio behavior) during onboarding and in the PreferencesSheet.

**Desired behavior:** No maximum cap. Users can select any number of categories (up to all 12 visible) and any number of intents (up to all 6). Minimum of 1 category and 1 intent remains enforced during onboarding; at least 1 of either must remain selected post-onboarding.

---

## Investigation Manifest

| # | File | Layer | Why Read |
|---|------|-------|----------|
| 1 | `app-mobile/src/utils/categoryUtils.ts` | Utility | Defines MAX_CATEGORIES, MAX_INTENTS, capIntents, normalizeCategoryArray |
| 2 | `app-mobile/src/components/OnboardingFlow.tsx` | Component | Intent selection UI (radio), category selection UI (cap at 3), save path |
| 3 | `app-mobile/src/components/PreferencesSheet.tsx` | Component | Toggle handlers, save truncation, collab/solo load |
| 4 | `app-mobile/src/contexts/RecommendationsContext.tsx` | Context | stableDeckParams — caps intents to 1 via `.slice(0,1)` |
| 5 | `app-mobile/src/services/deckService.ts` | Service | resolvePills — converts categories/intents to deck pills |
| 6 | `app-mobile/src/utils/sessionPrefsUtils.ts` | Utility | aggregateAllPrefs — collab union logic |
| 7 | `app-mobile/src/components/AppHandlers.tsx` | Component | Solo intents `.slice(0,1)` on session save |
| 8 | `app-mobile/src/hooks/useAuthSimple.ts` | Hook | Normalized intents `.slice(0,1)` on auth prefetch |
| 9 | `app-mobile/src/hooks/useOnboardingResume.ts` | Hook | Restored intents `.slice(0,1)` on resume |
| 10 | `app-mobile/src/components/profile/EditInterestsSheet.tsx` | Component | Profile display interests — NO cap (already uncapped!) |
| 11 | `app-mobile/src/components/profile/ProfileInterestsSection.tsx` | Component | Renders intents — iterates full array, no cap |
| 12 | `app-mobile/src/types/onboarding.ts` | Types | ONBOARDING_INTENTS definition (6 intents) |
| 13 | `app-mobile/src/components/DiscoverScreen.tsx` | Component | Deck interleave — iterates categories dynamically |
| 14 | `supabase/migrations/20260412400003_phase6_dead_code_cleanup.sql` | DB/RPC | query_pool_cards — v_per_category_cap logic |
| 15 | `supabase/migrations/20260409400000_add_display_interests_columns.sql` | DB | categories[1:3] truncation in migration |
| 16 | `supabase/functions/discover-cards/index.ts` | Edge Function | Receives categories array — no size assumption |
| 17 | `supabase/functions/generate-curated-experiences/index.ts` | Edge Function | Receives intents — iterates via Promise.all |
| 18 | All locale files (28 locales) | i18n | cap_message strings |

---

## Findings

### Finding 1: `MAX_CATEGORIES = 3` and `MAX_INTENTS = 1` constants

**Classification:** 🔴 Root Cause (of the artificial limit)
**File:** `app-mobile/src/utils/categoryUtils.ts:9,12`
**Code:**
```ts
export const MAX_CATEGORIES = 3;
export const MAX_INTENTS = 1;
```
**What it does:** Hard constants consumed by PreferencesSheet and normalizeCategoryArray.
**What it should do:** These constants should be removed entirely (not raised to 12/6).
**Impact:** PreferencesSheet imports both. normalizeCategoryArray uses MAX_CATEGORIES as default for `maxCategories` parameter.
**Confidence:** HIGH

---

### Finding 2: `capIntents()` truncation utility

**Classification:** 🔴 Root Cause
**File:** `app-mobile/src/utils/categoryUtils.ts:15`
**Code:**
```ts
export const capIntents = (raw: string[]): string[] => raw.slice(0, MAX_INTENTS);
```
**What it does:** Truncates any intents array to 1 element.
**What it should do:** Should be removed entirely. All 5 call sites must stop using it.
**Call sites:**
1. `PreferencesSheet.tsx:283` — collab load
2. `PreferencesSheet.tsx:366` — solo load
3. `PreferencesSheet.tsx:797` — save boundary
4. (Imported but only used via the above)
**Confidence:** HIGH

---

### Finding 3: `normalizeCategoryArray()` default parameter

**Classification:** 🔴 Root Cause
**File:** `app-mobile/src/utils/categoryUtils.ts:184,207`
**Code:**
```ts
export const normalizeCategoryArray = (raw: string[], maxCategories: number = 3): string[] => {
  ...
  if (result.length >= maxCategories) break;
  ...
};
```
**What it does:** When called without a second argument, truncates to 3. Called with explicit length in some places but not all.
**Callers and their behavior:**
| Caller | Second Arg | Truncates? |
|--------|-----------|------------|
| `RecommendationsContext.tsx:346` | `rawCats.length` | NO (passes full length) |
| `OnboardingFlow.tsx:1671` | `data.selectedCategories.length` | NO |
| `useAuthSimple.ts:120` | `prefs.categories.length` | NO |
| `PreferencesSheet.tsx:287` (collab) | **none** (defaults to 3) | YES - TRUNCATES |
| `PreferencesSheet.tsx:370` (solo) | **none** (defaults to 3) | YES - TRUNCATES |
| `useOnboardingResume.ts:153` | **none** (defaults to 3) | YES - TRUNCATES |
| `AppHandlers.tsx:464` | **none** (defaults to 3) | YES - TRUNCATES |

**Fix direction:** Remove the `maxCategories` parameter and the `break` entirely. The function should normalize without truncating.
**Confidence:** HIGH

---

### Finding 4: Onboarding category selection hard-coded to 3

**Classification:** 🔴 Root Cause
**File:** `app-mobile/src/components/OnboardingFlow.tsx:2799-2803`
**Code:**
```ts
if (p.selectedCategories.length >= 3) {
  setCategoryCapMessage(true);
  setTimeout(() => setCategoryCapMessage(false), 2000);
  return p;
}
```
**What it does:** Blocks selecting more than 3 categories, shows "Maximum 3" toast.
**What it should do:** Allow unlimited selection. Remove the guard and the cap message entirely.
**Confidence:** HIGH

---

### Finding 5: Onboarding intent selection — radio behavior

**Classification:** 🔴 Root Cause
**File:** `app-mobile/src/components/OnboardingFlow.tsx:2457-2462`
**Code:**
```ts
selectedIntents: p.selectedIntents.includes(intent.id)
  ? []  // Deselect (CTA enforces min 1)
  : [intent.id],  // Radio: replace with only this one
```
**What it does:** Replaces entire array with single selection (radio button behavior).
**What it should do:** Toggle behavior — add/remove from array like categories.
**Confidence:** HIGH

---

### Finding 6: Onboarding save path truncates intents to 1

**Classification:** 🔴 Root Cause
**File:** `app-mobile/src/components/OnboardingFlow.tsx:1676`
**Code:**
```ts
const normalizedIntents = (data.selectedIntents ?? []).slice(0, 1)
```
**What it does:** Forces single intent on deck prefetch save.
**What it should do:** Pass full array.
**Confidence:** HIGH

---

### Finding 7: PreferencesSheet category toggle guard

**Classification:** 🔴 Root Cause
**File:** `app-mobile/src/components/PreferencesSheet.tsx:494-497`
**Code:**
```ts
if (prev.length >= MAX_CATEGORIES) {
  capped = true;
  return prev;
}
```
**What it does:** Blocks adding beyond 3 categories.
**What it should do:** Allow unlimited. Remove guard and cap message.
**Confidence:** HIGH

---

### Finding 8: PreferencesSheet intent toggle — radio behavior

**Classification:** 🔴 Root Cause
**File:** `app-mobile/src/components/PreferencesSheet.tsx:472-474`
**Code:**
```ts
return [];  // Radio: goes to 0
...
return [id];  // Radio: replace with only this one
```
**What it does:** Single-select radio behavior.
**What it should do:** Multi-select toggle (add/remove from array), same as categories.
**Confidence:** HIGH

---

### Finding 9: PreferencesSheet save truncation

**Classification:** 🔴 Root Cause
**File:** `app-mobile/src/components/PreferencesSheet.tsx:796-797`
**Code:**
```ts
const finalCategories = selectedCategories.slice(0, MAX_CATEGORIES);
const finalIntents = capIntents(selectedIntents);
```
**What it does:** Safety cap at save boundary.
**What it should do:** Pass arrays as-is (no truncation).
**Confidence:** HIGH

---

### Finding 10: RecommendationsContext caps intents to 1

**Classification:** 🔴 Root Cause
**File:** `app-mobile/src/contexts/RecommendationsContext.tsx:366`
**Code:**
```ts
intents: ints.slice(0, 1),
```
**Comment:** `// Radio behavior: max 1 intent. DB may have stale multi-intent data from legacy saves`
**What it does:** Truncates intents array for deck params.
**What it should do:** Pass full array. The "stale legacy data" concern is no longer valid.
**Confidence:** HIGH

---

### Finding 11: AppHandlers.tsx caps intents to 1

**Classification:** 🔴 Root Cause
**File:** `app-mobile/src/components/AppHandlers.tsx:465`
**Code:**
```ts
const soloIntents = (preferences.selectedIntents || []).slice(0, 1);
```
**What it should do:** Pass full array.
**Confidence:** HIGH

---

### Finding 12: useAuthSimple.ts caps intents to 1

**Classification:** 🔴 Root Cause
**File:** `app-mobile/src/hooks/useAuthSimple.ts:123`
**Code:**
```ts
const normalizedIntents = (prefs.intents ?? []).slice(0, 1);
```
**What it should do:** Pass full array.
**Confidence:** HIGH

---

### Finding 13: useOnboardingResume.ts caps intents to 1

**Classification:** 🔴 Root Cause
**File:** `app-mobile/src/hooks/useOnboardingResume.ts:157`
**Code:**
```ts
base.selectedIntents = (prefs.intents ?? []).slice(0, 1)
```
**What it should do:** Pass full array.
**Confidence:** HIGH

---

### Finding 14: i18n cap_message strings (28 locales x 2 files = 56 strings)

**Classification:** 🟠 Contributing Factor
**Files:** Every locale's `onboarding.json` line 132 and `preferences.json` line ~15
**Content:** "Maximum 3 categories. Deselect one to choose another." (and translations)
**What should change:** Remove `cap_message` keys from all locale files. Remove the cap toast UI.
**Additional copy changes needed:**
- `onboarding.json` → `categories.body`: "Pick up to 3 that match your vibe." → remove "up to 3"
- `onboarding.json` → `intents.caption`: "Pick the one that excites you most." → pluralize
**Confidence:** HIGH

---

### Finding 15: Historical migration truncated categories to 3

**Classification:** 🔵 Observation (one-time, already ran)
**File:** `supabase/migrations/20260409400000_add_display_interests_columns.sql:53-56`
**Code:**
```sql
UPDATE public.preferences
SET categories = categories[1:3]
WHERE array_length(categories, 1) > 3;
```
**Impact:** This migration already ran. Existing DB data is already truncated. New data won't be truncated since no DB-level CHECK constraint exists.
**Risk:** None going forward. No ongoing truncation.
**Confidence:** HIGH

---

### Finding 16: EditInterestsSheet already supports unlimited

**Classification:** 🔵 Observation (positive)
**File:** `app-mobile/src/components/profile/EditInterestsSheet.tsx:47-58`
**Code:**
```ts
const toggleIntent = (id: string) => {
  setSelectedIntents((prev) =>
    prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
  );
};
const toggleCategory = (name: string) => {
  setSelectedCategories((prev) =>
    prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name],
  );
};
```
**What this means:** The profile display interests editor (cosmetic) already allows multi-select with no cap. This is the exact toggle pattern the PreferencesSheet and OnboardingFlow should adopt.
**Confidence:** HIGH

---

## Blast Radius Map

### Layer: Database / RPC

| Component | Impact | Risk |
|-----------|--------|------|
| `preferences.categories` column | `text[]` — no CHECK constraint on array length | SAFE |
| `preferences.intents` column | `text[]` — no CHECK constraint on array length | SAFE |
| `query_pool_cards` RPC | `v_per_category_cap = CEIL(limit / num_categories)`. With 12 categories and limit 200, cap = 17 per category. Works correctly — just distributes evenly. | SAFE |
| `board_sessions` collab prefs | `categories text[]`, `intents text[]` — no constraints | SAFE |

### Layer: Edge Functions

| Function | Impact | Risk |
|----------|--------|------|
| `discover-cards` | Receives `categories[]`, passes to RPC. No size check. | SAFE |
| `generate-curated-experiences` | Receives intents via `Promise.all` — one fetch per intent. With 6 intents max, this means 6 parallel fetches. | LOW RISK — monitor performance |

### Layer: Deck Building

| Component | Impact | Risk |
|-----------|--------|------|
| `deckService.resolvePills()` | Iterates all categories and intents to build pills. No size assumption. | SAFE |
| `DiscoverScreen` interleave | "One card per category" first pass iterates `shuffledCategories`. More categories = better diversity. | SAFE — actually improves |
| `RecommendationsContext.stableDeckParams` | Currently caps to 1 intent — MUST be changed | ROOT CAUSE |
| `RecommendationsContext.collabDeckParams` | Uses `aggregateAllPrefs` — union, no cap | SAFE |

### Layer: Collaboration

| Component | Impact | Risk |
|-----------|--------|------|
| `aggregateAllPrefs()` | Union of all participants' categories and intents. Uses Set, no size assumption. More selections = bigger union. | SAFE |
| Collab deck merging | Already handles variable-size arrays | SAFE |

### Layer: UI Layout

| Component | Impact | Risk |
|-----------|--------|------|
| Onboarding intent cards | 6 cards in a grid. Currently 2x3 layout. With multi-select, all 6 could be selected. Layout doesn't change — just visual state. | SAFE |
| Onboarding category tiles | 12 tiles in a grid with `ScrollView`. All 12 could be selected. Layout already handles this. | SAFE |
| PreferencesSheet pills | Intent and category sections scroll. No overflow issue with more selections. | SAFE |
| ProfileInterestsSection | Renders all intents in a wrap layout. Already handles variable count. | SAFE |

### Layer: Performance

| Concern | Analysis | Risk |
|---------|----------|------|
| Deck query with 12 categories | RPC uses `&&` (array overlap) — single index scan, no N+1. Per-category cap drops to 17 but total is still 200. | SAFE |
| 6 curated fetches in parallel | Each curated intent = 1 edge function call. 6 parallel calls is fine. Current limit is 1, so going to 6 is notable but within Supabase limits. | LOW RISK |
| React Query cache key | Key includes categories/intents arrays. More permutations = less cache reuse. | LOW RISK — acceptable |

---

## Five-Layer Cross-Check

| Layer | Status | Notes |
|-------|--------|-------|
| **Docs** | N/A | No product doc specifies the limits as intentional product decisions |
| **Schema** | CLEAN | No CHECK constraints on array length. `text[]` columns accept any size. |
| **Code** | 14 enforcement points found | All enumerated above. Every `.slice(0,1)` and `>= 3` guard identified. |
| **Runtime** | Consistent | Radio behavior in UI matches `.slice(0,1)` in save path — enforcement is consistent across all layers |
| **Data** | Truncated by migration | Historical data was truncated to 3 categories. No ongoing constraint. |

**Layer contradiction:** None. The limit is consistently enforced everywhere. No hidden escape hatches.

---

## Invariant Analysis

**No invariants violated by removing limits.** The key invariant is:
- "Deck preferences must have at least 1 signal (category or intent) to generate a deck"

This invariant is preserved because the minimum-1 enforcement stays in place:
- Onboarding: "Continue" button disabled when `selectedIntents.length === 0` (line 1973) and `selectedCategories.length === 0` (line 1984)
- PreferencesSheet: deselect-last blocked by cross-checking the other array (lines 468-470, 486-490)

---

## Complete Change Inventory

### Files to Modify (14 source files + 56 locale strings)

| # | File | Change | Lines |
|---|------|--------|-------|
| 1 | `app-mobile/src/utils/categoryUtils.ts` | Remove `MAX_CATEGORIES`, `MAX_INTENTS`, `capIntents`. Remove `maxCategories` param and `break` from `normalizeCategoryArray`. | 9, 12, 15, 184, 207 |
| 2 | `app-mobile/src/components/OnboardingFlow.tsx` | Change intent toggle from radio to multi-select. Remove category `>= 3` guard. Remove `.slice(0,1)` on save. Remove cap_message toast. | 1676, 2457-2462, 2799-2803, 2810-2814 |
| 3 | `app-mobile/src/components/PreferencesSheet.tsx` | Change intent toggle from radio to multi-select. Remove `>= MAX_CATEGORIES` guard. Remove save truncation. Remove capIntents import. Remove cap_message state/toast. | 60, 283, 366, 472-474, 494-497, 796-797 |
| 4 | `app-mobile/src/contexts/RecommendationsContext.tsx` | Remove `.slice(0,1)` on intents. Remove stale comment about radio behavior. | 364-366 |
| 5 | `app-mobile/src/components/AppHandlers.tsx` | Remove `.slice(0,1)` on intents. | 465 |
| 6 | `app-mobile/src/hooks/useAuthSimple.ts` | Remove `.slice(0,1)` on intents. | 123 |
| 7 | `app-mobile/src/hooks/useOnboardingResume.ts` | Remove `.slice(0,1)` on intents. | 157 |
| 8 | 28x `onboarding.json` locales | Remove `cap_message` key. Update `categories.body` (remove "up to 3"). Update `intents.caption` (pluralize). | Line 132, line 131 |
| 9 | 28x `preferences.json` locales | Remove `categories.cap_message` key. | Line ~15 |

### Files That Do NOT Need Changes (verified safe)

| File | Why Safe |
|------|----------|
| `deckService.ts` | Iterates all pills dynamically. No size assumption. |
| `sessionPrefsUtils.ts` | Union via Set. No cap. |
| `DiscoverScreen.tsx` | Iterates shuffled categories. No hardcoded limit. |
| `EditInterestsSheet.tsx` | Already uncapped multi-select. |
| `ProfileInterestsSection.tsx` | Renders all intents. |
| `discover-cards/index.ts` | Passes array to RPC. No size check. |
| `generate-curated-experiences/index.ts` | Promise.all on intents. |
| `query_pool_cards` RPC | Per-category-cap scales dynamically. |
| Database schema | No CHECK constraints to change. |

---

## Risk Assessment

**Hardest part:** The i18n changes — 56 locale file edits (28 locales x 2 files each) plus copy rewording. This is tedious but mechanical.

**Hidden assumption risk:** LOW. Every consumer of these arrays was traced. No downstream logic assumes bounded size. The RPC divides the limit evenly, which just means fewer cards per category with more selections — this is correct behavior.

**Performance risk:** LOW. Worst case: 12 categories in the RPC query (same SQL path, same index) + 6 curated fetches in parallel (6 edge function invocations instead of 1). Both are within normal operational bounds.

**UX risk:** MEDIUM. With unlimited selections, users might select all 12 categories and all 6 intents, which is equivalent to "show me everything." The deck diversity algorithm handles this correctly (round-robin distribution), but the experience becomes less curated. This is a product choice, not a bug.

---

## Recommended Direction for Spec

1. **Remove all max constants, cap functions, and truncation** — the 14 enforcement points above.
2. **Convert intent UI from radio to multi-select toggle** — both onboarding and PreferencesSheet. Use the same toggle pattern already proven in EditInterestsSheet.
3. **Update i18n copy** — remove cap messages, update category/intent descriptions.
4. **Preserve minimum enforcement** — keep the existing min-1 guards in both surfaces.
5. **No DB changes needed** — no migration, no schema change.
6. **No edge function changes needed**.
7. **Consider:** Should the onboarding copy hint at "pick as many as you want" or stay neutral? Product decision.

---

## Discoveries for Orchestrator

None. This is a clean, self-contained change with no side issues discovered.
