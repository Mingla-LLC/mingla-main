# RESEARCH — GitHub Actions Cost Consolidation

**Date:** 2026-07-15
**Repo:** `Mingla-LLC/mingla-main` (private, 685 MB, org plan = **free**, 2 seats)
**Scope:** Analysis only. No code changed. Nothing staged or committed.
**Method:** GitHub Actions REST API (`runs`, `jobs`, `timing`), GitHub Billing Usage API
(`/organizations/Mingla-LLC/settings/billing/usage`), static parse of all 12 workflow files,
and a local sequential timing run of all 507 strict-grep gate invocations.

---

## 0. TL;DR — the five things that matter

1. **The framing is right about where the money is, and understates it.** strict-grep is
   **96.8%** of all Actions spend. Everything else combined is 3.2% ($15.53 per half-month).
2. **The framing is wrong about the unit price and the diagnosis of the waste.** The rate is
   **$0.006/min, not $0.008** (billing API, exact). And the waste is **not primarily
   per-minute rounding** — it is **per-job setup duplication**: 82% of job time is
   `checkout` + `setup-node` paid **341 times**. Real gate work is **2.1 minutes** per run.
3. **Batching is cheaper AND faster.** No tradeoff exists. All 507 gates run sequentially in
   **67.5 seconds** on a laptop. Today's 341 jobs take **6.4–11.8 min wall clock**; a batched
   design lands at **~3 min wall** and **10 billed min** (vs ~345). That is **34× cheaper and
   2–4× faster**.
4. **Mingla has paid $0.00. Ever.** May $544.99, June $1,066.59, July-to-date $483.57 — all
   gross, all 100% discounted, **net $0.00 every month**. The `$483.57` is a *notional* number.
5. **⚠️ No workflow change will unblock CI.** The block is confirmed verbatim by GitHub as a
   billing/spending-limit block. Someone must fix billing **in GitHub settings**. Cost work is
   necessary but **not sufficient** — and even a 95% cut still leaves the repo **4.2× over the
   free plan's 2,000 min/month allowance**.

---

## 1. Cost attribution — ranked, measured, reconciled

The Billing Usage API reconciles **exactly** to the reported figure:

```
80,595 minutes × $0.006/min = $483.57   ✓ exact match
sku = "Actions Linux"   pricePerUnit = 0.006   (NOT $0.008)
```

### Ranked cost table — July 1–15, 2026

| # | Workflow | Runs | Jobs/run | Billed min/run | **Billed min** | **% spend** | Gross $ |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | **strict-grep-mingla-business.yml** | 260 | 273→341 | ~300 | **78,006** | **96.8%** | **$468.04** |
| 2 | supabase-migrations-and-stripe-deno.yml | 94 | 3–17 | 9.4 | 884 | 1.1% | $5.30 |
| 3 | web-build-check.yml | 215 | 1 | 2.4 | 516 | 0.6% | $3.10 |
| 4 | production-readiness-audit.yml | 159 | 2 | 2.9 | 461 | 0.6% | $2.77 |
| 5 | docs-artifact-regression.yml | 276 | 1 | 1.0 | 276 | 0.3% | $1.66 |
| 6 | tests-append-only.yml | 215 | 1 | 1.0 | 215 | 0.3% | $1.29 |
| 7 | deploy-functions.yml | 29 | 1 | 4.6 | 133 | 0.2% | $0.80 |
| 8 | meta-orch-1337-social-proof-tests.yml | 34 | 2 | 2.9 | 99 | 0.1% | $0.59 |
| 9 | orch-1371-1372-tester-adversarial.yml | 3 | 1 | 1.0 | 3 | ~0% | $0.02 |
| 10 | stripe-connect-smoke.yml | 1 | 1 | 1.0 | 1 | ~0% | $0.01 |
| 11 | Dependabot (dynamic) | 1 | 1 | ~1 | 1 | ~0% | $0.01 |
| 12 | rotate-apple-jwt.yml / load-smoke.yml | 0 | — | — | 0 | 0% | $0.00 |
| | **TOTAL** | **1,287** | | | **80,595** | **100%** | **$483.57** |

**PROVEN: strict-grep is the dominant cost — 96.8%, not merely "dominant."**
Every other workflow combined is $15.53 per half-month. *Nothing outside strict-grep is worth
touching for cost reasons.*

**Method note (honest):** rows 2–11 are measured directly (8-run sample per workflow, spread
across the month, real `started_at`/`completed_at` per job, billed as `ceil(seconds/60)` per
job, min 1). Row 1 is derived as the residual (`80,595 − 2,589`), which yields **300 billed
min/run**. That residual is **independently corroborated** by direct measurement of 8
strict-grep runs: 275 / 323 / 327 / 329 / 334 / 336 / 339 / 345 billed min — mean ≈ 300. The
two methods agree, which also **validates the `ceil`-per-job billing model**.

### What I could NOT measure
- **`/runs/{id}/timing` is useless here** — `billable.UBUNTU.total_ms` returns **0** even for
  old successful runs. I reconstructed billing from per-job timestamps instead.
- **The global `/actions/runs` list caps at 1,000 results** even with `--paginate`. I worked
  around it by querying each workflow's own `runs` endpoint and reading `total_count`.
- **Run counts:** measured **1,287**, framing said 1,266 — the gap is runs landing during
  analysis, plus the 1,000-row cap on the global list. Framing is fine.
- **The spending limit value itself** needs `admin:org` scope, which this token lacks.

---

## 2. What the 341 jobs actually ARE

Static parse of the 255 KB workflow:

| Property | Value |
|---|---|
| Jobs | **340** (341st = run-level) |
| `runs-on: ubuntu-latest` | 338 |
| `actions/checkout@v4` steps | **338 — one per job** |
| `actions/setup-node@v4` steps | **335 — one per job** |
| `needs:` (dependencies) | **0** |
| `strategy:` / matrix | **0** |
| `timeout-minutes` | **0** ⚠️ |
| `cache:` | **0** |
| `fetch-depth: 0` (full clone of 685 MB) | 3 |
| `concurrency` | **0** |

**Answering the question directly: yes, they are all one-liners, and yes, per-job setup is
being paid 341×.** The canonical job is exactly four steps:

```yaml
  meta-orch-1060-consumer-location-no-nominatim:
    name: "META-ORCH-1060: INV-1 consumer location has no Nominatim/OSM"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - name: Self-test the gate
        run: node .github/scripts/strict-grep/i-consumer-location-no-nominatim.mjs --self-test
      - name: Run META-ORCH-1060 INV-1 no-nominatim gate
        run: node .github/scripts/strict-grep/i-consumer-location-no-nominatim.mjs
```

**No job has `needs:`. No job uses a matrix. Nothing requires isolation.** Every gate is an
independent, read-only static scanner with a clean process contract:

```
Exit codes: 0 pass · 1 fail · 2 fs error
Self-test mode (--self-test) validates the detector against fixtures.
```

This is close to an ideal batching substrate — the gates are already processes with
well-defined exit codes and no shared state.

### 🔬 Step-level decomposition — where the time ACTUALLY goes

Measured on run `28520612146` (273 jobs, Jul 1, success), summing every step across every job:

| Step | Count | Mean | **Total** | **Share** |
|---|---:|---:|---:|---:|
| `actions/checkout@v4` | 273 | 12.4s | **3,384s (56.4 min)** | **68%** |
| `actions/setup-node@v4` | 271 | 4.3s | **1,166s (19.4 min)** | **24%** |
| `Set up job` | 273 | 0.6s | 170s | 3% |
| Post-checkout / post-node / complete | ~820 | ~0.1s | 99s | 2% |
| **— all real gate work —** | ~518 | ~0.25s | **127s (2.1 min)** | **2.6%** |
| **TOTAL step time** | | | **4,946s (82.4 min)** | 100% |

**This is the headline correction. `~80 of the 82 minutes` is setup. The gates themselves are
2.1 minutes.**

### Local ground-truth timing (the decisive measurement)

I ran **all 507 distinct gate invocations sequentially on a laptop**:

```
gates timed         : 507
TOTAL sequential    : 67.5s   (1.12 min)
median gate         : 0.09s
mean gate           : 0.13s
p95 gate            : 0.26s
max gate            : 6.20s   (i-proposed-k-require-cycles — madge)
exit codes          : {0: 500, 1: 6, 2: 1}
```

The 7 non-zero exits are exactly the 7 gates that need dependencies installed
(`@babel/parser`, `madge`, `typescript`, `expo`) — which the workflow installs per-job. They
are not failures; they confirm the dependency grouping below.

**The entire 341-job, ~345-billed-minute suite is 67 seconds of actual work.**

---

## 3. The batching math

Ubuntu 2-core, **$0.006/min measured** (GitHub's published paid rate is $0.008 — both shown).

### Baseline (measured, run `29444719767`, Jul 15)
```
338 jobs · 345 billed min · 126.0 min actual compute · 9.2 min WALL CLOCK
```

### Options modeled

| Option | Jobs | Billed min | **Wall clock** | $/run @0.006 | $/run @0.008 | vs today |
|---|---:|---:|---:|---:|---:|---:|
| **Today** | 341 | **345** | **6.4–11.8 min** | $2.07 | $2.76 | 1× |
| One job, all gates sequential | 1 | **4** | ~4 min | $0.024 | $0.032 | **86× cheaper** |
| **5 jobs by dependency class ← RECOMMENDED** | 5 | **10** | **~3 min** | $0.060 | $0.080 | **34× cheaper** |
| N=4 arbitrary batches | 4 | ~12 | ~2.5 min | $0.072 | $0.096 | 29× |
| N=8 arbitrary batches | 8 | ~16 | ~2 min | $0.096 | $0.128 | 22× |
| N=16 arbitrary batches | 16 | ~24 | ~2 min | $0.144 | $0.192 | 14× |

**Arbitrary N-batching (4/8/16) is strictly worse than dependency-class grouping**, because
each batch re-pays `checkout + setup-node` (17.3s) *and* the npm-install jobs get duplicated
across batches. More batches = more setup = more cost, for wall-clock gains that flatten out
around N=4 (the suite is only 67s of work; you cannot parallelize below runner-boot time).

### ⚠️ The wall-clock tradeoff Seth is worried about DOES NOT EXIST HERE

**Batching is faster, not slower.** Today's 341 jobs queue against ~20 concurrent runners and
take **6.4–11.8 min wall**. The recommended 5-job design finishes in **~3 min wall**. This is
the rare case where the cheap option is also the fast option — because the cost *is* the
overhead, and the overhead is also the latency.

> The framing's premise — *"A 10× saving that makes every PR wait 25 minutes may be a bad
> trade"* — is a sound instinct that **does not apply**. There is no 25-minute scenario. The
> worst modeled option (1 job, fully sequential) is **4 minutes**, still faster than today.

### RECOMMENDED: 5 jobs, grouped by dependency class

| Job | Contents | Setup | Work | **Billed** |
|---|---|---|---:|---:|
| **A** `static-gates` | ~330 pure-node gates, `fetch-depth: 1` | checkout+node 17s | ~135s | **3 min** |
| **B** `dep-gates` | 7 gates needing `@babel/parser`/`madge`/`typescript` (i37, i38, i39, i-proposed-a, orch-0808, i-proposed-k, orch-1058) | +npm install ~15s | ~10s | **1 min** |
| **C** `expo-export-gate` | `i-proposed-x-web-deprecation` (`npm install` + `npx expo export -p web`) | +73s | ~5s | **2 min** |
| **D** `jest-suites` | `orch-1240`, `orch-0901` (`npm run test --prefix app-mobile`) | +npm ci ~40s | ~30s | **2 min** |
| **E** `full-clone-gates` | 3 gates needing `fetch-depth: 0` (regression-test-backfill-warning, orch-0863, orch-0948) | full clone ~60s | ~1s | **2 min** |
| | | | **TOTAL** | **10 min** |

Wall clock = `max(3,1,2,2,2)` ≈ **3 min** (the 5 jobs run in parallel; none has `needs:`).

---

## 4. `cancel-in-progress` — the directly recoverable waste

**Measured** across all 260 July strict-grep runs: for each `(branch, event)` pair, a run is
"superseded" if a later run was *created before it finished*.

```
total July strict-grep runs                          : 260
runs SUPERSEDED before finishing (would be cancelled):  28  (10.8%)
   by event: pull_request 22 · push 6
   top branches: main(6), orch-1290-venue-authoring(3), orch-1255-venue-first-class(3), …
```

**Recoverable today, before any batching: 28 × 300 = 8,400 billed min per half-month
= $50.40 gross / ~$100 per month.** That is ~10.8% of total spend, recovered by a 3-line YAML
addition with zero effect on gate strength.

### Exact YAML

Insert at **top level** (sibling of `on:` / `jobs:`), in **`strict-grep-mingla-business.yml`**
(line ~32, right after the `on:` block ends), and in **`web-build-check.yml`**,
**`tests-append-only.yml`**, **`docs-artifact-regression.yml`**,
**`production-readiness-audit.yml`**, **`supabase-migrations-and-stripe-deno.yml`**,
**`meta-orch-1337-social-proof-tests.yml`**, **`orch-1371-1372-tester-adversarial.yml`**:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

**Why `cancel-in-progress` is an expression, not `true`:** cancelling on a `push` to `main`
would abandon the post-merge verification run for that commit. Guarding on
`github.event_name == 'pull_request'` recovers the 22 PR-side supersessions (79% of the waste)
while leaving `main` runs to always complete.

### 🚫 DO NOT add this to `deploy-functions.yml`

That workflow loops `supabase functions deploy` over every function on `push: main`.
Cancelling it mid-loop leaves the edge-function fleet **half-deployed** — some functions on the
new version, some on the old, with no signal. Its 29 runs cost **$0.80 per half-month**. Leave
it alone. `rotate-apple-jwt.yml` (schedule) and `stripe-connect-smoke.yml` likewise are not
worth the risk at $0.01–0.00.

---

## 5. Other workflows

**Nothing outside strict-grep justifies work on cost grounds** — the entire remainder is
$15.53 per half-month. But answering the specific questions:

- **`supabase-migrations-and-stripe-deno.yml` (17 jobs, 884 min, $5.30) — worth batching? Marginally.**
  Same anti-pattern: 17 jobs × (`checkout` + `setup-deno`), no `needs:`, no matrix. Grouping
  the ~8 Deno-test jobs into one and the ~5 strict-grep jobs into another takes it from 9.4 →
  ~4 billed min/run, saving ~1,200 min/month ≈ **$7/month**. Do it *after* strict-grep, as a
  copy of the same pattern — not before.
- **Any other multi-job offenders?** No. Ranked by jobs/run: strict-grep (341), supabase (17),
  load-smoke (5, but **0 runs in July**), production-readiness (2), meta-1337 (2). Everything
  else is single-job.
- **Anything running on `push` when `pull_request` alone would do?** This is the one non-trivial
  finding here. strict-grep July split:
  ```
  pull_request : 158 runs
  push         : 102 runs   — ALL 102 on branch `main`, zero on `Seth`
  ```
  Those 102 `main` pushes are **39% of strict-grep runs ≈ $184 gross per half-month**. They are
  *largely* redundant: the `pull_request` event tests `refs/pull/N/merge` (main + PR merged),
  which for a squash-merge onto an unmoved `main` is the same tree that lands.

  **Recommendation: KEEP them.** Two reasons. (1) They are the only guard against a semantic
  conflict when `main` moves between the PR run and the merge — and this repo merges with
  `gh pr merge --squash --admin`, which can land a PR whose checks predate a `main` move.
  (2) Once batched, all 102 runs cost **$6/month total**. Deleting a real safety net to save
  $6 is a bad trade. Flagging it only as the *next* lever if the number ever needs to go lower.

---

## 6. The "3 missing path filters" — **the framing is wrong here**

Measured across all 12 workflows. It is **2, not 3** — and **10 of 12 already have filters**,
not 9. More importantly, **both should be left alone.**

| Workflow | push | pull_request |
|---|---|---|
| deploy-functions.yml | paths ✅ | — |
| docs-artifact-regression.yml | paths ✅ | paths ✅ |
| load-smoke.yml | paths ✅ | paths ✅ |
| meta-orch-1337-social-proof-tests.yml | paths ✅ | paths ✅ |
| orch-1371-1372-tester-adversarial.yml | paths ✅ | paths ✅ |
| production-readiness-audit.yml | paths ✅ | paths ✅ |
| rotate-apple-jwt.yml | *(schedule only — N/A)* | — |
| strict-grep-mingla-business.yml | paths ✅ | paths ✅ |
| stripe-connect-smoke.yml | paths ✅ | — |
| supabase-migrations-and-stripe-deno.yml | paths ✅ | paths ✅ |
| **tests-append-only.yml** | **❌ none** | **❌ none** |
| **web-build-check.yml** | — | **❌ none** |

### Recommendation: add NEITHER. The measurement says the reward is ~$4 and the risk is real.

- **`tests-append-only.yml` — 215 runs, 215 billed min, $1.29 per half-month.** This is the
  gate that enforces the test append-only token. Its *entire purpose* is to notice when
  **any** test file is deleted or rewritten. A `paths:` filter is precisely the mechanism by
  which it would **stop firing on the change it exists to catch** — a path the filter misses is
  a deleted test that ships green. **This is one of the five dark-gate failures in this
  codebase's history, waiting to happen.** Spending $1.29 to keep it unconditional is the
  cheapest insurance in the repo. **Leave it.**
- **`web-build-check.yml` — 215 runs, 516 billed min, $3.10 per half-month.** A filter over the
  web trees would save maybe $2. Same class of risk (a missed path = an unbuilt web bundle
  shipping). Not worth it. **Leave it.**

> **Correcting the framing:** item 6 asked "what should they be?" — the evidence-based answer
> is *"they should not exist."* Together these two workflows are **0.9% of spend**. Path
> filtering is not where the money is (the framing already says this) — and here it is
> actively negative-value. The repo's own history (`meta-orch-1337` header comments) records
> that path filters "err BROAD" precisely because *"a filter that misses a future edit silently
> skips the guard."* Applying that same house rule: don't add these.

---

## 7. Free wins (quantified)

| Win | Applies to | Saving | Verdict |
|---|---|---|---|
| **`cancel-in-progress`** | 7 workflows | **8,400 min / $50 per half-month (10.8%)** | ✅ **DO — biggest non-batching win** |
| **`timeout-minutes`** | **0 of 12 workflows have it** | $0 today; caps unbounded downside | ✅ **DO — pure insurance** |
| `fetch-depth: 1` | — | **$0 — already the default** in `actions/checkout@v4` | ❌ **No win.** The 12.4s checkout is the 685 MB repo, not depth. The only 3 jobs at `fetch-depth: 0` are correctly isolated into job E. |
| Dependency caching (`cache: npm`) | 9 of 341 jobs install deps | ~$1 per half-month | ⚠️ **Marginal.** Becomes irrelevant after batching (npm install runs 1×, not 9×). |
| Drop duplicate `push`+`pull_request` | strict-grep `main` pushes | $184/half-month | ⚠️ **Declined** — see §5. Real safety net, $6/mo after batching. |
| Path filters | tests-append-only, web-build-check | ~$4/half-month | ❌ **Declined** — see §6. Negative value. |

**`timeout-minutes` is the one I'd add regardless of cost.** Zero of twelve workflows set it.
Only `rotate-apple-jwt.yml` has one (`timeout-minutes: 5`). A gate that hangs — an infinite
loop in a regex, a network call with no timeout — bills **360 minutes** (GitHub's 6-hour
default) × however many jobs hang. Recommended: `timeout-minutes: 10` on each of the 5 batched
jobs. It costs nothing and caps a tail risk that currently has no ceiling.

---

## 8. 🔴 THE HARD CONSTRAINT — how we prove no gate went dark

This is the section that decides whether this is a cost fix or a catastrophe. **I can answer it
for execution coverage with certainty. I cannot answer it for defect-detection on half the
gates — and that is true TODAY, before any batching.**

### 8.1 The measurement nobody asked for, that changes the answer

```
distinct gate scripts RUN in CI       : 340
distinct gates with --self-test in CI : 167
gates with NO self-test step in CI    : 175
   ├─ supports --self-test in source but NOT wired in CI :   7   ← free win
   └─ NO --self-test capability at all                   : 168   ← UNPROVABLE TODAY
```

**168 of 340 gates (49%) have no self-test at all.** They have never been proven to fail on
their defect. The repo's five historical dark-gate failures (the single-line regex vs
multi-line code; the two gates green while a live production bug shipped; the five
token-presence test files; the `rel="noopener"` check passing off an unrelated socials row)
**live in this 49%**.

> **This is the most important finding in the report, and it is not a cost finding.**
> Batching does not create this risk — the risk is already there, fully realized, today.
> But batching is the moment it either gets fixed or gets permanently buried.

### 8.2 What batching CAN be proven to preserve — mechanically, with certainty

Execution coverage is provable because the gate contract is uniform (`exit 0/1/2`) and the
job→script mapping is mechanical. The design must enforce:

1. **An explicit checked-in manifest** (`.github/scripts/strict-grep/MANIFEST.json`) listing
   every gate: script path, dependency class (A–E), and whether it has `--self-test`.
2. **A manifest-parity gate** (itself a strict-grep gate, in job A) asserting:
   - every `*.mjs` in `.github/scripts/strict-grep/` (minus fixtures/`__tests__`) appears in the manifest;
   - `manifest.length === EXPECTED_GATE_COUNT` (a hardcoded integer, currently **340**);
   - every manifest entry's file exists on disk.
   → Adding a gate without registering it **fails the PR**. Deleting a gate **fails the PR**.
   This is the same strict-grep registry pattern the repo already uses.
3. **A batch runner with these non-negotiable properties:**
   - iterates the manifest — **never a glob** (the repo's own house rule: *"a glob silently
     picks up unrelated suites and silently DROPS a renamed suite"*);
   - **never `break`s on first failure** and **never runs under bare `set -e`** — every gate
     runs, failures accumulate;
   - a **missing script is a FAIL (exit 2), never a skip** — this is the exact
     "script exits 0 when a gate file is missing" trap named in the brief;
   - counts executed gates and asserts `executed === manifest.length` — **a coverage shortfall
     is itself a failure**, independent of gate verdicts;
   - prints one line per gate (`name → exit code`) so the log is an audit trail;
   - writes a machine-readable `gate-results.json` and uploads it as an artifact;
   - exits non-zero if **any** gate failed **OR** coverage < 100%.
4. **The differential proof — this is the one that actually settles it.** We have, via the
   Actions API, the complete per-job result set of the last GREEN pre-block strict-grep run
   (`29444719767`, Jul 15, 338 jobs, every job name + conclusion). Before merging the batch:
   - run the batched runner against that same SHA;
   - assert **set equality** between `{gate → verdict}` from the 338 jobs and
     `{gate → verdict}` from the batch;
   - **any gate present in the old set and absent from the new set is a dark gate, and the
     merge is blocked.**
   This is a byte-level A/B against known ground truth. It is cheap, it is mechanical, and it
   is conclusive for execution coverage.
5. **Self-test every gate that has one.** Wire `--self-test` for all **167 + the 7 unwired =
   174** gates into the batch, and add a manifest assertion that a gate which *had* a
   self-test can never lose it. Cost: ~22s of the 67s. `--self-test` **is** the fails-on-revert
   proof — it feeds a known-bad fixture and asserts the detector fires.

### 8.3 What CANNOT be proven — stated plainly, as required

**For the 168 gates with no `--self-test`, I cannot prove they still fail when their defect is
reintroduced — before batching or after.** There is no fixture, no mutation harness, and no
recorded red run for them. The batch runner can prove they *executed* and *exited 0*. It cannot
prove that exit 0 means anything.

That distinction is the whole ballgame, and it is exactly the failure mode the brief names: a
gate that runs, passes, and is inert. **A gate that cannot fail is indistinguishable from a
gate that was deleted — and 49% of this suite is in that state right now.**

**Therefore the recommended sequencing is:**

- **Phase 0 (do first, independent of cost):** land the manifest + parity gate + differential
  proof against run `29444719767`. This is pure safety infrastructure and buys the ability to
  detect a dark gate at all.
- **Phase 1:** batch into the 5 dependency-class jobs, gated on the Phase-0 differential proof
  passing. **Execution coverage is provably preserved.** Ship the cost win.
- **Phase 2 (the real work, and it is not optional):** backfill `--self-test` fixtures for the
  168 unproven gates, in priority order (money paths → auth/RLS → store compliance → UI). Each
  backfill is a small, independently verifiable PR. **Until Phase 2 completes, the honest
  status of this suite is "340 gates run, 172 are proven able to fail, 168 are decorative until
  demonstrated otherwise."**

Batching is safe to do. **But do not let the cost win be used as evidence that the suite is
healthy.** It measured 96.8% of the bill and roughly 50% of its own guarantees.

---

## 9. Projected spend

### Current run-rate (measured)

| Month | Minutes | Gross | **Net charged** |
|---|---:|---:|---:|
| 2026-04 | 66 | $0.40 | **$0.00** |
| 2026-05 | 90,832 | $544.99 | **$0.00** |
| 2026-06 | **177,765** | **$1,066.59** | **$0.00** |
| 2026-07 (1–15) | 80,595 | $483.57 | **$0.00** |

July's half-month pace → **161,190 min/month ≈ $967/month gross**. June's actual (177,765 min)
confirms the ~$1,000/month run-rate. **$483.57 is a half-month number — the true monthly
exposure is roughly double it.**

### After all recommended changes

| Component | Today (min/mo) | After (min/mo) |
|---|---:|---:|
| strict-grep (520 runs × 10 min, −10.8% cancel-in-progress) | 156,012 | **4,638** |
| supabase-migrations (batched 17→4 jobs) | 1,768 | 752 |
| all other workflows (−10% cancel-in-progress) | 3,410 | 3,070 |
| **TOTAL** | **161,190** | **8,460** |
| **Gross @ $0.006/min** | **$967.14** | **$50.76** |
| **vs $483.57 (half-month) today** | | **$25.38 per half-month** |

### 🎯 Bottom line: **$967/month → $51/month gross. A 94.8% reduction.**
Against the reported half-month figure: **$483.57 → $25.38.**
And wall-clock PR feedback **improves** from 6.4–11.8 min to ~3 min.

---

## 10. ⚠️ CRITICAL — what this plan does NOT fix

### 10.1 The block is an account action. No YAML change touches it.

GitHub's verbatim annotation on the blocked run (`29458895730`, job check-run annotation):

> **"The job was not started because recent account payments have failed or your spending limit
> needs to be increased. Please check the 'Billing & plans' section in your settings"**

The framing's diagnosis is **CONFIRMED**: billing/spending-limit block, not config. Actions
are `enabled: true`; jobs report `steps: 0`, `duration_ms: 0`, ~4s to failure. The last
successful run anywhere in the repo was **Web Build Check at 2026-07-15 22:33 UTC**; the block
began ~23:13 UTC the same day.

**Someone must fix billing in GitHub org settings today. Until then CI stays dark no matter
what we do to the workflows.** This report's entire value is preventing the *next* block, not
clearing this one.

### 10.2 Even at $51/month, the free plan does not fit

The org is on **plan = free** (2 seats), which includes **2,000 Actions minutes/month** for
private repos. The optimized target is **8,460 min/month — still 4.2× over.**

So a payment method + a raised spending limit are **required regardless of how well we
optimize**. The good news is the cost of doing so becomes trivial:

| Scenario | Minutes/mo | Over allowance | Payable |
|---|---:|---:|---:|
| Today, free plan (2,000 incl.) | 161,190 | 159,190 | **~$1,273/mo** @ $0.008 |
| After changes, free plan (2,000 incl.) | 8,460 | 6,460 | **~$52/mo** @ $0.008 |
| After changes, Team plan (3,000 incl., $8/mo for 2 seats) | 8,460 | 5,460 | **~$44/mo + $8 = $52/mo** |

**Recommended:** attach a payment method, set a spending limit of **$75/month** (≈1.5× the
projected $52, so a regression trips the limit instead of silently costing $1,000), and land
the batching. The spending limit then functions as a **cost regression alarm** — which is
exactly what was missing for the last three months, during which $2,095 of gross usage accrued
unnoticed because **net was always $0.00 and nothing ever showed up on a card.**

That is the real root cause of this incident: **the feedback signal was disconnected.** The
usage was free, so nobody looked, so a 341-job workflow grew from 273 → 341 jobs across July
with no cost pressure at all.

---

## 11. Where the framing was WRONG (as requested)

| # | Framing claim | Verdict | Evidence |
|---|---|---|---|
| 1 | "Ubuntu 2-core = **$0.008/min**" | ❌ **WRONG** | Billing API: `pricePerUnit: 0.006`, `sku: "Actions Linux"`. 80,595 × $0.006 = $483.57 exactly. Framing overstates unit price by 33%. |
| 2 | "Gates take **~4s** of real work → ~23 min actual compute" | ❌ **WRONG (understates the win)** | Median job = **20s**, not 4s. Actual compute = **126 min/run**, not 23. But real *gate* work = **2.1 min/run**, and all 507 gates run in **67.5s** locally. |
| 3 | "**~93% of spend is rounding waste**" | ❌ **WRONG DIAGNOSIS** | Rounding waste is **65%** (275 billed vs 96.5 actual). The dominant waste is **setup duplication**: `checkout`(68%) + `setup-node`(24%) = **92% of job time**, paid 341×. Right conclusion, wrong mechanism — and the mechanism matters, because it's why batching wins ~86× rather than the ~15× rounding alone would predict. |
| 4 | "**9 of 12** have `paths:` — 3 missing" | ❌ **WRONG** | **10 of 12** have them. Only **2** lack them (`tests-append-only.yml`, `web-build-check.yml`). And **both should stay unfiltered** — combined 0.9% of spend, and filtering `tests-append-only` would arm the exact dark-gate failure mode the brief warns about. |
| 5 | "**$483.57** gross metered usage" | ⚠️ **TRUE BUT MISLEADING** | Gross is right. **Net charged = $0.00** — every month since April. May $545, June **$1,067**, July-to-date $484: **all 100% discounted, $2,095 gross, $0 collected.** July is a *half* month; true exposure ≈ **$967/mo**. |
| 6 | "**1,266** runs since Jul 1 / **341 jobs**" | ✅ **CONFIRMED** | Measured 1,287 runs (gap = analysis-window drift + the API's 1,000-row cap). 341 jobs confirmed — though it was **273 on Jul 1** and grew to 341 by Jul 15. |
| 7 | "**strict-grep is the dominant cost**" | ✅ **CONFIRMED, STRONGER** | **96.8%** ($468.04 of $483.57). Everything else combined is $15.53. |
| 8 | "**0 of 12** have `cancel-in-progress`" | ✅ **CONFIRMED** | Zero. Also **0 of 12** set `timeout-minutes` — an unbounded tail risk the framing didn't flag. |
| 9 | "Billing/spending-limit block, not config" | ✅ **CONFIRMED VERBATIM** | GitHub annotation quoted in §10.1. |
| 10 | "A 10× saving that makes every PR wait 25 min may be a bad trade" | ⚠️ **PREMISE DOESN'T APPLY** | **No tradeoff exists.** Batching is **34× cheaper AND 2–4× faster** (3 min vs 6.4–11.8 min). Worst modeled option is 4 min. |
| — | *(not in framing)* | 🔴 **NEW — most important** | **168 of 340 gates (49%) have no `--self-test` and cannot be proven to fail on their defect — today, before any batching.** See §8. |

---

## Appendix — reproduction

```bash
# Ground-truth billing (reconciles to $483.57 exactly)
gh api "/organizations/Mingla-LLC/settings/billing/usage?year=2026&month=7"

# Per-workflow July run counts (avoids the 1,000-row cap on /actions/runs)
gh api "repos/Mingla-LLC/mingla-main/actions/workflows/271914022/runs?created=%3E%3D2026-07-01&per_page=1" -q .total_count

# Per-job real durations (the /timing endpoint returns total_ms:0 — do not trust it)
gh api "repos/Mingla-LLC/mingla-main/actions/runs/28520612146/jobs?per_page=100" --paginate \
  -q '.jobs[] | [.name, .started_at, .completed_at] | @tsv'

# The block, verbatim
gh api "repos/Mingla-LLC/mingla-main/check-runs/87498038281/annotations"

# Local gate timing (67.5s for all 507)
grep -oE 'run: node \.github/scripts/strict-grep/[^ ]+( --self-test)?' \
  .github/workflows/strict-grep-mingla-business.yml | sed 's/^run: //' | sort -u
```

**Reference run IDs:** last green strict-grep `29444719767` (338 jobs, 345 billed min, 9.2 min
wall) · step-decomposition source `28520612146` (273 jobs, Jul 1) · first blocked run
`29458895730`.
