\set ON_ERROR_STOP on
-- #4452 follow-up B8: the Dashboard's "No inbound lead for N days" reads every
-- lead source. Run after the full migration chain on PostgreSQL 17.
--
-- DL-1 a real book-a-call lead (a source the old read ignored) newer than every
--      tool and beta lead is the Dashboard's last lead, and days_since_last is 0
-- DL-2 a newer book-a-call booking by a test address (inbound_lead_is_test) is
--      not counted
-- DL-3 a newer real-looking event of a lead that is itself a test lead is not
--      counted (both flags are read)
-- DL-4 still owner/admin only: a signed-in outsider is refused
--
-- FAILS-ON-REVERT: the #4130 body (tool_leads web lane + beta_access_leads)
-- returns the beta lead's time in DL-1, not the book-a-call lead's; dropping
-- `NOT e.is_test` counts the test booking (DL-2); dropping `NOT l.is_test`
-- counts the test lead's event (DL-3).
-- MINGLA-INVARIANT: I-4452-DASHBOARD-LAST-LEAD-ALL-SOURCES | issue #4452 | the Dashboard's last inbound lead is the newest non-test lead event of any source in public.lead_events; proved by DL-1..DL-3 here.

CREATE OR REPLACE FUNCTION pg_temp.dl_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4452 B8 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.dl_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END
$a$;

BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $main$
DECLARE
  v_admin    constant uuid := '44520000-0000-4000-b800-000000000001';
  v_outsider constant uuid := '44520000-0000-4000-b800-000000000002';
  v_beta     constant uuid := '44520000-0000-4000-b800-000000000100';
  v_tool     constant uuid := '44520000-0000-4000-b800-000000000101';
  v_call     constant uuid := '44520000-0000-4000-b800-000000000102';
  v_call_t   constant uuid := '44520000-0000-4000-b800-000000000103';
  v_today    constant date := (now() AT TIME ZONE 'UTC')::date;
  v_t_call   constant timestamptz := date_trunc('second', now()) - interval '10 minutes';
  v_test_lead uuid;
  v_d jsonb; v_err text;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
    (v_admin,    'dl-admin@mingla-fixture.org', now()),
    (v_outsider, 'dl-outsider@mingla-fixture.org', now());
  INSERT INTO public.admin_users(email, role, status) VALUES ('dl-admin@mingla-fixture.org', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;

  -- A beta lead and a web tool lead, both older than the booked call.
  INSERT INTO public.beta_access_leads(id, created_at, brand_type, brand_name, contact_name, city, email, source) VALUES
    (v_beta, now() - interval '20 days', ARRAY['restaurant'], 'DL Kitchen', 'Ada', 'Lagos', 'ada@dl-kitchen.org', 'organiser_marketing');
  INSERT INTO public.tool_leads(id, tool, input, email, lane, created_at) VALUES
    (v_tool, 'venues', '{"name":"DL Rooftop","city":"Lagos"}', 'owner@dl-rooftop.org', 'web', now() - interval '30 days');

  -- DL-1: a real book-a-call booking, newer than both.
  INSERT INTO public.book_call_leads(id, booking_key, audience, name, email, venue, icp, social_platform, social_url, call_at, created_at)
  VALUES (v_call, 'slot:dl-1', 'host', 'Bola Ade', 'bola@dl-lounge.org', 'DL Lounge', 'events', 'instagram',
          'https://instagram.com/dl.lounge', now() + interval '2 days', v_t_call);
  PERFORM pg_temp.dl_assert(EXISTS (SELECT 1 FROM public.lead_events e WHERE e.source_table = 'book_call_leads' AND e.source_id = v_call AND NOT e.is_test),
    'DL-1 setup the booked call is a real lead event');

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.dl_as(v_admin);
  v_d := public.admin_dashboard_summary(v_today);
  RESET ROLE;
  PERFORM pg_temp.dl_assert((v_d #>> '{inbound,last_lead_at}')::timestamptz = v_t_call,
    'DL-1 the last lead is the book-a-call lead (got ' || COALESCE(v_d #>> '{inbound,last_lead_at}', 'null') || ')');
  PERFORM pg_temp.dl_assert((v_d #>> '{inbound,days_since_last}')::int = (v_today - (v_t_call AT TIME ZONE 'UTC')::date),
    'DL-1 days since the last lead counts from that booking');

  -- DL-2: a newer booking by a staff/test address is not a lead.
  INSERT INTO public.book_call_leads(id, booking_key, audience, name, email, venue, icp, social_platform, social_url, call_at, created_at)
  VALUES (v_call_t, 'slot:dl-2', 'host', 'Test Person', 'qa@usemingla.com', 'Test Bar', 'events', 'instagram',
          'https://instagram.com/test.bar', now() + interval '3 days', now() - interval '1 minute');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.dl_as(v_admin);
  v_d := public.admin_dashboard_summary(v_today);
  RESET ROLE;
  PERFORM pg_temp.dl_assert((v_d #>> '{inbound,last_lead_at}')::timestamptz = v_t_call,
    'DL-2 a test booking is never the last lead');

  -- DL-3: a lead marked test (a real-looking event under it) is not counted.
  INSERT INTO public.leads(email_key, name, primary_label, labels, sources, is_test, event_count, first_seen_at, last_seen_at)
  VALUES ('demo@dl-demo.org', 'Demo', 'host', ARRAY['host'], ARRAY['form'], true, 1, now(), now())
  RETURNING id INTO v_test_lead;
  INSERT INTO public.lead_events(lead_id, source, source_table, source_id, label, is_test, occurred_at)
  VALUES (v_test_lead, 'form', 'form_submissions', gen_random_uuid(), 'host', false, now() - interval '30 seconds');
  -- The lead's own flag may be recomputed by a trigger; hold it as a test lead for this check.
  UPDATE public.leads SET is_test = true WHERE id = v_test_lead;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.dl_as(v_admin);
  v_d := public.admin_dashboard_summary(v_today);
  RESET ROLE;
  PERFORM pg_temp.dl_assert((v_d #>> '{inbound,last_lead_at}')::timestamptz = v_t_call,
    'DL-3 an event of a test lead is never the last lead');

  -- DL-4: still admin-only.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.dl_as(v_outsider);
    PERFORM public.admin_dashboard_summary(v_today);
    RESET ROLE;
    v_err := 'none';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_err := SQLERRM;
  END;
  PERFORM pg_temp.dl_assert(v_err = 'not_authorized', 'DL-4 a signed-in outsider is refused (' || v_err || ')');
END
$main$;
ROLLBACK;
