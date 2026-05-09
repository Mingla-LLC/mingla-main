# Implementation Report: ORCH-0760 Mingla Roadmap System Scaffold

> Date: 2026-05-08
> Source investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0760_MINGLA_ROADMAP_PRODUCT_MARKETING_SYSTEM.md`
> Scope: create the roadmap operating-system scaffold and update PMM placement instructions before PMM population.

## Summary

Created `Mingla_Roadmap/` as a tracked product, marketing, GTM, launch, research, and sales enablement planning system.

This pass creates structure and placement contracts only. It does not populate real feature strategy, roadmap items, launch plans, research synthesis, or sales enablement content.

## Files Created

| Path | Purpose |
|---|---|
| `Mingla_Roadmap/README.md` | Roadmap front door, authority boundary, folder map, and update rules. |
| `Mingla_Roadmap/ROADMAP_MANIFEST.md` | Roadmap document classification, authority map, draft rules, and archive policy. |
| `Mingla_Roadmap/FEATURE_REGISTRY.md` | Canonical `FEAT-*` registry shell. |
| `Mingla_Roadmap/HIGH_LEVEL_ROADMAP.md` | Outcome-driven Now/Next/Later/Recently Launched roadmap shell. |
| `Mingla_Roadmap/CURRENT_BUILD.md` | Product-market mirror for active ORCH/build/test work. |
| `Mingla_Roadmap/NEXT_UP.md` | Sequenced upcoming work shell. |
| `Mingla_Roadmap/living/*.md` | Current product strategy, GTM/positioning, customer/ICP, and portfolio shells. |
| `Mingla_Roadmap/features/README.md` | Feature brief destination contract. |
| `Mingla_Roadmap/launch/README.md` | Launch asset destination contract. |
| `Mingla_Roadmap/research/README.md` | Research destination contract. |
| `Mingla_Roadmap/enablement/README.md` | Sales enablement destination contract. |
| `Mingla_Roadmap/source-summaries/README.md` | Source-summary rules for PMM synthesis. |
| `Mingla_Roadmap/templates/*.md` | Feature brief, launch plan, and research plan templates. |
| `Mingla_Roadmap/drafts/README.md` | Draft rules. |
| `Mingla_Roadmap/archive/README.md` | Superseded roadmap archive index. |
| `.codex/skills/pmm-mingla/references/roadmap-system.md` | PMM skill placement reference. |

## Files Updated

| Path | Change |
|---|---|
| `README.md` | Added `Mingla_Roadmap/README.md` as the product roadmap and PMM source of truth; added `Mingla_Roadmap/` to repo map. |
| `Mingla_Artifacts/ARTIFACT_MANIFEST.md` | Registered the roadmap root, first roadmap documents, roadmap manifest, archive, drafts, and the ORCH-0760 investigation report. |
| `scripts/docs/check_readme_snapshot.py` | Required the roadmap front door in README Source Of Truth and Repo Map. |
| `scripts/docs/check_artifact_placement.py` | Added a roadmap-system placement check for required roadmap paths and manifest terms. |
| `.codex/skills/pmm-mingla/SKILL.md` | Added Mingla Roadmap placement rules and reference loading instruction. |

## Authority Rules Established

- `Mingla_Roadmap/` owns product and market intent.
- `Mingla_Artifacts/` remains authoritative for ORCH lifecycle, investigations, specs, reports, QA, bugs, root causes, decisions, invariants, archives, and private prompts.
- PMM prompts stay under `Mingla_Artifacts/prompts/`, not under the roadmap folder.
- PMM durable output goes to semantic roadmap folders, not root `outputs/`.
- Drafts are not current truth.
- Superseded roadmap documents require `ROADMAP_MANIFEST.md` replacement links before archive moves.

## Verification

Passed:

```bash
python3 scripts/docs/check_artifact_placement.py
python3 scripts/docs/check_readme_snapshot.py
```

Inherited link debt remains:

```bash
python3 scripts/docs/check_links.py --baseline-file scripts/docs/link_baseline.json
```

Result:

```text
files_checked=543
total_links=1801
missing_links=4
missing_by_classification:
  TRUE_MISSING_REFERENCE: 3
  MOVED_OR_ARCHIVED_CANDIDATE: 1
top_sources:
  2 Mingla_Artifacts/prompts/B2A_PATH_C_V3_SUB_B_COMPLETION.md
  2 Mingla_Artifacts/prompts/B2A_PATH_C_V3_SUB_C_DISPATCH.md
```

The reported missing links are in existing prompt files, not the new roadmap scaffold.

## Not Done

- Did not populate real feature rows.
- Did not summarize old strategy docs into `source-summaries/`.
- Did not move or archive existing `Mingla_Artifacts/` strategy docs.
- Did not move `Mingla_Artifacts/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql`.
- Did not change product code, Supabase, GitHub issues, or app surfaces.

## Next Recommended Dispatch

Use `$pmm-mingla` to populate the first roadmap pass:

1. Create source summaries for the approved strategy/product/GTM docs.
2. Populate `FEATURE_REGISTRY.md`.
3. Populate `HIGH_LEVEL_ROADMAP.md`, `CURRENT_BUILD.md`, and `NEXT_UP.md`.
4. Fill the living docs from evidence-backed summaries.
5. Leave stale source artifacts in place until a later orchestrator cleanup/archive spec.
