-- META-ORCH-1104 D5.1 Step B — OPERATOR-GATED drop of the dead profiles.is_admin column.
--
-- ⚠ DO NOT APPLY WITH THE FEATURE MIGRATION (20260921000000_meta_orch_1104_support_foundation.sql).
-- Apply ONLY after Seth confirms Phase 0 has soaked with NO is_admin readers, on his
-- explicit go. The feature migration SNAPSHOTTED the column into
-- public._deprecated_profiles_is_admin_backup, so this drop is reversible:
--   ALTER TABLE public.profiles ADD COLUMN is_admin boolean;
--   UPDATE public.profiles p SET is_admin = b.is_admin
--     FROM public._deprecated_profiles_is_admin_backup b WHERE b.profile_id = p.id;
--   -- then re-run the view recreate below.
--
-- Remote probe 2026-06-08: profiles.is_admin = 38 rows / 0 true → blast radius ~0
-- (Lane B §3/§4.2: 0 writers / 0 readers). A strict-grep gate bans new readers.
--
-- session_participants.is_admin is a DIFFERENT column and is NOT affected.
--
-- The profiles_with_segment view (20260921000000 §2.4) selects `p.*`, so it depends on
-- is_admin. Drop the view first, drop the column, then recreate the view (now `p.*`
-- excludes the dropped column). Without this, the bare DROP COLUMN fails:
--   "cannot drop column is_admin ... view profiles_with_segment depends on column".

BEGIN;

DROP VIEW IF EXISTS public.profiles_with_segment;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_admin;

-- Recreate the segment view identically (security_invoker; inherits caller profiles RLS).
CREATE OR REPLACE VIEW public.profiles_with_segment
WITH (security_invoker = true) AS
SELECT p.*, public.derive_user_segment(p.id) AS segment
FROM public.profiles p;
GRANT SELECT ON public.profiles_with_segment TO authenticated;

COMMIT;
