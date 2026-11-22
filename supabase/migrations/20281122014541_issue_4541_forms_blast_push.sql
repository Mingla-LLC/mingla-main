-- Issue #4541 M-B: form requests by push, one shared text allowance, Blast "+ Form".
-- Spec: "#4541 build spec: everything left on custom forms" (approved 21 Nov 2026),
-- waves 4 to 6 (server). Parts 3, 4 and 5, plus the M-B numbers of the Admin
-- support read (R7.1).
--
-- What this file does:
--   R3.1  BRAND_FORMS_PUSH (off) and BRAND_FORMS_PUSH_EMAIL_ALONGSIDE (on) are database
--         switches (brand_form_push_settings); the audience and the queue accept "push"
--   R3.2  brand_form_push_capable (one row per user, written by the app through
--         brand_form_report_capability); push is tried only for a user whose app said
--         in the last 45 days that it can open the form (decided again at claim)
--   R5.1  one monthly text budget per brand: Blast's own counter, unit (one text per
--         person), window (UTC calendar month) and lock (blast_cap:<brand>:sms); form
--         texts count in biz_brand_blast_usage_v1 and biz_assert_brand_blast_allowance_v1
--   R5.2  the request queue and the automatic reminder take blast_cap first
--   R5.4  over the monthly allowance or the 300-a-day cap, texts are off for that send
--         (email and push still go): never a refused send, never a held queue
--   R4.1-R4.9 Blast "+ Form": replies not tied to a page (a known Blast recipient by a
--         hashed key, a signed-in person, or Unknown), personal Blast links, the
--         campaign window, the open-reply limit, hide with undo, never on a guest
--         record or at the door; R7.1 the Admin numbers and the open-reply limit
--
-- Coordination (#4522): never redefines issue_3872_ticket_quote,
-- issue_1930_ticket_checkout_create_session_base, issue_1930_ticket_checkout_finalize_base,
-- refund_preview, biz_refund_order or admin_refund_order.
--
-- Lock order: blast_cap:<brand>:sms is always the first lock a form send takes; Blast's
-- allowance check takes only that lock. No function here takes a lock that
-- submit_event_rsvp_with_delivery takes.
--
-- Every function: SECURITY DEFINER SET search_path = '' (or IMMUTABLE pure). Nothing
-- new is granted to anon. Stale writes raise PT409, never 40001.
--
-- READ-ONLY PROBE (run right before applying):
--   SELECT (SELECT max(version) FROM supabase_migrations.schema_migrations),
--     (SELECT count(*) FROM public.brand_form_responses),
--     (SELECT count(*) FROM public.brand_form_links WHERE kind <> 'person'),
--     (SELECT count(*) FROM public.feature_flags WHERE flag_key LIKE 'BRAND_FORMS_PUSH%');
--   expected: M-A's version, any, 0, 0.
--
-- ROLLBACK (manual):
--   Re-run the replaced bodies from git: brand_form_request_audience,
--     brand_form_request_enqueue, brand_form_request_claim_batch,
--     brand_form_auto_reminders_due (and the wave 6 list below) from 20281122004541;
--     brand_form_request_settle from 20281120034514; biz_brand_blast_usage_v1 and
--     biz_assert_brand_blast_allowance_v1 from 20280401043682.
--   UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'BRAND_FORMS_PUSH';
--   DROP FUNCTION the functions this file creates (each section names them);
--   DROP TABLE public.brand_form_push_capable;
--   ALTER TABLE public.brand_form_request_sends DROP COLUMN try_push;
--   Wave 6 (with Seth's approval: it deletes answers):
--     DELETE FROM public.brand_form_responses WHERE campaign_id IS NOT NULL AND event_id IS NULL
--       OR blast_contact_key IS NOT NULL OR unknown_owner;
--     DELETE FROM public.brand_form_links WHERE kind = 'blast';
--     restore biz_brand_form_responses (5 arguments), the door, export, counts, guest answers,
--     roster export, event responses, my_response, link_resolve and submit_core bodies from
--     20281122004541 / 20281120034514, then drop the new columns and restore the
--     one_subject, verified and links kind/subject constraints from 20281120034514;
--     ALTER TABLE public.marketing_campaigns DROP COLUMN failure_reason;
--     DELETE FROM public.notification_categories WHERE key = 'business.blast_form_closed'.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 0. Drift guard: every body this file replaces must be the one in the repo
--    (M-A's body where M-A replaced it last).
-- ---------------------------------------------------------------------------
DO $drift_guard$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.brand_form_request_audience(uuid,uuid,uuid,text,jsonb,text[])', '193598dbabe0a8862ff546cfb0e022e7'),
      ('public.brand_form_request_enqueue(uuid,uuid,uuid,text,text,jsonb,text[])', 'aa2a8272ec3e2030742d01526b2f8f05'),
      ('public.brand_form_request_claim_batch(integer,uuid,uuid)', '74bbf98996c30463a2af7179932440fe'),
      ('public.brand_form_auto_reminders_due()', 'fa7ce8e7fb5f3d51e298e4d37d07aaf5'),
      ('public.brand_form_request_settle(uuid,text,text,text)', '734378f1745d9dc0ecb7e8bd382885cd'),
      ('public.biz_brand_blast_usage_v1(uuid,uuid)', '07036738fdb3766a768b2eee2189686f'),
      ('public.biz_assert_brand_blast_allowance_v1(uuid,text,integer)', '835b6f945a76b67c2c24594733fdb365'),
      -- wave 6
      ('public.brand_form_responses_guard()', 'ed1ca068adbd731265c24465bbdf5fd8'),
      ('public.brand_form_submit_core(jsonb)', 'b4b8a19536712894273e28157d3febc9'),
      ('public.brand_form_link_resolve(text)', '6e493142358e1ddaf14e8f246042ab8a'),
      ('public.brand_form_my_response(uuid,uuid,text,uuid)', 'f0e6f37ed2d41da5d0e103b04042c603'),
      ('public.brand_form_door_answers(uuid,uuid,jsonb)', '195d4e0e19c9381e3fbaf79b877a7532'),
      ('public.brand_form_door_full_answers(uuid,uuid,jsonb,text)', '5a28f9d3f274ec249a36bf76add37792'),
      ('public.biz_brand_form_guest_answers(uuid,jsonb)', '0d376c2af3b1b8c22dd7ad06f230b1c6'),
      ('public.brand_form_roster_export_answers(uuid)', '8982c37ca8a75c0072874eb92b244144'),
      ('public.brand_form_event_responses(uuid,uuid)', 'f675026bfb751b8b014e03fd4bb5042f'),
      ('public.biz_brand_form_responses(uuid,uuid,text,integer,integer)', 'e08048edc17eea20a4c2256193e0b79e'),
      ('public.biz_brand_form_responses_export(uuid,uuid)', 'a9fdfc1c8be1cbf2ab1af838a07032ab'),
      ('public.biz_brand_form_counts(uuid)', 'b323550c6583a97b67563fc08075a09d'),
      ('public.admin_brand_forms_support(uuid,uuid)', '5b902752838a2fbb5089605c0dbd0533')
    ) AS v(sig, expected_md5)
  LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.sig::regprocedure)
       IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #4541 M-B drift: % no longer matches its repository definition', r.sig;
    END IF;
  END LOOP;
END;
$drift_guard$;

-- ---------------------------------------------------------------------------
-- 1. Push switches and app capability (R3.1, R3.2)
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags (flag_key, is_enabled, description)
VALUES ('BRAND_FORMS_PUSH', false,
        '#4541: form requests may go by push to app versions that can open the form.'),
       ('BRAND_FORMS_PUSH_EMAIL_ALONGSIDE', true,
        '#4541: while on, a form request that goes by push also goes by email.')
ON CONFLICT (flag_key) DO UPDATE SET description = EXCLUDED.description;

CREATE FUNCTION public.brand_form_push_settings() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT jsonb_build_object(
    'push', COALESCE((SELECT f.is_enabled FROM public.feature_flags f WHERE f.flag_key = 'BRAND_FORMS_PUSH'), false),
    'emailAlongside', COALESCE((SELECT f.is_enabled FROM public.feature_flags f
                                 WHERE f.flag_key = 'BRAND_FORMS_PUSH_EMAIL_ALONGSIDE'), true));
$fn$;

-- One row per Explorer user: the last app that told us it can open the form screen.
CREATE TABLE public.brand_form_push_capable (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  platform       text NOT NULL CHECK (platform IN ('ios', 'android')),
  app_version    text NOT NULL CHECK (app_version ~ '^\d+\.\d+\.\d+$'),
  screen_version integer NOT NULL CHECK (screen_version BETWEEN 1 AND 100),
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_form_push_capable_seen_idx ON public.brand_form_push_capable (last_seen_at DESC);
ALTER TABLE public.brand_form_push_capable ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_form_push_capable FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.brand_form_push_capable TO service_role;

-- The Explorer app reports, at most once a day, that it can open the form screen.
CREATE FUNCTION public.brand_form_report_capability(
  p_app_id text, p_platform text, p_app_version text, p_screen_version integer
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501'; END IF;
  IF p_app_id IS DISTINCT FROM 'explorer' THEN RAISE EXCEPTION 'app_invalid' USING ERRCODE = '22023'; END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android')
     OR p_app_version IS NULL OR p_app_version !~ '^\d+\.\d+\.\d+$' OR char_length(p_app_version) > 20
     OR p_screen_version IS NULL OR p_screen_version NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'capability_invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.brand_form_push_capable (user_id, platform, app_version, screen_version, last_seen_at)
  VALUES (v_uid, p_platform, p_app_version, p_screen_version, now())
  ON CONFLICT (user_id) DO UPDATE
    SET platform = EXCLUDED.platform, app_version = EXCLUDED.app_version,
        screen_version = EXCLUDED.screen_version, last_seen_at = now();
END;
$fn$;

-- R3.2: may this person get a form push right now (the switch is on and their
-- app said in the last 45 days that it opens the form)?
CREATE FUNCTION public.brand_form_push_eligible(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT p_user_id IS NOT NULL
     AND COALESCE((public.brand_form_push_settings()->>'push')::boolean, false)
     AND EXISTS (SELECT 1 FROM public.brand_form_push_capable c
                  WHERE c.user_id = p_user_id AND c.screen_version >= 1
                    AND c.last_seen_at > now() - interval '45 days');
$fn$;

-- The queue keeps the contact route (text before email) as today, so every
-- route[1] = 'sms' rule (quiet hours, the daily cap, its index) still means
-- "texts". try_push records that push is tried first for this person; the
-- claim decides it again (R3.2).
ALTER TABLE public.brand_form_request_sends
  ADD COLUMN try_push boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. One text allowance (R5.1)
-- ---------------------------------------------------------------------------
-- Form-request texts this UTC calendar month, in Blast's unit (one text per
-- person). A request that went by push is not a text.
CREATE FUNCTION public.brand_form_request_texts_this_month(p_brand_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT count(*)::integer FROM public.brand_form_request_sends s
   WHERE s.brand_id = p_brand_id AND s.route[1] = 'sms'
     AND s.status IN ('queued', 'claimed', 'sent') AND s.channel IS DISTINCT FROM 'push'
     AND s.created_at >= (date_trunc('month', timezone('utc', now())) AT TIME ZONE 'utc');
$fn$;

-- The brand's monthly text budget as the form send sees it, counted exactly as
-- biz_assert_brand_blast_allowance_v1 counts it (Blast sends + subscribe texts +
-- form texts). remaining is null when the brand has no text limit.
CREATE FUNCTION public.brand_form_sms_month_state(p_brand_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_limits record;
  v_used integer := 0;
  v_month_start timestamptz := date_trunc('month', timezone('utc', now()));
BEGIN
  SELECT * INTO v_limits FROM public.brand_messaging_effective_limits(p_brand_id);
  SELECT COALESCE(SUM(e.reachable_count), 0)::integer INTO v_used
    FROM public.marketing_book_send_executions e
    JOIN public.marketing_campaigns c ON c.id = e.campaign_id
   WHERE e.brand_id = p_brand_id AND c.channel = 'sms' AND e.confirmed_at >= v_month_start;
  v_used := v_used + public.issue_4111_subscribe_sms_used(p_brand_id)
                   + public.brand_form_request_texts_this_month(p_brand_id);
  RETURN jsonb_build_object('cap', v_limits.sms_monthly, 'used', v_used,
    'remaining', CASE WHEN v_limits.sms_monthly IS NULL THEN NULL
                      ELSE GREATEST(v_limits.sms_monthly - v_used, 0) END);
END;
$fn$;

-- Blast's own usage read: unchanged except that the SMS "used" term adds the
-- brand's form-request texts this month.
CREATE OR REPLACE FUNCTION public.biz_brand_blast_usage_v1(
  p_actor_id uuid,
  p_brand_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_limits record;
  v_sms_used integer := 0;
  v_email_used integer := 0;
  v_push_used integer := 0;
  v_blasts_week integer := 0;
  v_month_start timestamptz := date_trunc('month', timezone('utc', now()));
  v_week_start timestamptz := timezone('utc', now()) - interval '7 days';
BEGIN
  IF p_actor_id IS NULL OR p_brand_id IS NULL THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, p_actor_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_limits FROM public.brand_messaging_effective_limits(p_brand_id);

  SELECT
    COALESCE(SUM(e.reachable_count) FILTER (WHERE c.channel = 'sms'), 0)::integer,
    COALESCE(SUM(e.reachable_count) FILTER (WHERE c.channel = 'email'), 0)::integer,
    COALESCE(SUM(e.reachable_count) FILTER (WHERE c.channel = 'push'), 0)::integer
  INTO v_sms_used, v_email_used, v_push_used
  FROM public.marketing_book_send_executions e
  JOIN public.marketing_campaigns c ON c.id = e.campaign_id
  WHERE e.brand_id = p_brand_id
    AND e.confirmed_at >= v_month_start;
  v_sms_used := v_sms_used + public.issue_4111_subscribe_sms_used(p_brand_id)
    -- #4541 R5.1: form-request texts share the brand's one monthly text budget.
    + public.brand_form_request_texts_this_month(p_brand_id);
  v_email_used := v_email_used + private.issue_3682_account_invite_email_used(p_brand_id);

  -- #3682 — one campaign sent by push, email and SMS is ONE blast.
  SELECT COUNT(DISTINCT COALESCE(c.campaign_group_id, c.id))::integer
  INTO v_blasts_week
  FROM public.marketing_book_send_executions e
  JOIN public.marketing_campaigns c ON c.id = e.campaign_id
  WHERE e.brand_id = p_brand_id
    AND e.confirmed_at >= v_week_start;

  RETURN jsonb_build_object(
    'smsCap', v_limits.sms_monthly,
    'smsUsed', v_sms_used,
    'smsRemaining', GREATEST(v_limits.sms_monthly - v_sms_used, 0),
    'emailCap', v_limits.email_monthly,
    'emailUsed', v_email_used,
    'emailRemaining', GREATEST(v_limits.email_monthly - v_email_used, 0),
    'pushCap', v_limits.push_monthly,
    'pushUsed', v_push_used,
    'pushRemaining', CASE WHEN v_limits.push_monthly IS NULL THEN NULL
                          ELSE GREATEST(v_limits.push_monthly - v_push_used, 0) END,
    'limitSource', v_limits.source,
    'blastsThisWeek', v_blasts_week,
    'weekWarningAt', v_limits.week_warning_at
  );
END;
$f$;

-- Blast's allowance check: unchanged (same lock, same window, same error) except
-- that the SMS "used" term adds the brand's form-request texts this month.
CREATE OR REPLACE FUNCTION public.biz_assert_brand_blast_allowance_v1(
  p_brand_id uuid,
  p_channel text,
  p_additional_reachable integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_limits record;
  v_cap integer;
  v_used integer := 0;
  v_month_start timestamptz := date_trunc('month', timezone('utc', now()));
BEGIN
  IF COALESCE(p_additional_reachable, 0) <= 0 THEN
    RETURN;
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('sms', 'email', 'push') THEN
    RETURN;
  END IF;

  SELECT * INTO v_limits FROM public.brand_messaging_effective_limits(p_brand_id);
  v_cap := CASE p_channel
    WHEN 'sms' THEN v_limits.sms_monthly
    WHEN 'email' THEN v_limits.email_monthly
    ELSE v_limits.push_monthly
  END;
  -- NULL = no limit for this channel (push, unless an admin sets one).
  IF v_cap IS NULL THEN
    RETURN;
  END IF;

  -- Serialize brand×channel confirm races so two campaigns cannot both pass
  -- the pre-insert read and exceed the monthly aggregate.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('blast_cap:' || p_brand_id::text || ':' || p_channel, 3682)
  );

  SELECT COALESCE(SUM(e.reachable_count), 0)::integer
  INTO v_used
  FROM public.marketing_book_send_executions e
  JOIN public.marketing_campaigns c ON c.id = e.campaign_id
  WHERE e.brand_id = p_brand_id
    AND c.channel = p_channel
    AND e.confirmed_at >= v_month_start;
  IF p_channel = 'sms' THEN
    v_used := v_used + public.issue_4111_subscribe_sms_used(p_brand_id)
      -- #4541 R5.1: form-request texts share the brand's one monthly text budget.
      + public.brand_form_request_texts_this_month(p_brand_id);
  ELSIF p_channel = 'email' THEN
    v_used := v_used + private.issue_3682_account_invite_email_used(p_brand_id);
  END IF;

  IF v_used + p_additional_reachable > v_cap THEN
    RAISE EXCEPTION 'book_blast_monthly_cap_exceeded' USING ERRCODE = 'P0001';
  END IF;
END;
$f$;

-- ---------------------------------------------------------------------------
-- 3. The request queue: push (R3.1, R3.2) and texts off over a limit (R5.2, R5.4)
-- ---------------------------------------------------------------------------
-- The preview read. p_channels may include 'push' (dropped silently while
-- BRAND_FORMS_PUSH is off). Each recipient gains pushOk (push will be tried);
-- the read gains the push switch and the monthly text numbers.
CREATE OR REPLACE FUNCTION public.brand_form_request_audience(
  p_actor_id uuid, p_form_id uuid, p_event_id uuid, p_audience text DEFAULT 'unanswered',
  p_subjects jsonb DEFAULT NULL, p_channels text[] DEFAULT ARRAY['email', 'sms']
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_e record; v_f record; v_att uuid; v_rows jsonb; v_n integer; v_month jsonb;
  v_ch text[] := ARRAY(SELECT DISTINCT c FROM unnest(COALESCE(p_channels, ARRAY[]::text[])) c
                        WHERE c IN ('sms', 'email'));
  v_push_on boolean := COALESCE((public.brand_form_push_settings()->>'push')::boolean, false);
  v_push boolean;
  v_window timestamptz;
BEGIN
  v_push := v_push_on AND 'push' = ANY (COALESCE(p_channels, ARRAY[]::text[]));
  IF p_audience IS NULL OR p_audience NOT IN ('unanswered', 'everyone') THEN
    RAISE EXCEPTION 'audience_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_subjects IS NOT NULL AND (jsonb_typeof(p_subjects) <> 'array'
     OR jsonb_array_length(p_subjects) NOT BETWEEN 1 AND 500
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_subjects) s
                 WHERE jsonb_typeof(s) <> 'object'
                    OR COALESCE(s->>'kind', '') NOT IN ('rsvp', 'rsvp_guest', 'order')
                    OR COALESCE(s->>'id', '') !~ '^[0-9a-fA-F-]{36}$')) THEN
    RAISE EXCEPTION 'subjects_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT e.id, e.brand_id, e.title, e.deleted_at, e.status, e.timezone
    INTO v_e FROM public.events e WHERE e.id = p_event_id;
  IF NOT FOUND OR v_e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_actor_id IS NOT NULL
     AND public.biz_brand_effective_rank(v_e.brand_id, p_actor_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'brand_form_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT f.id, f.name, f.status INTO v_f FROM public.brand_forms f WHERE f.id = p_form_id AND f.brand_id = v_e.brand_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT a.id INTO v_att FROM public.brand_form_attachments a
   WHERE a.event_id = p_event_id AND a.form_id = p_form_id AND a.detached_at IS NULL;
  IF v_att IS NULL THEN RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501'; END IF;
  IF v_f.status <> 'live' THEN
    RAISE EXCEPTION '%', CASE WHEN v_f.status = 'draft' THEN 'form_not_live' ELSE 'form_closed' END
      USING ERRCODE = '22023';
  END IF;
  WITH people AS (
    SELECT DISTINCT ON (g.g_person_key) g.*
      FROM public.brand_form_request_guests(p_form_id, p_event_id, p_subjects) g
     ORDER BY g.g_person_key, g.g_answered DESC, g.g_kind, g.g_id
  ), picked AS (
    SELECT p.* FROM people p
     WHERE p_audience = 'everyone'
        OR (NOT p.g_answered AND NOT public.brand_form_added_by_host(p.g_kind, p.g_id))
  )
  SELECT count(*)::integer,
         COALESCE(jsonb_agg(jsonb_build_object(
           'kind', p.g_kind, 'id', p.g_id, 'userId', p.g_user_id,
           'name', public.brand_form_short_name(p.g_name), 'personKey', p.g_person_key,
           'email', p.g_email, 'phone', p.g_phone, 'answered', p.g_answered,
           'route', to_jsonb(public.brand_form_request_route(p.g_phone, p.g_email, v_ch)),
           'pushOk', v_push AND public.brand_form_push_eligible(p.g_user_id),
           'smsOptedOut', p.g_phone IS NOT NULL AND 'sms' = ANY (v_ch)
                          AND NOT public.can_send(NULL, 'brand_form_request', 'sms', p.g_phone),
           'throttled', EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                                 WHERE s.form_id = p_form_id AND s.person_key = p.g_person_key
                                   AND s.status IN ('queued', 'claimed', 'sent')
                                   AND s.created_at > now() - interval '24 hours'))
           ORDER BY p.g_kind, p.g_id), '[]'::jsonb)
    INTO v_n, v_rows FROM picked p;
  IF v_n > 500 THEN RAISE EXCEPTION 'audience_too_large' USING ERRCODE = '22023'; END IF;
  v_window := public.brand_form_text_window(v_e.timezone, now());
  v_month := public.brand_form_sms_month_state(v_e.brand_id);
  RETURN jsonb_build_object('formId', p_form_id, 'eventId', p_event_id, 'attachmentId', v_att,
    'brandId', v_e.brand_id, 'eventTitle', v_e.title, 'formName', v_f.name,
    'brandName', (SELECT b.name FROM public.brands b WHERE b.id = v_e.brand_id),
    'eventStartsAt', (SELECT min(d.start_at) FROM public.event_dates d
                       WHERE d.event_id = p_event_id AND d.start_at > now() AND d.cancelled_at IS NULL),
    'textsToday', public.brand_form_request_texts_today(v_e.brand_id),
    'textCap', public.brand_form_request_text_cap(),
    'textsWaitUntil', CASE WHEN v_window > now() THEN v_window END,
    'pushAvailable', v_push_on,
    'monthlyTextCap', v_month->'cap',
    'textsLeftThisMonth', v_month->'remaining',
    'recipients', v_rows);
END;
$fn$;

-- The send. R5.2: blast_cap first, then the brand's request lock. R5.4: when the
-- texts this send needs are more than the month has left (or than today's 300
-- allow), texts are off for the whole send: each recipient keeps email (and
-- push), and a recipient with no other way is skipped. Never a refused send.
CREATE OR REPLACE FUNCTION public.brand_form_request_enqueue(
  p_actor_id uuid, p_form_id uuid, p_event_id uuid, p_kind text, p_audience text,
  p_subjects jsonb, p_channels text[]
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_aud jsonb; v_brand uuid; v_tz text; v_needed integer; v_remaining integer; v_today_left integer;
  v_off text; v_texts integer := 0;
  v_queued integer := 0; v_unreachable integer := 0; v_throttled integer := 0;
  v_answered integer := 0; v_waiting integer := 0; v_skipped integer := 0;
BEGIN
  -- R1.8: the off switch stops every new form request.
  IF public.brand_forms_switched_off() THEN
    RAISE EXCEPTION 'forms_paused' USING ERRCODE = '55000';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('ask', 'remind') THEN
    RAISE EXCEPTION 'kind_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'brand_form_forbidden' USING ERRCODE = '42501'; END IF;
  v_aud := public.brand_form_request_audience(p_actor_id, p_form_id, p_event_id,
             CASE WHEN p_kind = 'remind' THEN 'unanswered' ELSE p_audience END, p_subjects, p_channels);
  v_brand := (v_aud->>'brandId')::uuid;
  -- R5.2: the shared text budget's lock first, always.
  PERFORM pg_advisory_xact_lock(hashtextextended('blast_cap:' || v_brand::text || ':sms', 3682));
  PERFORM pg_advisory_xact_lock(hashtextextended('brand_form_request:' || v_brand::text, 4514));
  v_aud := public.brand_form_request_audience(p_actor_id, p_form_id, p_event_id,
             CASE WHEN p_kind = 'remind' THEN 'unanswered' ELSE p_audience END, p_subjects, p_channels);
  SELECT e.timezone INTO v_tz FROM public.events e WHERE e.id = p_event_id;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.brand_form_enqueue_rows (
    kind text, id uuid, person_key text, answered boolean, throttled boolean,
    route text[], opted_out boolean, push_ok boolean, had_sms boolean) ON COMMIT DROP;
  DELETE FROM pg_temp.brand_form_enqueue_rows;
  INSERT INTO pg_temp.brand_form_enqueue_rows
  SELECT x.kind, x.id, x.person_key, x.answered, x.throttled, x.route, x.opted_out, x.push_ok,
         x.route[1] = 'sms'
    FROM (SELECT r->>'kind' AS kind, (r->>'id')::uuid AS id, r->>'personKey' AS person_key,
                 (r->>'answered')::boolean AS answered, (r->>'throttled')::boolean AS throttled,
                 ARRAY(SELECT jsonb_array_elements_text(r->'route')) AS route,
                 (r->>'smsOptedOut')::boolean AS opted_out, COALESCE((r->>'pushOk')::boolean, false) AS push_ok
            FROM jsonb_array_elements(v_aud->'recipients') r) x;
  -- Only the people this send reaches.
  DELETE FROM pg_temp.brand_form_enqueue_rows y
   WHERE y.throttled OR (y.answered AND p_kind = 'remind');
  SELECT count(*) FILTER (WHERE (r->>'throttled')::boolean),
         count(*) FILTER (WHERE NOT (r->>'throttled')::boolean AND (r->>'answered')::boolean AND p_kind = 'remind')
    INTO v_throttled, v_answered
    FROM jsonb_array_elements(v_aud->'recipients') r;
  SELECT count(*) FILTER (WHERE had_sms) INTO v_needed FROM pg_temp.brand_form_enqueue_rows;

  -- R5.4: the one monthly budget first, then the 300-a-day cap.
  IF v_needed > 0 THEN
    v_remaining := (public.brand_form_sms_month_state(v_brand)->>'remaining')::integer;
    v_today_left := GREATEST(public.brand_form_request_text_cap()
                             - public.brand_form_request_texts_today(v_brand), 0);
    IF v_remaining IS NOT NULL AND v_needed > v_remaining THEN
      v_off := 'monthly_allowance';
    ELSIF v_needed > v_today_left THEN
      v_off := 'daily_cap';
    END IF;
  END IF;
  IF v_off IS NOT NULL THEN
    UPDATE pg_temp.brand_form_enqueue_rows SET route = array_remove(route, 'sms');
  END IF;

  INSERT INTO public.brand_form_request_sends (
    form_id, attachment_id, event_id, brand_id, rsvp_id, rsvp_guest_id, order_id,
    person_key, kind, route, try_push, status, safe_reason, not_before, created_by, settled_at)
  SELECT p_form_id, (v_aud->>'attachmentId')::uuid, p_event_id, v_brand,
         CASE WHEN x.kind = 'rsvp' THEN x.id END,
         CASE WHEN x.kind = 'rsvp_guest' THEN x.id END,
         CASE WHEN x.kind = 'order' THEN x.id END,
         x.person_key, p_kind, x.route, x.push_ok,
         CASE WHEN cardinality(x.route) > 0 OR x.push_ok THEN 'queued'
              WHEN v_off IS NOT NULL AND x.had_sms THEN 'skipped'
              ELSE 'unreachable' END,
         -- Not texted because texts were off: the reason stays on the row (the log).
         CASE WHEN v_off IS NOT NULL AND x.had_sms
                THEN CASE v_off WHEN 'monthly_allowance' THEN 'no_texts_left' ELSE 'text_cap' END
              WHEN cardinality(x.route) > 0 OR x.push_ok THEN NULL
              WHEN x.opted_out THEN 'sms_opted_out' ELSE 'no_contact' END,
         CASE WHEN x.route[1] = 'sms' THEN public.brand_form_text_window(v_tz, now()) ELSE now() END,
         p_actor_id, CASE WHEN cardinality(x.route) = 0 AND NOT x.push_ok THEN now() END
    FROM pg_temp.brand_form_enqueue_rows x;

  SELECT count(*) FILTER (WHERE cardinality(route) > 0 OR push_ok),
         count(*) FILTER (WHERE cardinality(route) = 0 AND NOT push_ok AND NOT (v_off IS NOT NULL AND had_sms)),
         count(*) FILTER (WHERE cardinality(route) = 0 AND NOT push_ok AND v_off IS NOT NULL AND had_sms),
         count(*) FILTER (WHERE route[1] = 'sms'),
         count(*) FILTER (WHERE route[1] = 'sms' AND public.brand_form_text_window(v_tz, now()) > now())
    INTO v_queued, v_unreachable, v_skipped, v_texts, v_waiting
    FROM pg_temp.brand_form_enqueue_rows;
  DELETE FROM pg_temp.brand_form_enqueue_rows;
  RETURN jsonb_build_object('queued', v_queued, 'unreachable', v_unreachable,
    'throttled', v_throttled, 'answered', v_answered, 'textsQueued', v_texts,
    'waitingForMorning', v_waiting, 'skippedNoTexts', v_skipped,
    'textsOff', CASE WHEN v_off IS NULL THEN NULL ELSE jsonb_build_object(
      'reason', v_off, 'needed', v_needed,
      'remaining', CASE WHEN v_off = 'monthly_allowance' THEN v_remaining ELSE v_today_left END) END);
END;
$fn$;

-- The claim. R3.2: push is tried first only for a person whose app can open the
-- form right now (the switch on, a capability row seen in 45 days); the claimed
-- route says so. Nothing to try at all: settled 'unreachable' (push_not_ready).
CREATE OR REPLACE FUNCTION public.brand_form_request_claim_batch(
  p_limit integer DEFAULT 25, p_form_id uuid DEFAULT NULL, p_event_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_row record; v_out jsonb := '[]'::jsonb; v_link jsonb; v_contact jsonb;
  v_subject_kind text; v_subject_id uuid; v_window timestamptz; v_starts timestamptz;
  v_user uuid; v_push boolean;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'limit_invalid' USING ERRCODE = '22023';
  END IF;
  -- R1.8: switched off, nothing is claimed and every row stays queued.
  IF public.brand_forms_switched_off() THEN RETURN '[]'::jsonb; END IF;
  UPDATE public.brand_form_request_sends
     SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
         safe_reason = CASE WHEN attempts >= 3 THEN 'claim_expired' ELSE 'claim_retried' END,
         settled_at = CASE WHEN attempts >= 3 THEN now() END, not_before = now()
   WHERE status = 'claimed' AND claimed_at < now() - interval '10 minutes';
  UPDATE public.brand_form_request_sends
     SET status = 'failed', safe_reason = 'expired', settled_at = now()
   WHERE status = 'queued' AND created_at < now() - interval '24 hours';
  UPDATE public.brand_form_auto_reminder_runs r
     SET outcome = CASE WHEN EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                                     WHERE s.run_id = r.id AND s.status = 'sent')
                          OR NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                                         WHERE s.run_id = r.id AND s.status = 'failed')
                        THEN 'sent' ELSE 'failed' END,
         settled_at = now()
   WHERE r.outcome = 'sending'
     AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                      WHERE s.run_id = r.id AND s.status IN ('queued', 'claimed'));

  FOR v_row IN
    SELECT s.id, s.form_id, s.event_id, s.rsvp_id, s.rsvp_guest_id, s.order_id,
           s.kind, s.route, s.try_push, s.safe_reason, s.created_by, s.starts_at,
           f.status AS form_status, e.timezone AS tz, e.title AS event_title, b.name AS brand_name
      FROM public.brand_form_request_sends s
      JOIN public.brand_forms f ON f.id = s.form_id
      JOIN public.events e ON e.id = s.event_id
      JOIN public.brands b ON b.id = s.brand_id
     WHERE s.status = 'queued' AND s.not_before <= now()
       AND (p_form_id IS NULL OR s.form_id = p_form_id)
       AND (p_event_id IS NULL OR s.event_id = p_event_id)
     ORDER BY s.not_before, s.created_at
     LIMIT p_limit FOR UPDATE OF s SKIP LOCKED
  LOOP
    v_subject_kind := CASE WHEN v_row.rsvp_id IS NOT NULL THEN 'rsvp'
                           WHEN v_row.rsvp_guest_id IS NOT NULL THEN 'rsvp_guest'
                           ELSE 'order' END;
    v_subject_id := COALESCE(v_row.rsvp_id, v_row.rsvp_guest_id, v_row.order_id);
    PERFORM pg_advisory_xact_lock(
      public.brand_form_person_lock_key(v_row.form_id, v_subject_kind, v_subject_id));
    IF v_row.form_status <> 'live' THEN
      UPDATE public.brand_form_request_sends
         SET status = 'skipped', safe_reason = 'form_closed', settled_at = now() WHERE id = v_row.id;
      CONTINUE;
    END IF;
    -- R1.4: re-checked at claim; a guest who stopped being current is skipped.
    IF NOT public.brand_form_subject_current(v_subject_kind, v_subject_id, v_row.event_id) THEN
      UPDATE public.brand_form_request_sends
         SET status = 'skipped', safe_reason = 'not_current', settled_at = now() WHERE id = v_row.id;
      CONTINUE;
    END IF;
    v_starts := COALESCE(v_row.starts_at,
      (SELECT max(d.at) FROM public.brand_form_guest_dates(
        v_subject_kind, v_subject_id, v_row.event_id) d(at)));
    IF v_starts IS NOT NULL AND v_starts <= now() THEN
      UPDATE public.brand_form_request_sends
         SET status = 'skipped', safe_reason = 'event_started', settled_at = now() WHERE id = v_row.id;
      CONTINUE;
    END IF;
    IF v_row.kind IN ('remind', 'auto')
       AND (public.brand_form_person_response(
         v_row.form_id, v_subject_kind, v_subject_id, v_row.event_id)).id IS NOT NULL THEN
      UPDATE public.brand_form_request_sends
         SET status = 'skipped', safe_reason = 'answered', settled_at = now() WHERE id = v_row.id;
      CONTINUE;
    END IF;
    v_user := COALESCE(
      (SELECT x.user_id FROM public.event_rsvps x WHERE x.id = v_row.rsvp_id),
      (SELECT g.matched_user_id FROM public.event_rsvp_guests g
        WHERE g.id = v_row.rsvp_guest_id AND g.claimed_at IS NOT NULL),
      (SELECT o.buyer_user_id FROM public.orders o WHERE o.id = v_row.order_id));
    -- R3.2: decided again now (the switch, the person's app).
    v_push := v_row.try_push AND public.brand_form_push_eligible(v_user);
    IF cardinality(v_row.route) = 0 AND NOT v_push THEN
      UPDATE public.brand_form_request_sends
         SET status = 'unreachable', safe_reason = 'push_not_ready', settled_at = now() WHERE id = v_row.id;
      CONTINUE;
    END IF;
    IF v_row.route[1] = 'sms' THEN
      v_window := public.brand_form_text_window(v_row.tz, now());
      IF v_window > now() THEN
        UPDATE public.brand_form_request_sends SET not_before = v_window WHERE id = v_row.id;
        CONTINUE;
      END IF;
    END IF;
    v_contact := public.brand_form_subject_contact(v_subject_kind, v_subject_id);
    v_link := public.brand_form_link_issue(v_row.form_id, v_row.event_id,
      jsonb_build_object('kind', v_subject_kind, 'id', v_subject_id), v_row.created_by);
    UPDATE public.brand_form_request_sends
       SET status = 'claimed', claimed_at = now(), attempts = attempts + 1,
           link_id = (v_link->>'linkId')::uuid
     WHERE id = v_row.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'sendId', v_row.id, 'token', v_link->>'token', 'formId', v_row.form_id,
      'eventId', v_row.event_id, 'kind', v_row.kind,
      'subjectKind', v_subject_kind, 'subjectId', v_subject_id,
      'userId', v_user,
      'route', to_jsonb(CASE WHEN v_push THEN ARRAY['push']::text[] || v_row.route ELSE v_row.route END),
      'textsOffReason', CASE WHEN v_row.safe_reason IN ('no_texts_left', 'text_cap') THEN v_row.safe_reason END,
      'phone', v_contact->>'phone', 'email', v_contact->>'email',
      'brandName', v_row.brand_name, 'eventTitle', v_row.event_title, 'eventTimezone', v_row.tz,
      'startsAt', COALESCE(v_row.starts_at,
        (SELECT min(d.start_at) FROM public.event_dates d
          WHERE d.event_id = v_row.event_id AND d.start_at > now() AND d.cancelled_at IS NULL))));
  END LOOP;
  RETURN v_out;
END;
$fn$;

-- Settle keeps the reason a guest was not texted (the daily cap or the monthly
-- allowance) on a row that then went by email, so the delivery log says so.
CREATE OR REPLACE FUNCTION public.brand_form_request_settle(
  p_send_id uuid, p_channel text, p_status text, p_reason text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_n integer;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('sent', 'failed', 'unreachable') THEN
    RAISE EXCEPTION 'status_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.brand_form_request_sends
     SET status = p_status, channel = p_channel, settled_at = now(),
         -- A guest emailed because texts were off keeps 'text_cap' (today's 300)
         -- or 'no_texts_left' (the monthly allowance) in the log.
         safe_reason = CASE WHEN p_reason ~ '^[a-z0-9_]{1,64}$' THEN p_reason
                            WHEN p_status = 'sent' AND safe_reason IN ('text_cap', 'no_texts_left')
                              THEN safe_reason END
   WHERE id = p_send_id AND status = 'claimed';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END;
$fn$;

-- The automatic reminder. R5.2: blast_cap before the request lock for each
-- brand. R5.4: per brand per run, the same rule as a send: when the run needs
-- more texts than the month or today allows, texts are off for the whole run
-- (email still goes; no email: skipped with the reason).
CREATE OR REPLACE FUNCTION public.brand_form_auto_reminders_due() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_a record; v_d record; v_run uuid; v_ch text[]; v_n integer; v_needed integer;
  v_remaining integer; v_today_left integer; v_off text;
  v_runs integer := 0; v_queued integer := 0; v_held integer := 0; v_texts_off integer := 0;
BEGIN
  -- R1.8: switched off, no automatic reminder is queued.
  IF public.brand_forms_switched_off() THEN RETURN '[]'::jsonb; END IF;
  FOR v_a IN
    SELECT a.id AS attachment_id, a.form_id, a.event_id, a.brand_id, a.auto_remind_channels,
           COALESCE(a.created_by, b.account_id) AS host_id,
           f.status AS form_status, f.name AS form_name, e.title AS event_title, e.timezone AS tz
      FROM public.brand_form_attachments a
      JOIN public.brand_forms f ON f.id = a.form_id
      JOIN public.events e ON e.id = a.event_id
      JOIN public.brands b ON b.id = a.brand_id
     WHERE a.detached_at IS NULL AND a.auto_remind
       AND e.deleted_at IS NULL AND e.status IN ('scheduled', 'live') AND f.status <> 'draft'
       AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = a.event_id
                    AND d.start_at > now() + interval '46 hours' AND d.start_at <= now() + interval '48 hours'
                   UNION ALL
                   SELECT 1 FROM public.orders o WHERE o.event_id = a.event_id
                    AND o.booked_start_at > now() + interval '46 hours'
                    AND o.booked_start_at <= now() + interval '48 hours')
     ORDER BY a.id FOR UPDATE OF a SKIP LOCKED
  LOOP
    v_ch := ARRAY(SELECT c FROM unnest(v_a.auto_remind_channels) c WHERE c IN ('sms', 'email'));
    FOR v_d IN
      SELECT DISTINCT d.at AS starts_at
        FROM public.brand_form_request_guests(v_a.form_id, v_a.event_id, NULL) g
        CROSS JOIN LATERAL public.brand_form_guest_dates(g.g_kind, g.g_id, v_a.event_id) d(at)
       WHERE d.at > now() + interval '46 hours' AND d.at <= now() + interval '48 hours'
       ORDER BY 1
    LOOP
      IF v_a.form_status <> 'live' THEN
        INSERT INTO public.brand_form_auto_reminder_runs (
          attachment_id, form_id, event_id, starts_at, outcome, settled_at)
        VALUES (v_a.attachment_id, v_a.form_id, v_a.event_id, v_d.starts_at, 'held_form_closed', now())
        ON CONFLICT (attachment_id, starts_at) DO NOTHING;
        IF FOUND THEN
          v_held := v_held + 1;
          IF v_a.host_id IS NOT NULL THEN
            INSERT INTO public.notification_outbox (
              category_key, user_id, brand_id, country_code, payload, idempotency_key)
            VALUES ('business.brand_form_reminder_held', v_a.host_id, v_a.brand_id, NULL,
                    jsonb_build_object('form_id', v_a.form_id, 'event_id', v_a.event_id,
                      'brand_id', v_a.brand_id, 'form_name', v_a.form_name,
                      'event_title', v_a.event_title,
                      'deep_link', 'mingla-business://marketing/forms/' || v_a.form_id::text || '/responses'),
                    'brand_form_reminder_held:' || v_a.attachment_id::text || ':'
                      || extract(epoch FROM v_d.starts_at)::bigint::text)
            ON CONFLICT (idempotency_key) DO NOTHING;
          END IF;
        END IF;
        CONTINUE;
      END IF;
      INSERT INTO public.brand_form_auto_reminder_runs (
        attachment_id, form_id, event_id, starts_at, outcome)
      VALUES (v_a.attachment_id, v_a.form_id, v_a.event_id, v_d.starts_at, 'sending')
      ON CONFLICT (attachment_id, starts_at) DO NOTHING RETURNING id INTO v_run;
      IF v_run IS NULL THEN
        SELECT r.id INTO v_run FROM public.brand_form_auto_reminder_runs r
         WHERE r.attachment_id = v_a.attachment_id AND r.starts_at = v_d.starts_at
           AND r.outcome <> 'held_form_closed';
        IF v_run IS NULL THEN CONTINUE; END IF;
      ELSE
        v_runs := v_runs + 1;
      END IF;
      -- R5.2: the shared text budget's lock first.
      PERFORM pg_advisory_xact_lock(hashtextextended('blast_cap:' || v_a.brand_id::text || ':sms', 3682));
      PERFORM pg_advisory_xact_lock(
        hashtextextended('brand_form_request:' || v_a.brand_id::text, 4514));
      CREATE TEMP TABLE IF NOT EXISTS pg_temp.brand_form_auto_due (
        g_kind text, g_id uuid, g_person_key text, route text[]) ON COMMIT DROP;
      DELETE FROM pg_temp.brand_form_auto_due;
      INSERT INTO pg_temp.brand_form_auto_due
      SELECT x.g_kind, x.g_id, x.g_person_key,
             public.brand_form_request_route(x.g_phone, x.g_email, v_ch)
        FROM (SELECT DISTINCT ON (g.g_person_key) g.*
                FROM public.brand_form_request_guests(v_a.form_id, v_a.event_id, NULL) g
               WHERE EXISTS (SELECT 1 FROM public.brand_form_guest_dates(g.g_kind, g.g_id, v_a.event_id) d(at)
                              WHERE d.at = v_d.starts_at)
               ORDER BY g.g_person_key, g.g_answered DESC, g.g_kind, g.g_id) x
       WHERE NOT x.g_answered
         AND NOT public.brand_form_added_by_host(x.g_kind, x.g_id)
         AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s
          WHERE s.form_id = v_a.form_id AND s.person_key = x.g_person_key
            AND s.status IN ('queued', 'claimed', 'sent')
            AND s.created_at > now() - interval '24 hours')
         AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s
          WHERE s.run_id = v_run AND s.person_key = x.g_person_key);
      -- R5.4: the same rule as a send, per brand per run.
      v_off := NULL;
      SELECT count(*) FILTER (WHERE route[1] = 'sms') INTO v_needed FROM pg_temp.brand_form_auto_due;
      IF v_needed > 0 THEN
        v_remaining := (public.brand_form_sms_month_state(v_a.brand_id)->>'remaining')::integer;
        v_today_left := GREATEST(public.brand_form_request_text_cap()
                                 - public.brand_form_request_texts_today(v_a.brand_id), 0);
        IF v_remaining IS NOT NULL AND v_needed > v_remaining THEN
          v_off := 'no_texts_left';
        ELSIF v_needed > v_today_left THEN
          v_off := 'text_cap';
        END IF;
      END IF;
      IF v_off IS NOT NULL THEN v_texts_off := v_texts_off + 1; END IF;
      WITH ins AS (
        INSERT INTO public.brand_form_request_sends (
          form_id, attachment_id, event_id, brand_id, rsvp_id, rsvp_guest_id, order_id,
          run_id, person_key, kind, route, status, safe_reason, starts_at, not_before, settled_at)
        SELECT v_a.form_id, v_a.attachment_id, v_a.event_id, v_a.brand_id,
               CASE WHEN y.g_kind = 'rsvp' THEN y.g_id END,
               CASE WHEN y.g_kind = 'rsvp_guest' THEN y.g_id END,
               CASE WHEN y.g_kind = 'order' THEN y.g_id END,
               v_run, y.g_person_key, 'auto',
               CASE WHEN cardinality(y.sent_route) = 0 THEN y.route ELSE y.sent_route END,
               CASE WHEN cardinality(y.route) = 0 THEN 'unreachable'
                    WHEN cardinality(y.sent_route) = 0 THEN 'skipped' ELSE 'queued' END,
               CASE WHEN cardinality(y.route) = 0 THEN 'no_contact' WHEN y.capped THEN v_off END,
               v_d.starts_at,
               CASE WHEN y.sent_route[1] = 'sms' THEN public.brand_form_text_window(v_a.tz, now()) ELSE now() END,
               CASE WHEN cardinality(y.sent_route) = 0 THEN now() END
          FROM (SELECT z.*, v_off IS NOT NULL AND z.route[1] = 'sms' AS capped,
                       CASE WHEN v_off IS NOT NULL THEN array_remove(z.route, 'sms') ELSE z.route END AS sent_route
                  FROM pg_temp.brand_form_auto_due z) y
        ON CONFLICT (run_id, person_key) WHERE run_id IS NOT NULL DO NOTHING
        RETURNING 1
      )
      SELECT count(*)::integer INTO v_n FROM ins;
      DELETE FROM pg_temp.brand_form_auto_due;
      v_queued := v_queued + v_n;
      IF v_n > 0 THEN
        UPDATE public.brand_form_auto_reminder_runs SET outcome = 'sending', settled_at = NULL
         WHERE id = v_run AND outcome IN ('sent', 'failed');
      END IF;
      v_run := NULL;
    END LOOP;
  END LOOP;
  -- textsOff (runs that went without texts) only when there was one: the shape is otherwise today's.
  RETURN jsonb_build_object('runs', v_runs, 'queued', v_queued, 'held', v_held)
    || CASE WHEN v_texts_off > 0 THEN jsonb_build_object('textsOff', v_texts_off) ELSE '{}'::jsonb END;
END;
$fn$;

-- ===========================================================================
-- Wave 6: Blast "+ Form" (R4.1 to R4.9) and the Admin numbers (R7.1)
-- ===========================================================================
--   R4.1  replies not tied to a page: campaign_id, a known Blast recipient
--         (blast_contact_key, a hash: never the contact itself) with owner_label,
--         or unknown_owner; personal Blast links (kind 'blast'); the per-form
--         open-reply limit (500 a day, Admin only)
--   R4.3  the confirm check, the closed-form hold and the per-recipient link mint
--   R4.4  who a reply belongs to; typed answers never change it
--   R4.5  submit for Blast replies (campaign window, open-reply cap)
--   R4.6  never on a guest record or at the door
--   R4.7  Responses: owner filter, hidden rows, "Unknown" for old Host builds
--   R4.8  hide with undo; R4.9 Blast reply counts; R7.1 Admin numbers

-- ---------------------------------------------------------------------------
-- 4. Schema (R4.1)
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_form_responses
  ADD COLUMN campaign_id uuid REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN blast_contact_key text
    CHECK (blast_contact_key IS NULL OR char_length(blast_contact_key) BETWEEN 1 AND 200),
  ADD COLUMN owner_label text CHECK (owner_label IS NULL OR char_length(owner_label) BETWEEN 1 AND 80),
  ADD COLUMN unknown_owner boolean NOT NULL DEFAULT false,
  ADD COLUMN hidden_at timestamptz,
  ADD COLUMN hidden_by uuid;
ALTER TABLE public.brand_form_responses
  DROP CONSTRAINT brand_form_responses_one_subject,
  ADD CONSTRAINT brand_form_responses_one_subject CHECK (
    num_nonnulls(rsvp_id, rsvp_guest_id, order_id, user_id, contact_name, blast_contact_key)
      + (CASE WHEN unknown_owner THEN 1 ELSE 0 END) = 1),
  DROP CONSTRAINT brand_form_responses_verified,
  ADD CONSTRAINT brand_form_responses_verified CHECK (verified = (contact_name IS NULL AND NOT unknown_owner)),
  -- A Blast or Unknown reply belongs to no page. (Spec: also campaign_id NOT NULL; the
  -- campaign reference is ON DELETE SET NULL, so requiring it here would block deleting
  -- a campaign. The submit always sets it; the reply keeps its answers if it goes.)
  ADD CONSTRAINT brand_form_responses_blast_ctx CHECK (
    (blast_contact_key IS NULL AND NOT unknown_owner) OR event_id IS NULL),
  ADD CONSTRAINT brand_form_responses_hidden_unknown CHECK (hidden_at IS NULL OR unknown_owner);
CREATE UNIQUE INDEX brand_form_responses_one_per_blast_contact
  ON public.brand_form_responses (form_id, blast_contact_key) WHERE blast_contact_key IS NOT NULL;
CREATE INDEX brand_form_responses_unknown_idx
  ON public.brand_form_responses (form_id, submitted_at) WHERE unknown_owner;
CREATE INDEX brand_form_responses_campaign_idx
  ON public.brand_form_responses (form_id, campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE public.brand_form_links
  DROP CONSTRAINT brand_form_links_kind_check,
  ADD CONSTRAINT brand_form_links_kind_check CHECK (kind IN ('person', 'open', 'blast')),
  ADD COLUMN campaign_id uuid REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  ADD COLUMN blast_contact_key text
    CHECK (blast_contact_key IS NULL OR char_length(blast_contact_key) BETWEEN 1 AND 200),
  ADD COLUMN recipient_label text CHECK (recipient_label IS NULL OR char_length(recipient_label) BETWEEN 1 AND 80),
  DROP CONSTRAINT brand_form_links_subject,
  ADD CONSTRAINT brand_form_links_subject CHECK (
    (kind = 'open' AND num_nonnulls(rsvp_id, rsvp_guest_id, order_id, user_id, blast_contact_key) = 0)
    OR (kind = 'person' AND num_nonnulls(rsvp_id, rsvp_guest_id, order_id, user_id) = 1
        AND blast_contact_key IS NULL AND campaign_id IS NULL)
    OR (kind = 'blast' AND num_nonnulls(rsvp_id, rsvp_guest_id, order_id, user_id) = 0
        AND blast_contact_key IS NOT NULL AND campaign_id IS NOT NULL AND event_id IS NULL));
CREATE INDEX brand_form_links_blast_idx
  ON public.brand_form_links (form_id, blast_contact_key) WHERE blast_contact_key IS NOT NULL;

ALTER TABLE public.brand_forms
  ADD COLUMN open_reply_limit_per_day integer NOT NULL DEFAULT 500
    CHECK (open_reply_limit_per_day BETWEEN 0 AND 5000);

-- R4.3 (decision 10): a scheduled Blast whose form closed first is not sent.
ALTER TABLE public.marketing_campaigns
  ADD COLUMN failure_reason text CHECK (failure_reason IS NULL OR failure_reason ~ '^[a-z0-9_]{1,64}$');

INSERT INTO public.notification_categories(key, section, is_transactional, urgency, default_channels, reach_mode)
VALUES ('business.blast_form_closed', 'support', true, 'normal', ARRAY['inapp', 'push'], 'reach_once')
ON CONFLICT (key) DO UPDATE SET section = EXCLUDED.section, is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency, default_channels = EXCLUDED.default_channels, reach_mode = EXCLUDED.reach_mode,
  active = true;

-- R4.1: the guard also fixes a Blast reply's owner.
CREATE OR REPLACE FUNCTION public.brand_form_responses_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.brand_form_versions v JOIN public.brand_forms f ON f.id = v.form_id
                  WHERE v.id = NEW.version_id AND v.form_id = NEW.form_id AND f.brand_id = NEW.brand_id) THEN
    RAISE EXCEPTION 'response_version_mismatch' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.form_id <> OLD.form_id OR NEW.brand_id <> OLD.brand_id
       OR NEW.rsvp_id IS DISTINCT FROM OLD.rsvp_id OR NEW.rsvp_guest_id IS DISTINCT FROM OLD.rsvp_guest_id
       OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
       -- #4541 R4.1: who a Blast reply belongs to never changes.
       OR NEW.blast_contact_key IS DISTINCT FROM OLD.blast_contact_key
       OR NEW.unknown_owner IS DISTINCT FROM OLD.unknown_owner) THEN
    RAISE EXCEPTION 'response_subject_fixed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;


-- ---------------------------------------------------------------------------
-- 5. Blast helpers (R4.3, R4.4)
-- ---------------------------------------------------------------------------
-- A known Blast recipient, per brand: a hash of the audience contact key, never
-- the contact itself. Typed answers never feed it.
CREATE FUNCTION public.brand_form_blast_contact_key(p_brand_id uuid, p_contact_key text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT CASE WHEN p_brand_id IS NULL OR NULLIF(btrim(COALESCE(p_contact_key, '')), '') IS NULL THEN NULL
         ELSE encode(sha256(convert_to('brand_form_blast:' || p_brand_id::text || ':' || lower(btrim(p_contact_key)), 'UTF8')), 'hex')
         END;
$fn$;

-- R4.5 campaign window: a sent (or sending) campaign of the form's brand that
-- embeds this form (itself or a sibling channel of the same Blast), sent in
-- the last 30 days.
CREATE FUNCTION public.brand_form_blast_campaign_ok(p_form_id uuid, p_campaign_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT COALESCE((
    SELECT true FROM public.marketing_campaigns c
      JOIN public.brand_forms f ON f.id = p_form_id AND f.brand_id = c.brand_id
     WHERE c.id = p_campaign_id AND c.status IN ('sending', 'sent')
       AND COALESCE(c.sent_at, c.updated_at) > now() - interval '30 days'
       AND EXISTS (SELECT 1 FROM public.marketing_campaigns g
                    WHERE (g.id = c.id OR (c.campaign_group_id IS NOT NULL AND g.campaign_group_id = c.campaign_group_id))
                      AND g.brand_id = c.brand_id
                      AND g.channel_payload->'embedded_form'->>'form_id' = p_form_id::text)), false);
$fn$;

-- R4.3: the confirm/schedule check of a campaign's embedded form.
CREATE FUNCTION public.brand_form_blast_check(p_campaign_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_c record; v_form text; v_f record;
BEGIN
  SELECT c.id, c.brand_id, c.channel_payload INTO v_c FROM public.marketing_campaigns c WHERE c.id = p_campaign_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'campaign_not_found'); END IF;
  v_form := v_c.channel_payload->'embedded_form'->>'form_id';
  IF v_form IS NULL THEN RETURN jsonb_build_object('ok', true, 'formId', NULL); END IF;
  IF v_form !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'embedded_form_other_brand');
  END IF;
  SELECT f.id, f.brand_id, f.status, f.name INTO v_f FROM public.brand_forms f WHERE f.id = v_form::uuid;
  IF NOT FOUND OR v_f.brand_id <> v_c.brand_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'embedded_form_other_brand');
  END IF;
  IF v_f.status <> 'live' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'embedded_form_not_live', 'formId', v_f.id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'formId', v_f.id, 'formName', v_f.name);
END;
$fn$;

-- R4.3 (decision 10): at claim, a campaign whose embedded form is no longer
-- live is failed (form_closed), sends nothing, and the host is told.
CREATE FUNCTION public.brand_form_blast_hold_if_closed(p_campaign_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_c record; v_check jsonb;
BEGIN
  v_check := public.brand_form_blast_check(p_campaign_id);
  IF (v_check->>'ok')::boolean OR v_check->>'code' = 'campaign_not_found' THEN RETURN false; END IF;
  SELECT c.id, c.account_id, c.brand_id, c.name INTO v_c FROM public.marketing_campaigns c WHERE c.id = p_campaign_id;
  UPDATE public.marketing_campaigns
     SET status = 'failed', failure_reason = 'form_closed', updated_at = now()
   WHERE id = p_campaign_id AND status IN ('scheduled', 'sending');
  IF FOUND AND v_c.account_id IS NOT NULL THEN
    INSERT INTO public.notification_outbox (category_key, user_id, brand_id, country_code, payload, idempotency_key)
    VALUES ('business.blast_form_closed', v_c.account_id, v_c.brand_id, NULL,
            jsonb_build_object('campaign_id', v_c.id, 'brand_id', v_c.brand_id, 'campaign_name', v_c.name,
              'form_id', v_check->>'formId',
              'form_name', (SELECT f.name FROM public.brand_forms f WHERE f.id::text = v_check->>'formId')),
            'blast_form_closed:' || v_c.id::text)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN true;
END;
$fn$;

-- R4.3 / R8.2: one recipient's personal Blast link. A new link switches off the
-- same recipient's earlier links for this form. 30 days.
CREATE FUNCTION public.brand_form_link_issue_blast(
  p_form_id uuid, p_campaign_id uuid, p_contact_key text, p_recipient_label text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_f record; v_key text; v_token text; v_link uuid; v_exp timestamptz; v_label text;
BEGIN
  SELECT f.id, f.brand_id, f.status INTO v_f FROM public.brand_forms f WHERE f.id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_f.status <> 'live' THEN RAISE EXCEPTION 'form_closed' USING ERRCODE = '22023'; END IF;
  IF NOT public.brand_form_blast_campaign_ok(p_form_id, p_campaign_id) THEN
    RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501';
  END IF;
  v_key := public.brand_form_blast_contact_key(v_f.brand_id, p_contact_key);
  IF v_key IS NULL THEN RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023'; END IF;
  v_label := NULLIF(left(btrim(COALESCE(p_recipient_label, '')), 80), '');
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_exp := now() + interval '30 days';
  INSERT INTO public.brand_form_links (form_id, kind, campaign_id, blast_contact_key, recipient_label,
                                       token_hash, expires_at)
  VALUES (p_form_id, 'blast', p_campaign_id, v_key, v_label, public.brand_form_token_hash(v_token), v_exp)
  RETURNING id INTO v_link;
  UPDATE public.brand_form_links l SET revoked_at = now()
   WHERE l.form_id = p_form_id AND l.id <> v_link AND l.revoked_at IS NULL
     AND l.kind = 'blast' AND l.blast_contact_key = v_key;
  RETURN jsonb_build_object('linkId', v_link, 'token', v_token, 'expiresAt', v_exp, 'formId', p_form_id);
END;
$fn$;

-- R4.5: the Blast form read ({op:"blast_form"}): the definition and brand, the
-- campaign window checked. Never responses.
CREATE FUNCTION public.brand_form_blast_form(p_form_id uuid, p_campaign_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_f record;
BEGIN
  IF public.brand_forms_switched_off() THEN RAISE EXCEPTION 'forms_paused' USING ERRCODE = '55000'; END IF;
  SELECT f.id, f.name, f.status, f.brand_id, f.live_version_id, f.door_full_answers INTO v_f
    FROM public.brand_forms f WHERE f.id = p_form_id;
  IF NOT FOUND OR v_f.status IN ('archived', 'draft') THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_f.status = 'closed' THEN RAISE EXCEPTION 'form_closed' USING ERRCODE = '22023'; END IF;
  IF NOT public.brand_form_blast_campaign_ok(p_form_id, p_campaign_id) THEN
    RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'form', jsonb_build_object('id', v_f.id, 'name', v_f.name, 'status', v_f.status,
      'versionId', v_f.live_version_id,
      'definition', (SELECT v.definition FROM public.brand_form_versions v WHERE v.id = v_f.live_version_id),
      'doorFullAnswers', false),
    'brand', public.brand_form_brand_header(v_f.brand_id),
    'campaignId', p_campaign_id);
END;
$fn$;

-- R4.4 / R4.5: Blast replies. Called by brand_form_submit_core only.
--   {kind:'link', token} of a kind 'blast' link: the recipient (known); a second
--     answer, or one after the 30-day recognition, needs the one-time code, which
--     a Blast link cannot get (no contact is kept): code_required, and the page
--     offers "Answer without confirming" (Unknown).
--   {kind:'user', userId, campaignId}: the signed-in person's own answer.
--   {kind:'unknown', campaignId}: Unknown; a new row every time; the per-form
--     open-reply limit under its own lock.
CREATE FUNCTION public.brand_form_submit_blast(p jsonb, p_brand_id uuid, p_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_cred jsonb := p->'credential'; v_form uuid := (p->>'formId')::uuid;
  v_campaign uuid; v_link record; v_key text; v_label text; v_user uuid; v_kind text;
  v_ex record; v_check jsonb; v_expected integer; v_id uuid; v_edit integer; v_limit integer; v_n integer;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF v_cred->>'kind' = 'link' THEN
    SELECT l.id, l.form_id, l.kind, l.revoked_at, l.expires_at, l.campaign_id, l.blast_contact_key, l.recipient_label
      INTO v_link FROM public.brand_form_link_by_token(v_cred->>'token') l;
    IF v_link.id IS NULL OR v_link.kind <> 'blast' THEN RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501'; END IF;
    IF v_link.form_id <> v_form THEN RAISE EXCEPTION 'link_wrong_form' USING ERRCODE = '42501'; END IF;
    IF v_link.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'link_revoked' USING ERRCODE = '42501'; END IF;
    v_kind := 'blast'; v_campaign := v_link.campaign_id; v_key := v_link.blast_contact_key; v_label := v_link.recipient_label;
  ELSIF v_cred->>'kind' = 'user' THEN
    IF COALESCE(v_cred->>'userId', '') !~ v_uuid OR COALESCE(v_cred->>'campaignId', '') !~ v_uuid THEN
      RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
    END IF;
    v_user := (v_cred->>'userId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_user) THEN
      RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
    END IF;
    v_kind := 'app_user'; v_campaign := (v_cred->>'campaignId')::uuid;
  ELSIF v_cred->>'kind' = 'unknown' THEN
    IF COALESCE(v_cred->>'campaignId', '') !~ v_uuid THEN RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023'; END IF;
    v_kind := 'unknown'; v_campaign := (v_cred->>'campaignId')::uuid;
  ELSE
    RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
  END IF;
  -- R4.5 campaign window.
  IF v_campaign IS NULL OR NOT public.brand_form_blast_campaign_ok(v_form, v_campaign) THEN
    RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501';
  END IF;

  IF v_kind = 'unknown' THEN
    -- R4.5: the per-form open-reply limit, counted and written under one lock.
    PERFORM pg_advisory_xact_lock(hashtextextended('brand_form_open:' || v_form::text, 0));
    SELECT f.open_reply_limit_per_day INTO v_limit FROM public.brand_forms f WHERE f.id = v_form;
    SELECT count(*) INTO v_n FROM public.brand_form_responses r
     WHERE r.form_id = v_form AND r.unknown_owner AND r.submitted_at > now() - interval '24 hours';
    IF v_n >= COALESCE(v_limit, 500) THEN RAISE EXCEPTION 'open_reply_limit' USING ERRCODE = '54000'; END IF;
    SELECT NULL::uuid AS id, NULL::integer AS edit_count INTO v_ex;
  ELSIF v_kind = 'blast' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('brand_form_blast_person:' || v_form::text || ':' || v_key, 0));
    SELECT r.id, r.edit_count INTO v_ex FROM public.brand_form_responses r
     WHERE r.form_id = v_form AND r.blast_contact_key = v_key;
    IF (v_ex.id IS NOT NULL OR v_link.expires_at <= now())
       AND NOT public.brand_form_code_grant_ok(v_link.id,
         CASE WHEN (v_cred->>'challengeId') ~ v_uuid THEN (v_cred->>'challengeId')::uuid END) THEN
      RAISE EXCEPTION 'code_required' USING ERRCODE = '42501';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(public.brand_form_person_lock_key(v_form, 'user', v_user));
    -- Only the person's own account-level answer; never a page answer of theirs.
    SELECT r.id, r.edit_count INTO v_ex FROM public.brand_form_responses r
     WHERE r.form_id = v_form AND r.user_id = v_user;
  END IF;
  IF v_kind <> 'unknown' THEN
    v_expected := CASE WHEN jsonb_typeof(p->'expectedEditCount') = 'number'
                            AND (p->>'expectedEditCount') ~ '^[0-9]{1,9}$'
                       THEN (p->>'expectedEditCount')::integer
                       WHEN jsonb_typeof(p->'expectedEditCount') = 'number' THEN -1 END;
    IF (v_expected IS NOT NULL AND (v_ex.id IS NULL OR v_ex.edit_count <> v_expected))
       OR (v_expected IS NULL AND v_ex.id IS NOT NULL) THEN
      RAISE EXCEPTION 'response_stale' USING ERRCODE = 'PT409',
        DETAIL = jsonb_build_object('editCount', v_ex.edit_count)::text;
    END IF;
  END IF;
  BEGIN
    v_check := public.brand_form_validate_answers(p_version_id, p->'answers');
  EXCEPTION WHEN data_exception THEN
    v_check := jsonb_build_object('ok', false,
      'errors', jsonb_build_array(jsonb_build_object('questionId', NULL, 'code', 'type')));
  END;
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'form_answers_invalid' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;

  IF v_ex.id IS NULL THEN
    INSERT INTO public.brand_form_responses (
      form_id, version_id, brand_id, campaign_id, user_id, blast_contact_key, owner_label,
      unknown_owner, verified, answers, source, via_link)
    VALUES (v_form, p_version_id, p_brand_id, v_campaign,
      CASE WHEN v_kind = 'app_user' THEN v_user END,
      CASE WHEN v_kind = 'blast' THEN v_key END,
      CASE WHEN v_kind = 'blast' THEN v_label END,
      v_kind = 'unknown', v_kind <> 'unknown', v_check->'answers', 'blast', v_kind = 'blast')
    RETURNING id, edit_count INTO v_id, v_edit;
  ELSE
    UPDATE public.brand_form_responses
       SET answers = v_check->'answers', version_id = p_version_id, edit_count = edit_count + 1,
           updated_at = now(), via_link = via_link OR v_kind = 'blast'
     WHERE id = v_ex.id
    RETURNING id, edit_count INTO v_id, v_edit;
  END IF;
  IF v_kind = 'blast' THEN
    UPDATE public.brand_form_links SET use_count = use_count + 1, last_used_at = now() WHERE id = v_link.id;
  END IF;
  RETURN jsonb_build_object('responseId', v_id, 'editCount', v_edit, 'versionId', p_version_id,
                            'created', v_ex.id IS NULL, 'eventId', NULL,
                            'editable', v_kind <> 'unknown', 'ownerKind', v_kind);
END;
$fn$;

-- R4.5: the only RPC writer routes Blast credentials.
CREATE OR REPLACE FUNCTION public.brand_form_submit_core(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_form_id uuid; v_f record; v_cred jsonb := p->'credential';
  v_link record; v_kind text; v_sid uuid; v_user uuid; v_event uuid; v_att uuid; v_mode text;
  v_version uuid; v_check jsonb; v_ex record;
  v_source text := COALESCE(p->>'source', 'page'); v_via_link boolean := false;
  v_id uuid; v_edit integer; v_expected integer; v_link_id uuid; v_link_exp timestamptz;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF public.brand_forms_switched_off() THEN RAISE EXCEPTION 'forms_paused' USING ERRCODE = '55000'; END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR COALESCE(p->>'formId', '') !~ v_uuid
     OR jsonb_typeof(v_cred) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_source NOT IN ('signup', 'page', 'link', 'pass', 'purchase_redirect', 'blast') THEN
    RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
  END IF;
  v_form_id := (p->>'formId')::uuid;
  SELECT f.id, f.status, f.brand_id, f.live_version_id INTO v_f
    FROM public.brand_forms f WHERE f.id = v_form_id FOR SHARE;
  IF NOT FOUND OR v_f.status = 'archived' THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_f.status = 'draft' THEN RAISE EXCEPTION 'form_not_live' USING ERRCODE = '22023'; END IF;
  IF v_f.status = 'closed' THEN RAISE EXCEPTION 'form_closed' USING ERRCODE = '22023'; END IF;
  IF p ? 'versionId' AND jsonb_typeof(p->'versionId') <> 'null'
     AND (p->>'versionId') IS DISTINCT FROM v_f.live_version_id::text THEN
    RAISE EXCEPTION 'form_changed' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('versionId', v_f.live_version_id)::text;
  END IF;
  v_version := v_f.live_version_id;
  -- #4541 R4.5: Blast replies (a personal Blast link, a signed-in person with a
  -- campaign, or Unknown) have their own rules.
  IF v_cred->>'kind' = 'unknown'
     OR (v_cred->>'kind' = 'user' AND COALESCE(v_cred->>'campaignId', '') <> '')
     OR (v_cred->>'kind' = 'link' AND EXISTS (
           SELECT 1 FROM public.brand_form_link_by_token(v_cred->>'token') l WHERE l.kind = 'blast')) THEN
    RETURN public.brand_form_submit_blast(p, v_f.brand_id, v_version);
  END IF;

  IF v_cred->>'kind' = 'link' THEN
    SELECT l.id, l.form_id, l.revoked_at, l.kind, l.event_id, l.expires_at,
           public.brand_form_link_subject(l) AS subject
      INTO v_link FROM public.brand_form_link_by_token(v_cred->>'token') l;
    IF v_link.id IS NULL THEN RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501'; END IF;
    IF v_link.form_id <> v_form_id THEN RAISE EXCEPTION 'link_wrong_form' USING ERRCODE = '42501'; END IF;
    IF v_link.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'link_revoked' USING ERRCODE = '42501'; END IF;
    IF v_link.kind <> 'person' THEN RAISE EXCEPTION 'subject_unavailable' USING ERRCODE = '22023'; END IF;
    v_kind := v_link.subject->>'kind';
    v_sid := (v_link.subject->>'id')::uuid;
    v_event := v_link.event_id;
    v_link_id := v_link.id; v_link_exp := v_link.expires_at;
    v_via_link := true;
  ELSIF v_cred->>'kind' = 'user' THEN
    IF (v_cred->>'userId') !~ v_uuid THEN RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023'; END IF;
    v_user := (v_cred->>'userId')::uuid;
    IF (v_cred->>'rsvpGuestId') ~ v_uuid THEN
      v_kind := 'rsvp_guest'; v_sid := (v_cred->>'rsvpGuestId')::uuid;
      SELECT r.event_id INTO v_event
        FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
       WHERE g.id = v_sid AND g.matched_user_id = v_user AND g.claimed_at IS NOT NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'not_holder' USING ERRCODE = '42501'; END IF;
      IF NOT public.brand_form_subject_current('rsvp_guest', v_sid, v_event) THEN
        RAISE EXCEPTION 'not_current' USING ERRCODE = '42501';
      END IF;
    ELSIF (v_cred->>'rsvpId') ~ v_uuid THEN
      v_kind := 'rsvp'; v_sid := (v_cred->>'rsvpId')::uuid;
      SELECT r.event_id INTO v_event FROM public.event_rsvps r WHERE r.id = v_sid AND r.user_id = v_user;
      IF NOT FOUND THEN RAISE EXCEPTION 'not_holder' USING ERRCODE = '42501'; END IF;
      IF NOT public.brand_form_subject_current('rsvp', v_sid, v_event) THEN
        RAISE EXCEPTION 'not_current' USING ERRCODE = '42501';
      END IF;
    ELSIF (v_cred->>'orderId') ~ v_uuid THEN
      v_kind := 'order'; v_sid := (v_cred->>'orderId')::uuid;
      SELECT o.event_id INTO v_event FROM public.orders o WHERE o.id = v_sid AND o.buyer_user_id = v_user;
      IF NOT FOUND THEN RAISE EXCEPTION 'not_holder' USING ERRCODE = '42501'; END IF;
      IF NOT public.brand_form_subject_current('order', v_sid, v_event) THEN
        RAISE EXCEPTION 'not_current' USING ERRCODE = '42501';
      END IF;
    ELSE
      v_kind := 'user'; v_sid := v_user;
      IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_user) THEN
        RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
      END IF;
      IF (p->>'eventId') ~ v_uuid THEN v_event := (p->>'eventId')::uuid; END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_kind, '') NOT IN ('rsvp', 'rsvp_guest', 'order', 'user') THEN
    RAISE EXCEPTION 'subject_unavailable' USING ERRCODE = '22023';
  END IF;
  IF NOT v_via_link AND v_event IS NULL THEN
    RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501';
  END IF;
  IF v_event IS NOT NULL THEN
    SELECT a.id, a.mode INTO v_att, v_mode FROM public.brand_form_attachments a
     WHERE a.event_id = v_event AND a.form_id = v_form_id AND a.detached_at IS NULL;
    IF v_att IS NULL THEN RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501'; END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(public.brand_form_person_lock_key(v_form_id, v_kind, v_sid));
  SELECT r.id, r.edit_count INTO v_ex
    FROM public.brand_form_person_response(v_form_id, v_kind, v_sid, v_event) r;
  -- R8.1: the same rule the signed-in read applies.
  IF NOT v_via_link AND v_kind = 'user' AND v_ex.id IS NULL AND NOT (
       public.brand_form_subject_current('user', v_user, v_event)
    OR EXISTS (SELECT 1 FROM public.tickets t
                WHERE t.event_id = v_event AND t.holder_user_id = v_user AND t.status IN ('valid', 'used'))
    OR (v_mode = 'optional_on_page' AND public.brand_form_event_public(v_event))) THEN
    RAISE EXCEPTION 'not_holder' USING ERRCODE = '42501';
  END IF;
  IF v_via_link AND (v_ex.id IS NOT NULL OR v_link_exp <= now())
     AND NOT public.brand_form_code_grant_ok(v_link_id,
       CASE WHEN (v_cred->>'challengeId') ~ v_uuid THEN (v_cred->>'challengeId')::uuid END) THEN
    RAISE EXCEPTION 'code_required' USING ERRCODE = '42501';
  END IF;
  v_expected := CASE WHEN jsonb_typeof(p->'expectedEditCount') = 'number'
                          AND (p->>'expectedEditCount') ~ '^[0-9]{1,9}$'
                     THEN (p->>'expectedEditCount')::integer
                     WHEN jsonb_typeof(p->'expectedEditCount') = 'number' THEN -1 END;
  IF (v_expected IS NOT NULL AND (v_ex.id IS NULL OR v_ex.edit_count <> v_expected))
     OR (v_expected IS NULL AND v_ex.id IS NOT NULL) THEN
    RAISE EXCEPTION 'response_stale' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('editCount', v_ex.edit_count)::text;
  END IF;
  BEGIN
    v_check := public.brand_form_validate_answers(v_version, p->'answers');
  EXCEPTION WHEN data_exception THEN
    v_check := jsonb_build_object('ok', false,
      'errors', jsonb_build_array(jsonb_build_object('questionId', NULL, 'code', 'type')));
  END;
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'form_answers_invalid' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;

  IF v_ex.id IS NULL THEN
    INSERT INTO public.brand_form_responses (
      form_id, version_id, brand_id, attachment_id, event_id,
      rsvp_id, rsvp_guest_id, order_id, user_id, answers, source, via_link)
    VALUES (v_form_id, v_version, v_f.brand_id, v_att, v_event,
      CASE WHEN v_kind = 'rsvp' THEN v_sid END,
      CASE WHEN v_kind = 'rsvp_guest' THEN v_sid END,
      CASE WHEN v_kind = 'order' THEN v_sid END,
      CASE WHEN v_kind = 'user' THEN v_sid END,
      v_check->'answers', v_source, v_via_link)
    RETURNING id, edit_count INTO v_id, v_edit;
  ELSE
    UPDATE public.brand_form_responses
       SET answers = v_check->'answers', version_id = v_version, edit_count = edit_count + 1,
           updated_at = now(), source = v_source, via_link = via_link OR v_via_link,
           attachment_id = COALESCE(v_att, attachment_id), event_id = COALESCE(event_id, v_event)
     WHERE id = v_ex.id
    RETURNING id, edit_count INTO v_id, v_edit;
  END IF;
  IF v_via_link THEN
    UPDATE public.brand_form_links SET use_count = use_count + 1, last_used_at = now() WHERE id = v_link_id;
  END IF;
  RETURN jsonb_build_object('responseId', v_id, 'editCount', v_edit, 'versionId', v_version,
                            'created', v_ex.id IS NULL, 'eventId', v_event);
END;
$function$;

CREATE OR REPLACE FUNCTION public.brand_form_link_resolve(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_link public.brand_form_links;
  v_subject jsonb;
  v_contact jsonb;
  v_resp public.brand_form_responses;
BEGIN
  v_link := public.brand_form_link_by_token(p_token);
  IF v_link.id IS NULL THEN RETURN jsonb_build_object('outcome', 'invalid'); END IF;
  IF v_link.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'revoked'); END IF;
  -- #4541 R4.4: a Blast link (its recipient's label; no contact kept, so no code).
  IF v_link.kind = 'blast' THEN
    RETURN jsonb_build_object('outcome', 'ok', 'linkId', v_link.id, 'formId', v_link.form_id,
      'eventId', NULL, 'attachmentId', NULL, 'kind', 'blast', 'campaignId', v_link.campaign_id,
      'subject', jsonb_build_object('kind', 'blast'), 'recognized', v_link.expires_at > now(),
      'answered', EXISTS (SELECT 1 FROM public.brand_form_responses r
                           WHERE r.form_id = v_link.form_id AND r.blast_contact_key = v_link.blast_contact_key),
      'identity', public.brand_form_short_name(v_link.recipient_label), 'channels', '[]'::jsonb);
  END IF;
  v_subject := public.brand_form_link_subject(v_link);
  v_contact := public.brand_form_subject_contact(v_subject->>'kind', (v_subject->>'id')::uuid);
  v_resp := public.brand_form_person_response(v_link.form_id, v_subject->>'kind', (v_subject->>'id')::uuid, v_link.event_id);
  RETURN jsonb_build_object('outcome', 'ok', 'linkId', v_link.id, 'formId', v_link.form_id,
    'eventId', v_link.event_id, 'attachmentId', v_link.attachment_id, 'kind', v_link.kind,
    'subject', v_subject, 'recognized', v_link.expires_at > now(), 'answered', v_resp.id IS NOT NULL,
    'identity', public.brand_form_short_name(v_contact->>'name'),
    'channels', to_jsonb(array_remove(ARRAY[CASE WHEN v_contact->>'email' IS NOT NULL THEN 'email' END,
                                            CASE WHEN v_contact->>'phone' IS NOT NULL THEN 'phone' END], NULL)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.brand_form_my_response(p_form_id uuid, p_event_id uuid DEFAULT NULL::uuid, p_token text DEFAULT NULL::text, p_challenge_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_f record;
  v_link record;
  v_subject jsonb;
  v_resp record;
  v_def jsonb;
  v_state text;
  v_identity text;
  v_uid uuid := auth.uid();
  v_event uuid := p_event_id;
BEGIN
  SELECT f.id, f.name, f.status, f.brand_id, f.live_version_id, f.door_full_answers INTO v_f
    FROM public.brand_forms f WHERE f.id = p_form_id AND f.status IN ('live', 'closed');
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT v.definition INTO v_def FROM public.brand_form_versions v WHERE v.id = v_f.live_version_id;

  IF p_token IS NOT NULL THEN
    SELECT l.id, l.form_id, l.revoked_at, l.expires_at, l.event_id, l.kind AS link_kind,
           l.campaign_id, l.blast_contact_key, l.recipient_label,
           public.brand_form_link_subject(l) AS subject
      INTO v_link FROM public.brand_form_link_by_token(p_token) l;
    IF v_link.id IS NULL OR v_link.form_id <> p_form_id THEN
      RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501';
    END IF;
    IF v_link.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'link_revoked' USING ERRCODE = '42501'; END IF;
    -- #4541 R4.4: a Blast link reads its recipient's own answer. A second look
    -- or one after recognition needs a code it cannot get: the page offers
    -- "Answer without confirming" (Unknown).
    IF v_link.link_kind = 'blast' THEN
      SELECT r.id, r.version_id, r.answers, r.edit_count, r.updated_at INTO v_resp
        FROM public.brand_form_responses r
       WHERE r.form_id = p_form_id AND r.blast_contact_key = v_link.blast_contact_key;
      v_identity := public.brand_form_short_name(v_link.recipient_label);
      IF (v_resp.id IS NOT NULL OR v_link.expires_at <= now())
         AND NOT public.brand_form_code_grant_ok(v_link.id, p_challenge_id) THEN
        RETURN jsonb_build_object('state', 'code_required', 'answered', v_resp.id IS NOT NULL,
          'recognized', v_link.expires_at > now(), 'identity', v_identity,
          'codeAvailable', false, 'unknownAllowed', true, 'campaignId', v_link.campaign_id,
          'form', jsonb_build_object('id', v_f.id, 'name', v_f.name, 'status', v_f.status),
          'brand', public.brand_form_brand_header(v_f.brand_id));
      END IF;
      RETURN jsonb_build_object(
        'state', CASE WHEN v_resp.id IS NULL THEN 'unanswered' ELSE 'answered' END,
        'identity', v_identity, 'recognized', true, 'campaignId', v_link.campaign_id,
        'form', jsonb_build_object('id', v_f.id, 'name', v_f.name, 'status', v_f.status,
                  'versionId', v_f.live_version_id, 'definition', v_def, 'doorFullAnswers', false),
        'eventId', NULL, 'brand', public.brand_form_brand_header(v_f.brand_id),
        'response', CASE WHEN v_resp.id IS NULL THEN NULL ELSE jsonb_build_object(
           'id', v_resp.id, 'versionId', v_resp.version_id,
           'definition', (SELECT v.definition FROM public.brand_form_versions v WHERE v.id = v_resp.version_id),
           'isCurrentVersion', v_resp.version_id = v_f.live_version_id,
           'answers', v_resp.answers, 'editCount', v_resp.edit_count, 'updatedAt', v_resp.updated_at) END);
    END IF;
    v_subject := v_link.subject;
    IF v_subject IS NULL THEN RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501'; END IF;
    SELECT r.id, r.version_id, r.answers, r.edit_count, r.updated_at INTO v_resp
      FROM public.brand_form_person_response(
        p_form_id, v_subject->>'kind', (v_subject->>'id')::uuid, v_link.event_id) r;
    v_identity := public.brand_form_short_name(
      public.brand_form_subject_contact(v_subject->>'kind', (v_subject->>'id')::uuid)->>'name');
    v_event := COALESCE(v_link.event_id, v_event);
    IF (v_resp.id IS NOT NULL OR v_link.expires_at <= now())
       AND NOT public.brand_form_code_grant_ok(v_link.id, p_challenge_id) THEN
      RETURN jsonb_build_object('state', 'code_required', 'answered', v_resp.id IS NOT NULL,
        'recognized', v_link.expires_at > now(), 'identity', v_identity,
        'form', jsonb_build_object('id', v_f.id, 'name', v_f.name, 'status', v_f.status),
        'brand', public.brand_form_brand_header(v_f.brand_id));
    END IF;
  ELSIF v_uid IS NOT NULL THEN
    SELECT r.id, r.version_id, r.answers, r.edit_count, r.updated_at INTO v_resp
      FROM public.brand_form_person_response(p_form_id, 'user', v_uid, v_event) r;
    IF v_resp.id IS NULL AND NOT (v_event IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.brand_form_attachments a
          WHERE a.event_id = v_event AND a.form_id = p_form_id AND a.detached_at IS NULL
            AND (public.brand_form_subject_current('user', v_uid, v_event)
              OR EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = v_event AND t.holder_user_id = v_uid AND t.status IN ('valid', 'used'))
              OR (a.mode = 'optional_on_page' AND public.brand_form_event_public(v_event))))) THEN
      RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;

  v_state := CASE WHEN v_resp.id IS NULL THEN 'unanswered' ELSE 'answered' END;
  RETURN jsonb_build_object(
    'state', v_state, 'identity', v_identity, 'recognized', true,
    'form', jsonb_build_object('id', v_f.id, 'name', v_f.name, 'status', v_f.status,
              'versionId', v_f.live_version_id, 'definition', v_def, 'doorFullAnswers', v_f.door_full_answers),
    'eventId', v_event,
    'brand', public.brand_form_brand_header(v_f.brand_id),
    'response', CASE WHEN v_resp.id IS NULL THEN NULL ELSE jsonb_build_object(
       'id', v_resp.id, 'versionId', v_resp.version_id,
       'definition', (SELECT v.definition FROM public.brand_form_versions v WHERE v.id = v_resp.version_id),
       'isCurrentVersion', v_resp.version_id = v_f.live_version_id,
       'answers', v_resp.answers, 'editCount', v_resp.edit_count, 'updatedAt', v_resp.updated_at) END);
END;
$function$;


-- ---------------------------------------------------------------------------
-- 6. Never on a guest record or at the door (R4.6)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brand_form_door_answers(p_actor_id uuid, p_event_id uuid, p_subject jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_kind text := p_subject->>'kind'; v_sid uuid; v_ticket uuid; v_a record;
  v_rid uuid; v_rver uuid; v_rans jsonb;
  v_answered jsonb; v_live jsonb; v_items jsonb;
  v_from text; v_rank integer; v_invited boolean;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  v_rank := public.brand_form_door_authority(p_actor_id, p_event_id);
  IF COALESCE(v_kind, '') NOT IN ('rsvp', 'rsvp_guest', 'order')
     OR COALESCE(p_subject->>'id', '') !~ v_uuid
     OR (p_subject ? 'ticketId' AND jsonb_typeof(p_subject->'ticketId') <> 'null'
         AND (v_kind <> 'order' OR COALESCE(p_subject->>'ticketId', '') !~ v_uuid)) THEN
    RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
  END IF;
  v_sid := (p_subject->>'id')::uuid;
  IF public.brand_form_subject_event(v_kind, v_sid) IS DISTINCT FROM p_event_id
     OR (v_kind = 'rsvp_guest' AND NOT EXISTS (
       SELECT 1 FROM public.event_rsvp_guests g
        WHERE g.id = v_sid AND g.claimed_at IS NOT NULL AND g.matched_user_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
  END IF;
  IF v_kind = 'order' AND (p_subject->>'ticketId') ~ v_uuid THEN
    v_ticket := (p_subject->>'ticketId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.tickets t
                    WHERE t.id = v_ticket AND t.order_id = v_sid AND t.event_id = p_event_id) THEN
      RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF public.brand_forms_switched_off() THEN RETURN NULL; END IF;
  -- R1.4: a guest who is not current has no door line at all.
  IF NOT public.brand_form_subject_current(v_kind, v_sid, p_event_id) THEN RETURN NULL; END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT r.id, r.version_id, r.answers INTO v_rid, v_rver, v_rans
    FROM public.brand_form_find_response(v_a.form_id, v_kind, v_sid) r;
  -- #4541 R4.6 (I-4541-BLAST-REPLY-NEVER-ON-GUEST): a Blast or Unknown reply is never a guest's answer.
  IF v_rid IS NOT NULL AND EXISTS (SELECT 1 FROM public.brand_form_responses x
       WHERE x.id = v_rid AND (x.unknown_owner OR x.blast_contact_key IS NOT NULL)) THEN
    v_rid := NULL;
  END IF;
  IF v_ticket IS NOT NULL AND EXISTS (SELECT 1 FROM public.tickets t
       WHERE t.id = v_ticket AND (t.transferred_at IS NOT NULL OR t.status = 'transferred')) THEN
    v_rid := NULL;
  END IF;
  IF v_rid IS NULL THEN
    IF v_a.form_status = 'live' AND v_a.mode IN ('required_step', 'after_purchase')
       AND NOT public.brand_form_added_by_host(v_kind, v_sid) THEN
      RETURN jsonb_build_object('state', 'not_answered', 'formName', v_a.form_name);
    END IF;
    RETURN NULL;
  END IF;
  SELECT v.definition INTO v_answered FROM public.brand_form_versions v WHERE v.id = v_rver;
  SELECT v.definition INTO v_live FROM public.brand_form_versions v WHERE v.id = v_a.live_version_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'label', public.brand_form_cut(
             COALESCE(NULLIF(btrim(q.value->>'door_label'), ''), q.value->>'label'), 40),
           'value', public.brand_form_cut(
             public.brand_form_answer_text(q.value, v_rans->(q.value->>'id')), 60))
           ORDER BY (q.value->>'position')::integer), '[]'::jsonb)
    INTO v_items FROM jsonb_array_elements(v_answered->'questions') q
   WHERE COALESCE((q.value->>'show_at_door')::boolean, false)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_live->'questions') l
                  WHERE l.value->>'id' = q.value->>'id'
                    AND COALESCE((l.value->>'show_at_door')::boolean, false))
     AND public.brand_form_answer_text(q.value, v_rans->(q.value->>'id')) IS NOT NULL;
  IF jsonb_array_length(v_items) = 0 THEN RETURN NULL; END IF;
  IF v_ticket IS NOT NULL THEN v_from := public.brand_form_door_order_header(v_sid, v_ticket); END IF;
  SELECT f.door_full_answers_invited INTO v_invited FROM public.brand_forms f WHERE f.id = v_a.form_id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'state', 'answered', 'formName', v_a.form_name, 'fromOrderOf', v_from,
    'fullAnswers', public.brand_form_door_full_scope(
                     p_actor_id, p_event_id, v_rank, v_a.door_full_answers, v_invited) IS NOT NULL,
    'items', (SELECT jsonb_agg(x.value) FROM jsonb_array_elements(v_items) WITH ORDINALITY x
               WHERE x.ordinality <= 3)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.brand_form_door_full_answers(p_actor_id uuid, p_event_id uuid, p_subject jsonb, p_via text DEFAULT 'scan'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_kind text := p_subject->>'kind'; v_sid uuid; v_rank integer; v_a record; v_found boolean;
  v_rid uuid; v_rver uuid; v_rans jsonb; v_rat timestamptz;
  v_def jsonb; v_questions jsonb; v_result text;
  v_out jsonb; v_ticket uuid; v_from text; v_scope text; v_invited boolean;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  v_rank := public.brand_form_door_authority(p_actor_id, p_event_id);
  IF COALESCE(v_kind, '') NOT IN ('rsvp', 'rsvp_guest', 'order')
     OR COALESCE(p_subject->>'id', '') !~ v_uuid OR COALESCE(p_via, '') NOT IN ('scan', 'search')
     OR (p_subject ? 'ticketId' AND jsonb_typeof(p_subject->'ticketId') <> 'null'
         AND (v_kind <> 'order' OR COALESCE(p_subject->>'ticketId', '') !~ v_uuid)) THEN
    RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
  END IF;
  v_sid := (p_subject->>'id')::uuid;
  IF public.brand_form_subject_event(v_kind, v_sid) IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
  END IF;
  IF v_kind = 'order' AND (p_subject->>'ticketId') ~ v_uuid THEN
    v_ticket := (p_subject->>'ticketId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.tickets t
                    WHERE t.id = v_ticket AND t.order_id = v_sid AND t.event_id = p_event_id) THEN
      RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT public.brand_form_subject_current(v_kind, v_sid, p_event_id) THEN
    RAISE EXCEPTION 'subject_not_current' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('brand_form_door_reads:' || p_actor_id::text, 0));
  IF (SELECT count(*) FROM public.brand_form_door_reads d
       WHERE d.actor_id = p_actor_id AND d.created_at > now() - interval '10 minutes')
       >= (CASE WHEN v_rank >= public.biz_role_rank('event_manager') THEN 60 ELSE 20 END)
     OR (SELECT count(*) FROM public.brand_form_door_reads d
          WHERE d.actor_id = p_actor_id AND d.subject_id = v_sid AND d.result = 'full'
            AND d.created_at > now() - interval '24 hours') >= 3 THEN
    INSERT INTO public.brand_form_door_reads (
      actor_id, event_id, subject_kind, subject_id, via, result)
    VALUES (p_actor_id, p_event_id, v_kind, v_sid, p_via, 'rate_limited');
    RETURN jsonb_build_object('state', 'rate_limited');
  END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  v_found := FOUND;
  IF NOT v_found OR public.brand_forms_switched_off() THEN
    v_result := 'no_form'; v_out := jsonb_build_object('state', 'no_form');
  ELSE
    SELECT r.id, r.version_id, r.answers, r.updated_at INTO v_rid, v_rver, v_rans, v_rat
      FROM public.brand_form_find_response(v_a.form_id, v_kind, v_sid) r;
  -- #4541 R4.6 (I-4541-BLAST-REPLY-NEVER-ON-GUEST): a Blast or Unknown reply is never a guest's answer.
  IF v_rid IS NOT NULL AND EXISTS (SELECT 1 FROM public.brand_form_responses x
       WHERE x.id = v_rid AND (x.unknown_owner OR x.blast_contact_key IS NOT NULL)) THEN
    v_rid := NULL;
  END IF;
    IF v_ticket IS NOT NULL AND EXISTS (SELECT 1 FROM public.tickets t
         WHERE t.id = v_ticket AND (t.transferred_at IS NOT NULL OR t.status = 'transferred')) THEN
      v_rid := NULL;
    END IF;
    IF v_ticket IS NOT NULL THEN v_from := public.brand_form_door_order_header(v_sid, v_ticket); END IF;
    SELECT f.door_full_answers_invited INTO v_invited FROM public.brand_forms f WHERE f.id = v_a.form_id;
    v_scope := public.brand_form_door_full_scope(p_actor_id, p_event_id, v_rank, v_a.door_full_answers, v_invited);
    IF v_rid IS NULL THEN
      v_result := 'not_answered';
      v_out := jsonb_build_object('state', 'not_answered', 'formName', v_a.form_name,
                 'brand', public.brand_form_brand_header(v_a.brand_id));
    ELSIF v_scope IS NULL THEN
      v_result := 'line_only';
      v_out := jsonb_build_object('state', 'line_only', 'formName', v_a.form_name,
                 'line', public.brand_form_door_answers(p_actor_id, p_event_id, p_subject));
    ELSE
      v_result := 'full';
      SELECT v.definition INTO v_def FROM public.brand_form_versions v WHERE v.id = v_rver;
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', q.value->>'id', 'label', q.value->>'label', 'type', q.value->>'type',
               'value', public.brand_form_answer_text(q.value, v_rans->(q.value->>'id')))
               ORDER BY (q.value->>'position')::integer), '[]'::jsonb)
        INTO v_questions FROM jsonb_array_elements(v_def->'questions') q
       WHERE q.value->>'type' <> 'file_upload';
      v_out := jsonb_strip_nulls(jsonb_build_object(
        'state', 'answered', 'formName', v_a.form_name,
        'brand', public.brand_form_brand_header(v_a.brand_id), 'answeredAt', v_rat,
        'isCurrentVersion', v_rver = v_a.live_version_id, 'fromOrderOf', v_from,
        'questions', v_questions,
        'definition', jsonb_set(v_def, '{questions}', COALESCE((SELECT jsonb_agg(
          q.value ORDER BY (q.value->>'position')::integer)
          FROM jsonb_array_elements(v_def->'questions') q
          WHERE q.value->>'type' <> 'file_upload'), '[]'::jsonb)),
        'answers', COALESCE((SELECT jsonb_object_agg(a.key, a.value)
          FROM jsonb_each(v_rans) a WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_def->'questions') q
             WHERE q.value->>'id' = a.key AND q.value->>'type' <> 'file_upload')), '{}'::jsonb)));
    END IF;
  END IF;
  INSERT INTO public.brand_form_door_reads (
    actor_id, event_id, form_id, subject_kind, subject_id, via, result)
  VALUES (p_actor_id, p_event_id, CASE WHEN v_found THEN v_a.form_id END, v_kind, v_sid, p_via, v_result);
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_brand_form_guest_answers(p_event_id uuid, p_subject jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_brand uuid; v_kind text := p_subject->>'kind'; v_sid uuid; v_a record;
  v_rid uuid; v_rver uuid; v_rans jsonb; v_rat timestamptz; v_def jsonb; v_label text;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF v_brand IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_brand, 'marketing_manager');
  IF jsonb_typeof(p_subject) IS DISTINCT FROM 'object'
     OR COALESCE(v_kind, '') NOT IN ('rsvp', 'rsvp_guest', 'order')
     OR COALESCE(p_subject->>'id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
  END IF;
  v_sid := (p_subject->>'id')::uuid;
  IF public.brand_form_subject_event(v_kind, v_sid) IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'none'); END IF;
  SELECT r.id, r.version_id, r.answers, r.updated_at INTO v_rid, v_rver, v_rans, v_rat
    FROM public.brand_form_find_response(v_a.form_id, v_kind, v_sid) r;
  -- #4541 R4.6 (I-4541-BLAST-REPLY-NEVER-ON-GUEST): a Blast or Unknown reply is never a guest's answer.
  IF v_rid IS NOT NULL AND EXISTS (SELECT 1 FROM public.brand_form_responses x
       WHERE x.id = v_rid AND (x.unknown_owner OR x.blast_contact_key IS NOT NULL)) THEN
    v_rid := NULL;
  END IF;
  IF v_rid IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.brand_form_event_responses(v_a.form_id, p_event_id) x WHERE x.id = v_rid) THEN
    RETURN jsonb_build_object('state', 'not_answered', 'formName', v_a.form_name);
  END IF;
  SELECT v.definition, 'v' || v.version INTO v_def, v_label FROM public.brand_form_versions v WHERE v.id = v_rver;
  RETURN jsonb_build_object(
    'state', 'answered', 'formName', v_a.form_name, 'versionLabel', v_label,
    'answeredAt', v_rat, 'isCurrentVersion', v_rver = v_a.live_version_id,
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'label', q.value->>'label',
               'value', public.brand_form_answer_text(q.value, v_rans->(q.value->>'id')))
               ORDER BY (q.value->>'position')::integer)
          FROM jsonb_array_elements(v_def->'questions') q
         WHERE q.value->>'type' <> 'file_upload'
           AND public.brand_form_answer_text(q.value, v_rans->(q.value->>'id')) IS NOT NULL), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.brand_form_roster_export_answers(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_event uuid;
  v_brand uuid;
  v_form uuid;
  v_multi boolean;
  v_cols jsonb;
  v_rows jsonb;
BEGIN
  SELECT j.scope_id, j.brand_id INTO v_event, v_brand
    FROM public.brand_people_export_jobs j
   WHERE j.id = p_job_id AND j.export_kind = 'offering_guest_roster';
  IF v_event IS NULL THEN RETURN jsonb_build_object('columns', '[]'::jsonb, 'rows', '{}'::jsonb); END IF;
  SELECT a.form_id INTO v_form FROM public.brand_form_active_for_event(v_event) a WHERE a.brand_id = v_brand;
  IF v_form IS NULL THEN RETURN jsonb_build_object('columns', '[]'::jsonb, 'rows', '{}'::jsonb); END IF;
  SELECT count(*) > 1 INTO v_multi FROM public.brand_form_versions v WHERE v.form_id = v_form;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', v.version || ':' || (q.value->>'id'),
           'header', CASE WHEN v_multi THEN (q.value->>'label') || ' (v' || v.version || ')' ELSE q.value->>'label' END)
           ORDER BY v.version, (q.value->>'position')::integer), '[]'::jsonb)
    INTO v_cols
    FROM public.brand_form_versions v
    CROSS JOIN LATERAL jsonb_array_elements(v.definition->'questions') q
   WHERE v.form_id = v_form;
  WITH people AS (
    SELECT l.brand_person_id AS person_id,
           (array_agg(l.source_id ORDER BY l.linked_at) FILTER (WHERE l.source_kind = 'event_rsvp'
              AND public.brand_form_subject_current('rsvp', l.source_id, v_event)))[1] AS rsvp_id,
           (array_agg(l.source_id ORDER BY l.linked_at) FILTER (WHERE l.source_kind = 'order'
              AND public.brand_form_subject_current('order', l.source_id, v_event)))[1] AS order_id
      FROM public.brand_person_source_links l
     WHERE l.brand_id = v_brand AND l.detached_at IS NULL AND l.source_kind IN ('event_rsvp', 'order')
     GROUP BY l.brand_person_id
  ), answered AS (
    SELECT p.person_id,
           CASE WHEN (public.brand_form_find_response(v_form, 'rsvp', p.rsvp_id)).id IS NOT NULL
                THEN public.brand_form_find_response(v_form, 'rsvp', p.rsvp_id)
                ELSE public.brand_form_find_response(v_form, 'order', p.order_id) END AS r
      FROM people p
     WHERE p.rsvp_id IS NOT NULL OR p.order_id IS NOT NULL
  )
  SELECT COALESCE(jsonb_object_agg(a.person_id, (
           SELECT COALESCE(jsonb_object_agg(v.version || ':' || (q.value->>'id'),
                    public.brand_form_answer_text(q.value, (a.r).answers->(q.value->>'id'))), '{}'::jsonb)
             FROM public.brand_form_versions v
             CROSS JOIN LATERAL jsonb_array_elements(v.definition->'questions') q
            WHERE v.id = (a.r).version_id AND (a.r).answers ? (q.value->>'id'))), '{}'::jsonb)
    INTO v_rows
    FROM answered a
   WHERE (a.r).id IS NOT NULL AND (a.r).verified
     -- #4541 R4.6: a Blast or Unknown reply is never a guest's answer.
     AND NOT (a.r).unknown_owner AND (a.r).blast_contact_key IS NULL;
  RETURN jsonb_build_object('formId', v_form, 'columns', v_cols, 'rows', v_rows);
END;
$function$;

CREATE OR REPLACE FUNCTION public.brand_form_event_responses(p_form_id uuid, p_event_id uuid)
 RETURNS SETOF brand_form_responses
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT r.* FROM public.brand_form_responses r
   WHERE r.form_id = p_form_id
     -- #4541 R4.6/R4.8: a reply from a Blast (no page) belongs to All pages only;
     -- a hidden Unknown reply never counts or exports.
     AND r.hidden_at IS NULL
     AND NOT (p_event_id IS NOT NULL AND r.campaign_id IS NOT NULL AND r.event_id IS NULL)
     AND CASE
       WHEN r.rsvp_id IS NOT NULL THEN public.brand_form_subject_current('rsvp', r.rsvp_id,
              COALESCE(p_event_id, public.brand_form_subject_event('rsvp', r.rsvp_id)))
       WHEN r.order_id IS NOT NULL THEN public.brand_form_subject_current('order', r.order_id,
              COALESCE(p_event_id, public.brand_form_subject_event('order', r.order_id)))
       WHEN r.rsvp_guest_id IS NOT NULL THEN public.brand_form_subject_current('rsvp_guest', r.rsvp_guest_id,
              COALESCE(p_event_id, public.brand_form_subject_event('rsvp_guest', r.rsvp_guest_id)))
       WHEN r.user_id IS NOT NULL THEN p_event_id IS NULL OR r.event_id = p_event_id
              OR public.brand_form_subject_current('user', r.user_id, p_event_id)
       ELSE p_event_id IS NULL OR r.event_id = p_event_id
     END;
$function$;


-- ---------------------------------------------------------------------------
-- 7. Responses: owner filter, hidden rows, Unknown (R4.7, R4.8, R4.9)
-- ---------------------------------------------------------------------------
-- The rows the Responses page lists: the page's (or all pages') rows, by owner
-- (all | known | unknown), plus hidden Unknown rows when asked (All pages only).
CREATE FUNCTION public.brand_form_responses_scope(
  p_form_id uuid, p_event_id uuid, p_owner text, p_show_hidden boolean
) RETURNS SETOF public.brand_form_responses
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT r.* FROM public.brand_form_event_responses(p_form_id, p_event_id) r
   WHERE p_owner = 'all' OR (p_owner = 'unknown') = r.unknown_owner
  UNION ALL
  SELECT r.* FROM public.brand_form_responses r
   WHERE p_show_hidden AND p_event_id IS NULL AND p_owner IN ('all', 'unknown')
     AND r.form_id = p_form_id AND r.unknown_owner AND r.hidden_at IS NOT NULL;
$fn$;

-- R4.7: DROP then CREATE (two new trailing arguments). Old Host builds call the
-- first five by name and keep working; an Unknown row carries the name
-- "Unknown" where they read a contact's name (N3).
DROP FUNCTION public.biz_brand_form_responses(uuid, uuid, text, integer, integer);

CREATE FUNCTION public.biz_brand_form_responses(p_form_id uuid, p_event_id uuid DEFAULT NULL::uuid, p_filter text DEFAULT 'all'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_owner text DEFAULT 'all'::text, p_show_hidden boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_f record;
  v_rows jsonb;
  v_counts jsonb;
  v_total integer;
  v_versions jsonb;
  v_not jsonb := '[]'::jsonb;
BEGIN
  SELECT f.id, f.name, f.status, f.brand_id, f.live_version_id, f.door_full_answers INTO v_f
    FROM public.brand_forms f WHERE f.id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_f.brand_id, 'marketing_manager');
  IF p_event_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.brand_id = v_f.brand_id) THEN
    RAISE EXCEPTION 'brand_form_forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_filter, 'all') NOT IN ('all', 'earlier_version') THEN
    RAISE EXCEPTION 'filter_invalid' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_owner, 'all') NOT IN ('all', 'known', 'unknown') THEN
    RAISE EXCEPTION 'owner_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.brand_form_responses_scope(p_form_id, p_event_id, COALESCE(p_owner, 'all'), COALESCE(p_show_hidden, false)) r
   WHERE COALESCE(p_filter, 'all') = 'all' OR r.version_id IS DISTINCT FROM v_f.live_version_id;

  SELECT COALESCE(jsonb_object_agg(q.qid, q.opts), '{}'::jsonb) INTO v_counts
    FROM (
      SELECT c.qid, jsonb_object_agg(c.oid, c.n) AS opts
        FROM (
          SELECT a.key AS qid, x.oid, count(*) AS n
            FROM (SELECT x.* FROM public.brand_form_responses_scope(p_form_id, p_event_id, COALESCE(p_owner, 'all'), false) x WHERE COALESCE(p_filter, 'all') = 'all' OR x.version_id IS DISTINCT FROM v_f.live_version_id) r
            CROSS JOIN LATERAL jsonb_each(r.answers) a
            CROSS JOIN LATERAL (
              SELECT a.value #>> '{}' AS oid WHERE jsonb_typeof(a.value) = 'string'
              UNION ALL
              SELECT e.value #>> '{}' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.value) = 'array' THEN a.value ELSE '[]'::jsonb END) e
            ) x
            JOIN public.brand_form_versions v ON v.id = r.version_id
           WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v.definition->'questions') q
                          WHERE q.value->>'id' = a.key AND q.value->>'type' IN ('single_choice', 'multi_choice'))
           GROUP BY a.key, x.oid
        ) c GROUP BY c.qid
    ) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'responseId', r.id, 'versionId', r.version_id, 'version', v.version,
           'earlierVersion', r.version_id IS DISTINCT FROM v_f.live_version_id,
           'answers', r.answers, 'source', r.source, 'verified', r.verified, 'viaLink', r.via_link,
           'editCount', r.edit_count, 'submittedAt', r.submitted_at, 'updatedAt', r.updated_at,
           'subject', CASE
              WHEN r.rsvp_id IS NOT NULL THEN jsonb_build_object('kind', 'rsvp', 'id', r.rsvp_id,
                     'name', (SELECT x.guest_name FROM public.event_rsvps x WHERE x.id = r.rsvp_id))
              WHEN r.order_id IS NOT NULL THEN jsonb_build_object('kind', 'order', 'id', r.order_id,
                     'name', (SELECT o.buyer_name FROM public.orders o WHERE o.id = r.order_id))
              WHEN r.user_id IS NOT NULL THEN jsonb_build_object('kind', 'user', 'id', r.user_id)
              WHEN r.rsvp_guest_id IS NOT NULL THEN jsonb_build_object('kind', 'rsvp_guest', 'id', r.rsvp_guest_id)
              -- #4541 R4.7 (N3): old Host builds draw a contact row's name.
              WHEN r.unknown_owner THEN jsonb_build_object('kind', 'contact', 'name', 'Unknown')
              WHEN r.blast_contact_key IS NOT NULL THEN jsonb_build_object('kind', 'contact',
                     'name', COALESCE(r.owner_label, 'Blast recipient'))
              ELSE jsonb_build_object('kind', 'contact', 'name', r.contact_name) END,
           'ownerKind', CASE WHEN r.unknown_owner THEN 'unknown' WHEN r.blast_contact_key IS NOT NULL THEN 'blast'
                             WHEN r.user_id IS NOT NULL THEN 'app_user' ELSE 'guest' END,
           'name', CASE WHEN r.unknown_owner THEN 'Unknown' WHEN r.blast_contact_key IS NOT NULL THEN r.owner_label END,
           'campaignId', r.campaign_id,
           'campaignName', (SELECT c.name FROM public.marketing_campaigns c WHERE c.id = r.campaign_id),
           'hidden', r.hidden_at IS NOT NULL,
           'holder', CASE WHEN p_event_id IS NOT NULL AND r.user_id IS NOT NULL THEN jsonb_build_object(
              'rsvpId', (SELECT x.id FROM public.event_rsvps x WHERE x.event_id = p_event_id AND x.user_id = r.user_id
                          ORDER BY x.created_at DESC LIMIT 1),
              'orderIds', COALESCE((SELECT jsonb_agg(o.id ORDER BY o.created_at) FROM public.orders o
                          WHERE o.event_id = p_event_id AND o.buyer_user_id = r.user_id
                            AND o.payment_status IN ('paid', 'partial_refund')), '[]'::jsonb)) END
         ) ORDER BY r.updated_at DESC, r.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT * FROM (SELECT x.* FROM public.brand_form_responses_scope(p_form_id, p_event_id, COALESCE(p_owner, 'all'), COALESCE(p_show_hidden, false)) x WHERE COALESCE(p_filter, 'all') = 'all' OR x.version_id IS DISTINCT FROM v_f.live_version_id) s ORDER BY updated_at DESC, id
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200) OFFSET GREATEST(COALESCE(p_offset, 0), 0)) r
    JOIN public.brand_form_versions v ON v.id = r.version_id;

  IF p_event_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(n.item ORDER BY n.at), '[]'::jsonb) INTO v_not
      FROM (
        SELECT jsonb_build_object('kind', 'rsvp', 'id', x.id, 'name', x.guest_name, 'addedByHost', false) AS item, x.created_at AS at
          FROM public.event_rsvps x
         WHERE x.event_id = p_event_id AND public.brand_form_subject_current('rsvp', x.id, p_event_id)
           AND (public.brand_form_find_response(p_form_id, 'rsvp', x.id)).id IS NULL
        UNION ALL
        SELECT jsonb_build_object('kind', 'rsvp_guest', 'id', g.id,
                 'name', COALESCE(NULLIF(btrim(g.name), ''),
                   NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.display_name),
                 'addedByHost', false), g.claimed_at
          FROM public.event_rsvp_guests g
          JOIN public.event_rsvps x ON x.id = g.rsvp_id
          LEFT JOIN public.profiles pr ON pr.id = g.matched_user_id
         WHERE x.event_id = p_event_id AND public.brand_form_subject_current('rsvp_guest', g.id, p_event_id)
           AND (public.brand_form_find_response(p_form_id, 'rsvp_guest', g.id)).id IS NULL
        UNION ALL
        SELECT jsonb_build_object('kind', 'order', 'id', o.id, 'name', o.buyer_name,
                 'addedByHost', public.brand_form_added_by_host('order', o.id)), o.created_at
          FROM public.orders o
         WHERE o.event_id = p_event_id AND public.brand_form_subject_current('order', o.id, p_event_id)
           AND (public.brand_form_find_response(p_form_id, 'order', o.id)).id IS NULL
      ) n;
  END IF;

  SELECT COALESCE(jsonb_object_agg(v.id, jsonb_build_object('version', v.version, 'definition', v.definition)), '{}'::jsonb)
    INTO v_versions FROM public.brand_form_versions v WHERE v.form_id = p_form_id;

  RETURN jsonb_build_object(
    'form', jsonb_build_object('id', v_f.id, 'name', v_f.name, 'status', v_f.status,
              'liveVersionId', v_f.live_version_id, 'doorFullAnswers', v_f.door_full_answers),
    'mode', (SELECT a.mode FROM public.brand_form_attachments a
              WHERE a.form_id = p_form_id AND a.event_id = p_event_id AND a.detached_at IS NULL),
    'versions', v_versions, 'total', v_total, 'answeredCount', v_total,
    'counts', v_counts, 'rows', v_rows, 'notAnswered', v_not,
    'owner', COALESCE(p_owner, 'all'),
    'hiddenCount', CASE WHEN p_event_id IS NULL THEN (SELECT count(*)::integer FROM public.brand_form_responses h
                     WHERE h.form_id = p_form_id AND h.unknown_owner AND h.hidden_at IS NOT NULL) ELSE 0 END);
END;
$function$;

-- R4.7: the export gains the owner name and the campaign; hidden rows never export.
CREATE OR REPLACE FUNCTION public.biz_brand_form_responses_export(p_form_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_f record;
  v_cols jsonb;
  v_rows jsonb;
BEGIN
  SELECT f.id, f.brand_id INTO v_f FROM public.brand_forms f WHERE f.id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_f.brand_id, 'event_manager');
  -- #4541 R4.7: no page means All pages, Blast replies included.
  IF p_event_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.brand_id = v_f.brand_id AND e.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'brand_form_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', v.version || ':' || (q.value->>'id'),
           'versionId', v.id, 'version', v.version, 'questionId', q.value->>'id',
           'label', q.value->>'label', 'type', q.value->>'type')
           ORDER BY v.version, (q.value->>'position')::integer), '[]'::jsonb)
    INTO v_cols
    FROM public.brand_form_versions v
    CROSS JOIN LATERAL jsonb_array_elements(v.definition->'questions') q
   WHERE v.form_id = p_form_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'responseId', r.id, 'rsvpId', r.rsvp_id, 'orderId', r.order_id, 'userId', r.user_id,
           'rsvpGuestId', r.rsvp_guest_id, 'version', v.version, 'submittedAt', r.submitted_at,
           'name', CASE WHEN r.unknown_owner THEN 'Unknown' WHEN r.blast_contact_key IS NOT NULL THEN r.owner_label END,
           'ownerKind', CASE WHEN r.unknown_owner THEN 'unknown' WHEN r.blast_contact_key IS NOT NULL THEN 'blast'
                             WHEN r.user_id IS NOT NULL THEN 'app_user' ELSE 'guest' END,
           'campaign', (SELECT c.name FROM public.marketing_campaigns c WHERE c.id = r.campaign_id),
           'updatedAt', r.updated_at, 'verified', r.verified,
           'values', (SELECT COALESCE(jsonb_object_agg(v.version || ':' || (q.value->>'id'),
                        public.brand_form_answer_text(q.value, r.answers->(q.value->>'id'))), '{}'::jsonb)
                        FROM jsonb_array_elements(v.definition->'questions') q
                       WHERE r.answers ? (q.value->>'id'))
         ) ORDER BY r.submitted_at, r.id), '[]'::jsonb)
    INTO v_rows
    FROM public.brand_form_event_responses(p_form_id, p_event_id) r
    JOIN public.brand_form_versions v ON v.id = r.version_id;
  RETURN jsonb_build_object('formId', p_form_id, 'eventId', p_event_id, 'columns', v_cols, 'rows', v_rows);
END;
$function$;


-- R4.8: hide an Unknown reply, or undo it (marketing_manager+ on the form's brand).
CREATE FUNCTION public.biz_brand_form_response_hide(p_response_id uuid, p_hidden boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_r record;
BEGIN
  SELECT r.id, r.unknown_owner, f.brand_id INTO v_r
    FROM public.brand_form_responses r JOIN public.brand_forms f ON f.id = r.form_id
   WHERE r.id = p_response_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'response_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_r.brand_id, 'marketing_manager');
  IF NOT v_r.unknown_owner THEN RAISE EXCEPTION 'not_unknown' USING ERRCODE = '22023'; END IF;
  IF p_hidden IS NULL THEN RAISE EXCEPTION 'hidden_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.brand_form_responses
     SET hidden_at = CASE WHEN p_hidden THEN now() END,
         hidden_by = CASE WHEN p_hidden THEN auth.uid() END
   WHERE id = p_response_id;
  RETURN jsonb_build_object('responseId', p_response_id, 'hidden', p_hidden);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.biz_brand_form_counts(p_brand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_pages jsonb;
  v_forms jsonb;
BEGIN
  PERFORM public.brand_form_require_rank(p_brand_id, 'marketing_manager');
  WITH pages AS (
    SELECT a.event_id, a.form_id, f.status AS form_status,
           (SELECT count(*) FROM public.brand_form_event_responses(a.form_id, a.event_id) r WHERE r.verified)::integer AS answered,
           CASE WHEN f.status = 'live' THEN public.brand_form_unanswered_count(a.form_id, a.event_id) ELSE 0 END AS to_answer,
           CASE WHEN f.status = 'live' THEN public.brand_form_not_asked_count(a.form_id, a.event_id) END AS not_asked
      FROM public.brand_form_attachments a
      JOIN public.brand_forms f ON f.id = a.form_id
      JOIN public.events e ON e.id = a.event_id AND e.deleted_at IS NULL
     WHERE a.brand_id = p_brand_id AND a.detached_at IS NULL AND f.brand_id = p_brand_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('eventId', p.event_id, 'formId', p.form_id,
           'formStatus', p.form_status, 'answered', p.answered, 'toAnswer', p.to_answer)
           || CASE WHEN p.not_asked IS NULL THEN '{}'::jsonb
                   ELSE jsonb_build_object('notAsked', p.not_asked) END
           ORDER BY p.event_id), '[]'::jsonb)
    INTO v_pages FROM pages p;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('formId', f.id,
           'answered', (SELECT count(*) FROM public.brand_form_event_responses(f.id, NULL) r WHERE r.verified)::integer,
           'toAnswer', COALESCE((SELECT sum((pg->>'toAnswer')::integer) FROM jsonb_array_elements(v_pages) pg
                                  WHERE (pg->>'formId')::uuid = f.id), 0)::integer,
           'pages', (SELECT count(*) FROM jsonb_array_elements(v_pages) pg WHERE (pg->>'formId')::uuid = f.id)::integer,
           -- #4541 R4.9: replies from Blasts (no page), hidden ones left out.
           'blastReplies', jsonb_build_object(
             'known', (SELECT count(*) FROM public.brand_form_responses r WHERE r.form_id = f.id
                        AND r.campaign_id IS NOT NULL AND r.event_id IS NULL AND NOT r.unknown_owner)::integer,
             'unknown', (SELECT count(*) FROM public.brand_form_responses r WHERE r.form_id = f.id
                          AND r.unknown_owner AND r.hidden_at IS NULL)::integer))
           ORDER BY f.id), '[]'::jsonb)
    INTO v_forms
    FROM public.brand_forms f WHERE f.brand_id = p_brand_id AND f.status <> 'archived';
  RETURN jsonb_build_object('forms', v_forms, 'pages', v_pages);
END;
$function$;

-- R7.1: the Admin read gains the M-B numbers (counts only, never answers or contacts).
CREATE OR REPLACE FUNCTION public.admin_brand_forms_support(p_brand_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT (public.is_admin_user() OR public.is_support_staff(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand_id) THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'forms', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'id', f.id, 'name', f.name, 'status', f.status,
               'liveVersion', (SELECT v.version FROM public.brand_form_versions v WHERE v.id = f.live_version_id),
               'doorFullAnswers', f.door_full_answers,
               'doorFullAnswersInvited', f.door_full_answers_invited,
               'openReplyLimitPerDay', f.open_reply_limit_per_day,
               'blastKnown', (SELECT count(*) FROM public.brand_form_responses r WHERE r.form_id = f.id
                               AND r.campaign_id IS NOT NULL AND r.event_id IS NULL AND NOT r.unknown_owner)::integer,
               'blastUnknown', (SELECT count(*) FROM public.brand_form_responses r WHERE r.form_id = f.id
                                 AND r.unknown_owner AND r.hidden_at IS NULL)::integer,
               'hidden', (SELECT count(*) FROM public.brand_form_responses r WHERE r.form_id = f.id
                           AND r.hidden_at IS NOT NULL)::integer) ORDER BY f.updated_at DESC, f.id)
             FROM public.brand_forms f WHERE f.brand_id = p_brand_id), '[]'::jsonb),
    'pages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'eventId', a.event_id, 'eventTitle', e.title, 'formId', a.form_id, 'mode', a.mode,
               'autoRemind', a.auto_remind,
               'answered', (SELECT count(*) FROM public.brand_form_event_responses(a.form_id, a.event_id) r
                             WHERE r.verified)::integer,
               'toAnswer', CASE WHEN f.status = 'live'
                                THEN public.brand_form_unanswered_count(a.form_id, a.event_id) ELSE 0 END,
               'notAsked', CASE WHEN f.status = 'live'
                                THEN public.brand_form_not_asked_count(a.form_id, a.event_id) ELSE 0 END)
               ORDER BY e.title, a.event_id)
             FROM public.brand_form_attachments a
             JOIN public.brand_forms f ON f.id = a.form_id
             JOIN public.events e ON e.id = a.event_id AND e.deleted_at IS NULL
            WHERE a.brand_id = p_brand_id AND a.detached_at IS NULL
              AND (p_event_id IS NULL OR a.event_id = p_event_id)), '[]'::jsonb),
    'requestSends30d', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'status', x.status, 'reason', x.safe_reason, 'count', x.n) ORDER BY x.status, x.safe_reason)
             FROM (SELECT s.status, s.safe_reason, count(*)::integer AS n
                     FROM public.brand_form_request_sends s
                    WHERE s.brand_id = p_brand_id AND s.created_at > now() - interval '30 days'
                      AND (p_event_id IS NULL OR s.event_id = p_event_id)
                    GROUP BY s.status, s.safe_reason) x), '[]'::jsonb),
    'stuckCheckoutAnswers', (SELECT jsonb_build_object('count', count(*)::integer, 'oldest', min(c.created_at))
             FROM public.brand_form_checkout_answers c
             JOIN public.ticket_checkout_sessions t ON t.id = c.checkout_session_id
             JOIN public.brand_forms f ON f.id = c.form_id
            WHERE f.brand_id = p_brand_id AND t.order_id IS NOT NULL
              AND (c.retry_count >= 5 OR c.created_at < now() - interval '30 minutes')),
    'doorReads7d', (SELECT count(*)::integer FROM public.brand_form_door_reads d
                     JOIN public.events e ON e.id = d.event_id
                    WHERE e.brand_id = p_brand_id AND d.created_at > now() - interval '7 days'
                      AND (p_event_id IS NULL OR d.event_id = p_event_id)),
    'switches', jsonb_build_object(
      'BRAND_FORMS_KILL_SWITCH', public.brand_forms_switched_off(),
      'BRAND_FORMS_PUSH', (SELECT ff.is_enabled FROM public.feature_flags ff WHERE ff.flag_key = 'BRAND_FORMS_PUSH'),
      'BRAND_FORMS_PUSH_EMAIL_ALONGSIDE',
        (SELECT ff.is_enabled FROM public.feature_flags ff WHERE ff.flag_key = 'BRAND_FORMS_PUSH_EMAIL_ALONGSIDE')),
    -- R3.4 (b): of the app users seen in 14 days (a push token refreshed), the share
    -- whose app reported it opens the form in that window. Null with nobody seen.
    'formReadyAppShare14d', (SELECT CASE WHEN count(*) = 0 THEN NULL
                               ELSE round(100.0 * count(*) FILTER (WHERE c.user_id IS NOT NULL) / count(*))::integer END
                              FROM (SELECT DISTINCT t.user_id FROM public.user_push_tokens t
                                     WHERE t.updated_at > now() - interval '14 days') a
                              LEFT JOIN public.brand_form_push_capable c
                                ON c.user_id = a.user_id AND c.last_seen_at > now() - interval '14 days'));
END;
$function$;


-- R7.1: Admin sets a form's daily limit of Unknown replies (0..5000).
CREATE FUNCTION public.admin_brand_form_set_open_reply_limit(p_form_id uuid, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT (public.is_admin_user() OR public.is_support_staff(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 0 AND 5000 THEN
    RAISE EXCEPTION 'limit_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.brand_forms SET open_reply_limit_per_day = p_limit, updated_at = now() WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('formId', p_form_id, 'openReplyLimitPerDay', p_limit);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 8. Wave 6 grants (nothing new for anon)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.brand_form_blast_contact_key(uuid, text),
  public.brand_form_blast_campaign_ok(uuid, uuid),
  public.brand_form_blast_check(uuid),
  public.brand_form_blast_hold_if_closed(uuid),
  public.brand_form_link_issue_blast(uuid, uuid, text, text),
  public.brand_form_blast_form(uuid, uuid),
  public.brand_form_submit_blast(jsonb, uuid, uuid),
  public.brand_form_responses_scope(uuid, uuid, text, boolean),
  public.biz_brand_form_responses(uuid, uuid, text, integer, integer, text, boolean),
  public.biz_brand_form_response_hide(uuid, boolean),
  public.admin_brand_form_set_open_reply_limit(uuid, integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.biz_brand_form_responses(uuid, uuid, text, integer, integer, text, boolean),
  public.biz_brand_form_response_hide(uuid, boolean),
  public.admin_brand_form_set_open_reply_limit(uuid, integer)
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.brand_form_blast_contact_key(uuid, text),
  public.brand_form_blast_campaign_ok(uuid, uuid),
  public.brand_form_blast_check(uuid),
  public.brand_form_blast_hold_if_closed(uuid),
  public.brand_form_link_issue_blast(uuid, uuid, text, text),
  public.brand_form_blast_form(uuid, uuid),
  public.brand_form_submit_blast(jsonb, uuid, uuid),
  public.brand_form_responses_scope(uuid, uuid, text, boolean)
TO service_role;

COMMENT ON FUNCTION public.brand_form_submit_blast(jsonb, uuid, uuid) IS '#4541 R4.4/R4.5: Blast replies only, called by brand_form_submit_core. A personal Blast link is its recipient (blast_contact_key, a hash); a signed-in person is themselves; anyone else is Unknown (a new row each time, the per-form open-reply limit). Typed answers never change who a reply belongs to. I-4541-BLAST-REPLY-NEVER-ON-GUEST.';

-- ---------------------------------------------------------------------------
-- Grants (nothing new for anon)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.brand_form_push_settings(),
  public.brand_form_report_capability(text, text, text, integer),
  public.brand_form_push_eligible(uuid),
  public.brand_form_request_texts_this_month(uuid),
  public.brand_form_sms_month_state(uuid)
FROM PUBLIC, anon, authenticated;

-- The Explorer app's capability report (checks auth.uid() inside).
GRANT EXECUTE ON FUNCTION public.brand_form_report_capability(text, text, text, integer)
TO authenticated, service_role;

-- Service role only.
GRANT EXECUTE ON FUNCTION
  public.brand_form_push_settings(),
  public.brand_form_push_eligible(uuid),
  public.brand_form_request_texts_this_month(uuid),
  public.brand_form_sms_month_state(uuid)
TO service_role;

COMMENT ON FUNCTION public.brand_form_request_texts_this_month(uuid) IS '#4541 R5.1: form-request texts this UTC calendar month (one per person; a request that went by push is not a text). Counted inside biz_brand_blast_usage_v1 and biz_assert_brand_blast_allowance_v1: one text budget per brand.';
COMMENT ON FUNCTION public.brand_form_request_enqueue(uuid, uuid, uuid, text, text, jsonb, text[]) IS '#4514/#4541: queue a form request. Takes blast_cap:<brand>:sms first, then brand_form_request:<brand>. Over the monthly text allowance or the 300-a-day cap, texts are off for the whole send (textsOff); never a refused send.';

-- R4.7: biz_brand_form_responses changed signature; live Host clients resolve it now.
NOTIFY pgrst, 'reload schema';

COMMIT;
