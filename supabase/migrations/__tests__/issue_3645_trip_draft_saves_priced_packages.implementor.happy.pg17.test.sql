\set ON_ERROR_STOP on

-- Issue #3645 — implementor proof that a trip DRAFT saves a priced package
-- before the brand can take payments, and that the stop is at Publish.
-- Run after the full migration chain on PostgreSQL 17.
--
-- BEFORE. `biz_apply_trip_draft_graph` raised `stripe_charges_disabled` on a
-- package insert or update with a price above zero when the brand could not
-- collect, so a host lost the package they had just typed.
--
-- AFTER (20270823003645). The draft save keeps the price. The paid-publish
-- refusal is untouched: `biz_publish_trip_command` still answers
-- `stripe_charges_disabled` for that same draft, and the draft stays a draft
-- with its prices intact. Once the brand can collect (and the organiser has
-- accepted the Organiser Terms), the very same draft publishes.
--
-- Every patch is shaped the way `tripsService.ts` shapes it. NULL-safety:
-- every comparison whose left side can be NULL uses `IS DISTINCT FROM`.

BEGIN;

SELECT set_config('request.jwt.claim.sub', '36450823-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO auth.users(id) VALUES ('36450823-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('36450823-0000-4000-8000-000000000001');

-- A brand with a payout currency and NO bank and NO payment provider.
INSERT INTO public.brands(id, account_id, name, slug, default_currency)
VALUES (
  '36450823-0000-4000-8000-000000000010',
  '36450823-0000-4000-8000-000000000001',
  'Issue 3645 trips',
  'issue-3645-trips',
  'GBP'
);

CREATE FUNCTION pg_temp.iso(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"')
$$;

CREATE FUNCTION pg_temp.rev(p_event uuid) RETURNS timestamptz
LANGUAGE sql AS $$ SELECT updated_at FROM public.events WHERE id = p_event $$;

DO $$
DECLARE
  v_brand uuid := '36450823-0000-4000-8000-000000000010';
  v_owner uuid := '36450823-0000-4000-8000-000000000001';
  g jsonb;
  v_event uuid;
  v_standard uuid;
  v_vip uuid;
  v_count integer;
  v_price integer;
  v_free boolean;
  v_status text;
  v_result jsonb;
  v_refused boolean;
BEGIN
  -- A-00 the premise: this brand cannot collect.
  IF public.pg_brand_can_collect(v_brand) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A-00 fixture brand can already collect; the suite would prove nothing';
  END IF;

  g := public.biz_create_trip_draft(
    v_brand, jsonb_build_object('title', 'Untitled trip'),
    '36450823-0000-4000-8000-0000000000a1');
  v_event := (g#>>'{event,id}')::uuid;
  v_standard := (g#>>'{tiers,0,ticket_type_id}')::uuid;
  IF v_event IS NULL OR v_standard IS NULL THEN
    RAISE EXCEPTION 'A-01 create returned no event or no placeholder package';
  END IF;

  -- Step 1 + Step 2 the way the wizard saves them, so publish is otherwise ready.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object(
      'event', jsonb_build_object(
        'title', 'Lisbon long weekend',
        'business_trip', jsonb_build_object(
          'startAt', pg_temp.iso(date_trunc('second', now() + interval '60 days')),
          'endAt', pg_temp.iso(date_trunc('second', now() + interval '63 days')),
          'destinationLocationText', 'Lisbon, Portugal')),
      'days', jsonb_build_array(jsonb_build_object('ordinal', 1, 'title', 'Arrival'))),
    pg_temp.rev(v_event),
    '36450823-0000-4000-8000-0000000000a2');

  -- A-02 UPDATE path: the placeholder package takes a price. This raised
  -- `stripe_charges_disabled` before the migration.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_standard,
      'tier_name', 'Standard',
      'price_cents', 25000,
      'capacity', 12))),
    pg_temp.rev(v_event),
    '36450823-0000-4000-8000-0000000000a3');
  SELECT price_cents, is_free INTO v_price, v_free
    FROM public.ticket_types WHERE id = v_standard;
  IF v_price IS DISTINCT FROM 25000 THEN
    RAISE EXCEPTION 'A-02 a priced package update did not save its price, got %', v_price;
  END IF;
  IF v_free IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A-03 a priced package is still marked free';
  END IF;

  -- A-04 INSERT path: a second, priced package with a payment plan (the brief
  -- treats a trip with a payment plan exactly like a priced trip).
  g := public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
      'tier_name', 'VIP',
      'price_cents', 40000,
      'capacity', 4,
      'display_order', 1,
      'tier_metadata', jsonb_build_object(
        'installments', jsonb_build_object(
          'deposit_pct', 25,
          'installments', jsonb_build_array(jsonb_build_object(
            'ordinal', 1, 'pct', 75, 'days_after_booking', 30))))))),
    pg_temp.rev(v_event),
    '36450823-0000-4000-8000-0000000000a4');
  SELECT t.id INTO v_vip FROM public.ticket_types t
   WHERE t.event_id = v_event AND t.name = 'VIP' AND t.deleted_at IS NULL;
  IF v_vip IS NULL THEN RAISE EXCEPTION 'A-04 a new priced package was not saved'; END IF;
  SELECT price_cents, is_free INTO v_price, v_free FROM public.ticket_types WHERE id = v_vip;
  IF v_price IS DISTINCT FROM 40000 OR v_free IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A-05 the new package saved the wrong price (% / free=%)', v_price, v_free;
  END IF;
  SELECT count(*) INTO v_count FROM public.trip_pricing_tiers
   WHERE event_id = v_event AND ticket_type_id = v_vip
     AND tier_metadata ? 'installments';
  IF v_count <> 1 THEN RAISE EXCEPTION 'A-06 the payment plan on the new package was not saved'; END IF;

  -- A-07 the saved draft is still a draft and still not sellable.
  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'A-07 saving a price moved the trip to %', v_status; END IF;

  -- B. THE STOP IS AT PUBLISH. Same draft, same brand: publish is refused with
  -- the token the client maps to "connect a bank", and nothing is lost.
  v_refused := false;
  BEGIN
    v_result := public.biz_publish_trip_command(
      v_event, pg_temp.rev(v_event), '36450823-0000-4000-8000-0000000000b1');
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'stripe_charges_disabled' THEN
      RAISE EXCEPTION 'B-01 paid publish was refused with %, expected stripe_charges_disabled', SQLERRM;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'B-02 a priced trip published for a brand that cannot collect: %', v_result;
  END IF;
  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'B-03 a refused publish moved the trip to %', v_status; END IF;
  SELECT count(*) INTO v_count FROM public.ticket_types
   WHERE event_id = v_event AND deleted_at IS NULL AND price_cents IN (25000, 40000);
  IF v_count <> 2 THEN RAISE EXCEPTION 'B-04 a refused publish lost a saved price (% of 2 left)', v_count; END IF;

  -- C. Once the brand can collect and the organiser has accepted the Organiser
  -- Terms, the SAME draft publishes with no re-entry.
  RESET ROLE;
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_issue3645_trip' WHERE id = v_brand;
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = v_brand AND user_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'C-00 fixture: the owner has no team row to accept the terms on'; END IF;
  IF public.pg_brand_can_collect(v_brand) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'C-01 fixture brand still cannot collect';
  END IF;

  v_result := public.biz_publish_trip_command(
    v_event, pg_temp.rev(v_event), '36450823-0000-4000-8000-0000000000c1');
  IF NOT COALESCE((v_result->>'ok')::boolean, true) THEN
    RAISE EXCEPTION 'C-02 publish was refused once the brand could collect: %', v_result;
  END IF;
  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_status IS NULL OR v_status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'C-03 the priced draft did not publish, status=% result=%', v_status, v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public.ticket_types
   WHERE event_id = v_event AND deleted_at IS NULL AND price_cents IN (25000, 40000);
  IF v_count <> 2 THEN RAISE EXCEPTION 'C-04 the published trip lost a price (% of 2 left)', v_count; END IF;
END $$;

ROLLBACK;
