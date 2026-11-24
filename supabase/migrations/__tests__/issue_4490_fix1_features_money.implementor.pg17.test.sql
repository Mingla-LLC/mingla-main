-- #4490 fix round 1 (B2-B8; 20281203224490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-STARTING-FEATURES-ALL-OR-SAY-WHY | issue #4490 | issue_4490_apply_starting_features applies every requested feature whose parents are requested or on, parents first, even before a space or table exists (the read lists what each still `needs`), and returns every key it did not apply with a reason; nothing is dropped silently.
-- MINGLA-INVARIANT: I-4490-FEATURE-PAUSE-RESTORE | issue #4490 | switching a feature off pauses its live offers and records them; switching it on puts exactly those still paused back on sale, never an offer paused for another reason.
-- MINGLA-INVARIANT: I-4490-HIRE-ROW-BY-DAY | issue #4490 | a private-hire price row is offered, quoted and charged only on its own weekdays; a date no row covers is not available (never another row's price).
--
-- X-1 starting features (the nine-venue pattern), needs, menu default, who may, replay. X-2 presets.
-- X-3 Memberships / Entry / By the hour off and on: exactly the paused offers come back.
-- X-4 member payments (paid months) for the member only. X-5 offers outside opening hours.
-- X-6 money collected today beside taken today. X-7 hire rows Mon-Thu vs Fri-Sat and a day no row covers.
--
-- FAILS-ON-REVERT (seen): without 20281203224490 X-1a fails ("a new event space reads with nothing on":
-- Menu read as on for every non-stay type).
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


-- Three more fresh venues (no spaces, no offers), like the wizard creates them.
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44906000-0000-4000-9000-0000000000a3', '44906000-0000-4000-9000-000000000010', 'foundryfx14490', 'Foundry FX1', 6.45, 3.43, 'event_space', 'verified', 'NG'),
  ('44906000-0000-4000-9000-0000000000a4', '44906000-0000-4000-9000-000000000010', 'palmfx14490', 'Palm FX1', 6.45, 3.44, 'restaurant', 'verified', 'NG'),
  ('44906000-0000-4000-9000-0000000000a5', '44906000-0000-4000-9000-000000000010', 'meridianfx14490', 'Meridian FX1', 6.45, 3.45, 'club', 'verified', 'NG');
CREATE FUNCTION public.fx_on(p_venue uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $f$
  SELECT COALESCE(string_agg(r.feature_key, ',' ORDER BY array_position(public.issue_4490_feature_keys(), r.feature_key)), '')
  FROM public.issue_4490_venue_feature_rows(p_venue) r WHERE r.enabled $f$;
CREATE FUNCTION public.fx_needs(p_res jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT COALESCE(string_agg((n->>'key') || ':' || array_to_string(ARRAY(SELECT jsonb_array_elements_text(n->'needs')), '+'), ',' ORDER BY ord), '')
  FROM jsonb_array_elements(p_res->'needsSetup') WITH ORDINALITY AS x(n, ord) $f$;
CREATE FUNCTION public.t4490_v(p_offer uuid) RETURNS bigint LANGUAGE sql AS $f$ SELECT version FROM public.stay_offerings WHERE id = p_offer $f$;
GRANT EXECUTE ON FUNCTION public.t4490_v(uuid) TO PUBLIC;
CREATE FUNCTION public.fx_public(p_venue uuid) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS $f$
  SELECT public.issue_4490_public_features(p_venue) $f$;
GRANT EXECUTE ON FUNCTION public.fx_on(uuid), public.fx_needs(jsonb), public.fx_public(uuid) TO PUBLIC;

-- ===========================================================================
-- X-1 Starting features.
-- ===========================================================================
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
DO $x1$
DECLARE
  a2 uuid := '44906000-0000-4000-9000-0000000000a2';
  a3 uuid := '44906000-0000-4000-9000-0000000000a3';
  a4 uuid := '44906000-0000-4000-9000-0000000000a4';
  a5 uuid := '44906000-0000-4000-9000-0000000000a5';
  v jsonb;
BEGIN
  PERFORM public.t4490_ok(public.fx_on(a3) = '', 'X-1a a new event space reads with nothing on (Menu no longer on by default for a type without it)');
  PERFORM public.t4490_ok(public.fx_on(a4) = 'menu', 'X-1b a new restaurant reads Menu on (its type starts with Menu)');
  v := public.issue_4490_apply_starting_features(a3, ARRAY['private_hire', 'events_here'], 'fx1-x1-foundry');
  PERFORM public.t4490_ok(v->'applied' = '["private_hire", "events_here"]'::jsonb AND v->'skipped' = '[]'::jsonb
                          AND public.fx_needs(v) = 'private_hire:space' AND public.fx_on(a3) = 'private_hire,events_here',
    'X-1c Foundry (no space yet): Private hire and Events here both on; Private hire still needs a space (' || public.fx_needs(v) || ')');
  v := public.issue_4490_apply_starting_features(a2, ARRAY['entry', 'by_the_hour', 'private_hire', 'memberships', 'events_here'], 'fx1-x1-studio');
  PERFORM public.t4490_ok(public.fx_on(a2) = 'entry,private_hire,by_the_hour,memberships,events_here'
                          AND public.fx_needs(v) = 'private_hire:space,by_the_hour:space',
    'X-1d Studio: Entry, By the hour, Private hire, Memberships, Events here all on (' || public.fx_on(a2) || '; needs ' || public.fx_needs(v) || ')');
  v := public.issue_4490_apply_starting_features(a4,
    ARRAY['table_reservations', 'menu', 'waitlist', 'group_packages', 'private_hire', 'floor_plan', 'pick_a_table'], 'fx1-x1-palm');
  PERFORM public.t4490_ok(public.fx_on(a4) = 'group_packages,private_hire,table_reservations,floor_plan,pick_a_table,menu,waitlist'
                          AND v->'skipped' = '[]'::jsonb
                          AND (SELECT reservations_enabled FROM public.venue_reservation_settings WHERE venue_id = a4),
    'X-1e Palm & Pepper: all seven on, legacy reservations switch on (' || public.fx_on(a4) || ')');
  PERFORM public.t4490_ok(public.fx_needs(v) = 'private_hire:space,table_reservations:table,floor_plan:space+table,pick_a_table:table',
    'X-1f what still needs setting up: ' || public.fx_needs(v));
  v := public.issue_4490_apply_starting_features(a5, ARRAY['entry', 'pick_a_table', 'disco_ball'], 'fx1-x1-meridian');
  PERFORM public.t4490_ok(public.fx_on(a5) = 'entry'
    AND v->'skipped' @> '[{"key":"disco_ball","reason":"unknown_feature"},{"key":"pick_a_table","reason":"requires:floor_plan"}]'::jsonb
    AND v->'turnedOff' = '["menu"]'::jsonb,
    'X-1g a child without its parent and an unknown key are reported, not dropped; Menu (on by default for a club) is written off: ' || (v->'skipped')::text);
  v := public.issue_4490_apply_starting_features(a5, ARRAY['entry', 'pick_a_table', 'disco_ball'], 'fx1-x1-meridian');
  PERFORM public.t4490_ok((v->>'replayed')::boolean, 'X-1h the same call again replays');
  v := public.issue_4490_set_venue_feature(a5, 'private_hire', true, NULL, NULL, NULL, 'fx1-x1-hire');
  PERFORM public.t4490_ok(v->'needs' = '["space"]'::jsonb AND public.fx_on(a5) = 'entry,private_hire'
    AND (SELECT f->'needs' FROM jsonb_array_elements(v->'features'->'features') f WHERE f->>'key' = 'private_hire') = '["space"]'::jsonb,
    'X-1i Settings may switch Private hire on before a space exists; the read says it needs a space');
  PERFORM public.t4490_ok(NOT ('private_hire' = ANY(public.fx_public(a3))) AND 'events_here' = ANY(public.fx_public(a3)),
    'X-1j the public page keeps hiding Private hire until the venue has a space');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_apply_starting_features(%L, ARRAY['menu'], 'fx1-x1-a1')$q$, '44906000-0000-4000-9000-0000000000a1'),
    'PT409', 'venue_already_selling', 'X-1k a venue that already sells cannot be reset this way');
END
$x1$;
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000005');
SELECT public.t4490_expect($q$SELECT public.issue_4490_apply_starting_features('44906000-0000-4000-9000-0000000000a4', ARRAY['entry'], 'fx1-x1-stranger')$q$,
  '42501', 'not_authorized', 'X-1l a stranger cannot set another brand''s features');
SELECT public.t4490_reset();
SELECT public.t4490_as(NULL);
SELECT public.t4490_expect($q$SELECT public.issue_4490_apply_starting_features('44906000-0000-4000-9000-0000000000a4', ARRAY['entry'], 'fx1-x1-anon')$q$,
  '42501', NULL, 'X-1m nobody signed in cannot call it');
SELECT public.t4490_reset();

-- ===========================================================================
-- X-2 Presets (client table).
-- ===========================================================================
-- TEST-MOD-APPROVED #4490: the Till migration (ops_till_core) added `till` and `kitchen_screens` to the club, cafe and bar presets.
DO $x2$
BEGIN
  PERFORM public.t4490_ok(public.issue_4490_feature_preset('creative_and_arts') = ARRAY['entry', 'by_the_hour', 'private_hire', 'memberships', 'events_here']
    AND public.issue_4490_feature_preset('club') = ARRAY['entry', 'table_reservations', 'min_spend_tables', 'menu', 'table_ordering', 'events_here', 'till']
    AND public.issue_4490_feature_preset('cafe') = ARRAY['entry', 'by_the_hour', 'menu', 'table_ordering', 'events_here', 'till', 'kitchen_screens']
    AND public.issue_4490_feature_preset('play') = ARRAY['entry', 'group_packages', 'private_hire', 'menu', 'table_ordering', 'events_here']
    AND public.issue_4490_feature_preset('bar_lounge') = ARRAY['table_reservations', 'min_spend_tables', 'private_hire', 'menu', 'table_ordering', 'events_here', 'till']
    AND public.issue_4490_feature_preset('event_space') = ARRAY['private_hire', 'events_here'],
    'X-2a the server presets match the add-venue table');
END
$x2$;

-- ===========================================================================
-- X-3 Off and on again: exactly the offers the switch-off paused come back.
-- ===========================================================================
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
DO $x3$
DECLARE
  a1 uuid := '44906000-0000-4000-9000-0000000000a1';
  v jsonb;
  v_plan_offer uuid;
BEGIN
  v := public.issue_4490_set_venue_feature(a1, 'memberships', true, NULL, NULL, NULL, 'fx1-x3-mem-on');
  v := public.issue_4490_manage_membership_plan('create', a1, jsonb_build_object('name', 'Hot desk', 'priceMinor', 8500000,
    'entryIncluded', true, 'entryOfferingId', public.t4490_id('daypass'), 'graceDays', 7), NULL, 'fx1-x3-plan');
  INSERT INTO t4490_ids VALUES ('hot', (v->>'id')::uuid);
  v := public.issue_4490_manage_membership_plan('publish', a1, jsonb_build_object('planId', public.t4490_id('hot')), 1, 'fx1-x3-pub');
  SELECT p.offering_id INTO v_plan_offer FROM public.venue_membership_plans p WHERE p.id = public.t4490_id('hot');
  INSERT INTO t4490_ids VALUES ('hotoffer', v_plan_offer);
  PERFORM public.t4490_ok((SELECT status FROM public.stay_offerings WHERE id = v_plan_offer) = 'live', 'X-3a the Hot desk plan''s offering is live');
  -- The Boardroom is paused by hand first (another reason).
  v := public.issue_4490_manage_offer('pause', a1, jsonb_build_object('offerId', public.t4490_id('board')), public.t4490_v(public.t4490_id('board')), 'fx1-x3-board-pause');
  PERFORM public.issue_4490_set_venue_feature(a1, 'memberships', false, NULL, NULL, NULL, 'fx1-x3-mem-off');
  PERFORM public.issue_4490_set_venue_feature(a1, 'by_the_hour', false, NULL, NULL, NULL, 'fx1-x3-hour-off');
  PERFORM public.issue_4490_set_venue_feature(a1, 'entry', false, NULL, NULL, NULL, 'fx1-x3-entry-off', true);
  PERFORM public.t4490_ok((SELECT status FROM public.stay_offerings WHERE id = v_plan_offer) = 'paused'
    AND (SELECT status FROM public.stay_offerings WHERE id = public.t4490_id('daypass')) = 'paused'
    AND (SELECT count(*) FROM public.venue_feature_paused_offers) = 2
    AND NOT EXISTS (SELECT 1 FROM public.venue_feature_paused_offers WHERE offering_id = public.t4490_id('board')),
    'X-3b Memberships and Entry off pause the plan and the Day pass (recorded); the Boardroom was already paused (not recorded)');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.venue_feature_paused_offers) = 2, 'X-3b2 the owner reads the two records');
END
$x3$;
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000005');
DO $x3s$
BEGIN
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.venue_feature_paused_offers), 'X-3f a stranger reads none of them (RLS)');
END
$x3s$;
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
DO $x3c$
DECLARE
  a1 uuid := '44906000-0000-4000-9000-0000000000a1';
  v jsonb;
  v_plan_offer uuid := public.t4490_id('hotoffer');
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a1, 'memberships', true, NULL, NULL, NULL, 'fx1-x3-mem-on2');
  PERFORM public.issue_4490_set_venue_feature(a1, 'by_the_hour', true, NULL, NULL, NULL, 'fx1-x3-hour-on2');
  PERFORM public.t4490_ok((SELECT status FROM public.stay_offerings WHERE id = v_plan_offer) = 'live'
    AND (SELECT status FROM public.stay_offerings WHERE id = public.t4490_id('board')) = 'paused'
    AND (SELECT status FROM public.stay_offerings WHERE id = public.t4490_id('daypass')) = 'paused',
    'X-3c Memberships back on: the plan is on sale again; the Boardroom (paused by hand) stays paused; Entry is still off');
  PERFORM public.issue_4490_set_venue_feature(a1, 'entry', true, NULL, NULL, NULL, 'fx1-x3-entry-on2');
  PERFORM public.t4490_ok((SELECT status FROM public.stay_offerings WHERE id = public.t4490_id('daypass')) = 'live'
    AND EXISTS (SELECT 1 FROM public.stay_place_windows w WHERE w.offering_id = public.t4490_id('daypass')
                AND w.local_date >= (now() AT TIME ZONE 'Africa/Lagos')::date)
    AND NOT EXISTS (SELECT 1 FROM public.venue_feature_paused_offers),
    'X-3d Entry back on: the Day pass is on sale with its days; nothing left recorded');
  v := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', public.t4490_id('board')), public.t4490_v(public.t4490_id('board')), 'fx1-x3-board-resume');
  PERFORM public.t4490_ok(v->>'status' = 'live', 'X-3e the Host resumes the Boardroom by hand');
END
$x3c$;
SELECT public.t4490_reset();

-- ===========================================================================
-- X-4 Member payments: the paid months, for the member only.
-- ===========================================================================
SELECT public.t4490_service();
DO $x4$
DECLARE
  v jsonb;
  v_sub uuid;
BEGIN
  v := public.t4490_join(public.t4490_id('hot'), 'amaka-fx1');
  v_sub := (v->>'subscriptionId')::uuid;
  INSERT INTO t4490_ids VALUES ('amaka', v_sub);
  PERFORM public.t4490_ok(v->'payments' = '[]'::jsonb, 'X-4a a new member has no paid months yet');
  PERFORM public.t4490_pay_member(v_sub, 'amaka-fx1');
  v := public.issue_4490_membership_get(v_sub, public.t4490_tok('amaka-fx1'), NULL, 'pepper');
  PERFORM public.t4490_ok(jsonb_array_length(v->'payments') = 1
    AND (v->'payments'->0->>'amountMinor')::bigint = 8500000 AND (v->'payments'->0->>'paidMinor')::bigint = 9137500
    AND v->'payments'->0->>'paidVia' = 'online' AND v->'payments'->0->>'paidAt' IS NOT NULL
    AND (v->'payments'->0->>'start')::timestamptz < (v->'payments'->0->>'end')::timestamptz,
    'X-4b with her link Amaka reads her paid month: N85,000 (N91,375 with VAT), online, start and end: ' || (v->'payments')::text);
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_membership_get(%L, %L::bytea, NULL, 'pepper')$q$, v_sub, public.t4490_tok('wrong')),
    'P0002', 'membership_not_found', 'X-4c a wrong link reads nothing');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_membership_get(%L, NULL, %L, 'pepper')$q$, v_sub, '44906000-0000-4000-8000-000000000005'),
    'P0002', 'membership_not_found', 'X-4d a stranger''s account reads nothing');
END
$x4$;
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000005');
SELECT public.t4490_expect(format($q$SELECT public.issue_4490_membership_get(%L, NULL, %L, 'pepper')$q$,
    public.t4490_id('amaka'), '44906000-0000-4000-8000-000000000005'),
  '42501', NULL, 'X-4e a signed-in stranger cannot call the member read directly');
SELECT public.t4490_expect(format($q$SELECT public.issue_4490_venue_member(%L)$q$, public.t4490_id('amaka')),
  '42501', 'not_authorized', 'X-4f nor the staff member read');
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
DO $x4h$
BEGIN
  PERFORM public.t4490_ok(jsonb_array_length(public.issue_4490_venue_member(public.t4490_id('amaka'))->'payments') = 1,
    'X-4g the owner sees the same paid month');
END
$x4h$;

-- ===========================================================================
-- X-5 Offers outside opening hours (read flag; the offer is unchanged).
-- ===========================================================================
DO $x5$
DECLARE
  a1 uuid := '44906000-0000-4000-9000-0000000000a1';
  v jsonb;
  b jsonb;
  d jsonb;
BEGIN
  v := public.issue_4490_list_offers(a1);
  b := (SELECT o FROM jsonb_array_elements(v->'offers') o WHERE (o->>'id')::uuid = public.t4490_id('board'));
  PERFORM public.t4490_ok(b->>'outsideOpeningHours' = 'false', 'X-5a no opening hours set: nothing flagged');
  INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed, window_ordinal)
  SELECT '44906000-0000-4000-9000-000000000010', a1, wd, '12:00', '00:00', false, 0 FROM generate_series(0, 6) wd;
  v := public.issue_4490_list_offers(a1);
  b := (SELECT o FROM jsonb_array_elements(v->'offers') o WHERE (o->>'id')::uuid = public.t4490_id('board'));
  d := (SELECT o FROM jsonb_array_elements(v->'offers') o WHERE (o->>'id')::uuid = public.t4490_id('daypass'));
  PERFORM public.t4490_ok(b->>'outsideOpeningHours' = 'true' AND b->'outsideOpeningHoursDays' = '[0,1,2,3,4,5,6]'::jsonb
    AND d->>'outsideOpeningHours' = 'false',
    'X-5b hours now 12:00-00:00: the Boardroom (08:00-20:00) is flagged every day; the all-day Day pass is not');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.stay_place_schedule_rules r WHERE r.offering_id = public.t4490_id('board')
                           AND r.local_start_time = time '08:00' AND r.local_end_time = time '20:00') = 1,
    'X-5c the offer itself is not changed');
  UPDATE public.brand_hours SET open_time = '07:00', close_time = '02:00' WHERE venue_id = a1;
  UPDATE public.brand_hours SET is_closed = true, open_time = NULL, close_time = NULL WHERE venue_id = a1 AND weekday = 0;
  v := public.issue_4490_list_offers(a1);
  b := (SELECT o FROM jsonb_array_elements(v->'offers') o WHERE (o->>'id')::uuid = public.t4490_id('board'));
  PERFORM public.t4490_ok(b->'outsideOpeningHoursDays' = '[0]'::jsonb,
    'X-5d hours 07:00-02:00 with Monday closed: only Monday is flagged (' || (b->'outsideOpeningHoursDays')::text || ')');
  DELETE FROM public.brand_hours WHERE venue_id = a1;
END
$x5$;

-- ===========================================================================
-- X-6 Money collected today beside "taken today".
-- TEST-MOD-APPROVED #4490 (07-E): issue_4490_collected_on was replaced by
-- issue_4490_venue_money_day; venue_day returns it under 'money'.
-- ===========================================================================
DO $x6$
DECLARE
  a1 uuid := '44906000-0000-4000-9000-0000000000a1';
  v jsonb;
BEGIN
  v := public.issue_4490_venue_day(a1, NULL);
  PERFORM public.t4490_ok((v->'money'->>'paidInMinor')::bigint = 9137500
    AND (v->'money'->'paidIn'->>'online')::bigint = 9137500 AND (v->'money'->'paidIn'->>'refunded')::bigint = 0
    AND (v->'money'->>'forTodayPaidMinor')::bigint = 0
    AND jsonb_array_length(v->'bookings') = 0,
    'X-6a Amaka''s first month (N91,375) paid today is paid in today, and is not for a booking today: ' || (v->'money')::text);
  v := public.issue_4490_venue_day(a1, (now() AT TIME ZONE 'Africa/Lagos')::date + 1);
  PERFORM public.t4490_ok((v->'money'->>'paidInMinor')::bigint = 0, 'X-6b nothing is paid in tomorrow yet');
END
$x6$;
SELECT public.t4490_reset();
SELECT public.t4490_as('44906000-0000-4000-8000-000000000005');
SELECT public.t4490_expect($q$SELECT public.issue_4490_venue_money_day('44906000-0000-4000-9000-0000000000a1', current_date)$q$,
  '42501', NULL, 'X-6c a stranger cannot read the money helper directly');
SELECT public.t4490_reset();

-- ===========================================================================
-- X-7 Hire price rows by day: The Main Hall N3,500,000 Mon-Thu and
-- N4,200,000 Fri-Sat; no row on Sunday.
-- ===========================================================================
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
DO $x7a$
DECLARE
  a1 uuid := '44906000-0000-4000-9000-0000000000a1';
  v jsonb;
  v_offer uuid;
  v_hall uuid;
BEGIN
  v_hall := (public.issue_4490_manage_space('create', a1, '{"name":"The Main Hall","setting":"indoor","capacity_standing":600}'::jsonb, NULL)->>'id')::uuid;
  PERFORM public.issue_4490_set_venue_feature(a1, 'private_hire', true, NULL, NULL, NULL, 'fx1-x7-feature');
  v := public.issue_4490_manage_offer('create_draft', a1, '{"kind":"private_hire","name":"Hire the hall"}'::jsonb, NULL, 'fx1-x7-draft');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('hire', v_offer);
  v := public.issue_4490_manage_hire('set_spaces', a1, jsonb_build_object('offerId', v_offer, 'spaceIds', jsonb_build_array(v_hall),
    'combinationIds', '[]'::jsonb), public.t4490_v(v_offer), 'fx1-x7-spaces');
  v := public.issue_4490_manage_hire('set_price_row', a1, jsonb_build_object('offerId', v_offer, 'name', 'The Main Hall · Mon to Thu',
    'spaceId', v_hall, 'unit', 'booking', 'guestMin', 50, 'guestMax', 600, 'priceMinor', 350000000, 'weekdays', jsonb_build_array(0, 1, 2, 3)),
    public.t4490_v(v_offer), 'fx1-x7-row-wk');
  v := public.issue_4490_manage_hire('set_price_row', a1, jsonb_build_object('offerId', v_offer, 'name', 'The Main Hall · Fri and Sat',
    'spaceId', v_hall, 'unit', 'booking', 'guestMin', 50, 'guestMax', 600, 'priceMinor', 420000000, 'weekdays', jsonb_build_array(4, 5)),
    public.t4490_v(v_offer), 'fx1-x7-row-we');
  INSERT INTO t4490_ids SELECT CASE WHEN r->>'name' LIKE '%Mon to Thu' THEN 'o_wk' ELSE 'o_we' END, (r->>'optionId')::uuid
    FROM jsonb_array_elements(v->'hire'->'rows') r;
  PERFORM public.t4490_ok((SELECT r->'weekdays' FROM jsonb_array_elements(v->'hire'->'rows') r WHERE r->>'name' LIKE '%Fri and Sat') = '[4, 5]'::jsonb
    AND (SELECT (r->>'priceMinor')::bigint FROM jsonb_array_elements(v->'hire'->'rows') r WHERE r->>'name' LIKE '%Fri and Sat') = 420000000,
    'X-7a the Host read carries each row''s days and its own price (for the review line)');
  v := public.issue_4490_manage_hire('set_sessions', a1, jsonb_build_object('offerId', v_offer,
    'sessions', jsonb_build_array(jsonb_build_object('label', 'Full day', 'startTime', '10:00', 'endTime', '22:00')),
    'weekdays', jsonb_build_array(0, 1, 2, 3, 4, 5, 6)), public.t4490_v(v_offer), 'fx1-x7-sessions');
  v := public.issue_4490_manage_hire('set_terms', a1, jsonb_build_object('offerId', v_offer, 'hireCharge', 'hire_fee',
    'depositKind', 'percent', 'depositValue', 5000, 'balanceDueDaysBefore', 14, 'setupMinutes', 60, 'cleanupMinutes', 60,
    'damageDepositMinor', 0), public.t4490_v(v_offer), 'fx1-x7-terms');
  v := public.issue_4490_manage_offer('set_policy', a1, jsonb_build_object('offerId', v_offer, 'refundLadder', jsonb_build_array(
      jsonb_build_object('minMinutesBefore', 43200, 'refundBps', 10000))), public.t4490_v(v_offer), 'fx1-x7-policy');
  v := public.issue_4490_manage_hire('set_booking', a1, jsonb_build_object('offerId', v_offer, 'mode', 'request',
    'requestResponseHours', 48, 'approvedPaymentMinutes', 4320), public.t4490_v(v_offer), 'fx1-x7-booking');
  v := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', v_offer), public.t4490_v(v_offer), 'fx1-x7-publish');
  PERFORM public.t4490_ok(v->>'status' = 'live', 'X-7b the hire is live: ' || COALESCE(v->>'status', 'null') || ' ' || COALESCE((v->'readiness')::text, ''));
END
$x7a$;
SELECT public.t4490_reset();
CREATE TEMP TABLE fx_days ON COMMIT DROP AS
SELECT (SELECT min(d)::date FROM generate_series((now() AT TIME ZONE 'Africa/Lagos')::date + 40, (now() AT TIME ZONE 'Africa/Lagos')::date + 46, interval '1 day') d
        WHERE extract(isodow FROM d) = 6) AS sat;
GRANT SELECT ON fx_days TO PUBLIC;
CREATE FUNCTION public.fx_hwin(p_date date) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $f$
  SELECT w.id FROM public.stay_place_windows w WHERE w.offering_id = public.t4490_id('hire') AND w.local_date = p_date AND NOT w.stop_sell
  ORDER BY w.starts_at LIMIT 1 $f$;
CREATE FUNCTION public.fx_opts(p_date date) RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(h.name || '=' || h.status || '@' || h.price_minor, '; ' ORDER BY h.name)
  FROM public.pg_venue_hire_options(public.t4490_id('hire'), public.fx_hwin(p_date), 120) h $f$;
GRANT EXECUTE ON FUNCTION public.fx_hwin(date), public.fx_opts(date) TO PUBLIC;
SELECT public.t4490_as(NULL);
DO $x7b$
DECLARE
  sat date := (SELECT sat FROM fx_days);
  v text;
  a record;
BEGIN
  v := public.fx_opts(sat);
  PERFORM public.t4490_ok(v = 'The Main Hall · Fri and Sat=available@420000000; The Main Hall · Mon to Thu=wrong_weekday@350000000',
    'X-7c a guest on a Saturday: the Fri-Sat row at N4,200,000 is offered; the Mon-Thu row is not for this day (' || v || ')');
  v := public.fx_opts(sat + 3);
  PERFORM public.t4490_ok(v = 'The Main Hall · Fri and Sat=wrong_weekday@420000000; The Main Hall · Mon to Thu=available@350000000',
    'X-7d on a Tuesday the Mon-Thu row at N3,500,000 (' || v || ')');
  v := public.fx_opts(sat + 1);
  PERFORM public.t4490_ok(v NOT LIKE '%available%', 'X-7e on a Sunday no row is offered at all (' || v || ')');
  SELECT * INTO a FROM public.pg_venue_offer_availability(public.t4490_id('hire'), sat, sat + 3, 120) x WHERE x.local_date = sat;
  PERFORM public.t4490_ok(a.price_minor = 420000000, 'X-7f the day strip prices Saturday at N4,200,000 (' || COALESCE(a.price_minor::text, 'null') || ')');
  SELECT * INTO a FROM public.pg_venue_offer_availability(public.t4490_id('hire'), sat, sat + 3, 120) x WHERE x.local_date = sat + 1;
  PERFORM public.t4490_ok(a.price_minor IS NULL AND a.status <> 'available',
    'X-7g Sunday is not available and carries no price (' || COALESCE(a.status, 'null') || ')');
END
$x7b$;
SELECT public.t4490_reset();
SELECT public.t4490_service();
DO $x7c$
DECLARE
  sat date := (SELECT sat FROM fx_days);
  q jsonb;
BEGIN
  q := public.issue_4490_quote_offer(public.t4490_id('hire'), public.fx_hwin(sat),
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490_id('o_we'), 'guests', 120)),
    public.t4490_key('cart:x7'), NULL, 'fx1-x7-q-sat', '[]'::jsonb, '{"occasion":"Wedding"}'::jsonb);
  PERFORM public.t4490_ok((q->>'subtotalMinor')::bigint = 420000000 AND (q->>'taxMinor')::bigint = 31500000
    AND (q->>'totalMinor')::bigint = 451500000 AND (q->'hire'->'payPlan'->>'depositMinor')::bigint = 225750000,
    'X-7h the Saturday request: N4,200,000 + VAT N315,000 = N4,515,000; 50% deposit N2,257,500');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_quote_offer(%L::uuid, %L::uuid,
      jsonb_build_array(jsonb_build_object('priceOptionId', %L::uuid, 'guests', 120)), %L, NULL, 'fx1-x7-q-wrong', '[]'::jsonb, '{"occasion":"Wedding"}'::jsonb)$q$,
      public.t4490_id('hire'), public.fx_hwin(sat), public.t4490_id('o_wk'), public.t4490_key('cart:x7')),
    'PT409', 'offer_wrong_weekday', 'X-7i the Mon-Thu price can never be quoted for a Saturday');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_quote_offer(%L::uuid, %L::uuid,
      jsonb_build_array(jsonb_build_object('priceOptionId', %L::uuid, 'guests', 120)), %L, NULL, 'fx1-x7-q-sun', '[]'::jsonb, '{"occasion":"Wedding"}'::jsonb)$q$,
      public.t4490_id('hire'), public.fx_hwin(sat + 1), public.t4490_id('o_we'), public.t4490_key('cart:x7')),
    'PT409', 'offer_wrong_weekday', 'X-7j nor the Fri-Sat price for a Sunday');
END
$x7c$;
SELECT public.t4490_reset();

ROLLBACK;
