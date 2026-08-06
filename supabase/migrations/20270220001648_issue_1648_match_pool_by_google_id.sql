-- Issue #1648 — look a place up in our own directory by its Google place id.
--
-- Venue onboarding's gate searches by NAME. When that misses — a trading name,
-- a rename, a chain branch, or the brand pressing "Continue without a match" —
-- they land in create-from-scratch, type the exact street address of a place we
-- hold, and we ignore it. This is the lookup that closes that door.
--
-- WHY AN EXACT KEY AND NOT PROXIMITY. Measured on production: every existing
-- venue has between 2 and 18 ACTIVE pool rows within ~130 m (Academy Street
-- Bistro: 18). Distance returns a shortlist, never an identity. `place_pool` is
-- already ~100% Google-keyed (88,362 of 88,367 active rows), so an exact
-- google_place_id match is a single-row answer.
--
-- Deliberately mirrors `biz_search_place_pool_for_claim`'s EXACT return shape —
-- 18 columns including the ORCH-1263 presence facts — so the caller can reuse
-- `rowToPoolMatch` and `ClaimMatchCard` renders with no new shape. The presence
-- facts ARE the card's "5 photos / Hours / Website / Rated on Google" chips and
-- the claimed/pending block; a divergent shape here would silently strip them.

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_match_place_pool_by_google_id (
  p_google_place_id text
) RETURNS TABLE (
  id uuid,
  name text,
  address text,
  city text,
  country text,
  lat double precision,
  lng double precision,
  google_place_id text,
  primary_type text,
  types text[],
  opening_hours jsonb,
  stored_photo_urls text[],
  has_hours boolean,
  has_phone boolean,
  has_website boolean,
  has_rating boolean,
  photo_count integer,
  claim_state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    p.name,
    p.address,
    p.city,
    p.country,
    p.lat,
    p.lng,
    p.google_place_id,
    p.primary_type,
    p.types,
    p.opening_hours,
    p.stored_photo_urls,
    (p.opening_hours IS NOT NULL)                        AS has_hours,
    (p.national_phone_number IS NOT NULL)                AS has_phone,
    (p.website IS NOT NULL)                              AS has_website,
    (p.rating IS NOT NULL)                               AS has_rating,
    coalesce(array_length(p.stored_photo_urls, 1), 0)    AS photo_count,
    CASE WHEN EXISTS (SELECT 1 FROM public.venue_listings vl
                      WHERE vl.place_pool_id = p.id AND vl.claim_status = 'verified') THEN 'claimed'
         WHEN EXISTS (SELECT 1 FROM public.venue_listings vl
                      WHERE vl.place_pool_id = p.id)                            THEN 'pending'
         ELSE 'available' END                            AS claim_state
  FROM public.place_pool p
  WHERE p.is_active = true
    -- Exact identity. No ILIKE, no similarity, no radius: the whole point is
    -- that this answers with ONE row or none.
    AND p.google_place_id = NULLIF(btrim(coalesce(p_google_place_id, '')), '')
  -- The unique-ish key should yield one row; LIMIT 1 is a belt-and-braces guard
  -- so a duplicate seed can never fan out into a multi-row "match".
  LIMIT 1;
$$;

-- SECURITY: `REVOKE ... FROM PUBLIC` alone is NOT enough on Supabase. The
-- project runs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON
-- FUNCTIONS TO anon, authenticated, service_role`, which grants EXECUTE to
-- those roles DIRECTLY — and revoking from PUBLIC does not remove a direct
-- grant to a named role. anon and authenticated must be named explicitly or
-- this SECURITY DEFINER function is callable by anyone, unauthenticated.
-- Only service_role needs it: the caller is an edge function using the
-- service-role key, behind its own JWT check and per-user rate limit.
REVOKE ALL ON FUNCTION public.biz_match_place_pool_by_google_id(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_match_place_pool_by_google_id(text) TO service_role;

COMMENT ON FUNCTION public.biz_match_place_pool_by_google_id IS
  'Issue #1648 — exact google_place_id lookup against the ACTIVE place pool, '
  'used after a brand picks an address so a venue we already hold cannot '
  'duplicate itself. Return shape mirrors biz_search_place_pool_for_claim '
  '(18 columns incl. the ORCH-1263 presence facts) so ClaimMatchCard renders '
  'unchanged. Searches the WHOLE active pool, not the servable subset — '
  'unserved places claiming in is how they become served.';

-- The lookup is an equality probe on 88k rows; without this it seq-scans.
CREATE INDEX IF NOT EXISTS idx_place_pool_google_place_id_active
  ON public.place_pool (google_place_id)
  WHERE is_active = true AND google_place_id IS NOT NULL;

COMMIT;
