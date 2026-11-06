-- #4273 rework — what the Host can learn from a combined Blast, how the strictest
-- rule lands at send, who pays, and a stalled run coming back.
-- Runs on the fully applied migration chain.
--
-- MINGLA-INVARIANT: I-4273-PREVIEW-NEVER-CONTACT-MATCHES-GRAPH | issue #4273 | A contact typed into a Book row yields identical Host-visible previews whether or not it belongs to someone known only through followers or friends of followers.
-- MINGLA-INVARIANT: I-4273-SENT-AT-OR-BELOW-QUOTE | issue #4273 | A combined Blast never sends or counts more than its sealed quote; every sealed target not sent is a recorded skip.
-- MINGLA-INVARIANT: I-4273-UNSUBSCRIBE-CONTACT-NEVER-REACHES-HOST | issue #4273 | A host reads an opt-out only for a contact their brand already holds; everyone's opt-out still stops the send.
-- MINGLA-INVARIANT: I-4273-CLAIM-KEEPS-RECLAIM-AND-SEAL | issue #4273 | The claim reclaims a stalled sending campaign and still refuses a sealed-lane campaign with no sealed execution.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1', 'manual_contact_groups_v1',
  'brand_circle_followers_v1', 'brand_circle_followers_email_v1', 'brand_circle_followers_sms_v1');

-- The email arm of the identity rule reads auth.identities, which this image's stub
-- auth schema lacks. Same shape GoTrue has, so the branch really runs here.
CREATE TABLE IF NOT EXISTS auth.identities(user_id uuid, provider text, identity_data jsonb);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE r4273_fail(id serial, line text) ON COMMIT DROP;
GRANT ALL ON r4273_fail TO authenticated;
GRANT ALL ON SEQUENCE r4273_fail_id_seq TO authenticated;
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
    'smsSegments', 1, 'costKind', 'provider_estimate',
    'estimatedCostMinor', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                            WHERE (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL) * 3,
    'currency', 'USD', 'candidates', p_env -> 'candidates')
$f$;
-- What the Host's preview is computed from: counts, totals, names. Never a contact.
CREATE FUNCTION pg_temp.host_view(p_env jsonb, p_summary jsonb) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'selected', p_env -> 'selectedCount',
    'reachable', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                   WHERE (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL),
    'suppressed', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                    WHERE NOT (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL),
    'unavailable', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                     WHERE x ->> 'normalizedContact' IS NULL),
    'people', p_summary -> 'peopleCount',
    'followersTotal', p_summary -> 'followersTotal',
    'followersAlsoInBook', p_summary -> 'followersAlsoInBook',
    'sources', (SELECT jsonb_agg(jsonb_build_object('k', s ->> 'key', 'c', s -> 'count', 'b', s -> 'alsoInBookCount') ORDER BY s ->> 'key')
                  FROM jsonb_array_elements(p_summary -> 'sources') s))
$f$;

-- Owner + three followers per brand. Follower 1 opted in, 2 muted, 3 blocked the host.
-- b1 "probe": Book rows hold those followers' own phones.
-- b2 "control": identical shape, Book rows hold numbers nobody else has.
INSERT INTO auth.users(id, email)
SELECT ('42730000-0000-4000-8000-0000000000' || x)::uuid, 'r' || x || '@example.test'
  FROM unnest(ARRAY['01','02','11','12','13','21','22','23','31','03']) x;
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
  ('42730000-0000-4000-8000-000000000011', '+12025556011'),
  ('42730000-0000-4000-8000-000000000012', '+12025556012'),
  ('42730000-0000-4000-8000-000000000013', '+12025556013'),
  ('42730000-0000-4000-8000-000000000021', '+12025556021'),
  ('42730000-0000-4000-8000-000000000022', '+12025556022'),
  ('42730000-0000-4000-8000-000000000023', '+12025556023');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('42730000-0000-4000-8000-000000000001', 'r01@example.test'),
  ('42730000-0000-4000-8000-000000000002', 'r02@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('42730000-0000-4000-8000-0000000000b1', '42730000-0000-4000-8000-000000000001', 'Probe', 'issue-4273r-probe', 'USD', now(), now()),
  ('42730000-0000-4000-8000-0000000000b2', '42730000-0000-4000-8000-000000000002', 'Control', 'issue-4273r-control', 'USD', now(), now());
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
VALUES ('42730000-0000-4000-8000-0000000000b1', '42730000-0000-4000-8000-000000000003', 'marketing_manager', now());
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode)
SELECT u.id, 'R', 'R', 'r4273-' || right(u.id::text, 2), true, true, 'friends'
  FROM auth.users u WHERE u.email LIKE 'r__@example.test' AND right(u.id::text, 2) NOT IN ('01', '02', '03');
INSERT INTO public.brand_follows(user_id, brand_id, muted_until) VALUES
  ('42730000-0000-4000-8000-000000000011', '42730000-0000-4000-8000-0000000000b1', NULL),
  ('42730000-0000-4000-8000-000000000012', '42730000-0000-4000-8000-0000000000b1', 'infinity'),
  ('42730000-0000-4000-8000-000000000013', '42730000-0000-4000-8000-0000000000b1', NULL),
  ('42730000-0000-4000-8000-000000000021', '42730000-0000-4000-8000-0000000000b2', NULL),
  ('42730000-0000-4000-8000-000000000022', '42730000-0000-4000-8000-0000000000b2', 'infinity'),
  ('42730000-0000-4000-8000-000000000023', '42730000-0000-4000-8000-0000000000b2', NULL);
INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES
  ('42730000-0000-4000-8000-000000000013', '42730000-0000-4000-8000-000000000001'),
  ('42730000-0000-4000-8000-000000000023', '42730000-0000-4000-8000-000000000002');
INSERT INTO public.brand_people(id, brand_id, display_name, record_status) VALUES
  ('42730000-2000-4000-8000-000000000011', '42730000-0000-4000-8000-0000000000b1', 'Typed one', 'active'),
  ('42730000-2000-4000-8000-000000000012', '42730000-0000-4000-8000-0000000000b1', 'Typed two', 'active'),
  ('42730000-2000-4000-8000-000000000013', '42730000-0000-4000-8000-0000000000b1', 'Typed three', 'active'),
  ('42730000-2000-4000-8000-000000000021', '42730000-0000-4000-8000-0000000000b2', 'Typed one', 'active'),
  ('42730000-2000-4000-8000-000000000022', '42730000-0000-4000-8000-0000000000b2', 'Typed two', 'active'),
  ('42730000-2000-4000-8000-000000000023', '42730000-0000-4000-8000-0000000000b2', 'Typed three', 'active');
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state, marketing_consent_state) VALUES
  ('42730000-0000-4000-8000-0000000000b1', '42730000-2000-4000-8000-000000000011', 'phone', '+12025556011', 'brand_owned', true, true, 'active', 'unknown'),
  ('42730000-0000-4000-8000-0000000000b1', '42730000-2000-4000-8000-000000000011', 'email', 'one@example.test', 'brand_owned', true, true, 'active', 'unknown'),
  ('42730000-0000-4000-8000-0000000000b1', '42730000-2000-4000-8000-000000000012', 'phone', '+12025556012', 'brand_owned', true, true, 'active', 'unknown'),
  ('42730000-0000-4000-8000-0000000000b1', '42730000-2000-4000-8000-000000000013', 'phone', '+12025556013', 'brand_owned', true, true, 'active', 'unknown'),
  ('42730000-0000-4000-8000-0000000000b2', '42730000-2000-4000-8000-000000000021', 'phone', '+12025557021', 'brand_owned', true, true, 'active', 'unknown'),
  ('42730000-0000-4000-8000-0000000000b2', '42730000-2000-4000-8000-000000000021', 'email', 'one2@example.test', 'brand_owned', true, true, 'active', 'unknown'),
  ('42730000-0000-4000-8000-0000000000b2', '42730000-2000-4000-8000-000000000022', 'phone', '+12025557022', 'brand_owned', true, true, 'active', 'unknown'),
  ('42730000-0000-4000-8000-0000000000b2', '42730000-2000-4000-8000-000000000023', 'phone', '+12025557023', 'brand_owned', true, true, 'active', 'unknown');
-- A buyer in the probe brand with an older phone that later said STOP.
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme) VALUES
  ('42730000-1000-4000-8000-000000000001', '42730000-0000-4000-8000-0000000000b1', '42730000-0000-4000-8000-000000000001', 'Night', 'r4273-night', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, created_at) VALUES
  ('42730000-1100-4000-8000-000000000001', '42730000-1000-4000-8000-000000000001', 'tom@example.test', '+12025559101', 'Tom', 1000, 'USD', 'paid', 'legacy', now() - interval '5 days'),
  ('42730000-1100-4000-8000-000000000002', '42730000-1000-4000-8000-000000000001', 'tom@example.test', '+12025559102', 'Tom', 1000, 'USD', 'paid', 'legacy', now() - interval '1 day');
SELECT public.issue_1777_refresh_brand_reach('42730000-0000-4000-8000-0000000000b1', 'follower');
SELECT public.issue_1777_refresh_brand_reach('42730000-0000-4000-8000-0000000000b2', 'follower');

CREATE FUNCTION pg_temp.draft(p_id uuid, p_owner uuid, p_brand uuid, p_audience uuid, p_channel text) RETURNS uuid LANGUAGE sql AS $f$
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (p_id, p_owner, p_brand, p_audience, 'R ' || p_channel, p_channel,
    CASE p_channel WHEN 'sms' THEN '{"kind":"sms","body":"Doors at 9."}'::jsonb
      ELSE '{"kind":"email","subject":"Hi","body_html":"Hi","body_text":"Hi"}'::jsonb END, 'draft')
  RETURNING id
$f$;

DO $cases$
DECLARE
  o1 uuid := '42730000-0000-4000-8000-000000000001'; o2 uuid := '42730000-0000-4000-8000-000000000002';
  mm uuid := '42730000-0000-4000-8000-000000000003';
  b1 uuid := '42730000-0000-4000-8000-0000000000b1'; b2 uuid := '42730000-0000-4000-8000-0000000000b2';
  a1 uuid; a2 uuid; c1 uuid; c2 uuid; e1 jsonb; e2 jsonb; s1 jsonb; s2 jsonb; v1 jsonb; v2 jsonb;
  send1 jsonb; send2 jsonb; x1 uuid; used integer; v_state text;
BEGIN
  -- ── P: the probe. Same shape, follower's phone vs a stranger's phone. ────
  PERFORM set_config('request.jwt.claim.sub', o1::text, true);
  a1 := (public.biz_get_or_create_marketing_combined_audience_v1(o1, b1, '["book","followers"]'::jsonb) ->> 'audienceId')::uuid;
  s1 := public.biz_marketing_combined_audience_summary_v1(o1, b1, '["book","followers"]'::jsonb);
  c1 := pg_temp.draft('42730000-3000-4000-8000-000000000001', o1, b1, a1, 'sms');
  e1 := public.biz_marketing_combined_quote_candidates_v1(o1, c1);
  PERFORM set_config('request.jwt.claim.sub', o2::text, true);
  a2 := (public.biz_get_or_create_marketing_combined_audience_v1(o2, b2, '["book","followers"]'::jsonb) ->> 'audienceId')::uuid;
  s2 := public.biz_marketing_combined_audience_summary_v1(o2, b2, '["book","followers"]'::jsonb);
  c2 := pg_temp.draft('42730000-3000-4000-8000-000000000002', o2, b2, a2, 'sms');
  e2 := public.biz_marketing_combined_quote_candidates_v1(o2, c2);
  v1 := pg_temp.host_view(e1, s1); v2 := pg_temp.host_view(e2, s2);
  PERFORM set_config('request.jwt.claim.sub', o1::text, true);
  v1 := v1 || jsonb_build_object('smsReach', public.biz_marketing_combined_audience_reach_v1(o1, b1, '["book","followers"]'::jsonb, 'sms'));
  PERFORM set_config('request.jwt.claim.sub', o2::text, true);
  v2 := v2 || jsonb_build_object('smsReach', public.biz_marketing_combined_audience_reach_v1(o2, b2, '["book","followers"]'::jsonb, 'sms'));
  PERFORM pg_temp.chk('P-01 the probe preview equals the control preview', v1 = v2, v1::text || ' vs ' || v2::text);
  PERFORM pg_temp.chk('P-02 fixture: three followers and three Book rows, six people, five candidates',
    (v1 ->> 'people')::int = 6 AND (v1 ->> 'reachable')::int = 4 AND (v1 ->> 'suppressed')::int = 1, v1::text);
  PERFORM pg_temp.chk('P-03 no contact appears in the summary', s1::text !~ '@|\+1202', s1::text);

  -- ── S: confirm, send, and what the Host can read of the difference. ──────
  PERFORM set_config('request.jwt.claim.sub', o1::text, true);
  PERFORM public.biz_confirm_marketing_combined_send_v1(o1, c1, '42730000-4000-4000-8000-000000000001', pg_temp.snap(e1), now() + interval '1 hour');
  send1 := public.biz_marketing_combined_send_audience_v1(c1);
  PERFORM set_config('request.jwt.claim.sub', o2::text, true);
  PERFORM public.biz_confirm_marketing_combined_send_v1(o2, c2, '42730000-4000-4000-8000-000000000002', pg_temp.snap(e2), now() + interval '1 hour');
  send2 := public.biz_marketing_combined_send_audience_v1(c2);
  SELECT e.id INTO x1 FROM public.marketing_book_send_executions e WHERE e.campaign_id = c1;
  -- Probe: one text to the opted-in follower's phone; the muted and blocking
  -- followers' numbers get nothing, whichever row sealed them.
  PERFORM pg_temp.chk('S-01 the probe sends once per address and honours every identity',
    jsonb_array_length(send1 -> 'rows') = 1 AND send1 -> 'rows' @> '[{"raw_phone":"+12025556011"}]'::jsonb, send1::text);
  PERFORM pg_temp.chk('S-02 the control is untouched: three Book rows and the active follower',
    jsonb_array_length(send2 -> 'rows') = 4, send2::text);
  PERFORM pg_temp.chk('S-03 every sealed target of the probe is sent or a recorded skip',
    jsonb_array_length(send1 -> 'rows') + (SELECT count(*) FROM public.marketing_combined_send_skips s WHERE s.execution_id = x1)
      = (SELECT count(*) FROM public.marketing_book_send_targets t WHERE t.execution_id = x1 AND t.outcome = 'queued'), send1::text);
  -- #4273 honest count: only a target reached through a shared address stays out
  -- of the skipped figure; everything else withheld is "couldn't be reached".
  PERFORM pg_temp.chk('S-04 the Host skipped figure is every withheld target not reached through a shared address',
    (SELECT reachable_count FROM public.marketing_book_send_executions WHERE id = x1)
      - jsonb_array_length(send1 -> 'rows') - public.biz_marketing_combined_hidden_skips_v1(c1)
      = (SELECT count(*) FROM public.marketing_combined_send_skips s WHERE s.execution_id = x1 AND s.reason <> 'address_duplicate'),
    public.biz_marketing_combined_hidden_skips_v1(c1)::text);

  -- ── M: money. At or below the quote, never above. ────────────────────────
  PERFORM pg_temp.chk('M-01 sends never exceed what was sealed and quoted',
    jsonb_array_length(send1 -> 'rows') <= (SELECT reachable_count FROM public.marketing_book_send_executions WHERE id = x1), '');
  PERFORM pg_temp.chk('M-02 the sealed price is exactly the quote, not recomputed upward at send',
    (SELECT estimated_cost_minor FROM public.marketing_book_send_executions WHERE id = x1) = 12, '');
  PERFORM set_config('request.jwt.claim.sub', o1::text, true);
  used := (public.biz_brand_blast_usage_v1(o1, b1) ->> 'smsUsed')::int;
  send1 := public.biz_marketing_combined_send_audience_v1(c1);
  PERFORM pg_temp.chk('M-03 the monthly count is the quoted reach and re-resolving does not add to it',
    used = 4 AND (public.biz_brand_blast_usage_v1(o1, b1) ->> 'smsUsed')::int = 4, used::text);

  -- ── A: a STOP on a buyer's older phone stops the SMS to their newer one. ──
  a2 := (public.biz_get_or_create_marketing_combined_audience_v1(o1, b1, '["brand_buyers"]'::jsonb) ->> 'audienceId')::uuid;
  INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
  VALUES (NULL, '+12025559101', 'sms', 'marketing', 'stop_keyword');
  c2 := pg_temp.draft('42730000-3000-4000-8000-000000000003', o1, b1, a2, 'sms');
  e2 := public.biz_marketing_combined_quote_candidates_v1(o1, c2);
  PERFORM pg_temp.chk('A-24 a STOP on any phone a buyer has used blocks that buyer',
    e2 -> 'candidates' @> '[{"normalizedContact":"+12025559102","allowed":false}]'::jsonb, e2::text);
  DELETE FROM public.channel_suppressions WHERE contact = '+12025559101';

  -- ── R: each source on its own for this role. ─────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', mm::text, true);
  PERFORM public.biz_get_or_create_marketing_combined_audience_v1(mm, b1, '["followers"]'::jsonb);
  PERFORM public.biz_marketing_combined_audience_summary_v1(mm, b1, '["followers"]'::jsonb);
  v_state := NULL;
  BEGIN
    PERFORM public.biz_get_or_create_marketing_combined_audience_v1(mm, b1, '["brand_buyers","followers"]'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('R-01 buyers stay refused for a role that cannot pick them alone', v_state = '42501', COALESCE(v_state, 'accepted'));
  v_state := NULL;
  BEGIN
    PERFORM public.biz_marketing_combined_audience_summary_v1(mm, b1, '["book","followers"]'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk('R-02 nor can the role read the Book total through the summary', v_state = '42501', COALESCE(v_state, 'accepted'));
  PERFORM set_config('request.jwt.claim.sub', o1::text, true);

  -- ── C: a stalled run comes back; nothing doubles. ────────────────────────
  UPDATE public.marketing_campaigns SET status = 'scheduled', scheduled_for = now() - interval '1 minute' WHERE id = c1;
  PERFORM pg_temp.chk('C-01 a due sealed campaign is claimed', EXISTS (SELECT 1 FROM public.mkt_claim_campaigns(50, c1)), '');
  PERFORM pg_temp.chk('C-02 a healthy run is not stolen from itself', NOT EXISTS (SELECT 1 FROM public.mkt_claim_campaigns(50, c1)), '');
  INSERT INTO public.marketing_messages(id, campaign_id, recipient_phone, channel, status, sent_at)
  VALUES ('42730000-5000-4000-8000-000000000001', c1, '+12025556011', 'sms', 'sent', now());
  INSERT INTO public.marketing_messages(id, campaign_id, recipient_phone, channel, status, provider_message_id) VALUES
    ('42730000-5000-4000-8000-000000000011', c1, '+12025556099', 'sms', 'queued', NULL),
    ('42730000-5000-4000-8000-000000000012', c1, '+12025556098', 'sms', 'queued', 'SMheld');
  UPDATE public.marketing_campaigns SET updated_at = now() - interval '11 minutes' WHERE id = c1;
  PERFORM pg_temp.chk('C-03 a run silent for over 10 minutes is reclaimed', EXISTS (SELECT 1 FROM public.mkt_claim_campaigns(50, c1)), '');
  PERFORM pg_temp.chk('C-04 the reclaim is a heartbeat: not claimable twice', NOT EXISTS (SELECT 1 FROM public.mkt_claim_campaigns(50, c1)), '');
  PERFORM pg_temp.chk('C-08 the in-flight row of a reclaimed run is fenced, for any edge version',
    (SELECT status || ':' || failure_reason FROM public.marketing_messages WHERE id = '42730000-5000-4000-8000-000000000011') = 'failed:interrupted_send_unconfirmed',
    (SELECT status FROM public.marketing_messages WHERE id = '42730000-5000-4000-8000-000000000011'));
  PERFORM pg_temp.chk('C-09 sent rows and provider-held rows are untouched',
    (SELECT status FROM public.marketing_messages WHERE id = '42730000-5000-4000-8000-000000000001') = 'sent'
    AND (SELECT status FROM public.marketing_messages WHERE id = '42730000-5000-4000-8000-000000000012') = 'queued', '');
  PERFORM pg_temp.chk('C-05 a reclaim re-seals nothing and counts nothing again',
    (SELECT count(*) FROM public.marketing_book_send_executions WHERE campaign_id = c1) = 1
    AND (public.biz_brand_blast_usage_v1(o1, b1) ->> 'smsUsed')::int = 4, '');
  v_state := NULL;
  BEGIN
    INSERT INTO public.marketing_messages(campaign_id, recipient_phone, channel, status)
    VALUES (c1, '+12025556011', 'sms', 'queued');
  EXCEPTION WHEN unique_violation THEN v_state := 'dup';
  END;
  PERFORM pg_temp.chk('C-06 one address cannot get a second row in a campaign', v_state = 'dup', COALESCE(v_state, 'accepted'));
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, scheduled_for, updated_at)
  VALUES ('42730000-3000-4000-8000-000000000009', o1, b1, a1, 'Unsealed', 'sms', '{"kind":"sms","body":"x"}', 'draft', now(), now());
  UPDATE public.marketing_campaigns SET updated_at = now() - interval '11 minutes' WHERE id = '42730000-3000-4000-8000-000000000009';
  ALTER TABLE public.marketing_campaigns DISABLE TRIGGER issue_4273_combined_requires_execution;
  UPDATE public.marketing_campaigns SET status = 'sending', updated_at = now() - interval '11 minutes' WHERE id = '42730000-3000-4000-8000-000000000009';
  ALTER TABLE public.marketing_campaigns ENABLE TRIGGER issue_4273_combined_requires_execution;
  PERFORM pg_temp.chk('C-07 a stalled sealed-lane campaign with no execution is left alone',
    NOT EXISTS (SELECT 1 FROM public.mkt_claim_campaigns(50, '42730000-3000-4000-8000-000000000009')), '');
  DELETE FROM public.marketing_campaigns WHERE id = '42730000-3000-4000-8000-000000000009';

  -- Message rows for the read-back below.
  INSERT INTO public.marketing_messages(id, campaign_id, recipient_email, channel, status, failure_reason) VALUES
    ('42730000-5000-4000-8000-000000000002', c1, 'follower-only@example.test', 'email', 'failed', 'rejected follower-only@example.test'),
    ('42730000-5000-4000-8000-000000000003', c2, 'tom@example.test', 'email', 'sent', NULL);
END;
$cases$;

-- Email contact match: the branch that decides who gets messaged on email.
-- Book rows hold addresses that verified accounts also hold, unlinked to the row.
-- 41 muted this brand; 42 blocked the host; 44 is fine; 45 muted but its address is
-- unverified, so it names no account; 'plain' matches nobody.
INSERT INTO auth.users(id, email) VALUES
  ('42730000-0000-4000-8000-000000000041', 'muted@example.test'),
  ('42730000-0000-4000-8000-000000000042', 'blocker@example.test'),
  ('42730000-0000-4000-8000-000000000044', 'fine@example.test'),
  ('42730000-0000-4000-8000-000000000045', 'unverified@example.test');
INSERT INTO auth.identities(user_id, provider, identity_data) VALUES
  ('42730000-0000-4000-8000-000000000041', 'email', '{"email":"muted@example.test"}'),
  ('42730000-0000-4000-8000-000000000042', 'email', '{"email":"blocker@example.test"}'),
  ('42730000-0000-4000-8000-000000000044', 'email', '{"email":"fine@example.test"}'),
  ('42730000-0000-4000-8000-000000000045', 'google', '{"email":"unverified@example.test","email_verified":false}');
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode)
SELECT id, 'E', 'E', 'r4273e-' || right(id::text, 2), true, true, 'friends' FROM auth.users
 WHERE id::text LIKE '42730000-0000-4000-8000-00000000004%';
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('42730000-0000-4000-8000-0000000000b3', '42730000-0000-4000-8000-000000000001', 'Mail', 'issue-4273r-mail', 'USD', now(), now());
INSERT INTO public.brand_follows(user_id, brand_id, muted_until) VALUES
  ('42730000-0000-4000-8000-000000000041', '42730000-0000-4000-8000-0000000000b3', 'infinity'),
  ('42730000-0000-4000-8000-000000000044', '42730000-0000-4000-8000-0000000000b3', NULL),
  ('42730000-0000-4000-8000-000000000045', '42730000-0000-4000-8000-0000000000b3', 'infinity');
INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES
  ('42730000-0000-4000-8000-000000000042', '42730000-0000-4000-8000-000000000001');
INSERT INTO public.brand_people(id, brand_id, display_name, record_status) VALUES
  ('42730000-2000-4000-8000-000000000031', '42730000-0000-4000-8000-0000000000b3', 'A', 'active'),
  ('42730000-2000-4000-8000-000000000032', '42730000-0000-4000-8000-0000000000b3', 'B', 'active'),
  ('42730000-2000-4000-8000-000000000033', '42730000-0000-4000-8000-0000000000b3', 'C', 'active'),
  ('42730000-2000-4000-8000-000000000034', '42730000-0000-4000-8000-0000000000b3', 'D', 'active'),
  ('42730000-2000-4000-8000-000000000035', '42730000-0000-4000-8000-0000000000b3', 'E', 'active');
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state, marketing_consent_state) VALUES
  ('42730000-0000-4000-8000-0000000000b3', '42730000-2000-4000-8000-000000000031', 'email', 'muted@example.test', 'brand_owned', true, true, 'active', 'unknown'),
  ('42730000-0000-4000-8000-0000000000b3', '42730000-2000-4000-8000-000000000032', 'email', 'blocker@example.test', 'brand_owned', true, true, 'active', 'unknown'),
  ('42730000-0000-4000-8000-0000000000b3', '42730000-2000-4000-8000-000000000033', 'email', 'fine@example.test', 'brand_owned', true, true, 'active', 'unknown'),
  ('42730000-0000-4000-8000-0000000000b3', '42730000-2000-4000-8000-000000000034', 'email', 'plain@example.test', 'brand_owned', true, true, 'active', 'unknown'),
  ('42730000-0000-4000-8000-0000000000b3', '42730000-2000-4000-8000-000000000035', 'email', 'unverified@example.test', 'brand_owned', true, true, 'active', 'unknown');
SELECT public.issue_1777_refresh_brand_reach('42730000-0000-4000-8000-0000000000b3', 'follower');
SELECT set_config('request.jwt.claim.sub', '42730000-0000-4000-8000-000000000001', true);

DO $email$
DECLARE
  o1 uuid := '42730000-0000-4000-8000-000000000001'; b3 uuid := '42730000-0000-4000-8000-0000000000b3';
  a3 uuid; c3 uuid; e3 jsonb; send3 jsonb; emails text[];
BEGIN
  PERFORM pg_temp.chk('E-00 fixture: the email arm of the identity read really runs',
    EXISTS (SELECT 1 FROM public.verified_account_identifiers('42730000-0000-4000-8000-000000000041') i WHERE i.kind = 'email' AND i.value = 'muted@example.test')
    AND '42730000-0000-4000-8000-000000000041'::uuid IN (SELECT public.issue_4273_accounts_holding('email', 'MUTED@example.test')), '');
  PERFORM pg_temp.chk('E-01 an unverified address names no account',
    NOT EXISTS (SELECT 1 FROM public.issue_4273_accounts_holding('email', 'unverified@example.test')), '');
  a3 := (public.biz_get_or_create_marketing_combined_audience_v1(o1, b3, '["book","followers"]'::jsonb) ->> 'audienceId')::uuid;
  c3 := pg_temp.draft('42730000-3000-4000-8000-000000000031', o1, b3, a3, 'email');
  e3 := public.biz_marketing_combined_quote_candidates_v1(o1, c3);
  PERFORM public.biz_confirm_marketing_combined_send_v1(o1, c3, '42730000-4000-4000-8000-000000000031', pg_temp.snap(e3), now() + interval '1 hour');
  send3 := public.biz_marketing_combined_send_audience_v1(c3);
  SELECT array_agg(x ->> 'raw_email' ORDER BY x ->> 'raw_email') INTO emails FROM jsonb_array_elements(send3 -> 'rows') x;
  PERFORM pg_temp.chk('E-02 an account that muted the brand stops the Book row on the same address',
    NOT ('muted@example.test' = ANY(emails)), emails::text);
  PERFORM pg_temp.chk('E-03 an account that blocked the host stops the Book row on the same address',
    NOT ('blocker@example.test' = ANY(emails)), emails::text);
  PERFORM pg_temp.chk('E-04 a clean match and a stranger both send, once each',
    emails = ARRAY['fine@example.test', 'plain@example.test', 'unverified@example.test'], emails::text);
  PERFORM pg_temp.chk('E-05 those drops are recorded and counted as not reached',
    (SELECT count(*) FROM public.marketing_combined_send_skips s JOIN public.marketing_book_send_executions e ON e.id = s.execution_id
      WHERE e.campaign_id = c3 AND s.reason = 'contact_match_blocked') >= 2
    AND public.biz_marketing_combined_hidden_skips_v1(c3) = (SELECT count(*) FROM public.marketing_combined_send_skips s
      JOIN public.marketing_book_send_executions e ON e.id = s.execution_id WHERE e.campaign_id = c3 AND s.reason = 'address_duplicate'),
    public.biz_marketing_combined_hidden_skips_v1(c3)::text);
  -- A global opt-out on the account's address, after confirm.
  INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope) VALUES ('fine@example.test', 'email', 'global');
  send3 := public.biz_marketing_combined_send_audience_v1(c3);
  PERFORM pg_temp.chk('E-06 an opt-out on the address after confirm stops the send',
    NOT (send3 -> 'rows' @> '[{"raw_email":"fine@example.test"}]'::jsonb), send3::text);
  DELETE FROM public.marketing_unsubscribes WHERE contact_email = 'fine@example.test';
END;
$email$;

-- #4273 honest count: a one-contact list withheld at send reached nobody and says
-- so, with no reason anywhere the Host can read.
-- b4 probe: the only Book row holds a muted account's phone. b5 control: a stranger's.
-- b6: one Book row whose message the provider really failed.
INSERT INTO auth.users(id, email) VALUES ('42730000-0000-4000-8000-000000000051', 'solo@example.test');
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES ('42730000-0000-4000-8000-000000000051', '+12025556151');
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode)
VALUES ('42730000-0000-4000-8000-000000000051', 'S', 'S', 'r4273-solo', true, true, 'friends');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
SELECT ('42730000-0000-4000-8000-0000000000b' || x)::uuid, '42730000-0000-4000-8000-000000000001', 'Solo ' || x, 'issue-4273r-solo-' || x, 'USD', now(), now()
  FROM unnest(ARRAY['4', '5', '6']) x;
INSERT INTO public.brand_follows(user_id, brand_id, muted_until)
VALUES ('42730000-0000-4000-8000-000000000051', '42730000-0000-4000-8000-0000000000b4', 'infinity');
INSERT INTO public.brand_people(id, brand_id, display_name, record_status)
SELECT ('42730000-2000-4000-8000-00000000004' || x)::uuid, ('42730000-0000-4000-8000-0000000000b' || x)::uuid, 'Solo', 'active'
  FROM unnest(ARRAY['4', '5', '6']) x;
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state, marketing_consent_state) VALUES
  ('42730000-0000-4000-8000-0000000000b4', '42730000-2000-4000-8000-000000000044', 'phone', '+12025556151', 'brand_owned', true, true, 'active', 'unknown'),
  ('42730000-0000-4000-8000-0000000000b5', '42730000-2000-4000-8000-000000000045', 'phone', '+12025556152', 'brand_owned', true, true, 'active', 'unknown'),
  ('42730000-0000-4000-8000-0000000000b6', '42730000-2000-4000-8000-000000000046', 'phone', '+12025556153', 'brand_owned', true, true, 'active', 'unknown');
DO $solo$
DECLARE
  o1 uuid := '42730000-0000-4000-8000-000000000001';
  x text; b uuid; a uuid; c uuid; e jsonb; send jsonb; ids uuid[] := '{}';
  v_probe jsonb; v_control jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', o1::text, true);
  FOREACH x IN ARRAY ARRAY['4', '5', '6'] LOOP
    b := ('42730000-0000-4000-8000-0000000000b' || x)::uuid;
    a := (public.biz_get_or_create_marketing_combined_audience_v1(o1, b, '["book"]'::jsonb) ->> 'audienceId')::uuid;
    c := pg_temp.draft(('42730000-3000-4000-8000-00000000004' || x)::uuid, o1, b, a, 'sms');
    e := public.biz_marketing_combined_quote_candidates_v1(o1, c);
    PERFORM public.biz_confirm_marketing_combined_send_v1(o1, c, ('42730000-4000-4000-8000-00000000004' || x)::uuid, pg_temp.snap(e), now() + interval '1 hour');
    send := public.biz_marketing_combined_send_audience_v1(c);
    -- What the dispatcher does with the rows it was handed.
    INSERT INTO public.marketing_messages(campaign_id, recipient_phone, channel, status, failure_reason)
    SELECT c, r ->> 'raw_phone', 'sms', CASE x WHEN '6' THEN 'failed' ELSE 'sent' END, CASE x WHEN '6' THEN 'provider_error' END
      FROM jsonb_array_elements(send -> 'rows') r;
    PERFORM public.mkt_finalize_campaign(c);
    ids := ids || c;
  END LOOP;
  PERFORM pg_temp.chk('D-00 fixture: the probe really was withheld and the control really sent',
    (SELECT count(*) FROM public.marketing_combined_send_skips s JOIN public.marketing_book_send_executions e ON e.id = s.execution_id
      WHERE e.campaign_id = ids[1] AND s.reason = 'contact_match_blocked') = 1
    AND public.biz_marketing_combined_hidden_skips_v1(ids[1]) = 0
    AND NOT EXISTS (SELECT 1 FROM public.marketing_messages m WHERE m.campaign_id = ids[1])
    AND EXISTS (SELECT 1 FROM public.marketing_messages m WHERE m.campaign_id = ids[2]), '');
  SELECT jsonb_build_object('status', status, 'count', recipient_count, 'sent', sent_at IS NOT NULL) INTO v_probe FROM public.marketing_campaigns WHERE id = ids[1];
  SELECT jsonb_build_object('status', status, 'count', recipient_count, 'sent', sent_at IS NOT NULL) INTO v_control FROM public.marketing_campaigns WHERE id = ids[2];
  PERFORM pg_temp.chk('D-01 a one-contact list withheld at send is not counted as sent',
    v_probe = '{"status":"failed","count":0,"sent":false}'::jsonb
    AND v_control = '{"status":"sent","count":1,"sent":true}'::jsonb, v_probe::text || ' vs ' || v_control::text);
  PERFORM pg_temp.chk('D-02 a genuine provider failure still reads as failed',
    (SELECT status FROM public.marketing_campaigns WHERE id = ids[3]) = 'failed', '');
END;
$solo$;

-- Opt-outs: who the Host can read, and that nobody hidden gets messaged.
-- The follower-only contacts below are in no Book, order or RSVP of the brand.
INSERT INTO public.marketing_unsubscribes(contact_email, contact_phone, channel, scope, brand_id) VALUES
  ('follower-only@example.test', NULL, 'email', 'brand', '42730000-0000-4000-8000-0000000000b1'),
  (NULL, '+12025550999', 'sms', 'brand', '42730000-0000-4000-8000-0000000000b1'),
  ('follower-global@example.test', NULL, 'email', 'global', NULL),
  ('one@example.test', NULL, 'email', 'brand', '42730000-0000-4000-8000-0000000000b1'),
  ('tom@example.test', NULL, 'email', 'global', NULL),
  (NULL, '12025559102', 'sms', 'brand', '42730000-0000-4000-8000-0000000000b1'),
  ('one2@example.test', NULL, 'email', 'brand', '42730000-0000-4000-8000-0000000000b2');
DO $optout$
DECLARE
  o1 uuid := '42730000-0000-4000-8000-000000000001'; b1 uuid := '42730000-0000-4000-8000-0000000000b1';
  v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', o1::text, true);
  v := public.biz_marketing_combined_audience_reach_v1(o1, b1, '["book"]'::jsonb, 'email')::text::jsonb;
  PERFORM pg_temp.chk('U-01 a Book contact''s opt-out still suppresses it', v = '0'::jsonb, v::text);
END;
$optout$;

-- What the Host reads back: Book and legacy buyer rows work; a row the brand did
-- not hold shows no contact by any read, and totals stay whole.
SELECT set_config('request.jwt.claim.sub', '42730000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"42730000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $host$
DECLARE
  c1 uuid := '42730000-3000-4000-8000-000000000001';
  v_rows jsonb; v_phone text;
BEGIN
  SELECT m.recipient_phone INTO v_phone FROM public.marketing_messages m WHERE m.id = '42730000-5000-4000-8000-000000000001';
  PERFORM pg_temp.chk('H-01 a contact the brand itself typed stays readable', v_phone = '+12025556011', COALESCE(v_phone, 'null'));
  PERFORM pg_temp.chk('H-02 a contact the brand did not hold is not readable from the table',
    NOT EXISTS (SELECT 1 FROM public.marketing_messages m WHERE m.id = '42730000-5000-4000-8000-000000000002'), '');
  SELECT jsonb_agg(to_jsonb(r)) INTO v_rows FROM public.biz_marketing_campaign_messages_v1(ARRAY[c1]) r;
  PERFORM pg_temp.chk('H-03 the Host read keeps the row, with no contact and no provider text',
    jsonb_array_length(v_rows) = 4 AND v_rows @> '[{"recipient_email":null,"failure_reason":"not_delivered"}]'::jsonb
    AND v_rows::text !~ 'follower-only', v_rows::text);
  PERFORM pg_temp.chk('U-02 the Host cannot read a follower''s opt-out by email',
    NOT EXISTS (SELECT 1 FROM public.marketing_unsubscribes u WHERE u.contact_email = 'follower-only@example.test'), '');
  PERFORM pg_temp.chk('U-03 nor by phone',
    NOT EXISTS (SELECT 1 FROM public.marketing_unsubscribes u WHERE u.contact_phone = '+12025550999'), '');
  PERFORM pg_temp.chk('U-04 nor a global opt-out of someone the brand does not hold',
    NOT EXISTS (SELECT 1 FROM public.marketing_unsubscribes u WHERE u.contact_email = 'follower-global@example.test'), '');
  PERFORM pg_temp.chk('U-05 a Book contact''s opt-out still shows',
    EXISTS (SELECT 1 FROM public.marketing_unsubscribes u WHERE u.contact_email = 'one@example.test'), '');
  PERFORM pg_temp.chk('U-06 a buyer''s global opt-out still shows, whatever the case',
    EXISTS (SELECT 1 FROM public.marketing_unsubscribes u WHERE u.contact_email = 'tom@example.test'), '');
  PERFORM pg_temp.chk('U-07 a buyer''s phone opt-out still shows, whatever the format',
    EXISTS (SELECT 1 FROM public.marketing_unsubscribes u WHERE u.contact_phone = '12025559102'), '');
  PERFORM pg_temp.chk('U-08 another brand''s opt-out stays another brand''s',
    NOT EXISTS (SELECT 1 FROM public.marketing_unsubscribes u WHERE u.contact_email = 'one2@example.test'), '');
  PERFORM pg_temp.chk('U-09 the check gives no answer about another brand',
    public.issue_4273_host_may_read_unsubscribe('brand', NULL, '42730000-0000-4000-8000-0000000000b2', 'one2@example.test', NULL) IS FALSE, '');
  PERFORM pg_temp.chk('H-05 the read is empty for another brand''s campaign',
    NOT EXISTS (SELECT 1 FROM public.biz_marketing_campaign_messages_v1(ARRAY['42730000-3000-4000-8000-000000000002'::uuid])), '');
  PERFORM pg_temp.chk('H-06 no probing another brand with the contact check',
    public.issue_4273_host_may_read_message_contact('42730000-3000-4000-8000-000000000002', '+12025557021', NULL) IS FALSE, '');
END;
$host$;
RESET ROLE;
DO $grants$
BEGIN
  PERFORM pg_temp.chk('G-01 skips, hidden count and verdict are service-only',
    NOT has_table_privilege('authenticated', 'public.marketing_combined_send_skips', 'SELECT')
    AND NOT has_function_privilege('authenticated', 'public.biz_marketing_combined_hidden_skips_v1(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4273_send_verdict(uuid,uuid,text,text,uuid,uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4273_accounts_holding(text,text)', 'EXECUTE'), '');
END;
$grants$;

DO $report$
DECLARE v text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY id) INTO v FROM r4273_fail;
  IF v IS NOT NULL THEN RAISE EXCEPTION E'#4273 rework FAIL:\n%', v; END IF;
END;
$report$;

ROLLBACK;
