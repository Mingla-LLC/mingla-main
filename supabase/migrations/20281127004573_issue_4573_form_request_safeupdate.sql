-- #4573: form request sends and the automatic reminder run under pg-safeupdate.
--
-- Hosted PostgREST sessions (the authenticator role) preload pg-safeupdate,
-- which refuses a DELETE or UPDATE with no WHERE clause (SQLSTATE 21000). The
-- #4541 bodies of brand_form_request_enqueue and brand_form_auto_reminders_due
-- clear their scratch temp tables with bare statements, so every send failed
-- before it queued anything (409 form_request_unavailable).
--
-- Both functions are copied verbatim from
-- 20281122014541_issue_4541_forms_blast_push.sql; the only change is WHERE true
-- on each bare DELETE / UPDATE. CREATE OR REPLACE keeps the existing grants
-- and COMMENT ON FUNCTION.

-- Drift guard: each body this file replaces must be the one #4541 shipped (the md5 of prosrc, equal to
-- production's at the time of writing). A body that moved since would be silently overwritten otherwise.
DO $drift_guard$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.brand_form_request_enqueue(uuid,uuid,uuid,text,text,jsonb,text[])', 'c8cb796af4c2220cbaaf915572d08fe2'),
      ('public.brand_form_auto_reminders_due()', '1c38414c4caa2ccda748f895da2952d5')
    ) AS v(sig, expected_md5)
  LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.sig::regprocedure)
       IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #4573 drift: % no longer matches its #4541 repository definition', r.sig;
    END IF;
  END LOOP;
END;
$drift_guard$;

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
  -- WHERE true: hosted PostgREST sessions preload pg-safeupdate (21000); see #4238, #4573.
  DELETE FROM pg_temp.brand_form_enqueue_rows WHERE true;
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
    -- WHERE true: hosted PostgREST sessions preload pg-safeupdate (21000); see #4238, #4573.
    UPDATE pg_temp.brand_form_enqueue_rows SET route = array_remove(route, 'sms') WHERE true;
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
  -- WHERE true: hosted PostgREST sessions preload pg-safeupdate (21000); see #4238, #4573.
  DELETE FROM pg_temp.brand_form_enqueue_rows WHERE true;
  RETURN jsonb_build_object('queued', v_queued, 'unreachable', v_unreachable,
    'throttled', v_throttled, 'answered', v_answered, 'textsQueued', v_texts,
    'waitingForMorning', v_waiting, 'skippedNoTexts', v_skipped,
    'textsOff', CASE WHEN v_off IS NULL THEN NULL ELSE jsonb_build_object(
      'reason', v_off, 'needed', v_needed,
      'remaining', CASE WHEN v_off = 'monthly_allowance' THEN v_remaining ELSE v_today_left END) END);
END;
$fn$;

-- The claim. R3.2: push is tried first only for a person whose app can open the

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
      -- WHERE true: hosted PostgREST sessions preload pg-safeupdate (21000); see #4238, #4573.
      DELETE FROM pg_temp.brand_form_auto_due WHERE true;
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
      -- WHERE true: hosted PostgREST sessions preload pg-safeupdate (21000); see #4238, #4573.
      DELETE FROM pg_temp.brand_form_auto_due WHERE true;
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
