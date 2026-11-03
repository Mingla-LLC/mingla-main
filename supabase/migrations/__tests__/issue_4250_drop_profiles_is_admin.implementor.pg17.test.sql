-- Issue #4250: the is_admin drop runs against the shape production has today.
--
-- A fresh replay already lost profiles.is_admin in 20260922000000, so this
-- suite first rebuilds production's shape (the column back, and the segment
-- view recreated the way 20260922000000 would, picking up this project's
-- default ALL grants), then runs the real migration file twice. Without the
-- #4250 migration the \ir fails; without its REVOKE the grant block raises.

\set ON_ERROR_STOP on

BEGIN;
DROP VIEW IF EXISTS public.profiles_with_segment;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;
CREATE VIEW public.profiles_with_segment
WITH (security_invoker = true) AS
SELECT p.*, public.derive_user_segment(p.id) AS segment
FROM public.profiles p;
GRANT SELECT ON public.profiles_with_segment TO authenticated;
COMMIT;

DO $$
BEGIN
  IF NOT has_table_privilege('anon', 'public.profiles_with_segment', 'INSERT') THEN
    RAISE EXCEPTION 'setup did not reproduce the default ALL grant the June file relied on';
  END IF;
END $$;

\ir ../20280317004250_issue_4250_drop_profiles_is_admin.sql
-- Re-running is a no-op apart from rebuilding the view.
\ir ../20280317004250_issue_4250_drop_profiles_is_admin.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_admin'
  ) THEN
    RAISE EXCEPTION 'profiles.is_admin still exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.profiles_with_segment'::regclass
      AND 'security_invoker=true' = ANY (reloptions)
  ) THEN
    RAISE EXCEPTION 'profiles_with_segment is not security_invoker';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles_with_segment'
      AND column_name IN ('is_admin', 'explorer_deleted_at')
  ) THEN
    RAISE EXCEPTION 'profiles_with_segment exposes is_admin or explorer_deleted_at';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles_with_segment'
      AND column_name = 'segment'
  ) THEN
    RAISE EXCEPTION 'profiles_with_segment lost its segment column';
  END IF;

  IF has_table_privilege('anon', 'public.profiles_with_segment', 'INSERT')
     OR has_table_privilege('anon', 'public.profiles_with_segment', 'UPDATE')
     OR has_table_privilege('anon', 'public.profiles_with_segment', 'DELETE')
     OR has_table_privilege('authenticated', 'public.profiles_with_segment', 'INSERT')
     OR has_table_privilege('authenticated', 'public.profiles_with_segment', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.profiles_with_segment', 'DELETE') THEN
    RAISE EXCEPTION 'profiles_with_segment is writable by a client role (#1856)';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.profiles_with_segment', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated can no longer read profiles_with_segment';
  END IF;
END $$;
