-- ─────────────────────────────────────────────────────────────────────────
-- ORCH-0734: City-runs trial pipeline; signal_anchors decommissioned
-- ─────────────────────────────────────────────────────────────────────────
-- Per DEC-104 (logged at ORCH-0734 CLOSE):
--   * `signal_anchors` 32-anchor calibration scaffold is dropped (replacement:
--     city-scoped sampled-sync trial pipeline reading place_pool.is_servable).
--   * `seeding_cities` is the canonical cities authority (no separate cities
--     table exists; expanded role from seeding-target list).
--
-- Const #8 (subtract before add): drop signal_anchors first, then schema-evolve
-- place_intelligence_trial_runs for city-runs (UNIQUE + city_id + retry_count).
--
-- Spec: Mingla_Artifacts/specs/SPEC_ORCH-0734_CITY_RUNS.md §5.2 (verbatim).
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Backup snapshot — preserve calibration anchor history for 14-day audit
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public._archive_orch_0734_signal_anchors AS
SELECT * FROM public.signal_anchors;

COMMENT ON TABLE public._archive_orch_0734_signal_anchors IS
  'ORCH-0734 backup snapshot of signal_anchors taken on decommission. 14-day retention; drop on 2026-05-19 if no rollback signal surfaces.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Drop signal_anchors trigger (pre-table-drop)
-- ─────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_signal_anchors_set_updated_at ON public.signal_anchors;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Drop signal_anchors table — CASCADE removes 2 RLS policies + 2 indexes
--    + 2 FKs (labeled_by, place_pool_id) + 3 GRANTs auto-attached.
-- ─────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.signal_anchors CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Drop orphaned trigger function (does not auto-drop with table)
-- ─────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.tg_signal_anchors_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Relax place_intelligence_trial_runs.anchor_index CHECK constraint.
--    City-runs places have no anchor_index; legacy 32-anchor rows preserve
--    their {1,2} values as audit trail.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.place_intelligence_trial_runs
  DROP CONSTRAINT IF EXISTS place_intelligence_trial_runs_anchor_index_check;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Confirm anchor_index nullable (idempotent — should already be nullable
--    per baseline schema; explicit ALTER for forward-compat).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.place_intelligence_trial_runs
  ALTER COLUMN anchor_index DROP NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Add UNIQUE constraint on (run_id, place_pool_id) for idempotency.
--    Per F-8 verified row cardinality: 1 row per (run_id, place_pool_id);
--    all 16 signal evaluations stored in q2_response.evaluations JSONB.
--    Enables retry-safe UPSERT semantics for Gemini auto-retry-once and
--    defensive double-click-guard at start_run.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.place_intelligence_trial_runs
  ADD CONSTRAINT place_intelligence_trial_runs_run_place_unique
  UNIQUE (run_id, place_pool_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Add city_id column for run-level city scoping. FK to seeding_cities
--    (the canonical cities authority post-ORCH-0734).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES public.seeding_cities(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.place_intelligence_trial_runs.city_id IS
  'ORCH-0734: city scope of the run. Legacy pre-ORCH-0734 rows have NULL. New rows post-ORCH-0734 MUST have non-null city_id matching the place_pool.city_id of the row (I-TRIAL-RUN-SCOPED-TO-CITY).';

-- ─────────────────────────────────────────────────────────────────────────
-- 9. Add retry_count column for Gemini retry-once observability.
--    0 = first call succeeded; 1 = MALFORMED_FUNCTION_CALL retried once
--    successfully; ≥1 with status=failed = retry exhausted.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS retry_count smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.place_intelligence_trial_runs.retry_count IS
  'ORCH-0734: number of Gemini retries beyond the initial call. 0 = first call succeeded; 1 = MALFORMED_FUNCTION_CALL retried once successfully; ≥1 with status=failed = retry exhausted.';

-- ─────────────────────────────────────────────────────────────────────────
-- (Investigation F-3 was a false positive — `place_pool_city_id_fkey`
--  already exists with the exact definition we would have added:
--  `FOREIGN KEY (city_id) REFERENCES seeding_cities(id) ON DELETE SET NULL`.
--  Verified post-failure via pg_constraint at ORCH-0734 deploy time.
--  The investigator's information_schema.constraint_column_usage query
--  was filtered by referenced-table privileges and silently dropped the
--  row. Future investigations: prefer pg_constraint for FK existence checks.
--  Step 10 (defensive FK addition) is a no-op and removed.
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- 10. Document seeding_cities canonical authority (per F-4)
-- ─────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.seeding_cities IS
  'ORCH-0734 canonical cities authority. Originally scoped as the seeding-target list (cities the seeder calls Google Places for); expanded role post-ORCH-0734 to general cities authority used by city-scoped trial runs and other consumers. Picker filters EXISTS (place_pool WHERE city_id=this.id AND is_servable=true).';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK reference (operator runs within 14-day window if needed):
--
--   BEGIN;
--     -- Restore data from snapshot
--     CREATE TABLE public.signal_anchors AS
--       SELECT * FROM public._archive_orch_0734_signal_anchors;
--
--     -- Re-apply original PK + FKs + RLS + indexes per
--     -- baseline_squash_orch_0729.sql lines 9685-9698, 10968-10969,
--     -- 12215, 12219, 12691 (trigger), 13844-13850, 15147, 16007.
--     -- See baseline file for verbatim DDL.
--
--     -- Reverse the place_intelligence_trial_runs changes
--     ALTER TABLE public.place_intelligence_trial_runs
--       DROP CONSTRAINT place_intelligence_trial_runs_run_place_unique;
--     ALTER TABLE public.place_intelligence_trial_runs
--       DROP COLUMN city_id,
--       DROP COLUMN retry_count;
--     ALTER TABLE public.place_intelligence_trial_runs
--       ADD CONSTRAINT place_intelligence_trial_runs_anchor_index_check
--       CHECK ((anchor_index = ANY (ARRAY[1, 2])));
--
--   COMMIT;
--
-- (place_pool_city_id_fkey not touched at apply time — it pre-existed; no
--  rollback step needed for it.)
-- ─────────────────────────────────────────────────────────────────────────
