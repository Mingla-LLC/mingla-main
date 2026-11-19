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
-- Wave 1 review fixes ("Independent review of wave 1: FAIL" on #4514):
-- T-PERSON  1/2  a signed-in answer, then a personal-link submit without the code is refused, one
--                row, the scan line unchanged; user then RSVP id, RSVP then user, user then order
--                id: one row, the right edit count; the lock is on the person.
-- T-HOSTILE 3    every answer type with hostile input returns a validation error and never raises.
-- T-CLOSE   2/4  closing keeps the scan line; a not-going, denied RSVP and a refunded order get
--                nothing from the full read.
-- T-HEADER  10   another ticket of the order carries "From {name}'s order"; a transferred ticket
--                shows none of the order's answers.
-- T-DOORX   5    another event's scanner gets nothing; the per-actor lock; repeated calls hit 60.
-- T-VERS    7    no truncate, delete or update on versions for the service role; the truncate trigger.
-- T-CODE    8    the address throttle counts form codes only; the per-phone limit applies.
-- T-NOPAGE  6    a signed-in submit with no page carrying the form is refused.
-- T-PUBVIS / T-MINE 10  page visibility on the public read; who gets a form's questions.
-- Wave 3 fix wave ("Wave 3 review (conductor gate): NEEDS WORK" on #4514):
-- T-FIX-RANK   1  an event manager runs the answers-only export; the roster export stays brand_admin.
-- T-FIX-BEGIN  5  no code for a first answer inside recognition (the same refusal as an unknown
--                 token); past recognition one starts; open links refused; per-link and
--                 per-contact-per-day send limits (per-address and per-phone: T-CODE).
-- T-FIX-EXPIRY / T-FIX-GRANT  an expired code settles nothing; the 30-minute grant ends.
-- T-FIX-COUNT  8  the set-based unanswered count equals the per-guest rule on every pair.
-- Fix-wave fails-on-revert: deleting the recognition check in brand_form_code_begin fails
-- T-FIX-BEGIN-5 (code started for Ike).
--
-- MINGLA-INVARIANT: I-4514-ONE-PERSON-ONE-RESPONSE | issue #4514 | one person has one response per form across link, RSVP, order and sign-in, and a link edit of any existing answer needs the one-time code (T-PERSON here; helper in the migration).
-- MINGLA-INVARIANT: I-4514-FORM-RESPONSES-BRAND-SCOPED | issue #4514 | a host of another brand, anon and a signed-in guest read no brand form responses through any RPC or table (T-GRANT, T-RESP here).
-- MINGLA-INVARIANT: I-4514-FORM-VERSIONS-IMMUTABLE | issue #4514 | published versions are never updated or deleted (T-IMM here; trigger in the migration).
-- MINGLA-INVARIANT: I-4514-DOOR-READ-ONE-GUEST-OF-THIS-EVENT | issue #4514 | scanner-role staff read answers only for one guest of the scanned event per call, only the marked line (both versions) when the host switch is off (T-DOOR here).
--
-- FAILS-ON-REVERT: dropping the both-versions EXISTS in brand_form_door_answers fails T-DOOR-2;
-- dropping the link.form_id check in brand_form_submit_core fails T-LINK-1; dropping the
-- show_if visibility in brand_form_check_answers fails T-SUB-3; dropping the brand rank check in
-- biz_brand_form_responses fails T-RESP-3; dropping the versions trigger fails T-IMM.
-- Review fixes (each tried, each red, then restored): the subject-only existing-answer lookup
-- fails T-PERSON-1; live-only door line fails T-CLOSE-1; to_date in the date check fails T-HOSTILE
-- (22008); dropping the current-guest check fails T-CLOSE-4; dropping the per-actor lock fails
-- T-DOORX-5; dropping the no-page check fails T-NOPAGE; dropping the truncate trigger fails T-VERS;
-- dropping the purpose filter fails T-CODE-8; dropping the page-visibility check fails T-PUBVIS-10.

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

  -- User subject with no page: no page, no answer (review fix 6); nothing is written.
  SELECT count(*) INTO v_n FROM public.brand_form_responses;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'answers', c_yes, 'credential', jsonb_build_object('kind', 'user', 'userId', v_s))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:form_not_on_event%' AND (SELECT count(*) FROM public.brand_form_responses) = v_n,
    'T-NOPAGE a signed-in submit with no page is refused and writes nothing (' || v_r || ')');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_form,
           'eventId', (SELECT id FROM f4514 WHERE k = 'e3'), 'answers', c_yes,
           'credential', jsonb_build_object('kind', 'user', 'userId', v_s))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:form_not_on_event%', 'T-NOPAGE a signed-in submit for a page without this form is refused');
  -- User subject on a page that carries the form.
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_form, 'answers', c_yes,
         'eventId', (SELECT id FROM f4514 WHERE k = 'e2'),
         'credential', jsonb_build_object('kind', 'user', 'userId', v_s)));
  PERFORM pg_temp.f_assert((SELECT user_id FROM public.brand_form_responses WHERE id = (v->>'responseId')::uuid) = v_s,
    'T-SUB the user subject is recorded (on a page that carries the form)');
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
  v jsonb; v_r text;
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
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_my_response(%L, %L)$$, v_form, v_e1));
  PERFORM pg_temp.f_assert(v_r LIKE 'P0002:form_not_found%',
    'T-READ another signed-in person with no relation to the form gets nothing (' || v_r || ')');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_my_response(%L)$$, v_form));
  PERFORM pg_temp.f_assert(v_r LIKE 'P0002:form_not_found%',
    'T-MINE a live form''s id alone does not hand its questions to any signed-in caller');
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

-- ═══ Wave 1 review fixes (#4514 "Independent review of wave 1: FAIL") ═════════
-- Fixtures: form P (the sample definition) on e6 (RSVP, required), e7 (ticketed,
-- after purchase), e8 (unlisted, optional on page) and e9 (private, optional on page).
DO $f$
DECLARE
  v_ba uuid := (SELECT id FROM f4514 WHERE k = 'ba');
  v_up uuid := pg_temp.f_user('p-person');
  v_ur uuid := pg_temp.f_user('r-person');
  v_uc uuid := pg_temp.f_user('c-person');
  v_uq uuid := pg_temp.f_user('q-buyer');
  v_uq2 uuid := pg_temp.f_user('q2-buyer');
  v_uh uuid := pg_temp.f_user('t-holder');
  v_sc6 uuid := pg_temp.f_user('scan-e6');
  v_e6 uuid := gen_random_uuid(); v_e7 uuid := gen_random_uuid(); v_e8 uuid := gen_random_uuid(); v_e9 uuid := gen_random_uuid();
  v_rp uuid := gen_random_uuid(); v_rr uuid := gen_random_uuid(); v_rc uuid := gen_random_uuid(); v_ru uuid := gen_random_uuid();
  v_oq uuid := gen_random_uuid(); v_oq2 uuid := gen_random_uuid(); v_ox uuid := gen_random_uuid();
  v_t1 uuid := gen_random_uuid(); v_t2 uuid := gen_random_uuid(); v_t3 uuid := gen_random_uuid(); v_tx uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_e6, v_ba, 'RSVP six', 'f4514-e6', 'rsvp', 'scheduled', 'public', 'UTC', 'USD'),
         (v_e7, v_ba, 'Ticketed seven', 'f4514-e7', 'event', 'scheduled', 'public', 'UTC', 'USD'),
         (v_e8, v_ba, 'Unlisted eight', 'f4514-e8', 'rsvp', 'scheduled', 'hidden', 'UTC', 'USD'),
         (v_e9, v_ba, 'Private nine', 'f4514-e9', 'rsvp', 'scheduled', 'private', 'UTC', 'USD');
  INSERT INTO public.event_scanners(event_id, user_id) VALUES (v_e6, v_sc6);
  INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_rp, v_e6, v_up, 'Pat Person', 'f4514-p@example.test', '+12025550601', 'going', 'approved'),
         (v_rr, v_e6, v_ur, 'Rae Reverse', 'f4514-r@example.test', '+12025550602', 'going', 'approved'),
         (v_rc, v_e6, v_uc, 'Cam Cancel', 'f4514-c@example.test', '+12025550603', 'going', 'approved'),
         (v_ru, v_e6, NULL, 'Una Unanswered', 'f4514-u@example.test', '+12025550604', 'going', 'approved');
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source, is_door_sale)
  VALUES (v_oq, v_e7, v_uq, 'Quinn Buyer', 'f4514-q@example.test', '+12025550701', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false),
         (v_oq2, v_e7, v_uq2, 'Quill Refund', 'f4514-q2@example.test', '+12025550702', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false),
         (v_ox, v_e7, NULL, 'Other Order', 'f4514-x@example.test', '+12025550703', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false);
  -- t1 the buyer's own (attendee is the buyer), t2 a friend's, t3 moved by the older transfer, tx another order's.
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, attendee_name, attendee_email, qr_code, status, created_at, transferred_at, holder_user_id)
  VALUES (v_t1, v_oq, gen_random_uuid(), v_e7, 'Quinn Buyer', 'f4514-q@example.test', 'f4514-qr-1', 'valid', now() - interval '3 minutes', NULL, NULL),
         (v_t2, v_oq, gen_random_uuid(), v_e7, 'Fran Friend', 'f4514-fran@example.test', 'f4514-qr-2', 'valid', now() - interval '2 minutes', NULL, v_uh),
         (v_t3, v_oq, gen_random_uuid(), v_e7, 'Moved On', 'f4514-moved@example.test', 'f4514-qr-3', 'transferred', now() - interval '1 minute', now(), NULL),
         (v_tx, v_ox, gen_random_uuid(), v_e7, 'Other', NULL, 'f4514-qr-x', 'valid', now(), NULL, NULL);
  PERFORM set_config('session_replication_role', 'origin', true);
  INSERT INTO f4514 VALUES ('up', v_up), ('ur', v_ur), ('uc', v_uc), ('uq', v_uq), ('uq2', v_uq2), ('uh', v_uh), ('sc6', v_sc6),
    ('e6', v_e6), ('e7', v_e7), ('e8', v_e8), ('e9', v_e9), ('rp', v_rp), ('rr', v_rr), ('rc', v_rc), ('ru', v_ru),
    ('oq', v_oq), ('oq2', v_oq2), ('ox', v_ox), ('t1', v_t1), ('t2', v_t2), ('t3', v_t3), ('tx', v_tx);
END
$f$;

DO $t$
DECLARE v jsonb; v_p uuid; v_a uuid;
BEGIN
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_create((SELECT id FROM f4514 WHERE k = 'ba'), 'Form P', pg_temp.f_def());
  v_p := (v->>'formId')::uuid;
  v := public.biz_brand_form_publish(v_p, 1);
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'em_a'));
  SET LOCAL ROLE authenticated;
  PERFORM public.biz_brand_form_attach(v_p, (SELECT id FROM f4514 WHERE k = 'e6'), 'required_step');
  PERFORM public.biz_brand_form_attach(v_p, (SELECT id FROM f4514 WHERE k = 'e7'), 'after_purchase');
  PERFORM public.biz_brand_form_attach(v_p, (SELECT id FROM f4514 WHERE k = 'e8'), 'optional_on_page');
  PERFORM public.biz_brand_form_attach(v_p, (SELECT id FROM f4514 WHERE k = 'e9'), 'optional_on_page');
  RESET ROLE;
  INSERT INTO f4514 VALUES ('form_p', v_p);
END
$t$;

-- ═══ T-PERSON (review 1, 2): one person, one response; the code gate holds ═════
DO $t$
DECLARE
  v_p uuid := (SELECT id FROM f4514 WHERE k = 'form_p');
  v_e6 uuid := (SELECT id FROM f4514 WHERE k = 'e6');
  v_e7 uuid := (SELECT id FROM f4514 WHERE k = 'e7');
  v_up uuid := (SELECT id FROM f4514 WHERE k = 'up');
  v_ur uuid := (SELECT id FROM f4514 WHERE k = 'ur');
  v_uq uuid := (SELECT id FROM f4514 WHERE k = 'uq');
  v_rp uuid := (SELECT id FROM f4514 WHERE k = 'rp');
  v_rr uuid := (SELECT id FROM f4514 WHERE k = 'rr');
  v_oq uuid := (SELECT id FROM f4514 WHERE k = 'oq');
  v jsonb; v_r text; v_token text; v_line jsonb; v_line2 jsonb; v_resp uuid;
  c_yes constant jsonb := '{"11111111-1111-4111-8111-111111111111":"yes","22222222-2222-4222-8222-222222222222":"Juggling"}';
  c_no constant jsonb := '{"11111111-1111-4111-8111-111111111111":"no"}';
BEGIN
  SET LOCAL ROLE service_role;
  -- Pat answers signed in on page e6 (no RSVP id sent): a user row.
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_p, 'eventId', v_e6, 'answers', c_yes,
         'credential', jsonb_build_object('kind', 'user', 'userId', v_up)));
  v_resp := (v->>'responseId')::uuid;
  PERFORM pg_temp.f_assert(v->>'created' = 'true'
    AND (SELECT user_id FROM public.brand_form_responses WHERE id = v_resp) = v_up,
    'T-PERSON a signed-in answer on the page is stored for the person');
  -- The same advisory lock key for Pat's RSVP and Pat signed in, and the submit holds it.
  PERFORM pg_temp.f_assert(public.brand_form_person_lock_key(v_p, 'rsvp', v_rp) = public.brand_form_person_lock_key(v_p, 'user', v_up)
    AND public.brand_form_person_lock_key(v_p, 'rsvp', v_rp) <> public.brand_form_person_lock_key(v_p, 'rsvp', v_rr),
    'T-PERSON the lock is taken on the person, not on the subject kind');
  PERFORM pg_temp.f_assert(EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid()
      AND ((l.classid::bigint << 32) | l.objid::bigint) = public.brand_form_person_lock_key(v_p, 'user', v_up)),
    'T-PERSON the submit took the person lock');
  v_line := public.brand_form_door_answers((SELECT id FROM f4514 WHERE k = 'sc6'), v_e6, jsonb_build_object('kind', 'rsvp', 'id', v_rp));

  -- A personal link for Pat's RSVP, used without the one-time code: refused.
  v := public.brand_form_link_issue(v_p, v_e6, jsonb_build_object('kind', 'rsvp', 'id', v_rp));
  v_token := v->>'token';
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_p,
           'answers', c_no, 'credential', jsonb_build_object('kind', 'link', 'token', v_token))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:code_required%',
    'T-PERSON-1 signed-in answer, then a personal-link submit without the code is refused (' || v_r || ')');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_p,
           'answers', c_no, 'expectedEditCount', 0, 'credential', jsonb_build_object('kind', 'link', 'token', v_token))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:code_required%', 'T-PERSON-1 ... also when it sends the right edit count');
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_responses
                             WHERE form_id = v_p AND (user_id = v_up OR rsvp_id = v_rp)) = 1
    AND (SELECT answers FROM public.brand_form_responses WHERE id = v_resp) = c_yes,
    'T-PERSON-1 the form still has one row for the person, unchanged');
  v_line2 := public.brand_form_door_answers((SELECT id FROM f4514 WHERE k = 'sc6'), v_e6, jsonb_build_object('kind', 'rsvp', 'id', v_rp));
  PERFORM pg_temp.f_assert(v_line2 = v_line AND v_line->>'state' = 'answered' AND v_line->'items'->0->>'value' = 'Yes',
    'T-PERSON-1 the scan line is unchanged (' || COALESCE(v_line2::text, 'null') || ')');
  RESET ROLE;
  PERFORM pg_temp.f_as(NULL);
  SET LOCAL ROLE anon;
  v := public.brand_form_my_response(v_p, NULL, v_token, NULL);
  PERFORM pg_temp.f_assert(v->>'state' = 'code_required' AND v->>'answered' = 'true' AND NOT (v ? 'response'),
    'T-PERSON-1 seeing it through the link needs the code too (read and write agree)');
  RESET ROLE;

  SET LOCAL ROLE service_role;
  -- Pat (signed in) sends the RSVP id: the same row is edited, edit count 1.
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_p, 'answers', c_no, 'expectedEditCount', 0,
         'credential', jsonb_build_object('kind', 'user', 'userId', v_up, 'rsvpId', v_rp)));
  PERFORM pg_temp.f_assert((v->>'responseId')::uuid = v_resp AND (v->>'editCount')::integer = 1 AND v->>'created' = 'false'
    AND (SELECT count(*) FROM public.brand_form_responses WHERE form_id = v_p AND (user_id = v_up OR rsvp_id = v_rp)) = 1,
    'T-PERSON-2 answer as user, then with the RSVP id: still one row, edit count 1');
  -- And back as the signed-in user on the page: still that row, edit count 2.
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_p, 'eventId', v_e6, 'answers', c_yes, 'expectedEditCount', 1,
         'credential', jsonb_build_object('kind', 'user', 'userId', v_up)));
  PERFORM pg_temp.f_assert((v->>'responseId')::uuid = v_resp AND (v->>'editCount')::integer = 2,
    'T-PERSON-2 then as the signed-in user again: the same row, edit count 2');
  -- Reverse order: Rae answers with the RSVP id first, then signed in on the page.
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_p, 'answers', c_no,
         'credential', jsonb_build_object('kind', 'user', 'userId', v_ur, 'rsvpId', v_rr)));
  v_resp := (v->>'responseId')::uuid;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_p,
           'eventId', v_e6, 'answers', c_no, 'credential', jsonb_build_object('kind', 'user', 'userId', v_ur))));
  PERFORM pg_temp.f_assert(v_r LIKE 'PT409:response_stale%', 'T-PERSON-2 a signed-in save that has not seen the RSVP answer is stale, not a second row');
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_p, 'eventId', v_e6, 'answers', c_yes, 'expectedEditCount', 0,
         'credential', jsonb_build_object('kind', 'user', 'userId', v_ur)));
  PERFORM pg_temp.f_assert((v->>'responseId')::uuid = v_resp AND (v->>'editCount')::integer = 1
    AND (SELECT count(*) FROM public.brand_form_responses WHERE form_id = v_p AND (user_id = v_ur OR rsvp_id = v_rr)) = 1,
    'T-PERSON-2 RSVP first, then signed in on the page: one row, edit count 1');
  -- An order: Quinn answers signed in on e7, then with the order id.
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_p, 'eventId', v_e7, 'answers', c_yes,
         'credential', jsonb_build_object('kind', 'user', 'userId', v_uq)));
  v_resp := (v->>'responseId')::uuid;
  v := public.brand_form_submit_core(jsonb_build_object('formId', v_p, 'answers', c_yes, 'expectedEditCount', 0,
         'credential', jsonb_build_object('kind', 'user', 'userId', v_uq, 'orderId', v_oq)));
  PERFORM pg_temp.f_assert((v->>'responseId')::uuid = v_resp AND (v->>'editCount')::integer = 1
    AND (SELECT count(*) FROM public.brand_form_responses WHERE form_id = v_p AND (user_id = v_uq OR order_id = v_oq)) = 1,
    'T-PERSON-2 answer as user, then with the order id: still one row, edit count 1');
  RESET ROLE;
  -- The signed-in read finds the same row the writes used.
  PERFORM pg_temp.f_as(v_up);
  SET LOCAL ROLE authenticated;
  v := public.brand_form_my_response(v_p, v_e6);
  PERFORM pg_temp.f_assert(v->>'state' = 'answered' AND (v->'response'->>'editCount')::integer = 2,
    'T-PERSON a signed-in Explorer user sees their own answer with no code');
  RESET ROLE;
END
$t$;

-- ═══ T-HOSTILE (review 3): bad input is a validation error, never a server error ══
DO $t$
DECLARE
  v_p uuid := (SELECT id FROM f4514 WHERE k = 'form_p');
  v_up uuid := (SELECT id FROM f4514 WHERE k = 'up');
  v_def jsonb := pg_temp.f_def();
  v jsonb; v_r text; v_case record; v_n integer;
  q1 constant text := '11111111-1111-4111-8111-111111111111';
  q2 constant text := '22222222-2222-4222-8222-222222222222';
  q3 constant text := '33333333-3333-4333-8333-333333333333';
  q4 constant text := '44444444-4444-4444-8444-444444444444';
  q5 constant text := '55555555-5555-4555-8555-555555555555';
BEGIN
  -- A multi choice question for the hostile multi cases.
  v_def := jsonb_set(v_def, '{questions,4}', pg_temp.f_q(v_def, 4) || '{"type":"multi_choice","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}');
  FOR v_case IN SELECT * FROM (VALUES
      ('date 2026-02-30',        jsonb_build_object(q1, 'no', q4, '2026-02-30'), 'type'),
      ('date 2025-02-29',        jsonb_build_object(q1, 'no', q4, '2025-02-29'), 'type'),
      ('date 1900-02-29',        jsonb_build_object(q1, 'no', q4, '1900-02-29'), 'type'),
      ('date 0000-01-01',        jsonb_build_object(q1, 'no', q4, '0000-01-01'), 'type'),
      ('date 2026-13-01',        jsonb_build_object(q1, 'no', q4, '2026-13-01'), 'type'),
      ('date 2026-04-31',        jsonb_build_object(q1, 'no', q4, '2026-04-31'), 'type'),
      ('date 99999-01-01',       jsonb_build_object(q1, 'no', q4, '99999-01-01'), 'type'),
      ('date as a number',       jsonb_build_object(q1, 'no', q4, 20260101), 'type'),
      ('date as an object',      jsonb_build_object(q1, 'no', q4, '{"y":2026}'::jsonb), 'type'),
      ('date with time',         jsonb_build_object(q1, 'no', q4, '2026-01-01T00:00:00Z'), 'type'),
      ('number as text',         jsonb_build_object(q1, 'no', q3, 'abc'), 'type'),
      ('number too big',         jsonb_build_object(q1, 'no', q3, '1e400'::jsonb), 'type'),
      ('number 13 digits',       jsonb_build_object(q1, 'no', q3, 1234567890123), 'type'),
      ('number as an array',     jsonb_build_object(q1, 'no', q3, '[1]'::jsonb), 'type'),
      ('number as a bool',       jsonb_build_object(q1, 'no', q3, true), 'type'),
      ('short text as a number', jsonb_build_object(q1, 'yes', q2, 42), 'type'),
      ('short text oversize',    jsonb_build_object(q1, 'yes', q2, repeat('é', 201)), 'too_long'),
      ('short text as object',   jsonb_build_object(q1, 'yes', q2, '{"a":1}'::jsonb), 'type'),
      ('single choice number',   jsonb_build_object(q1, 1), 'option'),
      ('single choice array',    jsonb_build_object(q1, '["yes"]'::jsonb), 'option'),
      ('single choice unknown',  jsonb_build_object(q1, 'maybe'), 'option'),
      ('multi choice a string',  jsonb_build_object(q1, 'no', q5, 'a'), 'type'),
      ('multi choice numbers',   jsonb_build_object(q1, 'no', q5, '[1,2]'::jsonb), 'option'),
      ('multi choice repeated',  jsonb_build_object(q1, 'no', q5, '["a","a"]'::jsonb), 'option'),
      ('multi choice nested',    jsonb_build_object(q1, 'no', q5, '[["a"]]'::jsonb), 'option'),
      ('unknown question key',   jsonb_build_object(q1, 'no', 'not-a-question', 'x'), 'unknown_question')
    ) c(label, answers, code) LOOP
    v_r := pg_temp.f_err(format($$SELECT public.brand_form_check_answers(%L::jsonb, %L::jsonb)$$, v_def, v_case.answers));
    PERFORM pg_temp.f_assert(v_r = 'ok', 'T-HOSTILE ' || v_case.label || ': the validator does not raise (' || v_r || ')');
    v := public.brand_form_check_answers(v_def, v_case.answers);
    PERFORM pg_temp.f_assert(v->>'ok' = 'false' AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'errors') e WHERE e.value->>'code' = v_case.code),
      'T-HOSTILE ' || v_case.label || ': refused with ' || v_case.code || ' (' || (v->'errors')::text || ')');
  END LOOP;
  -- Real dates still pass, leap days included.
  v := public.brand_form_check_answers(v_def, jsonb_build_object(q1, 'no', q4, '2024-02-29'));
  PERFORM pg_temp.f_assert(v->>'ok' = 'true' AND v->'answers'->>q4 = '2024-02-29', 'T-HOSTILE 2024-02-29 is a real date');
  v := public.brand_form_check_answers(v_def, jsonb_build_object(q1, 'no', q4, '2000-02-29', q3, '-12.5'));
  PERFORM pg_temp.f_assert(v->>'ok' = 'true' AND (v->'answers'->>q3)::numeric = -12.5, 'T-HOSTILE 2000-02-29 and a decimal string pass');
  -- A hostile definition handed to the client-callable validator never raises either.
  v_r := pg_temp.f_err($$SELECT public.brand_form_check_answers('{"questions":[{"id":"x","position":"not a number","type":"date"}]}'::jsonb, '{}'::jsonb)$$);
  PERFORM pg_temp.f_assert(v_r = 'ok' AND public.brand_form_check_answers('{"questions":[{"position":"x"}]}', '{}')->'errors'->0->>'code' = 'definition_invalid',
    'T-HOSTILE a hostile definition is refused, not raised (' || v_r || ')');

  -- Through the submit core: an impossible date and an absurd edit count are 22023 / PT409, never 22008 / 22003.
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM public.brand_form_responses;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_p,
           'eventId', (SELECT id FROM f4514 WHERE k = 'e8'), 'answers', jsonb_build_object(q1, 'no', q4, '2026-02-30'),
           'credential', jsonb_build_object('kind', 'user', 'userId', (SELECT id FROM f4514 WHERE k = 'g1')))));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:form_answers_invalid%' AND (SELECT count(*) FROM public.brand_form_responses) = v_n,
    'T-HOSTILE an impossible date through the core is form_answers_invalid and writes nothing (' || v_r || ')');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_p,
           'eventId', (SELECT id FROM f4514 WHERE k = 'e6'), 'answers', jsonb_build_object(q1, 'no'), 'expectedEditCount', 1e12,
           'credential', jsonb_build_object('kind', 'user', 'userId', v_up))));
  PERFORM pg_temp.f_assert(v_r LIKE 'PT409:response_stale%', 'T-HOSTILE an absurd edit count is stale, not a cast error (' || v_r || ')');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_p,
           'eventId', (SELECT id FROM f4514 WHERE k = 'e6'), 'answers', jsonb_build_object(q1, 'no'), 'expectedEditCount', 2.5,
           'credential', jsonb_build_object('kind', 'user', 'userId', v_up))));
  PERFORM pg_temp.f_assert(v_r LIKE 'PT409:response_stale%', 'T-HOSTILE a fractional edit count is stale, not a cast error (' || v_r || ')');
  RESET ROLE;
END
$t$;

-- ═══ T-CLOSE (review 2, 4): closing keeps the scan line; only current guests read in full ═
DO $t$
DECLARE
  v_p uuid := (SELECT id FROM f4514 WHERE k = 'form_p');
  v_e6 uuid := (SELECT id FROM f4514 WHERE k = 'e6');
  v_e7 uuid := (SELECT id FROM f4514 WHERE k = 'e7');
  v_sc6 uuid := (SELECT id FROM f4514 WHERE k = 'sc6');
  v_em uuid := (SELECT id FROM f4514 WHERE k = 'em_a');
  v_rc uuid := (SELECT id FROM f4514 WHERE k = 'rc');
  v_oq2 uuid := (SELECT id FROM f4514 WHERE k = 'oq2');
  v jsonb; v_before jsonb; v_r text; v_n integer;
  c_yes constant jsonb := '{"11111111-1111-4111-8111-111111111111":"yes","22222222-2222-4222-8222-222222222222":"Juggling"}';
BEGIN
  SET LOCAL ROLE service_role;
  -- Cam (RSVP) and Quill (order) answer while current.
  PERFORM public.brand_form_submit_core(jsonb_build_object('formId', v_p, 'answers', c_yes,
         'credential', jsonb_build_object('kind', 'user', 'userId', (SELECT id FROM f4514 WHERE k = 'uc'), 'rsvpId', v_rc)));
  PERFORM public.brand_form_submit_core(jsonb_build_object('formId', v_p, 'answers', c_yes,
         'credential', jsonb_build_object('kind', 'user', 'userId', (SELECT id FROM f4514 WHERE k = 'uq2'), 'orderId', v_oq2)));
  v := public.brand_form_door_full_answers(v_sc6, v_e6, jsonb_build_object('kind', 'rsvp', 'id', v_rc), 'scan');
  PERFORM pg_temp.f_assert(v->>'state' = 'answered', 'T-CLOSE a current guest reads in full');
  v_before := public.brand_form_door_answers(v_sc6, v_e6, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'rp')));
  PERFORM pg_temp.f_assert(public.brand_form_door_answers(v_sc6, v_e6, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'ru')))->>'state' = 'not_answered',
    'T-CLOSE live: an unanswered guest shows "Questions not answered"');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  PERFORM public.biz_brand_form_close(v_p);
  RESET ROLE;
  SET LOCAL ROLE service_role;
  v := public.brand_form_door_answers(v_sc6, v_e6, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'rp')));
  PERFORM pg_temp.f_assert(v IS NOT NULL AND v = v_before AND v->>'state' = 'answered',
    'T-CLOSE-1 closing the form keeps the marked answers on the scan line (' || COALESCE(v::text, 'null') || ')');
  PERFORM pg_temp.f_assert(public.brand_form_door_answers(v_sc6, v_e6, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'ru'))) IS NULL,
    'T-CLOSE closed: "Questions not answered" needs a live form');
  -- Cam cancels; Quill is refunded: the full read gives them nothing, and logs nothing.
  UPDATE public.event_rsvps SET rsvp_status = 'not_going' WHERE id = v_rc;
  UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_oq2;
  SELECT count(*) INTO v_n FROM public.brand_form_door_reads;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_door_full_answers(%L, %L, %L::jsonb, 'scan')$$, v_em, v_e6,
           jsonb_build_object('kind', 'rsvp', 'id', v_rc)));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:subject_not_current%', 'T-CLOSE-4 a not-going RSVP gets nothing from the full read (' || v_r || ')');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_door_full_answers(%L, %L, %L::jsonb, 'search')$$, v_em, v_e7,
           jsonb_build_object('kind', 'order', 'id', v_oq2)));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:subject_not_current%', 'T-CLOSE-4 a refunded order gets nothing from the full read (' || v_r || ')');
  UPDATE public.event_rsvps SET rsvp_status = 'going', approval_status = 'denied' WHERE id = v_rc;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_door_full_answers(%L, %L, %L::jsonb, 'scan')$$, v_em, v_e6,
           jsonb_build_object('kind', 'rsvp', 'id', v_rc)));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:subject_not_current%' AND (SELECT count(*) FROM public.brand_form_door_reads) = v_n,
    'T-CLOSE-4 a denied RSVP gets nothing either');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  PERFORM public.biz_brand_form_reopen(v_p);
  RESET ROLE;
END
$t$;

-- ═══ T-HEADER (review 10): the "From {name}'s order" header on another ticket ═══
DO $t$
DECLARE
  v_e7 uuid := (SELECT id FROM f4514 WHERE k = 'e7');
  v_em uuid := (SELECT id FROM f4514 WHERE k = 'em_a');
  v_oq uuid := (SELECT id FROM f4514 WHERE k = 'oq');
  v jsonb; v_r text;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.brand_form_door_answers(v_em, v_e7, jsonb_build_object('kind', 'order', 'id', v_oq, 'ticketId', (SELECT id FROM f4514 WHERE k = 't1')));
  PERFORM pg_temp.f_assert(v->>'state' = 'answered' AND NOT (v ? 'fromOrderOf'), 'T-HEADER the buyer''s own ticket has no header');
  v := public.brand_form_door_answers(v_em, v_e7, jsonb_build_object('kind', 'order', 'id', v_oq, 'ticketId', (SELECT id FROM f4514 WHERE k = 't2')));
  PERFORM pg_temp.f_assert(v->>'state' = 'answered' AND v->>'fromOrderOf' = 'Quinn B.',
    'T-HEADER another ticket of the order is headed "From Quinn B.''s order" (' || COALESCE(v::text, 'null') || ')');
  v := public.brand_form_door_answers(v_em, v_e7, jsonb_build_object('kind', 'order', 'id', v_oq));
  PERFORM pg_temp.f_assert(v->>'state' = 'answered' AND NOT (v ? 'fromOrderOf'), 'T-HEADER no ticket named: the order line as before');
  v := public.brand_form_door_answers(v_em, v_e7, jsonb_build_object('kind', 'order', 'id', v_oq, 'ticketId', (SELECT id FROM f4514 WHERE k = 't3')));
  PERFORM pg_temp.f_assert(v->>'state' = 'not_answered', 'T-HEADER a ticket moved by transfer never shows the order''s answers');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_door_answers(%L, %L, %L::jsonb)$$, v_em, v_e7,
           jsonb_build_object('kind', 'order', 'id', v_oq, 'ticketId', (SELECT id FROM f4514 WHERE k = 'tx'))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:subject_other_event%', 'T-HEADER a ticket of another order is refused');
  RESET ROLE;
END
$t$;

-- ═══ T-DOORX (review 5): the door read limit holds under a lock; other events get nothing ═
DO $t$
DECLARE
  v_e6 uuid := (SELECT id FROM f4514 WHERE k = 'e6');
  v_e7 uuid := (SELECT id FROM f4514 WHERE k = 'e7');
  v_sc6 uuid := (SELECT id FROM f4514 WHERE k = 'sc6');
  v_rp uuid := (SELECT id FROM f4514 WHERE k = 'rp');
  v jsonb; v_r text; i integer; v_states text[] := '{}';
BEGIN
  SET LOCAL ROLE service_role;
  -- A scanner of e6 reads nothing at e7.
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_door_full_answers(%L, %L, %L::jsonb)$$, v_sc6, v_e7,
           jsonb_build_object('kind', 'order', 'id', (SELECT id FROM f4514 WHERE k = 'oq'))));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:forbidden%', 'T-DOORX a scanner from another event gets nothing');
  -- The read takes this actor's lock before counting (a second session blocks on it).
  PERFORM pg_temp.f_assert(EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid()
      AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended('brand_form_door_reads:' || v_sc6::text, 0)),
    'T-DOORX-5 the full read holds the per-actor lock (taken before counting)');
  -- Repeated real calls: 60 pass (one was logged above), then the limit.
  FOR i IN 1..60 LOOP
    v := public.brand_form_door_full_answers(v_sc6, v_e6, jsonb_build_object('kind', 'rsvp', 'id', v_rp), 'search');
    v_states := v_states || (v->>'state');
  END LOOP;
  PERFORM pg_temp.f_assert(v_states[59] = 'answered' AND v_states[60] = 'rate_limited'
    AND (SELECT count(*) FROM public.brand_form_door_reads WHERE actor_id = v_sc6 AND result <> 'rate_limited') = 60,
    'T-DOORX repeated calls hit the limit at 60 per 10 minutes (' || array_to_string(v_states[58:60], ',') || ')');
  RESET ROLE;
END
$t$;

-- ═══ T-VERS (review 7): versions cannot be wiped; audit log append-only ══════════
DO $t$
DECLARE v_t text; v_r text;
BEGIN
  PERFORM pg_temp.f_assert(NOT has_table_privilege('service_role', 'public.brand_form_versions', 'DELETE')
    AND NOT has_table_privilege('service_role', 'public.brand_form_versions', 'TRUNCATE')
    AND NOT has_table_privilege('service_role', 'public.brand_form_versions', 'UPDATE')
    AND has_table_privilege('service_role', 'public.brand_form_versions', 'SELECT')
    AND has_table_privilege('service_role', 'public.brand_form_versions', 'INSERT'),
    'T-VERS the service role keeps only SELECT and INSERT on versions');
  SET LOCAL ROLE service_role;
  v_r := pg_temp.f_err($$TRUNCATE public.brand_form_versions CASCADE$$);
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-VERS truncate on versions is refused for the service role (' || v_r || ')');
  v_r := pg_temp.f_err($$DELETE FROM public.brand_form_versions$$);
  PERFORM pg_temp.f_assert(v_r LIKE '42501:permission denied%', 'T-VERS delete on versions is refused for the service role (' || v_r || ')');
  v_r := pg_temp.f_err($$DELETE FROM public.brand_form_door_reads$$);
  PERFORM pg_temp.f_assert(v_r LIKE '42501:permission denied%', 'T-VERS the door-read log cannot be deleted by the service role');
  RESET ROLE;
  -- Even the owner's TRUNCATE hits the statement trigger.
  v_r := pg_temp.f_err($$TRUNCATE public.brand_form_versions CASCADE$$);
  PERFORM pg_temp.f_assert(v_r LIKE '42501:brand_form_version_immutable%', 'T-VERS the BEFORE TRUNCATE trigger refuses a wipe (' || v_r || ')');
  FOREACH v_t IN ARRAY ARRAY['brand_forms','brand_form_versions','brand_form_attachments','brand_form_responses',
                             'brand_form_links','brand_form_submit_attempts','brand_form_door_reads'] LOOP
    PERFORM pg_temp.f_assert(NOT has_table_privilege('service_role', 'public.' || v_t, 'TRUNCATE'),
      'T-VERS no TRUNCATE for the service role on ' || v_t);
  END LOOP;
  PERFORM pg_temp.f_assert(NOT has_table_privilege('service_role', 'public.brand_form_door_reads', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.brand_form_door_reads', 'DELETE'),
    'T-VERS the door-read log is append-only for the service role');
END
$t$;

-- ═══ T-CODE (review 8): purpose-filtered address throttle; the per-phone limit ════
DO $t$
DECLARE
  v_p uuid := (SELECT id FROM f4514 WHERE k = 'form_p');
  v_e6 uuid := (SELECT id FROM f4514 WHERE k = 'e6');
  v_ru uuid := (SELECT id FROM f4514 WHERE k = 'ru');
  v_rr uuid := (SELECT id FROM f4514 WHERE k = 'rr');
  v_g1 uuid := (SELECT id FROM f4514 WHERE k = 'g1');
  v jsonb; v_tok_u text; v_tok_r text; v_link_u uuid; v_ip text := repeat('c', 64); i integer;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.brand_form_link_issue(v_p, v_e6, jsonb_build_object('kind', 'rsvp', 'id', v_ru));
  v_tok_u := v->>'token'; v_link_u := (v->>'linkId')::uuid;
  v := public.brand_form_link_issue(v_p, v_e6, jsonb_build_object('kind', 'rsvp', 'id', v_rr));
  v_tok_r := v->>'token';
  RESET ROLE;
  -- Fix wave: a code is sent only for an existing answer or after recognition ends,
  -- so these two unanswered people's links are past recognition.
  UPDATE public.brand_form_links SET expires_at = now() - interval '1 minute'
   WHERE id = v_link_u OR id = (v->>'linkId')::uuid;
  -- Ten add-contact challenges from the same address (another purpose) in the last 10 minutes.
  INSERT INTO public.contact_challenges (purpose, channel, user_id, target_value, code_hash, ip_hash)
  SELECT 'add_contact', 'email', v_g1, 'f4514-other' || g || '@example.test', repeat('d', 64), v_ip FROM generate_series(1, 10) g;
  SET LOCAL ROLE service_role;
  v := public.brand_form_code_begin(gen_random_uuid(), v_tok_u, 'email', repeat('e', 64), v_ip);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'started',
    'T-CODE-8 another purpose''s challenges from the same address do not throttle form codes (' || (v->>'outcome') || ')');
  RESET ROLE;
  -- Ten form-code challenges from that address (other links): the address limit.
  INSERT INTO public.contact_challenges (purpose, channel, target_value, code_hash, ip_hash, brand_form_link_id)
  SELECT 'brand_form_access', 'email', 'f4514-form' || g || '@example.test', repeat('d', 64), v_ip, v_link_u FROM generate_series(1, 9) g;
  SET LOCAL ROLE service_role;
  v := public.brand_form_code_begin(gen_random_uuid(), v_tok_r, 'email', repeat('e', 64), v_ip);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'rate_limited', 'T-CODE form codes from one address are limited to 10 per 10 minutes');
  -- The per-phone limit: two texts to Rae's number (any purpose) in 10 minutes.
  RESET ROLE;
  INSERT INTO public.contact_challenges (purpose, channel, user_id, target_value, ip_hash)
  VALUES ('add_contact', 'phone', v_g1, '+12025550602', NULL), ('add_contact', 'phone', v_g1, '+12025550602', NULL);
  SET LOCAL ROLE service_role;
  v := public.brand_form_code_begin(gen_random_uuid(), v_tok_r, 'phone', NULL, repeat('f', 64));
  PERFORM pg_temp.f_assert(v->>'outcome' = 'rate_limited', 'T-CODE-8 the existing per-phone limit applies to form codes');
  v := public.brand_form_code_begin(gen_random_uuid(), v_tok_r, 'email', repeat('e', 64), repeat('f', 64));
  PERFORM pg_temp.f_assert(v->>'outcome' = 'started', 'T-CODE the same person can still get an email code');
  RESET ROLE;
END
$t$;

-- ═══ T-PUBVIS and T-MINE (review 10): page visibility; who gets a form's questions ═
DO $t$
DECLARE
  v_p uuid := (SELECT id FROM f4514 WHERE k = 'form_p');
  v_e6 uuid := (SELECT id FROM f4514 WHERE k = 'e6');
  v_e7 uuid := (SELECT id FROM f4514 WHERE k = 'e7');
  v_e8 uuid := (SELECT id FROM f4514 WHERE k = 'e8');
  v_e9 uuid := (SELECT id FROM f4514 WHERE k = 'e9');
  v jsonb; v_r text;
BEGIN
  PERFORM pg_temp.f_as(NULL);
  SET LOCAL ROLE anon;
  PERFORM pg_temp.f_assert(public.public_brand_form_for_event(v_e9)->>'active' = 'false' AND NOT (public.public_brand_form_for_event(v_e9) ? 'definition'),
    'T-PUBVIS-10 a private page returns no form');
  v := public.public_brand_form_for_event(v_e8);
  PERFORM pg_temp.f_assert(v->>'active' = 'true' AND v->>'mode' = 'optional_on_page', 'T-PUBVIS an unlisted page opened by its link returns its form');
  RESET ROLE;
  UPDATE public.events SET visibility = 'draft' WHERE id = v_e8;
  SET LOCAL ROLE anon;
  PERFORM pg_temp.f_assert(public.public_brand_form_for_event(v_e8)->>'active' = 'false', 'T-PUBVIS a draft page returns no form');
  RESET ROLE;
  UPDATE public.events SET visibility = 'hidden' WHERE id = v_e8;

  -- A stranger: nothing on a required page they do not hold, nothing on a private page,
  -- the questions on a public page that offers the form as optional.
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 's'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_my_response(%L, %L)$$, v_p, v_e6));
  PERFORM pg_temp.f_assert(v_r LIKE 'P0002:form_not_found%', 'T-MINE-10 a stranger gets no questions on a page they do not hold');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_my_response(%L, %L)$$, v_p, v_e9));
  PERFORM pg_temp.f_assert(v_r LIKE 'P0002:form_not_found%', 'T-MINE a stranger gets no questions on a private page');
  v := public.brand_form_my_response(v_p, v_e8);
  PERFORM pg_temp.f_assert(v->>'state' = 'unanswered' AND jsonb_array_length(v->'form'->'definition'->'questions') = 5,
    'T-MINE a public page offering the form as optional hands out its questions');
  RESET ROLE;
  -- A ticket holder (a friend the buyer sent a ticket to) gets the questions on that page.
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'uh'));
  SET LOCAL ROLE authenticated;
  v := public.brand_form_my_response(v_p, v_e7);
  PERFORM pg_temp.f_assert(v->>'state' = 'unanswered' AND v->'form' ? 'definition', 'T-MINE a ticket holder at the page gets the questions');
  RESET ROLE;
  -- A going RSVP who has not answered gets them too.
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'g1'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_my_response(%L, %L)$$, v_p, v_e6));
  PERFORM pg_temp.f_assert(v_r LIKE 'P0002:form_not_found%', 'T-MINE a guest of another page gets nothing here');
  RESET ROLE;
END
$t$;

-- ═══ Wave 3 (links, counts, earlier guests, export) ═══════════════════════════
-- Fixtures: form W on e10 (RSVP): three going RSVPs (Wes answers, Val and Ike do
-- not), one not going, and a person linked to Wes's RSVP for the roster export.
DO $f$
DECLARE
  v_ba uuid := (SELECT id FROM f4514 WHERE k = 'ba');
  v_e10 uuid := gen_random_uuid(); v_e11 uuid := gen_random_uuid();
  v_rw uuid := gen_random_uuid(); v_rv uuid := gen_random_uuid(); v_ri uuid := gen_random_uuid(); v_rn uuid := gen_random_uuid();
  v_pw uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_e10, v_ba, 'RSVP ten', 'f4514-e10', 'rsvp', 'scheduled', 'public', 'UTC', 'USD'),
         (v_e11, v_ba, 'No form eleven', 'f4514-e11', 'rsvp', 'scheduled', 'public', 'UTC', 'USD');
  INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_rw, v_e10, NULL, 'Wes Answer', 'f4514-w@example.test', '+12025551001', 'going', 'approved'),
         (v_rv, v_e10, NULL, 'Val Waiting', 'f4514-v@example.test', '+12025551002', 'going', 'approved'),
         (v_ri, v_e10, NULL, 'Ike Idle', 'f4514-i@example.test', '+12025551003', 'going', 'approved'),
         (v_rn, v_e10, NULL, 'Ned Nope', 'f4514-n@example.test', '+12025551004', 'not_going', 'approved');
  INSERT INTO public.brand_people(id, brand_id, display_name) VALUES (v_pw, v_ba, 'Wes Answer');
  INSERT INTO public.brand_person_source_links(brand_id, brand_person_id, source_kind, source_id, link_method, source_occurred_at)
  VALUES (v_ba, v_pw, 'event_rsvp', v_rw, 'normalized_address', now());
  PERFORM set_config('session_replication_role', 'origin', true);
  INSERT INTO f4514 VALUES ('e10', v_e10), ('e11', v_e11), ('rw', v_rw), ('rv', v_rv), ('ri', v_ri), ('rn', v_rn), ('pw', v_pw);
END
$f$;

-- T-W3-EARLY  C12/§4.6: attaching a live form to a page with guests, and publishing a
--             draft attached to one, report the guests who signed up and have not answered.
DO $t$
DECLARE
  v_e10 uuid := (SELECT id FROM f4514 WHERE k = 'e10');
  v jsonb; v_w uuid; v_d uuid;
BEGIN
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  v_w := (public.biz_brand_form_create((SELECT id FROM f4514 WHERE k = 'ba'), 'Form W', pg_temp.f_def())->>'formId')::uuid;
  PERFORM public.biz_brand_form_publish(v_w, 1);
  -- A draft (never published) for the publish path.
  v_d := (public.biz_brand_form_create((SELECT id FROM f4514 WHERE k = 'ba'), 'Form Draft', pg_temp.f_def())->>'formId')::uuid;
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'em_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_attach(v_d, v_e10, 'required_step');
  PERFORM pg_temp.f_assert((v->>'earlierGuests')::integer = 0 AND (v->>'existingGuests')::integer = 3,
    'T-W3-EARLY a draft attached to a live page asks nobody yet (earlierGuests 0)');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_publish(v_d, 1);
  PERFORM pg_temp.f_assert(v->'earlierGuests' = jsonb_build_array(jsonb_build_object('eventId', v_e10, 'count', 3)),
    'T-W3-EARLY publishing a draft on a live page reports its 3 earlier guests (' || (v->'earlierGuests')::text || ')');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'em_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_attach(v_w, v_e10, 'required_step', false,
         (SELECT a.id FROM public.brand_form_attachments a WHERE a.event_id = v_e10 AND a.detached_at IS NULL));
  PERFORM pg_temp.f_assert((v->>'earlierGuests')::integer = 3, 'T-W3-EARLY attaching a live form reports 3 earlier guests');
  RESET ROLE;
  INSERT INTO f4514 VALUES ('form_w', v_w), ('form_d', v_d);
  -- Wes answers through his personal link.
  SET LOCAL ROLE service_role;
  v := public.brand_form_link_issue(v_w, v_e10, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'rw')));
  INSERT INTO f4514t VALUES ('tok_w', v->>'token');
  PERFORM public.brand_form_submit_core(jsonb_build_object('formId', v_w, 'answers',
    jsonb_build_object('11111111-1111-4111-8111-111111111111', 'yes', '22222222-2222-4222-8222-222222222222', 'Juggle'),
    'source', 'link', 'credential', jsonb_build_object('kind', 'link', 'token', v->>'token')));
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'em_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_attach(v_w, v_e10, 'optional_on_page', false,
         (SELECT a.id FROM public.brand_form_attachments a WHERE a.event_id = v_e10 AND a.detached_at IS NULL));
  PERFORM pg_temp.f_assert((v->>'earlierGuests')::integer = 2,
    'T-W3-EARLY after one answer, switching the mode reports 2 who have not answered');
  RESET ROLE;
END
$t$;

-- T-W3-COUNT  one read: answered and to-answer per form (cards) and per page (tile);
--             another brand's host, a scanner and anon are refused.
DO $t$
DECLARE
  v_ba uuid := (SELECT id FROM f4514 WHERE k = 'ba');
  v_w uuid := (SELECT id FROM f4514 WHERE k = 'form_w');
  v_e10 uuid := (SELECT id FROM f4514 WHERE k = 'e10');
  v jsonb; v_r text; v_page jsonb; v_card jsonb;
BEGIN
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_counts(v_ba);
  RESET ROLE;
  SELECT p INTO v_page FROM jsonb_array_elements(v->'pages') p WHERE p->>'eventId' = v_e10::text;
  SELECT c INTO v_card FROM jsonb_array_elements(v->'forms') c WHERE c->>'formId' = v_w::text;
  PERFORM pg_temp.f_assert((v_page->>'answered')::integer = 1 AND (v_page->>'toAnswer')::integer = 2 AND v_page->>'formId' = v_w::text,
    'T-W3-COUNT the page tile: 1 answered, 2 to answer (' || v_page::text || ')');
  PERFORM pg_temp.f_assert((v_card->>'answered')::integer = 1 AND (v_card->>'toAnswer')::integer = 2 AND (v_card->>'pages')::integer = 1,
    'T-W3-COUNT the form card: 1 answered, 2 to answer, on 1 page');
  PERFORM pg_temp.f_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'forms') c
                                        WHERE c->>'formId' IN (SELECT id::text FROM public.brand_forms WHERE brand_id <> v_ba)),
    'T-W3-COUNT only this brand''s forms are counted');
  -- Closing the form stops the "to answer" count (a closed form asks nobody).
  UPDATE public.brand_forms SET status = 'closed', closed_at = now() WHERE id = v_w;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  SELECT p INTO v_page FROM jsonb_array_elements(public.biz_brand_form_counts(v_ba)->'pages') p WHERE p->>'eventId' = v_e10::text;
  RESET ROLE;
  PERFORM pg_temp.f_assert((v_page->>'toAnswer')::integer = 0 AND (v_page->>'answered')::integer = 1,
    'T-W3-COUNT a closed form keeps its answers and has nobody to answer');
  UPDATE public.brand_forms SET status = 'live', closed_at = NULL WHERE id = v_w;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'owner_b'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_counts(%L)$$, v_ba));
  RESET ROLE;
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-W3-COUNT another brand''s host cannot count (' || v_r || ')');
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'scan_a'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_counts(%L)$$, v_ba));
  RESET ROLE;
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-W3-COUNT a scanner cannot count');
  PERFORM pg_temp.f_as(NULL);
  SET LOCAL ROLE anon;
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_counts(%L)$$, v_ba));
  RESET ROLE;
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-W3-COUNT anon cannot count');
END
$t$;

-- T-W3-CODE  the link page's code check: a claim or add-contact challenge never resolves
--            through a form link (purpose isolation); another link's challenge is refused;
--            five wrong codes lock it; a used code cannot be replayed; the grant opens the answer.
DO $t$
DECLARE
  v_w uuid := (SELECT id FROM f4514 WHERE k = 'form_w');
  v_e10 uuid := (SELECT id FROM f4514 WHERE k = 'e10');
  v_tok text := (SELECT val FROM f4514t WHERE k = 'tok_w');
  v_g1 uuid := (SELECT id FROM f4514 WHERE k = 'g1');
  v jsonb; v_other_tok text; v_claim uuid := gen_random_uuid(); v_c1 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid();
  v_c3 uuid := gen_random_uuid(); v_attempts integer; i integer; v_r text;
BEGIN
  INSERT INTO public.contact_challenges (id, purpose, channel, user_id, target_value, code_hash, ip_hash)
  VALUES (v_claim, 'add_contact', 'email', v_g1, 'f4514-w@example.test', repeat('a', 64), NULL);
  -- Anon and signed-in callers cannot reach the code functions at all.
  PERFORM pg_temp.f_as(NULL);
  SET LOCAL ROLE anon;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_code_settle(%L, %L, %L, false)$$, v_claim, v_tok, repeat('a', 64)));
  RESET ROLE;
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-W3-CODE anon cannot call the settle function');
  SET LOCAL ROLE service_role;
  v := public.brand_form_code_settle(v_claim, v_tok, repeat('a', 64), false);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'invalid', 'T-W3-CODE an add-contact challenge with the right code does not settle through a form link');
  RESET ROLE;
  SELECT attempts INTO v_attempts FROM public.contact_challenges WHERE id = v_claim;
  PERFORM pg_temp.f_assert(v_attempts = 0 AND (SELECT consumed_at FROM public.contact_challenges WHERE id = v_claim) IS NULL,
    'T-W3-CODE the other purpose''s challenge is untouched (no try used, not consumed)');
  SET LOCAL ROLE service_role;
  v := public.brand_form_code_begin(v_c1, v_tok, 'email', repeat('b', 64), repeat('9', 64));
  PERFORM pg_temp.f_assert(v->>'outcome' = 'started' AND v->>'target' = 'f4514-w@example.test', 'T-W3-CODE a code starts to the contact on file');
  v := public.brand_form_code_challenge(v_c1, v_tok);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'ok' AND v->>'channel' = 'email', 'T-W3-CODE the challenge resolves through its own link');
  -- Another link (Val's) cannot settle Wes's challenge.
  v_other_tok := public.brand_form_link_issue(v_w, v_e10, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'rv')))->>'token';
  v := public.brand_form_code_settle(v_c1, v_other_tok, repeat('b', 64), false);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'invalid', 'T-W3-CODE another link cannot settle this challenge');
  -- A provider approval never settles an email challenge; the wrong code uses a try.
  v := public.brand_form_code_settle(v_c1, v_tok, repeat('0', 64), true);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'bad_code' AND (v->>'attemptsLeft')::integer = 4, 'T-W3-CODE a wrong email code is bad_code with 4 tries left');
  FOR i IN 1..4 LOOP v := public.brand_form_code_settle(v_c1, v_tok, repeat('0', 64), false); END LOOP;
  v := public.brand_form_code_settle(v_c1, v_tok, repeat('b', 64), false);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'locked', 'T-W3-CODE after five wrong codes even the right code is locked (brute force)');
  RESET ROLE;
  -- Without a settled code, the existing answer stays hidden.
  PERFORM pg_temp.f_as(NULL);
  SET LOCAL ROLE anon;
  v := public.brand_form_my_response(v_w, NULL, v_tok, v_c1);
  RESET ROLE;
  PERFORM pg_temp.f_assert(v->>'state' = 'code_required' AND NOT (v ? 'response'), 'T-W3-CODE a locked challenge reveals nothing');
  SET LOCAL ROLE service_role;
  PERFORM public.brand_form_code_begin(v_c2, v_tok, 'email', repeat('c', 64), repeat('9', 64));
  v := public.brand_form_code_settle(v_c2, v_tok, repeat('c', 64), false);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'ok' AND NOT (v ? 'value') AND NOT (v ? 'userId'),
    'T-W3-CODE the right code settles and returns no contact');
  v := public.brand_form_code_settle(v_c2, v_tok, repeat('c', 64), false);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'invalid', 'T-W3-CODE a used code cannot be replayed');
  RESET ROLE;
  PERFORM pg_temp.f_as(NULL);
  SET LOCAL ROLE anon;
  v := public.brand_form_my_response(v_w, NULL, v_tok, v_c2);
  RESET ROLE;
  PERFORM pg_temp.f_assert(v->>'state' = 'answered' AND v->'response'->'answers'->>'22222222-2222-4222-8222-222222222222' = 'Juggle',
    'T-W3-CODE the settled code opens the person''s own answer');
  -- The grant is for its own link only: Val's link with Wes's challenge reveals nothing.
  SET LOCAL ROLE anon;
  v := public.brand_form_my_response(v_w, NULL, v_other_tok, v_c2);
  RESET ROLE;
  PERFORM pg_temp.f_assert(v->>'state' = 'unanswered' AND v->'response' = 'null'::jsonb,
    'T-W3-CODE another link with this grant sees only its own (unanswered) person');
  -- A phone challenge settles only with the provider's approval.
  SET LOCAL ROLE service_role;
  v := public.brand_form_code_begin(v_c3, v_tok, 'phone', NULL, repeat('8', 64));
  IF v->>'outcome' = 'started' THEN
    v := public.brand_form_code_settle(v_c3, v_tok, NULL, false);
    PERFORM pg_temp.f_assert(v->>'outcome' = 'bad_code', 'T-W3-CODE a phone code the provider did not approve is bad_code');
    v := public.brand_form_code_settle(v_c3, v_tok, NULL, true);
    PERFORM pg_temp.f_assert(v->>'outcome' = 'ok', 'T-W3-CODE a provider-approved phone code settles');
  ELSE
    PERFORM pg_temp.f_assert(false, 'T-W3-CODE phone challenge could not start: ' || (v->>'outcome'));
  END IF;
  RESET ROLE;
END
$t$;

-- T-W3-EXPORT  the roster export's answer columns: one per question for the page's form,
--              the person's answer by their RSVP; another job kind or a page with no
--              form adds nothing; signed-in callers cannot call the feed.
DO $t$
DECLARE
  v_ba uuid := (SELECT id FROM f4514 WHERE k = 'ba');
  v_e10 uuid := (SELECT id FROM f4514 WHERE k = 'e10');
  v_pw uuid := (SELECT id FROM f4514 WHERE k = 'pw');
  v_job uuid := gen_random_uuid(); v_book uuid := gen_random_uuid(); v_nof uuid := gen_random_uuid();
  v jsonb; v_r text;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.brand_people_export_jobs(id, brand_id, export_kind, scope_id, filter_hash, client_request_id, requested_by)
  VALUES (v_job, v_ba, 'offering_guest_roster', v_e10, repeat('1', 64), gen_random_uuid(), (SELECT id FROM f4514 WHERE k = 'em_a')),
         (v_book, v_ba, 'brand_book', NULL, repeat('2', 64), gen_random_uuid(), (SELECT id FROM f4514 WHERE k = 'em_a')),
         (v_nof, v_ba, 'offering_guest_roster', (SELECT id FROM f4514 WHERE k = 'e11'), repeat('3', 64), gen_random_uuid(), (SELECT id FROM f4514 WHERE k = 'em_a'));
  PERFORM set_config('session_replication_role', 'origin', true);
  SET LOCAL ROLE service_role;
  v := public.brand_form_roster_export_answers(v_job);
  RESET ROLE;
  PERFORM pg_temp.f_assert(jsonb_array_length(v->'columns') = 5
      AND v->'columns'->0->>'header' = 'Would you like to perform?' AND v->'columns'->0->>'key' = '1:11111111-1111-4111-8111-111111111111',
    'T-W3-EXPORT one column per question of the page''s form (' || (v->'columns')::text || ')');
  PERFORM pg_temp.f_assert(v->'rows'->v_pw::text->>'1:11111111-1111-4111-8111-111111111111' = 'Yes'
      AND v->'rows'->v_pw::text->>'1:22222222-2222-4222-8222-222222222222' = 'Juggle',
    'T-W3-EXPORT Wes''s row carries his answers as display text');
  PERFORM pg_temp.f_assert((SELECT count(*) FROM jsonb_object_keys(v->'rows')) = 1, 'T-W3-EXPORT only people with an answer have values');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.f_assert(public.brand_form_roster_export_answers(v_book)->'columns' = '[]'::jsonb,
    'T-W3-EXPORT a brand book job gets no answer columns');
  PERFORM pg_temp.f_assert(public.brand_form_roster_export_answers(v_nof)->'columns' = '[]'::jsonb,
    'T-W3-EXPORT a page with no form gets no answer columns');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'owner_a'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_roster_export_answers(%L)$$, v_job));
  RESET ROLE;
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-W3-EXPORT even the brand owner cannot call the export feed directly');
END
$t$;

-- ═══ Wave 3 fix wave (conductor review on #4514) ═════════════════════════════
-- T-FIX-RANK  1  C5: an event manager runs the answers-only export; the roster export
--                 (biz_export_brand_people, brand_admin+) stays refused to them, so the
--                 Responses Export never rides it; a marketing manager cannot export.
DO $t$
DECLARE
  v_w uuid := (SELECT id FROM f4514 WHERE k = 'form_w');
  v_e10 uuid := (SELECT id FROM f4514 WHERE k = 'e10');
  v jsonb; v_r text;
BEGIN
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'em_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_responses_export(v_w, v_e10);
  v_r := pg_temp.f_err(format($$SELECT public.biz_export_brand_people('offering_guest_roster', %L)$$, v_e10));
  RESET ROLE;
  PERFORM pg_temp.f_assert(jsonb_array_length(v->'rows') = 1 AND jsonb_array_length(v->'columns') > 0,
    'T-FIX-RANK an event manager runs the answers-only export (' || jsonb_array_length(v->'rows') || ' row)');
  PERFORM pg_temp.f_assert(v_r LIKE '42501:brand_people_export_forbidden%',
    'T-FIX-RANK the roster export is still refused to an event manager, no roster RPC widened (' || v_r || ')');
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.biz_brand_form_responses_export(%L, %L)$$, v_w, v_e10));
  RESET ROLE;
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-FIX-RANK a marketing manager cannot export answers (' || v_r || ')');
END
$t$;

-- T-FIX-BEGIN  5 + gaps: no code for a first answer inside recognition (same refusal as an
--              unknown token, no challenge row); past recognition a code starts; an open link
--              is refused; the per-link (3 per 10 minutes) and per-contact (20 per day) limits;
--              an expired challenge settles nothing; the 30-minute grant ends.
DO $t$
DECLARE
  v_w uuid := (SELECT id FROM f4514 WHERE k = 'form_w');
  v_e10 uuid := (SELECT id FROM f4514 WHERE k = 'e10');
  v_tok_w text := (SELECT val FROM f4514t WHERE k = 'tok_w');
  v_link_w uuid := (SELECT l.id FROM public.brand_form_links l WHERE l.token_hash = public.brand_form_token_hash((SELECT val FROM f4514t WHERE k = 'tok_w')));
  v jsonb; v_unknown jsonb; v_tok_i text; v_link_i uuid; v_tok_v text; v_link_v uuid; v_tok_open text := repeat('ab', 20);
  v_n integer; i integer; v_old uuid := gen_random_uuid(); v_fresh uuid := gen_random_uuid(); v_exp uuid := gen_random_uuid();
BEGIN
  SET LOCAL ROLE service_role;
  v := public.brand_form_link_issue(v_w, v_e10, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'ri')));
  v_tok_i := v->>'token'; v_link_i := (v->>'linkId')::uuid;
  v := public.brand_form_link_issue(v_w, v_e10, jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'rv')));
  v_tok_v := v->>'token'; v_link_v := (v->>'linkId')::uuid;
  SELECT count(*) INTO v_n FROM public.contact_challenges;
  v := public.brand_form_code_begin(gen_random_uuid(), v_tok_i, 'email', repeat('e', 64), repeat('1', 64));
  v_unknown := public.brand_form_code_begin(gen_random_uuid(), repeat('0', 64), 'email', repeat('e', 64), repeat('1', 64));
  RESET ROLE;
  PERFORM pg_temp.f_assert(v = v_unknown AND v = jsonb_build_object('outcome', 'invalid')
      AND (SELECT count(*) FROM public.contact_challenges) = v_n,
    'T-FIX-BEGIN-5 a first answer inside recognition gets no code, refused exactly like an unknown token (' || v::text || ')');
  -- Past recognition the same person can get a code; then the per-link limit (3 per 10 minutes).
  UPDATE public.brand_form_links SET expires_at = now() - interval '1 minute' WHERE id IN (v_link_i, v_link_v);
  SET LOCAL ROLE service_role;
  FOR i IN 1..3 LOOP
    v := public.brand_form_code_begin(gen_random_uuid(), v_tok_i, 'email', repeat('e', 64), repeat(i::text, 64));
    PERFORM pg_temp.f_assert(v->>'outcome' = 'started', 'T-FIX-BEGIN past recognition code ' || i || ' of 3 starts');
  END LOOP;
  v := public.brand_form_code_begin(gen_random_uuid(), v_tok_i, 'email', repeat('e', 64), repeat('4', 64));
  PERFORM pg_temp.f_assert(v->>'outcome' = 'rate_limited', 'T-FIX-BEGIN-LINK a 4th code for one link in 10 minutes is limited');
  RESET ROLE;
  -- Per contact per day: 19 older form codes to Val's address (outside the 10-minute windows).
  INSERT INTO public.contact_challenges (purpose, channel, target_value, code_hash, ip_hash, brand_form_link_id, created_at)
  SELECT 'brand_form_access', 'email', 'f4514-v@example.test', repeat('d', 64), NULL, v_link_v, now() - interval '2 hours'
    FROM generate_series(1, 19);
  SET LOCAL ROLE service_role;
  v := public.brand_form_code_begin(gen_random_uuid(), v_tok_v, 'email', repeat('e', 64), repeat('5', 64));
  PERFORM pg_temp.f_assert(v->>'outcome' = 'started', 'T-FIX-BEGIN-CONTACT the 20th code to one contact in a day starts');
  v := public.brand_form_code_begin(gen_random_uuid(), v_tok_v, 'email', repeat('e', 64), repeat('6', 64));
  PERFORM pg_temp.f_assert(v->>'outcome' = 'rate_limited', 'T-FIX-BEGIN-CONTACT the 21st code to one contact in a day is limited');
  RESET ROLE;
  -- A link that is not for a person (kind 'open') never starts a code.
  INSERT INTO public.brand_form_links (form_id, event_id, kind, token_hash, expires_at)
  VALUES (v_w, v_e10, 'open', public.brand_form_token_hash(v_tok_open), now() - interval '1 day');
  SET LOCAL ROLE service_role;
  v := public.brand_form_code_begin(gen_random_uuid(), v_tok_open, 'email', repeat('e', 64), repeat('7', 64));
  RESET ROLE;
  PERFORM pg_temp.f_assert(v = jsonb_build_object('outcome', 'invalid'), 'T-FIX-BEGIN-OPEN an open link is refused (' || v::text || ')');
  -- Challenge expiry: a code past its 10 minutes settles nothing and opens nothing.
  INSERT INTO public.contact_challenges (id, purpose, channel, target_value, code_hash, brand_form_link_id, created_at, expires_at)
  VALUES (v_exp, 'brand_form_access', 'email', 'f4514-w@example.test', repeat('d', 64), v_link_w,
          now() - interval '11 minutes', now() - interval '1 minute');
  SET LOCAL ROLE service_role;
  v := public.brand_form_code_settle(v_exp, v_tok_w, repeat('d', 64), false);
  RESET ROLE;
  PERFORM pg_temp.f_assert(v->>'outcome' = 'expired' AND (SELECT consumed_at FROM public.contact_challenges WHERE id = v_exp) IS NULL,
    'T-FIX-EXPIRY a code past 10 minutes is expired, even with the right code (' || v::text || ')');
  -- The grant lasts 30 minutes from the settle.
  INSERT INTO public.contact_challenges (id, purpose, channel, target_value, code_hash, brand_form_link_id, created_at, expires_at, consumed_at)
  VALUES (v_old, 'brand_form_access', 'email', 'f4514-w@example.test', repeat('d', 64), v_link_w,
          now() - interval '45 minutes', now() - interval '35 minutes', now() - interval '31 minutes'),
         (v_fresh, 'brand_form_access', 'email', 'f4514-w@example.test', repeat('d', 64), v_link_w,
          now() - interval '35 minutes', now() - interval '25 minutes', now() - interval '29 minutes');
  PERFORM pg_temp.f_as(NULL);
  SET LOCAL ROLE anon;
  v := public.brand_form_my_response(v_w, NULL, v_tok_w, v_old);
  PERFORM pg_temp.f_assert(v->>'state' = 'code_required' AND NOT (v ? 'response'),
    'T-FIX-GRANT a grant settled 31 minutes ago shows nothing (' || (v->>'state') || ')');
  v := public.brand_form_my_response(v_w, NULL, v_tok_w, v_fresh);
  PERFORM pg_temp.f_assert(v->>'state' = 'answered', 'T-FIX-GRANT a grant settled 29 minutes ago still opens the answer');
  RESET ROLE;
  SET LOCAL ROLE service_role;
  v := to_jsonb(pg_temp.f_err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', v_w,
         'answers', jsonb_build_object('11111111-1111-4111-8111-111111111111', 'no'), 'expectedEditCount', 0,
         'credential', jsonb_build_object('kind', 'link', 'token', v_tok_w, 'challengeId', v_old)))));
  RESET ROLE;
  PERFORM pg_temp.f_assert(v #>> '{}' LIKE '42501:code_required%', 'T-FIX-GRANT an ended grant cannot change the answer (' || (v #>> '{}') || ')');
END
$t$;

-- T-FIX-COUNT  8: the set-based unanswered count equals the old per-guest rule
--              (brand_form_find_response per RSVP and order) for every form and page here.
DO $t$
DECLARE
  v_pairs integer; v_bad integer; v_user_matches integer;
BEGIN
  WITH pairs AS (
    SELECT f.id AS form_id, e.id AS event_id
      FROM public.brand_forms f JOIN public.events e ON e.brand_id = f.brand_id
     WHERE e.slug LIKE 'f4514-%'
  ), old AS (
    SELECT p.form_id, p.event_id,
           (SELECT count(*) FROM public.event_rsvps x
             WHERE x.event_id = p.event_id AND x.rsvp_status = 'going'
               AND (public.brand_form_find_response(p.form_id, 'rsvp', x.id)).id IS NULL)::integer
         + (SELECT count(*) FROM public.orders o
             WHERE o.event_id = p.event_id AND o.payment_status IN ('paid', 'partial_refund')
               AND (public.brand_form_find_response(p.form_id, 'order', o.id)).id IS NULL)::integer AS n
      FROM pairs p
  )
  SELECT count(*), count(*) FILTER (WHERE public.brand_form_unanswered_count(o.form_id, o.event_id) <> o.n)
    INTO v_pairs, v_bad FROM old o;
  -- At least one guest here is matched through their signed-in user's row.
  SELECT count(*) INTO v_user_matches
    FROM public.event_rsvps x JOIN public.brand_form_responses r ON r.user_id = x.user_id AND r.rsvp_id IS NULL
   WHERE x.user_id IS NOT NULL;
  PERFORM pg_temp.f_assert(v_pairs > 10 AND v_bad = 0,
    'T-FIX-COUNT the anti-join equals the per-guest rule on ' || v_pairs || ' form and page pairs (' || v_bad || ' differ)');
  PERFORM pg_temp.f_assert(v_user_matches > 0, 'T-FIX-COUNT the pairs include a guest answered through their signed-in row');
END
$t$;

ROLLBACK;
