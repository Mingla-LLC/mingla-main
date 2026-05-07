# IMPLEMENTATION ORCH-0750E - Documentation Link Debt Burn-Down

**Date:** 2026-05-07
**Status:** implemented and verified
**Spec:** `Mingla_Artifacts/reports/SPEC_ORCH-0750E_DOCUMENTATION_LINK_DEBT_BURNDOWN.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0750E_DOCUMENTATION_LINK_DEBT_BURNDOWN.md`

## Summary

Reduced Mingla's durable documentation missing-link count from **1,195 to 0** in a clean worktree based on `origin/Seth` commit `733a9cf4`.

This was documentation-only work. No product/runtime files, Supabase functions, migrations, package files, app code, or skill files were changed.

## Preflight

Clean worktree created from `origin/Seth`:

```text
HEAD: 733a9cf4 docs: lock artifact documentation system
git status --short: clean before ORCH-0750E artifacts were copied in
git merge-base --is-ancestor 733a9cf4 HEAD: pass
```

Starting link audit:

| Metric | Count |
|---|---:|
| Files checked | 392 |
| Total links | 2,377 |
| Missing links | 1,195 |

Starting classes:

| Class | Count |
|---|---:|
| `MOVED_OR_ARCHIVED_CANDIDATE` | 596 |
| `PROMPT_PRIVATE_OR_IGNORED` | 458 |
| `TRUE_MISSING_REFERENCE` | 123 |
| `HISTORICAL_SOURCE_MISSING` | 14 |
| `GENERATED_OR_IGNORED_TARGET` | 4 |

## Phase Results

| Phase | Selected | Replacements | Files Changed | Missing Before | Missing After |
|---|---:|---:|---:|---:|---:|
| Phase 1 - generated/ignored targets | 4 | 4 | 4 | 1,195 | 1,191 |
| Phase 2 - repo-root path normalization | 409 | 409 | 18 | 1,191 | 782 |
| Phase 3 - `Mingla_Artifacts/` self-links | 149 | 149 | 23 | 782 | 633 |
| Phase 4 - other moved/archive candidates | 38 | 38 | 10 | 633 | 595 |
| Phase 5 - true missing references | 123 | 123 | 6 | 595 | 472 |
| Phase 6 - private prompt references | 458 | 458 | 145 | 472 | 14 |
| Phase 7 - historical source missing | 14 | 14 | 8 | 14 | 0 |

## Class Deltas

### Phase 1

Removed all `GENERATED_OR_IGNORED_TARGET` links.

Before:

```text
GENERATED_OR_IGNORED_TARGET: 4
HISTORICAL_SOURCE_MISSING: 14
MOVED_OR_ARCHIVED_CANDIDATE: 596
PROMPT_PRIVATE_OR_IGNORED: 458
TRUE_MISSING_REFERENCE: 123
```

After:

```text
HISTORICAL_SOURCE_MISSING: 14
MOVED_OR_ARCHIVED_CANDIDATE: 596
PROMPT_PRIVATE_OR_IGNORED: 458
TRUE_MISSING_REFERENCE: 123
```

### Phase 2

Normalized 409 repo-root paths from artifact files.

After:

```text
HISTORICAL_SOURCE_MISSING: 14
MOVED_OR_ARCHIVED_CANDIDATE: 187
PROMPT_PRIVATE_OR_IGNORED: 458
TRUE_MISSING_REFERENCE: 123
```

### Phase 3

Normalized 149 `Mingla_Artifacts/` self-links.

After:

```text
HISTORICAL_SOURCE_MISSING: 14
MOVED_OR_ARCHIVED_CANDIDATE: 38
PROMPT_PRIVATE_OR_IGNORED: 458
TRUE_MISSING_REFERENCE: 123
```

### Phase 4

Resolved the remaining 38 moved/archive candidates.

After:

```text
HISTORICAL_SOURCE_MISSING: 14
PROMPT_PRIVATE_OR_IGNORED: 458
TRUE_MISSING_REFERENCE: 123
```

### Phase 5

Converted 123 true-missing links into plain-text missing-reference citations or real links where basename resolution proved a target.

After:

```text
HISTORICAL_SOURCE_MISSING: 14
PROMPT_PRIVATE_OR_IGNORED: 458
```

### Phase 6

Converted 458 private prompt markdown links into plain-text `PRIVATE_PROMPT_NOT_VERSIONED` markers. Durable report/spec/test links already present in the same historical entries were preserved.

After:

```text
HISTORICAL_SOURCE_MISSING: 14
```

### Phase 7

Converted 14 historical local-machine/source links into plain-text historical-source citations or archive-safe links.

After:

```text
missing link classes: none
```

## Baseline

`scripts/docs/link_baseline.json` was ratcheted down to zero:

```json
{
  "max_missing": 0,
  "updated": "2026-05-07",
  "source": "ORCH-0750E zero-clean link burn-down",
  "policy": "Documentation links must remain zero-missing. Any increase requires an artifacted orchestrator decision."
}
```

The workflow remains pointed at the baseline file, as required by the spec.

## Files Changed

Changed files are documentation/artifact files only:

- top-level Mingla ledgers: `AGENT_HANDOFFS.md`, `MASTER_BUG_LIST.md`, `WORLD_MAP.md`, `OPEN_INVESTIGATIONS.md`, `PRIORITY_BOARD.md`, `INVARIANT_REGISTRY.md`, `ROOT_CAUSE_REGISTER.md`
- historical archive handoffs under `Mingla_Artifacts/archive/handoffs_legacy/`
- historical/current reports and specs under `Mingla_Artifacts/reports/` and `Mingla_Artifacts/specs/`
- `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md`
- `scripts/docs/link_baseline.json`

No app runtime files were changed.

## Verification

Strict zero link gate:

```text
python3 scripts/docs/check_links.py --format markdown --max-missing 0
PASS
Files checked: 394
Total links: 1,778
Missing links: 0
```

Baseline gate:

```text
python3 scripts/docs/check_links.py --format markdown --baseline-file scripts/docs/link_baseline.json
PASS
```

Artifact placement gate:

```text
python3 scripts/docs/check_artifact_placement.py
PASS
```

README snapshot gate:

```text
python3 scripts/docs/check_readme_snapshot.py
PASS
```

Private/generated-target spot check:

```text
No local markdown links found targeting:
- node_modules
- .expo
- .vercel
- root outputs/
- root clade transfer/
- private prompt paths
```

Scope check:

```text
git diff --name-only | rg -v '^(Mingla_Artifacts/|README\\.md$|docs/|app-mobile/README\\.md$|mingla-admin/README\\.md$|mingla-business/README\\.md$|scripts/docs/link_baseline\\.json$|\\.github/workflows/docs-artifact-regression\\.yml$)'
PASS: no out-of-scope files
```

## Deviations

None from the implementation scope.

Operational note: private prompt links were converted to plain text with `PRIVATE_PROMPT_NOT_VERSIONED` markers. This preserves provenance without making ignored prompt storage a durable evidence dependency.

## Handoff To Tester

Recommended tester focus:

1. Re-run strict zero and baseline link gates.
2. Sample the largest changed ledgers to ensure prose still reads as historical evidence.
3. Verify private prompt paths are plain text only, not markdown links.
4. Verify no product/runtime files changed.

## Final Status

implemented and verified
