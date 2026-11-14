\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4238-HOST-FUNNEL-ONCE | issue #4238 | each host-funnel kind is queued at most once per subject (UNIQUE ad_conversions.event_id host_signup:<uid> / host_publish:<owner>), the queueing triggers never fail the host's own write, and ad_match_contexts is service-role only.

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

ROLLBACK;
