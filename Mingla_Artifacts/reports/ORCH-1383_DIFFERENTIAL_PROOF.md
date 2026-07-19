# ORCH-1383 — DIFFERENTIAL PROOF (SPEC §6) — REPLAY onto current main

**Verdict: PASS — D1, D1b, D2, D2b, D3, D4, D5 all satisfied. 0 dark gates.**

**This revision SUPERSEDES the proof at `bbafb7e12`** (pre-rebase HEAD), which certified the
9-job build against baseline run `29453557478` (340 jobs @ `60533968e`). That baseline is DEAD:
`main` advanced ~100 commits and grew the strict-grep workflow 340 → **350 jobs** (ad-engine
#915/#928/#942, the ORCH-1373 batch `26cd280bb`, ORCH-1385/1386/1387, ORCH-1398). A proof
against a baseline that no longer describes main certifies nothing that ships. The old proof is
retained in git history — superseded, not deleted; its baseline TSV
(`orch-1383-proof/baseline-jobs.tsv`, 340 rows) also remains as the historical record.

**What this proves:** the batched workflow executes **every** gate the 350-job workflow on
current `main` executed, in the **same invocation form**, and produces the **same verdicts**.
The batched build is now **10 jobs**: 5 dependency classes + 4 carve-outs (Seth's Option 2
ruling, unchanged) + **1 preserved lane** (new on main — see §4).

> **Read this first.** The baseline is **350/350 green**, so every gate's baseline verdict is
> "pass" and **D3 is satisfied automatically by any green batch** — including one that runs
> 200 of 391 gates. **Green alone is worthless.** The claim is carried entirely by
> **D1 + D4: the executed SET.**

---

## 1. Baseline (the external anchor) — FRESH, on current main

| Field | Value |
|---|---|
| Run ID | **`29664288163`** |
| Workflow | Strict Grep Gates (Mingla Business) (`271914022`) |
| Event / branch | `push` / `main` |
| `head_sha` | **`3a55962a1c74fd309358881c225ff2f0fd6de403`** |
| Created | 2026-07-18T22:54:31Z |
| Jobs | **350** |
| Conclusions | **350 success, 0 other** |

Independently verified via the API, not taken on trust:

```console
$ gh api repos/Mingla-LLC/mingla-main/actions/runs/29664288163 \
    -q '{name:.name,event:.event,branch:.head_branch,sha:.head_sha,conclusion:.conclusion}'
{"branch":"main","conclusion":"success","event":"push",
 "name":"Strict Grep Gates (Mingla Business)","sha":"3a55962a1c74fd309358881c225ff2f0fd6de403"}
$ gh api repos/Mingla-LLC/mingla-main/actions/runs/29664288163/jobs -q '.total_count'
350
```

The orchestrator's second candidate, `29661175901` (@ `26cd280bb`, also 350 jobs, success), was
verified too; `29664288163` is the newer of the two. **Both SHAs are ancestors of this branch's
base** (`origin/main` = `885158eb7`), and the gate surface is **byte-identical** from the
baseline SHA to the tip:

```console
$ git diff --stat 3a55962a1 origin/main -- .github/workflows/strict-grep-mingla-business.yml \
    .github/scripts/strict-grep/
(empty — byte-identical)
```

So `OLD` derived at `3a55962a1` is exactly the gate universe this branch was rebased onto —
zero drift to explain. Baseline row data:
`orch-1383-proof/baseline-jobs-replay-29664288163.tsv` (350 rows, all `success`).

---

## 2. Method (unchanged from the superseded proof)

`OLD` = **real YAML parse** of the workflow at the baseline SHA — `jobs.*.steps[].run` scalars,
comments stripped, every `node` / `node --test` / `bash` / `npm run` invocation extracted.
Never grep (SPEC §1.1-D). `NEW` = what **actually executed**: the runner's
`gate-results-{A..E}.json` plus `gate-results-CARVE.json` from executing the carve-out jobs'
steps verbatim out of the SHIPPED workflow. Results files are deleted **before** any work
(fail-closed — the D12 stale-evidence lesson), so an aborted run leaves nothing to read.

**Environment:** bracket-free `git clone` of the worktree (3 gates break on `[` `]` in the
path — D2 of the implementation report), with the class-B dependency set
(`@babel/parser @babel/traverse madge typescript@~5.9.2 yaml`) and a real
`npx expo export -p web` writing `/tmp/expo-export-web.stderr` for class C.

**One method fix discovered live:** GitHub truncates job display names at 100 UTF-8 bytes as
**raw bytes 0..96 + `"..."` — KEEPING partial codepoint bytes** (they render U+FFFD). The
superseded proof's back-off-to-codepoint-boundary rule left 2 of 350 names unmatched on this
baseline (two names cut mid-`→`); the raw-byte cut leaves **0 unmatched**. This refines
discovery D8.

---

## 3. The assertions — against the shipped 10-job workflow

```
D5 baseline run 29664288163 @ 3a55962a1: 350 rows, 0 non-success
OLD: workflow at 3a55962a1 declares 350 jobs
OLD: 390 distinct gate scripts, 563 (script,mode) executions
Job-name reconciliation: 350 YAML jobs -> 350 API rows; unmatched: 0
NEW: 391 distinct gate scripts, 565 executions (553 batched across 5 classes + 12 in 4 carve-out jobs)

D1 OLD ⊆ NEW — gates present before and absent after: 0
D1b (script,mode) present before and absent after: 0
D2 NEW − OLD: 1 addition(s)
   ADDED: .github/scripts/strict-grep/meta-1383-manifest-parity.mjs  (DECLARED)
D2b added (script,mode) on pre-existing gates: 0
D3 verdict equality on OLD ∩ NEW: 0 mismatch(es)
D4 NEW.size === OLD.size + declared additions: 391 === 390 + 1 (391)

================================================================
DIFFERENTIAL PROOF: PASS — D1, D1b, D2, D2b, D3, D4, D5 all satisfied.
  OLD gates : 390   NEW gates : 391   executions: 565   dark gates: 0
```

| # | Assertion | Result |
|---|---|---|
| **D1** | `OLD ⊆ NEW` — every gate that ran before, runs after | ✅ **0 dark gates** |
| **D1b** | every `(script, mode)` that ran before still runs | ✅ **0 dropped** |
| **D2** | `NEW − OLD` = only declared additions | ✅ **exactly 1**, declared: `meta-1383-manifest-parity.mjs` |
| **D2b** | no invocation mode added to a pre-existing gate | ✅ **0** |
| **D3** | verdict equality on `OLD ∩ NEW` | ✅ **0 mismatches** (565/565 exit 0) |
| **D4** | `NEW.length === OLD + declared` | ✅ **391 === 390 + 1** |
| **D5** | baseline exactly 350 rows, all `success` | ✅ **350 / 0 non-success** |

**All 10 jobs executed** — one clean environment, real `expo export` for class C:

| Job | Kind | Executions | Passed | Failed | Missing | Exit |
|---|---|---:|---:|---:|---:|:--:|
| `static-gates` | batch A | 537 | 537 | 0 | 0 | 0 |
| `dep-gates` | batch B | 10 | 10 | 0 | 0 | 0 |
| `expo-export-gate` | batch C | 1 | 1 | 0 | 0 | 0 |
| `jest-suites` | batch D | 2 | 2 | 0 | 0 | 0 |
| `full-clone-gates` | batch E | 3 | 3 | 0 | 0 | 0 |
| `orch-0778-web-stripe-native-import-gate` | carve-out | 1 | 1 | 0 | 0 | 0 |
| `orch-0885-a-no-bottomnav-on-wide-desktop` | carve-out | 1 | 1 | 0 | 0 | 0 |
| `orch-1271-admin-authz-foundation` | carve-out | 6 | 6 | 0 | 0 | 0 |
| `orch-1273-offerings-read-only` | carve-out | 4 | 4 | 0 | 0 | 0 |
| `orch-1387-wallet-type-contract` | preserved lane | 0 gate scripts (npm-ci + tsc lane; job present, P9-guarded) | — | — | — | n/a locally |
| **Total** | **10 jobs** | **565** | **565** | **0** | **0** | **0** |

**563 → 565.** The 350-job workflow performs 563 `(script,mode)` executions; the batched build
performs 565 (563 + the parity gate's 2 modes). The 17 executions main added since the old
baseline (issue-866, i-1378, issue-864 ×2, orch-1385 ×3, orch-1387 ×4, issue-927 ×2,
orch-1398 ×2) are **all present and green in class A** — including
`issue864_campaign_builder_tester_adversarial.test.js`, whose substring wiring assertion
(`issue-864-campaign-builder-node-tests` + `issue864_campaign_builder_happy.test.js`) is
satisfied by the regenerated pre-batch job-key registry comment — verified by execution, not
assumption. **No NEW gate required a carve-out** (checked, not assumed: every new gate was
executed against the batched tree and passed).

---

## 4. The preserved lane — new on main, and why it is a 10th job

`orch-1387-wallet-type-contract` (added to main by ORCH-1387) is **not a gate job**: it runs a
scoped `npm ci` in `mingla-business` + `npx tsc --noEmit` against
`packages/payments-native/tsconfig.orch1387.typetest.json` and **invokes zero gate scripts**.
Consequences, stated plainly:

1. **The runner cannot represent it** — there is no script file to iterate (R1 iterates the
   manifest; `npx tsc` is not an invocation form the manifest models).
2. **The differential proof cannot see it** — the proof's universe is gate scripts, and this
   job contributes none. Batching it away would be **invisible to D1**. That is precisely why
   it must be preserved verbatim, and why its preservation is guarded by something other than
   this proof: a synthetic `job:orch-1387-wallet-type-contract` manifest entry makes parity
   **P9 fail the PR if the job is ever deleted** (proven in §5).
3. Its setup (full `npm ci`) is unique in the suite — folding it into any batch class would tax
   that class with a ~2-minute install, violating the §4.1 grouping axis.

Its job block is **byte-identical** to main's (asserted mechanically by the workflow
generator). The tsc lane itself was **not executed locally** (it needs the CI npm-ci
environment); it runs unchanged on the PR — its baseline row in run `29664288163` is `success`.

---

## 5. Fails-on-revert — the replay's guards, attacked

**T-15 analog on the new universe — the proof is not decorative.** Dropped 5 gates from the
manifest (3 replay-new + 2 pre-existing):

```
dropped 5 gates from the manifest (3 replay-new + 2 pre-existing)
RUNNER (class A): expected 528 / executed 528 / passed 528 / failed 0 -> exit 0   GREEN
PROOF:
D1 OLD ⊆ NEW — gates present before and absent after: 5
  DARK: .github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs
  DARK: .github/scripts/strict-grep/i-checkout-own-confirm-path.mjs
  DARK: .github/scripts/strict-grep/issue-866-creative-guards.mjs
  DARK: .github/scripts/strict-grep/i-1378-web-shim-export-parity.mjs
  DARK: .github/scripts/strict-grep/orch-1398-expo-pinned-54.mjs
D1b (script,mode) present before and absent after: 9
D4 NEW.size === OLD.size + declared additions: 386 === 390 + 1 (391)
DIFFERENTIAL PROOF: FAIL — 7 violation(s).
```

Restored → class A 537/537, proof PASS. **A green runner and a failing proof on the same
tree** — green alone proves nothing; green + set equality is the claim. Note the dark set
includes **replay-new gates**: the proof protects main's newest gates, not just the old 340.

**P9 lane guard.** Deleted the `orch-1387-wallet-type-contract` job (true line deletion):

```
META-1383 manifest parity FAILED — 1 violation(s):
  - P9: "workflow-job:orch-1387-wallet-type-contract" is declared
    job:orch-1387-wallet-type-contract but strict-grep-mingla-business.yml has no job
    "orch-1387-wallet-type-contract". The carve-out job is gone — the gate is now
    enforced by nothing.
```

Restored → PASS (P1–P9 + P-vacuous, and self-test 16/16). The runner/parity/ratchet **code is
unchanged** by this replay — every R1–R9 / P1–P9 / T-11 fails-on-revert proof from the
superseded report stands (same code, byte-identical); the replay changed **data** (manifest +
workflow), and both data-level guards above were proven to fail on revert.

---

## 6. Generator fidelity (the replay's own control)

The manifest was regenerated from main's 351-job pre-batch universe (350 + the parity job) by
the same §5.1 YAML-parse method. Control result: against the 418 pre-existing entries the
derivation reproduced **every one byte-identically (changed = 0, removed = 0)** and added
exactly **17** rows: the 16 new gates main grew (10 new strict-grep `.mjs` + 6 out-of-dir
suites) + the 1 synthetic lane guard. Totals: **435 entries; 404 on-disk `.mjs` (was 394);
`selfTestWiredFloor` 178 → 184** (issue-866, i-1378, orch-1385, orch-1386, orch-1387,
orch-1398 all ship CI-wired self-tests); `unenforcedCap` **21, unchanged** — the one new dark
file on main (`orch-1385-workspace-deps-declared.adversarial.test.mjs`, invoked by NO
workflow) is a `.test.mjs` → recorded as `fixture`, and reported as a discovery.
