-- ORCH-0588 Slice 1 — Bouncer v2 columns on place_pool
-- Parallel to existing ai_approved (no replacement in Slice 1).
-- Owned by run-bouncer edge fn only. Constitutional #2 — single owner per truth.

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS is_servable boolean,
  ADD COLUMN IF NOT EXISTS bouncer_reason text,
  ADD COLUMN IF NOT EXISTS bouncer_validated_at timestamptz;

CREATE INDEX IF NOT EXISTS place_pool_is_servable_idx
  ON public.place_pool (is_servable)
  WHERE is_servable = true;

CREATE INDEX IF NOT EXISTS place_pool_bouncer_validated_at_idx
  ON public.place_pool (bouncer_validated_at)
  WHERE bouncer_validated_at IS NOT NULL;

COMMENT ON COLUMN public.place_pool.is_servable IS
  'ORCH-0588 Bouncer v2: deterministic gate. Parallel to ai_approved during Slice 1+. Owned by run-bouncer edge fn only.';
COMMENT ON COLUMN public.place_pool.bouncer_reason IS
  'ORCH-0588: rejection reason in format B<N>:<token>. NULL when is_servable=true. Multi-reason concatenated with ;';
COMMENT ON COLUMN public.place_pool.bouncer_validated_at IS
  'ORCH-0588: timestamp of last run-bouncer pass. NULL = never bouncered.';

-- ROLLBACK:
-- DROP INDEX IF EXISTS public.place_pool_bouncer_validated_at_idx;
-- DROP INDEX IF EXISTS public.place_pool_is_servable_idx;
-- ALTER TABLE public.place_pool
--   DROP COLUMN IF EXISTS bouncer_validated_at,
--   DROP COLUMN IF EXISTS bouncer_reason,
--   DROP COLUMN IF EXISTS is_servable;
