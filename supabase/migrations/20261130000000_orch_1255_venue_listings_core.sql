-- ===========================================================================
-- META-ORCH-1255 [multi-venue first-class creation] — M1: venue_listings core
-- ---------------------------------------------------------------------------
-- SPEC (binding): Mingla_Artifacts/specs/SPEC_META-ORCH-1255_MULTI_VENUE_FIRST_CLASS.md
-- §4.A.2 (commit b236bfaf9). Seth decision D-1: per-venue rows under ONE brand;
-- the hidden-brand-per-venue creation path (F-1) is decommissioned in M4.
--
-- This migration creates the first-class venue row:
--   * public.venue_listings — identity + claim lifecycle PER VENUE. The claim
--     state machine on this row is EXACTLY the F-§Pipeline machine (D-4):
--     none → pending_review → verified/rejected; pending_review +
--     claim_follow_up_at = needs-fixes; verified → suspended/revoked;
--     resubmit → pending_review. No new states, no new transitions.
--   * RLS: brand-member read + admin read ONLY. NO anon grant (public reads go
--     through venue_public_view, M4). NO client write policies — ALL writes go
--     through SECURITY DEFINER RPCs (M4) or service-role edge functions.
--     RLS-RETURNING-OWNER-GAP: not reachable — the table has no client INSERT
--     path; the create RPC is SECURITY DEFINER and returns only the new id.
--   * _orch1255_venue_belongs_to_brand() — the shared brand-match integrity
--     trigger M2/M3 attach to every (brand_id, venue_id) table: a manager of
--     brand X must NOT be able to point a row at brand Y's venue_id.
--
-- I-PROPOSED-1255-VENUE-APPROVAL-PER-VENUE-ROW (DRAFT): the unit of venue admin
-- review is a venue_listings row; claim lifecycle columns live HERE, not on
-- brands. brands.claim_status / brands.place_pool_id become legacy-inert.
--
-- Prefix scan re-run at IMPLEMENT 2026-07-02 (COMMS-0051 discipline):
-- origin/main max = 20261129000000; every worktree under ~/Desktop/mingla-orchs/
-- and every remote branch scanned — 20261130000000 free. Remote read-only probe
-- 2026-07-02 (MCP execute_sql): 0 venue-bound brands, 0 pipeline rows, 0 rows in
-- every ops table (F-8 holds).
--
-- Apply via the Supabase Management API from MERGED main at CLOSE (blind
-- `db push` UNSAFE — migration-history drift). Do NOT apply from the worktree.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The venue row (SPEC §4.A.2, exact DDL).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venue_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]{1,32}$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  address text NULL,
  city text NULL,
  country_code text NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  venue_category text NOT NULL CHECK (venue_category IN ('restaurant','play','creative_and_arts')),
  google_place_id text NULL,
  contact_email text NULL,
  contact_phone text NULL,
  cover_media_url text NULL,
  cover_media_type text NULL CHECK (cover_media_type IS NULL OR cover_media_type IN ('image','video','gif')),
  claim_status text NOT NULL DEFAULT 'none'
    CHECK (claim_status IN ('none','pending_review','verified','rejected','suspended','revoked')),
  claim_follow_up_at timestamptz NULL,
  rejection_reason text NULL,
  claim_decision_emailed_at timestamptz NULL,
  marked_called_at timestamptz NULL,
  marked_called_by uuid NULL,
  duplicate_of_venue_id uuid NULL REFERENCES public.venue_listings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_listings_brand_slug_uniq UNIQUE (brand_id, slug)
);

-- One listing per place GLOBALLY — preserves the 1:1 place↔listing semantics
-- the consumer resolvers and admin suspend rely on (inventory #14).
CREATE UNIQUE INDEX IF NOT EXISTS venue_listings_place_uniq
  ON public.venue_listings (place_pool_id) WHERE place_pool_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS venue_listings_brand_idx ON public.venue_listings (brand_id);
CREATE INDEX IF NOT EXISTS venue_listings_claim_status_idx ON public.venue_listings (claim_status);

COMMENT ON TABLE public.venue_listings IS
  'META-ORCH-1255 (D-1): first-class venue row under ONE brand — identity + '
  'claim lifecycle PER VENUE. The claim machine is byte-identical to the old '
  'brands.claim_status machine (D-4): none→pending_review→verified/rejected; '
  'pending_review+claim_follow_up_at=needs-fixes; verified→suspended/revoked; '
  'resubmit→pending_review. brands.claim_status/brands.place_pool_id are '
  'legacy-inert — venue flows NEVER write them again '
  '(I-PROPOSED-1255-VENUE-APPROVAL-PER-VENUE-ROW). Writes are RPC/service-role '
  'ONLY — do NOT add client INSERT/UPDATE policies.';
COMMENT ON COLUMN public.venue_listings.slug IS
  'META-ORCH-1255: per-brand venue slug, CHECK mirrors biz_create_venue_brand_authoring '
  '(1186-A line 184, ''^[a-z0-9]{1,32}$'') — venue slugs reuse the existing generator. '
  'Public route: /b/{brandSlug}/v/{venueSlug} (D-2).';

-- ---------------------------------------------------------------------------
-- 2. Standard per-table updated_at trigger (house shape of
--    tg_venue_tables_set_updated_at, 20261003000000).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_venue_listings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS venue_listings_set_updated_at ON public.venue_listings;
CREATE TRIGGER venue_listings_set_updated_at
  BEFORE UPDATE ON public.venue_listings
  FOR EACH ROW EXECUTE FUNCTION public.tg_venue_listings_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS (SPEC §4.A.2, exact policies). Read-only for clients:
--    brand member (read helper) + admin. NO anon grant. NO write policies —
--    every write path is a SECURITY DEFINER RPC or the service role.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venue_listings brand member can read" ON public.venue_listings;
CREATE POLICY "venue_listings brand member can read" ON public.venue_listings
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "venue_listings admin can read" ON public.venue_listings;
CREATE POLICY "venue_listings admin can read" ON public.venue_listings
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

GRANT SELECT ON public.venue_listings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_listings TO service_role;
-- NO grant to anon. NO INSERT/UPDATE/DELETE policies for authenticated:
-- ALL writes go through SECURITY DEFINER RPCs or service-role edge functions.
-- (An authenticated member must be unable to flip their own claim_status to
-- 'verified' — proven by supabase/migrations/__tests__/orch_1255_public_view_anon.test.sql
-- and orch_1255_venue_listings.test.sql.)
REVOKE ALL ON public.venue_listings FROM anon;

-- ---------------------------------------------------------------------------
-- 4. Brand-match integrity trigger, shared by the M2/M3 (brand_id, venue_id)
--    tables (SPEC §4.A.2, exact body). Closes the cross-brand splice the
--    per-brand RLS alone cannot see: brand-X manager (passes X's WITH CHECK)
--    pointing a row at brand Y's venue_id → 'venue_brand_mismatch'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._orch1255_venue_belongs_to_brand()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.venue_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_listings v
     WHERE v.id = NEW.venue_id AND v.brand_id = NEW.brand_id) THEN
    RAISE EXCEPTION 'venue_brand_mismatch';
  END IF;
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION public._orch1255_venue_belongs_to_brand() IS
  'META-ORCH-1255 M1: BEFORE INSERT OR UPDATE guard on every table carrying '
  '(brand_id, venue_id) — the referenced venue must belong to the row''s brand '
  '(I-PROPOSED-1255-PER-VENUE-OPS-NO-SHARED-INVENTORY). '
  'Raises venue_brand_mismatch on a cross-brand splice.';

COMMIT;

NOTIFY pgrst, 'reload schema';
