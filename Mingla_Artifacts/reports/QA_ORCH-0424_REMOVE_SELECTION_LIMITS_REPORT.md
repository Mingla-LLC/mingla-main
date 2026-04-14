# QA Report: ORCH-0424 — Remove Max Selection Limits on Intents & Categories

**Tester:** Mingla Tester
**Date:** 2026-04-14
**Spec:** `SPEC_ORCH-0424_REMOVE_SELECTION_LIMITS.md`
**Implementation:** `IMPLEMENTATION_ORCH-0424_REMOVE_SELECTION_LIMITS_REPORT.md`
**Mode:** SPEC-COMPLIANCE + TARGETED

---

## Verdict: PASS

**P0: 0 | P1: 0 | P2: 0 | P3: 1 | P4: 1**

---

## Test Matrix Results

| Test | Scenario | Result | Evidence |
|------|----------|--------|----------|
| T-01 | Select all 12 categories in onboarding | **PASS** | `OnboardingFlow.tsx:2789-2794` — pure toggle, no guard. All 12 selectable. |
| T-02 | Select all 6 intents in onboarding | **PASS** | `OnboardingFlow.tsx:2454-2456` — `filter` for off, spread for on. Multi-select confirmed. |
| T-03 | Deselect intent in onboarding | **PASS** | Line 2455: `p.selectedIntents.filter(i => i !== intent.id)` — removes single item. |
| T-04 | Min-1 intent enforcement in onboarding | **PASS** | `OnboardingFlow.tsx:1968` — `disabled: data.selectedIntents.length === 0`. Unchanged, intact. |
| T-05 | Min-1 category enforcement in onboarding | **PASS** | `OnboardingFlow.tsx:1979` — `disabled: data.selectedCategories.length === 0`. Unchanged, intact. |
| T-06 | Select all 12 categories in PreferencesSheet | **PASS** | `PreferencesSheet.tsx:477-488` — no MAX guard. Pure toggle. |
| T-07 | Select all 6 intents in PreferencesSheet | **PASS** | `PreferencesSheet.tsx:460-469` — `filter` for off, spread for on. Multi-select. |
| T-08 | Min enforcement — last intent, 0 categories | **PASS** | `PreferencesSheet.tsx:463` — `prev.length === 1 && selectedCategoriesRef.current.length === 0` blocks deselect. Unchanged. |
| T-09 | Min enforcement — last category, 0 intents | **PASS** | `PreferencesSheet.tsx:482` — `prev.length === 1 && selectedIntentsRef.current.length === 0` blocks deselect. Unchanged. |
| T-10 | Min enforcement — last intent, 1+ categories | **PASS** | Guard only triggers when categories also empty. With categories > 0, filter executes. Correct. |
| T-11 | Save round-trip (no truncation) | **PASS** | `PreferencesSheet.tsx:782-783` — `finalCategories = selectedCategories`, `finalIntents = selectedIntents`. No slice, no cap. |
| T-12 | Deck generation — 12 categories | **PASS** | `RecommendationsContext.tsx:346` — `normalizeCategoryArray(rawCats)` (one arg, no truncation). Line 359-363: `categories: cats` — full array. |
| T-13 | Deck generation — 6 intents | **PASS** | `RecommendationsContext.tsx:364` — `intents: ints`. Full array, no slice. |
| T-14 | Collab save/load (no truncation) | **PASS** | `PreferencesSheet.tsx:282` — collab: `Array.isArray(prefs.intents) ? prefs.intents : []`. No capIntents wrapper. Solo: line 363 identical pattern. |
| T-15 | Onboarding resume | **PASS** | `useOnboardingResume.ts:157` — `base.selectedIntents = prefs.intents ?? []`. No slice. |
| T-16 | Auth prefetch — multi-intent | **PASS** | `useAuthSimple.ts:121` — `const normalizedIntents = prefs.intents ?? []`. No slice. |
| T-17 | No cap_message in any locale | **PASS** | Grep `cap_message` across `app-mobile/src/i18n/` — 0 results. |
| T-18 | No "up to 3" in any locale | **PASS** | Grep `up to 3` (case-insensitive) across `app-mobile/src/i18n/` — 0 results. |
| T-19 | No .slice(0, 1) on intents | **PASS** | Grep `.slice(0, 1)` across `app-mobile/src/` — 0 results. |
| T-20 | TypeScript clean | **PASS** | `npx tsc --noEmit` — 0 errors. |

**20/20 PASS.**

---

## Invariant Verification

| Invariant | Preserved | Evidence |
|-----------|-----------|---------|
| Deck requires >= 1 signal | **YES** | Onboarding CTA guards at lines 1968, 1979 intact. PreferencesSheet cross-checks at lines 463, 482 intact. |
| normalizeCategoryArray deduplicates | **YES** | `categoryUtils.ts:179-198` — Set for dedup, VALID_SLUGS for validation, HIDDEN_CATEGORY_SLUGS for filtering. All intact. No `break`, no `maxCategories`. |
| Solo/collab parity | **YES** | PreferencesSheet collab load (line 282) and solo load (line 363) both pass arrays without capIntents. Symmetric. |
| INV-UNCAPPED-SELECTION | **YES** | Zero results for MAX_CATEGORIES, MAX_INTENTS, capIntents, .slice(0,1) across entire src/. Protective comment at categoryUtils.ts:8-9. |

---

## Constitutional Compliance

| # | Rule | Status | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | **N/A** | No new interactive elements. Existing taps work (toggle on/off). |
| 2 | One owner per truth | **PASS** | categories/intents arrays still owned by PreferencesSheet (save) and preferences DB (source). No duplication introduced. |
| 3 | No silent failures | **N/A** | No error paths changed. |
| 4 | One key per entity | **N/A** | No query keys changed (still use same factory). |
| 5 | Server state server-side | **PASS** | No Zustand changes. |
| 6 | Logout clears everything | **N/A** | No new persisted data. |
| 7 | Label temporary | **PASS** | No transitional items. |
| 8 | Subtract before adding | **PASS** | This change is pure subtraction — constants, functions, guards, truncation all removed. No new code layered on broken code. |
| 9 | No fabricated data | **N/A** | No display data changed. |
| 10 | Currency-aware | **N/A** | Not applicable. |
| 11 | One auth instance | **N/A** | No auth changes. |
| 12 | Validate at right time | **N/A** | No validation timing changed. |
| 13 | Exclusion consistency | **N/A** | No exclusion rules changed. |
| 14 | Persisted-state startup | **PASS** | `useOnboardingResume.ts` passes full array on cold restore. No new truncation on hydration. |

**0 constitutional violations.**

---

## Regression Surface Check

| Area | Status | Evidence |
|------|--------|---------|
| Onboarding flow end-to-end | **SAFE** | CTA guards intact. Intent/category selection logic is pure toggle. Save path passes full arrays. normalizeCategoryArray still normalizes. |
| PreferencesSheet apply | **SAFE** | Save path unchanged in structure — just removed truncation. `finalCategories`/`finalIntents` still flow into the same preferences object. |
| Deck generation | **SAFE** | RecommendationsContext passes full arrays. deckService.resolvePills iterates dynamically. query_pool_cards RPC unchanged. |
| Collab mode preferences | **SAFE** | Collab load/save both updated to pass full arrays. aggregateAllPrefs uses union (Set), no cap. |
| Profile display interests | **SAFE** | EditInterestsSheet was already uncapped (not touched by this change). |

---

## Findings

### P3 — Stale JSDoc comment

**File:** `app-mobile/src/utils/categoryUtils.ts:174`
**Code:** `* array of visible slug IDs capped at \`maxCategories\`.`
**Issue:** JSDoc still references the removed `maxCategories` parameter.
**Fix:** Update to `* array of visible slug IDs.`
**Severity:** P3 — documentation-only, no runtime impact.

### P4 — Clean implementation (praise)

The implementation is pure subtraction — removing constants, functions, guards, and truncation without introducing any new complexity. The toggle pattern matches the existing EditInterestsSheet exactly. Every enforcement point from the investigation was addressed. Exemplary spec-to-code traceability.

---

## Discoveries for Orchestrator

None.
