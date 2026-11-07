-- #4273 polish — the send snapshot is written once and only by the server; the
-- group view returns every method of one campaign with counts and no contacts;
-- a campaign that has started is read-only to the app and the API; a failed or
-- cancelled method no longer holds its slot in the group. Runs on the fully
-- applied migration chain and rolls back.
--
-- MINGLA-INVARIANT: I-4273-SENT-SNAPSHOT-WRITE-ONCE | issue #4273 | marketing_campaigns.sent_snapshot is written only by the server (service_role / postgres) and never changes once set; an app or API caller can neither set it on insert nor change it.
-- MINGLA-INVARIANT: I-4273-SENT-VIEW-NO-CONTACTS | issue #4273 | biz_marketing_campaign_group_view_v1 returns counts, saved messages and snapshots only: no key naming an email, phone, user id or contact, and no recipient value.
-- MINGLA-INVARIANT: I-4273-SENT-CAMPAIGN-READ-ONLY | issue #4273 | An app or API caller cannot change the text, status or server fields of a campaign that is sending, sent, failed, cancelled, already due, or partly sent (a snapshot, or any message row other than one held for quiet hours); its own unsent edits, scheduling, rescheduling and cancelling of a send that has not started are unchanged, and the server's transitions are not restricted.
-- MINGLA-INVARIANT: I-4273-SENT-CAMPAIGN-KEPT-ON-RECORD | issue #4273 | An app or API caller can delete only a campaign row that never sent (one not yet scheduled, or a failed or cancelled one with no sent-family message, no sent push and recipient_count 0); anything that reached someone stays on record, and the server is not restricted.
-- MINGLA-INVARIANT: I-4273-FAILED-METHOD-FREES-ITS-SLOT | issue #4273 | One live method per campaign group: a failed or cancelled method no longer blocks that method from being used again in its group.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t4273s_fail(id serial, line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4273s_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('4273e000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid
$f$;
-- The result of the last attempt, kept in a session setting so it survives
-- the role switch and the caught error.
CREATE FUNCTION pg_temp.r(p_key text) RETURNS text LANGUAGE sql AS $f$
  SELECT current_setting('t4273s.' || p_key, true)
$f$;
-- Every key anywhere in a jsonb document.
CREATE FUNCTION pg_temp.keys(p jsonb) RETURNS SETOF text LANGUAGE sql AS $f$
  WITH RECURSIVE walk(v) AS (
    SELECT p
    UNION ALL
    SELECT x.value FROM walk w
      CROSS JOIN LATERAL (
        SELECT e.value FROM jsonb_each(CASE WHEN jsonb_typeof(w.v) = 'object' THEN w.v ELSE '{}'::jsonb END) e
        UNION ALL
        SELECT a.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.v) = 'array' THEN w.v ELSE '[]'::jsonb END) a
      ) x
  )
  SELECT k.key FROM walk w
    CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(w.v) = 'object' THEN w.v ELSE '{}'::jsonb END) k(key)
$f$;
GRANT ALL ON t4273s_fail TO PUBLIC;
GRANT ALL ON SEQUENCE t4273s_fail_id_seq TO PUBLIC;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- 01 the host. 02 a stranger to the brand. 11..13 push recipients.
INSERT INTO auth.users(id, email)
SELECT pg_temp.u(x), 't4273s-' || x || '@example.test'
  FROM unnest(ARRAY['01', '02', '11', '12', '13']) x;
INSERT INTO public.creator_accounts(id, email) VALUES (pg_temp.u('01'), 't4273s-01@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, cover_media_url, cover_media_type, created_at, updated_at)
VALUES (pg_temp.u('b1'), pg_temp.u('01'), 'Lantern Room', 'issue-4273s-lantern', 'USD',
        'https://cdn.example/cover.jpg', 'image', now(), now());
INSERT INTO public.marketing_audiences(id, account_id, brand_id, name, query_definition)
VALUES (pg_temp.u('a1'), pg_temp.u('01'), pg_temp.u('b1'), 'Buyers',
        jsonb_build_object('kind', 'brand_buyers', 'brand_id', pg_temp.u('b1')));

-- A three-method blast, all sent: email head c1, SMS c2, push c3.
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, sent_at, created_at)
VALUES
  (pg_temp.u('c1'), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Rooftop', 'email',
   '{"kind":"email","subject":"Hi {first_name}","body_html":"<p>Doors at 9</p>","body_text":"Doors at 9"}', 'sent', now(), now() - interval '3 minutes');
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, sent_at, campaign_group_id, created_at)
VALUES
  (pg_temp.u('c2'), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Rooftop', 'sms',
   '{"kind":"sms","body":"Doors at 9"}', 'sent', now(), pg_temp.u('c1'), now() - interval '2 minutes'),
  (pg_temp.u('c3'), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Rooftop', 'push',
   '{"kind":"push","body":"Doors at 9"}', 'sent', now(), pg_temp.u('c1'), now() - interval '1 minute');
INSERT INTO public.marketing_book_send_executions(
  id, brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash, content_hash,
  selected_count, reachable_count, suppressed_count, unavailable_count, sms_segment_count,
  estimated_cost_minor, currency, cost_kind, quoted_at, scheduled_for, send_mode, ratebook_ids, source_references)
VALUES
  (pg_temp.u('ee2'), pg_temp.u('b1'), pg_temp.u('c2'), pg_temp.u('01'), pg_temp.u('dd2'), 1, repeat('a', 64), repeat('b', 64),
   3, 3, 0, 0, 6, 412, 'USD', 'provider_estimate', now(), now(), 'now', '[]', '[]'),
  (pg_temp.u('ee3'), pg_temp.u('b1'), pg_temp.u('c3'), pg_temp.u('01'), pg_temp.u('dd3'), 1, repeat('a', 64), repeat('b', 64),
   3, 3, 0, 0, 0, NULL, NULL, 'not_metered', now(), now(), 'now', '[]', '[]');
INSERT INTO public.marketing_messages(campaign_id, recipient_phone, channel, status, segments) VALUES
  (pg_temp.u('c2'), '+2348031104201', 'sms', 'sent', 2),
  (pg_temp.u('c2'), '+2348031104202', 'sms', 'delivered', 2),
  (pg_temp.u('c2'), '+2348031104203', 'sms', 'deferred', 2);
INSERT INTO public.marketing_push_messages(campaign_id, execution_id, user_id, reason, status) VALUES
  (pg_temp.u('c3'), pg_temp.u('ee3'), pg_temp.u('11'), 'follower', 'sent'),
  (pg_temp.u('c3'), pg_temp.u('ee3'), pg_temp.u('12'), 'book', 'sent'),
  (pg_temp.u('c3'), pg_temp.u('ee3'), pg_temp.u('13'), 'follower', 'skipped');
-- A draft (d1), a send already due (d2), a failed SMS in its own group (f1).
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, scheduled_for)
VALUES
  (pg_temp.u('d1'), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Draft', 'email',
   '{"kind":"email","subject":"Soon","body_html":"<p>Soon</p>","body_text":"Soon"}', 'draft', NULL),
  (pg_temp.u('d2'), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Due', 'email',
   '{"kind":"email","subject":"Due","body_html":"<p>Due</p>","body_text":"Due"}', 'scheduled', now() - interval '1 minute'),
  (pg_temp.u('f1'), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Failed', 'sms',
   '{"kind":"sms","body":"Failed"}', 'failed', NULL);

-- P2-2 / P2-4 fixtures: a failed SMS that partly sent (f2), a failed email the
-- server counted (f3), a plain draft (d3), a future send that already has a
-- message row but no snapshot (s1), one held entirely for quiet hours (s2).
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, scheduled_for, recipient_count)
VALUES
  (pg_temp.u('f2'), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Partly sent', 'sms', '{"kind":"sms","body":"Partly"}', 'failed', NULL, 0),
  (pg_temp.u('f3'), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Counted', 'email', '{"kind":"email","subject":"C","body_html":"<p>C</p>","body_text":"C"}', 'failed', NULL, 3),
  (pg_temp.u('d3'), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Throwaway', 'push', '{"kind":"push","body":"x"}', 'draft', NULL, NULL),
  (pg_temp.u('aa1'), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Started', 'sms', '{"kind":"sms","body":"Started"}', 'scheduled', now() + interval '2 hours', 0),
  (pg_temp.u('aa2'), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Held', 'email', '{"kind":"email","subject":"H","body_html":"<p>H</p>","body_text":"H"}', 'scheduled', now() + interval '2 hours', 0);
INSERT INTO public.marketing_messages(campaign_id, recipient_phone, recipient_email, channel, status, segments) VALUES
  (pg_temp.u('f2'), '+2348031104211', NULL, 'sms', 'sent', 1),
  (pg_temp.u('f2'), '+2348031104212', NULL, 'sms', 'failed', 1),
  (pg_temp.u('aa1'), '+2348031104213', NULL, 'sms', 'failed', 1),
  (pg_temp.u('aa2'), NULL, 'held@guestmail.net', 'email', 'deferred', NULL);

-- ── T-6 the snapshot guard ──────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', pg_temp.u('01')::text, true),
       set_config('request.jwt.claims', json_build_object('sub', pg_temp.u('01'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET sent_snapshot = '{"v":1,"kind":"email"}' WHERE id = pg_temp.u('d1');
  PERFORM set_config('t4273s.t6a', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.t6a', SQLERRM, true); END $a$;
DO $a$ BEGIN
  INSERT INTO public.marketing_campaigns(account_id, brand_id, audience_id, name, channel, channel_payload, status, sent_snapshot)
  VALUES (pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Forged', 'email',
          '{"kind":"email","subject":"x","body_html":"<p>x</p>","body_text":"x"}', 'draft', '{"v":1,"kind":"email"}');
  PERFORM set_config('t4273s.t6b', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.t6b', SQLERRM, true); END $a$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns
     SET sent_snapshot = '{"v":1,"kind":"email","subject":"Hi {first_name}","from_display":"Lantern Room","from_address":"lanternroom@campaigns.usemingla.com","campaign_variables":{"brand_name":"Lantern Room"},"per_guest_tokens":["first_name"],"embedded_events":[]}'
   WHERE id = pg_temp.u('c1') AND sent_snapshot IS NULL;
  PERFORM set_config('t4273s.t6c', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.t6c', SQLERRM, true); END $a$;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET sent_snapshot = '{"v":1,"kind":"email","subject":"Changed"}' WHERE id = pg_temp.u('c1');
  PERFORM set_config('t4273s.t6d', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.t6d', SQLERRM, true); END $a$;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET sent_snapshot = '{"v":2,"kind":"email"}' WHERE id = pg_temp.u('c2');
  PERFORM set_config('t4273s.t6e', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.t6e', SQLERRM, true); END $a$;
UPDATE public.marketing_campaigns
   SET sent_snapshot = '{"v":1,"kind":"push","title":null,"body_as_authored":"Doors at 9","variants":[{"reason":"follower","title":"Lantern Room","body":"Doors at 9 You follow Lantern Room."}]}'
 WHERE id = pg_temp.u('c3');
RESET ROLE;

DO $t6$ BEGIN
  PERFORM pg_temp.chk('T-6a an app caller cannot set a snapshot', pg_temp.r('t6a') = 'sent_snapshot_server_only', pg_temp.r('t6a'));
  PERFORM pg_temp.chk('T-6b an app caller cannot insert one', pg_temp.r('t6b') = 'sent_snapshot_server_only', pg_temp.r('t6b'));
  PERFORM pg_temp.chk('T-6c the server''s first write lands', pg_temp.r('t6c') = 'ok'
    AND (SELECT sent_snapshot ->> 'subject' FROM public.marketing_campaigns WHERE id = pg_temp.u('c1')) = 'Hi {first_name}', pg_temp.r('t6c'));
  PERFORM pg_temp.chk('T-6d a second write is refused, even from the server', pg_temp.r('t6d') = 'sent_snapshot_immutable'
    AND (SELECT sent_snapshot ->> 'subject' FROM public.marketing_campaigns WHERE id = pg_temp.u('c1')) = 'Hi {first_name}', pg_temp.r('t6d'));
  PERFORM pg_temp.chk('T-6e a malformed snapshot is refused by the constraint', pg_temp.r('t6e') LIKE '%issue_4273_sent_snapshot_object%', pg_temp.r('t6e'));
END $t6$;

-- ── T-7 / T-8 / T-9 the group view ──────────────────────────────────────────
SET LOCAL ROLE authenticated;
DO $a$ DECLARE v jsonb; BEGIN
  v := public.biz_marketing_campaign_group_view_v1(pg_temp.u('c2'));
  PERFORM set_config('t4273s.t7', v::text, true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.t7', 'ERR:' || SQLSTATE || ':' || SQLERRM, true); END $a$;
SELECT set_config('request.jwt.claim.sub', pg_temp.u('02')::text, true),
       set_config('request.jwt.claims', json_build_object('sub', pg_temp.u('02'), 'role', 'authenticated')::text, true);
DO $a$ DECLARE v jsonb; BEGIN
  v := public.biz_marketing_campaign_group_view_v1(pg_temp.u('c2'));
  PERFORM set_config('t4273s.t7b', v::text, true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.t7b', SQLSTATE || ':' || SQLERRM, true); END $a$;
DO $a$ DECLARE v jsonb; BEGIN
  v := public.biz_marketing_campaign_group_view_v1(pg_temp.u('99'));
  PERFORM set_config('t4273s.t7c', v::text, true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.t7c', SQLSTATE || ':' || SQLERRM, true); END $a$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', pg_temp.u('01')::text, true),
       set_config('request.jwt.claims', json_build_object('sub', pg_temp.u('01'), 'role', 'authenticated')::text, true);

DO $t7$
DECLARE v jsonb := pg_temp.r('t7')::jsonb; m jsonb; bad text;
BEGIN
  PERFORM pg_temp.chk('T-7a any member id returns all three methods, oldest first, head flagged',
    jsonb_array_length(v -> 'members') = 3
    AND v ->> 'groupId' = pg_temp.u('c1')::text
    AND v ->> 'focusCampaignId' = pg_temp.u('c2')::text
    AND (SELECT array_agg(x ->> 'channel' ORDER BY o) FROM jsonb_array_elements(v -> 'members') WITH ORDINALITY t(x, o)) = ARRAY['email', 'sms', 'push']
    AND (v -> 'members' -> 0 ->> 'isHead')::boolean AND NOT (v -> 'members' -> 1 ->> 'isHead')::boolean,
    v::text);
  PERFORM pg_temp.chk('T-7b a stranger gets campaign_not_found', pg_temp.r('t7b') = 'P0002:campaign_not_found', pg_temp.r('t7b'));
  PERFORM pg_temp.chk('T-7c a missing campaign reads the same', pg_temp.r('t7c') = 'P0002:campaign_not_found', pg_temp.r('t7c'));
  PERFORM pg_temp.chk('T-7d anon cannot execute it; authenticated can',
    NOT has_function_privilege('anon', 'public.biz_marketing_campaign_group_view_v1(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.biz_marketing_campaign_group_view_v1(uuid)', 'EXECUTE'), '');
  SELECT string_agg(DISTINCT k, ',') INTO bad FROM pg_temp.keys(v) k WHERE k ~* '(email|phone|user_id|contact)$';
  PERFORM pg_temp.chk('T-8a no key names an email, phone, user id or contact', bad IS NULL, bad);
  PERFORM pg_temp.chk('T-8b no recipient value appears',
    v::text NOT LIKE '%+234803110420%' AND v::text NOT LIKE '%' || pg_temp.u('11')::text || '%'
    AND v::text NOT LIKE '%' || pg_temp.u('01')::text || '%', '');
  SELECT x INTO m FROM jsonb_array_elements(v -> 'members') x WHERE x ->> 'channel' = 'push';
  PERFORM pg_temp.chk('T-9a push counts come from marketing_push_messages',
    m -> 'push' = '{"queued":0,"sent":2,"failed":0,"skipped":1}'::jsonb AND m -> 'sms' = 'null'::jsonb
    AND m -> 'cost' ->> 'costKind' = 'not_metered', m::text);
  SELECT x INTO m FROM jsonb_array_elements(v -> 'members') x WHERE x ->> 'channel' = 'sms';
  PERFORM pg_temp.chk('T-9b SMS segments, accepted, held and the confirmed cost',
    m -> 'sms' = '{"segmentsSent":4,"messagesAccepted":2,"deferred":1}'::jsonb
    AND m -> 'cost' @> '{"costKind":"provider_estimate","estimatedCostMinor":412,"currency":"USD","smsSegmentCount":6}'::jsonb
    AND m -> 'push' = 'null'::jsonb, m::text);
  SELECT x INTO m FROM jsonb_array_elements(v -> 'members') x WHERE x ->> 'channel' = 'email';
  PERFORM pg_temp.chk('T-9c the email carries its snapshot and saved message; no cost on file',
    m -> 'snapshot' ->> 'from_display' = 'Lantern Room' AND m -> 'payload' ->> 'subject' = 'Hi {first_name}'
    AND m -> 'cost' = 'null'::jsonb AND v -> 'brand' = '{"name":"Lantern Room","slug":"issue-4273s-lantern","coverUrl":"https://cdn.example/cover.jpg"}'::jsonb,
    m::text || ' / ' || (v -> 'brand')::text);
END $t7$;

-- ── Xa a campaign that has started is read-only to the app ──────────────────
SET LOCAL ROLE authenticated;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET channel_payload = '{"kind":"email","subject":"Edited","body_html":"<p>Edited</p>","body_text":"Edited"}' WHERE id = pg_temp.u('c1');
  PERFORM set_config('t4273s.xa1', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa1', SQLERRM, true); END $a$;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET status = 'scheduled', scheduled_for = now() + interval '1 day' WHERE id = pg_temp.u('c2');
  PERFORM set_config('t4273s.xa2', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa2', SQLERRM, true); END $a$;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET name = 'Renamed' WHERE id = pg_temp.u('f1');
  PERFORM set_config('t4273s.xa3', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa3', SQLERRM, true); END $a$;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET status = 'cancelled' WHERE id = pg_temp.u('d2');
  PERFORM set_config('t4273s.xa4', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa4', SQLERRM, true); END $a$;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET updated_at = now() WHERE id = pg_temp.u('c1');
  PERFORM set_config('t4273s.xa5', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa5', SQLERRM, true); END $a$;
-- The app's own path on a draft: edit, a forged status, schedule, reschedule, cancel.
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET name = 'Draft edited' WHERE id = pg_temp.u('d1');
  PERFORM set_config('t4273s.xa6', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa6', SQLERRM, true); END $a$;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET status = 'sent' WHERE id = pg_temp.u('d1');
  PERFORM set_config('t4273s.xa7', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa7', SQLERRM, true); END $a$;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET recipient_count = 999 WHERE id = pg_temp.u('d1');
  PERFORM set_config('t4273s.xa8', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa8', SQLERRM, true); END $a$;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET status = 'scheduled', scheduled_for = now() + interval '1 day' WHERE id = pg_temp.u('d1');
  UPDATE public.marketing_campaigns SET scheduled_for = now() + interval '2 days' WHERE id = pg_temp.u('d1');
  UPDATE public.marketing_campaigns SET status = 'cancelled' WHERE id = pg_temp.u('d1');
  PERFORM set_config('t4273s.xa9', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa9', SQLERRM, true); END $a$;
RESET ROLE;
-- The server is not restricted: a partly sent campaign held for quiet hours
-- goes back to scheduled, and the app then cannot edit it.
SET LOCAL ROLE service_role;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET status = 'scheduled', scheduled_for = now() + interval '1 hour', sent_at = NULL WHERE id = pg_temp.u('c2');
  PERFORM set_config('t4273s.xa10', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa10', SQLERRM, true); END $a$;
UPDATE public.marketing_campaigns SET sent_snapshot = '{"v":1,"kind":"sms","wire_text":"Doors at 9\n\nReply STOP to opt out.","segments":1}' WHERE id = pg_temp.u('c2');
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET channel_payload = '{"kind":"sms","body":"Edited mid-send"}' WHERE id = pg_temp.u('c2');
  PERFORM set_config('t4273s.xa11', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa11', SQLERRM, true); END $a$;
RESET ROLE;
DO $a$ BEGIN
  SET LOCAL ROLE postgres;
  UPDATE public.marketing_campaigns SET status = 'sending' WHERE id = pg_temp.u('d2');
  PERFORM set_config('t4273s.xa12', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa12', SQLERRM, true); END $a$;
RESET ROLE;

DO $xa$ BEGIN
  PERFORM pg_temp.chk('Xa-1 a sent campaign''s text cannot change', pg_temp.r('xa1') = 'campaign_locked', pg_temp.r('xa1'));
  PERFORM pg_temp.chk('Xa-2 a sent campaign cannot be re-armed', pg_temp.r('xa2') = 'campaign_locked', pg_temp.r('xa2'));
  PERFORM pg_temp.chk('Xa-3 a failed campaign cannot be renamed', pg_temp.r('xa3') = 'campaign_locked', pg_temp.r('xa3'));
  PERFORM pg_temp.chk('Xa-4 a send already due cannot be cancelled from the app', pg_temp.r('xa4') = 'campaign_locked', pg_temp.r('xa4'));
  PERFORM pg_temp.chk('Xa-5 touching updated_at alone is accepted', pg_temp.r('xa5') = 'ok', pg_temp.r('xa5'));
  PERFORM pg_temp.chk('Xa-6 a draft still edits', pg_temp.r('xa6') = 'ok', pg_temp.r('xa6'));
  PERFORM pg_temp.chk('Xa-7 the app cannot mark a draft sent', pg_temp.r('xa7') = 'campaign_status_transition_refused', pg_temp.r('xa7'));
  PERFORM pg_temp.chk('Xa-8 the app cannot write server fields', pg_temp.r('xa8') = 'campaign_server_field', pg_temp.r('xa8'));
  PERFORM pg_temp.chk('Xa-9 schedule, reschedule and cancel still work',
    pg_temp.r('xa9') = 'ok' AND (SELECT status FROM public.marketing_campaigns WHERE id = pg_temp.u('d1')) = 'cancelled', pg_temp.r('xa9'));
  PERFORM pg_temp.chk('Xa-10 the server''s transitions are not restricted', pg_temp.r('xa10') = 'ok', pg_temp.r('xa10'));
  PERFORM pg_temp.chk('Xa-11 a partly sent campaign is read-only though scheduled', pg_temp.r('xa11') = 'campaign_locked', pg_temp.r('xa11'));
  PERFORM pg_temp.chk('Xa-12 SECURITY DEFINER functions (postgres) are not restricted', pg_temp.r('xa12') = 'ok', pg_temp.r('xa12'));
END $xa$;

-- ── Xb a failed or cancelled method frees its slot ──────────────────────────
SET LOCAL ROLE authenticated;
DO $a$ BEGIN
  INSERT INTO public.marketing_campaigns(account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id)
  VALUES (pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Again', 'push', '{"kind":"push","body":"Again"}', 'draft', pg_temp.u('c1'));
  PERFORM set_config('t4273s.xb1', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xb1', SQLSTATE, true); END $a$;
RESET ROLE;
UPDATE public.marketing_campaigns SET status = 'failed' WHERE id = pg_temp.u('c3');
SET LOCAL ROLE authenticated;
DO $a$ BEGIN
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id)
  VALUES (pg_temp.u('ab2'), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'Again', 'push', '{"kind":"push","body":"Again"}', 'draft', pg_temp.u('c1'));
  PERFORM set_config('t4273s.xb2', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xb2', SQLSTATE || ':' || SQLERRM, true); END $a$;
DO $a$ DECLARE n integer; BEGIN
  DELETE FROM public.marketing_campaigns WHERE id = pg_temp.u('f1') AND status IN ('failed', 'cancelled');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('t4273s.xb3', n::text, true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xb3', SQLSTATE, true); END $a$;
DO $a$ BEGIN
  DELETE FROM public.marketing_campaigns WHERE id = pg_temp.u('c3') AND status IN ('failed', 'cancelled');
  PERFORM set_config('t4273s.xb4', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xb4', SQLSTATE, true); END $a$;
RESET ROLE;

DO $xb$ BEGIN
  PERFORM pg_temp.chk('Xb-1 a live method still holds its slot', pg_temp.r('xb1') = '23505', pg_temp.r('xb1'));
  PERFORM pg_temp.chk('Xb-2 a failed method no longer does', pg_temp.r('xb2') = 'ok', pg_temp.r('xb2'));
  PERFORM pg_temp.chk('Xb-3 the host can delete a failed campaign with no confirmed send on record',
    pg_temp.r('xb3') = '1' AND NOT EXISTS (SELECT 1 FROM public.marketing_campaigns WHERE id = pg_temp.u('f1')), pg_temp.r('xb3'));
  -- c3 sent pushes, so the delete guard keeps it before the execution's FK does.
  PERFORM pg_temp.chk('Xb-4 a send that reached people stays on record', pg_temp.r('xb4') = '42501', pg_temp.r('xb4'));
END $xb$;

-- ── Xc / P2-1, P2-2: only an unsent campaign can be deleted ─────────────────
-- ── Xa-13/14 / P2-4: message rows lock a send that started ─────────────────
SET LOCAL ROLE authenticated;
DO $a$ BEGIN
  DELETE FROM public.marketing_campaigns WHERE id = pg_temp.u('c1');
  PERFORM set_config('t4273s.xc1', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xc1', SQLERRM, true); END $a$;
DO $a$ BEGIN
  DELETE FROM public.marketing_campaigns WHERE id = pg_temp.u('f2');
  PERFORM set_config('t4273s.xc2', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xc2', SQLERRM, true); END $a$;
DO $a$ BEGIN
  DELETE FROM public.marketing_campaigns WHERE id = pg_temp.u('f3');
  PERFORM set_config('t4273s.xc3', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xc3', SQLERRM, true); END $a$;
DO $a$ DECLARE n integer; BEGIN
  DELETE FROM public.marketing_campaigns WHERE id = pg_temp.u('d3');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('t4273s.xc4', n::text, true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xc4', SQLERRM, true); END $a$;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET channel_payload = '{"kind":"sms","body":"Edited"}' WHERE id = pg_temp.u('aa1');
  PERFORM set_config('t4273s.xa13', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa13', SQLERRM, true); END $a$;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET status = 'cancelled' WHERE id = pg_temp.u('aa1');
  PERFORM set_config('t4273s.xa14', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa14', SQLERRM, true); END $a$;
DO $a$ BEGIN
  UPDATE public.marketing_campaigns SET scheduled_for = now() + interval '3 hours' WHERE id = pg_temp.u('aa2');
  UPDATE public.marketing_campaigns SET status = 'cancelled' WHERE id = pg_temp.u('aa2');
  PERFORM set_config('t4273s.xa15', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xa15', SQLERRM, true); END $a$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $a$ BEGIN
  -- The server's own quiet-hours path: a held send goes back to scheduled and resumes.
  UPDATE public.marketing_campaigns SET status = 'sending' WHERE id = pg_temp.u('aa1');
  UPDATE public.marketing_campaigns SET status = 'scheduled', scheduled_for = now() + interval '1 hour' WHERE id = pg_temp.u('aa1');
  DELETE FROM public.marketing_campaigns WHERE id = pg_temp.u('f3');
  PERFORM set_config('t4273s.xc5', 'ok', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('t4273s.xc5', SQLERRM, true); END $a$;
RESET ROLE;

DO $xc$ BEGIN
  PERFORM pg_temp.chk('Xc-1 (P2-1) a sent campaign cannot be deleted by the app', pg_temp.r('xc1') = 'campaign_kept_for_records'
    AND EXISTS (SELECT 1 FROM public.marketing_campaigns WHERE id = pg_temp.u('c1')), pg_temp.r('xc1'));
  PERFORM pg_temp.chk('Xc-2 (P2-2) a failed campaign that partly sent stays on record', pg_temp.r('xc2') = 'campaign_kept_for_records'
    AND (SELECT count(*) FROM public.marketing_messages WHERE campaign_id = pg_temp.u('f2')) = 2, pg_temp.r('xc2'));
  PERFORM pg_temp.chk('Xc-3 (P2-2) a failed campaign the server counted as reached stays on record', pg_temp.r('xc3') = 'campaign_kept_for_records', pg_temp.r('xc3'));
  PERFORM pg_temp.chk('Xc-4 a draft still deletes', pg_temp.r('xc4') = '1', pg_temp.r('xc4'));
  PERFORM pg_temp.chk('Xc-5 the server is not restricted (quiet-hours resume, delete)', pg_temp.r('xc5') = 'ok', pg_temp.r('xc5'));
  PERFORM pg_temp.chk('Xa-13 (P2-4) a future send with a message row and no snapshot is read-only', pg_temp.r('xa13') = 'campaign_locked', pg_temp.r('xa13'));
  PERFORM pg_temp.chk('Xa-14 (P2-4) and cannot be cancelled from the app', pg_temp.r('xa14') = 'campaign_locked', pg_temp.r('xa14'));
  PERFORM pg_temp.chk('Xa-15 a send held entirely for quiet hours can still be moved or cancelled', pg_temp.r('xa15') = 'ok', pg_temp.r('xa15'));
END $xc$;

DO $r$ DECLARE v text; BEGIN SELECT string_agg(line, E'\n') INTO v FROM t4273s_fail;
  IF v IS NOT NULL THEN RAISE EXCEPTION E'#4273 sent snapshot / group view FAIL:\n%', v; END IF;
  RAISE NOTICE '#4273 sent snapshot / group view: PASS'; END $r$;
ROLLBACK;
