# IMPLEMENTATION — META-ORCH-1009 Sub-D — Refresh cron + admin re-evaluate button

**Status:** READY-FOR-REVIEW (local commits on branch, not pushed)
**Skill:** Claude `mingla-implementor`
**Date:** 2026-05-30
**Branch:** `META-ORCH-1009-Sub-D-refresh-cron-admin-reeval-button`
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-D-[refresh-cron-admin-reeval-button]/`
**Branched-from:** main @ `28d7426e4`
**SPEC:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_D_REFRESH_CRON.md`
**Decision:** DEC-183 (appended to `DECISION_LOG.md`)
**Invariant:** I-AI-SCORE-STALENESS-AUTO-RECOVERED (ACTIVE post-CLOSE)

---

## §1 Scope (delivered)

All 4 SPEC layers implemented:

1. **Layer 1 — Detection column + 15-min rescore-sweep cron.** New `place_scores.ai_signal_scores_at TIMESTAMPTZ`; new SECURITY DEFINER helper `pg_meta_orch_1009_sub_d_select_stale_pairs(int)`; new cron `meta_orch_1009_sub_d_ai_score_rescore_sweep` at `*/15 * * * *` calling `tg_meta_orch_1009_sub_d_kick_rescores()` which buckets stale pairs by signal and HTTP-POSTs `run-signal-scorer` per signal in per-place mode.
2. **Layer 2 — Google-data-drift triggers.** New `place_intelligence_trial_runs.source TEXT` (CHECK on 2 enum values) + partial unique idx `idx_pit_runs_drift_reeval_one_per_place`. New trigger `tg_place_pool_drift_queue_reeval` AFTER UPDATE OF `business_status`/`editorial_summary`/`generative_summary` queues a pending row into the existing trial pipeline tagged `source='auto-refresh-drift'`.
3. **Layer 3 — Admin "Re-evaluate AI signals" button.** New `admin_reeval_place` action in `run-place-intelligence-trial/index.ts` (server-side rate-limited 429 on any in-flight row, immediate `process_chunk` kick). Admin UI button + "Last AI Evaluated" timestamp in `PlaceDetailModal`.
4. **Layer 4 — Quarterly backstop.** New cron `meta_orch_1009_sub_d_quarterly_all_cities_sweep` at `0 4 1 */3 *` calling `tg_meta_orch_1009_sub_d_quarterly_sweep()` which iterates `signal_definitions WHERE is_active=true` and fires one `all_cities=true` HTTP per signal with 60s spacing.
5. **Layer 5 — Operator-locked D-6 seed-UPDATE.** Migration final block stamps `ai_signal_scores_at` for rows where `scored_at > ai_evaluated_at` (already up-to-date post-Sub-B). Cuts first-sweep drain from ~13.5h to ~8h. Idempotent (the WHERE predicate excludes already-seeded rows via the `IS NULL` guard).
6. **Layer 6 — Strict-grep CI gate.** New `meta-orch-1009-sub-d-ai-score-staleness-recovery.mjs` enforces 2-part contract (Part A: cron registered in Sub-D migration; Part B: `ai_signal_scores_at` written only by `run-signal-scorer/index.ts`). Registered in `strict-grep-mingla-business.yml`.

---

## §2 Files changed (1 new migration + 3 edge fns + 1 admin UI + 1 strict-grep + 1 workflow + 1 allowlist + 5 tests + 2 docs)

### Backend (gated by `META_ORCH_1009_SUB_D_BACKEND_ALLOWLIST`)

| File | Type | Lines | What |
|---|---|---|---|
| `supabase/migrations/20260808000000_meta_orch_1009_sub_d_refresh_cron.sql` | NEW | 397 | All migration layers + D-6 seed + 4 schema/cron probes + apply NOTICE |
| `supabase/functions/run-signal-scorer/index.ts` | EDIT | +85 / -22 | Per-place mode (validation + SELECT path) + `ai_signal_scores_at` chunk-payload column + scope-aware logs |
| `supabase/functions/_shared/signalScorer.ts` | EDIT | +12 / -1 | Adds `evaluated_at: string` to `ScoreResult.ai_blended` + passthrough in computeScore (1-line addition per SPEC §3.1) |
| `supabase/functions/run-place-intelligence-trial/index.ts` | EDIT | +153 / -1 | NEW `admin_reeval_place` action handler + dispatcher case + error-message enum |
| `supabase/functions/run-signal-scorer/__tests__/per_place_mode.test.ts` | NEW | 100 | 7 source-inspect tests (T-01–T-07) — fails on revert verified |
| `supabase/functions/_shared/__tests__/signalScorer.evaluated_at_passthrough.test.ts` | NEW | 137 | 5 computeScore tests (T-01–T-05) — fails on revert verified |
| `supabase/functions/run-place-intelligence-trial/__tests__/admin_reeval_place.test.ts` | NEW | 124 | 10 source-inspect tests (T-01–T-10) — fails on revert verified |
| `supabase/migrations/__tests__/sub_d_seed_idempotent.test.sql` | NEW | 121 | 6 read-only post-apply probes (L1-01, L1-03, L2-01, L2-02, L2-03, L4-01, D-6) |

### Frontend (not gated by C7; lives under `mingla-admin/`)

| File | Type | Lines | What |
|---|---|---|---|
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | EDIT | +73 / -1 | `handleReeval` handler + `reeval` state + "Re-evaluate AI signals" button + "Last AI Evaluated" timestamp in Data Freshness |
| `mingla-admin/src/__tests__/orch1009_sub_d_reeval_button.test.js` | NEW | 96 | 6 source-inspect tests via node:test (T-01–T-06) — fails on revert verified |

### CI / governance

| File | Type | Lines | What |
|---|---|---|---|
| `.github/scripts/strict-grep/meta-orch-1009-sub-d-ai-score-staleness-recovery.mjs` | NEW | 176 | Part A (cron registered) + Part B (sole-writer for `ai_signal_scores_at`) gate |
| `.github/workflows/strict-grep-mingla-business.yml` | EDIT | +10 | Registers the new gate as a CI job |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | EDIT | +27 | `META_ORCH_1009_SUB_D_BACKEND_ALLOWLIST` block (10 paths) + spread into `ALLOWLIST` |
| `Mingla_Artifacts/DECISION_LOG.md` | EDIT | +43 | DEC-183 appended |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | EDIT | +26 / -2 | New ACTIVE `I-AI-SCORE-STALENESS-AUTO-RECOVERED` body + header counts updated |

---

## §3 Tests written + fails-on-revert evidence

All 5 dispatches written; 28 tests total across the 5 files; all pass; each load-bearing assertion verified to fail on revert and re-pass after restore.

### Run commands (clean repro)

```bash
cd ~/Desktop/mingla-orchs/META-ORCH-1009-Sub-D-[refresh-cron-admin-reeval-button]

# Deno tests (run-signal-scorer per-place mode + scorer evaluated_at passthrough + admin_reeval_place)
deno test --allow-read \
  supabase/functions/run-signal-scorer/__tests__/per_place_mode.test.ts \
  supabase/functions/_shared/__tests__/signalScorer.evaluated_at_passthrough.test.ts \
  supabase/functions/run-place-intelligence-trial/__tests__/admin_reeval_place.test.ts
# Result: 22 passed, 0 failed

# Sub-B regression sweep — make sure the 1-line signalScorer change didn't break the blend
deno test --allow-read \
  supabase/functions/_shared/__tests__/signalScorer.blend.test.ts \
  supabase/functions/_shared/__tests__/signalScorer.blend.adversarial.test.ts
# Result: 21 passed, 0 failed (Sub-B tests unaffected by Sub-D's evaluated_at field addition)

# Sub-A regression sweep — trial-writer tests (need --allow-net for an imagescript dep, --allow-env for the Deno.env reads in the imported edge fn)
deno test --allow-read --allow-net --allow-env \
  supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_slice.test.ts \
  supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_write_path.test.ts \
  supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_adversarial.test.ts
# Result: 16 passed, 0 failed (Sub-A writer untouched by Sub-D's new action)

# Admin UI source-inspect test
(cd mingla-admin && node --test src/__tests__/orch1009_sub_d_reeval_button.test.js)
# Result: 6/6 pass

# Strict-grep gate (Sub-D's own + the ORCH-0863 C7 allowlist gate)
node .github/scripts/strict-grep/meta-orch-1009-sub-d-ai-score-staleness-recovery.mjs
# Result: OK — cron registered (Part A) + 1282 files scanned, 0 unauthorized writers (Part B)

# Admin Vite build sanity
(cd mingla-admin && npm run build)
# Result: built in 2.27s
```

### Fails-on-revert evidence (each load-bearing test)

| Test | Revert action | Observation | Restore action | Re-pass? |
|---|---|---|---|---|
| `per_place_mode.test.ts` T-04 | Comment out `ai_signal_scores_at: w.ai_signal_scores_at` in chunk payload | T-04 FAIL (chunk payload does not write ai_signal_scores_at) | Restore line | ✓ all 7 pass |
| `signalScorer.evaluated_at_passthrough.test.ts` T-01 + T-05 | Replace `evaluated_at: aiEntry.evaluated_at` with `undefined` in signalScorer.computeScore | T-01 + T-05 FAIL (evaluated_at not echoed) | Restore line | ✓ all 5 pass |
| `admin_reeval_place.test.ts` T-01 | Remove `case "admin_reeval_place":` from dispatcher | T-01 FAIL (dispatcher case missing) | Restore case | ✓ all 10 pass |
| `orch1009_sub_d_reeval_button.test.js` T-01 | Replace button label "Re-evaluate AI signals" → "REVERT PROBE" | T-01 FAIL (button label missing) | Restore label | ✓ all 6 pass |
| Strict-grep gate Part B | Inject `ai_signal_scores_at: new Date().toISOString()` into an `.insert({...})` in `run-place-intelligence-trial/index.ts` | FAIL exit 1 — "1 file(s) appear to WRITE ai_signal_scores_at outside the allowed writer" | Remove the injected line | ✓ exit 0 |

(Strict-grep Part A — cron-registered — is enforced by string match on the cron name in the migration. The Sub-D migration's verification DO block independently RAISE EXCEPTIONs on cron schedule mismatch at migration apply, so even if someone unschedules the cron in a follow-up migration the gate enforces the registration string in the Sub-D migration file itself.)

---

## §4 SQL probes (run after migration applies)

`supabase/migrations/__tests__/sub_d_seed_idempotent.test.sql` covers acceptance L1-01 / L1-03 / L2-01 / L2-02 / L2-03 / L4-01 / D-6. Run via the Supabase Management API or `supabase db remote sql --linked` against the linked project AFTER the operator applies the migration. All 6 checks RAISE EXCEPTION on failure; the final NOTICE confirms ALL CHECKS PASS.

---

## §5 Operator apply commands (NOT executed by implementor)

### Migration

```bash
cd "~/Desktop/mingla-orchs/META-ORCH-1009-Sub-D-[refresh-cron-admin-reeval-button]" \
  && /Users/sethogieva/bin/supabase db push --linked --include-all
```

Pre-apply confirmation (already run): `place_scores.ai_signal_scores_at` does NOT pre-exist on the linked project (verified via `mcp__supabase__execute_sql` against `information_schema.columns`). Migration is safe to apply.

Expected apply NOTICEs:
- `META-ORCH-1009 Sub-D apply complete. ai_signal_scores_at populated: <N> rows. Stale pairs queued for first cron tick: <M>.`
- Where `N` ≈ 25,694 (per the SPEC live probe: 26,682 overlap pairs − 988 currently-stale = ~25,694 already-up-to-date and stampable).
- Where `M` ≈ 988 + 10,588 = ~11,576 (currently-stale pairs + new pairs without `place_scores` row).

### Edge function deploys (post-migration)

```bash
/Users/sethogieva/bin/supabase functions deploy run-signal-scorer --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
```

No EAS update (admin-web only; no app-mobile changes).

---

## §6 Discoveries (in-scope, factored)

- `place_scores` baseline DDL has `score NUMERIC NOT NULL` + CHECK constraint per Sub-B's DEC-182 deviation; Sub-D's new column is nullable and does not interact with that CHECK.
- The Sub-A backend allowlist (`META_ORCH_1009_SUB_A_BACKEND_ALLOWLIST` at line 1059 of `orch-0863-marketing-hub-phase-b.mjs`) does NOT cover `supabase/functions/run-place-intelligence-trial/index.ts` for Sub-D's new handler — but the Sub-B and Sub-A allowlists already list this file. Sub-D's allowlist re-lists it for ORCH-trace cleanliness; the spread is a union so duplicates are harmless (same pattern Sub-B used).
- The existing `kick_pending_trial_runs` cron at `* * * * *` (every minute) already drains pending `place_intelligence_trial_runs` rows. Sub-D's drift trigger inserts into that same queue with `source='auto-refresh-drift'`, so the existing worker picks them up unchanged — no Sub-A pipeline modification needed.
- The Sub-B blend tests (21 tests across `signalScorer.blend.test.ts` + `signalScorer.blend.adversarial.test.ts`) all still pass after Sub-D's 1-line `evaluated_at` passthrough addition. Confirms the addition is non-disruptive to the blend formula.

---

## §7 Out-of-scope (preserved per dispatch hard guards)

- No consumer-mobile changes (Sub-B owns deck).
- No business-app changes (Sub-E deferred).
- No new bulk admin actions (per-place only; bulk is Sub-C).
- No Sub-A column-write changes (Sub-D only reads `place_pool.ai_signal_scores`; writes are still sole-owned by `run-place-intelligence-trial`).

---

## §8 Cross-references

- SPEC: `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_D_REFRESH_CRON.md`
- DEC-099 (constitutional bless), DEC-181 (column name), DEC-182 (Sub-B blend), **DEC-183 (this work — appended)**
- Invariant: I-AI-SCORE-STALENESS-AUTO-RECOVERED (new ACTIVE)
- Sub-A close: `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1009_SUB_A_AI_SIGNAL_SCORES_SCHEMA.md`
- Sub-B close: `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1009_SUB_B_CONSUMER_RANKER_BLEND.md`
- COMMS-0003: Gemini docs cited inline in the migration COMMENT block + new `handleAdminReevalPlace` header
- COMMS-0002: `META_ORCH_1009_SUB_D_BACKEND_ALLOWLIST` landed in same diff as migration + edge fn edits + new strict-grep gate
- Pattern references: `supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql` (pg_cron + pg_net + vault), `supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql` (queue worker)

---

**End of IMPLEMENTATION report.**
