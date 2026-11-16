\set ON_ERROR_STOP on
-- #4452 A1.4 performance budget: 20,000 leads and 60,000 events.
--
-- PERF-1  the first Leads page (newest first) is read through leads_last_seen_idx.
-- PERF-2  the per-lead event read (latest event, drawer history) uses lead_events_lead_idx.
-- PERF-3  admin_leads_list answers; its time is printed as evidence (no timing assert in CI).
-- PERF-4  the one-scan total, facets and test_hidden equal the per-value leads_filtered_ids counts
--         (the definition the eleven separate scans used), by default and under four filters.
-- PERF-5  the email-status reads are index probes (the three lower(btrim()) expression indexes).
--
-- FAILS-ON-REVERT: dropping either index fails PERF-1 or PERF-2; a facet column in
-- leads_filter_scan that drops its own-dimension rule (fl_* testing m.pl, fs_* testing m.ps)
-- or the test rule fails PERF-4; dropping an email-key index fails PERF-5.

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
-- 200 test leads (hidden by default) and a second label on every 7th lead.
UPDATE public.leads SET is_test = true WHERE email_key IN (SELECT format('perf%s@perf-fixture.org', g) FROM generate_series(1, 200) g);
UPDATE public.lead_events SET is_test = true WHERE lead_id IN (SELECT md5('lead' || g)::uuid FROM generate_series(1, 200) g);
UPDATE public.lead_events SET label = 'host', source = 'beta', source_table = 'beta_access_leads'
 WHERE source = 'tool' AND lead_id IN (SELECT md5('lead' || g)::uuid FROM generate_series(1, 20000, 7) g);
ANALYZE public.leads;
ANALYZE public.lead_events;
DO $t$
DECLARE
  v_plan text; v_t0 timestamptz; v jsonb; v_f jsonb; v_nf jsonb; v_exp jsonb;
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
  v_t0 := clock_timestamp();
  v := public.admin_leads_list('{"labels":["creator"],"utm_campaign":"camp-7"}'::jsonb, v->'next', 50);
  RAISE NOTICE 'EVIDENCE admin_leads_list event filter, page 2, at 20k/60k: % ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
  v_t0 := clock_timestamp();
  v := public.admin_leads_list('{"q":"perf12"}'::jsonb, NULL, 50);
  RAISE NOTICE 'EVIDENCE admin_leads_list search at 20k/60k: % ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
  v_t0 := clock_timestamp();
  v := public.admin_leads_list('{"email_status":"never_emailed","sources":["beta"]}'::jsonb, NULL, 50);
  RAISE NOTICE 'EVIDENCE admin_leads_list email status + source at 20k/60k: % ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
  v := public.admin_leads_list('{"labels":["creator"],"utm_campaign":"camp-7"}'::jsonb, NULL, 50);
  RESET ROLE;
  PERFORM pg_temp.p_assert(jsonb_array_length(v->'rows') > 0, 'PERF-3 admin_leads_list answers at volume');
  -- PERF-4: the one scan agrees with the per-value definition.
  FOR v_f IN SELECT x FROM jsonb_array_elements('[{}, {"labels":["creator"]}, {"sources":["beta"],"utm_campaign":"camp-7"},
                                                  {"labels":["host","local"],"sources":["form"],"show_test":true}, {"q":"perf1"}]'::jsonb) x LOOP
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    v := public.admin_leads_list(v_f, NULL, 50);
    RESET ROLE;
    v_nf := public.leads_filter_normalize(v_f);
    v_exp := jsonb_build_object(
      'total', (SELECT count(*) FROM public.leads_filtered_ids(v_nf)),
      'labels', (SELECT jsonb_object_agg(k, (SELECT count(*) FROM public.leads_filtered_ids((v_nf - 'labels') || jsonb_build_object('labels', jsonb_build_array(k)))))
                   FROM unnest(ARRAY['host','creator','local','explorer']) k),
      'sources', (SELECT jsonb_object_agg(k, (SELECT count(*) FROM public.leads_filtered_ids((v_nf - 'sources') || jsonb_build_object('sources', jsonb_build_array(k)))))
                   FROM unnest(ARRAY['form','book_a_call','tool','beta']) k),
      'test_hidden', CASE WHEN v_nf ? 'show_test' THEN 0 ELSE
        (SELECT count(*) FROM public.leads_filtered_ids(v_nf || '{"show_test":true}'::jsonb)) - (SELECT count(*) FROM public.leads_filtered_ids(v_nf)) END);
    PERFORM pg_temp.p_assert((v->>'total')::bigint = (v_exp->>'total')::bigint AND v->'facets'->'labels' = v_exp->'labels'
                         AND v->'facets'->'sources' = v_exp->'sources' AND (v->>'test_hidden')::bigint = (v_exp->>'test_hidden')::bigint,
      format('PERF-4 one-scan counts equal the per-value counts for %s (got %s, want %s)', v_f::text,
             jsonb_build_object('total', v->'total', 'facets', v->'facets', 'test_hidden', v->'test_hidden')::text, v_exp::text));
  END LOOP;
  PERFORM pg_temp.p_assert(((SELECT (v_exp->>'test_hidden')) IS NOT NULL), 'PERF-4 ran');
  -- PERF-5: the email-status reads probe an index.
  SET LOCAL enable_seqscan = off;
  v_plan := pg_temp.p_plan($$SELECT 1 FROM public.channel_suppressions c WHERE lower(btrim(c.contact)) = 'a@b.org' AND c.channel = 'email'$$);
  PERFORM pg_temp.p_assert(v_plan LIKE '%channel_suppressions_email_key_idx%', 'PERF-5 channel_suppressions email key index');
  v_plan := pg_temp.p_plan($$SELECT 1 FROM public.marketing_unsubscribes u WHERE lower(btrim(u.contact_email)) = 'a@b.org'$$);
  PERFORM pg_temp.p_assert(v_plan LIKE '%marketing_unsubscribes_email_key_idx%', 'PERF-5 marketing_unsubscribes email key index');
  v_plan := pg_temp.p_plan($$SELECT 1 FROM public.admin_email_recipient_deliveries d WHERE lower(btrim(d.recipient_email)) = 'a@b.org'$$);
  PERFORM pg_temp.p_assert(v_plan LIKE '%admin_email_recipient_deliveries_email_key_idx%', 'PERF-5 admin_email_recipient_deliveries email key index');
  RESET enable_seqscan;
END
$t$;
ROLLBACK;
