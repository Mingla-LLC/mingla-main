# CLOSE NOTE ORCH-0781 — Clean-tree Stripe Web Import Gate Regression

Date: 2026-05-11
Close owner: Codex `orchestrator-mingla`
Verdict: CLOSED PASS / Grade A
Worktree: `.worktrees/orch-0781-clean-tree-stripe-web-import-regression/`
Branch / implementation HEAD: `orch/0781-clean-tree-stripe-web-import-regression` @ `14c3b59d`

## Plain-English Outcome

ORCH-0781 re-armed the guard that protects Mingla Business Web from accidentally bundling native-only Stripe React Native code. The original ORCH-0778 boundary was correct, but commit `ca69de38` disarmed its enforcement by removing the npm script and CI job while also reintroducing generic Stripe React Native imports; `b7431fe1` restored only product code. ORCH-0781 closes the enforcement gap: the gate now fails if product imports regress, if `test:orch-0778` disappears, if the CI job disappears, or if the direct-push trigger for `[main, Seth]` disappears.

## Evidence Chain

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`
- Orchestrator investigation review: `Mingla_Artifacts/reports/REVIEW_INVESTIGATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`
- QA PASS: `Mingla_Artifacts/reports/QA_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`
- Implementation commit: `14c3b59d ORCH-0781: re-arm Stripe web import gate (npm + CI + push + self-validate)`

## What Changed

- Restored `mingla-business` npm script `test:orch-0778`.
- Restored strict-grep workflow job `orch-0778-web-stripe-native-import-gate` as a sibling job, without replacing ORCH-0776D.
- Added `push` coverage for `[main, Seth]` to `.github/workflows/strict-grep-mingla-business.yml`.
- Promoted `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs` into a self-validating guard for npm wiring, CI job wiring, and push-trigger wiring.
- Left product code, Supabase, EAS, providers, mobile, admin, new workflow files, and unrelated strict-grep gates untouched.

## Verification

QA independently re-ran T-781-1 through T-781-11. The historical replay against `ca69de38` failed with import-scan plus npm/CI/push wiring bullets; the replay against `b7431fe1` failed with exactly the three wiring bullets and no import-scan bullets. Final scope hard guards were clean: no product-code diff, no Supabase/EAS/provider/admin/mobile diff, no tracker/decision/invariant edits during implementation, no new workflow file, and no D-0781-2 implementation.

DIAG marker reap for `[ORCH-0781-DIAG]` across `mingla-business/src/`, `mingla-business/app/`, `app-mobile/src/`, `supabase/functions/`, and `mingla-admin/src/` returned zero matches.

## Artifact Sync

- `DECISION_LOG.md` appends a follow-up under DEC-137 without rewriting the original decision.
- `INVARIANT_REGISTRY.md` refreshes only the `Codified:` line for `I-PROPOSED-AE`.
- `WORLD_MAP.md`, `MASTER_BUG_LIST.md`, `COVERAGE_MAP.md`, `PRODUCT_SNAPSHOT.md`, `PRIORITY_BOARD.md`, `AGENT_HANDOFFS.md`, `OPEN_INVESTIGATIONS.md`, `ROOT_CAUSE_REGISTER.md`, and `WORKTREE_REGISTRY.md` record ORCH-0781 as closed/pass or lock-in pending.
- D-0781-2 is registered as a separate OPEN investigation row for ORCH-0776A / ORCH-0777 strict-grep CI-orphan audit.

## Residual Evidence To Paste After First Push / Merge

- C-781-1: GitHub Actions PR run URL showing job `ORCH-0778: Stripe native imports stay behind .native boundaries` present and passing.
- C-781-3: GitHub Actions push-trigger run URL for `main` or `Seth`.

Paste the URLs here when available:

- C-781-1 PR/job run URL: _pending first push / PR_
- C-781-3 push-run URL: _pending first push / merge_

These are not close blockers because QA proved the gate logic and workflow structure locally; they are external Actions receipt capture.

## Deploy Notes

No Supabase migration, Edge Function deploy, provider mutation, EAS OTA, or native build belongs to ORCH-0781. This is a repo-tooling guard repair only.

## Lock-In Status

Implementation branch commit `14c3b59d` is close-ready, and close artifact commit `cc1dfabe` has been pushed to `origin/orch/0781-clean-tree-stripe-web-import-regression`. This branch push does not satisfy C-781-3 because the workflow's new `push` trigger intentionally targets only `[main, Seth]`; C-781-3 must be captured after merge/push to one of those branches. The main checkout currently contains unrelated dirty ORCH-0777/0779/product work, including files that overlap the ORCH-0781 implementation surface, so the final merge/remove step must wait until those unrelated changes are isolated or committed by their owners. Until then, `WORKTREE_REGISTRY.md` marks the worktree as `CLOSED PASS / branch pushed / merge-remove pending`.

Recommended commit message for the close artifact sync:

```text
Close ORCH-0781: re-arm Stripe web import guard

- Closes ORCH-0781 with QA PASS (0 P0/P1/P2/P3, 2 P4 notes)
- Appends DEC-137 follow-up and refreshes I-PROPOSED-AE codified line
- Registers D-0781-2 as separate strict-grep CI-orphan audit follow-up
- Notes no Supabase, EAS, provider, or product-code deploy impact
```
