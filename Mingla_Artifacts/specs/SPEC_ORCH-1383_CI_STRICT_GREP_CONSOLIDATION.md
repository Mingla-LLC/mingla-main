# SPEC — ORCH-1383 [ci-strict-grep-consolidation]

**Mode:** SPEC (build contract). No implementation.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1383-[ci-strict-grep-consolidation]` on branch `ORCH-1383-ci-strict-grep-consolidation`
**Upstream research:** `Mingla_Artifacts/reports/RESEARCH_CI_ACTIONS_CONSOLIDATION.md` (commit `e31068f33`)
**Measurement baseline:** current `origin/main` tip `60533968e513be47b93f89c8c84d0d7f1927d9b1`
**Author's stance:** built ON the research, with **7 measured corrections** to it (§1.1). Every number below was re-measured against the current tree — the research is 2 jobs stale and its differential-proof run ID is wrong.

---

## 1. Executive summary

`strict-grep-mingla-business.yml` runs **340 separate CI jobs**, each of which checks out the repo and installs Node just to execute a ~0.1-second script. **92% of the machine time is duplicated setup.** The real work — all 524 gate invocations — takes **67 seconds** on a laptop.

This ORCH collapses those 340 jobs into **5 jobs grouped by what they need installed**, and adds `concurrency`/`cancel-in-progress` so a superseded PR run stops instead of finishing. Result: **~345 → ~10 billed minutes per run**, and PR feedback drops from **6.4–11.8 min to ~3 min**. Cheaper *and* faster — there is no tradeoff to weigh.

**Why now, given Actions are free:** the repo is currently PUBLIC, so Actions are free and unlimited — **today's cost is $0.00, and this ORCH is not justified on cost**. It is justified on:
1. **4× faster PR feedback, today, at $0** — 6.4–11.8 min → ~3 min.
2. **~95% lower cost the moment the repo goes private again** — which is the stated plan. Doing this while it's free means the bill never re-appears.

**The whole risk is one thing: batching is exactly how a gate silently stops running.** This codebase has already produced **six** classes of dark gate — five named in the brief, plus a sixth this spec discovered: **21 real gate scripts are committed, carry `process.exit(1)` contracts, and are executed by no CI workflow at all** (§1.1-C). The registry pattern has *already* failed 21 times, silently. So the batching design is subordinate to a proof obligation: **§6 differential proof is a REQUIRED, merge-blocking build step**, not a nice-to-have.

**What this ORCH proves, stated plainly:** it proves **execution**, not **efficacy**. It proves the same gate scripts run and produce the same verdicts. It does **not** prove those verdicts mean anything — **168 of 345 gates (48.7%) have no `--self-test` and cannot be shown to fail on their own defect, before or after this change**. That is pre-existing, out of scope here, and must never be papered over by the cost win (§3, §11).

---

## 1.1 What is WRONG in the research and in the dispatch framing

Required by /goal. Each item is measured, with the command that proves it.

### CORRECTION A — 🔴 The differential-proof run ID is WRONG. This is the blocker.

The framing calls run `29444719767` "the clincher — the last fully-green run has the complete per-job result set (338 jobs)". It is **not a strict-grep run at all**:

```console
$ gh api repos/Mingla-LLC/mingla-main/actions/runs/29444719767 -q '{name:.name,workflow:.workflow_id}'
{"name":"Web Build Check","workflow":285238478}
$ gh api repos/Mingla-LLC/mingla-main/actions/runs/29444719767/jobs -q '.total_count'
1
```

`29444719767` is **Web Build Check — a single-job workflow**. strict-grep is workflow `271914022`. The research's own §10.1 says "the last successful run *anywhere in the repo* was **Web Build Check**" — the author conflated that with "last green *strict-grep* run" and carried the wrong ID into §8.2 and the Appendix.

The run the research **meant** is `29444719754` — same push, same second, ID differs by 13:

```console
$ gh api repos/Mingla-LLC/mingla-main/actions/runs/29444719754 -q '{name:.name,sha:.head_sha,conclusion:.conclusion}'
{"name":"Strict Grep Gates (Mingla Business)","sha":"68f8a879...","conclusion":"success"}   # 338 jobs, all success
```

**But we should not use that one either.** The correct baseline is **`29453557478`** (§6): 340 jobs, all green, `event: push`, `head_sha: 60533968e…` — **exactly the current `origin/main` tip this branch is rebased onto**. It is newer, has the full 340-job set, and its SHA is trivially checkoutable. Using it removes all drift from the proof.

### CORRECTION B — the research's counts are 2 jobs stale (and it's a mixed measurement)

Research §2 reports "Jobs: 340 · checkout: 338 · setup-node: 335". Current tree: **340 jobs · 340 checkout · 337 setup-node**. Cause: commit `60533968e` ("ISSUE-862 WP1: Full Rooms Ad Engine") landed 2 more jobs after the research measured but before it committed. The research's own §11 notes the workflow grew 273 → 341 across July; it grew again during the research itself. **Consequence: `EXPECTED_GATE_COUNT = 340` (research §8.2) is already wrong on arrival** — which is the best possible argument for §5's machine-derived manifest over a hand-typed integer.

### CORRECTION C — 🔴 NEW, and the research missed it entirely: 21 gates are already dark

Research §8 frames the dark-gate risk as "gates that run but can't fail" (the 168). There is a **sixth class it never looked for: gates that don't run at all.**

```console
# CI-enforced = direct workflow invocations ∪ gates reachable via npm scripts CI runs
# (CI runs exactly 2 npm scripts: test:orch-0901, test:orch-1240 — neither reaches a strict-grep gate)
CI-ENFORCED TOTAL : 352
ON DISK (.mjs)    : 384
NOT CI-ENFORCED   :  32   →  11 .test.mjs fixtures  +  21 REAL GATES
```

All 21 are standalone (imported by zero other gates — they are not libraries) and 17 carry an explicit `process.exit(1)` failure contract. They are invoked only from `package.json` scripts (`test:orch-0769`, `test:orch-0756a`, …) that **no CI workflow ever runs**. They are enforced only if a human runs them by hand.

The list (verbatim, and it goes in the manifest as `unenforced` in §5):

```
i-proposed-pay-in-full-opt-out-no-installment-rows.mjs   orch-0889-disabled-query-loading-state.mjs
i-proposed-tr2-livestore-addliveevent-owner.mjs          orch-0889-sticky-footer-via-hook.mjs
i-proposed-tr2-route-by-event-type.mjs                   orch-0891-chip-backspace-via-dom-handler.mjs
i-proposed-tr2-safearea-on-fullscreen-routes.mjs         orch-0891-chip-dom-contract.mjs
orch-0756a-active-brand-recovery.mjs                     orch-0891-no-tiptap-in-native-bundle.mjs
orch-0766f-event-cover-quicktime-storage.mjs             orch-0910-chat-payload-curated-aware.mjs
orch-0768-brand-audience-identity-honesty.mjs            orch-1054-partner-splits.mjs
orch-0769-app-wide-currency.mjs                          orch-1148-no-buyer-tax-form-in-venue-settings.mjs
orch-0770-event-cover-video-processing.mjs               orch-1162-map-single-owner.mjs
orch-0776a-video-upload-progress-honesty.mjs             orch-1187-tester-consent-gate-deletion-robust.mjs
orch-1369-release-submit-config.adversarial.mjs
```

**The last entry is the alarm.** `orch-1369-release-submit-config.adversarial.mjs` is referenced **0 times** in CI, while its sibling `orch-1369-release-submit-config.mjs` is wired twice. ORCH-1369 **closed 2026-07-14 — one day ago** — and shipped with its adversarial gate dark. This is not history; it is the live, current rate of failure.

**This is the single strongest justification for the manifest + parity gate, and it is not a batching risk — it exists today.** It also breaks the research's parity design as written: "every `*.mjs` in the dir appears in the manifest" would fail on arrival against 32 unaccounted files unless the manifest models an explicit `unenforced` state (§5).

### CORRECTION D — grep cannot discover the gate set. Both the research's method and my first two attempts were wrong.

This matters because the implementor will be tempted to build the manifest with grep. It fails **in both directions**:

- **Over-counts:** comments name gate paths. `orch-0839-b-mingla-business-no-native-stripe.mjs` appears in `strict-grep-mingla-business.yml:1873` and three gate scripts — as a comment. The file **does not exist**. A loose grep reports a phantom missing gate.
- **Under-counts:** multi-line `run: |` blocks invoke gates on continuation lines. The research's Appendix method (`grep -oE 'run: node \.github/scripts/strict-grep/…'`) anchors on `run:` and therefore **misses every gate invoked on line 2+ of a block** — e.g. `orch-0864-composer-v2.mjs` (workflow line 2322), which that method reports as "self-tested but never run".

**Binding consequence (§5):** the manifest MUST be generated by a **real YAML parser** walking each job's steps and scanning full `run:` scalars with comments stripped — never a line-anchored grep. The §6 differential proof exists precisely to catch a derivation error here.

### CORRECTION E — research §8.1 arithmetic is internally inconsistent; the headline `168` is nonetheless exactly right

Research §8.1 states `167 wired + 175 no-step` against `340 distinct gates` — **167 + 175 = 342 ≠ 340**. Re-measured on the current tree:

| Set | Count | Method |
|---|---:|---|
| distinct gates invoked in strict-grep | **345** | comment-stripped, multi-line-safe |
| `--self-test` **wired** in CI | **169** | |
| capable in source, **not wired** | **7** | named in §5.4 — a free win, **deferred** |
| **no `--self-test` capability at all** | **168** | ← the 48.7% |
| | **345** ✓ | reconciles exactly |

**The research's `168` is exactly correct.** Only the denominator was off: it is **168 of 345 (48.7%)**, not "of 340 (49%)". The framing's use of this number stands.

### CORRECTION F — the framing's "free wins" list is 3/4 contradicted by the research it cites

The dispatch says: *"Free wins where measured: `fetch-depth: 1`, dep caching, `timeout-minutes`, killing duplicate `push`+`pull_request` double-billing."* Research §7 measured all four and **declined three**:

| Framing "free win" | Research §7 verdict | This spec |
|---|---|---|
| `fetch-depth: 1` | ❌ **No win — already the default** in `actions/checkout@v4`. The 12.4s checkout is the 685 MB repo, not depth. | **Not adopted.** Only the 3 `fetch-depth: 0` jobs matter → isolated as class E. |
| dep caching | ⚠️ Marginal (~$1/half-month), **irrelevant after batching** (npm install runs 1×, not 9×). | **Not adopted** — batching subsumes it. |
| `timeout-minutes` | ✅ **DO** — 0 of 12 workflows set it (verified: only `rotate-apple-jwt.yml`). Unbounded tail risk. | **Adopted** (§4.3). |
| kill `push`+`pull_request` | ⚠️ **DECLINED** — the 102 `main` push runs are the only guard against a semantic conflict when `main` moves before a `--squash --admin` merge. $6/mo after batching. | **Not adopted.** Deleting a real safety net to save $6 is a bad trade. |

Only `timeout-minutes` survives. The framing's list should not be implemented as given.

### CORRECTION G — cost framing (agreeing with the dispatch, against the research)

The research's `$51/month` / `$483.57` figures are **private-repo numbers**. The repo is currently **public → Actions are free and unlimited → today's cost is $0.00**. The dispatch is right and the research is stale on this point. Research §10.1's "no workflow change will unblock CI" is **also now obsolete** — COMMS-0103 is `RESOLVED`, Actions are alive (proven by rerun `29458895739`, 8 steps, success). Note the research was never wrong-in-fact here: it measured `net charged = $0.00` every month even when private, because 100% of usage was discounted. **Do not quote $51/mo as a live cost.** The forward-looking claim is: *when the repo goes private, this keeps the bill at ~$51/mo instead of ~$967/mo.*

---

## 2. Scope & non-goals

### In scope
1. Collapse `strict-grep-mingla-business.yml` from 340 jobs → **5 jobs by dependency class** (§4).
2. `.github/scripts/strict-grep/MANIFEST.json` — the gate registry (§5).
3. `.github/scripts/strict-grep/run-batch.mjs` — the batch runner (§5.2).
4. `.github/scripts/strict-grep/meta-1383-manifest-parity.mjs` — the parity gate (§5.3).
5. The **differential proof** against run `29453557478` (§6) — a REQUIRED merge-blocking step.
6. `concurrency` + `cancel-in-progress` on **7 workflows**, with the `deploy-functions.yml` carve-out (§4.3).
7. `timeout-minutes` on the 5 batched jobs.
8. Record the 21 `unenforced` gates + the 7 `capable-unwired` self-tests in the manifest — **as data, not as fixes**.

### Explicit non-goals
| Not doing | Why |
|---|---|
| **Backfilling `--self-test` for the 168** | Separate scope, explicitly excluded by dispatch. This ORCH proves execution, not efficacy (§11). |
| **Wiring the 7 `capable-unwired` self-tests** | Would ADD assertions the baseline run doesn't have → breaks §6 set equality. Recorded in the manifest with a ratchet (§5.4) so a follow-up ORCH picks them up. |
| **Wiring the 21 `unenforced` gates** | Turning on 21 never-run gates would almost certainly go red and would conflate "cost fix" with "21 new bug reports". Recorded + frozen (§5.5). **Must be raised to the orchestrator as its own ORCH** (§10-D1). |
| **`paths:` filters on `tests-append-only.yml` / `web-build-check.yml`** | Research §6: both must stay unfiltered. Filtering `tests-append-only` arms the exact dark-gate mode we fear. |
| **`fetch-depth: 1`, dep caching, push/PR dedup** | Correction F — measured as $0, marginal, or a real safety net. |
| **`supabase-migrations-and-stripe-deno.yml` batching** | §8 — assessed and **deferred**. |
| **Touching any gate's assertion logic** | Hard guard. Batching changes HOW gates are invoked, never WHAT they assert. |
| **Any product code** | Hard guard. This is CI config + one runner + one manifest + one parity gate. |

### Assumptions
- Actions job records for run `29453557478` remain retrievable (GitHub retains ~90 days; run is from 2026-07-15). **§6 must be executed before that window closes** — creates a soft deadline, not a risk today.
- `origin/main` stays at or ahead of `60533968e`. If `main` moves before merge, §6.5 re-baselines.

---

## 3. Cross-Surface Impact Declaration

This ORCH touches **no product surface**. It changes CI configuration only. The table is included because it is a hard gate.

| # | Surface | Covered? | User-visible behavior | Files touched there | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | ❌ | None | none | n/a |
| 2 | Consumer Android (`app-mobile/`) | ❌ | None | none | n/a |
| 3 | Buyer/anon Web (`mingla-business/` public routes) | ❌ | None | none | n/a |
| 4 | Business iOS (`mingla-business/`) | ❌ | None | none | n/a |
| 5 | Business Android (`mingla-business/`) | ❌ | None | none | n/a |
| 6 | Admin Web (`mingla-admin/`, adjacent) | ❌ | None | none | n/a |
| 7 | Business Web preview (adjacent) | ❌ | None | none | n/a |

**Reason for universal non-coverage:** no runtime, bundle, migration, or asset is modified. The only consumers of this change are CI and the engineers reading its output.

**The one cross-surface risk is indirect and is the whole point of this spec:** every one of surfaces 1–7 is *protected* by these gates. A gate that goes dark removes protection from a product surface without any product diff. §6 is the control.

---

## 4. Layered specification — the batching design

Layers here are: workflow config, runner script, manifest data. No DB/edge/service/hook/component layer is touched.

### 4.1 The grouping — 5 jobs, and WHY this grouping

**The grouping axis is `setup cost`, not gate semantics.** The entire waste is duplicated setup, so the only rational partition is *"what does this gate need installed before it can run?"*. Gates that need the same setup share one setup. That is the whole idea.

Measured setup costs (research §2 step decomposition + local timing):

| Class | Job name | Members | Why separate | Setup | Work | Billed |
|---|---|---:|---|---|---:|---:|
| **A** | `static-gates` | **327 jobs** | Pure node + `checkout`. Need nothing installed. The overwhelming majority. | checkout+node ~17s | ~135s | **3 min** |
| **B** | `dep-gates` | **7 jobs** | Need `npm install --no-save` of a parser/analyzer. Installing these for all 327 would tax the majority for 7 gates. | +npm install ~15s | ~10s | **1 min** |
| **C** | `expo-export-gate` | **1 job** | Needs a **full `npx expo export -p web`** (~73s) and reads its stderr side-effect from a prior step. | +73s | ~5s | **2 min** |
| **D** | `jest-suites` | **2 jobs** | Need a real `npm ci` in `app-mobile` + jest. Heaviest install. | +npm ci ~40s | ~30s | **2 min** |
| **E** | `full-clone-gates` | **3 jobs** | Need `fetch-depth: 0` (full 685 MB history). Cannot share a checkout with A — A's shallow clone is the cheap one. | full clone ~60s | ~1s | **2 min** |
| | | **340** | | | **TOTAL** | **10 min** |

Wall clock = `max(3,1,2,2,2)` ≈ **3 min** — the 5 jobs run in parallel; **no job has `needs:`** (verified: 0 `needs:` in the workflow).

**Verified class membership** (these are the exact job keys; A is the complement):

```
B (7):  i37-topbar-default-cluster · i38-icon-chrome-touch-target · i39-pressable-label
        i-proposed-a-brands-deleted-filter · orch-0808-appsflyer-devices-app-discriminator   [@babel/parser+traverse]
        i-proposed-k-require-cycles                                                          [madge]
        orch-1058-collab-system-banner                                                       [typescript@~5.9.2]
C (1):  i-proposed-x-web-deprecation                                                         [npm install + npx expo export -p web]
D (2):  orch-1240-dual-account-deletion [test:orch-1240] · orch-1240-support-inbox-exclusion [test:orch-0901]
E (3):  regression-test-backfill-warning · orch-0863-marketing-hub-phase-b · orch-0948-waitlist-feature   [fetch-depth: 0]
A (327): all remaining jobs
```

**Why NOT arbitrary N-batching (4/8/16):** research §3 modeled it — strictly worse. Each extra batch re-pays checkout+setup-node (17.3s) *and* duplicates dep installs, for wall-clock gains that flatten at N≈4 (the suite is 67s of work; you cannot parallelize below runner boot). Dependency-class grouping is the minimum number of setups that covers all gates. **N=5 is not a tuning choice — it is the count of distinct setup requirements in the suite.**

**Why NOT 1 job:** research §3 shows 1 job = 4 billed min / ~4 min wall — marginally cheaper in billing but *slower* than 5×parallel (~3 min), and it would serialize a 73s expo export and a 40s npm ci behind 327 gates that need neither. 5 jobs is both faster and near-optimal on cost.

### 4.2 How classes B–E are batched — a hard constraint

**Classes B, C, D, E keep their existing per-job step sequences verbatim; only the *job container* is merged.** The runner is invoked once per class **after** that class's setup steps.

This is non-negotiable for **class C**: its gate reads `/tmp/expo-export-web.stderr`, a side-effect written by a *prior step* (`npx expo export -p web 2>/tmp/expo-export-web.stderr || true`). Routing it through a generic runner that reorders or re-shells the step would change what the gate observes — violating "batching changes HOW gates are invoked, never WHAT they assert". Class C's step order is preserved exactly; the runner runs its single gate last.

Likewise **class E** must retain `fetch-depth: 0` on its own `actions/checkout` — merging it into A would silently give 3 gates a shallow clone and change their observations.

### 4.3 `concurrency` — exact YAML

Insert at **top level** (sibling of `on:` / `jobs:`), in **exactly these 7 workflows**:

`strict-grep-mingla-business.yml` · `web-build-check.yml` · `tests-append-only.yml` · `docs-artifact-regression.yml` · `production-readiness-audit.yml` · `supabase-migrations-and-stripe-deno.yml` · `meta-orch-1337-social-proof-tests.yml` · `orch-1371-1372-tester-adversarial.yml`

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

**Why the expression, not `true`:** cancelling on a `push` to `main` abandons the post-merge verification run for that commit. Guarding on `pull_request` recovers the 22 PR-side supersessions (79% of the measured waste) while `main` runs always complete. Measured: **28 of 260 July strict-grep runs (10.8%) were superseded before finishing** (22 PR + 6 push).

#### 🚫 DO NOT add `concurrency` to `deploy-functions.yml`

`deploy-functions.yml` loops `supabase functions deploy` over every edge function on `push: main`. **Cancelling it mid-loop leaves the edge-function fleet half-deployed** — some functions new, some old, no signal, no alarm. Its 29 runs cost $0.80/half-month. **Leave it alone.** Same call for `rotate-apple-jwt.yml` (schedule) and `stripe-connect-smoke.yml` — not worth the risk at ~$0.01.

#### `timeout-minutes`

Add `timeout-minutes: 10` to each of the 5 batched jobs. Verified: **0 of 12 workflows set it** (only `rotate-apple-jwt.yml` has one, at 5). A hung gate currently bills GitHub's 6-hour default. Costs nothing; caps a tail risk with no present ceiling.

---

## 5. The manifest, the runner, and the parity gate

### 5.1 `MANIFEST.json` — the gate registry

Path: `.github/scripts/strict-grep/MANIFEST.json`. **Every `.mjs` under `.github/scripts/strict-grep/` (recursive, including `__tests__/`) has exactly one entry. No file may be unaccounted for.**

```jsonc
{
  "expectedTotalFiles": 384,          // asserted against disk, not typed by hand
  "selfTestWiredFloor": 169,          // ratchet — may only increase
  "gates": [
    {
      "script": "orch-1162-map-single-owner.mjs",
      "enforcement": "unenforced",     // batch:A|batch:B|batch:C|batch:D|batch:E | external:<workflow> | fixture | unenforced
      "invocation": "node",            // "node" | "node --test"   ← must match today's form exactly
      "selfTest": "none",              // "wired" | "capable-unwired" | "none"
      "jobKey": null,                  // originating workflow job key (audit trail back to pre-batch state)
      "reason": "ORCH-1162 — on disk, invoked only by a package.json script no CI workflow runs. Frozen by ORCH-1383; see SPEC §1.1-C."
    }
  ]
}
```

**Field contracts:**
- `enforcement` — the **three-state model Correction C forces**. The research's binary "in the manifest or not" cannot represent the 32 unaccounted files. `unenforced` makes a never-run gate a *visible, reviewed, named* choice instead of an accident. This is what converts 21 silent orphans into 21 tracked ones — and prevents #22.
- `external:<workflow>` — the **7 strict-grep gates that live in `supabase-migrations-and-stripe-deno.yml`** (`i-proposed-1270-no-empty-sent`, `i-proposed-1270-quiet-hours-defers-not-fails`, `i-proposed-1270-send-idempotent`, `i-proposed-1282-mms-ng-drops-media`, `orch-1331-partner-split-fail-soft`, `orch-1331-share-single-source`, `orch-1333-in-chunk-bounded`). A manifest scoped only to the strict-grep workflow would misclassify these 7 as orphans and invite someone to "clean them up".
- `invocation` — several gates run as `node --test X.test.mjs`, not `node X.mjs`. Recording the exact form is what keeps "HOW invoked" identical.
- `jobKey` — preserves the pre-batch job identity so §6 can map API job names back to gates, and so a failure can still name its origin.

**Generation (binding):** derive the manifest by parsing `.github/workflows/*.yml` with a **real YAML parser**, walking `jobs.*.steps[].run` scalars (full multi-line block scalars), stripping `#` comments, and matching node invocations. **Never a line-anchored grep** — Correction D proves grep fails in both directions. The §6 differential proof validates the derivation.

### 5.2 `run-batch.mjs` — the runner contract

Path: `.github/scripts/strict-grep/run-batch.mjs`. Invoked `node run-batch.mjs --class A`.

**Non-negotiable properties.** Each maps to a named failure mode this repo has already produced:

| # | Property | Guards against |
|---|---|---|
| R1 | **Iterates `MANIFEST.json`. NEVER a glob.** | House rule: "a glob silently picks up unrelated suites and silently DROPS a renamed suite." |
| R2 | **Never `break`s on first failure. Never runs under bare `set -e`.** Every gate in the class runs; failures accumulate. | The classic batching regression — gate 200 fails, gates 201–327 never run and nobody notices. |
| R3 | **A missing script file is a FAIL (`exit 2`, status `MISSING`), never a skip.** Runner continues to the next gate. | "Runner exits 0 when a gate file is missing" — named in the dispatch. |
| R4 | **Counts executed gates and asserts `executed.length === expected.length`.** A shortfall is a **failure in its own right**, independent of every gate's verdict. | The core dark-gate assertion. Green-but-incomplete must be impossible. |
| R5 | **Invokes each gate using its manifest `invocation` form**, and runs `--self-test` first for `selfTest: "wired"` — preserving today's exact sequence. | Changing WHAT is asserted. |
| R6 | **Prints one line per gate: `<script> [mode] → exit N` (+ captured stdout/stderr on failure, prefixed with the gate name).** | "A failure must still name the exact gate, or debugging dies." |
| R7 | **Writes `gate-results.json`** (`[{script, jobKey, mode, exit, durationMs, status}]`) and uploads it as a workflow artifact. | Makes §6 mechanical, and every future run auditable. |
| R8 | **Exit 0 IFF: every gate exit 0 AND `executed === expected` AND zero `MISSING`.** Otherwise non-zero. | Ties R2–R4 to the merge gate. |
| R9 | **Exit code passthrough:** a gate's `2` (fs error) is never collapsed into `1` or `0`. | Preserves the uniform `0/1/2` contract the batching relies on. |

### 5.3 `meta-1383-manifest-parity.mjs` — the parity gate

Path: `.github/scripts/strict-grep/meta-1383-manifest-parity.mjs`. Registered as a normal class-A gate (so the runner executes it and R4 counts it).

**Assertions — each FAILS the PR:**

| # | Assertion | Catches |
|---|---|---|
| P1 | Every `.mjs` on disk (recursive) appears **exactly once** in `gates[]`. | **Add a gate, forget the manifest.** ← the dispatch's required attack |
| P2 | Every `gates[]` entry's `script` exists on disk. | Delete a gate, leave a stale manifest row. |
| P3 | `gates.length === expectedTotalFiles` **and** `expectedTotalFiles === (actual files on disk)`. | Bulk drift; a hand-edited count. |
| P4 | Every `enforcement: "external:<wf>"` gate is **actually invoked** in `<wf>` (YAML-parsed). | The supabase 7 being silently dropped from their workflow. |
| P5 | Every `enforcement: "batch:X"` gate is invoked by `run-batch.mjs --class X` (cross-check vs the runner's expected set). | Manifest says batched, runner never runs it. |
| P6 | `selfTest` field matches source reality: if the source contains `--self-test`, the field MUST be `wired` or `capable-unwired`, never `none`. | A gate quietly losing its self-test wiring. |
| P7 | **Ratchet:** `count(selfTest === "wired") >= selfTestWiredFloor` (169). | Self-test coverage regressing — research §8.2 item 5. |
| P8 | **Ratchet:** `count(enforcement === "unenforced") <= 21`. | Dark-gate count growing. Only ever shrinks. |

### 5.3.1 What stops the PARITY GATE itself from being decorative

The dispatch asks this directly, and it is the sharpest question in the brief — a parity gate that can't fail is just a more expensive dark gate. Four independent defenses, because any single one is defeatable:

1. **It must `--self-test`, with fixtures that make each failure mode fire.** `meta-1383-manifest-parity.mjs --self-test` must prove: (a) a manifest missing an on-disk file → exit 1; (b) a manifest row with no file → exit 1; (c) a floor violation → exit 1; (d) **a vacuous run (zero files discovered) → exit 1, never exit 0**. (d) is the specific "passed because it matched nothing" mode — the `rel="noopener"` failure class. It joins the 169 `wired` gates and raises the floor to 170.
2. **The runner's R4 covers it.** The parity gate is a manifest entry, so `executed === expected` proves it ran. **The circularity is real and must be closed:** removing the parity gate from *both* the manifest and the runner would keep R4 satisfied. Closed by defense 3.
3. **Append-only ratchet on `MANIFEST.json`, reusing the repo's proven `tests-append-only.yml` token pattern.** Shrinking `gates[]`, lowering `selfTestWiredFloor`, or raising the `unenforced` cap requires an explicit commit-message token (`GATE-REMOVAL: <reason>`). **You cannot quietly shrink the registry** — and the ratchet is enforced by `tests-append-only.yml`, a *different* workflow, so disabling the parity gate does not disable its own guard.
4. **§6's differential proof is an external anchor.** It compares against **GitHub's recorded API result set** — data that lives outside the repo and cannot be edited by any commit. No in-repo change can fake it.

Defenses 3 and 4 are the load-bearing ones: 3 makes shrinkage *visible*, 4 makes the initial claim *externally verified*.

### 5.4 The 7 `capable-unwired` self-tests — recorded, deferred

These 7 gates support `--self-test` in source but CI never calls it (a free win the research flagged):

```
i-consumer-calendar-uses-end-not-start.mjs · i-event-lifecycle-single-helper.mjs
i-proposed-y-platform-web-url-from-env.mjs · orch-0863-marketing-hub-phase-b.mjs
orch-0913-no-tabs-on-dashboards.mjs · orch-1055-nav-tab-rank-gate.mjs · orch-1325-ci-typescript-pinned.mjs
```

**Do NOT wire them in this ORCH.** Wiring adds 7 assertions the baseline run does not have → §6 set equality breaks → the proof gets muddied by additions at the exact moment it must be clean. They are recorded as `selfTest: "capable-unwired"`; P7's ratchet means a follow-up ORCH can only move them *up* to `wired`.

### 5.5 The 21 `unenforced` gates — recorded, frozen, escalated

Recorded with `enforcement: "unenforced"` + a `reason`. **Not wired here** (§2 non-goals). P8 caps the count at 21 — it can only shrink. Escalated to the orchestrator as its own ORCH (§10-D1).

---

## 6. 🔴 THE DIFFERENTIAL PROOF — a REQUIRED, merge-blocking build step

**This is not a verification nicety. It is a build step. The PR does not merge without a passing proof artifact committed to the branch.**

### 6.1 The baseline

| Field | Value |
|---|---|
| Run ID | **`29453557478`** |
| Workflow | Strict Grep Gates (Mingla Business) (`271914022`) |
| Event / branch | `push` / `main` |
| `head_sha` | **`60533968e513be47b93f89c8c84d0d7f1927d9b1`** |
| Jobs | **340** |
| Conclusions | **340 success, 0 other** |

**Not `29444719767`** (Web Build Check, 1 job — Correction A). **Not `29444719754`** (338 jobs, 2 stale, PR-merge-ref SHA). `29453557478` is the newest all-green run, has the full 340-job set, and its SHA **is the current `origin/main` tip this branch is rebased onto** — so the batch runs against the identical tree with zero drift to explain.

### 6.2 Procedure

```bash
# 1. Capture ground truth from GitHub (external, unfakeable)
gh api "repos/Mingla-LLC/mingla-main/actions/runs/29453557478/jobs?per_page=100" --paginate \
  -q '.jobs[] | [.name, .conclusion] | @tsv' > baseline-jobs.tsv     # expect exactly 340 rows

# 2. Map job name → gate script(s), via the workflow file AT THE BASELINE SHA
git show 60533968e:.github/workflows/strict-grep-mingla-business.yml > baseline-workflow.yml
#    YAML-parse it: job.name → job key → run: scalars → node invocations   (NEVER grep — Correction D)
#    → OLD = { script → verdict }

# 3. Run the batched runner against the SAME tree
git checkout 60533968e -- . && for c in A B C D E; do node .github/scripts/strict-grep/run-batch.mjs --class $c; done
#    → merge the 5 gate-results.json → NEW = { script → verdict }

# 4. Assert
```

### 6.3 The assertions

| # | Assertion | On violation |
|---|---|---|
| **D1** | `OLD ⊆ NEW` — **every gate that ran before, runs after.** | 🔴 **BLOCK THE MERGE.** Any gate present before and absent after is a dark gate. This is the whole point. |
| **D2** | `NEW − OLD === ∅` — no unexpected additions. | BLOCK unless each addition is listed in the PR body with justification. **For this ORCH the expected additions are exactly 1** (`meta-1383-manifest-parity.mjs`) — declare it. |
| **D3** | **Verdict equality** on `OLD ∩ NEW`: every gate's exit code matches. | BLOCK. |
| **D4** | `NEW.length === 345 + 1` (345 strict-grep gates + the parity gate). | BLOCK — coverage shortfall. |
| **D5** | Baseline row count is **exactly 340** and all `success`. | If not, the baseline moved → re-baseline per §6.5. **Never proceed on a partial baseline.** |

**A simplification worth naming:** because the baseline is **340/340 green**, every gate's baseline verdict is "pass". So D3 is satisfied automatically if the batch is green — which means **D1/D4 (the executed SET) carry the entire proof.** This is exactly why "the batch went green" is *not* evidence of anything on its own: a batch that runs 200 of 345 gates is also green. **Green + set equality is the claim; green alone is worthless.**

### 6.4 The artifact

Commit `Mingla_Artifacts/reports/ORCH-1383_DIFFERENTIAL_PROOF.md` to the branch, containing: the baseline run ID + SHA, the 340-row baseline, the NEW set, the D1–D5 results, and the verbatim set-difference output (empty for D2 modulo the declared parity gate). **No proof artifact → no merge.**

### 6.5 If `main` moves before merge

Re-baseline: pick the newest all-green strict-grep run on `main`, re-derive OLD at its SHA, re-run. **Do NOT** diff against a stale baseline and hand-wave the delta — the 2-job drift that broke the research (Correction B) is exactly how that goes wrong.

---

## 7. Success criteria

Observable, testable, unambiguous. No per-surface split needed (§3: no product surface).

| ID | Criterion |
|---|---|
| **SC-1** | `strict-grep-mingla-business.yml` defines **exactly 5 jobs**; a run reports 5 jobs, not 340. |
| **SC-2** | Billed minutes per strict-grep run ≤ **12** (target 10; today ~345). Measured via per-job `ceil(seconds/60)`. |
| **SC-3** | Wall clock for a full strict-grep run ≤ **5 min** (target ~3; today 6.4–11.8). |
| **SC-4** | **§6 differential proof passes D1–D5**, artifact committed. `OLD ⊆ NEW` with zero missing gates. |
| **SC-5** | `MANIFEST.json` accounts for **all 384** on-disk `.mjs` files, each with exactly one `enforcement` state. |
| **SC-6** | Parity gate P1–P8 all fire correctly under `--self-test`, **including the vacuous-run case (P-vacuous → exit 1)**. |
| **SC-7** | Deleting any gate file → the run **FAILS** (R3), and the log names the missing script. |
| **SC-8** | Adding a gate `.mjs` without a manifest entry → parity gate **FAILS** (P1). |
| **SC-9** | A gate failing mid-class does **not** prevent later gates in that class from running (R2); `gate-results.json` shows all 327 class-A entries even when gate #1 fails. |
| **SC-10** | Every gate failure message in the log names the **exact gate script** (R6). |
| **SC-11** | `concurrency` present on **exactly the 7 workflows** in §4.3, with the `pull_request` expression form. |
| **SC-12** | `deploy-functions.yml` has **NO** `concurrency` block. |
| **SC-13** | All 5 batched jobs carry `timeout-minutes: 10`. |
| **SC-14** | Class C's expo-export step ordering and stderr side-effect path are byte-identical to today. |
| **SC-15** | Class E retains `fetch-depth: 0`; classes A–D do not. |
| **SC-16** | **No gate script's assertion logic is modified.** `git diff 60533968e -- .github/scripts/strict-grep/*.mjs` shows only additions (`run-batch.mjs`, `meta-1383-manifest-parity.mjs`, `MANIFEST.json`) — **zero modifications to existing gates**. |

---

## 8. `supabase-migrations-and-stripe-deno.yml` — assessed, DEFERRED

**Assessment (dispatch required this):** 15–17 jobs, 884 billed min/half-month, **1.1% of spend**, $5.30. Same anti-pattern (per-job `checkout` + `setup-deno`, no `needs:`, no matrix). Batching → ~9.4 → ~4 billed min/run ≈ $7/month saved.

**Verdict: DEFER to a follow-up ORCH.** Justifying on speed as the dispatch requires: its wall clock is already ~2–3 min — **it is not a PR-feedback bottleneck**, so the speed argument that carries strict-grep does not carry here. And at 1.1% of spend the cost argument is absent (and is $0 today anyway). It **does** get `concurrency` (§4.3) — that is free and shares the risk profile.

**One coupling the implementor must respect:** it invokes **7 strict-grep gates** (§5.1). They MUST be in the manifest as `external:supabase-migrations-and-stripe-deno.yml`, and P4 asserts they remain invoked there. Batching that workflow later must not orphan them.

---

## 9. Invariants

### Preserved
| ID | How preserved | Verified by |
|---|---|---|
| **All 345 gate invariants** | Batching changes only the job container. §5.2-R5 preserves invocation form; SC-16 proves zero gate-logic diffs. | §6 D1/D3/D4; SC-16 |
| **I-COMMS-LEDGER-ENTRY-STANZA** / **I-RESPONSE-2-SECTION-SHAPE** | Enforced by `meta-orch-0954-comms-ledger-stanza.mjs`, a class-A gate. Unchanged. | §6 D1 |
| **Test append-only token** | `tests-append-only.yml` stays **unfiltered** (§2) — it gets `concurrency`, never a `paths:` filter. §5.3.1-3 additionally *extends* it to guard `MANIFEST.json`. | T-11; SC-11 |
| **DEC-101 D-17b-5 registry pattern** | "one script + one workflow job" becomes "one script + one manifest entry". The registry survives; its *enforcement* becomes machine-checked rather than a hand-maintained README table that has already drifted to ~30 of 345 rows. | P1–P3 |

### Proposed (DRAFT — orchestrator flips ACTIVE on CLOSE)
| ID | Statement |
|---|---|
| **I-PROPOSED-1383-GATE-MANIFEST-TOTALITY** | Every `.mjs` under `.github/scripts/strict-grep/` has exactly one `MANIFEST.json` entry with an explicit `enforcement` state. A gate file may never exist unaccounted-for. |
| **I-PROPOSED-1383-EXECUTION-COVERAGE** | The batch runner asserts `executed === manifest-expected` for its class. A coverage shortfall fails the run regardless of gate verdicts. A green run that skipped a gate is impossible by construction. |
| **I-PROPOSED-1383-NO-SILENT-SHRINK** | `MANIFEST.json` `gates[]`, `selfTestWiredFloor`, and the `unenforced` cap are append-only/ratcheted; shrinking requires an explicit `GATE-REMOVAL:` commit token enforced by `tests-append-only.yml`. |

**Note for the registry:** `I-PROPOSED-L` is recorded in the strict-grep README as "process invariant — no script". `I-PROPOSED-1383-NO-SILENT-SHRINK` is its opposite in spirit: a process rule given machine teeth.

---

## 10. Test cases

Handed to `mingla-tester`. **The dispatch's three required attacks are T-1, T-2, T-3.**

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-1** ⭐ | **Delete a gate file → does the run FAIL?** | `rm .github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs`; run class A | **FAIL.** R3: `MISSING`, exit 2. Log names the script. **Never a skip, never green.** | runner |
| **T-2** ⭐ | **Make a gate exit 0 wrongly → is it caught?** | Replace a gate body with `process.exit(0)` | **Runner: PASSES — and that is the correct, honest answer.** The runner proves execution, not efficacy. Caught **only** if that gate is one of the 169 `wired` (its `--self-test` fires). **If it is one of the 168, NOTHING catches it — before or after this ORCH.** Tester must record which class the chosen gate is in. This is §11, made concrete. | runner / **scope boundary** |
| **T-3** ⭐ | **Add a gate without a manifest entry → does parity FAIL?** | `cp` any gate to `zz-new-gate.mjs`, no manifest edit; run class A | **FAIL.** P1: "on disk, absent from manifest". | parity |
| T-4 | Remove a manifest entry, leave the file | delete a `gates[]` row | **FAIL.** P1 (unaccounted file) **and** P3 (count mismatch). | parity |
| T-5 | Manifest row with no file | add a `gates[]` row for `ghost.mjs` | **FAIL.** P2. | parity |
| T-6 | **Vacuous parity gate** | point the parity gate at an empty dir | **FAIL, not pass.** The "matched nothing → green" mode. | parity self-test |
| T-7 | **Runner breaks early** | make class-A gate #1 exit 1 | All **327** run; `gate-results.json` has 327 rows; run FAILS. R2. | runner |
| T-8 | **Coverage shortfall with all-green gates** | manifest lists 327, runner is rigged to run 300, all exit 0 | **FAIL.** R4 — `executed !== expected`. **Green-but-incomplete must be impossible.** The single most important test in this table. | runner |
| T-9 | Lower `selfTestWiredFloor` to 100 | edit manifest | **FAIL.** P7 ratchet. | parity |
| T-10 | Add a 22nd `unenforced` gate | edit manifest | **FAIL.** P8 ratchet. | parity |
| T-11 | Shrink `gates[]` without the token | delete a row, ordinary commit message | **FAIL.** `tests-append-only.yml` (§5.3.1-3). | append-only |
| T-12 | Un-wire a self-test | `wired` → `none` on a gate whose source has `--self-test` | **FAIL.** P6 + P7. | parity |
| T-13 | Drop one of the supabase 7 | remove `orch-1331-share-single-source` from that workflow | **FAIL.** P4. | parity |
| T-14 | **Differential proof, honest run** | full §6 | D1–D5 pass; `NEW − OLD` = exactly `{meta-1383-manifest-parity.mjs}` | proof |
| T-15 | **Differential proof catches a real dark gate** | drop 5 random gates from the manifest, re-run §6 | **D1 FAILS**, naming all 5. Proves the proof itself isn't decorative. | proof |
| T-16 | Exit-code 2 passthrough | gate exits 2 (fs error) | Recorded as 2, not collapsed to 1/0. R9. | runner |
| T-17 | `cancel-in-progress` on PR | push twice to a PR in quick succession | Run 1 cancelled, run 2 completes. | workflow |
| T-18 | `cancel-in-progress` NOT on main push | two quick pushes to `main` | **Both complete.** Expression form. | workflow |
| T-19 | `deploy-functions.yml` carve-out | inspect | **No `concurrency` block.** | workflow |
| T-20 | Class C side-effect | run class C | `/tmp/expo-export-web.stderr` written by the prior step; gate reads it; verdict matches baseline. SC-14. | workflow |
| T-21 | Class E clone depth | run class E | `fetch-depth: 0` in effect; the 3 gates see full history. | workflow |
| T-22 | Gate identity on failure | force 3 class-A gates to fail | Log names all 3 exactly; a human can act without opening `gate-results.json`. R6. | runner |

---

## 11. 🔴 Execution, not efficacy — the statement that must not be lost

**Required by the dispatch. This must survive into the CLOSE note and the PR body.**

> **ORCH-1383 proves that the same gate scripts still RUN and still produce the same verdicts. It does NOT prove those verdicts mean anything.**
>
> **168 of 345 gates (48.7%) have no `--self-test`.** They can be proven to execute and to exit 0. **Nothing proves that exit 0 means anything.** They have never been shown to fail on the defect they exist to catch.
>
> **All five of the historical dark-gate failures live in that 48.7%** — the single-line regex vs multi-line code; the two gates green while a live production bug shipped; the five token-presence test files; the `rel="noopener"` check that passed off an unrelated socials row.
>
> **A sixth class was found by this spec: 21 gates that never run at all** (§1.1-C) — including `orch-1369-release-submit-config.adversarial.mjs`, dark **one day after ORCH-1369 closed**.
>
> **Batching does not create this risk. The risk is fully realized today.** But batching is the moment it either gets instrumented or gets permanently buried under a 34× cost win.
>
> **The honest status of this suite, after this ORCH ships: 345 gates run, 177 are proven able to fail, 168 are decorative until demonstrated otherwise, and 21 more are on disk running nowhere.** The cost win is real. It is not evidence of health. **Do not let "CI is 34× cheaper and green" be read as "the suite is good."**

Backfilling the 168 is **separate scope** (dispatch). It is the real work, and it is not optional — routed in §14.

---

## 12. Implementation order

Sequenced so the safety net exists **before** the thing it protects against.

| # | Step | Files | Gate |
|---|---|---|---|
| **0** | **Baseline capture.** Pull the 340-job result set for `29453557478`; commit `baseline-jobs.tsv`. | `Mingla_Artifacts/reports/` | 340 rows, all `success`, else STOP (D5) |
| **1** | **Generate `MANIFEST.json`** via YAML parse (never grep). All 384 files, one `enforcement` each. | `MANIFEST.json` | 384 accounted |
| **2** | **Build `meta-1383-manifest-parity.mjs`** + its `--self-test` fixtures incl. the vacuous case. | parity gate | P1–P8 + T-6 |
| **3** | **Build `run-batch.mjs`** to the R1–R9 contract. | runner | T-7, T-8, T-16 |
| **4** | **Prove the runner in isolation** — run all 5 classes on the CURRENT 340-job workflow, unchanged. | — | `executed === 345`, all green |
| **5** | 🔴 **DIFFERENTIAL PROOF (§6).** D1–D5. | `ORCH-1383_DIFFERENTIAL_PROOF.md` | **STOP on any failure. Do not proceed to step 6.** |
| **6** | **Rewrite the workflow** → 5 jobs + `timeout-minutes: 10`. Classes B–E keep their step sequences verbatim (§4.2). | `strict-grep-mingla-business.yml` | SC-1, SC-14, SC-15 |
| **7** | **Re-run §6 against the batched workflow.** | proof artifact | D1–D5 again |
| **8** | **`concurrency`** on the 7 workflows. **NOT `deploy-functions.yml`.** | 7 `.yml` | SC-11, SC-12 |
| **9** | **Extend `tests-append-only.yml`** to ratchet `MANIFEST.json`. | `tests-append-only.yml` | T-11 |
| **10** | Fails-on-revert proof (§13). | — | §13 |

**Step 5 is a hard stop.** The proof gates the batch; the batch does not gate the proof.

---

## 13. Regression prevention — fails-on-revert contract

**Structural safeguard:** the manifest + parity gate + `executed === expected` assertion, anchored by an external differential proof.

| Fix | Regression test | Must FAIL when reverted |
|---|---|---|
| Runner never breaks early (R2) | T-7 | Reintroduce `break` on failure → T-7 FAILS (only 1 of 327 rows) |
| Missing file = FAIL (R3) | T-1 | Change `MISSING` → `continue`/skip → T-1 goes green → **test FAILS** |
| `executed === expected` (R4) | **T-8** | Delete the assertion → a 300-of-327 green run passes → **T-8 FAILS** |
| Manifest totality (P1) | T-3 | Weaken P1 to a warning → T-3 goes green → **test FAILS** |
| Parity non-vacuity | T-6 | Make the gate return 0 on an empty set → T-6 FAILS |
| Ratchets (P7/P8) | T-9, T-10 | Remove the floor check → T-9 goes green → **FAILS** |
| Append-only (§5.3.1-3) | T-11 | Drop the token check → T-11 goes green → **FAILS** |

**Protective comment (required at the top of `run-batch.mjs`, verbatim intent):**

```
// ORCH-1383. This runner replaced 340 one-gate CI jobs with 5 batched jobs.
// The ONLY thing that makes that safe is: executed === manifest-expected.
//
// DO NOT add `break` on failure. DO NOT run under bare `set -e`. DO NOT treat a
// missing gate file as a skip. DO NOT replace the manifest with a glob.
// Each of those silently converts a gate into a no-op, and a green run into a lie.
//
// This repo has produced SIX classes of dark gate, incl. 21 gates on disk that CI
// never ran (one of them dark one day after its ORCH closed). Assume this WILL
// happen again and that this assertion is the only thing standing in the way.
//
// This proves EXECUTION, not EFFICACY. 168 of 345 gates have no --self-test and
// cannot be shown to fail on their own defect. Green here != the suite is healthy.
```

---

## 14. Open questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| **Q1** | **The 21 `unenforced` gates — wire, delete, or freeze?** This spec freezes + records them. Wiring 21 never-run gates will likely go red and is a different ORCH. Deleting them discards real invariant work. | Seth / orchestrator | **No** — frozen is safe. Needs a decision soon; they protect nothing today. |
| **Q2** | **When does the 168-gate self-test backfill get scheduled?** Explicitly out of scope here. Until it lands, ~half the suite is unproven. | orchestrator | No |
| **Q3** | `29453557478` job records expire ~2026-10-13 (90d). §6 must run before then. | implementor | No — months of headroom |
| **Q4** | Should `MANIFEST.json` become the source the workflow is *generated from* (rather than hand-edited alongside)? Would eliminate manifest/workflow drift permanently, but is a bigger change. | orchestrator | No — post-1383 |

---

## 15. Scoped allowlist + DO-NOT-TOUCH

### ✅ Allowlist — the implementor MAY change only these

```
.github/workflows/strict-grep-mingla-business.yml          # 340 jobs → 5 + concurrency + timeout-minutes
.github/workflows/web-build-check.yml                      # concurrency ONLY
.github/workflows/tests-append-only.yml                    # concurrency + MANIFEST.json ratchet
.github/workflows/docs-artifact-regression.yml             # concurrency ONLY
.github/workflows/production-readiness-audit.yml           # concurrency ONLY
.github/workflows/supabase-migrations-and-stripe-deno.yml  # concurrency ONLY (NO batching — §8)
.github/workflows/meta-orch-1337-social-proof-tests.yml    # concurrency ONLY
.github/workflows/orch-1371-1372-tester-adversarial.yml    # concurrency ONLY

.github/scripts/strict-grep/MANIFEST.json                  # NEW
.github/scripts/strict-grep/run-batch.mjs                  # NEW
.github/scripts/strict-grep/meta-1383-manifest-parity.mjs  # NEW
.github/scripts/strict-grep/__tests__/meta-1383-*.mjs      # NEW — parity fixtures
.github/scripts/strict-grep/README.md                      # document manifest + 4-step add-a-gate flow

Mingla_Artifacts/reports/ORCH-1383_DIFFERENTIAL_PROOF.md   # NEW — required artifact
Mingla_Artifacts/specs/SPEC_ORCH-1383_*.md                 # amendments only
```

### 🚫 DO NOT TOUCH

| Path | Why |
|---|---|
| **Any existing `.github/scripts/strict-grep/*.mjs`** | **THE hard guard.** Batching changes HOW gates are invoked, never WHAT they assert. SC-16: zero modifications. Adding files is fine; editing one is a stop-and-amend. |
| **`.github/workflows/deploy-functions.yml`** | **NO `concurrency`.** Cancelling mid-loop half-deploys the edge-function fleet. §4.3. |
| `.github/workflows/rotate-apple-jwt.yml`, `stripe-connect-smoke.yml`, `load-smoke.yml` | Not worth the risk at ~$0.01. |
| **`paths:` filters on `tests-append-only.yml` / `web-build-check.yml`** | Must stay unfiltered. Filtering `tests-append-only` arms the exact dark-gate mode. Research §6. |
| **Any product code** (`app-mobile/`, `mingla-business/`, `mingla-admin/`, `supabase/`, `packages/`) | Out of scope entirely. |
| `package.json` test scripts | The 21 `unenforced` gates are invoked from these. Rewiring them is Q1, not this ORCH. |
| `COMMS_LEDGER.md` on the anchor | Anchor is DIRTY with another session's edit. **Never stage it.** |
| `WORLD_MAP.md`, `DECISION_LOG.md`, `INVARIANT_REGISTRY.md`, `MASTER_BUG_LIST.md` | Read-only for the implementor; orchestrator owns them at CLOSE. |

**Stop-and-amend:** anything outside the allowlist requires a SPEC amendment before the edit. Never widen silently.

---

## 16. Downstream routing

1. **NEXT → `mingla-implementor`.** Worktree `~/Desktop/mingla-orchs/ORCH-1383-[ci-strict-grep-consolidation]`, branch `ORCH-1383-ci-strict-grep-consolidation`. Build §12 steps 0–10 in order. **Step 5 (§6 differential proof) is a hard stop — no batching merges without a committed passing proof.**
2. **THEN → `mingla-tester`.** Run §10 T-1…T-22. **T-1, T-2, T-3 are the dispatch's required attacks; T-8 and T-15 are the ones that decide whether this is safe.** T-2's expected result is "the runner passes" — verify the tester understands that is the *honest* answer and records the gate's self-test class (§11).
3. **THEN → `mingla-orchestrator` CLOSE.** Flip the three `I-PROPOSED-1383-*` invariants ACTIVE. Register discoveries D1–D3 below. **Carry §11 verbatim into the CLOSE note and PR body.** One PR, `gh pr merge --squash --admin`.

### Discoveries for the orchestrator

| # | Discovery | Suggested action |
|---|---|---|
| **D1** | 🔴 **21 real gate scripts are on disk, carry exit contracts, and no CI workflow runs them** — incl. `orch-1369-release-submit-config.adversarial.mjs`, dark **one day after ORCH-1369 closed**. The DEC-101 registry pattern has already failed 21 times silently. | **New ORCH.** Triage all 21: wire, or delete with a reason. This is Q1 and it is real, current bug-shaped debt. |
| **D2** | 🔴 **The research's differential-proof run ID `29444719767` is Web Build Check, not strict-grep** (Correction A). It propagated into the dispatch framing as "the clincher". | Correct any artifact quoting it. Canonical baseline: **`29453557478`**. |
| **D3** | ⚠️ **The strict-grep `README.md` "Active gates registered" table lists ~30 of 345 gates.** A hand-maintained registry that drifted by >90%. It is the cautionary tale for why §5's manifest must be machine-checked. | Update the README to point at `MANIFEST.json` as the single source of truth (in this ORCH's allowlist). |
| **D4** | ⚠️ **`orch-0839-b-mingla-business-no-native-stripe.mjs` is referenced in 4 comments; the file does not exist.** Harmless, but it is how Correction D's phantom-gate trap manifests. | Housekeeping; fold into D1's triage. |
| **D5** | ⚠️ **Research §7's "free wins" were adopted into the dispatch framing despite the research declining 3 of 4** (Correction F). | Note for future dispatches: `fetch-depth: 1` is already the default; push/PR dedup was declined as a real safety net. |
