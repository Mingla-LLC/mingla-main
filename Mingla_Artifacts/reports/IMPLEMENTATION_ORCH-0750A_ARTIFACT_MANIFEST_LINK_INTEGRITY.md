# Implementation Report: Artifact Manifest and Link Integrity (ORCH-0750A)

> Date: 2026-05-07  
> Mode: Spec Execute  
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0750A_ARTIFACT_MANIFEST_LINK_INTEGRITY.md`  
> Status: implemented and verified

## 1. Layman Summary

Created the map before the cleanup. Mingla now has a first-pass artifact manifest, a reproducible link checker, and a current link-audit report. No README rewrite, archive move, deletion, or product-code edit was performed for ORCH-0750A.

## 2. Request And Context

- **Request:** implement the orchestrator-dispatched ORCH-0750A manifest/link-integrity spec.
- **Source:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0750A_ARTIFACT_MANIFEST_LINK_INTEGRITY.md`
- **Affected surfaces:** documentation/tooling only.
- **Related artifacts:** ORCH-0750 investigation, ORCH-0750A spec, ORCH-0750A link audit.

## 3. Scope

- **In scope:** manifest, link checker, link audit report, implementation report.
- **Out of scope:** README/app README rewrite, archive moves, deletes, product code, Supabase functions/migrations, launch-readiness grade changes.
- **Assumptions:** current dirty worktree includes unrelated app/Supabase changes; these were preserved and not edited.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `.codex/skills/implementor-mingla/references/execution-protocol.md` | Implementation rules | ORCH/spec work requires report and verification. |
| `.codex/skills/implementor-mingla/references/report-template.md` | Report shape | Used for this report. |
| `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0750A_ARTIFACT_MANIFEST_LINK_INTEGRITY.md` | Dispatch contract | Docs/tooling only; no README/archive/delete. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0750A_ARTIFACT_MANIFEST_LINK_INTEGRITY.md` | Implementation spec | Required manifest, checker, link audit, verification. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0750_DOCUMENTATION_ARTIFACTS_TOTAL_SWEEP.md` | Evidence base | Proved stale README, no manifest, 1,195 missing links. |

## 5. Blast Radius

- **Direct changes:** `scripts/docs/check_links.py`, `Mingla_Artifacts/ARTIFACT_MANIFEST.md`, `Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md`, this report.
- **Cascade changes:** none.
- **Parity surfaces:** mobile/business/admin READMEs were intentionally untouched.
- **Cache impact:** none.
- **State boundaries:** none.
- **Auth/RLS/security:** none.
- **Deploy path:** none; docs/tooling only.

## 6. Old To New Receipts

### `scripts/docs/check_links.py`

- **Before:** no reproducible repo-local markdown link checker for ORCH-0750 cleanup.
- **After:** Python standard-library checker scans agreed roots, classifies missing links, supports plain/markdown/json output, and supports strict `--max-missing`.
- **Why:** ORCH-0750A requires measurable link integrity before README/archive/delete work.
- **Approx lines changed:** new file, 345 LOC.

### `Mingla_Artifacts/ARTIFACT_MANIFEST.md`

- **Before:** no canonical artifact manifest, no status taxonomy, no archive policy map.
- **After:** first-pass manifest with status taxonomy, top-level artifact rows, docs/output/clade rows, report/spec roots, prompt policy, archive policy, and README surface map.
- **Why:** README and future archive work need one authority map.
- **Approx lines changed:** new file, 167 LOC.

### `Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md`

- **Before:** missing-link evidence existed only in forensic report and command output.
- **After:** durable audit report with current counts, classifications, top sources/targets, representative examples, and phase deferrals.
- **Why:** tester and later ORCH-0750B/0750C need a stable baseline.
- **Approx lines changed:** new file, 153 LOC.

### `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750A_ARTIFACT_MANIFEST_LINK_INTEGRITY.md`

- **Before:** no implementation evidence trail for ORCH-0750A.
- **After:** this report documents scope, changes, verification, residual risk, and deferrals.
- **Why:** orchestrator/tester need proof and next-step clarity.
- **Approx lines changed:** new file.

## 7. Implementation Details

- **Architecture decisions:** kept manifest manually curated for ORCH-0750A, with script-assisted link evidence.
- **Data flow:** checker scans markdown/text roots, resolves repo-local links, classifies missing targets, and reports deterministic counts.
- **Mutation/query behavior:** none.
- **State handling:** none.
- **Error handling:** checker exits non-zero only when `--max-missing` is exceeded; normal reporting mode exits 0 while debt remains.
- **Copy/accessibility:** none.
- **Analytics/notifications/realtime:** none.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| `ARTIFACT_MANIFEST.md` exists | Yes | file created and top-level coverage checked | PASS |
| Every top-level artifact represented | Yes | manifest coverage command produced no missing rows | PASS |
| Docs/outputs/clade/dirs represented | Yes | manifest has `docs/`, all `outputs/*.md`, all `clade transfer/*.md`, and required directory rows | PASS |
| Link checker exists and runs | Yes | `python3 scripts/docs/check_links.py` | PASS |
| Link audit report exists | Yes | `Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md` | PASS |
| No moves/deletes | Yes | `git status --short` has no D/R entries from ORCH-0750A | PASS |
| README/app READMEs unchanged | Yes | README diff command produced no output | PASS |
| Product code unchanged by ORCH-0750A | Yes, but unrelated dirty product diffs pre-existed | product diff reviewed and not touched | PASS with caveat |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| Historical evidence is not destroyed | Yes | Yes | No files moved/deleted. |
| README must not become another hand-maintained source of truth | Yes | Yes | README/app READMEs untouched. |
| One owner per truth | Yes | Yes | Manifest now defines roles/statuses. |
| No silent failures | Yes | Yes | Checker reports counts and supports strict failure mode. |
| `I-ARTIFACT-MANIFEST-CANONICAL` | Yes | Established | Current artifact map now exists. |
| `I-ARCHIVE-PRESERVES-BREADCRUMBS` | Yes | Documented | Future ORCH-0750C rule recorded. |
| `I-PROMPT-LINKS-ARE-NOT-DURABLE-EVIDENCE` | Yes | Established | Prompt links classified as private/ignored class. |

## 10. Parity Check

- **Mobile:** no runtime changes; app README untouched.
- **Business app:** no runtime changes; app README untouched.
- **Admin:** no runtime changes; app README untouched.
- **Public/web:** no runtime changes.
- **Solo/collab:** not applicable.
- **Gaps:** README/app README fixes deferred to ORCH-0750B.

## 11. Cache And Persisted State Safety

- **Query keys changed:** none.
- **Invalidations added:** none.
- **Data shape changes:** none.
- **AsyncStorage/Zustand impact:** none.
- **Cold start behavior:** none.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Link checker plain output | `python3 scripts/docs/check_links.py` | PASS | 411 files checked, 2,363 links, 1,195 missing. |
| Link checker markdown output | `python3 scripts/docs/check_links.py --format markdown` | PASS | Markdown summary rendered. |
| Strict link gate | `python3 scripts/docs/check_links.py --max-missing 0` | Expected FAIL, exit code 1 | Correct while 1,195 missing links remain. |
| Top-level manifest coverage | compare `find Mingla_Artifacts -maxdepth 1 -type f -name '*.md'` to manifest rows | PASS | Coverage command produced no missing rows after adding manifest self-row. |
| README/app README untouched | `git diff -- README.md app-mobile/README.md mingla-admin/README.md mingla-business/README.md` | PASS | No output. |
| Worktree status | `git status --short` | PASS with caveat | Shows ORCH-0750A files plus unrelated pre-existing app/Supabase/report changes. |

Current link classification counts:

| Classification | Count |
|---|---:|
| `MOVED_OR_ARCHIVED_CANDIDATE` | 600 |
| `PROMPT_PRIVATE_OR_IGNORED` | 452 |
| `TRUE_MISSING_REFERENCE` | 126 |
| `HISTORICAL_SOURCE_MISSING` | 13 |
| `GENERATED_OR_IGNORED_TARGET` | 4 |

## 13. Regression Surface

1. Future README work could bypass the manifest and reintroduce stale hand-maintained counts.
2. Future archive work could move files before links are rewritten.
3. Prompt links could continue to look broken unless the project decides whether prompts are versioned or private by design.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Broken links remain | 1,195 missing links still exist | ORCH-0750B/C repair, redirect, or classify exceptions | `ORCH-0750A_LINK_AUDIT.md` |
| Manifest is first-pass manual | Individual report/spec rows are not exhaustive | Later automation or deeper ORCH-0750C classification | `ARTIFACT_MANIFEST.md` |
| Product code dirty in worktree | Could confuse tester if not distinguished | Tester checks ORCH-0750A diff scope only | `git status --short` |

## 15. Discoveries For Orchestrator

- `Mingla_Artifacts/AGENT_HANDOFFS.md`, `MASTER_BUG_LIST.md`, and `WORLD_MAP.md` dominate missing links. They should be the first repair targets after README is safe.
- `Mingla_Artifacts/prompts/` being ignored creates a structural tension with durable handoff links. Orchestrator should decide whether to version future prompts or require links to reports/specs only.

## 16. Deploy Notes

- **Migrations:** none.
- **Edge functions:** none.
- **Mobile OTA/native:** none.
- **Business/admin web:** none.
- **Env vars/secrets:** none.

## Suggested Commit Message

```text
docs: add ORCH-0750A artifact manifest and link audit tooling

Resolves: ORCH-0750A implementation
Evidence: python3 scripts/docs/check_links.py; ORCH-0750A_LINK_AUDIT.md
Deploy: none
```

## Ready-To-Test Checklist

1. Run `python3 scripts/docs/check_links.py`; expect 1,195 missing links with classification counts in this report.
2. Run `python3 scripts/docs/check_links.py --format markdown`; expect markdown summary output.
3. Run `python3 scripts/docs/check_links.py --max-missing 0`; expect exit code 1 while debt remains.
4. Verify every top-level `Mingla_Artifacts/*.md` file appears in `ARTIFACT_MANIFEST.md`.
5. Verify README/app READMEs have no diff.
6. Verify there are no deleted/renamed artifacts from ORCH-0750A.

IMPLEMENTATION COMPLETE - READY FOR TESTER
