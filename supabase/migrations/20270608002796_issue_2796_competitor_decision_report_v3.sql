-- ISSUE-2796 — additive, negotiated competitor decision report v3.

ALTER TABLE public.tool_competitor_briefs
  ADD COLUMN IF NOT EXISTS decision_report jsonb;

CREATE OR REPLACE FUNCTION public.issue_2796_valid_decision_report(
  p_report jsonb,
  p_what_changed jsonb,
  p_why_it_matters jsonb,
  p_worth_doing jsonb,
  p_evidence jsonb
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path='public'
AS $function$
DECLARE
  item jsonb;
  ref text;
  idx integer;
  ids text[] := ARRAY[]::text[];
  evidence_ids text[] := ARRAY[]::text[];
  signal_ids text[] := ARRAY[]::text[];
  owner_ids text[] := ARRAY[]::text[];
  action_ids text[] := ARRAY[]::text[];
  primary_count integer := 0;
  synthesis_theme_count integer := 0;
  dimension text;
BEGIN
  IF jsonb_typeof(p_report) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_report)) <> 7
    OR NOT p_report ?& ARRAY['decision','signals','signal_evidence','interpretation_meta','comparisons','action_plan','owner_facts']
  THEN RETURN false; END IF;

  IF jsonb_typeof(p_report->'signal_evidence') <> 'array'
    OR jsonb_array_length(p_report->'signal_evidence') NOT BETWEEN 1 AND 8
  THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_report->'signal_evidence') LOOP
    IF jsonb_typeof(item) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 6
      OR NOT item ?& ARRAY['id','source_id','source_url','observation','checked_at','observed_at']
      OR length(btrim(item->>'id')) NOT BETWEEN 1 AND 64
      OR item->>'id' = ANY(evidence_ids)
      OR length(btrim(item->>'source_id')) NOT BETWEEN 1 AND 64
      OR length(btrim(item->>'source_url')) NOT BETWEEN 1 AND 2048
      OR item->>'source_url' !~ '^https?://[^[:space:]/?#]+'
      OR length(btrim(item->>'observation')) NOT BETWEEN 1 AND 280
      OR item->>'observation' ~ '[[:cntrl:]]'
      OR item->>'checked_at' !~ '^\d{4}-\d{2}-\d{2}T'
      OR (item->'observed_at' <> 'null'::jsonb AND item->>'observed_at' !~ '^\d{4}-\d{2}-\d{2}T')
      OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_evidence) base
        WHERE base->>'source_id'=item->>'source_id'
          AND base->>'public_url'=item->>'source_url'
      )
    THEN RETURN false; END IF;
    PERFORM (item->>'checked_at')::timestamptz;
    IF item->'observed_at' <> 'null'::jsonb THEN
      PERFORM (item->>'observed_at')::timestamptz;
    END IF;
    evidence_ids := array_append(evidence_ids,item->>'id');
  END LOOP;

  IF jsonb_typeof(p_report->'signals') <> 'array'
    OR jsonb_array_length(p_report->'signals') NOT BETWEEN 1 AND 6
  THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_report->'signals') LOOP
    IF jsonb_typeof(item) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 10
      OR NOT item ?& ARRAY['id','kind','derivation','dimension','label','summary','source_id','evidence_ids','metrics','changed_paths']
      OR length(btrim(item->>'id')) NOT BETWEEN 1 AND 64 OR item->>'id'=ANY(signal_ids)
      OR item->>'kind' NOT IN ('profile','website','content','theme','cadence','format','delta')
      OR item->>'derivation' NOT IN ('deterministic','synthesis')
      OR item->>'dimension' NOT IN ('category','positioning','event_theme','offer','content_cadence','source_presence')
      OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 60
      OR length(btrim(item->>'summary')) NOT BETWEEN 1 AND 180
      OR jsonb_typeof(item->'evidence_ids') <> 'array'
      OR jsonb_array_length(item->'evidence_ids') NOT BETWEEN 1 AND 3
      OR jsonb_typeof(item->'metrics') <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(item->'metrics')) <> 4
      OR NOT item->'metrics' ?& ARRAY['posts_7d','posts_28d','images_28d','videos_28d']
      OR jsonb_typeof(item->'changed_paths') <> 'array'
      OR jsonb_array_length(item->'changed_paths') > 8
    THEN RETURN false; END IF;
    FOR ref IN SELECT jsonb_array_elements_text(item->'evidence_ids') LOOP
      IF NOT ref=ANY(evidence_ids) OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_report->'signal_evidence') ev
        WHERE ev->>'id'=ref AND ev->>'source_id'=item->>'source_id'
      ) THEN RETURN false; END IF;
    END LOOP;
    FOR ref IN SELECT jsonb_array_elements_text(item->'changed_paths') LOOP
      IF length(btrim(ref)) NOT BETWEEN 1 AND 80 THEN RETURN false; END IF;
    END LOOP;
    FOREACH ref IN ARRAY ARRAY['posts_7d','posts_28d','images_28d','videos_28d'] LOOP
      IF item->'metrics'->ref <> 'null'::jsonb AND (
        jsonb_typeof(item->'metrics'->ref) <> 'number'
        OR (item->'metrics'->>ref)::numeric <> trunc((item->'metrics'->>ref)::numeric)
        OR (item->'metrics'->>ref)::integer NOT BETWEEN 0 AND 20
      ) THEN RETURN false; END IF;
    END LOOP;
    IF item->>'derivation'='synthesis' THEN
      IF item->>'kind'<>'theme' OR jsonb_array_length(item->'changed_paths')<>0
        OR EXISTS (SELECT 1 FROM jsonb_each(item->'metrics') m WHERE m.value<>'null'::jsonb)
      THEN RETURN false; END IF;
      synthesis_theme_count := synthesis_theme_count + 1;
    ELSIF item->>'kind'='theme' THEN RETURN false;
    END IF;
    signal_ids := array_append(signal_ids,item->>'id');
  END LOOP;
  IF synthesis_theme_count > 2 THEN RETURN false; END IF;

  IF jsonb_typeof(p_report->'owner_facts') <> 'array'
    OR jsonb_array_length(p_report->'owner_facts') NOT BETWEEN 1 AND 11
  THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_report->'owner_facts') LOOP
    IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>5
      OR NOT item ?& ARRAY['id','kind','entity_id','dimension','text']
      OR length(btrim(item->>'id')) NOT BETWEEN 1 AND 64 OR item->>'id'=ANY(owner_ids)
      OR item->>'kind' NOT IN ('listing_category','event_title','event_description')
      OR (item->>'entity_id')::text !~ '^[0-9a-fA-F-]{36}$'
      OR item->>'dimension' NOT IN ('category','positioning','event_theme','offer','content_cadence','source_presence')
      OR length(btrim(item->>'text')) NOT BETWEEN 1 AND 240
    THEN RETURN false; END IF;
    PERFORM (item->>'entity_id')::uuid;
    owner_ids := array_append(owner_ids,item->>'id');
  END LOOP;

  item := p_report->'decision';
  IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>6
    OR NOT item ?& ARRAY['class','confidence','headline','rationale','signal_ids','owner_fact_ids']
    OR item->>'class' NOT IN ('watch','opportunity','act')
    OR item->>'confidence' NOT IN ('high','medium','low')
    OR length(btrim(item->>'headline')) NOT BETWEEN 1 AND 160
    OR length(btrim(item->>'rationale')) NOT BETWEEN 1 AND 240
    OR jsonb_typeof(item->'signal_ids')<>'array' OR jsonb_array_length(item->'signal_ids') NOT BETWEEN 1 AND 3
    OR jsonb_typeof(item->'owner_fact_ids')<>'array' OR jsonb_array_length(item->'owner_fact_ids')>3
  THEN RETURN false; END IF;
  FOR ref IN SELECT jsonb_array_elements_text(item->'signal_ids') LOOP IF NOT ref=ANY(signal_ids) THEN RETURN false; END IF; END LOOP;
  FOR ref IN SELECT jsonb_array_elements_text(item->'owner_fact_ids') LOOP IF NOT ref=ANY(owner_ids) THEN RETURN false; END IF; END LOOP;

  IF jsonb_typeof(p_report->'interpretation_meta')<>'array'
    OR jsonb_array_length(p_report->'interpretation_meta')<>jsonb_array_length(p_why_it_matters)
  THEN RETURN false; END IF;
  idx := 0;
  FOR item IN SELECT value FROM jsonb_array_elements(p_report->'interpretation_meta') LOOP
    IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>6
      OR NOT item ?& ARRAY['index','signal_type','confidence','priority','signal_ids','owner_fact_ids']
      OR (item->>'index')::integer<>idx OR item->>'signal_type' NOT IN ('threat','opportunity','neutral')
      OR item->>'confidence' NOT IN ('high','medium','low') OR item->>'priority' NOT IN ('high','medium')
      OR jsonb_array_length(item->'signal_ids') NOT BETWEEN 1 AND 3 OR jsonb_array_length(item->'owner_fact_ids')>3
    THEN RETURN false; END IF;
    FOR ref IN SELECT jsonb_array_elements_text(item->'signal_ids') LOOP IF NOT ref=ANY(signal_ids) THEN RETURN false; END IF; END LOOP;
    FOR ref IN SELECT jsonb_array_elements_text(item->'owner_fact_ids') LOOP IF NOT ref=ANY(owner_ids) THEN RETURN false; END IF; END LOOP;
    idx := idx+1;
  END LOOP;

  IF jsonb_typeof(p_report->'comparisons')<>'array' OR jsonb_array_length(p_report->'comparisons')>5 THEN RETURN false; END IF;
  ids := ARRAY[]::text[];
  FOR item IN SELECT value FROM jsonb_array_elements(p_report->'comparisons') LOOP
    dimension := item->>'dimension';
    IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>8
      OR NOT item ?& ARRAY['id','dimension','owner_text','competitor_text','outcome','confidence','signal_ids','owner_fact_ids']
      OR length(btrim(item->>'id')) NOT BETWEEN 1 AND 64 OR item->>'id'=ANY(ids)
      OR dimension NOT IN ('category','positioning','event_theme','offer','content_cadence','source_presence')
      OR length(btrim(item->>'owner_text')) NOT BETWEEN 1 AND 140 OR length(btrim(item->>'competitor_text')) NOT BETWEEN 1 AND 140
      OR item->>'outcome' NOT IN ('owner_advantage','competitor_pressure','different','not_comparable')
      OR item->>'confidence' NOT IN ('high','medium','low')
      OR jsonb_array_length(item->'signal_ids') NOT BETWEEN 1 AND 3 OR jsonb_array_length(item->'owner_fact_ids')>3
      OR (item->>'outcome'<>'not_comparable' AND jsonb_array_length(item->'owner_fact_ids')=0)
    THEN RETURN false; END IF;
    FOR ref IN SELECT jsonb_array_elements_text(item->'signal_ids') LOOP
      IF NOT ref=ANY(signal_ids) OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_report->'signals') s WHERE s->>'id'=ref AND s->>'dimension'=dimension) THEN RETURN false; END IF;
    END LOOP;
    FOR ref IN SELECT jsonb_array_elements_text(item->'owner_fact_ids') LOOP
      IF NOT ref=ANY(owner_ids) OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_report->'owner_facts') f WHERE f->>'id'=ref AND f->>'dimension'=dimension) THEN RETURN false; END IF;
    END LOOP;
    ids := array_append(ids,item->>'id');
  END LOOP;

  IF jsonb_typeof(p_report->'action_plan')<>'array'
    OR jsonb_array_length(p_report->'action_plan')<>jsonb_array_length(p_worth_doing)
  THEN RETURN false; END IF;
  idx := 0;
  FOR item IN SELECT value FROM jsonb_array_elements(p_report->'action_plan') LOOP
    IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>9
      OR NOT item ?& ARRAY['index','action_id','timeframe','impact','confidence','order','is_primary','signal_ids','owner_fact_ids']
      OR (item->>'index')::integer<>idx OR item->>'action_id'<>p_worth_doing->idx->>'id'
      OR item->>'action_id'=ANY(action_ids)
      OR (item->>'order')::integer<>idx+1 OR item->>'timeframe' NOT IN ('this_week','this_month','bigger_project')
      OR item->>'impact' NOT IN ('high','medium') OR item->>'confidence' NOT IN ('high','medium','low')
      OR jsonb_typeof(item->'is_primary')<>'boolean'
      OR (item->>'is_primary')::boolean IS DISTINCT FROM (p_worth_doing->idx->>'is_primary')::boolean
      OR jsonb_array_length(item->'signal_ids') NOT BETWEEN 1 AND 3 OR jsonb_array_length(item->'owner_fact_ids')>3
    THEN RETURN false; END IF;
    IF (item->>'is_primary')::boolean THEN
      primary_count := primary_count+1;
      IF idx<>0 OR item->>'timeframe'<>'this_week' THEN RETURN false; END IF;
    END IF;
    FOR ref IN SELECT jsonb_array_elements_text(item->'signal_ids') LOOP IF NOT ref=ANY(signal_ids) THEN RETURN false; END IF; END LOOP;
    FOR ref IN SELECT jsonb_array_elements_text(item->'owner_fact_ids') LOOP IF NOT ref=ANY(owner_ids) THEN RETURN false; END IF; END LOOP;
    action_ids := array_append(action_ids,item->>'action_id');
    idx := idx+1;
  END LOOP;
  RETURN primary_count=1;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_2796_valid_decision_report(jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2796_valid_decision_report(jsonb,jsonb,jsonb,jsonb,jsonb) TO service_role;

DO $do$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.tool_competitor_briefs'::regclass
      AND contype='c' AND pg_get_constraintdef(oid) ~ 'schema_version = 2'
  LOOP EXECUTE format('ALTER TABLE public.tool_competitor_briefs DROP CONSTRAINT %I',c.conname); END LOOP;
END
$do$;

ALTER TABLE public.tool_competitor_briefs
  ADD CONSTRAINT tool_competitor_briefs_schema_version_check CHECK (schema_version IN (2,3)),
  ADD CONSTRAINT tool_competitor_briefs_decision_report_check CHECK (
    (schema_version=2 AND decision_report IS NULL)
    OR (schema_version=3 AND public.issue_2796_valid_decision_report(decision_report,what_changed,why_it_matters,worth_doing,evidence))
  );

CREATE OR REPLACE FUNCTION public.issue_2725_finish_job(p_job uuid,p_owner uuid,p_outcome text,p_safe_error text,p_expected_fp char(64),p_expected_caps jsonb,p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $function$
DECLARE j public.tool_competitor_refresh_jobs%rowtype; outcome text:=p_outcome; terminal_state text; brief_id uuid; now_at timestamptz:=now(); current_fp char(64); current_caps jsonb; transient boolean; payload_schema integer:=coalesce((p_payload->>'schema_version')::integer,2);
BEGIN
 IF outcome NOT IN ('publish','no_change','failure','cancel') THEN RAISE EXCEPTION 'invalid_outcome'; END IF;
 SELECT * INTO j FROM public.tool_competitor_refresh_jobs WHERE id=p_job AND state='leased' AND lease_owner=p_owner FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('applied',false,'reason','superseded'); END IF;
 current_fp:=public.issue_2725_source_set_fingerprint(j.competitor_id); current_caps:=public.issue_2725_capability_snapshot(j.competitor_id);
 IF outcome IN ('publish','no_change','failure') AND (j.source_set_fingerprint IS DISTINCT FROM p_expected_fp OR j.capability_snapshot IS DISTINCT FROM p_expected_caps OR current_fp IS DISTINCT FROM p_expected_fp OR current_caps IS DISTINCT FROM p_expected_caps) THEN outcome:='cancel'; p_safe_error:='superseded'; END IF;
 IF outcome='publish' THEN
  IF payload_schema NOT IN (2,3) OR (payload_schema=2 AND p_payload ? 'decision_report') OR (payload_schema=3 AND NOT p_payload ? 'decision_report') THEN RAISE EXCEPTION 'invalid_brief_schema'; END IF;
  terminal_state:=CASE WHEN p_payload->>'brief_status'='partial' THEN 'partial' ELSE 'succeeded' END;
  INSERT INTO public.tool_competitor_briefs(competitor_id,job_id,schema_version,status,updated_at,checked_at,source_set_fingerprint,observation_set_fingerprint,what_changed,why_it_matters,worth_doing,evidence,decision_report)
  VALUES(j.competitor_id,j.id,payload_schema,CASE WHEN terminal_state='partial' THEN 'partial' ELSE 'current' END,now_at,(p_payload->>'checked_at')::timestamptz,j.source_set_fingerprint,(p_payload->>'observation_set_fingerprint')::char(64),p_payload->'what_changed',p_payload->'why_it_matters',p_payload->'worth_doing',p_payload->'evidence',p_payload->'decision_report') RETURNING id INTO brief_id;
  UPDATE public.tool_competitors SET current_brief_id=brief_id,last_attempt_at=now_at,last_success_at=now_at,next_due_at=now_at+interval '7 days'+public.issue_2725_jitter(j.competitor_id),updated_at=now_at WHERE id=j.competitor_id;
  UPDATE public.tool_competitor_refresh_jobs SET state=terminal_state,lease_owner=NULL,leased_at=NULL,finished_at=now_at,updated_at=now_at WHERE id=j.id;
  UPDATE public.tool_competitor_budget_ledger SET state='settled',actual_microusd=reserved_microusd,settled_at=now_at WHERE job_id=j.id AND state='reserved';
  IF j.manual_tool_lead_id IS NOT NULL THEN UPDATE public.tool_leads SET status='report_ready',report=jsonb_build_object('meta',jsonb_build_object('schema_version',payload_schema),'kind','competitor_refresh_receipt','result','success','brief_id',brief_id) WHERE id=j.manual_tool_lead_id; END IF;
 ELSIF outcome='no_change' THEN
  terminal_state:='no_change';
  UPDATE public.tool_competitor_refresh_jobs SET state=terminal_state,lease_owner=NULL,leased_at=NULL,finished_at=now_at,updated_at=now_at WHERE id=j.id;
  UPDATE public.tool_competitor_budget_ledger SET state='settled',actual_microusd=reserved_microusd,settled_at=now_at WHERE job_id=j.id AND state='reserved';
  UPDATE public.tool_competitors SET last_attempt_at=now_at,last_success_at=now_at,next_due_at=now_at+interval '7 days'+public.issue_2725_jitter(j.competitor_id),updated_at=now_at WHERE id=j.competitor_id;
  UPDATE public.tool_competitor_sources SET last_checked_at=(p_payload->>'checked_at')::timestamptz WHERE competitor_id=j.competitor_id;
  IF j.manual_tool_lead_id IS NOT NULL THEN UPDATE public.tool_leads SET status='report_ready',report=jsonb_build_object('meta',jsonb_build_object('schema_version',2),'kind','competitor_refresh_receipt','result','no_change','brief_id',NULL) WHERE id=j.manual_tool_lead_id; END IF;
 ELSIF outcome='failure' THEN
  transient:=p_safe_error IN ('rate_limited','unreachable'); terminal_state:=CASE WHEN transient AND j.funding_lane='scheduled' AND j.attempt_count<3 THEN 'retry_wait' ELSE 'failed_terminal' END;
  UPDATE public.tool_competitor_refresh_jobs SET state=terminal_state,next_attempt_at=CASE WHEN terminal_state='retry_wait' THEN now_at+CASE WHEN j.attempt_count=1 THEN interval '6 hours' ELSE interval '24 hours' END ELSE NULL END,lease_owner=NULL,leased_at=NULL,finished_at=CASE WHEN terminal_state='failed_terminal' THEN now_at ELSE NULL END,last_safe_error_code=p_safe_error,updated_at=now_at WHERE id=j.id;
  IF terminal_state='failed_terminal' THEN UPDATE public.tool_competitor_budget_ledger SET state=CASE WHEN p_safe_error='model_usage_missing' THEN 'measurement_failed' ELSE 'settled' END,actual_microusd=CASE WHEN p_safe_error='model_usage_missing' THEN NULL ELSE 0 END,settled_at=now_at WHERE job_id=j.id AND state='reserved'; UPDATE public.tool_competitors SET last_attempt_at=now_at,next_due_at=now_at+interval '7 days'+public.issue_2725_jitter(j.competitor_id),updated_at=now_at WHERE id=j.competitor_id; IF j.manual_tool_lead_id IS NOT NULL THEN UPDATE public.tool_leads SET status='failed',report=NULL WHERE id=j.manual_tool_lead_id; END IF; END IF;
 ELSE
  terminal_state:='cancelled'; UPDATE public.tool_competitor_refresh_jobs SET state=terminal_state,lease_owner=NULL,leased_at=NULL,finished_at=now_at,last_safe_error_code=coalesce(p_safe_error,'superseded'),updated_at=now_at WHERE id=j.id;
  UPDATE public.tool_competitor_budget_ledger SET state='released',settled_at=now_at WHERE job_id=j.id AND state='reserved';
  IF j.manual_tool_lead_id IS NOT NULL THEN UPDATE public.tool_leads SET status='failed',report=NULL WHERE id=j.manual_tool_lead_id; END IF;
 END IF;
 RETURN jsonb_build_object('applied',true,'state',terminal_state,'brief_id',brief_id);
END
$function$;

REVOKE ALL ON FUNCTION public.issue_2725_finish_job(uuid,uuid,text,text,char(64),jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2725_finish_job(uuid,uuid,text,text,char(64),jsonb,jsonb) TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tool_competitor_briefs WHERE schema_version<>2 OR decision_report IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_2796_existing_briefs_must_remain_v2_null';
  END IF;
  IF public.issue_2796_valid_decision_report('{"unknown":true}'::jsonb,'[]','[]','[]','[]') THEN
    RAISE EXCEPTION 'issue_2796_validator_unknown_key_false_green';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tool_competitor_briefs') THEN
    RAISE EXCEPTION 'issue_2796_client_policy_forbidden';
  END IF;
  IF has_function_privilege('anon','public.issue_2796_valid_decision_report(jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.issue_2796_valid_decision_report(jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'issue_2796_validator_grant_forbidden';
  END IF;
END
$do$;
