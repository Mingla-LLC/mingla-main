# QA Report — ORCH-1014 [Intelligence Trial consolidation — prune photo pages + per-city Seed/Refresh readiness badges]

**Date**: 2026-05-30
**Tester**: Claude (adversarial QA, mingla-tester)
**Branch**: `ORCH-1014-intel-trial-consolidation-photo-prune-readiness-badges`
**PR**: #268 (OPEN)
**Commit at QA**: `2b736bb46` (QA adversarial tests) on top of `a20b67c14`

---

## Verdict: **FAIL** (P0 blockers)

The implementation work itself (Finding A prune + Finding B badges) is largely correct — 36/36 implementor tests pass, live-DB numbers match SPEC (Washington 1,706 missing / Raleigh 1,097 missing / 0 stale across all 9 servable cities), schema scoping is correct, the 90-day stale logic and missing-fields predicate are sound, and the helper extraction is non-tautological.

**HOWEVER**, the branch ships with two unresolved git merge conflict markers in production files. The Vite production build FAILS, and the strict-grep CI gate FAILS to even parse. The implementor's report claims `npm run build → exit 0` and "C7 gate passes" — both claims are stale (measured before the bad merge with ORCH-1013).

**Cannot ship until the two merge conflict files are resolved.** Estimated fix: 2 minutes (preserve both branches' content in each conflict).

---

## Findings

| Severity | Code | Title | Locus | Status |
|---|---|---|---|---|
| **P0** | F-1 | Unresolved merge conflict in `IntelligenceOverviewTab.jsx` lines 30-37 (`<<<<<<< HEAD … >>>>>>> ecfc84d18`); breaks `npm run build` with `Unexpected token '<<'`. Both branches' imports (ORCH-1013 RunRemainderOnAllConfirmModal + useBulkRunDispatcher AND ORCH-1014 SeedStatusBadge + RefreshStatusBadge) are actually USED downstream — must preserve all 4 imports. | `mingla-admin/src/components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx:30-37` | OPEN |
| **P0** | F-2 | Unresolved merge conflict in strict-grep CI gate lines 1080-1084; `node` fails to parse with `SyntaxError: Unexpected token '<<'`. Both `ORCH_1013_BACKEND_ALLOWLIST` and `ORCH_1014_BACKEND_ALLOWLIST` are defined and need to be spread. Without resolution, the C7 (no-new-backend-files) gate is silently bypassed in CI. | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs:1080-1084` | OPEN |
| **P2** | F-3 | RefreshStatusBadge renders `"(0 stale)"` sub-line when `missingFieldsCount > 0 && staleRefreshCount === 0`. Visually noisy (matches every single city today, since live DB has 0 stale everywhere). Implementor's test 4 line 43 locks this as intentional; suggest hiding the sub-line when staleRefreshCount===0 to reduce visual noise. Pure-JS helper change — does not block ship. | `mingla-admin/src/components/placeIntelligenceTrial/seedRefreshBadgeContent.js:93` | DEFERRED (fix-forward) |
| **P3** | F-4 | Badges have no `aria-label`. Text is fully informative (no icon-only state), and `data-testid` exists, but screen readers won't announce "warning" / "success" semantics. Not a regression vs. existing admin UI patterns. | `SeedStatusBadge.jsx` + `RefreshStatusBadge.jsx` | NOT BLOCKING |
| **P3** | F-5 | The bundled admin dist (`dist/assets/index-CUtKVwnb.js`) is STALE — it contains "Seed status" / "Refresh status" strings because the build succeeded BEFORE the bad merge, but a fresh `npm run build` now fails. Should be regenerated after F-1 resolution. | `mingla-admin/dist/assets/index-CUtKVwnb.js` | RESOLVES WITH F-1 |

---

## How to fix the P0s (one-line guidance for the implementor)

### F-1: `IntelligenceOverviewTab.jsx` lines 30-37
Replace the entire conflict block with:
```jsx
// ORCH-1013 Finding B — bulk launch ("Run remainder on all").
import { RunRemainderOnAllConfirmModal } from "./RunRemainderOnAllConfirmModal";
import { useBulkRunDispatcher } from "../../hooks/useBulkRunDispatcher";
import { SeedStatusBadge } from "./SeedStatusBadge";
import { RefreshStatusBadge } from "./RefreshStatusBadge";
```
All 4 imports are used downstream (lines 32, 72, 353, 359, 464). The merge tool picked one branch; should have picked both.

### F-2: strict-grep gate lines 1080-1084
Replace the conflict block with:
```js
    ...ORCH_1013_BACKEND_ALLOWLIST,
    ...ORCH_1014_BACKEND_ALLOWLIST,
```
Both allowlists are defined above (lines 1007 + 1022). Same pattern as F-1 — needed both.

---

## Adversarial test inventory

Committed as `2b736bb46` ("[ORCH-1014] QA adversarial tests (3 files, 24 cases, 2 currently FAIL on P0)").

| File | Path | Cases | Currently |
|---|---|---|---|
| Merge conflict scanner | `mingla-admin/src/__tests__/orch1014_adversarial_no_merge_conflicts.test.js` | 8 | **6 PASS / 2 FAIL (P0 evidence)** |
| Edge fn contracts | `mingla-admin/src/__tests__/orch1014_adversarial_edge_fn_contracts.test.js` | 8 | 8/8 PASS |
| Badge helper edge cases | `mingla-admin/src/__tests__/orch1014_adversarial_badge_edge_cases.test.js` | 8 | 8/8 PASS |
| **Total adversarial** | | **24** | **22 PASS / 2 P0 FAIL (intentional fail-on-revert)** |

**Fails-on-revert evidence**: the 2 failing cases in the merge-conflict scanner are the canonical fail-on-revert signals for the two P0s. Once the implementor resolves the conflicts, all 24 adversarial tests pass.

---

## Implementor test verification (36/36 pass)

Re-ran independently from the QA branch:

| Suite | Path | Pass / Total |
|---|---|---|
| Sidebar post-prune | `mingla-admin/src/__tests__/orch1014_sidebar_post_prune.test.js` | 7 / 7 |
| Seed status badge | `mingla-admin/src/__tests__/orch1014_seed_status_badge.test.js` | 5 / 5 |
| Refresh status badge | `mingla-admin/src/__tests__/orch1014_refresh_status_badge.test.js` | 8 / 8 |
| Overview 3 columns | `mingla-admin/src/__tests__/orch1014_overview_three_columns.test.js` | 7 / 7 |
| Edge fn aggregation | `supabase/functions/run-place-intelligence-trial/__tests__/intelligence_coverage_seed_refresh.test.ts` | 9 / 9 |
| **Total** | | **36 / 36** |

**Non-tautology audit** — all 4 admin test files inspect actual source files via `fs.readFileSync` + regex / actual NAV import + actual descriptor object returned from helper. Deno tests synthesize aggregation against helper logic + source-inspect the index.ts file. No tautological "test asserts what test sets" patterns.

**Regression**: pre-existing ORCH-1008 (72/72) + Deno trial suite (43/43 including 16 prior `intelligence_coverage`/`runRemainder` cases) all still pass — no collateral breakage from the prune.

---

## Live-DB probe (Supabase Management API, 2026-05-30)

Per-city aggregates against `seeding_cities` + `place_pool`:

| City | Servable | Missing fields | Stale (90d) | First seeded | Last seeded |
|---|---|---|---|---|---|
| London | 3,495 | 3,495 | 0 | 2026-03-16 | 2026-04-01 |
| **Washington** | 2,298 | **1,706** ✓ | 0 | 2026-04-01 | 2026-04-22 |
| Brussels | 1,858 | 1,858 | 0 | 2026-04-02 | 2026-04-11 |
| **Raleigh** | 1,540 | **1,097** ✓ | 0 | 2026-03-01 | 2026-04-08 |
| Baltimore | 1,205 | 1,205 | 0 | 2026-04-02 | 2026-04-02 |
| Fort Lauderdale | 958 | 672 | 0 | 2026-04-12 | 2026-04-12 |
| Lagos | 908 | 908 | 0 | 2026-04-25 | 2026-04-25 |
| Cary | 761 | 541 | 0 | 2026-03-01 | 2026-04-18 |
| Durham | 648 | 468 | 0 | 2026-03-01 | 2026-04-18 |

✓ **Washington 1,706 missing + Raleigh 1,097 missing matches SPEC Appendix exactly.**
✓ **0 stale across all cities matches SPEC + implementor report.**
✓ **9 cities × 6 new fields × 0 NULL `created_at` rows = badges will render without crash.**

---

## Cross-layer verification

| Layer | Check | Result |
|---|---|---|
| **Build** | `cd mingla-admin && npm run build` | **FAIL** — merge conflict at `IntelligenceOverviewTab.jsx:30` (F-1) |
| **Strict-grep gate** | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | **FAIL** — `SyntaxError: Unexpected token '<<'` at line 1080 (F-2) |
| **Admin tests** | `node --test src/__tests__/orch1014_*.test.js` | PASS (27/27 impl + 22/24 adversarial; 2 P0 fail-on-revert) |
| **Deno tests** | `deno test --allow-read supabase/functions/run-place-intelligence-trial/__tests__/` | PASS (43/43; 9 new ORCH-1014 + 34 pre-existing) |
| **Files deleted** | `ls mingla-admin/src/pages/PhotoLabelingPage.jsx PhotoScorerPage.jsx`, `ls mingla-admin/src/components/photoLabeling/`, `ls mingla-admin/src/constants/photoLabeling.js` | All ENOENT ✓ |
| **PhotoLightbox retained** | `grep PhotoLightbox SignalAnchorsTab.jsx` | Still imports + uses ✓ |
| **Sidebar** | `lib/constants.js` NAV_GROUPS | 10 items, correct order ✓ |
| **Photo refs leftover** | `grep -rn "PhotoLabelingPage\|PhotoScorerPage" mingla-admin/src/` | Only in: App.jsx ledger comment (intentional), PhotoLightbox.jsx historical comment (SPEC-approved), ORCH-1014 test assertions (intentional) ✓ |
| **DIAG markers** | `grep -rn "\[ORCH-1014-DIAG\]" mingla-admin/src supabase/functions/` | Zero ✓ |
| **Commit prefix** | `git log --oneline ORCH-1014-*` | All 5 ORCH-1014 commits prefixed `[ORCH-1014]` ✓ |
| **TEST-MOD-APPROVED token** | `git log --grep="TEST-MOD-APPROVED ORCH-1014"` | Present in commit `9d2688970` body ✓ |
| **Bundle string evidence** | `grep "Seed status\|Refresh status" dist/assets/index-*.js` | Present in STALE bundle `index-CUtKVwnb.js` (built pre-conflict) — F-5; resolves with F-1 |
| **Live-DB match** | 9 cities probed | Matches SPEC Appendix ✓ |

---

## Edge case audit

| Case | Behavior | Verdict |
|---|---|---|
| City with all servable rows fully populated → "✓ all current" | Verified via helper test 1 + adversarial test 1 | PASS |
| City with servable_count = 0 → omitted from response | Preserved by `.filter((r) => r.servable_count > 0)` (line 2413); ORCH-1013 invariant | PASS |
| `last_detail_refresh = exactly 90 days ago` → counted as stale | `>` comparison (strict greater than 90d); a value exactly at 90d is NOT stale. Live DB has 0 stale so untestable today; helper logic is `nowMs - Date.parse(lastRefresh) > ORCH_1014_STALE_THRESHOLD_MS` — strictly greater. **Documented edge** | DEFENSIBLE |
| `last_detail_refresh IS NULL` → counted as stale (never refreshed) | Else-branch increments `staleRefreshByCity`. Verified by Deno test 3 + adversarial edge fn test 2 | PASS |
| City with NULL `place_pool.created_at` rows → badges don't crash | Edge fn guards with `if (!row.city_id \|\| !row.created_at) continue;` (line 2333); Live DB has 0 NULL `created_at` rows | PASS |
| Server timezone | Edge fn uses `Date.now()` + `Date.parse(ISO)` — both UTC-based; Postgres timestamps stored as `timestamptz` and returned as ISO with offset. Coherent. | PASS |
| Dark+light mode tokens | All 4 used tokens (`--color-warning-700`, `--color-success-700`, `--color-text-primary`, `--color-text-tertiary`) exist in Tailwind v4 admin theme; verified by impl test 5 in both badge suites | PASS |
| Response payload size delta | 6 new fields × 60 cities ≈ +3.4 KB JSON (timestamps + 2 ints). Negligible. | PASS |

---

## Implementor report deviations

The implementor's IMPLEMENTATION_ORCH-1014_INTEL_TRIAL_CONSOLIDATION.md claims:
- Line 113: `cd mingla-admin && npm run build → exit 0 in 2.15s`
- Line 150: `C7 gate passes (verified: node .github/scripts/.../orch-0863*.mjs exit 0)`

Both are STALE — measurements were taken in commit `6fdd9f7c7` BEFORE the bad rebase/merge with ORCH-1013 introduced the conflict markers. The implementor must re-verify both after the F-1 + F-2 fix and update the implementation report (or operator confirms via the orchestrator pipeline).

---

## Recommendation

**Block ship until F-1 + F-2 resolved**, then:
1. Re-run `cd mingla-admin && npm run build` → must exit 0
2. Re-run `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` → must exit 0
3. Re-run `node --test src/__tests__/orch1014_adversarial_no_merge_conflicts.test.js` → must be 8/8 PASS
4. Re-run all 51 ORCH-1014 admin + 9 Deno tests → must remain 60/60 (36 impl + 24 adversarial)

After conflict resolution + re-verification, this becomes **PASS** with deferred P2/P3 (no blockers, fix-forward acceptable).

---

## Files touched by QA

| Path | Action |
|---|---|
| `mingla-admin/src/__tests__/orch1014_adversarial_no_merge_conflicts.test.js` | NEW (8 cases) |
| `mingla-admin/src/__tests__/orch1014_adversarial_edge_fn_contracts.test.js` | NEW (8 cases) |
| `mingla-admin/src/__tests__/orch1014_adversarial_badge_edge_cases.test.js` | NEW (8 cases) |
| `Mingla_Artifacts/reports/QA_ORCH-1014_INTEL_TRIAL_CONSOLIDATION.md` | NEW (this file) |

No production code touched. No tests modified. No commits pushed.
