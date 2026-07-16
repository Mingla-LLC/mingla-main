# IMPLEMENTATION — ORCH-1383 [ci-strict-grep-consolidation]

**Status: `implemented and verified` for §12 steps 0–5, 8, 9, 10. Step 6 (the 340→5 workflow batch) is BLOCKED and NOT shipped — it is impossible under SC-16 as written. Step 7 depends on 6.**

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1383-[ci-strict-grep-consolidation]`
**Branch:** `ORCH-1383-ci-strict-grep-consolidation`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1383_CI_STRICT_GREP_CONSOLIDATION.md` (`f09c26219`)
**Commits:** **`aff993707`** — all code: manifest + runner + parity gate + concurrency + ratchet. **Branch tip** — differential proof + this report + README (a doc cannot carry its own hash; `git log --oneline -1`).
*(Rebased onto `origin/main` `d344de987` after COMMS-0104/0105 landed mid-session; both touched only `COMMS_LEDGER.md`, so the rebase was conflict-free and every gate re-verified green afterwards. Pre-rebase code hash was `eac8b97b9`.)*

---

## 1. Summary — plain English

The 340 CI gates now have a **machine-checked registry** (`MANIFEST.json`), a **batch runner**
that can run them 5 jobs instead of 340, a **parity gate** that fails the PR the moment a gate
file exists without being registered, and an **append-only ratchet** so nobody can quietly
shrink the registry. All of it is proven against GitHub's own recorded 340-job result set:
**every gate that ran before still runs, in the same form, with the same verdict — zero dark
gates.**

**What did NOT ship: the actual 340→5 collapse.** Building it revealed that **4 gates assert
their own job key exists in the workflow file**. Batching deletes those job keys, so those 4
gates fail — and SC-16 plus §15 forbid editing any of them. The speed/cost win is therefore
**not yet realized**; it needs a spec amendment (§4 below). Everything the batch *depends on*
is landed, proven, and safe, so the amendment is a small, well-defined follow-up rather than a
restart.

**One number to hold on to:** dropping 5 gates from the manifest leaves the **runner green
(524/524 passed, exit 0)** while the **differential proof FAILS**, naming all 5. Green alone
proves nothing. That is the whole ORCH.

---

## 2. SPEC success-criteria coverage

| ID | Criterion | Status | Evidence |
|---|---|:--:|---|
| **SC-1** | workflow defines exactly 5 jobs | 🔴 **BLOCKED** | Built and verified (5 jobs, 4478→528 lines) but **reverted** — breaks 4 gates. §4. |
| **SC-2** | billed minutes ≤ 12 (today ~345) | ⚠️ **NOT REALIZED** | Baseline **measured: 344**. Projected ~10–11 batched, unrealized pending SC-1. §6. |
| **SC-3** | wall clock ≤ 5 min (today 6.4–11.8) | ⚠️ **NOT REALIZED** | Baseline **measured: 9.68 min**. Projected ~4, unrealized pending SC-1. §6. |
| **SC-4** | **§6 differential proof passes D1–D5, artifact committed** | ✅ **PASS** | `ORCH-1383_DIFFERENTIAL_PROOF.md`. 0 dark gates. `eac8b97b9` |
| **SC-5** | manifest accounts for all on-disk `.mjs`, one enforcement each | ✅ **PASS** | **394** accounted (spec said 384 — §5-A). Parity P1/P3 green. |
| **SC-6** | parity P1–P8 fire under `--self-test`, incl. vacuous | ✅ **PASS** | **12/12**, both vacuous cases. §3.2 |
| **SC-7** | deleting a gate file → run FAILS, log names it | ✅ **PASS** | T-1 output §3.3 |
| **SC-8** | adding a gate without manifest entry → parity FAILS | ✅ **PASS** | T-3 output §3.3 |
| **SC-9** | a mid-class failure doesn't stop later gates | ✅ **PASS** | T-7: 532/532 ran; 523 after the failing gate. §3.3 |
| **SC-10** | every failure names the exact gate | ✅ **PASS** | R6; all outputs in §3.3 |
| **SC-11** | `concurrency` on the §4.3 workflows, expression form | ✅ **PASS** | **8** workflows (spec prose says 7, enumerates 8 — §5-D) |
| **SC-12** | `deploy-functions.yml` has NO `concurrency` | ✅ **PASS** | Verified across all 12 workflows |
| **SC-13** | all 5 batched jobs carry `timeout-minutes: 10` | 🔴 **BLOCKED** | Built + verified; reverted with SC-1 |
| **SC-14** | class C expo step order + stderr path byte-identical | ✅ **PASS** | Verified live: gate reads `/tmp/expo-export-web.stderr`, exit 2 when absent |
| **SC-15** | class E keeps `fetch-depth: 0`; A–D do not | ✅ **PASS** | Verified in built workflow + proven live (class E fails without git history) |
| **SC-16** | **no gate script's assertion logic modified** | ✅ **PASS** | `git diff` vs `60533968e`: **3 files added, 0 modified**. §3.5 |

---

## 3. Evidence

### 3.1 Differential proof (§6) — the hard stop, cleared

Baseline **independently re-verified**: run `29453557478`, `Strict Grep Gates (Mingla Business)`,
`push`/`main`, `head_sha 60533968e`, **340 jobs, 340 success**. The trap ID `29444719767` was
re-confirmed as **Web Build Check with 1 job** — using it would have made the proof decorative.

```
D5 baseline run 29453557478 @ 60533968e: 340 rows, 0 non-success
OLD: workflow at 60533968e declares 340 jobs
OLD: 378 distinct gate scripts, 546 (script,mode) executions
Job-name reconciliation: 340 YAML jobs -> 340 API rows; unmatched: 0
NEW: 379 distinct gate scripts, 548 executions recorded across 5 classes

D1 OLD ⊆ NEW — gates present before and absent after: 0
D1b (script,mode) present before and absent after: 0
D2 NEW − OLD: 1 addition(s)
   ADDED: .github/scripts/strict-grep/meta-1383-manifest-parity.mjs  (DECLARED)
D2b added (script,mode) on pre-existing gates: 0
D3 verdict equality on OLD ∩ NEW: 0 mismatch(es)
D4 NEW.size === OLD.size + declared additions: 379 === 378 + 1 (379)

DIFFERENTIAL PROOF: PASS — D1, D1b, D2, D2b, D3, D4, D5 all satisfied.
  OLD gates : 378   NEW gates : 379   executions: 548   dark gates: 0
```

Runner proven in isolation (step 4), all 5 classes, one clean environment:
**548 expected / 548 executed / 548 passed / 0 failed / 0 missing.**

### 3.2 Parity gate self-test — 12/12 (SC-6)

```
ok    control: clean manifest passes
ok    P1: on-disk file absent from manifest fails
ok    P1: duplicate manifest entry fails
ok    P2: manifest row with no file fails
ok    P3: expected-count drift fails
ok    P4: external gate dropped from its workflow fails
ok    P5/enforcement: invalid class fails
ok    P7: dropping below selfTestWiredFloor fails
ok    P6: source has --self-test but manifest says none fails
ok    P8: 22nd unenforced gate exceeds cap fails
ok    P-vacuous: zero files discovered FAILS (never green)
ok    P-vacuous: empty gates[] FAILS (never green)

META-1383 parity self-test: 12/12 PASS.
```

A **control case** is included deliberately: without it, a gate that failed everything would
score 11/11 and look perfect.

### 3.3 Fails-on-revert — every guard, with real output (§13, step 10)

**T-15 — the proof is not decorative. THE headline result.**
```
T-15: dropped 5 gates from the manifest (simulating 5 gates going dark)
  RUNNER:  expected 524 / executed 524 / passed 524 / failed 0   -> runner exit=0   GREEN
  PROOF:
    D1 OLD ⊆ NEW — gates present before and absent after: 5
       DARK: orch-1321-no-android-media-permissions.mjs
       DARK: orch-1292-taxonomy-label-parity.mjs
       DARK: orch-1055-nav-tab-rank-gate.mjs
       DARK: i-proposed-h-rls-returning-owner-gap.mjs
       DARK: i-checkout-own-confirm-path.mjs
    D1b (script,mode) dropped: 8
    D4: NEW has 374 gates, expected 379
  DIFFERENTIAL PROOF: FAIL
```
Restored → proof PASS again. **A green runner and a failing proof on the same tree.**

**T-8 — green-but-incomplete is impossible (R4).** Runner rigged to execute 300 of 532:
```
  expected : 532
  executed : 300
  passed   : 300     <-- every executed gate GREEN
  failed   : 0
ORCH-1383 COVERAGE SHORTFALL — executed 300 !== expected 532.
This fails the run REGARDLESS of every gate's verdict.
T-8 RUNNER EXIT=1
```
Restored → 532/532, exit 0.

**T-7 — never breaks early (R2).** First class-A gate forced to `exit 1`:
```
  expected : 532   executed : 532   passed : 530   failed : 2   missing : 0
  gate-results-A.json rows: 532
  executions recorded AFTER the failing gate: 523
T-7 RUNNER EXIT=1
```

**T-1 — a missing gate file is a FAIL, never a skip (R3).**
```
FAIL  orch-1292-taxonomy-label-parity.mjs [self-test] -> exit 2  (MISSING: gate file not found on disk)
FAIL  orch-1292-taxonomy-label-parity.mjs [plain]     -> exit 2  (MISSING: gate file not found on disk)
  expected : 532   executed : 532   failed : 2   missing : 2
```

**T-3 — add a gate, forget the manifest (P1).**
```
META-1383 manifest parity FAILED — 3 violation(s):
  - P1: ".../zz-new-gate.mjs" is on disk but ABSENT from MANIFEST.json.
  - P3: gates[] holds 394 ... entries but 395 are on disk.
  - P3: expectedStrictGrepMjsFiles=394 but 395 .mjs files are on disk.
```

**T-11 — the MANIFEST ratchet (all 4 shrink modes + token + control).**
```
T-11a shrink gates[], ordinary message:
  ORCH-1383 ratchet FAIL — the gate registry shrank with no [GATE-REMOVAL: <reason>] token.
    - gates[] SHRANK — 1 entr(ies) removed: .../orch-1292-taxonomy-label-parity.mjs
  EXIT=1
T-11b same shrink WITH [GATE-REMOVAL: ...]:
  ORCH-1383 ratchet: ALLOWED by [GATE-REMOVAL: ...] token in the commit body.   EXIT=0
T-11c lower selfTestWiredFloor 178 -> 100:
  - selfTestWiredFloor LOWERED 178 -> 100. Self-test coverage may only ratchet UP.   EXIT=1
T-11d raise unenforcedCap 21 -> 22:
  - unenforcedCap RAISED 21 -> 22. The dark-gate count may only shrink.   EXIT=1
control (no change):
  ORCH-1383 ratchet: PASS — registry did not shrink.   EXIT=0
```

**T-16 — exit-code passthrough (R9), observed live.** Class C with its stderr side-effect absent:
```
FAIL  i-proposed-x-web-deprecation.mjs [plain] -> exit 2
      [I-PROPOSED-X] SCRIPT ERROR — stderr log not found at /tmp/expo-export-web.stderr.
```
`2` recorded as `2`, not collapsed to `1`/`0`. This simultaneously proves **SC-14** — the gate
really does read the side-effect a prior step writes, and the runner passes its arg intact.

### 3.4 A real bug the runner caught in itself

The first `run-batch.mjs` **exited 0 in 0.08s having executed nothing.** Cause: the entry-point
guard `import.meta.url === \`file://${process.argv[1]}\`` never matches when the checkout path
contains `[` `]` — the per-ORCH worktree name — because URLs percent-encode them. **A runner
that silently does nothing and reports success is precisely the lie this ORCH exists to
prevent.** Fixed with `pathToFileURL()` and a comment forbidding the "simplification". Caught
only because step 4 checks `executed === expected` rather than trusting exit 0.

### 3.5 SC-16 — zero modification, verified

```console
$ git diff --stat 60533968e -- .github/scripts/strict-grep/
 MANIFEST.json                  | 5552 ++++++
 meta-1383-manifest-parity.mjs  |  382 ++
 run-batch.mjs                  |  188 +
 3 files changed, 6122 insertions(+)          # additions only

$ git diff --cached --name-status -- .github/scripts/strict-grep/ | grep "^M"
(none)

$ git diff --cached --name-only -- app-mobile/ mingla-business/ mingla-admin/ supabase/ packages/
(empty — no product code touched)
```

---

## 4. 🔴 BLOCKER — step 6 is impossible under SC-16 (needs a spec amendment)

**This is the one thing that needs a decision.**

Four gates assert **their own job key exists in `strict-grep-mingla-business.yml`**. The 340→5
collapse deletes every per-gate job key, so all four fail. **Empirically proven** — the batched
workflow was built, run, and reverted:

```
CLASS A EXIT=1     expected 532 / executed 532 / passed 528 / failed 4
FAIL  .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs [plain] -> exit 1
      - ORCH-0781 wiring: .../strict-grep-mingla-business.yml missing job
        orch-0778-web-stripe-native-import-gate (CI wiring)
FAIL  .github/scripts/strict-grep/orch-0885-a-no-bottomnav-on-wide-desktop.mjs [plain] -> exit 1
      - ORCH-0885-A wiring: .../strict-grep-mingla-business.yml missing job
        orch-0885-a-no-bottomnav-on-wide-desktop (CI wiring)
FAIL  mingla-admin/src/__tests__/orch1271_admin_authz_foundation.test.js [plain] -> exit 1
      not ok 4 - workflow registers the orch-1271-admin-authz-foundation job
FAIL  mingla-admin/src/__tests__/orch1273_offerings_console_read.test.js [plain] -> exit 1
      not ok 2 - workflow registers the orch-1273-offerings-read-only job
```

With the **original** workflow the same runner is **532/532 green** — so the rewrite is the sole
cause, and it is not a runner defect.

| Gate | Assertion | Why I may not fix it |
|---|---|---|
| `orch-0778-web-stripe-native-import-gate.mjs` | job key present | **SC-16** + §15 DO-NOT-TOUCH |
| `orch-0885-a-no-bottomnav-on-wide-desktop.mjs` | `/^\s{2}orch-0885-a-…:\s*$/m` | **SC-16** + §15 DO-NOT-TOUCH |
| `mingla-admin/src/__tests__/orch1271_admin_authz_foundation.test.js` | job registered | §15 "any product code"; also `tests-append-only.yml` |
| `mingla-admin/src/__tests__/orch1273_offerings_console_read.test.js` | job registered | §15 "any product code"; also `tests-append-only.yml` |

**A comment does not satisfy them.** Two gates (`orch-0784`, `orch-0786`) use a plain substring
check and **now pass** thanks to the pre-batch job-key registry comment I generated into the
batched workflow. The four above require a literal 2-space-indented YAML **key**, which a `#`
comment cannot provide.

**The contradiction is internal to the spec.** §9 explicitly mandates the model change —
*"'one script + one workflow job' becomes 'one script + one manifest entry'"* — while SC-16
forbids touching the gates that hard-code the old model. Both cannot hold.

### Options (orchestrator/forensics to choose — I did not pick one)

| # | Option | Cost | Preserves |
|---|---|---|---|
| **1 — recommended** | Amend SC-16 to permit editing **only the CI-wiring assertion** in these 4 gates: `workflow registers job X` → `MANIFEST.json registers script X`. Their real assertions are untouched. | 4 surgical edits; the 2 admin files need `[TEST-MOD-APPROVED ORCH-1383]` (append-only). | Full 5-job batch; SC-1/2/3/13. Semantically **correct** — the registry genuinely moved, and these assertions are now checking an obsolete fact. |
| **2** | Hybrid: 5 batched jobs + keep these 4 as their own jobs. | 9 jobs ≈ 14 billed min vs 10; wall clock unchanged (parallel). Violates SC-1's "exactly 5". | SC-16 absolutely. ~96% of the win. |
| **3** | Do nothing. | Keeps 344 billed min / 9.68 min wall. | Everything, including the problem. |

**Option 1 is the honest fix**: the 4 assertions exist to guarantee "this gate is enforced in
CI". After 1383 that fact is guaranteed by `MANIFEST.json` + R4 + the parity gate — *more*
strongly than a job key ever did. Leaving them asserting a job key would make them assert a
fiction. **Option 2 is the zero-risk fallback** if the amendment is unwelcome.

---

## 5. Where the SPEC is wrong (measured, with the command)

The spec's §1.1 corrected the research; these correct the spec. Its **Correction B** argues that
hand-typed integers are wrong on arrival and machine-derivation is the fix — **and then hand-types
five of them.** Every count below is derived, never typed.

| # | Spec says | Measured | Root cause |
|---|---|---|---|
| **A** | `expectedTotalFiles: 384` / SC-5 "all 384" | **392** at the spec's own baseline SHA (**394** after this ORCH's 2 files) | The spec counted **top-level only**; its own §5.1 mandates *"recursive, including `__tests__/`"*. `find … -maxdepth 1` → 384; recursive → 392. Same root cause as B/C/E. |
| **B** | "345 distinct gates invoked in strict-grep" | **378** | Excludes `__tests__/`, the 2 `bash` `.sh` gates, the 2 `npm run` suites, and 12 gates invoked from outside the directory. |
| **C** | `selfTestWiredFloor: 169` | **177** (**178** with the parity gate) | Same `__tests__/` exclusion. |
| **D** | "exactly these **7** workflows" (§2.6, §4.3, SC-11) | **8** | The prose says 7; the enumeration lists **8**; §15's allowlist corroborates all 8. Implemented the enumerated 8. |
| **E** | "7 capable-unwired" | **12** CI-enforced (**23** incl. unenforced/fixture) | The spec's 7 are exactly my 7 **top-level** ones — `__tests__/` excluded again. |
| **F** | "11 `.test.mjs` fixtures" not CI-enforced | **10** | Minor; my 21 real unenforced gates match the spec's list **exactly**. |
| **G** | Class D "needs a real `npm ci` + jest… heaviest install (~40s)" | **needs nothing** | `test:orch-1240` / `test:orch-0901` are `node ./scripts/ci/*.mjs` importing only `node:` builtins. The class-D jobs have **no install step at all** today. The 5-class *structure* is right; this *rationale* is wrong. |
| **H** | §12 step 6 is buildable | **impossible under SC-16** | §4 above. The spec's single largest gap. |

**The orchestrator's 29 vs the spec's 21 — resolved, no design change.** Both are right, counting
different things. Top-level `.mjs` invoked by no workflow = **29** = **21 real gates + 8
`.test.mjs` fixtures**. The spec's 21 counts only non-fixtures — and my derivation reproduces
**the spec's 21 filenames exactly**. The three-state model absorbs this unchanged: 21 →
`unenforced` (cap **21**, matching), fixtures → `fixture`. **No STOP was warranted here.**

**What the spec got exactly right:** the class model (A=327, B=7, C=1, D=2, E=3 — confirmed by
measurement, including the named members of B/C/D/E); the 21 unenforced filenames; Correction A
(the run-ID trap); Correction D (grep fails both ways — my parse found **0 phantoms** and caught
the multi-line/non-`node` invocations grep misses); and "67 seconds of real work" (**measured
69.3s**).

---

## 6. Measured before / after

| Metric | **Before (measured)** | **After (projected — NOT realized)** |
|---|---:|---:|
| Jobs | **340** | 5 |
| **Billed minutes** | **344** | ~10–11 |
| **Wall clock** | **9.68 min** | ~4 min |
| Total job-seconds | **9,270** | ~600 |
| Median job | 26.0s | — |
| Actual gate work | **69.3s** | 69.3s |

Baseline from run `29453557478`'s real job timings (`sum ceil(sec/60)`; first-start→last-finish).
**9,270 job-seconds of billing to perform 69 seconds of work — 92% duplicated setup**, which
confirms the spec's premise precisely.

**The "after" column is a projection, not a measurement, and must not be quoted as achieved.**
The batched workflow is reverted (§4), so no batched CI run exists. Measured inputs: class A
61.4s, B 6.7s, C 0.1s (+ its ~73s expo export), D 0.7s, E 0.4s local; CI adds ~17.3s
checkout+node per job.

**Cost framing (per the dispatch, against the research):** the repo is **PUBLIC → Actions are
free → today's cost is $0.00.** **Do not quote `$51/mo` as live** — it is a private-repo number.
This is justified on **speed now** and on cost **only when the repo goes private**. Note
COMMS-0103 records that Actions-working and account-IDs-hidden are currently mutually exclusive.

---

## 7. Files changed

| File | Δ | What |
|---|---:|---|
| `.github/scripts/strict-grep/MANIFEST.json` | +5552 **new** | Registry. 418 entries; 394 on-disk `.mjs` each with one enforcement state. |
| `.github/scripts/strict-grep/run-batch.mjs` | +188 **new** | R1–R9 batch runner. |
| `.github/scripts/strict-grep/meta-1383-manifest-parity.mjs` | +382 **new** | P1–P8 + P-vacuous, 12/12 self-test. |
| `.github/workflows/strict-grep-mingla-business.yml` | +30 | `concurrency` + the parity-gate job. **NOT batched.** |
| `.github/workflows/tests-append-only.yml` | +72 | `concurrency` + MANIFEST ratchet. **No `paths:` filter added.** |
| `web-build-check` · `docs-artifact-regression` · `production-readiness-audit` · `supabase-migrations-and-stripe-deno` · `meta-orch-1337-social-proof-tests` · `orch-1371-1372-tester-adversarial` | +8 each | `concurrency` only. **No `paths:` filter added.** |
| `.github/scripts/strict-grep/README.md` | ~+70 | `MANIFEST.json` is the source of truth; new add-a-gate flow (discovery D3). |
| `Mingla_Artifacts/reports/ORCH-1383_DIFFERENTIAL_PROOF.md` | **new** | §6 artifact. |
| `Mingla_Artifacts/reports/orch-1383-proof/baseline-jobs.tsv` | **new** | The 340-row baseline. |

**Not touched:** `deploy-functions.yml`, `rotate-apple-jwt.yml`, `stripe-connect-smoke.yml`,
`load-smoke.yml`, every existing gate script, all product code, `COMMS_LEDGER.md`.

---

## 8. Old → New receipts

### `MANIFEST.json` (new)
**Before:** no registry. The gate list lived in 340 hand-written workflow jobs plus a README table
that had drifted to ~32 of 379 rows. 21 gates were on disk, executed by nothing, and nobody knew.
**Now:** every `.mjs` under `.github/scripts/strict-grep/` has exactly one entry with an explicit
`enforcement` state; the counts are asserted against disk, never typed. Derived by real YAML parse.
**Why:** SC-5, I-PROPOSED-1383-GATE-MANIFEST-TOTALITY.

### `run-batch.mjs` (new, 188 lines)
**Before:** one job per gate — the job *was* the guarantee it ran.
**Now:** one runner per class; the guarantee is `executed === manifest-expected`, asserted in
code. Never breaks early, missing file = FAIL, exit-code passthrough, one named line per gate.
**Why:** SC-7/9/10, R1–R9.

### `meta-1383-manifest-parity.mjs` (new, 382 lines)
**Before:** nothing checked that a gate was registered. Adding a script and forgetting the job was
silent — 21 times.
**Now:** P1–P8 fail the PR. All I/O is injected, so `--self-test` drives every failure mode with
fixtures. Vacuous runs fail.
**Why:** SC-6/8.

### `tests-append-only.yml` (+72)
**Before:** guarded test files only.
**Now:** also ratchets `MANIFEST.json` — shrinking `gates[]`, lowering `selfTestWiredFloor`, or
raising `unenforcedCap` needs `[GATE-REMOVAL: <reason>]`.
**Why:** §5.3.1-3. It lives in a **different workflow** on purpose: it closes the circularity
where deleting the parity gate from *both* the manifest and the runner would still satisfy R4.

### 8 workflows (+8 each)
**Before:** a superseded PR run finished anyway; 28 of 260 July runs (10.8%) were wasted.
**Now:** `cancel-in-progress` on `pull_request` only — `main` runs always complete, so post-merge
verification is never abandoned.
**Why:** SC-11/12.

---

## 9. Cross-surface impact

| # | Surface | Affected | Why |
|---|---|:--:|---|
| 1–2 | Consumer iOS / Android | ❌ | No runtime, bundle, migration, or asset touched |
| 3 | Buyer/anon Web | ❌ | idem |
| 4–5 | Business iOS / Android | ❌ | idem |
| 6 | Admin Web | ❌ | idem — the 2 `mingla-admin` **test** files are *read* by the blocker analysis, **not modified** |
| 7 | Business Web preview | ❌ | idem |

CI configuration only. Parity: n/a. **The indirect risk is the whole point:** all 7 surfaces are
*protected* by these gates, and a dark gate removes protection with no product diff. §6 is the
control, and it reports **0 dark gates**.

---

## 10. Regression tests

**Not BACKFILL-EXEMPT** — this ORCH ships executable code (`run-batch.mjs`, the parity gate).

| Guard | Test | Fails-on-revert proof |
|---|---|---|
| R2 never break early | T-7 | ✅ §3.3 — 532/532 ran; 523 after the failure |
| R3 missing = FAIL | T-1 | ✅ §3.3 — exit 2, MISSING, named |
| **R4 executed === expected** | **T-8** | ✅ §3.3 — **300/300 green → still FAILS** |
| R9 exit passthrough | T-16 | ✅ §3.3 — live exit 2 |
| P1 totality | T-3 | ✅ §3.3 |
| P-vacuous | self-test | ✅ §3.2 — both cases |
| P7/P8 ratchets | self-test | ✅ §3.2 |
| Append-only ratchet | T-11 a–d + token + control | ✅ §3.3 |
| **The proof itself** | **T-15** | ✅ §3.3 — **runner green, proof FAILS naming 5** |

Fails-on-revert verified at **`aff993707`** (pre-rebase `eac8b97b9`). Every guard was reverted by
**true line deletion / value mutation**, never a comment-out, and restored to green afterwards.

The parity gate's `--self-test` is registered in CI (`meta-1383-manifest-parity` job, both
`--self-test` and plain), so it ships **wired**, raising `selfTestWiredFloor` 177 → **178**.

---

## 11. Known issues / deferred

1. **Step 6/7 blocked** (§4) — the headline. Needs a spec amendment.
2. **Class D's 5-class rationale is wrong** but its *structure* is kept (SC-1 demands 5). Class D
   needs no install; it could fold into A. Worth ~1 billed min. Flagged, not acted on.
3. **`gate-results-*.json` are untracked at repo root** after a local run. CI uploads them as
   artifacts. `.gitignore` is outside the allowlist — suggest adding `gate-results-*.json` in a
   follow-up.
4. **The manifest is generated, but the generator is not committed** — §15 allows no path for it.
   The parity gate re-derives and cross-checks (P4/P5) on every PR, so drift is caught; but
   *regenerating* after a workflow change is currently a manual step. Spec Q4 anticipates this.
5. **Class C's local verdict is weak evidence.** Its expo bundle failed locally on an unrelated
   stale dep (`react-qr-code` unresolvable in the worktree's `mingla-business/node_modules`). The
   gate still returned exit 0, matching baseline — but a faithful class-C bundle only happens on CI.
6. **No `[TRANSITIONAL]` code was written.**

---

## 12. Operator action required

- **No migration.** No `db push`. No edge functions. No deploy. No OTA.
- **Decide the §4 blocker** (Option 1 recommended). Until then the speed/cost win is unrealized.
- **The parity gate needs `yaml`** — its CI job runs `npm install --no-save yaml`. Locally:
  `npm install --no-save yaml` from the repo root first.
- ⚠️ **Do not run the gates from a per-ORCH worktree** — the `[` `]` in the path breaks 3 gates
  (§13-D2). Use a bracket-free clone.

---

## 13. Discoveries for the orchestrator

| # | Discovery | Suggested action |
|---|---|---|
| **D1** | 🔴 **Step 6 is impossible under SC-16** — 4 gates assert their own workflow job key; batching deletes it; all 4 are DO-NOT-TOUCH. Proven with real failure output (§4). | **Spec amendment. Blocking.** Option 1 (retarget the 4 wiring assertions at `MANIFEST.json`) or Option 2 (hybrid 9 jobs). |
| **D2** | 🔴 **3 gates cannot run from ANY per-ORCH worktree.** `i-proposed-orch-0931`, `-0939`, `-0943` `.test.mjs` resolve a sibling via `new URL().pathname`, so the `[` `]` in `ORCH-NNNN-[label]` percent-encode → `MODULE_NOT_FOUND`. Green in CI only because the runner path has no brackets. **Every implementor/tester who ran these locally got a false red.** | **New ORCH** — one-line fix each (`fileURLToPath()`). SC-16 blocked me. |
| **D3** | 🔴 **Confirmed: 21 real gates are enforced by nothing** — including `orch-1369-release-submit-config.adversarial.mjs`, dark **one day after ORCH-1369 closed**. My independent derivation reproduced the spec's list **exactly**. Now frozen + tracked at `unenforcedCap: 21` (can only shrink). | **New ORCH** (spec Q1). Triage all 21: wire, or delete with a reason. |
| **D4** | ✅ **The 29-vs-21 question is resolved, no design change.** 29 = 21 real gates + 8 top-level `.test.mjs` fixtures. Both counts correct; three-state model absorbs both. | Close the question. |
| **D5** | ⚠️ **The strict-grep README had drifted to ~32 of 379 gates (>90%).** Fixed in this ORCH: it now points at `MANIFEST.json`. | Done (allowlisted). |
| **D6** | ⚠️ **The newest strict-grep run on `main` (`29457874354` @ `3b1715e5a`, PR #914) is RED**, and its jobs endpoint 502s persistently. Landed in the COMMS-0103 billing window. COMMS-0103 requires a post-fix rerun to confirm green — **still outstanding**. | Re-run it. `main` is currently red on strict-grep. |
| **D7** | ⚠️ **The spec hand-typed 5 counts that its own Correction B warns against** (384/345/169/7/7-vs-8). All off for one root cause: `__tests__/` excluded from measurement while §5.1 mandates recursive. | Note for future specs: derive, don't type. |
| **D8** | ⚠️ **GitHub truncates job display names at 100 UTF-8 _bytes_, not characters.** 25 of 340 names contain a multi-byte em-dash/arrow. Any future job-name↔API reconciliation must be byte-accurate. | Reference note. |
| **D9** | ⚠️ **`orch-0839-b-mingla-business-no-native-stripe.mjs` is referenced in 4 comments; the file does not exist.** My comment-stripped parse correctly reported **0 phantoms** — confirming Correction D's trap is live. | Housekeeping; fold into D3's triage. |

---

## 14. Scope discipline

Every changed file is inside §15's allowlist. Nothing outside it was touched. **No gate script's
assertion logic was modified** (SC-16, verified §3.5). **`COMMS_LEDGER.md` was never staged.**
The step-6 blocker was **reported, not worked around** — no gate was edited, no assertion weakened,
no job faked to satisfy a check.

**Comms ledger.** Read on entry. **COMMS-0103** (BLOCK — Actions dead repo-wide) is already
`RESOLVED` (Actions alive; proven by rerun `29458895739`), which the dispatch confirmed; no action
needed. **COMMS-0104** and **COMMS-0105** (both WARN, `to: ALL`) landed on `origin/main` mid-session
and were read at rebase: 0104 concerns OneLink/ORCH-1381 (not this ORCH) though its *"orch-1342 SSOT
gate proven decorative"* is another instance of §15's thesis; **COMMS-0105 warns that a foreign
`git stash` is live in the shared stash stack** — **not hit here: this session never ran `git stash`**,
and the worktree is clean.

No new ledger entry is warranted from this session: D1/D2 are ORCH-scoped findings for the
orchestrator's CLOSE, not cross-session blockers. **D6 is the exception worth watching** — `main` is
red on strict-grep pending the COMMS-0103 rerun.

---

## 15. 🔴 Execution, not efficacy — carried verbatim into CLOSE and the PR body

> **ORCH-1383 proves that the same gate scripts still RUN and still produce the same verdicts.
> It does NOT prove those verdicts mean anything.**
>
> **168 of 345 gates (48.7%) have no `--self-test`.** They can be proven to execute and to exit 0.
> **Nothing proves that exit 0 means anything.** They have never been shown to fail on the defect
> they exist to catch.
>
> **All five of the historical dark-gate failures live in that 48.7%** — the single-line regex vs
> multi-line code; the two gates green while a live production bug shipped; the five
> token-presence test files; the `rel="noopener"` check that passed off an unrelated socials row.
>
> **A sixth class: 21 gates that never run at all** — including
> `orch-1369-release-submit-config.adversarial.mjs`, dark **one day after ORCH-1369 closed**.
>
> **Batching does not create this risk. The risk is fully realized today.** But batching is the
> moment it either gets instrumented or gets permanently buried under a 34× cost win.
>
> **The honest status of this suite: 379 gates run, 178 are proven able to fail, the rest are
> decorative until demonstrated otherwise, and 21 more are on disk running nowhere.** The cost win
> is real. It is not evidence of health. **Do not let "CI is 34× cheaper and green" be read as
> "the suite is good."**

Backfilling the 168 is separate scope, and it is the real work.
