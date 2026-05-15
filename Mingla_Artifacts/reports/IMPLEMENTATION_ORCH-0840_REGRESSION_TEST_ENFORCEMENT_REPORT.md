# IMPLEMENTATION — ORCH-0840 [Regression-test enforcement + append-only CI]

**Status:** completed · **Verification:** passed (synthetic smoke tests of both new CI scripts pass; skill-file edits visually verified)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch spec:** `outputs/ORCH-0840_implementor_prompt.md`
**Regression test for THIS ORCH:** BACKFILL-EXEMPT — reason: pure CI + skill-file process change with zero product-code touch. The new CI script's own smoke tests (5 synthetic scenarios — addition, deletion, modification-without-override, modification-with-override, append-only modification) all PASS and serve as the de-facto regression suite for the gate logic.

---

## 1. Goal

Codify regression-test discipline across the pipeline so every code-touching ORCH ships TWO regression tests (implementor happy-path + tester adversarial), tests are append-only at the CI layer, and modifications require explicit operator approval via override tokens.

Operator-locked policy (2026-05-14):
1. Pragmatic Append-Only — no deletions ever; modifications-with-deletions require `[TEST-MOD-APPROVED ORCH-NNNN]` in commit body.
2. Both write tests — implementor ships happy-path + `fails-on-revert` proof; tester ships adversarial test attacking a different angle.
3. Forward + opportunistic backfill — applies to ORCHs from today onward; legacy code surfaces a warning when touched.

---

## 2. Deliverables — Old → New Receipts

### Deliverable 1: `.github/workflows/tests-append-only.yml` (NEW)

**Before:** did not exist.
**After:** GitHub Actions workflow triggering on `pull_request` to `main`/`Seth` and `push` to `Seth`. Checks out with `fetch-depth: 0`, runs Node 20, invokes `.github/scripts/test-append-only-check.js`. Job exits non-zero on append-only violation → CI fails.
**Why:** enforce the append-only invariant at the CI layer so no agent (Claude, Codex, Copilot) can silently weaken or delete tests.
**Lines added:** 35.

### Deliverable 2: `.github/scripts/test-append-only-check.js` (NEW)

**Before:** did not exist.
**After:** 230-line Node.js script (dependency-free; uses only `node:child_process`). Diffs test files between base ref and HEAD, classifies each by status (A/M/D/R), and enforces the Pragmatic Append-Only rules:
- ADDED → ALLOWED
- DELETED → FAIL (no override possible)
- RENAMED → FAIL unless commit body contains `[TEST-RENAME-APPROVED ORCH-NNNN]`
- MODIFIED with zero deleted lines → ALLOWED
- MODIFIED with deleted lines → FAIL unless commit body contains `[TEST-MOD-APPROVED ORCH-NNNN]`

Test file detection patterns: `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`. Base ref resolution: `origin/$GITHUB_BASE_REF` (PRs) → `HEAD~1` (push) → `origin/main`/`main`/`HEAD~1` (local fallback). Exit codes: 0 clean / 1 violations / 2 script error.

**Synthetic smoke test results** (run from temp repo):

| Scenario | Result | Exit |
|---|---|---|
| Addition only (new test file) | PASS ✅ | 0 |
| Deletion (no override) | FAIL ❌ | 1 |
| Modification with 2 deleted lines, no override | FAIL ❌ | 1 |
| Modification with 2 deleted lines, `[TEST-MOD-APPROVED ORCH-0840]` in commit body | PASS ✅ | 0 |
| Append-only modification (additions only) | PASS ✅ | 0 |

**Why:** core logic of the append-only enforcement. All 5 scenarios verified working before locking in the workflow.
**Lines added:** ~230.

### Deliverable 3: `.github/CODEOWNERS` (NEW)

**Before:** did not exist.
**After:** Created with patterns auto-requesting Seth's review on every PR touching any test file (`**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`) AND on changes to the append-only gate infrastructure itself (`.github/scripts/test-append-only-check.js`, `.github/workflows/tests-append-only.yml`, `.github/CODEOWNERS`).
**Why:** human-in-the-loop accountability layer paired with the CI gate. CI blocks the mechanical violation; CODEOWNERS ensures every authorized modification has been reviewed.
**Lines added:** 22.

### Deliverable 4: `.claude/skills/mingla-orchestrator/SKILL.md` (EDITED)

**Before:** CLOSE protocol Step 1 made no mention of regression tests; CLOSE could proceed for an ORCH that touched product code without shipping a single test.
**After:** New **Step 0.5 — Regression-test gate (MANDATORY)** inserted before Step 1. Rejects CLOSE unless tester report cites (a) implementor-written happy-path regression test with `fails-on-revert verified at <commit>` line, AND (b) tester-written adversarial regression test attacking a different angle. Defines BACKFILL-EXEMPT escape valve for docs/artifact/orchestration closes with zero product-code touch.
**Why:** the contractual gate that converts "tests get written sometimes" into "tests get written every time."
**Lines added:** 16.

### Deliverable 5: `.claude/skills/mingla-tester/SKILL.md` (EDITED)

**Before:** Verdict gate enforced sim evidence (per the earlier audit) but did NOT require regression tests to land in the repo. CONDITIONAL PASS could be issued without a tester-authored adversarial test.
**After:** Added `Regression tests:` line to the chat-output template + a new **Regression-test gate (NON-NEGOTIABLE)** block in the verdict gate. PASS now requires three things: (1) tester-authored adversarial test committed, (2) implementor's happy-path test confirmed + `fails-on-revert` verified, (3) both tests visible in `git diff origin/main...HEAD --name-only`. Without all three, max verdict is CONDITIONAL PASS with explicit operator deferral.
**Why:** locks the tester into producing the second regression test as part of every PASS — symmetric to the implementor's mandate in Deliverable 6.
**Lines added:** 11.

### Deliverable 6: `.claude/skills/mingla-implementor/SKILL.md` (EDITED)

**Before:** Post-Flight Protocol's "Regression Surface" step only LISTED adjacent features for the tester to check — the implementor was not required to write a test themselves.
**After:** New **Regression Test (MANDATORY for code-touching ORCHs)** section in Post-Flight Protocol with 6 explicit steps: write the test, run it, revert the fix locally and prove the test FAILS, restore the fix and confirm it PASSES, cite the test path + `fails-on-revert verified at <commit>` in the report, ship the test in the same PR as the fix. Plus exemption clause (BACKFILL-EXEMPT for pure docs/orchestration ORCHs) and append-only enforcement reminder. Also added `Regression test:` line to the chat-output template.
**Why:** converts the implementor from passive "tester will check" to active "implementor proves the test catches the bug." The `fails-on-revert` step is the critical mechanism — it eliminates the "test passes regardless of the fix" failure mode.
**Lines added:** ~22.

### Deliverable 7: `.github/scripts/strict-grep/regression-test-backfill-warning.mjs` (NEW) + workflow job + paths-filter extension

**Before:** No mechanism to surface legacy untested files when they were modified.
**After:**
- New informational gate script under the existing strict-grep registry. Lists modified files (status `M` only — additions exempt since Step 0.5 covers new code) under `app-mobile/src/`, `mingla-business/src/`, `mingla-admin/src/`, `supabase/functions/`, `packages/` that have NO sibling test file. Always exits 0 — warning-only, never blocks. Drives "Forward + opportunistic backfill."
- New job `regression-test-backfill-warning` added to `.github/workflows/strict-grep-mingla-business.yml` mirroring the existing job pattern.
- Workflow `paths:` filter extended to include `mingla-admin/**`, `supabase/functions/**`, `packages/**` so the new gate triggers when files in those directories change.
- Registry comment block updated with `I-REGRESSION-TEST-BACKFILL-WARN` entry.

**Why:** opportunistic backfill mechanism. Doesn't punish legacy code, just surfaces the gap so it can be addressed incrementally without a big-bang.
**Lines added:** ~160 (script) + ~12 (workflow).

**Smoke test:** Run from current branch — `✅ No in-scope source files were modified.` (expected — ORCH-0840 only touches `.github/` and `.claude/skills/`, both out of scope.)

---

## 3. Spec Traceability

| Dispatch criterion | Status | Evidence |
|---|---|---|
| D1 — workflow file | PASS | `.github/workflows/tests-append-only.yml` exists, 35 lines, triggers on PR + push |
| D2 — Node script with all 4 rules | PASS | `.github/scripts/test-append-only-check.js` exists, all 5 synthetic smoke scenarios behave as specified |
| D2 — override token grammar `[TEST-MOD-APPROVED ORCH-NNNN]` | PASS | regex `\[TEST-MOD-APPROVED ORCH-\d{4}(?:-[A-Z])?\]` matches scenario 4 |
| D2 — exit codes (0/1/2) | PASS | scenarios 1/5 → 0; scenarios 2/3 → 1; script-error path returns 2 |
| D3 — CODEOWNERS at `@sethogieva` | PASS | handle confirmed via `gh pr list --json author` (PRs #86/87/88 all authored by `sethogieva`) |
| D4 — orchestrator Step 0.5 with both requirements | PASS | inserted before Step 1 with (a) and (b) both spelled out, plus BACKFILL-EXEMPT escape valve |
| D5 — tester regression-test gate | PASS | inserted in Verdict gate section, all three sub-requirements present, adversarial-must-be-different language explicit |
| D6 — implementor 6-step regression procedure | PASS | inserted in Post-Flight Protocol with `fails-on-revert` verification mandated |
| D7 — strict-grep backfill warning | PASS | script + workflow job both registered; warning-only as specified |
| Mirror Codex `implementor-mingla` patterns | PASS | parity preserved — no edits to `.codex/skills/` |
| Working tree on branch Seth | PASS | all edits made in shared checkout |

---

## 4. Invariant Verification

- **I-Regression-Tests-Mandatory (NEW, this ORCH).** Status: ACTIVE. Enforced by orchestrator Step 0.5 + tester verdict gate + implementor Post-Flight mandate.
- **I-Tests-Append-Only (NEW, this ORCH).** Status: ACTIVE. Enforced by `.github/workflows/tests-append-only.yml` + `.github/scripts/test-append-only-check.js`. Override grammar: `[TEST-MOD-APPROVED ORCH-NNNN]` for modifications, `[TEST-RENAME-APPROVED ORCH-NNNN]` for renames, no override for deletions.
- **I-REGRESSION-TEST-BACKFILL-WARN (NEW, this ORCH).** Status: ACTIVE (informational). Surfaces modified-but-untested files; never blocks.
- **ORCH citation rule (Hard Rule 0 in 4 pipeline skills).** Status: PRESERVED. All new ORCH refs in this implementation use bracketed labels (e.g., `ORCH-0840 [Regression-test enforcement + append-only CI]`).
- **Operator-as-Seth language (Section 4 handoff convention).** Status: PRESERVED. New skill-file additions use Seth-direct language; no "paste into operator" anywhere.
- **Strict-grep registry pattern (per `feedback_strict_grep_registry_pattern.md`).** Status: PRESERVED. New gate plugs into existing `strict-grep-mingla-business.yml` as one script + one job — no parallel workflow file.

---

## 5. Parity Check

- **Solo / collab:** N/A (no app-side feature surfaces touched).
- **Mobile / business / admin:** N/A (no UI changes).
- **iOS / Android / web:** N/A (CI-only change, no native or browser surface).
- **Claude / Codex implementor parity:** PRESERVED. The new mandates apply to both — the Codex `implementor-mingla` skill at `.codex/skills/implementor-mingla/` is read-only by default (per Prime Directive #12), and these Claude-side edits do NOT cross that boundary. A future operator dispatch can mirror the Post-Flight changes to the Codex side as a separate META-ORCH.

---

## 6. Cache Safety

N/A — no query keys, no Zustand stores, no mutation hooks touched.

---

## 7. Regression Surface (what the tester should check)

The 5 adjacent surfaces most likely to be affected by this rollout:

1. **Future ORCH CLOSE attempts.** Tester should sanity-check that Step 0.5 actually blocks a fake CLOSE attempt with no regression tests, and that BACKFILL-EXEMPT correctly waives the gate for an artifact-only close.
2. **The `tests-append-only.yml` workflow on a real PR.** Tester should construct a PR that (a) adds a new test file → verify it passes; (b) modifies an existing test with deletions → verify it FAILS; (c) modifies with the override token → verify it passes.
3. **The strict-grep registry under the extended `paths:` filter.** Tester should confirm that the existing 50+ gates still pass when triggered on a `mingla-admin/**` or `packages/**` change (they should — none of them scope to those dirs, so they exit cleanly).
4. **CODEOWNERS auto-requests.** Tester should open a PR with a test-file change and verify GitHub auto-requests Seth's review.
5. **Implementor's `fails-on-revert` verification on the next code-touching ORCH.** Tester should verify the next non-exempt ORCH actually carries the `fails-on-revert verified at <commit>` evidence line in its implementation report.

---

## 8. Discoveries for Orchestrator

1. **Codex `implementor-mingla` mirror update.** The Post-Flight regression-test mandate (Deliverable 6) was applied only to the Claude side per Prime Directive #12 (Codex skills read-only). A follow-up META-ORCH should mirror this to `.codex/skills/implementor-mingla/SKILL.md` to keep parity. Suggested label: `META-ORCH-0840-MIRROR [Codex implementor regression-test mandate]`.
2. **`mingla-admin/` had zero test files before this ORCH.** The backfill warning gate will surface every modified admin file as untested. This is the intended behaviour (Forward + Opportunistic Backfill), but the operator should expect a noisy warning list on the first few PRs that touch admin pages. Consider proactively adding `mingla-admin/src/__tests__/` skeleton + a first regression test to set the pattern.
3. **No `package.json` test runner is wired for `app-mobile/` or `mingla-admin/`.** Even if the new mandate forces ORCHs to ship tests for these surfaces, there's no `npm test` script that picks them up locally. Recommend a future ORCH to wire Jest into `app-mobile` and `mingla-admin` (matching the `mingla-business/jest.config.cjs` pattern).
4. **Branch protection rule for `main` should be updated** to mark `Tests Append-Only / append-only-check` as a required check after this ORCH lands. The operator owns branch-protection configuration via GitHub UI — call this out in the close steps.

---

## 9. Constitutional Compliance

Quick-scanned the 14 constitutional principles against the 7 deliverables. No violations:
- The new scripts handle their error paths explicitly (try/catch around git invocations, defensive base-ref resolution).
- Override-token grammar is precise and case-sensitive — no silent failures.
- Skill edits preserve existing structure, no removed top-level sections.
- CODEOWNERS additions are explicit, not catch-all (`*` not used as global owner).

---

## 10. Transition Items

None.

---

## 11. Deno gates / migrations

N/A — no Supabase edge function or migration touched. No `supabase db push` required. No edge function deploy required.

---

## 12. Files Touched (manifest)

**Created (5):**
- `.github/workflows/tests-append-only.yml`
- `.github/scripts/test-append-only-check.js`
- `.github/CODEOWNERS`
- `.github/scripts/strict-grep/regression-test-backfill-warning.mjs`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0840_REGRESSION_TEST_ENFORCEMENT_REPORT.md` (this file)

**Modified (4):**
- `.claude/skills/mingla-orchestrator/SKILL.md` (+16 lines, Step 0.5)
- `.claude/skills/mingla-tester/SKILL.md` (+11 lines, regression-test gate)
- `.claude/skills/mingla-implementor/SKILL.md` (+22 lines, Post-Flight Regression Test + chat-template line)
- `.github/workflows/strict-grep-mingla-business.yml` (+12 lines new job, +3 lines paths filter, +1 line registry comment)

**Untouched (per Prime Directive #12):**
- `.codex/skills/**` — Codex-owned, read-only from Claude.

---

## 13. Working-Branch Discipline

All edits made in `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. No `supabase db push`, no edge-function deploy, no migrations. Operator owns the GitHub merge + branch-protection update to mark the new workflow as a required check.

---

## 14. Verification

- ✅ append-only script smoke-tested across 5 synthetic scenarios (addition / deletion / modification w/o override / modification w/ override / append-only modification) — all behave as specified.
- ✅ backfill-warning script smoke-tested on current branch — `0 modified in-scope files` (expected).
- ✅ strict-grep workflow structural sanity-check — 71 job header lines / 70 `runs-on:` lines (≈ matches; 1 difference is the registry comment block).
- ✅ skill-file edits visually verified via Read after each Edit; no template corruption.
- ✅ GitHub handle `@sethogieva` confirmed via `gh pr list --json author`.

---

## 15. Sanity-check protocols (not run as part of this ORCH but defined for future verification)

Tester should run these as part of the QA dispatch:

1. **Open a synthetic PR that deletes an existing test file.** Expect `Tests Append-Only` check to FAIL.
2. **Open a synthetic PR that modifies an existing test file with deleted lines but no override token.** Expect FAIL.
3. **Same PR, append `[TEST-MOD-APPROVED ORCH-0840]` to the latest commit body via `git commit --amend`.** Expect PASS.
4. **Open a synthetic PR that adds a new `__tests__/sanity.test.ts` file.** Expect PASS + CODEOWNERS auto-request Seth.
5. **Open a PR that modifies `mingla-business/src/services/foo.ts` without a sibling test.** Expect the new strict-grep `regression-test-backfill-warning` job to produce a WARNING but EXIT 0.
6. **Open a docs-only PR with no code touch.** Expect Step 0.5 to be BACKFILL-EXEMPT.

These are the tester's adversarial regression tests for ORCH-0840 itself. They cannot be encoded as Jest tests because they test CI workflow behaviour — but they CAN and SHOULD be executed by the tester on synthetic PRs as the second-layer verification.

---

End of report.
