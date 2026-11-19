\set ON_ERROR_STOP on
-- #4514 wave 1 brand forms: executable PostgreSQL 17 proof, after the full migration replay.
--
-- T-GRANT  SC-21  anon and signed-in have no write grant on any brand_form_* table; a direct
--                 insert or update as either fails; responses, links and door reads are unreadable.
-- T-DEF    SC-2   validate_brand_form_definition refuses: a 21st question; show_if to a later
--                 question, to a non single choice, two levels deep; file_upload; show_at_door on
--                 long_text; a 4th door question; a door_label over 16.
-- T-HOST   SC-1   create, save (PT409 on a stale rev, draft unchanged), publish; roles per C5.
-- T-ATT    SC-4   attach in each mode; below event manager refused; trip refuses on-page modes;
--                 stale attach PT409; another brand's form refused; one active form per page.
-- T-PUB           the public read has the mode, the required form and the brand header; the
--                 emergency switch reports no form.
-- T-SUB    SC-6/7/8/18/19/22/39  submit as RSVP, order, user and link subjects; hidden required
--                 question; wrong option; too long; nothing half-written; form X on event Y;
--                 form_changed; response_stale; form_closed; edit keeps one row; a non-holder
--                 writes nothing.
-- T-LINK   SC-20/22  a token for form X on form Y; revoked; past recognition; a forwarded link
--                 cannot read or change an existing answer without the one-time code.
-- T-READ          my_response and my_pending.
-- T-RESP   SC-16/17/21/32  counts per option equal the stored rows; not-answered list; another
--                 brand's host and a scanner are refused; export one column per question and version.
-- T-IMM    I-4514-FORM-VERSIONS-IMMUTABLE  versions cannot be updated or deleted.
-- T-DOOR*  SC-28/30/31, C4  the marked line uses the both-versions filter; no other event's guest;
--          no enumeration; full answers only when the form allows it or the caller is a manager;
--          every full read is logged; rate limited.
--
-- MINGLA-INVARIANT: I-4514-FORM-RESPONSES-BRAND-SCOPED | issue #4514 | a host of another brand, anon and a signed-in guest read no brand form responses through any RPC or table (T-GRANT, T-RESP here).
-- MINGLA-INVARIANT: I-4514-FORM-VERSIONS-IMMUTABLE | issue #4514 | published versions are never updated or deleted (T-IMM here; trigger in the migration).
-- MINGLA-INVARIANT: I-4514-DOOR-READ-ONE-GUEST-OF-THIS-EVENT | issue #4514 | scanner-role staff read answers only for one guest of the scanned event per call, only the marked line (both versions) when the host switch is off (T-DOOR here).
--
-- FAILS-ON-REVERT: dropping the both-versions EXISTS in brand_form_door_answers fails T-DOOR-2;
-- dropping the link.form_id check in brand_form_submit_core fails T-LINK-1; dropping the
-- show_if visibility in brand_form_check_answers fails T-SUB-3; dropping the brand rank check in
-- biz_brand_form_responses fails T-RESP-3; dropping the versions trigger fails T-IMM.

CREATE OR REPLACE FUNCTION pg_temp.f_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4514 brand forms FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.f_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN json_build_object('role', 'anon')::text
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
END
$a$;

-- 'ok', or SQLSTATE:message of what a statement raised.
CREATE OR REPLACE FUNCTION pg_temp.f_err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $a$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.f_user(p_tag text)
RETURNS uuid LANGUAGE plpgsql AS $a$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v, 'f4514-' || p_tag || '@example.test');
  RETURN v;
END
$a$;

-- A definition: Q1 single choice (door), Q2 short text shown only after Q1 = yes (required),
-- Q3 number (door, door label), Q4 date, Q5 long text.
CREATE OR REPLACE FUNCTION pg_temp.f_def(p_door_q3 boolean DEFAULT true, p_door_q4 boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql AS $a$
  SELECT jsonb_build_object('schema', 'mingla.brand_form.v1', 'title', 'A few questions', 'intro', 'Thanks',
    'questions', jsonb_build_array(
      jsonb_build_object('id', '11111111-1111-4111-8111-111111111111', 'position', 0, 'type', 'single_choice',
        'label', 'Would you like to perform?', 'required', true, 'show_at_door', true,
        'options', jsonb_build_array(jsonb_build_object('id', 'yes', 'label', 'Yes'), jsonb_build_object('id', 'no', 'label', 'No'))),
      jsonb_build_object('id', '22222222-2222-4222-8222-222222222222', 'position', 1, 'type', 'short_text',
        'label', 'What will you do?', 'help', 'One line', 'required', true,
        'show_if', jsonb_build_object('question_id', '11111111-1111-4111-8111-111111111111', 'option_id', 'yes')),
      jsonb_build_object('id', '33333333-3333-4333-8333-333333333333', 'position', 2, 'type', 'number',
        'label', 'How many in your group?', 'required', false, 'show_at_door', p_door_q3, 'door_label', 'Group'),
      jsonb_build_object('id', '44444444-4444-4444-8444-444444444444', 'position', 3, 'type', 'date',
        'label', 'Birthday', 'required', false, 'show_at_door', p_door_q4),
      jsonb_build_object('id', '55555555-5555-4555-8555-555555555555', 'position', 4, 'type', 'long_text',
        'label', 'Anything else?', 'required', false)));
$a$;

CREATE OR REPLACE FUNCTION pg_temp.f_q(p_def jsonb, p_i integer) RETURNS jsonb
LANGUAGE sql AS $a$ SELECT p_def->'questions'->p_i; $a$;

CREATE OR REPLACE FUNCTION pg_temp.f_codes(p_def jsonb) RETURNS text[]
LANGUAGE sql AS $a$
  SELECT COALESCE(array_agg(e.value->>'code'), '{}') FROM jsonb_array_elements(public.brand_form_definition_errors(p_def)) e;
$a$;

BEGIN;
CREATE TEMP TABLE f4514 (k text PRIMARY KEY, id uuid);
GRANT ALL ON f4514 TO authenticated, anon, service_role;
CREATE TEMP TABLE f4514t (k text PRIMARY KEY, val text);
GRANT ALL ON f4514t TO authenticated, anon, service_role;

-- ═══ Fixtures (triggers off while seeding the base rows) ═══════════════════════
DO $f$
DECLARE
  v_owner_a uuid := pg_temp.f_user('owner-a');
  v_mm_a uuid := pg_temp.f_user('mm-a');
  v_em_a uuid := pg_temp.f_user('em-a');
  v_scan_a uuid := pg_temp.f_user('scan-a');
  v_evscan uuid := pg_temp.f_user('evscan');
  v_owner_b uuid := pg_temp.f_user('owner-b');
  v_g1 uuid := pg_temp.f_user('g1');
  v_g2 uuid := pg_temp.f_user('g2');
  v_s uuid := pg_temp.f_user('stranger');
  v_ba uuid := gen_random_uuid(); v_bb uuid := gen_random_uuid();
  v_e1 uuid := gen_random_uuid(); v_e2 uuid := gen_random_uuid(); v_e3 uuid := gen_random_uuid();
  v_e4 uuid := gen_random_uuid(); v_e5 uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, theme_color, profile_photo_url, cover_media_url, cover_media_type)
  VALUES (v_ba, v_owner_a, 'Brand A', 'f4514-brand-a', 'USD', '#ff6600', 'https://example.test/a.png', 'https://example.test/a.jpg', 'image'),
         (v_bb, v_owner_b, 'Brand B', 'f4514-brand-b', 'USD', NULL, NULL, NULL, NULL);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (v_ba, v_owner_a, 'brand_owner', now()), (v_ba, v_mm_a, 'marketing_manager', now()),
         (v_ba, v_em_a, 'event_manager', now()), (v_ba, v_scan_a, 'scanner', now()),
         (v_bb, v_owner_b, 'brand_owner', now());
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_e1, v_ba, 'RSVP one', 'f4514-e1', 'rsvp', 'scheduled', 'public', 'UTC', 'USD'),
         (v_e2, v_ba, 'Ticketed', 'f4514-e2', 'event', 'scheduled', 'public', 'UTC', 'USD'),
         (v_e3, v_ba, 'Trip', 'f4514-e3', 'trip', 'scheduled', 'public', 'UTC', 'USD'),
         (v_e4, v_bb, 'Brand B event', 'f4514-e4', 'event', 'scheduled', 'public', 'UTC', 'USD'),
         (v_e5, v_ba, 'RSVP two', 'f4514-e5', 'rsvp', 'scheduled', 'public', 'UTC', 'USD');
  INSERT INTO public.event_scanners(event_id, user_id) VALUES (v_e1, v_evscan);
  PERFORM set_config('session_replication_role', 'origin', true);

  INSERT INTO f4514 VALUES ('owner_a', v_owner_a), ('mm_a', v_mm_a), ('em_a', v_em_a), ('scan_a', v_scan_a),
    ('evscan', v_evscan), ('owner_b', v_owner_b), ('g1', v_g1), ('g2', v_g2), ('s', v_s),
    ('ba', v_ba), ('bb', v_bb), ('e1', v_e1), ('e2', v_e2), ('e3', v_e3), ('e4', v_e4), ('e5', v_e5);
END
$f$;

DO $f$
DECLARE
  v_e1 uuid := (SELECT id FROM f4514 WHERE k = 'e1');
  v_e2 uuid := (SELECT id FROM f4514 WHERE k = 'e2');
  v_e5 uuid := (SELECT id FROM f4514 WHERE k = 'e5');
  v_g1 uuid := (SELECT id FROM f4514 WHERE k = 'g1');
  v_g2 uuid := (SELECT id FROM f4514 WHERE k = 'g2');
  v_r1 uuid := gen_random_uuid(); v_r2 uuid := gen_random_uuid(); v_r3 uuid := gen_random_uuid();
  v_r4 uuid := gen_random_uuid(); v_o1 uuid := gen_random_uuid(); v_o2 uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_r1, v_e1, v_g1, 'Gina One', 'f4514-g1@example.test', '+12025550101', 'going', 'approved'),
         (v_r2, v_e1, NULL, 'Link Guest', 'f4514-link@example.test', '+12025550102', 'going', 'approved'),
         (v_r3, v_e5, NULL, 'Other Event', 'f4514-other@example.test', '+12025550103', 'going', 'approved'),
         (v_r4, v_e1, NULL, 'Late Guest', 'f4514-late@example.test', '+12025550104', 'going', 'approved');
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source, is_door_sale)
  VALUES (v_o1, v_e2, v_g2, 'Gus Two', 'f4514-g2@example.test', '+12025550201', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false),
         (v_o2, v_e2, NULL, 'Door Buyer', NULL, NULL, 1000, 'USD', 'cash', 'paid', 'door_sale', true);
  PERFORM set_config('session_replication_role', 'origin', true);
  INSERT INTO f4514 VALUES ('r1', v_r1), ('r2', v_r2), ('r3', v_r3), ('r4', v_r4), ('o1', v_o1), ('o2', v_o2);
END
$f$;

-- ═══ T-GRANT ══════════════════════════════════════════════════════════════════
DO $t$
DECLARE v_t text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['brand_forms','brand_form_versions','brand_form_attachments','brand_form_responses',
                             'brand_form_links','brand_form_submit_attempts','brand_form_door_reads'] LOOP
    PERFORM pg_temp.f_assert(NOT has_table_privilege('anon', 'public.' || v_t, 'INSERT')
      AND NOT has_table_privilege('anon', 'public.' || v_t, 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.' || v_t, 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.' || v_t, 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.' || v_t, 'DELETE'),
      'T-GRANT SC-21 no anon/authenticated write grant on ' || v_t);
    PERFORM pg_temp.f_assert((SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_t)::regclass),
      'T-GRANT RLS on ' || v_t);
  END LOOP;
  PERFORM pg_temp.f_assert(NOT has_table_privilege('authenticated', 'public.brand_form_responses', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.brand_form_responses', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.brand_form_links', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.brand_form_door_reads', 'SELECT'),
    'T-GRANT responses, links and door reads have no client read grant');
  PERFORM pg_temp.f_assert(NOT has_function_privilege('authenticated', 'public.brand_form_submit_core(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.brand_form_submit_core(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.brand_form_door_answers(uuid,uuid,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.brand_form_door_full_answers(uuid,uuid,jsonb,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.brand_form_link_issue(uuid,uuid,jsonb,uuid,integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.brand_form_code_begin(uuid,text,text,text,text)', 'EXECUTE'),
    'T-GRANT the submit core, links, codes and door reads are service-role only');
  PERFORM pg_temp.f_assert(NOT has_function_privilege('anon', 'public.biz_brand_form_responses(uuid,uuid,text,integer,integer)', 'EXECUTE'),
    'T-GRANT anon cannot call the Responses RPC');
END
$t$;

DO $t$
DECLARE v_s uuid := (SELECT id FROM f4514 WHERE k = 's'); v_ba uuid := (SELECT id FROM f4514 WHERE k = 'ba'); v_r text;
BEGIN
  PERFORM pg_temp.f_as(v_s);
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$INSERT INTO public.brand_forms (brand_id, name, draft, created_by, updated_by)
           VALUES (%L, 'Sneaky', '{"schema":"mingla.brand_form.v1","questions":[]}', %L, %L)$$, v_ba, v_s, v_s));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-GRANT SC-21 a signed-in direct insert into brand_forms fails (' || v_r || ')');
  v_r := pg_temp.f_err($$UPDATE public.brand_form_responses SET answers = '{}'$$);
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-GRANT SC-21 a signed-in direct update of responses fails');
  RESET ROLE;
  PERFORM pg_temp.f_as(NULL);
  SET LOCAL ROLE anon;
  v_r := pg_temp.f_err($$INSERT INTO public.brand_form_responses (form_id, version_id, brand_id, user_id, answers, source)
           VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '{}', 'page')$$);
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-GRANT SC-21 an anon direct insert into responses fails');
  v_r := pg_temp.f_err($$SELECT count(*) FROM public.brand_forms$$);
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-GRANT anon cannot read brand_forms');
  RESET ROLE;
END
$t$;

-- ═══ T-DEF (SC-2) ═════════════════════════════════════════════════════════════
DO $t$
DECLARE
  v_ok jsonb := pg_temp.f_def();
  v jsonb;
  v_qs jsonb := '[]'::jsonb;
  i integer;
BEGIN
  PERFORM pg_temp.f_assert(public.validate_brand_form_definition(v_ok), 'T-DEF the sample definition is valid');
  FOR i IN 0..20 LOOP
    v_qs := v_qs || jsonb_build_object('id', format('aaaaaaaa-aaaa-4aaa-8aaa-%s', lpad(i::text, 12, '0')),
      'position', i, 'type', 'short_text', 'label', 'Q' || i, 'required', false);
  END LOOP;
  PERFORM pg_temp.f_assert('too_many_questions' = ANY (pg_temp.f_codes(jsonb_set(v_ok, '{questions}', v_qs))),
    'T-DEF SC-2 a 21st question is refused');
  -- show_if pointing at a LATER question
  v := jsonb_set(v_ok, '{questions,0,show_if}', jsonb_build_object('question_id', '22222222-2222-4222-8222-222222222222', 'option_id', 'yes'));
  v := jsonb_set(v, '{questions,1,show_if}', 'null'::jsonb);
  v := jsonb_set(v, '{questions,1,type}', '"single_choice"');
  v := jsonb_set(v, '{questions,1,options}', '[{"id":"yes","label":"Yes"},{"id":"no","label":"No"}]');
  PERFORM pg_temp.f_assert('show_if_not_earlier' = ANY (pg_temp.f_codes(v)), 'T-DEF SC-2 show_if to a later question is refused');
  -- show_if to a non single choice
  v := jsonb_set(v_ok, '{questions,4}', pg_temp.f_q(v_ok, 4) || jsonb_build_object('show_if',
         jsonb_build_object('question_id', '33333333-3333-4333-8333-333333333333', 'option_id', 'yes')));
  PERFORM pg_temp.f_assert('show_if_not_single_choice' = ANY (pg_temp.f_codes(v)), 'T-DEF SC-2 show_if to a number question is refused');
  -- two levels deep: Q2 (dependent) made a single choice, Q5 depends on Q2
  v := jsonb_set(v_ok, '{questions,1}', pg_temp.f_q(v_ok, 1) || '{"type":"single_choice","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}');
  v := jsonb_set(v, '{questions,4}', pg_temp.f_q(v_ok, 4) || jsonb_build_object('show_if',
         jsonb_build_object('question_id', '22222222-2222-4222-8222-222222222222', 'option_id', 'a')));
  PERFORM pg_temp.f_assert('show_if_too_deep' = ANY (pg_temp.f_codes(v)), 'T-DEF SC-2 show_if two levels deep is refused');
  v := jsonb_set(v_ok, '{questions,4,type}', '"file_upload"');
  PERFORM pg_temp.f_assert('file_upload_unavailable' = ANY (pg_temp.f_codes(v)), 'T-DEF SC-2 file_upload is refused');
  v := jsonb_set(v_ok, '{questions,4,show_at_door}', 'true');
  PERFORM pg_temp.f_assert('door_type_not_allowed' = ANY (pg_temp.f_codes(v)), 'T-DEF SC-2 show_at_door on long_text is refused');
  v := jsonb_set(pg_temp.f_def(true, true), '{questions,1,show_at_door}', 'true');
  PERFORM pg_temp.f_assert('too_many_door_questions' = ANY (pg_temp.f_codes(v)), 'T-DEF SC-2 a 4th door question is refused');
  PERFORM pg_temp.f_assert(NOT ('too_many_door_questions' = ANY (pg_temp.f_codes(pg_temp.f_def(true, true)))), 'T-DEF 3 door questions are allowed');
  v := jsonb_set(v_ok, '{questions,2,door_label}', '"Seventeen chars!!"');
  PERFORM pg_temp.f_assert('door_label_invalid' = ANY (pg_temp.f_codes(v)), 'T-DEF SC-2 a door_label over 16 is refused');
  v := jsonb_set(v_ok, '{questions,0,help}', to_jsonb(repeat('h', 301)));
  PERFORM pg_temp.f_assert('help_invalid' = ANY (pg_temp.f_codes(v)), 'T-DEF help over 300 is refused');
  PERFORM pg_temp.f_assert(NOT public.validate_brand_form_definition(v_ok - 'schema'), 'T-DEF the schema marker is required');
END
$t$;

-- ═══ T-HOST (SC-1) ════════════════════════════════════════════════════════════
DO $t$
DECLARE
  v_ba uuid := (SELECT id FROM f4514 WHERE k = 'ba');
  v jsonb; v_form uuid; v_r text; v_draft jsonb;
BEGIN
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'scan_a'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_create(%L, 'Scanner form')$$, v_ba));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-HOST a scanner cannot create a form');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'owner_b'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_create(%L, 'Cross brand')$$, v_ba));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-HOST another brand''s owner cannot create on brand A');
  RESET ROLE;

  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_create(v_ba, 'Performer questions');
  v_form := (v->>'formId')::uuid;
  PERFORM pg_temp.f_assert(v->>'status' = 'draft' AND (v->>'draftRev')::integer = 1, 'T-HOST a marketing manager creates a draft form');
  v := public.biz_brand_form_save_draft(v_form, pg_temp.f_def(), 1);
  PERFORM pg_temp.f_assert((v->>'draftRev')::integer = 2, 'T-HOST SC-1 save draft moves the rev');
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_save_draft(%L, %L::jsonb, 1)$$, v_form,
           jsonb_set(pg_temp.f_def(), '{title}', '"Stale"')));
  PERFORM pg_temp.f_assert(v_r LIKE 'PT409:form_draft_conflict%', 'T-HOST SC-1 a stale save raises PT409 (' || v_r || ')');
  SELECT draft INTO v_draft FROM public.brand_forms WHERE id = v_form;
  PERFORM pg_temp.f_assert(v_draft->>'title' = 'A few questions', 'T-HOST SC-1 a stale save leaves the draft unchanged');
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_save_draft(%L, %L::jsonb, 2)$$, v_form,
           jsonb_set(pg_temp.f_def(), '{questions,4,type}', '"file_upload"')));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:invalid_definition%', 'T-HOST an invalid draft is refused');
  v := public.biz_brand_form_publish(v_form, 2);
  PERFORM pg_temp.f_assert(v->>'status' = 'live' AND (v->>'version')::integer = 1, 'T-HOST SC-1 publish makes version 1 live');
  RESET ROLE;
  INSERT INTO f4514 VALUES ('form', v_form), ('v1', (v->>'versionId')::uuid);

  -- A second form (Y) for the cross-form link test.
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_create(v_ba, 'Form Y', pg_temp.f_def());
  v := public.biz_brand_form_publish((v->>'formId')::uuid, 1);
  RESET ROLE;
  INSERT INTO f4514 VALUES ('form_y', (SELECT id FROM public.brand_forms WHERE name = 'Form Y'));
END
$t$;

-- ═══ T-ATT (SC-4) ═════════════════════════════════════════════════════════════
DO $t$
DECLARE
  v_form uuid := (SELECT id FROM f4514 WHERE k = 'form');
  v_form_y uuid := (SELECT id FROM f4514 WHERE k = 'form_y');
  v_e1 uuid := (SELECT id FROM f4514 WHERE k = 'e1');
  v_e2 uuid := (SELECT id FROM f4514 WHERE k = 'e2');
  v_e3 uuid := (SELECT id FROM f4514 WHERE k = 'e3');
  v_e4 uuid := (SELECT id FROM f4514 WHERE k = 'e4');
  v_e5 uuid := (SELECT id FROM f4514 WHERE k = 'e5');
  v jsonb; v_r text; v_att uuid;
BEGIN
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_attach(%L, %L, 'required_step')$$, v_form, v_e1));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-ATT SC-4 below event manager cannot attach');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'em_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_attach(v_form, v_e1, 'optional_on_page');
  v_att := (v->>'attachmentId')::uuid;
  PERFORM pg_temp.f_assert(v->>'mode' = 'optional_on_page' AND (v->>'existingGuests')::integer = 3,
    'T-ATT attach optional_on_page, with the earlier-guest count');
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_attach(%L, %L, 'required_step')$$, v_form, v_e1));
  PERFORM pg_temp.f_assert(v_r LIKE 'PT409:attachment_conflict%', 'T-ATT a stale attach raises PT409');
  v := public.biz_brand_form_attach(v_form, v_e1, 'required_step', false, v_att);
  PERFORM pg_temp.f_assert(v->>'mode' = 'required_step' AND (v->>'replacedAttachmentId')::uuid = v_att,
    'T-ATT changing the mode replaces the active attachment');
  INSERT INTO f4514 VALUES ('att_e1', (v->>'attachmentId')::uuid);
  v := public.biz_brand_form_attach(v_form, v_e2, 'after_purchase');
  PERFORM pg_temp.f_assert(v->>'mode' = 'after_purchase', 'T-ATT attach after_purchase');
  v := public.biz_brand_form_attach(v_form, v_e2, 'optional_on_page', false, (v->>'attachmentId')::uuid);
  PERFORM pg_temp.f_assert(v->>'mode' = 'optional_on_page', 'T-ATT attach optional on the ticketed event');
  v := public.biz_brand_form_attach(v_form_y, v_e5, 'required_step');
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_attach(%L, %L, 'required_step')$$, v_form, v_e3));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:trip_uses_intake%', 'T-ATT a trip refuses required_step (trip_uses_intake)');
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_attach(%L, %L, 'optional_on_page')$$, v_form, v_e3));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:trip_uses_intake%', 'T-ATT a trip refuses optional_on_page');
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_attach(%L, %L, 'required_step')$$, v_form, v_e4));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-ATT brand A''s event manager cannot attach on brand B''s event');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'owner_b'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_attach(%L, %L, 'required_step')$$, v_form, v_e4));
  PERFORM pg_temp.f_assert(v_r LIKE 'P0002:form_not_found%', 'T-ATT an attachment pointing at another brand''s form is refused');
  RESET ROLE;
  v_r := pg_temp.f_err(format($$INSERT INTO public.brand_form_attachments (form_id, brand_id, event_id, created_by)
           VALUES (%L, (SELECT id FROM f4514 WHERE k = 'bb'), %L, gen_random_uuid())$$, v_form, v_e4));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:attachment_brand_mismatch%', 'T-ATT the trigger refuses a cross-brand attachment row');
  v_r := pg_temp.f_err(format($$INSERT INTO public.brand_form_attachments (form_id, brand_id, event_id, created_by)
           VALUES (%L, (SELECT id FROM f4514 WHERE k = 'ba'), %L, gen_random_uuid())$$, v_form, v_e1));
  PERFORM pg_temp.f_assert(v_r LIKE '23505:%', 'T-ATT one active form per page');
END
$t$;

-- ═══ T-PUB ════════════════════════════════════════════════════════════════════
DO $t$
DECLARE v jsonb; v_e1 uuid := (SELECT id FROM f4514 WHERE k = 'e1'); v_e3 uuid := (SELECT id FROM f4514 WHERE k = 'e3');
BEGIN
  PERFORM pg_temp.f_as(NULL);
  SET LOCAL ROLE anon;
  v := public.public_brand_form_for_event(v_e1);
  PERFORM pg_temp.f_assert(v->>'active' = 'true' AND v->>'mode' = 'required_step'
    AND (v->'requiredForm'->>'versionId')::uuid = (SELECT id FROM f4514 WHERE k = 'v1')
    AND v->'brand'->>'displayName' = 'Brand A' AND v->'brand'->>'accent' = '#ff6600'
    AND v->'brand'->>'coverMediaUrl' = 'https://example.test/a.jpg'
    AND jsonb_array_length(v->'definition'->'questions') = 5 AND NOT (v ? 'rows'),
    'T-PUB the public read has the mode, the required form, the definition and the brand header');
  PERFORM pg_temp.f_assert(public.public_brand_form_for_event(v_e3)->>'active' = 'false', 'T-PUB a page with no form reports none');
  RESET ROLE;
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'BRAND_FORMS_KILL_SWITCH';
  SET LOCAL ROLE anon;
  v := public.public_brand_form_for_event(v_e1);
  PERFORM pg_temp.f_assert(v->>'active' = 'false' AND v->>'switchedOff' = 'true', 'T-PUB OP-7 switched off: no required form');
  RESET ROLE;
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'BRAND_FORMS_KILL_SWITCH';
END
$t$;

-- ═══ T-SUB ════════════════════════════════════════════════════════════════════
DO $t$
DECLARE
  v_form uuid := (SELECT id FROM f4514 WHERE k = 'form');
  v_g1 uuid := (SELECT id FROM f4514 WHERE k = 'g1');
  v_g2 uuid := (SELECT id FROM f4514 WHERE k = 'g2');
  v_s uuid := (SELECT id FROM f4514 WHERE k = 's');
  v_r1 uuid := (SELECT id FROM f4514 WHERE k = 'r1');
  v_o1 uuid := (SELECT id FROM f4514 WHERE k = 'o1');
  v_e5 uuid := (SELECT id FROM f4514 WHERE k = 'e5');
  v jsonb; v_r text; v_n integer; v_ans jsonb;
  c_yes constant jsonb := '{"11111111-1111-4111-8111-111111111111":"yes","22222222-2222-4222-8222-222222222222":"Juggling","33333333-3333-4333-8333-333333333333":4,"44444444-4444-4444-8444-444444444444":"1990-02-03"}';
BEGIN
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM public.brand_form_responses;
  -- SC-6: the visible required follow-up is missing.
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'answers', jsonb_build_object('11111111-1111-4111-8111-111111111111', 'yes'),
           'credential', jsonb_build_object('kind', 'user', 'userId', v_g1, 'rsvpId', v_r1))));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:form_answers_invalid%', 'T-SUB SC-6 a visible required question missing: form_answers_invalid');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'answers', jsonb_build_object('11111111-1111-4111-8111-111111111111', 'maybe'),
           'credential', jsonb_build_object('kind', 'user', 'userId', v_g1, 'rsvpId', v_r1))));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:form_answers_invalid%', 'T-SUB a wrong option id: form_answers_invalid');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'answers', c_yes || jsonb_build_object('22222222-2222-4222-8222-222222222222', repeat('x', 201)),
           'credential', jsonb_build_object('kind', 'user', 'userId', v_g1, 'rsvpId', v_r1))));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:form_answers_invalid%', 'T-SUB text too long: form_answers_invalid');
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_responses) = v_n, 'T-SUB SC-6 failing answers write no row');

  -- SC-7: the hidden required question does not block, and its answer is dropped.
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_form, 'source', 'pass',
         'answers', jsonb_build_object('11111111-1111-4111-8111-111111111111', 'no', '22222222-2222-4222-8222-222222222222', 'Hidden text'),
         'credential', jsonb_build_object('kind', 'user', 'userId', v_g1, 'rsvpId', v_r1)));
  SELECT answers INTO v_ans FROM public.brand_form_responses WHERE id = (v->>'responseId')::uuid;
  PERFORM pg_temp.f_assert(v->>'created' = 'true' AND NOT (v_ans ? '22222222-2222-4222-8222-222222222222'),
    'T-SUB-3 SC-7 a hidden required question does not block and its answer is dropped');
  PERFORM pg_temp.f_assert((SELECT rsvp_id FROM public.brand_form_responses WHERE id = (v->>'responseId')::uuid) = v_r1,
    'T-SUB the RSVP subject is recorded (pass)');
  INSERT INTO f4514 VALUES ('resp_r1', (v->>'responseId')::uuid);

  -- SC-19 / stale: a second save without the edit count is stale; with it, one row and edit_count 1.
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'answers', c_yes, 'credential', jsonb_build_object('kind', 'user', 'userId', v_g1, 'rsvpId', v_r1))));
  PERFORM pg_temp.f_assert(v_r LIKE 'PT409:response_stale%', 'T-SUB two devices: a save from an old view raises PT409');
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_form, 'answers', c_yes, 'expectedEditCount', 0,
         'credential', jsonb_build_object('kind', 'user', 'userId', v_g1, 'rsvpId', v_r1)));
  PERFORM pg_temp.f_assert((v->>'editCount')::integer = 1 AND v->>'created' = 'false'
    AND (SELECT count(*) FROM public.brand_form_responses WHERE form_id = v_form AND rsvp_id = v_r1) = 1,
    'T-SUB SC-19 an edit keeps one row and counts the edit');

  -- Order subject; a non-holder writes nothing.
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'answers', c_yes, 'credential', jsonb_build_object('kind', 'user', 'userId', v_s, 'orderId', v_o1))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:not_holder%', 'T-SUB SC-39 a non-holder''s submit is refused');
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_form, 'answers', c_yes,
         'credential', jsonb_build_object('kind', 'user', 'userId', v_g2, 'orderId', v_o1)));
  PERFORM pg_temp.f_assert((SELECT order_id FROM public.brand_form_responses WHERE id = (v->>'responseId')::uuid) = v_o1,
    'T-SUB the order subject is recorded');

  -- User subject with no page.
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_form, 'answers', c_yes,
         'credential', jsonb_build_object('kind', 'user', 'userId', v_s)));
  PERFORM pg_temp.f_assert((SELECT user_id FROM public.brand_form_responses WHERE id = (v->>'responseId')::uuid) = v_s,
    'T-SUB the user subject is recorded');
  -- Form X's answers sent to event Y (which carries form Y).
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'eventId', v_e5, 'answers', c_yes, 'expectedEditCount', 0, 'credential', jsonb_build_object('kind', 'user', 'userId', v_s))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:form_not_on_event%', 'T-SUB form X''s answers for event Y are refused');
  RESET ROLE;
END
$t$;

-- ═══ T-LINK (SC-20, SC-22) ════════════════════════════════════════════════════
DO $t$
DECLARE
  v_form uuid := (SELECT id FROM f4514 WHERE k = 'form');
  v_form_y uuid := (SELECT id FROM f4514 WHERE k = 'form_y');
  v_e1 uuid := (SELECT id FROM f4514 WHERE k = 'e1');
  v_r2 uuid := (SELECT id FROM f4514 WHERE k = 'r2');
  v_r4 uuid := (SELECT id FROM f4514 WHERE k = 'r4');
  v_r3 uuid := (SELECT id FROM f4514 WHERE k = 'r3');
  v jsonb; v_token text; v_token2 text; v_r text; v_ch uuid := gen_random_uuid(); v_n integer;
  c_no constant jsonb := '{"11111111-1111-4111-8111-111111111111":"no"}';
BEGIN
  SET LOCAL ROLE service_role;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_link_issue(%L, %L, %L::jsonb)$$, v_form, v_e1,
           jsonb_build_object('kind', 'rsvp', 'id', v_r3)));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:subject_other_event%', 'T-LINK a link for a guest of another event is refused');
  v := public.brand_form_link_issue(v_form, v_e1, jsonb_build_object('kind', 'rsvp', 'id', v_r2));
  v_token := v->>'token';
  PERFORM pg_temp.f_assert(char_length(v_token) = 64 AND NOT EXISTS (SELECT 1 FROM public.brand_form_links WHERE token_hash = v_token)
    AND EXISTS (SELECT 1 FROM public.brand_form_links WHERE token_hash = public.brand_form_token_hash(v_token)),
    'T-LINK the raw token is never stored, only its hash');
  PERFORM pg_temp.f_assert(public.brand_form_link_resolve(v_token)->>'identity' = 'Link G.'
    AND public.brand_form_link_resolve(v_token)->'channels' = '["email","phone"]'::jsonb,
    'T-LINK resolve gives the first name and initial and the channels on file');

  -- SC-22: a token minted for form X is refused on form Y.
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form_y,
           'answers', c_no, 'credential', jsonb_build_object('kind', 'link', 'token', v_token))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:link_wrong_form%', 'T-LINK-1 SC-22 a token for form X is refused on form Y (' || v_r || ')');
  -- A first answer through the link needs no code.
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_form, 'source', 'link', 'answers', c_no,
         'credential', jsonb_build_object('kind', 'link', 'token', v_token)));
  PERFORM pg_temp.f_assert(v->>'created' = 'true'
    AND (SELECT rsvp_id = v_r2 AND via_link FROM public.brand_form_responses WHERE id = (v->>'responseId')::uuid),
    'T-LINK a first answer through a personal link is saved to that person, marked via link');
  -- SC-20: the forwarded link cannot change or show the existing answer without the code.
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'answers', c_no, 'expectedEditCount', 0, 'credential', jsonb_build_object('kind', 'link', 'token', v_token))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:code_required%', 'T-LINK SC-20 a forwarded link cannot change an existing answer');
  RESET ROLE;
  PERFORM pg_temp.f_as(NULL);
  SET LOCAL ROLE anon;
  v := public.brand_form_my_response(v_form, NULL, v_token, NULL);
  PERFORM pg_temp.f_assert(v->>'state' = 'code_required' AND NOT (v ? 'response'),
    'T-LINK SC-20 a forwarded link cannot read an existing answer');
  RESET ROLE;

  -- The code (C2): begin with an email code hash, settle on the existing #4063 rail.
  SET LOCAL ROLE service_role;
  v := public.brand_form_code_begin(v_ch, v_token, 'email', public.brand_form_token_hash('123456'), repeat('a', 64));
  PERFORM pg_temp.f_assert(v->>'outcome' = 'started' AND v->>'target' = 'f4514-link@example.test',
    'T-LINK the code goes to the contact on file');
  v := public.issue_4063_settle_contact_challenge(v_ch, public.brand_form_token_hash('000000'), false);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'bad_code', 'T-LINK a wrong code is refused');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'answers', c_no, 'expectedEditCount', 0, 'credential', jsonb_build_object('kind', 'link', 'token', v_token, 'challengeId', v_ch))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:code_required%', 'T-LINK an unsettled challenge grants nothing');
  v := public.issue_4063_settle_contact_challenge(v_ch, public.brand_form_token_hash('123456'), false);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'ok', 'T-LINK the right code settles');
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_form, 'answers', c_no, 'expectedEditCount', 0,
         'credential', jsonb_build_object('kind', 'link', 'token', v_token, 'challengeId', v_ch)));
  PERFORM pg_temp.f_assert((v->>'editCount')::integer = 1
    AND (SELECT count(*) FROM public.brand_form_responses WHERE form_id = v_form AND rsvp_id = v_r2) = 1,
    'T-LINK SC-22 reusing a valid token with the code edits the same response');
  RESET ROLE;
  SET LOCAL ROLE anon;
  v := public.brand_form_my_response(v_form, NULL, v_token, v_ch);
  PERFORM pg_temp.f_assert(v->>'state' = 'answered' AND v->'response'->'answers' = c_no,
    'T-LINK with the code the person sees their answer');
  RESET ROLE;

  -- Revoked, and past recognition (C2: the code is needed even for a first answer).
  SET LOCAL ROLE service_role;
  v := public.brand_form_link_issue(v_form, v_e1, jsonb_build_object('kind', 'rsvp', 'id', v_r4));
  v_token2 := v->>'token';
  UPDATE public.brand_form_links SET expires_at = now() - interval '1 minute' WHERE id = (v->>'linkId')::uuid;
  SELECT count(*) INTO v_n FROM public.brand_form_responses;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'answers', c_no, 'credential', jsonb_build_object('kind', 'link', 'token', v_token2))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:code_required%' AND (SELECT count(*) FROM public.brand_form_responses) = v_n,
    'T-LINK SC-22 a link past recognition asks for the code and writes nothing');
  UPDATE public.brand_form_links SET revoked_at = now() WHERE id = (v->>'linkId')::uuid;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'answers', c_no, 'credential', jsonb_build_object('kind', 'link', 'token', v_token2))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:link_revoked%', 'T-LINK SC-22 a revoked token is refused');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'answers', c_no, 'credential', jsonb_build_object('kind', 'link', 'token', repeat('0', 64)))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:link_invalid%', 'T-LINK an unknown token is refused');
  RESET ROLE;
  INSERT INTO f4514t VALUES ('token_r2', v_token);
END
$t$;

-- ═══ T-READ ═══════════════════════════════════════════════════════════════════
DO $t$
DECLARE
  v_form uuid := (SELECT id FROM f4514 WHERE k = 'form');
  v_e1 uuid := (SELECT id FROM f4514 WHERE k = 'e1');
  v_e2 uuid := (SELECT id FROM f4514 WHERE k = 'e2');
  v jsonb;
BEGIN
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'g1'));
  SET LOCAL ROLE authenticated;
  v := public.brand_form_my_response(v_form, v_e1);
  PERFORM pg_temp.f_assert(v->>'state' = 'answered' AND v->'response'->>'editCount' = '1'
    AND v->'brand'->>'displayName' = 'Brand A', 'T-READ a signed-in guest reads their own answer with the brand header');
  v := public.brand_forms_my_pending();
  PERFORM pg_temp.f_assert(jsonb_array_length(v) = 1 AND (v->0->>'eventId')::uuid = v_e1 AND v->0->>'answered' = 'true'
    AND v->0->>'required' = 'true', 'T-READ my pending lists the held RSVP, answered');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'g2'));
  SET LOCAL ROLE authenticated;
  v := public.brand_forms_my_pending();
  PERFORM pg_temp.f_assert(jsonb_array_length(v) = 1 AND (v->0->>'eventId')::uuid = v_e2, 'T-READ my pending lists the held order');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'owner_b'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.f_assert(public.brand_forms_my_pending() = '[]'::jsonb, 'T-READ SC-39 nothing for events the caller does not hold');
  v := public.brand_form_my_response(v_form, v_e1);
  PERFORM pg_temp.f_assert(v->>'state' = 'unanswered' AND v->'response' = 'null'::jsonb,
    'T-READ another signed-in person sees no one else''s answer');
  RESET ROLE;
END
$t$;

-- ═══ T-RESP (SC-16, SC-17, SC-21, SC-32) and versions ════════════════════════
DO $t$
DECLARE
  v_form uuid := (SELECT id FROM f4514 WHERE k = 'form');
  v_e1 uuid := (SELECT id FROM f4514 WHERE k = 'e1');
  v_g1 uuid := (SELECT id FROM f4514 WHERE k = 'g1');
  v jsonb; v_r text; v_expected jsonb; v_rev integer; v_v2 uuid;
BEGIN
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_responses(v_form, v_e1);
  RESET ROLE;
  -- Counts per option straight from the stored rows of this event.
  SELECT jsonb_object_agg(x.qid, x.opts) INTO v_expected FROM (
    SELECT a.key AS qid, jsonb_object_agg(a.value #>> '{}', a.n) AS opts FROM (
      SELECT a.key, a.value, count(*) AS n FROM public.brand_form_responses r CROSS JOIN LATERAL jsonb_each(r.answers) a
       WHERE r.form_id = v_form AND r.rsvp_id IN (SELECT id FROM public.event_rsvps WHERE event_id = v_e1)
         AND a.key = '11111111-1111-4111-8111-111111111111'
       GROUP BY a.key, a.value) a GROUP BY a.key) x;
  PERFORM pg_temp.f_assert((v->>'total')::integer = 2 AND v->'counts' = v_expected,
    'T-RESP SC-16 counts per option equal the stored rows (' || (v->'counts')::text || ')');
  PERFORM pg_temp.f_assert(jsonb_array_length(v->'notAnswered') = 1
    AND (v->'notAnswered'->0->>'id')::uuid = (SELECT id FROM f4514 WHERE k = 'r4'),
    'T-RESP SC-16 the not-answered list has only the guest who has not answered');
  PERFORM pg_temp.f_assert(NOT (v->'rows'->0->'subject' ? 'email'), 'T-RESP rows carry names, not contact details');

  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'owner_b'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_responses(%L, %L)$$, v_form, v_e1));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-RESP-3 SC-21 another brand''s host cannot read responses');
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_responses_export(%L, %L)$$, v_form, v_e1));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-RESP SC-21 another brand''s host cannot export');
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_forms WHERE brand_id = (SELECT id FROM f4514 WHERE k = 'ba')) = 0,
    'T-RESP SC-21 RLS: another brand''s host sees none of brand A''s forms');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'scan_a'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_responses(%L, %L)$$, v_form, v_e1));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-RESP SC-32 a scanner cannot call the Responses RPC');
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_responses_export(%L, %L)$$, v_form, v_e1));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-RESP SC-32 a scanner cannot export');
  v_r := pg_temp.f_err(format($$SELECT public.biz_guest_roster_access(%L)$$, v_e1));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-RESP SC-32 a scanner cannot open the roster');
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_forms) = 0, 'T-RESP RLS: a scanner sees no forms');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_responses_export(%L, %L)$$, v_form, v_e1));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-RESP C5 export needs event manager');
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_forms WHERE id = v_form) = 1, 'T-RESP RLS: a marketing manager reads the form');

  -- Republish (v2): Q3 no longer at the door, Q4 now at the door.
  SELECT draft_rev INTO v_rev FROM public.brand_forms WHERE id = v_form;
  v := public.biz_brand_form_save_draft(v_form, pg_temp.f_def(false, true), v_rev);
  v := public.biz_brand_form_publish(v_form, (v->>'draftRev')::integer);
  v_v2 := (v->>'versionId')::uuid;
  PERFORM pg_temp.f_assert((v->>'version')::integer = 2, 'T-RESP publishing changes makes version 2');
  v := public.biz_brand_form_responses(v_form, v_e1, 'earlier_version');
  PERFORM pg_temp.f_assert((v->>'total')::integer = 2 AND v->'rows'->0->>'earlierVersion' = 'true'
    AND (v->'versions' ? (SELECT id FROM f4514 WHERE k = 'v1')::text),
    'T-RESP SC-17 old answers keep their version and show as an earlier version');
  RESET ROLE;
  INSERT INTO f4514 VALUES ('v2', v_v2);

  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'em_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_responses_export(v_form, v_e1);
  PERFORM pg_temp.f_assert(jsonb_array_length(v->'columns') = 10 AND jsonb_array_length(v->'rows') = 2
    AND (SELECT bool_and(r.value->'values' ? ('1:11111111-1111-4111-8111-111111111111')) FROM jsonb_array_elements(v->'rows') r),
    'T-RESP SC-16 the export has one column per question per version');
  RESET ROLE;

  -- SC-8: a newer published version returns form_changed and writes nothing.
  SET LOCAL ROLE service_role;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'versionId', (SELECT id FROM f4514 WHERE k = 'v1'), 'answers', '{"11111111-1111-4111-8111-111111111111":"no"}'::jsonb,
           'expectedEditCount', 1, 'credential', jsonb_build_object('kind', 'user', 'userId', v_g1, 'rsvpId', (SELECT id FROM f4514 WHERE k = 'r1')))));
  PERFORM pg_temp.f_assert(v_r LIKE 'PT409:form_changed%', 'T-SUB SC-8 an older version id returns form_changed (PT409)');
  PERFORM pg_temp.f_assert((SELECT version_id FROM public.brand_form_responses WHERE id = (SELECT id FROM f4514 WHERE k = 'resp_r1'))
    = (SELECT id FROM f4514 WHERE k = 'v1'), 'T-SUB SC-8 form_changed wrote nothing');
  RESET ROLE;

  -- SC-18: closed refuses submits; reopen.
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  PERFORM public.biz_brand_form_close(v_form);
  RESET ROLE;
  SET LOCAL ROLE service_role;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'answers', '{"11111111-1111-4111-8111-111111111111":"no"}'::jsonb, 'expectedEditCount', 1,
           'credential', jsonb_build_object('kind', 'user', 'userId', v_g1, 'rsvpId', (SELECT id FROM f4514 WHERE k = 'r1')))));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:form_closed%', 'T-SUB SC-18 a closed form refuses submits (form_closed)');
  RESET ROLE;
  SET LOCAL ROLE anon;
  PERFORM pg_temp.f_assert(public.public_brand_form_for_event(v_e1)->>'active' = 'false', 'T-PUB a closed form is not offered on the page');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.f_assert(public.biz_brand_form_reopen(v_form)->>'status' = 'live', 'T-HOST reopen');
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_archive(%L)$$, v_form));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:form_attached%', 'T-HOST archiving a form still on a page is refused');
  RESET ROLE;
END
$t$;

-- ═══ T-IMM ════════════════════════════════════════════════════════════════════
DO $t$
DECLARE v_form uuid := (SELECT id FROM f4514 WHERE k = 'form'); v_r text;
BEGIN
  v_r := pg_temp.f_err(format($$UPDATE public.brand_form_versions SET definition_sha256 = repeat('0', 64) WHERE form_id = %L$$, v_form));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:brand_form_version_immutable%', 'T-IMM a version cannot be updated (' || v_r || ')');
  v_r := pg_temp.f_err(format($$DELETE FROM public.brand_form_versions WHERE form_id = %L$$, v_form));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:brand_form_version_immutable%', 'T-IMM a version cannot be deleted');
  v_r := pg_temp.f_err(format($$UPDATE public.brand_forms SET live_version_id = (SELECT id FROM public.brand_form_versions WHERE form_id = %L LIMIT 1) WHERE id = %L$$,
           (SELECT id FROM f4514 WHERE k = 'form_y'), v_form));
  PERFORM pg_temp.f_assert(v_r LIKE '23503:live_version_other_form%', 'T-IMM a live pointer to another form''s version is refused');
END
$t$;

-- ═══ T-DOOR (SC-28, SC-30, SC-31, C4) ═════════════════════════════════════════
DO $t$
DECLARE
  v_e1 uuid := (SELECT id FROM f4514 WHERE k = 'e1');
  v_e2 uuid := (SELECT id FROM f4514 WHERE k = 'e2');
  v_e5 uuid := (SELECT id FROM f4514 WHERE k = 'e5');
  v_evscan uuid := (SELECT id FROM f4514 WHERE k = 'evscan');
  v_scan_a uuid := (SELECT id FROM f4514 WHERE k = 'scan_a');
  v_em_a uuid := (SELECT id FROM f4514 WHERE k = 'em_a');
  v_owner_b uuid := (SELECT id FROM f4514 WHERE k = 'owner_b');
  v_form uuid := (SELECT id FROM f4514 WHERE k = 'form');
  v jsonb; v_r text; v_n integer;
BEGIN
  SET LOCAL ROLE service_role;
  -- G1 answered v1 (Q1 yes, Q3 4, Q4 1990-02-03). v2 marks Q1 and Q4; v1 marked Q1 and Q3.
  v := public.brand_form_door_answers(v_evscan, v_e1, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'r1')));
  PERFORM pg_temp.f_assert(v->>'state' = 'answered' AND jsonb_array_length(v->'items') = 1
    AND v->'items'->0->>'label' = 'Would you like to perform?' AND v->'items'->0->>'value' = 'Yes',
    'T-DOOR-2 SC-30 only questions marked in both the answered and the live version show (' || v::text || ')');
  -- SC-28: required form, no answer.
  v := public.brand_form_door_answers(v_evscan, v_e1, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'r4')));
  PERFORM pg_temp.f_assert(v->>'state' = 'not_answered' AND v->>'formName' = 'Performer questions',
    'T-DOOR SC-28 a required form with no answer shows "Questions not answered"');
  -- Optional form, door sale with no answer: nothing (no key).
  v := public.brand_form_door_answers(v_em_a, v_e2, jsonb_build_object('kind', 'order', 'id', (SELECT id FROM f4514 WHERE k = 'o2')));
  PERFORM pg_temp.f_assert(v IS NULL, 'T-DOOR SC-31 nothing to show gives no key (optional form, door sale)');
  v := public.brand_form_door_answers(v_em_a, v_e5, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'r3')));
  PERFORM pg_temp.f_assert(v->>'state' = 'not_answered', 'T-DOOR form Y on event 5 reads its own not-answered line');
  -- Another event's guest, another event, another brand.
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_door_answers(%L, %L, %L::jsonb)$$, v_evscan, v_e1,
           jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'r3'))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:subject_other_event%', 'T-DOOR another event''s guest is refused');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_door_full_answers(%L, %L, %L::jsonb)$$, v_evscan, v_e5,
           jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'r3'))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:forbidden%', 'T-DOOR an event scanner cannot read at another event');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_door_answers(%L, %L, %L::jsonb)$$, v_owner_b, v_e1,
           jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'r1'))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:forbidden%', 'T-DOOR another brand''s owner is refused at this door');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_door_full_answers(%L, %L, %L::jsonb)$$, v_scan_a, v_e1,
           '{"kind":"rsvp","id":null}'::jsonb));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:subject_invalid%', 'T-DOOR no enumeration: a subject is required');

  -- C4: scanner-role staff open one guest's full answers (setting on), logged.
  SELECT count(*) INTO v_n FROM public.brand_form_door_reads;
  v := public.brand_form_door_full_answers(v_scan_a, v_e1, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'r1')), 'scan');
  PERFORM pg_temp.f_assert(v->>'state' = 'answered' AND jsonb_array_length(v->'questions') = 5
    AND v->>'isCurrentVersion' = 'false' AND v->'brand'->>'displayName' = 'Brand A',
    'T-DOOR C4 a scanner opens one guest''s full answers when the form allows it');
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_door_reads) = v_n + 1
    AND EXISTS (SELECT 1 FROM public.brand_form_door_reads WHERE actor_id = v_scan_a AND result = 'full' AND via = 'scan'),
    'T-DOOR C4 every full read is logged with who, which guest and when');
  UPDATE public.brand_forms SET door_full_answers = false WHERE id = v_form;
  v := public.brand_form_door_full_answers(v_scan_a, v_e1, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'r1')), 'search');
  PERFORM pg_temp.f_assert(v->>'state' = 'line_only' AND NOT (v ? 'questions')
    AND jsonb_array_length(v->'line'->'items') = 1,
    'T-DOOR-3 setting off with scanner rank: the marked line only');
  v := public.brand_form_door_full_answers(v_em_a, v_e1, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'r1')), 'search');
  PERFORM pg_temp.f_assert(v->>'state' = 'answered', 'T-DOOR setting off: an event manager still reads the full answers');
  -- Rate limit.
  INSERT INTO public.brand_form_door_reads (actor_id, event_id, subject_kind, subject_id, via, result)
  SELECT v_evscan, v_e1, 'rsvp', (SELECT id FROM f4514 WHERE k = 'r1'), 'scan', 'full' FROM generate_series(1, 60);
  v := public.brand_form_door_full_answers(v_evscan, v_e1, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'r1')), 'scan');
  PERFORM pg_temp.f_assert(v->>'state' = 'rate_limited', 'T-DOOR C4 full reads are rate limited');
  RESET ROLE;
END
$t$;

ROLLBACK;
