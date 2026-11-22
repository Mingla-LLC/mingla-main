-- MINGLA-INVARIANT: I-4522-PLAN-PRICE-LIVE | issue #4522 | A published trip edit and a publish transition validate every v2 payment plan against the package price before the transaction can commit.
\set ON_ERROR_STOP on

-- Issue #4522 slice 12 (20281125074522). Drives the real
-- biz_update_live_trip RPC and the real publish trigger. The rollout switch is
-- enabled only inside this rolled-back test transaction.

BEGIN;

SELECT set_config('request.jwt.claim.sub', '45221200-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO auth.users(id)
VALUES ('45221200-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id)
VALUES ('45221200-0000-4000-8000-000000000001');
INSERT INTO public.brands(id, account_id, name, slug, default_currency)
VALUES (
  '45221200-0000-4000-8000-000000000010',
  '45221200-0000-4000-8000-000000000001',
  'Issue 4522 live plans',
  'issue-4522-live-plans',
  'USD'
);

CREATE OR REPLACE FUNCTION public.issue_4522_plan_v2_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$ SELECT true $fn$;

-- The RPC's paid-edit readiness gate is not the invariant under test.
CREATE OR REPLACE FUNCTION public.pg_brand_can_collect(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$ SELECT true $fn$;

CREATE FUNCTION pg_temp.v2_amount(p_amount bigint) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('payment_plan', jsonb_build_object(
    'v', 2,
    'deposit', jsonb_build_object('mode', 'amount', 'amount_minor', p_amount),
    'count', 3,
    'final_due_days_before_start', 30,
    'auto_adjust', true,
    'flex', jsonb_build_object('enabled', false),
    'custom_amounts_minor', NULL))
$$;

CREATE FUNCTION pg_temp.raised(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$$;

CREATE FUNCTION pg_temp.live_edit(
  p_event_id uuid,
  p_tier_id uuid,
  p_change jsonb
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result jsonb;
  v_hint text;
BEGIN
  BEGIN
    v_result := public.biz_update_live_trip(
      p_event_id,
      jsonb_build_object(
        'pricing_tiers',
        jsonb_build_array(jsonb_build_object('ticket_type_id', p_tier_id) || p_change)
      ),
      'Changing package plan for verification'
    );
    SET CONSTRAINTS issue_4522_live_tier_plan_price_guard,
                    issue_4522_live_price_plan_guard IMMEDIATE;
    RETURN 'ok:' || v_result::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    RETURN SQLSTATE || ':' || SQLERRM || '|' || COALESCE(v_hint, '');
  END;
END
$$;

DO $$
DECLARE
  v_graph jsonb;
  v_event uuid;
  v_tier uuid;
  v_tier_name text;
  v_result text;
  v_meta jsonb;
BEGIN
  v_graph := public.biz_create_trip_draft(
    '45221200-0000-4000-8000-000000000010',
    jsonb_build_object('title', 'Live plan guard trip'),
    '45221200-0000-4000-8000-0000000000a1'
  );
  v_event := (v_graph#>>'{event,id}')::uuid;
  v_tier := (v_graph#>>'{tiers,0,ticket_type_id}')::uuid;

  v_graph := public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_tier,
      'tier_name', 'Shared room',
      'price_cents', 120000,
      'tier_metadata', pg_temp.v2_amount(100000)
    ))),
    (SELECT updated_at FROM public.events WHERE id = v_event),
    '45221200-0000-4000-8000-0000000000a2'
  );

  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event, now() + interval '90 days', now() + interval '95 days', 'UTC', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'hidden'
   WHERE id = v_event;

  SET CONSTRAINTS issue_4522_live_tier_plan_price_guard,
                  issue_4522_live_price_plan_guard IMMEDIATE;
  SET CONSTRAINTS issue_4522_live_tier_plan_price_guard,
                  issue_4522_live_price_plan_guard DEFERRED;

  SELECT tier_name INTO v_tier_name
    FROM public.trip_pricing_tiers WHERE ticket_type_id = v_tier;

  -- C10-01: changing the plan through the real live RPC cannot leave an
  -- amount deposit above the unchanged package price.
  v_result := pg_temp.live_edit(
    v_event,
    v_tier,
    jsonb_build_object('tier_metadata', pg_temp.v2_amount(130000))
  );
  IF v_result IS DISTINCT FROM '22023:plan_deposit_invalid|' || v_tier_name THEN
    RAISE EXCEPTION 'C10-01 expected live plan refusal naming %, got %',
      v_tier_name, v_result;
  END IF;
  SELECT tier_metadata INTO v_meta
    FROM public.trip_pricing_tiers WHERE ticket_type_id = v_tier;
  IF v_meta IS DISTINCT FROM pg_temp.v2_amount(100000) THEN
    RAISE EXCEPTION 'C10-01 rejected live plan persisted: %', v_meta;
  END IF;

  SET CONSTRAINTS issue_4522_live_tier_plan_price_guard,
                  issue_4522_live_price_plan_guard DEFERRED;

  -- C10-02: changing only the price is checked against the saved plan.
  v_result := pg_temp.live_edit(
    v_event,
    v_tier,
    jsonb_build_object('price_cents', 90000)
  );
  IF v_result IS DISTINCT FROM '22023:plan_deposit_invalid|' || v_tier_name THEN
    RAISE EXCEPTION 'C10-02 expected live price refusal naming %, got %',
      v_tier_name, v_result;
  END IF;
  IF (SELECT price_cents FROM public.ticket_types WHERE id = v_tier) <> 120000 THEN
    RAISE EXCEPTION 'C10-02 rejected live price persisted';
  END IF;

  SET CONSTRAINTS issue_4522_live_tier_plan_price_guard,
                  issue_4522_live_price_plan_guard DEFERRED;

  -- C10-03: a valid final pair commits through the same path.
  v_result := pg_temp.live_edit(
    v_event,
    v_tier,
    jsonb_build_object('price_cents', 150000)
  );
  IF v_result NOT LIKE 'ok:%' THEN
    RAISE EXCEPTION 'C10-03 valid live edit failed: %', v_result;
  END IF;
  IF (SELECT price_cents FROM public.ticket_types WHERE id = v_tier) <> 150000 THEN
    RAISE EXCEPTION 'C10-03 valid live price did not persist';
  END IF;
END
$$;

DO $$
DECLARE
  v_graph jsonb;
  v_event uuid;
  v_tier uuid;
  v_result text;
BEGIN
  v_graph := public.biz_create_trip_draft(
    '45221200-0000-4000-8000-000000000010',
    jsonb_build_object('title', 'Publish plan guard trip'),
    '45221200-0000-4000-8000-0000000000b1'
  );
  v_event := (v_graph#>>'{event,id}')::uuid;
  v_tier := (v_graph#>>'{tiers,0,ticket_type_id}')::uuid;

  UPDATE public.ticket_types SET price_cents = 120000 WHERE id = v_tier;
  UPDATE public.trip_pricing_tiers
     SET tier_metadata = pg_temp.v2_amount(130000)
   WHERE event_id = v_event AND ticket_type_id = v_tier;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event, now() + interval '120 days', now() + interval '125 days', 'UTC', true);

  -- C10-04: the real exposure-increasing publish trigger validates before
  -- capability and leaves the trip a draft on refusal.
  v_result := pg_temp.raised(format(
    'UPDATE public.events SET status = %L, visibility = %L WHERE id = %L',
    'scheduled', 'public', v_event
  ));
  IF v_result IS DISTINCT FROM '22023:plan_deposit_invalid' THEN
    RAISE EXCEPTION 'C10-04 expected publish price refusal, got %', v_result;
  END IF;
  IF (SELECT status FROM public.events WHERE id = v_event) IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'C10-04 refused publish changed status';
  END IF;
END
$$;

ROLLBACK;
