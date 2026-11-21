-- #4490 spec 07 J: executable PostgreSQL 17 proof that a Stay venue keeps
-- its Stays rail and may also enable the ordinary venue feature rails.
--
-- MINGLA-INVARIANT: I-4490-STAY-FEATURES-ARE-ADDITIVE | issue #4490 | room/place inventory and NULL-kind quotes stay on the Stays rail, while non-NULL offer kinds, menu, memberships and venue capabilities may also belong to a Stay venue.
--
-- FAILS-ON-REVERT: restore the Stay block in issue_4490_manage_offer and J-2
-- fails with offer_not_on_stay_venue; restore the quote condition and J-4a
-- fails with stay_scope_mismatch. Drop the offer-kind filters from the Stay
-- snapshot, inventory writes, Stay reservations and Stay detail reads and
-- J-10 to J-14b fail (the Stay screens see the Entry offer and its booking).
-- Drop the nested-id parse from biz_manage_stay_inventory and J-16f to J-16j
-- fail with a raw 22P02 (or a different refusal) instead of stay_invalid_payload.
-- Drop the R4J-N21 list-shape guard and J-16l, J-16m, J-16n, J-16o, J-16p
-- and J-16q fail with the raw 22023 "cannot extract elements" / "cannot get
-- array length" message instead of stay_invalid_payload.
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

-- J-9..J-13 (fix round 2): the Stay engine's own screens see only Stay rows.
-- The live Entry offer from J-2 and the cabana from J-6a share the Stay venue.
CREATE TEMP TABLE t4490j_ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.stay_offerings
   WHERE venue_id = '44909000-0000-4000-9000-0000000000a1' AND kind = 'entry') AS entry_id,
  (SELECT id FROM public.stay_offerings
   WHERE venue_id = '44909000-0000-4000-9000-0000000000a1' AND kind = 'place') AS place_id;
GRANT SELECT ON t4490j_ids TO PUBLIC;
-- An ordinary NULL-kind Stays booking and a venue-offer booking on the Stay.
INSERT INTO public.stay_reservation_groups (
  id, public_reference, quote_id, actor_key_hash, venue_id, brand_id, currency_code,
  mode, state, guest_snapshot, source_subtotal_minor, fee_total_minor, tax_total_minor,
  total_minor, idempotency_key, request_hash, offer_kind, payment_plan_snapshot
)
SELECT g.id, g.ref, q.id, q.actor_key_hash, q.venue_id, q.brand_id, 'NGN',
  'instant', 'instant_payment_pending', '{"name":"J guest"}'::jsonb, 0, 0, 0, 0,
  g.idem, repeat('b', 64), q.offer_kind, g.plan
FROM (VALUES
  ('44909000-0000-4000-d000-000000000001'::uuid, 'ST-4490900000000000000A', 'j-stays-quote', 'j-stays-group', '{}'::jsonb),
  ('44909000-0000-4000-d000-000000000002'::uuid, 'VB-4490900000000000000B', 'j-offer-quote', 'j-offer-group', '{"kind":"full"}'::jsonb)
) g(id, ref, quote_key, idem, plan)
JOIN public.stay_quotes q ON q.idempotency_key = g.quote_key;
SELECT public.t4490j_ok((SELECT count(*) FROM public.stay_reservation_groups
  WHERE venue_id = '44909000-0000-4000-9000-0000000000a1') = 2,
  'J-9 fixture: one Stays booking and one venue-offer booking on the Stay');

SELECT public.t4490j_as('44909000-0000-4000-8000-000000000001');
-- J-10: Rooms & Places, Stay readiness and the route header read one snapshot.
SELECT public.t4490j_ok(
  (SELECT jsonb_agg(o->>'kind') = '["place"]'::jsonb
   FROM jsonb_array_elements(public.issue_1387_stay_inventory_snapshot(
     '44909000-0000-4000-9000-0000000000a1')->'offerings') o),
  'J-10 the Stay inventory snapshot lists the place and never the Entry offer');
-- J-11: Stay inventory writes refuse a venue-offer row and leave it untouched.
SELECT public.t4490j_expect(format($q$SELECT public.biz_manage_stay_inventory('change_status',
  '44909000-0000-4000-9000-0000000000a1', %L::jsonb, 1, NULL)$q$,
  jsonb_build_object('offeringId', (SELECT entry_id FROM t4490j_ids), 'status', 'paused')),
  'P0002', 'stay_offering_not_found', 'J-11a Stay pause refuses the Entry offer');
SELECT public.t4490j_expect(format($q$SELECT public.biz_manage_stay_inventory('update_offering',
  '44909000-0000-4000-9000-0000000000a1', %L::jsonb, 1, NULL)$q$,
  jsonb_build_object('offeringId', upper((SELECT entry_id FROM t4490j_ids)::text), 'name', 'Renamed')),
  'P0002', 'stay_offering_not_found', 'J-11b Stay edit refuses the Entry offer (any id case)');
SELECT public.t4490j_expect(format($q$SELECT public.biz_manage_stay_inventory('set_price',
  '44909000-0000-4000-9000-0000000000a1', %L::jsonb, 1, NULL)$q$,
  jsonb_build_object('offeringId', (SELECT entry_id FROM t4490j_ids), 'amountMinor', 1)),
  'P0002', 'stay_offering_not_found', 'J-11c Stay price refuses the Entry offer');
SELECT public.t4490j_ok(
  (SELECT name = 'Pool day' AND status = 'live' FROM public.stay_offerings
   WHERE id = (SELECT entry_id FROM t4490j_ids)),
  'J-11d the refused Entry offer keeps its name and live status');
SELECT public.biz_manage_stay_inventory('update_offering', '44909000-0000-4000-9000-0000000000a1',
  jsonb_build_object('offeringId', (SELECT place_id FROM t4490j_ids), 'name', 'Pool cabana two'),
  1, NULL) IS NOT NULL AS place_edit_saved;
SELECT public.t4490j_ok(
  (SELECT name = 'Pool cabana two' FROM public.stay_offerings WHERE id = (SELECT place_id FROM t4490j_ids)),
  'J-11e the same Stay edit still saves a place');
-- J-12: Stay Reservations lists and acts on Stays bookings only.
SELECT public.t4490j_ok(
  (SELECT jsonb_agg(g->>'publicReference') = '["ST-4490900000000000000A"]'::jsonb
   FROM jsonb_array_elements(public.issue_1426_list_staff_stay_reservations(
     '44909000-0000-4000-9000-0000000000a1')->'groups') g),
  'J-12a Stay Reservations lists the Stays booking and not the venue-offer booking');
SELECT public.t4490j_expect($q$SELECT public.issue_1426_staff_group_projection(
  '44909000-0000-4000-d000-000000000002')$q$,
  'P0002', 'stay_group_not_found', 'J-12b the Stay booking detail refuses a venue-offer booking');
SELECT public.t4490j_expect($q$SELECT public.issue_4188_cancel_preview(
  '44909000-0000-4000-d000-000000000002', ARRAY['44909000-0000-4000-d000-0000000000ff']::uuid[], 1, NULL)$q$,
  'P0002', 'stay_group_not_found', 'J-12c the Stay cancel path refuses a venue-offer booking');
SELECT public.t4490j_expect($q$SELECT public.issue_1426_manage_request(
  'approve', '44909000-0000-4000-d000-000000000002', 1, 'j-approve-offer-group', NULL)$q$,
  'P0002', 'stay_group_not_found', 'J-12d Stay approve refuses a venue-offer booking');
-- J-13: the reverse holds too: the venue-offer list never shows the place.
SELECT public.t4490j_ok(
  public.issue_4490_list_offers('44909000-0000-4000-9000-0000000000a1')::text LIKE '%Pool day%'
  AND public.issue_4490_list_offers('44909000-0000-4000-9000-0000000000a1')::text NOT LIKE '%Pool cabana%',
  'J-13 the venue Offers list shows the Entry offer and never the Stay place');
SELECT public.t4490j_reset();

-- J-14: Stay detail reads (staff availability and the public Stay page) list
-- priced live rooms and places only, so "From ... a night" ignores a day pass.
SELECT set_config('mingla.stay_publish_authorized', 'true', true);
INSERT INTO public.stay_settings (venue_id, brand_id, booking_state)
VALUES ('44909000-0000-4000-9000-0000000000a1', '44909000-0000-4000-9000-000000000010', 'active');
INSERT INTO public.feature_flags (flag_key, is_enabled) VALUES ('STAY_PUBLIC_PAGES', true)
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;
SELECT public.t4490j_ok(EXISTS (SELECT 1 FROM public.stay_price_versions
  WHERE offering_id = (SELECT entry_id FROM t4490j_ids) AND effective_to IS NULL)
  AND EXISTS (SELECT 1 FROM public.stay_policy_versions
  WHERE offering_id = (SELECT entry_id FROM t4490j_ids) AND effective_to IS NULL),
  'J-14 fixture: the live Entry offer has a current price and policy');
SELECT public.t4490j_as('44909000-0000-4000-8000-000000000001');
SELECT public.t4490j_ok(
  COALESCE(public.issue_4188_staff_stay_details('44909000-0000-4000-9000-0000000000a1')->'offerings',
    '[]'::jsonb) = '[]'::jsonb,
  'J-14a staff Stay details never list the Entry offer');
SELECT public.t4490j_reset();
SELECT public.t4490j_as(NULL);
SELECT public.t4490j_ok(
  COALESCE(public.pg_public_stay_details('44909000-0000-4000-9000-0000000000a1')->'offerings',
    '[]'::jsonb) = '[]'::jsonb,
  'J-14b the public Stay page never lists the Entry offer as a room or place');
SELECT public.t4490j_reset();

-- J-15 (R4J-N7): "Sells outside your opening hours" is data-driven. A venue
-- with no opening-hours rows never flags an offer (the Entry offer here sells
-- 09:00-21:00 every day); once hours exist that do not cover it, it does.
SELECT public.t4490j_ok(
  NOT EXISTS (SELECT 1 FROM public.brand_hours WHERE venue_id = '44909000-0000-4000-9000-0000000000a1')
  AND (public.issue_4490_offer_hours_check((SELECT entry_id FROM t4490j_ids))->>'outsideOpeningHours')::boolean = false,
  'J-15a no opening hours set: the Entry offer is never "outside your opening hours"');
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44909000-0000-4000-9000-000000000010', '44909000-0000-4000-9000-0000000000a1', wd,
  time '10:00', time '18:00', false
FROM generate_series(0, 6) wd;
SELECT public.t4490j_ok(
  (public.issue_4490_offer_hours_check((SELECT entry_id FROM t4490j_ids))->>'outsideOpeningHours')::boolean,
  'J-15b hours that do not cover the offer still raise the warning');

-- J-16 (R4J-N12): every uuid spelling of a venue-offer row id is the same id.
-- Braces, no hyphens, upper case and mixed forms are refused as not found;
-- a spelling the uuid type refuses is the ordinary invalid-payload refusal.
-- The Entry offer, its media and its schedule rule stay byte-identical.
INSERT INTO storage.objects (id, bucket_id, name, metadata)
VALUES ('44909000-0000-4000-e000-000000000001', 'brand_covers',
        '44909000-0000-4000-9000-000000000010/stay/entry-cover.jpg',
        '{"mimetype":"image/jpeg","size":1024}'::jsonb);
INSERT INTO public.stay_offering_media (
  id, offering_id, brand_id, venue_id, storage_object_id, storage_bucket_id,
  storage_object_name, mime_type, byte_size, sort_order, is_cover
)
SELECT '44909000-0000-4000-e000-000000000002', entry_id, '44909000-0000-4000-9000-000000000010',
  '44909000-0000-4000-9000-0000000000a1', '44909000-0000-4000-e000-000000000001', 'brand_covers',
  '44909000-0000-4000-9000-000000000010/stay/entry-cover.jpg', 'image/jpeg', 1024, 0, false
FROM t4490j_ids;
CREATE TEMP TABLE t4490j_snap ON COMMIT DROP AS
SELECT
  (SELECT row_to_json(o)::text FROM public.stay_offerings o WHERE o.id = i.entry_id) AS offer_row,
  (SELECT string_agg(row_to_json(m)::text, '|' ORDER BY m.id) FROM public.stay_offering_media m
   WHERE m.offering_id = i.entry_id) AS media_rows,
  (SELECT string_agg(row_to_json(r)::text, '|' ORDER BY r.id) FROM public.stay_place_schedule_rules r
   WHERE r.offering_id = i.entry_id) AS rule_rows,
  (SELECT string_agg(row_to_json(p)::text, '|' ORDER BY p.id) FROM public.stay_price_versions p
   WHERE p.offering_id = i.entry_id) AS price_rows,
  (SELECT r.id FROM public.stay_place_schedule_rules r WHERE r.offering_id = i.entry_id) AS rule_id,
  (SELECT o.version FROM public.stay_offerings o WHERE o.id = i.entry_id) AS offer_version
FROM t4490j_ids i;
GRANT SELECT ON t4490j_snap TO PUBLIC;
SELECT public.t4490j_ok((SELECT rule_id IS NOT NULL AND media_rows IS NOT NULL FROM t4490j_snap),
  'J-16 fixture: the Entry offer has a media row and a schedule rule');

CREATE FUNCTION public.t4490j_spellings(p_id uuid)
RETURNS TABLE(label text, spelled text) LANGUAGE sql AS $f$
  SELECT * FROM (VALUES
    ('braces', '{' || p_id::text || '}'),
    ('no hyphens', replace(p_id::text, '-', '')),
    ('upper case', upper(p_id::text)),
    ('braces, upper, no hyphens', '{' || upper(replace(p_id::text, '-', '')) || '}'),
    ('hyphen every four', regexp_replace(replace(p_id::text, '-', ''), '(.{4})(?!$)', '\1-', 'g'))
  ) v(label, spelled)
$f$;
GRANT EXECUTE ON FUNCTION public.t4490j_spellings(uuid) TO PUBLIC;

SELECT public.t4490j_as('44909000-0000-4000-8000-000000000001');
DO $j16$
DECLARE
  v_entry uuid := (SELECT entry_id FROM t4490j_ids);
  v_media uuid := '44909000-0000-4000-e000-000000000002';
  v_rule uuid := (SELECT rule_id FROM t4490j_snap);
  v_version bigint := (SELECT offer_version FROM t4490j_snap);
  v_spell record;
  v_call record;
  v_state text;
  v_message text;
  v_count integer := 0;
BEGIN
  FOR v_spell IN
    SELECT 'offering' AS target, s.* FROM public.t4490j_spellings(v_entry) s
    UNION ALL SELECT 'media', s.* FROM public.t4490j_spellings(v_media) s
    UNION ALL SELECT 'rule', s.* FROM public.t4490j_spellings(v_rule) s
  LOOP
    FOR v_call IN
      SELECT * FROM (VALUES
        ('offering', 'update_offering', jsonb_build_object('offeringId', v_spell.spelled, 'name', 'HIJACKED')),
        ('offering', 'change_status', jsonb_build_object('offeringId', v_spell.spelled, 'status', 'paused')),
        ('offering', 'set_price', jsonb_build_object('offeringId', v_spell.spelled, 'amountMinor', 1)),
        ('offering', 'set_policy', jsonb_build_object('offeringId', v_spell.spelled, 'freeCancelCutoffMinutes', 0)),
        ('offering', 'replace_fees', jsonb_build_object('offeringId', v_spell.spelled, 'fees', '[]'::jsonb)),
        ('offering', 'reorder_media', jsonb_build_object('offeringId', v_spell.spelled,
          'mediaIds', jsonb_build_array(v_media))),
        ('media', 'remove_media', jsonb_build_object('mediaId', v_spell.spelled)),
        ('rule', 'materialize_place_windows', jsonb_build_object('scheduleRuleId', v_spell.spelled,
          'fromDate', current_date, 'toDate', current_date + 1)),
        ('rule', 'upsert_place_schedule', jsonb_build_object('offeringId', (SELECT place_id FROM t4490j_ids),
          'scheduleRuleId', v_spell.spelled, 'mode', 'full_day', 'timezone', 'Africa/Lagos',
          'localStartDate', current_date, 'weekdays', jsonb_build_array(1)))
      ) c(target, action, payload)
      WHERE c.target = v_spell.target
    LOOP
      v_state := NULL;
      BEGIN
        PERFORM public.biz_manage_stay_inventory(v_call.action,
          '44909000-0000-4000-9000-0000000000a1', v_call.payload, v_version, NULL);
      EXCEPTION WHEN OTHERS THEN
        v_state := SQLSTATE;
        v_message := SQLERRM;
      END;
      IF v_state IS DISTINCT FROM 'P0002' OR v_message <> 'stay_offering_not_found' THEN
        RAISE EXCEPTION 'T4490J FAIL: J-16a % % (%) was not refused as not found: % %',
          v_call.action, v_spell.target, v_spell.label, v_state, v_message;
      END IF;
      v_count := v_count + 1;
    END LOOP;
  END LOOP;
  PERFORM public.t4490j_ok(v_count = 5 * 9,
    'J-16a 45 Stay inventory writes with braces, hyphenless, upper-case and regrouped ids of the Entry offer, its media and its schedule rule are refused as not found');
END
$j16$;
SELECT public.t4490j_expect(format($q$SELECT public.biz_manage_stay_inventory('update_offering',
  '44909000-0000-4000-9000-0000000000a1', %L::jsonb, %s, NULL)$q$,
  jsonb_build_object('offeringId', ' ' || (SELECT entry_id FROM t4490j_ids)::text || ' ', 'name', 'HIJACKED'),
  (SELECT offer_version FROM t4490j_snap)),
  '22023', 'stay_invalid_payload', 'J-16b an id with surrounding spaces is the invalid-payload refusal, not a server error');
SELECT public.t4490j_expect($q$SELECT public.biz_manage_stay_inventory('remove_media',
  '44909000-0000-4000-9000-0000000000a1', '{"mediaId":"not-a-uuid"}'::jsonb, 1, NULL)$q$,
  '22023', 'stay_invalid_payload', 'J-16c an unparseable media id is the invalid-payload refusal');
-- R4J-N15: ids nested in lists are parsed the same way (no 22P02 server error).
SELECT public.t4490j_expect(format($q$SELECT public.biz_manage_stay_inventory('upsert_place_windows',
  '44909000-0000-4000-9000-0000000000a1', %L::jsonb, NULL, NULL)$q$,
  jsonb_build_object('windows', jsonb_build_array(jsonb_build_object(
    'windowId', ' ' || (SELECT w.id FROM public.stay_place_windows w
                        WHERE w.offering_id = (SELECT entry_id FROM t4490j_ids) ORDER BY w.starts_at LIMIT 1)::text || ' ',
    'expectedVersion', 1)))),
  '22023', 'stay_invalid_payload', 'J-16f a spaced venue-offer window id inside windows[] is the invalid-payload refusal');
SELECT public.t4490j_expect($q$SELECT public.biz_manage_stay_inventory('upsert_place_windows',
  '44909000-0000-4000-9000-0000000000a1', '{"windows":[{"windowId":"not-a-uuid","expectedVersion":1}]}'::jsonb, NULL, NULL)$q$,
  '22023', 'stay_invalid_payload', 'J-16g an unparseable window id inside windows[] is the invalid-payload refusal');
-- The place gets one media row so a one-item mediaIds list reaches the id parse.
SELECT public.t4490j_reset();
INSERT INTO storage.objects (id, bucket_id, name, metadata)
VALUES ('44909000-0000-4000-e000-000000000003', 'brand_covers',
        '44909000-0000-4000-9000-000000000010/stay/place-cover.jpg',
        '{"mimetype":"image/jpeg","size":1024}'::jsonb);
INSERT INTO public.stay_offering_media (
  id, offering_id, brand_id, venue_id, storage_object_id, storage_bucket_id,
  storage_object_name, mime_type, byte_size, sort_order, is_cover
)
SELECT '44909000-0000-4000-e000-000000000004', place_id, '44909000-0000-4000-9000-000000000010',
  '44909000-0000-4000-9000-0000000000a1', '44909000-0000-4000-e000-000000000003', 'brand_covers',
  '44909000-0000-4000-9000-000000000010/stay/place-cover.jpg', 'image/jpeg', 1024, 0, false
FROM t4490j_ids;
SELECT public.t4490j_as('44909000-0000-4000-8000-000000000001');
SELECT public.t4490j_expect(format($q$SELECT public.biz_manage_stay_inventory('reorder_media',
  '44909000-0000-4000-9000-0000000000a1', %L::jsonb, %s, NULL)$q$,
  jsonb_build_object('offeringId', (SELECT place_id FROM t4490j_ids), 'mediaIds', jsonb_build_array('not-a-uuid')),
  (SELECT version FROM public.stay_offerings WHERE id = (SELECT place_id FROM t4490j_ids))),
  '22023', 'stay_invalid_payload', 'J-16h an unparseable id inside mediaIds[] is the invalid-payload refusal');
SELECT public.t4490j_expect(format($q$SELECT public.biz_manage_stay_inventory('reorder_media',
  '44909000-0000-4000-9000-0000000000a1', %L::jsonb, 1, NULL)$q$,
  jsonb_build_object('offeringId', (SELECT entry_id FROM t4490j_ids), 'mediaIds', 'not-a-list')),
  '22023', 'stay_invalid_payload', 'J-16i a mediaIds value that is not a list is the invalid-payload refusal');
SELECT public.t4490j_expect($q$SELECT public.biz_manage_stay_inventory('resolve_currency_reconciliation',
  '44909000-0000-4000-9000-0000000000a1', '{"reconciliationId":"not-a-uuid","decision":"keep"}'::jsonb, NULL, NULL)$q$,
  '22023', 'stay_invalid_payload', 'J-16j an unparseable reconciliation id is the invalid-payload refusal');
-- R4J-N21: a list field that is not a list is refused plainly before the
-- capability check reads it (it used to surface 22023 "cannot extract
-- elements from an object/scalar", an edge 500).
SELECT public.t4490j_expect($q$SELECT public.biz_manage_stay_inventory('upsert_place_windows',
  '44909000-0000-4000-9000-0000000000a1', '{"windows":{"windowId":"x"}}'::jsonb, NULL, NULL)$q$,
  '22023', 'stay_invalid_payload', 'J-16l windows sent as an object is the invalid-payload refusal');
SELECT public.t4490j_expect($q$SELECT public.biz_manage_stay_inventory('upsert_place_windows',
  '44909000-0000-4000-9000-0000000000a1', '{"windows":"x"}'::jsonb, NULL, NULL)$q$,
  '22023', 'stay_invalid_payload', 'J-16m windows sent as a string is the invalid-payload refusal');
SELECT public.t4490j_expect($q$SELECT public.biz_manage_stay_inventory('upsert_place_windows',
  '44909000-0000-4000-9000-0000000000a1', '{"windows":null}'::jsonb, NULL, NULL)$q$,
  '22023', 'stay_invalid_payload', 'J-16n windows sent as JSON null is the invalid-payload refusal');
SELECT public.t4490j_expect($q$SELECT public.biz_manage_stay_inventory('upsert_room_nights',
  '44909000-0000-4000-9000-0000000000a1', '{"nights":{"date":"2030-01-01"}}'::jsonb, NULL, NULL)$q$,
  '22023', 'stay_invalid_payload', 'J-16o nights sent as an object is the invalid-payload refusal');
SELECT public.t4490j_expect($q$SELECT public.biz_manage_stay_inventory('create_offering',
  '44909000-0000-4000-9000-0000000000a1', '{"kind":"place","name":"X","fees":"none"}'::jsonb, NULL, NULL)$q$,
  '22023', 'stay_invalid_payload', 'J-16p fees sent as a string is the invalid-payload refusal');
SELECT public.t4490j_expect($q$SELECT public.biz_manage_stay_inventory('bulk_create',
  '44909000-0000-4000-9000-0000000000a1', '{"items":[{"name":"X","fees":{"a":1}}]}'::jsonb, NULL, NULL)$q$,
  '22023', 'stay_invalid_payload', 'J-16q an item whose fees is not a list is the invalid-payload refusal');
SELECT public.t4490j_reset();
SELECT public.t4490j_ok((SELECT sort_order = 0 AND offering_id = (SELECT place_id FROM t4490j_ids)
                         FROM public.stay_offering_media WHERE id = '44909000-0000-4000-e000-000000000004'),
  'J-16k the refused nested-id writes changed no media row');
SELECT public.t4490j_ok((
  SELECT s.offer_row = (SELECT row_to_json(o)::text FROM public.stay_offerings o WHERE o.id = i.entry_id)
    AND s.media_rows = (SELECT string_agg(row_to_json(m)::text, '|' ORDER BY m.id)
                        FROM public.stay_offering_media m WHERE m.offering_id = i.entry_id)
    AND s.rule_rows = (SELECT string_agg(row_to_json(r)::text, '|' ORDER BY r.id)
                       FROM public.stay_place_schedule_rules r WHERE r.offering_id = i.entry_id)
    AND s.price_rows = (SELECT string_agg(row_to_json(p)::text, '|' ORDER BY p.id)
                        FROM public.stay_price_versions p WHERE p.offering_id = i.entry_id)
  FROM t4490j_snap s CROSS JOIN t4490j_ids i),
  'J-16d the Entry offer, its media, schedule rule and prices are byte-identical afterwards');
-- The typed ids still work for a real place: a braced, upper-case id edits it.
SELECT public.t4490j_as('44909000-0000-4000-8000-000000000001');
SELECT public.biz_manage_stay_inventory('update_offering', '44909000-0000-4000-9000-0000000000a1',
  jsonb_build_object('offeringId', '{' || upper((SELECT place_id FROM t4490j_ids)::text) || '}', 'name', 'Pool cabana three'),
  (SELECT version FROM public.stay_offerings WHERE id = (SELECT place_id FROM t4490j_ids)), NULL) IS NOT NULL AS place_braced_edit;
SELECT public.t4490j_reset();
SELECT public.t4490j_ok(
  (SELECT name = 'Pool cabana three' FROM public.stay_offerings WHERE id = (SELECT place_id FROM t4490j_ids)),
  'J-16e a braced upper-case id of a real place still edits the place');

-- J-17 (R4J-N13): a paid venue-offer booking on the Stay. A preview minted by
-- the venue-offer cancel preview cannot be spent by any Stays cancel path, and
-- no Stays preview or approve/pay writer accepts the venue-offer group. The
-- venue-offer cancel then still refunds every payment.
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['STAY_RESERVE_READS', 'STAY_RESERVE_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;
CREATE FUNCTION public.t4490j_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490j_service() TO PUBLIC;
CREATE TEMP TABLE t4490j_money (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON t4490j_money TO PUBLIC;
SELECT public.t4490j_service();
DO $j17fx$
DECLARE
  v_entry uuid := (SELECT entry_id FROM t4490j_ids);
  v_window uuid;
  v_option uuid;
  v_q jsonb;
  v_g jsonb;
  v_p jsonb;
  v_ref text;
  v_cart text := encode(sha256(convert_to('cart:j17', 'UTF8')), 'hex');
BEGIN
  SELECT id INTO v_window FROM public.stay_place_windows
  WHERE offering_id = v_entry AND local_date = current_date + 14 ORDER BY starts_at LIMIT 1;
  SELECT id INTO v_option FROM public.venue_offer_price_options WHERE offering_id = v_entry AND name = 'Guest';
  v_q := public.issue_4490_quote_offer(v_entry, v_window,
    jsonb_build_array(jsonb_build_object('priceOptionId', v_option, 'guests', 3)), v_cart, NULL, 'j17-quote');
  v_g := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    jsonb_build_object('name', 'J17 Guest', 'email', 'j17-4490@example.test'), v_cart, NULL,
    sha256(convert_to('tok:j17', 'UTF8')), 'j17-hold');
  v_p := public.issue_4490_prepare_offer_payment((v_g->>'groupId')::uuid, sha256(convert_to('tok:j17', 'UTF8')),
    NULL, 'j17-pay-key', (SELECT version FROM public.stay_reservation_groups WHERE id = (v_g->>'groupId')::uuid));
  v_ref := 'mingla_stay_' || replace(v_p->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((v_p->>'attemptId')::uuid, v_ref, NULL, NULL);
  PERFORM public.issue_1389_finalize_payment('paystack', 'evt-j17', 'charge.success', v_ref, 'ch-j17',
    (v_p->>'amountMinor')::bigint, 'NGN', 0, NULL);
  INSERT INTO t4490j_money VALUES ('group', to_jsonb((v_g->>'groupId')::uuid)), ('paid', to_jsonb((v_p->>'amountMinor')::bigint));
END
$j17fx$;
SELECT public.t4490j_reset();
CREATE TEMP TABLE t4490j_vb ON COMMIT DROP AS
SELECT g.id, g.state, g.version, g.offer_kind,
  (SELECT (v #>> '{}')::bigint FROM t4490j_money WHERE k = 'paid') AS paid_minor,
  ARRAY(SELECT l.id FROM public.stay_reservation_lines l WHERE l.group_id = g.id ORDER BY l.id) AS line_ids,
  (SELECT count(*) FROM public.notification_outbox o
   WHERE o.payload->>'venue_group_id' = g.id::text OR o.payload->>'stay_group_id' = g.id::text) AS outbox_before
FROM public.stay_reservation_groups g
WHERE g.id = (SELECT (v #>> '{}')::uuid FROM t4490j_money WHERE k = 'group');
GRANT SELECT ON t4490j_vb TO PUBLIC;
SELECT public.t4490j_ok((SELECT state = 'confirmed' AND offer_kind = 'entry' AND paid_minor > 0 FROM t4490j_vb),
  'J-17 fixture: a paid, confirmed Entry booking on the Stay venue');

-- The tester's exact repro: in ONE transaction, the owner mints the venue-offer
-- preview and hands its id and hash to each Stays cancel entry point.
SELECT public.t4490j_as('44909000-0000-4000-8000-000000000001');
DO $j17a$
DECLARE
  v_group uuid := (SELECT id FROM t4490j_vb);
  v_pv jsonb;
  v_preview uuid;
  v_hash text;
  v_call record;
  v_state text;
  v_message text;
BEGIN
  v_pv := public.issue_4490_cancel_preview(v_group);
  v_preview := (v_pv->'previews'->0->>'previewId')::uuid;
  v_hash := v_pv->'previews'->0->>'previewHash';
  INSERT INTO t4490j_money VALUES ('offer_preview', v_pv);
  FOR v_call IN
    SELECT * FROM (VALUES
      ('issue_1389_cancel', format('SELECT public.issue_1389_cancel(%L, %L, %L, %L, NULL)',
        v_preview, v_hash, 'j17-stays-1389', 'tester probe'), 'stay_cancel_preview_invalid', '22023'),
      ('issue_1426_cancel', format('SELECT public.issue_1426_cancel(%L, %L, %L, %L, NULL)',
        v_preview, v_hash, 'j17-stays-1426', 'tester probe'), 'stay_cancel_preview_invalid', '22023'),
      ('issue_4188_cancel', format('SELECT public.issue_4188_cancel(%L, %L, %L, %L, NULL)',
        v_preview, v_hash, 'j17-stays-4188', 'tester probe'), 'stay_cancel_preview_invalid', '22023'),
      ('issue_1389_cancel_preview', format('SELECT public.issue_1389_cancel_preview(%L, %L::uuid[], %s, NULL)',
        v_group, (SELECT line_ids FROM t4490j_vb),
        (SELECT version FROM t4490j_vb)), 'stay_group_not_found', 'P0002'),
      ('issue_1426_cancel_preview', format('SELECT public.issue_1426_cancel_preview(%L, %L::uuid[], %s, NULL)',
        v_group, (SELECT line_ids FROM t4490j_vb),
        (SELECT version FROM t4490j_vb)), 'stay_group_not_found', 'P0002'),
      ('issue_1426_manage_request decline', format('SELECT public.issue_1426_manage_request(%L, %L, %s, %L, NULL)',
        'decline', v_group, (SELECT version FROM t4490j_vb), 'j17-decline'), 'stay_group_not_found', 'P0002'),
      ('biz_manage_stay_reservation decline', format('SELECT public.biz_manage_stay_reservation(%L, %L::jsonb, %s, NULL)',
        'decline_request', jsonb_build_object('groupId', v_group, 'idempotencyKey', 'j17-decline-2'),
        (SELECT version FROM t4490j_vb)), 'stay_group_not_found', 'P0002')
    ) c(label, sql, message, state)
  LOOP
    v_state := NULL;
    BEGIN
      EXECUTE v_call.sql;
    EXCEPTION WHEN OTHERS THEN
      v_state := SQLSTATE;
      v_message := SQLERRM;
    END;
    IF v_state IS DISTINCT FROM v_call.state OR v_message <> v_call.message THEN
      RAISE EXCEPTION 'T4490J FAIL: J-17a % accepted the venue-offer booking (got % %)',
        v_call.label, v_state, v_message;
    END IF;
  END LOOP;
END
$j17a$;
SELECT public.t4490j_reset();
SELECT public.t4490j_ok((
  SELECT g.state = 'confirmed' AND g.version = vb.version
    AND NOT EXISTS (SELECT 1 FROM public.stay_reservation_lines l WHERE l.group_id = g.id AND l.state <> 'confirmed')
    AND NOT EXISTS (SELECT 1 FROM public.stay_refunds r WHERE r.group_id = g.id)
    AND (SELECT count(*) FROM public.notification_outbox o
         WHERE o.payload->>'venue_group_id' = g.id::text OR o.payload->>'stay_group_id' = g.id::text) = vb.outbox_before
    AND (SELECT count(*) FROM public.stay_cancel_previews p WHERE p.group_id = g.id) = 1
    AND (SELECT p.consumed_at IS NULL FROM public.stay_cancel_previews p
         WHERE p.id = (SELECT (m.v->'previews'->0->>'previewId')::uuid FROM t4490j_money m WHERE m.k = 'offer_preview'))
  FROM public.stay_reservation_groups g JOIN t4490j_vb vb ON vb.id = g.id),
  'J-17a with the venue-offer preview in hand, every Stays cancel, preview and decline path is refused: booking still confirmed, no refund, no message, preview unspent');
-- Reverse: the venue-offer path refuses a Stays booking and a Stays preview.
INSERT INTO public.stay_cancel_previews (
  id, group_id, actor_user_id, actor_type, selected_line_ids, group_version, amount_minor,
  allocation_snapshot, preview_hash, expires_at
) VALUES (
  '44909000-0000-4000-f000-000000000001', '44909000-0000-4000-d000-000000000001',
  '44909000-0000-4000-8000-000000000001', 'staff', ARRAY['44909000-0000-4000-d000-0000000000ff']::uuid[], 1, 0,
  '[]'::jsonb, repeat('a', 64), now() + interval '10 minutes'
);
SELECT public.t4490j_as('44909000-0000-4000-8000-000000000001');
SELECT public.t4490j_expect($q$SELECT public.issue_4490_cancel_preview('44909000-0000-4000-d000-000000000001')$q$,
  'P0002', 'offer_booking_not_found', 'J-17b the venue-offer cancel preview refuses a Stays booking');
SELECT public.t4490j_expect(format($q$SELECT public.issue_4490_cancel(ARRAY[%L]::uuid[], %L, 'j17-offer-on-stays', 'tester probe')$q$,
  '44909000-0000-4000-f000-000000000001',
  encode(sha256(convert_to(repeat('a', 64), 'UTF8')), 'hex')),
  '22023', 'offer_cancel_preview_invalid', 'J-17c the venue-offer cancel refuses a Stays preview');
SELECT public.t4490j_reset();
SELECT public.t4490j_ok(
  (SELECT consumed_at IS NULL FROM public.stay_cancel_previews WHERE id = '44909000-0000-4000-f000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.stay_refunds WHERE group_id = '44909000-0000-4000-d000-000000000001'),
  'J-17d the refused Stays preview is unspent and no refund exists');

-- The venue-offer cancel still works end to end on the Stay and refunds the
-- whole payment (the owner cancels at the operator rate).
SELECT public.t4490j_as('44909000-0000-4000-8000-000000000001');
DO $j17e$
DECLARE
  v_group uuid := (SELECT id FROM t4490j_vb);
  v_pv jsonb := (SELECT v FROM t4490j_money WHERE k = 'offer_preview');
  v_ids uuid[];
  v_c jsonb;
BEGIN
  SELECT array_agg((x #>> '{}')::uuid) INTO v_ids FROM jsonb_array_elements(v_pv->'previewIds') x;
  v_c := public.issue_4490_cancel(v_ids, v_pv->>'previewHash', 'j17-offer-cancel', 'Venue closed for a private event');
  INSERT INTO t4490j_money VALUES ('offer_cancel', v_c);
END
$j17e$;
SELECT public.t4490j_reset();
SELECT public.t4490j_ok((
  SELECT c.v->>'state' = 'cancelled'
    AND (c.v->>'refundMinor')::bigint = vb.paid_minor
    AND (SELECT g.state FROM public.stay_reservation_groups g WHERE g.id = vb.id) = 'cancelled'
    AND (SELECT sum(r.amount_minor) FROM public.stay_refunds r WHERE r.group_id = vb.id) = vb.paid_minor
    AND (SELECT count(*) FROM public.stay_refunds r WHERE r.group_id = vb.id) = 1
    AND (SELECT count(*) FROM public.stay_refunds r WHERE r.group_id = vb.id
         AND r.idempotency_key = 'offer-refund:j17-offer-cancel:1') = 1
  FROM t4490j_money c CROSS JOIN t4490j_vb vb WHERE c.k = 'offer_cancel'),
  'J-17e the venue-offer cancel on the Stay cancels and refunds the whole payment through its own path');

ROLLBACK;
