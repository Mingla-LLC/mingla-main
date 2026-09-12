-- Issue #1778 / parent #876 — Brand Circle audiences join the sealed blast rail.
-- Delivery switches default OFF until #1779's every-address resolver lands.
BEGIN;

INSERT INTO public.feature_flags(flag_key,is_enabled,description)
VALUES
  ('brand_circle_followers_email_v1',false,'Followers email delivery on the sealed marketing rail'),
  ('brand_circle_followers_sms_v1',false,'Followers SMS delivery on the sealed marketing rail'),
  ('brand_circle_extended_email_v1',false,'Extended-circle email delivery on the sealed marketing rail'),
  ('brand_circle_extended_sms_v1',false,'Extended-circle SMS delivery on the sealed marketing rail')
ON CONFLICT(flag_key) DO NOTHING;

DO $preflight$
BEGIN
  IF to_regprocedure('public.issue_1777_brand_reach_scope_status(uuid,text)') IS NULL
    OR to_regprocedure('public.verified_account_identifiers(uuid)') IS NULL
    OR to_regprocedure('public.can_send(uuid,text,text,text)') IS NULL
  THEN RAISE EXCEPTION 'issue_1778_requires_circle_and_verified_identity_authorities';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.marketing_audiences a
    WHERE a.query_definition->>'kind'='brand_followers'
      AND NOT(
        a.is_system_generated
        AND a.brand_id IS NOT NULL
        AND a.query_definition-ARRAY['kind','brand_id']='{}'::jsonb
        AND a.query_definition->>'brand_id'=a.brand_id::text
      )
  ) THEN RAISE EXCEPTION 'issue_1778_malformed_legacy_follower_audience'; END IF;
END;
$preflight$;

ALTER TABLE public.marketing_audiences
  DROP CONSTRAINT IF EXISTS marketing_audiences_query_kind_valid;
ALTER TABLE public.marketing_audiences
  ADD CONSTRAINT marketing_audiences_query_kind_valid CHECK (
    jsonb_typeof(query_definition)='object' AND (
      (query_definition->>'kind') IN ('brand_buyers','event_buyers','custom_segment','offering_send_group')
      OR (query_definition->>'kind' IN ('all_brand_people','brand_followers','brand_circle_extended')
        AND query_definition-ARRAY['kind','brand_id']='{}'::jsonb
        AND query_definition->>'brand_id'=brand_id::text
        AND is_system_generated)
      OR (query_definition='{"kind":"manual_group"}'::jsonb
        AND brand_id IS NOT NULL AND NOT is_system_generated)
    )
  );

CREATE UNIQUE INDEX issue_1778_one_followers_audience_per_brand
  ON public.marketing_audiences(brand_id)
  WHERE is_system_generated AND query_definition->>'kind'='brand_followers';
CREATE UNIQUE INDEX issue_1778_one_extended_audience_per_brand
  ON public.marketing_audiences(brand_id)
  WHERE is_system_generated AND query_definition->>'kind'='brand_circle_extended';

ALTER TABLE public.marketing_book_send_targets
  ALTER COLUMN brand_person_id DROP NOT NULL,
  ADD COLUMN recipient_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN ring text,
  ADD COLUMN circle_snapshot_version bigint;
ALTER TABLE public.marketing_book_send_targets
  DROP CONSTRAINT IF EXISTS marketing_book_send_targets_reason_check,
  DROP CONSTRAINT IF EXISTS marketing_book_send_targets_check;
ALTER TABLE public.marketing_book_send_targets
  ADD CONSTRAINT issue_1778_target_reason CHECK(reason IN(
    'allowed','suppressed','can_send_denied','channel_unavailable','delivery_denied'
  )),
  ADD CONSTRAINT issue_1778_target_subject CHECK(
    (brand_person_id IS NOT NULL AND recipient_user_id IS NULL AND ring IS NULL AND circle_snapshot_version IS NULL)
    OR
    (brand_person_id IS NULL AND recipient_user_id IS NOT NULL AND ring IN('follower','extended') AND circle_snapshot_version IS NOT NULL)
  ),
  ADD CONSTRAINT issue_1778_target_delivery_shape CHECK(
    (outcome='unavailable' AND contact_method_id IS NULL AND contact_value_digest IS NULL)
    OR
    (outcome<>'unavailable' AND contact_value_digest IS NOT NULL AND
      (contact_method_id IS NOT NULL OR recipient_user_id IS NOT NULL))
  );
CREATE UNIQUE INDEX issue_1778_one_circle_target_per_execution
  ON public.marketing_book_send_targets(execution_id,recipient_user_id,channel)
  WHERE recipient_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_1778_ring_channel_enabled(p_kind text,p_channel text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
  SELECT count(*)=1 AND bool_and(is_enabled)
  FROM public.feature_flags
  WHERE flag_key=CASE
    WHEN p_kind='brand_followers' AND p_channel='email' THEN 'brand_circle_followers_email_v1'
    WHEN p_kind='brand_followers' AND p_channel='sms' THEN 'brand_circle_followers_sms_v1'
    WHEN p_kind='brand_circle_extended' AND p_channel='email' THEN 'brand_circle_extended_email_v1'
    WHEN p_kind='brand_circle_extended' AND p_channel='sms' THEN 'brand_circle_extended_sms_v1'
    ELSE '__invalid__' END
$function$;
REVOKE ALL ON FUNCTION public.issue_1778_ring_channel_enabled(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1778_ring_channel_enabled(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1778_circle_authorized_contact(
  p_brand_id uuid,p_user_id uuid,p_channel text
) RETURNS TABLE(normalized_contact text,allowed boolean,reason text)
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
  v_allowed:=public.can_send(p_user_id,'marketing_blast',p_channel,v_contact);
  RETURN QUERY SELECT v_contact,v_allowed,CASE WHEN v_allowed THEN 'allowed' ELSE 'can_send_denied' END;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_1778_circle_authorized_contact(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1778_circle_authorized_contact(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.biz_get_or_create_marketing_circle_audience_v1(
  p_actor_id uuid,p_brand_id uuid,p_audience_kind text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $function$
DECLARE v_id uuid; v_name text;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_actor_id
    OR p_audience_kind NOT IN('brand_followers','brand_circle_extended')
    OR public.biz_brand_effective_rank(p_brand_id,p_actor_id)<public.biz_role_rank('marketing_manager')
  THEN RAISE EXCEPTION 'circle_blast_forbidden' USING ERRCODE='42501'; END IF;
  v_name:=CASE p_audience_kind WHEN 'brand_followers' THEN 'Followers' ELSE 'Extended circle' END;
  SELECT id INTO v_id FROM public.marketing_audiences
  WHERE brand_id=p_brand_id AND is_system_generated
    AND query_definition=jsonb_build_object('kind',p_audience_kind,'brand_id',p_brand_id::text);
  IF v_id IS NULL THEN
    INSERT INTO public.marketing_audiences(account_id,brand_id,name,query_definition,is_system_generated)
    VALUES(p_actor_id,p_brand_id,v_name,jsonb_build_object('kind',p_audience_kind,'brand_id',p_brand_id::text),true)
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_id FROM public.marketing_audiences
    WHERE brand_id=p_brand_id AND is_system_generated
      AND query_definition=jsonb_build_object('kind',p_audience_kind,'brand_id',p_brand_id::text);
  END IF;
  RETURN jsonb_build_object('audienceId',v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_get_or_create_marketing_circle_audience_v1(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_get_or_create_marketing_circle_audience_v1(uuid,uuid,text) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.biz_confirm_marketing_circle_send_v1(
  p_actor_id uuid,p_campaign_id uuid,p_client_request_id uuid,p_quote_snapshot jsonb,p_scheduled_for timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $function$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE; v_existing public.marketing_book_send_executions%ROWTYPE;
  v_execution uuid; v_live jsonb; v_row jsonb; v_now timestamptz:=now();
BEGIN
  IF jsonb_typeof(p_quote_snapshot)<>'object' OR (p_quote_snapshot->>'quoteVersion')::int<>1
    OR COALESCE(p_quote_snapshot->>'quoteHash','')!~'^[0-9a-f]{64}$'
    OR COALESCE(p_quote_snapshot->>'contentHash','')!~'^[0-9a-f]{64}$'
    OR jsonb_typeof(p_quote_snapshot->'content')<>'object'
    OR (p_quote_snapshot->>'quotedAt')::timestamptz<v_now-interval '5 minutes'
  THEN RAISE EXCEPTION 'circle_blast_snapshot_stale' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_existing FROM public.marketing_book_send_executions
  WHERE brand_id=(p_quote_snapshot->>'brandId')::uuid AND client_request_id=p_client_request_id;
  IF FOUND THEN
    IF v_existing.actor_id=p_actor_id AND v_existing.campaign_id=p_campaign_id
      AND v_existing.quote_hash=p_quote_snapshot->>'quoteHash'
    THEN RETURN jsonb_build_object('executionId',v_existing.id,'campaignId',v_existing.campaign_id,'scheduledFor',v_existing.scheduled_for,'replay',true); END IF;
    RAISE EXCEPTION 'book_blast_idempotency_conflict' USING ERRCODE='23505';
  END IF;
  v_live:=public.biz_marketing_circle_quote_candidates_v1(p_actor_id,p_campaign_id);
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id=p_campaign_id FOR UPDATE;
  IF v_campaign.channel_payload IS DISTINCT FROM p_quote_snapshot->'content'
    OR v_live->>'audienceId' IS DISTINCT FROM p_quote_snapshot->>'audienceId'
    OR v_live->>'audienceKind' IS DISTINCT FROM p_quote_snapshot->>'audienceKind'
    OR (v_live->>'audienceVersion')::bigint IS DISTINCT FROM (p_quote_snapshot->>'audienceVersion')::bigint
    OR (v_live->>'selectedCount')::integer IS DISTINCT FROM (p_quote_snapshot->>'selectedCount')::integer
    OR (SELECT jsonb_agg(jsonb_build_object(
        'brandPersonId',x->>'brandPersonId','recipientUserId',x->>'recipientUserId','ring',x->>'ring',
        'snapshotVersion',x->>'snapshotVersion','normalizedContact',x->>'normalizedContact',
        'allowed',x->>'allowed','safeReasonCode',x->>'safeReasonCode') ORDER BY x->>'brandPersonId')
      FROM jsonb_array_elements(v_live->'candidates') x)
       IS DISTINCT FROM
      (SELECT jsonb_agg(jsonb_build_object(
        'brandPersonId',x->>'brandPersonId','recipientUserId',x->>'recipientUserId','ring',x->>'ring',
        'snapshotVersion',x->>'snapshotVersion','normalizedContact',x->>'normalizedContact',
        'allowed',x->>'allowed','safeReasonCode',x->>'safeReasonCode') ORDER BY x->>'brandPersonId')
      FROM jsonb_array_elements(p_quote_snapshot->'candidates') x)
  THEN RAISE EXCEPTION 'circle_blast_snapshot_stale' USING ERRCODE='23514'; END IF;
  IF (p_quote_snapshot->>'reachableCount')::integer=0
  THEN RAISE EXCEPTION 'book_blast_zero_recipients' USING ERRCODE='23514'; END IF;

  BEGIN
    INSERT INTO public.marketing_book_send_executions(
      brand_id,campaign_id,actor_id,client_request_id,quote_version,quote_hash,content_hash,
      selected_count,reachable_count,suppressed_count,unavailable_count,sms_segment_count,
      estimated_cost_minor,currency,cost_kind,ratebook_ids,source_references,quoted_at,scheduled_for,send_mode
    ) VALUES(
      v_campaign.brand_id,p_campaign_id,p_actor_id,p_client_request_id,1,p_quote_snapshot->>'quoteHash',p_quote_snapshot->>'contentHash',
      (p_quote_snapshot->>'selectedCount')::integer,(p_quote_snapshot->>'reachableCount')::integer,
      (p_quote_snapshot->>'suppressedCount')::integer,(p_quote_snapshot->>'unavailableCount')::integer,
      (p_quote_snapshot->>'smsSegments')::integer,NULLIF(p_quote_snapshot->>'estimatedCostMinor','')::bigint,
      NULLIF(p_quote_snapshot->>'currency',''),p_quote_snapshot->>'costKind',COALESCE(p_quote_snapshot->'rateIds','[]'),
      COALESCE(p_quote_snapshot->'sourceReferences','[]'),(p_quote_snapshot->>'quotedAt')::timestamptz,
      COALESCE(p_scheduled_for,v_now),CASE WHEN p_scheduled_for IS NULL THEN 'now' ELSE 'scheduled' END
    ) RETURNING id INTO v_execution;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.marketing_book_send_executions
    WHERE campaign_id=p_campaign_id OR (brand_id=v_campaign.brand_id AND client_request_id=p_client_request_id)
    ORDER BY (campaign_id=p_campaign_id) DESC LIMIT 1;
    IF FOUND AND v_existing.actor_id=p_actor_id AND v_existing.campaign_id=p_campaign_id
      AND v_existing.client_request_id=p_client_request_id AND v_existing.quote_hash=p_quote_snapshot->>'quoteHash'
    THEN RETURN jsonb_build_object('executionId',v_existing.id,'campaignId',v_existing.campaign_id,'scheduledFor',v_existing.scheduled_for,'replay',true); END IF;
    RAISE EXCEPTION 'book_blast_idempotency_conflict' USING ERRCODE='23505';
  END;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_quote_snapshot->'candidates') LOOP
    INSERT INTO public.marketing_book_send_targets(
      execution_id,brand_person_id,recipient_user_id,ring,circle_snapshot_version,
      contact_method_id,contact_value_digest,channel,outcome,reason,segment_count,allocated_cost_minor
    ) VALUES(
      v_execution,NULL,(v_row->>'recipientUserId')::uuid,v_row->>'ring',(v_row->>'snapshotVersion')::bigint,
      NULL,CASE WHEN v_row->>'normalizedContact' IS NULL THEN NULL ELSE
        encode(extensions.digest(convert_to(v_row->>'normalizedContact','UTF8'),'sha256'),'hex') END,
      v_campaign.channel,
      CASE WHEN v_row->>'normalizedContact' IS NULL THEN 'unavailable' WHEN (v_row->>'allowed')::boolean THEN 'queued' ELSE 'suppressed' END,
      COALESCE(v_row->>'safeReasonCode','allowed'),COALESCE((v_row->>'segments')::integer,0),
      NULLIF(v_row->>'allocatedCostMinor','')::bigint
    );
  END LOOP;
  UPDATE public.marketing_campaigns SET status='scheduled',scheduled_for=COALESCE(p_scheduled_for,v_now),updated_at=v_now
  WHERE id=p_campaign_id AND status='draft';
  RETURN jsonb_build_object('executionId',v_execution,'campaignId',p_campaign_id,'scheduledFor',COALESCE(p_scheduled_for,v_now),'replay',false);
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_confirm_marketing_circle_send_v1(uuid,uuid,uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_confirm_marketing_circle_send_v1(uuid,uuid,uuid,jsonb,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.biz_marketing_circle_send_audience_v1(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $function$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE; v_kind text; v_ring text; v_rows jsonb;
BEGIN
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id=p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'circle_blast_unconfirmed' USING ERRCODE='42501'; END IF;
  SELECT a.query_definition->>'kind' INTO v_kind FROM public.marketing_audiences a
  WHERE a.id=v_campaign.audience_id AND a.brand_id=v_campaign.brand_id;
  IF NOT FOUND OR v_kind NOT IN('brand_followers','brand_circle_extended')
    OR NOT EXISTS(SELECT 1 FROM public.marketing_book_send_executions e WHERE e.campaign_id=p_campaign_id)
  THEN RAISE EXCEPTION 'circle_blast_unconfirmed' USING ERRCODE='42501'; END IF;
  v_ring:=CASE v_kind WHEN 'brand_followers' THEN 'follower' ELSE 'extended' END;

  -- A confirmed campaign may run long after the five-minute roster cache has
  -- expired. Recompute only its sealed users from canonical sources so a
  -- removal/block/exit can shrink delivery without redirecting or expanding
  -- the audience. A delivery kill switch always shrinks to zero.
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
    SELECT r.user_id,r.ring
    FROM public.issue_1777_resolve_brand_circle_members(
      v_campaign.brand_id,v_ring,array(SELECT s.recipient_user_id FROM sealed s)
    ) r
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'contact_key',t.recipient_user_id::text,'display_name','Mingla member','first_name','there',
    'raw_email',CASE WHEN v_campaign.channel='email' THEN a.normalized_contact END,
    'raw_phone',CASE WHEN v_campaign.channel='sms' THEN a.normalized_contact END,
    'order_count',0,'total_spend_minor',0,'total_spend_currency','USD',
    'last_event_id',NULL,'last_event_name',NULL,'last_purchase_at',NULL,
    'email_marketing_ok',v_campaign.channel='email' AND a.allowed,
    'sms_marketing_ok',v_campaign.channel='sms' AND a.allowed
  ) ORDER BY t.recipient_user_id),'[]'::jsonb) INTO v_rows
  FROM sealed t
  JOIN live l ON l.user_id=t.recipient_user_id AND l.ring=t.ring
  JOIN LATERAL public.issue_1778_circle_authorized_contact(t.brand_id,t.recipient_user_id,t.channel) a ON a.allowed
  WHERE t.contact_value_digest=encode(extensions.digest(convert_to(a.normalized_contact,'UTF8'),'sha256'),'hex')
    AND NOT EXISTS(SELECT 1 FROM public.blocked_users b WHERE
      (b.blocker_id=t.actor_id AND b.blocked_id=t.recipient_user_id) OR
      (b.blocker_id=t.recipient_user_id AND b.blocked_id=t.actor_id));
  RETURN jsonb_build_object('rows',v_rows,'brand_id',v_campaign.brand_id,'reach',jsonb_build_object(
    'total',jsonb_array_length(v_rows),
    'reachable_email',CASE WHEN v_campaign.channel='email' THEN jsonb_array_length(v_rows) ELSE 0 END,
    'reachable_sms',CASE WHEN v_campaign.channel='sms' THEN jsonb_array_length(v_rows) ELSE 0 END));
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_marketing_circle_send_audience_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_marketing_circle_send_audience_v1(uuid) TO service_role;

-- All Book, Manual, and Circle campaigns are claimable only after a sealed execution exists.
CREATE OR REPLACE FUNCTION public.mkt_claim_campaigns(p_limit integer DEFAULT 10,p_campaign_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,account_id uuid,brand_id uuid,audience_id uuid,channel text,channel_payload jsonb,name text,scheduled_for timestamptz)
LANGUAGE plpgsql SET search_path=public,pg_temp AS $function$
BEGIN
  RETURN QUERY UPDATE public.marketing_campaigns mc SET status='sending',updated_at=now() WHERE mc.id IN(
    SELECT c.id FROM public.marketing_campaigns c JOIN public.marketing_audiences a ON a.id=c.audience_id
    WHERE c.status='scheduled' AND c.scheduled_for<=now() AND (p_campaign_id IS NULL OR c.id=p_campaign_id)
      AND (a.query_definition->>'kind' NOT IN('all_brand_people','manual_group','brand_followers','brand_circle_extended')
        OR EXISTS(SELECT 1 FROM public.marketing_book_send_executions e WHERE e.campaign_id=c.id))
    ORDER BY c.scheduled_for LIMIT p_limit FOR UPDATE OF c SKIP LOCKED)
  RETURNING mc.id,mc.account_id,mc.brand_id,mc.audience_id,mc.channel,mc.channel_payload,mc.name,mc.scheduled_for;
END;
$function$;
REVOKE ALL ON FUNCTION public.mkt_claim_campaigns(integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_claim_campaigns(integer,uuid) TO service_role;

ALTER FUNCTION public.issue_1778_ring_channel_enabled(text,text) OWNER TO postgres;
ALTER FUNCTION public.issue_1778_circle_authorized_contact(uuid,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.biz_get_or_create_marketing_circle_audience_v1(uuid,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.biz_marketing_circle_quote_candidates_v1(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.biz_confirm_marketing_circle_send_v1(uuid,uuid,uuid,jsonb,timestamptz) OWNER TO postgres;
ALTER FUNCTION public.biz_marketing_circle_send_audience_v1(uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.biz_marketing_circle_quote_candidates_v1(uuid,uuid) IS
  '#1778 DRAFT: circle quote is service-only, fresh, privacy-safe at the public boundary, and delivery-dark per ring/channel.';
COMMENT ON FUNCTION public.biz_marketing_circle_send_audience_v1(uuid) IS
  '#1778 DRAFT: confirmed Circle sends resolve immutable targets and revalidate membership, exits, blocks, verified identifier, digest, and can_send.';

COMMIT;
