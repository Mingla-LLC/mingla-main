-- #4490 Explorer W6b (20281203474490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-DECK-VENUE-TYPE-ONLY-WITH-SUPPLY | issue #4490 | a deck venue-type chip is offered only for a chip type with a bookable hosted venue (the Discover rule) whose place is inside the deck radius and passes the base servable place rule; its rows obey that same place rule, the radius or every circle, and exclusions, in a fixed order; with VENUE_DISCOVER off there are no types and no rows.
-- MINGLA-INVARIANT: I-4490-SERVABLE-PLACE-RULE-ONE-OWNER | issue #4490 | the solo base servable RPC and every #4490 venue read take the place-quality rule from issue_4490_place_is_servable, which answers exactly as the inline predicate it replaced (truth table pinned here), with ORDER BY and LIMIT unchanged.
-- MINGLA-INVARIANT: I-4490-SHARED-DECK-BASE-RPC-UNTOUCHED | issue #4490 | #4490 never re-emits query_servable_places_by_signal_intersection: its body keeps the inline place predicate in its original place (a re-emit that moved the photo checks changed its plan and made every shared-deck position 2-3x slower with every switch off, fix round 1 W6-N1).
--
-- P place rule. T types near. S solo rows. I intersection rows. X flag off. A authority.
--
-- FAILS-ON-REVERT: without 20281203474490 every block fails (functions absent). P-3b fails if the
-- shared-deck base RPC is patched again (fix round 1, W6-N1).
-- TEST-MOD-APPROVED #4490 (06-W6 fix 1): P-3 now pins the solo base RPC only; P-3b pins the
-- shared-deck base RPC as untouched.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION public.t4490w6b_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490W6B FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490w6b_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490w6b_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490w6b_ok(boolean, text), public.t4490w6b_as(uuid), public.t4490w6b_reset() TO PUBLIC;

-- ---------------------------------------------------------------------------
-- P: the lifted rule answers exactly as the inline predicate (every case).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t4490w6b_cases ON COMMIT DROP AS
SELECT s.v AS is_servable, a.v AS is_active, p.v AS photos
FROM (VALUES (true), (false), (NULL::boolean)) s(v)
CROSS JOIN (VALUES (true), (false), (NULL::boolean)) a(v)
CROSS JOIN (VALUES (NULL::text[]), ('{}'::text[]), (ARRAY['__backfill_failed__']), (ARRAY['__backfill_failed__', 'x']),
                   (ARRAY['https://x/1.jpg']), (ARRAY[NULL::text]), (ARRAY['a', 'b'])) p(v);
SELECT public.t4490w6b_ok(
  (SELECT bool_and(
     (public.issue_4490_place_is_servable(is_servable, is_active, photos) IS TRUE)
     = ((is_servable = true
         AND is_active = true
         AND photos IS NOT NULL
         AND pg_catalog.array_length(photos, 1) > 0
         AND NOT (pg_catalog.array_length(photos, 1) = 1 AND photos[1] = '__backfill_failed__')) IS TRUE))
   FROM t4490w6b_cases)
  AND (SELECT count(*) FROM t4490w6b_cases) = 63,
  'P-1 the lifted place rule keeps exactly the rows the inline predicate kept (63 cases incl. NULLs)');
SELECT public.t4490w6b_ok(
  (SELECT NOT p.prosecdef AND p.proconfig IS NULL AND p.provolatile = 'i' AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
   FROM pg_proc p WHERE p.oid = 'public.issue_4490_place_is_servable(boolean,boolean,text[])'::regprocedure),
  'P-2 the rule is an inlinable SQL expression (immutable, invoker, no SET)');
SELECT public.t4490w6b_ok(
  pg_get_functiondef('public.issue_1384_query_servable_places_by_signal(text,numeric,double precision,double precision,double precision,uuid[],integer,bigint,bigint,character,uuid)'::regprocedure)
      LIKE '%public.issue_4490_place_is_servable(pp.is_servable, pp.is_active, pp.stored_photo_urls)%'
  AND pg_get_functiondef('public.issue_1384_query_servable_places_by_signal(text,numeric,double precision,double precision,double precision,uuid[],integer,bigint,bigint,character,uuid)'::regprocedure)
      NOT LIKE '%__backfill_failed__%'
  AND pg_get_functiondef('public.issue_1384_query_servable_places_by_signal(text,numeric,double precision,double precision,double precision,uuid[],integer,bigint,bigint,character,uuid)'::regprocedure)
      LIKE '%ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST%LIMIT p_limit%',
  'P-3 the solo base RPC calls the one rule; ORDER BY and LIMIT unchanged');
SELECT public.t4490w6b_ok(
  pg_get_functiondef('public.query_servable_places_by_signal_intersection(text,numeric,jsonb,uuid[],integer)'::regprocedure)
      NOT LIKE '%issue_4490%'
  AND pg_get_functiondef('public.query_servable_places_by_signal_intersection(text,numeric,jsonb,uuid[],integer)'::regprocedure)
      LIKE '%candidate_places AS (%WHERE pp.is_servable = true%AND pp.is_active = true%AND pp.lat IS NOT NULL%WHERE ps.score >= p_filter_min%AND pp.stored_photo_urls IS NOT NULL%__backfill_failed__%AND NOT (pp.id = ANY(p_exclude_place_ids))%ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC%LIMIT p_limit%',
  'P-3b the shared-deck base RPC keeps its original body (no #4490 re-emit; its plan is unchanged)');

-- ---------------------------------------------------------------------------
-- Fixture around (6.45, 3.40). Bookable by reservable tables.
--   bar1   bar_lounge, servable place, 1 km away, 900 reviews
--   bar2   bar_lounge, servable place, in town, 900 reviews, rating 4.9 (tie on reviews: rating decides)
--   bar3   bar_lounge, place NOT servable (absent from rows; type still listed by bar1/bar2)
--   bar4   bar_lounge, place photo '__backfill_failed__' (absent)
--   club60 club, 60 km away (outside a 20 km radius)
--   cafe1  cafe, servable, 2 km (used for exclusion)
--   stay1  stay with a day pass (never a chip)
-- And signal rows for P-4 (base RPC equality vs the inline predicate).
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('44948000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'w6bowner-4490@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44948000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44948000-0000-4000-9000-000000000010', '44948000-0000-4000-8000-000000000001', 'Deck W6b 4490', 'deck-w6b-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.admin_internal_brands (brand_id, is_internal, reason, marked_by) VALUES
  ('44948000-0000-4000-9000-000000000010', false, 'W6b suite: a real venue brand', 'w6b-suite');

CREATE TEMP TABLE t4490w6b_fx (k text PRIMARY KEY, venue uuid, place uuid, category text, lat float8,
  servable boolean, photos text[], reviews int, rating numeric) ON COMMIT DROP;
INSERT INTO t4490w6b_fx VALUES
  ('bar1', '44948000-0000-4000-b000-000000000001', '44948000-0000-4000-a000-000000000001', 'bar_lounge', 6.459, true, ARRAY['https://x/1.jpg'], 900, 4.1),
  ('bar2', '44948000-0000-4000-b000-000000000002', '44948000-0000-4000-a000-000000000002', 'bar_lounge', 6.45, true, ARRAY['https://x/2.jpg'], 900, 4.9),
  ('bar3', '44948000-0000-4000-b000-000000000003', '44948000-0000-4000-a000-000000000003', 'bar_lounge', 6.45, false, ARRAY['https://x/3.jpg'], 2000, 5.0),
  ('bar4', '44948000-0000-4000-b000-000000000004', '44948000-0000-4000-a000-000000000004', 'bar_lounge', 6.45, true, ARRAY['__backfill_failed__'], 3000, 5.0),
  ('club60', '44948000-0000-4000-b000-000000000005', '44948000-0000-4000-a000-000000000005', 'club', 6.99, true, ARRAY['https://x/5.jpg'], 100, 4.0),
  ('cafe1', '44948000-0000-4000-b000-000000000006', '44948000-0000-4000-a000-000000000006', 'cafe', 6.468, true, ARRAY['https://x/6.jpg'], 50, 4.0),
  ('stay1', '44948000-0000-4000-b000-000000000007', '44948000-0000-4000-a000-000000000007', 'stay', 6.45, true, ARRAY['https://x/7.jpg'], 50, 4.0);
GRANT SELECT ON t4490w6b_fx TO PUBLIC;

INSERT INTO public.place_pool (id, name, lat, lng, is_active, is_servable, stored_photo_urls, review_count, rating)
SELECT place, 'W6b ' || k, lat, 3.40, true, servable, photos, reviews, rating FROM t4490w6b_fx;
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, city, venue_category, claim_status, country_code, place_pool_id)
SELECT venue, '44948000-0000-4000-9000-000000000010', 'w6b' || k, 'W6b ' || k, lat, 3.40, 'W6b City', category, 'verified', 'NG', place FROM t4490w6b_fx;

SELECT public.t4490w6b_as('44948000-0000-4000-8000-000000000001');
DO $fx$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM t4490w6b_fx WHERE k <> 'stay1' LOOP
    PERFORM public.issue_4490_set_venue_feature(r.venue, 'table_reservations', true, NULL, NULL, NULL, 'w6b-tables-' || r.k);
  END LOOP;
  PERFORM public.issue_4490_set_venue_feature('44948000-0000-4000-b000-000000000007', 'table_reservations', true, NULL, NULL, NULL, 'w6b-tables-stay1');
END
$fx$;
SELECT public.t4490w6b_reset();
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled)
SELECT '44948000-0000-4000-9000-000000000010', venue, true FROM t4490w6b_fx
ON CONFLICT (venue_id) DO UPDATE SET reservations_enabled = true;

-- P-4: the patched base RPCs return exactly the rows of the inline predicate (signal t4490w6b).
INSERT INTO public.place_pool (id, name, lat, lng, is_active, is_servable, stored_photo_urls, review_count)
SELECT ('44948000-0000-4000-c000-' || lpad(n::text, 12, '0'))::uuid, 'W6b sig ' || n, 6.45, 3.40,
  (n % 5) <> 0, CASE WHEN n % 7 = 0 THEN NULL WHEN n % 3 = 0 THEN false ELSE true END,
  CASE n % 4 WHEN 0 THEN NULL WHEN 1 THEN '{}'::text[] WHEN 2 THEN ARRAY['__backfill_failed__'] ELSE ARRAY['https://x/s.jpg'] END,
  n
FROM generate_series(1, 60) n;
INSERT INTO public.place_scores (place_id, signal_id, score)
SELECT ('44948000-0000-4000-c000-' || lpad(n::text, 12, '0'))::uuid, 't4490w6b', 100 + (n % 9) FROM generate_series(1, 60) n;
SELECT public.t4490w6b_ok(
  (SELECT array_agg(place_id) FROM public.issue_1384_query_servable_places_by_signal('t4490w6b', 0, 6.45, 3.40, 5000, '{}', NULL))
  IS NOT DISTINCT FROM
  (SELECT array_agg(pp.id ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST)
   FROM public.place_pool pp JOIN public.place_scores ps ON ps.place_id = pp.id AND ps.signal_id = 't4490w6b'
   WHERE pp.is_servable = true AND pp.is_active = true AND pp.stored_photo_urls IS NOT NULL
     AND pg_catalog.array_length(pp.stored_photo_urls, 1) > 0
     AND NOT (pg_catalog.array_length(pp.stored_photo_urls, 1) = 1 AND pp.stored_photo_urls[1] = '__backfill_failed__'))
  AND (SELECT count(*) FROM public.issue_1384_query_servable_places_by_signal('t4490w6b', 0, 6.45, 3.40, 5000, '{}', NULL)) > 0,
  'P-4 solo base RPC: same rows, same order as the inline predicate on a mixed fixture');
SELECT public.t4490w6b_ok(
  (SELECT array_agg(place_id) FROM public.query_servable_places_by_signal_intersection('t4490w6b', 0, '[{"lat":6.45,"lng":3.40,"radius_m":5000}]'::jsonb, '{}', 200))
  IS NOT DISTINCT FROM
  (SELECT array_agg(pp.id ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC)
   FROM public.place_pool pp JOIN public.place_scores ps ON ps.place_id = pp.id AND ps.signal_id = 't4490w6b'
   WHERE pp.is_servable = true AND pp.is_active = true AND pp.stored_photo_urls IS NOT NULL
     AND array_length(pp.stored_photo_urls, 1) > 0
     AND NOT (array_length(pp.stored_photo_urls, 1) = 1 AND pp.stored_photo_urls[1] = '__backfill_failed__')),
  'P-5 intersection base RPC: same rows, same order as the inline predicate on a mixed fixture');

-- ---------------------------------------------------------------------------
-- X: switch off first.
-- ---------------------------------------------------------------------------
SELECT public.t4490w6b_ok(
  NOT EXISTS (SELECT 1 FROM public.issue_4490_hosted_venue_types_near(6.45, 3.40, 20000))
  AND NOT EXISTS (SELECT 1 FROM public.issue_4490_hosted_places_by_venue_type('bar_lounge', 6.45, 3.40, 20000, '{}', 50))
  AND NOT EXISTS (SELECT 1 FROM public.issue_4490_hosted_places_by_venue_type_intersection('bar_lounge', '[{"lat":6.45,"lng":3.40,"radius_m":20000}]', '{}', 50)),
  'X-1 VENUE_DISCOVER off: no types, no rows');

UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'VENUE_DISCOVER';

SELECT public.t4490w6b_ok(
  (SELECT array_agg(venue_type || ':' || venue_count ORDER BY array_position(public.issue_4490_venue_type_chip_keys(), venue_type))
   FROM public.issue_4490_hosted_venue_types_near(6.45, 3.40, 20000)) = ARRAY['bar_lounge:2', 'cafe:1'],
  'T-1 types with supply only: bar_lounge (bar1, bar2; not the unservable bar3 / bar4), cafe; no club (60 km), no stay');
SELECT public.t4490w6b_ok(
  (SELECT array_agg(venue_type ORDER BY venue_type) FROM public.issue_4490_hosted_venue_types_near(6.45, 3.40, 100000)) = ARRAY['bar_lounge', 'cafe', 'club'],
  'T-2 a wider radius reaches the club');
SELECT public.t4490w6b_ok(
  NOT EXISTS (SELECT 1 FROM public.issue_4490_hosted_venue_types_near(30.0, 30.0, 20000)),
  'T-3 elsewhere: no types');

CREATE FUNCTION pg_temp.t4490w6b_keys(p_rows uuid[]) RETURNS text[] LANGUAGE sql AS $f$
  SELECT array_agg(f.k ORDER BY u.ord) FROM unnest(p_rows) WITH ORDINALITY u(place, ord) JOIN t4490w6b_fx f ON f.place = u.place
$f$;
SELECT public.t4490w6b_ok(
  pg_temp.t4490w6b_keys(ARRAY(SELECT place_id FROM public.issue_4490_hosted_places_by_venue_type('bar_lounge', 6.45, 3.40, 20000, '{}', 50)))
    = ARRAY['bar2', 'bar1'],
  'S-1 bar rows: the place rule applies (bar3 unservable, bar4 backfill failed are absent); order reviews, rating, id');
SELECT public.t4490w6b_ok(
  (SELECT bool_and(signal_score = 0 AND ai_reasoning IS NULL AND venue_id IS NOT NULL)
   FROM public.issue_4490_hosted_places_by_venue_type('bar_lounge', 6.45, 3.40, 20000, '{}', 50)),
  'S-2 rows carry no score or reasoning, and their venue id');
SELECT public.t4490w6b_ok(
  NOT EXISTS (SELECT 1 FROM public.issue_4490_hosted_places_by_venue_type('cafe', 6.45, 3.40, 20000, ARRAY['44948000-0000-4000-a000-000000000006'::uuid], 50))
  AND NOT EXISTS (SELECT 1 FROM public.issue_4490_hosted_places_by_venue_type('club', 6.45, 3.40, 20000, '{}', 50))
  AND NOT EXISTS (SELECT 1 FROM public.issue_4490_hosted_places_by_venue_type('stay', 6.45, 3.40, 20000, '{}', 50))
  AND (SELECT count(*) FROM public.issue_4490_hosted_places_by_venue_type('bar_lounge', 6.45, 3.40, 20000, '{}', 1)) = 1,
  'S-3 exclusions, radius, never stay, and the limit apply');
SELECT public.t4490w6b_ok(
  ARRAY(SELECT place_id FROM public.issue_4490_hosted_places_by_venue_type('bar_lounge', 6.45, 3.40, 20000, '{}', 50))
  = ARRAY(SELECT place_id FROM public.issue_4490_hosted_places_by_venue_type('bar_lounge', 6.45, 3.40, 20000, '{}', 50)),
  'S-4 the order is stable');
SELECT public.t4490w6b_ok(
  pg_temp.t4490w6b_keys(ARRAY(SELECT place_id FROM public.issue_4490_hosted_places_by_venue_type_intersection('bar_lounge',
     '[{"lat":6.45,"lng":3.40,"radius_m":20000},{"lat":6.46,"lng":3.40,"radius_m":20000}]', '{}', 50))) = ARRAY['bar2', 'bar1']
  AND NOT EXISTS (SELECT 1 FROM public.issue_4490_hosted_places_by_venue_type_intersection('bar_lounge',
     '[{"lat":6.45,"lng":3.40,"radius_m":20000},{"lat":6.80,"lng":3.40,"radius_m":20000}]', '{}', 50))
  AND pg_temp.t4490w6b_keys(ARRAY(SELECT place_id FROM public.issue_4490_hosted_places_by_venue_type_intersection('bar_lounge',
     '[{"lat":6.45,"lng":3.40,"radius_m":20000}]', ARRAY['44948000-0000-4000-a000-000000000002'::uuid], 50))) = ARRAY['bar1'],
  'I-1 shared deck rows: inside every circle, exclusions apply, same order');

-- Authority.
SELECT public.t4490w6b_ok(
  NOT has_function_privilege('anon', 'public.issue_4490_hosted_venue_types_near(double precision,double precision,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_hosted_venue_types_near(double precision,double precision,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_hosted_places_by_venue_type(text,double precision,double precision,integer,uuid[],integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_hosted_places_by_venue_type_intersection(text,jsonb,uuid[],integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.issue_4490_hosted_places_by_venue_type_intersection(text,jsonb,uuid[],integer)', 'EXECUTE'),
  'A-1 the venue-type reads are service-role only');

ROLLBACK;
