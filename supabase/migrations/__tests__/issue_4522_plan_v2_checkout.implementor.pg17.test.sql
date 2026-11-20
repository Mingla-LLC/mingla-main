-- MINGLA-INVARIANT: I-4522-1 | issue #4522 | Every v2 checkout schedule conserves money: deposit plus every row equals the line total plus its add-ons, and every row is above zero.
-- MINGLA-INVARIANT: I-4522-3 | issue #4522 | v2 rows fall at least 7 days apart and the first at least 7 days after booking, at 09:00 in the trip time zone, and the last on the final due date.
-- MINGLA-INVARIANT: I-4522-6 | issue #4522 | A legacy v1 trip quote is byte-identical to the fixture recorded before #4522 and keeps its refusal codes.
\set ON_ERROR_STOP on

-- Issue #4522 slice 2 (M2, 20281120064522): the per-traveler schedule, the v2
-- branch of quote / create-session / finalize, the add-on payment choice and
-- the #3859 contract-path planner. The server switch and #3281's plan switch
-- are turned on only inside this transaction (rolled back).

BEGIN;

CREATE FUNCTION pg_temp.raised(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

-- A compact, order-stable line per schedule (shared with the TS parity test).
CREATE FUNCTION pg_temp.line(p_i integer, s jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_i || '|' || (s->>'availability') || '|' || (s->>'deposit_minor') || '|'
      || (s->>'count_given') || '|' || (s->>'final_due_at') || '|'
      || COALESCE((SELECT string_agg((r->>'due_at') || ':' || (r->>'amount_minor') || ':'
                                     || (r->>'addon_portion_minor'), ',' ORDER BY o)
                     FROM jsonb_array_elements(s->'rows') WITH ORDINALITY a(r, o)), '')
$$;

-------------------------------------------------------------------------------
-- A. SC-2 / SC-3: the spec §6.2 vectors (09:00 Africa/Lagos = 08:00Z).
-------------------------------------------------------------------------------
DO $$
DECLARE
  v_plan jsonb := '{"v":2,"deposit":{"mode":"percent","pct":25},"count":3,"final_due_days_before_start":30,"auto_adjust":true,"flex":{"enabled":false}}';
  v_case record;
  v_got text;
BEGIN
  FOR v_case IN SELECT * FROM (VALUES
    ('2026-11-19', 'plan|30000000|3|2027-02-10T08:00:00Z|2026-12-17T08:00:00Z:30000000:0,2027-01-13T08:00:00Z:30000000:0,2027-02-10T08:00:00Z:30000000:0'),
    ('2027-01-20', 'plan|30000000|3|2027-02-10T08:00:00Z|2027-01-27T08:00:00Z:30000000:0,2027-02-03T08:00:00Z:30000000:0,2027-02-10T08:00:00Z:30000000:0'),
    ('2027-01-25', 'plan|30000000|2|2027-02-10T08:00:00Z|2027-02-02T08:00:00Z:45000000:0,2027-02-10T08:00:00Z:45000000:0'),
    ('2027-02-05', 'full_window|120000000|0|2027-02-10T08:00:00Z|')
  ) c(booked, want) LOOP
    v_got := pg_temp.line(0, public.issue_4522_plan_v2_schedule(120000000, 1, v_plan,
      '2027-03-12T08:00:00Z', 'Africa/Lagos', (v_case.booked || 'T12:00:00+01')::timestamptz, 0, 0));
    IF v_got IS DISTINCT FROM '0|' || v_case.want THEN
      RAISE EXCEPTION 'A-1 booked % expected %, got %', v_case.booked, v_case.want, v_got;
    END IF;
  END LOOP;

  -- USD $1,200, $250 amount deposit, 4 payments, 90 days out: $237 x3 + $239.
  v_got := pg_temp.line(0, public.issue_4522_plan_v2_schedule(120000, 1,
    '{"v":2,"deposit":{"mode":"amount","amount_minor":25000},"count":4,"final_due_days_before_start":30}',
    '2027-03-12T08:00:00Z', 'UTC', '2026-11-12T10:00:00Z', 0, 0));
  IF v_got IS DISTINCT FROM '0|plan|25000|4|2027-02-10T09:00:00Z|2026-12-05T09:00:00Z:23700:0,2026-12-27T09:00:00Z:23700:0,2027-01-19T09:00:00Z:23700:0,2027-02-10T09:00:00Z:23900:0' THEN
    RAISE EXCEPTION 'A-2 USD amount-deposit vector, got %', v_got;
  END IF;

  -- SC-3: auto-adjust off and fewer than `count` fit -> full_only; neither
  -- full_window nor full_only raises the legacy past-due code.
  v_got := pg_temp.line(0, public.issue_4522_plan_v2_schedule(120000000, 1,
    v_plan || '{"auto_adjust":false}', '2027-03-12T08:00:00Z', 'Africa/Lagos', '2027-01-25T12:00:00+01', 0, 0));
  IF v_got IS DISTINCT FROM '0|full_only|120000000|0|2027-02-10T08:00:00Z|' THEN
    RAISE EXCEPTION 'A-3 full_only, got %', v_got;
  END IF;

  -- Deposit covers everything; booked on/after departure.
  IF public.issue_4522_plan_v2_schedule(5000, 1, v_plan || '{"deposit":{"mode":"amount","amount_minor":9000}}',
       '2027-03-12T08:00:00Z', 'UTC', '2026-11-12T10:00:00Z', 0, 0)->>'availability' <> 'full_deposit'
     OR public.issue_4522_plan_v2_schedule(5000, 1, v_plan,
       '2027-03-12T08:00:00Z', 'UTC', '2027-03-12T08:00:00Z', 0, 0)->>'availability' <> 'closed' THEN
    RAISE EXCEPTION 'A-4 full_deposit / closed availability is wrong';
  END IF;

  -- Add-ons: today joins the deposit; spread splits in whole units, last absorbs.
  v_got := pg_temp.line(0, public.issue_4522_plan_v2_schedule(120000000, 1, v_plan,
    '2027-03-12T08:00:00Z', 'Africa/Lagos', '2026-11-19T12:00:00+01', 500000, 1000050));
  IF v_got IS DISTINCT FROM '0|plan|30500000|3|2027-02-10T08:00:00Z|2026-12-17T08:00:00Z:30333300:333300,2027-01-13T08:00:00Z:30333300:333300,2027-02-10T08:00:00Z:30333450:333450' THEN
    RAISE EXCEPTION 'A-5 add-on split, got %', v_got;
  END IF;

  -- Custom amounts: two fit instead of three, so the first two fold into row 1.
  v_got := pg_temp.line(0, public.issue_4522_plan_v2_schedule(120000000, 1,
    v_plan || '{"custom_amounts_minor":[10000000,20000000]}', '2027-03-12T08:00:00Z',
    'Africa/Lagos', '2027-01-25T12:00:00+01', 0, 0));
  IF v_got IS DISTINCT FROM '0|plan|30000000|2|2027-02-10T08:00:00Z|2027-02-02T08:00:00Z:30000000:0,2027-02-10T08:00:00Z:60000000:0' THEN
    RAISE EXCEPTION 'A-6 custom fold, got %', v_got;
  END IF;

  -- Custom amounts that leave nothing for the last row are refused.
  IF pg_temp.raised($q$SELECT public.issue_4522_plan_v2_schedule(1000000, 1,
       '{"v":2,"deposit":{"mode":"percent","pct":50},"count":3,"final_due_days_before_start":0,"custom_amounts_minor":[300000,300000]}',
       '2027-03-12T08:00:00Z','UTC','2026-11-12T10:00:00Z',0,0)$q$)
     IS DISTINCT FROM 'P0001:installment_rounding_invalid' THEN
    RAISE EXCEPTION 'A-7 over-custom must raise installment_rounding_invalid';
  END IF;
END $$;

-------------------------------------------------------------------------------
-- B. Parity with the TS mirror: 200 seeded cases (MINSTD, seed 4522) hashed.
--    packages/offering-rendering/__tests__/issue_4522_trip_plan_v2_parity
--    rebuilds the same 200 inputs and must reach the same digest.
-------------------------------------------------------------------------------
DO $$
DECLARE
  x bigint := 4522;
  v_tz text[] := ARRAY['Africa/Lagos', 'America/New_York', 'Europe/London', 'UTC'];
  v_out text[] := ARRAY[]::text[];
  v_i integer;
  v_k integer;
  v_p bigint; v_units integer; v_plan jsonb; v_count integer; v_custom jsonb;
  v_zone text; v_start bigint; v_booked bigint; v_at bigint; v_as bigint; v_r bigint;
  v_line text;
  v_digest text;
  v_rows integer := 0;
BEGIN
  FOR v_i IN 1..200 LOOP
    x := x * 48271 % 2147483647; v_p := 100 + x % 50000000;
    x := x * 48271 % 2147483647; v_units := 1 + x % 4;
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
    IF x % 5 = 0 AND v_count > 1 THEN
      v_custom := '[]'::jsonb;
      FOR v_k IN 1..v_count - 1 LOOP
        x := x * 48271 % 2147483647;
        v_custom := v_custom || to_jsonb(100 + x % 20000);
      END LOOP;
      v_plan := v_plan || jsonb_build_object('custom_amounts_minor', v_custom);
    END IF;
    x := x * 48271 % 2147483647; v_zone := v_tz[1 + (x % 4)::integer];
    x := x * 48271 % 2147483647; v_start := 1798761600 + (x % 730) * 86400;
    x := x * 48271 % 2147483647; v_start := v_start + x % 86400;
    x := x * 48271 % 2147483647; v_booked := v_start - (x % 400) * 86400;
    x := x * 48271 % 2147483647; v_booked := v_booked - x % 86400;
    x := x * 48271 % 2147483647; IF x % 10 = 0 THEN v_booked := v_booked + 3 * 86400; END IF;
    x := x * 48271 % 2147483647; v_at := 0;
    IF x % 3 = 0 THEN x := x * 48271 % 2147483647; v_at := x % 50000; END IF;
    x := x * 48271 % 2147483647; v_as := 0;
    IF x % 3 = 0 THEN x := x * 48271 % 2147483647; v_as := x % 80000; END IF;
    BEGIN
      v_line := pg_temp.line(v_i, public.issue_4522_plan_v2_schedule(v_p, v_units, v_plan,
        to_timestamp(v_start), v_zone, to_timestamp(v_booked), v_at, v_as));
    EXCEPTION WHEN OTHERS THEN
      v_line := v_i || '|ERR:' || SQLERRM;
    END;
    v_out := v_out || v_line;
  END LOOP;
  v_digest := md5(array_to_string(v_out, E'\n'));
  SELECT count(*) INTO v_rows FROM unnest(v_out) l WHERE l LIKE '%|plan|%';
  RAISE NOTICE 'ISSUE-4522 parity digest % (% of 200 cases took a plan)', v_digest, v_rows;
  IF v_digest IS DISTINCT FROM 'b6a5488764ce29f2949169700e504b32' THEN
    RAISE EXCEPTION 'B-1 parity digest moved: % (first lines: %)', v_digest, array_to_string(v_out[1:3], ' / ');
  END IF;
  IF v_rows < 40 THEN
    RAISE EXCEPTION 'B-2 the seeded cases must exercise plans, only % did', v_rows;
  END IF;
END $$;

-------------------------------------------------------------------------------
-- C. SC-4: a v1 trip quote is byte-identical to the pre-#4522 fixture.
-------------------------------------------------------------------------------
-- seed: a trip with a legacy v1 plan (fixed dates), deterministic ids
INSERT INTO auth.users(id,email) VALUES('45220000-0000-4000-8000-000000000001','plan-owner@example.test');
INSERT INTO public.creator_accounts(id,email) VALUES('45220000-0000-4000-8000-000000000001','plan-owner@example.test');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,payment_provider,payment_country,pricing_region,pricing_currency)
VALUES('45220000-0000-4000-8000-000000000002','45220000-0000-4000-8000-000000000001','Plan brand','plan-brand-4522','USD','stripe','US','US','USD');
INSERT INTO public.stripe_connect_accounts(brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency)
VALUES('45220000-0000-4000-8000-000000000002','acct_4522',true,true,'US','usd');
INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency)
VALUES('45220000-0000-4000-8000-000000000003','45220000-0000-4000-8000-000000000002','45220000-0000-4000-8000-000000000001',
  'Plan trip','plan-trip-4522','trip','scheduled','public','Africa/Lagos','USD');
INSERT INTO public.event_dates(id,event_id,start_at,end_at,timezone,is_master)
VALUES('45220000-0000-4000-8000-000000000004','45220000-0000-4000-8000-000000000003',
  '2099-03-12T08:00:00Z','2099-03-19T08:00:00Z','Africa/Lagos',true);
INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,min_purchase_qty,max_purchase_qty,available_online,available_in_person)
VALUES
 ('45220000-0000-4000-8000-000000000011','45220000-0000-4000-8000-000000000003','Legacy package',120000,'USD',false,50,false,1,10,true,false),
 ('45220000-0000-4000-8000-000000000012','45220000-0000-4000-8000-000000000003','Second package',80000,'USD',false,50,false,1,10,true,false);
INSERT INTO public.trip_pricing_tiers(event_id,ticket_type_id,tier_name,tier_metadata) VALUES
 ('45220000-0000-4000-8000-000000000003','45220000-0000-4000-8000-000000000011','Legacy package',
  '{"installments":{"deposit_pct":25,"installments":[{"ordinal":1,"pct":40,"fixed_date":"2099-01-15T09:00:00Z"},{"ordinal":2,"pct":35,"fixed_date":"2099-02-10T09:00:00Z"}]}}'),
 ('45220000-0000-4000-8000-000000000003','45220000-0000-4000-8000-000000000012','Second package','{}');
DO $$
DECLARE
  v_a text; v_b text;
BEGIN
  v_a := public.issue_3872_ticket_quote('45220000-0000-4000-8000-000000000003',
    '[{"ticketTypeId":"45220000-0000-4000-8000-000000000011","quantity":2},{"ticketTypeId":"45220000-0000-4000-8000-000000000012","quantity":1}]'::jsonb,
    NULL,NULL,NULL,NULL,'auto',NULL,'buyer@example.test','+15555550901',NULL,NULL,false)::text;
  v_b := public.issue_3872_ticket_quote('45220000-0000-4000-8000-000000000003',
    '[{"ticketTypeId":"45220000-0000-4000-8000-000000000011","quantity":1}]'::jsonb,
    NULL,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550901',NULL,NULL,false)::text;
  IF v_a IS DISTINCT FROM '{"lines": [{"quantity": 2, "discounts": [], "ticketName": "Legacy package", "lineNetCents": 240000, "netUnitCents": 120000, "ticketTypeId": "45220000-0000-4000-8000-000000000011", "discountCents": 0, "lineListCents": 240000, "listUnitCents": 120000}, {"quantity": 1, "discounts": [], "ticketName": "Second package", "lineNetCents": 80000, "netUnitCents": 80000, "ticketTypeId": "45220000-0000-4000-8000-000000000012", "discountCents": 0, "lineListCents": 80000, "listUnitCents": 80000}], "extras": [], "notices": [], "currency": "USD", "discounts": [], "codeOutcome": {"with": null, "reason": null, "status": "none", "replaced": [], "required": null}, "quoteDigest": "0ead4aecb4ee23bd6acf0a321bcbe046", "discountCents": 0, "quoteListDigest": "6c992f42fc789368f7595c64238c2a0e", "dueTodayNetCents": 140000, "extrasTotalCents": 0, "netSubtotalCents": 320000, "dueTodayListCents": 140000, "listSubtotalCents": 320000, "installmentSchedule": {"currency": "USD", "depositCents": 140000, "installments": [{"pct": 40, "dueAt": "2099-01-15T09:00:00Z", "ordinal": 1, "amountCents": 96000}, {"pct": 35, "dueAt": "2099-02-10T09:00:00Z", "ordinal": 2, "amountCents": 84000}], "fullPriceCents": 320000}}' THEN
    RAISE EXCEPTION 'C-1 the v1 plan quote changed: %', v_a;
  END IF;
  IF v_b IS DISTINCT FROM '{"lines": [{"quantity": 1, "discounts": [], "ticketName": "Legacy package", "lineNetCents": 120000, "netUnitCents": 120000, "ticketTypeId": "45220000-0000-4000-8000-000000000011", "discountCents": 0, "lineListCents": 120000, "listUnitCents": 120000}], "extras": [], "notices": [], "currency": "USD", "discounts": [], "codeOutcome": {"with": null, "reason": null, "status": "none", "replaced": [], "required": null}, "quoteDigest": "45eec22f8efc91e894a19bee3a800bfb", "discountCents": 0, "quoteListDigest": "656e4ced0b69cc97862646a8c336bff3", "dueTodayNetCents": 120000, "extrasTotalCents": 0, "netSubtotalCents": 120000, "dueTodayListCents": 120000, "listSubtotalCents": 120000, "installmentSchedule": null}' THEN
    RAISE EXCEPTION 'C-2 the v1 full quote changed: %', v_b;
  END IF;
END $$;

-------------------------------------------------------------------------------
-- D. Switch off: a v2 package (written past the validator) is paid in full,
--    never charged on a plan the server cannot run.
-------------------------------------------------------------------------------
INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,min_purchase_qty,max_purchase_qty,available_online,available_in_person)
VALUES ('45220000-0000-4000-8000-000000000013','45220000-0000-4000-8000-000000000003','V2 package',120000,'USD',false,50,false,1,10,true,false);
INSERT INTO public.trip_pricing_tiers(event_id,ticket_type_id,tier_name,tier_metadata)
VALUES ('45220000-0000-4000-8000-000000000003','45220000-0000-4000-8000-000000000013','V2 package',
  '{"payment_plan":{"v":2,"deposit":{"mode":"percent","pct":25},"count":3,"final_due_days_before_start":30,"auto_adjust":true,"flex":{"enabled":true,"min_payment_minor":5000}}}');
DO $$
DECLARE v_q jsonb;
BEGIN
  v_q := public.issue_3872_ticket_quote('45220000-0000-4000-8000-000000000003',
    '[{"ticketTypeId":"45220000-0000-4000-8000-000000000013","quantity":1}]'::jsonb,
    NULL,NULL,NULL,NULL,'auto',NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
  IF (v_q->>'dueTodayNetCents')::bigint <> 120000 OR jsonb_typeof(v_q->'installmentSchedule') <> 'null'
     OR v_q ? 'paymentPlanV2' THEN
    RAISE EXCEPTION 'D-1 with the switch off a v2 package must quote pay-in-full, got %', v_q;
  END IF;
END $$;

-------------------------------------------------------------------------------
-- E. Switch on (this transaction only): quote, session and finalize.
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4522_plan_v2_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ SELECT true $fn$;

DO $$
DECLARE
  v_event uuid := '45220000-0000-4000-8000-000000000003';
  v_tt uuid := '45220000-0000-4000-8000-000000000013';
  v_lines jsonb := '[{"ticketTypeId":"45220000-0000-4000-8000-000000000013","quantity":2}]';
  v_q jsonb;
  v_s jsonb;
  v_sched jsonb;
  v_sum bigint;
  v_session uuid;
  v_order uuid;
  v_fin jsonb;
  v_raised text;
  v_prev timestamptz;
  v_entry jsonb;
BEGIN
  -- A trip that leaves about 200 days, so the full plan fits.
  UPDATE public.event_dates SET start_at = date_trunc('day', now()) + interval '200 days 8 hours',
    end_at = date_trunc('day', now()) + interval '207 days 8 hours'
   WHERE event_id = v_event;

  v_q := public.issue_3872_ticket_quote(v_event, v_lines,
    NULL,NULL,NULL,NULL,'auto',NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
  v_sched := v_q->'installmentSchedule';
  IF (v_sched->>'planVersion')::integer <> 2 OR v_sched->>'availability' <> 'plan'
     OR (v_sched->>'countGiven')::integer <> 3 OR (v_sched->>'depositCents')::bigint <> 60000
     OR (v_q->>'dueTodayNetCents')::bigint <> 60000
     OR v_q->'paymentPlanV2'->>'availability' <> 'plan' THEN
    RAISE EXCEPTION 'E-1 the v2 quote is wrong: %', v_q;
  END IF;
  SELECT sum((e->>'amountCents')::bigint) INTO v_sum FROM jsonb_array_elements(v_sched->'installments') e;
  IF v_sum + 60000 <> 240000 OR (v_sched->>'fullPriceCents')::bigint <> 240000 THEN
    RAISE EXCEPTION 'E-2 I-4522-1 the v2 quote does not conserve money: %', v_sched;
  END IF;
  v_prev := now();
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_sched->'installments') LOOP
    IF (v_entry->>'dueAt')::timestamptz < v_prev + interval '6 days 12 hours'
       OR v_entry->>'sourceTicketTypeId' <> v_tt::text
       OR (v_entry->>'addonPortionCents')::bigint <> 0 THEN
      RAISE EXCEPTION 'E-3 I-4522-3 rows must be 7+ days apart from booking, got %', v_sched;
    END IF;
    v_prev := (v_entry->>'dueAt')::timestamptz;
  END LOOP;

  -- `full` still answers plan availability without changing what is due today.
  v_q := public.issue_3872_ticket_quote(v_event, v_lines,
    NULL,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
  IF (v_q->>'dueTodayNetCents')::bigint <> 240000 OR jsonb_typeof(v_q->'installmentSchedule') <> 'null'
     OR v_q->'paymentPlanV2'->>'availability' <> 'plan' THEN
    RAISE EXCEPTION 'E-4 a full quote must keep the full total and preview the plan, got %', v_q;
  END IF;

  -- An invalid add-on choice is refused (22023); a valid one on a cart with no add-ons is ignored.
  v_raised := pg_temp.raised(format($q$SELECT public.issue_3872_ticket_quote(%L, %L::jsonb,
    NULL,NULL,NULL,NULL,'auto',NULL,'buyer@example.test','+15555550901',NULL,NULL,false)$q$, v_event,
    '[{"ticketTypeId":"45220000-0000-4000-8000-000000000013","quantity":2,"addonPaymentMode":"later"}]'));
  IF v_raised IS DISTINCT FROM '22023:addon_payment_mode_invalid' THEN
    RAISE EXCEPTION 'E-5 expected addon_payment_mode_invalid, got %', v_raised;
  END IF;
  IF public.issue_4522_lines_addon_payment_mode('[{"addonPaymentMode":"today"},{"addonPaymentMode":"today"},{}]') <> 'today'
     OR public.issue_4522_lines_addon_payment_mode('[{"ticketTypeId":"x"}]') IS NOT NULL
     OR pg_temp.raised($q$SELECT public.issue_4522_lines_addon_payment_mode('[{"addonPaymentMode":"today"},{"addonPaymentMode":"spread"}]')$q$)
        IS DISTINCT FROM '22023:addon_payment_mode_invalid' THEN
    RAISE EXCEPTION 'E-5b one add-on choice per cart';
  END IF;

  -- Session + finalize: terms frozen, rows written with kind / version / add-on share.
  v_s := public.biz_ticket_checkout_create_session(v_event, NULL, 'Buyer', 'buyer@example.test',
    '+15555550901', false, v_lines, 'ticket_checkout:' || v_event::text || ':4522-e',
    now() + interval '15 minutes', 0, 'installments', NULL, NULL, NULL, NULL, NULL, NULL);
  v_session := (v_s->>'checkoutSessionId')::uuid;
  IF (v_s->>'totalCents')::integer <> 60000 OR (v_s->'installmentSchedule'->>'planVersion')::integer <> 2 THEN
    RAISE EXCEPTION 'E-6 the v2 session is wrong: %', v_s;
  END IF;
  IF (SELECT payment_plan_terms->>'v' || ':' || (payment_plan_terms->>'flex_enabled') || ':'
             || (payment_plan_terms->>'min_payment_minor') || ':' || COALESCE(addon_payment_mode, '-')
        FROM public.ticket_checkout_sessions WHERE id = v_session) IS DISTINCT FROM '2:true:5000:-' THEN
    RAISE EXCEPTION 'E-7 the session must freeze the v2 terms (no add-ons -> no add-on mode)';
  END IF;
  UPDATE public.ticket_checkout_sessions SET stripe_payment_intent_id = 'pi_4522_e' WHERE id = v_session;
  v_fin := public.issue_1930_ticket_checkout_finalize_base(v_session, 'pi_4522_e', 'ch_4522_e', 'card',
    'i4522-test-pepper-0123456789abcdef', 'cus_4522', 'pm_4522', true);
  v_order := (v_fin->>'orderId')::uuid;
  IF (SELECT payment_plan_terms->>'count_given' FROM public.orders WHERE id = v_order) IS DISTINCT FROM '3'
     OR (SELECT order_id FROM public.ticket_checkout_sessions WHERE id = v_session) IS DISTINCT FROM v_order
     OR (SELECT count(*) FROM public.order_installments
          WHERE order_id = v_order AND kind = 'scheduled' AND schedule_version = 0
            AND addon_portion_minor = 0 AND status = 'scheduled') <> 3
     OR (SELECT sum(amount_cents) FROM public.order_installments WHERE order_id = v_order) <> 180000 THEN
    RAISE EXCEPTION 'E-8 finalize must write the v2 rows and terms, got %', v_fin;
  END IF;

  -- Inside the final window: no plan, and asking for one by name is refused.
  UPDATE public.event_dates SET start_at = date_trunc('day', now()) + interval '33 days 8 hours',
    end_at = date_trunc('day', now()) + interval '40 days 8 hours'
   WHERE event_id = v_event;
  v_q := public.issue_3872_ticket_quote(v_event, v_lines,
    NULL,NULL,NULL,NULL,'auto',NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
  IF (v_q->>'dueTodayNetCents')::bigint <> 240000 OR jsonb_typeof(v_q->'installmentSchedule') <> 'null'
     OR v_q->'paymentPlanV2'->>'availability' <> 'full_window' THEN
    RAISE EXCEPTION 'E-9 SC-3 a booking in the final window pays in full, got %', v_q;
  END IF;
  v_raised := pg_temp.raised(format($q$SELECT public.issue_3872_ticket_quote(%L, %L::jsonb,
    NULL,NULL,NULL,NULL,'installments',NULL,'buyer@example.test','+15555550901',NULL,NULL,false)$q$, v_event, v_lines));
  IF v_raised IS DISTINCT FROM 'P0001:installment_plan_unavailable' THEN
    RAISE EXCEPTION 'E-10 expected installment_plan_unavailable, got %', v_raised;
  END IF;
END $$;

-------------------------------------------------------------------------------
-- F. Add-ons on a v2 plan: refused until #3281's plan switch is on, then
--    `today` joins the deposit and `spread` rides the rows.
-------------------------------------------------------------------------------
INSERT INTO public.ticket_add_ons(id, ticket_type_id, name, price_cents, quantity_total, is_unlimited, max_per_ticket)
VALUES ('45220000-0000-4000-8000-000000000021', '45220000-0000-4000-8000-000000000013', 'Airport transfer', 30000, NULL, true, 1);
DO $$
DECLARE
  v_event uuid := '45220000-0000-4000-8000-000000000003';
  v_lines jsonb := '[{"ticketTypeId":"45220000-0000-4000-8000-000000000013","quantity":2,"addOns":[{"addOnId":"45220000-0000-4000-8000-000000000021","quantity":2}]}]';
  v_spread jsonb := '[{"ticketTypeId":"45220000-0000-4000-8000-000000000013","quantity":2,"addonPaymentMode":"spread","addOns":[{"addOnId":"45220000-0000-4000-8000-000000000021","quantity":2}]}]';
  v_q jsonb;
  v_s jsonb;
  v_sum bigint;
  v_addon bigint;
  v_raised text;
  v_session uuid;
  v_order uuid;
BEGIN
  UPDATE public.event_dates SET start_at = date_trunc('day', now()) + interval '200 days 8 hours',
    end_at = date_trunc('day', now()) + interval '207 days 8 hours'
   WHERE event_id = v_event;
  v_raised := pg_temp.raised(format($q$SELECT public.issue_3872_ticket_quote(%L, %L::jsonb,
    NULL,NULL,NULL,NULL,'auto',NULL,'buyer@example.test','+15555550901',NULL,NULL,false)$q$, v_event, v_spread));
  IF v_raised IS DISTINCT FROM 'P0001:extras_not_on_installments' THEN
    RAISE EXCEPTION 'F-1 add-ons on a plan need #3281''s plan switch, got %', v_raised;
  END IF;
  UPDATE public.add_on_rollout SET plan_enabled = true;

  -- today (the default): 2 x $300 add-ons are due today with the deposit.
  v_q := public.issue_3872_ticket_quote(v_event, v_lines,
    NULL,NULL,NULL,NULL,'auto',NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
  IF (v_q->>'dueTodayNetCents')::bigint <> 60000 + 60000 OR v_q->>'addonPaymentMode' <> 'today'
     OR (v_q->'installmentSchedule'->>'fullPriceCents')::bigint <> 240000 THEN
    RAISE EXCEPTION 'F-2 SC-13 today add-ons join the deposit, got %', v_q;
  END IF;

  -- spread: the add-ons ride the rows, each row tracks its add-on share.
  v_q := public.issue_3872_ticket_quote(v_event, v_spread,
    NULL,NULL,NULL,NULL,'auto',NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
  SELECT sum((e->>'amountCents')::bigint), sum((e->>'addonPortionCents')::bigint) INTO v_sum, v_addon
    FROM jsonb_array_elements(v_q->'installmentSchedule'->'installments') e;
  IF (v_q->>'dueTodayNetCents')::bigint <> 60000 OR v_q->>'addonPaymentMode' <> 'spread'
     OR v_addon <> 60000 OR v_sum <> 180000 + 60000
     OR (v_q->'installmentSchedule'->>'fullPriceCents')::bigint <> 300000 THEN
    RAISE EXCEPTION 'F-3 SC-13 spread add-ons ride the plan rows, got %', v_q;
  END IF;

  v_s := public.biz_ticket_checkout_create_session(v_event, NULL, 'Buyer Two', 'buyer2@example.test',
    '+15555550902', false, v_spread, 'ticket_checkout:' || v_event::text || ':4522-f',
    now() + interval '15 minutes', 0, 'installments', NULL, NULL, NULL, NULL, NULL, v_q->>'quoteDigest');
  v_session := (v_s->>'checkoutSessionId')::uuid;
  IF (v_s->>'totalCents')::integer <> 60000 OR v_s->>'addonPaymentMode' <> 'spread'
     OR (SELECT addon_payment_mode FROM public.ticket_checkout_sessions WHERE id = v_session) <> 'spread'
     OR (SELECT plan_choice FROM public.ticket_checkout_session_add_on_items WHERE checkout_session_id = v_session) <> 'spread' THEN
    RAISE EXCEPTION 'F-4 the session must hold the spread choice, got %', v_s;
  END IF;
  UPDATE public.ticket_checkout_sessions SET stripe_payment_intent_id = 'pi_4522_f' WHERE id = v_session;
  v_order := (public.issue_1930_ticket_checkout_finalize_base(v_session, 'pi_4522_f', 'ch_4522_f', 'card',
    'i4522-test-pepper-0123456789abcdef', 'cus_4522', 'pm_4522', true)->>'orderId')::uuid;
  IF (SELECT addon_payment_mode FROM public.orders WHERE id = v_order) <> 'spread'
     OR (SELECT sum(addon_portion_minor) FROM public.order_installments WHERE order_id = v_order) <> 60000
     OR (SELECT plan_choice FROM public.order_add_on_line_items WHERE order_id = v_order) <> 'spread' THEN
    RAISE EXCEPTION 'F-5 the order must keep the spread add-on shares';
  END IF;
END $$;

-------------------------------------------------------------------------------
-- G. The #3859 contract path planner, and a NULL when no v2 line can run.
-------------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid := '45220000-0000-4000-8000-000000000003';
  v_s jsonb;
  v_plan jsonb;
BEGIN
  v_s := public.biz_ticket_checkout_create_session(v_event, NULL, 'Buyer Three', 'buyer3@example.test',
    '+15555550903', false, '[{"ticketTypeId":"45220000-0000-4000-8000-000000000013","quantity":1}]',
    'ticket_checkout:v2:' || v_event::text || ':45220000-0000-4000-8000-0000000000c1',
    now() + interval '15 minutes', 0, 'full', NULL, NULL, NULL, NULL, NULL, NULL);
  v_plan := public.issue_4522_checkout_v2_plan((v_s->>'checkoutSessionId')::uuid,
    '[{"ticketTypeId":"45220000-0000-4000-8000-000000000013","paymentPlanChoice":"installments"}]');
  IF (v_plan->>'dueTodayNetCents')::bigint <> 30000
     OR jsonb_array_length(v_plan->'installmentSchedule'->'installments') <> 3
     OR v_plan->'installmentSchedule'->'installments'->0->>'sourceTicketTypeId' IS NULL THEN
    RAISE EXCEPTION 'G-1 the contract-path plan is wrong: %', v_plan;
  END IF;
  IF (public.issue_4522_checkout_v2_plan((v_s->>'checkoutSessionId')::uuid,
        '[{"ticketTypeId":"45220000-0000-4000-8000-000000000013","paymentPlanChoice":"full"}]')
        ->>'dueTodayNetCents')::bigint <> 120000 THEN
    RAISE EXCEPTION 'G-2 a full choice on the contract path pays in full';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.issue_4522_plan_v2_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ SELECT false $fn$;
DO $$
BEGIN
  IF public.issue_4522_checkout_v2_plan((SELECT id FROM public.ticket_checkout_sessions
        WHERE buyer_email = 'buyer3@example.test'), '[]') IS NOT NULL THEN
    RAISE EXCEPTION 'G-3 with the switch off the contract path keeps its legacy planner';
  END IF;
  -- Grants: every new function is service_role only.
  IF has_function_privilege('authenticated', 'public.issue_4522_plan_cart_v2(uuid,jsonb,text,timestamptz,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4522_checkout_v2_plan(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3872_ticket_quote(uuid,jsonb,uuid[],timestamptz,timestamptz,integer,text,text,text,text,uuid,text,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4522_lines_addon_payment_mode(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G-4 grants are wrong';
  END IF;
END $$;

ROLLBACK;
