\set ON_ERROR_STOP on

-- Issue #3645 — adversarial proof for 20270823003645. The migration removed
-- one refusal from the trip DRAFT save. This suite attacks everything that
-- removal must NOT have loosened:
--
--   R1  the paid-publish refusal still fires, for a price that arrived by
--       package INSERT and for one that arrived by package UPDATE, and leaves
--       the draft a draft;
--   R2  someone who is not on the brand still cannot save a price (or anything);
--   R3  a signed-out caller still cannot;
--   R4  the draft owner still cannot write a PUBLISHED trip's packages, so the
--       removed check could never have been guarding a live trip;
--   R5  the other package rules still hold (negative price, zero capacity,
--       stale revision), so "saves with a price" did not become "saves anything";
--   R6  a FREE trip on the same no-bank brand still publishes (the removal did
--       not move the refusal onto free trips);
--   R7  the function body no longer asks about payment readiness, while both
--       publish owners still do, and anon cannot execute the draft owner.
--
-- Run after the full migration chain on PostgreSQL 17.

BEGIN;

INSERT INTO auth.users(id) VALUES
  ('36450823-0000-4000-8000-0000000000e1'),
  ('36450823-0000-4000-8000-0000000000e2');
INSERT INTO public.creator_accounts(id) VALUES
  ('36450823-0000-4000-8000-0000000000e1'),
  ('36450823-0000-4000-8000-0000000000e2');

-- Owner e1 has a brand with a currency and no bank. e2 is a stranger with a
-- brand of their own (so "no brand at all" is not what refuses them).
INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('36450823-0000-4000-8000-0000000000f1', '36450823-0000-4000-8000-0000000000e1',
   'Issue 3645 adversarial', 'issue-3645-trips-adv', 'GBP'),
  ('36450823-0000-4000-8000-0000000000f2', '36450823-0000-4000-8000-0000000000e2',
   'Issue 3645 stranger', 'issue-3645-trips-stranger', 'GBP');

CREATE FUNCTION pg_temp.iso(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"')
$$;
CREATE FUNCTION pg_temp.rev(p_event uuid) RETURNS timestamptz
LANGUAGE sql AS $$ SELECT updated_at FROM public.events WHERE id = p_event $$;
CREATE FUNCTION pg_temp.as_user(p uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END $$;

-- A ready-to-publish draft with one package, built by the owner.
CREATE FUNCTION pg_temp.ready_draft(p_brand uuid, p_seed text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE g jsonb; v_event uuid;
BEGIN
  g := public.biz_create_trip_draft(
    p_brand, jsonb_build_object('title', 'Untitled trip'),
    ('36450823-0000-4000-8000-' || p_seed || '00000001')::uuid);
  v_event := (g#>>'{event,id}')::uuid;
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object(
      'event', jsonb_build_object(
        'title', 'Porto in spring',
        'business_trip', jsonb_build_object(
          'startAt', pg_temp.iso(date_trunc('second', now() + interval '40 days')),
          'endAt', pg_temp.iso(date_trunc('second', now() + interval '44 days')),
          'destinationLocationText', 'Porto, Portugal')),
      'days', jsonb_build_array(jsonb_build_object('ordinal', 1, 'title', 'Arrival'))),
    pg_temp.rev(v_event),
    ('36450823-0000-4000-8000-' || p_seed || '00000002')::uuid);
  RETURN v_event;
END $$;

DO $$
DECLARE
  v_owner uuid := '36450823-0000-4000-8000-0000000000e1';
  v_stranger uuid := '36450823-0000-4000-8000-0000000000e2';
  v_brand uuid := '36450823-0000-4000-8000-0000000000f1';
  v_event uuid; v_tier uuid; v_new uuid;
  v_status text; v_price integer; v_count integer;
  v_result jsonb; v_refused boolean; v_src text; v_before timestamptz;
BEGIN
  IF public.pg_brand_can_collect(v_brand) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'R0 fixture brand can already collect';
  END IF;

  ---------------------------------------------------------------- R1 (update)
  PERFORM pg_temp.as_user(v_owner);
  v_event := pg_temp.ready_draft(v_brand, 'a1a1');
  SELECT ticket_type_id INTO v_tier FROM public.trip_pricing_tiers WHERE event_id = v_event LIMIT 1;
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_tier, 'price_cents', 1, 'capacity', 5))),
    pg_temp.rev(v_event), '36450823-0000-4000-8000-a1a100000003');
  SELECT price_cents INTO v_price FROM public.ticket_types WHERE id = v_tier;
  IF v_price IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'R1-01 the smallest price above zero did not save (%)', v_price; END IF;

  v_refused := false;
  BEGIN
    v_result := public.biz_publish_trip_command(
      v_event, pg_temp.rev(v_event), '36450823-0000-4000-8000-a1a100000004');
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'stripe_charges_disabled' THEN
      RAISE EXCEPTION 'R1-02 publish (price by update) refused with %, expected stripe_charges_disabled', SQLERRM;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'R1-03 a 1-minor-unit trip published without a bank: %', v_result; END IF;
  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'R1-04 refused publish left status %', v_status; END IF;

  ---------------------------------------------------------------- R1 (insert)
  v_event := pg_temp.ready_draft(v_brand, 'a2a2');
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
      'tier_name', 'Added later', 'price_cents', 99900, 'capacity', 2, 'display_order', 1))),
    pg_temp.rev(v_event), '36450823-0000-4000-8000-a2a200000003');
  SELECT id INTO v_new FROM public.ticket_types
   WHERE event_id = v_event AND name = 'Added later' AND deleted_at IS NULL;
  IF v_new IS NULL THEN RAISE EXCEPTION 'R1-05 a priced package insert did not save'; END IF;
  v_refused := false;
  BEGIN
    v_result := public.biz_publish_trip_command(
      v_event, pg_temp.rev(v_event), '36450823-0000-4000-8000-a2a200000004');
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'stripe_charges_disabled' THEN
      RAISE EXCEPTION 'R1-06 publish (price by insert) refused with %, expected stripe_charges_disabled', SQLERRM;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'R1-07 a trip with one free and one priced package published without a bank: %', v_result; END IF;
  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'R1-08 refused publish left status %', v_status; END IF;

  ------------------------------------------------------------------------ R2
  SELECT ticket_type_id INTO v_tier FROM public.trip_pricing_tiers
   WHERE event_id = v_event AND ticket_type_id <> v_new LIMIT 1;
  v_before := pg_temp.rev(v_event);
  PERFORM pg_temp.as_user(v_stranger);
  v_refused := false;
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', v_tier, 'price_cents', 5000, 'capacity', 5))),
      v_before, '36450823-0000-4000-8000-a2a200000005');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT IN ('insufficient_event_permission', 'authentication_required', 'trip_not_found') THEN
      RAISE EXCEPTION 'R2-01 a stranger was refused with an unexpected error: % (%)', SQLERRM, SQLSTATE;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'R2-02 someone outside the brand saved a price on its trip'; END IF;
  SELECT price_cents INTO v_price FROM public.ticket_types WHERE id = v_tier;
  IF v_price IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'R2-03 a refused stranger save still changed the price to %', v_price; END IF;
  IF pg_temp.rev(v_event) IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'R2-04 a refused stranger save advanced the revision'; END IF;

  ------------------------------------------------------------------------ R3
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_refused := false;
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', v_tier, 'price_cents', 5000, 'capacity', 5))),
      v_before, '36450823-0000-4000-8000-a2a200000006');
  EXCEPTION WHEN OTHERS THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'R3-01 a signed-out caller saved a price'; END IF;
  SELECT price_cents INTO v_price FROM public.ticket_types WHERE id = v_tier;
  IF v_price IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'R3-02 a refused signed-out save changed the price to %', v_price; END IF;

  ------------------------------------------------------------------------ R5
  PERFORM pg_temp.as_user(v_owner);
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', v_tier, 'price_cents', -1, 'capacity', 5))),
      pg_temp.rev(v_event), '36450823-0000-4000-8000-a2a200000007');
    RAISE EXCEPTION 'R5-01 a negative price was saved';
  EXCEPTION WHEN sqlstate '22023' THEN
    IF SQLERRM <> 'trip_tier_invalid' THEN RAISE EXCEPTION 'R5-02 negative price raised %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'tier_name', 'No seats', 'price_cents', 5000, 'capacity', 0))),
      pg_temp.rev(v_event), '36450823-0000-4000-8000-a2a200000008');
    RAISE EXCEPTION 'R5-03 a priced package with no capacity was saved';
  EXCEPTION WHEN sqlstate '22023' THEN
    IF SQLERRM <> 'trip_tier_invalid' THEN RAISE EXCEPTION 'R5-04 zero capacity raised %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', v_tier, 'price_cents', 7000, 'capacity', 5))),
      pg_temp.rev(v_event) - interval '1 hour', '36450823-0000-4000-8000-a2a200000009');
    RAISE EXCEPTION 'R5-05 a priced save with a stale revision was accepted';
  EXCEPTION WHEN sqlstate '40001' THEN
    IF SQLERRM <> 'trip_revision_conflict' THEN RAISE EXCEPTION 'R5-06 stale revision raised %', SQLERRM; END IF;
  END;
  SELECT price_cents INTO v_price FROM public.ticket_types WHERE id = v_tier;
  IF v_price IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'R5-07 a refused save changed the price to %', v_price; END IF;

  ------------------------------------------------------------------------ R6
  -- A free trip on the same no-bank brand still publishes.
  v_event := pg_temp.ready_draft(v_brand, 'a6a6');
  v_result := public.biz_publish_trip_command(
    v_event, pg_temp.rev(v_event), '36450823-0000-4000-8000-a6a600000003');
  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_status IS NULL OR v_status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'R6-01 a free trip no longer publishes without a bank, status=% result=%', v_status, v_result;
  END IF;

  ------------------------------------------------------------------------ R4
  -- That trip is now published. The draft owner must refuse it outright, so
  -- the removed check could never have protected a live trip's prices.
  SELECT ticket_type_id INTO v_tier FROM public.trip_pricing_tiers WHERE event_id = v_event LIMIT 1;
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', v_tier, 'price_cents', 5000, 'capacity', 5))),
      pg_temp.rev(v_event), '36450823-0000-4000-8000-a6a600000004');
    RAISE EXCEPTION 'R4-01 the draft owner wrote a price onto a PUBLISHED trip';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'trip_not_draft' THEN RAISE EXCEPTION 'R4-02 published trip raised %, expected trip_not_draft', SQLERRM; END IF;
  END;
  SELECT price_cents INTO v_price FROM public.ticket_types WHERE id = v_tier;
  IF v_price IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'R4-03 a published free trip now has price %', v_price; END IF;
  SELECT count(*) INTO v_count FROM public.ticket_types
   WHERE event_id = v_event AND deleted_at IS NULL AND price_cents > 0;
  IF v_count <> 0 THEN RAISE EXCEPTION 'R4-04 a published free trip on a no-bank brand has % priced package(s)', v_count; END IF;

  ------------------------------------------------------------------------ R7
  RESET ROLE;
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE oid = 'public.biz_apply_trip_draft_graph(uuid, jsonb, timestamptz, uuid)'::regprocedure;
  IF position('pg_brand_can_collect' IN v_src) > 0 OR position('stripe_charges_disabled' IN v_src) > 0 THEN
    RAISE EXCEPTION 'R7-01 the trip draft owner still asks about payment readiness';
  END IF;
  IF position('trip_not_draft' IN v_src) = 0 OR position('biz_trip_require_manager' IN v_src) = 0 THEN
    RAISE EXCEPTION 'R7-02 the trip draft owner lost its draft-only or its manager guard';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE oid = 'public.business_publish_trip_draft(uuid, jsonb, integer)'::regprocedure;
  IF position('pg_brand_can_collect' IN v_src) = 0 OR position('stripe_charges_disabled' IN v_src) = 0 THEN
    RAISE EXCEPTION 'R7-03 business_publish_trip_draft no longer refuses a paid publish without collection';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE oid = 'public.business_publish_event_draft(uuid, jsonb, integer)'::regprocedure;
  IF position('pg_brand_can_collect' IN v_src) = 0 OR position('stripe_charges_disabled' IN v_src) = 0 THEN
    RAISE EXCEPTION 'R7-04 business_publish_event_draft no longer refuses a paid publish without collection';
  END IF;
  IF has_function_privilege('anon', 'public.biz_apply_trip_draft_graph(uuid, jsonb, timestamptz, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R7-05 anon can execute the trip draft owner';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.biz_apply_trip_draft_graph(uuid, jsonb, timestamptz, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R7-06 authenticated lost EXECUTE on the trip draft owner';
  END IF;
END $$;

ROLLBACK;
