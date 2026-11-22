-- MINGLA-INVARIANT: I-4541-ONE-TEXT-BUDGET | issue #4541 | form-request texts and Blast texts draw from one monthly text budget per brand, counted by Blast's own allowance functions under one lock (blast_cap), so together they never exceed it; over it, a form send goes without texts and is never refused (T-18, T-18-RACE).
-- MINGLA-INVARIANT: I-4541-BLAST-REPLY-NEVER-ON-GUEST | issue #4541 | a reply from a Blast (a known recipient by a hashed key, a signed-in person, or Unknown) is never a guest's answer, never on a page, at the door, on guest detail, in the request audience or unanswered count, or in the roster export, and a Blast submit never edits a page answer; typed answers never change who a reply belongs to (T-14, T-15, T-16, T-16b).
-- MINGLA-INVARIANT: I-4541-FORM-PUSH-APP-READY | issue #4541 | a form request is tried by push only while BRAND_FORMS_PUSH is on and the person's app reported in the last 45 days that it opens the form, decided again at claim (T-19).
-- #4541 M-B (20281122014541_issue_4541_forms_blast_push.sql): PostgreSQL 17 proof after the full replay.
-- Run as supabase_admin (the race sections open two dblink sessions, as issue_0871 does).
--
-- T-19  push: the switch, the capability report, eligibility at preview and again at claim (SC-26)
-- T-18  one text budget: the form counter in Blast's usage and check, texts off over the monthly
--       allowance and over the daily cap, the reason kept in the log, lock order (SC-37, SC-38)
-- T-14  Blast reply schema (one owner, never on a page, Unknown never verified)
-- T-15  Blast submit (SC-32, SC-36): Unknown, signed in, own link (hashed key, code for a second
--       answer, a newer link leaves the earlier one working), campaign window, open-reply limit;
--       confirm check, hold
-- T-16  never on a guest record or at the door (SC-33); T-16b by behaviour: the door, request
--       audience, unanswered count, guest answers, Responses and the guest's own read show a
--       guest with only Blast replies (Unknown, own link, signed in) as not answered; a Blast
--       submit never edits a page answer; a combined email + text Blast keeps both links;
--       account deletion erases Blast replies and links kept by contact key
-- T-17  Responses owner filter, hide and undo, old 5-argument call, export, counts (SC-34)
-- T-42  every client-called RPC called the way the app calls it; service-role-only functions refused
-- T-18-RACE two sessions (SC-39): a Blast confirm and a form send for one brand never both pass
--       when together they exceed the allowance, in either order, and never deadlock
--
-- FAILS-ON-REVERT: dropping the brand_form_push_eligible test from the claim fails T-19c;
-- dropping the form term from biz_assert_brand_blast_allowance_v1 fails T-18b; dropping it from
-- biz_brand_blast_usage_v1 fails T-18a; dropping the texts-off rule fails T-18c/T-18d;
-- dropping the blast_cap lock from brand_form_request_enqueue fails T-18-RACE-1; dropping the
-- campaign-window check fails T-15 SC-36; dropping the open-reply cap fails T-15 SC-36;
-- dropping name 'Unknown' fails T-17. Review fixes: restoring the 20281121004541
-- brand_form_user_response fails T-16b (request audience); restoring the user_id-only Blast
-- lookup or the single one_per_user index fails T-16b (Blast submit edits the page answer);
-- restoring the revoke in brand_form_link_issue_blast fails T-15 (newer link); dropping the
-- contact-key deletes from brand_form_erase_person fails T-16b fix 4.

CREATE EXTENSION IF NOT EXISTS dblink;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4541 M-B FAIL: %', p_label;
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

CREATE OR REPLACE FUNCTION pg_temp.u(p_tag text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5('i4541mb:' || p_tag)::uuid $fn$;

-- A time zone where it is now daytime, so texts are not held for the morning.
CREATE TEMP TABLE i4541mb_tz AS
SELECT (SELECT name FROM pg_timezone_names WHERE extract(hour FROM now() AT TIME ZONE name) BETWEEN 11 AND 18
         AND name LIKE 'Etc/GMT%' ORDER BY name LIMIT 1) AS day_tz;

-- The fixture, as a function so the committed race section can build its own brand.
CREATE OR REPLACE FUNCTION pg_temp.mb_fixture(p_k text) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  v_def jsonb := '{"schema":"mingla.brand_form.v1","title":"Guest questions","intro":"One question","questions":[{"id":"45419100-0000-4000-8000-000000000101","position":0,"type":"short_text","label":"Dietary needs","required":true}]}'::jsonb;
  v_tag text;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['owner','u1','u2','u3','u4','u5'] LOOP
    INSERT INTO auth.users(id, email) VALUES (pg_temp.u(p_k || v_tag), 'i4541mb-' || p_k || v_tag || '@example.test');
    INSERT INTO public.profiles(id, email, display_name, first_name, last_name)
    VALUES (pg_temp.u(p_k || v_tag), 'i4541mb-' || p_k || v_tag || '@example.test', initcap(v_tag) || ' Person',
            initcap(v_tag), 'Person')
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (pg_temp.u(p_k || 'brand'), pg_temp.u(p_k || 'owner'), 'Issue 4541 MB ' || p_k, 'i4541mb-' || p_k, 'USD');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (pg_temp.u(p_k || 'brand'), pg_temp.u(p_k || 'owner'), 'brand_owner', now());
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (pg_temp.u(p_k || 'e'), pg_temp.u(p_k || 'brand'), 'MB night', 'i4541mb-e-' || p_k, 'rsvp', 'scheduled', 'public',
          (SELECT day_tz FROM i4541mb_tz), 'USD');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (pg_temp.u(p_k || 'e'), now() + interval '9 days', now() + interval '9 days 4 hours', 'UTC', true);
  -- u1, u3, u4 have a phone and an email; u2 a phone only; u5 an email only.
  INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (pg_temp.u(p_k || 'r1'), pg_temp.u(p_k || 'e'), pg_temp.u(p_k || 'u1'), 'Una One', 'i4541mb-' || p_k || 'r1@example.test', '+12025558001', 'going', 'approved'),
         (pg_temp.u(p_k || 'r2'), pg_temp.u(p_k || 'e'), pg_temp.u(p_k || 'u2'), 'Ula Two', NULL, '+12025558002', 'going', 'approved'),
         (pg_temp.u(p_k || 'r3'), pg_temp.u(p_k || 'e'), pg_temp.u(p_k || 'u3'), 'Uma Three', 'i4541mb-' || p_k || 'r3@example.test', '+12025558003', 'going', 'approved'),
         (pg_temp.u(p_k || 'r4'), pg_temp.u(p_k || 'e'), pg_temp.u(p_k || 'u4'), 'Uri Four', 'i4541mb-' || p_k || 'r4@example.test', '+12025558004', 'maybe', 'approved'),
         (pg_temp.u(p_k || 'r5'), pg_temp.u(p_k || 'e'), pg_temp.u(p_k || 'u5'), 'Ugo Five', 'i4541mb-' || p_k || 'r5@example.test', NULL, 'going', 'approved');
  INSERT INTO public.brand_forms(id, brand_id, name, status, draft, created_by, updated_by)
  VALUES (pg_temp.u(p_k || 'F'), pg_temp.u(p_k || 'brand'), 'MB questions', 'draft', v_def, pg_temp.u(p_k || 'owner'), pg_temp.u(p_k || 'owner'));
  INSERT INTO public.brand_form_versions(id, form_id, version, definition, definition_sha256, published_by)
  VALUES (pg_temp.u(p_k || 'Fv'), pg_temp.u(p_k || 'F'), 1, v_def, encode(digest(v_def::text, 'sha256'), 'hex'), pg_temp.u(p_k || 'owner'));
  UPDATE public.brand_forms SET status = 'live', live_version_id = pg_temp.u(p_k || 'Fv') WHERE id = pg_temp.u(p_k || 'F');
  INSERT INTO public.brand_form_attachments(id, form_id, brand_id, event_id, mode, created_by)
  VALUES (pg_temp.u(p_k || 'a'), pg_temp.u(p_k || 'F'), pg_temp.u(p_k || 'brand'), pg_temp.u(p_k || 'e'), 'required_step', pg_temp.u(p_k || 'owner'));
  INSERT INTO public.marketing_audiences (id, account_id, brand_id, name, query_definition, is_system_generated)
  VALUES (pg_temp.u(p_k || 'aud'), pg_temp.u(p_k || 'owner'), pg_temp.u(p_k || 'brand'), 'Your Book',
          jsonb_build_object('kind', 'all_brand_people', 'brand_id', pg_temp.u(p_k || 'brand')::text), true);
  PERFORM set_config('session_replication_role', 'origin', true);
END;
$fn$;

-- A confirmed Blast text send of p_n recipients this month (what a Blast confirm writes).
CREATE OR REPLACE FUNCTION pg_temp.mb_blast_sms(p_k text, p_n integer) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_c uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.marketing_campaigns (id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (v_c, pg_temp.u(p_k || 'owner'), pg_temp.u(p_k || 'brand'), pg_temp.u(p_k || 'aud'), 'Texts', 'sms',
          '{"kind":"sms","body":"Hi"}'::jsonb, 'sent');
  INSERT INTO public.marketing_book_send_executions (
    brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash,
    content_hash, selected_count, reachable_count, suppressed_count, unavailable_count,
    sms_segment_count, estimated_cost_minor, currency, cost_kind, ratebook_ids,
    source_references, quoted_at, scheduled_for, send_mode)
  VALUES (pg_temp.u(p_k || 'brand'), v_c, pg_temp.u(p_k || 'owner'), gen_random_uuid(), 1, repeat('a', 64), repeat('b', 64),
          p_n, p_n, 0, 0, p_n, NULL, NULL, 'not_metered', '[]'::jsonb, '[]'::jsonb, now(), now(), 'now');
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.subj(p_k text, VARIADIC p_tags text[]) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_agg(jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u(p_k || t))) FROM unnest(p_tags) t
$fn$;

BEGIN;

SELECT pg_temp.mb_fixture('x');

-- ═══ T-19 push: switch, capability, eligibility (SC-26) ═══════════════════════════
DO $t$
DECLARE v jsonb; v_r text; v_send uuid;
BEGIN
  -- The app's report, as the signed-in user; refused for anon and other apps.
  PERFORM pg_temp.as_user(pg_temp.u('xu1'));
  SET LOCAL ROLE authenticated;
  PERFORM public.brand_form_report_capability('explorer', 'ios', '1.4.0', 1);
  v_r := pg_temp.err($$SELECT public.brand_form_report_capability('business', 'ios', '1.4.0', 1)$$);
  RESET ROLE;
  PERFORM pg_temp.ok(v_r LIKE '22023:app_invalid%', 'T-19 only the Explorer app reports (' || v_r || ')');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.brand_form_push_capable
                              WHERE user_id = pg_temp.u('xu1') AND app_version = '1.4.0' AND screen_version = 1),
    'T-19 the capability report is stored for the caller');
  PERFORM pg_temp.as_user(NULL);
  SET LOCAL ROLE anon;
  v_r := pg_temp.err($$SELECT public.brand_form_report_capability('explorer', 'ios', '1.4.0', 1)$$);
  RESET ROLE;
  PERFORM pg_temp.ok(v_r LIKE '42501%', 'T-19 anon cannot report (' || v_r || ')');
  INSERT INTO public.brand_form_push_capable (user_id, platform, app_version, screen_version, last_seen_at)
  VALUES (pg_temp.u('xu3'), 'android', '1.4.0', 1, now() - interval '50 days'),
         (pg_temp.u('xu4'), 'ios', '1.4.0', 1, now());

  -- Off by default: push is silently removed.
  PERFORM pg_temp.ok(NOT (public.brand_form_push_settings()->>'push')::boolean
      AND (public.brand_form_push_settings()->>'emailAlongside')::boolean,
    'T-19 BRAND_FORMS_PUSH ships off, email alongside on');
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_audience(pg_temp.u('xowner'), pg_temp.u('xF'), pg_temp.u('xe'), 'everyone', NULL, ARRAY['push', 'email']);
  RESET ROLE;
  PERFORM pg_temp.ok(NOT (v->>'pushAvailable')::boolean
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'recipients') r WHERE (r->>'pushOk')::boolean),
    'T-19 SC-26 switched off: nobody is pushed');

  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'BRAND_FORMS_PUSH';
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_audience(pg_temp.u('xowner'), pg_temp.u('xF'), pg_temp.u('xe'), 'everyone', NULL, ARRAY['push', 'email']);
  RESET ROLE;
  PERFORM pg_temp.ok((v->>'pushAvailable')::boolean
      AND (SELECT array_agg(r->>'id' ORDER BY r->>'id') FROM jsonb_array_elements(v->'recipients') r WHERE (r->>'pushOk')::boolean)
          = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.u('xr1')::text, pg_temp.u('xr4')::text]) x),
    'T-19a SC-26 switched on: only people whose app can open the form (seen in 45 days) are pushed');

  -- Queue: u1 by push (+email), u2 phone only with email ticked: nobody to reach.
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(pg_temp.u('xowner'), pg_temp.u('xF'), pg_temp.u('xe'), 'ask', 'everyone',
         pg_temp.subj('x', 'r1', 'r2'), ARRAY['push', 'email']);
  RESET ROLE;
  PERFORM pg_temp.ok((v->>'queued')::integer = 1 AND (v->>'unreachable')::integer = 1
      AND (SELECT try_push AND route = ARRAY['email'] FROM public.brand_form_request_sends WHERE rsvp_id = pg_temp.u('xr1'))
      AND (SELECT status = 'unreachable' FROM public.brand_form_request_sends WHERE rsvp_id = pg_temp.u('xr2')),
    'T-19b the queue keeps push as a flag beside the contact route (' || v::text || ')');
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_claim_batch(100, pg_temp.u('xF'), pg_temp.u('xe'));
  RESET ROLE;
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v) x
                              WHERE (x->>'subjectId')::uuid = pg_temp.u('xr1')
                                AND x->'route' = '["push","email"]'::jsonb AND (x->>'userId')::uuid = pg_temp.u('xu1')),
    'T-19b the claim puts push first for an app-ready person (' || v::text || ')');

  -- Push only for u4, then u4's app goes quiet before the claim: decided again.
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(pg_temp.u('xowner'), pg_temp.u('xF'), pg_temp.u('xe'), 'ask', 'everyone',
         pg_temp.subj('x', 'r4'), ARRAY['push']);
  RESET ROLE;
  SELECT id INTO v_send FROM public.brand_form_request_sends WHERE rsvp_id = pg_temp.u('xr4');
  PERFORM pg_temp.ok((SELECT status = 'queued' AND try_push AND route = '{}'::text[] FROM public.brand_form_request_sends WHERE id = v_send),
    'T-19c a push-only request is queued for an app-ready person');
  UPDATE public.brand_form_push_capable SET last_seen_at = now() - interval '46 days' WHERE user_id = pg_temp.u('xu4');
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_claim_batch(100, pg_temp.u('xF'), pg_temp.u('xe'));
  RESET ROLE;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE (x->>'sendId')::uuid = v_send)
      AND (SELECT status = 'unreachable' AND safe_reason = 'push_not_ready' FROM public.brand_form_request_sends WHERE id = v_send),
    'T-19c SC-26 eligibility is decided again at claim: no push for an app not seen in 45 days');
  -- Switched off again: the claim never pushes.
  UPDATE public.brand_form_push_capable SET last_seen_at = now() WHERE user_id = pg_temp.u('xu4');
  UPDATE public.brand_form_request_sends SET status = 'queued', safe_reason = NULL, settled_at = NULL WHERE id = v_send;
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'BRAND_FORMS_PUSH';
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_claim_batch(100, pg_temp.u('xF'), pg_temp.u('xe'));
  RESET ROLE;
  PERFORM pg_temp.ok((SELECT status = 'unreachable' FROM public.brand_form_request_sends WHERE id = v_send),
    'T-19c with the switch off the claim never pushes');
  DELETE FROM public.brand_form_request_sends WHERE form_id = pg_temp.u('xF');
END;
$t$;

-- ═══ T-18 one text budget (SC-37, SC-38) ══════════════════════════════════════════
DO $t$
DECLARE v jsonb; v_r text; v_src text; v_send uuid;
BEGIN
  INSERT INTO public.brand_messaging_limits (brand_id, email_monthly, sms_monthly, reason)
  VALUES (pg_temp.u('xbrand'), 1000, 6, 'i4541mb');
  -- Two form texts this month count; a push, a failure and last month's do not.
  INSERT INTO public.brand_form_request_sends (form_id, event_id, brand_id, rsvp_id, person_key, kind, route, status, channel, created_at)
  VALUES (pg_temp.u('xF'), pg_temp.u('xe'), pg_temp.u('xbrand'), pg_temp.u('xr1'), 'p:t1', 'ask', ARRAY['sms'], 'sent', 'sms', now()),
         (pg_temp.u('xF'), pg_temp.u('xe'), pg_temp.u('xbrand'), pg_temp.u('xr1'), 'p:t2', 'ask', ARRAY['sms', 'email'], 'queued', NULL, now()),
         (pg_temp.u('xF'), pg_temp.u('xe'), pg_temp.u('xbrand'), pg_temp.u('xr1'), 'p:t3', 'ask', ARRAY['sms'], 'sent', 'push', now()),
         (pg_temp.u('xF'), pg_temp.u('xe'), pg_temp.u('xbrand'), pg_temp.u('xr1'), 'p:t4', 'ask', ARRAY['sms'], 'failed', 'sms', now()),
         (pg_temp.u('xF'), pg_temp.u('xe'), pg_temp.u('xbrand'), pg_temp.u('xr1'), 'p:t5', 'ask', ARRAY['sms'], 'sent', 'sms',
          (date_trunc('month', timezone('utc', now())) AT TIME ZONE 'utc') - interval '1 hour');
  PERFORM pg_temp.ok(public.brand_form_request_texts_this_month(pg_temp.u('xbrand')) = 2,
    'T-18 form texts this month: one text per person, push, failed and last month''s not counted');
  -- A Blast of 1 text this month too.
  PERFORM pg_temp.mb_blast_sms('x', 1);
  v := public.biz_brand_blast_usage_v1(pg_temp.u('xowner'), pg_temp.u('xbrand'));
  PERFORM pg_temp.ok((v->>'smsUsed')::integer = 3 AND (v->>'smsRemaining')::integer = 3 AND (v->>'smsCap')::integer = 6,
    'T-18a SC-37 Blast''s own usage counts the form texts (' || v::text || ')');
  PERFORM pg_temp.ok((public.brand_form_sms_month_state(pg_temp.u('xbrand'))->>'used')::integer = (v->>'smsUsed')::integer
      AND (public.brand_form_sms_month_state(pg_temp.u('xbrand'))->>'remaining')::integer = 3,
    'T-18a the form send reads exactly the number Blast reads');
  v_r := pg_temp.err(format($$SELECT public.biz_assert_brand_blast_allowance_v1(%L, 'sms', 4)$$, pg_temp.u('xbrand')));
  PERFORM pg_temp.ok(v_r LIKE 'P0001:book_blast_monthly_cap_exceeded%',
    'T-18b SC-37 a Blast that needs more than is left after form texts is blocked by Blast''s own check (' || v_r || ')');
  PERFORM pg_temp.ok(pg_temp.err(format($$SELECT public.biz_assert_brand_blast_allowance_v1(%L, 'sms', 3)$$, pg_temp.u('xbrand'))) = 'ok',
    'T-18b a Blast within what is left passes');

  -- SC-38: an Ask needing 4 texts with 3 left goes by email (and push) only.
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(pg_temp.u('xowner'), pg_temp.u('xF'), pg_temp.u('xe'), 'ask', 'everyone',
         pg_temp.subj('x', 'r1', 'r2', 'r3', 'r4', 'r5'), ARRAY['sms', 'email']);
  RESET ROLE;
  PERFORM pg_temp.ok(v->'textsOff' = jsonb_build_object('reason', 'monthly_allowance', 'needed', 4, 'remaining', 3)
      AND (v->>'queued')::integer = 4 AND (v->>'skippedNoTexts')::integer = 1 AND (v->>'textsQueued')::integer = 0,
    'T-18c SC-38 over the monthly allowance texts are off for the send; it is never refused (' || v::text || ')');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.brand_form_request_sends WHERE form_id = pg_temp.u('xF') AND kind = 'ask'
                        AND status = 'queued' AND route = ARRAY['email'] AND safe_reason = 'no_texts_left'
                        AND rsvp_id IN (pg_temp.u('xr1'), pg_temp.u('xr3'), pg_temp.u('xr4'))) = 3
      AND (SELECT status = 'skipped' AND safe_reason = 'no_texts_left' AND settled_at IS NOT NULL
             FROM public.brand_form_request_sends WHERE rsvp_id = pg_temp.u('xr2') AND kind = 'ask' AND person_key NOT LIKE 'p:%')
      AND (SELECT status = 'queued' AND safe_reason IS NULL FROM public.brand_form_request_sends
            WHERE rsvp_id = pg_temp.u('xr5') AND person_key NOT LIKE 'p:%'),
    'T-18c the log says why: emailed instead (no_texts_left), the phone-only guest skipped');
  PERFORM pg_temp.ok(public.brand_form_request_texts_this_month(pg_temp.u('xbrand')) = 2,
    'T-18c the allowance is not overrun (no new texts)');
  -- The reason survives settle when the email goes.
  DELETE FROM public.brand_form_request_sends WHERE person_key LIKE 'p:%';
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_claim_batch(100, pg_temp.u('xF'), pg_temp.u('xe'));
  SELECT (x->>'sendId')::uuid INTO v_send FROM jsonb_array_elements(v) x WHERE (x->>'subjectId')::uuid = pg_temp.u('xr1');
  PERFORM public.brand_form_request_settle(v_send, 'email', 'sent', NULL);
  RESET ROLE;
  PERFORM pg_temp.ok((SELECT safe_reason = 'no_texts_left' AND channel = 'email' FROM public.brand_form_request_sends WHERE id = v_send)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'textsOffReason' = 'no_texts_left'),
    'T-18c the delivery log keeps "Not texted: no texts left this month"');

  -- The daily cap: a big monthly allowance, 299 texts in the last day, 4 needed.
  DELETE FROM public.brand_form_request_sends WHERE form_id = pg_temp.u('xF');
  UPDATE public.brand_messaging_limits SET sms_monthly = 100000 WHERE brand_id = pg_temp.u('xbrand');
  INSERT INTO public.brand_form_request_sends (form_id, event_id, brand_id, rsvp_id, person_key, kind, route, status, channel)
  SELECT pg_temp.u('xF'), pg_temp.u('xe'), pg_temp.u('xbrand'), pg_temp.u('xr1'), 'p:d' || g, 'ask', ARRAY['sms'], 'sent', 'sms'
    FROM generate_series(1, 299) g;
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(pg_temp.u('xowner'), pg_temp.u('xF'), pg_temp.u('xe'), 'ask', 'everyone',
         pg_temp.subj('x', 'r1', 'r2', 'r3', 'r4'), ARRAY['sms', 'email']);
  RESET ROLE;
  PERFORM pg_temp.ok(v->'textsOff'->>'reason' = 'daily_cap' AND (v->'textsOff'->>'remaining')::integer = 1
      AND (v->>'queued')::integer = 3 AND (v->>'skippedNoTexts')::integer = 1
      AND (SELECT count(*) FROM public.brand_form_request_sends WHERE safe_reason = 'text_cap' AND person_key NOT LIKE 'p:%') = 4,
    'T-18d over the 300-a-day cap: the same rule, reason text_cap (' || v::text || ')');
  DELETE FROM public.brand_form_request_sends WHERE form_id = pg_temp.u('xF');

  -- Within both limits: texts go, counted once each.
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(pg_temp.u('xowner'), pg_temp.u('xF'), pg_temp.u('xe'), 'ask', 'everyone',
         pg_temp.subj('x', 'r1', 'r2'), ARRAY['sms', 'email']);
  RESET ROLE;
  PERFORM pg_temp.ok(v->'textsOff' = 'null'::jsonb AND (v->>'textsQueued')::integer = 2,
    'T-18 within the limits texts go (' || v::text || ')');

  -- R5.2 lock order: blast_cap before the brand's request lock, in both writers.
  FOR v_src IN SELECT p.prosrc FROM pg_proc p
                WHERE p.oid IN ('public.brand_form_request_enqueue(uuid,uuid,uuid,text,text,jsonb,text[])'::regprocedure,
                                'public.brand_form_auto_reminders_due()'::regprocedure) LOOP
    PERFORM pg_temp.ok(position('''blast_cap:''' IN v_src) > 0
        AND position('''blast_cap:''' IN v_src) < position('''brand_form_request:''' IN v_src),
      'T-18 R5.2 blast_cap is taken first');
  END LOOP;
END;
$t$;

-- ═══ T-42 client-called RPCs; service-role-only functions refused ════════════════
DO $t$
DECLARE v_sig text; v_r text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY['public.brand_form_push_settings()', 'public.brand_form_push_eligible(uuid)',
    'public.brand_form_request_texts_this_month(uuid)', 'public.brand_form_sms_month_state(uuid)'] LOOP
    PERFORM pg_temp.ok(has_function_privilege('service_role', v_sig, 'EXECUTE')
        AND NOT has_function_privilege('anon', v_sig, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', v_sig, 'EXECUTE'),
      'T-42 service role only: ' || v_sig);
    PERFORM pg_temp.ok((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] FROM pg_proc p WHERE p.oid = v_sig::regprocedure),
      'T-42 definer with an empty search path: ' || v_sig);
  END LOOP;
  PERFORM pg_temp.ok(has_function_privilege('authenticated', 'public.brand_form_report_capability(text,text,text,integer)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.brand_form_report_capability(text,text,text,integer)', 'EXECUTE'),
    'T-42 the capability report: authenticated, never anon');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.brand_form_push_capable', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.brand_form_push_capable', 'SELECT'),
    'T-42 the capability table has no client grant');
  PERFORM pg_temp.as_user(pg_temp.u('xu2'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.err($$SELECT public.brand_form_report_capability('explorer', 'android', '1.4.1', 1)$$);
  RESET ROLE;
  PERFORM pg_temp.ok(v_r = 'ok', 'T-42 brand_form_report_capability as the signed-in app user (' || v_r || ')');
END;
$t$;

-- ═══ T-14 … T-17 Blast "+ Form" (wave 6) ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION pg_temp.mb_campaign(p_id uuid, p_payload jsonb, p_status text, p_sent timestamptz)
RETURNS void LANGUAGE sql AS $fn$
  INSERT INTO public.marketing_campaigns (id, account_id, brand_id, audience_id, name, channel, channel_payload, status, sent_at)
  VALUES (p_id, pg_temp.u('xowner'), pg_temp.u('xbrand'), pg_temp.u('xaud'), 'Spring news', p_payload->>'kind', p_payload, p_status, p_sent)
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.blast_submit(p_cred jsonb, p_text text, p_expected integer DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.brand_form_submit_core(jsonb_build_object('formId', pg_temp.u('xF'), 'source', 'blast',
         'answers', jsonb_build_object('45419100-0000-4000-8000-000000000101', p_text),
         'expectedEditCount', p_expected, 'credential', p_cred));
  RESET ROLE;
  RETURN v::text;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLERRM;
END;
$fn$;

DO $t$
DECLARE
  v jsonb; v_r text; v_tok text; v_tok2 text; v_key text; v_id uuid; v_n integer;
  v_email jsonb := jsonb_build_object('kind', 'email', 'subject', 'Hi', 'body_html', 'Hi', 'body_text', 'Hi',
                     'embedded_form', jsonb_build_object('form_id', pg_temp.u('xF')));
BEGIN
  PERFORM pg_temp.mb_campaign(pg_temp.u('cmp'), v_email, 'sent', now());
  PERFORM pg_temp.mb_campaign(pg_temp.u('cmp_plain'), '{"kind":"email","subject":"Hi","body_html":"Hi","body_text":"Hi"}'::jsonb, 'sent', now());
  PERFORM pg_temp.mb_campaign(pg_temp.u('cmp_old'), v_email, 'sent', now() - interval '31 days');

  -- T-14 schema.
  v_r := pg_temp.err(format($$INSERT INTO public.brand_form_responses (form_id, version_id, brand_id, user_id, unknown_owner, verified, answers, source, campaign_id)
                             VALUES (%L, %L, %L, %L, true, false, '{}', 'blast', %L)$$,
         pg_temp.u('xF'), pg_temp.u('xFv'), pg_temp.u('xbrand'), pg_temp.u('xu1'), pg_temp.u('cmp')));
  PERFORM pg_temp.ok(v_r LIKE '23514%one_subject%', 'T-14 an Unknown reply has no other owner (' || v_r || ')');
  v_r := pg_temp.err(format($$INSERT INTO public.brand_form_responses (form_id, version_id, brand_id, unknown_owner, verified, answers, source, campaign_id, event_id)
                             VALUES (%L, %L, %L, true, false, '{}', 'blast', %L, %L)$$,
         pg_temp.u('xF'), pg_temp.u('xFv'), pg_temp.u('xbrand'), pg_temp.u('cmp'), pg_temp.u('xe')));
  PERFORM pg_temp.ok(v_r LIKE '23514%blast_ctx%', 'T-14 an Unknown reply is never on a page (' || v_r || ')');
  v_r := pg_temp.err(format($$INSERT INTO public.brand_form_responses (form_id, version_id, brand_id, unknown_owner, verified, answers, source, campaign_id)
                             VALUES (%L, %L, %L, true, true, '{}', 'blast', %L)$$,
         pg_temp.u('xF'), pg_temp.u('xFv'), pg_temp.u('xbrand'), pg_temp.u('cmp')));
  PERFORM pg_temp.ok(v_r LIKE '23514%verified%', 'T-14 an Unknown reply is never verified (' || v_r || ')');

  -- T-15 SC-32: Unknown, a new row every time; typed contact changes nothing.
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'unknown', 'campaignId', pg_temp.u('cmp')), 'i4541mb-xr1@example.test');
  PERFORM pg_temp.ok(v_r NOT LIKE 'ERR%' AND (v_r::jsonb->>'editable')::boolean IS FALSE
      AND v_r::jsonb->>'ownerKind' = 'unknown', 'T-15 SC-32 a signed-out reply is Unknown (' || v_r || ')');
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'unknown', 'campaignId', pg_temp.u('cmp')), 'Second');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.brand_form_responses
                       WHERE form_id = pg_temp.u('xF') AND unknown_owner AND campaign_id = pg_temp.u('cmp')
                         AND event_id IS NULL AND NOT verified AND source = 'blast') = 2
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses WHERE form_id = pg_temp.u('xF')
                       AND (rsvp_id = pg_temp.u('xr1') OR user_id = pg_temp.u('xu1'))),
    'T-15 SC-32 Unknown writes a new row each time; a typed email equal to a guest''s changes nothing');
  -- Signed in: the person themselves, editable.
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'user', 'userId', pg_temp.u('xu5'), 'campaignId', pg_temp.u('cmp')), 'Mine');
  PERFORM pg_temp.ok(v_r::jsonb->>'ownerKind' = 'app_user'
      AND EXISTS (SELECT 1 FROM public.brand_form_responses WHERE user_id = pg_temp.u('xu5') AND campaign_id = pg_temp.u('cmp')
                   AND event_id IS NULL AND verified),
    'T-15 SC-32 signed in: stored as that user (' || v_r || ')');
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'user', 'userId', pg_temp.u('xu5'), 'campaignId', pg_temp.u('cmp')), 'Again');
  PERFORM pg_temp.ok(v_r LIKE 'ERR:response_stale%', 'T-15 a second signed-in answer is an edit (' || v_r || ')');
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'user', 'userId', pg_temp.u('xu5'), 'campaignId', pg_temp.u('cmp')), 'Again', 0);
  PERFORM pg_temp.ok((v_r::jsonb->>'editCount')::integer = 1, 'T-15 the signed-in edit saves (' || v_r || ')');
  -- A personal Blast link: the recipient, by a hashed key, never the contact.
  SET LOCAL ROLE service_role;
  v := public.brand_form_link_issue_blast(pg_temp.u('xF'), pg_temp.u('cmp'), 'Lee.Blast@Example.test', 'Lee Blast');
  RESET ROLE;
  v_tok := v->>'token';
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'link', 'token', v_tok), 'Lee answers');
  v_key := public.brand_form_blast_contact_key(pg_temp.u('xbrand'), 'lee.blast@example.test');
  PERFORM pg_temp.ok(v_r::jsonb->>'ownerKind' = 'blast'
      AND EXISTS (SELECT 1 FROM public.brand_form_responses WHERE blast_contact_key = v_key AND owner_label = 'Lee Blast'
                   AND campaign_id = pg_temp.u('cmp') AND verified AND via_link)
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses WHERE blast_contact_key ILIKE '%lee%')
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_links WHERE blast_contact_key ILIKE '%lee%'),
    'T-15 SC-32 an own Blast link is the recipient, kept as a hash with their name (' || v_r || ')');
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'link', 'token', v_tok), 'Forwarded', 0);
  PERFORM pg_temp.ok(v_r LIKE 'ERR:code_required%', 'T-15 scenario 17: a forwarded link cannot change an existing answer (' || v_r || ')');
  SET LOCAL ROLE service_role;
  v := public.brand_form_my_response(pg_temp.u('xF'), NULL, v_tok, NULL);
  RESET ROLE;
  PERFORM pg_temp.ok(v->>'state' = 'code_required' AND (v->>'unknownAllowed')::boolean AND NOT (v->>'codeAvailable')::boolean
      AND v->'response' IS NULL AND v->>'identity' = 'Lee B.',
    'T-15 the link read never shows the answer without a code, and offers answering as Unknown (' || v::text || ')');
  SET LOCAL ROLE service_role;
  v := public.brand_form_link_resolve(v_tok);
  v_tok2 := (public.brand_form_link_issue_blast(pg_temp.u('xF'), pg_temp.u('cmp'), 'lee.blast@example.test', 'Lee Blast'))->>'token';
  RESET ROLE;
  PERFORM pg_temp.ok(v->>'kind' = 'blast' AND v->'channels' = '[]'::jsonb AND (v->>'answered')::boolean,
    'T-15 a Blast link resolves with no code channels (' || v::text || ')');
  -- Review fix 2: a later mint (a resumed send the provider de-duplicates keeps the first
  -- link) switches off no earlier link; the earlier link still needs the code to edit.
  SET LOCAL ROLE service_role;
  v := public.brand_form_link_resolve(v_tok);
  RESET ROLE;
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'link', 'token', v_tok), 'Old link');
  PERFORM pg_temp.ok(v->>'outcome' = 'ok' AND v_r LIKE 'ERR:code_required%' AND v_tok2 IS NOT NULL,
    'T-15 a newer Blast link leaves the earlier one working, still behind the code (' || v::text || ' / ' || v_r || ')');
  -- SC-36: the campaign window.
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'unknown', 'campaignId', pg_temp.u('cmp_plain')), 'x');
  PERFORM pg_temp.ok(v_r LIKE 'ERR:form_not_on_event%', 'T-15 SC-36 a campaign that did not embed the form is refused');
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'unknown', 'campaignId', pg_temp.u('cmp_old')), 'x');
  PERFORM pg_temp.ok(v_r LIKE 'ERR:form_not_on_event%', 'T-15 SC-36 a Blast older than 30 days is refused');
  -- SC-36: the per-form open-reply limit (2 a day here).
  UPDATE public.brand_forms SET open_reply_limit_per_day = 2 WHERE id = pg_temp.u('xF');
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'unknown', 'campaignId', pg_temp.u('cmp')), 'Third');
  PERFORM pg_temp.ok(v_r LIKE 'ERR:open_reply_limit%', 'T-15 SC-36 over the daily open-reply limit (' || v_r || ')');
  UPDATE public.brand_forms SET open_reply_limit_per_day = 500 WHERE id = pg_temp.u('xF');
  -- The read and the confirm check.
  SET LOCAL ROLE service_role;
  v := public.brand_form_blast_form(pg_temp.u('xF'), pg_temp.u('cmp'));
  PERFORM pg_temp.ok(v->'form'->>'id' = pg_temp.u('xF')::text AND v->'form'->'definition' IS NOT NULL
      AND strpos(v::text, 'Lee') = 0, 'T-15 the Blast form read: definition and brand, never answers');
  v := public.brand_form_blast_check(pg_temp.u('cmp'));
  PERFORM pg_temp.ok((v->>'ok')::boolean, 'T-15 confirm check passes a live form of the brand');
  RESET ROLE;

  -- T-16 SC-33: never on a guest record or at the door.
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_form_event_responses(pg_temp.u('xF'), pg_temp.u('xe')) r
                                  WHERE r.campaign_id IS NOT NULL AND r.event_id IS NULL)
      AND (SELECT count(*) FROM public.brand_form_event_responses(pg_temp.u('xF'), NULL) r WHERE r.campaign_id IS NOT NULL) = 4,
    'T-16 SC-33 Blast replies belong to All pages only, never a page');
  -- The door, guest answers, request audience, unanswered count and Responses: see T-16b
  -- (behaviour, after T-17 so its counts stay as they are).

  -- T-17 SC-34: Responses, filter, hide and undo, export, counts.
  PERFORM pg_temp.as_user(pg_temp.u('xowner'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_responses(p_form_id => pg_temp.u('xF'), p_event_id => NULL, p_filter => 'all', p_limit => 50, p_offset => 0);
  PERFORM pg_temp.ok((v->>'total')::integer = 4
      AND (SELECT count(*) FROM jsonb_array_elements(v->'rows') x WHERE x->'subject'->>'name' = 'Unknown' AND x->>'ownerKind' = 'unknown') = 2
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'rows') x WHERE x->>'ownerKind' = 'blast' AND x->'subject'->>'name' = 'Lee Blast'
                    AND x->>'campaignName' = 'Spring news'),
    'T-17 SC-34 an old Host build (five named arguments) sees Unknown rows named "Unknown" (' || left(v::text, 160) || ')');
  v := public.biz_brand_form_responses(pg_temp.u('xF'), NULL, 'all', 50, 0, 'unknown', false);
  PERFORM pg_temp.ok((v->>'total')::integer = 2, 'T-17 the Unknown filter');
  v := public.biz_brand_form_responses(pg_temp.u('xF'), NULL, 'all', 50, 0, 'known', false);
  PERFORM pg_temp.ok((v->>'total')::integer = 2 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'rows') x WHERE x->>'ownerKind' = 'unknown'),
    'T-17 the Known filter');
  v_r := pg_temp.err(format($$SELECT public.biz_brand_form_responses(%L, NULL, 'all', 50, 0, 'nobody', false)$$, pg_temp.u('xF')));
  PERFORM pg_temp.ok(v_r LIKE '22023:owner_invalid%', 'T-17 a bad owner filter is refused');
  RESET ROLE;
  SELECT r.id INTO v_id FROM public.brand_form_responses r WHERE r.form_id = pg_temp.u('xF') AND r.unknown_owner LIMIT 1;
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_response_hide(v_id, true);
  v := public.biz_brand_form_responses(pg_temp.u('xF'), NULL, 'all', 50, 0, 'all', false);
  PERFORM pg_temp.ok((v->>'total')::integer = 3 AND (v->>'hiddenCount')::integer = 1, 'T-17 SC-34 a hidden reply leaves the list and counts');
  v := public.biz_brand_form_responses(pg_temp.u('xF'), NULL, 'all', 50, 0, 'all', true);
  PERFORM pg_temp.ok((v->>'total')::integer = 4 AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'rows') x
                       WHERE (x->>'responseId')::uuid = v_id AND (x->>'hidden')::boolean), 'T-17 Show hidden lists it');
  v := public.biz_brand_form_responses_export(pg_temp.u('xF'), NULL);
  PERFORM pg_temp.ok(jsonb_array_length(v->'rows') = 3
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'rows') x WHERE x->>'name' = 'Unknown' AND x->>'campaign' = 'Spring news')
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'rows') x WHERE (x->>'responseId')::uuid = v_id),
    'T-17 the All pages export names Unknown and the campaign, without hidden rows');
  v := public.biz_brand_form_counts(pg_temp.u('xbrand'));
  PERFORM pg_temp.ok((SELECT f->'blastReplies' FROM jsonb_array_elements(v->'forms') f WHERE f->>'formId' = pg_temp.u('xF')::text)
                       = '{"known": 2, "unknown": 1}'::jsonb, 'T-17 R4.9 Blast reply counts leave hidden out');
  v := public.biz_brand_form_response_hide(v_id, false);
  v := public.biz_brand_form_responses(pg_temp.u('xF'), NULL, 'all', 50, 0, 'all', false);
  PERFORM pg_temp.ok((v->>'total')::integer = 4, 'T-17 SC-34 Undo restores the reply');
  RESET ROLE;
  SELECT r.id INTO v_id FROM public.brand_form_responses r WHERE r.form_id = pg_temp.u('xF') AND r.blast_contact_key IS NOT NULL;
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.err(format($$SELECT public.biz_brand_form_response_hide(%L, true)$$, v_id));
  PERFORM pg_temp.ok(v_r LIKE '22023:not_unknown%', 'T-17 only Unknown replies can be hidden');
  RESET ROLE;
  PERFORM pg_temp.as_user(pg_temp.u('xu1'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.err(format($$SELECT public.biz_brand_form_response_hide(%L, true)$$, v_id));
  RESET ROLE;
  PERFORM pg_temp.ok(v_r LIKE '42501%', 'T-17 a guest cannot hide anything (' || v_r || ')');

  -- R4.3 decision 10: a scheduled Blast whose form closed first.
  PERFORM pg_temp.mb_campaign(pg_temp.u('cmp_sched'), v_email, 'scheduled', NULL);
  UPDATE public.brand_forms SET status = 'closed', closed_at = now() WHERE id = pg_temp.u('xF');
  SET LOCAL ROLE service_role;
  v := public.brand_form_blast_check(pg_temp.u('cmp_sched'));
  PERFORM pg_temp.ok(v->>'code' = 'embedded_form_not_live', 'T-15 SC-30 confirm with a closed form: embedded_form_not_live');
  PERFORM pg_temp.ok(public.brand_form_blast_hold_if_closed(pg_temp.u('cmp_sched')), 'T-15 SC-31 the claim holds it');
  RESET ROLE;
  PERFORM pg_temp.ok((SELECT status = 'failed' AND failure_reason = 'form_closed' FROM public.marketing_campaigns WHERE id = pg_temp.u('cmp_sched'))
      AND EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'business.blast_form_closed'
                   AND user_id = pg_temp.u('xowner') AND payload->>'campaign_id' = pg_temp.u('cmp_sched')::text),
    'T-15 SC-31 failed / form_closed, nothing sent, the host told');
  UPDATE public.brand_forms SET status = 'live', closed_at = NULL WHERE id = pg_temp.u('xF');
END;
$t$;

-- ═══ T-42 wave 6 grants; Admin (R7.1) ══════════════════════════════════════════════
DO $t$
DECLARE v_sig text; v jsonb; v_r text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY['public.brand_form_blast_campaign_ok(uuid,uuid)', 'public.brand_form_blast_check(uuid)',
    'public.brand_form_blast_hold_if_closed(uuid)', 'public.brand_form_link_issue_blast(uuid,uuid,text,text)',
    'public.brand_form_blast_form(uuid,uuid)', 'public.brand_form_submit_blast(jsonb,uuid,uuid)',
    'public.brand_form_responses_scope(uuid,uuid,text,boolean)', 'public.brand_form_blast_contact_key(uuid,text)'] LOOP
    PERFORM pg_temp.ok(has_function_privilege('service_role', v_sig, 'EXECUTE')
        AND NOT has_function_privilege('anon', v_sig, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', v_sig, 'EXECUTE'), 'T-42 service role only: ' || v_sig);
  END LOOP;
  FOREACH v_sig IN ARRAY ARRAY['public.biz_brand_form_responses(uuid,uuid,text,integer,integer,text,boolean)',
    'public.biz_brand_form_response_hide(uuid,boolean)', 'public.admin_brand_form_set_open_reply_limit(uuid,integer)'] LOOP
    PERFORM pg_temp.ok(has_function_privilege('authenticated', v_sig, 'EXECUTE')
        AND NOT has_function_privilege('anon', v_sig, 'EXECUTE'), 'T-42 authenticated, never anon: ' || v_sig);
  END LOOP;
  PERFORM pg_temp.ok(to_regprocedure('public.biz_brand_form_responses(uuid,uuid,text,integer,integer)') IS NULL,
    'T-42 the five-argument signature is gone (old clients resolve the seven-argument one by name)');
  -- Admin: refused for a host; an admin sets the limit and reads the numbers.
  PERFORM pg_temp.as_user(pg_temp.u('xowner'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.err(format($$SELECT public.admin_brand_form_set_open_reply_limit(%L, 10)$$, pg_temp.u('xF')));
  RESET ROLE;
  PERFORM pg_temp.ok(v_r LIKE '42501:forbidden%', 'T-42 SC-43 a host cannot set the open-reply limit');
  INSERT INTO auth.users(id, email) VALUES (pg_temp.u('xadm'), 'i4541mb-xadm@example.test');
  INSERT INTO public.admin_users(email, role, status) VALUES ('i4541mb-xadm@example.test', 'admin', 'active');
  PERFORM pg_temp.as_user(pg_temp.u('xadm'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.err(format($$SELECT public.admin_brand_form_set_open_reply_limit(%L, 6000)$$, pg_temp.u('xF')));
  v := public.admin_brand_form_set_open_reply_limit(pg_temp.u('xF'), 50);
  v := public.admin_brand_forms_support(pg_temp.u('xbrand'));
  RESET ROLE;
  PERFORM pg_temp.ok(v_r LIKE '22023:limit_invalid%', 'T-42 the limit stays within 0..5000');
  PERFORM pg_temp.ok((SELECT (f->>'openReplyLimitPerDay')::integer = 50 AND (f->>'blastUnknown')::integer = 2
                             AND (f->>'blastKnown')::integer = 2 FROM jsonb_array_elements(v->'forms') f
                       WHERE f->>'id' = pg_temp.u('xF')::text)
      AND v ? 'formReadyAppShare14d' AND (v->'switches') ? 'BRAND_FORMS_PUSH'
      AND strpos(v::text, 'Lee') = 0 AND strpos(v::text, '@example.test') = 0 AND strpos(v::text, 'Mine') = 0,
    'T-42 SC-43 the Admin read: the limit, Blast counts, the form-ready share, never answers or contacts');
END;
$t$;

-- ═══ T-16b never a guest's answer, by behaviour (SC-33, review fixes 1, 2 and 4) ═══════
-- Guests on the required-form page xe: r1 (u1) has an Unknown reply that typed their email
-- and a Blast reply through their own link (contact key = their RSVP email); r5 (u5) has a
-- signed-in Blast reply. Every page surface shows both as not answered.
CREATE OR REPLACE FUNCTION pg_temp.page_submit(p_user uuid, p_text text, p_expected integer DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  -- A client that labels a page answer 'blast' still writes a page answer.
  v := public.brand_form_submit_core(jsonb_build_object('formId', pg_temp.u('xF'), 'source', 'blast',
         'eventId', pg_temp.u('xe'), 'answers', jsonb_build_object('45419100-0000-4000-8000-000000000101', p_text),
         'expectedEditCount', p_expected, 'credential', jsonb_build_object('kind', 'user', 'userId', p_user)));
  RESET ROLE;
  RETURN v::text;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLERRM;
END;
$fn$;

DO $t$
DECLARE
  v jsonb; v_r text; v_tok text; v_sms_tok text; v_n integer; v_current integer; v_page uuid; v_blast uuid;
  v_s1 jsonb := jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('xr1'));
  v_s5 jsonb := jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('xr5'));
BEGIN
  -- (b) r1's own Blast link, keyed by their RSVP email (any case), answered.
  SET LOCAL ROLE service_role;
  v_tok := (public.brand_form_link_issue_blast(pg_temp.u('xF'), pg_temp.u('cmp'), 'I4541MB-xr1@Example.test', 'Una One'))->>'token';
  RESET ROLE;
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'link', 'token', v_tok), 'Una by Blast');
  PERFORM pg_temp.ok(v_r::jsonb->>'ownerKind' = 'blast', 'T-16b r1 answered the Blast through their own link (' || v_r || ')');
  -- (a) the Unknown reply typing r1's email is from T-15; (c) u5's signed-in reply is from T-15.
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.brand_form_responses WHERE form_id = pg_temp.u('xF') AND user_id = pg_temp.u('xu5')
                               AND source = 'blast' AND campaign_id = pg_temp.u('cmp'))
      AND (SELECT count(*) FROM public.brand_form_responses WHERE form_id = pg_temp.u('xF') AND event_id IS NOT NULL) = 0,
    'T-16b fixture: Blast replies only, no page answers yet');

  -- Door read (as the host): a required form, no answer.
  PERFORM pg_temp.ok(public.brand_form_door_answers(pg_temp.u('xowner'), pg_temp.u('xe'), v_s1)->>'state' = 'not_answered'
      AND public.brand_form_door_answers(pg_temp.u('xowner'), pg_temp.u('xe'), v_s5)->>'state' = 'not_answered',
    'T-16b SC-33 the door shows r1 and r5 as not answered');
  -- Request audience: both still get Ask / Remind.
  v := public.brand_form_request_audience(NULL, pg_temp.u('xF'), pg_temp.u('xe'), 'unanswered', NULL, ARRAY['email']);
  PERFORM pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(v->'recipients') x
                       WHERE x->>'id' IN (pg_temp.u('xr1')::text, pg_temp.u('xr5')::text)
                         AND NOT (x->>'answered')::boolean) = 2,
    'T-16b the unanswered request audience includes r1 and r5 (' || left((v->'recipients')::text, 200) || ')');
  -- Unanswered count: every current guest (nobody has a page answer).
  SELECT count(*) INTO v_current FROM public.event_rsvps x
   WHERE x.event_id = pg_temp.u('xe') AND public.brand_form_subject_current('rsvp', x.id, pg_temp.u('xe'));
  v_n := public.brand_form_unanswered_count(pg_temp.u('xF'), pg_temp.u('xe'));
  PERFORM pg_temp.ok(v_n = v_current AND v_current >= 2, 'T-16b the unanswered count leaves no Blast reply out (' || v_n || ' of ' || v_current || ')');
  -- Guest answers and the page's Responses, as the host.
  PERFORM pg_temp.as_user(pg_temp.u('xowner'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.ok(public.biz_brand_form_guest_answers(pg_temp.u('xe'), v_s1)->>'state' = 'not_answered'
      AND public.biz_brand_form_guest_answers(pg_temp.u('xe'), v_s5)->>'state' = 'not_answered',
    'T-16b guest detail shows r1 and r5 as not answered');
  v := public.biz_brand_form_responses(pg_temp.u('xF'), pg_temp.u('xe'));
  RESET ROLE;
  PERFORM pg_temp.ok((v->>'total')::integer = 0
      AND (SELECT count(*) FROM jsonb_array_elements(v->'notAnswered') x
            WHERE x->>'id' IN (pg_temp.u('xr1')::text, pg_temp.u('xr5')::text)) = 2,
    'T-16b the page''s Responses list r1 and r5 under not answered (' || left((v->'notAnswered')::text, 200) || ')');
  -- The guest's own page read (signed in): nothing answered yet.
  PERFORM pg_temp.as_user(pg_temp.u('xu5'));
  SET LOCAL ROLE authenticated;
  v := public.brand_form_my_response(pg_temp.u('xF'), pg_temp.u('xe'), NULL, NULL);
  RESET ROLE;
  PERFORM pg_temp.ok(v->>'state' = 'unanswered' AND v->'response' = 'null'::jsonb,
    'T-16b u5''s own page read does not show their Blast reply (' || left(v::text, 120) || ')');

  -- A Blast submit never alters a page answer: u3 answers the page first ...
  v_r := pg_temp.page_submit(pg_temp.u('xu3'), 'Page answer');
  v_page := (v_r::jsonb->>'responseId')::uuid;
  PERFORM pg_temp.ok(v_page IS NOT NULL AND (SELECT source = 'page' AND event_id = pg_temp.u('xe') FROM public.brand_form_responses WHERE id = v_page),
    'T-16b a page answer labelled blast by the client is stored as a page answer (' || v_r || ')');
  -- ... then the Blast: a new Blast reply of its own, the page answer untouched.
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'user', 'userId', pg_temp.u('xu3'), 'campaignId', pg_temp.u('cmp')), 'Blast answer');
  PERFORM pg_temp.ok(v_r NOT LIKE 'ERR%', 'T-16b SC-33 a signed-in Blast reply is its own new reply, not an edit of the page answer (' || v_r || ')');
  v_blast := (v_r::jsonb->>'responseId')::uuid;
  PERFORM pg_temp.ok((v_r::jsonb->>'created')::boolean AND v_blast <> v_page
      AND (SELECT answers->>'45419100-0000-4000-8000-000000000101' = 'Page answer' AND edit_count = 0
             FROM public.brand_form_responses WHERE id = v_page),
    'T-16b SC-33 a signed-in Blast reply never edits the page answer (' || v_r || ')');
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'user', 'userId', pg_temp.u('xu3'), 'campaignId', pg_temp.u('cmp')), 'Blast edit', 0);
  PERFORM pg_temp.ok((v_r::jsonb->>'responseId')::uuid = v_blast
      AND (SELECT answers->>'45419100-0000-4000-8000-000000000101' = 'Page answer' FROM public.brand_form_responses WHERE id = v_page),
    'T-16b the Blast edit changes only the Blast reply (' || v_r || ')');
  PERFORM pg_temp.as_user(pg_temp.u('xowner'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_guest_answers(pg_temp.u('xe'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('xr3')));
  RESET ROLE;
  PERFORM pg_temp.ok(v->>'state' = 'answered' AND v::text LIKE '%Page answer%' AND v::text NOT LIKE '%Blast edit%',
    'T-16b guest detail shows u3''s page answer, never the Blast reply (' || left(v::text, 160) || ')');
  -- ... and a page answer after a Blast reply is its own row; the Blast reply stays.
  v_r := pg_temp.page_submit(pg_temp.u('xu5'), 'Five on the page');
  PERFORM pg_temp.ok(v_r NOT LIKE 'ERR%' AND (v_r::jsonb->>'created')::boolean
      AND EXISTS (SELECT 1 FROM public.brand_form_responses WHERE user_id = pg_temp.u('xu5') AND source = 'blast'
                   AND answers->>'45419100-0000-4000-8000-000000000101' = 'Again'),
    'T-16b u5 can still answer the page; their Blast reply is left as it was (' || v_r || ')');
  -- A Blast reply never moves onto a page, nor a page answer into a Blast.
  v_r := pg_temp.err(format($$UPDATE public.brand_form_responses SET source = 'page' WHERE id = %L$$, v_blast));
  PERFORM pg_temp.ok(v_r LIKE '42501%response_subject_fixed%', 'T-16b a Blast reply cannot be relabelled a page answer (' || v_r || ')');

  -- Review fix 2: email and text of one combined Blast (one campaign row per channel) mint
  -- with the same contact key; the email link keeps working after the text link is minted.
  INSERT INTO public.marketing_campaigns (id, account_id, brand_id, audience_id, name, channel, channel_payload, status, sent_at)
  VALUES (pg_temp.u('cmp_sms'), pg_temp.u('xowner'), pg_temp.u('xbrand'), pg_temp.u('xaud'), 'Spring news', 'sms',
          jsonb_build_object('kind', 'sms', 'body', 'Hi', 'embedded_form', jsonb_build_object('form_id', pg_temp.u('xF'))),
          'sent', now());
  SET LOCAL ROLE service_role;
  v_tok := (public.brand_form_link_issue_blast(pg_temp.u('xF'), pg_temp.u('cmp'), 'kim.combo@example.test', 'Kim Combo'))->>'token';
  v_sms_tok := (public.brand_form_link_issue_blast(pg_temp.u('xF'), pg_temp.u('cmp_sms'), 'kim.combo@example.test', 'Kim Combo'))->>'token';
  v := public.brand_form_link_resolve(v_tok);
  RESET ROLE;
  PERFORM pg_temp.ok(v->>'outcome' = 'ok' AND v->>'kind' = 'blast' AND NOT (v->>'answered')::boolean,
    'T-16b fix 2 the email link still resolves after the text link is minted (' || v::text || ')');
  v_r := pg_temp.blast_submit(jsonb_build_object('kind', 'link', 'token', v_tok), 'Kim by email');
  SET LOCAL ROLE service_role;
  v := public.brand_form_link_resolve(v_sms_tok);
  RESET ROLE;
  PERFORM pg_temp.ok(v_r NOT LIKE 'ERR%' AND v->>'outcome' = 'ok' AND (v->>'answered')::boolean,
    'T-16b fix 2 the email link answers and the text link still resolves to the same reply (' || v_r || ')');

  -- Review fix 4: deleting u1's account erases their Blast reply and link kept by contact
  -- key (answers and name), recomputed per brand; Lee's, Kim's and Unknown replies stay.
  v_n := (SELECT count(*) FROM public.brand_form_responses WHERE form_id = pg_temp.u('xF') AND unknown_owner);
  SET LOCAL ROLE service_role;
  v := public.brand_form_erase_person(pg_temp.u('xu1'));
  RESET ROLE;
  PERFORM pg_temp.ok((v->>'blastResponses')::integer = 1 AND (v->>'blastLinks')::integer = 1
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses
                       WHERE blast_contact_key = public.brand_form_blast_contact_key(pg_temp.u('xbrand'), 'i4541mb-xr1@example.test'))
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_links
                       WHERE blast_contact_key = public.brand_form_blast_contact_key(pg_temp.u('xbrand'), 'i4541mb-xr1@example.test'))
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses WHERE owner_label = 'Una One')
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_links WHERE recipient_label = 'Una One')
      AND EXISTS (SELECT 1 FROM public.brand_form_responses WHERE owner_label = 'Lee Blast')
      AND EXISTS (SELECT 1 FROM public.brand_form_responses WHERE owner_label = 'Kim Combo')
      AND (SELECT count(*) FROM public.brand_form_responses WHERE form_id = pg_temp.u('xF') AND unknown_owner) = v_n,
    'T-16b fix 4 account deletion erases the person''s Blast reply and link kept by contact key (' || v::text || ')');
  SET LOCAL ROLE service_role;
  v := public.brand_form_erase_person(pg_temp.u('xu5'));
  RESET ROLE;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_form_responses WHERE user_id = pg_temp.u('xu5')),
    'T-16b fix 4 a signed-in Blast reply goes with the account (' || v::text || ')');
END;
$t$;

ROLLBACK;

-- ═══ T-18-RACE two sessions, one budget (SC-39) ═══════════════════════════════════
-- Committed fixtures (a dblink session sees only committed rows); removed at the end.
BEGIN;
SELECT pg_temp.mb_fixture('race');
INSERT INTO public.brand_messaging_limits (brand_id, email_monthly, sms_monthly, reason)
VALUES (pg_temp.u('racebrand'), 1000, 3, 'i4541mb race');
COMMIT;

-- The second connections reuse this psql session's own password; nothing is written here.
\getenv i4541mb_pw PGPASSWORD
SELECT dblink_connect('i4541mb_a', format('dbname=%L user=%L password=%L host=127.0.0.1', current_database(), current_user, :'i4541mb_pw'));
SELECT dblink_connect('i4541mb_b', format('dbname=%L user=%L password=%L host=127.0.0.1', current_database(), current_user, :'i4541mb_pw'));

-- RACE-1: a Blast confirm (check + execution row, 3 texts = all that is left) holds the
-- lock; a form send needing 2 texts waits, then sees the Blast and goes without texts.
SELECT dblink_exec('i4541mb_a', 'BEGIN');
SELECT * FROM dblink('i4541mb_a', format($$SELECT public.biz_assert_brand_blast_allowance_v1(%L, 'sms', 3)::text$$, pg_temp.u('racebrand'))) AS t(r text);
SELECT dblink_exec('i4541mb_a', format($$
  WITH c AS (INSERT INTO public.marketing_campaigns (account_id, brand_id, audience_id, name, channel, channel_payload, status)
             VALUES (%L, %L, %L, 'Race', 'sms', '{"kind":"sms","body":"Hi"}'::jsonb, 'sent') RETURNING id)
  INSERT INTO public.marketing_book_send_executions (
    brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash, content_hash, selected_count,
    reachable_count, suppressed_count, unavailable_count, sms_segment_count, estimated_cost_minor, currency, cost_kind,
    ratebook_ids, source_references, quoted_at, scheduled_for, send_mode)
  SELECT %L, c.id, %L, gen_random_uuid(), 1, repeat('a', 64), repeat('b', 64), 3, 3, 0, 0, 3, NULL, NULL,
         'not_metered', '[]'::jsonb, '[]'::jsonb, now(), now(), 'now' FROM c$$,
  pg_temp.u('raceowner'), pg_temp.u('racebrand'), pg_temp.u('raceaud'), pg_temp.u('racebrand'), pg_temp.u('raceowner')));
SELECT dblink_send_query('i4541mb_b', format($$SELECT public.brand_form_request_enqueue(%L, %L, %L, 'ask', 'everyone', %L::jsonb, ARRAY['sms', 'email'])::text$$,
  pg_temp.u('raceowner'), pg_temp.u('raceF'), pg_temp.u('racee'), pg_temp.subj('race', 'r1', 'r3')::text));
SELECT pg_sleep(0.5);
DO $race$
BEGIN
  PERFORM pg_temp.ok(dblink_is_busy('i4541mb_b') = 1,
    'T-18-RACE-1 the form send waits on the shared blast_cap lock while the Blast confirm is open');
END;
$race$;
SELECT dblink_exec('i4541mb_a', 'COMMIT');
CREATE TEMP TABLE i4541mb_race1 AS SELECT * FROM dblink_get_result('i4541mb_b') AS t(result text);
-- Clear the connection for the next query (the empty final result).
SELECT count(*) FROM dblink_get_result('i4541mb_b') AS t(result text);
DO $race$
DECLARE v jsonb := (SELECT result::jsonb FROM i4541mb_race1);
BEGIN
  PERFORM pg_temp.ok(v->'textsOff'->>'reason' = 'monthly_allowance' AND (v->>'textsQueued')::integer = 0
      AND public.brand_form_request_texts_this_month(pg_temp.u('racebrand')) = 0
      AND (public.brand_form_sms_month_state(pg_temp.u('racebrand'))->>'used')::integer = 3,
    'T-18-RACE-1 SC-39 the Blast and the form send never both pass: the form send goes without texts (' || v::text || ')');
END;
$race$;

-- RACE-2: the other order. A form send (2 texts of 3) holds the lock; a Blast check for
-- 2 texts waits, then is refused by Blast's own check.
SELECT dblink_exec('i4541mb_a', format($$DELETE FROM public.brand_form_request_sends WHERE brand_id = %L$$, pg_temp.u('racebrand')));
SELECT dblink_exec('i4541mb_a', format($$SET session_replication_role = replica; DELETE FROM public.marketing_book_send_executions WHERE brand_id = %L; DELETE FROM public.marketing_campaigns WHERE brand_id = %L AND name = 'Race'; SET session_replication_role = origin$$,
  pg_temp.u('racebrand'), pg_temp.u('racebrand')));
SELECT dblink_exec('i4541mb_a', 'BEGIN');
SELECT * FROM dblink('i4541mb_a', format($$SELECT public.brand_form_request_enqueue(%L, %L, %L, 'ask', 'everyone', %L::jsonb, ARRAY['sms', 'email'])::text$$,
  pg_temp.u('raceowner'), pg_temp.u('raceF'), pg_temp.u('racee'), pg_temp.subj('race', 'r1', 'r3')::text)) AS t(result text);
SELECT dblink_send_query('i4541mb_b', format($$SELECT public.biz_assert_brand_blast_allowance_v1(%L, 'sms', 2)::text$$, pg_temp.u('racebrand')));
SELECT pg_sleep(0.5);
DO $race$
BEGIN
  PERFORM pg_temp.ok(dblink_is_busy('i4541mb_b') = 1,
    'T-18-RACE-2 the Blast check waits on the same lock while the form send is open');
END;
$race$;
SELECT dblink_exec('i4541mb_a', 'COMMIT');
CREATE TEMP TABLE i4541mb_race2 (msg text);
DO $race$
DECLARE v_msg text;
BEGIN
  BEGIN
    PERFORM * FROM dblink_get_result('i4541mb_b') AS t(r text);
    v_msg := 'ok';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  INSERT INTO i4541mb_race2 VALUES (v_msg);
  PERFORM pg_temp.ok(v_msg LIKE '%book_blast_monthly_cap_exceeded%'
      AND public.brand_form_request_texts_this_month(pg_temp.u('racebrand')) = 2,
    'T-18-RACE-2 SC-39 the form texts took the budget first; the Blast is refused by its own check (' || v_msg || ')');
END;
$race$;

-- Clean up the committed fixture.
SELECT dblink_exec('i4541mb_a', format($$
  SET session_replication_role = replica;
  DELETE FROM public.brand_form_request_sends WHERE brand_id = %1$L;
  DELETE FROM public.brand_form_links WHERE form_id = %2$L;
  DELETE FROM public.marketing_book_send_executions WHERE brand_id = %1$L;
  DELETE FROM public.marketing_campaigns WHERE brand_id = %1$L;
  DELETE FROM public.marketing_audiences WHERE brand_id = %1$L;
  DELETE FROM public.brand_messaging_limits WHERE brand_id = %1$L;
  DELETE FROM public.brand_form_attachments WHERE form_id = %2$L;
  DELETE FROM public.brand_form_versions WHERE form_id = %2$L;
  DELETE FROM public.brand_forms WHERE id = %2$L;
  DELETE FROM public.event_rsvps WHERE event_id = %3$L;
  DELETE FROM public.event_dates WHERE event_id = %3$L;
  DELETE FROM public.events WHERE id = %3$L;
  DELETE FROM public.brand_team_members WHERE brand_id = %1$L;
  DELETE FROM public.brands WHERE id = %1$L;
  DELETE FROM public.profiles WHERE email LIKE 'i4541mb-race%%';
  DELETE FROM auth.users WHERE email LIKE 'i4541mb-race%%';
  SET session_replication_role = origin$$,
  pg_temp.u('racebrand'), pg_temp.u('raceF'), pg_temp.u('racee')));
SELECT dblink_disconnect('i4541mb_a');
SELECT dblink_disconnect('i4541mb_b');
