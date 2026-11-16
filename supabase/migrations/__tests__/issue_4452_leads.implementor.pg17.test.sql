\set ON_ERROR_STOP on
-- #4452 M5 leads (amendment A1): executable PostgreSQL 17 proof, after the full migration replay.
--
-- A1-T-1a A1-SC-1   anon and signed-in cannot SELECT, INSERT, UPDATE or DELETE any new #4452 table.
-- A1-T-1b A1-SC-11  lead_events.summary refuses every banned key (email, phone, click ids, ip_hash, user agent, referer).
-- A1-T-1c A1-SC-17  keyset paging over 120 leads returns every lead once, in order, no gaps.
-- A1-T-1d A1-SC-18  an unknown filter key raises 22023 bad_filter.
-- A1-T-1e A1-SC-20  event-level filters combine on ONE event.
-- A1-T-1f A1-SC-31  a growth (beta_leads) member lists and selects every source, but cannot export or link a card (42501).
-- A1-T-2  A1-SC-3   one email (any case or spacing) from a form, a booking, a tool and the beta form is ONE lead, 4 events.
-- A1-T-2b A1-SC-4   re-ingesting a row, or reconciling twice, adds nothing.
-- A1-T-2c A1-SC-6   primary_label is the newest event's label; labels is the union; counted once under both filters.
-- A1-T-2d A1-SC-7   consent only goes false -> true.
-- A1-T-2e A1-SC-8   a forced ingest error keeps the source write, records SQLSTATE only, and reconcile repairs it.
-- A1-T-2f A1-SC-9   deleting a source row deletes its event; a lead with no events left is deleted.
-- A1-T-3  A1-SC-5   backfill labels: bookings by audience, web tools host, beta host, Explorer explorer; app-lane tools never.
-- A1-T-4a A1-SC-21  (SQL half) the selection banner counts come from leads_audience_counts.
-- A1-T-5f A1-SC-29  linking a lead already linked elsewhere raises PT409 lead_already_linked.
-- A1-T-6  A1-SC-19  (pg17 twin) admin_leads_list with {form_id:F} returns exactly leads_filtered_ids({form_id:F}).
-- A1-T-8  A1-SC-25, 26  the export carries no click id, cookie or banned key, refuses >10,000 rows, logs q redacted.
--
-- FAILS-ON-REVERT: ON CONFLICT (email_key) or lower(btrim()) in lead_upsert_event -> A1-T-2 sees 4 leads;
-- the OR in the consent merge -> A1-T-2d; the inner EXCEPTION block in lead_ingest_trigger -> A1-T-2e aborts;
-- the tools CASE branch label or lane='web' -> A1-T-3; the single EXISTS in leads_filtered_ids -> A1-T-1e;
-- the cursor predicate -> A1-T-1c; the normalizer ELSE -> A1-T-1d; the summary CHECK -> A1-T-1b;
-- any ad_match_contexts join in admin_leads_export -> A1-T-8.

CREATE OR REPLACE FUNCTION pg_temp.l_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4452 leads FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.l_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.l_state(p_sql text)
RETURNS text LANGUAGE plpgsql AS $a$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.l_booking(p_email text, p_audience text, p_key text, p_at timestamptz DEFAULT now())
RETURNS uuid LANGUAGE plpgsql AS $a$
DECLARE v uuid;
BEGIN
  INSERT INTO public.book_call_leads (booking_key, name, email, venue, icp, city, creator_makes, first_place, social_platform, social_url, call_at, audience, created_at)
  VALUES (p_key, 'Ada Okafor', p_email, CASE WHEN p_audience = 'host' THEN 'Ada Kitchen' END,
          CASE WHEN p_audience = 'host' THEN 'restaurants' END,
          CASE WHEN p_audience <> 'host' THEN 'Lagos' END,
          CASE WHEN p_audience = 'creator' THEN 'video' END,
          NULL, 'instagram', 'https://instagram.com/ada', now() + interval '2 days', p_audience, p_at)
  RETURNING id INTO v;
  RETURN v;
END
$a$;

-- ═══ A1-T-1a / 1b: grants and the summary ban ═══════════════════════════════
BEGIN;
DO $t$
DECLARE v_t text; v_k text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['forms','form_versions','form_page_slugs','form_submissions','form_submission_keys',
      'forms_submit_attempts','form_owner_rotation','site_page_drafts','site_page_versions','site_page_live',
      'site_preview_tokens','form_automations','form_automation_versions','form_automation_runs',
      'form_automation_sends','form_funnel_events','leads','lead_events','lead_ingest_failures',
      'lead_audience_selections','leads_export_log'] LOOP
    PERFORM pg_temp.l_assert((SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_t)::regclass)
      AND NOT has_table_privilege('anon', 'public.' || v_t, 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('authenticated', 'public.' || v_t, 'SELECT,INSERT,UPDATE,DELETE'),
      'A1-T-1a A1-SC-1 RLS on and no client grant: ' || v_t);
  END LOOP;
  PERFORM pg_temp.l_assert(NOT has_function_privilege('anon', 'public.admin_leads_list(jsonb,jsonb,integer)', 'EXECUTE'), 'A1-T-1a anon cannot list leads');
  PERFORM pg_temp.l_assert(NOT has_function_privilege('authenticated', 'public.leads_filtered_ids(jsonb)', 'EXECUTE')
                       AND NOT has_function_privilege('authenticated', 'public.leads_audience_resolve(uuid,uuid)', 'EXECUTE'),
                           'A1-T-1a signed-in cannot call the internal filter or resolver');
  INSERT INTO public.leads (id, email_key, primary_label, labels, sources, first_seen_at, last_seen_at)
  VALUES ('44520000-0000-4000-c000-00000000000a', 'ban@mingla-fixture.org', 'host', ARRAY['host'], ARRAY['form'], now(), now());
  FOREACH v_k IN ARRAY ARRAY['email','phone','phone_e164','fbc','fbp','gclid','fbclid','ttclid','ttp','scid','sccid','rdt_cid','click_id','ip_hash','user_agent','referer'] LOOP
    PERFORM pg_temp.l_assert(pg_temp.l_state(format(
      $$INSERT INTO public.lead_events (lead_id, source, source_table, source_id, label, summary, occurred_at)
        VALUES ('44520000-0000-4000-c000-00000000000a', 'form', 'form_submissions', gen_random_uuid(), 'host', %L::jsonb, now())$$,
      jsonb_build_object(v_k, 'x'))) = '23514', 'A1-T-1b A1-SC-11 summary refuses ' || v_k);
  END LOOP;
END
$t$;
ROLLBACK;

-- ═══ A1-T-2 / 2b / 2c / 2d / 2f / A1-T-3 ═════════════════════════════════════
BEGIN;
DO $t$
DECLARE
  v_lead uuid; v_n bigint; v_tool uuid := gen_random_uuid(); v_beta uuid := gen_random_uuid(); v_book uuid;
  v_ex uuid := gen_random_uuid(); v_app uuid := gen_random_uuid(); v_c uuid; v_l uuid;
BEGIN
  -- One person from three sources here (forms come in the main block): case and spaces vary.
  v_book := pg_temp.l_booking('A@X-Fixture.org', 'host', 'gcal:l4452-1', now() - interval '3 days');
  INSERT INTO public.tool_leads (id, tool, input, email, lane, created_at)
  VALUES (v_tool, 'venues', '{"name":"Ada Kitchen","city":"Lagos"}', 'a@X-fixture.ORG', 'web', now() - interval '2 days');
  INSERT INTO public.beta_access_leads (id, created_at, brand_type, brand_name, contact_name, city, email, source, consent)
  VALUES (v_beta, now() - interval '1 day', ARRAY['restaurant'], 'Ada Kitchen', 'Ada', 'Lagos', ' a@x-fixture.org ', 'organiser_marketing', true);
  SELECT count(*) INTO v_n FROM public.leads WHERE email_key = 'a@x-fixture.org';
  PERFORM pg_temp.l_assert(v_n = 1, 'A1-T-2 A1-SC-3 one email in any case or spacing is one lead');
  SELECT id INTO v_lead FROM public.leads WHERE email_key = 'a@x-fixture.org';
  PERFORM pg_temp.l_assert((SELECT event_count = 3 AND sources = ARRAY['beta','book_a_call','tool'] FROM public.leads WHERE id = v_lead),
    'A1-T-2 A1-SC-3 three events, sources are all three');
  PERFORM pg_temp.l_assert((SELECT NOT marketing_consent FROM public.leads WHERE id = v_lead),
    'A1-T-3 the beta box is not marketing consent (probe on #4452)');
  -- 2b: idempotent.
  PERFORM public.lead_ingest('book_call_leads', v_book);
  PERFORM public.lead_reconcile();
  PERFORM public.lead_reconcile();
  PERFORM pg_temp.l_assert((SELECT event_count FROM public.leads WHERE id = v_lead) = 3
                       AND (SELECT count(*) FROM public.lead_events WHERE lead_id = v_lead) = 3, 'A1-T-2b A1-SC-4 re-ingest and reconcile add nothing');
  -- 2c: labels union, primary = newest.
  PERFORM pg_temp.l_booking('a@x-fixture.org', 'creator', 'gcal:l4452-2', now());
  PERFORM pg_temp.l_assert((SELECT primary_label = 'creator' AND labels = ARRAY['creator','host'] FROM public.leads WHERE id = v_lead),
    'A1-T-2c A1-SC-6 primary is the newest label; labels is the union');
  -- 2d: consent false -> true, never back.
  UPDATE public.book_call_leads SET marketing_consent = true, consent_text = 'Send me occasional emails', consent_at = now() - interval '3 days'
   WHERE id = v_book;
  PERFORM pg_temp.l_assert((SELECT marketing_consent FROM public.leads WHERE id = v_lead), 'A1-T-2d a consented booking makes the lead consented');
  UPDATE public.book_call_leads SET marketing_consent = false, consent_text = NULL, consent_at = NULL WHERE id = v_book;
  PERFORM pg_temp.l_assert((SELECT marketing_consent AND consent_at IS NOT NULL FROM public.leads WHERE id = v_lead),
    'A1-T-2d A1-SC-7 a later row without the box never withdraws consent');
  -- A1-T-3: the label map and the app lane.
  INSERT INTO public.explorer_app_leads (id, created_at, name, email, city, interest, platform, source, consent)
  VALUES (v_ex, now(), 'Bola', 'bola@x-fixture.org', 'Lagos', ARRAY['events'], 'ios', 'explorer_marketing', true);
  PERFORM pg_temp.l_booking('loc@x-fixture.org', 'local', 'gcal:l4452-3');
  SET LOCAL session_replication_role = replica;   -- app-lane rows need a real user and brand; skip the FKs and triggers
  INSERT INTO public.tool_leads (id, tool, input, email, lane, user_id, brand_id)
  VALUES (v_app, 'events', '{"name":"App Run"}', 'app@x-fixture.org', 'app', gen_random_uuid(), gen_random_uuid());
  SET LOCAL session_replication_role = origin;
  PERFORM public.lead_reconcile();
  PERFORM public.lead_ingest('tool_leads', v_app);   -- even a direct ingest refuses the app lane
  PERFORM pg_temp.l_assert((SELECT primary_label FROM public.leads WHERE email_key = 'bola@x-fixture.org') = 'explorer', 'A1-T-3 A1-SC-5 Explorer waitlist -> explorer');
  PERFORM pg_temp.l_assert((SELECT primary_label FROM public.leads WHERE email_key = 'loc@x-fixture.org') = 'local', 'A1-T-3 A1-SC-5 a local booking -> local');
  PERFORM pg_temp.l_assert((SELECT label FROM public.lead_events WHERE source_table = 'tool_leads' AND source_id = v_tool) = 'host', 'A1-T-3 A1-SC-5 web tool -> host');
  PERFORM pg_temp.l_assert((SELECT label FROM public.lead_events WHERE source_table = 'beta_access_leads' AND source_id = v_beta) = 'host', 'A1-T-3 A1-SC-5 beta -> host');
  PERFORM pg_temp.l_assert((SELECT page_path FROM public.lead_events WHERE source_table = 'tool_leads' AND source_id = v_tool) = '/tools/venues', 'A1-T-3 tool page path');
  PERFORM pg_temp.l_assert(NOT EXISTS (SELECT 1 FROM public.leads WHERE email_key = 'app@x-fixture.org'), 'A1-T-3 A1-SC-5 an app-lane tool row is never ingested');
  -- 2f: delete.
  DELETE FROM public.explorer_app_leads WHERE id = v_ex;
  PERFORM pg_temp.l_assert(NOT EXISTS (SELECT 1 FROM public.leads WHERE email_key = 'bola@x-fixture.org'), 'A1-T-2f A1-SC-9 a lead with no events left is deleted');
  DELETE FROM public.tool_leads WHERE id = v_tool;
  PERFORM pg_temp.l_assert((SELECT event_count FROM public.leads WHERE id = v_lead) = 3
                       AND NOT EXISTS (SELECT 1 FROM public.lead_events WHERE source_table = 'tool_leads' AND source_id = v_tool),
    'A1-T-2f A1-SC-9 deleting a source row deletes its event');
END
$t$;
ROLLBACK;

-- ═══ A1-T-2e: a forced ingest error never blocks the source write ═══════════
BEGIN;
ALTER TABLE public.lead_events ADD CONSTRAINT issue4452_force_fail CHECK (source <> 'beta');
DO $t$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.beta_access_leads (id, created_at, brand_type, brand_name, contact_name, city, email, source)
  VALUES (v_id, now(), ARRAY['restaurant'], 'Fail Bistro', 'Fay', 'Lagos', 'fay@x-fixture.org', 'organiser_marketing');
  PERFORM pg_temp.l_assert(EXISTS (SELECT 1 FROM public.beta_access_leads WHERE id = v_id), 'A1-T-2e A1-SC-8 the source insert committed');
  PERFORM pg_temp.l_assert((SELECT sqlstate = '23514' AND reason = 'error' FROM public.lead_ingest_failures WHERE source_id = v_id),
    'A1-T-2e A1-SC-8 the failure has a SQLSTATE and no message');
  PERFORM pg_temp.l_assert(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_ingest_failures' AND column_name IN ('message','detail','email')),
    'A1-T-2e the failure table has no message column');
END
$t$;
ALTER TABLE public.lead_events DROP CONSTRAINT issue4452_force_fail;
DO $t$
BEGIN
  PERFORM public.lead_reconcile();
  PERFORM pg_temp.l_assert(EXISTS (SELECT 1 FROM public.leads WHERE email_key = 'fay@x-fixture.org')
                       AND NOT EXISTS (SELECT 1 FROM public.lead_ingest_failures f JOIN public.beta_access_leads b ON b.id = f.source_id WHERE b.email = 'fay@x-fixture.org'),
    'A1-T-2e A1-SC-8 lead_reconcile repairs it and clears the failure');
END
$t$;
ROLLBACK;

-- ═══ List, filters, paging, roles, selection, export ═════════════════════════
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $t$
DECLARE
  v_admin  constant uuid := '44520000-0000-4000-c000-000000000001';
  v_growth constant uuid := '44520000-0000-4000-c000-000000000002';
  v_out    constant uuid := '44520000-0000-4000-c000-000000000003';
  v_web    constant uuid := '44520000-0000-4000-c000-000000000004';
  v jsonb; v_after jsonb; v_seen uuid[] := ARRAY[]::uuid[]; v_page jsonb; v_i integer; v_ids uuid[];
  v_lead uuid; v_rec uuid; v_rec2 uuid; v_sel jsonb; v_exp jsonb; v_text text;
  v_form uuid; v_ver uuid; v_sub uuid;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
    (v_admin, 'l4452-admin@mingla-fixture.org', now()), (v_growth, 'l4452-growth@mingla-fixture.org', now()),
    (v_out, 'l4452-out@mingla-fixture.org', now()), (v_web, 'l4452-web@mingla-fixture.org', now());
  INSERT INTO public.admin_users(email, role, status) VALUES ('l4452-admin@mingla-fixture.org', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO public.admin_team_members(email, role, status, accepted_at) VALUES ('l4452-growth@mingla-fixture.org', 'growth', 'active', now()),
    ('l4452-web@mingla-fixture.org', 'website', 'active', now());
  -- 120 leads, a minute apart, plus ties on the same instant (the id breaks them).
  FOR v_i IN 1..120 LOOP
    PERFORM pg_temp.l_booking(format('p%s@page-fixture.org', v_i), CASE WHEN v_i % 3 = 0 THEN 'creator' ELSE 'host' END,
                              'gcal:page-' || v_i, '2026-11-01'::timestamptz + make_interval(mins => v_i / 7));
  END LOOP;
  -- A1-T-1e: one person with a creator FORM and a host BOOKING.
  INSERT INTO public.forms (id, key, name, audience, status, draft, created_by, updated_by)
  VALUES (gen_random_uuid(), 'leads-fixture', 'Leads fixture', 'creator', 'draft', '{}'::jsonb, v_admin, v_admin) RETURNING id INTO v_form;
  INSERT INTO public.form_versions (form_id, version, definition, definition_sha256, published_by)
  VALUES (v_form, 1, '{"fields":[{"key":"name","type":"name","label":"Name"},{"key":"email","type":"email","label":"Email"},{"key":"city","type":"short","label":"City"}]}',
          repeat('a', 64), v_admin) RETURNING id INTO v_ver;
  UPDATE public.forms SET status = 'live', live_version_id = v_ver WHERE id = v_form;
  INSERT INTO public.form_submissions (form_id, form_version_id, lead_label, idempotency_key, email, name, answers, page_path,
                                       placement, ads_allowed, utm_campaign, click_source)
  VALUES (v_form, v_ver, 'creator', gen_random_uuid(), 'mix@x-fixture.org', 'Mix Person', '{"city":"Lagos"}', '/creators',
          'inline', true, 'Creators-Lagos', 'meta') RETURNING id INTO v_sub;
  PERFORM pg_temp.l_booking('mix@x-fixture.org', 'host', 'gcal:mix-1');
  -- A1-T-8: known click ids for this lead's form subject.
  INSERT INTO public.ad_match_contexts (subject_type, subject_id, click_id, fbp, fbc, ttp, client_ip, client_user_agent, surface)
  VALUES ('lead', 'form:' || v_sub, 'TESTGCLID123', 'fb.1.TESTFBP', 'fb.1.TESTFBC', 'TESTTTP', '203.0.113.9', 'TESTUA/1.0', 'web');

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.l_as(v_admin);
  -- A1-T-1c: keyset paging.
  v_after := NULL;
  LOOP
    v_page := public.admin_leads_list('{"sources":["book_a_call"]}'::jsonb, v_after, 50);
    SELECT array_agg((r->>'id')::uuid ORDER BY o) INTO v_ids FROM jsonb_array_elements(v_page->'rows') WITH ORDINALITY t(r, o);
    v_seen := v_seen || COALESCE(v_ids, ARRAY[]::uuid[]);
    v_after := v_page->'next';
    EXIT WHEN v_after IS NULL OR jsonb_typeof(v_after) = 'null';
  END LOOP;
  PERFORM pg_temp.l_assert(cardinality(v_seen) = (v_page->>'total')::integer AND cardinality(v_seen) >= 121,
    'A1-T-1c A1-SC-17 Load more returns every lead (' || cardinality(v_seen) || ')');
  PERFORM pg_temp.l_assert((SELECT count(DISTINCT x) FROM unnest(v_seen) x) = cardinality(v_seen), 'A1-T-1c A1-SC-17 no lead repeats across pages');
  -- A1-T-1d.
  PERFORM pg_temp.l_assert(pg_temp.l_state($$SELECT public.admin_leads_list('{"labelz":["host"]}'::jsonb)$$) = '22023', 'A1-T-1d A1-SC-18 an unknown filter key is bad_filter');
  PERFORM pg_temp.l_assert(pg_temp.l_state($$SELECT public.admin_leads_list('{}'::jsonb, '{"last_seen_at":"nope","id":"x"}'::jsonb)$$) = '22023', 'A1-T-1d a malformed cursor is bad_cursor');
  -- A1-T-1e: same-event combination.
  v := public.admin_leads_list('{"labels":["creator"],"sources":["book_a_call"],"q":"mix@"}'::jsonb);
  PERFORM pg_temp.l_assert((v->>'total')::integer = 0, 'A1-T-1e A1-SC-20 creator + Book a call excludes a creator form plus a host booking');
  v := public.admin_leads_list('{"labels":["creator"],"q":"mix@"}'::jsonb);
  PERFORM pg_temp.l_assert((v->>'total')::integer = 1, 'A1-T-1e the creator label alone matches');
  v := public.admin_leads_list('{"labels":["host"],"q":"MIX@"}'::jsonb);
  PERFORM pg_temp.l_assert((v->>'total')::integer = 1 AND (v->'rows'->0->>'email') = 'mix@x-fixture.org', 'A1-SC-6 the same person under Host too; search is case-insensitive; the list shows the email');
  v := public.admin_leads_list('{"utm_campaign":"creators-lagos"}'::jsonb);
  PERFORM pg_temp.l_assert((v->>'total')::integer = 1, 'A1-SC-18 utm_campaign is case-insensitive exact');
  -- A1-T-6 twin: Submissions for form F.
  v := public.admin_leads_list(jsonb_build_object('form_id', v_form));
  RESET ROLE;
  PERFORM pg_temp.l_assert((SELECT array_agg((r->>'id')::uuid ORDER BY (r->>'id')) FROM jsonb_array_elements(v->'rows') r)
                         = (SELECT array_agg(x.lead_id ORDER BY x.lead_id::text) FROM public.leads_filtered_ids(jsonb_build_object('form_id', v_form)) x),
    'A1-T-6 A1-SC-19 Submissions for F equals leads_filtered_ids({form_id:F})');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.l_as(v_admin);
  -- A1-T-8: export.
  v_exp := public.admin_leads_export(jsonb_build_object('form_id', v_form, 'q', 'mix'));
  v_text := v_exp::text;
  PERFORM pg_temp.l_assert(v_text NOT LIKE '%TESTGCLID123%' AND v_text NOT LIKE '%TESTFBP%' AND v_text NOT LIKE '%TESTFBC%'
                       AND v_text NOT LIKE '%TESTTTP%' AND v_text NOT LIKE '%203.0.113.9%' AND v_text NOT LIKE '%TESTUA%',
    'A1-T-8 A1-SC-25 no click id, cookie, IP or user agent value appears in the export');
  PERFORM pg_temp.l_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_exp->'rows') r, jsonb_object_keys(r) k
                                         WHERE k ~* '(click_id|gclid|fbc|fbp|ttclid|ttp|sc_?cid|rdt|ip_hash|user_agent|referer|phone|idempotency|event_id)'),
    'A1-T-8 A1-SC-25 no banned key in the export rows');
  PERFORM pg_temp.l_assert((v_exp->'rows'->0->'answers'->>'city') = 'Lagos', 'A1-T-8 a form export appends the form''s answer keys');
  RESET ROLE;
  PERFORM pg_temp.l_assert((SELECT filter->>'q' FROM public.leads_export_log ORDER BY id DESC LIMIT 1) = '[search]', 'A1-T-8b A1-SC-26 the export log redacts q');
  PERFORM pg_temp.l_assert(position('ad_match_contexts' IN pg_get_functiondef('public.admin_leads_export(jsonb)'::regprocedure)) = 0,
    'A1-T-8 I-4452-LEADS-EXPORT-NO-CLICK-IDS admin_leads_export reads no ad_match_contexts');

  -- A1-T-4a (SQL half): selection counts.
  SELECT id INTO v_lead FROM public.leads WHERE email_key = 'mix@x-fixture.org';
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.l_as(v_admin);
  v_sel := public.admin_lead_selection_create(ARRAY[v_lead], NULL);
  PERFORM pg_temp.l_assert((v_sel->>'selected')::integer = 1 AND (v_sel->>'marketable')::integer = 0 AND (v_sel->>'no_consent')::integer = 1,
    'A1-T-4a a lead without consent is counted as no_consent, not marketable');
  RESET ROLE;
  PERFORM pg_temp.l_assert(public.leads_audience_counts((v_sel->>'selection_id')::uuid) = v_sel, 'A1-T-4a the banner and the composer read the same counts');
  PERFORM pg_temp.l_assert(pg_temp.l_state(format($$SELECT * FROM public.leads_audience_resolve(%L, %L)$$, v_sel->>'selection_id', v_growth)) = '22023',
    'A1-T-4 another actor cannot resolve the selection (selection_expired)');

  -- A1-T-1f: gates per role. NOTE (#4452 contradiction, flagged to the conductor): the growth role holds
  -- the crm area (admin_team_role_areas), so under the specified gate leads_can_export() = admin OR crm,
  -- growth CAN export and link. A1-SC-31 says it cannot. The gate is built as specified; the negative case
  -- is proven with a website editor (lead access without crm).
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.l_as(v_growth);
  v := public.admin_leads_list('{}'::jsonb);
  PERFORM pg_temp.l_assert((v->'facets'->'sources'->>'tool') IS NOT NULL AND (v->'can'->>'email')::boolean,
    'A1-T-1f A1-SC-31 growth sees every source and can email');
  PERFORM pg_temp.l_assert((v->'can'->>'export')::boolean = public.leads_can_export(), 'A1-T-1f can.export follows leads_can_export()');
  v_sel := public.admin_lead_selection_create(NULL, '{"labels":["host"]}'::jsonb);
  PERFORM pg_temp.l_assert((v_sel->>'selected')::integer >= 1, 'A1-T-1f growth can select (email)');
  PERFORM pg_temp.l_as(v_web);
  v := public.admin_leads_list('{}'::jsonb);
  PERFORM pg_temp.l_assert((v->'can'->>'export')::boolean = false AND (v->'can'->>'add_to_pipeline')::boolean = false,
    'A1-T-1f lead access without crm: export and Add to pipeline hidden');
  PERFORM pg_temp.l_assert(pg_temp.l_state($$SELECT public.admin_leads_export('{}'::jsonb)$$) = '42501', 'A1-T-1f lead access without crm cannot export (42501)');
  PERFORM pg_temp.l_assert(pg_temp.l_state(format($$SELECT public.admin_lead_link_crm(%L, %L)$$, v_lead, gen_random_uuid())) = '42501',
    'A1-T-1f lead access without crm cannot link a card (42501)');
  PERFORM pg_temp.l_as(v_out);
  PERFORM pg_temp.l_assert(pg_temp.l_state($$SELECT public.admin_leads_list('{}'::jsonb)$$) = '42501', 'A1-T-1f an outsider is refused');
  RESET ROLE;

  -- A1-T-5f: link a card.
  INSERT INTO public.crm_records (pipeline, name, stage, created_by, updated_by) VALUES ('creators', 'Mix Person', 'identified', 'x@mingla-fixture.org', 'x@mingla-fixture.org') RETURNING id INTO v_rec;
  INSERT INTO public.crm_records (pipeline, name, stage, created_by, updated_by) VALUES ('creators', 'Mix Person Two', 'identified', 'x@mingla-fixture.org', 'x@mingla-fixture.org') RETURNING id INTO v_rec2;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.l_as(v_admin);
  v := public.admin_lead_link_crm(v_lead, v_rec);
  PERFORM pg_temp.l_assert(v->'crm'->>'pipeline' = 'creators', 'A1-T-5f A1-SC-29 linking a creators card');
  PERFORM pg_temp.l_assert(pg_temp.l_state(format($$SELECT public.admin_lead_link_crm(%L, %L)$$, v_lead, v_rec2)) = 'PT409',
    'A1-T-5f A1-SC-29 a lead linked elsewhere raises PT409');
  v := public.admin_lead_get(v_lead);
  PERFORM pg_temp.l_assert(v->'crm'->>'id' = v_rec::text AND jsonb_array_length(v->'events') = 2, 'A1 the drawer has the card and both events');
  PERFORM pg_temp.l_assert(v::text NOT LIKE '%TESTGCLID123%' AND (SELECT e->>'ad' FROM jsonb_array_elements(v->'events') e WHERE e->>'source' = 'form') = 'meta_click',
    'A1 the drawer ad line is the platform only, never the click id');
  -- The 10,000 cap.
  RESET ROLE;
  INSERT INTO public.leads (email_key, primary_label, labels, sources, first_seen_at, last_seen_at)
  SELECT format('bulk%s@bulk-fixture.org', g), 'host', ARRAY['host'], ARRAY['form'], now(), now() FROM generate_series(1, 10001) g;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.l_as(v_admin);
  PERFORM pg_temp.l_assert(pg_temp.l_state($$SELECT public.admin_leads_export('{}'::jsonb)$$) = '22023', 'A1-T-8b A1-SC-26 more than 10,000 rows is refused');
  RESET ROLE;
END
$t$;
ROLLBACK;
