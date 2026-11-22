-- #3281 S2 + S6: add-ons on every public reader; free add-ons on an RSVP and at the door.
-- MINGLA-INVARIANT: I-ADDON-READERS-ADDITIVE | issue #3281 | Trip, experience and RSVP readers add add-ons only as an extras key on a ticket that has one on sale (RSVP: a last rsvpAddOns key while rsvp_enabled is on); a payload with none is returned byte for byte.
-- MINGLA-INVARIANT: I-ADDON-NO-IMAGE-TRANSFORM | issue #3281 | Public add-on items carry stored photo object paths only, never an image transformation URL.
-- MINGLA-INVARIANT: I-ADDON-RSVP-FREE-ONLY-SWITCHED | issue #3281 | issue_3281_submit_rsvp_with_add_ons returns the unchanged #4541 RSVP when no add-on is asked for, refuses any add-on while rsvp_enabled is off or for a paid add-on, and otherwise stores free add-ons that share the add-on's one stock, undoing the RSVP on any refusal.
--
-- T-READ-SAME     no add-on: trip, experience and RSVP payloads equal the attach input text.
-- T-READ-TRIP     a package with an add-on gains a last `extras` key; the other package is untouched.
-- T-READ-EXP      experience options and the single ticket gain `extras`.
-- T-READ-MANY     an add-on linked to two tickets appears under both with one id and one remaining.
-- T-READ-ITEM     items carry showOnPublicPage (hidden ones too), photoPath, photoThumbPath, no /render/image.
-- T-READ-EVENT    the event reader's items gain the three keys.
-- T-READ-RSVP     rsvpAddOns appears last only while rsvp_enabled is on.
-- T-RSVP-NONE     no add-ons: the wrapper result is the inner RSVP result with no rsvpAddOns key.
-- T-RSVP-OFF      switch off: refused, nothing written.
-- T-RSVP-FREE     switch on: free add-on stored, counted by issue_3281_add_on_taken, shown in remaining.
-- T-RSVP-REFUSE   paid, unlinked, above max per guest, sold out, not going: refused and the RSVP undone.
-- T-RSVP-RERSVP   a re-RSVP replaces the guest's picks.
-- T-DOOR          the door line lists the RSVP's add-ons; a denied RSVP has none and frees the stock.
-- T-GRANTS        anon and authenticated execute none of the new functions and read no new table.
--
-- FAILS-ON-REVERT: drop the RSVP branch of issue_3281_add_on_taken (T-RSVP-FREE),
-- drop the switch check in the wrapper (T-RSVP-OFF), or attach add-ons to
-- every trip tier (T-READ-TRIP) -> red.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3281 S2/S6 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END;
$fn$;

BEGIN;

DO $test$
DECLARE
  v_owner uuid := '32815000-0000-4000-8300-000000000001';
  v_brand uuid := '32815000-0000-4000-8300-000000000002';
  v_trip uuid := '32815000-0000-4000-8300-000000000003';
  v_exp uuid := '32815000-0000-4000-8300-000000000004';
  v_rsvp uuid := '32815000-0000-4000-8300-000000000005';
  v_event uuid := '32815000-0000-4000-8300-000000000006';
  v_pkg_a uuid := '32815000-0000-4000-8300-000000000011';
  v_pkg_b uuid := '32815000-0000-4000-8300-000000000012';
  v_opt uuid := '32815000-0000-4000-8300-000000000013';
  v_ticket uuid := '32815000-0000-4000-8300-000000000014';
  v_g1 uuid := '32815000-0000-4000-8300-000000000021';
  v_g2 uuid := '32815000-0000-4000-8300-000000000022';
  v_g3 uuid := '32815000-0000-4000-8300-000000000023';
  v_transfer uuid; v_exp_addon uuid; v_snack uuid; v_drink uuid; v_paid uuid; v_tee uuid;
  v_before_trip text; v_before_exp text; v_before_rsvp text;
  v_payload json; v_tier json; v_result jsonb; v_error text; v_rsvp_id uuid;
  v_keys text[]; v_count integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 's6-owner@example.test'), (v_g1, 's6-g1@example.test'),
    (v_g2, 's6-g2@example.test'), (v_g3, 's6-g3@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 's6-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider,
    payment_country, pricing_region, pricing_currency)
  VALUES (v_brand, v_owner, 'S6 brand', 's6-brand', 'USD', 'stripe', 'US', 'US', 'USD');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, published_at, rsvp_allow_plus_ones, rsvp_plus_ones_max)
  VALUES
    (v_trip, v_brand, v_owner, 'S6 trip', 's6-trip', 'trip', 'scheduled', 'public', 'UTC', 'USD', now(), false, 0),
    (v_exp, v_brand, v_owner, 'S6 experience', 's6-exp', 'experience', 'scheduled', 'public', 'UTC', 'USD', now(), false, 0),
    (v_rsvp, v_brand, v_owner, 'S6 rsvp', 's6-rsvp', 'rsvp', 'scheduled', 'public', 'UTC', 'USD', now(), true, 3),
    (v_event, v_brand, v_owner, 'S6 event', 's6-event', 'event', 'scheduled', 'public', 'UTC', 'USD', now(), false, 0);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_trip, now() + interval '20 days', now() + interval '23 days', 'UTC', true),
    (v_exp, now() + interval '5 days', now() + interval '5 days 2 hours', 'UTC', true),
    (v_rsvp, now() + interval '6 days', now() + interval '6 days 3 hours', 'UTC', true),
    (v_event, now() + interval '7 days', now() + interval '7 days 3 hours', 'UTC', true);
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total,
    is_unlimited, min_purchase_qty, max_purchase_qty, available_online, available_in_person)
  VALUES
    (v_pkg_a, v_trip, 'Shared room', 250000, 'USD', false, 8, false, 1, 4, true, false),
    (v_pkg_b, v_trip, 'Own room', 320000, 'USD', false, 4, false, 1, 2, true, false),
    (v_opt, v_exp, 'Standard', 4000, 'USD', false, 20, false, 1, 6, true, false),
    (v_ticket, v_event, 'General', 2000, 'USD', false, 100, false, 1, 10, true, false);
  INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name)
  VALUES (v_trip, v_pkg_a, 'Shared room'), (v_trip, v_pkg_b, 'Own room');

  -- ---- T-READ-SAME: nothing on sale -> the attach step changes nothing. ----
  v_before_trip := public.pg_public_trip_by_slug('s6-brand', 's6-trip')::text;
  v_before_exp := public.pg_public_experience_by_slug('s6-brand', 's6-exp')::text;
  v_before_rsvp := public.pg_public_rsvp_by_slug('s6-brand', 's6-rsvp')::text;
  PERFORM pg_temp.ok(v_before_trip IS NOT NULL AND v_before_trip NOT LIKE '%"extras"%'
    AND public.issue_3281_attach_offering_add_ons(v_before_trip::json, 'tiers', 'ticketTypeId', NULL)::text = v_before_trip,
    'T-READ-SAME trip payload unchanged without add-ons');
  PERFORM pg_temp.ok(v_before_exp IS NOT NULL AND v_before_exp NOT LIKE '%"extras"%'
    AND public.issue_3281_attach_offering_add_ons(v_before_exp::json, 'options', 'ticketTypeId', 'ticket')::text = v_before_exp,
    'T-READ-SAME experience payload unchanged without add-ons');
  PERFORM pg_temp.ok(v_before_rsvp IS NOT NULL AND v_before_rsvp NOT LIKE '%rsvpAddOns%'
    AND public.issue_3281_attach_rsvp_add_ons(v_before_rsvp::json)::text = v_before_rsvp,
    'T-READ-SAME RSVP payload unchanged without add-ons');

  -- ---- Add-ons (a ticket's own add-on gets its link from the S1 bridge). ----
  INSERT INTO public.ticket_add_ons(event_id, ticket_type_id, name, description, price_cents,
    quantity_total, is_unlimited, max_per_ticket, sort_order, photo_path, photo_thumb_path,
    show_on_public_page)
  VALUES (v_trip, v_pkg_a, 'Airport transfer', NULL, 4500, 6, false, 1, 0,
    'add-ons/' || v_trip || '/32815000-0000-4000-8300-0000000000a1.jpg',
    'add-ons/' || v_trip || '/32815000-0000-4000-8300-0000000000a1_thumb.jpg', true)
  RETURNING id INTO v_transfer;

  v_payload := public.pg_public_trip_by_slug('s6-brand', 's6-trip');
  SELECT t INTO v_tier FROM json_array_elements(v_payload->'tiers') t WHERE t->>'ticketTypeId' = v_pkg_a::text;
  SELECT array_agg(k) INTO v_keys FROM json_object_keys(v_tier) k;
  PERFORM pg_temp.ok(json_array_length(v_tier->'extras') = 1
    AND v_tier->'extras'->0->>'id' = v_transfer::text
    AND (v_tier->'extras'->0->>'priceCents')::integer = 4500
    AND (v_tier->'extras'->0->>'remaining')::integer = 6
    AND v_keys[array_length(v_keys, 1)] = 'extras'
    AND NOT EXISTS (SELECT 1 FROM json_array_elements(v_payload->'tiers') t
                     WHERE t->>'ticketTypeId' = v_pkg_b::text AND (t::jsonb ? 'extras')),
    'T-READ-TRIP the package with an add-on carries it last; the other has none');
  PERFORM pg_temp.ok(
    (SELECT jsonb_agg(t->>'ticketTypeId' ORDER BY o) FROM json_array_elements(v_before_trip::json->'tiers') WITH ORDINALITY x(t, o))
    = (SELECT jsonb_agg(t->>'ticketTypeId' ORDER BY o) FROM json_array_elements(v_payload->'tiers') WITH ORDINALITY x(t, o)),
    'T-READ-TRIP package order unchanged');

  -- ---- T-READ-ITEM ----
  PERFORM pg_temp.ok(v_tier->'extras'->0->>'showOnPublicPage' = 'true'
    AND v_tier->'extras'->0->>'photoPath' LIKE 'add-ons/%.jpg'
    AND v_tier->'extras'->0->>'photoThumbPath' LIKE 'add-ons/%_thumb.jpg'
    AND v_payload::text NOT LIKE '%render/image%',
    'T-READ-ITEM item carries the switch and stored photo paths, no transformation URL');
  UPDATE public.ticket_add_ons SET show_on_public_page = false WHERE id = v_transfer;
  v_payload := public.pg_public_trip_by_slug('s6-brand', 's6-trip');
  SELECT t INTO v_tier FROM json_array_elements(v_payload->'tiers') t WHERE t->>'ticketTypeId' = v_pkg_a::text;
  PERFORM pg_temp.ok(v_tier->'extras'->0->>'showOnPublicPage' = 'false',
    'T-READ-ITEM a hidden add-on is still returned for checkout');
  UPDATE public.ticket_add_ons SET show_on_public_page = true WHERE id = v_transfer;

  -- ---- T-READ-MANY: one add-on, two packages. ----
  INSERT INTO public.ticket_add_on_links(add_on_id, event_id, target_kind, ticket_type_id)
  VALUES (v_transfer, v_trip, 'ticket_type', v_pkg_b);
  v_payload := public.pg_public_trip_by_slug('s6-brand', 's6-trip');
  PERFORM pg_temp.ok((SELECT count(DISTINCT (t->'extras'->0->>'id') || ':' || (t->'extras'->0->>'remaining'))
                        FROM json_array_elements(v_payload->'tiers') t WHERE (t::jsonb ? 'extras')) = 1
    AND (SELECT count(*) FROM json_array_elements(v_payload->'tiers') t WHERE (t::jsonb ? 'extras')) = 2,
    'T-READ-MANY a shared add-on appears under both packages with one id and one remaining');

  -- ---- T-READ-EXP ----
  INSERT INTO public.ticket_add_ons(event_id, ticket_type_id, name, price_cents, quantity_total,
    is_unlimited, max_per_ticket, sort_order)
  VALUES (v_exp, v_opt, 'Photo print', 1500, NULL, true, 2, 0) RETURNING id INTO v_exp_addon;
  v_payload := public.pg_public_experience_by_slug('s6-brand', 's6-exp');
  PERFORM pg_temp.ok(
    EXISTS (SELECT 1 FROM json_array_elements(v_payload->'options') o
             WHERE o->>'ticketTypeId' = v_opt::text AND o->'extras'->0->>'id' = v_exp_addon::text
               AND json_typeof(o->'extras'->0->'remaining') = 'null')
    AND (json_typeof(v_payload->'ticket') IS DISTINCT FROM 'object'
         OR v_payload->'ticket'->>'ticketTypeId' IS DISTINCT FROM v_opt::text
         OR v_payload->'ticket'->'extras'->0->>'id' = v_exp_addon::text),
    'T-READ-EXP options (and the single ticket) carry their add-ons');

  -- ---- T-READ-EVENT ----
  INSERT INTO public.ticket_add_ons(event_id, ticket_type_id, name, price_cents, quantity_total,
    is_unlimited, max_per_ticket, sort_order)
  VALUES (v_event, v_ticket, 'Drink token', 500, 50, false, 3, 0) RETURNING id INTO v_drink;
  v_payload := public.pg_public_event_by_slug('s6-brand', 's6-event');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM json_array_elements(v_payload->'tickets') t
      WHERE t->'extras'->0->>'id' = v_drink::text
        AND (t->'extras'->0)::jsonb ?& ARRAY['showOnPublicPage', 'photoPath', 'photoThumbPath', 'priceAllInCents']),
    'T-READ-EVENT event reader items gain the switch and photo keys');

  -- ---- RSVP add-ons ----
  INSERT INTO public.ticket_add_ons(event_id, ticket_type_id, name, price_cents, quantity_total,
    is_unlimited, max_per_ticket, sort_order)
  VALUES (v_rsvp, NULL, 'Snack box', 0, 3, false, 1, 0) RETURNING id INTO v_snack;
  INSERT INTO public.ticket_add_ons(event_id, ticket_type_id, name, price_cents, quantity_total,
    is_unlimited, max_per_ticket, sort_order)
  VALUES (v_rsvp, NULL, 'Dinner seat', 3000, 10, false, 1, 1) RETURNING id INTO v_paid;
  INSERT INTO public.ticket_add_ons(event_id, ticket_type_id, name, price_cents, quantity_total,
    is_unlimited, max_per_ticket, sort_order)
  VALUES (v_rsvp, NULL, 'Tee', 0, NULL, true, 1, 2) RETURNING id INTO v_tee;
  INSERT INTO public.ticket_add_on_links(add_on_id, event_id, target_kind, ticket_type_id) VALUES
    (v_snack, v_rsvp, 'rsvp', NULL), (v_paid, v_rsvp, 'rsvp', NULL), (v_tee, v_rsvp, 'rsvp', NULL);

  -- T-READ-RSVP: switch off -> byte for byte.
  PERFORM pg_temp.ok(public.pg_public_rsvp_by_slug('s6-brand', 's6-rsvp')::text = v_before_rsvp,
    'T-READ-RSVP switch off: the RSVP payload does not grow');

  -- T-RSVP-NONE (switch off, no add-ons): the inner RSVP, nothing added.
  v_result := public.issue_3281_submit_rsvp_with_add_ons(v_rsvp, v_g1, 'Guest One',
    's6-g1@example.test', '+15553281021', 'going', 0, '[]', NULL, 'US', false, NULL, '[]');
  v_rsvp_id := (v_result->>'rsvpId')::uuid;
  PERFORM pg_temp.ok(v_rsvp_id IS NOT NULL AND NOT (v_result ? 'rsvpAddOns')
    AND v_result->>'status' = 'going',
    'T-RSVP-NONE no add-ons: the #4541 result untouched');

  -- T-RSVP-OFF
  v_error := pg_temp.err(format($sql$SELECT public.issue_3281_submit_rsvp_with_add_ons(%L,%L,'Guest Two',
    's6-g2@example.test','+15553281022','going',0,'[]',NULL,'US',false,NULL,%L::jsonb)$sql$,
    v_rsvp, v_g2, jsonb_build_array(jsonb_build_object('addOnId', v_snack, 'quantity', 1))::text));
  PERFORM pg_temp.ok(v_error LIKE 'P0001:rsvp_add_ons_unavailable%'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = v_rsvp AND user_id = v_g2),
    'T-RSVP-OFF switch off: refused and no RSVP written: ' || v_error);

  UPDATE public.add_on_rollout SET rsvp_enabled = true WHERE id;

  v_payload := public.pg_public_rsvp_by_slug('s6-brand', 's6-rsvp');
  SELECT array_agg(k) INTO v_keys FROM json_object_keys(v_payload) k;
  PERFORM pg_temp.ok(v_keys[array_length(v_keys, 1)] = 'rsvpAddOns'
    AND json_array_length(v_payload->'rsvpAddOns') = 3
    AND v_payload->'rsvpAddOns'->0->>'id' = v_snack::text
    AND (v_payload->'rsvpAddOns'->0->>'remaining')::integer = 3,
    'T-READ-RSVP switch on: rsvpAddOns is the last key');

  -- T-RSVP-FREE: guest two (plus 1) takes 2 snack boxes and a tee.
  v_result := public.issue_3281_submit_rsvp_with_add_ons(v_rsvp, v_g2, 'Guest Two',
    's6-g2@example.test', '+15553281022', 'going', 1,
    '[{"phone":"+15553281099","phoneCountryIso":"US"}]', NULL, 'US', false, NULL,
    jsonb_build_array(jsonb_build_object('addOnId', v_snack, 'quantity', 2),
                      jsonb_build_object('addOnId', v_tee, 'quantity', 1)));
  v_rsvp_id := (v_result->>'rsvpId')::uuid;
  PERFORM pg_temp.ok(jsonb_array_length(v_result->'rsvpAddOns') = 2
    AND (SELECT sum(quantity) FROM public.event_rsvp_add_ons WHERE rsvp_id = v_rsvp_id) = 3
    AND public.issue_3281_add_on_taken(v_snack, NULL, NULL) = 2
    AND (public.pg_public_rsvp_by_slug('s6-brand', 's6-rsvp')->'rsvpAddOns'->0->>'remaining')::integer = 1,
    'T-RSVP-FREE free add-ons stored, counted in the shared stock and in remaining');

  -- T-DOOR
  v_result := public.issue_3281_rsvp_door_add_ons(v_rsvp_id);
  PERFORM pg_temp.ok(jsonb_array_length(v_result) = 2 AND v_result->0->>'name' = 'Snack box'
    AND (v_result->0->>'quantity')::integer = 2,
    'T-DOOR the door line lists the RSVP add-ons');

  -- T-DOOR-SCAN (#3281 rework): the admission reply itself carries the door
  -- line, so scan-rsvp makes no second read; an RSVP with no picks gets no key.
  UPDATE public.event_dates SET start_at = now() - interval '1 hour', end_at = now() + interval '2 hours'
   WHERE event_id = v_rsvp;
  -- Door QR payloads in the scanner's signed shape.
  UPDATE public.event_rsvps SET qr_code = 'mingla:v1:rsvp:' || id || ':sig:' || md5(id::text) || md5(id::text)
   WHERE event_id = v_rsvp;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.biz_rsvp_scan(v_rsvp, (SELECT qr_code FROM public.event_rsvps WHERE id = v_rsvp_id));
  PERFORM pg_temp.ok(v_result->>'result' = 'success' AND jsonb_array_length(v_result->'addOns') = 2
    AND v_result->'addOns'->0->>'name' = 'Snack box' AND (v_result->'addOns'->0->>'quantity')::integer = 2,
    'T-DOOR-SCAN the admission reply carries the door line: ' || v_result::text);
  v_result := public.biz_rsvp_scan(v_rsvp, (SELECT qr_code FROM public.event_rsvps WHERE event_id = v_rsvp AND user_id = v_g1));
  PERFORM pg_temp.ok(v_result->>'result' = 'success' AND NOT (v_result ? 'addOns'),
    'T-DOOR-SCAN no picks: no addOns key: ' || v_result::text);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE public.event_dates SET start_at = now() + interval '6 days', end_at = now() + interval '6 days 3 hours'
   WHERE event_id = v_rsvp;

  -- T-RSVP-REFUSE: each refusal undoes the whole RSVP of guest three.
  v_error := pg_temp.err(format($sql$SELECT public.issue_3281_submit_rsvp_with_add_ons(%L,%L,'Guest Three',
    's6-g3@example.test','+15553281023','going',0,'[]',NULL,'US',false,NULL,%L::jsonb)$sql$,
    v_rsvp, v_g3, jsonb_build_array(jsonb_build_object('addOnId', v_paid, 'quantity', 1))::text));
  PERFORM pg_temp.ok(v_error LIKE 'P0001:rsvp_add_on_needs_payment%'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = v_rsvp AND user_id = v_g3),
    'T-RSVP-REFUSE a paid add-on is not taken on this path: ' || v_error);
  v_error := pg_temp.err(format($sql$SELECT public.issue_3281_submit_rsvp_with_add_ons(%L,%L,'Guest Three',
    's6-g3@example.test','+15553281023','going',0,'[]',NULL,'US',false,NULL,%L::jsonb)$sql$,
    v_rsvp, v_g3, jsonb_build_array(jsonb_build_object('addOnId', v_drink, 'quantity', 1))::text));
  PERFORM pg_temp.ok(v_error LIKE 'P0001:extra_not_available%'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = v_rsvp AND user_id = v_g3),
    'T-RSVP-REFUSE an add-on not linked to this RSVP: ' || v_error);
  v_error := pg_temp.err(format($sql$SELECT public.issue_3281_submit_rsvp_with_add_ons(%L,%L,'Guest Three',
    's6-g3@example.test','+15553281023','going',0,'[]',NULL,'US',false,NULL,%L::jsonb)$sql$,
    v_rsvp, v_g3, jsonb_build_array(jsonb_build_object('addOnId', v_tee, 'quantity', 2))::text));
  PERFORM pg_temp.ok(v_error LIKE 'P0001:extra_quantity_above_max%',
    'T-RSVP-REFUSE more than one per guest: ' || v_error);
  v_error := pg_temp.err(format($sql$SELECT public.issue_3281_submit_rsvp_with_add_ons(%L,%L,'Guest Three',
    's6-g3@example.test','+15553281023','going',1,'[{"phone":"+15553281098","phoneCountryIso":"US"}]',
    NULL,'US',false,NULL,%L::jsonb)$sql$,
    v_rsvp, v_g3, jsonb_build_array(jsonb_build_object('addOnId', v_snack, 'quantity', 2))::text));
  PERFORM pg_temp.ok(v_error LIKE 'P0001:extra_capacity_exceeded%'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = v_rsvp AND user_id = v_g3),
    'T-RSVP-REFUSE sold out (2 of 3 taken): ' || v_error);
  v_error := pg_temp.err(format($sql$SELECT public.issue_3281_submit_rsvp_with_add_ons(%L,%L,'Guest Three',
    's6-g3@example.test','+15553281023','not_going',0,'[]',NULL,'US',false,NULL,%L::jsonb)$sql$,
    v_rsvp, v_g3, jsonb_build_array(jsonb_build_object('addOnId', v_tee, 'quantity', 1))::text));
  PERFORM pg_temp.ok(v_error LIKE 'P0001:rsvp_add_ons_unavailable%',
    'T-RSVP-REFUSE add-ons need a going RSVP: ' || v_error);
  v_error := pg_temp.err(format($sql$SELECT public.issue_3281_submit_rsvp_with_add_ons(%L,%L,'Guest Three',
    's6-g3@example.test','+15553281023','going',0,'[]',NULL,'US',false,NULL,%L::jsonb)$sql$,
    v_rsvp, v_g3, '[{"addOnId":"nope","quantity":1}]'));
  PERFORM pg_temp.ok(v_error LIKE '22023:extras_invalid%',
    'T-RSVP-REFUSE malformed list: ' || v_error);

  -- T-RSVP-RERSVP: guest two now wants one snack box only.
  v_result := public.issue_3281_submit_rsvp_with_add_ons(v_rsvp, v_g2, 'Guest Two',
    's6-g2@example.test', '+15553281022', 'going', 1,
    '[{"phone":"+15553281099","phoneCountryIso":"US"}]', NULL, 'US', false, NULL,
    jsonb_build_array(jsonb_build_object('addOnId', v_snack, 'quantity', 1)));
  PERFORM pg_temp.ok((v_result->>'rsvpId')::uuid = v_rsvp_id
    AND (SELECT count(*) FROM public.event_rsvp_add_ons WHERE rsvp_id = v_rsvp_id) = 1
    AND public.issue_3281_add_on_taken(v_snack, NULL, NULL) = 1,
    'T-RSVP-RERSVP a re-RSVP replaces the picks');

  -- T-DOOR: a denied RSVP owes nothing and frees its stock.
  UPDATE public.event_rsvps SET approval_status = 'denied' WHERE id = v_rsvp_id;
  PERFORM pg_temp.ok(public.issue_3281_rsvp_door_add_ons(v_rsvp_id) = '[]'::jsonb
    AND public.issue_3281_add_on_taken(v_snack, NULL, NULL) = 0,
    'T-DOOR denied RSVP: no door line, stock released');

  -- ---- T-GRANTS ----
  PERFORM pg_temp.ok(
    NOT has_function_privilege('anon', 'public.issue_3281_submit_rsvp_with_add_ons(uuid,uuid,text,text,text,text,integer,jsonb,text,text,boolean,jsonb,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_3281_submit_rsvp_with_add_ons(uuid,uuid,text,text,text,text,integer,jsonb,text,text,boolean,jsonb,jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.issue_3281_submit_rsvp_with_add_ons(uuid,uuid,text,text,text,text,integer,jsonb,text,text,boolean,jsonb,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_3281_rsvp_door_add_ons(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_3281_rsvp_door_add_ons(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_3281_attach_offering_add_ons(json,text,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_3281_attach_rsvp_add_ons(json)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_3281_public_add_on_items(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_3281_with_ticket_add_ons(json,text)', 'EXECUTE')
    AND NOT has_table_privilege('anon', 'public.event_rsvp_add_ons', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.event_rsvp_add_ons', 'SELECT')
    AND has_function_privilege('anon', 'public.pg_public_trip_by_slug(text,text)', 'EXECUTE')
    AND has_function_privilege('anon', 'public.pg_public_experience_by_slug(text,text)', 'EXECUTE')
    AND has_function_privilege('anon', 'public.pg_public_rsvp_by_slug(text,text)', 'EXECUTE')
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_rsvp_add_ons'::regclass),
    'T-GRANTS new functions and table are closed; readers stay public');
END;
$test$;

ROLLBACK;
