-- #4490: internal demo venues remain directly previewable but never enter Explorer.
--
-- Invariant I-4490-DEMO-PLACE-NEVER-SERVABLE:
--   place_pool.demo_only = true implies place_pool.is_servable is not true.
-- The existing single row trigger that owns the deleted-place serving invariant
-- also owns this rule, so scorer, bouncer and refresh writes cannot resurrect a
-- demo place into discovery.

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS demo_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.place_pool.demo_only IS
  'Issue #4490: internal demo place. It may have a direct preview, but it must never be servable in Explorer.';

CREATE OR REPLACE FUNCTION public._orch1073_enforce_deleted_unservable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.demo_only IS TRUE THEN
    NEW.is_servable := false;
  END IF;

  IF NEW.deleted_at IS NOT NULL THEN
    NEW.is_active := false;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._orch1073_enforce_deleted_unservable()
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.place_pool
  DROP CONSTRAINT IF EXISTS place_pool_demo_only_unservable;

ALTER TABLE public.place_pool
  ADD CONSTRAINT place_pool_demo_only_unservable
  CHECK (NOT demo_only OR is_servable IS NOT TRUE)
  NOT VALID;

ALTER TABLE public.place_pool
  VALIDATE CONSTRAINT place_pool_demo_only_unservable;

COMMIT;

NOTIFY pgrst, 'reload schema';
