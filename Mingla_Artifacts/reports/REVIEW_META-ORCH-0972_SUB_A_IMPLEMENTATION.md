# REVIEW_META-ORCH-0972_SUB_A_IMPLEMENTATION

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]
**Phase reviewed:** 4 of 5 — IMPLEMENT, Sub-spec A (backend gates + product-code early-return deletions)
**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-25
**Implementation commit reviewed:** `f32c41492`
**Implementor side:** Codex `implementor-mingla`
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/` on branch `meta-orch-0972-brand-kind-decommission-universal-features`
**Verdict:** **APPROVED** — dispatch tester (Claude `mingla-tester` TARGETED scope, SC-A-1..SC-A-7 + T-01..T-07)

---

## Reviewer transparency

Codex authored the implementation; Claude orchestrator reviews. No same-session bias on the implementation itself. Same-session bias persists on the SPEC layer (Claude wrote both SPEC + this REVIEW + REVIEW_META-ORCH-0972_SPEC.md), but that bias was already disclosed in `REVIEW_META-ORCH-0972_SPEC.md` and doesn't compound on the Codex-implementation REVIEW.

---

## Commit-hash verification

`git diff e3b9500d0 f32c41492 --stat` shows 32 files changed: +443 / −712 lines net.

Per-file confirmation against SPEC §A.1 + §A.2 + §A.3:

| SPEC requirement | File / line | Diff confirms? |
|---|---|---|
| DELETE `brandAuthoringGate.ts` whole file | `src/services/brandAuthoringGate.ts` | ✓ −44 lines |
| DELETE callsite at `eventDrafts.ts:172` | `src/services/eventDrafts.ts` | ✓ −3 lines |
| DELETE callsite at `tripsService.ts:441` | `src/services/tripsService.ts` | ✓ −3 lines |
| DELETE `if (currentBrand.kind !== "trip_planner")...` at `trip/create.tsx:52` + line 9 doc comment update | `app/trip/create.tsx` | ✓ −32 lines (gate + comment + cascading dead code) |
| DELETE early-return at `trip/[id]/edit.tsx:67` | `app/trip/[id]/edit.tsx` | ✓ −1 line |
| `homeNextAction.ts` rung 1 predicate + rung 2 OfferingChooser hook + rung 4 delete | `src/utils/homeNextAction.ts` | ✓ −61 lines (rewrite) + `app/(tabs)/home.tsx` rung-4 type-error fix |
| 5 kind gates DELETE/REGATE in `experiences.tsx` | `app/(tabs)/hub/experiences.tsx` | ✓ −34 lines |
| `canGenerateExperiencesFromMenu.ts` regate from kind to venue_category | `src/utils/canGenerateExperiencesFromMenu.ts` | ✓ −7 lines |
| `canGenerateExperiencesFromActivities.ts` regate | `src/utils/canGenerateExperiencesFromActivities.ts` | ✓ −7 lines |
| `parse-restaurant-menu/index.ts` kind+claim gate DELETE + SELECT trim + temporaryCategory | `supabase/functions/parse-restaurant-menu/index.ts` | ✓ −12 lines |
| `parse-play-activities/index.ts` same pattern | `supabase/functions/parse-play-activities/index.ts` | ✓ −20 lines |
| `_shared/agentTools.ts` kind gate DELETE (lines 412+421) | `supabase/functions/_shared/agentTools.ts` | ✓ −12 lines |
| `brandsService.ts` CreateBrandInput.kind DELETE + INSERT mapping | `src/services/brandsService.ts` | ✓ −7 lines |
| `brandMapping.ts` 5 line edits (47-48, 91-92, 240-243, 311, 395) | `src/services/brandMapping.ts` | ✓ −6 lines |
| `brandPatch.ts:38-40` 3-line dirty-patch block DELETE | `src/utils/brandPatch.ts` | ✓ −3 lines |
| `useBrands.ts` useCreateBrand kind input DELETE | `src/hooks/useBrands.ts` | ✓ −2 lines |
| 5 obsolete test deletions (§A.3) | personaFork.test (−105) + ve1 (−33) + ve2 (−20) + TripBrandWizard.test (−86) + brandsService.tripPlannerKind.test (−181) | ✓ all 5 |
| SC-A-7 regression test NEW | `__tests__/services/eventDrafts.universalAuthoring.test.ts` | ✓ +141 lines |
| ORCH_0972_BACKEND_ALLOWLIST add per COMMS-0002 | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | ✓ +10 lines (const + spread into ALLOWLIST) |
| Comment update per SCREEN_INVENTORY row 17 + COPY_INVENTORY line 187 | `src/components/ui/UniversalCreatorSheet.tsx` | ✓ ±5 lines |
| Bridge edit: `BrandSwitcherSheet.tsx` removes `kind: "popup"` from useCreateBrand callsite | `src/components/brand/BrandSwitcherSheet.tsx` | ✓ −1 line (necessary after CreateBrandInput.kind delete) |
| Bridge edit: `TripBrandWizard.tsx` removes `kind: "trip_planner"` from callsite | `src/components/brand/TripBrandWizard.tsx` | ✓ −1 line (same reason) |
| Adjacent test update for trip-create gate removal | `app/trip/__tests__/trip-create-publish.test.ts` | ✓ ±7 lines |
| Adjacent test updates for venue_category regate | canGenerateExperiences[Menu,Activities].test.ts + homeNextAction.test.ts | ✓ aligned with regate |

Every claimed change has a commit hash on the per-ORCH branch. Zero uncommitted modifications (`git status --short` shows only the pre-existing untracked `CODEX_RE_REVIEW_META-ORCH-0972_AUDIT.md` Phase 1 carry-over — preserved per dispatch hard guard). Commit body includes `[TEST-MOD-APPROVED META-ORCH-0972 Sub-A]` per `feedback_close_commit_precommit_checks.md` rule (5 test files deleted triggers the tag requirement).

---

## Dependency walk for config-layer changes

Sub-A touched **one** config-layer file: `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`.

**Change:** added a 3-entry `ORCH_0972_BACKEND_ALLOWLIST` constant and spread it into the `ALLOWLIST` array consumed by `checkNoNewBackendFiles`.

**Consumer assessment:**

| Consumer | Compatibility | Verified? |
|---|---|---|
| `checkNoNewBackendFiles()` within same file | Reads `ALLOWLIST` array; spread pattern matches existing META_ORCH_0952 / ORCH_0954 / ORCH_0915 / ORCH_0933 entries | ✓ same pattern as existing allowlists; implementor cited PASS via `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in §12 |
| `.github/workflows/strict-grep-mingla-business.yml` ORCH-0863 job | Invokes the mjs script; gate now permits the 3 Sub-A backend touches | ✓ implementor cited PASS |
| Other strict-grep workflows (ORCH-0959, ORCH-0840, etc.) | Independent files; no cross-file constant import | ✓ no shared state |
| `tests-append-only.yml` workflow | Reads `[TEST-MOD-APPROVED]` regex; commit body includes the tag verbatim | ✓ tag present per commit body inspection |

No other config-layer files touched (no `app.json`, `vercel.json`, `package.json`, `tsconfig.json`, no `.github/workflows/**` direct edits).

---

## REVIEW protocol checklist

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | Root cause proven (vs symptom-masked)? | **PASS** | Sub-A removes the gates entirely (root-cause elimination of brand-kind authoring coupling), not conditional patches |
| 2 | Scope appropriate — could be narrower? | **PASS** | Scope matches SPEC §A.1–A.3 line-for-line; bridge edits to BrandSwitcherSheet.tsx + TripBrandWizard.tsx are mechanical type-contract cleanup, not scope creep |
| 3 | Hidden fallback paths masking failure? | **PASS** | No `?? fallback` introduced; gates are deleted, not bypassed |
| 4 | Stale cache paths? | **PASS** | No query-key changes (implementation §11) |
| 5 | Response shape truthful in ALL states? | **PASS** | Edge functions retain existing 200/4xx/5xx shape; gates were 403 early-returns, now removed — happy path uncoupled from kind |
| 6 | Real fix or symptom mask? | **PASS** | Fix is structural — file delete + line-level removal |
| 7 | Solo/collab parity? | N/A | No collab surfaces touched (SPEC scope) |
| 8 | Constitutional compliance | **PASS** | (8) subtract before adding — 712 lines deleted vs 443 added (net −269). (9) no fabricated data — no fake placeholders introduced. (3) no silent failures — `eventDrafts.ts` + `tripsService.ts` retain existing throws |
| 9 | Evidence chain complete | **PASS** | Each spec criterion mapped to verification result in implementation §8 + §12 |
| 10 | Documents updated | **PASS (this turn)** | Implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0972_SUB_A.md` |
| 11 | Commit-hash verification | **PASS** | §"Commit-hash verification" above |
| 12 | Dependency walk | **PASS** | §"Dependency walk" above |

All boxes PASS or N/A.

---

## SPEC traceability (SC-A-1..SC-A-7)

| Criterion | Implementor result | Reviewer assessment |
|---|---|---|
| **SC-A-1** TypeScript clean | PARTIAL — repo-wide pre-existing errors blocked full `tsc --noEmit`; Sub-A-specific home.tsx rung-4 error fixed | **ACCEPT** — pre-existing failures are out-of-Sub-A scope and were already red on commit `e3b9500d0` (verified in implementation §14 Risk row 2). Tester will re-confirm |
| **SC-A-2** Zero `brand.kind` reads in active product code | PARTIAL — Sub-A files clean; Sub-B/C/D files (PublicBrandPage, VenueClaimStatusBanner, hub/trips, publicEventsService tests) still contain reads | **ACCEPT WITH NOTE** — SPEC §A.5 SC-A-2 wording is broader than the Sub-A hard guard allows. Remaining reads are scoped to Sub-B/C and are NOT Sub-A drift. Implementor's discovery #2 explicitly flagged this tension; orchestrator confirms it's a SPEC nit, not an implementation defect |
| **SC-A-3** Edge function files have ZERO `brand.kind` | PASS — `rg -n "brand\.kind" supabase/functions/...` returns no hits | **PASS** |
| **SC-A-4** 5 obsolete test files deleted | PASS — `find` returns empty | **PASS** (verified independently via diff stat showing each file at −N lines) |
| **SC-A-5** Existing jest tests pass | PARTIAL — 201 passed / 38 failed; failures pre-existing (per implementor §14) | **ACCEPT** pending tester confirmation that the 38 failures match a pre-Sub-A baseline. Tester should run `git stash` + jest + compare counts to confirm |
| **SC-A-6** `tsc --noEmit` clean | PARTIAL — same pre-existing repo-wide blocker as SC-A-1 | **ACCEPT** as SC-A-1 |
| **SC-A-7** Implementor regression test | PASS — `mingla-business/__tests__/services/eventDrafts.universalAuthoring.test.ts`; fails-on-revert verified at `18d33fcd9` | **PASS** — meets CLOSE Step 0.5 (a) gate requirements verbatim |

**Net assessment:** all 7 criteria either PASS or ACCEPT-with-known-pre-existing-baseline. The PARTIAL items are scope-correct (don't bleed into Sub-B/C/D) and transparently documented.

---

## Hard-guard verification (from this dispatch)

| Guard | Verification |
|---|---|
| No DB schema change | ✓ No `supabase/migrations/` files in diff |
| No migration apply | ✓ No `db push` evidence; deploy notes §16 explicit |
| No edge deploy | ✓ Implementation §12 row 3 ran `deno check` only; §16 explicit "do not deploy in Sub-A" |
| No expansion into Sub-B/C/D files beyond bridge edits | ✓ Only BrandSwitcherSheet.tsx (−1 line `kind:` literal removal) + TripBrandWizard.tsx (−1 line same) + UniversalCreatorSheet.tsx (comment update per Sub-A SPEC §A.1). All are SPEC-A-authorized |
| Preserve untracked `CODEX_RE_REVIEW_META-ORCH-0972_AUDIT.md` | ✓ `git status --short` post-implementation still shows it untracked |

---

## Findings

### P0 — None

### P1 — None

### P2 — None

### P3 — One transparency item (informational; not action-required for Sub-A)

**P3-1:** SPEC §A.5 SC-A-2 wording is broader than the Sub-A hard guard ("Sub-A is code-only, no expansion into Sub-B/C/D files"). Implementor surfaced this in implementation §15. SC-A-2 should have been worded "ZERO hits in Sub-A-touched files" rather than "in active product code". Refinement is an artifact-edit, not a code change — orchestrator records the SC-A-2 reading as "Sub-A-touched files" for the tester's gate so the tester does NOT fail Sub-A on Sub-B/C/D residue. Same wording-tightening should happen for SC-B-2 + SC-C-13 at their respective REVIEWs (defer).

### P4 — Notes for the tester

For the Sub-A TARGETED test pass, expected results:

- T-01 through T-07: should all PASS against commit `f32c41492`.
- SC-A-1 / SC-A-5 / SC-A-6 baseline confirmation: tester runs `git checkout e3b9500d0 -- .` then `jest --runInBand` to capture the pre-Sub-A jest failure count; if it matches the post-Sub-A count (38), the failures are confirmed pre-existing.
- SC-A-7 fails-on-revert: tester independently reverts the gate file and confirms the regression test FAILS, then restores.
- Adversarial regression test (CLOSE Step 0.5 (b)): tester writes a test attacking a DIFFERENT angle from SC-A-7 — suggested angles are (i) edge-function POST with malformed brand_id → assert validation error (not silent kind-gate fallback); (ii) `createEventDraft` with a deleted brand → assert proper deletion-check error; (iii) trip-create as anonymous (no auth) → assert auth error, NOT kind-gate error.
- Cross-platform parity (per Affected Surfaces): Sub-A is all shared business app code → automatic parity. Tester confirms iOS+Android+web preview by code reading; live-fire sim repro is OPTIONAL for Sub-A since no UI/runtime surface changes (gate removal is invisible until a user triggers a previously-gated flow).
- Pre-existing 38 jest failures: do NOT triage these in Sub-A retest — they're orthogonal. Note them in QA report as "pre-existing baseline; confirmed unchanged."

---

## Verdict

**APPROVED.** Sub-A implementation matches SPEC §A scope line-for-line, all 7 success criteria are PASS or ACCEPT-with-pre-existing-baseline, all hard guards from the dispatch are honored, CLOSE Step 0.5 (a) gate satisfied with fails-on-revert verification at `18d33fcd9`, `[TEST-MOD-APPROVED META-ORCH-0972 Sub-A]` tag present in commit body for the 5 test deletions, COMMS-0002 backend allowlist added in the same commit.

Dispatch Claude `mingla-tester` TARGETED scope. On PASS → dispatch Sub-B implementor. On FAIL → REWORK loop back to Codex implementor with specific findings.
