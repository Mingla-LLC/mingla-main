# SPEC ORCH-0750B - README Snapshot Rebuild

> Date: 2026-05-07  
> Mode: SPEC  
> Source prompt: `Mingla_Artifacts/prompts/SPEC_ORCH-0750B_README_SNAPSHOT_REBUILD.md`  
> Source investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0750_DOCUMENTATION_ARTIFACTS_TOTAL_SWEEP.md`  
> Foundation: `Mingla_Artifacts/ARTIFACT_MANIFEST.md`, `scripts/docs/check_links.py`, `Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md`  
> Verdict: SPEC READY

## 1. Plain-English Impact

Mingla's README should become the front door, not the filing cabinet.

Right now the root README and `app-mobile/README.md` repeat stale numbers and old function names. ORCH-0750A gave us the map and the measuring tool. ORCH-0750B rewrites the README layer so a human can understand the current Mingla ecosystem quickly, then follow links into `Mingla_Artifacts/` for the deeper truth.

This spec does not authorize deleting artifacts, moving old work into an archive, fixing the entire 1,195-link debt, or changing product code.

## 2. Evidence Base

| Evidence | Proven fact | Source |
|---|---|---|
| Root README stale counts | Root README claims 57 edge functions and 288 migrations. Current spec-time scan found 66 function directories including `_shared`, 65 deployable function directories excluding `_shared`, and 26 active migration files. | `README.md`; current `find` scans |
| App README repeats stale counts | `app-mobile/README.md` repeats 57 edge-function claim and lists absent `new-generate-experience-`. | `app-mobile/README.md` |
| Root README omits ecosystem | Root README describes "mobile + admin" and does not frame `mingla-business`, `mingla-marketing`, `scripts`, `tests`, `outputs`, or `Mingla_Artifacts/` as first-class repo areas. | `README.md`; ORCH-0750 F1 |
| Artifact system now has a map | `ARTIFACT_MANIFEST.md` defines current authority, ledgers, archive policy, README surfaces, and private prompt policy. | ORCH-0750A |
| Link debt is measurable | Baseline is 1,195 missing local markdown links. File count drifts as docs are added, but missing count/classification stayed stable in tester run. | ORCH-0750A link audit and test report |
| Prompt files are not durable proof | `Mingla_Artifacts/prompts/` is ignored/private; README must not depend on prompt prose as canonical evidence. | `ARTIFACT_MANIFEST.md`; ORCH-0750A invariants |
| App README policy needed | App READMEs should keep app-specific setup/details and link upward for global architecture truth. | ORCH-0750 F2 |

## 3. Proven Stale Claims And Required Replacement

| Current claim / pattern | Location | Required replacement |
|---|---|---|
| "57 Deno edge functions" | `README.md`, `app-mobile/README.md` | Replace with generated-at-implementation count from command in Section 6. Prefer wording that names command and last synced commit, not a permanent prose promise. |
| "288 SQL migration files" | `README.md` | Replace with generated-at-implementation active migration count and explain post-squash history is preserved in `Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/`. |
| "mobile + admin platform" | `README.md` intro | Replace with ecosystem framing: consumer mobile, organiser/business app, admin dashboard, marketing site, Supabase backend, scripts/tooling, docs/artifacts. |
| Absent `Mingla_Artifacts/` front door | `README.md` support docs section | Add "Mingla Artifact Atlas" or equivalent snapshot card linking to manifest, world map, product snapshot, priority board, decision log, invariant registry, and ORCH-0750A link audit. |
| Absent/dead function names | `README.md` edge function section, `app-mobile/README.md` edge function table | Remove absent names such as `new-generate-experience-`, `discover-experiences`, `get-personalized-cards`, `generate-session-deck`, `warm-cache`, and `places` unless the implementation-time live function list proves they exist. |
| AI model claims as static truth | `README.md`, `app-mobile/README.md` | Either remove model-version specifics from snapshot prose or mark as "see live function/config reports" unless implementation-time code scan proves the exact current model contract. |
| App README global backend inventory | `app-mobile/README.md` | Replace with app-specific setup, commands, architecture pointers, and a link to root README + artifact manifest for global backend counts. |
| Admin/business stale README posture | `mingla-admin/README.md`, `mingla-business/README.md` | Do not rewrite in this ORCH unless orchestrator expands scope. Root README must still link to them as app-local docs with caveat that root snapshot owns global inventory. |
| Missing marketing README | `mingla-marketing/README.md` absent | Do not create in ORCH-0750B unless orchestrator expands scope. Root README should still list `mingla-marketing/` from package/root evidence. |

## 4. Scope

### In Scope

- Rewrite `README.md`.
- Rewrite `app-mobile/README.md`.
- Update `Mingla_Artifacts/ARTIFACT_MANIFEST.md` only if README/app README rows need refreshed `README_surface`, notes, or verification commit.
- Create `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750B_README_SNAPSHOT_REBUILD.md`.
- Keep README as a maintained snapshot linked to artifacts, not a second ledger.

### Out Of Scope

- No product code changes.
- No Supabase function, migration, RLS, trigger, table, seed, or data changes.
- No package dependency changes.
- No archive moves.
- No deletes.
- No mass link repair outside README/app README.
- No rewriting `WORLD_MAP.md`, `PRODUCT_SNAPSHOT.md`, `PRIORITY_BOARD.md`, `AGENT_HANDOFFS.md`, or historical reports beyond optional manifest notes.
- No launch-readiness declaration.
- No creation of `mingla-marketing/README.md`, `mingla-admin/README.md`, or `mingla-business/README.md` unless orchestrator explicitly expands scope later.

## 5. Expected File Change Manifest

| Path | Required? | Purpose |
|---|---:|---|
| `README.md` | Yes | Root ecosystem snapshot and artifact front door. |
| `app-mobile/README.md` | Yes | Consumer app setup/local architecture only; no global backend counts. |
| `Mingla_Artifacts/ARTIFACT_MANIFEST.md` | Optional | Refresh README-surface rows/notes if needed. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750B_README_SNAPSHOT_REBUILD.md` | Yes | Evidence report with command outputs and scope proof. |

Any other changed file is out of scope unless the implementor stops and escalates to orchestrator.

## 6. Required Live Inventory Commands

The implementor must run these from repo root and paste the exact outputs into the implementation report. Use implementation-time results, not the spec-time counts below.

```bash
git rev-parse --short HEAD
git status --short
find supabase/functions -mindepth 1 -maxdepth 1 -type d | sed 's#supabase/functions/##' | sort | wc -l
find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name '_shared' | sed 's#supabase/functions/##' | sort | wc -l
find supabase/functions -mindepth 1 -maxdepth 1 -type d | sed 's#supabase/functions/##' | sort
find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sed 's#supabase/migrations/##' | sort | wc -l
find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sed 's#supabase/migrations/##' | sort
find . -maxdepth 2 -name package.json -not -path './node_modules/*' -print | sort
python3 scripts/docs/check_links.py --format markdown
python3 scripts/docs/check_links.py --max-missing 1195
git diff --name-status -- README.md app-mobile/README.md Mingla_Artifacts/ARTIFACT_MANIFEST.md Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750B_README_SNAPSHOT_REBUILD.md
```

Spec-time evidence on 2026-05-07:

- function directories including `_shared`: 66;
- deployable function directories excluding `_shared`: 65;
- active migration files: 26;
- package roots with package.json: `app-mobile`, `mingla-admin`, `mingla-business`, `mingla-marketing`, `scripts`.

These numbers are evidence, not hardcoded implementation truth. The implementation report must use the new command outputs.

## 7. Root README Content Contract

The new root README must use this structure or a very close equivalent:

1. `# Mingla`
2. One short product sentence.
3. `## Ecosystem Snapshot`
4. `## Source Of Truth`
5. `## Architecture Constitution`
6. `## Repo Map`
7. `## Current Backend Snapshot`
8. `## App Surfaces`
9. `## Local Development`
10. `## Verification And Maintenance`

### Required Content Rules

- Keep the architecture constitution, but shorten or link out if the README becomes too long. If shortened, link to `docs/DOMAIN_ADRS.md`, `docs/IMPLEMENTATION_GATES.md`, `docs/MUTATION_CONTRACT.md`, `docs/QUERY_KEY_REGISTRY.md`, and `docs/TRANSITIONAL_ITEMS_REGISTRY.md`.
- Add a "Mingla Artifact Atlas" snapshot card table:

| Need | Link |
|---|---|
| What is current vs historical? | `Mingla_Artifacts/ARTIFACT_MANIFEST.md` |
| What is the program state? | `Mingla_Artifacts/WORLD_MAP.md` |
| What changed recently? | `Mingla_Artifacts/PRODUCT_SNAPSHOT.md` |
| What is next? | `Mingla_Artifacts/PRIORITY_BOARD.md` |
| What decisions are binding? | `Mingla_Artifacts/DECISION_LOG.md` |
| What rules must hold? | `Mingla_Artifacts/INVARIANT_REGISTRY.md` |
| What link debt exists? | `Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md` |

- Add a `Last Synced` block with:
  - short commit SHA;
  - date;
  - function count command;
  - migration count command;
  - link checker command.
- Represent backend counts as "snapshot at commit X", not timeless claims.
- Make `_shared` function count explicit:
  - total function directories including `_shared`;
  - deployable function directories excluding `_shared`.
- Mention migration squash context:
  - active migrations are the current chain;
  - pre-squash history is preserved in `Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/`.
- List the main repo roots:
  - `app-mobile/`;
  - `mingla-business/`;
  - `mingla-admin/`;
  - `mingla-marketing/`;
  - `supabase/functions/`;
  - `supabase/migrations/`;
  - `scripts/`;
  - `docs/`;
  - `Mingla_Artifacts/`;
  - `outputs/` as historical/supersession material, not current product truth.
- Avoid long hand-maintained edge-function tables. If a few key functions are named, they must be proven present by the live list and framed as examples only.
- Do not link directly to ignored/private prompt files.
- Do not claim all docs are clean. State plainly that link debt remains measured by ORCH-0750A.

## 8. App-Mobile README Content Contract

`app-mobile/README.md` must become an app-local guide, not a duplicate global README.

Required sections:

1. `# Mingla Mobile`
2. What this app does.
3. Local setup.
4. Common commands.
5. App architecture pointers.
6. Environment variables for the mobile app only.
7. Links upward:
   - root `../README.md`;
   - `../Mingla_Artifacts/ARTIFACT_MANIFEST.md`;
   - `../docs/DOMAIN_ADRS.md`;
   - `../docs/IMPLEMENTATION_GATES.md`.

Rules:

- Remove all global edge-function counts from `app-mobile/README.md`.
- Remove dead function names unless live scan proves they exist and the mention is app-specific.
- Do not describe admin/business/marketing details except as links to root README.
- Keep Expo setup, EAS build notes, and mobile-local commands if still true.
- Do not invent feature status. If unsure, link to root snapshot or artifacts.
- If current mobile setup references Expo Go, include the caveat that dev builds may be required for native modules where applicable; do not overpromise Expo Go compatibility.

## 9. Manifest And Link Requirements

- If `ARTIFACT_MANIFEST.md` is updated, keep the existing table schema.
- If README/app README become `root_snapshot` or `app_specific` surfaces in manifest notes, update only the relevant rows.
- Run `python3 scripts/docs/check_links.py --format markdown` after README changes.
- The implementation must not increase missing-link debt above the known baseline unless the only increase is file-count drift with identical missing count/classifications and the report explains it.
- The implementation must also run `python3 scripts/docs/check_links.py --max-missing 1195`.
  - This gate should pass if missing links remain at or below the ORCH-0750A baseline.
  - If it fails because README added missing links, fix the README links.
  - If it fails because unrelated concurrent docs added link debt, stop and escalate to orchestrator with evidence.

## 10. Layer Contract

| Layer | Change |
|---|---|
| Database/RLS/migrations | None. |
| Edge/RPC/webhooks | None. |
| Services/hooks/state/cache | None. |
| Mobile UI/runtime | None. README only. |
| Business/Admin/Marketing runtime | None. Root README may describe these roots from package/tree evidence. |
| Docs/artifacts | Root README, app-mobile README, optional manifest note, implementation report. |
| Tests/tooling | Existing link checker only; no new tooling required. |
| Deploy | None. |

## 11. Implementation Order

1. Read this spec and the ORCH-0750/0750A evidence.
2. Run the inventory commands in Section 6 and save outputs for the report.
3. Draft root README structure using live counts and artifact atlas links.
4. Rewrite `README.md`.
5. Rewrite `app-mobile/README.md` to remove duplicated global inventory.
6. Optionally update `ARTIFACT_MANIFEST.md` only for README-surface metadata.
7. Run link checker markdown mode.
8. Run link checker threshold gate with `--max-missing 1195`.
9. Verify no out-of-scope files changed.
10. Write implementation report.

## 12. Success Criteria

| ID | Criterion | Verification |
|---|---|---|
| SC-1 | Root README no longer contains `57 Deno edge functions`. | `rg -n "57 Deno|57 edge" README.md app-mobile/README.md` returns no stale count hits. |
| SC-2 | Root README no longer contains `288 SQL migration`. | `rg -n "288 SQL|288 migration" README.md app-mobile/README.md` returns no hits. |
| SC-3 | Root/app README no longer cite absent dead functions. | `rg -n "new-generate-experience-|discover-experiences|get-personalized-cards|generate-session-deck|warm-cache|\\bplaces\\b" README.md app-mobile/README.md`; each hit must either be removed or explicitly justified by live function list. |
| SC-4 | Root README includes artifact atlas links. | Grep for manifest, world map, product snapshot, priority board, decision log, invariant registry, link audit. |
| SC-5 | Root README includes `Last Synced` or equivalent snapshot block. | Manual read plus command outputs in report. |
| SC-6 | App README no longer duplicates global function/migration counts. | Grep and manual read. |
| SC-7 | Link checker threshold gate passes at baseline. | `python3 scripts/docs/check_links.py --max-missing 1195` exits 0. |
| SC-8 | No product/runtime files changed. | `git diff --name-only` limited to expected manifest. |
| SC-9 | Implementation report records exact live inventory outputs. | Report inspection. |
| SC-10 | No archive moves/deletes occurred. | `git status --short` has no ORCH-0750B D/R entries. |

## 13. Tester Verification Matrix

The tester must independently run:

```bash
rg -n "57 Deno|57 edge|288 SQL|288 migration" README.md app-mobile/README.md
rg -n "new-generate-experience-|discover-experiences|get-personalized-cards|generate-session-deck|warm-cache|\\bplaces\\b" README.md app-mobile/README.md
python3 scripts/docs/check_links.py --format markdown
python3 scripts/docs/check_links.py --max-missing 1195
git diff --name-status -- README.md app-mobile/README.md Mingla_Artifacts/ARTIFACT_MANIFEST.md
git diff --name-only
```

Tester must also manually verify:

- root README reads as current ecosystem snapshot, not exhaustive ledger;
- root README links into artifact truth instead of copying long operational history;
- app-mobile README is app-local and points up to root/artifacts;
- README does not depend on prompt files;
- all changed links are repo-local valid or external URLs;
- no product code, migrations, edge functions, package files, or app runtime docs outside scope changed.

## 14. Risks And Caveats

- Counts can change quickly while other cycles add migrations/functions. This is why README must include last-synced metadata and command provenance.
- Link checker file count will drift as new reports/prompts are created. Missing count/classifications matter more than file count.
- The root README may still link to artifacts that themselves contain historical broken links. That is acceptable in ORCH-0750B if the README links are valid and the debt is acknowledged.
- `mingla-admin/README.md` and `mingla-business/README.md` remain imperfect. This spec intentionally avoids expanding scope beyond root README and mobile README.
- `mingla-marketing/` has no README at spec time. Creating one is a separate decision.

## 15. Future ORCH-0750C Handoff Notes

After ORCH-0750B passes, orchestrator should dispatch ORCH-0750C for archive/delete architecture. ORCH-0750C should address:

- `outputs/` legacy B2 material;
- `clade transfer/` handoff preservation;
- deprecated queues (`SPEC_QUEUE.md`, `TEST_QUEUE.md`, `RETEST_LEDGER.md`);
- old operational alert blocks inside tracker documents;
- whether future prompts are versioned or treated as private dispatch packets;
- first focused link-debt burn-down targets: `AGENT_HANDOFFS.md`, `MASTER_BUG_LIST.md`, and `WORLD_MAP.md`.

## 16. Hard Stops

Implementor must stop and return to orchestrator if:

- live inventory commands contradict this spec in a way that changes scope;
- README rewrite requires moving/deleting artifacts;
- link checker missing count increases above 1,195 from README changes;
- any product/runtime file needs editing to make a README claim true;
- branch/main divergence must be resolved before touching docs;
- required source artifacts are missing.

## 17. Production Readiness

This is documentation-only and has no runtime deploy. It is production-ready only when tester verifies the README snapshot is accurate, links are valid, no product code changed, and the known link debt did not increase.

