-- #1931 MIGRATION-TIME WRITE PROBE — seed half.
--
-- Closes two gaps the independent tester found:
--   P2-1 — SC-54(b)'s "every #1931 column is NULL on every row" cannot see a
--          migration-time write, because `ticket_checkout_sessions` has ZERO rows on a
--          clean CI replay, so the assertion is vacuous.
--   P2-2 — SC-55(c)'s row-equality half cannot see a migration-time write against the
--          #1770 invitation tables, because the fixture is created AFTER the migration.
--
-- This file runs against a database replayed to the migration IMMEDIATELY BEFORE #1931
-- and COMMITS durable rows. `…verify.sql` then runs AFTER #1931 has applied and asserts
-- those rows are untouched. Both halves live in CI, so the assertion has a real subject.
--
-- Deterministic ids so the verify half can find the rows without any handshake.
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id) VALUES ('99999999-9999-4999-8999-000000000001');
INSERT INTO public.creator_accounts (id) VALUES ('99999999-9999-4999-8999-000000000001');

INSERT INTO public.brands (id, account_id, name, slug, default_currency, pricing_currency, payment_provider)
VALUES ('99999999-9999-4999-8999-000000000002', '99999999-9999-4999-8999-000000000001',
        'i1931 mtp brand', 'i1931-mtp-brand', 'NGN', 'NGN', 'paystack');

INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone, currency, published_at)
VALUES ('99999999-9999-4999-8999-000000000003', '99999999-9999-4999-8999-000000000002',
        'i1931 mtp event', 'i1931-mtp-event', 'event', 'scheduled', 'public', 'Africa/Lagos', 'NGN', now());

INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
VALUES ('99999999-9999-4999-8999-000000000003', now() + interval '5 days',
        now() + interval '5 days 3 hours', 'Africa/Lagos', true);

INSERT INTO public.ticket_types (id, event_id, name, price_cents, quantity_total, currency)
VALUES ('99999999-9999-4999-8999-000000000004', '99999999-9999-4999-8999-000000000003',
        'GA', 500000, 50, 'NGN');

-- (P2-1) A durable checkout session, so SC-54(b)'s all-NULL assertion has a real row to
-- range over after the migration instead of passing vacuously on an empty table.
INSERT INTO public.ticket_checkout_sessions
  (id, event_id, brand_id, status, total_cents, currency, idempotency_key, expires_at,
   buyer_name, buyer_email, buyer_phone_e164)
VALUES ('99999999-9999-4999-8999-000000000005', '99999999-9999-4999-8999-000000000003',
        '99999999-9999-4999-8999-000000000002', 'requires_payment', 500000, 'NGN',
        'i1931-mtp-idem', now() + interval '1 hour',
        'i1931 mtp buyer', 'i1931-mtp@example.com', '+2348012345678');

-- (P2-2) A durable, active, unexpired, UNCONSUMED #1770 invitation token and its invite.
INSERT INTO public.brand_people (id, brand_id, display_name)
VALUES ('99999999-9999-4999-8999-000000000006', '99999999-9999-4999-8999-000000000002', 'i1931 mtp person');

INSERT INTO public.brand_person_contact_methods
  (id, brand_id, brand_person_id, channel, normalized_value, provenance_scope)
VALUES ('99999999-9999-4999-8999-000000000007', '99999999-9999-4999-8999-000000000002',
        '99999999-9999-4999-8999-000000000006', 'email', 'i1931-mtp@example.com', 'brand_owned');

INSERT INTO public.brand_offering_invites
  (id, brand_id, event_id, brand_person_id, status, origin, created_by)
VALUES ('99999999-9999-4999-8999-000000000008', '99999999-9999-4999-8999-000000000002',
        '99999999-9999-4999-8999-000000000003', '99999999-9999-4999-8999-000000000006',
        'active', 'wizard', '99999999-9999-4999-8999-000000000001');

INSERT INTO public.marketing_send_groups
  (id, event_id, brand_id, purpose, client_request_id, channels, eligibility_hash,
   quote_hash, quoted_at, execution_snapshot_hash, created_by)
VALUES ('99999999-9999-4999-8999-000000000009', '99999999-9999-4999-8999-000000000003',
        '99999999-9999-4999-8999-000000000002', 'invitation', gen_random_uuid(), ARRAY['email'],
        repeat('c', 64), repeat('d', 64), now(), repeat('e', 64),
        '99999999-9999-4999-8999-000000000001');

INSERT INTO public.brand_offering_invite_delivery_attempts
  (id, invite_id, send_group_id, contact_method_id, channel, attempt_kind)
VALUES ('99999999-9999-4999-8999-00000000000a', '99999999-9999-4999-8999-000000000008',
        '99999999-9999-4999-8999-000000000009', '99999999-9999-4999-8999-000000000007',
        'email', 'initial');

INSERT INTO public.brand_offering_invite_tokens
  (id, invite_id, token_hash, contact_method_id, expires_at, delivery_attempt_id)
VALUES ('99999999-9999-4999-8999-00000000000b', '99999999-9999-4999-8999-000000000008',
        repeat('f', 64), '99999999-9999-4999-8999-000000000007',
        now() + interval '7 days', '99999999-9999-4999-8999-00000000000a');

COMMIT;
