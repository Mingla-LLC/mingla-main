-- #3872 R4 — Mingla Locals: city seats, monthly reviews, public DTOs and
-- provider-backed payout shares.
--
-- MINGLA-INVARIANT: I-3872-LOCAL-SEATS | issue #3872 | Active Locals never exceed the locked city-program seat count; issue_3872_local_seat_guard and the pg17 contract test enforce it.
-- MINGLA-INVARIANT: I-3872-LOCAL-NOT-PAID-BY-PLACE | issue #3872 | A Local cannot pick a place tied to their own history or paid relationship, and every approved month is funded by Mingla through the shared payee ledger with no brand owner.
-- MINGLA-INVARIANT: I-3872-LOCAL-PUBLIC-DTO | issue #3872 | Public Local reads expose only the named profile and review allow-lists; applications, payout amounts, evidence and moderation notes remain private.

BEGIN;
SET LOCAL lock_timeout='10s';

INSERT INTO public.feature_flags(flag_key,is_enabled,description)
VALUES ('mingla_locals_enabled',false,'#3872 R4 global Mingla Locals kill switch')
ON CONFLICT(flag_key) DO UPDATE SET description=EXCLUDED.description;

CREATE TABLE public.local_city_programs (
  city_id uuid PRIMARY KEY REFERENCES public.seeding_cities(id) ON DELETE CASCADE,
  seats integer NOT NULL DEFAULT 3 CHECK(seats BETWEEN 0 AND 10),
  is_open boolean NOT NULL DEFAULT false,
  monthly_usd_minor bigint NOT NULL DEFAULT 15000 CHECK(monthly_usd_minor>0),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.local_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES public.seeding_cities(id) ON DELETE RESTRICT,
  handles jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(handles)='object'),
  sample_links jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(sample_links)='array' AND jsonb_array_length(sample_links)<=10),
  why text NOT NULL CHECK(char_length(btrim(why)) BETWEEN 20 AND 600),
  status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','shortlisted','accepted','waitlisted','rejected')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_application_review_shape CHECK((reviewed_by IS NULL)=(reviewed_at IS NULL))
);
CREATE UNIQUE INDEX local_applications_one_active_uq ON public.local_applications(user_id,city_id)
  WHERE status IN ('submitted','shortlisted','accepted');
CREATE INDEX local_applications_queue_idx ON public.local_applications(status,created_at);

CREATE TABLE public.locals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES public.seeding_cities(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','ended')),
  seat_started_on date NOT NULL DEFAULT current_date,
  ends_on date,
  agreement_version text NOT NULL CHECK(char_length(btrim(agreement_version)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locals_end_shape CHECK((status='ended')=(ends_on IS NOT NULL))
);
CREATE INDEX locals_city_active_idx ON public.locals(city_id,status) WHERE status='active';

CREATE TABLE public.local_months (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id uuid NOT NULL REFERENCES public.locals(id) ON DELETE CASCADE,
  month date NOT NULL CHECK(month=date_trunc('month',month)::date),
  place_id uuid REFERENCES public.place_pool(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'picked' CHECK(status IN ('picked','confirmed','visited','submitted','changes_requested','approved','published','paid','missed','void')),
  picked_at timestamptz,
  confirmed_at timestamptz,
  visited_at timestamptz,
  receipt_media_job_id uuid REFERENCES public.creator_media_jobs(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  resubmission_count integer NOT NULL DEFAULT 0 CHECK(resubmission_count BETWEEN 0 AND 1),
  changes_due_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz,
  void_reason text,
  payee_share_id uuid REFERENCES public.payee_shares(id) ON DELETE RESTRICT,
  payout_currency text CHECK(payout_currency IS NULL OR payout_currency~'^[A-Z]{3}$'),
  payout_amount_minor bigint CHECK(payout_amount_minor IS NULL OR payout_amount_minor>0),
  fx_snapshot_id uuid REFERENCES public.fx_rate_snapshots(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(local_id,month),
  CONSTRAINT local_month_place_shape CHECK((status IN ('missed','void') AND place_id IS NULL) OR place_id IS NOT NULL),
  CONSTRAINT local_month_void_shape CHECK(status<>'void' OR void_reason IS NOT NULL),
  CONSTRAINT local_month_payout_shape CHECK((payee_share_id IS NULL AND payout_currency IS NULL AND payout_amount_minor IS NULL AND fx_snapshot_id IS NULL) OR (payee_share_id IS NOT NULL AND payout_currency IS NOT NULL AND payout_amount_minor IS NOT NULL AND fx_snapshot_id IS NOT NULL))
);
CREATE INDEX local_months_place_history_idx ON public.local_months(place_id,month DESC) WHERE place_id IS NOT NULL;
CREATE INDEX local_months_status_idx ON public.local_months(status,month);

CREATE TABLE public.local_reviews (
  local_month_id uuid PRIMARY KEY REFERENCES public.local_months(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5),
  title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 3 AND 70),
  body text NOT NULL CHECK(char_length(btrim(body)) BETWEEN 300 AND 2000),
  visited_on date NOT NULL,
  spend_band text CHECK(spend_band IN ('budget','moderate','premium','splurge')),
  media_job_ids uuid[] NOT NULL DEFAULT '{}' CHECK(cardinality(media_job_ids) BETWEEN 1 AND 6),
  social_post_url text NOT NULL CHECK(social_post_url~'^https://'),
  social_check_status text NOT NULL DEFAULT 'pending' CHECK(social_check_status IN ('pending','passed','failed','unverifiable')),
  social_check_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  disclosure_ack boolean NOT NULL CHECK(disclosure_ack),
  changes_requested text[] NOT NULL DEFAULT '{}',
  reply_text text CHECK(reply_text IS NULL OR char_length(btrim(reply_text)) BETWEEN 1 AND 500),
  reply_by_brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  reply_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_review_reply_shape CHECK((reply_text IS NULL AND reply_by_brand_id IS NULL AND reply_at IS NULL) OR (reply_text IS NOT NULL AND reply_by_brand_id IS NOT NULL AND reply_at IS NOT NULL))
);

CREATE TABLE public.local_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  local_id uuid REFERENCES public.locals(id) ON DELETE CASCADE,
  local_month_id uuid REFERENCES public.local_months(id) ON DELETE CASCADE,
  actor text NOT NULL CHECK(actor IN ('local','admin','brand','system')),
  kind text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX local_events_timeline_idx ON public.local_events(local_month_id,created_at,id);

CREATE TRIGGER issue_3872_local_city_program_updated BEFORE UPDATE ON public.local_city_programs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER issue_3872_local_application_updated BEFORE UPDATE ON public.local_applications FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER issue_3872_local_updated BEFORE UPDATE ON public.locals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER issue_3872_local_month_updated BEFORE UPDATE ON public.local_months FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER issue_3872_local_review_updated BEFORE UPDATE ON public.local_reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.issue_3872_local_seat_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE v_program public.local_city_programs; v_count integer;
BEGIN
  IF NEW.status<>'active' THEN RETURN NEW; END IF;
  SELECT * INTO v_program FROM public.local_city_programs WHERE city_id=NEW.city_id FOR UPDATE;
  IF NOT FOUND OR NOT v_program.is_open THEN RAISE EXCEPTION 'local_city_closed' USING ERRCODE='55000'; END IF;
  SELECT count(*) INTO v_count FROM public.locals l WHERE l.city_id=NEW.city_id AND l.status='active' AND l.id IS DISTINCT FROM NEW.id;
  IF v_count>=v_program.seats THEN RAISE EXCEPTION 'local_city_seats_full' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3872_local_seat_limit BEFORE INSERT OR UPDATE OF city_id,status ON public.locals FOR EACH ROW EXECUTE FUNCTION public.issue_3872_local_seat_guard();

CREATE OR REPLACE FUNCTION public.local_city_program_save(p_city_id uuid,p_seats integer,p_is_open boolean,p_monthly_usd_minor bigint DEFAULT 15000) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_active integer;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  SELECT count(*) INTO v_active FROM public.locals WHERE city_id=p_city_id AND status='active';
  IF p_seats<v_active THEN RAISE EXCEPTION 'seats_below_active_locals' USING ERRCODE='23514'; END IF;
  INSERT INTO public.local_city_programs(city_id,seats,is_open,monthly_usd_minor,updated_by)
  VALUES(p_city_id,p_seats,p_is_open,p_monthly_usd_minor,auth.uid())
  ON CONFLICT(city_id) DO UPDATE SET seats=excluded.seats,is_open=excluded.is_open,monthly_usd_minor=excluded.monthly_usd_minor,updated_by=excluded.updated_by;
  RETURN jsonb_build_object('ok',true,'active',v_active,'seats',p_seats);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_application_save(p_city_id uuid,p_handles jsonb,p_sample_links jsonb,p_why text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_application uuid;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.feature_flags WHERE flag_key='mingla_locals_enabled' AND is_enabled) OR NOT EXISTS(SELECT 1 FROM public.local_city_programs WHERE city_id=p_city_id AND is_open) THEN RAISE EXCEPTION 'locals_not_open' USING ERRCODE='55000'; END IF;
  IF jsonb_typeof(p_handles)<>'object' OR jsonb_typeof(p_sample_links)<>'array' OR jsonb_array_length(p_sample_links)>10 THEN RAISE EXCEPTION 'invalid_application' USING ERRCODE='22023'; END IF;
  INSERT INTO public.local_applications(user_id,city_id,handles,sample_links,why)
  VALUES(v_id,p_city_id,p_handles,p_sample_links,btrim(p_why)) RETURNING id INTO v_application;
  INSERT INTO public.local_events(actor,kind,data) VALUES('local','local_applied',jsonb_build_object('application_id',v_application,'city_id',p_city_id));
  RETURN jsonb_build_object('ok',true,'id',v_application,'status','submitted');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_application_decide(p_application_id uuid,p_status text,p_agreement_version text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_app public.local_applications; v_local uuid;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  IF p_status NOT IN ('shortlisted','accepted','waitlisted','rejected') THEN RAISE EXCEPTION 'invalid_application_status' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_app FROM public.local_applications WHERE id=p_application_id FOR UPDATE;
  IF NOT FOUND OR v_app.status NOT IN ('submitted','shortlisted','waitlisted') THEN RAISE EXCEPTION 'application_not_reviewable' USING ERRCODE='55000'; END IF;
  IF p_status='accepted' AND nullif(btrim(p_agreement_version),'') IS NULL THEN RAISE EXCEPTION 'agreement_version_required' USING ERRCODE='22023'; END IF;
  UPDATE public.local_applications SET status=p_status,reviewed_by=auth.uid(),reviewed_at=now() WHERE id=v_app.id;
  IF p_status='accepted' THEN
    INSERT INTO public.locals(user_id,city_id,status,agreement_version)
    VALUES(v_app.user_id,v_app.city_id,'active',btrim(p_agreement_version))
    ON CONFLICT(user_id) DO UPDATE SET city_id=excluded.city_id,status='active',ends_on=NULL,agreement_version=excluded.agreement_version
    RETURNING id INTO v_local;
    INSERT INTO public.local_events(local_id,actor,kind,data) VALUES(v_local,'admin','local_seated',jsonb_build_object('city_id',v_app.city_id));
  END IF;
  RETURN jsonb_build_object('ok',true,'status',p_status,'local_id',v_local);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_pick_place(p_place_id uuid,p_personal_tie boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_local public.locals; v_place public.place_pool; v_month date:=date_trunc('month',current_date)::date; v_brand uuid; v_id uuid;
BEGIN
  SELECT * INTO v_local FROM public.locals WHERE user_id=v_actor AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'active_local_required' USING ERRCODE='42501'; END IF;
  IF extract(day FROM current_date)>7 THEN RAISE EXCEPTION 'pick_window_closed' USING ERRCODE='55000'; END IF;
  IF p_personal_tie THEN RAISE EXCEPTION 'personal_tie_conflict' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_place FROM public.place_pool WHERE id=p_place_id AND is_active AND city_id=v_local.city_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'place_not_eligible' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.local_months m JOIN public.locals l ON l.id=m.local_id WHERE m.place_id=p_place_id AND l.city_id=v_local.city_id AND m.month>=v_month-interval '12 months' AND m.status NOT IN ('void','missed')) THEN RAISE EXCEPTION 'city_place_recently_reviewed' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.local_months WHERE local_id=v_local.id AND place_id=p_place_id AND status NOT IN ('void','missed')) THEN RAISE EXCEPTION 'local_already_reviewed_place' USING ERRCODE='23514'; END IF;
  SELECT brand_id INTO v_brand FROM public.venue_listings WHERE place_pool_id=p_place_id AND claim_status='verified';
  IF v_brand IS NOT NULL AND (EXISTS(SELECT 1 FROM public.gig_contracts WHERE brand_id=v_brand AND creator_account_id=v_actor AND created_at>=now()-interval '180 days') OR EXISTS(SELECT 1 FROM public.payee_shares WHERE brand_id=v_brand AND payee_user_id=v_actor AND created_at>=now()-interval '180 days')) THEN RAISE EXCEPTION 'paid_relationship_conflict' USING ERRCODE='23514'; END IF;
  INSERT INTO public.local_months(local_id,month,place_id,status,picked_at,confirmed_at)
  VALUES(v_local.id,v_month,p_place_id,'confirmed',now(),now()) RETURNING id INTO v_id;
  INSERT INTO public.local_events(local_id,local_month_id,actor,kind,data) VALUES(v_local.id,v_id,'local','local_pick',jsonb_build_object('result','confirmed','place_id',p_place_id));
  RETURN jsonb_build_object('ok',true,'local_month_id',v_id,'status','confirmed');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_mark_visited(p_local_month_id uuid,p_visited_on date,p_receipt_media_job_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_month public.local_months; v_local public.locals;
BEGIN
  SELECT m.* INTO v_month FROM public.local_months m JOIN public.locals l ON l.id=m.local_id WHERE m.id=p_local_month_id AND l.user_id=auth.uid() FOR UPDATE OF m;
  IF NOT FOUND OR v_month.status<>'confirmed' OR date_trunc('month',p_visited_on)::date<>v_month.month THEN RAISE EXCEPTION 'visit_not_allowed' USING ERRCODE='55000'; END IF;
  UPDATE public.local_months SET status='visited',visited_at=p_visited_on::timestamptz,receipt_media_job_id=p_receipt_media_job_id WHERE id=v_month.id;
  RETURN jsonb_build_object('ok',true,'status','visited');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_review_submit(p_local_month_id uuid,p_rating integer,p_title text,p_body text,p_visited_on date,p_spend_band text,p_media_job_ids uuid[],p_social_post_url text,p_disclosure_ack boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_month public.local_months; v_now date:=current_date;
BEGIN
  SELECT m.* INTO v_month FROM public.local_months m JOIN public.locals l ON l.id=m.local_id WHERE m.id=p_local_month_id AND l.user_id=auth.uid() FOR UPDATE OF m;
  IF NOT FOUND OR v_month.status NOT IN ('visited','changes_requested') THEN RAISE EXCEPTION 'review_not_submittable' USING ERRCODE='55000'; END IF;
  IF v_now>=(v_month.month+interval '1 month 3 days')::date OR (v_month.status='changes_requested' AND (v_month.changes_due_at IS NULL OR now()>v_month.changes_due_at OR v_month.resubmission_count>=1)) THEN RAISE EXCEPTION 'review_deadline_passed' USING ERRCODE='55000'; END IF;
  IF NOT p_disclosure_ack
    OR cardinality(p_media_job_ids) NOT BETWEEN 1 AND 6
    OR EXISTS(SELECT 1 FROM unnest(p_media_job_ids) id WHERE NOT EXISTS(
      SELECT 1 FROM public.creator_media_jobs j
      WHERE j.id=id AND j.owner_kind='local' AND j.owner_id=auth.uid()
        AND j.local_month_id=v_month.id AND j.purpose='local_review'
        AND j.status='ready' AND j.deleted_at IS NULL
    ))
    OR (
      EXISTS(SELECT 1 FROM public.creator_media_jobs j WHERE j.id=ANY(p_media_job_ids) AND j.duration_s IS NOT NULL)
      AND (
        cardinality(p_media_job_ids)<>1
        OR NOT EXISTS(SELECT 1 FROM public.creator_media_jobs j WHERE j.id=p_media_job_ids[1] AND j.duration_s>0)
      )
    )
  THEN RAISE EXCEPTION 'review_evidence_invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.local_reviews(local_month_id,rating,title,body,visited_on,spend_band,media_job_ids,social_post_url,disclosure_ack)
  VALUES(v_month.id,p_rating,btrim(p_title),btrim(p_body),p_visited_on,p_spend_band,p_media_job_ids,p_social_post_url,true)
  ON CONFLICT(local_month_id) DO UPDATE SET rating=excluded.rating,title=excluded.title,body=excluded.body,visited_on=excluded.visited_on,spend_band=excluded.spend_band,media_job_ids=excluded.media_job_ids,social_post_url=excluded.social_post_url,social_check_status='pending',social_check_detail='{}',disclosure_ack=true,changes_requested='{}';
  UPDATE public.local_months SET status='submitted',submitted_at=now(),resubmission_count=CASE WHEN status='changes_requested' THEN resubmission_count+1 ELSE resubmission_count END,changes_due_at=NULL WHERE id=v_month.id;
  INSERT INTO public.local_events(local_id,local_month_id,actor,kind) VALUES(v_month.local_id,v_month.id,'local','local_submitted');
  RETURN jsonb_build_object('ok',true,'status','submitted');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_social_check_record(p_local_month_id uuid,p_status text,p_detail jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL OR p_status NOT IN ('passed','failed','unverifiable') THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  UPDATE public.local_reviews SET social_check_status=p_status,social_check_detail=coalesce(p_detail,'{}') WHERE local_month_id=p_local_month_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'local_review_not_found' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('ok',true,'status',p_status);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_review_decide(p_local_month_id uuid,p_decision text,p_reasons text[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_month public.local_months;
BEGIN
  IF NOT public.is_admin_user() OR p_decision NOT IN ('approve','changes_requested') THEN RAISE EXCEPTION 'admin_only_or_invalid' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_month FROM public.local_months WHERE id=p_local_month_id FOR UPDATE;
  IF NOT FOUND OR v_month.status<>'submitted' THEN RAISE EXCEPTION 'local_month_not_reviewable' USING ERRCODE='55000'; END IF;
  IF p_decision='approve' AND NOT EXISTS(SELECT 1 FROM public.local_reviews WHERE local_month_id=v_month.id AND social_check_status IN ('passed','unverifiable')) THEN RAISE EXCEPTION 'social_check_required' USING ERRCODE='55000'; END IF;
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

CREATE OR REPLACE FUNCTION public.local_month_void(p_local_month_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v public.local_months;
BEGIN
  IF NOT public.is_admin_user() OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'admin_only_or_reason_required' USING ERRCODE='42501'; END IF;
  UPDATE public.local_months SET status='void',place_id=NULL,void_reason=btrim(p_reason),changes_due_at=NULL WHERE id=p_local_month_id AND status NOT IN ('paid','void') RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'local_month_not_voidable' USING ERRCODE='55000'; END IF;
  INSERT INTO public.local_events(local_id,local_month_id,actor,kind,data) VALUES(v.local_id,v.id,'admin','local_voided',jsonb_build_object('reason',p_reason));
  RETURN jsonb_build_object('ok',true,'status','void');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_place_reply(p_local_month_id uuid,p_brand_id uuid,p_reply text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_review public.local_reviews; v_month public.local_months;
BEGIN
  IF NOT public.biz_is_brand_member_for_read(p_brand_id,auth.uid()) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  SELECT r.* INTO v_review FROM public.local_reviews r WHERE r.local_month_id=p_local_month_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reply_not_allowed' USING ERRCODE='42501'; END IF;
  SELECT m.* INTO v_month FROM public.local_months m WHERE m.id=p_local_month_id;
  IF NOT FOUND OR v_month.status NOT IN ('published','paid') OR NOT EXISTS(SELECT 1 FROM public.venue_listings WHERE place_pool_id=v_month.place_id AND brand_id=p_brand_id AND claim_status='verified') THEN RAISE EXCEPTION 'reply_not_allowed' USING ERRCODE='42501'; END IF;
  IF v_review.reply_at IS NOT NULL AND now()>v_review.reply_at+interval '24 hours' THEN RAISE EXCEPTION 'reply_edit_window_closed' USING ERRCODE='55000'; END IF;
  UPDATE public.local_reviews SET reply_text=btrim(p_reply),reply_by_brand_id=p_brand_id,reply_at=coalesce(reply_at,now()) WHERE local_month_id=p_local_month_id;
  RETURN jsonb_build_object('ok',true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.public_local_profile(p_user_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT jsonb_build_object(
    'user_id',l.user_id,
    'name',coalesce(nullif(btrim(p.display_name),''),nullif(btrim(p.username),''),'Mingla Local'),
    'avatar_url',p.avatar_url,
    'city',c.name,
    'local_since',l.seat_started_on,
    'reviews',coalesce((SELECT jsonb_agg(jsonb_build_object('local_month_id',m.id,'place_id',m.place_id,'place_name',pp.name,'rating',r.rating,'title',r.title,'body',r.body,'visited_on',r.visited_on,'media_job_ids',r.media_job_ids,'social_post_url',r.social_post_url,'reply',r.reply_text) ORDER BY m.published_at DESC) FROM public.local_months m JOIN public.local_reviews r ON r.local_month_id=m.id JOIN public.place_pool pp ON pp.id=m.place_id WHERE m.local_id=l.id AND m.status IN ('published','paid')),'[]'::jsonb)
  ) FROM public.locals l JOIN public.profiles p ON p.id=l.user_id JOIN public.seeding_cities c ON c.id=l.city_id WHERE l.user_id=p_user_id AND l.status IN ('active','paused');
$fn$;

CREATE OR REPLACE FUNCTION public.public_place_local_reviews(p_place_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'published_at')::timestamptz DESC),'[]'::jsonb) FROM (
    SELECT jsonb_build_object('local_month_id',m.id,'local_user_id',l.user_id,'name',coalesce(nullif(btrim(p.display_name),''),nullif(btrim(p.username),''),'Mingla Local'),'avatar_url',p.avatar_url,'rating',r.rating,'title',r.title,'excerpt',left(r.body,220),'body',r.body,'visited_on',r.visited_on,'media_job_ids',r.media_job_ids,'social_post_url',r.social_post_url,'reply',r.reply_text,'published_at',m.published_at) item
    FROM public.local_months m JOIN public.local_reviews r ON r.local_month_id=m.id JOIN public.locals l ON l.id=m.local_id JOIN public.profiles p ON p.id=l.user_id
    WHERE m.place_id=p_place_id AND m.status IN ('published','paid') ORDER BY m.published_at DESC LIMIT 2
  ) q;
$fn$;

CREATE OR REPLACE FUNCTION public.local_home() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT jsonb_build_object('local',jsonb_build_object('id',l.id,'city_id',l.city_id,'city',c.name,'status',l.status,'since',l.seat_started_on),'current_month',(SELECT to_jsonb(m) FROM public.local_months m WHERE m.local_id=l.id AND m.month=date_trunc('month',current_date)::date),'months',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.month DESC) FROM public.local_months m WHERE m.local_id=l.id),'[]'::jsonb),'payout',(SELECT jsonb_build_object('stripe_status',a.stripe_status,'paystack_status',a.paystack_status,'currency',coalesce(a.paystack_currency,p.currency)) FROM public.payee_accounts a WHERE a.user_id=l.user_id))
  FROM public.locals l JOIN public.seeding_cities c ON c.id=l.city_id JOIN public.profiles p ON p.id=l.user_id WHERE l.user_id=auth.uid();
$fn$;

CREATE OR REPLACE FUNCTION public.local_timer_tick(p_now timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_missed integer:=0; v_rolled integer:=0; v_paid integer:=0;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  INSERT INTO public.local_months(local_id,month,status)
    SELECT l.id,date_trunc('month',p_now)::date,'missed' FROM public.locals l WHERE l.status='active' AND extract(day FROM p_now)>=8
    ON CONFLICT(local_id,month) DO NOTHING;
  GET DIAGNOSTICS v_missed=ROW_COUNT;
  UPDATE public.local_months SET status='missed',place_id=NULL WHERE status IN ('picked','confirmed','visited') AND p_now>month+interval '1 month 3 days';
  GET DIAGNOSTICS v_rolled=ROW_COUNT;
  v_missed:=v_missed+v_rolled;
  UPDATE public.local_months m SET status='paid' FROM public.payee_shares s WHERE m.payee_share_id=s.id AND s.status='paid' AND m.status='published';
  GET DIAGNOSTICS v_paid=ROW_COUNT;
  RETURN jsonb_build_object('ok',true,'missed',v_missed,'paid',v_paid);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_payout_prepare(p_local_month_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_month public.local_months; v_local public.locals; v_program public.local_city_programs; v_account public.payee_accounts; v_currency text; v_rail text; v_snapshot uuid; v_rate numeric; v_exp integer; v_amount bigint;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_month FROM public.local_months WHERE id=p_local_month_id FOR UPDATE;
  IF NOT FOUND OR v_month.status<>'published' THEN RAISE EXCEPTION 'local_month_not_payable' USING ERRCODE='55000'; END IF;
  IF v_month.payee_share_id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'replayed',true,'currency',v_month.payout_currency,'amount_minor',v_month.payout_amount_minor); END IF;
  SELECT * INTO v_local FROM public.locals WHERE id=v_month.local_id;
  SELECT * INTO v_program FROM public.local_city_programs WHERE city_id=v_local.city_id;
  SELECT * INTO v_account FROM public.payee_accounts WHERE user_id=v_local.user_id;
  IF v_account.stripe_status='active' THEN v_rail:='stripe'; SELECT upper(coalesce(p.currency,'USD')) INTO v_currency FROM public.profiles p WHERE p.id=v_local.user_id;
  ELSIF v_account.paystack_status='verified' THEN v_rail:='paystack'; v_currency:=upper(v_account.paystack_currency);
  ELSE RAISE EXCEPTION 'active_payee_required' USING ERRCODE='55000'; END IF;
  SELECT s.id,r.rate_per_base,c.minor_unit_exponent INTO v_snapshot,v_rate,v_exp FROM public.fx_rate_snapshots s JOIN public.fx_rates r ON r.snapshot_id=s.id JOIN public.supported_brand_currencies c ON c.code=r.currency_code WHERE s.status='active' AND r.currency_code=v_currency;
  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'active_fx_rate_required' USING ERRCODE='55000'; END IF;
  v_amount:=round((v_program.monthly_usd_minor::numeric/100)*v_rate*power(10,v_exp))::bigint;
  RETURN jsonb_build_object('ok',true,'rail',v_rail,'currency',v_currency,'amount_minor',v_amount,'fx_snapshot_id',v_snapshot,'usd_minor',v_program.monthly_usd_minor);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_payout_record(p_local_month_id uuid,p_rail text,p_currency text,p_amount_minor bigint,p_fx_snapshot_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_month public.local_months; v_local public.locals; v_share uuid; v_quote jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_month FROM public.local_months WHERE id=p_local_month_id FOR UPDATE;
  SELECT * INTO v_local FROM public.locals WHERE id=v_month.local_id;
  IF v_month.status<>'published' OR v_month.payee_share_id IS NOT NULL THEN RAISE EXCEPTION 'local_month_not_recordable' USING ERRCODE='55000'; END IF;
  v_quote:=public.local_payout_prepare(p_local_month_id);
  IF v_quote->>'rail'<>p_rail OR v_quote->>'currency'<>p_currency OR (v_quote->>'amount_minor')::bigint<>p_amount_minor OR (v_quote->>'fx_snapshot_id')::uuid<>p_fx_snapshot_id THEN RAISE EXCEPTION 'fx_quote_invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.payee_shares(order_kind,order_id,payee_kind,member_id,payee_user_id,payee_email_norm,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after)
  VALUES('local_month',v_month.id,'local_month',NULL,v_local.user_id,NULL,NULL,p_rail,p_currency,p_amount_minor,0,p_amount_minor,'releasable',now())
  ON CONFLICT(order_kind,order_id,payee_kind) DO UPDATE SET updated_at=now() RETURNING id INTO v_share;
  UPDATE public.local_months SET payee_share_id=v_share,payout_currency=p_currency,payout_amount_minor=p_amount_minor,fx_snapshot_id=p_fx_snapshot_id WHERE id=v_month.id;
  INSERT INTO public.local_events(local_id,local_month_id,actor,kind,data) VALUES(v_local.id,v_month.id,'system','local_payout_quoted',jsonb_build_object('currency',p_currency,'amount_minor',p_amount_minor,'share_id',v_share));
  RETURN jsonb_build_object('ok',true,'share_id',v_share,'currency',p_currency,'amount_minor',p_amount_minor);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_local_queue() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'cities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name) FROM public.seeding_cities c),'[]'::jsonb),
    'programs',coalesce((SELECT jsonb_agg(jsonb_build_object('city_id',p.city_id,'city',c.name,'seats',p.seats,'active',(SELECT count(*) FROM public.locals l WHERE l.city_id=p.city_id AND l.status='active'),'is_open',p.is_open,'monthly_usd_minor',p.monthly_usd_minor) ORDER BY c.name) FROM public.local_city_programs p JOIN public.seeding_cities c ON c.id=p.city_id),'[]'::jsonb),
    'applications',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'user_id',a.user_id,'city_id',a.city_id,'city',c.name,'handles',a.handles,'sample_links',a.sample_links,'why',a.why,'status',a.status,'created_at',a.created_at) ORDER BY a.created_at) FROM public.local_applications a JOIN public.seeding_cities c ON c.id=a.city_id WHERE a.status IN ('submitted','shortlisted','waitlisted')),'[]'::jsonb),
    'reviews',coalesce((SELECT jsonb_agg(jsonb_build_object('local_month_id',m.id,'local_id',m.local_id,'local_name',coalesce(p.display_name,p.username),'place_name',pp.name,'month',m.month,'status',m.status,'review',to_jsonb(r),'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at,e.id),'[]'::jsonb) FROM public.local_events e WHERE e.local_month_id=m.id)) ORDER BY m.submitted_at) FROM public.local_months m JOIN public.local_reviews r ON r.local_month_id=m.id JOIN public.locals l ON l.id=m.local_id JOIN public.profiles p ON p.id=l.user_id JOIN public.place_pool pp ON pp.id=m.place_id WHERE m.status IN ('submitted','changes_requested')),'[]'::jsonb),
    'payouts',coalesce((SELECT jsonb_agg(jsonb_build_object('local_month_id',m.id,'local_name',coalesce(p.display_name,p.username),'month',m.month,'status',m.status,'currency',m.payout_currency,'amount_minor',m.payout_amount_minor,'share_status',s.status) ORDER BY m.month DESC) FROM public.local_months m JOIN public.locals l ON l.id=m.local_id JOIN public.profiles p ON p.id=l.user_id LEFT JOIN public.payee_shares s ON s.id=m.payee_share_id WHERE m.status IN ('published','paid')),'[]'::jsonb)
  );
END;
$fn$;

-- Extend the one payout ledger. Local shares have no Host/brand owner and use
-- the FX amount frozen on the Local month.
ALTER TABLE public.payee_shares ALTER COLUMN brand_id DROP NOT NULL;
ALTER TABLE public.payee_shares DROP CONSTRAINT payee_shares_order_kind_check;
ALTER TABLE public.payee_shares DROP CONSTRAINT payee_shares_payee_kind_check;
ALTER TABLE public.payee_shares DROP CONSTRAINT payee_shares_fee_rate;
ALTER TABLE public.payee_shares ADD CONSTRAINT payee_shares_order_kind_check CHECK(order_kind IN ('ticket','venue_order','gig','local_month'));
ALTER TABLE public.payee_shares ADD CONSTRAINT payee_shares_payee_kind_check CHECK(payee_kind IN ('referral','gig_fee','local_month'));
ALTER TABLE public.payee_shares ADD CONSTRAINT payee_shares_fee_rate CHECK(
  (payee_kind='referral' AND mingla_fee_minor=((gross_minor*5+50)/100))
  OR (payee_kind='gig_fee' AND order_kind='gig' AND mingla_fee_minor=0 AND net_minor=gross_minor)
  OR (payee_kind='local_month' AND order_kind='local_month' AND brand_id IS NULL AND member_id IS NULL AND mingla_fee_minor=0 AND net_minor=gross_minor)
);

CREATE OR REPLACE FUNCTION public.issue_3872_payee_share_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE v_member public.referral_members%ROWTYPE; v_attribution public.order_attributions%ROWTYPE; v_contract public.gig_contracts%ROWTYPE; v_month public.local_months%ROWTYPE; v_local public.locals%ROWTYPE;
BEGIN
  NEW.payee_email_norm:=NULLIF(lower(btrim(coalesce(NEW.payee_email_norm,''))), '');
  IF NEW.payee_kind='local_month' THEN
    SELECT * INTO v_month FROM public.local_months WHERE id=NEW.order_id;
    SELECT * INTO v_local FROM public.locals WHERE id=v_month.local_id;
    IF NOT FOUND OR NEW.order_kind<>'local_month' OR NEW.member_id IS NOT NULL OR NEW.brand_id IS NOT NULL OR NEW.payee_user_id<>v_local.user_id OR NEW.gross_minor<>NEW.net_minor OR NEW.mingla_fee_minor<>0 THEN RAISE EXCEPTION 'local_month_share_mismatch'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.payee_kind='gig_fee' THEN
    SELECT * INTO v_contract FROM public.gig_contracts WHERE id=NEW.order_id;
    IF NOT FOUND OR NEW.order_kind<>'gig' OR NEW.member_id IS NOT NULL OR NEW.brand_id<>v_contract.brand_id OR NEW.payee_user_id<>v_contract.creator_account_id OR NEW.gross_minor<>NEW.net_minor OR NEW.mingla_fee_minor<>0 THEN RAISE EXCEPTION 'gig_fee_share_contract_mismatch'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO v_member FROM public.referral_members WHERE id=NEW.member_id;
  IF NOT FOUND OR v_member.brand_id<>NEW.brand_id THEN RAISE EXCEPTION 'payee_share_member_mismatch'; END IF;
  IF NOT ((NEW.payee_user_id IS NOT NULL AND v_member.user_id=NEW.payee_user_id) OR (NEW.payee_email_norm IS NOT NULL AND v_member.email_norm=NEW.payee_email_norm)) THEN RAISE EXCEPTION 'payee_share_identity_mismatch'; END IF;
  SELECT * INTO v_attribution FROM public.order_attributions WHERE order_kind=NEW.order_kind AND order_id=NEW.order_id;
  IF NOT FOUND OR v_attribution.brand_id<>NEW.brand_id OR v_attribution.member_id IS DISTINCT FROM NEW.member_id OR v_attribution.share_minor<>NEW.gross_minor THEN RAISE EXCEPTION 'payee_share_attribution_mismatch'; END IF;
  RETURN NEW;
END;
$fn$;

ALTER TABLE public.local_city_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_city_programs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.local_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.locals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.local_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_months FORCE ROW LEVEL SECURITY;
ALTER TABLE public.local_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.local_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.local_city_programs,public.local_applications,public.locals,public.local_months,public.local_reviews,public.local_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.local_city_programs,public.local_applications,public.locals,public.local_months,public.local_reviews,public.local_events TO authenticated;
GRANT ALL ON public.local_city_programs,public.local_applications,public.locals,public.local_months,public.local_reviews,public.local_events TO service_role;
CREATE POLICY local_program_authenticated_read ON public.local_city_programs FOR SELECT TO authenticated USING(is_open);
CREATE POLICY local_applications_owner_read ON public.local_applications FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY locals_owner_read ON public.locals FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY local_months_owner_read ON public.local_months FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.locals l WHERE l.id=local_id AND l.user_id=auth.uid()));
CREATE POLICY local_reviews_owner_read ON public.local_reviews FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.local_months m JOIN public.locals l ON l.id=m.local_id WHERE m.id=local_month_id AND l.user_id=auth.uid()));
CREATE POLICY local_events_owner_read ON public.local_events FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.locals l WHERE l.id=local_id AND l.user_id=auth.uid()));
CREATE POLICY local_program_service_all ON public.local_city_programs FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY local_applications_service_all ON public.local_applications FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY locals_service_all ON public.locals FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY local_months_service_all ON public.local_months FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY local_reviews_service_all ON public.local_reviews FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY local_events_service_all ON public.local_events FOR ALL TO service_role USING(true) WITH CHECK(true);

REVOKE ALL ON FUNCTION public.issue_3872_local_seat_guard(),public.local_city_program_save(uuid,integer,boolean,bigint),public.local_application_save(uuid,jsonb,jsonb,text),public.local_application_decide(uuid,text,text),public.local_pick_place(uuid,boolean),public.local_mark_visited(uuid,date,uuid),public.local_review_submit(uuid,integer,text,text,date,text,uuid[],text,boolean),public.local_social_check_record(uuid,text,jsonb),public.local_review_decide(uuid,text,text[]),public.local_month_void(uuid,text),public.local_place_reply(uuid,uuid,text),public.public_local_profile(uuid),public.public_place_local_reviews(uuid),public.local_home(),public.local_timer_tick(timestamptz),public.local_payout_prepare(uuid),public.local_payout_record(uuid,text,text,bigint,uuid),public.admin_local_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.local_city_program_save(uuid,integer,boolean,bigint),public.local_application_save(uuid,jsonb,jsonb,text),public.local_application_decide(uuid,text,text),public.local_pick_place(uuid,boolean),public.local_mark_visited(uuid,date,uuid),public.local_review_submit(uuid,integer,text,text,date,text,uuid[],text,boolean),public.local_review_decide(uuid,text,text[]),public.local_month_void(uuid,text),public.local_place_reply(uuid,uuid,text),public.local_home(),public.admin_local_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_local_profile(uuid),public.public_place_local_reviews(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.local_social_check_record(uuid,text,jsonb),public.local_timer_tick(timestamptz),public.local_payout_prepare(uuid),public.local_payout_record(uuid,text,text,bigint,uuid) TO service_role;

COMMENT ON FUNCTION public.public_local_profile(uuid) IS '#3872 public allow-list: user_id, name, avatar_url, city, local_since and published review DTOs only.';
COMMENT ON FUNCTION public.public_place_local_reviews(uuid) IS '#3872 public allow-list: two newest published Local reviews and one place reply; never applications, evidence receipts, payout or moderation data.';

COMMIT;
