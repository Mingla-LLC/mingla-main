# IMPLEMENTATION REPORT — META-ORCH-0744-PROCESS

**Status:** implemented, partially verified  
**Date:** 2026-05-07  
**Implementor:** Codex `$implementor-mingla`  
**Spec:** `Mingla_Artifacts/specs/SPEC_META_ORCH_0744_PROCESS_HARDENING.md`  

## 1. Scope Executed

Implemented the patched approved SPEC for META-ORCH-0744-PROCESS:

- M-1 `I-PROPOSED-K` require-cycle baseline gate.
- M-2 `I-PROPOSED-L` CLOSE Step 1.5 DIAG-marker reaping process invariant.
- M-3 `I-PROPOSED-M` persist-key whitelist sync gate.
- M-4 `I-PROPOSED-N` TRANSITIONAL exit-condition baseline gate.
- M-5 `I-PROPOSED-X` web-export deprecation parser gate.
- Step 7.3 reaper comment corrected from `I-PROPOSED-L` to `I-PROPOSED-M`.

No DB, RLS, edge-function, mobile bundle, product UI, or native changes were made for this implementation.

## 2. Files Changed

- `.github/scripts/strict-grep/i-proposed-k-require-cycles.mjs`
- `.github/scripts/strict-grep/i-proposed-m-persist-key-whitelist.mjs`
- `.github/scripts/strict-grep/i-proposed-n-transitional-exit-condition.mjs`
- `.github/scripts/strict-grep/i-proposed-x-web-deprecation.mjs`
- `.github/workflows/strict-grep-mingla-business.yml`
- `.github/scripts/strict-grep/README.md`
- `mingla-business/.metro-cycle-baseline.txt`
- `Mingla_Artifacts/.transitional-baseline.txt`
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- `.claude/skills/mingla-orchestrator/SKILL.md`
- `mingla-business/src/utils/reapOrphanStorageKeys.ts`
- `Mingla_Artifacts/reports/IMPLEMENTATION_META_ORCH_0744_PROCESS_REPORT.md`

## 3. Pre-Flight Findings

- Worktree had unrelated in-flight changes before implementation; those were not reverted or edited.
- The user explicitly authorized editing `.claude/skills/mingla-orchestrator/SKILL.md` for this SPEC only. No other `.claude/skills/` file was touched.
- `madge` found 14 circular dependencies at IMPL time, matching SPEC count.
- M-4 live line-number reality drifted from the SPEC's stale 9-entry inventory. Using the SPEC's own 5-line keyword rule, current live code has 4 no-exit-condition violators:
  - `mingla-business/src/components/event/PublicEventPage.tsx:168`
  - `mingla-business/src/hooks/useCurrentBrandRole.ts:158`
  - `mingla-business/src/services/eventChangeNotifier.ts:152`
  - `mingla-business/src/utils/guestCsvExport.ts:300`
- M-1 baseline corrected one stale SPEC path: live madge reports `src/utils/liveEventConverter.ts`, not `src/store/liveEventConverter.ts`.

## 4. Implementation Notes

- M-1 script compares normalized madge output against `mingla-business/.metro-cycle-baseline.txt`.
- M-3 script strips `//` and `/* */` comments before scanning `name:` literals.
- M-4 script warns for baseline violators and fails only on new unqualified `[TRANSITIONAL]` markers.
- M-5 script parses captured stderr from `expo export -p web`, failing on shadow/textShadow/elevation warnings and source-owned `Property '<X>' doesn't exist` errors.
- Workflow now has four new CI jobs for K/M/N/X. L is process-only and documented in the workflow header and README with no script.

## 5. Old-to-New Receipts

- `I-PROPOSED-L (PERSIST-KEY-WHITELIST-SYNC)` comment in `reapOrphanStorageKeys.ts` is now `I-PROPOSED-M (PERSIST-KEY-WHITELIST-SYNC)`.
- No `I-PROPOSED-W` web-export gate was created. M-5 uses `I-PROPOSED-X`.
- `.claude/skills/mingla-orchestrator/SKILL.md` now includes `Step 1.5 — DIAG-marker reaping` between CLOSE Step 1 and Step 2.
- `INVARIANT_REGISTRY.md` now includes DRAFT entries for K, L, M, N, X.

## 6. Verification Evidence

### Clean Passes

```bash
/opt/homebrew/bin/node .github/scripts/strict-grep/i-proposed-k-require-cycles.mjs
```
Result: exit 0 — `[I-PROPOSED-K] PASS — 14 cycle(s) match baseline. Zero new cycles introduced.`

```bash
/opt/homebrew/bin/node .github/scripts/strict-grep/i-proposed-m-persist-key-whitelist.mjs
```
Result: exit 0 — `[I-PROPOSED-M] PASS — 11 persist key(s) match 11 whitelist entry(ies) exactly.`

```bash
/opt/homebrew/bin/node .github/scripts/strict-grep/i-proposed-n-transitional-exit-condition.mjs
```
Result: exit 0 — warns on 4 baselined violators, then `[I-PROPOSED-N] PASS-with-baseline — 4 known violator(s); zero new ones added.`

```bash
cd mingla-business
EXPO_PUBLIC_SUPABASE_URL=https://stub.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=stub_key /opt/homebrew/bin/npx expo export -p web 2>/tmp/expo-export-web.stderr
/opt/homebrew/bin/node ../.github/scripts/strict-grep/i-proposed-x-web-deprecation.mjs /tmp/expo-export-web.stderr
```
Result: export exit 0; parser exit 0 — `[I-PROPOSED-X] PASS — zero web-deprecation warnings.`

```bash
/opt/homebrew/bin/node --check .github/scripts/strict-grep/i-proposed-k-require-cycles.mjs
/opt/homebrew/bin/node --check .github/scripts/strict-grep/i-proposed-m-persist-key-whitelist.mjs
/opt/homebrew/bin/node --check .github/scripts/strict-grep/i-proposed-n-transitional-exit-condition.mjs
/opt/homebrew/bin/node --check .github/scripts/strict-grep/i-proposed-x-web-deprecation.mjs
```
Result: all exit 0.

### Deliberate-Fail Fixtures

M-1 fixture: temporarily added `mingla-business/src/__metaCycleA.ts` and `__metaCycleB.ts` importing each other.  
Result: exit 1 — `FAIL — 1 NEW require-cycle(s)` and listed `src/__metaCycleA.ts | src/__metaCycleB.ts`. Fixture removed.

M-3 mismatch fixture: temporarily changed `currentBrandStore.ts` persist name from `v14` to `v15`.  
Result: exit 1 — missing key named `mingla-business.currentBrand.v15`. Fixture reverted.

M-3 comment fixture: temporarily added `// name: "mingla-business.commentOnly.v1"` to a store file.  
Result: exit 0 — comment-stripping worked. Fixture removed.

M-4 new-violator fixture: temporarily added a `[TRANSITIONAL]` marker with no exit keyword.  
Result: exit 1 — new violation named `mingla-business/src/__metaTransitionalFixture.ts:1`. Fixture removed.

M-4 keyword fixtures: temporarily added 7 markers using `EXIT`, `exits when`, `exit condition`, `Cycle X`, `B-cycle`, `B5`, and `ORCH-9999`.  
Result: exit 0 — all 7 variants accepted. Fixture removed.

M-5 textShadow fixture: synthetic stderr containing `"textShadow*" style props are deprecated` with a mingla-business path.  
Result: exit 1 — violation labeled `textShadow* deprecation`.

M-5 property fixture: synthetic stderr containing `mingla-business/src/foo.ts:12: Property 'foo' doesn't exist`.  
Result: exit 1 — violation labeled `Property 'foo' doesn't exist (mingla-business source)`.

M-5 dependency-source fixture: synthetic stderr containing `node_modules/@stripe/connect-js/index.js: Property 'foo' doesn't exist`.  
Result: exit 0 — dependency-source property noise ignored.

## 7. Success Criteria Map

| SC | Result | Evidence |
|---|---|---|
| SC-1 | PASS | K script exists; workflow job added. |
| SC-2 | PASS | `.metro-cycle-baseline.txt` checked in with 14 current cycles. |
| SC-3 | PASS | K clean run exit 0. |
| SC-4 | PASS | K deliberate cycle fixture exit 1. |
| SC-5 | PASS | SKILL.md Step 1.5 inserted between CLOSE Step 1 and Step 2. |
| SC-6 | PASS | M script exists; workflow job added. |
| SC-7 | PASS | M clean run exit 0 with 11/11 match. |
| SC-8 | PASS | M v15 drift fixture exit 1. |
| SC-9 | PASS | M comment-only fixture exit 0. |
| SC-10 | PASS | N script exists; workflow job added. |
| SC-11 | PASS | `.transitional-baseline.txt` checked in with 4 current live violators. |
| SC-12 | PASS | N clean run PASS-with-baseline. |
| SC-13 | PASS | N new violator fixture exit 1. |
| SC-14 | PASS | N accepts all 7 exit keyword variants. |
| SC-15 | PASS | X script exists; workflow job runs export then parser. |
| SC-16 | PASS | Local `expo export -p web` + parser passed. |
| SC-17 | PASS | Synthetic textShadow stderr fixture exit 1. |
| SC-18 | PASS | Dependency-source property fixture ignored. |
| SC-19 | PASS | README active table has K/L/M/N/X rows. |
| SC-20 | PASS | Registry has DRAFT K/L/M/N/X entries. |
| SC-21 | PARTIAL | Local timings pass comfortably, but full GitHub CI timing was not run because this handoff explicitly says no push. |
| SC-22 | PARTIAL | M/M/N/X name concrete file:line or source path. K names the exact cycle path chain; madge does not provide line numbers for import cycles. |

## 8. Invariant Verification

- Existing product invariants preserved: no functional product code changes except a comment correction in `reapOrphanStorageKeys.ts`.
- DRAFT Stripe invariants O/P/Q/R/S/T/U/V/W were not edited except insertion of K/L/M/N/X before T in the same registry file.
- `I-PROPOSED-W` remains the B2a Path C V3 notifications-prefix invariant.
- `I-PROPOSED-X` is the only web-export invariant ID used for META M-5.

## 9. Cache, State, Auth, RLS, Integrations

- React Query/Zustand ownership unchanged.
- AsyncStorage whitelist values unchanged; only the comment's invariant ID changed.
- No auth, RLS, Supabase, Stripe, or notification runtime behavior changed.
- Workflow X uses stub Supabase env vars only for CI export.

## 10. Regression Surface

- M-1 can fail if local/CI `npx madge` output changes normalization; script sorts cycle members and accepts baseline pipe format.
- M-4 baseline is line-number based; future refactors that move the 4 legacy violators must update `Mingla_Artifacts/.transitional-baseline.txt` in the same PR.
- M-5 adds the slowest gate because it runs `expo export -p web`.

## 11. Unverified Gaps

- No branch push or GitHub Actions run was performed per dispatch instruction. CI job appearance and total CI timing remain UNVERIFIED in GitHub.
- X deliberate textShadow/property failure was verified by parser fixtures, not by temporarily reverting the app source and re-running the full export.

## 12. Discoveries for Orchestrator

- M-4 current live baseline is 4, not 9, under the implemented 5-line keyword rule. Several originally listed SPEC lines now have exit keywords within the allowed window or no longer violate the rule.
- M-1 SPEC baseline had one stale path for the liveEventConverter two-node cycle. The implemented baseline follows current madge reality: `src/utils/liveEventConverter.ts`.
- Local noninteractive Node did not have `npx`/`node` on PATH. The K script adds Homebrew fallback PATH entries for local reliability; CI still uses normal `node`/`npx`.

## 13. Deploy Notes

- No migrations or edge functions to deploy.
- No EAS update required.
- Tester should run the four scripts and inspect the workflow/skill/registry diffs.
