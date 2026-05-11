# IMPLEMENTATION ORCH-0781 — Clean-tree Stripe Web Import Gate Regression

Status: implemented and verified
Date: 2026-05-11
Working tree: `.worktrees/orch-0781-clean-tree-stripe-web-import-regression/`
Branch: `orch/0781-clean-tree-stripe-web-import-regression`
Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`

## Summary

ORCH-0781 re-arms the ORCH-0778 Stripe web import guard after `ca69de38` removed its npm/CI wiring and `b7431fe1` restored only product code. The implementation restores `npm run test:orch-0778`, appends the ORCH-0778 strict-grep job as a sibling of ORCH-0776D, adds push-trigger coverage for `[main, Seth]`, and promotes the existing gate script into a self-validating guard that fails if its own npm/CI/push wiring is removed again.

No product code was edited. No Supabase, EAS, provider, or deploy steps were run.

## Scope Compliance

| Requirement | Result | Evidence |
|---|---:|---|
| Change only `mingla-business/package.json`, `.github/workflows/strict-grep-mingla-business.yml`, `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs`, plus this report | PASS | `git diff --stat` shows only those three implementation files before report creation; this report is the fourth scoped file. |
| Do not edit `_layout.tsx`, `payment.tsx`, or `src/payments/*` | PASS | `git diff -- 'mingla-business/app/_layout.tsx' 'mingla-business/app/checkout/[eventId]/payment.tsx' 'mingla-business/src/payments/StripeNativeProvider.native.tsx' 'mingla-business/src/payments/stripePaymentSheet.native.ts'` returned no diff, exit 0. |
| Keep D-0781-2 out of implementation | PASS | No ORCH-0776A or ORCH-0777 CI jobs were added; D-0781-2 remains a CLOSE-time registration only. |
| Do not edit DEC-137, I-PROPOSED-AE, or global trackers | PASS | No global tracker or decision/invariant files were edited in this worktree implementation. |
| No new workflow file or dependency | PASS | Existing `.github/workflows/strict-grep-mingla-business.yml` was updated in place; no dependency files changed. |

Note: the worktree already contained an untracked scoped spec artifact, `Mingla_Artifacts/specs/SPEC_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`, before implementation. It is an input artifact and is intentionally not included in the implementation commit per the dispatch's commit-scope rule.

## Files Changed

| File | Old behavior | New behavior |
|---|---|---|
| `mingla-business/package.json` | `test:orch-0778` was missing; the documented local gate command failed as an npm missing script. | Adds `"test:orch-0778": "node ../.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs"` immediately after `test:orch-0777`. |
| `.github/workflows/strict-grep-mingla-business.yml` | Workflow triggered only on `pull_request`; ORCH-0778 registry comment and job were absent; ORCH-0776D was the final job. | Adds `push:` trigger for `[main, Seth]` with the same path filters, appends the ORCH-0778 registry comment after ORCH-0776D, and appends `orch-0778-web-stripe-native-import-gate` as a sibling job after ORCH-0776D. |
| `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs` | Scanned imports only; succeeded even if npm and CI wiring were missing. | Still scans imports and now also validates npm script, CI job header, and push trigger. All failures are collected into one exit code. |

## Self-Validation Design

The script now performs four checks in one run:

1. Import-scan check across `mingla-business/app` and `mingla-business/src`, allowing only the two approved `.native` Stripe boundary files.
2. Npm wiring check via `JSON.parse` of `mingla-business/package.json`.
3. CI job wiring check via a line-anchored regex for `  orch-0778-web-stripe-native-import-gate:`.
4. Push-trigger wiring check by locating the workflow `on:` block and validating a `push:` child block with both `main` and `Seth`, accepting inline or YAML-list branches.

The success line remains exactly:

```text
ORCH-0778 web Stripe native import gate passed.
```

Failure output now begins exactly:

```text
ORCH-0778 web Stripe native import gate failed.
```

Then each bullet includes the failing path and layer: import-scan, npm wiring, CI wiring, or push wiring.

## Verification Receipts

### T-781-1

Command: `node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs; printf '\nEXIT:%s\n' $?`
Cwd: `/Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0781-clean-tree-stripe-web-import-regression`
Exit code: 0

```text
ORCH-0778 web Stripe native import gate passed.

EXIT:0
```

Result: PASS.

### T-781-2

Command: `npm run test:orch-0778; printf '\nEXIT:%s\n' $?`
Cwd: `/Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0781-clean-tree-stripe-web-import-regression/mingla-business`
Exit code: 0

```text
> mingla-business@1.0.0 test:orch-0778
> node ../.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs

ORCH-0778 web Stripe native import gate passed.

EXIT:0
```

Result: PASS.

### T-781-3

Command: `grep -nE '^\s*"test:orch-0778":' mingla-business/package.json; printf '\nEXIT:%s\n' $?`
Cwd: `/Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0781-clean-tree-stripe-web-import-regression`
Exit code: 0

```text
33:    "test:orch-0778": "node ../.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs"

EXIT:0
```

Result: PASS — exactly one match.

### T-781-4

Command: `grep -nE '^\s{2}orch-0778-web-stripe-native-import-gate:\s*$' .github/workflows/strict-grep-mingla-business.yml; printf '\nEXIT:%s\n' $?`
Cwd: `/Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0781-clean-tree-stripe-web-import-regression`
Exit code: 0

```text
336:  orch-0778-web-stripe-native-import-gate:

EXIT:0
```

Result: PASS — exactly one match.

### T-781-5

Command: `grep -nE '^\s{2}push:\s*$' .github/workflows/strict-grep-mingla-business.yml; printf '\nEXIT:%s\n' $?`
Cwd: `/Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0781-clean-tree-stripe-web-import-regression`
Exit code: 0

```text
11:  push:

EXIT:0
```

Result: PASS.

### T-781-6

Command: temporarily inserted `import "@stripe/stripe-react-native";` in `mingla-business/app/_layout.tsx`, then ran `node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs; printf '\nEXIT:%s\n' $?`
Cwd: `/Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0781-clean-tree-stripe-web-import-regression`
Exit code: 1

```text
ORCH-0778 web Stripe native import gate failed.
- mingla-business/app/_layout.tsx import-scan: @stripe/stripe-react-native must stay behind approved .native payment boundaries

EXIT:1
```

Result: PASS. Temporary import was removed immediately after the receipt.

### T-781-7

Command: temporarily removed `scripts["test:orch-0778"]` from `mingla-business/package.json`, then ran `node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs; printf '\nEXIT:%s\n' $?`
Cwd: `/Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0781-clean-tree-stripe-web-import-regression`
Exit code: 1

```text
ORCH-0778 web Stripe native import gate failed.
- ORCH-0781 wiring: mingla-business/package.json missing scripts["test:orch-0778"] or expected gate script path (npm wiring)

EXIT:1
```

Result: PASS. Temporary package edit was restored immediately after the receipt.

### T-781-8

Command: temporarily removed `orch-0778-web-stripe-native-import-gate:` from `.github/workflows/strict-grep-mingla-business.yml`, then ran `node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs; printf '\nEXIT:%s\n' $?`
Cwd: `/Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0781-clean-tree-stripe-web-import-regression`
Exit code: 1

```text
ORCH-0778 web Stripe native import gate failed.
- ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml missing job orch-0778-web-stripe-native-import-gate (CI wiring)

EXIT:1
```

Result: PASS. Temporary workflow edit was restored immediately after the receipt.

### T-781-9

Command: temporarily removed the workflow `push:` block, then ran `node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs; printf '\nEXIT:%s\n' $?`
Cwd: `/Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0781-clean-tree-stripe-web-import-regression`
Exit code: 1

```text
ORCH-0778 web Stripe native import gate failed.
- ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml on: block missing push trigger for [main, Seth] (push wiring)

EXIT:1
```

Result: PASS. Temporary workflow edit was restored immediately after the receipt.

### T-781-10

Command: `git checkout ca69de38 && cp /Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0781-clean-tree-stripe-web-import-regression/.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs && node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs; printf '\nEXIT:%s\n' $?`
Cwd: `/tmp/orch-0781-ca69de38`
Exit code: 1

```text
HEAD is now at ca69de38 Clean tree
ORCH-0778 web Stripe native import gate failed.
- mingla-business/app/_layout.tsx import-scan: @stripe/stripe-react-native must stay behind approved .native payment boundaries
- mingla-business/app/checkout/[eventId]/payment.tsx import-scan: @stripe/stripe-react-native must stay behind approved .native payment boundaries
- ORCH-0781 wiring: mingla-business/package.json missing scripts["test:orch-0778"] or expected gate script path (npm wiring)
- ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml missing job orch-0778-web-stripe-native-import-gate (CI wiring)
- ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml on: block missing push trigger for [main, Seth] (push wiring)

EXIT:1
```

Result: PASS — the SPEC-implemented script fails on `ca69de38` with import-scan plus all three wiring failures.

### T-781-11

Command: `git checkout b7431fe1 && cp /Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0781-clean-tree-stripe-web-import-regression/.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs && node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs; printf '\nEXIT:%s\n' $?`
Cwd: `/tmp/orch-0781-b7431fe1`
Exit code: 1

```text
HEAD is now at b7431fe1 Restore ORCH-0778 Stripe web import gating
ORCH-0778 web Stripe native import gate failed.
- ORCH-0781 wiring: mingla-business/package.json missing scripts["test:orch-0778"] or expected gate script path (npm wiring)
- ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml missing job orch-0778-web-stripe-native-import-gate (CI wiring)
- ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml on: block missing push trigger for [main, Seth] (push wiring)

EXIT:1
```

Result: PASS — exactly three wiring bullets and no import-scan bullets.

## Additional Verification

### Forbidden Product Diff Check

Command:

```bash
git diff -- 'mingla-business/app/_layout.tsx' 'mingla-business/app/checkout/[eventId]/payment.tsx' 'mingla-business/src/payments/StripeNativeProvider.native.tsx' 'mingla-business/src/payments/stripePaymentSheet.native.ts'; printf '\nEXIT:%s\n' $?
```

Exit code: 0.

```text

EXIT:0
```

### `git diff --check`

Command: `git diff --check; printf '\nEXIT:%s\n' $?`
Exit code: 0.

```text

EXIT:0
```

### `git status --short --branch`

Pre-report status:

```text
## orch/0781-clean-tree-stripe-web-import-regression
 M .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs
 M .github/workflows/strict-grep-mingla-business.yml
 M mingla-business/package.json
?? Mingla_Artifacts/specs/SPEC_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md
```

Final status after report creation:

```text
## orch/0781-clean-tree-stripe-web-import-regression
 M .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs
 M .github/workflows/strict-grep-mingla-business.yml
 M mingla-business/package.json
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md
?? Mingla_Artifacts/specs/SPEC_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md
```

## Discoveries

- The ORCH-0781 investigation and review reports were present in the main checkout but not copied into this worktree. They were read from `/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/reports/` as source evidence and were not copied or committed, preserving implementation scope.
- The worktree contains untracked input spec artifact `Mingla_Artifacts/specs/SPEC_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`; this implementation commit intentionally excludes it per the dispatch's commit-scope instruction.

## Remaining Risks

- GitHub Actions push-trigger evidence cannot be captured locally. Tester/close should confirm the workflow appears on PR/push after branch publication or merge per SPEC §11.
- D-0781-2 remains open by design: ORCH-0776A and ORCH-0777 strict-grep CI orphan audit is not implemented here and must be registered by orchestrator at CLOSE.

## Routing

Route to Claude `mingla-forensics` TEST mode (or Claude `mingla-tester` if the operator intentionally uses the legacy mirror) for independent verification against this spec and report. After TEST PASS, route to Codex `orchestrator-mingla` for CLOSE. CLOSE owns DEC-137 follow-up, I-PROPOSED-AE codified-date refresh, worktree registry close, and D-0781-2 OPEN_INVESTIGATIONS registration.
