# QA — META-ORCH-1009 Sub-D — Refresh cron + admin re-evaluate button

**Skill:** Claude `mingla-tester` (adversarial)
**Date:** 2026-05-30
**Branch:** `META-ORCH-1009-Sub-D-refresh-cron-admin-reeval-button`
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-D-[refresh-cron-admin-reeval-button]/`
**SPEC:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_D_REFRESH_CRON.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1009_SUB_D_REFRESH_CRON.md`
**PR:** #281 (`gh pr list --head META-ORCH-1009-Sub-D-refresh-cron-admin-reeval-button`)

---

## Verdict

**FAIL** — one P0 production-bricker in the drift trigger.

Migration is NOT safe to apply as-shipped. The drift trigger references a table (`public.cities`) that does NOT exist on the linked Supabase project — every Google-data-drift event will throw `relation "public.cities" does not exist` and abort the underlying `place_pool` UPDATE in the same transaction.

Recommend: fix F-01 (1-line change), re-test, re-submit. F-02 is a P1 defense-in-depth gap. F-03 is an operator-accepted P2 (D-3 LOCKED).

---

## Findings by severity

### P0 — production blocker

#### F-01 [P0] Drift trigger references non-existent table `public.cities`

**Where:** `supabase/migrations/20260808000000_meta_orch_1009_sub_d_refresh_cron.sql:322`

```sql
COALESCE((SELECT name FROM public.cities WHERE id = NEW.city_id LIMIT 1), 'drift'),
```

**Live DB evidence (Supabase Management API 2026-05-30):**
```sql
SELECT table_schema, table_name FROM information_schema.tables WHERE table_name = 'cities';
-- → 0 rows.
SELECT table_schema, table_name FROM information_schema.tables WHERE table_name ILIKE '%cit%' AND table_schema='public';
-- → [{ "table_schema":"public", "table_name":"seeding_cities" }]
```

The actual table is `public.seeding_cities` (verified: has `id uuid` + `name text` columns matching what the trigger expects).

**Impact:**
- Every UPDATE on `place_pool.business_status` / `editorial_summary` / `generative_summary` for a place with `ai_signal_scores IS NOT NULL` will fire the trigger, which will throw `42P01: relation "public.cities" does not exist` and roll back the parent UPDATE.
- The trigger runs `AFTER UPDATE FOR EACH ROW` in the same transaction as the UPDATE, so the originating data-refresh writer (Google Places sync, admin edit, etc.) will fail until this is fixed.
- The migration's own apply-time verification probes (§8) do NOT exercise the trigger function body, so the migration apply itself succeeds — the breakage is latent and only surfaces on the first real drift event.

**Fix:** change `FROM public.cities` to `FROM public.seeding_cities` in the trigger function body (1 line). Re-test by simulating an UPDATE on `place_pool.business_status` for any place with `ai_signal_scores IS NOT NULL`.

**Pinned by:** `supabase/migrations/__tests__/meta_orch_1009_sub_d_adversarial.test.ts` ADV-01 (currently PASSES because the bug is present; will FAIL after the fix lands — at that point invert the assertion to `assertStringIncludes(MIGRATION, "FROM public.seeding_cities", ...)`).

---

### P1 — defense-in-depth gap

#### F-02 [P1] Drift trigger lacks `NEW.city_id IS NOT NULL` guard

**Where:** `supabase/migrations/20260808000000_meta_orch_1009_sub_d_refresh_cron.sql:300–350` (trigger function body has 3 guards but no city_id-null guard).

**Live DB evidence:**
- `place_pool.city_id` is NULLABLE (verified via `information_schema.columns`).
- `place_intelligence_runs.city_id` is NOT NULL (verified).
- Currently 0 servable AI places have NULL city_id (so this is a latent gap, not an active bug).

**Impact:** if any future `place_pool` row is created with `ai_signal_scores` populated and `city_id IS NULL`, a drift event would throw `null value in column "city_id" of relation "place_intelligence_runs" violates not-null constraint` and again abort the underlying UPDATE.

**Fix:** add `IF NEW.city_id IS NULL THEN RETURN NEW; END IF;` after the existing Guard 3 in `tg_meta_orch_1009_sub_d_drift_queue_reeval` (consistent with the other guards' pattern).

**Pinned by:** ADV-02.

---

### P2 — operator-accepted cost concern

#### F-03 [P2] Whitespace-only summary edits fire Gemini Q2 (~$0.0040 each)

**Where:** trigger uses `IS DISTINCT FROM` on `editorial_summary` / `generative_summary` with no whitespace normalization. A Google data refresh that re-pulls the summary with different whitespace (common with Google's text pipeline) will fire a re-evaluation.

**Status:** **operator-accepted** per D-3 LOCKED in SPEC §6 ("drift cost ship-as-is, monitor 30 days"). Pinned by ADV-03 so cost regression is visible in source diffs.

**Future fix (if 30-day monitoring flags cost):** wrap both sides with `btrim()` or `regexp_replace(...,'\s+',' ','g')` before the `IS DISTINCT FROM` check.

---

## Adversarial test paths + fails-on-revert

Adversarial test file:
- `supabase/migrations/__tests__/meta_orch_1009_sub_d_adversarial.test.ts` (10 tests, all PASS)

Run:
```bash
cd ~/Desktop/mingla-orchs/META-ORCH-1009-Sub-D-[refresh-cron-admin-reeval-button]
deno test --allow-read supabase/migrations/__tests__/meta_orch_1009_sub_d_adversarial.test.ts
# Result: 10 passed, 0 failed
```

| # | Test | Severity | Pin behavior | Fails-on-revert verified |
|---|---|---|---|---|
| ADV-01 | drift trigger references `public.cities` (which does not exist) | P0 | Asserts bug present | YES — `sed s/public.cities/public.seeding_cities/` flips PASS→FAIL |
| ADV-02 | drift trigger lacks `NEW.city_id IS NOT NULL` guard | P1 | Asserts gap present | YES — adding guard line flips PASS→FAIL |
| ADV-03 | no whitespace normalization on summary diffs | P2 | Asserts gap present (operator-accepted) | YES — adding `btrim()` flips PASS→FAIL |
| ADV-04 | exactly 3 drift-watched columns | defensive | Regression guard | YES — adding 4th col flips PASS→FAIL |
| ADV-05 | helper REVOKEd from PUBLIC+anon+authenticated | defensive | Regression guard | YES — removing any REVOKE flips PASS→FAIL |
| ADV-06 | cron schedules byte-identical to SPEC | defensive | Regression guard | YES — changing schedule flips PASS→FAIL |
| ADV-07 | drift dedup idx covers both `pending` AND `running` | defensive | Regression guard | YES — narrowing to `pending` only flips PASS→FAIL |
| ADV-08 | D-6 seed has `IS NULL` + `scored_at >` clauses (idempotent) | defensive | Regression guard | YES — removing IS NULL guard flips PASS→FAIL |
| ADV-09 | admin button kick pattern doc-only | defensive | Refers to admin_reeval_place.test.ts T-08 | N/A (doc test) |
| ADV-10 | quarterly fn no ASSERT in loop body | defensive | Empty-signals safety | YES — adding ASSERT flips PASS→FAIL |

---

## Implementor tests verified (28 of 49 claimed)

The implementor's report cites 49 new tests; my count of NEW Sub-D test assertions across the 4 NEW test files = 28 (10 + 7 + 5 + 6). The 49 number is best interpreted as 28 NEW + 21 Sub-B regression sweep (which I re-verified passes). I treat the 28 NEW as load-bearing for Sub-D.

| File | Tests | Result |
|---|---|---|
| `supabase/functions/run-signal-scorer/__tests__/per_place_mode.test.ts` | 7 | 7/7 PASS |
| `supabase/functions/_shared/__tests__/signalScorer.evaluated_at_passthrough.test.ts` | 5 | 5/5 PASS |
| `supabase/functions/run-place-intelligence-trial/__tests__/admin_reeval_place.test.ts` | 10 | 10/10 PASS |
| `mingla-admin/src/__tests__/orch1009_sub_d_reeval_button.test.js` | 6 | 6/6 PASS |
| **Sub-D NEW total** | **28** | **28/28 PASS** |
| Sub-B regression: `signalScorer.blend.test.ts` + `signalScorer.blend.adversarial.test.ts` | 21 | 21/21 PASS (unaffected by Sub-D's 1-line `evaluated_at` addition) |
| Sub-A regression: `ai_signal_scores_*` (3 files) | 16 | 16/16 PASS (writer untouched) |
| **Grand total verified** | **65** | **65/65 PASS** |

Strict-grep gate `meta-orch-1009-sub-d-ai-score-staleness-recovery.mjs` self-tested: PASS at HEAD; FAIL when I injected a write violation into `run-place-intelligence-trial/index.ts`; PASS after revert. Behavior correct.

No tautology detected in the 28 implementor tests — every test references concrete source text or runtime behavior (button label, action enum, source enum, status filter, error message) that would silently break consumer behavior if the assertion were removed. Source-inspect style is appropriate given the edge-fn module-load constraints called out in each file's docstring.

The post-apply SQL probe `supabase/migrations/__tests__/sub_d_seed_idempotent.test.sql` (6 checks) cannot run until operator applies the migration — verified by static read.

---

## D-6 seed verification — live DB sample showing WHERE-clause truth

D-6 SEED predicate (migration §9):
```sql
UPDATE public.place_scores ps
SET ai_signal_scores_at = (pp.ai_signal_scores -> ps.signal_id ->> 'evaluated_at')::timestamptz
FROM public.place_pool pp
WHERE pp.id = ps.place_id
  AND pp.ai_signal_scores IS NOT NULL
  AND pp.ai_signal_scores ? ps.signal_id
  AND ps.ai_signal_scores_at IS NULL
  AND ps.scored_at > (pp.ai_signal_scores -> ps.signal_id ->> 'evaluated_at')::timestamptz;
```

**Live DB probe (2026-05-30):**

| Bucket | Count | Behavior on migration apply |
|---|---|---|
| Total (place, signal) AI pairs with servable+active | 37,174 | denominator |
| ai pair has NO place_scores row (`ps.scored_at IS NULL`) | 10,582 | NOT seeded — cron picks up for first AI-blended rescore |
| ps row exists but is stale (`ps.scored_at < ai_evaluated_at`) | 898 | NOT seeded — cron picks up for rescore |
| ps row exists AND is fresh (`ps.scored_at > ai_evaluated_at`) | 25,694 | **SEEDED** — `ai_signal_scores_at` stamped |

D-6 LOCKED behavior matches the operator-promised outcome:
- Raleigh + Cary already-fresh rows ARE stamped (25,694 candidates dominated by Raleigh/Cary post-Sub-B coverage).
- Pre-Sub-B rows (10,582 + 898 = 11,480) stay NULL → cron picks them up.
- Idempotent (verified by ADV-08): re-running the seed produces 0 row changes because the `ai_signal_scores_at IS NULL` predicate excludes already-seeded rows.

Live probe by signal (top 5 dirty pairs that the FIRST cron tick will pick up):

| signal_id | stale_count |
|---|---|
| movies | 1,676 |
| theatre | 1,636 |
| flowers | 1,318 |
| groceries | 1,105 |
| play | 1,013 |

Total dirty: 11,480. At 500/tick cap and 15-min cadence: ~23 ticks ≈ 5.75h to drain (within SPEC's ~8h estimate; faster because backfill since SPEC-write shrank the backlog from ~11,576 to 11,480).

**The D-6 seed is correctly designed** — but it cannot actually run until F-01 is fixed and the migration applies. If the operator applies as-shipped, the trigger creation will succeed but no drift can fire without erroring, and the D-6 seed will run successfully (the seed UPDATE itself does not invoke the trigger because it touches `place_scores`, not `place_pool`).

---

## Cross-layer verification

### Hygiene gates

| Check | Result |
|---|---|
| `grep -rn "META-ORCH-1009-Sub-D-DIAG"` | 0 hits — no DIAG markers left in |
| Conflict markers (`^<<<<<<<`, `^=======$`, `^>>>>>>>`) in Sub-D-changed files | 0 hits |
| `npm run build` in `mingla-admin/` | PASS (Vite built in 2.12s) |
| Strict-grep `meta-orch-1009-sub-d-ai-score-staleness-recovery.mjs` | PASS (Part A + Part B; 1282 files scanned, 0 unauthorized writers) |
| Strict-grep self-test (inject violation, revert) | PASS→FAIL→PASS cycle verified |
| COMMS-0002 trap (`META_ORCH_1009_SUB_D_BACKEND_ALLOWLIST`) | Listed in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (verified via implementation report §2) |
| COMMS-0003 (Gemini docs URLs cited inline) | Present at migration §6 + `handleAdminReevalPlace` header at index.ts:1460-1462 |
| `[META-ORCH-1009 Sub-D]` commit prefix on all branch commits | 8 of 9 commits prefixed (the 9th is the INTAKE row) |
| `[TEST-MOD-APPROVED META-ORCH-1009-D]` token search | Not present in commit log — no implementor tests were modified by my session (per hard guard) |

### Layer-by-layer

**Layer 1 (cron + per-place mode):**
- ✓ per-place SELECT branch present (validated by per_place_mode.test.ts T-01)
- ✓ `place_ids` length cap 1000 enforced
- ✓ `place_ids + all_cities` mutually exclusive
- ✓ `ai_signal_scores_at` threaded into chunk payload (sole-writer per strict-grep Part B)
- ✓ city/all_cities paging loop preserved (regression guard T-07)
- ✓ Vault skip-on-missing pattern matches `tg_kick_pending_trial_runs`
- ✓ Per-signal HTTP bucketing avoids 16 separate requests for a typical 2-3 dirty signals tick
- ✓ Helper fn REVOKEd from PUBLIC + anon + authenticated

**Layer 2 (drift trigger):**
- ✗ **F-01 P0** — references nonexistent `public.cities` table
- ✗ **F-02 P1** — missing NEW.city_id IS NOT NULL guard
- ⚠ **F-03 P2** — no whitespace normalization (operator-accepted)
- ✓ AFTER UPDATE OF restricted to exactly 3 columns (ADV-04)
- ✓ `IS DISTINCT FROM` correctly handles NULL transitions
- ✓ Guard 1 (any actual change) prevents no-op UPDATE thrash
- ✓ Guard 2 (ai_signal_scores NOT NULL) prevents pre-Sub-C waste
- ✓ Guard 3 (is_servable) matches consumer-ranker scope
- ✓ Partial unique idx covers both pending+running (ADV-07)
- ✓ EXCEPTION block tolerates city run unique violation (per documented behavior)

**Layer 3 (admin button):**
- ✓ Dispatcher case wired (T-01)
- ✓ Server-side rate limit 429 on any pending/running for place (T-03)
- ✓ Source tag `admin-reeval-button` (T-04)
- ✓ Concurrent-run-for-city 409 from 23505 (T-10)
- ✓ Missing place_pool_id → 400, unknown place → 404, valid → 200 with run_id
- ✓ Immediate process_chunk kick + cron backstop
- ✓ Admin UI button + last-evaluated timestamp rendered + handler with rate-limit toast variant

**Layer 4 (quarterly backstop):**
- ✓ Schedule `0 4 1 */3 *` correctly parses to "04:00 UTC on day 1 of every 3rd month"
- ✓ 60s pg_sleep between signal HTTPs prevents fleet thrash
- ✓ Vault skip-on-missing pattern
- ✓ Empty-signals safety (ADV-10): no ASSERT in loop body
- ✓ Idempotent: back-to-back invocations re-fire HTTPs; downstream signal-scorer is idempotent via ON CONFLICT upsert

**D-6 seed:**
- ✓ WHERE clause correctly seeds only rows where ps.scored_at > ai_evaluated_at (already absorbed)
- ✓ Idempotent via IS NULL guard (ADV-08)
- ✓ Does NOT fire the drift trigger (UPDATE is on place_scores, not place_pool)
- ✓ Live probe: 25,694 rows will be stamped on apply; 11,480 stay NULL for first cron tick

---

## Live-DB sanity probes performed

| Probe | Expected | Actual | Verdict |
|---|---|---|---|
| `place_scores.ai_signal_scores_at` column pre-exists | NO | NO (column list confirmed) | ✓ safe to ADD |
| Stale (place, signal) pairs cited in SPEC §11 = 988 | ~988 | 898 stale + 10,582 missing = 11,480 total | ✓ within drift band; SPEC's 988 was just the "stale ps" subset |
| Raleigh/Cary fresh rows for D-6 sample | rows with scored_at > ai_evaluated_at | 25,694 fresh-seed candidates total | ✓ D-6 WHERE clause truth verified |
| `public.cities` exists | YES | **NO** — only `public.seeding_cities` | ✗ **F-01 P0** |
| `place_pool` has 3 drift columns | YES | YES (3/3 present) | ✓ |
| `place_intelligence_runs.city_id` NOT NULL | YES | YES | ✓ requires city_id guard (F-02) |
| `signal_definitions` active rows | 16 | 16 | ✓ quarterly backstop has work |
| `cron.job` `kick_pending_trial_runs` schedule | `* * * * *` | `* * * * *` | ✓ existing queue worker available |
| `place_intelligence_trial_runs` accepts `signal_id=NULL` rows | YES | YES (4,824 such rows exist) | ✓ drift + admin-reeval inserts work |

---

## Recommendation

**FAIL — Send back for F-01 rework.**

**Rework scope:** 1-line change in `supabase/migrations/20260808000000_meta_orch_1009_sub_d_refresh_cron.sql:322` — `public.cities` → `public.seeding_cities`. **Strongly recommend** also closing F-02 in the same diff (1-line guard add).

**On rework return:**
1. Re-run the 10 adversarial tests; ADV-01 will FAIL after the fix (correct — pin behavior should be inverted to assert `public.seeding_cities` post-fix).
2. Re-run the 28 implementor tests (should all still pass — unaffected).
3. Re-run the strict-grep gate (should still pass).
4. Apply the migration to the linked project (operator-driven).
5. Run the post-apply SQL probes in `sub_d_seed_idempotent.test.sql` for L1-01, L1-03, L2-01, L2-02, L2-03, L4-01, D-6.

**Optional but recommended for rework:** invert ADV-01's assertion in the same diff so the test pins the FIX rather than the BUG going forward.

---

**End of QA report.**
