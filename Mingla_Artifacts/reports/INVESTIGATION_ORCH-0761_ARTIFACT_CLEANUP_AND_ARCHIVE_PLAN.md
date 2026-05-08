# Investigation: ORCH-0761 Artifact Cleanup And Archive Plan

> Date: 2026-05-08
> Skill: `$forensics`
> Dispatch: `Mingla_Artifacts/prompts/FORENSICS_ORCH-0761_ARTIFACT_CLEANUP_AND_ARCHIVE_PLAN.md`
> Verdict: cleanup plan ready for orchestrator review; implementation spec can be written from this report.

## Verdict

Do a narrow cleanup implementation, not a broad archive sweep.

The safe cleanup set is:

1. Move the executable ORCH-0729 SQL runbook out of the top-level artifact root into `Mingla_Artifacts/backups/`.
2. Move two isolated historical top-level artifacts into archive folders:
   - `Mingla_Artifacts/TEST_REPORT_OTP_MULTI_CHANNEL.md`
   - `Mingla_Artifacts/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md`
3. Reclassify several `archive_later` docs that should stay in place because `Mingla_Roadmap/`, current reports, or active runbooks still cite them.
4. Do not move directory-level candidates yet. `handoffs/`, `design-package/`, `github/`, and `signal-lab/` all still have active or heavy historical references that need a separate absorption/archive pass.

This is a documentation/evidence cleanup. No product code, Supabase mutation, migration, edge function, Stripe, GitHub issue, or roadmap content rewrite is required.

## Plain-English Impact

The roadmap room is clean now, but the artifact room still has a few loose boxes. The danger is moving too much: some files look old but still serve as source evidence for roadmap rows, business journey reports, design absorption, or operator retention work.

The cleanup should remove the genuinely misplaced top-level clutter without laundering stale strategy into current truth or breaking historical links.

## Current State Inventory

Top-level `Mingla_Artifacts/` currently has 27 files. The relevant candidates are:

- one tracked executable SQL runbook at root;
- seven strategy/product/GTM docs marked `archive_later`;
- one active-looking founder feedback log marked archive-only;
- one operator retention runbook marked archive-only;
- one historical OTP report at root;
- one specific historical handoff at root;
- three deprecated queue breadcrumbs that are intentionally retained;
- four first-level directories marked `archive_later`.

Current archive root contains:

- `Mingla_Artifacts/archive/outputs_legacy/`
- `Mingla_Artifacts/archive/handoffs_legacy/`
- `Mingla_Artifacts/archive/old_trackers/`

`ARTIFACT_MANIFEST.md` also names planned archive categories that do not yet exist:

- `superseded_specs/`
- `superseded_reports/`
- `migration_history/`
- `generated_or_transient/`

## Candidate Classification Table

| Path | Current manifest status | Current role | Recommended action | Proposed destination | References found | Required rewrites | Risk | Confidence |
|---|---|---|---|---|---:|---|---|---|
| `Mingla_Artifacts/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` | Not individually listed; ORCH-0760 classified `CLEANUP_REQUIRED` | Executable production migration-history runbook | `MOVE_TO_EVIDENCE_FOLDER` | `Mingla_Artifacts/backups/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` | 5 full-path / 9 basename refs | Update manifest, archive/backup index, all durable references, and the run command inside the SQL file | Medium: executable SQL path appears in instructions | High |
| `Mingla_Artifacts/TEST_REPORT_OTP_MULTI_CHANNEL.md` | `ARCHIVE_ONLY`, `archive_later` | Historical ORCH-0370 root test report | `MOVE_TO_ARCHIVE` | `Mingla_Artifacts/archive/superseded_reports/TEST_REPORT_OTP_MULTI_CHANNEL.md` | 2 full-path / 4 basename refs | Update manifest and ORCH-0760/0761 references if needed | Low | High |
| `Mingla_Artifacts/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` | `ARCHIVE_ONLY`, `archive_later` | Historical one-off process handoff | `MOVE_TO_ARCHIVE` | `Mingla_Artifacts/archive/handoffs_legacy/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` | 4 full-path / 6 basename refs | Update manifest and ORCH-0760/0761 references if needed | Low | High |
| `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md` | `ARCHIVE_ONLY`, `archive_later` | Historical business execution plan with stale `mingla-web` warning | `RECLASSIFY_ONLY` | Keep current path | 11 full-path / 18 basename refs | Manifest should say historical source, superseded for current planning by roadmap summaries | Medium: design/spec history still cites it | High |
| `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md` | `ARCHIVE_ONLY`, `archive_later` | Historical/partial business strategy source | `RECLASSIFY_ONLY` | Keep current path | 15 full-path / 22 basename refs | Manifest should point current interpretation to `Mingla_Roadmap/source-summaries/business-strategic-plan-summary.md` | High: roadmap rows still cite it | High |
| `Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md` | `ARCHIVE_ONLY`, `archive_later` | Future AI/Brain strategy source | `RECLASSIFY_ONLY` | Keep current path | 11 full-path / 14 basename refs | Manifest should say strategic source, no implementation authority, summarized by roadmap | Medium | High |
| `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` | `ARCHIVE_ONLY`, `archive_later` | B5 Marketing Hub strategy source | `RECLASSIFY_ONLY` | Keep current path | 10 full-path / 13 basename refs | Manifest should say strategic source with B2/B3/B4 prerequisites, summarized by roadmap | High: GitHub cycle-b5/b6 call it strategy doc | High |
| `Mingla_Artifacts/MINGLA_PRODUCT_COMPETITIVE_ANALYSIS.md` | `ARCHIVE_ONLY`, `archive_later` | Historical/partial product and competitive source | `RECLASSIFY_ONLY` | Keep current path | 7 full-path / 10 basename refs | Manifest should point current interpretation to roadmap summary | Medium | High |
| `Mingla_Artifacts/POSITIONING_AND_GTM_STRATEGY.md` | `ARCHIVE_ONLY`, `archive_later` | Older GTM/pricing/launch source | `RECLASSIFY_ONLY` | Keep current path | 7 full-path / 11 basename refs | Manifest should mark as historical GTM source, stale metrics require revalidation | Medium | High |
| `Mingla_Artifacts/FOUNDER_FEEDBACK.md` | `ARCHIVE_ONLY`, `archive_later` | Append-only founder feedback signal log | `RECLASSIFY_ONLY` | Keep current path | 16 full-path / 23 basename refs | Manifest should mark as current ledger/partial, not archive-only | High: active roadmap feature media cites it | High |
| `Mingla_Artifacts/RETENTION_REMINDERS.md` | `ARCHIVE_ONLY`, `archive_later` | Operator scheduled cleanup runbook | `RECLASSIFY_ONLY` | Keep current path | 5 full-path / 7 basename refs | Manifest should mark as current/partial runbook until dated tasks close | High: contains future 2026-05-19 cleanup | High |
| `Mingla_Artifacts/SPEC_QUEUE.md` | `ARCHIVE_ONLY`, `keep_breadcrumb` | Deprecated breadcrumb | `DO_NOT_TOUCH` | Keep current path | 11 full-path / 18 basename refs | None | High if moved: docs gate enforces it | High |
| `Mingla_Artifacts/TEST_QUEUE.md` | `ARCHIVE_ONLY`, `keep_breadcrumb` | Deprecated breadcrumb | `DO_NOT_TOUCH` | Keep current path | 9 full-path / 18 basename refs | None | High if moved: docs gate enforces it | High |
| `Mingla_Artifacts/RETEST_LEDGER.md` | `ARCHIVE_ONLY`, `keep_breadcrumb` | Deprecated breadcrumb | `DO_NOT_TOUCH` | Keep current path | 9 full-path / 18 basename refs | None | High if moved: docs gate enforces it | High |
| `Mingla_Artifacts/handoffs/` | `ARCHIVE_ONLY`, `archive_later` | Current root for `HANDOFF_BUSINESS_DESIGNER.md` | `DEFER_PENDING_AUTHORITY` | Keep current path for now | 6 path refs; 1 tracked file | Needs design-handoff-specific archive decision | High: user has handoff open and reports cite it as authoritative source | High |
| `Mingla_Artifacts/design-package/` | `ARCHIVE_ONLY`, `archive_later` | Claude Design bundle and prototype source | `DEFER_PENDING_AUTHORITY` | Keep current path for now | 17 path refs; 21 tracked files | Needs design-package absorption/archive plan | High: many business cycle specs/reports cite files directly | High |
| `Mingla_Artifacts/github/` | `ARCHIVE_ONLY`, `archive_later` | GitHub project sync and cycle epic source | `RECLASSIFY_ONLY` | Keep current path | 22 path refs; 36 tracked files | Manifest should say historical/project planning source used by roadmap | High: roadmap feature rows cite epics | High |
| `Mingla_Artifacts/signal-lab/` | `ARCHIVE_ONLY`, `archive_later` | Signal taxonomy and calibration docs | `RECLASSIFY_ONLY` | Keep current path | 6 path refs; 4 tracked files | Manifest should mark as current signal taxonomy ledger/partial authority | High if archived: `INDEX.md` claims current taxonomy authority | High |

## Reference And Link Audit

### Current link baseline

`python3 scripts/docs/check_links.py --baseline-file scripts/docs/link_baseline.json` currently reports:

```text
files_checked=559
total_links=1801
missing_links=4
missing_by_classification:
  TRUE_MISSING_REFERENCE: 3
  MOVED_OR_ARCHIVED_CANDIDATE: 1
top_sources:
  2 Mingla_Artifacts/prompts/B2A_PATH_C_V3_SUB_B_COMPLETION.md
  2 Mingla_Artifacts/prompts/B2A_PATH_C_V3_SUB_C_DISPATCH.md
```

Those are inherited private prompt-link debts, not new ORCH-0761 findings.

### High-risk references

These files should not move in this pass because current roadmap/source docs reference them:

- `BUSINESS_STRATEGIC_PLAN.md` appears in `Mingla_Roadmap/FEATURE_REGISTRY.md`, `living/PRODUCT_STRATEGY.md`, `living/GTM_AND_POSITIONING.md`, and source summaries.
- `MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` appears in `FEAT-0014`, cycle-b5, cycle-b6, and the Marketing Hub summary.
- `MINGLA_BRAIN_AGENT_STRATEGY.md` appears in `FEAT-0015`, cycle-b6, and the Brain summary.
- `MINGLA_PRODUCT_COMPETITIVE_ANALYSIS.md` and `POSITIONING_AND_GTM_STRATEGY.md` appear in feature rows and living docs.
- `FOUNDER_FEEDBACK.md` appears in `FEAT-0006` and current lifecycle/source-summary evidence.
- `Mingla_Artifacts/github/` is referenced by `FEATURE_REGISTRY.md`, source summaries, multiple business investigations, and future feature planning.
- `Mingla_Artifacts/design-package/` and `HANDOFF_BUSINESS_DESIGNER.md` are still used as design source evidence by business cycle reports/specs.
- `signal-lab/INDEX.md` explicitly declares the folder as the human-readable taxonomy state for signals/vibes/anti-signals.

### Low-risk move references

`TEST_REPORT_OTP_MULTI_CHANNEL.md` and `HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` are low-risk archive candidates. Their references are mostly manifest, ORCH-0760/0761 cleanup discussion, and their own files.

### SQL runbook references

`ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` has a self-reference in its run command:

```text
supabase db execute -f Mingla_Artifacts/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql
```

If moved, the implementation must update this command to the new path. It must not execute the SQL.

## Recommended Archive / Move Plan

### Move set for first implementation

Move only these files:

| Old path | New path | Why |
|---|---|---|
| `Mingla_Artifacts/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` | `Mingla_Artifacts/backups/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` | It is executable production-adjacent SQL and belongs with backup/rollback/provenance material, not top-level artifact navigation. |
| `Mingla_Artifacts/TEST_REPORT_OTP_MULTI_CHANNEL.md` | `Mingla_Artifacts/archive/superseded_reports/TEST_REPORT_OTP_MULTI_CHANNEL.md` | Historical root report with low active reference risk. |
| `Mingla_Artifacts/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` | `Mingla_Artifacts/archive/handoffs_legacy/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` | Historical one-off handoff; existing archive category matches it. |

Create if missing:

- `Mingla_Artifacts/archive/superseded_reports/README.md`

Do not create `archive/migration_history/` for the SQL runbook in this pass. The repo already has `Mingla_Artifacts/backups/` and `Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/`; `backups/` is the cleaner destination for a runnable rollback/runbook file.

### Reclassification set for first implementation

Update `ARTIFACT_MANIFEST.md` only; keep paths unchanged:

- `BUSINESS_PROJECT_PLAN.md`
- `BUSINESS_STRATEGIC_PLAN.md`
- `FOUNDER_FEEDBACK.md`
- `MINGLA_BRAIN_AGENT_STRATEGY.md`
- `MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md`
- `MINGLA_PRODUCT_COMPETITIVE_ANALYSIS.md`
- `POSITIONING_AND_GTM_STRATEGY.md`
- `RETENTION_REMINDERS.md`
- `Mingla_Artifacts/github/`
- `Mingla_Artifacts/signal-lab/`

Recommended manifest language:

- strategy docs: historical source material, current interpretation lives in `Mingla_Roadmap/source-summaries/`;
- founder feedback: current partial signal ledger, not archive-only;
- retention reminders: current operator runbook until all dated work is complete;
- GitHub folder: historical/project planning source used by roadmap, not current lifecycle authority;
- signal-lab: current signal taxonomy/calibration ledger, implementation truth remains DB/edge code.

### Deferred set

Do not move in the first cleanup implementation:

- `Mingla_Artifacts/handoffs/`
- `Mingla_Artifacts/design-package/`

Reason: these are deeply referenced by business design absorption and journey reports. A move should be its own design-package absorption/archive project, likely after the current `HANDOFF_BUSINESS_DESIGNER.md` and design-package references are reconciled.

## Files That Must Stay Put

- `Mingla_Artifacts/AGENT_HANDOFFS.md`
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md`
- `Mingla_Artifacts/BUSINESS_PRD.md`
- `Mingla_Artifacts/COVERAGE_MAP.md`
- `Mingla_Artifacts/DECISION_LOG.md`
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- `Mingla_Artifacts/MASTER_BUG_LIST.md`
- `Mingla_Artifacts/OPEN_INVESTIGATIONS.md`
- `Mingla_Artifacts/PRIORITY_BOARD.md`
- `Mingla_Artifacts/PRODUCT_SNAPSHOT.md`
- `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md`
- `Mingla_Artifacts/WORLD_MAP.md`
- `Mingla_Artifacts/SPEC_QUEUE.md`
- `Mingla_Artifacts/TEST_QUEUE.md`
- `Mingla_Artifacts/RETEST_LEDGER.md`
- `Mingla_Artifacts/prompts/`
- `Mingla_Roadmap/`

## Files That Need Breadcrumbs

No new top-level breadcrumb is required for the first move set if all durable references are rewritten.

Existing breadcrumbs must remain:

- `Mingla_Artifacts/SPEC_QUEUE.md`
- `Mingla_Artifacts/TEST_QUEUE.md`
- `Mingla_Artifacts/RETEST_LEDGER.md`

If the implementor elects not to rewrite historical references to `TEST_REPORT_OTP_MULTI_CHANNEL.md` or `HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md`, then a breadcrumb stub is required. The preferred path is rewriting references instead of leaving more top-level stubs.

Do not leave a root `.sql` breadcrumb for ORCH-0729. A non-executing breadcrumb would be safer as Markdown, but the better implementation is a clean move plus rewritten references.

## Manifest / README / Archive Index Updates Required

### `ARTIFACT_MANIFEST.md`

Required:

- Add or update a row for `Mingla_Artifacts/backups/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql`.
- Remove/reclassify the old top-level ORCH-0729 SQL path if an explicit row is added.
- Update `ART-TOP-OTP-TEST-REPORT` to the new archive path, status `ARCHIVE_ONLY`, archive policy `archived`.
- Update `ART-TOP-HANDOFF-META-ORCH-0744` to the new handoffs archive path, status `ARCHIVE_ONLY`, archive policy `archived`.
- Add `ART-ARCHIVE-SUPERSEDED-REPORTS` for `Mingla_Artifacts/archive/superseded_reports/`.
- Reclassify source docs that stay put as described above.

### `Mingla_Artifacts/archive/README.md`

Required:

- Add `superseded_reports/` section.
- Mention that some executable SQL evidence lives under `Mingla_Artifacts/backups/`, not archive.

### `Mingla_Artifacts/backups/`

Recommended:

- Add `Mingla_Artifacts/backups/README.md` if not present.
- Explain that files here are preservation/runbook material, not active instructions unless a current ORCH explicitly says to run them.

### `README.md`

No direct README change is required for this first cleanup unless the implementation changes the archive root sections in a way README must mention. README already points to the artifact manifest and archive index instead of listing every artifact.

## Docs Gate Updates Required

`scripts/docs/check_artifact_placement.py` should be updated if the implementation adds `archive/superseded_reports/` or `backups/README.md` as required archive/backup landmarks.

Minimum recommended gate additions:

- archive README must mention `superseded_reports/`;
- if `Mingla_Artifacts/backups/README.md` is added, placement check should require it;
- keep existing breadcrumb checks unchanged.

`scripts/docs/check_readme_snapshot.py` likely needs no change.

## Link Baseline Impact

The implementation should target no increase in missing links.

Required verification after implementation:

```bash
python3 scripts/docs/check_links.py --baseline-file scripts/docs/link_baseline.json
python3 scripts/docs/check_artifact_placement.py
python3 scripts/docs/check_readme_snapshot.py
git diff --check
```

Expected link result should remain the inherited 4 prompt-link debts unless the cleanup rewrites historical links enough to reduce them.

## Risks

| Risk | Class | Evidence | Mitigation |
|---|---|---|---|
| Moving strategy docs breaks roadmap feature/source links | confirmed bug risk | Roadmap rows directly cite `BUSINESS_STRATEGIC_PLAN.md`, `POSITIONING_AND_GTM_STRATEGY.md`, strategy docs | Do not move them in first cleanup; reclassify only |
| Moving `github/` breaks roadmap and cycle evidence | confirmed bug risk | 22 path refs; roadmap feature rows cite cycle epics | Keep path; reclassify only |
| Moving design package breaks historical business cycle specs/reports | confirmed bug risk | Many business cycle reports cite design-package files and `HANDOFF_BUSINESS_DESIGNER.md` | Defer to separate design archive/absorption pass |
| Root SQL remains too easy to run accidentally | production-hardening gap | Tracked `.sql` at top-level includes `BEGIN; DELETE FROM supabase_migrations.schema_migrations` | Move to `backups/` and label as preservation/runbook |
| Retention reminders are misclassified as archive-only | confirmed docs classification bug | File has future 2026-05-19 operator task | Reclassify as current/partial runbook |
| Signal-lab is misclassified as archive-only | confirmed docs classification bug | `signal-lab/INDEX.md` says it is taxonomy authority | Reclassify as current signal taxonomy ledger |

## Proposed Implementation Scope

Implementor should:

1. Move:
   - `Mingla_Artifacts/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` -> `Mingla_Artifacts/backups/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql`
   - `Mingla_Artifacts/TEST_REPORT_OTP_MULTI_CHANNEL.md` -> `Mingla_Artifacts/archive/superseded_reports/TEST_REPORT_OTP_MULTI_CHANNEL.md`
   - `Mingla_Artifacts/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` -> `Mingla_Artifacts/archive/handoffs_legacy/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md`
2. Add `Mingla_Artifacts/archive/superseded_reports/README.md`.
3. Add `Mingla_Artifacts/backups/README.md`.
4. Update the ORCH-0729 SQL internal run command to the new path.
5. Rewrite durable references to moved files in:
   - `Mingla_Artifacts/ARTIFACT_MANIFEST.md`
   - `Mingla_Artifacts/WORLD_MAP.md`
   - `Mingla_Artifacts/OPEN_INVESTIGATIONS.md`
   - `Mingla_Artifacts/AGENT_HANDOFFS.md`
   - `Mingla_Artifacts/PRIORITY_BOARD.md`
   - `Mingla_Artifacts/MASTER_BUG_LIST.md` if still applicable
   - ORCH-0760/0761 reports where needed
6. Reclassify the keep-in-place candidates in `ARTIFACT_MANIFEST.md`.
7. Update `Mingla_Artifacts/archive/README.md`.
8. Update docs gate if adding required archive/backup landmarks.
9. Run docs verification and report exact output.

## Non-Goals For Implementation

- No product code.
- No Supabase mutation.
- No migration creation.
- No edge deploy.
- No running the ORCH-0729 SQL.
- No moving strategy docs used by `Mingla_Roadmap/`.
- No moving `Mingla_Artifacts/github/`.
- No moving `Mingla_Artifacts/design-package/`.
- No moving `Mingla_Artifacts/handoffs/`.
- No moving `Mingla_Artifacts/signal-lab/`.
- No deleting files.
- No updating `Mingla_Roadmap/` content except if a path rewrite is required by the move set.

## Open Questions

1. Should the future design-package archive pass rename `Mingla_Artifacts/design-package/mingla-business-app-screens/` to a versioned folder such as `v0.4-claude-design/` as suggested by `SPEC_BIZ_DESIGN_ABSORPTION.md`?
2. Should `Mingla_Artifacts/github/` remain a long-term historical planning source now that `Mingla_Roadmap/` owns current roadmap, or should it eventually move after every roadmap reference points at summaries?
3. Should `Mingla_Artifacts/signal-lab/` become a first-class current authority in README Source Of Truth, or remain discoverable only through the manifest?
4. Should `FOUNDER_FEEDBACK.md` be reclassified as current signal ledger permanently, or copied into an append-only archive after open items are all linked to ORCH/FEAT IDs?

## Commands Run

```bash
sed -n '1,220p' .codex/skills/forensic-mingla/SKILL.md
sed -n '1,260p' Mingla_Artifacts/prompts/FORENSICS_ORCH-0761_ARTIFACT_CLEANUP_AND_ARCHIVE_PLAN.md
sed -n '1,260p' Mingla_Artifacts/reports/INVESTIGATION_ORCH-0760_MINGLA_ROADMAP_PRODUCT_MARKETING_SYSTEM.md
sed -n '1,180p' Mingla_Artifacts/reports/REVIEW_ORCH-0760_MINGLA_ROADMAP_POPULATION.md
sed -n '1,210p' Mingla_Artifacts/ARTIFACT_MANIFEST.md
sed -n '1,180p' README.md
sed -n '1,220p' Mingla_Artifacts/archive/README.md
sed -n '1,150p' scripts/docs/check_artifact_placement.py
sed -n '1,110p' scripts/docs/check_readme_snapshot.py
git ls-files --error-unmatch <candidate>
rg -l --fixed-strings <candidate> README.md docs Mingla_Artifacts Mingla_Roadmap .codex/skills scripts .github
sed -n '1,8p' <candidate>
find Mingla_Artifacts/archive -maxdepth 2 -type d
find Mingla_Artifacts/archive -maxdepth 2 -type f
git ls-files Mingla_Artifacts/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql Mingla_Artifacts/TEST_REPORT_OTP_MULTI_CHANNEL.md Mingla_Artifacts/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md Mingla_Artifacts/handoffs Mingla_Artifacts/design-package Mingla_Artifacts/github Mingla_Artifacts/signal-lab
python3 scripts/docs/check_links.py --baseline-file scripts/docs/link_baseline.json
```
