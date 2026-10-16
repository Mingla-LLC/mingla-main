-- #3720 — reliable Host Community and support notifications.
--
-- Invariant #3720-N1: every Host push category is namespaced business.* so the
-- Host inbox and the Host OneSignal application resolve the same event.
-- Invariant #3720-N2: announcement and roadmap fan-out is one durable outbox
-- row per recipient; roadmap mutations themselves remain silent.
-- Invariant #3720-N3: new support tickets snapshot every enabled support rep;
-- availability remains presence-only and never filters operational alerts.

-- ---------------------------------------------------------------------------
-- Categories and preference continuity
-- ---------------------------------------------------------------------------

INSERT INTO public.notification_categories (
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES
  (
    'business.community_announcement', 'community', true, 'normal',
    ARRAY['inapp', 'push', 'email']::text[], 'reach_once', true
  ),
  (
    'business.community_roadmap_updated', 'community', true, 'normal',
    ARRAY['inapp', 'push']::text[], 'reach_once', true
  ),
  (
    'business.support_new_ticket', 'support', true, 'high',
    ARRAY['inapp', 'push', 'email']::text[], 'reach_once', true
  )
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = EXCLUDED.active;

INSERT INTO public.notification_channel_prefs (
  user_id, category_key, channel, enabled, updated_at
)
SELECT
  p.user_id,
  'business.community_announcement',
  p.channel,
  p.enabled,
  p.updated_at
FROM public.notification_channel_prefs p
WHERE p.category_key = 'community_announcement'
ON CONFLICT (user_id, category_key, channel) DO UPDATE
SET enabled = EXCLUDED.enabled,
    updated_at = GREATEST(notification_channel_prefs.updated_at, EXCLUDED.updated_at);

UPDATE public.notification_categories
SET active = false
WHERE key = 'community_announcement';

-- ---------------------------------------------------------------------------
-- Durable campaign identity for Admin reporting and idempotent roadmap sends
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.community_notification_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('announcement', 'roadmap_update')),
  source_id uuid,
  request_key uuid NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  audience_count integer NOT NULL DEFAULT 0 CHECK (audience_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, request_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS community_notification_campaign_announcement_source_idx
  ON public.community_notification_campaigns (source_id)
  WHERE kind = 'announcement' AND source_id IS NOT NULL;

ALTER TABLE public.community_notification_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_notification_campaigns FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.community_notification_campaigns TO service_role;
GRANT SELECT ON public.community_notification_campaigns TO authenticated;

DROP POLICY IF EXISTS community_notification_campaigns_admin_read
  ON public.community_notification_campaigns;
CREATE POLICY community_notification_campaigns_admin_read
  ON public.community_notification_campaigns FOR SELECT TO authenticated
  USING (public.is_admin_user());

COMMENT ON TABLE public.community_notification_campaigns IS
  '#3720: immutable announcement/roadmap campaign identity and recipient snapshot. '
  'Channel outcomes remain authoritative in notification_outbox and notification_deliveries.';

-- ---------------------------------------------------------------------------
-- Trusted notification email resolver (service role only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_3720_notification_email(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT lower(btrim(u.email)) INTO v_email
  FROM auth.users u
  WHERE u.id = p_user_id
    AND u.email_confirmed_at IS NOT NULL
    AND btrim(COALESCE(u.email, '')) <> '';

  IF v_email IS NULL AND to_regclass('auth.identities') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT lower(btrim(i.identity_data->>'email'))
      FROM auth.identities i
      WHERE i.user_id = $1
        AND btrim(COALESCE(i.identity_data->>'email', '')) <> ''
        AND lower(COALESCE(i.identity_data->>'email_verified', '')) IN ('true', 't')
      ORDER BY i.last_sign_in_at DESC NULLS LAST
      LIMIT 1
    $sql$ INTO v_email USING p_user_id;
  END IF;

  RETURN v_email;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3720_notification_email(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_notification_email(uuid) TO service_role;

-- Return only a bounded, non-sensitive policy code after can_send() denies a
-- #3720 channel. Provider logs and Admin counts can now distinguish an email
-- preference from a bounce/complaint without exposing the address or content.
CREATE OR REPLACE FUNCTION public.issue_3720_notification_denial_reason(
  p_user_id uuid,
  p_category_key text,
  p_channel text,
  p_contact text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cat public.notification_categories%ROWTYPE;
  v_suppression_reason text;
BEGIN
  IF p_category_key NOT IN (
    'business.community_announcement',
    'business.community_roadmap_updated',
    'business.support_new_ticket'
  ) THEN
    RETURN 'policy_denied';
  END IF;

  SELECT * INTO v_cat
  FROM public.notification_categories
  WHERE key = p_category_key;
  IF NOT FOUND OR v_cat.active IS NOT TRUE THEN RETURN 'category_inactive'; END IF;
  IF NOT (p_channel = ANY(v_cat.default_channels)) THEN RETURN 'channel_inactive'; END IF;

  IF p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notification_channel_prefs p
    WHERE p.user_id = p_user_id
      AND p.category_key = p_category_key
      AND p.channel = p_channel
      AND p.enabled = false
  ) THEN
    RETURN 'preference_off';
  END IF;

  IF p_channel IN ('email', 'sms') THEN
    SELECT s.reason INTO v_suppression_reason
    FROM public.channel_suppressions s
    WHERE s.channel = p_channel
      AND s.scope IN (
        CASE WHEN v_cat.is_transactional THEN 'transactional' ELSE 'marketing' END,
        'all'
      )
      AND (
        (p_user_id IS NOT NULL AND s.user_id = p_user_id)
        OR (p_contact IS NOT NULL AND lower(s.contact) = lower(p_contact))
      )
    ORDER BY CASE s.reason
      WHEN 'complaint' THEN 1
      WHEN 'bounce' THEN 2
      ELSE 3
    END, s.created_at DESC
    LIMIT 1;

    IF v_suppression_reason = 'complaint' THEN RETURN 'complaint'; END IF;
    IF v_suppression_reason = 'bounce' THEN RETURN 'hard_bounce'; END IF;
    IF v_suppression_reason IS NOT NULL THEN RETURN 'legal_suppression'; END IF;
  END IF;

  RETURN 'policy_denied';
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3720_notification_denial_reason(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_notification_denial_reason(uuid, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Channel-attempt claim/complete authority used by generic notify v2 retries
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_3720_claim_notification_channel(
  p_notification_id uuid,
  p_channel text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.notification_deliveries%ROWTYPE;
  v_new_id uuid;
BEGIN
  IF p_notification_id IS NULL OR p_channel NOT IN ('inapp', 'push', 'email', 'sms') THEN
    RAISE EXCEPTION 'invalid_delivery_claim' USING ERRCODE = '22023';
  END IF;

  -- One claimant per notification/channel even across overlapping drain ticks.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_notification_id::text || ':' || p_channel, 3720));

  SELECT * INTO v_existing
  FROM public.notification_deliveries d
  WHERE d.notification_id = p_notification_id
    AND d.channel = p_channel
  ORDER BY d.attempt_at DESC, d.id DESC
  LIMIT 1;

  IF FOUND AND v_existing.status IN ('sent', 'delivered', 'suppressed', 'skipped') THEN
    RETURN jsonb_build_object(
      'outcome', 'terminal',
      'deliveryId', v_existing.id,
      'status', v_existing.status,
      'providerMessageId', v_existing.provider_message_id
    );
  END IF;

  IF FOUND AND v_existing.status = 'queued'
     AND v_existing.attempt_at > now() - interval '5 minutes' THEN
    RETURN jsonb_build_object(
      'outcome', 'in_flight',
      'deliveryId', v_existing.id,
      'status', v_existing.status,
      'providerMessageId', v_existing.provider_message_id
    );
  END IF;

  IF FOUND THEN
    UPDATE public.notification_deliveries
    SET status = 'queued',
        provider_message_id = NULL,
        failed_reason = NULL,
        delivered_at = NULL,
        segments = NULL,
        attempt_at = now()
    WHERE id = v_existing.id;

    RETURN jsonb_build_object(
      'outcome', 'claimed',
      'deliveryId', v_existing.id,
      'status', 'queued',
      'providerMessageId', NULL
    );
  END IF;

  INSERT INTO public.notification_deliveries (
    notification_id, channel, status, provider, attempt_at
  ) VALUES (
    p_notification_id,
    p_channel,
    'queued',
    CASE p_channel
      WHEN 'push' THEN 'onesignal'
      WHEN 'email' THEN 'resend'
      WHEN 'inapp' THEN 'inapp'
      ELSE NULL
    END,
    now()
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'outcome', 'claimed',
    'deliveryId', v_new_id,
    'status', 'queued',
    'providerMessageId', NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_complete_notification_channel(
  p_delivery_id uuid,
  p_status text,
  p_provider text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_failed_reason text DEFAULT NULL,
  p_segments integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_delivery_id IS NULL OR p_status NOT IN (
    'queued', 'sent', 'delivered', 'undelivered', 'failed', 'suppressed', 'skipped'
  ) THEN
    RAISE EXCEPTION 'invalid_delivery_completion' USING ERRCODE = '22023';
  END IF;

  UPDATE public.notification_deliveries
  SET status = p_status,
      provider = COALESCE(p_provider, provider),
      provider_message_id = p_provider_message_id,
      failed_reason = p_failed_reason,
      segments = p_segments,
      delivered_at = CASE WHEN p_status = 'delivered' THEN now() ELSE delivered_at END,
      attempt_at = now()
  WHERE id = p_delivery_id
    AND status = 'queued';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3720_claim_notification_channel(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3720_complete_notification_channel(uuid, text, text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_claim_notification_channel(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_complete_notification_channel(uuid, text, text, text, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Announcement publish: one event, correctly namespaced, no historical replay
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.community_publish_announcement(uuid);
CREATE FUNCTION public.community_publish_announcement(p_id uuid)
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
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
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
  ) VALUES ('announcement', p_id, p_id, auth.uid())
  RETURNING id, created_at INTO v_campaign_id, v_created_at;

  UPDATE public.community_announcements
  SET status = 'published', published_at = now(), updated_at = now()
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
    auth.uid(), 'publish_announcement', 'community_announcement', p_id,
    jsonb_build_object('campaign_id', v_campaign_id, 'enqueued', v_enqueued)
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

REVOKE ALL ON FUNCTION public.community_publish_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_publish_announcement(uuid) TO authenticated;

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
  WHERE c.kind = 'announcement'
    AND (p_campaign_id IS NULL OR c.id = p_campaign_id)
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

-- ---------------------------------------------------------------------------
-- Roadmap preview, explicit notify action, and campaign status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.community_roadmap_notification_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hosts integer;
  v_published integer;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT count(DISTINCT btm.user_id)::integer INTO v_hosts
  FROM public.brand_team_members btm
  JOIN auth.users u ON u.id = btm.user_id
  WHERE btm.accepted_at IS NOT NULL AND btm.removed_at IS NULL;

  SELECT count(*)::integer INTO v_published
  FROM public.community_roadmap_cards
  WHERE status = 'published';

  RETURN jsonb_build_object(
    'audience_count', v_hosts,
    'published_count', v_published
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_notify_roadmap_change(p_request_key uuid)
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
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
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
  ) VALUES ('roadmap_update', p_request_key, auth.uid())
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
    auth.uid(), 'notify_roadmap_change', 'community_notification_campaign',
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

CREATE OR REPLACE FUNCTION public.community_get_roadmap_notification_status(
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
  v_state text;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_campaign
  FROM public.community_notification_campaigns c
  WHERE c.kind = 'roadmap_update'
    AND (p_campaign_id IS NULL OR c.id = p_campaign_id)
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
      WHERE d.channel = 'push'
        AND (
          d.status = 'queued'
          OR (
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
      WHERE d.channel = 'push'
        AND d.status IN ('failed', 'undelivered')
        AND NOT EXISTS (
          SELECT 1 FROM public.notification_outbox pending
          WHERE pending.idempotency_key = n.idempotency_key
            AND pending.status IN ('pending', 'processing', 'retry_wait')
        )
    )
  INTO v_inapp, v_push_sent, v_push_suppressed, v_push_retrying, v_push_failed
  FROM public.notifications n
  LEFT JOIN public.notification_deliveries d ON d.notification_id = n.id
  WHERE n.data->>'campaign_id' = v_campaign.id::text;

  v_state := CASE
    WHEN v_pending > 0 AND v_done = 0 THEN 'queued'
    WHEN v_pending > 0 THEN 'processing'
    WHEN v_failed > 0 AND v_done = 0 THEN 'failed'
    WHEN v_failed > 0 OR v_push_failed > 0 THEN 'partial'
    ELSE 'complete'
  END;

  RETURN jsonb_build_object(
    'campaign_id', v_campaign.id,
    'request_key', v_campaign.request_key,
    'kind', v_campaign.kind,
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
      'push_failed', v_push_failed
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_roadmap_notification_preview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_notify_roadmap_change(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_get_roadmap_notification_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_roadmap_notification_preview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_notify_roadmap_change(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_get_roadmap_notification_status(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- New-ticket support fan-out is atomic with ticket creation
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS tg_support_ticket_notify_staff ON public.support_tickets;

CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_subject text,
  p_brand_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conv uuid;
  v_ticket uuid;
  v_seg text;
  v_subject text := left(btrim(COALESCE(p_subject, '')), 200);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_subject = '' THEN
    RAISE EXCEPTION 'subject_required' USING ERRCODE = 'P0001';
  END IF;

  v_seg := public.derive_user_segment(auth.uid());
  IF v_seg = 'admin' THEN v_seg := 'business'; END IF;
  IF v_seg NOT IN ('business', 'explorer') THEN v_seg := 'business'; END IF;

  INSERT INTO public.conversations(type, linked_entity_type, name, created_by)
  VALUES ('group', 'support', v_subject, auth.uid())
  RETURNING id INTO v_conv;

  INSERT INTO public.conversation_participants(conversation_id, user_id)
  VALUES (v_conv, auth.uid());

  INSERT INTO public.support_tickets(
    requester_user_id, requester_segment, subject, conversation_id, brand_id
  ) VALUES (
    auth.uid(), v_seg, v_subject, v_conv, p_brand_id
  ) RETURNING id INTO v_ticket;

  -- Support-ticket alerts are bell + push + email only. Country remains NULL
  -- because no SMS channel is eligible for this category.
  INSERT INTO public.notification_outbox (
    category_key, user_id, brand_id, country_code, payload,
    idempotency_key, status
  )
  SELECT
    'business.support_new_ticket',
    s.user_id,
    p_brand_id,
    NULL,
    jsonb_build_object(
      'ticket_id', v_ticket,
      'subject', v_subject,
      'deep_link', 'mingla-business://support/' || v_ticket::text
    ),
    'business.support_new_ticket:' || v_ticket::text || ':' || s.user_id::text,
    'pending'
  FROM public.support_staff s
  JOIN auth.users u ON u.id = s.user_id
  WHERE s.enabled = true
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_ticket;
END;
$$;

REVOKE ALL ON FUNCTION public.create_support_ticket(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Preference and read-state continuity
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.community_set_email_pref(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notification_channel_prefs AS p (
    user_id, category_key, channel, enabled, updated_at
  ) VALUES (
    auth.uid(), 'business.community_announcement', 'email', p_enabled, now()
  )
  ON CONFLICT (user_id, category_key, channel) DO UPDATE
  SET enabled = EXCLUDED.enabled, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.community_mark_announcement_read(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_announcement_id IS NULL THEN
    RAISE EXCEPTION 'id_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.community_announcements a
    WHERE a.id = p_announcement_id AND a.status = 'published'
  ) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.community_read_receipts (user_id, announcement_id, read_at)
  VALUES (auth.uid(), p_announcement_id, now())
  ON CONFLICT (user_id, announcement_id) DO UPDATE SET read_at = EXCLUDED.read_at;

  UPDATE public.notifications
  SET read_at = COALESCE(read_at, now()), is_read = true
  WHERE user_id = auth.uid()
    AND type = 'business.community_announcement'
    AND data->>'announcement_id' = p_announcement_id::text;
END;
$$;

-- Bell/push reads and Community-list reads converge on both authorities. The
-- trigger runs for any client that marks the recipient-owned notification row
-- read, including the generic bell inbox and push-tap handler.
CREATE OR REPLACE FUNCTION public.issue_3720_reconcile_announcement_notification_read()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_announcement_id uuid;
BEGIN
  IF NEW.type <> 'business.community_announcement'
     OR NEW.read_at IS NULL
     OR OLD.read_at IS NOT NULL
     OR COALESCE(NEW.data->>'announcement_id', '') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RETURN NEW;
  END IF;

  v_announcement_id := (NEW.data->>'announcement_id')::uuid;
  IF EXISTS (
    SELECT 1 FROM public.community_announcements a
    WHERE a.id = v_announcement_id AND a.status = 'published'
  ) THEN
    INSERT INTO public.community_read_receipts(user_id, announcement_id, read_at)
    VALUES (NEW.user_id, v_announcement_id, NEW.read_at)
    ON CONFLICT (user_id, announcement_id) DO UPDATE
    SET read_at = LEAST(community_read_receipts.read_at, EXCLUDED.read_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS issue_3720_announcement_notification_read
  ON public.notifications;
CREATE TRIGGER issue_3720_announcement_notification_read
AFTER UPDATE OF read_at ON public.notifications
FOR EACH ROW
WHEN (OLD.read_at IS NULL AND NEW.read_at IS NOT NULL)
EXECUTE FUNCTION public.issue_3720_reconcile_announcement_notification_read();

REVOKE ALL ON FUNCTION public.issue_3720_reconcile_announcement_notification_read()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.community_set_email_pref(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_mark_announcement_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_set_email_pref(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_mark_announcement_read(uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_categories
    WHERE key = 'business.community_announcement' AND active = true
  ) OR NOT EXISTS (
    SELECT 1 FROM public.notification_categories
    WHERE key = 'business.community_roadmap_updated' AND active = true
  ) OR NOT EXISTS (
    SELECT 1 FROM public.notification_categories
    WHERE key = 'business.support_new_ticket' AND active = true
  ) THEN
    RAISE EXCEPTION '#3720 self-check: Host notification categories missing';
  END IF;
END;
$$;
