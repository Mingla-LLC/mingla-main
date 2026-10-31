-- MINGLA-INVARIANT: I-4203-HIDDEN-PURCHASE-OWNERSHIP | issue #4203 | Hidden events and their dates are readable only to their buyer/current ticket holder plus existing Host readers; they remain absent from public Explorer discovery.
-- MINGLA-INVARIANT: I-4202-RETAINED-PURCHASE-RECONNECT | issue #4202 | Re-registration with a server-verified purchase email or phone reconnects retained ended/cancelled purchase history without granting admission, joining chats or making the event public.
-- MINGLA-INVARIANT: I-4202-EXPLORER-DELETE-FREES-PHONE | issue #4202 | Explorer deletion removes the GoTrue phone identity and verified-phone ledger while preserving email/social identities and any retained Business login.
-- #4203 — hidden reviewer inventory stays out of Explorer discovery while its
-- buyer/current holder can render the exact event and date behind a purchase.
-- FAILS-ON-REVERT: without the #4203 policies, the buyer/holder counts are 0;
-- if the policy is broadened, the anon/stranger counts become non-zero.
\set ON_ERROR_STOP on
BEGIN;

DO $proof$
DECLARE
  v_source text;
BEGIN
  SELECT p.prosrc
    INTO v_source
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'consumer_can_read_event_for_caller'
     AND pg_get_function_identity_arguments(p.oid) = 'p_event_id uuid';

  IF position('to_jsonb(t)->>''holder_user_id''' IN coalesce(v_source, '')) = 0 THEN
    RAISE EXCEPTION
      '#4203 replay compatibility: current-holder access must tolerate the pre-send-to-friend schema';
  END IF;
END;
$proof$;

-- The bare Supabase PostgreSQL image deliberately carries only the auth.users
-- stub columns shared with production; mailbox proof for this test comes from
-- account_claim_contacts below, not from a hosted-GoTrue-only confirmation
-- column.
INSERT INTO auth.users(id, email) VALUES
  ('42030000-0000-4000-8000-000000000001', 'host-4203@example.test'),
  ('42030000-0000-4000-8000-000000000002', 'buyer-4203@example.test'),
  ('42030000-0000-4000-8000-000000000003', 'holder-4203@example.test'),
  ('42030000-0000-4000-8000-000000000004', 'stranger-4203@example.test');

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

-- The Explorer-only account that originally owned this order was deleted, so
-- the FK has already set buyer_user_id to NULL. Its retained buyer contact is
-- the durable bridge to a replacement account that proves the same mailbox.
INSERT INTO public.account_claim_contacts(
  user_id, channel, value, verified_via
) VALUES (
  '42030000-0000-4000-8000-000000000002',
  'email', 'buyer-4203@example.test', 'email_code'
);

INSERT INTO public.events(
  id, brand_id, created_by, title, slug, event_type, status, visibility,
  timezone, theme
) VALUES (
  '42030000-0000-4000-a000-000000000002',
  '42030000-0000-4000-9000-000000000001',
  '42030000-0000-4000-8000-000000000001',
  'Issue 4202 Retained Event', 'issue-4202-retained-event', 'event', 'ended',
  'hidden', 'UTC', '{}'::jsonb
);

INSERT INTO public.event_dates(id, event_id, start_at, end_at, is_master) VALUES (
  '42030000-0000-4000-b000-000000000002',
  '42030000-0000-4000-a000-000000000002',
  now() - interval '1 year', now() - interval '1 year' + interval '4 hours', true
);

INSERT INTO public.ticket_types(
  id, event_id, name, price_cents, currency, quantity_total
) VALUES (
  '42030000-0000-4000-c000-000000000002',
  '42030000-0000-4000-a000-000000000002',
  'Archive General', 2000, 'USD', 100
);

INSERT INTO public.orders(
  id, event_id, buyer_user_id, buyer_email, payment_status, source,
  total_cents, currency
) VALUES (
  '42030000-0000-4000-d000-000000000002',
  '42030000-0000-4000-a000-000000000002',
  NULL, 'buyer-4203@example.test', 'paid', 'manual_import', 2000, 'USD'
);

INSERT INTO public.tickets(
  id, order_id, ticket_type_id, event_id, qr_code, status, approval_status
) VALUES (
  '42030000-0000-4000-e000-000000000002',
  '42030000-0000-4000-d000-000000000002',
  '42030000-0000-4000-c000-000000000002',
  '42030000-0000-4000-a000-000000000002',
  'issue-4202-retained-qr', 'used', 'auto'
);

DO $reconnect$
DECLARE
  v_count integer;
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.issue_4202_reconnect_retained_orders(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated_can_execute_history_reconnect';
  END IF;

  SELECT public.issue_4202_reconnect_retained_orders(
    '42030000-0000-4000-8000-000000000004'
  ) INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unproved_stranger_reconnected_history:%', v_count;
  END IF;

  SELECT public.issue_4202_reconnect_retained_orders(
    '42030000-0000-4000-8000-000000000002'
  ) INTO v_count;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'verified_buyer_history_not_reconnected:%', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = '42030000-0000-4000-d000-000000000002'
       AND buyer_user_id = '42030000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'retained_order_owner_missing_after_reconnect';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tickets
     WHERE id = '42030000-0000-4000-e000-000000000002'
       AND status = 'used'
       AND holder_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'history_reconnect_changed_ticket_authority';
  END IF;
END;
$reconnect$;

DO $proof$
DECLARE
  v_event constant uuid := '42030000-0000-4000-a000-000000000001';
  v_date constant uuid := '42030000-0000-4000-b000-000000000001';
  v_buyer constant uuid := '42030000-0000-4000-8000-000000000002';
  v_holder constant uuid := '42030000-0000-4000-8000-000000000003';
  v_stranger constant uuid := '42030000-0000-4000-8000-000000000004';
  v_retained_event constant uuid := '42030000-0000-4000-a000-000000000002';
  v_count integer;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT count(*) INTO v_count FROM public.events WHERE id = v_event;
  IF v_count <> 0 THEN RAISE EXCEPTION 'anon_read_hidden_event:%', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.events_public_view WHERE id = v_event;
  IF v_count <> 0 THEN RAISE EXCEPTION 'public_view_listed_hidden_event:%', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.events_public_view WHERE id = v_retained_event;
  IF v_count <> 0 THEN RAISE EXCEPTION 'public_view_listed_retained_hidden_event:%', v_count; END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  SELECT count(*) INTO v_count FROM public.events WHERE id = v_event;
  IF v_count <> 0 THEN RAISE EXCEPTION 'stranger_read_hidden_event:%', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.event_dates WHERE id = v_date;
  IF v_count <> 0 THEN RAISE EXCEPTION 'stranger_read_hidden_date:%', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.events WHERE id = v_retained_event;
  IF v_count <> 0 THEN RAISE EXCEPTION 'stranger_read_retained_hidden_event:%', v_count; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_buyer::text, true);
  SELECT count(*) INTO v_count
  FROM public.orders o
  JOIN public.events e ON e.id = o.event_id
  LEFT JOIN public.event_dates d ON d.event_id = e.id
  WHERE o.buyer_user_id = v_buyer AND e.id = v_event AND d.id = v_date;
  IF v_count <> 1 THEN RAISE EXCEPTION 'buyer_nested_purchase_missing:%', v_count; END IF;
  SELECT count(*) INTO v_count
  FROM public.orders o
  JOIN public.events e ON e.id = o.event_id
  WHERE o.buyer_user_id = v_buyer AND e.id = v_retained_event;
  IF v_count <> 1 THEN RAISE EXCEPTION 'buyer_retained_purchase_missing:%', v_count; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_holder::text, true);
  SELECT count(*) INTO v_count FROM public.events WHERE id = v_event;
  IF v_count <> 1 THEN RAISE EXCEPTION 'holder_hidden_event_missing:%', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.event_dates WHERE id = v_date;
  IF v_count <> 1 THEN RAISE EXCEPTION 'holder_hidden_date_missing:%', v_count; END IF;
  RESET ROLE;
END;
$proof$;

-- #4202 — the service-role-only release boundary removes the phone identity
-- and Mingla possession ledger together without touching the email identity.
-- The production GoTrue schema owns auth.identities. The full-history CI image
-- intentionally carries only auth.users, so give this transaction the minimum
-- compatible identity table needed to execute the production function body.
CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  provider_id text NOT NULL,
  identity_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO auth.users(id, email) VALUES (
  '42020000-0000-4000-8000-000000000099',
  'release-4202@example.test'
);

INSERT INTO auth.identities(user_id, provider, provider_id, identity_data)
VALUES
  (
    '42020000-0000-4000-8000-000000000099',
    'email',
    'release-4202@example.test',
    '{"email":"release-4202@example.test","email_verified":true}'::jsonb
  ),
  (
    '42020000-0000-4000-8000-000000000099',
    'phone',
    '32466178389',
    '{"phone":"32466178389","phone_verified":true}'::jsonb
  );

INSERT INTO public.verified_phone_identities(user_id, phone_e164)
VALUES (
  '42020000-0000-4000-8000-000000000099',
  '+32466178389'
);

SELECT public.release_explorer_phone_identity(
  '42020000-0000-4000-8000-000000000099'
);

DO $phone_release$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth.identities
    WHERE user_id = '42020000-0000-4000-8000-000000000099'
      AND provider = 'phone'
  ) THEN
    RAISE EXCEPTION '#4202: phone identity survived release';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.identities
    WHERE user_id = '42020000-0000-4000-8000-000000000099'
      AND provider = 'email'
  ) THEN
    RAISE EXCEPTION '#4202: retained email identity was removed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.verified_phone_identities
    WHERE user_id = '42020000-0000-4000-8000-000000000099'
  ) THEN
    RAISE EXCEPTION '#4202: verified-phone ledger survived release';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.release_explorer_phone_identity(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.release_explorer_phone_identity(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION '#4202: client role can release a phone identity';
  END IF;
END;
$phone_release$;

ROLLBACK;
