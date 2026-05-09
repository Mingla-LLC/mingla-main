# SPEC ORCH-0750E - Documentation Link Debt Burn-Down

**Date:** 2026-05-07  
**Mode:** forensics SPEC  
**Status:** SPEC READY  
**Primary investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0750E_DOCUMENTATION_LINK_DEBT_BURNDOWN.md`  
**Implementation role:** `$implementor`  
**Verification role:** `$tester`

## Plain-English Impact

Mingla's documentation system is now organized, archived, and CI-protected, but it is not yet fully clean. The next work is a controlled burn-down from the current missing-link baseline to zero, without deleting history, hiding private prompt gaps, or pretending old artifacts are current truth.

Success means we can eventually say: every durable local documentation link resolves, private prompts are not treated as public evidence, archive material is findable through the manifest, and CI prevents the mess from returning.

## Current Measured Debt

Use the clean PR branch truth from `origin/Seth` commit `733a9cf4`.

| Metric | Count |
|---|---:|
| Files checked | 392 |
| Total markdown links | 2,377 |
| Missing local links | 1,195 |
| Baseline file | `scripts/docs/link_baseline.json` |
| Baseline ceiling | 1,195 |

Five current/active ledger files account for 681 missing links:

| Source | Missing |
|---|---:|
| `Mingla_Artifacts/AGENT_HANDOFFS.md` | 225 |
| `Mingla_Artifacts/MASTER_BUG_LIST.md` | 199 |
| `Mingla_Artifacts/WORLD_MAP.md` | 172 |
| `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` | 57 |
| `Mingla_Artifacts/PRIORITY_BOARD.md` | 28 |

Debt by class:

| Class | Count |
|---|---:|
| `MOVED_OR_ARCHIVED_CANDIDATE` | 596 |
| `PROMPT_PRIVATE_OR_IGNORED` | 458 |
| `TRUE_MISSING_REFERENCE` | 123 |
| `HISTORICAL_SOURCE_MISSING` | 14 |
| `GENERATED_OR_IGNORED_TARGET` | 4 |

## Scope

Implement a phase-by-phase documentation link burn-down.

Allowed files:

- `Mingla_Artifacts/**/*.md`
- `README.md` only if a phase proves README text/commands must be updated to remain accurate
- `docs/**/*.md`
- app-local README files only if they contain affected links
- `scripts/docs/link_baseline.json`
- `.github/workflows/docs-artifact-regression.yml` only in the final zero-clean lock phase
- `scripts/docs/check_links.py`, `scripts/docs/check_artifact_placement.py`, and `scripts/docs/check_readme_snapshot.py` only if a checker bug blocks the burn-down and the implementation report proves why

## Non-Goals

Do not change:

- product code under `app-mobile/`, `mingla-business/`, `mingla-admin/`, or `mingla-marketing/`
- Supabase functions, migrations, RLS, schemas, or deploy config
- package dependencies
- runtime behavior
- `.claude/skills/` or `.codex/skills/` unless a stale documentation-system instruction is proven and separately called out

Do not delete artifacts unless the manifest already marks them as delete candidates and the link audit proves deletion is safe.

## Invariants

Preserve:

- `I-DOC-ARTIFACT-PLACEMENT-LOCKED`: current artifacts live under `Mingla_Artifacts/`; root `outputs/` and root `clade transfer/` are not current destinations.
- `I-README-SNAPSHOT-NOT-MANIFEST`: README is a front-door snapshot, not a duplicated manifest.

Establish:

- `I-DOC-LINK-BASELINE-RATCHETS-DOWN`: `scripts/docs/link_baseline.json` may only move downward unless a documented orchestrator decision explicitly accepts a temporary increase.
- `I-PRIVATE-PROMPTS-ARE-NOT-EVIDENCE`: private/ignored prompts may be named as plain text but must not be durable markdown evidence links unless versioned.
- `I-GENERATED-TARGETS-ARE-NOT-EVIDENCE`: docs must not cite generated, ignored, local-only, or dependency-cache paths as durable evidence.

## Implementation Contract

### Phase 0 - Preflight

1. Start from a clean branch state synced to `origin/Seth` at or after `733a9cf4`.
2. Confirm the branch baseline:

```bash
python3 scripts/docs/check_links.py --format markdown --baseline-file scripts/docs/link_baseline.json
python3 scripts/docs/check_artifact_placement.py
python3 scripts/docs/check_readme_snapshot.py
```

3. Record:
   - missing link count
   - counts by classification
   - top 10 sources
   - current `scripts/docs/link_baseline.json` value

If the starting baseline is not 1,195 because newer accepted work already reduced it, continue from the lower observed value. If it is higher, stop and return to orchestrator for rebase/sync review.

### Phase 1 - Generated/Ignored Targets

Target: `GENERATED_OR_IGNORED_TARGET`.

Starting evidence: 4 links, all pointing at `app-mobile/node_modules/expo-router/build/ExpoRoot.js#L77-L83`.

Implementor must:

- remove markdown links into `node_modules`, generated caches, ignored roots, or dependency build outputs;
- replace them with plain text or source-level citations only when the surrounding sentence still needs evidence;
- not replace generated links with another generated target.

Expected exit: missing count <= 1,191.

### Phase 2 - Repo-Root Path Normalization

Target: `MOVED_OR_ARCHIVED_CANDIDATE` links whose raw target begins with:

- `app-mobile/`
- `supabase/`
- `mingla-business/`
- `mingla-admin/`
- `scripts/`
- `docs/`

Starting evidence: 409 links.

Implementor must:

- fix links from artifact files so they resolve from the Markdown source file location;
- for links inside `Mingla_Artifacts/`, use repo-relative traversal such as `../app-mobile/...`, `../supabase/...`, `../mingla-business/...`, `../mingla-admin/...`, `../scripts/...`, or `../docs/...`;
- preserve anchors where the target file exists;
- if an anchor is stale but the file exists, keep the file link and remove or update the anchor only when locally verifiable;
- not rewrite code paths that are intentionally plain text and not markdown links.

Expected exit: missing count <= 782.

### Phase 3 - `Mingla_Artifacts/` Self-Link Normalization

Target: `MOVED_OR_ARCHIVED_CANDIDATE` links from inside `Mingla_Artifacts/` that incorrectly include `Mingla_Artifacts/` in the raw target.

Starting evidence: 149 links.

Implementor must:

- convert self-links to correct relative paths from the source file;
- use the manifest or archive README when direct links would imply a historical artifact is current authority;
- preserve direct links for current reports/specs/ledgers when the file exists and the source is allowed to cite it.

Expected exit: missing count <= 633.

### Phase 4 - Other Moved/Archive Candidates

Target: remaining `MOVED_OR_ARCHIVED_CANDIDATE` links.

Starting evidence: 38 links.

Implementor must:

- resolve `../` stragglers, renamed artifacts, and archive-relative links;
- consult `Mingla_Artifacts/ARTIFACT_MANIFEST.md` before changing archive references;
- route historical evidence through `Mingla_Artifacts/archive/README.md` or manifest rows when direct links would create source-of-truth confusion.

Expected exit: missing count <= 595.

### Phase 5 - True Missing References

Target: `TRUE_MISSING_REFERENCE`.

Starting evidence: 123 links concentrated in:

- `Mingla_Artifacts/MASTER_BUG_LIST.md`
- `Mingla_Artifacts/WORLD_MAP.md`
- `Mingla_Artifacts/AGENT_HANDOFFS.md`
- `Mingla_Artifacts/OPEN_INVESTIGATIONS.md`
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md`

Implementor must:

- search for each target by basename and ORCH/business-cycle identifier before declaring it unrecoverable;
- if the artifact exists under a different path, link to the real path;
- if no durable artifact exists, replace the markdown link with a plain-text citation or remove the link while preserving the historical note;
- not create placeholder files solely to satisfy the checker.

Expected exit: missing count <= 472.

### Phase 6 - Private Prompt References

Target: `PROMPT_PRIVATE_OR_IGNORED`.

Starting evidence: 458 links.

Implementor must:

- search for durable returned artifacts tied to the prompt:
  - investigation reports
  - specs
  - implementation reports
  - tester reports
  - runtime QA reports
  - decision log entries
- replace private prompt links with those durable artifact links where possible;
- when no durable artifact exists, convert the markdown link to plain text and mark it `PRIVATE_PROMPT_NOT_VERSIONED`;
- never make README depend on private prompt paths;
- not move or version private prompt files in this phase unless orchestrator separately approves.

Expected exit: missing count <= 14.

### Phase 7 - Historical Source Missing

Target: `HISTORICAL_SOURCE_MISSING`.

Starting evidence: 14 links.

Implementor must:

- preserve historical provenance;
- replace absent machine-local paths, Claude memory paths, and non-repo historical source paths with plain-text citations;
- use archive or manifest references when a preserved repo artifact exists;
- avoid fabricating source files for old local-memory evidence.

Expected exit: missing count = 0.

### Phase 8 - Zero-Clean Lock

Once zero missing links is proven:

1. Set `scripts/docs/link_baseline.json` to:

```json
{
  "max_missing": 0,
  "updated": "2026-05-07",
  "source": "ORCH-0750E zero-clean link burn-down",
  "policy": "Documentation links must remain zero-missing. Any increase requires an artifacted orchestrator decision."
}
```

2. Keep the workflow pointed at the baseline file rather than hardcoding `--max-missing 0`.

Preferred reason: the baseline file remains the single visible policy object and can carry provenance/policy text, while CI still enforces zero.

3. Final gate must also run strict zero directly:

```bash
python3 scripts/docs/check_links.py --format markdown --max-missing 0
```

## Baseline Ratchet Rule

After every phase:

1. Run the link checker.
2. Record old missing count and new missing count.
3. Lower `scripts/docs/link_baseline.json` to the new observed count.
4. Never raise the baseline.

If the observed count does not meet the phase target, implementor must document:

- class deltas;
- top remaining sources;
- why the expected count differed;
- whether the phase is complete, partially complete, or blocked.

Classification changes are acceptable only if the total missing count still moves downward or the implementation report proves why the phase must be reworked.

## Verification Commands

Every phase must run:

```bash
python3 scripts/docs/check_links.py --format markdown --baseline-file scripts/docs/link_baseline.json
python3 scripts/docs/check_artifact_placement.py
python3 scripts/docs/check_readme_snapshot.py
```

If any docs script changes, also run:

```bash
python3 -m py_compile scripts/docs/check_links.py scripts/docs/check_artifact_placement.py scripts/docs/check_readme_snapshot.py
```

Final zero-clean verification must run:

```bash
python3 scripts/docs/check_links.py --format markdown --max-missing 0
python3 scripts/docs/check_links.py --format markdown --baseline-file scripts/docs/link_baseline.json
python3 scripts/docs/check_artifact_placement.py
python3 scripts/docs/check_readme_snapshot.py
```

## Implementation Report Requirements

Implementor must write:

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750E_DOCUMENTATION_LINK_DEBT_BURNDOWN.md`

The report must include:

- phase-by-phase old/new missing counts;
- class deltas after each phase;
- files changed by phase;
- baseline values before and after;
- any unrecoverable references and how they were represented;
- proof no generated/ignored/private prompt links remain as durable markdown evidence;
- exact verification command output summaries;
- whether final state reached zero.

## Tester Acceptance Criteria

Tester must independently verify:

1. `python3 scripts/docs/check_links.py --format markdown --max-missing 0` passes.
2. `python3 scripts/docs/check_links.py --format markdown --baseline-file scripts/docs/link_baseline.json` passes with `max_missing = 0`.
3. Artifact placement check passes.
4. README snapshot check passes.
5. No markdown links target:
   - `node_modules`
   - `.expo`
   - `.vercel`
   - `dist`
   - root `outputs/`
   - root `clade transfer/`
   - private prompt paths
6. Private prompt names, where retained, are plain text and marked `PRIVATE_PROMPT_NOT_VERSIONED`.
7. Historical archive links do not imply archive-only material is current authority.
8. No product/runtime files were changed.

## Rollback And Containment

This work is documentation-only. If a phase causes confusion or accidental scope expansion:

1. Revert only that phase's documentation edits.
2. Restore `scripts/docs/link_baseline.json` to the last lower verified value.
3. Re-run the three docs gates.
4. Return to orchestrator with the blocked class/source list.

Do not roll back unrelated user work or product code.

## Final Zero-Clean Definition

ORCH-0750E is complete only when all are true:

- missing links = 0;
- `scripts/docs/link_baseline.json` has `max_missing: 0`;
- docs artifact regression workflow enforces the zero baseline;
- artifact placement check passes;
- README snapshot check passes;
- private prompts are not durable markdown evidence;
- generated/ignored/local-only roots are not durable markdown evidence;
- implementation and tester reports are saved under `Mingla_Artifacts/reports/`;
- orchestrator reviews and closes the item.

## Status

SPEC READY.
