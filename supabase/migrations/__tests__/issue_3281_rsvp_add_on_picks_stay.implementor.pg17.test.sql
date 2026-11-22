-- #3281 S6 gap E: a guest's free RSVP add-on picks outlive their add-on.
-- MINGLA-INVARIANT: I-ADDON-RSVP-PICKS-STAY | issue #3281 | An add-on a guest picked with their RSVP cannot be deleted out from under the pick; it stops selling (is_active false) and the pick and its door line stay, while deleting the RSVP itself still removes its picks.
--
-- T-KEY        the key is NO ACTION (not CASCADE) and still points at ticket_add_ons.
-- T-DELETE     deleting a picked add-on is refused (23503) and the pick stays.
-- T-STOP       the add-on stops selling instead: the pick and the door line stay.
-- T-UNPICKED   an add-on nobody picked still deletes.
-- T-RSVP-GONE  deleting the RSVP still removes its picks (rsvp_id cascade), and the add-on then deletes.
--
-- FAILS-ON-REVERT: put ON DELETE CASCADE back on event_rsvp_add_ons_add_on_id_fkey
-- (or drop the 20281125133281 migration) -> T-KEY and T-DELETE red.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3281 gap E FAIL: %', p_label;
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
  v_owner uuid := '32815e00-0000-4000-8300-000000000001';
  v_brand uuid := '32815e00-0000-4000-8300-000000000002';
  v_rsvp uuid := '32815e00-0000-4000-8300-000000000005';
  v_g1 uuid := '32815e00-0000-4000-8300-000000000021';
  v_snack uuid; v_tee uuid; v_spare uuid;
  v_result jsonb; v_rsvp_id uuid; v_error text;
BEGIN
  -- ---- T-KEY ----
  PERFORM pg_temp.ok(EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = 'public.event_rsvp_add_ons'::regclass
         AND c.conname = 'event_rsvp_add_ons_add_on_id_fkey'
         AND c.contype = 'f'
         AND c.confrelid = 'public.ticket_add_ons'::regclass
         AND c.confdeltype = 'a'),
    'T-KEY add_on_id is ON DELETE NO ACTION to ticket_add_ons');

  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'gape-owner@example.test'), (v_g1, 'gape-g1@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'gape-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider,
    payment_country, pricing_region, pricing_currency)
  VALUES (v_brand, v_owner, 'Gap E brand', 'gape-brand', 'USD', 'stripe', 'US', 'US', 'USD');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, published_at, rsvp_allow_plus_ones, rsvp_plus_ones_max)
  VALUES (v_rsvp, v_brand, v_owner, 'Gap E rsvp', 'gape-rsvp', 'rsvp', 'scheduled', 'public',
    'UTC', 'USD', now(), true, 3);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_rsvp, now() + interval '6 days', now() + interval '6 days 3 hours', 'UTC', true);
  INSERT INTO public.ticket_add_ons(event_id, ticket_type_id, name, price_cents, quantity_total,
    is_unlimited, max_per_ticket, sort_order)
  VALUES (v_rsvp, NULL, 'Snack box', 0, 3, false, 1, 0) RETURNING id INTO v_snack;
  INSERT INTO public.ticket_add_ons(event_id, ticket_type_id, name, price_cents, quantity_total,
    is_unlimited, max_per_ticket, sort_order)
  VALUES (v_rsvp, NULL, 'Tee', 0, NULL, true, 1, 1) RETURNING id INTO v_tee;
  INSERT INTO public.ticket_add_ons(event_id, ticket_type_id, name, price_cents, quantity_total,
    is_unlimited, max_per_ticket, sort_order)
  VALUES (v_rsvp, NULL, 'Spare', 0, NULL, true, 1, 2) RETURNING id INTO v_spare;
  INSERT INTO public.ticket_add_on_links(add_on_id, event_id, target_kind, ticket_type_id) VALUES
    (v_snack, v_rsvp, 'rsvp', NULL), (v_tee, v_rsvp, 'rsvp', NULL), (v_spare, v_rsvp, 'rsvp', NULL);
  UPDATE public.add_on_rollout SET rsvp_enabled = true WHERE id;

  v_result := public.issue_3281_submit_rsvp_with_add_ons(v_rsvp, v_g1, 'Guest One',
    'gape-g1@example.test', '+15553281121', 'going', 0, '[]', NULL, 'US', false, NULL,
    jsonb_build_array(jsonb_build_object('addOnId', v_snack, 'quantity', 1),
                      jsonb_build_object('addOnId', v_tee, 'quantity', 1)));
  v_rsvp_id := (v_result->>'rsvpId')::uuid;
  PERFORM pg_temp.ok(v_rsvp_id IS NOT NULL
    AND (SELECT count(*) FROM public.event_rsvp_add_ons WHERE rsvp_id = v_rsvp_id) = 2,
    'setup: the guest picked two free add-ons');

  -- ---- T-DELETE ----
  v_error := pg_temp.err(format('DELETE FROM public.ticket_add_ons WHERE id = %L', v_snack));
  PERFORM pg_temp.ok(v_error LIKE '23503:%'
    AND EXISTS (SELECT 1 FROM public.ticket_add_ons WHERE id = v_snack)
    AND EXISTS (SELECT 1 FROM public.event_rsvp_add_ons WHERE rsvp_id = v_rsvp_id AND add_on_id = v_snack),
    'T-DELETE a picked add-on is not deleted and the pick stays: ' || v_error);

  -- ---- T-STOP ----
  UPDATE public.ticket_add_ons SET is_active = false, updated_at = now() WHERE id = v_snack;
  PERFORM pg_temp.ok(
    (SELECT count(*) FROM public.event_rsvp_add_ons WHERE rsvp_id = v_rsvp_id) = 2
    AND public.issue_3281_rsvp_door_add_ons(v_rsvp_id) @> jsonb_build_array(
          jsonb_build_object('id', v_snack, 'name', 'Snack box', 'quantity', 1)),
    'T-STOP stopping sales keeps the pick and its door line');

  -- ---- T-UNPICKED ----
  DELETE FROM public.ticket_add_ons WHERE id = v_spare;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.ticket_add_ons WHERE id = v_spare),
    'T-UNPICKED an add-on nobody picked still deletes');

  -- ---- T-RSVP-GONE ----
  DELETE FROM public.event_rsvps WHERE id = v_rsvp_id;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.event_rsvp_add_ons WHERE rsvp_id = v_rsvp_id),
    'T-RSVP-GONE deleting the RSVP removes its picks');
  DELETE FROM public.ticket_add_ons WHERE id = v_snack;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.ticket_add_ons WHERE id = v_snack),
    'T-RSVP-GONE with no pick left the add-on deletes');
END;
$test$;

ROLLBACK;
