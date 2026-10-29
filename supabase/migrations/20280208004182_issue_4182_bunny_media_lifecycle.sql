-- #4182 — Bunny is the one private media rail for Creator and Local video.
-- Invariant I-4182-MEDIA-RETENTION: creator-media-reaper may delete a delivery
-- only after approval, verified posting, completed payout, no active dispute,
-- no legal hold, and the lifecycle-derived retention deadline.

BEGIN;
SET LOCAL lock_timeout='10s';

ALTER TABLE public.creator_media_jobs
  ADD COLUMN IF NOT EXISTS retention_anchor_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_hold_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_hold_reason text,
  ADD COLUMN IF NOT EXISTS purge_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS purge_outcome text,
  ADD COLUMN IF NOT EXISTS purge_failure_code text;

-- The agreement is published by this reviewed release, never typed by an Admin
-- while deciding one person's application. The immutable version, URL and
-- canonical digest below are the signing authority for every applicant.
CREATE TABLE public.local_agreement_versions (
  version text PRIMARY KEY CHECK(char_length(btrim(version)) BETWEEN 1 AND 80),
  document_url text NOT NULL CHECK(document_url~'^https://[^[:space:]]+$'),
  document_sha256 text NOT NULL CHECK(document_sha256~'^[0-9a-f]{64}$'),
  effective_at timestamptz NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  retired_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_agreement_current_shape CHECK(NOT is_current OR retired_at IS NULL)
);
CREATE UNIQUE INDEX local_agreement_one_current_uq
  ON public.local_agreement_versions(is_current) WHERE is_current;

-- Production authority for the applicant signing screen. The marketing route
-- publishes the exact canonical copy whose digest is pinned here; changing a
-- word requires a new version and fingerprint, never an in-place rewrite.
INSERT INTO public.local_agreement_versions(
  version,document_url,document_sha256,effective_at,is_current
) VALUES(
  'local-ng-1.0',
  'https://usemingla.com/local-agreement',
  '65d2ac74f256dc9bf013aa56afced7f15210083854e471e89f8d7ddce255a954',
  '2026-10-29T00:00:00Z'::timestamptz,
  true
);

ALTER TABLE public.local_applications
  ADD COLUMN agreement_version text REFERENCES public.local_agreement_versions(version) ON DELETE RESTRICT,
  ADD COLUMN agreement_due_at timestamptz;
ALTER TABLE public.local_applications
  DROP CONSTRAINT IF EXISTS local_applications_status_check;
ALTER TABLE public.local_applications
  ADD CONSTRAINT local_applications_status_check CHECK(status IN (
    'submitted','shortlisted','agreement_pending','accepted','waitlisted','rejected'
  )),
  ADD CONSTRAINT local_application_agreement_shape CHECK(
    status<>'agreement_pending'
    OR (agreement_version IS NOT NULL AND agreement_due_at IS NOT NULL)
  );
DROP INDEX public.local_applications_one_active_uq;
CREATE UNIQUE INDEX local_applications_one_active_uq
  ON public.local_applications(user_id,city_id)
  WHERE status IN ('submitted','shortlisted','agreement_pending','accepted');

CREATE TABLE public.local_agreement_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public.local_applications(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  agreement_version text NOT NULL REFERENCES public.local_agreement_versions(version) ON DELETE RESTRICT,
  document_url text NOT NULL CHECK(document_url~'^https://[^[:space:]]+$'),
  document_sha256 text NOT NULL CHECK(document_sha256~'^[0-9a-f]{64}$'),
  signature_name text NOT NULL CHECK(char_length(btrim(signature_name)) BETWEEN 2 AND 120),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.locals
  ADD COLUMN agreement_signed_at timestamptz,
  ADD COLUMN agreement_acceptance_id uuid UNIQUE REFERENCES public.local_agreement_acceptances(id) ON DELETE RESTRICT;
ALTER TABLE public.locals
  ADD CONSTRAINT locals_agreement_acceptance_shape CHECK(
    (agreement_signed_at IS NULL AND agreement_acceptance_id IS NULL)
    OR (agreement_signed_at IS NOT NULL AND agreement_acceptance_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.issue_4182_local_agreement_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION 'local_agreement_acceptance_immutable' USING ERRCODE='55000';
END;
$fn$;
CREATE TRIGGER issue_4182_local_agreement_immutable
BEFORE UPDATE OR DELETE ON public.local_agreement_acceptances
FOR EACH ROW EXECUTE FUNCTION public.issue_4182_local_agreement_immutable();

CREATE OR REPLACE FUNCTION public.issue_4182_local_agreement_version_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN
  IF TG_OP='DELETE'
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.document_url IS DISTINCT FROM OLD.document_url
    OR NEW.document_sha256 IS DISTINCT FROM OLD.document_sha256
    OR NEW.effective_at IS DISTINCT FROM OLD.effective_at THEN
    RAISE EXCEPTION 'local_agreement_version_immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_4182_local_agreement_version_guard
BEFORE UPDATE OR DELETE ON public.local_agreement_versions
FOR EACH ROW EXECUTE FUNCTION public.issue_4182_local_agreement_version_guard();

ALTER TABLE public.local_agreement_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_agreement_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.local_agreement_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_agreement_acceptances FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.local_agreement_versions,public.local_agreement_acceptances
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.local_application_decide(
  p_application_id uuid,p_status text,p_agreement_version text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_app public.local_applications;
  v_program public.local_city_programs;
  v_agreement public.local_agreement_versions;
  v_reserved integer;
  v_due timestamptz;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE='42501';
  END IF;
  IF p_agreement_version IS NOT NULL THEN
    RAISE EXCEPTION 'agreement_version_is_server_owned' USING ERRCODE='22023';
  END IF;
  IF p_status='accepted' THEN
    RAISE EXCEPTION 'local_signature_required' USING ERRCODE='55000';
  END IF;
  IF p_status NOT IN ('shortlisted','agreement_pending','waitlisted','rejected') THEN
    RAISE EXCEPTION 'invalid_application_status' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_app FROM public.local_applications
  WHERE id=p_application_id FOR UPDATE;
  IF NOT FOUND OR v_app.status NOT IN (
    'submitted','shortlisted','waitlisted','agreement_pending'
  ) THEN
    RAISE EXCEPTION 'application_not_reviewable' USING ERRCODE='55000';
  END IF;

  IF p_status='agreement_pending' THEN
    SELECT * INTO v_program FROM public.local_city_programs
    WHERE city_id=v_app.city_id FOR UPDATE;
    IF NOT FOUND OR NOT v_program.is_open THEN
      RAISE EXCEPTION 'local_city_closed' USING ERRCODE='55000';
    END IF;
    SELECT * INTO v_agreement FROM public.local_agreement_versions
    WHERE is_current AND effective_at<=now() AND retired_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'local_agreement_not_published' USING ERRCODE='55000';
    END IF;
    SELECT
      (SELECT count(*) FROM public.locals l
        WHERE l.city_id=v_app.city_id AND l.status='active')
      +
      (SELECT count(*) FROM public.local_applications a
        WHERE a.city_id=v_app.city_id AND a.status='agreement_pending'
          AND a.agreement_due_at>now() AND a.id<>v_app.id)
    INTO v_reserved;
    IF v_reserved>=v_program.seats THEN
      RAISE EXCEPTION 'local_city_seats_full' USING ERRCODE='23514';
    END IF;
    v_due:=clock_timestamp()+interval '7 days';
    UPDATE public.local_applications SET
      status='agreement_pending',agreement_version=v_agreement.version,
      agreement_due_at=v_due,reviewed_by=auth.uid(),reviewed_at=now()
    WHERE id=v_app.id;
    INSERT INTO public.local_events(actor,kind,data)
    VALUES('admin','local_agreement_invited',jsonb_build_object(
      'application_id',v_app.id,'city_id',v_app.city_id,
      'agreement_version',v_agreement.version
    ));
  ELSE
    UPDATE public.local_applications SET
      status=p_status,agreement_version=NULL,agreement_due_at=NULL,
      reviewed_by=auth.uid(),reviewed_at=now()
    WHERE id=v_app.id;
  END IF;
  RETURN jsonb_build_object(
    'ok',true,'status',p_status,
    'agreement_version',CASE WHEN p_status='agreement_pending' THEN v_agreement.version ELSE NULL END,
    'agreement_due_at',CASE WHEN p_status='agreement_pending' THEN v_due ELSE NULL END
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_agreement_sign(
  p_application_id uuid,p_agreement_version text,p_signature_name text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_actor uuid:=auth.uid();
  v_app public.local_applications;
  v_agreement public.local_agreement_versions;
  v_acceptance uuid;
  v_local uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000';
  END IF;
  IF nullif(btrim(p_signature_name),'') IS NULL
    OR char_length(btrim(p_signature_name)) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'signature_name_required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_app FROM public.local_applications
  WHERE id=p_application_id AND user_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found' USING ERRCODE='P0002'; END IF;

  SELECT l.id INTO v_local FROM public.locals l WHERE l.user_id=v_actor;
  SELECT a.id INTO v_acceptance FROM public.local_agreement_acceptances a
  WHERE a.application_id=v_app.id AND a.user_id=v_actor;
  IF v_acceptance IS NOT NULL AND v_local IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'status','accepted','local_id',v_local);
  END IF;

  IF v_app.status='agreement_pending' THEN
    IF v_app.agreement_due_at IS NULL OR v_app.agreement_due_at<=now() THEN
      RAISE EXCEPTION 'local_agreement_invitation_expired' USING ERRCODE='55000';
    END IF;
  ELSIF NOT (v_app.status='accepted' AND v_local IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.locals l
    WHERE l.id=v_local AND l.agreement_signed_at IS NULL
  )) THEN
    RAISE EXCEPTION 'local_agreement_not_signable' USING ERRCODE='55000';
  END IF;

  SELECT * INTO v_agreement FROM public.local_agreement_versions
  WHERE version=coalesce(v_app.agreement_version,p_agreement_version)
    AND version=p_agreement_version AND effective_at<=now()
    AND is_current AND retired_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'local_agreement_superseded' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.local_agreement_acceptances(
    application_id,user_id,agreement_version,document_url,document_sha256,signature_name
  ) VALUES(
    v_app.id,v_actor,v_agreement.version,v_agreement.document_url,
    v_agreement.document_sha256,btrim(p_signature_name)
  ) RETURNING id INTO v_acceptance;

  INSERT INTO public.locals(
    user_id,city_id,status,agreement_version,agreement_signed_at,agreement_acceptance_id
  ) VALUES(
    v_actor,v_app.city_id,'active',v_agreement.version,now(),v_acceptance
  )
  ON CONFLICT(user_id) DO UPDATE SET
    city_id=excluded.city_id,status='active',ends_on=NULL,
    agreement_version=excluded.agreement_version,
    agreement_signed_at=excluded.agreement_signed_at,
    agreement_acceptance_id=excluded.agreement_acceptance_id
  RETURNING id INTO v_local;

  UPDATE public.local_applications SET
    status='accepted',agreement_version=v_agreement.version,
    agreement_due_at=NULL,reviewed_at=coalesce(reviewed_at,now())
  WHERE id=v_app.id;
  INSERT INTO public.local_events(local_id,actor,kind,data)
  VALUES(v_local,'local','local_agreement_signed',jsonb_build_object(
    'application_id',v_app.id,'agreement_version',v_agreement.version,
    'acceptance_id',v_acceptance
  ));
  RETURN jsonb_build_object('ok',true,'status','accepted','local_id',v_local);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_4182_local_signed_action_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE v_local public.locals;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_local FROM public.locals WHERE id=NEW.local_id;
  IF FOUND AND v_local.user_id=auth.uid() AND v_local.agreement_signed_at IS NULL THEN
    RAISE EXCEPTION 'local_agreement_signature_required' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_4182_local_signed_action_guard
BEFORE INSERT OR UPDATE ON public.local_months
FOR EACH ROW EXECUTE FUNCTION public.issue_4182_local_signed_action_guard();

-- A signed applicant may claim an already-reserved seat even if Admin pauses
-- new applications after sending the invitation. Capacity remains locked.
CREATE OR REPLACE FUNCTION public.issue_3872_local_seat_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE v_program public.local_city_programs; v_count integer;
BEGIN
  IF NEW.status<>'active' THEN RETURN NEW; END IF;
  SELECT * INTO v_program FROM public.local_city_programs
  WHERE city_id=NEW.city_id FOR UPDATE;
  IF NOT FOUND OR (NOT v_program.is_open AND NEW.agreement_acceptance_id IS NULL) THEN
    RAISE EXCEPTION 'local_city_closed' USING ERRCODE='55000';
  END IF;
  SELECT count(*) INTO v_count FROM public.locals l
  WHERE l.city_id=NEW.city_id AND l.status='active' AND l.id IS DISTINCT FROM NEW.id;
  IF v_count>=v_program.seats THEN
    RAISE EXCEPTION 'local_city_seats_full' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$fn$;

-- Live signing invitations reserve capacity. Admin may pause applications,
-- but cannot shrink the city below active plus unexpired reserved seats.
CREATE OR REPLACE FUNCTION public.local_city_program_save(
  p_city_id uuid,p_seats integer,p_is_open boolean,
  p_monthly_rate_minor bigint DEFAULT NULL,p_payout_currency text DEFAULT NULL,
  p_monthly_usd_minor bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_active integer;
  v_reserved integer;
  v_committed integer;
  v_existing public.local_city_programs;
  v_rate bigint;
  v_currency text;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  IF p_city_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.seeding_cities WHERE id=p_city_id) THEN
    RETURN jsonb_build_object('ok',false,'error','city_not_found','field','city_id');
  END IF;
  IF p_seats IS NULL OR p_seats NOT BETWEEN 0 AND 10 THEN
    RETURN jsonb_build_object('ok',false,'error','seats_invalid','field','seats');
  END IF;
  SELECT * INTO v_existing FROM public.local_city_programs WHERE city_id=p_city_id FOR UPDATE;
  v_currency:=upper(btrim(coalesce(p_payout_currency,v_existing.payout_currency,'USD')));
  v_rate:=coalesce(
    p_monthly_rate_minor,
    CASE WHEN v_currency='USD' THEN p_monthly_usd_minor END,
    v_existing.monthly_rate_minor,15000
  );
  IF v_currency!~'^[A-Z]{3}$' OR NOT EXISTS(
    SELECT 1 FROM public.supported_brand_currencies c WHERE c.code=v_currency
  ) THEN
    RETURN jsonb_build_object('ok',false,'error','currency_invalid','field','payout_currency');
  END IF;
  IF v_rate<=0 THEN
    RETURN jsonb_build_object('ok',false,'error','rate_invalid','field','monthly_rate_minor');
  END IF;
  SELECT count(*) INTO v_active FROM public.locals
  WHERE city_id=p_city_id AND status='active';
  SELECT count(*) INTO v_reserved FROM public.local_applications
  WHERE city_id=p_city_id AND status='agreement_pending' AND agreement_due_at>now();
  v_committed:=v_active+v_reserved;
  IF p_seats<v_committed THEN
    RETURN jsonb_build_object(
      'ok',false,'error','seats_below_active_locals','field','seats',
      'active',v_active,'reserved',v_reserved,'committed',v_committed
    );
  END IF;
  INSERT INTO public.local_city_programs(
    city_id,seats,is_open,monthly_usd_minor,monthly_rate_minor,payout_currency,updated_by
  ) VALUES(
    p_city_id,p_seats,coalesce(p_is_open,false),
    CASE WHEN v_currency='USD' THEN v_rate ELSE coalesce(p_monthly_usd_minor,15000) END,
    v_rate,v_currency,auth.uid()
  )
  ON CONFLICT(city_id) DO UPDATE SET
    seats=excluded.seats,is_open=excluded.is_open,
    monthly_usd_minor=CASE
      WHEN excluded.payout_currency='USD' THEN excluded.monthly_rate_minor
      ELSE public.local_city_programs.monthly_usd_minor
    END,
    monthly_rate_minor=excluded.monthly_rate_minor,
    payout_currency=excluded.payout_currency,updated_by=excluded.updated_by;
  RETURN jsonb_build_object(
    'ok',true,'active',v_active,'reserved',v_reserved,'seats',p_seats,
    'monthly_rate_minor',v_rate,'payout_currency',v_currency
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_landing() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT jsonb_build_object(
    'enabled',coalesce((SELECT is_enabled FROM public.feature_flags WHERE flag_key='mingla_locals_enabled'),false),
    'viewer_city_id',coalesce(
      (SELECT l.city_id FROM public.locals l WHERE l.user_id=auth.uid()),
      (SELECT p.home_city_id FROM public.creator_profiles p WHERE p.creator_account_id=auth.uid())),
    'programs',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'city_id',cp.city_id,'city',c.name,'seats',cp.seats,
      'monthly_usd_minor',cp.monthly_usd_minor,
      'monthly_rate_minor',cp.monthly_rate_minor,'payout_currency',cp.payout_currency
    ) ORDER BY c.name)
      FROM public.local_city_programs cp JOIN public.seeding_cities c ON c.id=cp.city_id
      WHERE cp.is_open AND EXISTS(
        SELECT 1 FROM public.feature_flags f
        WHERE f.flag_key='mingla_locals_enabled' AND f.is_enabled
      )),'[]'::jsonb),
    'applications',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',a.id,'city_id',a.city_id,'city',c.name,'status',a.status,
      'created_at',a.created_at,'agreement_version',a.agreement_version,
      'agreement_due_at',a.agreement_due_at
    ) ORDER BY a.created_at DESC)
      FROM public.local_applications a JOIN public.seeding_cities c ON c.id=a.city_id
      WHERE a.user_id=auth.uid()),'[]'::jsonb),
    'agreement',(
      SELECT jsonb_build_object(
        'version',v.version,'document_url',v.document_url,
        'document_sha256',v.document_sha256,'effective_at',v.effective_at
      )
      FROM public.local_agreement_versions v
      WHERE v.version=coalesce(
        (SELECT a.agreement_version FROM public.local_applications a
          WHERE a.user_id=auth.uid() AND a.status='agreement_pending'
          ORDER BY a.created_at DESC LIMIT 1),
        (SELECT current_v.version FROM public.local_agreement_versions current_v
          WHERE current_v.is_current AND current_v.effective_at<=now()
            AND current_v.retired_at IS NULL)
      ) AND v.retired_at IS NULL
    ),
    'local',(
      SELECT jsonb_build_object(
        'id',l.id,'city_id',l.city_id,'city',c.name,'status',l.status,
        'since',l.seat_started_on,'monthly_rate_minor',cp.monthly_rate_minor,
        'payout_currency',cp.payout_currency,
        'agreement_version',l.agreement_version,
        'agreement_signed_at',l.agreement_signed_at
      )
      FROM public.locals l JOIN public.seeding_cities c ON c.id=l.city_id
      LEFT JOIN public.local_city_programs cp ON cp.city_id=l.city_id
      WHERE l.user_id=auth.uid()
    )
  );
$fn$;

CREATE OR REPLACE FUNCTION public.admin_local_queue() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'agreement',(SELECT jsonb_build_object(
      'version',v.version,'document_url',v.document_url,
      'document_sha256',v.document_sha256,'effective_at',v.effective_at
    ) FROM public.local_agreement_versions v
      WHERE v.is_current AND v.effective_at<=now() AND v.retired_at IS NULL),
    'cities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name) FROM public.seeding_cities c),'[]'::jsonb),
    'programs',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'city_id',p.city_id,'city',c.name,'seats',p.seats,
      'active',(SELECT count(*) FROM public.locals l WHERE l.city_id=p.city_id AND l.status='active'),
      'reserved',(SELECT count(*) FROM public.local_applications a
        WHERE a.city_id=p.city_id AND a.status='agreement_pending' AND a.agreement_due_at>now()),
      'is_open',p.is_open,'monthly_usd_minor',p.monthly_usd_minor,
      'monthly_rate_minor',p.monthly_rate_minor,'payout_currency',p.payout_currency
    ) ORDER BY c.name) FROM public.local_city_programs p JOIN public.seeding_cities c ON c.id=p.city_id),'[]'::jsonb),
    'applications',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',a.id,'user_id',a.user_id,'display_name',coalesce(nullif(btrim(pr.display_name),''),pr.username),
      'city_id',a.city_id,'city',c.name,'handles',a.handles,
      'sample_links',a.sample_links,'why',a.why,'status',a.status,
      'created_at',a.created_at,'agreement_version',a.agreement_version,
      'agreement_due_at',a.agreement_due_at,'agreement_signed_at',x.accepted_at,
      'signature_name',x.signature_name
    ) ORDER BY a.created_at)
      FROM public.local_applications a
      JOIN public.seeding_cities c ON c.id=a.city_id
      LEFT JOIN public.profiles pr ON pr.id=a.user_id
      LEFT JOIN public.local_agreement_acceptances x ON x.application_id=a.id
      LEFT JOIN public.locals l ON l.user_id=a.user_id AND l.city_id=a.city_id
      WHERE a.status IN ('submitted','shortlisted','waitlisted','agreement_pending')
        OR (a.status='accepted' AND (
          x.accepted_at>=now()-interval '30 days' OR l.agreement_signed_at IS NULL
        ))),'[]'::jsonb),
    'picks',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'local_month_id',m.id,'local_id',m.local_id,
      'local_name',coalesce(nullif(btrim(p.display_name),''),p.username),
      'city',c.name,'place_id',m.place_id,'place_name',pp.name,
      'month',m.month,'status',m.status,'picked_at',m.picked_at
    ) ORDER BY m.picked_at DESC NULLS LAST)
      FROM public.local_months m JOIN public.locals l ON l.id=m.local_id
      JOIN public.profiles p ON p.id=l.user_id JOIN public.seeding_cities c ON c.id=l.city_id
      LEFT JOIN public.place_pool pp ON pp.id=m.place_id
      WHERE m.month=date_trunc('month',current_date)::date),'[]'::jsonb),
    'reviews',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'local_month_id',m.id,'local_id',m.local_id,
      'local_name',coalesce(p.display_name,p.username),'place_name',pp.name,
      'month',m.month,'status',m.status,'review',to_jsonb(r),
      'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at,e.id),'[]'::jsonb)
        FROM public.local_events e WHERE e.local_month_id=m.id)
    ) ORDER BY m.submitted_at)
      FROM public.local_months m JOIN public.local_reviews r ON r.local_month_id=m.id
      JOIN public.locals l ON l.id=m.local_id JOIN public.profiles p ON p.id=l.user_id
      JOIN public.place_pool pp ON pp.id=m.place_id
      WHERE m.status IN ('submitted','changes_requested')),'[]'::jsonb),
    'payouts',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'local_month_id',m.id,'local_name',coalesce(p.display_name,p.username),
      'month',m.month,'status',m.status,'currency',m.payout_currency,
      'amount_minor',m.payout_amount_minor,'share_status',s.status
    ) ORDER BY m.month DESC)
      FROM public.local_months m JOIN public.locals l ON l.id=m.local_id
      JOIN public.profiles p ON p.id=l.user_id
      LEFT JOIN public.payee_shares s ON s.id=m.payee_share_id
      WHERE m.status IN ('published','paid')),'[]'::jsonb)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_local_application_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_title text; v_body text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
    AND NOT (
      NEW.status='agreement_pending'
      AND NEW.agreement_due_at IS DISTINCT FROM OLD.agreement_due_at
    ) THEN RETURN NEW; END IF;
  IF NEW.status='agreement_pending' THEN
    v_title:='Your Mingla Local agreement is ready';
    v_body:='Review and sign the agreement in Mingla to activate your reserved Local seat.';
  ELSIF NEW.status='accepted' THEN
    v_title:='You’re now a Mingla Local';
    v_body:='Your agreement is signed and your Local seat is active.';
  ELSE
    v_title:='Mingla Local application updated';
    v_body:='Your application is now '||replace(NEW.status,'_',' ')||'.';
  END IF;
  INSERT INTO public.notification_outbox(category_key,user_id,payload,idempotency_key,status)
  VALUES('consumer.local.application_update',NEW.user_id,jsonb_build_object(
    'title',v_title,'body',v_body,'application_id',NEW.id,
    'status',NEW.status,'deep_link','mingla://local'
  ),'consumer.local.application_update:'||NEW.id::text||':'||NEW.status||
    CASE WHEN NEW.status='agreement_pending' THEN
      ':'||NEW.agreement_due_at::text ELSE '' END,
    'pending')
  ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$fn$;

ALTER TABLE public.creator_media_jobs
  DROP CONSTRAINT IF EXISTS creator_media_retention_hold_shape;
ALTER TABLE public.creator_media_jobs
  ADD CONSTRAINT creator_media_retention_hold_shape CHECK (
    (retention_hold_at IS NULL AND retention_hold_reason IS NULL)
    OR (retention_hold_at IS NOT NULL AND nullif(btrim(retention_hold_reason),'') IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.issue_4182_sync_delivery_retention()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_anchor timestamptz:=clock_timestamp();
BEGIN
  IF NEW.state IS NOT DISTINCT FROM OLD.state OR NEW.state NOT IN (
    'approved','posting','posts_submitted','posts_failed','posts_verified',
    'released','day30','completed','resolved_release','resolved_partial','resolved_refund'
  ) THEN
    RETURN NEW;
  END IF;
  UPDATE public.creator_media_jobs j SET
    retention_anchor_at=greatest(coalesce(j.retention_anchor_at,'-infinity'::timestamptz),v_anchor),
    delete_after=greatest(coalesce(j.delete_after,'-infinity'::timestamptz),v_anchor+interval '120 days'),
    updated_at=v_anchor
  WHERE j.contract_id=NEW.id AND j.purpose='delivery' AND j.status='ready'
    AND j.deleted_at IS NULL
    AND EXISTS(
      SELECT 1 FROM public.gig_deliveries d
      WHERE d.contract_id=NEW.id AND d.media_job_id=j.id
        AND d.decision IN ('approved','auto_approved')
    );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS issue_4182_delivery_retention ON public.gig_contracts;
CREATE TRIGGER issue_4182_delivery_retention
AFTER UPDATE OF state ON public.gig_contracts
FOR EACH ROW EXECUTE FUNCTION public.issue_4182_sync_delivery_retention();

CREATE OR REPLACE FUNCTION public.issue_4182_sync_local_retention()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_anchor timestamptz:=clock_timestamp();
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status IN ('published','paid') THEN
    UPDATE public.creator_media_jobs SET
      retention_anchor_at=NULL,delete_after=NULL,updated_at=v_anchor
    WHERE local_month_id=NEW.id AND purpose='local_review' AND status='ready'
      AND deleted_at IS NULL;
  ELSIF NEW.status='void' THEN
    UPDATE public.creator_media_jobs SET
      retention_anchor_at=v_anchor,delete_after=v_anchor+interval '30 days',updated_at=v_anchor
    WHERE local_month_id=NEW.id AND purpose='local_review' AND status='ready'
      AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS issue_4182_local_retention ON public.local_months;
CREATE TRIGGER issue_4182_local_retention
AFTER UPDATE OF status ON public.local_months
FOR EACH ROW EXECUTE FUNCTION public.issue_4182_sync_local_retention();

-- Existing approved deliveries must not keep the old encode-time clock. Use
-- the latest known delivery/workflow milestone, and give in-flight rows at
-- least a fresh 120-day safety window from this repair.
WITH anchors AS (
  SELECT d.media_job_id,
    greatest(
      coalesce(d.decided_at,'-infinity'::timestamptz),
      coalesce((
        SELECT max(e.at) FROM public.gig_events e
        WHERE e.contract_id=d.contract_id AND e.kind IN (
          'approved','auto_approved','posts_submitted','posts_passed',
          'host_confirm','auto_confirm','release','dispute_release_recorded'
        )
      ),'-infinity'::timestamptz),
      clock_timestamp()
    ) AS anchor_at
  FROM public.gig_deliveries d
  WHERE d.decision IN ('approved','auto_approved')
)
UPDATE public.creator_media_jobs j SET
  retention_anchor_at=a.anchor_at,
  delete_after=greatest(coalesce(j.delete_after,'-infinity'::timestamptz),a.anchor_at+interval '120 days'),
  updated_at=clock_timestamp()
FROM anchors a
WHERE j.id=a.media_job_id AND j.purpose='delivery' AND j.status='ready'
  AND j.deleted_at IS NULL;

UPDATE public.creator_media_jobs j SET
  retention_anchor_at=NULL,delete_after=NULL,updated_at=clock_timestamp()
FROM public.local_months m
WHERE j.local_month_id=m.id AND j.purpose='local_review' AND j.status='ready'
  AND j.deleted_at IS NULL AND m.status IN ('published','paid');

UPDATE public.creator_media_jobs j SET
  retention_anchor_at=clock_timestamp(),
  delete_after=greatest(coalesce(j.delete_after,'-infinity'::timestamptz),clock_timestamp()+interval '30 days'),
  updated_at=clock_timestamp()
FROM public.local_months m
WHERE j.local_month_id=m.id AND j.purpose='local_review' AND j.status='ready'
  AND j.deleted_at IS NULL AND m.status='void';

CREATE OR REPLACE FUNCTION public.issue_4182_creator_media_reap_candidates(
  p_now timestamptz DEFAULT now(),p_limit integer DEFAULT 500
) RETURNS TABLE(
  id uuid,bunny_video_id text,status text,created_at timestamptz,
  delete_after timestamptz,reap_reason text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT j.id,j.bunny_video_id,j.status,j.created_at,j.delete_after,
    CASE
      WHEN j.status='awaiting_upload' THEN 'abandoned_upload'
      WHEN j.purpose='delivery' THEN 'delivery_lifecycle_complete'
      WHEN j.purpose='dispute_evidence' THEN 'evidence_retention_complete'
      WHEN j.purpose='local_review' THEN 'unpublished_grace_complete'
      ELSE 'retention_complete'
    END
  FROM public.creator_media_jobs j
  WHERE j.status<>'deleted'
    AND j.retention_hold_at IS NULL
    AND (
      (j.status='awaiting_upload' AND j.created_at<=p_now-interval '24 hours')
      OR (
        j.status='ready' AND j.delete_after IS NOT NULL AND j.delete_after<=p_now
        AND (
          (
            j.purpose='delivery'
            AND EXISTS(
              SELECT 1 FROM public.gig_deliveries d
              WHERE d.contract_id=j.contract_id AND d.media_job_id=j.id
                AND d.decision IN ('approved','auto_approved')
            )
            AND EXISTS(
              SELECT 1 FROM public.gig_contracts c
              WHERE c.id=j.contract_id AND (
                (
                  c.state IN ('released','day30','completed','resolved_release','resolved_partial')
                  AND EXISTS(
                    SELECT 1 FROM public.payee_shares s
                    WHERE s.order_kind='gig' AND s.order_id=c.id
                      AND s.payee_kind='gig_fee' AND s.status='paid'
                  )
                )
                OR (
                  c.state='resolved_refund'
                  AND NOT EXISTS(
                    SELECT 1 FROM public.payee_shares s
                    WHERE s.order_kind='gig' AND s.order_id=c.id
                      AND s.payee_kind='gig_fee' AND s.status<>'paid'
                  )
                )
              )
            )
            AND NOT EXISTS(
              SELECT 1 FROM public.gig_disputes d
              WHERE d.contract_id=j.contract_id
                AND d.status IN ('open','settling','escalated')
            )
          )
          OR (
            j.purpose='dispute_evidence'
            AND NOT EXISTS(
              SELECT 1 FROM public.gig_disputes d
              WHERE d.contract_id=j.contract_id
                AND d.status IN ('open','settling','escalated')
            )
          )
          OR (
            j.purpose='local_review'
            AND EXISTS(
              SELECT 1 FROM public.local_months m
              WHERE m.id=j.local_month_id AND m.status='void'
            )
          )
        )
      )
    )
  ORDER BY j.created_at
  LIMIT greatest(1,least(coalesce(p_limit,500),500));
$fn$;

REVOKE ALL ON FUNCTION public.issue_4182_creator_media_reap_candidates(timestamptz,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4182_creator_media_reap_candidates(timestamptz,integer)
  TO service_role;

-- Approval is server-gated on the same ready media that Admin just reviewed.
-- The UI adds the human watch attestation; this guard prevents publishing a
-- row whose Bunny asset disappeared or failed after submission.
CREATE OR REPLACE FUNCTION public.local_social_check_admin_confirm(
  p_local_month_id uuid,
  p_video_matches boolean,
  p_account_matches boolean,
  p_has_disclosure boolean,
  p_has_mingla_collab boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_month public.local_months;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_month FROM public.local_months
    WHERE id=p_local_month_id FOR UPDATE;
  IF NOT FOUND OR v_month.status<>'submitted' OR NOT EXISTS(
    SELECT 1 FROM public.local_reviews r
    WHERE r.local_month_id=v_month.id AND nullif(btrim(r.social_post_url),'') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'local_social_post_not_reviewable' USING ERRCODE='55000';
  END IF;
  IF NOT coalesce(p_video_matches,false)
    OR NOT coalesce(p_account_matches,false)
    OR NOT coalesce(p_has_disclosure,false)
    OR NOT coalesce(p_has_mingla_collab,false) THEN
    RAISE EXCEPTION 'local_social_check_incomplete' USING ERRCODE='22023';
  END IF;
  UPDATE public.local_reviews SET
    social_check_status='passed',
    social_check_detail=jsonb_build_object(
      'method','admin_manual_review',
      'reviewed_by',auth.uid(),
      'reviewed_at',clock_timestamp(),
      'video_matches',true,
      'account_matches',true,
      'has_disclosure',true,
      'has_mingla_collab',true
    )
  WHERE local_month_id=v_month.id;
  INSERT INTO public.local_events(local_id,local_month_id,actor,kind,data)
  VALUES(v_month.local_id,v_month.id,'admin','local_social_post_checked',
    jsonb_build_object('reviewed_by',auth.uid(),'method','admin_manual_review'));
  RETURN jsonb_build_object('ok',true,'status','passed');
END;
$fn$;

REVOKE ALL ON FUNCTION public.local_social_check_admin_confirm(uuid,boolean,boolean,boolean,boolean)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.local_social_check_admin_confirm(uuid,boolean,boolean,boolean,boolean)
  TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.local_review_decide(
  p_local_month_id uuid,p_decision text,p_reasons text[] DEFAULT '{}'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_month public.local_months;
BEGIN
  IF NOT public.is_admin_user() OR p_decision NOT IN ('approve','changes_requested') THEN RAISE EXCEPTION 'admin_only_or_invalid' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_month FROM public.local_months WHERE id=p_local_month_id FOR UPDATE;
  IF NOT FOUND OR v_month.status<>'submitted' THEN RAISE EXCEPTION 'local_month_not_reviewable' USING ERRCODE='55000'; END IF;
  IF p_decision='approve' AND NOT EXISTS(SELECT 1 FROM public.local_reviews WHERE local_month_id=v_month.id AND social_check_status IN ('passed','unverifiable')) THEN RAISE EXCEPTION 'social_check_required' USING ERRCODE='55000'; END IF;
  IF p_decision='approve' AND (
    NOT EXISTS(
      SELECT 1 FROM public.local_reviews r
      WHERE r.local_month_id=v_month.id AND cardinality(r.media_job_ids) BETWEEN 1 AND 6
    )
    OR EXISTS(
      SELECT 1 FROM public.local_reviews r,unnest(r.media_job_ids) media_id
      WHERE r.local_month_id=v_month.id AND NOT EXISTS(
        SELECT 1 FROM public.creator_media_jobs j
        WHERE j.id=media_id AND j.local_month_id=v_month.id
          AND j.purpose='local_review' AND j.status='ready'
          AND j.deleted_at IS NULL AND j.bunny_video_id IS NOT NULL
      )
    )
  ) THEN RAISE EXCEPTION 'review_media_unavailable' USING ERRCODE='55000'; END IF;
  IF p_decision='approve' THEN
    UPDATE public.local_months SET status='published',approved_at=now(),published_at=now() WHERE id=v_month.id;
    UPDATE public.local_reviews SET changes_requested='{}' WHERE local_month_id=v_month.id;
    INSERT INTO public.local_events(local_id,local_month_id,actor,kind) VALUES(v_month.local_id,v_month.id,'admin','local_approved');
  ELSE
    IF cardinality(p_reasons)=0 OR v_month.resubmission_count>=1 THEN RAISE EXCEPTION 'changes_reasons_or_resubmission_invalid' USING ERRCODE='22023'; END IF;
    UPDATE public.local_months SET status='changes_requested',changes_due_at=now()+interval '5 days' WHERE id=v_month.id;
    UPDATE public.local_reviews SET changes_requested=p_reasons WHERE local_month_id=v_month.id;
    INSERT INTO public.local_events(local_id,local_month_id,actor,kind,data) VALUES(v_month.local_id,v_month.id,'admin','consumer.local.changes_requested',jsonb_build_object('reasons',p_reasons));
  END IF;
  RETURN jsonb_build_object('ok',true,'status',CASE WHEN p_decision='approve' THEN 'published' ELSE 'changes_requested' END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_4182_sync_delivery_retention(),
  public.issue_4182_sync_local_retention() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_4182_local_agreement_immutable(),
  public.issue_4182_local_agreement_version_guard(),
  public.issue_4182_local_signed_action_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.local_agreement_sign(uuid,text,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.local_agreement_sign(uuid,text,text)
  TO authenticated,service_role;

COMMENT ON TABLE public.local_agreement_acceptances IS
  '#4182 append-only electronic signature evidence: applicant, exact agreement version/URL/digest, typed signature and server acceptance time.';
COMMENT ON FUNCTION public.local_application_decide(uuid,text,text) IS
  '#4182 Admin may review or invite an applicant to sign the server-owned current agreement; Admin can never accept it for the applicant.';
COMMENT ON FUNCTION public.local_agreement_sign(uuid,text,text) IS
  '#4182 applicant-only electronic signature and atomic Local seat activation.';

COMMIT;
