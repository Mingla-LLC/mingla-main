# Implementation Report: ORCH-0424 — Remove Max Selection Limits on Intents & Categories

**Implementor:** Mingla Implementor
**Date:** 2026-04-14
**Spec:** `SPEC_ORCH-0424_REMOVE_SELECTION_LIMITS.md`
**Investigation:** `INVESTIGATION_ORCH-0424_SELECTION_LIMIT_REMOVAL.md`
**Status:** Implemented and verified
**Verification:** Passed (TypeScript clean, all grep regression checks zero results)

---

## Old -> New Receipts

### categoryUtils.ts
**What it did before:** Exported `MAX_CATEGORIES = 3`, `MAX_INTENTS = 1`, and `capIntents()`. `normalizeCategoryArray()` took a `maxCategories` parameter (default 3) and truncated results.
**What it does now:** Constants and cap function removed entirely. `normalizeCategoryArray()` normalizes without truncating. Protective comment added: "Do NOT reintroduce caps without a product decision."
**Why:** Spec Decision 1 + Investigation Findings 1-3
**Lines changed:** ~10

### OnboardingFlow.tsx
**What it did before:** Intent selection was radio (single-select, replacing previous choice). Category selection capped at 3 with toast message. Save path truncated intents to `.slice(0,1)`.
**What it does now:** Intent selection is multi-select toggle (add/remove from array). No category cap — all 12 selectable. No cap toast. Save path passes full arrays. `categoryCapMessage` state removed.
**Why:** Spec Decisions 1-2 + Investigation Findings 4-6
**Lines changed:** ~15

### PreferencesSheet.tsx
**What it did before:** Intent toggle was radio. Category toggle capped at `MAX_CATEGORIES`. Collab/solo load ran `capIntents()`. Save path truncated both arrays. Imported `MAX_CATEGORIES`, `MAX_INTENTS`, `capIntents`.
**What it does now:** Intent toggle is multi-select. No category cap. Collab/solo load passes arrays as-is. Save passes arrays as-is. Import reduced to `normalizeCategoryArray` only. `categoryCapMessage` state and `capMessage` prop removed.
**Why:** Spec Decisions 1-2 + Investigation Findings 7-9
**Lines changed:** ~20

### RecommendationsContext.tsx
**What it did before:** `stableDeckParams` capped intents to `.slice(0, 1)` with comment about "Radio behavior." `normalizeCategoryArray` called with second arg.
**What it does now:** Passes full intents array. Second arg removed from `normalizeCategoryArray` call.
**Why:** Investigation Finding 10
**Lines changed:** 4

### AppHandlers.tsx
**What it did before:** Solo intents truncated via `.slice(0, 1)`.
**What it does now:** Passes full array.
**Why:** Investigation Finding 11
**Lines changed:** 1

### useAuthSimple.ts
**What it did before:** Normalized intents via `.slice(0, 1)`. `normalizeCategoryArray` called with second arg.
**What it does now:** Passes full arrays. Second arg removed.
**Why:** Investigation Finding 12
**Lines changed:** 3

### useOnboardingResume.ts
**What it did before:** Restored intents via `.slice(0, 1)`.
**What it does now:** Passes full array.
**Why:** Investigation Finding 13
**Lines changed:** 1

### 29 onboarding.json locale files
**What they did before:** Had `categories.cap_message` ("Maximum 3 categories..."), `categories.body` referencing "up to 3", `intents.caption` singular ("the one").
**What they do now:** `cap_message` deleted. `body` updated to remove numeric limits. `caption` pluralized.
**Why:** Spec Decision 3 + Investigation Finding 14

### 29 preferences.json locale files
**What they did before:** Had `categories.cap_message` ("3 max — drop one to add another.").
**What they do now:** `categories.cap_message` deleted.
**Why:** Spec Decision 3 + Investigation Finding 14

---

## Spec Traceability

| SC | Criterion | Verified | How |
|----|-----------|----------|-----|
| SC-1 | Select all 12 categories during onboarding | Code review | `>= 3` guard removed, no other cap exists |
| SC-2 | Select all 6 intents during onboarding | Code review | Radio replaced with toggle, no cap |
| SC-3 | Continue disabled with 0 intents | Preserved | Line 1973 unchanged |
| SC-4 | Continue disabled with 0 categories | Preserved | Line 1984 unchanged |
| SC-5 | Select all 12 categories in PreferencesSheet | Code review | `>= MAX_CATEGORIES` guard removed |
| SC-6 | Select all 6 intents in PreferencesSheet | Code review | Radio replaced with toggle |
| SC-7 | Block last intent deselect (0 categories) | Preserved | PreferencesSheet:468 unchanged |
| SC-8 | Block last category deselect (0 intents) | Preserved | PreferencesSheet:488 unchanged |
| SC-9 | No cap_message toast anywhere | PASS | Grep returns 0 results |
| SC-10 | Deck with 12 categories | Unverified | Needs runtime test |
| SC-11 | Deck with 6 intents | Unverified | Needs runtime test |
| SC-12 | Collab load without truncation | Code review | capIntents removed from load path |
| SC-13 | Collab save without truncation | Code review | Save truncation removed |
| SC-14 | Onboarding resume full arrays | Code review | .slice(0,1) removed from useOnboardingResume |
| SC-15 | TypeScript clean | PASS | `npx tsc --noEmit` — 0 errors |
| SC-16 | All locale files updated | PASS | Grep cap_message=0, grep "up to 3"=0 |

---

## Invariant Verification

| Invariant | Preserved | Evidence |
|-----------|-----------|---------|
| Deck requires >= 1 signal | YES | Onboarding CTA guards unchanged. PreferencesSheet min-1 cross-check unchanged. |
| normalizeCategoryArray deduplicates | YES | Only truncation removed; dedup/validate/hidden-filter logic intact. |
| Solo/collab parity | YES | Both paths updated identically. |
| INV-UNCAPPED-SELECTION (new) | YES | No code path truncates intents[] or categories[]. Protective comment added. |

---

## Regression Checks (grep-based)

| Check | Result |
|-------|--------|
| `MAX_CATEGORIES` in app-mobile/src/ | 0 results |
| `MAX_INTENTS` in app-mobile/src/ | 0 results |
| `capIntents` in app-mobile/src/ | 0 results |
| `.slice(0, 1)` near intents | 0 results |
| `cap_message` in i18n/ | 0 results |
| `normalizeCategoryArray(.*,` (second arg) | 0 results |
| `up to 3` in i18n/ | 0 results |

---

## Regression Surface (for tester)

1. **Onboarding flow** — complete a fresh onboarding selecting multiple intents and categories
2. **PreferencesSheet** — open, select many, save, reopen — verify persistence
3. **Deck generation** — verify cards appear from multiple selected categories
4. **Collab mode** — join a board, change preferences, verify no truncation
5. **Onboarding resume** — kill app mid-onboarding, reopen, verify selections restored

---

## Discoveries for Orchestrator

None. Clean implementation, no side issues found.
