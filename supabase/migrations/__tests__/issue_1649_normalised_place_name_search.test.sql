-- Issue #1649 — behavioural probe for the normalised place-name claim search.
-- Runs against a real Postgres AFTER the migrations apply:
--   psql "$DB_URL" -f supabase/migrations/__tests__/issue_1649_normalised_place_name_search.test.sql
--
-- WRITE-SAFE: every case runs inside a transaction that ROLLBACKs, so no
-- fixture rows survive.
--
-- WHAT THIS PINS. Before #1649 the search was a raw substring compare, so on
-- production (88,367 active places):
--     'Katy'         -> 10 hits    'katye' (one letter off) ->  0
--     'Fish & Chips' -> 30         'Fish and Chips'         -> 14 DISJOINT
--     'Cafe'         -> 2,157      'Café'                   -> 942 OTHERS
-- A venue held as "Café Kayté" was unreachable to an owner typing "Cafe Kayte",
-- so they duplicated themselves.
--
-- FAILS-ON-REVERT: restore the old body
--     AND p.name ILIKE ('%' || escape_like_pattern(trim(p_query)) || '%')
-- and B-02 (accent), B-03 (ampersand) and B-04 (typo) all fail. Dropping the
-- IMMUTABLE normaliser fails B-01. Removing the tier CASE fails B-05.

\set ON_ERROR_STOP on

-- ─── B-00: the pieces exist ─────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.mingla_normalize_place_name(text)') IS NULL THEN
    RAISE EXCEPTION 'B-00 FAIL: mingla_normalize_place_name(text) missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'mingla_normalize_place_name'
      AND p.provolatile = 'i'          -- 'i' = IMMUTABLE
  ) THEN
    RAISE EXCEPTION 'B-00 FAIL: normaliser is not IMMUTABLE — it cannot back the GIN index';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_place_pool_name_normalised_trgm'
  ) THEN
    RAISE EXCEPTION 'B-00 FAIL: trigram index missing — the fuzzy tier would seq-scan 88k rows';
  END IF;
END $$;

-- ─── B-01: the normaliser folds all three classes ───────────────────────────
DO $$
DECLARE v text;
BEGIN
  v := public.mingla_normalize_place_name('Café Kayté');
  IF v <> 'cafe kayte' THEN
    RAISE EXCEPTION 'B-01 FAIL: accent/case fold gave %, expected "cafe kayte"', v;
  END IF;
  v := public.mingla_normalize_place_name('Fish & Chips');
  IF v <> 'fish and chips' THEN
    RAISE EXCEPTION 'B-01 FAIL: ampersand fold gave %, expected "fish and chips"', v;
  END IF;
  v := public.mingla_normalize_place_name('  A&B   Bar  ');
  IF v <> 'a and b bar' THEN
    RAISE EXCEPTION 'B-01 FAIL: tight-ampersand + whitespace gave %, expected "a and b bar"', v;
  END IF;
END $$;

-- ─── B-02..B-05: behaviour against real rows, rolled back ───────────────────
BEGIN;

INSERT INTO public.place_pool (id, name, address, city, country, lat, lng, is_active)
VALUES
  ('00000000-0000-4000-8000-000016490001', 'Café Kayté',   '1 Test St', 'Raleigh', 'US', 35.77, -78.63, true),
  ('00000000-0000-4000-8000-000016490002', 'Fish & Chips Co', '2 Test St', 'Raleigh', 'US', 35.77, -78.63, true),
  ('00000000-0000-4000-8000-000016490003', 'Zzyzx Unrelated', '3 Test St', 'Raleigh', 'US', 35.77, -78.63, true);

-- B-02 — accent: typing the UNACCENTED form must find the accented venue.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.biz_search_place_pool_for_claim('Cafe Kayte')
    WHERE id = '00000000-0000-4000-8000-000016490001'
  ) THEN
    RAISE EXCEPTION 'B-02 FAIL: "Cafe Kayte" did not find "Café Kayté" (accent split — 942 places hidden in prod)';
  END IF;
  -- and the reverse direction
  IF NOT EXISTS (
    SELECT 1 FROM public.biz_search_place_pool_for_claim('Café')
    WHERE id = '00000000-0000-4000-8000-000016490001'
  ) THEN
    RAISE EXCEPTION 'B-02 FAIL: accented query did not find the accented venue';
  END IF;
END $$;

-- B-03 — ampersand: "and" must find "&" and vice versa.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.biz_search_place_pool_for_claim('Fish and Chips')
    WHERE id = '00000000-0000-4000-8000-000016490002'
  ) THEN
    RAISE EXCEPTION 'B-03 FAIL: "Fish and Chips" did not find "Fish & Chips Co" (disjoint populations in prod)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.biz_search_place_pool_for_claim('Fish & Chips')
    WHERE id = '00000000-0000-4000-8000-000016490002'
  ) THEN
    RAISE EXCEPTION 'B-03 FAIL: "Fish & Chips" did not find its own venue';
  END IF;
END $$;

-- B-04 — one-character typo must still find it (the katye -> Katy case).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.biz_search_place_pool_for_claim('Cafe Kayte Bar')
    WHERE id = '00000000-0000-4000-8000-000016490001'
  ) THEN
    RAISE EXCEPTION 'B-04 FAIL: a near-miss query did not reach the venue via the trigram tier';
  END IF;
END $$;

-- B-05 — ADVERSARIAL: fuzzy must NOT become a firehose. An unrelated query
-- must return nothing. A fuzzy search that always matches is worse than none —
-- it would bury the real match under noise and train brands to ignore the card.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.biz_search_place_pool_for_claim('qqqwwweee');
  IF n <> 0 THEN
    RAISE EXCEPTION 'B-05 FAIL: unrelated query returned % rows — similarity floor is too low', n;
  END IF;
  -- the deliberately unrelated fixture must never surface for a cafe search
  IF EXISTS (
    SELECT 1 FROM public.biz_search_place_pool_for_claim('Cafe Kayte')
    WHERE id = '00000000-0000-4000-8000-000016490003'
  ) THEN
    RAISE EXCEPTION 'B-05 FAIL: unrelated venue surfaced for an unrelated query';
  END IF;
END $$;

-- B-06 — ADVERSARIAL: ranking is tiered. An exact-prefix match must outrank a
-- fuzzy one, or #1649 would REORDER today's good results — a silent regression
-- that every other assertion here would pass straight over.
DO $$
DECLARE first_id uuid;
BEGIN
  SELECT id INTO first_id
  FROM public.biz_search_place_pool_for_claim('Fish and Chips') LIMIT 1;
  IF first_id <> '00000000-0000-4000-8000-000016490002' THEN
    RAISE EXCEPTION 'B-06 FAIL: prefix match did not rank first (got %)', first_id;
  END IF;
END $$;

-- B-07 — an is_servable = false place must STILL be findable. Unserved places
-- claiming in is how they become served (verified live: 440 Nightclub).
DO $$
BEGIN
  UPDATE public.place_pool SET is_servable = false
   WHERE id = '00000000-0000-4000-8000-000016490001';
  IF NOT EXISTS (
    SELECT 1 FROM public.biz_search_place_pool_for_claim('Cafe Kayte')
    WHERE id = '00000000-0000-4000-8000-000016490001'
  ) THEN
    RAISE EXCEPTION 'B-07 FAIL: an unserved place vanished from claim search — that door must stay open';
  END IF;
END $$;

-- B-08 — LIKE-injection stays escaped: a bare % must not match everything.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.biz_search_place_pool_for_claim('%%%');
  IF n <> 0 THEN
    RAISE EXCEPTION 'B-08 FAIL: wildcard query returned % rows — escaping regressed', n;
  END IF;
END $$;

-- B-09 — the return shape is FROZEN. claim-search-pool destructures it
-- positionally, so a reordered or added column breaks the client silently.
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(p.name, ',' ORDER BY p.ord) INTO cols
  FROM unnest(
    (SELECT proargnames FROM pg_proc
      WHERE oid = 'public.biz_search_place_pool_for_claim(text,int)'::regprocedure)
  ) WITH ORDINALITY AS p(name, ord)
  WHERE p.name NOT IN ('p_query','p_limit');
  -- 18 columns: 12 place fields + the 6 ORCH-1263 presence facts that drive the
  -- match card's chips and the claimed/pending block. An earlier draft of #1649
  -- rebuilt this function from a SUPERSEDED 12-column definition and would have
  -- silently deleted those chips — this assertion is what caught it.
  IF cols <> 'id,name,address,city,country,lat,lng,google_place_id,primary_type,types,opening_hours,stored_photo_urls,has_hours,has_phone,has_website,has_rating,photo_count,claim_state' THEN
    RAISE EXCEPTION 'B-09 FAIL: return shape changed -> %', cols;
  END IF;
END $$;

ROLLBACK;

\echo 'issue #1649: all behavioural cases passed (B-00..B-09)'
