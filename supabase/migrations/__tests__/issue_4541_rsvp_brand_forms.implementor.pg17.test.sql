\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4541-RSVP-FORM-ATOMIC | issue #4541 | capable RSVP clients validate a live required form before the RSVP write and persist the RSVP plus response in one transaction; a later response failure rolls the RSVP back (T-ATOMIC).
-- MINGLA-INVARIANT: I-4541-RSVP-FORM-OLD-CLIENT-FAIL-OPEN | issue #4541 | an incapable client and not-going RSVP keep the #4508 delivery behavior and write no response, while required malformed or stale capable submissions write no RSVP (T-WRAPPER).
-- MINGLA-INVARIANT: I-4541-CLAIMED-PLUS-ONE-OWNS-ANSWERS | issue #4541 | a claimed plus-one stores and reads answers only on their exact rsvp_guest subject; the inviter response is never inherited or overwritten and a matched-only guest is refused (T-GUEST).
-- MINGLA-INVARIANT: I-4541-RSVP-GUEST-REQUEST-EXACT | issue #4541 | Ask/Remind queues a claimed plus-one using rsvp_guest_id, and link and door reads preserve that exact subject (T-REQUEST, T-DOOR).
-- MINGLA-INVARIANT: I-4541-RSVP-WRAPPER-EXACT-SUBJECT | issue #4541 | the RSVP wrapper writes only the response row tied to the RSVP id it just saved and never moves the same person's answer on another subject or event (T-NO-MOVE).
-- MINGLA-INVARIANT: I-4541-RSVP-WRAPPER-INSERT-ONLY | issue #4541 | the RSVP wrapper never updates a stored answer and inserts only non-empty answers when neither this RSVP id nor the same person at this event (account row, own RSVP/order/claimed plus-one) already has a response (T-NO-WIPE, T-NO-DUP).
-- MINGLA-INVARIANT: I-4541-RSVP-WRAPPER-SERVICE-ONLY | issue #4541 | the atomic RSVP wrapper and its subject helpers are SECURITY DEFINER with an empty search path and are executable only by service_role (T-GRANT).
-- #4541 RSVP brand forms: PostgreSQL 17 executable proof after the full migration replay.
--
-- T-GRANT    the new wrapper/helpers have empty search_path and no anon/authenticated/PUBLIC grant.
-- T-ORDER    the wrapper's source locks only form authority before the unchanged delivery call;
--            its response/person lock and write occur after that call.
-- T-WRAPPER  required missing/malformed/stale capable requests fail before RSVP; old clients and
--            not-going requests retain the delivery result without a form response.
-- T-ATOMIC   valid capable RSVP creates the response on the returned RSVP id; a forced response
--            failure after the delivery call rolls both writes back.
-- T-GUEST    a claimed plus-one submits on rsvp_guest_id, appears as that exact pending subject,
--            and reads their own response; an unclaimed matched row is refused.
-- T-REQUEST  a one-person Ask row stores only rsvp_guest_id.
-- T-DOOR     scanner line/full reads return the claimed plus-one answer, not the inviter answer;
--            an unclaimed row cannot be read as a door subject.
-- T-UNANSWERED-GUEST  a claimed, unanswered plus-one is pending/unanswered/not_answered
--            everywhere and never shows the inviter answer.
-- T-HOLDER   the Host responses read returns holder = null for an rsvp_guest row.
-- T-NO-MOVE  a plus-one answer at event A stays put when that person RSVPs at event B.
-- T-OPTIONAL-FAIL-OPEN  optional form + malformed/stale/invalid answers saves the RSVP only.
-- T-REQUIRED-INVALID    required form + invalid/malformed answers writes no RSVP.
-- T-KILL-SWITCH         the off switch lets a required RSVP through with no answers.
-- T-NO-WIPE  a re-RSVP (Maybe) with {} or only the required answer keeps the stored row as is.
-- T-NO-DUP   an RSVP with answers by a person whose account-level answer exists adds no row.
--
-- FAILS-ON-REVERT: removing the RSVP transaction wrapper fails T-ATOMIC; accepting a capable
-- required RSVP without answers fails T-WRAPPER; resolving rsvp_guest through its inviter fails
-- T-GUEST/T-DOOR/T-UNANSWERED-GUEST; dropping request_sends.rsvp_guest_id fails T-REQUEST;
-- granting the wrapper to authenticated or anon fails T-GRANT; resolving the wrapper's write
-- row through the person fallback fails T-NO-MOVE; refusing optional bad answers fails
-- T-OPTIONAL-FAIL-OPEN; ignoring the off switch fails T-KILL-SWITCH; updating the stored row on
-- re-RSVP fails T-NO-WIPE; checking only the exact RSVP id fails T-NO-DUP.

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4541 RSVP brand forms FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN json_build_object('role', 'anon')::text
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
END;
$fn$;

BEGIN;

CREATE TEMP TABLE i4541 (k text PRIMARY KEY, id uuid);
GRANT ALL ON i4541 TO authenticated, anon, service_role;

DO $fixture$
DECLARE
  v_owner uuid := '45410000-0000-4000-8000-000000000001';
  v_brand uuid := '45410000-0000-4000-8000-000000000002';
  v_event uuid := '45410000-0000-4000-8000-000000000003';
  v_form uuid := '45410000-0000-4000-8000-000000000004';
  v_version uuid := '45410000-0000-4000-8000-000000000005';
  v_attachment uuid := '45410000-0000-4000-8000-000000000006';
  v_scanner uuid := '45410000-0000-4000-8000-000000000007';
  v_valid uuid := '45410000-0000-4000-8000-000000000011';
  v_old uuid := '45410000-0000-4000-8000-000000000012';
  v_missing uuid := '45410000-0000-4000-8000-000000000013';
  v_stale uuid := '45410000-0000-4000-8000-000000000014';
  v_atomic uuid := '45410000-0000-4000-8000-000000000015';
  v_decline uuid := '45410000-0000-4000-8000-000000000016';
  v_guest uuid := '45410000-0000-4000-8000-000000000017';
  v_unclaimed_user uuid := '45410000-0000-4000-8000-000000000018';
  v_ask_user uuid := '45410000-0000-4000-8000-000000000019';
  v_def jsonb := '{"schema":"mingla.brand_form.v1","title":"Guest questions","intro":"A quick question","questions":[{"id":"45410000-0000-4000-8000-000000000101","position":0,"type":"short_text","label":"Dietary needs","required":true,"show_at_door":true,"door_label":"Diet"}]}'::jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'i4541-owner@example.test'), (v_scanner, 'i4541-scanner@example.test'),
    (v_valid, 'i4541-valid@example.test'), (v_old, 'i4541-old@example.test'),
    (v_missing, 'i4541-missing@example.test'), (v_stale, 'i4541-stale@example.test'),
    (v_atomic, 'i4541-atomic@example.test'), (v_decline, 'i4541-decline@example.test'),
    (v_guest, 'i4541-guest@example.test'), (v_unclaimed_user, 'i4541-unclaimed@example.test'),
    (v_ask_user, 'i4541-ask@example.test');
  INSERT INTO public.profiles(id, email, display_name, first_name, last_name, phone) VALUES
    (v_valid, 'i4541-valid@example.test', 'Valid Guest', 'Valid', 'Guest', '+15554541011'),
    (v_guest, 'i4541-guest@example.test', 'Claimed Guest', 'Claimed', 'Guest', '+15554541017'),
    (v_unclaimed_user, 'i4541-unclaimed@example.test', 'Matched Only', 'Matched', 'Only', '+15554541018'),
    (v_ask_user, 'i4541-ask@example.test', 'Ask Guest', 'Ask', 'Guest', '+15554541019');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'i4541-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES (v_brand, v_owner, 'Issue 4541 Brand', 'issue-4541-brand', 'stripe', 'US', 'USD', 'USD',
    'i4541-host@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, rsvp_guests_can_bring, published_at)
  VALUES (v_event, v_brand, v_owner, 'Issue 4541 Night', 'issue-4541-night', 'rsvp', 'scheduled',
    'public', 'America/New_York', 'USD', NULL, false, 'auto', true, 4, true, now());
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event, now() + interval '5 days', now() + interval '5 days 4 hours',
    'America/New_York', true);
  INSERT INTO public.event_scanners(event_id, user_id, assigned_by)
  VALUES (v_event, v_scanner, v_owner);

  INSERT INTO public.brand_forms(id, brand_id, name, status, draft, created_by, updated_by)
  VALUES (v_form, v_brand, 'RSVP questions', 'draft', v_def, v_owner, v_owner);
  INSERT INTO public.brand_form_versions(id, form_id, version, definition, definition_sha256, published_by)
  VALUES (v_version, v_form, 1, v_def, encode(digest(v_def::text, 'sha256'), 'hex'), v_owner);
  UPDATE public.brand_forms SET status = 'live', live_version_id = v_version WHERE id = v_form;
  INSERT INTO public.brand_form_attachments(id, form_id, brand_id, event_id, mode, created_by)
  VALUES (v_attachment, v_form, v_brand, v_event, 'required_step', v_owner);

  INSERT INTO i4541 VALUES
    ('owner', v_owner), ('brand', v_brand), ('event', v_event), ('form', v_form),
    ('version', v_version), ('attachment', v_attachment), ('scanner', v_scanner),
    ('valid', v_valid), ('old', v_old), ('missing', v_missing), ('stale', v_stale),
    ('atomic', v_atomic), ('decline', v_decline), ('guest', v_guest),
    ('unclaimed_user', v_unclaimed_user), ('ask_user', v_ask_user);
END;
$fixture$;

-- T-GRANT / T-ORDER ----------------------------------------------------------
DO $test$
DECLARE
  v_def text := pg_get_functiondef('public.submit_event_rsvp_with_form(uuid,uuid,text,text,text,text,integer,jsonb,text,text,boolean,jsonb)'::regprocedure);
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'submit_event_rsvp_with_form', 'brand_form_subject_event', 'brand_form_user_response',
    'brand_form_find_response', 'brand_form_person_response', 'brand_form_person_lock_key',
    'brand_form_subject_contact'
  ] LOOP
    PERFORM pg_temp.ok(NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_name
         AND (has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
      'T-GRANT ' || v_name || ' is not client executable');
    PERFORM pg_temp.ok(NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_name
         AND (NOT p.prosecdef OR p.proconfig IS NULL
           OR NOT ('search_path=""' = ANY (p.proconfig)))),
      'T-GRANT ' || v_name || ' is SECURITY DEFINER with empty search_path');
  END LOOP;
  PERFORM pg_temp.ok(has_function_privilege('service_role',
    'public.submit_event_rsvp_with_form(uuid,uuid,text,text,text,text,integer,jsonb,text,text,boolean,jsonb)', 'EXECUTE'),
    'T-GRANT service_role executes the wrapper');
  PERFORM pg_temp.ok(strpos(v_def, 'v_result := public.submit_event_rsvp_with_delivery') > 0
    AND strpos(v_def, 'PERFORM pg_advisory_xact_lock') > strpos(v_def, 'v_result := public.submit_event_rsvp_with_delivery')
    AND strpos(v_def, 'FOR SHARE OF a, f') < strpos(v_def, 'v_result := public.submit_event_rsvp_with_delivery')
    AND v_def !~* 'FOR (NO KEY )?UPDATE OF (r|g|event_rsvps|event_rsvp_guests)',
    'T-ORDER RSVP/person locking stays owned by the inner delivery RPC');
END;
$test$;

-- T-WRAPPER / T-ATOMIC -------------------------------------------------------
DO $test$
DECLARE
  v_event uuid := (SELECT id FROM i4541 WHERE k = 'event');
  v_form uuid := (SELECT id FROM i4541 WHERE k = 'form');
  v_version uuid := (SELECT id FROM i4541 WHERE k = 'version');
  v_valid uuid := (SELECT id FROM i4541 WHERE k = 'valid');
  v_old uuid := (SELECT id FROM i4541 WHERE k = 'old');
  v_missing uuid := (SELECT id FROM i4541 WHERE k = 'missing');
  v_stale uuid := (SELECT id FROM i4541 WHERE k = 'stale');
  v_decline uuid := (SELECT id FROM i4541 WHERE k = 'decline');
  v_result jsonb; v_rsvp uuid; v_error text;
BEGIN
  v_error := pg_temp.err(format($sql$SELECT public.submit_event_rsvp_with_form(
    %L,%L,'Missing Guest','i4541-missing@example.test','+15554541013','going',0,'[]',NULL,'US',true,NULL)$sql$,
    v_event, v_missing));
  PERFORM pg_temp.ok(v_error LIKE '22023:form_answers_required%'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = v_event AND user_id = v_missing),
    'T-WRAPPER required missing answers write no RSVP: ' || v_error);

  v_error := pg_temp.err(format($sql$SELECT public.submit_event_rsvp_with_form(
    %L,%L,'Stale Guest','i4541-stale@example.test','+15554541014','going',0,'[]',NULL,'US',true,
    %L::jsonb)$sql$, v_event, v_stale,
    jsonb_build_object('formId', v_form, 'versionId', gen_random_uuid(),
      'answers', jsonb_build_object('45410000-0000-4000-8000-000000000101', 'No nuts'))::text));
  PERFORM pg_temp.ok(v_error LIKE 'PT409:form_changed%'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = v_event AND user_id = v_stale),
    'T-WRAPPER stale form writes no RSVP: ' || v_error);

  v_result := public.submit_event_rsvp_with_form(v_event, v_old, 'Old Client',
    'i4541-old@example.test', '+15554541012', 'going', 0, '[]', NULL, 'US', false, NULL);
  PERFORM pg_temp.ok((v_result->>'rsvpId')::uuid IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses r
      WHERE r.rsvp_id = (v_result->>'rsvpId')::uuid),
    'T-WRAPPER old client RSVPs and remains unanswered');

  v_result := public.submit_event_rsvp_with_form(v_event, v_decline, 'Decline Guest',
    'i4541-decline@example.test', '+15554541016', 'not_going', 0, '[]', NULL, 'US', true, NULL);
  PERFORM pg_temp.ok(v_result->>'status' = 'not_going'
    AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses r
      WHERE r.rsvp_id = (v_result->>'rsvpId')::uuid),
    'T-WRAPPER not-going never asks or writes answers');

  v_result := public.submit_event_rsvp_with_form(v_event, v_valid, 'Valid Guest',
    'i4541-valid@example.test', '+15554541011', 'going', 0, '[]', NULL, 'US', true,
    jsonb_build_object('formId', v_form, 'versionId', v_version,
      'answers', jsonb_build_object('45410000-0000-4000-8000-000000000101', 'Gluten-free')));
  v_rsvp := (v_result->>'rsvpId')::uuid;
  INSERT INTO i4541 VALUES ('valid_rsvp', v_rsvp);
  PERFORM pg_temp.ok((v_result->>'brandFormResponseId')::uuid IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.brand_form_responses r
      WHERE r.id = (v_result->>'brandFormResponseId')::uuid AND r.rsvp_id = v_rsvp
        AND r.source = 'signup'
        AND r.answers->>'45410000-0000-4000-8000-000000000101' = 'Gluten-free'),
    'T-ATOMIC valid RSVP and form response use the same RSVP id');
END;
$test$;

CREATE OR REPLACE FUNCTION pg_temp.reject_atomic_response()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.rsvp_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.event_rsvps r WHERE r.id = NEW.rsvp_id
      AND r.guest_email = 'i4541-atomic@example.test') THEN
    RAISE EXCEPTION 'forced_response_failure';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER i4541_reject_atomic_response
  BEFORE INSERT OR UPDATE ON public.brand_form_responses
  FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_atomic_response();

DO $test$
DECLARE
  v_event uuid := (SELECT id FROM i4541 WHERE k = 'event');
  v_form uuid := (SELECT id FROM i4541 WHERE k = 'form');
  v_version uuid := (SELECT id FROM i4541 WHERE k = 'version');
  v_atomic uuid := (SELECT id FROM i4541 WHERE k = 'atomic');
  v_error text;
BEGIN
  v_error := pg_temp.err(format($sql$SELECT public.submit_event_rsvp_with_form(
    %L,%L,'Atomic Guest','i4541-atomic@example.test','+15554541015','going',0,'[]',NULL,'US',true,
    %L::jsonb)$sql$, v_event, v_atomic,
    jsonb_build_object('formId', v_form, 'versionId', v_version,
      'answers', jsonb_build_object('45410000-0000-4000-8000-000000000101', 'Kosher'))::text));
  PERFORM pg_temp.ok(v_error LIKE 'P0001:forced_response_failure%'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = v_event AND user_id = v_atomic)
    AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses r
      JOIN public.event_rsvps x ON x.id = r.rsvp_id WHERE x.user_id = v_atomic),
    'T-ATOMIC response failure rolls back the inner RSVP: ' || v_error);
END;
$test$;
DROP TRIGGER i4541_reject_atomic_response ON public.brand_form_responses;
DROP FUNCTION pg_temp.reject_atomic_response();

-- T-GUEST / T-REQUEST / T-DOOR ---------------------------------------------
DO $test$
DECLARE
  v_owner uuid := (SELECT id FROM i4541 WHERE k = 'owner');
  v_event uuid := (SELECT id FROM i4541 WHERE k = 'event');
  v_form uuid := (SELECT id FROM i4541 WHERE k = 'form');
  v_version uuid := (SELECT id FROM i4541 WHERE k = 'version');
  v_scanner uuid := (SELECT id FROM i4541 WHERE k = 'scanner');
  v_inviter uuid := (SELECT id FROM i4541 WHERE k = 'valid');
  v_rsvp uuid := (SELECT id FROM i4541 WHERE k = 'valid_rsvp');
  v_guest_user uuid := (SELECT id FROM i4541 WHERE k = 'guest');
  v_unclaimed_user uuid := (SELECT id FROM i4541 WHERE k = 'unclaimed_user');
  v_ask_user uuid := (SELECT id FROM i4541 WHERE k = 'ask_user');
  v_guest uuid := '45410000-0000-4000-8000-000000000021';
  v_unclaimed uuid := '45410000-0000-4000-8000-000000000022';
  v_ask uuid := '45410000-0000-4000-8000-000000000023';
  v_result jsonb; v_pending jsonb; v_mine jsonb; v_line jsonb; v_full jsonb; v_error text;
BEGIN
  INSERT INTO public.event_rsvp_guests(id, rsvp_id, name, email, phone, matched_user_id,
    invited_by_user_id, claimed_at)
  VALUES
    (v_guest, v_rsvp, 'Claimed Guest', 'i4541-guest@example.test', '+15554541017',
      v_guest_user, v_inviter, now()),
    (v_unclaimed, v_rsvp, 'Matched Only', 'i4541-unclaimed@example.test', '+15554541018',
      v_unclaimed_user, v_inviter, NULL),
    (v_ask, v_rsvp, 'Ask Guest', 'i4541-ask@example.test', '+15554541019',
      v_ask_user, v_inviter, now());

  v_result := public.brand_form_submit_core(jsonb_build_object(
    'formId', v_form, 'versionId', v_version, 'eventId', v_event, 'source', 'pass',
    'credential', jsonb_build_object('kind', 'user', 'userId', v_guest_user,
      'rsvpGuestId', v_guest),
    'answers', jsonb_build_object('45410000-0000-4000-8000-000000000101', 'Vegan')));
  PERFORM pg_temp.ok((v_result->>'responseId')::uuid IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.brand_form_responses r
      WHERE r.id = (v_result->>'responseId')::uuid AND r.rsvp_guest_id = v_guest
        AND r.rsvp_id IS NULL AND r.answers->>'45410000-0000-4000-8000-000000000101' = 'Vegan')
    AND EXISTS (SELECT 1 FROM public.brand_form_responses r WHERE r.rsvp_id = v_rsvp
        AND r.answers->>'45410000-0000-4000-8000-000000000101' = 'Gluten-free'),
    'T-GUEST claimed plus-one owns a separate response and leaves inviter unchanged');

  v_error := pg_temp.err(format($sql$SELECT public.brand_form_submit_core(%L::jsonb)$sql$,
    jsonb_build_object('formId', v_form, 'versionId', v_version, 'eventId', v_event, 'source', 'pass',
      'credential', jsonb_build_object('kind', 'user', 'userId', v_unclaimed_user,
        'rsvpGuestId', v_unclaimed),
      'answers', jsonb_build_object('45410000-0000-4000-8000-000000000101', 'No dairy'))::text));
  PERFORM pg_temp.ok(v_error LIKE '42501:not_holder%'
    AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses WHERE rsvp_guest_id = v_unclaimed),
    'T-GUEST matched-only plus-one cannot submit: ' || v_error);

  PERFORM pg_temp.as_user(v_guest_user);
  v_pending := public.brand_forms_my_pending();
  v_mine := public.brand_form_my_response(v_form, v_event, NULL, NULL);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v_pending) p
      WHERE p->'subject'->>'kind' = 'rsvp_guest'
        AND (p->'subject'->>'id')::uuid = v_guest AND (p->>'answered')::boolean)
    AND v_mine->>'state' = 'answered'
    AND v_mine->'response'->'answers'->>'45410000-0000-4000-8000-000000000101' = 'Vegan',
    'T-GUEST pending and my-response resolve the claimed pass, never the inviter');
  PERFORM pg_temp.as_user(NULL);

  v_result := public.brand_form_request_enqueue(v_owner, v_form, v_event, 'ask', 'everyone',
    jsonb_build_array(jsonb_build_object('kind', 'rsvp_guest', 'id', v_ask)), ARRAY['email']);
  PERFORM pg_temp.ok((v_result->>'queued')::integer = 1
    AND EXISTS (SELECT 1 FROM public.brand_form_request_sends s
      WHERE s.form_id = v_form AND s.rsvp_guest_id = v_ask
        AND s.rsvp_id IS NULL AND s.order_id IS NULL AND s.status = 'queued'),
    'T-REQUEST Ask queues only the exact claimed rsvp_guest subject');

  v_line := public.brand_form_door_answers(v_scanner, v_event,
    jsonb_build_object('kind', 'rsvp_guest', 'id', v_guest));
  v_full := public.brand_form_door_full_answers(v_scanner, v_event,
    jsonb_build_object('kind', 'rsvp_guest', 'id', v_guest), 'scan');
  PERFORM pg_temp.ok(v_line->>'state' = 'answered'
    AND v_line->'items'->0->>'value' = 'Vegan'
    AND v_full->>'state' = 'answered'
    AND v_full->'answers'->>'45410000-0000-4000-8000-000000000101' = 'Vegan',
    'T-DOOR line and full reads show the claimed guest answer');
  v_error := pg_temp.err(format($sql$SELECT public.brand_form_door_answers(%L,%L,%L::jsonb)$sql$,
    v_scanner, v_event, jsonb_build_object('kind', 'rsvp_guest', 'id', v_unclaimed)::text));
  PERFORM pg_temp.ok(v_error LIKE '42501:subject_other_event%',
    'T-DOOR unclaimed matched row is not a door subject: ' || v_error);

  -- T-UNANSWERED-GUEST: the claimed but unanswered plus-one (v_ask) never
  -- inherits the inviter's "Gluten-free" answer on any read.
  PERFORM pg_temp.as_user(v_ask_user);
  v_pending := public.brand_forms_my_pending();
  PERFORM pg_temp.as_user(NULL);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v_pending) p
      WHERE p->'subject'->>'kind' = 'rsvp_guest' AND (p->'subject'->>'id')::uuid = v_ask
        AND NOT (p->>'answered')::boolean AND p->>'responseId' IS NULL)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_pending) p
      WHERE (p->'subject'->>'id')::uuid = v_ask AND (p->>'answered')::boolean),
    'T-UNANSWERED-GUEST my_pending shows answered=false on the exact rsvp_guest subject');
  v_line := public.brand_form_door_answers(v_scanner, v_event,
    jsonb_build_object('kind', 'rsvp_guest', 'id', v_ask));
  v_full := public.brand_form_door_full_answers(v_scanner, v_event,
    jsonb_build_object('kind', 'rsvp_guest', 'id', v_ask), 'scan');
  PERFORM pg_temp.ok(v_line->>'state' = 'not_answered'
    AND v_full->>'state' = 'not_answered'
    AND strpos(v_line::text, 'Gluten-free') = 0 AND strpos(v_full::text, 'Gluten-free') = 0,
    'T-UNANSWERED-GUEST door line/full never return the inviter answer: '
      || COALESCE(v_line::text, 'null') || ' / ' || COALESCE(v_full::text, 'null'));
  -- Going at this event so far: valid (answered), old (unanswered), claimed
  -- guest (answered), ask guest (unanswered). Decline is not going.
  PERFORM pg_temp.ok(public.brand_form_unanswered_count(v_form, v_event) = 2,
    'T-UNANSWERED-GUEST unanswered count includes the claimed plus-one: '
      || public.brand_form_unanswered_count(v_form, v_event));
END;
$test$;

-- T-HOLDER: what the Host responses read returns for an rsvp_guest answer.
-- holder is built only for user-kind responses; an rsvp_guest row (and an
-- rsvp row) carries holder = JSON null, never the inviter's rsvp id.
DO $test$
DECLARE
  v_owner uuid := (SELECT id FROM i4541 WHERE k = 'owner');
  v_event uuid := (SELECT id FROM i4541 WHERE k = 'event');
  v_form uuid := (SELECT id FROM i4541 WHERE k = 'form');
  v_rsvp uuid := (SELECT id FROM i4541 WHERE k = 'valid_rsvp');
  v_guest uuid := '45410000-0000-4000-8000-000000000021';
  v_read jsonb; v_row jsonb;
BEGIN
  PERFORM pg_temp.as_user(v_owner);
  v_read := public.biz_brand_form_responses(v_form, v_event);
  PERFORM pg_temp.as_user(NULL);
  SELECT x INTO v_row FROM jsonb_array_elements(v_read->'rows') x
   WHERE x->'subject'->>'kind' = 'rsvp_guest' AND (x->'subject'->>'id')::uuid = v_guest;
  RAISE NOTICE 'T-HOLDER rsvp_guest row subject=% holder=%', v_row->'subject', v_row->'holder';
  PERFORM pg_temp.ok(v_row IS NOT NULL
    AND v_row->'subject' = jsonb_build_object('kind', 'rsvp_guest', 'id', v_guest)
    AND v_row ? 'holder' AND jsonb_typeof(v_row->'holder') = 'null'
    AND strpos(v_row::text, v_rsvp::text) = 0
    AND v_row->'answers'->>'45410000-0000-4000-8000-000000000101' = 'Vegan',
    'T-HOLDER rsvp_guest response has holder null and never names the inviter rsvp id');
END;
$test$;

-- Extra fixture: event B (same brand, same form, optional) and fresh callers.
DO $fixture$
DECLARE
  v_owner uuid := (SELECT id FROM i4541 WHERE k = 'owner');
  v_brand uuid := (SELECT id FROM i4541 WHERE k = 'brand');
  v_form uuid := (SELECT id FROM i4541 WHERE k = 'form');
  v_event_b uuid := '45410000-0000-4000-8000-000000000031';
  v_att_b uuid := '45410000-0000-4000-8000-000000000032';
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    ('45410000-0000-4000-8000-000000000041', 'i4541-opt-shape@example.test'),
    ('45410000-0000-4000-8000-000000000042', 'i4541-opt-stale@example.test'),
    ('45410000-0000-4000-8000-000000000043', 'i4541-opt-invalid@example.test'),
    ('45410000-0000-4000-8000-000000000044', 'i4541-req-invalid@example.test'),
    ('45410000-0000-4000-8000-000000000045', 'i4541-req-shape@example.test'),
    ('45410000-0000-4000-8000-000000000046', 'i4541-kill@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, rsvp_guests_can_bring, published_at)
  VALUES (v_event_b, v_brand, v_owner, 'Issue 4541 Second Night', 'issue-4541-second-night', 'rsvp',
    'scheduled', 'public', 'America/New_York', 'USD', NULL, false, 'auto', true, 4, true, now());
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event_b, now() + interval '6 days', now() + interval '6 days 4 hours',
    'America/New_York', true);
  INSERT INTO public.brand_form_attachments(id, form_id, brand_id, event_id, mode, created_by)
  VALUES (v_att_b, v_form, v_brand, v_event_b, 'optional_on_page', v_owner);
  INSERT INTO i4541 VALUES ('event_b', v_event_b), ('att_b', v_att_b),
    ('opt_shape', '45410000-0000-4000-8000-000000000041'),
    ('opt_stale', '45410000-0000-4000-8000-000000000042'),
    ('opt_invalid', '45410000-0000-4000-8000-000000000043'),
    ('req_invalid', '45410000-0000-4000-8000-000000000044'),
    ('req_shape', '45410000-0000-4000-8000-000000000045'),
    ('kill', '45410000-0000-4000-8000-000000000046');
END;
$fixture$;

-- T-NO-MOVE: a claimed plus-one's answer at event A is never moved when the
-- same person RSVPs at event B with answers; B gets its own exact-RSVP row.
DO $test$
DECLARE
  v_owner uuid := (SELECT id FROM i4541 WHERE k = 'owner');
  v_event uuid := (SELECT id FROM i4541 WHERE k = 'event');
  v_event_b uuid := (SELECT id FROM i4541 WHERE k = 'event_b');
  v_att uuid := (SELECT id FROM i4541 WHERE k = 'attachment');
  v_att_b uuid := (SELECT id FROM i4541 WHERE k = 'att_b');
  v_form uuid := (SELECT id FROM i4541 WHERE k = 'form');
  v_version uuid := (SELECT id FROM i4541 WHERE k = 'version');
  v_guest_user uuid := (SELECT id FROM i4541 WHERE k = 'guest');
  v_guest uuid := '45410000-0000-4000-8000-000000000021';
  v_before record; v_after record; v_result jsonb; v_rsvp_b uuid; v_read jsonb;
BEGIN
  SELECT id, event_id, attachment_id, answers, edit_count, rsvp_guest_id, rsvp_id
    INTO v_before FROM public.brand_form_responses WHERE form_id = v_form AND rsvp_guest_id = v_guest;
  PERFORM pg_temp.ok(v_before.id IS NOT NULL AND v_before.event_id = v_event,
    'T-NO-MOVE precondition: plus-one answer lives at event A');

  v_result := public.submit_event_rsvp_with_form(v_event_b, v_guest_user, 'Claimed Guest',
    'i4541-guest@example.test', '+15554541017', 'going', 0, '[]', NULL, 'US', true,
    jsonb_build_object('formId', v_form, 'versionId', v_version,
      'answers', jsonb_build_object('45410000-0000-4000-8000-000000000101', 'Halal')));
  v_rsvp_b := (v_result->>'rsvpId')::uuid;

  SELECT id, event_id, attachment_id, answers, edit_count, rsvp_guest_id, rsvp_id
    INTO v_after FROM public.brand_form_responses WHERE id = v_before.id;
  PERFORM pg_temp.ok(v_after.event_id = v_event AND v_after.attachment_id = v_att
    AND v_after.answers = v_before.answers AND v_after.edit_count = v_before.edit_count
    AND v_after.rsvp_guest_id = v_guest AND v_after.rsvp_id IS NULL,
    'T-NO-MOVE event A plus-one answer row is unchanged (event, attachment, answers, edits)');
  PERFORM pg_temp.ok(v_rsvp_b IS NOT NULL
    AND (v_result->>'brandFormResponseId')::uuid IS DISTINCT FROM v_before.id
    AND EXISTS (SELECT 1 FROM public.brand_form_responses r
      WHERE r.id = (v_result->>'brandFormResponseId')::uuid AND r.rsvp_id = v_rsvp_b
        AND r.event_id = v_event_b AND r.attachment_id = v_att_b AND r.source = 'signup'
        AND r.answers->>'45410000-0000-4000-8000-000000000101' = 'Halal'),
    'T-NO-MOVE event B has its own response tied to the new RSVP id');

  PERFORM pg_temp.as_user(v_owner);
  v_read := public.biz_brand_form_responses(v_form, v_event);
  PERFORM pg_temp.as_user(NULL);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v_read->'rows') x
      WHERE (x->>'responseId')::uuid = v_before.id
        AND x->'answers'->>'45410000-0000-4000-8000-000000000101' = 'Vegan'),
    'T-NO-MOVE event A host responses read still lists the plus-one answer');
END;
$test$;

-- T-OPTIONAL-FAIL-OPEN: optional form + malformed, stale or invalid answers
-- from a capable client saves the RSVP with no response and no error.
DO $test$
DECLARE
  v_event_b uuid := (SELECT id FROM i4541 WHERE k = 'event_b');
  v_form uuid := (SELECT id FROM i4541 WHERE k = 'form');
  v_version uuid := (SELECT id FROM i4541 WHERE k = 'version');
  v_case record; v_result jsonb;
BEGIN
  FOR v_case IN
    SELECT u.id AS user_id, u.k, u.payload FROM (VALUES
      ((SELECT id FROM i4541 WHERE k = 'opt_shape'), 'malformed shape',
        jsonb_build_object('formId', 'not-a-uuid', 'answers', '[]'::jsonb)),
      ((SELECT id FROM i4541 WHERE k = 'opt_stale'), 'stale version',
        jsonb_build_object('formId', v_form, 'versionId', gen_random_uuid(),
          'answers', jsonb_build_object('45410000-0000-4000-8000-000000000101', 'Raw'))),
      ((SELECT id FROM i4541 WHERE k = 'opt_invalid'), 'invalid answers',
        jsonb_build_object('formId', v_form, 'versionId', v_version, 'answers', '{}'::jsonb))
    ) AS u(id, k, payload)
  LOOP
    v_result := public.submit_event_rsvp_with_form(v_event_b, v_case.user_id, 'Optional Guest',
      NULL, NULL, 'going', 0, '[]', NULL, NULL, true, v_case.payload);
    PERFORM pg_temp.ok((v_result->>'rsvpId')::uuid IS NOT NULL
      AND NOT v_result ? 'brandFormResponseId'
      AND EXISTS (SELECT 1 FROM public.event_rsvps x
        WHERE x.id = (v_result->>'rsvpId')::uuid AND x.event_id = v_event_b AND x.rsvp_status = 'going')
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses r
        WHERE r.form_id = v_form AND r.rsvp_id = (v_result->>'rsvpId')::uuid),
      'T-OPTIONAL-FAIL-OPEN ' || v_case.k || ' saves the RSVP with no response');
  END LOOP;
END;
$test$;

-- T-REQUIRED-INVALID: required form + malformed or invalid answers raises
-- form_answers_invalid and writes no RSVP.
DO $test$
DECLARE
  v_event uuid := (SELECT id FROM i4541 WHERE k = 'event');
  v_form uuid := (SELECT id FROM i4541 WHERE k = 'form');
  v_version uuid := (SELECT id FROM i4541 WHERE k = 'version');
  v_req_invalid uuid := (SELECT id FROM i4541 WHERE k = 'req_invalid');
  v_req_shape uuid := (SELECT id FROM i4541 WHERE k = 'req_shape');
  v_error text;
BEGIN
  v_error := pg_temp.err(format($sql$SELECT public.submit_event_rsvp_with_form(
    %L,%L,'Required Invalid',NULL,NULL,'going',0,'[]',NULL,NULL,true,%L::jsonb)$sql$,
    v_event, v_req_invalid,
    jsonb_build_object('formId', v_form, 'versionId', v_version, 'answers', '{}'::jsonb)::text));
  PERFORM pg_temp.ok(v_error LIKE '22023:form_answers_invalid%'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = v_event AND user_id = v_req_invalid),
    'T-REQUIRED-INVALID invalid answers write no RSVP: ' || v_error);
  v_error := pg_temp.err(format($sql$SELECT public.submit_event_rsvp_with_form(
    %L,%L,'Required Shape',NULL,NULL,'going',0,'[]',NULL,NULL,true,%L::jsonb)$sql$,
    v_event, v_req_shape,
    jsonb_build_object('formId', v_form, 'versionId', v_version, 'answers', '[]'::jsonb,
      'extra', true)::text));
  PERFORM pg_temp.ok(v_error LIKE '22023:form_answers_invalid%'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = v_event AND user_id = v_req_shape),
    'T-REQUIRED-INVALID malformed shape writes no RSVP: ' || v_error);
END;
$test$;

-- T-KILL-SWITCH: with the emergency off switch on, a required form with no
-- answers still saves the RSVP and writes no response.
DO $test$
DECLARE
  v_event uuid := (SELECT id FROM i4541 WHERE k = 'event');
  v_form uuid := (SELECT id FROM i4541 WHERE k = 'form');
  v_kill uuid := (SELECT id FROM i4541 WHERE k = 'kill');
  v_result jsonb;
BEGIN
  INSERT INTO public.feature_flags(flag_key, is_enabled) VALUES ('BRAND_FORMS_KILL_SWITCH', true)
  ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;
  v_result := public.submit_event_rsvp_with_form(v_event, v_kill, 'Kill Switch Guest',
    NULL, NULL, 'going', 0, '[]', NULL, NULL, true, NULL);
  PERFORM pg_temp.ok((v_result->>'rsvpId')::uuid IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.event_rsvps x
      WHERE x.id = (v_result->>'rsvpId')::uuid AND x.user_id = v_kill AND x.rsvp_status = 'going')
    AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses r
      WHERE r.form_id = v_form AND r.rsvp_id = (v_result->>'rsvpId')::uuid),
    'T-KILL-SWITCH required form with no answers still saves the RSVP');
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'BRAND_FORMS_KILL_SWITCH';
END;
$test$;

-- Extra fixture: event C (required form: Diet required + Notes optional) and
-- event D (optional form: both questions optional), plus two fresh callers.
DO $fixture$
DECLARE
  v_owner uuid := (SELECT id FROM i4541 WHERE k = 'owner');
  v_brand uuid := (SELECT id FROM i4541 WHERE k = 'brand');
  v_event_c uuid := '45410000-0000-4000-8000-000000000061';
  v_event_d uuid := '45410000-0000-4000-8000-000000000062';
  v_form_c uuid := '45410000-0000-4000-8000-000000000063';
  v_form_d uuid := '45410000-0000-4000-8000-000000000064';
  v_ver_c uuid := '45410000-0000-4000-8000-000000000065';
  v_ver_d uuid := '45410000-0000-4000-8000-000000000066';
  v_wipe uuid := '45410000-0000-4000-8000-000000000067';
  v_dup uuid := '45410000-0000-4000-8000-000000000068';
  v_def_c jsonb := '{"schema":"mingla.brand_form.v1","title":"Night C","intro":"Two questions","questions":[{"id":"45410000-0000-4000-8000-000000000201","position":0,"type":"short_text","label":"Dietary needs","required":true,"show_at_door":true,"door_label":"Diet"},{"id":"45410000-0000-4000-8000-000000000202","position":1,"type":"short_text","label":"Seating notes","required":false,"show_at_door":false}]}'::jsonb;
  v_def_d jsonb := '{"schema":"mingla.brand_form.v1","title":"Night D","intro":"Optional questions","questions":[{"id":"45410000-0000-4000-8000-000000000301","position":0,"type":"short_text","label":"Dietary needs","required":false,"show_at_door":true,"door_label":"Diet"},{"id":"45410000-0000-4000-8000-000000000302","position":1,"type":"short_text","label":"Seating notes","required":false,"show_at_door":false}]}'::jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_wipe, 'i4541-nowipe@example.test'), (v_dup, 'i4541-nodup@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, rsvp_guests_can_bring, published_at)
  VALUES
    (v_event_c, v_brand, v_owner, 'Issue 4541 Third Night', 'issue-4541-third-night', 'rsvp',
      'scheduled', 'public', 'America/New_York', 'USD', NULL, false, 'auto', true, 4, true, now()),
    (v_event_d, v_brand, v_owner, 'Issue 4541 Fourth Night', 'issue-4541-fourth-night', 'rsvp',
      'scheduled', 'public', 'America/New_York', 'USD', NULL, false, 'auto', true, 4, true, now());
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_event_c, now() + interval '7 days', now() + interval '7 days 4 hours', 'America/New_York', true),
    (v_event_d, now() + interval '8 days', now() + interval '8 days 4 hours', 'America/New_York', true);
  INSERT INTO public.brand_forms(id, brand_id, name, status, draft, created_by, updated_by) VALUES
    (v_form_c, v_brand, 'Night C questions', 'draft', v_def_c, v_owner, v_owner),
    (v_form_d, v_brand, 'Night D questions', 'draft', v_def_d, v_owner, v_owner);
  INSERT INTO public.brand_form_versions(id, form_id, version, definition, definition_sha256, published_by) VALUES
    (v_ver_c, v_form_c, 1, v_def_c, encode(digest(v_def_c::text, 'sha256'), 'hex'), v_owner),
    (v_ver_d, v_form_d, 1, v_def_d, encode(digest(v_def_d::text, 'sha256'), 'hex'), v_owner);
  UPDATE public.brand_forms SET status = 'live', live_version_id = v_ver_c WHERE id = v_form_c;
  UPDATE public.brand_forms SET status = 'live', live_version_id = v_ver_d WHERE id = v_form_d;
  INSERT INTO public.brand_form_attachments(form_id, brand_id, event_id, mode, created_by) VALUES
    (v_form_c, v_brand, v_event_c, 'required_step', v_owner),
    (v_form_d, v_brand, v_event_d, 'optional_on_page', v_owner);
  INSERT INTO i4541 VALUES ('event_c', v_event_c), ('event_d', v_event_d),
    ('form_c', v_form_c), ('form_d', v_form_d), ('ver_c', v_ver_c), ('ver_d', v_ver_d),
    ('nowipe', v_wipe), ('nodup', v_dup);
END;
$fixture$;

-- T-NO-WIPE: a re-RSVP (Going -> Maybe) with {} on an all-optional form, or with
-- only the required answer, never rewrites the stored answer row.
DO $test$
DECLARE
  v_event_c uuid := (SELECT id FROM i4541 WHERE k = 'event_c');
  v_event_d uuid := (SELECT id FROM i4541 WHERE k = 'event_d');
  v_form_c uuid := (SELECT id FROM i4541 WHERE k = 'form_c');
  v_form_d uuid := (SELECT id FROM i4541 WHERE k = 'form_d');
  v_ver_c uuid := (SELECT id FROM i4541 WHERE k = 'ver_c');
  v_ver_d uuid := (SELECT id FROM i4541 WHERE k = 'ver_d');
  v_user uuid := (SELECT id FROM i4541 WHERE k = 'nowipe');
  v_case record; v_result jsonb; v_rsvp uuid; v_before record; v_after record;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('empty answers on an all-optional form', v_event_d, v_form_d, v_ver_d,
        jsonb_build_object('45410000-0000-4000-8000-000000000301', 'Vegan',
          '45410000-0000-4000-8000-000000000302', 'Window seat'),
        '{}'::jsonb),
      ('only the required answer', v_event_c, v_form_c, v_ver_c,
        jsonb_build_object('45410000-0000-4000-8000-000000000201', 'Vegan',
          '45410000-0000-4000-8000-000000000202', 'Window seat'),
        jsonb_build_object('45410000-0000-4000-8000-000000000201', 'Vegan'))
    ) AS c(label, event_id, form_id, version_id, first_answers, second_answers)
  LOOP
    v_result := public.submit_event_rsvp_with_form(v_case.event_id, v_user, 'No Wipe Guest',
      'i4541-nowipe@example.test', '+15554541067', 'going', 0, '[]', NULL, 'US', true,
      jsonb_build_object('formId', v_case.form_id, 'versionId', v_case.version_id,
        'answers', v_case.first_answers));
    v_rsvp := (v_result->>'rsvpId')::uuid;
    SELECT id, answers, edit_count, version_id, updated_at INTO v_before
      FROM public.brand_form_responses WHERE form_id = v_case.form_id AND rsvp_id = v_rsvp;
    PERFORM pg_temp.ok(v_before.id IS NOT NULL
      AND (v_result->>'brandFormResponseId')::uuid = v_before.id
      AND v_before.answers = v_case.first_answers,
      'T-NO-WIPE precondition (' || v_case.label || '): first RSVP stores both answers: '
        || COALESCE(v_before.answers::text, 'null'));

    v_result := public.submit_event_rsvp_with_form(v_case.event_id, v_user, 'No Wipe Guest',
      'i4541-nowipe@example.test', '+15554541067', 'maybe', 0, '[]', NULL, 'US', true,
      jsonb_build_object('formId', v_case.form_id, 'versionId', v_case.version_id,
        'answers', v_case.second_answers));
    SELECT id, answers, edit_count, version_id, updated_at INTO v_after
      FROM public.brand_form_responses WHERE id = v_before.id;
    PERFORM pg_temp.ok((v_result->>'rsvpId')::uuid = v_rsvp
      AND EXISTS (SELECT 1 FROM public.event_rsvps x WHERE x.id = v_rsvp AND x.rsvp_status = 'maybe')
      AND v_after.answers = v_before.answers AND v_after.edit_count = v_before.edit_count
      AND v_after.updated_at = v_before.updated_at
      AND (SELECT count(*) FROM public.brand_form_responses r
            WHERE r.form_id = v_case.form_id AND r.rsvp_id = v_rsvp) = 1,
      'T-NO-WIPE Maybe with ' || v_case.label || ' keeps id, answers and edit_count: '
        || COALESCE(v_after.answers::text, 'null') || ' edits=' || COALESCE(v_after.edit_count, -1));
  END LOOP;
END;
$test$;

-- T-NO-DUP: a signed-in person whose account-level answer already counts for
-- this event RSVPs with answers: no second row, the original is untouched and
-- the host responses read lists them once.
DO $test$
DECLARE
  v_owner uuid := (SELECT id FROM i4541 WHERE k = 'owner');
  v_brand uuid := (SELECT id FROM i4541 WHERE k = 'brand');
  v_event_c uuid := (SELECT id FROM i4541 WHERE k = 'event_c');
  v_form_c uuid := (SELECT id FROM i4541 WHERE k = 'form_c');
  v_ver_c uuid := (SELECT id FROM i4541 WHERE k = 'ver_c');
  v_user uuid := (SELECT id FROM i4541 WHERE k = 'nodup');
  v_att uuid := (SELECT a.id FROM public.brand_form_attachments a
                  WHERE a.event_id = (SELECT id FROM i4541 WHERE k = 'event_c') AND a.detached_at IS NULL);
  v_orig uuid; v_before record; v_after record; v_result jsonb; v_rsvp uuid; v_read jsonb;
BEGIN
  INSERT INTO public.brand_form_responses (form_id, version_id, brand_id, attachment_id, event_id,
    user_id, answers, source, verified, via_link)
  VALUES (v_form_c, v_ver_c, v_brand, v_att, v_event_c, v_user,
    jsonb_build_object('45410000-0000-4000-8000-000000000201', 'Pescatarian',
      '45410000-0000-4000-8000-000000000202', 'Near the stage'), 'link', true, true)
  RETURNING id INTO v_orig;
  SELECT id, answers, edit_count, updated_at, user_id INTO v_before
    FROM public.brand_form_responses WHERE id = v_orig;

  v_result := public.submit_event_rsvp_with_form(v_event_c, v_user, 'No Dup Guest',
    'i4541-nodup@example.test', '+15554541068', 'going', 0, '[]', NULL, 'US', true,
    jsonb_build_object('formId', v_form_c, 'versionId', v_ver_c,
      'answers', jsonb_build_object('45410000-0000-4000-8000-000000000201', 'Halal')));
  v_rsvp := (v_result->>'rsvpId')::uuid;
  SELECT id, answers, edit_count, updated_at, user_id INTO v_after
    FROM public.brand_form_responses WHERE id = v_orig;

  PERFORM pg_temp.ok(v_rsvp IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses r
      WHERE r.form_id = v_form_c AND r.rsvp_id = v_rsvp)
    AND (SELECT count(*) FROM public.brand_form_responses r
          WHERE r.form_id = v_form_c
            AND (r.user_id = v_user OR EXISTS (SELECT 1 FROM public.event_rsvps x
                  WHERE x.id = r.rsvp_id AND x.user_id = v_user))) = 1,
    'T-NO-DUP exactly one response for the person on this form/event');
  PERFORM pg_temp.ok(v_after.answers = v_before.answers AND v_after.edit_count = v_before.edit_count
    AND v_after.updated_at = v_before.updated_at AND v_after.user_id = v_user
    AND (v_result->>'brandFormResponseId')::uuid = v_orig,
    'T-NO-DUP the account-level answer is untouched and returned');

  PERFORM pg_temp.as_user(v_owner);
  v_read := public.biz_brand_form_responses(v_form_c, v_event_c);
  PERFORM pg_temp.as_user(NULL);
  PERFORM pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(v_read->'rows') x
      WHERE (x->'subject'->>'kind' = 'user' AND (x->'subject'->>'id')::uuid = v_user)
         OR (x->'subject'->>'kind' = 'rsvp' AND (x->'subject'->>'id')::uuid = v_rsvp)) = 1
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_read->'rows') x
      WHERE (x->>'responseId')::uuid = v_orig
        AND x->'answers'->>'45410000-0000-4000-8000-000000000201' = 'Pescatarian'),
    'T-NO-DUP host responses read for the event shows the person once');
END;
$test$;

ROLLBACK;
