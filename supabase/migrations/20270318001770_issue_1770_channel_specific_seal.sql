-- Issue #1770: a linked Mingla account is not part of an email/SMS
-- delivery target. Keep stale-input rejection non-retryable so PostgREST returns
-- control to offering-invite-dispatch instead of replaying the validation RPC.

CREATE OR REPLACE FUNCTION public.biz_seal_offering_execution_snapshot(
  p_actor_id uuid,p_selection jsonb,p_execution_snapshot jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, auth, pg_temp
AS $function$
DECLARE
  v_event uuid; v_brand uuid; v_purpose text; v_channels text[]; v_selection_hash text;
  v_live jsonb; v_candidate jsonb; v_live_candidate jsonb; v_campaign jsonb; v_sms jsonb;
  v_payload_hash text; v_payload_hashes text[]:='{}'; v_eligibility text; v_quote text; v_execution text;
  v_bytes bytea; v_index integer:=0; v_channel text; v_expected_cost bigint:=0; v_segments bigint:=0;
  v_alloc bigint:=0; v_candidate_count integer; v_previous_key text:=NULL; v_rate_ids text[]:='{}';
  v_replay_semantics boolean:=false;
BEGIN
  IF p_execution_snapshot IS NULL OR octet_length(convert_to(p_execution_snapshot::text,'UTF8')) NOT BETWEEN 1 AND 262144
    OR public.issue_1770_json_keys(p_execution_snapshot)<>ARRAY['brandId','campaigns','candidates','channels','eligibilityHash','eventId','executionSnapshotHash','purpose','quote','quotedAt','schemaVersion','selectionHash']::text[]
    OR p_execution_snapshot->>'schemaVersion'<>'1' THEN
    RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023';
  END IF;
  BEGIN v_event:=(p_execution_snapshot->>'eventId')::uuid; v_brand:=(p_execution_snapshot->>'brandId')::uuid;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END;
  v_purpose:=p_execution_snapshot->>'purpose';
  SELECT array_agg(x ORDER BY ord) INTO v_channels FROM jsonb_array_elements_text(p_execution_snapshot->'channels') WITH ORDINALITY q(x,ord);
  IF v_purpose NOT IN ('invitation','reminder','retry_delivery') OR NOT public.issue_1770_channels_valid(v_channels)
    OR v_brand<>public.issue_1770_offering_actor_brand(p_actor_id,v_event,false) THEN
    RAISE EXCEPTION 'offering_send_actor_forbidden' USING ERRCODE='42501';
  END IF;
  v_selection_hash:=public.issue_1770_selection_hash(p_selection);
  IF p_execution_snapshot->>'selectionHash'<>v_selection_hash THEN RAISE EXCEPTION 'offering_execution_snapshot_stale' USING ERRCODE='22023'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.marketing_send_groups g WHERE g.event_id=v_event AND g.brand_id=v_brand
    AND g.created_by=p_actor_id AND g.execution_snapshot_hash=p_execution_snapshot->>'executionSnapshotHash') INTO v_replay_semantics;
  IF v_replay_semantics THEN v_live:=jsonb_build_object('candidates',p_execution_snapshot->'candidates');
  ELSE v_live:=public.biz_offering_send_quote_candidates(p_actor_id,v_event,v_purpose,p_selection,v_channels); END IF;
  IF NOT v_replay_semantics AND v_purpose='retry_delivery' AND 'push'=ANY(v_channels)
    AND p_execution_snapshot->'campaigns'->'push' IS DISTINCT FROM v_live->'retryPushPayload' THEN
    RAISE EXCEPTION 'retry_payload_mismatch' USING ERRCODE='22023';
  END IF;
  v_candidate_count:=jsonb_array_length(p_execution_snapshot->'candidates');
  IF v_candidate_count NOT BETWEEN 1 AND 500 OR v_candidate_count<>jsonb_array_length(v_live->'candidates') THEN
    RAISE EXCEPTION 'offering_execution_snapshot_stale' USING ERRCODE='22023';
  END IF;
  IF public.issue_1770_json_keys(p_execution_snapshot->'campaigns')<>ARRAY['email','push','sms']::text[]
    OR public.issue_1770_json_keys(p_execution_snapshot->'quote')<>ARRAY['currency','estimatedCostMinor','quoteHash','rateIds','smsSegments']::text[] THEN
    RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023';
  END IF;
  FOREACH v_channel IN ARRAY ARRAY['email','push','sms']::text[] LOOP
    v_campaign:=p_execution_snapshot->'campaigns'->v_channel;
    IF v_channel=ANY(v_channels) AND (v_campaign IS NULL OR v_campaign='null'::jsonb) THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
    IF NOT(v_channel=ANY(v_channels)) AND v_campaign<>'null'::jsonb THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOREACH v_channel IN ARRAY v_channels LOOP
    v_campaign:=p_execution_snapshot->'campaigns'->v_channel;
    IF v_channel='email' THEN
      IF public.issue_1770_json_keys(v_campaign)<>ARRAY['bodyHtml','bodyText','embeddedEventIds','payloadHash','payloadVersion','subject','volatileLinkMarker']::text[]
        OR v_campaign->>'payloadVersion'<>'1' OR v_campaign->>'volatileLinkMarker'<>'__MINGLA_OFFERING_INVITE_URL_V1__'
        OR v_campaign->'embeddedEventIds'<>jsonb_build_array(v_event::text)
        OR octet_length(convert_to(v_campaign->>'subject','UTF8'))>200 OR octet_length(convert_to(v_campaign->>'bodyHtml','UTF8'))>50000
        OR octet_length(convert_to(v_campaign->>'bodyText','UTF8'))>10000
        OR (length(v_campaign->>'bodyHtml')-length(replace(v_campaign->>'bodyHtml','__MINGLA_OFFERING_INVITE_URL_V1__','')))/length('__MINGLA_OFFERING_INVITE_URL_V1__')<>1
        OR (length(v_campaign->>'bodyText')-length(replace(v_campaign->>'bodyText','__MINGLA_OFFERING_INVITE_URL_V1__','')))/length('__MINGLA_OFFERING_INVITE_URL_V1__')<>1
        THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
      v_bytes:=public.issue_1770_frame('mingla:offering-payload:v1')||public.issue_1770_frame(v_channel)||public.issue_1770_frame('1')
        ||public.issue_1770_frame(v_campaign->>'subject')||public.issue_1770_frame(v_campaign->>'bodyHtml')||public.issue_1770_frame(v_campaign->>'bodyText')
        ||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_campaign->>'volatileLinkMarker');
    ELSIF v_channel='sms' THEN
      IF public.issue_1770_json_keys(v_campaign)<>ARRAY['body','embeddedEventIds','payloadHash','payloadVersion','volatileLinkMarker']::text[]
        OR v_campaign->>'payloadVersion'<>'1' OR v_campaign->>'volatileLinkMarker'<>'__MINGLA_OFFERING_INVITE_URL_V1__'
        OR v_campaign->'embeddedEventIds'<>jsonb_build_array(v_event::text) OR octet_length(convert_to(v_campaign->>'body','UTF8'))>10000
        OR (length(v_campaign->>'body')-length(replace(v_campaign->>'body','__MINGLA_OFFERING_INVITE_URL_V1__','')))/length('__MINGLA_OFFERING_INVITE_URL_V1__')<>1
        THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
      v_bytes:=public.issue_1770_frame('mingla:offering-payload:v1')||public.issue_1770_frame(v_channel)||public.issue_1770_frame('1')
        ||public.issue_1770_frame(v_campaign->>'body')||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_campaign->>'volatileLinkMarker');
    ELSE
      IF public.issue_1770_json_keys(v_campaign)<>ARRAY['body','eventId','payloadHash','payloadVersion','title']::text[]
        OR v_campaign->>'payloadVersion'<>'1' OR v_campaign->>'eventId'<>v_event::text
        OR octet_length(convert_to(v_campaign->>'title','UTF8'))>200 OR octet_length(convert_to(v_campaign->>'body','UTF8'))>10000
        OR v_campaign::text LIKE '%__MINGLA_OFFERING_INVITE_URL_V1__%' THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
      v_bytes:=public.issue_1770_frame('mingla:offering-payload:v1')||public.issue_1770_frame(v_channel)||public.issue_1770_frame('1')
        ||public.issue_1770_frame(v_campaign->>'title')||public.issue_1770_frame(v_campaign->>'body')||public.issue_1770_frame(v_event::text);
    END IF;
    IF (v_campaign::text~'(?i)(oi=|javascript:|data:|http://)') OR v_campaign::text~E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]'
      OR regexp_replace(v_campaign::text,'https://(business\\.usemingla\\.com|cdn\\.usemingla\\.com|mingla\\.app|usemingla\\.com|www\\.usemingla\\.com)','', 'gi')~'(?i)https://' THEN
      RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023';
    END IF;
    v_payload_hash:=encode(extensions.digest(v_bytes,'sha256'),'hex');
    IF v_campaign->>'payloadHash'<>v_payload_hash THEN RAISE EXCEPTION 'offering_execution_hash_mismatch' USING ERRCODE='22023'; END IF;
    v_payload_hashes:=array_append(v_payload_hashes,v_payload_hash);
  END LOOP;
  v_bytes:=public.issue_1770_frame('mingla:offering-eligibility:v1')||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_brand::text)
    ||public.issue_1770_frame(v_purpose)||public.issue_1770_frame(v_selection_hash);
  FOR v_candidate IN SELECT value FROM jsonb_array_elements(p_execution_snapshot->'candidates') LOOP
    v_index:=v_index+1; v_live_candidate:=v_live->'candidates'->(v_index-1);
    IF public.issue_1770_json_keys(v_candidate)<>ARRAY['attemptKind','brandPersonId','candidateKey','channel','contactMethodId','inviteId','outcome','predecessorAttemptId','recipientUserId','safeReasonCode','smsQuote']::text[]
      OR v_previous_key IS NOT NULL AND v_candidate->>'candidateKey'<=v_previous_key
      OR (v_candidate->>'candidateKey')<>concat(v_candidate->>'brandPersonId',':',v_candidate->>'channel',':',COALESCE(v_candidate->>'contactMethodId',v_candidate->>'recipientUserId'))
      OR (NOT v_replay_semantics AND ((v_candidate->>'brandPersonId')<>(v_live_candidate->>'brandPersonId') OR (v_candidate->>'channel')<>(v_live_candidate->>'channel')
      OR (v_candidate->>'channel'<>'push' AND COALESCE(v_candidate->>'contactMethodId','')<>COALESCE(v_live_candidate->>'contactMethodId',''))
      OR (v_candidate->>'channel'='push' AND COALESCE(v_candidate->>'recipientUserId','')<>COALESCE(v_live_candidate->>'recipientUserId',''))
      OR COALESCE(v_candidate->>'inviteId','')<>COALESCE(v_live_candidate->>'inviteId','') OR COALESCE(v_candidate->>'predecessorAttemptId','')<>COALESCE(v_live_candidate->>'predecessorAttemptId','')
      OR (v_candidate->>'outcome')<>(CASE WHEN (v_live_candidate->>'allowed')::boolean THEN 'queued' ELSE 'suppressed' END)
      OR COALESCE(v_candidate->>'safeReasonCode','')<>COALESCE(v_live_candidate->>'safeReasonCode',''))) THEN
      RAISE EXCEPTION 'offering_execution_snapshot_stale' USING ERRCODE='22023';
    END IF;
    v_previous_key:=v_candidate->>'candidateKey';
    v_bytes:=v_bytes||public.issue_1770_frame(v_candidate->>'candidateKey')||public.issue_1770_frame(v_candidate->>'brandPersonId')
      ||public.issue_1770_frame(v_candidate->>'inviteId')||public.issue_1770_frame(v_candidate->>'predecessorAttemptId')||public.issue_1770_frame(v_candidate->>'channel')
      ||public.issue_1770_frame(v_candidate->>'contactMethodId')||public.issue_1770_frame(v_candidate->>'recipientUserId')||public.issue_1770_frame(v_candidate->>'outcome')
      ||public.issue_1770_frame(v_candidate->>'safeReasonCode')||public.issue_1770_frame(v_candidate->>'attemptKind');
  END LOOP;
  v_eligibility:=encode(extensions.digest(v_bytes,'sha256'),'hex');
  IF p_execution_snapshot->>'eligibilityHash'<>v_eligibility THEN RAISE EXCEPTION 'offering_execution_hash_mismatch' USING ERRCODE='22023'; END IF;
  BEGIN v_segments:=(p_execution_snapshot->'quote'->>'smsSegments')::bigint; v_expected_cost:=(p_execution_snapshot->'quote'->>'estimatedCostMinor')::bigint;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END;
  SELECT COALESCE(array_agg(x ORDER BY x),'{}') INTO v_rate_ids FROM jsonb_array_elements_text(p_execution_snapshot->'quote'->'rateIds') x;
  IF v_rate_ids<>ARRAY(SELECT DISTINCT unnest(v_rate_ids) ORDER BY 1) THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END IF;
  v_bytes:=public.issue_1770_frame('mingla:offering-quote:v1')||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_purpose);
  FOREACH v_channel IN ARRAY v_channels LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_channel); END LOOP;
  v_bytes:=v_bytes||public.issue_1770_frame(v_eligibility)||public.issue_1770_frame(v_segments::text)||public.issue_1770_frame(v_expected_cost::text)||public.issue_1770_frame(p_execution_snapshot->'quote'->>'currency');
  FOREACH v_payload_hash IN ARRAY v_rate_ids LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_payload_hash); END LOOP;
  FOREACH v_payload_hash IN ARRAY v_payload_hashes LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_payload_hash); END LOOP;
  FOR v_candidate IN
    SELECT value FROM jsonb_array_elements(p_execution_snapshot->'candidates')
    ORDER BY value->>'brandPersonId',value->>'channel',value->>'contactMethodId'
  LOOP
    v_bytes:=v_bytes||public.issue_1770_frame(v_candidate->>'candidateKey')||public.issue_1770_frame(v_candidate->>'outcome'); v_sms:=v_candidate->'smsQuote';
    IF v_sms IS NULL OR v_sms='null'::jsonb THEN v_bytes:=v_bytes||public.issue_1770_frame(NULL);
    ELSE
      IF public.issue_1770_json_keys(v_sms)<>ARRAY['allocatedCostMinor','country','currency','minorDenominator','minorNumerator','provider','rateId','segments']::text[] THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END IF;
      v_bytes:=v_bytes||public.issue_1770_frame(v_sms->>'segments')||public.issue_1770_frame(v_sms->>'rateId')||public.issue_1770_frame(v_sms->>'provider')||public.issue_1770_frame(v_sms->>'country')||public.issue_1770_frame(v_sms->>'currency')||public.issue_1770_frame(v_sms->>'minorNumerator')||public.issue_1770_frame(v_sms->>'minorDenominator')||public.issue_1770_frame(v_sms->>'allocatedCostMinor');
      v_alloc:=v_alloc+(v_sms->>'allocatedCostMinor')::bigint;
    END IF;
  END LOOP;
  IF v_alloc<>v_expected_cost THEN RAISE EXCEPTION 'offering_execution_cost_invalid' USING ERRCODE='22023'; END IF;
  v_quote:=encode(extensions.digest(v_bytes,'sha256'),'hex');
  IF p_execution_snapshot->'quote'->>'quoteHash'<>v_quote THEN RAISE EXCEPTION 'offering_execution_hash_mismatch' USING ERRCODE='22023'; END IF;
  v_bytes:=public.issue_1770_frame('mingla:offering-execution:v1')||public.issue_1770_frame('1')||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_brand::text)||public.issue_1770_frame(v_purpose);
  FOREACH v_channel IN ARRAY v_channels LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_channel); END LOOP;
  v_bytes:=v_bytes||public.issue_1770_frame(v_selection_hash)||public.issue_1770_frame(v_eligibility)||public.issue_1770_frame(v_quote);
  FOREACH v_payload_hash IN ARRAY v_payload_hashes LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_payload_hash); END LOOP;
  FOR v_candidate IN SELECT value FROM jsonb_array_elements(p_execution_snapshot->'candidates') LOOP
    v_bytes:=v_bytes||public.issue_1770_frame(v_candidate->>'candidateKey')||public.issue_1770_frame(v_candidate->>'brandPersonId')||public.issue_1770_frame(v_candidate->>'inviteId')||public.issue_1770_frame(v_candidate->>'predecessorAttemptId')||public.issue_1770_frame(v_candidate->>'channel')||public.issue_1770_frame(v_candidate->>'contactMethodId')||public.issue_1770_frame(v_candidate->>'recipientUserId')||public.issue_1770_frame(v_candidate->>'outcome')||public.issue_1770_frame(v_candidate->>'attemptKind');
  END LOOP;
  v_execution:=encode(extensions.digest(v_bytes,'sha256'),'hex');
  IF p_execution_snapshot->>'executionSnapshotHash'<>v_execution THEN RAISE EXCEPTION 'offering_execution_hash_mismatch' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('eligibilityHash',v_eligibility,'quoteHash',v_quote,'executionSnapshotHash',v_execution,'valid',true);
END;
$function$;
CREATE OR REPLACE FUNCTION public.biz_execute_offering_send_group(
  p_actor_id uuid,p_event_id uuid,p_purpose text,p_selection jsonb,p_channels text[],
  p_client_request_id uuid,p_execution_snapshot jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, auth, pg_temp
AS $function$
DECLARE
  v_brand uuid; v_existing public.marketing_send_groups%ROWTYPE; v_group_id uuid:=gen_random_uuid();
  v_predecessor public.brand_offering_invite_delivery_attempts%ROWTYPE;
  v_source_invite public.brand_offering_invites%ROWTYPE; v_source_group public.marketing_send_groups%ROWTYPE;
  v_seal jsonb; v_quoted_at timestamptz; v_candidate jsonb; v_campaign jsonb; v_campaign_id uuid;
  v_audience_id uuid; v_invite_id uuid; v_channel text; v_status text; v_ordinal smallint;
  v_campaign_ids jsonb:='[]'; v_selected integer; v_queued integer:=0; v_suppressed integer:=0;
  v_predecessor_id uuid; v_push_payload jsonb:=NULL; v_push_hash text:=NULL;
BEGIN
  IF p_event_id IS DISTINCT FROM (p_execution_snapshot->>'eventId')::uuid OR p_purpose IS DISTINCT FROM p_execution_snapshot->>'purpose'
    OR p_channels IS DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(p_execution_snapshot->'channels')) THEN
    RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END IF;
  v_brand:=public.issue_1770_offering_actor_brand(p_actor_id,p_event_id,true);
  SELECT * INTO v_existing FROM public.marketing_send_groups WHERE brand_id=v_brand AND client_request_id=p_client_request_id FOR UPDATE;
  IF v_existing.id IS NOT NULL AND v_existing.created_by<>p_actor_id THEN RAISE EXCEPTION 'idempotency_actor_mismatch' USING ERRCODE='23505'; END IF;
  v_seal:=public.biz_seal_offering_execution_snapshot(p_actor_id,p_selection,p_execution_snapshot);
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.execution_snapshot_hash<>p_execution_snapshot->>'executionSnapshotHash' THEN RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('groupId',v_existing.id,'status',v_existing.status,'selectedCount',v_existing.selected_count,
      'eligibleCount',v_existing.eligible_count,'reachableCount',v_existing.reachable_count,'suppressedCount',v_existing.suppressed_count,
      'estimatedCostMinor',v_existing.estimated_cost_minor,'currency',v_existing.currency,'replayed',true,
      'campaignIds',COALESCE((SELECT jsonb_agg(campaign_id ORDER BY campaign_id) FROM public.marketing_send_group_campaigns WHERE send_group_id=v_existing.id),'[]'));
  END IF;
  IF p_purpose='retry_delivery' THEN
    FOR v_predecessor_id IN
      SELECT DISTINCT (value->>'predecessorAttemptId')::uuid
      FROM jsonb_array_elements(p_execution_snapshot->'candidates') ORDER BY 1
    LOOP
      SELECT * INTO v_predecessor FROM public.brand_offering_invite_delivery_attempts
        WHERE id=v_predecessor_id FOR UPDATE;
      IF NOT FOUND OR v_predecessor.status<>'failed' OR NOT v_predecessor.is_retryable
        OR v_predecessor.provider_message_id IS NOT NULL
        OR NOT (v_predecessor.channel=ANY(p_channels))
        OR EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts later
          WHERE later.invite_id=v_predecessor.invite_id AND later.channel=v_predecessor.channel
            AND later.attempt_ordinal>v_predecessor.attempt_ordinal)
      THEN RAISE EXCEPTION 'retry_attempt_selection_mismatch' USING ERRCODE='22023'; END IF;
      SELECT * INTO v_source_invite FROM public.brand_offering_invites
        WHERE id=v_predecessor.invite_id FOR UPDATE;
      SELECT * INTO v_source_group FROM public.marketing_send_groups
        WHERE id=v_predecessor.send_group_id FOR UPDATE;
      IF v_source_invite.status<>'active' OR v_source_invite.superseded_by_invite_id IS NOT NULL
        OR v_source_invite.event_id<>p_event_id OR v_source_invite.brand_id<>v_brand
        OR v_source_group.event_id<>p_event_id OR v_source_group.brand_id<>v_brand THEN
        RAISE EXCEPTION 'retry_attempt_selection_mismatch' USING ERRCODE='22023';
      END IF;
      IF v_predecessor.channel='push' THEN
        IF NOT public.issue_1770_push_payload_valid(v_source_group.push_payload_v1,p_event_id,v_source_group.push_payload_hash) THEN
          RAISE EXCEPTION 'retry_payload_mismatch' USING ERRCODE='22023';
        END IF;
        IF v_push_payload IS NULL THEN
          v_push_payload:=v_source_group.push_payload_v1; v_push_hash:=v_source_group.push_payload_hash;
        ELSIF v_push_hash IS DISTINCT FROM v_source_group.push_payload_hash
          OR v_push_payload IS DISTINCT FROM v_source_group.push_payload_v1 THEN
          RAISE EXCEPTION 'retry_payload_mismatch' USING ERRCODE='22023';
        END IF;
      END IF;
    END LOOP;
    IF 'push'=ANY(p_channels) AND (v_push_payload IS NULL
      OR p_execution_snapshot->'campaigns'->'push' IS DISTINCT FROM v_push_payload) THEN
      RAISE EXCEPTION 'retry_payload_mismatch' USING ERRCODE='22023';
    END IF;
  ELSIF 'push'=ANY(p_channels) THEN
    v_push_payload:=p_execution_snapshot->'campaigns'->'push';
    v_push_hash:=v_push_payload->>'payloadHash';
  END IF;
  BEGIN v_quoted_at:=(p_execution_snapshot->>'quotedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END;
  IF v_quoted_at<now()-interval '5 minutes' OR v_quoted_at>now()+interval '30 seconds' THEN
    RAISE EXCEPTION 'offering_execution_snapshot_stale' USING ERRCODE='22023'; END IF;
  SELECT count(DISTINCT value->>'brandPersonId') INTO v_selected FROM jsonb_array_elements(p_execution_snapshot->'candidates');
  SELECT count(*) FILTER(WHERE value->>'outcome'='queued'),count(*) FILTER(WHERE value->>'outcome'='suppressed')
    INTO v_queued,v_suppressed FROM jsonb_array_elements(p_execution_snapshot->'candidates');
  INSERT INTO public.marketing_send_groups(id,event_id,brand_id,purpose,client_request_id,channels,selection_snapshot,
    selected_count,eligible_count,reachable_count,suppressed_count,skipped_count,queued_count,estimated_cost_minor,currency,
    eligibility_hash,quote_hash,quoted_at,execution_snapshot_hash,push_payload_v1,push_payload_hash,created_by)
  VALUES(v_group_id,p_event_id,v_brand,p_purpose,p_client_request_id,p_channels,
    jsonb_build_object('kind',p_selection->>'kind','selectionHash',p_execution_snapshot->>'selectionHash'),
    v_selected,v_selected,v_queued,v_suppressed,0,v_queued,(p_execution_snapshot->'quote'->>'estimatedCostMinor')::bigint,
    NULLIF(p_execution_snapshot->'quote'->>'currency','')::char(3),p_execution_snapshot->>'eligibilityHash',
    p_execution_snapshot->'quote'->>'quoteHash',v_quoted_at,p_execution_snapshot->>'executionSnapshotHash',
    v_push_payload,v_push_hash,p_actor_id);
  FOREACH v_channel IN ARRAY p_channels LOOP
    IF v_channel IN ('email','sms') THEN
      v_audience_id:=gen_random_uuid(); v_campaign_id:=gen_random_uuid(); v_campaign:=p_execution_snapshot->'campaigns'->v_channel;
      INSERT INTO public.marketing_audiences(id,account_id,brand_id,name,query_definition,is_system_generated)
        VALUES(v_audience_id,p_actor_id,v_brand,format('Offering send %s %s',left(v_group_id::text,8),v_channel),
          jsonb_build_object('kind','offering_send_group','send_group_id',v_group_id,'channel',v_channel),true);
      INSERT INTO public.marketing_campaigns(id,account_id,brand_id,audience_id,name,channel,channel_payload,status,scheduled_for)
        VALUES(v_campaign_id,p_actor_id,v_brand,v_audience_id,format('Offering %s',p_purpose),v_channel,
          CASE WHEN v_channel='email' THEN jsonb_build_object('kind','email','subject',v_campaign->>'subject','body_html',v_campaign->>'bodyHtml',
            'body_text',v_campaign->>'bodyText','embedded_events',v_campaign->'embeddedEventIds','volatile_link_marker',v_campaign->>'volatileLinkMarker','payload_hash',v_campaign->>'payloadHash')
          ELSE jsonb_build_object('kind','sms','body',v_campaign->>'body','embedded_events',v_campaign->'embeddedEventIds',
            'volatile_link_marker',v_campaign->>'volatileLinkMarker','payload_hash',v_campaign->>'payloadHash') END,
          'scheduled',now());
      INSERT INTO public.marketing_send_group_campaigns(send_group_id,campaign_id,channel) VALUES(v_group_id,v_campaign_id,v_channel);
      v_campaign_ids:=v_campaign_ids||jsonb_build_array(v_campaign_id);
    END IF;
  END LOOP;
  FOR v_candidate IN
    SELECT value FROM jsonb_array_elements(p_execution_snapshot->'candidates')
    ORDER BY value->>'brandPersonId',value->>'channel',value->>'contactMethodId'
  LOOP
    INSERT INTO public.brand_offering_invites(brand_id,event_id,brand_person_id,status,origin,invited_at,created_by,removed_at,removal_reason,superseded_by_invite_id)
      VALUES(v_brand,p_event_id,(v_candidate->>'brandPersonId')::uuid,'active','attached_blast',now(),p_actor_id,NULL,NULL,NULL)
      ON CONFLICT(event_id,brand_person_id) DO UPDATE SET status='active',removed_at=NULL,removal_reason=NULL,superseded_by_invite_id=NULL,updated_at=now()
      RETURNING id INTO v_invite_id;
    -- The namespace lock covers the read-and-increment through transaction end.
    -- Canonical candidate ordering above prevents opposite-order deadlocks when
    -- two groups overlap on more than one invite/channel namespace.
    v_ordinal:=public.issue_1770_next_attempt_ordinal(v_invite_id,v_candidate->>'channel');
    v_status:=CASE WHEN v_candidate->>'outcome'='queued' THEN 'queued' ELSE 'suppressed' END;
    SELECT campaign_id INTO v_campaign_id FROM public.marketing_send_group_campaigns WHERE send_group_id=v_group_id AND channel=v_candidate->>'channel';
    INSERT INTO public.brand_offering_invite_delivery_attempts(invite_id,send_group_id,campaign_id,contact_method_id,recipient_user_id,
      channel,attempt_kind,attempt_ordinal,retry_of_attempt_id,status,safe_reason_code,estimated_cost_minor,currency,queued_at)
    VALUES(v_invite_id,v_group_id,v_campaign_id,(v_candidate->>'contactMethodId')::uuid,(v_candidate->>'recipientUserId')::uuid,
      v_candidate->>'channel',v_candidate->>'attemptKind',v_ordinal,(v_candidate->>'predecessorAttemptId')::uuid,v_status,
      v_candidate->>'safeReasonCode',COALESCE((v_candidate->'smsQuote'->>'allocatedCostMinor')::bigint,0),
      NULLIF(v_candidate->'smsQuote'->>'currency','')::char(3),CASE WHEN v_status='queued' THEN now() END);
  END LOOP;
  RETURN jsonb_build_object('groupId',v_group_id,'status','queued','selectedCount',v_selected,'eligibleCount',v_selected,
    'reachableCount',v_queued,'suppressedCount',v_suppressed,'estimatedCostMinor',(p_execution_snapshot->'quote'->>'estimatedCostMinor')::bigint,
    'currency',p_execution_snapshot->'quote'->>'currency','replayed',false,'campaignIds',v_campaign_ids);
END;
$function$;
