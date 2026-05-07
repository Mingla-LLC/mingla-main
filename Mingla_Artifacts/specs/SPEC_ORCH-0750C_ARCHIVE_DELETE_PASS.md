# Spec: Archive And Delete Pass (ORCH-0750C)

> Date: 2026-05-07  
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0750_DOCUMENTATION_ARTIFACTS_TOTAL_SWEEP.md`  
> Root cause: documentation artifacts have no enforced archive boundary, and some durable links point at ignored/private or moved material.  
> Status: SPEC READY

## 1. Summary

ORCH-0750C turns Mingla's old documentation piles into a governed archive without losing evidence. The work is not a trash sweep. It is a controlled move/copy/index pass: preserve historical material, stop README from pointing at random old files, keep prompt files private, and delete only generated files that are tracked by mistake and proven unused.

## 2. Evidence Base

| Evidence | Current result |
|---|---|
| Link checker | `python3 scripts/docs/check_links.py --format markdown` checks 427 files, 2,392 links, 1,195 missing links. |
| Missing-link classes | 600 `MOVED_OR_ARCHIVED_CANDIDATE`, 452 `PROMPT_PRIVATE_OR_IGNORED`, 126 `TRUE_MISSING_REFERENCE`, 13 `HISTORICAL_SOURCE_MISSING`, 4 `GENERATED_OR_IGNORED_TARGET`. |
| `outputs/` inventory | 10 files, all B2/B2a historical Path C material. `git ls-files outputs` returns 0; `.gitignore` ignores `outputs/`. |
| `clade transfer/` inventory | 5 files, all transfer handoffs. All 5 are tracked by Git. |
| Deprecated queue files | `Mingla_Artifacts/SPEC_QUEUE.md`, `TEST_QUEUE.md`, `RETEST_LEDGER.md` are tracked and explicitly deprecated as of 2026-04-11. |
| Prompt storage | `Mingla_Artifacts/prompts/` has 38 local files and is ignored by `.gitignore`; prompt links are not durable public evidence. |
| Generated/tracked candidates | `git ls-files mingla-admin/dist` returns 3 tracked build assets: `mingla-admin/dist/assets/mingla-logo-DB7CS-84.png`, `mingla-admin/dist/mingla-logo.png`, `mingla-admin/dist/vite.svg`. |
| Dirty worktree | Multiple unrelated app/mobile/Supabase/docs files are already modified or untracked. ORCH-0750C must not classify unrelated dirty runtime work as cleanup material. |

## 3. Candidate Inventory

| Candidate | Disposition | Evidence | Action |
|---|---|---|---|
| `outputs/` | `ARCHIVE_ONLY`, preserve by versioned copy | Ignored/untracked but heavily referenced as historical reports/specs/QA | Copy into `Mingla_Artifacts/archive/outputs_legacy/` using forced add if needed; do not delete local ignored originals in this phase. |
| `clade transfer/` | `ARCHIVE_ONLY`, move | Tracked handoff root; manifest already marks every file archive-only | Move into `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/` with link rewrites. |
| `Mingla_Artifacts/SPEC_QUEUE.md` | Deprecated tracker | Header says superseded by `AGENT_HANDOFFS.md` | Archive full original, replace top-level file with a short breadcrumb stub. |
| `Mingla_Artifacts/TEST_QUEUE.md` | Deprecated tracker | Header says superseded by `AGENT_HANDOFFS.md` | Archive full original, replace top-level file with a short breadcrumb stub. |
| `Mingla_Artifacts/RETEST_LEDGER.md` | Deprecated tracker | Header says superseded by `AGENT_HANDOFFS.md` | Archive full original, replace top-level file with a short breadcrumb stub. |
| `Mingla_Artifacts/prompts/` | `PRIVATE_PROMPT_NOT_VERSIONED` | Directory is ignored and link checker classifies 452 prompt links as private/ignored | Do not move, delete, or version prompts in ORCH-0750C. Replace public references only when a report/spec/test artifact exists. |
| `mingla-admin/dist/*` tracked assets | `DELETE_CANDIDATE_AFTER_LINK_REWRITE` | 3 tracked build outputs under ignored `dist/`; no durable docs should cite build output | Delete only if no imports, links, or deployment contract depends on them. Otherwise defer. |
| `.expo/`, `.vercel/`, app Expo caches | `GENERATED_IGNORE` | Ignored local generated files | Do not version into archive. No action unless tracked candidates appear. |
| Reports/specs directories | Keep current ledger | 221 report files and 69 spec files at current scan | Do not bulk move old reports/specs in ORCH-0750C. Supersession graph comes later. |
| Migration archive/backups | Preserve historical authority | Manifest marks them preservation material | Do not move or delete. |

## 4. Archive Policy

Create the archive as a source-of-truth structure under:

```text
Mingla_Artifacts/archive/
  README.md
  outputs_legacy/
    README.md
  handoffs_legacy/
    README.md
    clade_transfer/
      README.md
  old_trackers/
    README.md
```

Rules:

1. Archive means "historical evidence, not current instructions."
2. Every archived item must remain discoverable from `Mingla_Artifacts/ARTIFACT_MANIFEST.md`.
3. Every move/copy row must include old path, archive path, status, reason, replacement authority, and link-rewrite note.
4. README may link only to the archive index or manifest, not to random archived files.
5. Preserve historical reports/specs unless a later spec proves a specific file is generated, duplicate, and unused.

## 5. Delete Policy

ORCH-0750C authorizes only one narrow deletion class: tracked generated build files that are inside ignored output directories and have no live references.

Allowed delete candidates:

- `mingla-admin/dist/assets/mingla-logo-DB7CS-84.png`
- `mingla-admin/dist/mingla-logo.png`
- `mingla-admin/dist/vite.svg`

Deletion preconditions:

1. `git ls-files <path>` proves the file is tracked.
2. `rg` proves no source, docs, deployment config, or README path references the file.
3. `python3 scripts/docs/check_links.py --format markdown` does not worsen from 1,195 missing links.
4. Implementation report lists every deleted path and why it is safe.

Everything else is "no delete" in ORCH-0750C.

## 6. Link Rewrite Plan

Before moving or copying anything, implementor must build an exact link map:

| Old target pattern | New target |
|---|---|
| `outputs/<file>` | `Mingla_Artifacts/archive/outputs_legacy/<file>` |
| `../outputs/<file>` / `../../outputs/<file>` | correct relative path to `Mingla_Artifacts/archive/outputs_legacy/<file>` from the source document |
| `clade transfer/<file>` | `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/<file>` |
| `../clade transfer/<file>` / `../../clade transfer/<file>` | correct relative path to `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/<file>` from the source document |
| `Mingla_Artifacts/SPEC_QUEUE.md` | keep old path as breadcrumb; optional archive link to `archive/old_trackers/SPEC_QUEUE.md` |
| `Mingla_Artifacts/TEST_QUEUE.md` | keep old path as breadcrumb; optional archive link to `archive/old_trackers/TEST_QUEUE.md` |
| `Mingla_Artifacts/RETEST_LEDGER.md` | keep old path as breadcrumb; optional archive link to `archive/old_trackers/RETEST_LEDGER.md` |

Constraints:

- Rewrite only markdown link targets, not free-text historical prose unless needed for readability.
- Preserve anchors and section labels where possible.
- Do not rewrite private prompt links into fake public artifacts.
- After link rewrites and moves/copies, missing-link count must be less than or equal to 1,195. Any increase is a failed implementation.

## 7. Manifest Updates

Update `Mingla_Artifacts/ARTIFACT_MANIFEST.md` in the same implementation:

1. Add `Mingla_Artifacts/archive/` and child index rows.
2. Change all `outputs/` rows from old ignored paths to archive paths after copied/versioned preservation.
3. Change all `clade transfer/` rows to archive paths after Git moves.
4. Change deprecated queue rows to point at archive originals, with the top-level stubs listed as breadcrumbs.
5. Add a short ORCH-0750C close note under the ORCH-0750C section with final link-check numbers.
6. Do not mark prompts as current authority.

## 8. Implementation Scope

In scope files and paths:

- `Mingla_Artifacts/ARTIFACT_MANIFEST.md`
- `Mingla_Artifacts/archive/**`
- `Mingla_Artifacts/SPEC_QUEUE.md`
- `Mingla_Artifacts/TEST_QUEUE.md`
- `Mingla_Artifacts/RETEST_LEDGER.md`
- `clade transfer/**`
- `outputs/**` as source-only local material copied into archive
- markdown files that contain links to moved/copied paths
- optional deletion of the 3 tracked `mingla-admin/dist` assets if all delete preconditions pass
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750C_ARCHIVE_DELETE_PASS.md`

Out of scope:

- Product/runtime code
- Supabase migrations/functions
- Package/dependency changes
- Bulk report/spec archival
- Prompt versioning
- Branch/main reconciliation
- Full 1,195 broken-link cleanup
- Rewriting `PRODUCT_SNAPSHOT.md` or `PRIORITY_BOARD.md` old sections beyond links directly required by this archive pass

## 9. Implementation Order

1. Run preflight inventory:

```sh
find outputs -type f | sort
find "clade transfer" -type f | sort
git ls-files outputs "clade transfer" Mingla_Artifacts/SPEC_QUEUE.md Mingla_Artifacts/TEST_QUEUE.md Mingla_Artifacts/RETEST_LEDGER.md mingla-admin/dist
python3 scripts/docs/check_links.py --format markdown
```

2. Create archive index files under `Mingla_Artifacts/archive/`.
3. Copy ignored `outputs/` files into `Mingla_Artifacts/archive/outputs_legacy/` and ensure the archive copies are versionable. Do not delete the ignored originals.
4. Move tracked `clade transfer/` files into `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/`.
5. Copy full deprecated queue files into `Mingla_Artifacts/archive/old_trackers/`, then replace the top-level queue files with breadcrumb stubs.
6. Rewrite markdown links for the exact moved/copied paths.
7. Update manifest rows and ORCH-0750C close note.
8. Evaluate tracked generated deletion candidates. Delete only if all delete preconditions pass; otherwise document deferred deletion.
9. Run final link checker and write implementation report.

## 10. Success Criteria

| ID | Criterion | Verification |
|---|---|---|
| SC-1 | `Mingla_Artifacts/archive/README.md` exists and explains archive categories. | File read. |
| SC-2 | The 10 `outputs/` files are preserved under `Mingla_Artifacts/archive/outputs_legacy/`. | `find Mingla_Artifacts/archive/outputs_legacy -type f | wc -l` returns at least 11 including README. |
| SC-3 | The 5 tracked `clade transfer/` files are moved under `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/`. | `git status --short` shows renames or delete/add pairs with matching basenames. |
| SC-4 | Deprecated queue top-level files remain as breadcrumbs, not active queues. | Read first 40 lines of each queue file. |
| SC-5 | Manifest reflects every archive move/copy. | `rg "outputs_legacy|handoffs_legacy|old_trackers" Mingla_Artifacts/ARTIFACT_MANIFEST.md`. |
| SC-6 | Missing-link count does not increase beyond 1,195. | `python3 scripts/docs/check_links.py --format markdown`. |
| SC-7 | Prompt links are not falsely versioned or archived. | `git status --short Mingla_Artifacts/prompts` remains empty unless user explicitly versioned prompts outside this spec. |
| SC-8 | Any deletion is limited to proven tracked generated candidates. | Implementation report lists delete evidence; otherwise says "no deletes performed." |

## 11. Test Matrix

| ID | Scenario | Expected | Verification |
|---|---|---|---|
| T-1 | Archive index exists | Human can start at archive README and understand categories | `sed -n '1,160p' Mingla_Artifacts/archive/README.md` |
| T-2 | Link checker after archive move | Missing links <= 1,195 | `python3 scripts/docs/check_links.py --format markdown` |
| T-3 | `outputs/` preservation | All 10 source basenames appear in archive | compare `find outputs` and `find Mingla_Artifacts/archive/outputs_legacy` basenames |
| T-4 | `clade transfer/` preservation | All 5 source basenames appear in archive | compare preflight list to archive list |
| T-5 | Queue stubs | No reader can mistake queues for active work boards | first lines say deprecated, archived, superseded by `AGENT_HANDOFFS.md` |
| T-6 | Manifest authority | README/archive users can find old material through manifest | `rg` checks manifest archive paths |
| T-7 | Generated deletion safety | No source/docs references deleted tracked `dist` assets | `rg` returns no live references before delete |

## 12. Rollback Plan

If link count increases or archive inventory is incomplete:

1. Move `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/*` back to `clade transfer/`.
2. Restore queue files from `Mingla_Artifacts/archive/old_trackers/`.
3. Remove ORCH-0750C archive rows added to `ARTIFACT_MANIFEST.md`.
4. Revert markdown link rewrites for moved/copied paths.
5. Restore any deleted generated tracked files from Git if deletion was performed.
6. Re-run `python3 scripts/docs/check_links.py --format markdown` and confirm the missing count is back to baseline.

## 13. Regression Prevention

- The link checker remains the guardrail. Any archive move that worsens missing links fails.
- `README.md` stays a snapshot and must not become the archive index.
- Ignored/private prompts stay marked `PRIVATE_PROMPT_NOT_VERSIONED` until a separate prompt-versioning decision exists.
- Generated build output under ignored directories should not be tracked. If ORCH-0750C deletes the 3 tracked `dist` files, the implementation report must say the cleanup is complete for that exact class.
- Future archive waves must start from the manifest, not folder vibes.

## 14. Handoff To Implementor

Implement ORCH-0750C as an archive preservation pass, not a purge. Copy ignored `outputs/` into a versioned archive, move tracked `clade transfer/` into the archive, turn deprecated queue files into breadcrumbs with originals preserved under `old_trackers/`, rewrite only the affected markdown links, and update the manifest. Run the link checker before and after; the missing-link count must not exceed 1,195. Delete only the three tracked generated `mingla-admin/dist` assets if reference checks prove they are unused; otherwise defer deletion and say so plainly.
