-- #4490 P6-1 (memberships, monthly; 20281203194490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-MEMBER-ACCESS | issue #4490 | a member record (read, pay, leave, pause, member price) opens only with its own member token or for its own signed-in member; staff reads need venue member rights.
-- MINGLA-INVARIANT: I-4490-MONTH-ONCE | issue #4490 | one row per (member, month start); the billing run is idempotent (one month, one email per step); a paid month owes nothing, so paying one renewal link twice is refused.
-- MINGLA-INVARIANT: I-4490-NO-AUTO-CHARGE | issue #4490 | renewal is an email with a pay link; a month is paid only by the member's own payment (or marked paid at the venue by money rights), never charged in the background.
--
-- M-1 plans: authoring, rules, who may. M-2 publish, public page, hidden offering. M-3 join (signed out), replay, full.
-- M-4 first month paid on the offer rail -> active, credits, message, no booking pass / Today row. M-5 a paid month owes nothing.
-- M-6 a stranger (anon, another account, a wrong token) gets nothing; RLS and grants.
-- M-7 member price: room hours first, discount after, entry free + guest passes, credits spent at hold and back on lapse.
-- M-8 check-in: scan, once a day, undo, guests on passes, day limit, lapsed refused.
-- M-9 renewal across months (shifted clock), idempotent run, pay the renewal link, credits expire.
-- M-10 due -> grace -> lapsed, pay restores; never-paid join closed. M-11 leave / stay / pause / resume (member).
-- M-12 staff: pause now, resume, cancel with reason, send link, mark paid (money rights only). M-13 Host and Admin reads.
--
-- FAILS-ON-REVERT (seen): remove the paid-month check in issue_4490_membership_prepare_payment (open period only)
--   -> M-5a pays the same month twice ("no error").
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
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

-- People: 01 owner, 05 outsider, 06 signed-in member, 07 event manager (no money rights),
-- 08 venue staff with check-in only, 09 venue staff with venue.manage_members, 10 Mingla admin.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44906000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p6u' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 10) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44906000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44906000-0000-4000-9000-000000000010', '44906000-0000-4000-8000-000000000001', 'Harmattan P6 4490',
        'harmattan-p6-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44906000-0000-4000-9000-0000000000a1', '44906000-0000-4000-9000-000000000010', 'korap64490', 'Kora P6', 6.45, 3.41, 'coworking', 'verified', 'NG'),
  ('44906000-0000-4000-9000-0000000000a2', '44906000-0000-4000-9000-000000000010', 'studiop64490', 'Studio P6', 6.45, 3.42, 'creative_and_arts', 'verified', 'NG');
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44906000-0000-4000-c000-000000000007', '44906000-0000-4000-9000-000000000010', '44906000-0000-4000-8000-000000000007', 'event_manager', now()),
  ('44906000-0000-4000-c000-000000000008', '44906000-0000-4000-9000-000000000010', '44906000-0000-4000-8000-000000000008', 'venue_staff', now()),
  ('44906000-0000-4000-c000-000000000009', '44906000-0000-4000-9000-000000000010', '44906000-0000-4000-8000-000000000009', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44906000-0000-4000-c000-000000000008', '44906000-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']),
  ('44906000-0000-4000-c000-000000000009', '44906000-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.manage_members']);
INSERT INTO public.admin_users (email, role, status) VALUES ('p6u10-4490@example.test', 'admin', 'active');

CREATE TEMP TABLE t4490_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490_ids TO PUBLIC;
CREATE FUNCTION public.t4490_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t4490_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t4490_key(p_seed text) RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $f$;
CREATE FUNCTION public.t4490_tok(p_seed text) RETURNS bytea LANGUAGE sql AS $f$ SELECT sha256(convert_to('mtok:' || p_seed, 'UTF8')) $f$;
CREATE FUNCTION public.t4490_day() RETURNS date LANGUAGE sql AS $f$ SELECT (now() AT TIME ZONE 'Africa/Lagos')::date + 3 $f$;
CREATE FUNCTION public.t4490_at(p_hhmm text, p_day date DEFAULT NULL) RETURNS timestamptz LANGUAGE sql AS $f$
  SELECT (COALESCE(p_day, public.t4490_day()) + p_hhmm::time) AT TIME ZONE 'Africa/Lagos' $f$;
-- Join (what edge venue-offers membership_join does).
CREATE FUNCTION public.t4490_join(p_plan uuid, p_seed text, p_user uuid DEFAULT NULL, p_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.issue_4490_membership_join(gen_random_uuid(), p_plan,
    jsonb_build_object('name', 'Member ' || p_seed, 'email', p_seed || '@example.test'), NULL,
    public.t4490_key('cart:' || p_seed), p_user, public.t4490_tok(p_seed), COALESCE(p_key, 'join-' || p_seed));
$f$;
-- Pay the open month (what edge venue-membership-pay-link + the provider webhook do).
CREATE FUNCTION public.t4490_pay_member(p_sub uuid, p_seed text, p_n integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_p jsonb;
  v_ref text;
BEGIN
  v_p := public.issue_4490_membership_prepare_payment(p_sub, public.t4490_tok(p_seed), NULL, 'mpay-' || p_seed || '-' || p_n);
  v_ref := 'mingla_stay_' || replace(v_p->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((v_p->>'attemptId')::uuid, v_ref, NULL, NULL);
  PERFORM public.issue_1389_finalize_payment('paystack', 'evt-' || p_seed || '-' || p_n, 'charge.success', v_ref,
    'ch-' || p_seed || '-' || p_n, (v_p->>'amountMinor')::bigint, 'NGN', 0, NULL);
  RETURN v_p;
END
$f$;
-- A member's by-the-hour booking with the member price (quote, member quote, hold).
CREATE FUNCTION public.t4490_member_hour(p_sub uuid, p_seed text, p_member text, p_at timestamptz, p_minutes integer)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_q jsonb;
  v_m jsonb;
  v_g jsonb;
BEGIN
  v_q := public.issue_4490_quote_offer(public.t4490_id('board'), public.issue_4490_flexible_window(public.t4490_id('board'), p_at, p_minutes),
    jsonb_build_array(jsonb_build_object('guests', 2)), public.t4490_key('cart:' || p_seed), NULL, 'quote-' || p_seed);
  v_m := public.issue_4490_member_quote((v_q->>'quoteId')::uuid, p_sub, public.t4490_tok(p_member), NULL,
    public.t4490_key('cart:' || p_seed), true);
  v_g := public.issue_4490_create_offer_group(gen_random_uuid(), (v_m->>'quoteId')::uuid,
    jsonb_build_object('name', 'Guest ' || p_seed, 'email', p_seed || '@example.test'), public.t4490_key('cart:' || p_seed), NULL,
    sha256(convert_to('tok:' || p_seed, 'UTF8')), 'hold-' || p_seed);
  RETURN v_g || jsonb_build_object('quote', v_q, 'memberQuote', v_m);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490_id(text), public.t4490_key(text), public.t4490_tok(text), public.t4490_day(),
  public.t4490_at(text, date), public.t4490_join(uuid, text, uuid, text), public.t4490_pay_member(uuid, text, integer),
  public.t4490_member_hour(uuid, text, text, timestamptz, integer) TO PUBLIC;

-- ===========================================================================
-- Fixture (owner): features, VAT added, a Day pass (entry, day limit 5, none
-- kept), the Boardroom by the hour (N12,000 an hour, 08:00-20:00, 30-minute
-- steps, 1-2 hours).
-- ===========================================================================
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
DO $fx$
DECLARE
  a1 uuid := '44906000-0000-4000-9000-0000000000a1';
  v jsonb;
  s jsonb;
  v_pool uuid;
  v_offer uuid;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a1, 'entry', true, NULL, NULL, NULL, 'p6-fx-entry');
  PERFORM public.issue_4490_set_venue_feature(a1, 'by_the_hour', true, NULL, NULL, NULL, 'p6-fx-hour');
  PERFORM public.issue_4490_save_booking_settings(a1, '{"vatMode":"added"}'::jsonb, NULL, 'p6-fx-vat');
  v := public.issue_4490_manage_capacity_pool('create', a1, '{"name":"Kora day","dailyLimit":5,"keptForWalkIns":0}'::jsonb, NULL, 'p6-fx-pool');
  v_pool := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('pool', v_pool);
  v := public.issue_4490_manage_offer('create_draft', a1, '{"kind":"entry","name":"Day pass","entryStyle":"day_pass"}'::jsonb, NULL, 'p6-fx-e1');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('daypass', v_offer);
  v := public.issue_4490_manage_offer('set_pool', a1, jsonb_build_object('offerId', v_offer, 'poolId', v_pool), (v->>'version')::bigint, 'p6-fx-e2');
  v := public.issue_4490_manage_offer('upsert_price_option', a1, jsonb_build_object('offerId', v_offer, 'name', 'Day pass', 'unit', 'guest',
    'guestMin', 1, 'guestMax', 4, 'priceMinor', 600000), (v->>'version')::bigint, 'p6-fx-e3');
  INSERT INTO t4490_ids SELECT 'dayopt', (o->>'id')::uuid FROM jsonb_array_elements(v->'options') o;
  v := public.issue_4490_manage_offer('set_policy', a1, jsonb_build_object('offerId', v_offer, 'refundLadder',
    jsonb_build_array(jsonb_build_object('minMinutesBefore', 1440, 'refundBps', 10000))), (v->>'version')::bigint, 'p6-fx-e4');
  v := public.issue_4490_manage_offer('set_schedule', a1, jsonb_build_object('offerId', v_offer, 'mode', 'full_day',
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '00:00', 'endTime', '23:59'), (v->>'version')::bigint, 'p6-fx-e5');
  v := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'p6-fx-e6');
  s := public.issue_4490_manage_space('create', a1, '{"name":"Boardroom","setting":"indoor","capacity_seated":10}'::jsonb, NULL);
  v := public.issue_4490_manage_offer('create_draft', a1, '{"kind":"by_the_hour","name":"Boardroom"}'::jsonb, NULL, 'p6-fx-h1');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('board', v_offer);
  v := public.issue_4490_manage_hour('set_place', a1, jsonb_build_object('offerId', v_offer, 'spaceIds', jsonb_build_array(s->>'id')),
    (v->>'version')::bigint, 'p6-fx-h2');
  v := public.issue_4490_manage_offer('upsert_price_option', a1, jsonb_build_object('offerId', v_offer, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 10, 'priceMinor', 1200000), (v->>'version')::bigint, 'p6-fx-h3');
  v := public.issue_4490_manage_offer('set_policy', a1, jsonb_build_object('offerId', v_offer, 'refundLadder', jsonb_build_array(
    jsonb_build_object('minMinutesBefore', 1440, 'refundBps', 10000))), (v->>'version')::bigint, 'p6-fx-h4');
  v := public.issue_4490_manage_hour('set_hours', a1, jsonb_build_object('offerId', v_offer, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '08:00', 'endTime', '20:00'), (v->>'version')::bigint, 'p6-fx-h5');
  v := public.issue_4490_manage_hour('set_length', a1, jsonb_build_object('offerId', v_offer, 'stepMinutes', 30, 'minMinutes', 60,
    'maxMinutes', 120), (v->>'version')::bigint, 'p6-fx-h6');
  v := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'p6-fx-h7');
  PERFORM public.t4490_ok(v->>'status' = 'live', 'fixture: Day pass and Boardroom live');
END
$fx$;
SELECT public.t4490_reset();

-- ===========================================================================
-- M-1 Plans: authoring, rules, who may.
-- ===========================================================================
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
DO $m1$
DECLARE
  a1 uuid := '44906000-0000-4000-9000-0000000000a1';
  v jsonb;
  p jsonb;
BEGIN
  PERFORM public.t4490_ok('memberships' = ANY(public.issue_4490_built_features()), 'M-1a memberships is a built feature');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_manage_membership_plan('create', %L,
      '{"name":"Free desk","priceMinor":0}'::jsonb, NULL, 'p6-m1-bad-price')$q$, a1),
    '22023', 'plan_price_invalid', 'M-1b a plan needs a price of at least 1');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_manage_membership_plan('create', %L,
      jsonb_build_object('name', 'Hot desk', 'priceMinor', 8500000, 'entryIncluded', true, 'entryOfferingId', %L), NULL, 'p6-m1-bad-entry')$q$,
      a1, public.t4490_id('board')),
    '22023', 'plan_entry_invalid', 'M-1c entry included must name an entry offer of this venue');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_manage_membership_plan('create', %L,
      jsonb_build_object('name', 'Hot desk', 'priceMinor', 8500000, 'roomHours', 4, 'hourOfferingIds', jsonb_build_array(%L)), NULL, 'p6-m1-bad-rooms')$q$,
      a1, public.t4490_id('daypass')),
    '22023', 'plan_room_offers_invalid', 'M-1d room hours link to by-the-hour offers only');
  p := jsonb_build_object(
    'name', 'Hot desk', 'inclusions', jsonb_build_array('Every weekday, 8 AM to 8 PM', '4 meeting-room hours a month', '2 guest passes a month'),
    'priceMinor', 8500000, 'entryIncluded', true, 'entryOfferingId', public.t4490_id('daypass'),
    'roomHours', 4, 'hourOfferingIds', jsonb_build_array(public.t4490_id('board')), 'guestPasses', 2,
    'discountBps', 1000, 'discountKinds', jsonb_build_array('by_the_hour'), 'graceDays', 7);
  v := public.issue_4490_manage_membership_plan('create', a1, p, NULL, 'p6-m1-hot');
  INSERT INTO t4490_ids VALUES ('hot', (v->>'id')::uuid);
  PERFORM public.t4490_ok(v->>'status' = 'draft' AND (v->>'priceMinor')::bigint = 8500000 AND (v->>'roomHours')::numeric = 4
                          AND (v->>'guestPasses')::integer = 2 AND v->>'interval' = 'month' AND v->>'entryOfferName' = 'Day pass'
                          AND v->'hourOfferNames' = '["Boardroom"]'::jsonb,
    'M-1e Hot desk N85,000 a month: entry (Day pass), 4 Boardroom hours, 2 guest passes, 10% off rooms');
  PERFORM public.t4490_ok((SELECT o.kind = 'membership' AND o.status = 'draft' FROM public.stay_offerings o
                           JOIN public.venue_membership_plans p ON p.offering_id = o.id WHERE p.id = (v->>'id')::uuid),
    'M-1f the plan owns a hidden membership offering');
  v := public.issue_4490_manage_membership_plan('create', a1, p, NULL, 'p6-m1-hot');
  PERFORM public.t4490_ok((v->>'replayed')::boolean AND v->>'id' = public.t4490_id('hot')::text, 'M-1g a repeated create with the same key replays');
END
$m1$;
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
SELECT public.t4490_expect($q$SELECT public.issue_4490_manage_membership_plan('create', '44906000-0000-4000-9000-0000000000a1',
    '{"name":"Other","priceMinor":100}'::jsonb, NULL, 'p6-m1-hot')$q$,
  '23505', 'offer_idempotency_conflict', 'M-1h the same key with another plan is refused');
SELECT public.t4490_reset();

SELECT public.t4490_as('44906000-0000-4000-8000-000000000009');
DO $m1b$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_manage_membership_plan('create', '44906000-0000-4000-9000-0000000000a1', jsonb_build_object(
    'name', 'Dedicated desk', 'priceMinor', 14000000, 'maxMembers', 2, 'graceDays', 7), NULL, 'p6-m1-dedicated');
  INSERT INTO t4490_ids VALUES ('dedicated', (v->>'id')::uuid);
  PERFORM public.t4490_ok(v->>'name' = 'Dedicated desk' AND (v->>'maxMembers')::integer = 2,
    'M-1i venue staff with venue.manage_members creates a plan (Dedicated desk N140,000, 2 places)');
END
$m1b$;
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000008');
SELECT public.t4490_expect($q$SELECT public.issue_4490_manage_membership_plan('create', '44906000-0000-4000-9000-0000000000a1',
    '{"name":"X","priceMinor":100}'::jsonb, NULL, 'p6-m1-door')$q$, '42501', 'not_authorized',
  'M-1j check-in-only staff cannot author plans');
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000005');
SELECT public.t4490_expect($q$SELECT public.issue_4490_manage_membership_plan('create', '44906000-0000-4000-9000-0000000000a1',
    '{"name":"X","priceMinor":100}'::jsonb, NULL, 'p6-m1-out')$q$, '42501', 'not_authorized',
  'M-1k an outsider cannot author plans');
SELECT public.t4490_reset();

-- ===========================================================================
-- M-2 Publish (feature first), public page, the hidden offering stays hidden.
-- ===========================================================================
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
DO $m2$
DECLARE
  a1 uuid := '44906000-0000-4000-9000-0000000000a1';
  v jsonb;
BEGIN
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_manage_membership_plan('publish', %L,
      jsonb_build_object('planId', %L), 1, 'p6-m2-early')$q$, a1, public.t4490_id('hot')),
    'P0001', 'offer_not_ready:feature_off', 'M-2a a plan cannot go on sale while Memberships is off');
  v := public.issue_4490_set_venue_feature(a1, 'memberships', true, NULL, NULL, NULL, 'p6-m2-feature');
  v := public.issue_4490_manage_membership_plan('publish', a1, jsonb_build_object('planId', public.t4490_id('hot')), 1, 'p6-m2-pub');
  PERFORM public.t4490_ok(v->>'status' = 'live', 'M-2b Hot desk on sale');
  v := public.issue_4490_manage_membership_plan('publish', a1, jsonb_build_object('planId', public.t4490_id('dedicated')), 1, 'p6-m2-pub2');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_manage_membership_plan('update', %L,
      jsonb_build_object('planId', %L, 'priceMinor', 9000000), 1, 'p6-m2-stale')$q$, a1, public.t4490_id('hot')),
    'PT409', 'stale_write', 'M-2c an old version cannot overwrite the plan');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.issue_4490_list_offers(a1)->'offers') o
                                      WHERE o->>'kind' = 'membership'),
    'M-2d the Host offers list never shows a plan''s hidden offering');
  v := public.issue_4490_membership_plans(a1);
  PERFORM public.t4490_ok(jsonb_array_length(v->'plans') = 2 AND (v->>'featureOn')::boolean AND (v->>'canManage')::boolean
                          AND jsonb_array_length(v->'hourOffers') = 1,
    'M-2e Host plans list: 2 plans, the by-the-hour offers to link');
END
$m2$;
SELECT public.t4490_reset();
SELECT public.t4490_as(NULL);
DO $m2b$
DECLARE
  v jsonb;
BEGIN
  v := public.pg_public_venue_page('harmattan-p6-4490', 'korap64490');
  PERFORM public.t4490_ok((v->'memberships'->>'fromMinor')::bigint = 8500000 AND v->'memberships'->>'interval' = 'month'
                          AND jsonb_array_length(v->'memberships'->'plans') = 2 AND v->'features' ? 'memberships'
                          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'offers') o WHERE o->>'kind' = 'membership'),
    'M-2f anyone sees plans from N85,000 a month on the venue page (no hidden offering in offers)');
END
$m2b$;
SELECT public.t4490_reset();

-- ===========================================================================
-- M-3 Join with no account.
-- ===========================================================================
SELECT public.t4490_service();
DO $m3$
DECLARE
  v jsonb;
  w jsonb;
BEGIN
  v := public.t4490_join(public.t4490_id('hot'), 'amaka');
  INSERT INTO t4490_ids VALUES ('amaka', (v->>'subscriptionId')::uuid);
  -- TEST-MOD-APPROVED #4490 (06-W4 fix 1, W4-N2): the amount due is what the page charges (N85,000 + 7.5% VAT
  -- = N91,375, as M-4 pays); the plan price is baseMinor. It used to pin the price before VAT.
  PERFORM public.t4490_ok(v->>'status' = 'pending' AND (v->'paymentDue'->>'amountMinor')::bigint = 9137500
                          AND (v->'paymentDue'->>'baseMinor')::bigint = 8500000
                          AND v->>'memberPath' = '/visit/plan/' || (v->>'subscriptionId') AND NOT (v ? 'pass'),
    'M-3a a stranger joins Hot desk: waiting for the first month (N85,000 + VAT = N91,375), no pass yet');
  w := public.t4490_join(public.t4490_id('hot'), 'amaka');
  PERFORM public.t4490_ok((w->>'replayed')::boolean AND w->>'subscriptionId' = v->>'subscriptionId',
    'M-3b the same join again (same key) returns the same member');
  PERFORM public.t4490_expect($q$SELECT public.issue_4490_membership_join(gen_random_uuid(), public.t4490_id('hot'),
      '{"name":"Someone else","email":"else@example.test"}'::jsonb, NULL, public.t4490_key('cart:amaka'), NULL,
      public.t4490_tok('else'), 'join-amaka')$q$, '23505', 'offer_idempotency_conflict',
    'M-3c the same key with another person is refused');
  PERFORM public.t4490_expect($q$SELECT public.issue_4490_membership_join(gen_random_uuid(), public.t4490_id('hot'),
      '{"name":"","email":"x@example.test"}'::jsonb, NULL, public.t4490_key('cart:x'), NULL, public.t4490_tok('x'), 'join-x-1')$q$,
    '22023', 'membership_member_invalid', 'M-3d a name and an email are needed');
  v := public.t4490_join(public.t4490_id('dedicated'), 'seun');
  INSERT INTO t4490_ids VALUES ('seun', (v->>'subscriptionId')::uuid);
  v := public.t4490_join(public.t4490_id('dedicated'), 'tola', '44906000-0000-4000-8000-000000000006');
  INSERT INTO t4490_ids VALUES ('tola', (v->>'subscriptionId')::uuid);
  PERFORM public.t4490_expect($q$SELECT public.t4490_join(public.t4490_id('dedicated'), 'third')$q$, 'PT409', 'plan_full',
    'M-3e Dedicated desk (2 places) is full after two joins');
END
$m3$;
SELECT public.t4490_reset();
SELECT public.t4490_as(NULL);
SELECT public.t4490_expect($q$SELECT public.issue_4490_membership_join(gen_random_uuid(), public.t4490_id('hot'),
    '{"name":"A","email":"a@example.test"}'::jsonb, NULL, public.t4490_key('cart:anon'), NULL, public.t4490_tok('anon'), 'join-anon')$q$,
  '42501', NULL, 'M-3f the database refuses a join that does not come through the edge (anon)');
SELECT public.t4490_reset();

-- ===========================================================================
-- M-4 First month paid on the offer rail.
-- ===========================================================================
SELECT public.t4490_service();
DO $m4$
DECLARE
  v_sub uuid := public.t4490_id('amaka');
  v jsonb;
  m jsonb;
  g uuid;
BEGIN
  v := public.t4490_pay_member(v_sub, 'amaka');
  g := (v->>'groupId')::uuid;
  INSERT INTO t4490_ids VALUES ('amaka_g1', g);
  PERFORM public.t4490_ok((v->>'amountMinor')::bigint = 9137500 AND v->>'stage' = 'full',
    'M-4a the first month: N85,000 + VAT N6,375 = N91,375 in one payment');
  PERFORM public.t4490_ok((SELECT state FROM public.stay_reservation_groups WHERE id = g) = 'confirmed'
                          AND (SELECT offer_kind FROM public.stay_reservation_groups WHERE id = g) = 'membership',
    'M-4b paid through the existing finalize: the month''s group is confirmed');
  m := public.issue_4490_membership_get(v_sub, public.t4490_tok('amaka'), NULL, 'p6-test-pepper-0123456789abcdef0123');
  PERFORM public.t4490_ok(m->>'status' = 'active' AND (m->'credits'->>'roomHoursLeft')::numeric = 4
                          AND (m->'credits'->>'guestPassesLeft')::numeric = 2 AND m->'paymentDue' = 'null'::jsonb
                          AND (m->>'activeUntil')::timestamptz > now() + interval '27 days'
                          AND m->'pass'->>'qrPayload' LIKE 'mingla:v1:vmember:' || v_sub || ':sig:%' AND (m->'pass'->>'valid')::boolean,
    'M-4c active for a month: 4 room hours and 2 guest passes, a member pass that works');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_membership_paid'
                           AND payload->>'subscription_id' = v_sub::text AND payload->>'step' = 'first') = 1
                          AND (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_booking_confirmed'
                               AND payload->>'venue_group_id' = g::text) = 0
                          AND NOT EXISTS (SELECT 1 FROM public.venue_passes WHERE group_id = g),
    'M-4d one welcome / receipt message; no booking confirmation and no booking pass for a month''s payment');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key LIKE 'venue_membership%'
                                      AND payload::text LIKE '%' || encode(public.t4490_tok('amaka'), 'hex') || '%'),
    'M-4e messages carry no token');
  v := public.t4490_pay_member(public.t4490_id('seun'), 'seun');
  v := public.t4490_pay_member(public.t4490_id('tola'), 'tola');
END
$m4$;
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
SELECT public.t4490_ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
    public.issue_4490_venue_day('44906000-0000-4000-9000-0000000000a1', (now() AT TIME ZONE 'Africa/Lagos')::date)->'bookings') b
    WHERE b->>'offerKind' = 'membership'), 'M-4f a month''s payment is not a booking on Today');
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000006');
SELECT public.t4490_ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.issue_4490_my_offer_bookings()) b
    WHERE b->>'offerKind' = 'membership')
  AND jsonb_array_length(public.issue_4490_my_memberships()) = 1,
  'M-4g a signed-in member sees the membership under memberships, not bookings');
SELECT public.t4490_reset();

-- ===========================================================================
-- M-5 A paid month owes nothing: paying one link twice is refused.
-- ===========================================================================
SELECT public.t4490_service();
SELECT public.t4490_expect($q$SELECT public.issue_4490_membership_prepare_payment(public.t4490_id('amaka'),
    public.t4490_tok('amaka'), NULL, 'mpay-amaka-again')$q$, 'PT409', 'membership_nothing_to_pay',
  'M-5a paying the same month again is refused (nothing to pay)');
SELECT public.t4490_reset();

-- ===========================================================================
-- M-6 Strangers get nothing.
-- ===========================================================================
SELECT public.t4490_service();
SELECT public.t4490_expect($q$SELECT public.issue_4490_membership_get(public.t4490_id('amaka'), public.t4490_tok('seun'), NULL, NULL)$q$,
  'P0002', 'membership_not_found', 'M-6a another member''s token does not open Amaka''s membership');
SELECT public.t4490_expect($q$SELECT public.issue_4490_membership_get(public.t4490_id('amaka'), NULL,
    '44906000-0000-4000-8000-000000000005', NULL)$q$,
  'P0002', 'membership_not_found', 'M-6b a stranger''s signed-in account does not open it');
SELECT public.t4490_expect($q$SELECT public.issue_4490_membership_get(public.t4490_id('tola'), NULL,
    '44906000-0000-4000-8000-000000000005', NULL)$q$,
  'P0002', 'membership_not_found', 'M-6c ...nor a signed-in member''s membership');
SELECT public.t4490_ok(public.issue_4490_membership_get(public.t4490_id('tola'), NULL, '44906000-0000-4000-8000-000000000006', NULL)->>'status' = 'active',
  'M-6d Tola opens her own membership signed in');
SELECT public.t4490_expect($q$SELECT public.issue_4490_membership_member_action(public.t4490_id('amaka'), public.t4490_tok('seun'), NULL,
    'leave', 'p6-m6-leave')$q$, 'P0002', 'membership_not_found', 'M-6e a stranger cannot make Amaka leave');
SELECT public.t4490_expect($q$SELECT public.issue_4490_membership_prepare_payment(public.t4490_id('amaka'), NULL,
    '44906000-0000-4000-8000-000000000005', 'mpay-stranger')$q$, 'P0002', 'membership_not_found',
  'M-6f a stranger cannot start a payment on Amaka''s membership');
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000005');
SELECT public.t4490_expect($q$SELECT public.issue_4490_venue_members('44906000-0000-4000-9000-0000000000a1', 'all')$q$,
  '42501', 'not_authorized', 'M-6g an outsider cannot list members');
SELECT public.t4490_expect($q$SELECT public.issue_4490_venue_member(public.t4490_id('amaka'))$q$,
  '42501', 'not_authorized', 'M-6h an outsider cannot read a member');
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_membership_subscriptions) = 0
                       AND (SELECT count(*) FROM public.venue_credit_ledger) = 0
                       AND (SELECT count(*) FROM public.venue_membership_periods) = 0,
  'M-6i RLS: an outsider reads no members, months or credits');
SELECT public.t4490_expect($q$SELECT public.issue_4490_membership_get(public.t4490_id('amaka'), public.t4490_tok('amaka'), NULL, NULL)$q$,
  '42501', NULL, 'M-6j a signed-in user cannot call the member read directly (edge only)');
SELECT public.t4490_expect($q$INSERT INTO public.venue_membership_subscriptions (id, plan_id, brand_id, member_name, member_email,
    member_token_hash, qr_token_hash, start_on, terms, actor_key_hash, idempotency_key, request_hash)
    VALUES (gen_random_uuid(), public.t4490_id('hot'), '44906000-0000-4000-9000-000000000010', 'x', 'x@example.test',
    sha256('x'), repeat('a', 64), current_date, '{}', repeat('a', 64), 'direct-insert', repeat('a', 64))$q$,
  '42501', NULL, 'M-6k nobody writes members directly');
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000006');
SELECT public.t4490_expect($q$SELECT public.issue_4490_venue_members('44906000-0000-4000-9000-0000000000a1', 'all')$q$,
  '42501', 'not_authorized', 'M-6l a member cannot list the venue''s members');
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000008');
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_membership_subscriptions) = 0,
  'M-6m check-in-only staff read no member contacts');
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_membership_subscriptions) = 3
                       AND NOT has_column_privilege('authenticated', 'public.venue_membership_subscriptions', 'member_token_hash', 'SELECT')
                       AND NOT has_column_privilege('authenticated', 'public.venue_membership_subscriptions', 'qr_token_hash', 'SELECT'),
  'M-6n the owner reads the members; nobody signed in reads the token or pass hashes');
SELECT public.t4490_reset();

-- ===========================================================================
-- M-7 The member's price.
-- ===========================================================================
SELECT public.t4490_service();
DO $m7$
DECLARE
  v_sub uuid := public.t4490_id('amaka');
  v jsonb;
  g uuid;
  v_q jsonb;
  v_m jsonb;
BEGIN
  v := public.t4490_member_hour(v_sub, 'am-room-1', 'amaka', public.t4490_at('10:00'), 120);
  PERFORM public.t4490_ok((v->'quote'->>'totalMinor')::bigint = 2580000 AND (v->'memberQuote'->>'totalMinor')::bigint = 0
                          AND (v->'memberQuote'->'member'->>'roomHoursUsed')::numeric = 2,
    'M-7a Boardroom 2 hours: guests pay N25,800; Amaka uses 2 of her 4 hours, N0');
  g := (v->>'groupId')::uuid;
  PERFORM public.t4490_ok(v->>'state' = 'confirmed' AND (SELECT admits FROM public.venue_passes WHERE group_id = g) = 2
                          AND (SELECT count(*) FROM public.venue_space_claims c WHERE c.group_id = g AND c.state = 'committed') = 1,
    'M-7b nothing to pay: confirmed at once, the Boardroom committed, a pass for 2');
  PERFORM public.t4490_ok(public.issue_4490_member_credit_left(v_sub, 'room_hours', public.t4490_at('10:00')) = 2,
    'M-7c 2 room hours left');
  v := public.t4490_member_hour(v_sub, 'am-room-2', 'amaka', public.t4490_at('14:00'), 90);
  PERFORM public.t4490_ok((v->'memberQuote'->>'totalMinor')::bigint = 0 AND v->>'state' = 'confirmed',
    'M-7d 90 minutes more: still included');
  v := public.t4490_member_hour(v_sub, 'am-room-3', 'amaka', public.t4490_at('16:00'), 60);
  PERFORM public.t4490_ok((v->'memberQuote'->'member'->>'roomHoursUsed')::numeric = 0.5
                          AND (v->'memberQuote'->>'subtotalMinor')::bigint = 540000
                          AND (v->'memberQuote'->>'taxMinor')::bigint = 40500
                          AND (v->'memberQuote'->>'totalMinor')::bigint = 580500
                          AND v->>'state' = 'instant_payment_pending',
    'M-7e an hour with 30 included minutes left: N6,000 for the rest, 10% member discount = N5,400 + VAT N405 = N5,805');
  g := (v->>'groupId')::uuid;
  INSERT INTO t4490_ids VALUES ('am_room3', g);
  PERFORM public.t4490_ok(public.issue_4490_member_credit_left(v_sub, 'room_hours', public.t4490_at('16:00')) = 0,
    'M-7f the hold spent the last 30 minutes');
  -- The hold lapses: the minutes come back.
  UPDATE public.stay_inventory_holds SET expires_at = now() - interval '1 minute' WHERE group_id = g;
  PERFORM public.issue_1388_expire_groups(100);
  PERFORM public.t4490_ok((SELECT state FROM public.stay_reservation_groups WHERE id = g) IN ('cancelled', 'request_expired')
                          AND public.issue_4490_member_credit_left(v_sub, 'room_hours', public.t4490_at('16:00')) = 0.5,
    'M-7g the unpaid hold lapsed: its 30 minutes are back');
  -- Entry: Amaka + 1 guest on the Day pass: her own entry free, a guest pass for the guest.
  v_q := public.issue_4490_quote_offer(public.t4490_id('daypass'),
    (SELECT id FROM public.stay_place_windows WHERE offering_id = public.t4490_id('daypass') AND local_date = public.t4490_day() LIMIT 1),
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490_id('dayopt'), 'guests', 2)),
    public.t4490_key('cart:am-entry'), NULL, 'quote-am-entry');
  v_m := public.issue_4490_member_quote((v_q->>'quoteId')::uuid, v_sub, public.t4490_tok('amaka'), NULL, public.t4490_key('cart:am-entry'), true);
  PERFORM public.t4490_ok((v_q->>'totalMinor')::bigint = 1290000 AND (v_m->>'totalMinor')::bigint = 0
                          AND (v_m->'member'->>'freeAdmissions')::integer = 1 AND (v_m->'member'->>'guestPassesUsed')::integer = 1,
    'M-7h Day pass for 2: N12,900 for guests; Amaka free and one guest pass, N0');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_member_quote(%L, %L, public.t4490_tok('seun'), NULL,
      public.t4490_key('cart:am-entry'), true)$q$, (v_q->>'quoteId'), v_sub),
    'P0002', 'membership_not_found', 'M-7i another member''s token cannot price with Amaka''s membership');
  v := public.issue_4490_create_offer_group(gen_random_uuid(), (v_m->>'quoteId')::uuid,
    '{"name":"Amaka","email":"amaka@example.test"}'::jsonb, public.t4490_key('cart:am-entry'), NULL,
    sha256(convert_to('tok:am-entry', 'UTF8')), 'hold-am-entry');
  PERFORM public.t4490_ok(v->>'state' = 'confirmed' AND public.issue_4490_member_credit_left(v_sub, 'guest_passes', now()) = 1,
    'M-7j booked at N0 (confirmed), one guest pass left');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_create_offer_group(gen_random_uuid(), %L,
      '{"name":"Amaka","email":"amaka@example.test"}'::jsonb, public.t4490_key('cart:am-entry'), NULL,
      sha256(convert_to('tok:am-entry2', 'UTF8')), 'hold-am-entry-2')$q$, (v_q->>'quoteId')),
    'PT409', 'offer_quote_expired', 'M-7k the guests'' price quote cannot be held once the member price replaced it');
END
$m7$;
SELECT public.t4490_reset();

-- ===========================================================================
-- M-8 Check-in on the venue's one list.
-- ===========================================================================
SELECT public.t4490_service();
DO $m8$
DECLARE
  a1 uuid := '44906000-0000-4000-9000-0000000000a1';
  v jsonb;
  v_qr text;
  v_log uuid;
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_used integer;
BEGIN
  v_qr := public.issue_4490_membership_get(public.t4490_id('amaka'), public.t4490_tok('amaka'), NULL,
    'p6-test-pepper-0123456789abcdef0123')->'pass'->>'qrPayload';
  SELECT used INTO v_used FROM public.issue_4490_pool_day_usage(public.t4490_id('pool'), v_today);
  v := public.issue_4490_check_in_scan(a1, v_qr, NULL, NULL, '44906000-0000-4000-8000-000000000008', 'p6-test-pepper-0123456789abcdef0123');
  v_log := (v->>'logId')::uuid;
  PERFORM public.t4490_ok(v->>'result' = 'admitted' AND (v->>'admitted')::integer = 1 AND v->>'kind' = 'member',
    'M-8a door staff scan Amaka''s member pass: in');
  PERFORM public.t4490_ok((SELECT used FROM public.issue_4490_pool_day_usage(public.t4490_id('pool'), v_today)) = v_used + 1,
    'M-8b she counts against the Day pass day limit');
  v := public.issue_4490_check_in_scan(a1, v_qr, NULL, NULL, '44906000-0000-4000-8000-000000000008', 'p6-test-pepper-0123456789abcdef0123');
  PERFORM public.t4490_ok(v->>'result' = 'already_used', 'M-8c a second scan the same day: already in');
  v := public.issue_4490_check_in_undo(a1, v_log, '44906000-0000-4000-8000-000000000008');
  PERFORM public.t4490_ok(v->>'result' = 'undone'
                          AND (SELECT used FROM public.issue_4490_pool_day_usage(public.t4490_id('pool'), v_today)) = v_used,
    'M-8d undo: out again, the day limit back');
  v := public.issue_4490_check_in_scan(a1, v_qr, 2, NULL, '44906000-0000-4000-8000-000000000008', 'p6-test-pepper-0123456789abcdef0123');
  PERFORM public.t4490_ok(v->>'result' = 'admitted' AND (v->>'admitted')::integer = 2
                          AND public.issue_4490_member_credit_left(public.t4490_id('amaka'), 'guest_passes', now()) = 0
                          AND (SELECT used FROM public.issue_4490_pool_day_usage(public.t4490_id('pool'), v_today)) = v_used + 2,
    'M-8e Amaka brings a guest on her last guest pass: 2 in');
  v := public.issue_4490_check_in_list(a1, NULL, '44906000-0000-4000-8000-000000000008');
  PERFORM public.t4490_ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'members') m
                                  WHERE m->>'subscriptionId' = public.t4490_id('amaka')::text AND (m->>'inToday')::boolean
                                    AND (m->>'guests')::integer = 1)
                          AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'members') m
                                      WHERE m->>'subscriptionId' = public.t4490_id('seun')::text AND NOT (m->>'inToday')::boolean),
    'M-8f the one check-in list shows members, who is in and with how many');
END
$m8$;
SELECT public.t4490_ok((public.issue_4490_check_in_scan('44906000-0000-4000-9000-0000000000a1',
    'mingla:v1:vmember:' || public.t4490_id('seun') || ':sig:' || repeat('0', 64), NULL, NULL,
    '44906000-0000-4000-8000-000000000008', 'p6-test-pepper-0123456789abcdef0123'))->>'result' = 'not_found',
  'M-8g a member code with a wrong signature: not found');
DO $m8b$
DECLARE
  a1 uuid := '44906000-0000-4000-9000-0000000000a1';
  v jsonb;
BEGIN
  -- The day limit (5) has room for the member only when guests would overfill it.
  INSERT INTO public.venue_credit_ledger (subscription_id, period_id, credit, entry, amount, expires_at, idempotency_key)
  SELECT p.subscription_id, p.id, 'guest_passes', 'grant', 5, p.period_end, 'test-extra-passes:' || p.id
  FROM public.venue_membership_periods p WHERE p.subscription_id = public.t4490_id('seun') AND p.status = 'paid';
  UPDATE public.venue_membership_plans SET entry_included = true, entry_offering_id = public.t4490_id('daypass')
  WHERE id = public.t4490_id('dedicated');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_check_in_member(%L, %L, 4, '44906000-0000-4000-8000-000000000008')$q$,
      a1, public.t4490_id('seun')),
    'PT409', 'member_guests_day_full', 'M-8i Seun with 4 guests would pass the day limit: refused');
  v := public.issue_4490_check_in_member(a1, public.t4490_id('seun'), 1, '44906000-0000-4000-8000-000000000008');
  PERFORM public.t4490_ok(v->>'result' = 'admitted' AND (v->>'admitted')::integer = 2, 'M-8j with 1 guest: in (from the list)');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_check_in_member(%L, %L, 0, '44906000-0000-4000-8000-000000000005')$q$,
      a1, public.t4490_id('tola')), '42501', 'not_authorized', 'M-8k an outsider cannot check members in');
END
$m8b$;
SELECT public.t4490_reset();

-- ===========================================================================
-- M-9 Renewal across months (the clock moved forward with p_now).
-- ===========================================================================
SELECT public.t4490_service();
DO $m9$
DECLARE
  v_sub uuid := public.t4490_id('amaka');
  v_end timestamptz;
  v jsonb;
  r jsonb;
  v_p2 public.venue_membership_periods%ROWTYPE;
BEGIN
  SELECT current_period_end INTO v_end FROM public.venue_membership_subscriptions WHERE id = v_sub;
  r := public.issue_4490_membership_billing_run(v_end - interval '8 days');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.venue_membership_periods WHERE subscription_id = v_sub AND sequence = 2),
    'M-9a 8 days before renewal: nothing yet');
  r := public.issue_4490_membership_billing_run(v_end - interval '7 days');
  SELECT * INTO v_p2 FROM public.venue_membership_periods WHERE subscription_id = v_sub AND sequence = 2;
  PERFORM public.t4490_ok(v_p2.status = 'link_sent' AND v_p2.period_start = v_end AND v_p2.amount_minor = 8500000
                          AND v_p2.due_at = v_end AND (r->>'renewalsSent')::integer >= 1,
    'M-9b 7 days before: the next month is ready to pay (N85,000, due on renewal day)');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_membership_renewal'
                           AND payload->>'subscription_id' = v_sub::text AND payload->>'step' = 'renewal') = 1,
    'M-9c the renewal email is queued (no link stored: it is built when sent)');
  r := public.issue_4490_membership_billing_run(v_end - interval '6 days');
  r := public.issue_4490_membership_billing_run(v_end - interval '6 days');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.venue_membership_periods WHERE subscription_id = v_sub) = 2
                          AND (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_membership_renewal'
                               AND payload->>'subscription_id' = v_sub::text) = 1,
    'M-9d the run again (twice): still one month, one email');
  v := public.issue_4490_membership_get(v_sub, public.t4490_tok('amaka'), NULL, NULL);
  -- TEST-MOD-APPROVED #4490 (06-W4 fix 1, W4-N2): the next month due is what M-9f pays (N91,375).
  PERFORM public.t4490_ok(v->>'status' = 'active' AND (v->'paymentDue'->>'amountMinor')::bigint = 9137500,
    'M-9e the member page shows the next month to pay, still active');
  v := public.t4490_pay_member(v_sub, 'amaka', 2);
  PERFORM public.t4490_ok((v->>'amountMinor')::bigint = 9137500 AND (v->>'periodId')::uuid = v_p2.id,
    'M-9f the member pays the renewal link: N91,375');
  PERFORM public.t4490_ok((SELECT current_period_end FROM public.venue_membership_subscriptions WHERE id = v_sub) = v_p2.period_end
                          AND (SELECT status FROM public.venue_membership_periods WHERE id = v_p2.id) = 'paid'
                          AND (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_membership_paid'
                               AND payload->>'subscription_id' = v_sub::text AND payload->>'step' = 'renewal') = 1,
    'M-9g active through the end of the new month; a receipt is queued');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_membership_prepare_payment(%L, public.t4490_tok('amaka'), NULL,
      'mpay-amaka-renewal-again')$q$, v_sub), 'PT409', 'membership_nothing_to_pay',
    'M-9h the same renewal link paid twice: refused');
  PERFORM public.t4490_ok(public.issue_4490_member_credit_left(v_sub, 'room_hours', v_end + interval '1 day') = 4
                          AND public.issue_4490_member_credit_left(v_sub, 'guest_passes', v_end + interval '1 day') = 2,
    'M-9i the new month brings its own 4 hours and 2 guest passes');
  r := public.issue_4490_membership_billing_run(v_end + interval '1 hour');
  PERFORM public.t4490_ok(EXISTS (SELECT 1 FROM public.venue_credit_ledger l JOIN public.venue_membership_periods p ON p.id = l.period_id
                                  WHERE l.subscription_id = v_sub AND p.sequence = 1 AND l.entry = 'expire' AND l.credit = 'room_hours'
                                    AND l.amount = -0.5),
    'M-9j unused credits end with their month (30 minutes expired)');
END
$m9$;
SELECT public.t4490_reset();

-- ===========================================================================
-- M-10 Due -> grace -> lapsed; paying restores; a join never paid closes.
-- ===========================================================================
SELECT public.t4490_service();
DO $m10$
DECLARE
  a1 uuid := '44906000-0000-4000-9000-0000000000a1';
  v_sub uuid := public.t4490_id('seun');
  v_end timestamptz;
  v jsonb;
  r jsonb;
  v_pending uuid;
BEGIN
  SELECT current_period_end INTO v_end FROM public.venue_membership_subscriptions WHERE id = v_sub;
  r := public.issue_4490_membership_billing_run(v_end - interval '7 days');
  r := public.issue_4490_membership_billing_run(v_end + interval '1 hour');
  PERFORM public.t4490_ok((SELECT status FROM public.venue_membership_subscriptions WHERE id = v_sub) = 'payment_due'
                          AND (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_membership_renewal'
                               AND payload->>'subscription_id' = v_sub::text AND payload->>'step' = 'due') = 1,
    'M-10a renewal day, unpaid: payment due (reminder sent)');
  r := public.issue_4490_membership_billing_run(v_end + interval '3 days 1 hour');
  PERFORM public.t4490_ok((SELECT status FROM public.venue_membership_subscriptions WHERE id = v_sub) = 'grace'
                          AND (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_membership_renewal'
                               AND payload->>'subscription_id' = v_sub::text AND payload->>'step' = 'reminder') = 1,
    'M-10b 3 days after: grace, second reminder');
  r := public.issue_4490_membership_billing_run(v_end + interval '3 days 2 hours');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_membership_renewal'
                           AND payload->>'subscription_id' = v_sub::text) = 3,
    'M-10c the run again: no second reminder');
  r := public.issue_4490_membership_billing_run(v_end + interval '7 days 1 hour');
  PERFORM public.t4490_ok((SELECT status FROM public.venue_membership_subscriptions WHERE id = v_sub) = 'lapsed'
                          AND (SELECT status FROM public.venue_membership_periods WHERE subscription_id = v_sub AND sequence = 2) = 'overdue'
                          AND (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_membership_lapsed'
                               AND payload->>'subscription_id' = v_sub::text) = 1,
    'M-10d grace over (7 days): lapsed, the month overdue, the member told');
  v := public.issue_4490_check_in_member(a1, v_sub, 0, '44906000-0000-4000-8000-000000000008');
  PERFORM public.t4490_ok(v->>'result' IN ('void', 'already_used'), 'M-10e a lapsed member is not let in: ' || (v->>'result'));
  v := public.t4490_pay_member(v_sub, 'seun', 2);
  PERFORM public.t4490_ok((SELECT status FROM public.venue_membership_subscriptions WHERE id = v_sub) = 'active',
    'M-10f paying the overdue month restores the membership at once');
  -- A join never paid closes after 2 days.
  v := public.t4490_join(public.t4490_id('hot'), 'ghost');
  v_pending := (v->>'subscriptionId')::uuid;
  r := public.issue_4490_membership_billing_run(now() + interval '3 days');
  PERFORM public.t4490_ok((SELECT status = 'cancelled' AND end_reason = 'not_paid' FROM public.venue_membership_subscriptions WHERE id = v_pending)
                          AND (SELECT status FROM public.venue_membership_periods WHERE subscription_id = v_pending) = 'void',
    'M-10g a join never paid is closed after 2 days (its month void)');
END
$m10$;
SELECT public.t4490_reset();

-- ===========================================================================
-- M-11 The member leaves, stays, pauses, resumes.
-- ===========================================================================
SELECT public.t4490_service();
DO $m11$
DECLARE
  v_sub uuid := public.t4490_id('amaka');
  v jsonb;
  r jsonb;
  v_end timestamptz;
BEGIN
  SELECT current_period_end INTO v_end FROM public.venue_membership_subscriptions WHERE id = v_sub;
  v := public.issue_4490_membership_member_action(v_sub, public.t4490_tok('amaka'), NULL, 'leave', 'p6-m11-leave-1');
  PERFORM public.t4490_ok((v->'leaving'->>'endsAt')::timestamptz = v_end AND v->>'status' = 'active' AND (v->>'canStay')::boolean,
    'M-11a Amaka leaves: still a member until the end of the paid month');
  r := public.issue_4490_membership_billing_run(v_end - interval '7 days');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.venue_membership_periods WHERE subscription_id = v_sub AND period_start >= v_end),
    'M-11b no renewal email after leaving');
  v := public.issue_4490_membership_member_action(v_sub, public.t4490_tok('amaka'), NULL, 'stay', 'p6-m11-stay');
  PERFORM public.t4490_ok(v->'leaving' = 'null'::jsonb, 'M-11c she changes her mind: staying');
  v := public.issue_4490_membership_member_action(v_sub, public.t4490_tok('amaka'), NULL, 'pause', 'p6-m11-pause');
  PERFORM public.t4490_ok((v->'pausing'->>'from')::timestamptz = v_end, 'M-11d pause from the end of the paid month');
  r := public.issue_4490_membership_billing_run(v_end + interval '1 hour');
  PERFORM public.t4490_ok((SELECT status = 'paused' AND pause_reason = 'member' FROM public.venue_membership_subscriptions WHERE id = v_sub)
                          AND NOT EXISTS (SELECT 1 FROM public.venue_membership_periods WHERE subscription_id = v_sub
                                          AND status IN ('link_sent', 'scheduled')),
    'M-11e at the end of the month: paused, nothing to pay');
  -- The real clock passes the end of the paid month (the run above used p_now).
  UPDATE public.venue_membership_subscriptions
  SET current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 hour'
  WHERE id = v_sub;
  v := public.issue_4490_membership_member_action(v_sub, public.t4490_tok('amaka'), NULL, 'resume', 'p6-m11-resume');
  -- TEST-MOD-APPROVED #4490 (06-W4 fix 1, W4-N2): due = the charge with VAT (N91,375).
  PERFORM public.t4490_ok(v->>'status' = 'paused' AND (v->'paymentDue'->>'amountMinor')::bigint = 9137500,
    'M-11f resume: a month from today to pay; paused until paid');
  v := public.issue_4490_membership_member_action(v_sub, public.t4490_tok('amaka'), NULL, 'resume', 'p6-m11-resume');
  PERFORM public.t4490_ok((v->>'replayed')::boolean, 'M-11g the same request again replays');
  v := public.t4490_pay_member(v_sub, 'amaka', 3);
  PERFORM public.t4490_ok((SELECT status FROM public.venue_membership_subscriptions WHERE id = v_sub) = 'active',
    'M-11h paid: active again');
  v := public.issue_4490_membership_member_action(v_sub, public.t4490_tok('amaka'), NULL, 'leave', 'p6-m11-leave-2');
  SELECT cancel_at INTO v_end FROM public.venue_membership_subscriptions WHERE id = v_sub;
  r := public.issue_4490_membership_billing_run(v_end + interval '1 minute');
  PERFORM public.t4490_ok((SELECT status = 'cancelled' AND end_reason = 'left' FROM public.venue_membership_subscriptions WHERE id = v_sub)
                          AND (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_membership_ended'
                               AND payload->>'subscription_id' = v_sub::text AND payload->>'step' = 'ended') = 1,
    'M-11i at the end date: ended, the member told');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_membership_prepare_payment(%L, public.t4490_tok('amaka'), NULL,
      'mpay-ended')$q$, v_sub), 'PT409', 'membership_ended', 'M-11j an ended membership cannot be paid');
END
$m11$;
SELECT public.t4490_reset();

-- ===========================================================================
-- M-12 Staff on a member.
-- ===========================================================================
SELECT public.t4490_as('44906000-0000-4000-8000-000000000007');
DO $m12$
DECLARE
  v_sub uuid := public.t4490_id('tola');
  v jsonb;
BEGIN
  v := public.issue_4490_venue_member(v_sub);
  v := public.issue_4490_manage_member(v_sub, 'pause', '{"when":"now","reason":"Travelling"}'::jsonb, (v->>'version')::bigint, 'p6-m12-pause');
  PERFORM public.t4490_ok(v->>'status' = 'paused' AND v->'paused'->>'by' = 'staff', 'M-12a the event manager pauses Tola now');
  v := public.issue_4490_manage_member(v_sub, 'resume', '{}'::jsonb, (v->>'version')::bigint, 'p6-m12-resume');
  PERFORM public.t4490_ok(v->>'status' = 'active', 'M-12b resume inside a paid month: active at once');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_manage_member(%L, 'cancel', '{"when":"now"}'::jsonb, %s, 'p6-m12-cancel-1')$q$,
      v_sub, (v->>'version')), '22023', 'member_cancel_reason_required', 'M-12c cancelling needs a reason');
END
$m12$;
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000008');
SELECT public.t4490_expect($q$SELECT public.issue_4490_manage_member(public.t4490_id('tola'), 'pause', '{"when":"now"}'::jsonb, 1, 'p6-m12-door')$q$,
  '42501', 'not_authorized', 'M-12e check-in-only staff cannot pause a member');
SELECT public.t4490_reset();
SELECT public.t4490_service();
SELECT public.issue_4490_membership_billing_run(
  (SELECT current_period_end FROM public.venue_membership_subscriptions WHERE id = public.t4490_id('tola')) - interval '6 days');
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000009');
DO $m12b$
DECLARE
  v_sub uuid := public.t4490_id('tola');
  v jsonb;
BEGIN
  v := public.issue_4490_venue_member(v_sub);
  v := public.issue_4490_manage_member(v_sub, 'send_link', '{}'::jsonb, (v->>'version')::bigint, 'p6-m12-link');
  PERFORM public.t4490_ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'timeline') e WHERE e->>'type' = 'member_link_sent'),
    'M-12f staff with venue.manage_members send the payment link again (in the timeline)');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_manage_member(%L, 'send_link', '{}'::jsonb, %s, 'p6-m12-link-2')$q$,
      v_sub, (v->>'version')), 'PT409', 'member_link_too_soon', 'M-12g not again within 10 minutes');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_manage_member(%L, 'mark_paid', '{"method":"cash"}'::jsonb, %s, 'p6-m12-paid')$q$,
      v_sub, (v->>'version')), '42501', 'not_authorized', 'M-12d marking a month paid needs money rights (members rights are not enough)');
END
$m12b$;
SELECT public.t4490_reset();
SELECT public.t4490_service();
SELECT public.t4490_ok((SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_membership_renewal'
    AND payload->>'subscription_id' = public.t4490_id('tola')::text AND payload->>'step' LIKE 'resend-%') = 1,
  'M-12f2 the email is queued once');
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
DO $m12c$
DECLARE
  v_sub uuid := public.t4490_id('tola');
  v jsonb;
BEGIN
  v := public.issue_4490_venue_member(v_sub);
  v := public.issue_4490_manage_member(v_sub, 'mark_paid', '{"method":"transfer","note":"Paid at the desk"}'::jsonb,
    (v->>'version')::bigint, 'p6-m12-mark');
  PERFORM public.t4490_ok(v->'paymentDue' = 'null'::jsonb
                          AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'periods') p WHERE p->>'paidVia' = 'venue' AND p->>'paidMethod' = 'transfer')
                          AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'timeline') e WHERE e->>'type' = 'member_paid' AND e->>'by' = 'staff'),
    'M-12h the owner marks the month paid by transfer (in the timeline)');
  v := public.issue_4490_manage_member(v_sub, 'cancel', '{"when":"now","reason":"Asked to stop"}'::jsonb, (v->>'version')::bigint, 'p6-m12-cancel');
  PERFORM public.t4490_ok(v->>'status' = 'cancelled' AND v->>'endReason' = 'cancelled_by_venue', 'M-12i the owner ends a membership now');
END
$m12c$;
SELECT public.t4490_reset();

-- ===========================================================================
-- M-13 Host and Admin reads.
-- ===========================================================================
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
DO $m13$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_venue_members('44906000-0000-4000-9000-0000000000a1', 'all');
  PERFORM public.t4490_ok((v->'tiles'->>'members')::integer = 1 AND (v->'tiles'->>'inToday')::integer >= 1
                          AND jsonb_array_length(v->'members') = 1 AND v->'members'->0->>'name' = 'Member seun',
    'M-13a members list: Seun (Amaka left, Tola ended, the unpaid join closed), who is in today');
  v := public.issue_4490_venue_members('44906000-0000-4000-9000-0000000000a1', 'ended');
  PERFORM public.t4490_ok(jsonb_array_length(v->'members') = 3, 'M-13b ended: 3');
  v := public.issue_4490_venue_member(public.t4490_id('seun'));
  PERFORM public.t4490_ok(jsonb_array_length(v->'timeline') >= 5 AND jsonb_array_length(v->'periods') >= 2
                          AND v->>'email' = 'seun@example.test' AND (v->>'canManageMoney')::boolean,
    'M-13c member detail: the billing timeline, the months, contact, money rights');
  PERFORM public.t4490_expect($q$SELECT public.issue_4490_admin_memberships('44906000-0000-4000-9000-0000000000a1')$q$,
    '42501', 'not_authorized', 'M-13d the Admin read is for Mingla admins only');
END
$m13$;
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000010');
SELECT public.t4490_ok(jsonb_array_length(public.issue_4490_admin_memberships('44906000-0000-4000-9000-0000000000a1')->'members') = 4,
  'M-13e a Mingla admin reads every member (read-only)');
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000005');
SELECT public.t4490_expect($q$SELECT public.issue_4490_membership_billing_run(now(), 10)$q$, '42501', NULL,
  'M-13f nobody signed in can run the billing clock');
-- N150 (#4490): issue_4490_member_enqueue and issue_4490_enqueue_offer_event is a #1529 populating producer that writes an
-- explicit NULL country_code (the row's contact is an email; no SMS leg can
-- reach a handset from it). Assert it on the rows this suite enqueued.
SELECT public.t4490_service();
SELECT public.t4490_ok((SELECT count(*) FROM public.notification_outbox WHERE category_key IN ('venue_membership_paid','venue_membership_renewal','venue_booking_confirmed')) > 0
  AND NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key IN ('venue_membership_paid','venue_membership_renewal','venue_booking_confirmed') AND country_code IS NOT NULL),
  'M-14 the #4490 outbox rows carry an explicit NULL country_code (#1529)');
SELECT public.t4490_reset();

ROLLBACK;
