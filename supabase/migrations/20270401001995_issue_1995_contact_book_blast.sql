-- Issue #1995: sealed Your Book marketing blasts.
BEGIN;

INSERT INTO public.feature_flags(flag_key,is_enabled,description)
VALUES('brand_book_blast_v1',false,'Dark launch: sealed Your Book marketing blasts')
ON CONFLICT(flag_key) DO NOTHING;

ALTER TABLE public.marketing_audiences
  DROP CONSTRAINT IF EXISTS marketing_audiences_query_kind_valid;
ALTER TABLE public.marketing_audiences
  ADD CONSTRAINT marketing_audiences_query_kind_valid CHECK (
    jsonb_typeof(query_definition)='object'
    AND (
      (query_definition->>'kind') IN ('brand_buyers','event_buyers','brand_followers','custom_segment','offering_send_group')
      OR (
        query_definition->>'kind'='all_brand_people'
        AND query_definition-ARRAY['kind','brand_id']='{}'::jsonb
        AND query_definition->>'brand_id'=brand_id::text
        AND is_system_generated
      )
    )
  );
CREATE UNIQUE INDEX IF NOT EXISTS issue_1995_one_book_audience_per_brand
  ON public.marketing_audiences(brand_id)
  WHERE is_system_generated AND query_definition->>'kind'='all_brand_people';

CREATE TABLE IF NOT EXISTS public.marketing_book_send_executions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL UNIQUE REFERENCES public.marketing_campaigns(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  quote_version smallint NOT NULL CHECK(quote_version=1),
  quote_hash text NOT NULL CHECK(quote_hash~'^[0-9a-f]{64}$'),
  content_hash text NOT NULL CHECK(content_hash~'^[0-9a-f]{64}$'),
  selected_count integer NOT NULL CHECK(selected_count>=0),
  reachable_count integer NOT NULL CHECK(reachable_count>=0),
  suppressed_count integer NOT NULL CHECK(suppressed_count>=0),
  unavailable_count integer NOT NULL CHECK(unavailable_count>=0),
  sms_segment_count integer NOT NULL CHECK(sms_segment_count>=0),
  estimated_cost_minor bigint CHECK(estimated_cost_minor IS NULL OR estimated_cost_minor>=0),
  currency text CHECK(currency IS NULL OR currency~'^[A-Z]{3}$'),
  cost_kind text NOT NULL CHECK(cost_kind IN ('provider_estimate','not_metered')),
  ratebook_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(ratebook_ids)='array'),
  source_references jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(source_references)='array'),
  quoted_at timestamptz NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  scheduled_for timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id,client_request_id),
  CHECK(selected_count=reachable_count+suppressed_count+unavailable_count),
  CHECK((cost_kind='not_metered' AND estimated_cost_minor IS NULL AND currency IS NULL)
     OR (cost_kind='provider_estimate' AND estimated_cost_minor IS NOT NULL AND currency IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.marketing_book_send_targets(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.marketing_book_send_executions(id) ON DELETE RESTRICT,
  brand_person_id uuid NOT NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  contact_method_id uuid REFERENCES public.brand_person_contact_methods(id) ON DELETE RESTRICT,
  contact_value_digest text CHECK(contact_value_digest IS NULL OR contact_value_digest~'^[0-9a-f]{64}$'),
  channel text NOT NULL CHECK(channel IN ('email','sms')),
  outcome text NOT NULL CHECK(outcome IN ('queued','suppressed','unavailable')),
  reason text NOT NULL CHECK(reason IN ('allowed','suppressed','can_send_denied','channel_unavailable')),
  segment_count integer NOT NULL DEFAULT 0 CHECK(segment_count>=0),
  allocated_cost_minor bigint CHECK(allocated_cost_minor IS NULL OR allocated_cost_minor>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(execution_id,brand_person_id,channel),
  UNIQUE(execution_id,contact_method_id),
  CHECK((outcome='unavailable' AND contact_method_id IS NULL AND contact_value_digest IS NULL)
     OR (outcome<>'unavailable' AND contact_method_id IS NOT NULL AND contact_value_digest IS NOT NULL))
);

ALTER TABLE public.marketing_book_send_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_book_send_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_book_send_executions,public.marketing_book_send_targets FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.marketing_book_send_executions,public.marketing_book_send_targets TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1995_reject_immutable_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
BEGIN RAISE EXCEPTION 'book_blast_execution_immutable' USING ERRCODE='42501'; END $f$;
REVOKE ALL ON FUNCTION public.issue_1995_reject_immutable_mutation() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS issue_1995_execution_immutable ON public.marketing_book_send_executions;
CREATE TRIGGER issue_1995_execution_immutable BEFORE UPDATE OR DELETE ON public.marketing_book_send_executions
FOR EACH ROW EXECUTE FUNCTION public.issue_1995_reject_immutable_mutation();
DROP TRIGGER IF EXISTS issue_1995_target_immutable ON public.marketing_book_send_targets;
CREATE TRIGGER issue_1995_target_immutable BEFORE UPDATE OR DELETE ON public.marketing_book_send_targets
FOR EACH ROW EXECUTE FUNCTION public.issue_1995_reject_immutable_mutation();

CREATE OR REPLACE FUNCTION public.biz_brand_person_authorized_contact_v2(
  p_brand_id uuid,p_brand_person_id uuid,p_channel text,p_category_key text
) RETURNS TABLE(contact_method_id uuid,recipient_user_id uuid,normalized_contact text,allowed boolean,reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_person uuid; v_method public.brand_person_contact_methods%ROWTYPE; v_linked_user uuid; v_suppressed boolean; v_can_send boolean;
BEGIN
 IF p_channel NOT IN ('email','sms','push') OR p_category_key NOT IN ('offering_invitation','marketing_blast') THEN
   RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,'invalid_request'::text; RETURN;
 END IF;
 v_person:=public.biz_brand_person_canonical(p_brand_person_id);
 SELECT linked_user_id INTO v_linked_user FROM public.brand_people
 WHERE id=v_person AND brand_id=p_brand_id AND record_status='active';
 IF NOT FOUND OR v_person<>p_brand_person_id THEN
   RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,'person_not_in_brand'::text; RETURN;
 END IF;
 IF p_channel='push' THEN
   v_can_send:=v_linked_user IS NOT NULL AND public.can_send(v_linked_user,p_category_key,'push',NULL);
   RETURN QUERY SELECT NULL::uuid,v_linked_user,NULL::text,v_can_send,
     CASE WHEN v_linked_user IS NULL THEN 'channel_unavailable' WHEN NOT v_can_send THEN 'can_send_denied' ELSE 'allowed' END; RETURN;
 END IF;
 SELECT * INTO v_method FROM public.brand_person_contact_methods
 WHERE brand_person_id=v_person AND brand_id=p_brand_id
   AND channel=CASE WHEN p_channel='sms' THEN 'phone' ELSE 'email' END
   AND record_state='active' AND provenance_scope='brand_owned' AND is_exportable
 ORDER BY is_primary DESC,created_at,id LIMIT 1;
 IF NOT FOUND THEN RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,'channel_unavailable'::text; RETURN; END IF;
 SELECT EXISTS(
   SELECT 1 FROM public.brand_person_channel_suppressions s WHERE s.brand_person_id=v_person
    AND s.channel=p_channel AND s.lifted_at IS NULL AND s.scope IN ('marketing','all')
   UNION ALL
   SELECT 1 FROM public.channel_suppressions s WHERE s.channel=p_channel AND s.scope IN ('marketing','all')
    AND (s.contact=v_method.normalized_value OR (v_linked_user IS NOT NULL AND s.user_id=v_linked_user))
 ) INTO v_suppressed;
 v_can_send:=public.can_send(v_linked_user,p_category_key,p_channel,v_method.normalized_value);
 RETURN QUERY SELECT v_method.id,v_linked_user,v_method.normalized_value,NOT v_suppressed AND v_can_send,
   CASE WHEN v_suppressed THEN 'suppressed' WHEN NOT v_can_send THEN 'can_send_denied' ELSE 'allowed' END;
END $f$;
REVOKE ALL ON FUNCTION public.biz_brand_person_authorized_contact_v2(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_brand_person_authorized_contact_v2(uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.biz_brand_person_authorized_contact(
 p_brand_id uuid,p_brand_person_id uuid,p_channel text,p_purpose text
) RETURNS TABLE(contact_method_id uuid,recipient_user_id uuid,normalized_contact text,allowed boolean,reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_person uuid; v_method public.brand_person_contact_methods%ROWTYPE; v_linked_user uuid; v_suppressed boolean; v_can_send boolean;
BEGIN
  IF p_channel NOT IN ('email','sms','push') OR p_purpose NOT IN ('marketing','transactional') THEN
    RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,'invalid_request'::text; RETURN;
  END IF;
  v_person := public.biz_brand_person_canonical(p_brand_person_id);
  SELECT linked_user_id INTO v_linked_user FROM public.brand_people WHERE id=v_person AND brand_id=p_brand_id AND record_status='active';
  IF NOT FOUND THEN RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,'person_not_in_brand'::text; RETURN; END IF;
  IF p_channel='push' THEN
    v_can_send := v_linked_user IS NOT NULL AND public.can_send(v_linked_user,'offering_invitation','push',NULL);
    RETURN QUERY SELECT NULL::uuid,v_linked_user,NULL::text,v_can_send,
      CASE WHEN v_linked_user IS NULL THEN 'channel_unavailable' WHEN NOT v_can_send THEN 'can_send_denied' ELSE 'allowed' END;
    RETURN;
  END IF;
  SELECT * INTO v_method FROM public.brand_person_contact_methods
    WHERE brand_person_id=v_person AND channel=CASE WHEN p_channel='sms' THEN 'phone' ELSE 'email' END
      AND record_state='active' AND provenance_scope='brand_owned' AND is_exportable
    ORDER BY is_primary DESC,created_at,id LIMIT 1;
  IF NOT FOUND THEN RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,'channel_unavailable'::text; RETURN; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.brand_person_channel_suppressions s
      WHERE s.brand_person_id=v_person AND s.channel=p_channel AND s.lifted_at IS NULL
        AND s.scope IN (CASE WHEN p_purpose='marketing' THEN 'marketing' ELSE 'all' END,'all')
    UNION ALL
    SELECT 1 FROM public.channel_suppressions s
      WHERE s.channel=p_channel AND s.scope IN (CASE WHEN p_purpose='marketing' THEN 'marketing' ELSE 'transactional' END,'all')
        AND (s.contact=v_method.normalized_value OR (v_linked_user IS NOT NULL AND s.user_id=v_linked_user))
  ) INTO v_suppressed;
  v_can_send := public.can_send(v_linked_user,'offering_invitation',p_channel,v_method.normalized_value);
  RETURN QUERY SELECT v_method.id,v_linked_user,v_method.normalized_value,NOT v_suppressed AND v_can_send,
    CASE WHEN v_suppressed THEN 'suppressed' WHEN NOT v_can_send THEN 'can_send_denied' ELSE 'allowed' END;
END;
$f$;
CREATE OR REPLACE FUNCTION public.biz_brand_person_authorized_contact_v1(
 p_brand_id uuid,p_brand_person_id uuid,p_channel text,p_purpose text
) RETURNS TABLE(contact_method_id uuid,recipient_user_id uuid,normalized_contact text,allowed boolean,reason text)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
 SELECT * FROM public.biz_brand_person_authorized_contact(p_brand_id,p_brand_person_id,p_channel,p_purpose)
$f$;
REVOKE ALL ON FUNCTION public.biz_brand_person_authorized_contact_v1(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_brand_person_authorized_contact_v1(uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1995_flags_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
 SELECT count(*)=2 FROM public.feature_flags WHERE flag_key IN ('contact_import_v1','brand_book_blast_v1') AND is_enabled
$f$;
REVOKE ALL ON FUNCTION public.issue_1995_flags_enabled() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1995_flags_enabled() TO service_role;

CREATE OR REPLACE FUNCTION public.biz_get_or_create_marketing_book_audience(p_actor_id uuid,p_brand_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $f$
DECLARE v_id uuid; v_count integer;
BEGIN
 IF auth.uid() IS DISTINCT FROM p_actor_id OR NOT public.issue_1995_flags_enabled()
   OR public.biz_brand_effective_rank(p_brand_id,p_actor_id)<public.biz_role_rank('event_manager') THEN
   RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE='42501'; END IF;
 SELECT id INTO v_id FROM public.marketing_audiences WHERE brand_id=p_brand_id AND is_system_generated
   AND query_definition=jsonb_build_object('kind','all_brand_people','brand_id',p_brand_id::text);
 IF v_id IS NULL THEN
   INSERT INTO public.marketing_audiences(account_id,brand_id,name,query_definition,is_system_generated)
   VALUES(p_actor_id,p_brand_id,'Your Book',jsonb_build_object('kind','all_brand_people','brand_id',p_brand_id::text),true)
   ON CONFLICT(brand_id) WHERE is_system_generated AND query_definition->>'kind'='all_brand_people'
   DO UPDATE SET updated_at=public.marketing_audiences.updated_at RETURNING id INTO v_id;
 END IF;
 SELECT count(*) INTO v_count FROM public.brand_people WHERE brand_id=p_brand_id AND record_status='active';
 RETURN jsonb_build_object('audienceId',v_id,'activeBookTotal',v_count);
END $f$;
REVOKE ALL ON FUNCTION public.biz_get_or_create_marketing_book_audience(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_get_or_create_marketing_book_audience(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_marketing_book_quote_candidates(p_actor_id uuid,p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_campaign public.marketing_campaigns%ROWTYPE; v_rows jsonb; v_selected integer;
BEGIN
 SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id=p_campaign_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT public.issue_1995_flags_enabled() THEN RAISE EXCEPTION 'book_blast_flag_disabled' USING ERRCODE='55000'; END IF;
 IF v_campaign.status<>'draft' OR v_campaign.channel NOT IN ('email','sms')
  OR public.biz_brand_effective_rank(v_campaign.brand_id,p_actor_id)<public.biz_role_rank('event_manager') THEN
  RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.marketing_audiences a WHERE a.id=v_campaign.audience_id AND a.brand_id=v_campaign.brand_id
   AND a.is_system_generated AND a.query_definition=jsonb_build_object('kind','all_brand_people','brand_id',v_campaign.brand_id::text)) THEN
   RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO v_selected FROM public.brand_people WHERE brand_id=v_campaign.brand_id AND record_status='active';
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'brandPersonId',p.id,'contactMethodId',a.contact_method_id,'normalizedContact',a.normalized_contact,
   'allowed',COALESCE(a.allowed,false),'safeReasonCode',CASE WHEN a.contact_method_id IS NULL THEN 'channel_unavailable' ELSE a.reason END
 ) ORDER BY p.id),'[]'::jsonb) INTO v_rows
 FROM public.brand_people p
 LEFT JOIN LATERAL public.biz_brand_person_authorized_contact_v2(v_campaign.brand_id,p.id,v_campaign.channel,'marketing_blast') a ON true
 WHERE p.brand_id=v_campaign.brand_id AND p.record_status='active';
 RETURN jsonb_build_object('brandId',v_campaign.brand_id,'channel',v_campaign.channel,'selectedCount',v_selected,
   'content',v_campaign.channel_payload,'candidates',v_rows);
END $f$;
REVOKE ALL ON FUNCTION public.biz_marketing_book_quote_candidates(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_marketing_book_quote_candidates(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.biz_confirm_marketing_book_send_v1(
 p_actor_id uuid,p_campaign_id uuid,p_client_request_id uuid,p_quote_snapshot jsonb,p_scheduled_for timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $f$
DECLARE v_campaign public.marketing_campaigns%ROWTYPE; v_existing public.marketing_book_send_executions%ROWTYPE; v_execution uuid;
 v_candidates jsonb; v_row jsonb; v_now timestamptz:=now();
BEGIN
 IF jsonb_typeof(p_quote_snapshot)<>'object' OR (p_quote_snapshot->>'quoteVersion')::int<>1
  OR COALESCE(p_quote_snapshot->>'quoteHash','')!~'^[0-9a-f]{64}$'
  OR COALESCE(p_quote_snapshot->>'contentHash','')!~'^[0-9a-f]{64}$'
  OR jsonb_typeof(p_quote_snapshot->'content')<>'object'
  OR (p_quote_snapshot->>'quotedAt')::timestamptz < v_now-interval '5 minutes' THEN
  RAISE EXCEPTION 'book_blast_preview_stale' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_existing FROM public.marketing_book_send_executions WHERE brand_id=(p_quote_snapshot->>'brandId')::uuid AND client_request_id=p_client_request_id;
 IF FOUND THEN
  IF v_existing.campaign_id=p_campaign_id AND v_existing.quote_hash=p_quote_snapshot->>'quoteHash' THEN
   RETURN jsonb_build_object('executionId',v_existing.id,'campaignId',v_existing.campaign_id,'scheduledFor',v_existing.scheduled_for);
  END IF;
  RAISE EXCEPTION 'book_blast_idempotency_conflict' USING ERRCODE='23505';
 END IF;
 v_candidates:=public.biz_marketing_book_quote_candidates(p_actor_id,p_campaign_id);
 SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id=p_campaign_id FOR UPDATE;
 IF v_campaign.channel_payload IS DISTINCT FROM p_quote_snapshot->'content'
  OR (v_candidates->>'selectedCount')::int IS DISTINCT FROM (p_quote_snapshot->>'selectedCount')::int
  OR (SELECT jsonb_agg(jsonb_build_object('brandPersonId',x->>'brandPersonId','contactMethodId',x->>'contactMethodId','normalizedContact',x->>'normalizedContact','allowed',x->>'allowed','safeReasonCode',x->>'safeReasonCode') ORDER BY x->>'brandPersonId') FROM jsonb_array_elements(v_candidates->'candidates') x)
     IS DISTINCT FROM
     (SELECT jsonb_agg(jsonb_build_object('brandPersonId',x->>'brandPersonId','contactMethodId',x->>'contactMethodId','normalizedContact',x->>'normalizedContact','allowed',x->>'allowed','safeReasonCode',x->>'safeReasonCode') ORDER BY x->>'brandPersonId') FROM jsonb_array_elements(p_quote_snapshot->'candidates') x) THEN
  RAISE EXCEPTION 'book_blast_preview_stale' USING ERRCODE='23514'; END IF;
 IF (p_quote_snapshot->>'reachableCount')::int=0 THEN RAISE EXCEPTION 'book_blast_zero_recipients' USING ERRCODE='23514'; END IF;
 INSERT INTO public.marketing_book_send_executions(brand_id,campaign_id,actor_id,client_request_id,quote_version,quote_hash,content_hash,
  selected_count,reachable_count,suppressed_count,unavailable_count,sms_segment_count,estimated_cost_minor,currency,cost_kind,
  ratebook_ids,source_references,quoted_at,scheduled_for)
 VALUES(v_campaign.brand_id,p_campaign_id,p_actor_id,p_client_request_id,1,p_quote_snapshot->>'quoteHash',p_quote_snapshot->>'contentHash',
  (p_quote_snapshot->>'selectedCount')::int,(p_quote_snapshot->>'reachableCount')::int,(p_quote_snapshot->>'suppressedCount')::int,
  (p_quote_snapshot->>'unavailableCount')::int,(p_quote_snapshot->>'smsSegments')::int,NULLIF(p_quote_snapshot->>'estimatedCostMinor','')::bigint,
  NULLIF(p_quote_snapshot->>'currency',''),p_quote_snapshot->>'costKind',COALESCE(p_quote_snapshot->'rateIds','[]'),
  COALESCE(p_quote_snapshot->'sourceReferences','[]'),(p_quote_snapshot->>'quotedAt')::timestamptz,COALESCE(p_scheduled_for,v_now)) RETURNING id INTO v_execution;
 FOR v_row IN SELECT * FROM jsonb_array_elements(p_quote_snapshot->'candidates') LOOP
  INSERT INTO public.marketing_book_send_targets(execution_id,brand_person_id,contact_method_id,contact_value_digest,channel,outcome,reason,segment_count,allocated_cost_minor)
  VALUES(v_execution,(v_row->>'brandPersonId')::uuid,NULLIF(v_row->>'contactMethodId','')::uuid,
   CASE WHEN v_row->>'normalizedContact' IS NULL THEN NULL ELSE encode(extensions.digest(convert_to(v_row->>'normalizedContact','UTF8'),'sha256'),'hex') END,v_campaign.channel,
   CASE WHEN (v_row->>'contactMethodId') IS NULL THEN 'unavailable' WHEN (v_row->>'allowed')::boolean THEN 'queued' ELSE 'suppressed' END,
   COALESCE(v_row->>'safeReasonCode','allowed'),COALESCE((v_row->>'segments')::int,0),NULLIF(v_row->>'allocatedCostMinor','')::bigint);
 END LOOP;
 UPDATE public.marketing_campaigns SET status='scheduled',scheduled_for=COALESCE(p_scheduled_for,v_now),updated_at=v_now WHERE id=p_campaign_id AND status='draft';
 RETURN jsonb_build_object('executionId',v_execution,'campaignId',p_campaign_id,'scheduledFor',COALESCE(p_scheduled_for,v_now));
END $f$;
REVOKE ALL ON FUNCTION public.biz_confirm_marketing_book_send_v1(uuid,uuid,uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_confirm_marketing_book_send_v1(uuid,uuid,uuid,jsonb,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.biz_marketing_book_send_audience(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $f$
DECLARE v_campaign public.marketing_campaigns%ROWTYPE; v_rows jsonb;
BEGIN
 SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id=p_campaign_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.marketing_book_send_executions WHERE campaign_id=p_campaign_id) THEN
  RAISE EXCEPTION 'book_blast_unconfirmed' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('contact_key',t.brand_person_id::text,'display_name','Book contact','first_name','there',
  'raw_email',CASE WHEN v_campaign.channel='email' THEN a.normalized_contact END,'raw_phone',CASE WHEN v_campaign.channel='sms' THEN a.normalized_contact END,
  'order_count',0,'total_spend_minor',0,'total_spend_currency','USD','last_event_id',NULL,'last_event_name',NULL,'last_purchase_at',NULL,
  'email_marketing_ok',v_campaign.channel='email' AND a.allowed,'sms_marketing_ok',v_campaign.channel='sms' AND a.allowed) ORDER BY t.brand_person_id),'[]') INTO v_rows
 FROM public.marketing_book_send_targets t
 JOIN public.marketing_book_send_executions e ON e.id=t.execution_id
 JOIN LATERAL public.biz_brand_person_authorized_contact_v2(e.brand_id,t.brand_person_id,t.channel,'marketing_blast') a ON a.contact_method_id=t.contact_method_id AND a.allowed
 WHERE e.campaign_id=p_campaign_id AND t.outcome='queued'
   AND t.contact_value_digest=encode(extensions.digest(convert_to(a.normalized_contact,'UTF8'),'sha256'),'hex');
 RETURN jsonb_build_object('rows',v_rows,'brand_id',v_campaign.brand_id,'reach',jsonb_build_object('total',jsonb_array_length(v_rows),
  'reachable_email',CASE WHEN v_campaign.channel='email' THEN jsonb_array_length(v_rows) ELSE 0 END,
  'reachable_sms',CASE WHEN v_campaign.channel='sms' THEN jsonb_array_length(v_rows) ELSE 0 END));
END $f$;
REVOKE ALL ON FUNCTION public.biz_marketing_book_send_audience(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_marketing_book_send_audience(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mkt_claim_campaigns(p_limit integer DEFAULT 10,p_campaign_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,account_id uuid,brand_id uuid,audience_id uuid,channel text,channel_payload jsonb,name text,scheduled_for timestamptz)
LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
BEGIN
 RETURN QUERY UPDATE public.marketing_campaigns mc SET status='sending',updated_at=now()
 WHERE mc.id IN (SELECT c.id FROM public.marketing_campaigns c JOIN public.marketing_audiences a ON a.id=c.audience_id
  WHERE c.status='scheduled' AND c.scheduled_for<=now() AND (p_campaign_id IS NULL OR c.id=p_campaign_id)
   AND (a.query_definition->>'kind'<>'all_brand_people' OR EXISTS(SELECT 1 FROM public.marketing_book_send_executions e WHERE e.campaign_id=c.id))
  ORDER BY c.scheduled_for LIMIT p_limit FOR UPDATE OF c SKIP LOCKED)
 RETURNING mc.id,mc.account_id,mc.brand_id,mc.audience_id,mc.channel,mc.channel_payload,mc.name,mc.scheduled_for;
END $f$;
REVOKE ALL ON FUNCTION public.mkt_claim_campaigns(integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_claim_campaigns(integer,uuid) TO service_role;

COMMIT;
