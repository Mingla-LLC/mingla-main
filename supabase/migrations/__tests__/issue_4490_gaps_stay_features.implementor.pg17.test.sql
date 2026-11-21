-- #4490 spec 07 J: executable PostgreSQL 17 proof that a Stay venue keeps
-- its Stays rail and may also enable the ordinary venue feature rails.
--
-- MINGLA-INVARIANT: I-4490-STAY-FEATURES-ARE-ADDITIVE | issue #4490 | room/place inventory and NULL-kind quotes stay on the Stays rail, while non-NULL offer kinds, menu, memberships and venue capabilities may also belong to a Stay venue.
--
-- FAILS-ON-REVERT: restore the Stay block in issue_4490_manage_offer and J-2
-- fails with offer_not_on_stay_venue; restore the quote condition and J-4a
-- fails with stay_scope_mismatch.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490j_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490J FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;

CREATE FUNCTION public.t4490j_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490J FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490J FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;

CREATE FUNCTION public.t4490j_as(p_user uuid)
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

CREATE FUNCTION public.t4490j_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;

GRANT EXECUTE ON FUNCTION public.t4490j_ok(boolean,text), public.t4490j_expect(text,text,text,text),
  public.t4490j_as(uuid), public.t4490j_reset() TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('44909000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'j-owner@example.test', now(), now()),
  ('44909000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'j-staff@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at)
VALUES ('44909000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at
) VALUES (
  '44909000-0000-4000-9000-000000000010', '44909000-0000-4000-8000-000000000001',
  'Stay Features J 4490', 'stay-features-j-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()
);
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44909000-0000-4000-c000-000000000003', '44909000-0000-4000-9000-000000000010',
   '44909000-0000-4000-8000-000000000003', 'venue_staff', now());
INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code
) VALUES
  ('44909000-0000-4000-9000-0000000000a1', '44909000-0000-4000-9000-000000000010', 'stayj4490', 'Stay J', 6.45, 3.41, 'stay', 'verified', 'NG'),
  ('44909000-0000-4000-9000-0000000000a2', '44909000-0000-4000-9000-000000000010', 'playj4490', 'Play J', 6.46, 3.42, 'play', 'verified', 'NG');

-- J-1/J-2: Stay keeps Stays and independently enables ordinary features.
SELECT public.t4490j_as('44909000-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44909000-0000-4000-9000-0000000000a1', 'entry', true, NULL, NULL, NULL, 'j-entry-on') IS NOT NULL AS entry_on;
SELECT public.issue_4490_set_venue_feature('44909000-0000-4000-9000-0000000000a1', 'memberships', true, NULL, NULL, NULL, 'j-members-on') IS NOT NULL AS memberships_on;
SELECT public.t4490j_reset();
CREATE TEMP TABLE t4490j_features ON COMMIT DROP AS
SELECT * FROM public.issue_4490_venue_feature_rows('44909000-0000-4000-9000-0000000000a1');
SELECT public.t4490j_ok(
  (SELECT count(*) = 3 AND bool_and(enabled)
   FROM t4490j_features WHERE feature_key IN ('stays', 'entry', 'memberships')),
  'J-1 Stays, Entry and Memberships are independently on at the Stay venue');
SELECT public.t4490j_as('44909000-0000-4000-8000-000000000001');
DO $j12$
DECLARE
  v jsonb;
  v_offer uuid;
  v_pool uuid;
BEGIN
  v := public.issue_4490_manage_capacity_pool('create', '44909000-0000-4000-9000-0000000000a1',
    '{"name":"Stay guest day","dailyLimit":40,"keptForWalkIns":5}'::jsonb, NULL, 'j-stay-pool');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', '44909000-0000-4000-9000-0000000000a1',
    '{"kind":"entry","name":"Pool day","entryStyle":"day_pass"}'::jsonb, NULL, 'j-offer-draft');
  v_offer := (v->>'id')::uuid;
  PERFORM public.t4490j_ok(NOT (v->'readiness' ? 'stay_venue'),
    'J-2a the Stay offer readiness has no category blocker');
  v := public.issue_4490_manage_offer('set_pool', '44909000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'poolId', v_pool), (v->>'version')::bigint, 'j-offer-pool');
  v := public.issue_4490_manage_offer('upsert_price_option', '44909000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Guest', 'unit', 'guest', 'guestMin', 1, 'guestMax', 6, 'priceMinor', 500000),
    (v->>'version')::bigint, 'j-offer-price');
  v := public.issue_4490_manage_offer('set_policy', '44909000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'j-offer-policy');
  v := public.issue_4490_manage_offer('set_schedule', '44909000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
      'startTime', '09:00', 'endTime', '21:00'), (v->>'version')::bigint, 'j-offer-schedule');
  v := public.issue_4490_manage_offer('publish', '44909000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'j-offer-publish');
  PERFORM public.t4490j_ok(v->>'status' = 'live' AND jsonb_array_length(v->'readiness') = 0,
    'J-2b a complete Entry offer publishes on the Stay venue');
END
$j12$;

-- J-3: memberships are an ordinary venue feature on a Stay too.
SELECT public.t4490j_ok(
  (public.issue_4490_manage_membership_plan('create', '44909000-0000-4000-9000-0000000000a1',
    '{"name":"Residents club","priceMinor":2500000}'::jsonb, NULL, 'j-plan-create')->>'name') = 'Residents club',
  'J-3 a membership plan can be created on the Stay venue');
SELECT public.t4490j_reset();

-- J-4/J-5: the two checkout rails remain distinguishable by offer_kind.
INSERT INTO public.stay_quotes (
  actor_key_hash, venue_id, brand_id, currency_code, mode, source_subtotal_minor,
  fee_total_minor, tax_total_minor, total_minor, request_hash, price_revision_set_hash,
  inventory_revision_set_hash, policy_snapshot_hash, idempotency_key, expires_at, offer_kind
) VALUES
  (repeat('a',64), '44909000-0000-4000-9000-0000000000a1', '44909000-0000-4000-9000-000000000010',
   'NGN', 'instant', 0, 0, 0, 0, repeat('b',64), repeat('c',64), repeat('d',64), repeat('e',64),
   'j-offer-quote', now() + interval '1 hour', 'entry'),
  (repeat('f',64), '44909000-0000-4000-9000-0000000000a1', '44909000-0000-4000-9000-000000000010',
   'NGN', 'instant', 0, 0, 0, 0, repeat('1',64), repeat('2',64), repeat('3',64), repeat('4',64),
   'j-stays-quote', now() + interval '1 hour', NULL);
SELECT public.t4490j_ok((SELECT count(*) FROM public.stay_quotes
  WHERE venue_id = '44909000-0000-4000-9000-0000000000a1') = 2,
  'J-4 a Stay accepts both an offer quote and its unchanged Stays quote');
SELECT public.t4490j_expect($q$INSERT INTO public.stay_quotes (
  actor_key_hash, venue_id, brand_id, currency_code, mode, source_subtotal_minor,
  fee_total_minor, tax_total_minor, total_minor, request_hash, price_revision_set_hash,
  inventory_revision_set_hash, policy_snapshot_hash, idempotency_key, expires_at, offer_kind
) VALUES (repeat('5',64), '44909000-0000-4000-9000-0000000000a2', '44909000-0000-4000-9000-000000000010',
  'NGN', 'instant', 0, 0, 0, 0, repeat('6',64), repeat('7',64), repeat('8',64), repeat('9',64),
  'j-wrong-stays-quote', now() + interval '1 hour', NULL)$q$,
  '23514', 'stay_scope_mismatch', 'J-5 a NULL-kind Stays quote still requires a Stay venue');

-- J-6: room/place inventory stays on the Stays rail.
INSERT INTO public.stay_offerings (
  venue_id, brand_id, kind, name, status, confirmation_mode, inventory_basis,
  capacity, place_pricing_basis
) VALUES (
  '44909000-0000-4000-9000-0000000000a1', '44909000-0000-4000-9000-000000000010',
  'place', 'Pool cabana', 'draft', 'instant', 'shared_capacity', 8, 'per_guest'
);
SELECT public.t4490j_ok(EXISTS (SELECT 1 FROM public.stay_offerings
  WHERE venue_id = '44909000-0000-4000-9000-0000000000a1' AND kind = 'place' AND name = 'Pool cabana'),
  'J-6a a Stay place remains valid');
SELECT public.t4490j_expect($q$INSERT INTO public.stay_offerings (
  venue_id, brand_id, kind, name, status, confirmation_mode, inventory_basis,
  quantity, max_adults, max_children
) VALUES (
  '44909000-0000-4000-9000-0000000000a2', '44909000-0000-4000-9000-000000000010',
  'room', 'Wrong room', 'draft', 'instant', 'pooled_units', 1, 2, 0
)$q$, '23514', 'stay_venue_brand_mismatch', 'J-6b a room still cannot sit on a non-Stay venue');

-- J-7: the Menu default remains preset-or-existing-menu, independent of Stay.
SELECT public.t4490j_ok(NOT (SELECT enabled FROM public.issue_4490_venue_feature_rows(
  '44909000-0000-4000-9000-0000000000a1') WHERE feature_key = 'menu'),
  'J-7a a Stay with no menu and no Menu row defaults Menu off');
INSERT INTO public.menus (brand_id, venue_id, name)
VALUES ('44909000-0000-4000-9000-000000000010', '44909000-0000-4000-9000-0000000000a1', 'Stay menu');
SELECT public.t4490j_ok((SELECT enabled FROM public.issue_4490_venue_feature_rows(
  '44909000-0000-4000-9000-0000000000a1') WHERE feature_key = 'menu'),
  'J-7b an existing Stay menu makes Menu on without a stored feature override');

-- J-8: Stay staff may combine Stays and enabled venue-feature capabilities.
SELECT public.t4490j_as('44909000-0000-4000-8000-000000000001');
SELECT public.t4490j_ok(
  (public.issue_4188_set_member_venue_grants(
    '44909000-0000-4000-9000-000000000010', '44909000-0000-4000-c000-000000000003',
    '[{"venueId":"44909000-0000-4000-9000-0000000000a1","profile":"restaurant_manager","capabilities":["stay.view_reservations","restaurant.manage_menu","venue.manage_offers"]}]'::jsonb
  )->>'venueCount')::integer = 1,
  'J-8a a Stay grant combines Stays, restaurant and venue capabilities');
SELECT public.t4490j_expect($q$SELECT public.issue_4188_set_member_venue_grants(
  '44909000-0000-4000-9000-000000000010', '44909000-0000-4000-c000-000000000003',
  '[{"venueId":"44909000-0000-4000-9000-0000000000a1","profile":"custom","capabilities":["venue.everything"]}]'::jsonb)$q$,
  '22023', 'invalid_venue_grants', 'J-8b an unknown capability is still refused');
SELECT public.t4490j_expect($q$SELECT public.issue_4188_set_member_venue_grants(
  '44909000-0000-4000-9000-000000000010', '44909000-0000-4000-c000-000000000003',
  '[{"venueId":"44909000-0000-4000-9000-0000000000a2","profile":"custom","capabilities":["stay.view_reservations"]}]'::jsonb)$q$,
  '22023', 'invalid_venue_grants', 'J-8c a non-Stay venue still refuses Stay capabilities');
SELECT public.t4490j_reset();

ROLLBACK;
