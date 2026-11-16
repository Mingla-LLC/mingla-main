\set ON_ERROR_STOP on
-- #4452 A1.4 performance budget: 20,000 leads and 60,000 events.
--
-- PERF-1  the first Leads page (newest first) is read through leads_last_seen_idx.
-- PERF-2  the per-lead event read (latest event, drawer history) uses lead_events_lead_idx.
-- PERF-3  admin_leads_list answers; its time is printed as evidence (no timing assert in CI).
--
-- FAILS-ON-REVERT: dropping either index fails PERF-1 or PERF-2.

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4452 leads perf FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.p_plan(p_sql text)
RETURNS text LANGUAGE plpgsql AS $a$
DECLARE v_line text; v_out text := '';
BEGIN
  FOR v_line IN EXECUTE 'EXPLAIN ' || p_sql LOOP v_out := v_out || v_line || E'\n'; END LOOP;
  RETURN v_out;
END
$a$;

BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO public.leads (id, email_key, name, primary_label, labels, sources, first_seen_at, last_seen_at, event_count)
SELECT md5('lead' || g)::uuid, format('perf%s@perf-fixture.org', g), 'Perf ' || g,
       (ARRAY['host','creator','local'])[1 + g % 3], ARRAY[(ARRAY['host','creator','local'])[1 + g % 3]], ARRAY['form'],
       now() - make_interval(mins => g), now() - make_interval(mins => g), 3
  FROM generate_series(1, 20000) g;
INSERT INTO public.lead_events (lead_id, source, source_table, source_id, label, page_path, utm_campaign, occurred_at)
SELECT md5('lead' || g)::uuid, (ARRAY['form','book_a_call','tool'])[1 + e], (ARRAY['form_submissions','book_call_leads','tool_leads'])[1 + e],
       md5('ev' || g || ':' || e)::uuid, (ARRAY['host','creator','local'])[1 + g % 3], '/creators', 'camp-' || (g % 50),
       now() - make_interval(mins => g) - make_interval(secs => e)
  FROM generate_series(1, 20000) g, generate_series(0, 2) e;
ANALYZE public.leads;
ANALYZE public.lead_events;
DO $t$
DECLARE
  v_plan text; v_t0 timestamptz; v jsonb;
  v_admin constant uuid := '44520000-0000-4000-f100-000000000001';
BEGIN
  PERFORM pg_temp.p_assert((SELECT count(*) FROM public.leads WHERE email_key LIKE '%@perf-fixture.org') = 20000
                       AND (SELECT count(*) FROM public.lead_events e JOIN public.leads l ON l.id = e.lead_id WHERE l.email_key LIKE '%@perf-fixture.org') = 60000,
    'seeded 20,000 leads and 60,000 events');
  v_plan := pg_temp.p_plan($$SELECT l.id FROM public.leads l WHERE NOT l.is_test ORDER BY l.last_seen_at DESC, l.id DESC LIMIT 51$$);
  PERFORM pg_temp.p_assert(v_plan LIKE '%leads_last_seen_idx%', 'PERF-1 the first page reads leads_last_seen_idx');
  v_plan := pg_temp.p_plan($$SELECT e.* FROM public.lead_events e WHERE e.lead_id = md5('lead1')::uuid ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1$$);
  PERFORM pg_temp.p_assert(v_plan LIKE '%lead_events_lead_idx%', 'PERF-2 the latest-event read uses lead_events_lead_idx');
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES (v_admin, 'p4452-admin@mingla-fixture.org', now());
  INSERT INTO public.admin_users(email, role, status) VALUES ('p4452-admin@mingla-fixture.org', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_t0 := clock_timestamp();
  v := public.admin_leads_list('{}'::jsonb, NULL, 50);
  RAISE NOTICE 'EVIDENCE admin_leads_list first page at 20k/60k: % ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
  v_t0 := clock_timestamp();
  v := public.admin_leads_list('{"labels":["creator"],"utm_campaign":"camp-7"}'::jsonb, NULL, 50);
  RAISE NOTICE 'EVIDENCE admin_leads_list event filter at 20k/60k: % ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
  RESET ROLE;
  PERFORM pg_temp.p_assert(jsonb_array_length(v->'rows') > 0, 'PERF-3 admin_leads_list answers at volume');
END
$t$;
ROLLBACK;
