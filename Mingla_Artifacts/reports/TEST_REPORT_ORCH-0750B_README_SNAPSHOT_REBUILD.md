# QA Report: README Snapshot Rebuild (ORCH-0750B)

> Date: 2026-05-07  
> Mode: TARGETED / SPEC-COMPLIANCE  
> Verdict: PASS  
> Findings: P0:0 P1:0 P2:0 P3:0 P4:2

## 1. Layman Summary

PASS. The root README is no longer pretending to be the whole source of truth. It now works as a current snapshot and points into `Mingla_Artifacts/` for durable program state. The mobile README is now app-local and no longer repeats global backend inventory.

No stale 57-edge-function claim, no stale 288-migration claim, no dead function references, no new link debt, no archive moves, and no ORCH-0750B runtime/product edits were found.

## 2. Inputs Reviewed

- Tester prompt: `Mingla_Artifacts/prompts/TESTER_ORCH-0750B_README_SNAPSHOT_REBUILD.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0750B_README_SNAPSHOT_REBUILD.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750B_README_SNAPSHOT_REBUILD.md`
- Root README: `README.md`
- Mobile README: `app-mobile/README.md`
- Link checker: `scripts/docs/check_links.py`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | None | Confirmed no DB/RLS/migration change belongs to ORCH-0750B. |
| Edge/RPC/Webhooks | None | Confirmed no function change belongs to ORCH-0750B. |
| Services | None | N/A for docs-only gate. |
| Hooks/State/Cache | None | N/A for docs-only gate. |
| Components/Screens | `README.md`, `app-mobile/README.md` | Checked stale claims, source-of-truth posture, app-local boundary, snapshot provenance. |
| Business/Admin/Public | Root README references `mingla-business/`, `mingla-admin/`, `mingla-marketing/` | Checked they are framed as surfaces, not rewritten or overclaimed. |
| Tests/Build | `scripts/docs/check_links.py` | Ran markdown audit and baseline gate. |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Root README is an ecosystem snapshot | `README.md:5-15`, `README.md:17-31`, `README.md:77-111` | verified | It frames all major surfaces and says README is a snapshot, not the whole truth system. |
| Root README links to artifact truth | `README.md:23-29` | verified | Manifest, world map, product snapshot, priority board, decision log, invariant registry, and link audit all present. |
| Root README has sync provenance | `README.md:33-46` | verified | Date, commit, function/migration counts, and link checker commands present. |
| Backend counts are current snapshot, not timeless truth | `README.md:37-46`, `README.md:98-100`; independent count commands | verified | Independent counts matched: 66 including `_shared`, 65 excluding `_shared`, 26 active migrations. |
| Mobile README is app-local | `app-mobile/README.md:1-15`, `app-mobile/README.md:106-116` | verified | It points upward for global truth and says not to duplicate global backend counts. |
| No prompt files are used as README evidence | `rg` prompt scan on README files | verified | No hits for `prompts/` or `Mingla_Artifacts/prompts` in README surfaces. |
| Implementation did not increase link debt | Link checker output | verified | 425 files checked, 2,392 links, 1,195 missing. Missing count remains at baseline. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Stale count grep | `rg -n "57 Deno|57 edge|288 SQL|288 migration" README.md app-mobile/README.md` | PASS, exit 1/no output | No stale count hit. |
| Dead function grep | `rg -n "new-generate-experience-|discover-experiences|get-personalized-cards|generate-session-deck|warm-cache|\\bplaces\\b" README.md app-mobile/README.md` | PASS, exit 1/no output | No dead function hit. |
| Link checker markdown | `python3 scripts/docs/check_links.py --format markdown` | PASS | 425 files, 2,392 links, 1,195 missing. |
| Link baseline gate | `python3 scripts/docs/check_links.py --max-missing 1195` | PASS | 425 files, 2,392 links, 1,195 missing. |
| Expected README diff | `git diff --name-status -- README.md app-mobile/README.md Mingla_Artifacts/ARTIFACT_MANIFEST.md` | PASS | Only `README.md` and `app-mobile/README.md` are tracked diffs among that set. |
| Dirty worktree review | `git diff --name-only`; `git status --short` | PASS with caveat | Many unrelated dirty files exist; ORCH-0750B README scope remains identifiable. |
| Live inventory count | `find supabase/functions...`; `find supabase/migrations...`; package-root scan | PASS | Counts match implementation report: 66 / 65 / 26 and five package roots. |
| Archive/delete scan | `git status --short | rg "^( D|D |R | R|\\?\\?)"` | PASS with caveat | No D/R entries. Untracked files are expected artifacts from current ORCHs. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | N/A | Docs-only change. |
| One owner per truth | PASS | `README.md:17-31` makes README a snapshot and artifact docs the deeper truth. |
| No silent failures | N/A | Docs-only change. |
| One key per entity | N/A | No query/cache change. |
| Server state server-side | N/A | No state change. |
| Logout clears everything | N/A | No auth/state change. |
| Label temporary | PASS | `README.md:31` states docs are not fully clean and archive/delete must go through manifest. |
| Subtract before adding | PASS | Stale README claims were removed instead of duplicated with new claims. |
| No fabricated data | PASS | Snapshot counts are command-backed and marked as commit-scoped. |
| Currency-aware | N/A | No price UI. |
| One auth instance | N/A | No auth change. |
| Validate at right time | N/A | No scheduling/time validation change. |
| Exclusion consistency | N/A | No serving logic change. |
| Persisted-state startup | N/A | No runtime state change. |

## 7. Findings

### P0 Critical

None.

### P1 High

None.

### P2 Medium

None.

### P3 Low

None.

### P4 Notes

**P4-001: Link checker file-count drift is expected and non-blocking.**
- Evidence: audit now checks 425 files versus implementor report's post-report 424 count.
- Impact: no missing-link increase; missing count remains 1,195.

**P4-002: Worktree is heavily dirty from other ORCHs.**
- Evidence: `git status --short` shows unrelated app-mobile, Supabase, and artifact files.
- Impact: not an ORCH-0750B failure. Orchestrator should keep scope labels clear during close/commit planning.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| SC-1 no stale `57` edge-function claim | PASS | Stale count grep exit 1/no output | None |
| SC-2 no stale `288` migration claim | PASS | Stale count grep exit 1/no output | None |
| SC-3 no dead function references | PASS | Dead function grep exit 1/no output | None |
| SC-4 artifact atlas present | PASS | `README.md:23-29` | None |
| SC-5 snapshot provenance present | PASS | `README.md:33-46` | None |
| SC-6 app README mobile-local | PASS | `app-mobile/README.md:5`, `app-mobile/README.md:106-116` | None |
| SC-7 link checker threshold passes | PASS | `--max-missing 1195` exits 0 | None |
| SC-8 missing-link count not above 1,195 | PASS | 1,195 missing | None |
| SC-9 no ORCH-0750B product/runtime edits | PASS | expected README diff plus status caveat | None |
| SC-10 no archive moves/deletes | PASS | no D/R entries | None |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| Secret exposure in README surfaces | N/A | Mobile README lists public env var names only; no secret values. | PASS |
| Auth/RLS/payment impact | N/A | Docs-only change. | PASS |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| README reader experience | Snapshot posture and artifact routing | N/A | PASS. Clear, short, and explicit about remaining debt. |
| App-mobile README reader experience | App-local boundary and setup commands | N/A | PASS. It no longer competes with root README for global truth. |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | Yes | PASS | `app-mobile/README.md` app-local. |
| Business | Yes | PASS | Root README lists surface without rewriting it. |
| Admin | Yes | PASS | Root README lists surface without rewriting it. |
| Public/web | Yes | PASS | Root README lists marketing surface without inventing a README. |
| Solo | N/A | PASS | Docs-only. |
| Collab | N/A | PASS | Docs-only. |
| iOS | N/A | PASS | Docs-only. |
| Android | N/A | PASS | Docs-only. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| Root README rewrite | Docs only | Docs only | Docs only | None | None | PASS |
| App-mobile README rewrite | Docs only | None | None | None | None | PASS |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Deploy requirement | Report and diff review | No deploy required | None |
| Runtime behavior | Scope review | No runtime behavior changed | None |
| Link baseline | Link checker | PASS | None |

## 14. Required Actions

None.

## 15. Conditional / Recommended Actions

1. Keep ORCH-0750C separate. Archive/delete work should not be bundled into ORCH-0750B close.
2. When committing, separate ORCH-0750B docs changes from unrelated product/runtime dirty files if possible.

## 16. Discoveries For Orchestrator

- None requiring rework.
- Carry forward known debt: 1,195 broken local markdown links remain intentionally unresolved by ORCH-0750B.

## 17. Retest Notes

Retest cycle: N/A.

Close recommendation: ORCH-0750B is ready for orchestrator close as PASS evidence.
