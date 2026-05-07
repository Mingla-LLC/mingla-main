# Implementation Report: Archive And Delete Pass (ORCH-0750C)

> Date: 2026-05-07  
> Mode: Spec Execute  
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0750C_ARCHIVE_DELETE_PASS.md`  
> Status: implemented and verified

## 1. Plain-English Summary

Mingla now has one archive home for historical documentation material. Old `outputs/` evidence was preserved under `Mingla_Artifacts/archive/`, tracked `clade transfer/` handoffs were moved into that archive, deprecated queues were turned into breadcrumbs, and README now points readers to the archive through the artifact system instead of listing stale root folders.

This pass did not touch product/runtime code. It also did not version private prompts or attempt the full broken-link cleanup.

## 2. Exact Changes

Copied into durable archive:

- `outputs/B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md` -> `Mingla_Artifacts/archive/outputs_legacy/B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md`
- `outputs/B2_RECONCILIATION_REPORT.md` -> `Mingla_Artifacts/archive/outputs_legacy/B2_RECONCILIATION_REPORT.md`
- `outputs/FORENSICS_AND_SPEC_DISPATCH_B2_FULL.md` -> `Mingla_Artifacts/archive/outputs_legacy/FORENSICS_AND_SPEC_DISPATCH_B2_FULL.md`
- `outputs/FORENSICS_B2_PATH_C_AUDIT.md` -> `Mingla_Artifacts/archive/outputs_legacy/FORENSICS_B2_PATH_C_AUDIT.md`
- `outputs/HANDOFF_B2a_PATH_C_V3_POST_PHASE_0PP.md` -> `Mingla_Artifacts/archive/outputs_legacy/HANDOFF_B2a_PATH_C_V3_POST_PHASE_0PP.md`
- `outputs/IMPL_DISPATCH_B2_PATH_C.md` -> `Mingla_Artifacts/archive/outputs_legacy/IMPL_DISPATCH_B2_PATH_C.md`
- `outputs/IMPL_DISPATCH_B2_PATH_C_V3.md` -> `Mingla_Artifacts/archive/outputs_legacy/IMPL_DISPATCH_B2_PATH_C_V3.md`
- `outputs/SPEC_B2_PATH_C_AMENDMENT.md` -> `Mingla_Artifacts/archive/outputs_legacy/SPEC_B2_PATH_C_AMENDMENT.md`
- `outputs/SPEC_B2_PATH_C_V2.md` -> `Mingla_Artifacts/archive/outputs_legacy/SPEC_B2_PATH_C_V2.md`
- `outputs/SPEC_B2_PATH_C_V3.md` -> `Mingla_Artifacts/archive/outputs_legacy/SPEC_B2_PATH_C_V3.md`

Moved into archive:

- `clade transfer/ANDROID_GLASS_OPACITY_HANDOFF.md` -> `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/ANDROID_GLASS_OPACITY_HANDOFF.md`
- `clade transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md` -> `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md`
- `clade transfer/HANDOFF_ORCH_0737_V6_PIPELINE_REDESIGN.md` -> `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/HANDOFF_ORCH_0737_V6_PIPELINE_REDESIGN.md`
- `clade transfer/HANDOFF_ORCH_0742_PHASE_2.md` -> `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/HANDOFF_ORCH_0742_PHASE_2.md`
- `clade transfer/HANDOFF_PLACE_POOL_PRICE_FIELDS_INVESTIGATION.md` -> `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/HANDOFF_PLACE_POOL_PRICE_FIELDS_INVESTIGATION.md`

Stubbed with breadcrumbs:

- `Mingla_Artifacts/SPEC_QUEUE.md`
- `Mingla_Artifacts/TEST_QUEUE.md`
- `Mingla_Artifacts/RETEST_LEDGER.md`

Archived full deprecated tracker copies:

- `Mingla_Artifacts/archive/old_trackers/SPEC_QUEUE.md`
- `Mingla_Artifacts/archive/old_trackers/TEST_QUEUE.md`
- `Mingla_Artifacts/archive/old_trackers/RETEST_LEDGER.md`

Created archive indexes:

- `Mingla_Artifacts/archive/README.md`
- `Mingla_Artifacts/archive/outputs_legacy/README.md`
- `Mingla_Artifacts/archive/handoffs_legacy/README.md`
- `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/README.md`
- `Mingla_Artifacts/archive/old_trackers/README.md`

Deleted tracked generated build assets:

- `mingla-admin/dist/assets/mingla-logo-DB7CS-84.png`
- `mingla-admin/dist/mingla-logo.png`
- `mingla-admin/dist/vite.svg`

## 3. Preflight Results

Required preflight found:

- `outputs/`: 10 files, ignored/untracked by Git.
- `clade transfer/`: 5 files, all tracked by Git.
- Deprecated queues: `SPEC_QUEUE.md`, `TEST_QUEUE.md`, and `RETEST_LEDGER.md` tracked.
- Tracked generated candidates: 3 files under `mingla-admin/dist`.
- Link baseline before implementation: 429 files, 2,392 links, 1,195 missing links.
- Dirty worktree contained unrelated app/mobile/Supabase/artifact work before this pass; unrelated files were not reverted.

## 4. Link Audit Result

Final link audit after archive moves, archive link normalization, manifest update, README update, and generated-asset deletion:

```text
Files checked: 448
Total links: 2460
Missing links: 1190
```

Baseline gate was `<= 1195`; ORCH-0750C passed with 5 fewer missing links than the baseline.

## 5. Manifest Update Summary

`Mingla_Artifacts/ARTIFACT_MANIFEST.md` now records:

- `Mingla_Artifacts/archive/` as the current archive root.
- `outputs_legacy/`, `handoffs_legacy/`, and `old_trackers/` archive categories.
- The 10 former `outputs/` materials at archive paths.
- The 5 former `clade transfer/` handoffs at archive paths.
- Deprecated queue top-level files as breadcrumbs.
- ORCH-0750C implementation status and final link audit numbers.

## 6. README Update Summary

`README.md` was updated because its repo map still listed `outputs/` and `clade transfer/` as top-level historical folders. It now points to `Mingla_Artifacts/archive/README.md` through the source-of-truth table and shows `Mingla_Artifacts/archive/` under the artifact operating system.

README remains a snapshot/front door, not the archive index.

## 7. Generated Asset Deletion Decision

Deletion was performed for the three tracked `mingla-admin/dist` assets.

Evidence:

- `git ls-files mingla-admin/dist` listed exactly the 3 generated assets.
- `rg` found no source, deploy, README, or docs references except the ORCH-0750C spec naming them as deletion candidates.
- The link checker passed after deletion.

No other generated or ignored local files were deleted.

## 8. Known Residual Link Debt

Residual missing links remain intentional and out of scope for ORCH-0750C:

- Private/ignored prompts remain classified as `PROMPT_PRIVATE_OR_IGNORED`.
- Historical reports/specs still contain old references that require future artifact-by-artifact cleanup.
- `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/HANDOFF_PLACE_POOL_PRICE_FIELDS_INVESTIGATION.md` still has 7 residual missing historical links after path normalization.
- Full 1,190-link cleanup belongs to later scoped passes.

## 9. Rollback Notes

Rollback if needed:

1. Move archived `clade_transfer` files back to `clade transfer/`.
2. Restore top-level queue files from `Mingla_Artifacts/archive/old_trackers/`.
3. Remove ORCH-0750C archive rows from `ARTIFACT_MANIFEST.md`.
4. Revert README archive-map changes.
5. Restore the 3 deleted generated assets from Git if required.
6. Re-run `python3 scripts/docs/check_links.py --format markdown`.

The ignored original `outputs/` directory was intentionally not deleted, so rollback for copied outputs is low-risk.

## 10. ORCH-0750D Still Required

ORCH-0750D remains necessary for lock-in:

- update all Codex Mingla skills with the new documentation system;
- update Claude Mingla skills in this rare approved case;
- define close protocol artifact placement, including README update rules;
- add GitHub/CI regression checks for link debt, README drift, artifact placement, ignored generated files, and stale folder creation.

## 11. Verification

| Check | Command / method | Result |
|---|---|---|
| Link gate | `python3 scripts/docs/check_links.py --format markdown --max-missing 1195` | PASS, 1,190 missing |
| Outputs preserved | `find Mingla_Artifacts/archive/outputs_legacy -type f` | PASS, 10 copied files plus README |
| Handoffs moved | `find Mingla_Artifacts/archive/handoffs_legacy/clade_transfer -type f` | PASS, 5 moved files plus README |
| Queue stubs | `sed -n '1,80p'` on each queue file | PASS, all are breadcrumbs |
| Manifest archive rows | `rg "outputs_legacy|handoffs_legacy|old_trackers" Mingla_Artifacts/ARTIFACT_MANIFEST.md README.md` | PASS |
| Prompt safety | `git status --short Mingla_Artifacts/prompts` | PASS, no tracked prompt changes |
| Product/runtime scope | file review + git status | PASS, no runtime source edits; only generated `dist` deletions |

## Suggested Commit Message

```text
docs: archive legacy artifacts and preserve docs source of truth

Resolves: ORCH-0750C
Evidence: python3 scripts/docs/check_links.py --format markdown --max-missing 1195
Deploy: none
```

## Ready-To-Test Checklist

1. Review archive index readability at `Mingla_Artifacts/archive/README.md`.
2. Confirm README points to archive through the source-of-truth table.
3. Confirm manifest rows match archive paths.
4. Re-run the link checker gate and verify missing links stay `<= 1195`.
5. Confirm no private prompts were versioned or moved.
