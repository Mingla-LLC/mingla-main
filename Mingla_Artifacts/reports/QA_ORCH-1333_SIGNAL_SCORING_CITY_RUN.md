# QA — ORCH-1333 [signal-scoring-city-run]: bounded, incremental, resumable whole-city scoring

- **Phase:** TEST (independent pre-deploy verification). Adversarial; assume-broken posture.
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1331-[signal-scoring-city-run]/` (dir cosmetically says 1331) on branch `ORCH-1333-signal-scoring-city-run`.
- **Verified at:** implementor HEAD `57fef2d3e`; tester adversarial commit `9a779b81e` (this branch HEAD after adding the tester guard).
- **Inputs:** SPEC_ORCH-1333, IMPLEMENTATION_ORCH-1333, INVESTIGATION_ORCH-1333.

---

## 1. VERDICT — CONDITIONAL PASS  (P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 1)

**CONDITIONAL PASS.** Backend cursor-loop logic is PROVEN at the engine level (behavioral fake-store tests + my independent fails-on-revert + a reproduced Step-0.5 of the implementor's proof). Admin-web client loop + counter-refresh are source-verified and `vite build`-green. No code defect blocks; the single P3 is inert (no functional impact).

**Accepted condition (documented in the dispatch's hard constraint):** the mandatory **live-fire on prod-admin is DEFERRED POST-DEPLOY** — the fixed `run-signal-scorer` is NOT deployed (prod is still `version 270`, the pre-1333 code). The following are **PENDING POST-DEPLOY**, not runtime-verified here:
- SC-1 backfill: NY `place_scores` distinct-scored climbing **35 → ~9,903** across batches.
- SC-2 mid-run partial-persist observed on prod (kill/observe).
- SC-3 an admin-pinned NY place keeps its score through a city run.
- SC-6/SC-7 one-click loop-to-done on the real admin button.
- SC-8 the "Scored" counter refreshing on-screen without a manual Refresh.

Per the tester confidence ladder, admin-web is a UI/runtime surface whose authed runtime is unreachable without the deploy + an admin JWT; those SCs are capped at **source-verified / build-green**, runtime **PENDING**. The **backend** portion qualifies for the edge-function/CI source-sufficiency exemption and is graded on proven behavioral logic. This routes to the orchestrator's gated deploy + post-deploy live-fire, **not** to REWORK.

---

## 2. SC-by-SC matrix

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 | City persists incrementally; `next_cursor`+`done:false`; loop→`done:true` writes all | **PASS (logic) / live-fire PENDING** | Guard T-A (1200 rows, all written once, done, remaining) + my TC-2 (real maxRows==pageSize==500 loop, 1000 rows, exactly-divisible, terminates in 3 calls, every id once). Engine L141-275. NY 35→9,903 = post-deploy. |
| SC-2 | No abort-all: page-N failure keeps pages 1..N-1 + resumable cursor | **PASS (logic)** | Guard T-B + adversarial T-B/T-B2 + my **TC-1** (interrupted@page3 → store holds 1000, resumes to exact golden end-state, zero double-writes). Engine L199-239. Fails-on-revert proven (§5). |
| SC-3 | Admin-pinned rows not clobbered/veto-deleted, per page; `sticky_skipped` counts | **PASS (logic)** | Guard T-C (page-1 pin) + my **TC-3 (pin on the LAST short page)**. Per-page filter L197-222; `isAdminOverridden` stays in index.ts L200; re-pinned orch_1066 T-01..T-06 (13 green). Prod pin = post-deploy. |
| SC-4 | Per-place one-call, `done:true`, writes `ai_signal_scores_at`, no abort-all | **PASS w/ P3 caveat** | index.ts `maxRows: isPerPlace?1000:500` L267; `.in('id',placeIds)` L172; re-pinned per_place T-01..T-07 green. **P3-1:** exactly-1000 place_ids returns `done:false` (inert — no per-place caller loops; all 1000 still written). |
| SC-5 | Response shape preserved + additive `next_cursor`/`done`/`remaining`; `verify_jwt:true` | **PASS** | Old success `{success,...summary,written,veto_deleted,sticky_skipped,duration_ms}` (origin/main) ⊂ new success (L310-323) + additive keys only; no key removed/renamed. `config.toml` empty diff; deployed fn `verify_jwt:true` (read-only MCP). |
| SC-6-Web | RunScorerButton loops to done in one click w/ progress | **source-verified / build-green / runtime PENDING** | `runScorerToCompletion` + rewired `RunScorerButton` (JSX L177-240, 507-560); toast reports accumulated across N batches; errors → toast. Admin `vite build` exit 0. On-screen firing = post-deploy. |
| SC-7-Web | Score ALL loops every signal to full completion | **source-verified / build-green / runtime PENDING** | `ScoreAllSignalsButton` per-signal loop calls `runScorerToCompletion`; per-signal error capture preserved (JSX L768-820). |
| SC-8-Web | Defect A: `CityPipelineHistory` "Scored" refetches on completion | **source-verified / build-green / runtime PENDING** | `refreshSignal` prop + `useEffect([refresh, refreshSignal])` (L617/641); render passes `refreshSignal={previewKey}` (L1159); all scorer/Bouncer `onComplete` bump `previewKey` (L1216/1230/1270). |
| SC-9 | Guard fails on revert to accumulate/abort-all + runs in CI | **PASS** | New CI job `orch-1333-signal-scorer-deno-tests` runs the 2 implementor guards + (added by tester) my file. Fails-on-revert reproduced (§5). |

---

## 3. Findings (severity-ranked)

### P3-1 — Per-place mode with EXACTLY 1000 `place_ids` returns `done:false` (spec says `done:true`). Inert.
- **Evidence:** `run-signal-scorer/index.ts:267` sets `maxRows = isPerPlace ? 1000 : 500`; `pageSize = BATCH_SIZE = 500`. In `signalScorerBatch.ts` the `while (processed < maxRows)` loop processes 2 full 500-pages for a 1000-id set; after page 2, `rows.length (500) < pageSize (500)` is false so `reachedEnd` stays `false`, then `processed(1000) < maxRows(1000)` is false so the loop exits with `reachedEnd=false` → `done:false`, `next_cursor = <last id>`. SC-4 states per-place returns `done:true`.
- **Impact:** **NONE functionally.** All 1000 ids are scored and UPSERTed in that one call. The only per-place callers (the 15-min rescore cron, `admin-review-venue-claim` approval loop) call once and read `scored_count`; neither loops on `next_cursor`. So the mislabeled `done:false` is never acted on. `place_ids` is validated `≤ 1000`, so 1001+ can't occur; typical cron/approval loads are ≤500 (one page → correctly `done:true`).
- **Required fix (optional, non-blocking):** bump per-place `maxRows` to `1001`, OR in the engine set `reachedEnd = true` when a non-dry page returns `rows.length === pageSize` but the next `loadPage` is known-empty. Either makes the exact-1000 boundary report `done:true`.
- **Retest:** engine unit test with 1000 rows, maxRows 1000, pageSize 500 → assert `done:true` after the fix.

### P4-1 — Praise: clean Bouncer-precedent mirror + correct sole-writer discipline.
- The engine is a faithful `_shared/bouncerBatch.ts` mirror; all DB IO stays in `index.ts`; the forced `ai_signal_scores_at → aiSignalScoresAt` camelCase deviation is the *correct* resolution of the SPEC-vs-strict-grep-gate contradiction (the DB column name exists in exactly one file). Header comments cite the invariant + F-numbers. Counting logic is byte-identical to the old `processPlaces` (no counting regression).

### Set aside — two KNOWN pre-existing reds (NOT ORCH-1333; confirmed vs origin/main)
- `_shared/__tests__/scorer.test.ts` **T-31** fails (33 passed / 1 failed). `signalScorer.ts` + `scorer.test.ts` are **byte-identical to origin/main** (0 changed in this diff), so this is definitionally pre-existing. This suite is wired into **no** CI job, so it does not gate; my new CI job scopes to the 3 batch-engine files only. Matches implementor Discovery D-A.
- `mingla-admin/src/pages/SignalLibraryPage.jsx:15` `'motion' is defined but never used` eslint — pre-existing unrelated import (implementor D-B). Not touched.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Non-destructively swapped ONLY the engine file to the implementor's revert commit and ran their two guard files, then restored.

- `git checkout 9929f439f -- supabase/functions/_shared/signalScorerBatch.ts` (accumulate-then-write-all; `9929f439f^ = c2a8d266`, the green proof; the revert touches **only** the engine, 27+/72−).
- **RED @ `9929f439f`:** implementor guards → **4 passed / 3 failed** — `T-B` (main), adversarial `T-B`, adversarial `T-B2` all fail (mid-run failure persists 0 instead of 1000). **Exactly matches** the implementation report §6 claim.
- `git checkout HEAD -- …signalScorerBatch.ts` → **GREEN restored: 7 passed / 0 failed** (and full re-pin + tester set: **23 passed / 0 failed**). Tree confirmed clean after restore.

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `supabase/functions/_shared/__tests__/signalScorerBatch.cursor_boundary.adversarial.test.ts`
- **Commit:** `9a779b81e` (body carries `[TEST-MOD-APPROVED ORCH-1333]`; appears in `git diff origin/main...HEAD --name-only`).
- **Wired into CI:** added to `orch-1333-signal-scorer-deno-tests` job's `DENO_TEST_FILES` array (CI-enforced).
- **Angle (distinct from the implementor's single-call maxRows=1500 sticky/upsert/pin-page-1 tests):**
  - **TC-1 (fails-on-revert anchor):** interrupted-then-resumed run reconstructs the **exact uninterrupted golden end-state** (same id set, same scores) with a per-id write-counter proving **zero double-writes across the failure seam** — a stronger property than the implementor's "`written==1000`". Attacks no-skip AND no-double simultaneously.
  - **TC-2:** the **shipped production city-mode loop** (`maxRows == pageSize == 500`, driven like `runScorerToCompletion`) across an **exactly-divisible** total (1000 = 2×500): terminates in exactly 3 calls, the full final data page does **not** prematurely report done (off-by-one guard), every id covered exactly once. The implementor never tested `maxRows==pageSize` — this is the real invocation shape.
  - **TC-3:** ORCH-1066 admin-pin on the **LAST (short) page** is neither re-scored nor veto-deleted (proves the per-page sticky filter runs on the final partial page before the `reachedEnd` break).
- **fails-on-revert verified at `9a779b81e`:** on the fix → **3 passed / 0 failed**; on the reverted engine (`9929f439f`) → **TC-1 FAILS** with `AssertionError: … pages 1-2 persisted BEFORE the page-3 failure` (abort-all persisted 0). TC-2/TC-3 are happy-path coverage (green both ways by design; TC-1 is the revert anchor). Restored → green.

---

## 6. Constitution matrix (relevant rules)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | PASS (source; runtime pending) | RunScorer/ScoreAll fire the loop; errors → toast; build green. |
| 2 | One owner per truth | **PASS** | `place_scores.score` + `ai_signal_scores_at` written only by `index.ts` `upsertScores`; engine has zero DB IO; sole-writer gate green (1847 files, 0 unauthorized). |
| 3 | No silent failures | **PASS** | Sticky/upsert errors → engine `error` → index.ts HTTP 500 with `error`; client throws + toasts. Veto-delete failure logged, non-fatal (documented, matches pre-1333). |
| 4 | One query key per entity | N/A | No React Query factory change. |
| 5 | Server state server-side | N/A | No Zustand change. |
| 6–14 | logout/transitional/subtract/fabrication/currency/auth/datetime/exclusion/hydration | N/A | No auth, currency, datetime, persisted-state, or data-fabrication surface touched. Counting byte-identical to origin/main. |

---

## 7. Device / parity matrix

| Surface | Ships here? | Result |
|---------|-------------|--------|
| Consumer iOS | No | Read-only consumer of `place_scores`; unaffected. Skip (does not ship). |
| Consumer Android | No | Same. Skip. |
| Buyer/anon Web | No | Does not read `place_scores`. Skip. |
| Business iOS/Android | No | Does not run the scorer. Skip. |
| **Admin Web** | **Yes** | `vite build` exit 0 (only pre-existing chunk-size warning). Client loop + counter-refresh **source-verified**; on-screen runtime firing **PENDING POST-DEPLOY** (authed admin runtime needs deploy + JWT). |
| Business Web preview | No | Does not run the scorer. Skip. |
| **Backend edge fn** | **Yes** | `run-signal-scorer` cursor-loop + new `_shared/signalScorerBatch.ts`: **behavioral logic proven** (23 Deno tests green; fails-on-revert). Deployed version = 270 (pre-1333); fixed version deploy = orchestrator CLOSE step. `verify_jwt:true` confirmed on the live fn (read-only). |

Physical-iPhone HITL: **N/A** — no consumer/business mobile surface in this change (backend + admin-web only).

---

## 8. Gate command results (per-command)

| Command | Result |
|---------|--------|
| `deno test` — 2 implementor guard files (exact CI cmd) | **7 passed / 0 failed** |
| `deno test` — tester adversarial `cursor_boundary.adversarial.test.ts` | **3 passed / 0 failed** |
| `deno test` — full wired CI job (3 files) | **10 passed / 0 failed** |
| `deno test` — re-pinned `per_place_mode` + `orch_1066_sticky_override` | **13 passed / 0 failed** |
| strict-grep `meta-orch-1009-sub-d-ai-score-staleness-recovery.mjs` (sole-writer) | **OK** (1847 files, 0 unauthorized `ai_signal_scores_at` writers) |
| strict-grep `i-ai-signal-scores-column-sole-owner.mjs` | **OK** (0 unauthorized writers) |
| `test-append-only-check.js` (base origin/main, HEAD=tester commit) | **5 passed / 0 failed** (token present in HEAD body) |
| admin `npm run build` (vite) | **exit 0** (2 pre-existing warnings only) |
| Fails-on-revert (implementor guards @ `9929f439f`) | **4 passed / 3 failed** (reproduced) |
| Fails-on-revert (tester TC-1 @ `9929f439f`) | **RED** (AssertionError, abort-all) → GREEN on restore |

---

## 9. Discoveries for Orchestrator

- **ID COLLISION (bookkeeping):** `origin/main` already contains a DIFFERENT **ORCH-1333** = `[partner-pages-reskin]` (mingla-business partner pages, PR #817, `dd10e8308`). This branch's ORCH-1333 = `[signal-scoring-city-run]` is a shared-label sibling. The 2 commits this branch is behind (`59928de17`, `dd10e8308`) touch ONLY mingla-business partner files + COMMS_LEDGER + docs — **zero overlap** with this ORCH's touched surface (supabase edge-fn, mingla-admin, deno CI). I did **not** rebase (preserves the implementor's commit hashes for the fails-on-revert proof); scorer/admin behavior is identical merged-or-not. Disambiguate by bracket-label at CLOSE; next free bare number per COMMS-0088 is ≥1343.
- **D-A / D-B** pre-existing reds (scorer.test.ts T-31; SignalLibraryPage motion lint) — recommend registering a fix ORCH for T-31 + wiring the scorer/blend Deno suite into CI (currently in no job).
- **D-1 / D-2** (from investigation) — consumer supply gap + quarterly `all_cities` backstop (auto-inherits this fix). Separate future ORCHs.

## 10. Downstream routing
→ **mingla-orchestrator CLOSE (gated):** deploy `run-signal-scorer` from MERGED main (`[deploy]`, preserve `verify_jwt:true`), verify with one authed curl, then run the **live-fire NY confirmation** (SC-1 backfill 35→~9,903; SC-2/3/6/7/8 on-screen) + the §4.C backfill (NY + Paris + sweep), flip `I-PROPOSED-1333-SCORER-CITY-RUN-INCREMENTAL-PERSIST` DRAFT→ACTIVE, sync WORLD_MAP + INVARIANT_REGISTRY, register the ORCH-1333 label collision + D-1/D-2.
