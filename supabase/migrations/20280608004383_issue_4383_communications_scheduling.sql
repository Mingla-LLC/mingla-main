-- Issue #4383 — Admin Communications: push to hosts, explorers or both, now or
-- later; scheduled announcements and roadmap changes; one list of everything
-- scheduled.
--
--   A. two notification categories: mingla_updates (Explorer app) and
--      business.mingla_update (Host app). The prefix decides the OneSignal app
--      (_shared/push-utils.ts resolveOneSignalApp: business.* to the Host app,
--      anything else to the Explorer app), so no edge function is needed.
--   B. admin_push_campaigns: one row per Admin push. Its time lives only on
--      its own row (I-4383-SCHEDULE-ONE-OWNER).
--   C. announcements: the dead scheduled_at column finally means something
--      (status 'scheduled'); hosts still read published rows only.
--   D. roadmap: a draft card can be given a go-live time, and the "roadmap
--      changed" notice can be scheduled.
--   E. campaign identity widened to admin_push; delivery status and retry
--      read any campaign by id.
--   F. internal fan-out functions (service role only); the public publish /
--      notify RPCs become an admin gate in front of them.
--   G. one SQL due-runner, run every minute by pg_cron: each due item fires at
--      most once, never before its saved instant, and one failure never
--      blocks the rest (I-4383-FIRE-ONCE, I-4383-NO-EARLY-SEND).
--   H. Admin RPCs for the Push, Announcements, Roadmap, Email and Overview
--      screens.
--
-- Static SQL only (#1860 C7). Conflicts raise PT409, never 40001. Every new
-- table has RLS on and no client policy. Every SECURITY DEFINER function sets
-- search_path; internals are revoked from PUBLIC, anon and authenticated.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- A. Categories
-- ---------------------------------------------------------------------------
-- mingla_updates sits in the Explorer Settings 'Marketing' section (the app
-- lists only Purchases, Reservations, Reminders, Marketing and Social), as
-- "Mingla updates". is_transactional = true: in-app is the only locked
-- channel, push defaults on and the person can switch it off, which
-- can_send honours (an enabled = false pref refuses push; D4).
INSERT INTO public.notification_categories (
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES
  ('mingla_updates', 'Marketing', true, 'normal', ARRAY['inapp', 'push']::text[], 'reach_once', true),
  ('business.mingla_update', 'community', true, 'normal', ARRAY['inapp', 'push']::text[], 'reach_once', true)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- B. Push campaigns
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_push_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 65),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 178),
  audience text NOT NULL CHECK (audience IN ('hosts', 'explorers', 'both')),
  -- Stored values map to deep links ONLY through issue_4383_push_deep_link
  -- below, which restates supabase/functions/_shared/adminPushDestinations.ts
  -- (a test asserts the two agree). Never concatenated into a link.
  explorer_target text NOT NULL DEFAULT 'explore' CHECK (explorer_target IN ('explore', 'discover', 'likes')),
  host_target text NOT NULL DEFAULT 'community' CHECK (host_target IN ('community', 'home')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed')),
  scheduled_for timestamptz,
  timezone text NOT NULL DEFAULT 'UTC',
  campaign_id uuid REFERENCES public.community_notification_campaigns(id) ON DELETE SET NULL,
  audience_count integer CHECK (audience_count IS NULL OR audience_count >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  fired_at timestamptz,
  cancelled_at timestamptz,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CONSTRAINT admin_push_campaigns_scheduled_has_time CHECK (status <> 'scheduled' OR scheduled_for IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS admin_push_campaigns_due_idx
  ON public.admin_push_campaigns (scheduled_for)
  WHERE status = 'scheduled';

ALTER TABLE public.admin_push_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_push_campaigns FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_push_campaigns TO service_role;

COMMENT ON TABLE public.admin_push_campaigns IS
  '#4383: one Admin push to hosts, explorers or both. All access through issue_4383_* RPCs; '
  'the row owns its own send time (I-4383-SCHEDULE-ONE-OWNER).';

-- ---------------------------------------------------------------------------
-- C. Announcements: status 'scheduled'
-- ---------------------------------------------------------------------------
ALTER TABLE public.community_announcements
  ADD COLUMN IF NOT EXISTS scheduled_timezone text,
  ADD COLUMN IF NOT EXISTS scheduled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS schedule_error text,
  ADD COLUMN IF NOT EXISTS schedule_failed_at timestamptz;

ALTER TABLE public.community_announcements
  DROP CONSTRAINT IF EXISTS community_announcements_status_check;
ALTER TABLE public.community_announcements
  ADD CONSTRAINT community_announcements_status_check
  CHECK (status IN ('draft', 'scheduled', 'published', 'archived'));
ALTER TABLE public.community_announcements
  DROP CONSTRAINT IF EXISTS community_announcements_scheduled_has_time;
ALTER TABLE public.community_announcements
  ADD CONSTRAINT community_announcements_scheduled_has_time
  CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL);
ALTER TABLE public.community_announcements
  DROP CONSTRAINT IF EXISTS community_announcements_schedule_error_length;
ALTER TABLE public.community_announcements
  ADD CONSTRAINT community_announcements_schedule_error_length
  CHECK (schedule_error IS NULL OR char_length(schedule_error) <= 300);

CREATE INDEX IF NOT EXISTS community_announcements_due_idx
  ON public.community_announcements (scheduled_at)
  WHERE status = 'scheduled';

-- ---------------------------------------------------------------------------
-- D. Roadmap: card go-live and scheduled notices
-- ---------------------------------------------------------------------------
ALTER TABLE public.community_roadmap_cards
  ADD COLUMN IF NOT EXISTS go_live_at timestamptz,
  ADD COLUMN IF NOT EXISTS go_live_timezone text;
-- I-3720-ROADMAP-INTERNAL-NOTE-ADMIN-ONLY: authenticated holds column SELECT on
-- every column except internal_note. The row policy still shows hosts only
-- published cards, and a card's go-live time is cleared when it goes live, so
-- no draft schedule is ever visible to a host. Who scheduled it lives in
-- community_audit_log (schedule_roadmap_card), not on the card.
GRANT SELECT (go_live_at, go_live_timezone) ON TABLE public.community_roadmap_cards TO authenticated;

-- A go-live time belongs to a draft only. Whatever path publishes or archives
-- a card (the editor's Save, a lane move, a GitHub suggestion, the runner),
-- the time and zone are cleared in the same write, so a card taken back to
-- draft never re-arms an old time and a host never reads a stale one.
CREATE OR REPLACE FUNCTION public.issue_4383_roadmap_card_clear_go_live()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'draft' THEN
    NEW.go_live_at := NULL;
    NEW.go_live_timezone := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_roadmap_card_clear_go_live() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS issue_4383_roadmap_card_clear_go_live ON public.community_roadmap_cards;
CREATE TRIGGER issue_4383_roadmap_card_clear_go_live
  BEFORE INSERT OR UPDATE ON public.community_roadmap_cards
  FOR EACH ROW EXECUTE FUNCTION public.issue_4383_roadmap_card_clear_go_live();

CREATE INDEX IF NOT EXISTS community_roadmap_cards_go_live_idx
  ON public.community_roadmap_cards (go_live_at)
  WHERE status = 'draft' AND go_live_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.community_roadmap_notices_scheduled (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_for timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'cancelled', 'failed')),
  request_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  campaign_id uuid REFERENCES public.community_notification_campaigns(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  fired_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_roadmap_notices_due_idx
  ON public.community_roadmap_notices_scheduled (scheduled_for)
  WHERE status = 'scheduled';

ALTER TABLE public.community_roadmap_notices_scheduled ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_roadmap_notices_scheduled FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.community_roadmap_notices_scheduled TO service_role;

COMMENT ON TABLE public.community_roadmap_notices_scheduled IS
  '#4383: a "roadmap changed" host notice scheduled for later. Fired once by '
  'issue_4383_fire_due_communications through the existing roadmap campaign path.';

-- ---------------------------------------------------------------------------
-- E. Campaign identity
-- ---------------------------------------------------------------------------
ALTER TABLE public.community_notification_campaigns
  DROP CONSTRAINT IF EXISTS community_notification_campaigns_kind_check;
ALTER TABLE public.community_notification_campaigns
  ADD CONSTRAINT community_notification_campaigns_kind_check
  CHECK (kind IN ('announcement', 'roadmap_update', 'admin_push'));

-- #4383: re-emitted from 20271020003720 with one change: a campaign named by
-- id is read whatever its kind (pushes and roadmap notices too); no id still
-- means the latest announcement.
CREATE OR REPLACE FUNCTION public.community_get_announcement_notification_status(
  p_campaign_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campaign public.community_notification_campaigns%ROWTYPE;
  v_pending integer := 0;
  v_done integer := 0;
  v_failed integer := 0;
  v_inapp integer := 0;
  v_push_sent integer := 0;
  v_push_suppressed integer := 0;
  v_push_retrying integer := 0;
  v_push_failed integer := 0;
  v_email_sent integer := 0;
  v_email_suppressed integer := 0;
  v_email_retrying integer := 0;
  v_email_failed integer := 0;
  v_state text;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_campaign
  FROM public.community_notification_campaigns c
  WHERE (p_campaign_id IS NULL AND c.kind = 'announcement')
    OR c.id = p_campaign_id
  ORDER BY c.created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT
    count(*) FILTER (WHERE o.status IN ('pending', 'processing', 'retry_wait')),
    count(*) FILTER (WHERE o.status = 'done'),
    count(*) FILTER (WHERE o.status = 'failed')
  INTO v_pending, v_done, v_failed
  FROM public.notification_outbox o
  WHERE o.payload->>'campaign_id' = v_campaign.id::text;

  SELECT
    count(DISTINCT n.id) FILTER (WHERE d.channel = 'inapp' AND d.status = 'delivered'),
    count(DISTINCT n.id) FILTER (WHERE d.channel = 'push' AND d.status IN ('sent', 'delivered')),
    count(DISTINCT n.id) FILTER (WHERE d.channel = 'push' AND d.status IN ('suppressed', 'skipped')),
    count(DISTINCT n.id) FILTER (
      WHERE d.channel = 'push' AND (
        d.status = 'queued' OR (
          d.status IN ('failed', 'undelivered')
          AND EXISTS (
            SELECT 1 FROM public.notification_outbox pending
            WHERE pending.idempotency_key = n.idempotency_key
              AND pending.status IN ('pending', 'processing', 'retry_wait')
          )
        )
      )
    ),
    count(DISTINCT n.id) FILTER (
      WHERE d.channel = 'push' AND d.status IN ('failed', 'undelivered')
        AND NOT EXISTS (
          SELECT 1 FROM public.notification_outbox pending
          WHERE pending.idempotency_key = n.idempotency_key
            AND pending.status IN ('pending', 'processing', 'retry_wait')
        )
    ),
    count(DISTINCT n.id) FILTER (WHERE d.channel = 'email' AND d.status IN ('sent', 'delivered')),
    count(DISTINCT n.id) FILTER (WHERE d.channel = 'email' AND d.status IN ('suppressed', 'skipped')),
    count(DISTINCT n.id) FILTER (
      WHERE d.channel = 'email' AND (
        d.status = 'queued' OR (
          d.status IN ('failed', 'undelivered')
          AND EXISTS (
            SELECT 1 FROM public.notification_outbox pending
            WHERE pending.idempotency_key = n.idempotency_key
              AND pending.status IN ('pending', 'processing', 'retry_wait')
          )
        )
      )
    ),
    count(DISTINCT n.id) FILTER (
      WHERE d.channel = 'email' AND d.status IN ('failed', 'undelivered')
        AND NOT EXISTS (
          SELECT 1 FROM public.notification_outbox pending
          WHERE pending.idempotency_key = n.idempotency_key
            AND pending.status IN ('pending', 'processing', 'retry_wait')
        )
    )
  INTO
    v_inapp, v_push_sent, v_push_suppressed, v_push_retrying, v_push_failed,
    v_email_sent, v_email_suppressed, v_email_retrying, v_email_failed
  FROM public.notifications n
  LEFT JOIN public.notification_deliveries d ON d.notification_id = n.id
  WHERE n.data->>'campaign_id' = v_campaign.id::text;

  v_state := CASE
    WHEN v_pending > 0 AND v_done = 0 THEN 'queued'
    WHEN v_pending > 0 THEN 'processing'
    WHEN v_failed > 0 AND v_done = 0 THEN 'failed'
    WHEN v_failed > 0 OR v_push_failed > 0 OR v_email_failed > 0 THEN 'partial'
    ELSE 'complete'
  END;

  RETURN jsonb_build_object(
    'campaign_id', v_campaign.id,
    'source_id', v_campaign.source_id,
    'actor_user_id', v_campaign.actor_user_id,
    'audience_count', v_campaign.audience_count,
    'created_at', v_campaign.created_at,
    'state', v_state,
    'outbox', jsonb_build_object(
      'pending', v_pending, 'done', v_done, 'failed', v_failed
    ),
    'channels', jsonb_build_object(
      'inapp_delivered', v_inapp,
      'push_accepted', v_push_sent,
      'push_suppressed', v_push_suppressed,
      'push_retrying', v_push_retrying,
      'push_failed', v_push_failed,
      'email_accepted', v_email_sent,
      'email_suppressed', v_email_suppressed,
      'email_retrying', v_email_retrying,
      'email_failed', v_email_failed
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_get_announcement_notification_status(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_get_announcement_notification_status(uuid)
  TO authenticated;

-- Where the next Admin push row may queue. All Admin push rows share ONE
-- pace: at most 12 claimable a minute across every push and every retry, so
-- a broadcast takes at most 12 of the drain's 25 slots and order and payout
-- pushes are never held up (spec F-13). Serialised by an advisory lock, so two
-- pushes fired in the same pass (or racing) never pace from the same start.
-- base: the bucket to fill next; used: rows already in it. Row g (0-based,
-- counted from `used`) goes to base + (g / 12) minutes.
CREATE OR REPLACE FUNCTION public.issue_4383_push_pacing_start()
RETURNS TABLE(base timestamptz, used integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_4383_push_pacing', 4383));
  SELECT max(o.next_attempt_at) INTO v_last
  FROM public.notification_outbox o
  WHERE o.category_key IN ('mingla_updates', 'business.mingla_update')
    AND o.status IN ('pending', 'retry_wait')
    AND o.next_attempt_at IS NOT NULL
    AND o.payload ? 'campaign_id';
  IF v_last IS NULL OR v_last < now() THEN
    -- Everything still queued is claimable now: it all counts against this minute.
    base := now();
    SELECT count(*)::integer INTO used
    FROM public.notification_outbox o
    WHERE o.category_key IN ('mingla_updates', 'business.mingla_update')
      AND o.status IN ('pending', 'retry_wait')
      AND o.next_attempt_at IS NOT NULL
      AND o.payload ? 'campaign_id';
  ELSE
    base := v_last;
    SELECT count(*)::integer INTO used
    FROM public.notification_outbox o
    WHERE o.category_key IN ('mingla_updates', 'business.mingla_update')
      AND o.status IN ('pending', 'retry_wait')
      AND o.next_attempt_at = v_last
      AND o.payload ? 'campaign_id';
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_push_pacing_start() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4383_push_pacing_start() TO service_role;

-- #4383: re-emitted from 20271108063720 with two changes: an Admin push or a
-- roadmap notice campaign can be retried the same way, and an Admin push's
-- failed rows re-queue on the shared Admin push pace (never all at once).
CREATE OR REPLACE FUNCTION public.issue_3720_admin_retry_announcement(p_campaign_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count integer; v_kind text; v_base timestamptz; v_used integer;
BEGIN
  SELECT kind INTO v_kind FROM public.community_notification_campaigns
  WHERE id=p_campaign_id AND kind IN ('announcement','admin_push','roadmap_update');
  IF NOT public.is_admin_user() OR v_kind IS NULL
  THEN RAISE EXCEPTION 'not_authorized_or_not_found' USING ERRCODE='42501'; END IF;
  IF v_kind = 'admin_push' THEN
    SELECT p.base, p.used INTO v_base, v_used FROM public.issue_4383_push_pacing_start() p;
    WITH failed AS (
      SELECT o.id, row_number() OVER (ORDER BY o.id) - 1 AS n
      FROM public.notification_outbox o
      WHERE o.payload->>'campaign_id'=p_campaign_id::text AND o.status='failed'
    )
    UPDATE public.notification_outbox o
    SET status='retry_wait',attempts=0,next_attempt_at=v_base + ((v_used + f.n) / 12) * interval '1 minute',processed_at=NULL,last_error=NULL
    FROM failed f WHERE o.id=f.id;
  ELSE
    UPDATE public.notification_outbox SET status='retry_wait',attempts=0,next_attempt_at=now(),processed_at=NULL,last_error=NULL
    WHERE payload->>'campaign_id'=p_campaign_id::text AND status='failed';
  END IF;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  INSERT INTO public.community_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),'retry_announcement','community_notification_campaign',p_campaign_id,jsonb_build_object('requeued',v_count));
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_retry_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_retry_announcement(uuid) TO authenticated;

-- #4383: re-emitted from 20271108073720 with one change: only a draft or a
-- scheduled announcement can be edited; a published or archived one cannot be
-- changed by mistake.
CREATE OR REPLACE FUNCTION public.issue_3720_admin_upsert_announcement(
  p_id uuid,
  p_title text,
  p_body_md text,
  p_action_line text DEFAULT NULL,
  p_roadmap_card_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_id uuid;
  v_status text;
  v_title text:=btrim(COALESCE(p_title,''));
  v_body text:=btrim(COALESCE(p_body_md,''));
  v_action text:=NULLIF(btrim(COALESCE(p_action_line,'')),'');
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF char_length(v_title) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_title' USING ERRCODE='22023';
  END IF;
  IF char_length(v_body)<1 OR char_length(COALESCE(v_action,''))>500 THEN
    RAISE EXCEPTION 'invalid_body_or_action' USING ERRCODE='22023';
  END IF;
  IF p_roadmap_card_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.community_roadmap_cards WHERE id=p_roadmap_card_id
  ) THEN RAISE EXCEPTION 'invalid_roadmap_card' USING ERRCODE='22023'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.community_announcements(
      title,body_md,action_line,roadmap_card_id,author_user_id
    ) VALUES(v_title,v_body,v_action,p_roadmap_card_id,auth.uid())
    RETURNING id INTO v_id;
  ELSE
    SELECT status INTO v_status FROM public.community_announcements WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
    IF v_status NOT IN ('draft','scheduled') THEN
      RAISE EXCEPTION 'not_editable' USING ERRCODE='22023';
    END IF;
    UPDATE public.community_announcements
    SET title=v_title,body_md=v_body,action_line=v_action,
        roadmap_card_id=p_roadmap_card_id,updated_at=now()
    WHERE id=p_id
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.community_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),CASE WHEN p_id IS NULL THEN 'create_announcement' ELSE 'update_announcement' END,
    'community_announcement',v_id,
    jsonb_build_object('title',v_title,'has_action',v_action IS NOT NULL,'roadmap_card_id',p_roadmap_card_id));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_upsert_announcement(uuid,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_upsert_announcement(uuid,text,text,text,uuid) TO authenticated;

-- #4383: re-emitted from 20271108073720 with the schedule columns added (the
-- Announcements screen shows the saved timezone and a failed scheduled send).
DROP FUNCTION IF EXISTS public.issue_3720_admin_announcement_deliveries();
CREATE FUNCTION public.issue_3720_admin_announcement_deliveries()
RETURNS TABLE(
  id uuid,title text,body_md text,action_line text,roadmap_card_id uuid,
  status text,published_at timestamptz,scheduled_at timestamptz,
  updated_at timestamptz,delivery jsonb,
  scheduled_timezone text,schedule_error text,schedule_failed_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT a.id,a.title,a.body_md,a.action_line,a.roadmap_card_id,a.status,
    a.published_at,a.scheduled_at,a.updated_at,
    CASE WHEN c.id IS NULL THEN NULL ELSE public.community_get_announcement_notification_status(c.id) END,
    a.scheduled_timezone,a.schedule_error,a.schedule_failed_at
  FROM public.community_announcements a
  LEFT JOIN public.community_notification_campaigns c ON c.kind='announcement' AND c.source_id=a.id
  ORDER BY COALESCE(a.scheduled_at,a.published_at,a.updated_at) DESC,a.id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_announcement_deliveries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_announcement_deliveries() TO authenticated;

-- ---------------------------------------------------------------------------
-- F. Internal fan-out functions (service role and postgres only)
-- ---------------------------------------------------------------------------

-- The body of community_publish_announcement (20271020003720) with auth.uid()
-- replaced by p_actor, accepting a draft or a scheduled announcement. Same
-- audience (every accepted host), same channels, same idempotency keys, so a
-- scheduled announcement publishes exactly as Publish now does.
CREATE OR REPLACE FUNCTION public.issue_4383_publish_announcement_internal(p_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.community_announcements%ROWTYPE;
  v_campaign_id uuid;
  v_enqueued integer := 0;
  v_created_at timestamptz;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.community_announcements
  WHERE id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_row.status = 'archived' THEN
    RAISE EXCEPTION 'archived' USING ERRCODE = '22023';
  END IF;

  IF v_row.status = 'published' THEN
    SELECT id, created_at INTO v_campaign_id, v_created_at
    FROM public.community_notification_campaigns
    WHERE kind = 'announcement' AND source_id = p_id;

    RETURN jsonb_build_object(
      'campaign_id', v_campaign_id,
      'audience_count', 0,
      'created_at', v_created_at,
      'duplicate', true,
      'state', CASE WHEN v_campaign_id IS NULL THEN 'historical' ELSE 'queued' END
    );
  END IF;

  INSERT INTO public.community_notification_campaigns (
    kind, source_id, request_key, actor_user_id
  ) VALUES ('announcement', p_id, p_id, p_actor)
  RETURNING id, created_at INTO v_campaign_id, v_created_at;

  UPDATE public.community_announcements
  SET status = 'published', published_at = now(), updated_at = now(),
      scheduled_at = NULL, schedule_error = NULL, schedule_failed_at = NULL
  WHERE id = p_id;

  WITH hosts AS (
    SELECT DISTINCT btm.user_id
    FROM public.brand_team_members btm
    JOIN auth.users u ON u.id = btm.user_id
    WHERE btm.accepted_at IS NOT NULL
      AND btm.removed_at IS NULL
  ), inserted AS (
    -- Community events never expose an SMS channel. NULL is the deliberate
    -- country decision for the generic outbox contract (#1529).
    INSERT INTO public.notification_outbox AS o (
      category_key, user_id, country_code, payload, idempotency_key, status
    )
    SELECT
      'business.community_announcement',
      h.user_id,
      NULL,
      jsonb_build_object(
        'campaign_id', v_campaign_id,
        'announcement_id', p_id,
        'title', v_row.title,
        'body_md', v_row.body_md,
        'deep_link', 'mingla-business://community/announcement/' || p_id::text
      ),
      'business.community_announcement:' || p_id::text || ':' || h.user_id::text,
      'pending'
    FROM hosts h
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_enqueued FROM inserted;

  UPDATE public.community_notification_campaigns
  SET audience_count = v_enqueued
  WHERE id = v_campaign_id;

  INSERT INTO public.community_audit_log (
    actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    p_actor, 'publish_announcement', 'community_announcement', p_id,
    jsonb_build_object('campaign_id', v_campaign_id, 'enqueued', v_enqueued,
      'scheduled', v_row.status = 'scheduled')
  );

  RETURN jsonb_build_object(
    'campaign_id', v_campaign_id,
    'audience_count', v_enqueued,
    'created_at', v_created_at,
    'duplicate', false,
    'state', 'queued'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_publish_announcement_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4383_publish_announcement_internal(uuid, uuid) TO service_role;

-- Publish now: the admin gate, then the one publish path.
CREATE OR REPLACE FUNCTION public.community_publish_announcement(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4383_publish_announcement_internal(p_id, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.community_publish_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_publish_announcement(uuid) TO authenticated;

-- The body of community_notify_roadmap_change (20271020003720) with
-- auth.uid() replaced by p_actor. The 60-second rate limit and the
-- "no published roadmap" check are kept.
CREATE OR REPLACE FUNCTION public.issue_4383_notify_roadmap_internal(p_request_key uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campaign public.community_notification_campaigns%ROWTYPE;
  v_enqueued integer := 0;
  v_requeued integer := 0;
BEGIN
  IF p_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.community_roadmap_cards WHERE status = 'published'
  ) THEN
    RAISE EXCEPTION 'no_published_roadmap' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('roadmap:' || p_request_key::text, 3720));

  SELECT * INTO v_campaign
  FROM public.community_notification_campaigns
  WHERE kind = 'roadmap_update' AND request_key = p_request_key;
  IF FOUND THEN
    UPDATE public.notification_outbox
    SET status = 'retry_wait',
        attempts = 0,
        next_attempt_at = now(),
        processed_at = NULL,
        last_error = NULL
    WHERE payload->>'campaign_id' = v_campaign.id::text
      AND status = 'failed';
    GET DIAGNOSTICS v_requeued = ROW_COUNT;

    RETURN jsonb_build_object(
      'campaign_id', v_campaign.id,
      'audience_count', v_campaign.audience_count,
      'created_at', v_campaign.created_at,
      'duplicate', true,
      'requeued', v_requeued,
      'state', CASE WHEN v_requeued > 0 THEN 'processing' ELSE 'queued' END
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.community_notification_campaigns c
    WHERE c.kind = 'roadmap_update'
      AND c.created_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'roadmap_notify_rate_limited' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.community_notification_campaigns (
    kind, request_key, actor_user_id
  ) VALUES ('roadmap_update', p_request_key, p_actor)
  RETURNING * INTO v_campaign;

  WITH hosts AS (
    SELECT DISTINCT btm.user_id
    FROM public.brand_team_members btm
    JOIN auth.users u ON u.id = btm.user_id
    WHERE btm.accepted_at IS NOT NULL
      AND btm.removed_at IS NULL
  ), inserted AS (
    -- Roadmap notices are bell + push only; they have no phone-derived country.
    INSERT INTO public.notification_outbox AS o (
      category_key, user_id, country_code, payload, idempotency_key, status
    )
    SELECT
      'business.community_roadmap_updated',
      h.user_id,
      NULL,
      jsonb_build_object(
        'campaign_id', v_campaign.id,
        'title', 'Mingla roadmap updated',
        'body', 'See what’s new in Now, Next and Later.',
        'deep_link', 'mingla-business://community/roadmap'
      ),
      'business.community_roadmap_updated:' || v_campaign.id::text || ':' || h.user_id::text,
      'pending'
    FROM hosts h
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_enqueued FROM inserted;

  UPDATE public.community_notification_campaigns
  SET audience_count = v_enqueued
  WHERE id = v_campaign.id;

  INSERT INTO public.community_audit_log (
    actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    p_actor, 'notify_roadmap_change', 'community_notification_campaign',
    v_campaign.id,
    jsonb_build_object('campaign_id', v_campaign.id, 'enqueued', v_enqueued)
  );

  RETURN jsonb_build_object(
    'campaign_id', v_campaign.id,
    'audience_count', v_enqueued,
    'created_at', v_campaign.created_at,
    'duplicate', false,
    'state', 'queued'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_notify_roadmap_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4383_notify_roadmap_internal(uuid, uuid) TO service_role;

-- Notify now: the admin gate, then the one notify path.
CREATE OR REPLACE FUNCTION public.community_notify_roadmap_change(p_request_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4383_notify_roadmap_internal(p_request_key, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.community_notify_roadmap_change(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_notify_roadmap_change(uuid) TO authenticated;

-- Where a push opens. The one source of truth is
-- supabase/functions/_shared/adminPushDestinations.ts; these rows restate it
-- and a test (issue_4383_push_destinations.implementor.test.ts) asserts the
-- two agree. Only screens a person can see today: no mingla://connections
-- (the internal id of Chats) and no mingla-business://home (no route).
CREATE OR REPLACE FUNCTION public.issue_4383_push_deep_link(p_app text, p_target text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_app = 'explorer' AND p_target = 'explore' THEN 'mingla://home'
    WHEN p_app = 'explorer' AND p_target = 'discover' THEN 'mingla://discover'
    WHEN p_app = 'explorer' AND p_target = 'likes' THEN 'mingla://likes'
    WHEN p_app = 'host' AND p_target = 'community' THEN 'mingla-business://community'
    WHEN p_app = 'host' AND p_target = 'home' THEN 'mingla-business://(tabs)/home'
  END
$$;
REVOKE ALL ON FUNCTION public.issue_4383_push_deep_link(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_push_deep_link(text, text) TO authenticated, service_role;

-- Fan one push out into the outbox: one row per recipient per app. Hosts get
-- the Host app push; explorers (every Explorer account, D3) the Explorer one;
-- "both" sends each person each app they are in. The rows are PACED: a
-- broadcast takes at most 12 of the drain's 25 slots a minute, so order and
-- payout pushes are never held up behind it (spec F-13).
CREATE OR REPLACE FUNCTION public.issue_4383_fire_push_internal(p_push_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_push public.admin_push_campaigns%ROWTYPE;
  v_campaign public.community_notification_campaigns%ROWTYPE;
  v_base timestamptz;
  v_used integer;
  v_enqueued integer := 0;
  v_host_link text;
  v_explorer_link text;
BEGIN
  SELECT * INTO v_push FROM public.admin_push_campaigns WHERE id = p_push_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;

  -- Fire once (I-4383-FIRE-ONCE): one campaign per push, unique (kind, request_key).
  SELECT * INTO v_campaign
  FROM public.community_notification_campaigns
  WHERE kind = 'admin_push' AND request_key = p_push_id;
  IF FOUND THEN
    RETURN jsonb_build_object('campaign_id', v_campaign.id, 'audience_count', v_campaign.audience_count, 'duplicate', true);
  END IF;

  v_host_link := public.issue_4383_push_deep_link('host', v_push.host_target);
  v_explorer_link := public.issue_4383_push_deep_link('explorer', v_push.explorer_target);
  IF (v_push.audience IN ('hosts', 'both') AND v_host_link IS NULL)
    OR (v_push.audience IN ('explorers', 'both') AND v_explorer_link IS NULL) THEN
    RAISE EXCEPTION 'invalid_destination' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.community_notification_campaigns (kind, source_id, request_key, actor_user_id)
  VALUES ('admin_push', p_push_id, p_push_id, COALESCE(v_push.updated_by, v_push.created_by))
  RETURNING * INTO v_campaign;

  -- One shared pace across every Admin push (and retry): see issue_4383_push_pacing_start.
  SELECT p.base, p.used INTO v_base, v_used FROM public.issue_4383_push_pacing_start() p;

  WITH recipients AS (
    SELECT DISTINCT btm.user_id, 'business.mingla_update'::text AS category_key, v_host_link AS deep_link
    FROM public.brand_team_members btm
    JOIN auth.users u ON u.id = btm.user_id
    WHERE v_push.audience IN ('hosts', 'both')
      AND btm.accepted_at IS NOT NULL
      AND btm.removed_at IS NULL
    UNION
    SELECT p.id, 'mingla_updates'::text, v_explorer_link
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE v_push.audience IN ('explorers', 'both')
  ), paced AS (
    SELECT r.*, row_number() OVER (ORDER BY r.category_key, r.user_id) - 1 AS n
    FROM recipients r
  ), inserted AS (
    INSERT INTO public.notification_outbox AS o (
      category_key, user_id, country_code, payload, idempotency_key, status, next_attempt_at
    )
    SELECT
      p.category_key,
      p.user_id,
      NULL,
      jsonb_build_object(
        'campaign_id', v_campaign.id,
        'push_id', p_push_id,
        'title', btrim(v_push.title),
        'body', btrim(v_push.body),
        'deep_link', p.deep_link
      ),
      p.category_key || ':' || p_push_id::text || ':' || p.user_id::text,
      -- retry_wait + next_attempt_at is the drain's own deferral path
      -- (claim_notification_outbox); the status reads it as pending.
      'retry_wait',
      v_base + ((v_used + p.n) / 12) * interval '1 minute'
    FROM paced p
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_enqueued FROM inserted;

  UPDATE public.community_notification_campaigns SET audience_count = v_enqueued WHERE id = v_campaign.id;

  RETURN jsonb_build_object('campaign_id', v_campaign.id, 'audience_count', v_enqueued, 'duplicate', false);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_fire_push_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4383_fire_push_internal(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- G. The due-runner (every minute)
-- ---------------------------------------------------------------------------
-- Each due item is locked (FOR UPDATE SKIP LOCKED: a second runner skips it),
-- moved out of 'scheduled' in the same transaction it fires in, and runs in
-- its own sub-block: an error marks that item failed with a bounded reason and
-- the runner moves on (rule 3). Nothing fires before its saved instant.
CREATE OR REPLACE FUNCTION public.issue_4383_fire_due_communications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v jsonb;
  v_err text;
  v_push_sent integer := 0;
  v_push_failed integer := 0;
  v_ann_sent integer := 0;
  v_ann_failed integer := 0;
  v_cards integer := 0;
  v_cards_failed integer := 0;
  v_notice_sent integer := 0;
  v_notice_failed integer := 0;
  v_notice_waiting integer := 0;
BEGIN
  -- Pushes.
  FOR r IN
    SELECT id FROM public.admin_push_campaigns
    WHERE status = 'scheduled' AND scheduled_for <= now()
    ORDER BY scheduled_for, id
    LIMIT 20
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      UPDATE public.admin_push_campaigns SET status = 'sending', updated_at = now() WHERE id = r.id AND status = 'scheduled';
      v := public.issue_4383_fire_push_internal(r.id);
      UPDATE public.admin_push_campaigns
      SET status = 'sent', campaign_id = (v->>'campaign_id')::uuid,
          audience_count = (v->>'audience_count')::integer, fired_at = now(), updated_at = now(), last_error = NULL
      WHERE id = r.id;
      INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (NULL, 'fire_scheduled_push', 'admin_push_campaign', r.id, v);
      v_push_sent := v_push_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      v_err := left(SQLERRM, 300);
      UPDATE public.admin_push_campaigns SET status = 'failed', last_error = v_err, updated_at = now() WHERE id = r.id;
      INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (NULL, 'fail_scheduled_push', 'admin_push_campaign', r.id, jsonb_build_object('error', v_err));
      v_push_failed := v_push_failed + 1;
    END;
  END LOOP;

  -- Announcements: the same publish path as Publish now. A failure goes back
  -- to draft with its reason, so it is never retried silently every minute.
  FOR r IN
    SELECT id, COALESCE(scheduled_by, author_user_id) AS actor FROM public.community_announcements
    WHERE status = 'scheduled' AND scheduled_at <= now()
    ORDER BY scheduled_at, id
    LIMIT 20
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v := public.issue_4383_publish_announcement_internal(r.id, r.actor);
      v_ann_sent := v_ann_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      v_err := left(SQLERRM, 300);
      UPDATE public.community_announcements
      SET status = 'draft', scheduled_at = NULL, schedule_error = v_err, schedule_failed_at = now(), updated_at = now()
      WHERE id = r.id;
      INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (NULL, 'fail_scheduled_announcement', 'community_announcement', r.id, jsonb_build_object('error', v_err));
      v_ann_failed := v_ann_failed + 1;
    END;
  END LOOP;

  -- Roadmap cards going live (before the notices, so a notice due the same
  -- minute sees the card published).
  FOR r IN
    SELECT id FROM public.community_roadmap_cards
    WHERE status = 'draft' AND go_live_at IS NOT NULL AND go_live_at <= now()
    ORDER BY go_live_at, id
    LIMIT 20
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      UPDATE public.community_roadmap_cards
      SET status = 'published', go_live_at = NULL, go_live_timezone = NULL, updated_at = now()
      WHERE id = r.id;
      INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (NULL, 'roadmap_card_go_live', 'community_roadmap_card', r.id, '{}'::jsonb);
      v_cards := v_cards + 1;
    EXCEPTION WHEN OTHERS THEN
      -- The card stays a draft and its time is cleared, so it is not retried
      -- every minute; the failure is listed under Needs attention.
      v_err := left(SQLERRM, 300);
      UPDATE public.community_roadmap_cards SET go_live_at = NULL, go_live_timezone = NULL WHERE id = r.id;
      INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (NULL, 'fail_roadmap_card_go_live', 'community_roadmap_card', r.id, jsonb_build_object('error', v_err));
      v_cards_failed := v_cards_failed + 1;
    END;
  END LOOP;

  -- Roadmap notices. The 60-second rate limit leaves a notice scheduled; it
  -- fires on a later minute.
  FOR r IN
    SELECT id, request_key, created_by FROM public.community_roadmap_notices_scheduled
    WHERE status = 'scheduled' AND scheduled_for <= now()
    ORDER BY scheduled_for, id
    LIMIT 20
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v := public.issue_4383_notify_roadmap_internal(r.request_key, r.created_by);
      UPDATE public.community_roadmap_notices_scheduled
      SET status = 'sent', campaign_id = (v->>'campaign_id')::uuid, fired_at = now(), updated_at = now(), last_error = NULL
      WHERE id = r.id;
      v_notice_sent := v_notice_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      v_err := left(SQLERRM, 300);
      IF v_err = 'roadmap_notify_rate_limited' THEN
        v_notice_waiting := v_notice_waiting + 1;
      ELSE
        UPDATE public.community_roadmap_notices_scheduled
        SET status = 'failed', last_error = v_err, updated_at = now()
        WHERE id = r.id;
        INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
        VALUES (NULL, 'fail_scheduled_roadmap_notice', 'community_roadmap_notice', r.id, jsonb_build_object('error', v_err));
        v_notice_failed := v_notice_failed + 1;
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'pushes_sent', v_push_sent, 'pushes_failed', v_push_failed,
    'announcements_published', v_ann_sent, 'announcements_failed', v_ann_failed,
    'roadmap_cards_live', v_cards, 'roadmap_cards_failed', v_cards_failed,
    'roadmap_notices_sent', v_notice_sent, 'roadmap_notices_failed', v_notice_failed,
    'roadmap_notices_waiting', v_notice_waiting
  );
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_fire_due_communications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4383_fire_due_communications() TO service_role;

-- ---------------------------------------------------------------------------
-- H. Admin RPCs
-- ---------------------------------------------------------------------------

-- A time to schedule for: a real IANA zone, and at least a minute from now
-- (the client already checked the instant it built in that zone; this is the
-- server's own check, I-4383-NO-EARLY-SEND).
CREATE OR REPLACE FUNCTION public.issue_4383_check_schedule(p_at timestamptz, p_timezone text)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = '22023';
  END IF;
  IF p_at IS NULL OR p_at <= now() + interval '1 minute' THEN
    RAISE EXCEPTION 'scheduled_time_past' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_check_schedule(timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_check_schedule(timestamptz, text) TO authenticated, service_role;

-- Who a teammate is on screen: their profile name, else their email's name.
CREATE OR REPLACE FUNCTION public.issue_4383_person_label(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(btrim((SELECT p.display_name FROM public.profiles p WHERE p.id = p_user_id)), ''),
    NULLIF(split_part((SELECT u.email FROM auth.users u WHERE u.id = p_user_id), '@', 1), '')
  )
$$;
REVOKE ALL ON FUNCTION public.issue_4383_person_label(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4383_person_label(uuid) TO service_role;

-- Who last gave a roadmap card its go-live time (from the audit log).
CREATE OR REPLACE FUNCTION public.issue_4383_roadmap_card_scheduler(p_card_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.issue_4383_person_label(l.actor_user_id)
  FROM public.community_audit_log l
  WHERE l.entity_type = 'community_roadmap_card' AND l.entity_id = p_card_id AND l.action = 'schedule_roadmap_card'
  ORDER BY l.created_at DESC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.issue_4383_roadmap_card_scheduler(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4383_roadmap_card_scheduler(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4383_push_row(p public.admin_push_campaigns)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'title', p.title, 'body', p.body, 'audience', p.audience,
    'explorer_target', p.explorer_target, 'host_target', p.host_target,
    'status', p.status, 'scheduled_for', p.scheduled_for, 'timezone', p.timezone,
    'campaign_id', p.campaign_id, 'audience_count', p.audience_count,
    'fired_at', p.fired_at, 'cancelled_at', p.cancelled_at, 'last_error', p.last_error,
    'created_at', p.created_at, 'updated_at', p.updated_at, 'revision', p.revision,
    'created_by_name', public.issue_4383_person_label(COALESCE(p.updated_by, p.created_by))
  )
$$;
REVOKE ALL ON FUNCTION public.issue_4383_push_row(public.admin_push_campaigns) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4383_push_row(public.admin_push_campaigns) TO service_role;

-- Live counts for the composer: hosts, explorers and the distinct people in both.
CREATE OR REPLACE FUNCTION public.issue_4383_push_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hosts integer;
  v_explorers integer;
  v_people integer;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT count(DISTINCT btm.user_id)::integer INTO v_hosts
  FROM public.brand_team_members btm JOIN auth.users u ON u.id = btm.user_id
  WHERE btm.accepted_at IS NOT NULL AND btm.removed_at IS NULL;
  SELECT count(*)::integer INTO v_explorers
  FROM public.profiles p JOIN auth.users u ON u.id = p.id;
  SELECT count(*)::integer INTO v_people FROM (
    SELECT btm.user_id FROM public.brand_team_members btm JOIN auth.users u ON u.id = btm.user_id
    WHERE btm.accepted_at IS NOT NULL AND btm.removed_at IS NULL
    UNION
    SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id = p.id
  ) people;
  RETURN jsonb_build_object('hosts', v_hosts, 'explorers', v_explorers, 'both', v_people);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_push_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_push_preview() TO authenticated;

-- Create or edit a draft or scheduled push. A time makes it scheduled; no
-- time makes it a draft. An edit names the revision it read: a stale one is
-- refused with PT409 so two people never overwrite each other.
CREATE OR REPLACE FUNCTION public.issue_4383_push_save(
  p_id uuid,
  p_title text,
  p_body text,
  p_audience text,
  p_explorer_target text,
  p_host_target text,
  p_scheduled_for timestamptz,
  p_timezone text,
  p_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.admin_push_campaigns%ROWTYPE;
  v_title text := btrim(COALESCE(p_title, ''));
  v_body text := btrim(COALESCE(p_body, ''));
  v_zone text := COALESCE(NULLIF(btrim(COALESCE(p_timezone, '')), ''), 'UTC');
  v_status text;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_title) NOT BETWEEN 1 AND 65 THEN RAISE EXCEPTION 'invalid_title' USING ERRCODE = '22023'; END IF;
  IF char_length(v_body) NOT BETWEEN 1 AND 178 THEN RAISE EXCEPTION 'invalid_body' USING ERRCODE = '22023'; END IF;
  IF p_audience IS NULL OR p_audience NOT IN ('hosts', 'explorers', 'both') THEN RAISE EXCEPTION 'invalid_audience' USING ERRCODE = '22023'; END IF;
  IF public.issue_4383_push_deep_link('explorer', COALESCE(p_explorer_target, 'explore')) IS NULL
    OR public.issue_4383_push_deep_link('host', COALESCE(p_host_target, 'community')) IS NULL THEN
    RAISE EXCEPTION 'invalid_destination' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_zone) THEN
    RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = '22023';
  END IF;
  IF p_scheduled_for IS NOT NULL THEN
    PERFORM public.issue_4383_check_schedule(p_scheduled_for, v_zone);
  END IF;
  v_status := CASE WHEN p_scheduled_for IS NULL THEN 'draft' ELSE 'scheduled' END;

  IF p_id IS NULL THEN
    INSERT INTO public.admin_push_campaigns (
      title, body, audience, explorer_target, host_target, status, scheduled_for, timezone, created_by, updated_by
    ) VALUES (
      v_title, v_body, p_audience, COALESCE(p_explorer_target, 'explore'), COALESCE(p_host_target, 'community'),
      v_status, p_scheduled_for, v_zone, auth.uid(), auth.uid()
    ) RETURNING * INTO v_row;
  ELSE
    SELECT * INTO v_row FROM public.admin_push_campaigns WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    IF v_row.status NOT IN ('draft', 'scheduled') THEN RAISE EXCEPTION 'already_sending' USING ERRCODE = 'PT409'; END IF;
    IF p_revision IS NULL OR v_row.revision <> p_revision THEN RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409'; END IF;
    UPDATE public.admin_push_campaigns
    SET title = v_title, body = v_body, audience = p_audience,
        explorer_target = COALESCE(p_explorer_target, 'explore'), host_target = COALESCE(p_host_target, 'community'),
        status = v_status, scheduled_for = p_scheduled_for, timezone = v_zone,
        updated_by = auth.uid(), updated_at = now(), revision = revision + 1, last_error = NULL
    WHERE id = p_id
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), CASE WHEN p_id IS NULL THEN 'create_push' ELSE 'update_push' END, 'admin_push_campaign', v_row.id,
    jsonb_build_object('status', v_row.status, 'audience', v_row.audience, 'scheduled_for', v_row.scheduled_for));
  RETURN public.issue_4383_push_row(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_push_save(uuid, text, text, text, text, text, timestamptz, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_push_save(uuid, text, text, text, text, text, timestamptz, text, integer) TO authenticated;

-- Send a saved push now. 60 seconds between Admin pushes.
CREATE OR REPLACE FUNCTION public.issue_4383_push_send_now(p_id uuid, p_revision integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.admin_push_campaigns%ROWTYPE;
  v jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.admin_push_campaigns WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_row.status NOT IN ('draft', 'scheduled') THEN RAISE EXCEPTION 'already_sending' USING ERRCODE = 'PT409'; END IF;
  IF p_revision IS NULL OR v_row.revision <> p_revision THEN RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_4383_push_send_now', 4383));
  IF EXISTS (SELECT 1 FROM public.admin_push_campaigns WHERE fired_at > now() - interval '60 seconds') THEN
    RAISE EXCEPTION 'push_rate_limited' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.admin_push_campaigns SET status = 'sending', updated_by = auth.uid(), updated_at = now() WHERE id = p_id;
  v := public.issue_4383_fire_push_internal(p_id);
  UPDATE public.admin_push_campaigns
  SET status = 'sent', campaign_id = (v->>'campaign_id')::uuid, audience_count = (v->>'audience_count')::integer,
      fired_at = now(), updated_at = now(), revision = revision + 1, last_error = NULL
  WHERE id = p_id
  RETURNING * INTO v_row;
  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'send_push', 'admin_push_campaign', p_id, v);
  RETURN public.issue_4383_push_row(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_push_send_now(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_push_send_now(uuid, integer) TO authenticated;

-- Cancel a scheduled push. Once the runner has it, nothing changes: PT409.
CREATE OR REPLACE FUNCTION public.issue_4383_push_cancel(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.admin_push_campaigns%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.admin_push_campaigns
  SET status = 'cancelled', cancelled_at = now(), updated_by = auth.uid(), updated_at = now(), revision = revision + 1
  WHERE id = p_id AND status = 'scheduled'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.admin_push_campaigns WHERE id = p_id) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'already_sending' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'cancel_push', 'admin_push_campaign', p_id, '{}'::jsonb);
  RETURN public.issue_4383_push_row(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_push_cancel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_push_cancel(uuid) TO authenticated;

-- Send a saved push to the signed-in admin only, in each app it targets. One
-- test a minute (the idempotency key holds the minute).
CREATE OR REPLACE FUNCTION public.issue_4383_push_test_to_me(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.admin_push_campaigns%ROWTYPE;
  v_uid uuid := auth.uid();
  v_bucket text := to_char(date_trunc('minute', now()) AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI');
  v_count integer := 0;
BEGIN
  IF NOT public.is_admin_user() OR v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.admin_push_campaigns WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;

  WITH apps AS (
    SELECT 'business.mingla_update'::text AS category_key, public.issue_4383_push_deep_link('host', v_row.host_target) AS deep_link
    WHERE v_row.audience IN ('hosts', 'both')
    UNION ALL
    SELECT 'mingla_updates'::text, public.issue_4383_push_deep_link('explorer', v_row.explorer_target)
    WHERE v_row.audience IN ('explorers', 'both')
  ), inserted AS (
    INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
    SELECT a.category_key, v_uid, NULL,
      jsonb_build_object('push_id', p_id, 'test', true, 'title', btrim(v_row.title), 'body', btrim(v_row.body), 'deep_link', a.deep_link),
      'test:' || a.category_key || ':' || p_id::text || ':' || v_uid::text || ':' || v_bucket,
      'pending'
    FROM apps a
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM inserted;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'test_rate_limited' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('queued', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_push_test_to_me(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_push_test_to_me(uuid) TO authenticated;

-- The Push screen's lists: scheduled soonest first, then the latest 100 others
-- with their delivery counts.
CREATE OR REPLACE FUNCTION public.issue_4383_push_list()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(item ORDER BY ord, sort_at DESC NULLS LAST, id), '[]'::jsonb) INTO v
  FROM (
    SELECT p.id,
      CASE WHEN p.status = 'scheduled' THEN 0 ELSE 1 END AS ord,
      CASE WHEN p.status = 'scheduled' THEN -extract(epoch FROM p.scheduled_for) ELSE extract(epoch FROM COALESCE(p.fired_at, p.updated_at)) END AS sort_at,
      public.issue_4383_push_row(p) || jsonb_build_object(
        'delivery', CASE WHEN p.campaign_id IS NULL THEN NULL ELSE public.community_get_announcement_notification_status(p.campaign_id) END
      ) AS item
    FROM public.admin_push_campaigns p
    WHERE p.status IN ('draft', 'scheduled', 'sending')
      OR p.id IN (SELECT q.id FROM public.admin_push_campaigns q WHERE q.status IN ('sent', 'failed', 'cancelled') ORDER BY COALESCE(q.fired_at, q.updated_at) DESC LIMIT 100)
  ) rows;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_push_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_push_list() TO authenticated;

-- Announcements: schedule (or move the time) and unschedule.
CREATE OR REPLACE FUNCTION public.issue_4383_announcement_schedule(p_id uuid, p_scheduled_for timestamptz, p_timezone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.issue_4383_check_schedule(p_scheduled_for, p_timezone);
  SELECT status INTO v_status FROM public.community_announcements WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_status = 'published' THEN RAISE EXCEPTION 'already_published' USING ERRCODE = 'PT409'; END IF;
  IF v_status NOT IN ('draft', 'scheduled') THEN RAISE EXCEPTION 'not_schedulable' USING ERRCODE = '22023'; END IF;
  UPDATE public.community_announcements
  SET status = 'scheduled', scheduled_at = p_scheduled_for, scheduled_timezone = p_timezone,
      scheduled_by = auth.uid(), schedule_error = NULL, schedule_failed_at = NULL, updated_at = now()
  WHERE id = p_id;
  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'schedule_announcement', 'community_announcement', p_id,
    jsonb_build_object('scheduled_for', p_scheduled_for, 'timezone', p_timezone));
  RETURN jsonb_build_object('id', p_id, 'status', 'scheduled', 'scheduled_at', p_scheduled_for, 'scheduled_timezone', p_timezone);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_announcement_schedule(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_announcement_schedule(uuid, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_4383_announcement_unschedule(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.community_announcements
  SET status = 'draft', scheduled_at = NULL, scheduled_timezone = NULL, updated_at = now()
  WHERE id = p_id AND status = 'scheduled';
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.community_announcements WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    RAISE EXCEPTION 'already_published' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'unschedule_announcement', 'community_announcement', p_id, '{}'::jsonb);
  RETURN jsonb_build_object('id', p_id, 'status', 'draft');
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_announcement_unschedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_announcement_unschedule(uuid) TO authenticated;

-- Roadmap: a draft card's go-live time, and scheduled notices.
CREATE OR REPLACE FUNCTION public.issue_4383_roadmap_schedule_card(p_card_id uuid, p_go_live_at timestamptz, p_timezone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.issue_4383_check_schedule(p_go_live_at, p_timezone);
  SELECT status INTO v_status FROM public.community_roadmap_cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_status = 'published' THEN RAISE EXCEPTION 'already_published' USING ERRCODE = 'PT409'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'not_schedulable' USING ERRCODE = '22023'; END IF;
  UPDATE public.community_roadmap_cards
  SET go_live_at = p_go_live_at, go_live_timezone = p_timezone, updated_at = now()
  WHERE id = p_card_id;
  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'schedule_roadmap_card', 'community_roadmap_card', p_card_id,
    jsonb_build_object('go_live_at', p_go_live_at, 'timezone', p_timezone));
  RETURN jsonb_build_object('id', p_card_id, 'go_live_at', p_go_live_at, 'go_live_timezone', p_timezone);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_roadmap_schedule_card(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_roadmap_schedule_card(uuid, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_4383_roadmap_unschedule_card(p_card_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.community_roadmap_cards
  SET go_live_at = NULL, go_live_timezone = NULL, updated_at = now()
  WHERE id = p_card_id AND status = 'draft' AND go_live_at IS NOT NULL;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.community_roadmap_cards WHERE id = p_card_id) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'already_published' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'unschedule_roadmap_card', 'community_roadmap_card', p_card_id, '{}'::jsonb);
  RETURN jsonb_build_object('id', p_card_id, 'go_live_at', NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_roadmap_unschedule_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_roadmap_unschedule_card(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_4383_roadmap_schedule_notice(p_scheduled_for timestamptz, p_timezone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.community_roadmap_notices_scheduled%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.issue_4383_check_schedule(p_scheduled_for, p_timezone);
  INSERT INTO public.community_roadmap_notices_scheduled (scheduled_for, timezone, created_by)
  VALUES (p_scheduled_for, p_timezone, auth.uid())
  RETURNING * INTO v_row;
  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'schedule_roadmap_notice', 'community_roadmap_notice', v_row.id,
    jsonb_build_object('scheduled_for', p_scheduled_for, 'timezone', p_timezone));
  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status, 'scheduled_for', v_row.scheduled_for, 'timezone', v_row.timezone);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_roadmap_schedule_notice(timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_roadmap_schedule_notice(timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_4383_roadmap_cancel_notice(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.community_roadmap_notices_scheduled
  SET status = 'cancelled', cancelled_at = now(), updated_at = now()
  WHERE id = p_id AND status = 'scheduled';
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.community_roadmap_notices_scheduled WHERE id = p_id) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'already_sent' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'cancel_roadmap_notice', 'community_roadmap_notice', p_id, '{}'::jsonb);
  RETURN jsonb_build_object('id', p_id, 'status', 'cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_roadmap_cancel_notice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_roadmap_cancel_notice(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_4383_roadmap_scheduled_list()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'cards', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'public_title', c.public_title, 'lane', c.lane,
        'go_live_at', c.go_live_at, 'go_live_timezone', c.go_live_timezone,
        'by', public.issue_4383_roadmap_card_scheduler(c.id)
      ) ORDER BY c.go_live_at, c.id)
      FROM public.community_roadmap_cards c
      WHERE c.status = 'draft' AND c.go_live_at IS NOT NULL
    ), '[]'::jsonb),
    'notices', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'status', n.status, 'scheduled_for', n.scheduled_for, 'timezone', n.timezone,
        'campaign_id', n.campaign_id, 'last_error', n.last_error, 'fired_at', n.fired_at,
        'by', public.issue_4383_person_label(n.created_by)
      ) ORDER BY n.scheduled_for, n.id)
      FROM public.community_roadmap_notices_scheduled n
      WHERE n.status IN ('scheduled', 'failed')
        OR (n.status = 'sent' AND n.fired_at > now() - interval '14 days')
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_roadmap_scheduled_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_roadmap_scheduled_list() TO authenticated;

-- Email: every scheduled email, for every teammate who writes email (#4255
-- D5). No bodies and no recipient emails; "counted" is when the audience was
-- frozen (D8: the campaign's created_at).
CREATE OR REPLACE FUNCTION public.issue_4383_email_scheduled_list()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.is_admin_user() OR public.issue_4255_is_active_teammate()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', l.id, 'subject', l.subject, 'scheduled_for', l.scheduled_for, 'timezone', l.timezone,
      'audience', CASE WHEN jsonb_typeof(l.audience) = 'object' THEN l.audience - 'email' ELSE NULL END,
      'recipient_type', l.recipient_type,
      'recipient_count', l.recipient_count, 'skipped_count', l.skipped_count,
      'sent_by_name', public.issue_4383_person_label(l.sent_by),
      'created_at', l.created_at,
      'can_change', l.processing_started_at IS NULL
    ) ORDER BY l.scheduled_for, l.id)
    FROM public.admin_email_log l
    WHERE l.status = 'scheduled'
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_email_scheduled_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_email_scheduled_list() TO authenticated;

-- Overview: one list across kinds, each person seeing only the kinds they can
-- already open (pushes, announcements and roadmap for admins; email for every
-- teammate; blog for blog writers). It only reads: each item's time lives on
-- its own row (I-4383-SCHEDULE-ONE-OWNER).
CREATE OR REPLACE FUNCTION public.issue_4383_scheduled_communications()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin boolean := public.is_admin_user();
  v_team boolean := v_admin OR public.issue_4255_is_active_teammate();
  v_blog boolean := v_admin OR public.issue_4137_blog_can_write(auth.uid());
  v jsonb;
BEGIN
  IF NOT (v_admin OR v_team OR v_blog) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(i ORDER BY (i->>'scheduled_for')::timestamptz, i->>'id'), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object('kind', 'push', 'id', p.id, 'title', p.title, 'scheduled_for', p.scheduled_for,
      'timezone', p.timezone, 'status', p.status, 'href', '#/push', 'by', public.issue_4383_person_label(COALESCE(p.updated_by, p.created_by)),
      'audience', p.audience, 'can_cancel', true) AS i
    FROM public.admin_push_campaigns p WHERE v_admin AND p.status = 'scheduled'
    UNION ALL
    SELECT jsonb_build_object('kind', 'announcement', 'id', a.id, 'title', a.title, 'scheduled_for', a.scheduled_at,
      'timezone', COALESCE(a.scheduled_timezone, 'UTC'), 'status', a.status, 'href', '#/announcements',
      'by', public.issue_4383_person_label(COALESCE(a.scheduled_by, a.author_user_id)), 'can_cancel', true)
    FROM public.community_announcements a WHERE v_admin AND a.status = 'scheduled'
    UNION ALL
    SELECT jsonb_build_object('kind', 'roadmap_card', 'id', c.id, 'title', c.public_title, 'scheduled_for', c.go_live_at,
      'timezone', COALESCE(c.go_live_timezone, 'UTC'), 'status', 'scheduled', 'href', '#/roadmap?card=' || c.id::text,
      'by', public.issue_4383_roadmap_card_scheduler(c.id), 'can_cancel', true)
    FROM public.community_roadmap_cards c WHERE v_admin AND c.status = 'draft' AND c.go_live_at IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('kind', 'roadmap_notice', 'id', n.id, 'title', 'Tell hosts the roadmap changed', 'scheduled_for', n.scheduled_for,
      'timezone', n.timezone, 'status', n.status, 'href', '#/roadmap',
      'by', public.issue_4383_person_label(n.created_by), 'can_cancel', true)
    FROM public.community_roadmap_notices_scheduled n WHERE v_admin AND n.status = 'scheduled'
    UNION ALL
    SELECT jsonb_build_object('kind', 'email', 'id', l.id, 'title', l.subject, 'scheduled_for', l.scheduled_for,
      'timezone', l.timezone, 'status', l.status, 'href', '#/email?view=scheduled',
      'by', public.issue_4383_person_label(l.sent_by), 'can_cancel', l.processing_started_at IS NULL)
    FROM public.admin_email_log l WHERE v_team AND l.status = 'scheduled' AND l.scheduled_for IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('kind', 'blog', 'id', b.id, 'title', d.title, 'scheduled_for', b.publish_at,
      'timezone', 'UTC', 'status', 'scheduled', 'href', '#/blog?view=editor&post=' || b.id::text,
      'by', NULL, 'can_cancel', false)
    FROM public.blog_posts b JOIN public.blog_post_versions d ON d.id = b.draft_version_id
    WHERE v_blog AND b.deleted_at IS NULL AND b.status = 'published' AND b.publish_at > now()
  ) items;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_scheduled_communications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_scheduled_communications() TO authenticated;

-- Needs attention (admins): failed items, items whose time passed more than
-- five minutes ago without going out ("late": the runner is down), and sent
-- pushes in the last 7 days with failed phone pushes (retryable).
CREATE OR REPLACE FUNCTION public.issue_4383_communications_failures()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(i ORDER BY (i->>'at')::timestamptz DESC NULLS LAST, i->>'id'), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object('kind', 'push', 'id', p.id, 'title', p.title, 'problem', 'failed',
      'detail', p.last_error, 'at', p.updated_at, 'timezone', p.timezone, 'href', '#/push') AS i
    FROM public.admin_push_campaigns p WHERE p.status = 'failed' AND p.updated_at > now() - interval '30 days'
    UNION ALL
    SELECT jsonb_build_object('kind', 'push', 'id', p.id, 'title', p.title, 'problem', 'late',
      'detail', NULL, 'at', p.scheduled_for, 'timezone', p.timezone, 'href', '#/push')
    FROM public.admin_push_campaigns p WHERE p.status = 'scheduled' AND p.scheduled_for < now() - interval '5 minutes'
    UNION ALL
    SELECT jsonb_build_object('kind', 'push', 'id', p.id, 'title', p.title, 'problem', 'push_failed',
      'detail', s.status->'channels', 'at', p.fired_at, 'timezone', p.timezone, 'href', '#/push', 'campaign_id', p.campaign_id)
    FROM public.admin_push_campaigns p
    CROSS JOIN LATERAL (SELECT public.community_get_announcement_notification_status(p.campaign_id) AS status) s
    WHERE p.status = 'sent' AND p.campaign_id IS NOT NULL AND p.fired_at > now() - interval '7 days'
      AND COALESCE((s.status->'channels'->>'push_failed')::integer, 0) > 0
    UNION ALL
    SELECT jsonb_build_object('kind', 'announcement', 'id', a.id, 'title', a.title, 'problem', 'failed',
      'detail', a.schedule_error, 'at', a.schedule_failed_at, 'timezone', a.scheduled_timezone, 'href', '#/announcements')
    FROM public.community_announcements a WHERE a.status = 'draft' AND a.schedule_failed_at IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('kind', 'announcement', 'id', a.id, 'title', a.title, 'problem', 'late',
      'detail', NULL, 'at', a.scheduled_at, 'timezone', a.scheduled_timezone, 'href', '#/announcements')
    FROM public.community_announcements a WHERE a.status = 'scheduled' AND a.scheduled_at < now() - interval '5 minutes'
    UNION ALL
    SELECT jsonb_build_object('kind', 'roadmap_card', 'id', c.id, 'title', c.public_title, 'problem', 'failed',
      'detail', last_event.metadata->>'error', 'at', last_event.created_at, 'timezone', 'UTC', 'href', '#/roadmap?card=' || c.id::text)
    FROM public.community_roadmap_cards c
    CROSS JOIN LATERAL (
      SELECT l.action, l.metadata, l.created_at FROM public.community_audit_log l
      WHERE l.entity_type = 'community_roadmap_card' AND l.entity_id = c.id
        AND l.action IN ('schedule_roadmap_card', 'roadmap_card_go_live', 'fail_roadmap_card_go_live')
      ORDER BY l.created_at DESC LIMIT 1
    ) last_event
    WHERE c.status = 'draft' AND c.go_live_at IS NULL
      AND last_event.action = 'fail_roadmap_card_go_live' AND last_event.created_at > now() - interval '30 days'
    UNION ALL
    SELECT jsonb_build_object('kind', 'roadmap_card', 'id', c.id, 'title', c.public_title, 'problem', 'late',
      'detail', NULL, 'at', c.go_live_at, 'timezone', c.go_live_timezone, 'href', '#/roadmap?card=' || c.id::text)
    FROM public.community_roadmap_cards c WHERE c.status = 'draft' AND c.go_live_at < now() - interval '5 minutes'
    UNION ALL
    SELECT jsonb_build_object('kind', 'roadmap_notice', 'id', n.id, 'title', 'Tell hosts the roadmap changed',
      'problem', CASE WHEN n.status = 'failed' THEN 'failed' ELSE 'late' END,
      'detail', n.last_error, 'at', COALESCE(n.updated_at, n.scheduled_for), 'timezone', n.timezone, 'href', '#/roadmap')
    FROM public.community_roadmap_notices_scheduled n
    WHERE (n.status = 'failed' AND n.updated_at > now() - interval '30 days')
      OR (n.status = 'scheduled' AND n.scheduled_for < now() - interval '5 minutes')
    UNION ALL
    SELECT jsonb_build_object('kind', 'email', 'id', l.id, 'title', l.subject, 'problem', 'late',
      'detail', NULL, 'at', l.scheduled_for, 'timezone', l.timezone, 'href', '#/email?view=scheduled')
    FROM public.admin_email_log l WHERE l.status = 'scheduled' AND l.scheduled_for < now() - interval '5 minutes'
  ) items;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4383_communications_failures() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4383_communications_failures() TO authenticated;

-- ---------------------------------------------------------------------------
-- I. Cron: pure SQL, no net.http, no vault. (A local replayed stack runs it
-- too, like every other job; turn local cron off.)
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Issue #4383: pg_cron unavailable; issue_4383_communications_due not scheduled.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_4383_communications_due') THEN
    PERFORM cron.unschedule('issue_4383_communications_due');
  END IF;
  PERFORM cron.schedule('issue_4383_communications_due', '* * * * *',
    $job$SELECT public.issue_4383_fire_due_communications();$job$);
END
$cron$;

COMMIT;
