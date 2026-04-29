-- ORCH-0686 — Align photo_backfill_runs.mode CHECK constraint with ORCH-0678 enum rename.
--
-- Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md
-- Spec:          Mingla_Artifacts/specs/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md
--
-- Background: ORCH-0598.11 (20260424200002) added a CHECK constraint allowing only
--   ('initial', 'refresh_servable'). ORCH-0678 (20260430000001) renamed the
--   BackfillMode enum value 'initial' -> 'pre_photo_passed' in the edge function and
--   admin UI but did NOT amend the constraint. Every create_run since ORCH-0678 deploy
--   has hit SQLSTATE 23514. 14,401 pre-photo-approved places stranded.
--
-- This migration:
--   1. Drops the stale constraint.
--   2. Re-adds it with all three permitted values: 'initial' (legacy alias for 18
--      historical terminal-state rows), 'pre_photo_passed' (current default), and
--      'refresh_servable' (Bouncer-approved maintenance).
--   3. Flips the column DEFAULT from 'initial' to 'pre_photo_passed' so any out-of-band
--      insert (psql, dashboard, scripts) picks the current pipeline mode.
--   4. Updates the column comment to reflect the rewritten I-PHOTO-FILTER-EXPLICIT
--      invariant.
--
-- I-PHOTO-FILTER-EXPLICIT (rewritten):
--   photo_backfill_runs.mode is one of:
--     'pre_photo_passed' — current default; first-pass after pre-photo Bouncer; gates
--                          eligibility on place_pool.passes_pre_photo_check.
--     'refresh_servable' — Bouncer-approved maintenance; gates on place_pool.is_servable.
--     'initial'          — LEGACY alias; historical terminal-state rows only; do not
--                          write from new code.
--   The TypeScript BackfillMode union and this CHECK clause MUST stay in sync.
--   Enforced by CI gate I-DB-ENUM-CODE-PARITY.
--
-- Apply via: supabase db push (NEVER via mcp__supabase__apply_migration).
-- Idempotent. Safe to re-run.

BEGIN;

-- 1. Drop the stale constraint (idempotent — IF EXISTS guards re-run).
ALTER TABLE public.photo_backfill_runs
  DROP CONSTRAINT IF EXISTS photo_backfill_runs_mode_check;

-- 2. Re-add with all three permitted values.
ALTER TABLE public.photo_backfill_runs
  ADD CONSTRAINT photo_backfill_runs_mode_check
  CHECK (mode IN ('initial', 'pre_photo_passed', 'refresh_servable'));

-- 3. Flip column default to current pipeline mode.
ALTER TABLE public.photo_backfill_runs
  ALTER COLUMN mode SET DEFAULT 'pre_photo_passed';

-- 4. Update column comment to reflect rewritten invariant.
COMMENT ON COLUMN public.photo_backfill_runs.mode IS
  'ORCH-0686 (supersedes ORCH-0598.11): explicit eligibility filter. '
  'pre_photo_passed = current default; gates on passes_pre_photo_check. '
  'refresh_servable = Bouncer-approved maintenance; gates on is_servable. '
  'initial = LEGACY alias for historical terminal-state rows; do not write from new code. '
  'I-PHOTO-FILTER-EXPLICIT. CI gate: I-DB-ENUM-CODE-PARITY.';

-- 5. Post-condition assertion: fail loud if constraint or default is missing/incorrect.
DO $$
DECLARE
  v_constraint_def text;
  v_column_default text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_constraint_def
  FROM pg_constraint
  WHERE conname = 'photo_backfill_runs_mode_check'
    AND conrelid = 'public.photo_backfill_runs'::regclass;

  IF v_constraint_def IS NULL THEN
    RAISE EXCEPTION 'ORCH-0686: photo_backfill_runs_mode_check constraint missing post-migration';
  END IF;

  IF v_constraint_def NOT LIKE '%pre_photo_passed%'
     OR v_constraint_def NOT LIKE '%refresh_servable%'
     OR v_constraint_def NOT LIKE '%initial%' THEN
    RAISE EXCEPTION 'ORCH-0686: photo_backfill_runs_mode_check missing one of three required values. Current def: %', v_constraint_def;
  END IF;

  SELECT column_default INTO v_column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'photo_backfill_runs'
    AND column_name = 'mode';

  IF v_column_default IS NULL OR v_column_default NOT LIKE '%pre_photo_passed%' THEN
    RAISE EXCEPTION 'ORCH-0686: photo_backfill_runs.mode default not flipped to pre_photo_passed. Current default: %', v_column_default;
  END IF;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, emergency only — execute if production breaks)
-- ═══════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- ALTER TABLE public.photo_backfill_runs DROP CONSTRAINT IF EXISTS photo_backfill_runs_mode_check;
-- ALTER TABLE public.photo_backfill_runs
--   ADD CONSTRAINT photo_backfill_runs_mode_check
--   CHECK (mode IN ('initial', 'refresh_servable'));
-- ALTER TABLE public.photo_backfill_runs ALTER COLUMN mode SET DEFAULT 'initial';
-- COMMIT;
-- WARNING: Rolling back will re-break create_run for any post-ORCH-0678 attempt.
-- Only roll back if a downstream consumer is found that can't tolerate the new value.
