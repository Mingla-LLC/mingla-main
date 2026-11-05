-- #4273 tester adversarial — the combined Blast, attacked where the implementor's
-- suite does not look: one person eligible by one identity and blocked by
-- another (at quote AND at send), buyers whose orders disagree, people who share
-- a phone, role and brand boundaries, older lanes pointed at a combined audience,
-- caps on one method, and what the Host can read back after the send.
--
-- Every check runs and records; the suite fails at the end with the whole list,
-- so one defect cannot hide the next.
--
-- MINGLA-INVARIANT: I-4273-STRICTEST-IDENTITY-AT-SEND | issue #4273 | A person blocked by any identity at quote or at send time is not messaged by a combined Blast, whichever identity sealed them.
-- MINGLA-INVARIANT: I-4273-GRAPH-CONTACT-NEVER-REACHES-HOST | issue #4273 | No Host-callable read returns a contact the brand did not itself hold for a person reached only through followers or friends of followers.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1', 'manual_contact_groups_v1',
  'brand_circle_followers_v1', 'brand_circle_followers_email_v1', 'brand_circle_followers_sms_v1',
  'brand_circle_extended_v1', 'brand_circle_extended_email_v1', 'brand_circle_extended_sms_v1',
  'brand_circle_extended_controls_ios_v1', 'brand_circle_extended_controls_android_v1');

-- 01 owner; 02 outsider (other brand); 03 marketing manager (rank below the
-- event manager the Book lane requires).
-- 11 V1 follower; 12 V2 muted follower; 13 V3 follower who blocked the host;
-- 14 V4 follower; 15 V5 follower who mutes after confirm; 16 V6 follower linked
-- to a Book row with another phone; 17 X friend of follower (opted in).
INSERT INTO auth.users(id, email) VALUES
  ('4273a000-0000-4000-8000-000000000001', 'owner-a4273@example.test'),
  ('4273a000-0000-4000-8000-000000000002', 'out-a4273@example.test'),
  ('4273a000-0000-4000-8000-000000000003', 'em-a4273@example.test'),
  ('4273a000-0000-4000-8000-000000000011', 'v1-a4273@example.test'),
  ('4273a000-0000-4000-8000-000000000012', 'v2-a4273@example.test'),
  ('4273a000-0000-4000-8000-000000000013', 'v3-a4273@example.test'),
  ('4273a000-0000-4000-8000-000000000014', 'v4-a4273@example.test'),
  ('4273a000-0000-4000-8000-000000000015', 'v5-a4273@example.test'),
  ('4273a000-0000-4000-8000-000000000016', 'v6-a4273@example.test'),
  ('4273a000-0000-4000-8000-000000000017', 'x-a4273@example.test');
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
  ('4273a000-0000-4000-8000-000000000011', '+12025557011'),
  ('4273a000-0000-4000-8000-000000000012', '+12025557012'),
  ('4273a000-0000-4000-8000-000000000013', '+12025557013'),
  ('4273a000-0000-4000-8000-000000000014', '+12025557014'),
  ('4273a000-0000-4000-8000-000000000015', '+12025557015'),
  ('4273a000-0000-4000-8000-000000000016', '+12025557016'),
  ('4273a000-0000-4000-8000-000000000017', '+12025557017');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('4273a000-0000-4000-8000-000000000001', 'owner-a4273@example.test'),
  ('4273a000-0000-4000-8000-000000000002', 'out-a4273@example.test'),
  ('4273a000-0000-4000-8000-000000000003', 'em-a4273@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('4273a000-0000-4000-8000-0000000000b1', '4273a000-0000-4000-8000-000000000001', 'Attack', 'issue-4273a-attack', 'USD', now(), now()),
  ('4273a000-0000-4000-8000-0000000000b2', '4273a000-0000-4000-8000-000000000002', 'Other', 'issue-4273a-other', 'USD', now(), now());
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
VALUES ('4273a000-0000-4000-8000-0000000000b1', '4273a000-0000-4000-8000-000000000003', 'marketing_manager', now());
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode)
SELECT u.id, 'P' || right(u.id::text, 2), 'P' || right(u.id::text, 2), 'a4273-' || right(u.id::text, 2), true, true, 'friends'
  FROM auth.users u WHERE u.id::text LIKE '4273a000-0000-4000-8000-00000000001%';
INSERT INTO public.brand_follows(user_id, brand_id, muted_until) VALUES
  ('4273a000-0000-4000-8000-000000000011', '4273a000-0000-4000-8000-0000000000b1', NULL),
  ('4273a000-0000-4000-8000-000000000012', '4273a000-0000-4000-8000-0000000000b1', 'infinity'),
  ('4273a000-0000-4000-8000-000000000013', '4273a000-0000-4000-8000-0000000000b1', NULL),
  ('4273a000-0000-4000-8000-000000000014', '4273a000-0000-4000-8000-0000000000b1', NULL),
  ('4273a000-0000-4000-8000-000000000015', '4273a000-0000-4000-8000-0000000000b1', NULL),
  ('4273a000-0000-4000-8000-000000000016', '4273a000-0000-4000-8000-0000000000b1', NULL);
INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
  ('4273a000-0000-4000-8000-000000000011', '4273a000-0000-4000-8000-000000000017', 'accepted');
INSERT INTO public.brand_circle_preferences(user_id, extended_brand_reach_enabled, extended_brand_reach_decided_at)
VALUES ('4273a000-0000-4000-8000-000000000017', true, now());
INSERT INTO public.blocked_users(blocker_id, blocked_id)
VALUES ('4273a000-0000-4000-8000-000000000013', '4273a000-0000-4000-8000-000000000001');

-- Book rows the host typed. None is linked to an account except P6.
INSERT INTO public.brand_people(id, brand_id, linked_user_id, display_name, record_status) VALUES
  ('4273a000-2000-4000-8000-000000000001', '4273a000-0000-4000-8000-0000000000b1', NULL, 'Cara control', 'active'),
  ('4273a000-2000-4000-8000-000000000002', '4273a000-0000-4000-8000-0000000000b1', NULL, 'Probe V1', 'active'),
  ('4273a000-2000-4000-8000-000000000003', '4273a000-0000-4000-8000-0000000000b1', NULL, 'Probe muted V2', 'active'),
  ('4273a000-2000-4000-8000-000000000004', '4273a000-0000-4000-8000-0000000000b1', NULL, 'Probe blocked V3', 'active'),
  ('4273a000-2000-4000-8000-000000000005', '4273a000-0000-4000-8000-0000000000b1', NULL, 'Withheld V4', 'active'),
  ('4273a000-2000-4000-8000-000000000006', '4273a000-0000-4000-8000-0000000000b1', NULL, 'Late mute V5', 'active'),
  ('4273a000-2000-4000-8000-000000000007', '4273a000-0000-4000-8000-0000000000b1', '4273a000-0000-4000-8000-000000000016', 'Linked V6', 'active'),
  ('4273a000-2000-4000-8000-000000000008', '4273a000-0000-4000-8000-0000000000b1', NULL, 'Family one', 'active'),
  ('4273a000-2000-4000-8000-000000000009', '4273a000-0000-4000-8000-0000000000b1', NULL, 'Family two', 'active');
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state, marketing_consent_state) VALUES
  ('4273a000-0000-4000-8000-0000000000b1', '4273a000-2000-4000-8000-000000000001', 'phone', '+12025558001', 'brand_owned', true, true, 'active', 'unknown'),
  ('4273a000-0000-4000-8000-0000000000b1', '4273a000-2000-4000-8000-000000000002', 'phone', '+12025557011', 'brand_owned', true, true, 'active', 'unknown'),
  ('4273a000-0000-4000-8000-0000000000b1', '4273a000-2000-4000-8000-000000000003', 'phone', '+12025557012', 'brand_owned', true, true, 'active', 'unknown'),
  ('4273a000-0000-4000-8000-0000000000b1', '4273a000-2000-4000-8000-000000000004', 'phone', '+12025557013', 'brand_owned', true, true, 'active', 'unknown'),
  ('4273a000-0000-4000-8000-0000000000b1', '4273a000-2000-4000-8000-000000000005', 'phone', '+12025557014', 'brand_owned', true, true, 'active', 'withheld'),
  ('4273a000-0000-4000-8000-0000000000b1', '4273a000-2000-4000-8000-000000000006', 'phone', '+12025557015', 'brand_owned', true, true, 'active', 'unknown'),
  ('4273a000-0000-4000-8000-0000000000b1', '4273a000-2000-4000-8000-000000000007', 'phone', '+12025558007', 'brand_owned', true, true, 'active', 'unknown'),
  ('4273a000-0000-4000-8000-0000000000b1', '4273a000-2000-4000-8000-000000000008', 'phone', '+12025558088', 'brand_owned', true, true, 'active', 'unknown'),
  ('4273a000-0000-4000-8000-0000000000b1', '4273a000-2000-4000-8000-000000000008', 'email', 'family1@example.test', 'brand_owned', true, true, 'active', 'unknown'),
  ('4273a000-0000-4000-8000-0000000000b1', '4273a000-2000-4000-8000-000000000009', 'phone', '+12025558088', 'brand_owned', true, true, 'active', 'unknown'),
  ('4273a000-0000-4000-8000-0000000000b1', '4273a000-2000-4000-8000-000000000009', 'email', 'family2@example.test', 'brand_owned', true, true, 'active', 'unknown');

-- Buyers. Bea used one phone at Night A and a newer one at Night B; Bo's newest
-- order has no phone but an older one does.
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme) VALUES
  ('4273a000-1000-4000-8000-00000000000a', '4273a000-0000-4000-8000-0000000000b1', '4273a000-0000-4000-8000-000000000001', 'Night A', 'a4273-a', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb),
  ('4273a000-1000-4000-8000-00000000000b', '4273a000-0000-4000-8000-0000000000b1', '4273a000-0000-4000-8000-000000000001', 'Night B', 'a4273-b', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, created_at) VALUES
  ('4273a000-1100-4000-8000-000000000001', '4273a000-1000-4000-8000-00000000000a', 'bea@example.test', '+12025559001', 'Bea', 1000, 'USD', 'paid', 'legacy', now() - interval '3 days'),
  ('4273a000-1100-4000-8000-000000000002', '4273a000-1000-4000-8000-00000000000b', 'BEA@example.test', '+12025559002', 'Bea', 1000, 'USD', 'paid', 'legacy', now() - interval '1 day'),
  ('4273a000-1100-4000-8000-000000000003', '4273a000-1000-4000-8000-00000000000a', 'bo@example.test', '+12025559003', 'Bo', 1000, 'USD', 'paid', 'legacy', now() - interval '3 days'),
  ('4273a000-1100-4000-8000-000000000004', '4273a000-1000-4000-8000-00000000000a', 'bo@example.test', NULL, 'Bo', 1000, 'USD', 'paid', 'legacy', now() - interval '1 day');

SELECT public.issue_1777_refresh_brand_reach('4273a000-0000-4000-8000-0000000000b1', 'follower');
SELECT public.issue_1777_refresh_brand_reach('4273a000-0000-4000-8000-0000000000b1', 'extended');
SELECT set_config('request.jwt.claim.sub', '4273a000-0000-4000-8000-000000000001', true);

CREATE TEMP TABLE a4273_fail(id serial, line text) ON COMMIT DROP;
GRANT ALL ON a4273_fail TO authenticated;
GRANT ALL ON SEQUENCE a4273_fail_id_seq TO authenticated;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO a4273_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;
CREATE FUNCTION pg_temp.snap(p_env jsonb, p_at timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'quoteVersion', 1, 'quoteHash', repeat('a', 64), 'contentHash', repeat('b', 64),
    'quotedAt', p_at, 'brandId', p_env -> 'brandId', 'content', p_env -> 'content',
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
CREATE FUNCTION pg_temp.draft(p_id uuid, p_audience uuid, p_channel text, p_group uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $f$
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id)
  VALUES (p_id, '4273a000-0000-4000-8000-000000000001', '4273a000-0000-4000-8000-0000000000b1', p_audience, 'A ' || p_channel, p_channel,
    CASE p_channel WHEN 'sms' THEN '{"kind":"sms","body":"Doors at 9."}'::jsonb
      WHEN 'push' THEN '{"kind":"push","body":"Doors at 9.","title":"Night"}'::jsonb
      ELSE '{"kind":"email","subject":"Hi","body_html":"Hi","body_text":"Hi"}'::jsonb END, 'draft', p_group)
  RETURNING id
$f$;

DO $cases$
DECLARE
  v_owner uuid := '4273a000-0000-4000-8000-000000000001';
  v_out uuid := '4273a000-0000-4000-8000-000000000002';
  v_mm uuid := '4273a000-0000-4000-8000-000000000003';
  v_brand uuid := '4273a000-0000-4000-8000-0000000000b1';
  v_aud uuid; v_aud2 uuid; v_id uuid; v_env jsonb; v_env2 jsonb; v_send jsonb; v_sum jsonb; v_row jsonb;
  v_state text; v_n integer; v_got text;
BEGIN
  v_aud := (public.biz_get_or_create_marketing_combined_audience_v1(v_owner, v_brand, '["book","followers"]'::jsonb) ->> 'audienceId')::uuid;

  -- ── Consent: the strictest identity, at quote ────────────────────────────
  v_id := pg_temp.draft('4273a000-3000-4000-8000-000000000001', v_aud, 'sms');
  v_env := public.biz_marketing_combined_quote_candidates_v1(v_owner, v_id);

  PERFORM pg_temp.chk('A-01 muted follower stays blocked through a Book row with the same phone',
    v_env -> 'candidates' @> '[{"normalizedContact":"+12025557012","allowed":false}]'::jsonb, v_env::text);
  PERFORM pg_temp.chk('A-02 a follower who blocked the host is not messaged through a Book row with the same phone',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_env -> 'candidates') x
                 WHERE x ->> 'normalizedContact' = '+12025557013' AND (x ->> 'allowed')::boolean),
    (SELECT string_agg(x::text, ' ') FROM jsonb_array_elements(v_env -> 'candidates') x WHERE x ->> 'normalizedContact' = '+12025557013'));
  PERFORM pg_temp.chk('A-03 a contact the Book marks consent-withheld is not messaged because the same number also follows',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_env -> 'candidates') x
                 WHERE x ->> 'normalizedContact' = '+12025557014' AND (x ->> 'allowed')::boolean),
    (SELECT string_agg(x::text, ' ') FROM jsonb_array_elements(v_env -> 'candidates') x WHERE x ->> 'normalizedContact' = '+12025557014'));
  PERFORM pg_temp.chk('A-04 each phone appears once',
    (SELECT count(*) FROM jsonb_array_elements(v_env -> 'candidates') x WHERE x ->> 'normalizedContact' IS NOT NULL)
    = (SELECT count(DISTINCT x ->> 'normalizedContact') FROM jsonb_array_elements(v_env -> 'candidates') x WHERE x ->> 'normalizedContact' IS NOT NULL), v_env::text);

  -- Two Book people sharing one phone are one person for an SMS, but each has
  -- their own email. An email Blast must still reach both.
  v_aud2 := (public.biz_get_or_create_marketing_combined_audience_v1(v_owner, v_brand, '["book","followers","extended"]'::jsonb) ->> 'audienceId')::uuid;
  v_id := pg_temp.draft('4273a000-3000-4000-8000-000000000002', v_aud, 'email');
  v_env2 := public.biz_marketing_combined_quote_candidates_v1(v_owner, v_id);
  PERFORM pg_temp.chk('A-05 two Book people with their own emails and one shared phone both get the email',
    v_env2 -> 'candidates' @> '[{"normalizedContact":"family1@example.test"},{"normalizedContact":"family2@example.test"}]'::jsonb,
    (SELECT string_agg(x ->> 'normalizedContact', ',') FROM jsonb_array_elements(v_env2 -> 'candidates') x));

  -- ── Send: the sealed person is re-decided by every identity ──────────────
  v_id := '4273a000-3000-4000-8000-000000000001';
  PERFORM public.biz_confirm_marketing_combined_send_v1(v_owner, v_id,
    '4273a000-4000-4000-8000-000000000001', pg_temp.snap(v_env), now() + interval '1 hour');
  v_send := public.biz_marketing_combined_send_audience_v1(v_id);
  PERFORM pg_temp.chk('A-06 fixture: the late muter is in the sealed send',
    v_send -> 'rows' @> '[{"raw_phone":"+12025557015"}]'::jsonb, v_send::text);
  UPDATE public.brand_follows SET muted_until = 'infinity'
   WHERE user_id = '4273a000-0000-4000-8000-000000000015' AND brand_id = v_brand;
  v_send := public.biz_marketing_combined_send_audience_v1(v_id);
  PERFORM pg_temp.chk('A-07 mute after confirm stops the send even when the Book row sealed that person',
    NOT (v_send -> 'rows' @> '[{"raw_phone":"+12025557015"}]'::jsonb), 'still sends to +12025557015');
  UPDATE public.brand_follows SET muted_until = NULL
   WHERE user_id = '4273a000-0000-4000-8000-000000000015' AND brand_id = v_brand;

  -- Linked Book row with its own phone; the account opts out on its verified
  -- phone after confirm. Same person, other identity.
  INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
  VALUES (NULL, '+12025557016', 'sms', 'marketing', 'stop_keyword');
  v_send := public.biz_marketing_combined_send_audience_v1(v_id);
  PERFORM pg_temp.chk('A-08 STOP on the account phone after confirm stops the Book phone of the same person',
    NOT (v_send -> 'rows' @> '[{"raw_phone":"+12025558007"}]'::jsonb), 'still sends to +12025558007');
  DELETE FROM public.channel_suppressions WHERE contact = '+12025557016';

  -- ── Buyers whose orders disagree ─────────────────────────────────────────
  v_aud2 := (public.biz_get_or_create_marketing_combined_audience_v1(v_owner, v_brand,
    '["book","event:4273a000-1000-4000-8000-00000000000a"]'::jsonb) ->> 'audienceId')::uuid;
  v_id := pg_temp.draft('4273a000-3000-4000-8000-000000000003', v_aud2, 'sms');
  v_env := public.biz_marketing_combined_quote_candidates_v1(v_owner, v_id);
  PERFORM pg_temp.chk('A-09 a buyer whose newest order has no phone is still reachable by the phone on their older order',
    v_env -> 'candidates' @> '[{"normalizedContact":"+12025559003","allowed":true}]'::jsonb,
    (SELECT string_agg(x ->> 'normalizedContact', ',') FROM jsonb_array_elements(v_env -> 'candidates') x WHERE x ->> 'buyerContactKey' IS NOT NULL));
  PERFORM public.biz_confirm_marketing_combined_send_v1(v_owner, v_id,
    '4273a000-4000-4000-8000-000000000002', pg_temp.snap(v_env), now() + interval '1 hour');
  v_send := public.biz_marketing_combined_send_audience_v1(v_id);
  PERFORM pg_temp.chk('A-10 every queued sealed target is sent with nothing having changed (buyer with two phones)',
    jsonb_array_length(v_send -> 'rows') = (SELECT count(*) FROM public.marketing_book_send_targets t
      JOIN public.marketing_book_send_executions e ON e.id = t.execution_id
      WHERE e.campaign_id = v_id AND t.outcome = 'queued'),
    'rows=' || jsonb_array_length(v_send -> 'rows') || ' phones=' ||
      (SELECT string_agg(x ->> 'raw_phone', ',') FROM jsonb_array_elements(v_send -> 'rows') x));

  -- ── Money: the lock and the cap ──────────────────────────────────────────
  v_id := pg_temp.draft('4273a000-3000-4000-8000-000000000004', v_aud, 'sms');
  v_env := public.biz_marketing_combined_quote_candidates_v1(v_owner, v_id);
  v_state := NULL;
  BEGIN
    PERFORM public.biz_confirm_marketing_combined_send_v1(v_owner, v_id,
      '4273a000-4000-4000-8000-000000000003', pg_temp.snap(v_env, now() - interval '6 minutes'), NULL);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('A-11 a quote older than 5 minutes is PT409', v_state = 'PT409', COALESCE(v_state, 'accepted'));

  v_state := NULL;
  BEGIN
    INSERT INTO public.brand_people(id, brand_id, display_name, record_status)
    VALUES ('4273a000-2000-4000-8000-0000000000a1', v_brand, 'Added after preview', 'active');
    INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state)
    VALUES (v_brand, '4273a000-2000-4000-8000-0000000000a1', 'phone', '+12025558111', 'brand_owned', true, true, 'active');
    PERFORM public.biz_confirm_marketing_combined_send_v1(v_owner, v_id,
      '4273a000-4000-4000-8000-000000000003', pg_temp.snap(v_env), NULL);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('A-12 a person added between preview and confirm is PT409 and seals nothing',
    v_state = 'PT409' AND NOT EXISTS (SELECT 1 FROM public.marketing_book_send_executions e WHERE e.campaign_id = v_id),
    COALESCE(v_state, 'accepted'));

  v_state := NULL;
  BEGIN
    v_env := jsonb_set(v_env, '{candidates,0,normalizedContact}', '"+19999999999"');
    PERFORM public.biz_confirm_marketing_combined_send_v1(v_owner, v_id,
      '4273a000-4000-4000-8000-000000000003', pg_temp.snap(v_env), NULL);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('A-13 a snapshot whose contact was swapped is PT409', v_state = 'PT409', COALESCE(v_state, 'accepted'));

  -- SMS over its cap, email inside its cap: the SMS refuses, the email seals,
  -- and the campaign still counts once toward the week.
  INSERT INTO public.brand_messaging_limits(brand_id, email_monthly, sms_monthly, push_monthly, week_warning_at, set_by)
  VALUES (v_brand, 1000, 1, NULL, 3, v_owner);
  v_id := pg_temp.draft('4273a000-3000-4000-8000-000000000005', v_aud, 'email');
  v_env := public.biz_marketing_combined_quote_candidates_v1(v_owner, v_id);
  PERFORM public.biz_confirm_marketing_combined_send_v1(v_owner, v_id,
    '4273a000-4000-4000-8000-000000000004', pg_temp.snap(v_env), now() + interval '1 hour');
  v_id := pg_temp.draft('4273a000-3000-4000-8000-000000000006', v_aud, 'sms', '4273a000-3000-4000-8000-000000000005');
  v_env := public.biz_marketing_combined_quote_candidates_v1(v_owner, v_id);
  v_state := NULL;
  BEGIN
    PERFORM public.biz_confirm_marketing_combined_send_v1(v_owner, v_id,
      '4273a000-4000-4000-8000-000000000005', pg_temp.snap(v_env), now() + interval '1 hour');
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  PERFORM pg_temp.chk('A-14 SMS over its cap refuses by name and seals nothing',
    v_state LIKE '%book_blast_monthly_cap_exceeded%'
    AND NOT EXISTS (SELECT 1 FROM public.marketing_book_send_executions e WHERE e.campaign_id = v_id), COALESCE(v_state, 'accepted'));
  PERFORM pg_temp.chk('A-15 the failed SMS stays a draft in the group',
    (SELECT status FROM public.marketing_campaigns WHERE id = v_id) = 'draft', '');
  DELETE FROM public.brand_messaging_limits WHERE brand_id = v_brand;

  -- ── Boundaries ───────────────────────────────────────────────────────────
  v_state := NULL;
  BEGIN
    PERFORM public.biz_marketing_combined_audience_summary_v1(v_out, v_brand, '["book"]'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('A-16 a caller claiming another actor is refused', v_state = '42501', COALESCE(v_state, 'accepted'));

  PERFORM set_config('request.jwt.claim.sub', v_out::text, true);
  v_state := NULL;
  BEGIN
    PERFORM public.biz_marketing_combined_audience_summary_v1(v_out, v_brand, '["book","followers"]'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('A-17 another brand''s owner cannot read this brand''s totals', v_state = '42501', COALESCE(v_state, 'accepted'));
  v_state := NULL;
  BEGIN
    PERFORM public.biz_get_or_create_marketing_combined_audience_v1(v_out, v_brand, '["book"]'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('A-18 another brand''s owner cannot create an audience here', v_state = '42501', COALESCE(v_state, 'accepted'));

  -- The Book lane requires an event manager. Adding one more source must not
  -- lower that bar for the Book people inside the set.
  PERFORM set_config('request.jwt.claim.sub', v_mm::text, true);
  v_state := NULL;
  BEGIN
    PERFORM public.biz_get_or_create_marketing_combined_audience_v1(v_mm, v_brand, '["book"]'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('A-19 fixture: a marketing manager cannot pick the Book alone', v_state = '42501', COALESCE(v_state, 'accepted'));
  v_state := NULL;
  BEGIN
    PERFORM public.biz_get_or_create_marketing_combined_audience_v1(v_mm, v_brand, '["book","followers"]'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('A-20 a marketing manager cannot reach the Book by also ticking Followers', v_state = '42501', COALESCE(v_state, 'accepted'));
  v_id := pg_temp.draft('4273a000-3000-4000-8000-000000000009', v_aud, 'sms');
  v_state := NULL;
  BEGIN
    PERFORM public.biz_marketing_combined_quote_candidates_v1(v_mm, v_id);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('A-20b nor be quoted the Book through a combined set', v_state = '42501', COALESCE(v_state, 'accepted'));
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  v_state := NULL;
  BEGIN
    PERFORM public.biz_get_or_create_marketing_combined_audience_v1(v_owner, v_brand,
      '["group:------------------------------------"]'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('A-21 a malformed group key is the normal not-found, not a cast error', v_state = 'P0002', COALESCE(v_state, 'accepted'));

  -- ── Older lanes pointed at a combined audience ───────────────────────────
  v_id := pg_temp.draft('4273a000-3000-4000-8000-000000000007', v_aud, 'email');
  FOR v_got IN SELECT unnest(ARRAY['biz_marketing_book_quote_candidates', 'biz_marketing_circle_quote_candidates_v1']) LOOP
    v_state := NULL;
    BEGIN
      IF v_got = 'biz_marketing_book_quote_candidates' THEN
        PERFORM public.biz_marketing_book_quote_candidates(v_owner, v_id);
      ELSE
        PERFORM public.biz_marketing_circle_quote_candidates_v1(v_owner, v_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
    END;
    PERFORM pg_temp.chk('A-22 older lane ' || v_got || ' refuses a combined audience', v_state = 'P0002', COALESCE(v_state, 'accepted'));
  END LOOP;
  PERFORM pg_temp.chk('A-23 the claim leaves an unsealed combined campaign alone',
    NOT EXISTS (SELECT 1 FROM public.mkt_claim_campaigns(50, v_id)), '');

  -- ── What the Host reads back after a send ────────────────────────────────
  -- The dispatcher writes recipient_phone / recipient_email on every message.
  -- Ben-shaped row: reached only through Followers.
  INSERT INTO public.marketing_messages(id, campaign_id, recipient_phone, channel, status)
  VALUES ('4273a000-5000-4000-8000-000000000001', '4273a000-3000-4000-8000-000000000001', '+12025557017', 'sms', 'sent');
END;
$cases$;

-- Friends of followers: the send-time switch binds a sealed combined campaign.
DO $ext$
DECLARE
  v_owner uuid := '4273a000-0000-4000-8000-000000000001';
  v_brand uuid := '4273a000-0000-4000-8000-0000000000b1';
  v_aud uuid; v_id uuid; v_env jsonb; v_send jsonb;
BEGIN
  v_aud := (public.biz_get_or_create_marketing_combined_audience_v1(v_owner, v_brand, '["book","extended"]'::jsonb) ->> 'audienceId')::uuid;
  v_id := pg_temp.draft('4273a000-3000-4000-8000-000000000008', v_aud, 'sms');
  v_env := public.biz_marketing_combined_quote_candidates_v1(v_owner, v_id);
  PERFORM pg_temp.chk('B-01 fixture: the friend of a follower is quoted',
    v_env -> 'candidates' @> '[{"normalizedContact":"+12025557017","allowed":true,"ring":"extended"}]'::jsonb, v_env::text);
  PERFORM public.biz_confirm_marketing_combined_send_v1(v_owner, v_id,
    '4273a000-4000-4000-8000-000000000008', pg_temp.snap(v_env), now() + interval '1 hour');
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'brand_circle_extended_controls_android_v1';
  v_send := public.biz_marketing_combined_send_audience_v1(v_id);
  PERFORM pg_temp.chk('B-02 a controls switch off after confirm stops the friend of a follower at send',
    NOT (v_send -> 'rows' @> '[{"raw_phone":"+12025557017"}]'::jsonb), v_send::text);
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'brand_circle_extended_controls_android_v1';
  UPDATE public.brand_circle_preferences SET extended_brand_reach_enabled = false
   WHERE user_id = '4273a000-0000-4000-8000-000000000017';
  v_send := public.biz_marketing_combined_send_audience_v1(v_id);
  PERFORM pg_temp.chk('B-03 the person switching friends-reach off after confirm stops the send',
    NOT (v_send -> 'rows' @> '[{"raw_phone":"+12025557017"}]'::jsonb), v_send::text);
  UPDATE public.brand_circle_preferences SET extended_brand_reach_enabled = true
   WHERE user_id = '4273a000-0000-4000-8000-000000000017';
END;
$ext$;

-- The Host's own session: no contact of a graph-only person, by any read.
SELECT set_config('request.jwt.claim.sub', '4273a000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"4273a000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $host$
DECLARE v_phone text; v_state text;
BEGIN
  BEGIN
    SELECT m.recipient_phone INTO v_phone FROM public.marketing_messages m
     WHERE m.id = '4273a000-5000-4000-8000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN v_phone := NULL;
  END;
  PERFORM pg_temp.chk('C-01 the Host cannot read the raw phone of a person reached only through their circle',
    v_phone IS NULL, 'read ' || COALESCE(v_phone, ''));
  BEGIN
    PERFORM 1 FROM public.marketing_book_send_targets LIMIT 1;
    PERFORM pg_temp.chk('C-02 the Host cannot read sealed targets (digests of contacts)', false, 'readable');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_4273_combined_identities('4273a000-0000-4000-8000-0000000000b1', '["followers"]'::jsonb);
    PERFORM pg_temp.chk('C-03 the Host cannot call the identity resolver', false, 'callable');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.biz_marketing_combined_quote_candidates_v1('4273a000-0000-4000-8000-000000000001', '4273a000-3000-4000-8000-000000000007');
    PERFORM pg_temp.chk('C-04 the Host cannot read candidates directly', false, 'callable');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$host$;
RESET ROLE;

DO $report$
DECLARE v text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY id) INTO v FROM a4273_fail;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION E'#4273 tester adversarial FAIL:\n%', v;
  END IF;
END;
$report$;

ROLLBACK;
