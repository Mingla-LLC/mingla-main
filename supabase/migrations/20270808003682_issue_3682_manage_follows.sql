-- #3682 Wave 2.6 — manage follows: mute + per-brand channel prefs.
-- muted_until NULL = not muted; timestamptz = muted until then;
-- 'infinity' = muted until the guest unmutes (contract "until I turn it back on").
-- Channel prefs default ON when no row (fail-open for reachability).

BEGIN;

ALTER TABLE public.brand_follows
  ADD COLUMN IF NOT EXISTS muted_until timestamptz;

COMMENT ON COLUMN public.brand_follows.muted_until IS
  '#3682: NULL = not muted; future timestamptz = muted until; infinity = indefinite mute.';

DROP POLICY IF EXISTS bf_owner_update ON public.brand_follows;
CREATE POLICY bf_owner_update ON public.brand_follows
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brand_follows TO authenticated;

CREATE TABLE IF NOT EXISTS public.brand_follow_channel_prefs (
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('push', 'email', 'sms')),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, brand_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_brand_follow_channel_prefs_brand
  ON public.brand_follow_channel_prefs (brand_id);

ALTER TABLE public.brand_follow_channel_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bfcp_owner_all ON public.brand_follow_channel_prefs;
CREATE POLICY bfcp_owner_all ON public.brand_follow_channel_prefs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON TABLE public.brand_follow_channel_prefs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brand_follow_channel_prefs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brand_follow_channel_prefs TO service_role;

-- True when the guest may receive marketing on this channel for this brand.
CREATE OR REPLACE FUNCTION public.biz_brand_follow_channel_ok(
  p_user_id uuid,
  p_brand_id uuid,
  p_channel text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_muted timestamptz;
  v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_brand_id IS NULL
     OR p_channel IS NULL OR p_channel NOT IN ('push', 'email', 'sms') THEN
    RETURN false;
  END IF;

  SELECT bf.muted_until INTO v_muted
  FROM public.brand_follows bf
  WHERE bf.user_id = p_user_id AND bf.brand_id = p_brand_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Muted (indefinite infinity or still in the future).
  IF v_muted IS NOT NULL AND v_muted > now() THEN
    RETURN false;
  END IF;

  SELECT p.enabled INTO v_enabled
  FROM public.brand_follow_channel_prefs p
  WHERE p.user_id = p_user_id
    AND p.brand_id = p_brand_id
    AND p.channel = p_channel;

  IF FOUND THEN
    RETURN v_enabled;
  END IF;
  -- No row → default on.
  RETURN true;
END;
$f$;

REVOKE ALL ON FUNCTION public.biz_brand_follow_channel_ok(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_brand_follow_channel_ok(uuid, uuid, text)
  TO service_role;

-- Circle / follower blast audience: skip muted + channel-off guests.
CREATE OR REPLACE FUNCTION public.biz_marketing_circle_send_audience_v1(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $function$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE; v_kind text; v_ring text; v_rows jsonb;
  v_pref_channel text;
BEGIN
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id=p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'circle_blast_unconfirmed' USING ERRCODE='42501'; END IF;
  SELECT a.query_definition->>'kind' INTO v_kind FROM public.marketing_audiences a
  WHERE a.id=v_campaign.audience_id AND a.brand_id=v_campaign.brand_id;
  IF NOT FOUND OR v_kind NOT IN('brand_followers','brand_circle_extended')
    OR NOT EXISTS(SELECT 1 FROM public.marketing_book_send_executions e WHERE e.campaign_id=p_campaign_id)
  THEN RAISE EXCEPTION 'circle_blast_unconfirmed' USING ERRCODE='42501'; END IF;
  v_ring:=CASE v_kind WHEN 'brand_followers' THEN 'follower' ELSE 'extended' END;
  v_pref_channel:=CASE v_campaign.channel
    WHEN 'email' THEN 'email'
    WHEN 'sms' THEN 'sms'
    WHEN 'push' THEN 'push'
    ELSE v_campaign.channel
  END;

  IF NOT public.issue_1995_flags_enabled()
    OR NOT public.issue_1778_ring_channel_enabled(v_kind,v_campaign.channel)
  THEN
    RETURN jsonb_build_object('rows','[]'::jsonb,'brand_id',v_campaign.brand_id,'reach',jsonb_build_object(
      'total',0,'reachable_email',0,'reachable_sms',0));
  END IF;

  WITH sealed AS MATERIALIZED (
    SELECT t.*,e.brand_id,e.actor_id
    FROM public.marketing_book_send_targets t
    JOIN public.marketing_book_send_executions e ON e.id=t.execution_id
    WHERE e.campaign_id=p_campaign_id AND t.outcome='queued'
      AND t.recipient_user_id IS NOT NULL AND t.ring=v_ring
  ), live AS MATERIALIZED (
    SELECT r.user_id,r.ring,r.display_name
    FROM public.issue_1777_resolve_brand_circle_members(
      v_campaign.brand_id,v_ring,array(SELECT s.recipient_user_id FROM sealed s)
    ) r
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'contact_key',t.recipient_user_id::text,
    'display_name',COALESCE(
      NULLIF(btrim(bp.display_name),''),
      NULLIF(btrim(l.display_name),''),
      'Mingla member'
    ),
    'first_name',COALESCE(
      NULLIF(split_part(btrim(COALESCE(
        NULLIF(btrim(bp.display_name),''),
        NULLIF(btrim(l.display_name),''),
        ''
      )),' ',1),''),
      'there'
    ),
    'raw_email',CASE WHEN v_campaign.channel='email' THEN a.normalized_contact END,
    'raw_phone',CASE WHEN v_campaign.channel='sms' THEN a.normalized_contact END,
    'order_count',0,'total_spend_minor',0,'total_spend_currency','USD',
    'last_event_id',NULL,'last_event_name',NULL,'last_purchase_at',NULL,
    'email_marketing_ok',v_campaign.channel='email' AND a.allowed,
    'sms_marketing_ok',v_campaign.channel='sms' AND a.allowed,
    'receive_reason',CASE v_kind
      WHEN 'brand_followers' THEN 'follows'
      ELSE 'friend_of_follower'
    END
  ) ORDER BY t.recipient_user_id),'[]'::jsonb) INTO v_rows
  FROM sealed t
  JOIN live l ON l.user_id=t.recipient_user_id AND l.ring=t.ring
  LEFT JOIN LATERAL (
    SELECT bp.display_name
    FROM public.brand_people bp
    WHERE bp.brand_id=t.brand_id
      AND bp.linked_user_id=t.recipient_user_id
      AND bp.record_status='active'
      AND bp.deleted_at IS NULL
    ORDER BY bp.updated_at DESC NULLS LAST
    LIMIT 1
  ) bp ON TRUE
  JOIN LATERAL public.issue_1778_circle_authorized_contact(t.brand_id,t.recipient_user_id,t.channel) a ON a.allowed
  WHERE t.contact_value_digest=encode(extensions.digest(convert_to(a.normalized_contact,'UTF8'),'sha256'),'hex')
    AND NOT EXISTS(SELECT 1 FROM public.blocked_users b WHERE
      (b.blocker_id=t.actor_id AND b.blocked_id=t.recipient_user_id) OR
      (b.blocker_id=t.recipient_user_id AND b.blocked_id=t.actor_id))
    -- #3682 Wave 2.6 — mute + per-brand channel prefs (followers only; extended
    -- guests are not brand_follows owners and stay on contact consent alone).
    AND (
      v_kind <> 'brand_followers'
      OR public.biz_brand_follow_channel_ok(
        t.recipient_user_id,
        t.brand_id,
        v_pref_channel
      )
    );
  RETURN jsonb_build_object('rows',v_rows,'brand_id',v_campaign.brand_id,'reach',jsonb_build_object(
    'total',jsonb_array_length(v_rows),
    'reachable_email',CASE WHEN v_campaign.channel='email' THEN jsonb_array_length(v_rows) ELSE 0 END,
    'reachable_sms',CASE WHEN v_campaign.channel='sms' THEN jsonb_array_length(v_rows) ELSE 0 END));
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_marketing_circle_send_audience_v1(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_marketing_circle_send_audience_v1(uuid) TO service_role;

COMMIT;
