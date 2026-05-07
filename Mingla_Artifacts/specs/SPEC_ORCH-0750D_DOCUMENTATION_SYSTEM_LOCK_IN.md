# Spec: Documentation System Lock-In (ORCH-0750D)

> Date: 2026-05-07  
> Investigation: ORCH-0750A/B/C evidence trail plus ORCH-0750D targeted spec inspection  
> Root cause: documentation placement rules are not yet encoded in skills or CI  
> Status: ready for implementation

## 1. Layman Summary

Mingla's documentation cleanup now needs a lock on the door. ORCH-0750C gave historical material one archive home, but several agent instructions still point at old places like `outputs/`, and GitHub does not yet stop a PR from putting stale docs back where they do not belong.

This spec updates the agent rulebooks and adds regression checks so future work lands in the right artifact folder, README stays a snapshot, the manifest remains the map, private prompts stay private, and old folders do not quietly become active again.

## 2. User Story

As the Mingla operator, I want every Codex/Claude agent and every PR gate to know the current documentation system, so that Mingla's README, artifacts, archive, handoffs, specs, reports, and close records stay findable and do not drift back into stale chaos.

## 3. Current Documentation System Contract

Evidence-backed current contract:

- `README.md` says README is a snapshot, not the whole truth system, and points readers to `Mingla_Artifacts/ARTIFACT_MANIFEST.md`, `WORLD_MAP.md`, `PRODUCT_SNAPSHOT.md`, `PRIORITY_BOARD.md`, `DECISION_LOG.md`, `INVARIANT_REGISTRY.md`, `ORCH-0750A_LINK_AUDIT.md`, and `Mingla_Artifacts/archive/README.md`.
- `README.md` records the link baseline gate as `python3 scripts/docs/check_links.py --max-missing 1195`.
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md` defines the status taxonomy, current authority map, README surface map, and archive policy.
- `Mingla_Artifacts/archive/README.md` says archive files are evidence, not current truth, and future archive moves must update the manifest and pass the link checker.
- `Mingla_Artifacts/SPEC_QUEUE.md`, `TEST_QUEUE.md`, and `RETEST_LEDGER.md` are breadcrumbs pointing to `AGENT_HANDOFFS.md` and archived originals under `Mingla_Artifacts/archive/old_trackers/`.
- `.gitignore` ignores `.claude/`, `.codex/`, `outputs/`, and `Mingla_Artifacts/prompts/`; prompt files are private/local operational state unless explicitly versioned by a later ORCH.

Current stale contract still present:

- `.codex/skills/forensic-mingla/SKILL.md` still instructs historical context search across `outputs/` and `clade transfer/`, and references `outputs/PRODUCT_DOCUMENT.md` and `outputs/LAUNCH_READINESS_TRACKER.md`.
- `.codex/skills/forensic-mingla/references/mingla-surface-map.md` still lists `outputs/PRODUCT_DOCUMENT.md`, `outputs/LAUNCH_READINESS_TRACKER.md`, `outputs/INVESTIGATION_*.md`, and `outputs/SPEC_*.md`.
- `.codex/skills/implementor-mingla/SKILL.md` still allows durable implementation reports at `outputs/IMPLEMENTATION_[NAME]_REPORT.md`.
- `.codex/skills/tester-mingla/SKILL.md` still allows durable QA reports at `outputs/QA_[SCOPE]_REPORT.md`.
- `.codex/skills/orchestrator-mingla/SKILL.md` still lists operational docs as including `outputs/` and handoffs in root `clade transfer/`.
- Claude Mingla skills contain stronger stale output rules: `mingla-forensics` mandates `outputs/INVESTIGATION_*` and `outputs/SPEC_*`; `mingla-implementor` mandates `outputs/IMPLEMENTATION_*`; `mingla-tester` mandates `outputs/QA_*`; `mingla-designer` mandates `outputs/DESIGN_*`, `outputs/COMPONENT_*`, `outputs/FLOW_*`, and `outputs/DESIGN_SYSTEM_*`.

## 4. Scope

**In scope:**

- Update Mingla Codex skill instructions and directly relevant references so reports/specs/tests/handoffs use `Mingla_Artifacts/` paths and archives use `Mingla_Artifacts/archive/`.
- Update Mingla Claude skills in this rare approved case so they no longer mandate `outputs/` as current output.
- Add documentation regression scripts under `scripts/docs/`.
- Add a GitHub Actions workflow for docs/artifact regression checks.
- Update README/manifest/archive docs with the new lock-in rule and CI commands.
- Write an implementation report after changes.

**Non-goals:**

- Do not resolve the remaining 1,190 missing markdown links.
- Do not move or delete more historical artifacts.
- Do not publish private prompts.
- Do not change product/runtime code.
- Do not change Supabase migrations, RLS, edge functions, mobile, business, admin, marketing, Stripe, or live services.
- Do not broadly rewrite Claude skill behavior unrelated to documentation placement.

**Assumptions:**

- The user has explicitly approved Claude skill alignment for this documentation-system lock-in.
- `outputs/` may remain as ignored local residue, but it must not be a current durable documentation destination.
- Root `clade transfer/` should not return as an active tracked docs root.

**Dependencies:**

- ORCH-0750A/B/C remain the evidence base.
- Link threshold remains `1195` until a later ratchet pass lowers it.

## 5. Evidence Trace

| Requirement | Comes from finding / source | Confidence |
|---|---|---|
| README must remain snapshot/front door | `README.md` Source Of Truth + Last Synced sections; DEC-125 | High |
| Manifest is archive/document authority | `Mingla_Artifacts/ARTIFACT_MANIFEST.md` status taxonomy, authority map, archive policy; DEC-124/126 | High |
| Archive is historical evidence, not current instruction | `Mingla_Artifacts/archive/README.md`; ORCH-0750C tester PASS | High |
| Private prompts stay ignored/private | `.gitignore`; `ART-DIR-PROMPTS`; ORCH-0750A link audit `PROMPT_PRIVATE_OR_IGNORED=452` | High |
| Existing link debt must stay measured, not pretended clean | `ORCH-0750A_LINK_AUDIT.md`; latest local gate 451 files / 2,460 links / 1,190 missing | High |
| Skill rules are stale | `rg` hits in Codex and Claude skills for `outputs/`, `clade transfer/`, and output report paths | High |
| CI has a reusable pattern | `.github/workflows/strict-grep-mingla-business.yml`; `.github/scripts/strict-grep/README.md` | High |

## 6. Success Criteria

1. All Mingla Codex skills direct durable reports/specs/test reports/design specs to `Mingla_Artifacts/reports/` or `Mingla_Artifacts/specs/` as appropriate, not `outputs/`.
2. All Mingla Codex skills describe historical material through `Mingla_Artifacts/archive/` and `ARTIFACT_MANIFEST.md`, not root `outputs/` or `clade transfer/`.
3. Approved Mingla Claude skills are aligned to the same placement rules without touching generic Claude skills or unrelated product behavior.
4. Root README explicitly names the documentation lock-in commands and continues to link archive material only through `ARTIFACT_MANIFEST.md` or `Mingla_Artifacts/archive/README.md`.
5. `Mingla_Artifacts/ARTIFACT_MANIFEST.md` records ORCH-0750D and the new CI/script authority.
6. A docs regression workflow runs on PR/push when docs, skills, scripts, workflows, or artifact files change.
7. Local verification passes:
   - `python3 scripts/docs/check_links.py --format markdown --max-missing 1195`
   - `python3 scripts/docs/check_artifact_placement.py`
   - `python3 scripts/docs/check_readme_snapshot.py`
8. The placement checker fails if tracked files appear under `outputs/` or root `clade transfer/`, if tracked generated `dist` files reappear, or if skill files reintroduce current output destinations in `outputs/`.
9. Existing ignored local `outputs/` files do not cause failure by themselves; only tracked/versioned or instruction-level regressions fail.

## 7. Invariants

### Must Preserve

| Invariant | Enforcement in this spec | Verification |
|---|---|---|
| One owner per truth | Manifest owns artifact classification; README stays snapshot | README/manifest script checks |
| Subtract before adding | Stale output destinations are removed from skills before new CI enforces them | `rg` checks and placement script |
| No fabricated data | Link debt remains explicit at 1,190/1195 baseline, not hidden | Link checker gate |
| Label temporary | Deprecated queue files remain breadcrumbs | Placement script confirms breadcrumb files exist and point to archive |
| Prompt privacy | `Mingla_Artifacts/prompts/` remains ignored/private | `.gitignore` check and placement script |

### New Invariants

| Invariant | Owner | Enforcement | Verification |
|---|---|---|---|
| `I-DOC-ARTIFACT-PLACEMENT-LOCKED` | Documentation operating system | Durable Mingla docs must live in `Mingla_Artifacts/` or source docs; historical material in `Mingla_Artifacts/archive/`; `outputs/` and root `clade transfer/` are not current destinations | `scripts/docs/check_artifact_placement.py` + GitHub workflow |
| `I-README-SNAPSHOT-NOT-MANIFEST` | README + manifest | README links to artifact authorities and archive index, but does not become a second artifact manifest | `scripts/docs/check_readme_snapshot.py` |

## 8. Files To Change

### Codex Skills

- `.codex/skills/orchestrator-mingla/SKILL.md`
- `.codex/skills/orchestrator-mingla/references/artifact-system.md`
- `.codex/skills/forensic-mingla/SKILL.md`
- `.codex/skills/forensic-mingla/references/mingla-surface-map.md`
- `.codex/skills/implementor-mingla/SKILL.md`
- `.codex/skills/tester-mingla/SKILL.md`
- `.codex/skills/ui-ux-mingla/SKILL.md`

### Claude Skills

Only Mingla-specific Claude skills may be edited:

- `.claude/skills/mingla-orchestrator/SKILL.md`
- `.claude/skills/mingla-forensics/SKILL.md`
- `.claude/skills/mingla-implementor/SKILL.md`
- `.claude/skills/mingla-tester/SKILL.md`
- `.claude/skills/mingla-designer/SKILL.md`
- `.claude/skills/mingla-categorizer/SKILL.md`
- `.claude/skills/mingla-price-tiers/SKILL.md`
- `.claude/skills/mingla-product/SKILL.md`

Do not edit:

- `.claude/skills/ui-ux-pro-max/**`
- `.claude/projects/**`
- `.claude/settings.local.json`

### Docs / Artifacts / CI

- `README.md`
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md`
- `Mingla_Artifacts/archive/README.md`
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- `.github/workflows/docs-artifact-regression.yml` (new)
- `scripts/docs/check_artifact_placement.py` (new)
- `scripts/docs/check_readme_snapshot.py` (new)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md` (new implementation report)

No app, admin, business, marketing, Supabase, or integration source files are in scope.

## 9. Skill Update Contract

### Codex Orchestrator

Update the operational-docs memory so active docs are:

- `README.md`
- `docs/`
- `Mingla_Artifacts/`
- `Mingla_Artifacts/archive/` for historical evidence

Remove active wording that says operational docs include root `outputs/` or root `clade transfer/`.

Add close-protocol rule:

- A close that changes docs/artifacts must update `README.md` when the front-door snapshot or source-of-truth map changes.
- It must update `ARTIFACT_MANIFEST.md` when a file is moved, archived, superseded, made private, or promoted as authority.
- It must update `Mingla_Artifacts/archive/README.md` or nested archive indexes when archive sections change.
- It must run the link checker and placement/readme checks before close.

### Codex Forensics

Replace historical search instructions:

- Search current artifacts in `Mingla_Artifacts/reports/`, `Mingla_Artifacts/specs/`, `Mingla_Artifacts/AGENT_HANDOFFS.md`, `ARTIFACT_MANIFEST.md`, and `Mingla_Artifacts/archive/`.
- Treat ignored local `outputs/` only as legacy residue when explicitly present; do not cite it as current truth unless the manifest maps the archived equivalent.
- Do not reference `outputs/PRODUCT_DOCUMENT.md` or `outputs/LAUNCH_READINESS_TRACKER.md` as default current sources.

Output rules:

- Investigations go to `Mingla_Artifacts/reports/INVESTIGATION_[NAME].md`.
- Specs go to `Mingla_Artifacts/specs/SPEC_[NAME].md`.

### Codex Implementor

Replace report rule:

- Durable implementation reports go to `Mingla_Artifacts/reports/IMPLEMENTATION_[NAME].md`.
- `outputs/IMPLEMENTATION_*` is no longer acceptable for current ORCH work.

Add verification:

- For docs/process work, run `check_links.py`, `check_artifact_placement.py`, and `check_readme_snapshot.py` when touched files are relevant.

### Codex Tester

Replace QA report rule:

- Durable QA reports go to `Mingla_Artifacts/reports/TEST_REPORT_[NAME].md` or `QA_[NAME].md` only if historical naming is required by the dispatched spec.
- `outputs/QA_*` is no longer acceptable for current ORCH work.

Add docs QA gate:

- For docs/process lock-in, tester must verify skill text, CI workflow, scripts, README, manifest, archive README, and link baseline.

### Codex UI/UX

Add artifact rule:

- Design specs/audits that are part of Mingla lifecycle work go to `Mingla_Artifacts/specs/` or `Mingla_Artifacts/reports/`, not `outputs/`.
- Visual/design historical material may be archived only through manifest-backed archive rules.

## 10. Claude Skill Alignment Contract

Because the user explicitly approved this rare case, the implementor may edit Mingla-specific Claude skills listed in section 8. The edits must be minimal and process-only:

- Replace `outputs/INVESTIGATION_*`, `outputs/SPEC_*`, `outputs/IMPLEMENTATION_*`, `outputs/QA_*`, and design-output destinations with `Mingla_Artifacts/reports/` or `Mingla_Artifacts/specs/`.
- Add a short "Current Documentation System" note to each edited Mingla Claude skill:
  - README is snapshot/front door.
  - `ARTIFACT_MANIFEST.md` is artifact classification authority.
  - `Mingla_Artifacts/archive/` is historical evidence.
  - `Mingla_Artifacts/prompts/` is private/ignored unless explicitly versioned.
  - root `outputs/` and root `clade transfer/` are legacy, not current destinations.
- Do not alter model/tool behavior, product logic, visual taste rules, category/price/product domain rules, or non-documentation workflows.
- Do not edit generic `.claude/skills/ui-ux-pro-max/**`.

If a Claude Mingla skill has no report/spec output rule, add only the short note. Do not force artificial ceremony.

## 11. Close Protocol Contract

All future closes must follow this placement map:

| Artifact type | Current destination | Notes |
|---|---|---|
| Forensic investigation | `Mingla_Artifacts/reports/INVESTIGATION_[ORCH-ID]_[NAME].md` | Current evidence, not `outputs/` |
| Implementation spec | `Mingla_Artifacts/specs/SPEC_[ORCH-ID]_[NAME].md` | Contract for implementor |
| Implementation report | `Mingla_Artifacts/reports/IMPLEMENTATION_[ORCH-ID]_[NAME].md` | Includes verification and deploy notes |
| QA/test report | `Mingla_Artifacts/reports/TEST_REPORT_[ORCH-ID]_[NAME].md` | PASS/FAIL evidence |
| Orchestrator prompt | `Mingla_Artifacts/prompts/[ROLE]_[ORCH-ID]_[NAME].md` | Private/ignored unless separately versioned |
| Handoff/chronology | `Mingla_Artifacts/AGENT_HANDOFFS.md` | Current lifecycle ledger |
| Decision | `Mingla_Artifacts/DECISION_LOG.md` | Binding decision/tradeoff |
| Invariant | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Durable rule |
| Archive material | `Mingla_Artifacts/archive/[category]/...` | Manifest row required |
| Deprecated tracker | Breadcrumb in old path + full copy under archive | Same pattern as `SPEC_QUEUE.md`, `TEST_QUEUE.md`, `RETEST_LEDGER.md` |

Close checklist for docs/process changes:

1. Update `AGENT_HANDOFFS.md` with status and next handoff.
2. Add/update `DECISION_LOG.md` when a durable rule, accepted tradeoff, or close decision is made.
3. Update `ARTIFACT_MANIFEST.md` for any artifact status/path/authority/archive change.
4. Update `README.md` if the user-facing repo map, source-of-truth table, Last Synced block, or docs gate commands changed.
5. Update `Mingla_Artifacts/archive/README.md` if archive structure/rules changed.
6. Run:
   - `python3 scripts/docs/check_links.py --format markdown --max-missing 1195`
   - `python3 scripts/docs/check_artifact_placement.py`
   - `python3 scripts/docs/check_readme_snapshot.py`

## 12. README / Manifest Sync Contract

README may include:

- ecosystem snapshot;
- source-of-truth links;
- reproducible count commands;
- link/check commands;
- short repo map;
- archive front door link.

README must not include:

- long hand-maintained artifact inventory;
- direct random links to archived historical files;
- private prompt links as durable evidence;
- active repo map entries for `outputs/` or root `clade transfer/`;
- stale generated/build output as documentation authority.

Manifest must include:

- ORCH-0750D close status after implementation/test;
- rows for new docs scripts/workflows;
- the two new invariants or cross-references to `INVARIANT_REGISTRY.md`;
- any Claude/Codex skill status notes if the manifest tracks them later.

## 13. CI / Regression Gate Contract

### New Script: `scripts/docs/check_artifact_placement.py`

Standard-library Python.

Required checks:

1. `git ls-files outputs` must return no tracked files.
2. `git ls-files "clade transfer"` must return no tracked files.
3. `git ls-files` must not contain tracked files matching generated build output under:
   - `**/dist/**`
   - `**/build/**`
   - `**/web-build/**`
   except explicitly allowlisted docs if any are added with a comment in the script.
4. `.gitignore` must keep:
   - `.claude/`
   - `.codex/`
   - `outputs/`
   - `Mingla_Artifacts/prompts/`
5. `Mingla_Artifacts/SPEC_QUEUE.md`, `TEST_QUEUE.md`, and `RETEST_LEDGER.md` must contain `DEPRECATED`, link to `AGENT_HANDOFFS.md`, and link to their `archive/old_trackers/` copies.
6. `Mingla_Artifacts/archive/README.md` must mention `ARTIFACT_MANIFEST.md`, `outputs_legacy/`, `handoffs_legacy/`, and `old_trackers/`.
7. Codex and Claude Mingla skill files must not contain current output instructions to `outputs/INVESTIGATION`, `outputs/SPEC`, `outputs/IMPLEMENTATION`, `outputs/QA`, `outputs/DESIGN`, `outputs/COMPONENT`, `outputs/FLOW`, or `outputs/DESIGN_SYSTEM`.
8. Root `clade transfer/` may appear only as quoted legacy text or in archive/manifest history, not as a current destination.

The script should print a concise PASS summary or a line-per-violation list and exit `1` on violations.

### New Script: `scripts/docs/check_readme_snapshot.py`

Standard-library Python.

Required checks:

1. README contains the phrase `README is a snapshot`.
2. README links to:
   - `Mingla_Artifacts/ARTIFACT_MANIFEST.md`
   - `Mingla_Artifacts/archive/README.md`
   - `Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md`
3. README contains the link baseline gate command with `--max-missing 1195`.
4. README does not list `outputs/` or `clade transfer/` as active repo-map entries.
5. README's repo map contains `Mingla_Artifacts/` and nested `archive/`.

### New Workflow: `.github/workflows/docs-artifact-regression.yml`

Trigger:

```yaml
on:
  pull_request:
    paths:
      - "README.md"
      - "docs/**"
      - "Mingla_Artifacts/**"
      - "scripts/docs/**"
      - ".codex/skills/**"
      - ".claude/skills/**"
      - ".github/workflows/docs-artifact-regression.yml"
  push:
    branches: [main, Seth]
    paths:
      - "README.md"
      - "docs/**"
      - "Mingla_Artifacts/**"
      - "scripts/docs/**"
      - ".codex/skills/**"
      - ".claude/skills/**"
      - ".github/workflows/docs-artifact-regression.yml"
```

Jobs:

- `markdown-links`: checkout, setup Python, run `python3 scripts/docs/check_links.py --format markdown --max-missing 1195`.
- `artifact-placement`: checkout, setup Python, run `python3 scripts/docs/check_artifact_placement.py`.
- `readme-snapshot`: checkout, setup Python, run `python3 scripts/docs/check_readme_snapshot.py`.

Do not add network dependencies.

## 14. Database / RLS / Migration

None. ORCH-0750D is docs/process/CI only.

No migration, no RLS policy, no DB deploy, no remote Supabase action.

## 15. Edge Functions / RPCs / Webhooks

None.

## 16. Service Layer

None.

## 17. Hook / State / Cache Layer

None.

## 18. Component / Screen Layer

None.

## 19. Business / Admin / Public Parity

No product surface changes.

Parity requirement is process-only: all agent families that can create Mingla docs must share the same placement rules.

## 20. Realtime / Notifications / Analytics

None.

## 21. Implementation Order

1. Update Codex skill files and referenced docs listed in section 8.
2. Update approved Mingla Claude skill files listed in section 8, process-only.
3. Add `scripts/docs/check_artifact_placement.py`.
4. Add `scripts/docs/check_readme_snapshot.py`.
5. Add `.github/workflows/docs-artifact-regression.yml`.
6. Update `README.md` with lock-in commands/source-of-truth wording.
7. Update `Mingla_Artifacts/archive/README.md` if needed with lock-in/CI note.
8. Update `Mingla_Artifacts/INVARIANT_REGISTRY.md` with the two documentation invariants.
9. Update `Mingla_Artifacts/ARTIFACT_MANIFEST.md` with ORCH-0750D script/workflow entries and status.
10. Run all verification commands.
11. Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md`.

## 22. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
|---|---|---|---|---|---|
| T-01 | Link debt baseline holds | Current repo | Missing links <= 1195 | Docs script | `python3 scripts/docs/check_links.py --format markdown --max-missing 1195` |
| T-02 | Artifact placement clean | Current repo | No tracked active docs in `outputs/` or root `clade transfer/`; no tracked generated build assets | Docs script | `python3 scripts/docs/check_artifact_placement.py` |
| T-03 | README remains snapshot | Current README | Required source-of-truth links and baseline command present; no active old roots | Docs script | `python3 scripts/docs/check_readme_snapshot.py` |
| T-04 | Codex skills aligned | Current Codex skills | No current output rules to `outputs/`; archive/manifest rules present | Static grep/script | `python3 scripts/docs/check_artifact_placement.py` plus `rg` verification |
| T-05 | Claude Mingla skills aligned | Approved Mingla Claude skills | No mandated current `outputs/` report/spec/design destinations | Static grep/script | `python3 scripts/docs/check_artifact_placement.py` plus `rg` verification |
| T-06 | Private prompts stay private | `.gitignore` + Git tracking | `Mingla_Artifacts/prompts/` ignored and no tracked prompt files required by README | Script/git | placement script + `git status --short Mingla_Artifacts/prompts` |
| T-07 | Breadcrumb queues preserved | Queue files | Deprecated breadcrumbs point to `AGENT_HANDOFFS.md` and archive originals | Script/static read | placement script |
| T-08 | CI workflow syntax is inspectable | New workflow | YAML file exists and runs three scripts with Python only | Static read | `sed`/review plus local script runs |

## 23. Regression Prevention

- **Structural safeguard:** `docs-artifact-regression.yml` runs on docs/skills/artifact/script/workflow changes.
- **Test:** local Python scripts fail on stale placements and README drift.
- **Protective documentation:** README, manifest, archive README, and skills all state the same placement contract.
- **Artifact update:** implementation report records before/after grep results and final link counts.

## 24. Rollback And Deploy Safety

- **Migration order:** None.
- **Edge deploy:** None.
- **Mobile OTA/native build:** None.
- **Business/admin/web deploy:** None.
- **Env vars/secrets:** None.
- **Partial rollback risk:** If CI workflow is added before skill text is updated, CI may fail because old skill text still contains `outputs/` destinations. Follow implementation order: update skill text before enabling strict checks.
- **Rollback:** Revert ORCH-0750D commit. This restores prior skills/CI/docs but reopens documentation drift risk.

## 25. Common Mistakes

1. Treating ignored local `outputs/` files as a failure. The failure is tracked/current use, not local residue.
2. Editing generic Claude `ui-ux-pro-max` because it mentions design outputs. It is not Mingla-specific and is out of scope.
3. Making the link checker strict zero-missing. That belongs to a later ratchet after the 1,190-link debt is burned down.
4. Updating README with a giant artifact inventory. README is the front door; the manifest is the map.
5. Publishing private prompt files to make links green. Replace with report/spec evidence or mark private.
6. Forgetting `.codex/skills/*/references/*.md`; stale references can re-teach old behavior even if `SKILL.md` is fixed.

## 26. Handoff To Implementor

Implement ORCH-0750D as a docs/process/CI lock-in only. Update the Mingla Codex skills, approved Mingla Claude skills, README, manifest, archive docs, and add the two Python regression scripts plus one GitHub workflow. Do not touch product/runtime files. Verification must include the existing link checker under the 1,195 baseline plus the two new scripts, and the implementation report must show grep proof that current `outputs/` report/spec/design destinations are gone from Mingla skill instructions.
