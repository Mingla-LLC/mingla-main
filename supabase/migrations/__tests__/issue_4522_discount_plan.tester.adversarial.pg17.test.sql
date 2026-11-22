-- MINGLA-INVARIANT: I-4522-15 | issue #4522 | A discount never breaks checkout on a v2 plan: custom amounts are set against the list price and scale by the trip part's ratio (whole units, the last row takes the exact remainder); custom rows that cannot hold degrade the line to full_only, so "Pay in full" and the quote never fail on a plan preview; SQL and the TypeScript mirror agree on 600 discounted cases.
\set ON_ERROR_STOP on

-- Rework after the #4522 tester FAIL (F3). Rolled back.

BEGIN;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL %: %', p_label, COALESCE(p_detail, '(no detail)');
  END IF;
END $$;

CREATE FUNCTION pg_temp.raised(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.line(p_i integer, p_s jsonb) RETURNS text
LANGUAGE sql AS $$
  SELECT p_i || '|' || (p_s->>'availability') || '|' || (p_s->>'deposit_minor') || '|' || (p_s->>'count_given')
      || '|' || (p_s->>'final_due_at') || '|'
      || COALESCE((SELECT string_agg((r->>'due_at') || ':' || (r->>'amount_minor') || ':' || (r->>'addon_portion_minor'), ','
                                     ORDER BY o)
                     FROM jsonb_array_elements(p_s->'rows') WITH ORDINALITY a(r, o)), '')
$$;

-- ── A. The tester's case: $1,000 package, 25% deposit, custom [$400, $300],
--    a 10% sale. Every choice prices; the plan scales to the sale.
INSERT INTO auth.users(id, email) VALUES ('45220f03-0000-4000-8000-000000000001', 'disc-owner@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES ('45220f03-0000-4000-8000-000000000001', 'disc-owner@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, pricing_region, pricing_currency)
VALUES ('45220f03-0000-4000-8000-000000000002', '45220f03-0000-4000-8000-000000000001', 'Disc brand', 'disc-brand-4522', 'USD', 'stripe', 'US', 'US', 'USD');
INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, charges_enabled, payouts_enabled, country, default_currency)
VALUES ('45220f03-0000-4000-8000-000000000002', 'acct_disc4522', true, true, 'US', 'usd');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'discounts_enabled';
INSERT INTO public.program_brand_rollouts(brand_id, program, phase) VALUES ('45220f03-0000-4000-8000-000000000002', 'discounts', 'pilot');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency)
VALUES ('45220f03-0000-4000-8000-000000000003', '45220f03-0000-4000-8000-000000000002', '45220f03-0000-4000-8000-000000000001',
  'Disc trip', 'disc-trip-4522', 'trip', 'scheduled', 'public', 'America/New_York', 'USD');
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
VALUES ('45220f03-0000-4000-8000-000000000003', date_trunc('day', now()) + interval '200 days 14 hours',
        date_trunc('day', now()) + interval '207 days', 'America/New_York', true);
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited, min_purchase_qty, max_purchase_qty, available_online, available_in_person)
VALUES ('45220f03-0000-4000-8000-000000000011', '45220f03-0000-4000-8000-000000000003', 'Room', 100000, 'USD', false, 50, false, 1, 10, true, false);
INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name, tier_metadata) VALUES
 ('45220f03-0000-4000-8000-000000000003', '45220f03-0000-4000-8000-000000000011', 'Room',
  '{"payment_plan":{"v":2,"deposit":{"mode":"percent","pct":25},"count":3,"final_due_days_before_start":30,"auto_adjust":true,"flex":{"enabled":false},"custom_amounts_minor":[40000,30000]}}');

CREATE FUNCTION pg_temp.quote(p_choice text, p_qty integer, p_code text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.issue_3872_ticket_quote('45220f03-0000-4000-8000-000000000003',
    jsonb_build_array(jsonb_build_object('ticketTypeId', '45220f03-0000-4000-8000-000000000011', 'quantity', p_qty)),
    NULL, NULL, NULL, NULL, p_choice, p_code, 'disc-buyer@example.test', '+15555550931', NULL, NULL, false)
$$;
CREATE FUNCTION pg_temp.rows_of(p_quote jsonb) RETURNS text
LANGUAGE sql AS $$
  SELECT string_agg((e->>'amountCents'), '/' ORDER BY (e->>'ordinal')::int)
    FROM jsonb_array_elements(COALESCE(p_quote->'installmentSchedule'->'installments',
                                       p_quote->'paymentPlanV2'->'installmentSchedule'->'installments')) e
$$;

DO $t$
DECLARE v jsonb; v_txt text;
BEGIN
  v := pg_temp.quote('installments', 1);
  PERFORM pg_temp.check('F3 no discount: the host''s custom rows', pg_temp.rows_of(v) = '40000/30000/5000'
    AND (v->>'dueTodayNetCents')::bigint = 25000, v::text);

  -- A public 10% sale on the package.
  INSERT INTO public.brand_discounts(id, brand_id, kind, code, name, value_type, value_bps, scope_kind, combines_with, status, created_by)
  VALUES ('45220f03-0000-4000-8000-000000000021', '45220f03-0000-4000-8000-000000000002', 'sale_price', NULL, 'Sale', 'percent',
          1000, 'items', 'any', 'active', '45220f03-0000-4000-8000-000000000001');
  INSERT INTO public.brand_discount_targets(discount_id, target_kind, target_id)
  VALUES ('45220f03-0000-4000-8000-000000000021', 'ticket_type', '45220f03-0000-4000-8000-000000000011');

  v_txt := pg_temp.raised($q$SELECT pg_temp.quote('full', 1)$q$);
  PERFORM pg_temp.check('F3 sale: "Pay in full" prices', v_txt = 'ok', v_txt);
  v := pg_temp.quote('full', 1);
  PERFORM pg_temp.check('F3 sale: pay in full is the sale price', (v->>'dueTodayNetCents')::bigint = 90000, v::text);
  v := pg_temp.quote('installments', 1);
  PERFORM pg_temp.check('F3 sale: custom rows scale with exact remainder (deposit 225 + 360/270/45 = 900)',
    (v->>'dueTodayNetCents')::bigint = 22500 AND pg_temp.rows_of(v) = '36000/27000/4500', v::text);
  v := pg_temp.quote('installments', 2);
  PERFORM pg_temp.check('F3 sale, two travelers: per-traveler amounts scale too',
    (v->>'dueTodayNetCents')::bigint = 45000 AND pg_temp.rows_of(v) = '72000/54000/9000', v::text);
  v := public.biz_ticket_checkout_create_session('45220f03-0000-4000-8000-000000000003', NULL, 'Disc Buyer',
    'disc-buyer@example.test', '+15555550931', false,
    '[{"ticketTypeId":"45220f03-0000-4000-8000-000000000011","quantity":1}]'::jsonb, 'disc-4522-idem-1',
    now() + interval '15 minutes', 0, 'installments', NULL, NULL, NULL, NULL, NULL, NULL);
  PERFORM pg_temp.check('F3 sale: create session takes the scaled plan',
    (SELECT installment_schedule->'installments'->2->>'amountCents' = '4500'
       FROM public.ticket_checkout_sessions WHERE idempotency_key = 'disc-4522-idem-1'), v::text);

  -- A deep sale: the custom rows cannot hold; the line degrades to full_only,
  -- "Pay in full" still prices and "installments" is refused cleanly.
  UPDATE public.brand_discounts SET value_bps = 9900 WHERE id = '45220f03-0000-4000-8000-000000000021';
  UPDATE public.trip_pricing_tiers SET tier_metadata = jsonb_set(tier_metadata, '{payment_plan,deposit}',
         '{"mode":"amount","amount_minor":900}') WHERE ticket_type_id = '45220f03-0000-4000-8000-000000000011';
  v := pg_temp.quote('full', 1);
  PERFORM pg_temp.check('F3 deep sale: pay in full prices', (v->>'dueTodayNetCents')::bigint = 1000, v::text);
  v := pg_temp.quote('auto', 1);
  PERFORM pg_temp.check('F3 deep sale: the preview degrades to full_only',
    COALESCE(v->'paymentPlanV2'->>'availability', v->>'availability') = 'full_only', v::text);
  v_txt := pg_temp.raised($q$SELECT pg_temp.quote('installments', 1)$q$);
  PERFORM pg_temp.check('F3 deep sale: asking for installments is a clean refusal',
    v_txt LIKE 'P0001:installment_plan_unavailable%', v_txt);
END
$t$;

-- ── B. SQL / TypeScript parity on 600 discounted cases (MINSTD, seed 45229).
--    packages/offering-rendering/__tests__/issue_4522_trip_plan_v2_discount_parity.tester.adversarial.test.ts
--    draws the same inputs and must reach the same digest.
DO $$
DECLARE
  x bigint := 45229;
  v_tz text[] := ARRAY['Africa/Lagos', 'America/New_York', 'Europe/London', 'UTC'];
  v_out text[] := ARRAY[]::text[];
  v_i integer; v_k integer;
  v_list bigint; v_net bigint; v_units integer; v_bps bigint; v_plan jsonb; v_count integer; v_custom jsonb;
  v_zone text; v_start bigint; v_booked bigint; v_at bigint; v_as bigint; v_cap bigint;
  v_line text; v_digest text; v_plans integer; v_degraded integer; v_scaled integer := 0;
BEGIN
  FOR v_i IN 1..600 LOOP
    x := x * 48271 % 2147483647; v_units := 1 + x % 4;
    x := x * 48271 % 2147483647; v_list := (100 + x % 50000000) * v_units;
    x := x * 48271 % 2147483647;
    IF x % 4 = 0 THEN v_bps := 0; ELSE x := x * 48271 % 2147483647; v_bps := x % 9900; END IF;
    v_net := v_list - v_list * v_bps / 10000;
    x := x * 48271 % 2147483647;
    IF x % 2 = 0 THEN
      x := x * 48271 % 2147483647;
      v_plan := jsonb_build_object('v', 2, 'deposit', jsonb_build_object('mode', 'percent', 'pct', 1 + x % 100));
    ELSE
      x := x * 48271 % 2147483647;
      v_plan := jsonb_build_object('v', 2, 'deposit', jsonb_build_object('mode', 'amount', 'amount_minor', 100 + x % 200000));
    END IF;
    x := x * 48271 % 2147483647; v_count := 1 + x % 12;
    v_plan := v_plan || jsonb_build_object('count', v_count);
    x := x * 48271 % 2147483647; v_plan := v_plan || jsonb_build_object('final_due_days_before_start', x % 181);
    x := x * 48271 % 2147483647; v_plan := v_plan || jsonb_build_object('auto_adjust', x % 3 <> 0);
    x := x * 48271 % 2147483647;
    IF x % 2 = 0 AND v_count > 1 THEN
      v_cap := greatest(1, 2 * v_list / v_units / v_count);
      v_custom := '[]'::jsonb;
      FOR v_k IN 1..v_count - 1 LOOP
        x := x * 48271 % 2147483647;
        v_custom := v_custom || to_jsonb(100 + x % v_cap);
      END LOOP;
      v_plan := v_plan || jsonb_build_object('custom_amounts_minor', v_custom);
      IF v_bps > 0 THEN v_scaled := v_scaled + 1; END IF;
    END IF;
    x := x * 48271 % 2147483647; v_zone := v_tz[1 + (x % 4)::integer];
    x := x * 48271 % 2147483647; v_start := 1798761600 + (x % 730) * 86400;
    x := x * 48271 % 2147483647; v_start := v_start + x % 86400;
    x := x * 48271 % 2147483647; v_booked := v_start - (x % 400) * 86400;
    x := x * 48271 % 2147483647; v_booked := v_booked - x % 86400;
    x := x * 48271 % 2147483647; v_at := 0;
    IF x % 3 = 0 THEN x := x * 48271 % 2147483647; v_at := x % 50000; END IF;
    x := x * 48271 % 2147483647; v_as := 0;
    IF x % 3 = 0 THEN x := x * 48271 % 2147483647; v_as := x % 80000; END IF;
    BEGIN
      v_line := pg_temp.line(v_i, public.issue_4522_plan_v2_schedule(v_net, v_units, v_plan,
        to_timestamp(v_start), v_zone, to_timestamp(v_booked), v_at, v_as, v_list));
    EXCEPTION WHEN OTHERS THEN
      v_line := v_i || '|ERR:' || SQLERRM;
    END;
    v_out := v_out || v_line;
  END LOOP;
  v_digest := md5(array_to_string(v_out, E'\n'));
  SELECT count(*) FILTER (WHERE l LIKE '%|plan|%'), count(*) FILTER (WHERE l LIKE '%|full_only|%')
    INTO v_plans, v_degraded FROM unnest(v_out) l;
  RAISE NOTICE 'ISSUE-4522 discount parity digest % (% plans, % full_only, % discounted custom)', v_digest, v_plans, v_degraded, v_scaled;
  PERFORM pg_temp.check('F3 no case raises', NOT EXISTS (SELECT 1 FROM unnest(v_out) l WHERE l LIKE '%|ERR:%'),
    (SELECT string_agg(l, ' / ') FROM unnest(v_out) l WHERE l LIKE '%|ERR:%'));
  PERFORM pg_temp.check('F3 the cases exercise discounted custom plans', v_scaled >= 100 AND v_plans >= 150,
    v_scaled || ' scaled, ' || v_plans || ' plans');
  PERFORM pg_temp.check('F3 parity digest', v_digest = 'c957a5ec0994457a7b719fd1a8ea4fde', v_digest);
END $$;

ROLLBACK;
