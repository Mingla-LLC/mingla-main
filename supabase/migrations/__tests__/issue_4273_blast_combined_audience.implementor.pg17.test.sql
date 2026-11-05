-- #4273 wave B — one Blast, several groups, several methods.
-- Runs on the fully applied migration chain.
--
-- MINGLA-INVARIANT: I-4273-BLAST-PERSON-COUNTS-ONCE | issue #4273 | Across every picked group and every method of one Blast, a person (same account, email or phone) is one candidate, one sealed target and one message.
-- MINGLA-INVARIANT: I-4273-BLAST-QUOTE-EQUALS-SEALED-SET | issue #4273 | What a combined Blast seals at confirm is exactly the set its 5-minute quote priced; any change is a stale preview (PT409), and send re-decides each sealed person.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1', 'manual_contact_groups_v1',
  'brand_circle_followers_v1', 'brand_circle_followers_email_v1', 'brand_circle_followers_sms_v1');

-- Owner 01; Ann 02 (follower + Book); Ben 03 (follower only); Mia 04 (muted
-- follower + Book); Zed 05 (another brand's owner).
INSERT INTO auth.users(id) VALUES
  ('42739200-0000-4000-8000-000000000001'),
  ('42739200-0000-4000-8000-000000000002'),
  ('42739200-0000-4000-8000-000000000003'),
  ('42739200-0000-4000-8000-000000000004'),
  ('42739200-0000-4000-8000-000000000005');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('42739200-0000-4000-8000-000000000001', 'owner-4273b@example.test'),
  ('42739200-0000-4000-8000-000000000005', 'zed-4273b@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('42739200-0000-4000-8000-000000000010', '42739200-0000-4000-8000-000000000001',
   'Harmattan', 'issue-4273b-harmattan', 'USD', now(), now()),
  ('42739200-0000-4000-8000-000000000011', '42739200-0000-4000-8000-000000000005',
   'Other', 'issue-4273b-other', 'USD', now(), now());
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode) VALUES
  ('42739200-0000-4000-8000-000000000002', 'Ann', 'Ann', 'b4273-ann', true, true, 'friends'),
  ('42739200-0000-4000-8000-000000000003', 'Ben', 'Ben', 'b4273-ben', true, true, 'friends'),
  ('42739200-0000-4000-8000-000000000004', 'Mia', 'Mia', 'b4273-mia', true, true, 'friends');
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
  ('42739200-0000-4000-8000-000000000003', '+12025550103');
INSERT INTO public.brand_follows(user_id, brand_id, muted_until) VALUES
  ('42739200-0000-4000-8000-000000000002', '42739200-0000-4000-8000-000000000010', NULL),
  ('42739200-0000-4000-8000-000000000003', '42739200-0000-4000-8000-000000000010', NULL),
  ('42739200-0000-4000-8000-000000000004', '42739200-0000-4000-8000-000000000010', 'infinity');
INSERT INTO public.brand_people(id, brand_id, linked_user_id, display_name, record_status) VALUES
  ('42739200-2000-4000-8000-000000000001', '42739200-0000-4000-8000-000000000010', '42739200-0000-4000-8000-000000000002', 'Ann Book', 'active'),
  ('42739200-2000-4000-8000-000000000002', '42739200-0000-4000-8000-000000000010', NULL, 'Cara Book', 'active'),
  ('42739200-2000-4000-8000-000000000003', '42739200-0000-4000-8000-000000000010', '42739200-0000-4000-8000-000000000004', 'Mia Book', 'active'),
  ('42739200-2000-4000-8000-000000000004', '42739200-0000-4000-8000-000000000010', NULL, 'Gia Book', 'active');
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state) VALUES
  ('42739200-0000-4000-8000-000000000010', '42739200-2000-4000-8000-000000000001', 'phone', '+12025550102', 'brand_owned', true, true, 'active'),
  ('42739200-0000-4000-8000-000000000010', '42739200-2000-4000-8000-000000000002', 'phone', '+12025550201', 'brand_owned', true, true, 'active'),
  ('42739200-0000-4000-8000-000000000010', '42739200-2000-4000-8000-000000000002', 'email', 'cara@example.test', 'brand_owned', true, true, 'active'),
  ('42739200-0000-4000-8000-000000000010', '42739200-2000-4000-8000-000000000003', 'phone', '+12025550104', 'brand_owned', true, true, 'active'),
  ('42739200-0000-4000-8000-000000000010', '42739200-2000-4000-8000-000000000004', 'phone', '+12025550202', 'brand_owned', true, true, 'active'),
  ('42739200-0000-4000-8000-000000000010', '42739200-2000-4000-8000-000000000004', 'email', 'gia@example.test', 'brand_owned', true, true, 'active');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme) VALUES
  ('42739200-1000-4000-8000-000000000001', '42739200-0000-4000-8000-000000000010', '42739200-0000-4000-8000-000000000001',
   'Highlife', 'b4273-highlife', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb),
  ('42739200-1000-4000-8000-000000000002', '42739200-0000-4000-8000-000000000011', '42739200-0000-4000-8000-000000000005',
   'Other night', 'b4273-other', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
-- Cara also bought (same contact as her Book row, different case); Dan and Eve
-- are known only from orders; Fay's phone said STOP; Gia is in the Book too, but
-- the phone on her order said STOP, which blocks her; Zoe's order is another brand's.
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source) VALUES
  ('42739200-1100-4000-8000-000000000001', '42739200-1000-4000-8000-000000000001', 'CARA@example.test', NULL, 'Cara Buyer', 1000, 'USD', 'paid', 'legacy'),
  ('42739200-1100-4000-8000-000000000002', '42739200-1000-4000-8000-000000000001', 'dan@example.test', '+12025550301', 'Dan Buyer', 1000, 'USD', 'paid', 'legacy'),
  ('42739200-1100-4000-8000-000000000003', '42739200-1000-4000-8000-000000000001', 'dan@example.test', '+12025550301', 'Dan Buyer', 2000, 'USD', 'paid', 'legacy'),
  ('42739200-1100-4000-8000-000000000004', '42739200-1000-4000-8000-000000000001', 'eve@example.test', NULL, 'Eve Buyer', 1000, 'USD', 'paid', 'legacy'),
  ('42739200-1100-4000-8000-000000000005', '42739200-1000-4000-8000-000000000001', 'fay@example.test', '+12025550302', 'Fay Buyer', 1000, 'USD', 'paid', 'legacy'),
  ('42739200-1100-4000-8000-000000000006', '42739200-1000-4000-8000-000000000002', 'zoe@example.test', '+12025550303', 'Zoe Buyer', 1000, 'USD', 'paid', 'legacy'),
  ('42739200-1100-4000-8000-000000000007', '42739200-1000-4000-8000-000000000001', 'gia@example.test', '+12025550402', 'Gia Buyer', 1000, 'USD', 'paid', 'legacy');
INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
VALUES (NULL, '+12025550302', 'sms', 'marketing', 'stop_keyword'),
  (NULL, '+12025550402', 'sms', 'marketing', 'stop_keyword');
SELECT public.issue_1777_refresh_brand_reach('42739200-0000-4000-8000-000000000010', 'follower');
SELECT set_config('request.jwt.claim.sub', '42739200-0000-4000-8000-000000000001', true);

CREATE FUNCTION pg_temp.b4273_snapshot(p_envelope jsonb) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'quoteVersion', 1, 'quoteHash', repeat('a', 64), 'contentHash', repeat('b', 64),
    'quotedAt', now(), 'brandId', p_envelope -> 'brandId', 'content', p_envelope -> 'content',
    'audienceId', p_envelope -> 'audienceId', 'audienceKind', p_envelope -> 'audienceKind',
    'audienceVersion', p_envelope -> 'audienceVersion', 'selectedCount', p_envelope -> 'selectedCount',
    'reachableCount', (SELECT count(*) FROM jsonb_array_elements(p_envelope -> 'candidates') x
                        WHERE (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL),
    'suppressedCount', (SELECT count(*) FROM jsonb_array_elements(p_envelope -> 'candidates') x
                         WHERE NOT (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL),
    'unavailableCount', (SELECT count(*) FROM jsonb_array_elements(p_envelope -> 'candidates') x
                          WHERE x ->> 'normalizedContact' IS NULL),
    'smsSegments', 0, 'costKind', 'not_metered', 'estimatedCostMinor', NULL, 'currency', NULL,
    'candidates', p_envelope -> 'candidates')
$f$;

DO $cases$
DECLARE
  v_owner uuid := '42739200-0000-4000-8000-000000000001';
  v_brand uuid := '42739200-0000-4000-8000-000000000010';
  v_group uuid; v_audience jsonb; v_second jsonb; v_all jsonb; v_summary jsonb;
  v_sms uuid := '42739200-3000-4000-8000-000000000001';
  v_push uuid := '42739200-3000-4000-8000-000000000002';
  v_env jsonb; v_snapshot jsonb; v_confirm jsonb; v_replay jsonb; v_send jsonb; v_push_env jsonb;
  v_usage jsonb; v_failed boolean;
BEGIN
  v_group := (public.biz_create_manual_group_v1(v_brand, 'VIP', ARRAY[
    '42739200-2000-4000-8000-000000000001'::uuid, '42739200-2000-4000-8000-000000000002'::uuid],
    '{}', '42739200-4000-4000-8000-000000000001') -> 'group' ->> 'groupId')::uuid;
  IF v_group IS NULL THEN
    SELECT id INTO v_group FROM public.marketing_audiences
     WHERE brand_id = v_brand AND query_definition = '{"kind":"manual_group"}'::jsonb;
  END IF;
  v_all := jsonb_build_array('book', 'followers', 'group:' || v_group, 'brand_buyers');

  -- C-01 The audience is one sorted row per source set, named for the host.
  v_audience := public.biz_get_or_create_marketing_combined_audience_v1(v_owner, v_brand, v_all);
  v_second := public.biz_get_or_create_marketing_combined_audience_v1(v_owner, v_brand,
    jsonb_build_array('brand_buyers', 'book', 'group:' || v_group, 'followers', 'book'));
  IF v_audience ->> 'audienceId' IS DISTINCT FROM v_second ->> 'audienceId'
     OR v_audience ->> 'name' IS DISTINCT FROM 'Your Book + Followers + VIP + All buyers of Harmattan' THEN
    RAISE EXCEPTION 'C-01 FAIL: % / %', v_audience, v_second;
  END IF;

  -- C-02 Another brand's group or event, or an unknown key, is refused.
  FOR v_failed IN SELECT true LOOP
    BEGIN
      PERFORM public.biz_get_or_create_marketing_combined_audience_v1(v_owner, v_brand,
        jsonb_build_array('event:42739200-1000-4000-8000-000000000002'));
      RAISE EXCEPTION 'C-02 FAIL: another brand''s buyers accepted';
    EXCEPTION WHEN no_data_found THEN NULL;
    END;
    BEGIN
      PERFORM public.biz_get_or_create_marketing_combined_audience_v1(v_owner, v_brand, '["everyone"]'::jsonb);
      RAISE EXCEPTION 'C-02 FAIL: unknown key accepted';
    EXCEPTION WHEN no_data_found THEN NULL;
    END;
  END LOOP;

  -- C-03 Summary: one person once across groups; totals only, no contact.
  -- Ann, Cara, Mia, Gia (Book) + Ben (follower) + Dan, Eve, Fay (buyers) = 8.
  v_summary := public.biz_marketing_combined_audience_summary_v1(v_owner, v_brand, v_all);
  IF (v_summary ->> 'peopleCount')::int <> 8
     OR (v_summary ->> 'followersTotal')::int <> 3
     OR (v_summary ->> 'followersAlsoInBook')::int <> 2
     OR v_summary::text ~ '@|\+1202' THEN
    RAISE EXCEPTION 'C-03 FAIL: %', v_summary;
  END IF;
  IF (SELECT (x ->> 'alsoInBookCount')::int FROM jsonb_array_elements(v_summary -> 'sources') x
       WHERE x ->> 'key' = 'followers') <> 2 THEN
    RAISE EXCEPTION 'C-03 FAIL: followers overlap %', v_summary;
  END IF;

  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (v_sms, v_owner, v_brand, (v_audience ->> 'audienceId')::uuid, 'SMS part', 'sms',
    '{"kind":"sms","body":"Doors at 9."}', 'draft');

  -- C-04 SMS candidates: each person once. Mia is muted (her Book contact does
  -- not bring her back), Fay said STOP, Gia's order phone said STOP (the
  -- strictest identity wins), Eve has no phone.
  v_env := public.biz_marketing_combined_quote_candidates_v1(v_owner, v_sms);
  IF (v_env ->> 'selectedCount')::int <> 8
     OR jsonb_array_length(v_env -> 'candidates') <> 8
     OR (SELECT count(*) FROM jsonb_array_elements(v_env -> 'candidates') x WHERE (x ->> 'allowed')::boolean) <> 4
     OR (SELECT count(DISTINCT x ->> 'personKey') FROM jsonb_array_elements(v_env -> 'candidates') x) <> 8
     OR (SELECT count(DISTINCT x ->> 'normalizedContact') FROM jsonb_array_elements(v_env -> 'candidates') x
          WHERE x ->> 'normalizedContact' IS NOT NULL) <> 7 THEN
    RAISE EXCEPTION 'C-04 FAIL: %', v_env;
  END IF;
  IF NOT (v_env -> 'candidates' @> '[{"normalizedContact":"+12025550104","allowed":false},{"normalizedContact":"+12025550302","allowed":false},{"normalizedContact":"+12025550402","allowed":false}]'::jsonb) THEN
    RAISE EXCEPTION 'C-04 FAIL: mute or STOP not honoured %', v_env;
  END IF;
  -- C-05 A stale preview is PT409, never 40001.
  v_snapshot := pg_temp.b4273_snapshot(v_env);
  BEGIN
    UPDATE public.brand_follows SET muted_until = 'infinity'
     WHERE user_id = '42739200-0000-4000-8000-000000000002' AND brand_id = v_brand;
    PERFORM public.biz_confirm_marketing_combined_send_v1(v_owner, v_sms,
      '42739200-4000-4000-8000-000000000002', v_snapshot, NULL);
    RAISE EXCEPTION 'C-05 FAIL: drift confirmed';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    IF SQLERRM NOT LIKE '%book_blast_preview_stale%' THEN RAISE; END IF;
  END;

  -- C-06 Confirm seals exactly the quoted set; the replay is idempotent.
  v_confirm := public.biz_confirm_marketing_combined_send_v1(v_owner, v_sms,
    '42739200-4000-4000-8000-000000000002', v_snapshot, now() + interval '1 hour');
  v_replay := public.biz_confirm_marketing_combined_send_v1(v_owner, v_sms,
    '42739200-4000-4000-8000-000000000002', v_snapshot, now() + interval '1 hour');
  IF (v_replay ->> 'replay')::boolean IS NOT TRUE
     OR (SELECT count(*) FROM public.marketing_book_send_targets t
          WHERE t.execution_id = (v_confirm ->> 'executionId')::uuid) <> 8
     OR (SELECT count(*) FROM public.marketing_book_send_targets t
          WHERE t.execution_id = (v_confirm ->> 'executionId')::uuid AND t.outcome = 'queued') <> 4
     OR (SELECT reachable_count FROM public.marketing_book_send_executions
          WHERE id = (v_confirm ->> 'executionId')::uuid) <> 4
     OR (SELECT count(*) FROM public.marketing_book_send_targets t
          WHERE t.execution_id = (v_confirm ->> 'executionId')::uuid AND t.buyer_contact_key IS NOT NULL) <> 4 THEN
    RAISE EXCEPTION 'C-06 FAIL: sealed set differs from quote';
  END IF;

  -- C-07 Send re-decides per person: Ann, Ben, Cara, Dan today; once Dan says
  -- STOP and Ben mutes, only the two others remain. Each contact appears once.
  v_send := public.biz_marketing_combined_send_audience_v1(v_sms);
  IF jsonb_array_length(v_send -> 'rows') <> 4
     OR (SELECT count(DISTINCT x ->> 'raw_phone') FROM jsonb_array_elements(v_send -> 'rows') x) <> 4 THEN
    RAISE EXCEPTION 'C-07 FAIL: %', v_send;
  END IF;
  INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
  VALUES (NULL, '+12025550301', 'sms', 'marketing', 'stop_keyword');
  UPDATE public.brand_follows SET muted_until = 'infinity'
   WHERE user_id = '42739200-0000-4000-8000-000000000003' AND brand_id = v_brand;
  v_send := public.biz_marketing_combined_send_audience_v1(v_sms);
  IF jsonb_array_length(v_send -> 'rows') <> 2 THEN
    RAISE EXCEPTION 'C-07 FAIL: send time ignored opt-outs %', v_send;
  END IF;
  UPDATE public.brand_follows SET muted_until = NULL
   WHERE user_id IN ('42739200-0000-4000-8000-000000000002', '42739200-0000-4000-8000-000000000003') AND brand_id = v_brand;

  -- C-08 Push: refused while a buyer list is picked (unchanged rule, no subset).
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id)
  VALUES (v_push, v_owner, v_brand, (v_audience ->> 'audienceId')::uuid, 'Push part', 'push',
    '{"kind":"push","body":"Doors at 9.","title":"Highlife"}', 'draft', v_sms);
  BEGIN
    PERFORM public.biz_marketing_push_quote_candidates_v1(v_owner, v_push);
    RAISE EXCEPTION 'C-08 FAIL: push to a buyer list';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  -- C-09 Push without buyers: Ann once though she is follower and Book; the
  -- muted follower is skipped; the person key matches the SMS lane's.
  v_second := public.biz_get_or_create_marketing_combined_audience_v1(v_owner, v_brand,
    jsonb_build_array('book', 'followers'));
  UPDATE public.marketing_campaigns SET audience_id = (v_second ->> 'audienceId')::uuid WHERE id = v_push;
  v_push_env := public.biz_marketing_push_quote_candidates_v1(v_owner, v_push);
  IF (v_push_env ->> 'selectedCount')::int <> 3
     OR (SELECT count(*) FROM jsonb_array_elements(v_push_env -> 'candidates') x WHERE (x ->> 'allowed')::boolean) <> 2
     OR NOT (v_push_env -> 'candidates' @> '[{"recipientUserId":"42739200-0000-4000-8000-000000000002","reason":"follower"}]'::jsonb) THEN
    RAISE EXCEPTION 'C-09 FAIL: %', v_push_env;
  END IF;

  -- C-10 One campaign counts once toward the week, whatever its methods.
  PERFORM public.biz_confirm_marketing_push_send_v1(v_owner, v_push,
    '42739200-4000-4000-8000-000000000003',
    jsonb_build_object('quoteVersion', 1, 'quoteHash', repeat('c', 64), 'contentHash', repeat('d', 64),
      'quotedAt', now(), 'brandId', v_brand, 'content', v_push_env -> 'content',
      'audienceId', v_push_env -> 'audienceId', 'audienceKind', v_push_env -> 'audienceKind',
      'selectedCount', v_push_env -> 'selectedCount', 'reachableCount', 2,
      'candidates', v_push_env -> 'candidates'), NULL);
  v_usage := public.biz_brand_blast_usage_v1(v_owner, v_brand);
  IF (v_usage ->> 'blastsThisWeek')::int <> 1 OR (v_usage ->> 'smsUsed')::int <> 4 OR (v_usage ->> 'pushUsed')::int <> 2 THEN
    RAISE EXCEPTION 'C-10 FAIL: %', v_usage;
  END IF;

  -- C-11 An older build's plain schedule cannot strand a combined draft, and
  -- nothing claims a combined campaign without its sealed execution.
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES ('42739200-3000-4000-8000-000000000003', v_owner, v_brand, (v_second ->> 'audienceId')::uuid, 'Old build', 'email',
    '{"kind":"email","subject":"Hi","body_html":"Hi","body_text":"Hi"}', 'draft');
  BEGIN
    UPDATE public.marketing_campaigns SET status = 'scheduled', scheduled_for = now()
     WHERE id = '42739200-3000-4000-8000-000000000003';
    RAISE EXCEPTION 'C-11 FAIL: scheduled with no sealed execution';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;

  -- C-12 Old shapes keep working: the Book lane still refuses a combined
  -- audience and still serves its own, untouched.
  BEGIN
    PERFORM public.biz_marketing_book_quote_candidates(v_owner, '42739200-3000-4000-8000-000000000003');
    RAISE EXCEPTION 'C-12 FAIL: book lane accepted a combined audience';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  IF NOT has_function_privilege('authenticated', 'public.biz_get_or_create_marketing_combined_audience_v1(uuid,uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.biz_marketing_combined_quote_candidates_v1(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.biz_marketing_combined_send_audience_v1(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4273_combined_identities(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'C-12 FAIL: grants';
  END IF;
END;
$cases$;

ROLLBACK;
