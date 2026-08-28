-- ISSUE-2725 Amendment 8 — one hard, serialized $1 venue/week ceiling and
-- redacted, token-derived model accounting. Rollout remains off.

ALTER TABLE public.tool_competitor_budget_ledger
  ADD COLUMN venue_listing_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  ADD COLUMN iso_week date,
  ADD COLUMN pricing_version text;
UPDATE public.tool_competitor_budget_ledger b
SET venue_listing_id=j.venue_listing_id, iso_week=j.due_week
FROM public.tool_competitor_refresh_jobs j WHERE j.id=b.job_id;
ALTER TABLE public.tool_competitor_budget_ledger
  ALTER COLUMN venue_listing_id SET NOT NULL,
  ALTER COLUMN iso_week SET NOT NULL;
ALTER TABLE public.tool_competitor_budget_ledger DROP CONSTRAINT tool_competitor_budget_ledger_state_check;
ALTER TABLE public.tool_competitor_budget_ledger ADD CONSTRAINT tool_competitor_budget_ledger_state_check
  CHECK(state IN ('reserved','settled','released','measurement_failed'));

CREATE TABLE public.tool_competitor_venue_week_budget_boundaries (
  venue_listing_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  iso_week date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(venue_listing_id,iso_week)
);
CREATE TABLE public.tool_competitor_model_usage_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid REFERENCES public.tool_competitors(id) ON DELETE SET NULL,
  venue_listing_id uuid REFERENCES public.venue_listings(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.tool_competitor_refresh_jobs(id) ON DELETE SET NULL,
  model_id text NOT NULL, prompt_contract_version text NOT NULL,
  canonical_input_fingerprint char(64) NOT NULL,
  request_bytes integer NOT NULL CHECK(request_bytes BETWEEN 1 AND 65536),
  prompt_tokens integer CHECK(prompt_tokens>=0), candidate_tokens integer CHECK(candidate_tokens>=0),
  thinking_tokens integer CHECK(thinking_tokens>=0), total_tokens integer CHECK(total_tokens>=0),
  provider_model_version text, latency_ms integer NOT NULL CHECK(latency_ms>=0), finish_reason text,
  result_class text NOT NULL, pricing_version text NOT NULL,
  reserved_microusd bigint NOT NULL CHECK(reserved_microusd=50000),
  actual_microusd bigint CHECK(actual_microusd>=0 AND actual_microusd<=reserved_microusd),
  usage_complete boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), redacted_at timestamptz,
  CHECK(usage_complete=(actual_microusd IS NOT NULL))
);
CREATE TABLE public.tool_competitor_synthesis_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.tool_competitors(id) ON DELETE CASCADE,
  model_id text NOT NULL, prompt_contract_version text NOT NULL,
  canonical_input_fingerprint char(64) NOT NULL, result jsonb NOT NULL,
  usage_receipt_id uuid REFERENCES public.tool_competitor_model_usage_receipts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(competitor_id,model_id,prompt_contract_version,canonical_input_fingerprint)
);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY[
 'tool_competitor_venue_week_budget_boundaries','tool_competitor_model_usage_receipts','tool_competitor_synthesis_results'
] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('REVOKE ALL ON public.%I FROM public,anon,authenticated',t); EXECUTE format('GRANT ALL ON public.%I TO service_role',t); END LOOP; END $$;

DROP FUNCTION public.issue_2725_reserve_budget(uuid,bigint);
CREATE FUNCTION public.issue_2725_reserve_budget(p_job uuid,p_owner uuid,p_amount bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE j public.tool_competitor_refresh_jobs%rowtype; lid uuid; used bigint;
BEGIN
 IF p_amount<>50000 THEN RAISE EXCEPTION 'invalid_reservation'; END IF;
 SELECT * INTO j FROM public.tool_competitor_refresh_jobs WHERE id=p_job AND state='leased' AND lease_owner=p_owner FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT id INTO lid FROM public.tool_competitor_budget_ledger WHERE job_id=p_job;
 IF lid IS NOT NULL THEN RETURN lid; END IF;
 INSERT INTO public.tool_competitor_venue_week_budget_boundaries(venue_listing_id,iso_week)
 VALUES(j.venue_listing_id,j.due_week) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM public.tool_competitor_venue_week_budget_boundaries
 WHERE venue_listing_id=j.venue_listing_id AND iso_week=j.due_week FOR UPDATE;
 SELECT coalesce(sum(CASE state WHEN 'settled' THEN actual_microusd WHEN 'released' THEN 0 ELSE reserved_microusd END),0)
 INTO used FROM public.tool_competitor_budget_ledger
 WHERE venue_listing_id=j.venue_listing_id AND iso_week=j.due_week;
 IF used+p_amount>1000000 THEN
  UPDATE public.tool_competitor_refresh_jobs SET state='budget_deferred',
   next_attempt_at=(j.due_week+7)::timestamptz+public.issue_2725_jitter(j.competitor_id),
   lease_owner=NULL,leased_at=NULL,updated_at=now() WHERE id=p_job;
  RETURN NULL;
 END IF;
 INSERT INTO public.tool_competitor_budget_ledger(job_id,brand_id,venue_listing_id,iso_week,reserved_microusd,state)
 VALUES(p_job,j.brand_id,j.venue_listing_id,j.due_week,p_amount,'reserved') RETURNING id INTO lid;
 UPDATE public.tool_competitor_refresh_jobs SET scheduled_budget_reservation_id=lid WHERE id=p_job;
 RETURN lid;
END $$;

CREATE FUNCTION public.issue_2725_record_model_usage(p_job uuid,p_owner uuid,p_receipt jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE j public.tool_competitor_refresh_jobs%rowtype; rid uuid; actual bigint;
BEGIN
 SELECT * INTO j FROM public.tool_competitor_refresh_jobs WHERE id=p_job AND state='leased' AND lease_owner=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'superseded'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tool_competitor_budget_ledger WHERE job_id=p_job AND state='reserved') THEN RAISE EXCEPTION 'reservation_required'; END IF;
 actual:=CASE WHEN coalesce((p_receipt->>'usage_complete')::boolean,false) THEN (p_receipt->>'actual_microusd')::bigint ELSE NULL END;
 INSERT INTO public.tool_competitor_model_usage_receipts(
  competitor_id,venue_listing_id,job_id,model_id,prompt_contract_version,canonical_input_fingerprint,request_bytes,
  prompt_tokens,candidate_tokens,thinking_tokens,total_tokens,provider_model_version,latency_ms,finish_reason,result_class,
  pricing_version,reserved_microusd,actual_microusd,usage_complete)
 VALUES(j.competitor_id,j.venue_listing_id,j.id,p_receipt->>'model_id',p_receipt->>'prompt_contract_version',
  (p_receipt->>'canonical_input_fingerprint')::char(64),(p_receipt->>'request_bytes')::int,
  (p_receipt->>'prompt_tokens')::int,(p_receipt->>'candidate_tokens')::int,(p_receipt->>'thinking_tokens')::int,
  (p_receipt->>'total_tokens')::int,p_receipt->>'provider_model_version',(p_receipt->>'latency_ms')::int,
  p_receipt->>'finish_reason',p_receipt->>'result_class',p_receipt->>'pricing_version',50000,actual,
  coalesce((p_receipt->>'usage_complete')::boolean,false)) RETURNING id INTO rid;
 UPDATE public.tool_competitor_budget_ledger SET state=CASE WHEN actual IS NULL THEN 'measurement_failed' ELSE 'settled' END,
  actual_microusd=actual,pricing_version=p_receipt->>'pricing_version',settled_at=now() WHERE job_id=p_job AND state='reserved';
 RETURN rid;
END $$;

CREATE FUNCTION public.issue_2725_settle_zero_cost(p_job uuid,p_owner uuid,p_result_class text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tool_competitor_refresh_jobs WHERE id=p_job AND state='leased' AND lease_owner=p_owner) THEN RAISE EXCEPTION 'superseded'; END IF;
 UPDATE public.tool_competitor_budget_ledger SET state='settled',actual_microusd=0,
  pricing_version='no-model-io-v1',settled_at=now() WHERE job_id=p_job AND state='reserved';
END $$;

CREATE FUNCTION public.issue_2725_accept_synthesis(p_job uuid,p_owner uuid,p_model text,p_prompt_version text,p_fingerprint char(64),p_result jsonb,p_receipt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE j public.tool_competitor_refresh_jobs%rowtype; winner jsonb;
BEGIN
 SELECT * INTO j FROM public.tool_competitor_refresh_jobs WHERE id=p_job AND state='leased' AND lease_owner=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'superseded'; END IF;
 INSERT INTO public.tool_competitor_synthesis_results(competitor_id,model_id,prompt_contract_version,canonical_input_fingerprint,result,usage_receipt_id)
 VALUES(j.competitor_id,p_model,p_prompt_version,p_fingerprint,p_result,p_receipt) ON CONFLICT DO NOTHING;
 SELECT result INTO winner FROM public.tool_competitor_synthesis_results WHERE competitor_id=j.competitor_id AND model_id=p_model AND prompt_contract_version=p_prompt_version AND canonical_input_fingerprint=p_fingerprint;
 RETURN winner;
END $$;

REVOKE ALL ON FUNCTION public.issue_2725_reserve_budget(uuid,uuid,bigint), public.issue_2725_record_model_usage(uuid,uuid,jsonb), public.issue_2725_settle_zero_cost(uuid,uuid,text), public.issue_2725_accept_synthesis(uuid,uuid,text,text,char(64),jsonb,uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2725_reserve_budget(uuid,uuid,bigint), public.issue_2725_record_model_usage(uuid,uuid,jsonb), public.issue_2725_settle_zero_cost(uuid,uuid,text), public.issue_2725_accept_synthesis(uuid,uuid,text,text,char(64),jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_2725_watch_remove(p_brand uuid,p_watch uuid,p_expected timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE h char(64):=public.issue_2725_sha256('deleted-watch-v1:'||p_watch::text); BEGIN
 PERFORM 1 FROM public.tool_competitors WHERE id=p_watch AND brand_id=p_brand AND updated_at=p_expected FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'watch_conflict'; END IF;
 UPDATE public.tool_competitor_budget_ledger SET state='released',settled_at=now() WHERE job_id IN(SELECT id FROM public.tool_competitor_refresh_jobs WHERE competitor_id=p_watch) AND state='reserved';
 UPDATE public.tool_competitor_model_usage_receipts SET competitor_id=NULL,venue_listing_id=NULL,job_id=NULL,redacted_at=now() WHERE competitor_id=p_watch;
 UPDATE public.tool_competitor_refresh_jobs SET state='cancelled',competitor_id=NULL,venue_listing_id=NULL,source_set_fingerprint=NULL,idempotency_key=NULL,lease_owner=NULL,leased_at=NULL,next_attempt_at=NULL,last_safe_error_code=NULL,finished_at=coalesce(finished_at,now()),redacted_at=now(),watch_receipt_hash=h,updated_at=now() WHERE competitor_id=p_watch;
 UPDATE public.tool_competitor_admin_actions SET target_receipt_hash=public.issue_2725_sha256('deleted-target-v1:'||target_kind||':'||target_id),target_id=NULL,before_state=jsonb_strip_nulls(jsonb_build_object('state',before_state->'state','capability',before_state->'capability','attempt_count',before_state->'attempt_count')),after_state=jsonb_strip_nulls(jsonb_build_object('state',after_state->'state','capability',after_state->'capability','attempt_count',after_state->'attempt_count')) WHERE target_id=p_watch::text OR target_id IN(SELECT id::text FROM public.tool_competitor_refresh_jobs WHERE watch_receipt_hash=h);
 DELETE FROM public.tool_competitors WHERE id=p_watch;
 IF EXISTS(SELECT 1 FROM public.tool_competitor_sources WHERE competitor_id=p_watch) OR EXISTS(SELECT 1 FROM public.tool_competitor_observations WHERE competitor_id=p_watch) OR EXISTS(SELECT 1 FROM public.tool_competitor_briefs WHERE competitor_id=p_watch) OR EXISTS(SELECT 1 FROM public.tool_competitor_refresh_jobs WHERE competitor_id=p_watch) OR EXISTS(SELECT 1 FROM public.tool_competitor_model_usage_receipts WHERE competitor_id=p_watch) THEN RAISE EXCEPTION 'remove_postcondition_failed'; END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.admin_competitor_intel_list(p_provider text DEFAULT NULL,p_state text DEFAULT NULL,p_due text DEFAULT NULL,p_brand uuid DEFAULT NULL,p_error text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
BEGIN
 IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
 RETURN jsonb_build_object(
  'capabilities',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'enabled',enabled,'mode',mode,'generation',availability_generation,'safe_reason',safe_reason) ORDER BY kind),'[]'::jsonb) FROM public.tool_competitor_provider_capabilities WHERE kind IN('website','instagram')),
  'jobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',j.id,'state',j.state,'provider',coalesce((SELECT min(key) FROM jsonb_each_text(j.capability_snapshot)),'website'),'watch_id',j.competitor_id,'brand_id',j.brand_id,'attempts',j.attempt_count,'last_attempt',j.started_at,'last_success',w.last_success_at,'next_due',w.next_due_at,'budget_week_start',j.due_week,'weekly_reserved_cents',round(weekly.reserved_microusd/10000.0,2),'weekly_actual_cents',CASE WHEN weekly.has_missing THEN NULL ELSE round(weekly.actual_microusd/10000.0,2) END,'weekly_remaining_cents',round(greatest(0,1000000-weekly.accounted_microusd)/10000.0,2),'safe_reason',j.last_safe_error_code,'admin_retry_count',j.admin_retry_count) ORDER BY j.created_at DESC),'[]'::jsonb)
   FROM public.tool_competitor_refresh_jobs j LEFT JOIN public.tool_competitors w ON w.id=j.competitor_id
   LEFT JOIN LATERAL (SELECT coalesce(sum(reserved_microusd),0) reserved_microusd,coalesce(sum(actual_microusd),0) actual_microusd,bool_or(state='measurement_failed') has_missing,coalesce(sum(CASE state WHEN 'settled' THEN actual_microusd WHEN 'released' THEN 0 ELSE reserved_microusd END),0) accounted_microusd FROM public.tool_competitor_budget_ledger WHERE venue_listing_id=j.venue_listing_id AND iso_week=j.due_week) weekly ON true
   WHERE (p_provider IS NULL OR j.capability_snapshot ? p_provider) AND (p_state IS NULL OR j.state=p_state) AND (p_brand IS NULL OR j.brand_id=p_brand) AND (p_error IS NULL OR j.last_safe_error_code=p_error) AND (p_due IS NULL OR p_due='any' OR p_due='due' AND w.next_due_at<=now() OR p_due='overdue' AND w.next_due_at<now()-interval '15 minutes')));
END $$;

DO $$ BEGIN
 IF (SELECT scheduler_enabled FROM public.tool_competitor_intel_config WHERE singleton) THEN RAISE EXCEPTION 'issue_2725_rollout_must_remain_off'; END IF;
 IF EXISTS(SELECT 1 FROM public.tool_competitor_provider_capabilities WHERE kind IN('website','instagram') AND enabled) THEN RAISE EXCEPTION 'issue_2725_providers_must_remain_off'; END IF;
END $$;
