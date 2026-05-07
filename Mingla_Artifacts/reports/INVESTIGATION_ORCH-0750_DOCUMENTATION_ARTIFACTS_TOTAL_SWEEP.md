# INVESTIGATION ORCH-0750 - Documentation and Artifact Total Sweep

**Date:** 2026-05-07  
**Mode:** forensic-mingla  
**Scope:** root README, workspace READMEs, `docs/`, `Mingla_Artifacts/`, `outputs/`, `clade transfer/`, git history, branch/main drift, artifact link integrity, source-of-truth readiness.  
**Non-goals:** no deletion, no archive moves, no README rewrite in this investigation. This report locks evidence and defines the cleanup contract.

## Executive Verdict

**Status: FAIL - documentation truth system is not currently trustworthy.**

The repo has enough high-quality artifact material to document Mingla well, but the material is not governed. The root README and app READMEs are stale against the live tree; the top-level artifact trackers mix current close banners with old launch-readiness blocks; historical reports, handoffs, prompts, and external transfer files are spread across multiple roots without a manifest; and 1,195 local markdown links point at paths absent from this working tree.

The right cleanup is not "delete old docs." The right cleanup is:

1. Freeze the artifact authority model.
2. Build a manifest/index that classifies every artifact as current, historical, superseded, archive-only, or delete-candidate.
3. Rebuild README as a generated/maintained snapshot of that manifest and the live source tree.
4. Archive or delete only after link rewrite, supersession headers, and source-of-truth replacement are complete.

## Evidence Commands

Commands run from `/Users/sethogieva/Desktop/mingla-main`.

| Evidence | Result |
|---|---|
| `git fetch --all --prune` | `origin/main` advanced from `f68afed4` to `24a3458d` |
| `git rev-parse HEAD origin/Seth origin/main $(git merge-base HEAD origin/main)` | `HEAD` and `origin/Seth` = `8168cf16`; `origin/main` = `24a3458d`; merge-base = `f68afed4` |
| `git rev-list --left-right --count HEAD...origin/main` | branch is `97` ahead, `1` behind |
| `git diff --stat origin/main...HEAD` | 209 files changed, 34,629 insertions, 1,116 deletions |
| doc count | 494 `.md/.mdx/.txt` docs excluding `node_modules` and generated `.expo` caches |
| artifact count | `Mingla_Artifacts` has 878 files; 207 reports; 66 specs; 23 prompts |
| live Supabase functions | 66 function directories |
| live Supabase migrations | 25 SQL migration files |
| package roots | `app-mobile`, `mingla-admin`, `mingla-business`, `mingla-marketing`, `scripts` |
| markdown link audit | 396 files checked; 1,195 missing local links |

## Finding F1 - Root README Is Stale on Main and Current Branch

**Classification:** confirmed documentation defect  
**Severity:** S1 for operator trust, S2 for runtime risk  
**Confidence:** High  
**Primary files:** `README.md`, `supabase/functions/`, `supabase/migrations/`

The root README describes an older Mingla surface. It is identical in the audited sections on current branch and refreshed `origin/main`, so the problem is not just local branch drift.

Evidence:

- `README.md:5` describes "mobile + admin" but omits `mingla-business`, `mingla-marketing`, `scripts`, `tests`, and `Mingla_Artifacts`.
- `README.md:17`, `README.md:183`, and `README.md:319` claim **57** Deno edge functions. The live tree has **66** function directories.
- `README.md:189` claims **288** SQL migration files. The live tree has **25** active migrations after the ORCH-0729 squash.
- `README.md:323`, `325`, `340`, `343`, `382`, and `385` list or reference functions not present in the live function directory list: `discover-experiences`, `get-personalized-cards`, `generate-session-deck`, `new-generate-experience-`, `warm-cache`, and `places`.
- `README.md:75` tells users docs live in `docs/` but does not introduce `Mingla_Artifacts/`, even though 363 docs live there and the current operating system depends on them.

Root cause:

The README is manually curated prose while the ecosystem changed through artifact-driven execution. No manifest or generation step reconciles README claims against the live tree.

Required action:

Replace the README's static inventory sections with a snapshot sourced from:

- live repo scanners for packages, functions, migrations, and test/workflow surfaces;
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md` for current artifacts;
- a small "last synced" block with the commit SHA and scanner command.

## Finding F2 - App READMEs Are Also Stale

**Classification:** confirmed documentation defect  
**Severity:** S2  
**Confidence:** High

Evidence:

- `app-mobile/README.md:3`, `13`, and `57` repeat the stale **57 edge functions** claim.
- `app-mobile/README.md:96` still describes `new-generate-experience-`, which is absent from the live function tree.
- `mingla-admin/README.md` was last touched on 2026-03-17 and describes the admin app as a mobile-app companion, not the current multi-app ecosystem with business and marketing surfaces.
- `mingla-business/README.md` is only 50 lines and has no meaningful ecosystem map despite `mingla-business` being one of the most active current product surfaces.

Required action:

Each app README should be reduced to app-specific setup, architecture, and commands, then link upward to the root README snapshot and artifact manifest. Do not duplicate function counts or migration counts in app READMEs.

## Finding F3 - Active Artifact Trackers Are Mixed-Truth Documents

**Classification:** confirmed process defect  
**Severity:** S1  
**Confidence:** High  
**Primary files:** `Mingla_Artifacts/PRIORITY_BOARD.md`, `PRODUCT_SNAPSHOT.md`, `OPEN_INVESTIGATIONS.md`, `AGENT_HANDOFFS.md`

The tracker set contains valuable live close notes, but it also contains old readiness tables and stale queue structures. That makes "current state" impossible to infer safely.

Evidence:

- `Mingla_Artifacts/PRIORITY_BOARD.md` starts with 2026-05-06 close banners, but lower sections retain an old "Top 20" board from 2026-04-19 with ORCH-0644/0643/0336-era priorities.
- `Mingla_Artifacts/PRODUCT_SNAPSHOT.md` starts with 2026-05 close banners, then still declares `Last updated: 2026-04-18` and contains old operational alerts plus an old launch-readiness summary.
- `Mingla_Artifacts/SPEC_QUEUE.md`, `TEST_QUEUE.md`, and `RETEST_LEDGER.md` explicitly say they are deprecated as of 2026-04-11 and superseded by `AGENT_HANDOFFS.md`.
- There is no top-level `IMPLEMENTATION_QUEUE.md`; any prior queue model that expects it is obsolete.
- `AGENT_HANDOFFS.md` has 225 missing local links in the link audit, mostly prompt/report handoff paths that are not present in this working tree.

Root cause:

Close protocol appends current state to living trackers, but old sections are not retired, summarized, or superseded. The document becomes both ledger and dashboard, which breaks both roles.

Required action:

Split artifact authority:

- `PRODUCT_SNAPSHOT.md`: current state only; no historical operational alert backlog.
- `PRIORITY_BOARD.md`: current ranked backlog only; old Top 20 tables moved to archive/history.
- `AGENT_HANDOFFS.md`: pipeline ledger only; every row must link to present artifacts or explicitly mark missing/private prompt.
- `ARTIFACT_MANIFEST.md`: canonical index used by README.

## Finding F4 - Artifact Volume Has No Manifest, Supersession Graph, or Archive Boundary

**Classification:** confirmed source-of-truth gap  
**Severity:** S1  
**Confidence:** High

Inventory:

- `Mingla_Artifacts`: 878 files
- `Mingla_Artifacts/reports`: 207 files
- `Mingla_Artifacts/specs`: 66 files
- `Mingla_Artifacts/prompts`: 23 files, ignored by git as a directory
- `outputs`: 10 files
- `clade transfer`: 5 files
- `docs`: 10 files

Evidence:

- B2/B2a Path C has reports/specs in both `outputs/` and `Mingla_Artifacts/`.
- `outputs/SPEC_B2_PATH_C_AMENDMENT.md` and `outputs/SPEC_B2_PATH_C_V2.md` are correctly marked superseded by V3, but they remain in a root-level transfer directory with no archive policy.
- `clade transfer/` contains valuable handoffs such as ORCH-0737 v6 and B2a Stripe Connect, but the directory name and placement imply temporary transfer material, not permanent source-of-truth material.
- `Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/` is a necessary historical archive after the migration squash. It should be preserved, not swept as clutter.

Root cause:

The artifact system grew organically from execution. It has rigorous individual reports but no repo-level catalog.

Required action:

Create `Mingla_Artifacts/ARTIFACT_MANIFEST.md` with columns:

`artifact_id`, `path`, `kind`, `domain`, `status`, `supersedes`, `superseded_by`, `current_authority`, `archive_policy`, `last_verified_commit`, `README_surface`.

Valid statuses:

- `CURRENT_AUTHORITY`
- `CURRENT_LEDGER`
- `HISTORICAL_AUTHORITY`
- `SUPERSEDED_KEEP`
- `ARCHIVE_ONLY`
- `DELETE_CANDIDATE_AFTER_LINK_REWRITE`
- `GENERATED_IGNORE`

## Finding F5 - Markdown Link Integrity Is Below Cleanup Threshold

**Classification:** confirmed documentation infrastructure defect  
**Severity:** S1  
**Confidence:** High

Link audit result:

- 396 markdown/text files checked.
- 1,195 local markdown links resolved to absent paths.

Top missing-link sources:

| Missing links | Source |
|---:|---|
| 225 | `Mingla_Artifacts/AGENT_HANDOFFS.md` |
| 199 | `Mingla_Artifacts/MASTER_BUG_LIST.md` |
| 172 | `Mingla_Artifacts/WORLD_MAP.md` |
| 80 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0670_RENDERED_SURFACE_AUDIT.md` |
| 57 | `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` |
| 28 | `Mingla_Artifacts/PRIORITY_BOARD.md` |

Important nuance:

Many missing links point to prompt files. `Mingla_Artifacts/prompts/` is ignored by git, so some links may be valid only on one machine/session. That is still a forensic defect if README is expected to sync from artifacts, because a README snapshot cannot depend on non-versioned prompt paths.

Required action:

Before deleting any artifact:

1. Add a markdown link checker script or CI gate.
2. Resolve prompt links by either versioning required prompts, replacing them with report/spec links, or marking them `PRIVATE_PROMPT_NOT_VERSIONED`.
3. Rewrite links before moving files.
4. Only then delete candidates.

## Finding F6 - Branch/Main State Must Be Resolved Before Documentation Cleanup Lands

**Classification:** confirmed merge-risk  
**Severity:** S1  
**Confidence:** High

Evidence:

- Current branch `Seth` is at `8168cf16`.
- `origin/Seth` is also `8168cf16`.
- Refreshed `origin/main` is `24a3458d`.
- Merge-base is `f68afed4`.
- Current branch is `97` ahead and `1` behind `origin/main`.
- `origin/main` has new close/artifact commits after the merge-base, including ORCH-0743/0742/0737 close material.

Required action:

Do not perform mass doc cleanup until the branch integrates the `origin/main` delta or the cleanup branch is explicitly based on the intended target. Otherwise the README and artifact manifest can be born stale.

## Finding F7 - ORCH-0390 Was a Real Prior Cleanup, But Its Model Did Not Survive

**Classification:** historical recurrence  
**Severity:** S2  
**Confidence:** High

Evidence from git history:

- `9f56e900 chore: remove dead code - 17 files, 4 exports, 4 edge functions, 3 RPCs (ORCH-0390)`
- `7c3867cc docs: documentation truth sweep - fix READMEs, sync artifacts, map analytics architecture (ORCH-0390)`

The prior truth sweep was useful but not structurally enforced. The current README again has stale function and migration counts, and artifact trackers again mix current/historical state.

Required action:

ORCH-0750 must not be a one-time prose sweep. It needs a manifest, scanner, link checker, and README snapshot rule.

## Deletion and Archive Classification

No files should be deleted directly from this report. Deletion requires a follow-up implementation spec and a link-rewrite pass.

### Preserve as Current or Current-Ledger

- `Mingla_Artifacts/OPEN_INVESTIGATIONS.md`
- `Mingla_Artifacts/AGENT_HANDOFFS.md`
- `Mingla_Artifacts/DECISION_LOG.md`
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md`
- `Mingla_Artifacts/COVERAGE_MAP.md`
- `Mingla_Artifacts/MASTER_BUG_LIST.md`
- latest investigation/spec/implementation/QA reports for active ORCH/Biz cycles

Required condition: each must declare whether it is dashboard, ledger, or archive. Mixed roles must be split.

### Preserve as Historical Archive

- `Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/`
- `Mingla_Artifacts/backups/`
- superseded but decision-bearing specs and reports
- B2/B2a V1/V2/V3 artifacts after manifest classification

Reason: these are evidence chains and rollback/history material. They are clutter only because they lack an archive index.

### Move/Archive Candidates

- `outputs/` B2 Path C stack
- `clade transfer/` handoffs
- deprecated queue files: `SPEC_QUEUE.md`, `TEST_QUEUE.md`, `RETEST_LEDGER.md`
- old operational alert blocks inside `PRODUCT_SNAPSHOT.md`
- old Top 20 blocks inside `PRIORITY_BOARD.md`

Recommended archive target:

- `Mingla_Artifacts/archive/outputs_legacy/`
- `Mingla_Artifacts/archive/handoffs_legacy/`
- `Mingla_Artifacts/archive/trackers_legacy/`

Do this only after manifest entries and link rewrites.

### Delete Candidates After Proof

- generated `.expo/README.md` and `.vercel/README.txt` files if not intentionally tracked
- built assets under `mingla-admin/dist/` that are currently ignored but present in the working tree
- duplicate prompt copies if the manifest points at a versioned canonical report/spec instead

Deletion blocker: current link audit and ignored-file inventory must be green first.

## README Sync Design

The root README should become a snapshot, not a second source of truth.

Recommended sections:

1. **What Mingla Is Now** - one paragraph covering mobile, business, admin, marketing, Supabase, artifacts.
2. **Current Ecosystem Snapshot** - generated table:
   - app roots
   - functions count
   - migrations count
   - active artifact authorities
   - last verified commit
3. **Start Here** - links to app READMEs and setup docs.
4. **Artifact Map** - links to manifest, product snapshot, priority board, open investigations, handoffs, decisions, invariants, root causes.
5. **Live Source Inventory** - generated or command-backed, not hand-maintained.
6. **Historical Archives** - clear distinction between archive material and current guidance.

Minimum sync rule:

```sh
find supabase/functions -mindepth 1 -maxdepth 1 -type d | wc -l
find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l
find . -name package.json -not -path './node_modules/*' -not -path '*/node_modules/*'
```

The README must state the exact command or script used to refresh its snapshot.

## Required Follow-Up Work

### SPEC ORCH-0750A - Artifact Manifest and Link Integrity

Scope:

- create `Mingla_Artifacts/ARTIFACT_MANIFEST.md`;
- classify all current top-level artifacts, all reports/specs, `outputs/`, `clade transfer/`, and docs;
- add a link-check script;
- produce a missing-link fix plan;
- no README rewrite yet except adding a short "manifest under construction" pointer if needed.

Acceptance criteria:

- all top-level artifacts classified;
- all archive/delete candidates have a reason and replacement link;
- prompt links either exist, are versioned, or are explicitly marked non-versioned;
- link audit count reduced or every remaining missing link is explained.

### SPEC ORCH-0750B - README Snapshot Rebuild

Scope:

- rebuild root README from manifest and live source inventory;
- remove stale function/migration inventories;
- link root README to artifact authorities creatively but concretely;
- reduce app READMEs to app-specific setup and architecture.

Acceptance criteria:

- README says 66 functions and 25 migrations unless source counts changed at implementation time;
- README includes `mingla-business`, `mingla-marketing`, `Mingla_Artifacts`, `docs`, `scripts`, `tests`;
- no function listed in README is absent from `supabase/functions/`;
- README links to the manifest and current artifact dashboards.

### SPEC ORCH-0750C - Archive and Delete Pass

Scope:

- move legacy `outputs/` and `clade transfer/` material into archive;
- archive deprecated queue docs or fold their deprecation notices into the manifest;
- delete generated/irrelevant files only after green link check and gitignore confirmation.

Acceptance criteria:

- zero broken links caused by moves;
- every archived artifact keeps a breadcrumb;
- no current artifact loses history.

## Final Classification

| Area | Verdict | Action |
|---|---|---|
| Root README | stale, not authoritative | rebuild from manifest and live scanners |
| App READMEs | stale/misaligned | slim down and link to root snapshot |
| `Mingla_Artifacts` | valuable but ungoverned | manifest first |
| `PRODUCT_SNAPSHOT.md` | mixed current/history | split dashboard from history |
| `PRIORITY_BOARD.md` | mixed current/history | rebuild current board, archive old board |
| `AGENT_HANDOFFS.md` | valuable but link-broken | repair links and classify prompts |
| `outputs/` | historical transfer artifacts | archive after manifest |
| `clade transfer/` | historical handoffs | archive after manifest |
| migration archive | preserve | index as historical authority |
| deprecated queues | preserve/archive | superseded by handoffs; do not use as active queues |

## Investigation Close

ORCH-0750 should proceed as a project, not a one-shot cleanup. The next safe move is `ORCH-0750A` manifest + link integrity. After that, README can become a creative, accurate front door into Mingla's artifacts instead of another stale document competing with them.
