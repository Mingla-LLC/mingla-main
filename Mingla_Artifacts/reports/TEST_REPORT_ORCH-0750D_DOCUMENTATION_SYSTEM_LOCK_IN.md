# Test Report: ORCH-0750D Documentation System Lock-In

> Date: 2026-05-07  
> Verdict: CONDITIONAL PASS  
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md`  
> Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md`

## Verdict

CONDITIONAL PASS.

The ORCH-0750D documentation lock-in is implemented correctly for the current workspace and passes the required local gates. README remains a snapshot, the manifest/archive/invariant docs record the new system, the new scripts pass, the GitHub workflow is present, and current Mingla Codex/Claude skill files no longer mandate stale `outputs/*` current destinations.

Condition for orchestrator close: explicitly accept or resolve the CI enforcement limitation in finding P2-1. Because `.codex/` and `.claude/` are ignored/private roots, GitHub can only enforce skill regressions if those skill files are present in the checkout. The local checker scans them; the GitHub workflow path list includes them; but the placement script does not fail when no skill files are present.

## Findings

### P2-1 - GitHub skill-regression enforcement depends on ignored skill roots being present

**Severity:** P2 MEDIUM  
**Evidence:** `scripts/docs/check_artifact_placement.py` defines skill globs for `.codex/skills/*-mingla/**` and `.claude/skills/mingla-*/**`, but `skill_files()` can return an empty list without failing. `.gitignore` intentionally ignores `.codex/` and `.claude/`. The workflow includes `.codex/skills/**` and `.claude/skills/mingla-*/**` paths, but GitHub cannot enforce files that are not versioned/present in checkout.  
**Impact:** Local agents are aligned, but GitHub may not catch future stale skill regressions unless the skills are force-versioned, mirrored into tracked docs, or the checker grows an explicit minimum expected skill-file gate for CI.  
**Close condition:** Orchestrator must either accept this as a documented limitation because tool skills are local/private, or dispatch rework to make CI fail when expected skill roots are absent.

### P4-1 - Historical `outputs/` references remain in old artifact text

**Severity:** P4 NOTE  
**Evidence:** `Mingla_Artifacts/INVARIANT_REGISTRY.md` still contains old historical source citations such as B2a references to `outputs/...`. These are not current Mingla skill instructions and do not match the forbidden current-destination grep.  
**Impact:** Non-blocking. The ORCH-0750D scope was skill placement, README snapshot, manifest/archive lock-in, and regression gates, not total historical link cleanup.

## Commands Run

Passed:

```bash
python3 -m py_compile scripts/docs/check_artifact_placement.py scripts/docs/check_readme_snapshot.py
```

Passed:

```bash
python3 scripts/docs/check_artifact_placement.py
```

Output summary:

- no tracked files under root `outputs/` or `clade transfer/`;
- no tracked existing `dist/`, `build/`, or `web-build` artifacts;
- private prompt/tool roots remain ignored;
- deprecated queues remain breadcrumbs;
- Mingla skills avoid stale `outputs/*` current destinations.

Passed:

```bash
python3 scripts/docs/check_readme_snapshot.py
```

Output summary:

- README declares itself a snapshot;
- source-of-truth links point to manifest/archive authorities;
- docs lock-in commands are present;
- repo map avoids stale active docs roots.

Passed:

```bash
python3 scripts/docs/check_links.py --format markdown --max-missing 1195
```

Output summary:

- files checked: 456;
- total links: 2,460;
- missing links: 1,190;
- threshold: 1,195.

Passed by no matches:

```bash
rg -n "outputs/(INVESTIGATION|SPEC|IMPLEMENTATION|QA|DESIGN|COMPONENT|FLOW|DESIGN_SYSTEM)" .codex/skills .claude/skills/mingla-*
```

Additional probes:

- `git ls-files -- outputs` returned no tracked root `outputs/` files.
- `git ls-files -- 'clade transfer'` returned no tracked root `clade transfer/` files.
- Ignored local `outputs/` residue exists, and the placement checker correctly does not fail on it.
- Deleted ORCH-0750C `mingla-admin/dist` assets are absent from the worktree, so the generated-output gate does not false-fail on deleted tracked files before commit.
- Regex sample probe confirmed `outputs/SPEC_BAD.md` and `outputs/IMPLEMENTATION_BAD.md` match, while `Root outputs/ is legacy only` and `Mingla_Artifacts/archive/outputs_legacy/SPEC_OLD.md` do not.

## Success-Criteria Matrix

| SC | Requirement | Result | Evidence |
|---|---|---|---|
| SC-1 | Mingla Codex skills direct durable reports/specs/test reports/design specs to `Mingla_Artifacts/`, not `outputs/`. | PASS | Skill grep shows `Mingla_Artifacts/reports/` and `Mingla_Artifacts/specs/`; forbidden current-destination grep has no matches. |
| SC-2 | Mingla Codex skills describe historical material through archive/manifest, not root `outputs/` or `clade transfer/`. | PASS | Codex forensic/orchestrator references label root `outputs/` and root `clade transfer/` as legacy and point to `Mingla_Artifacts/archive/` / `ARTIFACT_MANIFEST.md`. |
| SC-3 | Approved Mingla Claude skills aligned without touching generic Claude skills or unrelated product behavior. | PASS with P2 caveat | Approved Mingla skills now use `Mingla_Artifacts/`; forbidden current-destination grep is clean. No ORCH-0750D marker found in generic `ui-ux-pro-max`. `.claude/projects` contains old historical refs but was forbidden scope and not part of this alignment. |
| SC-4 | README names lock-in commands and links archive only through manifest/archive index. | PASS | README contains `check_artifact_placement.py`, `check_readme_snapshot.py`, manifest link, archive README link, and snapshot wording. |
| SC-5 | Manifest records ORCH-0750D and new CI/script authority. | PASS | Manifest has ORCH-0750D spec/report rows plus script/workflow rows and ORCH-0750D deferral section. |
| SC-6 | Docs regression workflow runs on PR/push for docs/skills/scripts/workflows/artifacts. | CONDITIONAL PASS | Workflow path filters include README, docs, `Mingla_Artifacts/**`, `scripts/docs/**`, workflow file, `.codex/skills/**`, and `.claude/skills/mingla-*/**`; P2-1 notes ignored skill roots weaken GitHub enforcement if absent. |
| SC-7 | Local verification passes. | PASS | py_compile, placement check, README snapshot check, link baseline, and grep proof passed. |
| SC-8 | Placement checker fails on tracked legacy roots, tracked generated output, or stale current `outputs/*` destinations. | PASS with P2 caveat | Script checks `git ls-files` for root legacy paths, existing tracked generated output, and forbidden skill output regex. It does not require skill roots to exist in CI, covered by P2-1. |
| SC-9 | Ignored local `outputs/` files do not fail by themselves. | PASS | Local `outputs/` files exist, `git ls-files -- outputs` is empty, and placement check passes. |

## Files Inspected

Prompt/spec/report:

- `Mingla_Artifacts/prompts/TESTER_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md`

Scripts/workflow:

- `scripts/docs/check_artifact_placement.py`
- `scripts/docs/check_readme_snapshot.py`
- `.github/workflows/docs-artifact-regression.yml`

Docs/artifacts:

- `README.md`
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md`
- `Mingla_Artifacts/archive/README.md`
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- `.gitignore`

Skills:

- `.codex/skills/orchestrator-mingla/**`
- `.codex/skills/forensic-mingla/**`
- `.codex/skills/implementor-mingla/SKILL.md`
- `.codex/skills/tester-mingla/SKILL.md`
- `.codex/skills/ui-ux-mingla/SKILL.md`
- `.claude/skills/mingla-orchestrator/**`
- `.claude/skills/mingla-forensics/SKILL.md`
- `.claude/skills/mingla-implementor/SKILL.md`
- `.claude/skills/mingla-tester/SKILL.md`
- `.claude/skills/mingla-designer/**`
- `.claude/skills/mingla-categorizer/SKILL.md`
- `.claude/skills/mingla-price-tiers/SKILL.md`
- `.claude/skills/mingla-product/SKILL.md`
- forbidden-scope spot check: `.claude/skills/ui-ux-pro-max`, `.claude/projects`, `.claude/settings.local.json`

## Workflow Review

`.github/workflows/docs-artifact-regression.yml` is minimal and appropriate:

- Uses `actions/checkout@v4`.
- Uses `actions/setup-python@v5`.
- Runs only standard-library Python scripts.
- Preserves the accepted link threshold with `--max-missing 1195`.
- Triggers on README, docs, artifacts, docs scripts, workflow file, Codex skills, and Mingla Claude skills.

Residual risk is P2-1: ignored/private skill roots may not be present in GitHub checkout unless deliberately versioned.

## Script Strength / False-Positive Review

`check_artifact_placement.py` is correctly scoped:

- It checks tracked root `outputs/` and root `clade transfer/`.
- It avoids false-failing on ignored local `outputs/` residue.
- It avoids false-failing on deleted generated assets that are absent from the worktree.
- It scans Codex skill files/references and Mingla Claude skill files/references.
- It catches the forbidden current destination families through a simple, readable regex.

Weakness:

- It does not fail if the expected skill roots are absent, which matters for CI if `.codex/` and `.claude/` remain ignored/private.

`check_readme_snapshot.py` is correctly scoped:

- It checks the snapshot declaration.
- It checks manifest/archive/link-audit/gate command references.
- It checks the Source Of Truth and Repo Map sections.
- It prevents `outputs/` and root `clade transfer/` from becoming active Repo Map roots.

## Scope Isolation Review

ORCH-0750D implementation report lists only process/docs/CI files. The dirty worktree still contains unrelated product/runtime changes under `app-mobile/`, `supabase/functions/`, and deleted `mingla-admin/dist` assets from earlier ORCH work. I did not attribute those to ORCH-0750D because they are outside the implementation report's file list and predate this tester pass.

No product/runtime QA was run because ORCH-0750D is docs/process/CI only.

## Residual Risks

- CI skill enforcement limitation from P2-1 must be accepted or fixed before final orchestrator close.
- Link debt remains at 1,190 missing links by design; this is within the accepted 1,195 ceiling and not an ORCH-0750D failure.
- Historical artifact text can still cite old `outputs/` sources; this is acceptable when historical, but future cleanup passes should route those citations through archive/manifest paths.

## Close Recommendation

Recommended close path:

1. Orchestrator reviews this conditional pass.
2. Orchestrator either accepts P2-1 as a documented limitation of ignored/private skill roots or dispatches a small rework to make CI fail when expected skill roots are absent.
3. If accepted, close ORCH-0750D with DEC entry noting that GitHub gates protect tracked docs/scripts/workflows and any versioned skill roots, while local ignored skills remain protected by the local placement checker.
