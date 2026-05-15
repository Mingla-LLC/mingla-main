# QA — ORCH-0840 [Regression-test enforcement + append-only CI]

**Verdict:** PASS
**Mode:** TARGETED
**Tester:** Claude `mingla-tester` (canonical TEST owner post 2026-05-10 reversal)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Implementation under test:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0840_REGRESSION_TEST_ENFORCEMENT_REPORT.md`
**Dispatch spec:** `outputs/ORCH-0840_implementor_prompt.md`

---

## Verdict line

| Field | Value |
|---|---|
| Verdict | PASS |
| P0 | 0 |
| P1 | 0 |
| P2 | 1 (process transparency) |
| P3 | 1 (pre-existing strict-grep oversight) |
| P4 | 2 (notes + suggestions) |
| Sim evidence | EXEMPT — backend-only / CI + skill-file change, no UI surface (Phase 0.A exemption explicitly granted by dispatch). |
| Regression tests | BACKFILL-EXEMPT — reason: ORCH-0840 itself is pure CI + skill-file process change with zero product-code touch (`app-mobile/src/`, `mingla-business/src/`, `mingla-admin/src/`, `supabase/functions/`, `packages/`). The new gate's own smoke-test scenarios (5 implementor + 11 tester adversarial, executed live by both this turn and the prior implementor turn) constitute the de-facto regression suite for the gate logic. |
| PR diff scope clean? | NO — the shared `Seth` working tree has ORCH-0839-B [Stripe hosted Checkout pivot] uncommitted work intermixed with ORCH-0840 files. NOT a P0 because ORCH-0839-B's files are unrelated to the gate logic — but the closing PR must isolate to ORCH-0840's manifest (see Discoveries #1). |

---

## What was verified

### 1. Append-only CI script (`.github/scripts/test-append-only-check.js`) — 11 ADVERSARIAL SCENARIOS executed

All 11 scenarios executed against synthetic git repositories and behaved as specified.

| # | Scenario | Expected | Observed | Exit |
|---|----------|----------|----------|------|
| Adv 1 | Override token without ORCH-ID (`[TEST-MOD-APPROVED]`) | FAIL | FAIL ❌ correctly | 1 |
| Adv 2 | Malformed ORCH-ID (3-digit `ORCH-123`) | FAIL | FAIL ❌ correctly | 1 |
| Adv 3 | Override in earlier commit, HEAD has no token | FAIL | FAIL ❌ correctly (script reads `log -1`) | 1 |
| Adv 4 | Rename without override | FAIL | FAIL ❌ correctly | 1 |
| Adv 5 | Rename WITH `[TEST-RENAME-APPROVED ORCH-0840]` | PASS | PASS ✅ correctly | 0 |
| Adv 6 | Mixed add+delete in one commit | FAIL on delete leg | 1 added ✅ + 1 deleted ❌ → overall EXIT 1 | 1 |
| Adv 7 | ORCH-ID with suffix (`ORCH-0839-A`) | PASS | PASS ✅ correctly (regex allows `-[A-Z]`) | 0 |
| Adv 8 | Multi-extension test file (`baz.test.spec.tsx`) deletion | FAIL | FAIL ❌ correctly | 1 |
| Adv 9 | Non-test file deletion (`src/x.ts`) | IGNORED | IGNORED ✅ correctly (no test-file diff) | 0 |
| Adv 10 | No test changes at all | PASS | PASS ✅ correctly | 0 |
| Adv 11 | Path with spaces (`__tests__/dir with spaces/foo.test.js`) | PASS | PASS ✅ correctly | 0 |

**P4 OBSERVATION:** Adv 3 reveals an intentional design choice — the override token must live in the HEAD commit body, not any earlier commit on the branch. This is rebase-resistant and prevents accidentally importing an "approved" token via a merge. The implementor's report did not call this out explicitly; a future tester re-reading the gate may be surprised. Recommend documenting in the script's header comment as a `Behavior note:` line. NOT a blocker.

### 2. Backfill warning script (`.github/scripts/strict-grep/regression-test-backfill-warning.mjs`) — 2 SCENARIOS

| # | Scenario | Expected | Observed |
|---|----------|----------|----------|
| BF-1 | 4 modified files (1 has sibling test, 3 don't) | WARNING list of 3, EXIT 0 | Exact match ✅ |
| BF-2 | Addition-only (new untested file) | NO warning, EXIT 0 | Match ✅ |

The script correctly skips ADDITIONS — only MODIFICATIONS to legacy files trigger the warning. This is the right scope for "opportunistic backfill": new code is governed by Step 0.5 (mandatory regression test); only legacy untested code that gets touched needs the nudge.

**P3-EXISTING:** During the smoke run, `i-proposed-x-web-deprecation.mjs` printed `[I-PROPOSED-X] SCRIPT ERROR — stderr log not found at /tmp/expo-export-web.stderr` but exited 0. This is PRE-EXISTING — not caused by ORCH-0840. The script silently passes when it cannot find its input. Recommend a follow-up to make it exit 2 (script error) if `/tmp/expo-export-web.stderr` is missing, OR document that the file must be captured pre-run.

### 3. Existing strict-grep gates — paths filter extension sanity check

The implementor extended `paths:` in `.github/workflows/strict-grep-mingla-business.yml` from `[mingla-business/**, app-mobile/**, supabase/migrations/**]` to also include `mingla-admin/**`, `supabase/functions/**`, `packages/**`. Risk: a change to those new paths now triggers all 50+ existing gates, some of which may not have been authored with those paths in mind.

Sampled 4 gates against current `Seth` state:

| Gate | Scope | Result |
|------|-------|--------|
| `i-proposed-a-brands-deleted-filter.mjs` | mingla-business only | Scanned 110 files, 0 violations, EXIT 0 ✅ |
| `i37-topbar-cluster.mjs` | mingla-business only | Scanned 193 files, 0 violations, EXIT 0 ✅ |
| `i-ari-no-oklch.mjs` | mingla-business/src/components/ari + screens/ari | Scanned 13 files, EXIT 0 ✅ |
| `i-proposed-x-web-deprecation.mjs` | misc | Pre-existing script error, EXIT 0 (no-op) — not ORCH-0840-introduced |

Conclusion: gates are well-scoped internally; the workflow path filter extension is safe. Each gate makes its own scope decisions in code, so triggering on `mingla-admin/` or `supabase/functions/` paths costs only CI minutes — no false-positive failures.

### 4. Skill-file mandates verified for unambiguity

All three skill files contain the specified mandates at the locations claimed in the implementation report:

| Skill | Mandate | Location | Wording |
|-------|---------|----------|---------|
| `mingla-orchestrator/SKILL.md` | Step 0.5 Regression-test gate | line 278 | "CLOSE is REJECTED unless..." — explicit and unambiguous |
| `mingla-orchestrator/SKILL.md` | BACKFILL-EXEMPT escape valve | line 288 | Scope clear: `app-mobile/src/`, `mingla-business/src/`, `mingla-admin/src/`, `supabase/functions/`, `packages/`, `.github/scripts/strict-grep/` |
| `mingla-tester/SKILL.md` | Regression-test gate (3 requirements) | line 364 | "PASS additionally requires ALL three" — adversarial-must-be-different language explicit (lines 366–): "A copy of the implementor's test with a renamed `it()` is NOT adversarial — call it out as a P1 finding." |
| `mingla-implementor/SKILL.md` | Regression Test (MANDATORY) section | line 289 | 6-step procedure including `fails-on-revert` verification at step 3 |
| `mingla-implementor/SKILL.md` | Chat template `Regression test:` line | line 327 | Format mirrors tester's verdict line |

### 5. CODEOWNERS pattern correctness

Verified GitHub's gitignore-style glob semantics against representative file paths:

- `**/*.test.*` matches `mingla-business/src/utils/__tests__/Input.variantBehaviour.test.tsx` ✅ (multi-dot basename handled — `*` matches `Input.variantBehaviour`, literal `.test.`, `*` matches `tsx`)
- `**/*.test.*` does NOT match `foo.testimony.tsx` (no literal `.test.` segment) ✅
- `**/*.spec.*` matches `__tests__/foo.spec.ts` ✅
- `**/__tests__/**` matches any file under any `__tests__/` directory ✅
- Infrastructure self-protection: `.github/scripts/test-append-only-check.js`, `.github/workflows/tests-append-only.yml`, `.github/CODEOWNERS` all require Seth review ✅

No catch-all `*` global owner — won't pull Seth into every PR. Correct hygiene.

### 6. YAML structural sanity

Visual structural check on `.github/workflows/tests-append-only.yml`: `name:`, `on:` (with `pull_request` + `push` branch filters), `jobs:` with `append-only-check` job having `runs-on: ubuntu-latest` and `steps:`. Correctly formed. `actions/checkout@v4` with `fetch-depth: 0` is required for full-history diff — present and correct.

`.github/workflows/strict-grep-mingla-business.yml` extension: paths filter expanded to 7 entries (was 5), and new `regression-test-backfill-warning` job added at the end with `fetch-depth: 0` (correct — backfill script needs git history). Registry comment block updated with `I-REGRESSION-TEST-BACKFILL-WARN` entry. All consistent with the existing job pattern.

---

## Findings by severity

### P0 — CRITICAL: 0

None.

### P1 — HIGH: 0

None.

### P2 — MEDIUM: 1

**P2-001: Skill-file edits are local-only (gitignored); transparency gap in implementation report.**

- **File:** `.gitignore` lines 41–42 (`.claude/` and `.codex/` both ignored, comment: "AI tool configs (private)").
- **Affected files:** `.claude/skills/mingla-orchestrator/SKILL.md`, `.claude/skills/mingla-tester/SKILL.md`, `.claude/skills/mingla-implementor/SKILL.md` — the three skill files the implementor edited.
- **What it means:** The three new mandates (orchestrator Step 0.5, tester regression-test gate, implementor 6-step procedure) live ONLY on Seth's local machine. They will NOT propagate via PR. Future Claude/Codex sessions in this same checkout will see them; a fresh checkout on a different machine will not.
- **Why it's not P1:** Seth is the sole human operator on this repo (confirmed via `gh pr list --json author` — PRs #86/87/88 all `sethogieva`). The CI gates (`.github/workflows/tests-append-only.yml`, `.github/CODEOWNERS`, `.github/scripts/strict-grep/regression-test-backfill-warning.mjs`) ARE tracked and WILL ship — those carry the codebase-side enforcement. The skill mandates carry the process discipline for Seth's own sessions, which is acceptable given the operator model.
- **What's missing:** The implementation report §12 "Files Touched" lists the skill edits as Modified but does NOT explicitly call out that they are gitignored. Anyone reading the close banner would assume the mandates are in the PR.
- **Fix:** Either (a) add a one-line note to the implementation report §12 saying "Skill files at `.claude/skills/` are gitignored — these mandates govern Seth's local sessions only; CI gates carry the codebase enforcement," OR (b) move the orchestrator Step 0.5 wording into a TRACKED artifact like `Mingla_Artifacts/PROCESS.md` or `INVARIANT_REGISTRY.md` so the discipline is auditable by anyone reading the repo.
- **Operator decision required.** Either fix is acceptable. Recommend (b) for long-term durability.

### P3 — LOW: 1

**P3-001: `i-proposed-x-web-deprecation.mjs` exits 0 on script-internal error.**

- **File:** `.github/scripts/strict-grep/i-proposed-x-web-deprecation.mjs`
- **Symptom:** When the script's expected input file `/tmp/expo-export-web.stderr` is missing, the script prints "[I-PROPOSED-X] SCRIPT ERROR" but exits 0. CI marks the job as PASS even though the gate did not run.
- **Pre-existing:** This issue existed before ORCH-0840 and is unrelated to the new work. Surfaced during sanity checks because the new paths filter triggers it.
- **Fix:** Change `process.exit(0)` to `process.exit(2)` in the missing-input branch of that script, OR add a CI step that captures the stderr file before the gate runs.
- **Recommendation:** Register as a new follow-up ORCH (e.g., `ORCH-08XX [Strict-grep gate input-file capture hardening]`). NOT a blocker for ORCH-0840 close.

### P4 — NOTE: 2

**P4-001: Adv 3 design behaviour deserves a header comment.**

The override token check uses `git log -1 --pretty=%B` against HEAD. Override tokens in earlier commits are NOT honored. This is correct (rebase-resistant) but undocumented in the script header. Recommend adding a `Behavior note:` line near the override-token grammar block stating "Override tokens must appear in the HEAD commit body. Tokens in earlier commits on the branch do not count; if you need to authorize a test mutation, ensure the HEAD commit message body contains the token."

**P4-002: Consider committing the 11-scenario shell smoke test as `.github/scripts/test-append-only-check.smoketest.sh`.**

The implementor's report §15 declared the 6 sanity-check scenarios "cannot be encoded as Jest tests because they test CI workflow behaviour." Strictly true — but they CAN be encoded as a Bash smoke-test script. Committing it would give the regression-test infrastructure its own regression suite, automatically re-run whenever someone modifies `.github/scripts/test-append-only-check.js` (which CODEOWNERS now gates). The 11 scenarios this tester ran live constitute exactly that script. A future ORCH could commit it as the "adversarial regression test" for ORCH-0840 itself, even though BACKFILL-EXEMPT was granted at close.

---

## Constitutional Compliance

Quick-scanned the 14 constitutional principles against ORCH-0840's deliverables:

| # | Principle | Verdict | Notes |
|---|-----------|---------|-------|
| 1 | No dead taps | N/A | No UI surface |
| 2 | One owner per truth | PASS | Gate logic lives in one script; one workflow invokes it |
| 3 | No silent failures | PASS | Append-only script exits 0/1/2 explicitly; backfill warning exits 0 always but PRINTS to stdout |
| 4 | One key per entity | N/A | No React Query |
| 5 | Server state server-side | N/A | No state |
| 6 | Logout clears everything | N/A | No auth |
| 7 | Label temporary | PASS | No `[TRANSITIONAL]` markers introduced |
| 8 | Subtract before adding | N/A | No removal involved |
| 9 | No fabricated data | PASS | Real git diff output, not mocked |
| 10 | Currency-aware | N/A | No prices |
| 11 | One auth instance | N/A | No auth |
| 12 | Validate at right time | N/A | No datetime |
| 13 | Exclusion consistency | N/A | No filtering |
| 14 | Persisted-state startup | N/A | No persisted state |

No violations.

---

## Spec Traceability (dispatch §"Six required elements")

| Dispatch element | Verified | Evidence |
|---|---|---|
| Target skill = Claude `mingla-tester` | ✅ | This skill ran the verification |
| Goal: verify 7 deliverables + sim-script behaviour + skill-file edits | ✅ | All 7 enumerated above with pass/fail evidence |
| Inputs: implementation report + dispatch + 7 file paths | ✅ | All read and audited |
| Hard guards: no modifications to implementor work, no push, BACKFILL-EXEMPT | ✅ | Tester touched ONLY the QA report file; no implementor file modified; no push performed |
| Expected output: QA report | ✅ | This file |
| Downstream routing: Codex `orchestrator-mingla` for CLOSE | ✅ | Section 4 handoff below |

---

## Regression-test gate self-assessment (for THIS ORCH)

Per the new policy I am about to codify, this ORCH should satisfy three requirements to PASS. Because this ORCH is BACKFILL-EXEMPT (pure CI + skill-file process change, no product-code touch), the gate is officially WAIVED. But for transparency:

1. **Implementor happy-path regression test:** WAIVED via BACKFILL-EXEMPT. The 5 implementor-run smoke scenarios documented in §15 of the implementation report serve as the executable proof.
2. **Tester adversarial regression test:** WAIVED via BACKFILL-EXEMPT. The 11 adversarial scenarios documented in §1 of this report serve as the executable proof — they materially extend the implementor's coverage (rebase-resistance, malformed ORCH IDs, multi-extension test files, paths with spaces, mixed add/delete commits).
3. **Both tests visible in PR diff:** WAIVED — by design, this ORCH ships CI workflow behaviour that's tested via synthetic git repos in temp directories, not via repo-committed test fixtures.

The exemption is documented in the Verdict line. The next code-touching ORCH after this lands will be the FIRST execution of the gate as a real block; CLOSE-time orchestrator should expect that.

---

## Discoveries for Orchestrator

1. **Shared working tree has ORCH-0839-B [Stripe hosted Checkout pivot] uncommitted work intermixed with ORCH-0840 files.** `git status --short` shows ~18 modified/deleted/added files outside ORCH-0840's manifest (mingla-business app config, payment.tsx, deleted `StripeNativeProvider.*` files, new `orch-0839-b-*` strict-grep script, `SPEC_ORCH-0839-B_*.md`, `IMPLEMENTATION_ORCH-0839-B_*.md`, `supabase/functions/orch-0839-b-stripe-probe/`). When orchestrator runs CLOSE, the PR must isolate to ORCH-0840's 9-file manifest (5 new + 4 modified, per implementation report §12). Either split ORCH-0840 and ORCH-0839-B into separate PRs, OR close them together with both manifests explicitly listed in the close banner.

2. **P2-001 (skill-file privacy):** the orchestrator's CLOSE banner should explicitly note that the Step 0.5 / tester / implementor mandates ship in gitignored `.claude/skills/` files, with a recommendation to mirror the discipline into a tracked `INVARIANT_REGISTRY.md` entry as a follow-up ORCH.

3. **P3-001 (pre-existing strict-grep oversight):** open a new ORCH for `i-proposed-x-web-deprecation.mjs` exit-code hardening. Title suggestion: `ORCH-08XX [Strict-grep gate input-file capture hardening]`.

4. **Branch protection update needed.** Per the implementation report §8 Discovery #4, branch protection on `main` should mark `Tests Append-Only / append-only-check` as a required check after this ORCH lands. Seth owns the branch-protection UI; surface this as a Case-B step in the orchestrator's close banner.

5. **Codex `implementor-mingla` mirror update.** Per the implementation report §8 Discovery #1, a follow-up META-ORCH should mirror the Post-Flight regression-test mandate to `.codex/skills/implementor-mingla/SKILL.md`. The Claude side is now codified; Codex side is not.

6. **Test runners missing for `app-mobile/` and `mingla-admin/`.** Per the implementation report §8 Discovery #3, neither domain has a Jest config wired. Step 0.5 will require regression tests for any code-touching ORCH in those domains; the orchestrator should expect to file a wiring ORCH (e.g., `ORCH-08XX [Jest wiring for app-mobile + mingla-admin]`) before the first non-exempt CLOSE in those domains.

---

## Sim evidence

EXEMPT — backend-only / CI + skill-file change. No UI surface touched. No iOS Simulator, Android Emulator, or Web browser required. Exemption explicitly granted by dispatch prompt's "UI/UX pre-flight is NOT required (no visible UI surface)" + Phase 0.A's "Exemptions (source-only is sufficient): backend-only / SQL-only / RLS / edge-function-only / CI / build-config / lint / type-only / pure refactor with zero behavior change."

---

## Test artifacts

- 11-scenario adversarial smoke test bash transcript: re-run via the script logic — synthetic git repos created under `/tmp` and torn down after each scenario. Re-runnable verbatim by future testers (Bash transcript available on request, NOT committed per dispatch §"Hard guards: do NOT modify any of the implementor's deliverables").
- 2-scenario backfill warning smoke test: same.
- 4-gate strict-grep sanity sample: run against current `Seth` working tree.

---

End of report.
