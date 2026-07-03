-- ═══════════════════════════════════════════════════════════════════════════
-- ORCH-1263 [claim-adoption] — Leg A §A1: claim-search contract growth +
-- single-place adoption-detail RPC.
--
-- A1.1  biz_search_place_pool_for_claim gains presence facts (booleans/counts
--       ONLY — scrape-safe) + claim_state. rating/review_count VALUES stay
--       FORBIDDEN (deliberate Ve2 ruling, commit c07de2a49; presence boolean
--       has_rating is the allowed ceiling).
-- A1.2  NEW biz_get_place_adoption_detail(uuid) — the full adoption payload
--       (phone/website/price/summaries/facets/full gallery), fetched ONLY on
--       explicit claim intent ("Yes, this is me"). Single place per call,
--       service_role-only (edge fn enforces auth + shared 10/min rate bucket),
--       fail-close: claimed/pending/inactive → zero rows.
-- A1.3  No other DDL. place_pool_business_owner_update RLS untouched.
--
-- Invariants: I-PROPOSED-1263-ADOPTION-PAYLOAD-WHITELISTED,
--             I-PROPOSED-1263-CLAIMED-STATE-FRONT-LOADED.
-- Contract: Mingla_Artifacts/specs/SPEC_ORCH-1263_CLAIM_ADOPTION.md §4.A1.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A1.1 — search RPC: presence facts + claim_state ─────────────────────────
-- Return type changes (RETURNS TABLE widens) → drop the exact old signature
-- first, then re-CREATE with the 20260809000000:496–546 body verbatim plus the
-- six new output columns.
DROP FUNCTION IF EXISTS public.biz_search_place_pool_for_claim(text, int);

CREATE FUNCTION public.biz_search_place_pool_for_claim (
  p_query text,
  p_limit int DEFAULT NULL
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
    (p.rating IS NOT NULL)                               AS has_rating,        -- presence ONLY; value stays banned
    coalesce(array_length(p.stored_photo_urls, 1), 0)    AS photo_count,       -- full count (search photoUrls stay capped 6)
    CASE WHEN EXISTS (SELECT 1 FROM public.venue_listings vl
                      WHERE vl.place_pool_id = p.id AND vl.claim_status = 'verified') THEN 'claimed'
         WHEN EXISTS (SELECT 1 FROM public.venue_listings vl
                      WHERE vl.place_pool_id = p.id)                            THEN 'pending'
         ELSE 'available' END                            AS claim_state
  FROM public.place_pool p
  WHERE p.is_active = true
    AND length(trim(coalesce(p_query, ''))) >= 3
    AND p.name ILIKE (
      '%' || public.escape_like_pattern(trim(p_query)) || '%'
    ) ESCAPE '\'
  ORDER BY
    CASE
      WHEN p.name ILIKE (
        public.escape_like_pattern(trim(p_query)) || '%'
      ) ESCAPE '\' THEN 0
      ELSE 1
    END,
    coalesce(p.review_count, 0) DESC,
    p.name ASC;
$$;

-- Supabase default privileges auto-grant EXECUTE to anon/authenticated on new
-- functions; REVOKE FROM PUBLIC alone does not strip those direct grants.
-- Revoke ALL THREE explicitly — this surface is edge-fn (service_role) only.
REVOKE ALL ON FUNCTION public.biz_search_place_pool_for_claim(text, int)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_search_place_pool_for_claim(text, int)
TO service_role;

COMMENT ON FUNCTION public.biz_search_place_pool_for_claim IS
  'META-ORCH-1009 Sub-E + ORCH-1263 A1.1: public-safe active place_pool claim '
  'search; p_limit is legacy and ignored so business onboarding can show all '
  'active matches for a query. ORCH-1263 adds presence facts (booleans/counts '
  'only — has_hours/has_phone/has_website/has_rating/photo_count) and '
  'claim_state (claimed = a verified venue_listings row exists; pending = any '
  'venue_listings row exists incl. needs-fixes/rejected — the partial unique '
  'index venue_listings_place_uniq blocks re-claim either way; else '
  'available). rating/review_count VALUES stay forbidden (Ve2 whitelist '
  'ruling): presence booleans defeat scraping while powering the claim card.';

-- ── A1.2 — NEW single-place adoption-detail RPC ─────────────────────────────
CREATE OR REPLACE FUNCTION public.biz_get_place_adoption_detail (
  p_place_pool_id uuid
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
  national_phone_number text,
  website text,
  price_tiers text[],
  price_level text,
  generative_summary text,
  editorial_summary text,
  serves_brunch boolean,
  serves_lunch boolean,
  serves_dinner boolean,
  serves_breakfast boolean,
  serves_beer boolean,
  serves_wine boolean,
  serves_cocktails boolean,
  serves_coffee boolean,
  serves_dessert boolean,
  serves_vegetarian_food boolean,
  outdoor_seating boolean,
  live_music boolean,
  good_for_groups boolean,
  good_for_children boolean,
  good_for_watching_sports boolean,
  allows_dogs boolean,
  has_restroom boolean,
  reservable boolean,
  menu_for_children boolean,
  dine_in boolean,
  takeout boolean,
  delivery boolean,
  curbside_pickup boolean
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
    p.stored_photo_urls,      -- full, uncapped (adoption gallery)
    p.national_phone_number,
    p.website,
    p.price_tiers,
    p.price_level,
    p.generative_summary,
    p.editorial_summary,
    p.serves_brunch,
    p.serves_lunch,
    p.serves_dinner,
    p.serves_breakfast,
    p.serves_beer,
    p.serves_wine,
    p.serves_cocktails,
    p.serves_coffee,
    p.serves_dessert,
    p.serves_vegetarian_food,
    p.outdoor_seating,
    p.live_music,
    p.good_for_groups,
    p.good_for_children,
    p.good_for_watching_sports,
    p.allows_dogs,
    p.has_restroom,
    p.reservable,
    p.menu_for_children,
    p.dine_in,
    p.takeout,
    p.delivery,
    p.curbside_pickup
  FROM public.place_pool p
  WHERE p.id = p_place_pool_id
    AND p.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.venue_listings vl WHERE vl.place_pool_id = p.id
    );
$$;

-- Same default-privileges hole (see above): strip anon/authenticated too —
-- the detail payload is authed + rate-limited through claim-search-pool ONLY
-- (a direct authenticated grant would bypass the shared 10/min bucket).
REVOKE ALL ON FUNCTION public.biz_get_place_adoption_detail(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_get_place_adoption_detail(uuid)
TO service_role;

COMMENT ON FUNCTION public.biz_get_place_adoption_detail IS
  'ORCH-1263 A1.2 (I-PROPOSED-1263-ADOPTION-PAYLOAD-WHITELISTED): full '
  'adoption payload for ONE unclaimed active place, fetched only on explicit '
  'claim intent ("Yes, this is me") via the authed + rate-limited '
  'claim-search-pool edge fn (service_role-only grant). Whitelist rule: '
  'Google-derived public directory data + the 23 facet columns ONLY. '
  'FORBIDDEN set (never add): rating, review_count, ai_signal_scores, '
  'ai_signal_scores_veto, photo_analysis, photo_aesthetic_data, '
  'raw_google_data, bouncer_reason, is_servable, business_authoring_inputs, '
  'reviews, google_maps_uri. Fail-close: claimed/pending (ANY venue_listings '
  'row) or inactive → zero rows (edge maps to place_not_available).';
