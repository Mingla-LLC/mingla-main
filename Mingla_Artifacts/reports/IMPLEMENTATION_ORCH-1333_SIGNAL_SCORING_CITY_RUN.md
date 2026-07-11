# IMPLEMENTATION — ORCH-1333 [signal-scoring-city-run]: bounded, incremental, resumable whole-city scoring

- **Phase:** IMPLEMENT (code built to the approved SPEC; NOT deployed/merged/closed).
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1331-[signal-scoring-city-run]/` (dir name cosmetically says 1331) on branch **`ORCH-1333-signal-scoring-city-run`** (rebased onto `origin/main` @ `f2eb308be`, incl. #816).
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1333_SIGNAL_SCORING_CITY_RUN.md` · **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1333_SIGNAL_SCORING_CITY_RUN.md`
- **Status:** implemented and self-verified (backend gates + admin build). Live-fire (device/prod-admin JWT) is the tester's phase.
- **Comms:** ledger read on entry. No `BLOCK`/`WARN`+`OPEN` row addressed to `mingla-implementor`, `ORCH-1333`, or `ALL` required action: COMMS-0052 (business-app OTA BLOCK, to ALL) is honored by construction — the implementor deploys/OTAs nothing. Factored WARNs: COMMS-0002 (ORCH-0863 C7 gate — verified scoped to ORCH-0863 PRs only, skips ours), COMMS-0015/0018 (release only from merged main — noted for the orchestrator), COMMS-0072 (venue scoring context).

---

## 1. Summary (plain English)

Clicking "Run scorer" for a large city that only became scorable after 2026-05-30 (New York, Paris) used to finish but save **zero** scores: the server tried to score the entire city in one call, ran the admin-pin safety check across all ~8,400 ids at once, then wrote everything at the end — and on a big city that giant call tripped the edge function's resource fail-safe **before any write landed**. This rebuild makes the scorer work like the Bouncer already does: it scores **one 500-place page per call**, saves that page immediately, and hands the admin browser a cursor to fetch the next page; the browser loops until done. A failure on page 12 can no longer wipe pages 1–11. Plus the "Scored" counter now refreshes when a run completes (Defect A), and a CI guard proves the incremental-persist behavior can't silently regress.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | How verified | Commit |
|----|-----------|--------------|--------|
| SC-1 | City persists incrementally; `next_cursor`+`done:false`; loop to `done:true` writes all | Guard T-A (full multi-page city, all ids written once, `done:true`, `remaining:0`) + T-E (resume from cursor, union=all). Backend logic. | `b975d21` (engine/index) + `c2a8d26` (tests) |
| SC-2 | No abort-all: page-N sticky/upsert failure keeps pages 1..N-1 + resumable cursor | Guard T-B (sticky throw on page 3 → `written==1000`, store holds 1000, `error` set, `next_cursor==p01000`) + adversarial T-B2 (upsert failure path). **Fails-on-revert proven (§6).** | `b975d21` + `c2a8d26` |
| SC-3 | Admin-pinned rows not clobbered/veto-deleted, per page; `sticky_skipped` counts | Guard T-C (protected place not upserted, not veto-deleted, `sticky_skipped==1`) + re-pinned orch_1066 T-01..T-06. Sticky pre-read → filter runs per page in the engine; `isAdminOverridden` + the sticky `.select` stay in index.ts. | `b975d21` + `c2a8d26` + `3e06023` |
| SC-4 | Per-place mode one-call, `done:true`, writes `ai_signal_scores_at`, no abort-all | index.ts `maxRows: isPerPlace ? 1000 : 500`; per-place `loadPage` uses `.in('id', placeIds)`; re-pinned per_place T-01..T-07. `admin-review-venue-claim` + 15-min cron untouched. | `b975d21` + `3e06023` |
| SC-5 | Response shape preserved + additive `next_cursor`/`done`/`remaining`; `verify_jwt:true` | index.ts success/dry_run returns spread `...result.summary` (`scored_count`/`ineligible_count`/`vetoed_count`/`ai_blended_count`/`signal_version_id`/`score_distribution`) + `written`/`veto_deleted`/`sticky_skipped`/`duration_ms` + additive keys. `config.toml` untouched. | `b975d21` |
| SC-6-Web | RunScorerButton loops to completion in one click w/ batch/scored/remaining/done progress | `runScorerToCompletion` + rewired `RunScorerButton` (D.2); admin `vite build` green. Runtime = tester. | `4c6b2fe` |
| SC-7-Web | Score ALL loops every signal, each to full completion | `ScoreAllSignalsButton` per-signal loop calls `runScorerToCompletion` (D.3); build green. Runtime = tester. | `4c6b2fe` |
| SC-8-Web | Defect A: `CityPipelineHistory` "Scored" column refetches on completion | `refreshSignal` prop + `useEffect([refresh, refreshSignal])`; render passes `refreshSignal={previewKey}`; all 4 onComplete handlers already bump `previewKey`. Runtime = tester. | `4c6b2fe` |
| SC-9 | Guard fails on revert to accumulate/abort-all + runs in CI | New CI job `orch-1333-signal-scorer-deno-tests` runs the 2 guard files; fails-on-revert proven (§6). | `c2a8d26` |

---

## 3. Files changed (line-delta vs origin/main)

| File | Change | Δ |
|------|--------|---|
| `supabase/functions/_shared/signalScorerBatch.ts` | **CREATE** — pure cursor-loop engine, no DB IO | +275 |
| `supabase/functions/run-signal-scorer/index.ts` | **MODIFY** — after_id parse; deps object (all DB IO); engine call; new return/error shape | +107 / −296 (net −189 body; whole-city block replaced) |
| `supabase/functions/_shared/__tests__/signalScorerBatch.test.ts` | **CREATE** — T-A/T-B/T-D/T-E | +177 |
| `supabase/functions/_shared/__tests__/signalScorerBatch.adversarial.test.ts` | **CREATE** — T-B/T-B2/T-C | +147 |
| `supabase/functions/run-signal-scorer/__tests__/per_place_mode.test.ts` | **MODIFY** — re-pin T-04/T-05/T-07 + BATCH_SOURCE | +~58 / −24 |
| `supabase/functions/run-signal-scorer/__tests__/orch_1066_sticky_override.test.ts` | **MODIFY** — re-pin T-06 | +~20 / −6 |
| `.github/workflows/supabase-migrations-and-stripe-deno.yml` | **MODIFY** — new `orch-1333-signal-scorer-deno-tests` job | +42 |
| `mingla-admin/src/pages/SignalLibraryPage.jsx` | **MODIFY** — cursor loop helpers + RunScorer/ScoreAll rewire + counter refresh | +121 / −~30 |

Total: 8 files, 977 insertions / 296 deletions. No file outside the SPEC allowlist touched.

---

## 4. Data-model changes applied

**None.** No migration, no schema/RLS/index/constraint/trigger change. `place_scores` and `place_pool` are read/written exactly as before; the only difference is that writes now land per-page instead of once at the end.

---

## 5. Edge functions touched

| Function | Change | `verify_jwt` to preserve on deploy |
|----------|--------|-------------------------------------|
| `run-signal-scorer` | Cursor-loop rewrite (bounded, resumable, incremental persist) + new `_shared/signalScorerBatch.ts` import | **`true`** (unchanged; `config.toml` not touched) |

`_shared/signalScorerBatch.ts` is a shared module (no independent deploy). **Operator/orchestrator deploys `run-signal-scorer` from MERGED main at CLOSE** (`[deploy]`-tag) — the implementor deploys nothing.

---

## 6. Regression tests added + fails-on-revert proof

**New guard files (additive):**
- `supabase/functions/_shared/__tests__/signalScorerBatch.test.ts` — T-A (full multi-page), **T-B (load-bearing abort-all guard)**, T-D (dry_run), T-E (resume). 4 tests.
- `supabase/functions/_shared/__tests__/signalScorerBatch.adversarial.test.ts` — T-B (sticky failure), T-B2 (upsert failure), T-C (admin-pin sticky per page). 3 tests.
- Wired into CI as job `orch-1333-signal-scorer-deno-tests` (they were in NO existing job — required so the guard is actually enforced).

**Re-pins (append-only token `[TEST-MOD-APPROVED ORCH-1333]` in commit `3e06023`):** per_place_mode T-04/T-05/T-07, orch_1066 T-06. Append-only gate: **4 passed, 0 failed** against `origin/main`.

**Fails-on-revert proof (true structural deletion of the fix, NOT a comment-out):**
- **GREEN @ `c2a8d266da344a90ab3dd17b6e2e22a81e486460`** (fix + guard committed): `deno test` the 2 guard files → **7 passed / 0 failed**.
- **RED @ `9929f439f93c8a3071872462dd3e881fe297ea2b`** (engine reverted to whole-city accumulate-then-write-all: one post-loop sticky pre-read + one UPSERT): `deno test` the 2 guard files → **4 passed / 3 failed** (main T-B, adversarial T-B, adversarial T-B2 all fail — `written` becomes 1500 with `error:null` instead of 1000-with-error, exactly the abort-all/no-incremental-persist regression the guard exists to catch).
- **GREEN restored @ `c2a8d266…`** (`git reset --hard` back to the fix): 7 passed / 0 failed.

**Behavioral coverage note:** the engine is pure logic driven by injected deps; the 7 guard tests exercise it end-to-end against an in-memory fake store (mirrors `bouncerBatch.test.ts`). Admin web has no jsx test harness (SPEC §7 T-G/T-H are manual-QA for the tester).

---

## 7. Old → New receipts

### `supabase/functions/run-signal-scorer/index.ts`
- **Before:** read ALL servable rows for the scope via an offset `while(true)` + `.range(offset, offset+499)` loop into a single `writes[]`/`vetoedPlaceIds[]` accumulator; then ONE post-loop ORCH-1066 sticky pre-read across all touched ids; then ONE chunked UPSERT loop; then a veto-delete loop; a pre-UPSERT error returned 500 with 0 persisted (F-4/F-5 abort-all).
- **After:** parses `after_id`; builds a single `ScorerBatchDeps` (all DB IO — `loadPage`/`readProtectedIds`/`upsertScores`/`deleteVetoed`/`countRemaining`) and calls `runSignalScorerBatch`. `maxRows` = 1000 (per-place: one-call cron/approval) or 500 (city/all_cities: one page, client loops). dry_run/error/success returns sourced from the engine `result`; additive `next_cursor`/`done`/`remaining`; every prior response key + `verify_jwt:true` preserved. All DB writes (incl. the `ai_signal_scores_at` DB column, the `.upsert` on `place_scores`, the sticky `.select`, `isAdminOverridden`) stay in this file.
- **Why:** SC-1..SC-5 — bound per-call work, persist per page, never abort-all.
- **Lines:** ~+107 / −296.

### `supabase/functions/_shared/signalScorerBatch.ts` (NEW)
- **Before:** did not exist.
- **After:** pure `runSignalScorerBatch(deps, opts)` cursor loop (score page → sticky pre-read → filter → upsert → veto-delete, per page). No DB IO. Fail-CLOSE on sticky throw / fatal on upsert error, both returning a resumable `next_cursor` with prior pages persisted. Exports `ScoreWrite`/`ScorerSummary`/`ScorerBatchDeps`/`ScorerBatchOptions`/`ScorerBatchResult`/`freshScorerSummary`.
- **Why:** makes the loop unit-testable in memory (SC-9) while keeping the sole-writer gates satisfied.
- **Lines:** +275.

### `mingla-admin/src/pages/SignalLibraryPage.jsx`
- **Before:** `RunScorerButton`/`ScoreAllSignalsButton` fired ONE `invokeWithRefresh` per signal and ignored `next_cursor`; `CityPipelineHistory` loaded only on mount/manual Refresh (F-6).
- **After:** `runScorerToCompletion` + `mergeScorerSummary` loop the cursor to `done`; both buttons show batch/scored/remaining/done progress and report accumulated totals; `CityPipelineHistory` takes a `refreshSignal={previewKey}` prop and refetches on completion.
- **Why:** SC-6/SC-7/SC-8 (Defect A).
- **Lines:** ~+121 / −30.

### Test re-pins
- `per_place_mode.test.ts`: T-04/T-05 point at the engine's `aiSignalScoresAt` passthrough + index.ts's `ai_signal_scores_at: w.aiSignalScoresAt` DB write; T-07 pins the cursor contract (`after_id`/`.gt('id', cursor)`/`runSignalScorerBatch(`) and asserts the old offset `.range()` loop is gone. T-01/T-02/T-03/T-06 unchanged.
- `orch_1066_sticky_override.test.ts`: T-06 pins the new wiring (`stickyOverride.ts` import + `isAdminOverridden(row.contributions)` + `runSignalScorerBatch(` + `readProtectedIds:` dep); behavioral T-01..T-05 unchanged.

---

## 8. Cross-surface impact

| Surface | Affected | Notes |
|---------|----------|-------|
| Consumer iOS / Android | No | Read-only consumer of `place_scores`; benefits indirectly once NY/Paris fill. |
| Buyer/anon Web | No | Does not read `place_scores`. |
| Business iOS / Android | No | Does not run the scorer. |
| **Admin Web** | **Yes** | Cursor loop + counter refresh; parity manual (only surface that triggers scoring). Build verified. |
| Business Web preview | No | Does not run the scorer. |
| **Backend** (`run-signal-scorer` + new `_shared` engine) | **Yes** | Per-page resumable; per-place unchanged in outcome. Single implementation (no parity split). |

---

## 9. Smoke / self-verify results

- **`deno check`** on the new engine `_shared/signalScorerBatch.ts` → clean (exit 0). `run-signal-scorer/index.ts` → the ONE pre-existing `GenericStringError[]` cast error only (proven identical on pristine `origin/main`, see §Deviations); the operative gate is `deno test --no-check` (what CI runs), which passes.
- **ORCH-1333 CI-job test set** (the 2 new guard files, exact CI command) → **7 passed / 0 failed**.
- **Re-pinned scorer tests** (per_place + orch_1066) → **13 passed / 0 failed**.
- **Strict-grep gates** `meta-orch-1009-sub-d-ai-score-staleness-recovery` (sole-writer), `meta-orch-1062-approval-go-live`, `i-consumer-reads-ai-signal-scores-not-trial-table` → all **PASS** (1847 files scanned, 0 unauthorized `ai_signal_scores_at` writers).
- **Append-only** gate (base `origin/main`) → **4 passed / 0 failed** (token present).
- **Admin `vite build`** → **success** (2978 modules; pre-existing chunk-size warning + pre-existing `motion` unused-import lint error, both on origin/main, not introduced here).

---

## 10. Known issues / deferred

- `countRemaining` returns `null` for all scopes (SPEC Open-Q-1 default; progress UI tolerates null, like the Bouncer's all_cities path). Non-blocking; a city-scoped unscored count can be added later if trivial.
- `SCORER_MAX_ROWS_PER_CALL = 500` (one page/call) chosen conservatively (SPEC Open-Q-2); a later ORCH could raise it with runtime evidence.
- No `[TRANSITIONAL]` markers, no DIAG markers left in the tree.

---

## 11. Operator action required (orchestrator/operator — NOT the implementor)

- **No migration** — nothing to `db push`.
- **Edge deploy (at CLOSE, from MERGED main, `[deploy]`-tag):** deploy `run-signal-scorer`. Preserve **`verify_jwt: true`**. Verify with one authed curl (`{ signal_id, city_id, after_id? }` → expect `next_cursor`/`done`). `_shared/signalScorerBatch.ts` ships with it (shared module).
- **Backfill (SPEC §4.C, post-deploy):** in admin Signal Library, "Score ALL signals" for New York, then Paris; sweep any other post-2026-05-30 large city with the investigation coverage query; verify NY/Paris reach ~100% servable coverage.
- **Invariant:** flip `I-PROPOSED-1333-SCORER-CITY-RUN-INCREMENTAL-PERSIST` DRAFT→ACTIVE at CLOSE; sync WORLD_MAP + INVARIANT_REGISTRY.

---

## 12. Deviations

1. **`ScoreWrite` field renamed `ai_signal_scores_at` → `aiSignalScoresAt` in the engine (forced by an internal SPEC contradiction + the un-touchable sole-writer gate).** SPEC §4.A's `ScoreWrite` type and loop, and the T-04/T-05 re-pin text, place the literal `ai_signal_scores_at:` inside `_shared/signalScorerBatch.ts`. But SPEC §6 + the DO-NOT-TOUCH strict-grep gate `meta-orch-1009-sub-d-ai-score-staleness-recovery.mjs` (Part B, pattern `/\bai_signal_scores_at\s*:/`, `ALLOWED_WRITER_FILES = { run-signal-scorer/index.ts }`, scans `_shared/` — only `__tests__` excluded) require the engine to **NEVER** contain that literal. I empirically confirmed the pattern trips on the type annotation `ai_signal_scores_at: string | null;`. §4.A's own stated rationale is "keep the gate green," so the gate wins and the field name is the flexible detail: the engine carries the freshness timestamp as `aiSignalScoresAt`, and `index.ts`'s `upsertScores` maps it to the DB column (`ai_signal_scores_at: w.aiSignalScoresAt`) — the DB column name exists in exactly one file. T-04/T-05 re-pinned to assert the passthrough in the engine + the DB-column write in index.ts. Sole-writer gate verified green. No behavior change; the DB column is written identically.
2. **`index.ts` strict `deno check` has one pre-existing `GenericStringError[]` cast error.** The `.select(SELECT_FIELDS)` string is too complex for supabase-js's type parser, so `data` is inferred as `GenericStringError[]` and the `as Array<PlaceForScoring & { id: string }>` cast is flagged. **Proven identical on pristine `origin/main` (2 such errors there; 1 here after the refactor).** The repo runs this file under `deno test --no-check` + bundled deploy, never strict `deno check`; I did NOT introduce `as unknown as X` (contract-banned). This is a pre-existing supabase-js limitation, not an ORCH-1333 regression.

---

## 13. Discoveries for Orchestrator

- **D-A (pre-existing red, DO-NOT-TOUCH file):** `supabase/functions/_shared/__tests__/scorer.test.ts` **T-31** ("ORCH-0597 Brunch/Lunch/Casual alias unions") FAILS on pristine `origin/main` (33 passed / 1 failed) — a latent red in a file I did not touch (`signalScorer.ts` + `scorer.test.ts` are byte-identical to origin/main). It is NOT caught by CI because the scorer/blend Deno suite is wired into NO job. My new CI job is scoped to the 2 new guard files (per SPEC §8 step 4), so it is unaffected. Recommend registering a fix ORCH for T-31 (and, separately, wiring the scorer/blend Deno suite into CI).
- **D-B (pre-existing admin lint red):** `mingla-admin/src/pages/SignalLibraryPage.jsx` line 15 `'motion' is defined but never used` fails `eslint` on pristine origin/main. Not introduced here; not fixed (out of scope, unrelated import).
- **D-1 / D-2** (from the investigation): consumer supply gap (NY/Paris ~0 ranked venue supply) + the quarterly `all_cities` backstop sharing this path — separate future ORCHs (the backstop auto-inherits this fix since all_cities routes through the same engine).
