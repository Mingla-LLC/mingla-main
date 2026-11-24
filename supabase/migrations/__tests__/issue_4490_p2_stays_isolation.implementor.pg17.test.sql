-- #4490 P2-1 (offer engine, 20281203074490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-STAYS-ISOLATION | issue #4490 | venue offers are Stays offerings of new kinds on non-stay venues; the Stays quote, prepare, cancel and guest list never see or charge a venue booking, and only the #4490 offer RPCs may write a venue booking's payment or cancel rows.
-- MINGLA-INVARIANT: I-4490-OFFER-AUTHORING | issue #4490 | price options are always named by the host, a live offer has its feature on, a policy, a schedule and (entry) a day limit at least its largest option, and turning a feature off pauses its live offers.
--
-- E-1 catalog: RLS, grants, service-only checkout RPCs, entry is built.
-- E-2 authoring: no default option name, stale write, guest_max over the day limit, idempotency, feature gate, pause on feature off, day limit for one date, permissions, Stay venues accepted.
-- S   Stays isolation: VB- reference, Stays guest list, Stays quote, Stays prepare, rail guard on attempts / previews, discovery, row guards.
--
-- FAILS-ON-REVERT: drop issue_4490_guard_offer_money_rows -> S-4c; restore the stay-only integrity guard -> fixture create_draft (stay_venue_brand_mismatch).
\set ON_ERROR_STOP on
BEGIN;
-- (shared #4490 P2 suite fixture; copied into each suite)
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES', 'STAY_RESERVE_READS', 'STAY_RESERVE_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

CREATE FUNCTION public.t4490_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;

CREATE FUNCTION public.t4490_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;

CREATE FUNCTION public.t4490_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;

CREATE FUNCTION public.t4490_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;

CREATE FUNCTION public.t4490_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;

GRANT EXECUTE ON FUNCTION public.t4490_ok(boolean, text), public.t4490_expect(text, text, text, text),
  public.t4490_as(uuid), public.t4490_service(), public.t4490_reset() TO PUBLIC;

-- People: 01 owner, 02 finance manager, 03 venue staff (check-in), 04 scanner member,
-- 05 outsider, 06 signed-in guest, 07 event manager.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44907000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p2u' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 7) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44907000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000001', 'Harmattan P2 4490',
        'harmattan-p2-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44907000-0000-4000-c000-000000000002', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000002', 'finance_manager', now()),
  ('44907000-0000-4000-c000-000000000003', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000003', 'venue_staff', now()),
  ('44907000-0000-4000-c000-000000000004', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000004', 'scanner', now()),
  ('44907000-0000-4000-c000-000000000007', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000007', 'event_manager', now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44907000-0000-4000-9000-0000000000a1', '44907000-0000-4000-9000-000000000010', 'gamelandp24490', 'Gameland P2', 6.45, 3.40, 'play', 'verified', 'NG'),
  ('44907000-0000-4000-9000-0000000000a2', '44907000-0000-4000-9000-000000000010', 'arcadep24490', 'Arcade P2', 6.45, 3.41, 'play', 'verified', 'NG'),
  ('44907000-0000-4000-9000-0000000000a3', '44907000-0000-4000-9000-000000000010', 'stayp24490', 'Stay P2', 6.46, 3.42, 'stay', 'verified', 'NG');
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44907000-0000-4000-c000-000000000003', '44907000-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']::text[]);

-- Owner switches Entry on for both play venues.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $fe$
BEGIN
  PERFORM public.issue_4490_set_venue_feature('44907000-0000-4000-9000-0000000000a1', 'entry', true, NULL, NULL, NULL, 'p2-fx-entry-a1');
  PERFORM public.issue_4490_set_venue_feature('44907000-0000-4000-9000-0000000000a2', 'entry', true, NULL, NULL, NULL, 'p2-fx-entry-a2');
END
$fe$;

-- Owner builds the Gameland entry offer: pool 300 / 50, Walk-in N5,000 every
-- day, Student N4,000 Mon-Thu (ID at the gate), all day 12:00-00:00.
CREATE TEMP TABLE t4490_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490_ids TO PUBLIC;
DO $fx$
DECLARE
  v jsonb;
  v_pool uuid;
  v_offer uuid;
  v_ver bigint;
BEGIN
  v := public.issue_4490_manage_capacity_pool('create', '44907000-0000-4000-9000-0000000000a1',
    '{"name":"Gameland day","dailyLimit":300,"keptForWalkIns":50}'::jsonb, NULL, 'p2-fx-pool-1');
  v_pool := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('pool', v_pool);
  v := public.issue_4490_manage_offer('create_draft', '44907000-0000-4000-9000-0000000000a1',
    '{"kind":"entry","name":"Entry","entryStyle":"walk_in"}'::jsonb, NULL, 'p2-fx-offer-1');
  v_offer := (v->>'id')::uuid; v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids VALUES ('offer', v_offer);
  v := public.issue_4490_manage_offer('set_pool', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'poolId', v_pool), v_ver, 'p2-fx-offer-2');
  v_ver := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('upsert_price_option', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Walk-in', 'unit', 'guest', 'guestMin', 1, 'guestMax', 20,
      'priceMinor', 500000), v_ver, 'p2-fx-offer-3');
  v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids SELECT 'walkin', (o->>'id')::uuid FROM jsonb_array_elements(v->'options') o WHERE o->>'name' = 'Walk-in';
  v := public.issue_4490_manage_offer('upsert_price_option', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Student & NYSC', 'unit', 'guest', 'guestMin', 1, 'guestMax', 20,
      'priceMinor', 400000, 'weekdays', jsonb_build_array(0, 1, 2, 3),
      'eligibility', jsonb_build_object('label', 'Student or NYSC ID', 'checkAtGate', true)), v_ver, 'p2-fx-offer-4');
  v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids SELECT 'student', (o->>'id')::uuid FROM jsonb_array_elements(v->'options') o WHERE o->>'name' = 'Student & NYSC';
  v := public.issue_4490_manage_offer('set_policy', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'refundLadder', jsonb_build_array(
      jsonb_build_object('minMinutesBefore', 1440, 'refundBps', 10000),
      jsonb_build_object('minMinutesBefore', 0, 'refundBps', 5000)),
      'dateChangeRule', jsonb_build_object('allowedUntilMinutesBefore', 120, 'feeBps', 0)), v_ver, 'p2-fx-offer-5');
  v_ver := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_schedule', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'mode', 'full_day', 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
      'startTime', '00:00', 'endTime', '23:59'), v_ver, 'p2-fx-offer-6');
  v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids VALUES ('offer_version_before_publish', NULL);
END
$fx$;
SELECT public.t4490_reset();

-- ===========================================================================
-- E-1 catalog: RLS on, no anon grants, service-only RPCs closed to clients.
-- ===========================================================================
DO $e1$
DECLARE
  v_table text;
  v_fn text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['venue_booking_settings', 'venue_capacity_pools', 'venue_capacity_overrides',
                                 'venue_offer_price_options', 'venue_offer_spaces', 'venue_passes', 'venue_check_in_log'] LOOP
    PERFORM public.t4490_ok((SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_table)::regclass),
      'E-1a RLS is on for ' || v_table);
    PERFORM public.t4490_ok(NOT has_table_privilege('anon', 'public.' || v_table, 'SELECT'),
      'E-1b anon cannot read ' || v_table);
    PERFORM public.t4490_ok(NOT has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE'),
      'E-1c authenticated cannot write ' || v_table);
  END LOOP;
  PERFORM public.t4490_ok(NOT has_table_privilege('authenticated', 'public.venue_passes', 'SELECT'),
    'E-1d passes (and their token hash) are not readable by any signed-in user');
  -- TEST-MOD-APPROVED #4490: P3 adds extras/answers to the quote and the pay mode to pay.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_4490_quote_offer(uuid,uuid,jsonb,text,uuid,text,jsonb,jsonb)',
    'public.issue_4490_create_offer_group(uuid,uuid,jsonb,text,uuid,bytea,text)',
    'public.issue_4490_prepare_offer_payment(uuid,bytea,uuid,text,bigint,text)',
    'public.issue_4490_get_offer_booking(uuid,bytea,uuid,text)',
    'public.issue_4490_check_in_scan(uuid,text,integer,boolean,uuid,text)',
    'public.issue_4490_gate_sale(uuid,uuid,jsonb,text,jsonb,text,uuid,uuid,bytea)'] LOOP
    PERFORM public.t4490_ok(NOT has_function_privilege('anon', v_fn, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
      AND has_function_privilege('service_role', v_fn, 'EXECUTE'),
      'E-1e service role only: ' || v_fn);
  END LOOP;
  PERFORM public.t4490_ok(has_function_privilege('anon', 'public.pg_venue_offer_availability(uuid,date,date,integer,uuid)', 'EXECUTE'),
    'E-1f availability is public');
  PERFORM public.t4490_ok(NOT has_function_privilege('anon', 'public.issue_4490_manage_offer(text,uuid,jsonb,bigint,text)', 'EXECUTE'),
    'E-1g anon cannot author offers');
  PERFORM public.t4490_ok('entry' = ANY(public.issue_4490_built_features()), 'E-1h entry is a built feature (hosts can switch it on)');
END
$e1$;

-- ===========================================================================
-- E-2 authoring rules.
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_manage_offer('upsert_price_option', '44907000-0000-4000-9000-0000000000a1',
  jsonb_build_object('offerId', %L::uuid, 'name', '   ', 'unit', 'guest', 'guestMin', 1, 'guestMax', 5, 'priceMinor', 100),
  (SELECT version FROM public.stay_offerings WHERE id = %L), 'p2-e2-blank')$$,
  (SELECT v FROM t4490_ids WHERE k = 'offer'), (SELECT v FROM t4490_ids WHERE k = 'offer')),
  '22023', 'option_name_required', 'E-2a a price option must be named (no default "Standard")');
SELECT public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.venue_offer_price_options WHERE lower(name) = 'standard'),
  'E-2b the server never invents an option name');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_manage_offer('publish', '44907000-0000-4000-9000-0000000000a1',
  jsonb_build_object('offerId', %L::uuid), 1, 'p2-e2-stale')$$, (SELECT v FROM t4490_ids WHERE k = 'offer')),
  'PT409', 'stale_write', 'E-2c a stale expected version is refused');

-- guest_max over the pool's day limit is refused at publish.
DO $e2$
DECLARE
  v jsonb;
  v_offer uuid;
  v_pool uuid;
BEGIN
  v := public.issue_4490_manage_capacity_pool('create', '44907000-0000-4000-9000-0000000000a2',
    '{"name":"Arcade day","dailyLimit":10,"keptForWalkIns":0}'::jsonb, NULL, 'p2-e2-pool-small');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', '44907000-0000-4000-9000-0000000000a2',
    '{"kind":"entry","name":"Big group entry","entryStyle":"day_pass"}'::jsonb, NULL, 'p2-e2-big-1');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('big_offer', v_offer);
  v := public.issue_4490_manage_offer('set_pool', '44907000-0000-4000-9000-0000000000a2',
    jsonb_build_object('offerId', v_offer, 'poolId', v_pool), (v->>'version')::bigint, 'p2-e2-big-2');
  v := public.issue_4490_manage_offer('upsert_price_option', '44907000-0000-4000-9000-0000000000a2',
    jsonb_build_object('offerId', v_offer, 'name', 'Group of 50', 'unit', 'guest', 'guestMin', 1, 'guestMax', 50,
      'priceMinor', 100000), (v->>'version')::bigint, 'p2-e2-big-3');
  v := public.issue_4490_manage_offer('set_policy', '44907000-0000-4000-9000-0000000000a2',
    jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'p2-e2-big-4');
  v := public.issue_4490_manage_offer('set_schedule', '44907000-0000-4000-9000-0000000000a2',
    jsonb_build_object('offerId', v_offer, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '10:00', 'endTime', '22:00'),
    (v->>'version')::bigint, 'p2-e2-big-5');
  PERFORM public.t4490_ok(v->'readiness' ? 'guest_max_over_capacity', 'E-2d readiness names guest_max_over_capacity');
  BEGIN
    PERFORM public.issue_4490_manage_offer('publish', '44907000-0000-4000-9000-0000000000a2',
      jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'p2-e2-big-6');
    RAISE EXCEPTION 'T4490 FAIL: E-2e publish should be refused';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM public.t4490_ok(SQLERRM = 'offer_not_ready:guest_max_over_capacity',
      'E-2e guest_max above the day limit -> offer_not_ready:guest_max_over_capacity (' || SQLERRM || ')');
  END;
END
$e2$;

-- Idempotency: replay returns the first result; a different payload on the same key conflicts.
DO $e2b$
DECLARE
  v1 jsonb;
  v2 jsonb;
BEGIN
  v1 := public.issue_4490_manage_capacity_pool('create', '44907000-0000-4000-9000-0000000000a1',
    '{"name":"Replay pool","dailyLimit":10}'::jsonb, NULL, 'p2-e2-replay');
  v2 := public.issue_4490_manage_capacity_pool('create', '44907000-0000-4000-9000-0000000000a1',
    '{"name":"Replay pool","dailyLimit":10}'::jsonb, NULL, 'p2-e2-replay');
  PERFORM public.t4490_ok(v2->>'id' = v1->>'id' AND (v2->>'replayed')::boolean,
    'E-2f an idempotent replay returns the first result');
  BEGIN
    PERFORM public.issue_4490_manage_capacity_pool('create', '44907000-0000-4000-9000-0000000000a1',
      '{"name":"Other pool","dailyLimit":10}'::jsonb, NULL, 'p2-e2-replay');
    RAISE EXCEPTION 'T4490 FAIL: E-2g';
  EXCEPTION WHEN unique_violation THEN
    PERFORM public.t4490_ok(SQLERRM = 'offer_idempotency_conflict', 'E-2g same key, different request -> 23505 offer_idempotency_conflict');
  END;
END
$e2b$;

-- Publish needs the feature on.
SELECT public.issue_4490_set_venue_feature('44907000-0000-4000-9000-0000000000a1', 'entry', false, NULL, NULL, NULL, 'p2-e2-off') IS NOT NULL AS feature_off;
SELECT public.t4490_expect(format($$SELECT public.issue_4490_manage_offer('publish', '44907000-0000-4000-9000-0000000000a1',
  jsonb_build_object('offerId', %L::uuid), (SELECT version FROM public.stay_offerings WHERE id = %L), 'p2-e2-pub-off')$$,
  (SELECT v FROM t4490_ids WHERE k = 'offer'), (SELECT v FROM t4490_ids WHERE k = 'offer')),
  'P0001', 'offer_not_ready:feature_off', 'E-2h an offer cannot go live while Entry is off');
SELECT public.issue_4490_set_venue_feature('44907000-0000-4000-9000-0000000000a1', 'entry', true, NULL, NULL, NULL, 'p2-e2-on') IS NOT NULL AS feature_on;
DO $e2c$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_manage_offer('publish', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')),
    (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')), 'p2-e2-pub');
  PERFORM public.t4490_ok(v->>'status' = 'live' AND (v->>'windowsCreated')::int > 300,
    'E-2i publish puts the offer live and materialises a year of windows (' || (v->>'windowsCreated') || ')');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.stay_fee_versions f
      WHERE f.offering_id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer') AND f.fee_key = 'vat' AND f.effective_to IS NULL
        AND f.basis_points = 750 AND f.display_mode = 'included') = 1,
    'E-2j publish writes the venue VAT (7.5%, included by default)');
  PERFORM public.t4490_ok(jsonb_array_length(v->'readiness') = 0, 'E-2k a live offer reports no readiness gaps');
END
$e2c$;

-- Turning Entry off pauses the live offer; bookings are kept.
DO $e2d$
BEGIN
  PERFORM public.issue_4490_set_venue_feature('44907000-0000-4000-9000-0000000000a1', 'entry', false, NULL, NULL, NULL, 'p2-e2-off2');
  PERFORM public.t4490_ok((SELECT status FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')) = 'paused',
    'E-2l turning Entry off pauses its live offers');
  PERFORM public.issue_4490_set_venue_feature('44907000-0000-4000-9000-0000000000a1', 'entry', true, NULL, NULL, NULL, 'p2-e2-on2');
  PERFORM public.issue_4490_manage_offer('publish', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')),
    (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')), 'p2-e2-pub2');
END
$e2d$;

-- Day limits (per-date override) and permissions.
SELECT public.t4490_ok((public.issue_4490_set_capacity_override('44907000-0000-4000-9000-0000000000a1',
    (SELECT v FROM t4490_ids WHERE k = 'pool'), (current_date + 3), 3, 0, false, false, 'p2-e2-override')->>'dailyLimit')::int = 3,
  'E-2m a host sets a day limit for one date');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000003');
SELECT public.t4490_expect($$SELECT public.issue_4490_manage_offer('create_draft', '44907000-0000-4000-9000-0000000000a1',
  '{"kind":"entry","name":"Sneaky","entryStyle":"walk_in"}'::jsonb, NULL, 'p2-e2-staff')$$,
  '42501', 'not_authorized', 'E-2n check-in-only staff cannot author offers');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000005');
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_capacity_pools) = 0
  AND (SELECT count(*) FROM public.venue_offer_price_options) = 0, 'E-2o an outsider reads no pools or options');
SELECT public.t4490_expect($$SELECT public.issue_4490_list_offers('44907000-0000-4000-9000-0000000000a1')$$,
  '42501', 'not_authorized', 'E-2p an outsider cannot list offers');
SELECT public.t4490_as(NULL);
SELECT public.t4490_expect($$SELECT count(*) FROM public.venue_capacity_pools$$, '42501', NULL, 'E-2q anon cannot read pools');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.t4490_ok(
  (public.issue_4490_manage_offer('create_draft', '44907000-0000-4000-9000-0000000000a3',
    '{"kind":"entry","name":"Pool day","entryStyle":"day_pass"}'::jsonb, NULL, 'p2-e2-stay')->>'kind') = 'entry',
  'E-2r a Stay venue can also create a venue offer');
SELECT public.t4490_ok(jsonb_array_length(public.issue_4490_list_offers('44907000-0000-4000-9000-0000000000a1')->'offers') = 1,
  'E-2s the owner lists the venue''s offers');
SELECT public.t4490_reset();

-- ===========================================================================
-- S: Stays isolation.
-- ===========================================================================
-- An offer booking (bought signed in) for the isolation checks.
SELECT public.t4490_service();
DO $s0$
DECLARE
  v_q jsonb;
  v_g jsonb;
  v_window uuid;
BEGIN
  SELECT w.id INTO v_window FROM public.stay_place_windows w
  WHERE w.offering_id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer') AND w.local_date = current_date + 1;
  v_q := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), v_window,
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 2)),
    encode(sha256('user:44907000-0000-4000-8000-000000000006'::bytea), 'hex'),
    '44907000-0000-4000-8000-000000000006', 'p2-s0-quote');
  v_g := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    '{"name":"Ada Guest","email":"p2u6-4490@example.test"}'::jsonb,
    encode(sha256('user:44907000-0000-4000-8000-000000000006'::bytea), 'hex'),
    '44907000-0000-4000-8000-000000000006', sha256('tok-s0'::bytea), 'p2-s0-hold');
  INSERT INTO t4490_ids VALUES ('s_group', (v_g->>'groupId')::uuid);
  PERFORM public.t4490_ok(v_g->>'reference' LIKE 'VB-%', 'S-0 a venue booking gets a VB- reference');
END
$s0$;
SELECT public.t4490_reset();

SELECT public.t4490_as('44907000-0000-4000-8000-000000000006');
SELECT public.t4490_ok(jsonb_array_length(public.pg_my_stay_reservation_groups()) = 0,
  'S-1 the guest''s Stays list does not show a venue booking');
SELECT public.t4490_ok(jsonb_array_length(public.issue_4490_my_offer_bookings()) = 1,
  'S-2 the guest''s venue bookings list does');
SELECT public.t4490_reset();
INSERT INTO public.feature_flags (flag_key, is_enabled) VALUES ('STAY_PAYSTACK_COMMERCE', true)
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;
-- Call the Stays RPCs as the guest (claims set, grants bypassed) so their bodies run.
SELECT set_config('request.jwt.claim.sub', '44907000-0000-4000-8000-000000000006', true);
SELECT set_config('request.jwt.claims', '{"sub":"44907000-0000-4000-8000-000000000006","role":"authenticated"}', true);
SELECT public.t4490_expect(format($$SELECT public.issue_1388_quote_stay_cart('44907000-0000-4000-9000-0000000000a1',
  jsonb_build_array(jsonb_build_object('kind','place','offeringId',%L,'placeWindowId',gen_random_uuid(),'guests',1)), 'p2-s3-quote', NULL)$$,
  (SELECT v FROM t4490_ids WHERE k = 'offer')),
  'P0002', 'stay_venue_not_found', 'S-3 the Stays quote cannot see an entry offering');
DO $s4$
BEGIN
  PERFORM public.issue_1389_prepare_payment((SELECT t.v FROM t4490_ids t WHERE t.k = 's_group'), 'p2-s4-prepare', 1, NULL);
  RAISE EXCEPTION 'T4490 FAIL: S-4 the Stays prepare should refuse';
EXCEPTION WHEN OTHERS THEN
  PERFORM public.t4490_ok(SQLERRM IN ('stay_group_not_found', 'offer_rail_required'),
    'S-4 the Stays prepare cannot charge a venue booking (' || SQLERRM || ')');
END
$s4$;
SELECT public.t4490_reset();
SELECT public.t4490_expect(format($$INSERT INTO public.stay_payment_attempts (group_id, provider, attempt_ordinal, amount_minor,
  currency_code, idempotency_key, request_hash) VALUES (%L, 'paystack', 1, 100, 'NGN', 'p2-s4-direct', repeat('a', 64))$$,
  (SELECT v FROM t4490_ids WHERE k = 's_group')),
  '42501', 'offer_rail_required', 'S-4c no payment row can be written for a venue booking outside the offer rail');
SELECT public.t4490_expect(format($$INSERT INTO public.stay_cancel_previews (group_id, actor_user_id, actor_type, selected_line_ids,
  group_version, amount_minor, allocation_snapshot, preview_hash, expires_at)
  VALUES (%L, '44907000-0000-4000-8000-000000000006', 'guest', ARRAY[gen_random_uuid()], 1, 0, '[]', repeat('a', 64), now() + interval '1 hour')$$,
  (SELECT v FROM t4490_ids WHERE k = 's_group')),
  '42501', 'offer_rail_required', 'S-4d no cancel preview can be written for a venue booking outside the offer rail');
SELECT public.t4490_reset();
SELECT public.t4490_ok((SELECT count(*) FROM public.stay_payment_attempts
  WHERE group_id = (SELECT v FROM t4490_ids WHERE k = 's_group')) = 0, 'S-4b and wrote nothing');
SELECT public.t4490_ok(NOT EXISTS (
    SELECT 1 FROM public.pg_public_stays_discover(NULL, NULL, NULL, 1, 0, 1, NULL, NULL, NULL, 50, 0) d
    WHERE to_jsonb(d)::text LIKE '%44907000-0000-4000-9000-0000000000a1%'),
  'S-5 Stays discovery does not list the offer venue');
INSERT INTO public.stay_offerings (venue_id, brand_id, kind, name, status, confirmation_mode,
  inventory_basis, capacity, place_pricing_basis, entry_style)
  VALUES ('44907000-0000-4000-9000-0000000000a3', '44907000-0000-4000-9000-000000000010', 'entry', 'x', 'draft', 'instant',
          'shared_capacity', 10, 'per_guest', 'walk_in');
SELECT public.t4490_ok(EXISTS (SELECT 1 FROM public.stay_offerings
  WHERE venue_id = '44907000-0000-4000-9000-0000000000a3' AND kind = 'entry' AND name = 'x'),
  'S-6 an offer row can sit beside Stays rows on a Stay venue');
SELECT public.t4490_expect($$INSERT INTO public.stay_offerings (venue_id, brand_id, kind, name, status, confirmation_mode,
  inventory_basis, capacity, place_pricing_basis)
  VALUES ('44907000-0000-4000-9000-0000000000a1', '44907000-0000-4000-9000-000000000010', 'place', 'x', 'draft', 'instant',
          'shared_capacity', 10, 'per_guest')$$,
  '23514', 'stay_venue_brand_mismatch', 'S-7 a Stays place still needs a Stay venue');
SELECT public.t4490_expect($$INSERT INTO public.stay_offerings (venue_id, brand_id, kind, name, status, confirmation_mode,
  inventory_basis, capacity, place_pricing_basis)
  VALUES ('44907000-0000-4000-9000-0000000000a1', '44907000-0000-4000-9000-000000000010', 'entry', 'x', 'draft', 'instant',
          'shared_capacity', 10, 'per_guest')$$,
  '23514', NULL, 'S-8 an entry offer needs an entry style');
SELECT public.t4490_ok((SELECT count(*) FROM pg_indexes WHERE indexname = 'stay_price_one_current_idx'
  AND indexdef LIKE '%COALESCE(price_option_id%') = 1, 'S-9 one current price per offering stays true for Stays (option-aware index)');
SELECT public.t4490_ok(
  (SELECT public_reference FROM public.stay_reservation_groups WHERE id = (SELECT v FROM t4490_ids WHERE k = 's_group')) ~ '^VB-'
  AND NOT EXISTS (SELECT 1 FROM public.stay_reservation_groups WHERE offer_kind IS NULL AND public_reference LIKE 'VB-%'),
  'S-10 Stays keep ST- references, venue bookings VB-');
ROLLBACK;
