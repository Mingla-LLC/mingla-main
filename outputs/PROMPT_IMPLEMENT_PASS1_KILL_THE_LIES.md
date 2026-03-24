# Implementation Prompt: Pass 1 — Kill the Lies

**Skill:** Implementor
**Date:** 2026-03-24
**Spec:** outputs/SPEC_PASS1_KILL_THE_LIES.md (APPROVED — read it fully before starting)
**Scope:** 6 fixes across 10 files. Zero schema changes, zero edge function changes, zero new components.

---

## What To Do

Read `outputs/SPEC_PASS1_KILL_THE_LIES.md` in full. It contains exact before/after code for every change, prop chain analysis, edge cases, and 27 test criteria.

Implement all 6 fixes:

1. **Fix 1a:** Remove 5 fabricated fallbacks from SavedTab + BoardSessionCard (fake ratings, travel times, prices). Hide when missing or show "—".
2. **Fix 1b:** Hide "0.0 ★" rating badge on SwipeableCards when rating is null/0.
3. **Fix 1c:** Wire currency to 7 surfaces using the exact approach in the spec (1 new prop + 4 hook calls).
4. **Fix 1d:** SavedTab curated title: `card.title` instead of stop names joined with arrows.
5. **Fix 1e:** PracticalDetailsSection: add openingHours to hasAnyDetails + render hours section.
6. **Fix 1f:** Replace paper-plane icon with `getTravelModeIcon(card.travelMode)` on SavedTab + BoardSessionCard.

## Files to Modify (10)

1. `app-mobile/src/components/activity/SavedTab.tsx` — Fixes 1a, 1d, 1f
2. `app-mobile/src/components/board/BoardSessionCard.tsx` — Fixes 1a, 1c, 1f
3. `app-mobile/src/components/SwipeableCards.tsx` — Fixes 1b, 1c (pass-through)
4. `app-mobile/src/components/CuratedExperienceSwipeCard.tsx` — Fix 1c
5. `app-mobile/src/components/expandedCard/CardInfoSection.tsx` — Fix 1c
6. `app-mobile/src/components/ExpandedCardModal.tsx` — Fix 1c
7. `app-mobile/src/components/PersonGridCard.tsx` — Fix 1c
8. `app-mobile/src/components/PersonCuratedCard.tsx` — Fix 1c
9. `app-mobile/src/components/PersonHolidayView.tsx` — Fix 1c
10. `app-mobile/src/components/expandedCard/PracticalDetailsSection.tsx` — Fix 1e

## Constraints

- Do NOT change any edge function or migration
- Do NOT change the scoring algorithm or deck logic
- Do NOT change the save/schedule flow
- Do NOT refactor icon systems into shared utility (that's Pass 5)
- Do NOT add new components
- Do NOT change the data shape from the server
- Do NOT touch price formatting in SavedTab single/curated — those already work
- Follow the spec's exact before/after code. If you find the actual code differs from what the spec says, note the discrepancy and adapt — but keep the same intent.

## Constitution Compliance

- Principle 1: Show truth or nothing (no fabricated data)
- Principle 2: One owner per truth (currency from user profile, not hardcoded)
- Principle 8: Subtract before adding (removing fake fallbacks)

## Success Criteria

All 27 test criteria in the spec pass. No TypeScript errors. No regressions on surfaces that already worked.

## Output

After implementation, provide:
1. List of files changed with brief description of each change
2. Any discrepancies found between spec and actual code
3. Any edge cases discovered during implementation

Write implementation report to `outputs/IMPLEMENTATION_PASS1_KILL_THE_LIES.md`.
