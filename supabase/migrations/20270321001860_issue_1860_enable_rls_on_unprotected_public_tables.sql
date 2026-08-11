-- ===========================================================================
-- Issue #1860 — turn row-level security ON for the public tables that have none.
--
-- WHY THIS IS THE WHOLE FIX
-- -------------------------
-- Row-level security is the only effective constraint on this schema. The
-- baseline squash carries the platform-standard `ALTER DEFAULT PRIVILEGES … IN
-- SCHEMA public GRANT ALL ON TABLES` for the standard roles (#1827 documents the
-- mechanism), so a table's own GRANT lines cannot narrow what it already holds.
-- A table with `relrowsecurity = false` therefore carries no constraint at all.
--
-- ENABLE WITH NO POLICY IS THE CORRECT END STATE
-- ----------------------------------------------
-- With RLS enabled and zero policies, `anon` and `authenticated` match no rows on
-- any command. `service_role` and `postgres` are unaffected — both carry
-- `rolbypassrls`, which is how every live reader of these tables reaches them.
-- Verified before writing this migration: the only routes to any table below are
-- SECURITY DEFINER functions owned by `postgres` and Edge Functions holding the
-- service-role key. There are no triggers, no views, and no first-party client
-- reads. Nothing here changes for a legitimate caller.
--
-- FORCE IS DELIBERATELY NOT USED
-- ------------------------------
-- `FORCE ROW LEVEL SECURITY` exists to subject a table's OWNER to RLS. The owner
-- here is `postgres`, which is exactly the role the SECURITY DEFINER readers run
-- as. Nothing below needs FORCE, and adding it would move a working feature one
-- privilege change away from breaking. Do not add it without a reader audit.
--
-- `public.spatial_ref_sys` IS DELIBERATELY EXCLUDED
-- -------------------------------------------------
-- It is owned by the PostGIS extension and not by us — the ALTER would fail on a
-- role we do not hold — and it carries published coordinate-system reference
-- data with no confidentiality value. It is the single documented exemption, and
-- that exemption is asserted in exactly one reviewed place,
-- `scripts/audit/rls-allowlist.json`, which the #1860 gate pins to that one name.
-- Do not "fix" spatial_ref_sys here.
--
-- NOTHING IS DROPPED HERE
-- -----------------------
-- Most of these tables are dead and should eventually be dropped. A drop is
-- destructive and irreversible, it is the operator's call, and it is tracked
-- separately. Enabling RLS is non-destructive and trivially reversible, which is
-- why it is the first move.
--
-- Enforcement of the resulting rule:
--   .github/scripts/strict-grep/issue-1860-public-tables-rls-enabled.mjs  (static, every PR)
--   supabase/migrations/__tests__/issue_1860_public_rls_coverage.test.sql (live catalog, CI container)
-- ===========================================================================

BEGIN;

ALTER TABLE "public"."_archive_orch_0700_doomed_columns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."_archive_orch_0734_signal_anchors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."_backup_friends"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."_backup_messages"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."_backup_profiles"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."_backup_user_sessions"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."_deprecated_profiles_is_admin_backup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."_orch_0588_dead_cards_backup"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."_orch_0588_dead_stops_backup"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."seed_map_presence"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."used_trial_phones"                 ENABLE ROW LEVEL SECURITY;

-- The twelfth. `_archive_orch_0898_board_messages_pre_migration` is created by
-- migration 20260624000000 and never dropped by one, so a fresh replay of the
-- chain — which is what CI runs — DOES have it, with RLS off. It is absent from
-- the production database, where it was removed outside the migration chain.
-- `IF EXISTS` is the only difference between the two schemas being a NOTICE and
-- being a failed deploy; it is not a licence for the other eleven, which are
-- unguarded on purpose so that a missing one fails loudly.
ALTER TABLE IF EXISTS "public"."_archive_orch_0898_board_messages_pre_migration"
  ENABLE ROW LEVEL SECURITY;

-- The baseline squash documents this table as "No RLS = service-role only
-- access". That sentence was the belief this issue disproved: with the schema
-- default grant in place, no RLS meant no constraint, not service-role only.
-- Correcting it here so the next reader is not reassured by it.
COMMENT ON TABLE "public"."used_trial_phones" IS
  'Phone hashes (SHA-256 of E.164) that have used a free trial. Survives account deletion to prevent trial abuse via re-signup. Reached only by the SECURITY DEFINER functions phone_has_used_trial() and record_trial_phone(); RLS is ENABLED with no policy (issue #1860), so anon and authenticated match no rows.';

COMMIT;
