-- ============================================================
-- ORCH-1164 [#507 regression recovery — anon web TRIP page blank]
--
-- Root cause (proven live, 2026-06-18): #507 (ORCH-1138 Leg 3, 13c3ec4c5)
-- added theme_color/theme_font/theme_animation to the DIRECT anon
-- `supabase.from("brands").select(...)` on the public trip read path
-- (mingla-business/src/hooks/usePublicTripBySlug.ts). The `anon` PostgreSQL
-- role has only COLUMN-level SELECT on `public.brands` (table-level SELECT is
-- false) and those three theme columns were NEVER granted to anon. PostgreSQL
-- evaluates column privileges BEFORE RLS, so any SELECT listing one of those
-- columns aborts the WHOLE statement with `42501 permission denied for table
-- brands` (HTTP 401). The /t/{brandSlug}/{tripSlug} page therefore fails to
-- render for every logged-out buyer → ALL anon web trip sales blocked.
--
-- The anon EVENT + EXPERIENCE web pages are FINE: they read brand theme via
-- the anon-safe security-definer `business_public_events_view`
-- (brand_theme_color/brand_theme_font/brand_theme_animation) per the COMMS-0009
-- contract. Only the trip hook read theme columns directly off `brands`.
--
-- Fix (this migration = the belt): extend the per-column anon GRANT to the
-- three theme columns, matching the ORCH-0879 column-grant template
-- (20260617000000_orch_0879_anon_brand_cover_grant.sql) that added
-- cover_media_url/cover_media_type. ORCH-1164 ALSO moves the trip hook's theme
-- read onto business_public_events_view (the suspenders), so the page no longer
-- depends on this grant — but the grant is the minimal, immediate restore and
-- aligns the brands-table column grants with the already-public view fields.
--
-- Constitutional / safety check:
--   - Does NOT widen RLS. The existing "Public can read brands with public
--     events" + "Public can read non-deleted brands" SELECT policies still
--     gate WHICH brand rows anon can read. This migration only grants
--     COLUMN-level SELECT on rows the policy already admits.
--   - Introduces NO new data exposure: theme_color/theme_font/theme_animation
--     are ALREADY exposed to anon via business_public_events_view.brand_theme_*
--     (security-definer view, anon-readable). This only aligns the brands-table
--     column grant with the already-public view fields.
--   - Forward-only, additive. No DROP, no REVOKE, no policy change, no other
--     column grants touched.
-- ============================================================

BEGIN;

GRANT SELECT (theme_color, theme_font, theme_animation) ON public.brands TO anon;

-- Self-verification probe: assert the three grants are present (fails the
-- migration if any grant did not take). Mirrors ORCH-0879's probe.
DO $$
DECLARE
  grant_count int;
BEGIN
  SELECT count(*) INTO grant_count
  FROM information_schema.column_privileges
  WHERE table_schema = 'public'
    AND table_name = 'brands'
    AND grantee = 'anon'
    AND privilege_type = 'SELECT'
    AND column_name IN ('theme_color', 'theme_font', 'theme_animation');
  IF grant_count != 3 THEN
    RAISE EXCEPTION 'ORCH-1164 migration: expected 3 anon SELECT column grants on brands (theme_color, theme_font, theme_animation), got %', grant_count;
  END IF;
  RAISE NOTICE 'ORCH-1164 migration complete: anon now has SELECT on brands.theme_color + theme_font + theme_animation';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
