# IMPLEMENTATION — ORCH-1144 [universal experience-create chooser] — in-sheet UX refinement

**Date:** 2026-06-15
**Branch / worktree:** `orch-1144-universal-experience-chooser` @ `~/Desktop/mingla-orchs/orch-1144-[universal-experience-chooser]`
**Type:** UX refinement on already-shipped ORCH-1144 base (folds the separate `/experience/choose` sheet into `UniversalCreatorSheet` as an in-place step).
**Status:** implemented and verified (source + jest + audit + typecheck; on-device sim render is the tester's remaining step).

---

## 1. Summary

On iOS, tapping `+` → "Create experience" used to DISMISS the dropdown sheet and open a SEPARATE second sheet (the `/experience/choose` route rendering `ExperienceCreateChooser`) — a discontinuous sheet-swap. The 3-option experience chooser is now an **in-place step inside the same `UniversalCreatorSheet`**. The experience row no longer navigates; it transitions the open sheet from step "root" to step "experience". The destinations (snap flow, manual wizard) stay their own dedicated screens. The separate route + standalone chooser component are retired.

## 2. SPEC / dispatch criteria coverage

| # | Criterion | Result | Commit |
|---|-----------|--------|--------|
| 1 | `+` → Create experience steps the SAME sheet in-place to "experience" (no nav, sheet stays open) | ✓ `step: "experience"` on the experience RootOption; `handleRootSelect` calls `setStep` | <HASH> |
| 2 | Create event → `/event/create` + close; Create trip → `/trip/create` + close (unchanged) | ✓ root options keep `route:` → `pushRoute` (close+push) | <HASH> |
| 3 | Experience step: heading "Create An Experience" + 3 rows → snap?mode=menu / snap?mode=activities / create, each close+push | ✓ `EXPERIENCE_OPTIONS` lifted verbatim from the retired chooser | <HASH> |
| 4 | Back affordance returns to root; reset to entry step on (re)open | ✓ `chevL` "Back" when `canGoBackToRoot`; `useEffect` resets `step` to `initialStep` on open | <HASH> |
| 5 | Hub Experiences tab CTA opens the sheet directly at the experience step | ✓ local `UniversalCreatorSheet` instance, `initialStep="experience"`, `creatorOpen` state | <HASH> |
| 6 | Separate-sheet path retired, no dead route, no live nav to `/experience/choose` | ✓ deleted `app/experience/choose.tsx` + `ExperienceCreateChooser.tsx`; 0 live navs | <HASH> |
| 7 | `heightMode="compact"` (DEC-152) honored | ✓ unchanged; both steps are header + 3 rows | <HASH> |
| 8 | Android glass opaque-fallback preserved | ✓ lifted `ROW_BG`/`ROW_BG_PRESSED`/`ROW_ICON_BG` Platform.select onto the experience-step rows | <HASH> |
| 9 | No `venueCategory`/`canGenerate*` reintroduced | ✓ grep-clean (regex member-access + equality + predicate all 0) | <HASH> |
| 10 | Tests updated to reflect in-sheet step, adversarial angle intact | ✓ tester (C) now asserts in-place step + route-retired; contract repointed to sheet | <HASH> |

## 3. Files changed

| File | Change | ~lines |
|------|--------|--------|
| `mingla-business/src/components/ui/UniversalCreatorSheet.tsx` | Rewrote as a two-step sheet (root + experience); added `initialStep` prop + `step` state + reset-on-open + in-place transition + back affordance; lifted `EXPERIENCE_OPTIONS` + Android opaque-fallback styles from the retired chooser. | +220 / -70 |
| `mingla-business/app/(tabs)/hub/experiences.tsx` | CTA `router.push("/experience/choose")` → local `UniversalCreatorSheet` (`initialStep="experience"`, `creatorOpen` state + mount); import + doc-comment update. | +20 / -3 |
| `mingla-business/app/experience/snap.tsx` | Doc-comment only: "reached from the in-sheet experience chooser" (was `/experience/choose`). | 1 |
| `mingla-business/app/experience/choose.tsx` | **DELETED** (route retired). | -54 |
| `mingla-business/src/components/experience/ExperienceCreateChooser.tsx` | **DELETED** (folded into the sheet). | -241 |
| `mingla-business/app/experience/__tests__/orch1144Chooser.tester.adversarial.test.ts` | (A) reads experience routes from the sheet's `EXPERIENCE_OPTIONS`; (C) asserts the route is retired + the experience row steps in-place (not push) + the step renders the 3 destinations. Adversarial angle (dead-tap stat + category-agnostic + entry wiring) intact. `[TEST-MOD-APPROVED ORCH-1144]`. | +~35 / -~20 |
| `mingla-business/app/(tabs)/hub/__tests__/hubExperiences.contract.test.ts` | `CHOOSER` constant repointed from the deleted `ExperienceCreateChooser.tsx` to `UniversalCreatorSheet.tsx`. `[TEST-MOD-APPROVED ORCH-1144]`. | +~6 / -~6 |

## 4. Hub-tab entry-point wiring (how)

The Hub `UniversalCreatorSheet` lives in `hub/_layout.tsx` (shared chrome), but `experiences.tsx` is a content-only child route with no access to that layout's open-state. Rather than plumb shared cross-route state, the experiences tab mounts its **own** `UniversalCreatorSheet` instance with a local `creatorOpen` boolean — this matches the documented "each consumer owns its own `[isCreatorOpen, setIsCreatorOpen]`" pattern (Home/Account/Marketing already each own one). The CTA flips `creatorOpen` true; the sheet opens at `initialStep="experience"`. This is the light wiring; no layout refactor needed.

## 5. Back-affordance behavior (chosen)

`canGoBackToRoot = step === "experience" && initialStep === "root"`. The "Back" affordance (a `chevL` + "Back" pressable in the experience-step header) renders **only when there is a root to return to** — i.e. when opened from `+`. When opened directly at the experience step (Hub tab, `initialStep="experience"`), the back affordance is **omitted** — the scrim/close is the way out. Chosen over a back-arrow-that-just-closes because a back arrow implying "previous step" when there is none is misleading.

## 6. Regression tests

- **Tester adversarial** (`orch1144Chooser.tester.adversarial.test.ts`) — 10 tests PASS. (A) dead-tap route stat from the in-sheet `EXPERIENCE_OPTIONS`; (B) category-agnostic snap parse-mode; (C) **in-place step**: route fully retired + experience option carries `step:` not `route:` + the 3 destinations render.
- **Implementor contract** (`hubExperiences.contract.test.ts`) — 4 tests PASS, repointed to the sheet.
- **fails-on-revert verified at <HASH>:** reverting the experience RootOption from `step: "experience"` back to `route: "/experience/choose"` → tester (C) fails 2 assertions ("route fully retired" + "steps IN-PLACE"); restoring → all 10 pass. Captured live this session.

Both test files are modify-with-deletion → commit body carries `[TEST-MOD-APPROVED ORCH-1144]`.

## 7. Old → New receipts

### UniversalCreatorSheet.tsx
- **Before:** single-step sheet; the experience option had `route: "/experience/choose"`; `handleSelect` always close+push.
- **Now:** two-step sheet; the experience option has `step: "experience"` (in-place, no nav); `handleRootSelect` branches step-vs-route; experience step renders the lifted 3-option chooser + a conditional back affordance; resets to `initialStep` on open.
- **Why:** dispatch — kill the discontinuous sheet-swap; keep the chooser in the same sheet.

### app/(tabs)/hub/experiences.tsx
- **Before:** "New experience" CTA `router.push("/experience/choose")`.
- **Now:** CTA opens a local `UniversalCreatorSheet` at `initialStep="experience"`.
- **Why:** the chooser route is retired; the CTA opens the in-sheet step instead.

### choose.tsx / ExperienceCreateChooser.tsx
- **Before:** route mounted the standalone chooser sheet.
- **Now:** deleted; the chooser is in-sheet.
- **Why:** no second sheet; no dead route.

## 8. Cross-surface impact

| Surface | Affected | Detail |
|---------|----------|--------|
| Business iOS | YES | `+`→Create experience now steps in-place; Hub Experiences CTA opens the in-sheet step. Shared RN code. |
| Business Android | YES | Same; Android opaque-fallback preserved on the experience-step rows. Shared RN code, automatic parity. |
| Business Web preview (adjacent) | YES | Same RN codebase renders on web; sheet step works identically (no native dep). |
| Consumer iOS / Android | NO | `UniversalCreatorSheet` is business-app only. |
| Buyer/anonymous Web | NO | Creator sheet is authenticated business chrome. |
| Admin Web (adjacent) | NO | Separate `mingla-admin` codebase. |

Parity is automatic (single shared RN component) across all 3 affected business surfaces.

## 9. Smoke result

Not run on device this turn (pure-JS RN change; no native compilation). Verified via jest (14 tests) + the source-grep adversarial suite + typecheck. On-sim/device render of the in-place transition + Hub-tab entry is the tester's step.

## 10. Known issues / deferred

None. No `[TRANSITIONAL]` code introduced.

## 11. Operator action required

- None for DB/edge (no migration, no edge fn).
- Route to orchestrator REVIEW → tester for on-device verification of the in-place step animation + Hub-tab entry + back affordance.

## 12. Discoveries for orchestrator

- The implementor's prior-phase contract test (`hubExperiences.contract.test.ts`) had to be repointed because it read the now-deleted `ExperienceCreateChooser.tsx`. Done under the same `[TEST-MOD-APPROVED ORCH-1144]` token. No new ORCH needed.
- An untracked `Mingla_Artifacts/reports/TEST_ORCH-1144.md` (a prior tester report) was present in the worktree before this turn; left untouched / unstaged (not mine to commit).
