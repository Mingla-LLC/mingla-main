-- #4273 retest, tester adversarial — goes around the rework's fixes rather than
-- re-running them: the side channel through every Host read the rework added, an
-- identity email that is not the account's main email, the masked read as an
-- outsider, opt-outs as a Host, and the restored reclaim.
--
-- Every check runs and records; the suite fails at the end with the whole list.
--
-- MINGLA-INVARIANT: I-4273-HOST-TOTALS-BLIND-TO-CONTACT-MATCH | issue #4273 | Typing a graph-only person's contact into an unlinked Book row changes no Host-readable figure about Followers or Friends of followers before the send.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1', 'manual_contact_groups_v1',
  'brand_circle_followers_v1', 'brand_circle_followers_email_v1', 'brand_circle_followers_sms_v1',
  'brand_circle_extended_v1', 'brand_circle_extended_email_v1', 'brand_circle_extended_sms_v1',
  'brand_circle_extended_controls_ios_v1', 'brand_circle_extended_controls_android_v1');

-- The email arm reads auth.identities, which this image's stub lacks.
CREATE TABLE IF NOT EXISTS auth.identities(user_id uuid, provider text, identity_data jsonb);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
GRANT SELECT ON auth.identities TO service_role;

-- 01 owner; 02 another brand's owner; 03 marketing manager; 04 scanner.
-- 11 follower F1; 12 follower F2 (muted); 13 follower F3 (blocked the host);
-- 14 friend of follower X; 15 follower G whose verified identity email is not
-- the account's main email, muted.
INSERT INTO auth.users(id, email) VALUES
  ('4273b000-0000-4000-8000-000000000001', 'owner-r4273@example.test'),
  ('4273b000-0000-4000-8000-000000000002', 'out-r4273@example.test'),
  ('4273b000-0000-4000-8000-000000000003', 'mm-r4273@example.test'),
  ('4273b000-0000-4000-8000-000000000004', 'scan-r4273@example.test'),
  ('4273b000-0000-4000-8000-000000000011', 'f1-r4273@example.test'),
  ('4273b000-0000-4000-8000-000000000012', 'f2-r4273@example.test'),
  ('4273b000-0000-4000-8000-000000000013', 'f3-r4273@example.test'),
  ('4273b000-0000-4000-8000-000000000014', 'x-r4273@example.test'),
  ('4273b000-0000-4000-8000-000000000015', 'g-main-r4273@example.test');
INSERT INTO auth.identities(user_id, provider, identity_data)
SELECT u.id, 'email', jsonb_build_object('email', u.email)
  FROM auth.users u WHERE u.id::text LIKE '4273b000-0000-4000-8000-00000000001%';
INSERT INTO auth.identities(user_id, provider, identity_data) VALUES
  ('4273b000-0000-4000-8000-000000000015', 'google',
   '{"email":"g-alt-r4273@example.test","email_verified":true}'),
  -- Never proved: must not match anyone, must not block the address.
  ('4273b000-0000-4000-8000-000000000015', 'google',
   '{"email":"g-unverified-r4273@example.test","email_verified":false}'),
  ('4273b000-0000-4000-8000-000000000013', 'github',
   '{"email":"h-unverified-r4273@example.test"}');
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
  ('4273b000-0000-4000-8000-000000000011', '+12025557111'),
  ('4273b000-0000-4000-8000-000000000012', '+12025557112'),
  ('4273b000-0000-4000-8000-000000000013', '+12025557113'),
  ('4273b000-0000-4000-8000-000000000014', '+12025557114');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('4273b000-0000-4000-8000-000000000001', 'owner-r4273@example.test'),
  ('4273b000-0000-4000-8000-000000000002', 'out-r4273@example.test'),
  ('4273b000-0000-4000-8000-000000000003', 'mm-r4273@example.test'),
  ('4273b000-0000-4000-8000-000000000004', 'scan-r4273@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('4273b000-0000-4000-8000-0000000000b1', '4273b000-0000-4000-8000-000000000001', 'Retest', 'issue-4273b-retest', 'USD', now(), now()),
  ('4273b000-0000-4000-8000-0000000000b2', '4273b000-0000-4000-8000-000000000002', 'Other', 'issue-4273b-other', 'USD', now(), now());
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
  ('4273b000-0000-4000-8000-0000000000b1', '4273b000-0000-4000-8000-000000000003', 'marketing_manager', now()),
  ('4273b000-0000-4000-8000-0000000000b1', '4273b000-0000-4000-8000-000000000004', 'scanner', now());
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode)
SELECT u.id, 'P', 'P' || right(u.id::text, 2), 'r4273-' || right(u.id::text, 2), true, true, 'friends'
  FROM auth.users u WHERE u.id::text LIKE '4273b000-0000-4000-8000-00000000001%';
INSERT INTO public.brand_follows(user_id, brand_id, muted_until) VALUES
  ('4273b000-0000-4000-8000-000000000011', '4273b000-0000-4000-8000-0000000000b1', NULL),
  ('4273b000-0000-4000-8000-000000000012', '4273b000-0000-4000-8000-0000000000b1', 'infinity'),
  ('4273b000-0000-4000-8000-000000000013', '4273b000-0000-4000-8000-0000000000b1', NULL),
  ('4273b000-0000-4000-8000-000000000015', '4273b000-0000-4000-8000-0000000000b1', 'infinity');
INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
  ('4273b000-0000-4000-8000-000000000011', '4273b000-0000-4000-8000-000000000014', 'accepted');
INSERT INTO public.brand_circle_preferences(user_id, extended_brand_reach_enabled, extended_brand_reach_decided_at)
VALUES ('4273b000-0000-4000-8000-000000000014', true, now());
INSERT INTO public.blocked_users(blocker_id, blocked_id)
VALUES ('4273b000-0000-4000-8000-000000000013', '4273b000-0000-4000-8000-000000000001');
INSERT INTO public.brand_people(id, brand_id, display_name, record_status) VALUES
  ('4273b000-2000-4000-8000-000000000001', '4273b000-0000-4000-8000-0000000000b1', 'Control', 'active');
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state) VALUES
  ('4273b000-0000-4000-8000-0000000000b1', '4273b000-2000-4000-8000-000000000001', 'phone', '+12025558201', 'brand_owned', true, true, 'active');
SELECT public.issue_1777_refresh_brand_reach('4273b000-0000-4000-8000-0000000000b1', 'follower');
SELECT public.issue_1777_refresh_brand_reach('4273b000-0000-4000-8000-0000000000b1', 'extended');
SELECT set_config('request.jwt.claim.sub', '4273b000-0000-4000-8000-000000000001', true);

CREATE TEMP TABLE r4273_fail(id serial, line text) ON COMMIT DROP;
GRANT ALL ON r4273_fail TO authenticated;
GRANT ALL ON SEQUENCE r4273_fail_id_seq TO authenticated;
CREATE TEMP TABLE r4273_probe(k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO r4273_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;
CREATE FUNCTION pg_temp.snap(p_env jsonb) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'quoteVersion', 1, 'quoteHash', repeat('a', 64), 'contentHash', repeat('b', 64),
    'quotedAt', now(), 'brandId', p_env -> 'brandId', 'content', p_env -> 'content',
    'audienceId', p_env -> 'audienceId', 'audienceKind', p_env -> 'audienceKind',
    'audienceVersion', p_env -> 'audienceVersion', 'selectedCount', p_env -> 'selectedCount',
    'reachableCount', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                        WHERE (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL),
    'suppressedCount', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                         WHERE NOT (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL),
    'unavailableCount', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                          WHERE x ->> 'normalizedContact' IS NULL),
    'smsSegments', 0, 'costKind', 'not_metered', 'estimatedCostMinor', NULL, 'currency', NULL,
    'candidates', p_env -> 'candidates')
$f$;
CREATE FUNCTION pg_temp.draft(p_id uuid, p_audience uuid, p_channel text) RETURNS uuid LANGUAGE sql AS $f$
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (p_id, '4273b000-0000-4000-8000-000000000001', '4273b000-0000-4000-8000-0000000000b1', p_audience, 'R ' || p_channel, p_channel,
    CASE p_channel WHEN 'sms' THEN '{"kind":"sms","body":"Doors at 9."}'::jsonb
      ELSE '{"kind":"email","subject":"Hi","body_html":"Hi","body_text":"Hi"}'::jsonb END, 'draft')
  RETURNING id
$f$;
-- Everything a Host can read about a source set, before any send.
CREATE FUNCTION pg_temp.host_view(p_sources jsonb) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'followerRow', (SELECT x FROM jsonb_array_elements(s -> 'sources') x WHERE x ->> 'key' = 'followers'),
    'extendedRow', (SELECT x FROM jsonb_array_elements(s -> 'sources') x WHERE x ->> 'key' = 'extended'),
    'followersTotal', s -> 'followersTotal', 'followersAlsoInBook', s -> 'followersAlsoInBook',
    'peopleMinusBook', (s ->> 'peopleCount')::int -
      (SELECT (x ->> 'count')::int FROM jsonb_array_elements(s -> 'sources') x WHERE x ->> 'key' = 'book'),
    'smsMinusBook', public.biz_marketing_combined_audience_reach_v1(
        '4273b000-0000-4000-8000-000000000001', '4273b000-0000-4000-8000-0000000000b1', p_sources, 'sms')
      - public.biz_marketing_combined_audience_reach_v1(
        '4273b000-0000-4000-8000-000000000001', '4273b000-0000-4000-8000-0000000000b1', '["book"]', 'sms'))
  FROM (SELECT public.biz_marketing_combined_audience_summary_v1(
    '4273b000-0000-4000-8000-000000000001', '4273b000-0000-4000-8000-0000000000b1', p_sources) AS s) q
$f$;

DO $cases$
DECLARE
  v_owner uuid := '4273b000-0000-4000-8000-000000000001';
  v_mm uuid := '4273b000-0000-4000-8000-000000000003';
  v_scan uuid := '4273b000-0000-4000-8000-000000000004';
  v_brand uuid := '4273b000-0000-4000-8000-0000000000b1';
  v_all jsonb := '["book","followers","extended"]';
  v_before jsonb; v_after jsonb; v_aud uuid; v_id uuid; v_env jsonb; v_send jsonb; v_state text;
  v_used jsonb; v_used2 jsonb; v_n integer; v_exec uuid;
BEGIN
  -- ── Side channel: a typed contact changes nothing about graph-only people ──
  v_before := pg_temp.host_view(v_all);
  INSERT INTO public.brand_people(id, brand_id, display_name, record_status) VALUES
    ('4273b000-2000-4000-8000-000000000002', v_brand, 'Probe F1', 'active'),
    ('4273b000-2000-4000-8000-000000000003', v_brand, 'Probe muted F2', 'active'),
    ('4273b000-2000-4000-8000-000000000004', v_brand, 'Probe blocked F3', 'active'),
    ('4273b000-2000-4000-8000-000000000005', v_brand, 'Probe friend X', 'active'),
    ('4273b000-2000-4000-8000-000000000006', v_brand, 'Probe F1 email', 'active'),
    ('4273b000-2000-4000-8000-000000000007', v_brand, 'Probe alt email of muted G', 'active'),
    ('4273b000-2000-4000-8000-000000000008', v_brand, 'Holds an unverified email of muted G', 'active'),
    ('4273b000-2000-4000-8000-000000000009', v_brand, 'Holds an unverified email of a blocker', 'active');
  INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state) VALUES
    (v_brand, '4273b000-2000-4000-8000-000000000002', 'phone', '+12025557111', 'brand_owned', true, true, 'active'),
    (v_brand, '4273b000-2000-4000-8000-000000000003', 'phone', '+12025557112', 'brand_owned', true, true, 'active'),
    (v_brand, '4273b000-2000-4000-8000-000000000004', 'phone', '+12025557113', 'brand_owned', true, true, 'active'),
    (v_brand, '4273b000-2000-4000-8000-000000000005', 'phone', '+12025557114', 'brand_owned', true, true, 'active'),
    (v_brand, '4273b000-2000-4000-8000-000000000006', 'email', 'f1-r4273@example.test', 'brand_owned', true, true, 'active'),
    (v_brand, '4273b000-2000-4000-8000-000000000007', 'email', 'g-alt-r4273@example.test', 'brand_owned', true, true, 'active'),
    (v_brand, '4273b000-2000-4000-8000-000000000008', 'email', 'g-unverified-r4273@example.test', 'brand_owned', true, true, 'active'),
    (v_brand, '4273b000-2000-4000-8000-000000000009', 'email', 'h-unverified-r4273@example.test', 'brand_owned', true, true, 'active');
  PERFORM public.issue_1777_refresh_brand_reach(v_brand, 'follower');
  PERFORM public.issue_1777_refresh_brand_reach(v_brand, 'extended');
  v_after := pg_temp.host_view(v_all);
  PERFORM pg_temp.chk('R-01 typed contacts change no Host figure about followers or friends',
    v_after -> 'followerRow' = v_before -> 'followerRow'
    AND v_after -> 'extendedRow' = v_before -> 'extendedRow'
    AND v_after -> 'followersTotal' = v_before -> 'followersTotal'
    AND v_after -> 'followersAlsoInBook' = v_before -> 'followersAlsoInBook'
    AND v_after -> 'peopleMinusBook' = v_before -> 'peopleMinusBook',
    v_before::text || ' -> ' || v_after::text);
  -- The reach delta moves only by the probe rows the Book itself now reaches:
  -- it must not differ between a probe that is a stranger and one that is muted.
  PERFORM pg_temp.chk('R-02 SMS reach beyond the Book does not move with typed contacts',
    v_after -> 'smsMinusBook' = v_before -> 'smsMinusBook', v_before::text || ' -> ' || v_after::text);

  v_aud := (public.biz_get_or_create_marketing_combined_audience_v1(v_owner, v_brand, v_all) ->> 'audienceId')::uuid;
  v_id := pg_temp.draft('4273b000-3000-4000-8000-000000000001', v_aud, 'sms');
  v_env := public.biz_marketing_combined_quote_candidates_v1(v_owner, v_id);
  PERFORM pg_temp.chk('R-03 the quote shows a muted follower''s phone as allowed on its Book row, as a stranger''s would be',
    v_env -> 'candidates' @> '[{"normalizedContact":"+12025557112","allowed":true,"targetBrandPersonId":"4273b000-2000-4000-8000-000000000003"}]'::jsonb, v_env::text);

  -- ── Send: strictest per person, through the Book row ──────────────────────
  PERFORM public.biz_confirm_marketing_combined_send_v1(v_owner, v_id,
    '4273b000-4000-4000-8000-000000000001', pg_temp.snap(v_env), now() + interval '1 hour');
  v_send := public.biz_marketing_combined_send_audience_v1(v_id);
  PERFORM pg_temp.chk('R-04 muted and blocking followers are not texted through a Book row',
    NOT (v_send -> 'rows' @> '[{"raw_phone":"+12025557112"}]'::jsonb)
    AND NOT (v_send -> 'rows' @> '[{"raw_phone":"+12025557113"}]'::jsonb), v_send::text);
  PERFORM pg_temp.chk('R-05 a phone on both a Book row and a follower goes out once',
    (SELECT count(*) FROM jsonb_array_elements(v_send -> 'rows') x WHERE x ->> 'raw_phone' = '+12025557111') = 1, v_send::text);

  -- An account's verified identity email can differ from auth.users.email: the
  -- identity rule itself reads identities, so the contact match must too.
  v_id := pg_temp.draft('4273b000-3000-4000-8000-000000000002', v_aud, 'email');
  v_env := public.biz_marketing_combined_quote_candidates_v1(v_owner, v_id);
  PERFORM public.biz_confirm_marketing_combined_send_v1(v_owner, v_id,
    '4273b000-4000-4000-8000-000000000002', pg_temp.snap(v_env), now() + interval '1 hour');
  v_send := public.biz_marketing_combined_send_audience_v1(v_id);
  PERFORM pg_temp.chk('R-06 a muted account is matched by its verified identity email, not only its main email',
    NOT (v_send -> 'rows' @> '[{"raw_email":"g-alt-r4273@example.test"}]'::jsonb),
    'still emails g-alt-r4273@example.test');
  PERFORM pg_temp.chk('R-06b an unverified identity email blocks nobody and matches nobody',
    v_send -> 'rows' @> '[{"raw_email":"g-unverified-r4273@example.test"},{"raw_email":"h-unverified-r4273@example.test"}]'::jsonb,
    v_send::text);
  v_exec := (SELECT e.id FROM public.marketing_book_send_executions e WHERE e.campaign_id = v_id);

  -- Per method: a STOP on a phone does not stop the email of the same person.
  INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
  VALUES (NULL, '+12025557111', 'sms', 'marketing', 'stop_keyword');
  v_send := public.biz_marketing_combined_send_audience_v1(v_id);
  PERFORM pg_temp.chk('R-07 STOP on SMS leaves the email of that person',
    v_send -> 'rows' @> '[{"raw_email":"f1-r4273@example.test"}]'::jsonb, v_send::text);
  DELETE FROM public.channel_suppressions WHERE contact = '+12025557111';

  -- An opted-out Book contact is never messaged, global or brand, or by a
  -- suppression on the Book row itself.
  INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, brand_id)
  VALUES ('f1-r4273@example.test', 'email', 'brand', v_brand);
  v_send := public.biz_marketing_combined_send_audience_v1(v_id);
  PERFORM pg_temp.chk('R-08 an unsubscribed Book email is not messaged after confirm',
    NOT (v_send -> 'rows' @> '[{"raw_email":"f1-r4273@example.test"}]'::jsonb), v_send::text);
  DELETE FROM public.marketing_unsubscribes WHERE contact_email = 'f1-r4273@example.test';

  -- ── Roles on the new reads ────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_mm::text, true);
  v_state := NULL;
  BEGIN
    PERFORM public.biz_marketing_combined_audience_reach_v1(v_mm, v_brand, '["book","followers"]', 'sms');
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('R-09 a marketing manager gets no Book reach through the new read', v_state = '42501', COALESCE(v_state, 'accepted'));
  v_state := NULL;
  BEGIN
    PERFORM public.biz_marketing_combined_quote_candidates_v1(v_mm, '4273b000-3000-4000-8000-000000000001');
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('R-10 nor a Book quote', v_state = '42501', COALESCE(v_state, 'accepted'));
  v_state := NULL;
  BEGIN
    PERFORM public.biz_marketing_combined_audience_summary_v1(v_mm, v_brand, '["book","followers"]');
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('R-11 nor Book totals through the summary', v_state = '42501', COALESCE(v_state, 'accepted'));
  PERFORM set_config('request.jwt.claim.sub', v_scan::text, true);
  v_state := NULL;
  BEGIN
    PERFORM public.biz_marketing_combined_audience_summary_v1(v_scan, v_brand, '[]');
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('R-12 a scanner reads no follower totals', v_state = '42501', COALESCE(v_state, 'accepted'));
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  -- ── Reclaim ───────────────────────────────────────────────────────────────
  v_id := '4273b000-3000-4000-8000-000000000001';
  v_used := public.biz_brand_blast_usage_v1(v_owner, v_brand);
  UPDATE public.marketing_campaigns SET status = 'sending', updated_at = now() - interval '9 minutes' WHERE id = v_id;
  PERFORM pg_temp.chk('R-13 a run inside the window is not stolen',
    NOT EXISTS (SELECT 1 FROM public.mkt_claim_campaigns(50, v_id)), '');
  UPDATE public.marketing_campaigns SET updated_at = now() - interval '11 minutes' WHERE id = v_id;
  v_n := (SELECT count(*) FROM public.mkt_claim_campaigns(50, v_id));
  PERFORM pg_temp.chk('R-14 a dead run is reclaimed once', v_n = 1, 'claimed ' || v_n);
  PERFORM pg_temp.chk('R-15 the same claim right after takes nothing',
    NOT EXISTS (SELECT 1 FROM public.mkt_claim_campaigns(50, v_id)), '');
  v_used2 := public.biz_brand_blast_usage_v1(v_owner, v_brand);
  PERFORM pg_temp.chk('R-16 reclaim counts nothing twice', v_used2 = v_used, v_used::text || ' -> ' || v_used2::text);
  PERFORM pg_temp.chk('R-17 reclaim leaves one sealed execution',
    (SELECT count(*) FROM public.marketing_book_send_executions e WHERE e.campaign_id = v_id) = 1, '');
  UPDATE public.marketing_campaigns SET status = 'sending', updated_at = now() - interval '11 minutes'
   WHERE id = '4273b000-3000-4000-8000-000000000002';
  v_id := pg_temp.draft('4273b000-3000-4000-8000-000000000003', v_aud, 'sms');
  UPDATE public.marketing_campaigns SET updated_at = now() - interval '1 hour' WHERE id = v_id;
  PERFORM pg_temp.chk('R-18 an unsealed combined draft is not claimed',
    NOT EXISTS (SELECT 1 FROM public.mkt_claim_campaigns(50, v_id)), '');

  -- ── Rows the dispatcher would write, for the Host reads below ─────────────
  INSERT INTO public.marketing_messages(id, campaign_id, recipient_phone, channel, status, failure_reason) VALUES
    ('4273b000-5000-4000-8000-000000000001', '4273b000-3000-4000-8000-000000000001', '+12025558201', 'sms', 'sent', NULL),
    ('4273b000-5000-4000-8000-000000000002', '4273b000-3000-4000-8000-000000000001', '+12025557199', 'sms', 'failed', 'carrier said +12025557199 is gone');
  -- A follower-only email campaign row: no Book row holds this address.
  INSERT INTO public.brand_people(id, brand_id, display_name, record_status) VALUES
    ('4273b000-2000-4000-8000-0000000000f1', '4273b000-0000-4000-8000-0000000000b2', 'Other brand row', 'active');
  INSERT INTO public.marketing_unsubscribes(contact_email, contact_phone, channel, scope, brand_id) VALUES
    ('stranger-r4273@example.test', NULL, 'email', 'global', NULL),
    ('out-only-r4273@example.test', NULL, 'email', 'brand', '4273b000-0000-4000-8000-0000000000b2'),
    ('f1-r4273@example.test', NULL, 'email', 'global', NULL);
END;
$cases$;

SELECT set_config('request.jwt.claims', '{"sub":"4273b000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $host$
DECLARE v_rows jsonb; v_n integer; v_state text;
BEGIN
  SELECT jsonb_agg(to_jsonb(m)) INTO v_rows FROM public.biz_marketing_campaign_messages_v1(
    ARRAY['4273b000-3000-4000-8000-000000000001']::uuid[]) m;
  PERFORM pg_temp.chk('C-05 the masked read keeps both rows', jsonb_array_length(v_rows) = 2, COALESCE(v_rows::text, 'none'));
  PERFORM pg_temp.chk('C-06 no contact of a circle-only row in any field, provider text included',
    v_rows::text !~ '12025557199', v_rows::text);
  SELECT count(*) INTO v_n FROM public.marketing_messages m WHERE m.recipient_phone = '+12025557199';
  PERFORM pg_temp.chk('C-07 the raw table hides that row', v_n = 0, 'visible');
  SELECT count(*) INTO v_n FROM public.marketing_messages m WHERE m.recipient_phone = '+12025558201';
  PERFORM pg_temp.chk('C-08 the brand''s own Book row stays visible on the raw table', v_n = 1, 'hidden');
  PERFORM pg_temp.chk('C-09 unsubscribes: the Host reads an opt-out for a contact it holds',
    EXISTS (SELECT 1 FROM public.marketing_unsubscribes u WHERE u.contact_email = 'f1-r4273@example.test'), 'hidden');
  PERFORM pg_temp.chk('C-10 but not one for a stranger, or another brand''s',
    NOT EXISTS (SELECT 1 FROM public.marketing_unsubscribes u
                 WHERE u.contact_email IN ('stranger-r4273@example.test', 'out-only-r4273@example.test')), 'visible');
  BEGIN
    PERFORM public.biz_marketing_combined_hidden_skips_v1('4273b000-3000-4000-8000-000000000001');
    PERFORM pg_temp.chk('C-11 the Host cannot read the hidden-skip count', false, 'callable');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.marketing_combined_send_skips LIMIT 1;
    PERFORM pg_temp.chk('C-12 the Host cannot read the skip reasons', false, 'readable');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_4273_send_verdict('4273b000-0000-4000-8000-000000000001', '4273b000-0000-4000-8000-0000000000b1',
      'sms', '+12025557112', NULL, NULL, NULL);
    PERFORM pg_temp.chk('C-13 the Host cannot call the send verdict as an oracle', false, 'callable');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$host$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '4273b000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"4273b000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $out$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.biz_marketing_campaign_messages_v1(
    ARRAY['4273b000-3000-4000-8000-000000000001']::uuid[]) m;
  PERFORM pg_temp.chk('C-14 another brand''s owner reads no message rows', v_n = 0, 'read ' || v_n);
  SELECT count(*) INTO v_n FROM public.marketing_messages m WHERE m.campaign_id = '4273b000-3000-4000-8000-000000000001';
  PERFORM pg_temp.chk('C-15 nor from the table', v_n = 0, 'read ' || v_n);
  PERFORM pg_temp.chk('C-16 an outsider gets false from the contact check',
    public.issue_4273_host_may_read_message_contact('4273b000-3000-4000-8000-000000000001', '+12025558201', NULL) IS NOT TRUE, 'true');
END;
$out$;
RESET ROLE;

DO $report$
DECLARE v text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY id) INTO v FROM r4273_fail;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION E'#4273 retest adversarial FAIL:\n%', v;
  END IF;
END;
$report$;

ROLLBACK;
