-- #4640 — paid Host leads move from a short first-party form to the right
-- first-party scheduler without retyping, then receive Mingla reminders while
-- Kunle receives ordinary Work cards for the two confirmation calls.
--
-- MINGLA-INVARIANT: I-4640-HANDOFF-HASHED | issue #4640 | a form-to-scheduler
-- bearer is stored only as SHA-256, expires within two hours and is resolved
-- only by service-role RPCs (issue_4640_host_demo_conversion pg17 test).
-- MINGLA-INVARIANT: I-4640-BOOKING-ACTIONS-ONCE | issue #4640 | each reminder
-- and confirmation action is unique by booking and kind; Work actions create
-- ordinary ops_work_cards linked to the booking (same test).

BEGIN;
SET LOCAL lock_timeout = '10s';

-- One registry owns scheduler identity and availability. Existing public URLs
-- remain aliases for these stable keys; adding a profile needs data, not a new
-- form-builder release.
CREATE TABLE public.booking_scheduler_profiles (
  key              text PRIMARY KEY CHECK (key ~ '^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$'),
  name             text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 2 AND 80),
  audience         text NOT NULL CHECK (audience IN ('host','creator','local')),
  calendar_id      text NOT NULL CHECK (calendar_id = btrim(calendar_id) AND char_length(calendar_id) BETWEEN 1 AND 300),
  time_zone        text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 64),
  notify_to        text NOT NULL CHECK (notify_to = lower(btrim(notify_to)) AND notify_to ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  duration_minutes smallint NOT NULL CHECK (duration_minutes BETWEEN 10 AND 180),
  availability     jsonb NOT NULL CHECK (
    jsonb_typeof(availability) = 'object'
    AND jsonb_typeof(availability->'weekdays') = 'array'
    AND jsonb_array_length(availability->'weekdays') BETWEEN 1 AND 7
    AND (availability->>'start_minute')::integer BETWEEN 0 AND 1439
    AND (availability->>'end_minute')::integer BETWEEN 1 AND 1440
    AND (availability->>'start_minute')::integer < (availability->>'end_minute')::integer
    AND (availability->>'min_notice_minutes')::integer BETWEEN 0 AND 10080
    AND (availability->>'lookahead_days')::integer BETWEEN 1 AND 180
    AND (availability->>'max_open_days')::integer BETWEEN 1 AND 120),
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_scheduler_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_scheduler_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.booking_scheduler_profiles TO service_role;

INSERT INTO public.booking_scheduler_profiles
  (key, name, audience, calendar_id, time_zone, notify_to, duration_minutes, availability)
VALUES
  ('host-demo', 'Host demo', 'host', 'environment-default', 'America/New_York', 'seth@usemingla.com', 20,
   '{"weekdays":[1,2,3,4,5],"start_minute":300,"end_minute":1200,"min_notice_minutes":720,"lookahead_days":45,"max_open_days":31}'),
  ('creator-call', 'Creators call', 'creator', 'environment-default', 'America/New_York', 'seth@usemingla.com', 20,
   '{"weekdays":[1,2,3,4,5],"start_minute":300,"end_minute":1200,"min_notice_minutes":720,"lookahead_days":45,"max_open_days":31}'),
  ('local-call', 'Locals call', 'local', 'environment-default', 'America/New_York', 'seth@usemingla.com', 20,
   '{"weekdays":[1,2,3,4,5],"start_minute":300,"end_minute":1200,"min_notice_minutes":720,"lookahead_days":45,"max_open_days":31}')
ON CONFLICT (key) DO NOTHING;

-- Calendar change sync used to have one global cursor. Keep its existing
-- summary row for operations/backward compatibility, but give every distinct
-- registry calendar an independent lease and Google sync token.
CREATE TABLE public.booking_calendar_sync_profiles (
  calendar_id       text PRIMARY KEY CHECK (char_length(calendar_id) BETWEEN 1 AND 300),
  sync_token        text CHECK (sync_token IS NULL OR char_length(sync_token) <= 2000),
  page_token        text CHECK (page_token IS NULL OR char_length(page_token) <= 2000),
  lease_until       timestamptz,
  last_run_at       timestamptz,
  last_success_at   timestamptz,
  last_full_sync_at timestamptz,
  last_error        text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  last_result       jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.booking_calendar_sync_profiles
  (calendar_id, sync_token, page_token, lease_until, last_run_at, last_success_at,
   last_full_sync_at, last_error, last_result, updated_at)
SELECT calendar_id, sync_token, page_token, lease_until, last_run_at, last_success_at,
       last_full_sync_at, last_error, last_result, updated_at
  FROM public.book_call_calendar_sync
 WHERE calendar_id IS NOT NULL
ON CONFLICT (calendar_id) DO NOTHING;
ALTER TABLE public.booking_calendar_sync_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_calendar_sync_profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.booking_calendar_sync_profiles TO service_role;

CREATE OR REPLACE FUNCTION public.book_call_calendar_sync_begin(
  p_calendar_id text,
  p_lease_seconds integer DEFAULT 240
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.booking_calendar_sync_profiles%ROWTYPE;
BEGIN
  IF p_calendar_id IS NULL OR length(btrim(p_calendar_id)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'invalid_calendar';
  END IF;
  INSERT INTO public.booking_calendar_sync_profiles (calendar_id)
  VALUES (btrim(p_calendar_id)) ON CONFLICT (calendar_id) DO NOTHING;
  SELECT * INTO v_row FROM public.booking_calendar_sync_profiles
   WHERE calendar_id=btrim(p_calendar_id) FOR UPDATE;
  IF v_row.lease_until IS NOT NULL AND v_row.lease_until > now() THEN
    RETURN jsonb_build_object('busy', true);
  END IF;
  UPDATE public.booking_calendar_sync_profiles
     SET lease_until=now()+make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds,240),30),600)),
         last_run_at=now(), updated_at=now()
   WHERE calendar_id=v_row.calendar_id;
  -- The old singleton remains the most recently started calendar for existing
  -- operational readers; cursor authority is the per-calendar row above.
  INSERT INTO public.book_call_calendar_sync (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  UPDATE public.book_call_calendar_sync
     SET calendar_id=v_row.calendar_id, sync_token=v_row.sync_token, page_token=v_row.page_token,
         lease_until=now()+make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds,240),30),600)),
         last_run_at=now(), updated_at=now()
   WHERE id;
  RETURN jsonb_build_object('busy',false,'sync_token',v_row.sync_token,'page_token',v_row.page_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.book_call_calendar_sync_finish(
  p_calendar_id text,
  p_sync_token text,
  p_page_token text,
  p_full_sync boolean,
  p_error text,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.booking_calendar_sync_profiles
     SET sync_token=NULLIF(left(p_sync_token,2000),''),
         page_token=NULLIF(left(p_page_token,2000),''),
         lease_until=NULL,
         last_error=left(NULLIF(btrim(p_error),''),300),
         last_success_at=CASE WHEN NULLIF(btrim(p_error),'') IS NULL THEN now() ELSE last_success_at END,
         last_full_sync_at=CASE WHEN NULLIF(btrim(p_error),'') IS NULL AND COALESCE(p_full_sync,false) THEN now() ELSE last_full_sync_at END,
         last_result=CASE WHEN jsonb_typeof(p_result)='object' THEN p_result ELSE NULL END,
         updated_at=now()
   WHERE calendar_id=btrim(p_calendar_id);
  UPDATE public.book_call_calendar_sync
     SET sync_token=NULLIF(left(p_sync_token,2000),''), page_token=NULLIF(left(p_page_token,2000),''),
         lease_until=NULL, last_error=left(NULLIF(btrim(p_error),''),300),
         last_success_at=CASE WHEN NULLIF(btrim(p_error),'') IS NULL THEN now() ELSE last_success_at END,
         last_full_sync_at=CASE WHEN NULLIF(btrim(p_error),'') IS NULL AND COALESCE(p_full_sync,false) THEN now() ELSE last_full_sync_at END,
         last_result=CASE WHEN jsonb_typeof(p_result)='object' THEN p_result ELSE NULL END,
         updated_at=now()
   WHERE id AND calendar_id IS NOT DISTINCT FROM btrim(p_calendar_id);
END;
$$;
COMMENT ON TABLE public.booking_calendar_sync_profiles IS
  'Issue #4640: independent Google change-sync cursor and lease for each distinct enabled scheduler calendar; service role reads, security-definer RPCs write.';

CREATE FUNCTION public.admin_scheduler_profiles() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN public.forms_can_view() THEN COALESCE(jsonb_agg(jsonb_build_object(
    'key', s.key, 'name', s.name, 'audience', s.audience, 'duration_minutes', s.duration_minutes,
    'time_zone', s.time_zone) ORDER BY s.audience, s.name), '[]'::jsonb)
  ELSE pg_catalog.jsonb_build_array() END
  FROM public.booking_scheduler_profiles s WHERE s.enabled
$$;
REVOKE ALL ON FUNCTION public.admin_scheduler_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_scheduler_profiles() TO authenticated, service_role;

-- Extend the one form contract without copying its large #4452 body. The old
-- function becomes the base; every existing caller resolves this new public
-- name and receives the extra #4640 errors.
ALTER FUNCTION public.forms_validate_definition(jsonb) RENAME TO forms_validate_definition_4452;
CREATE FUNCTION public.forms_validate_definition(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v jsonb := public.forms_validate_definition_4452(p); v_err jsonb; v_after jsonb; v_phones integer;
BEGIN
  v_err := COALESCE(v->'errors', '[]'::jsonb);
  IF p->>'audience' = 'host' THEN
    SELECT count(*) INTO v_phones FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'fields') = 'array' THEN p->'fields' ELSE '[]'::jsonb END) f
     WHERE f->>'type' = 'phone' AND f->'required' = 'true'::jsonb;
    IF v_phones <> 1 THEN v_err := v_err || jsonb_build_object('path','fields','code','host_phone_required'); END IF;
  END IF;
  v_after := p->'after_submit';
  IF v_after IS NOT NULL AND jsonb_typeof(v_after) <> 'null' THEN
    IF jsonb_typeof(v_after) <> 'object' OR jsonb_typeof(v_after->'action') <> 'string'
       OR v_after->>'action' NOT IN ('thank_you','book_call','link') THEN
      v_err := v_err || jsonb_build_object('path','after_submit','code','bad_after_submit');
    ELSIF v_after->>'action' = 'book_call' AND (jsonb_typeof(v_after->'scheduler_key') <> 'string'
       OR v_after->>'scheduler_key' !~ '^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$') THEN
      v_err := v_err || jsonb_build_object('path','after_submit.scheduler_key','code','bad_after_submit');
    ELSIF v_after->>'action' = 'link' AND (jsonb_typeof(v_after->'url') <> 'string'
       OR length(v_after->>'url') > 500 OR v_after->>'url' !~ '^(https://[^[:space:]]+|/[A-Za-z0-9][^[:space:]]*)$') THEN
      v_err := v_err || jsonb_build_object('path','after_submit.url','code','bad_after_submit');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', jsonb_array_length(v_err) = 0, 'errors', v_err);
END;
$$;
REVOKE ALL ON FUNCTION public.forms_validate_definition(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forms_validate_definition(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.forms_default_definition(p_audience text, p_template text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object(
    'v', 1, 'audience', p_audience,
    'fields', CASE p_template
      WHEN 'creators' THEN jsonb_build_array(
        jsonb_build_object('key','name','type','name','label','Your name','required',true,'locked',true),
        jsonb_build_object('key','email','type','email','label','Email','help','We''ll send your next steps here.','required',true,'locked',true),
        jsonb_build_object('key','phone','type','phone','label','Phone','help','With country code, for WhatsApp.','required',true,'locked',true),
        jsonb_build_object('key','what_do_you_make','type','single','label','What do you make?','required',true,'options',jsonb_build_array('Video','Photo','Both')),
        jsonb_build_object('key','your_main_social','type','social','label','Your main social','help','Handle or profile link.','required',true),
        jsonb_build_object('key','city','type','dropdown','source','google_city','label','Your city','required',true),
        jsonb_build_object('key','consent','type','consent','label','Send me creator tips and new gigs by email. Unsubscribe any time.','required',false))
      WHEN 'locals' THEN jsonb_build_array(
        jsonb_build_object('key','name','type','name','label','Your name','required',true,'locked',true),
        jsonb_build_object('key','email','type','email','label','Email','required',true,'locked',true),
        jsonb_build_object('key','phone','type','phone','label','Phone','help','With country code, for WhatsApp.','required',true,'locked',true),
        jsonb_build_object('key','city','type','dropdown','source','google_city','label','Your city','required',true),
        jsonb_build_object('key','first_place','type','short','label','The first place you would review','required',false),
        jsonb_build_object('key','consent','type','consent','label','Send me occasional emails from Mingla. Unsubscribe anytime.','required',false))
      ELSE jsonb_build_array(
        jsonb_build_object('key','name','type','name','label','Your name','required',true),
        jsonb_build_object('key','email','type','email','label','Work email','required',true),
        jsonb_build_object('key','phone','type','phone','label','Phone number','help','Kunle may call to confirm your time.','required',true),
        jsonb_build_object('key','venue','type','short','label','What is the place or event called?','required',true),
        jsonb_build_object('key','icp','type','single','label','What do you run?','required',true,'options',jsonb_build_array('Events','Trips','Experiences or classes','A restaurant, café or diner','A hotel or resort','A gallery, museum or art space','A play space, bowling or arcade','Something else')),
        jsonb_build_object('key','social','type','social','label','Main social page','required',true),
        jsonb_build_object('key','consent','type','consent','label','Send me occasional emails from Mingla. Unsubscribe anytime.','required',false)) END,
    'ads', jsonb_build_object('lead_on', p_template IS DISTINCT FROM 'book_call_extra' AND p_template IS DISTINCT FROM 'tool',
                              'goal', CASE WHEN p_template IN ('book_call_extra','tool') THEN 'none' ELSE 'call_booked' END),
    'routing', jsonb_build_object('card', jsonb_build_object('on', false)),
    'after_submit', jsonb_build_object('action','thank_you'),
    'own_page', jsonb_build_object('on', false, 'index', false, 'bg', 'night'),
    'design', jsonb_build_object('layout','centre','text_pos','centre','align','left','text_color','#ffffff',
                                 'backdrop','night','tick','orange','columns',1,'phone_steps',false))
$$;

-- A scheduler key must exist when a form version becomes live. Drafts remain
-- recoverable if a profile is disabled; publishing never creates a dead CTA.
CREATE FUNCTION public.issue_4640_form_scheduler_exists() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.definition->'after_submit'->>'action' = 'book_call' AND NOT EXISTS (
    SELECT 1 FROM public.booking_scheduler_profiles s
     WHERE s.key = NEW.definition->'after_submit'->>'scheduler_key' AND s.enabled) THEN
    RAISE EXCEPTION 'scheduler_not_found' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.issue_4640_form_scheduler_exists() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER issue_4640_form_scheduler_exists BEFORE INSERT ON public.form_versions
FOR EACH ROW EXECUTE FUNCTION public.issue_4640_form_scheduler_exists();

-- Short-lived secure handoff. The edge function returns the random bearer and
-- writes only this hash plus the already-normalised booking payload.
CREATE TABLE public.booking_form_handoffs (
  token_sha256      text PRIMARY KEY CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  form_submission_id uuid NOT NULL REFERENCES public.form_submissions(id) ON DELETE CASCADE,
  scheduler_key     text NOT NULL REFERENCES public.booking_scheduler_profiles(key),
  payload           jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  expires_at        timestamptz NOT NULL CHECK (expires_at <= created_at + interval '2 hours'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  used_at           timestamptz
);
ALTER TABLE public.booking_form_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_form_handoffs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.booking_form_handoffs TO service_role;
CREATE INDEX booking_form_handoffs_expiry ON public.booking_form_handoffs (expires_at);

CREATE FUNCTION public.booking_handoff_resolve(p_token_sha256 text, p_scheduler_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE h public.booking_form_handoffs; s public.booking_scheduler_profiles;
BEGIN
  IF p_token_sha256 !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO h FROM public.booking_form_handoffs x WHERE x.token_sha256 = p_token_sha256 AND x.expires_at > now() AND x.used_at IS NULL;
  IF NOT FOUND OR (p_scheduler_key IS NOT NULL AND h.scheduler_key <> p_scheduler_key) THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.booking_scheduler_profiles x WHERE x.key = h.scheduler_key AND x.enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('submission_id', h.form_submission_id, 'scheduler', jsonb_build_object(
    'key',s.key,'name',s.name,'audience',s.audience,'calendar_id',s.calendar_id,'time_zone',s.time_zone,
    'notify_to',s.notify_to,'duration_minutes',s.duration_minutes,'availability',s.availability), 'payload', h.payload);
END $$;
REVOKE ALL ON FUNCTION public.booking_handoff_resolve(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_handoff_resolve(text, text) TO service_role;

CREATE FUNCTION public.booking_handoff_mark_used(p_token_sha256 text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE public.booking_form_handoffs SET used_at=now()
   WHERE token_sha256=p_token_sha256 AND used_at IS NULL AND expires_at>now();
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.booking_handoff_mark_used(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_handoff_mark_used(text) TO service_role;

ALTER TABLE public.book_call_leads ADD COLUMN scheduler_key text REFERENCES public.booking_scheduler_profiles(key);
UPDATE public.book_call_leads SET scheduler_key = CASE audience WHEN 'creator' THEN 'creator-call' WHEN 'local' THEN 'local-call' ELSE 'host-demo' END
 WHERE scheduler_key IS NULL;
ALTER TABLE public.book_call_leads ALTER COLUMN scheduler_key SET NOT NULL, ALTER COLUMN scheduler_key SET DEFAULT 'host-demo';

-- Change notices may be claimed while any one calendar lane is running. Carry
-- the booking's own scheduler destination and time zone with the claim so a
-- future Lagos calendar can never send an Abuja change to the wrong team.
CREATE OR REPLACE FUNCTION public.book_call_claim_change_notices(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_out jsonb;
BEGIN
  WITH due AS (
    SELECT d.id, d.notice_key, d.previous_key
      FROM (
        SELECT k.id,
               CASE k.status WHEN 'moved' THEN 'moved@' || to_char(k.call_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ELSE k.status END AS notice_key,
               k.notified_key AS previous_key
          FROM public.book_call_leads k
         WHERE k.status IN ('moved','cancelled','declined')
           AND k.status_changed_at > now() - interval '7 days'
           AND GREATEST(k.call_at,COALESCE(k.original_call_at,k.call_at)) > now() - interval '1 day') d
      JOIN public.book_call_leads l ON l.id=d.id
     WHERE l.notified_key IS DISTINCT FROM d.notice_key
     ORDER BY l.status_changed_at,l.id
     LIMIT LEAST(GREATEST(COALESCE(p_limit,20),1),50)
     FOR UPDATE OF l SKIP LOCKED
  ), claimed AS (
    UPDATE public.book_call_leads k SET notified_key=due.notice_key FROM due WHERE k.id=due.id
    RETURNING k.id,due.notice_key,due.previous_key,k.status,k.audience,k.name,k.venue,k.call_at,
              k.original_call_at,k.booker_time_zone,k.event_url,k.scheduler_key
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',c.id,'notice_key',c.notice_key,'previous_key',c.previous_key,'status',c.status,
    'audience',c.audience,'name',c.name,'venue',c.venue,'call_at',c.call_at,
    'original_call_at',c.original_call_at,'booker_time_zone',c.booker_time_zone,
    'event_url',c.event_url,'notify_to',s.notify_to,'scheduler_time_zone',s.time_zone)
    ORDER BY c.call_at,c.id),'[]'::jsonb)
    INTO v_out
    FROM claimed c
    JOIN public.booking_scheduler_profiles s ON s.key=c.scheduler_key;
  RETURN v_out;
END;
$$;

-- Exact lifecycle state stays beside the booking. Work cards remain the normal
-- Work shape; this table adds only the requested automation identity and time.
CREATE TABLE public.booking_reminder_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES public.book_call_leads(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('24h','2h','15m')),
  due_at      timestamptz NOT NULL,
  state       text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','sent','cancelled','skipped')),
  claimed_at  timestamptz,
  sent_at     timestamptz,
  last_error  text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, kind)
);
CREATE INDEX booking_reminder_jobs_due ON public.booking_reminder_jobs (due_at) WHERE state = 'pending';
ALTER TABLE public.booking_reminder_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_reminder_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.booking_reminder_jobs TO service_role;

CREATE TABLE public.booking_work_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES public.book_call_leads(id) ON DELETE CASCADE,
  automation_kind text NOT NULL CHECK (automation_kind IN ('booking_confirmation','one_hour_confirmation')),
  due_at          timestamptz NOT NULL,
  call_at         timestamptz NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^demo_(booked|hour):[0-9a-f-]{36}$'),
  state           text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','created','cancelled')),
  card_id         uuid REFERENCES public.ops_work_cards(id) ON DELETE SET NULL,
  claimed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, automation_kind)
);
CREATE INDEX booking_work_actions_due ON public.booking_work_actions (due_at) WHERE state = 'pending';
ALTER TABLE public.booking_work_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_work_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.booking_work_actions TO service_role;

CREATE FUNCTION public.issue_4640_create_work_card(p_action_id uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE a public.booking_work_actions; b public.book_call_leads; c public.ops_work_cards; v_title text; v_when text; v_label text; v_event uuid; v_team_zone text;
BEGIN
  SELECT * INTO a FROM public.booking_work_actions x WHERE x.id = p_action_id FOR UPDATE;
  IF NOT FOUND OR a.state = 'cancelled' THEN RETURN NULL; END IF;
  IF a.card_id IS NOT NULL THEN RETURN a.card_id; END IF;
  SELECT * INTO b FROM public.book_call_leads x WHERE x.id = a.booking_id;
  IF NOT FOUND OR b.status IN ('cancelled','declined') THEN
    UPDATE public.booking_work_actions SET state='cancelled', updated_at=now() WHERE id=a.id; RETURN NULL;
  END IF;
  SELECT s.time_zone INTO v_team_zone FROM public.booking_scheduler_profiles s WHERE s.key=b.scheduler_key;
  v_when := to_char(b.call_at AT TIME ZONE COALESCE(NULLIF(b.booker_time_zone,''),'UTC'), 'FMDay, FMDD Mon at HH24:MI') || ' ' || COALESCE(NULLIF(b.booker_time_zone,''),'UTC');
  v_label := COALESCE(NULLIF(btrim(b.venue),''), b.name);
  v_title := left(CASE a.automation_kind WHEN 'booking_confirmation' THEN 'Confirm new demo — ' ELSE 'Reconfirm demo in 1 hour — ' END || v_label || ' · ' || v_when, 160);
  INSERT INTO public.ops_work_cards (title,instructions,done_means,status,due_on,due_source,sprint_id,plan,created_by,created_via,updated_by,updated_via,auto_key)
  VALUES (v_title,
    left(format('Call %s to confirm the %s Host demo. Phone: %s. Email: %s. What they run: %s. Social: %s. The video call starts %s.',
      b.name, CASE a.automation_kind WHEN 'booking_confirmation' THEN 'newly booked' ELSE 'one-hour' END,
      COALESCE(b.phone_e164,'missing'), b.email, COALESCE(b.icp,'unknown'), b.social_url, v_when), 4000),
    CASE a.automation_kind WHEN 'booking_confirmation' THEN 'Kunle has confirmed the booking and availability with the Host.' ELSE 'Kunle has reconfirmed the Host is available for the call.' END,
    'todo', (a.due_at AT TIME ZONE COALESCE(v_team_zone,'America/New_York'))::date, 'explicit', public.ops_sprint_ensure(public.ops_today(NULL)), '[]'::jsonb,
    'system@usemingla.com','system','system@usemingla.com','system', a.idempotency_key)
  RETURNING * INTO c;
  PERFORM public.ops_people_set(c.id, ARRAY['kunle@usemingla.com'], ARRAY['seth@usemingla.com'], 'system@usemingla.com', NULL);
  INSERT INTO public.ops_work_links(card_id,kind,target_id,label,added_by,added_via)
  VALUES(c.id,'booking',b.id,public.ops_link_label('booking',b.id),'system@usemingla.com',NULL) ON CONFLICT DO NOTHING;
  v_event := public.ops_card_event(c.id,'system@usemingla.com','system','added',NULL,NULL,public.ops_card_snapshot(c.id),NULL,c.revision);
  PERFORM public.ops_log_write('system@usemingla.com','system','auto_added','info',c.id,'work_card',c.id,
    format('Mingla added Card %s: %s',c.number,c.title),jsonb_build_object('auto_key',a.idempotency_key,'booking_id',b.id,'call_at',b.call_at));
  UPDATE public.booking_work_actions SET state='created',card_id=c.id,updated_at=now() WHERE id=a.id;
  RETURN c.id;
END $$;
REVOKE ALL ON FUNCTION public.issue_4640_create_work_card(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4640_create_work_card(uuid) TO service_role;

CREATE FUNCTION public.booking_lifecycle_start(p_booking_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE b public.book_call_leads; a uuid; v_card uuid;
BEGIN
  SELECT * INTO b FROM public.book_call_leads x WHERE x.booking_key=p_booking_key FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('started',false); END IF;
  INSERT INTO public.booking_reminder_jobs(booking_id,kind,due_at,state) VALUES
    (b.id,'24h',b.call_at-interval '24 hours',CASE WHEN b.call_at-interval '24 hours' > now() THEN 'pending' ELSE 'skipped' END),
    (b.id,'2h', b.call_at-interval '2 hours', CASE WHEN b.call_at-interval '2 hours' > now() THEN 'pending' ELSE 'skipped' END),
    (b.id,'15m',b.call_at-interval '15 minutes',CASE WHEN b.call_at-interval '15 minutes' > now() THEN 'pending' ELSE 'skipped' END)
  ON CONFLICT (booking_id,kind) DO NOTHING;
  INSERT INTO public.booking_work_actions(booking_id,automation_kind,due_at,call_at,idempotency_key) VALUES
    (b.id,'booking_confirmation',now(),b.call_at,'demo_booked:'||b.id),
    (b.id,'one_hour_confirmation',b.call_at-interval '1 hour',b.call_at,'demo_hour:'||b.id)
  ON CONFLICT (booking_id,automation_kind) DO NOTHING;
  SELECT id INTO a FROM public.booking_work_actions WHERE booking_id=b.id AND automation_kind='booking_confirmation';
  v_card := public.issue_4640_create_work_card(a);
  RETURN jsonb_build_object('started',true,'booking_id',b.id,'immediate_card_id',v_card);
END $$;
REVOKE ALL ON FUNCTION public.booking_lifecycle_start(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_lifecycle_start(text) TO service_role;

CREATE FUNCTION public.booking_reminder_claim(p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v jsonb;
BEGIN
  WITH due AS (SELECT j.id FROM public.booking_reminder_jobs j JOIN public.book_call_leads b ON b.id=j.booking_id
    WHERE (j.state='pending' OR (j.state='claimed' AND j.claimed_at<now()-interval '10 minutes'))
      AND j.due_at<=now() AND j.due_at>now()-interval '12 minutes' AND b.status IN ('booked','moved') AND b.call_at>now()
    ORDER BY j.due_at,j.id LIMIT LEAST(GREATEST(COALESCE(p_limit,30),1),100) FOR UPDATE OF j SKIP LOCKED),
  claimed AS (UPDATE public.booking_reminder_jobs j SET state='claimed',claimed_at=now(),updated_at=now() FROM due WHERE j.id=due.id
    RETURNING j.id,j.kind,j.booking_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'booking_id',b.id,'name',b.name,'email',b.email,
    'call_at',b.call_at,'booker_time_zone',b.booker_time_zone,'meet_url',b.meet_url,'venue',b.venue,'audience',b.audience)
    ORDER BY b.call_at,c.id),'[]'::jsonb) INTO v FROM claimed c JOIN public.book_call_leads b ON b.id=c.booking_id;
  UPDATE public.booking_reminder_jobs SET state='skipped',updated_at=now() WHERE state='pending' AND due_at<=now()-interval '12 minutes';
  RETURN v;
END $$;
CREATE FUNCTION public.booking_reminder_finish(p_id uuid,p_sent boolean,p_error text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.booking_reminder_jobs SET state=CASE WHEN p_sent THEN 'sent' ELSE 'pending' END,
    sent_at=CASE WHEN p_sent THEN now() ELSE sent_at END,claimed_at=NULL,last_error=left(NULLIF(btrim(p_error),''),300),updated_at=now()
   WHERE id=p_id AND state='claimed'; RETURN FOUND;
END $$;
CREATE FUNCTION public.booking_work_claim(p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  WITH due AS (SELECT a.id FROM public.booking_work_actions a JOIN public.book_call_leads b ON b.id=a.booking_id
    WHERE (a.state='pending' OR (a.state='claimed' AND a.claimed_at<now()-interval '10 minutes'))
      AND a.due_at<=now() AND b.status IN ('booked','moved') AND b.call_at>now()
    ORDER BY a.due_at,a.id LIMIT LEAST(GREATEST(COALESCE(p_limit,30),1),100) FOR UPDATE OF a SKIP LOCKED),
  claimed AS (UPDATE public.booking_work_actions a SET state='claimed',claimed_at=now(),updated_at=now() FROM due WHERE a.id=due.id RETURNING a.id)
  SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO v FROM claimed; RETURN v;
END $$;
CREATE FUNCTION public.booking_work_finish(p_id uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v uuid;
BEGIN
  v:=public.issue_4640_create_work_card(p_id);
  IF v IS NULL THEN UPDATE public.booking_work_actions SET state='pending',claimed_at=NULL,updated_at=now() WHERE id=p_id AND state='claimed'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.booking_reminder_claim(integer),public.booking_reminder_finish(uuid,boolean,text),public.booking_work_claim(integer),public.booking_work_finish(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.booking_reminder_claim(integer),public.booking_reminder_finish(uuid,boolean,text),public.booking_work_claim(integer),public.booking_work_finish(uuid) TO service_role;

-- Calendar sync writes book_call_leads; this trigger owns the downstream
-- lifecycle so every writer gets the same reschedule/cancel behavior.
CREATE FUNCTION public.issue_4640_booking_changed() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; c public.ops_work_cards; v_before jsonb; v_col uuid; v_when text; v_label text; v_title text; v_team_zone text;
BEGIN
  IF NEW.call_at IS NOT DISTINCT FROM OLD.call_at AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status IN ('cancelled','declined') THEN
    UPDATE public.booking_reminder_jobs SET state='cancelled',claimed_at=NULL,updated_at=now() WHERE booking_id=NEW.id AND state IN ('pending','claimed');
    UPDATE public.booking_work_actions SET state='cancelled',claimed_at=NULL,updated_at=now() WHERE booking_id=NEW.id AND state IN ('pending','claimed');
    SELECT s.id INTO v_col FROM public.ops_work_statuses s WHERE s.grp='done' AND s.archived_at IS NULL ORDER BY s.position LIMIT 1;
    FOR a IN SELECT * FROM public.booking_work_actions x WHERE x.booking_id=NEW.id AND x.card_id IS NOT NULL LOOP
      SELECT * INTO c FROM public.ops_work_cards w WHERE w.id=a.card_id FOR UPDATE;
      IF FOUND AND c.status<>'done' THEN
        v_before:=public.ops_card_snapshot(c.id);
        UPDATE public.ops_work_cards w SET status='done',status_id=COALESCE(v_col,w.status_id),close_kind='system',
          close_reason='The demo was cancelled or declined in Google Calendar.',result='Closed automatically because the demo is no longer booked.',
          closed_at=now(),closed_by='system@usemingla.com',closed_via='system',working_by=NULL,working_via=NULL,
          revision=w.revision+1,updated_by='system@usemingla.com',updated_via='system',updated_at=now() WHERE w.id=c.id;
        PERFORM public.ops_card_event(c.id,'system@usemingla.com','system','closed','The linked demo was cancelled or declined.',v_before,public.ops_card_snapshot(c.id),c.revision,c.revision+1);
      END IF;
    END LOOP;
  ELSE
    UPDATE public.booking_reminder_jobs SET due_at=CASE kind WHEN '24h' THEN NEW.call_at-interval '24 hours' WHEN '2h' THEN NEW.call_at-interval '2 hours' ELSE NEW.call_at-interval '15 minutes' END,
      state=CASE WHEN (CASE kind WHEN '24h' THEN NEW.call_at-interval '24 hours' WHEN '2h' THEN NEW.call_at-interval '2 hours' ELSE NEW.call_at-interval '15 minutes' END)>now() THEN 'pending' ELSE 'skipped' END,
      claimed_at=NULL,sent_at=NULL,last_error=NULL,updated_at=now() WHERE booking_id=NEW.id AND state<>'cancelled';
    UPDATE public.booking_work_actions SET due_at=CASE automation_kind WHEN 'one_hour_confirmation' THEN NEW.call_at-interval '1 hour' ELSE due_at END,
      call_at=NEW.call_at,updated_at=now() WHERE booking_id=NEW.id AND state IN ('pending','claimed','created');
    SELECT s.time_zone INTO v_team_zone FROM public.booking_scheduler_profiles s WHERE s.key=NEW.scheduler_key;
    v_when:=to_char(NEW.call_at AT TIME ZONE COALESCE(NULLIF(NEW.booker_time_zone,''),'UTC'),'FMDay, FMDD Mon at HH24:MI')||' '||COALESCE(NULLIF(NEW.booker_time_zone,''),'UTC');
    v_label:=COALESCE(NULLIF(btrim(NEW.venue),''),NEW.name);
    FOR a IN SELECT * FROM public.booking_work_actions x WHERE x.booking_id=NEW.id AND x.card_id IS NOT NULL LOOP
      SELECT * INTO c FROM public.ops_work_cards w WHERE w.id=a.card_id FOR UPDATE;
      IF FOUND AND c.status<>'done' THEN
        v_before:=public.ops_card_snapshot(c.id);
        v_title:=left(CASE a.automation_kind WHEN 'booking_confirmation' THEN 'Confirm new demo — ' ELSE 'Reconfirm demo in 1 hour — ' END||v_label||' · '||v_when,160);
        UPDATE public.ops_work_cards w SET title=v_title,
          instructions=left(format('Call %s to confirm the %s Host demo. Phone: %s. Email: %s. What they run: %s. Social: %s. The video call starts %s.',
            NEW.name,CASE a.automation_kind WHEN 'booking_confirmation' THEN 'newly booked' ELSE 'one-hour' END,
            COALESCE(NEW.phone_e164,'missing'),NEW.email,COALESCE(NEW.icp,'unknown'),NEW.social_url,v_when),4000),
          due_on=(a.due_at AT TIME ZONE COALESCE(v_team_zone,'America/New_York'))::date,
          sprint_id=public.ops_sprint_ensure(public.ops_today(NULL)),revision=w.revision+1,
          updated_by='system@usemingla.com',updated_via='system',updated_at=now() WHERE w.id=c.id;
        PERFORM public.ops_card_event(c.id,'system@usemingla.com','system','updated','The linked demo moved; its confirmation time moved with it.',v_before,public.ops_card_snapshot(c.id),c.revision,c.revision+1);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.issue_4640_booking_changed() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER issue_4640_booking_changed AFTER UPDATE OF call_at,status ON public.book_call_leads
FOR EACH ROW EXECUTE FUNCTION public.issue_4640_booking_changed();

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL
     OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='supabase_url')
     OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='service_role_key') THEN
    RAISE NOTICE '#4640: reminder cron not registered; pg_cron, pg_net or vault secrets are unavailable'; RETURN;
  END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='issue_4640_booking_lifecycle') THEN PERFORM cron.unschedule('issue_4640_booking_lifecycle'); END IF;
  PERFORM cron.schedule('issue_4640_booking_lifecycle','*/5 * * * *',$job$SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)||'/functions/v1/growth-tools-booking-reminders',
    headers := jsonb_build_object('content-type','application/json','authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
    body := '{}'::jsonb, timeout_milliseconds := 55000)$job$);
END $cron$;

COMMIT;
