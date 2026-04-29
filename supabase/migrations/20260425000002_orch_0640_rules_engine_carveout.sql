-- ORCH-0640 ch02 — Rules Engine carve-out (DEC-045)
-- Separates Rules Engine rows from pure-AI rows, renames the two surviving tables
-- to reflect their role (rules_runs + rules_run_results), drops ai_validation_batches
-- entirely. Preserves all 12 admin_rules_* RPC callers (they are rewired in ch05).
--
-- Pre-condition: GATE-A verified ORCH-0634 live. card_pool already inert post-ORCH-0634.
-- Post-condition: ai_validation_* tables no longer exist; rules_runs + rules_run_results present.

BEGIN;

-- Step 1: Delete pure-AI rows (those never tied to a rules-version)
DELETE FROM public.ai_validation_jobs WHERE rules_version_id IS NULL;
-- ai_validation_results cascade-deletes via existing FK ai_validation_results.job_id CASCADE

-- Step 2: Drop ai_validation_batches entirely (pure AI, no Rules coupling)
-- Drops FK from ai_validation_results.batch_id (SET NULL) — result rows survive
DROP TABLE public.ai_validation_batches CASCADE;

-- Step 3: Rename the two surviving tables
ALTER TABLE public.ai_validation_jobs RENAME TO rules_runs;
ALTER TABLE public.ai_validation_results RENAME TO rules_run_results;

-- Step 4: Rename FK constraints for clarity
ALTER TABLE public.rules_runs
  RENAME CONSTRAINT ai_validation_jobs_city_id_fkey TO rules_runs_city_id_fkey;
ALTER TABLE public.rules_runs
  RENAME CONSTRAINT ai_validation_jobs_rules_version_id_fkey TO rules_runs_rules_version_id_fkey;
ALTER TABLE public.rules_run_results
  RENAME CONSTRAINT ai_validation_results_job_id_fkey TO rules_run_results_job_id_fkey;
ALTER TABLE public.rules_run_results
  RENAME CONSTRAINT ai_validation_results_place_id_fkey TO rules_run_results_place_id_fkey;
ALTER TABLE public.rules_run_results
  RENAME CONSTRAINT ai_validation_results_rule_set_version_id_fkey TO rules_run_results_rule_set_version_id_fkey;
-- batch_id FK already dropped when ai_validation_batches dropped

-- Step 5: Rename indexes (idx_avj_*, idx_avr_* → idx_rr_*, idx_rrr_*)
ALTER INDEX idx_avj_city_lock           RENAME TO idx_rr_city_lock;
ALTER INDEX idx_avj_rules_version       RENAME TO idx_rr_rules_version;
ALTER INDEX idx_avj_status              RENAME TO idx_rr_status;
ALTER INDEX idx_avr_confidence          RENAME TO idx_rrr_confidence;
ALTER INDEX idx_avr_decision            RENAME TO idx_rrr_decision;
ALTER INDEX idx_avr_job_decision        RENAME TO idx_rrr_job_decision;
ALTER INDEX idx_avr_job_id              RENAME TO idx_rrr_job_id;
ALTER INDEX idx_avr_place_id            RENAME TO idx_rrr_place_id;
ALTER INDEX idx_avr_place_id_created_at RENAME TO idx_rrr_place_id_created_at;
ALTER INDEX idx_avr_review_queue        RENAME TO idx_rrr_review_queue;
ALTER INDEX idx_avr_rule_set_version    RENAME TO idx_rrr_rule_set_version;

-- PK indexes auto-renamed by PostgreSQL when tables rename; no action needed

-- Step 6: Rename RLS policies
ALTER POLICY "admin_full_access_ai_validation_jobs" ON public.rules_runs
  RENAME TO "admin_full_access_rules_runs";
ALTER POLICY "admin_full_access_ai_validation_results" ON public.rules_run_results
  RENAME TO "admin_full_access_rules_run_results";

COMMENT ON TABLE public.rules_runs IS
  'ORCH-0640: renamed from ai_validation_jobs. Pure-AI rows (rules_version_id IS NULL) purged
   during this migration. This table now stores Rules Engine run history ONLY.';
COMMENT ON TABLE public.rules_run_results IS
  'ORCH-0640: renamed from ai_validation_results. Stores per-place results of Rules Engine
   runs. Orphaned rows (job_id pointing at purged pure-AI jobs) were already cascade-deleted.';

COMMIT;
