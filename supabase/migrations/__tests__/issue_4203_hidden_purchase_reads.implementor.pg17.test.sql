-- #4203 — hidden reviewer inventory stays out of Explorer discovery while its
-- buyer/current holder can render the exact event and date behind a purchase.
-- FAILS-ON-REVERT: without the #4203 policies, the buyer/holder counts are 0;
-- if the policy is broadened, the anon/stranger counts become non-zero.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
  ('42030000-0000-4000-8000-000000000001', 'host-4203@example.test', now()),
  ('42030000-0000-4000-8000-000000000002', 'buyer-4203@example.test', now()),
  ('42030000-0000-4000-8000-000000000003', 'holder-4203@example.test', now()),
  ('42030000-0000-4000-8000-000000000004', 'stranger-4203@example.test', now());

INSERT INTO public.profiles(id, email, first_name, account_type) VALUES
  ('42030000-0000-4000-8000-000000000001', 'host-4203@example.test', 'Host', 'business'),
  ('42030000-0000-4000-8000-000000000002', 'buyer-4203@example.test', 'Buyer', 'explorer'),
  ('42030000-0000-4000-8000-000000000003', 'holder-4203@example.test', 'Holder', 'explorer'),
  ('42030000-0000-4000-8000-000000000004', 'stranger-4203@example.test', 'Stranger', 'explorer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.creator_accounts(id, email, business_name) VALUES
  ('42030000-0000-4000-8000-000000000001', 'host-4203@example.test', 'Issue 4203 Host');

INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('42030000-0000-4000-9000-000000000001', '42030000-0000-4000-8000-000000000001',
   'Issue 4203 Hidden Brand', 'issue-4203-hidden-brand', 'USD');

INSERT INTO public.events(
  id, brand_id, created_by, title, slug, event_type, status, visibility,
  timezone, theme
) VALUES (
  '42030000-0000-4000-a000-000000000001',
  '42030000-0000-4000-9000-000000000001',
  '42030000-0000-4000-8000-000000000001',
  'Issue 4203 Hidden Event', 'issue-4203-hidden-event', 'event', 'scheduled',
  'hidden', 'UTC', '{}'::jsonb
);

INSERT INTO public.event_dates(id, event_id, start_at, end_at, is_master) VALUES (
  '42030000-0000-4000-b000-000000000001',
  '42030000-0000-4000-a000-000000000001',
  now() + interval '3 days', now() + interval '3 days 4 hours', true
);

INSERT INTO public.ticket_types(
  id, event_id, name, price_cents, currency, quantity_total
) VALUES (
  '42030000-0000-4000-c000-000000000001',
  '42030000-0000-4000-a000-000000000001',
  'General', 1000, 'USD', 100
);

INSERT INTO public.orders(
  id, event_id, buyer_user_id, buyer_email, payment_status, source,
  total_cents, currency
) VALUES (
  '42030000-0000-4000-d000-000000000001',
  '42030000-0000-4000-a000-000000000001',
  '42030000-0000-4000-8000-000000000002',
  NULL, 'paid', 'manual_import', 1000, 'USD'
);

INSERT INTO public.tickets(
  id, order_id, ticket_type_id, event_id, qr_code, status, approval_status,
  holder_user_id
) VALUES (
  '42030000-0000-4000-e000-000000000001',
  '42030000-0000-4000-d000-000000000001',
  '42030000-0000-4000-c000-000000000001',
  '42030000-0000-4000-a000-000000000001',
  'issue-4203-hidden-qr', 'valid', 'auto',
  '42030000-0000-4000-8000-000000000003'
);

DO $proof$
DECLARE
  v_event constant uuid := '42030000-0000-4000-a000-000000000001';
  v_date constant uuid := '42030000-0000-4000-b000-000000000001';
  v_buyer constant uuid := '42030000-0000-4000-8000-000000000002';
  v_holder constant uuid := '42030000-0000-4000-8000-000000000003';
  v_stranger constant uuid := '42030000-0000-4000-8000-000000000004';
  v_count integer;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT count(*) INTO v_count FROM public.events WHERE id = v_event;
  IF v_count <> 0 THEN RAISE EXCEPTION 'anon_read_hidden_event:%', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.events_public_view WHERE id = v_event;
  IF v_count <> 0 THEN RAISE EXCEPTION 'public_view_listed_hidden_event:%', v_count; END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  SELECT count(*) INTO v_count FROM public.events WHERE id = v_event;
  IF v_count <> 0 THEN RAISE EXCEPTION 'stranger_read_hidden_event:%', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.event_dates WHERE id = v_date;
  IF v_count <> 0 THEN RAISE EXCEPTION 'stranger_read_hidden_date:%', v_count; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_buyer::text, true);
  SELECT count(*) INTO v_count
  FROM public.orders o
  JOIN public.events e ON e.id = o.event_id
  LEFT JOIN public.event_dates d ON d.event_id = e.id
  WHERE o.buyer_user_id = v_buyer AND e.id = v_event AND d.id = v_date;
  IF v_count <> 1 THEN RAISE EXCEPTION 'buyer_nested_purchase_missing:%', v_count; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_holder::text, true);
  SELECT count(*) INTO v_count FROM public.events WHERE id = v_event;
  IF v_count <> 1 THEN RAISE EXCEPTION 'holder_hidden_event_missing:%', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.event_dates WHERE id = v_date;
  IF v_count <> 1 THEN RAISE EXCEPTION 'holder_hidden_date_missing:%', v_count; END IF;
  RESET ROLE;
END;
$proof$;

ROLLBACK;
