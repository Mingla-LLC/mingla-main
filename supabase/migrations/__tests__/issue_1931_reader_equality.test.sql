-- #1931 SC-47 per-object BEHAVIORAL equality probe.
--
-- Amendment 4 §B.1.2 requires that, for every pre-existing object #1931 re-emits, an
-- executable test proves that with readiness false and ZERO rows in
-- event_private_media_transition_jobs the object's observable behavior is identical to
-- its landed definition. Static grep is explicitly insufficient.
--
-- This file is the probe half. It emits one deterministic result row per object over a
-- fixed fixture and is run against TWO databases:
--   (1) a database replayed to the migration IMMEDIATELY BEFORE #1931 (the landed state)
--   (2) the same database with 20270413001931 applied
-- The harness diffs the two outputs; SC-47 passes only when they are byte-identical.
--
-- It also carries the executable fixtures Amendment 4 §B.1.2 mandates #1931 ADD before
-- re-emitting the three objects that had no landed executable fixture: the `events`
-- SELECT policy, pg_public_event_by_slug, and pg_public_ticket_types_remaining.
\set ON_ERROR_STOP on
\pset pager off
\pset format unaligned
\pset tuples_only on

BEGIN;

-- Deterministic fixture. Fixed UUIDs so both runs produce identical output.
INSERT INTO auth.users (id) VALUES ('11111111-1111-4111-8111-111111111111');
INSERT INTO public.creator_accounts (id) VALUES ('11111111-1111-4111-8111-111111111111');
INSERT INTO public.brands (id, account_id, name, slug, default_currency, pricing_currency,
                           payment_provider, paystack_subaccount_code)
VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
        'i1931 eq brand', 'i1931-eq-brand', 'NGN', 'NGN', 'paystack', 'ACCT_i1931eq');

-- Full lifecycle/visibility matrix, per Amendment 4 §B.1.2: public/scheduled, hidden,
-- private, soft-deleted, and ended/cancelled rows.
INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone,
                           currency, published_at, show_on_discover, city, deleted_at)
VALUES
 ('33333333-3333-4333-8333-000000000001','22222222-2222-4222-8222-222222222222','eq pub sched','i1931-eq-pub-sched','event','scheduled','public','Africa/Lagos','NGN',now(),true,'Lagos',NULL),
 ('33333333-3333-4333-8333-000000000002','22222222-2222-4222-8222-222222222222','eq hidden','i1931-eq-hidden','event','scheduled','hidden','Africa/Lagos','NGN',now(),true,'Lagos',NULL),
 ('33333333-3333-4333-8333-000000000003','22222222-2222-4222-8222-222222222222','eq private','i1931-eq-private','event','scheduled','private','Africa/Lagos','NGN',now(),true,'Lagos',NULL),
 ('33333333-3333-4333-8333-000000000004','22222222-2222-4222-8222-222222222222','eq deleted','i1931-eq-deleted','event','scheduled','public','Africa/Lagos','NGN',now(),true,'Lagos',now()),
 ('33333333-3333-4333-8333-000000000005','22222222-2222-4222-8222-222222222222','eq ended','i1931-eq-ended','event','ended','public','Africa/Lagos','NGN',now(),true,'Lagos',NULL),
 ('33333333-3333-4333-8333-000000000006','22222222-2222-4222-8222-222222222222','eq cancelled','i1931-eq-cancelled','event','cancelled','public','Africa/Lagos','NGN',now(),true,'Lagos',NULL);

INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
SELECT id, '2030-01-01T18:00:00Z'::timestamptz, '2030-01-01T22:00:00Z'::timestamptz, 'Africa/Lagos', true
  FROM public.events WHERE slug LIKE 'i1931-eq-%';

INSERT INTO public.ticket_types (id, event_id, name, price_cents, quantity_total, currency)
SELECT ('44444444-4444-4444-8444-'||lpad(row_number() OVER (ORDER BY e.slug)::text, 12, '0'))::uuid,
       e.id, 'GA', 500000, 100, 'NGN'
  FROM public.events e WHERE e.slug LIKE 'i1931-eq-%';

-- ---------------------------------------------------------------------------------
-- Probe. One line per (object, role, event). Ordered deterministically.
-- ---------------------------------------------------------------------------------

\echo '--- OBJ events_select_policy (anon) ---'
SET LOCAL ROLE anon;
SELECT 'events_policy|anon|'||slug FROM public.events WHERE slug LIKE 'i1931-eq-%' ORDER BY slug;
RESET ROLE;

\echo '--- OBJ events_select_policy (authenticated) ---'
SET LOCAL ROLE authenticated;
SELECT 'events_policy|auth|'||slug FROM public.events WHERE slug LIKE 'i1931-eq-%' ORDER BY slug;
RESET ROLE;

\echo '--- OBJ events_public_view ---'
SET LOCAL ROLE anon;
SELECT 'events_public_view|anon|'||slug FROM public.events_public_view WHERE slug LIKE 'i1931-eq-%' ORDER BY slug;
RESET ROLE;

\echo '--- OBJ business_public_events_view ---'
SET LOCAL ROLE anon;
SELECT 'bpev|anon|'||slug||'|'||coalesce(brand_slug,'-')
  FROM public.business_public_events_view WHERE slug LIKE 'i1931-eq-%' ORDER BY slug;
RESET ROLE;

\echo '--- OBJ pg_public_event_by_slug ---'
SET LOCAL ROLE anon;
SELECT 'by_slug|anon|'||s||'|'||coalesce((public.pg_public_event_by_slug('i1931-eq-brand', s))::text,'NULL')
  FROM unnest(ARRAY['i1931-eq-pub-sched','i1931-eq-hidden','i1931-eq-private',
                    'i1931-eq-deleted','i1931-eq-ended','i1931-eq-cancelled']) s ORDER BY s;
RESET ROLE;

\echo '--- OBJ pg_direct_event_checkout_bundle ---'
SET LOCAL ROLE anon;
SELECT 'bundle|anon|'||e.slug||'|'||coalesce((public.pg_direct_event_checkout_bundle(e.id,NULL,NULL))::text,'NULL')
  FROM public.events e WHERE e.slug LIKE 'i1931-eq-%' ORDER BY e.slug;
RESET ROLE;

\echo '--- OBJ pg_discover_business_events ---'
SET LOCAL ROLE anon;
SELECT 'discover|anon|'||coalesce(x->>'slug','-')
  FROM jsonb_array_elements(coalesce(public.pg_discover_business_events(
        ARRAY['Lagos'],'2029-01-01T00:00:00Z'::timestamptz,'2031-01-01T00:00:00Z'::timestamptz,
        NULL,NULL,NULL,0,50,NULL,NULL,NULL)->'rows','[]'::jsonb)) x
 WHERE x->>'slug' LIKE 'i1931-eq-%' ORDER BY 1;
RESET ROLE;

\echo '--- OBJ pg_public_ticket_types_remaining ---'
SET LOCAL ROLE anon;
SELECT 'ttr|anon|'||e.slug||'|'||coalesce(r.sold::text,'-')||'|'||coalesce(r.remaining::text,'-')
  FROM public.events e
  LEFT JOIN LATERAL public.pg_public_ticket_types_remaining(e.id) r ON true
 WHERE e.slug LIKE 'i1931-eq-%' ORDER BY e.slug;
RESET ROLE;

\echo '--- OBJ pg_public_social_proof ---'
SET LOCAL ROLE anon;
SELECT 'social|anon|'||e.slug||'|'||coalesce((public.pg_public_social_proof(e.id))::text,'NULL')
  FROM public.events e WHERE e.slug LIKE 'i1931-eq-%' ORDER BY e.slug;
RESET ROLE;

\echo '--- OBJ pg_public_brand_upcoming ---'
SET LOCAL ROLE anon;
SELECT 'upcoming|anon|'||coalesce(u.offering_slug,'-')
  FROM public.pg_public_brand_upcoming('i1931-eq-brand','2029-01-01T00:00:00Z'::timestamptz,50) u
 ORDER BY 1;
RESET ROLE;

\echo '--- OBJ biz_ticket_checkout_create_session ---'
DO $probe$
DECLARE
  e record;
  v_out text;
BEGIN
  FOR e IN SELECT id, slug FROM public.events WHERE slug LIKE 'i1931-eq-%' ORDER BY slug LOOP
    BEGIN
      PERFORM public.biz_ticket_checkout_create_session(
        e.id, NULL, 'eq buyer', 'eq@example.com', '+2348012345678', false,
        jsonb_build_array(jsonb_build_object(
          'ticketTypeId', (SELECT tt.id FROM public.ticket_types tt WHERE tt.event_id = e.id LIMIT 1),
          'quantity', 1)),
        'i1931-eq-'||e.slug, now() + interval '30 minutes', 0, 'auto');
      v_out := 'ADMITTED';
    EXCEPTION WHEN OTHERS THEN
      v_out := 'DENIED:'||SQLERRM;
    END;
    RAISE NOTICE 'checkout|%|%', e.slug, v_out;
  END LOOP;
END $probe$;

ROLLBACK;
