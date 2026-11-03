-- Issue #4250 adversarial: the drop must refuse, and change nothing, while any
-- profile still has is_admin = true. Rebuilds production's shape, sets the flag
-- on one profile, runs the real migration file with errors allowed, then proves
-- the column, the flag value and the old view all survived. Removing the guard
-- makes the column disappear and the final block raise.

\set ON_ERROR_STOP on

BEGIN;
DROP VIEW IF EXISTS public.profiles_with_segment;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;
CREATE VIEW public.profiles_with_segment
WITH (security_invoker = true) AS
SELECT p.*, public.derive_user_segment(p.id) AS segment
FROM public.profiles p;
INSERT INTO auth.users (id, email)
VALUES ('42500000-0000-4000-8000-000000004250', 'issue4250-adversarial@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, email)
VALUES ('42500000-0000-4000-8000-000000004250', 'issue4250-adversarial@example.test')
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET is_admin = true WHERE id = '42500000-0000-4000-8000-000000004250';
COMMIT;

\set ON_ERROR_STOP off
\ir ../20280317004250_issue_4250_drop_profiles_is_admin.sql
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_admin'
  ) THEN
    RAISE EXCEPTION 'is_admin was dropped while a profile still had it set';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '42500000-0000-4000-8000-000000004250' AND is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION 'the flagged profile lost its is_admin value';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles_with_segment'
      AND column_name = 'is_admin'
  ) THEN
    RAISE EXCEPTION 'the refused run still rebuilt profiles_with_segment';
  END IF;
END $$;

-- Leave the database as the replay left it.
BEGIN;
DELETE FROM public.profiles WHERE id = '42500000-0000-4000-8000-000000004250';
DELETE FROM auth.users WHERE id = '42500000-0000-4000-8000-000000004250';
COMMIT;
\ir ../20280317004250_issue_4250_drop_profiles_is_admin.sql
