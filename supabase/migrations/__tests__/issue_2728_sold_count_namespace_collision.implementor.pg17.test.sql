-- issue #2728 implementor regression guard.
-- The lateral output alias deliberately shares `sold_count` with the later
-- ticket_types column. `c.sold_count` is load-bearing for historical replay
-- and live SQL-function startup; never remove or redirect that qualifier.

\set ON_ERROR_STOP on
\timing off

DO $preclean$
BEGIN
  DELETE FROM public.tickets
   WHERE event_id = '27280000-0000-4000-8000-000000000003'::uuid;
  DELETE FROM public.order_line_items
   WHERE order_id = '27280000-0000-4000-8000-000000000006'::uuid;
  DELETE FROM public.orders
   WHERE id = '27280000-0000-4000-8000-000000000006'::uuid;
  DELETE FROM public.ticket_types
   WHERE event_id = '27280000-0000-4000-8000-000000000003'::uuid;
  DELETE FROM public.events
   WHERE id = '27280000-0000-4000-8000-000000000003'::uuid;
  DELETE FROM public.brands
   WHERE id = '27280000-0000-4000-8000-000000000002'::uuid;
  DELETE FROM public.creator_accounts
   WHERE id IN (
     '27280000-0000-4000-8000-000000000001'::uuid,
     '27280000-0000-4000-8000-000000000009'::uuid
   );
  DELETE FROM auth.users
   WHERE id IN (
     '27280000-0000-4000-8000-000000000001'::uuid,
     '27280000-0000-4000-8000-000000000009'::uuid
   );
END $preclean$;

INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES
  ('27280000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'manager@i2728.test', 'x', now(), now()),
  ('27280000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'stranger@i2728.test', 'x', now(), now());

INSERT INTO public.creator_accounts(id)
VALUES
  ('27280000-0000-4000-8000-000000000001'),
  ('27280000-0000-4000-8000-000000000009');

INSERT INTO public.brands(id, account_id, name, slug, claim_status, pricing_currency, default_currency)
VALUES (
  '27280000-0000-4000-8000-000000000002',
  '27280000-0000-4000-8000-000000000001',
  'I2728 Brand', 'i2728-brand', 'verified', 'usd', 'USD'
);

INSERT INTO public.events(
  id, brand_id, title, slug, event_type, visibility, status, timezone, published_at, currency
) VALUES (
  '27280000-0000-4000-8000-000000000003',
  '27280000-0000-4000-8000-000000000002',
  'I2728 Trip', 'i2728-trip', 'trip', 'public', 'live', 'UTC', now(), 'usd'
);

INSERT INTO public.ticket_types(
  id, event_id, name, price_cents, currency, quantity_total, is_unlimited, is_free, deleted_at
) VALUES
  ('27280000-0000-4000-8000-000000000004', '27280000-0000-4000-8000-000000000003',
   'Live tier', 5000, 'usd', 100, false, false, NULL),
  ('27280000-0000-4000-8000-000000000005', '27280000-0000-4000-8000-000000000003',
   'Deleted tier', 5000, 'usd', 100, false, false, now());

INSERT INTO public.orders(
  id, event_id, payment_status, payment_method, source, total_cents, currency, buyer_phone_e164
) VALUES (
  '27280000-0000-4000-8000-000000000006',
  '27280000-0000-4000-8000-000000000003',
  'paid', 'apple_pay', 'online_checkout', 5000, 'usd', '+12025552728'
);

INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, status)
VALUES
  ('27280000-0000-4000-8000-000000000011', '27280000-0000-4000-8000-000000000006',
   '27280000-0000-4000-8000-000000000004', '27280000-0000-4000-8000-000000000003', 'i2728-valid', 'valid'),
  ('27280000-0000-4000-8000-000000000012', '27280000-0000-4000-8000-000000000006',
   '27280000-0000-4000-8000-000000000004', '27280000-0000-4000-8000-000000000003', 'i2728-used', 'used'),
  ('27280000-0000-4000-8000-000000000013', '27280000-0000-4000-8000-000000000006',
   '27280000-0000-4000-8000-000000000004', '27280000-0000-4000-8000-000000000003', 'i2728-transferred', 'transferred'),
  ('27280000-0000-4000-8000-000000000014', '27280000-0000-4000-8000-000000000006',
   '27280000-0000-4000-8000-000000000004', '27280000-0000-4000-8000-000000000003', 'i2728-refunded', 'refunded'),
  ('27280000-0000-4000-8000-000000000015', '27280000-0000-4000-8000-000000000006',
   '27280000-0000-4000-8000-000000000005', '27280000-0000-4000-8000-000000000003', 'i2728-deleted-tier', 'valid');

-- Deliberately forge the shadow counter. The RPC must still derive its value
-- from ticket rows until #2491 authorises a separate reader switch.
UPDATE public.ticket_types
   SET sold_count = 999
 WHERE id = '27280000-0000-4000-8000-000000000004'::uuid;

DO $assertions$
DECLARE
  v_result jsonb;
  v_definition text;
  v_acl aclitem[];
  v_owner name;
  v_language name;
  v_volatility "char";
  v_security_definer boolean;
  v_config text[];
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '27280000-0000-4000-8000-000000000001', true);
  SELECT public.biz_trip_tickets_sold_by_tier('27280000-0000-4000-8000-000000000003')
    INTO v_result;
  IF v_result IS DISTINCT FROM jsonb_build_object(
    '27280000-0000-4000-8000-000000000004', 3
  ) THEN
    RAISE EXCEPTION 'issue #2728 H2/H4: manager result was %, expected one live tier with count 3', v_result;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '27280000-0000-4000-8000-000000000009', true);
  SELECT public.biz_trip_tickets_sold_by_tier('27280000-0000-4000-8000-000000000003')
    INTO v_result;
  IF v_result IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'issue #2728 E1: unauthorised caller received %', v_result;
  END IF;

  SELECT public.biz_trip_tickets_sold_by_tier('ffffffff-ffff-4fff-8fff-ffffffff2728')
    INTO v_result;
  IF v_result IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'issue #2728 H3: nonexistent event received %', v_result;
  END IF;

  SELECT pg_get_functiondef(p.oid), p.proacl, r.rolname, l.lanname,
         p.provolatile, p.prosecdef, p.proconfig
    INTO v_definition, v_acl, v_owner, v_language, v_volatility,
         v_security_definer, v_config
  FROM pg_proc p
  JOIN pg_roles r ON r.oid = p.proowner
  JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = 'public.biz_trip_tickets_sold_by_tier(uuid)'::regprocedure;

  IF position('jsonb_object_agg(tt.id::text, c.sold_count)' IN v_definition) = 0
     OR position('FROM public.tickets t' IN v_definition) = 0
     OR position($needle$t.status IN ('valid', 'used', 'transferred')$needle$ IN v_definition) = 0
     OR position('tt.sold_count' IN v_definition) <> 0 THEN
    RAISE EXCEPTION 'issue #2728 H1/H4: shipped function lost qualified ticket-row derivation';
  END IF;
  IF v_owner <> 'postgres' OR v_language <> 'sql' OR v_volatility <> 's'
     OR v_security_definer IS DISTINCT FROM true
     OR v_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION 'issue #2728 E6: security metadata changed (owner %, lang %, vol %, definer %, config %)',
      v_owner, v_language, v_volatility, v_security_definer, v_config;
  END IF;
  IF cardinality(v_acl) <> 5
     OR NOT v_acl @> ARRAY[
       '=X/postgres'::aclitem,
       'postgres=X/postgres'::aclitem,
       'anon=X/postgres'::aclitem,
       'authenticated=X/postgres'::aclitem,
       'service_role=X/postgres'::aclitem
     ] THEN
    RAISE EXCEPTION 'issue #2728 E6: caller ACL changed: %', v_acl;
  END IF;
END $assertions$;

DO $cleanup$
BEGIN
  DELETE FROM public.tickets
   WHERE event_id = '27280000-0000-4000-8000-000000000003'::uuid;
  DELETE FROM public.order_line_items
   WHERE order_id = '27280000-0000-4000-8000-000000000006'::uuid;
  DELETE FROM public.orders
   WHERE id = '27280000-0000-4000-8000-000000000006'::uuid;
  DELETE FROM public.ticket_types
   WHERE event_id = '27280000-0000-4000-8000-000000000003'::uuid;
  DELETE FROM public.events
   WHERE id = '27280000-0000-4000-8000-000000000003'::uuid;
  DELETE FROM public.brands
   WHERE id = '27280000-0000-4000-8000-000000000002'::uuid;
  DELETE FROM public.creator_accounts
   WHERE id IN (
     '27280000-0000-4000-8000-000000000001'::uuid,
     '27280000-0000-4000-8000-000000000009'::uuid
   );
  DELETE FROM auth.users
   WHERE id IN (
     '27280000-0000-4000-8000-000000000001'::uuid,
     '27280000-0000-4000-8000-000000000009'::uuid
   );
END $cleanup$;

\echo 'issue #2728 implementor regression: PASS'
