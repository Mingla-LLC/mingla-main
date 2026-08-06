-- Issue #1649 — a venue whose name carries an accent, an ampersand, or one
-- typo is unfindable in our own directory.
--
-- `biz_search_place_pool_for_claim` matched with a raw substring compare and no
-- normalisation, so three classes of name failed outright. Measured on
-- production (88,367 active places):
--
--   'Katy'            -> 10 hits     'katye' (one letter off) ->  0 hits
--   'Fish & Chips'    -> 30 hits     'Fish and Chips'         -> 14 DISJOINT
--   'Cafe'            -> 2,157       'Café'                   -> 942 OTHERS
--
-- A venue we hold as "Café Kayté" is unreachable to an owner typing
-- "Cafe Kayte". They conclude we do not know them and duplicate themselves.
--
-- The gate is NOT skippable (verified on device: an empty name is blocked by
-- "Enter at least 2 characters."), so EVERY brand passes through this search.
-- It is the front door.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extensions. Supabase convention: install into the `extensions` schema.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 2. The normaliser.
--
-- MUST be IMMUTABLE to be indexable. The ONE-ARG `unaccent(text)` is only
-- STABLE (it resolves the dictionary at runtime), so indexing on it fails with
-- "functions in index expression must be marked IMMUTABLE". The TWO-ARG
-- `unaccent(regdictionary, text)` form IS immutable — pass the dictionary
-- explicitly. https://www.postgresql.org/docs/current/unaccent.html
--
-- Order matters: unaccent BEFORE lower() so accented capitals fold correctly;
-- '&' -> ' and ' BEFORE whitespace collapse so "A&B" and "A & B" converge.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mingla_normalize_place_name(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_text)),
        '\s*&\s*', ' and ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

COMMENT ON FUNCTION public.mingla_normalize_place_name(text) IS
  'Issue #1649 — fold a place name for search: strip accents, lowercase, '
  '& -> "and", collapse whitespace. IMMUTABLE so it can back a GIN trigram '
  'index; uses the two-arg unaccent(regdictionary,text) because the one-arg '
  'form is only STABLE and is not indexable.';

-- ---------------------------------------------------------------------------
-- 3. Trigram index on the NORMALISED name, partial on the searched set.
--     88k rows; without this the similarity tier would sequential-scan.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_place_pool_name_normalised_trgm
  ON public.place_pool
  USING gin (public.mingla_normalize_place_name(name) extensions.gin_trgm_ops)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 4. The search.
--
-- RETURN SHAPE IS FROZEN — 18 columns (12 place fields + the 6 ORCH-1263
-- presence facts), same order and types. `claim-search-pool` / `rowToPoolMatch`
-- destructure it positionally, and the presence facts drive the match card's
-- chips and the claimed/pending block.
--
-- Tiered so today's good results NEVER move:
--   0  normalised exact-prefix   (was tier 0, still tier 0)
--   1  normalised substring      (was the whole match, now tier 1)
--   2  trigram similarity        (NEW — only reachable when 0/1 found nothing
--                                 for that row; ordered by score)
-- then the pre-existing review_count DESC, name ASC.
--
-- The similarity floor (0.30) is deliberately conservative: high enough that an
-- unrelated string returns nothing (a fuzzy search that always matches is worse
-- than none), low enough to catch a single-character slip like katye -> katy.
--
-- STILL searches the WHOLE ACTIVE POOL, not the servable subset — unserved
-- places must keep being able to claim in and thereby become served (verified
-- live: '440 Nightclub', is_servable=false, matched and claimed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_search_place_pool_for_claim (
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
SET search_path = public, extensions, pg_temp
AS $$
  WITH q AS (
    SELECT
      public.mingla_normalize_place_name(trim(coalesce(p_query, ''))) AS nq,
      public.escape_like_pattern(
        public.mingla_normalize_place_name(trim(coalesce(p_query, '')))
      ) AS eq
  )
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
    -- ORCH-1263 presence facts — these ARE the match card's chips
    -- ("5 photos", "Hours", "Website", "Rated on Google") and the
    -- claimed/pending block. Carried through verbatim; #1649 changes only
    -- WHICH ROWS match, never what a row reports.
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
  FROM public.place_pool p, q
  WHERE p.is_active = true
    -- 3-char minimum preserved, measured on the RAW query as before.
    AND length(trim(coalesce(p_query, ''))) >= 3
    AND (
      public.mingla_normalize_place_name(p.name) LIKE ('%' || q.eq || '%') ESCAPE '\'
      OR extensions.similarity(public.mingla_normalize_place_name(p.name), q.nq) >= 0.30
    )
  ORDER BY
    CASE
      WHEN public.mingla_normalize_place_name(p.name) LIKE (q.eq || '%') ESCAPE '\' THEN 0
      WHEN public.mingla_normalize_place_name(p.name) LIKE ('%' || q.eq || '%') ESCAPE '\' THEN 1
      ELSE 2
    END,
    extensions.similarity(public.mingla_normalize_place_name(p.name), q.nq) DESC,
    coalesce(p.review_count, 0) DESC,
    p.name ASC;
$$;

REVOKE ALL ON FUNCTION public.biz_search_place_pool_for_claim(text, int)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_search_place_pool_for_claim(text, int)
TO service_role;

COMMENT ON FUNCTION public.biz_search_place_pool_for_claim IS
  'META-ORCH-1009 Sub-E + ORCH-1263 presence facts. Issue #1649: matches on the '
  'NORMALISED name (accent-folded, & -> and, case/whitespace-insensitive) with a '
  'trigram-similarity fallback (floor 0.30) so a one-character typo still finds '
  'the venue. Ranking tiered exact-prefix > substring > fuzzy so pre-1649 '
  'results never move. Return shape frozen at 18 columns incl. the ORCH-1263 '
  'presence facts — claim-search-pool destructures it. Still searches the WHOLE '
  'active pool, not the servable subset: unserved places claiming in is how '
  'they become served.';

COMMIT;
