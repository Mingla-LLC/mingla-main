-- #3682 closeout wave 2 (B) — push campaign channel and multi-channel
-- campaigns. Runs on the fully applied migration chain.
--
-- MINGLA-INVARIANT: I-3682-CAMPAIGN-GROUP-COUNTS-ONCE | issue #3682 | A multi-channel campaign (one campaign_group_id) counts as one blast toward the rolling-week warning.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('brand_circle_followers_v1', 'contact_import_v1', 'brand_book_blast_v1');

INSERT INTO auth.users(id) VALUES
  ('36829400-0000-4000-8000-000000000001'),
  ('36829400-0000-4000-8000-000000000002'),
  ('36829400-0000-4000-8000-000000000003'),
  ('36829400-0000-4000-8000-000000000004'),
  ('36829400-0000-4000-8000-000000000005');
INSERT INTO public.creator_accounts(id, email)
VALUES ('36829400-0000-4000-8000-000000000001', 'owner-3682p@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES ('36829400-0000-4000-8000-000000000010', '36829400-0000-4000-8000-000000000001',
  'Push Brand', 'issue-3682-push-brand', 'USD', now(), now());
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode)
VALUES
  ('36829400-0000-4000-8000-000000000002', 'Ann', 'Ann', 'push-3682-ann', true, true, 'friends'),
  ('36829400-0000-4000-8000-000000000003', 'Ben', 'Ben', 'push-3682-ben', true, true, 'friends'),
  ('36829400-0000-4000-8000-000000000004', 'Cat', 'Cat', 'push-3682-cat', true, true, 'friends'),
  ('36829400-0000-4000-8000-000000000005', 'Dan', 'Dan', 'push-3682-dan', true, true, 'friends');
INSERT INTO public.brand_follows(user_id, brand_id, muted_until) VALUES
  ('36829400-0000-4000-8000-000000000002', '36829400-0000-4000-8000-000000000010', NULL),
  ('36829400-0000-4000-8000-000000000003', '36829400-0000-4000-8000-000000000010', 'infinity'),
  ('36829400-0000-4000-8000-000000000004', '36829400-0000-4000-8000-000000000010', NULL),
  ('36829400-0000-4000-8000-000000000005', '36829400-0000-4000-8000-000000000010', NULL);
-- Cat turned push off for this brand; email stays on (unsubscribe ≠ push).
INSERT INTO public.brand_follow_channel_prefs(user_id, brand_id, channel, enabled) VALUES
  ('36829400-0000-4000-8000-000000000004', '36829400-0000-4000-8000-000000000010', 'push', false),
  ('36829400-0000-4000-8000-000000000002', '36829400-0000-4000-8000-000000000010', 'email', false);
INSERT INTO public.marketing_audiences(id, account_id, brand_id, name, query_definition, is_system_generated)
VALUES
  ('36829400-2000-4000-8000-000000000001', '36829400-0000-4000-8000-000000000001',
   '36829400-0000-4000-8000-000000000010', 'Followers',
   jsonb_build_object('kind', 'brand_followers', 'brand_id', '36829400-0000-4000-8000-000000000010'), true),
  ('36829400-2000-4000-8000-000000000002', '36829400-0000-4000-8000-000000000001',
   '36829400-0000-4000-8000-000000000010', 'Buyers',
   jsonb_build_object('kind', 'brand_buyers', 'brand_id', '36829400-0000-4000-8000-000000000010'), true);

-- B-01 Existing single-channel campaigns keep their own group (backfill shape).
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
VALUES ('36829400-3000-4000-8000-000000000001', '36829400-0000-4000-8000-000000000001',
  '36829400-0000-4000-8000-000000000010', '36829400-2000-4000-8000-000000000001', 'Email part', 'email',
  '{"kind":"email","subject":"Hi","body_html":"Hi","body_text":"Hi"}', 'draft');
DO $b1$
BEGIN
  IF (SELECT campaign_group_id FROM public.marketing_campaigns
       WHERE id = '36829400-3000-4000-8000-000000000001') <> '36829400-3000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'B-01 FAIL: a new campaign must be its own group';
  END IF;
  IF EXISTS (SELECT 1 FROM public.marketing_campaigns c
              WHERE c.campaign_group_id IS NOT NULL AND c.campaign_group_id <> c.id
                AND NOT EXISTS (SELECT 1 FROM public.marketing_campaigns p WHERE p.id = c.campaign_group_id)) THEN
    RAISE EXCEPTION 'B-01 FAIL: a campaign points at a group that does not exist';
  END IF;
END;
$b1$;

-- B-02 A push sibling joins the email campaign's group; a second email sibling
-- or a foreign group is refused.
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id)
VALUES ('36829400-3000-4000-8000-000000000002', '36829400-0000-4000-8000-000000000001',
  '36829400-0000-4000-8000-000000000010', '36829400-2000-4000-8000-000000000001', 'Push part', 'push',
  '{"kind":"push","body":"Doors at 9. New dates added."}', 'draft', '36829400-3000-4000-8000-000000000001');
DO $b2$
BEGIN
  BEGIN
    INSERT INTO public.marketing_campaigns(account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id)
    VALUES ('36829400-0000-4000-8000-000000000001', '36829400-0000-4000-8000-000000000010',
      '36829400-2000-4000-8000-000000000001', 'Dup', 'email',
      '{"kind":"email","subject":"x","body_html":"x"}', 'draft', '36829400-3000-4000-8000-000000000001');
    RAISE EXCEPTION 'B-02 FAIL: two email rows in one campaign';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.marketing_campaigns(account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id)
    VALUES ('36829400-0000-4000-8000-000000000001', '36829400-0000-4000-8000-000000000010',
      '36829400-2000-4000-8000-000000000001', 'Foreign', 'sms',
      '{"kind":"sms","body":"x"}', 'draft', gen_random_uuid());
    RAISE EXCEPTION 'B-02 FAIL: joined a group that does not exist';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    UPDATE public.marketing_campaigns SET status = 'scheduled',
      channel_payload = '{"kind":"push","body":"  "}' WHERE id = '36829400-3000-4000-8000-000000000002';
    RAISE EXCEPTION 'B-02 FAIL: an empty push left draft';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$b2$;

-- Dan unfollows after confirm (below) to prove the send-time re-check.
DO $b3$
DECLARE v_quote jsonb; v_snapshot jsonb; v_confirm jsonb; v_replay jsonb; v_work jsonb; v_usage jsonb;
BEGIN
  v_quote := public.biz_marketing_push_quote_candidates_v1(
    '36829400-0000-4000-8000-000000000001', '36829400-3000-4000-8000-000000000002');
  -- B-03 Ann (email off, push on) and Dan reachable; Ben muted; Cat push off.
  IF (v_quote ->> 'selectedCount')::int <> 4
     OR (SELECT count(*) FROM jsonb_array_elements(v_quote -> 'candidates') x WHERE (x ->> 'allowed')::boolean) <> 2
     OR NOT (v_quote -> 'candidates' @> '[{"recipientUserId":"36829400-0000-4000-8000-000000000003","safeReasonCode":"muted_or_off"},{"recipientUserId":"36829400-0000-4000-8000-000000000004","safeReasonCode":"muted_or_off"},{"recipientUserId":"36829400-0000-4000-8000-000000000002","allowed":true}]'::jsonb)
     OR v_quote::text LIKE '%@%' THEN
    RAISE EXCEPTION 'B-03 FAIL: push quote %', v_quote;
  END IF;
  -- B-04 Contact-list audiences cannot be pushed.
  UPDATE public.marketing_campaigns SET audience_id = '36829400-2000-4000-8000-000000000002'
   WHERE id = '36829400-3000-4000-8000-000000000002';
  BEGIN
    PERFORM public.biz_marketing_push_quote_candidates_v1(
      '36829400-0000-4000-8000-000000000001', '36829400-3000-4000-8000-000000000002');
    RAISE EXCEPTION 'B-04 FAIL: buyer list accepted for push';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;
  UPDATE public.marketing_campaigns SET audience_id = '36829400-2000-4000-8000-000000000001'
   WHERE id = '36829400-3000-4000-8000-000000000002';

  v_snapshot := jsonb_build_object(
    'quoteVersion', 1, 'quoteHash', repeat('d', 64), 'contentHash', repeat('e', 64),
    'quotedAt', now(), 'brandId', '36829400-0000-4000-8000-000000000010',
    'content', v_quote -> 'content', 'audienceId', v_quote ->> 'audienceId',
    'audienceKind', v_quote ->> 'audienceKind', 'selectedCount', 4, 'reachableCount', 2,
    'candidates', v_quote -> 'candidates');
  -- B-05 A drifted candidate list is refused with PT409, never 40001.
  BEGIN
    PERFORM public.biz_confirm_marketing_push_send_v1(
      '36829400-0000-4000-8000-000000000001', '36829400-3000-4000-8000-000000000002',
      '36829400-4000-4000-8000-000000000001',
      jsonb_set(v_snapshot, '{candidates}', '[]'::jsonb), NULL);
    RAISE EXCEPTION 'B-05 FAIL: drifted snapshot accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  v_confirm := public.biz_confirm_marketing_push_send_v1(
    '36829400-0000-4000-8000-000000000001', '36829400-3000-4000-8000-000000000002',
    '36829400-4000-4000-8000-000000000001', v_snapshot, NULL);
  v_replay := public.biz_confirm_marketing_push_send_v1(
    '36829400-0000-4000-8000-000000000001', '36829400-3000-4000-8000-000000000002',
    '36829400-4000-4000-8000-000000000001', v_snapshot, NULL);
  IF (v_confirm ->> 'replay')::boolean OR NOT (v_replay ->> 'replay')::boolean
     OR (SELECT count(*) FROM public.marketing_push_messages
          WHERE campaign_id = '36829400-3000-4000-8000-000000000002') <> 2
     OR (SELECT cost_kind FROM public.marketing_book_send_executions
          WHERE campaign_id = '36829400-3000-4000-8000-000000000002') <> 'not_metered' THEN
    RAISE EXCEPTION 'B-06 FAIL: confirm/replay % / %', v_confirm, v_replay;
  END IF;

  -- B-07 Unfollow stops everything, even after confirm.
  DELETE FROM public.brand_follows WHERE user_id = '36829400-0000-4000-8000-000000000005'
    AND brand_id = '36829400-0000-4000-8000-000000000010';
  v_work := public.biz_marketing_push_send_worklist_v1('36829400-3000-4000-8000-000000000002');
  IF jsonb_array_length(v_work -> 'work') <> 1
     OR v_work -> 'work' -> 0 ->> 'userId' <> '36829400-0000-4000-8000-000000000002'
     OR v_work ->> 'brandSlug' <> 'issue-3682-push-brand'
     OR (SELECT failure_reason FROM public.marketing_push_messages
          WHERE user_id = '36829400-0000-4000-8000-000000000005') <> 'unfollowed' THEN
    RAISE EXCEPTION 'B-07 FAIL: worklist %', v_work;
  END IF;
  UPDATE public.marketing_push_messages SET status = 'sent', sent_at = now()
   WHERE campaign_id = '36829400-3000-4000-8000-000000000002' AND status = 'queued';
  IF public.mkt_finalize_campaign('36829400-3000-4000-8000-000000000002') <> 'sent'
     OR (SELECT recipient_count FROM public.marketing_campaigns
          WHERE id = '36829400-3000-4000-8000-000000000002') <> 1 THEN
    RAISE EXCEPTION 'B-08 FAIL: push finalize';
  END IF;

  -- B-09 The email half of the same campaign counts as the same blast.
  INSERT INTO public.marketing_book_send_executions(
    brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash, content_hash,
    selected_count, reachable_count, suppressed_count, unavailable_count, sms_segment_count,
    estimated_cost_minor, currency, cost_kind, quoted_at, scheduled_for, send_mode)
  VALUES ('36829400-0000-4000-8000-000000000010', '36829400-3000-4000-8000-000000000001',
    '36829400-0000-4000-8000-000000000001', gen_random_uuid(), 1, repeat('f', 64), repeat('f', 64),
    1, 1, 0, 0, 0, NULL, NULL, 'not_metered', now(), now(), 'now');
  v_usage := public.biz_brand_blast_usage_v1(
    '36829400-0000-4000-8000-000000000001', '36829400-0000-4000-8000-000000000010');
  IF (v_usage ->> 'blastsThisWeek')::int <> 1 OR (v_usage ->> 'pushUsed')::int <> 2
     OR (v_usage ->> 'emailUsed')::int <> 1 OR v_usage ->> 'pushRemaining' IS NOT NULL THEN
    RAISE EXCEPTION 'B-09 FAIL: usage %', v_usage;
  END IF;
END;
$b3$;

-- B-10 Push recipients are never readable by a signed-in host.
DO $b4$
BEGIN
  IF has_table_privilege('authenticated', 'public.marketing_push_messages', 'SELECT')
     OR has_function_privilege('authenticated',
       'public.biz_marketing_push_quote_candidates_v1(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B-10 FAIL: push recipients exposed to authenticated';
  END IF;
END;
$b4$;

ROLLBACK;
