# Review: ORCH-0761 Artifact Cleanup And Archive Plan

> Date: 2026-05-08
> Skill: `$orchestrator`
> Reviewed artifact: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0761_ARTIFACT_CLEANUP_AND_ARCHIVE_PLAN.md`
> Verdict: APPROVED FOR IMPLEMENTATION DISPATCH

## Bottom Line

ORCH-0761 is approved for a narrow documentation cleanup implementation.

The forensic report did the important thing: it separated truly misplaced top-level clutter from historical source material that still feeds `Mingla_Roadmap/`, business design evidence, or operator runbooks. The next step is not a broad archive sweep. It is a bounded move/reclassify pass with link preservation.

## Approved Scope

Move exactly these three artifacts:

| Current path | Destination | Reason |
|---|---|---|
| `Mingla_Artifacts/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` | `Mingla_Artifacts/backups/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` | Executable production-adjacent SQL should not live at top-level artifact root. |
| `Mingla_Artifacts/TEST_REPORT_OTP_MULTI_CHANNEL.md` | `Mingla_Artifacts/archive/superseded_reports/TEST_REPORT_OTP_MULTI_CHANNEL.md` | Historical root report with low active reference risk. |
| `Mingla_Artifacts/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` | `Mingla_Artifacts/archive/handoffs_legacy/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` | Historical one-off handoff; existing legacy handoff archive category fits. |

Add/update only the supporting documentation required to make those moves understandable:

- `Mingla_Artifacts/archive/superseded_reports/README.md`
- `Mingla_Artifacts/backups/README.md`
- `Mingla_Artifacts/archive/README.md`
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md`
- durable references to the moved paths
- docs placement gate if the new archive/backup landmarks become required

## Reclassify But Do Not Move

The following should stay at their current paths and be reclassified in the manifest because they still serve as source evidence, current signal ledgers, or planning provenance:

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

## Hard Non-Goals

- Do not move `Mingla_Artifacts/handoffs/`.
- Do not move `Mingla_Artifacts/design-package/`.
- Do not move `Mingla_Artifacts/github/`.
- Do not move `Mingla_Artifacts/signal-lab/`.
- Do not move strategy docs used by `Mingla_Roadmap/`.
- Do not delete files.
- Do not run `ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql`.
- Do not change product code, Supabase schema, edge functions, migrations, Stripe, app-mobile, mingla-business, or mingla-admin behavior.
- Do not normalize unrelated dirty work.

## Evidence Review

Forensics produced a high-confidence classification table with reference counts, risk, and recommended action for each candidate. The report also proved the active link risk for strategy docs, `github/`, `design-package/`, `handoffs/`, and `signal-lab/`, which is why broad archive movement is rejected for this pass.

Reported verification:

```text
python3 scripts/docs/check_links.py --baseline-file scripts/docs/link_baseline.json
files_checked=559
total_links=1801
missing_links=4
missing_by_classification:
  TRUE_MISSING_REFERENCE: 3
  MOVED_OR_ARCHIVED_CANDIDATE: 1
```

The four missing links are inherited B2A private-prompt debts, not ORCH-0761 blockers.

## Decision

Approved: write and dispatch an `$implementor` prompt for the narrow cleanup pass.

Not approved: direct orchestrator file moves, broad archive sweep, product-code edits, SQL execution, or cleanup of unrelated dirty work.

## Next Gate

Dispatch `$implementor` with:

`Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0761_ARTIFACT_CLEANUP_AND_ARCHIVE_PLAN.md`

Expected output:

`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0761_ARTIFACT_CLEANUP_AND_ARCHIVE_PLAN.md`
