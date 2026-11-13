-- #4419 Part B — provider events reach Admin emails.
--
-- MINGLA-INVARIANT: I-4419-ADMIN-EVENTS-LINKED-ONCE | issue #4419 | A provider event whose email id matches an Admin delivery is stored once (svix_id) against that delivery and un-flagged as a host-campaign event; replays change nothing; an event that matches no Admin delivery is left exactly as #2714 left it.
--
--   happy: ingest links an Admin event (webhook gets 'admin_delivery', not a retry)
--   replay of the same svix_id changes nothing
--   unknown provider id: no Admin row, #2714's own answer kept
--   late binding: an event that arrived before the delivery's provider id is
--   linked when the id lands
--   ingest survives the Admin linker raising (host marketing itself is
--   covered by the #2714 suites, re-run against this migration)
--   engagement shape: delivered, bounces hard/soft, spam, opens unique/total,
--   clicks and top links, tracking flags; list counts
--   backfill: history is linked by the migration's own INSERT
--   RLS / grants: anon and a non-admin read 0 rows and can't call the reads
--
-- Fails on f8fdac7cc3 (before #4419): the table and functions did not exist and
-- Admin events stayed unmatched.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated','email',(SELECT email FROM auth.users WHERE id=p_user))::text END,true);
$fn$;
CREATE FUNCTION pg_temp.ev(p_svix text, p_type text, p_email_id text, p_extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_build_object('type', p_type, 'created_at', '2026-11-13T09:01:00.000Z',
    'data', jsonb_build_object('email_id', p_email_id, 'from', 'Mingla <hello@campaigns.usemingla.com>') || p_extra);
$fn$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('44191000-0000-4000-8000-0000000000a1','i4419b-admin@mingla.test'),
  ('44191000-0000-4000-8000-0000000000b1','i4419b-member@mingla.test');
INSERT INTO public.admin_users(email,status) VALUES('i4419b-admin@mingla.test','active');
SET LOCAL session_replication_role = origin;

INSERT INTO public.admin_email_log(id,subject,body,recipient_type,status,recipient_count) VALUES
  ('44191000-0000-4000-8000-000000000e01','Lagos','b','bulk','completed',4);
INSERT INTO public.admin_email_recipient_deliveries(id,campaign_id,recipient_email,status,provider_message_id,created_at) VALUES
  ('44191000-0000-4000-8000-0000000000d1','44191000-0000-4000-8000-000000000e01','a@x.test','accepted','re_4419_a',now()-interval '4 minutes'),
  ('44191000-0000-4000-8000-0000000000d2','44191000-0000-4000-8000-000000000e01','b@x.test','accepted','re_4419_b',now()-interval '3 minutes'),
  ('44191000-0000-4000-8000-0000000000d3','44191000-0000-4000-8000-000000000e01','c@x.test','accepted','re_4419_c',now()-interval '2 minutes'),
  ('44191000-0000-4000-8000-0000000000d4','44191000-0000-4000-8000-000000000e01','d@x.test','sending',NULL,now()-interval '1 minute');

DO $$ DECLARE r text; v jsonb; BEGIN
  -- Happy: delivered + opened for a, linked, answered 'admin_delivery'.
  r := public.mkt_ingest_email_event('i4419_s1','email.delivered','re_4419_a',pg_temp.ev('i4419_s1','email.delivered','re_4419_a'));
  IF r <> 'admin_delivery' THEN RAISE EXCEPTION '4419b.ingest: expected admin_delivery, got %', r; END IF;
  IF (SELECT is_campaign_event FROM public.marketing_email_events WHERE svix_id='i4419_s1') THEN
    RAISE EXCEPTION '4419b.ingest: a linked Admin event still counts as an unmatched host-campaign event';
  END IF;
  PERFORM public.mkt_ingest_email_event('i4419_s2','email.opened','re_4419_a',pg_temp.ev('i4419_s2','email.opened','re_4419_a'));
  PERFORM public.mkt_ingest_email_event('i4419_s3','email.opened','re_4419_a',pg_temp.ev('i4419_s3','email.opened','re_4419_a'));
  PERFORM public.mkt_ingest_email_event('i4419_s4','email.delivered','re_4419_b',pg_temp.ev('i4419_s4','email.delivered','re_4419_b'));
  PERFORM public.mkt_ingest_email_event('i4419_s5','email.clicked','re_4419_b',pg_temp.ev('i4419_s5','email.clicked','re_4419_b','{"click":{"link":"https://usemingla.com/blog/x"}}'));
  PERFORM public.mkt_ingest_email_event('i4419_s6','email.clicked','re_4419_b',pg_temp.ev('i4419_s6','email.clicked','re_4419_b','{"click":{"link":"https://usemingla.com/blog/x"}}'));
  PERFORM public.mkt_ingest_email_event('i4419_s7','email.bounced','re_4419_c',pg_temp.ev('i4419_s7','email.bounced','re_4419_c','{"bounce":{"type":"Permanent","subType":"General"}}'));
  PERFORM public.mkt_ingest_email_event('i4419_s8','email.complained','re_4419_c',pg_temp.ev('i4419_s8','email.complained','re_4419_c'));
  IF (SELECT count(*) FROM public.admin_email_delivery_events WHERE campaign_id='44191000-0000-4000-8000-000000000e01') <> 8 THEN
    RAISE EXCEPTION '4419b.ingest: expected 8 linked events';
  END IF;
  IF (SELECT occurred_at FROM public.admin_email_delivery_events WHERE svix_id='i4419_s1') <> '2026-11-13T09:01:00Z'::timestamptz THEN
    RAISE EXCEPTION '4419b.ingest: occurred_at must be the provider time';
  END IF;

  -- Replay: same svix id, nothing changes.
  r := public.mkt_ingest_email_event('i4419_s2','email.opened','re_4419_a',pg_temp.ev('i4419_s2','email.opened','re_4419_a'));
  IF r <> 'admin_delivery' THEN RAISE EXCEPTION '4419b.replay: %', r; END IF;
  IF (SELECT count(*) FROM public.admin_email_delivery_events WHERE campaign_id='44191000-0000-4000-8000-000000000e01') <> 8 THEN
    RAISE EXCEPTION '4419b.replay double-counted';
  END IF;

  -- Unknown id: no Admin row; #2714's answer (a campaign-domain event no one claims) is kept.
  r := public.mkt_ingest_email_event('i4419_u1','email.delivered','re_unknown',pg_temp.ev('i4419_u1','email.delivered','re_unknown'));
  IF r <> 'campaign_unmatched' THEN RAISE EXCEPTION '4419b.unknown: expected campaign_unmatched, got %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_email_delivery_events WHERE svix_id='i4419_u1') THEN RAISE EXCEPTION '4419b.unknown linked'; END IF;
  IF NOT (SELECT is_campaign_event FROM public.marketing_email_events WHERE svix_id='i4419_u1') THEN
    RAISE EXCEPTION '4419b.unknown: an unclaimed campaign event must stay flagged for #2714 health';
  END IF;

  -- Late binding: d4 has no provider id yet when its event arrives.
  r := public.mkt_ingest_email_event('i4419_l1','email.delivered','re_4419_d',pg_temp.ev('i4419_l1','email.delivered','re_4419_d'));
  IF r <> 'campaign_unmatched' THEN RAISE EXCEPTION '4419b.late: before the id lands, Resend must retry (got %)', r; END IF;
  UPDATE public.admin_email_recipient_deliveries SET status='accepted', provider_message_id='re_4419_d' WHERE id='44191000-0000-4000-8000-0000000000d4';
  IF NOT EXISTS (SELECT 1 FROM public.admin_email_delivery_events WHERE svix_id='i4419_l1' AND delivery_id='44191000-0000-4000-8000-0000000000d4') THEN
    RAISE EXCEPTION '4419b.late: the early event was not linked when the id landed';
  END IF;
  -- Resend's retry now succeeds.
  r := public.mkt_ingest_email_event('i4419_l1','email.delivered','re_4419_d',pg_temp.ev('i4419_l1','email.delivered','re_4419_d'));
  IF r <> 'admin_delivery' THEN RAISE EXCEPTION '4419b.late retry: %', r; END IF;

  -- Engagement shape.
  v := public.issue_4419_admin_email_engagement('44191000-0000-4000-8000-000000000e01');
  IF (v->>'accepted')::int <> 4 OR (v->>'delivered')::int <> 3 OR (v->'bounced'->>'hard')::int <> 1 OR (v->'bounced'->>'soft')::int <> 0
     OR (v->>'complained')::int <> 1 OR (v->>'opened_unique')::int <> 1 OR (v->>'opened_total')::int <> 2
     OR (v->>'clicked_unique')::int <> 1 OR (v->>'clicked_total')::int <> 2 THEN
    RAISE EXCEPTION '4419b.engagement: %', v;
  END IF;
  IF v->'top_links' <> '[{"url":"https://usemingla.com/blog/x","unique":1,"total":2}]'::jsonb THEN RAISE EXCEPTION '4419b.top links: %', v->'top_links'; END IF;
  IF v->'tracking' <> '{"opens_seen":true,"clicks_seen":true,"clicks_seen_anywhere":true}'::jsonb THEN RAISE EXCEPTION '4419b.tracking: %', v->'tracking'; END IF;
  IF (SELECT delivered FROM public.issue_4419_admin_email_engagement_counts(ARRAY['44191000-0000-4000-8000-000000000e01'::uuid])) <> 3 THEN
    RAISE EXCEPTION '4419b.list counts';
  END IF;
  -- A campaign with no events: nothing seen, never a measured zero.
  v := public.issue_4419_admin_email_engagement(gen_random_uuid());
  IF v->'tracking'->>'opens_seen' <> 'false' OR (v->>'events')::int <> 0 THEN RAISE EXCEPTION '4419b.empty: %', v; END IF;
END $$;

-- Admin linking that raises never breaks ingest: replace the linker with one
-- that throws, ingest an event, and the #2714 answer still comes back.
CREATE OR REPLACE FUNCTION public.issue_4419_apply_admin_email_event(p_svix_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ BEGIN RAISE EXCEPTION 'boom'; END; $f$;
DO $$ DECLARE r text; BEGIN
  r := public.mkt_ingest_email_event('i4419_x1','email.delivered','re_unknown_2',
    jsonb_build_object('type','email.delivered','data',jsonb_build_object('email_id','re_unknown_2','from','Mingla <hello@usemingla.com>')));
  IF r <> 'unmatched' THEN RAISE EXCEPTION '4419b.raise: ingest must survive the Admin linker failing (got %)', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.marketing_email_events WHERE svix_id='i4419_x1') THEN RAISE EXCEPTION '4419b.raise: the event was lost'; END IF;
END $$;

-- RLS and grants.
SELECT pg_temp.act('44191000-0000-4000-8000-0000000000a1');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.admin_email_delivery_events WHERE campaign_id='44191000-0000-4000-8000-000000000e01') <> 9 THEN
    RAISE EXCEPTION '4419b.rls: the admin should read the 9 linked events';
  END IF;
  BEGIN
    INSERT INTO public.admin_email_delivery_events VALUES ('i4419_forged','44191000-0000-4000-8000-0000000000d1','44191000-0000-4000-8000-000000000e01','email.opened',now(),NULL,NULL);
    RAISE EXCEPTION '4419b.rls: an admin forged an event';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT pg_temp.act('44191000-0000-4000-8000-0000000000b1');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.admin_email_delivery_events) <> 0 THEN RAISE EXCEPTION '4419b.rls: a non-admin read events'; END IF;
  BEGIN
    PERFORM public.issue_4419_admin_email_engagement('44191000-0000-4000-8000-000000000e01');
    RAISE EXCEPTION '4419b.grants: a signed-in user read engagement';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT pg_temp.act(NULL);
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    IF (SELECT count(*) FROM public.admin_email_delivery_events) <> 0 THEN RAISE EXCEPTION '4419b.rls: anon read events'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

ROLLBACK;

-- Backfill: history already in marketing_email_events is linked by the
-- migration's own function (called again here inside a transaction).
BEGIN;
INSERT INTO public.admin_email_log(id,subject,body,recipient_type,status,recipient_count) VALUES
  ('44191000-0000-4000-8000-000000000e09','Old','b','bulk','completed',1);
INSERT INTO public.admin_email_recipient_deliveries(id,campaign_id,recipient_email,status,provider_message_id) VALUES
  ('44191000-0000-4000-8000-0000000000d9','44191000-0000-4000-8000-000000000e09','old@x.test','accepted','re_4419_old');
DELETE FROM public.admin_email_delivery_events WHERE campaign_id='44191000-0000-4000-8000-000000000e09';
INSERT INTO public.marketing_email_events(svix_id,event_type,provider_message_id,payload,received_at) VALUES
  ('i4419_h1','email.sent','re_4419_old','{"created_at":"not a time","data":{}}', '2026-10-01T10:00:00Z'),
  ('i4419_h2','email.delivered','re_4419_old','{"data":{}}', '2026-10-01T10:00:05Z'),
  ('i4419_h3','email.bounced','re_4419_old','{"data":{"bounce":{"type":"Transient"}}}', '2026-10-01T10:00:06Z'),
  ('i4419_h4','email.delivered','re_not_admin','{"data":{}}', '2026-10-01T10:00:07Z');
DO $$ BEGIN
  IF public.issue_4419_backfill_admin_email_events() <> 3 THEN RAISE EXCEPTION '4419b.backfill: expected 3 rows linked'; END IF;
  IF public.issue_4419_backfill_admin_email_events() <> 0 THEN RAISE EXCEPTION '4419b.backfill: a second run must link nothing'; END IF;
  IF (SELECT count(*) FROM public.admin_email_delivery_events WHERE campaign_id='44191000-0000-4000-8000-000000000e09') <> 3 THEN
    RAISE EXCEPTION '4419b.backfill: expected 3 history events for the old delivery';
  END IF;
  IF (SELECT occurred_at FROM public.admin_email_delivery_events WHERE svix_id='i4419_h1') <> '2026-10-01T10:00:00Z'::timestamptz THEN
    RAISE EXCEPTION '4419b.backfill: an unreadable provider time falls back to received_at';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_email_delivery_events WHERE svix_id='i4419_h4') THEN RAISE EXCEPTION '4419b.backfill linked a non-Admin event'; END IF;
  IF (public.issue_4419_admin_email_engagement('44191000-0000-4000-8000-000000000e09')->'bounced'->>'soft')::int <> 1 THEN
    RAISE EXCEPTION '4419b.backfill: a transient bounce is soft';
  END IF;
END $$;
ROLLBACK;
