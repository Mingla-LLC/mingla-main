# Implementation: ORCH-0761 Artifact Cleanup And Archive Plan

> Date: 2026-05-08
> Skill: `$implementor`
> Prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0761_ARTIFACT_CLEANUP_AND_ARCHIVE_PLAN.md`
> Status: implemented and verified

## Summary

Implemented the approved narrow artifact cleanup. This pass moved only the three approved historical/misplaced artifacts, added archive/backup indexes, reclassified still-current source material in the manifest, and tightened the artifact placement gate.

No product code, Supabase migrations, edge functions, Stripe, app-mobile, mingla-business, or mingla-admin behavior was intentionally changed by ORCH-0761. The existing unrelated dirty app/business/Supabase worktree state was left untouched.

## Files Moved

| Old path | New path |
|---|---|
| `Mingla_Artifacts/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` | `Mingla_Artifacts/backups/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` |
| `Mingla_Artifacts/TEST_REPORT_OTP_MULTI_CHANNEL.md` | `Mingla_Artifacts/archive/superseded_reports/TEST_REPORT_OTP_MULTI_CHANNEL.md` |
| `Mingla_Artifacts/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` | `Mingla_Artifacts/archive/handoffs_legacy/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` |

## Files Added

- `Mingla_Artifacts/archive/superseded_reports/README.md`
- `Mingla_Artifacts/backups/README.md`

## Files Edited

- `Mingla_Artifacts/ARTIFACT_MANIFEST.md`
- `Mingla_Artifacts/archive/README.md`
- `Mingla_Artifacts/backups/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql`
- `Mingla_Artifacts/archive/handoffs_legacy/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md`
- `scripts/docs/check_artifact_placement.py`

## Manifest Reclassification

Reclassified these keep-in-place artifacts away from stale archive-only/archive-later treatment:

- `BUSINESS_PROJECT_PLAN.md`: historical business execution source, current planning interpretation in roadmap summaries.
- `BUSINESS_STRATEGIC_PLAN.md`: historical/partial strategy source, current interpretation in `business-strategic-plan-summary.md`.
- `FOUNDER_FEEDBACK.md`: current partial founder signal ledger.
- `MINGLA_BRAIN_AGENT_STRATEGY.md`: strategic source, no implementation authority, summarized by roadmap.
- `MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md`: strategic source with B2/B3/B4 prerequisites, summarized by roadmap.
- `MINGLA_PRODUCT_COMPETITIVE_ANALYSIS.md`: historical/partial competitive source, interpreted by roadmap summaries.
- `POSITIONING_AND_GTM_STRATEGY.md`: historical GTM source; stale metrics require revalidation.
- `RETENTION_REMINDERS.md`: current operator runbook until dated tasks close.
- `Mingla_Artifacts/github/`: historical/project planning source used by roadmap, not lifecycle authority.
- `Mingla_Artifacts/signal-lab/`: current signal taxonomy/calibration ledger; implementation truth remains DB/edge code.

Added/updated manifest coverage for:

- `Mingla_Artifacts/backups/`
- `Mingla_Artifacts/backups/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql`
- `Mingla_Artifacts/archive/superseded_reports/`
- moved OTP report path
- moved ORCH-0744 handoff path

## Reference And Index Updates

- Updated the ORCH-0729 SQL internal CLI command to the new `backups/` path.
- Updated the moved ORCH-0744 handoff self-references to its archive path.
- Added `superseded_reports/` to the archive README.
- Added archive README language that executable SQL evidence/runbooks live under `Mingla_Artifacts/backups/`, not archive root.
- Updated `check_artifact_placement.py` to require:
  - `superseded_reports/` in the archive README,
  - `Mingla_Artifacts/backups/` in the archive README,
  - `Mingla_Artifacts/archive/superseded_reports/README.md`,
  - `Mingla_Artifacts/backups/README.md`.

## Verification

### Link Checker

```text
python3 scripts/docs/check_links.py --baseline-file scripts/docs/link_baseline.json
files_checked=567
total_links=1801
missing_links=4

missing_by_classification:
  TRUE_MISSING_REFERENCE: 3
  MOVED_OR_ARCHIVED_CANDIDATE: 1

top_sources:
  2	Mingla_Artifacts/prompts/B2A_PATH_C_V3_SUB_B_COMPLETION.md
  2	Mingla_Artifacts/prompts/B2A_PATH_C_V3_SUB_C_DISPATCH.md

top_targets:
  1	feedback_strict_grep_registry_pattern.md
  1	references/report-template.md
  1	feedback_implementor_uses_ui_ux_pro_max.md
  1	feedback_confirm_ux_semantics_before_dispatch.md
```

Result: no increase above inherited B2A private-prompt link debt.

### Artifact Placement

```text
python3 scripts/docs/check_artifact_placement.py
Artifact placement check PASS
- no tracked files under root outputs/ or clade transfer/
- no tracked existing dist/build/web-build artifacts
- private prompt/tool roots remain ignored
- deprecated queues remain breadcrumbs
- Mingla skills avoid stale outputs/* current destinations
- Mingla roadmap system paths remain present
```

### README Snapshot

```text
python3 scripts/docs/check_readme_snapshot.py
README snapshot check PASS
- README declares itself a snapshot
- source-of-truth links point to manifest/archive authorities
- docs lock-in commands are present
- repo map avoids stale active docs roots
```

### Whitespace

```text
git diff --check
```

Result: PASS with no output.

## Scoped Git Status

```text
 M Mingla_Artifacts/ARTIFACT_MANIFEST.md
 M Mingla_Artifacts/archive/README.md
AM Mingla_Artifacts/archive/handoffs_legacy/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md
A  Mingla_Artifacts/archive/superseded_reports/TEST_REPORT_OTP_MULTI_CHANNEL.md
AM Mingla_Artifacts/backups/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql
 M scripts/docs/check_artifact_placement.py
?? Mingla_Artifacts/archive/superseded_reports/README.md
?? Mingla_Artifacts/backups/README.md
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0761_ARTIFACT_CLEANUP_AND_ARCHIVE_PLAN.md
```

## Non-Goals Honored

- Did not run the ORCH-0729 SQL.
- Did not delete files.
- Did not leave a root SQL breadcrumb.
- Did not move `handoffs/`, `design-package/`, `github/`, or `signal-lab/`.
- Did not move roadmap-linked strategy docs.
- Did not touch `SPEC_QUEUE.md`, `TEST_QUEUE.md`, or `RETEST_LEDGER.md`.
- Did not normalize unrelated dirty work.

## Follow-Up

The separate design-package/handoff absorption/archive pass remains deferred. ORCH-0761 intentionally did not move `Mingla_Artifacts/design-package/` or `Mingla_Artifacts/handoffs/` because current business design reports still cite them directly.
