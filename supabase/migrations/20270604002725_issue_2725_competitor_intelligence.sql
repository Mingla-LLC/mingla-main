-- ISSUE-2725 — server-owned competitor sources, weekly work, observations,
-- briefs, capability generations, isolated budgets, and redacted ops receipts.
-- Forward-only. Scheduler and both analyzed providers seed OFF; budgets seed 0.
-- Redacted job retention is interval '90 days'; budget/admin receipt retention
-- is interval '400 days', enforced in bounded worker housekeeping.
BEGIN;

ALTER TABLE public.tool_competitors ALTER COLUMN website DROP NOT NULL;
ALTER TABLE public.tool_competitors ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.tool_competitors ADD COLUMN IF NOT EXISTS next_due_at timestamptz;
ALTER TABLE public.tool_competitors ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE public.tool_competitors ADD COLUMN IF NOT EXISTS last_success_at timestamptz;
ALTER TABLE public.tool_competitors ADD COLUMN IF NOT EXISTS current_brief_id uuid;
DROP INDEX IF EXISTS public.uq_tool_competitors_venue_site;

CREATE TABLE IF NOT EXISTS public.tool_competitor_provider_capabilities (
  kind text PRIMARY KEY CHECK (kind IN ('website','instagram','tiktok')),
  mode text NOT NULL CHECK (mode IN ('analyzed_weekly','link_only','disabled')),
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  availability_generation bigint NOT NULL DEFAULT 1 CHECK (availability_generation > 0),
  safe_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
INSERT INTO public.tool_competitor_provider_capabilities(kind,mode,enabled,safe_reason)
VALUES ('website','analyzed_weekly',false,'rollout_disabled'),('instagram','analyzed_weekly',false,'meta_not_ready'),('tiktok','link_only',false,'link_only')
ON CONFLICT (kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tool_competitor_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.tool_competitors(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_listing_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('website','instagram','tiktok')),
  normalized_url text NOT NULL CHECK (length(normalized_url) BETWEEN 1 AND 2048),
  normalized_identity text NOT NULL,
  provider_object_id text,
  source_fingerprint char(64) NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
  capability text NOT NULL CHECK (capability IN ('analyzed_weekly','link_only','disabled')),
  health text NOT NULL DEFAULT 'pending' CHECK (health IN ('pending','current','private','removed','invalid','rate_limited','unreachable','unsupported','disabled')),
  last_checked_at timestamptz, last_observed_at timestamptz, last_success_at timestamptz,
  last_safe_error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competitor_id,kind), UNIQUE (venue_listing_id,normalized_identity)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tool_competitor_source_provider_object ON public.tool_competitor_sources(venue_listing_id,kind,provider_object_id) WHERE provider_object_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tool_competitor_sources_watch ON public.tool_competitor_sources(competitor_id);

CREATE TABLE IF NOT EXISTS public.tool_competitor_intel_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), scheduler_enabled boolean NOT NULL DEFAULT false,
  global_daily_limit_microusd bigint NOT NULL DEFAULT 0 CHECK (global_daily_limit_microusd >= 0),
  default_brand_daily_limit_microusd bigint NOT NULL DEFAULT 0 CHECK (default_brand_daily_limit_microusd >= 0),
  max_claims_per_tick integer NOT NULL DEFAULT 25 CHECK (max_claims_per_tick BETWEEN 1 AND 25)
);
INSERT INTO public.tool_competitor_intel_config(singleton) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.tool_competitor_brand_budget_overrides (brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE, daily_limit_microusd bigint NOT NULL CHECK (daily_limit_microusd >= 0));

CREATE TABLE IF NOT EXISTS public.tool_competitor_refresh_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid REFERENCES public.tool_competitors(id) ON DELETE SET NULL,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_listing_id uuid REFERENCES public.venue_listings(id) ON DELETE SET NULL,
  trigger text NOT NULL CHECK (trigger IN ('add','edit','scheduled','manual','admin_retry','backfill')),
  due_week date NOT NULL, source_set_fingerprint char(64), idempotency_key char(64),
  capability_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'due' CHECK (state IN ('due','leased','retry_wait','budget_deferred','succeeded','partial','no_change','failed_terminal','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  admin_retry_count integer NOT NULL DEFAULT 0 CHECK (admin_retry_count BETWEEN 0 AND 1),
  member_retry_count integer NOT NULL DEFAULT 0 CHECK (member_retry_count BETWEEN 0 AND 1),
  funding_lane text NOT NULL DEFAULT 'scheduled' CHECK (funding_lane IN ('scheduled','manual')),
  lease_owner uuid, leased_at timestamptz, cancel_requested_at timestamptz, next_attempt_at timestamptz,
  last_safe_error_code text, scheduled_budget_reservation_id uuid, manual_tool_lead_id uuid UNIQUE REFERENCES public.tool_leads(id) ON DELETE SET NULL,
  started_at timestamptz, finished_at timestamptz, redacted_at timestamptz, watch_receipt_hash char(64),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_competitor_job_live_or_redacted CHECK (
    (redacted_at IS NULL AND watch_receipt_hash IS NULL AND competitor_id IS NOT NULL AND venue_listing_id IS NOT NULL AND source_set_fingerprint IS NOT NULL AND idempotency_key IS NOT NULL)
    OR (redacted_at IS NOT NULL AND watch_receipt_hash IS NOT NULL AND competitor_id IS NULL AND venue_listing_id IS NULL AND source_set_fingerprint IS NULL AND idempotency_key IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tool_competitor_job_idempotency ON public.tool_competitor_refresh_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tool_competitor_one_active_job ON public.tool_competitor_refresh_jobs(competitor_id) WHERE competitor_id IS NOT NULL AND state IN ('due','leased','retry_wait','budget_deferred');
CREATE INDEX IF NOT EXISTS idx_tool_competitor_jobs_claim ON public.tool_competitor_refresh_jobs(state,next_attempt_at,created_at) WHERE competitor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tool_competitor_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.tool_competitor_refresh_jobs(id) ON DELETE CASCADE,
  competitor_id uuid NOT NULL REFERENCES public.tool_competitors(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.tool_competitor_sources(id) ON DELETE CASCADE,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1), window_start timestamptz NOT NULL, window_end timestamptz NOT NULL,
  checked_at timestamptz NOT NULL, latest_observed_at timestamptz, observation_fingerprint char(64) NOT NULL,
  coverage text NOT NULL CHECK (coverage IN ('complete','partial')), facts jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,source_id), CHECK (jsonb_typeof(facts)='object')
);
CREATE OR REPLACE FUNCTION public.issue_2725_one_primary_action(p_actions jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='public'
AS $$ SELECT CASE WHEN jsonb_typeof(p_actions)='array' THEN (SELECT count(*) FROM jsonb_array_elements(p_actions) a WHERE coalesce((a->>'is_primary')::boolean,false))=1 ELSE false END $$;
CREATE TABLE IF NOT EXISTS public.tool_competitor_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competitor_id uuid NOT NULL REFERENCES public.tool_competitors(id) ON DELETE CASCADE,
  job_id uuid NOT NULL UNIQUE REFERENCES public.tool_competitor_refresh_jobs(id) ON DELETE CASCADE,
  schema_version integer NOT NULL DEFAULT 2 CHECK(schema_version=2), status text NOT NULL CHECK(status IN ('current','partial')),
  updated_at timestamptz NOT NULL, checked_at timestamptz NOT NULL, source_set_fingerprint char(64) NOT NULL,
  observation_set_fingerprint char(64) NOT NULL, what_changed jsonb NOT NULL, why_it_matters jsonb NOT NULL,
  worth_doing jsonb NOT NULL, evidence jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(what_changed)='array' AND jsonb_array_length(what_changed) BETWEEN 1 AND 3),
  CHECK (jsonb_typeof(why_it_matters)='array' AND jsonb_array_length(why_it_matters) BETWEEN 1 AND 2),
  CHECK (jsonb_typeof(worth_doing)='array' AND jsonb_array_length(worth_doing) BETWEEN 1 AND 3),
  CHECK (jsonb_typeof(evidence)='array'),
  CHECK (public.issue_2725_one_primary_action(worth_doing))
);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tool_competitors_current_brief_fk' AND conrelid='public.tool_competitors'::regclass) THEN ALTER TABLE public.tool_competitors ADD CONSTRAINT tool_competitors_current_brief_fk FOREIGN KEY(current_brief_id) REFERENCES public.tool_competitor_briefs(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED; END IF; END $$;

CREATE TABLE IF NOT EXISTS public.tool_competitor_budget_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid UNIQUE REFERENCES public.tool_competitor_refresh_jobs(id) ON DELETE SET NULL,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE, budget_date date NOT NULL DEFAULT current_date,
  reserved_microusd bigint NOT NULL CHECK(reserved_microusd>=0), actual_microusd bigint CHECK(actual_microusd>=0 AND actual_microusd<=reserved_microusd),
  state text NOT NULL CHECK(state IN ('reserved','settled','released')), created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.tool_competitor_admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_user_id uuid, action text NOT NULL CHECK(action IN ('retry_job','pause_provider','resume_provider')),
  target_kind text NOT NULL, target_id text, target_receipt_hash char(64), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 240),
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb, after_state jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((target_id IS NOT NULL)::int + (target_receipt_hash IS NOT NULL)::int = 1)
);

-- Every new table is service-only; interactive/admin access is through guarded Edge/RPC doors.
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['tool_competitor_provider_capabilities','tool_competitor_sources','tool_competitor_intel_config','tool_competitor_brand_budget_overrides','tool_competitor_refresh_jobs','tool_competitor_observations','tool_competitor_briefs','tool_competitor_budget_ledger','tool_competitor_admin_actions'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('REVOKE ALL ON public.%I FROM public, anon, authenticated',t); EXECUTE format('GRANT ALL ON public.%I TO service_role',t); END LOOP; END $$;

CREATE OR REPLACE FUNCTION public.issue_2725_sha256(p_value text) RETURNS char(64) LANGUAGE sql IMMUTABLE SET search_path='public' AS $$ SELECT encode(extensions.digest(convert_to(p_value,'UTF8'),'sha256'),'hex')::char(64) $$;
CREATE OR REPLACE FUNCTION public.issue_2725_due_week(p_now timestamptz DEFAULT now()) RETURNS date LANGUAGE sql STABLE SET search_path='public' AS $$ SELECT date_trunc('week',p_now AT TIME ZONE 'UTC')::date $$;
CREATE OR REPLACE FUNCTION public.issue_2725_jitter(p_watch uuid) RETURNS interval LANGUAGE sql IMMUTABLE SET search_path='public' AS $$ SELECT make_interval(secs => (('x'||substr(md5(p_watch::text),1,8))::bit(32)::bigint % 21601)::int) $$;

-- SQL is the persisted identity arbiter. The Edge pure helper mirrors this for friendly errors.
CREATE OR REPLACE FUNCTION public.issue_2725_normalize_source(p_kind text,p_url text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='public' AS $$
DECLARE u text:=btrim(p_url); host text; path text; handle text; identity text; canonical text; capability text;
BEGIN
 IF p_kind NOT IN ('website','instagram','tiktok') OR length(u)=0 OR length(u)>2048 OR u !~* '^https?://' OR u ~ '://' || '[^/]*@' OR u LIKE '%#%' THEN RAISE EXCEPTION 'invalid_source'; END IF;
 host:=lower(substring(u from '^https?://([^/:?#]+)')); path:=coalesce(substring(u from '^https?://[^/]+(/[^?#]*)'),'/');
 IF host IS NULL OR host IN ('localhost','::1') OR host ~ '^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|0\.)' THEN RAISE EXCEPTION 'invalid_source'; END IF;
 IF p_kind='instagram' THEN handle:=lower(trim(both '/' from path)); IF host NOT IN ('instagram.com','www.instagram.com') OR handle !~ '^[a-z0-9._]{1,30}$' OR handle IN ('p','reel','reels','stories','explore','accounts','direct','tv') OR u ~ '[?]' THEN RAISE EXCEPTION 'invalid_source'; END IF; canonical:='https://www.instagram.com/'||handle||'/'; identity:='instagram:'||handle; capability:='analyzed_weekly';
 ELSIF p_kind='tiktok' THEN handle:=lower(trim(both '/' from path)); IF host NOT IN ('tiktok.com','www.tiktok.com') OR handle !~ '^@[a-z0-9._]{2,24}$' OR u ~ '[?]' THEN RAISE EXCEPTION 'invalid_source'; END IF; canonical:='https://www.tiktok.com/'||handle; identity:='tiktok:'||substr(handle,2); capability:='link_only';
 ELSE canonical:=regexp_replace(u,'/$',''); identity:='website:'||host||CASE WHEN path='/' THEN '' ELSE regexp_replace(path,'/$','') END; capability:='analyzed_weekly'; END IF;
 RETURN jsonb_build_object('kind',p_kind,'normalized_url',canonical,'normalized_identity',identity,'capability',capability,'source_fingerprint',public.issue_2725_sha256(p_kind||E'\n'||identity||E'\n1'));
END $$;

CREATE OR REPLACE FUNCTION public.issue_2725_source_set_fingerprint(p_watch uuid) RETURNS char(64) LANGUAGE sql STABLE SET search_path='public' AS $$
 SELECT public.issue_2725_sha256(coalesce(string_agg(s.source_fingerprint::text||':'||c.availability_generation::text,',' ORDER BY s.kind),'link-only'))
 FROM public.tool_competitor_sources s JOIN public.tool_competitor_provider_capabilities c ON c.kind=s.kind
 WHERE s.competitor_id=p_watch AND s.capability='analyzed_weekly' AND c.mode='analyzed_weekly' AND c.enabled
$$;
CREATE OR REPLACE FUNCTION public.issue_2725_capability_snapshot(p_watch uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='public' AS $$ SELECT coalesce(jsonb_object_agg(s.kind,c.availability_generation),'{}'::jsonb) FROM public.tool_competitor_sources s JOIN public.tool_competitor_provider_capabilities c ON c.kind=s.kind WHERE s.competitor_id=p_watch AND s.capability='analyzed_weekly' AND c.mode='analyzed_weekly' AND c.enabled $$;

CREATE OR REPLACE FUNCTION public.issue_2725_enqueue(p_watch uuid,p_trigger text,p_due timestamptz DEFAULT now(),p_funding text DEFAULT 'scheduled') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE w public.tool_competitors%rowtype; fp char(64); idem char(64); job uuid; snapshot jsonb;
BEGIN SELECT * INTO w FROM public.tool_competitors WHERE id=p_watch FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'watch_not_found'; END IF; fp:=public.issue_2725_source_set_fingerprint(p_watch); snapshot:=public.issue_2725_capability_snapshot(p_watch); IF snapshot='{}'::jsonb THEN UPDATE public.tool_competitors SET next_due_at=NULL WHERE id=p_watch; RETURN NULL; END IF; idem:=public.issue_2725_sha256(p_watch::text||'|'||fp::text||'|'||public.issue_2725_due_week(p_due)::text);
 INSERT INTO public.tool_competitor_refresh_jobs(competitor_id,brand_id,venue_listing_id,trigger,due_week,source_set_fingerprint,idempotency_key,capability_snapshot,state,next_attempt_at,funding_lane)
 VALUES(p_watch,w.brand_id,w.venue_listing_id,p_trigger,public.issue_2725_due_week(p_due),fp,idem,snapshot,'due',p_due,p_funding)
 ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET updated_at=now() RETURNING id INTO job;
 UPDATE public.tool_competitors SET next_due_at=p_due,updated_at=now() WHERE id=p_watch; RETURN job;
END $$;

CREATE OR REPLACE FUNCTION public.issue_2725_watch_upsert(p_brand uuid,p_venue uuid,p_user uuid,p_watch uuid,p_expected timestamptz,p_name text,p_city text,p_sources jsonb,p_place uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE wid uuid:=p_watch; old_fp char(64); new_fp char(64); elem jsonb; n jsonb; source_count int:=0; analyzed int:=0;
BEGIN
 PERFORM 1 FROM public.venue_listings WHERE id=p_venue AND brand_id=p_brand FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF length(btrim(p_name)) NOT BETWEEN 2 AND 80 OR length(btrim(p_city)) NOT BETWEEN 2 AND 60 OR jsonb_typeof(p_sources)<>'array' OR jsonb_array_length(p_sources) NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'validation'; END IF;
 IF wid IS NULL THEN IF (SELECT count(*) FROM public.tool_competitors WHERE venue_listing_id=p_venue)>=5 THEN RAISE EXCEPTION 'watch_limit'; END IF; INSERT INTO public.tool_competitors(brand_id,venue_listing_id,name,city,website,place_pool_id,created_by) VALUES(p_brand,p_venue,btrim(p_name),btrim(p_city),NULL,p_place,p_user) RETURNING id INTO wid;
 ELSE SELECT public.issue_2725_source_set_fingerprint(wid) INTO old_fp FROM public.tool_competitors WHERE id=wid AND brand_id=p_brand AND venue_listing_id=p_venue AND updated_at=p_expected FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'watch_conflict'; END IF; DELETE FROM public.tool_competitor_sources WHERE competitor_id=wid; UPDATE public.tool_competitors SET name=btrim(p_name),city=btrim(p_city),place_pool_id=p_place,updated_at=now() WHERE id=wid; END IF;
 FOR elem IN SELECT value FROM jsonb_array_elements(p_sources) LOOP n:=public.issue_2725_normalize_source(elem->>'kind',elem->>'url'); source_count:=source_count+1; IF n->>'capability'='analyzed_weekly' THEN analyzed:=analyzed+1; END IF; INSERT INTO public.tool_competitor_sources(competitor_id,brand_id,venue_listing_id,kind,normalized_url,normalized_identity,source_fingerprint,capability,health) VALUES(wid,p_brand,p_venue,n->>'kind',n->>'normalized_url',n->>'normalized_identity',(n->>'source_fingerprint')::char(64),n->>'capability',CASE WHEN n->>'capability'='link_only' THEN 'current' ELSE 'pending' END); END LOOP;
 UPDATE public.tool_competitors SET website=(SELECT normalized_url FROM public.tool_competitor_sources WHERE competitor_id=wid AND kind='website'),updated_at=now() WHERE id=wid;
 new_fp:=public.issue_2725_source_set_fingerprint(wid); IF p_watch IS NULL OR old_fp IS DISTINCT FROM new_fp THEN UPDATE public.tool_competitor_refresh_jobs SET cancel_requested_at=now(),updated_at=now() WHERE competitor_id=wid AND state='leased'; UPDATE public.tool_competitor_refresh_jobs SET state='cancelled',finished_at=now(),updated_at=now() WHERE competitor_id=wid AND state IN ('due','retry_wait','budget_deferred'); PERFORM public.issue_2725_enqueue(wid,CASE WHEN p_watch IS NULL THEN 'add' ELSE 'edit' END,now(),'scheduled'); END IF; RETURN wid;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_source'; END $$;

-- Deferred direct-service-role backstop: a surviving watch may never commit source-less.
CREATE OR REPLACE FUNCTION public.issue_2725_require_source() RETURNS trigger LANGUAGE plpgsql SET search_path='public' AS $$ DECLARE wid uuid:=coalesce(NEW.competitor_id,OLD.competitor_id); BEGIN IF EXISTS(SELECT 1 FROM public.tool_competitors WHERE id=wid) AND NOT EXISTS(SELECT 1 FROM public.tool_competitor_sources WHERE competitor_id=wid) THEN RAISE EXCEPTION 'source_required'; END IF; RETURN NULL; END $$;
DROP TRIGGER IF EXISTS trg_issue_2725_source_required ON public.tool_competitor_sources;
CREATE CONSTRAINT TRIGGER trg_issue_2725_source_required AFTER INSERT OR UPDATE OR DELETE ON public.tool_competitor_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.issue_2725_require_source();

CREATE OR REPLACE FUNCTION public.issue_2725_watch_remove(p_brand uuid,p_watch uuid,p_expected timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE h char(64):=public.issue_2725_sha256('deleted-watch-v1:'||p_watch::text); BEGIN PERFORM 1 FROM public.tool_competitors WHERE id=p_watch AND brand_id=p_brand AND updated_at=p_expected FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'watch_conflict'; END IF;
 UPDATE public.tool_competitor_budget_ledger SET state='released',settled_at=now() WHERE job_id IN(SELECT id FROM public.tool_competitor_refresh_jobs WHERE competitor_id=p_watch) AND state='reserved';
 UPDATE public.tool_competitor_refresh_jobs SET state='cancelled',competitor_id=NULL,venue_listing_id=NULL,source_set_fingerprint=NULL,idempotency_key=NULL,lease_owner=NULL,leased_at=NULL,next_attempt_at=NULL,last_safe_error_code=NULL,finished_at=coalesce(finished_at,now()),redacted_at=now(),watch_receipt_hash=h,updated_at=now() WHERE competitor_id=p_watch;
 UPDATE public.tool_competitor_admin_actions SET target_receipt_hash=public.issue_2725_sha256('deleted-target-v1:'||target_kind||':'||target_id),target_id=NULL,before_state=jsonb_strip_nulls(jsonb_build_object('state',before_state->'state','capability',before_state->'capability','attempt_count',before_state->'attempt_count')),after_state=jsonb_strip_nulls(jsonb_build_object('state',after_state->'state','capability',after_state->'capability','attempt_count',after_state->'attempt_count')) WHERE target_id=p_watch::text OR target_id IN(SELECT id::text FROM public.tool_competitor_refresh_jobs WHERE watch_receipt_hash=h);
 DELETE FROM public.tool_competitors WHERE id=p_watch; IF EXISTS(SELECT 1 FROM public.tool_competitor_sources WHERE competitor_id=p_watch) OR EXISTS(SELECT 1 FROM public.tool_competitor_observations WHERE competitor_id=p_watch) OR EXISTS(SELECT 1 FROM public.tool_competitor_briefs WHERE competitor_id=p_watch) OR EXISTS(SELECT 1 FROM public.tool_competitor_refresh_jobs WHERE competitor_id=p_watch) THEN RAISE EXCEPTION 'remove_postcondition_failed'; END IF; RETURN true; END $$;

CREATE OR REPLACE FUNCTION public.issue_2725_claim_jobs(p_owner uuid,p_limit int DEFAULT 25) RETURNS SETOF public.tool_competitor_refresh_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE due_watch record; scheduler_on boolean; claim_cap integer;
BEGIN
 SELECT scheduler_enabled,max_claims_per_tick INTO scheduler_on,claim_cap FROM public.tool_competitor_intel_config WHERE singleton;
 -- Materialize each newly-due weekly cycle before claiming it. The watch lock and
 -- enqueue idempotency key make concurrent cron callers converge on one job.
 IF scheduler_on THEN
  FOR due_watch IN
   SELECT w.id,w.next_due_at FROM public.tool_competitors w
   WHERE w.next_due_at IS NOT NULL AND w.next_due_at<=now()
    AND EXISTS(SELECT 1 FROM public.tool_competitor_sources s JOIN public.tool_competitor_provider_capabilities c ON c.kind=s.kind WHERE s.competitor_id=w.id AND s.capability='analyzed_weekly' AND c.mode='analyzed_weekly' AND c.enabled)
    AND NOT EXISTS(SELECT 1 FROM public.tool_competitor_refresh_jobs j WHERE j.competitor_id=w.id AND j.due_week=public.issue_2725_due_week(w.next_due_at))
   ORDER BY w.next_due_at FOR UPDATE OF w SKIP LOCKED LIMIT least(greatest(p_limit,1),claim_cap,25)
  LOOP
   PERFORM public.issue_2725_enqueue(due_watch.id,'scheduled',due_watch.next_due_at,'scheduled');
  END LOOP;
 END IF;
 RETURN QUERY WITH claimed AS (
  SELECT j.id FROM public.tool_competitor_refresh_jobs j JOIN public.tool_competitor_intel_config c ON c.singleton
  WHERE j.competitor_id IS NOT NULL
   AND (j.funding_lane='manual' OR (j.funding_lane='scheduled' AND c.scheduler_enabled))
   AND ((j.state IN ('due','retry_wait','budget_deferred') AND coalesce(j.next_attempt_at,j.created_at)<=now()) OR (j.state='leased' AND j.leased_at<now()-interval '5 minutes'))
  ORDER BY coalesce(j.next_attempt_at,j.created_at) FOR UPDATE OF j SKIP LOCKED LIMIT least(greatest(p_limit,1),claim_cap,25)
 ) UPDATE public.tool_competitor_refresh_jobs j SET state='leased',lease_owner=p_owner,leased_at=now(),started_at=coalesce(started_at,now()),attempt_count=attempt_count+1,updated_at=now() FROM claimed WHERE j.id=claimed.id RETURNING j.*;
END $$;

CREATE OR REPLACE FUNCTION public.issue_2725_reserve_budget(p_job uuid,p_amount bigint) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE j public.tool_competitor_refresh_jobs%rowtype; cfg public.tool_competitor_intel_config%rowtype; brand_limit bigint; global_used bigint; brand_used bigint; lid uuid;
BEGIN SELECT * INTO j FROM public.tool_competitor_refresh_jobs WHERE id=p_job FOR UPDATE; IF j.funding_lane='manual' THEN RETURN NULL; END IF; SELECT id INTO lid FROM public.tool_competitor_budget_ledger WHERE job_id=p_job AND state='reserved'; IF lid IS NOT NULL THEN RETURN lid; END IF; SELECT * INTO cfg FROM public.tool_competitor_intel_config WHERE singleton FOR UPDATE; SELECT coalesce(o.daily_limit_microusd,cfg.default_brand_daily_limit_microusd) INTO brand_limit FROM (SELECT 1) x LEFT JOIN public.tool_competitor_brand_budget_overrides o ON o.brand_id=j.brand_id; SELECT coalesce(sum(reserved_microusd),0) INTO global_used FROM public.tool_competitor_budget_ledger WHERE budget_date=current_date AND state IN('reserved','settled'); SELECT coalesce(sum(reserved_microusd),0) INTO brand_used FROM public.tool_competitor_budget_ledger WHERE brand_id=j.brand_id AND budget_date=current_date AND state IN('reserved','settled'); IF cfg.global_daily_limit_microusd=0 OR brand_limit=0 OR global_used+p_amount>cfg.global_daily_limit_microusd OR brand_used+p_amount>brand_limit THEN UPDATE public.tool_competitor_refresh_jobs SET state='budget_deferred',next_attempt_at=date_trunc('day',now()+interval '1 day')+public.issue_2725_jitter(j.competitor_id),lease_owner=NULL,leased_at=NULL,updated_at=now() WHERE id=p_job; RETURN NULL; END IF; INSERT INTO public.tool_competitor_budget_ledger(job_id,brand_id,reserved_microusd,state) VALUES(p_job,j.brand_id,p_amount,'reserved') RETURNING id INTO lid; UPDATE public.tool_competitor_refresh_jobs SET scheduled_budget_reservation_id=lid WHERE id=p_job; RETURN lid; END $$;

-- One lease-guarded transaction owns every terminal side effect. A stale worker
-- can neither publish a brief nor mutate watch/budget/member receipts after a
-- reclaim, and any SQL error rolls the whole transition back.
CREATE OR REPLACE FUNCTION public.issue_2725_finish_job(p_job uuid,p_owner uuid,p_outcome text,p_safe_error text,p_expected_fp char(64),p_expected_caps jsonb,p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE j public.tool_competitor_refresh_jobs%rowtype; outcome text:=p_outcome; terminal_state text; brief_id uuid; now_at timestamptz:=now(); current_fp char(64); current_caps jsonb; transient boolean;
BEGIN
 IF outcome NOT IN ('publish','no_change','failure','cancel') THEN RAISE EXCEPTION 'invalid_outcome'; END IF;
 SELECT * INTO j FROM public.tool_competitor_refresh_jobs WHERE id=p_job AND state='leased' AND lease_owner=p_owner FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('applied',false,'reason','superseded'); END IF;
 current_fp:=public.issue_2725_source_set_fingerprint(j.competitor_id); current_caps:=public.issue_2725_capability_snapshot(j.competitor_id);
 IF outcome IN ('publish','no_change','failure') AND (j.source_set_fingerprint IS DISTINCT FROM p_expected_fp OR j.capability_snapshot IS DISTINCT FROM p_expected_caps OR current_fp IS DISTINCT FROM p_expected_fp OR current_caps IS DISTINCT FROM p_expected_caps) THEN outcome:='cancel'; p_safe_error:='superseded'; END IF;
 IF outcome='publish' THEN
  terminal_state:=CASE WHEN p_payload->>'brief_status'='partial' THEN 'partial' ELSE 'succeeded' END;
  INSERT INTO public.tool_competitor_briefs(competitor_id,job_id,schema_version,status,updated_at,checked_at,source_set_fingerprint,observation_set_fingerprint,what_changed,why_it_matters,worth_doing,evidence)
  VALUES(j.competitor_id,j.id,2,CASE WHEN terminal_state='partial' THEN 'partial' ELSE 'current' END,now_at,(p_payload->>'checked_at')::timestamptz,j.source_set_fingerprint,(p_payload->>'observation_set_fingerprint')::char(64),p_payload->'what_changed',p_payload->'why_it_matters',p_payload->'worth_doing',p_payload->'evidence') RETURNING id INTO brief_id;
  UPDATE public.tool_competitors SET current_brief_id=brief_id,last_attempt_at=now_at,last_success_at=now_at,next_due_at=now_at+interval '7 days'+public.issue_2725_jitter(j.competitor_id),updated_at=now_at WHERE id=j.competitor_id;
  UPDATE public.tool_competitor_refresh_jobs SET state=terminal_state,lease_owner=NULL,leased_at=NULL,finished_at=now_at,updated_at=now_at WHERE id=j.id;
  UPDATE public.tool_competitor_budget_ledger SET state='settled',actual_microusd=reserved_microusd,settled_at=now_at WHERE job_id=j.id AND state='reserved';
  IF j.manual_tool_lead_id IS NOT NULL THEN UPDATE public.tool_leads SET status='report_ready',report=jsonb_build_object('meta',jsonb_build_object('schema_version',2),'kind','competitor_refresh_receipt','result','success','brief_id',brief_id) WHERE id=j.manual_tool_lead_id; END IF;
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
  IF terminal_state='failed_terminal' THEN UPDATE public.tool_competitor_budget_ledger SET state='settled',actual_microusd=reserved_microusd,settled_at=now_at WHERE job_id=j.id AND state='reserved'; UPDATE public.tool_competitors SET last_attempt_at=now_at,next_due_at=now_at+interval '7 days'+public.issue_2725_jitter(j.competitor_id),updated_at=now_at WHERE id=j.competitor_id; IF j.manual_tool_lead_id IS NOT NULL THEN UPDATE public.tool_leads SET status='failed',report=NULL WHERE id=j.manual_tool_lead_id; END IF; END IF;
 ELSE
  terminal_state:='cancelled'; UPDATE public.tool_competitor_refresh_jobs SET state=terminal_state,lease_owner=NULL,leased_at=NULL,finished_at=now_at,last_safe_error_code=coalesce(p_safe_error,'superseded'),updated_at=now_at WHERE id=j.id;
  UPDATE public.tool_competitor_budget_ledger SET state='released',settled_at=now_at WHERE job_id=j.id AND state='reserved';
  IF j.manual_tool_lead_id IS NOT NULL THEN UPDATE public.tool_leads SET status='failed',report=NULL WHERE id=j.manual_tool_lead_id; END IF;
 END IF;
 RETURN jsonb_build_object('applied',true,'state',terminal_state,'brief_id',brief_id);
END $$;

CREATE OR REPLACE FUNCTION public.issue_2725_member_refresh(p_brand uuid,p_user uuid,p_watch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE w public.tool_competitors%rowtype; j public.tool_competitor_refresh_jobs%rowtype; lead uuid; job uuid; count24 int; BEGIN SELECT * INTO w FROM public.tool_competitors WHERE id=p_watch AND brand_id=p_brand FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF; SELECT * INTO j FROM public.tool_competitor_refresh_jobs WHERE competitor_id=p_watch AND due_week=public.issue_2725_due_week() ORDER BY created_at DESC LIMIT 1 FOR UPDATE; IF j.id IS NOT NULL AND j.state IN('due','leased','retry_wait') THEN RETURN jsonb_build_object('result','joined','job_id',j.id); END IF; IF j.id IS NOT NULL AND j.state IN('succeeded','partial','no_change') AND j.finished_at>now()-interval '24 hours' THEN RETURN jsonb_build_object('result','cached','job_id',j.id); END IF; IF j.id IS NOT NULL AND (j.member_retry_count>=1 OR j.state='failed_terminal' AND NOT EXISTS(SELECT 1 FROM public.tool_competitor_sources WHERE competitor_id=p_watch AND health IN('rate_limited','unreachable'))) THEN RAISE EXCEPTION 'retry_exhausted'; END IF; IF NOT EXISTS(SELECT 1 FROM public.tool_competitor_sources s JOIN public.tool_competitor_provider_capabilities c ON c.kind=s.kind WHERE s.competitor_id=p_watch AND s.capability='analyzed_weekly' AND c.enabled) THEN RAISE EXCEPTION 'edit_required'; END IF; SELECT count(*) INTO count24 FROM public.tool_leads WHERE brand_id=p_brand AND tool='venues' AND lane='app' AND created_at>=now()-interval '24 hours'; IF count24>=10 THEN RAISE EXCEPTION 'quota'; END IF; INSERT INTO public.tool_leads(tool,input,status,lane,user_id,brand_id,subject_ref) VALUES('venues',jsonb_build_object('kind','competitor_refresh','watch_id',p_watch),'created','app',p_user,p_brand,'competitor:'||p_watch) RETURNING id INTO lead; IF j.id IS NULL THEN job:=public.issue_2725_enqueue(p_watch,'manual',now(),'manual'); UPDATE public.tool_competitor_refresh_jobs SET manual_tool_lead_id=lead,member_retry_count=1 WHERE id=job; ELSE job:=j.id; UPDATE public.tool_competitor_budget_ledger SET state='released',settled_at=now() WHERE job_id=job AND state='reserved'; UPDATE public.tool_competitor_refresh_jobs SET state='due',funding_lane='manual',manual_tool_lead_id=lead,member_retry_count=member_retry_count+1,lease_owner=NULL,leased_at=NULL,next_attempt_at=now(),last_safe_error_code=NULL,finished_at=NULL,updated_at=now() WHERE id=job; END IF; RETURN jsonb_build_object('result','queued','job_id',job); END $$;

-- Admin RPCs: guard is the first executable statement. Returned columns contain no source/content/PII.
CREATE OR REPLACE FUNCTION public.admin_competitor_intel_list(p_provider text DEFAULT NULL,p_state text DEFAULT NULL,p_due text DEFAULT NULL,p_brand uuid DEFAULT NULL,p_error text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$ BEGIN IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF; RETURN jsonb_build_object('capabilities',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'enabled',enabled,'mode',mode,'generation',availability_generation,'safe_reason',safe_reason) ORDER BY kind),'[]'::jsonb) FROM public.tool_competitor_provider_capabilities WHERE kind IN('website','instagram')),'jobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',j.id,'state',j.state,'provider',coalesce((SELECT min(key) FROM jsonb_each_text(j.capability_snapshot)),'website'),'watch_id',j.competitor_id,'brand_id',j.brand_id,'attempts',j.attempt_count,'last_attempt',j.started_at,'last_success',w.last_success_at,'next_due',w.next_due_at,'budget_reserved',b.reserved_microusd,'budget_actual',b.actual_microusd,'safe_reason',j.last_safe_error_code,'admin_retry_count',j.admin_retry_count) ORDER BY j.created_at DESC),'[]'::jsonb) FROM public.tool_competitor_refresh_jobs j LEFT JOIN public.tool_competitors w ON w.id=j.competitor_id LEFT JOIN LATERAL (SELECT reserved_microusd,actual_microusd FROM public.tool_competitor_budget_ledger WHERE job_id=j.id ORDER BY created_at DESC LIMIT 1) b ON true WHERE (p_provider IS NULL OR j.capability_snapshot ? p_provider) AND (p_state IS NULL OR j.state=p_state) AND (p_brand IS NULL OR j.brand_id=p_brand) AND (p_error IS NULL OR j.last_safe_error_code=p_error) AND (p_due IS NULL OR p_due='any' OR p_due='due' AND w.next_due_at<=now() OR p_due='overdue' AND w.next_due_at<now()-interval '15 minutes'))); END $$;

CREATE OR REPLACE FUNCTION public.admin_competitor_intel_action(p_action text,p_target text,p_expected_generation bigint DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE uid uuid; cap public.tool_competitor_provider_capabilities%rowtype; j public.tool_competitor_refresh_jobs%rowtype; retry_job uuid; BEGIN IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF; uid:=auth.uid(); IF length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'reason_required'; END IF;
 IF p_action IN('pause_provider','resume_provider') THEN IF p_target NOT IN('website','instagram') THEN RAISE EXCEPTION 'provider_ineligible'; END IF; SELECT * INTO cap FROM public.tool_competitor_provider_capabilities WHERE kind=p_target FOR UPDATE; IF cap.availability_generation<>p_expected_generation THEN RAISE EXCEPTION 'generation_conflict'; END IF; UPDATE public.tool_competitor_provider_capabilities SET enabled=(p_action='resume_provider'),availability_generation=availability_generation+1,safe_reason=CASE WHEN p_action='pause_provider' THEN btrim(p_reason) ELSE NULL END,updated_at=now(),updated_by=uid WHERE kind=p_target; IF p_action='pause_provider' THEN UPDATE public.tool_competitor_refresh_jobs SET state='cancelled',finished_at=now(),updated_at=now() WHERE state IN('due','retry_wait','budget_deferred') AND capability_snapshot ? p_target; UPDATE public.tool_competitor_budget_ledger SET state='released',settled_at=now() WHERE state='reserved' AND job_id IN(SELECT id FROM public.tool_competitor_refresh_jobs WHERE state='cancelled' AND capability_snapshot ? p_target); UPDATE public.tool_competitor_refresh_jobs SET cancel_requested_at=now() WHERE state='leased' AND capability_snapshot ? p_target; ELSE PERFORM public.issue_2725_enqueue(s.competitor_id,'scheduled',now(),'scheduled') FROM public.tool_competitor_sources s WHERE s.kind=p_target; END IF; INSERT INTO public.tool_competitor_admin_actions(admin_user_id,action,target_kind,target_id,reason,before_state,after_state) VALUES(uid,p_action,'provider',p_target,btrim(p_reason),jsonb_build_object('enabled',cap.enabled,'generation',cap.availability_generation),jsonb_build_object('enabled',p_action='resume_provider','generation',cap.availability_generation+1)); RETURN jsonb_build_object('ok',true);
 ELSIF p_action='retry_job' THEN SELECT * INTO j FROM public.tool_competitor_refresh_jobs WHERE id=p_target::uuid FOR UPDATE; IF j.state<>'failed_terminal' OR j.admin_retry_count>=1 OR j.competitor_id IS NULL THEN RAISE EXCEPTION 'retry_ineligible'; END IF; UPDATE public.tool_competitor_refresh_jobs SET admin_retry_count=1,updated_at=now() WHERE id=j.id; INSERT INTO public.tool_competitor_refresh_jobs(competitor_id,brand_id,venue_listing_id,trigger,due_week,source_set_fingerprint,idempotency_key,capability_snapshot,state,admin_retry_count,funding_lane,next_attempt_at) VALUES(j.competitor_id,j.brand_id,j.venue_listing_id,'admin_retry',j.due_week,j.source_set_fingerprint,public.issue_2725_sha256(j.id::text||'|admin-retry'),j.capability_snapshot,'due',1,'scheduled',now()) RETURNING id INTO retry_job; INSERT INTO public.tool_competitor_admin_actions(admin_user_id,action,target_kind,target_id,reason,before_state,after_state) VALUES(uid,'retry_job','job',j.id::text,btrim(p_reason),jsonb_build_object('state',j.state,'attempt_count',j.attempt_count),jsonb_build_object('state','due','attempt_count',0,'retry_job_id',retry_job)); RETURN jsonb_build_object('ok',true,'job_id',retry_job);
 ELSE RAISE EXCEPTION 'invalid_action'; END IF; END $$;

REVOKE ALL ON FUNCTION public.admin_competitor_intel_list(text,text,text,uuid,text) FROM public,anon; GRANT EXECUTE ON FUNCTION public.admin_competitor_intel_list(text,text,text,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_competitor_intel_action(text,text,bigint,text) FROM public,anon; GRANT EXECUTE ON FUNCTION public.admin_competitor_intel_action(text,text,bigint,text) TO authenticated;
-- All remaining RPCs are service-door implementation details. PostgreSQL grants
-- new functions to PUBLIC by default, so revoke that default explicitly.
REVOKE ALL ON FUNCTION public.issue_2725_one_primary_action(jsonb) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2725_sha256(text) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2725_due_week(timestamptz) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2725_jitter(uuid) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2725_normalize_source(text,text) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2725_source_set_fingerprint(uuid) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2725_capability_snapshot(uuid) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2725_enqueue(uuid,text,timestamptz,text) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2725_watch_upsert(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,uuid) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2725_watch_remove(uuid,uuid,timestamptz) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2725_claim_jobs(uuid,int) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2725_reserve_budget(uuid,bigint) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2725_finish_job(uuid,uuid,text,text,char(64),jsonb,jsonb) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2725_member_refresh(uuid,uuid,uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2725_one_primary_action(jsonb), public.issue_2725_sha256(text), public.issue_2725_due_week(timestamptz), public.issue_2725_jitter(uuid), public.issue_2725_normalize_source(text,text), public.issue_2725_source_set_fingerprint(uuid), public.issue_2725_capability_snapshot(uuid), public.issue_2725_enqueue(uuid,text,timestamptz,text), public.issue_2725_watch_upsert(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,uuid), public.issue_2725_watch_remove(uuid,uuid,timestamptz), public.issue_2725_claim_jobs(uuid,int), public.issue_2725_reserve_budget(uuid,bigint), public.issue_2725_finish_job(uuid,uuid,text,text,char(64),jsonb,jsonb), public.issue_2725_member_refresh(uuid,uuid,uuid) TO service_role;

-- Legacy rows become website-source watches without changing ids/history.
INSERT INTO public.tool_competitor_sources(competitor_id,brand_id,venue_listing_id,kind,normalized_url,normalized_identity,source_fingerprint,capability,health,last_checked_at,last_success_at)
SELECT c.id,c.brand_id,c.venue_listing_id,'website',(n->>'normalized_url'),(n->>'normalized_identity'),(n->>'source_fingerprint')::char(64),'analyzed_weekly','pending',latest.created_at,latest.created_at
FROM public.tool_competitors c CROSS JOIN LATERAL public.issue_2725_normalize_source('website',c.website) n
LEFT JOIN LATERAL (SELECT created_at FROM public.tool_leads WHERE brand_id=c.brand_id AND subject_ref='competitor:'||c.id AND status='report_ready' ORDER BY created_at DESC LIMIT 1) latest ON true
WHERE c.website IS NOT NULL ON CONFLICT DO NOTHING;
UPDATE public.tool_competitors c
SET next_due_at=CASE
  WHEN (SELECT max(l.created_at) FROM public.tool_leads l WHERE l.brand_id=c.brand_id AND l.subject_ref='competitor:'||c.id AND l.status='report_ready')>now()-interval '7 days'
    THEN (SELECT max(l.created_at) FROM public.tool_leads l WHERE l.brand_id=c.brand_id AND l.subject_ref='competitor:'||c.id AND l.status='report_ready')+interval '7 days'+public.issue_2725_jitter(c.id)
  ELSE now()+make_interval(secs=>(('x'||substr(md5(c.id::text),1,8))::bit(32)::bigint%86400)::int)
END
WHERE EXISTS(SELECT 1 FROM public.tool_competitor_sources s WHERE s.competitor_id=c.id AND s.kind='website');

-- Named repository caller. The worker itself exits before claims while scheduler_enabled=false.
SELECT cron.unschedule('issue_2725_competitor_intel_worker') WHERE EXISTS(SELECT 1 FROM cron.job WHERE jobname='issue_2725_competitor_intel_worker');
SELECT cron.schedule('issue_2725_competitor_intel_worker','*/15 * * * *',$cron$ SELECT net.http_post(url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)||'/functions/v1/competitor-intel-worker',headers:=jsonb_build_object('authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1),'content-type','application/json'),body:='{}'::jsonb); $cron$);

-- Apply-time fail-closed assertions.
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['tool_competitor_sources','tool_competitor_refresh_jobs','tool_competitor_observations','tool_competitor_briefs','tool_competitor_provider_capabilities','tool_competitor_budget_ledger','tool_competitor_admin_actions'] LOOP IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass) THEN RAISE EXCEPTION 'issue_2725_rls_missing:%',t; END IF; IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t) THEN RAISE EXCEPTION 'issue_2725_policy_forbidden:%',t; END IF; END LOOP; IF (SELECT mode FROM public.tool_competitor_provider_capabilities WHERE kind='tiktok')<>'link_only' THEN RAISE EXCEPTION 'issue_2725_tiktok_must_be_link_only'; END IF; IF (SELECT scheduler_enabled OR global_daily_limit_microusd<>0 OR default_brand_daily_limit_microusd<>0 FROM public.tool_competitor_intel_config WHERE singleton) THEN RAISE EXCEPTION 'issue_2725_rollout_must_seed_off'; END IF; END $$;
COMMIT;
