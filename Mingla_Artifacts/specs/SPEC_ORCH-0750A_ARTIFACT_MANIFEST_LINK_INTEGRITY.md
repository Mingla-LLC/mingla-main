# Spec: ORCH-0750A Artifact Manifest and Link Integrity

> Date: 2026-05-07  
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0750_DOCUMENTATION_ARTIFACTS_TOTAL_SWEEP.md`  
> Root cause: ORCH-0750 F3/F4/F5 - no artifact authority manifest, no supersession graph, broken local link system  
> Status: ready for implementation

## 1. Layman Summary

Mingla has a lot of real knowledge, but it is scattered. Some files are current, some are old-but-important, some are superseded, and some are generated or private. Right now the repo does not clearly tell a human or agent which is which.

This phase creates the map before the cleanup. It adds one manifest, one reproducible link-audit tool, and a small report showing what is broken and what must wait. It does **not** rewrite README, move historical files, or delete anything.

## 2. User Story

As the Mingla operator, I want one clear artifact manifest and link-integrity report so that I can safely rebuild README and archive old work without losing evidence or accidentally treating stale docs as current truth.

## 3. Scope

**In scope:**

- Create `Mingla_Artifacts/ARTIFACT_MANIFEST.md`.
- Create a reproducible markdown link checker under `scripts/docs/check_links.py`.
- Create a generated/checked link report at `Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md`.
- Classify top-level artifacts, current reports/specs roots, docs, outputs, clade-transfer handoffs, backups, migration archive, prompts, and generated/ignored material.
- Document one future archive root: `Mingla_Artifacts/archive/`.
- Add explicit deferrals for ORCH-0750B README rebuild and ORCH-0750C archive/delete pass.

**Non-goals:**

- No root README rewrite.
- No app README rewrite.
- No product code changes.
- No Supabase function or migration changes.
- No file moves out of `outputs/` or `clade transfer/`.
- No deletion.
- No launch-readiness grade changes.
- No edits to `.claude/skills/`.

**Assumptions:**

- The current branch is intentionally dirty and contains unrelated work. The implementor must not revert or alter unrelated files.
- `Mingla_Artifacts/prompts/` is ignored by git. Links to prompt files must be classified honestly instead of silently treated as durable public evidence.
- Historical files can remain valuable even if stale.

**Dependencies:**

- ORCH-0750 investigation report is the evidence base.
- Python 3 is available locally; Node is not required.
- Later ORCH-0750B/0750C specs depend on this manifest and link report.

## 4. Evidence Trace

| Requirement | Comes from finding / source | Confidence |
|---|---|---|
| Add manifest | ORCH-0750 F4: 878 artifacts, no manifest/supersession graph | High |
| Classify top-level trackers | ORCH-0750 F3: trackers mix current and historical sections | High |
| Preserve historical artifacts first | ORCH-0750 Deletion and Archive Classification | High |
| Add link checker | ORCH-0750 F5: 1,195 missing local markdown links | High |
| Treat prompt links specially | ORCH-0750 F5: many links point into ignored `Mingla_Artifacts/prompts/` | High |
| Do not rewrite README yet | ORCH-0750 follow-up split: 0750A manifest, 0750B README | High |
| One archive root later | User direction and ORCH-0750 archive recommendation | High |

## 5. Success Criteria

1. `Mingla_Artifacts/ARTIFACT_MANIFEST.md` exists and defines the current artifact authority model.
2. Every top-level `Mingla_Artifacts/*.md` file is represented in the manifest with exactly one primary role.
3. `docs/*.md`, `outputs/*.md`, `clade transfer/*.md`, top-level report/spec roots, backups, migration archive, and prompt policy are represented.
4. No artifact is moved or deleted.
5. `scripts/docs/check_links.py` runs from repo root and emits deterministic markdown and JSON-style summary output.
6. `Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md` records the current broken-link count, top sources, exception classes, and next actions.
7. README rebuild is unblocked by a manifest-backed "current artifact map."
8. The implementation report proves only docs/tooling artifacts were touched.

## 6. Invariants

### Must Preserve

| Invariant | Enforcement in this spec | Verification |
|---|---|---|
| Historical evidence is not destroyed | No deletes or moves in ORCH-0750A | `git status --short` and implementation report |
| README must not become another hand-maintained source of truth | README rewrite deferred to ORCH-0750B and will consume manifest | README unchanged except explicitly approved tiny pointer, which this spec does not require |
| One owner per truth | Manifest defines authority role per top-level artifact | Manifest role validation section |
| No silent failures | Link checker exits non-zero only when configured threshold fails and always writes summary | Run checker and inspect output |
| User-controlled pipeline | This spec hands to implementor; implementor does not proceed to README/archive | Implementation report non-goals check |

### New Invariants

| Invariant | Owner | Enforcement | Verification |
|---|---|---|---|
| `I-ARTIFACT-MANIFEST-CANONICAL` | Mingla_Artifacts | Any current artifact/dashboard must be represented in `ARTIFACT_MANIFEST.md` before README cites it as current truth | Manifest completeness check |
| `I-ARCHIVE-PRESERVES-BREADCRUMBS` | Mingla_Artifacts/archive | Future archive moves must preserve old path, new path, supersession, and replacement pointer | ORCH-0750C tester gate |
| `I-PROMPT-LINKS-ARE-NOT-DURABLE-EVIDENCE` | Agent handoff pipeline | Links into ignored prompt files must be present, versioned, or marked `PRIVATE_PROMPT_NOT_VERSIONED` | Link report exception class count |

## 7. Database / RLS / Migration

None.

This phase is documentation and tooling only. It must not change Supabase migrations, schema, RLS, functions, cron, triggers, or data.

## 8. Edge Functions / RPCs / Webhooks

None.

No edge function, RPC, webhook, or external integration changes are in scope.

## 9. Service Layer

None for app/business/admin runtime services.

Tooling addition:

### `check_links.py`

- **Path:** `scripts/docs/check_links.py`
- **Runtime:** Python 3 standard library only.
- **Invocation:** `python3 scripts/docs/check_links.py`
- **Optional flags:** `--format markdown`, `--format json`, `--max-missing N`, `--root .`
- **Default scan roots:**
  - `README.md`
  - `app-mobile/README.md`
  - `mingla-admin/README.md`
  - `mingla-business/README.md`
  - `.github/scripts/strict-grep/README.md`
  - `scripts/deferred-migrations/README.md`
  - `docs/`
  - `Mingla_Artifacts/`
  - `outputs/`
  - `clade transfer/`
- **Default ignores:**
  - `node_modules/`
  - `.expo/`
  - `.git/`
  - `dist/`
  - `.vercel/`
  - external schemes: `http`, `https`, `mailto`, `tel`
  - anchors-only links like `(#section)`
- **Line anchors:** strip `#...` for filesystem existence, but preserve full raw target in output.
- **Line-number pseudo anchors:** links like `path.ts#L123` count as existing if `path.ts` exists.
- **Outside-root targets:** classify as `EXTERNAL_LOCAL_PATH_SKIPPED`, not missing.
- **Output fields per missing link:** source file, source line, raw target, resolved target, classification, suggested action.
- **Exit behavior:** default exits 0 and reports counts; `--max-missing 0` exits non-zero when any missing link remains. ORCH-0750A should use reporting mode, not fail-all mode, because the current seed count is known high.

## 10. Hook / State / Cache Layer

None.

No React Query, Zustand, AsyncStorage, auth, cache, or app state changes are in scope.

## 11. Component / Screen Layer

None.

No UI, copy, navigation, mobile, business, admin, or public web screen changes are in scope.

## 12. Business / Admin / Public Parity

No runtime parity changes.

Documentation parity rule:

- App README files may be classified by the manifest but must not be rewritten in ORCH-0750A.
- The manifest should identify that `app-mobile/README.md`, `mingla-admin/README.md`, and `mingla-business/README.md` are future ORCH-0750B inputs.

## 13. Realtime / Notifications / Analytics

None.

## 14. Artifact Manifest Contract

Create:

`Mingla_Artifacts/ARTIFACT_MANIFEST.md`

### Required Header

The top of the file must include:

- title;
- date generated/updated;
- source investigation link;
- git commit used for verification, from `git rev-parse --short HEAD`;
- note that it is manually curated in ORCH-0750A and may be script-assisted later;
- non-goal note: "This manifest classifies artifacts; it does not move or delete them."

### Required Table Schema

Use this exact table:

`artifact_id | path | kind | domain | role | status | supersedes | superseded_by | current_authority | archive_policy | last_verified_commit | README_surface | notes`

Field definitions:

- `artifact_id`: stable ID, e.g. `ART-TOP-OPEN-INVESTIGATIONS`, `ART-REPORT-ORCH-0750`, `ART-OUTPUT-B2-PATH-C-V2`.
- `path`: repo-relative path.
- `kind`: `dashboard`, `ledger`, `report`, `spec`, `prompt`, `handoff`, `runbook`, `strategy`, `archive`, `backup`, `generated`, `readme`, `tooling`.
- `domain`: `program`, `mobile`, `business`, `admin`, `marketing`, `supabase`, `stripe`, `docs`, `archive`, `cross-cutting`.
- `role`: one of `dashboard`, `ledger`, `authority`, `historical_evidence`, `archive_only`, `generated_ignore`, `private_prompt`, `missing_reference`.
- `status`: one of the status values below.
- `supersedes`: path or `None`.
- `superseded_by`: path or `None`.
- `current_authority`: `yes`, `no`, or `partial`.
- `archive_policy`: one of `keep_current`, `archive_later`, `preserve_historical`, `delete_candidate_after_link_rewrite`, `generated_ignore`, `not_applicable`.
- `last_verified_commit`: short SHA used during implementation.
- `README_surface`: `root_snapshot`, `artifact_map`, `app_specific`, `archive_index`, `do_not_link`, `not_yet`.
- `notes`: concise explanation.

### Status Taxonomy

The manifest must define these statuses with examples:

| Status | Plain-English meaning | Example |
|---|---|---|
| `CURRENT_AUTHORITY` | Use this for current product/program truth | `Mingla_Artifacts/INVARIANT_REGISTRY.md` |
| `CURRENT_LEDGER` | Ongoing chronology, not a clean dashboard | `Mingla_Artifacts/AGENT_HANDOFFS.md` |
| `HISTORICAL_AUTHORITY` | Historically authoritative evidence that remains important | `Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/` |
| `SUPERSEDED_KEEP` | Replaced by newer artifact, but retained for proof | `outputs/SPEC_B2_PATH_C_V2.md` superseded by V3 |
| `ARCHIVE_ONLY` | Keep for provenance, do not use as current instructions | `clade transfer/HANDOFF_ORCH_0737_V6_PIPELINE_REDESIGN.md` |
| `DELETE_CANDIDATE_AFTER_LINK_REWRITE` | Possibly removable only after manifest replacement and link audit prove safety | generated `.vercel/README.txt` if tracked later |
| `GENERATED_IGNORE` | Generated/local artifacts that should not inform docs | ignored `dist/`, `.expo/`, `.vercel/` material |
| `PRIVATE_PROMPT_NOT_VERSIONED` | Prompt reference exists only in ignored/private prompt storage | missing links into `Mingla_Artifacts/prompts/` |
| `MISSING_REFERENCE_NEEDS_REWRITE` | Link target is absent and needs replacement, archive lookup, or textual citation | missing `LAUNCH_READINESS_TRACKER.md` references |

### Required Manifest Sections

The file must have these sections:

1. `How To Read This Manifest`
2. `Status Taxonomy`
3. `Current Authority Map`
4. `Top-Level Mingla_Artifacts`
5. `Reports And Specs`
6. `External Artifact Roots`
7. `Archive Policy`
8. `README Surface Map`
9. `Known Broken Link Classes`
10. `ORCH-0750B/0750C Deferrals`

### First-Pass Population Minimum

The implementor must populate:

- every top-level `Mingla_Artifacts/*.md` file, currently 24 files;
- `docs/*.md`, currently 5 files in the refreshed inventory;
- all `outputs/*.md`, currently 10 files;
- all `clade transfer/*.md`, currently 5 files;
- directory-level rows for `Mingla_Artifacts/reports/` and `Mingla_Artifacts/specs/`;
- individual rows for the latest ORCH-0750 report and this ORCH-0750A spec;
- directory-level rows for `Mingla_Artifacts/prompts/`, `backups/`, `migrations_archive_orch_0729_2026-05-05/`, `handoffs/`, `design-package/`, `github/`, and `signal-lab/`.

The implementor may add more individual report/spec rows, but must not leave the top-level map incomplete.

### Required Initial Role Assignments

The manifest must at minimum classify:

| Path | Required role/status |
|---|---|
| `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` | `ledger` / `CURRENT_LEDGER` |
| `Mingla_Artifacts/AGENT_HANDOFFS.md` | `ledger` / `CURRENT_LEDGER` |
| `Mingla_Artifacts/DECISION_LOG.md` | `authority` / `CURRENT_AUTHORITY` |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | `authority` / `CURRENT_AUTHORITY` |
| `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md` | `authority` / `CURRENT_AUTHORITY` |
| `Mingla_Artifacts/COVERAGE_MAP.md` | `dashboard` / `CURRENT_AUTHORITY` or `CURRENT_LEDGER` with note if mixed |
| `Mingla_Artifacts/MASTER_BUG_LIST.md` | `ledger` / `CURRENT_LEDGER` |
| `Mingla_Artifacts/PRODUCT_SNAPSHOT.md` | `dashboard` / `CURRENT_AUTHORITY` with `partial` current authority because mixed old blocks remain |
| `Mingla_Artifacts/PRIORITY_BOARD.md` | `dashboard` / `CURRENT_AUTHORITY` with `partial` current authority because old Top 20 remains |
| `Mingla_Artifacts/SPEC_QUEUE.md` | `historical_evidence` / `ARCHIVE_ONLY` because deprecated |
| `Mingla_Artifacts/TEST_QUEUE.md` | `historical_evidence` / `ARCHIVE_ONLY` because deprecated |
| `Mingla_Artifacts/RETEST_LEDGER.md` | `historical_evidence` / `ARCHIVE_ONLY` because deprecated |
| `outputs/` docs | classify individually, generally `SUPERSEDED_KEEP` or `ARCHIVE_ONLY` |
| `clade transfer/` docs | classify individually as `ARCHIVE_ONLY` unless active evidence says otherwise |
| `Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/` | `historical_evidence` / `HISTORICAL_AUTHORITY` |

## 15. Link Integrity Contract

Create:

`scripts/docs/check_links.py`

Create report:

`Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md`

### Link Classifications

The checker/report must classify missing links into:

- `PROMPT_PRIVATE_OR_IGNORED`: target is under `Mingla_Artifacts/prompts/` or `prompts/` and missing/untracked.
- `HISTORICAL_SOURCE_MISSING`: historical evidence points to a source path no longer present.
- `MOVED_OR_ARCHIVED_CANDIDATE`: likely target exists under another root or should be redirected through manifest.
- `LINE_ANCHOR_BASE_EXISTS`: target includes `#L...`; base path exists.
- `TRUE_MISSING_REFERENCE`: no plausible target exists; needs rewrite or deletion from source doc.
- `GENERATED_OR_IGNORED_TARGET`: target is generated or ignored material and should not be a durable doc link.
- `OUTSIDE_REPO_SKIPPED`: target resolves outside repo and is intentionally skipped.

### Report Requirements

`ORCH-0750A_LINK_AUDIT.md` must include:

- command used;
- date and commit;
- files checked;
- total links checked;
- missing link count;
- counts by classification;
- top 25 source files by missing-link count;
- top 25 missing targets;
- top 50 representative examples;
- "Safe to fix in ORCH-0750A" list;
- "Must wait for ORCH-0750B README rebuild" list;
- "Must wait for ORCH-0750C archive move" list;
- "Prompt/private exception" list.

### ORCH-0750A Threshold

Because seed evidence found 1,195 missing links, ORCH-0750A does not require zero missing links.

Pass threshold:

- checker exists and runs reproducibly;
- link report exists;
- every missing link is assigned a classification;
- top 25 source files are listed;
- no file is moved/deleted to make link counts look better.

Fail threshold:

- checker cannot run from repo root;
- missing links are reported without source file/line/target;
- prompt links remain ambiguous;
- implementation silently edits README or moves artifacts.

## 16. Archive Design

ORCH-0750A only documents the archive policy. It must not move files.

Future archive root:

`Mingla_Artifacts/archive/`

Future internal categories:

- `outputs_legacy/`
- `handoffs_legacy/`
- `superseded_specs/`
- `superseded_reports/`
- `old_trackers/`
- `migration_history/`
- `generated_or_transient/`

Rules:

1. A file can move to archive only after it has a manifest row.
2. A moved file must leave a breadcrumb in the manifest with old path, new path, reason, and replacement current authority.
3. README may link to archive only through `ARTIFACT_MANIFEST.md`, not directly to random old files.
4. Migration history is preservation material, not junk. `Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/` must be kept and indexed because it proves pre-squash schema history.
5. Deletion requires a separate `DELETE_CANDIDATE_AFTER_LINK_REWRITE` status, green link check for the target, and orchestrator approval in ORCH-0750C.

## 17. Implementation Order

1. Read ORCH-0750 investigation and this spec.
2. Capture current commit: `git rev-parse --short HEAD`.
3. Add `scripts/docs/check_links.py`.
4. Run the checker in report mode and collect counts.
5. Create `Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md`.
6. Create `Mingla_Artifacts/ARTIFACT_MANIFEST.md` with required schema, statuses, and first-pass rows.
7. Add explicit ORCH-0750B and ORCH-0750C deferral sections in the manifest.
8. Run link checker again after manifest creation.
9. Run verification commands listed in this spec.
10. Produce implementation report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750A_ARTIFACT_MANIFEST_LINK_INTEGRITY.md`.

## 18. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
|---|---|---|---|---|---|
| T-0750A-01 | Link checker runs | `python3 scripts/docs/check_links.py` | exits 0 and prints summary | tooling | command output in implementation report |
| T-0750A-02 | Markdown output works | `python3 scripts/docs/check_links.py --format markdown` | markdown table/sections render | tooling | output captured or report generated |
| T-0750A-03 | Strict mode fails when missing links remain | `python3 scripts/docs/check_links.py --max-missing 0` | exits non-zero if missing links > 0 | tooling | command result documented; failure expected until links fixed |
| T-0750A-04 | Top-level artifacts covered | compare `find Mingla_Artifacts -maxdepth 1 -type f -name '*.md'` to manifest rows | every file has row | artifact | command plus spot check |
| T-0750A-05 | Docs roots covered | `docs/`, `outputs/`, `clade transfer/` inventories | every file represented or directory policy row exists where allowed | artifact | command plus manifest refs |
| T-0750A-06 | Deprecated queues classified | inspect `SPEC_QUEUE.md`, `TEST_QUEUE.md`, `RETEST_LEDGER.md` rows | all `ARCHIVE_ONLY`, not active queue | artifact | manifest grep |
| T-0750A-07 | Prompt links classified | link audit report | prompt missing links counted under `PROMPT_PRIVATE_OR_IGNORED` or manifest exception | artifact/tooling | report section |
| T-0750A-08 | No moves/deletes | `git status --short` | no deleted or renamed artifact files | safety | implementation report |
| T-0750A-09 | README not rewritten | `git diff -- README.md app-mobile/README.md mingla-admin/README.md mingla-business/README.md` | no diff | safety | implementation report |
| T-0750A-10 | Product code untouched | `git diff -- app-mobile mingla-admin mingla-business supabase/functions supabase/migrations` | no ORCH-0750A-caused product diff | safety | implementation report, with unrelated pre-existing diffs called out |

## 19. Regression Prevention

- **Structural safeguard:** manifest becomes the authority map for README and archive decisions.
- **Test:** link checker gives reproducible missing-link classes.
- **Protective documentation:** archive policy and prompt-link policy live inside `ARTIFACT_MANIFEST.md`.
- **Artifact update:** implementation report records current counts and deferrals.

## 20. Rollback And Deploy Safety

- **Migration order:** None.
- **Edge function deploy:** None.
- **Mobile OTA/native build:** None.
- **Business/admin web deploy:** None.
- **Env vars/secrets:** None.
- **Partial rollback risk:** low. Revert `ARTIFACT_MANIFEST.md`, `ORCH-0750A_LINK_AUDIT.md`, `check_links.py`, and implementation report if needed. No runtime behavior changes.
- **Dirty worktree warning:** implementation must preserve unrelated current changes, including existing untracked reports/specs and unrelated Supabase work.

## 21. Common Mistakes

1. Moving `outputs/` or `clade transfer/` during ORCH-0750A. Do not.
2. Deleting "old" files because they are ugly. Old can be evidence.
3. Treating `PRODUCT_SNAPSHOT.md` as clean current truth without noting mixed historical sections.
4. Treating missing prompt links as ordinary broken links. Some prompts are intentionally ignored/private; classify them.
5. Rewriting README while building the manifest. That belongs to ORCH-0750B.
6. Creating an archive directory but not moving anything. ORCH-0750A should document the archive policy only; ORCH-0750C will create/use it if approved.
7. Hiding broken links by narrowing scan roots. The report must scan the agreed roots.

## 22. Explicit Deferrals

### ORCH-0750B - README Snapshot Rebuild

Deferred work:

- rebuild root README from live source inventory and manifest;
- fix app READMEs;
- remove stale function/migration lists;
- link README to current artifact authorities.

### ORCH-0750C - Archive and Delete Pass

Deferred work:

- move `outputs/` material into archive;
- move `clade transfer/` material into archive;
- archive old tracker sections;
- delete generated/irrelevant files only after link checks and manifest replacement prove safety.

## 23. Handoff To Implementor

Implement ORCH-0750A as documentation/tooling only. Add the link checker, generate the link audit report, create the artifact manifest, and document all broken-link classes without moving or deleting files. Treat this as the foundation for README/archive work, not the cleanup itself.

Final verdict: **SPEC READY**.
