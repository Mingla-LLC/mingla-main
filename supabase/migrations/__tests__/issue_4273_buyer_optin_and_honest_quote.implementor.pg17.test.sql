-- #4273 — buyers and followers are opted in unless they said no; the quote runs
-- the send's verdict on graph-only people; a text withheld at send is not
-- counted as sent. Runs on the fully applied migration chain and rolls back.
--
-- MINGLA-INVARIANT: I-4273-BUYER-AND-FOLLOWER-AUTO-OPTIN | issue #4273 | A buyer's or follower's email and phone are opted in to that host's marketing with a recorded purchase_auto_optin / follow_auto_optin grant unless they opted out.
-- MINGLA-INVARIANT: I-4273-EXPLICIT-OPT-OUT-ALWAYS-WINS | issue #4273 | An unsubscribe, STOP, suppression, venue SMS opt-out or unreversed revocation keeps a contact withheld; no automatic grant is written for it and the backfill never moves it.
-- MINGLA-INVARIANT: I-4273-QUOTE-AND-SEND-SHARE-ONE-VERDICT | issue #4273 | A graph-only person the send would refuse is quoted as an ordinary unpriced suppression, with no reason naming a contact match.
-- MINGLA-INVARIANT: I-4273-WITHHELD-TEXT-IS-NOT-COUNTED-AS-SENT | issue #4273 | recipient_count counts only messages that went out plus targets that shared such an address; every other withheld target is in the host's skipped figure.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1', 'manual_contact_groups_v1',
  'brand_circle_followers_v1', 'brand_circle_followers_email_v1', 'brand_circle_followers_sms_v1');
CREATE TABLE IF NOT EXISTS auth.identities(user_id uuid, provider text, identity_data jsonb);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t4273o_fail(id serial, line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4273o_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
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
    'smsSegments', 1, 'costKind', 'provider_estimate',
    'estimatedCostMinor', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                            WHERE (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL) * 3,
    'currency', 'USD', 'candidates', p_env -> 'candidates')
$f$;

-- 01 owner. 11 follower F (opted in, phone +2348030004011). 12 follower G
-- (phone +2348030004012), whose number a Book buyer row holds with a host-side
-- suppression. 13 follower H, phone with a STOP on file.
INSERT INTO auth.users(id, email)
SELECT ('4273c000-0000-4000-8000-0000000000' || x)::uuid, 'o' || x || '@example.test'
  FROM unnest(ARRAY['01', '11', '12', '13']) x;
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
  ('4273c000-0000-4000-8000-000000000011', '+2348030004011'),
  ('4273c000-0000-4000-8000-000000000012', '+2348030004012'),
  ('4273c000-0000-4000-8000-000000000013', '+2348030004013');
INSERT INTO public.creator_accounts(id, email) VALUES ('4273c000-0000-4000-8000-000000000001', 'o01@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('4273c000-0000-4000-8000-0000000000b1', '4273c000-0000-4000-8000-000000000001', 'Optin', 'issue-4273o-optin', 'USD', now(), now());
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode)
SELECT u.id, 'F', 'F', 't4273o-' || right(u.id::text, 2), true, true, 'friends'
  FROM auth.users u WHERE u.id IN ('4273c000-0000-4000-8000-000000000011', '4273c000-0000-4000-8000-000000000012',
                                   '4273c000-0000-4000-8000-000000000013');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme) VALUES
  ('4273c000-1000-4000-8000-000000000001', '4273c000-0000-4000-8000-0000000000b1', '4273c000-0000-4000-8000-000000000001',
   'Night', 't4273o-night', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, confirmed_at) VALUES
  -- quiet: said nothing either way.
  ('4273c000-1100-4000-8000-000000000001', '4273c000-1000-4000-8000-000000000001', 'quiet@example.test', '+2348030004101', 'Quiet', 1000, 'USD', 'paid', 'legacy', now()),
  -- stopper: replied STOP to a text, and unsubscribed from email.
  ('4273c000-1100-4000-8000-000000000002', '4273c000-1000-4000-8000-000000000001', 'stopper@example.test', '+2348030004102', 'Stopper', 1000, 'USD', 'paid', 'legacy', now()),
  -- revoker: revoked marketing consent by email.
  ('4273c000-1100-4000-8000-000000000003', '4273c000-1000-4000-8000-000000000001', 'revoker@example.test', '+2348030004103', 'Revoker', 1000, 'USD', 'paid', 'legacy', now()),
  -- ticked: ticked the optional box, so the explicit grant is on file.
  ('4273c000-1100-4000-8000-000000000004', '4273c000-1000-4000-8000-000000000001', 'ticked@example.test', '+2348030004104', 'Ticked', 1000, 'USD', 'paid', 'legacy', now());
INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
VALUES (NULL, '+2348030004102', 'sms', 'all', 'stop_keyword');
INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, reason)
VALUES ('stopper@example.test', 'email', 'global', 'unsubscribe_link');
INSERT INTO public.consent_records(contact, channel, scope, action, source, brand_id) VALUES
  ('revoker@example.test', 'email', 'marketing', 'revoked', 'prefs_ui', NULL),
  ('ticked@example.test', 'email', 'marketing', 'granted', 'checkout', '4273c000-0000-4000-8000-0000000000b1');

DO $optin$
DECLARE
  b uuid := '4273c000-0000-4000-8000-0000000000b1'; o uuid; v jsonb;
  v_quiet uuid; v_stop uuid; v_rev uuid; v_tick uuid; v_state text; v_n integer;
BEGIN
  FOREACH o IN ARRAY ARRAY['4273c000-1100-4000-8000-000000000001', '4273c000-1100-4000-8000-000000000002',
                           '4273c000-1100-4000-8000-000000000003', '4273c000-1100-4000-8000-000000000004']::uuid[] LOOP
    SELECT public.biz_resolve_brand_person_source(b, x.event_id, 'order', o, NULL, NULL,
             x.buyer_email, x.buyer_phone_e164, x.created_at)
      INTO v FROM public.orders x WHERE x.id = o;
    CASE o
      WHEN '4273c000-1100-4000-8000-000000000001' THEN v_quiet := (v ->> 'personId')::uuid;
      WHEN '4273c000-1100-4000-8000-000000000002' THEN v_stop := (v ->> 'personId')::uuid;
      WHEN '4273c000-1100-4000-8000-000000000003' THEN v_rev := (v ->> 'personId')::uuid;
      ELSE v_tick := (v ->> 'personId')::uuid;
    END CASE;
  END LOOP;
  PERFORM pg_temp.chk('A-00 fixture: four buyers ingested', v_quiet IS NOT NULL AND v_stop IS NOT NULL AND v_rev IS NOT NULL AND v_tick IS NOT NULL, '');

  -- A-01: a buyer who said nothing is opted in on BOTH methods, and it is recorded.
  PERFORM pg_temp.chk('A-01 a quiet buyer''s email and phone are granted',
    (SELECT count(*) FROM public.brand_person_contact_methods m
      WHERE m.brand_person_id = v_quiet AND m.marketing_consent_state = 'granted'
        AND m.marketing_consent_record_id IS NOT NULL) = 2,
    (SELECT string_agg(channel || '=' || marketing_consent_state, ',') FROM public.brand_person_contact_methods WHERE brand_person_id = v_quiet));
  PERFORM pg_temp.chk('A-02 the grant is recorded as purchase_auto_optin, derived, for this brand, on both channels',
    (SELECT count(*) FROM public.consent_records r
      WHERE r.brand_id = b AND r.scope = 'marketing' AND r.action = 'granted'
        AND r.source = 'purchase_auto_optin' AND r.brand_attribution = 'derived'
        AND r.contact IN ('quiet@example.test', '+2348030004101')) = 2, '');
  -- The SMS authoriser now reaches the buyer's phone.
  PERFORM pg_temp.chk('A-03 a quiet buyer''s phone passes the marketing blast authoriser',
    (SELECT a.allowed FROM public.biz_brand_person_authorized_contact_v2(b, v_quiet, 'sms', 'marketing_blast') a), '');

  -- A-04..06: an explicit no always wins.
  PERFORM pg_temp.chk('A-04 STOP keeps the phone withheld, unsubscribe keeps the email withheld',
    (SELECT count(*) FROM public.brand_person_contact_methods m
      WHERE m.brand_person_id = v_stop AND m.marketing_consent_state = 'withheld') = 2,
    (SELECT string_agg(channel || '=' || marketing_consent_state, ',') FROM public.brand_person_contact_methods WHERE brand_person_id = v_stop));
  PERFORM pg_temp.chk('A-05 a revocation keeps the email withheld; the phone, never revoked, is granted',
    (SELECT marketing_consent_state FROM public.brand_person_contact_methods WHERE brand_person_id = v_rev AND channel = 'email') = 'withheld'
    AND (SELECT marketing_consent_state FROM public.brand_person_contact_methods WHERE brand_person_id = v_rev AND channel = 'phone') = 'granted', '');
  PERFORM pg_temp.chk('A-06 no automatic grant is ever written for an opted-out contact',
    NOT EXISTS (SELECT 1 FROM public.consent_records r WHERE r.source IN ('purchase_auto_optin', 'follow_auto_optin')
                 AND r.contact IN ('stopper@example.test', '+2348030004102', 'revoker@example.test')), '');
  PERFORM pg_temp.chk('A-07 a ticked box keeps its explicit checkout grant, no automatic duplicate',
    (SELECT r.source FROM public.consent_records r JOIN public.brand_person_contact_methods m ON m.marketing_consent_record_id = r.id
      WHERE m.brand_person_id = v_tick AND m.channel = 'email') = 'checkout'
    AND (SELECT count(*) FROM public.consent_records r WHERE r.contact = 'ticked@example.test' AND r.scope = 'marketing') = 1, '');

  -- B: the backfill. Rows graded withheld before this rule, with no record.
  UPDATE public.brand_person_contact_methods SET marketing_consent_state = 'withheld', marketing_consent_record_id = NULL
   WHERE brand_person_id IN (v_quiet, v_stop);
  DELETE FROM public.consent_records WHERE contact IN ('quiet@example.test', '+2348030004101');
  v_n := public.issue_4273_backfill_auto_optin();
  PERFORM pg_temp.chk('B-01 the backfill opts in exactly the quiet buyer''s two contacts',
    v_n = 2 AND (SELECT count(*) FROM public.brand_person_contact_methods m
                  WHERE m.brand_person_id = v_quiet AND m.marketing_consent_state = 'granted'
                    AND m.marketing_consent_record_id IS NOT NULL) = 2, v_n::text);
  PERFORM pg_temp.chk('B-02 the backfill leaves an opted-out buyer withheld',
    (SELECT count(*) FROM public.brand_person_contact_methods m
      WHERE m.brand_person_id = v_stop AND m.marketing_consent_state = 'withheld') = 2, '');
  v_n := public.issue_4273_backfill_auto_optin();
  PERFORM pg_temp.chk('B-03 a second run moves nothing and writes no second grant',
    v_n = 0 AND (SELECT count(*) FROM public.consent_records WHERE contact IN ('quiet@example.test', '+2348030004101')) = 2, v_n::text);
END;
$optin$;

-- ── F: following opts in, and lifts a buyer contact withheld only for lack of a record ──
INSERT INTO public.brand_people(id, brand_id, display_name, record_status) VALUES
  ('4273c000-2000-4000-8000-000000000011', '4273c000-0000-4000-8000-0000000000b1', 'Old buyer', 'active');
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state, marketing_consent_state) VALUES
  ('4273c000-0000-4000-8000-0000000000b1', '4273c000-2000-4000-8000-000000000011', 'phone', '+2348030004011', 'brand_owned', true, true, 'active', 'withheld');
INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
VALUES (NULL, '+2348030004013', 'sms', 'all', 'stop_keyword');
INSERT INTO public.brand_follows(user_id, brand_id) VALUES
  ('4273c000-0000-4000-8000-000000000011', '4273c000-0000-4000-8000-0000000000b1'),
  ('4273c000-0000-4000-8000-000000000012', '4273c000-0000-4000-8000-0000000000b1'),
  ('4273c000-0000-4000-8000-000000000013', '4273c000-0000-4000-8000-0000000000b1');
DO $follow$
BEGIN
  PERFORM pg_temp.chk('F-01 following records follow_auto_optin for the follower''s verified phone',
    EXISTS (SELECT 1 FROM public.consent_records r WHERE r.contact = '+2348030004011' AND r.channel = 'sms'
             AND r.brand_id = '4273c000-0000-4000-8000-0000000000b1' AND r.source = 'follow_auto_optin'
             AND r.user_id = '4273c000-0000-4000-8000-000000000011'), '');
  PERFORM pg_temp.chk('F-02 and lifts the Book contact on that number that was withheld for lack of a record',
    (SELECT marketing_consent_state FROM public.brand_person_contact_methods
      WHERE brand_person_id = '4273c000-2000-4000-8000-000000000011') = 'granted', '');
  PERFORM pg_temp.chk('F-03 a follower who said STOP gets no automatic grant',
    NOT EXISTS (SELECT 1 FROM public.consent_records r WHERE r.contact = '+2348030004013' AND r.source = 'follow_auto_optin'), '');
END;
$follow$;

-- ── Q: the quote runs the send's verdict on graph-only people ──────────────
-- G's number sits on a Book row the host suppressed AFTER G followed. G is known
-- to the brand only as a follower; the send refuses G for that contact match.
INSERT INTO public.brand_people(id, brand_id, display_name, record_status) VALUES
  ('4273c000-2000-4000-8000-000000000012', '4273c000-0000-4000-8000-0000000000b1', 'Suppressed buyer', 'active');
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state, marketing_consent_state) VALUES
  ('4273c000-0000-4000-8000-0000000000b1', '4273c000-2000-4000-8000-000000000012', 'phone', '+2348030004012', 'brand_owned', true, true, 'active', 'unknown');
INSERT INTO public.brand_person_channel_suppressions(brand_id, brand_person_id, channel, scope, reason, origin_table)
VALUES ('4273c000-0000-4000-8000-0000000000b1', '4273c000-2000-4000-8000-000000000012', 'sms', 'marketing', 'host_unsubscribe', 't4273o_fixture');
SELECT public.issue_1777_refresh_brand_reach('4273c000-0000-4000-8000-0000000000b1', 'follower');
SELECT set_config('request.jwt.claim.sub', '4273c000-0000-4000-8000-000000000001', true);

DO $quote$
DECLARE
  o1 uuid := '4273c000-0000-4000-8000-000000000001'; b uuid := '4273c000-0000-4000-8000-0000000000b1';
  a uuid; c uuid; e jsonb; send jsonb; x uuid; g jsonb; v_reach integer; v_status text;
BEGIN
  a := (public.biz_get_or_create_marketing_combined_audience_v1(o1, b, '["followers"]'::jsonb) ->> 'audienceId')::uuid;
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES ('4273c000-3000-4000-8000-000000000001', o1, b, a, 'Q sms', 'sms', '{"kind":"sms","body":"Doors at 9."}'::jsonb, 'draft')
  RETURNING id INTO c;
  e := public.biz_marketing_combined_quote_candidates_v1(o1, c);
  SELECT x2 INTO g FROM jsonb_array_elements(e -> 'candidates') x2
   WHERE x2 ->> 'recipientUserId' = '4273c000-0000-4000-8000-000000000012';
  PERFORM pg_temp.chk('Q-00 fixture: the send refuses G for a contact match',
    public.issue_4273_send_verdict(o1, b, 'sms', '+2348030004012', NULL, '4273c000-0000-4000-8000-000000000012', NULL)
      = 'contact_match_blocked', '');
  PERFORM pg_temp.chk('Q-01 the quote does not price G',
    g IS NOT NULL AND (g ->> 'allowed')::boolean IS FALSE, COALESCE(g::text, 'missing'));
  PERFORM pg_temp.chk('Q-02 G reads as an ordinary suppression, naming no contact match',
    g ->> 'safeReasonCode' = 'suppressed' AND e::text !~* 'match', COALESCE(g::text, 'missing'));
  PERFORM pg_temp.chk('Q-03 F, opted in and unmatched, is priced',
    e -> 'candidates' @> '[{"recipientUserId":"4273c000-0000-4000-8000-000000000011","allowed":true}]'::jsonb, e::text);
  v_reach := public.biz_marketing_combined_audience_reach_v1(o1, b, '["followers"]'::jsonb, 'sms');
  PERFORM pg_temp.chk('Q-04 the composer reach count agrees with the quote', v_reach = 1, v_reach::text);

  PERFORM public.biz_confirm_marketing_combined_send_v1(o1, c, '4273c000-4000-4000-8000-000000000001', pg_temp.snap(e), now() + interval '1 hour');
  send := public.biz_marketing_combined_send_audience_v1(c);
  SELECT id INTO x FROM public.marketing_book_send_executions WHERE campaign_id = c;
  PERFORM pg_temp.chk('Q-05 the send sends exactly what the quote priced',
    jsonb_array_length(send -> 'rows') = (SELECT reachable_count FROM public.marketing_book_send_executions WHERE id = x)
    AND NOT EXISTS (SELECT 1 FROM public.marketing_combined_send_skips s WHERE s.execution_id = x), send::text);

  -- ── H: something changes between the quote and the send. F says STOP after
  -- confirm. Nothing goes out; that is not counted as sent, and the host's
  -- skipped figure carries it.
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES ('4273c000-3000-4000-8000-000000000002', o1, b, a, 'H sms', 'sms', '{"kind":"sms","body":"Doors at 10."}'::jsonb, 'draft')
  RETURNING id INTO c;
  e := public.biz_marketing_combined_quote_candidates_v1(o1, c);
  PERFORM public.biz_confirm_marketing_combined_send_v1(o1, c, '4273c000-4000-4000-8000-000000000002', pg_temp.snap(e), now() + interval '1 hour');
  INSERT INTO public.brand_person_channel_suppressions(brand_id, brand_person_id, channel, scope, reason, origin_table)
  VALUES (b, '4273c000-2000-4000-8000-000000000011', 'sms', 'marketing', 'host_unsubscribe', 't4273o_fixture');
  send := public.biz_marketing_combined_send_audience_v1(c);
  PERFORM pg_temp.chk('H-00 fixture: F is withheld at send by the Book row on F''s number',
    jsonb_array_length(send -> 'rows') = 0, send::text);
  v_status := public.mkt_finalize_campaign(c);
  PERFORM pg_temp.chk('H-01 finalize does not count the withheld text as sent',
    v_status = 'failed' AND (SELECT recipient_count FROM public.marketing_campaigns WHERE id = c) = 0,
    v_status || ' ' || COALESCE((SELECT recipient_count FROM public.marketing_campaigns WHERE id = c)::text, 'null'));
  PERFORM pg_temp.chk('H-02 the withheld target is in the host''s skipped figure, not hidden',
    public.biz_marketing_combined_hidden_skips_v1(c) = 0, public.biz_marketing_combined_hidden_skips_v1(c)::text);
END;
$quote$;

DO $grants$
BEGIN
  PERFORM pg_temp.chk('G-01 the new helpers are service-only',
    NOT has_function_privilege('authenticated', 'public.issue_4273_marketing_opted_out(uuid,text,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4273_record_auto_optin(uuid,text,text,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4273_record_auto_optin(uuid,text,text,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4273_backfill_auto_optin()', 'EXECUTE'), '');
END;
$grants$;

DO $report$
DECLARE v text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY id) INTO v FROM t4273o_fail;
  IF v IS NOT NULL THEN RAISE EXCEPTION E'#4273 buyer opt-in / honest quote FAIL:\n%', v; END IF;
  RAISE NOTICE '#4273 buyer opt-in / honest quote: PASS';
END;
$report$;

ROLLBACK;
