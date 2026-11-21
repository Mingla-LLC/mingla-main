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
--   (wave 6 sections follow below)
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
      ('public.biz_assert_brand_blast_allowance_v1(uuid,text,integer)', '835b6f945a76b67c2c24594733fdb365')
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

-- (wave 6: Blast "+ Form" sections go here)

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

COMMIT;
