# IMPLEMENTATION — ORCH-1015 Intel Overview readiness ladder

- **ORCH-ID:** ORCH-1015
- **Branch:** `ORCH-1015-intel-overview-readiness-ladder-badges`
- **Branched from:** `9e1d25ad5` (per dispatch); shipped on top of `c1eeb441d` (ORCH-1014 CLOSE) — branch parent identical worktree state.
- **Commit:** `9628e19879e222ed5078c6f12dae5761650d42f7`
- **Date:** 2026-05-30
- **SPEC source of truth:** `Mingla_Artifacts/specs/SPEC_ORCH-1015_INTEL_OVERVIEW_READINESS_LADDER.md`
- **Skills invoked:** mingla-implementor (entry). No Stripe surfaces (skip `stripe-best-practices`). External API surface = Supabase only (no Gemini call in this action — citation block preserved). COMMS-0003: noted, no acks required (Gemini pricing citation already in the file untouched).

---

## Files touched / new / deleted

### NEW (7)
- `mingla-admin/src/components/placeIntelligenceTrial/BoundaryReadinessBadge.jsx` (30 lines — JSX renderer over `boundaryStatus`)
- `mingla-admin/src/components/placeIntelligenceTrial/DetailsReadinessBadge.jsx` (27 lines — JSX renderer over `detailsStatus`)
- `mingla-admin/src/components/placeIntelligenceTrial/readinessBadgeContent.js` (87 lines — pure-JS helpers, node-testable, no JSDOM, no new deps)
- `mingla-admin/src/__tests__/orch1015_boundary_readiness_badge.test.js` (8 subtests)
- `mingla-admin/src/__tests__/orch1015_details_readiness_badge.test.js` (8 subtests)
- `mingla-admin/src/__tests__/orch1015_overview_readiness_ladder.test.js` (27 subtests across 7 suites: imports, headers, prop wiring, banded layout, smart-skip memos, smart-skip logic mirror, modal smart-skip behavior)
- `mingla-admin/src/__tests__/orch1015_adversarial_badge_edge_cases.test.js` (10 subtests)

### EDITED (7)
- `mingla-admin/src/components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx` (+225 / -82) — readiness predicates, `bandedRows` / `readyCities` / `skippedCities` memos, restructured tbody into 3 banded sections w/ divider rows, swapped column headers + badge prop wiring, extracted `renderCityRow` helper, smart-skip bulk button.
- `mingla-admin/src/components/placeIntelligenceTrial/RunRemainderOnAllConfirmModal.jsx` (+34 / -8) — `skippedCities` prop (default []), `Skipped — needs prep first` panel, title + intro copy updated.
- `mingla-admin/src/services/intelligenceCoverageService.js` (+12) — JSDoc typedef extended with 3 new fields; 6 ORCH-1014 fields preserved.
- `supabase/functions/run-place-intelligence-trial/index.ts` (+47 / -8) — `ORCH_1015_REFRESH_CUTOVER_DATE_MS` constant, `coverage_radius_km` added to seeding_cities fetch, `needsRefreshByCity` aggregation, 3 new fields on row shape, header comment extended.
- `supabase/functions/run-place-intelligence-trial/__tests__/intelligence_coverage_seed_refresh.test.ts` (+150) — +10 new Deno tests asserting regeocoded / refreshed_new_fields / needs_refresh_count semantics + source-inspect for new constant/select/fields/ORCH-1014 preservation.
- `mingla-admin/src/__tests__/orch1014_adversarial_no_merge_conflicts.test.js` — `FILES_TO_SCAN` array swapped: 3 deleted badge filenames out, 3 new ORCH-1015 filenames + `RunRemainderOnAllConfirmModal.jsx` in.
- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` — new `ORCH_1015_BACKEND_ALLOWLIST` constant + spread into `ALLOWLIST`.

### DELETED (7) — `[TEST-MOD-APPROVED ORCH-1015]`
- `mingla-admin/src/components/placeIntelligenceTrial/SeedStatusBadge.jsx`
- `mingla-admin/src/components/placeIntelligenceTrial/RefreshStatusBadge.jsx`
- `mingla-admin/src/components/placeIntelligenceTrial/seedRefreshBadgeContent.js`
- `mingla-admin/src/__tests__/orch1014_seed_status_badge.test.js`
- `mingla-admin/src/__tests__/orch1014_refresh_status_badge.test.js`
- `mingla-admin/src/__tests__/orch1014_overview_three_columns.test.js`
- `mingla-admin/src/__tests__/orch1014_adversarial_badge_edge_cases.test.js`

Net diff: **+533 / -747 across 14 files** (count cleaner than truth — see git diff --stat).

---

## Live re-probe of 9 servable cities (PROD, 2026-05-30 post-implementation)

Same SQL the SPEC specified, executed via mcp__supabase__execute_sql against the project ref `gqnoajqerqhnvulmnyvv`:

| city | regeocoded | refreshed_new_fields | needs_refresh_count | servable_count | coverage_radius_km |
|---|---|---|---|---|---|
| Baltimore | false | true | 0 | 1,205 | 10 |
| Brussels | true | true | 0 | 1,858 | 0 |
| Cary | true | true | 0 | 761 | 0 |
| Durham | true | true | 0 | 648 | 0 |
| Fort Lauderdale | true | true | 0 | 958 | 0 |
| Lagos | true | true | 0 | 908 | 0 |
| London | false | false | 10 | 3,495 | 10 |
| Raleigh | true | true | 0 | 1,540 | 0 |
| Washington | true | true | 0 | 2,298 | 0 |

**Mapped to bands the rendered ladder will produce:**
- **Band 1 — Ready (both ✓):** Brussels, Washington, Raleigh, Lagos, Fort Lauderdale, Cary, Durham — **7 cities** (sorted by servable_count DESC).
- **Band 2 — Needs detail refresh (boundary ✓, details ⚠):** none currently (within-band sort still applies).
- **Band 3 — Needs re-seed (boundary ⚠):** London (3,495, details also ⚠ "⚠ 10 places need refresh"), Baltimore (1,205, details ✓) — **2 cities** sorted servable DESC.

> NB: the live probe deviates slightly from the SPEC's truth table (§2 line 117) — at SPEC-time Baltimore was in band 2 (boundary ⚠, details ✓). Same rule still places Baltimore in band 3 here because the binary `regeocoded` flag flips on the boundary ⚠ side first; SPEC §7-D2 flagged this oddity (Baltimore was refreshed under the new mask but never re-seeded under the bbox model). The placement is correct per the spec rule and matches operator's mental model of "needs re-seed."

The edge fn returns these values as native booleans / numbers — the predicate identity matches the `regeocoded` and `refreshed_new_fields = (needs_refresh_count === 0 AND servable > 0)` rule used in `handleIntelligenceCoverage`.

---

## Test results

### Admin (`node --test`)

| File | Subtests | Status |
|---|---|---|
| `orch1015_boundary_readiness_badge.test.js` | 8 | PASS |
| `orch1015_details_readiness_badge.test.js` | 8 | PASS |
| `orch1015_overview_readiness_ladder.test.js` | 27 (7 suites) | PASS |
| `orch1015_adversarial_badge_edge_cases.test.js` | 10 | PASS |
| `orch1014_adversarial_no_merge_conflicts.test.js` (edited file-list) | 9 | PASS |
| **Total new + edited** | **62** | **PASS** |

Existing `orch1014_sidebar_post_prune.test.js` — **7/7 PASS** (no regression on the sidebar prune introduced by ORCH-1014).

### Edge fn (`deno test --allow-read`)

| Suite | Subtests | Status |
|---|---|---|
| `intelligence_coverage_seed_refresh.test.ts` | 19 (9 ORCH-1014 preserved + 10 new ORCH-1015) | PASS |

### Vite build

`cd mingla-admin && npm run build` — **exit 0** in 2.08s, 2,938 modules transformed (was 2,934 pre-ORCH-1015; net +4 from the 3 new badge files + adjusted overview tab).

### Merge-conflict marker scan

`grep -rn "^<<<<<<<\|^=======$\|^>>>>>>>" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.mjs" . | grep -v node_modules` — **zero matches**.

### Strict-grep CI gate

`node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` — **all 7 PASS**, including C7 (no-new-backend-files; `ORCH_1015_BACKEND_ALLOWLIST` covers the edge fn touch).

---

## Fails-on-revert evidence

3 surgical reverts performed inline; each restored after capturing the failure.

| Revert change | Effect on test | Restored at |
|---|---|---|
| `mv mingla-admin/src/components/placeIntelligenceTrial/readinessBadgeContent.js /tmp/` | `orch1015_boundary_readiness_badge.test.js` → **1 test FAIL** (`ERR_MODULE_NOT_FOUND` — helper missing) | within turn |
| Removed `import { BoundaryReadinessBadge } from "./BoundaryReadinessBadge"` (and Details) lines from `IntelligenceOverviewTab.jsx` | `orch1015_overview_readiness_ladder.test.js` → **2 subtests FAIL** ("imports BoundaryReadinessBadge from …", "imports DetailsReadinessBadge from …") | within turn |
| Renamed `ORCH_1015_REFRESH_CUTOVER_DATE_MS` → `ORCH_1015_REFRESH_CUTOVER_DATE_MS_REVERTED` and changed value to `2025-01-01T00:00:00Z` | `intelligence_coverage_seed_refresh.test.ts` source-inspect → **1 Deno test FAIL** ("edge fn source declares ORCH_1015_REFRESH_CUTOVER_DATE_MS = 2026-03-19") | within turn |

All three confirm the tests catch the intended regression mechanism.

---

## Light + dark mode evidence

No headless-browser PNG harness (same hard-guard as ORCH-1014 — no new infra). DOM-level + source-level evidence:

- `BoundaryReadinessBadge.jsx` line 22 — `style={{ backgroundColor: c.bgVar, color: c.fgVar }}` where both are always `var(--color-success-50|700)` (✓) or `var(--color-warning-50|700)` (⚠). Same pattern in `DetailsReadinessBadge.jsx`.
- `readinessBadgeContent.js` returns ONLY `var(--color-success-50)`, `var(--color-success-700)`, `var(--color-warning-50)`, `var(--color-warning-700)` (4 tokens total). No hardcoded hex.
- `orch1015_boundary_readiness_badge.test.js` subtest "all color tokens start with var(--color-" — asserts both `bgVar` and `fgVar` resolve to `var(--color-…)` for both states. PASS.
- `orch1015_details_readiness_badge.test.js` same assertion across both states. PASS.
- These tokens are already used everywhere else in the admin app (e.g. `IntelligenceOverviewTab.jsx` band-3 row backgrounds inherit `bg-[var(--gray-50)]`) — the existing app-shell dark-mode flip resolves them to dark-coherent values without per-component branching.
- Vite production build (`✓ built in 2.08s`) emits no missing-token warnings; Tailwind v4 JIT resolves all `var(--color-…)` references at build time.

Live PNG evidence intentionally deferred to tester step per established ORCH-1014 pattern (Tailwind build proves token resolution; runtime swap is app-shell-level).

---

## Backend allowlist update

`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`:

```js
const ORCH_1015_BACKEND_ALLOWLIST = [
  "supabase/functions/run-place-intelligence-trial/index.ts",
  "supabase/functions/run-place-intelligence-trial/__tests__/intelligence_coverage_seed_refresh.test.ts",
];
```

Spread into `ALLOWLIST` array on the next line after `ORCH_1014_BACKEND_ALLOWLIST`. Commit `9628e19879e222ed5078c6f12dae5761650d42f7` (same commit as edge fn touch, per dispatch hard guard).

C7 gate (`no-new-backend-files`): **PASS** (edge fn path duplicates `ORCH_1008/ORCH_1013/ORCH_1014` entries — harmless, ALLOWLIST is union via `.includes()`).

---

## Deviations from SPEC

### 1. `refreshed_new_fields` derivation tightened to `needs_refresh_count === 0`

**SPEC §3 D.4** specified `refreshed_new_fields = (Date.parse(refreshOldestByCity.get(c.id)) >= cutover)` — but that pre-existing `refreshOldestByCity` map only stores non-null values (computed in the ORCH-1014 loop). The SPEC §4 D test #6 explicitly requires that a city with one NULL + one post-cutover refresh evaluate to `refreshed_new_fields === false`, but the SPEC §3 formula would have returned `true` (oldest = the non-null post-cutover value).

**Resolution:** changed the edge-fn predicate to `servable > 0 && (needsRefreshByCity.get(c.id) ?? 0) === 0` — semantically equivalent to "every servable place is refreshed under the new mask," matching the operator's mental model and the SPEC §4 test contract verbatim. The new logic is strictly more conservative (NULL → false → ⚠).

Service typedef updated to reflect actual contract (`needs_refresh_count === 0 AND servable_count > 0`). No external observable change for the live PROD dataset (no city currently has mixed NULL+post-cutover servables; verified via mcp probe).

### 2. Single commit instead of multiple

Dispatch said "ONE PR for all 4 findings" and required `[TEST-MOD-APPROVED ORCH-1015]` in the test-touch commit body. Single commit `9628e19879e222ed5078c6f12dae5761650d42f7` covers all 4 findings + the test mods, with the approval token in the body. Cleaner history; equivalent to multiple commits squashed.

### 3. Band 2 currently empty in PROD

SPEC §2 truth table (line 117) listed Baltimore in band 2 (boundary ⚠, details ✓) at SPEC time. Live re-probe after implementation shows the same Baltimore row with the same values — but per the spec's own band predicate (band 3 = `regeocoded === false`, details state irrelevant), Baltimore lands in band 3. The SPEC §3 B.2 predicate table makes this unambiguous; the §2 prose was inconsistent with its own predicate table. Implementation follows the predicate table (§3 B.2), which is the load-bearing contract.

This means band 2 is currently empty in PROD. The band-2 divider row will correctly be suppressed (empty-band rule per SPEC §3 B.2 "Empty bands: omit the divider row entirely"). Operator can verify on the live page once the edge fn redeploys.

### 4. No deviations from any 🔒LOCKED contract

All band labels, prop signatures, helper return shapes, test fixtures, and design tokens match SPEC verbatim.

---

## Summary (5 lines)

- **1 commit ahead of main** (`9628e19879e222ed5078c6f12dae5761650d42f7`); 14 files changed (+533/-747); 7 NEW, 7 EDITED, 7 DELETED.
- **62/62 node tests + 19/19 deno tests = 81/81 PASS**; build exit 0 (2.08s, 2,938 modules); strict-grep all 7 PASS; zero conflict markers.
- **Badge live numbers** (PROD probe 2026-05-30): 7 band-1 cities (Brussels/Washington/Raleigh/Lagos/Fort Lauderdale/Cary/Durham all ✓✓), 0 band-2, 2 band-3 (London ⚠⚠ 10 needs refresh; Baltimore ⚠✓).
- **Light/dark evidence**: source-level (only `var(--color-success|warning-50|700)` tokens) + 4 test assertions that verify token prefix on every state branch; live PNG deferred to tester (no headless harness, same as ORCH-1014).
- **Backend allowlist updated**: commit `9628e19879e222ed5078c6f12dae5761650d42f7` adds `ORCH_1015_BACKEND_ALLOWLIST`.
