\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t2714 (k text primary key, v uuid);

DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid; v_audience uuid; v_campaign uuid; v_message uuid;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (gen_random_uuid(), v_user, 'i2714 brand', 'i2714-' || substr(md5(random()::text),1,8))
  RETURNING id INTO v_brand;
  INSERT INTO public.marketing_audiences
    (id, account_id, brand_id, name, query_definition, is_system_generated)
  VALUES (gen_random_uuid(), v_user, v_brand, 'i2714 audience',
    jsonb_build_object('kind','brand_buyers','brand_id',v_brand::text), true)
  RETURNING id INTO v_audience;
  INSERT INTO public.marketing_campaigns
    (id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (gen_random_uuid(), v_user, v_brand, v_audience, 'i2714', 'email',
    jsonb_build_object('kind','email','subject','s','body_html','b'), 'sent')
  RETURNING id INTO v_campaign;
  INSERT INTO public.marketing_messages
    (id, campaign_id, recipient_email, channel, status, sent_at)
  VALUES (gen_random_uuid(), v_campaign, 'early@example.test', 'email', 'sent', now())
  RETURNING id INTO v_message;
  INSERT INTO t2714 VALUES ('message', v_message);
END $$;

-- Provider event wins the race. It is retained and classified by the exact From domain.
DO $$
DECLARE v_result text; v_count integer;
BEGIN
  v_result := public.mkt_ingest_email_event(
    'svix_2714_early', 'email.opened', 'provider-2714-early',
    jsonb_build_object(
      'type','email.opened', 'created_at','2026-08-27T10:00:00Z',
      'data', jsonb_build_object('from','Mingla <news@campaigns.usemingla.com>')
    ));
  IF v_result <> 'campaign_unmatched' THEN
    RAISE EXCEPTION '#2714 early event was not retryable: %', v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public.marketing_email_events
   WHERE svix_id='svix_2714_early' AND is_campaign_event AND message_id IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION '#2714 early event was lost'; END IF;
END $$;

-- Writing the provider id reconciles exactly once and keeps eligibility explicit.
DO $$
DECLARE v_message uuid := (SELECT v FROM t2714 WHERE k='message');
  v_open_count integer; v_opened timestamptz; v_event_message uuid; v_attempts integer;
BEGIN
  UPDATE public.marketing_messages SET
    provider_message_id='provider-2714-early',
    delivery_tracking_eligible_at=now(), open_tracking_eligible_at=now(),
    tracking_sender_domain='campaigns.usemingla.com'
  WHERE id=v_message;
  SELECT open_count, opened_at INTO v_open_count, v_opened
    FROM public.marketing_messages WHERE id=v_message;
  SELECT message_id, reconcile_attempt_count INTO v_event_message, v_attempts
    FROM public.marketing_email_events WHERE svix_id='svix_2714_early';
  IF v_open_count <> 1 OR v_opened IS NULL OR v_event_message <> v_message THEN
    RAISE EXCEPTION '#2714 trigger did not reconcile the early event exactly once';
  END IF;
  PERFORM public.mkt_reconcile_email_event('svix_2714_early');
  IF (SELECT open_count FROM public.marketing_messages WHERE id=v_message) <> 1 THEN
    RAISE EXCEPTION '#2714 duplicate reconciliation inflated opens';
  END IF;
  IF v_attempts < 2 THEN RAISE EXCEPTION '#2714 reconciliation audit was not recorded'; END IF;
END $$;

-- Legacy/apex mail is deliberately not counted as campaign health debt.
DO $$
DECLARE v_result text; v_open_unmatched bigint;
BEGIN
  v_result := public.mkt_ingest_email_event(
    'svix_2714_apex', 'email.opened', 'transactional-2714',
    jsonb_build_object('data', jsonb_build_object('from','Mingla <hello@usemingla.com>')));
  IF v_result <> 'unmatched' THEN RAISE EXCEPTION '#2714 apex isolation failed: %', v_result; END IF;
  SELECT open_unmatched_count INTO v_open_unmatched
    FROM public.mkt_campaign_email_event_health();
  IF v_open_unmatched <> 0 THEN RAISE EXCEPTION '#2714 transactional event polluted campaign health'; END IF;
END $$;

-- Raw reconciliation remains service-only; aggregate health is app-readable.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.mkt_reconcile_email_event(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '#2714 anon can execute raw reconciliation';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.mkt_campaign_email_event_health()', 'EXECUTE') THEN
    RAISE EXCEPTION '#2714 authenticated cannot read aggregate health';
  END IF;
END $$;

ROLLBACK;
