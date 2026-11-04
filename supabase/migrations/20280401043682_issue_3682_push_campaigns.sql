-- #3682 closeout wave 2 (B) — push as a campaign channel; push, email and SMS
-- together in one campaign (Seth, 2026-09-30).
--
-- Shape: a campaign stays one row per channel (every sealed email/SMS path is
-- unchanged); a multi-channel campaign is the set of rows that share
-- campaign_group_id. Existing campaigns are backfilled with their own id, so
-- each stays a single-channel campaign. The rolling-week blast warning counts
-- a group once, whatever its channels.
--
-- Push: free and unlimited by default (an admin push limit, when set, still
-- applies through biz_assert_brand_blast_allowance_v1). Audiences: Followers,
-- Friends of followers (when switched on) and Book people who have a Mingla
-- account. Every recipient is re-decided at confirm and again at send: still
-- following (Unfollow stops everything), not muted, the follower's own push
-- switch for this brand, circle exits, blocks and can_send. Email unsubscribe
-- does not touch push. Push recipients are user ids held server side only:
-- no authenticated role can read marketing_push_messages.
--
-- Also here: the per-brand monthly email allowance now counts account-only
-- invite emails (wave 2 A), so Blast and invites share the one 1,000 cap.
--
-- Invariant (declared in the pg17 test): I-3682-CAMPAIGN-GROUP-COUNTS-ONCE | issue #3682 | A multi-channel campaign (one campaign_group_id) counts as one blast toward the rolling-week warning.

BEGIN;

INSERT INTO public.notification_categories (
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES
  ('brand_campaign_push', 'Marketing', false, 'low',
    ARRAY['inapp', 'push']::text[], 'reach_once', true)
ON CONFLICT (key) DO NOTHING;

-- ── Campaign shape ──────────────────────────────────────────────────────────
ALTER TABLE public.marketing_campaigns DROP CONSTRAINT marketing_campaigns_channel_check;
ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_channel_check
    CHECK (channel IN ('email', 'sms', 'rcs', 'push'));
ALTER TABLE public.marketing_campaigns DROP CONSTRAINT marketing_campaigns_payload_kind_valid;
ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_payload_kind_valid CHECK (
    jsonb_typeof(channel_payload) = 'object'
    AND (channel_payload ->> 'kind') IN ('email', 'sms', 'rcs', 'push')
    AND (channel_payload ->> 'kind') = channel
  );
-- Same #2291 constraint (coalesce wrapper, draft exemption, NOT VALID), plus
-- the push arm: a non-draft push needs a non-empty body of at most 240 chars.
ALTER TABLE public.marketing_campaigns DROP CONSTRAINT marketing_campaigns_payload_content_required;
ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_payload_content_required CHECK (
    coalesce(
      CASE
        WHEN status = 'draft' THEN true
        ELSE CASE channel_payload->>'kind'
          WHEN 'email' THEN
            jsonb_typeof(channel_payload->'subject')   = 'string'
            AND jsonb_typeof(channel_payload->'body_html') = 'string'
            AND btrim(channel_payload->>'body_html') <> ''
          WHEN 'sms' THEN
            jsonb_typeof(channel_payload->'body') = 'string'
            AND btrim(channel_payload->>'body') <> ''
          WHEN 'push' THEN
            jsonb_typeof(channel_payload->'body') = 'string'
            AND btrim(channel_payload->>'body') <> ''
            AND char_length(channel_payload->>'body') <= 240
          ELSE false
        END
      END,
      false
    )
  ) NOT VALID;

ALTER TABLE public.marketing_campaigns ADD COLUMN campaign_group_id uuid;
UPDATE public.marketing_campaigns SET campaign_group_id = id WHERE campaign_group_id IS NULL;
-- Left nullable on purpose: fixture and repair paths that insert with
-- triggers disabled must not break; readers use COALESCE(campaign_group_id, id).
CREATE UNIQUE INDEX issue_3682_one_channel_per_campaign_group
  ON public.marketing_campaigns ((COALESCE(campaign_group_id, id)), channel);
COMMENT ON COLUMN public.marketing_campaigns.campaign_group_id IS
  '#3682: rows sharing this id are one campaign sent on several channels. A single-channel campaign has its own id (NULL reads as its own id).';

-- A new row joins its own group unless it names an existing campaign of the
-- same brand and author; the group cannot be changed afterwards.
CREATE OR REPLACE FUNCTION public.issue_3682_campaign_group_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.campaign_group_id IS DISTINCT FROM OLD.campaign_group_id THEN
      RAISE EXCEPTION 'campaign_group_immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.campaign_group_id IS NULL OR NEW.campaign_group_id = NEW.id THEN
    NEW.campaign_group_id := NEW.id;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.marketing_campaigns c
     WHERE COALESCE(c.campaign_group_id, c.id) = NEW.campaign_group_id
       AND c.brand_id = NEW.brand_id AND c.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'campaign_group_invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3682_campaign_group_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER issue_3682_campaign_group_guard
BEFORE INSERT OR UPDATE OF campaign_group_id ON public.marketing_campaigns
FOR EACH ROW EXECUTE FUNCTION public.issue_3682_campaign_group_guard();

-- ── Push recipients (server side only) ──────────────────────────────────────
CREATE TABLE public.marketing_push_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL REFERENCES public.marketing_book_send_executions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('follower', 'extended', 'book')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  failure_reason text NULL CHECK (failure_reason IS NULL OR failure_reason ~ '^[a-z_]{1,40}$'),
  notification_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  UNIQUE (campaign_id, user_id)
);
CREATE INDEX issue_3682_push_messages_queue_idx
  ON public.marketing_push_messages (campaign_id, status);
ALTER TABLE public.marketing_push_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_push_messages FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketing_push_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.marketing_push_messages TO service_role;
CREATE POLICY marketing_push_messages_service ON public.marketing_push_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Per-recipient push decision (confirm time and send time).
CREATE OR REPLACE FUNCTION public.issue_3682_campaign_push_reason(
  p_brand_id uuid, p_user_id uuid, p_reason text
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_follows boolean;
BEGIN
  SELECT true INTO v_follows FROM public.brand_follows bf
   WHERE bf.brand_id = p_brand_id AND bf.user_id = p_user_id;
  v_follows := COALESCE(v_follows, false);
  IF p_reason = 'follower' AND NOT v_follows THEN
    RETURN 'unfollowed';
  END IF;
  -- Mute and the follower's own push switch for this brand apply to everyone
  -- who follows, whichever audience reached them.
  IF v_follows AND NOT public.biz_brand_follow_channel_ok(p_user_id, p_brand_id, 'push') THEN
    RETURN 'muted_or_off';
  END IF;
  IF p_reason = 'extended' AND NOT EXISTS (
    SELECT 1 FROM public.issue_1777_resolve_brand_circle_members(
      p_brand_id, 'extended', ARRAY[p_user_id]) r WHERE r.user_id = p_user_id) THEN
    RETURN 'left_circle';
  END IF;
  IF p_reason = 'book' AND NOT EXISTS (
    SELECT 1 FROM public.brand_people bp
     WHERE bp.brand_id = p_brand_id AND bp.linked_user_id = p_user_id
       AND bp.record_status = 'active') THEN
    RETURN 'left_book';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_circle_exits bx
              WHERE bx.brand_id = p_brand_id AND bx.user_id = p_user_id
                AND (bx.visibility_exited_at IS NOT NULL OR bx.delivery_exited_at IS NOT NULL)) THEN
    RETURN 'delivery_denied';
  END IF;
  IF NOT public.can_send(p_user_id, 'brand_campaign_push', 'push', NULL) THEN
    RETURN 'can_send_denied';
  END IF;
  RETURN 'allowed';
END;
$fn$;

-- ── Quote candidates ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.biz_marketing_push_quote_candidates_v1(
  p_actor_id uuid, p_campaign_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE; v_audience public.marketing_audiences%ROWTYPE;
  v_kind text; v_rows jsonb; v_selected integer; v_version bigint;
BEGIN
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_audience FROM public.marketing_audiences
   WHERE id = v_campaign.audience_id AND brand_id = v_campaign.brand_id;
  IF NOT FOUND OR v_audience.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_kind := v_audience.query_definition ->> 'kind';
  IF v_audience.query_definition = '{"kind":"manual_group"}'::jsonb THEN
    v_kind := 'manual_group';
  ELSIF v_kind IN ('all_brand_people', 'brand_followers', 'brand_circle_extended') THEN
    IF NOT v_audience.is_system_generated
       OR v_audience.query_definition IS DISTINCT FROM
          jsonb_build_object('kind', v_kind, 'brand_id', v_campaign.brand_id::text) THEN
      RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    -- Contact-list audiences (automatic buyer lists) have no Mingla account
    -- guarantee: push is offered only for people Mingla can reach by account.
    RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_campaign.status <> 'draft' OR v_campaign.channel <> 'push'
     OR public.biz_brand_effective_rank(v_campaign.brand_id, p_actor_id) <
        public.biz_role_rank(CASE WHEN v_kind = 'all_brand_people' THEN 'event_manager' ELSE 'marketing_manager' END) THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;
  IF (v_kind IN ('all_brand_people', 'manual_group') AND NOT public.issue_1995_flags_enabled())
     OR (v_kind = 'brand_followers' AND NOT COALESCE((SELECT count(*) = 1 AND bool_and(f.is_enabled)
           FROM public.feature_flags f WHERE f.flag_key = 'brand_circle_followers_v1'), false))
     OR (v_kind = 'brand_circle_extended' AND NOT COALESCE((SELECT count(*) = 3 AND bool_and(f.is_enabled)
           FROM public.feature_flags f WHERE f.flag_key IN ('brand_circle_extended_v1',
             'brand_circle_extended_controls_ios_v1', 'brand_circle_extended_controls_android_v1')), false)) THEN
    RAISE EXCEPTION 'book_blast_flag_disabled' USING ERRCODE = '55000';
  END IF;
  v_version := CASE WHEN v_kind = 'manual_group' THEN v_audience.membership_version ELSE 0 END;

  WITH members AS (
    SELECT bf.user_id, 'follower'::text AS reason
      FROM public.brand_follows bf
      JOIN public.profiles p ON p.id = bf.user_id AND p.active IS TRUE AND p.explorer_deleted_at IS NULL
     WHERE v_kind = 'brand_followers' AND bf.brand_id = v_campaign.brand_id
    UNION
    SELECT r.user_id, 'extended'
      FROM public.issue_1777_resolve_brand_circle_members(v_campaign.brand_id, 'extended', NULL) r
     WHERE v_kind = 'brand_circle_extended'
    UNION
    SELECT bp.linked_user_id, 'book'
      FROM public.brand_people bp
     WHERE v_kind IN ('all_brand_people', 'manual_group')
       AND bp.brand_id = v_campaign.brand_id AND bp.record_status = 'active'
       AND bp.linked_user_id IS NOT NULL
       AND (v_kind = 'all_brand_people' OR EXISTS (
         SELECT 1 FROM public.marketing_manual_group_memberships m
          WHERE m.audience_id = v_audience.id AND m.brand_person_id = bp.id AND m.state = 'active'))
  ), deduped AS (
    SELECT DISTINCT ON (m.user_id) m.user_id, m.reason FROM members m
     WHERE NOT EXISTS (SELECT 1 FROM public.blocked_users b WHERE
       (b.blocker_id = p_actor_id AND b.blocked_id = m.user_id) OR
       (b.blocker_id = m.user_id AND b.blocked_id = p_actor_id))
     ORDER BY m.user_id, m.reason
  ), decided AS (
    SELECT d.user_id, d.reason,
      public.issue_3682_campaign_push_reason(v_campaign.brand_id, d.user_id, d.reason) AS code
    FROM deduped d
  )
  SELECT count(*)::integer,
    COALESCE(jsonb_agg(jsonb_build_object(
      'recipientUserId', user_id, 'reason', reason,
      'allowed', code = 'allowed', 'safeReasonCode', code) ORDER BY user_id), '[]'::jsonb)
    INTO v_selected, v_rows
  FROM decided;

  RETURN jsonb_build_object(
    'brandId', v_campaign.brand_id, 'channel', 'push', 'selectedCount', v_selected,
    'content', v_campaign.channel_payload, 'candidates', v_rows,
    'audienceId', v_audience.id, 'audienceKind', v_kind,
    'audienceVersion', v_version, 'audienceName', v_audience.name,
    'campaignGroupId', COALESCE(v_campaign.campaign_group_id, v_campaign.id)
  );
END;
$fn$;

-- ── Confirm (sealed, idempotent, PT409 on any drift) ────────────────────────
CREATE OR REPLACE FUNCTION public.biz_confirm_marketing_push_send_v1(
  p_actor_id uuid, p_campaign_id uuid, p_client_request_id uuid,
  p_quote_snapshot jsonb, p_scheduled_for timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE;
  v_existing public.marketing_book_send_executions%ROWTYPE;
  v_live jsonb; v_execution uuid; v_now timestamptz := now(); v_reachable integer;
BEGIN
  IF p_client_request_id IS NULL OR jsonb_typeof(p_quote_snapshot) <> 'object'
     OR (p_quote_snapshot ->> 'quoteVersion') IS DISTINCT FROM '1'
     OR COALESCE(p_quote_snapshot ->> 'quoteHash', '') !~ '^[0-9a-f]{64}$'
     OR COALESCE(p_quote_snapshot ->> 'contentHash', '') !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_quote_snapshot -> 'candidates') <> 'array'
     OR (p_quote_snapshot ->> 'quotedAt')::timestamptz < v_now - interval '5 minutes' THEN
    RAISE EXCEPTION 'book_blast_preview_stale' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_existing FROM public.marketing_book_send_executions
   WHERE campaign_id = p_campaign_id
      OR (brand_id = (p_quote_snapshot ->> 'brandId')::uuid AND client_request_id = p_client_request_id)
   ORDER BY (campaign_id = p_campaign_id) DESC LIMIT 1;
  IF FOUND THEN
    IF v_existing.actor_id = p_actor_id AND v_existing.campaign_id = p_campaign_id
       AND v_existing.client_request_id = p_client_request_id
       AND v_existing.quote_hash = p_quote_snapshot ->> 'quoteHash' THEN
      RETURN jsonb_build_object('executionId', v_existing.id, 'campaignId', p_campaign_id,
        'scheduledFor', v_existing.scheduled_for, 'replay', true);
    END IF;
    RAISE EXCEPTION 'book_blast_idempotency_conflict' USING ERRCODE = '23505';
  END IF;

  v_live := public.biz_marketing_push_quote_candidates_v1(p_actor_id, p_campaign_id);
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF v_campaign.channel_payload IS DISTINCT FROM p_quote_snapshot -> 'content'
     OR v_live ->> 'audienceId' IS DISTINCT FROM p_quote_snapshot ->> 'audienceId'
     OR v_live ->> 'audienceKind' IS DISTINCT FROM p_quote_snapshot ->> 'audienceKind'
     OR (v_live -> 'candidates') IS DISTINCT FROM (p_quote_snapshot -> 'candidates')
     OR (v_live ->> 'selectedCount')::integer IS DISTINCT FROM (p_quote_snapshot ->> 'selectedCount')::integer THEN
    RAISE EXCEPTION 'book_blast_preview_stale' USING ERRCODE = 'PT409';
  END IF;
  SELECT count(*)::integer INTO v_reachable
    FROM jsonb_array_elements(v_live -> 'candidates') x WHERE (x ->> 'allowed')::boolean;
  IF v_reachable = 0 OR v_reachable IS DISTINCT FROM (p_quote_snapshot ->> 'reachableCount')::integer THEN
    RAISE EXCEPTION 'book_blast_zero_recipients' USING ERRCODE = 'PT409';
  END IF;
  -- Push is unlimited unless an admin set a push limit for the brand.
  PERFORM public.biz_assert_brand_blast_allowance_v1(v_campaign.brand_id, 'push', v_reachable);

  INSERT INTO public.marketing_book_send_executions(
    brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash, content_hash,
    selected_count, reachable_count, suppressed_count, unavailable_count, sms_segment_count,
    estimated_cost_minor, currency, cost_kind, ratebook_ids, source_references, quoted_at,
    scheduled_for, send_mode
  ) VALUES (
    v_campaign.brand_id, p_campaign_id, p_actor_id, p_client_request_id, 1,
    p_quote_snapshot ->> 'quoteHash', p_quote_snapshot ->> 'contentHash',
    (v_live ->> 'selectedCount')::integer, v_reachable,
    (v_live ->> 'selectedCount')::integer - v_reachable, 0, 0,
    NULL, NULL, 'not_metered', '[]'::jsonb, '[]'::jsonb,
    (p_quote_snapshot ->> 'quotedAt')::timestamptz,
    COALESCE(p_scheduled_for, v_now),
    CASE WHEN p_scheduled_for IS NULL THEN 'now' ELSE 'scheduled' END
  ) RETURNING id INTO v_execution;

  INSERT INTO public.marketing_push_messages(campaign_id, execution_id, user_id, reason)
  SELECT p_campaign_id, v_execution, (x ->> 'recipientUserId')::uuid, x ->> 'reason'
    FROM jsonb_array_elements(v_live -> 'candidates') x
   WHERE (x ->> 'allowed')::boolean;

  UPDATE public.marketing_campaigns
     SET status = 'scheduled', scheduled_for = COALESCE(p_scheduled_for, v_now), updated_at = v_now
   WHERE id = p_campaign_id AND status = 'draft';

  RETURN jsonb_build_object('executionId', v_execution, 'campaignId', p_campaign_id,
    'scheduledFor', COALESCE(p_scheduled_for, v_now), 'replay', false);
END;
$fn$;

-- Send-time worklist: anyone who unfollowed, muted or switched push off since
-- confirm is skipped here, then the queued rows are handed to the dispatcher.
CREATE OR REPLACE FUNCTION public.biz_marketing_push_send_worklist_v1(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_campaign public.marketing_campaigns%ROWTYPE; v_work jsonb; v_event jsonb;
BEGIN
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR v_campaign.channel <> 'push' THEN
    RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.marketing_push_messages m SET
    status = 'skipped', failure_reason = d.code, updated_at = now()
  FROM (
    SELECT q.id, public.issue_3682_campaign_push_reason(v_campaign.brand_id, q.user_id, q.reason) AS code
      FROM public.marketing_push_messages q
     WHERE q.campaign_id = p_campaign_id AND q.status = 'queued'
  ) d
  WHERE m.id = d.id AND d.code <> 'allowed';
  SELECT jsonb_build_object('eventSlug', e.slug) INTO v_event
    FROM public.events e
   WHERE e.id = NULLIF(v_campaign.channel_payload ->> 'event_id', '')::uuid
     AND e.brand_id = v_campaign.brand_id AND e.deleted_at IS NULL;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('messageId', m.id, 'userId', m.user_id,
           'reason', m.reason) ORDER BY m.user_id), '[]'::jsonb)
    INTO v_work
    FROM public.marketing_push_messages m
   WHERE m.campaign_id = p_campaign_id AND m.status = 'queued';
  RETURN jsonb_build_object(
    'brandName', (SELECT b.name FROM public.brands b WHERE b.id = v_campaign.brand_id),
    'brandSlug', (SELECT b.slug FROM public.brands b WHERE b.id = v_campaign.brand_id),
    'eventSlug', v_event ->> 'eventSlug',
    'body', v_campaign.channel_payload ->> 'body',
    'work', v_work);
END;
$fn$;

-- ── Finalize: push campaigns read their own message table ───────────────────
CREATE OR REPLACE FUNCTION public.mkt_finalize_campaign(p_campaign_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_delivered integer;
  v_deferred integer;
  v_preview integer;
  v_failed integer;
  v_min_next timestamptz;
  v_new_status text;
  v_channel text;
BEGIN
  SELECT channel INTO v_channel FROM public.marketing_campaigns WHERE id = p_campaign_id;
  IF v_channel = 'push' THEN
    SELECT count(*) FILTER (WHERE status = 'sent') INTO v_delivered
      FROM public.marketing_push_messages WHERE campaign_id = p_campaign_id;
    v_new_status := CASE WHEN v_delivered > 0 THEN 'sent' ELSE 'failed' END;
    UPDATE public.marketing_campaigns
       SET status = v_new_status,
           recipient_count = v_delivered,
           sent_at = CASE WHEN v_delivered > 0 THEN now() ELSE sent_at END,
           updated_at = now()
     WHERE id = p_campaign_id;
    RETURN v_new_status;
  END IF;

  SELECT
    count(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked')),
    count(*) FILTER (WHERE status = 'deferred'),
    count(*) FILTER (WHERE status = 'preview_skipped'),
    count(*) FILTER (WHERE status IN ('failed', 'bounced')),
    min(next_attempt_at) FILTER (WHERE status = 'deferred')
  INTO v_delivered, v_deferred, v_preview, v_failed, v_min_next
  FROM public.marketing_messages
  WHERE campaign_id = p_campaign_id;

  IF v_deferred > 0 THEN
    v_new_status := 'scheduled';
    UPDATE public.marketing_campaigns
       SET status = 'scheduled',
           recipient_count = v_delivered,
           sent_at = NULL,
           scheduled_for = COALESCE(v_min_next, now() + interval '15 minutes'),
           updated_at = now()
     WHERE id = p_campaign_id;
  ELSIF v_delivered > 0 THEN
    v_new_status := 'sent';
    UPDATE public.marketing_campaigns
       SET status = 'sent',
           recipient_count = v_delivered,
           sent_at = now(),
           updated_at = now()
     WHERE id = p_campaign_id;
  ELSIF v_preview > 0 THEN
    v_new_status := 'sent';
    UPDATE public.marketing_campaigns
       SET status = 'sent',
           recipient_count = v_preview,
           sent_at = now(),
           updated_at = now()
     WHERE id = p_campaign_id;
  ELSE
    -- INVARIANT (I-PROPOSED-1270-NO-EMPTY-SENT): 'sent' needs delivered or preview > 0.
    v_new_status := 'failed';
    UPDATE public.marketing_campaigns
       SET status = 'failed',
           recipient_count = 0,
           updated_at = now()
     WHERE id = p_campaign_id;
  END IF;

  RETURN v_new_status;
END;
$$;

-- ── Allowance: the #4130 bodies; week counts groups; email counts invites ───
CREATE OR REPLACE FUNCTION public.biz_brand_blast_usage_v1(
  p_actor_id uuid,
  p_brand_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  v_sms_used := v_sms_used + public.issue_4111_subscribe_sms_used(p_brand_id);
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

CREATE OR REPLACE FUNCTION public.biz_assert_brand_blast_allowance_v1(
  p_brand_id uuid,
  p_channel text,
  p_additional_reachable integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    v_used := v_used + public.issue_4111_subscribe_sms_used(p_brand_id);
  ELSIF p_channel = 'email' THEN
    v_used := v_used + private.issue_3682_account_invite_email_used(p_brand_id);
  END IF;

  IF v_used + p_additional_reachable > v_cap THEN
    RAISE EXCEPTION 'book_blast_monthly_cap_exceeded' USING ERRCODE = 'P0001';
  END IF;
END;
$f$;

REVOKE ALL ON FUNCTION public.issue_3682_campaign_push_reason(uuid, uuid, text),
  public.biz_marketing_push_quote_candidates_v1(uuid, uuid),
  public.biz_confirm_marketing_push_send_v1(uuid, uuid, uuid, jsonb, timestamptz),
  public.biz_marketing_push_send_worklist_v1(uuid),
  public.mkt_finalize_campaign(uuid),
  public.biz_brand_blast_usage_v1(uuid, uuid),
  public.biz_assert_brand_blast_allowance_v1(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3682_campaign_push_reason(uuid, uuid, text),
  public.biz_marketing_push_quote_candidates_v1(uuid, uuid),
  public.biz_confirm_marketing_push_send_v1(uuid, uuid, uuid, jsonb, timestamptz),
  public.biz_marketing_push_send_worklist_v1(uuid),
  public.mkt_finalize_campaign(uuid),
  public.biz_brand_blast_usage_v1(uuid, uuid),
  public.biz_assert_brand_blast_allowance_v1(uuid, text, integer)
  TO service_role;

COMMIT;
