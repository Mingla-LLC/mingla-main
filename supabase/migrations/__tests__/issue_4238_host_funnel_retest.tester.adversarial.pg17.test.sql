\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4238-HOST-FIRST-PUBLISH-TRUE-FIRST | issue #4238 | a host_publish:<owner> row is queued only for an owner's true first listing publish: any earlier published event of any brand they own (soft-deleted brand and event included) suppresses it, and a venue listing that is not verified never does.

-- Issue #4238 retest 1 (tester adversarial, pg17). Run after the full migration
-- chain as supabase_admin over 127.0.0.1. Everything runs in one rolled-back txn.
--
--   A1  an owner whose ONLY earlier published event sits on a second brand that
--       was soft-deleted (brand and event deleted_at set, rows written with
--       triggers off as in production before M-2) publishing on a new brand
--       queues nothing.
--   A2  boundary: an owner whose only other listing is a venue that is NOT
--       verified (pending_review) still gets exactly one row on their real
--       first publish (the guard does not over-suppress).

CREATE OR REPLACE FUNCTION pg_temp.ta_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 retest adversarial FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-4238-4700-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ta1-4238rt@example.test', now(), now()),
  ('00000000-4238-4700-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ta2-4238rt@example.test', now(), now());

-- A1 ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.creator_accounts (id, email, created_at)
VALUES ('00000000-4238-4700-8000-000000000001', 'ta1-4238rt@example.test', now() - interval '200 days');
INSERT INTO public.brands (id, account_id, name, slug, default_currency, deleted_at)
VALUES ('00000000-4238-4700-8000-000000000011', '00000000-4238-4700-8000-000000000001',
        'Issue 4238 RT Closed Brand', 'issue-4238-rt-closed-brand', 'USD', now() - interval '20 days');
INSERT INTO public.events (brand_id, title, slug, published_at, deleted_at)
VALUES ('00000000-4238-4700-8000-000000000011', 'Long-gone night', 'issue-4238-rt-gone-night',
        now() - interval '150 days', now() - interval '20 days');
SET LOCAL session_replication_role = origin;

INSERT INTO public.brands (id, account_id, name, slug, default_currency)
VALUES ('00000000-4238-4700-8000-000000000012', '00000000-4238-4700-8000-000000000001',
        'Issue 4238 RT Fresh Brand', 'issue-4238-rt-fresh-brand', 'USD');

DO $a1$
DECLARE
  v_event uuid;
BEGIN
  INSERT INTO public.events (brand_id, title, slug)
  VALUES ('00000000-4238-4700-8000-000000000012', 'Comeback night', 'issue-4238-rt-comeback')
  RETURNING id INTO v_event;
  UPDATE public.events SET published_at = now() WHERE id = v_event;
  PERFORM pg_temp.ta_assert(
    NOT EXISTS (SELECT 1 FROM public.ad_conversions
      WHERE event_id = 'host_publish:00000000-4238-4700-8000-000000000001'),
    'A1 an earlier publish on a soft-deleted second brand suppresses the first-publish row'
  );
END
$a1$;

-- A2 ---------------------------------------------------------------------------
INSERT INTO public.creator_accounts (id, email, created_at)
VALUES ('00000000-4238-4700-8000-000000000002', 'ta2-4238rt@example.test', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency)
VALUES ('00000000-4238-4700-8000-000000000021', '00000000-4238-4700-8000-000000000002',
        'Issue 4238 RT Venue Pending Brand', 'issue-4238-rt-venue-pending', 'USD');
INSERT INTO public.venue_listings (brand_id, slug, name, lat, lng, venue_category, claim_status)
VALUES ('00000000-4238-4700-8000-000000000021', 'issue4238rtpending', 'Issue 4238 RT Pending Venue',
        51.5, -0.12, 'restaurant', 'pending_review');

DO $a2$
DECLARE
  v_event uuid;
BEGIN
  INSERT INTO public.events (brand_id, title, slug)
  VALUES ('00000000-4238-4700-8000-000000000021', 'Real debut', 'issue-4238-rt-real-debut')
  RETURNING id INTO v_event;
  UPDATE public.events SET published_at = now() WHERE id = v_event;
  PERFORM pg_temp.ta_assert(
    (SELECT count(*) FROM public.ad_conversions
      WHERE event_id = 'host_publish:00000000-4238-4700-8000-000000000002'
        AND mingla_event_id = v_event) = 1,
    'A2 an unverified venue listing never suppresses a true first publish'
  );
END
$a2$;

ROLLBACK;
