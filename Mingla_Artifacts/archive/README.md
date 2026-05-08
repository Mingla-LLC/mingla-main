# Mingla Archive

This directory holds historical evidence that should remain findable but should not be used as current operating instructions.

Use `Mingla_Artifacts/ARTIFACT_MANIFEST.md` as the canonical map. README stays a front-door snapshot; this archive is the preservation layer behind it.

## Sections

| Section | Purpose |
|---|---|
| `outputs_legacy/` | Historical B2/B2a Path C transfer material preserved from the former ignored `outputs/` root. |
| `handoffs_legacy/` | Historical transfer handoffs moved out of the root-level `clade transfer/` folder. |
| `superseded_reports/` | Historical reports moved out of active-looking roots after their current authority was superseded or narrowed. |
| `old_trackers/` | Deprecated queue files preserved as evidence after top-level breadcrumbs replaced the old active-looking docs. |

Executable SQL evidence and production-adjacent runbooks belong under `Mingla_Artifacts/backups/`, not this archive root. Treat backup material as preservation/runbook evidence, not active instructions unless a current ORCH explicitly authorizes use.

## Rules

- Archive files are evidence, not current truth.
- Current program state lives in the top-level Mingla artifact ledgers and dashboards.
- Private prompts remain private unless a later ORCH phase explicitly versions them.
- Future archive moves must update the manifest and pass the link checker.
- Future documentation-system closes must also pass `python3 scripts/docs/check_artifact_placement.py` and `python3 scripts/docs/check_readme_snapshot.py`.
