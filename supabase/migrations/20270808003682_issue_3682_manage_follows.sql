-- #3682 Wave 2.6 — manage follows: mute + per-brand channel prefs.
-- muted_until NULL = not muted; timestamptz = muted until then;
-- 'infinity' = muted until the guest unmutes (contract "until I turn it back on").
-- Channel prefs default ON when no row (fail-open for reachability).
-- Writes to brand_follow_channel_prefs go through SECURITY DEFINER RPC so the
-- new table does not take authenticated INSERT/UPDATE/DELETE (#1856 D-01).

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

-- Narrow ACL: revoke inherited ALL (TRUNCATE/MAINTAIN/…), restore #679 CRUD
-- shape, and allow UPDATE only on muted_until (not brand_id/source/created_at).
REVOKE ALL ON TABLE public.brand_follows FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.brand_follows TO authenticated;
GRANT UPDATE (muted_until) ON TABLE public.brand_follows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brand_follows TO service_role;

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
CREATE POLICY bfcp_owner_select ON public.brand_follow_channel_prefs
  FOR SELECT
  USING (auth.uid() = user_id);

-- No authenticated INSERT/UPDATE/DELETE — #1856 D-01. Writes via RPC below.
REVOKE ALL ON TABLE public.brand_follow_channel_prefs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.brand_follow_channel_prefs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brand_follow_channel_prefs TO service_role;

-- Owner-scoped channel write (Explorer Manage + future surfaces).
CREATE OR REPLACE FUNCTION public.biz_brand_follow_set_channel_v1(
  p_brand_id uuid,
  p_channel text,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_brand_id IS NULL
     OR p_channel IS NULL OR p_channel NOT IN ('push', 'email', 'sms')
     OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid_channel_pref' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_follows bf
    WHERE bf.user_id = auth.uid() AND bf.brand_id = p_brand_id
  ) THEN
    RAISE EXCEPTION 'not_following' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.brand_follow_channel_prefs AS p
    (user_id, brand_id, channel, enabled, updated_at)
  VALUES (auth.uid(), p_brand_id, p_channel, p_enabled, now())
  ON CONFLICT (user_id, brand_id, channel)
  DO UPDATE SET
    enabled = EXCLUDED.enabled,
    updated_at = now();
END;
$f$;

REVOKE ALL ON FUNCTION public.biz_brand_follow_set_channel_v1(uuid, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_brand_follow_set_channel_v1(uuid, text, boolean)
  TO authenticated, service_role;

-- True when the guest may receive marketing on this channel for this brand.
-- Consults mute + follow channel prefs + one-click marketing_unsubscribes
-- (same contact authority the blast email link writes).
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
  v_contact text;
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

  IF FOUND AND v_enabled IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- One-click / self-serve unsubscribe authority (email + sms only).
  IF p_channel IN ('email', 'sms') THEN
    SELECT i.value INTO v_contact
    FROM public.verified_account_identifiers(p_user_id) i
    WHERE i.kind = CASE WHEN p_channel = 'sms' THEN 'phone' ELSE 'email' END
    ORDER BY i.value
    LIMIT 1;

    IF v_contact IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.marketing_unsubscribes u
      WHERE u.channel IN (p_channel, 'all')
        AND (
          (p_channel = 'email' AND lower(u.contact_email) = lower(v_contact))
          OR (p_channel = 'sms' AND u.contact_phone = v_contact)
        )
        AND (
          u.scope = 'global'
          OR (u.scope = 'brand' AND u.brand_id = p_brand_id)
          OR (u.scope = 'account' AND u.account_id = p_user_id)
        )
    ) THEN
      RETURN false;
    END IF;
  END IF;

  -- No pref row → default on (after mute + unsubscribe gates).
  RETURN true;
END;
$f$;

REVOKE ALL ON FUNCTION public.biz_brand_follow_channel_ok(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_brand_follow_channel_ok(uuid, uuid, text)
  TO service_role;

-- Circle contact authorizer: also honour marketing_unsubscribes (blast link).
CREATE OR REPLACE FUNCTION public.issue_1778_circle_authorized_contact(
  p_brand_id uuid, p_user_id uuid, p_channel text
) RETURNS TABLE(normalized_contact text, allowed boolean, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_contact text; v_allowed boolean;
BEGIN
  IF p_channel NOT IN('email','sms') THEN
    RETURN QUERY SELECT NULL::text,false,'channel_unavailable'::text; RETURN;
  END IF;
  SELECT i.value INTO v_contact
  FROM public.verified_account_identifiers(p_user_id) i
  WHERE i.kind=CASE WHEN p_channel='sms' THEN 'phone' ELSE 'email' END
  ORDER BY i.value LIMIT 1;
  IF v_contact IS NULL THEN
    RETURN QUERY SELECT NULL::text,false,'channel_unavailable'::text; RETURN;
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.brand_circle_exits x
    WHERE x.brand_id=p_brand_id AND x.user_id=p_user_id
      AND (x.visibility_exited_at IS NOT NULL OR x.delivery_exited_at IS NOT NULL)
  ) THEN RETURN QUERY SELECT v_contact,false,'delivery_denied'::text; RETURN; END IF;
  IF EXISTS (
    SELECT 1
    FROM public.marketing_unsubscribes u
    WHERE u.channel IN (p_channel, 'all')
      AND (
        (p_channel = 'email' AND lower(u.contact_email) = lower(v_contact))
        OR (p_channel = 'sms' AND u.contact_phone = v_contact)
      )
      AND (
        u.scope = 'global'
        OR (u.scope = 'brand' AND u.brand_id = p_brand_id)
        OR (u.scope = 'account' AND u.account_id = p_user_id)
      )
  ) THEN
    RETURN QUERY SELECT v_contact,false,'unsubscribed'::text; RETURN;
  END IF;
  v_allowed:=public.can_send(p_user_id,'marketing_blast',p_channel,v_contact);
  RETURN QUERY SELECT v_contact,v_allowed,CASE WHEN v_allowed THEN 'allowed' ELSE 'can_send_denied' END;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_1778_circle_authorized_contact(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1778_circle_authorized_contact(uuid,uuid,text) TO service_role;

-- Quote/confirm: same follower mute + channel eligibility as dispatch.
CREATE OR REPLACE FUNCTION public.biz_marketing_circle_quote_candidates_v1(
  p_actor_id uuid,p_campaign_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE; v_audience public.marketing_audiences%ROWTYPE;
  v_kind text; v_ring text; v_scope record; v_snapshot bigint; v_rows jsonb; v_selected integer;
BEGIN
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id=p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'circle_blast_audience_not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_audience FROM public.marketing_audiences
  WHERE id=v_campaign.audience_id AND brand_id=v_campaign.brand_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'circle_blast_audience_not_found' USING ERRCODE='P0002'; END IF;
  v_kind:=v_audience.query_definition->>'kind';
  IF v_kind NOT IN('brand_followers','brand_circle_extended') OR NOT v_audience.is_system_generated
    OR v_audience.query_definition IS DISTINCT FROM jsonb_build_object('kind',v_kind,'brand_id',v_campaign.brand_id::text)
  THEN RAISE EXCEPTION 'circle_blast_audience_not_found' USING ERRCODE='P0002'; END IF;
  IF v_campaign.status<>'draft' OR v_campaign.channel NOT IN('email','sms')
    OR public.biz_brand_effective_rank(v_campaign.brand_id,p_actor_id)<public.biz_role_rank('marketing_manager')
  THEN RAISE EXCEPTION 'circle_blast_forbidden' USING ERRCODE='42501'; END IF;
  IF NOT public.issue_1995_flags_enabled()
    OR NOT public.issue_1778_ring_channel_enabled(v_kind,v_campaign.channel)
  THEN RAISE EXCEPTION 'circle_blast_flag_disabled' USING ERRCODE='55000'; END IF;
  v_ring:=CASE v_kind WHEN 'brand_followers' THEN 'follower' ELSE 'extended' END;
  SELECT * INTO v_scope FROM public.issue_1777_brand_reach_scope_status(v_campaign.brand_id,v_ring);
  SELECT snapshot_version INTO v_snapshot FROM public.brand_reach_refresh_state WHERE brand_id=v_campaign.brand_id;
  IF v_scope.scope_state IS DISTINCT FROM 'ready' OR v_scope.generation_id IS NULL OR v_snapshot IS NULL
  THEN RAISE EXCEPTION 'circle_blast_snapshot_stale' USING ERRCODE='23514'; END IF;

  WITH selected AS MATERIALIZED (
    SELECT rm.* FROM public.brand_reach_members rm
    WHERE rm.brand_id=v_campaign.brand_id AND rm.ring=v_ring AND rm.generation_id=v_scope.generation_id
      AND NOT EXISTS(SELECT 1 FROM public.blocked_users b WHERE
        (b.blocker_id=p_actor_id AND b.blocked_id=rm.user_id) OR
        (b.blocker_id=rm.user_id AND b.blocked_id=p_actor_id))
      -- #3682 Wave 2.6 — mute + channel prefs at quote time (followers only).
      AND (
        v_kind <> 'brand_followers'
        OR public.biz_brand_follow_channel_ok(rm.user_id, rm.brand_id, v_campaign.channel)
      )
  ), candidates AS MATERIALIZED (
    SELECT s.*,a.normalized_contact,COALESCE(a.allowed,false) allowed,
      COALESCE(a.reason,'channel_unavailable') reason
    FROM selected s
    LEFT JOIN LATERAL public.issue_1778_circle_authorized_contact(v_campaign.brand_id,s.user_id,v_campaign.channel) a ON true
  )
  SELECT count(*)::integer,
    COALESCE(jsonb_agg(jsonb_build_object(
      'brandPersonId',member_id,'recipientUserId',user_id,'ring',ring,
      'snapshotVersion',v_snapshot,'contactMethodId',NULL,
      'normalizedContact',normalized_contact,'allowed',allowed,
      'safeReasonCode',CASE WHEN normalized_contact IS NULL THEN 'channel_unavailable' ELSE reason END
    ) ORDER BY member_id),'[]'::jsonb)
  INTO v_selected,v_rows FROM candidates;

  RETURN jsonb_build_object(
    'brandId',v_campaign.brand_id,'channel',v_campaign.channel,'selectedCount',v_selected,
    'content',v_campaign.channel_payload,'candidates',v_rows,'audienceId',v_audience.id,
    'audienceKind',v_kind,'audienceVersion',v_snapshot,'audienceName',v_audience.name
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_marketing_circle_quote_candidates_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_marketing_circle_quote_candidates_v1(uuid,uuid) TO service_role;

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
  -- Circle quote/send only supports email/sms today; map campaign.channel 1:1.
  v_pref_channel:=v_campaign.channel;

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
