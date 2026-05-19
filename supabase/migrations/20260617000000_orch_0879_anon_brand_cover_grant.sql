-- ============================================================
-- ORCH-0879 [Public trip page anon cannot read brand cover_media_url]
--
-- Root cause: the baseline grants enumerate per-column SELECT for the `anon`
-- PostgreSQL role on `public.brands` — 16 columns granted (id, account_id,
-- name, slug, description, profile_photo_url, contact_email, contact_phone,
-- social_links, custom_links, display_attendee_count, default_currency,
-- created_at, updated_at, deleted_at, plus the FOR SELECT POLICY check).
--
-- `cover_media_url` + `cover_media_type` were added later (Cycle 17e-A
-- pre-load migration `20260506000000_brand_kind_address_cover_hue_media.sql`)
-- but NEVER added to the anon column-grant list. PostgreSQL rejects the
-- entire SELECT with `42501 permission denied for table brands` the moment
-- one of those columns appears in the select list, even though RLS would
-- otherwise admit the row.
--
-- Symptom (ORCH-0879 INTAKE): anon visitors to
--   /t/<brandSlug>/<tripSlug>            (mingla-business app/t/[brandSlug]/[tripSlug].tsx)
--   /checkout-trip/<tripEventId>         (mingla-business app/checkout-trip/[tripEventId]/*)
-- see "Couldn't load trip / Check your connection and try again" because
-- `usePublicTripBySlug` (src/hooks/usePublicTripBySlug.ts:64) and
-- `getPublicTripById` (src/services/publicEventsService.ts:629) both SELECT
-- `cover_media_url` from brands as part of resolving the host brand for
-- display in TripPreview / TripCheckoutFlow.
--
-- Fix: extend the per-column anon GRANT to cover_media_url + cover_media_type
-- (the two anon-displayable cover-media columns on brands). This matches the
-- intent of the original column-grant list — brand profile_photo_url is
-- already anon-granted; cover_media_url is the brand-page hero counterpart
-- and is consumed identically in public surfaces.
--
-- Out of scope for this migration (will be filed as separate ORCH if needed):
--   - `kind`, `hue`, `gradient_*`, `address_*` columns also added in the
--     same later migration; not currently selected by any anon-facing code
--     path. No symptom yet, no preemptive grant.
--
-- Constitutional check:
--   - Does NOT widen RLS — the `Public can read brands with public events`
--     SELECT policy already restricts which brand ROWS anon can read
--     (brands that have at least one visibility='public' AND
--     status IN ('scheduled','live') event). This migration only grants
--     COLUMN-level access on rows the policy already admits.
--   - Does NOT introduce data leak — cover_media_url for a published brand
--     is already displayed on /b/<slug> via `business_public_brands_view`
--     which has full row exposure to anon since ORCH-0767.
-- ============================================================

BEGIN;

GRANT SELECT (cover_media_url, cover_media_type) ON public.brands TO anon;

-- Self-verification probe: assert the two grants are present.
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
    AND column_name IN ('cover_media_url', 'cover_media_type');
  IF grant_count != 2 THEN
    RAISE EXCEPTION 'ORCH-0879 migration: expected 2 anon SELECT column grants on brands (cover_media_url, cover_media_type), got %', grant_count;
  END IF;
  RAISE NOTICE 'ORCH-0879 migration complete: anon now has SELECT on brands.cover_media_url + cover_media_type';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
