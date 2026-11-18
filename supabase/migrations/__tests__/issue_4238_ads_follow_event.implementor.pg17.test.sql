\set ON_ERROR_STOP on

-- Issue #4238 W2 (items 4 and 5) — ads that follow the event. Runs after the
-- full migration chain on PostgreSQL 17 as supabase_admin over 127.0.0.1.
-- Everything runs in one rolled-back transaction.
--
--   S1  ad_offering_stock: 2 of 2 sold on an unkeyed tier → sold_out.
--   S2  a tier whose sale has not started still has stock → NOT sold out (so
--       the sweep says "not on sale yet", never "sold out").
--   S3  unlimited tier → unlimited, never sold out, remaining NULL.
--   S4  keyed tiers: date A sold out while date B has tickets → the date-A
--       stock is sold out, date B is not, all dates is not (SC-5.6).
--   S5  RSVP full without a waitlist → sold out; full with a waitlist → not.
--   S6  all_free only when every sellable tier is free AND priced 0.
--   S7  typical_price_cents is the median paid price; free tiers ignored.
--   S8  authenticated and anon cannot execute ad_offering_stock.
--   S9  a second goal_promoted / low_stock_copy / slow_sales_nudge row for the
--       same plan and app is refused; auto_paused may repeat.
--   S10 an unknown kind or status is refused; RLS on, no client privilege.
--   S11 ad_spend_daily result counts exist and refuse negatives.
--
-- MINGLA-INVARIANT: I-4238-ONE-GOAL-SWITCH | issue #4238 | A Host ad switches its goal (checkout to purchase) at most once per plan and app: the partial unique index on ad_plan_automation_events (plan_id, platform, kind) refuses a second goal_promoted row, so two concurrent sweeps can never switch twice.
-- MINGLA-INVARIANT: I-4238-LOW-STOCK-ONCE | issue #4238 | The last-tickets offer and the slow-sales nudge are recorded at most once per plan and app (same unique index), so a later sweep never offers or nudges again.
-- MINGLA-INVARIANT: I-4238-TRUE-PAUSE-REASON | issue #4238 | ad_offering_stock tells sold out apart from not-on-sale-yet (same tier predicates as ad_offering_destination_by_id without the sale window): a sold-out pause is only ever given when sellable stock is really zero.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.s_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 ads follow event FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.ev(p_n int, p_type text)
RETURNS uuid LANGUAGE plpgsql AS $o$
DECLARE v_id uuid := ('42380000-7100-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
BEGIN
  INSERT INTO public.events(id, brand_id, title, slug, status, event_type, visibility, timezone)
  VALUES (v_id, '42380000-7000-4000-8000-000000000010', 'Stock ' || p_n, 'stock-' || p_n,
          'scheduled', p_type, 'public', 'Africa/Lagos');
  RETURN v_id;
END $o$;

CREATE OR REPLACE FUNCTION pg_temp.dt(p_event uuid, p_days int, p_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $d$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, is_master, timezone, occurrence_key)
  VALUES (v_id, p_event, now() + make_interval(days => p_days),
          now() + make_interval(days => p_days, hours => 3), p_days = 7, 'Africa/Lagos', p_key);
  RETURN v_id;
END $d$;

CREATE OR REPLACE FUNCTION pg_temp.tier(
  p_event uuid, p_qty int, p_price int DEFAULT 500000, p_free boolean DEFAULT false,
  p_keys text[] DEFAULT NULL, p_sale_start interval DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $t$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, quantity_total,
    is_unlimited, is_free, valid_occurrence_keys, sale_start_at)
  VALUES (v_id, p_event, 'Tier', p_price, 'NGN', p_qty, p_qty IS NULL, p_free, p_keys,
    CASE WHEN p_sale_start IS NULL THEN NULL ELSE now() + p_sale_start END);
  RETURN v_id;
END $t$;

CREATE OR REPLACE FUNCTION pg_temp.sell(p_event uuid, p_tier uuid, p_n int, p_date uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $s$
DECLARE v_order uuid := gen_random_uuid(); v_ticket uuid; i int;
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, payment_status, source)
  VALUES (v_order, p_event, '42380000-7000-4000-8000-000000000003', 'paid', 'manual_import');
  FOR i IN 1..p_n LOOP
    v_ticket := gen_random_uuid();
    INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, status, qr_code)
    VALUES (v_ticket, v_order, p_tier, p_event, 'valid', 'w2-' || v_order || '-' || i);
    -- A date-scoped pass (the per-night counter reads ticket_event_dates).
    IF p_date IS NOT NULL THEN
      INSERT INTO public.ticket_event_dates(ticket_id, event_date_id) VALUES (v_ticket, p_date);
    END IF;
  END LOOP;
END $s$;

INSERT INTO auth.users(id) VALUES
  ('42380000-7000-4000-8000-000000000001'),
  ('42380000-7000-4000-8000-000000000003');
INSERT INTO public.creator_accounts(id, email)
VALUES ('42380000-7000-4000-8000-000000000001', 'owner-4238w2@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES ('42380000-7000-4000-8000-000000000010', '42380000-7000-4000-8000-000000000001',
        'Stock Brand', 'issue-4238-stock', 'NGN', now(), now());

-- S1 sold out --------------------------------------------------------------------
DO $s1$
DECLARE v uuid := pg_temp.ev(1, 'event'); t uuid; j jsonb;
BEGIN
  PERFORM pg_temp.dt(v, 7);
  t := pg_temp.tier(v, 2);
  PERFORM pg_temp.sell(v, t, 2);
  j := public.ad_offering_stock(v);
  PERFORM pg_temp.s_assert((j->>'sold_out')::boolean, 'S1 2 of 2 sold is sold out');
  PERFORM pg_temp.s_assert((j->>'remaining')::int = 0 AND (j->>'total')::int = 2, 'S1 remaining 0 of 2');
  PERFORM pg_temp.s_assert(j->>'kind' = 'tickets', 'S1 kind tickets');
END $s1$;

-- S2 not on sale yet is not sold out ------------------------------------------------
DO $s2$
DECLARE v uuid := pg_temp.ev(2, 'event'); j jsonb;
BEGIN
  PERFORM pg_temp.dt(v, 7);
  PERFORM pg_temp.tier(v, 50, 500000, false, NULL, interval '2 days');
  j := public.ad_offering_stock(v);
  PERFORM pg_temp.s_assert(NOT (j->>'sold_out')::boolean, 'S2 a sale that has not started is not sold out');
  PERFORM pg_temp.s_assert((j->>'remaining')::int = 50, 'S2 remaining 50');
  PERFORM pg_temp.s_assert(
    (public.ad_offering_destination_by_id(v)->>'availability') = 'nothing_on_sale',
    'S2 the destination still says nothing_on_sale (the sweep needs stock to tell them apart)');
END $s2$;

-- S3 unlimited ---------------------------------------------------------------------
DO $s3$
DECLARE v uuid := pg_temp.ev(3, 'event'); j jsonb;
BEGIN
  PERFORM pg_temp.dt(v, 7);
  PERFORM pg_temp.tier(v, NULL);
  PERFORM pg_temp.tier(v, 1);
  j := public.ad_offering_stock(v);
  PERFORM pg_temp.s_assert((j->>'unlimited')::boolean, 'S3 unlimited');
  PERFORM pg_temp.s_assert(NOT (j->>'sold_out')::boolean, 'S3 unlimited is never sold out');
  PERFORM pg_temp.s_assert(j->'remaining' = 'null'::jsonb, 'S3 remaining is null when unlimited');
END $s3$;

-- S4 keyed tiers per date ----------------------------------------------------------
DO $s4$
DECLARE v uuid := pg_temp.ev(4, 'event'); da uuid; db uuid; ta uuid; tb uuid; j jsonb;
BEGIN
  da := pg_temp.dt(v, 7, 'date-a');
  db := pg_temp.dt(v, 14, 'date-b');
  ta := pg_temp.tier(v, 3, 500000, false, ARRAY['date-a']);
  tb := pg_temp.tier(v, 5, 500000, false, ARRAY['date-b']);
  PERFORM pg_temp.sell(v, ta, 3, da);
  j := public.ad_offering_stock(v, 'date-a');
  PERFORM pg_temp.s_assert((j->>'sold_out')::boolean, 'S4 date A is sold out');
  PERFORM pg_temp.s_assert(j->>'occurrence_key' = 'date-a', 'S4 key echoed');
  j := public.ad_offering_stock(v, 'date-b');
  PERFORM pg_temp.s_assert(NOT (j->>'sold_out')::boolean AND (j->>'remaining')::int = 5,
    'S4 date B still has 5');
  j := public.ad_offering_stock(v);
  PERFORM pg_temp.s_assert(NOT (j->>'sold_out')::boolean AND (j->>'remaining')::int = 5
    AND (j->>'total')::int = 8, 'S4 all dates: 5 of 8 left');
END $s4$;

-- S5 RSVP --------------------------------------------------------------------------
DO $s5$
DECLARE v uuid; j jsonb;
BEGIN
  v := pg_temp.ev(5, 'rsvp');
  PERFORM pg_temp.dt(v, 7);
  UPDATE public.events SET rsvp_capacity = 2, rsvp_waitlist_enabled = false WHERE id = v;
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status, plus_count)
  VALUES (v, '42380000-7000-4000-8000-000000000003', 'Guest', 'going', 'approved', 1);
  j := public.ad_offering_stock(v);
  PERFORM pg_temp.s_assert(j->>'kind' = 'rsvp' AND (j->>'sold_out')::boolean
    AND (j->>'remaining')::int = 0, 'S5 full RSVP without waitlist is sold out');
  UPDATE public.events SET rsvp_waitlist_enabled = true WHERE id = v;
  j := public.ad_offering_stock(v);
  PERFORM pg_temp.s_assert(NOT (j->>'sold_out')::boolean AND (j->>'waitlist')::boolean,
    'S5 full RSVP with a waitlist is not sold out');
END $s5$;

-- S6 / S7 all free and typical price -------------------------------------------------
DO $s6$
DECLARE v uuid; j jsonb;
BEGIN
  v := pg_temp.ev(6, 'event');
  PERFORM pg_temp.dt(v, 7);
  PERFORM pg_temp.tier(v, 10, 0, true);
  PERFORM pg_temp.tier(v, 10, 0, true);
  j := public.ad_offering_stock(v);
  PERFORM pg_temp.s_assert((j->>'all_free')::boolean, 'S6 every tier free and 0 → all_free');
  PERFORM pg_temp.s_assert(j->'typical_price_cents' = 'null'::jsonb, 'S7 no paid tier → no typical price');
  v := pg_temp.ev(7, 'event');
  PERFORM pg_temp.dt(v, 7);
  PERFORM pg_temp.tier(v, 10, 0, true);
  PERFORM pg_temp.tier(v, 10, 300000);
  PERFORM pg_temp.tier(v, 10, 500000);
  PERFORM pg_temp.tier(v, 10, 900000);
  j := public.ad_offering_stock(v);
  PERFORM pg_temp.s_assert(NOT (j->>'all_free')::boolean, 'S6 one paid tier → not all_free');
  PERFORM pg_temp.s_assert((j->>'typical_price_cents')::int = 500000, 'S7 median paid price 500000');
  PERFORM pg_temp.s_assert(j->>'currency' = 'NGN', 'S7 currency');
END $s6$;

-- S8 privileges --------------------------------------------------------------------
SELECT pg_temp.s_assert(
  NOT has_function_privilege('authenticated', 'public.ad_offering_stock(uuid,text)', 'execute')
  AND NOT has_function_privilege('anon', 'public.ad_offering_stock(uuid,text)', 'execute')
  AND has_function_privilege('service_role', 'public.ad_offering_stock(uuid,text)', 'execute'),
  'S8 only service_role can execute ad_offering_stock');

-- S9 / S10 automation events -------------------------------------------------------
INSERT INTO public.ad_plans(id, client_kind, owner_kind, brand_id, destination_family, destination_key, state)
VALUES ('42380000-7000-4000-8000-000000000801', 'host', 'host', '42380000-7000-4000-8000-000000000010',
        'public_mingla_page', 'event:issue-4238-stock:stock-1', 'live');

INSERT INTO public.ad_plan_automation_events(plan_id, platform, kind, status, detail)
VALUES ('42380000-7000-4000-8000-000000000801', 'meta', 'goal_promoted', 'applied',
        '{"from":"checkout","to":"purchase"}');

DO $s9$
DECLARE k text; refused boolean;
BEGIN
  FOREACH k IN ARRAY ARRAY['goal_promoted', 'low_stock_copy', 'slow_sales_nudge'] LOOP
    IF k <> 'goal_promoted' THEN
      INSERT INTO public.ad_plan_automation_events(plan_id, platform, kind)
      VALUES ('42380000-7000-4000-8000-000000000801', 'meta', k);
    END IF;
    refused := false;
    BEGIN
      INSERT INTO public.ad_plan_automation_events(plan_id, platform, kind, status)
      VALUES ('42380000-7000-4000-8000-000000000801', 'meta', k, 'failed');
    EXCEPTION WHEN unique_violation THEN refused := true;
    END;
    PERFORM pg_temp.s_assert(refused, 'S9 a second ' || k || ' for the same plan and app is refused');
  END LOOP;
  -- Another app on the same plan is its own switch.
  INSERT INTO public.ad_plan_automation_events(plan_id, platform, kind)
  VALUES ('42380000-7000-4000-8000-000000000801', 'tiktok', 'goal_promoted');
  -- auto_paused may repeat (pause, resume, pause again).
  INSERT INTO public.ad_plan_automation_events(plan_id, platform, kind, detail)
  VALUES ('42380000-7000-4000-8000-000000000801', 'meta', 'auto_paused', '{"reason":"sold_out"}'),
         ('42380000-7000-4000-8000-000000000801', 'meta', 'auto_paused', '{"reason":"sold_out"}');
  PERFORM pg_temp.s_assert(
    (SELECT count(*) FROM public.ad_plan_automation_events
      WHERE plan_id = '42380000-7000-4000-8000-000000000801' AND kind = 'auto_paused') = 2,
    'S9 auto_paused may repeat');

  refused := false;
  BEGIN
    INSERT INTO public.ad_plan_automation_events(plan_id, platform, kind)
    VALUES ('42380000-7000-4000-8000-000000000801', 'meta', 'surprise');
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  PERFORM pg_temp.s_assert(refused, 'S10 an unknown kind is refused');
  refused := false;
  BEGIN
    INSERT INTO public.ad_plan_automation_events(plan_id, platform, kind, status)
    VALUES ('42380000-7000-4000-8000-000000000801', 'meta', 'auto_ended', 'done');
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  PERFORM pg_temp.s_assert(refused, 'S10 an unknown status is refused');
END $s9$;

SELECT pg_temp.s_assert(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ad_plan_automation_events'::regclass)
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'ad_plan_automation_events')
  AND NOT has_table_privilege('authenticated', 'public.ad_plan_automation_events', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('anon', 'public.ad_plan_automation_events', 'SELECT,INSERT,UPDATE,DELETE'),
  'S10 automation events: RLS on, no policy, no client privilege');

-- S11 result counts ----------------------------------------------------------------
SELECT pg_temp.s_assert(
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ad_spend_daily'
      AND column_name IN ('purchase_events', 'checkout_events', 'signup_events')) = 3,
  'S11 ad_spend_daily has the three result counts');

SELECT pg_temp.s_assert(
  (SELECT count(*) FROM pg_constraint c
    WHERE c.conrelid = 'public.ad_spend_daily'::regclass AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ~ '(purchase|checkout|signup)_events >= 0') = 3,
  'S11 each result count refuses negatives (CHECK >= 0)');

ROLLBACK;
