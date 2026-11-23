-- #4572 item 5 data (D8): 20281129604572_issue_4572_repair_joined_venue_names.sql, PostgreSQL 17
-- proof after the full replay (where production rows are absent, so the migration itself ran as
-- a 0/0 no-op). This suite seeds the production shape (4 class-A live rows, 2 class-D drafts, one
-- class-B and one class-C row) inside a transaction, runs the migration file again, and checks:
--   R-1 the 4 class-A rows: venueName loses the address suffix; location_text shows the address once.
--   R-2 the 2 class-D drafts: venueName and address are split into two fields; location_text unchanged.
--   R-3 class B and C rows are untouched (adversarial).
--   R-4 no guest "event changed" notice is queued or recorded, and the #3827 trigger is enabled again.
--   R-5 a second run changes 0 rows (no-op).
--   R-6 a production that no longer matches the reviewed counts (one more class-A row) is refused.
--
-- FAILS-ON-REVERT: delete the DISABLE/ENABLE TRIGGER lines → R-4 fails (an edit notice is recorded
-- at commit time, checked here with SET CONSTRAINTS ALL IMMEDIATE); delete the class-A UPDATE → R-1 fails.

\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.ok(p_ok boolean, p_label text, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4572 FAIL: % (%)', p_label, COALESCE(p_detail, '<null>');
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

CREATE FUNCTION pg_temp.u(p_tag text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5('i4572r:' || p_tag)::uuid $fn$;

INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES (pg_temp.u('owner'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'owner@i4572r.test', 'x', now(), now());
INSERT INTO public.creator_accounts(id) VALUES (pg_temp.u('owner')) ON CONFLICT DO NOTHING;
INSERT INTO public.brands(id, account_id, name, slug, claim_status, pricing_currency, default_currency)
VALUES (pg_temp.u('brand'), pg_temp.u('owner'), 'I4572R Gallery', 'i4572r-gallery', 'verified', 'ngn', 'NGN');

CREATE FUNCTION pg_temp.seed(p_key text, p_status text, p_vn text, p_ad text, p_lt text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_ns text := CASE WHEN p_status = 'draft' THEN 'business_draft' ELSE 'business_event' END;
BEGIN
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, visibility, status,
    timezone, published_at, currency, is_online, location_text, theme, city)
  VALUES (pg_temp.u(p_key), pg_temp.u('brand'), pg_temp.u('owner'), 'I4572R ' || p_key, 'i4572r-' || p_key,
    'event', CASE WHEN p_status = 'draft' THEN 'draft' ELSE 'public' END, p_status, 'Africa/Lagos',
    CASE WHEN p_status = 'draft' THEN NULL ELSE now() END, 'NGN', false, p_lt,
    jsonb_build_object(v_ns, jsonb_build_object('schemaVersion', 1, 'clientRevision', 0,
      'requestedVisibility', 'public', 'format', 'in_person', 'hideAddressUntilTicket', false,
      'location', jsonb_build_object('venueName', p_vn, 'address', p_ad))),
    'Abuja');
  INSERT INTO public.event_dates(event_id, start_at, end_at, is_master, timezone)
  VALUES (pg_temp.u(p_key), now() + interval '10 day', now() + interval '10 day 3 hour', true, 'Africa/Lagos');
END;
$fn$;

-- Class A x4: venueName = "X · ADDR", address = ADDR, location_text = venueName · ADDR.
SELECT pg_temp.seed('a' || n, 'scheduled', 'Kolanut Gallery · 12 Example Close', '12 Example Close',
  'Kolanut Gallery · 12 Example Close · 12 Example Close') FROM generate_series(1, 4) n;
-- Class D x2: drafts, one " · " in venueName, no address, location_text = venueName.
SELECT pg_temp.seed('d' || n, 'draft', 'Studio Hall · 4 Road', NULL, 'Studio Hall · 4 Road') FROM generate_series(1, 2) n;
-- Class B: live, the suffix is not the address.  Class C: live, no address, label differs.
SELECT pg_temp.seed('b', 'scheduled', 'Hall · Other Place', '9 Elsewhere', 'Hall · Other Place · 9 Elsewhere');
SELECT pg_temp.seed('c', 'scheduled', 'Gallery · Wing', NULL, 'Something else');

CREATE TEMP TABLE i4572r_before AS
  SELECT id, theme, location_text FROM public.events WHERE brand_id = pg_temp.u('brand');
-- Settle anything the fixture itself queued, then count notices before the repair.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
CREATE TEMP TABLE i4572r_notices_before AS
  SELECT (SELECT count(*) FROM public.event_edit_notices WHERE event_id IN (SELECT id FROM i4572r_before)) AS notices,
         (SELECT count(*) FROM public.event_edit_notice_pending WHERE event_id IN (SELECT id FROM i4572r_before)) AS pending;

\ir ../20281129604572_issue_4572_repair_joined_venue_names.sql

-- Settle the deferred #3827 notice trigger now, inside this transaction.
SET CONSTRAINTS ALL IMMEDIATE;

DO $t$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.events WHERE id IN (pg_temp.u('a1'), pg_temp.u('a2'), pg_temp.u('a3'), pg_temp.u('a4')) LOOP
    PERFORM pg_temp.ok(r.theme #>> '{business_event,location,venueName}' = 'Kolanut Gallery'
      AND r.theme #>> '{business_event,location,address}' = '12 Example Close'
      AND r.location_text = 'Kolanut Gallery · 12 Example Close',
      'R-1 class A shows the address once', r.location_text || ' | ' || COALESCE(r.theme #>> '{business_event,location}', '<none>'));
  END LOOP;
  FOR r IN SELECT * FROM public.events WHERE id IN (pg_temp.u('d1'), pg_temp.u('d2')) LOOP
    PERFORM pg_temp.ok(r.theme #>> '{business_draft,location,venueName}' = 'Studio Hall'
      AND r.theme #>> '{business_draft,location,address}' = '4 Road'
      AND r.location_text = 'Studio Hall · 4 Road',
      'R-2 class D is split into venue and address', r.theme #>> '{business_draft,location}');
  END LOOP;
  PERFORM pg_temp.ok(NOT EXISTS (
      SELECT 1 FROM public.events e JOIN i4572r_before b ON b.id = e.id
       WHERE e.id IN (pg_temp.u('b'), pg_temp.u('c'))
         AND (e.theme IS DISTINCT FROM b.theme OR e.location_text IS DISTINCT FROM b.location_text)),
    'R-3 class B and C are untouched');
  PERFORM pg_temp.ok(
      (SELECT count(*) FROM public.event_edit_notices WHERE event_id IN (SELECT id FROM i4572r_before))
        = (SELECT notices FROM i4572r_notices_before)
      AND (SELECT count(*) FROM public.event_edit_notice_pending WHERE event_id IN (SELECT id FROM i4572r_before))
        = (SELECT pending FROM i4572r_notices_before),
    'R-4 no guest edit notice was queued or recorded',
    (SELECT count(*) FROM public.event_edit_notices WHERE event_id IN (SELECT id FROM i4572r_before))::text || ' notices vs '
      || (SELECT notices FROM i4572r_notices_before)::text);
  PERFORM pg_temp.ok((SELECT tgenabled FROM pg_trigger
                       WHERE tgrelid = 'public.events'::regclass AND tgname = 'issue_3827_capture_edit_notice') = 'O',
    'R-4 the #3827 notice trigger is enabled again');
END $t$;

SET CONSTRAINTS ALL DEFERRED;

CREATE TEMP TABLE i4572r_after AS
  SELECT id, theme, location_text FROM public.events WHERE brand_id = pg_temp.u('brand');

\ir ../20281129604572_issue_4572_repair_joined_venue_names.sql

SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM public.events e JOIN i4572r_after a ON a.id = e.id
     WHERE e.theme IS DISTINCT FROM a.theme OR e.location_text IS DISTINCT FROM a.location_text),
  'R-5 a second run changes nothing');

-- R-6: one extra class-A row (production drifted) → the migration refuses.
SELECT pg_temp.seed('a9', 'scheduled', 'Kolanut Gallery · 12 Example Close', '12 Example Close',
  'Kolanut Gallery · 12 Example Close · 12 Example Close');
SELECT pg_temp.seed('a10', 'scheduled', 'Kolanut Gallery · 12 Example Close', '12 Example Close',
  'Kolanut Gallery · 12 Example Close · 12 Example Close');
SAVEPOINT r6;
\set ON_ERROR_STOP off
\ir ../20281129604572_issue_4572_repair_joined_venue_names.sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT r6;
SELECT pg_temp.ok((SELECT theme #>> '{business_event,location,venueName}' FROM public.events WHERE id = pg_temp.u('a9'))
    = 'Kolanut Gallery · 12 Example Close',
  'R-6 a count other than A=4 D=2 is refused and changes nothing');

ROLLBACK;
