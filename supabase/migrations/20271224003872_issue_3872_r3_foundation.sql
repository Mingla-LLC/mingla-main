-- #3872 R3 C0 — creator-gig formats, fail-closed creator-media lane, and
-- server-issued gig guest passes.
--
-- Invariant I-3872-MEDIA-FAIL-CLOSED (declared in its test suite): Creator uploads are refused when either provider-cap usage is unreadable or at/above 90%; creator-media-upload-intent and its tests are the enforcement authority.
-- Invariant I-3872-GIG-COMP-IS-A-TICKET (declared in its test suite): Every active gig comp is backed by the existing real-ticket comp rail, so it counts toward capacity and is visible to the existing roster and scanner.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- Global kill switches stay dark. Per-brand rollout remains the second half of
-- the creator-gigs gate, exactly like R1/R2.
INSERT INTO public.feature_flags(flag_key,is_enabled,description)
VALUES
  ('creator_gigs_enabled',false,'#3872 R3 global creator-gigs kill switch'),
  ('creator_media_uploads_enabled',false,'#3872 R3 creator-media upload kill switch')
ON CONFLICT(flag_key) DO UPDATE SET description=EXCLUDED.description;

CREATE OR REPLACE FUNCTION public.issue_3872_creator_gigs_on(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
  SELECT COALESCE((SELECT is_enabled FROM public.feature_flags WHERE flag_key='creator_gigs_enabled'),false)
    AND EXISTS (
      SELECT 1
        FROM public.program_brand_rollouts
       WHERE brand_id=p_brand_id
         AND program='creator_gigs'
         AND phase IN ('pilot','ga')
    )
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_creator_gigs_on(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_creator_gigs_on(uuid) TO service_role;

-- The six launch formats are data, not client constants. Admin may evolve the
-- examples/specs without forcing an app release; inactive formats remain on
-- historical contracts.
CREATE TABLE public.gig_formats (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{3,40}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 3 AND 60),
  one_line text NOT NULL CHECK (char_length(btrim(one_line)) BETWEEN 8 AND 180),
  length_s_min integer NOT NULL CHECK (length_s_min BETWEEN 5 AND 90),
  length_s_max integer NOT NULL CHECK (length_s_max BETWEEN length_s_min AND 90),
  structure jsonb NOT NULL CHECK (jsonb_typeof(structure)='array' AND jsonb_array_length(structure)>0),
  platform_specs jsonb NOT NULL CHECK (jsonb_typeof(platform_specs)='object'),
  example_asset_ids text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.gig_formats(
  key,name,one_line,length_s_min,length_s_max,structure,platform_specs
) VALUES
  ('first_timer_reaction','First-timer reaction','A genuine first visit: arrival, first impression, one useful detail and the invitation to book.',20,45,
    '[{"key":"hook","from":0,"to":3},{"key":"arrival","from":3,"to":12},{"key":"reaction","from":12,"to":32},{"key":"cta","from":32,"to":45}]'::jsonb,
    '{"aspectRatio":"9:16","minFps":30,"captions":true}'::jsonb),
  ('night_out_30','Night out in 30 seconds','A fast night-out story that shows the atmosphere, the experience and why someone should go.',20,40,
    '[{"key":"hook","from":0,"to":3},{"key":"atmosphere","from":3,"to":18},{"key":"experience","from":18,"to":30},{"key":"cta","from":30,"to":40}]'::jsonb,
    '{"aspectRatio":"9:16","minFps":30,"captions":true}'::jsonb),
  ('what_price_gets','What the price gets you','A concrete value breakdown using the server display price and only verified inclusions.',20,45,
    '[{"key":"price_hook","from":0,"to":4},{"key":"included","from":4,"to":30},{"key":"value","from":30,"to":38},{"key":"cta","from":38,"to":45}]'::jsonb,
    '{"aspectRatio":"9:16","minFps":30,"captions":true,"serverPriceOnly":true}'::jsonb),
  ('behind_the_scenes','Behind the scenes','A host-led look at the people, preparation and craft behind the listing.',25,60,
    '[{"key":"hook","from":0,"to":4},{"key":"people","from":4,"to":20},{"key":"process","from":20,"to":48},{"key":"cta","from":48,"to":60}]'::jsonb,
    '{"aspectRatio":"9:16","minFps":30,"captions":true}'::jsonb),
  ('three_reasons','Three reasons to go','Three specific, supportable reasons that make the listing worth considering.',15,30,
    '[{"key":"hook","from":0,"to":3},{"key":"reason_1","from":3,"to":10},{"key":"reason_2","from":10,"to":17},{"key":"reason_3","from":17,"to":24},{"key":"cta","from":24,"to":30}]'::jsonb,
    '{"aspectRatio":"9:16","minFps":30,"captions":true}'::jsonb),
  ('date_idea','Date idea','A practical date plan showing the mood, what to do and how to book it.',20,45,
    '[{"key":"hook","from":0,"to":3},{"key":"plan","from":3,"to":22},{"key":"moment","from":22,"to":36},{"key":"cta","from":36,"to":45}]'::jsonb,
    '{"aspectRatio":"9:16","minFps":30,"captions":true}'::jsonb);

CREATE TRIGGER issue_3872_gig_formats_updated
BEFORE UPDATE ON public.gig_formats
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- A separate provider library and ledger for creator-owned review copies. The
-- application never writes this table directly; the edge control plane does.
CREATE TABLE public.creator_media_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_operation_id uuid NOT NULL,
  owner_kind text NOT NULL CHECK (owner_kind IN ('creator','local')),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('showcase','delivery','local_review','dispute_evidence')),
  contract_id uuid,
  local_month_id uuid,
  bunny_video_id text UNIQUE,
  status text NOT NULL DEFAULT 'awaiting_upload'
    CHECK (status IN ('awaiting_upload','processing','ready','failed','deleted')),
  duration_s numeric CHECK (duration_s IS NULL OR duration_s BETWEEN 0 AND 90),
  bytes_source bigint CHECK (bytes_source IS NULL OR bytes_source BETWEEN 0 AND 157286400),
  width integer CHECK (width IS NULL OR width>0),
  height integer CHECK (height IS NULL OR height>0),
  aspect_warning boolean NOT NULL DEFAULT false,
  failure_code text,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_provider_at timestamptz,
  ready_at timestamptz,
  source_deleted_at timestamptz,
  delete_after timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creator_media_owner_shape CHECK (
    (purpose='showcase' AND owner_kind='creator' AND contract_id IS NULL AND local_month_id IS NULL)
    OR (purpose IN ('delivery','dispute_evidence') AND owner_kind='creator' AND contract_id IS NOT NULL AND local_month_id IS NULL)
    OR (purpose='local_review' AND owner_kind='local' AND contract_id IS NULL AND local_month_id IS NOT NULL)
  ),
  CONSTRAINT creator_media_ready_shape CHECK (status<>'ready' OR ready_at IS NOT NULL),
  CONSTRAINT creator_media_failure_shape CHECK (status<>'failed' OR failure_code IS NOT NULL),
  CONSTRAINT creator_media_deleted_shape CHECK (status<>'deleted' OR deleted_at IS NOT NULL)
);
CREATE UNIQUE INDEX creator_media_jobs_operation_uq
  ON public.creator_media_jobs(owner_id,client_operation_id);
CREATE INDEX creator_media_jobs_owner_idx
  ON public.creator_media_jobs(owner_id,purpose,created_at DESC)
  WHERE status<>'deleted';
CREATE INDEX creator_media_jobs_contract_idx
  ON public.creator_media_jobs(contract_id,created_at DESC)
  WHERE contract_id IS NOT NULL AND status<>'deleted';
CREATE INDEX creator_media_jobs_reaper_idx
  ON public.creator_media_jobs(status,delete_after,created_at)
  WHERE status<>'deleted';
CREATE TRIGGER issue_3872_creator_media_updated
BEFORE UPDATE ON public.creator_media_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- The explicit gig-comp ledger points to the real zero-money comp order issued
-- by #3827. Existing guest roster and scanner code therefore need no parallel
-- rail and cannot drift from ordinary tickets.
CREATE TABLE public.guest_comp_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  occurrence_at timestamptz NOT NULL,
  guest_name text NOT NULL CHECK (char_length(btrim(guest_name)) BETWEEN 1 AND 120),
  guest_email_norm text CHECK (
    guest_email_norm IS NULL OR
    (guest_email_norm=lower(btrim(guest_email_norm)) AND position('@' in guest_email_norm)>1)
  ),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 10),
  source text NOT NULL CHECK (source IN ('host','gig')),
  source_ref uuid NOT NULL,
  issued_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  order_id uuid UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','checked_in')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,source,source_ref)
);
CREATE INDEX guest_comp_entries_event_idx
  ON public.guest_comp_entries(event_id,occurrence_at,status);

CREATE OR REPLACE FUNCTION public.biz_issue_comp(
  p_brand_id uuid,
  p_event_id uuid,
  p_occurrence_at timestamptz,
  p_guest_name text,
  p_guest_email_norm text,
  p_quantity integer,
  p_source text,
  p_source_ref uuid,
  p_issued_by uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_entry public.guest_comp_entries;
  v_event_date_id uuid;
  v_ticket_type_id uuid;
  v_result jsonb;
  v_order_id uuid;
BEGIN
  IF p_brand_id IS NULL OR p_event_id IS NULL OR p_occurrence_at IS NULL
     OR p_source_ref IS NULL OR p_issued_by IS NULL
     OR p_source NOT IN ('host','gig') OR p_quantity IS NULL
     OR p_quantity NOT BETWEEN 1 AND 10
     OR char_length(btrim(COALESCE(p_guest_name,''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid_comp_request';
  END IF;
  IF p_guest_email_norm IS NOT NULL AND (
    p_guest_email_norm<>lower(btrim(p_guest_email_norm))
    OR p_guest_email_norm!~'^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'
  ) THEN RAISE EXCEPTION 'invalid_comp_email'; END IF;

  SELECT * INTO v_entry
    FROM public.guest_comp_entries
   WHERE event_id=p_event_id AND source=p_source AND source_ref=p_source_ref;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'entryId',v_entry.id,'orderId',v_entry.order_id,'status',v_entry.status,
      'idempotentReplay',true
    );
  END IF;

  PERFORM 1
    FROM public.events e
   WHERE e.id=p_event_id AND e.brand_id=p_brand_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF public.biz_brand_effective_rank(p_brand_id,p_issued_by)<40 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT d.id INTO v_event_date_id
    FROM public.event_dates d
   WHERE d.event_id=p_event_id
     AND (d.start_at=p_occurrence_at OR p_occurrence_at BETWEEN d.start_at AND d.end_at)
   ORDER BY abs(extract(epoch FROM (d.start_at-p_occurrence_at))),d.id
   LIMIT 1;
  IF v_event_date_id IS NULL THEN RAISE EXCEPTION 'occurrence_not_found'; END IF;

  SELECT tt.id INTO v_ticket_type_id
    FROM public.ticket_types tt
   WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL
   ORDER BY
     (lower(tt.name)~'(guest|comp|creator)') DESC,
     tt.is_hidden DESC,
     tt.display_order,
     tt.created_at
   LIMIT 1;
  IF v_ticket_type_id IS NULL THEN RAISE EXCEPTION 'ticket_type_not_found'; END IF;

  v_result:=public.biz_comp_issue(
    p_issued_by,p_event_id,v_ticket_type_id,v_event_date_id,
    jsonb_build_array(jsonb_build_object(
      'index',0,'name',btrim(p_guest_name),'email',p_guest_email_norm,
      'phoneE164',NULL,'plusOnes',(
        SELECT COALESCE(jsonb_agg(jsonb_build_object('name',NULL,'email',NULL,'phoneE164',NULL)),'[]'::jsonb)
          FROM generate_series(1,GREATEST(p_quantity-1,0))
      )
    )),
    CASE WHEN p_source='gig' THEN 'Creator gig pass' ELSE 'Host comp' END,
    p_source_ref,p_qr_token_pepper
  );
  v_order_id:=NULLIF(v_result#>>'{results,0,orderId}','')::uuid;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'comp_issue_failed'; END IF;

  INSERT INTO public.guest_comp_entries(
    brand_id,event_id,occurrence_at,guest_name,guest_email_norm,quantity,
    source,source_ref,issued_by,order_id
  ) VALUES(
    p_brand_id,p_event_id,p_occurrence_at,btrim(p_guest_name),p_guest_email_norm,p_quantity,
    p_source,p_source_ref,p_issued_by,v_order_id
  ) RETURNING * INTO v_entry;

  RETURN jsonb_build_object(
    'entryId',v_entry.id,'orderId',v_entry.order_id,'status',v_entry.status,
    'ticketCount',p_quantity,'idempotentReplay',false
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.biz_issue_comp(uuid,uuid,timestamptz,text,text,integer,text,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_issue_comp(uuid,uuid,timestamptz,text,text,integer,text,uuid,uuid,text)
  TO service_role;

ALTER TABLE public.gig_formats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gig_formats FORCE ROW LEVEL SECURITY;
ALTER TABLE public.creator_media_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_media_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.guest_comp_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_comp_entries FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.gig_formats,public.creator_media_jobs,public.guest_comp_entries
  FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gig_formats TO authenticated;
GRANT SELECT ON public.creator_media_jobs TO authenticated;
GRANT ALL ON public.gig_formats,public.creator_media_jobs,public.guest_comp_entries TO service_role;

CREATE POLICY gig_formats_active_read ON public.gig_formats
FOR SELECT TO authenticated USING (active);
CREATE POLICY creator_media_owner_read ON public.creator_media_jobs
FOR SELECT TO authenticated USING (owner_id=auth.uid());

DO $cron$
DECLARE v_job bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL
    OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE NOTICE '#3872: pg_cron/pg_net unavailable; creator-media reaper not scheduled';
    RETURN;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL
    OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='supabase_url')
    OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='service_role_key') THEN
    RAISE NOTICE '#3872: runtime vault rows unavailable; creator-media reaper not scheduled';
    RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname='issue_3872_creator_media_reaper';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('issue_3872_creator_media_reaper','0 */6 * * *',$job$SELECT net.http_post(
    url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)||'/functions/v1/creator-media-reaper',
    headers:=jsonb_build_object('content-type','application/json','authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
    body:='{}'::jsonb,timeout_milliseconds:=55000)$job$);
END;
$cron$;

NOTIFY pgrst,'reload schema';
COMMIT;
