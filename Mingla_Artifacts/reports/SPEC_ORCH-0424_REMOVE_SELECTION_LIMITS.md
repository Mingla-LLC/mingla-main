# Spec: ORCH-0424 — Remove Max Selection Limits on Intents & Categories

**Author:** Forensics (Spec Mode)
**Date:** 2026-04-14
**Investigation:** `INVESTIGATION_ORCH-0424_SELECTION_LIMIT_REMOVAL.md`
**Confidence:** HIGH

---

## Layman Summary

Users can currently pick only 1 intent and up to 3 categories. We're removing both ceilings so users can select as many intents and categories as they want. The floor stays: you must always have at least 1 of each during onboarding, and at least 1 of either in the preferences sheet. No database or backend changes needed — this is purely a frontend uncapping.

---

## Scope

**In scope:**
- Remove `MAX_CATEGORIES`, `MAX_INTENTS`, `capIntents()` from `categoryUtils.ts`
- Remove truncation from `normalizeCategoryArray()`
- Convert intent UI from radio to multi-select toggle (onboarding + PreferencesSheet)
- Remove category `>= 3` cap guard (onboarding + PreferencesSheet)
- Remove all `.slice(0, 1)` intent truncation (5 call sites)
- Remove save-boundary truncation (PreferencesSheet)
- Remove `cap_message` from 56 locale files (28 locales x 2 files)
- Update copy in `categories.body` and `intents.caption` (28 locales)

**Non-goals (explicitly excluded):**
- "Select All" / "Deselect All" button — not needed, tap-each is sufficient for 6 intents and 12 categories
- Reordering selected items
- Changing the category grid layout or intent card visual design
- Any database migration or schema change
- Any edge function change
- Admin dashboard changes

**Assumptions:**
- Database `text[]` columns have no CHECK constraints on array length (verified in investigation)
- `query_pool_cards` RPC scales dynamically with any number of categories (verified: `CEIL(limit / num_categories)`)
- `generate-curated-experiences` handles N intents via `Promise.all` (verified, max 6 is fine)

---

## Decision 1: Minimum Enforcement Contract

### Onboarding — min 1 of EACH

| Surface | Rule | Enforcement Mechanism |
|---------|------|----------------------|
| Intent step | `selectedIntents.length >= 1` to proceed | "Continue" button stays disabled until >= 1 intent selected. **No change needed** — `OnboardingFlow.tsx:1973` already does this. |
| Category step | `selectedCategories.length >= 1` to proceed | "Continue" button stays disabled until >= 1 category selected. **No change needed** — `OnboardingFlow.tsx:1984` already does this. |

User said: "you must always select one from each while onboarding." This matches the current behavior exactly. No change to the minimum enforcement during onboarding.

### PreferencesSheet — min 1 of EITHER

| Surface | Rule | Enforcement Mechanism |
|---------|------|----------------------|
| Intent deselect | Block deselect if `intents.length === 1 AND categories.length === 0` | **No change needed** — `PreferencesSheet.tsx:468` already does this. Shows `min_message` toast. |
| Category deselect | Block deselect if `categories.length === 1 AND intents.length === 0` | **No change needed** — `PreferencesSheet.tsx:488` already does this. Shows `min_message` toast. |

The PreferencesSheet allows 0 categories if you have intents (and vice versa). This is correct — a user who only wants curated experiences (intents only, no categories) should be allowed to do that. The contract is: **at least 1 signal total** (intent or category).

The `min_message` copy ("Pick at least one mood or category.") already communicates this correctly. **No change to min_message strings.**

### Contract Summary

```
ONBOARDING:
  Intent step:    selectedIntents.length >= 1    (enforced by disabled CTA)
  Category step:  selectedCategories.length >= 1 (enforced by disabled CTA)

PREFERENCES SHEET:
  Global:         selectedIntents.length + selectedCategories.length >= 1
                  (enforced by blocking last-deselect + min_message toast)
```

---

## Decision 2: Intent UI Pattern

### Onboarding Intent Cards

**Current:** 6 cards in a 2-column grid. Radio behavior — tapping a card fills it with `intent.color` background + white text/icon. Tapping again deselects (goes to 0, but CTA enforces min 1). Only 1 can be selected at a time.

**New behavior:** Multi-select toggle. Tapping a card adds it to selection (fills with color). Tapping a selected card removes it. Multiple cards can be active simultaneously.

**Visual indicator:** Keep the existing color-fill pattern. When a card is selected, it fills with `intent.color` background + white text — identical to current. When unselected, gray border + dark text — identical to current. No checkmark overlay needed. The color-fill IS the selection indicator, same pattern as categories.

**No counter.** No "3 of 6 selected" text. Categories don't have one, intents shouldn't either. Consistency.

### PreferencesSheet Intent Pills

**Current:** Pill buttons in `ExperienceTypesSection`. Radio behavior — selecting one replaces the previous. Selected pill gets `experienceTypeButtonSelected` style (color fill).

**New behavior:** Multi-select toggle. Tapping adds/removes from selection. Multiple pills can be active. Selected pill keeps existing `experienceTypeButtonSelected` style.

**No visual changes to the pill component itself.** The existing selected/unselected styling works for multi-select without modification. Categories already work this way in `CategoriesSection` with identical styling.

---

## Decision 3: Copy Direction

### English Copy (authoritative — implementor translates for all 28 locales)

| Key | Current | New |
|-----|---------|-----|
| `onboarding.json` → `categories.body` | "Pick up to 3 that match your vibe." | "Pick the ones that match your vibe." |
| `onboarding.json` → `intents.caption` | "Pick the one that excites you most." | "Pick the ones that excite you." |
| `onboarding.json` → `categories.cap_message` | "Maximum 3 categories. Deselect one to choose another." | **DELETE KEY** |
| `preferences.json` → `categories.cap_message` | "3 max — drop one to add another." | **DELETE KEY** |

**Translation note:** For all 28 locales, the implementor should:
1. Delete `cap_message` keys (mechanical)
2. Update `categories.body` to remove any reference to "3" or a numeric limit (translate the English intent: "pick the ones that match" — no number)
3. Update `intents.caption` to pluralize (translate the English intent: "pick the ones that excite you" — plural, not singular)

**Copy that does NOT change:**
- `preferences:experience_types.min_message` — "Pick at least one mood or category." (stays as-is)
- `preferences:categories.min_message` — "Pick at least one mood or category." (stays as-is)
- `onboarding:intents.headline` — "Now the fun part." (stays)
- `onboarding:intents.body` — "Tap every vibe that sounds like you." (already plural, stays)
- `onboarding:categories.headline` — "What kind of places do you love?" (stays)

---

## Decision 4: "Select All" Affordance

**Decision: No.** Not in scope. The maximum number of taps to select everything is 12 (categories) + 6 (intents) = 18. This is fine. A "Select All" button adds UI complexity, creates edge cases (what happens to "Deselect All" when you're at min 1?), and solves a problem nobody has yet.

If users request it later, it can be added as a separate ORCH item.

---

## Decision 5: Deck Behavior with Many Selections

**Acknowledged behavior:**

| Scenario | Categories in RPC | Per-Category Cap (limit=200) | Curated Fetches | Deck Feel |
|----------|-------------------|------------------------------|-----------------|-----------|
| 1 category, 1 intent | 1 | 200 | 1 | Very focused |
| 3 categories, 1 intent (current max) | 3 | 67 | 1 | Focused |
| 6 categories, 3 intents | 6 | 34 | 3 | Diverse |
| 12 categories, 6 intents | 12 | 17 | 6 | "Show me everything" |

The "show me everything" state is an acceptable user choice. The deck still works correctly — the RPC distributes cards evenly, the interleave algorithm shuffles for diversity, and the curated fetches run in parallel. Performance is fine (single SQL query for categories, max 6 parallel edge function calls for intents).

**This is a product feature, not a bug.** Users who select everything get a broad, exploratory deck. Users who select 1-2 get a focused, curated deck. Both are valid use cases.

---

## Change Inventory

All 14 enforcement points are documented with exact file + line in the investigation report (`INVESTIGATION_ORCH-0424_SELECTION_LIMIT_REMOVAL.md`, "Complete Change Inventory" section). The spec does not duplicate them. The implementor MUST read the investigation report for exact code locations.

Summary:
- **7 source files** with code changes
- **56 locale files** with string changes (28 locales x 2 files)
- **0 database changes**
- **0 edge function changes**

---

## Success Criteria

| # | Criterion | How to Verify |
|---|-----------|---------------|
| SC-1 | User can select all 12 visible categories during onboarding | Tap all 12 tiles — all show selected state, no blocking toast |
| SC-2 | User can select all 6 intents during onboarding | Tap all 6 cards — all show selected state simultaneously |
| SC-3 | Onboarding "Continue" on intent step is disabled with 0 intents selected | Deselect all intents — button grays out |
| SC-4 | Onboarding "Continue" on category step is disabled with 0 categories selected | Deselect all categories — button grays out |
| SC-5 | User can select all 12 categories in PreferencesSheet | Tap all 12 pills — all selected, no "Maximum 3" toast |
| SC-6 | User can select all 6 intents in PreferencesSheet | Tap all 6 pills — all selected simultaneously |
| SC-7 | PreferencesSheet blocks deselecting last intent when categories are empty | Have 1 intent + 0 categories → tap intent → stays selected, min_message toast appears |
| SC-8 | PreferencesSheet blocks deselecting last category when intents are empty | Have 0 intents + 1 category → tap category → stays selected, min_message toast appears |
| SC-9 | No "Maximum 3" or "cap_message" toast appears anywhere in the app | Tap extensively in onboarding and PreferencesSheet — no cap toast |
| SC-10 | Deck generates correctly with 12 categories selected | Complete onboarding with all 12 → Discover screen loads cards from all categories |
| SC-11 | Deck generates correctly with 6 intents selected | Select all 6 intents → curated cards appear in deck |
| SC-12 | Collab mode loads preferences without truncation | Join a board session → preferences load all intents/categories from DB |
| SC-13 | Collab mode saves preferences without truncation | Change preferences in collab → save → reload → all selections preserved |
| SC-14 | Onboarding resume restores full arrays | Kill app during onboarding after selecting 5 categories + 3 intents → reopen → all restored |
| SC-15 | No TypeScript errors (strict mode) | `npx tsc --noEmit` passes |
| SC-16 | All 28 locale files: `cap_message` removed, body/caption updated | Grep for `cap_message` returns 0 results. Grep for "up to 3" returns 0 results. |

---

## Invariants

### Preserved Invariants

| Invariant | How Preserved | Verification |
|-----------|--------------|-------------|
| Deck requires >= 1 signal | Onboarding enforces min 1 of each. PreferencesSheet enforces min 1 of either. | SC-3, SC-4, SC-7, SC-8 |
| `normalizeCategoryArray` deduplicates and validates | Function still deduplicates, checks against VALID_SLUGS, removes hidden. Only truncation removed. | Code review + any category selection round-trip |
| Solo/collab parity | Both paths have their caps removed. Both use the same save format (text[]). | SC-12, SC-13 |

### New Invariant

| Invariant | Description |
|-----------|-------------|
| **INV-UNCAPPED-SELECTION** | No code path may truncate, slice, or cap `intents[]` or `categories[]` arrays. These arrays are unbounded in both read and write paths. Any future code that touches these arrays must not introduce size limits without a product decision. |

---

## Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Select all categories in onboarding | Tap all 12 tiles | All 12 show selected, Continue enabled | Component |
| T-02 | Select all intents in onboarding | Tap all 6 cards | All 6 show selected, Continue enabled | Component |
| T-03 | Deselect intent in onboarding | Select 3 intents, deselect 1 | 2 remain selected | Component |
| T-04 | Min-1 intent enforcement in onboarding | Select 1 intent, deselect it | 0 selected, Continue disabled | Component |
| T-05 | Min-1 category enforcement in onboarding | Select 1 category, deselect it | 0 selected, Continue disabled | Component |
| T-06 | Select all categories in PreferencesSheet | Tap all 12 pills | All 12 selected, no cap toast | Component |
| T-07 | Select all intents in PreferencesSheet | Tap all 6 pills | All 6 selected | Component |
| T-08 | Min enforcement — last intent, 0 categories | Deselect last intent | Blocked, min_message shown | Component |
| T-09 | Min enforcement — last category, 0 intents | Deselect last category | Blocked, min_message shown | Component |
| T-10 | Min enforcement — last intent, 1+ categories | Deselect last intent | Allowed (categories provide signal) | Component |
| T-11 | Save round-trip with 12 categories + 6 intents | Apply preferences → close → reopen sheet | All 18 selections preserved | Full stack |
| T-12 | Deck generation — 12 categories | Apply 12 categories → view Discover | Cards from multiple categories appear | Full stack |
| T-13 | Deck generation — 6 intents | Apply 6 intents → view Discover | Curated cards appear | Full stack |
| T-14 | Collab save/load — multi-select | In collab: select 5 cats + 3 intents → save → other user joins | All selections visible in board | Full stack |
| T-15 | Onboarding resume | Select 5 cats + 3 intents → kill app → reopen | All 8 selections restored | Hook |
| T-16 | Auth prefetch — multi-intent | Sign in with 4 intents saved → deck query key built | Key includes all 4 intents | Hook |
| T-17 | No cap_message in any locale | Grep for `cap_message` in locale files | 0 results | i18n |
| T-18 | No "up to 3" in any locale | Grep for "up to 3" or equivalent in category body | 0 results | i18n |
| T-19 | No `.slice(0, 1)` on intents anywhere | Grep for `.slice(0, 1)` near intents | 0 results | Code |
| T-20 | TypeScript clean | `npx tsc --noEmit` | 0 errors | Build |

---

## Implementation Order

| Step | File(s) | What Changes |
|------|---------|-------------|
| 1 | `app-mobile/src/utils/categoryUtils.ts` | Remove `MAX_CATEGORIES`, `MAX_INTENTS`, `capIntents`. Remove `maxCategories` param + `break` from `normalizeCategoryArray`. |
| 2 | `app-mobile/src/components/OnboardingFlow.tsx` | Intent toggle → multi-select. Remove category `>= 3` guard + cap toast + `categoryCapMessage` state. Remove `.slice(0,1)` on save. Remove second arg from `normalizeCategoryArray` call. |
| 3 | `app-mobile/src/components/PreferencesSheet.tsx` | Intent toggle → multi-select. Remove category `>= MAX_CATEGORIES` guard + cap toast + `categoryCapMessage` state. Remove save truncation. Update imports (remove `MAX_CATEGORIES`, `MAX_INTENTS`, `capIntents`). Remove `capIntents` from collab/solo load. Remove second arg from `normalizeCategoryArray` calls. |
| 4 | `app-mobile/src/contexts/RecommendationsContext.tsx` | Remove `.slice(0,1)` on intents + stale comment. |
| 5 | `app-mobile/src/components/AppHandlers.tsx` | Remove `.slice(0,1)` on intents. |
| 6 | `app-mobile/src/hooks/useAuthSimple.ts` | Remove `.slice(0,1)` on intents. |
| 7 | `app-mobile/src/hooks/useOnboardingResume.ts` | Remove `.slice(0,1)` on intents. |
| 8 | 28x `onboarding.json` locales | Delete `cap_message`. Update `categories.body` (remove "up to 3"). Update `intents.caption` (pluralize). |
| 9 | 28x `preferences.json` locales | Delete `categories.cap_message`. |

---

## Regression Prevention

**Structural safeguard:** The `MAX_CATEGORIES` and `MAX_INTENTS` constants are deleted entirely, not set to a higher number. There is no constant to accidentally reference. `capIntents()` is deleted. Any future code that tries to import these will get a build-time error.

**Grep-based check:** After implementation, the following greps must return 0 results:
- `MAX_CATEGORIES` in `app-mobile/src/`
- `MAX_INTENTS` in `app-mobile/src/`
- `capIntents` in `app-mobile/src/`
- `.slice(0, 1)` near `intent` in `app-mobile/src/` (excluding unrelated slices)
- `cap_message` in `app-mobile/src/i18n/`

**New invariant comment:** Add a comment in `categoryUtils.ts` where the constants used to be:
```ts
// ORCH-0424: Selection limits removed. intents[] and categories[] are unbounded.
// Do NOT reintroduce caps without a product decision.
```

---

## Discoveries for Orchestrator

None. Clean, self-contained change.
