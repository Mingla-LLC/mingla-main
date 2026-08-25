-- #2510 adversarial — the ingest must not corrupt what it measures.
--
-- Webhooks arrive OUT OF ORDER and are RETRIED. A metric that only ever
-- inflates is worse than no metric, because it looks like it is working. These
-- assertions attack the three ways this ingest silently starts lying:
--   1. a retry double-counting an open,
--   2. a late `delivered` demoting a row that already clicked,
--   3. a bounce failing to suppress, so the next blast re-hits a dead address.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t2510 (k text primary key, v uuid);

DO $$
DECLARE
  v_brand uuid; v_user uuid; v_aud uuid; v_camp uuid; v_msg uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN
    INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'i2510@example.test')
    RETURNING id INTO v_user;
  END IF;

  INSERT INTO public.brands (id, name, slug)
  VALUES (gen_random_uuid(), 'i2510 brand', 'i2510-brand-' || substr(md5(random()::text),1,8))
  RETURNING id INTO v_brand;

  INSERT INTO public.marketing_audiences (id, brand_id, name, query_definition, is_system_generated)
  VALUES (gen_random_uuid(), v_brand, 'i2510 aud',
          jsonb_build_object('kind','brand_buyers','brand_id',v_brand::text), true)
  RETURNING id INTO v_aud;

  INSERT INTO public.marketing_campaigns
    (id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (gen_random_uuid(), v_user, v_brand, v_aud, 'i2510', 'email',
          jsonb_build_object('kind','email','subject','s','body_html','b'), 'sent')
  RETURNING id INTO v_camp;

  INSERT INTO public.marketing_messages
    (id, campaign_id, recipient_email, channel, status, provider_message_id, sent_at)
  VALUES (gen_random_uuid(), v_camp, 'i2510-recipient@example.test', 'email', 'sent',
          'prov-2510-aaa', now())
  RETURNING id INTO v_msg;

  INSERT INTO t2510(k,v) VALUES ('brand',v_brand),('camp',v_camp),('msg',v_msg);
END $$;

-- A1 — a RETRIED open is counted once. Same svix id twice.
DO $$
DECLARE v_msg uuid := (SELECT v FROM t2510 WHERE k='msg'); v_out text; v_opens int;
BEGIN
  v_out := public.mkt_ingest_email_event('svix_open_1','email.opened','prov-2510-aaa',
    jsonb_build_object('type','email.opened','created_at','2026-08-25T00:00:00Z'));
  IF v_out <> 'opened' THEN RAISE EXCEPTION '#2510 A1: first open returned %', v_out; END IF;

  v_out := public.mkt_ingest_email_event('svix_open_1','email.opened','prov-2510-aaa',
    jsonb_build_object('type','email.opened','created_at','2026-08-25T00:00:00Z'));
  IF v_out <> 'duplicate' THEN RAISE EXCEPTION '#2510 A1: retry was not detected (%)', v_out; END IF;

  SELECT open_count INTO v_opens FROM public.marketing_messages WHERE id=v_msg;
  IF v_opens <> 1 THEN RAISE EXCEPTION '#2510 A1: retry double-counted, open_count=%', v_opens; END IF;
END $$;

-- A2 — a LATE `delivered` must not demote a row that already opened.
DO $$
DECLARE v_msg uuid := (SELECT v FROM t2510 WHERE k='msg'); v_status text; v_del timestamptz;
BEGIN
  PERFORM public.mkt_ingest_email_event('svix_del_1','email.delivered','prov-2510-aaa',
    jsonb_build_object('type','email.delivered','created_at','2026-08-24T23:59:00Z'));
  SELECT status, delivered_at INTO v_status, v_del
    FROM public.marketing_messages WHERE id=v_msg;
  IF v_status <> 'opened' THEN
    RAISE EXCEPTION '#2510 A2: late delivered DEMOTED the row to %', v_status;
  END IF;
  IF v_del IS NULL THEN
    RAISE EXCEPTION '#2510 A2: delivered_at was not recorded even though status held';
  END IF;
END $$;

-- A3 — a hard bounce ALWAYS wins over engagement, and SUPPRESSES.
DO $$
DECLARE
  v_msg uuid := (SELECT v FROM t2510 WHERE k='msg');
  v_brand uuid := (SELECT v FROM t2510 WHERE k='brand');
  v_status text; v_sup int;
BEGIN
  PERFORM public.mkt_ingest_email_event('svix_bounce_1','email.bounced','prov-2510-aaa',
    jsonb_build_object('type','email.bounced','created_at','2026-08-25T01:00:00Z',
      'data', jsonb_build_object('bounce',
        jsonb_build_object('type','Permanent','subType','Suppressed'))));

  SELECT status INTO v_status FROM public.marketing_messages WHERE id=v_msg;
  IF v_status <> 'bounced' THEN
    RAISE EXCEPTION '#2510 A3: bounce did not win over engagement, status=%', v_status;
  END IF;

  SELECT count(*) INTO v_sup FROM public.marketing_unsubscribes
   WHERE lower(contact_email)='i2510-recipient@example.test'
     AND brand_id=v_brand AND reason='hard_bounce';
  IF v_sup <> 1 THEN
    RAISE EXCEPTION '#2510 A3: hard bounce did not suppress (rows=%)', v_sup;
  END IF;
END $$;

-- A4 — a REPEAT bounce must not append a second suppression row.
DO $$
DECLARE v_brand uuid := (SELECT v FROM t2510 WHERE k='brand'); v_sup int;
BEGIN
  PERFORM public.mkt_ingest_email_event('svix_bounce_2','email.bounced','prov-2510-aaa',
    jsonb_build_object('type','email.bounced','created_at','2026-08-25T02:00:00Z',
      'data', jsonb_build_object('bounce',
        jsonb_build_object('type','Permanent','subType','Suppressed'))));
  SELECT count(*) INTO v_sup FROM public.marketing_unsubscribes
   WHERE lower(contact_email)='i2510-recipient@example.test' AND brand_id=v_brand;
  IF v_sup <> 1 THEN
    RAISE EXCEPTION '#2510 A4: repeat bounce duplicated suppression (rows=%)', v_sup;
  END IF;
END $$;

-- A5 — an event for TRANSACTIONAL mail (no marketing_messages row) is recorded
--      and ignored, never an error. Returning non-2xx would make Resend retry
--      forever on events that can never match.
DO $$
DECLARE v_out text;
BEGIN
  v_out := public.mkt_ingest_email_event('svix_txn_1','email.delivered','prov-2510-does-not-exist',
    jsonb_build_object('type','email.delivered'));
  IF v_out <> 'unmatched' THEN
    RAISE EXCEPTION '#2510 A5: unmatched event returned %', v_out;
  END IF;
END $$;

-- A6 — a SOFT bounce must NOT suppress. Transient failure is not a dead address.
DO $$
DECLARE
  v_brand uuid := (SELECT v FROM t2510 WHERE k='brand');
  v_camp uuid := (SELECT v FROM t2510 WHERE k='camp');
  v_sup int;
BEGIN
  INSERT INTO public.marketing_messages
    (id, campaign_id, recipient_email, channel, status, provider_message_id, sent_at)
  VALUES (gen_random_uuid(), v_camp, 'i2510-soft@example.test', 'email', 'sent',
          'prov-2510-soft', now());
  PERFORM public.mkt_ingest_email_event('svix_soft_1','email.bounced','prov-2510-soft',
    jsonb_build_object('type','email.bounced',
      'data', jsonb_build_object('bounce',
        jsonb_build_object('type','Transient','subType','MailboxFull'))));
  SELECT count(*) INTO v_sup FROM public.marketing_unsubscribes
   WHERE lower(contact_email)='i2510-soft@example.test';
  IF v_sup <> 0 THEN
    RAISE EXCEPTION '#2510 A6: a TRANSIENT bounce suppressed the address (rows=%)', v_sup;
  END IF;
END $$;

ROLLBACK;
