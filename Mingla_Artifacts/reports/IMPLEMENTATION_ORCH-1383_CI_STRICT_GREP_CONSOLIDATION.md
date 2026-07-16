# IMPLEMENTATION — ORCH-1383 [ci-strict-grep-consolidation]

**Status: `implemented and verified` — §12 steps 0–10 COMPLETE.**
**The workflow ships BATCHED: 340 jobs → 9 (5 dependency classes + 4 carve-out jobs), per the amendment in §0.**

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1383-[ci-strict-grep-consolidation]`
**Branch:** `ORCH-1383-ci-strict-grep-consolidation`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1383_CI_STRICT_GREP_CONSOLIDATION.md` (`f09c26219`)
**Commits (4, in order):**

| Hash | Contents |
|---|---|
| **`aff993707`** | `MANIFEST.json` + `run-batch.mjs` + `meta-1383-manifest-parity.mjs` + `concurrency` on 8 workflows + the `tests-append-only.yml` MANIFEST ratchet |
| **`9d94dd317`** | first differential proof + report + README source-of-truth |
| **`0171a6203`** | **step 6 — the batch: 340 jobs → 9** (5 dependency classes + 4 carve-outs) + parity **P9** |
| **`ae2192c76`** | **step 7 — differential proof RE-RUN against the shipped 9-job workflow** + this report |

*(Rebased onto `origin/main` `d344de987` after COMMS-0104/0105 landed mid-session; both touched only `COMMS_LEDGER.md`, so the rebase was conflict-free and every gate re-verified green afterwards. Pre-rebase code hash was `eac8b97b9`.)*

---

## 0. 🟡 SPEC AMENDMENT — 5 jobs → 9 (authorised, not assumed)

| Field | Value |
|---|---|
| **What changed** | SPEC SC-1 ("`strict-grep-mingla-business.yml` defines **exactly 5 jobs**") is superseded. The workflow ships **9 jobs: the 5 dependency classes + 4 carve-out jobs preserved byte-for-byte.** SC-13's "all 5 batched jobs carry `timeout-minutes: 10`" applies to the 5 batch jobs; the 4 carve-outs are verbatim copies and carry none, exactly as before. |
| **Why** | Four gates assert **their own job key exists in that workflow**. Batching deletes every per-gate job key, so all four fail — proven, with real output, in §4. SC-16 and §15 forbid editing all four (2 are strict-grep gate scripts, 2 are `mingla-admin` product tests). §9 of the spec mandates the registry model change while SC-16 forbids touching the gates that hard-code the old model: the spec contradicts itself. |
| **Why THIS option** | Under carve-outs those 4 assertions stay **TRUE** — the jobs really do exist. That removes the only argument for Option 1 (retargeting them at `MANIFEST.json`), which would have required editing 4 guards, including 2 product tests needing a `[TEST-MOD-APPROVED ORCH-1383]` token. **SC-16 is preserved absolutely: zero gate edits, zero test-mod tokens, no amendment to SC-16 itself.** In a codebase that produced seven classes of never-failing guard, spending ~4 billed minutes to avoid editing four guards is the right trade. |
| **Who authorised** | **Seth, at REVIEW** — choosing **Option 2** from the two options this implementor costed in the blocker report. Not an implementor decision, and not routed to forensics: Seth picked a pre-costed option. |
| **Cost vs the spec's projection** | Spec projected **~10** billed min for 5 jobs. Measured-input projection for 9 jobs: **~15** billed min (4 carve-outs ≈ +4, each a ~25s job). **Wall clock is identical** — the 4 carve-outs are ~25s each and run in parallel behind class A's ~3–4 min. So the amendment costs ~4–5 billed minutes and **zero** user-visible feedback time, against a **344 billed min / 9.68 min** baseline. |
| **Blast radius** | Zero gates changed class semantics. 12 of 548 executions moved out of class A into their original jobs. Differential proof re-run against the 9-job build: **0 dark gates** (§3.1). |
| **New guard this forced** | Carve-out gates are in **no** batch class, so `run-batch`'s R4 does not cover them. Parity assertion **P9** now requires each `job:<jobKey>` gate to be invoked *by that job*, in *every* recorded mode. Proven to fail on job-deleted / gate-dropped / mode-dropped (§3.3). |

---

## 1. Summary — plain English

**CI now runs 9 jobs instead of 340, and no gate stopped running.** The 340 gates have a
**machine-checked registry** (`MANIFEST.json`), a **batch runner** that executes them in 5
dependency-class jobs, **4 preserved carve-out jobs** for gates that check their own CI wiring,
a **parity gate** that fails the PR the moment a gate file exists without being registered, and
an **append-only ratchet** so nobody can quietly shrink the registry.

Proven against GitHub's own recorded 340-job result set: **every one of the 378 gates that ran
before still runs, in the same invocation form, with the same verdict. Zero dark gates.** The
only addition is the parity gate itself, declared.

**The measured prize:** the baseline burns **344 billed minutes and 9.68 minutes of wall clock**
to perform **69 seconds** of actual gate work — **91.4% of the machine time is duplicated setup**
(measured across 100 real jobs; the spec estimated 92%). The 9-job build pays that setup 9 times
instead of 340.

**One number to hold on to:** dropping 5 gates from the manifest leaves the **runner green
(524/524 passed, exit 0)** while the **differential proof FAILS**, naming all 5. Green alone
proves nothing. That is the whole ORCH.

**Read §0 first:** this ships as **9 jobs, not the spec's 5** — an amendment Seth authorised at
REVIEW after building the 5-job version proved it silently breaks 4 gates that SC-16 forbids
fixing.

---

## 2. SPEC success-criteria coverage

| ID | Criterion | Status | Evidence |
|---|---|:--:|---|
| **SC-1** | workflow defines exactly 5 jobs | 🟡 **AMENDED → 9** | **5 batch classes + 4 carve-outs** (§0, Seth-authorised). 340 → 9. `0171a6203` |
| **SC-2** | billed minutes ≤ 12 (today ~345) | ⚠️ **UNMEASURABLE HERE** | Baseline **measured: 344**. After ≈ **15** (9 jobs) — cannot be CI-measured without a PR run, which is forbidden. §6. |
| **SC-3** | wall clock ≤ 5 min (today 6.4–11.8) | ⚠️ **UNMEASURABLE HERE** | Baseline **measured: 9.68 min**. After ≈ **4 min** — same constraint. §6. |
| **SC-4** | **§6 differential proof passes D1–D5, artifact committed** | ✅ **PASS** | **Re-run against the 9-job build.** 0 dark gates. §3.1 |
| **SC-5** | manifest accounts for all on-disk `.mjs`, one enforcement each | ✅ **PASS** | **394** accounted (spec said 384 — §5-A). Parity P1/P3 green. |
| **SC-6** | parity P1–P8 fire under `--self-test`, incl. vacuous | ✅ **PASS** | **16/16** (12 + 4 new P9 carve-out cases), both vacuous. §3.2 |
| **SC-7** | deleting a gate file → run FAILS, log names it | ✅ **PASS** | T-1 output §3.3 |
| **SC-8** | adding a gate without manifest entry → parity FAILS | ✅ **PASS** | T-3 output §3.3 |
| **SC-9** | a mid-class failure doesn't stop later gates | ✅ **PASS** | T-7: 532/532 ran; 523 after the failing gate. §3.3 |
| **SC-10** | every failure names the exact gate | ✅ **PASS** | R6; all outputs in §3.3 |
| **SC-11** | `concurrency` on the §4.3 workflows, expression form | ✅ **PASS** | **8** workflows (spec prose says 7, enumerates 8 — §5-D) |
| **SC-12** | `deploy-functions.yml` has NO `concurrency` | ✅ **PASS** | Verified across all 12 workflows |
| **SC-13** | all 5 batched jobs carry `timeout-minutes: 10` | ✅ **PASS** | All 5 batch jobs = 10. The 4 carve-outs are verbatim copies and carry none, as before. |
| **SC-14** | class C expo step order + stderr path byte-identical | ✅ **PASS** | Real `expo export` run in the proof; gate exit 0. Exit 2 when the side-effect is absent. |
| **SC-15** | class E keeps `fetch-depth: 0`; A–D do not | ✅ **PASS** | Verified structurally + live (class E fails without git history) |
| **SC-16** | **no gate script's assertion logic modified** | ✅ **PASS** | **The whole point of the amendment.** `git diff` vs `60533968e`: **3 files added, 0 modified**. §3.5 |

---

## 3. Evidence

### 3.1 Differential proof (§6) — RE-RUN against the shipped 9-job workflow

Baseline **independently re-verified**: run `29453557478`, `Strict Grep Gates (Mingla Business)`,
`push`/`main`, `head_sha 60533968e`, **340 jobs, 340 success**. The trap ID `29444719767` was
re-confirmed as **Web Build Check with 1 job** — using it would have made the proof decorative.

**This proof covers the 9-job build that ships.** The earlier revision certified the 5-job build,
which was reverted — a proof of something that does not exist certifies nothing. Re-run at
`0171a6203`:

```
D5 baseline run 29453557478 @ 60533968e: 340 rows, 0 non-success
OLD: workflow at 60533968e declares 340 jobs
OLD: 378 distinct gate scripts, 546 (script,mode) executions
Job-name reconciliation: 340 YAML jobs -> 340 API rows; unmatched: 0
NEW: 379 distinct gate scripts, 548 executions (536 batched across 5 classes + 12 in 4 carve-out jobs)

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

All 9 jobs executed in one clean environment (real `expo export` for class C):

| Job | Kind | Executions | Passed | Failed | Exit |
|---|---|---:|---:|---:|:--:|
| `static-gates` | batch A | 520 | 520 | 0 | 0 |
| `dep-gates` | batch B | 10 | 10 | 0 | 0 |
| `expo-export-gate` | batch C | 1 | 1 | 0 | 0 |
| `jest-suites` | batch D | 2 | 2 | 0 | 0 |
| `full-clone-gates` | batch E | 3 | 3 | 0 | 0 |
| `orch-0778-web-stripe-native-import-gate` | carve-out | 1 | 1 | 0 | 0 |
| `orch-0885-a-no-bottomnav-on-wide-desktop` | carve-out | 1 | 1 | 0 | 0 |
| `orch-1271-admin-authz-foundation` | carve-out | 6 | 6 | 0 | 0 |
| `orch-1273-offerings-read-only` | carve-out | 4 | 4 | 0 | 0 |
| **Total** | **9** | **548** | **548** | **0** | **0** |

**548 before, 548 after.** The carve-out split moved 12 executions out of class A (532 → 520)
into their original jobs; nothing was added or lost. All 4 gates that broke the 5-job build pass.

### 3.2 Parity gate self-test — 16/16 (SC-6)

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
ok    P9: carve-out job deleted from the workflow fails
ok    P9: carve-out job no longer runs its gate fails
ok    P9: carve-out job dropped a mode (--self-test) fails
ok    P9: fully-covered carve-out passes
ok    P-vacuous: zero files discovered FAILS (never green)
ok    P-vacuous: empty gates[] FAILS (never green)

META-1383 parity self-test: 16/16 PASS.
```

Two **control cases** are included deliberately (`control: clean manifest passes`, `P9:
fully-covered carve-out passes`): without them, a checker that failed *everything* would score
14/14 and look perfect. A self-test with no passing case proves nothing.

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

**P9 — the carve-outs' own dark-gate guard (NEW, forced by the amendment).** The 8 carve-out
gates are in no batch class, so R4 does not cover them. Deleting the
`orch-1271-admin-authz-foundation` job:

```
META-1383 manifest parity FAILED — 3 violation(s):
  - P9: ".../i-admin-gate-first-statement.mjs" is declared job:orch-1271-admin-authz-foundation
        but strict-grep-mingla-business.yml has no job "orch-1271-admin-authz-foundation".
        The carve-out job is gone — the gate is now enforced by nothing.
  - P9: ".../i-admin-single-gate.mjs"    ... (same)
  - P9: ".../i-admin-write-audited.mjs"  ... (same)
```

And the differential proof independently names all 8:

```
D1 OLD ⊆ NEW — gates present before and absent after: 8
   DARK: orch-0778-web-stripe-native-import-gate.mjs
   DARK: orch-0885-a-no-bottomnav-on-wide-desktop.mjs
   DARK: i-admin-single-gate.mjs
   DARK: i-admin-write-audited.mjs
   DARK: i-admin-gate-first-statement.mjs
   DARK: i-offerings-read-only.mjs
   DARK: __tests__/i-offerings-read-only.test.mjs
```

Restored → both PASS.

**T-16 — exit-code passthrough (R9), observed live.** Class C with its stderr side-effect absent:
```
FAIL  i-proposed-x-web-deprecation.mjs [plain] -> exit 2
      [I-PROPOSED-X] SCRIPT ERROR — stderr log not found at /tmp/expo-export-web.stderr.
```
`2` recorded as `2`, not collapsed to `1`/`0`. This simultaneously proves **SC-14** — the gate
really does read the side-effect a prior step writes, and the runner passes its arg intact.

### 3.4b What the 9-job build surfaced that the 5-job build did not

Three things, none of them cosmetic:

**1. A stale-evidence hole — in my own proof harness.** Testing the carve-out dark-gate case, I
deleted a carve-out job. P9 correctly failed. **The differential proof reported PASS.** Cause:
`run-carveouts.mjs` aborted before rewriting its results file, so the proof read the *previous*
run's `gate-results-CARVE.json` and certified a set of gates that had not run. A proof that can
read results it did not just produce is not a proof — it is the batching lie one level up.
Fixed: results files are deleted **before** any work, so an aborted run leaves nothing to read
and the proof fails closed. Re-tested: **8 dark gates named, PASS on restore.** *This never
affected shipped code* — in CI each job writes its own artifact fresh — but it did mean my first
carve-out test result was worthless, and I would have shipped a proof method with a hole in it.

**2. Three carve-out gates are also invoked by jobs that get batched away.**
`i-admin-write-audited.mjs`, `i-admin-gate-first-statement.mjs` and `i-offerings-read-only.mjs`
appear in `orch-1276` / `orch-1277` / `orch-1278` (batched) as well as their carve-out jobs. Had
a carve-out job run only *some* of a gate's modes, the rest would have disappeared with those
jobs — a mode going dark while the gate still "ran". The generator now hard-fails unless every
carve-out gate's **full mode union is covered by its own job**; it passes, and D1b (`0` dropped
`(script,mode)`) confirms it independently. **The 5-job build could not have surfaced this** —
with everything in one class the union was trivially covered.

**3. Two gates now pass on documentation rather than a job — disclosed, not smoothed.**
`orch-0784-event-list-sales-summary-visibility.mjs` and
`orch-0786-creator-avatar-upload-integrity.mjs` check `workflow.includes("<their job key>")` — a
plain substring, not an anchored YAML key. They are satisfied by the **pre-batch job-key registry
comment** I generate into the workflow, not by a live job. Both gates still *run* (class A,
R4-proven), and the comment is a genuine audit trail mirroring `MANIFEST.json`'s `jobKeys` — but
their *wiring* assertion is now weaker than it reads. They did not qualify for carve-outs because
they never failed. **The orchestrator may want them retargeted at `MANIFEST.json` in the same
follow-up that triages the other wiring assertions.** I did not touch them (SC-16).

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

## 4. ✅ RESOLVED — the blocker, and how the amendment closes it

**Status: closed by the §0 amendment (Seth, Option 2). Kept as the evidence record.**

Four gates assert **their own job key exists in `strict-grep-mingla-business.yml`**. The 340→**5**
collapse deletes every per-gate job key, so all four failed. **Empirically proven** — the 5-job
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

### The ruling — Option 2, and why it is the better call

**Seth chose Option 2 at REVIEW.** The reasoning that decided it, which I had underweighted when
I labelled Option 1 "recommended":

> Under carve-outs, those 4 gates keep their own job entries, so their assertion *"my job exists
> in the workflow"* **stays true**. They are **not** asserting a fiction — which was the entire
> argument for Option 1. So Option 1 buys nothing and costs 4 gate edits.

| # | Option | Cost | Preserves | Verdict |
|---|---|---|---|---|
| 1 | Retarget the 4 CI-wiring assertions at `MANIFEST.json` | 4 gate edits; 2 admin tests need `[TEST-MOD-APPROVED ORCH-1383]` | 5-job batch, SC-1 | ❌ **Rejected.** Its premise — "they now assert a fiction" — is false under Option 2. |
| **2** | **5 batch classes + keep those 4 as their own jobs** | **~4 billed min (≈15 vs ≈10); wall clock identical** | **SC-16 absolutely — zero gate edits, zero test-mod tokens, no SC-16 amendment** | ✅ **CHOSEN** |
| 3 | Do nothing | 344 billed min / 9.68 min wall, forever | Everything, including the problem | ❌ |

**Why this is right, not just authorised:** in a codebase that produced **seven** classes of
never-failing guard — five historical, the 21 never-run, and (found today) three that cannot run
in any per-ORCH worktree — the cheapest thing on the table is 4 billed minutes and the most
expensive is touching four working guards. Option 2 spends the cheap thing. The wall-clock cost,
the only number a developer actually feels, is **zero**: the 4 carve-outs are ~25s jobs running
in parallel behind class A's ~3–4 min.

**The one thing Option 2 costs, stated plainly:** the 8 carve-out gates sit in no batch class, so
`run-batch`'s R4 coverage assertion does not reach them. That is a real new dark-gate surface,
and it is why **P9** exists (§0, §3.3). Without P9, Option 2 would have traded an editing risk
for a coverage hole — a bad trade. With it, both are closed.

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

## 6. Before / after — and an honest note on "measured"

### BEFORE — fully measured, from GitHub's own job records

| Metric | Baseline run `29453557478` |
|---|---:|
| Jobs | **340** |
| **Billed minutes** (`Σ ceil(job_seconds/60)`) | **344** |
| **Wall clock** (first start → last finish) | **9.68 min** |
| Total job-seconds | **9,270** |
| Median job / max job | **26.0s** / 185.0s |
| **Setup + teardown share** | **91.4%** |
| **Real gate work share** | **8.6%** |
| Actual gate work (local, all 548 executions) | **69.3s** |

The per-step breakdown is measured across a 100-job sample of the real run:

```
BASELINE per-step measured (sample of 100 jobs):
  checkout/setup-job   n= 301  avg=5.39s  total=1622s
  setup-node           n= 196  avg=3.44s  total=674s
  gate --self-test     n=  39  avg=0.05s  total=2s
  gate run             n= 102  avg=1.47s  total=150s
  teardown             n= 100  avg=0.05s  total=5s
  ---
  SETUP+TEARDOWN total: 2301s  (91.4% of measured job time)
  REAL GATE WORK      : 217s  (8.6%)
```

**9,270 job-seconds of billing to perform ~69 seconds of work.** The spec claimed "92% of the
machine time is duplicated setup"; measured, it is **91.4%**. The premise is sound.

### AFTER — cannot be CI-measured under this dispatch's own constraints. Saying so plainly.

**I was asked for measured, not projected. For "after" that is not achievable here, and I will
not present a projection as a measurement.** The reason is structural, not effort:

- `strict-grep-mingla-business.yml` triggers only on `pull_request` → `[main, Seth]` and
  `push` → `[main, Seth]`. My branch is neither.
- **"No PR, no merge"** is an explicit constraint of this dispatch — and a PR is the only thing
  that would fire the workflow.
- There is no `workflow_dispatch` trigger, so `gh workflow run` cannot start it. Adding one
  would change shipped CI config to serve a measurement.
- Pushing to `Seth` is not available (branch retired) and would be a shared-branch push.

**A real "after" number therefore requires the first PR run — which is the very next step after
this ORCH.** That run measures it for free.

What I *can* give is a projection built from **measured** inputs, clearly labelled:

| Job | Setup (measured baseline avg) | Work (measured local) | Billed |
|---|---:|---:|---:|
| `static-gates` (A) | ~23s | 61.4s local → ~3 min CI | **4** |
| `dep-gates` (B) | ~23s + ~15s install | 6.7s | **1** |
| `expo-export-gate` (C) | ~23s + ~60s install + ~73s export | 0.1s | **3** |
| `jest-suites` (D) | ~23s | 0.7s | **1** |
| `full-clone-gates` (E) | ~60s full clone | 0.4s | **2** |
| 4 × carve-out jobs | ~23s each | ~2s each | **4** |
| | | **Total** | **≈15** |

**Projected: ≈15 billed min (from 344 — a ~23× reduction) and ≈4 min wall clock (from 9.68 —
~2.4× faster).** The amendment's cost is the 4 carve-out billed minutes; wall clock is unchanged
by them because they run in parallel and finish in ~25s.

⚠️ **One risk this projection carries, flagged rather than buried:** `timeout-minutes: 10` on
`static-gates` is **unvalidated**. Class A is 520 executions; locally 61.4s, but the baseline's
measured per-gate CI cost (1.47s avg, cold-cache, fresh job) would imply far worse if it did not
amortise across a batch. I expect ~3–4 min once the page cache is warm after the first gate, but
**the first PR run is what proves it.** If class A ever approaches 10 min, raise the timeout —
do **not** split the class, which would re-introduce duplicated setup.

**Cost framing (per the dispatch, against the research):** the repo is **PUBLIC → Actions are
free → today's cost is $0.00.** **Do not quote `$51/mo` as live** — it is a private-repo number.
This is justified on **speed now** and on cost **only when the repo goes private**. COMMS-0103
records that Actions-working and account-IDs-hidden are currently mutually exclusive.

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
| `.github/scripts/strict-grep/meta-1383-manifest-parity.mjs` | +~430 **new** | P1–P9 + P-vacuous, 16/16 self-test. |
| `.github/workflows/strict-grep-mingla-business.yml` | **4478 → 614** | **BATCHED: 340 jobs → 9** (5 classes + 4 carve-outs) + `concurrency` + `timeout-minutes: 10` + the 340-key pre-batch registry comment. |
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
| **P9 carve-out coverage** | **job-deleted + self-test** | ✅ §3.3 — **3 gates named; proof independently names 8** |
| Append-only ratchet | T-11 a–d + token + control | ✅ §3.3 |
| **The proof itself** | **T-15** | ✅ §3.3 — **runner green, proof FAILS naming 5** |

Fails-on-revert verified at **`aff993707`** (guards) and **`0171a6203`** (P9 / the 9-job build).
Every guard was reverted by **true line deletion / value mutation or real workflow surgery**,
never a comment-out, and restored to green afterwards.

The parity gate's `--self-test` is registered in CI (`meta-1383-manifest-parity` job, both
`--self-test` and plain), so it ships **wired**, raising `selfTestWiredFloor` 177 → **178**.

---

## 11. Known issues / deferred

1. ⚠️ **`timeout-minutes: 10` on `static-gates` is unvalidated** (§6). Class A runs 520
   executions. Locally 61.4s; the first PR run is what proves the CI number. If it ever nears 10
   min, **raise the timeout — do not split the class**, which would re-introduce the duplicated
   setup this ORCH exists to remove.
2. **Class D's rationale in the spec is wrong** but its *structure* is kept. Class D needs no
   install at all (`node ./scripts/ci/*.mjs`, `node:` builtins only) and could fold into class A
   for ~1 billed min. Flagged, not acted on — out of scope, and folding it would change the
   class model the proof certifies.
3. **The 4 carve-out jobs are a standing invitation to drift.** They are byte-identical copies of
   pre-batch jobs. If someone edits a gate's invocation there without updating `MANIFEST.json`,
   P9 catches it — but the carve-outs remain the one place where "add a job" is still the pattern.
   The follow-up that retargets those 4 wiring assertions can delete them and fold the 8 gates
   into class A, reclaiming the ~4 billed min.
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

**The four the coordinator asked me to carry forward are D2, D3, D10 and D6. None are fixed here.**

| # | Discovery | Suggested action |
|---|---|---|
| **D1** | ✅ **RESOLVED — 4 gates assert their own workflow job key**; batching deletes it; all 4 are DO-NOT-TOUCH. Proven with real failure output (§4). | **Closed by the §0 amendment** (Seth, Option 2 — 4 carve-out jobs). A follow-up may retarget those 4 wiring assertions at `MANIFEST.json` and reclaim ~4 billed min by folding the carve-outs into class A. |
| **D2** | 🔴 **3 gates cannot run from ANY per-ORCH worktree.** `i-proposed-orch-0931`, `-0939`, `-0943` `.test.mjs` resolve a sibling via `new URL().pathname`, so the `[` `]` in `ORCH-NNNN-[label]` percent-encode → `MODULE_NOT_FOUND`. Green in CI only because the runner path has no brackets. **Every implementor/tester who ran these locally got a false red.** | **New ORCH** — one-line fix each (`fileURLToPath()`). SC-16 blocked me. |
| **D3** | 🔴 **Confirmed: 21 real gates are enforced by nothing** — including `orch-1369-release-submit-config.adversarial.mjs`, dark **one day after ORCH-1369 closed**. My independent derivation reproduced the spec's list **exactly**. Now frozen + tracked at `unenforcedCap: 21` (can only shrink). | **New ORCH** (spec Q1). Triage all 21: wire, or delete with a reason. |
| **D4** | ✅ **The 29-vs-21 question is resolved, no design change.** 29 = 21 real gates + 8 top-level `.test.mjs` fixtures. Both counts correct; three-state model absorbs both. | Close the question. |
| **D5** | ⚠️ **The strict-grep README had drifted to ~32 of 379 gates (>90%).** Fixed in this ORCH: it now points at `MANIFEST.json`. | Done (allowlisted). |
| **D6** | ⚠️ **The newest strict-grep run on `main` (`29457874354` @ `3b1715e5a`, PR #914) is RED**, and its jobs endpoint 502s persistently. Landed in the COMMS-0103 billing window. COMMS-0103 requires a post-fix rerun to confirm green — **still outstanding**. | Re-run it. `main` is currently red on strict-grep. |
| **D7** | ⚠️ **The spec hand-typed 5 counts that its own Correction B warns against** (384/345/169/7/7-vs-8). All off for one root cause: `__tests__/` excluded from measurement while §5.1 mandates recursive. | Note for future specs: derive, don't type. |
| **D8** | ⚠️ **GitHub truncates job display names at 100 UTF-8 _bytes_, not characters.** 25 of 340 names contain a multi-byte em-dash/arrow. Any future job-name↔API reconciliation must be byte-accurate. | Reference note. |
| **D9** | ⚠️ **`orch-0839-b-mingla-business-no-native-stripe.mjs` is referenced in 4 comments; the file does not exist.** My comment-stripped parse correctly reported **0 phantoms** — confirming Correction D's trap is live. | Housekeeping; fold into D3's triage. |
| **D10** | 🔴 **168 of 345 gates (48.7%) have NO `--self-test`** and cannot be shown to fail on the defect they exist to catch. All five historical dark-gate failures live in this group. Now measured precisely and ratcheted: `selfTestWiredFloor: 178` can only go **up**. | **New ORCH — the real work.** Explicitly out of scope here (§15). Until it lands, ~half the suite is unproven and this ORCH's green means only "they ran". |
| **D11** | ⚠️ **2 gates now pass their CI-wiring check on a comment, not a job** — `orch-0784-…` and `orch-0786-…` substring-match the pre-batch job-key registry comment (§3.4b-3). They still run; their *wiring* assertion is weaker than it reads. Not carved out because they never failed. | Fold into the same follow-up as D1: retarget wiring assertions at `MANIFEST.json`. |
| **D12** | ⚠️ **A verification harness can certify stale evidence** (§3.4b-1). My proof read a previous run's results file after an aborted step and reported PASS while P9 screamed. Fixed here (delete-before-write). Worth remembering as a *class*: the two worst bugs this ORCH produced were both **the checking machinery silently doing nothing** (this, and the `pathToFileURL` no-op runner, §3.4). | Reference note for any future proof/gate harness: fail closed, never read what you did not just write. |

---

## 14. Scope discipline

Every changed file is inside §15's allowlist. Nothing outside it was touched. **No gate script's
assertion logic was modified** (SC-16, verified §3.5) — preserving that is precisely what the §0
amendment buys. **`COMMS_LEDGER.md` was never staged.**

The step-6 blocker was **reported, not worked around**: no gate edited, no assertion weakened, no
job faked to satisfy a check. It was then resolved by **Seth's ruling on an option I had already
costed** — not by an implementor decision and not by a forensics round-trip. The 21 unenforced
gates and the 7 capable-unwired self-tests remain **unwired**, as scope requires: wiring either
would add assertions the baseline lacks and break §6 set equality at the exact moment it must be
clean.

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
