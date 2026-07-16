# ORCH-1383 — DIFFERENTIAL PROOF (SPEC §6)

**Verdict: PASS — D1, D1b, D2, D2b, D3, D4, D5 all satisfied. 0 dark gates.**

**Re-run against the SHIPPED 9-job workflow** (5 dependency classes + 4 carve-out jobs), not
the 5-job build that was reverted. An earlier revision of this document certified the 5-job
design; that design does not ship, so that proof certified nothing that exists. This one
covers what is actually on the branch.

**Status of what this proves:** the 9-job workflow executes **every** gate the 340-job
workflow executed, in the **same invocation form**, and produces the **same verdicts**.
It is the merge-blocking artifact §6 requires.

**Why 9 jobs and not 5** — ORCH-1383 AMENDMENT, authorised by Seth at REVIEW (Option 2 of the
implementor's costed blocker; supersedes SC-1's "exactly 5 jobs"). Four gates assert that
**their own job key exists in `strict-grep-mingla-business.yml`**; batching deletes the key and
fails them, and SC-16/§15 forbid editing all four. Their jobs are preserved **byte-for-byte**,
so those assertions remain **true** rather than being retargeted at a comment. The 8 gates in
those 4 jobs are `enforcement: job:<jobKey>` in the manifest and are **not** in any batch class —
so this proof must, and does, execute them from the shipped workflow and merge their results
(see §3.1). Cost: ~4 billed minutes; wall clock unchanged.

> **Read this first.** The baseline is **340/340 green**. Therefore every gate's baseline
> verdict is "pass", and **D3 (verdict equality) is satisfied automatically by any green
> batch** — including a batch that runs 200 of 379 gates. **Green alone is worthless.**
> The claim is carried entirely by **D1 + D4: the executed SET**. That is why this document
> exists, and why §6 is a build step rather than a verification nicety.

---

## 1. Baseline (the external anchor)

| Field | Value |
|---|---|
| Run ID | **`29453557478`** |
| Workflow | Strict Grep Gates (Mingla Business) (`271914022`) |
| Event / branch | `push` / `main` |
| `head_sha` | **`60533968e513be47b93f89c8c84d0d7f1927d9b1`** |
| Created | 2026-07-15T21:54:09Z |
| Jobs | **340** |
| Conclusions | **340 success, 0 other** |

Independently re-verified, not taken on trust:

```console
$ gh api repos/Mingla-LLC/mingla-main/actions/runs/29453557478 \
    -q '{name:.name,event:.event,branch:.head_branch,sha:.head_sha,conclusion:.conclusion}'
{"branch":"main","conclusion":"success","event":"push",
 "name":"Strict Grep Gates (Mingla Business)","sha":"60533968e513be47b93f89c8c84d0d7f1927d9b1"}

$ gh api repos/Mingla-LLC/mingla-main/actions/runs/29453557478/jobs -q '.total_count'
340
```

**The trap in the upstream framing, re-confirmed.** `29444719767` is NOT a strict-grep run:

```console
$ gh api repos/Mingla-LLC/mingla-main/actions/runs/29444719767 -q '{name:.name,workflow:.workflow_id}'
{"name":"Web Build Check","workflow":285238478}
$ gh api repos/Mingla-LLC/mingla-main/actions/runs/29444719767/jobs -q '.total_count'
1
```

Using it would have compared 378 gates against a **single job** and passed trivially —
the proof would have been decorative. Baseline row data: `orch-1383-proof/baseline-jobs.tsv`.

**Baseline is still the correct one even though `main` moved.** `origin/main` advanced 4
commits past `60533968e` (`ebe07fa54`, `3b1715e5a`, `92d1960d8`, `1d708e9a2`). §6.5 requires
re-baselining if `main` moves — but the re-baseline exists to remove *drift*, and there is
none in the relevant surface:

```console
$ git diff --stat 60533968e origin/main -- .github/workflows/strict-grep-mingla-business.yml
(empty — byte-identical)
$ git diff --stat 60533968e origin/main -- .github/scripts/strict-grep/
(empty — byte-identical)
```

The workflow and every gate script are unchanged between the baseline SHA and this branch's
base, so `OLD` derived at either SHA is identical. Additionally, `29453557478` **is** the
newest all-green strict-grep run on `main`: the only newer run, `29457874354` @ `3b1715e5a`,
is `failure` (its jobs endpoint 502s persistently; it landed during the COMMS-0103
billing-outage window). Re-baselining onto a red run is not available and not required.

---

## 2. Method

`OLD` is derived by **parsing the workflow at the baseline SHA with a real YAML parser**,
walking `jobs.*.steps[].run` scalars (full multi-line block scalars), stripping `#` comments,
and extracting every `node` / `node --test` / `bash` / `npm run` invocation.

**Never grep.** Per §1.1-D grep fails in both directions — comments naming gate paths create
phantom gates, and line-anchored patterns miss gates invoked on continuation lines of a
`run: |` block. This derivation found **0 phantoms** and correctly picked up the multi-line
and non-`node` invocations a grep would have missed (2 `bash` `.sh` gates, 2 `npm run`
suites, 18 `node --test` targets).

`NEW` is read from the `gate-results-{A..E}.json` the runner writes **plus
`gate-results-CARVE.json`** — i.e. what **actually executed**, not what was intended to execute.

**The carve-out half is not optional.** The 8 gates in the 4 carve-out jobs are in no batch
class, so a batch-only `NEW` would report all 8 as dark. `run-carveouts.mjs` therefore
**YAML-parses the SHIPPED workflow** and executes those 4 jobs' steps verbatim — proving what
ships, not what the manifest hopes ships.

**Environment.** Run from a bracket-free `git clone` at
`/private/tmp/.../scratchpad/proof-clone`, with the exact dependency set the class-B job
installs (`@babel/parser @babel/traverse madge typescript@~5.9.2 yaml`). A bracket-free path
is **required** — see §5.

---

## 3. The assertions — against the shipped 9-job workflow

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

================================================================
DIFFERENTIAL PROOF: PASS — D1, D1b, D2, D2b, D3, D4, D5 all satisfied.
  OLD gates : 378
  NEW gates : 379  (= OLD + 1 declared)
  executions: 548
  dark gates: 0
```

**548 = 548.** The 340-job workflow performed 546 `(script, mode)` executions; the 9-job
workflow performs 548 (546 + the parity gate's 2 modes) — 536 batched, 12 in carve-out jobs.
The carve-out split moved 12 executions out of class A (532 → 520); **nothing was added or
lost**, which is exactly what D1b/D2b assert.

| # | Assertion | Result |
|---|---|---|
| **D1** | `OLD ⊆ NEW` — every gate that ran before, runs after | ✅ **0 dark gates** |
| **D1b** | every `(script, mode)` that ran before still runs | ✅ **0 dropped** — added beyond spec; see §4 |
| **D2** | `NEW − OLD` = only declared additions | ✅ **exactly 1**, declared: `meta-1383-manifest-parity.mjs` |
| **D2b** | no invocation **mode** added to a pre-existing gate | ✅ **0** — added beyond spec; see §4 |
| **D3** | verdict equality on `OLD ∩ NEW` | ✅ **0 mismatches** (548/548 exit 0) |
| **D4** | `NEW.length === OLD + declared` | ✅ **379 === 378 + 1** |
| **D5** | baseline is exactly 340 rows, all `success` | ✅ **340 / 0 non-success** |

**Job-name reconciliation (added rigor).** All 340 YAML job names map 1:1 onto the 340 API
rows, so the workflow the proof parsed is provably the workflow that produced the baseline.
This required discovering that **GitHub truncates job display names at 100 UTF-8 _bytes_
(97 + `"..."`), not 100 characters** — 25 job names contain a multi-byte em-dash or arrow and
truncate at fewer characters. A char-based rule leaves 25 unmatched; the byte-accurate rule
leaves **0**.

**All 9 jobs executed (§12 steps 4 + 7)** — one clean environment, real `expo export` for class C:

| Job | Kind | Gates | Executions | Executed | Passed | Failed | Missing | Exit |
|---|---|---:|---:|---:|---:|---:|---:|:--:|
| `static-gates` | batch A | 356 | 520 | 520 | 520 | 0 | 0 | 0 |
| `dep-gates` | batch B | 9 | 10 | 10 | 10 | 0 | 0 | 0 |
| `expo-export-gate` | batch C | 1 | 1 | 1 | 1 | 0 | 0 | 0 |
| `jest-suites` | batch D | 2 | 2 | 2 | 2 | 0 | 0 | 0 |
| `full-clone-gates` | batch E | 3 | 3 | 3 | 3 | 0 | 0 | 0 |
| `orch-0778-web-stripe-native-import-gate` | carve-out | 1 | 1 | 1 | 1 | 0 | 0 | 0 |
| `orch-0885-a-no-bottomnav-on-wide-desktop` | carve-out | 1 | 1 | 1 | 1 | 0 | 0 | 0 |
| `orch-1271-admin-authz-foundation` | carve-out | 3 | 6 | 6 | 6 | 0 | 0 | 0 |
| `orch-1273-offerings-read-only` | carve-out | 3 | 4 | 4 | 4 | 0 | 0 | 0 |
| **Total** | **9 jobs** | **379** | **548** | **548** | **548** | **0** | **0** | **0** |

The 4 gates that **failed** the reverted 5-job build — `orch-0778-web-stripe-native-import-gate.mjs`,
`orch-0885-a-no-bottomnav-on-wide-desktop.mjs`, `orch1271_admin_authz_foundation.test.js`,
`orch1273_offerings_console_read.test.js` — all **pass** here, because their job keys exist again.

---

## 4. Two assertions added beyond the spec — and why they were necessary

The spec models a gate as `{script, invocation, selfTest}` and assumes `selfTest: "wired"`
means "run `--self-test`, then run plain". **Measurement contradicts that**, and implementing
the spec's model literally would have silently changed what CI asserts:

```
mode-set tally across the 378 OLD gates:
  { 'plain+self-test': 168,  plain: 208,  'self-test': 2 }

SELF-TEST-ONLY scripts (--self-test is run; the gate itself NEVER is):
  .github/scripts/strict-grep/orch-1225-careers-runtime-dom.test.mjs
  .github/scripts/strict-grep/orch-0891-marketing-performance-budget.mjs
```

Under the spec's model those 2 gates would have been marked `selfTest: "wired"` and the
runner would have **added a plain run CI has never performed** — a D2-class violation
(an added assertion), with a real chance of going red on code no gate has ever judged.

The manifest therefore records `modes` — the exact set of invocation forms CI uses — and
**D1b/D2b assert set equality at `(script, mode)` granularity**, not just `script`. D1b/D2b
both come back 0, which is a materially stronger claim than D1/D2 alone.

**Declared addition (D2).** `meta-1383-manifest-parity.mjs` is the only gate in `NEW` that is
not in `OLD`. It is ORCH-1383's own registry guard. Its `--self-test` passes 12/12 including
both vacuous-run cases.

---

## 5. The proof is NOT decorative — T-15, executed

The sharpest question about any such proof is whether it can actually fail. Dropping 5 gates
from the manifest and re-running:

```
T-15: dropped 5 gates from the manifest (simulating 5 gates going dark)

  --- the RUNNER's verdict:
  expected : 524
  executed : 524
  passed   : 524
  failed   : 0
  runner exit=0          <-- GREEN. Fully green. It faithfully ran its (reduced) manifest.

  --- the DIFFERENTIAL PROOF's verdict against the same baseline:
D1 OLD ⊆ NEW — gates present before and absent after: 5
   DARK: .github/scripts/strict-grep/orch-1321-no-android-media-permissions.mjs
   DARK: .github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs
   DARK: .github/scripts/strict-grep/orch-1055-nav-tab-rank-gate.mjs
   DARK: .github/scripts/strict-grep/i-proposed-h-rls-returning-owner-gap.mjs
   DARK: .github/scripts/strict-grep/i-checkout-own-confirm-path.mjs
D1b (script,mode) present before and absent after: 8
D4 NEW.size === OLD.size + declared additions: 374 === 378 + 1 (379)

DIFFERENTIAL PROOF: FAIL
  - D1: 5 gate(s) ran in the baseline but NOT after batching — these are DARK GATES.
  - D1b: 8 (script,mode) invocation(s) dropped.
  - D4: NEW has 374 gates, expected 379.
```

**A green runner and a failing proof, on the same tree, at the same moment.** This is the
entire argument for §6 in one screen: the batch went green while 5 gates had silently stopped
running, and only the external set-equality check noticed. Restoring the manifest returns the
proof to PASS (verified).

---

## 5b. The carve-outs' own dark-gate risk — closed, and proven closed

The 9-job design introduces a failure mode the 5-job design did not have: **the 8 carve-out
gates are in no batch class**, so `run-batch`'s R4 (`executed === expected`) does not cover
them. Delete a carve-out job and its gates run nowhere, with no coverage assertion to notice.
Two independent guards close it.

**Guard 1 — parity gate P9 (ships).** A `job:<jobKey>` gate must actually be invoked *by that
job*, with *every mode* the manifest records. Deleting the `orch-1271-admin-authz-foundation`
job:

```
META-1383 manifest parity FAILED — 3 violation(s):
  - P9: ".../i-admin-gate-first-statement.mjs" is declared job:orch-1271-admin-authz-foundation
        but strict-grep-mingla-business.yml has no job "orch-1271-admin-authz-foundation".
        The carve-out job is gone — the gate is now enforced by nothing.
  - P9: ".../i-admin-single-gate.mjs"        ... (same)
  - P9: ".../i-admin-write-audited.mjs"      ... (same)
```

P9's `--self-test` proves all three of its failure modes fire — job deleted, job no longer runs
the gate, and job **dropped one mode** (e.g. kept the plain run, lost `--self-test`) — plus a
fully-covered happy path. Self-test is now **16/16**.

**Guard 2 — the differential proof.** With the carve-out job gone, `NEW` loses those gates and
D1 names every one:

```
D1 OLD ⊆ NEW — gates present before and absent after: 8
   DARK: .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs
   DARK: .github/scripts/strict-grep/orch-0885-a-no-bottomnav-on-wide-desktop.mjs
   DARK: .github/scripts/strict-grep/i-admin-single-gate.mjs
   DARK: .github/scripts/strict-grep/i-admin-write-audited.mjs
   DARK: .github/scripts/strict-grep/i-admin-gate-first-statement.mjs
   DARK: .github/scripts/strict-grep/i-offerings-read-only.mjs
   DARK: .github/scripts/strict-grep/__tests__/i-offerings-read-only.test.mjs
```

Restoring the job returns both to PASS (verified).

**A third danger, found while testing guard 2 — and it was in the proof harness itself.** On the
first attempt, deleting the carve-out job made `run-carveouts.mjs` abort *before* rewriting its
results file, so the proof read the **previous run's** `gate-results-CARVE.json` and reported
**PASS on stale evidence** — while P9 was correctly screaming. A proof that can certify results
it did not just produce is not a proof. Fixed: the results file is now deleted **before** any
work, so an aborted run leaves nothing to read and the proof fails closed. This is the same
family of defect as the runner's own `pathToFileURL` bug (§6 of the report) — *the verification
machinery lying by omission* — and it is exactly why "the batch went green" is never sufficient.

**Generator-side check.** 3 of the 8 carve-out gates (`i-admin-write-audited.mjs`,
`i-admin-gate-first-statement.mjs`, `i-offerings-read-only.mjs`) are **also** invoked by jobs
that *do* get batched away (`orch-1276`, `orch-1277`, `orch-1278`). Had a carve-out job run only
a subset of a gate's modes, the rest would have vanished with those jobs. The manifest generator
hard-fails unless every carve-out gate's **full mode union is covered by its own job**:

```
carve-out mode coverage: OK — every carve-out gate's full mode union is run by its own job
```

D1b (`0` dropped `(script, mode)`) is the independent confirmation.

---

## 6. A pre-existing bug this proof surfaced

Three gates **cannot run from any per-ORCH worktree**, because the standard worktree path
`ORCH-1383-[ci-strict-grep-consolidation]` contains `[` `]`, which percent-encode in a
`file://` URL. The gates resolve their sibling script via `new URL(...).pathname` (which
retains `%5B`/`%5D`) instead of `fileURLToPath()`:

```
Error: Cannot find module '/Users/.../ORCH-1383-%5Bci-strict-grep-consolidation%5D/
  .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs'
```

Affected: `i-proposed-orch-0931-no-pk-filter-realtime.test.mjs`,
`i-proposed-orch-0939-collab-deck-has-per-session-provider.test.mjs`,
`i-proposed-orch-0943-custom-coords-locked.test.mjs`.

**Not caused by batching, and not a regression.** Proven both ways:

```console
# the OLD workflow's exact command, same bracket path -> fails IDENTICALLY
$ node --test .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs
Error: Cannot find module '.../ORCH-1383-%5Bci...%5D/...' MODULE_NOT_FOUND

# the same command from a bracket-free path -> passes
$ cd /tmp/clean-checkout && node --test .../i-proposed-orch-0931-no-pk-filter-realtime.test.mjs
# pass 2
# fail 0
```

CI checks out to `/home/runner/work/mingla-main/mingla-main` (no brackets), which is why the
baseline is green. This is why the proof runs from a bracket-free clone. Routed to the
orchestrator as a discovery — it means **no implementor or tester can run these 3 gates
locally from a standard per-ORCH worktree**, and SC-16 forbids fixing them here.

---

## 7. Scope boundary — what this does NOT prove

Carried verbatim from SPEC §11, because it must not be lost:

> **ORCH-1383 proves that the same gate scripts still RUN and still produce the same verdicts.
> It does NOT prove those verdicts mean anything.**
>
> **168 of 345 gates (48.7%) have no `--self-test`.** They can be proven to execute and to
> exit 0. **Nothing proves that exit 0 means anything.** They have never been shown to fail on
> the defect they exist to catch.
>
> **All five of the historical dark-gate failures live in that 48.7%.**
>
> **A sixth class: 21 gates that never run at all** — including
> `orch-1369-release-submit-config.adversarial.mjs`, dark **one day after ORCH-1369 closed**.
>
> **Batching does not create this risk. The risk is fully realized today.**
>
> **The honest status of this suite: 379 gates run, 178 are proven able to fail, the rest are
> decorative until demonstrated otherwise, and 21 more are on disk running nowhere.**
> **Do not let "CI is 34× cheaper and green" be read as "the suite is good."**

---

## 8. Reproduce

```bash
# 1. baseline (external, unfakeable)
gh api "repos/Mingla-LLC/mingla-main/actions/runs/29453557478/jobs?per_page=100" --paginate \
  -q '.jobs[] | [.name, .conclusion] | @tsv' > baseline-jobs.tsv   # 340 rows, all success

# 2. a BRACKET-FREE clone (see §6 — a worktree path with [ ] breaks 3 gates)
git clone <repo> /tmp/proof-clone && cd /tmp/proof-clone
git checkout ORCH-1383-ci-strict-grep-consolidation
npm install --no-save @babel/parser @babel/traverse madge typescript@~5.9.2 yaml

# 3. class C's prior step — its gate reads this stderr side-effect (SC-14)
(cd mingla-business && npm install --no-save \
  && EXPO_PUBLIC_SUPABASE_URL=https://stub.supabase.co \
     EXPO_PUBLIC_SUPABASE_ANON_KEY=stub_key_for_ci_export \
     npx expo export -p web 2>/tmp/expo-export-web.stderr || true)

# 4. the 5 batch classes  -> gate-results-{A..E}.json
for c in A B C D E; do node .github/scripts/strict-grep/run-batch.mjs --class $c; done

# 5. the 4 carve-out jobs -> gate-results-CARVE.json   (REQUIRED — these 8 gates are in no
#    batch class; omit this and the proof correctly reports 8 dark gates)
node run-carveouts.mjs /tmp/proof-clone

# 6. assert (OLD YAML-parsed at 60533968e; NEW from all 6 results files)
node diffproof.mjs /tmp/proof-clone baseline-jobs.tsv
```

The proof reads only results files produced by *this* run — each runner deletes its output
before starting, so an aborted step fails the proof closed rather than certifying stale data.
