# Implementation Report: ORCH-0750D Documentation System Lock-In

> Date: 2026-05-07  
> Status: implemented and verified, pending tester/orchestrator close  
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md`

## Plain-English Summary

The documentation cleanup is now locked into the repo instead of living only as an agreement. Mingla skills now point durable work to `Mingla_Artifacts/`, README names the new gates, the manifest records the system, and GitHub has a workflow that checks the documentation placement rules on future docs/artifact changes.

No product/runtime files were changed.

## Exact Files Changed

Codex process files:

- `.codex/skills/orchestrator-mingla/SKILL.md`
- `.codex/skills/orchestrator-mingla/references/artifact-system.md`
- `.codex/skills/forensic-mingla/SKILL.md`
- `.codex/skills/forensic-mingla/references/claude-forensics-audit.md`
- `.codex/skills/forensic-mingla/references/mingla-surface-map.md`
- `.codex/skills/implementor-mingla/SKILL.md`
- `.codex/skills/tester-mingla/SKILL.md`
- `.codex/skills/ui-ux-mingla/SKILL.md`

Approved Mingla Claude process files:

- `.claude/skills/mingla-orchestrator/SKILL.md`
- `.claude/skills/mingla-orchestrator/references/bootstrap-sequence.md`
- `.claude/skills/mingla-forensics/SKILL.md`
- `.claude/skills/mingla-implementor/SKILL.md`
- `.claude/skills/mingla-tester/SKILL.md`
- `.claude/skills/mingla-designer/SKILL.md`
- `.claude/skills/mingla-designer/references/screen-design-protocol.md`
- `.claude/skills/mingla-categorizer/SKILL.md`
- `.claude/skills/mingla-price-tiers/SKILL.md`
- `.claude/skills/mingla-product/SKILL.md`

Docs, scripts, and CI:

- `README.md`
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md`
- `Mingla_Artifacts/archive/README.md`
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- `scripts/docs/check_artifact_placement.py`
- `scripts/docs/check_readme_snapshot.py`
- `.github/workflows/docs-artifact-regression.yml`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md`

## Codex Skill Update Summary

- Orchestrator now treats current operational docs as `README.md`, `docs/`, and `Mingla_Artifacts/`, with historical evidence under `Mingla_Artifacts/archive/`.
- Forensics now searches current evidence through `Mingla_Artifacts/reports/`, `Mingla_Artifacts/specs/`, `AGENT_HANDOFFS.md`, the manifest, and archive indexes.
- Implementor reports now go to `Mingla_Artifacts/reports/IMPLEMENTATION_[NAME].md`.
- Tester reports now go to `Mingla_Artifacts/reports/TEST_REPORT_[NAME].md` or `QA_[NAME].md` only where historical naming is required.
- UI/UX lifecycle specs and audits now go to `Mingla_Artifacts/specs/` or `Mingla_Artifacts/reports/`.
- All affected skills now describe root `outputs/` and root `clade transfer/` as legacy, not current destinations.

## Claude Skill Update Summary

Only Mingla-specific Claude skills were changed. Generic Claude skills, `.claude/projects/**`, and `.claude/settings.local.json` were not touched.

- Added a short current documentation-system note to the approved Mingla Claude skills.
- Replaced stale current output paths such as `outputs/INVESTIGATION_*`, `outputs/SPEC_*`, `outputs/IMPLEMENTATION_*`, `outputs/QA_*`, and design-output destinations with `Mingla_Artifacts/reports/` or `Mingla_Artifacts/specs/`.
- Corrected the Mingla designer screen-design reference so screen design specs land in `Mingla_Artifacts/specs/`.

## README / Manifest / Archive Update Summary

- README now says ORCH-0750D locks the documentation system into skills and CI.
- README Last Synced and Verification sections now list:
  - `python3 scripts/docs/check_artifact_placement.py`
  - `python3 scripts/docs/check_readme_snapshot.py`
- The artifact manifest now records ORCH-0750D, both new scripts, the GitHub workflow, and the implementation report.
- The archive README now requires the placement and README snapshot checks for future documentation-system closes.
- The invariant registry now records:
  - `I-DOC-ARTIFACT-PLACEMENT-LOCKED`
  - `I-README-SNAPSHOT-NOT-MANIFEST`

## CI / Script Update Summary

Added `scripts/docs/check_artifact_placement.py`.

It checks:

- no tracked files under root `outputs/` or root `clade transfer/`;
- no tracked existing `dist/`, `build/`, or `web-build/` generated output;
- `.gitignore` keeps `.claude/`, `.codex/`, `outputs/`, and `Mingla_Artifacts/prompts/` ignored/private;
- deprecated queue files stay breadcrumbs to `AGENT_HANDOFFS.md` and `archive/old_trackers/`;
- archive README names the manifest and current archive sections;
- Mingla Codex/Claude skills do not reintroduce stale `outputs/*` current destinations.

Added `scripts/docs/check_readme_snapshot.py`.

It checks:

- README declares itself a snapshot;
- README points to the manifest, archive index, and link audit;
- README names the placement/readme regression gates;
- README Repo Map includes `Mingla_Artifacts/archive/` and does not list `outputs/` or root `clade transfer/` as active roots.

Added `.github/workflows/docs-artifact-regression.yml`.

It runs on docs/artifact/script/workflow/skill changes and executes:

- `python3 scripts/docs/check_links.py --format markdown --max-missing 1195`
- `python3 scripts/docs/check_artifact_placement.py`
- `python3 scripts/docs/check_readme_snapshot.py`

## Verification Commands And Results

Passed:

```bash
python3 -m py_compile scripts/docs/check_artifact_placement.py scripts/docs/check_readme_snapshot.py
```

Passed:

```bash
python3 scripts/docs/check_artifact_placement.py
```

Result summary:

- no tracked files under root `outputs/` or root `clade transfer/`;
- no tracked existing generated build artifacts;
- private prompt/tool roots remain ignored;
- deprecated queues remain breadcrumbs;
- Mingla skills avoid stale `outputs/*` current destinations.

Passed:

```bash
python3 scripts/docs/check_readme_snapshot.py
```

Result summary:

- README declares itself a snapshot;
- source-of-truth links point to manifest/archive authorities;
- docs lock-in commands are present;
- repo map avoids stale active docs roots.

Passed:

```bash
python3 scripts/docs/check_links.py --format markdown --max-missing 1195
```

Result summary:

- files checked: 454;
- total links: 2,460;
- missing links: 1,190;
- threshold: 1,195.

## Grep Proof

Passed:

```bash
rg -n "outputs/(INVESTIGATION|SPEC|IMPLEMENTATION|QA|DESIGN|COMPONENT|FLOW|DESIGN_SYSTEM)" .codex/skills .claude/skills/mingla-*
```

Result: no matches.

## What Was Intentionally Not Changed

- The remaining 1,190 broken markdown links were not fixed.
- No additional archive moves or deletes were performed.
- Private prompts were not published.
- Product/runtime code was not touched.
- Supabase, Stripe, mobile, business, admin, marketing, migrations, edge functions, and integrations were not changed.
- Generic Claude `ui-ux-pro-max` was not edited.

## Risks / Rollback

- The new GitHub workflow depends on the checked-in docs scripts and Python only; no network dependency beyond checkout/setup Python.
- The link gate intentionally preserves the current 1,195 ceiling. A later ratchet pass can lower it when link cleanup continues.
- `.codex/` and `.claude/` remain ignored locally per `.gitignore`; this implementation aligns the local Mingla process files, but only tracked files will run in GitHub unless those roots are intentionally versioned later.
- Rollback is process-only: revert the skill/doc/script/workflow changes from this ORCH if tester finds the lock-in too strict or too loose.

## Ready-To-Test Checklist

- Verify script behavior and workflow coverage.
- Verify Mingla Codex and approved Mingla Claude skills no longer mandate current `outputs/` destinations.
- Verify README remains a snapshot, not a second manifest.
- Verify manifest/archive/invariant entries accurately describe the new documentation system.
- Confirm no runtime/product files changed.
