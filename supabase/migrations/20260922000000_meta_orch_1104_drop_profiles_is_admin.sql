-- META-ORCH-1104 D5.1 Step B — OPERATOR-GATED drop of the dead profiles.is_admin column.
--
-- ⚠ DO NOT APPLY WITH THE FEATURE MIGRATION (20260921000000_meta_orch_1104_support_foundation.sql).
-- Apply ONLY after Seth confirms Phase 0 has soaked with NO is_admin readers, on his
-- explicit go. The feature migration SNAPSHOTTED the column into
-- public._deprecated_profiles_is_admin_backup, so this drop is reversible:
--   ALTER TABLE public.profiles ADD COLUMN is_admin boolean;
--   UPDATE public.profiles p SET is_admin = b.is_admin
--     FROM public._deprecated_profiles_is_admin_backup b WHERE b.profile_id = p.id;
--
-- Remote probe 2026-06-08: profiles.is_admin = 38 rows / 0 true → blast radius ~0
-- (Lane B §3/§4.2: 0 writers / 0 readers). A strict-grep gate bans new readers.
--
-- session_participants.is_admin is a DIFFERENT column and is NOT affected.

ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_admin;
