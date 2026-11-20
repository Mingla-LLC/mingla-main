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

-- ═══ Wave 4: sending (with the wave 4 review fixes) ══════════════════════════
-- T-W4-GRANT   the new tables have RLS on and no client grant; the send functions are
--              service-role only; the switch and the delivery log are the signed-in calls.
-- T-W4-AUD     C5: event manager and up reads the audience, a marketing manager is refused;
--              'unanswered' leaves out the guest who answered, 'everyone' keeps him; a named
--              guest narrows it; one row per person; the route is text then email.
-- T-W4-D17     decision 17: queueing and claiming write a person brand form link and one send
--              row and no invite, invite delivery attempt, send group or private access grant,
--              and leave guest status and invite counts unchanged.
-- T-W4-THROTTLE  one request per person per form per 24 hours; a failed one does not count;
--              after 24 hours a new one is allowed; Remind skips a guest who answered.
-- T-W4-CONC    two Asks at once: enqueue holds the brand lock, so the second sees the first.
-- T-W4-QUEUE   pages of at most p_limit; a stale claim is retried, then failed after 3 tries;
--              a queued row older than 24 hours fails; nobody is blocked for 24 hours.
-- T-W4-QUIET   texts wait for 9am-9pm in the page's time zone; email is not delayed.
-- T-W4-CAP     the per-brand daily text limit refuses a send that would go over it.
-- T-W4-AUTO    decision 13: push is dropped from the switch; due once per page and date two
--              days before; a run with nothing left settles; a stuck run fails visibly;
--              decision 10: a closed form is held and the host told with a link.
-- T-W4-DATES   each guest's own date: a multi-date page reminds only the guest on the date in
--              the window (not the later date, not a past date); an experience uses
--              booked_start_at.
-- T-W4-LOG     the host delivery log: event manager and up, names and outcomes, never a link;
--              the role is checked before the form is looked up (N7).
-- Re-review fixes (N2-N7):
-- T-W4-PERSON  the person key is the account, else the booking, never the phone or email:
--              two guests sharing a phone each get their own request and link; one account
--              with an RSVP and an order is one person (N5).
-- T-W4-AUTOCAP the automatic reminder keeps to the daily text limit: texts only up to what is
--              left; past it the email on the route goes ('text_cap'), else 'skipped'
--              ('text_cap'), and the log shows it (N2).
-- T-W4-AUTOLOCK the automatic reminder queues under the brand lock that enqueue takes, and an
--              Ask and the reminder never both reach one person inside 24 hours (N3).
-- T-W4-STARTED a request whose guest date has started is skipped at claim ('event_started') (N4).
-- T-W4-DATES-0 brand_form_guest_dates is static SQL (no EXECUTE) and the columns it reads exist (N6).
-- FAILS-ON-REVERT (review fixes): deleting the stale-claim UPDATE in claim_batch fails
-- T-W4-QUEUE-2; deleting the brand_form_text_window delay fails T-W4-QUIET-2; deleting the cap
-- RAISE fails T-W4-CAP-1; replacing brand_form_guest_dates with the page's next date fails
-- T-W4-DATES-2 and T-W4-DATES-4; restoring the phone and email person key (the 5-argument
-- brand_form_person_key and its caller) fails T-W4-AUD-1b; deleting the text-limit split in
-- brand_form_auto_reminders_due fails T-W4-AUTOCAP-1; deleting the event_started check in
-- claim_batch fails T-W4-STARTED-1 (each measured on a clone of the replayed database).
DO $t$
DECLARE v_t text; v_f text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['brand_form_request_sends', 'brand_form_auto_reminder_runs'] LOOP
    PERFORM pg_temp.f_assert((SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_t)::regclass)
      AND NOT has_table_privilege('authenticated', 'public.' || v_t, 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.' || v_t, 'INSERT')
      AND NOT has_table_privilege('anon', 'public.' || v_t, 'SELECT'),
      'T-W4-GRANT RLS on and no client grant on ' || v_t);
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY['public.brand_form_request_audience(uuid,uuid,uuid,text,jsonb,text[])',
      'public.brand_form_request_enqueue(uuid,uuid,uuid,text,text,jsonb,text[])',
      'public.brand_form_request_claim_batch(integer,uuid,uuid)', 'public.brand_form_request_settle(uuid,text,text,text)',
      'public.brand_form_auto_reminders_due()', 'public.brand_form_request_guests(uuid,uuid,jsonb)',
      'public.brand_form_guest_dates(text,uuid,uuid)', 'public.brand_form_request_route(text,text,text[])'] LOOP
    PERFORM pg_temp.f_assert(NOT has_function_privilege('authenticated', v_f, 'EXECUTE')
      AND NOT has_function_privilege('anon', v_f, 'EXECUTE') AND has_function_privilege('service_role', v_f, 'EXECUTE'),
      'T-W4-GRANT service role only: ' || v_f);
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY['public.biz_brand_form_set_auto_remind(uuid,boolean,text[])',
      'public.biz_brand_form_request_log(uuid,uuid,jsonb,integer)'] LOOP
    PERFORM pg_temp.f_assert(has_function_privilege('authenticated', v_f, 'EXECUTE')
      AND NOT has_function_privilege('anon', v_f, 'EXECUTE'), 'T-W4-GRANT signed-in only: ' || v_f);
  END LOOP;
END
$t$;

-- Two time zones for the quiet-hours checks: one where it is now midday, one where it is night.
CREATE TEMP TABLE f4514_tz AS
SELECT (SELECT name FROM pg_timezone_names WHERE extract(hour FROM now() AT TIME ZONE name) BETWEEN 11 AND 18
         AND name LIKE 'Etc/GMT%' ORDER BY name LIMIT 1) AS day_tz,
       (SELECT name FROM pg_timezone_names WHERE extract(hour FROM now() AT TIME ZONE name) BETWEEN 1 AND 6
         AND name LIKE 'Etc/GMT%' ORDER BY name LIMIT 1) AS night_tz;
UPDATE public.events SET timezone = (SELECT day_tz FROM f4514_tz) WHERE id = (SELECT id FROM f4514 WHERE k = 'e10');

DO $t$
BEGIN
  PERFORM pg_temp.f_assert(public.brand_form_text_window('UTC', '2028-01-01 15:00Z') = '2028-01-01 15:00Z'
      AND public.brand_form_text_window('UTC', '2028-01-01 23:30Z') = '2028-01-02 09:00Z'
      AND public.brand_form_text_window('UTC', '2028-01-01 05:00Z') = '2028-01-01 09:00Z'
      AND public.brand_form_text_window('America/New_York', '2028-01-01 12:00Z') = '2028-01-01 14:00Z'
      AND public.brand_form_text_window('Not/AZone', '2028-01-01 23:30Z') = '2028-01-02 09:00Z',
    'T-W4-QUIET-1 the text window: daytime unchanged, night moves to 9am local, an unknown zone reads as UTC');
  PERFORM pg_temp.f_assert(public.brand_form_person_key(NULL, 'rsvp', '00000000-0000-4000-8000-000000000001') = 's:rsvp:00000000-0000-4000-8000-000000000001'
      AND public.brand_form_person_key(NULL, 'order', '00000000-0000-4000-8000-000000000002') = 's:order:00000000-0000-4000-8000-000000000002'
      AND public.brand_form_person_key('00000000-0000-4000-8000-000000000003', 'rsvp', gen_random_uuid()) = 'u:00000000-0000-4000-8000-000000000003'
      AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.brand_form_person_key(uuid,text,uuid)'::regprocedure
                        AND (prosrc LIKE '%phone%' OR prosrc LIKE '%email%')),
    'T-W4-PERSON-0 one person key: the account, else the booking; never the phone or email');
END
$t$;

DO $t$
DECLARE
  v_e10 uuid := (SELECT id FROM f4514 WHERE k = 'e10');
  v_w uuid := (SELECT id FROM f4514 WHERE k = 'form_w');
  v_rw uuid := (SELECT id FROM f4514 WHERE k = 'rw');
  v_rv uuid := (SELECT id FROM f4514 WHERE k = 'rv');
  v jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_audience((SELECT id FROM f4514 WHERE k = 'em_a'), v_w, v_e10, 'unanswered', NULL);
  PERFORM pg_temp.f_assert(jsonb_array_length(v->'recipients') = 2
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'recipients') r WHERE (r->>'id')::uuid = v_rw),
    'T-W4-AUD-1 unanswered: the 2 who have not answered, not Wes (' || (v->'recipients')::text || ')');
  PERFORM pg_temp.f_assert((SELECT bool_and(r->'route' = '["sms", "email"]'::jsonb AND r->>'personKey' = 's:rsvp:' || (r->>'id'))
                              FROM jsonb_array_elements(v->'recipients') r)
      AND (v->>'textCap')::integer = 300 AND (v->>'textsToday')::integer = 0,
    'T-W4-AUD-1b each person: the route text then email, a person key, the daily text limit (' || v::text || ')');
  v := public.brand_form_request_audience((SELECT id FROM f4514 WHERE k = 'em_a'), v_w, v_e10, 'unanswered', NULL, ARRAY['email']);
  PERFORM pg_temp.f_assert((SELECT bool_and(r->'route' = '["email"]'::jsonb) FROM jsonb_array_elements(v->'recipients') r),
    'T-W4-AUD-1c email only: the route is email');
  v := public.brand_form_request_audience((SELECT id FROM f4514 WHERE k = 'em_a'), v_w, v_e10, 'everyone', NULL);
  PERFORM pg_temp.f_assert(jsonb_array_length(v->'recipients') = 3, 'T-W4-AUD-2 everyone going: 3');
  v := public.brand_form_request_audience((SELECT id FROM f4514 WHERE k = 'em_a'), v_w, v_e10, 'everyone',
         jsonb_build_array(jsonb_build_object('kind', 'rsvp', 'id', v_rw)));
  PERFORM pg_temp.f_assert(jsonb_array_length(v->'recipients') = 1 AND (v->'recipients'->0->>'id')::uuid = v_rw,
    'T-W4-AUD-3 a named guest who answered is reached with audience everyone (Ask again)');
  PERFORM pg_temp.f_assert(pg_temp.f_err(format('SELECT public.brand_form_request_audience(%L, %L, %L, %L, NULL)',
      (SELECT id FROM f4514 WHERE k = 'mm_a'), v_w, v_e10, 'unanswered')) LIKE '42501:brand_form_forbidden%',
    'T-W4-AUD-4 C5: a marketing manager cannot send (event manager and up)');
  PERFORM pg_temp.f_assert(pg_temp.f_err(format('SELECT public.brand_form_request_audience(%L, %L, %L, %L, NULL)',
      (SELECT id FROM f4514 WHERE k = 'owner_b'), v_w, v_e10, 'unanswered')) LIKE '42501:%',
    'T-W4-AUD-5 another brand''s owner is refused');
  RESET ROLE;
END
$t$;

-- T-W4-D17, T-W4-THROTTLE, T-W4-PERSON, T-W4-CONC, T-W4-QUEUE
DO $t$
DECLARE
  v_e10 uuid := (SELECT id FROM f4514 WHERE k = 'e10');
  v_w uuid := (SELECT id FROM f4514 WHERE k = 'form_w');
  v_rw uuid := (SELECT id FROM f4514 WHERE k = 'rw');
  v_rv uuid := (SELECT id FROM f4514 WHERE k = 'rv');
  v_em uuid := (SELECT id FROM f4514 WHERE k = 'em_a');
  v_val jsonb := jsonb_build_array(jsonb_build_object('kind', 'rsvp', 'id', v_rv));
  v_twin uuid := gen_random_uuid();
  v_before text; v_after text; v jsonb; v_c jsonb; v_link public.brand_form_links; v_send uuid; v_key bigint;
BEGIN
  SELECT concat_ws('|',
    (SELECT count(*) FROM public.brand_offering_invites),
    (SELECT count(*) FROM public.brand_offering_invite_delivery_attempts),
    (SELECT count(*) FROM public.marketing_send_groups),
    (SELECT md5(string_agg(x.id::text || x.rsvp_status || x.approval_status, ',' ORDER BY x.id)) FROM public.event_rsvps x WHERE x.event_id = v_e10),
    CASE WHEN to_regclass('public.private_event_access_grants') IS NULL THEN 'n/a'
         ELSE (SELECT count(*)::text FROM public.private_event_access_grants) END)
    INTO v_before;
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(v_em, v_w, v_e10, 'ask', 'everyone', v_val, ARRAY['email']);
  v_key := hashtextextended('brand_form_request:' || (SELECT brand_id FROM public.events WHERE id = v_e10)::text, 4514);
  PERFORM pg_temp.f_assert(EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid()
                                    AND ((l.classid::bigint << 32) | l.objid::bigint) = v_key AND l.granted),
    'T-W4-CONC-1 enqueue holds the brand lock until the transaction ends (two Asks at once queue in turn)');
  PERFORM pg_temp.f_assert((v->>'queued')::integer = 1 AND (SELECT count(*) FROM public.brand_form_request_sends s
      WHERE s.rsvp_id = v_rv AND s.status = 'queued' AND s.link_id IS NULL AND s.route = ARRAY['email']) = 1,
    'T-W4-QUEUE-1 the Ask only queues Val (no link yet): ' || v::text);
  v := public.brand_form_request_enqueue(v_em, v_w, v_e10, 'ask', 'everyone', v_val, ARRAY['email']);
  PERFORM pg_temp.f_assert((v->>'queued')::integer = 0 AND (v->>'throttled')::integer = 1
      AND (SELECT count(*) FROM public.brand_form_request_sends s WHERE s.rsvp_id = v_rv) = 1,
    'T-W4-CONC-2 the second Ask sees the first: Val is queued once');
  v := public.brand_form_request_claim_batch(100);
  v_c := (SELECT x FROM jsonb_array_elements(v) x WHERE (x->>'subjectId')::uuid = v_rv);
  RESET ROLE;
  PERFORM pg_temp.f_assert(v_c IS NOT NULL AND v_c->>'token' ~ '^[0-9a-f]{64}$' AND v_c->'route' = '["email"]'::jsonb
      AND v_c->>'email' = 'f4514-v@example.test' AND v_c->>'brandName' = 'Brand A',
    'T-W4-D17-1 the drain claims Val, mints her link and hands the route, contact and brand name');
  v_send := (v_c->>'sendId')::uuid;
  SELECT * INTO v_link FROM public.brand_form_links WHERE id = (SELECT link_id FROM public.brand_form_request_sends WHERE id = v_send);
  PERFORM pg_temp.f_assert(v_link.kind = 'person' AND v_link.form_id = v_w AND v_link.rsvp_id = v_rv
      AND v_link.token_hash = public.brand_form_token_hash(v_c->>'token') AND v_link.token_hash <> v_c->>'token',
    'T-W4-D17-2 a person link for exactly Val on this form, stored only as a hash');
  PERFORM pg_temp.f_assert((SELECT status = 'claimed' AND attempts = 1 FROM public.brand_form_request_sends WHERE id = v_send),
    'T-W4-D17-3 the send row is claimed, first try');
  SELECT concat_ws('|',
    (SELECT count(*) FROM public.brand_offering_invites),
    (SELECT count(*) FROM public.brand_offering_invite_delivery_attempts),
    (SELECT count(*) FROM public.marketing_send_groups),
    (SELECT md5(string_agg(x.id::text || x.rsvp_status || x.approval_status, ',' ORDER BY x.id)) FROM public.event_rsvps x WHERE x.event_id = v_e10),
    CASE WHEN to_regclass('public.private_event_access_grants') IS NULL THEN 'n/a'
         ELSE (SELECT count(*)::text FROM public.private_event_access_grants) END)
    INTO v_after;
  PERFORM pg_temp.f_assert(v_before = v_after,
    'T-W4-D17-4 no invite, attempt, send group or access grant; guest status unchanged (' || v_before || ' = ' || v_after || ')');
  -- A request whose edge request died: retried after 10 minutes, failed after 3 tries.
  UPDATE public.brand_form_request_sends SET claimed_at = now() - interval '11 minutes' WHERE id = v_send;
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_claim_batch(100);
  RESET ROLE;
  PERFORM pg_temp.f_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE (x->>'sendId')::uuid = v_send)
      AND (SELECT status = 'claimed' AND attempts = 2 FROM public.brand_form_request_sends WHERE id = v_send),
    'T-W4-QUEUE-2 a stale claim goes back to the queue and is sent again (second try)');
  UPDATE public.brand_form_request_sends SET claimed_at = now() - interval '11 minutes', attempts = 3 WHERE id = v_send;
  SET LOCAL ROLE service_role;
  PERFORM public.brand_form_request_claim_batch(100);
  RESET ROLE;
  PERFORM pg_temp.f_assert((SELECT status = 'failed' AND safe_reason = 'claim_expired' FROM public.brand_form_request_sends WHERE id = v_send),
    'T-W4-QUEUE-3 after 3 tries the stale claim fails, so it no longer blocks Val');
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(v_em, v_w, v_e10, 'remind', 'unanswered', v_val, ARRAY['email']);
  PERFORM pg_temp.f_assert((v->>'queued')::integer = 1, 'T-W4-THROTTLE-4 a failed request does not count: the host can try again');
  v := public.brand_form_request_enqueue(v_em, v_w, v_e10, 'remind', 'unanswered', v_val, ARRAY['email']);
  PERFORM pg_temp.f_assert((v->>'throttled')::integer = 1 AND (v->>'queued')::integer = 0,
    'T-W4-THROTTLE-2 a second request to Val within 24 hours is throttled (' || v::text || ')');
  v := public.brand_form_request_audience(v_em, v_w, v_e10, 'unanswered', NULL);
  PERFORM pg_temp.f_assert((SELECT (r->>'throttled')::boolean FROM jsonb_array_elements(v->'recipients') r WHERE (r->>'id')::uuid = v_rv),
    'T-W4-THROTTLE-3 the preview marks Val throttled');
  RESET ROLE;
  UPDATE public.brand_form_request_sends SET created_at = now() - interval '25 hours' WHERE rsvp_id = v_rv;
  SET LOCAL ROLE service_role;
  PERFORM public.brand_form_request_claim_batch(100);
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_request_sends WHERE rsvp_id = v_rv AND status = 'queued') = 0,
    'T-W4-QUEUE-4 a queued request older than 24 hours fails as expired');
  v := public.brand_form_request_enqueue(v_em, v_w, v_e10, 'remind', 'unanswered', v_val, ARRAY['email']);
  PERFORM pg_temp.f_assert((v->>'queued')::integer = 1, 'T-W4-THROTTLE-4b after 24 hours a new request is allowed');
  v := public.brand_form_request_enqueue(v_em, v_w, v_e10, 'remind', 'unanswered',
         jsonb_build_array(jsonb_build_object('kind', 'rsvp', 'id', v_rw)), ARRAY['email']);
  PERFORM pg_temp.f_assert((v->>'queued')::integer = 0
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends WHERE rsvp_id = v_rw),
    'T-W4-THROTTLE-5 Remind never reaches Wes, who answered (' || v::text || ')');
  PERFORM pg_temp.f_assert(pg_temp.f_err(format('SELECT public.brand_form_request_enqueue(%L, %L, %L, %L, %L, NULL, %L)',
      (SELECT id FROM f4514 WHERE k = 'mm_a'), v_w, v_e10, 'ask', 'unanswered', '{email}')) LIKE '42501:%',
    'T-W4-AUD-6 C5: a marketing manager cannot queue');
  RESET ROLE;
  -- Two guests who share Val's phone and have no account are two people (N5):
  -- each is in the audience, each gets their own request and their own link.
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_twin, v_e10, NULL, 'Vic Sharing', 'f4514-v2@example.test', '+12025551002', 'going', 'approved');
  PERFORM set_config('session_replication_role', 'origin', true);
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_audience(v_em, v_w, v_e10, 'everyone', NULL);
  PERFORM pg_temp.f_assert(jsonb_array_length(v->'recipients') = 4
      AND (SELECT (r->>'throttled')::boolean FROM jsonb_array_elements(v->'recipients') r WHERE (r->>'id')::uuid = v_rv)
      AND (SELECT NOT (r->>'throttled')::boolean AND r->>'personKey' = 's:rsvp:' || v_twin::text
             FROM jsonb_array_elements(v->'recipients') r WHERE (r->>'id')::uuid = v_twin),
    'T-W4-PERSON-1 Val and Vic share a phone but are two people: Val throttled, Vic not (' || (v->'recipients')::text || ')');
  v := public.brand_form_request_enqueue(v_em, v_w, v_e10, 'ask', 'everyone',
         jsonb_build_array(jsonb_build_object('kind', 'rsvp', 'id', v_twin)), ARRAY['email']);
  PERFORM pg_temp.f_assert((v->>'queued')::integer = 1, 'T-W4-PERSON-1b Vic is asked on his own (' || v::text || ')');
  v := public.brand_form_request_claim_batch(100);
  RESET ROLE;
  PERFORM pg_temp.f_assert((SELECT l.rsvp_id = v_twin AND l.kind = 'person' FROM public.brand_form_links l
                             WHERE l.id = (SELECT s.link_id FROM public.brand_form_request_sends s WHERE s.rsvp_id = v_twin))
      AND (SELECT count(DISTINCT s.link_id) FROM public.brand_form_request_sends s
            WHERE s.rsvp_id IN (v_rv, v_twin) AND s.status = 'claimed') = 2,
    'T-W4-PERSON-1c Vic gets his own link, not Val''s');
  INSERT INTO f4514 VALUES ('rv2', v_twin);
END
$t$;

-- T-W4-PERSON-2: one account with an RSVP and an order on the same page is one person.
DO $t$
DECLARE
  v_e10 uuid := (SELECT id FROM f4514 WHERE k = 'e10');
  v_w uuid := (SELECT id FROM f4514 WHERE k = 'form_w');
  v_em uuid := (SELECT id FROM f4514 WHERE k = 'em_a');
  v_user uuid := gen_random_uuid(); v_r uuid := gen_random_uuid(); v_o uuid := gen_random_uuid();
  v jsonb;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_r, v_e10, v_user, 'Uma Account', 'f4514-u1@example.test', '+12025551301', 'going', 'approved');
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source, is_door_sale)
  VALUES (v_o, v_e10, v_user, 'Uma Account', 'f4514-u2@example.test', '+12025551302', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false);
  PERFORM set_config('session_replication_role', 'origin', true);
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_audience(v_em, v_w, v_e10, 'everyone', NULL);
  PERFORM pg_temp.f_assert((SELECT count(*) FROM jsonb_array_elements(v->'recipients') r
                             WHERE r->>'personKey' = 'u:' || v_user::text) = 1
      AND jsonb_array_length(v->'recipients') = 5,
    'T-W4-PERSON-2 an account with an RSVP and an order is one person in the audience (' || (v->'recipients')::text || ')');
  v := public.brand_form_request_enqueue(v_em, v_w, v_e10, 'ask', 'everyone',
         jsonb_build_array(jsonb_build_object('kind', 'rsvp', 'id', v_r), jsonb_build_object('kind', 'order', 'id', v_o)),
         ARRAY['email']);
  RESET ROLE;
  PERFORM pg_temp.f_assert((v->>'queued')::integer = 1
      AND (SELECT count(*) FROM public.brand_form_request_sends WHERE person_key = 'u:' || v_user::text) = 1,
    'T-W4-PERSON-2b one request for that account, not one per booking (' || v::text || ')');
  DELETE FROM public.brand_form_request_sends WHERE person_key = 'u:' || v_user::text;
  PERFORM set_config('session_replication_role', 'replica', true);
  DELETE FROM public.orders WHERE id = v_o;
  DELETE FROM public.event_rsvps WHERE id = v_r;
  PERFORM set_config('session_replication_role', 'origin', true);
END
$t$;

-- T-W4-QUIET and T-W4-CAP
DO $t$
DECLARE
  v_e10 uuid := (SELECT id FROM f4514 WHERE k = 'e10');
  v_w uuid := (SELECT id FROM f4514 WHERE k = 'form_w');
  v_ri uuid := (SELECT id FROM f4514 WHERE k = 'ri');
  v_ba uuid := (SELECT id FROM f4514 WHERE k = 'ba');
  v_em uuid := (SELECT id FROM f4514 WHERE k = 'em_a');
  v_ike jsonb := jsonb_build_array(jsonb_build_object('kind', 'rsvp', 'id', v_ri));
  v jsonb; v_send uuid;
BEGIN
  UPDATE public.events SET timezone = (SELECT night_tz FROM f4514_tz) WHERE id = v_e10;
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(v_em, v_w, v_e10, 'ask', 'everyone', v_ike, ARRAY['sms', 'email']);
  RESET ROLE;
  SELECT id INTO v_send FROM public.brand_form_request_sends WHERE rsvp_id = v_ri AND status = 'queued';
  PERFORM pg_temp.f_assert((v->>'waitingForMorning')::integer = 1
      AND (SELECT not_before > now() + interval '1 hour' AND route = ARRAY['sms', 'email'] FROM public.brand_form_request_sends WHERE id = v_send),
    'T-W4-QUIET-2 at night in the page''s time zone the text waits for 9am (' || v::text || ')');
  UPDATE public.brand_form_request_sends SET not_before = now() WHERE id = v_send;
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_claim_batch(100);
  RESET ROLE;
  PERFORM pg_temp.f_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE (x->>'sendId')::uuid = v_send)
      AND (SELECT status = 'queued' AND not_before > now() FROM public.brand_form_request_sends WHERE id = v_send),
    'T-W4-QUIET-3 the drain re-checks the hour and keeps the text queued');
  UPDATE public.events SET timezone = (SELECT day_tz FROM f4514_tz) WHERE id = v_e10;
  UPDATE public.brand_form_request_sends SET not_before = now() WHERE id = v_send;
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_claim_batch(100);
  RESET ROLE;
  PERFORM pg_temp.f_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE (x->>'sendId')::uuid = v_send),
    'T-W4-QUIET-4 in the daytime the text goes out');
  -- The daily text limit: 300 texts already today.
  DELETE FROM public.brand_form_request_sends WHERE rsvp_id = v_ri;
  INSERT INTO public.brand_form_request_sends (form_id, event_id, brand_id, rsvp_id, person_key, kind, route, status)
  SELECT v_w, v_e10, v_ba, v_ri, 'p:cap' || g, 'ask', ARRAY['sms'], 'sent' FROM generate_series(1, 300) g;
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.f_assert(pg_temp.f_err(format('SELECT public.brand_form_request_enqueue(%L, %L, %L, %L, %L, %L, %L)',
      v_em, v_w, v_e10, 'ask', 'everyone', v_ike::text, '{sms,email}')) LIKE '%form_request_text_cap%',
    'T-W4-CAP-1 over the daily text limit: refused');
  v := public.brand_form_request_enqueue(v_em, v_w, v_e10, 'ask', 'everyone', v_ike, ARRAY['email']);
  PERFORM pg_temp.f_assert((v->>'queued')::integer = 1, 'T-W4-CAP-2 email still goes (the limit is on texts)');
  RESET ROLE;
  DELETE FROM public.brand_form_request_sends WHERE person_key LIKE 'p:cap%';
END
$t$;

-- T-W4-AUTO
DO $t$
DECLARE
  v_e10 uuid := (SELECT id FROM f4514 WHERE k = 'e10');
  v_w uuid := (SELECT id FROM f4514 WHERE k = 'form_w');
  v_att uuid := (SELECT a.id FROM public.brand_form_attachments a WHERE a.event_id = v_e10 AND a.detached_at IS NULL);
  v jsonb; v_out_before integer; v_run uuid;
BEGIN
  DELETE FROM public.brand_form_request_sends;
  SET LOCAL ROLE service_role;
  v := public.brand_form_auto_reminders_due();
  RESET ROLE;
  PERFORM pg_temp.f_assert(v = '{"held": 0, "runs": 0, "queued": 0}'::jsonb AND NOT EXISTS (SELECT 1 FROM public.brand_form_auto_reminder_runs),
    'T-W4-AUTO-0 off by default: nothing due, nothing written (' || v::text || ')');
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.f_assert(pg_temp.f_err(format('SELECT public.biz_brand_form_set_auto_remind(%L, true)', v_att)) LIKE '42501:%',
    'T-W4-AUTO-1 C5: a marketing manager cannot switch the reminder on');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'em_a'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.f_assert(pg_temp.f_err(format('SELECT public.biz_brand_form_set_auto_remind(%L, true, %L)', v_att, '{push}')) LIKE '22023:%',
    'T-W4-AUTO-1b push alone is refused while the Explorer form screen is not built');
  v := public.biz_brand_form_set_auto_remind(v_att, true, ARRAY['push', 'sms']);
  RESET ROLE;
  PERFORM pg_temp.f_assert((v->>'autoRemind')::boolean AND v->'channels' = '["sms"]'::jsonb,
    'T-W4-AUTO-2 an event manager switches it on; push is dropped, texts stored (' || v::text || ')');
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (v_e10, now() + interval '72 hours', now() + interval '75 hours', 'UTC', true);
  PERFORM set_config('session_replication_role', 'origin', true);
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.f_assert((public.brand_form_auto_reminders_due()->>'runs')::integer = 0, 'T-W4-AUTO-2b three days out: not due');
  RESET ROLE;
  UPDATE public.event_dates SET start_at = now() + interval '47 hours', end_at = now() + interval '50 hours' WHERE event_id = v_e10;
  SET LOCAL ROLE service_role;
  v := public.brand_form_auto_reminders_due();
  PERFORM pg_temp.f_assert((v->>'runs')::integer = 1 AND (v->>'queued')::integer = 3
      AND (SELECT count(*) FROM public.brand_form_request_sends s WHERE s.kind = 'auto' AND s.route = ARRAY['sms']
             AND s.status = 'queued' AND s.event_id = v_e10) = 3,
    'T-W4-AUTO-3 two days before: one run, Val, Vic and Ike queued on texts, Wes (answered) left out (' || v::text || ')');
  v := public.brand_form_auto_reminders_due();
  PERFORM pg_temp.f_assert((v->>'queued')::integer = 0 AND (v->>'runs')::integer = 0
      AND (SELECT count(*) FROM public.brand_form_request_sends WHERE kind = 'auto') = 3, 'T-W4-AUTO-3b never twice');
  -- N3: a host Ask right after the reminder queued Val does not reach her again.
  v := public.brand_form_request_enqueue((SELECT id FROM f4514 WHERE k = 'em_a'), v_w, v_e10, 'ask', 'everyone',
         jsonb_build_array(jsonb_build_object('kind', 'rsvp', 'id', (SELECT id FROM f4514 WHERE k = 'rv'))), ARRAY['email', 'sms']);
  PERFORM pg_temp.f_assert((v->>'queued')::integer = 0 AND (v->>'throttled')::integer = 1
      AND (SELECT count(*) FROM public.brand_form_request_sends WHERE rsvp_id = (SELECT id FROM f4514 WHERE k = 'rv')) = 1,
    'T-W4-AUTOLOCK-1 an Ask after the reminder: Val is throttled, one request in 24 hours (' || v::text || ')');
  v := public.brand_form_request_claim_batch(100);
  PERFORM public.brand_form_request_settle((x->>'sendId')::uuid, 'sms', 'sent', NULL) FROM jsonb_array_elements(v) x;
  PERFORM public.brand_form_request_claim_batch(100);
  RESET ROLE;
  PERFORM pg_temp.f_assert((SELECT outcome = 'sent' AND settled_at IS NOT NULL FROM public.brand_form_auto_reminder_runs WHERE attachment_id = v_att),
    'T-W4-AUTO-3c the run settles as sent once nothing is left in the queue');
  -- A run stuck with undelivered rows for a day: the rows fail and the run shows failed.
  SELECT id INTO v_run FROM public.brand_form_auto_reminder_runs WHERE attachment_id = v_att;
  UPDATE public.brand_form_auto_reminder_runs SET outcome = 'sending', settled_at = NULL WHERE id = v_run;
  UPDATE public.brand_form_request_sends SET status = 'queued', created_at = now() - interval '25 hours' WHERE run_id = v_run;
  SET LOCAL ROLE service_role;
  PERFORM public.brand_form_request_claim_batch(100);
  RESET ROLE;
  PERFORM pg_temp.f_assert((SELECT outcome = 'failed' FROM public.brand_form_auto_reminder_runs WHERE id = v_run)
      AND (SELECT bool_and(status = 'failed' AND safe_reason = 'expired') FROM public.brand_form_request_sends WHERE run_id = v_run),
    'T-W4-AUTO-3d a stuck run is closed as failed, visibly, never left at sending');
  -- N2: the automatic reminder keeps to the day's text limit. 299 texts already
  -- today leave one: one guest is texted, the other two are skipped (texts only).
  DELETE FROM public.brand_form_request_sends;
  DELETE FROM public.brand_form_auto_reminder_runs WHERE attachment_id = v_att;
  INSERT INTO public.brand_form_request_sends (form_id, event_id, brand_id, rsvp_id, person_key, kind, route, status)
  SELECT v_w, v_e10, (SELECT brand_id FROM public.events WHERE id = v_e10), (SELECT id FROM f4514 WHERE k = 'ri'),
         'p:cap' || g, 'ask', ARRAY['sms'], 'sent' FROM generate_series(1, 299) g;
  SET LOCAL ROLE service_role;
  v := public.brand_form_auto_reminders_due();
  RESET ROLE;
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_request_sends WHERE kind = 'auto' AND status = 'queued' AND route = ARRAY['sms']) = 1
      AND (SELECT count(*) FROM public.brand_form_request_sends WHERE kind = 'auto' AND status = 'skipped'
             AND safe_reason = 'text_cap' AND route = ARRAY['sms'] AND settled_at IS NOT NULL) = 2
      AND public.brand_form_request_texts_today((SELECT brand_id FROM public.events WHERE id = v_e10)) = 300,
    'T-W4-AUTOCAP-1 one text left: one guest texted, two skipped with text_cap, the limit is not overrun');
  -- No texts left, text and email ticked: guests with an email get the email
  -- (marked text_cap); Vic, whose email bounced, is skipped.
  DELETE FROM public.brand_form_request_sends WHERE kind = 'auto';
  DELETE FROM public.brand_form_auto_reminder_runs WHERE attachment_id = v_att;
  INSERT INTO public.brand_form_request_sends (form_id, event_id, brand_id, rsvp_id, person_key, kind, route, status)
  VALUES (v_w, v_e10, (SELECT brand_id FROM public.events WHERE id = v_e10), (SELECT id FROM f4514 WHERE k = 'ri'),
          'p:cap300', 'ask', ARRAY['sms'], 'sent');
  UPDATE public.brand_form_attachments SET auto_remind_channels = ARRAY['email', 'sms'] WHERE id = v_att;
  -- Vic's email bounced: no consent to email him, so no email route.
  INSERT INTO public.channel_suppressions (contact, channel, scope, reason)
  VALUES ('f4514-v2@example.test', 'email', 'all', 'bounce');
  SET LOCAL ROLE service_role;
  v := public.brand_form_auto_reminders_due();
  RESET ROLE;
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_request_sends WHERE kind = 'auto' AND status = 'queued'
                              AND route = ARRAY['email'] AND safe_reason = 'text_cap') = 2
      AND (SELECT status = 'skipped' AND safe_reason = 'text_cap' FROM public.brand_form_request_sends
            WHERE kind = 'auto' AND rsvp_id = (SELECT id FROM f4514 WHERE k = 'rv2'))
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends WHERE kind = 'auto' AND status = 'queued' AND route[1] = 'sms'),
    'T-W4-AUTOCAP-2 no texts left: Val and Ike get the email (text_cap), Vic with no email route is skipped (text_cap)');
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_claim_batch(100);
  PERFORM public.brand_form_request_settle((x->>'sendId')::uuid, 'email', 'sent', NULL) FROM jsonb_array_elements(v) x;
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'em_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_request_log(v_w, v_e10, NULL, 500);
  RESET ROLE;
  PERFORM pg_temp.f_assert((SELECT count(*) FROM jsonb_array_elements(v->'sends') x
                             WHERE x->>'kind' = 'auto' AND x->>'reason' = 'text_cap' AND x->>'status' = 'sent' AND x->>'channel' = 'email') = 2
      AND (SELECT count(*) FROM jsonb_array_elements(v->'sends') x
            WHERE x->>'kind' = 'auto' AND x->>'reason' = 'text_cap' AND x->>'status' = 'skipped' AND x->>'channel' = 'sms') = 1,
    'T-W4-AUTOCAP-3 the delivery log shows who was emailed instead and who was skipped for the text limit');
  DELETE FROM public.channel_suppressions WHERE contact = 'f4514-v2@example.test';
  UPDATE public.brand_form_attachments SET auto_remind_channels = ARRAY['sms'] WHERE id = v_att;
  -- Decision 10: a closed form's reminder is held and the host told with a link.
  DELETE FROM public.brand_form_request_sends;
  DELETE FROM public.brand_form_auto_reminder_runs WHERE attachment_id = v_att;
  UPDATE public.brand_forms SET status = 'closed', closed_at = now() WHERE id = v_w;
  SELECT count(*) INTO v_out_before FROM public.notification_outbox WHERE category_key = 'business.brand_form_reminder_held';
  SET LOCAL ROLE service_role;
  v := public.brand_form_auto_reminders_due();
  RESET ROLE;
  PERFORM pg_temp.f_assert((v->>'held')::integer = 1 AND (v->>'queued')::integer = 0
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends)
      AND (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'business.brand_form_reminder_held'
             AND user_id = (SELECT created_by FROM public.brand_form_attachments WHERE id = v_att)
             AND payload->>'deep_link' = 'mingla-business://marketing/forms/' || v_w::text || '/responses'
             AND idempotency_key LIKE 'brand_form_reminder_held:' || v_att::text || ':%') = v_out_before + 1,
    'T-W4-AUTO-4 a closed form: held, nothing sent, the attaching host told once with a link to the form');
  UPDATE public.brand_forms SET status = 'live', closed_at = NULL WHERE id = v_w;
  UPDATE public.brand_form_attachments SET auto_remind = false WHERE id = v_att;
END
$t$;

-- T-W4-DATES: each guest's own date (a multi-date page and an experience).
DO $t$
DECLARE
  v_ba uuid := (SELECT id FROM f4514 WHERE k = 'ba');
  v_w uuid := (SELECT id FROM f4514 WHERE k = 'form_w');
  v_em uuid := (SELECT id FROM f4514 WHERE k = 'em_a');
  v_e12 uuid := gen_random_uuid(); v_e13 uuid := gen_random_uuid();
  v_d0 uuid := gen_random_uuid(); v_d1 uuid := gen_random_uuid(); v_d2 uuid := gen_random_uuid();
  v_oa uuid := gen_random_uuid(); v_ob uuid := gen_random_uuid(); v_oc uuid := gen_random_uuid();
  v_ox uuid := gen_random_uuid(); v_oy uuid := gen_random_uuid();
  v_ta uuid := gen_random_uuid(); v_tb uuid := gen_random_uuid(); v_tc uuid := gen_random_uuid();
  v jsonb;
BEGIN
  -- N6: static SQL, and every column it reads exists (a rename fails here, not quietly at runtime).
  PERFORM pg_temp.f_assert((SELECT count(*) FROM information_schema.columns c
                             WHERE c.table_schema = 'public' AND (c.table_name, c.column_name) IN (
                               ('orders', 'booked_start_at'), ('orders', 'event_id'), ('orders', 'id'),
                               ('events', 'event_type'), ('events', 'id'),
                               ('tickets', 'order_id'), ('tickets', 'id'),
                               ('ticket_event_dates', 'ticket_id'), ('ticket_event_dates', 'event_date_id'),
                               ('event_dates', 'id'), ('event_dates', 'event_id'), ('event_dates', 'start_at'),
                               ('event_dates', 'cancelled_at'))) = 13
      AND (SELECT data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'booked_start_at') = 'timestamp with time zone',
    'T-W4-DATES-0a every column brand_form_guest_dates reads exists, booked_start_at a timestamptz');
  PERFORM pg_temp.f_assert(NOT EXISTS (SELECT 1 FROM pg_proc
                             WHERE oid IN ('public.brand_form_guest_dates(text,uuid,uuid)'::regprocedure,
                                           'public.brand_form_auto_reminders_due()'::regprocedure)
                               AND (prosrc ~* '\mEXECUTE\M' OR prosrc LIKE '%to_jsonb(o)%')),
    'T-W4-DATES-0b brand_form_guest_dates and the due check use static SQL (no EXECUTE, no to_jsonb(o) read)');
  DELETE FROM public.brand_form_request_sends;
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_e12, v_ba, 'Many dates twelve', 'f4514-e12', 'event', 'scheduled', 'public', 'UTC', 'USD'),
         (v_e13, v_ba, 'Experience thirteen', 'f4514-e13', 'experience', 'scheduled', 'public', 'UTC', 'USD');
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  VALUES (v_d0, v_e12, now() - interval '1 day', now() - interval '20 hours', 'UTC', false),
         (v_d1, v_e12, now() + interval '47 hours', now() + interval '50 hours', 'UTC', true),
         (v_d2, v_e12, now() + interval '96 hours', now() + interval '99 hours', 'UTC', false);
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source, is_door_sale, booked_start_at)
  VALUES (v_oa, v_e12, NULL, 'Ada Day One', 'f4514-da@example.test', '+12025551201', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, NULL),
         (v_ob, v_e12, NULL, 'Ben Day Two', 'f4514-db@example.test', '+12025551202', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, NULL),
         (v_oc, v_e12, NULL, 'Cy Past Day', 'f4514-dc@example.test', '+12025551203', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, NULL),
         (v_ox, v_e13, NULL, 'Xi Booked Soon', 'f4514-xs@example.test', '+12025551204', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, now() + interval '47 hours'),
         (v_oy, v_e13, NULL, 'Yu Booked Later', 'f4514-yl@example.test', '+12025551205', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, now() + interval '10 days');
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, attendee_name, attendee_email, qr_code, status, created_at, transferred_at, holder_user_id)
  VALUES (v_ta, v_oa, gen_random_uuid(), v_e12, 'Ada', NULL, 'f4514-qr-da', 'valid', now(), NULL, NULL),
         (v_tb, v_ob, gen_random_uuid(), v_e12, 'Ben', NULL, 'f4514-qr-db', 'valid', now(), NULL, NULL),
         (v_tc, v_oc, gen_random_uuid(), v_e12, 'Cy', NULL, 'f4514-qr-dc', 'valid', now(), NULL, NULL);
  INSERT INTO public.ticket_event_dates (ticket_id, event_date_id) VALUES (v_ta, v_d1), (v_tb, v_d2), (v_tc, v_d0);
  INSERT INTO public.brand_form_attachments (form_id, brand_id, event_id, mode, auto_remind, auto_remind_channels, created_by)
  VALUES (v_w, v_ba, v_e12, 'after_purchase', true, ARRAY['email'], v_em),
         (v_w, v_ba, v_e13, 'after_purchase', true, ARRAY['email'], v_em);
  PERFORM set_config('session_replication_role', 'origin', true);
  PERFORM pg_temp.f_assert((SELECT array_agg(d ORDER BY d) FROM public.brand_form_guest_dates('order', v_oa, v_e12) d)
                             = ARRAY[(SELECT start_at FROM public.event_dates WHERE id = v_d1)]
      AND (SELECT array_agg(d) FROM public.brand_form_guest_dates('order', v_ox, v_e13) d)
             = ARRAY[(SELECT booked_start_at FROM public.orders WHERE id = v_ox)],
    'T-W4-DATES-1 a guest''s own date: the ticket''s date, the experience''s booked slot');
  SET LOCAL ROLE service_role;
  v := public.brand_form_auto_reminders_due();
  RESET ROLE;
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_request_sends WHERE event_id = v_e12) = 1
      AND EXISTS (SELECT 1 FROM public.brand_form_request_sends WHERE order_id = v_oa AND kind = 'auto'
                    AND starts_at = (SELECT start_at FROM public.event_dates WHERE id = v_d1)),
    'T-W4-DATES-2 a multi-date page: only Ada (her date is in two days) is reminded, not Ben (later) or Cy (past)');
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_auto_reminder_runs WHERE event_id = v_e12) = 1,
    'T-W4-DATES-3 one run for that page and date');
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_request_sends WHERE event_id = v_e13) = 1
      AND EXISTS (SELECT 1 FROM public.brand_form_request_sends WHERE order_id = v_ox AND kind = 'auto'),
    'T-W4-DATES-4 an experience: Xi (booked in two days) is reminded, Yu (booked in ten) is not');
  INSERT INTO f4514 VALUES ('e12', v_e12), ('e13', v_e13);
END
$t$;

-- T-W4-LOG: the host delivery log.
DO $t$
DECLARE
  v_e12 uuid := (SELECT id FROM f4514 WHERE k = 'e12');
  v_w uuid := (SELECT id FROM f4514 WHERE k = 'form_w');
  v jsonb;
BEGIN
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'em_a'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_request_log(v_w, v_e12);
  RESET ROLE;
  PERFORM pg_temp.f_assert(jsonb_array_length(v->'sends') = 1 AND v->'sends'->0->>'name' IS NOT NULL
      AND v->'sends'->0->>'status' = 'queued' AND v->'sends'->0->>'channel' = 'email'
      AND (v->'counts'->>'queued')::integer = 1 AND jsonb_array_length(v->'runs') = 1
      AND v::text NOT LIKE '%example.test%' AND v::text NOT LIKE '%token%',
    'T-W4-LOG-1 an event manager reads each guest''s request, outcome and the runs; no contact, no link (' || v::text || ')');
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'mm_a'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.f_assert(pg_temp.f_err(format('SELECT public.biz_brand_form_request_log(%L, %L)', v_w, v_e12)) LIKE '42501:%',
    'T-W4-LOG-2 C5: a marketing manager cannot read the delivery log');
  PERFORM pg_temp.f_assert(pg_temp.f_err(format('SELECT public.biz_brand_form_request_log(%L, %L)', gen_random_uuid(), v_e12)) LIKE '42501:%',
    'T-W4-LOG-3 the role is checked first: a marketing manager probing a form id that does not exist gets forbidden, not form_not_found');
  RESET ROLE;
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'owner_b'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.f_assert(pg_temp.f_err(format('SELECT public.biz_brand_form_request_log(%L, %L)', gen_random_uuid(), v_e12)) LIKE '42501:%'
      AND pg_temp.f_err(format('SELECT public.biz_brand_form_request_log(%L, %L)', gen_random_uuid(), gen_random_uuid())) LIKE '42501:%',
    'T-W4-LOG-4 another brand''s owner learns nothing about which forms or pages exist');
  RESET ROLE;
END
$t$;

-- T-W4-STARTED (N4): at claim, a request whose guest date has started is skipped.
DO $t$
DECLARE
  v_e12 uuid := (SELECT id FROM f4514 WHERE k = 'e12');
  v_e13 uuid := (SELECT id FROM f4514 WHERE k = 'e13');
  v_w uuid := (SELECT id FROM f4514 WHERE k = 'form_w');
  v_em uuid := (SELECT id FROM f4514 WHERE k = 'em_a');
  v_oc uuid := (SELECT id FROM public.orders WHERE event_id = (SELECT id FROM f4514 WHERE k = 'e12') AND buyer_name = 'Cy Past Day');
  v_oa uuid := (SELECT id FROM public.orders WHERE event_id = (SELECT id FROM f4514 WHERE k = 'e12') AND buyer_name = 'Ada Day One');
  v_ox uuid := (SELECT id FROM public.orders WHERE event_id = (SELECT id FROM f4514 WHERE k = 'e13') AND buyer_name = 'Xi Booked Soon');
  v jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(v_em, v_w, v_e12, 'ask', 'everyone',
         jsonb_build_array(jsonb_build_object('kind', 'order', 'id', v_oc)), ARRAY['email']);
  v := public.brand_form_request_claim_batch(100, v_w, v_e12);
  RESET ROLE;
  PERFORM pg_temp.f_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE (x->>'subjectId')::uuid = v_oc)
      AND (SELECT status = 'skipped' AND safe_reason = 'event_started' AND link_id IS NULL
             FROM public.brand_form_request_sends WHERE order_id = v_oc)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE (x->>'subjectId')::uuid = v_oa),
    'T-W4-STARTED-1 an Ask to Cy, whose date has passed, is skipped at claim (no link, nothing sent); Ada (in two days) goes');
  UPDATE public.brand_form_request_sends SET starts_at = now() - interval '1 minute', not_before = now()
   WHERE order_id = v_ox AND kind = 'auto';
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_claim_batch(100, v_w, v_e13);
  RESET ROLE;
  PERFORM pg_temp.f_assert(jsonb_array_length(v) = 0
      AND (SELECT status = 'skipped' AND safe_reason = 'event_started' FROM public.brand_form_request_sends
            WHERE order_id = v_ox AND kind = 'auto'),
    'T-W4-STARTED-2 an automatic reminder held past the guest''s start (quiet hours) is skipped, never sent after the event');
END
$t$;

-- T-W4-AUTOLOCK-2 (N3): the reminder takes the brand lock enqueue takes. Brand B has had no
-- Ask in this transaction, so its lock is held only if the reminder took it.
DO $t$
DECLARE
  v_bb uuid := (SELECT id FROM f4514 WHERE k = 'bb');
  v_w uuid := (SELECT id FROM f4514 WHERE k = 'form_w');
  v_e14 uuid := gen_random_uuid();
  v_key bigint := hashtextextended('brand_form_request:' || (SELECT id FROM f4514 WHERE k = 'bb')::text, 4514);
  v jsonb;
BEGIN
  PERFORM pg_temp.f_assert(NOT EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid()
                                        AND ((l.classid::bigint << 32) | l.objid::bigint) = v_key),
    'T-W4-AUTOLOCK-2a brand B''s lock is not held before the reminder runs');
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_e14, v_bb, 'Brand B fourteen', 'f4514-e14', 'event', 'scheduled', 'public', 'UTC', 'USD');
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (v_e14, now() + interval '47 hours', now() + interval '50 hours', 'UTC', true);
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_e14, NULL, 'Bo Brand B', 'f4514-bo@example.test', '+12025551401', 'going', 'approved');
  INSERT INTO public.brand_form_attachments (form_id, brand_id, event_id, mode, auto_remind, auto_remind_channels, created_by)
  VALUES (v_w, v_bb, v_e14, 'after_purchase', true, ARRAY['email'], (SELECT id FROM f4514 WHERE k = 'owner_b'));
  PERFORM set_config('session_replication_role', 'origin', true);
  SET LOCAL ROLE service_role;
  v := public.brand_form_auto_reminders_due();
  RESET ROLE;
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_request_sends WHERE event_id = v_e14) = 1
      AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid()
                    AND ((l.classid::bigint << 32) | l.objid::bigint) = v_key AND l.granted),
    'T-W4-AUTOLOCK-2b the reminder queued Bo under brand B''s lock, held to the end of the transaction (' || v::text || ')');
END
$t$;

-- ═══ Wave 5: T-CHECKOUT (the checkout Questions step, §3.6, C1, C8) ═══════════
-- T-CHECKOUT-1..3  required + marker: missing answers, invalid answers and a stale version are
--                  refused by the check and by the stash, and nothing is stashed.
-- T-CHECKOUT-4     no marker: 'to_answer' and nothing stashed (the order completes unanswered).
-- T-CHECKOUT-5     the off switch: 'off', nothing checked, nothing stashed.
-- T-CHECKOUT-6     atomicity: valid answers are stashed, NOT a response; a failed payment (no
--                  order_id) leaves no response; a finalize that fails after setting order_id
--                  rolls the response back with it; a success leaves exactly one response for the
--                  order and removes the stash; a replayed finalize adds none.
-- T-CHECKOUT-7     an optional form never blocks, and its answers are kept when given.
-- T-CHECKOUT-8     anon and signed-in cannot call the checkout RPCs or read the stash.
-- T-PURCHASE-LINK  "After they purchase": only the session's own buyer status token, only a
--                  completed session, only an after-purchase form; a link names the order;
--                  answered says so; never an invite.
-- FAILS-ON-REVERT (wave 5): deleting the required RAISE in brand_form_checkout_check fails
-- T-CHECKOUT-1; dropping the trigger fails T-CHECKOUT-6c; deleting the capable test fails
-- T-CHECKOUT-4; deleting the switched-off test fails T-CHECKOUT-5.
DO $t$
DECLARE
  v_ba uuid := (SELECT id FROM f4514 WHERE k = 'ba');
  v_form uuid := (SELECT id FROM f4514 WHERE k = 'form');
  v_ver uuid := (SELECT live_version_id FROM public.brand_forms WHERE id = (SELECT id FROM f4514 WHERE k = 'form'));
  v_ec uuid := gen_random_uuid(); v_eo uuid := gen_random_uuid(); v_ep uuid := gen_random_uuid();
  v_s1 uuid := gen_random_uuid(); v_s2 uuid := gen_random_uuid(); v_s3 uuid := gen_random_uuid();
  v_s4 uuid := gen_random_uuid(); v_s5 uuid := gen_random_uuid();
  v_o1 uuid := gen_random_uuid(); v_o3 uuid := gen_random_uuid(); v_o5 uuid := gen_random_uuid();
  c_ok jsonb := jsonb_build_object('11111111-1111-4111-8111-111111111111', 'yes',
                                   '22222222-2222-4222-8222-222222222222', 'Juggle');
  c_bad jsonb := jsonb_build_object('11111111-1111-4111-8111-111111111111', 'yes');
  v_r text; v jsonb; v_failed boolean := false;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_ec, v_ba, 'Checkout required', 'f4514-w5-req', 'event', 'scheduled', 'public', 'UTC', 'USD'),
         (v_eo, v_ba, 'Checkout optional', 'f4514-w5-opt', 'experience', 'scheduled', 'public', 'UTC', 'USD'),
         (v_ep, v_ba, 'After purchase', 'f4514-w5-after', 'event', 'scheduled', 'public', 'UTC', 'USD');
  INSERT INTO public.ticket_checkout_sessions(id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    idempotency_key, expires_at, status, total_cents, currency, buyer_status_token_hash)
  VALUES (v_s1, v_ec, v_ba, 'Ann Buyer', 'f4514-w5a@example.test', '+12025550301', 'w5-s1', now() + interval '1 hour', 'requires_payment', 1000, 'USD', NULL),
         (v_s2, v_ec, v_ba, 'Bob Buyer', 'f4514-w5b@example.test', '+12025550302', 'w5-s2', now() + interval '1 hour', 'requires_payment', 1000, 'USD', NULL),
         (v_s3, v_eo, v_ba, 'Cat Buyer', 'f4514-w5c@example.test', '+12025550303', 'w5-s3', now() + interval '1 hour', 'pending_free', 0, 'USD', NULL),
         (v_s4, v_ec, v_ba, 'Dee Buyer', 'f4514-w5d@example.test', '+12025550304', 'w5-s4', now() + interval '1 hour', 'requires_payment', 1000, 'USD', NULL),
         (v_s5, v_ep, v_ba, 'Eve Buyer', 'f4514-w5e@example.test', '+12025550305', 'w5-s5', now() + interval '1 hour', 'paid_completed', 1000, 'USD',
          encode(extensions.digest('eve-buyer-status-token-0123456789abcdef', 'sha256'), 'hex'));
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source, is_door_sale)
  VALUES (v_o1, v_ec, NULL, 'Ann Buyer', 'f4514-w5a@example.test', '+12025550301', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false),
         (v_o3, v_eo, NULL, 'Cat Buyer', 'f4514-w5c@example.test', '+12025550303', 0, 'USD', 'free', 'paid', 'online_checkout', false),
         (v_o5, v_ep, NULL, 'Eve Buyer', 'f4514-w5e@example.test', '+12025550305', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false);
  UPDATE public.ticket_checkout_sessions SET order_id = v_o5 WHERE id = v_s5;
  PERFORM set_config('session_replication_role', 'origin', true);
  INSERT INTO f4514 VALUES ('w5_ec', v_ec), ('w5_ep', v_ep), ('w5_s5', v_s5), ('w5_o5', v_o5);

  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'em_a'));
  SET LOCAL ROLE authenticated;
  PERFORM public.biz_brand_form_attach(v_form, v_ec, 'required_step');
  PERFORM public.biz_brand_form_attach(v_form, v_eo, 'optional_on_page');
  PERFORM public.biz_brand_form_attach(v_form, v_ep, 'after_purchase');
  RESET ROLE;

  -- T-CHECKOUT-8: no client grant.
  PERFORM pg_temp.f_as((SELECT id FROM f4514 WHERE k = 'g1'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_checkout_check(%L, true, NULL, NULL, NULL)$$, v_ec));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-CHECKOUT-8 a signed-in caller cannot run the check (' || v_r || ')');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_checkout_stash(%L, %L, true, NULL, NULL, NULL)$$, v_s1, v_ec));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-CHECKOUT-8 a signed-in caller cannot stash');
  v_r := pg_temp.f_err($$SELECT count(*) FROM public.brand_form_checkout_answers$$);
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-CHECKOUT-8 a signed-in caller cannot read the stash');
  RESET ROLE;
  PERFORM pg_temp.f_as(NULL);
  SET LOCAL ROLE anon;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_purchase_link(%L, %L)$$, v_s5, repeat('a', 64)));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-CHECKOUT-8 anon cannot ask for a purchase link directly');
  RESET ROLE;

  SET LOCAL ROLE service_role;
  -- T-CHECKOUT-1: required + marker + no answers.
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_checkout_check(%L, true, NULL, NULL, NULL)$$, v_ec));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:form_answers_required%', 'T-CHECKOUT-1 missing answers are refused (' || v_r || ')');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_checkout_stash(%L, %L, true, NULL, NULL, NULL)$$, v_s1, v_ec));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:form_answers_required%', 'T-CHECKOUT-1 the stash refuses them too');
  -- T-CHECKOUT-2: invalid (Q2 is required once Q1 = yes).
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_checkout_check(%L, true, %L::jsonb, NULL, NULL)$$, v_ec,
           jsonb_build_object('formId', v_form, 'versionId', v_ver, 'answers', c_bad)));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:form_answers_invalid%', 'T-CHECKOUT-2 invalid answers are refused (' || v_r || ')');
  -- T-CHECKOUT-3: a version that is no longer live, and another form's answers.
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_checkout_check(%L, true, %L::jsonb, NULL, NULL)$$, v_ec,
           jsonb_build_object('formId', v_form, 'versionId', gen_random_uuid(), 'answers', c_ok)));
  PERFORM pg_temp.f_assert(v_r LIKE 'PT409:form_changed%', 'T-CHECKOUT-3 a stale version is form_changed (PT409)');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_checkout_check(%L, true, %L::jsonb, NULL, NULL)$$, v_ec,
           jsonb_build_object('formId', (SELECT id FROM f4514 WHERE k = 'form_y'), 'versionId', v_ver, 'answers', c_ok)));
  PERFORM pg_temp.f_assert(v_r LIKE 'PT409:form_changed%', 'T-CHECKOUT-3 another form''s answers are form_changed');
  PERFORM pg_temp.f_assert(NOT EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = v_s1),
    'T-CHECKOUT-1..3 nothing was stashed for a refused checkout');
  -- T-CHECKOUT-4: no marker.
  v := public.brand_form_checkout_check(v_ec, false, NULL, NULL, NULL);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'to_answer', 'T-CHECKOUT-4 no marker: the order completes as to answer (' || v::text || ')');
  v := public.brand_form_checkout_stash(v_s2, v_ec, false, jsonb_build_object('formId', v_form, 'versionId', v_ver, 'answers', c_ok), NULL, NULL);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'to_answer'
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = v_s2),
    'T-CHECKOUT-4 no marker: nothing is stashed');
  RESET ROLE;

  -- T-CHECKOUT-5: the off switch.
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'BRAND_FORMS_KILL_SWITCH';
  SET LOCAL ROLE service_role;
  v := public.brand_form_checkout_check(v_ec, true, NULL, NULL, NULL);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'off', 'T-CHECKOUT-5 switched off: a required form does not block (' || v::text || ')');
  v := public.brand_form_checkout_stash(v_s4, v_ec, true, NULL, NULL, NULL);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'off', 'T-CHECKOUT-5 switched off: the stash passes and keeps nothing');
  RESET ROLE;
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'BRAND_FORMS_KILL_SWITCH';

  -- T-CHECKOUT-6: atomicity.
  SET LOCAL ROLE service_role;
  v := public.brand_form_checkout_stash(v_s1, v_ec, true,
         jsonb_build_object('formId', v_form, 'versionId', v_ver, 'answers', c_ok || jsonb_build_object('33333333-3333-4333-8333-333333333333', NULL)), NULL, NULL);
  RESET ROLE;
  PERFORM pg_temp.f_assert(v->>'outcome' = 'stash'
      AND (SELECT count(*) FROM public.brand_form_checkout_answers WHERE checkout_session_id = v_s1) = 1
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses WHERE event_id = v_ec),
    'T-CHECKOUT-6a valid answers are stashed and are not yet a response');
  -- Payment fails: the session never gets an order.
  UPDATE public.ticket_checkout_sessions SET status = 'failed' WHERE id = v_s1;
  PERFORM pg_temp.f_assert(NOT EXISTS (SELECT 1 FROM public.brand_form_responses WHERE event_id = v_ec),
    'T-CHECKOUT-6b a failed payment leaves no response');
  UPDATE public.ticket_checkout_sessions SET status = 'requires_payment' WHERE id = v_s1;
  -- A finalize that fails after giving the session its order rolls the response back with it.
  BEGIN
    UPDATE public.ticket_checkout_sessions SET order_id = v_o1, status = 'paid_completed' WHERE id = v_s1;
    PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_responses WHERE order_id = v_o1) = 1,
      'T-CHECKOUT-6c the response is written inside the finalize transaction');
    RAISE EXCEPTION 'simulated_finalize_failure';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'simulated_finalize_failure' THEN RAISE; END IF;
    v_failed := true;
  END;
  PERFORM pg_temp.f_assert(v_failed AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses WHERE order_id = v_o1)
      AND (SELECT order_id FROM public.ticket_checkout_sessions WHERE id = v_s1) IS NULL
      AND EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = v_s1),
    'T-CHECKOUT-6d a finalize that fails keeps neither order link nor response; the stash survives for the retry');
  UPDATE public.ticket_checkout_sessions SET order_id = v_o1, status = 'paid_completed' WHERE id = v_s1;
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_responses WHERE order_id = v_o1) = 1
      AND (SELECT answers->>'22222222-2222-4222-8222-222222222222' FROM public.brand_form_responses WHERE order_id = v_o1) = 'Juggle'
      AND (SELECT version_id FROM public.brand_form_responses WHERE order_id = v_o1) = v_ver
      AND (SELECT event_id FROM public.brand_form_responses WHERE order_id = v_o1) = v_ec
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = v_s1),
    'T-CHECKOUT-6e a paid order has exactly one response with the answers, and the stash is gone');
  -- A replayed webhook: the same order again, then a status touch.
  UPDATE public.ticket_checkout_sessions SET order_id = v_o1 WHERE id = v_s1;
  UPDATE public.ticket_checkout_sessions SET status = 'paid_completed' WHERE id = v_s1;
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_responses WHERE order_id = v_o1) = 1,
    'T-CHECKOUT-6f a replayed finalize adds no second response');
  -- A replayed create on a finalized session keeps nothing new.
  SET LOCAL ROLE service_role;
  v := public.brand_form_checkout_stash(v_s1, v_ec, true, NULL, NULL, NULL);
  RESET ROLE;
  PERFORM pg_temp.f_assert(v->>'outcome' = 'finalized', 'T-CHECKOUT-6g a create replayed after the order exists is left alone');

  -- T-CHECKOUT-7: optional (an experience): skipping never blocks; answers given are kept (free order).
  SET LOCAL ROLE service_role;
  v := public.brand_form_checkout_check(v_eo, true, NULL, NULL, NULL);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'none', 'T-CHECKOUT-7 an optional form with no answers passes');
  v := public.brand_form_checkout_check(v_eo, true, jsonb_build_object('formId', v_form, 'versionId', gen_random_uuid(), 'answers', c_ok), NULL, NULL);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'none', 'T-CHECKOUT-7 stale optional answers never block');
  v := public.brand_form_checkout_stash(v_s3, v_eo, true, jsonb_build_object('formId', v_form, 'versionId', v_ver, 'answers', c_ok), NULL, NULL);
  RESET ROLE;
  UPDATE public.ticket_checkout_sessions SET order_id = v_o3, status = 'free_completed' WHERE id = v_s3;
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_form_responses WHERE order_id = v_o3) = 1,
    'T-CHECKOUT-7 a free order keeps its optional answers in the same transaction');
END
$t$;

-- ═══ Wave 5 review fixes: T-CHECKOUT-VIS, T-CHECKOUT-OP5, T-CHECKOUT-PURGE ══════
-- T-CHECKOUT-VIS-1  a private (#1931) page with a required form, no credential: the checkout
--                   read shows no form and the check does not refuse ("to answer"); nothing stashed.
-- T-CHECKOUT-VIS-2  the same page, the signed-in buyer's active current-epoch grant: the read gives
--                   the step and the check enforces (refuses missing answers, stashes valid ones).
-- T-CHECKOUT-VIS-3  another user's grant, or private access switched off: no form, no refusal.
-- T-CHECKOUT-VIS-4  the read never widens what an anonymous reader sees: the form itself only.
-- T-CHECKOUT-VIS-5  a private ticket link (#3827): live for this event gives step plus enforcement;
--                   a hash that is not a live link here gives no form and no refusal.
-- T-CHECKOUT-OP5    a signed-in buyer's existing response to the form counts as answered: no step,
--                   no refusal, nothing stashed, and the new order shows as answered.
-- T-CHECKOUT-PURGE  stashed answers of an abandoned session are purged 7 days after it expired, a
--                   live one is kept; the stash never blocks removing its form (CASCADE); the purge
--                   is hooked into the existing forms retention job, with no new job.
-- FAILS-ON-REVERT: replacing brand_form_checkout_visible's private branch with "RETURN true" fails
-- T-CHECKOUT-VIS-1; dropping the visibility test in brand_form_checkout_check fails
-- T-CHECKOUT-VIS-1/3; dropping the OP-5 test fails T-CHECKOUT-OP5; dropping the purge DELETE fails
-- T-CHECKOUT-PURGE-1; restoring RESTRICT on the stash form_id fails T-CHECKOUT-PURGE-3.
DO $t$
DECLARE
  v_ba uuid := (SELECT id FROM f4514 WHERE k = 'ba');
  v_form uuid := (SELECT id FROM f4514 WHERE k = 'form');
  v_ver uuid := (SELECT live_version_id FROM public.brand_forms WHERE id = (SELECT id FROM f4514 WHERE k = 'form'));
  -- Fresh people: none of them has answered this form anywhere before.
  v_g1 uuid := pg_temp.f_user('w5fix_grant');
  v_g2 uuid := pg_temp.f_user('w5fix_other');
  v_op5 uuid := pg_temp.f_user('w5fix_op5');
  v_epv uuid := gen_random_uuid(); v_eh uuid := gen_random_uuid(); v_eo5 uuid := gen_random_uuid();
  v_tt uuid := gen_random_uuid(); v_link uuid := gen_random_uuid();
  v_sp uuid := gen_random_uuid(); v_sh uuid := gen_random_uuid(); v_so uuid := gen_random_uuid();
  v_sa uuid := gen_random_uuid(); v_sb uuid := gen_random_uuid(); v_oo uuid := gen_random_uuid();
  v_hash text := encode(extensions.digest('w5fix-ticket-link', 'sha256'), 'hex');
  c_ok jsonb := jsonb_build_object('11111111-1111-4111-8111-111111111111', 'yes',
                                   '22222222-2222-4222-8222-222222222222', 'Juggle');
  v_ans jsonb; v_r text; v jsonb; v_keys text[];
BEGIN
  v_ans := jsonb_build_object('formId', v_form, 'versionId', v_ver, 'answers', c_ok);
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_epv, v_ba, 'Private page', 'f4514-w5fix-private', 'event', 'scheduled', 'private', 'UTC', 'USD'),
         (v_eh, v_ba, 'Link page', 'f4514-w5fix-link', 'event', 'scheduled', 'hidden', 'UTC', 'USD'),
         (v_eo5, v_ba, 'OP-5 page', 'f4514-w5fix-op5', 'event', 'scheduled', 'public', 'UTC', 'USD');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, quantity_total, currency, available_online)
  VALUES (v_tt, v_eh, 'Link tier', 1000, 50, 'USD', true);
  INSERT INTO public.ticket_type_links(id, event_id, brand_id, ticket_type_id, kind, label, party_max,
    token_nonce, token_hash, created_by)
  VALUES (v_link, v_eh, v_ba, v_tt, 'private_ticket', 'Friends', 1, decode(md5(v_link::text), 'hex'), v_hash,
          (SELECT id FROM f4514 WHERE k = 'em_a'));
  INSERT INTO public.private_event_access_state(event_id, epoch, active, setup_state)
  VALUES (v_epv, 1, true, 'ready');
  INSERT INTO public.private_event_access_grants(event_id, epoch, principal_kind, bound_user_id, capability_hash, expires_at)
  VALUES (v_epv, 1, 'authenticated_user', v_g1, encode(extensions.digest('w5fix-grant-g1', 'sha256'), 'hex'), now() + interval '1 hour');
  INSERT INTO public.ticket_checkout_sessions(id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    idempotency_key, expires_at, status, total_cents, currency, buyer_status_token_hash)
  VALUES (v_sp, v_epv, v_ba, 'Pia', 'f4514-w5f1@example.test', '+12025550311', 'w5f-sp', now() + interval '1 hour', 'requires_payment', 1000, 'USD', NULL),
         (v_sh, v_eh, v_ba, 'Hal', 'f4514-w5f2@example.test', '+12025550312', 'w5f-sh', now() + interval '1 hour', 'requires_payment', 1000, 'USD', NULL),
         (v_so, v_eo5, v_ba, 'Oli', 'f4514-w5f3@example.test', '+12025550313', 'w5f-so', now() + interval '1 hour', 'requires_payment', 1000, 'USD', NULL),
         (v_sa, v_eo5, v_ba, 'Abe', 'f4514-w5f4@example.test', '+12025550314', 'w5f-sa', now() - interval '8 days', 'expired', 1000, 'USD', NULL),
         (v_sb, v_eo5, v_ba, 'Bea', 'f4514-w5f5@example.test', '+12025550315', 'w5f-sb', now() - interval '6 days', 'expired', 1000, 'USD', NULL);
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source, is_door_sale)
  VALUES (v_oo, v_eo5, v_op5, 'Oli', 'f4514-w5f3@example.test', '+12025550313', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false);
  INSERT INTO public.brand_form_attachments(form_id, brand_id, event_id, mode, created_by)
  VALUES (v_form, v_ba, v_epv, 'required_step', (SELECT id FROM f4514 WHERE k = 'em_a')),
         (v_form, v_ba, v_eh, 'required_step', (SELECT id FROM f4514 WHERE k = 'em_a')),
         (v_form, v_ba, v_eo5, 'required_step', (SELECT id FROM f4514 WHERE k = 'em_a'));
  PERFORM set_config('session_replication_role', 'origin', true);
  UPDATE public.private_event_access_runtime SET enabled = true WHERE singleton;

  -- T-CHECKOUT-VIS-4 / no client grant on the new reads.
  PERFORM pg_temp.f_as(NULL);
  SET LOCAL ROLE anon;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_checkout_form(%L, NULL, NULL)$$, v_eh));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-CHECKOUT-VIS-4 anon cannot call the checkout read directly (' || v_r || ')');
  v_r := pg_temp.f_err($$SELECT public.brand_form_checkout_answers_purge()$$);
  PERFORM pg_temp.f_assert(v_r LIKE '42501:%', 'T-CHECKOUT-PURGE anon cannot run the purge');
  v := public.public_brand_form_for_event(v_epv);
  PERFORM pg_temp.f_assert((v->>'active')::boolean IS FALSE, 'T-CHECKOUT-VIS-4 the public read still shows nothing for a private page');
  RESET ROLE;

  SET LOCAL ROLE service_role;
  -- T-CHECKOUT-VIS-1: private, no credential.
  v := public.brand_form_checkout_form(v_epv, NULL, NULL);
  PERFORM pg_temp.f_assert((v->>'active')::boolean IS FALSE AND v - 'active' = '{}'::jsonb,
    'T-CHECKOUT-VIS-1 no credential: the read shows nothing at all (' || v::text || ')');
  v := public.brand_form_checkout_check(v_epv, true, NULL, NULL, NULL);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'to_answer',
    'T-CHECKOUT-VIS-1 no credential: no refusal, the order completes as to answer (' || v::text || ')');
  v := public.brand_form_checkout_stash(v_sp, v_epv, true, v_ans, NULL, NULL);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'to_answer'
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = v_sp),
    'T-CHECKOUT-VIS-1 no credential: nothing is stashed');
  -- T-CHECKOUT-VIS-2: private, the buyer's own grant.
  v := public.brand_form_checkout_form(v_epv, v_g1, NULL);
  PERFORM pg_temp.f_assert(v->>'mode' = 'required_step' AND v->'requiredForm'->>'versionId' = v_ver::text
      AND v ? 'definition' AND v->'brand' IS NOT NULL,
    'T-CHECKOUT-VIS-2 with the grant: the read gives the step (' || left(v::text, 200) || ')');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_checkout_check(%L, true, NULL, %L, NULL)$$, v_epv, v_g1));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:form_answers_required%',
    'T-CHECKOUT-VIS-2 with the grant: missing answers are refused (' || v_r || ')');
  v := public.brand_form_checkout_stash(v_sp, v_epv, true, v_ans, v_g1, NULL);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'stash'
      AND EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = v_sp),
    'T-CHECKOUT-VIS-2 with the grant: valid answers are stashed');
  -- T-CHECKOUT-VIS-3: another user's grant; then private access switched off.
  v := public.brand_form_checkout_form(v_epv, v_g2, NULL);
  PERFORM pg_temp.f_assert((v->>'active')::boolean IS FALSE, 'T-CHECKOUT-VIS-3 another user''s grant shows nothing');
  v := public.brand_form_checkout_check(v_epv, true, NULL, v_g2, NULL);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'to_answer', 'T-CHECKOUT-VIS-3 another user''s grant is never refused');
  RESET ROLE;
  UPDATE public.private_event_access_runtime SET enabled = false WHERE singleton;
  SET LOCAL ROLE service_role;
  v := public.brand_form_checkout_check(v_epv, true, NULL, v_g1, NULL);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'to_answer'
      AND (public.brand_form_checkout_form(v_epv, v_g1, NULL)->>'active')::boolean IS FALSE,
    'T-CHECKOUT-VIS-3 private access off: no form and no refusal');
  -- T-CHECKOUT-VIS-4: the read is the form only.
  v := public.brand_form_checkout_form(v_eh, NULL, NULL);
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v) k;
  PERFORM pg_temp.f_assert(v_keys <@ ARRAY['active','brand','definition','doorFullAnswers','formId','mode','name',
                                           'questionCount','requiredForm','versionId','answered']
      AND v = public.public_brand_form_for_event(v_eh),
    'T-CHECKOUT-VIS-4 the read is exactly the public form shape, no more (' || array_to_string(v_keys, ',') || ')');
  -- T-CHECKOUT-VIS-5: a private ticket link.
  v := public.brand_form_checkout_form(v_eh, NULL, v_hash);
  PERFORM pg_temp.f_assert(v->>'mode' = 'required_step', 'T-CHECKOUT-VIS-5 a live link gives the step');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_checkout_check(%L, true, NULL, NULL, %L)$$, v_eh, v_hash));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:form_answers_required%', 'T-CHECKOUT-VIS-5 a live link: missing answers are refused (' || v_r || ')');
  v := public.brand_form_checkout_stash(v_sh, v_eh, true, v_ans, NULL, v_hash);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'stash', 'T-CHECKOUT-VIS-5 a live link: valid answers are stashed');
  v := public.brand_form_checkout_form(v_eh, NULL, repeat('a', 64));
  PERFORM pg_temp.f_assert((v->>'active')::boolean IS FALSE
      AND public.brand_form_checkout_check(v_eh, true, NULL, NULL, repeat('a', 64))->>'outcome' = 'to_answer',
    'T-CHECKOUT-VIS-5 a hash that is not a live link here: no form and no refusal');
  RESET ROLE;
  UPDATE public.ticket_type_links SET revoked_at = now() WHERE id = v_link;
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.f_assert(public.brand_form_checkout_check(v_eh, true, NULL, NULL, v_hash)->>'outcome' = 'to_answer'
      AND (public.brand_form_checkout_form(v_eh, NULL, v_hash)->>'active')::boolean IS FALSE,
    'T-CHECKOUT-VIS-5 a revoked link: no form and no refusal');

  -- T-CHECKOUT-OP5: the signed-in buyer already answered this form (on another page).
  RESET ROLE;
  INSERT INTO public.brand_form_responses (form_id, version_id, brand_id, event_id, user_id, answers, source)
  VALUES (v_form, v_ver, v_ba, (SELECT id FROM f4514 WHERE k = 'w5_ec'), v_op5, c_ok, 'page');
  SET LOCAL ROLE service_role;
  v := public.brand_form_checkout_form(v_eo5, v_op5, NULL);
  PERFORM pg_temp.f_assert((v->>'answered')::boolean IS TRUE, 'T-CHECKOUT-OP5 the read says answered: no step (' || left(v::text, 120) || ')');
  v := public.brand_form_checkout_check(v_eo5, true, NULL, v_op5, NULL);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'answered', 'T-CHECKOUT-OP5 the check does not refuse (' || v::text || ')');
  v := public.brand_form_checkout_stash(v_so, v_eo5, true, NULL, v_op5, NULL);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'answered'
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = v_so),
    'T-CHECKOUT-OP5 nothing is stashed');
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_checkout_check(%L, true, NULL, %L, NULL)$$, v_eo5, v_g2));
  PERFORM pg_temp.f_assert(v_r LIKE '22023:form_answers_required%', 'T-CHECKOUT-OP5 a buyer with no response is still asked (' || v_r || ')');
  RESET ROLE;
  UPDATE public.ticket_checkout_sessions SET order_id = v_oo, status = 'paid_completed' WHERE id = v_so;
  PERFORM pg_temp.f_assert(NOT EXISTS (SELECT 1 FROM public.brand_form_responses WHERE order_id = v_oo)
      AND (public.brand_form_find_response(v_form, 'order', v_oo)).user_id = v_op5,
    'T-CHECKOUT-OP5 the order adds no second response and shows as answered through the buyer''s own');

  -- T-CHECKOUT-PURGE.
  INSERT INTO public.brand_form_checkout_answers (checkout_session_id, event_id, form_id, version_id, answers)
  VALUES (v_sa, v_eo5, v_form, v_ver, c_ok), (v_sb, v_eo5, v_form, v_ver, c_ok);
  SET LOCAL ROLE service_role;
  PERFORM public.brand_form_checkout_answers_purge();
  RESET ROLE;
  PERFORM pg_temp.f_assert(NOT EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = v_sa),
    'T-CHECKOUT-PURGE-1 an abandoned session''s answers are gone 7 days after it expired');
  PERFORM pg_temp.f_assert(EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = v_sb)
      AND EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = v_sh),
    'T-CHECKOUT-PURGE-2 a session expired 6 days ago and a live one keep theirs');
  PERFORM pg_temp.f_assert(
    (SELECT array_agg(c.confdeltype::text ORDER BY a.attname)
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.conrelid = 'public.brand_form_checkout_answers'::regclass AND c.contype = 'f'
        AND a.attname IN ('form_id', 'version_id')) = ARRAY['c', 'c'],
    'T-CHECKOUT-PURGE-3 the stash never blocks removing its form or version (ON DELETE CASCADE)');
  PERFORM pg_temp.f_assert(
    to_regnamespace('cron') IS NULL
    OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_4452_forms_retention')
    OR ((SELECT command FROM cron.job WHERE jobname = 'issue_4452_forms_retention') LIKE '%brand_form_checkout_answers_purge()%'
        AND NOT EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%brand_form_checkout_answers_purge%'
                          AND jobname <> 'issue_4452_forms_retention')),
    'T-CHECKOUT-PURGE-4 the purge runs in the existing forms retention job, and no other');
END
$t$;

-- ═══ T-PURCHASE-LINK ("After they purchase", §5.5, decision 17) ═════════════════
DO $t$
DECLARE
  v_s5 uuid := (SELECT id FROM f4514 WHERE k = 'w5_s5');
  v_o5 uuid := (SELECT id FROM f4514 WHERE k = 'w5_o5');
  v_ec uuid := (SELECT id FROM f4514 WHERE k = 'w5_ec');
  v_hash text := encode(extensions.digest('eve-buyer-status-token-0123456789abcdef', 'sha256'), 'hex');
  v_invites_before bigint := (SELECT count(*) FROM public.brand_offering_invites);
  v_r text; v jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_purchase_link(%L, %L)$$, v_s5, repeat('a', 64)));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:link_invalid%', 'T-PURCHASE-LINK another token is refused (' || v_r || ')');
  v := public.brand_form_purchase_link(v_s5, v_hash);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'link' AND (v->>'token') ~ '^[0-9a-f]{64}$'
      AND EXISTS (SELECT 1 FROM public.brand_form_links l WHERE l.order_id = v_o5 AND l.kind = 'person'
                    AND l.token_hash = public.brand_form_token_hash(v->>'token')),
    'T-PURCHASE-LINK the buyer gets a personal link that names their order (' || v::text || ')');
  RESET ROLE;
  PERFORM pg_temp.f_assert((SELECT count(*) FROM public.brand_offering_invites) = v_invites_before,
    'T-PURCHASE-LINK no invite is created (decision 17)');
  INSERT INTO public.brand_form_responses (form_id, version_id, brand_id, attachment_id, event_id, order_id, answers, source)
  SELECT a.form_id, f.live_version_id, f.brand_id, a.id, a.event_id, v_o5, '{}'::jsonb, 'purchase_redirect'
    FROM public.brand_form_attachments a JOIN public.brand_forms f ON f.id = a.form_id
   WHERE a.event_id = (SELECT event_id FROM public.ticket_checkout_sessions WHERE id = v_s5) AND a.detached_at IS NULL;
  SET LOCAL ROLE service_role;
  v := public.brand_form_purchase_link(v_s5, v_hash);
  PERFORM pg_temp.f_assert(v->>'outcome' = 'answered', 'T-PURCHASE-LINK an answered order is told so, no new link');
  -- A required-step page is not an after-purchase page.
  v_r := pg_temp.f_err(format($$SELECT public.brand_form_purchase_link(%L, %L)$$,
           (SELECT id FROM public.ticket_checkout_sessions WHERE event_id = v_ec AND order_id IS NOT NULL LIMIT 1), v_hash));
  PERFORM pg_temp.f_assert(v_r LIKE '42501:link_invalid%', 'T-PURCHASE-LINK one buyer''s token never opens another session');
  RESET ROLE;
END
$t$;

ROLLBACK;
