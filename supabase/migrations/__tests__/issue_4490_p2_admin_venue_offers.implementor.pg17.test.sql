-- #4490 P2-7 (Admin venue offers, 20281203114490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-ADMIN-OFFER-MODERATION | issue #4490 | only Mingla admins list venue offers across venues, and every admin pause or resume of a venue offer is written to admin_audit_log with its required reason.
--
-- A-1 grants: anon cannot list; the list is admin only.
-- A-2 an admin lists the live entry offer (venue, brand, from-price), filters by status and searches by venue name.
-- A-3 a brand owner who is not a Mingla admin is refused.
-- A-4 pause needs a reason (3+ characters); a pause is audited with its reason and the list shows it paused.
-- A-5 resume puts it back on sale and is audited too.
--
-- FAILS-ON-REVERT: drop the is_admin_user check -> A-3; drop the kind filter -> A-2c.
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

-- Mingla admin 08; publish the fixture offer.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('44907000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p2u8-4490@example.test', now(), now());
INSERT INTO public.admin_users (email, role, status) VALUES ('p2u8-4490@example.test', 'admin', 'active');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $pub$
BEGIN
  PERFORM public.issue_4490_manage_offer('publish', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')),
    (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')), 'p2-a-pub');
END
$pub$;
SELECT public.t4490_reset();

-- A-1 grants ---------------------------------------------------------------------------
SELECT public.t4490_ok(
  NOT has_function_privilege('anon', 'public.admin_list_venue_offers(text,text,integer,integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_list_venue_offers(text,text,integer,integer)', 'EXECUTE'),
  'A-1 anon cannot call the admin list; signed-in callers reach the admin check');

-- A-2 admin list -----------------------------------------------------------------------
SELECT public.t4490_as('44907000-0000-4000-8000-000000000008');
SELECT public.t4490_ok(
  (SELECT bool_or(r->>'id' = (SELECT t.v::text FROM t4490_ids t WHERE t.k = 'offer')
        AND r->>'status' = 'live' AND r->>'kind' = 'entry' AND r->>'venueName' = 'Gameland P2'
        AND r->>'brandName' = 'Harmattan P2 4490' AND (r->>'fromMinor')::bigint = 400000 AND r->>'currency' = 'NGN')
   FROM jsonb_array_elements(public.admin_list_venue_offers(NULL, NULL, 25, 0)->'rows') r),
  'A-2a an admin sees the live entry offer with its venue, brand and from-price');
SELECT public.t4490_ok(
  (public.admin_list_venue_offers('gameland p2', 'live', 25, 0)->>'total')::int >= 1
  AND (public.admin_list_venue_offers('no such venue zz', NULL, 25, 0)->>'total')::int = 0
  AND (public.admin_list_venue_offers('Gameland P2', 'paused', 25, 0)->>'total')::int = 0,
  'A-2b search by venue name and filter by status');
SELECT public.t4490_ok(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.admin_list_venue_offers(NULL, NULL, 100, 0)->'rows') r
              WHERE r->>'kind' IN ('room', 'place')),
  'A-2c Stays rooms and places are never listed as venue offers');
SELECT public.t4490_expect($$SELECT public.admin_list_venue_offers(NULL, 'gone', 25, 0)$$, '22023', 'invalid_payload',
  'A-2d an unknown status is refused');

-- A-3 not an admin ---------------------------------------------------------------------
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.t4490_expect($$SELECT public.admin_list_venue_offers(NULL, NULL, 25, 0)$$, '42501', 'not_authorized',
  'A-3 a brand owner who is not a Mingla admin cannot list');

-- A-4 pause with a reason, audited -----------------------------------------------------
SELECT public.t4490_as('44907000-0000-4000-8000-000000000008');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_admin_set_offer_status(%L, 'paused', 'no')$$,
    (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')), '22023', 'invalid_payload',
  'A-4a a pause without a real reason is refused');
SELECT public.t4490_ok(
  (public.issue_4490_admin_set_offer_status((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), 'paused',
     'Reported misleading price')->>'status') = 'paused',
  'A-4b an admin pauses the offer');
SELECT public.t4490_ok(
  (public.admin_list_venue_offers('Gameland P2', 'paused', 25, 0)->>'total')::int = 1,
  'A-4c the list shows it paused');
SELECT public.t4490_reset();
SELECT public.t4490_ok(
  EXISTS (SELECT 1 FROM public.admin_audit_log a
          WHERE a.action = 'venue_offer_status' AND a.target_id = (SELECT t.v::text FROM t4490_ids t WHERE t.k = 'offer')
            AND a.reason = 'Reported misleading price' AND a.metadata->>'status' = 'paused'),
  'A-4d the pause is in the admin audit log with its reason');

-- A-5 resume ---------------------------------------------------------------------------
SELECT public.t4490_as('44907000-0000-4000-8000-000000000008');
SELECT public.t4490_ok(
  (public.issue_4490_admin_set_offer_status((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), 'live',
     'Host fixed the price')->>'status') = 'live',
  'A-5a an admin resumes the offer');
SELECT public.t4490_reset();
SELECT public.t4490_ok(
  (SELECT count(*) FROM public.admin_audit_log a
   WHERE a.action = 'venue_offer_status' AND a.target_id = (SELECT t.v::text FROM t4490_ids t WHERE t.k = 'offer')) = 2,
  'A-5b both moderation steps are audited');

ROLLBACK;
