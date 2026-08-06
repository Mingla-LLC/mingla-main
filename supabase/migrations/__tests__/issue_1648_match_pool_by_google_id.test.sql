-- Issue #1648 — behavioural probe for the exact google_place_id pool lookup.
--   psql "$DB_URL" -f supabase/migrations/__tests__/issue_1648_match_pool_by_google_id.test.sql
--
-- WRITE-SAFE: fixtures live inside a transaction that ROLLBACKs.
--
-- WHY THIS EXISTS. Venue onboarding's gate searches by NAME. When that misses,
-- the brand lands in create-from-scratch, types the exact address of a place we
-- hold, and we ignored it. This lookup closes that door using the one key that
-- can answer with an IDENTITY rather than a shortlist: production has 2-18
-- active pool rows within ~130m of every existing venue, and place_pool is
-- already ~100% Google-keyed (88,362 of 88,367).
--
-- FAILS-ON-REVERT: drop the NULLIF guard on the id and B-04 fails (a blank id
-- would equal any NULL google_place_id row). Drop `is_active` and B-05 fails.
-- Diverge the return shape from biz_search_place_pool_for_claim and B-00 fails —
-- that shape carries the ORCH-1263 presence facts that ARE the match card's
-- chips and its claimed/pending block.

\set ON_ERROR_STOP on
-- B-00: shape must MIRROR biz_search_place_pool_for_claim exactly, or
-- ClaimMatchCard silently loses its chips and the claimed/pending block.
DO $$
DECLARE a text; b text;
BEGIN
  SELECT string_agg(x.name, ',' ORDER BY x.ord) INTO a
  FROM unnest((SELECT proargnames FROM pg_proc
    WHERE oid='public.biz_match_place_pool_by_google_id(text)'::regprocedure))
    WITH ORDINALITY x(name, ord) WHERE x.name <> 'p_google_place_id';
  SELECT string_agg(x.name, ',' ORDER BY x.ord) INTO b
  FROM unnest((SELECT proargnames FROM pg_proc
    WHERE oid='public.biz_search_place_pool_for_claim(text,int)'::regprocedure))
    WITH ORDINALITY x(name, ord) WHERE x.name NOT IN ('p_query','p_limit');
  IF a IS DISTINCT FROM b THEN
    RAISE EXCEPTION 'B-00 FAIL: shape diverged. new=[%] old=[%]', a, b;
  END IF;
END $$;

BEGIN;
INSERT INTO public.place_pool (id,name,address,city,country,lat,lng,is_active,google_place_id,is_servable)
VALUES
 ('00000000-0000-4000-8000-000016480001','440 Nightclub','2526 Hillsborough St','Raleigh','US',35.78,-78.68,true,'ChIJ_440_test',false),
 ('00000000-0000-4000-8000-000016480002','Decoy Next Door','2528 Hillsborough St','Raleigh','US',35.78,-78.68,true,'ChIJ_decoy',true);

-- B-01: exact id finds exactly one row
DO $$
DECLARE n int; got uuid;
BEGIN
  SELECT count(*) INTO n FROM public.biz_match_place_pool_by_google_id('ChIJ_440_test');
  IF n <> 1 THEN RAISE EXCEPTION 'B-01 FAIL: expected 1 row, got %', n; END IF;
  SELECT id INTO got FROM public.biz_match_place_pool_by_google_id('ChIJ_440_test');
  IF got <> '00000000-0000-4000-8000-000016480001' THEN
    RAISE EXCEPTION 'B-01 FAIL: matched the wrong row';
  END IF;
END $$;

-- B-02: an UNSERVED place must still match. Unserved places claiming in is how
-- they become served (verified live: 440 Nightclub, is_servable=false).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.biz_match_place_pool_by_google_id('ChIJ_440_test')) THEN
    RAISE EXCEPTION 'B-02 FAIL: an unserved place vanished — that door must stay open';
  END IF;
END $$;

-- B-03 ADVERSARIAL: a neighbour 60m away must NOT match. This is the whole
-- reason for an exact key: production has 2-18 pool rows within ~130m of every
-- venue, so anything fuzzier returns a shortlist instead of an identity.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.biz_match_place_pool_by_google_id('ChIJ_440_test')
   WHERE id = '00000000-0000-4000-8000-000016480002';
  IF n <> 0 THEN RAISE EXCEPTION 'B-03 FAIL: a neighbouring place matched'; END IF;
END $$;

-- B-04 ADVERSARIAL: blank/null/whitespace must match NOTHING. Without the
-- NULLIF guard an empty id would equal any NULL google_place_id row and hand
-- back an arbitrary "match".
DO $$
DECLARE v text; n int;
BEGIN
  FOREACH v IN ARRAY ARRAY['', '   ', NULL] LOOP
    SELECT count(*) INTO n FROM public.biz_match_place_pool_by_google_id(v);
    IF n <> 0 THEN RAISE EXCEPTION 'B-04 FAIL: blank id returned % rows', n; END IF;
  END LOOP;
END $$;

-- B-05: an INACTIVE place must never be offered for claiming
DO $$
DECLARE n int;
BEGIN
  UPDATE public.place_pool SET is_active=false WHERE google_place_id='ChIJ_440_test';
  SELECT count(*) INTO n FROM public.biz_match_place_pool_by_google_id('ChIJ_440_test');
  IF n <> 0 THEN RAISE EXCEPTION 'B-05 FAIL: an inactive place was offered'; END IF;
END $$;

-- B-06 SECURITY: anon and authenticated must NOT be able to execute this.
-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to those roles DIRECTLY,
-- and `REVOKE ... FROM PUBLIC` does NOT remove a direct named-role grant. The
-- first draft of this migration revoked only from PUBLIC and the function was
-- anon-executable; the anon-grant CI gate caught it. This pins the fix.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_function_privilege(r, 'public.biz_match_place_pool_by_google_id(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'B-06 FAIL: % can EXECUTE a SECURITY DEFINER pool lookup', r;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.biz_match_place_pool_by_google_id(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B-06 FAIL: service_role lost EXECUTE — the edge fn cannot call it';
  END IF;
END $$;

ROLLBACK;
\echo 'issue #1648: all behavioural cases passed (B-00..B-06)'
