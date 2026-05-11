# SPEC ORCH-0781 — Clean-tree Stripe Web Import Gate Regression

Author: Claude `mingla-forensics` (SPEC mode)
Date: 2026-05-11
Worktree: `.worktrees/orch-0781-clean-tree-stripe-web-import-regression/`
Branch: `orch/0781-clean-tree-stripe-web-import-regression` (based off `Seth` @ `b7431fe1`)
Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`
Orchestrator review: `Mingla_Artifacts/reports/REVIEW_INVESTIGATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`
Invariant under repair: `I-PROPOSED-AE STRIPE_REACT_NATIVE_NATIVE_BOUNDARY_ONLY`
Source decision: DEC-137 (do not rewrite; append-only follow-up at CLOSE).

---

## 1. Summary

Commit `ca69de38` ("Clean tree") simultaneously reverted the two Stripe-boundary product files and disarmed the ORCH-0778 enforcement layer in the same commit (npm script removed, CI job slot overwritten). Commit `b7431fe1` restored the product files only. At HEAD the gate script still exists and still detects the regression class correctly, but it is orphaned: no `npm run test:orch-0778`, no CI job, and the strict-grep workflow itself only triggers on pull-requests so direct pushes to `Seth` bypass every gate.

This SPEC re-arms the ORCH-0778 enforcement layer across npm + CI as a sibling job (not a replacement of ORCH-0776D), adds a `push` trigger to the strict-grep workflow for `main` and `Seth`, and makes the existing ORCH-0778 gate script self-validate its own wiring so that any future wholesale-sweep that removes the npm script or the CI job will fail the gate from a single invocation. No product code changes. No documentation rewrites — DEC-137 / I-PROPOSED-AE reconciliation is deferred to CLOSE.

## 2. User / Launch Impact

**End-user (buyer / brand) impact:** none directly. Mingla Business Web is already buildable at HEAD; production Vercel deploy `dpl_CPQgBkaXa5nTvVNsCgeAe1UVQ6M5` is READY against `business.usemingla.com`. The B2 Connect, B3 Checkout, B4 Scanner launch gates remain on their own schedules and are unchanged by this SPEC.

**Internal / engineering impact:** restores the alarm system that catches direct `@stripe/stripe-react-native` imports into web-reachable files before they reach Metro/Vercel. Catches the next `ca69de38`-style wholesale sweep at push time, not at the next Vercel deploy attempt 2+ hours later. Closes the documented contradiction between `INVARIANT_REGISTRY.md` (which still names a CI job and an npm script that do not exist at HEAD) and the actual repo state.

**Launch-readiness contribution:** this SPEC is a residual-guard repair; it does not unblock any launch gate. It prevents a regression in a guard that protects a launch gate (web export) so that future drift cannot silently re-introduce the bug ORCH-0778 closed.

## 3. Proven Current State (at HEAD `b7431fe1`)

| Layer | State | Evidence |
|---|---|---|
| `mingla-business/app/_layout.tsx` | ✅ Imports only `StripeNativeProvider` from local `../src/payments/StripeNativeProvider`. No direct `@stripe/stripe-react-native` import. | File read at HEAD lines 19–34. |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | ✅ Imports only `useStripePaymentSheet` from `../../../src/payments/stripePaymentSheet`. No direct `@stripe/stripe-react-native` import. | File read at HEAD lines 14–48. |
| `mingla-business/src/payments/StripeNativeProvider.{native.tsx,web.tsx}` and `stripePaymentSheet.{native.ts,web.ts}` | ✅ Platform-resolved boundary files exist as established by ORCH-0778. | Unchanged since `76d2c26e`. |
| `mingla-business/package.json` `scripts.test:orch-0778` | ❌ Missing. Last present at `76d2c26e`; removed by `ca69de38`; not restored by `b7431fe1`. | `grep -n "test:orch-0778" mingla-business/package.json` returns no match. |
| `.github/workflows/strict-grep-mingla-business.yml` job `orch-0778-web-stripe-native-import-gate` | ❌ Missing. The yml slot is held by `orch-0776d-cancelled-at-schema` (lines 317–326). | File read at HEAD; only job is `orch-0776d-cancelled-at-schema`. |
| Registry comment line for ORCH-0778 in the yml header | ❌ Missing. Replaced in place by ORCH-0776D comment at line 41. | File read at HEAD; ORCH-0778 comment line absent. |
| `.github/workflows/strict-grep-mingla-business.yml` `on:` block | ❌ Triggers only on `pull_request`. Direct pushes to `Seth` and `main` bypass every job. | File read at HEAD lines 3–10. |
| `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs` | ✅ Present, functionally correct, but invocation surface is fully orphaned. Manual `node …mjs` run at HEAD prints `ORCH-0778 web Stripe native import gate passed.` and exits 0 — proves detection logic is healthy. | Run at HEAD inside this worktree, exit code 0. |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-AE | ⚠ Over-claims current enforcement. Names the `npm run test:orch-0778` command and the CI job that do not exist at HEAD. | F-0781-H1 in investigation. |

## 4. Target State (after this SPEC's implementation)

| Layer | Required state |
|---|---|
| Product code (`_layout.tsx`, `payment.tsx`, `src/payments/*.{native,web}.*`) | UNCHANGED. Implementor must NOT edit these files. |
| `mingla-business/package.json` | Contains `"test:orch-0778": "node ../.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs"` as a sibling of `test:orch-0777`. No other entries reordered or removed. |
| `.github/workflows/strict-grep-mingla-business.yml` jobs | Contains `orch-0778-web-stripe-native-import-gate:` job appended after `orch-0776d-cancelled-at-schema:`. `orch-0776d-cancelled-at-schema:` MUST remain. Every existing job MUST remain at the same position relative to its current neighbours. |
| `.github/workflows/strict-grep-mingla-business.yml` registry comment header | Contains the ORCH-0778 comment line appended immediately after the ORCH-0776D comment line. |
| `.github/workflows/strict-grep-mingla-business.yml` `on:` block | Contains both a `pull_request:` trigger (existing, unchanged) AND a sibling `push:` trigger with the same `branches: [main, Seth]` and the same four `paths:` filters. |
| `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs` | Performs the existing import-scan AND three new wiring self-checks (npm script present, CI job present, push trigger present). All four checks contribute to a single exit code. |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` and `Mingla_Artifacts/DECISION_LOG.md` | UNCHANGED during implementation. Reconciled at CLOSE only — append-only follow-up notes, no retroactive edits to DEC-137 text. |

After implementation: a single command `cd mingla-business && npm run test:orch-0778` must exit 0 on the clean repo and must exit 1 on any tree that (a) introduces a non-`.native` Stripe RN import in `mingla-business/{app,src}`, OR (b) removes the npm script, OR (c) removes/renames the CI job, OR (d) removes the workflow `push:` trigger for `main`+`Seth`. The CI job runs the same script on every push and pull-request to `main` or `Seth`.

## 5. Scope And Non-Goals

### In scope (this SPEC only)

- Restore the `test:orch-0778` npm script in `mingla-business/package.json`.
- Append the `orch-0778-web-stripe-native-import-gate` CI job to the strict-grep workflow as a sibling job after `orch-0776d-cancelled-at-schema`. Append the matching registry comment line.
- Add a `push:` trigger to the strict-grep workflow `on:` block for branches `main` and `Seth`, mirroring the existing `pull_request:` path filters.
- Extend the ORCH-0778 `.mjs` gate script to self-validate the three wiring layers above (npm script, CI job header, push trigger).
- Implementor verification with the three regression-test commands defined in §10.
- Implementation report at the canonical path defined in §15.

### Non-goals (explicitly out of scope)

- Any product-code change in `mingla-business/`. Investigation §5 / §10 confirmed product code at HEAD already matches the ORCH-0778 boundary.
- Any change to `mingla-business/src/payments/StripeNativeProvider.{native,web}.tsx` or `mingla-business/src/payments/stripePaymentSheet.{native,web}.ts`.
- Any change to other strict-grep gate scripts (I-37/38/39, I-PROPOSED-*, ORCH-0768/0769/0770/0771/0774a/0776a/0776d/0777, ORCH-0754/0756/0758/0759/0763).
- ORCH-0776A and ORCH-0777 CI-orphan audit (registered as D-0781-2 follow-up; see §13).
- ORCH-0777 ticket-checkout backend, B2 Stripe Connect, B4 scanner, Resend/Twilio dispatch, QR pepper, Stripe restricted keys, native PaymentSheet live-fire.
- DEC-137 retroactive text edits. I-PROPOSED-AE rewording to match the disarmed state.
- Any new workflow file. The strict-grep workflow registry pattern requires one yml; do not create `strict-grep-mingla-business-push.yml` or similar.
- META-ORCH process changes (e.g., CLOSE-checklist amendments for D-0778-QA-2; that is a separate orchestrator concern).
- Native (iOS/Android) Stripe live-fire. The ORCH-0778 boundary protects the web export; native paths are functionally identical and already covered by Metro `.native` resolution.

## 6. File-Level Change Contract

Exactly four files change:

| # | File | Change kind | Lines touched (approx) |
|---|---|---|---|
| 1 | `mingla-business/package.json` | Add one script entry, add one trailing-comma | 2 |
| 2 | `.github/workflows/strict-grep-mingla-business.yml` | Add `push:` trigger sub-block in `on:`; add one registry-comment line; append one job block | ~25 |
| 3 | `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs` | Add three wiring self-checks + revised error reporting | ~60 |
| 4 | (implementor report only) `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md` | New | n/a |

No other file (product, test, doc, migration, infra) is permitted to change in the implementation commit. The implementor's `git status` immediately before commit must contain exactly the three modified files above plus the one new implementation report (and any agent artifact appends if the implementor's protocol requires them — those go in a separate commit, not this one).

## 7. Strict-Grep Workflow Contract

### 7.1 Registry comment line (top of yml, around current line 41)

Append the following line **immediately after** the existing ORCH-0776D registry comment line. Do not reorder any prior comment line. Preserve trailing two-space indent identical to surrounding lines.

```
#   - ORCH-0778 (orch-0778-web-stripe-native-import-gate.mjs) — Stripe React Native imports stay behind .native payment boundaries (re-armed by ORCH-0781)
```

### 7.2 `on:` block — add `push:` trigger

Replace the existing `on:` block (currently lines 3–10) with the following block. The `pull_request:` sub-block is identical to today; the `push:` sub-block is new and mirrors `pull_request:` exactly.

```yaml
on:
  pull_request:
    branches: [main, Seth]
    paths:
      - "mingla-business/**"
      - "supabase/migrations/**"
      - ".github/scripts/strict-grep/**"
      - ".github/workflows/strict-grep-mingla-business.yml"
  push:
    branches: [main, Seth]
    paths:
      - "mingla-business/**"
      - "supabase/migrations/**"
      - ".github/scripts/strict-grep/**"
      - ".github/workflows/strict-grep-mingla-business.yml"
```

Rationale: `ca69de38` was a direct push to `Seth` with no PR. Adding `push:` for `main` and `Seth` closes the bypass without expanding the workflow's effective surface — the path filters are identical, so the workflow still ignores commits that touch only non-strict-grep paths.

### 7.3 ORCH-0778 job block — append after `orch-0776d-cancelled-at-schema:`

Append the following block at the END of the `jobs:` section, immediately after the `orch-0776d-cancelled-at-schema:` block. Indent identically to the existing job blocks (two spaces under `jobs:`). Do not remove, rename, or reorder any existing job.

```yaml
  orch-0778-web-stripe-native-import-gate:
    name: "ORCH-0778: Stripe native imports stay behind .native boundaries"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Run ORCH-0778 gate
        run: node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs
```

The job name string MUST be the exact name above so the I-PROPOSED-AE registry text "CI job `orch-0778-web-stripe-native-import-gate`" remains true once CLOSE refreshes the codified date.

## 8. Npm Script Contract

### 8.1 Position

Insert the new script entry in `mingla-business/package.json` immediately after the existing `test:orch-0777` entry. The current `test:orch-0777` is the last entry in the `scripts` object; therefore the implementor must (a) add a trailing comma to the `test:orch-0777` line and (b) add the new `test:orch-0778` line as the new last entry without a trailing comma.

### 8.2 Exact line content

```
    "test:orch-0778": "node ../.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs"
```

Use four leading spaces (matching surrounding indentation). Use the exact path `../.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs` — the `../` is required because the npm script runs with cwd `mingla-business/` while the script lives at repo root.

### 8.3 No reordering

Every other script in the `scripts` object MUST remain at the same index it occupies today. The implementor MUST NOT alphabetize, group, or re-emit the file with a different formatter. Use a targeted edit, not a full-file rewrite.

## 9. Optional Self-Validation Contract (REQUIRED)

This SPEC promotes the "optional" self-validation referenced in the dispatch to a hard requirement. Reason: a single self-validating script makes the next wholesale sweep fail from one invocation regardless of which layer is touched, which is the smallest structural defense against the F-0781-R3 / F-0781-R4 class.

### 9.1 Behavior contract

`.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs` must perform four independent checks. ALL failures across all four are collected into a single failures array; the process exits 1 if ANY failure is present, 0 only if all four are clean.

1. **Import-scan check (existing behavior, unchanged).** Walk `mingla-business/app` and `mingla-business/src`; flag any `.ts/.tsx/.js/.jsx` file (other than `mingla-business/src/payments/StripeNativeProvider.native.tsx` and `mingla-business/src/payments/stripePaymentSheet.native.ts`) that statically `import … from "@stripe/stripe-react-native"`, dynamic `import("@stripe/stripe-react-native")`, or `require("@stripe/stripe-react-native")`.
2. **Npm-script wiring check (NEW).** Read `mingla-business/package.json`; fail if `scripts["test:orch-0778"]` is missing or is not a string containing the substring `orch-0778-web-stripe-native-import-gate.mjs`. Error message must begin with `ORCH-0781 wiring: mingla-business/package.json missing scripts["test:orch-0778"]`.
3. **CI-job wiring check (NEW).** Read `.github/workflows/strict-grep-mingla-business.yml`; fail if it does not contain a line matching the regex `^\s{2}orch-0778-web-stripe-native-import-gate:\s*$` (two-space indent, exact job header). Error message must begin with `ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml missing job orch-0778-web-stripe-native-import-gate`.
4. **Push-trigger wiring check (NEW).** Read the same workflow yml; locate the `on:` block; verify a `push:` sub-block exists AND its `branches:` list contains both `main` and `Seth`. The regex tolerance MUST allow `[main, Seth]`, `[Seth, main]`, or YAML-list form (`- main` / `- Seth`). Error message must begin with `ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml on: block missing push trigger for [main, Seth]`.

### 9.2 Output contract

- On success (all four checks pass): print exactly `ORCH-0778 web Stripe native import gate passed.` (one line) and exit 0. The existing single-line success message is preserved unchanged so existing CI log scrapers continue to match.
- On failure: print exactly one header line `ORCH-0778 web Stripe native import gate failed.`, then one bullet per failure, then exit 1. Each bullet begins with `- ` and contains the file path AND the wiring layer (import-scan / npm wiring / CI wiring / push wiring) so the reader can identify which check fired without reading the script.

### 9.3 Implementation constraints

- Pure Node `fs` + `path` + regex. Do NOT add a YAML parser dependency, do NOT add an `npm install` step to the CI job, do NOT introduce `js-yaml`.
- Read `mingla-business/package.json` via `JSON.parse(fs.readFileSync(...))`. Tolerate `JSON.parse` throwing by emitting a single failure entry that names the parse error.
- Read the workflow yml via `fs.readFileSync(...)`; pattern-match against substrings. Be explicit about line-anchored regex (`^…$` with `m` flag) for the job header so a comment containing the same string does not satisfy the check.
- All paths resolved relative to `repoRoot` computed by the existing `process.cwd().endsWith("mingla-business")` heuristic at the top of the file. Do NOT change that heuristic.
- Wiring checks MUST run regardless of whether the import-scan check finds any failure (collect all failures, exit once).

### 9.4 Backwards-compatible invocation

Any of the following must continue to work and produce the same exit code:

```bash
# Invocation A — operator runs from repo root
node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs

# Invocation B — operator runs through npm (post-implementation)
cd mingla-business && npm run test:orch-0778

# Invocation C — CI runs it from repo root (job step)
node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs
```

## 10. Regression Test Matrix

The implementor MUST run these checks and paste exit-code receipts into the implementation report.

| ID | Command (run from repo root unless noted) | Expected before this SPEC | Expected after this SPEC |
|---|---|---|---|
| T-781-1 | `node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs` | exit 0 (script intact, product code clean, but ALL wiring missing — script does not yet self-validate) | exit 0 (all four checks pass) |
| T-781-2 | `cd mingla-business && npm run test:orch-0778` | exit 1, `npm ERR! missing script: test:orch-0778` | exit 0, success line printed |
| T-781-3 | `grep -nE '^\s*"test:orch-0778":' mingla-business/package.json` | no match | exactly one match |
| T-781-4 | `grep -nE '^\s{2}orch-0778-web-stripe-native-import-gate:\s*$' .github/workflows/strict-grep-mingla-business.yml` | no match | exactly one match |
| T-781-5 | `grep -nE '^\s{2}push:\s*$' .github/workflows/strict-grep-mingla-business.yml` | no match | at least one match (inside `on:` block) |
| T-781-6 | Synthetic regression A: introduce `import "@stripe/stripe-react-native"` at top of `mingla-business/app/_layout.tsx` (commit locally to a scratch ref), then run T-781-1 | n/a | exit 1, failure bullet names `mingla-business/app/_layout.tsx` |
| T-781-7 | Synthetic regression B: remove the `test:orch-0778` line from `mingla-business/package.json` (commit locally to a scratch ref), then run T-781-1 | n/a | exit 1, failure bullet begins with `ORCH-0781 wiring: mingla-business/package.json missing scripts["test:orch-0778"]` |
| T-781-8 | Synthetic regression C: remove the `orch-0778-web-stripe-native-import-gate:` job from the workflow yml (commit locally to a scratch ref), then run T-781-1 | n/a | exit 1, failure bullet begins with `ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml missing job orch-0778-web-stripe-native-import-gate` |
| T-781-9 | Synthetic regression D: remove the `push:` sub-block from the workflow `on:` block (commit locally to a scratch ref), then run T-781-1 | n/a | exit 1, failure bullet begins with `ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml on: block missing push trigger for [main, Seth]` |
| T-781-10 | At `ca69de38` (clone repo to `/tmp/orch-0781-ca69de38/`, `git checkout ca69de38`, copy the new SPEC-implemented `.mjs` over the old one), then run T-781-1 | n/a | exit 1 with at least four failure bullets covering import-scan + all three wiring checks |
| T-781-11 | At `b7431fe1` (clone repo to `/tmp/orch-0781-b7431fe1/`, `git checkout b7431fe1`, copy the new SPEC-implemented `.mjs` over the old one), then run T-781-1 | n/a | exit 1 with exactly three failure bullets covering all three wiring checks (no import-scan bullets) |

All synthetic-regression checks (T-781-6..T-781-9) MUST be run on a throwaway branch (`scratch/orch-0781-test-<id>`) and reverted before commit. Implementor MUST NOT push these synthetic regressions.

T-781-10 and T-781-11 are the canonical correctness proofs that this SPEC achieves what the investigation prescribed: the gate now fails at the exact two commits the investigation pinned, and would have caught the regression if any caller had invoked it.

## 11. CI / GitHub Verification Matrix

After implementation lands on the worktree branch `orch/0781-clean-tree-stripe-web-import-regression`, the operator opens a PR into `Seth` (or merges directly via the orchestrator's standard merge flow). The following GitHub Actions evidence MUST be captured before tester PASS:

| ID | Check | Expected |
|---|---|---|
| C-781-1 | GitHub Actions run on the PR shows a job named `ORCH-0778: Stripe native imports stay behind .native boundaries` | PRESENT and PASSING |
| C-781-2 | All other strict-grep jobs that ran prior to this SPEC continue to appear and pass | UNCHANGED count and outcome |
| C-781-3 | When the SPEC branch is merged (push event to `main` or `Seth`), the GitHub Actions UI shows a push-triggered run of the workflow | PRESENT |
| C-781-4 | A scratch push of synthetic regression A (Stripe RN import in `_layout.tsx`) to a scratch branch under `Seth` namespace triggers the workflow AND the ORCH-0778 job fails red | OPTIONAL but recommended — if skipped, document why in QA report |

If the operator's branch-protection rules do not yet require the workflow on push to `Seth`, that is acceptable. This SPEC does not require new branch-protection rules; it only requires that the workflow fires on push. Branch-protection tightening (require-checks-to-pass) is a separate META-ORCH and not in scope.

## 12. Documentation And Artifact Reconciliation

### 12.1 During implementation — NO doc edits

The implementor MUST NOT edit:

- `Mingla_Artifacts/DECISION_LOG.md` (DEC-137 text stays exactly as written by ORCH-0778).
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (I-PROPOSED-AE text stays exactly as written).
- `Mingla_Artifacts/WORLD_MAP.md`, `Mingla_Artifacts/MASTER_BUG_LIST.md`, `Mingla_Artifacts/PRIORITY_BOARD.md`, `Mingla_Artifacts/OPEN_INVESTIGATIONS.md`, `Mingla_Artifacts/AGENT_HANDOFFS.md`, `Mingla_Artifacts/WORKTREE_REGISTRY.md`, `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md`.
- Any `CLOSE_NOTE_ORCH-*.md` file.

Those updates are the orchestrator's responsibility at the standard CLOSE step, after tester PASS.

### 12.2 At CLOSE — append-only follow-up notes

The orchestrator (Codex `orchestrator-mingla`) MUST at CLOSE:

1. Append a one-line follow-up under DEC-137 in `Mingla_Artifacts/DECISION_LOG.md` of the form:
   ```
   - Follow-up (ORCH-0781, 2026-05-11+): Enforcement layer (npm script `test:orch-0778`, CI job `orch-0778-web-stripe-native-import-gate`, workflow `push` trigger for [main, Seth], and gate-script self-validation of its own wiring) was disarmed by commit `ca69de38` and re-armed by ORCH-0781. DEC-137's original decision text remains unchanged.
   ```
2. Refresh the `Codified:` line of `I-PROPOSED-AE STRIPE_REACT_NATIVE_NATIVE_BOUNDARY_ONLY` in `Mingla_Artifacts/INVARIANT_REGISTRY.md` to read:
   ```
   Codified: 2026-05-10 (DEC-137, ORCH-0778); re-armed 2026-05-11+ (ORCH-0781)
   ```
   No other invariant text is changed. Do NOT add new sub-bullets, do NOT rewrite the "Enforcement mechanism" or "Test that catches regression" lines — those become true again as soon as implementation lands.
3. Update `Mingla_Artifacts/WORLD_MAP.md` strict-grep section to reflect the now-present ORCH-0778 job, and add a "push-trigger present for main + Seth" note alongside the strict-grep workflow row.
4. Update `Mingla_Artifacts/WORKTREE_REGISTRY.md` to mark `orch-0781-clean-tree-stripe-web-import-regression` as CLOSED.
5. Update `Mingla_Artifacts/PRIORITY_BOARD.md`, `Mingla_Artifacts/MASTER_BUG_LIST.md`, and `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` per standard CLOSE protocol.
6. Register D-0781-2 (see §13) as a fresh entry in `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` so it is not lost.

The implementor's deliverable does NOT include any of these doc edits. If the implementor edits them, the tester MUST flag this as a scope-violation and request rework before PASS.

## 13. Deferred Follow-Ups

### 13.1 D-0781-2 — ORCH-0776A / ORCH-0777 strict-grep scripts appear npm-wired but not CI-wired

**Status:** OUT OF SCOPE for ORCH-0781. Register-only.

`ca69de38` added `.github/scripts/strict-grep/orch-0776a-video-upload-progress-honesty.mjs` and `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`, plus matching `test:orch-0776a` / `test:orch-0777` npm scripts in `mingla-business/package.json`. Neither script has a corresponding CI job in `.github/workflows/strict-grep-mingla-business.yml`. This is the same registry-pattern violation as F-0781-R3 (`new gate must add one script + one job, never replace existing jobs`).

**Why deferred:** scoping ORCH-0781 to the ORCH-0778 re-arm + push-trigger keeps this SPEC small, fast, and auditable. ORCH-0776A and ORCH-0777 are separate ORCHs with their own invariants, owners, and close-state. A wholesale "audit every orphan strict-grep script" pass risks broadening this SPEC into a meta-cleanup that delays the immediate Stripe-boundary repair.

**Registration target:** the orchestrator MUST at CLOSE add a row to `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` of the form:

```
| OPEN-INV-XXX | strict-grep CI orphans (ORCH-0776A + ORCH-0777) — npm scripts present in mingla-business/package.json, no matching CI job in strict-grep-mingla-business.yml; same registry-pattern violation class as F-0781-R3. Audit-only follow-up; do NOT close-rearm in ORCH-0781. | P2 | open | spawned 2026-05-11 by ORCH-0781 |
```

The exact `OPEN-INV-XXX` ID is the orchestrator's choice. The follow-up itself runs as its own META-ORCH at the operator's discretion.

### 13.2 D-0781-1 — strict-grep workflow push-trigger scope

**Status:** PARTIALLY IN SCOPE for ORCH-0781. The push trigger is added in §7.2 for the `mingla-business` strict-grep workflow only.

If other strict-grep workflows exist for `app-mobile` or `mingla-admin` (this SPEC does not audit that), those workflows MAY have the same PR-only trigger gap. Auditing and patching them is OUT OF SCOPE.

**Registration target:** the orchestrator MAY add an OPEN-INV row at CLOSE if the operator wants a sweep of all strict-grep workflows for push-trigger coverage. This is operator-discretion, not an ORCH-0781 hard requirement.

### 13.3 D-0781-3 / D-0781-4 — process drift discoveries

The investigation's D-0781-3 (CLOSE-checklist amendment to act on D-0778-QA-2-style reconciliation discoveries) and D-0781-4 (split future "Clean tree"-style sweeps per-ORCH) are META-ORCH process concerns owned by Codex `orchestrator-mingla`. NOT part of this SPEC's implementation. Mentioned here only so they are not lost.

## 14. Implementation Order

The implementor MUST follow this order. All four steps land in a SINGLE commit on `orch/0781-clean-tree-stripe-web-import-regression`. No intermediate commits; no rebases.

1. **Edit `mingla-business/package.json`:** add trailing comma to `test:orch-0777` line; insert `test:orch-0778` line per §8.
2. **Edit `.github/workflows/strict-grep-mingla-business.yml`:**
   - Add the `push:` sub-block to the `on:` block per §7.2.
   - Add the ORCH-0778 registry comment line per §7.1.
   - Append the `orch-0778-web-stripe-native-import-gate:` job block at the end of `jobs:` per §7.3.
3. **Edit `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs`:** add the three wiring self-checks per §9. Preserve the existing import-scan behavior unchanged. Preserve the existing success message exactly.
4. **Verify locally:** run T-781-1 through T-781-9 from §10. Re-clone `ca69de38` and `b7431fe1` to scratch dirs and run T-781-10 / T-781-11. Capture exit codes and the literal stdout/stderr of each run.
5. **Write the implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md` using the standard implementor template (Summary / Old→New per file / Verification receipts / Discoveries / Confidence).
6. **Commit on `orch/0781-clean-tree-stripe-web-import-regression`** with message exactly:
   ```
   ORCH-0781: re-arm Stripe web import gate (npm + CI + push + self-validate)
   ```
   No multi-line body, no Co-Authored-By line (per user preference).
7. **Hand back to operator.** The operator routes to Claude `mingla-tester` for TEST mode (canonical per 2026-05-10 reversal).

## 15. Handoff To Implementor

**Target skill:** Codex `implementor-mingla` (Codex side, not Claude).

**Working tree:** `.worktrees/orch-0781-clean-tree-stripe-web-import-regression/`. Open the implementor at that path; do NOT operate from `Users/sethogieva/Desktop/mingla-main/` (main checkout).

**Required reads before any edit:**

- This SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`
- Orchestrator review: `Mingla_Artifacts/reports/REVIEW_INVESTIGATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`
- ORCH-0778 implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0778_ORCH0777_WEB_EXPORT_STRIPE_NATIVE_IMPORT_GATE.md`
- DEC-137 in `Mingla_Artifacts/DECISION_LOG.md`
- I-PROPOSED-AE in `Mingla_Artifacts/INVARIANT_REGISTRY.md`

**Hard guards (REPEAT FROM §5):**

- Touch only the three files listed in §6 (plus the new implementation report).
- Do NOT edit `_layout.tsx`, `payment.tsx`, or any `src/payments/*` file.
- Do NOT edit any other `.github/scripts/strict-grep/*.mjs` script.
- Do NOT add a new workflow file.
- Do NOT edit DEC-137, I-PROPOSED-AE, or any tracker document — those are CLOSE-only edits owned by the orchestrator.
- Do NOT run `supabase db push`, `supabase functions deploy`, `eas update`, or `eas build`. This SPEC has no DB, no edge function, no mobile bundle component.
- Do NOT alphabetize or reorder `package.json` scripts.
- Do NOT reorder existing strict-grep workflow jobs or registry-comment lines.
- Do NOT introduce a YAML parser dependency in the gate script.

**Deliverable:**

- Modified files per §6 / §7 / §8 / §9.
- New file: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md` with all eleven test receipts (T-781-1 through T-781-11) and explicit exit codes.
- Single commit per §14 step 6.

**Routing after implementor returns:** route back to operator; operator dispatches Claude `mingla-tester` for TEST mode against this SPEC. After TEST PASS, operator dispatches Codex `orchestrator-mingla` for CLOSE.

---

## Spec Verdict

**Spec Verdict: READY FOR IMPLEMENTATION**

Implementor prompt title to write next (orchestrator action):

```
Mingla_Artifacts/prompts/IMPLEMENT_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md
```

**Operator action required before implementation:**

None blocking. The worktree `.worktrees/orch-0781-clean-tree-stripe-web-import-regression/` is created and on branch `orch/0781-clean-tree-stripe-web-import-regression` at HEAD `b7431fe1`. The strict-grep workflow has a `push:` trigger only after implementation lands, so the first time the workflow fires on push for `Seth` will be when this branch (or a downstream merge) is pushed. That is expected and acceptable.
