\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4238-HOST-FUNNEL-ONCE | issue #4238 | each host-funnel kind is queued at most once per subject (UNIQUE ad_conversions.event_id host_signup:<uid> / host_publish:<owner>), the queueing triggers never fail the host's own write, and ad_match_contexts is service-role only.
-- MINGLA-INVARIANT: I-4238-HOST-FIRST-PUBLISH-TRUE-FIRST | issue #4238 | a host's first-publish conversion is queued only for a true first publish: an earlier publish on a soft-deleted brand still suppresses it, and an unverified (pending_review) venue listing never suppresses it.

-- Issue #4238 Wave 3 (M-2) — run after the full migration chain on PostgreSQL 17
-- as supabase_admin over 127.0.0.1. Everything runs in one rolled-back txn.
--
--   F1  ad_match_contexts: RLS on, no policy, no anon/authenticated privilege.
--   F2  a creator_accounts insert queues exactly one pending host_signup row
--       with the SHA-256 of the trimmed, lower-cased email.
--   F3  the first publish queues one host_publish:<owner> row; a second
--       publish, an unpublish + re-publish and a second event add nothing.
--   F4  a failing conversion insert never fails the publish (catch-all).
--   F5  the event_type CHECK accepts the host kinds and refuses unknown ones.
--   F6  authenticated cannot read or write ad_match_contexts.
--   F7  (P1-3) an EXISTING host, who published before M-2 (triggers off, as
--       production is today), publishing again queues nothing.
--   F8  (P1-3) an existing host whose only listing is a verified venue
--       queues nothing on their first event publish.
--   F9  (P1-3) a brand-new host publishing on insert queues exactly one row,
--       and their next publish on a second brand adds none.
--   F10 (P1-4/P2-4) appsflyer_devices.tracking_opt_out exists, defaults to
--       false, and a signed-in user can switch it on their own row only.

CREATE OR REPLACE FUNCTION pg_temp.hf_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 host-funnel FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

BEGIN;

-- F1 ---------------------------------------------------------------------------
SELECT pg_temp.hf_assert(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ad_match_contexts'::regclass),
  'F1 ad_match_contexts has RLS enabled'
);
SELECT pg_temp.hf_assert(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ad_match_contexts'
  ),
  'F1 ad_match_contexts has no client policy'
);
SELECT pg_temp.hf_assert(
  NOT has_table_privilege('anon', 'public.ad_match_contexts', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated', 'public.ad_match_contexts', 'SELECT,INSERT,UPDATE,DELETE'),
  'F1 anon and authenticated hold no privilege on ad_match_contexts'
);

-- Fixtures ----------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-4238-4300-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'host-4238w3@example.test', now(), now()),
  ('00000000-4238-4300-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'host2-4238w3@example.test', now(), now());

-- F2 ---------------------------------------------------------------------------
INSERT INTO public.creator_accounts (id, email, created_at)
VALUES ('00000000-4238-4300-8000-000000000001', '  Host-4238W3@Example.TEST ', now());

SELECT pg_temp.hf_assert(
  (SELECT count(*) FROM public.ad_conversions
    WHERE event_id = 'host_signup:00000000-4238-4300-8000-000000000001') = 1,
  'F2 a new host queues exactly one host_signup row'
);
SELECT pg_temp.hf_assert(
  (SELECT event_type = 'host_signup'
      AND meta_capi_status = 'pending' AND tiktok_events_status = 'pending'
      AND snap_capi_status = 'pending' AND reddit_capi_status = 'pending'
      AND google_ads_status = 'pending'
      AND lane = 'consumer'
      AND hashed_email = encode(sha256(convert_to('host-4238w3@example.test', 'UTF8')), 'hex')
    FROM public.ad_conversions
    WHERE event_id = 'host_signup:00000000-4238-4300-8000-000000000001'),
  'F2 the row is pending on every channel with the normalised email hash'
);

-- A host whose account row is deleted and re-created never queues a second one.
DELETE FROM public.creator_accounts WHERE id = '00000000-4238-4300-8000-000000000001';
INSERT INTO public.creator_accounts (id, email, created_at)
VALUES ('00000000-4238-4300-8000-000000000001', 'host-4238w3@example.test', now());
SELECT pg_temp.hf_assert(
  (SELECT count(*) FROM public.ad_conversions
    WHERE event_id = 'host_signup:00000000-4238-4300-8000-000000000001') = 1,
  'F2 a re-created account row still has one host_signup row'
);

-- F3 ---------------------------------------------------------------------------
INSERT INTO public.brands (id, account_id, name, slug, default_currency)
VALUES ('00000000-4238-4300-8000-000000000011', '00000000-4238-4300-8000-000000000001',
        'Issue 4238 Host Brand', 'issue-4238-host-brand', 'USD');

DO $f3$
DECLARE
  v_brand uuid := '00000000-4238-4300-8000-000000000011';
  v_event uuid;
  v_event2 uuid;
BEGIN
  INSERT INTO public.events (brand_id, title, slug)
  VALUES (v_brand, 'Draft night', 'issue-4238-draft-night') RETURNING id INTO v_event;
  PERFORM pg_temp.hf_assert(
    NOT EXISTS (SELECT 1 FROM public.ad_conversions
      WHERE event_id = 'host_publish:00000000-4238-4300-8000-000000000001'),
    'F3 a draft queues nothing'
  );

  UPDATE public.events SET published_at = now() WHERE id = v_event;
  PERFORM pg_temp.hf_assert(
    (SELECT count(*) FROM public.ad_conversions
      WHERE event_id = 'host_publish:00000000-4238-4300-8000-000000000001'
        AND event_type = 'host_first_publish'
        AND brand_id = v_brand AND mingla_event_id = v_event) = 1,
    'F3 the first publish queues one host_publish row for the owner'
  );

  UPDATE public.events SET published_at = now() + interval '1 minute' WHERE id = v_event;
  UPDATE public.events SET published_at = NULL WHERE id = v_event;
  UPDATE public.events SET published_at = now() WHERE id = v_event;
  INSERT INTO public.events (brand_id, title, slug, published_at)
  VALUES (v_brand, 'Second night', 'issue-4238-second-night', now()) RETURNING id INTO v_event2;
  PERFORM pg_temp.hf_assert(
    (SELECT count(*) FROM public.ad_conversions
      WHERE event_id LIKE 'host_publish:%'
        AND event_id = 'host_publish:00000000-4238-4300-8000-000000000001') = 1
    AND (SELECT mingla_event_id FROM public.ad_conversions
      WHERE event_id = 'host_publish:00000000-4238-4300-8000-000000000001') = v_event,
    'F3 a re-publish, an unpublish + re-publish and a second event add no row'
  );
END
$f3$;

-- F4 ---------------------------------------------------------------------------
INSERT INTO public.creator_accounts (id, email, created_at)
VALUES ('00000000-4238-4300-8000-000000000002', NULL, now());
SELECT pg_temp.hf_assert(
  (SELECT hashed_email IS NULL FROM public.ad_conversions
    WHERE event_id = 'host_signup:00000000-4238-4300-8000-000000000002'),
  'F4 a host with no email queues a row with no email hash'
);
INSERT INTO public.brands (id, account_id, name, slug, default_currency)
VALUES ('00000000-4238-4300-8000-000000000012', '00000000-4238-4300-8000-000000000002',
        'Issue 4238 Host Brand Two', 'issue-4238-host-brand-two', 'USD');

ALTER TABLE public.ad_conversions
  ADD CONSTRAINT issue_4238_probe_refuse_publish CHECK (event_id NOT LIKE 'host_publish:%') NOT VALID;
DO $f4$
DECLARE
  v_event uuid;
BEGIN
  INSERT INTO public.events (brand_id, title, slug)
  VALUES ('00000000-4238-4300-8000-000000000012', 'Probe night', 'issue-4238-probe-night')
  RETURNING id INTO v_event;
  UPDATE public.events SET published_at = now() WHERE id = v_event;
  PERFORM pg_temp.hf_assert(
    (SELECT published_at IS NOT NULL FROM public.events WHERE id = v_event),
    'F4 a failing conversion insert does not fail the publish'
  );
  PERFORM pg_temp.hf_assert(
    NOT EXISTS (SELECT 1 FROM public.ad_conversions
      WHERE event_id = 'host_publish:00000000-4238-4300-8000-000000000002'),
    'F4 and queues nothing'
  );
END
$f4$;
ALTER TABLE public.ad_conversions DROP CONSTRAINT issue_4238_probe_refuse_publish;

-- F5 ---------------------------------------------------------------------------
DO $f5$
DECLARE
  v_refused boolean := false;
BEGIN
  INSERT INTO public.ad_conversions (event_id, event_type, event_name, surface, lane)
  VALUES ('host_sale:00000000-4238-4300-8000-000000000001', 'host_first_sale',
          'HostFirstTicketSold', 'web', 'consumer');
  PERFORM pg_temp.hf_assert(true, 'F5 host_first_sale is an allowed event_type');
  BEGIN
    INSERT INTO public.ad_conversions (event_id, event_type, event_name, surface, lane)
    VALUES ('bogus:1', 'host_bogus', 'Bogus', 'web', 'consumer');
  EXCEPTION WHEN check_violation THEN
    v_refused := true;
  END;
  PERFORM pg_temp.hf_assert(v_refused, 'F5 an unknown event_type is refused');
END
$f5$;

-- F6 ---------------------------------------------------------------------------
INSERT INTO public.ad_match_contexts (subject_type, subject_id, click_id, surface)
VALUES ('host_user', '00000000-4238-4300-8000-000000000001', 'click-4238', 'web');

DO $f6$
DECLARE
  v_read_refused boolean := false;
  v_write_refused boolean := false;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-4238-4300-8000-000000000001","role":"authenticated"}', true);
  BEGIN
    PERFORM 1 FROM public.ad_match_contexts;
  EXCEPTION WHEN insufficient_privilege THEN
    v_read_refused := true;
  END;
  BEGIN
    INSERT INTO public.ad_match_contexts (subject_type, subject_id)
    VALUES ('host_user', '00000000-4238-4300-8000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN
    v_write_refused := true;
  END;
  RESET ROLE;
  PERFORM pg_temp.hf_assert(v_read_refused, 'F6 authenticated cannot read ad_match_contexts');
  PERFORM pg_temp.hf_assert(v_write_refused, 'F6 authenticated cannot write ad_match_contexts');
END
$f6$;

SELECT pg_temp.hf_assert(
  (SELECT count(*) FROM public.ad_match_contexts
    WHERE subject_type = 'host_user' AND subject_id = '00000000-4238-4300-8000-000000000001') = 1,
  'F6 the service-side row is intact'
);

-- F7 ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-4238-4300-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'host3-4238w3@example.test', now(), now()),
  ('00000000-4238-4300-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'host4-4238w3@example.test', now(), now()),
  ('00000000-4238-4300-8000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'host5-4238w3@example.test', now(), now());

-- Legacy rows written with every trigger off, exactly what exists in
-- production before M-2: the host, their brand and an already-published event.
SET LOCAL session_replication_role = replica;
INSERT INTO public.creator_accounts (id, email, created_at)
VALUES ('00000000-4238-4300-8000-000000000003', 'host3-4238w3@example.test', now() - interval '90 days');
INSERT INTO public.brands (id, account_id, name, slug, default_currency)
VALUES ('00000000-4238-4300-8000-000000000013', '00000000-4238-4300-8000-000000000003',
        'Issue 4238 Legacy Host Brand', 'issue-4238-legacy-host-brand', 'USD');
INSERT INTO public.events (brand_id, title, slug, published_at)
VALUES ('00000000-4238-4300-8000-000000000013', 'Old night', 'issue-4238-old-night',
        now() - interval '60 days');
SET LOCAL session_replication_role = origin;

DO $f7$
DECLARE
  v_event uuid;
BEGIN
  INSERT INTO public.events (brand_id, title, slug)
  VALUES ('00000000-4238-4300-8000-000000000013', 'New night', 'issue-4238-new-night')
  RETURNING id INTO v_event;
  UPDATE public.events SET published_at = now() WHERE id = v_event;
  INSERT INTO public.events (brand_id, title, slug, published_at)
  VALUES ('00000000-4238-4300-8000-000000000013', 'Insert night', 'issue-4238-insert-night', now());
  PERFORM pg_temp.hf_assert(
    NOT EXISTS (SELECT 1 FROM public.ad_conversions
      WHERE event_id = 'host_publish:00000000-4238-4300-8000-000000000003'),
    'F7 an existing host who published before M-2 queues no first-publish row'
  );
END
$f7$;

-- F8 ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.creator_accounts (id, email, created_at)
VALUES ('00000000-4238-4300-8000-000000000004', 'host4-4238w3@example.test', now() - interval '30 days');
INSERT INTO public.brands (id, account_id, name, slug, default_currency)
VALUES ('00000000-4238-4300-8000-000000000014', '00000000-4238-4300-8000-000000000004',
        'Issue 4238 Venue Host Brand', 'issue-4238-venue-host-brand', 'USD');
INSERT INTO public.venue_listings (brand_id, slug, name, lat, lng, venue_category, claim_status)
VALUES ('00000000-4238-4300-8000-000000000014', 'issue4238venue', 'Issue 4238 Venue',
        51.5, -0.12, 'restaurant', 'verified');
SET LOCAL session_replication_role = origin;

DO $f8$
DECLARE
  v_event uuid;
BEGIN
  INSERT INTO public.events (brand_id, title, slug)
  VALUES ('00000000-4238-4300-8000-000000000014', 'Venue night', 'issue-4238-venue-night')
  RETURNING id INTO v_event;
  UPDATE public.events SET published_at = now() WHERE id = v_event;
  PERFORM pg_temp.hf_assert(
    NOT EXISTS (SELECT 1 FROM public.ad_conversions
      WHERE event_id = 'host_publish:00000000-4238-4300-8000-000000000004'),
    'F8 a host with a verified venue listing queues no first-publish row'
  );
END
$f8$;

-- F9 ---------------------------------------------------------------------------
INSERT INTO public.creator_accounts (id, email, created_at)
VALUES ('00000000-4238-4300-8000-000000000005', 'host5-4238w3@example.test', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency)
VALUES
  ('00000000-4238-4300-8000-000000000015', '00000000-4238-4300-8000-000000000005',
   'Issue 4238 New Host Brand', 'issue-4238-new-host-brand', 'USD'),
  ('00000000-4238-4300-8000-000000000016', '00000000-4238-4300-8000-000000000005',
   'Issue 4238 New Host Brand Two', 'issue-4238-new-host-brand-two', 'USD');

DO $f9$
DECLARE
  v_event uuid;
BEGIN
  INSERT INTO public.events (brand_id, title, slug, published_at)
  VALUES ('00000000-4238-4300-8000-000000000015', 'Debut night', 'issue-4238-debut-night', now())
  RETURNING id INTO v_event;
  PERFORM pg_temp.hf_assert(
    (SELECT count(*) FROM public.ad_conversions
      WHERE event_id = 'host_publish:00000000-4238-4300-8000-000000000005'
        AND mingla_event_id = v_event) = 1,
    'F9 a brand-new host publishing on insert queues exactly one row'
  );
  INSERT INTO public.events (brand_id, title, slug, published_at)
  VALUES ('00000000-4238-4300-8000-000000000016', 'Other brand night', 'issue-4238-other-brand-night', now());
  PERFORM pg_temp.hf_assert(
    (SELECT count(*) FROM public.ad_conversions
      WHERE event_id = 'host_publish:00000000-4238-4300-8000-000000000005') = 1
    AND (SELECT mingla_event_id FROM public.ad_conversions
      WHERE event_id = 'host_publish:00000000-4238-4300-8000-000000000005') = v_event,
    'F9 the new host publishing on a second brand adds no row'
  );
END
$f9$;

-- F10 --------------------------------------------------------------------------
SELECT pg_temp.hf_assert(
  (SELECT is_nullable = 'NO' AND column_default = 'false'
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appsflyer_devices'
      AND column_name = 'tracking_opt_out'),
  'F10 appsflyer_devices.tracking_opt_out is NOT NULL DEFAULT false'
);
INSERT INTO public.appsflyer_devices (user_id, appsflyer_uid, platform, app_id, app)
VALUES
  ('00000000-4238-4300-8000-000000000001', 'af-4238-own', 'ios', 'id1', 'business'),
  ('00000000-4238-4300-8000-000000000002', 'af-4238-other', 'ios', 'id1', 'business');
SELECT pg_temp.hf_assert(
  (SELECT tracking_opt_out = false FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-4238-own'),
  'F10 an app that never sends the column keeps false'
);
DO $f10$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-4238-4300-8000-000000000001","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-4238-4300-8000-000000000001', true);
  UPDATE public.appsflyer_devices SET tracking_opt_out = true WHERE app = 'business';
  RESET ROLE;
  PERFORM pg_temp.hf_assert(
    (SELECT tracking_opt_out FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-4238-own')
    AND NOT (SELECT tracking_opt_out FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-4238-other'),
    'F10 a user switches their own install only'
  );
END
$f10$;

-- Tester retest 1 (#4238, I-4238-HOST-FIRST-PUBLISH-TRUE-FIRST): T1 an earlier publish on a
-- soft-deleted second brand (brand and event deleted_at set) suppresses the first-publish row;
-- T2 an unverified (pending_review) venue listing never suppresses a true first publish.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-4238-4700-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ta1-4238rt@example.test', now(), now()),
  ('00000000-4238-4700-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ta2-4238rt@example.test', now(), now());

-- T1 (tester retest 1) ---------------------------------------------------------------------------
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
  PERFORM pg_temp.hf_assert(
    NOT EXISTS (SELECT 1 FROM public.ad_conversions
      WHERE event_id = 'host_publish:00000000-4238-4700-8000-000000000001'),
    'T1 an earlier publish on a soft-deleted second brand suppresses the first-publish row'
  );
END
$a1$;

-- T2 (tester retest 1) ---------------------------------------------------------------------------
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
  PERFORM pg_temp.hf_assert(
    (SELECT count(*) FROM public.ad_conversions
      WHERE event_id = 'host_publish:00000000-4238-4700-8000-000000000002'
        AND mingla_event_id = v_event) = 1,
    'T2 an unverified venue listing never suppresses a true first publish'
  );
END
$a2$;

ROLLBACK;
