# QA ORCH-0781 — Clean-tree Stripe Web Import Gate Regression

Tester: Claude `mingla-tester` (canonical TEST owner per 2026-05-10 reversal of META-ORCH-0755 / DEC-133)
Date: 2026-05-11
Working tree: `.worktrees/orch-0781-clean-tree-stripe-web-import-regression/`
Branch / HEAD: `orch/0781-clean-tree-stripe-web-import-regression` @ `14c3b59d`
Inputs verified against:
- SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md` (read from main checkout)
- Orchestrator review: `Mingla_Artifacts/reports/REVIEW_INVESTIGATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md` (read from main checkout)

---

## Verdict

**PASS.**

All eleven T-781 receipts independently re-run on the worktree match the implementor's report, and every SPEC scope hard guard is honoured. The ORCH-0778 web Stripe import gate is re-armed across all three layers (npm script, CI job, push trigger) and the gate script now self-validates its own wiring so the next `Clean tree`-class sweep that disarms any layer fails the gate from a single invocation.

## Severity Counts

| Severity | Count |
|---|---|
| P0 — CRITICAL | 0 |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 0 |
| P3 — LOW | 0 |
| P4 — NOTE | 2 |

## Scope of Verification (T-781 only)

Per dispatch hard guards, this QA validates only the ORCH-0778 npm + CI + push + self-validation repair. NOT verified (out of scope by design):

- D-0781-2 / ORCH-0776A / ORCH-0777 strict-grep CI-orphan audit.
- Any product-code path (`_layout.tsx`, `payment.tsx`, `src/payments/*`). Verified only that diff is empty.
- DEC-137 / I-PROPOSED-AE retroactive edits (deferred to orchestrator CLOSE per SPEC §12).
- Supabase migrations, edge functions, EAS builds, provider configuration.
- New workflow files (forbidden; the strict-grep workflow registry pattern requires one yml — verified not added).
- META-ORCH process changes (CLOSE-checklist amendments).

## File-Level Compliance Audit (SPEC §6)

| # | File | SPEC contract | Observed at `14c3b59d` | Result |
|---|---|---|---|---|
| 1 | `mingla-business/package.json` | Add `test:orch-0778` as the new last entry of the `scripts` object, immediately after `test:orch-0777`. No reordering of any other script. Trailing comma added to `test:orch-0777` line. | `git diff HEAD~1 HEAD -- mingla-business/package.json` shows exactly that 2-line change (trailing comma + new line at line 33). All other scripts unchanged at their prior indices (verified by reading the file). | PASS |
| 2 | `.github/workflows/strict-grep-mingla-business.yml` | (a) Add `push:` sub-block to `on:` mirroring `pull_request:` paths for `[main, Seth]`. (b) Append ORCH-0778 registry comment line immediately after ORCH-0776D. (c) Append `orch-0778-web-stripe-native-import-gate:` job after `orch-0776d-cancelled-at-schema:` without renaming or reordering existing jobs. | `git diff HEAD~1 HEAD` shows (a) push block at workflow lines 11–17 with identical paths to pull_request, (b) ORCH-0778 comment at line 49 immediately after ORCH-0776D comment at line 48, (c) ORCH-0778 job at workflow line 336 immediately after ORCH-0776D job ending at line 334. ORCH-0776D job preserved. All 24 prior jobs at unchanged positions relative to their neighbours (verified via `grep -nE '^\s{2}[a-zA-Z0-9-]+:\s*$'`). | PASS |
| 3 | `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs` | Existing import-scan unchanged; three new wiring self-checks (npm script presence with correct path, CI job header line-anchored regex, push trigger with both `main` and `Seth`). All four checks contribute to one exit code. Pure Node `fs` + `path` + regex. No YAML parser dep. `process.cwd().endsWith("mingla-business")` heuristic preserved. Success message preserved exactly. Failure header preserved exactly. | Diff adds `checkNpmWiring`, `checkWorkflowWiring`, `getTopLevelBlock`, `getIndentedChildBlock`, `branchBlockHas` helpers and invokes them after the walk. Failure header changed from the old long sentence to the SPEC-required `ORCH-0778 web Stripe native import gate failed.` exactly. Success line `ORCH-0778 web Stripe native import gate passed.` preserved. All four failure messages start with the SPEC-required prefixes (verified against T-781-6 / T-781-7 / T-781-8 / T-781-9 receipts below). Import-scan pattern strengthened to also catch the bare-string side-effect form (`import "@stripe/stripe-react-native"`), which is a strict superset of the SPEC §9.1.1 pattern. | PASS |
| 4 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md` | New implementor report following standard template (Summary / Files Changed / Verification receipts / Discoveries / Confidence). | Present; 293 lines; all eleven T-781 receipts with exit codes and stdout/stderr; Forbidden Product Diff Check + `git diff --check` + pre/post `git status` evidence. | PASS |

`git show --stat 14c3b59d` confirms exactly four files in the commit (the three implementation files plus the report), with `293 insertions` for the new report file and `135 insertions / 11 deletions` across the other three. No fifth file leaked into the commit. The untracked SPEC artifact (`Mingla_Artifacts/specs/SPEC_ORCH-0781_*.md`) is correctly excluded from the commit per dispatch §14 / §6.

## Scope Hard-Guard Compliance Audit

| Guard | Verification command | Result |
|---|---|---|
| No product-code change in `_layout.tsx` / `payment.tsx` / `src/payments/*` | `git diff HEAD~1 HEAD -- 'mingla-business/app/_layout.tsx' 'mingla-business/app/checkout/[eventId]/payment.tsx' 'mingla-business/src/payments/StripeNativeProvider.native.tsx' 'mingla-business/src/payments/StripeNativeProvider.web.tsx' 'mingla-business/src/payments/stripePaymentSheet.native.ts' 'mingla-business/src/payments/stripePaymentSheet.web.ts'` | Empty diff. PASS |
| No Supabase / EAS / provider / mobile / admin changes | `git diff HEAD~1 HEAD -- supabase/ mingla-business/eas.json mingla-business/app.json app-mobile/ mingla-admin/` | Empty diff. PASS |
| No tracker / decision / invariant / close-note edits | `git diff HEAD~1 HEAD -- Mingla_Artifacts/DECISION_LOG.md Mingla_Artifacts/INVARIANT_REGISTRY.md Mingla_Artifacts/WORLD_MAP.md Mingla_Artifacts/MASTER_BUG_LIST.md Mingla_Artifacts/PRIORITY_BOARD.md Mingla_Artifacts/OPEN_INVESTIGATIONS.md Mingla_Artifacts/AGENT_HANDOFFS.md Mingla_Artifacts/WORKTREE_REGISTRY.md Mingla_Artifacts/ROOT_CAUSE_REGISTER.md Mingla_Artifacts/COVERAGE_MAP.md Mingla_Artifacts/PRODUCT_SNAPSHOT.md` | Empty diff. PASS |
| No new workflow file | `git diff --name-only --diff-filter=A HEAD~1 HEAD -- .github/workflows/` returns nothing. The existing `strict-grep-mingla-business.yml` was edited in place. | PASS |
| No other strict-grep gate script edited | `git diff --name-only HEAD~1 HEAD -- .github/scripts/strict-grep/` returns only `orch-0778-web-stripe-native-import-gate.mjs` | PASS |
| ORCH-0776D job preserved alongside ORCH-0778 (registry pattern: never replace existing jobs) | `grep -nE 'orch-0776d-cancelled-at-schema' .github/workflows/strict-grep-mingla-business.yml` shows the registry comment at line 48 and the job header at line 325 — unchanged. | PASS |
| D-0781-2 (ORCH-0776A / 0777 CI orphans) NOT implemented in this commit | `grep -nE 'orch-0776a-video-upload-progress-honesty\|orch-0777-ticket-checkout-production' .github/workflows/strict-grep-mingla-business.yml` returns no matches. Correctly deferred. | PASS |

## Independent Verification Receipts (T-781 matrix)

All commands run from `/Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0781-clean-tree-stripe-web-import-regression/` unless noted.

### T-781-1 — gate at HEAD, repo-root invocation

```
$ node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs
ORCH-0778 web Stripe native import gate passed.
EXIT:0
```

Result: PASS. Matches SPEC §10 expectation (exit 0 after this SPEC).

### T-781-2 — npm-script invocation

```
$ (cd mingla-business && npm run test:orch-0778)
> mingla-business@1.0.0 test:orch-0778
> node ../.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs
ORCH-0778 web Stripe native import gate passed.
EXIT:0
```

Result: PASS. Cwd heuristic (`process.cwd().endsWith("mingla-business")`) resolves `root` to repo root correctly.

### T-781-3 — package.json line presence

```
$ grep -nE '^\s*"test:orch-0778":' mingla-business/package.json
33:    "test:orch-0778": "node ../.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs"
EXIT:0
```

Result: PASS. Exactly one match at the new last-entry position of the `scripts` object.

### T-781-4 — CI job header presence

```
$ grep -nE '^\s{2}orch-0778-web-stripe-native-import-gate:\s*$' .github/workflows/strict-grep-mingla-business.yml
336:  orch-0778-web-stripe-native-import-gate:
EXIT:0
```

Result: PASS. Exactly one match at the line-anchored two-space indent the script's wiring check regex requires.

### T-781-5 — workflow push trigger header presence

```
$ grep -nE '^\s{2}push:\s*$' .github/workflows/strict-grep-mingla-business.yml
11:  push:
EXIT:0
```

Result: PASS. Sub-block found inside the `on:` block.

### T-781-6 — synthetic regression A (Stripe RN import in `_layout.tsx`)

Procedure: prepended `import "@stripe/stripe-react-native";` to `mingla-business/app/_layout.tsx` (held in a tempfile), ran the gate, restored the file from backup, and verified `diff -q` returned clean.

```
ORCH-0778 web Stripe native import gate failed.
- mingla-business/app/_layout.tsx import-scan: @stripe/stripe-react-native must stay behind approved .native payment boundaries
EXIT:1
```

Result: PASS. Import-scan check fires, failure bullet names the exact path and layer as SPEC §9.2 requires.

Additional sanity run with the `import { StripeProvider } from "@stripe/stripe-react-native"` form (the original `ca69de38` regression shape) was also rejected with the same bullet — confirms the new pattern catches both the bare-string side-effect form and the named-import form.

### T-781-7 — synthetic regression B (remove `test:orch-0778` from `package.json`)

Procedure: parsed `package.json`, deleted `scripts["test:orch-0778"]`, wrote back, ran the gate, restored from backup.

```
ORCH-0778 web Stripe native import gate failed.
- ORCH-0781 wiring: mingla-business/package.json missing scripts["test:orch-0778"] or expected gate script path (npm wiring)
EXIT:1
```

Result: PASS. Bullet begins with the exact SPEC §9.1.2 prefix `ORCH-0781 wiring: mingla-business/package.json missing scripts["test:orch-0778"]` and identifies the npm wiring layer.

### T-781-8 — synthetic regression C (remove `orch-0778-web-stripe-native-import-gate` job from yml)

Procedure: located the job header line in the workflow yml, truncated from there to end of file, ran the gate, restored.

```
ORCH-0778 web Stripe native import gate failed.
- ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml missing job orch-0778-web-stripe-native-import-gate (CI wiring)
EXIT:1
```

Result: PASS. Bullet begins with the exact SPEC §9.1.3 prefix.

### T-781-9 — synthetic regression D (remove `push:` sub-block from `on:` block)

Procedure: located the `^\s{2}push:` line in the workflow yml, removed it and its 4-space-indented children, ran the gate, restored. Pre-check `grep` confirmed no `push:` header remained before the gate ran.

```
ORCH-0778 web Stripe native import gate failed.
- ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml on: block missing push trigger for [main, Seth] (push wiring)
EXIT:1
```

Result: PASS. Bullet begins with the exact SPEC §9.1.4 prefix.

### T-781-10 — historical replay against `ca69de38`

Procedure: `git clone -q /Users/sethogieva/Desktop/mingla-main /tmp/qa0781_ca69de38 && cd /tmp/qa0781_ca69de38 && git checkout -q ca69de38 && cp <new-script-from-worktree> .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs && node ...`

```
ORCH-0778 web Stripe native import gate failed.
- mingla-business/app/_layout.tsx import-scan: @stripe/stripe-react-native must stay behind approved .native payment boundaries
- mingla-business/app/checkout/[eventId]/payment.tsx import-scan: @stripe/stripe-react-native must stay behind approved .native payment boundaries
- ORCH-0781 wiring: mingla-business/package.json missing scripts["test:orch-0778"] or expected gate script path (npm wiring)
- ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml missing job orch-0778-web-stripe-native-import-gate (CI wiring)
- ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml on: block missing push trigger for [main, Seth] (push wiring)
EXIT:1
```

Result: PASS. Five failure bullets covering all four layers (import-scan × 2 + npm wiring + CI wiring + push wiring). Matches SPEC §10 T-781-10 ("at least four failure bullets covering import-scan + all three wiring checks"). Confirms the gate would have caught both root-cause classes (F-0781-R1/R2 product + F-0781-R3/R4 wiring) had any caller invoked it at the time of `ca69de38`. Clone directory cleaned up after capture.

### T-781-11 — historical replay against `b7431fe1`

Procedure: same as T-781-10 with `b7431fe1`.

```
ORCH-0778 web Stripe native import gate failed.
- ORCH-0781 wiring: mingla-business/package.json missing scripts["test:orch-0778"] or expected gate script path (npm wiring)
- ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml missing job orch-0778-web-stripe-native-import-gate (CI wiring)
- ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml on: block missing push trigger for [main, Seth] (push wiring)
EXIT:1
```

Result: PASS. Exactly three wiring bullets and zero import-scan bullets — matches SPEC §10 T-781-11 literally. Confirms `b7431fe1` partial-restore: product code repaired, wiring still disarmed (which is exactly the state ORCH-0781 was scoped to repair).

## Platform Parity Matrix (per dispatch §"Mandatory platform parity")

This dispatch is a **repo-tooling change only** — npm script + GitHub Actions workflow + Node.js gate script. No application code paths are modified. Platform-parity coverage is recorded as N/A with reasoning, not silently skipped.

| Platform | Coverage | Reasoning |
|---|---|---|
| iOS Simulator | N/A | No `mingla-business` iOS bundle code was modified by `14c3b59d`. Product Stripe boundary files (`StripeNativeProvider.native.tsx`, `stripePaymentSheet.native.ts`) are unchanged. Diff of those files: empty (verified). Running the iOS bundle would exercise only pre-existing code unchanged from `b7431fe1`. |
| Android Emulator | N/A | Same reasoning as iOS. No `mingla-business` Android bundle code modified. The native Stripe boundary remains intact and unchanged. |
| Web (mingla-business) | N/A (covered indirectly) | No `mingla-business` web bundle code modified. The boundary the gate protects (zero `@stripe/stripe-react-native` imports outside the two `.native` boundary files in `mingla-business/{app,src}`) is verified intact by T-781-1. Running `npx expo export --platform web` would only re-verify the same invariant the gate already verifies statically. |
| CI runner (`ubuntu-latest`) | COVERED | The gate script itself is the "platform" for this dispatch. Verified by T-781-1 (repo-root invocation, mirrors the workflow step) and T-781-2 (npm invocation from `mingla-business/`). Both exit 0. The workflow yml step will run the identical command on `ubuntu-latest`. |

## CI / GitHub-Actions Verification (SPEC §11)

| ID | Check | Status | Note |
|---|---|---|---|
| C-781-1 | GitHub Actions PR run shows `ORCH-0778: Stripe native imports stay behind .native boundaries` job present and passing | UNVERIFIED — branch not yet pushed | Cannot be captured locally; must be observed once orchestrator pushes / opens PR. Not blocking for PASS. |
| C-781-2 | All existing strict-grep jobs continue to appear and pass | LIKELY-OK by structural diff | The workflow diff added only a `push:` sub-block, a registry comment line, and a new job block; no existing job was modified. Final verification at first CI run. |
| C-781-3 | Push event to `main` or `Seth` triggers a workflow run | UNVERIFIED — branch not yet pushed | Same as C-781-1. |
| C-781-4 | Scratch push of synthetic regression A fails the ORCH-0778 job red | OPTIONAL per SPEC; not run | Synthetic-regression coverage already exhaustively proven locally by T-781-6 / T-781-7 / T-781-8 / T-781-9 / T-781-10. Skipping C-781-4 does not introduce risk. |

C-781-1 and C-781-3 are residual unverified items. Recommendation: orchestrator captures both at first push/PR after CLOSE and pastes the run URLs into the CLOSE note. Tester PASS is NOT blocked on this — the gate logic is independently proven correct and the workflow yml structure matches SPEC §7 verbatim.

## Notes (P4)

### P4-1 — Import pattern strengthened beyond SPEC §9.1.1

The implementor's `stripeReactNativeImportPattern` adds a fourth alternative for the bare-string side-effect form `import "@stripe/stripe-react-native"` on top of the three SPEC-required forms (named-from import, dynamic `import(...)`, `require(...)`). This is a strict superset of the SPEC and improves robustness against an obscure regression class that would have otherwise slipped past the gate. Worth replicating in sibling gates (e.g., the ORCH-0768 / ORCH-0769 / ORCH-0777 import-scan style scripts) if any of them only check `from … "..."`.

### P4-2 — Push-trigger `on:` block reads cleanly under YAML rules

The new `push:` block at lines 11–17 mirrors the `pull_request:` block at lines 4–10 with identical `paths:` filters. This is the smallest possible bypass-closure for the `ca69de38`-class direct-push regression — the workflow's effective surface area on push is exactly equal to its effective surface area on pull-request, no more, no less. Branch-protection tightening (require-checks-to-pass on push) is correctly deferred to a separate META-ORCH per SPEC §11.

## Final Sanity Check

```
$ git status --short --branch
## orch/0781-clean-tree-stripe-web-import-regression
?? Mingla_Artifacts/specs/SPEC_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md
```

After this QA report is created, the only added untracked artifact at the worktree is the SPEC (correctly excluded from the implementor commit per dispatch) and this QA report. No accidental writes to product code or trackers.

## Routing

PASS → Codex `orchestrator-mingla` for CLOSE.

Orchestrator CLOSE responsibilities per SPEC §12.2 (recap):
1. Append the DEC-137 follow-up line specified by SPEC §12.2.1.
2. Refresh the `Codified:` line on `I-PROPOSED-AE STRIPE_REACT_NATIVE_NATIVE_BOUNDARY_ONLY` per SPEC §12.2.2.
3. Update `WORLD_MAP.md` strict-grep row with the now-present ORCH-0778 job and push-trigger note.
4. Mark `orch-0781-clean-tree-stripe-web-import-regression` CLOSED in `WORKTREE_REGISTRY.md`.
5. Standard CLOSE-protocol updates to `PRIORITY_BOARD.md`, `MASTER_BUG_LIST.md`, `OPEN_INVESTIGATIONS.md`.
6. Register D-0781-2 (ORCH-0776A / 0777 CI orphans audit) as a fresh row in `OPEN_INVESTIGATIONS.md`.
7. Optional: capture C-781-1 and C-781-3 Actions URLs from the first push / PR after CLOSE.
